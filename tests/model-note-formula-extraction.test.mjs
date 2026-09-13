import assert from "node:assert/strict";
import test from "node:test";

import {
  formulaFromSection,
  normalizeAuthoredDisplayProse,
  sourceRestatement,
  symbolCandidates
} from "../scripts/model-note-authoring.mjs";
import {
  canonicalizeMathNotation,
  formalStructureIssue
} from "../scripts/model-note-formula-quality.mjs";

const STRICT = "Source-extracted equation (not visually verified)";

function section({ clean = [], source = clean } = {}) {
  return {
    number: "2",
    title: "Allocation Model",
    page: 2,
    endPage: 3,
    lines: clean.map((text) => ({ page: 2, text })),
    sourceLines: source.map((entry) => typeof entry === "string" ? { page: 2, text: entry } : entry)
  };
}

test("formula extraction reads exact source lines and canonicalizes explicit Greek notation", () => {
  const local = section({
    clean: [
      "The planner chooses an allocation before demand is observed.",
      "Let λ_j be the nonnegative allocation selected by firm j."
    ],
    source: [
      "The planner chooses an allocation before demand is observed.",
      "Let λ_j be the nonnegative allocation selected by firm j.",
      "λ_j^* = argmax_{x in [0,1]} p_j(λ_j) (4)"
    ]
  });

  const formula = formulaFromSection(local, "firm allocation", 2);
  assert.deepEqual(formula, {
    formal: "\\lambda_j^* = argmax_{x in [0,1]} p_j(\\lambda_j) (4)",
    equation: "(4)",
    page: 2
  });
  assert.deepEqual(symbolCandidates(local, {}, "firm allocation", 2, { formal: formula.formal }), [{
    symbol: "\\lambda_j",
    meaning: "the nonnegative allocation selected by firm j"
  }]);
  assert.equal(formalStructureIssue(formula.formal, STRICT), "");
});

test("a source equation cannot borrow an unrelated local symbol definition", () => {
  const local = section({
    clean: ["Let Qtk be the prematch queue length vector."],
    source: ["Let Qtk be the prematch queue length vector.", "max r · z"]
  });
  const formula = formulaFromSection(local, "matching queue", 2);
  assert.equal(formula.formal, "max r · z");
  assert.deepEqual(symbolCandidates(local, {}, "matching queue", 2, { formal: formula.formal }), []);
});

test("reviewed notation is validated after canonicalization", () => {
  const local = section({ clean: ["Let q be the order quantity chosen by the retailer."] });
  const record = {
    notation: [
      { symbol: "pi_n(w_n)", meaning: "profit of firm n under action w n" },
      { symbol: "theta_tilde", meaning: "estimated preference parameter for the consumer" },
      { symbol: "$\\lambda$", meaning: "nonnegative tuning parameter chosen by the firm" }
    ]
  };
  assert.deepEqual(
    symbolCandidates(local, record, "profit preference tuning parameter", 2, { includeReviewedCatalog: true })
      .map((entry) => entry.symbol),
    ["\\pi_n(w_n)", "\\theta_tilde", "\\lambda"]
  );
});

test("formula extraction accepts complete chains but rejects table joins and ambiguous flattened Greek", () => {
  const extract = (formal) => formulaFromSection(section({ source: [formal] }), "capacity", 2).formal;
  assert.equal(extract("0 ≤ q ≤ K (5)"), "0 ≤ q ≤ K (5)");
  assert.equal(extract("S = 0 S/k = 2"), "");
  assert.equal(extract("λj = 1 (2)"), "");
  assert.equal(extract("q /equals 1 (2)"), "");
  assert.equal(extract("q /uni2264 K (2)"), "");
});

test("physical-line guards retain a closed neighboring display but reject multiline fractions and qualifiers", () => {
  const closedNeighbor = section({ source: [
    "≥ γ E[d] Constraints (2)",
    "q* = min{K, F^{-1}(c)} (3),",
    "The order quantity is capped by available capacity."
  ] });
  assert.equal(
    formulaFromSection(closedNeighbor, "capacity order quantity", 2).formal,
    "q* = min{K, F^{-1}(c)} (3)"
  );

  const splitFraction = section({ source: [
    "P(N ≥ d) ≥ 1",
    "2 ."
  ] });
  assert.equal(formulaFromSection(splitFraction, "service probability", 2).formal, "");

  const splitConstraint = section({ source: [
    "0 ≤",
    "∑ x_i",
    "i∈S",
    "Q_i(x) ≤ 1−F_i(x)",
    "∀S⊆N",
    "(16)"
  ] });
  assert.equal(formulaFromSection(splitConstraint, "capacity constraint", 2).formal, "");
});

test("canonicalization never creates a fused TeX control word", () => {
  assert.equal(canonicalizeMathNotation("$\\lambda$"), "\\lambda");
  assert.equal(canonicalizeMathNotation("$lambda$"), "\\lambda");
  assert.equal(canonicalizeMathNotation("lambda_j"), "\\lambda_j");
  assert.equal(canonicalizeMathNotation("λ_j"), "\\lambda_j");
  assert.equal(canonicalizeMathNotation("ɛ_i"), "\\varepsilon_i");
  assert.equal(canonicalizeMathNotation("µ_i"), "\\mu_i");
  assert.equal(canonicalizeMathNotation("ɣ_i, ɸ_i, ο, Τ, Μ, Ɛ[X]"), "\\gamma_i, \\varphi_i, o, T, M, \\mathbb{E}[X]");
  assert.equal(canonicalizeMathNotation("λx"), "\\lambda{}x");
  assert.equal(formalStructureIssue(canonicalizeMathNotation("λx = 1"), STRICT), "");
  assert.match(formalStructureIssue(canonicalizeMathNotation("λj = 1"), STRICT), /flattened Greek script/);
  assert.match(formalStructureIssue(canonicalizeMathNotation("ɛi = 1"), STRICT), /flattened Greek script/);
  assert.equal(canonicalizeMathNotation("ε, ɛ, ϵ, φ, ɸ, ϕ, Υ"), "\\varepsilon, \\varepsilon, \\epsilon, \\varphi, \\varphi, \\phi, \\Upsilon");
});

test("preferred-page formula extraction cannot cross a source anchor", () => {
  const local = section({
    source: [
      { page: 2, text: "q = K (2)" },
      { page: 3, text: "x = B (3)" }
    ]
  });
  assert.equal(formulaFromSection(local, "capacity", 2).formal, "q = K (2)");
  assert.equal(formulaFromSection(local, "capacity", 3).formal, "x = B (3)");
});

test("source-local prose definitions retain canonical indexed notation without borrowing unrelated symbols", () => {
  const quote = "Here, pjt ∈ C denotes the observed prices, Xjt ∈ Cd represents other product characteristics, and yjt ∈ R refers to observed demand.";
  const local = section({ clean: [quote] });
  assert.deepEqual(
    symbolCandidates(local, {}, "observed prices product characteristics demand", 2, {
      formal: "",
      sourceQuote: quote
    }),
    [
      { symbol: "p_{jt}", meaning: "observed prices" },
      { symbol: "X_{jt}", meaning: "other product characteristics" },
      { symbol: "y_{jt}", meaning: "observed demand" }
    ]
  );

  const unrelatedQuote = "The error εijt represents an independently distributed demand shock for consumer i and product j.";
  assert.deepEqual(
    symbolCandidates(section({ clean: [quote, unrelatedQuote] }), {}, "demand shock", 2, {
      formal: "",
      sourceQuote: unrelatedQuote
    }),
    [{
      symbol: "\\varepsilon_{ijt}",
      meaning: "an independently distributed demand shock for consumer i and product j"
    }]
  );
});

test("mathematical prose becomes a source-grounded verbal rule instead of exposed PDF notation", () => {
  const switchingCostQuote = "When the follower’s location is exogenously set at one, there exists an SPE if switching cost satisfies 0 < s < 3.";
  assert.equal(
    sourceRestatement(
      "decision",
      switchingCostQuote
    ),
    "Decision rule: When the follower's location is fixed at one, a subgame-perfect equilibrium exists when switching cost is positive and below three."
  );
  assert.deepEqual(
    symbolCandidates(section({ clean: [switchingCostQuote] }), {}, "switching cost equilibrium", 2, {
      formal: "",
      sourceQuote: switchingCostQuote
    }),
    [{ symbol: "s", meaning: "the switching cost" }]
  );
  assert.equal(
    sourceRestatement(
      "algorithm",
      "We assume the actions in the training data are selected by some fixed underlying policy π0 that is known to the decision-maker, where π0(a | x) gives the probability of selecting action a when the context is x."
    ),
    "Algorithmic rule: Training actions are sampled from a fixed policy known to the decision-maker, conditional on the observed context."
  );
  assert.equal(
    formalStructureIssue(sourceRestatement("process", "Compare $q$ with capacity."), "Atlas restatement of source rule"),
    ""
  );
  assert.equal(sourceRestatement("process", "Compare $q$ with capacity."), "Transition rule: update the modeled system using the current state and realized inputs.");
  assert.equal(
    sourceRestatement("interaction", "Hence, we refer to Q(θi, θ−i) as the quantity schedule."),
    "Response rule: each modeled actor responds to the actions and information specified here."
  );
  assert.equal(
    sourceRestatement("algorithm", "The policy π(a | x) selects action a in context x.", [{ symbol: "\\pi", meaning: "the policy" }]),
    "Algorithmic rule: update from observed outcomes, then select the next feasible action."
  );
  assert.equal(
    sourceRestatement("algorithm", "Using the policy value functionQ(·) assumes the training and deployment environments are identical."),
    "Algorithmic rule: update from observed outcomes, then select the next feasible action."
  );
  assert.equal(
    sourceRestatement("decision", "By expanding ˆyl t, define the adjusted inventory position."),
    "Decision rule: select the feasible action defined in this component."
  );
  const auctionQuote = "The optimal quantity function q∗∗ i is decreasing in θi within each region of θi.";
  assert.deepEqual(
    symbolCandidates(section({ clean: [auctionQuote] }), {}, "optimal quantity function hot-spot type", 2, {
      formal: "",
      sourceQuote: auctionQuote
    }),
    [{ symbol: "q_{i}^{**}", meaning: "the optimal quantity schedule for hot-spot provider i" }]
  );
  assert.equal(
    sourceRestatement("interaction", auctionQuote),
    "Strategic response: Under the stated hot-spot cost assumptions, the optimal quantity schedule decreases with hot-spot type within either auction region."
  );
  assert.equal(
    sourceRestatement(
      "objective",
      "The synergy level s is nonnegative when the marginal cost of the postmerger firm wm is at least as small as min{w1, w2}."
    ),
    "Objective relation: The synergy level is nonnegative when the postmerger firm's marginal cost is no greater than the smaller of the two referenced marginal costs."
  );
  assert.equal(
    sourceRestatement(
      "interaction",
      "We denote the equilibrium where both buyers sharing a supplier by $C and one where the buyers sourcing from different suppliers by $U."
    ),
    "Strategic response: The model labels the equilibrium in which both buyers share a supplier as C and the equilibrium in which they source from different suppliers as U."
  );
});

test("authored display prose normalizes source-native labels and set difference without changing unrelated literals", () => {
  const source = "We denote the equilibrium where both buyers sharing a supplier by $C and one where the buyers sourcing from different suppliers by $U.";
  assert.equal(
    normalizeAuthoredDisplayProse(source),
    "We denote the equilibrium in which both buyers share a supplier as C and the equilibrium in which they source from different suppliers as U."
  );
  assert.equal(
    normalizeAuthoredDisplayProse("In the actor interaction, the source expresses Procurement as sourcing: $C and one where the buyers source from different suppliers by $U."),
    "In the actor interaction, the source expresses Procurement as sourcing: C and one where the buyers source from different suppliers by U."
  );
  assert.equal(
    normalizeAuthoredDisplayProse("Customers in E\\A have zero arrival rates, while players in N \\ i remain fixed."),
    "Customers in E ∖ A have zero arrival rates, while players in N ∖ i remain fixed."
  );
  assert.equal(
    normalizeAuthoredDisplayProse("Use S1\\S2, N \\ {i}, clconv(Fi)\\Fi, and A\\⋃j Aj."),
    "Use S1 ∖ S2, N ∖ {i}, clconv(Fi) ∖ Fi, and A ∖ ⋃j Aj."
  );

  // Negative controls: currency, TeX commands, Windows paths, and an ordinary
  // prose backslash are outside the narrowly recognized display notation.
  for (const unchanged of [
    "The supplier pays $500.",
    "The formal uses \\alpha and x\\mid y.",
    "Open C:\\Temp\\Atlas.",
    "Keep the word\\slash example literal.",
    "M\\-Convex is an escaped-hyphen artifact.",
    "Corrupt operands #\\{0}, Xt−1\\8xt−19, and ^+ ^\\{0} stay quarantined."
  ]) {
    assert.equal(normalizeAuthoredDisplayProse(unchanged), unchanged);
  }
});

test("function signatures and their local state definitions are canonicalized without treating prose words as symbols", () => {
  const quote = "Action space F(yt,St) characterizes the set of inventory positions that can be adjusted from yt through feasible order adjustment vector ot.";
  const local = section({ clean: [
    "In period t, the system state is yt.",
    quote,
    "We use latent factors to represent underlying concepts."
  ] });
  assert.deepEqual(
    symbolCandidates(local, {}, "inventory positions state order adjustment", 2, {
      formal: "",
      sourceQuote: quote
    }),
    [
      { symbol: "F(y_{t},S_{t})", meaning: "the action space" },
      { symbol: "o_{t}", meaning: "the order adjustment vector" },
      { symbol: "y_{t}", meaning: "the system state" }
    ]
  );
  assert.deepEqual(
    symbolCandidates(section({ clean: ["We use latent factors to represent underlying concepts."] }), {}, "latent factors", 2, {
      formal: "",
      sourceQuote: "We use latent factors to represent underlying concepts."
    }),
    []
  );
  const monopolyQuote = "I denote the price a monopoly would set at market state Aθ and with a marginal cost of w by pm(Aθ,w).";
  assert.deepEqual(
    symbolCandidates(section({ clean: [monopolyQuote] }), {}, "monopoly price market state marginal cost", 2, {
      formal: "",
      sourceQuote: monopolyQuote
    }),
    [
      { symbol: "A_{\\theta}", meaning: "the market state" },
      { symbol: "w", meaning: "the marginal cost" },
      { symbol: "p_{m}(A_{\\theta},w)", meaning: "the monopoly price as a function of market state and marginal cost" }
    ]
  );
});
