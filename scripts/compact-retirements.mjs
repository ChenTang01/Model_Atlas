#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyArchiveContents } from "./retire-papers.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ATLAS_ROOT = path.resolve(SCRIPT_DIR, "..");
const REQUIRED_ATLAS_ROOT = path.resolve("C:\\Users\\TC\\Desktop\\Web\\Atlas");
const RETIRED_ROOT = path.resolve(ATLAS_ROOT, "..", "Atlas-retired");
const REQUIRED_RETIRED_ROOT = path.resolve("C:\\Users\\TC\\Desktop\\Web\\Atlas-retired");
const DEFAULT_LEDGER = "research/corpus/paper-retirements.v1.json";
const LEDGER_KIND = "atlas-paper-retirements-v1";

const ARCHIVES = Object.freeze([
  {
    name: "2026-09-13-extraction-blockers-v1",
    reason: "authoritative extraction blocker removed from the active corpus",
  },
  {
    name: "2026-09-13-pure-empirical-v1",
    reason: "purely empirical paper outside the Atlas modeling scope",
  },
  {
    name: "2026-09-13-release-blocker-v1",
    reason: "unresolved release blocker removed from the active corpus",
  },
]);

const LOCAL_TARGETS = Object.freeze([
  "outputs",
  "research/ledger/workbook-reconciliation-pure-empirical-v1.json",
  "research/ledger/workbook-reconciliation-release-blocker-v1.json",
]);

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function posix(value) {
  return value.split(path.sep).join("/");
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function maybeLstat(filename) {
  try {
    return await lstat(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertPlainDirectory(filename, label) {
  const stat = await lstat(filename);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `${label} must be a plain directory: ${filename}`);
}

async function collectFingerprint(root, current = root, relative = ".", output = []) {
  const stat = await lstat(current);
  assert(!stat.isSymbolicLink(), `Symbolic link rejected while fingerprinting ${current}`);
  if (stat.isFile()) {
    const content = await readFile(current);
    output.push({ path: posix(relative), type: "file", bytes: content.length, sha256: sha256(content) });
    return output;
  }
  assert(stat.isDirectory(), `Unsupported filesystem object: ${current}`);
  output.push({ path: posix(relative), type: "dir" });
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    assert(!entry.isSymbolicLink(), `Symbolic link rejected while fingerprinting ${path.join(current, entry.name)}`);
    await collectFingerprint(root, path.join(current, entry.name), relative === "." ? entry.name : path.join(relative, entry.name), output);
  }
  return output;
}

async function describePath(filename) {
  const stat = await lstat(filename);
  assert(!stat.isSymbolicLink(), `Symbolic link rejected: ${filename}`);
  if (stat.isFile()) {
    const content = await readFile(filename);
    return { type: "file", bytes: content.length, fileCount: 1, sha256: sha256(content) };
  }
  assert(stat.isDirectory(), `Unsupported cleanup target: ${filename}`);
  const entries = await collectFingerprint(filename);
  return {
    type: "dir",
    bytes: entries.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0),
    fileCount: entries.filter((entry) => entry.type === "file").length,
    sha256: sha256(stableStringify(entries)),
  };
}

function sameDescriptor(actual, expected) {
  return ["type", "bytes", "fileCount", "sha256"].every((field) => actual[field] === expected[field]);
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function atomicWriteJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    await handle.close();
  }
  await rename(temporary, filename);
}

function withoutLedgerHash(ledger) {
  const { ledgerSha256: _ignored, ...rest } = ledger;
  return rest;
}

function signLedger(ledger) {
  return { ...ledger, ledgerSha256: sha256(stableStringify(withoutLedgerHash(ledger))) };
}

function validateLedger(ledger) {
  assert(ledger?.schemaVersion === 1 && ledger?.kind === LEDGER_KIND, "Unsupported retirement compaction ledger");
  assert(Array.isArray(ledger.batches) && Array.isArray(ledger.cleanup?.targets), "Retirement ledger is incomplete");
  assert(ledger.ledgerSha256 === sha256(stableStringify(withoutLedgerHash(ledger))), "Retirement ledger integrity hash does not match");
}

function normalizeRetiredRecord(record, batch, reason) {
  return {
    id: record.id,
    doi: record.doi || "",
    bibkey: record.bibkey || "",
    title: record.title || "",
    detailLevel: record.detailLevel || "",
    pdf: {
      filename: record.pdfFile || "",
      sha256: record.pdfSha256 || "",
      bytes: Number(record.pdfBytes || 0),
      pages: Number(record.pdfPageCount || 0),
    },
    retirement: {
      batch,
      reason,
    },
  };
}

async function currentSnapshot(atlasRoot, retiredRecords) {
  const catalogPath = path.join(atlasRoot, "data", "atlas_articles.json");
  const manifestPath = path.join(atlasRoot, "research", "corpus", "manifest.v1.json");
  const workbookPath = path.join(atlasRoot, "atlas_game_theory_articles.xlsx");
  const [catalog, manifest, catalogFile, manifestFile, workbookFile] = await Promise.all([
    readJson(catalogPath),
    readJson(manifestPath),
    describePath(catalogPath),
    describePath(manifestPath),
    describePath(workbookPath),
  ]);
  assert(Array.isArray(catalog.records), "Active catalog has no records array");
  assert(Array.isArray(manifest.records), "Active corpus manifest has no records array");
  const retiredIds = new Set(retiredRecords.map((record) => record.id));
  const retiredPdfHashes = new Set(retiredRecords.map((record) => record.pdf.sha256).filter(Boolean));
  const catalogLeaks = catalog.records.filter((record) => retiredIds.has(record.id)).map((record) => record.id);
  const manifestLeaks = manifest.records.filter((record) => retiredIds.has(record.id) || retiredPdfHashes.has(record.pdf?.sha256 || record.pdfSha256)).map((record) => record.id);
  assert(catalogLeaks.length === 0, `Active catalog still contains retired IDs: ${catalogLeaks.join(", ")}`);
  assert(manifestLeaks.length === 0, `Active manifest still contains retired identities: ${manifestLeaks.join(", ")}`);
  assert(catalog.records.length === manifest.records.length, "Active catalog and manifest record counts differ");
  return {
    records: catalog.records.length,
    catalog: { path: "data/atlas_articles.json", ...catalogFile },
    manifest: { path: "research/corpus/manifest.v1.json", ...manifestFile },
    workbook: { path: "atlas_game_theory_articles.xlsx", ...workbookFile },
  };
}

async function assertSnapshotCurrent(atlasRoot, snapshot, retiredRecords) {
  const current = await currentSnapshot(atlasRoot, retiredRecords);
  assert(current.records === snapshot.records, "Active corpus count changed after retirement compaction was planned");
  for (const key of ["catalog", "manifest", "workbook"]) {
    assert(sameDescriptor(current[key], snapshot[key]), `Active ${key} changed after retirement compaction was planned`);
  }
}

function resolveTarget(atlasRoot, retiredRoot, target) {
  if (target.scope === "retired") {
    assert(ARCHIVES.some((archive) => archive.name === target.path), `Unexpected retired target: ${target.path}`);
    const filename = path.resolve(retiredRoot, target.path);
    assert(isWithin(retiredRoot, filename) && filename !== retiredRoot, `Retired target escapes its root: ${target.path}`);
    return filename;
  }
  assert(target.scope === "atlas" && LOCAL_TARGETS.includes(target.path), `Unexpected Atlas target: ${target.path}`);
  const filename = path.resolve(atlasRoot, ...target.path.split("/"));
  assert(isWithin(atlasRoot, filename) && filename !== atlasRoot, `Atlas target escapes its root: ${target.path}`);
  return filename;
}

async function assertRetiredRootHasOnlyPlannedArchives(retiredRoot, { allowMissing = false } = {}) {
  const stat = await maybeLstat(retiredRoot);
  if (!stat) {
    assert(allowMissing, `Retired root is missing: ${retiredRoot}`);
    return;
  }
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `Retired root is not a plain directory: ${retiredRoot}`);
  const allowed = new Set(ARCHIVES.map((archive) => archive.name));
  const entries = await readdir(retiredRoot, { withFileTypes: true });
  for (const entry of entries) {
    assert(!entry.isSymbolicLink() && entry.isDirectory() && allowed.has(entry.name), `Unexpected entry in retired root: ${entry.name}`);
  }
}

export async function createRetirementCompactionCore(atlasRoot, retiredRoot, ledgerRelative = DEFAULT_LEDGER, { write = true, resume = true } = {}) {
  atlasRoot = path.resolve(atlasRoot);
  retiredRoot = path.resolve(retiredRoot);
  await assertPlainDirectory(atlasRoot, "Atlas root");
  await assertRetiredRootHasOnlyPlannedArchives(retiredRoot);
  const ledgerPath = path.resolve(atlasRoot, ...ledgerRelative.split("/"));
  assert(isWithin(atlasRoot, ledgerPath) && ledgerPath !== atlasRoot, "Retirement ledger path escapes Atlas");
  const existing = await maybeLstat(ledgerPath);
  if (existing && resume) {
    assert(existing.isFile() && !existing.isSymbolicLink(), "Existing retirement ledger is not a plain file");
    const ledger = await readJson(ledgerPath);
    validateLedger(ledger);
    return { ledger, resumed: true };
  }

  const batches = [];
  const retiredRecords = [];
  const targets = [];
  for (const archive of ARCHIVES) {
    const archivePath = path.join(retiredRoot, archive.name);
    await assertPlainDirectory(archivePath, `Retirement archive ${archive.name}`);
    const verification = await verifyArchiveContents(archivePath);
    const sourcePlanPath = path.join(archivePath, "retirement-plan.json");
    const sourcePlanBytes = await readFile(sourcePlanPath);
    const sourcePlan = JSON.parse(sourcePlanBytes);
    assert(sourcePlan.status === "complete", `Retirement archive is not complete: ${archive.name}`);
    assert(Array.isArray(sourcePlan.records) && Array.isArray(sourcePlan.paperIds), `Retirement archive has no record list: ${archive.name}`);
    assert(sourcePlan.records.length === sourcePlan.paperIds.length, `Retirement record count mismatch: ${archive.name}`);
    const records = sourcePlan.records.map((record) => normalizeRetiredRecord(record, archive.name, archive.reason));
    retiredRecords.push(...records);
    const descriptor = await describePath(archivePath);
    targets.push({ scope: "retired", path: archive.name, ...descriptor, reason: "verified retirement archive compacted into this ledger" });
    batches.push({
      archive: archive.name,
      operation: sourcePlan.operation,
      status: sourcePlan.status,
      preparedAt: sourcePlan.preparedAt || null,
      completedAt: sourcePlan.completedAt || null,
      source: sourcePlan.source,
      expectedRemoval: sourcePlan.expectedRemoval || null,
      expectedAfter: sourcePlan.expectedAfter,
      sourcePlanSha256: sha256(sourcePlanBytes),
      archiveVerification: {
        files: descriptor.fileCount,
        bytes: descriptor.bytes,
        sha256: descriptor.sha256,
        retiredFiles: verification.retiredFiles,
        backups: verification.backups,
      },
      records,
    });
  }

  const ids = retiredRecords.map((record) => record.id);
  assert(new Set(ids).size === ids.length, "Retirement archives contain duplicate paper IDs");
  const active = await currentSnapshot(atlasRoot, retiredRecords);

  const reconciliation = [];
  for (const relativePath of LOCAL_TARGETS.filter((target) => target.endsWith(".json"))) {
    const filename = path.join(atlasRoot, ...relativePath.split("/"));
    const bytes = await readFile(filename);
    reconciliation.push({ sourcePath: relativePath, sourceSha256: sha256(bytes), ...JSON.parse(bytes) });
  }
  const stagedWorkbook = await describePath(path.join(atlasRoot, "outputs", "workspace-cleanup-2026-09-13", "atlas_game_theory_articles.xlsx"));
  assert(sameDescriptor(stagedWorkbook, active.workbook), "Staged workbook is not byte-identical to the active root workbook");

  for (const relativePath of LOCAL_TARGETS) {
    const filename = path.join(atlasRoot, ...relativePath.split("/"));
    const descriptor = await describePath(filename);
    targets.push({ scope: "atlas", path: relativePath, ...descriptor, reason: relativePath === "outputs"
      ? "duplicate workbook and rebuildable workbook inspection output"
      : "workbook reconciliation history merged into this ledger" });
  }

  const unsigned = {
    schemaVersion: 1,
    kind: LEDGER_KIND,
    generatedAt: new Date().toISOString(),
    atlasRoot,
    retiredRoot,
    active,
    retirementCount: retiredRecords.length,
    batches,
    workbookReconciliation: reconciliation,
    recoveryBoundary: "The retired payloads were permanently deleted after hash verification. This ledger preserves identity, reason, and provenance, but cannot reconstruct the removed PDFs or derived artifacts.",
    cleanup: {
      targets,
      totals: {
        targets: targets.length,
        files: targets.reduce((sum, target) => sum + target.fileCount, 0),
        bytes: targets.reduce((sum, target) => sum + target.bytes, 0),
      },
    },
  };
  const ledger = signLedger(unsigned);
  validateLedger(ledger);
  if (write) await atomicWriteJson(ledgerPath, ledger);
  return { ledger, resumed: false };
}

async function loadLedger(atlasRoot, ledgerRelative) {
  const ledgerPath = path.resolve(atlasRoot, ...ledgerRelative.split("/"));
  assert(isWithin(atlasRoot, ledgerPath) && ledgerPath !== atlasRoot, "Retirement ledger path escapes Atlas");
  const ledger = await readJson(ledgerPath);
  validateLedger(ledger);
  return ledger;
}

export async function applyRetirementCompactionCore(atlasRoot, retiredRoot, ledgerRelative = DEFAULT_LEDGER, hooks = {}) {
  atlasRoot = path.resolve(atlasRoot);
  retiredRoot = path.resolve(retiredRoot);
  const ledger = await loadLedger(atlasRoot, ledgerRelative);
  assert(path.resolve(ledger.atlasRoot) === atlasRoot && path.resolve(ledger.retiredRoot) === retiredRoot, "Retirement ledger belongs to another workspace");
  const records = ledger.batches.flatMap((batch) => batch.records);
  await assertSnapshotCurrent(atlasRoot, ledger.active, records);
  await assertRetiredRootHasOnlyPlannedArchives(retiredRoot, { allowMissing: true });

  const present = [];
  for (const target of ledger.cleanup.targets) {
    const filename = resolveTarget(atlasRoot, retiredRoot, target);
    if (!await maybeLstat(filename)) continue;
    const actual = await describePath(filename);
    assert(sameDescriptor(actual, target), `Cleanup target changed after planning: ${target.scope}:${target.path}`);
    present.push(target);
  }

  let removed = 0;
  for (const target of present.sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))) {
    const filename = resolveTarget(atlasRoot, retiredRoot, target);
    const actual = await describePath(filename);
    assert(sameDescriptor(actual, target), `Cleanup target changed immediately before deletion: ${target.scope}:${target.path}`);
    await rm(filename, { recursive: target.type === "dir", force: false });
    assert(!await maybeLstat(filename), `Cleanup target remains after deletion: ${target.scope}:${target.path}`);
    removed += 1;
    if (hooks.afterDelete) await hooks.afterDelete(target, removed);
  }

  const retiredStat = await maybeLstat(retiredRoot);
  if (retiredStat) {
    const entries = await readdir(retiredRoot);
    assert(entries.length === 0, `Retired root still contains unplanned entries: ${entries.join(", ")}`);
    await rmdir(retiredRoot);
  }
  return { removed, alreadyAbsent: ledger.cleanup.targets.length - present.length, total: ledger.cleanup.targets.length };
}

export async function verifyRetirementCompactionCore(atlasRoot, retiredRoot, ledgerRelative = DEFAULT_LEDGER) {
  atlasRoot = path.resolve(atlasRoot);
  retiredRoot = path.resolve(retiredRoot);
  const ledger = await loadLedger(atlasRoot, ledgerRelative);
  const records = ledger.batches.flatMap((batch) => batch.records);
  await assertSnapshotCurrent(atlasRoot, ledger.active, records);
  const remaining = [];
  for (const target of ledger.cleanup.targets) {
    if (await maybeLstat(resolveTarget(atlasRoot, retiredRoot, target))) remaining.push(`${target.scope}:${target.path}`);
  }
  assert(remaining.length === 0, `Retirement compaction targets remain: ${remaining.join(", ")}`);
  assert(!await maybeLstat(retiredRoot), "Retired root still exists after compaction");
  return { verifiedTargets: ledger.cleanup.targets.length, retiredPapers: ledger.retirementCount };
}

function assertProductionRoots() {
  assert(ATLAS_ROOT.toLowerCase() === REQUIRED_ATLAS_ROOT.toLowerCase(), `This script is locked to ${REQUIRED_ATLAS_ROOT}`);
  assert(RETIRED_ROOT.toLowerCase() === REQUIRED_RETIRED_ROOT.toLowerCase(), `This script is locked to ${REQUIRED_RETIRED_ROOT}`);
}

async function main(argv) {
  assertProductionRoots();
  const command = argv[0];
  if (command === "preview") {
    const { ledger } = await createRetirementCompactionCore(ATLAS_ROOT, RETIRED_ROOT, DEFAULT_LEDGER, { write: false, resume: false });
    console.log(JSON.stringify({ command, persisted: false, retirementCount: ledger.retirementCount, totals: ledger.cleanup.totals }, null, 2));
  } else if (command === "plan") {
    const { ledger, resumed } = await createRetirementCompactionCore(ATLAS_ROOT, RETIRED_ROOT, DEFAULT_LEDGER);
    console.log(JSON.stringify({ command, resumed, retirementCount: ledger.retirementCount, totals: ledger.cleanup.totals }, null, 2));
  } else if (command === "apply") {
    console.log(JSON.stringify({ command, ...await applyRetirementCompactionCore(ATLAS_ROOT, RETIRED_ROOT) }, null, 2));
  } else if (command === "verify") {
    console.log(JSON.stringify({ command, ...await verifyRetirementCompactionCore(ATLAS_ROOT, RETIRED_ROOT) }, null, 2));
  } else {
    throw new Error("Usage: node scripts/compact-retirements.mjs <preview|plan|apply|verify>");
  }
}

export const __test = Object.freeze({ describePath, signLedger, validateLedger });

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
