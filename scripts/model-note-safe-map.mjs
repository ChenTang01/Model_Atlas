import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_MODEL_TYPES,
  AUTHORING_SCHEMA_VERSION,
  AUTHORING_VERSION,
  cleanText,
  sourceRestatement,
  stableStringify
} from "./model-note-authoring.mjs";
import {
  formalStructureIssue,
  formulaContaminatedProse,
  hasMathematicalExtractionNoise
} from "./model-note-formula-quality.mjs";
import { mapComponentRelevance } from "./model-note-relevance.mjs";
import { headingLabelRejectionReason } from "./model-note-semantic-audit.mjs";
import { isDirectResearchQuestion, isSubstantiveMethodStatement } from "./model-note-semantic-authoring.mjs";
import {
  hasExtractionNoise,
  isBoilerplate,
  isCaption,
  isCitation,
  isPaperOrganizationProse,
  isTableRow,
  isWhitespaceNormalizedSubstring,
  meaningfulText,
  normalizeWhitespace
} from "./model-note-text-quality.mjs";

export const SAFE_MAP_SCHEMA_VERSION = "atlas-model-note-safe-map-v1";
export const SAFE_MAP_VERSION = 1;
export const SAFE_MAP_REVIEW_VERSION = "safe-map-content-review-v1";
export const SAFE_MAP_DIRECTORY = "research/model-note-safe-maps/v1";
export const VISUAL_SCOPE_REPORT_PATH = "research/ledger/extraction-visual-scope-review.v1.json";
export const SAFE_MAP_AUTHORING_MODE = "source-mapped";
export const SAFE_MAP_FORMAL_KIND = "Atlas restatement of source rule";
export const SAFE_MAP_BINDING_FIELDS = Object.freeze([
  "safeMapSchemaVersion",
  "safeMapVersion",
  "safeMapPath",
  "safeMapSha256",
  "visualScopeReviewPath",
  "visualScopeReviewSha256",
  "safeMapReviewStatus",
  "safeMapReviewVersion"
]);

const HASH = /^[a-f0-9]{64}$/;
const SETUP_FIELDS = Object.freeze(["objects", "inputs", "decisions", "assumptions"]);
const MODEL_KINDS = new Set(["baseline", "extension", "benchmark", "alternative"]);
const COMPONENT_ROLES = new Set([
  "algorithm",
  "constraint",
  "decision",
  "estimation",
  "information",
  "interaction",
  "objective",
  "preference",
  "process",
  "state"
]);
const UNSAFE_SECTION = /\b(?:references?|bibliography|endnotes?|appendix|supplement(?:al material)?|proofs?|technical lemmas?|results?|numerical experiments?|simulation|case study|survey|organization|acknowledg(?:e)?ments?|notice)\b/i;
const UNSAFE_SOURCE_MECHANICS = /\b(?:figure|table|exhibit|chart|panel|equation)\s+[A-Z]?\d+\b|\b(?:theorem|lemma|proposition|corollary)\s+\d+\b|\b(?:x|y)[ -]?axis\b|\b(?:we|the authors?)\s+(?:prove|show|establish|find|observe|demonstrate)\b|\b(?:our|the)\s+results?\s+(?:show|establish|demonstrate|indicate)\b/i;
const CITED_PRECEDENT = /\b[A-Z][\p{L}'’.-]+(?:\s+(?:and|&|et\s+al\.? )\s*[A-Z][\p{L}'’.-]*)?\s*\((?:19|20)\d{2}[a-z]?\)/iu;
const RAW_MATH = /[$\\]|[=<>≤≥≠≈≡∈∉⊂⊃⊆⊇∑∏∫{}_^]|[�￿⌘⇤⊎]/u;
const NAMED_GREEK = /\b(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega)\b/i;
const GENERIC_SETUP = /^(?:the\s+)?(?:model|method|framework|algorithm|table|figure|output|input|data|policy|decision|player|players|agent|agents|random variable|objective function|problem|system|firm|product|consumer|customer)$/i;
const WORD = /[\p{L}\p{N}]+/gu;
const DIRECT_QUESTION_SOURCE = /^(?:how|what|when|why|which|who|whose|where|under\s+what|to\s+what\s+extent|can|could|should|does|do|is|are|will|would)\b[^?]*\?$/iu;
const STOPWORDS = new Set("a an and are as at be been being by can could did do does for from had has have how in into is it its may might model of on or our paper section should study that the their them these they this to under use uses using was we were what when where which who why will with would".split(" "));

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function issue(pathname, reason) {
  return { path: pathname, reason };
}

function values(value) {
  return Array.isArray(value) ? value : [];
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

export function safeMapRelativePath(paperId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(String(paperId || ""))) throw new Error(`Invalid safe-map paper ID: ${paperId}`);
  return `${SAFE_MAP_DIRECTORY}/${paperId}.json`;
}

function pageEntries(pagesPayload) {
  const pages = pagesPayload?.pages || pagesPayload;
  return Array.isArray(pages) ? pages : [];
}

function sourceRecord(source) {
  return {
    page: Number(source.page),
    section: normalizeWhitespace(source.section),
    equation: "",
    quote: normalizeWhitespace(source.quote)
  };
}

function sourceKey(source) {
  return `${source.page}\0${source.section}\0${source.quote}`;
}

function distinctSources(sources) {
  const seen = new Set();
  return sources.map(sourceRecord).filter((source) => {
    const key = sourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contentWords(value) {
  return (meaningfulText(value).toLocaleLowerCase().match(WORD) || [])
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function supportsAuthoredText(text, sources) {
  const authored = new Set(contentWords(text));
  if (!authored.size) return false;
  const sourceWords = new Set(values(sources).flatMap((source) => contentWords(source?.quote)));
  let overlap = 0;
  for (const word of authored) if (sourceWords.has(word)) overlap += 1;
  return overlap >= Math.min(3, Math.max(1, Math.ceil(authored.size * 0.15)));
}

function unsafeTextReason(value, { mechanics = false } = {}) {
  const text = meaningfulText(value);
  if (!text) return "is blank";
  if (String(value).includes("\u00ad")) return "contains a soft-hyphen extraction artifact";
  if (hasExtractionNoise(value) || hasMathematicalExtractionNoise(value)) return "contains extraction or mathematical glyph noise";
  if (RAW_MATH.test(text) || NAMED_GREEK.test(text)) return "contains formula notation forbidden by prose-only review";
  if (formalStructureIssue(text, "")) return "contains malformed formal structure";
  if (isBoilerplate(text) || isPaperOrganizationProse(text)) return "is boilerplate or organization prose";
  if (isCaption(text) || isTableRow(text)) return "depends on figure or table geometry";
  if (mechanics && (isCitation(text) || CITED_PRECEDENT.test(text))) return "is a citation or cited precedent";
  if (mechanics && UNSAFE_SOURCE_MECHANICS.test(text)) return "states a proof, result, or figure/table observation instead of model mechanics";
  return "";
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(String(value || ""))) return false;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.valueOf())) return false;
  return parsed.toISOString().slice(0, 10) === value.slice(0, 10);
}

function validateSource(source, pathname, pagesByNumber, {
  mechanics = false,
  setupValue = "",
  allowConciseDirectQuestion = false
} = {}) {
  const issues = [];
  if (!source || typeof source !== "object" || Array.isArray(source)) return [issue(pathname, "source must be an object")];
  if (!Number.isInteger(source.page) || source.page < 1) issues.push(issue(`${pathname}.page`, "page must be a positive one-based integer"));
  const section = meaningfulText(source.section);
  const quote = meaningfulText(source.quote);
  if (!section) issues.push(issue(`${pathname}.section`, "section is required"));
  else if (UNSAFE_SECTION.test(section)) issues.push(issue(`${pathname}.section`, "backmatter, proof, result, experiment, survey, or organization sections are not allowed"));
  const minimumContentWords = allowConciseDirectQuestion && DIRECT_QUESTION_SOURCE.test(quote) ? 2 : 4;
  if (!quote || contentWords(quote).length < minimumContentWords) {
    issues.push(issue(`${pathname}.quote`, minimumContentWords === 2
      ? "direct question quote must contain at least two meaningful words"
      : "quote must contain at least four meaningful words"));
  }
  const reason = quote ? unsafeTextReason(source.quote, { mechanics }) : "";
  if (reason) issues.push(issue(`${pathname}.quote`, reason));
  const page = pagesByNumber.get(source.page);
  if (Number.isInteger(source.page) && !page) issues.push(issue(`${pathname}.page`, `page ${source.page} is absent from the extraction`));
  if (page && quote && !isWhitespaceNormalizedSubstring(source.quote, page.text)) {
    issues.push(issue(`${pathname}.quote`, `quote is not a whitespace-normalized literal substring of page ${source.page}`));
  }
  if (page && quote && formulaContaminatedProse(source.quote, page.text, { conservative: true })) {
    issues.push(issue(`${pathname}.quote`, "quote absorbs a display formula or formula-adjacent extraction"));
  }
  if (source.equation !== undefined && meaningfulText(source.equation)) issues.push(issue(`${pathname}.equation`, "prose-only sources cannot contain equations"));
  if (setupValue && !normalizeWhitespace(source.quote).toLocaleLowerCase().includes(normalizeWhitespace(setupValue).toLocaleLowerCase())) {
    issues.push(issue(pathname, "setup value must occur literally inside its source quote"));
  }
  return issues;
}

function validateSourcedText(entry, pathname, pagesByNumber, {
  singleSource = false,
  mechanics = false,
  allowConciseDirectQuestion = false
} = {}) {
  const issues = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [issue(pathname, "sourced text must be an object")];
  const text = meaningfulText(entry.text);
  if (!text) issues.push(issue(`${pathname}.text`, "text is required"));
  else {
    const reason = unsafeTextReason(entry.text, { mechanics });
    if (reason) issues.push(issue(`${pathname}.text`, reason));
  }
  const sources = singleSource ? (entry.source ? [entry.source] : []) : values(entry.sources);
  if (!sources.length) issues.push(issue(`${pathname}.${singleSource ? "source" : "sources"}`, "at least one exact source is required"));
  for (const [index, source] of sources.entries()) {
    const sourcePath = singleSource ? `${pathname}.source` : `${pathname}.sources[${index}]`;
    issues.push(...validateSource(source, sourcePath, pagesByNumber, { mechanics, allowConciseDirectQuestion }));
  }
  if (text && sources.length && !supportsAuthoredText(entry.text, sources)) {
    issues.push(issue(`${pathname}.text`, "authored text lacks substantive lexical overlap with its bound source quote"));
  }
  return issues;
}

function specSources(spec) {
  const result = [];
  if (spec?.question?.source) result.push(spec.question.source);
  result.push(...values(spec?.overview?.sources));
  for (const model of values(spec?.models)) {
    result.push(...values(model?.summary?.sources), ...values(model?.method?.sources));
    for (const field of SETUP_FIELDS) for (const entry of values(model?.setup?.[field])) if (entry?.source) result.push(entry.source);
    for (const component of values(model?.components)) {
      result.push(...values(component?.explanation?.sources));
      for (const condition of values(component?.conditions)) if (condition?.source) result.push(condition.source);
    }
  }
  return result;
}

export function validateSafeMapSpec(spec, {
  record,
  pagesPayload,
  pagesSha256,
  qaBinding,
  visualReport,
  visualReportSha256
} = {}) {
  const issues = [];
  const pages = pageEntries(pagesPayload);
  const pagesByNumber = new Map(pages.map((page, index) => [Number(page?.page || index + 1), page]));
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return [issue("$", "safe map must be an object")];
  if (spec.schemaVersion !== SAFE_MAP_SCHEMA_VERSION) issues.push(issue("schemaVersion", `expected ${SAFE_MAP_SCHEMA_VERSION}`));
  if (spec.safeMapVersion !== SAFE_MAP_VERSION) issues.push(issue("safeMapVersion", `expected ${SAFE_MAP_VERSION}`));
  if (!spec.paperId || (record && spec.paperId !== record.id)) issues.push(issue("paperId", "paper identity does not match the requested record"));
  if (!HASH.test(spec.sourcePdfSha256 || "") || (record && spec.sourcePdfSha256 !== record.pdf_sha256)) issues.push(issue("sourcePdfSha256", "source PDF hash is missing or stale"));
  if (!HASH.test(spec.extractionPagesSha256 || "") || (pagesSha256 && spec.extractionPagesSha256 !== pagesSha256)) issues.push(issue("extractionPagesSha256", "extraction pages hash is missing or stale"));
  if (pagesPayload && !pages.length) issues.push(issue("extractionPagesSha256", "bound extraction has no pages"));

  const visual = spec.visualScopeReview;
  if (!visual || typeof visual !== "object") issues.push(issue("visualScopeReview", "visual-scope binding is required"));
  else {
    if (visual.path !== VISUAL_SCOPE_REPORT_PATH) issues.push(issue("visualScopeReview.path", `expected ${VISUAL_SCOPE_REPORT_PATH}`));
    if (!HASH.test(visual.sha256 || "") || (visualReportSha256 && visual.sha256 !== visualReportSha256)) issues.push(issue("visualScopeReview.sha256", "visual-scope report hash is missing or stale"));
    if (visual.formalMathAllowed !== false) issues.push(issue("visualScopeReview.formalMathAllowed", "must be false"));
    if (visual.structuredFigureTableAllowed !== false) issues.push(issue("visualScopeReview.structuredFigureTableAllowed", "must be false"));
  }
  const visualEntry = values(visualReport?.entries).find((entry) => entry.paperId === spec.paperId);
  if (visualReport && !visualEntry) issues.push(issue("visualScopeReview.entryBinding", "paper is absent from the visual-scope report"));
  if (visualEntry) {
    const binding = visual?.entryBinding || {};
    const expected = {
      qaDecisionSha256: visualEntry.qaDecision?.sha256,
      textSha256: visualEntry.productionExtraction?.textSha256,
      reviewDisposition: visualEntry.reviewDisposition,
      reviewVersion: visualEntry.reviewVersion
    };
    for (const [key, value] of Object.entries(expected)) {
      if (!value || binding[key] !== value) issues.push(issue(`visualScopeReview.entryBinding.${key}`, "visual-scope entry binding is missing or stale"));
    }
    if (visualEntry.sourcePdf?.sha256 !== spec.sourcePdfSha256) issues.push(issue("sourcePdfSha256", "does not match visual-scope entry"));
    if (visualEntry.productionExtraction?.pagesSha256 !== spec.extractionPagesSha256) issues.push(issue("extractionPagesSha256", "does not match visual-scope entry"));
    if (visualEntry.reviewDisposition !== "needs_review" || visualEntry.proseAuthoringAllowed !== true
      || visualEntry.formalMathAllowed !== false || visualEntry.structuredFigureTableAllowed !== false) {
      issues.push(issue("visualScopeReview.entryBinding", "visual review does not authorize prose-only authoring under needs_review"));
    }
  }
  if (qaBinding) {
    if (qaBinding.extractionQaStatus !== "needs_review") issues.push(issue("visualScopeReview.entryBinding", "safe maps may only be used for terminal needs_review QA"));
    if (visual?.entryBinding?.qaDecisionSha256 !== qaBinding.extractionQaDecisionSha256) issues.push(issue("visualScopeReview.entryBinding.qaDecisionSha256", "does not match current QA decision"));
  }

  const review = spec.review;
  if (!review || typeof review !== "object") issues.push(issue("review", "independent content review binding is required"));
  else {
    if (review.status !== "approved") issues.push(issue("review.status", "must be approved before materialization"));
    if (review.reviewerRole !== "independent_content_qa") issues.push(issue("review.reviewerRole", "must be independent_content_qa"));
    if (!validIsoDate(review.reviewedAt)) issues.push(issue("review.reviewedAt", "must be a real ISO date or UTC timestamp"));
    if (review.version !== SAFE_MAP_REVIEW_VERSION) issues.push(issue("review.version", `expected ${SAFE_MAP_REVIEW_VERSION}`));
  }

  issues.push(...validateSourcedText(spec.question, "question", pagesByNumber, {
    singleSource: true,
    allowConciseDirectQuestion: true
  }));
  if (spec?.question?.text && !isDirectResearchQuestion(spec.question.text)) issues.push(issue("question.text", "must be a direct, grammatical research question"));
  issues.push(...validateSourcedText(spec.overview, "overview", pagesByNumber));

  const models = values(spec.models);
  if (!models.length) issues.push(issue("models", "at least one reviewed model is required"));
  const modelIds = new Set();
  const componentIdsAcrossModels = new Set();
  const baselines = models.filter((model) => model?.kind === "baseline");
  if (baselines.length !== 1) issues.push(issue("models", "exactly one baseline model is required"));
  for (const [modelIndex, model] of models.entries()) {
    const modelPath = `models[${modelIndex}]`;
    if (!meaningfulText(model?.id) || modelIds.has(model?.id)) issues.push(issue(`${modelPath}.id`, "model ID is blank or duplicated"));
    else modelIds.add(model.id);
    if (!meaningfulText(model?.name)) issues.push(issue(`${modelPath}.name`, "model name is required"));
    if (!MODEL_KINDS.has(model?.kind)) issues.push(issue(`${modelPath}.kind`, "unsupported model kind"));
    if (modelIndex > 0 && !meaningfulText(model?.relation)) issues.push(issue(`${modelPath}.relation`, "nonbaseline model requires a concise relationship statement"));
    issues.push(...validateSourcedText(model?.summary, `${modelPath}.summary`, pagesByNumber, { mechanics: true }));
    issues.push(...validateSourcedText(model?.method, `${modelPath}.method`, pagesByNumber, { mechanics: true }));
    if (model?.method?.text && !isSubstantiveMethodStatement(model.method.text)) issues.push(issue(`${modelPath}.method.text`, "must be a substantive procedural statement"));
    for (const field of SETUP_FIELDS) {
      const entries = values(model?.setup?.[field]);
      if (!entries.length) issues.push(issue(`${modelPath}.setup.${field}`, "at least one source-bound entry is required"));
      const seen = new Set();
      for (const [entryIndex, entry] of entries.entries()) {
        const entryPath = `${modelPath}.setup.${field}[${entryIndex}]`;
        const value = meaningfulText(entry?.value);
        if (!value || GENERIC_SETUP.test(value)) issues.push(issue(`${entryPath}.value`, "setup value is blank or too generic"));
        const key = value.toLocaleLowerCase();
        if (seen.has(key)) issues.push(issue(`${entryPath}.value`, "setup value is duplicated"));
        seen.add(key);
        issues.push(...validateSource(entry?.source, `${entryPath}.source`, pagesByNumber, { mechanics: true, setupValue: value }));
      }
    }
    const components = values(model?.components);
    if (components.length < 2) issues.push(issue(`${modelPath}.components`, "prose-only safe maps require at least two substantive components per model"));
    const componentIds = new Set();
    for (const [componentIndex, component] of components.entries()) {
      const componentPath = `${modelPath}.components[${componentIndex}]`;
      if (!meaningfulText(component?.id) || componentIds.has(component?.id)) issues.push(issue(`${componentPath}.id`, "component ID is blank or duplicated"));
      else {
        componentIds.add(component.id);
        if (componentIdsAcrossModels.has(component.id)) issues.push(issue(`${componentPath}.id`, "component ID must also be unique across model variants"));
        componentIdsAcrossModels.add(component.id);
      }
      if (!meaningfulText(component?.label) || /^(?:model|method|analysis|results?|algorithm)$/i.test(meaningfulText(component?.label))) {
        issues.push(issue(`${componentPath}.label`, "component label must identify a specific mechanism"));
      } else {
        const headingIssue = headingLabelRejectionReason(component.label);
        if (headingIssue) issues.push(issue(`${componentPath}.label`, `component label is ${headingIssue}`));
      }
      if (!COMPONENT_ROLES.has(component?.role)) issues.push(issue(`${componentPath}.role`, "unsupported component role"));
      const conceptIds = values(component?.conceptIds);
      if (conceptIds.length < 1 || conceptIds.length > 3 || conceptIds.some((conceptId) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(conceptId || ""))) {
        issues.push(issue(`${componentPath}.conceptIds`, "one to three valid reviewed concept IDs are required"));
      } else if (new Set(conceptIds).size !== conceptIds.length) {
        issues.push(issue(`${componentPath}.conceptIds`, "reviewed concept IDs must be distinct"));
      }
      issues.push(...validateSourcedText(component?.explanation, `${componentPath}.explanation`, pagesByNumber, { mechanics: true }));
      const conditions = values(component?.conditions);
      if (!conditions.length) issues.push(issue(`${componentPath}.conditions`, "at least one premise, domain, timing, or feasibility condition is required"));
      for (const [conditionIndex, condition] of conditions.entries()) {
        const conditionPath = `${componentPath}.conditions[${conditionIndex}]`;
        if (!meaningfulText(condition?.text)) issues.push(issue(`${conditionPath}.text`, "condition text is required"));
        issues.push(...validateSource(condition?.source, `${conditionPath}.source`, pagesByNumber, { mechanics: true }));
        if (normalizeWhitespace(condition?.text) !== normalizeWhitespace(condition?.source?.quote)) {
          issues.push(issue(`${conditionPath}.text`, "condition must be the exact prose quote bound by its source"));
        }
      }
    }
  }

  // Every authored source must remain equation-free even if a future schema
  // extension adds a source outside one of the currently materialized fields.
  for (const [index, source] of specSources(spec).entries()) {
    if (meaningfulText(source?.equation)) issues.push(issue(`sources[${index}].equation`, "safe-map sources cannot contain equations"));
  }
  return issues;
}

function throwIssues(label, issues) {
  if (!issues.length) return;
  const sample = issues.slice(0, 8).map((entry) => `${entry.path}: ${entry.reason}`).join("; ");
  throw new Error(`${label} failed prose-only safe-map validation (${issues.length}): ${sample}`);
}

export async function loadBoundSafeMap({ root, record, pagesPayload, pagesSha256, qaBinding }) {
  if (qaBinding?.extractionQaStatus !== "needs_review") throw new Error(`${record?.id || "unknown"}: safe-map loading requires terminal needs_review QA`);
  const relativePath = safeMapRelativePath(record.id);
  const filename = resolveWithinRoot(root, relativePath, "safe-map path");
  let raw;
  try {
    raw = await readFile(filename, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${record.id}: reviewed prose-only safe map is missing (${relativePath})`);
    throw error;
  }
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${record.id}: safe map is not valid JSON (${error.message})`);
  }
  const visualPath = resolveWithinRoot(root, spec?.visualScopeReview?.path || "", "visual-scope report path");
  const visualRaw = await readFile(visualPath, "utf8");
  const visualReport = JSON.parse(visualRaw);
  const specSha256 = sha256(raw);
  const visualReportSha256 = sha256(visualRaw);
  const issues = validateSafeMapSpec(spec, {
    record,
    pagesPayload,
    pagesSha256,
    qaBinding,
    visualReport,
    visualReportSha256
  });
  throwIssues(record.id, issues);
  const visualEntry = values(visualReport.entries).find((entry) => entry.paperId === record.id);
  return Object.freeze({
    relativePath,
    spec,
    specSha256,
    visualReportSha256,
    visualEntry
  });
}

function searchPhrases(label, role, record) {
  const subject = cleanText(label).toLocaleLowerCase();
  const topic = cleanText(record.primary_topic || record.model_topic || record.title || "the paper").toLocaleLowerCase();
  return [
    `how ${subject} is represented`,
    `${subject} ${role} mechanism`,
    `${topic} ${role} evidence`
  ];
}

function materializedConditionText(value) {
  const text = normalizeWhitespace(value);
  if (!text || /[.!?]$/u.test(text)) return text;
  // The reviewed safe-map keeps the exact extracted quote byte-for-byte. A
  // PDF text layer can omit only its terminal mark; normalize that display
  // punctuation without changing the bound source quote or its wording.
  return `${text.replace(/[;:,]+$/u, "").trim()}.`;
}

function materializeComponent(componentSpec, record, conceptDefinitions) {
  const sources = distinctSources([
    ...values(componentSpec.explanation.sources),
    ...values(componentSpec.conditions).map((condition) => condition.source)
  ]);
  const conditions = componentSpec.conditions.map((condition) => materializedConditionText(condition.text));
  const component = {
    id: componentSpec.id,
    label: cleanText(componentSpec.label),
    role: componentSpec.role,
    concepts: [],
    explanation: cleanText(componentSpec.explanation.text),
    searchPhrases: searchPhrases(componentSpec.label, componentSpec.role, record),
    formal: sourceRestatement(componentSpec.role, componentSpec.explanation.text, []),
    formalKind: SAFE_MAP_FORMAL_KIND,
    symbols: [],
    conditions,
    sources,
    conceptBindings: []
  };
  const conceptsById = new Map(values(conceptDefinitions).map((concept) => [concept.id, concept]));
  for (const conceptId of componentSpec.conceptIds) {
    const concept = conceptsById.get(conceptId);
    if (!concept) throw new Error(`${record.id}/${component.id}: reviewed concept ID is absent from the registry (${conceptId})`);
    const mapped = mapComponentRelevance({
      title: component.label,
      text: component.explanation,
      role: component.role,
      conceptDefinitions: [concept],
      conditions: component.conditions,
      symbols: component.symbols,
      sources: component.sources,
      maxConcepts: 1
    });
    const binding = mapped.conceptBindings.find((entry) => entry.conceptId === conceptId && entry.status === "modeled");
    if (!binding || !mapped.concepts.includes(conceptId)) {
      throw new Error(`${record.id}/${component.id}: reviewed concept is not grounded by local prose (${conceptId})`);
    }
    component.concepts.push(conceptId);
    component.conceptBindings.push(binding);
  }
  return component;
}

function relationType(kind) {
  if (kind === "extension") return "extends";
  if (kind === "benchmark") return "approximates";
  return "alternativeTo";
}

function modelTypes(models) {
  const roles = new Set(models.flatMap((model) => model.components.map((component) => component.role)));
  const types = [];
  if (["objective", "constraint", "decision"].some((role) => roles.has(role))) types.push("Optimization");
  if (roles.has("algorithm")) types.push("Learning & algorithms");
  if (roles.has("interaction")) types.push("Game theory");
  if (roles.has("preference")) types.push("Economic theory");
  if (roles.has("estimation")) types.push("Structural model");
  if (["state", "process", "information"].some((role) => roles.has(role))) types.push("Stochastic model");
  const selected = types.filter((type) => ALLOWED_MODEL_TYPES.has(type));
  return selected.length ? selected : ["Structural model"];
}

export function materializeSafeMapNote({ record, pagesPayload, conceptDefinitions, bound, qaBinding = null }) {
  const spec = bound?.spec || bound;
  if (!spec) throw new Error(`${record?.id || "unknown"}: safe-map spec is required`);
  const pagesSha256 = bound?.spec ? spec.extractionPagesSha256 : undefined;
  const issues = validateSafeMapSpec(spec, {
    record,
    pagesPayload,
    pagesSha256,
    qaBinding,
    visualReport: bound?.visualEntry ? { entries: [bound.visualEntry] } : undefined,
    visualReportSha256: bound?.visualReportSha256
  });
  throwIssues(record.id, issues);
  const baselineId = spec.models.find((model) => model.kind === "baseline").id;
  const models = spec.models.map((modelSpec) => {
    const setupEvidence = Object.fromEntries(SETUP_FIELDS.map((field) => [field, modelSpec.setup[field].map((entry) => ({
      value: cleanText(entry.value),
      source: {
        type: "section",
        ...sourceRecord(entry.source),
        matchedText: cleanText(entry.value),
        derivation: "reviewed-safe-map-literal-source-phrase"
      }
    }))]));
    const components = modelSpec.components.map((component) => materializeComponent(component, record, conceptDefinitions));
    const sources = distinctSources([
      ...modelSpec.summary.sources,
      ...modelSpec.method.sources,
      ...SETUP_FIELDS.flatMap((field) => modelSpec.setup[field].map((entry) => entry.source))
    ]);
    const isBaseline = modelSpec.kind === "baseline";
    return {
      id: modelSpec.id,
      name: cleanText(modelSpec.name),
      kind: modelSpec.kind,
      relation: isBaseline ? "" : cleanText(modelSpec.relation),
      relationships: isBaseline ? [] : [{ type: relationType(modelSpec.kind), targetModelId: baselineId }],
      summary: cleanText(modelSpec.summary.text),
      objects: setupEvidence.objects.map((entry) => entry.value),
      inputs: setupEvidence.inputs.map((entry) => entry.value),
      decisions: setupEvidence.decisions.map((entry) => entry.value),
      assumptions: setupEvidence.assumptions.map((entry) => entry.value),
      setupEvidence,
      setupMaturity: Object.fromEntries(SETUP_FIELDS.map((field) => [field, "source-derived"])),
      setupDiagnostics: [{
        code: "reviewed_prose_only_safe_map",
        message: "The complete setup is bound to independently reviewed literal prose sources."
      }],
      method: cleanText(modelSpec.method.text),
      sources,
      components
    };
  });
  const coveragePages = [...new Set(specSources(spec).map((source) => Number(source.page)))].sort((left, right) => left - right);
  const note = {
    id: record.id,
    question: cleanText(spec.question.text),
    overview: cleanText(spec.overview.text),
    modelTypes: modelTypes(models),
    coverage: {
      pages: coveragePages,
      note: "Every displayed field is materialized from a hash-bound, independently reviewed prose-only source map; formal mathematics and figure or table geometry are excluded."
    },
    models,
    provenance: {
      authoringVersion: AUTHORING_VERSION,
      sourceTier: "hash-bound-prose-only-safe-map",
      editorialStatus: "independently reviewed prose-only source map",
      bindingReviewStatus: "approved-safe-map",
      questionMaturity: "source-derived",
      questionSource: sourceRecord(spec.question.source),
      questionDiagnostics: [],
      formulaPolicy: "Formal mathematics is unavailable under the visual-scope review; every formal field is an explicitly labeled verbal restatement of reviewed prose.",
      formalEvidenceAllowed: false,
      sourcePdfSha256: record.pdf_sha256,
      safeMapSchemaVersion: SAFE_MAP_SCHEMA_VERSION,
      safeMapVersion: SAFE_MAP_VERSION,
      safeMapPath: bound?.relativePath || safeMapRelativePath(record.id),
      safeMapSha256: bound?.specSha256 || sha256(`${JSON.stringify(spec, null, 2)}\n`),
      visualScopeReviewPath: spec.visualScopeReview.path,
      visualScopeReviewSha256: bound?.visualReportSha256 || spec.visualScopeReview.sha256,
      safeMapReviewStatus: spec.review.status,
      safeMapReviewVersion: spec.review.version
    }
  };
  if (qaBinding) Object.assign(note.provenance, qaBinding);
  return note;
}

export function safeMapInputDigest({ baseInputDigest, bound, qaBinding }) {
  if (!HASH.test(baseInputDigest || "")) throw new Error("safe-map base input digest must be a SHA-256 hash");
  if (!bound?.specSha256 || !bound?.visualReportSha256) throw new Error("safe-map content and visual-review hashes are required");
  return sha256(stableStringify({
    stage: "noteAuthoring",
    baseInputDigest,
    safeMapSchemaVersion: SAFE_MAP_SCHEMA_VERSION,
    safeMapVersion: SAFE_MAP_VERSION,
    safeMapSha256: bound.specSha256,
    visualScopeReviewSha256: bound.visualReportSha256,
    qaBinding
  }));
}

export function safeMapEnvelopeBindings(bound) {
  if (!bound?.relativePath || !bound?.specSha256 || !bound?.visualReportSha256) {
    throw new Error("complete bound safe-map metadata is required");
  }
  return {
    safeMapSchemaVersion: SAFE_MAP_SCHEMA_VERSION,
    safeMapVersion: SAFE_MAP_VERSION,
    safeMapPath: bound.relativePath,
    safeMapSha256: bound.specSha256,
    visualScopeReviewPath: bound.spec.visualScopeReview.path,
    visualScopeReviewSha256: bound.visualReportSha256,
    safeMapReviewStatus: bound.spec.review.status,
    safeMapReviewVersion: bound.spec.review.version
  };
}

function collectNoteText(note) {
  const values = [note?.question, note?.overview, note?.coverage?.note, ...(note?.modelTypes || [])];
  for (const model of note?.models || []) {
    values.push(model.name, model.summary, model.method, ...SETUP_FIELDS.flatMap((field) => model[field] || []));
    for (const field of SETUP_FIELDS) {
      for (const evidence of model?.setupEvidence?.[field] || []) {
        values.push(evidence?.value, evidence?.source?.section, evidence?.source?.equation, evidence?.source?.quote, evidence?.source?.matchedText);
      }
    }
    for (const source of model.sources || []) values.push(source?.section, source?.equation, source?.quote);
    for (const component of model.components || []) {
      values.push(component.label, component.explanation, component.formal, ...(component.conditions || []), ...(component.searchPhrases || []));
      for (const symbol of component.symbols || []) values.push(symbol?.symbol, symbol?.meaning);
      for (const source of component.sources || []) values.push(source?.section, source?.equation, source?.quote);
      for (const binding of component.conceptBindings || []) values.push(binding?.representation, binding?.reviewStatus);
    }
  }
  return values;
}

export function validateProseOnlySafeMapNote(note, pagesPayload, {
  bound,
  qaBinding,
  record,
  conceptDefinitions
} = {}) {
  const issues = [];
  if (note?.provenance?.formalEvidenceAllowed !== false) issues.push(issue("provenance.formalEvidenceAllowed", "must be false"));
  const expectedBindings = {
    safeMapSchemaVersion: SAFE_MAP_SCHEMA_VERSION,
    safeMapVersion: SAFE_MAP_VERSION,
    safeMapPath: bound?.relativePath,
    safeMapSha256: bound?.specSha256,
    visualScopeReviewPath: bound?.spec?.visualScopeReview?.path,
    visualScopeReviewSha256: bound?.visualReportSha256,
    safeMapReviewStatus: "approved",
    safeMapReviewVersion: SAFE_MAP_REVIEW_VERSION
  };
  for (const [key, expected] of Object.entries(expectedBindings)) {
    if (expected !== undefined && note?.provenance?.[key] !== expected) issues.push(issue(`provenance.${key}`, "safe-map binding is missing or stale"));
  }
  if (qaBinding) {
    for (const [key, expected] of Object.entries(qaBinding)) {
      if (note?.provenance?.[key] !== expected) issues.push(issue(`provenance.${key}`, "QA binding is missing or stale"));
    }
  }
  for (const [index, text] of collectNoteText(note).entries()) {
    if (!meaningfulText(text)) continue;
    const reason = unsafeTextReason(text, { mechanics: false });
    if (reason) issues.push(issue(`noteText[${index}]`, reason));
  }
  for (const [modelIndex, model] of values(note?.models).entries()) {
    for (const [componentIndex, component] of values(model?.components).entries()) {
      const base = `models[${modelIndex}].components[${componentIndex}]`;
      if (values(component.symbols).length) issues.push(issue(`${base}.symbols`, "prose-only safe maps cannot publish symbols"));
      if (/source-extracted|equation/i.test(component.formalKind || "")) issues.push(issue(`${base}.formalKind`, "source-extracted formal evidence is forbidden"));
      if (component.formalKind !== SAFE_MAP_FORMAL_KIND) issues.push(issue(`${base}.formalKind`, `must be ${SAFE_MAP_FORMAL_KIND}`));
      for (const [sourceIndex, source] of values(component.sources).entries()) {
        if (meaningfulText(source?.equation)) issues.push(issue(`${base}.sources[${sourceIndex}].equation`, "source equation is forbidden"));
      }
    }
  }
  if (bound && record && conceptDefinitions) {
    try {
      const expected = materializeSafeMapNote({ record, pagesPayload, conceptDefinitions, bound, qaBinding });
      if (stableStringify(note) !== stableStringify(expected)) issues.push(issue("$", "note differs from deterministic safe-map materialization"));
    } catch (error) {
      issues.push(issue("$", `expected safe-map materialization failed: ${error.message}`));
    }
  }
  return issues;
}

/**
 * Shared current/reuse/build/audit boundary for an already materialized safe
 * envelope.  Callers load `bound` from the current catalog record (id and
 * pdf_sha256), current pages artifact, and current QA checkpoint first; this
 * validator then rejects stale metadata or any note payload drift.
 */
export function validateBoundSafeMapEnvelope(envelope, {
  bound,
  qaBinding,
  record,
  pagesPayload,
  pagesSha256,
  conceptDefinitions,
  conceptRegistrySha256,
  expectedInputDigest
} = {}) {
  const issues = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return [issue("$", "safe-map envelope must be an object")];
  const expected = {
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    authoringVersion: AUTHORING_VERSION,
    authoringMode: SAFE_MAP_AUTHORING_MODE,
    paperId: record?.id,
    sourcePdfSha256: record?.pdf_sha256,
    extractionPagesSha256: pagesSha256,
    conceptRegistrySha256,
    inputDigest: expectedInputDigest,
    ...safeMapEnvelopeBindings(bound)
  };
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && envelope[key] !== value) issues.push(issue(key, "safe-map envelope binding is missing or stale"));
  }
  if (qaBinding) {
    for (const [key, value] of Object.entries(qaBinding)) {
      if (envelope[key] !== value) issues.push(issue(key, "envelope QA binding is missing or stale"));
    }
  }
  issues.push(...validateProseOnlySafeMapNote(envelope.note, pagesPayload, {
    bound,
    qaBinding,
    record,
    conceptDefinitions
  }).map((entry) => issue(entry.path === "$" ? "note" : `note.${entry.path}`, entry.reason)));
  return issues;
}
