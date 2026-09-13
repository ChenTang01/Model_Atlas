/* Local, on-demand MathJax. Search always uses the unchanged source text. */
(() => {
  "use strict";

  const scriptURL = document.currentScript?.src || location.href;
  const vendorURL = new URL("../vendor/mathjax/tex-svg.js", scriptURL).href;
  const notation = globalThis.MINI_ATLAS_NOTATION || { inline: {}, formulas: {} };
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
  const greek = Object.freeze({
    // PDF extractors commonly emit the Latin/compatibility lookalikes ɛ and µ
    // for epsilon and mu. IPA gamma/phi are normalized at the same boundary so
    // a glyph that represents Greek notation never reaches TeX as raw Unicode.
    α: "alpha", β: "beta", γ: "gamma", ɣ: "gamma", δ: "delta", ε: "varepsilon", ɛ: "varepsilon", ϵ: "epsilon", Ɛ: "mathbb{E}", ζ: "zeta", η: "eta", θ: "theta", ϑ: "vartheta",
    ι: "iota", κ: "kappa", λ: "lambda", μ: "mu", µ: "mu", ν: "nu", ξ: "xi", π: "pi", ϖ: "varpi", ρ: "rho", ϱ: "varrho",
    σ: "sigma", ς: "varsigma", τ: "tau", υ: "upsilon", φ: "varphi", ɸ: "varphi", ϕ: "phi", χ: "chi", ψ: "psi", ω: "omega",
    Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda", Ξ: "Xi", Π: "Pi", Σ: "Sigma", Υ: "Upsilon", Φ: "Phi", Ψ: "Psi", Ω: "Omega"
  });
  const greekAscii = Object.freeze({
    ο: "o", Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K",
    Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Χ: "X"
  });
  const namedGreek = Object.freeze({
    varepsilon: "varepsilon", vartheta: "vartheta", varpi: "varpi", varrho: "varrho", varsigma: "varsigma", varphi: "varphi",
    alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta", epsilon: "epsilon",
    zeta: "zeta", eta: "eta", theta: "theta", iota: "iota", kappa: "kappa", lambda: "lambda",
    mu: "mu", nu: "nu", xi: "xi", pi: "pi", rho: "rho", sigma: "sigma", tau: "tau",
    upsilon: "upsilon", phi: "phi", chi: "chi", psi: "psi", omega: "omega",
    Gamma: "Gamma", Delta: "Delta", Theta: "Theta", Lambda: "Lambda", Xi: "Xi", Pi: "Pi",
    Sigma: "Sigma", Upsilon: "Upsilon", Phi: "Phi", Psi: "Psi", Omega: "Omega"
  });
  const namedGreekNames = Object.keys(namedGreek).sort((left, right) => right.length - left.length);
  const namedGreekIdentifier = `(?:${namedGreekNames.join("|")})(?:_(?:\\{[^{}\\s]+\\}|[\\p{L}\\p{N}]+))?(?:\\^(?:\\{[^{}\\s]+\\}|[\\p{L}\\p{N}*+\\-]+))?`;
  const namedGreekPattern = new RegExp(
    `(?<![\\\\A-Za-z])(${namedGreekNames.join("|")})(?![A-Za-z])`,
    "g"
  );
  const namedOperator = Object.freeze({
    argmax: "\\operatorname*{argmax}", argmin: "\\operatorname*{argmin}",
    limsup: "\\limsup", liminf: "\\liminf", max: "\\max", min: "\\min",
    sum: "\\sum", prod: "\\prod", integral: "\\int", exp: "\\exp", log: "\\log", infinity: "\\infty"
  });
  const namedOperatorPattern = new RegExp(
    `(?<![\\\\A-Za-z])(${Object.keys(namedOperator).sort((left, right) => right.length - left.length).join("|")})(?![A-Za-z])`,
    "gi"
  );
  const protectedCommands = new Set(["text", "textrm", "textsf", "texttt", "mathrm", "mathbf", "mathit", "operatorname"]);
  const accentCommand = Object.freeze({ tilde: "tilde", hat: "hat", bar: "bar", dot: "dot", under: "underline" });
  const subscript = Object.freeze({ "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₚ": "p", "ᵣ": "r", "ₛ": "s", "ₜ": "t", "ᵤ": "u", "ᵥ": "v", "ₓ": "x", "₊": "+", "₋": "-" });
  const superscript = Object.freeze({ "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "ʲ": "j", "ᴮ": "B", "ᴾ": "P", "ᴸ": "L", "ᵀ": "T", "ᵁ": "U", "ᴿ": "R", "ˢ": "s", "⁺": "+", "⁻": "-" });
  const readableCommand = Object.freeze({
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
    iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ",
    sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆",
    supset: "⊃", supseteq: "⊇", approx: "≈", equiv: "≡", propto: "∝", sim: "∼", to: "→", leftarrow: "←",
    leftrightarrow: "↔", mapsto: "↦", succeq: "≽", preceq: "≼", setminus: "∖", Vert: "‖", cdot: "·", sum: "∑", int: "∫",
    infty: "∞", varnothing: "∅", ell: "ℓ"
  });
  const proseArgumentCommands = new Set([
    "bar", "overline", "underline", "hat", "widehat", "tilde", "widetilde", "dot", "ddot",
    "mathcal", "mathbb", "mathrm", "mathbf", "mathit", "text", "textrm", "textsf", "texttt", "operatorname"
  ]);
  const readableSubscript = Object.freeze({
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
    "+": "₊", "-": "₋"
  });
  const readableSuperscript = Object.freeze({
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    i: "ⁱ", j: "ʲ", n: "ⁿ", T: "ᵀ", B: "ᴮ", P: "ᴾ", L: "ᴸ", U: "ᵁ", R: "ᴿ", s: "ˢ", "+": "⁺", "-": "⁻", "*": "∗"
  });

  function replaceReadableScripts(source) {
    const readableScript = (operator, body) => {
      const map = operator === "_" ? readableSubscript : readableSuperscript;
      const glyphs = [...body].map((character) => map[character]);
      if (glyphs.every(Boolean)) return glyphs.join("");
      return `${operator === "_" ? "₍" : "⁽"}${body}${operator === "_" ? "₎" : "⁾"}`;
    };
    let value = String(source ?? "");
    let previous = "";
    // Process inner scripts before their containing script. A single regex
    // pass cannot unwrap TeX such as `_{p_{j}^{0}}` or `^{k_{r}}`.
    while (value !== previous) {
      previous = value;
      value = value.replace(/([_^])\{([^{}]*)\}/g, (_match, operator, body) => readableScript(operator, body));
    }
    return value.replace(/([_^])([A-Za-z0-9+\-*]+)/g, (_match, operator, body) => readableScript(operator, body));
  }
  let loading;
  let queue = Promise.resolve();

  function protectedCommandEnd(value, index) {
    if (value[index] !== "\\") return -1;
    const command = value.slice(index + 1).match(/^[A-Za-z]+/)?.[0] || "";
    if (!protectedCommands.has(command)) return -1;
    let cursor = index + command.length + 1;
    if (value[cursor] === "*") cursor += 1;
    if (value[cursor] !== "{") return -1;
    let depth = 1;
    for (cursor += 1; cursor < value.length; cursor += 1) {
      if (value[cursor] === "\\") {
        cursor += 1;
        continue;
      }
      if (value[cursor] === "{") depth += 1;
      else if (value[cursor] === "}" && --depth === 0) return cursor + 1;
    }
    return value.length;
  }

  function transformOutsideProtectedCommands(source, transform) {
    const value = String(source ?? "");
    let output = "";
    let segmentStart = 0;
    for (let index = 0; index < value.length; index += 1) {
      const end = protectedCommandEnd(value, index);
      if (end < 0) continue;
      output += transform(value.slice(segmentStart, index));
      output += value.slice(index, end);
      segmentStart = end;
      index = end - 1;
    }
    return output + transform(value.slice(segmentStart));
  }

  function normalizeNamedMath(source) {
    return transformOutsideProtectedCommands(source, (segment) => segment
      // PDF text sometimes escapes only the opening delimiter of a set.
      // Complete the TeX pair inside the math boundary; the authored source
      // remains available in data-original-text.
      .replace(/\\\{([^{}\\]*)\}/g, (_match, body) => `\\{${body}\\}`)
      // Normalize combining accents that have no precomposed Unicode form.
      // A combining accent can follow a complete TeX command in extracted
      // notation (for example, `\thetâ`). Handle that atom before the
      // generic letter rule so it cannot split into `\thet\hat{a}`.
      .replace(/\\([A-Za-z]+)\u0304/g, (_match, command) => `\\bar{\\${command}}`)
      .replace(/\\([A-Za-z]+)\u0302/g, (_match, command) => `\\hat{\\${command}}`)
      .replace(/\\([A-Za-z]+)\u0303/g, (_match, command) => `\\tilde{\\${command}}`)
      .replace(/\\([A-Za-z]+)\u0307/g, (_match, command) => `\\dot{\\${command}}`)
      .replace(/([\p{L}\p{N}])\u0304/gu, "\\bar{$1}")
      .replace(/([\p{L}\p{N}])\u0302/gu, "\\hat{$1}")
      .replace(/([\p{L}\p{N}])\u0303/gu, "\\tilde{$1}")
      .replace(/([\p{L}\p{N}])\u0307/gu, "\\dot{$1}")
      // Keep the supported local MathJax package surface deterministic. The
      // reviewed corpus uses boldsymbol only for a bold Greek vector, while
      // the bundled configuration supports the equivalent mathbf form.
      .replace(/\\boldsymbol\s*(?:\{([^{}]+)\}|(\\[A-Za-z]+|[A-Za-z0-9]))/g,
        (_match, braced, atom) => `\\mathbf{${braced || atom}}`)
      // A legacy set-difference shorthand was serialized as N\B, which TeX
      // otherwise interprets as an undefined command named B.
      .replace(/(?<=[\p{L}\p{N})}\]])\\B(?![A-Za-z])/gu, "\\setminus B")
      // Extracted set difference can also precede a parenthesized set, as in
      // `N\(S∪{j})`. Inside an existing math slot `\(` cannot open another
      // math context, so retain the intended binary set-difference operator.
      .replace(/(?<=[\p{L}\p{N})}\]])\\(?=\s*\()/gu, "\\setminus ")
      // A remaining one-letter control word is not a portable TeX variable.
      // PDF-derived catalog text occasionally serializes a literal capital as
      // `\\T`; keep it mathematical without handing MathJax an undefined
      // command. The reviewed N\\B set-difference shorthand is handled above.
      // Do not consume the second slash in an aligned/cases row break (`\\D`).
      .replace(/(?<!\\)\\([A-Za-z])(?![A-Za-z])/g, "$1")
      // In the reviewed objectives, an uppercase sigma with limits is a sum
      // operator rather than the standalone Greek-letter variable Sigma.
      .replace(/Σ(?=\s*[_^])/g, "\\sum")
      // Some reviewed catalogs inherit TeX command names without the leading
      // slash. Restore the command rather than displaying `hat` or `tilde` as
      // a product of italic letters.
      .replace(/(?<![\\A-Za-z])(tilde|widehat|widetilde|hat|bar|underline|dot|ddot)\s*\{/g, "\\$1{")
      .replace(new RegExp(`(?<![\\\\A-Za-z])(${namedGreekNames.join("|")})((?:_(?:\\{[^{}\\s]+\\}|[A-Za-z0-9]+))+)(?:_|-)\\s*(tilde|hat|bar|dot)(?=$|[,(])`, "g"),
        (_match, base, scripts, modifier) => `\\${modifier}{${base}${scripts}}`)
      .replace(new RegExp(`(?<![\\\\A-Za-z])(${namedGreekNames.join("|")})(?:_|-)\\s*(tilde|hat|bar|dot|under)(?=_[A-Za-z0-9{]|\\(|\\b)`, "g"),
        (_match, base, modifier) => `\\${accentCommand[modifier]}{${base}}`)
      .replace(/(\\[A-Za-z]+)(?:_|-)\s*(tilde|hat|bar|dot|under)(?=_[A-Za-z0-9{]|\(|\b)/g,
        (_match, base, modifier) => `\\${accentCommand[modifier]}{${base}}`)
      .replace(/(?<![\p{L}\p{N}])([A-Za-zα-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ])(?:_|-)\s*(tilde|hat|bar|dot|under)(?=_[A-Za-z0-9{]|\(|\b)/gu,
        (_match, base, modifier) => `\\${accentCommand[modifier]}{${base}}`)
      .replace(/(?<![\\A-Za-z])([A-Z])hat(?=[_^])/g, "\\hat{$1}")
      .replace(new RegExp(`(?<![\\\\A-Za-z])hat[_-](${namedGreekNames.join("|")}|[A-Za-z])(?![A-Za-z])`, "g"), "\\hat{$1}")
      .replace(/_([A-Za-z0-9]*)empty\b/g, (_match, prefix) => `_{${prefix}\\varnothing}`)
      .replace(/(?<![A-Za-z])empty(?![A-Za-z])/g, "\\varnothing")
      .replace(/(?<=[\p{L}\p{N})}])(?:_|-)star(?=$|[\s,.;:()[\]+\-*/=<>≤≥∈])/gu, "^{*}")
      .replace(/(?<=[\p{L}\p{N})}])(?:_|-)plus(?=$|[\s,.;:()[\]+\-*/=<>≤≥∈])/gu, "_{+}")
      .replace(/(?<=[\p{L}\p{N})}])(?:_|-)minus(?=$|[\s,.;:()[\]+\-*/=<>≤≥∈])/gu, "_{-}")
      .replace(/\b([A-Za-z]+)((?:_(?:[a-z][a-z0-9]*|[A-Z][0-9]*)){2,})\b/g,
        (_match, base, scripts) => `${base}_{${scripts.slice(1).split("_").join(",")}}`)
      .replace(/\barg\s+(max|min)(?![A-Za-z])/gi, (_match, operator) => `arg${operator.toLowerCase()}`)
      .replace(namedGreekPattern, (name) => `\\${namedGreek[name]}`)
      .replace(namedOperatorPattern, (name) => namedOperator[name.toLowerCase()])
      .replace(/<=/g, "\\le ")
      .replace(/>=/g, "\\ge ")
      .replace(/!=/g, "\\ne ")
      .replace(/(^|\s)in(?=\s)/g, (_match, prefix) => `${prefix}\\in`)
      // A postfix star before an argument list is optimality notation. Do not
      // apply this to `(...)*(...)`, which is an explicit multiplication.
      .replace(/(?<=[\p{L}\p{N}])\*(?=\s*\()/gu, "^{*}")
      .replace(/(?<=[\p{L}\p{N})}])\*(?=\s*(?:[_^=≤≥<>∈]|\\(?:in|le|ge|ne)(?![A-Za-z])|(?:in|is)\b|$|[,.;:)]))/gu, "^{*}"));
  }

  function readableMath(source) {
    let value = String(source ?? "");
    // Give common blackboard-bold sets a useful fallback before removing
    // presentational commands. The original source remains in data-original-
    // text for search, inspection, and a later successful MathJax render.
    value = value
      .replace(/\\\{/g, "\uE000")
      .replace(/\\\}/g, "\uE001")
      .replace(/\\mathbb\s*\{?R\}?/g, "ℝ")
      .replace(/\\mathbb\s*\{?N\}?/g, "ℕ")
      .replace(/\\mathbb\s*\{?Z\}?/g, "ℤ")
      .replace(/\\mathbb\s*\{?Q\}?/g, "ℚ")
      .replace(/\\mathbb\s*\{?C\}?/g, "ℂ")
      .replace(/\\(?:left|right)\b\s*/g, "")
      .replace(/\\(?:text|textrm|textsf|texttt|mathrm|mathbf|mathit|mathcal|mathbb|operatorname)\*?\s*(?:\{([^{}]*)\}|(?=\\?[A-Za-z]))/g,
        (_match, body) => body || "");
    // Unwrap remaining accents/styles for a readable no-MathJax fallback.
    // Typography is restored when MathJax succeeds; fallback content must
    // never expose raw TeX control words to the reader.
    value = value.replace(/\\(?:bar|overline|underline|hat|widehat|tilde|widetilde|dot|ddot)\s*(?:\{([^{}]*)\}|(?=\\?[A-Za-z]))/g,
      (_match, body) => body || "");
    value = value.replace(/\\([A-Za-z]+)/g, (_match, command) => readableCommand[command] ?? command);
    value = value
      .replace(/\\([{}])/g, "$1")
      .replace(/\\/g, "");
    return replaceReadableScripts(value)
      .replace(/[{}]/g, "")
      .replace(/\uE000/g, "{")
      .replace(/\uE001/g, "}");
  }

  function textualNotationLabel(source) {
    const value = String(source ?? "").trim();
    const calligraphic = value.match(/^calligraphic\s+([A-Za-z])$/i);
    if (calligraphic) return `\\mathcal{${calligraphic[1].toUpperCase()}}`;
    // A comma-separated list of one-letter variables is a mathematical tuple
    // or glossary group, not an upright prose label.
    if (/^[A-Za-z](?:\s*,\s*[A-Za-z])+$/.test(value)) return "";
    if (/^(?:[A-Za-z]|[α-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ]|(?:varepsilon|vartheta|varpi|varrho|varsigma|varphi|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega))(?:_|-)(?:tilde|hat|bar|dot|under)(?:[_^(]|$)/i.test(value)) return "";
    if (!/^[A-Za-z][A-Za-z '\-/]*(?:,\s*[A-Za-z][A-Za-z '\-/]*)*$/u.test(value)) return "";
    const words = value.match(/[A-Za-z]+/g) || [];
    if (!words.length || words.some((word) => namedGreek[word] || namedOperator[word.toLowerCase()])) return "";
    const looksLikeLabel = words.length > 1 || /[-/,\s]/.test(value) || (words.length === 1 && words[0].length > 3);
    return looksLikeLabel ? `\\text{${value.replace(/[{}]/g, "")}}` : "";
  }

  function symbolTex(source, nested = false) {
    if (!nested) source = unwrappedMath(source);
    if (!nested) {
      const legacyPair = String(source ?? "").trim().match(/^(.+?)\s+and\s+((?:[A-Za-z]|[α-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ])(?:_|-)(?:tilde|hat|bar|dot|under)(?:[_^(].*)?)$/iu);
      if (legacyPair) return `${symbolTex(legacyPair[1], true)},\\;${symbolTex(legacyPair[2], true)}`;
      const label = textualNotationLabel(source);
      if (label) return label;
    }
    const value = normalizeNamedMath(source);
    const alignmentEnvironment = /\\begin\{(?:aligned|alignedat|array|cases|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix)\}/.test(value);
    let output = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      const protectedEnd = protectedCommandEnd(value, index);
      if (protectedEnd >= 0) {
        output += value.slice(index, protectedEnd);
        index = protectedEnd - 1;
        continue;
      }
      if (subscript[character] || superscript[character]) {
        const map = subscript[character] ? subscript : superscript;
        const operator = subscript[character] ? "_" : "^";
        let part = "";
        while (index < value.length && map[value[index]]) part += map[value[index++]];
        index -= 1;
        output += `${operator}{${part}}`;
        continue;
      }
      if (character === "_" || character === "^") {
        let part = "";
        if (value[index + 1] === "(" || value[index + 1] === "[") {
          const opening = value[index + 1];
          const closing = opening === "(" ? ")" : "]";
          let depth = 1;
          index += 2;
          for (; index < value.length; index += 1) {
            if (value[index] === opening) depth += 1;
            if (value[index] === closing && --depth === 0) break;
            part += value[index];
          }
        } else if (value[index + 1] === "{") {
          let depth = 1;
          index += 2;
          for (; index < value.length; index += 1) {
            if (value[index] === "{") depth += 1;
            if (value[index] === "}" && --depth === 0) break;
            part += value[index];
          }
        } else if (value[index + 1] === "\\") {
          part = "\\";
          index += 2;
          while (index < value.length && /[A-Za-z]/.test(value[index])) part += value[index++];
          index -= 1;
        } else {
          const next = value[index + 1] || "";
          const tokenPattern = /\p{N}/u.test(next) ? /\p{N}/u : /[a-z]/;
          // Catalog shorthands such as CMI, AV, FULL, Gen, and Public are
          // single script labels. TeX's unbraced default would retain only
          // their first character. Two-character capital/lowercase sequences
          // (Cv, Ix, Tk) remain split because they commonly mean an indexed
          // variable followed by an adjacent factor.
          const labelScript = value.slice(index + 1).match(/^(?:[A-Z][A-Z0-9]+|[A-Z][a-z]{2,}|noAI|aF|rF)(?=$|[\^(),.;+\-*/=<>≤≥\s])/);
          if (labelScript) {
            part = labelScript[0];
            index += part.length;
          } else if (/[A-Zα-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ]/u.test(next)) part = value[++index];
          else {
            let cursor = index + 1;
            while (cursor < value.length && tokenPattern.test(value[cursor])) cursor += 1;
            const splitBeforeAdjacentBase = cursor - (index + 1) > 1
              && (value[cursor] === "_" || (character === "^" && value[cursor] === "("));
            const end = splitBeforeAdjacentBase
              ? index + 2
              : cursor;
            part = value.slice(index + 1, end);
            index = end - 1;
          }
          if (!part && index + 1 < value.length && !/\s/.test(value[index + 1])) part = value[++index];
        }
        output += `${character}{${symbolTex(part, true)}}`;
        continue;
      }
      // A catalog objective may use an ampersand as ordinary prose inside a
      // display slot. TeX reserves bare ampersands for alignment; preserve
      // those only inside an actual alignment environment.
      if (character === "&" && value[index - 1] !== "\\" && !alignmentEnvironment) {
        output += "\\&";
        continue;
      }
      output += greekAscii[character] || (greek[character] ? `\\${greek[character]}${/[A-Za-z]/.test(value[index + 1] || "") ? " " : ""}` : ({
        "−": "-", "′": "'", "≤": "\\le ", "≥": "\\ge ", "≠": "\\ne ", "∈": "\\in ", "∉": "\\notin ",
        "≈": "\\approx ", "≡": "\\equiv ", "∝": "\\propto ", "∼": "\\sim ", "→": "\\to ", "←": "\\leftarrow ",
        "↔": "\\leftrightarrow ", "↦": "\\mapsto ", "≽": "\\succeq ", "≼": "\\preceq ", "∅": "\\varnothing ",
        "⊂": "\\subset ", "⊆": "\\subseteq ", "⊃": "\\supset ", "⊇": "\\supseteq ",
        "∖": "\\setminus ", "‖": "\\Vert ", "·": "\\cdot ", "∑": "\\sum ", "∫": "\\int ", "∞": "\\infty "
      })[character] || character);
    }
    return output;
  }

  function balancedGroupEnd(value, start, opening = "{", closing = "}") {
    if (value[start] !== opening) return start;
    let depth = 1;
    for (let index = start + 1; index < value.length; index += 1) {
      if (value[index] === "\\") {
        index += 1;
        continue;
      }
      if (value[index] === opening) depth += 1;
      else if (value[index] === closing && --depth === 0) return index + 1;
    }
    return value.length;
  }

  function scriptedAtomEnd(value, start) {
    let cursor = start;
    if (value[cursor] === "{") cursor = balancedGroupEnd(value, cursor);
    else if (value[cursor] === "\\") cursor = texCommandAtomEnd(value, cursor);
    else if (cursor < value.length) cursor += 1;
    while (cursor < value.length && /[_^]/.test(value[cursor])) {
      cursor += 1;
      if (value[cursor] === "{") cursor = balancedGroupEnd(value, cursor);
      else if (value[cursor] === "\\") cursor = texCommandAtomEnd(value, cursor);
      else if (cursor < value.length) cursor += 1;
    }
    return cursor;
  }

  function texCommandAtomEnd(value, start) {
    if (value[start] !== "\\") return start;
    if (!/[A-Za-z]/.test(value[start + 1] || "")) {
      if (value[start + 1] === "{") {
        const groupEnd = balancedGroupEnd(value, start + 1);
        if (groupEnd > start + 2) return groupEnd;
      }
      return Math.min(value.length, start + 2);
    }
    const command = value.slice(start + 1).match(/^[A-Za-z]+/)?.[0] || "";
    let cursor = start + command.length + 1;
    if (value[cursor] === "*") cursor += 1;
    if (proseArgumentCommands.has(command)) {
      while (/\s/.test(value[cursor] || "")) cursor += 1;
      cursor = scriptedAtomEnd(value, cursor);
    } else {
      while (cursor < value.length && /[_^]/.test(value[cursor])) {
        cursor += 1;
        cursor = scriptedAtomEnd(value, cursor);
      }
      // A command followed by an indexed one-letter variable is commonly one
      // compact product (for example `\\alpha X_H`) inside an otherwise prose
      // definition. Keep that mathematical fragment in one rendering slot.
      const adjacent = value.slice(cursor).match(/^\s+[A-Za-z](?:[_^](?:\{[^{}]*\}|[A-Za-z0-9+\-*]))+/);
      if (adjacent) cursor += adjacent[0].length;
    }
    return cursor;
  }

  function wrappedMathEnd(value, start) {
    let closing = "";
    let contentStart = start;
    if (value.startsWith("$$", start)) {
      closing = "$$";
      contentStart += 2;
    } else if (value[start] === "$") {
      if (/^\$\s*\d/.test(value.slice(start))) return start;
      // A few reviewed PDF extractions use an unmatched dollar before a
      // one-letter variable (`$C` / `$U`).  Treat that as a source math
      // marker, while leaving ordinary monetary prose (`$3.99`) untouched.
      const shorthand = value.slice(start + 1).match(/^[A-Za-z](?![A-Za-z0-9])/);
      if (shorthand && value[start + 2] !== "$") return start + 2;
      closing = "$";
      contentStart += 1;
    } else if (value.startsWith("\\(", start)) {
      closing = "\\)";
      contentStart += 2;
    } else if (value.startsWith("\\[", start)) {
      closing = "\\]";
      contentStart += 2;
    } else return start;
    const closingAt = value.indexOf(closing, contentStart);
    if (closingAt < 0 || closingAt === contentStart) return start;
    const content = value.slice(contentStart, closingAt);
    if (closing === "$" && !/[\\_^=<>≤≥∈∑∫]|^\s*[\p{L}][\p{L}\p{N}]*\s*$/u.test(content)) return start;
    return closingAt + closing.length;
  }

  function compactMathEnd(value, start) {
    const before = value[start - 1] || "";
    if (/[\p{L}\p{N}\p{M}_^]/u.test(before)) return start;
    const script = String.raw`(?:\{[^{}\n]+\}|\([^()\n]+\)|\[[^\[\]\n]+\]|[+\-*]|[0-9]+[a-z]*|[A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*|[α-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ])`;
    const atom = String.raw`[\p{L}\p{N}\p{M}]+`;
    const scripts = String.raw`(?:[_^]${script})+`;
    const tail = value.slice(start);
    const match = tail.match(new RegExp(String.raw`^(?:${atom}['′]?(?:\([^()\n]*\))?${scripts}(?:\([^()\n]*\))?|(?:\[[^\[\]\n]*\]|\([^()\n]*\)|\{[^{}\n]*\})${scripts})`, "u"));
    if (!match) return start;
    // Do not require a word boundary after the fragment. PDF extraction can
    // collapse an adjacent factor (`v_iB`); rendering the indexed prefix and
    // preserving the following factor is safer than exposing raw script
    // syntax or guessing that the whole suffix is one index.
    return start + match[0].length;
  }

  function highlightMarkup(source, start, end, ranges) {
    const clipped = (Array.isArray(ranges) ? ranges : []).map((range) => ({
      start: Math.max(start, Number(range?.start)), end: Math.min(end, Number(range?.end))
    })).filter((range) => Number.isInteger(range.start) && Number.isInteger(range.end) && range.end > range.start)
      .sort((left, right) => left.start - right.start);
    let cursor = start;
    let markup = "";
    for (const range of clipped) {
      const rangeStart = Math.max(cursor, range.start);
      if (range.end <= rangeStart) continue;
      markup += `${escapeHTML(source.slice(cursor, rangeStart))}<mark class="match-term">${escapeHTML(source.slice(rangeStart, range.end))}</mark>`;
      cursor = range.end;
    }
    return markup + escapeHTML(source.slice(cursor, end));
  }

  function overlapsRange(start, end, ranges) {
    return (Array.isArray(ranges) ? ranges : []).some((range) => {
      const rangeStart = Number(range?.start);
      const rangeEnd = Number(range?.end);
      return Number.isInteger(rangeStart) && Number.isInteger(rangeEnd) && rangeStart < end && rangeEnd > start;
    });
  }

  function proseCommandMarkup(source, start, end, ranges) {
    let markup = "";
    let cursor = start;
    for (let index = start; index < end; index += 1) {
      const wrappedEnd = Math.min(end, wrappedMathEnd(source, index));
      const commandEnd = source[index] === "\\" ? Math.min(end, texCommandAtomEnd(source, index)) : index;
      const compactEnd = compactMathEnd(source, index);
      const tokenEnd = Math.max(wrappedEnd, commandEnd, compactEnd);
      if (tokenEnd <= index + 1) continue;
      markup += highlightMarkup(source, cursor, index, ranges);
      const original = source.slice(index, tokenEnd);
      // Prose surfaces include paragraphs, list items, buttons, and headings;
      // keep even source display delimiters in an inline slot so the generated
      // HTML remains valid in every allowlisted container.
      const slot = mathSlot(symbolTex(unwrappedMath(original)), false, original);
      markup += overlapsRange(index, tokenEnd, ranges) ? `<mark class="match-term">${slot}</mark>` : slot;
      cursor = tokenEnd;
      index = tokenEnd - 1;
    }
    return markup + highlightMarkup(source, cursor, end, ranges);
  }

  function mathDomainTex(source) {
    const value = unwrappedMath(source);
    const proseWords = /(?<![\\A-Za-z])([A-Za-z]{2,}(?:['’\-][A-Za-z]+)*(?:\s+[A-Za-z]{2,}(?:['’\-][A-Za-z]+)*)*)(?![A-Za-z])/g;
    const protectedProse = transformOutsideProtectedCommands(value, (segment) => segment.replace(
      proseWords,
      (match, phrase, offset, input) => {
        const leading = offset > 0 && /\s/.test(input[offset - 1]) ? " " : "";
        const trailing = offset + match.length < input.length && /\s/.test(input[offset + match.length]) ? " " : "";
        return `\\text{${leading}${phrase.replace(/[{}]/g, "")}${trailing}}`;
      }
    ));
    return symbolTex(protectedProse);
  }

  function prose(source, ranges = []) {
    const value = String(source ?? "");
    const delimiter = /\s+·\s+/u.exec(value);
    if (!delimiter) return proseCommandMarkup(value, 0, value.length, ranges);
    const domainStart = delimiter.index + delimiter[0].length;
    let markup = proseCommandMarkup(value, 0, delimiter.index, ranges);
    markup += highlightMarkup(value, delimiter.index, domainStart, ranges);
    if (!value.slice(domainStart).includes("\\")) {
      return markup + proseCommandMarkup(value, domainStart, value.length, ranges);
    }
    const original = value.slice(domainStart);
    const slot = mathSlot(mathDomainTex(original), false, original);
    return markup + (overlapsRange(domainStart, value.length, ranges) ? `<mark class="match-term">${slot}</mark>` : slot);
  }

  function mathSlot(tex, display = false, original = "") {
    const tag = display ? "div" : "span";
    return `<${tag} class="${display ? "math-display" : "math-inline"}" data-tex="${escapeHTML(tex)}"${original ? ` data-original-text="${escapeHTML(original)}"` : ""}${display ? " tabindex=\"0\" aria-label=\"Scrollable formula\"" : ""}>${escapeHTML(readableMath(tex))}</${tag}>`;
  }

  function curatedFormula(text) {
    return String(text).split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g).map((piece) => {
      if (piece.startsWith("$$")) return mathSlot(symbolTex(piece.slice(2, -2)), true);
      if (piece.startsWith("$")) return mathSlot(symbolTex(piece.slice(1, -1)), false);
      return escapeHTML(piece);
    }).join("");
  }

  function hybridFormula(text) {
    const scriptAtom = String.raw`(?:\{[^{}\n]*\}|\([^()\n]*\)|[A-Za-z0-9*α-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ]+)`;
    const greekNames = Object.keys(namedGreek).sort((left, right) => right.length - left.length).join("|");
    const tokenPattern = new RegExp(
      String.raw`(?:[A-Za-z](?:_|-)\s*(?:tilde|hat|bar)(?:[_^]${scriptAtom})*|\\(?:${greekNames})(?:[_^]${scriptAtom})*|(?<![\\A-Za-z])(?:${greekNames})(?![A-Za-z])(?:[_^]${scriptAtom})*|[α-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ](?:[_^]${scriptAtom})*|[A-Za-z][A-Za-z0-9]*(?:[_^]${scriptAtom})+|[A-Za-zα-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ]\*(?=\s*(?:(?:in|is)\b|[(),.;:=<>≤≥∈]|$)))`,
      "gu"
    );
    const tokenize = (piece) => {
      let output = "";
      let offset = 0;
      for (const match of piece.matchAll(tokenPattern)) {
        output += escapeHTML(piece.slice(offset, match.index));
        output += mathSlot(symbolTex(match[0]), false, match[0]);
        offset = match.index + match[0].length;
      }
      return output + escapeHTML(piece.slice(offset));
    };
    const plain = (piece) => {
      let output = "";
      let segmentStart = 0;
      for (let index = 0; index < piece.length; index += 1) {
        const end = protectedCommandEnd(piece, index);
        if (end < 0) continue;
        output += tokenize(piece.slice(segmentStart, index));
        output += escapeHTML(piece.slice(index, end));
        segmentStart = end;
        index = end - 1;
      }
      return output + tokenize(piece.slice(segmentStart));
    };
    return String(text).split(/(\$\$[\s\S]*?\$\$|\$(?!\s*\d)[^$\n]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g).map((piece) => {
      if (/^(?:\$\$|\$|\\\(|\\\[)/.test(piece)) return mathSlot(symbolTex(unwrappedMath(piece)), piece.startsWith("$$") || piece.startsWith("\\["), piece);
      return plain(piece);
    }).join("");
  }

  function unwrappedMath(source) {
    let value = String(source ?? "").trim();
    const wrapped = value.match(/^(?:\$\$((?:(?!\$\$)[\s\S])+?)\$\$|\$([^$\n]+?)\$|\\\(((?:(?!\\\))[\s\S])+?)\\\)|\\\[((?:(?!\\\])[\s\S])+?)\\\])\s*[.,;:]?$/);
    if (wrapped) return (wrapped[1] ?? wrapped[2] ?? wrapped[3] ?? wrapped[4] ?? "").trim();
    value = value
      .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
      .replace(/\$([^$\n]*?)\$/g, "$1")
      .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
      .replace(/\\\[([\s\S]*?)\\\]/g, "$1");
    // A symbol or formal field is already a math context. Do not pass an
    // unmatched source delimiter through to MathJax as a second math mode.
    return value.replace(/\$/g, "").trim();
  }

  function restatementIsFormula(source) {
    const original = String(source ?? "").trim();
    const value = unwrappedMath(original);
    if (!value || /\b(?:source focus|(?:algorithmic|decision|feasibility|information|optimization|response|transition) rule)\s*:/i.test(value)) return false;
    if (/^\${1,2}[\s\S]*\${1,2}$/.test(original)) return true;
    const normalized = normalizeNamedMath(value);
    const beginsWithNotation = /^(?:(?:[([{]|[+\-])\s*)*(?:\\[A-Za-z]+|(?:[A-Za-z]|[α-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ])(?:[A-Za-z0-9\p{M}]*)(?:\^\{\*\}|\*)?(?:[_^(\[]|\s*(?:=|≤|≥|<|>|∈|\\(?:in|le|ge|ne)(?![A-Za-z])))|(?:arg\s*)?(?:max|min)\b|lim(?:sup|inf)\b|\d+(?=\s*[+\-*/]))/u.test(normalized);
    const hasMathStructure = /(?:[=<>≤≥∈∑∫]|\\(?:arg|max|min|sum|prod|int|frac|tfrac|mathbb|begin|in|le|ge|ne)(?![A-Za-z]))/.test(normalized);
    const proseSignal = /\b(?:after|auditor|before|buyer|captain|choose|client|conditional|consumer|contract|develop|disclose|firm|generator|implement|payoff|regime|subject|type|under|where|whereas)\b/i.test(normalized);
    const scriptCount = (normalized.match(/[_^]/g) || []).length;
    const commandCount = (normalized.match(/\\[A-Za-z]+/g) || []).length;
    const unicodeGreekCount = (normalized.match(/[α-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ]/g) || []).length;
    const operatorCount = (normalized.match(/[+\-*/]/g) || []).length;
    const denseFormula = !proseSignal
      && (scriptCount >= 2 || (commandCount + unicodeGreekCount >= 2 && operatorCount >= 1));
    return beginsWithNotation && (hasMathStructure || denseFormula);
  }

  function formula(paper, component) {
    const fixture = String(paper?.referenceFixtureId || "");
    const curated = fixture ? notation.formulas?.[`${fixture}/${component.id}`] : undefined;
    if (curated !== undefined) {
      return `<div class="formal" data-formula-key="${escapeHTML(`${fixture}/${component.id}`)}" data-original-formal="${escapeHTML(component.formal)}"><span>${escapeHTML(component.formalKind || "Formulation")}</span><div class="formula-body">${curatedFormula(curated)}</div></div>`;
    }
    if (component.formalKind === "Source-extracted equation (not visually verified)"
      || component.formalKind === "Atlas normalized notation"
      || (component.formalKind === "Atlas restatement of source rule" && restatementIsFormula(component.formal))) {
      const formal = unwrappedMath(component.formal);
      return `<div class="formal" data-original-formal="${escapeHTML(component.formal)}"><span>${escapeHTML(component.formalKind)}</span><div class="formula-body">${mathSlot(symbolTex(formal), true, component.formal)}</div></div>`;
    }
    return `<div class="formal"><span>${escapeHTML(component.formalKind || "Formulation")}</span><pre>${hybridFormula(component.formal)}</pre></div>`;
  }

  function symbol(source) {
    return mathSlot(symbolTex(unwrappedMath(source)), false, source);
  }

  function display(source) {
    return mathSlot(symbolTex(unwrappedMath(source)), true, source);
  }

  function expandGreekRanges(source, ranges) {
    const value = String(source ?? "");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_^₊₋])(?:\\\\${namedGreekIdentifier}|(?<!\\\\)${namedGreekIdentifier})(?![\\p{L}\\p{N}\\p{M}_^₊₋])`, "gu");
    const tokens = [...value.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
    return (Array.isArray(ranges) ? ranges : []).map((range) => {
      let start = Number(range?.start);
      let end = Number(range?.end);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return range;
      for (const token of tokens) {
        if (start >= token.end || end <= token.start) continue;
        start = Math.min(start, token.start);
        end = Math.max(end, token.end);
      }
      return { ...range, start, end };
    });
  }

  function annotationTex(source) {
    const value = String(source ?? "");
    const prefix = value.startsWith("\\") ? "\\" : "";
    const body = prefix ? value.slice(1) : value;
    const braced = body.replace(
      new RegExp(`^(${namedGreekNames.join("|")})_([\\p{L}\\p{N}]+)(?=\\^|$)`, "u"),
      "$1_{$2}"
    );
    return symbolTex(`${prefix}${braced}`);
  }

  function annotationSymbolNames(source) {
    const value = String(source ?? "").trim();
    if (!value) return [];
    const opening = new Set(["{", "(", "["]);
    const closing = new Map([["}", "{"], [")", "("], ["]", "["]]);
    const stack = [];
    const parts = [];
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (opening.has(character)) stack.push(character);
      else if (closing.has(character)) {
        if (stack.at(-1) !== closing.get(character)) return [value];
        stack.pop();
      } else if (character === "," && stack.length === 0 && /\s/.test(value[index + 1] || "")) {
        parts.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    if (stack.length || !parts.length) return [value];
    parts.push(value.slice(start).trim());
    return [value, ...parts.filter(Boolean)];
  }

  function annotate(root, model, paper) {
    const fixture = String(paper?.referenceFixtureId || "");
    const expressions = fixture ? notation.inline?.[fixture] || {} : {};
    const names = [...new Set([
      ...namedGreekNames,
      ...Object.keys(expressions),
      ...(model?.components || []).flatMap((component) => (component.symbols || []).flatMap((item) => annotationSymbolNames(item.symbol)))
    ])].filter((name) => name && !["a", "I", "A", "0", "1"].includes(name)).sort((left, right) => right.length - left.length);
    if (!names.length || !globalThis.NodeFilter || !root?.querySelectorAll) return;
    const pattern = new RegExp(`(?<!\\\\)(?<![\\p{L}\\p{N}\\p{M}_^₊₋])(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|\\\\${namedGreekIdentifier}|${namedGreekIdentifier})(?![\\p{L}\\p{N}\\p{M}_^₊₋])`, "gu");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest(".formal,.math-inline,.math-display,mjx-container,button,a,summary,h2,h3,h4,.section-label,.byline,.paper-publication,.coverage")) continue;
      if (node.parentElement.closest("p,li,dd")) nodes.push(node);
    }
    for (const node of nodes) {
      const matches = [...node.textContent.matchAll(pattern)];
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of matches) {
        fragment.append(document.createTextNode(node.textContent.slice(offset, match.index)));
        const slot = document.createElement("span");
        slot.className = "math-inline";
        slot.dataset.tex = expressions[match[0]] || annotationTex(match[0]);
        slot.dataset.originalText = match[0];
        // Keep the no-MathJax state semantically equivalent to the rendered
        // state; in particular, do not expose ASCII `lambda`/`theta` names.
        // The literal spelling remains in data-original-text for search.
        slot.textContent = readableMath(slot.dataset.tex);
        fragment.append(slot);
        offset = match.index + match[0].length;
      }
      fragment.append(document.createTextNode(node.textContent.slice(offset)));
      node.replaceWith(fragment);
    }
  }

  function ready() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      window.MathJax = {
        startup: { typeset: false },
        tex: { packages: ["base", "ams", "newcommand"], maxBuffer: 16000 },
        svg: { fontCache: "local" },
        options: { enableMenu: false, enableAssistiveMml: true }
      };
      const script = document.createElement("script");
      script.src = vendorURL;
      script.onload = () => window.MathJax.startup.promise.then(resolve, reject);
      script.onerror = () => reject(new Error("The local MathJax bundle could not be loaded."));
      document.head.append(script);
    });
    return loading;
  }

  function render(root) {
    if (!root?.isConnected) return Promise.resolve();
    const slots = [...root.querySelectorAll("[data-tex]:not([data-math-ready])")];
    if (!slots.length) return Promise.resolve();
    root.dataset.mathStatus = "loading";
    queue = queue.catch(() => {}).then(async () => {
      try {
        await ready();
        let failures = 0;
        for (const slot of slots) {
          if (!slot.isConnected || slot.dataset.mathReady) continue;
          try {
            const display = slot.classList.contains("math-display");
            const output = await window.MathJax.tex2svgPromise(slot.dataset.tex, { display });
            if (!slot.isConnected) continue;
            slot.replaceChildren(output);
            slot.dataset.mathReady = "true";
          } catch (error) {
            failures += 1;
            slot.classList.add("math-fallback");
            console.warn("One formula could not be rendered; its source notation remains visible.", error);
          }
        }
        window.MathJax.startup.document.updateDocument();
        if (root.isConnected) root.dataset.mathStatus = failures ? "partial" : "ready";
      } catch (error) {
        if (root.isConnected) {
          root.dataset.mathStatus = "fallback";
          for (const slot of slots) slot.classList.add("math-fallback");
        }
        console.warn("Math rendering unavailable; source notation remains readable.", error);
      }
    });
    return queue;
  }

  globalThis.AtlasMath = { annotate, display, expandGreekRanges, formula, normalizeNamedMath, prose, readableMath, render, restatementIsFormula, symbol, symbolTex, unwrappedMath };
})();
