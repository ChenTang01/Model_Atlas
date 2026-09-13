import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  atomicWriteText,
  sha256,
  stableStringify
} from "./corpus-pipeline.mjs";
import { verifyExtractionQaCheckpoint } from "./extraction-qa.mjs";
import { modelNoteExtractionQaCheckpointBinding } from "./model-note-extraction-qa.mjs";
import {
  SAFE_MAP_DIRECTORY,
  VISUAL_SCOPE_REPORT_PATH,
  safeMapRelativePath,
  validateSafeMapSpec
} from "./model-note-safe-map.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const TRANSACTION_DIRECTORY = "research/ledger/safe-map-qa-provenance-rebind";
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const COMMANDS = new Set(["status", "prepare", "commit", "rebind"]);

export const SAFE_MAP_QA_REBIND_VERSION = "safe-map-qa-provenance-rebind-v1";
export const SAFE_MAP_QA_REBIND_POLICY = Object.freeze({
  schemaVersion: 1,
  purpose: "rebind reviewed prose-only safe maps to a refreshed authoritative Extraction QA decision",
  eligibility: Object.freeze([
    "current authoritative QA remains needs_review",
    "current authoritative QA has zero validation errors",
    "source PDF, production pages, and production text SHA-256 identities are unchanged",
    "source and unresolved reasons plus manual page requirements are unchanged"
  ]),
  allowedMutations: Object.freeze([
    "visual report entry qaDecision path and sha256",
    "safe-map visualScopeReview sha256 and entryBinding qaDecisionSha256"
  ]),
  preservation: "all visual findings, content-review conclusions, prose scopes, exclusions, and dispositions remain byte-semantically unchanged",
  transaction: "immutable before/after snapshots, prepare record, per-file SHA compare-and-swap, and commit record",
  authority: Object.freeze({
    changesExtractionQaDisposition: false,
    changesNotes: false,
    changesRepairCandidates: false,
    changesPublicData: false
  })
});
export const SAFE_MAP_QA_REBIND_POLICY_SHA256 = sha256(stableStringify(SAFE_MAP_QA_REBIND_POLICY));
export const SAFE_MAP_QA_REBIND_CODE_SHA256 = sha256(await readFile(SCRIPT_PATH));

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertHash(value, label) {
  assertCondition(HASH.test(String(value || "")), `${label} must be a lowercase SHA-256 digest`);
}

function assertPaperId(value) {
  assertCondition(SAFE_ID.test(String(value || "")), `Unsafe paper ID: ${value}`);
}

function resolveWithinRoot(root, relativePath, label) {
  assertCondition(typeof relativePath === "string" && relativePath && !path.isAbsolute(relativePath), `${label} must be a relative path`);
  assertCondition(!relativePath.includes("\\") && path.posix.normalize(relativePath) === relativePath, `${label} must be a normalized POSIX path`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split("/"));
  const containment = path.relative(resolvedRoot, resolved);
  assertCondition(!containment.startsWith("..") && !path.isAbsolute(containment), `${label} escapes the project root`);
  return resolved;
}

function auditBytes(value) {
  return Buffer.from(`${stableStringify(value, 2)}\n`, "utf8");
}

function contentRecord(value) {
  const base = structuredClone(value);
  return { ...base, recordDigest: sha256(stableStringify(base)) };
}

async function readJsonBound(root, relativePath, label) {
  const filename = resolveWithinRoot(root, relativePath, label);
  const bytes = await readFile(filename);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON (${error.message})`);
  }
  return { relativePath, filename, bytes, sha256: sha256(bytes), value };
}

async function readCanonicalAuditRecord(root, relativePath, label) {
  const result = await readJsonBound(root, relativePath, label);
  assertCondition(result.bytes.equals(auditBytes(result.value)), `${label} is not canonical stable JSON`);
  const { recordDigest, ...base } = result.value;
  assertCondition(recordDigest === sha256(stableStringify(base)), `${label} record digest mismatch`);
  return result;
}

async function hashFile(filename) {
  const handle = await open(filename, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    let header = "";
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      if (!position) header = buffer.subarray(0, Math.min(5, bytesRead)).toString("ascii");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return { sha256: hash.digest("hex"), bytes: position, header };
  } finally {
    await handle.close();
  }
}

async function writeImmutable(root, relativePath, bytes, label) {
  const filename = resolveWithinRoot(root, relativePath, label);
  await mkdir(path.dirname(filename), { recursive: true });
  let handle;
  try {
    handle = await open(filename, "wx");
    await handle.writeFile(bytes);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(filename);
    assertCondition(existing.equals(bytes), `${label} already exists with different bytes`);
    return { changed: false, sha256: sha256(existing) };
  } finally {
    await handle?.close();
  }
  return { changed: true, sha256: sha256(bytes) };
}

function replaceUnique(text, before, after, label) {
  if (before === after) return text;
  const first = text.indexOf(before);
  assertCondition(first >= 0, `${label} old binding is absent`);
  assertCondition(text.indexOf(before, first + before.length) < 0, `${label} old binding is not unique`);
  return `${text.slice(0, first)}${after}${text.slice(first + before.length)}`;
}

function exactArrayEqual(left, right) {
  return stableStringify(left ?? null) === stableStringify(right ?? null);
}

function qaArtifact(decision, key) {
  return decision?.evidence?.artifacts?.[key] || null;
}

function validateDecisionTransition({ paperId, reportEntry, oldDecision, oldDecisionSha256, checkpoint, extraction }) {
  const current = checkpoint.decision;
  assertCondition(checkpoint.ok && checkpoint.state === "current" && checkpoint.effectiveStatus === "needs_review",
    `${paperId}: current authoritative QA is not terminal needs_review (${checkpoint.reason || checkpoint.state})`);
  assertCondition(current?.status === "needs_review" && current.disposition === "manual_review_required",
    `${paperId}: current automated QA disposition changed`);
  assertCondition(Array.isArray(current.validationErrors) && current.validationErrors.length === 0,
    `${paperId}: current QA has validation errors`);
  assertCondition(oldDecision?.status === "needs_review" && oldDecision.disposition === "manual_review_required",
    `${paperId}: report-bound QA was not needs_review`);
  assertCondition(Array.isArray(oldDecision.validationErrors) && oldDecision.validationErrors.length === 0,
    `${paperId}: report-bound QA had validation errors`);
  assertCondition(reportEntry.qaDecision?.sha256 === oldDecisionSha256,
    `${paperId}: report-bound QA hash does not match its file`);
  assertCondition(oldDecision.sourcePdfSha256 === current.sourcePdfSha256,
    `${paperId}: source PDF hash changed across QA refresh`);
  assertCondition(qaArtifact(oldDecision, "pagesSha256") === qaArtifact(current, "pagesSha256"),
    `${paperId}: extraction pages hash changed across QA refresh`);
  assertCondition(qaArtifact(oldDecision, "textSha256") === qaArtifact(current, "textSha256"),
    `${paperId}: extraction text hash changed across QA refresh`);
  assertCondition(exactArrayEqual(oldDecision.unresolvedReasons, current.unresolvedReasons),
    `${paperId}: unresolved QA reasons changed across refresh`);
  assertCondition(exactArrayEqual(oldDecision.sourceReasons, current.sourceReasons),
    `${paperId}: source QA reasons changed across refresh`);
  assertCondition(exactArrayEqual(oldDecision.manualReviewRequirements, current.manualReviewRequirements),
    `${paperId}: manual review page requirements changed across refresh`);
  assertCondition(Array.isArray(current.unresolvedReasons) && current.unresolvedReasons.length > 0,
    `${paperId}: current needs_review QA has no unresolved reason`);
  assertCondition(current.unresolvedReasons.length === 1 && reportEntry.qaDecision?.reason === current.unresolvedReasons[0],
    `${paperId}: visual report reason no longer exactly represents current QA`);
  assertCondition(exactArrayEqual(reportEntry.requiredPages, current.manualReviewRequirements?.requiredPages),
    `${paperId}: visual report required pages differ from current QA`);
  assertCondition(current.sourcePdfSha256 === extraction.sourcePdfSha256
    && qaArtifact(current, "pagesSha256") === extraction.artifacts?.pagesSha256
    && qaArtifact(current, "textSha256") === extraction.artifacts?.textSha256,
  `${paperId}: current QA evidence is not bound to the production extraction`);
}

async function loadBuildContext(root) {
  root = path.resolve(root);
  const [manifestFile, catalogFile, reportFile] = await Promise.all([
    readJsonBound(root, "research/corpus/manifest.v1.json", "corpus manifest"),
    readJsonBound(root, "data/atlas_articles.json", "Atlas article catalog"),
    readJsonBound(root, VISUAL_SCOPE_REPORT_PATH, "visual-scope report")
  ]);
  const manifest = manifestFile.value;
  const catalog = catalogFile.value;
  const report = reportFile.value;
  assertCondition(report?.schemaVersion === 1 && report.reportVersion === "extraction-visual-scope-review-v1",
    "Visual-scope report schema/version mismatch");
  assertCondition(report.authority?.changesExtractionQaDisposition === false
    && report.authority?.authorizesAdjudication === false
    && report.authority?.authorizesPromotion === false
    && report.authority?.authorizesPublicRelease === false,
  "Visual-scope report authority is not safely scoped");
  const entries = Array.isArray(report.entries) ? report.entries : [];
  assertCondition(entries.length > 0 && new Set(entries.map((entry) => entry.paperId)).size === entries.length,
    "Visual-scope report entries are missing or duplicated");
  assertCondition(report.accounting?.expectedEntries === entries.length
    && report.accounting?.recordedEntries === entries.length
    && report.accounting?.needsReviewEntries === entries.length,
  "Visual-scope report accounting does not match its entries");

  const safeMapDirectory = resolveWithinRoot(root, SAFE_MAP_DIRECTORY, "safe-map directory");
  const safeMapNames = (await readdir(safeMapDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -5))
    .sort();
  const paperIds = entries.map((entry) => entry.paperId).sort();
  assertCondition(exactArrayEqual(safeMapNames, paperIds), "Visual report and safe-map paper sets differ");

  const manifestById = new Map((manifest.records || []).map((record) => [record.id, record]));
  const catalogById = new Map((catalog.records || []).map((record) => [record.id, record]));
  const items = [];
  for (const reportEntry of [...entries].sort((left, right) => left.paperId.localeCompare(right.paperId))) {
    const paperId = reportEntry.paperId;
    assertPaperId(paperId);
    const manifestRecord = manifestById.get(paperId);
    const catalogRecord = catalogById.get(paperId);
    assertCondition(manifestRecord && catalogRecord, `${paperId}: manifest or catalog record missing`);
    assertCondition(catalogRecord.pdf_sha256 === manifestRecord.pdf?.sha256, `${paperId}: catalog/manifest PDF hash mismatch`);
    const ledgerFile = await readJsonBound(root, `research/ledger/papers/${paperId}.json`, `${paperId} ledger`);
    const ledger = ledgerFile.value;
    const extraction = ledger.stages?.extraction || {};
    assertCondition(ledger.paperId === paperId && ledger.manifestRecordDigest === manifestRecord.recordDigest,
      `${paperId}: ledger identity mismatch`);
    assertCondition(extraction.status === "complete", `${paperId}: production extraction is not complete`);
    const checkpoint = await verifyExtractionQaCheckpoint(root, manifest, manifestRecord, ledger, { requireComplete: false });
    const qaBinding = checkpoint.state === "current" ? modelNoteExtractionQaCheckpointBinding(checkpoint, { allowNeedsReview: true }) : null;
    const oldQaPath = reportEntry.qaDecision?.path;
    const oldQaFile = await readJsonBound(root, oldQaPath, `${paperId} report-bound QA decision`);
    validateDecisionTransition({
      paperId,
      reportEntry,
      oldDecision: oldQaFile.value,
      oldDecisionSha256: oldQaFile.sha256,
      checkpoint,
      extraction
    });

    assertCondition(reportEntry.sourcePdf?.path === manifestRecord.pdf.path
      && reportEntry.sourcePdf?.sha256 === manifestRecord.pdf.sha256,
    `${paperId}: visual report source PDF binding mismatch`);
    const sourceIdentity = await hashFile(resolveWithinRoot(root, manifestRecord.pdf.path, `${paperId} source PDF`));
    assertCondition(sourceIdentity.sha256 === manifestRecord.pdf.sha256
      && sourceIdentity.bytes === manifestRecord.pdf.bytes
      && sourceIdentity.header === "%PDF-", `${paperId}: source PDF bytes changed`);

    const pagesFile = await readJsonBound(root, extraction.artifacts?.pages, `${paperId} production pages`);
    const textBytes = await readFile(resolveWithinRoot(root, extraction.artifacts?.text, `${paperId} production text`));
    assertCondition(pagesFile.sha256 === extraction.artifacts.pagesSha256
      && sha256(textBytes) === extraction.artifacts.textSha256,
    `${paperId}: production artifact bytes changed`);
    assertCondition(reportEntry.productionExtraction?.pagesPath === extraction.artifacts.pages
      && reportEntry.productionExtraction?.pagesSha256 === extraction.artifacts.pagesSha256
      && reportEntry.productionExtraction?.textPath === extraction.artifacts.text
      && reportEntry.productionExtraction?.textSha256 === extraction.artifacts.textSha256,
    `${paperId}: visual report production artifact binding mismatch`);

    const safeMapPath = safeMapRelativePath(paperId);
    const safeMapFile = await readJsonBound(root, safeMapPath, `${paperId} safe map`);
    const oldQaBinding = {
      extractionQaStatus: "needs_review",
      extractionQaDecisionSha256: oldQaFile.sha256
    };
    const oldIssues = validateSafeMapSpec(safeMapFile.value, {
      record: catalogRecord,
      pagesPayload: pagesFile.value,
      pagesSha256: pagesFile.sha256,
      qaBinding: oldQaBinding,
      visualReport: report,
      visualReportSha256: reportFile.sha256
    });
    assertCondition(oldIssues.length === 0,
      `${paperId}: existing safe map is invalid (${oldIssues.slice(0, 5).map((issue) => `${issue.path}: ${issue.reason}`).join("; ")})`);
    assertCondition(safeMapFile.value.visualScopeReview?.sha256 === reportFile.sha256,
      `${paperId}: safe map does not bind the current visual report`);
    assertCondition(safeMapFile.value.visualScopeReview?.entryBinding?.qaDecisionSha256 === oldQaFile.sha256,
      `${paperId}: safe map/report old QA binding mismatch`);

    items.push({
      paperId,
      manifestRecord,
      catalogRecord,
      ledger,
      extraction,
      pagesFile,
      safeMapFile,
      reportEntry,
      oldQaFile,
      checkpoint,
      qaBinding
    });
  }
  return { root, manifest, catalog, reportFile, report, items };
}

function transactionInput(context) {
  return {
    schemaVersion: 1,
    stage: "safeMapQaProvenanceRebindInput",
    producerVersion: SAFE_MAP_QA_REBIND_VERSION,
    producerCodeSha256: SAFE_MAP_QA_REBIND_CODE_SHA256,
    policySha256: SAFE_MAP_QA_REBIND_POLICY_SHA256,
    visualReport: {
      path: VISUAL_SCOPE_REPORT_PATH,
      sha256: context.reportFile.sha256
    },
    papers: context.items.map((item) => ({
      paperId: item.paperId,
      sourcePdfSha256: item.manifestRecord.pdf.sha256,
      pagesPath: item.extraction.artifacts.pages,
      pagesSha256: item.extraction.artifacts.pagesSha256,
      textPath: item.extraction.artifacts.text,
      textSha256: item.extraction.artifacts.textSha256,
      unresolvedReasons: item.checkpoint.decision.unresolvedReasons,
      sourceReasons: item.checkpoint.decision.sourceReasons,
      manualReviewRequirements: item.checkpoint.decision.manualReviewRequirements,
      previousQa: {
        path: item.oldQaFile.relativePath,
        sha256: item.oldQaFile.sha256,
        inputDigest: item.oldQaFile.value.inputDigest,
        producerCodeSha256: item.oldQaFile.value.producerCodeSha256,
        policySha256: item.oldQaFile.value.policySha256
      },
      currentQa: {
        path: item.checkpoint.decisionPath,
        sha256: item.checkpoint.decisionSha256,
        inputDigest: item.checkpoint.inputDigest,
        producerCodeSha256: item.checkpoint.decision.producerCodeSha256,
        policySha256: item.checkpoint.decision.policySha256
      },
      safeMap: {
        path: item.safeMapFile.relativePath,
        sha256: item.safeMapFile.sha256
      }
    }))
  };
}

function buildAfterPayloads(context) {
  const reportAfter = structuredClone(context.report);
  let reportAfterText = context.reportFile.bytes.toString("utf8");
  for (const item of context.items) {
    const afterEntry = reportAfter.entries.find((entry) => entry.paperId === item.paperId);
    assertCondition(Boolean(afterEntry), `${item.paperId}: report entry disappeared during rebind`);
    const beforePathLiteral = `"path": ${JSON.stringify(item.oldQaFile.relativePath)}`;
    const afterPathLiteral = `"path": ${JSON.stringify(item.checkpoint.decisionPath)}`;
    const beforeShaLiteral = `"sha256": ${JSON.stringify(item.oldQaFile.sha256)}`;
    const afterShaLiteral = `"sha256": ${JSON.stringify(item.checkpoint.decisionSha256)}`;
    reportAfterText = replaceUnique(reportAfterText, beforePathLiteral, afterPathLiteral, `${item.paperId} report QA path`);
    reportAfterText = replaceUnique(reportAfterText, beforeShaLiteral, afterShaLiteral, `${item.paperId} report QA hash`);
    afterEntry.qaDecision.path = item.checkpoint.decisionPath;
    afterEntry.qaDecision.sha256 = item.checkpoint.decisionSha256;
  }
  const reportAfterBytes = Buffer.from(reportAfterText, "utf8");
  const parsedReportAfter = JSON.parse(reportAfterText);
  assertCondition(stableStringify(parsedReportAfter) === stableStringify(reportAfter),
    "Visual report changed outside the permitted QA path/hash fields");
  const reportAfterSha256 = sha256(reportAfterBytes);

  const safeMaps = [];
  for (const item of context.items) {
    const beforeSpec = item.safeMapFile.value;
    const afterSpec = structuredClone(beforeSpec);
    let afterText = item.safeMapFile.bytes.toString("utf8");
    afterText = replaceUnique(
      afterText,
      `"sha256": ${JSON.stringify(context.reportFile.sha256)}`,
      `"sha256": ${JSON.stringify(reportAfterSha256)}`,
      `${item.paperId} safe-map visual report hash`
    );
    afterText = replaceUnique(
      afterText,
      `"qaDecisionSha256": ${JSON.stringify(item.oldQaFile.sha256)}`,
      `"qaDecisionSha256": ${JSON.stringify(item.checkpoint.decisionSha256)}`,
      `${item.paperId} safe-map QA hash`
    );
    afterSpec.visualScopeReview.sha256 = reportAfterSha256;
    afterSpec.visualScopeReview.entryBinding.qaDecisionSha256 = item.checkpoint.decisionSha256;
    const afterBytes = Buffer.from(afterText, "utf8");
    const parsedAfterSpec = JSON.parse(afterText);
    assertCondition(stableStringify(parsedAfterSpec) === stableStringify(afterSpec),
      `${item.paperId}: safe map changed outside permitted provenance fields`);
    const issues = validateSafeMapSpec(parsedAfterSpec, {
      record: item.catalogRecord,
      pagesPayload: item.pagesFile.value,
      pagesSha256: item.pagesFile.sha256,
      qaBinding: item.qaBinding,
      visualReport: parsedReportAfter,
      visualReportSha256: reportAfterSha256
    });
    assertCondition(issues.length === 0,
      `${item.paperId}: rebound safe map is invalid (${issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.reason}`).join("; ")})`);
    safeMaps.push({ item, afterSpec: parsedAfterSpec, afterBytes, afterSha256: sha256(afterBytes) });
  }
  return { reportAfter: parsedReportAfter, reportAfterBytes, reportAfterSha256, safeMaps };
}

function snapshotPaths(digest, role, paperId = "") {
  const name = role === "visual_report" ? "visual-report.json" : `${paperId}.json`;
  return {
    before: path.posix.join(TRANSACTION_DIRECTORY, digest, "snapshots", "before", name),
    after: path.posix.join(TRANSACTION_DIRECTORY, digest, "snapshots", "after", name)
  };
}

function makeTargets(context, after, digest) {
  const reportSnapshots = snapshotPaths(digest, "visual_report");
  const targets = [{
    role: "visual_report",
    paperId: null,
    path: VISUAL_SCOPE_REPORT_PATH,
    beforeSha256: context.reportFile.sha256,
    afterSha256: after.reportAfterSha256,
    beforeSnapshotPath: reportSnapshots.before,
    afterSnapshotPath: reportSnapshots.after
  }];
  for (const safeMap of after.safeMaps) {
    const snapshots = snapshotPaths(digest, "safe_map", safeMap.item.paperId);
    targets.push({
      role: "safe_map",
      paperId: safeMap.item.paperId,
      path: safeMap.item.safeMapFile.relativePath,
      beforeSha256: safeMap.item.safeMapFile.sha256,
      afterSha256: safeMap.afterSha256,
      beforeSnapshotPath: snapshots.before,
      afterSnapshotPath: snapshots.after
    });
  }
  return targets;
}

async function singleRecordPath(root, digest, kind, { required = true } = {}) {
  assertHash(digest, "transaction digest");
  const directory = path.posix.join(TRANSACTION_DIRECTORY, digest, kind);
  let names;
  try {
    names = (await readdir(resolveWithinRoot(root, directory, `${kind} directory`)))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT" && !required) return null;
    throw error;
  }
  if (!names.length && !required) return null;
  assertCondition(names.length === 1, `${digest}: expected exactly one ${kind} record, found ${names.length}`);
  return path.posix.join(directory, names[0]);
}

export async function prepareSafeMapQaRebind({ root = DEFAULT_ROOT } = {}) {
  const context = await loadBuildContext(root);
  const input = transactionInput(context);
  const changedPapers = input.papers.filter((paper) => paper.previousQa.sha256 !== paper.currentQa.sha256
    || paper.previousQa.path !== paper.currentQa.path);
  if (!changedPapers.length) {
    return { state: "already_current", changed: false, papers: input.papers.length, visualReportSha256: context.reportFile.sha256 };
  }
  const digest = sha256(stableStringify(input));
  const existingPreparePath = await singleRecordPath(context.root, digest, "prepare", { required: false });
  if (existingPreparePath) {
    const inspection = await inspectSafeMapQaRebind({ root: context.root, transactionInputDigest: digest });
    assertCondition(inspection.ok, `${digest}: existing rebind transaction is not resumable (${inspection.issues.join(", ")})`);
    return { state: inspection.state, changed: false, papers: input.papers.length, transactionInputDigest: digest, preparePath: existingPreparePath };
  }
  const after = buildAfterPayloads(context);
  const targets = makeTargets(context, after, digest);
  const targetBytes = new Map([
    [VISUAL_SCOPE_REPORT_PATH, { before: context.reportFile.bytes, after: after.reportAfterBytes }],
    ...after.safeMaps.map((safeMap) => [safeMap.item.safeMapFile.relativePath, {
      before: safeMap.item.safeMapFile.bytes,
      after: safeMap.afterBytes
    }])
  ]);
  for (const target of targets) {
    const bytes = targetBytes.get(target.path);
    await writeImmutable(context.root, target.beforeSnapshotPath, bytes.before, `${target.path} before snapshot`);
    await writeImmutable(context.root, target.afterSnapshotPath, bytes.after, `${target.path} after snapshot`);
    const current = await readFile(resolveWithinRoot(context.root, target.path, `${target.path} prepare CAS`));
    assertCondition(sha256(current) === target.beforeSha256, `${target.path}: changed while preparing rebind`);
  }
  const prepare = contentRecord({
    schemaVersion: 1,
    stage: "safeMapQaProvenanceRebindPrepare",
    producerVersion: SAFE_MAP_QA_REBIND_VERSION,
    producerCodeSha256: SAFE_MAP_QA_REBIND_CODE_SHA256,
    policySha256: SAFE_MAP_QA_REBIND_POLICY_SHA256,
    transactionInputDigest: digest,
    input,
    targets,
    preparedAt: new Date().toISOString()
  });
  const preparePath = path.posix.join(TRANSACTION_DIRECTORY, digest, "prepare", `${prepare.recordDigest}.json`);
  await writeImmutable(context.root, preparePath, auditBytes(prepare), "safe-map QA rebind prepare record");
  return {
    state: "prepared",
    changed: true,
    papers: input.papers.length,
    changedPapers: changedPapers.length,
    transactionInputDigest: digest,
    preparePath,
    beforeVisualReportSha256: context.reportFile.sha256,
    afterVisualReportSha256: after.reportAfterSha256
  };
}

async function loadPrepared(root, digest) {
  root = path.resolve(root);
  const preparePath = await singleRecordPath(root, digest, "prepare");
  const prepareFile = await readCanonicalAuditRecord(root, preparePath, `${digest} prepare record`);
  const prepare = prepareFile.value;
  assertCondition(prepare.schemaVersion === 1 && prepare.stage === "safeMapQaProvenanceRebindPrepare",
    `${digest}: prepare schema mismatch`);
  assertCondition(prepare.producerVersion === SAFE_MAP_QA_REBIND_VERSION
    && prepare.producerCodeSha256 === SAFE_MAP_QA_REBIND_CODE_SHA256
    && prepare.policySha256 === SAFE_MAP_QA_REBIND_POLICY_SHA256,
  `${digest}: prepare producer or policy mismatch`);
  assertCondition(prepare.transactionInputDigest === digest && sha256(stableStringify(prepare.input)) === digest,
    `${digest}: prepare input digest mismatch`);
  assertCondition(prepare.input?.schemaVersion === 1 && prepare.input.stage === "safeMapQaProvenanceRebindInput"
    && prepare.input.producerVersion === SAFE_MAP_QA_REBIND_VERSION
    && prepare.input.producerCodeSha256 === SAFE_MAP_QA_REBIND_CODE_SHA256
    && prepare.input.policySha256 === SAFE_MAP_QA_REBIND_POLICY_SHA256,
  `${digest}: prepare input schema or producer mismatch`);
  assertCondition(prepare.input.visualReport?.path === VISUAL_SCOPE_REPORT_PATH,
    `${digest}: prepare visual report path mismatch`);
  assertHash(prepare.input.visualReport?.sha256, `${digest} visual report hash`);
  assertCondition(Array.isArray(prepare.input.papers) && prepare.input.papers.length > 0,
    `${digest}: prepare paper bindings are missing`);
  const paperIds = prepare.input.papers.map((paper) => paper.paperId);
  assertCondition(new Set(paperIds).size === paperIds.length, `${digest}: prepare paper bindings are duplicated`);
  for (const paper of prepare.input.papers) {
    assertPaperId(paper.paperId);
    for (const [label, value] of [
      ["source PDF", paper.sourcePdfSha256],
      ["pages", paper.pagesSha256],
      ["text", paper.textSha256],
      ["previous QA", paper.previousQa?.sha256],
      ["current QA", paper.currentQa?.sha256],
      ["safe map", paper.safeMap?.sha256]
    ]) assertHash(value, `${paper.paperId} ${label} hash`);
    assertCondition(paper.safeMap?.path === safeMapRelativePath(paper.paperId),
      `${paper.paperId}: prepare safe-map path mismatch`);
    assertCondition(Array.isArray(paper.unresolvedReasons) && paper.unresolvedReasons.length > 0,
      `${paper.paperId}: prepare unresolved reasons are missing`);
  }
  assertCondition(Array.isArray(prepare.targets) && prepare.targets.length === prepare.input.papers.length + 1,
    `${digest}: prepare target accounting mismatch`);
  assertCondition(prepare.targets[0]?.role === "visual_report"
    && prepare.targets[0]?.paperId === null
    && prepare.targets[0]?.path === VISUAL_SCOPE_REPORT_PATH
    && prepare.targets[0]?.beforeSha256 === prepare.input.visualReport.sha256,
  `${digest}: visual report target binding mismatch`);
  assertCondition(new Set(prepare.targets.map((target) => target.path)).size === prepare.targets.length,
    `${digest}: prepare targets are duplicated`);
  const targets = [];
  for (const target of prepare.targets) {
    if (target.role === "safe_map") {
      const paper = prepare.input.papers.find((entry) => entry.paperId === target.paperId);
      assertCondition(Boolean(paper) && target.path === paper.safeMap.path
        && target.beforeSha256 === paper.safeMap.sha256,
      `${target.paperId}: safe-map target binding mismatch`);
    } else {
      assertCondition(target === prepare.targets[0], `${digest}: unsupported target role ${target.role}`);
    }
    const expectedSnapshots = snapshotPaths(digest, target.role, target.paperId || "");
    assertCondition(target.beforeSnapshotPath === expectedSnapshots.before
      && target.afterSnapshotPath === expectedSnapshots.after,
    `${target.path}: snapshot path binding mismatch`);
    assertHash(target.beforeSha256, `${target.path} before hash`);
    assertHash(target.afterSha256, `${target.path} after hash`);
    const before = await readFile(resolveWithinRoot(root, target.beforeSnapshotPath, `${target.path} before snapshot`));
    const after = await readFile(resolveWithinRoot(root, target.afterSnapshotPath, `${target.path} after snapshot`));
    assertCondition(sha256(before) === target.beforeSha256 && sha256(after) === target.afterSha256,
      `${target.path}: transaction snapshot hash mismatch`);
    const current = await readFile(resolveWithinRoot(root, target.path, `${target.path} current target`));
    const currentSha256 = sha256(current);
    const state = currentSha256 === target.beforeSha256 ? "before"
      : currentSha256 === target.afterSha256 ? "after" : "unknown";
    targets.push({ target, before, after, currentSha256, state });
  }
  return { root, digest, preparePath, prepareFile, prepare, targets };
}

async function loadOptionalCommit(root, digest) {
  const commitPath = await singleRecordPath(root, digest, "commit", { required: false });
  return commitPath ? readCanonicalAuditRecord(root, commitPath, `${digest} commit record`) : null;
}

function verifyCommitRecord(commitFile, prepared) {
  const commit = commitFile.value;
  assertCondition(commit.schemaVersion === 1 && commit.stage === "safeMapQaProvenanceRebindCommit",
    `${prepared.digest}: commit schema mismatch`);
  assertCondition(commit.producerVersion === SAFE_MAP_QA_REBIND_VERSION
    && commit.producerCodeSha256 === SAFE_MAP_QA_REBIND_CODE_SHA256
    && commit.policySha256 === SAFE_MAP_QA_REBIND_POLICY_SHA256,
  `${prepared.digest}: commit producer or policy mismatch`);
  assertCondition(commit.transactionInputDigest === prepared.digest
    && commit.prepare?.path === prepared.preparePath
    && commit.prepare?.sha256 === prepared.prepareFile.sha256
    && commit.prepare?.recordDigest === prepared.prepare.recordDigest,
  `${prepared.digest}: commit prepare binding mismatch`);
  assertCondition(exactArrayEqual(commit.targets, prepared.prepare.targets.map((target) => ({
    path: target.path,
    afterSha256: target.afterSha256
  }))), `${prepared.digest}: commit target binding mismatch`);
}

export async function inspectSafeMapQaRebind({ root = DEFAULT_ROOT, transactionInputDigest } = {}) {
  try {
    const prepared = await loadPrepared(root, transactionInputDigest);
    const commitFile = await loadOptionalCommit(prepared.root, prepared.digest);
    if (commitFile) verifyCommitRecord(commitFile, prepared);
    const unknown = prepared.targets.filter((target) => target.state === "unknown");
    const afterCount = prepared.targets.filter((target) => target.state === "after").length;
    let state = "prepared";
    const issues = [];
    if (unknown.length) {
      state = "failed_closed";
      issues.push(...unknown.map((target) => `unknown_target_sha:${target.target.path}`));
    } else if (afterCount === prepared.targets.length) {
      state = commitFile ? "committed" : "files_committed_pending_record";
    } else if (afterCount > 0) {
      state = "partially_committed";
    } else if (commitFile) {
      state = "failed_closed";
      issues.push("commit_record_exists_but_targets_are_not_installed");
    }
    return {
      ok: issues.length === 0,
      state,
      issues,
      transactionInputDigest: prepared.digest,
      preparePath: prepared.preparePath,
      commitPath: commitFile?.relativePath || null,
      papers: prepared.prepare.input.papers.length,
      targets: prepared.targets.map(({ target, currentSha256, state: targetState }) => ({
        path: target.path,
        state: targetState,
        currentSha256,
        beforeSha256: target.beforeSha256,
        afterSha256: target.afterSha256
      }))
    };
  } catch (error) {
    return {
      ok: false,
      state: "failed_closed",
      issues: [error.message],
      transactionInputDigest: transactionInputDigest || null
    };
  }
}

async function verifyPreparedCurrentQa(prepared) {
  const manifestFile = await readJsonBound(prepared.root, "research/corpus/manifest.v1.json", "corpus manifest");
  const manifest = manifestFile.value;
  const manifestById = new Map((manifest.records || []).map((record) => [record.id, record]));
  for (const paper of prepared.prepare.input.papers) {
    const record = manifestById.get(paper.paperId);
    assertCondition(Boolean(record), `${paper.paperId}: current manifest record missing`);
    const ledgerFile = await readJsonBound(prepared.root, `research/ledger/papers/${paper.paperId}.json`, `${paper.paperId} ledger`);
    const checkpoint = await verifyExtractionQaCheckpoint(prepared.root, manifest, record, ledgerFile.value, { requireComplete: false });
    assertCondition(checkpoint.ok && checkpoint.state === "current" && checkpoint.effectiveStatus === "needs_review",
      `${paper.paperId}: authoritative QA changed after prepare`);
    assertCondition(checkpoint.decision.status === "needs_review" && checkpoint.decision.validationErrors?.length === 0,
      `${paper.paperId}: authoritative QA is no longer zero-error needs_review`);
    assertCondition(checkpoint.decisionPath === paper.currentQa.path
      && checkpoint.decisionSha256 === paper.currentQa.sha256
      && checkpoint.inputDigest === paper.currentQa.inputDigest,
    `${paper.paperId}: authoritative QA identity changed after prepare`);
    assertCondition(checkpoint.decision.sourcePdfSha256 === paper.sourcePdfSha256
      && qaArtifact(checkpoint.decision, "pagesSha256") === paper.pagesSha256
      && qaArtifact(checkpoint.decision, "textSha256") === paper.textSha256
      && exactArrayEqual(checkpoint.decision.unresolvedReasons, paper.unresolvedReasons)
      && exactArrayEqual(checkpoint.decision.sourceReasons, paper.sourceReasons)
      && exactArrayEqual(checkpoint.decision.manualReviewRequirements, paper.manualReviewRequirements),
    `${paper.paperId}: authoritative QA evidence changed after prepare`);
  }
}

async function validateInstalledTargets(prepared) {
  const [catalogFile, reportFile] = await Promise.all([
    readJsonBound(prepared.root, "data/atlas_articles.json", "Atlas article catalog"),
    readJsonBound(prepared.root, VISUAL_SCOPE_REPORT_PATH, "installed visual report")
  ]);
  const catalogById = new Map((catalogFile.value.records || []).map((record) => [record.id, record]));
  for (const paper of prepared.prepare.input.papers) {
    const target = prepared.targets.find((entry) => entry.target.paperId === paper.paperId);
    assertCondition(target?.state === "after" || sha256(await readFile(resolveWithinRoot(prepared.root, target.target.path, `${paper.paperId} installed safe map`))) === target.target.afterSha256,
      `${paper.paperId}: rebound safe map is not installed`);
    const safeMapFile = await readJsonBound(prepared.root, paper.safeMap.path, `${paper.paperId} installed safe map`);
    const pagesFile = await readJsonBound(prepared.root, paper.pagesPath, `${paper.paperId} production pages`);
    const issues = validateSafeMapSpec(safeMapFile.value, {
      record: catalogById.get(paper.paperId),
      pagesPayload: pagesFile.value,
      pagesSha256: paper.pagesSha256,
      qaBinding: { extractionQaStatus: "needs_review", extractionQaDecisionSha256: paper.currentQa.sha256 },
      visualReport: reportFile.value,
      visualReportSha256: reportFile.sha256
    });
    assertCondition(issues.length === 0,
      `${paper.paperId}: installed safe map failed validation (${issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.reason}`).join("; ")})`);
  }
}

export async function commitSafeMapQaRebind({ root = DEFAULT_ROOT, transactionInputDigest, faultAfterTargets = 0 } = {}) {
  const prepared = await loadPrepared(root, transactionInputDigest);
  const existingCommit = await loadOptionalCommit(prepared.root, prepared.digest);
  if (existingCommit) {
    verifyCommitRecord(existingCommit, prepared);
    assertCondition(prepared.targets.every((target) => target.state === "after"),
      `${prepared.digest}: commit exists but target files do not match after snapshots`);
    await verifyPreparedCurrentQa(prepared);
    await validateInstalledTargets(prepared);
    return {
      state: "committed",
      changed: false,
      transactionInputDigest: prepared.digest,
      preparePath: prepared.preparePath,
      commitPath: existingCommit.relativePath,
      papers: prepared.prepare.input.papers.length
    };
  }
  assertCondition(prepared.targets.every((target) => target.state === "before" || target.state === "after"),
    `${prepared.digest}: target CAS state is unknown`);
  await verifyPreparedCurrentQa(prepared);
  let written = 0;
  for (const entry of prepared.targets) {
    const current = await readFile(resolveWithinRoot(prepared.root, entry.target.path, `${entry.target.path} commit CAS`));
    const currentSha256 = sha256(current);
    if (currentSha256 === entry.target.afterSha256) continue;
    assertCondition(currentSha256 === entry.target.beforeSha256, `${entry.target.path}: changed after commit preflight`);
    await atomicWriteText(resolveWithinRoot(prepared.root, entry.target.path, `${entry.target.path} install`), entry.after.toString("utf8"));
    const installed = await readFile(resolveWithinRoot(prepared.root, entry.target.path, `${entry.target.path} installed`));
    assertCondition(sha256(installed) === entry.target.afterSha256, `${entry.target.path}: after snapshot installation failed`);
    written += 1;
    if (faultAfterTargets && written === faultAfterTargets) {
      throw new Error(`Injected safe-map QA rebind fault after ${written} target(s)`);
    }
  }
  const refreshed = await loadPrepared(prepared.root, prepared.digest);
  assertCondition(refreshed.targets.every((target) => target.state === "after"), `${prepared.digest}: not all rebound targets were installed`);
  await verifyPreparedCurrentQa(refreshed);
  await validateInstalledTargets(refreshed);
  const commit = contentRecord({
    schemaVersion: 1,
    stage: "safeMapQaProvenanceRebindCommit",
    producerVersion: SAFE_MAP_QA_REBIND_VERSION,
    producerCodeSha256: SAFE_MAP_QA_REBIND_CODE_SHA256,
    policySha256: SAFE_MAP_QA_REBIND_POLICY_SHA256,
    transactionInputDigest: prepared.digest,
    prepare: {
      path: prepared.preparePath,
      sha256: prepared.prepareFile.sha256,
      recordDigest: prepared.prepare.recordDigest
    },
    targets: prepared.prepare.targets.map((target) => ({ path: target.path, afterSha256: target.afterSha256 })),
    committedAt: new Date().toISOString()
  });
  const commitPath = path.posix.join(TRANSACTION_DIRECTORY, prepared.digest, "commit", `${commit.recordDigest}.json`);
  await writeImmutable(prepared.root, commitPath, auditBytes(commit), "safe-map QA rebind commit record");
  return {
    state: "committed",
    changed: written > 0,
    installedTargets: written,
    transactionInputDigest: prepared.digest,
    preparePath: prepared.preparePath,
    commitPath,
    papers: prepared.prepare.input.papers.length,
    beforeVisualReportSha256: prepared.prepare.targets[0].beforeSha256,
    afterVisualReportSha256: prepared.prepare.targets[0].afterSha256
  };
}

export async function rebindSafeMapQaProvenance({ root = DEFAULT_ROOT } = {}) {
  const prepared = await prepareSafeMapQaRebind({ root });
  if (prepared.state === "already_current") return prepared;
  return commitSafeMapQaRebind({ root, transactionInputDigest: prepared.transactionInputDigest });
}

export function parseSafeMapQaRebindCli(argv) {
  const options = { command: "status", root: DEFAULT_ROOT, transactionInputDigest: "", json: false };
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (COMMANDS.has(argument)) {
      assertCondition(!command || command === argument, "Only one command may be selected");
      command = argument;
      continue;
    }
    const take = () => {
      const value = argv[++index];
      assertCondition(value && !value.startsWith("--"), `${argument} requires a value`);
      return value;
    };
    if (argument === "--root") options.root = path.resolve(take());
    else if (argument === "--digest") options.transactionInputDigest = take();
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.command = command || options.command;
  if (["status", "commit"].includes(options.command) && !options.help) assertHash(options.transactionInputDigest, "--digest");
  return options;
}

function usage() {
  return `Usage:
  node scripts/rebind-safe-map-qa.mjs prepare [--root PATH] [--json]
  node scripts/rebind-safe-map-qa.mjs commit --digest SHA256 [--root PATH] [--json]
  node scripts/rebind-safe-map-qa.mjs rebind [--root PATH] [--json]
  node scripts/rebind-safe-map-qa.mjs status --digest SHA256 [--root PATH] [--json]

prepare writes immutable before/after snapshots and a content-addressed audit record without
changing the visual report or safe maps. commit accepts only exact before/after target hashes,
revalidates current zero-error needs_review QA, and resumes safely after a partial install.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseSafeMapQaRebindCli(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      const result = options.command === "prepare"
        ? await prepareSafeMapQaRebind(options)
        : options.command === "commit"
          ? await commitSafeMapQaRebind(options)
          : options.command === "rebind"
            ? await rebindSafeMapQaProvenance(options)
            : await inspectSafeMapQaRebind(options);
      console.log(options.json ? JSON.stringify(result, null, 2) : stableStringify(result, 2));
      if (result.ok === false || result.state === "failed_closed") process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
