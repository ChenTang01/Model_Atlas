import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EXTRACTION_POLICY,
  acquireClaim,
  atomicWriteText,
  extractionCorruptionProfile,
  makeRepairPromotionExtractQaStage,
  repairPromotionExtractionContractIssues,
  sha256,
  stableStringify
} from "./corpus-pipeline.mjs";
import {
  EXTRACTION_REPAIR_ADJUDICATION_VERSION,
  extractionRepairAdjudicationRecordDigest,
  inspectExtractionRepairAdjudication,
  repairAdjudicationInputDigest
} from "./extraction-repair-adjudication.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const PROMOTION_DIR = path.posix.join("research", "ledger", "extraction-repair-promotions");
const QUIESCENCE_DIR = path.posix.join("research", "ledger", "extraction-repair-quiescence");
const MANIFEST_PATH = path.posix.join("research", "corpus", "manifest.v1.json");
const CLAIM_TTL_MINUTES = 60;
const COMMANDS = new Set(["status", "check", "quiesce", "prepare", "commit", "promote", "rollback"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const RECORD_FILE_PATTERN = /^([a-f0-9]{64})\.json$/;
const DOWNSTREAM_STAGES = Object.freeze([
  "sectionIndex",
  "sourceReading",
  "noteAuthoring",
  "quoteAudit",
  "formulaAudit",
  "schemaValidation",
  "contentAudit",
  "sourceAudit",
  "releaseBuild"
]);
const QUIESCENCE_ATTESTATION = "all Atlas ledger-mutating writers for this paper are stopped until this operation completes";

export const EXTRACTION_REPAIR_PROMOTION_VERSION = "extraction-repair-promotion-v1";
export const EXTRACTION_REPAIR_PROMOTION_POLICY = Object.freeze({
  schemaVersion: 1,
  name: "accepted-repair-to-production-transaction",
  adjudicationGate: "current terminal accepted extraction-repair adjudication required before ledger mutation",
  inputBinding: "source, base ledger/extraction, accepted adjudication, candidate four-file bundle, and quiescence token",
  artifacts: "standard production pages.json and text.txt under the promotion input digest",
  transaction: "immutable prepare, before, after, commit, and rollback evidence",
  concurrency: "shared extraction claim plus ledger SHA compare-and-swap; other writers require explicit quiescence",
  invalidation: [...DOWNSTREAM_STAGES],
  rollback: "restore the exact content-addressed before-ledger snapshot without deleting evidence"
});
export const EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256 = sha256(stableStringify(EXTRACTION_REPAIR_PROMOTION_POLICY));
// The v1 transaction producer fingerprint is part of every immutable prepare,
// commit, rollback, and promoted-extraction record.  Keep it frozen when only
// the read-only status/check implementation changes; otherwise existing
// transactions would become unverifiable merely because their inspector was
// upgraded.
export const EXTRACTION_REPAIR_PROMOTION_CODE_SHA256 = "e75fa05f767774d6fb3898c61812bcc7175ae6fe05999a1a64eb475e9b0e512c";

function assertEqual(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSha(value, label) {
  if (!SHA256_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function assertSafeId(value, label = "paper ID") {
  if (!SAFE_ID_PATTERN.test(String(value || ""))) throw new Error(`Unsafe ${label}: ${value}`);
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function absoluteFromRelative(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)
    || relativePath.includes("\\") || path.posix.normalize(relativePath) !== relativePath
    || relativePath.startsWith("../")) throw new Error(`Unsafe relative path: ${relativePath}`);
  const absolute = path.resolve(root, ...relativePath.split("/"));
  const containment = path.relative(root, absolute);
  if (containment.startsWith("..") || path.isAbsolute(containment)) throw new Error(`Path leaves project root: ${relativePath}`);
  return absolute;
}

async function assertRegularFile(filePath, label) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
}

async function hashFile(filePath, label) {
  await assertRegularFile(filePath, label);
  const handle = await open(filePath, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
    }
    return { sha256: hash.digest("hex"), bytes };
  } finally {
    await handle.close();
  }
}

async function readCanonicalJson(root, relativePath, label) {
  const absolute = absoluteFromRelative(root, relativePath);
  await assertRegularFile(absolute, label);
  const bytes = await readFile(absolute);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  const canonical = Buffer.from(`${stableStringify(value, 2)}\n`, "utf8");
  assertEqual(bytes.equals(canonical), `${label} is not canonical stable JSON`);
  return { value, bytes, sha256: sha256(bytes), relativePath };
}

async function readBoundFile(root, relativePath, expectedSha256, label) {
  const identity = await hashFile(absoluteFromRelative(root, relativePath), label);
  assertEqual(identity.sha256 === expectedSha256, `${label} hash mismatch`);
  return { relativePath, ...identity };
}

async function writeExclusive(root, relativePath, bytes) {
  const target = absoluteFromRelative(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
    return { changed: true, path: relativePath, sha256: sha256(bytes) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    await assertRegularFile(target, `existing content-addressed target ${relativePath}`);
    const existing = await readFile(target);
    assertEqual(existing.equals(bytes), `Exclusive-create conflict at ${relativePath}`);
    return { changed: false, path: relativePath, sha256: sha256(bytes) };
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function writeExclusiveJson(root, relativePath, value) {
  return writeExclusive(root, relativePath, Buffer.from(`${stableStringify(value, 2)}\n`, "utf8"));
}

function selectorIndex(manifest) {
  const index = new Map();
  for (const record of manifest.records || []) {
    for (const value of [record.id, record.canonicalDoi, record.doiUrl, ...(record.aliases || [])]) {
      const key = String(value || "").toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
      if (!key) continue;
      if (index.has(key) && index.get(key) !== record.id) throw new Error(`Ambiguous paper selector: ${value}`);
      index.set(key, record.id);
    }
  }
  return index;
}

async function loadPaper(root, selector) {
  const manifest = await readCanonicalJson(root, MANIFEST_PATH, "corpus manifest");
  const key = String(selector || "").toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
  const paperId = selectorIndex(manifest.value).get(key);
  if (!paperId) throw new Error(`Unknown paper selector: ${selector}`);
  const record = manifest.value.records.find((item) => item.id === paperId);
  assertSafeId(record.id);
  const { recordDigest, ...recordBody } = record;
  assertEqual(recordDigest === sha256(stableStringify(recordBody)), `${record.id}: manifest record digest mismatch`);
  const ledgerPath = path.posix.join("research", "ledger", "papers", `${record.id}.json`);
  const ledger = await readCanonicalJson(root, ledgerPath, `${record.id} paper ledger`);
  assertEqual(ledger.value.paperId === record.id && ledger.value.manifestRecordDigest === record.recordDigest
    && ledger.value.pdfSha256 === record.pdf.sha256, `${record.id}: paper ledger identity mismatch`);
  return { manifest: manifest.value, record, ledger, ledgerPath };
}

function quiescenceBodyDigest(value) {
  const { tokenDigest: ignored, ...body } = value;
  return sha256(stableStringify(body));
}

export function promotionQuiescenceRelativePath(paperId, tokenDigest) {
  assertSafeId(paperId);
  assertSha(tokenDigest, "quiescence token digest");
  return path.posix.join(QUIESCENCE_DIR, paperId, `${tokenDigest}.json`);
}

export async function issuePromotionQuiescenceToken({
  root = SCRIPT_ROOT,
  paper,
  issuer,
  ttlMinutes = 15,
  attestWritersStopped = false,
  now = new Date().toISOString()
}) {
  root = path.resolve(root);
  assertEqual(attestWritersStopped === true, "Quiescence issuance requires --attest-writers-stopped");
  assertEqual(typeof issuer === "string" && issuer.trim().length >= 3, "Quiescence issuer is required");
  ttlMinutes = positiveInteger(ttlMinutes, "quiescence TTL");
  assertEqual(ttlMinutes <= 60, "Quiescence TTL cannot exceed 60 minutes");
  assertEqual(!Number.isNaN(Date.parse(now)) && new Date(now).toISOString() === now, "Quiescence issuedAt must be canonical ISO-8601");
  const context = await loadPaper(root, paper);
  const claimPath = path.join(root, "research", "ledger", ".claims", `${context.record.id}.extract.json`);
  const claimExists = await stat(claimPath).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error));
  assertEqual(!claimExists, `${context.record.id}: an extraction/promotion claim is already present`);
  const body = {
    schemaVersion: 1,
    stage: "extractionRepairPromotionQuiescence",
    paperId: context.record.id,
    baseLedgerSha256: context.ledger.sha256,
    issuer: issuer.trim(),
    attestation: QUIESCENCE_ATTESTATION,
    issuedAt: now,
    expiresAt: new Date(Date.parse(now) + ttlMinutes * 60_000).toISOString(),
    nonce: randomUUID()
  };
  const token = { ...body, tokenDigest: sha256(stableStringify(body)) };
  const relativePath = promotionQuiescenceRelativePath(context.record.id, token.tokenDigest);
  const written = await writeExclusiveJson(root, relativePath, token);
  return {
    paperId: context.record.id,
    quiescenceTokenPath: relativePath,
    quiescenceTokenSha256: written.sha256,
    tokenDigest: token.tokenDigest,
    expiresAt: token.expiresAt,
    changed: written.changed
  };
}

async function loadQuiescenceToken(root, relativePath, paperId, { requireActive = true, ledgerSha256 = "" } = {}) {
  const loaded = await readCanonicalJson(root, relativePath, `${paperId} quiescence token`);
  const token = loaded.value;
  assertEqual(token?.schemaVersion === 1 && token.stage === "extractionRepairPromotionQuiescence", `${paperId}: quiescence token schema invalid`);
  assertEqual(token.paperId === paperId && token.attestation === QUIESCENCE_ATTESTATION, `${paperId}: quiescence token identity/attestation invalid`);
  assertEqual(token.tokenDigest === quiescenceBodyDigest(token), `${paperId}: quiescence token digest mismatch`);
  assertEqual(relativePath === promotionQuiescenceRelativePath(paperId, token.tokenDigest), `${paperId}: quiescence token path mismatch`);
  assertEqual(typeof token.issuer === "string" && token.issuer.trim().length >= 3, `${paperId}: quiescence token issuer invalid`);
  assertEqual(!Number.isNaN(Date.parse(token.issuedAt)) && !Number.isNaN(Date.parse(token.expiresAt)), `${paperId}: quiescence token timestamps invalid`);
  const duration = Date.parse(token.expiresAt) - Date.parse(token.issuedAt);
  assertEqual(duration > 0 && duration <= 60 * 60_000, `${paperId}: quiescence token duration invalid`);
  assertEqual(Date.parse(token.issuedAt) <= Date.now() + 60_000, `${paperId}: quiescence token issuedAt is in the future`);
  if (requireActive) assertEqual(Date.parse(token.expiresAt) > Date.now(), `${paperId}: quiescence token expired`);
  if (ledgerSha256) assertEqual(token.baseLedgerSha256 === ledgerSha256, `${paperId}: quiescence token ledger binding mismatch`);
  return { ...loaded, token };
}

function promotionInputDigest(input) {
  return sha256(stableStringify(input));
}

function productionText(pages) {
  return pages.map((page) => `===== PDF PAGE ${page.page} =====\n${page.text}`).join("\n\n") + "\n";
}

function transactionBase(paperId, digest) {
  assertSafeId(paperId);
  assertSha(digest, "promotion input digest");
  return path.posix.join(PROMOTION_DIR, paperId, digest);
}

function artifactBase(paperId, digest) {
  return path.posix.join("research", "ledger", "artifacts", paperId, digest);
}

function contentRecord(body) {
  const record = { ...body };
  record.recordDigest = sha256(stableStringify(record));
  return record;
}

function contentRecordDigest(record) {
  const { recordDigest: ignored, ...body } = record;
  return sha256(stableStringify(body));
}

function recordPath(paperId, promotionDigest, kind, recordDigest) {
  assertSha(recordDigest, `${kind} record digest`);
  return path.posix.join(transactionBase(paperId, promotionDigest), kind, `${recordDigest}.json`);
}

async function loadSingleRecord(root, paperId, promotionDigest, kind, { required = true } = {}) {
  const relativeDirectory = path.posix.join(transactionBase(paperId, promotionDigest), kind);
  const directory = absoluteFromRelative(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" && !required) return null;
    throw error;
  }
  const names = [];
  for (const entry of entries) {
    if (RECORD_FILE_PATTERN.test(entry.name) && entry.isFile()) names.push(entry.name);
    else throw new Error(`${paperId}: unexpected ${kind} transaction entry ${entry.name}`);
  }
  if (!names.length && !required) return null;
  assertEqual(names.length === 1, `${paperId}: expected exactly one ${kind} record, found ${names.length}`);
  const relativePath = path.posix.join(relativeDirectory, names[0]);
  const loaded = await readCanonicalJson(root, relativePath, `${paperId} ${kind} record`);
  assertEqual(loaded.value.recordDigest === contentRecordDigest(loaded.value), `${paperId}: ${kind} record digest mismatch`);
  assertEqual(relativePath === recordPath(paperId, promotionDigest, kind, loaded.value.recordDigest), `${paperId}: ${kind} record path mismatch`);
  return { ...loaded, record: loaded.value };
}

function fault(options, point) {
  if (options?.faultAt === point) throw new Error(`Injected extraction-repair promotion fault at ${point}`);
}

async function loadPromotionBuildContext({ root, paper, repairInputDigest, quiescenceTokenPath }) {
  root = path.resolve(root);
  assertSha(repairInputDigest, "repair input digest");
  const paperContext = await loadPaper(root, paper);
  const inspection = await inspectExtractionRepairAdjudication({
    root,
    paper: paperContext.record.id,
    repairInputDigest,
    requireAdjudicated: true
  });
  assertEqual(inspection.ok && inspection.state === "adjudicated_accepted"
    && inspection.current?.disposition === "accepted", `${paperContext.record.id}: current terminal accepted repair adjudication required`);
  const adjudication = await readCanonicalJson(root, inspection.current.path, `${paperContext.record.id} accepted repair adjudication`);
  assertEqual(adjudication.sha256 === inspection.current.sha256
    && adjudication.value.recordDigest === inspection.current.recordDigest
    && extractionRepairAdjudicationRecordDigest(adjudication.value) === adjudication.value.recordDigest,
  `${paperContext.record.id}: accepted adjudication content binding mismatch`);
  const adjudicationInput = adjudication.value.adjudicationInput;
  assertEqual(adjudication.value.producerVersion === EXTRACTION_REPAIR_ADJUDICATION_VERSION
    && adjudication.value.disposition === "accepted", `${paperContext.record.id}: accepted adjudication schema mismatch`);
  assertEqual(paperContext.ledger.value.stages?.extraction?.inputDigest === adjudicationInput.baseExtraction.inputDigest
    && sha256(stableStringify(paperContext.ledger.value.stages.extraction)) === adjudicationInput.baseExtraction.stageSha256,
  `${paperContext.record.id}: production extraction no longer matches the adjudicated base`);
  const token = await loadQuiescenceToken(root, quiescenceTokenPath, paperContext.record.id, {
    requireActive: true,
    ledgerSha256: paperContext.ledger.sha256
  });
  const candidatePages = await readCanonicalJson(root, adjudicationInput.candidate.pagesPath, `${paperContext.record.id} candidate pages`);
  assertEqual(candidatePages.sha256 === adjudicationInput.candidate.pagesSha256, `${paperContext.record.id}: candidate pages hash mismatch`);
  assertEqual(Array.isArray(candidatePages.value.pages)
    && candidatePages.value.pages.length === paperContext.record.pdf.pageCount
    && candidatePages.value.pages.every((page, index) => page.page === index + 1 && typeof page.text === "string"),
  `${paperContext.record.id}: candidate page sequence invalid`);
  await readBoundFile(root, adjudicationInput.candidate.candidatePath, adjudicationInput.candidate.candidateSha256, `${paperContext.record.id} candidate marker`);
  await readBoundFile(root, adjudicationInput.candidate.textPath, adjudicationInput.candidate.textSha256, `${paperContext.record.id} candidate text`);
  await readBoundFile(root, adjudicationInput.candidate.provenancePath, adjudicationInput.candidate.provenanceSha256, `${paperContext.record.id} candidate provenance`);
  const candidateText = Buffer.from(productionText(candidatePages.value.pages), "utf8");
  assertEqual(sha256(candidateText) === adjudicationInput.candidate.textSha256, `${paperContext.record.id}: candidate pages/text mismatch`);
  const input = {
    schemaVersion: 1,
    stage: "extractionRepairPromotionInput",
    producerVersion: EXTRACTION_REPAIR_PROMOTION_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_PROMOTION_CODE_SHA256,
    policySha256: EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256,
    paperId: paperContext.record.id,
    canonicalDoi: paperContext.record.canonicalDoi,
    manifestRecordDigest: paperContext.record.recordDigest,
    sourcePdf: adjudicationInput.sourcePdf,
    baseLedger: {
      path: paperContext.ledgerPath,
      sha256: paperContext.ledger.sha256
    },
    baseExtraction: adjudicationInput.baseExtraction,
    acceptedAdjudication: {
      path: inspection.current.path,
      sha256: inspection.current.sha256,
      recordDigest: inspection.current.recordDigest,
      adjudicationInputDigest: adjudication.value.adjudicationInputDigest,
      repairInputDigest,
      disposition: "accepted"
    },
    candidate: adjudicationInput.candidate,
    quiescenceToken: {
      path: token.relativePath,
      sha256: token.sha256,
      tokenDigest: token.token.tokenDigest,
      baseLedgerSha256: token.token.baseLedgerSha256,
      issuedAt: token.token.issuedAt,
      expiresAt: token.token.expiresAt
    }
  };
  return { root, ...paperContext, inspection, adjudication, adjudicationInput, token, candidatePages, candidateText, input };
}

export async function buildExtractionRepairPromotionInput(options) {
  return (await loadPromotionBuildContext(options)).input;
}

function makeProductionBundle(context, digest) {
  const pages = context.candidatePages.value.pages;
  const base = context.ledger.value.stages.extraction;
  const repairEvidence = {
    promotionInputDigest: digest,
    acceptedAdjudicationPath: context.input.acceptedAdjudication.path,
    acceptedAdjudicationSha256: context.input.acceptedAdjudication.sha256,
    acceptedAdjudicationRecordDigest: context.input.acceptedAdjudication.recordDigest,
    candidatePagesSha256: context.input.candidate.pagesSha256,
    candidateProvenanceSha256: context.input.candidate.provenanceSha256
  };
  const pagesPayload = {
    schemaVersion: 1,
    paperId: context.record.id,
    canonicalDoi: context.record.canonicalDoi,
    pdfSha256: context.record.pdf.sha256,
    extractor: {
      name: "extraction-repair-promotion",
      version: EXTRACTION_REPAIR_PROMOTION_VERSION,
      codeSha256: EXTRACTION_REPAIR_PROMOTION_CODE_SHA256,
      selectedEngine: "extraction-repair-promotion",
      selectedEngineVersion: EXTRACTION_REPAIR_PROMOTION_VERSION,
      fallbackAttempted: Boolean(base.fallbackAttempted),
      fallbackUsed: Boolean(base.fallbackUsed),
      fallbackReason: "accepted-extraction-repair-promotion",
      primaryCorruptionProfile: base.primaryCorruptionProfile || null,
      fallbackCorruptionProfile: base.fallbackCorruptionProfile || null,
      selectedCorruptionProfile: extractionCorruptionProfile(pages),
      extractionPolicy: EXTRACTION_POLICY,
      repairPromotion: repairEvidence
    },
    pages
  };
  const pagesBytes = Buffer.from(`${stableStringify(pagesPayload, 2)}\n`, "utf8");
  const textBytes = context.candidateText;
  const basePath = artifactBase(context.record.id, digest);
  return {
    pagesPayload,
    pages: { path: path.posix.join(basePath, "pages.json"), sha256: sha256(pagesBytes), bytes: pagesBytes },
    text: { path: path.posix.join(basePath, "text.txt"), sha256: sha256(textBytes), bytes: textBytes }
  };
}

function makePrepareRecord(context, digest, bundle, before) {
  return contentRecord({
    schemaVersion: 1,
    stage: "extractionRepairPromotionPrepare",
    producerVersion: EXTRACTION_REPAIR_PROMOTION_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_PROMOTION_CODE_SHA256,
    policySha256: EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256,
    paperId: context.record.id,
    promotionInputDigest: digest,
    promotionInput: context.input,
    beforeLedger: before,
    output: {
      pagesPath: bundle.pages.path,
      pagesSha256: bundle.pages.sha256,
      textPath: bundle.text.path,
      textSha256: bundle.text.sha256
    },
    preparedAt: context.token.token.issuedAt
  });
}

function invalidatedStage(paperId, sourcePdfSha256, promotionDigest, stage) {
  return {
    status: "invalidated",
    inputDigest: sha256(stableStringify({
      schemaVersion: 1,
      stage,
      paperId,
      sourcePdfSha256,
      promotionInputDigest: promotionDigest
    })),
    sourcePdfSha256,
    invalidatedReason: "extraction_repair_promoted",
    invalidatedByPromotionInputDigest: promotionDigest
  };
}

function makeAfterLedger(context, digest, bundle, prepareBinding) {
  const ledger = structuredClone(context.ledger.value);
  const base = ledger.stages.extraction;
  const pages = context.candidatePages.value.pages;
  const emptyPages = pages.filter((page) => !String(page.text).trim()).map((page) => page.page);
  const totalCharacters = pages.reduce((total, page) => total + String(page.text).length, 0);
  const selectedCorruptionProfile = extractionCorruptionProfile(pages);
  const marker = {
    schemaVersion: 1,
    stage: "extractionRepairPromotion",
    producerVersion: EXTRACTION_REPAIR_PROMOTION_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_PROMOTION_CODE_SHA256,
    policySha256: EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256,
    promotionInputDigest: digest,
    promotionInput: context.input,
    prepare: prepareBinding
  };
  ledger.stages.extraction = {
    status: "complete",
    inputDigest: digest,
    sourcePdfSha256: context.record.pdf.sha256,
    attempts: Number(base.attempts || 0) + 1,
    completedAt: context.token.token.issuedAt,
    pageCount: pages.length,
    totalCharacters,
    emptyPages,
    pageErrors: [],
    parserWarningCount: Number(base.parserWarningCount || 0),
    parserWarningCodes: [...(base.parserWarningCodes || [])],
    selectedEngine: "extraction-repair-promotion",
    selectedEngineVersion: EXTRACTION_REPAIR_PROMOTION_VERSION,
    fallbackAttempted: Boolean(base.fallbackAttempted),
    fallbackUsed: Boolean(base.fallbackUsed),
    fallbackReason: "accepted-extraction-repair-promotion",
    primaryCorruptionProfile: base.primaryCorruptionProfile || null,
    fallbackCorruptionProfile: base.fallbackCorruptionProfile || null,
    selectedCorruptionProfile,
    artifacts: {
      pages: bundle.pages.path,
      pagesSha256: bundle.pages.sha256,
      text: bundle.text.path,
      textSha256: bundle.text.sha256
    },
    repairPromotion: marker
  };
  ledger.stages.extractQa = makeRepairPromotionExtractQaStage(context.record, ledger.stages.extraction);
  for (const stage of DOWNSTREAM_STAGES) {
    ledger.stages[stage] = invalidatedStage(context.record.id, context.record.pdf.sha256, digest, stage);
  }
  return ledger;
}

async function releaseClaim(claim) {
  const current = await readFile(claim.path, "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (!current) return;
  let value;
  try {
    value = JSON.parse(current);
  } catch {
    throw new Error("Shared extraction/promotion claim became invalid before release");
  }
  assertEqual(value.runId === claim.value.runId, "Shared extraction/promotion claim ownership changed before release");
  await unlink(claim.path);
}

async function withSharedClaim(root, paperId, ledgerSha256, callback) {
  const claim = await acquireClaim(root, paperId, ledgerSha256, CLAIM_TTL_MINUTES);
  assertEqual(Boolean(claim), `${paperId}: extraction/promotion claim is held elsewhere`);
  try {
    return await callback(claim);
  } finally {
    await releaseClaim(claim);
  }
}

export async function prepareExtractionRepairPromotion(options) {
  const context = await loadPromotionBuildContext(options);
  const digest = promotionInputDigest(context.input);
  return withSharedClaim(context.root, context.record.id, context.ledger.sha256, async () => {
    const currentLedger = await readCanonicalJson(context.root, context.ledgerPath, `${context.record.id} pre-prepare ledger`);
    assertEqual(currentLedger.sha256 === context.ledger.sha256, `${context.record.id}: ledger changed before prepare`);
    await loadQuiescenceToken(context.root, options.quiescenceTokenPath, context.record.id, {
      requireActive: true,
      ledgerSha256: currentLedger.sha256
    });
    const bundle = makeProductionBundle(context, digest);
    const pagesWrite = await writeExclusive(context.root, bundle.pages.path, bundle.pages.bytes);
    fault(options, "after_output_pages");
    const textWrite = await writeExclusive(context.root, bundle.text.path, bundle.text.bytes);
    fault(options, "after_output_text");
    const beforePath = path.posix.join(transactionBase(context.record.id, digest), "before", `${currentLedger.sha256}.json`);
    const beforeWrite = await writeExclusive(context.root, beforePath, currentLedger.bytes);
    fault(options, "after_before_snapshot");
    const prepare = makePrepareRecord(context, digest, bundle, {
      ledgerPath: context.ledgerPath,
      snapshotPath: beforePath,
      sha256: currentLedger.sha256
    });
    const preparePath = recordPath(context.record.id, digest, "prepare", prepare.recordDigest);
    const prepareWrite = await writeExclusiveJson(context.root, preparePath, prepare);
    const prepareBinding = { path: preparePath, sha256: prepareWrite.sha256, recordDigest: prepare.recordDigest };
    fault(options, "after_prepare_record");
    const afterLedger = makeAfterLedger(context, digest, bundle, prepareBinding);
    const afterBytes = Buffer.from(`${stableStringify(afterLedger, 2)}\n`, "utf8");
    const afterSha256 = sha256(afterBytes);
    const afterPath = path.posix.join(transactionBase(context.record.id, digest), "after", `${afterSha256}.json`);
    const afterWrite = await writeExclusive(context.root, afterPath, afterBytes);
    fault(options, "after_after_snapshot");
    return {
      paperId: context.record.id,
      promotionInputDigest: digest,
      state: "prepared",
      changed: pagesWrite.changed || textWrite.changed || beforeWrite.changed || prepareWrite.changed || afterWrite.changed,
      prepare: prepareBinding,
      before: { path: beforePath, sha256: currentLedger.sha256 },
      after: { path: afterPath, sha256: afterSha256 },
      output: prepare.output
    };
  });
}

async function verifyPromotionInputFiles(root, input) {
  const source = await readBoundFile(root, input.sourcePdf.path, input.sourcePdf.sha256, `${input.paperId} source PDF`);
  assertEqual(source.bytes === input.sourcePdf.bytes, `${input.paperId}: source PDF byte count mismatch`);
  const sourceHandle = await open(absoluteFromRelative(root, input.sourcePdf.path), "r");
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await sourceHandle.read(header, 0, header.length, 0);
    assertEqual(header.subarray(0, bytesRead).toString("ascii") === input.sourcePdf.header
      && input.sourcePdf.header === "%PDF-", `${input.paperId}: source PDF header mismatch`);
  } finally {
    await sourceHandle.close();
  }
  await readBoundFile(root, input.baseExtraction.pagesPath, input.baseExtraction.pagesSha256, `${input.paperId} base pages`);
  await readBoundFile(root, input.baseExtraction.textPath, input.baseExtraction.textSha256, `${input.paperId} base text`);
  const adjudication = await readCanonicalJson(root, input.acceptedAdjudication.path, `${input.paperId} accepted adjudication`);
  assertEqual(adjudication.sha256 === input.acceptedAdjudication.sha256
    && adjudication.value.recordDigest === input.acceptedAdjudication.recordDigest
    && extractionRepairAdjudicationRecordDigest(adjudication.value) === adjudication.value.recordDigest
    && adjudication.value.disposition === "accepted", `${input.paperId}: accepted adjudication changed`);
  const adjudicationInput = adjudication.value.adjudicationInput;
  assertEqual(adjudication.value.adjudicationInputDigest === input.acceptedAdjudication.adjudicationInputDigest
    && repairAdjudicationInputDigest(adjudicationInput) === adjudication.value.adjudicationInputDigest
    && adjudicationInput.repairInputDigest === input.acceptedAdjudication.repairInputDigest
    && adjudicationInput.paperId === input.paperId
    && stableStringify(adjudicationInput.sourcePdf) === stableStringify(input.sourcePdf)
    && stableStringify(adjudicationInput.baseExtraction) === stableStringify(input.baseExtraction)
    && stableStringify(adjudicationInput.candidate) === stableStringify(input.candidate),
  `${input.paperId}: accepted adjudication input binding mismatch`);
  await readBoundFile(root, adjudicationInput.automatedQa.decisionPath,
    adjudicationInput.automatedQa.decisionSha256, `${input.paperId} adjudicated automated QA`);
  await readBoundFile(root, adjudicationInput.repairSpec.path,
    adjudicationInput.repairSpec.sha256, `${input.paperId} adjudicated repair spec`);
  for (const evidence of adjudicationInput.visualQa.sidecars || []) {
    const sidecar = await readCanonicalJson(root, evidence.sidecarPath,
      `${input.paperId} adjudicated page ${evidence.page} visual sidecar`);
    assertEqual(sidecar.sha256 === evidence.sidecarSha256
      && sidecar.value.page === evidence.page
      && sidecar.value.cropPath === evidence.cropPath
      && sidecar.value.cropSha256 === evidence.cropSha256,
    `${input.paperId}: adjudicated page ${evidence.page} visual sidecar binding mismatch`);
    await readBoundFile(root, evidence.cropPath, evidence.cropSha256,
      `${input.paperId} adjudicated page ${evidence.page} visual crop`);
  }
  for (const [pathField, hashField, label] of [
    ["candidatePath", "candidateSha256", "candidate marker"],
    ["pagesPath", "pagesSha256", "candidate pages"],
    ["textPath", "textSha256", "candidate text"],
    ["provenancePath", "provenanceSha256", "candidate provenance"]
  ]) await readBoundFile(root, input.candidate[pathField], input.candidate[hashField], `${input.paperId} ${label}`);
  const token = await loadQuiescenceToken(root, input.quiescenceToken.path, input.paperId, { requireActive: false });
  assertEqual(token.sha256 === input.quiescenceToken.sha256
    && token.token.tokenDigest === input.quiescenceToken.tokenDigest
    && token.token.baseLedgerSha256 === input.baseLedger.sha256
    && token.token.baseLedgerSha256 === input.quiescenceToken.baseLedgerSha256,
  `${input.paperId}: quiescence token changed`);
}

async function loadPreparedTransaction(root, paperId, digest) {
  const prepare = await loadSingleRecord(root, paperId, digest, "prepare");
  const record = prepare.record;
  assertEqual(record.schemaVersion === 1 && record.stage === "extractionRepairPromotionPrepare"
    && record.producerVersion === EXTRACTION_REPAIR_PROMOTION_VERSION
    && record.producerCodeSha256 === EXTRACTION_REPAIR_PROMOTION_CODE_SHA256
    && record.policySha256 === EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256,
  `${paperId}: prepare producer/policy mismatch`);
  assertEqual(record.paperId === paperId && record.promotionInputDigest === digest
    && promotionInputDigest(record.promotionInput) === digest, `${paperId}: prepare input binding mismatch`);
  await verifyPromotionInputFiles(root, record.promotionInput);
  const before = await readCanonicalJson(root, record.beforeLedger.snapshotPath, `${paperId} before-ledger snapshot`);
  assertEqual(before.sha256 === record.beforeLedger.sha256
    && record.beforeLedger.ledgerPath === record.promotionInput.baseLedger.path
    && before.sha256 === record.promotionInput.baseLedger.sha256, `${paperId}: before-ledger binding mismatch`);
  assertEqual(before.value.stages?.extraction?.inputDigest === record.promotionInput.baseExtraction.inputDigest
    && sha256(stableStringify(before.value.stages.extraction)) === record.promotionInput.baseExtraction.stageSha256,
  `${paperId}: before-ledger extraction binding mismatch`);
  const bundle = {
    pages: { path: record.output.pagesPath, sha256: record.output.pagesSha256 },
    text: { path: record.output.textPath, sha256: record.output.textSha256 }
  };
  const promotedPages = await readCanonicalJson(root, bundle.pages.path, `${paperId} promoted pages`);
  assertEqual(promotedPages.sha256 === bundle.pages.sha256, `${paperId}: promoted pages hash mismatch`);
  await readBoundFile(root, bundle.text.path, bundle.text.sha256, `${paperId} promoted text`);
  assertEqual(bundle.text.sha256 === record.promotionInput.candidate.textSha256,
    `${paperId}: promoted text is not the accepted candidate text`);
  const candidatePages = await readCanonicalJson(root, record.promotionInput.candidate.pagesPath, `${paperId} candidate pages`);
  assertEqual(stableStringify(promotedPages.value.pages) === stableStringify(candidatePages.value.pages)
    && promotedPages.value.schemaVersion === 1
    && promotedPages.value.paperId === paperId
    && promotedPages.value.pdfSha256 === record.promotionInput.sourcePdf.sha256
    && promotedPages.value.extractor?.repairPromotion?.promotionInputDigest === digest,
  `${paperId}: promoted pages semantic binding mismatch`);
  const context = {
    root,
    record: {
      id: paperId,
      canonicalDoi: record.promotionInput.canonicalDoi,
      recordDigest: record.promotionInput.manifestRecordDigest,
      pdf: {
        path: record.promotionInput.sourcePdf.path,
        sha256: record.promotionInput.sourcePdf.sha256,
        bytes: record.promotionInput.sourcePdf.bytes,
        pageCount: record.promotionInput.sourcePdf.pageCount
      }
    },
    ledger: { value: before.value, bytes: before.bytes, sha256: before.sha256 },
    ledgerPath: record.beforeLedger.ledgerPath,
    input: record.promotionInput,
    token: { token: { issuedAt: record.promotionInput.quiescenceToken.issuedAt } },
    candidatePages
  };
  const prepareBinding = { path: prepare.relativePath, sha256: prepare.sha256, recordDigest: record.recordDigest };
  const afterLedger = makeAfterLedger(context, digest, bundle, prepareBinding);
  const afterBytes = Buffer.from(`${stableStringify(afterLedger, 2)}\n`, "utf8");
  const afterSha256 = sha256(afterBytes);
  const afterPath = path.posix.join(transactionBase(paperId, digest), "after", `${afterSha256}.json`);
  const after = await readCanonicalJson(root, afterPath, `${paperId} after-ledger snapshot`);
  assertEqual(after.sha256 === afterSha256 && after.bytes.equals(afterBytes), `${paperId}: after-ledger snapshot mismatch`);
  const promotionIssues = repairPromotionExtractionContractIssues(context.record, after.value.stages?.extraction);
  assertEqual(promotionIssues.length === 0, `${paperId}: after-ledger promotion contract invalid (${promotionIssues.join(", ")})`);
  return { prepare, record, before, after, afterPath, afterSha256, bundle, context };
}

function assertTransactionProducer(record, stage, paperId, digest) {
  assertEqual(record?.schemaVersion === 1 && record.stage === stage
    && record.producerVersion === EXTRACTION_REPAIR_PROMOTION_VERSION
    && record.producerCodeSha256 === EXTRACTION_REPAIR_PROMOTION_CODE_SHA256
    && record.policySha256 === EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256
    && record.paperId === paperId
    && record.promotionInputDigest === digest,
  `${paperId}: ${stage} producer/input binding mismatch`);
}

function verifyCommitRecord(commit, prepared, paperId, digest) {
  const record = commit.record;
  assertTransactionProducer(record, "extractionRepairPromotionCommit", paperId, digest);
  assertEqual(record.prepare?.path === prepared.prepare.relativePath
    && record.prepare?.sha256 === prepared.prepare.sha256
    && record.prepare?.recordDigest === prepared.record.recordDigest
    && record.before?.path === prepared.record.beforeLedger.snapshotPath
    && record.before?.sha256 === prepared.record.beforeLedger.sha256
    && record.after?.path === prepared.afterPath
    && record.after?.sha256 === prepared.afterSha256
    && stableStringify(record.output) === stableStringify(prepared.record.output),
  `${paperId}: commit transaction binding mismatch`);
  assertEqual(!Number.isNaN(Date.parse(record.committedAt)), `${paperId}: commit timestamp invalid`);
}

async function verifyRollbackRecord(root, rollback, commit, prepared, paperId, digest) {
  const record = rollback.record;
  assertTransactionProducer(record, "extractionRepairPromotionRollback", paperId, digest);
  assertEqual(record.commit?.path === commit.relativePath
    && record.commit?.sha256 === commit.sha256
    && record.commit?.recordDigest === commit.record.recordDigest
    && record.restoredBefore?.path === prepared.record.beforeLedger.snapshotPath
    && record.restoredBefore?.sha256 === prepared.record.beforeLedger.sha256
    && record.replacedAfter?.path === prepared.afterPath
    && record.replacedAfter?.sha256 === prepared.afterSha256,
  `${paperId}: rollback transaction binding mismatch`);
  assertEqual(!Number.isNaN(Date.parse(record.rolledBackAt)), `${paperId}: rollback timestamp invalid`);
  const token = await loadQuiescenceToken(root, record.quiescenceToken?.path, paperId, {
    requireActive: false,
    ledgerSha256: prepared.afterSha256
  });
  assertEqual(record.quiescenceToken?.sha256 === token.sha256
    && record.quiescenceToken?.tokenDigest === token.token.tokenDigest,
  `${paperId}: rollback quiescence binding mismatch`);
}

async function currentLedgerIdentity(root, relativePath, label) {
  return readCanonicalJson(root, relativePath, label);
}

function committedLedgerIssues(record, current, prepared, digest) {
  const expected = prepared.after.value;
  const issues = [];
  for (const field of ["paperId", "canonicalDoi", "manifestRecordDigest", "pdfSha256"]) {
    if (current.value?.[field] !== expected?.[field]) issues.push(`commit_${field}_mismatch`);
  }
  const currentExtraction = current.value?.stages?.extraction;
  const expectedExtraction = expected?.stages?.extraction;
  if (stableStringify(currentExtraction) !== stableStringify(expectedExtraction)) {
    issues.push("commit_extraction_mismatch");
  } else {
    const contractIssues = repairPromotionExtractionContractIssues(record, currentExtraction);
    if (contractIssues.length) issues.push(...contractIssues.map((issue) => `commit_extraction_${issue}`));
    if (currentExtraction?.repairPromotion?.promotionInputDigest !== digest) {
      issues.push("commit_promotion_digest_mismatch");
    }
  }
  return [...new Set(issues)].sort();
}

export async function commitExtractionRepairPromotion({ root = SCRIPT_ROOT, paper, promotionInputDigest: digest, quiescenceTokenPath, faultAt = "" }) {
  root = path.resolve(root);
  assertSha(digest, "promotion input digest");
  const paperContext = await loadPaper(root, paper);
  assertEqual(paperContext.record.id, paperContext.ledger.value.paperId, "Paper/ledger mismatch");
  const prepared = await loadPreparedTransaction(root, paperContext.record.id, digest);
  assertEqual(quiescenceTokenPath === prepared.record.promotionInput.quiescenceToken.path, `${paperContext.record.id}: commit must use the prepare-bound quiescence token`);
  return withSharedClaim(root, paperContext.record.id, paperContext.ledger.sha256, async () => {
    let current = await currentLedgerIdentity(root, prepared.record.beforeLedger.ledgerPath, `${paperContext.record.id} pre-commit ledger`);
    const existingCommit = await loadSingleRecord(root, paperContext.record.id, digest, "commit", { required: false });
    if (existingCommit) {
      verifyCommitRecord(existingCommit, prepared, paperContext.record.id, digest);
      const issues = committedLedgerIssues(paperContext.record, current, prepared, digest);
      assertEqual(issues.length === 0,
        `${paperContext.record.id}: commit marker exists but current extraction is not the committed promotion (${issues.join(", ")})`);
      return { paperId: paperContext.record.id, promotionInputDigest: digest, state: "committed", changed: false, commitPath: existingCommit.relativePath, commitSha256: existingCommit.sha256 };
    }
    if (current.sha256 === prepared.record.beforeLedger.sha256) {
      await loadQuiescenceToken(root, quiescenceTokenPath, paperContext.record.id, {
        requireActive: true,
        ledgerSha256: current.sha256
      });
      const inspection = await inspectExtractionRepairAdjudication({
        root,
        paper: paperContext.record.id,
        repairInputDigest: prepared.record.promotionInput.acceptedAdjudication.repairInputDigest,
        requireAdjudicated: true
      });
      assertEqual(inspection.ok && inspection.current?.path === prepared.record.promotionInput.acceptedAdjudication.path
        && inspection.current.disposition === "accepted", `${paperContext.record.id}: accepted adjudication is no longer current`);
      current = await currentLedgerIdentity(root, prepared.record.beforeLedger.ledgerPath, `${paperContext.record.id} final pre-commit ledger`);
      assertEqual(current.sha256 === prepared.record.beforeLedger.sha256, `${paperContext.record.id}: ledger SHA CAS failed at commit point`);
      await loadQuiescenceToken(root, quiescenceTokenPath, paperContext.record.id, {
        requireActive: true,
        ledgerSha256: current.sha256
      });
      await atomicWriteText(absoluteFromRelative(root, prepared.record.beforeLedger.ledgerPath), prepared.after.bytes.toString("utf8"));
      current = await currentLedgerIdentity(root, prepared.record.beforeLedger.ledgerPath, `${paperContext.record.id} committed ledger`);
      assertEqual(current.sha256 === prepared.afterSha256, `${paperContext.record.id}: ledger commit verification failed`);
      fault({ faultAt }, "after_ledger_commit");
    } else {
      assertEqual(current.sha256 === prepared.afterSha256, `${paperContext.record.id}: ledger SHA CAS failed before commit`);
    }
    const commit = contentRecord({
      schemaVersion: 1,
      stage: "extractionRepairPromotionCommit",
      producerVersion: EXTRACTION_REPAIR_PROMOTION_VERSION,
      producerCodeSha256: EXTRACTION_REPAIR_PROMOTION_CODE_SHA256,
      policySha256: EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256,
      paperId: paperContext.record.id,
      promotionInputDigest: digest,
      prepare: { path: prepared.prepare.relativePath, sha256: prepared.prepare.sha256, recordDigest: prepared.record.recordDigest },
      before: { path: prepared.record.beforeLedger.snapshotPath, sha256: prepared.record.beforeLedger.sha256 },
      after: { path: prepared.afterPath, sha256: prepared.afterSha256 },
      output: prepared.record.output,
      committedAt: new Date().toISOString()
    });
    const commitPath = recordPath(paperContext.record.id, digest, "commit", commit.recordDigest);
    const written = await writeExclusiveJson(root, commitPath, commit);
    fault({ faultAt }, "after_commit_record");
    return { paperId: paperContext.record.id, promotionInputDigest: digest, state: "committed", changed: true, commitPath, commitSha256: written.sha256 };
  });
}

export async function promoteExtractionRepair(options) {
  const prepared = await prepareExtractionRepairPromotion(options);
  fault(options, "after_prepare");
  const committed = await commitExtractionRepairPromotion({
    root: options.root,
    paper: options.paper,
    promotionInputDigest: prepared.promotionInputDigest,
    quiescenceTokenPath: options.quiescenceTokenPath,
    faultAt: options.faultAt
  });
  return { ...committed, prepared: prepared.prepare, output: prepared.output };
}

export async function rollbackExtractionRepairPromotion({ root = SCRIPT_ROOT, paper, promotionInputDigest: digest, quiescenceTokenPath, faultAt = "" }) {
  root = path.resolve(root);
  assertSha(digest, "promotion input digest");
  const paperContext = await loadPaper(root, paper);
  const prepared = await loadPreparedTransaction(root, paperContext.record.id, digest);
  const commit = await loadSingleRecord(root, paperContext.record.id, digest, "commit");
  verifyCommitRecord(commit, prepared, paperContext.record.id, digest);
  return withSharedClaim(root, paperContext.record.id, paperContext.ledger.sha256, async () => {
    let current = await currentLedgerIdentity(root, prepared.record.beforeLedger.ledgerPath, `${paperContext.record.id} pre-rollback ledger`);
    const existingRollback = await loadSingleRecord(root, paperContext.record.id, digest, "rollback", { required: false });
    if (existingRollback) {
      await verifyRollbackRecord(root, existingRollback, commit, prepared, paperContext.record.id, digest);
      assertEqual(current.sha256 === prepared.record.beforeLedger.sha256, `${paperContext.record.id}: rollback marker exists but ledger is not restored`);
      return { paperId: paperContext.record.id, promotionInputDigest: digest, state: "rolled_back", changed: false, rollbackPath: existingRollback.relativePath, rollbackSha256: existingRollback.sha256 };
    }
    const rollbackToken = await loadQuiescenceToken(root, quiescenceTokenPath, paperContext.record.id, {
      requireActive: current.sha256 === prepared.afterSha256,
      ledgerSha256: prepared.afterSha256
    });
    if (current.sha256 === prepared.afterSha256) {
      assertEqual(current.value.stages?.extraction?.repairPromotion?.promotionInputDigest === digest,
      `${paperContext.record.id}: another extraction replaced this promotion`);
      current = await currentLedgerIdentity(root, prepared.record.beforeLedger.ledgerPath, `${paperContext.record.id} final pre-rollback ledger`);
      assertEqual(current.sha256 === prepared.afterSha256, `${paperContext.record.id}: ledger SHA CAS failed at rollback point`);
      await loadQuiescenceToken(root, quiescenceTokenPath, paperContext.record.id, {
        requireActive: true,
        ledgerSha256: current.sha256
      });
      await atomicWriteText(absoluteFromRelative(root, prepared.record.beforeLedger.ledgerPath), prepared.before.bytes.toString("utf8"));
      current = await currentLedgerIdentity(root, prepared.record.beforeLedger.ledgerPath, `${paperContext.record.id} rolled-back ledger`);
      assertEqual(current.sha256 === prepared.record.beforeLedger.sha256, `${paperContext.record.id}: rollback verification failed`);
      fault({ faultAt }, "after_ledger_rollback");
    } else {
      assertEqual(current.sha256 === prepared.record.beforeLedger.sha256, `${paperContext.record.id}: ledger SHA CAS failed before rollback`);
    }
    const rollback = contentRecord({
      schemaVersion: 1,
      stage: "extractionRepairPromotionRollback",
      producerVersion: EXTRACTION_REPAIR_PROMOTION_VERSION,
      producerCodeSha256: EXTRACTION_REPAIR_PROMOTION_CODE_SHA256,
      policySha256: EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256,
      paperId: paperContext.record.id,
      promotionInputDigest: digest,
      commit: { path: commit.relativePath, sha256: commit.sha256, recordDigest: commit.record.recordDigest },
      restoredBefore: { path: prepared.record.beforeLedger.snapshotPath, sha256: prepared.record.beforeLedger.sha256 },
      replacedAfter: { path: prepared.afterPath, sha256: prepared.afterSha256 },
      quiescenceToken: { path: rollbackToken.relativePath, sha256: rollbackToken.sha256, tokenDigest: rollbackToken.token.tokenDigest },
      rolledBackAt: new Date().toISOString()
    });
    const rollbackPath = recordPath(paperContext.record.id, digest, "rollback", rollback.recordDigest);
    const written = await writeExclusiveJson(root, rollbackPath, rollback);
    return { paperId: paperContext.record.id, promotionInputDigest: digest, state: "rolled_back", changed: true, rollbackPath, rollbackSha256: written.sha256 };
  });
}

export async function inspectExtractionRepairPromotion({ root = SCRIPT_ROOT, paper, promotionInputDigest: digest, requireCommitted = false }) {
  root = path.resolve(root);
  try {
    assertSha(digest, "promotion input digest");
    const context = await loadPaper(root, paper);
    const prepared = await loadPreparedTransaction(root, context.record.id, digest);
    const commit = await loadSingleRecord(root, context.record.id, digest, "commit", { required: false });
    const rollback = await loadSingleRecord(root, context.record.id, digest, "rollback", { required: false });
    if (commit) verifyCommitRecord(commit, prepared, context.record.id, digest);
    if (rollback) {
      assertEqual(Boolean(commit), `${context.record.id}: rollback record exists without a commit record`);
      await verifyRollbackRecord(root, rollback, commit, prepared, context.record.id, digest);
    }
    const current = await currentLedgerIdentity(root, prepared.record.beforeLedger.ledgerPath, `${context.record.id} current ledger`);
    let state = "prepared";
    const issues = [];
    let promotionCurrent = false;
    let ledgerAdvanced = false;
    if (rollback) {
      state = "rolled_back";
      if (current.sha256 !== prepared.record.beforeLedger.sha256) issues.push("rollback_ledger_mismatch");
    } else if (commit) {
      state = "committed";
      const committedIssues = committedLedgerIssues(context.record, current, prepared, digest);
      issues.push(...committedIssues);
      promotionCurrent = committedIssues.length === 0;
      ledgerAdvanced = promotionCurrent && current.sha256 !== prepared.afterSha256;
    } else if (current.sha256 === prepared.afterSha256) {
      state = "ledger_committed_pending_commit_record";
    } else if (current.sha256 !== prepared.record.beforeLedger.sha256) {
      state = "failed_closed";
      issues.push("ledger_cas_identity_unknown");
    }
    if (requireCommitted && state !== "committed") issues.push("current_commit_required");
    return {
      paperId: context.record.id,
      promotionInputDigest: digest,
      state,
      ok: issues.length === 0 && (!requireCommitted || state === "committed"),
      issues,
      promotionCurrent,
      ledgerAdvanced,
      currentLedgerSha256: current.sha256,
      preparePath: prepared.prepare.relativePath,
      commitPath: commit?.relativePath || null,
      rollbackPath: rollback?.relativePath || null,
      beforeLedgerSha256: prepared.record.beforeLedger.sha256,
      afterLedgerSha256: prepared.afterSha256
    };
  } catch (error) {
    return { paperId: String(paper || ""), promotionInputDigest: digest, state: "failed_closed", ok: false, issues: [error.message] };
  }
}

export function parseExtractionRepairPromotionCli(argv) {
  const options = {
    command: "status",
    root: SCRIPT_ROOT,
    paper: "",
    repairInputDigest: "",
    promotionInputDigest: "",
    quiescenceTokenPath: "",
    issuer: "",
    ttlMinutes: 15,
    attestWritersStopped: false,
    json: false,
    help: false
  };
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (COMMANDS.has(argument)) {
      if (command && command !== argument) throw new Error("Only one promotion command may be selected");
      command = argument;
      continue;
    }
    const [name, inline] = argument.startsWith("--") ? argument.split(/=(.*)/s, 2) : [argument, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[++index];
      if (next === undefined || next.startsWith("--")) throw new Error(`${name} requires a value`);
      return next;
    };
    switch (name) {
      case "--root": options.root = path.resolve(value()); break;
      case "--paper": options.paper = value().trim(); break;
      case "--repair-digest": options.repairInputDigest = value().trim(); break;
      case "--promotion-digest": options.promotionInputDigest = value().trim(); break;
      case "--quiescence-token": options.quiescenceTokenPath = value().trim(); break;
      case "--issuer": options.issuer = value().trim(); break;
      case "--ttl-minutes": options.ttlMinutes = positiveInteger(value(), "--ttl-minutes"); break;
      case "--attest-writers-stopped": options.attestWritersStopped = true; break;
      case "--json": options.json = true; break;
      case "--help":
      case "-h": options.help = true; break;
      default: throw new Error(`Unknown argument: ${argument}`);
    }
  }
  options.command = command || options.command;
  if (options.help) return options;
  if (!options.paper) throw new Error("--paper is required");
  if (["prepare", "promote"].includes(options.command)) {
    assertSha(options.repairInputDigest, "--repair-digest");
    if (!options.quiescenceTokenPath) throw new Error("--quiescence-token is required");
  }
  if (["status", "check", "commit", "rollback"].includes(options.command)) assertSha(options.promotionInputDigest, "--promotion-digest");
  if (["commit", "rollback"].includes(options.command) && !options.quiescenceTokenPath) throw new Error("--quiescence-token is required");
  if (options.command === "quiesce") {
    if (!options.issuer) throw new Error("--issuer is required");
    if (!options.attestWritersStopped) throw new Error("--attest-writers-stopped is required");
  }
  return options;
}

export async function runExtractionRepairPromotion(options) {
  switch (options.command) {
    case "quiesce": return issuePromotionQuiescenceToken(options);
    case "prepare": return prepareExtractionRepairPromotion(options);
    case "commit": return commitExtractionRepairPromotion(options);
    case "promote": return promoteExtractionRepair(options);
    case "rollback": return rollbackExtractionRepairPromotion(options);
    case "check": return inspectExtractionRepairPromotion({ ...options, requireCommitted: true });
    default: return inspectExtractionRepairPromotion(options);
  }
}

function usage() {
  return `Usage:
  node scripts/promote-extraction-repair.mjs quiesce --paper ID_OR_DOI --issuer NAME --attest-writers-stopped [--ttl-minutes N] [--json]
  node scripts/promote-extraction-repair.mjs prepare --paper ID_OR_DOI --repair-digest SHA256 --quiescence-token PATH [--json]
  node scripts/promote-extraction-repair.mjs commit --paper ID_OR_DOI --promotion-digest SHA256 --quiescence-token PATH [--json]
  node scripts/promote-extraction-repair.mjs promote --paper ID_OR_DOI --repair-digest SHA256 --quiescence-token PATH [--json]
  node scripts/promote-extraction-repair.mjs status --paper ID_OR_DOI --promotion-digest SHA256 [--json]
  node scripts/promote-extraction-repair.mjs check --paper ID_OR_DOI --promotion-digest SHA256 [--json]
  node scripts/promote-extraction-repair.mjs rollback --paper ID_OR_DOI --promotion-digest SHA256 --quiescence-token PATH [--json]

The quiescence token is an explicit operator attestation that inventory, authoring, audit, and other ledger
writers are stopped; it is not a global process lock. Promotion additionally shares the normal extraction claim
and performs ledger SHA compare-and-swap. prepare never changes the paper ledger. commit performs one atomic
ledger replacement. rollback restores the exact before snapshot and retains every transaction artifact.`;
}

function printResult(result, json) {
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else console.log(`Extraction-repair promotion ${result.paperId || ""}: ${result.state || "quiescence token issued"}.`);
}

async function main() {
  const options = parseExtractionRepairPromotionCli(process.argv.slice(2));
  if (options.help) return console.log(usage());
  const result = await runExtractionRepairPromotion(options);
  printResult(result, options.json);
  if (result.ok === false) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
