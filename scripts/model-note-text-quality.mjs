import { createHash } from "node:crypto";

export const TEXT_QUALITY_VERSION = "source-text-quality-v10";

// U+00AD is a discretionary line-wrap marker in the source PDFs, not semantic
// content corruption. It is normalized separately so `pub<SHY> lisher`
// becomes `publisher`; the remaining invisible controls are still rejected.
const INVISIBLE = /[\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/gu;
const QUESTION_OPENERS = /^(?:how|what|when|where|why|which|who|whom|whose|can|could|should|would|do|does|did|is|are|was|were|will|may|might|has|have|had)\b/i;
const DANGLING_HEADING = /(?:-|:|\b(?:and|or|of|for|with|from|to|by|via|between|within|at|the|a|an|in|on|under|versus|vs\.?|first|second|third)|\b[A-Za-z]+[’']s)\s*$/i;
const HEADING_SIGNAL = /\b(?:model|formulation|problem|setting|framework|system|method|methodology|algorithm|solution|approach|estimation|strategy|objective|decision|state|constraint|utility|demand|timing|information|policy|learning|equilibrium|mechanism|optimization|analysis|application|benchmark|extension|scenario|results?|experiment|design|inventory|pricing|allocation|control)\b/i;
const EXCLUDED_HEADING = /^(?:references|bibliography|acknowledg(?:e)?ments?|online appendix|appendix|supplement(?:al material)?|copyright)$/i;
const PROSE_OPENER = /^(?:we|our|this (?:paper|study|section)|the (?:paper|study|analysis|authors?)|in this|to (?:show|see|derive|prove)|suppose|consider|let|because|although|therefore|hence|however)\b/i;
const PAPER_ORGANIZATION_PROSE = /^(?:(?:(?:first|second|third|fourth|fifth|finally|then),?\s+)?(?:in\s+)?(?:sub)?section\s*\d+(?:\.\d+)*\s*,?\s*(?:(?:w\s*e|i)\s+)?(?:will\s+)?(?:analy[sz]e|introduce|incorporate|consider|describe|derive|discuss|examine|extend|formulate|develop|model|outline|present|report|review|show|state|use)\w*\b|in\s+the\s+(?:next|following)\s+(?:sub)?section\b|the\s+(?:next|following)\s+(?:sub)?section\b|the\s+(?:rest|remainder)\s+of\s+(?:this|the)\s+(?:paper|article|study)\b|this\s+(?:paper|article|study)\s+is\s+organized\s+as\s+follows\b|the\s+(?:paper|article|study)\s+proceeds\b|we\s+(?:conclude|proceed)\s+(?:in|with)\b|the\s+appendix\s+(?:contains|provides|reports)\b)/i;

const FINGERPRINT_STOPWORDS = new Set("a an and are as at be been being by for from has have how in into is it its model modeled modeling of on or paper section study system that the their them these they this through to under use uses using was were what when where which with".split(" "));
export const NAMED_MATH_IDENTIFIERS = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda",
  "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega"
]);

export function stripInvisible(value) {
  return String(value ?? "")
    .replace(/\u00ad\s*/gu, "")
    .replace(INVISIBLE, "");
}

export function normalizeWhitespace(value) {
  // Several INFORMS PDF font maps decode the printed equality glyph as the
  // C1 control U+0088. Its meaning is unambiguous in the extracted equations
  // (`R0 = beta/gamma`, assignments, and policy definitions). Normalize that
  // legacy glyph before quality checks so source prose never exposes `` and
  // remains remappable to the page-preserving extraction.
  return String(value ?? "").replace(/\u0088/gu, "=").replace(/\s+/gu, " ").trim();
}

/** Return clean text, or an empty string when no letter or digit remains. */
export function meaningfulText(value) {
  const text = normalizeWhitespace(stripInvisible(value).normalize("NFKC"));
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

export function isMeaningfulText(value) {
  return Boolean(meaningfulText(value));
}

/** Normalize a directly phrased question; statements and title-like phrases return "". */
export function directQuestion(value) {
  let text = meaningfulText(value).replace(/^(?:research\s+)?question\s*:\s*/i, "").trim();
  if (!text || !QUESTION_OPENERS.test(text)) return "";
  text = text.replace(/[\s.!?]+$/g, "").trim();
  if (!text || text.split(/\s+/).length < 3) return "";
  return `${text}?`;
}

export function isDirectQuestion(value) {
  return Boolean(directQuestion(value));
}

/**
 * Detect a PDF-extracted subscript/superscript marker that has lost its base
 * or its script operand. This is deliberately a syntax check, not a blanket
 * ban on `_` and `^`: compact identifiers such as `a^M`, `λ_ij`,
 * `ρ_(x,a)`, `N_i^(t−1)`, and `C'^{-1}(b_q)` remain valid.
 */
export function hasOrphanMathScriptMarker(value) {
  const text = String(value ?? "").normalize("NFKC");
  const hasBase = (markerIndex) => {
    let cursor = markerIndex - 1;
    if (/['′]/u.test(text[cursor] || "")) cursor -= 1;
    while (cursor >= 0 && /\p{M}/u.test(text[cursor])) cursor -= 1;
    const base = text[cursor] || "";
    return /[\p{L}\p{N})\]}]/u.test(base)
      && !/\p{Lm}/u.test(base);
  };
  const hasOperand = (markerIndex) => {
    const first = text[markerIndex + 1] || "";
    if (first === "{" || first === "(") {
      const closing = first === "{" ? "}" : ")";
      const end = text.indexOf(closing, markerIndex + 2);
      return end > markerIndex + 2;
    }
    return /[+*\-\p{L}\p{N}]/u.test(first);
  };
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "_" && text[index] !== "^") continue;
    if (!hasBase(index) || !hasOperand(index)) return true;
  }
  return false;
}

function hasTruncatedRelativeClause(value) {
  const text = normalizeWhitespace(value);
  const extension = text.match(/^(?:(?:\d+(?:\.\d+){0,4}|[A-Z](?:\.\d+){0,3})[.):]?\s+)?(?:the\s+)?(?:extension|generalization|adaptation)\s+to\s+(?:an?\s+|the\s+)?(?:setting|case|environment)\s+in\s+which\s+(.+)$/i);
  if (!extension) return false;
  const tail = extension[1];
  // A real heading such as "Extension to a Setting in Which Demands Are
  // Correlated" contains a predicate.  Footnote/caption fragments often stop
  // one word earlier, after an adjective or distribution-family modifier.
  if (/\b(?:is|are|was|were|be|become|becomes|can|could|may|might|will|would|should|differ|differs|vary|varies|follow|follows|choose|chooses|arrive|arrives)\b/i.test(tail)) return false;
  return /\b(?:normal|lognormal|exponential|poisson|different|unknown|independent|correlated|heterogeneous|identical|general|arbitrary)\s*$/i.test(tail);
}

function isAffiliationOrPostalAddress(value) {
  const text = normalizeWhitespace(value);
  const commaCount = (text.match(/,/g) || []).length;
  if (commaCount < 2 || !/\b(?:department|university|school|college|faculty|institute|laborator(?:y|ies)|cent(?:er|re))\b/i.test(text)) return false;
  return /\b(?:[A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?)\b/i.test(text)
    || /,\s*(?:canada|united states(?: of america)?|u\.?s\.?a\.?|united kingdom|u\.?k\.?|china|hong kong|singapore|australia|france|germany|italy|spain|japan|india)\s*$/i.test(text);
}

export function hasExtractionNoise(value) {
  const original = String(value ?? "")
    .replace(/\u0088/gu, "=")
    .replace(/\u00ad\s*/gu, "");
  const raw = original.normalize("NFKC");
  if (!raw) return false;
  if (/^\s*[),.;:\]}]/u.test(raw)) return true;
  if (/^\s*[A-Za-z]\s*[)\]}]\s+(?:denote|represent|is|are)\b/u.test(raw)) return true;
  if (/^\s*[A-Za-z]\s+[A-Za-z]?\s*∈\s*[\[{]/u.test(raw)) return true;
  if (/^\s*[A-Z]{2,},\s+(?:and|or)\b/u.test(raw)) return true;
  if (INVISIBLE.test(original)) {
    INVISIBLE.lastIndex = 0;
    return true;
  }
  INVISIBLE.lastIndex = 0;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f�]/u.test(raw)) return true;
  // Mathematical italic glyphs are occasionally decoded as Hangul syllables
  // (for example, 푛, 픐, and 휌) and then fuse with an English token.  The
  // English-language Atlas corpus has no legitimate Hangul source passages.
  if (/\p{Script=Hangul}/u.test(raw)) return true;
  // A removed figure boundary can splice its caption/timeline labels into a
  // prose sentence.  Require either a glued caption number or two fused stage
  // labels so ordinary references such as "as Figure 2 shows" remain valid.
  if (/\b(?:fig(?:ure)?|table|exhibit|chart|panel)\s+[A-Z]?\d+[.:](?=\p{L})/iu.test(raw)) return true;
  if (/\b(?:stage|period|step)\s*\d+(?:stage|period|step)\s*\d+\b/i.test(raw)) return true;
  // Flowchart node labels can survive after the figure heading itself is
  // stripped, then run directly into the panel marker and the neighboring
  // prose.  That combined span is not an authorial sentence.  Keep the gate
  // narrow to the repeated vendor/client flow labels observed in the source;
  // ordinary prose that merely discusses a payment structure remains valid.
  if (/\b(?:payment\s+structure\s+)?(?:vendor\s+rejects\s+)?no\s+collaboration\s+\([a-z]\)\s+[A-Z]/iu.test(raw)) return true;
  if (/\/(?:uni[0-9A-F]{4,6}|equal[a-z]*|radicaltpext|summationdisplay|SL[A-Za-z]+)/i.test(raw)) return true;
  // A registered-trademark glyph immediately fused to mathematical notation
  // is a known PDF font-map substitution (for example, `®θ`). Legitimate
  // product marks such as `Uber®` remain untouched.
  if (/®\s*(?:[α-ωΑ-Ωϑϖϱςϕϵ]|\\[A-Za-z]+|(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|phi|omega)\b)/iu.test(raw)) return true;
  if (/\/[∈∉≤≥]/u.test(raw)) return true;
  if (/(?:\b[A-Za-z]\s+){5,}[A-Za-z]\b/.test(raw)) return true;
  if (/\b[fi]{5,}\b/i.test(raw)) return true;
  if (/\b[\p{L}]{28,}\b/u.test(raw)) return true;
  // A spaced hyphen between prose fragments is usually a PDF line-break split.
  // Mathematical operators elsewhere in the sentence must not hide `sys - tem`;
  // only a pair of conventional named math identifiers is treated as subtraction.
  const spacedHyphenWords = [...raw.matchAll(/\b([\p{L}]{3,})\s*-\s+(?!(?:and|or)\b)([\p{Ll}]{3,})\b/gu)];
  if (spacedHyphenWords.some(([, left, right]) => !NAMED_MATH_IDENTIFIERS.has(left.toLowerCase())
    || !NAMED_MATH_IDENTIFIERS.has(right.toLowerCase()))) return true;
  if (hasDanglingWordHyphen(raw)) return true;
  if (/\b(?:whe\s+re|fi\s+rm|ma\s+rket|mar\s+ket|pro\s+fit|va\s+lue|con\s+sumer|con\s+sideration|ret\s+ailer|sup\s+plier|secti\s+on|compari?\s+son|benchmark\s+parison|anti\s+gen|repre\s+sented|popu\s+lation|vaccina\s+tion|frac\s+tion(?:al|ation)?|fric\s+tional|administra\s+tion|epi\s+demic|suscepti\s+ble|transmis\s+sion|immuni\s+zation|progres\s+sively|pri\s+vacy|ran\s+dom(?:ly)?|vol\s+ume|peri\s+ods?|equilib\s+rium|partici\s+pants?|monopo\s+listic)\b/i.test(raw)) return true;
  if (/\b(?:ence|tive|ministic)\b/i.test(raw) || /\b(?:variable|costs?)\s+ing\b/i.test(raw)) return true;
  if (/\b(?:m\s+a\s+x|m\s+i\s+n|a\s+r\s+g\s+m\s+a\s+x)\b/i.test(raw)) return true;
  if (/\b(?:ure\s+presents|tically\s+significant|cients\s+of|tions\s+from|tions\s+of|cess\s+for|alty\s+request|ited\s+to|gineering\s+rules?|duction\s+costs?|ity\s+costs?|mon\s+with|utation\b|onstrate)\b/.test(raw)) return true;
  // A two-column extraction can interleave the tail of an influence clause
  // with the neighboring result column. The plural-subject/singular-verb
  // splice is not a grammatical proposition in any model formulation.
  if (/\busers?\s+in\s+(?:the\s+)?relaxed\s+model\s+provides?\b/i.test(raw)) return true;
  if (/\b(?:pirical|ingly|tored|tion|facturers|straints|tinuous|ried)\b/i.test(raw)) return true;
  if (/\b(?:els|ing|ler[’']s)\b/.test(raw)) return true;
  if (/\ban\s+gregate\b|\bthe\s+of\b|(?::\s*){3,}/i.test(raw)) return true;
  if (/\b(?:markett|setSt|cv\d{3,})\b/.test(raw)) return true;
  if (/\b(?:effects?|levels?|costs?|rates?|products?|markets?)\s+s(?=[.,;:]|$)/i.test(raw)) return true;
  if (/\b(?:w\s+e|con\s+figurable|a\s+tion)\b/i.test(raw)) return true;
  if (/\b(?:dom\s+vector|ent\s+periods?|swapping\s+vers|in\s+mulate|model\s+to\s+be\s+ping|the\s+mization|zation\s+model|optimization\s+tem|tricity\s+procurement|chastic\s+electricity)\b/i.test(raw)) return true;
  if (/\bany\s+backlogged\s+and\s+fulfilled\b/i.test(raw)) return true;
  if ((raw.match(/•/g) || []).length >= 2) return true;
  if (/\b(?:let|denote)\b.{0,100}\b[\p{L}]\s+,\s+[\p{L}]\b/iu.test(raw)) return true;
  if (/\bLet\s+(?:We|The|A|An)\b/.test(raw)) return true;
  if (hasFusedLowercaseCommaOutsideMathGroup(raw)) return true;
  if (/\b(?:and(?:letting|therefore|thus)|inthe(?:case|model|problem|section))\b/i.test(raw)) return true;
  // A table-note superscript can be flattened into the following word (for
  // example, `. bLevel` or `. cBecause`) when rows and notes are linearized.
  // Such a splice is not one auditable prose sentence or component source.
  if (/(?:^|[.!?]\s+)[a-e](?=\p{Lu})/u.test(raw)) return true;
  if (/[\p{Ll}]{3,}[α-ωΑ-Ω]/u.test(raw)) return true;
  if (/[\p{Ll}]{3,}[.!?][\p{Lu}][\p{Ll}]{2,}/u.test(raw) || /[.!?][\p{Lu}]\s+[\p{Ll}]\b/u.test(raw)) return true;
  if (/\b(?:denote|refer\s+to|write|call|defined|known)\b.{0,48}\bas\s*[.:]?$/i.test(raw)) return true;
  if (/\b(?:about|for|with|from|of|to)\s+(?:any|some|each|every|either|neither|these|those|such|other|another)\s*[.,;:]?$/i.test(raw)) return true;
  if (/\bbest\s+ous\s+sections?\b/i.test(raw)) return true;
  if (hasTruncatedRelativeClause(raw)) return true;
  // A capitalized discourse opener immediately after an ordinary lowercase
  // word is a strong sign that two PDF sentences were spliced after an
  // intervening display, page break, or caption was removed.
  if (/\b[\p{Ll}]{3,}\s+(?:As|Because|Given|Suppose|Assume|Let|We|The|This|These|Those|It|Since|However|Moreover|Consequently|Therefore|Hence)\b/u.test(raw)) return true;
  if (/\b(?:her|his|their|our|your)\s+the\b/i.test(raw)) return true;
  if (!/[=<>≤≥∑∏∫{}_^|]/u.test(raw)
    && /\b(?:is|are|was|were|be|been|the|a|an|and|or|of|for|with|by|to)\s*[.]$/i.test(raw)) return true;
  if ((raw.match(/[\p{L}\p{N}]+/gu) || []).length >= 8 && !balancedDelimiters(raw)) return true;
  if (/\bqua\s+silinear\b/i.test(raw)) return true;
  if (/\b(?:[A-Za-z]+\d+){2,}[A-Za-z]*\b/.test(raw)) return true;
  const pseudoVariables = raw.match(/\b(?:[A-Za-z]{1,3}\d+[A-Za-z]\d+|[A-Za-z]\d+[A-Za-z]{1,3}\d*)\b/g) || [];
  if (pseudoVariables.some((token) => (token.match(/\d/g) || []).length >= 3)) return true;
  if (pseudoVariables.length >= 2 && /[=<>≤≥∑∏∫{}]/u.test(raw)) return true;
  if (/(?:Ã.|Â\S|â€|â[ˆ‰†‡˜™Š‹ŒŽ‘’“”•–—…]|ï¬|ðŸ)/u.test(raw)) return true;
  return false;
}

function intervalCloseIsValid(value, opening, closing, closingIndex) {
  if (!((opening.character === "(" && closing === "]") || (opening.character === "[" && closing === ")"))) return false;
  // Do not excuse a malformed function/grouping expression such as f(x,y].
  // A mathematical interval instead begins after whitespace/punctuation or a
  // relation, and contains two endpoints separated by a comma.
  const prefix = value.slice(0, opening.index).trimEnd();
  const followsRelation = /(?:[=<>≤≥∈∉⊂⊃≈≡,:;]|\\(?:in|notin|subset(?:eq)?|supset(?:eq)?|leq?|geq?|neq?|approx|equiv))\s*$/u.test(prefix);
  if (/[\p{L}\p{N}_}\])]/u.test(value[opening.index - 1] || "") && !followsRelation) return false;
  const body = value.slice(opening.index + 1, closingIndex);
  return body.includes(",") && /[\p{L}\p{N}∞]/u.test(body);
}

function balancedDelimiters(value) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(" || character === "[" || character === "{") {
      stack.push({ character, index });
      continue;
    }
    if (!pairs[character]) continue;
    const opening = stack.at(-1);
    if (!opening) return false;
    if (pairs[character] === opening.character || intervalCloseIsValid(text, opening, character, index)) {
      stack.pop();
      continue;
    }
    return false;
  }
  return stack.length === 0;
}

function hasFusedLowercaseCommaOutsideMathGroup(value) {
  const text = String(value ?? "");
  for (const match of text.matchAll(/\b[\p{Ll}]{3,},(?=[\p{Ll}]+\b)/gu)) {
    let squareDepth = 0;
    let braceDepth = 0;
    for (let index = 0; index < (match.index ?? 0) + match[0].length; index += 1) {
      if (text[index] === "[") squareDepth += 1;
      else if (text[index] === "]") squareDepth = Math.max(0, squareDepth - 1);
      else if (text[index] === "{") braceDepth += 1;
      else if (text[index] === "}") braceDepth = Math.max(0, braceDepth - 1);
    }
    if (squareDepth === 0 && braceDepth === 0) return true;
  }
  return false;
}

function hasDanglingWordHyphen(value) {
  const pattern = /\b[\p{L}]{2,}\s*-\s*(?:[),.;:]|$)/gu;
  for (const match of String(value ?? "").matchAll(pattern)) {
    const punctuation = match[0].trimEnd().at(-1);
    if (punctuation === ",") {
      const remainder = String(value).slice((match.index ?? 0) + match[0].length);
      // Suspended compounds such as "full-, no-information" and
      // "no-, partial-, and full-adoption" are valid authored prose.
      if (/^\s*(?:(?:[\p{L}]+-\s*,\s*)*)(?:(?:and|or)\s+)?[\p{L}]+-[\p{L}]+/u.test(remainder)) continue;
    }
    return true;
  }
  return false;
}

export function isPaperOrganizationProse(value) {
  const text = meaningfulText(value);
  return Boolean(text) && PAPER_ORGANIZATION_PROSE.test(text);
}

export function isBoilerplate(value) {
  const text = meaningfulText(value);
  if (!text) return false;
  if (isAffiliationOrPostalAddress(text)) return true;
  if (isPaperOrganizationProse(text)) return true;
  if (/^(?:more|further|additional)\s+(?:details?|proofs?|discussion|results?|material)\b.*\b(?:online|web)\s+appendix\b/i.test(text)) return true;
  if (/^(?:copyright|©|all rights reserved|downloaded from|this article was downloaded|accepted by|published by|provided by|supplemental material|online appendix)\b/i.test(text)) return true;
  if (/^(?:informs|articles in advance)\b.*\b(?:doi|copyright|published|vol(?:ume)?|no\.?|issue)\b/i.test(text)) return true;
  if (/^(?:management science|marketing science|information systems research|manufacturing\s*&\s*service operations management)\b(?:\s|[,|·-])*(?:vol(?:ume)?\b|no\.?\b|issue\b|\d{4}\b|pp?\.?\b|informs\b|$)/i.test(text)) return true;
  if (/^\d{1,4}\s*[–—-]\s*\d{1,4},?\s*(?:©|copyright)\s*\d{4}\s+informs\b/i.test(text)) return true;
  if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(text) || /^doi\s*:/i.test(text)) return true;
  if (/^\d+\s+(?:management science|marketing science|information systems research)\b/i.test(text)) return true;
  if (/^[\p{Lu}][\p{L}'’.-]+\s+(?:and|&)\s+[\p{Lu}][\p{L}'’.-]+\s*:\s*.+\b(?:management science|marketing science|information systems research|manufacturing\s*&\s*service operations management)\b.*(?:\d+\(\d+\)|pp?\.)/iu.test(text)) return true;
  return false;
}

export function isCaption(value) {
  const text = meaningfulText(value);
  if (!text) return false;
  if (/^algorithm\s+[A-Z]?\d+\s+for\b/i.test(text)) return false;
  return /^(?:(?:online appendix|appendix)\s+)?(?:fig(?:ure)?|table|exhibit|chart|panel|algorithm)\s+[A-Z]?\d+(?:[.:-]|\s)/i.test(text)
    || /^(?:source|sources|note|notes)\s*:/i.test(text);
}

export function isCitation(value) {
  const text = meaningfulText(value);
  if (!text) return false;
  return /^\[?\d+\]?\s+[A-Z][\p{L}'’.-]+,/u.test(text)
    || /^\(?[A-Z][\p{L}'’.-]+\s+et\s+al\.?,?\s*\(?\d{4}[a-z]?\)?[.,]?\)?$/u.test(text)
    || /^\(?[A-Z][\p{L}'’.-]+(?:\s+(?:and|&|,)?\s*[A-Z][\p{L}'’.-]+)*,?\s+\d{4}[a-z]?\)?[.,]?$/u.test(text)
    || /\b(?:vol(?:ume)?|issue|pp?\.)\s*\d+.*\bdoi\b/i.test(text);
}

export function isTableRow(value) {
  const raw = String(value ?? "");
  const text = meaningfulText(raw);
  if (!text) return false;
  const withoutParentheticalConditioning = raw.replace(/\([^()]*\|[^()]*\)/g, "");
  // Mathematical conditioning and norms use `|`; only count it as a column
  // separator when it is visibly padded and outside parenthetical notation.
  if ((withoutParentheticalConditioning.match(/\t|\s{3,}|\s\|\s/g) || []).length >= 2) return true;
  if (/^\d+[.)]\s+(?:[-+]?\d+(?:\.\d+)?%?\s+){2,}/.test(text)) return true;
  if ((text.match(/\((?:state|control|decision) variable\)/gi) || []).length >= 2) return true;
  const cells = text.split(/\s+/);
  const numeric = cells.filter((cell) => /^[-+]?[$€£]?(?:\d+(?:[.,]\d+)*|[—–-])%?$/.test(cell)).length;
  if (/^\s*\([a-z]\)(?:\s|$)/iu.test(raw) && /\([a-z]\)/giu.test(raw)) {
    const panelMarkers = raw.match(/\([a-z]\)/giu) || [];
    if (panelMarkers.length >= 2 && numeric >= 4) return true;
  }
  return cells.length >= 4 && ((numeric >= 3 && numeric / cells.length >= 0.45)
    || (numeric >= 5 && numeric / cells.length >= 0.28));
}

export function isHeadingContinuation(value, previous = "") {
  const text = meaningfulText(value);
  if (!text || text.length > 110 || text.split(/\s+/).length > 13) return false;
  if (/[.!?;:]$/.test(text) || hasExtractionNoise(value) || hasOrphanMathScriptMarker(value)
    || isBoilerplate(text) || isCaption(text) || isCitation(text) || isTableRow(value)) return false;
  if (PROSE_OPENER.test(text)) return false;
  if (/^[\p{Ll}]/u.test(text) && !String(previous).trimEnd().endsWith("-")) return false;
  const words = text.split(/\s+/);
  const titleLike = words.filter((word) => /^(?:[A-Z][\p{L}\p{N}'’/-]*|[A-Z]{2,}|and|or|of|for|with|from|to|the|a|an|in|on|under|versus|vs\.?)$/u.test(word)).length;
  return titleLike / words.length >= 0.6 || HEADING_SIGNAL.test(text);
}

function parseHeadingNumber(text) {
  let match = text.match(/^((?:\d+(?:\.\d+){1,4}|[A-Z](?:\.\d+){1,3}))\.?\s+(.+)$/);
  if (match) return { number: match[1], title: match[2] };
  match = text.match(/^((?:\d+|[A-Z]))\.\s+(.+)$/);
  if (match) return { number: match[1], title: match[2] };
  return { number: "", title: text };
}

function headingTitleIsPlausible(title, numbered) {
  const words = title.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 16 || title.length > 140) return false;
  if (DANGLING_HEADING.test(title) || /[.!?;]$/.test(title)) return false;
  if (PROSE_OPENER.test(title) && words.length > 4) return false;
  if (/^(?:where|when|because|although|therefore|hence|thus)\b/i.test(title)) return false;
  if (EXCLUDED_HEADING.test(title)) return true;
  const titleLike = words.filter((word) => /^(?:[A-Z][\p{L}\p{N}'’/-]*|[A-Z]{2,}|and|or|of|for|with|from|to|the|a|an|in|on|under|versus|vs\.?)$/u.test(word)).length;
  return HEADING_SIGNAL.test(title) || titleLike / words.length >= (numbered ? 0.62 : 0.72);
}

/**
 * Assess one extracted line as a section heading. Pass the following line to
 * recover a short wrapped continuation. The source lines are never modified.
 */
export function assessHeading(value, continuation = "") {
  const raw = String(value ?? "");
  const text = meaningfulText(raw);
  const rejected = (reason) => ({ accepted: false, number: "", title: "", consumedContinuation: false, reason });
  if (!text) return rejected("empty");
  if (hasExtractionNoise(raw) || hasOrphanMathScriptMarker(raw)) return rejected("extraction-noise");
  if (isBoilerplate(text)) return rejected("boilerplate");
  if (isCaption(text)) return rejected("caption");
  if (isCitation(text)) return rejected("citation");
  if (isTableRow(raw)) return rejected("table-row");
  if (/^(?:[-*•]|\d+[)])\s+/.test(text)) return rejected("list-row");

  const parsed = parseHeadingNumber(text);
  const numbered = Boolean(parsed.number);
  let title = parsed.title.replace(/\s+[·•]\s+.*$/, "").trim();
  // Number prefixes must not let a paper-roadmap sentence bypass the
  // boilerplate gate (for example, "3. In Section 5, we extend …").
  if (isBoilerplate(title)) return rejected("boilerplate");
  let consumedContinuation = false;
  if (DANGLING_HEADING.test(title)) {
    const next = meaningfulText(continuation);
    if (!next || !isHeadingContinuation(continuation, title)) return rejected("dangling-heading");
    title = title.endsWith("-") ? `${title.slice(0, -1)}${next}` : `${title} ${next}`;
    consumedContinuation = true;
  }
  title = title.replace(/[:.]+$/, "").trim();
  if (isCaption(title)) return rejected("caption");
  if (isCitation(title)) return rejected("citation");
  if (!headingTitleIsPlausible(title, numbered)) return rejected("prose-fragment");
  return {
    accepted: true,
    number: parsed.number,
    title,
    consumedContinuation,
    reason: EXCLUDED_HEADING.test(title) ? "excluded-section" : "heading"
  };
}

export function qualityHeading(value, continuation = "") {
  const result = assessHeading(value, continuation);
  return result.accepted ? result : null;
}

export function isQualityHeading(value, continuation = "") {
  return assessHeading(value, continuation).accepted;
}

export function isWhitespaceNormalizedSubstring(candidate, rawPage) {
  const quote = normalizeWhitespace(String(candidate ?? ""));
  return Boolean(quote) && normalizeWhitespace(String(rawPage ?? "")).includes(quote);
}

const SOURCE_MATCH_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu;

function compatibilitySourceText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(SOURCE_MATCH_CONTROL, " ")
    .replace(/\u00ad\s*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Map a cleaned/NFKC source excerpt back to the exact glyph sequence on its
 * raw extracted page. PDF text layers frequently preserve compatibility
 * ligatures (`ﬁ`), decomposed combining marks, or mathematical alphabets even
 * though semantic authoring normalizes them. Returning the raw span keeps the
 * citation strictly auditable without giving up normalized text for scoring.
 */
export function remapNormalizedSourceQuote(candidate, rawPage) {
  const literal = normalizeWhitespace(String(candidate ?? ""));
  const raw = String(rawPage ?? "");
  if (!literal || !raw) return "";
  if (isWhitespaceNormalizedSubstring(literal, raw)) return literal;

  const wanted = compatibilitySourceText(literal);
  if (!wanted) return "";

  const normalized = [];
  const offsets = [];
  let pendingWhitespace = null;
  let joinAfterSoftHyphen = false;
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  for (const { segment, index } of segmenter.segment(raw)) {
    if (segment.includes("\u00ad")) {
      joinAfterSoftHyphen = true;
      pendingWhitespace = null;
    }
    const transformed = segment
      .normalize("NFKC")
      .replace(SOURCE_MATCH_CONTROL, " ")
      .replace(/\u00ad/gu, "");
    const rawEnd = index + segment.length;
    for (let unitIndex = 0; unitIndex < transformed.length; unitIndex += 1) {
      const unit = transformed[unitIndex];
      if (/\s/u.test(unit)) {
        if (joinAfterSoftHyphen) continue;
        if (normalized.length && normalized.at(-1) !== " ") {
          pendingWhitespace = pendingWhitespace
            ? { start: pendingWhitespace.start, end: rawEnd }
            : { start: index, end: rawEnd };
        }
        continue;
      }
      joinAfterSoftHyphen = false;
      if (pendingWhitespace) {
        normalized.push(" ");
        offsets.push(pendingWhitespace);
        pendingWhitespace = null;
      }
      normalized.push(unit);
      offsets.push({ start: index, end: rawEnd });
    }
  }

  const normalizedPage = normalized.join("");
  let matchIndex = normalizedPage.indexOf(wanted);
  while (matchIndex >= 0) {
    const finalOffset = offsets[matchIndex + wanted.length - 1];
    if (!finalOffset) return "";
    const rawSpan = normalizeWhitespace(raw.slice(offsets[matchIndex].start, finalOffset.end));
    if (compatibilitySourceText(rawSpan) === wanted
      && isWhitespaceNormalizedSubstring(rawSpan, raw)) return rawSpan;
    matchIndex = normalizedPage.indexOf(wanted, matchIndex + 1);
  }
  return "";
}

function sourceSentenceCandidates(rawPage, options = {}) {
  const normalizedPage = normalizeWhitespace(rawPage);
  if (!normalizedPage) return [];
  const pageLines = String(rawPage ?? "").split(/\r?\n/).map(normalizeWhitespace).filter(Boolean);
  const lineSpans = [];
  const maximumWords = options.maxWords ?? 90;
  // A PDF extractor can put a display, table, or previous column before an
  // otherwise complete prose sentence. In that case the whole-page chunk is
  // unusable and the individual physical lines are too short. Recover only
  // literal, contiguous multi-line spans that visibly begin a sentence. The
  // final substring check below still forbids dehyphenated or synthesized
  // quotations (for example, `mod- ified` never becomes `modified`).
  for (let start = 0; start < pageLines.length; start += 1) {
    const starts = pageLines[start].split(/(?<=[.!?])\s+(?=(?:["'“‘(\[]?[A-Z0-9]))/);
    const first = starts.at(-1)?.trim() || "";
    if (!/^(?:["'“‘(\[]?[A-Z][\p{L}'’\-]*)(?:\s|$)/u.test(first)) continue;
    let span = first;
    for (let end = start; end < Math.min(pageLines.length, start + 12); end += 1) {
      if (end > start) {
        if (/^(?:\d+(?:\.\d+){0,4}|[A-Z](?:\.\d+){0,3})[.)]?\s+[A-Z]/.test(pageLines[end])) break;
        span = `${span} ${pageLines[end]}`;
      }
      if (span.split(/\s+/).length > maximumWords) break;
      if (/[.!?]["'”’)}\]]?\s+(?:["'“‘(\[]?[A-Z])/.test(span)) {
        lineSpans.push(span);
        break;
      }
      if (/[.!?]["'”’)}\]]?$/.test(span)) {
        lineSpans.push(span);
        break;
      }
    }
  }
  const chunks = [normalizedPage, ...pageLines, ...lineSpans];
  const seen = new Set();
  const candidates = [];
  for (const chunk of chunks) {
    const protectedChunk = chunk.replace(/\bet\s+al\./gi, (match) => `${match.slice(0, -1)}\uE000`);
    const sentences = protectedChunk
      .split(/(?<=[.!?])\s+(?=(?:["'“‘(\[]?[A-Z0-9]|i\.e\.,))/)
      .map((sentence) => sentence.replace(/\uE000/g, "."));
    for (const sentence of sentences) {
      const text = sentence.trim();
      if (!text || seen.has(text) || !normalizedPage.includes(text)) continue;
      const opening = text.replace(/^["'“‘(\[]+/, "");
      // A page-line continuation such as `tical sense, ...` can be literal yet
      // is not a complete source sentence. Camel-case brands and symbolic
      // openings survive because this rejects only three leading lowercase
      // letters, not any lowercase first character.
      const explicitStageOpener = /^In\s+(?:the\s+)?(?:first|second|third|fourth|fifth|final)\s+stage\b/u.test(opening);
      if (/^\p{Ll}{3}/u.test(opening)
        || (!explicitStageOpener
          && /^(?:at|in|on|the|and|or|until|with|from|for|to|by|which|where|when|while|because|if)\b/u.test(opening))) continue;
      seen.add(text);
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length < (options.minWords ?? 6) || words.length > (options.maxWords ?? 90)) continue;
      if (!/[.!?]["'”’)}\]]?$/.test(text)) continue;
      if (!meaningfulText(text) || hasExtractionNoise(text) || hasOrphanMathScriptMarker(text)
        || isBoilerplate(text) || isCaption(text) || isCitation(text) || isTableRow(text)) continue;
      if (typeof options.accept === "function" && !options.accept(text)) continue;
      const lexicalWords = text.match(/[\p{L}][\p{L}'’\-]{2,}/gu) || [];
      if (lexicalWords.length < Math.max(4, Math.floor(words.length * 0.35))) continue;
      candidates.push({ text, start: normalizedPage.indexOf(text) });
    }
  }
  return candidates.sort((left, right) => left.start - right.start || left.text.length - right.text.length);
}

function semanticTokens(value) {
  return meaningfulText(value)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g)?.filter((token) => !FINGERPRINT_STOPWORDS.has(token))
    .map((token) => token.length > 6 ? token.replace(/(?:ies|ing|ed|es|s)$/, (suffix) => suffix === "ies" ? "y" : "") : token.length > 4 ? token.replace(/s$/, "") : token) || [];
}

export function literalSourceSentenceCandidates(rawPage, options = {}) {
  return sourceSentenceCandidates(rawPage, options).map((candidate) => candidate.text);
}

/** Select a clean, literal sentence from a page-preserving extraction. */
export function selectLiteralSourceSentence(rawPage, focus = "", options = {}) {
  const wanted = new Set(semanticTokens(focus));
  const candidates = sourceSentenceCandidates(rawPage, options).map((candidate) => {
    const tokens = semanticTokens(candidate.text);
    const overlap = tokens.reduce((score, token) => score + (wanted.has(token) ? (token.length > 7 ? 2 : 1) : 0), 0);
    const phraseBonus = focus && candidate.text.toLocaleLowerCase().includes(normalizeWhitespace(focus).toLocaleLowerCase()) ? 3 : 0;
    return { ...candidate, score: overlap + phraseBonus };
  }).sort((left, right) => right.score - left.score || left.text.length - right.text.length || left.start - right.start);
  const selectedCandidate = candidates[0];
  if (wanted.size && options.requireOverlap !== false && (!selectedCandidate || selectedCandidate.score <= 0)) return "";
  const selected = selectedCandidate?.text || "";
  return isWhitespaceNormalizedSubstring(selected, rawPage) ? selected : "";
}

function componentText(component) {
  if (typeof component === "string") return component;
  if (!component || typeof component !== "object") return "";
  return [
    component.label,
    component.explanation,
    component.formal,
    ...(Array.isArray(component.searchPhrases) ? component.searchPhrases : []),
    ...(Array.isArray(component.conditions) ? component.conditions : []),
    ...(Array.isArray(component.symbols) ? component.symbols.map((symbol) => symbol?.meaning) : []),
    ...(Array.isArray(component.conceptBindings) ? component.conceptBindings.map((binding) => binding?.representation) : [])
  ].filter(Boolean).join(" ");
}

/** Canonical, order-insensitive semantic signature used before hashing. */
export function semanticSignature(component) {
  const role = meaningfulText(component && typeof component === "object" ? component.role : "").toLocaleLowerCase();
  const concepts = component && typeof component === "object" && Array.isArray(component.concepts)
    ? [...new Set(component.concepts.map((id) => meaningfulText(id).toLocaleLowerCase()).filter(Boolean))].sort()
    : [];
  const tokens = [...new Set(semanticTokens(componentText(component)))].sort();
  if (!role && !concepts.length && !tokens.length) return "";
  return `role:${role}|concepts:${concepts.join(",")}|tokens:${tokens.join(",")}`;
}

export function semanticFingerprint(component) {
  const signature = semanticSignature(component);
  return signature ? createHash("sha256").update(`${TEXT_QUALITY_VERSION}\n${signature}`).digest("hex") : "";
}

export const componentFingerprint = semanticFingerprint;

export function sameSemanticComponent(left, right) {
  const leftFingerprint = semanticFingerprint(left);
  return Boolean(leftFingerprint) && leftFingerprint === semanticFingerprint(right);
}
