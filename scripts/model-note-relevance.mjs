import {
  hasExtractionNoise,
  isBoilerplate,
  isCaption,
  isCitation,
  isPaperOrganizationProse,
  isTableRow
} from "./model-note-text-quality.mjs";

export const AUTOMATED_REVIEW_STATUS = "automated-source-map";
export const MAX_COMPONENT_CONCEPTS = 3;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it",
  "of", "on", "or", "that", "the", "their", "this", "to", "under", "with"
]);

const BROAD_CONCEPT_IDS = new Set([
  "algorithm-design",
  "consumer-choice",
  "decision-making",
  "estimation",
  "optimization",
  "pricing",
  "process-dynamics",
  "strategic-interaction",
  "system-state",
  "uncertainty"
]);

// The registry's `related` links are intentionally not a full ontology. These
// few stable Atlas relationships identify broad labels that should yield to a
// locally supported specialization even when an older registry entry omits the
// reverse link.
const KNOWN_BROAD_ANCESTORS = Object.freeze({
  "consumer-choice": new Set(["choice-model", "multinomial-logit-choice"]),
  optimization: new Set([
    "assortment-optimization", "data-driven-optimization", "dynamic-programming",
    "network-optimization", "robust-optimization"
  ]),
  pricing: new Set(["dynamic-pricing", "personalized-pricing"]),
  uncertainty: new Set(["distributional-ambiguity", "risk-management", "robust-optimization"])
});

export const ROLE_GROUNDED_CONCEPT_IDS = Object.freeze({
  algorithm: ["algorithm-design", "optimization"],
  constraint: ["feasibility-constraints"],
  decision: ["decision-making", "optimization"],
  estimation: ["estimation"],
  information: ["information-structure"],
  interaction: ["model-interaction"],
  objective: ["model-objective"],
  preference: ["preference-modeling"],
  process: ["process-dynamics"],
  state: ["system-state", "process-dynamics"]
});

export function roleGroundedConceptIds(role) {
  return [...(ROLE_GROUNDED_CONCEPT_IDS[cleanText(role).toLowerCase()] || [])];
}

export function isRoleGroundedConcept(role, conceptId) {
  return roleGroundedConceptIds(role).includes(cleanText(conceptId));
}

const EVIDENCE_WEIGHT = Object.freeze({ title: 5, text: 4, condition: 3, symbol: 3, source: 2 });
const EVIDENCE_LABEL = Object.freeze({
  title: "component title",
  text: "component explanation",
  condition: "component condition",
  symbol: "component symbol definition",
  source: "component source"
});

const ROLE_BINDING_CONTEXT = Object.freeze({
  algorithm: "algorithmic procedure",
  constraint: "feasibility conditions",
  decision: "decision rule",
  estimation: "estimation procedure",
  information: "information structure",
  interaction: "actor interaction",
  objective: "modeled objective",
  preference: "preference specification",
  process: "process dynamics",
  state: "state description"
});

const EXPLICIT_LOCAL_VARIANT_SOURCE = /(?:\bbenchmark\s+case\s+where\b[^.!?]{0,260}\b(?:does?\s+not|without|rather|instead)\b|\bwe\s+endogenize\s+the\s+decision\b[^.!?]{0,220}\b(?:choose|singlehome|multihome)\b|^This\s+section\s+examines\b[^.!?]{0,220}\bfixed\s+price\b[^.!?]{0,180}\b(?:remains?\s+unchanged|regardless)\b|^In\s+this\s+approach,?\s+the\s+platform\s+randomly\s+selects?\b[^.!?]{0,220}\boffers?\b|^In\s+this\s+section,?\s+we\s+broaden\s+the\s+scope\s+of\s+our\s+base\s+model\b|^In\s+this\s+extension,?\s+we\s+(?:also\s+)?allow\b|^This\s+section\s+introduces\s+a\s+dynamic\s+extension\b|^For\s+the\s+best-case\s+benchmark\s+approach,?\s+we\s+consider\b)/iu;

const ROLE_SOURCE_SIGNAL = Object.freeze({
  algorithm: /\b(?:algorithm|procedure|iterate|recursion|dynamic\s+program|decomposition|heuristic|solve[sd]?|simulat(?:e|es|ed|ing|ion)|optimization\s+method|backward\s+induction|working\s+backward|queueing\s+(?:analysis|model)|indifference\s+conditions?|train(?:s|ed|ing)?|fine[-\s]?tun(?:e|es|ed|ing)|sequenc(?:e|es|ed|ing)|order(?:s|ed|ing)|arrang(?:e|es|ed|ing))\b/iu,
  constraint: /[≤≥=<>∈]|\b(?:constraints?|subject\s+to|feasible|capacity|budget|limited|upper\s+bound|cannot|must|require[sd]?|restrict(?:ed|s|ion)|exogenously\s+set|fixed\s+price|(?:prices?|fees?|rates?|capacities|budgets?|parameters?)\s+remains?\s+unchanged|benchmark\s+case\s+where|does?\s+not\s+play|no\s+peer\s+effect|ignore(?:s|d|ing)?\s+the\s+influence|shared\s+among\s+all|share\s+one\s+nurse\s+pool|(?:are|is)\s+dis\s*joint|cross[- ]trained\s+for\s+only|pools?\s+form\s+a\s+(?:long\s+)?chain|covered\s+by\s+two\s+nurse\s+pools?)\b/iu,
  decision: /\b(?:decisions?|choos(?:e|es|ing)|decid(?:e|es|ing)|select(?:s|ed|ing)?|allocat(?:e|es|ed|ing)|assign(?:s|ed|ing)?|invest(?:s|ed|ing)?|pric(?:e|es|ed|ing)|offer(?:s|ed|ing)?|target(?:s|ed|ing)?|disclos(?:e|es|ed|ing)|saniti[sz](?:e|es|ed|ing|ation))\b|\border(?:s|ed|ing)?\s+(?:a|an|the|inventory|units?|quantit(?:y|ies)|products?|items?)\b|\bset(?:s|ting)?\s+(?:a|an|the|its|their|prices?|rates?|levels?|values?|terms?|thresholds?|capacity|quantit(?:y|ies)|decision|policy)\b|\b(?:is|are|was|were)\s+set\s+to\b|\bcan\s+be\s+endogenously\s+set\s+by\b/iu,
  estimation: /\b(?:estimat(?:e|es|ed|ing|or)|identify|identification|likelihood|regression|inference|fit(?:s|ted|ting)?|moment)\b/iu,
  information: /\b(?:observ(?:e|es|ed|ing|able)|know(?:s|n)?|signal|information|belief|private|public|monitor(?:s|ed|ing)?|verif(?:y|ies|ied|iable)|unknown|uncertain(?:ty)?|random\s+(?:variable|vector|quantity)|defin(?:e|es|ed|ing)|denot(?:e|es|ed|ing)|represent(?:s|ed|ing)?|(?:obtain|collect)(?:s|ed|ing)?\s+(?:(?:one|multiple|several|\d+|[A-Z])\s+)?(?:anecdotes?|samples?))\b/iu,
  interaction: /\b(?:equilibrium|best\s+response|compete|competition|strategic|bargain|contract|auction|game|respond(?:s|ed|ing)?|(?:manufacturing|design|technology)\s+licens(?:e|ing)|licens(?:e|ing)\s+(?:agreement|contract|fee|terms?|strateg(?:y|ies)))\b/iu,
  objective: /\b(?:objectives?|maximi[sz](?:e|es|ed|ing|ation)|minimi[sz](?:e|es|ed|ing|ation)|profits?|revenues?|costs?|welfare|payoffs?|rewards?|utilities|utility)\b/iu,
  preference: /\b(?:utility|valuation|preference|choice|demand|willingness\s+to\s+pay|goods?\s+(?:are|is)\s+(?:a\s+)?substitutes?|substitute\s+goods?)\b/iu,
  process: /\b(?:arriv(?:e|es|ed|al)|depart(?:s|ed|ure)?|transition|evolv(?:e|es|ed|ing)|dynamics?|update(?:s|d)?|flows?|process(?:es)?|propagat(?:e|es|ed|ing)|random[-\s]+walks?|iterat(?:e|es|ed|ing|ion)|adaptation|accommodat(?:e|es|ed|ing)|absorbing\s+states?)\b|\bmodel(?:ing)?\s+framework\b|\b(?:states?\s+)?become\s+absorbing\b|\b(?:acquisition|retention)\s+rates?\b|\bproceed(?:s|ed|ing)?\s+at\s+(?:time(?:\s*-\s*|\s+)dependent|constant|variable)\s+rates?\b|\btracks?\b[^.!?]{0,120}\b(?:over|by)\s+time\b|\b(?:costs?|quality)\b[^.!?]{0,100}\b(?:declin|improv)\w*\b[^.!?]{0,100}\bcumulative\s+(?:production\s+)?experience\b|\bif\b[^.!?]{0,100}\b(?:succeeds?|fails?)\b[^.!?]{0,120}\b(?:replaces?|remains?|continues?)\b/iu,
  state: /\b(?:states?|inventory|queue|waiting\s+time|remaining|stock|balance|system\s+status)\b/iu
});

export function sourceSupportsRole(role, value) {
  const pattern = ROLE_SOURCE_SIGNAL[cleanText(role).toLowerCase()];
  return Boolean(pattern && usableRelevanceSourceExcerpt(value) && pattern.test(cleanText(value)));
}

function cleanText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\u00ad\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(token) {
  if (/^vaccin(?:e|es|ation|ations)$/u.test(token)) return "vaccin";
  if (/^(?:allocat\w*|assign\w*)$/u.test(token)) return "alloc";
  if (/^auctioneers?$/u.test(token)) return "auction";
  if (token === "pricing" || token === "priced" || token === "prices") return "price";
  if (token === "risks") return "risk";
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 7) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 6) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) return token.slice(0, -1);
  return token;
}

export function relevanceTokens(value) {
  return (cleanText(value).toLowerCase().match(/[a-z0-9]+/g) || [])
    .map(stemToken)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function distinct(values) {
  return [...new Set(values)];
}

function balancedSourceDelimiters(value) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const character of String(value ?? "")) {
    if (character === "(" || character === "[" || character === "{") stack.push(character);
    else if (pairs[character] && stack.pop() !== pairs[character]) return false;
  }
  return stack.length === 0;
}

/**
 * A source match can establish a modeled binding only when its quoted excerpt
 * is readable model prose.  Section labels may help find a candidate, but must
 * never turn a broken formula tail, bibliography line, or paper roadmap into
 * evidence about the model.
 */
export function usableRelevanceSourceExcerpt(value) {
  const text = cleanText(value);
  if (!text || hasExtractionNoise(value)) return false;
  const explicitLocalVariant = EXPLICIT_LOCAL_VARIANT_SOURCE.test(text);
  if (isBoilerplate(text) || (isPaperOrganizationProse(text) && !explicitLocalVariant)
    || isCaption(text) || isCitation(text) || isTableRow(value)) return false;
  if (/^(?:management science|marketing science|information systems research|manufacturing\s*&\s*service operations management)\b.*\b(?:vol(?:ume)?|no\.?|issue|pp?\.?|informs|\d+\(\d+\))\b/i.test(text)) return false;

  // Unmatched delimiters and operator-led snippets are overwhelmingly clipped
  // equation continuations in the PDF extraction (for example, "v − p) …").
  if (!balancedSourceDelimiters(text)) return false;
  if (/^(?:[,;:.)}\]·•]|[<>≤≥=+×÷*/^_]|[-−](?:\s|\d))/u.test(text)) return false;
  if (/^[A-Za-z][A-Za-z0-9_^]*\s*(?:[)}\]]|[=<>≤≥+*/−]|-(?=\s|\d))/u.test(text)) return false;
  if (/(?:\.\s*){3,}$|…$/u.test(text)) return false;
  if (/(?:[=<>≤≥+*/−-]|[([{]|[,;:])\s*$/u.test(text)) return false;
  if (/\b(?:and|or|but|of|for|from|to|the|a|an|with|such\s+that)\s*[.]?$/i.test(text)) return false;

  // Related-work attributions, reference rows, and publication-year fragments
  // are background mentions, not evidence that this paper models the concept.
  if (/^(?:19|20)\d{2}\s*[).,:-]/u.test(text)) return false;
  if (/^[\p{Lu}][\p{L}'’.-]+(?:\s+et\s+al\.)?\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s+(?:establish|introduc|develop|propos|study|studi|examin|consider|analy[sz]|show|find|document|demonstrat)/iu.test(text)) return false;
  if (/^(?:building\s+on|following|consistent\s+with|as\s+in|see|cf\.?|e\.g\.?)\b.{0,100}\b(?:19|20)\d{2}[a-z]?\b/iu.test(text)
    && !explicitLocalVariant) return false;

  // Proof deferrals and navigation sentences carry no local model semantics.
  if (/\bwe\s+(?:therefore\s+|thus\s+|hence\s+)?(?:omit|skip|defer)\s+(?:the\s+)?details?\b/i.test(text)) return false;
  if (/^(?:for\s+brevity|to\s+avoid\s+repetition)\b/i.test(text)) return false;
  if (/^(?:(?:if|when)\b.{0,120},\s*)?(?:then\s+)?(?:we\s+)?(?:have|obtain|get)\s+(?:the\s+)?following\s+(?:results?|lemma|proposition|theorem|corollary)\b/i.test(text)) return false;

  const words = text.match(/[\p{L}]+/gu) || [];
  const mathMarks = text.match(/[=<>≤≥+*/−_^{}\[\]]/gu) || [];
  if (words.length < 3) return false;
  if (mathMarks.length >= 2 && words.length <= 7) return false;
  return true;
}

function usableSourceMatch(match) {
  return match.segment.kind === "source" && match.segment.sourceUsable === true;
}

function phraseDefinitions(concept) {
  const values = distinct([concept.label, ...(concept.aliases || []), String(concept.id || "").replaceAll("-", " ")].map(cleanText).filter(Boolean));
  const seen = new Set();
  return values.map((text) => ({ text, tokens: relevanceTokens(text) }))
    .filter((phrase) => phrase.tokens.length)
    .filter((phrase) => {
      const key = phrase.tokens.join("\0");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function orderedPhraseMatch(haystack, needle) {
  if (!needle.length || haystack.length < needle.length) return null;
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
    if (matched === needle.length) return { start, end: cursor, contiguous: cursor - start + 1 === needle.length };
  }
  return null;
}

function evidenceSegments(input) {
  const segments = [];
  const add = (kind, index, value, details = {}) => {
    const text = cleanText(value);
    const tokens = relevanceTokens(text);
    if (tokens.length) segments.push({ kind, index, text, tokens, key: `${kind}:${index}`, ...details });
  };
  add("title", 0, input.title);
  add("text", 0, input.text);
  (input.conditions || []).forEach((condition, index) => add("condition", index, condition));
  (input.symbols || []).forEach((symbol, index) => add("symbol", index, `${symbol?.symbol || ""} ${symbol?.meaning || ""}`));
  (input.sources || []).forEach((source, index) => add(
    "source",
    index,
    `${source?.section || ""} ${source?.quote || ""}`,
    {
      sourceQuote: cleanText(source?.quote),
      sourceRawQuote: String(source?.quote ?? ""),
      sourceSection: cleanText(source?.section),
      sourceUsable: usableRelevanceSourceExcerpt(source?.quote)
    }
  ));
  return segments;
}

function tokenDocumentFrequency(concepts) {
  const frequencies = new Map();
  for (const concept of concepts) {
    const tokens = new Set(phraseDefinitions(concept).flatMap((phrase) => phrase.tokens));
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  return frequencies;
}

function conceptCandidate(concept, segments, frequencies, options = {}) {
  const phrases = phraseDefinitions(concept);
  const matches = [];
  for (const segment of segments) {
    if (segment.kind === "source" && !segment.sourceUsable && !options.allowUnusableSources) continue;
    for (const phrase of phrases) {
      const location = orderedPhraseMatch(segment.tokens, phrase.tokens);
      if (!location) continue;
      const rarity = phrase.tokens.reduce((sum, token) => sum + 1 / (frequencies.get(token) || 1), 0);
      const score = EVIDENCE_WEIGHT[segment.kind] * 10
        + phrase.tokens.length * 6
        + (location.contiguous ? 4 : 0)
        + rarity;
      matches.push({
        ...location,
        score,
        phrase: phrase.text,
        phraseTokens: phrase.tokens,
        segment
      });
    }
  }
  if (!matches.length) return null;
  matches.sort((left, right) => right.score - left.score
    || right.phraseTokens.length - left.phraseTokens.length
    || left.segment.key.localeCompare(right.segment.key)
    || left.phrase.localeCompare(right.phrase));
  const best = matches[0];
  const evidenceKeys = new Set(matches.map((match) => match.segment.key));
  const specificity = Math.max(...matches.map((match) => match.phraseTokens.length))
    + (BROAD_CONCEPT_IDS.has(concept.id) ? 0 : 1);
  return {
    concept,
    matches,
    best,
    specificity,
    score: best.score + Math.min(8, Math.max(0, evidenceKeys.size - 1) * 2)
  };
}

function related(left, right) {
  return (left.related || []).includes(right.id)
    || (right.related || []).includes(left.id)
    || KNOWN_BROAD_ANCESTORS[left.id]?.has(right.id)
    || KNOWN_BROAD_ANCESTORS[right.id]?.has(left.id);
}

function sameEvidence(left, right) {
  const rightKeys = new Set(right.matches.map((match) => match.segment.key));
  return left.matches.some((match) => rightKeys.has(match.segment.key));
}

function suppressBroadAncestors(candidates) {
  return candidates.filter((candidate) => !candidates.some((other) => {
    if (other === candidate || !related(candidate.concept, other.concept) || !sameEvidence(candidate, other)) return false;
    const candidateBroad = BROAD_CONCEPT_IDS.has(candidate.concept.id);
    const otherBroad = BROAD_CONCEPT_IDS.has(other.concept.id);
    if (candidateBroad !== otherBroad) return candidateBroad;
    return other.specificity > candidate.specificity
      || (other.specificity === candidate.specificity && other.score > candidate.score);
  }));
}

function evidenceSnippet(match) {
  const localText = match.segment.kind === "source" && match.segment.sourceQuote
    ? match.segment.sourceQuote
    : match.segment.text;
  const tokens = localText.split(/\s+/);
  if (tokens.length <= 16) return usableRelevanceSourceExcerpt(localText) ? localText : cleanText(match.phrase);
  const phrase = cleanText(match.phrase);
  const at = localText.toLowerCase().indexOf(phrase.toLowerCase());
  let snippet = "";
  if (at >= 0) {
    const before = localText.slice(0, at).trim().split(/\s+/).filter(Boolean).slice(-6);
    const after = localText.slice(at + phrase.length).trim().split(/\s+/).filter(Boolean).slice(0, 8);
    snippet = [...before, phrase, ...after].join(" ");
  } else if (match.segment.kind === "source" && match.segment.sourceQuote) {
    snippet = tokens.slice(0, 18).join(" ");
  } else {
    snippet = tokens.slice(Math.max(0, match.start - 5), Math.min(tokens.length, match.end + 7)).join(" ");
  }
  // The complete anchored quote can be valid while a fixed-width window cuts
  // off the opening half of a parenthetical or equation.  Never expose that
  // newly-created fragment as evidence; the matched literal phrase is the
  // conservative, still-source-grounded fallback.
  return usableRelevanceSourceExcerpt(snippet) ? snippet : phrase;
}

function refsFor(candidate, kind) {
  return distinct(candidate.matches.filter((match) => match.segment.kind === kind).map((match) => match.segment.index)).sort((left, right) => left - right);
}

function hasPositiveLocalOverlap(value, anchors) {
  const wanted = new Set(relevanceTokens(value));
  if (!wanted.size) return false;
  return relevanceTokens(anchors.filter(Boolean).join(" ")).some((token) => wanted.has(token));
}

function applicableConditionRefs(input, anchors, explicitRefs = []) {
  const explicit = new Set(explicitRefs);
  if (explicit.size) return [...explicit].sort((left, right) => left - right);
  return values(input.conditions).flatMap((condition, index) => (
    hasPositiveLocalOverlap(condition, anchors) ? [index] : []
  ));
}

function bindingFor(candidate, role, input = {}) {
  const matchedConditionRefs = refsFor(candidate, "condition");
  const symbolRefs = refsFor(candidate, "symbol");
  const sourceIndexes = distinct(candidate.matches
    .filter(usableSourceMatch)
    .map((match) => match.segment.index))
    .sort((left, right) => left - right);
  const sourceEvidence = candidate.matches
    .filter(usableSourceMatch)
    .sort((left, right) => right.score - left.score || left.segment.key.localeCompare(right.segment.key))[0];
  const conditionRefs = applicableConditionRefs(input, [
    input.title,
    input.text,
    candidate.concept.label,
    ...(candidate.concept.aliases || []),
    ...candidate.matches.filter(usableSourceMatch).flatMap((match) => [match.segment.sourceSection, match.segment.sourceQuote])
  ], matchedConditionRefs);
  const context = ROLE_BINDING_CONTEXT[cleanText(role).toLowerCase()] || "component specification";
  const matchedPhrase = cleanText(sourceEvidence?.phrase || candidate.best.phrase);
  const label = cleanText(candidate.concept.label);
  const phraseDetail = relevanceTokens(matchedPhrase).join(" ") === relevanceTokens(label).join(" ")
    ? ""
    : ` as “${matchedPhrase}”`;
  const binding = {
    conceptId: candidate.concept.id,
    status: "modeled",
    representation: `In the ${context}, the source expresses ${label}${phraseDetail}: “${evidenceSnippet(sourceEvidence)}”.`,
    conditionRefs,
    sourceRefs: sourceIndexes.map((index) => ({ scope: "component", index })),
    reviewStatus: AUTOMATED_REVIEW_STATUS
  };
  if (symbolRefs.length) binding.symbolRefs = symbolRefs;
  return binding;
}

function unknownConcept(role, concepts) {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  for (const id of ROLE_GROUNDED_CONCEPT_IDS[role] || []) if (byId.has(id)) return byId.get(id);
  return null;
}

function values(value) {
  return Array.isArray(value) ? value : [];
}

function roleGroundedBinding(concept, role, input) {
  const sources = values(input.sources);
  const sourceIndex = sources.findIndex((source) => sourceSupportsRole(role, source?.quote));
  if (sourceIndex < 0) return null;
  const conditionRefs = applicableConditionRefs(input, [
    input.title,
    input.text,
    sources[sourceIndex]?.section,
    sources[sourceIndex]?.quote
  ]);
  if (!conditionRefs.length) return null;
  const context = ROLE_BINDING_CONTEXT[role] || "component specification";
  const quote = cleanText(sources[sourceIndex]?.quote);
  const sourceMatch = {
    phrase: cleanText(concept.label),
    start: 0,
    end: 0,
    segment: { kind: "source", text: quote, sourceQuote: quote }
  };
  const binding = {
    conceptId: concept.id,
    status: "modeled",
    mappingBasis: "source-role-predicate",
    representation: `The component models ${cleanText(concept.label)} through this ${context}: “${evidenceSnippet(sourceMatch)}”.`,
    conditionRefs,
    sourceRefs: [{ scope: "component", index: sourceIndex }],
    reviewStatus: AUTOMATED_REVIEW_STATUS
  };
  return binding;
}

function unknownBinding(concept, role, options = {}) {
  const use = role ? ` for this ${role} component` : " in this component";
  return {
    conceptId: concept.id,
    status: "unknown",
    representation: options.backgroundOnly
      ? `The component-local mention of ${cleanText(concept.label)} appears only in background or unusable extracted text, so automated source mapping cannot establish how it is used${use}.`
      : `Automated source mapping found no component-local language that establishes how ${cleanText(concept.label)} is used${use}.`,
    conditionRefs: [],
    sourceRefs: [],
    reviewStatus: AUTOMATED_REVIEW_STATUS
  };
}

function rejectedSourceConcept(input, concepts) {
  const segments = evidenceSegments(input).filter((segment) => segment.kind === "source" && !segment.sourceUsable);
  if (!segments.length) return null;
  const frequencies = tokenDocumentFrequency(concepts);
  const candidates = concepts
    .map((concept) => conceptCandidate(concept, segments, frequencies, { allowUnusableSources: true }))
    .filter(Boolean);
  return suppressBroadAncestors(candidates).sort((left, right) => right.score - left.score
    || right.specificity - left.specificity
    || left.concept.id.localeCompare(right.concept.id))[0]?.concept || null;
}

export function scoreComponentConcepts(input) {
  const concepts = (input.conceptDefinitions || []).filter((concept) => concept?.id && concept?.label);
  const segments = evidenceSegments(input);
  const frequencies = tokenDocumentFrequency(concepts);
  // A generated binding is a claim about what the paper itself models.  Labels,
  // explanations, symbols, and conditions help rank that claim, but only a
  // component-local source anchor may establish it.  This prevents authoring
  // prose from becoming its own evidence and keeps unsupported matches explicit
  // as `unknown`.
  const supported = concepts
    .map((concept) => conceptCandidate(concept, segments, frequencies))
    .filter((candidate) => candidate?.matches.some(usableSourceMatch));
  return suppressBroadAncestors(supported).sort((left, right) => right.score - left.score
    || right.specificity - left.specificity
    || left.concept.id.localeCompare(right.concept.id));
}

export function mapComponentRelevance(input) {
  const concepts = (input.conceptDefinitions || []).filter((concept) => concept?.id && concept?.label);
  const maximum = Number.isInteger(input.maxConcepts)
    ? Math.max(0, Math.min(MAX_COMPONENT_CONCEPTS, input.maxConcepts))
    : MAX_COMPONENT_CONCEPTS;
  const selected = scoreComponentConcepts(input).slice(0, maximum);
  if (selected.length) {
    const selectedBindings = selected.map((candidate) => bindingFor(candidate, input.role, input));
    const role = cleanText(input.role).toLowerCase();
    // A merged component can contain two independently valid source facets.
    // A phrase match in the secondary facet (for example, a pricing decision)
    // must not leave the component's primary process rule unbound.  Add the
    // role-grounded concept only when none of the selected bindings cites a
    // literal source that supports the component role, and only while an
    // ordinary concept slot remains.  The existing role binding still
    // requires both a role predicate in that exact source and a local
    // condition reference, so this does not turn a role label into evidence.
    const selectedSupportsRole = selectedBindings.some((binding) =>
      values(binding.sourceRefs).some((reference) => reference?.scope === "component"
        && sourceSupportsRole(role, values(input.sources)[reference.index]?.quote)));
    const roleConcept = !selectedSupportsRole && selected.length < maximum
      ? unknownConcept(role, concepts)
      : null;
    const roleBinding = roleConcept
      && !selected.some((candidate) => candidate.concept.id === roleConcept.id)
      ? roleGroundedBinding(roleConcept, role, input)
      : null;
    const selectedConcepts = selected.map((candidate) => candidate.concept);
    const selectedEvidence = selected.map((candidate) => ({
      conceptId: candidate.concept.id,
      score: candidate.score,
      matchedPhrase: candidate.best.phrase,
      location: candidate.best.segment.key
    }));
    if (roleBinding) {
      selectedConcepts.push(roleConcept);
      selectedBindings.push(roleBinding);
      selectedEvidence.push({
        conceptId: roleConcept.id,
        score: 0,
        matchedPhrase: "",
        location: `source:${roleBinding.sourceRefs[0].index}`,
        mappingBasis: "source-role-predicate"
      });
    }
    return {
      concepts: selectedConcepts.map((concept) => concept.id),
      conceptBindings: selectedBindings,
      unresolved: null,
      evidence: selectedEvidence
    };
  }

  const role = cleanText(input.role).toLowerCase();
  const rejected = rejectedSourceConcept(input, concepts);
  const fallback = rejected || unknownConcept(role, concepts);
  const roleBinding = !rejected && fallback ? roleGroundedBinding(fallback, role, input) : null;
  if (roleBinding) {
    return {
      concepts: [fallback.id],
      conceptBindings: [roleBinding],
      unresolved: null,
      evidence: [{
        conceptId: fallback.id,
        score: 0,
        matchedPhrase: "",
        location: `source:${roleBinding.sourceRefs[0].index}`,
        mappingBasis: "source-role-predicate"
      }]
    };
  }
  return {
    concepts: [],
    conceptBindings: fallback ? [unknownBinding(fallback, role, { backgroundOnly: Boolean(rejected) })] : [],
    unresolved: {
      reason: rejected ? "no-clean-component-local-concept-support" : "no-component-local-concept-support",
      suggestedConceptId: fallback?.id || null
    },
    evidence: []
  };
}
