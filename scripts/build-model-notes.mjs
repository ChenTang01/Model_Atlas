import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ALLOWED_COMPONENT_ROLES,
  ALLOWED_MODEL_TYPES,
  AUTHORING_SCHEMA_VERSION,
  AUTHORING_VERSION,
  authoringInputDigest,
  cleanText,
  curatedInputDigest,
  stableStringify
} from "./model-note-authoring.mjs";
import { validateModelNoteSemantics } from "./model-note-semantic-audit.mjs";
import { canonicalizeMathNotation, formalStructureIssue } from "./model-note-formula-quality.mjs";
import {
  extractionQaBoundDigest,
  verifyExtractionQaCheckpoint
} from "./extraction-qa.mjs";
import { modelNoteExtractionQaCheckpointBinding as extractionQaCheckpointBinding } from "./model-note-extraction-qa.mjs";
import {
  loadBoundSafeMap,
  safeMapEnvelopeBindings,
  safeMapInputDigest,
  validateBoundSafeMapEnvelope
} from "./model-note-safe-map.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CATALOG_PATH = path.join(ROOT, "data", "atlas_articles.json");
const MINI_PATH = path.join(ROOT, "mini-atlas", "data", "atlas.json");
const CONCEPT_PATH = path.join(ROOT, "data", "notes", "concepts.json");
const MANIFEST_PATH = path.join(ROOT, "research", "corpus", "manifest.v1.json");
const NOTE_DIR = path.join(ROOT, "data", "notes", "papers");
const CANDIDATE_DIR = path.join(ROOT, "data", "notes", "release-candidate");
const OUTPUT_JSON = path.join(CANDIDATE_DIR, "model_notes.json");
const OUTPUT_JS = path.join(CANDIDATE_DIR, "model_notes.js");
const CHECK_ONLY = process.argv.includes("--check");

const BINDING_STATUSES = new Set(["modeled", "explicitlyExcluded", "backgroundOnly", "unknown"]);
const BINDING_REVIEW_STATUSES = new Set(["editorial", "automated-source-map"]);
const RELATIONSHIP_TYPES = new Set(["extends", "alternativeTo", "approximates"]);
const AUTHORING_MODES = new Set(["curated", "metadata-enriched", "source-mapped"]);
const FORMAL_KINDS = new Set([
  "Atlas normalized notation",
  "Atlas restatement of source rule",
  "Source-extracted equation (not visually verified)"
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJSON = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const normalized = (value) => cleanText(value).toLowerCase();
export const whitespaceOnly = (value) => String(value ?? "")
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

export function assertMiniQaBoundAuthoring(ledger, qaBinding) {
  const authored = ledger.stages?.noteAuthoring;
  const baseInputDigest = authored?.noteSha256 && authored?.pagesSha256
    ? sha256(`${ledger.pdfSha256}\0${authored.noteSha256}\0${authored.pagesSha256}`)
    : "";
  const expectedInputDigest = baseInputDigest
    ? extractionQaBoundDigest("noteAuthoring", baseInputDigest, qaBinding)
    : "";
  if (!expectedInputDigest || authored?.inputDigest !== expectedInputDigest || !qaBindingsMatch(authored, qaBinding)) {
    fail(`${ledger.paperId}: Mini noteAuthoring checkpoint is not bound to current Extraction QA; run author-model-notes.mjs --reconcile-mini first`);
  }
  return true;
}

function fail(message) {
  throw new Error(`Model-note build failed: ${message}`);
}

function resolveWithinRoot(relativePath, label) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) fail(`${label} must be a relative project path`);
  const resolved = path.resolve(ROOT, ...relativePath.split("/"));
  const resolvedRoot = path.resolve(ROOT);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) fail(`${label} escapes the project root`);
  return resolved;
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

function validateLanguage(value, location) {
  if (typeof value === "string" && /\p{Script=Han}/u.test(value)) fail(`English-only authored content required: ${location}`);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) validateLanguage(child, `${location}.${key}`);
  }
}

function validateIndices(indices, length, location) {
  if (!Array.isArray(indices) || new Set(indices).size !== indices.length
    || indices.some((index) => !Number.isInteger(index) || index < 0 || index >= length)) {
    fail(`invalid zero-based references: ${location}`);
  }
}

function validateSource(source, pages, coverage, location) {
  if (!source || !Number.isInteger(source.page) || source.page < 1 || source.page > pages.length) fail(`bad source page: ${location}`);
  if (!nonempty(source.section) || typeof source.quote !== "string") fail(`source section and excerpt required: ${location}`);
  if (source.quote && !whitespaceOnly(pages[source.page - 1].text).includes(whitespaceOnly(source.quote))) {
    fail(`source excerpt differs from cited page: ${location}`);
  }
  if (!coverage.has(source.page)) fail(`source page is absent from paper coverage: ${location}`);
}

function validateConceptBindings(component, model, conceptIds, location) {
  if (!Array.isArray(component.conceptBindings) || !component.conceptBindings.length) fail(`concept bindings required: ${location}`);
  if (!Array.isArray(component.concepts) || new Set(component.concepts).size !== component.concepts.length) fail(`distinct modeled concepts required: ${location}`);
  const seen = new Set();
  for (const binding of component.conceptBindings) {
    const label = `${location}/${binding?.conceptId || "?"}`;
    if (!binding || !conceptIds.has(binding.conceptId)) fail(`undefined binding concept: ${label}`);
    if (seen.has(binding.conceptId)) fail(`duplicate concept binding: ${label}`);
    seen.add(binding.conceptId);
    if (!BINDING_STATUSES.has(binding.status)) fail(`invalid binding status: ${label}`);
    if (!nonempty(binding.representation)) fail(`binding representation required: ${label}`);
    if (!BINDING_REVIEW_STATUSES.has(binding.reviewStatus)) fail(`binding review marker required: ${label}`);
    validateIndices(binding.conditionRefs, component.conditions.length, `${label}.conditionRefs`);
    if (!Array.isArray(binding.sourceRefs) || (binding.status !== "unknown" && !binding.sourceRefs.length)) fail(`binding source provenance required: ${label}`);
    const sourceKeys = new Set();
    for (const reference of binding.sourceRefs) {
      if (!reference || !["component", "model"].includes(reference.scope)) fail(`invalid source scope: ${label}`);
      const sources = reference.scope === "component" ? component.sources : model.sources;
      validateIndices([reference.index], sources.length, `${label}.sourceRefs`);
      const key = `${reference.scope}:${reference.index}`;
      if (sourceKeys.has(key)) fail(`duplicate source reference: ${label}`);
      sourceKeys.add(key);
      if (Object.keys(reference).some((name) => !["scope", "index"].includes(name))) fail(`source reference escapes its scope: ${label}`);
    }
    if ("formalRef" in binding && (binding.formalRef !== "formal" || !nonempty(component.formal))) fail(`invalid formal reference: ${label}`);
    if ("symbolRefs" in binding) validateIndices(binding.symbolRefs, component.symbols.length, `${label}.symbolRefs`);
  }
  const modeled = component.conceptBindings.filter((binding) => binding.status === "modeled").map((binding) => binding.conceptId);
  if (modeled.length !== component.concepts.length || component.concepts.some((id) => !modeled.includes(id))) {
    fail(`component.concepts must equal modeled bindings: ${location}`);
  }
}

function validateNote(note, pages, concepts, location, authoringMode = "editorial") {
  const conceptIds = new Set(concepts.keys());
  if (!note || !nonempty(note.id) || !nonempty(note.question) || !note.question.trim().endsWith("?") || !nonempty(note.overview)) {
    fail(`paper note requires an interrogative question and overview: ${location}`);
  }
  if (!Array.isArray(note.modelTypes) || !note.modelTypes.length || note.modelTypes.some((type) => !ALLOWED_MODEL_TYPES.has(type))) {
    fail(`invalid model types: ${location}`);
  }
  if (!Array.isArray(note.coverage?.pages) || !note.coverage.pages.length || !nonempty(note.coverage.note)) fail(`coverage required: ${location}`);
  const coverage = new Set(note.coverage.pages);
  if (coverage.size !== note.coverage.pages.length
    || note.coverage.pages.some((page) => !Number.isInteger(page) || page < 1 || page > pages.length)) fail(`invalid coverage pages: ${location}`);
  if (!Array.isArray(note.models) || !note.models.length) fail(`models required: ${location}`);
  const modelIds = new Set(note.models.map((model) => model.id));
  if (modelIds.size !== note.models.length || note.models.some((model) => !nonempty(model.id))) fail(`distinct model IDs required: ${location}`);
  for (const model of note.models) {
    const modelLocation = `${location}/${model.id}`;
    if (!nonempty(model.kind)) fail(`model kind required: ${modelLocation}`);
    for (const field of ["name", "summary", "method"]) if (!nonempty(model[field])) fail(`${field} required: ${modelLocation}`);
    for (const field of ["objects", "inputs", "decisions", "assumptions", "sources", "components", "relationships"]) {
      if (!Array.isArray(model[field])) fail(`${field} array required: ${modelLocation}`);
    }
    if (!model.sources.length || !model.components.length) fail(`model sources and components required: ${modelLocation}`);
    const relationTargets = new Set();
    for (const relationship of model.relationships) {
      if (!relationship || !RELATIONSHIP_TYPES.has(relationship.type)) fail(`invalid model relationship: ${modelLocation}`);
      if (!modelIds.has(relationship.targetModelId) || relationship.targetModelId === model.id) fail(`bad relationship target: ${modelLocation}`);
      if (relationTargets.has(relationship.targetModelId)) fail(`duplicate relationship target: ${modelLocation}`);
      relationTargets.add(relationship.targetModelId);
      if (Object.keys(relationship).some((key) => !["type", "targetModelId"].includes(key))) fail(`relationship escapes paper scope: ${modelLocation}`);
    }
    const componentIds = new Set(model.components.map((component) => component.id));
    if (componentIds.size !== model.components.length || model.components.some((component) => !nonempty(component.id))) fail(`distinct component IDs required: ${modelLocation}`);
    for (const component of model.components) {
      const componentLocation = `${modelLocation}/${component.id}`;
      if (!nonempty(component.label) || !ALLOWED_COMPONENT_ROLES.has(component.role) || !nonempty(component.explanation)
        || !nonempty(component.formal) || !FORMAL_KINDS.has(component.formalKind)) fail(`incomplete component: ${componentLocation}`);
      const formalIssue = formalStructureIssue(component.formal, component.formalKind);
      if (formalIssue) fail(`malformed formal content (${formalIssue}): ${componentLocation}`);
      for (const field of ["symbols", "conditions", "sources", "searchPhrases", "concepts", "conceptBindings"]) {
        if (!Array.isArray(component[field])) fail(`${field} array required: ${componentLocation}`);
      }
      if (!component.sources.length) fail(`component source required: ${componentLocation}`);
      if (component.searchPhrases.length !== 3
        || new Set(component.searchPhrases.map(normalized)).size !== 3
        || component.searchPhrases.some((phrase) => !nonempty(phrase))) fail(`three distinct search phrases required: ${componentLocation}`);
      for (const [symbolIndex, symbol] of component.symbols.entries()) {
        if (!nonempty(symbol?.symbol) || !nonempty(symbol?.meaning)) fail(`invalid symbol: ${componentLocation}`);
        const symbolIssue = formalStructureIssue(symbol.symbol, "");
        if (symbolIssue) fail(`malformed symbol content (${symbolIssue}): ${componentLocation}/symbols[${symbolIndex}]`);
      }
      if (["Atlas normalized notation", "Source-extracted equation (not visually verified)"].includes(component.formalKind)
        && (/[\u0080-\u009f�]/.test(component.formal) || /\/(?:equal[a-z]*|radicaltpext|summationdisplay)/i.test(component.formal))) {
        fail(`corrupt source formula transcription: ${componentLocation}`);
      }
      if (component.formalKind === "Source-extracted equation (not visually verified)") {
        const wanted = formulaComparable(component.formal);
        const literal = component.sources.some((source) => {
          const page = pages[Number(source.page) - 1];
          return page && wanted && formulaComparable(page.text).includes(wanted);
        });
        if (!literal) fail(`source-extracted equation differs from its cited page: ${componentLocation}`);
      }
      validateConceptBindings(component, model, conceptIds, componentLocation);
      for (const source of component.sources) validateSource(source, pages, coverage, componentLocation);
    }
    for (const source of model.sources) validateSource(source, pages, coverage, modelLocation);
  }
  validateLanguage(note, location);
  const semantic = validateModelNoteSemantics(note, { authoringMode, pages, concepts });
  if (semantic.errors.length) {
    const sample = semantic.errors.slice(0, 5).map((entry) => `${entry.code}@${entry.path}`).join(", ");
    fail(`semantic validation failed (${semantic.errors.length}): ${location}: ${sample}`);
  }
  return semantic;
}

function validateConcepts(conceptPayload) {
  if (Number(conceptPayload?.schemaVersion) !== 1 || !Array.isArray(conceptPayload.concepts) || !conceptPayload.concepts.length) fail("concept registry is invalid");
  if (!/^[a-f0-9]{64}$/.test(conceptPayload.conceptRegistrySha256 || "")
    || conceptPayload.conceptRegistrySha256 !== sha256(stableStringify(conceptPayload.concepts))) fail("concept registry digest is invalid");
  const concepts = new Map();
  for (const concept of conceptPayload.concepts) {
    if (!nonempty(concept?.id) || !nonempty(concept.label) || !Array.isArray(concept.aliases) || !Array.isArray(concept.related)
      || concept.aliases.some((alias) => !nonempty(alias)) || concept.related.some((id) => !nonempty(id))) fail(`invalid concept: ${concept?.id || "?"}`);
    if (concepts.has(concept.id)) fail(`duplicate concept: ${concept.id}`);
    if (new Set(concept.aliases.map(normalized)).size !== concept.aliases.length) fail(`duplicate aliases: ${concept.id}`);
    concepts.set(concept.id, concept);
  }
  for (const concept of concepts.values()) for (const related of concept.related) if (!concepts.has(related)) fail(`undefined related concept ${related}: ${concept.id}`);
  validateLanguage(conceptPayload, "concepts");
  return concepts;
}

function publicPaper(note, record, additions = {}) {
  return {
    ...note,
    id: record.id,
    sourceId: record.id,
    title: record.title,
    authors: record.authors,
    year: record.year,
    journal: record.journal,
    journalCode: record.journal_code,
    doi: record.doi,
    navigationTopic: record.navigation_topic,
    primaryTopic: record.primary_topic,
    topicFamilies: record.topic_families || [],
    topics: record.topics || [],
    pageCount: record.pdf_page_count,
    sha256: record.pdf_sha256,
    ...additions
  };
}

export function validatedPublicPaper(note, record, pages, concepts, location, authoringMode, additions = {}) {
  const releasePaper = publicPaper(note, record, additions);
  validateNote(releasePaper, pages, concepts, location, authoringMode);
  return releasePaper;
}

async function atomicPair(json, js) {
  await mkdir(CANDIDATE_DIR, { recursive: true });
  const stagedJSON = `${OUTPUT_JSON}.tmp`;
  const stagedJS = `${OUTPUT_JS}.tmp`;
  await Promise.all([writeFile(stagedJSON, json), writeFile(stagedJS, js)]);
  try {
    await Promise.all([rename(stagedJSON, OUTPUT_JSON), rename(stagedJS, OUTPUT_JS)]);
  } catch (error) {
    await Promise.all([rm(stagedJSON, { force: true }), rm(stagedJS, { force: true })]);
    throw error;
  }
}

export async function build() {
  const [catalog, catalogBytes, mini, conceptPayload, manifest] = await Promise.all([
    readJSON(CATALOG_PATH), readFile(CATALOG_PATH), readJSON(MINI_PATH), readJSON(CONCEPT_PATH), readJSON(MANIFEST_PATH)
  ]);
  if (String(catalog.schema_version) !== "3.1" || !Array.isArray(catalog.records)) fail("main data must use schema 3.1");
  if (Number(mini.schemaVersion) !== 2 || !Array.isArray(mini.papers)) fail("Mini fixture must use schema 2");
  const concepts = validateConcepts(conceptPayload);
  const recordIds = new Set(catalog.records.map((record) => record.id));
  if (recordIds.size !== catalog.records.length) fail("catalog IDs are not unique");
  const miniBySourceId = new Map(mini.papers.map((paper) => [paper.sourceId, paper]));
  const manifestById = new Map((manifest.records || []).map((record) => [record.id, record]));
  if (miniBySourceId.size !== mini.papers.length) fail("Mini source mappings are not unique");
  const papers = [];
  const tierCounts = { "mini-editorial": 0, curated: 0, "metadata-enriched": 0, "source-mapped": 0 };
  const extractionQaCounts = { complete: 0, needs_review: 0 };
  let noteBytesDigestInput = "";

  for (const record of catalog.records) {
    const ledger = await readJSON(path.join(ROOT, "research", "ledger", "papers", `${record.id}.json`));
    if (ledger.paperId !== record.id || String(ledger.pdfSha256).toLowerCase() !== String(record.pdf_sha256).toLowerCase()) {
      fail(`${record.id}: ledger identity is stale`);
    }
    const extraction = ledger.stages?.extraction;
    if (extraction?.status !== "complete" || !extraction.artifacts?.pages || !extraction.artifacts?.pagesSha256) fail(`${record.id}: extraction is incomplete`);
    const manifestRecord = manifestById.get(record.id);
    if (!manifestRecord) fail(`${record.id}: paper is missing from the corpus manifest`);
    const miniPaper = miniBySourceId.get(record.id);
    const qaCheckpoint = await verifyExtractionQaCheckpoint(ROOT, manifest, manifestRecord, ledger, { requireComplete: Boolean(miniPaper) });
    if (!qaCheckpoint.ok || qaCheckpoint.state !== "current"
      || (miniPaper ? qaCheckpoint.effectiveStatus !== "complete" : !["complete", "needs_review"].includes(qaCheckpoint.effectiveStatus))) {
      const requirement = miniPaper ? "release-ready for the frozen Mini fixture" : "a current terminal checkpoint";
      fail(`${record.id}: Extraction QA is not ${requirement} (${qaCheckpoint.reason || qaCheckpoint.state})`);
    }
    const qaBinding = extractionQaCheckpointBinding(qaCheckpoint, { allowNeedsReview: !miniPaper });
    extractionQaCounts[qaBinding.extractionQaStatus] += 1;
    const extractionPagesBytes = await readFile(resolveWithinRoot(extraction.artifacts.pages, `${record.id}: extraction pages artifact`)).catch((error) => {
      if (error.code === "ENOENT") fail(`${record.id}: extraction pages artifact is missing`);
      throw error;
    });
    if (sha256(extractionPagesBytes) !== extraction.artifacts.pagesSha256) fail(`${record.id}: extraction pages artifact hash mismatch`);
    let extractionPagesPayload;
    try {
      extractionPagesPayload = JSON.parse(extractionPagesBytes.toString("utf8"));
    } catch {
      fail(`${record.id}: extraction pages artifact is invalid JSON`);
    }
    const extractionPages = Array.isArray(extractionPagesPayload) ? extractionPagesPayload : extractionPagesPayload?.pages;
    if (!Array.isArray(extractionPages) || !extractionPages.length) fail(`${record.id}: extraction pages artifact contains no pages`);
    if (!Array.isArray(extractionPagesPayload)
      && (extractionPagesPayload.paperId !== record.id || extractionPagesPayload.pdfSha256 !== ledger.pdfSha256)) {
      fail(`${record.id}: extraction pages artifact identity is stale`);
    }
    if (miniPaper) {
      if (String(miniPaper.sha256).toLowerCase() !== String(record.pdf_sha256).toLowerCase()) fail(`${record.id}: Mini PDF hash differs from catalog`);
      const authored = ledger.stages?.noteAuthoring;
      const expectedPagesPath = path.posix.join("mini-atlas", "research", "pages", `${miniPaper.id}.json`);
      const expectedNote = miniAuthoredNote(miniPaper);
      const expectedNoteSha256 = sha256(stableStringify(expectedNote));
      if (authored?.status !== "complete" || authored.source !== "mini-atlas-schema-v2"
        || authored.miniPaperId !== miniPaper.id || authored.sourcePdfSha256 !== ledger.pdfSha256
        || authored.noteSha256 !== expectedNoteSha256) {
        fail(`${record.id}: Mini note ledger is not reconciled`);
      }
      if (!authored.notePath || !/^mini-atlas\/data\/notes\/batch-[a-z0-9_-]+\.json$/i.test(authored.notePath)) {
        fail(`${record.id}: Mini note source path is invalid`);
      }
      let noteBatch;
      try {
        noteBatch = JSON.parse(await readFile(resolveWithinRoot(authored.notePath, `${record.id}: Mini note source`), "utf8"));
      } catch {
        fail(`${record.id}: Mini note source is missing or invalid`);
      }
      const batchNotes = (Array.isArray(noteBatch?.papers) ? noteBatch.papers : []).filter((paper) => paper.id === miniPaper.id);
      const batchNote = batchNotes.length === 1 ? batchNotes[0] : null;
      if (!batchNote || sha256(stableStringify(batchNote)) !== authored.noteSha256
        || stableStringify(batchNote) !== stableStringify(expectedNote)) {
        fail(`${record.id}: Mini note source differs from its ledger or release fixture`);
      }
      if (authored.pagesPath !== expectedPagesPath || !/^[a-f0-9]{64}$/.test(authored.pagesSha256 || "")) {
        fail(`${record.id}: Mini frozen-page binding is missing or invalid`);
      }
      assertMiniQaBoundAuthoring(ledger, qaBinding);
      const pagesBytes = await readFile(resolveWithinRoot(authored.pagesPath, `${record.id}: Mini frozen-page artifact`)).catch((error) => {
        if (error.code === "ENOENT") fail(`${record.id}: Mini frozen-page artifact is missing`);
        throw error;
      });
      if (sha256(pagesBytes) !== authored.pagesSha256) fail(`${record.id}: Mini frozen-page artifact hash mismatch`);
      let pagesPayload;
      try {
        pagesPayload = JSON.parse(pagesBytes.toString("utf8"));
      } catch {
        fail(`${record.id}: Mini frozen-page artifact is invalid JSON`);
      }
      const pages = Array.isArray(pagesPayload) ? pagesPayload : pagesPayload?.pages;
      if (!Array.isArray(pages) || !pages.length) fail(`${record.id}: Mini frozen-page artifact contains no pages`);
      const note = {
        ...miniPaper,
        id: record.id,
        provenance: {
          authoringVersion: "mini-reference-v1",
          sourceTier: "mini-editorial",
          editorialStatus: "Mini Atlas editorial source map",
          formulaPolicy: "Mini Atlas source-linked editorial formulation.",
          sourcePdfSha256: record.pdf_sha256,
          ...qaBinding
        }
      };
      const releasePaper = validatedPublicPaper(
        note,
        record,
        pages,
        concepts,
        record.id,
        "mini-editorial",
        { referenceFixtureId: miniPaper.id }
      );
      // Validate the same title-bearing shape that is serialized.  Validating
      // only the pre-overlay note cannot detect a question or component that
      // merely repeats the catalog title.
      papers.push(releasePaper);
      tierCounts["mini-editorial"] += 1;
      noteBytesDigestInput += `${record.id}:${sha256(stableStringify(miniPaper))}\n`;
      continue;
    }

    const notePath = path.join(NOTE_DIR, `${record.id}.json`);
    const noteBytes = await readFile(notePath).catch((error) => {
      if (error.code === "ENOENT") fail(`${record.id}: paper-level note is missing`);
      throw error;
    });
    const envelope = JSON.parse(noteBytes);
    if (Number(envelope.schemaVersion) !== AUTHORING_SCHEMA_VERSION || envelope.paperId !== record.id || envelope.note?.id !== record.id) fail(`${record.id}: invalid note envelope identity`);
    if (!AUTHORING_MODES.has(envelope.authoringMode)) fail(`${record.id}: invalid authoring mode`);
    if (String(envelope.sourcePdfSha256).toLowerCase() !== String(record.pdf_sha256).toLowerCase()) fail(`${record.id}: note PDF hash is stale`);
    if (envelope.extractionPagesSha256 !== extraction.artifacts.pagesSha256) fail(`${record.id}: note extraction hash is stale`);
    if (envelope.conceptRegistrySha256 !== conceptPayload.conceptRegistrySha256) fail(`${record.id}: note concept registry is stale`);
    if (!qaBindingsMatch(envelope, qaBinding) || !qaBindingsMatch(envelope.note?.provenance, qaBinding)) {
      fail(`${record.id}: note Extraction QA binding is stale`);
    }
    let boundSafeMap = null;
    if (qaBinding.extractionQaStatus === "needs_review") {
      boundSafeMap = await loadBoundSafeMap({
        root: ROOT,
        record,
        pagesPayload: extractionPagesPayload,
        pagesSha256: extraction.artifacts.pagesSha256,
        qaBinding
      });
      const expectedInputDigest = safeMapInputDigest({
        baseInputDigest: authoringInputDigest(record, extraction.artifacts.pagesSha256, conceptPayload.conceptRegistrySha256),
        bound: boundSafeMap,
        qaBinding
      });
      const safeMapIssues = validateBoundSafeMapEnvelope(envelope, {
        bound: boundSafeMap,
        qaBinding,
        record,
        pagesPayload: extractionPagesPayload,
        pagesSha256: extraction.artifacts.pagesSha256,
        conceptDefinitions: [...concepts.values()],
        conceptRegistrySha256: conceptPayload.conceptRegistrySha256,
        expectedInputDigest
      });
      if (safeMapIssues.length) {
        const sample = safeMapIssues.slice(0, 5).map((entry) => `${entry.path}: ${entry.reason}`).join("; ");
        fail(`${record.id}: reviewed prose-only safe-map envelope is stale or invalid (${safeMapIssues.length}): ${sample}`);
      }
    } else if (envelope.safeMapSha256 || envelope.note?.provenance?.safeMapSha256) {
      fail(`${record.id}: safe-map provenance is only valid for terminal needs_review Extraction QA`);
    } else if (envelope.authoringMode !== "curated") {
      if (envelope.authoringVersion !== AUTHORING_VERSION) fail(`${record.id}: generated note authoring version is stale`);
      if (envelope.inputDigest !== extractionQaBoundDigest(
        "noteAuthoring",
        authoringInputDigest(record, extraction.artifacts.pagesSha256, conceptPayload.conceptRegistrySha256),
        qaBinding
      )) fail(`${record.id}: generated note input digest is stale`);
    } else if (envelope.inputDigest !== extractionQaBoundDigest(
      "noteAuthoring",
      curatedInputDigest(envelope, conceptPayload.conceptRegistrySha256),
      qaBinding
    )) {
      fail(`${record.id}: curated note input digest is stale`);
    }
    const noteSha = sha256(noteBytes);
    const authored = ledger.stages?.noteAuthoring;
    if (authored?.status !== "complete" || authored.noteSha256 !== noteSha || authored.inputDigest !== envelope.inputDigest
      || authored.authoringVersion !== envelope.authoringVersion || !qaBindingsMatch(authored, qaBinding)) fail(`${record.id}: note ledger is not reconciled`);
    if (boundSafeMap) {
      const expectedSafeMapBindings = safeMapEnvelopeBindings(boundSafeMap);
      if (authored.source !== "reviewed-prose-only-safe-map"
        || Object.entries(expectedSafeMapBindings).some(([key, value]) => authored[key] !== value)) {
        fail(`${record.id}: safe-map note ledger is not bound to the reviewed source map`);
      }
    }
    const pages = extractionPages;
    const note = {
      ...envelope.note,
      provenance: {
        ...(envelope.note.provenance || {}),
        authoringVersion: envelope.authoringVersion,
        sourceTier: envelope.note.provenance?.sourceTier || envelope.authoringMode,
        editorialStatus: envelope.note.provenance?.editorialStatus || envelope.authoringMode,
        sourcePdfSha256: record.pdf_sha256,
        ...qaBinding
      }
    };
    const releasePaper = validatedPublicPaper(note, record, pages, concepts, record.id, envelope.authoringMode);
    papers.push(releasePaper);
    tierCounts[envelope.authoringMode] += 1;
    noteBytesDigestInput += `${record.id}:${noteSha}\n`;
  }

  if (papers.length !== catalog.records.length || new Set(papers.map((paper) => paper.id)).size !== catalog.records.length) fail("release does not contain exactly one note per catalog paper");
  const models = papers.reduce((sum, paper) => sum + paper.models.length, 0);
  const components = papers.reduce((sum, paper) => sum + paper.models.reduce((inner, model) => inner + model.components.length, 0), 0);
  const bindings = papers.reduce((sum, paper) => sum + paper.models.reduce((inner, model) => inner + model.components.reduce((count, component) => count + component.conceptBindings.length, 0), 0), 0);
  const relationships = papers.reduce((sum, paper) => sum + paper.models.reduce((inner, model) => inner + model.relationships.length, 0), 0);
  const output = {
    schemaVersion: 2,
    sourceSchemaVersion: catalog.schema_version,
    sourceDataSha256: sha256(catalogBytes),
    noteSetSha256: sha256(noteBytesDigestInput),
    description: "Complete source-linked Mini-style model-note layer for the Atlas corpus.",
    editorial: "AI-assisted source reading and concept-level editorial interpretation, not independent expert verification. Applicability is scoped to individual components. Clean source equations are distinguished from Atlas verbal restatements; extraction warnings remain visible in provenance.",
    audit: {
      papers: papers.length,
      concepts: concepts.size,
      models,
      components,
      bindings,
      relationships,
      tiers: tierCounts,
      extractionQa: extractionQaCounts
    },
    concepts: [...concepts.values()],
    papers
  };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  const js = `/* Generated by scripts/build-model-notes.mjs. */\nwindow.AtlasModelNotes=${JSON.stringify(output).replaceAll("<", "\\u003c")};\n`;
  if (CHECK_ONLY) {
    const [existingJSON, existingJS] = await Promise.all([
      readFile(OUTPUT_JSON, "utf8").catch(() => ""), readFile(OUTPUT_JS, "utf8").catch(() => "")
    ]);
    if (existingJSON !== json || existingJS !== js) fail("generated files are missing or stale");
    console.log(`Model-note release candidate is current: ${papers.length} papers, ${models} models, ${components} components, ${concepts.size} concepts.`);
  } else {
    await atomicPair(json, js);
    console.log(`Built release candidate: ${papers.length} papers, ${models} models, ${components} components, ${concepts.size} concepts.`);
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await build();
}
