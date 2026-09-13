import {
  assessHeading,
  hasExtractionNoise,
  isBoilerplate,
  isCaption,
  isCitation,
  isTableRow,
  isWhitespaceNormalizedSubstring,
  literalSourceSentenceCandidates,
  meaningfulText,
  normalizeWhitespace,
  semanticFingerprint,
} from "./model-note-text-quality.mjs";

const REFERENCE_TAIL = /^(?:references|bibliography|works cited)$/i;
const MODEL_TERMS = /\b(?:model|formulation|framework|setting|environment|objective|decision|constraint|state|action|policy|algorithm|mechanism|equilibrium|optimal|optimization|program|demand|price|pricing|inventory|capacity|allocation|utility|cost|revenue|reward|risk|uncertaint|stochastic|dynamic|game|player|agent|arrival|choice|learning|estimat|regret|benchmark|extension|variant|process|transition|distribution)\w*\b/i;
const STRONG_MODEL_TERMS = /\b(?:model|formulation|objective|constraint|policy|algorithm|equilibrium|optimization|program|demand|pricing|inventory|capacity|allocation|utility|reward|stochastic|dynamic|transition)\w*\b/i;
const NEGATIVE_SECTION = /\b(?:introduction|literature review|related work|conclusions?|concluding (?:remarks?|discussions?)|references|bibliography|acknowledg|copyright)\b/i;
const SENTENCE_VERBS = /\b(?:is|are|was|were|be|been|being|has|have|had|do|does|did|can|may|might|will|would|shall|should|could|must|assume|assumes|suppose|supposes|consider|considers|choose|chooses|set|sets|maximize|maximizes|minimize|minimizes|arrive|arrives|follow|follows|depend|depends|denote|denotes|define|defines|solve|solves|yield|yields|present|presents|serve|serves|sustain|sustains|label|labels|start|starts|converge|converges|show|shows|find|finds|learn|learns|demonstrate|demonstrates)\b/i;
const TABLE_COLUMN_TERMS = /\b(?:price|demand|revenue|cost|profit|value|mean|median|standard|deviation|coefficient|estimate|variable|sample|observation|treatment|control)\b/gi;
const TABLE_BOOLEAN_ROW_END = /(?:\(|\b)(?:18|19|20)\d{2}[a-z]?\)?\s*[,;:]?\s+(?:yes|no)$/i;
const TABLE_HEADER_ROW = /^(?:choice\s+)?models?\s+literature\s+(?:satisf(?:y|ies)|supports?|uses?|meets?)\b/i;
const PROSE_FRAGMENT_START = /^(?:this|that|these|those|it)\s+(?:results?|leads?|causes?|implies?|shows?|suggests?|means?|follows?|creates?|provides?|allows?|requires?|increases?|decreases?)\b/i;
const DANGLING_PROSE_END = /\b(?:due|because|although|whereas|unless|while|when|which|that|with|without|of|to|for|and|or|by|from|in|under)\s*$/i;
const GENERIC_NEGATIVE_SECTION = /^(?:introduction\b.*|conclusions?\b.*|concluding\s*(?:remarks?|discussions?)\b.*|discussion\b.*|further\s*discussion\b.*|literature(?:\s*review)?\b.*|related\s*(?:work|literature)\b.*|summary\b.*|motivations?\b.*|managerial\s*(?:implications?|insights?)\b.*|acknowledg(?:e)?ments?\b.*)$/i;
const GENERIC_OVERVIEW_SECTION = /^(?:overview|paper overview|overview of the paper|our contributions?|research contributions?|contributions?|summary of contributions?)$/i;
const NON_MODEL_STUDY_SECTION = /^(?:(?:computational|numerical|empirical|simulation)\s+(?:stud(?:y|ies)|analys(?:is|es)|experiments?|experience|results?|examples?|illustrations?|insights?|evaluation|validation)\b|(?:real|synthetic)[ -]?data\s+(?:stud(?:y|ies)|analys(?:is|es)|experiments?|results?|evaluation|validation)\b|calibration\b|(?:data\s+(?:description|sources?)\s+and\s+)?model\s+calibration\b|model\s+recap\s+and\s+(?:an?\s+)?numerical\s+example\b|extensions?\s+and\s+(?:computational|numerical|empirical|simulation)\b)/i;
const MODEL_CONSTRUCTION_HEADING = /^(?:(?:defin(?:e|ing|itions?)|design(?:ing)?|construct(?:ing|ions?)?|formulat(?:e|ing|ions?))\b.{0,90}\b(?:models?|frameworks?|graphs?|hypergraphs?|random[-\s]+walks?|process(?:es)?|algorithms?|systems?|networks?)\b|random[-\s]+walks?\s+on\s+(?:hyper)?graphs?\b|(?:theory|model|mechanism|evidence|data)[-\s]+informed\b.{0,90}\bprocess(?:es)?\b)/i;
const MODEL_SIMULATION_HEADING = /^simulat(?:e|ing|ions?)\b.{0,90}\b(?:models?|frameworks?|graphs?|hypergraphs?|random[-\s]+walks?|process(?:es)?|algorithms?|systems?|networks?)\b/i;
const NON_CORE_MODEL_HEADING = /\b(?:results?|applications?|case stud(?:y|ies)|comparisons?|robustness|extensions?|variants?|benchmarks?|illustrations?)\b/i;
const STRUCTURAL_HEADING_START = /^(?:model|models|method|methods|methodology|setup|setting|framework|formulation|algorithm|algorithms|analysis|estimation|identification|equilibrium|solution|solutions|extension|extensions|benchmark|benchmarks|experiment|experiments|data|results?|robustness|notation|assumptions?|preliminaries|overview|contributions?)\b/i;
const CANONICAL_SHORT_HEADINGS = new Set([
  "model", "models", "method", "methods", "methodology", "setup", "setting", "framework", "formulation",
  "algorithm", "algorithms", "analysis", "estimation", "identification", "equilibrium", "solution", "solutions",
  "extension", "extensions", "benchmark", "benchmarks", "experiment", "experiments", "data", "result", "results",
  "robustness", "notation", "assumption", "assumptions", "preliminaries", "pricing", "demand", "inventory",
  "capacity", "allocation", "overview", "contribution", "contributions", "references", "bibliography", "appendix",
  "introduction", "conclusion", "conclusions", "discussion", "acknowledgments", "acknowledgements",
]);
const TITLE_CONNECTORS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "under", "via", "versus", "with", "without"]);

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "can", "do", "does", "for", "from", "had", "has", "have", "if", "in", "into", "is", "it", "its", "may", "of", "on", "or", "our", "that", "the", "their", "then", "this", "to", "under", "using", "was", "we", "were", "when", "where", "which", "with",
]);

function asPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages
    .map((entry, index) => ({
      page: Number.isFinite(Number(entry?.page)) ? Number(entry.page) : index + 1,
      text: String(entry?.text || ""),
    }))
    .filter((entry) => entry.text.trim())
    .sort((left, right) => left.page - right.page);
}

function rawLines(page) {
  return String(page.text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((raw, index) => ({ page: page.page, index, raw: raw.trim(), text: normalizeWhitespace(raw) }))
    .filter((line) => line.text);
}

function lexicalTokens(value) {
  return meaningfulText(value)
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g)?.map(stemToken)
    .filter((token) => token && !STOPWORDS.has(token)) || [];
}

function stemToken(token) {
  let result = token.replace(/^-+|-+$/g, "");
  if (result.length > 7 && result.endsWith("ization")) result = `${result.slice(0, -7)}ize`;
  else if (result.length > 6 && result.endsWith("ities")) result = `${result.slice(0, -5)}ity`;
  else if (result.length > 6 && result.endsWith("ation")) result = result.slice(0, -5);
  else if (result.length > 5 && result.endsWith("ing")) result = result.slice(0, -3);
  else if (result.length > 5 && result.endsWith("ies")) result = `${result.slice(0, -3)}y`;
  else if (result.length > 5 && result.endsWith("ed")) result = result.slice(0, -2);
  else if (result.length > 4 && result.endsWith("s") && !result.endsWith("ss")) result = result.slice(0, -1);
  return result;
}

function tokenSet(value) {
  return new Set(lexicalTokens(value));
}

function lexicalOverlap(value, focus) {
  const left = tokenSet(value);
  const right = tokenSet(focus);
  if (!left.size || !right.size) return { count: 0, ratio: 0, tokens: [] };
  const tokens = [...left].filter((token) => right.has(token));
  return { count: tokens.length, ratio: tokens.length / Math.max(1, Math.min(left.size, right.size)), tokens };
}

function jaccard(leftValue, rightValue) {
  const left = tokenSet(leftValue);
  const right = tokenSet(rightValue);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function repeatedMarginalLines(pages) {
  if (pages.length < 2) return new Set();
  const occurrences = new Map();
  for (const page of pages) {
    const lines = rawLines(page);
    const marginal = [...lines.slice(0, 3), ...lines.slice(-3)];
    for (const line of marginal) {
      if (line.text.length > 180) continue;
      if (/^\d+(?:\.\d+)*[.)]?\s+\p{L}/u.test(line.text)) continue;
      if (/[.!?;]$/.test(line.text) && !isBoilerplate(line.text)) continue;
      const key = meaningfulText(line.text).toLowerCase();
      if (!key) continue;
      if (!occurrences.has(key)) occurrences.set(key, new Set());
      occurrences.get(key).add(page.page);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.4));
  return new Set([...occurrences].filter(([, pageSet]) => pageSet.size >= threshold).map(([key]) => key));
}

function isNumberedProse(value) {
  const normalized = normalizeWhitespace(value);
  const match = normalized.match(/^\d+(?:\.\d+)*[.)]?\s+(.+)$/);
  if (!match) return false;
  const prose = match[1];
  const words = lexicalTokens(prose);
  if (words.length === 1 && /^(?:calculate|compute|initialize|let|repeat|return|sample|update)$/i.test(prose)) return true;
  if (/[.!?;]$/.test(prose)) return true;
  if (words.length >= 4 && SENTENCE_VERBS.test(prose)) return true;
  return /^(?:we|the (?:firm|seller|platform|consumer|customer)|customers?|consumers?|suppose|assume|let|if|when|because|then|first|second|for (?:example|instance)|furthermore|more precisely|in particular|instead of)\b/i.test(prose) && words.length >= 3;
}

function hasRepeatedHeadingPhrase(value) {
  const tokens = normalizeWhitespace(value).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.length < 4) return false;
  for (let width = 1; width <= Math.floor(tokens.length / 2); width += 1) {
    if (tokens.length % width !== 0) continue;
    const repetitions = tokens.length / width;
    if (repetitions < 2 || (width === 1 && repetitions < 3)) continue;
    if (tokens.every((token, index) => token === tokens[index % width])) return true;
  }
  return false;
}

function isProseFragmentHeading(value) {
  const normalized = normalizeWhitespace(value);
  const wordCount = normalized.match(/[\p{L}\p{N}]+/gu)?.length || 0;
  if (wordCount < 4) return false;
  if (PROSE_FRAGMENT_START.test(normalized) && DANGLING_PROSE_END.test(normalized)) return true;
  return /\b(?:we|this paper|the paper)\s+(?:now|next|then)\s+(?:extend|show|derive|consider|analy[sz]e|compare|discuss|turn)\b/i.test(normalized);
}

function isBooleanTableOrBibliographyRow(value) {
  const text = normalizeWhitespace(value);
  return TABLE_BOOLEAN_ROW_END.test(text) || TABLE_HEADER_ROW.test(text);
}

function repairHeadingExtraction(value) {
  return normalizeWhitespace(value)
    .replace(/\s+([’'])s\b/gu, "$1s")
    .replace(/\bPro\s+fit\b/gu, "Profit")
    .replace(/\bAf\s+fine\b/gu, "Affine")
    .replace(/\bDe\s+finition\b/gu, "Definition")
    .replace(/\bSuf\s+ficient\b/gu, "Sufficient")
    .replace(/\bIndivi\s+duals\b/gu, "Individuals")
    .replace(/\bMar\s+ket\b/gu, "Market");
}

function isLowercaseNumberedFragment(title) {
  if (/^(?:e-commerce|e-business|m-commerce)\b/i.test(title)) return false;
  return /^\p{Ll}[\p{Ll}'’\-]*(?:\s|$)/u.test(title);
}

function isPublisherRunningHeader(value) {
  const normalized = normalizeWhitespace(value);
  const journal = /\b(?:information systems research|management science|operations research|marketing science|manufacturing\s*&\s*service operations management|production and operations management)\b/i.test(normalized);
  const volumeIssue = /\b\d{1,3}\s*\(\d{1,3}\)\s*,?/.test(normalized);
  const pageRange = /\bpp?\.?\s*\d{1,4}\s*[\-–—]\s*\d{1,4}\b/i.test(normalized);
  const copyright = /(?:©|\bcopyright\b|\u00a9)/i.test(normalized);
  const publisher = /\b(?:informs|elsevier|springer|wiley|sage)\b/i.test(normalized);
  return (journal && (volumeIssue || pageRange || copyright || publisher))
    || (volumeIssue && pageRange && (publisher || /\s\d{1,4}$/.test(normalized)))
    || (copyright && publisher);
}

function isJunkSentenceFragment(value) {
  const normalized = normalizeWhitespace(value);
  const enumerated = normalized.match(/^\(?([ivxlcdm]+|[a-z])\)[.)]?\s+(.+)$/i);
  if (enumerated && (/^\p{Ll}/u.test(enumerated[2]) || /[.!?,;:]$/.test(enumerated[2]))) return true;
  if (/\.\s+(?:for example|for instance|specifically|that is),?$/i.test(normalized)) return true;
  if (/^(?:in|under|within|when|if|because|although|while)\b/i.test(normalized)
    && /\b(?:can|may|might|will|would|should|could|must|to|and|or|of|for|with|by|under)\s*[,;:]?$/i.test(normalized)) return true;
  return false;
}

function hasBalancedDelimiters(value) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const character of value) {
    if (character === "(" || character === "[" || character === "{") stack.push(character);
    else if (pairs[character] && stack.pop() !== pairs[character]) return false;
  }
  return stack.length === 0;
}

function hasInternalSentencePunctuation(value) {
  const scrubbed = value
    .replace(/\b(?:i\.e|e\.g|u\.s|u\.k|vs)\./gi, "")
    .replace(/\b\d+\.\d+\b/g, "");
  return /[.!?]\s+\S/.test(scrubbed);
}

function looksLikeAuthorByline(value) {
  if (MODEL_TERMS.test(value)) return false;
  const people = value.split(/\s*,\s*|\s+and\s+/i).filter(Boolean);
  if (people.length === 1) {
    const tokens = people[0].trim().split(/\s+/).filter(Boolean);
    return tokens.length >= 2 && tokens.length <= 4
      && tokens.every((token) => /^(?:[\p{Lu}][\p{Ll}'’\-]+|[\p{Lu}]\.)$/u.test(token));
  }
  return people.every((person) => {
    const tokens = person.trim().split(/\s+/).filter(Boolean);
    return tokens.length >= 2 && tokens.length <= 4
      && tokens.every((token) => /^(?:[\p{Lu}][\p{L}'’\-]+|[\p{Lu}]\.)$/u.test(token));
  });
}

function isTitleCaseHeading(value) {
  const scrubbed = value.replace(/\b(?:i\.e|e\.g)\.,?/gi, " ");
  const words = scrubbed.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
  if (!words.length) return false;
  let significant = 0;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const lower = word.toLocaleLowerCase();
    if (index > 0 && TITLE_CONNECTORS.has(lower)) continue;
    significant += 1;
    if (!/^(?:\p{Lu}|\d|\p{Ll}{1,2}\p{Lu})/u.test(word)) return false;
  }
  return significant > 0;
}

function isCanonicalHeadingPhrase(value) {
  const lower = meaningfulText(value).toLocaleLowerCase();
  if (CANONICAL_SHORT_HEADINGS.has(lower)) return true;
  return STRUCTURAL_HEADING_START.test(value)
    && lexicalTokens(value).length <= 7
    && !SENTENCE_VERBS.test(value)
    && isTitleCaseHeading(value);
}

function isGenericNegativeSection(title) {
  return GENERIC_NEGATIVE_SECTION.test(normalizeWhitespace(title).replace(/[.:;]+$/, ""));
}

function isGenericOverviewSection(title) {
  return GENERIC_OVERVIEW_SECTION.test(normalizeWhitespace(title).replace(/[.:;]+$/, ""));
}

function isNegativeLineage(section) {
  return isGenericNegativeSection(section.title)
    || (section.ancestorTitles || []).some((title) => isGenericNegativeSection(title));
}

function isPaperTitleFragment(section, record) {
  if (section.number || section.page > 2) return false;
  const title = meaningfulText(record?.title).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const candidate = meaningfulText(section.title).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const overlap = lexicalOverlap(candidate, title);
  return candidate.length >= 18 && (title.includes(candidate) || (overlap.count >= 4 && overlap.ratio >= 0.78));
}

function headingAssessment(value, continuation = "") {
  const normalized = normalizeWhitespace(value);
  const parenthesizedNumber = normalized.match(/^\((\d+(?:\.\d+)*)\)\s+(.+)$/);
  const bareNumber = normalized.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/);
  const number = parenthesizedNumber?.[1] || bareNumber?.[1] || "";
  const title = repairHeadingExtraction(parenthesizedNumber?.[2] || bareNumber?.[2] || normalized);
  if (!normalized || /^\p{L}$/u.test(normalized) || isPublisherRunningHeader(normalized) || isJunkSentenceFragment(normalized) || isNumberedProse(normalized)) return { accepted: false };
  if (hasRepeatedHeadingPhrase(title) || isProseFragmentHeading(title) || isBooleanTableOrBibliographyRow(title)) return { accepted: false };
  if (number === "0" || /^(?:18|19|20)\d{2}$/.test(number)) return { accepted: false };
  if (number && isLowercaseNumberedFragment(title)) return { accepted: false };
  if (number && /^[A-Za-z]{1,3}\d+$/u.test(title)) return { accepted: false };
  if (/^[,.;:!?<>≤≥=∑∏]/u.test(title) || /(?:^|\s)[∇∑∏<>≤≥=]$/u.test(title)) return { accepted: false };
  if ((/^[([{]/.test(normalized) && !parenthesizedNumber) || !hasBalancedDelimiters(title)) return { accepted: false };
  if (/,$/.test(title) || /[.!?;]$/.test(title) || hasInternalSentencePunctuation(title) || (!number && looksLikeAuthorByline(title))) return { accepted: false };
  if (number && lexicalTokens(title).length === 1 && /^\p{Ll}/u.test(normalizeWhitespace(continuation)) && SENTENCE_VERBS.test(`${title} ${continuation}`)) return { accepted: false };
  if (!number) {
    const words = title.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
    if (words.length === 1 && !isCanonicalHeadingPhrase(title)) return { accepted: false };
    if (!isCanonicalHeadingPhrase(title) && !isTitleCaseHeading(title)) return { accepted: false };
    if (!isCanonicalHeadingPhrase(title) && !MODEL_TERMS.test(title)) return { accepted: false };
  }
  const headingValue = number ? `${number}. ${title}` : title;
  const assessed = assessHeading(headingValue, continuation);
  if (!assessed.accepted) return assessed;
  const assessedTitle = repairHeadingExtraction(assessed.title);
  const assessedWords = assessedTitle.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
  if (assessedWords.length > 14 || hasInternalSentencePunctuation(assessedTitle) || /^[,.;:!?<>≤≥=∑∏]/u.test(assessedTitle)) return { accepted: false };
  if (assessed.number && (isLowercaseNumberedFragment(assessedTitle) || isNumberedProse(`${assessed.number}. ${assessedTitle}`))) return { accepted: false };
  return { ...assessed, title: assessedTitle };
}

function isCleanBodyLine(value, repeatedLines = new Set(), rawValue = value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized || normalized.length < 4) return false;
  if (repeatedLines.has(meaningfulText(normalized).toLowerCase())) return false;
  if (isPublisherRunningHeader(normalized) || isJunkSentenceFragment(normalized)) return false;
  if (hasExtractionNoise(normalized) || isBoilerplate(normalized) || isCaption(normalized) || isCitation(normalized) || isTableRow(rawValue)) return false;
  const columnHits = normalized.match(TABLE_COLUMN_TERMS)?.length || 0;
  if (!/[.!?;:]$/.test(normalized) && lexicalTokens(normalized).length <= 7 && columnHits >= 3 && !SENTENCE_VERBS.test(normalized)) return false;
  if (/^[\p{L}'’\-]+,\s*(?:[A-Z]\.?\s*)+\(?(?:19|20)\d{2}\)?[.,]/u.test(normalized)) return false;
  if (/^\s*(?:page\s+)?\d+\s*$/i.test(normalized)) return false;
  return true;
}

function substantiveBody(lines, title = "") {
  const text = lines.map((line) => line.text).join(" ");
  const tokens = lexicalTokens(text);
  if (tokens.length < 14 || text.length < 80) return false;
  const sentenceLike = literalSourceSentenceCandidates(text, { minWords: 8, maxWords: 100 }).length > 0;
  if (!sentenceLike) return false;
  return MODEL_TERMS.test(`${title} ${text}`) && (STRONG_MODEL_TERMS.test(text) || MODEL_TERMS.test(title));
}

function isDirectNumberedChild(childNumber, parentNumber) {
  const childParts = String(childNumber || "").split(".").filter(Boolean);
  const parentParts = String(parentNumber || "").split(".").filter(Boolean);
  return childParts.length === parentParts.length + 1
    && parentParts.every((part, index) => childParts[index] === part);
}

function substantiveParentPrelude(lines, title = "") {
  const text = lines.map((line) => line.text).join(" ");
  const tokens = lexicalTokens(text);
  if (tokens.length < 4 || text.length < 40) return false;
  const sentenceLike = literalSourceSentenceCandidates(text, { minWords: 8, maxWords: 100 }).length > 0;
  if (!sentenceLike) return false;
  return MODEL_TERMS.test(`${title} ${text}`) && (STRONG_MODEL_TERMS.test(text) || MODEL_TERMS.test(title));
}

function literalParentPreludeLines(lines = []) {
  const byPage = new Map();
  for (const line of lines) {
    if (!Number.isFinite(Number(line?.page)) || !line?.text) continue;
    const page = Number(line.page);
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(line.text);
  }
  return [...byPage].flatMap(([page, pageLines]) => literalSourceSentenceCandidates(
    pageLines.join(" "),
    { minWords: 8, maxWords: 100 },
  )
    .filter((sentence) => isCleanBodyLine(sentence))
    .map((text) => ({ page, text })));
}

function sectionStrength(section) {
  const headingHits = (section.title.match(new RegExp(MODEL_TERMS.source, "gi")) || []).length;
  const bodyHits = (section.text.match(new RegExp(MODEL_TERMS.source, "gi")) || []).length;
  const strongHits = (section.text.match(new RegExp(STRONG_MODEL_TERMS.source, "gi")) || []).length;
  return headingHits * 8 + Math.min(bodyHits, 10) * 2 + Math.min(strongHits, 8) + Math.min(lexicalTokens(section.text).length / 30, 4);
}

function sectionIdentity(section) {
  return semanticFingerprint({ role: "model section", label: section.title, explanation: section.text.slice(0, 500) });
}

function semanticallySameSection(left, right) {
  if (sectionIdentity(left) === sectionIdentity(right)) return true;
  const headingSimilarity = jaccard(left.title, right.title);
  if (headingSimilarity < 0.8) return false;
  return jaccard(left.text.slice(0, 600), right.text.slice(0, 600)) >= 0.55;
}

function dedupeSections(sections) {
  const result = [];
  for (const section of sections) {
    const duplicateIndex = result.findIndex((entry) => semanticallySameSection(entry, section));
    if (duplicateIndex < 0) {
      result.push(section);
      continue;
    }
    if (sectionStrength(section) > sectionStrength(result[duplicateIndex])) result[duplicateIndex] = section;
  }
  return result.sort((left, right) => left.page - right.page || left.title.localeCompare(right.title));
}

function finalizeSection(section, output, nextHeading = null) {
  if (!section?.sourceLines?.length && !section?.lines?.length) return;
  const directChildConfirmsParent = section.number
    && isDirectNumberedChild(nextHeading?.number, section.number);
  let retainedLines = section.lines || [];
  if (!substantiveBody(retainedLines, section.title)) {
    if (!directChildConfirmsParent) return;
    retainedLines = literalParentPreludeLines(section.sourceLines || retainedLines);
    if (!substantiveParentPrelude(retainedLines, section.title)) return;
  }
  const lastLine = retainedLines.at(-1);
  output.push({
    number: section.number || "",
    title: section.title,
    page: section.page,
    endPage: lastLine?.page || section.page,
    lines: retainedLines.map((line) => ({ page: line.page, text: line.text })),
    text: retainedLines.map((line) => line.text).join(" "),
    // Keep the exact heading-bounded extraction span separately from the
    // cleaned modeling prose. It lets authoring recover a clean literal
    // sentence that was surrounded by broken PDF lines, without ever turning
    // those broken lines into a repaired public quotation.
    sourceLines: (section.sourceLines || section.lines).map((line) => ({ page: line.page, text: line.text })),
    sourceText: (section.sourceLines || section.lines).map((line) => line.text).join(" "),
    synthetic: false,
    ancestorTitles: section.ancestorTitles || [],
  });
}

/**
 * Extract clean, substantive, model-bearing PDF sections.
 * References/Bibliography is a sticky tail: no later apparent heading is revived.
 */
export function extractCleanSections(inputPages) {
  const pages = asPages(inputPages);
  const repeatedLines = repeatedMarginalLines(pages);
  const output = [];
  let current = null;
  let inReferenceTail = false;
  const numberedTitles = new Map();
  let activeLineage = [];

  for (const page of pages) {
    if (inReferenceTail) break;
    const lines = rawLines(page);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (repeatedLines.has(meaningfulText(line.text).toLowerCase())) continue;

      const next = lines[index + 1];
      const continuation = next && next.page === line.page ? next.raw : "";
      const heading = headingAssessment(line.raw, continuation);

      if (heading.accepted) {
        if (REFERENCE_TAIL.test(heading.title || "")) {
          finalizeSection(current, output);
          current = null;
          inReferenceTail = true;
          break;
        }
        if (heading.reason === "excluded-section") {
          finalizeSection(current, output);
          current = null;
          continue;
        }

        finalizeSection(current, output, heading);
        let ancestorTitles = [...activeLineage];
        if (heading.number) {
          const parts = heading.number.split(".");
          ancestorTitles = [];
          for (let level = 1; level < parts.length; level += 1) {
            const parentTitle = numberedTitles.get(parts.slice(0, level).join("."));
            if (parentTitle) ancestorTitles.push(parentTitle);
          }
          numberedTitles.set(heading.number, heading.title);
          activeLineage = [...ancestorTitles, heading.title];
        }
        current = {
          number: heading.number || "",
          title: normalizeWhitespace(heading.title),
          page: page.page,
          lines: [],
          sourceLines: [],
          ancestorTitles,
        };
        if (heading.consumedContinuation) index += 1;
        continue;
      }

      if (current) {
        current.sourceLines.push({ page: page.page, text: line.text });
        if (isCleanBodyLine(line.text, repeatedLines, line.raw)) {
          current.lines.push({ page: page.page, text: line.text });
        }
      }
    }
  }

  if (!inReferenceTail) finalizeSection(current, output);
  return dedupeSections(output);
}

function recordFocus(record = {}) {
  return [
    record.title,
    record.field,
    record.topics,
    record.topic_details,
    record.topicDetails,
    record.keywords,
    record.model_topic,
    record.modelTopic,
    record.business_question,
    record.businessQuestion,
    record.research_focus,
    record.researchFocus,
    record.method,
    record.mechanism,
    record.modeling_evidence,
    record.modelingEvidence,
    record.review_note,
    record.reviewNote,
    record.abstract,
  ].filter(Boolean).join(" ");
}

function evidencePages(record = {}) {
  const source = [record.modeling_evidence, record.modelingEvidence, record.review_note, record.reviewNote]
    .filter(Boolean)
    .join(" ");
  const pages = new Set();
  for (const match of source.matchAll(/\b(?:pdf\s*)?p(?:age)?\.?\s*(\d{1,4})\b/gi)) pages.add(Number(match[1]));
  return pages;
}

function isHighConfidenceModelConstructionHeading(title) {
  const value = normalizeWhitespace(title);
  return Boolean(value)
    && !NON_CORE_MODEL_HEADING.test(value)
    && (MODEL_CONSTRUCTION_HEADING.test(value) || MODEL_SIMULATION_HEADING.test(value));
}

function classifySection(section) {
  const title = section.title || "";
  const value = `${section.title} ${section.text.slice(0, 600)}`;
  if (MODEL_SIMULATION_HEADING.test(title) && !NON_CORE_MODEL_HEADING.test(title)) return "solution";
  if (isHighConfidenceModelConstructionHeading(title)) return "mechanics";
  if (/\b(?:extension|variant|benchmark|comparison|alternative|first[ -]best)\b/i.test(value)) return "variant";
  if (/\b(?:algorithm|policy|solution|estimat|learning|procedure|method)\w*\b/i.test(value)) return "solution";
  if (/\b(?:result|theorem|proposition|performance|bound|regret)\w*\b/i.test(value)) return "result";
  if (/\b(?:objective|constraint|formulation|program|equilibrium|utility|reward|process(?:es)?|transition|dynamic)\w*\b/i.test(value)) return "mechanics";
  return "setting";
}

function modelSectionScore(section, focus, anchors) {
  const overlap = lexicalOverlap(`${section.title} ${section.text}`, focus);
  const lineage = (section.ancestorTitles || []).join(" ");
  let score = sectionStrength(section) + overlap.count * 3 + overlap.ratio * 4;
  if (/\b(?:model|formulation|problem setting|framework|method|algorithm|equilibrium)\b/i.test(section.title)) score += 10;
  if (/\b(?:model|formulation|problem setting|framework|method|algorithm)\b/i.test(lineage)) score += 18;
  if (/\b(?:results?|numerical analysis|case study|application|discussion|conclusions?)\b/i.test(lineage)) score -= 16;
  if (/^(?:results?|numerical analysis|case study|application|comparison|illustration)\b/i.test(section.title)) score -= 10;
  if (NON_MODEL_STUDY_SECTION.test(section.title) || NON_MODEL_STUDY_SECTION.test(lineage)) score -= 24;
  if (NEGATIVE_SECTION.test(section.title)) score -= 18;
  for (let page = section.page; page <= section.endPage; page += 1) if (anchors.has(page)) score += 15;
  return score;
}

function modelSectionTier(section) {
  const title = section.title || "";
  const lineage = (section.ancestorTitles || []).join(" ");
  if (NON_MODEL_STUDY_SECTION.test(title) || NON_MODEL_STUDY_SECTION.test(lineage)) return 0;
  const mechanics = /\b(?:models?|formulations?|problems?|settings?|setups?|frameworks?|environments?|elements?|inputs?|parameters?|outputs?|objectives?|constraints?|decisions?|states?|dynamics?|process(?:es)?|transitions?|information|assumptions?|mechanisms?|equilibria|equilibrium|algorithms?|methods?|optimization|programs?|polic(?:y|ies)|payments?|efforts?|costs?|utilities?)\b/i;
  const resultLineage = /\b(?:results?|numerical (?:analysis|experiments?)|experiments?|case study|application|discussion|conclusions?)\b/i.test(lineage)
    || /^(?:results?|numerical (?:analysis|experiments?)|experiments?(?:\s+setup)?|case stud(?:y|ies)|applications?|comparisons?|illustrations?|coverage analysis)\b/i.test(title);
  if (resultLineage) {
    if (/\b(?:results?|numerical analysis|case stud(?:y|ies)|applications?|comparisons?|illustrations?|robustness|performance|outcomes?|findings?)\b/i.test(title)) return 0;
    return mechanics.test(title) ? 2 : 0;
  }
  if (isHighConfidenceModelConstructionHeading(title)) return 3;
  if (/\b(?:model|formulation|problem setting|setup|framework|environment)\b/i.test(`${title} ${lineage}`)) return 3;
  if (mechanics.test(title)) return 2;
  return 1;
}

function distinctSections(sections, maxSections) {
  const selected = [];
  const categories = new Set();
  const remaining = [...sections];
  while (remaining.length && selected.length < maxSections) {
    const highestTier = Math.max(...remaining.map((section) => Number(section.selectionTier) || 0));
    const eligible = remaining.filter((section) => (Number(section.selectionTier) || 0) === highestTier)
      .filter((section) => !selected.some((entry) => semanticallySameSection(entry, section) || jaccard(entry.title, section.title) >= 0.9));
    if (!eligible.length) {
      remaining.splice(0, remaining.length, ...remaining.filter((section) => (Number(section.selectionTier) || 0) < highestTier));
      continue;
    }
    eligible.sort((left, right) => {
      const leftNovel = Number(!categories.has(classifySection(left)));
      const rightNovel = Number(!categories.has(classifySection(right)));
      return rightNovel - leftNovel || right.score - left.score || left.page - right.page || left.title.localeCompare(right.title);
    });
    const section = eligible[0];
    const index = remaining.indexOf(section);
    if (index >= 0) remaining.splice(index, 1);
    selected.push(section);
    categories.add(classifySection(section));
  }
  return selected;
}

function isModelSentence(sentence) {
  const tokens = lexicalTokens(sentence);
  return tokens.length >= 8
    && sentence.length >= 55
    && MODEL_TERMS.test(sentence)
    && (STRONG_MODEL_TERMS.test(sentence) || SENTENCE_VERBS.test(sentence));
}

function fallbackLabel(sentence, page) {
  const labels = [
    [/\bpric\w*\b/i, "Pricing model evidence"],
    [/\binventor\w*\b/i, "Inventory model evidence"],
    [/\bcapacit\w*\b/i, "Capacity model evidence"],
    [/\bdemand\w*\b/i, "Demand model evidence"],
    [/\b(?:policy|algorithm|learning)\w*\b/i, "Policy and algorithm evidence"],
    [/\b(?:objective|constraint|optimization|program)\w*\b/i, "Optimization model evidence"],
    [/\b(?:equilibrium|game|player)\w*\b/i, "Game model evidence"],
  ];
  return labels.find(([pattern]) => pattern.test(sentence))?.[1] || `Model evidence on page ${page}`;
}

function fallbackCandidates(pages, focus, excludedPages = new Set()) {
  const candidates = [];
  for (const page of pages) {
    if (excludedPages.has(page.page)) continue;
    for (const sentence of literalSourceSentenceCandidates(page.text, { minWords: 8, maxWords: 52 })) {
      if (!isModelSentence(sentence)) continue;
      const overlap = lexicalOverlap(sentence, focus);
      if (overlap.count === 0) continue;
      candidates.push({
        page: page.page,
        sentence,
        overlap,
        score: overlap.count * 10 + overlap.ratio * 5 + (STRONG_MODEL_TERMS.test(sentence) ? 4 : 0),
      });
    }
  }
  return candidates.sort((left, right) => {
    const firstPagePenalty = Number(left.page === 1) - Number(right.page === 1);
    return firstPagePenalty || right.score - left.score || left.page - right.page || left.sentence.localeCompare(right.sentence);
  });
}

function appendFallbackSections(selected, pages, focus, targetCount, maxSections, excludedPages = new Set()) {
  const usedPages = new Set(selected.flatMap((section) => {
    const values = [];
    for (let page = section.page; page <= section.endPage; page += 1) values.push(page);
    return values;
  }));
  const signatures = new Set(selected.map(sectionIdentity));

  for (const candidate of fallbackCandidates(pages, focus, excludedPages)) {
    if (selected.length >= targetCount || selected.length >= maxSections) break;
    if (usedPages.has(candidate.page)) continue;
    const section = {
      number: "",
      title: fallbackLabel(candidate.sentence, candidate.page),
      page: candidate.page,
      endPage: candidate.page,
      lines: [{ page: candidate.page, text: candidate.sentence }],
      text: candidate.sentence,
      sourceSentence: candidate.sentence,
      synthetic: true,
      fallback: true,
      score: candidate.score,
    };
    const signature = sectionIdentity(section);
    if (signatures.has(signature) || selected.some((entry) => jaccard(entry.text, section.text) >= 0.72)) continue;
    selected.push(section);
    usedPages.add(candidate.page);
    signatures.add(signature);
  }
  return selected;
}

/** Select up to maxSections distinct, source-grounded model sections. */
export function selectModelSections(inputPages, record = {}, options = {}) {
  const pages = asPages(inputPages);
  const maxSections = Math.max(1, Math.floor(Number(options.maxSections) || 5));
  const minSections = Math.min(maxSections, Math.max(0, Math.floor(Number(options.minSections) || 3)));
  const focus = recordFocus(record);
  const anchors = evidencePages(record);
  const extracted = extractCleanSections(pages);
  const hardExcluded = extracted.filter((section) => isNegativeLineage(section));
  const genericOverview = extracted.filter((section) => !isNegativeLineage(section) && isGenericOverviewSection(section.title));
  const excludedPages = new Set([...hardExcluded, ...genericOverview]
    .flatMap((section) => {
      const sectionPages = [];
      for (let page = section.page; page <= section.endPage; page += 1) sectionPages.push(page);
      return sectionPages;
    }));
  const scored = extracted
    .filter((section) => !isNegativeLineage(section)
      && !isGenericOverviewSection(section.title)
      && !isPaperTitleFragment(section, record))
    .map((section) => ({ ...section, selectionTier: modelSectionTier(section), score: modelSectionScore(section, focus, anchors) }));
  for (const section of scored.filter((entry) => entry.selectionTier === 0)) {
    for (let page = section.page; page <= section.endPage; page += 1) excludedPages.add(page);
  }
  const ranked = scored
    .filter((section) => section.selectionTier > 0)
    .sort((left, right) => right.selectionTier - left.selectionTier || right.score - left.score || left.page - right.page || left.title.localeCompare(right.title));

  const selected = distinctSections(ranked, maxSections);
  appendFallbackSections(selected, pages, focus, minSections, maxSections, excludedPages);
  if (!selected.length && genericOverview.length) {
    const rankedOverview = genericOverview
      .map((section) => ({ ...section, score: modelSectionScore(section, focus, anchors) }))
      .sort((left, right) => right.score - left.score || left.page - right.page || left.title.localeCompare(right.title));
    selected.push(...distinctSections(rankedOverview, maxSections));
  }
  return selected.slice(0, maxSections);
}

/**
 * Choose a sentence from the section's own page range. Returns null when no
 * literal sentence has positive lexical overlap with focus.
 */
export function selectSectionSource(inputPages, section, focus) {
  const pages = asPages(inputPages);
  const startPage = Number(section?.page);
  const endPage = Number(section?.endPage ?? section?.page);
  const normalizedFocus = normalizeWhitespace(focus);
  const sectionText = normalizeWhitespace(section?.sourceText
    || (Array.isArray(section?.sourceLines) ? section.sourceLines.map((line) => line?.text || "").join(" ") : "")
    || section?.text
    || (Array.isArray(section?.lines) ? section.lines.map((line) => line?.text || "").join(" ") : ""));
  if (!Number.isFinite(startPage) || !Number.isFinite(endPage) || !sectionText || !lexicalTokens(normalizedFocus).length) return null;

  const candidates = [];
  for (const page of pages) {
    if (page.page < startPage || page.page > endPage) continue;
    const literalCandidates = literalSourceSentenceCandidates(page.text, { minWords: 6, maxWords: 60 });
    for (const rawQuote of literalCandidates) {
      // PDF text extraction often joins a section heading to the first prose
      // sentence on the page. The section body intentionally excludes that
      // heading, so the untrimmed candidate cannot pass the section-bounded
      // substring check. Recover only the suffix following this section's
      // exact title. This remains literal page text and cannot expose prose
      // from an adjacent same-page section.
      const normalizedTitle = normalizeWhitespace(section?.title || "");
      const headingPrefix = normalizedTitle && rawQuote.startsWith(`${normalizedTitle} `)
        ? `${normalizedTitle} `
        : "";
      const quote = headingPrefix ? rawQuote.slice(headingPrefix.length).trim() : rawQuote;
      const overlap = lexicalOverlap(quote, normalizedFocus);
      if (overlap.count === 0 || !isWhitespaceNormalizedSubstring(quote, page.text) || !isWhitespaceNormalizedSubstring(quote, sectionText)) continue;
      const sectionOverlap = lexicalOverlap(quote, `${section?.title || ""} ${section?.text || ""}`);
      candidates.push({
        page: page.page,
        section: section?.title || "",
        quote,
        equation: "",
        lexicalOverlap: overlap.tokens,
        score: overlap.count * 10 + overlap.ratio * 5 + sectionOverlap.count * 2 - Math.abs(page.page - startPage) * 0.1,
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.page - right.page || left.quote.length - right.quote.length || left.quote.localeCompare(right.quote));
  if (!candidates.length) return null;
  const { score: _score, ...source } = candidates[0];
  return source;
}
