import { NAMED_MATH_IDENTIFIERS, normalizeWhitespace } from "./model-note-text-quality.mjs";

const MATHEMATICAL_FORMAL_KINDS = new Set([
  "Atlas normalized notation",
  "Atlas restatement of source rule",
  "Source-extracted equation (not visually verified)"
]);
const STRICT_EQUATION_FORMAL_KINDS = new Set([
  "Atlas normalized notation",
  "Source-extracted equation (not visually verified)"
]);

const CLOSING_DELIMITER = Object.freeze({ ")": "(", "]": "[", "}": "{" });
const OPENING_DELIMITERS = new Set(["(", "[", "{"]);
const FORMULA_FUNCTION_WORDS = new Set([
  "arg", "argmax", "argmin", "ceil", "cos", "exp", "floor", "frac", "inf", "left", "lim", "limits", "ln", "log", "mathbb",
  "mathbf", "mathcal", "mathop", "mathrm", "max", "min", "operatorname", "otherwise", "overset", "prod", "right", "sqrt", "sum", "sup", "text", "underset", "where"
]);
const SHORT_FORMULA_WORDS = new Set([
  "all", "and", "as", "for", "if", "iff", "in", "is", "mod", "not", "of", "or", "pr", "sin", "tan", "the", "to", "via"
]);
const RELATION_TOKEN = /(?::=|≔|<=|>=|!=|=|≤|≥|≠|∈|∉|≈|≡|∝|∼|←|→|↦|⊂|⊃|⊆|⊇|(?<![<])>(?![=])|(?<![>])<(?![=])|\\(?:leq?|geq?|neq?|in|notin|subset(?:eq)?|supset(?:eq)?|approx|equiv|propto|sim|simeq|gets|to|mapsto)\b)/u;
const LEADING_DISPLAY_OPERATOR = /^(?:\\?(?:arg\s*max|arg\s*min|argmax|argmin|max|min|sup|inf)(?=$|[\s_^{([])|\\(?:sum|prod|int|lim)(?=$|[\s_^{([]))/i;
// A printed equation number is separated from its expression by whitespace.
// Requiring that boundary prevents the final reference in prose such as
// `Equations (3)-(5)` from being mistaken for an equation label and exposing
// the reference-range hyphen as a clipped operator.
const TERMINAL_EQUATION_LABEL = /(?:^|\s+)\(\s*[A-Z]?\.?\d+(?:\.\d+)?\s*\)\s*[,.;:]?\s*$/u;
const NAMED_GREEK_PATTERN = /(?<![\\A-Za-z])(?:varepsilon|vartheta|varpi|varrho|varsigma|varphi|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![A-Za-z])/g;
const GREEK_TEX = Object.freeze({
  // PDF text layers sometimes substitute Latin/compatibility lookalikes for
  // Greek glyphs.  Treat those code points as notation too: U+025B `ɛ` is a
  // frequent epsilon extraction in this corpus and U+00B5 `µ` is routinely
  // emitted for Greek mu.  The IPA gamma/phi lookalikes are included for the
  // same deterministic rendering boundary even though they are rarer.
  α: "alpha", β: "beta", γ: "gamma", ɣ: "gamma", δ: "delta", ε: "varepsilon", ɛ: "varepsilon", ϵ: "epsilon", ζ: "zeta", η: "eta",
  θ: "theta", ϑ: "vartheta", ι: "iota", κ: "kappa", λ: "lambda", μ: "mu", ν: "nu", ξ: "xi",
  µ: "mu", π: "pi", ϖ: "varpi", ρ: "rho", ϱ: "varrho", σ: "sigma", ς: "varsigma", τ: "tau", υ: "upsilon",
  φ: "varphi", ɸ: "varphi", ϕ: "phi", χ: "chi", ψ: "psi", ω: "omega",
  Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda", Ξ: "Xi", Π: "Pi", Σ: "Sigma", Υ: "Upsilon", Φ: "Phi", Ψ: "Psi", Ω: "Omega"
});
// TeX intentionally has no commands for Greek glyphs whose uppercase/lowercase
// forms are typographically identical to ordinary Latin math letters.
const DIRECT_GREEK_TEX = Object.freeze({
  ο: "o", Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K",
  Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Χ: "X",
  // U+0190 is another PDF-font substitution in this corpus. In context it is
  // consistently the expectation operator, rather than uppercase epsilon.
  Ɛ: "\\mathbb{E}"
});

function canonicalizeMathNotation(value) {
  let output = normalizeWhitespace(value);
  if (/^\$(?:[^$]|\\\$)+\$$/u.test(output)) output = output.slice(1, -1).trim();
  else if (/^\\\((?:.|\n)+\\\)$/u.test(output)) output = output.slice(2, -2).trim();
  else if (/^\\\[(?:.|\n)+\\\]$/u.test(output)) output = output.slice(2, -2).trim();
  // A TeX control word consumes following ASCII letters. Terminate the
  // generated command when a source glyph is immediately followed by one so
  // `λx` can never become the nonexistent command `\lambdax` in the UI. The
  // strict source-equation validator separately rejects this typography as an
  // ambiguous flattened script; this terminator also keeps standalone catalog
  // notation syntactically renderable.
  output = output.replace(/[α-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ]/gu, (symbol, offset, source) => {
    const direct = DIRECT_GREEK_TEX[symbol];
    if (direct) return direct;
    const command = GREEK_TEX[symbol];
    if (!command) return symbol;
    const terminator = /[A-Za-z]/u.test(source[offset + symbol.length] || "") ? "{}" : "";
    return `\\${command}${terminator}`;
  });
  output = output.replace(NAMED_GREEK_PATTERN, (name, offset, source) => {
    const terminator = /[A-Za-z]/u.test(source[offset + name.length] || "") ? "{}" : "";
    return `\\${name}${terminator}`;
  });
  return output;
}

function rawMathNotationIssue(value) {
  const source = String(value ?? "");
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "$" && !isEscaped(source, index)) return "contains a raw $ math delimiter";
  }
  if (/^\\[([]|\\[)\]]$/u.test(source.trim()) || /^\\\(|\\\)$|^\\\[|\\\]$/u.test(source.trim())) {
    return "contains a raw TeX math wrapper";
  }
  NAMED_GREEK_PATTERN.lastIndex = 0;
  if (NAMED_GREEK_PATTERN.test(source)) return "contains bare named Greek notation";
  return "";
}

function isEscaped(value, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function withoutTerminalEquationLabel(value) {
  return String(value ?? "").replace(TERMINAL_EQUATION_LABEL, "").trim();
}

function intervalCloseIsValid(value, opening, closing, closingIndex) {
  if (!((opening.character === "(" && closing === "]") || (opening.character === "[" && closing === ")"))) return false;
  // A parenthesis immediately following an identifier is a function/grouping
  // delimiter, not an interval delimiter: f(x,y] must remain an error.
  const prefix = value.slice(0, opening.index).trimEnd();
  const followsRelation = /(?:[=<>≤≥∈∉⊂⊃≈≡,:;]|\\(?:in|notin|subset(?:eq)?|supset(?:eq)?|leq?|geq?|neq?|approx|equiv))\s*$/u.test(prefix);
  if (/[\p{L}\p{N}_}\])]/u.test(value[opening.index - 1] || "") && !followsRelation) return false;
  const body = value.slice(opening.index + 1, closingIndex);
  return body.includes(",") && /[\p{L}\p{N}∞]/u.test(body);
}

/**
 * Detect corruption that is meaningful inside mathematical fields without
 * applying prose-only heuristics (for example, commas in f(x,y) or half-open
 * intervals). Structural delimiter and boundary checks remain separate.
 */
function hasMathematicalExtractionNoise(value) {
  const raw = String(value ?? "");
  if (!raw) return false;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f�]/u.test(raw)) return true;
  if (/[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/u.test(raw)) return true;
  if (/\/(?:uni[0-9A-F]{4,6}|equal[a-z]*|radicaltpext|summationdisplay|SL[A-Za-z]+)/i.test(raw)) return true;
  if (/(?:Ã.|Â\S|â€|ï¬|ðŸ)/u.test(raw)) return true;
  if (/(?:\b[A-Za-z]\s+){5,}[A-Za-z]\b/.test(raw)) return true;
  return false;
}

function delimiterIssue(value) {
  const stack = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!(character in CLOSING_DELIMITER) && !OPENING_DELIMITERS.has(character)) continue;
    // TeX \{ and \} represent visible braces, not grouping braces. Their
    // structural pairing is therefore irrelevant to MathJax parsing.
    if ((character === "{" || character === "}") && isEscaped(value, index)) continue;
    if (OPENING_DELIMITERS.has(character)) {
      stack.push({ character, index });
      continue;
    }
    const opening = stack.at(-1);
    if (!opening) return `unexpected closing delimiter ${character}`;
    if (CLOSING_DELIMITER[character] === opening.character || intervalCloseIsValid(value, opening, character, index)) {
      stack.pop();
      continue;
    }
    return `mismatched delimiters ${opening.character}${character}`;
  }
  return stack.length ? `unclosed delimiter ${stack.at(-1).character}` : "";
}

function clippedMathBoundaryIssue(value) {
  // A printed equation label must not conceal a clipped operator, script, or
  // TeX command immediately before that label.
  const trimmed = withoutTerminalEquationLabel(value);
  const relationCommand = String.raw`(?:leq?|geq?|neq?|in|notin|subset(?:eq)?|supset(?:eq)?|approx|equiv|propto|sim|simeq|gets|to|mapsto)`;
  if (new RegExp(`^(?:[=<>≤≥≠∈∉⊂⊃⊆⊇≈≡∝∼←→↦−+*/]|\\\\${relationCommand}\\b)`, "u").test(trimmed)) {
    return "starts with a dangling operator";
  }
  // A terminal star is commonly the complete optimal-value marker x*, so it
  // is intentionally not treated as a dangling multiplication operator.
  // Likewise, [x]^+ and [x]_- are complete positive/negative-part notation.
  if (/(?:[_^]\s*(?:\{\s*[+−-]\s*\}|[+−-]))\s*[.;:]?$/u.test(trimmed)) return "";
  if (new RegExp(`(?:[=<>≤≥≠∈∉⊂⊃⊆⊇≈≡∝∼←→↦+−\\-/^_,]|\\\\${relationCommand})\\s*[.;:]?$`, "u").test(trimmed)) {
    return "ends with a dangling operator";
  }
  if (/\\\s*$/.test(trimmed)) return "ends with an incomplete TeX command";
  return "";
}

function formulaFragmentIssue(value, originalValue = value) {
  const rawTrimmed = withoutTerminalEquationLabel(value).trim();
  const trimmed = rawTrimmed.replace(/[,.;:]+$/u, "").trim();
  if (/^[•·]\s*/u.test(trimmed)) return "starts with a bullet fragment";
  if (/^\d+\s+(?:and|or)\b/i.test(trimmed)) return "starts with a prose conjunction fragment";
  if (/^(?:if|when)\s*\(/i.test(trimmed)) return "starts with a conditional formula fragment";
  if (/^(?:where|otherwise|in)\b/i.test(trimmed)) return "starts with a prose fragment";
  if (/^\{\s*\}(?:\s*[,;:]?\s*(?:and|or)\b)?/i.test(trimmed)
    || /^(?:\((?:[ivxlcdm]+|[a-z])\)|(?:[ivxlcdm]+|[a-z])[.)])\s+/i.test(trimmed)) {
    return "starts with an enumerated fragment";
  }
  // A parenthesized argument list cannot be the left-hand mathematical
  // object by itself.  This is the characteristic tail left when PDF text
  // extraction drops a function name such as pi*_g immediately before
  // `(P; o) >= ...`.
  if (/^\([^)]*;[^)]*\)\s*(?::=|≔|<=|>=|!=|=|≤|≥|≠|≈|≡|∝|∼|<|>)/u.test(trimmed)) {
    return "starts with a function-argument tail";
  }
  // Ellipses are useful in prose and complete sequences, but an extracted
  // strict equation ending in a comma/ellipsis is not a self-contained
  // formula.  Likewise, a bare set row followed by an ellipsis is normally a
  // clipped declaration rather than an equation.
  if (/^\{[^{}]+\}\s*[,;]?\s*(?:…|\.\.\.)/u.test(rawTrimmed)
    || /(?:,|;)\s*(?:…|\.\.\.)\s*$/u.test(rawTrimmed)) {
    return "contains a clipped ellipsis tail";
  }
  // Reject prose glued onto one side of a relation.  These patterns capture
  // common column/line joins without rejecting ordinary mathematical words
  // used as functions (for example, `log K` inside a complete expression).
  if (/\b(?:and|or)\s+(?:log|ln|exp|max|min|sup|inf|arg\s*max|arg\s*min)\b[^=<>≤≥≠≈≡∝∼]*$/i.test(trimmed)
    && RELATION_TOKEN.test(trimmed)) {
    return "ends with a prose-joined mathematical fragment";
  }
  // PDF extraction commonly flattens a printed Greek subscript, e.g. pi2 for
  // pi_2.  Publishing that flattened token changes the mathematics.  Named
  // Greek followed by a digit must retain an explicit script marker.
  const originalTrimmed = withoutTerminalEquationLabel(originalValue).trim();
  // A PDF text layer that flattens a conventional index letter or digit after
  // Greek notation does not preserve enough typography to reconstruct the
  // source equation safely. Uppercase function names such as `αE[OPT]` remain
  // valid products and are terminated as TeX control words by canonicalization.
  if (!/[=<>≤≥≠∈∉⊂⊃⊆⊇≈≡∝∼←→↦+−\-/^_,]\s*$/u.test(trimmed)
    && (/\\(?:varepsilon|vartheta|varpi|varrho|varsigma|varphi|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)\{\}[ijkmnt0-9]/i.test(trimmed)
      || /[Α-Ωα-ωϑϖϱςϕϵɛƐµɣɸ][ijkmnt0-9](?=$|[_^()[\]{},;:+*/=<>≤≥≠≈≡∝∼−-])/iu.test(originalTrimmed)
      || /(?<![\\A-Za-z])(?:varepsilon|vartheta|varpi|varrho|varsigma|varphi|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)(?:\d+|[ijkmnt])(?=$|[_^()[\]{},;:+*/=<>≤≥≠≈≡∝∼−-])/i.test(originalTrimmed))) {
    return "contains a probable flattened Greek script";
  }
  if (!/[=<>≤≥≠∈∉⊂⊃⊆⊇≈≡∝∼←→↦+−\-/^_,]\s*$/u.test(trimmed)
    && (/\b(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega)\d+\b/i.test(originalTrimmed)
      || /[Α-Ωα-ωϑϖϱςϕϵɛƐµɣɸ]\d+/u.test(originalTrimmed))) {
    return "contains a probable flattened Greek subscript";
  }
  if (/\b(?:and|or|where|if)\s*$/i.test(trimmed)) return "ends with a prose conjunction";
  return "";
}

function flattenedLatinScriptIssue(value) {
  const text = String(value ?? "")
    .replace(/\\[A-Za-z]+/g, " ")
    // Explicit TeX scripts already preserve the typography. Their index
    // letters must not themselves be mistaken for a flattened identifier.
    .replace(/[_^]\s*\{[^{}]*\}/g, " ")
    .replace(/[_^]\s*[A-Za-z0-9]/g, " ");
  const numericScript = text.match(/(?<![\\A-Za-z0-9])[A-Za-z]\d+\b/u);
  if (numericScript) return `contains probable flattened Latin script ${numericScript[0]}`;
  for (const match of text.matchAll(/\b[A-Za-z]{2,3}\b/g)) {
    const token = match[0];
    const normalized = token.toLowerCase();
    if (FORMULA_FUNCTION_WORDS.has(normalized) || SHORT_FORMULA_WORDS.has(normalized)
      || NAMED_MATH_IDENTIFIERS.has(normalized)) continue;
    const next = text.slice((match.index ?? 0) + token.length).trimStart()[0] || "";
    if ((next === "(" || next === "[") && /^[A-Z][a-z]{1,2}$/.test(token)) continue;
    // Multi-letter roman identifiers can be valid when deliberately authored,
    // but a source-extracted PDF row that flattens X_{jt}, T_m, or p_{jt} into
    // Xjt, Tm, or pjt has changed the equation. Require an explicit script or
    // operator instead of guessing where the typography was lost.
    if (/[a-z]/.test(token)) return `contains probable flattened Latin script ${token}`;
  }
  return "";
}

function unmatchedDollarIssue(value, formalKind) {
  let inspected = String(value ?? "");
  if (!STRICT_EQUATION_FORMAL_KINDS.has(formalKind)) {
    // Dollars inside a URL are URL syntax, not a TeX delimiter. Currency
    // markers are masked one at a time so `$500 ... $lambda` still leaves the
    // malformed math delimiter visible instead of passing on even parity.
    inspected = inspected
      .replace(/https?:\/\/\S+/giu, " URL ")
      .replace(/(?<!\\)\$(?:\s*\d+(?:[.,]\d+)*(?:\s*(?:thousand|million|billion|trillion|k|m|bn))?|\/[A-Za-z]+|[A-Z]{1,4}\b)/gu, " CURRENCY ");
  }
  let dollars = 0;
  for (let index = 0; index < inspected.length; index += 1) {
    if (inspected[index] === "$" && !isEscaped(inspected, index)) dollars += 1;
  }
  return dollars % 2 === 0 ? "" : "unmatched math delimiter $";
}

function rawVerbalMathDelimiterIssue(value) {
  // Verbal Atlas restatements are stored as ordinary prose. Preserve literal
  // currency and URLs, but never publish source-style `$...$` wrappers in the
  // formal field: the reader would expose those delimiters as raw text and a
  // paired pair can otherwise evade the parity-only check above.
  const inspected = String(value ?? "")
    .replace(/https?:\/\/\S+/giu, " URL ")
    .replace(/\\\$/gu, " ESCAPED_DOLLAR ")
    .replace(/(?<!\\)\$(?:\s*\d+(?:[.,]\d+)*(?:\s*(?:thousand|million|billion|trillion|k|m|bn))?|\/[A-Za-z]+|[A-Z]{1,4}\b)/gu, " CURRENCY ");
  return /(?<!\\)\$/u.test(inspected) ? "contains a raw $ math delimiter" : "";
}

function verbalBoundaryView(value) {
  return String(value ?? "")
    .replace(/https?:\/\/\S+/giu, "URL")
    // A plus suffix on a standard number domain is complete notation, not a
    // clipped addition operator. Do not exempt a generic terminal `x+`.
    .replace(/(?:\\mathbb\s*\{\s*[RZNQC]\s*\}|[RZNQCℝℤℕℚℂ])\s*\+\s*([,.;:]?)\s*$/u, "DOMAIN$1");
}

/**
 * Identify a physical source line whose grammar is mathematical rather than
 * prose. This is deliberately line-scoped: ordinary prose may discuss an
 * inequality, but a display line must not be folded into an explanation when
 * PDF sentence recovery joins adjacent lines.
 */
function standaloneFormulaLine(value) {
  const text = withoutTerminalEquationLabel(normalizeWhitespace(value))
    .replace(/[,;:]$/, "")
    .trim();
  const mathText = text.replace(/^(?:subject\s+to|such\s+that|s\.?\s*t\.?)\s*:?\s*/i, "");
  const relation = mathText.match(RELATION_TOKEN);
  const operatorDisplay = LEADING_DISPLAY_OPERATOR.test(mathText);
  if (!relation && !operatorDisplay) return false;
  const lhs = relation ? mathText.slice(0, relation.index)
    .replace(/^(?:if|where|for)\s+/i, "")
    .trim() : mathText.match(LEADING_DISPLAY_OPERATOR)?.[0] || "";
  if (relation && lhs && !/^[\\\p{L}\p{N}\p{M}\p{S}_^{}()[\],.|:+*/−\-\s]+$/u.test(lhs)) return false;
  if (relation && !lhs && !/^(?:[=<>≤≥≠∈∉⊂⊃⊆⊇≈≡∝∼←→↦]|\\)/u.test(mathText)) return false;
  const proseWords = (mathText.match(/[A-Za-z]{4,}/g) || []).filter((word) => {
    const normalized = word.toLowerCase();
    return !NAMED_MATH_IDENTIFIERS.has(normalized) && !FORMULA_FUNCTION_WORDS.has(normalized);
  });
  return proseWords.length === 0;
}

function containedAsTokenSpan(haystack, needle) {
  let offset = haystack.indexOf(needle);
  while (offset >= 0) {
    const before = haystack[offset - 1] || "";
    const after = haystack[offset + needle.length] || "";
    const leftBounded = !/^[\p{L}\p{N}]$/u.test(needle[0] || "") || !/[\p{L}\p{N}]/u.test(before);
    const rightBounded = !/[\p{L}\p{N}]$/u.test(needle.at(-1) || "") || !/[\p{L}\p{N}]/u.test(after);
    if (leftBounded && rightBounded) return true;
    offset = haystack.indexOf(needle, offset + 1);
  }
  return false;
}

// Page extraction can emit tiny positioned glyph runs (for example `<`,
// `j∈J`, or `max`) as physical lines even when they were inline prose. The
// validation backstop therefore requires more evidence than the authoring
// filter, which deliberately remains aggressive while choosing fresh prose.
function conservativeContaminatingFormulaLine(value) {
  const text = withoutTerminalEquationLabel(normalizeWhitespace(value)).trim();
  if (!standaloneFormulaLine(text)) return false;
  if (/^(?:where|otherwise|in)\b/i.test(text)
    || /^\{\s*\}(?:\s*[,;:]?\s*(?:and|or)\b)?/i.test(text)) return text.length >= 7;
  if (/^(?:subject\s+to|s\.?\s*t\.?)\b/i.test(text)) return true;
  if (/^(?:for\s+(?:all|any)|such\s+that)\b/i.test(text)) return false;
  if (/^[,.;:)\]}]/u.test(text)
    || /^(?:[=<>≤≥≠∈∉⊂⊃⊆⊇≈≡∝∼←→↦−+*/]|\\(?:leq?|geq?|neq?|in|notin|subset(?:eq)?|supset(?:eq)?|approx|equiv|propto|sim|simeq|gets|to|mapsto)\b)/u.test(text)) return false;
  const operator = text.match(LEADING_DISPLAY_OPERATOR);
  if (operator && !RELATION_TOKEN.test(text)) {
    const tail = text.slice(operator[0].length);
    return /[_^{[]/u.test(tail) && /[\p{L}\p{N}]/u.test(tail);
  }
  return text.length >= 16;
}

function formulaContaminatedProse(value, lines, { conservative = false } = {}) {
  const prose = normalizeWhitespace(value);
  if (!prose) return false;
  const sourceLines = Array.isArray(lines)
    ? lines.map((line) => typeof line === "string" ? line : line?.text)
    : String(lines ?? "").split(/\r?\n/);
  return sourceLines.some((line, index) => {
    const sourceLine = normalizeWhitespace(line);
    const lineIsFormula = conservative
      ? conservativeContaminatingFormulaLine(sourceLine)
      : standaloneFormulaLine(sourceLine);
    if (conservative && lineIsFormula && /^\d+\s*(?:[=<>≤≥])/u.test(sourceLine)) {
      const previous = normalizeWhitespace(sourceLines[index - 1]);
      // PDF positioning may split an inline subscript across physical lines:
      // `prices so that p` + `1 < p2 < ...`. When the exact joined span occurs
      // in the quote, the second line is an inline continuation, not an
      // adjacent display equation absorbed into prose.
      if (/(?:^|\s)[\p{L}]$/u.test(previous)
        && prose.includes(normalizeWhitespace(`${previous} ${sourceLine}`))) return false;
    }
    return sourceLine && lineIsFormula && containedAsTokenSpan(prose, sourceLine);
  });
}

function formalStructureIssue(value, formalKind = "") {
  const originalSource = String(value ?? "").trim();
  const source = originalSource.normalize("NFKC").trim();
  if (!source) return "formal content is empty";
  const delimiters = delimiterIssue(source);
  if (delimiters) return delimiters;
  if (!formalKind) {
    // NFKC flattens Unicode subscripts (for example, pᵢ -> pi). Checking the
    // normalized view would therefore mistake an ordinary indexed variable
    // for a bare named Greek identifier. Raw notation markers are lexical, so
    // validate them against the original source while retaining NFKC for the
    // structural checks below.
    const notation = rawMathNotationIssue(originalSource);
    if (notation) return notation;
  }
  if (!MATHEMATICAL_FORMAL_KINDS.has(formalKind)) return "";
  const dollars = unmatchedDollarIssue(source, formalKind);
  if (dollars) return dollars;
  if (formalKind === "Atlas restatement of source rule") {
    const rawDelimiter = rawVerbalMathDelimiterIssue(source);
    if (rawDelimiter) return rawDelimiter;
  }
  if (STRICT_EQUATION_FORMAL_KINDS.has(formalKind)) {
    if (hasMathematicalExtractionNoise(source) || /[®©™]/u.test(source)) {
      return "contains PDF extraction noise";
    }
    const fragment = formulaFragmentIssue(source, originalSource);
    if (fragment) return fragment;
    const boundary = clippedMathBoundaryIssue(source);
    if (boundary) return boundary;
    const notation = rawMathNotationIssue(originalSource);
    if (notation) return notation;
    if (formalKind === "Source-extracted equation (not visually verified)") {
      const flattened = flattenedLatinScriptIssue(source);
      if (flattened) return flattened;
    }
    return "";
  }
  return clippedMathBoundaryIssue(formalKind === "Atlas restatement of source rule"
    ? verbalBoundaryView(source)
    : source);
}

function noteFormalStructureIssues(note) {
  const issues = [];
  for (const [modelIndex, model] of (note?.models || []).entries()) {
    for (const [componentIndex, component] of (model?.components || []).entries()) {
      const reason = formalStructureIssue(component?.formal, component?.formalKind);
      if (reason) {
        issues.push({
          path: `models[${modelIndex}].components[${componentIndex}].formal`,
          modelId: model?.id || "",
          componentId: component?.id || "",
          formalKind: component?.formalKind || "",
          reason
        });
      }
      for (const [symbolIndex, symbol] of (component?.symbols || []).entries()) {
        const symbolReason = formalStructureIssue(symbol?.symbol, "");
        if (symbolReason) {
          issues.push({
            path: `models[${modelIndex}].components[${componentIndex}].symbols[${symbolIndex}].symbol`,
            modelId: model?.id || "",
            componentId: component?.id || "",
            formalKind: "symbol",
            reason: symbolReason
          });
        }
      }
    }
  }
  return issues;
}

export {
  MATHEMATICAL_FORMAL_KINDS,
  canonicalizeMathNotation,
  formalStructureIssue,
  formulaContaminatedProse,
  hasMathematicalExtractionNoise,
  noteFormalStructureIssues,
  standaloneFormulaLine
};
