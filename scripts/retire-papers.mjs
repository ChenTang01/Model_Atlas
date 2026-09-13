import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_NAME = "retirement-plan.json";
const DEFAULT_OPERATION = "retire-authoritative-extraction-blockers";
const HASH = /^[a-f0-9]{64}$/;
const REBUILDABLE_AFTER_RETIREMENT = new Set([
  "data/notes/release-candidate",
  "research/ledger/authoring-plan.release-v20.json"
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value, space = 0) {
  const seen = new WeakSet();
  const normalize = (input) => {
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) throw new TypeError("Cannot stringify a cyclic value");
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
  };
  return JSON.stringify(normalize(value), null, space);
}

function normalizeDoi(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

function importEntryMatchesRecord(entry, record) {
  const entryDoi = normalizeDoi(entry?.doi);
  const recordDoi = normalizeDoi(record?.doi);
  if (entryDoi && recordDoi && entryDoi === recordDoi) return true;
  const entrySha256 = String(entry?.sha256 || entry?.pdf_sha256 || "").trim().toLowerCase();
  const recordSha256 = String(record?.pdfSha256 || record?.pdf_sha256 || "").trim().toLowerCase();
  return HASH.test(entrySha256) && HASH.test(recordSha256) && entrySha256 === recordSha256;
}

function countImportMatches(entries, records) {
  return (entries || []).filter((entry) => records.some((record) => importEntryMatchesRecord(entry, record))).length;
}

export function calculateRetirementExpectations({ catalog, manifest, visualSample, imported, importAudit, records }) {
  const catalogDetailLevels = countBy(catalog.records || [], (record) => record.detail_level);
  const removedDetailLevels = countBy(records, (record) => record.detailLevel);
  const removedImportManifestRecords = countImportMatches(imported?.records, records);
  const removedImportAuditMappings = countImportMatches(importAudit?.mappings, records);
  const removedPdfBytes = records.reduce((sum, record) => sum + Number(record.pdfBytes || 0), 0);
  const removedPdfPages = records.reduce((sum, record) => sum + Number(record.pdfPageCount || 0), 0);
  const removedParserWarningPdfs = records.filter((record) => record.inventoryParserWarning).length;
  const removedFallbackSelected = records.filter((record) => record.fallbackUsed).length;
  const removedVisualParserWarnings = records.filter((record) => record.extractionParserWarning).length;
  const expectedRemoval = {
    records: records.length,
    detailLevels: removedDetailLevels,
    literature: Number(removedDetailLevels.literature || 0),
    modelMaps: Number(removedDetailLevels.model_map || 0),
    importManifestRecords: removedImportManifestRecords,
    importAuditMappings: removedImportAuditMappings,
    pdfBytes: removedPdfBytes,
    pdfPages: removedPdfPages,
    parserWarningPdfs: removedParserWarningPdfs,
    fallbackSelected: removedFallbackSelected,
    visualParserWarnings: removedVisualParserWarnings
  };
  return {
    expectedRemoval,
    expectedAfter: {
      records: (catalog.records || []).length - expectedRemoval.records,
      literature: Number(catalogDetailLevels.literature || 0) - expectedRemoval.literature,
      modelMaps: Number(catalogDetailLevels.model_map || 0) - expectedRemoval.modelMaps,
      pdfBytes: Number(manifest?.counts?.bytes || 0) - expectedRemoval.pdfBytes,
      pdfPages: Number(manifest?.counts?.pages || 0) - expectedRemoval.pdfPages,
      parserWarningPdfs: Number(manifest?.counts?.parserWarningPdfs || 0) - expectedRemoval.parserWarningPdfs,
      fallbackSelected: Number(visualSample?.corpus?.fallbackSelected || 0) - expectedRemoval.fallbackSelected,
      visualParserWarnings: Number(visualSample?.corpus?.parserWarnings || 0) - expectedRemoval.visualParserWarnings,
      importManifestRecords: Number(imported?.records?.length || 0) - expectedRemoval.importManifestRecords,
      importAuditMappings: Number(importAudit?.mappings?.length || 0) - expectedRemoval.importAuditMappings
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseCli(argv) {
  const options = { command: argv[0] || "help", ids: [], quarantine: "", root: SCRIPT_ROOT, operation: "", step: "" };
  const takeValue = (index, option) => {
    const value = argv[index + 1];
    if (!value || String(value).startsWith("--")) throw new Error(`${option} requires a value`);
    return value;
  };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--ids") options.ids = String(takeValue(index++, token)).split(",").map((id) => id.trim()).filter(Boolean);
    else if (token === "--quarantine") options.quarantine = path.resolve(takeValue(index++, token));
    else if (token === "--root") options.root = path.resolve(takeValue(index++, token));
    else if (token === "--operation") options.operation = String(takeValue(index++, token)).trim();
    else if (token === "--step") options.step = String(takeValue(index++, token)).trim();
    else throw new Error(`Unknown option: ${token}`);
  }
  if (!["prepare", "apply", "checkpoint", "verify", "verify-archive", "help"].includes(options.command)) throw new Error(`Unknown command: ${options.command}`);
  if (options.command !== "help" && !options.quarantine) throw new Error("--quarantine is required");
  if (options.command === "prepare" && !options.ids.length) throw new Error("prepare requires --ids");
  if (options.operation && options.command !== "prepare") throw new Error("--operation is supported only by prepare");
  if (options.step && options.command !== "checkpoint") throw new Error("--step is supported only by checkpoint");
  if (options.command === "checkpoint" && !["workbookPruned", "publicDataPromoted", "readinessPassed"].includes(options.step)) {
    throw new Error("checkpoint requires --step workbookPruned|publicDataPromoted|readinessPassed");
  }
  if (options.operation && !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(options.operation)) {
    throw new Error("--operation must be a 1-128 character identifier containing only letters, digits, dot, underscore, or hyphen");
  }
  return options;
}

async function checkpoint(options) {
  const planPath = path.join(options.quarantine, PLAN_NAME);
  const plan = await readJson(planPath);
  assert(path.resolve(plan.atlasRoot) === path.resolve(options.root), "Retirement plan belongs to a different Atlas root");
  assert(["applied", "complete"].includes(plan.status), `Cannot checkpoint a plan in status ${plan.status}`);
  plan.progress[options.step] = true;
  const completed = Object.values(plan.progress).every(Boolean);
  if (completed) {
    plan.status = "complete";
    plan.completedAt = plan.completedAt || new Date().toISOString();
  }
  plan.updatedAt = new Date().toISOString();
  await atomicWriteJson(planPath, plan);
  console.log(JSON.stringify({
    command: "checkpoint",
    step: options.step,
    status: plan.status,
    progress: plan.progress,
    recoveryPlan: planPath
  }, null, 2));
}

function isWithin(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveLive(root, relativePath) {
  const result = path.resolve(root, ...String(relativePath).split("/"));
  assert(isWithin(root, result), `Live path escapes Atlas root: ${relativePath}`);
  return result;
}

function resolveQuarantine(quarantine, relativePath) {
  const result = path.resolve(quarantine, ...String(relativePath).split("/"));
  assert(isWithin(quarantine, result), `Quarantine path escapes its root: ${relativePath}`);
  return result;
}

async function exists(filename) {
  try {
    await stat(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(filename, bytes) {
  const temporary = `${filename}.${process.pid}.tmp`;
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(temporary, bytes);
  await rename(temporary, filename);
}

async function atomicWriteJson(filename, value) {
  await atomicWrite(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function readAssignmentJson(filename, assignment) {
  const source = await readFile(filename, "utf8");
  const markerIndex = source.indexOf(assignment);
  assert(markerIndex >= 0, `${path.basename(filename)} does not contain ${assignment}`);
  const equalsIndex = source.indexOf("=", markerIndex + assignment.length);
  assert(equalsIndex >= 0, `${path.basename(filename)} has no assignment for ${assignment}`);
  return JSON.parse(source.slice(equalsIndex + 1).trim().replace(/;\s*$/, ""));
}

function recordIdentityIssues(records, retiredRecords) {
  const retiredIds = new Set(retiredRecords.map((record) => record.id));
  const retiredDois = new Set(retiredRecords.map((record) => normalizeDoi(record.doi)).filter(Boolean));
  const retiredTitles = new Set(retiredRecords.map((record) => String(record.title || "").trim()).filter(Boolean));
  return records
    .filter((record) => retiredIds.has(record?.id)
      || retiredDois.has(normalizeDoi(record?.doi))
      || retiredTitles.has(String(record?.title || "").trim()))
    .map((record) => record?.id || normalizeDoi(record?.doi) || String(record?.title || ""));
}

function assertNoRetiredRecords(label, records, retiredRecords) {
  assert(Array.isArray(records), `${label} has no records array`);
  const issues = [...new Set(recordIdentityIssues(records, retiredRecords))];
  assert(issues.length === 0, `${label} retains retired identities: ${issues.join(", ")}`);
}

function assertSameRecordIds(label, left, right) {
  const leftIds = new Set(left.map((record) => record.id));
  const rightIds = new Set(right.map((record) => record.id));
  const leftOnly = [...leftIds].filter((id) => !rightIds.has(id));
  const rightOnly = [...rightIds].filter((id) => !leftIds.has(id));
  assert(leftOnly.length === 0 && rightOnly.length === 0,
    `${label} ID sets differ (left-only=${leftOnly.join(",")}; right-only=${rightOnly.join(",")})`);
}

async function hashFile(filename) {
  const bytes = await readFile(filename);
  return { sha256: sha256(bytes), bytes: bytes.length };
}

async function walkFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(filename, base));
    else if (entry.isFile()) files.push(path.relative(base, filename).replaceAll(path.sep, "/"));
  }
  return files;
}

async function describePath(root, relativePath) {
  const filename = resolveLive(root, relativePath);
  const info = await stat(filename);
  if (info.isFile()) return { relativePath, type: "file", ...await hashFile(filename) };
  assert(info.isDirectory(), `Unsupported retirement path type: ${relativePath}`);
  const files = await walkFiles(filename);
  const members = [];
  let bytes = 0;
  for (const member of files) {
    const digest = await hashFile(path.join(filename, ...member.split("/")));
    bytes += digest.bytes;
    members.push({ path: member, ...digest });
  }
  return {
    relativePath,
    type: "directory",
    bytes,
    fileCount: members.length,
    sha256: sha256(stableStringify(members))
  };
}

async function describeQuarantinedPath(quarantine, entry) {
  const filename = resolveQuarantine(quarantine, `retired/${entry.relativePath}`);
  const root = path.join(quarantine, "retired");
  return describePath(root, entry.relativePath);
}

function removeNestedEntries(entries) {
  const ordered = [...entries].sort((a, b) => a.relativePath.length - b.relativePath.length || a.relativePath.localeCompare(b.relativePath));
  const result = [];
  for (const entry of ordered) {
    const nested = result.some((parent) => parent.type === "directory" && entry.relativePath.startsWith(`${parent.relativePath}/`));
    if (!nested) result.push(entry);
  }
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function runQaStatus(root) {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/extraction-qa.mjs", "status", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function copyBaseline(root, quarantine, relativePath) {
  const source = resolveLive(root, relativePath);
  if (!await exists(source)) return null;
  const info = await stat(source);
  assert(info.isFile(), `Baseline backup must be a file: ${relativePath}`);
  const destination = resolveQuarantine(quarantine, `baseline/${relativePath}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const sourceDigest = await hashFile(source);
  const destinationDigest = await hashFile(destination);
  assert(stableStringify(sourceDigest) === stableStringify(destinationDigest), `Backup verification failed: ${relativePath}`);
  return { relativePath, ...sourceDigest };
}

async function findNamedFiles(root, predicate) {
  if (!await exists(root)) return [];
  const files = await walkFiles(root);
  return files.filter(predicate);
}

async function prepare(options) {
  const root = options.root;
  const quarantine = options.quarantine;
  const operation = options.operation || DEFAULT_OPERATION;
  assert(!isWithin(root, quarantine) && !isWithin(quarantine, root), "Quarantine must be a separate sibling tree, not Atlas or its parent");
  await mkdir(quarantine, { recursive: true });
  const planPath = path.join(quarantine, PLAN_NAME);
  if (await exists(planPath)) {
    const current = await readJson(planPath);
    const requested = [...new Set(options.ids)].sort();
    assert(stableStringify(current.paperIds) === stableStringify(requested), "Existing retirement plan has a different paper set");
    if (options.operation) assert(current.operation === operation, "Existing retirement plan has a different operation");
    console.log(JSON.stringify({ command: "prepare", resumed: true, status: current.status, planPath }, null, 2));
    return;
  }

  const ids = [...new Set(options.ids)].sort();
  assert(ids.length === options.ids.length, "Retirement IDs must be unique");
  const catalogPath = path.join(root, "data", "atlas_articles.json");
  const catalog = await readJson(catalogPath);
  const catalogById = new Map(catalog.records.map((record) => [String(record.id), record]));
  const records = ids.map((id) => {
    const record = catalogById.get(id);
    assert(record, `Retirement ID is absent from the catalog: ${id}`);
    assert(HASH.test(String(record.pdf_sha256 || "").toLowerCase()), `${id}: invalid catalog PDF hash`);
    return {
      id,
      doi: normalizeDoi(record.doi),
      bibkey: String(record.bibkey),
      title: String(record.title),
      workbookRow: Number(record.workbook_row),
      pdfFile: String(record.pdf_file),
      pdfSha256: String(record.pdf_sha256).toLowerCase(),
      pdfBytes: Number(record.pdf_bytes),
      // The public catalog intentionally omits page counts. Prepare binds the
      // authoritative value from the corpus manifest below.
      pdfPageCount: null,
      detailLevel: String(record.detail_level)
    };
  });

  const qa = await runQaStatus(root);
  const observedBlockers = qa.results
    .filter((entry) => entry.qaStatus !== "complete")
    .map((entry) => entry.id)
    .sort();
  if (operation === DEFAULT_OPERATION) {
    assert(stableStringify(observedBlockers) === stableStringify(ids), `Requested IDs are not the exact authoritative blocker set:\n${stableStringify(observedBlockers, 2)}`);
  }

  const manifest = await readJson(path.join(root, "research", "corpus", "manifest.v1.json"));
  const visualSample = await readJson(path.join(root, "research", "extraction-qa-visual-sample.v1.json"));
  const imported = await readJson(path.join(root, "data", "imports", "atlas_literature_2016_present", "final_included_manifest.json"));
  const importAudit = await readJson(path.join(root, "data", "imports", "atlas_literature_2016_present", "IMPORT_AUDIT.json"));
  const manifestById = new Map(manifest.records.map((record) => [record.id, record]));
  const moveCandidates = [];
  const addRequired = async (relativePath) => {
    assert(await exists(resolveLive(root, relativePath)), `Required retirement path is missing: ${relativePath}`);
    moveCandidates.push(await describePath(root, relativePath));
  };
  const addIfPresent = async (relativePath) => {
    if (await exists(resolveLive(root, relativePath))) moveCandidates.push(await describePath(root, relativePath));
  };

  for (const record of records) {
    const manifestRecord = manifestById.get(record.id);
    assert(manifestRecord, `${record.id}: absent from the current corpus manifest`);
    assert(manifestRecord.pdf.sha256 === record.pdfSha256, `${record.id}: manifest/catalog PDF hash mismatch`);
    assert(manifestRecord.pdf.bytes === record.pdfBytes, `${record.id}: manifest/catalog PDF byte mismatch`);
    assert(Number.isInteger(manifestRecord.pdf.pageCount) && manifestRecord.pdf.pageCount > 0,
      `${record.id}: manifest PDF page count is invalid`);
    record.pdfPageCount = manifestRecord.pdf.pageCount;
    const pdfPath = `paper/${record.pdfFile}`;
    const pdfDigest = await hashFile(resolveLive(root, pdfPath));
    assert(pdfDigest.sha256 === record.pdfSha256 && pdfDigest.bytes === record.pdfBytes, `${record.id}: live PDF identity mismatch`);
    const ledger = await readJson(resolveLive(root, `research/ledger/papers/${record.id}.json`));
    record.fallbackUsed = ledger.stages?.extraction?.fallbackUsed === true;
    record.extractionParserWarning = Number(ledger.stages?.extraction?.parserWarningCount || 0) > 0;
    record.inventoryParserWarning = Number(manifestRecord.pdf?.parse?.warningCount || 0) > 0;

    await addRequired(pdfPath);
    await addIfPresent(`data/notes/papers/${record.id}.json`);
    await addIfPresent(`research/model-note-safe-maps/v1/${record.id}.json`);
    await addRequired(`research/ledger/papers/${record.id}.json`);
    await addRequired(`research/ledger/artifacts/${record.id}`);
    await addRequired(`research/ledger/extraction-qa/${record.id}`);
    await addIfPresent(`research/ledger/extraction-repair-candidates/${record.id}`);
    await addIfPresent(`research/extraction-repair-specs/${record.id}.diagnostic.md`);
    await addIfPresent(`research/extraction-repair-specs/${record.id}.json`);
    for (const tree of [
      "extraction-qa-adjudications",
      "extraction-repair-adjudications",
      "extraction-repair-promotions",
      "extraction-repair-quiescence",
      "extraction-repair-visual-qa"
    ]) await addIfPresent(`research/ledger/${tree}/${record.id}`);

    const attemptsRoot = resolveLive(root, "research/ledger/attempts");
    const attemptFiles = await findNamedFiles(attemptsRoot, (member) => member.endsWith(`/${record.id}.extract.json`) || member === `${record.id}.extract.json`);
    record.attemptReceiptCount = attemptFiles.length;
    for (const member of attemptFiles) await addRequired(`research/ledger/attempts/${member}`);

    const rebindRoot = resolveLive(root, "research/ledger/safe-map-qa-provenance-rebind");
    const rebindFiles = await findNamedFiles(rebindRoot, (member) => member.endsWith(`/${record.id}.json`)
      && (member.includes("/snapshots/before/") || member.includes("/snapshots/after/")));
    record.safeMapRebindSnapshotCount = rebindFiles.length;
    for (const member of rebindFiles) await addRequired(`research/ledger/safe-map-qa-provenance-rebind/${member}`);
  }

  await addIfPresent("data/notes/chunk1-preview");
  await addIfPresent("data/notes/release-candidate");
  await addIfPresent("research/ledger/authoring-plan.release-v20.json");

  const tmpRoot = resolveLive(root, "tmp");
  const idSet = new Set(ids);
  const tmpMatches = await findNamedFiles(tmpRoot, (member) => [...idSet].some((id) => member.includes(id)));
  for (const member of tmpMatches) await addIfPresent(`tmp/${member}`);

  const entries = removeNestedEntries(moveCandidates);
  const baselinePaths = [
    "atlas_game_theory_articles.xlsx",
    "data/atlas_articles.json",
    "data/atlas_articles.js",
    "data/model_notes.json",
    "data/model_notes.js",
    "data/imports/atlas_literature_2016_present/final_included_manifest.json",
    "data/imports/atlas_literature_2016_present/IMPORT_AUDIT.json",
    "reference.bib",
    "research/corpus/manifest.v1.json",
    "research/corpus/model-note-audit.v1.json",
    "research/ledger/summary.json",
    "research/ledger/extraction-visual-scope-review.v1.json",
    "research/extraction-qa-visual-sample.v1.json",
    "mini-atlas/research/sample.json"
  ];
  const backups = [];
  for (const relativePath of baselinePaths) {
    const backup = await copyBaseline(root, quarantine, relativePath);
    if (backup) backups.push(backup);
  }

  const expectations = calculateRetirementExpectations({ catalog, manifest, visualSample, imported, importAudit, records });
  expectations.expectedRemoval.attemptReceipts = records.reduce((sum, record) => sum + record.attemptReceiptCount, 0);
  expectations.expectedRemoval.safeMapRebindSnapshots = records.reduce((sum, record) => sum + record.safeMapRebindSnapshotCount, 0);

  const plan = {
    schemaVersion: 1,
    operation,
    status: "prepared",
    preparedAt: new Date().toISOString(),
    atlasRoot: root,
    quarantineRoot: quarantine,
    paperIds: ids,
    source: {
      catalogRecords: catalog.records.length,
      catalogSha256: (await hashFile(catalogPath)).sha256,
      manifestRecords: manifest.records.length,
      manifestSha256: (await hashFile(path.join(root, "research", "corpus", "manifest.v1.json"))).sha256,
      qa: {
        selected: qa.selected,
        complete: qa.qaStatuses?.complete || 0,
        needsReview: qa.qaStatuses?.needs_review || 0,
        missing: qa.qaStatuses?.missing || 0
      },
      importManifestRecords: imported.records.length,
      importAuditMappings: importAudit.mappings.length
    },
    expectedRemoval: expectations.expectedRemoval,
    expectedAfter: expectations.expectedAfter,
    records,
    backups,
    moveEntries: entries,
    progress: {
      aggregateMetadataPruned: false,
      liveArtifactsMoved: false,
      workbookPruned: false,
      publicDataPromoted: false,
      readinessPassed: false
    }
  };
  await atomicWriteJson(planPath, plan);
  console.log(JSON.stringify({
    command: "prepare",
    planPath,
    paperCount: records.length,
    moveEntries: entries.length,
    moveBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    backups: backups.length,
    expectedRemoval: plan.expectedRemoval,
    expectedAfter: plan.expectedAfter
  }, null, 2));
}

function countBy(records, selector) {
  const counts = new Map();
  for (const record of records) {
    const key = String(selector(record) || "");
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value || "").trim().length > 0;
}

async function pruneCatalog(root, plan) {
  const filename = resolveLive(root, "data/atlas_articles.json");
  const payload = await readJson(filename);
  const ids = new Set(plan.paperIds);
  const before = payload.records.length;
  payload.records = payload.records.filter((record) => !ids.has(String(record.id)));
  const removed = before - payload.records.length;
  assert(removed === 0 || before === plan.source.catalogRecords && removed === plan.paperIds.length, `Catalog is partially pruned (${removed} removed this run)`);
  assert(payload.records.length === plan.expectedAfter.records, `Catalog count after retirement is ${payload.records.length}, expected ${plan.expectedAfter.records}`);

  const records = payload.records;
  const modelMaps = records.filter((record) => record.detail_level === "model_map").length;
  const literature = records.filter((record) => record.detail_level === "literature").length;
  const importAudit = await readJson(resolveLive(root, "data/imports/atlas_literature_2016_present/IMPORT_AUDIT.json"));
  const copiedNew = importAudit.mappings.filter((mapping) => mapping.disposition === "copied-new").length;
  const reused = importAudit.mappings.filter((mapping) => mapping.disposition === "reused-identical-existing-pdf").length;
  const requiredFields = Object.keys(payload.audit.required_field_coverage || {});
  const requiredCoverage = Object.fromEntries(requiredFields.map((field) => [field, records.filter((record) => hasValue(record[field])).length]));
  payload.generated_on = new Date().toISOString();
  payload.audit = {
    ...payload.audit,
    records: records.length,
    pdf_available: records.filter((record) => String(record.pdf_availability).toLowerCase() === "available").length,
    pdf_verified: records.filter((record) => HASH.test(String(record.pdf_sha256 || "").toLowerCase()) && Number(record.pdf_bytes) > 0).length,
    model_maps: modelMaps,
    literature_records: literature,
    independently_audited: modelMaps,
    imported_scope_reviewed: literature,
    with_bibkey: records.filter((record) => hasValue(record.bibkey)).length,
    source_manifest_records: records.length - modelMaps + reused,
    source_manifest_overlaps: reused,
    source_manifest_new_records: copiedNew,
    journal_counts: countBy(records, (record) => record.journal_code),
    year_counts: countBy(records, (record) => record.year),
    first_online_year_counts: countBy(records, (record) => String(record.published_online || record.year).slice(0, 4)),
    primary_topic_counts: countBy(records, (record) => record.primary_topic),
    detail_level_counts: countBy(records, (record) => record.detail_level),
    review_status_counts: countBy(records, (record) => record.review_status),
    scope_counts: countBy(records, (record) => record.scope),
    required_field_coverage: requiredCoverage,
    objective_formulas_asserted: records.filter((record) => hasValue(record.objective?.formula)).length,
    objective_formulas_pdf_verified: records.filter((record) => hasValue(record.objective?.formula)
      && /pdf-verified/i.test(String(record.objective?.status || ""))).length,
    formula_note: `Representative formulas are shown only for the ${modelMaps} independently mapped records; evidence-indexed literature records do not invent formulas or unmapped model elements.`
  };
  payload.provenance = {
    ...payload.provenance,
    note: `All ${records.length.toLocaleString("en-US")} records have a locally verified main PDF. The original ${modelMaps} records retain independently audited deep model maps; ${literature.toLocaleString("en-US")} imported records expose scope-review evidence and abstracts without claiming a complete independent model reconstruction.`
  };
  await atomicWriteJson(filename, payload);
}

export async function pruneImportMetadata(root, plan) {
  const expectedManifestRemoval = Number.isInteger(plan.expectedRemoval?.importManifestRecords)
    ? plan.expectedRemoval.importManifestRecords
    : plan.paperIds.length;
  const expectedAuditRemoval = Number.isInteger(plan.expectedRemoval?.importAuditMappings)
    ? plan.expectedRemoval.importAuditMappings
    : plan.paperIds.length;
  const manifestPath = resolveLive(root, "data/imports/atlas_literature_2016_present/final_included_manifest.json");
  const imported = await readJson(manifestPath);
  const manifestBefore = imported.records.length;
  imported.records = imported.records.filter((record) => !plan.records.some((retired) => importEntryMatchesRecord(record, retired)));
  const manifestRemoved = manifestBefore - imported.records.length;
  assert(manifestRemoved === 0 || manifestRemoved === expectedManifestRemoval,
    `Import manifest removed ${manifestRemoved}, expected 0 or ${expectedManifestRemoval}`);
  assert(imported.records.length === plan.expectedAfter.importManifestRecords,
    `Import manifest count is ${imported.records.length}, expected ${plan.expectedAfter.importManifestRecords}`);
  imported.count = imported.records.length;
  imported.generated_at = new Date().toISOString();
  await atomicWriteJson(manifestPath, imported);

  const auditPath = resolveLive(root, "data/imports/atlas_literature_2016_present/IMPORT_AUDIT.json");
  const audit = await readJson(auditPath);
  const auditBefore = audit.mappings.length;
  audit.mappings = audit.mappings.filter((mapping) => !plan.records.some((retired) => importEntryMatchesRecord(mapping, retired)));
  const auditRemoved = auditBefore - audit.mappings.length;
  assert(auditRemoved === 0 || auditRemoved === expectedAuditRemoval,
    `Import audit removed ${auditRemoved}, expected 0 or ${expectedAuditRemoval}`);
  const expectedAuditMappings = Number.isInteger(plan.expectedAfter.importAuditMappings)
    ? plan.expectedAfter.importAuditMappings
    : plan.expectedAfter.importManifestRecords;
  assert(audit.mappings.length === expectedAuditMappings,
    `Import audit count is ${audit.mappings.length}, expected ${expectedAuditMappings}`);
  const reused = audit.mappings.filter((mapping) => mapping.disposition === "reused-identical-existing-pdf").length;
  const copied = audit.mappings.filter((mapping) => mapping.disposition === "copied-new").length;
  audit.generated_at = new Date().toISOString();
  audit.source_manifest_records = audit.mappings.length;
  audit.reused_identical_existing_records = reused;
  audit.copied_new_records = copied;
  audit.target_records = plan.expectedAfter.records;
  audit.target_pdf_files = plan.expectedAfter.records;
  audit.source_hashes_verified = audit.mappings.length;
  audit.target_hashes_verified = plan.expectedAfter.records;
  audit.orphan_target_pdfs = [];
  audit.missing_target_pdfs = [];
  audit.mapping_status = "passed";
  await atomicWriteJson(auditPath, audit);
}

async function pruneBibliography(root, plan) {
  const filename = resolveLive(root, "reference.bib");
  const text = await readFile(filename, "utf8");
  const starts = [...text.matchAll(/^@[A-Za-z]+\{([^,\r\n]+),/gm)];
  assert(starts.length >= plan.expectedAfter.records, `Bibliography has too few entries: ${starts.length}`);
  const keys = new Set(plan.records.map((record) => record.bibkey));
  let output = text.slice(0, starts[0]?.index || 0);
  let removed = 0;
  for (const [index, match] of starts.entries()) {
    const end = starts[index + 1]?.index ?? text.length;
    const chunk = text.slice(match.index, end);
    if (keys.has(match[1])) removed += 1;
    else output += chunk;
  }
  assert(removed === 0 || removed === keys.size, `Bibliography removed ${removed}, expected 0 or ${keys.size}`);
  const remaining = [...output.matchAll(/^@[A-Za-z]+\{([^,\r\n]+),/gm)];
  assert(remaining.length === plan.expectedAfter.records, `Bibliography count is ${remaining.length}, expected ${plan.expectedAfter.records}`);
  await atomicWrite(filename, output.endsWith("\n") ? output : `${output}\n`);
}

async function pruneVisualSample(root, plan) {
  const filename = resolveLive(root, "research/extraction-qa-visual-sample.v1.json");
  if (!await exists(filename)) return;
  const payload = await readJson(filename);
  const ids = new Set(plan.paperIds);
  payload.entries = (payload.entries || []).filter((entry) => !ids.has(entry.paperId));
  payload.corpus.records = plan.expectedAfter.records;
  payload.corpus.fallbackSelected = plan.expectedAfter.fallbackSelected;
  payload.corpus.parserWarnings = plan.expectedAfter.visualParserWarnings;
  payload.conclusion = "The retained anomaly-stratified sample supports the same fail-closed policy: hash-bound visual review may resolve a parser-warning extraction, while unreviewed warnings remain ineligible for public release. Retired papers are outside the current corpus and this sample.";
  await atomicWriteJson(filename, payload);
}

async function pruneVisualScopeReport(root, plan) {
  const filename = resolveLive(root, "research/ledger/extraction-visual-scope-review.v1.json");
  if (!await exists(filename)) return;
  const payload = await readJson(filename);
  const ids = new Set(plan.paperIds);
  payload.entries = (payload.entries || []).filter((entry) => !ids.has(entry.paperId));
  const entries = payload.entries;
  payload.scope = `Historical authoring-scope review retained for the ${entries.length} current-corpus extractions that were reviewed before later hash-bound QA acceptance.`;
  const bindingLines = [...entries]
    .sort((a, b) => a.paperId.localeCompare(b.paperId))
    .map((entry) => `${entry.paperId}\t${entry.sourcePdf.sha256}\t${entry.productionExtraction.pagesSha256}\t${entry.productionExtraction.textSha256}\n`)
    .join("");
  payload.restartSafety.bindingSetSha256 = sha256(bindingLines);
  payload.accounting = {
    expectedEntries: entries.length,
    recordedEntries: entries.length,
    uniquePaperIds: new Set(entries.map((entry) => entry.paperId)).size,
    hashBoundEntries: entries.filter((entry) => HASH.test(entry.sourcePdf?.sha256 || "")
      && HASH.test(entry.productionExtraction?.pagesSha256 || "")
      && HASH.test(entry.productionExtraction?.textSha256 || "")
      && HASH.test(entry.qaDecision?.sha256 || "")).length,
    needsReviewEntries: entries.filter((entry) => entry.reviewDisposition === "needs_review").length,
    proseAuthoringAllowedEntries: entries.filter((entry) => entry.proseAuthoringAllowed === true).length,
    formalMathAllowedEntries: entries.filter((entry) => entry.formalMathAllowed === true).length,
    structuredFigureTableAllowedEntries: entries.filter((entry) => entry.structuredFigureTableAllowed === true).length
  };
  await atomicWriteJson(filename, payload);
  const reportSha256 = (await hashFile(filename)).sha256;
  for (const entry of entries) {
    const safeMapPath = resolveLive(root, `research/model-note-safe-maps/v1/${entry.paperId}.json`);
    if (!await exists(safeMapPath)) continue;
    const safeMap = await readJson(safeMapPath);
    if (safeMap.visualScopeReview?.path === "research/ledger/extraction-visual-scope-review.v1.json") {
      safeMap.visualScopeReview.sha256 = reportSha256;
      await atomicWriteJson(safeMapPath, safeMap);
    }
  }
}

async function movePlannedEntries(root, quarantine, plan) {
  for (const entry of [...plan.moveEntries].sort((a, b) => b.relativePath.length - a.relativePath.length)) {
    const source = resolveLive(root, entry.relativePath);
    const destination = resolveQuarantine(quarantine, `retired/${entry.relativePath}`);
    const sourceExists = await exists(source);
    const destinationExists = await exists(destination);
    assert(!(sourceExists && destinationExists), `Both live and quarantined paths exist: ${entry.relativePath}`);
    if (sourceExists) {
      const observed = await describePath(root, entry.relativePath);
      assert(observed.type === entry.type && observed.sha256 === entry.sha256 && observed.bytes === entry.bytes, `Live retirement artifact changed since prepare: ${entry.relativePath}`);
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(source, destination);
    } else {
      assert(destinationExists, `Retirement artifact is absent from both live and quarantine trees: ${entry.relativePath}`);
    }
    const quarantined = await describeQuarantinedPath(quarantine, entry);
    assert(quarantined.type === entry.type && quarantined.sha256 === entry.sha256 && quarantined.bytes === entry.bytes, `Quarantined artifact verification failed: ${entry.relativePath}`);
  }
}

async function apply(options) {
  const planPath = path.join(options.quarantine, PLAN_NAME);
  const plan = await readJson(planPath);
  assert(path.resolve(plan.atlasRoot) === path.resolve(options.root), "Retirement plan belongs to a different Atlas root");
  assert(path.resolve(plan.quarantineRoot) === path.resolve(options.quarantine), "Retirement plan belongs to a different quarantine root");
  assert(["prepared", "applied"].includes(plan.status), `Cannot apply a plan in status ${plan.status}`);

  await pruneImportMetadata(options.root, plan);
  await pruneCatalog(options.root, plan);
  await pruneBibliography(options.root, plan);
  await pruneVisualSample(options.root, plan);
  await pruneVisualScopeReport(options.root, plan);
  plan.progress.aggregateMetadataPruned = true;
  await atomicWriteJson(planPath, plan);

  await movePlannedEntries(options.root, options.quarantine, plan);
  plan.progress.liveArtifactsMoved = true;
  plan.status = "applied";
  plan.appliedAt = plan.appliedAt || new Date().toISOString();
  await atomicWriteJson(planPath, plan);
  console.log(JSON.stringify({
    command: "apply",
    status: plan.status,
    paperCount: plan.paperIds.length,
    aggregateMetadataPruned: plan.progress.aggregateMetadataPruned,
    liveArtifactsMoved: plan.progress.liveArtifactsMoved,
    quarantine: options.quarantine
  }, null, 2));
}

export async function verifyArchiveContents(quarantine) {
  const planPath = path.join(quarantine, PLAN_NAME);
  assert(await exists(planPath), `Retirement plan is missing: ${planPath}`);
  const plan = await readJson(planPath);
  assert(Array.isArray(plan.paperIds) && Array.isArray(plan.records), "Retirement plan paper records are invalid");
  assert(plan.paperIds.length === plan.records.length, "Retirement plan paper ID/record counts differ");
  assert(Array.isArray(plan.moveEntries), "Retirement plan moveEntries are invalid");
  assert(Array.isArray(plan.backups), "Retirement plan backups are invalid");

  const movePaths = new Set();
  let expectedMoveFiles = 0;
  let expectedMoveBytes = 0;
  for (const entry of plan.moveEntries) {
    assert(entry && typeof entry.relativePath === "string" && entry.relativePath, "Retirement move entry has no path");
    assert(!movePaths.has(entry.relativePath), `Duplicate retirement move entry: ${entry.relativePath}`);
    movePaths.add(entry.relativePath);
    assert(entry.type === "file" || entry.type === "directory", `Invalid retirement move entry type: ${entry.relativePath}`);
    assert(HASH.test(String(entry.sha256 || "")), `Invalid retirement move entry hash: ${entry.relativePath}`);
    assert(Number.isInteger(entry.bytes) && entry.bytes >= 0, `Invalid retirement move entry byte count: ${entry.relativePath}`);
    if (entry.type === "directory") {
      assert(Number.isInteger(entry.fileCount) && entry.fileCount >= 0, `Invalid retirement directory file count: ${entry.relativePath}`);
      expectedMoveFiles += entry.fileCount;
    } else expectedMoveFiles += 1;
    expectedMoveBytes += entry.bytes;
    const observed = await describeQuarantinedPath(quarantine, entry);
    assert(observed.type === entry.type && observed.sha256 === entry.sha256 && observed.bytes === entry.bytes,
      `Quarantine digest mismatch: ${entry.relativePath}`);
    if (entry.type === "directory") {
      assert(observed.fileCount === entry.fileCount, `Quarantine file count mismatch: ${entry.relativePath}`);
    }
  }

  const retiredRoot = path.join(quarantine, "retired");
  const retiredFiles = await exists(retiredRoot) ? await walkFiles(retiredRoot) : [];
  assert(retiredFiles.length === expectedMoveFiles,
    `Quarantine retired-file count is ${retiredFiles.length}, expected ${expectedMoveFiles}`);
  let observedMoveBytes = 0;
  for (const member of retiredFiles) observedMoveBytes += (await stat(path.join(retiredRoot, ...member.split("/")))).size;
  assert(observedMoveBytes === expectedMoveBytes,
    `Quarantine retired-byte count is ${observedMoveBytes}, expected ${expectedMoveBytes}`);

  const backupPaths = new Set();
  let expectedBackupBytes = 0;
  for (const backup of plan.backups) {
    assert(backup && typeof backup.relativePath === "string" && backup.relativePath, "Retirement backup has no path");
    assert(!backupPaths.has(backup.relativePath), `Duplicate retirement backup: ${backup.relativePath}`);
    backupPaths.add(backup.relativePath);
    assert(HASH.test(String(backup.sha256 || "")), `Invalid retirement backup hash: ${backup.relativePath}`);
    assert(Number.isInteger(backup.bytes) && backup.bytes >= 0, `Invalid retirement backup byte count: ${backup.relativePath}`);
    const observed = await describePath(path.join(quarantine, "baseline"), backup.relativePath);
    assert(observed.type === "file" && observed.sha256 === backup.sha256 && observed.bytes === backup.bytes,
      `Baseline backup digest mismatch: ${backup.relativePath}`);
    expectedBackupBytes += backup.bytes;
  }
  const baselineRoot = path.join(quarantine, "baseline");
  const baselineFiles = await exists(baselineRoot) ? await walkFiles(baselineRoot) : [];
  assert(baselineFiles.length === plan.backups.length,
    `Quarantine baseline-file count is ${baselineFiles.length}, expected ${plan.backups.length}`);
  let observedBackupBytes = 0;
  for (const member of baselineFiles) observedBackupBytes += (await stat(path.join(baselineRoot, ...member.split("/")))).size;
  assert(observedBackupBytes === expectedBackupBytes,
    `Quarantine baseline-byte count is ${observedBackupBytes}, expected ${expectedBackupBytes}`);

  return {
    plan,
    planPath,
    moveEntries: plan.moveEntries.length,
    retiredFiles: expectedMoveFiles,
    retiredBytes: expectedMoveBytes,
    backups: plan.backups.length,
    backupBytes: expectedBackupBytes
  };
}

async function verifyArchive(options) {
  const result = await verifyArchiveContents(options.quarantine);
  console.log(JSON.stringify({
    command: "verify-archive",
    status: "verified",
    operation: result.plan.operation,
    paperCount: result.plan.paperIds.length,
    moveEntries: result.moveEntries,
    retiredFiles: result.retiredFiles,
    retiredBytes: result.retiredBytes,
    backups: result.backups,
    backupBytes: result.backupBytes,
    recoveryPlan: result.planPath
  }, null, 2));
}

async function verify(options) {
  const archive = await verifyArchiveContents(options.quarantine);
  const { plan, planPath } = archive;
  const catalog = await readJson(resolveLive(options.root, "data/atlas_articles.json"));
  const ids = new Set(plan.paperIds);
  const liveCatalogIds = catalog.records.filter((record) => ids.has(record.id)).map((record) => record.id);
  assert(liveCatalogIds.length === 0, `Retired IDs remain in the catalog: ${liveCatalogIds.join(", ")}`);
  assert(catalog.records.length === plan.expectedAfter.records, `Catalog count is ${catalog.records.length}, expected ${plan.expectedAfter.records}`);
  for (const entry of plan.moveEntries) {
    const liveExists = await exists(resolveLive(options.root, entry.relativePath));
    if (liveExists) {
      assert(REBUILDABLE_AFTER_RETIREMENT.has(entry.relativePath), `Retired artifact remains live: ${entry.relativePath}`);
      const replacement = await describePath(options.root, entry.relativePath);
      assert(replacement.sha256 !== entry.sha256,
        `Rebuildable path still contains the retired artifact bytes: ${entry.relativePath}`);
    }
  }
  const bibliography = await readFile(resolveLive(options.root, "reference.bib"), "utf8");
  for (const record of plan.records) assert(!bibliography.includes(`{${record.bibkey},`), `Retired bibliography entry remains: ${record.bibkey}`);
  const imported = await readJson(resolveLive(options.root, "data/imports/atlas_literature_2016_present/final_included_manifest.json"));
  assert(imported.count === imported.records.length && imported.count === plan.expectedAfter.importManifestRecords, `Import manifest count is ${imported.count}, expected ${plan.expectedAfter.importManifestRecords}`);

  const [catalogJs, manifest, publicNotes, publicNotesJs] = await Promise.all([
    readAssignmentJson(resolveLive(options.root, "data/atlas_articles.js"), "globalThis.AtlasArticleSnapshot"),
    readJson(resolveLive(options.root, "research/corpus/manifest.v1.json")),
    readJson(resolveLive(options.root, "data/model_notes.json")),
    readAssignmentJson(resolveLive(options.root, "data/model_notes.js"), "window.AtlasModelNotes")
  ]);
  const activeSurfaces = [
    ["catalog JSON", catalog.records],
    ["catalog JS", catalogJs.records],
    ["corpus manifest records", manifest.records],
    ["import manifest records", imported.records],
    ["public model-note JSON", publicNotes.papers],
    ["public model-note JS", publicNotesJs.papers]
  ];
  for (const [label, records] of activeSurfaces) assertNoRetiredRecords(label, records, plan.records);
  assertSameRecordIds("catalog JSON/catalog JS", catalog.records, catalogJs.records);
  assertSameRecordIds("catalog JSON/corpus manifest", catalog.records, manifest.records);
  assertSameRecordIds("catalog JSON/public model-note JSON", catalog.records, publicNotes.papers);
  assertSameRecordIds("public model-note JSON/public model-note JS", publicNotes.papers, publicNotesJs.papers);

  const candidateJsonPath = resolveLive(options.root, "data/notes/release-candidate/model_notes.json");
  const candidateJsPath = resolveLive(options.root, "data/notes/release-candidate/model_notes.js");
  const candidateJsonExists = await exists(candidateJsonPath);
  const candidateJsExists = await exists(candidateJsPath);
  assert(candidateJsonExists === candidateJsExists, "Release-candidate JSON/JS pair is incomplete");
  let candidateModelNotes = 0;
  if (candidateJsonExists) {
    const [candidate, candidateJs] = await Promise.all([
      readJson(candidateJsonPath),
      readAssignmentJson(candidateJsPath, "window.AtlasModelNotes")
    ]);
    candidateModelNotes = candidate.papers.length;
    assertNoRetiredRecords("candidate model-note JSON", candidate.papers, plan.records);
    assertNoRetiredRecords("candidate model-note JS", candidateJs.papers, plan.records);
    assertSameRecordIds("catalog JSON/candidate model-note JSON", catalog.records, candidate.papers);
    assertSameRecordIds("candidate model-note JSON/candidate model-note JS", candidate.papers, candidateJs.papers);
  }
  console.log(JSON.stringify({
    command: "verify",
    status: "verified",
    paperCount: plan.paperIds.length,
    catalogRecords: catalog.records.length,
    publicModelNotes: publicNotes.papers.length,
    candidateModelNotes,
    quarantinedEntries: plan.moveEntries.length,
    quarantinedFiles: archive.retiredFiles,
    backups: archive.backups,
    recoveryPlan: planPath
  }, null, 2));
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.command === "help") {
    console.log("Usage: node scripts/retire-papers.mjs prepare --ids ID[,ID...] --quarantine DIR [--root DIR] [--operation NAME]\n       node scripts/retire-papers.mjs apply --quarantine DIR [--root DIR]\n       node scripts/retire-papers.mjs checkpoint --quarantine DIR --step workbookPruned|publicDataPromoted|readinessPassed [--root DIR]\n       node scripts/retire-papers.mjs verify --quarantine DIR [--root DIR]\n       node scripts/retire-papers.mjs verify-archive --quarantine DIR");
    return;
  }
  if (options.command === "prepare") await prepare(options);
  else if (options.command === "apply") await apply(options);
  else if (options.command === "checkpoint") await checkpoint(options);
  else if (options.command === "verify-archive") await verifyArchive(options);
  else await verify(options);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
