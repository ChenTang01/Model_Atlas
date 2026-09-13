import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  stableStringify as stableLedgerStringify
} from "./corpus-pipeline.mjs";
import {
  extractionQaBoundDigest,
  verifyExtractionQaCheckpoint
} from "./extraction-qa.mjs";
import { modelNoteExtractionQaCheckpointBinding as extractionQaCheckpointBinding } from "./model-note-extraction-qa.mjs";

export const READING_PACKET_SCHEMA_VERSION = 1;
export const READING_PACKET_STAGE = "sourceReading";
export const MINI_READING_AUDIT_VERSION = "model-note-release-audit-v8";
const QA_BINDING_KEYS = [
  "extractionQaStatus",
  "extractionQaAutomatedStatus",
  "extractionQaInputDigest",
  "extractionQaDecisionPath",
  "extractionQaDecisionSha256",
  "extractionQaAdjudicationStatus",
  "extractionQaAdjudicationPath",
  "extractionQaAdjudicationSha256"
];
const NULLABLE_QA_BINDING_KEYS = new Set(["extractionQaAdjudicationPath", "extractionQaAdjudicationSha256"]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function atomicWriteJson(filename, value, { canonical = false } = {}) {
  await mkdir(path.dirname(filename), { recursive: true });
  const content = canonical ? `${stableLedgerStringify(value, 2)}\n` : renderJson(value);
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

async function readJsonIfPresent(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function appendQaBindingIssues(value, expected, issues, prefix) {
  if (!expected) return;
  for (const key of QA_BINDING_KEYS) {
    if (value?.[key] !== expected[key]) issues.push(`${prefix}_${key}_mismatch`);
  }
}

export function miniReadingInputDigest(input) {
  return sha256(stableStringify({
    auditVersion: MINI_READING_AUDIT_VERSION,
    paperId: requiredString(input.paperId, "paperId"),
    sourcePdfSha256: requiredString(input.sourcePdfSha256, "sourcePdfSha256"),
    noteSha256: requiredString(input.noteSha256, "noteSha256"),
    pagesArtifact: requiredString(input.pagesArtifact, "pagesArtifact"),
    pagesSha256: requiredString(input.pagesSha256, "pagesSha256")
  }));
}

function normalizeExpected(expected) {
  const normalized = {
    paperId: requiredString(expected.paperId, "paperId"),
    inputDigest: requiredString(expected.inputDigest, "inputDigest"),
    sourcePdfSha256: requiredString(expected.sourcePdfSha256, "sourcePdfSha256"),
    extractionPagesSha256: requiredString(expected.extractionPagesSha256, "extractionPagesSha256"),
    contractDigest: requiredString(expected.contractDigest, "contractDigest"),
    packetVersion: requiredString(expected.packetVersion, "packetVersion")
  };
  const hasQaBinding = QA_BINDING_KEYS.some((key) => expected?.[key] !== undefined);
  if (hasQaBinding) {
    for (const key of QA_BINDING_KEYS) {
      normalized[key] = NULLABLE_QA_BINDING_KEYS.has(key) && expected[key] === null
        ? null
        : requiredString(expected[key], key);
    }
  }
  return normalized;
}

export function readingPacketInputDigest(input) {
  const material = {
    schemaVersion: READING_PACKET_SCHEMA_VERSION,
    paperId: requiredString(input.paperId, "paperId"),
    sourcePdfSha256: requiredString(input.sourcePdfSha256, "sourcePdfSha256"),
    extractionPagesSha256: requiredString(input.extractionPagesSha256, "extractionPagesSha256"),
    contractDigest: requiredString(input.contractDigest, "contractDigest"),
    packetVersion: requiredString(input.packetVersion, "packetVersion")
  };
  const hasQaBinding = QA_BINDING_KEYS.some((key) => input?.[key] !== undefined);
  if (hasQaBinding) {
    for (const key of QA_BINDING_KEYS) {
      material[key] = NULLABLE_QA_BINDING_KEYS.has(key) && input[key] === null
        ? null
        : requiredString(input[key], key);
    }
  }
  return sha256(stableStringify(material));
}

function readingArtifact(expected, packet) {
  const normalized = normalizeExpected(expected);
  const envelope = {
    schemaVersion: READING_PACKET_SCHEMA_VERSION,
    stage: READING_PACKET_STAGE,
    ...normalized,
    packet
  };
  const content = renderJson(envelope);
  return { envelope, content, artifactSha256: sha256(content) };
}

export function readingPacketRelativePath(paperId, artifactSha256) {
  requiredString(paperId, "paperId");
  requiredString(artifactSha256, "artifactSha256");
  return path.posix.join("research", "ledger", "artifacts", paperId, READING_PACKET_STAGE, artifactSha256, "reading.json");
}

function resolveWithin(root, relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) throw new Error(`${label} must be a relative path`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split("/"));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`${label} escapes the project root`);
  return resolved;
}

function readingStageFromArtifact(expected, artifactSha256) {
  return {
    status: "complete",
    schemaVersion: READING_PACKET_SCHEMA_VERSION,
    inputDigest: expected.inputDigest,
    sourcePdfSha256: expected.sourcePdfSha256,
    extractionPagesSha256: expected.extractionPagesSha256,
    contractDigest: expected.contractDigest,
    packetVersion: expected.packetVersion,
    ...Object.fromEntries(QA_BINDING_KEYS.filter((key) => expected[key] !== undefined).map((key) => [key, expected[key]])),
    artifactPath: readingPacketRelativePath(expected.paperId, artifactSha256),
    artifactSha256
  };
}

function sectionIndexStageFromReading(stage) {
  return { ...stage, stage: "sectionIndex" };
}

function checkEnvelope(envelope, expected, issues) {
  if (envelope?.schemaVersion !== READING_PACKET_SCHEMA_VERSION) issues.push("reading_schema_mismatch");
  if (envelope?.stage !== READING_PACKET_STAGE) issues.push("reading_stage_identity_mismatch");
  for (const key of ["paperId", "inputDigest", "sourcePdfSha256", "extractionPagesSha256", "contractDigest", "packetVersion"]) {
    if (envelope?.[key] !== expected[key]) issues.push(`reading_${key}_mismatch`);
  }
  for (const key of QA_BINDING_KEYS.filter((name) => expected[name] !== undefined)) {
    if (envelope?.[key] !== expected[key]) issues.push(`reading_${key}_mismatch`);
  }
  if (!("packet" in (envelope || {}))) issues.push("reading_packet_missing");
}

async function inspectReadingArtifact(root, relativePath, expected, claimedSha256 = "") {
  const issues = [];
  let filename;
  try {
    filename = resolveWithin(root, relativePath, "reading artifact path");
  } catch {
    return { ok: false, issues: ["reading_artifact_path_invalid"] };
  }
  let content;
  try {
    content = await readFile(filename, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, issues: ["reading_artifact_missing"] };
    throw error;
  }
  const actualSha256 = sha256(content);
  if (claimedSha256 && claimedSha256 !== actualSha256) issues.push("reading_artifact_hash_mismatch");
  if (path.basename(path.dirname(filename)) !== actualSha256) issues.push("reading_content_address_mismatch");
  let envelope;
  try {
    envelope = JSON.parse(content);
  } catch {
    return { ok: false, issues: [...issues, "reading_artifact_invalid_json"], actualSha256 };
  }
  checkEnvelope(envelope, expected, issues);
  return { ok: issues.length === 0, issues, actualSha256, envelope, filename };
}

export async function inspectReadingCheckpoint({ root, ledger, expected, qaBinding = null }) {
  const normalized = normalizeExpected(expected);
  const stage = ledger?.stages?.sourceReading;
  const issues = [];
  if (!stage || stage.status !== "complete") issues.push("reading_stage_not_complete");
  if (stage?.inputDigest !== normalized.inputDigest) issues.push("reading_input_digest_mismatch");
  if (stage?.sourcePdfSha256 !== normalized.sourcePdfSha256) issues.push("reading_source_pdf_mismatch");
  if (stage?.extractionPagesSha256 !== normalized.extractionPagesSha256) issues.push("reading_extraction_pages_mismatch");
  if (stage?.contractDigest !== normalized.contractDigest) issues.push("reading_contract_mismatch");
  if (stage?.packetVersion !== normalized.packetVersion) issues.push("reading_packet_version_mismatch");
  appendQaBindingIssues(stage, qaBinding, issues, "reading_stage");
  if (!stage?.artifactPath) return { ok: false, status: "stale", issues: [...issues, "reading_artifact_path_missing"] };
  const artifact = await inspectReadingArtifact(root, stage.artifactPath, normalized, stage.artifactSha256);
  issues.push(...artifact.issues);
  appendQaBindingIssues(artifact.envelope, qaBinding, issues, "reading_artifact");
  return { ok: issues.length === 0, status: issues.length ? "stale" : "current", issues: [...new Set(issues)], artifact };
}

async function inspectAuthoringReadingCheckpoint({ root, ledger, qaBinding = null }) {
  const stage = ledger?.stages?.sourceReading;
  const authored = ledger?.stages?.noteAuthoring;
  const extraction = ledger?.stages?.extraction;
  const issues = [];
  if (!stage || stage.status !== "complete") issues.push("reading_stage_not_complete");
  const expectedReadingInputDigest = qaBinding
    ? extractionQaBoundDigest("sourceReading", extraction?.artifacts?.pagesSha256 || "", qaBinding)
    : extraction?.artifacts?.pagesSha256;
  if (stage?.inputDigest !== expectedReadingInputDigest) issues.push("reading_input_digest_mismatch");
  if (stage?.sourcePdfSha256 !== ledger?.pdfSha256) issues.push("reading_source_pdf_mismatch");
  if (stage?.pagesArtifact !== extraction?.artifacts?.pages) issues.push("reading_pages_artifact_mismatch");
  if (!stage?.pagesArtifact) {
    issues.push("reading_pages_artifact_missing");
  } else {
    let pagesFilename;
    try {
      pagesFilename = resolveWithin(root, stage.pagesArtifact, "extraction pages artifact path");
    } catch {
      issues.push("reading_pages_artifact_path_invalid");
    }
    if (pagesFilename) {
      let pagesContent;
      try {
        pagesContent = await readFile(pagesFilename);
      } catch (error) {
        if (error.code === "ENOENT") issues.push("reading_pages_artifact_missing");
        else throw error;
      }
      if (pagesContent) {
        if (sha256(pagesContent) !== extraction?.artifacts?.pagesSha256) issues.push("reading_extraction_artifact_hash_mismatch");
        try {
          const pagesPayload = JSON.parse(pagesContent.toString("utf8"));
          const pageEntries = Array.isArray(pagesPayload) ? pagesPayload : pagesPayload?.pages;
          if (!Array.isArray(pageEntries) || !pageEntries.length) issues.push("reading_extraction_artifact_pages_missing");
          if (!Array.isArray(pagesPayload) && pagesPayload?.paperId !== ledger.paperId) issues.push("reading_extraction_artifact_paper_mismatch");
          if (!Array.isArray(pagesPayload) && pagesPayload?.pdfSha256 !== ledger.pdfSha256) issues.push("reading_extraction_artifact_pdf_mismatch");
        } catch {
          issues.push("reading_extraction_artifact_invalid_json");
        }
      }
    }
  }
  if (!stage?.readingPacket) return { ok: false, status: "stale", issues: [...issues, "reading_artifact_path_missing"] };
  let filename;
  try {
    filename = resolveWithin(root, stage.readingPacket, "reading packet path");
  } catch {
    return { ok: false, status: "stale", issues: [...issues, "reading_artifact_path_invalid"] };
  }
  let content;
  try {
    content = await readFile(filename, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, status: "stale", issues: [...issues, "reading_artifact_missing"] };
    throw error;
  }
  const actualSha256 = sha256(content);
  if (stage.readingPacketSha256 !== actualSha256) issues.push("reading_artifact_hash_mismatch");
  if (authored?.inputDigest && path.basename(path.dirname(filename)) !== authored.inputDigest) issues.push("reading_content_address_mismatch");
  let packet;
  try {
    packet = JSON.parse(content);
  } catch {
    return { ok: false, status: "stale", issues: [...new Set([...issues, "reading_artifact_invalid_json"])], actualSha256 };
  }
  if (packet.paperId !== ledger.paperId) issues.push("reading_paperId_mismatch");
  if (packet.sourcePdfSha256 !== ledger.pdfSha256) issues.push("reading_sourcePdfSha256_mismatch");
  if (packet.extractionPagesSha256 !== extraction?.artifacts?.pagesSha256) issues.push("reading_extractionPagesSha256_mismatch");
  if (packet.schemaVersion !== READING_PACKET_SCHEMA_VERSION || typeof packet.authoringVersion !== "string" || !packet.authoringVersion.trim()) {
    issues.push("reading_packetVersion_mismatch");
  }
  if (authored?.authoringVersion && packet.authoringVersion !== authored.authoringVersion) issues.push("reading_authoringVersion_mismatch");
  appendQaBindingIssues(stage, qaBinding, issues, "reading_stage");
  appendQaBindingIssues(packet, qaBinding, issues, "reading_packet");
  return { ok: issues.length === 0, status: issues.length ? "stale" : "current", issues: [...new Set(issues)], actualSha256, packet, filename };
}

async function inspectMiniReadingCheckpoint({ root, ledger, qaBinding = null }) {
  const stage = ledger?.stages?.sourceReading;
  const authored = ledger?.stages?.noteAuthoring;
  const issues = [];
  if (!stage || stage.status !== "complete") issues.push("reading_stage_not_complete");
  if (stage?.sourcePdfSha256 !== ledger?.pdfSha256) issues.push("reading_source_pdf_mismatch");
  if (stage?.auditVersion !== MINI_READING_AUDIT_VERSION) issues.push("reading_audit_version_mismatch");
  if (stage?.notePath !== authored?.notePath) issues.push("reading_note_path_mismatch");
  if (stage?.noteSha256 !== authored?.noteSha256) issues.push("reading_note_hash_mismatch");
  const canonicalPagesArtifact = authored?.miniPaperId
    ? path.posix.join("mini-atlas", "research", "pages", `${authored.miniPaperId}.json`)
    : "";
  if (!authored?.pagesPath || authored.pagesPath !== canonicalPagesArtifact) issues.push("reading_authored_pages_artifact_mismatch");
  if (!stage?.pagesArtifact) return { ok: false, status: "stale", issues: [...new Set([...issues, "reading_artifact_path_missing"])] };
  if (!authored?.pagesPath || stage.pagesArtifact !== authored.pagesPath) issues.push("reading_pages_artifact_mismatch");
  if (!/^[a-f0-9]{64}$/.test(authored?.pagesSha256 || "")) issues.push("reading_authored_pages_hash_missing");
  if (!/^[a-f0-9]{64}$/.test(stage?.pagesSha256 || "")) issues.push("reading_pages_hash_missing");
  if (stage?.pagesSha256 !== authored?.pagesSha256) issues.push("reading_pages_hash_binding_mismatch");
  let expectedInputDigest = "";
  try {
    const baseInputDigest = miniReadingInputDigest({
      paperId: ledger.paperId,
      sourcePdfSha256: ledger.pdfSha256,
      noteSha256: authored?.noteSha256,
      pagesArtifact: authored?.pagesPath,
      pagesSha256: authored?.pagesSha256
    });
    expectedInputDigest = qaBinding
      ? extractionQaBoundDigest("sourceReading", baseInputDigest, qaBinding)
      : baseInputDigest;
  } catch {
    issues.push("reading_input_digest_inputs_missing");
  }
  if (!expectedInputDigest || stage?.inputDigest !== expectedInputDigest) issues.push("reading_input_digest_mismatch");
  let filename;
  try {
    filename = resolveWithin(root, stage.pagesArtifact, "reading pages artifact path");
  } catch {
    return { ok: false, status: "stale", issues: [...new Set([...issues, "reading_artifact_path_invalid"])] };
  }
  let content;
  let pages;
  try {
    content = await readFile(filename);
    const actualSha256 = sha256(content);
    if (actualSha256 !== authored?.pagesSha256 || actualSha256 !== stage?.pagesSha256) issues.push("reading_pages_hash_mismatch");
    pages = JSON.parse(content.toString("utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, status: "stale", issues: [...new Set([...issues, "reading_artifact_missing"])] };
    issues.push("reading_artifact_invalid_json");
  }
  const pageEntries = Array.isArray(pages) ? pages : pages?.pages;
  if (pages && (!Array.isArray(pageEntries) || !pageEntries.length)) issues.push("reading_artifact_pages_missing");
  appendQaBindingIssues(stage, qaBinding, issues, "reading_stage");
  return {
    ok: issues.length === 0,
    status: issues.length ? "stale" : "current",
    issues: [...new Set(issues)],
    actualSha256: content ? sha256(content) : "",
    filename
  };
}

function missingReadingCheckpoint(ledger) {
  const issues = [];
  if (ledger?.stages?.sourceReading?.status !== "complete") issues.push("reading_stage_not_complete");
  issues.push("reading_artifact_path_missing");
  return { status: "stale", issues: [...new Set(issues)] };
}

function inspectSectionIndexCheckpoint(ledger, qaBinding = null) {
  const stage = ledger?.stages?.sectionIndex;
  const reading = ledger?.stages?.sourceReading;
  const extraction = ledger?.stages?.extraction;
  const authored = ledger?.stages?.noteAuthoring;
  const isMini = authored?.source === "mini-atlas-schema-v2";
  const issues = [];
  if (!stage || stage.status !== "complete") issues.push("section_index_stage_not_complete");
  if (stage?.sourcePdfSha256 !== ledger?.pdfSha256) issues.push("section_index_source_pdf_mismatch");
  appendQaBindingIssues(stage, qaBinding, issues, "section_index");
  if (isMini) {
    if (stage?.auditVersion !== MINI_READING_AUDIT_VERSION) issues.push("section_index_audit_version_mismatch");
    if (!stage?.pagesArtifact || stage.pagesArtifact !== reading?.pagesArtifact || stage.pagesArtifact !== authored?.pagesPath) {
      issues.push("section_index_pages_artifact_mismatch");
    }
    if (!stage?.pagesSha256 || stage.pagesSha256 !== reading?.pagesSha256 || stage.pagesSha256 !== authored?.pagesSha256) {
      issues.push("section_index_pages_hash_mismatch");
    }
    if (!stage?.inputDigest || stage.inputDigest !== reading?.inputDigest) issues.push("section_index_input_digest_mismatch");
  } else {
    if (reading?.artifactPath) {
      if (stage?.inputDigest !== reading.inputDigest) issues.push("section_index_input_digest_mismatch");
      if (stage?.artifactPath !== reading.artifactPath) issues.push("section_index_reading_artifact_mismatch");
      if (!stage?.artifactSha256 || stage.artifactSha256 !== reading.artifactSha256) issues.push("section_index_reading_hash_mismatch");
    } else {
      const expectedInputDigest = qaBinding
        ? extractionQaBoundDigest("sourceReading", extraction?.artifacts?.pagesSha256 || "", qaBinding)
        : extraction?.artifacts?.pagesSha256;
      if (stage?.inputDigest !== expectedInputDigest) issues.push("section_index_input_digest_mismatch");
      if (!stage?.readingPacket || stage.readingPacket !== reading?.readingPacket) issues.push("section_index_reading_artifact_mismatch");
      if (!stage?.readingPacketSha256 || stage.readingPacketSha256 !== reading?.readingPacketSha256) issues.push("section_index_reading_hash_mismatch");
    }
  }
  return { status: issues.length ? "stale" : "current", issues: [...new Set(issues)] };
}

async function findRecoverableReadingArtifact(root, expected) {
  const stageRoot = path.join(root, "research", "ledger", "artifacts", expected.paperId, READING_PACKET_STAGE);
  const entries = await readdir(stageRoot, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = readingPacketRelativePath(expected.paperId, entry.name);
    const inspected = await inspectReadingArtifact(root, relativePath, expected, entry.name);
    if (inspected.ok) return { ...inspected, relativePath };
  }
  return null;
}

function assertLedgerUpstream(ledger, expected) {
  if (ledger?.paperId !== expected.paperId) throw new Error(`${expected.paperId}: ledger identity changed`);
  if (ledger?.pdfSha256 !== expected.sourcePdfSha256) throw new Error(`${expected.paperId}: source PDF changed`);
  if (ledger?.stages?.extraction?.artifacts?.pagesSha256 !== expected.extractionPagesSha256) {
    throw new Error(`${expected.paperId}: extraction pages changed`);
  }
}

async function saveReadingStage(root, ledgerPath, expected, artifactSha256) {
  const latest = JSON.parse(await readFile(ledgerPath, "utf8"));
  assertLedgerUpstream(latest, expected);
  latest.stages ||= {};
  latest.stages.sourceReading = readingStageFromArtifact(expected, artifactSha256);
  latest.stages.sectionIndex = sectionIndexStageFromReading(latest.stages.sourceReading);
  await atomicWriteJson(ledgerPath, latest, { canonical: true });
  return latest.stages.sourceReading;
}

export async function ensureReadingPacket({ root, expected, buildPacket }) {
  const normalized = normalizeExpected(expected);
  const ledgerPath = path.join(root, "research", "ledger", "papers", `${normalized.paperId}.json`);
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  assertLedgerUpstream(ledger, normalized);

  const current = await inspectReadingCheckpoint({ root, ledger, expected: normalized });
  if (current.ok) {
    const sectionIndex = inspectSectionIndexCheckpoint(ledger);
    if (sectionIndex.status === "current") return { status: "skipped", stage: ledger.stages.sourceReading, artifact: current.artifact.envelope };
    const stage = await saveReadingStage(root, ledgerPath, normalized, current.artifact.actualSha256);
    return { status: "recovered", stage, artifact: current.artifact.envelope, previousIssues: sectionIndex.issues };
  }

  const recoverable = await findRecoverableReadingArtifact(root, normalized);
  if (recoverable) {
    const stage = await saveReadingStage(root, ledgerPath, normalized, recoverable.actualSha256);
    return { status: "recovered", stage, artifact: recoverable.envelope, previousIssues: current.issues };
  }

  if (typeof buildPacket !== "function") throw new Error(`${normalized.paperId}: no recoverable reading packet and no builder supplied`);
  const packet = await buildPacket();
  const artifact = readingArtifact(normalized, packet);
  const relativePath = readingPacketRelativePath(normalized.paperId, artifact.artifactSha256);
  await atomicWriteJson(resolveWithin(root, relativePath, "reading artifact path"), artifact.envelope);
  const stage = await saveReadingStage(root, ledgerPath, normalized, artifact.artifactSha256);
  return {
    status: ledger.stages?.sourceReading?.artifactPath ? "rebuilt" : "created",
    stage,
    artifact: artifact.envelope,
    previousIssues: current.issues
  };
}

export async function inspectNoteCheckpoint({ root, ledger, expectedInputDigest = "", qaBinding = null }) {
  const stage = ledger?.stages?.noteAuthoring;
  const issues = [];
  if (!stage || stage.status !== "complete") issues.push("note_stage_not_complete");
  appendQaBindingIssues(stage, qaBinding, issues, "note_stage");
  if (expectedInputDigest && stage?.inputDigest !== expectedInputDigest) issues.push("note_expected_input_digest_mismatch");
  if (!stage?.notePath) return { ok: false, status: "stale", issues: [...issues, "note_path_missing"] };
  let filename;
  try {
    filename = resolveWithin(root, stage.notePath, "note path");
  } catch {
    return { ok: false, status: "stale", issues: [...issues, "note_path_invalid"] };
  }
  let content;
  try {
    content = await readFile(filename, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, status: "missing", issues: [...issues, "note_file_missing"] };
      throw error;
  }
  if (stage.source === "mini-atlas-schema-v2") {
    if (!/^mini-atlas\/data\/notes\/batch-[a-z0-9_-]+\.json$/i.test(stage.notePath || "")) issues.push("note_mini_source_path_invalid");
    let batch;
    try {
      batch = JSON.parse(content);
    } catch {
      return { ok: false, status: "invalid", issues: [...issues, "note_invalid_json"] };
    }
    const authoredMatches = (Array.isArray(batch.papers) ? batch.papers : []).filter((paper) => paper.id === stage.miniPaperId);
    const authored = authoredMatches.length === 1 ? authoredMatches[0] : null;
    if (authoredMatches.length !== 1) issues.push("note_paper_identity_count_mismatch");
    const actualSha256 = authored ? sha256(stableStringify(authored)) : "";
    if (!actualSha256 || stage.noteSha256 !== actualSha256) issues.push("note_file_hash_mismatch");
    if (stage.sourcePdfSha256 !== ledger.pdfSha256) issues.push("note_source_pdf_mismatch");
    const canonicalPagesPath = stage.miniPaperId
      ? path.posix.join("mini-atlas", "research", "pages", `${stage.miniPaperId}.json`)
      : "";
    if (!stage.pagesPath || stage.pagesPath !== canonicalPagesPath) issues.push("note_pages_path_mismatch");
    if (!/^[a-f0-9]{64}$/.test(stage.pagesSha256 || "")) issues.push("note_pages_hash_missing");
    const miniBaseInputDigest = actualSha256 && stage.pagesSha256
      ? sha256(`${ledger.pdfSha256}\0${actualSha256}\0${stage.pagesSha256}`)
      : "";
    const miniExpectedInputDigest = miniBaseInputDigest && qaBinding
      ? extractionQaBoundDigest("noteAuthoring", miniBaseInputDigest, qaBinding)
      : miniBaseInputDigest;
    if (miniExpectedInputDigest && stage.inputDigest !== miniExpectedInputDigest) {
      issues.push("note_input_digest_mismatch");
    }
    return {
      ok: issues.length === 0,
      status: issues.length ? "stale" : "current",
      issues: [...new Set(issues)],
      actualSha256,
      envelope: authored,
      filename
    };
  }
  const actualSha256 = sha256(content);
  if (stage.noteSha256 !== actualSha256) issues.push("note_file_hash_mismatch");
  let envelope;
  try {
    envelope = JSON.parse(content);
  } catch {
    return { ok: false, status: "invalid", issues: [...issues, "note_invalid_json"], actualSha256 };
  }
  if (envelope.paperId !== ledger.paperId || envelope.note?.id !== ledger.paperId) issues.push("note_paper_identity_mismatch");
  appendQaBindingIssues(envelope, qaBinding, issues, "note_envelope");
  appendQaBindingIssues(envelope.note?.provenance, qaBinding, issues, "note_provenance");
  if (envelope.sourcePdfSha256 !== ledger.pdfSha256 || stage.sourcePdfSha256 !== ledger.pdfSha256) issues.push("note_source_pdf_mismatch");
  if (envelope.extractionPagesSha256 !== ledger.stages?.extraction?.artifacts?.pagesSha256) issues.push("note_extraction_pages_mismatch");
  if (envelope.inputDigest !== stage.inputDigest) issues.push("note_input_digest_mismatch");
  if (!/^[a-f0-9]{64}$/.test(envelope.conceptRegistrySha256 || "")
    || envelope.conceptRegistrySha256 !== stage.conceptRegistrySha256) {
    issues.push("note_concept_registry_mismatch");
  }
  if (stage.authoringVersion && envelope.authoringVersion !== stage.authoringVersion) issues.push("note_authoring_version_mismatch");
  return {
    ok: issues.length === 0,
    status: issues.length ? "stale" : "current",
    issues: [...new Set(issues)],
    actualSha256,
    envelope,
    filename
  };
}

function parseCli(argv) {
  const options = {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    check: false,
    json: false,
    papers: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--root") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--root requires a directory");
      options.root = path.resolve(value);
    } else if (argument === "--paper" || argument === "--id") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a paper ID`);
      options.papers.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && !options.check) throw new Error("This command is read-only; pass --check");
  return options;
}

export async function checkProjectCheckpoints({ root, papers = [], allowNeedsReview = true }) {
  const ledgerDir = path.join(root, "research", "ledger", "papers");
  const manifest = await readJsonIfPresent(path.join(root, "research", "corpus", "manifest.v1.json"))
    || { records: [] };
  const manifestById = new Map((manifest.records || []).map((record) => [record.id, record]));
  const names = (await readdir(ledgerDir)).filter((name) => name.endsWith(".json")).sort();
  const wanted = new Set(papers);
  const found = new Set();
  const results = [];
  for (const name of names) {
    const ledger = JSON.parse(await readFile(path.join(ledgerDir, name), "utf8"));
    if (wanted.size && !wanted.has(ledger.paperId)) continue;
    found.add(ledger.paperId);
    const paperResult = { paperId: ledger.paperId, checks: [] };
    const manifestRecord = manifestById.get(ledger.paperId);
    const qaCheckpoint = manifestRecord
      ? await verifyExtractionQaCheckpoint(root, manifest, manifestRecord, ledger, { requireComplete: !allowNeedsReview })
      : { ok: false, state: "stale", reason: "manifest_record_missing" };
    const qaUsable = qaCheckpoint.ok
      && qaCheckpoint.state === "current"
      && (qaCheckpoint.effectiveStatus === "complete"
        || (allowNeedsReview && qaCheckpoint.effectiveStatus === "needs_review"));
    paperResult.checks.push({
      stage: "extractQa",
      status: qaUsable ? "current" : qaCheckpoint.state,
      effectiveStatus: qaCheckpoint.effectiveStatus || null,
      issues: qaUsable ? [] : [qaCheckpoint.reason || "extraction_qa_not_terminal"]
    });
    const qaBinding = qaUsable
      ? extractionQaCheckpointBinding(qaCheckpoint, { allowNeedsReview })
      : null;
    const sectionIndex = inspectSectionIndexCheckpoint(ledger, qaBinding);
    paperResult.checks.push({ stage: "sectionIndex", status: sectionIndex.status, issues: sectionIndex.issues });
    if (ledger.stages?.noteAuthoring?.source === "mini-atlas-schema-v2") {
      const reading = await inspectMiniReadingCheckpoint({ root, ledger, qaBinding });
      paperResult.checks.push({ stage: READING_PACKET_STAGE, status: reading.status, issues: reading.issues });
    } else if (ledger.stages?.sourceReading?.artifactPath) {
      const stage = ledger.stages.sourceReading;
      const reading = await inspectReadingCheckpoint({
        root,
        ledger,
        expected: {
          paperId: ledger.paperId,
          inputDigest: stage.inputDigest,
          sourcePdfSha256: ledger.pdfSha256,
          extractionPagesSha256: ledger.stages?.extraction?.artifacts?.pagesSha256,
          contractDigest: stage.contractDigest,
          packetVersion: stage.packetVersion
        },
        qaBinding
      });
      paperResult.checks.push({ stage: READING_PACKET_STAGE, status: reading.status, issues: reading.issues });
    } else if (ledger.stages?.sourceReading?.readingPacket) {
      const reading = await inspectAuthoringReadingCheckpoint({ root, ledger, qaBinding });
      paperResult.checks.push({ stage: READING_PACKET_STAGE, status: reading.status, issues: reading.issues });
    } else {
      const reading = missingReadingCheckpoint(ledger);
      paperResult.checks.push({ stage: READING_PACKET_STAGE, status: reading.status, issues: reading.issues });
    }
    const note = await inspectNoteCheckpoint({ root, ledger, qaBinding });
    paperResult.checks.push({ stage: "noteAuthoring", status: note.status, issues: note.issues });
    results.push(paperResult);
  }
  const unknownPapers = [...wanted].filter((paperId) => !found.has(paperId)).sort();
  if (unknownPapers.length) throw new Error(`Unknown paper ID(s): ${unknownPapers.join(", ")}`);
  const stale = results.flatMap((paper) => paper.checks.filter((check) => check.status !== "current").map((check) => ({ paperId: paper.paperId, ...check })));
  return {
    scope: "extraction-qa-and-authoring-artifacts",
    ok: stale.length === 0,
    checkedPapers: results.length,
    checkedStages: results.reduce((sum, paper) => sum + paper.checks.length, 0),
    stale,
    results
  };
}

function usage() {
  return "Usage: node scripts/model-note-checkpoints.mjs --check [--paper ID[,ID...]] [--root DIR] [--json]\n\nChecks the current Extraction QA decision plus sectionIndex, sourceReading, and noteAuthoring artifacts; use npm run check:ready for end-to-end release readiness.";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.help) console.log(usage());
    else checkProjectCheckpoints(options).then((result) => {
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(result.ok
        ? `All ${result.checkedStages} extractQa/sectionIndex/sourceReading/noteAuthoring checkpoints are current (scope: ${result.scope}).`
        : `${result.stale.length} of ${result.checkedStages} extractQa/sectionIndex/sourceReading/noteAuthoring checkpoints are stale (scope: ${result.scope}).`);
      if (!result.ok) process.exitCode = 1;
    }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
