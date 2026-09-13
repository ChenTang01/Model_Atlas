import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { formalStructureIssue, noteFormalStructureIssues } from "../scripts/model-note-formula-quality.mjs";

const modelNotesUrl = process.env.ATLAS_MODEL_NOTES_PATH
  ? pathToFileURL(path.resolve(process.env.ATLAS_MODEL_NOTES_PATH))
  : new URL("../data/model_notes.json", import.meta.url);

const [mathSource, notes, articles] = await Promise.all([
  readFile(new URL("../assets/math.js", import.meta.url), "utf8"),
  readFile(modelNotesUrl, "utf8").then(JSON.parse),
  readFile(new URL("../data/atlas_articles.json", import.meta.url), "utf8").then(JSON.parse)
]);

function mathRuntime(environment = {}) {
  const context = vm.createContext({
    console,
    URL,
    location: { href: "https://example.test/Model_Atlas/index.html" },
    document: environment.document || {
      currentScript: { src: "https://example.test/Model_Atlas/assets/math.js" },
      createElement: () => ({}),
      head: { append() {} }
    },
    ...environment.globals
  });
  context.window = context;
  vm.runInContext(mathSource, context, { filename: "assets/math.js" });
  return context.AtlasMath;
}

test("the public reader renders the published editorial formula without private Mini assets", () => {
  const note = notes.papers.find((paper) => paper.referenceFixtureId === "P001");
  assert.ok(note, "P001 is imported into the main release");
  const component = note.models.flatMap((model) => model.components)
    .find((candidate) => candidate.id === "arrivals-discharges");
  assert.ok(component);
  const markup = mathRuntime().formula(note, component);
  assert.match(markup, /data-original-formal=/);
  assert.ok(markup.includes(component.formal), "the published formulation is retained unchanged");
  assert.match(markup, /data-tex=/);
  assert.doesNotMatch(markup, /<pre>/);
});

test("clean source equations and Unicode symbols receive local MathJax slots", () => {
  const math = mathRuntime();
  const markup = math.formula({}, {
    id: "capacity-rule",
    formal: "q* = min{K, F^{-1}(c)} (3)",
    formalKind: "Source-extracted equation (not visually verified)"
  });
  assert.match(markup, /class="math-display"/);
  assert.match(markup, /data-original-text="q\* = min\{K, F\^\{-1\}\(c\)\} \(3\)"/);
  assert.match(math.symbol("εₜ"), /\\varepsilon_\{t\}/);
});

function visibleFallbackText(markup) {
  return String(markup)
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

test("symbol-meaning prose routes TeX domains through MathJax with a readable fallback", () => {
  const math = mathRuntime();
  const fixtures = [
    "wholesale price committed by the firm to farmers · w \\ge r",
    "candidate demand distribution · P \\in \\mathcal D",
    "customer type and cutoff · [\\underline\\theta,\\overline\\theta]",
    "nonnegative demands with a shared capacity · nonnegative demands with d_N+d_R \\le s",
    "market-size ratio, so the segment has size \\alpha X_H in the high state · positive market-size ratio",
    "binary lockdown indicator · \\{0,1\\}",
    "PDF-corrupted literal capital \\T remains readable"
  ];
  for (const source of fixtures) {
    const markup = math.prose(source);
    assert.match(markup, /class="math-inline"[^>]*data-tex=/, source);
    assert.doesNotMatch(visibleFallbackText(markup), /\\/, `fallback leaked TeX for ${source}`);
    const outsideSlots = markup.replace(/<span class="math-inline"[\s\S]*?<\/span>/g, "");
    assert.doesNotMatch(outsideSlots, /\\/, `a TeX fragment bypassed a math slot for ${source}`);
  }

  const mixed = math.prose(fixtures[3]);
  assert.match(mixed, /data-tex="[^"]*\\text\{nonnegative demands with [^}]*\}[^"]*\\le[^"]*"/,
    "natural-language qualifiers remain upright inside a complete domain formula");
  assert.equal(math.symbolTex("\\T"), "T", "undefined one-letter PDF control words become literal variables");
});

test("highlighted TeX in a symbol meaning expands to the rendered math island", () => {
  const math = mathRuntime();
  const source = "customer type · [\\underline\\theta,\\overline\\theta]";
  const start = source.indexOf("theta");
  const markup = math.prose(source, [{ start, end: start + "theta".length }]);
  assert.match(markup, /<mark class="match-term"><span class="math-inline"[^>]*data-tex=/);
  assert.doesNotMatch(visibleFallbackText(markup), /\\/);
});

test("authored prose isolates compact math without consuming ordinary prose or currency", () => {
  const math = mathRuntime();
  const source = "At $3.99/hour, compare 1-gamma(a-theta)^2, v_iB, C'^{-1}(b_q), [0,1]^2, argmax_{p_j^0}, q_(i,k), N_i^(t−1), $C/$U, and \\(x_i \\in \\mathcal D\\).";
  const markup = math.prose(source);
  const fallbacks = [...markup.matchAll(/<span class="math-inline"[^>]*>([\s\S]*?)<\/span>/g)]
    .map((match) => visibleFallbackText(match[1]));
  const outsideSlots = visibleFallbackText(markup.replace(/<span class="math-inline"[\s\S]*?<\/span>/g, ""));

  assert.ok(fallbacks.length >= 10, "each compact expression is routed through a local MathJax slot");
  assert.match(outsideSlots, /At \$3\.99\/hour, compare/,
    "ordinary currency and surrounding prose remain literal");
  assert.doesNotMatch(outsideSlots, /[\\_^]/, "math syntax never leaks outside a slot");
  assert.ok(fallbacks.every((fallback) => !/[\\^_$]/.test(fallback)),
    `fallback syntax leaked from ${JSON.stringify(fallbacks)}`);
  assert.ok(fallbacks.some((fallback) => fallback.includes("argmax₍pⱼ⁰₎")),
    "nested scripts receive a readable fallback");
  assert.ok(fallbacks.some((fallback) => fallback.includes("γ(a-θ)²")),
    "a scripted function expression is kept together");
  assert.ok(fallbacks.some((fallback) => fallback.includes("xᵢ ∈ D")),
    "unbraced presentation commands have a clean readable fallback");

  const ordinary = "Revenue grew 5% in an A/B test; the posted price is $3.99.";
  assert.equal(math.prose(ordinary), ordinary, "ordinary prose is byte-for-byte visible text");

  const namedGreekFallback = visibleFallbackText(math.symbol("m=ET(m,theta)"));
  assert.match(namedGreekFallback, /m\s*=\s*ET\(m,\s*θ\)/,
    "a commandless Greek name inside a math slot has a Unicode fallback");
  assert.doesNotMatch(namedGreekFallback, /\btheta\b/,
    "a math-slot fallback never exposes the source spelling of named Greek");
});

test("a search hit overlapping compact math marks the complete rendered slot", () => {
  const math = mathRuntime();
  const source = "The score kq^2 determines the choice.";
  const start = source.indexOf("q");
  const markup = math.prose(source, [{ start, end: start + 1 }]);
  assert.match(markup, /<mark class="match-term"><span class="math-inline"[^>]*data-original-text="kq\^2"/);
  assert.doesNotMatch(visibleFallbackText(markup), /[\\^_]/);
});

test("every published symbol meaning with a backslash uses only rendered math slots", () => {
  const math = mathRuntime();
  const failures = [];
  let checked = 0;
  const paperIds = new Set();
  const uniqueMeanings = new Set();
  for (const paper of notes.papers) {
    for (const model of paper.models || []) {
      for (const component of model.components || []) {
        for (const item of component.symbols || []) {
          const source = String(item.meaning || "");
          if (!source.includes("\\")) continue;
          checked += 1;
          paperIds.add(paper.id);
          uniqueMeanings.add(source);
          const markup = math.prose(source);
          const outsideSlots = markup.replace(/<span class="math-inline"[\s\S]*?<\/span>/g, "");
          if (!/class="math-inline"[^>]*data-tex=/.test(markup)) failures.push({ paperId: paper.id, source, reason: "no MathJax slot" });
          if (/\\/.test(outsideSlots)) failures.push({ paperId: paper.id, source, reason: "raw backslash outside MathJax slot" });
          if (/\\/.test(visibleFallbackText(markup))) failures.push({ paperId: paper.id, source, reason: "raw backslash in visible fallback" });
        }
      }
    }
  }
  assert.ok(checked > 0, "the selected release surface includes TeX-bearing symbol meanings");
  if (/release-candidate/i.test(process.env.ATLAS_MODEL_NOTES_PATH || "")) {
    assert.deepEqual({ checked, papers: paperIds.size, unique: uniqueMeanings.size }, { checked: 388, papers: 40, unique: 73 });
  }
  assert.deepEqual(failures, []);
});

test("ASCII Greek names are canonicalized before MathJax sees symbols and equations", () => {
  const math = mathRuntime();
  assert.equal(math.symbolTex("lambda_j"), "\\lambda_{j}");
  assert.equal(math.symbolTex("$lambda$"), "\\lambda", "a raw named-Greek wrapper is removed before TeX rendering");
  assert.equal(math.symbolTex("\\lambda_j"), "\\lambda_{j}", "an existing TeX command is not escaped twice");
  assert.equal(math.symbolTex("p_j(lambda_j)"), "p_{j}(\\lambda_{j})");
  assert.equal(math.symbolTex("Delta=(pi,M)"), "\\Delta=(\\pi,M)");
  assert.equal(math.symbolTex("lambda in [1/3,1/2]"), "\\lambda \\in [1/3,1/2]");
  assert.equal(math.symbolTex("Lambda_i"), "\\Lambda_{i}", "uppercase named Greek symbols use the matching TeX command");
  assert.equal(math.symbolTex("χ_i+Ω"), "\\chi_{i}+\\Omega", "Unicode Greek symbols use TeX commands across the alphabet");
  assert.equal(math.symbolTex("ɛ_i"), "\\varepsilon_{i}", "a PDF Latin-open-e epsilon lookalike becomes valid TeX");
  assert.equal(math.symbolTex("µ_i"), "\\mu_{i}", "the PDF compatibility mu becomes valid TeX");
  assert.equal(math.symbolTex("ɣ_i, ɸ_i, ο, Τ, Μ, Ɛ[X]"), "\\gamma_{i}, \\varphi_{i}, o, T, M, \\mathbb{E}[X]", "other PDF lookalikes and commandless Greek forms become valid TeX");
  assert.equal(math.symbolTex("ε, ɛ, ϵ, φ, ɸ, ϕ, Υ"), "\\varepsilon, \\varepsilon, \\epsilon, \\varphi, \\varphi, \\phi, \\Upsilon", "Unicode variants and PDF lookalikes retain their intended TeX forms");
  assert.equal(math.symbolTex("Upsilon_j"), "\\Upsilon_{j}");
  assert.equal(math.symbolTex("x<=lambda"), "x\\le \\lambda");
  assert.equal(math.symbolTex("theta>=0"), "\\theta\\ge 0");
  assert.equal(math.symbolTex("x!=y"), "x\\ne y");
  assert.equal(math.symbolTex("j \\in {1,2}"), "j \\in {1,2}", "an existing TeX relation is not escaped twice");
  assert.equal(math.symbolTex("p_{in}"), "p_{in}", "identifier text inside a subscript is not changed into membership");
  assert.equal(math.symbolTex("s_i\\in\\{O,B\\}"), "s_{i}\\in\\{O,B\\}", "compact existing TeX membership stays intact");
  assert.equal(math.symbolTex("alphabeta_j"), "alphabeta_{j}", "ordinary identifiers containing Greek-name text are preserved");
  assert.equal(math.symbolTex("X_{ij}=Z_{ij}(e_{ij})^vartheta"), "X_{ij}=Z_{ij}(e_{ij})^{\\vartheta}");
  assert.equal(math.symbolTex("(1-λ)^2m_o^2"), "(1-\\lambda)^{2}m_{o}^{2}", "an unbraced numeric exponent does not swallow the next variable");
  assert.equal(math.symbolTex("\\pi_i=rD_i-I_i s_iD_i"), "\\pi_{i}=rD_{i}-I_{i} s_{i}D_{i}", "an index does not swallow an adjacent factor");
  assert.equal(math.symbolTex("\\Pi_P=\\alpha(p_HD_H+p_LD_L)"), "\\Pi_{P}=\\alpha(p_{H}D_{H}+p_{L}D_{L})");
  assert.equal(math.symbolTex("p_tilde_ij"), "\\tilde{p}_{ij}");
  assert.equal(math.symbolTex("u_tilde_i(beta)"), "\\tilde{u}_{i}(\\beta)");
  assert.equal(math.symbolTex("π_hat_i"), "\\hat{\\pi}_{i}");
  assert.equal(math.symbolTex("theta_tilde"), "\\tilde{\\theta}");
  assert.equal(math.symbolTex("w-bar"), "\\bar{w}");
  assert.equal(math.symbolTex("q and q-tilde"), "q,\\;\\tilde{q}");
  assert.equal(math.symbolTex("V̄"), "\\bar{V}");
  assert.equal(math.symbolTex("c̃_2(δ)"), "\\tilde{c}_{2}(\\delta)");
  assert.equal(math.symbolTex("tilde{sigma}_j"), "\\tilde{\\sigma}_{j}");
  assert.equal(math.symbolTex("pi-dot(y)"), "\\dot{\\pi}(y)");
  assert.equal(math.symbolTex("Nhat_t^u"), "\\hat{N}_{t}^{u}");
  assert.equal(math.symbolTex("u(theta,hat_theta)"), "u(\\theta,\\hat{\\theta})");
  assert.equal(
    math.symbolTex("\\theta^t, \\thetâ^t"),
    "\\theta^{t}, \\hat{\\theta}^{t}",
    "a combining accent on a TeX command remains attached to the whole symbol"
  );
  assert.equal(math.symbolTex("xi_brmt-hat"), "\\hat{\\xi_{brmt}}");
  assert.equal(math.symbolTex("y:X→Y, ≽_y"), "y:X\\to Y, \\succeq _{y}");
  assert.equal(math.symbolTex("Y_i(t)∈{0,1,∅}"), "Y_{i}(t)\\in {0,1,\\varnothing }");
  assert.equal(math.symbolTex("U_empty"), "U_{\\varnothing}");
  assert.equal(math.symbolTex("w_1empty"), "w_{1\\varnothing}");
  assert.equal(math.symbolTex("s_plus, s_minus"), "s_{+}, s_{-}");
  assert.equal(math.symbolTex("calligraphic F"), "\\mathcal{F}");
  assert.equal(math.symbolTex("value loss"), "\\text{value loss}");
  assert.equal(math.symbolTex("In, Out"), "\\text{In, Out}");
  assert.equal(math.symbolTex("I_iw_{S,i}"), "I_{i}w_{S,i}");
  assert.equal(math.symbolTex("u_i_solo"), "u_{i,solo}");
  assert.equal(math.symbolTex("DCS_without_fines"), "DCS_{without,fines}");
  assert.equal(math.symbolTex("E_[y∼ρ_(x,a)][y_i]"), "E_{y\\sim \\rho_{x,a}}[y_{i}]", "bracketed source shorthands become one complete subscript");

  assert.equal(math.symbolTex("\\Pr(\\text{arrival in interval }i)"), "\\Pr(\\text{arrival in interval }i)");
  assert.equal(math.symbolTex("\\text{lambda type}"), "\\text{lambda type}");
  assert.equal(math.symbolTex("\\mathrm{pi}"), "\\mathrm{pi}");
  assert.equal(math.symbolTex("\\operatorname{Gamma}(x)"), "\\operatorname{Gamma}(x)");

  const markup = math.symbol("lambda_j^*");
  assert.match(markup, /data-tex="\\lambda_\{j\}\^\{\*\}"/);
  assert.match(markup, /data-original-text="lambda_j\^\*"/);

  const delimitedSymbol = math.symbol("$\\lambda_j$");
  assert.match(delimitedSymbol, /data-tex="\\lambda_\{j\}"/);
  assert.doesNotMatch(delimitedSymbol, /data-tex="\$/);

  const reportedWrapper = math.symbol("$lambda$");
  assert.match(reportedWrapper, /data-tex="\\lambda"/);
  assert.doesNotMatch(reportedWrapper, /data-tex="\$/);

  const equation = math.formula({}, {
    id: "legacy-greek-equation",
    formal: "p_j(lambda_j)<=0",
    formalKind: "Source-extracted equation (not visually verified)"
  });
  assert.match(equation, /data-tex="p_\{j\}\(\\lambda_\{j\}\)\\le 0"/);

  const normalized = math.formula({}, {
    id: "normalized-greek-equation",
    formal: "lambda_j^* >= 0",
    formalKind: "Atlas normalized notation"
  });
  assert.match(normalized, /data-tex="\\lambda_\{j\}\^\{\*\} \\ge  0"/);
  assert.doesNotMatch(normalized, /<pre>/);
});

test("reviewed shorthand normalizes to supported, unambiguous TeX", () => {
  const math = mathRuntime();

  assert.equal(math.symbolTex("N\\B"), "N\\setminus B", "set difference is not parsed as an undefined command");
  assert.equal(
    math.symbolTex("t∈N\\(S∪{j})"),
    "t\\in N\\setminus (S∪{j})",
    "set difference before a parenthesized set is not parsed as a nested math delimiter"
  );
  assert.equal(
    math.symbolTex(String.raw`\begin{aligned}D_u&=1,\\D_2&=2.\end{aligned}`),
    String.raw`\begin{aligned}D_{u}&=1,\\D_{2}&=2.\end{aligned}`,
    "aligned and cases row breaks survive one-letter command cleanup"
  );
  assert.equal(
    math.symbolTex("Out -> (u_A,u_B); In & Not Roll"),
    "Out -> (u_{A},u_{B}); In \\& Not Roll",
    "a prose ampersand in a display formula is escaped outside alignment environments"
  );
  assert.equal(
    math.symbolTex("G_{\\theta}(\\boldsymbol\\mu,r)"),
    "G_{\\theta}(\\mathbf{\\mu},r)",
    "bold Greek vectors stay within the bundled MathJax command surface"
  );
  assert.equal(
    math.symbolTex("n_g^if(p^i)+n_g^in_d^i"),
    "n_{g}^{i}f(p^{i})+n_{g}^{i}n_{d}^{i}",
    "an adjacent factor does not become a second script on the same base"
  );

  for (const [source, expected] of new Map([
    ["w_1^CMI", "w_{1}^{CMI}"],
    ["n_AV,i", "n_{AV},i"],
    ["alpha_CW", "\\alpha_{CW}"],
    ["I_PQ", "I_{PQ}"],
    ["T^Public", "T^{Public}"],
    ["pi_noAI, pi_AI", "\\pi_{noAI}, \\pi_{AI}"],
    ["P_FULL,P_SUB", "P_{FULL},P_{SUB}"],
    ["p_aF*,p_rF", "p_{aF}^{*},p_{rF}"],
    ["p_HD_H", "p_{H}D_{H}"],
    ["k_Cv", "k_{C}v"],
    ["n_iN", "n_{i}N"],
    ["p_Ix", "p_{I}x"]
  ])) {
    assert.equal(math.symbolTex(source), expected, source);
  }

  for (const [source, expected] of new Map([
    ["q*(w;x)", "q^{*}(w;x)"],
    ["pi_i*(s_i,s_j)", "\\pi_{i}^{*}(s_{i},s_{j})"],
    ["co(v*)", "co(v^{*})"],
    ["psi* in {0,1}", "\\psi^{*} \\in {0,1}"],
    ["e_F*,pi_F*", "e_{F}^{*},\\pi_{F}^{*}"],
    ["s_plus*(1-c)+s_minus", "s_{+}*(1-c)+s_{-}"],
    ["alpha_H^{sigma_K}*(1-gamma)", "\\alpha_{H}^{\\sigma_{K}}*(1-\\gamma)"],
    ["(x+y)*(a+b)", "(x+y)*(a+b)"]
  ])) {
    assert.equal(math.symbolTex(source), expected, source);
  }

  assert.equal(math.symbolTex("k,s"), "k,s");
  assert.equal(math.symbolTex("A, B"), "A, B");
  assert.equal(math.symbolTex("In, Out"), "\\text{In, Out}");
  assert.equal(math.symbolTex("integral_0^tau"), "\\int_{0}^{\\tau}");
  assert.equal(math.symbolTex("Σ_i"), "\\sum_{i}");
});

test("dense reviewed objectives route through one display-math slot", () => {
  const math = mathRuntime();
  for (const formal of [
    "\\max_{P}\\;V_f",
    "Y(p+μ)+λ pi_hat_i",
    "(\\Pi_{jt}^{H}-\\Pi_{jt}^{H,0})^{\\delta_{jt}}(\\Pi_{jt}^{F}-\\Pi_{jt}^{F,0})^{1-\\delta_{jt}}",
    "Y in argmax_{Y' in F} sum_i v_i(Y'_i)"
  ]) {
    assert.equal(math.restatementIsFormula(formal), true, formal);
    const markup = math.formula({}, { id: "objective", formal, formalKind: "Atlas restatement of source rule" });
    assert.match(markup, /class="math-display"/, formal);
    assert.doesNotMatch(markup, /<pre>/, formal);
  }

  const verbal = "The captain chooses a regime before demand is realized.";
  assert.equal(math.restatementIsFormula(verbal), false);
  assert.match(
    math.formula({}, { id: "objective", formal: verbal, formalKind: "Atlas restatement of source rule" }),
    /<pre>/
  );
  const currency = "Out gives ($1.25,$1.25); lambda_j records the type.";
  const currencyMarkup = math.formula({}, { id: "objective", formal: currency, formalKind: "Atlas restatement of source rule" });
  assert.match(currencyMarkup, /\$1\.25,\$1\.25/);
  assert.doesNotMatch(currencyMarkup, /data-tex="[^"]*\$/);
});

test("math wrappers are removed without leaking nested math delimiters into MathJax", () => {
  const math = mathRuntime();
  const cases = new Map([
    ["$x$ + $y$", "x + y"],
    ["$$x$$ + $$y$$", "x + y"],
    ["$\\lambda_j$.", "\\lambda_{j}"],
    ["\\(lambda_j\\)", "\\lambda_{j}"],
    ["\\[lambda_j\\]", "\\lambda_{j}"],
    ["$$x$", "x"]
  ]);
  for (const [source, expected] of cases) {
    const markup = math.symbol(source);
    assert.ok(markup.includes(`data-tex="${expected}"`), `${source} -> ${markup}`);
    assert.doesNotMatch(markup.match(/data-tex="([^"]*)"/)?.[1] || "", /\$/);
  }
});

test("reviewed Atlas restatement equations are typeset instead of exposing source TeX", () => {
  const math = mathRuntime();
  const objective = math.formula({}, {
    id: "objective",
    formal: "\\lambda_j^*=\\arg\\max_{\\lambda_j}\\Pi_j(\\lambda_j),\\qquad j=1,2.",
    formalKind: "Atlas restatement of source rule"
  });
  assert.match(objective, /class="math-display"/);
  assert.match(objective, /data-tex="\\lambda_\{j\}\^\{\*\}=\\arg\\max_\{\\lambda_\{j\}\}\\Pi_\{j\}\(\\lambda_\{j\}\),\\qquad j=1,2\."/);
  assert.doesNotMatch(objective, /<pre>/);

  const delimited = math.formula({}, {
    id: "delimited",
    formal: "$lambda_j^* >= 0$",
    formalKind: "Atlas restatement of source rule"
  });
  assert.match(delimited, /data-tex="\\lambda_\{j\}\^\{\*\} \\ge  0"/);
  assert.doesNotMatch(delimited, /data-tex="\$/);

  const verbal = math.formula({}, {
    id: "verbal",
    formal: "Decision rule: choose lambda only after observing demand.",
    formalKind: "Atlas restatement of source rule"
  });
  assert.match(verbal, /<pre>/);
  assert.match(verbal, /data-tex="\\lambda"/, "named notation inside a verbal formal is still typeset inline");

  const hybrid = math.formula({}, {
    id: "hybrid",
    formal: "Firm: max E[sum_{t>=0} delta^t pi_t], where service is accepted.",
    formalKind: "Atlas restatement of source rule"
  });
  assert.match(hybrid, /<pre>/);
  assert.match(hybrid, /data-tex="\\delta\^\{t\}"/);
  assert.match(hybrid, /data-tex="\\pi_\{t\}"/);

  const hybridBoundaries = math.formula({}, {
    id: "hybrid-boundaries",
    formal: "Out gives ($1.25,$1.25); U-tilde_p^d uses V_θ, pi_g^Gen, and pi_ED.",
    formalKind: "Atlas restatement of source rule"
  });
  assert.match(hybridBoundaries, /\$1\.25,\$1\.25/, "currency remains prose rather than becoming a math delimiter pair");
  assert.doesNotMatch(hybridBoundaries, /data-original-text="\$1\.25,\$/);
  assert.match(hybridBoundaries, /data-tex="\\tilde\{U\}_\{p\}\^\{d\}"/);
  assert.match(hybridBoundaries, /data-tex="V_\{\\theta\}"/);
  assert.match(hybridBoundaries, /data-tex="\\pi_\{g\}\^\{Gen\}"/);
  assert.match(hybridBoundaries, /data-tex="\\pi_\{ED\}"/);

  const protectedHybrid = math.formula({}, {
    id: "protected-hybrid",
    formal: "Definition: \\text{lambda in interval} is prose, while lambda_j is notation.",
    formalKind: "Atlas restatement of source rule"
  });
  assert.match(protectedHybrid, /\\text\{lambda in interval\}/);
  assert.equal((protectedHybrid.match(/data-tex="\\lambda_\{j\}"/g) || []).length, 1);

  for (const formal of [
    "x_i=y_i",
    "u(e_i,e_{-i},θ)=r(e_i,e_{-i},θ)-c(e_i,e_{-i},θ)",
    "b*_{s,t}=argmax_{b∈B_{s,t}}[P_{s,b,t}+v_{s,b}]",
    "arg max_{p_t} sum_{t>=0} delta_f^t pi(S_t,p_t,xi_t^p)",
    "q̂(e)∈argmax_q π_S(q|e); e*∈argmax_{e∈{0,e_H}} E_{D,K}[π_M(e,q̂(e))]"
  ]) {
    const rendered = math.formula({}, { id: "plain-equation", formal, formalKind: "Atlas restatement of source rule" });
    assert.match(rendered, /class="math-display"/, formal);
    assert.doesNotMatch(rendered, /<pre>/, formal);
  }
  assert.equal(
    math.symbolTex("b*_{s,t}=argmax_{b∈B_{s,t}}[P_{s,b,t}+v_{s,b}]"),
    "b^{*}_{s,t}=\\operatorname*{argmax}_{b\\in B_{s,t}}[P_{s,b,t}+v_{s,b}]"
  );
});

test("optional presentation maps preserve protected TeX prose and stable formula keys", () => {
  // An original synthetic fixture verifies the optional map contract. The
  // public site itself runs without the private Mini authoring workspace.
  const math = mathRuntime({ globals: { MINI_ATLAS_NOTATION: {
    inline: {},
    formulas: { "T001/example": "$\\Pr(\\text{arrival in interval } i)=p_i$" }
  } } });
  const note = { referenceFixtureId: "T001" };
  const component = { id: "example", formal: "Pr(arrival in interval i)=p_i", formalKind: "Atlas normalized notation" };
  const markup = math.formula(note, component);
  assert.match(markup, /data-formula-key="T001\/example"/);
  assert.match(markup, /data-tex=/);
  assert.match(markup, /\\text\{arrival in interval \}/);
  assert.doesNotMatch(markup, /arrival \\in interval/);
});

test("the reported lambda paper renders both its objective and symbol table as TeX", () => {
  const math = mathRuntime();
  const note = notes.papers.find((paper) => paper.id === "doi-10-1287-mksc-2023-0175");
  assert.ok(note, "the reported paper is present in the public release");
  const components = note.models.flatMap((model) => model.components || []);
  const objective = components.find((component) => component.id === "objective-and-constraints");
  assert.ok(objective, "the source-grounded objective component is present");
  const equation = math.formula(note, objective);
  assert.match(equation, /class="math-display"/);
  assert.match(equation, /data-tex="\\lambda_\{j\}\^\{\*\}=\\arg\\max_\{\\lambda_\{j\}\}\\Pi_\{j\}\(\\lambda_\{j\}\),\\qquad j=1,2\."/);
  assert.doesNotMatch(equation, /<pre>/);

  const symbols = components.find((component) => component.symbols?.some((item) => /lambda/.test(item.symbol)))?.symbols || [];
  assert.deepEqual(symbols.slice(0, 3).map((item) => math.symbolTex(item.symbol)), [
    "\\lambda_{j}",
    "\\lambda_{j}^{*}",
    "\\Pi_{j}(\\lambda_{j})"
  ]);
});

test("bare Greek-name fixtures and any published legacy symbols normalize to Greek TeX commands", () => {
  const math = mathRuntime();
  const bareGreek = /(?<![\\A-Za-z])(varepsilon|vartheta|varpi|varrho|varsigma|varphi|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![A-Za-z])/g;
  const fixtures = [
    ["lambda_j", "\\lambda_{j}"],
    ["Gamma_i", "\\Gamma_{i}"],
    ["varepsilon_t", "\\varepsilon_{t}"],
    ["varphi", "\\varphi"],
    ["Pi_j(lambda_j)", "\\Pi_{j}(\\lambda_{j})"]
  ];
  for (const [source, expected] of fixtures) assert.equal(math.symbolTex(source), expected);

  for (const paper of notes.papers) {
    for (const model of paper.models || []) {
      for (const component of model.components || []) {
        for (const item of component.symbols || []) {
          const names = [...String(item.symbol || "").matchAll(bareGreek)].map((match) => match[1]);
          if (!names.length) continue;
          const tex = math.symbolTex(item.symbol);
          for (const name of names) {
            assert.ok(tex.includes(`\\${name}`), `${paper.id}: ${item.symbol} -> ${tex}`);
          }
        }
      }
    }
  }
});

test("every reviewed model-map objective and notation entry reaches clean Atlas TeX", () => {
  const math = mathRuntime();
  const reviewed = articles.records.filter((paper) => paper.analysis_level === "deep model map");
  assert.equal(reviewed.length, 298);
  assert.equal(reviewed.reduce((count, paper) => count + (paper.notation || []).length, 0), 2039);

  const bareGreek = /(?<![\\A-Za-z])(varepsilon|vartheta|varpi|varrho|varsigma|varphi|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![A-Za-z])/;
  const failures = [];
  let displayObjectives = 0;
  let hybridObjectives = 0;

  const inspect = (paperId, kind, source, tex) => {
    const checks = [
      ["raw dollar delimiter", tex.includes("$")],
      ["bare named Greek", bareGreek.test(tex.replace(/\\text\{[^{}]*\}/g, ""))],
      ["legacy named modifier", /(?:_|-)(?:tilde|hat|bar|dot|under|star|plus|minus|empty)(?=$|[_^(),.;+\-*/=<>≤≥\s])/.test(tex)],
      ["unsupported bundled command", /\\(?:boldsymbol|B)(?![A-Za-z])/.test(tex)],
      ["unsupported Unicode math glyph", /[≤≥≠∈∉≈≡∝∼→←↔↦≽≼∅⊂⊆⊃⊇∖‖·∑∫∞]/.test(tex)],
      ["duplicate subscript or superscript", /_\{[^{}]*\}_\{|\^\{[^{}]*\}\^\{/.test(tex)],
      ["unbraced uppercase script label", /(?:_|\^)[A-Z][A-Z0-9]+/.test(tex)],
      ["variable group rendered as prose", /\\text\{[A-Za-z](?:\s*,\s*[A-Za-z])+\}/.test(tex)],
      ["named sign leaked into a script", /\{(?:plus|minus)\}/.test(tex)],
      ["literal optimality star", /[A-Za-z0-9]\*(?=\s*(?:[_^=<>]|\\(?:in|le|ge|ne)|(?:in|is)\b|$|[,.;:)]|\())/.test(tex.replace(/\\operatorname\*/g, ""))]
    ];
    for (const [reason, failed] of checks) {
      if (failed) failures.push({ paperId, kind, source, tex, reason });
    }
  };

  for (const paper of reviewed) {
    const formal = String(paper.objective?.formula || "");
    const markup = math.formula({}, {
      id: "objective",
      formal,
      formalKind: "Atlas restatement of source rule"
    });
    if (markup.includes('class="math-display"')) displayObjectives += 1;
    else hybridObjectives += 1;
    for (const match of markup.matchAll(/data-tex="([^"]*)"/g)) {
      inspect(paper.id, "objective slot", formal, match[1]);
    }
    // Direct normalization audits the complete expression even when prose and
    // notation intentionally share the hybrid presentation path.
    inspect(paper.id, "objective normalization", formal, math.symbolTex(formal).replace(/\$/g, ""));

    for (const item of paper.notation || []) {
      const source = String(item.symbol || "");
      const tex = math.symbolTex(source);
      inspect(paper.id, "notation", source, tex);
      const markup = math.symbol(source);
      for (const match of markup.matchAll(/data-tex="([^"]*)"/g)) {
        if (match[1].includes("$")) failures.push({ paperId: paper.id, kind: "notation slot", source, tex: match[1], reason: "raw dollar delimiter" });
      }
    }
  }

  assert.equal(displayObjectives, 284, "dense mathematical objectives use a single display slot");
  assert.equal(hybridObjectives, 14, "mixed prose-and-notation objectives retain hybrid rendering");
  assert.deepEqual(failures, []);
});

test("every published formulation and symbol is structurally complete before rendering", () => {
  const math = mathRuntime();
  const formalIssues = notes.papers.flatMap((paper) => noteFormalStructureIssues(paper)
    .map((issue) => ({ paperId: paper.id, ...issue })));
  assert.deepEqual(formalIssues, []);

  const symbolIssues = [];
  let checked = 0;
  for (const paper of notes.papers) {
    for (const model of paper.models || []) {
      for (const component of model.components || []) {
        for (const item of component.symbols || []) {
          checked += 1;
          const reason = formalStructureIssue(item.symbol, "");
          if (reason) symbolIssues.push({ paperId: paper.id, modelId: model.id, componentId: component.id, symbol: item.symbol, reason });
          const tex = math.symbolTex(item.symbol);
          if (tex.includes("$")) symbolIssues.push({ paperId: paper.id, modelId: model.id, componentId: component.id, symbol: item.symbol, reason: "raw dollar delimiter reached MathJax" });
        }
      }
    }
  }
  assert.ok(checked > 100, "the release contains a substantive symbol-table regression surface");
  assert.deepEqual(symbolIssues, []);
});

test("prose annotation renders named Greek identifiers inside search highlights", () => {
  const replacements = [];
  const textNode = (textContent, insideMark = false) => ({
    textContent,
    parentElement: {
      closest(selector) {
        if (selector === "p,li,dd") return this;
        return insideMark && selector.split(",").includes("mark") ? this : null;
      }
    },
    replaceWith(fragment) { replacements.push({ source: textContent, insideMark, children: fragment.children }); }
  });
  const nodes = [
    textNode("lambda_j", true),
    textNode("theta affects demand"),
    textNode("theta_1i"),
    textNode("Use \\theta, \\theta_{ki}, and theta_{ki}."),
    textNode("Use {AB, C}, e \\in {0, 1}, x_i, and y_j."),
    textNode("alphabeta is an ordinary identifier")
  ];
  let index = -1;
  const document = {
    currentScript: { src: "https://example.test/Model_Atlas/assets/math.js" },
    createTreeWalker() {
      return {
        currentNode: null,
        nextNode() {
          index += 1;
          this.currentNode = nodes[index];
          return index < nodes.length;
        }
      };
    },
    createDocumentFragment() {
      return { children: [], append(child) { this.children.push(child); } };
    },
    createTextNode(textContent) { return { textContent }; },
    createElement(tag) {
      assert.equal(tag, "span");
      return { className: "", dataset: {}, textContent: "" };
    },
    head: { append() {} }
  };
  const math = mathRuntime({ document, globals: { NodeFilter: { SHOW_TEXT: 4 } } });
  math.annotate({ querySelectorAll() { return []; } }, {
    components: [{ symbols: [
      { symbol: "\\theta", meaning: "type" },
      { symbol: "{AB, C}", meaning: "a set" },
      { symbol: "e \\in {0, 1}", meaning: "a binary indicator" },
      { symbol: "x_i, y_j", meaning: "two indexed variables" }
    ] }]
  }, {});

  assert.equal(replacements.length, 5, "ordinary identifiers containing a Greek-name substring stay untouched");
  const highlighted = replacements.find((replacement) => replacement.insideMark);
  const highlightedSlot = highlighted.children.find((child) => child.className === "math-inline");
  assert.equal(highlightedSlot.dataset.tex, "\\lambda_{j}");
  assert.equal(highlightedSlot.dataset.originalText, "lambda_j");
  const proseSlot = replacements.find((replacement) => replacement.source === "theta affects demand").children
    .find((child) => child.className === "math-inline");
  assert.equal(proseSlot.dataset.tex, "\\theta");
  assert.equal(proseSlot.textContent, "θ", "annotated prose has a Unicode no-MathJax fallback");
  const indexedSlot = replacements.find((replacement) => replacement.source === "theta_1i").children
    .find((child) => child.className === "math-inline");
  assert.equal(indexedSlot.dataset.tex, "\\theta_{1i}");
  assert.equal(indexedSlot.textContent, "θ₁ᵢ", "indexed named Greek has a readable fallback");

  const escapedSlots = replacements.find((replacement) => replacement.source.startsWith("Use ")).children
    .filter((child) => child.className === "math-inline");
  assert.deepEqual(escapedSlots.map((slot) => slot.dataset.originalText), ["\\theta", "\\theta_{ki}", "theta_{ki}"]);
  assert.deepEqual(escapedSlots.map((slot) => slot.dataset.tex), ["\\theta", "\\theta_{ki}", "\\theta_{ki}"]);
  assert.deepEqual(escapedSlots.map((slot) => slot.textContent), ["θ", "θₖᵢ", "θₖᵢ"]);

  const setSlots = replacements.find((replacement) => replacement.source.startsWith("Use {AB")).children
    .filter((child) => child.className === "math-inline");
  assert.deepEqual(setSlots.map((slot) => slot.dataset.originalText), ["{AB, C}", "e \\in {0, 1}", "x_i", "y_j"]);
  assert.deepEqual(setSlots.map((slot) => slot.dataset.tex), ["{AB, C}", "e \\in {0, 1}", "x_{i}", "y_{j}"]);
  assert.ok(setSlots.every((slot) => !["{AB", "C}", "e \\in {0", "1}"].includes(slot.dataset.tex)),
    "comma splitting never emits an unbalanced set fragment");

  const identifier = "theta_1i";
  for (const query of ["theta", "1i", identifier]) {
    const start = identifier.indexOf(query);
    const [expanded] = math.expandGreekRanges(identifier, [{ start, end: start + query.length }]);
    assert.deepEqual([expanded.start, expanded.end], [0, identifier.length], query);
  }
  const escapedIdentifier = "Use \\theta_{ki}.";
  const queryStart = escapedIdentifier.indexOf("theta");
  const [expandedEscaped] = math.expandGreekRanges(escapedIdentifier, [{ start: queryStart, end: queryStart + 5 }]);
  assert.equal(escapedIdentifier.slice(expandedEscaped.start, expandedEscaped.end), "\\theta_{ki}");
});
