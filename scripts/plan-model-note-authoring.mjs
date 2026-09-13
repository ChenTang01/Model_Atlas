import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EXTRACTION_QA_BINDING_KEYS } from "./extraction-qa.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = "research/ledger/authoring-plan.release-v20.json";
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_JOBS = 8;
const PLAN_SCHEMA_VERSION = 2;
const AUTHORING_ENTRY = "scripts/author-model-notes.mjs";
const PLANNER_ENTRY = "scripts/plan-model-note-authoring.mjs";
const INPUT_FILES = [
  "data/atlas_articles.json",
  "mini-atlas/data/atlas.json",
  "research/corpus/manifest.v1.json"
];
const SAFE_MAP_DIRECTORY = "research/model-note-safe-maps/v1";

export const CURATED_EDITORIAL_IDENTITY_VERSION = "curated-editorial-seed-v1";
const CURATED_MUTABLE_ENVELOPE_KEYS = new Set([
  "extractionPagesSha256",
  "conceptRegistrySha256",
  "inputDigest",
  ...EXTRACTION_QA_BINDING_KEYS
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export const stableStringify = (value) => JSON.stringify(stableValue(value));

function portable(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function compareIds(left, right) {
  return left.localeCompare(right);
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export function parseCli(argv) {
  const options = {
    root: "",
    output: DEFAULT_OUTPUT,
    batchSize: null,
    jobs: null,
    logDirectory: "",
    check: false,
    json: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      return value;
    };
    if (argument === "--root") options.root = take();
    else if (argument === "--output") options.output = take();
    else if (argument === "--batch-size") options.batchSize = positiveInteger(take(), "--batch-size");
    else if (argument === "--jobs") options.jobs = positiveInteger(take(), "--jobs");
    else if (argument === "--log-dir") options.logDirectory = take();
    else if (argument === "--check") options.check = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function resolveWithinRoot(root, requestedPath, label) {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) throw new Error(`${label} must not be blank`);
  const resolved = path.resolve(root, requestedPath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the project root`);
  }
  return { absolute: resolved, relative: portable(relative) };
}

async function readJsonWithBytes(filename, label) {
  const bytes = await readFile(filename);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  return { bytes, value };
}

function fileIdentity(root, filename, bytes) {
  return {
    path: portable(path.relative(root, filename)),
    bytes: bytes.length,
    sha256: sha256(bytes)
  };
}

function localModuleSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of [
    /\bfrom\s+["'](\.[^"']+)["']/g,
    /\bimport\s*["'](\.[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g
  ]) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

async function resolveLocalModule(importer, specifier) {
  const candidate = path.resolve(path.dirname(importer), specifier);
  const attempts = path.extname(candidate) ? [candidate] : [candidate, `${candidate}.mjs`, `${candidate}.js`];
  for (const attempt of attempts) {
    try {
      await readFile(attempt);
      return attempt;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Cannot resolve local authoring dependency ${specifier} from ${importer}`);
}

async function collectCodeIdentities(root) {
  const queue = [path.join(root, AUTHORING_ENTRY)];
  const plannerPath = path.join(root, PLANNER_ENTRY);
  const visited = new Map();
  while (queue.length) {
    const filename = path.resolve(queue.shift());
    if (visited.has(filename)) continue;
    const relative = path.relative(root, filename);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Authoring dependency escapes the project root: ${filename}`);
    }
    const bytes = await readFile(filename);
    visited.set(filename, bytes);
    const source = bytes.toString("utf8");
    for (const specifier of localModuleSpecifiers(source)) {
      queue.push(await resolveLocalModule(filename, specifier));
    }
  }
  if (!visited.has(plannerPath)) visited.set(plannerPath, await readFile(plannerPath));
  return [...visited.entries()]
    .map(([filename, bytes]) => fileIdentity(root, filename, bytes))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function uniqueIds(records, label, field = "id") {
  if (!Array.isArray(records)) throw new Error(`${label} must be an array`);
  const ids = [];
  const seen = new Set();
  for (const [index, record] of records.entries()) {
    const id = String(record?.[field] || "").trim();
    if (!id) throw new Error(`${label}[${index}].${field} is blank`);
    if (seen.has(id)) throw new Error(`${label} contains duplicate ${field}: ${id}`);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function collectCuratedInputs(root, selectedIds) {
  const notesDirectory = path.join(root, "data", "notes", "papers");
  let names = [];
  try {
    names = await readdir(notesDirectory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const selected = new Set(selectedIds);
  const curated = [];
  for (const name of names.filter((value) => value.endsWith(".json")).sort()) {
    const filename = path.join(notesDirectory, name);
    const bytes = await readFile(filename);
    if (!bytes.includes(Buffer.from('"authoringMode"'))) continue;
    let envelope;
    try {
      envelope = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`Potential curated note is not valid JSON (${portable(path.relative(root, filename))}): ${error.message}`);
    }
    if (envelope?.authoringMode !== "curated") continue;
    const paperId = String(envelope.paperId || "").trim();
    if (!selected.has(paperId)) continue;
    if (path.basename(name, ".json") !== paperId) {
      throw new Error(`Curated note filename does not match paperId: ${name} vs ${paperId}`);
    }
    const editorialEnvelope = Object.fromEntries(Object.entries(envelope)
      .filter(([key]) => key !== "note" && !CURATED_MUTABLE_ENVELOPE_KEYS.has(key)));
    const { provenance: _operationalProvenance, ...editorialNote } = envelope.note || {};
    const editorialPayload = {
      ...editorialEnvelope,
      note: editorialNote
    };
    curated.push({
      paperId,
      path: portable(path.relative(root, filename)),
      identityVersion: CURATED_EDITORIAL_IDENTITY_VERSION,
      editorialPayloadSha256: sha256(stableStringify({
        identityVersion: CURATED_EDITORIAL_IDENTITY_VERSION,
        editorialPayload
      }))
    });
  }
  return curated.sort((left, right) => left.paperId.localeCompare(right.paperId));
}

async function collectSafeMapInputs(root, selectedIds) {
  const directory = path.join(root, ...SAFE_MAP_DIRECTORY.split("/"));
  let names = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return { safeMaps: [], reviewReports: [] };
    throw error;
  }
  const selected = new Set(selectedIds);
  const safeMaps = [];
  const reportsByPath = new Map();
  for (const name of names.filter((value) => value.endsWith(".json")).sort()) {
    const filename = path.join(directory, name);
    const { bytes, value: spec } = await readJsonWithBytes(filename, `safe-map input ${name}`);
    const paperId = String(spec?.paperId || "").trim();
    if (!paperId || !selected.has(paperId)) continue;
    if (path.basename(name, ".json") !== paperId) {
      throw new Error(`Safe-map filename does not match paperId: ${name} vs ${paperId}`);
    }
    safeMaps.push({ paperId, ...fileIdentity(root, filename, bytes) });

    const reportPath = resolveWithinRoot(root, spec?.visualScopeReview?.path || "", `${paperId} visual-scope report path`);
    if (!reportsByPath.has(reportPath.relative)) {
      const reportBytes = await readFile(reportPath.absolute);
      reportsByPath.set(reportPath.relative, fileIdentity(root, reportPath.absolute, reportBytes));
    }
  }
  safeMaps.sort((left, right) => left.paperId.localeCompare(right.paperId));
  const reviewReports = [...reportsByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  return { safeMaps, reviewReports };
}

function idListSha256(ids) {
  return sha256(`${ids.join("\n")}\n`);
}

function commandForBatch(batch, jobs, force = false) {
  const forceFlag = force ? " --force" : "";
  return `node ${AUTHORING_ENTRY} --from ${JSON.stringify(batch.fromId)} --limit ${batch.limit} --jobs ${jobs} --json${forceFlag}`;
}

function buildBatches(paperIds, batchSize, jobs, logDirectory) {
  const width = String(Math.ceil(paperIds.length / batchSize)).length;
  const batches = [];
  for (let offset = 0; offset < paperIds.length; offset += batchSize) {
    const ids = paperIds.slice(offset, offset + batchSize);
    const ordinal = batches.length + 1;
    const label = `batch-${String(ordinal).padStart(Math.max(2, width), "0")}`;
    const batch = {
      ordinal,
      phase: ordinal === 1 ? "bootstrap" : "parallel-after-bootstrap",
      startIndex: offset,
      endIndexExclusive: offset + ids.length,
      fromId: ids[0],
      throughId: ids.at(-1),
      limit: ids.length,
      paperIdsSha256: idListSha256(ids),
      logPath: `${logDirectory}/${label}.log`,
      exitCodePath: `${logDirectory}/${label}.exit-code.txt`,
      resultPath: `${logDirectory}/${label}.result.json`
    };
    batch.command = commandForBatch(batch, jobs);
    batch.forceRetryCommand = commandForBatch(batch, jobs, true);
    batches.push(batch);
  }
  return batches;
}

function assertBatchCoverage(plan) {
  const paperIds = plan.paperIds;
  if (!Array.isArray(paperIds) || !paperIds.length) throw new Error("Authoring plan must contain paper IDs");
  let cursor = 0;
  for (const [index, batch] of plan.batches.entries()) {
    if (batch.ordinal !== index + 1 || batch.startIndex !== cursor || batch.endIndexExclusive !== cursor + batch.limit) {
      throw new Error(`Authoring plan batch ${index + 1} is not contiguous`);
    }
    const ids = paperIds.slice(batch.startIndex, batch.endIndexExclusive);
    if (ids.length !== batch.limit || ids[0] !== batch.fromId || ids.at(-1) !== batch.throughId) {
      throw new Error(`Authoring plan batch ${index + 1} boundaries do not match its paper IDs`);
    }
    if (batch.paperIdsSha256 !== idListSha256(ids)) throw new Error(`Authoring plan batch ${index + 1} ID hash is stale`);
    cursor = batch.endIndexExclusive;
  }
  if (cursor !== paperIds.length) throw new Error("Authoring plan batches do not cover the complete paper-ID manifest");
  if (new Set(paperIds).size !== paperIds.length) throw new Error("Authoring plan contains duplicate paper IDs");
  if (plan.paperIdsSha256 !== idListSha256(paperIds)) throw new Error("Authoring plan paper-ID hash is stale");
}

function planDigest(plan) {
  const { planSha256: _ignored, ...basis } = plan;
  return sha256(stableStringify(basis));
}

function finalizePlan(basis) {
  const plan = { ...basis, planSha256: "" };
  plan.planSha256 = planDigest(plan);
  assertBatchCoverage(plan);
  return plan;
}

export async function buildPlan({ root = DEFAULT_ROOT, batchSize = DEFAULT_BATCH_SIZE, jobs = DEFAULT_JOBS, logDirectory = "" } = {}) {
  root = path.resolve(root);
  batchSize = positiveInteger(batchSize, "batchSize");
  jobs = positiveInteger(jobs, "jobs");
  const inputPayloads = await Promise.all(INPUT_FILES.map(async (relativePath) => {
    const filename = path.join(root, ...relativePath.split("/"));
    const payload = await readJsonWithBytes(filename, relativePath);
    return { relativePath, filename, ...payload };
  }));
  const byPath = new Map(inputPayloads.map((entry) => [entry.relativePath, entry]));
  const catalog = byPath.get(INPUT_FILES[0]).value;
  const mini = byPath.get(INPUT_FILES[1]).value;
  const manifest = byPath.get(INPUT_FILES[2]).value;
  const catalogIds = uniqueIds(catalog.records, "catalog.records");
  const miniSourceIds = uniqueIds(mini.papers, "mini.papers", "sourceId").sort(compareIds);
  const catalogIdSet = new Set(catalogIds);
  for (const id of miniSourceIds) {
    if (!catalogIdSet.has(id)) throw new Error(`Frozen Mini sourceId is absent from the catalog: ${id}`);
  }
  const miniIdSet = new Set(miniSourceIds);
  const paperIds = catalogIds.filter((id) => !miniIdSet.has(id)).sort(compareIds);
  if (!paperIds.length) throw new Error("Catalog contains no non-Mini papers to author");
  const manifestIds = new Set(uniqueIds(manifest.records, "manifest.records"));
  const absentFromManifest = paperIds.filter((id) => !manifestIds.has(id));
  if (absentFromManifest.length) {
    throw new Error(`Non-Mini catalog papers are absent from the corpus manifest: ${absentFromManifest.slice(0, 5).join(", ")}`);
  }

  const inputFiles = inputPayloads
    .map((entry) => fileIdentity(root, entry.filename, entry.bytes))
    .sort((left, right) => left.path.localeCompare(right.path));
  const [codeFiles, curatedNotes, safeMapInputs] = await Promise.all([
    collectCodeIdentities(root),
    collectCuratedInputs(root, paperIds),
    collectSafeMapInputs(root, paperIds)
  ]);
  const frozenInputs = {
    inputFiles,
    codeFiles,
    curatedNotes,
    curatedNotesPolicy: {
      identityVersion: CURATED_EDITORIAL_IDENTITY_VERSION,
      editorialPayload: "all envelope fields except mutable bindings; note excludes note.provenance",
      mutableEnvelopeFields: [...CURATED_MUTABLE_ENVELOPE_KEYS].sort(),
      mutableNoteFields: ["provenance"],
      checkpointArtifacts: "not frozen; receipts bind the plan and per-paper checkpoints are independently verified"
    },
    safeMaps: safeMapInputs.safeMaps,
    safeMapReviewReports: safeMapInputs.reviewReports,
    safeMapPolicy: {
      directory: SAFE_MAP_DIRECTORY,
      identity: "exact file bytes; every referenced visual-scope report is frozen once by path",
      checkpointArtifacts: "not frozen; authoring revalidates each map against current extraction QA and page bytes"
    },
    catalogCount: catalogIds.length,
    miniCount: miniSourceIds.length,
    nonMiniCount: paperIds.length,
    miniSourceIds,
    miniSourceIdsSha256: idListSha256(miniSourceIds),
    paperIdsSha256: idListSha256(paperIds)
  };
  const freezeSha256 = sha256(stableStringify(frozenInputs));
  const defaultLogDirectory = `research/ledger/logs/model-note-authoring/${freezeSha256.slice(0, 16)}`;
  const resolvedLogDirectory = resolveWithinRoot(root, logDirectory || defaultLogDirectory, "log directory").relative;
  const batches = buildBatches(paperIds, batchSize, jobs, resolvedLogDirectory);
  return finalizePlan({
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "restartable-model-note-authoring-plan",
    authoringEntry: AUTHORING_ENTRY,
    selection: "all catalog records excluding frozen Mini sourceIds",
    configuration: {
      batchSize,
      jobsPerProcess: jobs,
      maxConcurrentProcessesAfterBootstrap: 2,
      logDirectory: resolvedLogDirectory
    },
    frozenInputs,
    freezeSha256,
    paperIdsSha256: frozenInputs.paperIdsSha256,
    paperIds,
    batches
  });
}

async function atomicWriteJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const current = await readFile(filename, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  if (current === content) return false;
  const temporary = `${filename}.${process.pid}-${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, filename);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return true;
}

async function loadExistingPlan(filename) {
  const { value } = await readJsonWithBytes(filename, portable(filename));
  if (value?.schemaVersion !== PLAN_SCHEMA_VERSION || value?.kind !== "restartable-model-note-authoring-plan") {
    throw new Error("Existing authoring plan has an unsupported schema or kind");
  }
  assertBatchCoverage(value);
  const actualDigest = planDigest(value);
  if (value.planSha256 !== actualDigest) throw new Error("Existing authoring plan SHA-256 is invalid");
  return value;
}

function firstDifference(existing, expected) {
  if (stableStringify(existing.frozenInputs?.curatedNotes) !== stableStringify(expected.frozenInputs?.curatedNotes)) {
    return "curated editorial seed changed";
  }
  if (stableStringify(existing.frozenInputs?.safeMaps) !== stableStringify(expected.frozenInputs?.safeMaps)
    || stableStringify(existing.frozenInputs?.safeMapReviewReports) !== stableStringify(expected.frozenInputs?.safeMapReviewReports)) {
    return "reviewed safe-map input changed";
  }
  if (existing.freezeSha256 !== expected.freezeSha256) return "frozen authoring inputs changed";
  if (existing.paperIdsSha256 !== expected.paperIdsSha256) return "non-Mini paper-ID manifest changed";
  if (stableStringify(existing.configuration) !== stableStringify(expected.configuration)) return "batch configuration changed";
  return "plan content changed";
}

export async function run(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const output = resolveWithinRoot(root, options.output || DEFAULT_OUTPUT, "output path");
  if (options.check) {
    const existing = await loadExistingPlan(output.absolute);
    const expected = await buildPlan({
      root,
      batchSize: options.batchSize ?? existing.configuration.batchSize,
      jobs: options.jobs ?? existing.configuration.jobsPerProcess,
      logDirectory: options.logDirectory || existing.configuration.logDirectory
    });
    if (stableStringify(existing) !== stableStringify(expected)) {
      throw new Error(`Authoring plan is stale: ${firstDifference(existing, expected)}`);
    }
    return { mode: "check", ok: true, changed: false, outputPath: output.relative, plan: existing };
  }
  const plan = await buildPlan({
    root,
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    jobs: options.jobs ?? DEFAULT_JOBS,
    logDirectory: options.logDirectory || ""
  });
  const changed = await atomicWriteJson(output.absolute, plan);
  return { mode: "write", ok: true, changed, outputPath: output.relative, plan };
}

function usage() {
  return `Usage:
  node scripts/plan-model-note-authoring.mjs [--batch-size N] [--jobs N] [--log-dir PATH] [--output PATH] [--json]
  node scripts/plan-model-note-authoring.mjs --check [--batch-size N] [--jobs N] [--log-dir PATH] [--output PATH] [--json]

The default output is ${DEFAULT_OUTPUT}. Check mode is read-only and, unless a batch option is supplied, validates the saved plan using its recorded batch configuration.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseCli(process.argv.slice(2));
  if (options.help) console.log(usage());
  else run(options).then((result) => {
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      const verb = result.mode === "check" ? "verified" : result.changed ? "written" : "unchanged";
      console.log(`Authoring plan ${verb}: ${result.outputPath}`);
      console.log(`Plan SHA-256: ${result.plan.planSha256}`);
      console.log(`Non-Mini papers: ${result.plan.paperIds.length}; batches: ${result.plan.batches.length}; batch size: ${result.plan.configuration.batchSize}.`);
      console.log(`Run ${result.plan.batches[0].command} by itself to bootstrap the frozen run.`);
    }
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
