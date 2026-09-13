import {
  directQuestion,
  hasExtractionNoise,
  hasOrphanMathScriptMarker,
  isBoilerplate,
  isCaption,
  isCitation,
  isTableRow,
  isWhitespaceNormalizedSubstring,
  meaningfulText,
  normalizeWhitespace,
  semanticFingerprint,
  stripInvisible
} from "./model-note-text-quality.mjs";
import {
  isRoleGroundedConcept,
  relevanceTokens,
  sourceSupportsRole,
  usableRelevanceSourceExcerpt
} from "./model-note-relevance.mjs";
import { isSubstantiveMethodStatement } from "./model-note-semantic-authoring.mjs";
import {
  formulaContaminatedProse,
  hasMathematicalExtractionNoise
} from "./model-note-formula-quality.mjs";

export const SEMANTIC_AUDIT_VERSION = "model-note-semantic-audit-v8";

const EDITORIAL_MODE = /(?:^|[-_\s])(?:curated|editorial|mini)(?:$|[-_\s])/i;
const FULL_TITLE_QUESTION = /^what\s+(?:model|modeling problem)\s+does\s+[“\"']?.+?[”\"']?\s+(?:develop|study|analy[sz]e|address)(?:\s*,?\s*and\s+what\s+does\s+it\s+imply)?\b/i;
const ORGANIZATION_PROSE = /^(?:this\s+(?:paper|article|study)\s+is\s+organized\s+as\s+follows|the\s+(?:rest|remainder)\s+of\s+(?:this|the)\s+(?:paper|article|study)|in\s+the\s+(?:next|following)\s+section|(?:(?:first|second|third|fourth|fifth|finally|then),?\s+)?(?:in\s+)?(?:sub)?section\s+\d+(?:\.\d+)*\b.{0,90}\b(?:introduces?|describes?|presents?|reviews?|discusses?|derives?|incorporates?|considers?|examines?|reports?|extends?|shows?)\b|(?:next|finally|then),?\s+we\s+(?:conduct|present|discuss|examine|report|turn\s+to)\b.*\b(?:next|following)\s+section\b|we\s+(?:conclude|proceed)\s+(?:in|with)|the\s+appendix\s+(?:contains|provides|reports))\b/i;
const METHOD_PLACEHOLDER = /^(?:n\/?a|none|not\s+(?:available|applicable|specified|reported)|unknown|tbd|to\s+be\s+determined|method|methods?|solution\s+or\s+estimation\s+method|analytical\s+solution|the\s+paper\s+develops\s+and\s+evaluates\s+the\s+model\s+described\s+in\s+(?:the\s+)?cited\s+source\s+sections?|completed\s+modeling-paper\s+scope\s+review.*|scope\s+review.*)$/i;
const SETUP_PLACEHOLDER = /^(?:n\/?a|none|not\s+(?:available|applicable|specified|reported)|unknown|tbd|to\s+be\s+determined|decision\s+makers?\s+and\s+system\s+entities\s+defined\s+in\s+the\s+model|exogenous\s+quantities\s+defined\s+in\s+the\s+model\s+formulation|feasible\s+decisions?\s+or\s+policies\s+defined\s+in\s+the\s+source\s+model|the\s+modeled\s+setting\s+follows\s+the\s+timing\s+and\s+feasibility\s+conditions\s+stated\s+in\s+the\s+cited\s+formulation\s+sections?)\.?$/i;
const COMPONENT_PLACEHOLDER = /^(?:(?:reviewed|source|model)\s+)?(?:component|element|section|theorem)(?:\s+\d+)?$/i;
const BINDING_STATUSES = new Set(["modeled", "unclassified", "explicitlyExcluded", "backgroundOnly", "unknown"]);
const RELATIONSHIP_TYPES = new Set(["extends", "alternativeTo", "approximates"]);
const TOKEN_STOPWORDS = new Set("a an and are as at be been being by can could did do does for from had has have how in into is it its may might model modeled modeling of on or paper section should study system that the their them these they this to under was were what when where which who why will with would".split(" "));
const HEADING_CONNECTORS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "under", "via", "versus", "with", "without"]);
const CANONICAL_SHORT_LABELS = new Set([
  "model", "models", "method", "methods", "methodology", "setup", "setting", "framework", "formulation",
  "algorithm", "algorithms", "analysis", "estimation", "identification", "equilibrium", "solution", "solutions",
  "extension", "extensions", "variant", "variants", "benchmark", "benchmarks", "experiment", "experiments",
  "data", "result", "results", "robustness", "notation", "assumption", "assumptions", "preliminaries",
  "pricing", "demand", "inventory", "capacity", "allocation", "objective", "objectives", "constraint", "constraints",
  "policy", "policies", "mechanism", "mechanisms", "utility", "utilities", "cost", "costs", "revenue", "risk",
  "uncertainty", "information", "learning", "regret", "process", "transition", "choice", "competition", "welfare",
  "auction", "auctions", "matching", "scheduling", "routing", "assortment", "contract", "contracts", "contracting",
  "baseline", "baselines", "consumer", "consumers", "customer", "customers", "firm", "firms", "individual", "individuals",
  "platform", "platforms", "provider", "providers", "developer", "developers", "registry", "registries", "buyer", "buyers",
  "seller", "sellers", "vendor", "vendors", "worker", "workers", "participant", "participants", "patient", "patients", "hospital", "hospitals",
  "retailer", "retailers", "manufacturer", "manufacturers", "supplier", "suppliers", "market", "markets", "marketplace",
  "monopoly", "monopolist", "monopolists", "environment", "environments", "example", "examples", "illustration", "illustrations",
  "application", "applications", "calibration", "validation",
  "overview", "contribution", "contributions", "appendix", "introduction", "conclusion", "conclusions", "discussion",
  "references", "bibliography", "acknowledgments", "acknowledgements"
]);
const HEADING_TOPIC = /\b(?:model|problem|formulation|framework|setting|setup|environment|objective|decision|constraint|state|action|policy|algorithm|mechanism|equilibrium|optimization|program|network|classifier|pool|structure|demand|price|pricing|inventory|capacity|allocation|utility|cost|revenue|reward|risk|uncertaint|information|stochastic|dynamic|game|player|agent|arrival|choice|learning|estimat|regret|benchmark|extension|variant|process|transition|distribution|welfare|competition|auction|matching|scheduling|routing|assortment|contract|theorem|proposition|lemma|corollary|result|experiment|method|solution)\w*\b/i;
const HEADING_SENTENCE_VERB = /\b(?:is|are|was|were|be|been|being|has|have|had|can|may|might|will|would|shall|should|could|must|assume|assumes|suppose|supposes|consider|considers|choose|chooses|set|sets|maximize|maximizes|minimize|minimizes|arrive|arrives|follow|follows|depend|depends|denote|denotes|define|defines|solve|solves|yield|yields|present|presents|serve|serves|sustain|sustains|label|labels|start|starts|converge|converges|show|shows|find|finds|learn|learns|demonstrate|demonstrates|extend|extends|capture|captures|normalize|normalizes|utilize|utilizes|reduce|reduces|provide|provides|make|makes|initialize|initialized)\b/i;
const BODY_CLAUSE_START = /^(?:for\s+brevity\b|as\s+(?:argued|discussed|explained|noted|shown)\b|it\s+(?:is|was|will|would|can|could|may|might|should|utilizes?)\b|by\s+[\p{L}]+ing\b|we\b|our\b|this\s+(?:paper|article|study|section|utility\s+model)\b|there\s+(?:is|are|was|were)\b|suppose\b|assume\b|let\b|because\b|although\b|while\b|based\s+on\b|note\s+that\b|see\s+the\b|(?:finally|then|next|thus|therefore),?\s+(?:we|our)\b|the\s+(?:results?|analysis)\s+of\s+this\s+section\b|(?:in|throughout)\s+(?:our|the|this)\b[^,]{0,90},\s+(?:we|any|the|there)\b|any\s+constraint\b[^.!?]{0,100}\b(?:makes?|causes?|forces?)\b|[A-Z][\p{L}'’.-]+(?:\s+(?:and|&)\s+[A-Z][\p{L}'’.-]+|\s+et\s+al\.)?\s*\(\d{4}[a-z]?\)\s+(?:model|models|show|shows|find|finds)\b|the\s+first\b.+\bwhich\b)/iu;
const DANGLING_LABEL = /(?:[,;]|\b(?:and|or|of|for|with|from|to|by|via|between|within|at|the|a|an|in|on|under|when|if|because|which|that|each))[.!:]?\s*$/i;
const INCOMPLETE_RELATIVE_LABEL = /\bsuch\s+that\s+(?:its|their|the|an?|each)\s+(?:(?:associated|corresponding|resulting|induced|unique|optimal)\s+)*(?:equilibrium|solution|outcome|allocation|price|strategy|policy|mechanism|function)s?\s*$/i;
const SETUP_FIELDS = ["objects", "inputs", "decisions", "assumptions"];
const SETUP_SEMANTIC_FIELD = Object.freeze({ objects: "entities", inputs: "inputs", decisions: "decisions", assumptions: "assumptions" });
const SETUP_SOURCE_TYPES = new Set(["record", "abstract", "section"]);
const SETUP_MATURITY = new Set(["source-authored", "source-derived", "mixed-source", "unresolved"]);
const METHOD_DISCOURSE_LEAD = /^(?:and|but|or|however|therefore|thus|hence|consequently|moreover|furthermore|additionally|also|then|next|finally|nonetheless)\b[\s,:;\-–—]*/i;
const METHOD_HEADING_LEAK = /^(?:analysis|methodology|methods?|solution(?:\s+approach)?)\s+in\s+(?:this|the)\s+(?:section|subsection)\b/i;
const RESEARCH_AUTHOR_OBJECT = /^(?:(?:a|an|the|each|every|one|two|multiple|several|online|content|academic|scientific)\s+)*(?:authors?|researchers?)$/i;
const MODELED_CONTENT_CREATOR_SOURCE = /\b(?:we|the\s+(?:paper|model|study))\s+(?:explicitly\s+)?(?:model|study|consider)s?\s+(?:(?:online|content|academic|scientific)\s+)?(?:authors?|researchers?)\s+(?:(?:who|that)\s+)?(?:creat|produc|post|publish|write|submit|choose|decid)\w*\b/i;

function issue(code, path, message) {
  return { code, path, message };
}

function values(value) {
  return Array.isArray(value) ? value : [];
}

function lexicalWords(value) {
  return meaningfulText(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
}

function malformedAutomatedMethod(value) {
  const text = meaningfulText(value);
  return METHOD_DISCOURSE_LEAD.test(text)
    || METHOD_HEADING_LEAK.test(text)
    || /^(?:these|those|the)\s+(?:estimates?|findings?|results?|values?)\s+(?:allow|enable|help)\s+(?:us|the\s+(?:paper|analysis))\s+to\b/i.test(text)
    || /\bavailable\s+(?:demand[-\s]+side|supply[-\s]+side|side|model)?\s*parameters,?\s+we\s+discuss\b/i.test(text)
    || /^using\s+the\s+[^.!?;]{1,120}\s+specification,?\s+the\s+paper\s+formulates\s+[^.!?;]{1,180}\s+and\s+analy[sz]es\s+the\s+resulting\b/i.test(text)
    || /^(?:using\s+the\s+)?(?:model|problem|formulation|analysis|method)\s+specification,?\s+the\s+paper\s+formulates\s+(?:a\s+|the\s+)?(?:model|problem|formulation|analysis|method)\b/i.test(text)
    || /\badmission\s+outcomes\s+decisions\b/i.test(text)
    || /^the\s+paper\s+\w+s\b[^.!?;]{0,220}\band\s+(?:derive|develop|evaluate|highlight|show|simulate|solve|use)\b/i.test(text);
}

function explicitlyModelsContentCreators(evidence) {
  const source = evidence?.source;
  if (source?.derivation !== "literal-modeled-content-creator") return false;
  return [source?.matchedText, source?.quote]
    .map(meaningfulText)
    .filter(Boolean)
    .some((text) => MODELED_CONTENT_CREATOR_SOURCE.test(text));
}

function malformedAutomatedSetup(field, value) {
  const text = meaningfulText(value);
  const nonCurrency = String(value ?? "")
    .replace(/https?:\/\/\S+/giu, " URL ")
    .replace(/\\\$/gu, " ESCAPED_DOLLAR ")
    .replace(/(?<!\\)\$(?:\s*\d+(?:[.,]\d+)*(?:\s*(?:thousand|million|billion|trillion|k|m|bn))?|\/[A-Za-z]+|[A-Z]{1,4}\b)/gu, " CURRENCY ");
  if (/(?<!\\)\$/u.test(nonCurrency) || /\\(?:\(|\)|\[|\])/u.test(nonCurrency)) return "raw math wrapper";
  if (/^\d{4}$/u.test(text)) return "isolated journal page number";
  if (/^(?:problem\s+(?:definition|formulation)|academic\s*\/\s*practical\s+relevance|methodology(?:\s*\/\s*results?)?|results?|managerial\s+implications)\b\s*:?\s*(?:we|the|our|this)\b/i.test(text)) {
    return "leaked abstract or section heading";
  }
  if (/\b(?:that|which)(?:maximiz|minimiz|optim|increas|decreas|improv)\p{Ll}{6,}(?:\(|$)/iu.test(text)) {
    return "fused relative-clause extraction";
  }
  if (/\b(?:a|an|the|and|or|of|to|from|with|without|for|in|on|under|by|that|which)\s*$/i.test(text)) {
    return "dangling setup phrase";
  }
  if (/[<>≤≥=]\s*[+−-]?\d+(?:\.\d+)?\s+[+−-]?\d+(?:\.\d+)?\b/u.test(text)) return "probable flattened fraction or adjacent display cells";
  if (field === "objects" && (/^(?:a|an|the)\s+(?:data|demand|information|model|policy|price|quality|state|system)$/i.test(text)
      || /^(?:products?)$/.test(text)
      || /\b(?:also|only|then)\s*$/i.test(text))) return "incomplete entity phrase";
  if (field === "inputs" && (/^feature\s+[A-Za-z0-9_{}^*-]+,?\s+then\b/i.test(text)
      || /^(?:(?:a|an|the)\s+)?(?:capacity|costs?|data|information|observation|parameters?|probabilities?|state)$/i.test(text))) return "incomplete input phrase";
  if (field === "decisions" && (/^(?:accept|reject)\s+(?:the\s+)?(?:assumption|hypothesis)\b/i.test(text)
      || /^require\s+noninferiority\s+trials?\b/i.test(text)
      || /^post\s+(?:heterogeneous|valuation)(?:\s+for\b.*)?$/i.test(text)
      || /^(?:can|could|may|might|will|would)\b|^when\s+(?!to\b)/i.test(text)
      || /^(?:lead|result)\s+(?:to|in)\b|^(?:perform\s+(?:equally\s+well|suboptimally|well\b)|test\s+results?\b)/i.test(text)
      || /^(?:perform|conduct)\s+(?:a\s+)?(?:empirical|numerical(?:\s+optimization)?|sensitivity|simulations?|statistical)\b/i.test(text)
      || /^to\s+(?:compare|evaluate|test)\s+(?:the\s+)?performance\b/i.test(text)
      || /^policy\s+used\s+by\b/i.test(text)
      || /^releas(?:e|ing)\s+products?\s+at\s+the\s+wrong\s+time$/i.test(text)
      || /^release\s+of\b.{0,100}\b(?:causes?|delays?|increases?|reduces?|results?|yields?)\b/i.test(text)
      || /^the\s+pricing$/i.test(text)
      || /^improving\s+(?:its|their|the)\s+process\s+quality$/i.test(text)
      || /^share\b.{0,90}\b(?:decreas|increas)\w*\b/i.test(text)
      || /^(?:(?:“|\")?freemium(?:”|\")?\s+)?contracts?\s+(?:often|oftentimes|typically|usually|frequently)\s+(?:are|have|include)\b/i.test(text)
      || /^(?:(?:a|an|the|this|that|their|its)\s+)?(?:action|choice|decision|policy|prioritization\s+strategy|sharing|rentals?)\b.{0,100}\b(?:causes?|decreases?|has|have|improves?|increases?|leads?|outperforms?|results?|yields?)\b/i.test(text)
      || /^(?:(?:a|an|the|agile)\s+)?(?:fleet\s+management\s+services?|heuristics?|principles?|services?|strategies?)\b.{0,100}\bto\s+(?:(?:continuously|further|significantly)\s+)?(?:help|improve)\b/i.test(text))) return "analysis outcome or clipped phrase, not a modeled decision";
  if (field === "assumptions" && /^(?:the|our|both|these)\s+results?\b|^in\s+this\s+paper,?\s+we\s+(?:propose|develop|study|analy[sz]e)\b|^we\s+now\s+review\s+the\s+literature\b/i.test(text)) {
    return "result, contribution, or literature prose, not a model assumption";
  }
  return "";
}

function normalizedKey(value) {
  return meaningfulText(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function balancedDelimiters(value) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const character of value) {
    if (character === "(" || character === "[" || character === "{") stack.push(character);
    else if (pairs[character] && stack.pop() !== pairs[character]) return false;
  }
  return stack.length === 0;
}

function hasInternalSentence(value) {
  const scrubbed = value
    .replace(/\b(?:i\.e|e\.g|u\.s|u\.k|vs)\./gi, "")
    .replace(/\b\d+\.\d+\b/g, "");
  return /[.!?]\s+\S/.test(scrubbed);
}

function headingBody(value) {
  const normalized = normalizeWhitespace(value);
  const parenthesized = normalized.match(/^\((\d+(?:\.\d+)*)\)\s+(.+)$/);
  const numbered = normalized.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/);
  return parenthesized?.[2] || numbered?.[2] || normalized;
}

function titleCaseHeading(value) {
  const words = value.replace(/\b(?:i\.e|e\.g)\.,?/gi, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
  if (!words.length) return false;
  let significant = 0;
  for (const [index, word] of words.entries()) {
    const lower = word.toLocaleLowerCase();
    if (index > 0 && HEADING_CONNECTORS.has(lower)) continue;
    significant += 1;
    if (!/^(?:\p{Lu}|\d|\p{Ll}{1,2}\p{Lu})/u.test(word)) return false;
  }
  return significant > 0;
}

function looksLikeAuthorByline(value) {
  if (HEADING_TOPIC.test(value)) return false;
  const people = value.split(/\s*,\s*|\s+and\s+/i).filter(Boolean);
  if (people.length < 2) return false;
  return people.every((person) => {
    const words = person.trim().split(/\s+/).filter(Boolean);
    return words.length >= 2 && words.length <= 4
      && words.every((word) => /^(?:[\p{Lu}][\p{L}'’\-]+|[\p{Lu}]\.)$/u.test(word));
  });
}

/** Return a conservative rejection reason, or an empty string for a concise semantic heading. */
export function headingLabelRejectionReason(value) {
  const normalized = meaningfulText(value);
  if (!normalized) return "empty label";
  if (/[«»]/u.test(normalized)) return "a corrupted mathematical glyph";
  if (hasExtractionNoise(value)) return "extraction noise";
  const body = headingBody(normalized);
  const words = lexicalWords(body);
  if (!balancedDelimiters(body) || /^[([{]/.test(body)) return "an unbalanced or dangling parenthetical fragment";
  // Printed section titles sometimes end in one compact regime qualifier,
  // such as “Integrating Global and Local Auctions, M > 2”. Admit only that
  // title-like suffix shape; standalone inequalities and formula headings
  // remain prohibited below.
  const simpleTrailingRegime = /^.+[\p{L}],\s*[A-Z][A-Za-z0-9]*\s*(?:[<>≤≥]|=)\s*[+-]?\d+(?:\.\d+)?$/u.test(body);
  if (/\((?:i\.?e\.?|e\.?g\.?),?\s*[^)]*(?:[∆ΔΛλμθγπρ]|[<>=≤≥]|\\[A-Za-z]+)[^)]*\)\s*$/i.test(body)
    || (!simpleTrailingRegime && /(?:[<>=≤≥∑∏]|\b(?:arg\s*max|arg\s*min)\b)/i.test(body))) return "an equation fragment rather than a heading";
  if (hasInternalSentence(body)) return "internal multi-sentence text";
  if (looksLikeAuthorByline(body)) return "an author byline";
  if (words.length > 14 || body.length > 140) return "too long to be a concise heading";
  if (DANGLING_LABEL.test(body) || INCOMPLETE_RELATIVE_LABEL.test(body)) return "a dangling clause or phrase";
  if (BODY_CLAUSE_START.test(body)) return "body prose or a dependent clause";
  const lower = body.toLocaleLowerCase().replace(/[.:]+$/g, "");
  const sourceStyleAcronym = /^(?:[A-Z]{2,}[\p{L}\p{N}'’\-]*|[\p{Lu}][\p{L}\p{N}'’]*-[A-Z][\p{L}\p{N}'’\-]*)$/u.test(body);
  const capitalizedSourceNoun = /^\p{Lu}[\p{L}\p{N}'’\-]+$/u.test(body);
  if (words.length === 1 && !CANONICAL_SHORT_LABELS.has(lower) && !sourceStyleAcronym && !capitalizedSourceNoun) return "a single noncanonical noun";
  if (HEADING_SENTENCE_VERB.test(body) && !titleCaseHeading(body)) return "a body sentence rather than a heading";
  if (words.length > 1 && !HEADING_TOPIC.test(body) && !titleCaseHeading(body)) return "not a recognizable semantic heading";
  return "";
}

// Printed source sections legitimately use short headings such as “Firms”,
// “LM”, or “Erlang-S”, as well as concise sentence-case headings. These source
// identifiers have already passed the section extractor's citation, caption,
// equation-step, byline, and prose-fragment gates, so they can be slightly more
// permissive than Atlas-authored component labels.
export function sourceHeadingRejectionReason(value) {
  const reason = headingLabelRejectionReason(value);
  if (!reason) return "";
  // Source-native typography may justify a concise noncanonical noun or a
  // sentence-case topic. It can never excuse corrupt extraction, unmatched
  // delimiters, a dangling clause, citation text, or another hard failure.
  if (reason !== "a single noncanonical noun" && reason !== "not a recognizable semantic heading") return reason;
  const body = headingBody(meaningfulText(value));
  const words = lexicalWords(body);
  const sourceNativeShort = words.length === 1
    && /^(?:\p{Lu}[\p{L}\p{N}'’\-]*|[A-Z]{2,}[\p{L}\p{N}'’\-]*)$/u.test(body);
  const sourceNativeSentenceCase = reason === "not a recognizable semantic heading"
    && words.length >= 2
    && words.length <= 12
    && /^\p{Lu}/u.test(body)
    && !HEADING_SENTENCE_VERB.test(body)
    && !BODY_CLAUSE_START.test(body)
    && !DANGLING_LABEL.test(body);
  const numberedSourceHeading = headingBody(meaningfulText(value)) !== meaningfulText(value)
    && words.length <= 12
    && !HEADING_SENTENCE_VERB.test(body)
    && !BODY_CLAUSE_START.test(body)
    && !DANGLING_LABEL.test(body);
  return sourceNativeShort || sourceNativeSentenceCase || numberedSourceHeading ? "" : reason;
}

function setupArraysAreByteIdentical(models) {
  if (models.length < 2 || !models.every((model) => SETUP_FIELDS.every((field) => Array.isArray(model?.[field])))) return false;
  const signatures = models.map((model) => JSON.stringify(SETUP_FIELDS.map((field) => model[field])));
  return signatures.every((signature) => signature === signatures[0]);
}

function semanticTokens(value) {
  return meaningfulText(value)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token))
    .map((token) => token.length > 6
      ? token.replace(/(?:ies|ing|ed|es|s)$/, (suffix) => suffix === "ies" ? "y" : "")
      : token.length > 4 ? token.replace(/s$/, "") : token) || [];
}

function hasPositiveOverlap(left, right) {
  const wanted = new Set(semanticTokens(left));
  return semanticTokens(right).some((token) => wanted.has(token));
}

function editorialMode(mode, note) {
  const valuesToCheck = [
    mode,
    note?.authoringMode,
    note?.provenance?.editorialStatus,
    note?.provenance?.sourceTier
  ].map((value) => meaningfulText(value)).filter(Boolean);
  return valuesToCheck.some((value) => EDITORIAL_MODE.test(value));
}

function canonicalQuestion(value) {
  const standard = directQuestion(value);
  if (standard) return standard;
  const text = meaningfulText(value);
  if (!/^(?:under\s+(?:what|which)\s+conditions?|to\s+what\s+extent)\b/i.test(text)) return "";
  const body = text.replace(/[\s.!?]+$/g, "").trim();
  return lexicalWords(body).length >= 4 ? `${body}?` : "";
}

function titleCandidates(note) {
  return [
    note?.title,
    note?.citation?.title,
    note?.canonicalCitation?.title,
    note?.provenance?.title
  ].map(normalizedKey).filter(Boolean);
}

function looksLikeFullTitleQuestion(question, note) {
  if (FULL_TITLE_QUESTION.test(question)) return true;
  const questionKey = normalizedKey(question).replace(/^(?:how|what|when|where|why|which|who)\s+/, "");
  return titleCandidates(note).some((title) => questionKey === title || normalizedKey(question) === title);
}

function prohibitedProseReason(value) {
  if (isBoilerplate(value)) return "publisher boilerplate";
  if (isCaption(value)) return "a figure/table caption";
  if (isCitation(value)) return "citation prose";
  if (isTableRow(value)) return "a table row";
  if (ORGANIZATION_PROSE.test(meaningfulText(value))) return "paper-organization prose";
  return "";
}

function resultOrContributionCondition(value) {
  const text = meaningfulText(value);
  if (/^(?:our\s+(?:goal|objective)|the\s+(?:paper's|model's|planner's|firm's)?\s*objective|we\s+(?:seek|aim|want)\s+to)\b/i.test(text)
    || /^(?:the\s+)?(?:paper|model|planner|firm)\s+(?:maximi[sz]es|minimi[sz]es)\b/i.test(text)) return true;
  if (/\b(?:immunology|economics|operations|marketing|management|medical|engineering)?\s*literature\b[^.!?]{0,140}\b(?:suggests?|shows?|finds?|indicates?|reports?)\b/i.test(text)
    || /\b(?:well[- ]known|documented|established)\b.{0,100}\bin\s+(?:the\s+)?(?:(?:[a-z-]+\s+){0,3})literature\b/i.test(text)
    || /^(?:according\s+to|following)\s+[A-Z][\p{L}'’.-]+(?:\s+et\s+al\.)?\s*\(\d{4}[a-z]?\)/u.test(text)) return true;
  const namedResult = /^(?:the\s+)?(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)?\b/i.test(text)
    || /^(?:we|the\s+(?:paper|analysis|authors?))\s+(?:show|find|demonstrate|prove|establish|confirm)\b/i.test(text)
    || /^(?:it|this)\s+(?:follows|shows|implies)\s+that\b/i.test(text)
    || /\b(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)\b.{0,100}\b(?:shows?|implies?|highlights?|establishes?|presents?|shifts?|follows?)\b/i.test(text)
    || /\b(?:shown|presented|stated|described|established)\s+in\s+(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)\b/i.test(text)
    || /\b(?:present|derive|report)\s+(?:it|them)?\s*in\s+(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)\b/i.test(text)
    || /\b(?:all|none)\s+of\s+(?:our|the)\s+(?:results?|insights?)\b/i.test(text)
    || /\b(?:can\s+be|is)\s+readily\s+extended\b/i.test(text)
    || /\b(?:as\s+(?:shown|proved|established)|follows\s+directly)\s+(?:in|from)\s+(?:theorem|proposition|lemma|corollary)\b/i.test(text);
  if (namedResult) return true;
  if (/^in\s+the\s+(?:outcomes?|results?)\b/i.test(text)
    || /^(?:in|from|as\s+shown\s+in)\s+(?:figure|table|exhibit|panel)\s*[A-Z]?\d+\b/i.test(text)
    || /^(?:in|from)\s+(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)?\b[^.!?]{0,100}\b(?:we\s+)?(?:find|show|observe|see|note|obtain)\b/i.test(text)
    || /^(?:according\s+to|recall(?:ing)?\s+from)\s+(?:theorem|proposition|lemma|corollary|section|equation|expression|figure|table)\b/i.test(text)
    || /^(?:we\s+(?:(?:also|further)\s+)?(?:observe|note|see)|comparing\b[^.!?]{0,120}\bwe\s+(?:find|observe|see))\b/i.test(text)
    || /\b(?:first|second|third|previous|preceding|above)\s+(?:result|statement|expression)\s+(?:shows?|implies?|establishes?|yields?)\b/i.test(text)) return true;
  if (/^(?:the\s+)?(?:upward|downward|increasing|decreasing)\s+trend\b[^.!?]{0,180}\b(?:figures?|tables?|results?|estimates?)\b/i.test(text)
    || /^(?:interestingly|notably),?\s+[^.!?]{0,180}\b(?:is|are)\s+(?:preferred|optimal|better|worse|higher|lower)\b/i.test(text)
    || /\b(?:performance|outcomes?|profits?|revenues?|welfare|results?)\b[^.!?]{0,100}\bremains?\s+unchanged\b/i.test(text)) return true;
  if (/\bour\s+(?:main\s+|qualitative\s+)?results?\b[^.!?]{0,140}\b(?:apply|extend|generalize|hold|show|suggest|indicate|confirm)\b/i.test(text)
    || /^(?:the\s+same|these|such)\s+(?:qualitative\s+)?results?\s+(?:apply|extend|generalize|hold)\b/i.test(text)
    || /^(?:our|this|the\s+paper(?:'s)?)\s+(?:analysis|contribution|framework|approach)\b[^.!?]{0,140}\b(?:contributes?|extends?|generalizes?|applies?)\b/i.test(text)) return true;
  if (/^(?:hence|therefore|thus|consequently|as\s+a\s+result)\b/i.test(text)
    || /^(?:it\s+is\s+(?:clear|immediate)|this\s+is\s+because)\b/i.test(text)) return true;

  // Comparative statics are conclusions unless the sentence explicitly starts
  // from a premise. This keeps genuine applicability conditions such as
  // “When demand rises, the optimal order quantity increases.”
  const explicitPremise = /^(?:if|when|whenever|provided\s+that|subject\s+to|under\b|given\b|suppose\b|assume\b|we\s+assume\b)/i.test(text);
  return !explicitPremise
    && /\b(?:equilibrium|optimal)\b[^.!?]{0,140}\b(?:increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|is\s+(?:higher|lower|better|worse)|are\s+(?:higher|lower|better|worse)|improv(?:e|es|ed|ing)|worsen(?:s|ed|ing)?)\b/i.test(text);
}

function pageEntries(pages) {
  const raw = Array.isArray(pages) ? pages : Array.isArray(pages?.pages) ? pages.pages : null;
  if (raw) {
    return raw.map((entry, index) => {
      if (typeof entry === "string") return [index + 1, entry];
      return [Number.isInteger(entry?.page) ? entry.page : Number.isInteger(entry?.pageNumber) ? entry.pageNumber : index + 1, String(entry?.text ?? "")];
    });
  }
  if (pages && typeof pages === "object") {
    return Object.entries(pages).filter(([key, value]) => /^\d+$/.test(key) && (typeof value === "string" || typeof value?.text === "string"))
      .map(([key, value]) => [Number(key), typeof value === "string" ? value : value.text]);
  }
  return [];
}

function sourceAnchor(source) {
  return [
    Number.isInteger(source?.page) ? source.page : "?",
    normalizeWhitespace(source?.section).toLocaleLowerCase(),
    normalizeWhitespace(source?.equation).toLocaleLowerCase(),
    normalizeWhitespace(source?.quote)
  ].join("\u0000");
}

function componentLocalText(component) {
  return [
    component?.label,
    component?.role,
    component?.explanation,
    component?.formal,
    ...values(component?.searchPhrases),
    ...values(component?.conditions),
    ...values(component?.symbols).flatMap((symbol) => [symbol?.symbol, symbol?.meaning])
  ].filter(Boolean).join(" ");
}

function modelLocalText(model) {
  return [
    model?.name,
    model?.summary,
    model?.method,
    ...values(model?.objects),
    ...values(model?.inputs),
    ...values(model?.decisions),
    ...values(model?.assumptions)
  ].filter(Boolean).join(" ");
}

function normalizedLiteralIncludes(haystack, needle) {
  // Setup values are clean semantic prose, while a literal PDF quote may
  // preserve compatibility glyphs such as the `ﬁ` ligature.  NFKC makes
  // containment compare their textual meaning without weakening the separate
  // quote-versus-page check, which remains a strict whitespace-normalized
  // substring test below.
  const source = normalizeWhitespace(stripInvisible(haystack).normalize("NFKC")).toLocaleLowerCase();
  const wanted = normalizeWhitespace(stripInvisible(needle).normalize("NFKC")).toLocaleLowerCase();
  return Boolean(source && wanted && source.includes(wanted));
}

function rawSetupLiteralIncludes(candidate, rawPage) {
  const quote = normalizeWhitespace(candidate);
  return Boolean(quote) && normalizeWhitespace(rawPage).includes(quote);
}

function orderedPhraseMatch(haystack, needle) {
  if (!needle.length || haystack.length < needle.length) return false;
  for (let start = 0; start < haystack.length; start += 1) {
    if (haystack[start] !== needle[0]) continue;
    let cursor = start;
    let matched = 1;
    for (let wanted = 1; wanted < needle.length; wanted += 1) {
      let found = -1;
      for (let offset = cursor + 1; offset <= Math.min(haystack.length - 1, cursor + 3); offset += 1) {
        if (haystack[offset] === needle[wanted]) {
          found = offset;
          break;
        }
      }
      if (found < 0) break;
      cursor = found;
      matched += 1;
    }
    if (matched === needle.length) return true;
  }
  return false;
}

function conceptMapFrom(options) {
  const source = options?.concepts instanceof Map
    ? [...options.concepts.values()]
    : Array.isArray(options?.concepts)
      ? options.concepts
      : Array.isArray(options?.concepts?.concepts)
        ? options.concepts.concepts
        : [];
  return new Map(source.filter((concept) => meaningfulText(concept?.id)).map((concept) => [meaningfulText(concept.id), concept]));
}

function conceptHasSourceSupport(concept, sources) {
  if (!concept) return false;
  const phrases = [concept?.label, ...(values(concept?.aliases)), String(concept?.id || "").replaceAll("-", " ")];
  return values(sources).some((source) => {
    const sourceTokens = relevanceTokens([source?.section, source?.quote, source?.equation].filter(Boolean).join(" "));
    return phrases.some((phrase) => orderedPhraseMatch(sourceTokens, relevanceTokens(phrase)));
  });
}

function referencedSources(component, model, refs) {
  const result = [];
  for (const ref of values(refs)) {
    if (!Number.isInteger(ref?.index) || ref.index < 0) continue;
    if (ref.scope === "component" && ref.index < values(component?.sources).length) result.push(component.sources[ref.index]);
    if (ref.scope === "model" && ref.index < values(model?.sources).length) result.push(model.sources[ref.index]);
  }
  return result;
}

function modelCoreSignature(model) {
  const setup = SETUP_FIELDS.map((field) => values(model?.[field]).map(normalizedKey).filter(Boolean).sort());
  const components = values(model?.components).map(semanticFingerprint).filter(Boolean).sort();
  if (!components.length) return "";
  return JSON.stringify({ setup, method: normalizedKey(model?.method), components });
}

function componentSubstanceFingerprint(component) {
  const normalizedList = (items) => values(items).map(normalizedKey).filter(Boolean).sort();
  const symbols = values(component?.symbols).map((symbol) => ({
    symbol: normalizedKey(symbol?.symbol),
    meaning: normalizedKey(symbol?.meaning)
  })).sort((left, right) => `${left.symbol}|${left.meaning}`.localeCompare(`${right.symbol}|${right.meaning}`));
  const bindings = values(component?.conceptBindings).map((binding) => ({
    conceptId: normalizedKey(binding?.conceptId),
    status: normalizedKey(binding?.status),
    representation: normalizedKey(binding?.representation)
  })).sort((left, right) => `${left.conceptId}|${left.status}|${left.representation}`
    .localeCompare(`${right.conceptId}|${right.status}|${right.representation}`));
  const signature = {
    role: normalizedKey(component?.role),
    explanation: normalizedKey(component?.explanation),
    formalKind: normalizedKey(component?.formalKind),
    formal: normalizedKey(component?.formal),
    concepts: normalizedList(component?.concepts),
    symbols,
    bindings
  };
  if (!signature.role && !signature.explanation && !signature.formal && !signature.bindings.length) return "";
  return JSON.stringify(signature);
}

function referencedSourceCount(component, model, refs) {
  return values(refs).filter((ref) => {
    if (!Number.isInteger(ref?.index) || ref.index < 0) return false;
    if (ref.scope === "component") return ref.index < values(component?.sources).length;
    if (ref.scope === "model") return ref.index < values(model?.sources).length;
    return false;
  }).length;
}

/**
 * Validate source-authored model-note meaning and grounding.
 *
 * Issues are deterministic objects shaped as { code, path, message }. Automated
 * notes receive strict authorship/grounding checks. Explicit curated/editorial
 * modes retain Mini compatibility, while extraction corruption remains fatal.
 */
export function validateModelNoteSemantics(input, options = {}) {
  const envelope = input && typeof input === "object" ? input : {};
  const note = envelope.note && !Array.isArray(envelope.models) ? envelope.note : envelope;
  const requestedMode = options.authoringMode ?? envelope.authoringMode ?? note?.authoringMode ?? "automated";
  const isEditorial = editorialMode(requestedMode, note);
  const isAutomated = !isEditorial;
  const errors = [];
  const warnings = [];
  const suppliedPages = options.pages !== undefined && options.pages !== null;
  const pagesByNumber = new Map(pageEntries(options.pages));
  const conceptsById = conceptMapFrom(options);
  const noteTitleKeys = new Set(titleCandidates(note));
  const anchorUses = new Map();
  const conditionUses = new Map();
  const sourcedPages = new Set();
  let componentCount = 0;
  let bindingCount = 0;
  let modeledBindingCount = 0;
  let unknownBindingCount = 0;
  let sourceCount = 0;
  let quoteChecks = 0;
  let quoteMatches = 0;
  let localOverlapChecks = 0;
  let localOverlapMatches = 0;
  let duplicateComponents = 0;
  let duplicateVariantModels = 0;
  let setupEvidenceChecks = 0;
  let setupEvidenceMatches = 0;
  let unsupportedModeledBindings = 0;

  const addError = (code, path, message) => errors.push(issue(code, path, message));
  const addWarning = (code, path, message) => warnings.push(issue(code, path, message));

  const inspectText = (value, path, { strictProse = false, literalProvenance = false } = {}) => {
    if (typeof value !== "string") return;
    if (hasExtractionNoise(value)) {
      if (isAutomated) addError("text.extraction-noise", path, "Text contains invisible, fused, split-word, glyph, or control-character extraction noise.");
      else addWarning("text.extraction-noise-editorial", path, "The frozen editorial source map retains extraction glyphs or line-break artifacts for source fidelity.");
      return;
    }
    if (isAutomated && strictProse) {
      if (!literalProvenance && hasOrphanMathScriptMarker(value)) {
        addError("text.extraction-noise", path, "Authored prose contains an orphan PDF subscript or superscript marker.");
        return;
      }
      const reason = prohibitedProseReason(value);
      if (reason) addError("text.prohibited-prose", path, `Automated authored text is ${reason}, not clean semantic prose.`);
    }
  };

  const inspectMathematicalText = (value, path) => {
    if (typeof value !== "string" || !hasMathematicalExtractionNoise(value)) return;
    if (isAutomated) addError("text.extraction-noise", path, "Mathematical text contains a control character, broken glyph token, or encoding artifact.");
    else addWarning("text.extraction-noise-editorial", path, "The frozen editorial mathematical text retains an extraction artifact for source fidelity.");
  };

  const inspectSource = (source, path, localText) => {
    sourceCount += 1;
    inspectText(source?.section, `${path}.section`, { strictProse: true });
    inspectText(source?.equation, `${path}.equation`);
    inspectText(source?.quote, `${path}.quote`, { strictProse: true, literalProvenance: true });

    const anchor = sourceAnchor(source);
    const uses = anchorUses.get(anchor) || [];
    uses.push(path);
    anchorUses.set(anchor, uses);
    if (Number.isInteger(source?.page) && source.page > 0) sourcedPages.add(source.page);

    if (!isAutomated) return;
    const quote = meaningfulText(source?.quote);
    const section = meaningfulText(source?.section);
    if (section && !hasExtractionNoise(source?.section)) {
      if (noteTitleKeys.has(normalizedKey(section))) {
        addError("source.section.paper-title", `${path}.section`, "A paper title cannot serve as a source-section heading.");
      }
      const headingReason = sourceHeadingRejectionReason(section);
      if (headingReason) {
        addError("source.section.not-heading", `${path}.section`, `Source section is ${headingReason}; use a concise section heading.`);
      }
    }
    if (!Number.isInteger(source?.page) || source.page < 1) {
      addError("source.page.invalid", `${path}.page`, "A positive one-based source page is required.");
    }
    if (!section) {
      addError("source.section.missing", `${path}.section`, "A meaningful source section is required.");
    }
    if (!quote || lexicalWords(quote).length < 4) {
      addError("source.quote.thin", `${path}.quote`, "A source quote must contain at least four meaningful words.");
    }

    if (suppliedPages && Number.isInteger(source?.page) && source.page > 0) {
      quoteChecks += 1;
      const rawPage = pagesByNumber.get(source.page);
      if (rawPage === undefined) {
        addError("source.page.missing", `${path}.page`, `Cited page ${source.page} is absent from the supplied extraction.`);
      } else if (quote && !isWhitespaceNormalizedSubstring(source.quote, rawPage)) {
        addError("source.quote.not-literal", `${path}.quote`, "The quote is not a whitespace-normalized literal substring of the cited page.");
      } else if (quote) {
        quoteMatches += 1;
      }
      if (quote && rawPage !== undefined && formulaContaminatedProse(source.quote, rawPage, { conservative: true })) {
        addError("source.quote.formula-contaminated", `${path}.quote`, "A prose source quote must not absorb a standalone display equation from an adjacent physical line.");
      }
    }

    if (quote) {
      localOverlapChecks += 1;
      if (hasPositiveOverlap(quote, localText)) localOverlapMatches += 1;
      else addError("source.quote.no-local-overlap", `${path}.quote`, "The quote has no positive semantic-token overlap with its local model or component.");
    }
  };

  inspectText(note?.question, "question", { strictProse: true });
  inspectText(note?.overview, "overview", { strictProse: true });
  for (const [index, value] of values(note?.modelTypes).entries()) inspectText(value, `modelTypes[${index}]`);
  inspectText(note?.coverage?.note, "coverage.note", { strictProse: true });

  if (isAutomated) {
    const question = meaningfulText(note?.question);
    const normalized = canonicalQuestion(question);
    if (!normalized) {
      addError("question.not-direct", "question", "Automated notes require a genuine directly phrased research question.");
    } else {
      const withoutPrefix = question.replace(/^(?:research\s+)?question\s*:\s*/i, "");
      if (withoutPrefix !== normalized || !/[^?]\?$/.test(withoutPrefix) || /\?{2,}$/.test(withoutPrefix)) {
        addError("question.punctuation", "question", "The research question must end in exactly one question mark and contain no trailing statement punctuation.");
      }
    }
    if (looksLikeFullTitleQuestion(question, note)) {
      addError("question.title-boilerplate", "question", "The research question wraps or repeats a paper title instead of stating the research problem directly.");
    }
  }

  const models = values(note?.models);
  const modelIds = new Set();
  for (const [modelIndex, model] of models.entries()) {
    const modelPath = `models[${modelIndex}]`;
    const modelId = meaningfulText(model?.id);
    inspectText(model?.name, `${modelPath}.name`, { strictProse: true });
    inspectText(model?.summary, `${modelPath}.summary`, { strictProse: true });
    inspectText(model?.method, `${modelPath}.method`, { strictProse: true });

    if (isAutomated) {
      if (!modelId) addError("model.id.missing", `${modelPath}.id`, "A model ID is required.");
      else if (modelIds.has(modelId)) addError("model.id.duplicate", `${modelPath}.id`, `Model ID ${modelId} is duplicated in this note.`);
      modelIds.add(modelId);

      const method = meaningfulText(model?.method);
      if (lexicalWords(method).length < 5 || METHOD_PLACEHOLDER.test(method) || !isSubstantiveMethodStatement(method)) {
        addError("model.method.not-substantive", `${modelPath}.method`, "The method must be a substantive procedural statement, not a taxonomy label or generator placeholder.");
      }
      if (malformedAutomatedMethod(method)) {
        addError("model.method.malformed", `${modelPath}.method`, "The method contains a discourse or heading fragment, a generic self-reference, a merged noun phrase, or a subject-verb agreement error.");
      }
    }

    for (const field of SETUP_FIELDS) {
      const entries = values(model?.[field]);
      const evidenceEntries = values(model?.setupEvidence?.[field]);
      const substantiveEntries = entries.filter((value) => meaningfulText(value) && !SETUP_PLACEHOLDER.test(meaningfulText(value)));
      for (const [entryIndex, value] of entries.entries()) {
        const path = `${modelPath}.${field}[${entryIndex}]`;
        inspectText(value, path, { strictProse: true });
        if (isAutomated && (!meaningfulText(value) || SETUP_PLACEHOLDER.test(meaningfulText(value)))) {
          addError("model.setup.placeholder", path, `The ${field} entry is empty or a generic generator placeholder.`);
        }
        if (isAutomated) {
          const malformed = malformedAutomatedSetup(field, value);
          if (malformed) addError("model.setup.malformed", path, `The ${field} entry is malformed: ${malformed}.`);
          if (field === "objects" && RESEARCH_AUTHOR_OBJECT.test(meaningfulText(value))) {
            const key = normalizedKey(value);
            const creatorEvidence = evidenceEntries.some((evidence) => normalizedKey(evidence?.value) === key
              && explicitlyModelsContentCreators(evidence));
            if (!creatorEvidence) {
              addError("model.setup.object.research-author", path, "Authors and researchers are methodological actors unless literal setup evidence explicitly models them as content creators.");
            }
          }
        }
      }
      if (isAutomated && !substantiveEntries.length) {
        addError("model.setup.missing", `${modelPath}.${field}`, `Mini-schema parity requires at least one substantive, source-grounded ${field} entry.`);
      }

      if (isAutomated) {
        const maturity = meaningfulText(model?.setupMaturity?.[field]);
        if (!Array.isArray(model?.setupEvidence?.[field])) {
          addError("model.setup-evidence.field-array-missing", `${modelPath}.setupEvidence.${field}`, `setupEvidence.${field} must be an array.`);
        }
        if (!SETUP_MATURITY.has(maturity)) {
          addError("model.setup-maturity.invalid", `${modelPath}.setupMaturity.${field}`, `Unsupported setup maturity: ${String(model?.setupMaturity?.[field])}.`);
        } else if (substantiveEntries.length && maturity === "unresolved") {
          addError("model.setup-maturity.inconsistent", `${modelPath}.setupMaturity.${field}`, `A nonempty ${field} field cannot be marked unresolved.`);
        }
        const evidenceByValue = new Map();
        for (const [evidenceIndex, evidence] of evidenceEntries.entries()) {
          const evidencePath = `${modelPath}.setupEvidence.${field}[${evidenceIndex}]`;
          const evidenceValue = meaningfulText(evidence?.value);
          const evidenceKey = normalizedKey(evidenceValue);
          const source = evidence?.source;
          const literalContainers = [source?.matchedText, source?.quote].map(meaningfulText).filter(Boolean);
          inspectText(evidence?.value, `${evidencePath}.value`, { strictProse: true });
          inspectText(source?.matchedText, `${evidencePath}.source.matchedText`, { strictProse: true, literalProvenance: true });
          inspectText(source?.quote, `${evidencePath}.source.quote`, { strictProse: true, literalProvenance: true });

          if (!evidenceKey) {
            addError("model.setup-evidence.value-missing", `${evidencePath}.value`, "Setup evidence requires a meaningful value.");
          } else if (evidenceByValue.has(evidenceKey)) {
            addError("model.setup-evidence.duplicate", `${evidencePath}.value`, `Setup evidence duplicates ${evidenceByValue.get(evidenceKey)}.`);
          } else {
            evidenceByValue.set(evidenceKey, evidencePath);
          }
          if (!source || typeof source !== "object") {
            addError("model.setup-evidence.source-missing", `${evidencePath}.source`, "Setup evidence requires a source descriptor.");
          } else if (!SETUP_SOURCE_TYPES.has(source?.type)) {
            addError("model.setup-evidence.source-type-invalid", `${evidencePath}.source.type`, `Unsupported setup-evidence source type: ${String(source?.type)}.`);
          }
          if (field === "decisions"
              && /\b(?:paper|study|work|model)\s+by\b.{0,100}\b(?:consider|develop|introduc|propos|stud)\w*\b/i.test(meaningfulText(source?.quote))) {
            addError("model.setup-evidence.borrowed-decision", evidencePath, "A decision attributed to another paper or model cannot be published as this paper's modeled control.");
          }
          if (field === "decisions"
              && /^(?:[\p{Lu}][\p{L}'’.-]+(?:\s+(?:and|&)\s+[\p{Lu}][\p{L}'’.-]+|\s+et\s+al\.)?\s*\((?:19|20)\d{2}[a-z]?\))\s+(?:has\s+|have\s+)?(?:argued|considered|found|proposed|showed|suggested|studied)\b/iu.test(meaningfulText(source?.quote))) {
            addError("model.setup-evidence.borrowed-decision", evidencePath, "A decision attributed to another paper or model cannot be published as this paper's modeled control.");
          }
          if (field === "decisions"
              && /^(?:minimize|maximize)\b/i.test(evidenceValue)
              && /\b(?:objective|goal|aim)\s+(?:is|are|was|were)\s+to\s+(?:minimize|maximize)\b/i.test(meaningfulText(source?.quote))) {
            addError("model.setup-evidence.objective-not-control", evidencePath, "A model objective cannot be published as the model's controlled decision.");
          }
          if (!literalContainers.some((container) => normalizedLiteralIncludes(container, evidenceValue))) {
            addError("model.setup-evidence.not-literal", evidencePath, "The displayed setup value must occur literally in source.matchedText or source.quote.");
          }

          const sectionSource = source?.type === "section" || meaningfulText(source?.section);
          if (sectionSource) {
            const page = source?.page;
            const quote = meaningfulText(source?.quote);
            const matchedText = meaningfulText(source?.matchedText);
            const section = meaningfulText(source?.section);
            if (!section) {
              addError("model.setup-evidence.section-missing", `${evidencePath}.source.section`, "Section setup evidence must name its source section.");
            } else {
              const headingReason = sourceHeadingRejectionReason(section);
              if (headingReason) addError("model.setup-evidence.section-not-heading", `${evidencePath}.source.section`, `Setup-evidence section is ${headingReason}.`);
            }
            if (!Number.isInteger(page) || page < 1) {
              addError("model.setup-evidence.page-invalid", `${evidencePath}.source.page`, "Section setup evidence requires a positive one-based page.");
            }
            if (!quote) {
              addError("model.setup-evidence.quote-missing", `${evidencePath}.source.quote`, "Section setup evidence requires its literal containing source sentence.");
            } else {
              if (matchedText && !normalizedLiteralIncludes(quote, matchedText)) {
                addError("model.setup-evidence.matched-text-outside-quote", `${evidencePath}.source.matchedText`, "Section setup evidence matchedText must occur literally inside its source quote.");
              }
            }
            if (quote && suppliedPages && Number.isInteger(page) && page > 0) {
              const rawPage = pagesByNumber.get(page);
              if (rawPage === undefined) {
                addError("model.setup-evidence.page-missing", `${evidencePath}.source.page`, `Cited setup-evidence page ${page} is absent from the supplied extraction.`);
              } else if (!rawSetupLiteralIncludes(source.quote, rawPage)) {
                addError("model.setup-evidence.quote-not-literal", `${evidencePath}.source.quote`, "The setup-evidence quote is not a whitespace-normalized literal substring of the cited page.");
              } else if (formulaContaminatedProse(source.quote, rawPage, { conservative: true })
                  && !(source?.derivation === "literal-parameter-gloss"
                    && rawSetupLiteralIncludes(source?.matchedText, source?.quote)
                    && !hasExtractionNoise(source?.matchedText)
                    && !/[=<>≤≥∑∫{}]|\b(?:arg\s*(?:min|max)|exp|log)\s*\(/i.test(String(source?.matchedText || ""))
                    && String(source?.matchedText || "").trim().split(/\s+/u).length >= 2)) {
                addError("model.setup-evidence.quote-formula-contaminated", `${evidencePath}.source.quote`, "A setup-evidence quote must not absorb a standalone display equation from an adjacent physical line.");
              }
            }
          } else if (source?.type === "record" && !meaningfulText(source?.field)) {
            addError("model.setup-evidence.field-missing", `${evidencePath}.source.field`, "Record-field setup evidence must identify its source field.");
          }
        }

        const displayedKeys = new Set(entries.map(normalizedKey).filter(Boolean));
        for (const [entryIndex, value] of entries.entries()) {
          const key = normalizedKey(value);
          if (!key) continue;
          setupEvidenceChecks += 1;
          if (evidenceByValue.has(key)) setupEvidenceMatches += 1;
          else addError("model.setup-evidence.missing", `${modelPath}.${field}[${entryIndex}]`, `Displayed ${field} value has no matching setupEvidence entry.`);
        }
        for (const [key, evidencePath] of evidenceByValue) {
          if (!displayedKeys.has(key)) addError("model.setup-evidence.orphan", `${evidencePath}.value`, `Setup evidence does not correspond to a displayed ${field} value.`);
        }
      }
    }

    if (isAutomated && (!model?.setupEvidence || typeof model.setupEvidence !== "object")) {
      addError("model.setup-evidence.missing-object", `${modelPath}.setupEvidence`, "Automated model setup requires field-level provenance.");
    }
    if (isAutomated && (!model?.setupMaturity || typeof model.setupMaturity !== "object")) {
      addError("model.setup-maturity.missing-object", `${modelPath}.setupMaturity`, "Automated model setup requires field-level maturity states.");
    }
    if (isAutomated && !Array.isArray(model?.setupDiagnostics)) {
      addError("model.setup-diagnostics.invalid", `${modelPath}.setupDiagnostics`, "Automated model setup requires a diagnostics array, including explicit entries for unresolved fields.");
    }

    const localModelText = modelLocalText(model);
    for (const [sourceIndex, source] of values(model?.sources).entries()) {
      inspectSource(source, `${modelPath}.sources[${sourceIndex}]`, localModelText);
    }

    const components = values(model?.components);
    const componentIds = new Set();
    const labelKeys = new Map();
    const explanationKeys = new Map();
    const fingerprints = new Map();

    if (isAutomated && !components.length) {
      addError("component.missing", `${modelPath}.components`, "At least one model component is required.");
    }

    for (const [componentIndex, component] of components.entries()) {
      componentCount += 1;
      const componentPath = `${modelPath}.components[${componentIndex}]`;
      const componentId = meaningfulText(component?.id);
      const label = meaningfulText(component?.label);
      const explanation = meaningfulText(component?.explanation);
      inspectText(component?.label, `${componentPath}.label`, { strictProse: true });
      inspectText(component?.explanation, `${componentPath}.explanation`, { strictProse: true });
      inspectMathematicalText(component?.formal, `${componentPath}.formal`);
      inspectText(component?.formalKind, `${componentPath}.formalKind`, { strictProse: true });
      for (const [index, value] of values(component?.searchPhrases).entries()) inspectText(value, `${componentPath}.searchPhrases[${index}]`, { strictProse: true });
      for (const [index, value] of values(component?.conditions).entries()) {
        const conditionPath = `${componentPath}.conditions[${index}]`;
        inspectText(value, conditionPath, { strictProse: true });
        if (isAutomated && resultOrContributionCondition(value)) {
          addError(
            "component.condition.result-or-contribution",
            conditionPath,
            "A component condition must state a premise, domain, timing, or feasibility restriction rather than a reported result or contribution."
          );
        }
        const conditionKey = meaningfulText(value).toLocaleLowerCase();
        if (conditionKey) {
          const uses = conditionUses.get(conditionKey) || [];
          uses.push(conditionPath);
          conditionUses.set(conditionKey, uses);
        }
      }
      for (const [index, symbol] of values(component?.symbols).entries()) {
        inspectMathematicalText(symbol?.symbol, `${componentPath}.symbols[${index}].symbol`);
        const meaningPath = `${componentPath}.symbols[${index}].meaning`;
        if (symbol?.sourceKind === "reviewed-catalog") {
          // Reviewed model-map definitions may legitimately contain inline
          // equations, set notation, or terminal variable names. Applying the
          // PDF-prose noise detector to those definitions discards valid
          // glossary entries. Keep the mathematical-corruption and prohibited-
          // prose backstops, which are the relevant checks for this provenance.
          inspectMathematicalText(symbol?.meaning, meaningPath);
          if (isAutomated) {
            const reason = prohibitedProseReason(symbol?.meaning);
            if (reason) addError("text.prohibited-prose", meaningPath, `Reviewed notation meaning is ${reason}, not a semantic definition.`);
          }
        } else {
          inspectText(symbol?.meaning, meaningPath, { strictProse: true });
        }
      }

      if (isAutomated) {
        if (!/\b(?:restatement|verbal)\b/i.test(meaningfulText(component?.formalKind))
          && !values(component?.symbols).length) {
          addError(
            "component.symbols.missing-for-math",
            `${componentPath}.symbols`,
            "A source-extracted or normalized mathematical formal requires at least one source-grounded symbol; otherwise publish a verbal restatement."
          );
        }
        if (!componentId) addError("component.id.missing", `${componentPath}.id`, "A component ID is required.");
        else if (componentIds.has(componentId)) addError("component.id.duplicate", `${componentPath}.id`, `Component ID ${componentId} is duplicated in this model.`);
        componentIds.add(componentId);

        if (!label || COMPONENT_PLACEHOLDER.test(label)) {
          addError("component.label.not-substantive", `${componentPath}.label`, "A clean, descriptive component label is required.");
        }
        if (label && !hasExtractionNoise(component?.label)) {
          if (noteTitleKeys.has(normalizedKey(label))) {
            addError("component.label.paper-title", `${componentPath}.label`, "A paper title cannot serve as a model-component heading.");
          }
          const headingReason = headingLabelRejectionReason(label);
          if (headingReason) {
            addError("component.label.not-heading", `${componentPath}.label`, `Component label is ${headingReason}; use a concise semantic heading.`);
          }
        }
        if (lexicalWords(explanation).length < 6 || COMPONENT_PLACEHOLDER.test(explanation)) {
          addError("component.explanation.not-substantive", `${componentPath}.explanation`, "A substantive component explanation of at least six words is required.");
        }
        if (!meaningfulText(component?.formal)) {
          addError("component.formal.missing", `${componentPath}.formal`, "Mini-schema parity requires a source equation or an explicitly labeled source-grounded formal restatement.");
        }
        if (!values(component?.searchPhrases).some((value) => meaningfulText(value))) {
          addError("component.search-phrases.missing", `${componentPath}.searchPhrases`, "Mini-schema parity requires at least one substantive component search phrase.");
        }
        if (!values(component?.conditions).some((value) => meaningfulText(value))) {
          addError("component.conditions.missing", `${componentPath}.conditions`, "Mini-schema parity requires at least one source-grounded component condition.");
        }
        if (!values(component?.sources).length) {
          addError("component.sources.missing", `${componentPath}.sources`, "Mini-schema parity requires at least one local component source anchor.");
        }
        if (label && normalizedKey(label) === normalizedKey(explanation)) {
          addError("component.label-explanation.same", componentPath, "The component label and explanation must carry distinct information.");
        }

        const labelKey = normalizedKey(label);
        if (labelKey) {
          if (labelKeys.has(labelKey)) addError("component.label.duplicate", `${componentPath}.label`, `Component label duplicates ${labelKeys.get(labelKey)}.`);
          else labelKeys.set(labelKey, `${modelPath}.components[${componentIndex}].label`);
        }
        const explanationKey = normalizedKey(explanation);
        if (explanationKey) {
          if (explanationKeys.has(explanationKey)) addError("component.explanation.duplicate", `${componentPath}.explanation`, `Component explanation duplicates ${explanationKeys.get(explanationKey)}.`);
          else explanationKeys.set(explanationKey, `${modelPath}.components[${componentIndex}].explanation`);
        }

        const fingerprint = componentSubstanceFingerprint(component);
        if (fingerprint) {
          if (fingerprints.has(fingerprint)) {
            duplicateComponents += 1;
            addError("component.semantic-duplicate", componentPath, `Component is semantically identical to ${fingerprints.get(fingerprint)}.`);
          } else fingerprints.set(fingerprint, componentPath);
        }
      }

      const localComponentText = componentLocalText(component);
      for (const [sourceIndex, source] of values(component?.sources).entries()) {
        inspectSource(source, `${componentPath}.sources[${sourceIndex}]`, localComponentText);
      }

      const concepts = values(component?.concepts).map((concept) => meaningfulText(concept)).filter(Boolean);
      const conceptSet = new Set(concepts);
      const bindings = values(component?.conceptBindings);
      const bindingConcepts = new Set();
      const modeledConcepts = new Set();
      if (isAutomated && !bindings.length) {
        addError("binding.missing", `${componentPath}.conceptBindings`, "Mini-schema parity requires at least one source-grounded modeled concept binding.");
      }
      if (isAutomated && !concepts.length) {
        addError("component.concepts.missing", `${componentPath}.concepts`, "Mini-schema parity requires at least one modeled concept ID.");
      }
      if (isAutomated && conceptSet.size !== concepts.length) {
        addError("component.concepts.duplicate", `${componentPath}.concepts`, "Modeled concept IDs must be distinct.");
      }

      for (const [bindingIndex, binding] of bindings.entries()) {
        bindingCount += 1;
        const bindingPath = `${componentPath}.conceptBindings[${bindingIndex}]`;
        const conceptId = meaningfulText(binding?.conceptId);
        const status = binding?.status;
        inspectText(binding?.representation, `${bindingPath}.representation`, { strictProse: true });
        inspectText(binding?.reviewStatus, `${bindingPath}.reviewStatus`);

        if (status === "modeled") modeledBindingCount += 1;
        if (status === "unknown") unknownBindingCount += 1;
        if (!isAutomated) continue;

        if (!conceptId) addError("binding.concept.missing", `${bindingPath}.conceptId`, "A concept ID is required.");
        else if (bindingConcepts.has(conceptId)) addError("binding.concept.duplicate", `${bindingPath}.conceptId`, `Concept ${conceptId} is bound more than once in this component.`);
        bindingConcepts.add(conceptId);
        if (!BINDING_STATUSES.has(status)) addError("binding.status.invalid", `${bindingPath}.status`, `Unsupported binding status: ${String(status)}.`);
        if (status === "modeled") modeledConcepts.add(conceptId);
        if (String(binding?.reviewStatus ?? "").toLocaleLowerCase() === "editorial") {
          addError("binding.review-status.editorial", `${bindingPath}.reviewStatus`, "Automated concept bindings may not claim editorial review status.");
        }
        if (lexicalWords(binding?.representation).length < 5) {
          addError("binding.representation.thin", `${bindingPath}.representation`, "A substantive local representation is required.");
        }

        const conditionRefs = values(binding?.conditionRefs);
        if (!Array.isArray(binding?.conditionRefs) || !conditionRefs.length
          || new Set(conditionRefs).size !== conditionRefs.length
          || conditionRefs.some((index) => !Number.isInteger(index) || index < 0 || index >= values(component?.conditions).length)) {
          addError("binding.condition-refs.invalid", `${bindingPath}.conditionRefs`, "Every binding requires at least one distinct valid zero-based component-condition reference.");
        }

        if (binding?.symbolRefs !== undefined) {
          const symbolRefs = values(binding.symbolRefs);
          if (!Array.isArray(binding.symbolRefs) || new Set(symbolRefs).size !== symbolRefs.length
            || symbolRefs.some((index) => !Number.isInteger(index) || index < 0 || index >= values(component?.symbols).length)) {
            addError("binding.symbol-refs.invalid", `${bindingPath}.symbolRefs`, "Symbol references must be distinct valid zero-based component indices.");
          }
        }
        if (binding?.formalRef !== undefined && (binding.formalRef !== "formal" || !meaningfulText(component?.formal))) {
          addError("binding.formal-ref.invalid", `${bindingPath}.formalRef`, "formalRef may only point to a nonempty component formal field.");
        }

        const refs = values(binding?.sourceRefs);
        if (!Array.isArray(binding?.sourceRefs) || !refs.length) {
          addError("binding.source-refs.missing", `${bindingPath}.sourceRefs`, "Every binding requires component- or model-local source provenance.");
        }
        if (binding?.sourceRefs !== undefined) {
          const keys = new Set();
          for (const [refIndex, ref] of refs.entries()) {
            const refPath = `${bindingPath}.sourceRefs[${refIndex}]`;
            const key = `${ref?.scope}:${ref?.index}`;
            if (!ref || !["component", "model"].includes(ref.scope) || !Number.isInteger(ref.index) || ref.index < 0
              || referencedSourceCount(component, model, [ref]) !== 1) {
              addError("binding.source-ref.invalid", refPath, "Source references must point to a valid local component or model source.");
            } else if (keys.has(key)) {
              addError("binding.source-ref.duplicate", refPath, `Source reference ${key} is duplicated in this binding.`);
            }
            keys.add(key);
          }
        }

        if (status === "modeled" && conceptsById.size) {
          const concept = conceptsById.get(conceptId);
          const sources = referencedSources(component, model, refs);
          const phraseGrounded = conceptHasSourceSupport(concept, sources);
          const roleGrounded = binding?.mappingBasis === "source-role-predicate"
            && isRoleGroundedConcept(component?.role, conceptId)
            && sources.length > 0
            && sources.every((source) => sourceSupportsRole(component?.role, source?.quote));
          if (!concept || (!phraseGrounded && !roleGrounded)) {
            unsupportedModeledBindings += 1;
            addError(
              "binding.source.no-concept-support",
              `${bindingPath}.sourceRefs`,
              "The source anchors must either contain the concept phrase or support the component's registered broad role mapping."
            );
          }
        }
      }

      if (isAutomated) {
        if (!modeledConcepts.size) {
          addError("binding.modeled.missing", `${componentPath}.conceptBindings`, "Mini-schema parity requires at least one modeled binding; unknown-only components cannot be released.");
        }
        const modeled = [...modeledConcepts].sort();
        const legacy = [...conceptSet].sort();
        if (modeled.length !== legacy.length || modeled.some((concept, index) => concept !== legacy[index])) {
          addError("component.concepts.inconsistent", `${componentPath}.concepts`, "component.concepts must equal exactly the concept IDs of modeled bindings.");
        }
      }
    }
  }

  if (isAutomated && setupArraysAreByteIdentical(models)) {
    addWarning(
      "model.setup.identical-across-variants",
      "models",
      `All ${models.length} model variants repeat byte-identical objects, inputs, decisions, and assumptions arrays; verify that the shared setup is intentional.`
    );
  }

  if (isAutomated) {
    const coreSignatures = new Map();
    for (const [modelIndex, model] of models.entries()) {
      const signature = modelCoreSignature(model);
      if (!signature) continue;
      if (coreSignatures.has(signature)) {
        duplicateVariantModels += 1;
        addError(
          "model.variant.duplicate-content",
          `models[${modelIndex}]`,
          `The model repeats the same setup, method, and semantic component set as ${coreSignatures.get(signature)}; a distinct variant must map distinct substantive content.`
        );
      } else coreSignatures.set(signature, `models[${modelIndex}]`);
    }
  }

  if (isAutomated) {
    for (const [modelIndex, model] of models.entries()) {
      const seenTargets = new Set();
      for (const [relationIndex, relation] of values(model?.relationships).entries()) {
        const path = `models[${modelIndex}].relationships[${relationIndex}]`;
        if (!RELATIONSHIP_TYPES.has(relation?.type)) addError("relationship.type.invalid", `${path}.type`, `Unsupported model relationship type: ${String(relation?.type)}.`);
        if (!modelIds.has(meaningfulText(relation?.targetModelId)) || relation?.targetModelId === model?.id) {
          addError("relationship.target.invalid", `${path}.targetModelId`, "Relationship target must identify a different model in this note.");
        }
        if (seenTargets.has(relation?.targetModelId)) addError("relationship.target.duplicate", `${path}.targetModelId`, "A model may reference a target model only once.");
        seenTargets.add(relation?.targetModelId);
      }
    }
  }

  let reusedComponentConditions = 0;
  for (const uses of conditionUses.values()) {
    if (uses.length < 2) continue;
    reusedComponentConditions += 1;
    addWarning(
      "component.condition.reused",
      uses[1],
      `The same component condition is reused ${uses.length} times; verify independent local applicability: ${uses.join(", ")}.`
    );
  }

  let reusedSourceAnchors = 0;
  for (const uses of anchorUses.values()) {
    if (uses.length < 2) continue;
    reusedSourceAnchors += 1;
    addWarning("source.anchor.reused", uses[1], `The same source anchor is reused ${uses.length} times: ${uses.join(", ")}.`);
  }

  const coveragePages = new Set(values(note?.coverage?.pages).filter((page) => Number.isInteger(page) && page > 0));
  const effectiveCoverage = new Set([...coveragePages, ...sourcedPages]);
  if (effectiveCoverage.size < 2 || (componentCount >= 4 && sourcedPages.size < 2)) {
    addWarning("coverage.thin", "coverage.pages", `Only ${effectiveCoverage.size} distinct source page${effectiveCoverage.size === 1 ? " is" : "s are"} represented; coverage may be too thin for the note's scope.`);
  }
  if (isAutomated && !suppliedPages && sourceCount > 0) {
    addWarning("source.pages-unavailable", "sources", "Extracted pages were not supplied, so literal-quote checks were not run.");
  }

  const metrics = {
    auditVersion: SEMANTIC_AUDIT_VERSION,
    authoringMode: String(requestedMode || "automated"),
    validationProfile: isAutomated ? "automated" : "editorial",
    models: models.length,
    components: componentCount,
    bindings: bindingCount,
    modeledBindings: modeledBindingCount,
    unknownBindings: unknownBindingCount,
    sourceAnchors: sourceCount,
    uniqueSourceAnchors: anchorUses.size,
    reusedSourceAnchors,
    reusedComponentConditions,
    sourcedPages: sourcedPages.size,
    coveragePages: effectiveCoverage.size,
    quoteChecks,
    quoteMatches,
    localOverlapChecks,
    localOverlapMatches,
    duplicateComponents,
    duplicateVariantModels,
    setupEvidenceChecks,
    setupEvidenceMatches,
    unsupportedModeledBindings,
    errorCount: errors.length,
    warningCount: warnings.length
  };

  return { errors, warnings, metrics };
}
