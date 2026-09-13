import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ADDITIONAL_CONCEPTS,
  AUTHORING_SCHEMA_VERSION,
  AUTHORING_VERSION,
  authoringInputDigest,
  buildAuthoredNote,
  buildReadingPacket,
  cleanText,
  curatedInputDigest,
  stableStringify
} from "./model-note-authoring.mjs";
import { validateModelNoteSemantics } from "./model-note-semantic-audit.mjs";
import { canonicalizeMathNotation, formalStructureIssue } from "./model-note-formula-quality.mjs";
import {
  EXTRACTION_QA_BINDING_KEYS,
  extractionQaBoundDigest,
  verifyExtractionQaCheckpoint
} from "./extraction-qa.mjs";
import { modelNoteExtractionQaCheckpointBinding as extractionQaCheckpointBinding } from "./model-note-extraction-qa.mjs";
import {
  MINI_READING_AUDIT_VERSION,
  miniReadingInputDigest
} from "./model-note-checkpoints.mjs";
import { stableStringify as stableLedgerStringify } from "./corpus-pipeline.mjs";
import {
  SAFE_MAP_AUTHORING_MODE,
  SAFE_MAP_BINDING_FIELDS,
  loadBoundSafeMap,
  materializeSafeMapNote,
  safeMapEnvelopeBindings,
  safeMapInputDigest,
  validateBoundSafeMapEnvelope
} from "./model-note-safe-map.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseCli(argv) {
  const options = { limit: 0, from: "", paper: [], jobs: 8, force: false, dryRun: false, check: false, reconcileMini: false, acceptMiniEditorialUpdate: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      return value;
    };
    if (argument === "--limit") options.limit = Number(take());
    else if (argument === "--from") options.from = take();
    else if (argument === "--paper" || argument === "--id") options.paper.push(...take().split(",").map((value) => value.trim()).filter(Boolean));
    else if (argument === "--jobs") options.jobs = Number(take());
    else if (argument === "--force") options.force = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--reconcile-mini") options.reconcileMini = true;
    else if (argument === "--accept-mini-editorial-update") options.acceptMiniEditorialUpdate = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const [label, value] of [["--limit", options.limit || 1], ["--jobs", options.jobs]]) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  }
  if (options.acceptMiniEditorialUpdate && !options.reconcileMini) {
    throw new Error("--accept-mini-editorial-update requires --reconcile-mini");
  }
  return options;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function readJsonIfPresent(filename) {
  try {
    return await readJson(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filename, value, { canonical = false } = {}) {
  await mkdir(path.dirname(filename), { recursive: true });
  const content = canonical
    ? `${stableLedgerStringify(value, 2)}\n`
    : `${JSON.stringify(value, null, 2)}\n`;
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

function mergeConcepts(miniConcepts) {
  const concepts = new Map();
  for (const concept of [...miniConcepts, ...ADDITIONAL_CONCEPTS]) {
    const existing = concepts.get(concept.id);
    if (existing && cleanText(existing.label) !== cleanText(concept.label)) throw new Error(`Concept label conflict: ${concept.id}`);
    const target = existing || { id: concept.id, label: concept.label, aliases: [], related: [] };
    target.aliases = [...new Set([target.label, ...(target.aliases || []), ...(concept.aliases || [])].map(cleanText).filter(Boolean))];
    target.related = [...new Set([...(target.related || []), ...(concept.related || [])])];
    concepts.set(concept.id, target);
  }
  for (const concept of concepts.values()) concept.related = concept.related.filter((id) => concepts.has(id) && id !== concept.id);
  return [...concepts.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function validateGeneratedNote(note, conceptIds, authoringMode = "source-mapped", pages = null, concepts = null) {
  if (!note?.id || !note.question || !note.overview || !note.models?.length) throw new Error(`${note?.id || "unknown"}: incomplete paper note`);
  if (!note.coverage?.pages?.length) throw new Error(`${note.id}: coverage pages required`);
  for (const model of note.models) {
    if (!model.id || !model.name || !model.summary || !model.method || !model.components?.length) throw new Error(`${note.id}/${model.id || "?"}: incomplete model`);
    const componentIds = new Set();
    for (const component of model.components) {
      if (!component.id || componentIds.has(component.id)) throw new Error(`${note.id}/${model.id}: duplicate or blank component ID`);
      componentIds.add(component.id);
      if (!component.label || !component.explanation || !component.formal || component.searchPhrases?.length !== 3 || !component.sources?.length) {
        throw new Error(`${note.id}/${model.id}/${component.id}: incomplete component`);
      }
      const formalIssue = formalStructureIssue(component.formal, component.formalKind);
      if (formalIssue) throw new Error(`${note.id}/${model.id}/${component.id}: malformed formal content (${formalIssue})`);
      for (const [symbolIndex, symbol] of (component.symbols || []).entries()) {
        const symbolIssue = formalStructureIssue(symbol?.symbol, "");
        if (symbolIssue) {
          throw new Error(`${note.id}/${model.id}/${component.id}/symbols[${symbolIndex}]: malformed symbol content (${symbolIssue})`);
        }
      }
      if (!component.conceptBindings?.length || component.conceptBindings.some((binding) => !conceptIds.has(binding.conceptId))) {
        throw new Error(`${note.id}/${model.id}/${component.id}: invalid concept binding`);
      }
    }
  }
  const semantic = validateModelNoteSemantics(note, { authoringMode, pages, concepts });
  if (semantic.errors.length) {
    const sample = semantic.errors.slice(0, 5).map((entry) => `${entry.code}@${entry.path}`).join(", ");
    throw new Error(`${note.id}: semantic validation failed (${semantic.errors.length}): ${sample}`);
  }
  return semantic;
}

function selectorIndex(records) {
  const index = new Map();
  for (const record of records) {
    for (const value of [record.id, record.doi, `https://doi.org/${record.doi}`]) index.set(String(value).toLowerCase(), record.id);
  }
  return index;
}

function selectRecords(records, miniIds, options) {
  const index = selectorIndex(records);
  const include = options.reconcileMini
    ? (record) => miniIds.has(record.id)
    : (record) => !miniIds.has(record.id);
  const selectionLabel = options.reconcileMini ? "frozen Mini" : "non-Mini";
  let selected = records.filter(include).sort((left, right) => left.id.localeCompare(right.id));
  if (options.from) {
    const id = index.get(options.from.toLowerCase());
    if (!id) throw new Error(`Unknown --from selector: ${options.from}`);
    const start = selected.findIndex((record) => record.id === id);
    if (start < 0) throw new Error(`--from selects ${selectionLabel} paper ${id}; choose a paper in the active mode`);
    selected = selected.slice(start);
  }
  if (options.paper.length) {
    const wanted = new Set(options.paper.map((selector) => {
      const id = index.get(selector.toLowerCase());
      if (!id) throw new Error(`Unknown paper selector: ${selector}`);
      if (!include(records.find((record) => record.id === id))) {
        throw new Error(`Paper selector ${selector} resolves to ${selectionLabel} paper ${id}, which is outside the active mode`);
      }
      return id;
    }));
    selected = selected.filter((record) => wanted.has(record.id));
  }
  if (options.limit) selected = selected.slice(0, options.limit);
  return selected;
}

function resolveWithinRoot(root, relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a relative project path`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split("/"));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes the project root`);
  }
  return resolved;
}

function miniQaBoundStages(ledger, qaBinding) {
  const authored = ledger.stages?.noteAuthoring;
  if (authored?.source !== "mini-atlas-schema-v2" || authored.status !== "complete"
    || authored.sourcePdfSha256 !== ledger.pdfSha256 || !/^[a-f0-9]{64}$/.test(authored.noteSha256 || "")
    || !authored.notePath || !authored.miniPaperId) {
    throw new Error(`${ledger.paperId}: Mini note checkpoint is incomplete or stale`);
  }
  const pagesArtifact = path.posix.join("mini-atlas", "research", "pages", `${authored.miniPaperId}.json`);
  if (authored.pagesPath !== pagesArtifact || !/^[a-f0-9]{64}$/.test(authored.pagesSha256 || "")) {
    throw new Error(`${ledger.paperId}: Mini frozen-page binding is missing or invalid`);
  }
  const noteBaseInputDigest = sha256(`${ledger.pdfSha256}\0${authored.noteSha256}\0${authored.pagesSha256}`);
  const readingBaseInputDigest = miniReadingInputDigest({
    paperId: ledger.paperId,
    sourcePdfSha256: ledger.pdfSha256,
    noteSha256: authored.noteSha256,
    pagesArtifact,
    pagesSha256: authored.pagesSha256
  });
  const readingInputDigest = extractionQaBoundDigest("sourceReading", readingBaseInputDigest, qaBinding);
  return {
    noteAuthoring: {
      ...authored,
      inputDigest: extractionQaBoundDigest("noteAuthoring", noteBaseInputDigest, qaBinding),
      ...qaBinding
    },
    sectionIndex: {
      status: "complete",
      auditVersion: MINI_READING_AUDIT_VERSION,
      inputDigest: readingInputDigest,
      sourcePdfSha256: ledger.pdfSha256,
      pagesArtifact,
      pagesSha256: authored.pagesSha256,
      ...qaBinding,
      source: "Mini Atlas editorial fixture"
    },
    sourceReading: {
      status: "complete",
      auditVersion: MINI_READING_AUDIT_VERSION,
      inputDigest: readingInputDigest,
      sourcePdfSha256: ledger.pdfSha256,
      pagesArtifact,
      pagesSha256: authored.pagesSha256,
      notePath: authored.notePath,
      noteSha256: authored.noteSha256,
      ...qaBinding,
      mode: "Frozen Mini Atlas editorial source map"
    }
  };
}

function miniAuthoredNote(paper) {
  return {
    id: paper.id,
    question: paper.question,
    overview: paper.overview,
    modelTypes: paper.modelTypes,
    coverage: paper.coverage,
    models: paper.models
  };
}

async function expectedMiniReconciliation(root, manifest, manifestRecord, record, miniPaper, ledger, options = {}) {
  const extraction = ledger.stages?.extraction;
  if (!manifestRecord || manifestRecord.id !== record.id || manifestRecord.canonicalDoi !== record.doi
    || manifestRecord.pdf?.sha256 !== record.pdf_sha256) {
    throw new Error(`${record.id}: catalog or manifest identity is stale`);
  }
  if (ledger.paperId !== record.id || ledger.canonicalDoi !== record.doi || ledger.pdfSha256 !== record.pdf_sha256
    || extraction?.status !== "complete" || extraction.sourcePdfSha256 !== record.pdf_sha256
    || !extraction.artifacts?.pagesSha256) {
    throw new Error(`${record.id}: ledger, extraction, paper, or PDF identity is stale`);
  }
  if (miniPaper?.sourceId !== record.id || miniPaper.sha256 !== record.pdf_sha256) {
    throw new Error(`${record.id}: frozen Mini source mapping or PDF identity is stale`);
  }
  const qaCheckpoint = await verifyExtractionQaCheckpoint(root, manifest, manifestRecord, ledger);
  if (!qaCheckpoint.ok) {
    return {
      blocked: {
        id: record.id,
        status: qaCheckpoint.state === "stale" ? "stale" : "blocked",
        reason: `Extraction QA is not release-ready (${qaCheckpoint.reason || qaCheckpoint.state})`
      }
    };
  }
  const qaBinding = extractionQaCheckpointBinding(qaCheckpoint);
  const authored = ledger.stages?.noteAuthoring;
  if (authored?.miniPaperId !== miniPaper.id) throw new Error(`${record.id}: Mini note identity is stale`);
  const expectedNote = miniAuthoredNote(miniPaper);
  const expectedNoteSha256 = sha256(stableStringify(expectedNote));
  if (!/^mini-atlas\/data\/notes\/batch-[a-z0-9_-]+\.json$/i.test(authored.notePath || "")) {
    throw new Error(`${record.id}: Mini note path binding is stale`);
  }
  const batch = await readJson(resolveWithinRoot(root, authored.notePath, `${record.id}: Mini note source`));
  const matchingNotes = (Array.isArray(batch?.papers) ? batch.papers : []).filter((paper) => paper.id === miniPaper.id);
  if (matchingNotes.length !== 1 || stableStringify(matchingNotes[0]) !== stableStringify(expectedNote)) {
    throw new Error(`${record.id}: Mini note source differs from its frozen editorial fixture`);
  }
  const noteChanged = authored.noteSha256 !== expectedNoteSha256;
  if (noteChanged && !options.acceptMiniEditorialUpdate) {
    throw new Error(`${record.id}: Mini note source binding is stale; review the editorial change and rerun with --accept-mini-editorial-update`);
  }
  if (noteChanged && !/^[a-f0-9]{64}$/.test(authored.noteSha256 || "")) {
    throw new Error(`${record.id}: previous Mini note hash is missing or invalid`);
  }
  const pagesPath = path.posix.join("mini-atlas", "research", "pages", `${miniPaper.id}.json`);
  if (authored.pagesPath !== pagesPath) throw new Error(`${record.id}: Mini frozen-page path is stale`);
  const pagesBytes = await readFile(resolveWithinRoot(root, pagesPath, `${record.id}: Mini frozen pages`));
  if (sha256(pagesBytes) !== authored.pagesSha256) throw new Error(`${record.id}: Mini frozen-page hash is stale`);
  let pagesPayload;
  try {
    pagesPayload = JSON.parse(pagesBytes.toString("utf8"));
  } catch {
    throw new Error(`${record.id}: Mini frozen-page artifact is invalid JSON`);
  }
  const pages = Array.isArray(pagesPayload) ? pagesPayload : pagesPayload?.pages;
  if (!Array.isArray(pages) || !pages.length) throw new Error(`${record.id}: Mini frozen-page artifact contains no pages`);
  const currentLedger = noteChanged ? structuredClone(ledger) : ledger;
  if (noteChanged) {
    const history = Array.isArray(authored.editorialUpdateHistory) ? authored.editorialUpdateHistory : [];
    currentLedger.stages.noteAuthoring = {
      ...authored,
      status: "complete",
      inputDigest: sha256(`${ledger.pdfSha256}\0${expectedNoteSha256}\0${authored.pagesSha256}`),
      noteSha256: expectedNoteSha256,
      editorialUpdateHistory: [...history, {
        schemaVersion: 1,
        type: "explicit-mini-editorial-update",
        previousNoteSha256: authored.noteSha256,
        acceptedNoteSha256: expectedNoteSha256,
        miniPaperId: miniPaper.id,
        notePath: authored.notePath,
        acceptance: "--reconcile-mini --accept-mini-editorial-update"
      }]
    };
    delete currentLedger.stages.noteAuthoring.invalidatedReason;
  }
  const stages = miniQaBoundStages(currentLedger, qaBinding);
  return { qaBinding, stages, noteChanged };
}

function miniStagesCurrent(ledger, expected) {
  return ["noteAuthoring", "sectionIndex", "sourceReading"]
    .every((stage) => stableStringify(ledger.stages?.[stage]) === stableStringify(expected[stage]));
}

function invalidateMiniAuditStages(ledger, qaBinding) {
  const authored = ledger.stages.noteAuthoring;
  const inputDigest = sha256(stableStringify({
    stage: "miniQaReconciliation",
    sourcePdfSha256: ledger.pdfSha256,
    extractionPagesSha256: ledger.stages.extraction.artifacts.pagesSha256,
    noteSha256: authored.noteSha256,
    ...qaBinding
  }));
  for (const stage of ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"]) {
    ledger.stages[stage] = {
      status: "pending",
      inputDigest,
      sourcePdfSha256: ledger.pdfSha256,
      ...qaBinding,
      reason: "Mini authoring checkpoint rebound to current Extraction QA; audit must be rerun."
    };
  }
}

async function reconcileMiniOne(record, manifest, manifestRecord, miniPaper, options, root) {
  const ledgerPath = path.join(root, "research", "ledger", "papers", `${record.id}.json`);
  const ledger = await readJson(ledgerPath);
  const prepared = await expectedMiniReconciliation(root, manifest, manifestRecord, record, miniPaper, ledger, options);
  if (prepared.blocked) return prepared.blocked;
  if (miniStagesCurrent(ledger, prepared.stages)) return { id: record.id, status: "current" };
  if (options.check) return { id: record.id, status: "stale", reason: "Mini checkpoint is not bound to current Extraction QA" };
  if (options.dryRun) return { id: record.id, status: "would-reconcile" };

  const latest = await readJson(ledgerPath);
  const refreshed = await expectedMiniReconciliation(root, manifest, manifestRecord, record, miniPaper, latest, options);
  if (refreshed.blocked) return refreshed.blocked;
  if (miniStagesCurrent(latest, refreshed.stages)) return { id: record.id, status: "current" };
  Object.assign(latest.stages, refreshed.stages);
  invalidateMiniAuditStages(latest, refreshed.qaBinding);
  await atomicWrite(ledgerPath, latest, { canonical: true });

  const saved = await readJson(ledgerPath);
  const verified = await expectedMiniReconciliation(root, manifest, manifestRecord, record, miniPaper, saved, options);
  if (verified.blocked || !miniStagesCurrent(saved, verified.stages)) {
    throw new Error(`${record.id}: Mini QA reconciliation did not commit a current checkpoint`);
  }
  return { id: record.id, status: "reconciled", ...(refreshed.noteChanged ? { editorialUpdateAccepted: true } : {}) };
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function sourceReadingDigest(ledger, qaBinding) {
  return extractionQaBoundDigest(
    "sourceReading",
    ledger.stages.extraction?.artifacts?.pagesSha256 || "",
    qaBinding
  );
}

function qaBindingsMatch(value, expected) {
  return value?.extractionQaStatus === expected.extractionQaStatus
    && value?.extractionQaAutomatedStatus === expected.extractionQaAutomatedStatus
    && value?.extractionQaInputDigest === expected.extractionQaInputDigest
    && value?.extractionQaDecisionPath === expected.extractionQaDecisionPath
    && value?.extractionQaDecisionSha256 === expected.extractionQaDecisionSha256
    && value?.extractionQaAdjudicationStatus === expected.extractionQaAdjudicationStatus
    && value?.extractionQaAdjudicationPath === expected.extractionQaAdjudicationPath
    && value?.extractionQaAdjudicationSha256 === expected.extractionQaAdjudicationSha256;
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function hasCompleteQaBinding(value) {
  if (!value || EXTRACTION_QA_BINDING_KEYS.some((key) => !hasOwn(value, key))) return false;
  if (value.extractionQaStatus !== "complete"
    || !["complete", "needs_review"].includes(value.extractionQaAutomatedStatus)
    || !/^[a-f0-9]{64}$/.test(value.extractionQaInputDigest || "")
    || typeof value.extractionQaDecisionPath !== "string"
    || !value.extractionQaDecisionPath
    || !/^[a-f0-9]{64}$/.test(value.extractionQaDecisionSha256 || "")) {
    return false;
  }
  if (value.extractionQaAutomatedStatus === "complete") {
    return value.extractionQaAdjudicationStatus === "not_required"
      && value.extractionQaAdjudicationPath === null
      && value.extractionQaAdjudicationSha256 === null;
  }
  return value.extractionQaAdjudicationStatus === "accepted"
    && typeof value.extractionQaAdjudicationPath === "string"
    && Boolean(value.extractionQaAdjudicationPath)
    && /^[a-f0-9]{64}$/.test(value.extractionQaAdjudicationSha256 || "");
}

function hasSafeMapBinding(envelope) {
  return SAFE_MAP_BINDING_FIELDS.some((field) => hasOwn(envelope, field)
    || hasOwn(envelope?.note?.provenance, field));
}

function generatedProfile(record) {
  return record.detail_level === "model_map"
    ? {
        authoringMode: "metadata-enriched",
        source: "legacy-deep-map-plus-full-source",
        sourceTier: "audited-metadata-plus-source-map",
        editorialStatus: "PDF-audited catalog map with automated component bindings"
      }
    : {
        authoringMode: "source-mapped",
        source: "full-source-section-map",
        sourceTier: "full-text-source-map",
        editorialStatus: "automated full-text source map"
      };
}

function generatedQaOnlyRebindEligible({
  existing,
  existingNoteSha256,
  ledger,
  manifest,
  manifestRecord,
  record,
  extraction,
  pagesPayload,
  baseInputDigest,
  conceptRegistrySha256,
  notePath,
  root,
  qaBinding,
  safeMapBound
}) {
  if (!existing || safeMapBound || hasSafeMapBinding(existing)) return false;
  if (existing.authoringVersion !== AUTHORING_VERSION || existing.authoringMode === "curated") return false;
  if (qaBindingsMatch(existing, qaBinding)) return false;

  const profile = generatedProfile(record);
  const provenance = existing.note?.provenance;
  const authored = ledger.stages?.noteAuthoring;
  const relativeNotePath = path.relative(root, notePath).replaceAll(path.sep, "/");
  const pagesIdentityCurrent = !Array.isArray(pagesPayload)
    && pagesPayload?.paperId === record.id
    && pagesPayload?.pdfSha256 === record.pdf_sha256;
  const manifestIdentityCurrent = manifestRecord?.id === record.id
    && manifestRecord.canonicalDoi === record.doi
    && manifestRecord.pdf?.sha256 === record.pdf_sha256
    && ledger.canonicalDoi === record.doi
    && ledger.corpusRevision === manifest.corpusRevision
    && ledger.manifestRecordDigest === manifestRecord.recordDigest;
  const envelopeIdentityCurrent = existing.schemaVersion === AUTHORING_SCHEMA_VERSION
    && existing.authoringMode === profile.authoringMode
    && existing.paperId === record.id
    && existing.note?.id === record.id
    && existing.sourcePdfSha256 === record.pdf_sha256
    && existing.extractionPagesSha256 === extraction.artifacts.pagesSha256
    && existing.conceptRegistrySha256 === conceptRegistrySha256
    && provenance?.authoringVersion === AUTHORING_VERSION
    && provenance.sourcePdfSha256 === record.pdf_sha256
    && provenance.sourceTier === profile.sourceTier
    && provenance.editorialStatus === profile.editorialStatus
    && provenance.bindingReviewStatus === "automated-source-map";
  const priorCheckpointCurrent = authored?.status === "complete"
    && authored.inputDigest === existing.inputDigest
    && authored.authoringVersion === AUTHORING_VERSION
    && authored.authoringMode === profile.authoringMode
    && authored.source === profile.source
    && authored.sourcePdfSha256 === record.pdf_sha256
    && authored.conceptRegistrySha256 === conceptRegistrySha256
    && authored.notePath === relativeNotePath
    && authored.noteSha256 === existingNoteSha256;
  const priorQaBindingCurrent = hasCompleteQaBinding(existing)
    && qaBindingsMatch(provenance, existing)
    && qaBindingsMatch(authored, existing);
  const priorInputDigestCurrent = existing.inputDigest === extractionQaBoundDigest(
    "noteAuthoring",
    baseInputDigest,
    existing
  );
  return pagesIdentityCurrent
    && manifestIdentityCurrent
    && envelopeIdentityCurrent
    && priorCheckpointCurrent
    && priorQaBindingCurrent
    && priorInputDigestCurrent;
}

export function reconcileGeneratedQaEnvelope(existing, { inputDigest, qaBinding }) {
  return {
    ...existing,
    inputDigest,
    ...qaBinding,
    note: {
      ...existing.note,
      provenance: { ...existing.note.provenance, ...qaBinding }
    }
  };
}

export function safeMapBindingsMatch(value, envelope) {
  if (!envelope?.safeMapSha256) return true;
  return SAFE_MAP_BINDING_FIELDS.every((field) => value?.[field] === envelope[field]);
}

export function reconcileCuratedEnvelope(existing, {
  extractionPagesSha256,
  conceptRegistrySha256,
  qaBinding
}) {
  const curated = {
    ...existing,
    extractionPagesSha256,
    conceptRegistrySha256,
    ...qaBinding,
    note: {
      ...existing.note,
      provenance: { ...(existing.note?.provenance || {}), ...qaBinding }
    }
  };
  curated.inputDigest = extractionQaBoundDigest(
    "noteAuthoring",
    curatedInputDigest(curated, conceptRegistrySha256),
    qaBinding
  );
  return curated;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const whitespaceOnly = (value) => String(value ?? "")
  .normalize("NFKC")
  .replace(/\u0088/g, "=")
  .replace(/\s+/g, " ")
  .trim();
export const formulaComparable = (value) => canonicalizeMathNotation(String(value ?? ""))
  .normalize("NFKC")
  .replace(/\/equals/gi, "=")
  .replace(/\/summationdisplay/gi, "Σ")
  .replace(/\/radicaltpext(?:\/radicaltpext)*/gi, "√")
  .replace(/\s+/g, "")
  .toLowerCase();

function validateSources(note, pages) {
  const coverage = new Set(note.coverage?.pages || []);
  for (const model of note.models || []) {
    for (const [scope, sources] of [["model", model.sources || []], ...model.components.map((component) => [component.id, component.sources || []])]) {
      for (const source of sources) {
        const page = pages[Number(source.page) - 1];
        if (!page || !coverage.has(Number(source.page))) throw new Error(`${note.id}/${model.id}/${scope}: invalid source page`);
        if (source.quote && !whitespaceOnly(page.text).includes(whitespaceOnly(source.quote))) {
          throw new Error(`${note.id}/${model.id}/${scope}: source quote differs from page ${source.page}`);
        }
      }
    }
    for (const component of model.components || []) {
      if (component.formalKind !== "Source-extracted equation (not visually verified)") continue;
      const wanted = formulaComparable(component.formal);
      const literal = (component.sources || []).some((source) => {
        const page = pages[Number(source.page) - 1];
        return page && wanted && formulaComparable(page.text).includes(wanted);
      });
      if (!literal) throw new Error(`${note.id}/${model.id}/${component.id}: source-extracted equation differs from its cited page`);
    }
  }
}

function ledgerMatches(ledger, envelope, noteSha256, readingPacketSha256, {
  root,
  record,
  notePath,
  packetPath,
  extraction,
  conceptRegistrySha256,
  qaBinding
}) {
  const authored = ledger.stages?.noteAuthoring;
  const reading = ledger.stages?.sourceReading;
  const sectionIndex = ledger.stages?.sectionIndex;
  const relativeNotePath = path.relative(root, notePath).replaceAll(path.sep, "/");
  const relativePacketPath = path.relative(root, packetPath).replaceAll(path.sep, "/");
  const readingInputDigest = extractionQaBoundDigest("sourceReading", extraction.artifacts.pagesSha256, qaBinding);
  const expectedSource = envelope.safeMapSha256
    ? "reviewed-prose-only-safe-map"
    : envelope.authoringMode === "curated"
    ? "editor-curated-full-source"
    : envelope.authoringMode === "metadata-enriched"
      ? "legacy-deep-map-plus-full-source"
      : "full-source-section-map";
  return authored?.status === "complete"
    && authored.inputDigest === envelope.inputDigest
    && authored.authoringVersion === envelope.authoringVersion
    && authored.noteSha256 === noteSha256
    && authored.sourcePdfSha256 === record.pdf_sha256
    && authored.conceptRegistrySha256 === conceptRegistrySha256
    && authored.notePath === relativeNotePath
    && authored.authoringMode === envelope.authoringMode
    && authored.source === expectedSource
    && safeMapBindingsMatch(authored, envelope)
    && qaBindingsMatch(envelope, qaBinding)
    && qaBindingsMatch(envelope.note?.provenance, qaBinding)
    && qaBindingsMatch(authored, qaBinding)
    && reading?.status === "complete"
    && reading.inputDigest === readingInputDigest
    && reading.sourcePdfSha256 === record.pdf_sha256
    && reading.pagesArtifact === extraction.artifacts.pages
    && reading.readingPacket === relativePacketPath
    && reading.readingPacketSha256 === readingPacketSha256
    && qaBindingsMatch(reading, qaBinding)
    && sectionIndex?.status === "complete"
    && sectionIndex.inputDigest === readingInputDigest
    && sectionIndex.sourcePdfSha256 === record.pdf_sha256
    && sectionIndex.readingPacket === relativePacketPath
    && sectionIndex.readingPacketSha256 === readingPacketSha256
    && qaBindingsMatch(sectionIndex, qaBinding);
}

async function writeOrCheckCheckpoint({
  root,
  manifest,
  manifestRecord,
  record,
  envelope,
  notePath,
  noteSha256,
  ledgerPath,
  ledger,
  extraction,
  pagesPayload,
  options,
  conceptRegistrySha256,
  qaBinding,
  safeMapBound = null
}) {
  const packet = {
    ...buildReadingPacket(record, pagesPayload, extraction.artifacts.pagesSha256, qaBinding.extractionQaStatus),
    authoringVersion: envelope.authoringVersion,
    ...(safeMapBound ? safeMapEnvelopeBindings(safeMapBound) : {}),
    ...qaBinding
  };
  const packetPath = path.join(root, "research", "ledger", "artifacts", record.id, envelope.inputDigest, "reading-packet.json");
  const packetText = `${JSON.stringify(packet, null, 2)}\n`;
  const packetSha256 = sha256(packetText);
  const existingPacket = await readFile(packetPath, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  const consistent = existingPacket === packetText && ledgerMatches(ledger, envelope, noteSha256, packetSha256, {
    root,
    record,
    notePath,
    packetPath,
    extraction,
    conceptRegistrySha256,
    qaBinding
  });
  if (options.check) return { consistent, packetPath, packetSha256 };
  if (options.dryRun) return { consistent, packetPath, packetSha256 };
  await atomicWrite(packetPath, packet);
  const refreshed = await readJson(ledgerPath);
  const refreshedExtraction = refreshed.stages?.extraction;
  if (refreshed.pdfSha256 !== record.pdf_sha256
    || refreshedExtraction?.sourcePdfSha256 !== record.pdf_sha256
    || refreshedExtraction?.artifacts?.pages !== extraction.artifacts.pages
    || refreshedExtraction?.artifacts?.pagesSha256 !== extraction.artifacts.pagesSha256) {
    throw new Error(`${record.id}: upstream extraction changed during checkpoint reconciliation`);
  }
  const refreshedQa = await verifyExtractionQaCheckpoint(root, manifest, manifestRecord, refreshed, { requireComplete: false });
  let refreshedQaBinding = null;
  try {
    refreshedQaBinding = extractionQaCheckpointBinding(refreshedQa, { allowNeedsReview: true });
  } catch {
    // The source checkpoint changed to stale, failed, or otherwise nonterminal
    // while the note artifacts were being reconciled.
  }
  if (!refreshedQaBinding || !qaBindingsMatch(refreshedQaBinding, qaBinding)) {
    throw new Error(`${record.id}: Extraction QA changed during checkpoint reconciliation`);
  }
  const refreshedPagesText = await readFile(path.join(root, refreshedExtraction.artifacts.pages), "utf8");
  if (sha256(refreshedPagesText) !== refreshedExtraction.artifacts.pagesSha256) {
    throw new Error(`${record.id}: extraction pages changed during checkpoint reconciliation`);
  }
  if (safeMapBound) {
    const rebound = await loadBoundSafeMap({
      root,
      record,
      pagesPayload: JSON.parse(refreshedPagesText),
      pagesSha256: refreshedExtraction.artifacts.pagesSha256,
      qaBinding: refreshedQaBinding
    });
    if (rebound.specSha256 !== safeMapBound.specSha256
      || rebound.visualReportSha256 !== safeMapBound.visualReportSha256
      || rebound.relativePath !== safeMapBound.relativePath) {
      throw new Error(`${record.id}: reviewed prose-only safe map changed during checkpoint reconciliation`);
    }
  }
  const auditDigest = sha256(stableStringify({
    noteSha256,
    sourcePdfSha256: record.pdf_sha256,
    extractionPagesSha256: extraction.artifacts.pagesSha256,
    conceptRegistrySha256,
    ...Object.fromEntries(SAFE_MAP_BINDING_FIELDS.map((field) => [field, envelope[field]]).filter(([, value]) => value !== undefined)),
    ...qaBinding
  }));
  const previousDigest = refreshed.stages?.noteAuthoring?.noteSha256;
  const previousInputDigest = refreshed.stages?.noteAuthoring?.inputDigest;
  refreshed.stages.sectionIndex = {
    status: "complete",
    inputDigest: sourceReadingDigest(refreshed, qaBinding),
    sourcePdfSha256: record.pdf_sha256,
    readingPacket: path.relative(root, packetPath).replaceAll(path.sep, "/"),
    readingPacketSha256: packetSha256,
    ...qaBinding
  };
  refreshed.stages.sourceReading = {
    status: "complete",
    inputDigest: sourceReadingDigest(refreshed, qaBinding),
    sourcePdfSha256: record.pdf_sha256,
    pagesArtifact: extraction.artifacts.pages,
    readingPacket: path.relative(root, packetPath).replaceAll(path.sep, "/"),
    readingPacketSha256: packetSha256,
    mode: "resumable section index and source-anchor packet",
    ...qaBinding
  };
  refreshed.stages.noteAuthoring = {
    status: "complete",
    inputDigest: envelope.inputDigest,
    sourcePdfSha256: record.pdf_sha256,
    conceptRegistrySha256,
    source: envelope.safeMapSha256 ? "reviewed-prose-only-safe-map" : envelope.authoringMode === "curated" ? "editor-curated-full-source" : envelope.authoringMode === "metadata-enriched" ? "legacy-deep-map-plus-full-source" : "full-source-section-map",
    notePath: path.relative(root, notePath).replaceAll(path.sep, "/"),
    noteSha256,
    authoringVersion: envelope.authoringVersion,
    authoringMode: envelope.authoringMode,
    ...(envelope.safeMapSha256 ? safeMapEnvelopeBindings({
      relativePath: envelope.safeMapPath,
      specSha256: envelope.safeMapSha256,
      visualReportSha256: envelope.visualScopeReviewSha256,
      spec: {
        visualScopeReview: { path: envelope.visualScopeReviewPath },
        review: {
          status: envelope.safeMapReviewStatus,
          version: envelope.safeMapReviewVersion
        }
      }
    }) : {}),
    ...qaBinding
  };
  if (previousDigest !== noteSha256 || previousInputDigest !== envelope.inputDigest) {
    refreshed.stages.quoteAudit = { status: "pending", inputDigest: auditDigest, sourcePdfSha256: record.pdf_sha256 };
    refreshed.stages.formulaAudit = { status: "pending", inputDigest: auditDigest, sourcePdfSha256: record.pdf_sha256 };
    refreshed.stages.schemaValidation = { status: "pending", inputDigest: auditDigest, sourcePdfSha256: record.pdf_sha256 };
    refreshed.stages.contentAudit = { status: "pending", inputDigest: auditDigest, sourcePdfSha256: record.pdf_sha256 };
    refreshed.stages.sourceAudit = { status: "pending", inputDigest: auditDigest, sourcePdfSha256: record.pdf_sha256 };
    refreshed.stages.releaseBuild = { status: "pending", inputDigest: auditDigest, sourcePdfSha256: record.pdf_sha256 };
  }
  await atomicWrite(ledgerPath, refreshed, { canonical: true });
  return { consistent, packetPath, packetSha256 };
}

async function authorOne(record, manifest, manifestRecord, options, concepts, conceptIds, conceptRegistrySha256, root) {
  const ledgerPath = path.join(root, "research", "ledger", "papers", `${record.id}.json`);
  const ledger = await readJson(ledgerPath);
  const extraction = ledger.stages?.extraction;
  if (extraction?.status !== "complete" || !extraction.artifacts?.pages) return { id: record.id, status: "blocked", reason: "extraction incomplete" };
  if (!manifestRecord) return { id: record.id, status: "stale", reason: "paper is missing from the corpus manifest" };
  if (ledger.paperId !== record.id || ledger.pdfSha256 !== record.pdf_sha256 || extraction.sourcePdfSha256 !== record.pdf_sha256) {
    return { id: record.id, status: "stale", reason: "ledger, extraction, paper, or PDF identity is stale" };
  }
  const qaCheckpoint = await verifyExtractionQaCheckpoint(root, manifest, manifestRecord, ledger, { requireComplete: false });
  if (!qaCheckpoint.ok) {
    return {
      id: record.id,
      status: qaCheckpoint.state === "stale" ? "stale" : "blocked",
      reason: `Extraction QA is not a current terminal checkpoint (${qaCheckpoint.reason || qaCheckpoint.state})`
    };
  }
  let qaBinding;
  try {
    qaBinding = extractionQaCheckpointBinding(qaCheckpoint, { allowNeedsReview: true });
  } catch (error) {
    return {
      id: record.id,
      status: qaCheckpoint.state === "stale" ? "stale" : "blocked",
      reason: error.message
    };
  }
  const baseInputDigest = authoringInputDigest(record, extraction.artifacts.pagesSha256, conceptRegistrySha256);
  const notePath = path.join(root, "data", "notes", "papers", `${record.id}.json`);
  const existing = await readJsonIfPresent(notePath);
  const pagesText = await readFile(path.join(root, extraction.artifacts.pages), "utf8");
  if (!extraction.artifacts.pagesSha256 || sha256(pagesText) !== extraction.artifacts.pagesSha256) {
    return { id: record.id, status: "stale", reason: "extraction pages artifact hash is stale" };
  }
  const pagesPayload = JSON.parse(pagesText);
  const pages = pagesPayload.pages || pagesPayload;
  const validPagesIdentity = Array.isArray(pagesPayload)
    || (pagesPayload.paperId === record.id && pagesPayload.pdfSha256 === record.pdf_sha256);
  if (!validPagesIdentity) return { id: record.id, status: "stale", reason: "extraction pages artifact identity is stale" };

  // A terminal needs_review Extraction QA disposition never enters the
  // heuristic authoring path. It requires an independently reviewed,
  // hash-bound prose-only safe map tied to this exact PDF, pages artifact,
  // QA decision, and visual-scope report.
  const safeMapBound = qaBinding.extractionQaStatus === "needs_review"
    ? await loadBoundSafeMap({
      root,
      record,
      pagesPayload,
      pagesSha256: extraction.artifacts.pagesSha256,
      qaBinding
    })
    : null;
  const inputDigest = safeMapBound
    ? safeMapInputDigest({ baseInputDigest, bound: safeMapBound, qaBinding })
    : extractionQaBoundDigest("noteAuthoring", baseInputDigest, qaBinding);

  if (existing?.authoringMode === "curated" && !safeMapBound) {
    const validIdentity = existing.schemaVersion === AUTHORING_SCHEMA_VERSION
      && existing.paperId === record.id
      && existing.note?.id === record.id
      && existing.sourcePdfSha256 === record.pdf_sha256
      && ledger.paperId === record.id
      && ledger.pdfSha256 === record.pdf_sha256
      && extraction.sourcePdfSha256 === record.pdf_sha256
      && validPagesIdentity;
    if (!validIdentity) return { id: record.id, status: "stale", reason: "curated envelope, paper, or PDF identity is stale" };
    const curated = reconcileCuratedEnvelope(existing, {
      extractionPagesSha256: extraction.artifacts.pagesSha256,
      conceptRegistrySha256,
      qaBinding
    });
    const envelopeCurrent = existing.extractionPagesSha256 === curated.extractionPagesSha256
      && existing.conceptRegistrySha256 === curated.conceptRegistrySha256
      && existing.inputDigest === curated.inputDigest
      && qaBindingsMatch(existing, qaBinding)
      && qaBindingsMatch(existing.note?.provenance, qaBinding);
    validateGeneratedNote(curated.note, conceptIds, curated.authoringMode, pages, concepts);
    validateSources(curated.note, pages);
    if (!envelopeCurrent) {
      if (options.check) return { id: record.id, status: "stale", reason: "curated extraction or digest bindings are stale" };
      if (options.dryRun) return { id: record.id, status: "would-reconcile" };
      await atomicWrite(notePath, curated);
    }
    const noteText = await readFile(notePath, "utf8");
    const noteSha256 = sha256(noteText);
    const checkpoint = await writeOrCheckCheckpoint({ root, manifest, manifestRecord, record, envelope: curated, notePath, noteSha256, ledgerPath, ledger, extraction, pagesPayload, options, conceptRegistrySha256, qaBinding });
    if (options.check && !checkpoint.consistent) return { id: record.id, status: "stale", reason: "curated checkpoint or ledger is stale" };
    if (options.dryRun && !checkpoint.consistent) return { id: record.id, status: "would-reconcile" };
    return { id: record.id, status: envelopeCurrent && checkpoint.consistent ? "curated" : "reconciled" };
  }

  const current = !options.force
    && existing?.inputDigest === inputDigest
    && existing?.authoringVersion === AUTHORING_VERSION
    && existing?.conceptRegistrySha256 === conceptRegistrySha256
    && existing?.note?.id === record.id
    && qaBindingsMatch(existing, qaBinding)
    && qaBindingsMatch(existing.note?.provenance, qaBinding);
  if (current) {
    if (safeMapBound) {
      const issues = validateBoundSafeMapEnvelope(existing, {
        bound: safeMapBound,
        qaBinding,
        record,
        pagesPayload,
        pagesSha256: extraction.artifacts.pagesSha256,
        conceptDefinitions: concepts,
        conceptRegistrySha256,
        expectedInputDigest: inputDigest
      });
      if (issues.length) {
        const sample = issues.slice(0, 8).map((entry) => `${entry.path}: ${entry.reason}`).join("; ");
        throw new Error(`${record.id}: current prose-only safe-map envelope failed closed (${issues.length}): ${sample}`);
      }
    }
    validateGeneratedNote(existing.note, conceptIds, existing.authoringMode, pages, concepts);
    validateSources(existing.note, pages);
    const noteText = await readFile(notePath, "utf8");
    const noteSha256 = sha256(noteText);
    const checkpoint = await writeOrCheckCheckpoint({ root, manifest, manifestRecord, record, envelope: existing, notePath, noteSha256, ledgerPath, ledger, extraction, pagesPayload, options, conceptRegistrySha256, qaBinding, safeMapBound });
    if (options.check && !checkpoint.consistent) return { id: record.id, status: "stale", reason: "checkpoint or ledger is stale" };
    if (options.dryRun && !checkpoint.consistent) return { id: record.id, status: "would-reconcile" };
    return { id: record.id, status: checkpoint.consistent ? "current" : "reconciled" };
  }

  const existingText = existing ? await readFile(notePath, "utf8") : "";
  const existingNoteSha256 = existing ? sha256(existingText) : "";
  const qaOnlyRebind = !options.force && generatedQaOnlyRebindEligible({
    existing,
    existingNoteSha256,
    ledger,
    manifest,
    manifestRecord,
    record,
    extraction,
    pagesPayload,
    baseInputDigest,
    conceptRegistrySha256,
    notePath,
    root,
    qaBinding,
    safeMapBound
  });
  if (qaOnlyRebind) {
    const rebound = reconcileGeneratedQaEnvelope(existing, { inputDigest, qaBinding });
    validateGeneratedNote(rebound.note, conceptIds, rebound.authoringMode, pages, concepts);
    validateSources(rebound.note, pages);
    const reboundText = `${JSON.stringify(rebound, null, 2)}\n`;
    const reboundNoteSha256 = sha256(reboundText);
    if (options.check || options.dryRun) {
      await writeOrCheckCheckpoint({
        root,
        manifest,
        manifestRecord,
        record,
        envelope: rebound,
        notePath,
        noteSha256: reboundNoteSha256,
        ledgerPath,
        ledger,
        extraction,
        pagesPayload,
        options,
        conceptRegistrySha256,
        qaBinding
      });
      if (options.check) {
        return { id: record.id, status: "stale", reason: "generated v20 note requires a QA-only rebind" };
      }
      return { id: record.id, status: "would-rebind-qa", reason: "generated v20 note is valid and only its QA binding is stale" };
    }

    const latestText = await readFile(notePath, "utf8");
    if (latestText !== existingText) throw new Error(`${record.id}: generated note changed during QA-only rebind`);
    await atomicWrite(notePath, rebound);
    const committedText = await readFile(notePath, "utf8");
    if (committedText !== reboundText) throw new Error(`${record.id}: generated QA-only rebind did not commit the expected envelope`);
    await writeOrCheckCheckpoint({
      root,
      manifest,
      manifestRecord,
      record,
      envelope: rebound,
      notePath,
      noteSha256: reboundNoteSha256,
      ledgerPath,
      ledger,
      extraction,
      pagesPayload,
      options,
      conceptRegistrySha256,
      qaBinding
    });
    return { id: record.id, status: "qa-rebound" };
  }
  if (options.check) return { id: record.id, status: "stale", reason: existing ? "note input digest is stale" : "note is missing" };
  const note = safeMapBound
    ? materializeSafeMapNote({
      record,
      pagesPayload,
      conceptDefinitions: concepts,
      bound: safeMapBound,
      qaBinding
    })
    : buildAuthoredNote(record, pagesPayload, concepts, {
      extractionQaStatus: qaBinding.extractionQaStatus,
      formalEvidenceAllowed: true
    });
  Object.assign(note.provenance, qaBinding);
  const authoringMode = safeMapBound
    ? SAFE_MAP_AUTHORING_MODE
    : record.detail_level === "model_map" ? "metadata-enriched" : "source-mapped";
  validateGeneratedNote(note, conceptIds, authoringMode, pages, concepts);
  validateSources(note, pages);
  const envelope = {
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    authoringVersion: AUTHORING_VERSION,
    authoringMode,
    paperId: record.id,
    sourcePdfSha256: record.pdf_sha256,
    extractionPagesSha256: extraction.artifacts.pagesSha256,
    conceptRegistrySha256,
    inputDigest,
    ...(safeMapBound ? safeMapEnvelopeBindings(safeMapBound) : {}),
    ...qaBinding,
    note
  };
  if (safeMapBound) {
    const issues = validateBoundSafeMapEnvelope(envelope, {
      bound: safeMapBound,
      qaBinding,
      record,
      pagesPayload,
      pagesSha256: extraction.artifacts.pagesSha256,
      conceptDefinitions: concepts,
      conceptRegistrySha256,
      expectedInputDigest: inputDigest
    });
    if (issues.length) {
      const sample = issues.slice(0, 8).map((entry) => `${entry.path}: ${entry.reason}`).join("; ");
      throw new Error(`${record.id}: prose-only safe-map envelope failed closed (${issues.length}): ${sample}`);
    }
  }
  if (options.dryRun) return { id: record.id, status: existing ? "would-update" : "would-create", models: note.models.length, components: note.models.reduce((sum, model) => sum + model.components.length, 0) };
  await atomicWrite(notePath, envelope);
  const noteText = await readFile(notePath, "utf8");
  const noteSha256 = sha256(noteText);
  await writeOrCheckCheckpoint({ root, manifest, manifestRecord, record, envelope, notePath, noteSha256, ledgerPath, ledger, extraction, pagesPayload, options, conceptRegistrySha256, qaBinding, safeMapBound });
  return { id: record.id, status: existing ? "updated" : "created", models: note.models.length, components: note.models.reduce((sum, model) => sum + model.components.length, 0) };
}

export async function run(options) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const [catalog, mini, manifest] = await Promise.all([
    readJson(path.join(root, "data", "atlas_articles.json")),
    readJson(path.join(root, "mini-atlas", "data", "atlas.json")),
    readJson(path.join(root, "research", "corpus", "manifest.v1.json"))
  ]);
  const manifestById = new Map((manifest.records || []).map((record) => [record.id, record]));
  const miniBySourceId = new Map((mini.papers || []).map((paper) => [paper.sourceId, paper]));
  const miniIds = new Set(miniBySourceId.keys());
  const selected = selectRecords(catalog.records, miniIds, options);
  if (options.reconcileMini) {
    const results = await mapLimit(selected, options.jobs, async (record) => {
      try {
        return await reconcileMiniOne(
          record,
          manifest,
          manifestById.get(record.id),
          miniBySourceId.get(record.id),
          options,
          root
        );
      } catch (error) {
        return { id: record.id, status: "failed", reason: error?.message || String(error) };
      }
    });
    const counts = results.reduce((summary, result) => {
      summary[result.status] = (summary[result.status] || 0) + 1;
      return summary;
    }, {});
    return { mode: "reconcile-mini", selected: selected.length, counts, results };
  }
  const concepts = mergeConcepts(mini.concepts || []);
  const conceptIds = new Set(concepts.map((concept) => concept.id));
  const conceptRegistrySha256 = sha256(stableStringify(concepts));
  const conceptPayload = { schemaVersion: 1, authoringVersion: AUTHORING_VERSION, conceptRegistrySha256, concepts };
  const conceptPath = path.join(root, "data", "notes", "concepts.json");
  if (!options.check && !options.dryRun) await atomicWrite(conceptPath, conceptPayload);
  else if (options.check) {
    if (!(await exists(conceptPath))) throw new Error("Generated concept registry is missing");
    const expectedConceptText = `${JSON.stringify(conceptPayload, null, 2)}\n`;
    const existingConceptText = await readFile(conceptPath, "utf8");
    if (existingConceptText !== expectedConceptText) throw new Error("Generated concept registry is stale");
  }
  const results = await mapLimit(selected, options.jobs, async (record) => {
    try {
      return await authorOne(record, manifest, manifestById.get(record.id), options, concepts, conceptIds, conceptRegistrySha256, root);
    } catch (error) {
      return { id: record.id, status: "failed", reason: error?.message || String(error) };
    }
  });
  const counts = results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    return summary;
  }, {});
  return { selected: selected.length, counts, results };
}

function usage() {
  return `Usage:
  node scripts/author-model-notes.mjs [--paper ID_OR_DOI] [--from ID_OR_DOI] [--limit N] [--jobs N] [--dry-run] [--force] [--check] [--json]
  node scripts/author-model-notes.mjs --reconcile-mini [--paper ID_OR_DOI] [--from ID_OR_DOI] [--limit N] [--jobs N] [--dry-run] [--check] [--accept-mini-editorial-update] [--json]

Default mode authors only non-Mini papers. --reconcile-mini validates each frozen Mini note/page source and binds its noteAuthoring, sectionIndex, and sourceReading checkpoints to the current content-addressed Extraction QA decision and adjudication. A changed Mini editorial fixture fails closed unless the explicitly scoped --accept-mini-editorial-update flag is supplied; accepted old and new note hashes are retained in the paper ledger.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseCli(process.argv.slice(2));
  if (options.help) console.log(usage());
  else run(options).then((result) => {
    const failures = result.results.filter((entry) => ["blocked", "stale", "failed"].includes(entry.status));
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Authoring selection: ${result.selected} paper(s).`);
      console.log(JSON.stringify(result.counts));
      for (const entry of failures.slice(0, 25)) console.error(`${entry.id}: ${entry.status}: ${entry.reason || "no reason recorded"}`);
      if (failures.length > 25) console.error(`... ${failures.length - 25} more paper-level failures; rerun with --paper for focused diagnostics or add --json for the complete result set.`);
    }
    if (failures.length) process.exitCode = 1;
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
