import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATED_REVIEW_STATUS,
  mapComponentRelevance,
  scoreComponentConcepts,
  sourceSupportsRole
} from "../scripts/model-note-relevance.mjs";

const concepts = [
  { id: "pricing", label: "Pricing", aliases: ["price setting", "pricing decision"], related: ["dynamic-pricing", "revenue-management"] },
  { id: "dynamic-pricing", label: "Dynamic pricing", aliases: ["time-varying pricing"], related: ["pricing"] },
  { id: "revenue-management", label: "Revenue management", aliases: ["revenue optimization", "RM model"], related: ["pricing"] },
  { id: "risk-management", label: "Risk management", aliases: ["risk control"], related: ["robust-optimization"] },
  { id: "uncertainty", label: "Uncertainty", aliases: ["uncertain environment"], related: ["distributional-ambiguity"] },
  { id: "inventory", label: "Inventory", aliases: ["stock"], related: [] },
  { id: "optimization", label: "Optimization", aliases: ["mathematical optimization"], related: ["decision-making"] },
  { id: "decision-making", label: "Decision making", aliases: ["decision rule"], related: ["optimization"] },
  { id: "model-objective", label: "Model objective", aliases: ["modeled objective"], related: ["optimization"] },
  { id: "information-structure", label: "Information structure", aliases: ["available information"], related: [] },
  { id: "process-dynamics", label: "Process dynamics", aliases: ["system transition"], related: [] }
];

test("pricing is selected only from a pricing component passage", () => {
  const pricing = mapComponentRelevance({
    title: "Seller price decision",
    text: "The seller sets a price for each product before demand arrives.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: [{ page: 4, section: "Pricing decision", quote: "The seller sets a price for each product before demand arrives." }]
  });
  assert.deepEqual(pricing.concepts, ["pricing"]);
  assert.equal(pricing.conceptBindings[0].status, "modeled");
  assert.equal(pricing.conceptBindings[0].reviewStatus, AUTOMATED_REVIEW_STATUS);

  const inventory = mapComponentRelevance({
    title: "Stock balance",
    text: "Remaining stock is carried into the next period.",
    role: "state",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: [{ page: 5, section: "Stock balance", quote: "Remaining stock is carried into the next period." }]
  });
  assert.deepEqual(inventory.concepts, ["inventory"]);
  assert.ok(!inventory.conceptBindings.some((binding) => binding.conceptId === "pricing"));
});

test("specific risk management suppresses related generic uncertainty", () => {
  const result = mapComponentRelevance({
    title: "Risk management policy",
    text: "The risk management policy protects the firm under demand uncertainty.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: [{ page: 6, section: "Risk management", quote: "The risk management policy protects the firm under demand uncertainty." }]
  });
  assert.deepEqual(result.concepts, ["risk-management"]);
  assert.deepEqual(result.conceptBindings.map((binding) => binding.conceptId), ["risk-management"]);
});

test("related concepts receive no support merely through a registry edge", () => {
  const result = mapComponentRelevance({
    title: "Price choice",
    text: "The seller chooses a price for the product.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: [{ page: 7, section: "Price choice", quote: "The seller chooses a price for the product." }]
  });
  assert.deepEqual(result.concepts, ["pricing"]);
  assert.ok(!result.concepts.includes("revenue-management"));
  assert.ok(!result.conceptBindings.some((binding) => binding.conceptId === "revenue-management"));
});

test("empty local evidence yields an unknown broad binding, not a modeled default", () => {
  const result = mapComponentRelevance({
    title: "",
    text: "",
    role: "objective",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: []
  });
  assert.deepEqual(result.concepts, []);
  assert.deepEqual(result.unresolved, {
    reason: "no-component-local-concept-support",
    suggestedConceptId: "model-objective"
  });
  assert.deepEqual(result.conceptBindings, [{
    conceptId: "model-objective",
    status: "unknown",
    representation: "Automated source mapping found no component-local language that establishes how Model objective is used for this objective component.",
    conditionRefs: [],
    sourceRefs: [],
    reviewStatus: AUTOMATED_REVIEW_STATUS
  }]);
});

test("a clean local role predicate receives a source-specific broad binding when no taxonomy phrase occurs", () => {
  const result = mapComponentRelevance({
    title: "Observed signals",
    text: "The planner observes a signal before acting.",
    role: "information",
    conceptDefinitions: concepts,
    conditions: ["The signal is observed before the action."],
    symbols: [{ symbol: "z", meaning: "unrelated accounting marker" }],
    sources: [{ page: 4, section: "Observed signals", quote: "The planner observes a signal before acting." }]
  });
  assert.deepEqual(result.concepts, ["information-structure"]);
  assert.equal(result.conceptBindings[0].status, "modeled");
  assert.equal(result.conceptBindings[0].mappingBasis, "source-role-predicate");
  assert.match(result.conceptBindings[0].representation, /planner observes a signal before acting/i);
  assert.deepEqual(result.conceptBindings[0].conditionRefs, [0]);
  assert.deepEqual(result.conceptBindings[0].sourceRefs, [{ scope: "component", index: 0 }]);
  assert.equal("symbolRefs" in result.conceptBindings[0], false);
});

test("a secondary phrase match cannot displace the primary source-supported role binding", () => {
  const result = mapComponentRelevance({
    title: "Model setup",
    text: "The component describes a stochastic product transition and a later pricing stage.",
    role: "process",
    conceptDefinitions: concepts,
    conditions: [
      "The firm develops the candidate with probability x, and if it succeeds, the new product replaces the existing product."
    ],
    symbols: [],
    sources: [
      {
        page: 4,
        section: "Model setup",
        quote: "The firm develops the candidate with probability x, and if it succeeds, the new product replaces the existing product."
      },
      {
        page: 5,
        section: "Model setup",
        quote: "At stage 2, firms simultaneously set prices and consumers decide whether to buy."
      }
    ]
  });

  assert.deepEqual(result.concepts, ["pricing", "process-dynamics"]);
  const process = result.conceptBindings.find((binding) => binding.conceptId === "process-dynamics");
  assert.equal(process?.status, "modeled");
  assert.equal(process?.mappingBasis, "source-role-predicate");
  assert.deepEqual(process?.conditionRefs, [0]);
  assert.deepEqual(process?.sourceRefs, [{ scope: "component", index: 0 }]);
});

test("an unchanged result is not a feasibility constraint without a constrained model quantity", () => {
  const resultSentence = "The model performance remains unchanged across all tested parameter values.";
  assert.equal(sourceSupportsRole("constraint", resultSentence), false);
  assert.equal(
    sourceSupportsRole("constraint", "The fixed price remains unchanged throughout the selling horizon."),
    true,
  );
});

test("a broad role binding cannot borrow an unrelated component condition", () => {
  const result = mapComponentRelevance({
    title: "Observed signals",
    text: "The planner observes a signal before acting.",
    role: "information",
    conceptDefinitions: concepts,
    conditions: ["A warehouse incurs a fixed administrative fee each day."],
    symbols: [],
    sources: [{ page: 4, section: "Observed signals", quote: "The planner observes a signal before acting." }]
  });

  assert.deepEqual(result.concepts, []);
  assert.equal(result.conceptBindings[0].status, "unknown");
  assert.deepEqual(result.conceptBindings[0].conditionRefs, []);
});

test("a phrase-grounded binding does not default to condition zero without local overlap", () => {
  const result = mapComponentRelevance({
    title: "Seller price decision",
    text: "The seller sets a price before demand arrives.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: ["A warehouse incurs a fixed administrative fee each day."],
    symbols: [],
    sources: [{ page: 4, section: "Pricing decision", quote: "The seller sets a price before demand arrives." }]
  });

  assert.deepEqual(result.concepts, ["pricing"]);
  assert.deepEqual(result.conceptBindings[0].conditionRefs, []);
});

test("a leading hyphenated model name is prose, not an operator-led formula fragment", () => {
  const result = mapComponentRelevance({
    title: "Incentive compatibility with affine pricing",
    text: "The source gives an incentive-compatible pricing policy.",
    role: "objective",
    conceptDefinitions: [
      ...concepts,
      { id: "incentive-compatibility", label: "Incentive compatibility", aliases: ["incentive compatible"], related: [] }
    ],
    conditions: ["The policy is evaluated in the single-state model."],
    symbols: [],
    sources: [{
      page: 6,
      section: "Incentive Compatibility with Affine Pricing",
      quote: "Single-State Model: Multiplicative Pricing Is Incentive Compatible Our first result is a simple optimal driver policy in the single-state model."
    }]
  });
  assert.deepEqual(result.concepts, ["incentive-compatibility", "pricing"]);
  assert.equal(result.conceptBindings[0].status, "modeled");
});

test("authoring prose without a paper source stays unknown", () => {
  const result = mapComponentRelevance({
    title: "Dynamic pricing decision",
    text: "The seller chooses a time-varying price.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: []
  });
  assert.deepEqual(result.concepts, []);
  assert.equal(result.conceptBindings[0].status, "unknown");
  assert.deepEqual(result.conceptBindings[0].sourceRefs, []);
});

test("condition, symbol, and source references are retained only when they support that concept", () => {
  const result = mapComponentRelevance({
    title: "Policy mechanics",
    text: "The model specifies separate commercial and safety controls.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: [
      "The seller may revise the price once per period.",
      "Demand uncertainty is controlled through risk management."
    ],
    symbols: [
      { symbol: "p_t", meaning: "price in period t" },
      { symbol: "R", meaning: "risk management reserve" }
    ],
    sources: [
      { page: 4, section: "Pricing policy", quote: "The firm chooses its price before observing demand." },
      { page: 7, section: "Risk management", quote: "The reserve limits exposure under uncertainty." }
    ]
  });
  const byId = new Map(result.conceptBindings.map((binding) => [binding.conceptId, binding]));
  assert.deepEqual([...result.concepts].sort(), ["pricing", "risk-management"]);
  assert.deepEqual(byId.get("pricing").conditionRefs, [0]);
  assert.deepEqual(byId.get("pricing").symbolRefs, [0]);
  assert.deepEqual(byId.get("pricing").sourceRefs, [{ scope: "component", index: 0 }]);
  assert.deepEqual(byId.get("risk-management").conditionRefs, [1]);
  assert.deepEqual(byId.get("risk-management").symbolRefs, [1]);
  assert.deepEqual(byId.get("risk-management").sourceRefs, [{ scope: "component", index: 1 }]);
});

test("selection is deterministic, specificity-ranked, and capped at three", () => {
  const input = {
    title: "Dynamic pricing with inventory risk management",
    text: "Dynamic pricing jointly manages stock through a risk management policy.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: [{
      page: 8,
      section: "Dynamic pricing and inventory risk management",
      quote: "Dynamic pricing jointly manages stock through a risk management policy."
    }]
  };
  const first = mapComponentRelevance(input);
  const second = mapComponentRelevance(input);
  assert.deepEqual(first, second);
  assert.ok(first.concepts.length <= 3);
  assert.ok(first.concepts.includes("dynamic-pricing"));
  assert.ok(!first.concepts.includes("pricing"), "the related broad pricing ancestor is suppressed");
  assert.deepEqual(
    scoreComponentConcepts(input).map((candidate) => candidate.concept.id),
    scoreComponentConcepts(input).map((candidate) => candidate.concept.id)
  );
});

test("different components receive concise source-specific binding representations", () => {
  const changingPrice = mapComponentRelevance({
    title: "Price update",
    text: "The seller updates its price after observing inventory.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: [{
      page: 4,
      section: "Price update",
      quote: "The seller updates its price after observing the remaining inventory."
    }]
  });
  const postedPrice = mapComponentRelevance({
    title: "Posted price",
    text: "The platform posts one price before customer arrivals.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: [{
      page: 7,
      section: "Posted price",
      quote: "The platform posts one price before customer arrivals."
    }]
  });

  const first = changingPrice.conceptBindings.find((binding) => binding.conceptId === "pricing");
  const second = postedPrice.conceptBindings.find((binding) => binding.conceptId === "pricing");
  assert.ok(first && second);
  assert.notEqual(first.representation, second.representation);
  assert.match(first.representation, /decision rule/);
  assert.match(first.representation, /remaining inventory/);
  assert.match(second.representation, /platform posts one price/);
  assert.doesNotMatch(first.representation, /Automated source mapping links/);
});

test("noisy, background, formula, and clipped source excerpts fail closed", () => {
  const noisyConcepts = [
    ...concepts,
    { id: "u-shape", label: "U-shaped response", aliases: ["U shaped"], related: [] },
    { id: "waiting-cost", label: "Waiting cost", aliases: [], related: [] },
    { id: "submodular-order", label: "Submodular order", aliases: [], related: [] },
    { id: "matching", label: "Matching", aliases: [], related: [] }
  ];
  const cases = [
    ["unmatched response fragment", "U shaped), we cannot make a prediction .", "U-shaped response"],
    ["formula tail", "v − p) and their expected Waiting cost .", "Waiting cost"],
    ["variable tail", "pk) for all remaining products in Inventory .", "Inventory"],
    ["operator-led fragment", "·, n } be indexed in submodular order.", "Submodular order"],
    ["year/citation fragment", "1994 ) established the basis of Dynamic pricing .", "Dynamic pricing"],
    ["proof deferral", ", we omit the details...", "Optimization"],
    ["set fragment", "v ) contains all the feasible Matching solutions.", "Matching"],
    ["generic result bridge", "> 0), then we have the following results.", "Optimization"],
    ["raw extraction corruption", "The seller sets pri\u0000cing decisions.", "Pricing"],
    ["related-work attribution", "Smith (1994) established the basis of Dynamic pricing.", "Dynamic pricing"],
    ["journal boilerplate", "Management Science 70(1), pp. 1–20, Dynamic pricing.", "Dynamic pricing"],
    ["table row", "Dynamic pricing   0.42   0.18   0.09", "Dynamic pricing"],
    ["paper roadmap", "In Section 4, we analyze Dynamic pricing.", "Dynamic pricing"]
  ];

  for (const [name, quote, section] of cases) {
    const result = mapComponentRelevance({
      title: section,
      text: `The component concerns ${section}.`,
      role: "decision",
      conceptDefinitions: noisyConcepts,
      conditions: [],
      symbols: [],
      sources: [{ page: 4, section, quote }]
    });
    assert.deepEqual(result.concepts, [], `${name} must not establish a modeled concept`);
    assert.deepEqual(result.evidence, [], `${name} must not retain modeled evidence`);
    assert.equal(result.conceptBindings.length, 1, `${name} should retain an explicit unknown binding`);
    assert.equal(result.conceptBindings[0].status, "unknown", `${name} should be marked unknown`);
    assert.deepEqual(result.conceptBindings[0].sourceRefs, [], `${name} must not cite the rejected excerpt`);
    assert.equal(result.unresolved.reason, "no-clean-component-local-concept-support");
    assert.match(result.conceptBindings[0].representation, /background or unusable extracted text/);
    assert.doesNotMatch(result.conceptBindings[0].representation, /[“”]/, `${name} must not launder the excerpt into prose`);
  }
});

test("a clean local source wins without retaining a rejected sibling source", () => {
  const result = mapComponentRelevance({
    title: "Adaptive seller policy",
    text: "The decision component specifies how the seller responds to demand.",
    role: "decision",
    conceptDefinitions: concepts,
    conditions: [],
    symbols: [],
    sources: [
      { page: 2, section: "Dynamic pricing", quote: "1994 ) established the basis of Dynamic pricing ." },
      { page: 6, section: "Dynamic pricing policy", quote: "The seller updates its price after observing current demand." }
    ]
  });

  const binding = result.conceptBindings.find((candidate) => candidate.conceptId === "dynamic-pricing");
  assert.ok(binding);
  assert.equal(binding.status, "modeled");
  assert.deepEqual(binding.sourceRefs, [{ scope: "component", index: 1 }]);
  assert.deepEqual(result.evidence.find((entry) => entry.conceptId === "dynamic-pricing")?.location, "source:1");
  assert.match(binding.representation, /seller updates its price/);
  assert.doesNotMatch(binding.representation, /1994|established the basis/);
});

test("a snippet window cannot turn a clean source into a clipped representation", () => {
  const result = mapComponentRelevance({
    title: "Demand prediction",
    text: "The component studies prediction from the response curve.",
    role: "information",
    conceptDefinitions: [
      ...concepts,
      { id: "forecasting", label: "Forecasting", aliases: ["prediction"], related: [] }
    ],
    conditions: [],
    symbols: [],
    sources: [{
      page: 9,
      section: "Demand prediction",
      quote: "The response is described by a fully specified curve (which is U shaped), so the analyst cannot make a prediction before observing enough demand data."
    }]
  });

  const binding = result.conceptBindings.find((candidate) => candidate.conceptId === "forecasting");
  assert.ok(binding);
  assert.equal(binding.status, "modeled");
  assert.doesNotMatch(binding.representation, /U shaped\), so/);
  assert.match(binding.representation, /“prediction”/);
});
