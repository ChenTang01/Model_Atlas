import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  authoredConditionHasPredicate,
  authoringInputDigest,
  stableStringify
} from "./model-note-authoring.mjs";
import {
  assertExtractionContract,
  stableStringify as stableLedgerStringify
} from "./corpus-pipeline.mjs";
import {
  checkProjectCheckpoints,
  MINI_READING_AUDIT_VERSION,
  miniReadingInputDigest
} from "./model-note-checkpoints.mjs";
import { isDirectResearchQuestion } from "./model-note-semantic-authoring.mjs";
import {
  formalStructureIssue,
  noteFormalStructureIssues,
  standaloneFormulaLine
} from "./model-note-formula-quality.mjs";
import { validateModelNoteSemantics } from "./model-note-semantic-audit.mjs";
import {
  extractionQaBoundDigest,
  verifyExtractionQaCheckpoint
} from "./extraction-qa.mjs";
import {
  modelNoteExtractionQaCheckpointBinding as extractionQaCheckpointBinding,
  modelNoteExtractionQaCheckpointUsable
} from "./model-note-extraction-qa.mjs";
import {
  loadBoundSafeMap,
  safeMapEnvelopeBindings,
  safeMapInputDigest,
  validateBoundSafeMapEnvelope
} from "./model-note-safe-map.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_VERSION = MINI_READING_AUDIT_VERSION;
const REPORT_PATH = path.join(ROOT, "research", "corpus", "model-note-audit.v1.json");
const CANDIDATE_JSON_PATH = path.join(ROOT, "data", "notes", "release-candidate", "model_notes.json");
const CANDIDATE_JS_PATH = path.join(ROOT, "data", "notes", "release-candidate", "model_notes.js");
const CANDIDATE_REPORT_PATH = path.join(ROOT, "data", "notes", "release-candidate", "audit.v1.json");
const PUBLIC_JSON_PATH = path.join(ROOT, "data", "model_notes.json");
const PUBLIC_JS_PATH = path.join(ROOT, "data", "model_notes.js");
const execFileAsync = promisify(execFile);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const SETUP_FIELDS = ["objects", "inputs", "decisions", "assumptions"];
const SOURCE_EXTRACTED_EQUATION = "Source-extracted equation (not visually verified)";
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
// backgroundOnly is the one deliberate extension beyond statuses observed in
// the frozen Mini notes; the curated full-source note uses this expanded
// relevance label with the same condition and source provenance contract.
const MINI_PARITY_RELEASE_BINDING_STATUSES = new Set(["modeled", "explicitlyExcluded", "backgroundOnly"]);
const VERBAL_FORMAL_KIND = "Atlas restatement of source rule";
const CONDITION_RELEVANCE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "can", "case", "component",
  "condition", "could", "did", "do", "does", "entry", "for", "formal", "framework", "from", "had",
  "has", "have", "how", "if", "in", "into", "is", "it", "its", "may", "might", "model", "modeled",
  "modeling", "no", "not", "objective", "of", "on", "only", "or", "paper", "result", "results", "role",
  "section", "should", "source", "study", "system", "that", "the", "their", "them", "these", "they",
  "this", "to", "under", "was", "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would"
]);
const CONDITION_TOKEN_EQUIVALENTS = new Map([
  ...["denominator", "fraction", "normaliz", "normalization", "normalize", "numerator", "quotient", "ratio", "relative"]
    .map((token) => [token, "ratio"]),
  ...["care", "clinical", "health", "healthcare", "medical", "prevention", "preventive", "screen", "screening", "test", "tested", "testing", "treatment"]
    .map((token) => [token, "clinical-care"]),
  ...["fatigue", "productivity", "tired", "tiredness"]
    .map((token) => [token, "fatigue-productivity"])
]);
const CONDITION_PREDICATE_SIGNAL = /[=<>≤≥≠≈∈⊂⊆]|\b(?:is|are|was|were|be|been|being|has|have|had|do|does|did|may|might|must|can|could|should|would|will|shall|not|no|only|whereas|rather\s+than|if|unless|until|while|because|given|assum(?:e|es|ed|ing)|suppos(?:e|es|ed|ing)|subject\s+to|provided\s+that|conditional\s+on|under\s+the\s+assumption|in\s+the\s+case\s+where|appl(?:y|ies)|arriv(?:e|es)|averages?|belongs?|choos(?:e|es)|constrains?|constructs?|contains?|covers?|depends?|delimits?|describes?|discards?|displaces?|earns?|enters?|establish(?:es)?|excludes?|favors?|follows?|governs?|governed|holds?|implies?|keeps?|knows?|lets?|makes?|maximizes?|minimizes?|motivates?|moves?|needs?|normalizes?|precedes?|prescribes?|presents?|receives?|recovers?|refers?|relies?|remains?|repeats?|requires?|reveals?|shares?|solves?|stays?|uses?|yields?|identical|equal|linear|nonlinear|fixed|finite|positive|negative|nonnegative|bounded|independent|stationary|nonstationary|deterministic|stochastic|homogeneous|heterogeneous|convex|concave|monotone|nondecreasing|nonincreasing|continuous|discrete|integer|binary|feasible|infeasible|available|unavailable|known|unknown|observed|unobserved|exogenous|endogenous|quasilinear|risk[- ]neutral)\b|\bconsumers?\s+demand\b|\balgorithm(?:\s+\d+)?\s+prices\b/iu;
// Generated conditions may preserve arbitrary declarative source prose. These
// signals cover productive English verb forms without tying release to a
// closed vocabulary, while a small irregular/base-form set covers predicates
// whose present tense has no suffix (for example, "firms sell").
const CONDITION_PRODUCTIVE_VERB = /\b[\p{L}][\p{L}'’\-]{2,}(?:ed|ing|ates?|ifies|ises?|izes?)\b/iu;
const CONDITION_BASE_PREDICATES = new Set([
  "abstract", "accept", "access", "adapt", "add", "admit", "aggregate", "allocate", "allow", "arise",
  "bear", "begin", "carry", "charge", "combine", "commit", "compare", "compete", "control", "cost",
  "decrease", "define", "deliver", "determine", "develop", "differ", "discount", "divide", "encode", "enable", "equal",
  "evaluate", "evolve", "exceed", "exist", "face", "focus", "form", "implement", "impose", "include", "increase", "incur",
  "interact", "last", "leave", "lie", "limit", "listen", "map", "mediate", "merge", "obtain", "occupy", "occur",
  "offer", "omit", "operate", "order", "own", "partition", "pay", "permit", "persist", "place", "play",
  "produce", "raise", "rank", "reduce", "report", "resolve", "respond", "retain", "select", "sell", "send",
  "restrict", "serve", "set", "simplify", "single-home", "start", "succeed", "supply", "support", "satisfy", "take", "target", "trigger",
  "understand", "update", "value", "weight"
]);
const MATERIAL_MATH_SIGNAL = /(?:[=<>≤≥≠≈≡∈∉⊂⊃⊆⊇∑Σ∏Π∫]|\\(?:leq?|geq?|neq?|in|notin|subset(?:eq)?|supset(?:eq)?|approx|equiv|sum|prod|int)\b|\b(?:arg\s*)?(?:max|min)\s*[_({]|\b[\p{L}][\p{L}\p{N}]{0,3}\([^)]{1,80}\)|\b[\p{L}][\p{L}\p{N}]{0,5}\s*[_^]\s*(?:\{[^}]+\}|[\p{L}\p{N}*+\-]+))/iu;
const GENERIC_BINDING_REPRESENTATION = /\b(?:is\s+classified\s+under|through\s+the\s+component(?:'s|’s)\s+local\s+source\s+anchor|automated\s+source\s+mapping|component-role)\b/iu;

function normalizedReleaseText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

function qaBindingsMatch(value, expected) {
  return terminalQaBinding(expected) && QA_BINDING_KEYS.every((key) => value?.[key] === expected[key]);
}

function usableExtractionQaCheckpoint(checkpoint, { allowNeedsReview = false } = {}) {
  return modelNoteExtractionQaCheckpointUsable(checkpoint, { allowNeedsReview });
}

function terminalQaBinding(binding) {
  if (!binding || !QA_BINDING_KEYS.every((key) => Object.hasOwn(binding, key))) return false;
  if (!/^[a-f0-9]{64}$/.test(binding.extractionQaInputDigest || "")
    || !/^[a-f0-9]{64}$/.test(binding.extractionQaDecisionSha256 || "")
    || typeof binding.extractionQaDecisionPath !== "string"
    || !binding.extractionQaDecisionPath.trim()) return false;
  if (binding.extractionQaStatus === "needs_review") {
    return binding.extractionQaAutomatedStatus === "needs_review"
      && binding.extractionQaAdjudicationStatus === "pending"
      && typeof binding.extractionQaAdjudicationPath === "string"
      && Boolean(binding.extractionQaAdjudicationPath.trim())
      && binding.extractionQaAdjudicationSha256 === null;
  }
  if (binding.extractionQaStatus !== "complete") return false;
  if (binding.extractionQaAutomatedStatus === "complete") {
    return binding.extractionQaAdjudicationStatus === "not_required"
      && binding.extractionQaAdjudicationPath === null
      && binding.extractionQaAdjudicationSha256 === null;
  }
  return binding.extractionQaAutomatedStatus === "needs_review"
    && binding.extractionQaAdjudicationStatus === "accepted"
    && typeof binding.extractionQaAdjudicationPath === "string"
    && Boolean(binding.extractionQaAdjudicationPath.trim())
    && /^[a-f0-9]{64}$/.test(binding.extractionQaAdjudicationSha256 || "");
}

function releaseComponentSubstanceFingerprint(component) {
  const normalizedList = (values) => (Array.isArray(values) ? values : [])
    .map(normalizedReleaseText)
    .filter(Boolean)
    .sort();
  const symbols = (Array.isArray(component?.symbols) ? component.symbols : []).map((symbol) => ({
    symbol: normalizedReleaseText(symbol?.symbol),
    meaning: normalizedReleaseText(symbol?.meaning)
  })).sort((left, right) => `${left.symbol}|${left.meaning}`.localeCompare(`${right.symbol}|${right.meaning}`));
  const bindings = (Array.isArray(component?.conceptBindings) ? component.conceptBindings : []).map((binding) => ({
    conceptId: normalizedReleaseText(binding?.conceptId),
    status: normalizedReleaseText(binding?.status),
    representation: normalizedReleaseText(binding?.representation)
  })).sort((left, right) => `${left.conceptId}|${left.status}|${left.representation}`
    .localeCompare(`${right.conceptId}|${right.status}|${right.representation}`));
  const signature = {
    role: normalizedReleaseText(component?.role),
    explanation: normalizedReleaseText(component?.explanation),
    formalKind: normalizedReleaseText(component?.formalKind),
    formal: normalizedReleaseText(component?.formal),
    concepts: normalizedList(component?.concepts),
    symbols,
    bindings
  };
  if (!signature.role && !signature.explanation && !signature.formal && !signature.bindings.length) return "";
  return sha256(JSON.stringify(signature));
}

function parseCli(argv) {
  const options = { check: false, candidateOnly: false, jobs: 8, limit: 0, from: "", paper: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      return value;
    };
    if (argument === "--check") options.check = true;
    else if (argument === "--candidate-only") options.candidateOnly = true;
    else if (argument === "--jobs") options.jobs = Number(take());
    else if (argument === "--limit") options.limit = Number(take());
    else if (argument === "--from") options.from = take();
    else if (argument === "--paper" || argument === "--id") options.paper.push(...take().split(",").map((value) => value.trim()).filter(Boolean));
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.jobs) || options.jobs < 1) throw new Error("--jobs must be a positive integer");
  if (options.limit && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error("--limit must be a positive integer");
  if (options.check && (options.limit || options.from || options.paper.length)) throw new Error("--check is a full-release check and cannot be combined with selectors");
  if (options.check && options.candidateOnly) throw new Error("--candidate-only is a write-mode audit and cannot be combined with --check");
  if (options.candidateOnly && (options.limit || options.from || options.paper.length)) throw new Error("--candidate-only is a full-corpus audit and cannot be combined with selectors");
  return options;
}

function fullCorpusAuditRequested(options) {
  return !options.from && !options.limit && (options.paper || []).length === 0;
}

function auditCliShouldFail(options, result) {
  return !options.check && !options.candidateOnly && !result.releaseReady;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function atomicWriteJson(filename, value, { canonical = false } = {}) {
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

async function atomicWriteBytes(filename, content) {
  await mkdir(path.dirname(filename), { recursive: true });
  const wanted = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const current = await readFile(filename).catch((error) => error.code === "ENOENT" ? Buffer.alloc(0) : Promise.reject(error));
  if (current.equals(wanted)) return false;
  const temporary = `${filename}.${process.pid}-${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(wanted);
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

function selectorIndex(records) {
  const index = new Map();
  for (const record of records) {
    for (const value of [record.id, record.doi, record.doi ? `https://doi.org/${record.doi}` : ""]) {
      if (value) index.set(String(value).toLowerCase(), record.id);
    }
  }
  return index;
}

function selectRecords(records, options) {
  const index = selectorIndex(records);
  let selected = [...records].sort((left, right) => left.id.localeCompare(right.id));
  if (options.from) {
    const id = index.get(options.from.toLowerCase());
    if (!id) throw new Error(`Unknown --from selector: ${options.from}`);
    const start = selected.findIndex((record) => record.id === id);
    selected = selected.slice(start);
  }
  if (options.paper.length) {
    const wanted = new Set(options.paper.map((selector) => {
      const id = index.get(selector.toLowerCase());
      if (!id) throw new Error(`Unknown paper selector: ${selector}`);
      return id;
    }));
    selected = selected.filter((record) => wanted.has(record.id));
  }
  if (options.limit) selected = selected.slice(0, options.limit);
  return selected;
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function hashFileIdentity(filename) {
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

async function assertCurrentPdfFiles(root, records, jobs = 8) {
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error("PDF preflight jobs must be a positive integer");
  await mapLimit(records, jobs, async (record) => {
    const paperId = String(record?.id || "unknown-paper");
    const expected = record?.pdf || {};
    const filename = resolveWithinRoot(root, expected.path, `${paperId}: source PDF path`);
    let observed;
    try {
      observed = await hashFileIdentity(filename);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`${paperId}: current source PDF is missing`);
      throw error;
    }
    const issues = [];
    if (observed.header !== "%PDF-") issues.push("invalid_pdf_header");
    if (observed.bytes !== Number(expected.bytes)) issues.push("pdf_byte_mismatch");
    if (observed.sha256 !== String(expected.sha256 || "").toLowerCase()) issues.push("pdf_sha256_mismatch");
    if (issues.length) {
      throw new Error(`${paperId}: current source PDF differs from the corpus manifest (${issues.join(", ")})`);
    }
  });
}

function conditionTokenStem(token) {
  if (token === "prices" || token === "priced" || token === "pricing") return "price";
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 7) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 6) return token.slice(0, -2);
  // Keep condition-to-component locality aligned with the authoring stemmer.
  // Without the `es` case, ordinary pairs such as brushes/brushing or
  // chooses/choosing are treated as unrelated and reject genuinely local
  // source conditions at the release gate.
  if (token.endsWith("es") && token.length > 6) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) return token.slice(0, -1);
  return token;
}

function conditionRelevanceTokens(value) {
  return (String(value ?? "").normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .map(conditionTokenStem)
    .map((token) => CONDITION_TOKEN_EQUIVALENTS.get(token) || token)
    .filter((token) => !CONDITION_RELEVANCE_STOP_WORDS.has(token) && !/^\d+$/u.test(token));
}

function conditionHasPredicate(value) {
  const text = String(value ?? "").normalize("NFKC");
  if (CONDITION_PREDICATE_SIGNAL.test(text) || CONDITION_PRODUCTIVE_VERB.test(text)
    || authoredConditionHasPredicate(text)) return true;
  const words = text.toLocaleLowerCase().match(/[\p{L}][\p{L}'’\-]*/gu) || [];
  return words.some((word) => {
    const lemmas = [word];
    if (word.endsWith("ies") && word.length > 4) lemmas.push(`${word.slice(0, -3)}y`);
    if (word.endsWith("es") && word.length > 4) lemmas.push(word.slice(0, -2), word.slice(0, -1));
    if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) lemmas.push(word.slice(0, -1));
    return lemmas.some((lemma) => CONDITION_BASE_PREDICATES.has(lemma));
  });
}

function sourceLocalText(source) {
  return [source?.section, source?.equation, source?.quote].filter(Boolean).join(" ");
}

function conditionLocalText(model, component, conditionIndex, { includeSources = true } = {}) {
  const bindings = (Array.isArray(component?.conceptBindings) ? component.conceptBindings : [])
    .filter((binding) => Array.isArray(binding?.conditionRefs) && binding.conditionRefs.includes(conditionIndex));
  const referencedSources = includeSources
    ? bindings.flatMap((binding) => (Array.isArray(binding?.sourceRefs) ? binding.sourceRefs : []))
      .map((reference) => {
        const sources = reference?.scope === "model" ? model?.sources : component?.sources;
        return Array.isArray(sources) && Number.isInteger(reference?.index) ? sources[reference.index] : null;
      })
      .filter(Boolean)
    : [];
  return [
    component?.role,
    ...(Array.isArray(component?.concepts) ? component.concepts : []),
    component?.label,
    component?.explanation,
    component?.formal,
    ...(Array.isArray(component?.searchPhrases) ? component.searchPhrases : []),
    ...(Array.isArray(component?.symbols)
      ? component.symbols.flatMap((symbol) => [symbol?.symbol, symbol?.meaning])
      : []),
    ...(includeSources && Array.isArray(component?.sources) ? component.sources.map(sourceLocalText) : []),
    ...bindings.flatMap((binding) => [binding?.conceptId, binding?.representation]),
    ...referencedSources.map(sourceLocalText)
  ].filter(Boolean).join(" ");
}

function conditionHasLocalSupport(model, component, condition, conditionIndex) {
  // Authoring records setup inheritance explicitly. In that case a copied
  // setup quote must overlap the component itself; attaching the same setup
  // quote as a component source cannot manufacture local relevance. Exact
  // setup-value matching keeps the backstop effective for legacy notes that
  // predate conditionEvidence metadata.
  const normalizedCondition = String(condition ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
  const inheritedFromSetup = (Array.isArray(component?.conditionEvidence) ? component.conditionEvidence : [])
    .some((entry) => entry?.conditionIndex === conditionIndex && entry?.inheritedFromSetupField)
    || SETUP_FIELDS.some((field) => (Array.isArray(model?.[field]) ? model[field] : [])
      .some((entry) => String(entry ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase()
        === normalizedCondition));
  const localTokens = new Set(conditionRelevanceTokens(conditionLocalText(
    model,
    component,
    conditionIndex,
    { includeSources: !inheritedFromSetup }
  )));
  return conditionRelevanceTokens(condition).some((token) => localTokens.has(token));
}

function validSymbolDefinition(symbol) {
  return typeof symbol?.symbol === "string" && Boolean(symbol.symbol.trim())
    && typeof symbol?.meaning === "string" && Boolean(symbol.meaning.trim())
    && !formalStructureIssue(symbol.symbol, "");
}

function formalLooksMateriallyMathematical(value) {
  const formal = String(value ?? "").normalize("NFKC").trim();
  if (!formal) return false;
  return formal.split(/\r?\n/u).some((line) => standaloneFormulaLine(line))
    || MATERIAL_MATH_SIGNAL.test(formal);
}

/**
 * Return the release-only structural gaps between a candidate note and the
 * universal frozen Mini note contract. The ordinary build validator owns
 * array types, distinct IDs, local reference ranges, and modeled-concept
 * consistency. This gate intentionally adds only the Mini invariants that the
 * broader authoring schema permits while a paper is still in progress.
 */
function miniParityReleaseIssues(note) {
  const issues = [];
  const add = (code, path, message) => issues.push({ code, path, message });
  const meaningfulArray = (value) => Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === "string" && Boolean(entry.trim()));
  const models = Array.isArray(note?.models) ? note.models : [];

  if (!isDirectResearchQuestion(note?.question)) {
    add(
      "paper.question.not-direct",
      "question",
      "A release note requires a grammatical, direct research question rather than a result, fragment, or generic topic prompt."
    );
  }

  if (!models.length) {
    add("paper.models.nonempty", "models", "A release note must contain at least one model.");
    return issues;
  }

  const baseline = models[0];
  const baselineMethod = normalizedReleaseText(baseline?.method);
  const baselineSetup = JSON.stringify(SETUP_FIELDS.map((field) => baseline?.[field] || []));
  const modelComponentSignature = (model) => JSON.stringify((model?.components || []).map((component) => ({
    label: normalizedReleaseText(component?.label),
    role: normalizedReleaseText(component?.role),
    explanation: normalizedReleaseText(component?.explanation),
    formal: normalizedReleaseText(component?.formal)
  })));
  const baselineComponents = modelComponentSignature(baseline);

  for (const [modelIndex, model] of models.entries()) {
    const modelPath = `models[${modelIndex}]`;
    const seenSubstantiveComponents = new Map();
    const method = normalizedReleaseText(model?.method);
    if ((method.match(/[\p{L}\p{N}]+/gu) || []).length < 5) {
      add("model.method.not-substantive", `${modelPath}.method`, "A release model requires a substantive solution, estimation, or analysis method.");
    }
    const repeatsBaselineMethod = modelIndex > 0 && method === baselineMethod;
    const repeatsBaselineSetup = modelIndex > 0
      && JSON.stringify(SETUP_FIELDS.map((field) => model?.[field] || [])) === baselineSetup;
    const repeatsBaselineComponents = modelIndex > 0 && modelComponentSignature(model) === baselineComponents;
    if (repeatsBaselineMethod && repeatsBaselineSetup && repeatsBaselineComponents) {
      add(
        "model.variant.no-substantive-delta",
        modelPath,
        "A model variant must differ from the baseline in a source-grounded setup field, component, objective, constraint, or method."
      );
    }
    for (const field of SETUP_FIELDS) {
      if (!meaningfulArray(model?.[field])) {
        add(
          "model.setup.nonempty",
          `${modelPath}.${field}`,
          `Mini-parity release notes require at least one nonempty ${field} entry per model.`
        );
      }
    }

    const components = Array.isArray(model?.components) ? model.components : [];
    if (!components.length) {
      add("model.components.nonempty", `${modelPath}.components`, "A release model must contain at least one component.");
      continue;
    }

    for (const [componentIndex, component] of components.entries()) {
      const componentPath = `${modelPath}.components[${componentIndex}]`;
      const componentFingerprint = releaseComponentSubstanceFingerprint(component);
      const priorComponentPath = seenSubstantiveComponents.get(componentFingerprint);
      if (componentFingerprint && priorComponentPath) {
        add(
          "component.semantic-duplicate",
          componentPath,
          `This component repeats the same substantive role, explanation, formal content, and concept representation as ${priorComponentPath}.`
        );
      } else if (componentFingerprint) seenSubstantiveComponents.set(componentFingerprint, componentPath);
      const conditions = Array.isArray(component?.conditions) ? component.conditions : [];
      if (!meaningfulArray(component?.conditions)) {
        add(
          "component.conditions.nonempty",
          `${componentPath}.conditions`,
          "Mini-parity release components require at least one nonempty condition."
        );
      }
      for (const [conditionIndex, condition] of conditions.entries()) {
        const conditionPath = `${componentPath}.conditions[${conditionIndex}]`;
        const termCount = (String(condition ?? "").normalize("NFKC").match(/[\p{L}\p{N}]+/gu) || []).length;
        if (termCount < 5 || !/[.!?]\s*$/u.test(String(condition ?? ""))) {
          add(
            "component.condition.not-substantive",
            conditionPath,
            "Release conditions require at least five word or identifier terms and terminal sentence punctuation."
          );
        } else if (!conditionHasPredicate(condition)) {
          add(
            "component.condition.not-predicate",
            conditionPath,
            "A release condition must state a predicate, relation, or explicit mathematical qualification rather than a noun-phrase label."
          );
        } else if (!conditionHasLocalSupport(model, component, condition, conditionIndex)) {
          add(
            "component.condition.no-local-support",
            conditionPath,
            "A release condition must overlap its component content, binding explanation, or condition-linked source rather than only model-wide setup."
          );
        }
      }

      const symbols = Array.isArray(component?.symbols) ? component.symbols : [];
      const requiresSymbolDefinition = component?.formalKind !== VERBAL_FORMAL_KIND
        || formalLooksMateriallyMathematical(component?.formal);
      if (requiresSymbolDefinition && !symbols.some(validSymbolDefinition)) {
        add(
          "component.symbols.mathematical-definition",
          `${componentPath}.symbols`,
          "Every non-verbal or materially mathematical component requires at least one nonempty, structurally valid symbol definition."
        );
      }
      if (!meaningfulArray(component?.concepts)) {
        add(
          "component.concepts.nonempty",
          `${componentPath}.concepts`,
          "Mini-parity release components require at least one modeled concept."
        );
      }

      const bindings = Array.isArray(component?.conceptBindings) ? component.conceptBindings : [];
      if (!bindings.length) {
        add(
          "component.concept-bindings.nonempty",
          `${componentPath}.conceptBindings`,
          "Mini-parity release components require at least one concept binding."
        );
        continue;
      }
      if (!bindings.some((binding) => binding?.status === "modeled")) {
        add(
          "component.modeled-binding.nonempty",
          `${componentPath}.conceptBindings`,
          "Every release component requires at least one modeled concept binding."
        );
      }

      for (const [bindingIndex, binding] of bindings.entries()) {
        const bindingPath = `${componentPath}.conceptBindings[${bindingIndex}]`;
        if (binding?.mappingBasis === "component-role" || GENERIC_BINDING_REPRESENTATION.test(String(binding?.representation || ""))) {
          add(
            "binding.representation.generic-role",
            `${bindingPath}.representation`,
            "A release binding must explain how the concept operates in this component; a generic role classification is not source-grounded concept evidence."
          );
        }
        if (!MINI_PARITY_RELEASE_BINDING_STATUSES.has(binding?.status)) {
          add(
            "binding.status.release-ineligible",
            `${bindingPath}.status`,
            `Release bindings must be modeled, explicitlyExcluded, or backgroundOnly; received ${String(binding?.status)}.`
          );
        }
        if (!Array.isArray(binding?.sourceRefs) || !binding.sourceRefs.length) {
          add(
            "binding.source-refs.nonempty",
            `${bindingPath}.sourceRefs`,
            "Every release binding requires at least one local source reference."
          );
        }
        if (!Array.isArray(binding?.conditionRefs) || !binding.conditionRefs.length) {
          add(
            "binding.condition-refs.nonempty",
            `${bindingPath}.conditionRefs`,
            "Every release binding requires at least one component-condition reference."
          );
        }
      }
    }
  }

  return issues;
}

function noteMetrics(note) {
  const models = note.models || [];
  const components = models.flatMap((model) => model.components || []);
  const sources = [
    ...models.flatMap((model) => model.sources || []),
    ...components.flatMap((component) => component.sources || [])
  ];
  const bindings = components.flatMap((component) => component.conceptBindings || []);
  const normalizedNotation = components.filter((component) => component.formalKind === "Atlas normalized notation").length;
  const sourceExtractedEquations = components.filter((component) => component.formalKind === SOURCE_EXTRACTED_EQUATION).length;
  const verbalRestatements = components.filter((component) => component.formalKind === "Atlas restatement of source rule").length;
  let setupFieldsPopulated = 0;
  let setupFieldsCovered = 0;
  let setupEntries = 0;
  for (const model of models) {
    for (const field of SETUP_FIELDS) {
      const entries = (model[field] || []).filter((entry) => String(entry || "").trim());
      const populated = entries.length > 0;
      if (populated) setupFieldsPopulated += 1;
      setupEntries += entries.length;
      if (populated && model.setupMaturity?.[field] !== "unresolved") setupFieldsCovered += 1;
    }
  }
  const setupFieldsTotal = models.length * SETUP_FIELDS.length;
  const setupFieldsUnresolved = setupFieldsTotal - setupFieldsCovered;
  const componentsWithSymbols = components.filter((component) => (component.symbols || []).length > 0).length;
  const symbolCount = components.reduce((total, component) => total + (component.symbols || []).length, 0);
  const componentsWithConditions = components.filter((component) => (component.conditions || []).length > 0).length;
  const conditionCount = components.reduce((total, component) => total + (component.conditions || []).length, 0);
  const modeledBindings = bindings.filter((binding) => binding.status === "modeled").length;
  const unknownBindings = bindings.filter((binding) => binding.status === "unknown").length;
  const otherBindings = bindings.length - modeledBindings - unknownBindings;
  const baseline = models[0];
  const baselineMethod = String(baseline?.method || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const sourceSectionKeys = (model) => new Set([
    ...(model?.sources || []),
    ...(model?.components || []).flatMap((component) => component.sources || [])
  ].filter((source) => source?.section)
    .map((source) => `${Number(source.page) || 0}|${String(source.section).replace(/\s+/g, " ").trim().toLocaleLowerCase()}`));
  const baselineSections = sourceSectionKeys(baseline);
  const variants = models.slice(1);
  let variantsWithDistinctMethod = 0;
  let variantsWithDistinctSectionEvidence = 0;
  for (const variant of variants) {
    const method = String(variant.method || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (method && method !== baselineMethod) variantsWithDistinctMethod += 1;
    const variantSections = sourceSectionKeys(variant);
    if ([...variantSections].some((key) => !baselineSections.has(key))) variantsWithDistinctSectionEvidence += 1;
  }
  return {
    models: models.length,
    components: components.length,
    sources: sources.length,
    bindings: bindings.length,
    setupFieldsTotal,
    setupFieldsPopulated,
    setupFieldsCovered,
    setupFieldsUnresolved,
    setupEntries,
    sourceExtractedEquations,
    normalizedNotation,
    verbalRestatements,
    componentsWithSymbols,
    componentsWithoutSymbols: components.length - componentsWithSymbols,
    symbolCount,
    componentsWithConditions,
    componentsWithoutConditions: components.length - componentsWithConditions,
    conditionCount,
    modeledBindings,
    unknownBindings,
    otherBindings,
    variantModels: variants.length,
    variantsWithDistinctMethod,
    variantsSharingBaseMethod: variants.length - variantsWithDistinctMethod,
    variantsWithDistinctSectionEvidence,
    variantsWithoutDistinctSectionEvidence: variants.length - variantsWithDistinctSectionEvidence
  };
}

function contentAuditWarnings(metrics) {
  const warnings = [];
  if (metrics.setupFieldsUnresolved) {
    warnings.push(`setup_unresolved: ${metrics.setupFieldsUnresolved}/${metrics.setupFieldsTotal} setup fields lack supported resolved coverage.`);
  }
  if (!metrics.sourceExtractedEquations && !metrics.normalizedNotation && metrics.verbalRestatements) {
    warnings.push(`formal_verbal_only: ${metrics.verbalRestatements} component formal field(s) use labeled verbal restatements; no equation transcription is claimed.`);
  }
  if (metrics.componentsWithoutSymbols) {
    warnings.push(`symbols_unresolved: ${metrics.componentsWithoutSymbols}/${metrics.components} components have no retained symbol entries; this can reflect source or extraction limits.`);
  }
  if (metrics.componentsWithoutConditions) {
    warnings.push(`conditions_unresolved: ${metrics.componentsWithoutConditions}/${metrics.components} components have no retained condition entries; this can reflect source or extraction limits.`);
  }
  if (metrics.unknownBindings) {
    warnings.push(`bindings_unknown: ${metrics.unknownBindings}/${metrics.bindings} concept bindings remain explicitly unknown.`);
  }
  if (metrics.variantsSharingBaseMethod) {
    warnings.push(`variant_method_shared: ${metrics.variantsSharingBaseMethod}/${metrics.variantModels} variants reuse the baseline method and therefore lack distinct method evidence.`);
  }
  if (metrics.variantsWithoutDistinctSectionEvidence) {
    warnings.push(`variant_section_evidence_unresolved: ${metrics.variantsWithoutDistinctSectionEvidence}/${metrics.variantModels} variants have no source-section evidence distinct from the baseline.`);
  }
  return warnings;
}

function contentMetricView(metrics) {
  return {
    setup: {
      fieldsTotal: metrics.setupFieldsTotal,
      fieldsPopulated: metrics.setupFieldsPopulated,
      fieldsCovered: metrics.setupFieldsCovered,
      fieldsUnresolved: metrics.setupFieldsUnresolved,
      entries: metrics.setupEntries
    },
    formalContent: {
      sourceExtractedEquations: metrics.sourceExtractedEquations,
      normalizedNotation: metrics.normalizedNotation,
      verbalRestatements: metrics.verbalRestatements
    },
    symbols: {
      componentsWithSymbols: metrics.componentsWithSymbols,
      componentsWithoutSymbols: metrics.componentsWithoutSymbols,
      entries: metrics.symbolCount
    },
    conditions: {
      componentsWithConditions: metrics.componentsWithConditions,
      componentsWithoutConditions: metrics.componentsWithoutConditions,
      entries: metrics.conditionCount
    },
    bindings: {
      total: metrics.bindings,
      modeled: metrics.modeledBindings,
      unknown: metrics.unknownBindings,
      otherExplicitStatuses: metrics.otherBindings
    },
    variants: {
      total: metrics.variantModels,
      withDistinctMethod: metrics.variantsWithDistinctMethod,
      sharingBaselineMethod: metrics.variantsSharingBaseMethod,
      withDistinctSectionEvidence: metrics.variantsWithDistinctSectionEvidence,
      withoutDistinctSectionEvidence: metrics.variantsWithoutDistinctSectionEvidence
    }
  };
}

function auditStages({ ledger, note, noteSha256, modelNotesSha256, modelNotesJsSha256, conceptRegistrySha256, semantic, qaBinding, qaDecision = null }) {
  if (!terminalQaBinding(qaBinding)) {
    throw new Error(`${ledger.paperId}: a current terminal Extraction QA binding is required`);
  }
  const formalIssues = noteFormalStructureIssues(note);
  if (formalIssues.length) {
    const sample = formalIssues.slice(0, 3).map((entry) => `${entry.reason}@${entry.path}`).join(", ");
    throw new Error(`${ledger.paperId}: formal-structure audit failed (${formalIssues.length}): ${sample}`);
  }
  const metrics = noteMetrics(note);
  const contentMetrics = contentMetricView(metrics);
  const contentWarnings = contentAuditWarnings(metrics);
  const candidatePaperSha256 = sha256(stableStringify(note));
  const base = {
    auditVersion: AUDIT_VERSION,
    paperId: ledger.paperId,
    sourcePdfSha256: ledger.pdfSha256,
    extractionPagesSha256: ledger.stages.extraction.artifacts.pagesSha256,
    noteSha256,
    candidatePaperSha256,
    conceptRegistrySha256,
    ...qaBinding
  };
  const identity = {
    auditVersion: AUDIT_VERSION,
    paperId: ledger.paperId,
    sourcePdfSha256: ledger.pdfSha256,
    extractionPagesSha256: ledger.stages.extraction.artifacts.pagesSha256,
    noteSha256,
    candidatePaperSha256,
    conceptRegistrySha256,
    ...qaBinding
  };
  const digest = (stage, additions = {}) => sha256(stableStringify({ stage, ...base, ...additions }));
  const quoteAudit = {
    status: "complete",
    ...identity,
    inputDigest: digest("quoteAudit", { sourceCount: metrics.sources }),
    sourceCount: metrics.sources,
    method: "Every nonempty excerpt is an exact substring of its cited extracted page after whitespace normalization."
  };
  const formulaAudit = {
    status: "complete",
    ...identity,
    inputDigest: digest("formulaAudit", { sourceExtractedEquations: metrics.sourceExtractedEquations, normalizedNotation: metrics.normalizedNotation, verbalRestatements: metrics.verbalRestatements, structurallyValidatedFormals: metrics.components }),
    sourceExtractedEquations: metrics.sourceExtractedEquations,
    normalizedNotation: metrics.normalizedNotation,
    verbalRestatements: metrics.verbalRestatements,
    structurallyValidatedFormals: metrics.components,
    method: "Every formal field passed delimiter and clipped-boundary checks. Counts distinguish source-extracted equations that were not visually verified, Atlas-normalized notation, and labeled verbal restatements; completion does not imply independent expert verification."
  };
  const schemaValidation = {
    status: "complete",
    ...identity,
    inputDigest: digest("schemaValidation", { models: metrics.models, components: metrics.components, bindings: metrics.bindings, semantic: semantic.metrics }),
    schemaVersion: 2,
    models: metrics.models,
    components: metrics.components,
    bindings: metrics.bindings,
    semanticMetrics: semantic.metrics,
    semanticWarnings: semantic.warnings,
    method: "Mini-compatible model, component, binding, relationship, reference, English-only, and semantic source-grounding invariants passed."
  };
  const contentAudit = {
    status: "complete",
    ...identity,
    inputDigest: digest("contentAudit", { contentMetrics }),
    maturity: contentWarnings.length ? "audited-with-warnings" : "audited",
    expertReview: false,
    metrics: contentMetrics,
    warnings: contentWarnings,
    method: "Automated maturity accounting for setup, formal content, symbols, conditions, concept bindings, and variant-local evidence. Complete means this audit ran; it does not claim substantive expert review."
  };
  const extractionSourceReasons = [...(qaDecision?.sourceReasons || [])];
  const extractionUnresolvedReasons = [...(qaDecision?.unresolvedReasons || [])];
  const sourceAudit = {
    status: "complete",
    ...identity,
    inputDigest: digest("sourceAudit", {
      quoteAudit: quoteAudit.inputDigest,
      formulaAudit: formulaAudit.inputDigest,
      schemaValidation: schemaValidation.inputDigest,
      contentAudit: contentAudit.inputDigest,
      extractionSourceReasons,
      extractionUnresolvedReasons,
      ...qaBinding
    }),
    extractionSourceReasons,
    extractionUnresolvedReasons,
    warnings: [
      ...((qaDecision?.sourceReasons || []).length
        ? [`Extraction provenance retained in ${qaBinding.extractionQaDecisionPath}: ${(qaDecision.sourceReasons || []).join(", ")}.`]
        : []),
      ...((qaDecision?.unresolvedReasons || []).length
        ? [`Extraction QA remains unresolved in ${qaBinding.extractionQaDecisionPath}: ${(qaDecision.unresolvedReasons || []).join(", ")}.`]
        : []),
      ...contentWarnings,
      ...semantic.warnings.map((entry) => `${entry.code}: ${entry.message}`)
    ],
    method: "Hash-bound extraction, note, quotation, formal-policy, schema, semantic, and content-maturity audits reconciled."
  };
  const releaseBuild = {
    status: qaBinding.extractionQaStatus === "complete" ? "complete" : "pending",
    ...identity,
    inputDigest: digest("releaseBuild", { sourceAudit: sourceAudit.inputDigest, contentAudit: contentAudit.inputDigest, modelNotesSha256, modelNotesJsSha256 }),
    modelNotesSha256,
    modelNotesJsSha256,
    ...(qaBinding.extractionQaStatus === "complete"
      ? { method: "Included exactly once in the validated full-corpus model-note release." }
      : { reason: "Internal candidate only: Extraction QA remains explicitly needs_review." })
  };
  return { quoteAudit, formulaAudit, schemaValidation, contentAudit, sourceAudit, releaseBuild, metrics };
}

function miniReadingStages(ledger, qaBinding = null) {
  const authored = ledger.stages.noteAuthoring;
  if (authored?.source !== "mini-atlas-schema-v2") return null;
  if (authored.status !== "complete" || authored.sourcePdfSha256 !== ledger.pdfSha256
    || !/^[a-f0-9]{64}$/.test(authored.noteSha256 || "") || !authored.notePath) {
    throw new Error(`${ledger.paperId}: Mini note checkpoint is incomplete or stale`);
  }
  const canonicalPagesArtifact = authored.miniPaperId
    ? path.posix.join("mini-atlas", "research", "pages", `${authored.miniPaperId}.json`)
    : "";
  if (!canonicalPagesArtifact || authored.pagesPath !== canonicalPagesArtifact) {
    throw new Error(`${ledger.paperId}: Mini frozen-page path binding is missing or invalid`);
  }
  if (!/^[a-f0-9]{64}$/.test(authored.pagesSha256 || "")) {
    throw new Error(`${ledger.paperId}: Mini frozen-page hash binding is missing or invalid`);
  }
  const pagesArtifact = authored.pagesPath;
  const pagesSha256 = authored.pagesSha256;
  const noteBaseInputDigest = sha256(`${ledger.pdfSha256}\0${authored.noteSha256}\0${authored.pagesSha256}`);
  const noteInputDigest = qaBinding
    ? extractionQaBoundDigest("noteAuthoring", noteBaseInputDigest, qaBinding)
    : noteBaseInputDigest;
  const readingBaseInputDigest = miniReadingInputDigest({
    paperId: ledger.paperId,
    sourcePdfSha256: ledger.pdfSha256,
    noteSha256: authored.noteSha256,
    pagesArtifact,
    pagesSha256
  });
  const inputDigest = qaBinding
    ? extractionQaBoundDigest("sourceReading", readingBaseInputDigest, qaBinding)
    : readingBaseInputDigest;
  return {
    ...(qaBinding ? {
      noteAuthoring: {
        ...authored,
        inputDigest: noteInputDigest,
        ...qaBinding
      }
    } : {}),
    sectionIndex: {
      status: "complete",
      auditVersion: AUDIT_VERSION,
      inputDigest,
      sourcePdfSha256: ledger.pdfSha256,
      pagesArtifact,
      pagesSha256,
      ...(qaBinding || {}),
      source: "Mini Atlas editorial fixture"
    },
    sourceReading: {
      status: "complete",
      auditVersion: AUDIT_VERSION,
      inputDigest,
      sourcePdfSha256: ledger.pdfSha256,
      pagesArtifact,
      pagesSha256,
      notePath: authored.notePath,
      noteSha256: authored.noteSha256,
      ...(qaBinding || {}),
      mode: "Frozen Mini Atlas editorial source map"
    }
  };
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

async function readMiniPagesForAudit(root, ledger, qaBinding = null) {
  const authored = ledger.stages.noteAuthoring;
  miniReadingStages(ledger, qaBinding);
  const filename = resolveWithinRoot(root, authored.pagesPath, `${ledger.paperId}: Mini frozen-page artifact`);
  const bytes = await readFile(filename);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== authored.pagesSha256) {
    throw new Error(`${ledger.paperId}: Mini frozen-page artifact hash mismatch`);
  }
  let payload;
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${ledger.paperId}: Mini frozen-page artifact is invalid JSON`);
  }
  const pages = Array.isArray(payload) ? payload : payload?.pages;
  if (!Array.isArray(pages) || !pages.length) {
    throw new Error(`${ledger.paperId}: Mini frozen-page artifact contains no pages`);
  }
  return payload;
}

const PREREQUISITE_STAGES = ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit", "sourceAudit"];

function emptyTotals() {
  return {
    papers: 0,
    models: 0,
    components: 0,
    sources: 0,
    bindings: 0,
    setupFieldsTotal: 0,
    setupFieldsPopulated: 0,
    setupFieldsCovered: 0,
    setupFieldsUnresolved: 0,
    setupEntries: 0,
    sourceExtractedEquations: 0,
    normalizedNotation: 0,
    verbalRestatements: 0,
    componentsWithSymbols: 0,
    componentsWithoutSymbols: 0,
    symbolCount: 0,
    componentsWithConditions: 0,
    componentsWithoutConditions: 0,
    conditionCount: 0,
    modeledBindings: 0,
    unknownBindings: 0,
    otherBindings: 0,
    variantModels: 0,
    variantsWithDistinctMethod: 0,
    variantsSharingBaseMethod: 0,
    variantsWithDistinctSectionEvidence: 0,
    variantsWithoutDistinctSectionEvidence: 0,
    papersWithContentWarnings: 0,
    contentWarnings: 0,
    semanticWarnings: 0,
    extractionWarnings: 0
  };
}

function addExpectedTotals(totals, expected, semantic, qaDecision = null) {
  totals.papers += 1;
  for (const key of [
    "models", "components", "sources", "bindings",
    "setupFieldsTotal", "setupFieldsPopulated", "setupFieldsCovered", "setupFieldsUnresolved", "setupEntries",
    "sourceExtractedEquations", "normalizedNotation", "verbalRestatements",
    "componentsWithSymbols", "componentsWithoutSymbols", "symbolCount",
    "componentsWithConditions", "componentsWithoutConditions", "conditionCount",
    "modeledBindings", "unknownBindings", "otherBindings",
    "variantModels", "variantsWithDistinctMethod", "variantsSharingBaseMethod",
    "variantsWithDistinctSectionEvidence", "variantsWithoutDistinctSectionEvidence"
  ]) totals[key] += expected.metrics[key];
  totals.contentWarnings += expected.contentAudit.warnings.length;
  if (expected.contentAudit.warnings.length) totals.papersWithContentWarnings += 1;
  totals.semanticWarnings += semantic.warnings.length;
  if ((qaDecision?.sourceReasons || []).length || (qaDecision?.unresolvedReasons || []).length) totals.extractionWarnings += 1;
}

function auditBase(ledger, noteSha256, conceptRegistrySha256, candidatePaperSha256, qaBinding) {
  return {
    auditVersion: AUDIT_VERSION,
    paperId: ledger.paperId,
    sourcePdfSha256: ledger.pdfSha256,
    extractionPagesSha256: ledger.stages.extraction?.artifacts?.pagesSha256,
    noteSha256,
    candidatePaperSha256,
    conceptRegistrySha256,
    ...(qaBinding || {})
  };
}

function stageDigest(stage, base, additions = {}) {
  return sha256(stableStringify({ stage, ...base, ...additions }));
}

function prerequisiteAuditCurrent(ledger, conceptRegistrySha256, candidatePaperSha256, qaBinding = null) {
  if (!terminalQaBinding(qaBinding)) return false;
  const noteSha256 = ledger.stages.noteAuthoring?.noteSha256;
  if (!/^[a-f0-9]{64}$/.test(noteSha256 || "")) return false;
  if (!/^[a-f0-9]{64}$/.test(candidatePaperSha256 || "")) return false;
  const base = auditBase(ledger, noteSha256, conceptRegistrySha256, candidatePaperSha256, qaBinding);
  if (!base.extractionPagesSha256) return false;
  for (const name of PREREQUISITE_STAGES) {
    const stage = ledger.stages[name];
    if (stage?.status !== "complete"
      || stage.auditVersion !== AUDIT_VERSION
      || stage.paperId !== ledger.paperId
      || stage.sourcePdfSha256 !== ledger.pdfSha256
      || stage.extractionPagesSha256 !== base.extractionPagesSha256
      || stage.noteSha256 !== noteSha256
      || stage.candidatePaperSha256 !== candidatePaperSha256
      || stage.conceptRegistrySha256 !== conceptRegistrySha256
      || !qaBindingsMatch(stage, qaBinding)) return false;
  }
  const quoteAudit = ledger.stages.quoteAudit;
  if (quoteAudit.inputDigest !== stageDigest("quoteAudit", base, { sourceCount: quoteAudit.sourceCount })) return false;
  const formulaAudit = ledger.stages.formulaAudit;
  if (formulaAudit.inputDigest !== stageDigest("formulaAudit", base, {
    sourceExtractedEquations: formulaAudit.sourceExtractedEquations,
    normalizedNotation: formulaAudit.normalizedNotation,
    verbalRestatements: formulaAudit.verbalRestatements,
    structurallyValidatedFormals: formulaAudit.structurallyValidatedFormals
  })) return false;
  if (formulaAudit.structurallyValidatedFormals !== ledger.stages.schemaValidation?.components) return false;
  const schemaValidation = ledger.stages.schemaValidation;
  if (schemaValidation.inputDigest !== stageDigest("schemaValidation", base, {
    models: schemaValidation.models,
    components: schemaValidation.components,
    bindings: schemaValidation.bindings,
    semantic: schemaValidation.semanticMetrics
  })) return false;
  const contentAudit = ledger.stages.contentAudit;
  if (contentAudit.inputDigest !== stageDigest("contentAudit", base, { contentMetrics: contentAudit.metrics })) return false;
  const sourceAudit = ledger.stages.sourceAudit;
  if (sourceAudit.inputDigest !== stageDigest("sourceAudit", base, {
    quoteAudit: quoteAudit.inputDigest,
    formulaAudit: formulaAudit.inputDigest,
    schemaValidation: schemaValidation.inputDigest,
    contentAudit: contentAudit.inputDigest,
    extractionSourceReasons: sourceAudit.extractionSourceReasons || [],
    extractionUnresolvedReasons: sourceAudit.extractionUnresolvedReasons || [],
    ...qaBinding
  })) return false;
  let miniStages;
  try {
    miniStages = miniReadingStages(ledger, qaBinding);
  } catch {
    return false;
  }
  return !miniStages || (stableStringify(ledger.stages.noteAuthoring) === stableStringify(miniStages.noteAuthoring)
    && stableStringify(ledger.stages.sectionIndex) === stableStringify(miniStages.sectionIndex)
    && stableStringify(ledger.stages.sourceReading) === stableStringify(miniStages.sourceReading));
}

function releaseBuildStage(ledger, { modelNotesSha256, modelNotesJsSha256, conceptRegistrySha256, candidatePaperSha256, qaBinding }) {
  const noteSha256 = ledger.stages.noteAuthoring.noteSha256;
  if (!terminalQaBinding(qaBinding) || qaBinding.extractionQaStatus !== "complete") {
    throw new Error(`${ledger.paperId}: releaseBuild requires a complete eight-field release-ready Extraction QA binding`);
  }
  const base = auditBase(ledger, noteSha256, conceptRegistrySha256, candidatePaperSha256, qaBinding);
  return {
    status: "complete",
    ...base,
    inputDigest: stageDigest("releaseBuild", base, {
      sourceAudit: ledger.stages.sourceAudit.inputDigest,
      contentAudit: ledger.stages.contentAudit.inputDigest,
      modelNotesSha256,
      modelNotesJsSha256
    }),
    modelNotesSha256,
    modelNotesJsSha256,
    method: "Included exactly once in the validated full-corpus model-note release."
  };
}

function pendingReleaseBuildStage(expectedReleaseBuild, qaBinding) {
  const { method: _method, reason: _reason, ...identity } = expectedReleaseBuild;
  return {
    ...identity,
    status: "pending",
    reason: qaBinding.extractionQaStatus === "needs_review"
      ? "Internal candidate only: Extraction QA remains explicitly needs_review."
      : "Awaiting complete corpus audit and atomic public promotion."
  };
}

function totalsFromLedgers(ledgers) {
  const totals = emptyTotals();
  for (const ledger of ledgers) {
    const schema = ledger.stages.schemaValidation;
    const quote = ledger.stages.quoteAudit;
    const content = ledger.stages.contentAudit;
    const metrics = content.metrics;
    totals.papers += 1;
    totals.models += schema.models;
    totals.components += schema.components;
    totals.sources += quote.sourceCount;
    totals.bindings += schema.bindings;
    totals.setupFieldsTotal += metrics.setup.fieldsTotal;
    totals.setupFieldsPopulated += metrics.setup.fieldsPopulated;
    totals.setupFieldsCovered += metrics.setup.fieldsCovered;
    totals.setupFieldsUnresolved += metrics.setup.fieldsUnresolved;
    totals.setupEntries += metrics.setup.entries;
    totals.sourceExtractedEquations += metrics.formalContent.sourceExtractedEquations;
    totals.normalizedNotation += metrics.formalContent.normalizedNotation;
    totals.verbalRestatements += metrics.formalContent.verbalRestatements;
    totals.componentsWithSymbols += metrics.symbols.componentsWithSymbols;
    totals.componentsWithoutSymbols += metrics.symbols.componentsWithoutSymbols;
    totals.symbolCount += metrics.symbols.entries;
    totals.componentsWithConditions += metrics.conditions.componentsWithConditions;
    totals.componentsWithoutConditions += metrics.conditions.componentsWithoutConditions;
    totals.conditionCount += metrics.conditions.entries;
    totals.modeledBindings += metrics.bindings.modeled;
    totals.unknownBindings += metrics.bindings.unknown;
    totals.otherBindings += metrics.bindings.otherExplicitStatuses;
    totals.variantModels += metrics.variants.total;
    totals.variantsWithDistinctMethod += metrics.variants.withDistinctMethod;
    totals.variantsSharingBaseMethod += metrics.variants.sharingBaselineMethod;
    totals.variantsWithDistinctSectionEvidence += metrics.variants.withDistinctSectionEvidence;
    totals.variantsWithoutDistinctSectionEvidence += metrics.variants.withoutDistinctSectionEvidence;
    totals.contentWarnings += content.warnings.length;
    if (content.warnings.length) totals.papersWithContentWarnings += 1;
    totals.semanticWarnings += (schema.semanticWarnings || []).length;
    if ((ledger.stages.sourceAudit?.extractionSourceReasons || []).length) totals.extractionWarnings += 1;
  }
  return totals;
}

function auditReport({ manifest, release, modelNotesSha256, modelNotesJsSha256, conceptRegistrySha256, totals }) {
  return {
    schemaVersion: 1,
    auditVersion: AUDIT_VERSION,
    corpusRevision: manifest.corpusRevision,
    modelNotesSha256,
    modelNotesJsSha256,
    conceptRegistrySha256,
    noteSetSha256: release.noteSetSha256,
    totals,
    policies: {
      quotations: "Exact extracted-page substring after whitespace normalization.",
      formalContent: "Every formal field must pass structural delimiter and clipped-boundary validation. Source-extracted equations are counted separately and explicitly remain not visually verified; normalized notation and verbal restatements do not claim source-equation transcription.",
      contentMaturity: "A complete contentAudit means deterministic maturity metrics were recorded. Warnings preserve unresolved source limitations and do not imply substantive expert review.",
      setupCoverage: "A setup field is covered only when it is populated and is not explicitly marked unresolved; empty or explicitly unresolved fields remain visible in totals.",
      variantLocality: "Variant methods are compared with the baseline, and source-section evidence is local only when at least one cited page/section key is distinct from the baseline.",
      editorialStatus: "AI-assisted source maps are not represented as independent expert verification.",
      semanticValidation: "Automated notes must pass direct-question, substantive setup/method, clean-component, local-source-overlap, deduplication, and binding-status checks.",
      extractionWarnings: "Included with an explicit public provenance warning rather than silently omitted.",
      promotion: "The candidate is promoted only after every paper has current hash-bound prerequisite audits; interrupted promotion is convergent and safe to repeat."
    }
  };
}

function assertReleaseManifestIdentity(manifest, release) {
  if (!manifest || !Array.isArray(manifest.records)) throw new Error("Corpus manifest has no records array");
  if (!release || !Array.isArray(release.papers)) throw new Error("Release candidate has no papers array");
  if (manifest.recordsDigest !== sha256(stableStringify(manifest.records))) {
    throw new Error("Corpus manifest records digest is stale or corrupt");
  }
  if (release.sourceDataSha256 !== manifest.source?.dataSha256) {
    throw new Error("Release candidate and corpus manifest derive from different catalog snapshots");
  }
  if (release.papers.length !== manifest.records.length) throw new Error("Release candidate and manifest paper counts differ");
  const manifestIds = new Set(manifest.records.map((record) => record.id));
  const releaseIds = new Set(release.papers.map((paper) => paper.id));
  if (manifestIds.size !== manifest.records.length) throw new Error("Corpus manifest paper IDs are not unique");
  if (releaseIds.size !== release.papers.length) throw new Error("Release candidate paper IDs are not unique");
  const missing = [...manifestIds].filter((id) => !releaseIds.has(id));
  const extra = [...releaseIds].filter((id) => !manifestIds.has(id));
  if (missing.length || extra.length) {
    throw new Error(`Release candidate paper IDs differ from the manifest (missing=${missing.length}, extra=${extra.length})`);
  }
}

function assertLedgerManifestIdentity(record, ledger, manifest) {
  if (ledger?.paperId !== record.id
    || ledger.manifestRecordDigest !== record.recordDigest
    || ledger.corpusRevision !== manifest.corpusRevision
    || ledger.pdfSha256 !== record.pdf?.sha256) {
    throw new Error(`${record.id}: ledger identity is stale relative to the corpus manifest`);
  }
}

async function run(options) {
  await execFileAsync(process.execPath, [path.join(ROOT, "scripts", "build-model-notes.mjs"), "--check"], { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 });
  const [manifest, release, releaseBytes, releaseJsBytes, conceptPayload, catalog] = await Promise.all([
    readJson(path.join(ROOT, "research", "corpus", "manifest.v1.json")),
    readJson(CANDIDATE_JSON_PATH),
    readFile(CANDIDATE_JSON_PATH),
    readFile(CANDIDATE_JS_PATH),
    readJson(path.join(ROOT, "data", "notes", "concepts.json")),
    readJson(path.join(ROOT, "data", "atlas_articles.json"))
  ]);
  assertExtractionContract(manifest);
  assertReleaseManifestIdentity(manifest, release);
  const releaseById = new Map(release.papers.map((paper) => [paper.id, paper]));
  const catalogById = new Map((catalog.records || []).map((record) => [record.id, record]));
  if (catalogById.size !== manifest.records.length || manifest.records.some((record) => !catalogById.has(record.id))) {
    throw new Error("Catalog and corpus manifest paper identities differ");
  }
  const candidatePaperDigests = new Map(release.papers.map((paper) => [paper.id, sha256(stableStringify(paper))]));
  const modelNotesSha256 = sha256(releaseBytes);
  const modelNotesJsSha256 = sha256(releaseJsBytes);
  const conceptRegistrySha256 = conceptPayload.conceptRegistrySha256;
  const selectedRecords = selectRecords(manifest.records, options);
  const fullCorpusAudit = fullCorpusAuditRequested(options);
  let changedLedgers = 0;
  let staleLedgers = 0;
  const totals = emptyTotals();

  await mapLimit(selectedRecords, options.jobs, async (record) => {
    const ledgerPath = path.join(ROOT, "research", "ledger", "papers", `${record.id}.json`);
    const ledger = await readJson(ledgerPath);
    assertLedgerManifestIdentity(record, ledger, manifest);
    assertExtractionContract(manifest, [{ record, ledger }]);
    const qaCheckpoint = await verifyExtractionQaCheckpoint(ROOT, manifest, record, ledger, {
      requireComplete: options.check
    });
    if (!usableExtractionQaCheckpoint(qaCheckpoint, { allowNeedsReview: !options.check })) {
      const requirement = options.check ? "release-ready" : "a current terminal checkpoint";
      throw new Error(`${record.id}: Extraction QA is not ${requirement} (${qaCheckpoint.reason || qaCheckpoint.state})`);
    }
    const qaBinding = extractionQaCheckpointBinding(qaCheckpoint, { allowNeedsReview: !options.check });
    const note = releaseById.get(record.id);
    if (!note) throw new Error(`${record.id}: missing from release candidate`);
    if (!qaBindingsMatch(note.provenance, qaBinding)) throw new Error(`${record.id}: release candidate Extraction QA provenance is stale`);
    const parityIssues = miniParityReleaseIssues(note);
    if (parityIssues.length) {
      const sample = parityIssues.slice(0, 5).map((entry) => `${entry.code}@${entry.path}`).join(", ");
      throw new Error(`${record.id}: Mini-parity release audit failed (${parityIssues.length}): ${sample}`);
    }
    const noteSha256 = ledger.stages.noteAuthoring?.noteSha256;
    if (!/^[a-f0-9]{64}$/.test(noteSha256 || "")) throw new Error(`${record.id}: note checkpoint is incomplete`);
    const isMini = ledger.stages.noteAuthoring?.source === "mini-atlas-schema-v2";
    const pagesPayload = isMini
      ? await readMiniPagesForAudit(ROOT, ledger, qaBinding)
      : await readJson(path.join(ROOT, ledger.stages.extraction.artifacts.pages));
    if (qaBinding.extractionQaStatus === "needs_review") {
      if (isMini) throw new Error(`${record.id}: frozen Mini notes cannot use needs_review safe-map authoring`);
      const catalogRecord = catalogById.get(record.id);
      const envelope = await readJson(path.join(ROOT, "data", "notes", "papers", `${record.id}.json`));
      const pagesSha256 = ledger.stages.extraction.artifacts.pagesSha256;
      const boundSafeMap = await loadBoundSafeMap({
        root: ROOT,
        record: catalogRecord,
        pagesPayload,
        pagesSha256,
        qaBinding
      });
      const expectedInputDigest = safeMapInputDigest({
        baseInputDigest: authoringInputDigest(catalogRecord, pagesSha256, conceptRegistrySha256),
        bound: boundSafeMap,
        qaBinding
      });
      const safeMapIssues = validateBoundSafeMapEnvelope(envelope, {
        bound: boundSafeMap,
        qaBinding,
        record: catalogRecord,
        pagesPayload,
        pagesSha256,
        conceptDefinitions: conceptPayload.concepts,
        conceptRegistrySha256,
        expectedInputDigest
      });
      if (safeMapIssues.length) {
        const sample = safeMapIssues.slice(0, 5).map((entry) => `${entry.path}: ${entry.reason}`).join("; ");
        throw new Error(`${record.id}: prose-only safe-map audit failed (${safeMapIssues.length}): ${sample}`);
      }
      const expectedSafeMapBindings = safeMapEnvelopeBindings(boundSafeMap);
      if (ledger.stages.noteAuthoring?.source !== "reviewed-prose-only-safe-map"
        || Object.entries(expectedSafeMapBindings).some(([key, value]) => ledger.stages.noteAuthoring?.[key] !== value)) {
        throw new Error(`${record.id}: noteAuthoring checkpoint is not bound to the reviewed prose-only safe map`);
      }
      const candidateAuthoredSlice = Object.fromEntries(Object.keys(envelope.note).map((key) => [key, note[key]]));
      if (stableStringify(candidateAuthoredSlice) !== stableStringify(envelope.note)) {
        throw new Error(`${record.id}: release candidate differs from its deterministic safe-map note`);
      }
    }
    const authoringMode = isMini
      ? "mini-editorial"
      : ledger.stages.noteAuthoring?.authoringMode || note.provenance?.editorialStatus || "source-mapped";
    const semantic = validateModelNoteSemantics(note, { authoringMode, pages: pagesPayload, concepts: conceptPayload.concepts });
    if (semantic.errors.length) {
      const sample = semantic.errors.slice(0, 5).map((entry) => `${entry.code}@${entry.path}`).join(", ");
      throw new Error(`${record.id}: semantic audit failed (${semantic.errors.length}): ${sample}`);
    }
    const expected = auditStages({ ledger, note, noteSha256, modelNotesSha256, modelNotesJsSha256, conceptRegistrySha256, semantic, qaBinding, qaDecision: qaCheckpoint.decision });
    const miniStages = miniReadingStages(ledger, qaBinding);
    const expectedReleaseBuild = options.check
      ? expected.releaseBuild
      : pendingReleaseBuildStage(expected.releaseBuild, qaBinding);
    const stageNames = options.check ? [...PREREQUISITE_STAGES, "releaseBuild"] : PREREQUISITE_STAGES;
    const stale = stageNames.some((name) => stableStringify(ledger.stages[name]) !== stableStringify(expected[name]))
      || (miniStages && (stableStringify(ledger.stages.sectionIndex) !== stableStringify(miniStages.sectionIndex)
        || stableStringify(ledger.stages.sourceReading) !== stableStringify(miniStages.sourceReading)
        || stableStringify(ledger.stages.noteAuthoring) !== stableStringify(miniStages.noteAuthoring)))
      || (!options.check && stableStringify(ledger.stages.releaseBuild) !== stableStringify(expectedReleaseBuild));
    if (stale) {
      staleLedgers += 1;
      if (!options.check) {
        if (miniStages) Object.assign(ledger.stages, miniStages);
        for (const name of PREREQUISITE_STAGES) ledger.stages[name] = expected[name];
        ledger.stages.releaseBuild = expectedReleaseBuild;
        if (await atomicWriteJson(ledgerPath, ledger, { canonical: true })) changedLedgers += 1;
      }
    }
    addExpectedTotals(totals, expected, semantic, qaCheckpoint.decision);
  });

  const allLedgers = await mapLimit(manifest.records, options.jobs, (record) => readJson(path.join(ROOT, "research", "ledger", "papers", `${record.id}.json`)));
  for (let index = 0; index < manifest.records.length; index += 1) {
    assertLedgerManifestIdentity(manifest.records[index], allLedgers[index], manifest);
  }
  assertExtractionContract(manifest, manifest.records.map((record, index) => ({ record, ledger: allLedgers[index] })));
  const allQaCheckpoints = await mapLimit(manifest.records, options.jobs, (record, index) => (
    verifyExtractionQaCheckpoint(ROOT, manifest, record, allLedgers[index], { requireComplete: options.check })
  ));
  const failedQa = allQaCheckpoints
    .map((checkpoint, index) => ({ checkpoint, paperId: manifest.records[index].id }))
    .filter(({ checkpoint }) => !usableExtractionQaCheckpoint(checkpoint, { allowNeedsReview: !options.check }));
  if (failedQa.length) {
    const sample = failedQa.slice(0, 5).map(({ paperId, checkpoint }) => `${paperId}:${checkpoint.reason || checkpoint.state}`).join(", ");
    const requirement = options.check ? "release-ready" : "current terminal checkpoints";
    throw new Error(`Extraction QA blocks audit: ${failedQa.length} paper(s) lack ${requirement}${sample ? ` (${sample})` : ""}`);
  }
  const qaBindingsById = new Map(allQaCheckpoints.map((checkpoint, index) => [
    manifest.records[index].id,
    extractionQaCheckpointBinding(checkpoint, { allowNeedsReview: !options.check })
  ]));
  const unresolvedExtractionPaperIds = manifest.records
    .filter((record) => qaBindingsById.get(record.id)?.extractionQaStatus === "needs_review")
    .map((record) => record.id);
  const remainingPaperIds = allLedgers.filter((ledger) => !prerequisiteAuditCurrent(
    ledger,
    conceptRegistrySha256,
    candidatePaperDigests.get(ledger.paperId),
    qaBindingsById.get(ledger.paperId)
  )).map((ledger) => ledger.paperId);
  const prerequisitesReady = remainingPaperIds.length === 0;
  if (prerequisitesReady) {
    const checkpoints = await checkProjectCheckpoints({ root: ROOT, allowNeedsReview: !options.check });
    if (!checkpoints.ok || checkpoints.checkedPapers !== manifest.records.length) {
      const sample = checkpoints.stale.slice(0, 5).map((entry) => `${entry.paperId}/${entry.stage}`).join(", ");
      throw new Error(`Authoring checkpoints block public promotion: ${checkpoints.stale.length} stale stage(s), ${checkpoints.checkedPapers}/${manifest.records.length} papers checked${sample ? ` (${sample})` : ""}`);
    }
    await assertCurrentPdfFiles(ROOT, manifest.records, options.jobs);
  }
  const [publicJsonBytes, publicJsBytes] = await Promise.all([
    readFile(PUBLIC_JSON_PATH).catch((error) => error.code === "ENOENT" ? Buffer.alloc(0) : Promise.reject(error)),
    readFile(PUBLIC_JS_PATH).catch((error) => error.code === "ENOENT" ? Buffer.alloc(0) : Promise.reject(error))
  ]);
  const publicCurrent = publicJsonBytes.equals(releaseBytes) && publicJsBytes.equals(releaseJsBytes);

  if (options.check) {
    const report = auditReport({ manifest, release, modelNotesSha256, modelNotesJsSha256, conceptRegistrySha256, totals });
    const existingReport = await readFile(REPORT_PATH, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    const expectedReport = `${JSON.stringify(report, null, 2)}\n`;
    const reportStale = existingReport !== expectedReport;
    if (staleLedgers || !prerequisitesReady || !publicCurrent || reportStale) {
      throw new Error(`Audit state is stale: ${staleLedgers} selected ledger(s), ${remainingPaperIds.length} prerequisite ledger(s), public=${publicCurrent ? "current" : "stale"}, report=${reportStale ? "stale" : "current"}`);
    }
    return { ...report, selectedPapers: selectedRecords.length, changedLedgers: 0, staleLedgers, reportChanged: false, publicChanged: false, releaseReady: true, remainingPaperIds: [] };
  }

  if (!prerequisitesReady) {
    return {
      auditVersion: AUDIT_VERSION,
      totals,
      selectedPapers: selectedRecords.length,
      changedLedgers,
      staleLedgers,
      reportChanged: false,
      publicChanged: false,
      releaseReady: false,
      candidateReady: false,
      unresolvedExtractionPaperIds,
      remainingPaperIds
    };
  }

  if (options.candidateOnly) {
    const publicPromotionEligible = unresolvedExtractionPaperIds.length === 0;
    const report = {
      ...auditReport({ manifest, release, modelNotesSha256, modelNotesJsSha256, conceptRegistrySha256, totals }),
      status: publicPromotionEligible ? "candidate_ready" : "candidate_ready_with_extraction_review",
      candidateReady: true,
      publicPromotionEligible,
      extractionQa: {
        complete: manifest.records.length - unresolvedExtractionPaperIds.length,
        needsReview: unresolvedExtractionPaperIds.length,
        unresolvedPaperIds: unresolvedExtractionPaperIds
      },
      publicPromotionPerformed: false
    };
    const existingReport = await readFile(CANDIDATE_REPORT_PATH, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    const expectedReport = `${JSON.stringify(report, null, 2)}\n`;
    const reportStale = existingReport !== expectedReport;
    if (reportStale) await atomicWriteJson(CANDIDATE_REPORT_PATH, report);
    return {
      ...report,
      selectedPapers: selectedRecords.length,
      changedLedgers,
      staleLedgers,
      reportChanged: reportStale,
      publicChanged: false,
      candidateReady: true,
      releaseReady: publicPromotionEligible,
      unresolvedExtractionPaperIds,
      remainingPaperIds: []
    };
  }

  if (unresolvedExtractionPaperIds.length) {
    return {
      ...auditReport({ manifest, release, modelNotesSha256, modelNotesJsSha256, conceptRegistrySha256, totals }),
      status: "candidate_ready_with_extraction_review",
      selectedPapers: selectedRecords.length,
      changedLedgers,
      staleLedgers,
      reportChanged: false,
      publicChanged: false,
      candidateReady: true,
      releaseReady: false,
      publicPromotionEligible: false,
      unresolvedExtractionPaperIds,
      remainingPaperIds: []
    };
  }

  if (!fullCorpusAudit) {
    return {
      ...auditReport({ manifest, release, modelNotesSha256, modelNotesJsSha256, conceptRegistrySha256, totals }),
      status: "candidate_ready_bounded_audit",
      selectedPapers: selectedRecords.length,
      changedLedgers,
      staleLedgers,
      reportChanged: false,
      publicChanged: false,
      candidateReady: true,
      releaseReady: false,
      publicPromotionEligible: true,
      promotionBlockedReason: "Public promotion requires one explicit unbounded full-corpus audit run.",
      unresolvedExtractionPaperIds: [],
      remainingPaperIds: []
    };
  }

  // The browser consumes model_notes.js, so publish it last as the release commit marker.
  // A process interruption can therefore leave the old browser release in place, never a
  // new runtime bundle paired with an older JSON artifact; the next run converges the pair.
  const publicChanges = [
    await atomicWriteBytes(PUBLIC_JSON_PATH, releaseBytes),
    await atomicWriteBytes(PUBLIC_JS_PATH, releaseJsBytes)
  ];
  const [promotedJson, promotedJs] = await Promise.all([readFile(PUBLIC_JSON_PATH), readFile(PUBLIC_JS_PATH)]);
  if (!promotedJson.equals(releaseBytes) || !promotedJs.equals(releaseJsBytes)) throw new Error("Public release promotion did not converge to the audited candidate");

  await mapLimit(allLedgers, options.jobs, async (ledger) => {
    const ledgerPath = path.join(ROOT, "research", "ledger", "papers", `${ledger.paperId}.json`);
    const expected = releaseBuildStage(ledger, {
      modelNotesSha256,
      modelNotesJsSha256,
      conceptRegistrySha256,
      candidatePaperSha256: candidatePaperDigests.get(ledger.paperId),
      qaBinding: qaBindingsById.get(ledger.paperId)
    });
    if (stableStringify(ledger.stages.releaseBuild) !== stableStringify(expected)) {
      ledger.stages.releaseBuild = expected;
      if (await atomicWriteJson(ledgerPath, ledger, { canonical: true })) changedLedgers += 1;
    }
  });

  const finalTotals = totalsFromLedgers(allLedgers);
  const report = auditReport({ manifest, release, modelNotesSha256, modelNotesJsSha256, conceptRegistrySha256, totals: finalTotals });
  const existingReport = await readFile(REPORT_PATH, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  const expectedReport = `${JSON.stringify(report, null, 2)}\n`;
  const reportStale = existingReport !== expectedReport;
  if (reportStale) await atomicWriteJson(REPORT_PATH, report);
  return {
    ...report,
    selectedPapers: selectedRecords.length,
    changedLedgers,
    staleLedgers,
    reportChanged: reportStale,
    publicChanged: publicChanges.some(Boolean),
    releaseReady: true,
    remainingPaperIds: []
  };
}

function usage() {
  return "Usage: node scripts/audit-model-notes.mjs [--paper ID[,ID...]] [--from ID] [--limit N] [--jobs N] [--candidate-only | --check]";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseCli(process.argv.slice(2));
  if (options.help) console.log(usage());
  else run(options).then((result) => {
    console.log(`Audited ${result.selectedPapers} selected paper(s): ${result.totals.sources} source anchors, ${result.totals.bindings} bindings, ${result.totals.contentWarnings} content-maturity warning(s), ${result.totals.extractionWarnings} extraction warning(s).`);
    if (!options.check && result.candidateReady && options.candidateOnly) {
      const extractionState = result.unresolvedExtractionPaperIds?.length
        ? `${result.unresolvedExtractionPaperIds.length} Extraction QA review(s) retained; public promotion remains blocked`
        : "all Extraction QA checkpoints are release-ready";
      console.log(`Candidate audit complete; updated ${result.changedLedgers} ledger(s), public files retained, candidate report ${result.reportChanged ? "written" : "already current"}; ${extractionState}.`);
    } else if (!options.check && result.releaseReady) {
      console.log(`Release ready; updated ${result.changedLedgers} ledger(s), public files ${result.publicChanged ? "promoted" : "already current"}, report ${result.reportChanged ? "written" : "unchanged"}.`);
    } else if (!options.check) {
      console.log(`Candidate retained without public promotion; updated ${result.changedLedgers} ledger(s), ${result.remainingPaperIds.length} paper audit(s) remain.`);
    }
    if (auditCliShouldFail(options, result)) process.exitCode = 1;
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

export {
  AUDIT_VERSION,
  assertCurrentPdfFiles,
  auditCliShouldFail,
  auditStages,
  fullCorpusAuditRequested,
  miniParityReleaseIssues,
  miniReadingStages,
  noteMetrics,
  parseCli,
  prerequisiteAuditCurrent,
  releaseBuildStage,
  run,
  selectRecords
};
