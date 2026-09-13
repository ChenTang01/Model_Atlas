import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  atomicWriteJson,
  atomicWriteText,
  sha256,
  stableStringify,
  summarizeLedgers
} from "./corpus-pipeline.mjs";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS = new Set(["check", "write"]);
const PAPER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WRITER_TEMP_PATTERN = /^(?<ledgerName>[A-Za-z0-9][A-Za-z0-9._-]*\.json)\.(?<pid>[1-9]\d*)-(?<uuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?<canonicalizer>\.canonicalize)?\.tmp$/i;
const QUARANTINE_DIR = path.join("research", "ledger", "paper-ledger-canonicalization-quarantine");
const WRITER_ATTESTATION = "all Atlas paper-ledger writers are stopped until canonicalization completes";
const HAZARD_DIRECTORIES = Object.freeze([
  path.join("research", "ledger", ".claims"),
  path.join("research", "ledger", "extraction-repair-quiescence"),
  path.join("research", "ledger", "extraction-repair-promotions")
]);

export const PAPER_LEDGER_CANONICALIZER_VERSION = "paper-ledger-canonicalizer-v1";

function compareOrdinal(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function relative(root, filename) {
  return path.relative(root, filename).split(path.sep).join("/");
}

function unique(values) {
  return [...new Set(values)].sort(compareOrdinal);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.records)) {
    throw new Error("Corpus manifest records are missing");
  }
  if (!manifest.records.length) throw new Error("Corpus manifest contains no records");
  const ids = [];
  for (const [index, record] of manifest.records.entries()) {
    if (!record || typeof record !== "object") throw new Error(`Corpus manifest record ${index} is invalid`);
    if (typeof record.id !== "string" || !PAPER_ID_PATTERN.test(record.id)) {
      throw new Error(`Corpus manifest record ${index} has an unsafe paper id`);
    }
    ids.push(record.id);
  }
  if (unique(ids).length !== ids.length) throw new Error("Corpus manifest contains duplicate paper ids");
  if (Number.isInteger(manifest.counts?.records) && manifest.counts.records !== ids.length) {
    throw new Error("Corpus manifest record count does not match records[]");
  }
}

async function regularFile(filename) {
  try {
    const stats = await lstat(filename);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function listFilesRecursive(directory, root = directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => compareOrdinal(a.name, b.name))) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursive(filename, root));
    else files.push(path.relative(root, filename).split(path.sep).join("/"));
  }
  return files;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return true;
  }
}

async function describeWriterTemp(root, papersDir, entry, manifestNameSet, ledgerById, hooks) {
  const match = WRITER_TEMP_PATTERN.exec(entry.name);
  if (!match || !manifestNameSet.has(match.groups.ledgerName) || !entry.isFile()) return null;
  const filename = path.join(papersDir, entry.name);
  const stats = await lstat(filename);
  if (!stats.isFile() || stats.isSymbolicLink()) return null;
  const bytes = await readFile(filename);
  const embeddedPid = Number(match.groups.pid);
  const isAlive = hooks.processIsAlive
    ? await hooks.processIsAlive(embeddedPid)
    : processIsAlive(embeddedPid);
  let json = null;
  let jsonParseError = "";
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    jsonParseError = error.message;
  }
  const paperId = match.groups.ledgerName.slice(0, -5);
  const authoritative = ledgerById.get(paperId);
  return {
    paperId,
    name: entry.name,
    sourcePath: relative(root, filename),
    sourceSha256: sha256(bytes),
    bytes: bytes.length,
    mtime: stats.mtime.toISOString(),
    embeddedPid,
    pidAlive: Boolean(isAlive),
    jsonComplete: Boolean(json),
    jsonParseError,
    jsonPaperId: json?.paperId ?? null,
    jsonPaperIdMatches: json?.paperId === paperId,
    canonicalJsonSha256: json ? sha256(Buffer.from(`${stableStringify(json, 2)}\n`, "utf8")) : null,
    semanticMatchesAuthoritative: Boolean(json && authoritative
      && stableStringify(json) === stableStringify(authoritative.ledger))
  };
}

async function inspectHazards(root, ledgerDirectoryEntries, manifest, ledgerEntries, hooks = {}) {
  const papersDir = path.join(root, "research", "ledger", "papers");
  const manifestNameSet = new Set(manifest.records.map((record) => `${record.id}.json`));
  const ledgerById = new Map(ledgerEntries.map((entry) => [entry.paperId, entry]));
  const unexpectedPaperEntries = [];
  const orphanWriterTemps = [];
  const liveWriterTemps = [];
  for (const entry of ledgerDirectoryEntries) {
    if (entry.isFile() && entry.name.endsWith(".json")) continue;
    const temporary = await describeWriterTemp(root, papersDir, entry, manifestNameSet, ledgerById, hooks);
    if (!temporary) unexpectedPaperEntries.push(entry.name);
    else if (temporary.pidAlive) liveWriterTemps.push(temporary);
    else orphanWriterTemps.push(temporary);
  }
  const activeArtifacts = [];
  for (const directory of HAZARD_DIRECTORIES) {
    const absolute = path.join(root, directory);
    for (const filename of await listFilesRecursive(absolute)) {
      activeArtifacts.push(`${directory.split(path.sep).join("/")}/${filename}`);
    }
  }
  return {
    unexpectedPaperEntries: unexpectedPaperEntries.sort(compareOrdinal),
    activeArtifacts: activeArtifacts.sort(compareOrdinal),
    liveWriterTemps: liveWriterTemps.sort((a, b) => compareOrdinal(a.name, b.name)),
    orphanWriterTemps: orphanWriterTemps.sort((a, b) => compareOrdinal(a.name, b.name))
  };
}

function structuralDiagnostics(manifest, directoryEntries) {
  const manifestNames = manifest.records.map((record) => `${record.id}.json`);
  const manifestNameSet = new Set(manifestNames);
  const jsonEntries = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort(compareOrdinal);
  const jsonEntrySet = new Set(jsonEntries);
  return {
    missingLedgers: manifestNames.filter((name) => !jsonEntrySet.has(name)).map((name) => name.slice(0, -5)),
    extraLedgers: jsonEntries.filter((name) => !manifestNameSet.has(name)).map((name) => name.slice(0, -5)),
    wrongTypeLedgers: directoryEntries
      .filter((entry) => manifestNameSet.has(entry.name) && !entry.isFile())
      .map((entry) => entry.name.slice(0, -5))
      .sort(compareOrdinal)
  };
}

function entrySetDigest(entries, hashField) {
  return sha256(stableStringify(entries.map((entry) => ({
    paperId: entry.paperId,
    sha256: entry[hashField]
  }))));
}

async function scanPaperLedgers(root, hooks = {}) {
  const manifestPath = path.join(root, "research", "corpus", "manifest.v1.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = parseJson(manifestBytes, "Corpus manifest");
  validateManifest(manifest);

  const papersDir = path.join(root, "research", "ledger", "papers");
  let directoryEntries;
  try {
    directoryEntries = await readdir(papersDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    directoryEntries = [];
  }
  const structural = structuralDiagnostics(manifest, directoryEntries);
  const unavailable = new Set([
    ...structural.missingLedgers,
    ...structural.wrongTypeLedgers
  ]);
  const entries = [];
  const invalidLedgers = [];
  for (const record of manifest.records) {
    if (unavailable.has(record.id)) continue;
    const filename = path.join(papersDir, `${record.id}.json`);
    if (!await regularFile(filename)) {
      structural.wrongTypeLedgers.push(record.id);
      continue;
    }
    let bytes;
    let ledger;
    try {
      bytes = await readFile(filename);
      ledger = parseJson(bytes, `${record.id} paper ledger`);
    } catch (error) {
      invalidLedgers.push({ paperId: record.id, reason: error.message });
      continue;
    }
    const identityIssues = [];
    if (ledger?.paperId !== record.id) identityIssues.push("paper_id_mismatch");
    if (ledger?.corpusRevision !== manifest.corpusRevision) identityIssues.push("corpus_revision_mismatch");
    if (ledger?.manifestRecordDigest !== record.recordDigest) identityIssues.push("manifest_record_digest_mismatch");
    if (identityIssues.length) {
      invalidLedgers.push({ paperId: record.id, reason: identityIssues.join(",") });
      continue;
    }
    const canonicalBytes = Buffer.from(`${stableStringify(ledger, 2)}\n`, "utf8");
    entries.push({
      paperId: record.id,
      filename,
      ledger,
      beforeBytes: bytes,
      beforeSha256: sha256(bytes),
      targetBytes: canonicalBytes,
      targetSha256: sha256(canonicalBytes),
      canonical: bytes.equals(canonicalBytes)
    });
  }
  structural.wrongTypeLedgers = unique(structural.wrongTypeLedgers);
  const hazards = await inspectHazards(root, directoryEntries, manifest, entries, hooks);
  const quarantineTransactions = await inspectQuarantineTransactions(root);
  return {
    root,
    manifestPath,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
    manifest,
    papersDir,
    entries,
    structural,
    invalidLedgers,
    hazards,
    quarantineTransactions
  };
}

function scanProblems(scan) {
  return [
    ...scan.structural.missingLedgers.map((paperId) => ({ paperId, reason: "missing_ledger" })),
    ...scan.structural.extraLedgers.map((paperId) => ({ paperId, reason: "extra_ledger" })),
    ...scan.structural.wrongTypeLedgers.map((paperId) => ({ paperId, reason: "ledger_not_regular_file" })),
    ...scan.invalidLedgers
  ];
}

function quarantinePlanDigest(plan) {
  return sha256(stableStringify({
    schemaVersion: plan.schemaVersion,
    stage: plan.stage,
    producerVersion: plan.producerVersion,
    attestation: plan.attestation,
    manifest: plan.manifest,
    ledgerPreimageSetDigest: plan.ledgerPreimageSetDigest,
    entries: plan.entries.map(({ quarantinePath: _quarantinePath, ...entry }) => entry)
  }));
}

async function readCanonicalEvidence(filename, label) {
  const bytes = await readFile(filename);
  const value = parseJson(bytes, label);
  const canonical = Buffer.from(`${stableStringify(value, 2)}\n`, "utf8");
  if (!bytes.equals(canonical)) throw new Error(`${label} is not canonical stable JSON`);
  return { bytes, value, sha256: sha256(bytes) };
}

async function writeCanonicalEvidence(filename, value, label) {
  const text = `${stableStringify(value, 2)}\n`;
  let current = null;
  try {
    current = await readFile(filename, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current !== null && current !== text) throw new Error(`${label} already exists with different bytes`);
  if (current === null) await atomicWriteText(filename, text);
  const verified = await readFile(filename, "utf8");
  if (verified !== text) throw new Error(`${label} failed post-write verification`);
  return sha256(Buffer.from(text, "utf8"));
}

function makeQuarantinePlan(scan) {
  const entries = scan.hazards.orphanWriterTemps.map((entry) => ({ ...entry }));
  const body = {
    schemaVersion: 1,
    stage: "paperLedgerCanonicalizationQuarantinePlan",
    producerVersion: PAPER_LEDGER_CANONICALIZER_VERSION,
    attestation: WRITER_ATTESTATION,
    manifest: {
      path: relative(scan.root, scan.manifestPath),
      sha256: scan.manifestSha256,
      corpusRevision: scan.manifest.corpusRevision,
      records: scan.manifest.records.length
    },
    ledgerPreimageSetDigest: entrySetDigest(scan.entries, "beforeSha256"),
    entries
  };
  const transactionDigest = quarantinePlanDigest(body);
  const transactionDir = path.join(scan.root, QUARANTINE_DIR, transactionDigest);
  return {
    ...body,
    transactionDigest,
    entries: entries.map((entry) => ({
      ...entry,
      quarantinePath: relative(scan.root, path.join(transactionDir, "files", entry.name))
    }))
  };
}

function validateQuarantinePlan(root, transactionDigest, plan) {
  if (plan?.schemaVersion !== 1
    || plan?.stage !== "paperLedgerCanonicalizationQuarantinePlan"
    || plan?.producerVersion !== PAPER_LEDGER_CANONICALIZER_VERSION
    || plan?.attestation !== WRITER_ATTESTATION
    || plan?.manifest?.path !== "research/corpus/manifest.v1.json"
    || !/^[a-f0-9]{64}$/.test(plan?.manifest?.sha256 || "")
    || plan?.transactionDigest !== transactionDigest
    || quarantinePlanDigest(plan) !== transactionDigest
    || !Array.isArray(plan.entries)
    || !plan.entries.length) {
    throw new Error(`${transactionDigest} quarantine plan contract is invalid`);
  }
  const seen = new Set();
  for (const entry of plan.entries) {
    const match = WRITER_TEMP_PATTERN.exec(entry.name || "");
    const expectedSource = path.posix.join("research", "ledger", "papers", entry.name || "");
    const expectedQuarantine = path.posix.join(
      QUARANTINE_DIR.split(path.sep).join("/"),
      transactionDigest,
      "files",
      entry.name || ""
    );
    if (!match
      || entry.paperId !== match.groups.ledgerName.slice(0, -5)
      || entry.embeddedPid !== Number(match.groups.pid)
      || entry.pidAlive !== false
      || entry.sourcePath !== expectedSource
      || entry.quarantinePath !== expectedQuarantine
      || !/^[a-f0-9]{64}$/.test(entry.sourceSha256 || "")
      || !Number.isInteger(entry.bytes)
      || entry.bytes < 0
      || seen.has(entry.name)) {
      throw new Error(`${transactionDigest} quarantine plan entry is invalid`);
    }
    seen.add(entry.name);
    const source = path.resolve(root, ...entry.sourcePath.split("/"));
    const destination = path.resolve(root, ...entry.quarantinePath.split("/"));
    if (relative(root, source) !== entry.sourcePath || relative(root, destination) !== entry.quarantinePath) {
      throw new Error(`${transactionDigest} quarantine plan path escapes the project root`);
    }
  }
}

async function validateQuarantineCompletion(root, planEvidence, completionEvidence) {
  const plan = planEvidence.value;
  const completion = completionEvidence.value;
  const expectedEntries = plan.entries.map((entry) => ({
    paperId: entry.paperId,
    sourcePath: entry.sourcePath,
    quarantinePath: entry.quarantinePath,
    sourceSha256: entry.sourceSha256,
    bytes: entry.bytes
  }));
  if (completion?.schemaVersion !== 1
    || completion?.stage !== "paperLedgerCanonicalizationQuarantineCompletion"
    || completion?.producerVersion !== PAPER_LEDGER_CANONICALIZER_VERSION
    || completion?.transactionDigest !== plan.transactionDigest
    || completion?.planPath !== relative(root, path.join(root, QUARANTINE_DIR, plan.transactionDigest, "plan.json"))
    || completion?.planSha256 !== planEvidence.sha256
    || stableStringify(completion?.entries) !== stableStringify(expectedEntries)) {
    throw new Error(`${plan.transactionDigest} quarantine completion contract is invalid`);
  }
  for (const entry of plan.entries) {
    const destination = path.resolve(root, ...entry.quarantinePath.split("/"));
    const stats = await lstat(destination);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`${entry.quarantinePath} is not a regular quarantined file`);
    }
    const bytes = await readFile(destination);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sourceSha256) {
      throw new Error(`${entry.quarantinePath} does not match its completion evidence`);
    }
  }
}

async function inspectQuarantineTransactions(root) {
  const quarantineRoot = path.join(root, QUARANTINE_DIR);
  let directoryEntries;
  try {
    directoryEntries = await readdir(quarantineRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { pending: [], complete: [], issues: [] };
    throw error;
  }
  const pending = [];
  const complete = [];
  const issues = [];
  for (const entry of directoryEntries.sort((a, b) => compareOrdinal(a.name, b.name))) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) {
      issues.push({ transactionDigest: entry.name, reason: "unexpected_quarantine_entry" });
      continue;
    }
    const transactionDir = path.join(quarantineRoot, entry.name);
    const planPath = path.join(transactionDir, "plan.json");
    let plan;
    try {
      plan = await readCanonicalEvidence(planPath, `${entry.name} quarantine plan`);
      validateQuarantinePlan(root, entry.name, plan.value);
    } catch (error) {
      issues.push({ transactionDigest: entry.name, reason: error.message });
      continue;
    }
    const completionPath = path.join(transactionDir, "completion.json");
    try {
      const completion = await readCanonicalEvidence(completionPath, `${entry.name} quarantine completion`);
      await validateQuarantineCompletion(root, plan, completion);
      complete.push({ transactionDigest: entry.name, plan, completion });
    } catch (error) {
      if (error.code === "ENOENT") pending.push({ transactionDigest: entry.name, plan });
      else issues.push({ transactionDigest: entry.name, reason: error.message });
    }
  }
  return { pending, complete, issues };
}

async function executeQuarantinePlan(root, loadedPlan, hooks = {}) {
  const plan = loadedPlan.value || loadedPlan;
  validateQuarantinePlan(root, plan.transactionDigest, plan);
  const currentManifest = await readFile(path.resolve(root, ...plan.manifest.path.split("/")));
  if (sha256(currentManifest) !== plan.manifest.sha256) {
    throw new Error(`${plan.transactionDigest} quarantine manifest binding changed`);
  }
  let moved = 0;
  let resumed = 0;
  for (const entry of plan.entries) {
    const source = path.resolve(root, ...entry.sourcePath.split("/"));
    const destination = path.resolve(root, ...entry.quarantinePath.split("/"));
    let sourceBytes = null;
    try {
      const stats = await lstat(source);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${entry.sourcePath} is not a regular file`);
      sourceBytes = await readFile(source);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let destinationBytes = null;
    try {
      const stats = await lstat(destination);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${entry.quarantinePath} is not a regular file`);
      destinationBytes = await readFile(destination);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (sourceBytes && destinationBytes) throw new Error(`${entry.sourcePath} and its quarantine destination both exist`);
    if (destinationBytes) {
      if (sha256(destinationBytes) !== entry.sourceSha256 || destinationBytes.length !== entry.bytes) {
        throw new Error(`${entry.quarantinePath} does not match the recorded orphan preimage`);
      }
      resumed += 1;
      continue;
    }
    if (!sourceBytes) throw new Error(`${entry.sourcePath} and its quarantine destination are both missing`);
    if (sha256(sourceBytes) !== entry.sourceSha256 || sourceBytes.length !== entry.bytes) {
      throw new Error(`${entry.sourcePath} changed before quarantine`);
    }
    const isAlive = hooks.processIsAlive
      ? await hooks.processIsAlive(entry.embeddedPid)
      : processIsAlive(entry.embeddedPid);
    if (isAlive) throw new Error(`${entry.sourcePath} embedded PID ${entry.embeddedPid} is alive`);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    const quarantined = await readFile(destination);
    if (sha256(quarantined) !== entry.sourceSha256 || quarantined.length !== entry.bytes) {
      throw new Error(`${entry.quarantinePath} failed post-move verification`);
    }
    moved += 1;
    if (hooks.afterQuarantineMove) await hooks.afterQuarantineMove({ ...entry, transactionDigest: plan.transactionDigest });
  }
  const planPath = path.join(root, QUARANTINE_DIR, plan.transactionDigest, "plan.json");
  const planEvidence = await readCanonicalEvidence(planPath, `${plan.transactionDigest} quarantine plan`);
  const completion = {
    schemaVersion: 1,
    stage: "paperLedgerCanonicalizationQuarantineCompletion",
    producerVersion: PAPER_LEDGER_CANONICALIZER_VERSION,
    transactionDigest: plan.transactionDigest,
    planPath: relative(root, planPath),
    planSha256: planEvidence.sha256,
    entries: plan.entries.map((entry) => ({
      paperId: entry.paperId,
      sourcePath: entry.sourcePath,
      quarantinePath: entry.quarantinePath,
      sourceSha256: entry.sourceSha256,
      bytes: entry.bytes
    }))
  };
  const completionPath = path.join(root, QUARANTINE_DIR, plan.transactionDigest, "completion.json");
  const completionSha256 = await writeCanonicalEvidence(
    completionPath,
    completion,
    `${plan.transactionDigest} quarantine completion`
  );
  return {
    transactionDigest: plan.transactionDigest,
    planPath: relative(root, planPath),
    planSha256: planEvidence.sha256,
    completionPath: relative(root, completionPath),
    completionSha256,
    entries: plan.entries.length,
    moved,
    resumed
  };
}

async function quarantineOrphanTemps(scan, hooks = {}) {
  if (!scan.hazards.orphanWriterTemps.length) return null;
  const plan = makeQuarantinePlan(scan);
  const planPath = path.join(scan.root, QUARANTINE_DIR, plan.transactionDigest, "plan.json");
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeCanonicalEvidence(planPath, plan, `${plan.transactionDigest} quarantine plan`);
  const loaded = await readCanonicalEvidence(planPath, `${plan.transactionDigest} quarantine plan`);
  return executeQuarantinePlan(scan.root, loaded, hooks);
}

async function verifySnapshot(scan) {
  const drifted = [];
  const currentManifest = await readFile(scan.manifestPath);
  if (!currentManifest.equals(scan.manifestBytes)) {
    drifted.push({ paperId: null, reason: "manifest_preimage_changed", expectedSha256: scan.manifestSha256, actualSha256: sha256(currentManifest) });
  }
  for (const entry of scan.entries) {
    let current;
    try {
      current = await readFile(entry.filename);
    } catch (error) {
      drifted.push({ paperId: entry.paperId, reason: `ledger_preimage_unreadable:${error.code || error.message}` });
      continue;
    }
    const currentSha256 = sha256(current);
    if (!current.equals(entry.beforeBytes)) {
      drifted.push({
        paperId: entry.paperId,
        reason: "ledger_preimage_changed",
        expectedSha256: entry.beforeSha256,
        actualSha256: currentSha256
      });
    }
  }
  return drifted;
}

async function atomicReplaceIfUnchanged(entry, hooks = {}) {
  const temporary = `${entry.filename}.${process.pid}-${randomUUID()}.canonicalize.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(entry.targetBytes);
    await handle.sync();
    await handle.close();
    handle = null;
    if (hooks.beforeCommit) await hooks.beforeCommit({
      paperId: entry.paperId,
      filename: entry.filename,
      beforeSha256: entry.beforeSha256,
      targetSha256: entry.targetSha256
    });
    const current = await readFile(entry.filename);
    const actualSha256 = sha256(current);
    if (!current.equals(entry.beforeBytes)) {
      return {
        ok: false,
        drift: {
          paperId: entry.paperId,
          reason: "ledger_compare_and_swap_failed",
          expectedSha256: entry.beforeSha256,
          actualSha256
        }
      };
    }
    await rename(temporary, entry.filename);
    const written = await readFile(entry.filename);
    if (!written.equals(entry.targetBytes)) {
      return {
        ok: false,
        drift: {
          paperId: entry.paperId,
          reason: "ledger_post_write_verification_failed",
          expectedSha256: entry.targetSha256,
          actualSha256: sha256(written)
        }
      };
    }
    if (hooks.afterCommit) await hooks.afterCommit({
      paperId: entry.paperId,
      filename: entry.filename,
      beforeSha256: entry.beforeSha256,
      targetSha256: entry.targetSha256
    });
    return { ok: true };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function operationSummary(scan, {
  command,
  attestedWritersStopped,
  rewritten = 0,
  drifted = [],
  finalScan = null,
  summaryRefreshed = false,
  summaryChanged = false,
  quarantine = []
}) {
  const effective = finalScan || scan;
  const problems = scanProblems(effective);
  const canonical = effective.entries.filter((entry) => entry.canonical).length;
  const noncanonical = effective.entries.length - canonical;
  const ledgerSummary = problems.length ? null : summarizeLedgers(
    effective.manifest,
    effective.entries.map((entry) => entry.ledger),
    effective.structural
  );
  const hazardCount = effective.hazards.unexpectedPaperEntries.length
    + effective.hazards.activeArtifacts.length
    + effective.hazards.liveWriterTemps.length
    + effective.quarantineTransactions.issues.length;
  const blockedByHazards = command === "write" && hazardCount > 0;
  const ok = !problems.length && !noncanonical && !drifted.length && !blockedByHazards;
  return {
    schemaVersion: 1,
    producerVersion: PAPER_LEDGER_CANONICALIZER_VERSION,
    command,
    ok,
    state: ok
      ? "canonical"
      : drifted.length || problems.length || blockedByHazards
        ? "failed_closed"
        : "needs_canonicalization",
    attestedWritersStopped: Boolean(attestedWritersStopped),
    manifest: {
      path: relative(effective.root, effective.manifestPath),
      sha256: effective.manifestSha256,
      corpusRevision: effective.manifest.corpusRevision,
      records: effective.manifest.records.length
    },
    counts: {
      expected: effective.manifest.records.length,
      scanned: effective.entries.length,
      canonical,
      noncanonical,
      rewritten,
      structuralProblems: problems.length,
      drifted: drifted.length,
      hazards: hazardCount,
      orphanWriterTemps: effective.hazards.orphanWriterTemps.length,
      pendingQuarantineTransactions: effective.quarantineTransactions.pending.length,
      quarantined: quarantine.reduce((sum, transaction) => sum + transaction.entries, 0)
    },
    setDigests: {
      preimage: entrySetDigest(scan.entries, "beforeSha256"),
      target: entrySetDigest(scan.entries, "targetSha256"),
      observed: entrySetDigest(effective.entries, "beforeSha256")
    },
    safeToWrite: !problems.length && !hazardCount && !drifted.length,
    summaryRefreshed,
    summaryChanged,
    diagnostics: {
      ...effective.structural,
      invalidLedgers: effective.invalidLedgers,
      unexpectedPaperEntries: effective.hazards.unexpectedPaperEntries,
      activeArtifacts: effective.hazards.activeArtifacts,
      liveWriterTemps: effective.hazards.liveWriterTemps,
      orphanWriterTemps: effective.hazards.orphanWriterTemps,
      quarantineIssues: effective.quarantineTransactions.issues,
      pendingQuarantineTransactions: effective.quarantineTransactions.pending.map((transaction) => transaction.transactionDigest),
      drifted,
      noncanonicalSample: effective.entries.filter((entry) => !entry.canonical).slice(0, 20).map((entry) => ({
        paperId: entry.paperId,
        beforeSha256: entry.beforeSha256,
        canonicalSha256: entry.targetSha256
      }))
    },
    quarantine,
    ledgerSummary
  };
}

export async function canonicalizePaperLedgers({
  root = SCRIPT_ROOT,
  command = "check",
  attestWritersStopped = false,
  hooks = {}
} = {}) {
  if (!COMMANDS.has(command)) throw new Error(`Unknown paper-ledger canonicalization command: ${command}`);
  if (command === "write" && !attestWritersStopped) {
    throw new Error("write requires --attest-writers-stopped");
  }
  if (command !== "write" && attestWritersStopped) {
    throw new Error("--attest-writers-stopped is write-only");
  }
  const resolvedRoot = path.resolve(root);
  let working = await scanPaperLedgers(resolvedRoot, hooks);
  if (command === "check") return operationSummary(working, {
    command,
    attestedWritersStopped: attestWritersStopped
  });

  let problems = scanProblems(working);
  let hazardCount = working.hazards.unexpectedPaperEntries.length
    + working.hazards.activeArtifacts.length
    + working.hazards.liveWriterTemps.length
    + working.quarantineTransactions.issues.length;
  if (problems.length || hazardCount) {
    return operationSummary(working, {
      command,
      attestedWritersStopped: attestWritersStopped
    });
  }

  const quarantine = [];
  try {
    for (const transaction of working.quarantineTransactions.pending) {
      quarantine.push(await executeQuarantinePlan(resolvedRoot, transaction.plan, hooks));
    }
    if (working.quarantineTransactions.pending.length) {
      working = await scanPaperLedgers(resolvedRoot, hooks);
    }
    if (working.hazards.orphanWriterTemps.length) {
      quarantine.push(await quarantineOrphanTemps(working, hooks));
      working = await scanPaperLedgers(resolvedRoot, hooks);
    }
  } catch (error) {
    const partial = await scanPaperLedgers(resolvedRoot, hooks);
    return operationSummary(working, {
      command,
      attestedWritersStopped: attestWritersStopped,
      drifted: [{ paperId: null, reason: `quarantine_failed:${error.message}` }],
      finalScan: partial,
      quarantine
    });
  }
  problems = scanProblems(working);
  hazardCount = working.hazards.unexpectedPaperEntries.length
    + working.hazards.activeArtifacts.length
    + working.hazards.liveWriterTemps.length
    + working.quarantineTransactions.issues.length;
  if (problems.length
    || hazardCount
    || working.hazards.orphanWriterTemps.length
    || working.quarantineTransactions.pending.length) {
    return operationSummary(working, {
      command,
      attestedWritersStopped: attestWritersStopped,
      quarantine
    });
  }

  const initial = working;
  const preflightDrift = await verifySnapshot(initial);
  if (preflightDrift.length) {
    return operationSummary(initial, {
      command,
      attestedWritersStopped: attestWritersStopped,
      drifted: preflightDrift,
      quarantine
    });
  }

  let rewritten = 0;
  const drifted = [];
  for (const entry of initial.entries) {
    const current = await readFile(entry.filename);
    if (!current.equals(entry.beforeBytes)) {
      drifted.push({
        paperId: entry.paperId,
        reason: "ledger_compare_and_swap_failed",
        expectedSha256: entry.beforeSha256,
        actualSha256: sha256(current)
      });
      break;
    }
    if (entry.canonical) continue;
    const committed = await atomicReplaceIfUnchanged(entry, hooks);
    if (!committed.ok) {
      drifted.push(committed.drift);
      break;
    }
    rewritten += 1;
  }
  if (drifted.length) {
    const partial = await scanPaperLedgers(resolvedRoot, hooks);
    return operationSummary(initial, {
      command,
      attestedWritersStopped: attestWritersStopped,
      rewritten,
      drifted,
      finalScan: partial,
      quarantine
    });
  }

  const finalScan = await scanPaperLedgers(resolvedRoot, hooks);
  const finalDrift = [];
  if (finalScan.manifestSha256 !== initial.manifestSha256) {
    finalDrift.push({
      paperId: null,
      reason: "manifest_changed_during_write",
      expectedSha256: initial.manifestSha256,
      actualSha256: finalScan.manifestSha256
    });
  }
  const expectedTargets = new Map(initial.entries.map((entry) => [entry.paperId, entry.targetSha256]));
  for (const entry of finalScan.entries) {
    const expectedSha256 = expectedTargets.get(entry.paperId);
    if (expectedSha256 && entry.beforeSha256 !== expectedSha256) {
      finalDrift.push({
        paperId: entry.paperId,
        reason: "ledger_postimage_changed",
        expectedSha256,
        actualSha256: entry.beforeSha256
      });
    }
  }
  let summaryRefreshed = false;
  let summaryChanged = false;
  if (!finalDrift.length && operationSummary(initial, {
    command,
    attestedWritersStopped: attestWritersStopped,
    rewritten,
    finalScan,
    quarantine
  }).ok) {
    const ledgerSummary = summarizeLedgers(
      finalScan.manifest,
      finalScan.entries.map((entry) => entry.ledger),
      finalScan.structural
    );
    summaryChanged = await atomicWriteJson(
      path.join(resolvedRoot, "research", "ledger", "summary.json"),
      ledgerSummary
    );
    summaryRefreshed = true;
  }
  return operationSummary(initial, {
    command,
    attestedWritersStopped: attestWritersStopped,
    rewritten,
    drifted: finalDrift,
    finalScan,
    summaryRefreshed,
    summaryChanged,
    quarantine
  });
}

export function parsePaperLedgerCanonicalizationCli(argv) {
  const options = {
    command: "check",
    root: SCRIPT_ROOT,
    attestWritersStopped: false,
    json: false,
    help: false
  };
  let selectedCommand = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (COMMANDS.has(argument)) {
      if (selectedCommand && selectedCommand !== argument) throw new Error("Only one canonicalization command may be selected");
      selectedCommand = argument;
      continue;
    }
    const [name, inlineValue] = argument.startsWith("--") ? argument.split(/=(.*)/s, 2) : [argument, undefined];
    const takeValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
      return value;
    };
    switch (name) {
      case "--root": options.root = path.resolve(takeValue()); break;
      case "--attest-writers-stopped": options.attestWritersStopped = true; break;
      case "--json": options.json = true; break;
      case "--help":
      case "-h": options.help = true; break;
      default: throw new Error(`Unknown argument: ${argument}`);
    }
  }
  options.command = selectedCommand || "check";
  if (options.command === "write" && !options.attestWritersStopped && !options.help) {
    throw new Error("write requires --attest-writers-stopped");
  }
  if (options.command !== "write" && options.attestWritersStopped) {
    throw new Error("--attest-writers-stopped is write-only");
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/canonicalize-paper-ledgers.mjs check [--root PATH] [--json]
  node scripts/canonicalize-paper-ledgers.mjs write --attest-writers-stopped [--root PATH] [--json]

check is read-only and is the default command. write enumerates exactly the corpus manifest,
refuses missing, extra, invalid, or non-regular paper ledgers and active writer/claim/
quiescence/promotion evidence. A recognized dead-writer temporary file is atomically moved
into a content-addressed transaction quarantine after a canonical plan is saved; a canonical
completion record closes the transaction. Ledger writes verify a complete preimage snapshot
and use per-ledger compare-and-swap plus a same-directory fsynced temporary file and atomic
rename. Interrupted quarantine or ledger work resumes idempotently with the same command.`;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log(`Paper-ledger canonicalization ${result.command}: ${result.state}.`);
  console.log(`  ${result.counts.canonical}/${result.counts.expected} canonical; ${result.counts.noncanonical} need rewriting; ${result.counts.rewritten} rewritten.`);
  if (result.counts.orphanWriterTemps) console.log(`  Recoverable dead-writer temporary files: ${result.counts.orphanWriterTemps}.`);
  if (result.counts.quarantined) console.log(`  Quarantined temporary files: ${result.counts.quarantined}.`);
  if (result.counts.structuralProblems) console.log(`  Structural problems: ${result.counts.structuralProblems}.`);
  if (result.counts.hazards) console.log(`  Writer/promotion hazards: ${result.counts.hazards}.`);
  if (result.counts.drifted) console.log(`  Drifted preimages/postimages: ${result.counts.drifted}.`);
  if (result.summaryRefreshed) console.log("  Refreshed research/ledger/summary.json.");
}

async function main() {
  const options = parsePaperLedgerCanonicalizationCli(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await canonicalizePaperLedgers(options);
  printResult(result, options.json);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const payload = {
      schemaVersion: 1,
      producerVersion: PAPER_LEDGER_CANONICALIZER_VERSION,
      ok: false,
      state: "failed_closed",
      error: error.stack || error.message
    };
    if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
