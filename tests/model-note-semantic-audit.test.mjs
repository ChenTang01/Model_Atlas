import assert from "node:assert/strict";
import test from "node:test";

import {
  SEMANTIC_AUDIT_VERSION,
  validateModelNoteSemantics
} from "../scripts/model-note-semantic-audit.mjs";
import { validatedPublicPaper } from "../scripts/build-model-notes.mjs";

const pages = {
  pages: [
    {
      page: 1,
      text: [
        "We model a retailer that observes uncertain demand before allocating a fixed inventory stock across two markets.",
        "The retailer knows the stock level and each market demand before choosing the allocation."
      ].join("\n")
    },
    {
      page: 2,
      text: [
        "We derive a dynamic program and prove that its threshold allocation policy minimizes expected lost sales.",
        "The appendix reports weather forecasts for coastal cities."
      ].join("\n")
    }
  ]
};

const concepts = [
  { id: "inventory-control", label: "Inventory control", aliases: ["stock level", "inventory state"] },
  { id: "dynamic-programming", label: "Dynamic programming", aliases: ["dynamic program"] },
  { id: "uncertainty", label: "Uncertainty", aliases: ["uncertain demand"] },
  { id: "information-structure", label: "Information structure", aliases: ["available information"] }
];

function recordEvidence(value, field) {
  return { value, source: { type: "record", field, matchedText: value } };
}

function binding(conceptId, sourceIndex = 0, extra = {}) {
  return {
    conceptId,
    status: "modeled",
    representation: `Automated source mapping links ${conceptId} to the local component's stated mechanism.`,
    conditionRefs: [0],
    sourceRefs: [{ scope: "component", index: sourceIndex }],
    reviewStatus: "automated-source-map",
    formalRef: "formal",
    symbolRefs: [0],
    ...extra
  };
}

function validNote() {
  return {
    id: "inventory-learning",
    question: "How should a retailer allocate inventory after observing uncertain demand?",
    overview: "A retailer learns demand before balancing a fixed stock across two markets.",
    modelTypes: ["Dynamic optimization"],
    coverage: { pages: [1, 2], note: "The model setup and solution method are mapped to literal source evidence." },
    models: [{
      id: "baseline",
      name: "Demand-informed inventory allocation",
      kind: "baseline",
      summary: "The retailer allocates fixed inventory after observing uncertain market demand.",
      objects: ["A retailer and two geographically separate markets"],
      inputs: ["A fixed stock level and observed uncertain demand in each market"],
      decisions: ["The quantity of inventory allocated to each market"],
      assumptions: ["Lost demand is not backlogged after the allocation decision"],
      setupEvidence: {
        objects: [recordEvidence("A retailer and two geographically separate markets", "players")],
        inputs: [recordEvidence("A fixed stock level and observed uncertain demand in each market", "information")],
        decisions: [recordEvidence("The quantity of inventory allocated to each market", "actions")],
        assumptions: [recordEvidence("Lost demand is not backlogged after the allocation decision", "assumptions")]
      },
      setupMaturity: {
        objects: "source-authored",
        inputs: "source-authored",
        decisions: "source-authored",
        assumptions: "source-authored"
      },
      setupDiagnostics: [],
      method: "The paper derives a dynamic program and proves a threshold allocation policy.",
      sources: [{
        page: 1,
        section: "2. Model setup",
        equation: "",
        quote: "We model a retailer that observes uncertain demand before allocating a fixed inventory stock across two markets."
      }],
      relationships: [],
      components: [{
        id: "demand-state",
        label: "Observed demand and inventory state",
        role: "information",
        concepts: ["inventory-control"],
        explanation: "The retailer observes uncertain market demand together with the available fixed inventory stock before allocating it.",
        searchPhrases: ["observed demand before allocation", "fixed inventory state", "retailer demand information"],
        formal: "s=(B,D_1,D_2)",
        formalKind: "Atlas normalized notation",
        symbols: [{ symbol: "s", meaning: "Observed stock and market-demand state" }],
        conditions: ["Demand is observed before the allocation decision."],
        sources: [{
          page: 1,
          section: "2. Model setup",
          equation: "",
          quote: "The retailer knows the stock level and each market demand before choosing the allocation."
        }],
        conceptBindings: [binding("inventory-control")]
      }, {
        id: "threshold-policy",
        label: "Threshold allocation policy",
        role: "algorithm",
        concepts: ["dynamic-programming"],
        explanation: "A dynamic program yields a threshold allocation policy that minimizes the model's expected lost sales.",
        searchPhrases: ["dynamic inventory program", "threshold allocation rule", "expected lost sales"],
        formal: "x^*(s)=\operatorname{argmin}_x V(s,x)",
        formalKind: "Atlas restatement of source rule",
        symbols: [{ symbol: "x^*(s)", meaning: "Optimal state-dependent inventory allocation" }],
        conditions: ["The available allocation cannot exceed the fixed stock."],
        sources: [{
          page: 2,
          section: "3. Solution method",
          equation: "",
          quote: "We derive a dynamic program and prove that its threshold allocation policy minimizes expected lost sales."
        }],
        conceptBindings: [binding("dynamic-programming")]
      }]
    }],
    provenance: { editorialStatus: "automated source map" }
  };
}

function codes(result) {
  return result.errors.map((entry) => entry.code);
}

test("a grounded automated note passes with deterministic metrics", () => {
  const result = validateModelNoteSemantics(validNote(), { authoringMode: "source-mapped", pages, concepts });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.metrics, {
    auditVersion: SEMANTIC_AUDIT_VERSION,
    authoringMode: "source-mapped",
    validationProfile: "automated",
    models: 1,
    components: 2,
    bindings: 2,
    modeledBindings: 2,
    unknownBindings: 0,
    sourceAnchors: 3,
    uniqueSourceAnchors: 3,
    reusedSourceAnchors: 0,
    reusedComponentConditions: 0,
    sourcedPages: 2,
    coveragePages: 2,
    quoteChecks: 3,
    quoteMatches: 3,
    localOverlapChecks: 3,
    localOverlapMatches: 3,
    duplicateComponents: 0,
    duplicateVariantModels: 0,
    setupEvidenceChecks: 4,
    setupEvidenceMatches: 4,
    unsupportedModeledBindings: 0,
    errorCount: 0,
    warningCount: 0
  });
});

test("reviewed notation meanings may contain inline model equations but never encoding corruption", () => {
  const reviewed = validNote();
  reviewed.models[0].components[0].symbols[0] = {
    symbol: "D(p), alpha",
    meaning: "linear service demand and its market-size intercept, with D(p)=alpha-p",
    sourceKind: "reviewed-catalog"
  };
  const accepted = validateModelNoteSemantics(reviewed, { authoringMode: "metadata-enriched", pages, concepts });
  assert.equal(accepted.errors.some((entry) => entry.path.endsWith("symbols[0].meaning")), false);

  reviewed.models[0].components[0].symbols[0].meaning = "linear service demand with a corrupt � parameter";
  const rejected = validateModelNoteSemantics(reviewed, { authoringMode: "metadata-enriched", pages, concepts });
  assert.ok(rejected.errors.some((entry) => entry.code === "text.extraction-noise"
    && entry.path.endsWith("symbols[0].meaning")));
});

test("mathematical formals require source-grounded symbols while verbal restatements may omit them", () => {
  const mathematical = validNote();
  mathematical.models[0].components[0].symbols = [];
  delete mathematical.models[0].components[0].conceptBindings[0].symbolRefs;
  const rejected = validateModelNoteSemantics(mathematical, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(rejected.errors.some((entry) => entry.code === "component.symbols.missing-for-math"));

  const verbal = validNote();
  verbal.models[0].components[1].symbols = [];
  delete verbal.models[0].components[1].conceptBindings[0].symbolRefs;
  const accepted = validateModelNoteSemantics(verbal, { authoringMode: "source-mapped", pages, concepts });
  assert.equal(accepted.errors.some((entry) => entry.code === "component.symbols.missing-for-math"), false);
});

test("automated questions reject title wrapping and double punctuation", () => {
  const note = validNote();
  note.title = "Inventory Balancing with Online Learning";
  note.question = "What model does “Inventory Balancing with Online Learning” develop, and what does it imply for inventory??";
  const result = validateModelNoteSemantics(note, { authoringMode: "metadata-enriched", pages, concepts });
  assert.ok(codes(result).includes("question.title-boilerplate"));
  assert.ok(codes(result).includes("question.punctuation"));
});

test("the release builder validates the title-bearing public paper shape", () => {
  const note = validNote();
  note.modelTypes = ["Optimization"];
  const record = {
    id: note.id,
    title: note.question,
    authors: [],
    year: 2024,
    journal: "Fixture Journal",
    journal_code: "FJ",
    doi: "10.0000/title-bearing-release-fixture",
    navigation_topic: "Optimization",
    primary_topic: "Inventory control",
    topic_families: [],
    topics: [],
    pdf_page_count: pages.pages.length,
    pdf_sha256: "a".repeat(64)
  };
  const conceptMap = new Map(concepts.map((concept) => [concept.id, concept]));

  assert.throws(
    () => validatedPublicPaper(note, record, pages.pages, conceptMap, note.id, "source-mapped"),
    /question\.title-boilerplate@question/
  );

  const accepted = validatedPublicPaper(
    note,
    { ...record, title: "Demand-Informed Inventory Allocation" },
    pages.pages,
    conceptMap,
    note.id,
    "source-mapped"
  );
  assert.equal(accepted.title, "Demand-Informed Inventory Allocation");
});

test("automated method and setup placeholders are fatal", () => {
  const note = validNote();
  note.models[0].method = "Solution or estimation method";
  note.models[0].objects = ["Decision makers and system entities defined in the model"];
  note.models[0].inputs = [];
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(codes(result).includes("model.method.not-substantive"));
  assert.ok(codes(result).includes("model.setup.placeholder"));
  assert.ok(codes(result).includes("model.setup.missing"));
});

test("automated false greens reject malformed setup phrases and generic or ungrammatical methods", () => {
  const note = validNote();
  note.models[0].method = "Using the Model specification, the paper formulates model and analyzes the resulting system process.";
  note.models[0].objects = ["A consumer only"];
  note.models[0].inputs = ["Feature K, then they cannot apply to the school"];
  note.models[0].decisions = ["Reject the assumption of equal demand"];
  note.models[0].assumptions = ["We restrict k2 > 49 144 so that the decision remains finite."];
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });

  assert.ok(codes(result).includes("model.method.malformed"));
  assert.deepEqual(
    result.errors.filter((entry) => entry.code === "model.setup.malformed").map((entry) => entry.path),
    [
      "models[0].objects[0]",
      "models[0].inputs[0]",
      "models[0].decisions[0]",
      "models[0].assumptions[0]"
    ]
  );

  const specificTemplate = validNote();
  specificTemplate.models[0].method = "Using the Distribution Channel specification, the paper formulates pricing decisions and analyzes the resulting strategic response.";
  assert.ok(codes(validateModelNoteSemantics(specificTemplate, { authoringMode: "source-mapped", pages, concepts }))
    .includes("model.method.malformed"));

  const agreement = validNote();
  agreement.models[0].method = "The paper simulates the resulting admission outcomes decisions and highlight two competitive settings.";
  assert.ok(codes(validateModelNoteSemantics(agreement, { authoringMode: "source-mapped", pages, concepts }))
    .includes("model.method.malformed"));
});

test("automated methods reject discourse leads and leaked section headings", () => {
  for (const method of [
    "Therefore, we employ backward induction to characterize the equilibrium policy.",
    "Thus, in this paper, we develop a dynamic program for the allocation problem.",
    "Analysis In this section, we solve the firm's optimization problem."
  ]) {
    const note = validNote();
    note.models[0].method = method;
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.ok(result.errors.some((entry) => entry.code === "model.method.malformed"
      && entry.path === "models[0].method"), method);
  }
});

test("research authors are rejected as model objects without literal content-creator evidence", () => {
  const methodologicalActors = validNote();
  methodologicalActors.models[0].objects = ["The researchers"];
  methodologicalActors.models[0].setupEvidence.objects = [recordEvidence("The researchers", "players")];
  const rejected = validateModelNoteSemantics(methodologicalActors, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(rejected.errors.some((entry) => entry.code === "model.setup.object.research-author"
    && entry.path === "models[0].objects[0]"));

  const contentCreators = validNote();
  const creatorQuote = "The paper explicitly models content authors who produce articles and choose publication timing.";
  const creatorPages = structuredClone(pages);
  creatorPages.pages[0].text += `\n${creatorQuote}`;
  contentCreators.models[0].objects = ["Content authors"];
  contentCreators.models[0].setupEvidence.objects = [{
    value: "Content authors",
    source: {
      type: "section",
      section: "2. Model setup",
      page: 1,
      quote: creatorQuote,
      matchedText: "content authors",
      derivation: "literal-modeled-content-creator"
    }
  }];
  const accepted = validateModelNoteSemantics(contentCreators, { authoringMode: "source-mapped", pages: creatorPages, concepts });
  assert.equal(accepted.errors.some((entry) => entry.code === "model.setup.object.research-author"), false);
});

test("raw source math wrappers cannot survive in automated setup prose", () => {
  const note = validNote();
  note.models[0].inputs = ["The tuning parameter $lambda$ used by the firm"];
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.errors.some((entry) => entry.code === "model.setup.malformed"
    && entry.path === "models[0].inputs[0]"));
});

test("automated setup rejects heading leakage, generic nouns, fused text, and outcome pseudo-decisions", () => {
  const cases = [
    ["assumptions", "Problem formulation We consider a finite-horizon inventory system"],
    ["assumptions", "6328"],
    ["inputs", "the capacity"],
    ["inputs", "observation"],
    ["objects", "products"],
    ["decisions", "Choose the contract thatmaximizeshersurplus(asinMaskinandRiley1984)"],
    ["decisions", "Freemium contracts oftentimes have a high percentage of free users"],
    ["decisions", "Share on average decreased by 2"],
    ["decisions", "A prioritization strategy consistently outperforms the benchmark"],
    ["decisions", "A heuristic to further improve performance"],
    ["decisions", "Require noninferiority trials to be conducted for new vaccine dosages"],
    ["decisions", "Design an algorithm that"]
  ];
  for (const [field, value] of cases) {
    const note = validNote();
    note.models[0][field] = [value];
    note.models[0].setupEvidence[field] = [recordEvidence(value, field)];
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.ok(result.errors.some((entry) => entry.code === "model.setup.malformed"
      && entry.path === `models[0].${field}[0]`), `${field}: ${value}`);
  }
});

test("modeled binary and solicitation controls remain valid while borrowed-paper decisions fail provenance", () => {
  for (const decision of [
    "Whether to improve its process quality level to λ or not",
    "To improve its process quality to λ",
    "From which other sensors to solicit state estimates",
    "Solicit estimates from other sensors",
    "Whether to moderately exaggerate the display quality"
  ]) {
    const note = validNote();
    note.models[0].decisions = [decision];
    note.models[0].setupEvidence.decisions = [recordEvidence(decision, "actions")];
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.equal(result.errors.some((entry) => entry.code === "model.setup.malformed"
      && entry.path === "models[0].decisions[0]"), false, decision);
  }

  const borrowed = validNote();
  borrowed.models[0].decisions = ["Design without referrals"];
  borrowed.models[0].setupEvidence.decisions = [{
    value: "Design without referrals",
    source: {
      type: "record",
      field: "actions",
      matchedText: "Design without referrals",
      quote: "A recent working paper by Smith et al. (2019) considers a model of product line design without referrals."
    }
  }];
  const result = validateModelNoteSemantics(borrowed, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.errors.some((entry) => entry.code === "model.setup-evidence.borrowed-decision"));

  const objective = validNote();
  objective.models[0].decisions = ["Minimize infections at the population level"];
  objective.models[0].setupEvidence.decisions = [{
    value: "Minimize infections at the population level",
    source: {
      type: "record",
      field: "actions",
      quote: "The objective is to minimize infections at the population level.",
      matchedText: "minimize infections at the population level"
    }
  }];
  const objectiveResult = validateModelNoteSemantics(objective, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(objectiveResult.errors.some((entry) => entry.code === "model.setup-evidence.objective-not-control"));
});

test("method auditing uses the same source-owned procedural contract as authoring", () => {
  const developed = validNote();
  developed.models[0].method = "In this study, we develop a game-theoretical model and derive its equilibrium conditions.";
  assert.ok(!codes(validateModelNoteSemantics(developed, { authoringMode: "source-mapped", pages, concepts })).includes("model.method.not-substantive"));

  const scaffold = validNote();
  scaffold.models[0].method = "Let the retailer solve the allocation problem after demand is observed.";
  assert.ok(codes(validateModelNoteSemantics(scaffold, { authoringMode: "source-mapped", pages, concepts })).includes("model.method.not-substantive"));
});

test("automated setup values require literal field-level provenance", () => {
  const note = validNote();
  note.models[0].setupEvidence.inputs = [];
  note.models[0].setupEvidence.decisions[0].source = {
    type: "section",
    section: "2. Model setup",
    page: 2,
    matchedText: note.models[0].decisions[0],
    quote: "This fabricated containing sentence is absent from the cited extraction page."
  };
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.errors.some((entry) => entry.code === "model.setup-evidence.missing" && entry.path.endsWith("inputs[0]")));
  assert.ok(result.errors.some((entry) => entry.code === "model.setup-evidence.matched-text-outside-quote" && entry.path.includes("decisions[0]")));
  assert.ok(result.errors.some((entry) => entry.code === "model.setup-evidence.quote-not-literal" && entry.path.includes("decisions[0]")));
  assert.equal(result.metrics.setupEvidenceChecks, 4);
  assert.equal(result.metrics.setupEvidenceMatches, 3);
});

test("setup value containment normalizes PDF ligatures without weakening quote-to-page literalness", () => {
  const note = validNote();
  const ligatureQuote = "The ﬁrm chooses inventory after observing demand in both markets.";
  const ligaturePages = structuredClone(pages);
  ligaturePages.pages[0].text += `\n${ligatureQuote}`;
  note.models[0].objects = ["The firm"];
  note.models[0].setupEvidence.objects = [{
    value: "The firm",
    source: {
      type: "section",
      section: "2. Model setup",
      page: 1,
      quote: ligatureQuote
    }
  }];

  const accepted = validateModelNoteSemantics(note, {
    authoringMode: "source-mapped",
    pages: ligaturePages,
    concepts
  });
  assert.equal(accepted.errors.some((entry) => entry.path.includes("setupEvidence.objects")), false);

  note.models[0].setupEvidence.objects[0].source.quote = "The firm chooses inventory after observing demand in both markets.";
  const repaired = validateModelNoteSemantics(note, {
    authoringMode: "source-mapped",
    pages: ligaturePages,
    concepts
  });
  assert.ok(repaired.errors.some((entry) => entry.code === "model.setup-evidence.quote-not-literal"
    && entry.path.includes("setupEvidence.objects")));
});

test("a literal parameter gloss may stay focused when its containing quote includes unrelated inline math", () => {
  const note = validNote();
  const parameterValue = "Let t denote the current period";
  const parameterQuote = `${parameterValue}. t ∈ {1, 2, ..., T}`;
  const parameterPages = structuredClone(pages);
  parameterPages.pages[0].text += `\n${parameterValue}.\nt ∈ {1, 2, ..., T}`;
  note.models[0].inputs = [parameterValue];
  note.models[0].setupEvidence.inputs = [{
    value: parameterValue,
    source: {
      type: "section",
      section: "2. Model setup",
      page: 1,
      quote: parameterQuote,
      matchedText: `${parameterValue}.`,
      derivation: "literal-parameter-gloss"
    }
  }];

  const accepted = validateModelNoteSemantics(note, {
    authoringMode: "source-mapped",
    pages: parameterPages,
    concepts
  });
  assert.equal(accepted.errors.some((entry) => entry.code === "model.setup-evidence.quote-formula-contaminated"), false);

  delete note.models[0].setupEvidence.inputs[0].source.derivation;
  const rejected = validateModelNoteSemantics(note, {
    authoringMode: "source-mapped",
    pages: parameterPages,
    concepts
  });
  assert.ok(rejected.errors.some((entry) => entry.code === "model.setup-evidence.quote-formula-contaminated"));
});

test("an explicit source-exhausted marker cannot waive Mini setup parity", () => {
  const note = validNote();
  note.models[0].inputs = [];
  note.models[0].setupEvidence.inputs = [];
  note.models[0].setupMaturity.inputs = "unresolved";
  note.models[0].setupDiagnostics.push({
    code: "setup_inputs_source_exhausted",
    category: "inputs",
    message: "No concrete input phrase could be retained from the source."
  });
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.errors.some((entry) => entry.code === "model.setup.missing" && entry.path.endsWith(".inputs")));
  assert.equal(result.warnings.some((entry) => entry.code === "model.setup.unresolved"), false);
});

test("generic authoring fallbacks cannot masquerade as setup provenance", () => {
  const note = validNote();
  const evidence = note.models[0].setupEvidence.assumptions[0];
  evidence.source = { type: "authoring-fallback", matchedText: evidence.value };
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(codes(result).includes("model.setup-evidence.source-type-invalid"));
});

test("setup maturity and evidence shapes cannot contradict displayed values", () => {
  const note = validNote();
  note.models[0].setupMaturity.objects = "unresolved";
  delete note.models[0].setupEvidence.decisions;
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(codes(result).includes("model.setup-maturity.inconsistent"));
  assert.ok(codes(result).includes("model.setup-evidence.field-array-missing"));
});

test("automated component and source labels reject integration heading junk", () => {
  const junkLabels = [
    "Subodha Kumar, Bala Shetty",
    "For brevity, we present the results only for the effort",
    "As argued earlier, if consumers in practice face other information",
    "It is never optimal in our setting to serve both types of buyers",
    "By sustaining informative communication, the A-Learning",
    "A-Learning approach. That is, when",
    "O-Learning case (i.e., ∆)",
    "O-Learning case (i.e., ∆",
    "The results of this section extend to settings with homogeneous taste",
    "In the commitment full bargaining model, any pair of w1∗",
    "Throughout the model and analyses, we use the words customer",
    "Chen and Lee (2016) model a supplier’s ethical level as a disutility",
    "This utility model captures a decrease in the utility obtained",
    "Based on the optimal policy in Lemma 2, we reduce",
    "Note that our VRP subroutine formulation in Online Appendix EC.4",
    "Finally, our comparative analysis provides directional guidance",
    "An NC qNC,r such that its associated equilibrium"
  ];

  for (const label of junkLabels) {
    const note = validNote();
    note.models[0].components[0].label = label;
    note.models[0].components[0].sources[0].section = label;
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.ok(
      result.errors.some((entry) => entry.code === "component.label.not-heading" && entry.path.endsWith(".label")),
      `component label should be rejected: ${label}`
    );
    assert.ok(
      result.errors.some((entry) => entry.code === "source.section.not-heading" && entry.path.endsWith(".section")),
      `source section should be rejected: ${label}`
    );
  }
});

test("the paper title cannot masquerade as a component or source-section heading", () => {
  const note = validNote();
  note.title = "Inventory Balancing with Online Learning";
  note.models[0].components[0].label = note.title;
  note.models[0].components[0].sources[0].section = note.title;
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(codes(result).includes("component.label.paper-title"));
  assert.ok(codes(result).includes("source.section.paper-title"));
});

test("canonical and established semantic headings remain valid", () => {
  const validLabels = [
    "Model",
    "Method",
    "Setup",
    "Demand",
    "Pricing",
    "Benchmark",
    "Observed demand and inventory state",
    "Threshold allocation policy",
    "Strategic Communication Equilibrium",
    "Vendor Decisions",
    "A-Learning and O-Learning",
    "8.1. Impact of mHTP",
    "3.2. Customization Under A-Learning",
    "Impact of Manufacturer’s Entry in the Product-Sharing Market",
    "Trade-Off Between Enrollment Cost and Efficiency of the Expedited Service",
    "Reformulating the Objective Function as a Maximum Cost Flow Model",
    "In the Case of Opaque Information",
    "Consumers",
    "Vendor",
    "Baselines",
    "LM",
    "Erlang-S",
    "A model with asymmetric information"
  ];

  for (const label of validLabels) {
    const note = validNote();
    note.models[0].components[0].label = label;
    note.models[0].components[0].sources[0].section = label;
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.equal(
      result.errors.some((entry) => entry.code === "component.label.not-heading" || entry.code === "source.section.not-heading"),
      false,
      `heading should remain valid: ${label}`
    );
  }
});

test("printed concise sentence-case section names may remain source anchors", () => {
  const note = validNote();
  note.models[0].components[0].sources[0].section = "A heterogeneous workforce";
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.equal(result.errors.some((entry) => entry.code === "source.section.not-heading"), false);
});

test("source-heading flexibility never excuses hard extraction or dangling-clause failures", () => {
  for (const section of [
    "6.3.1. Unconstrained Optimal Solution of the Buyer’s Problem (p",
    "4.2. Implementation of Optimal Mechanism by"
  ]) {
    const note = validNote();
    note.models[0].components[0].sources[0].section = section;
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.equal(
      result.errors.some((entry) => entry.path.endsWith(".sources[0].section")
        && (entry.code === "source.section.not-heading" || entry.code === "text.extraction-noise")),
      true,
      section
    );
  }
});

test("byte-identical setup is warned and an otherwise identical variant core is rejected", () => {
  const note = validNote();
  const variant = structuredClone(note.models[0]);
  variant.id = "policy-variant";
  variant.name = "Alternative threshold allocation policy";
  note.models.push(variant);

  let result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.warnings.some((entry) => entry.code === "model.setup.identical-across-variants"));
  assert.ok(codes(result).includes("model.variant.duplicate-content"));

  note.models[1].assumptions = [...note.models[1].assumptions, "The policy variant permits one period of demand backlog."];
  note.models[1].setupEvidence.assumptions.push(recordEvidence("The policy variant permits one period of demand backlog.", "assumptions"));
  result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.equal(result.warnings.some((entry) => entry.code === "model.setup.identical-across-variants"), false);
  assert.equal(codes(result).includes("model.variant.duplicate-content"), false);
});

test("heading-quality checks remain relaxed for curated notes", () => {
  const note = validNote();
  note.models[0].components[0].label = "Vendor";
  note.models[0].components[0].sources[0].section = "For brevity, we present the results only for the effort";
  const result = validateModelNoteSemantics(note, { authoringMode: "curated", pages, concepts });
  assert.equal(result.errors.some((entry) => entry.code.endsWith(".not-heading")), false);
});

test("component prose is clean, substantive, distinct, and semantically deduplicated", () => {
  const note = validNote();
  const duplicate = structuredClone(note.models[0].components[0]);
  duplicate.id = "duplicate-demand-state";
  note.models[0].components.push(duplicate);
  note.overview = "The mod- ified demand state is used by the retailer.";
  note.models[0].summary = "Smith et al. (2024).";
  note.models[0].components[1].label = "Figure 2. Threshold allocation policy";
  note.models[0].components[1].explanation = "This paper is organized as follows, with the solution reported in Section 3.";
  const result = validateModelNoteSemantics(note, { authoringMode: "automated", pages, concepts });
  assert.ok(codes(result).includes("text.extraction-noise"));
  assert.ok(codes(result).includes("text.prohibited-prose"));
  assert.ok(result.errors.some((entry) => entry.message.includes("citation prose")));
  assert.ok(codes(result).includes("component.label.duplicate"));
  assert.ok(codes(result).includes("component.explanation.duplicate"));
  assert.ok(codes(result).includes("component.semantic-duplicate"));
  assert.equal(result.metrics.duplicateComponents, 1);
});

test("quotes must be literal and overlap their local component", () => {
  const note = validNote();
  note.models[0].components[0].sources[0].quote = "The retailer observes repaired demand text that does not occur on the cited page.";
  note.models[0].components[1].sources[0].quote = "The appendix reports weather forecasts for coastal cities.";
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  const pathsByCode = new Map(result.errors.map((entry) => [entry.code, entry.path]));
  assert.match(pathsByCode.get("source.quote.not-literal"), /components\[0\]/);
  assert.match(pathsByCode.get("source.quote.no-local-overlap"), /components\[1\]/);
  assert.equal(result.metrics.quoteChecks, 3);
  assert.equal(result.metrics.quoteMatches, 2);
});

test("automated validation rejects a prose quote that absorbs a physical display equation", () => {
  const note = validNote();
  const contaminatedPages = structuredClone(pages);
  contaminatedPages.pages[0].text = [
    contaminatedPages.pages[0].text,
    "The inventory state follows the transition",
    "x_t ≡ f(x_{t-1},a_t)."
  ].join("\n");
  note.models[0].components[0].sources[0].quote = "The inventory state follows the transition x_t ≡ f(x_{t-1},a_t).";

  let result = validateModelNoteSemantics(note, {
    authoringMode: "source-mapped",
    pages: contaminatedPages,
    concepts
  });
  assert.ok(result.errors.some((entry) => entry.code === "source.quote.formula-contaminated"
    && entry.path.includes("components[0].sources[0].quote")));

  result = validateModelNoteSemantics(note, {
    authoringMode: "curated",
    pages: contaminatedPages,
    concepts
  });
  assert.equal(result.errors.some((entry) => entry.code === "source.quote.formula-contaminated"), false);
});

test("model sources must support model-level prose rather than borrowing component prose", () => {
  const note = validNote();
  note.models[0].sources[0] = {
    page: 2,
    section: "Appendix",
    equation: "",
    quote: "The appendix reports weather forecasts for coastal cities."
  };
  note.models[0].components[0].explanation += " The component also mentions weather forecasts for coastal cities.";
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.errors.some((entry) => entry.code === "source.quote.no-local-overlap" && entry.path === "models[0].sources[0].quote"));
});

test("component sources cannot be made relevant by self-referential binding prose", () => {
  const note = validNote();
  const component = note.models[0].components[0];
  component.sources[0] = {
    page: 2,
    section: "Appendix",
    equation: "",
    quote: "The appendix reports weather forecasts for coastal cities."
  };
  component.conceptBindings[0].representation = "Automated source mapping mentions weather forecasts for coastal cities.";
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.errors.some((entry) => entry.code === "source.quote.no-local-overlap" && entry.path.includes("components[0].sources[0]")));
});

test("modeled concepts must occur in their specifically referenced source anchors", () => {
  const note = validNote();
  const component = note.models[0].components[0];
  component.concepts = ["dynamic-programming"];
  component.conceptBindings[0].conceptId = "dynamic-programming";
  component.conceptBindings[0].representation = "Automated source mapping calls this a dynamic-programming mechanism even though its source does not.";
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(codes(result).includes("binding.source.no-concept-support"));
  assert.equal(result.metrics.unsupportedModeledBindings, 1);
});

test("concept consistency rejects editorial claims and incomplete unknown bindings", () => {
  const note = validNote();
  const component = note.models[0].components[0];
  component.conceptBindings[0].reviewStatus = "editorial";
  component.conceptBindings[0].sourceRefs = [];
  component.conceptBindings.push({
    conceptId: "uncertainty",
    status: "unknown",
    representation: "Automated mapping found no local support for uncertainty in this component.",
    conditionRefs: [],
    sourceRefs: [],
    reviewStatus: "automated-source-map"
  });
  component.concepts = ["inventory-control", "uncertainty"];
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(codes(result).includes("binding.review-status.editorial"));
  assert.ok(codes(result).includes("binding.source-refs.missing"));
  assert.ok(codes(result).includes("binding.condition-refs.invalid"));
  assert.ok(codes(result).includes("binding.modeled.missing") === false, "the original modeled binding remains present");
  assert.ok(codes(result).includes("component.concepts.inconsistent"));
  assert.equal(result.errors.some((entry) => entry.path.includes("conceptBindings[1].sourceRefs") && entry.code === "binding.source-refs.missing"), true);
  assert.equal(result.metrics.unknownBindings, 1);
});

test("automated components fail closed on every Mini parity field and binding reference", () => {
  const note = validNote();
  const component = note.models[0].components[0];
  component.formal = "";
  component.searchPhrases = [];
  component.conditions = [];
  component.concepts = [];
  component.conceptBindings[0].conditionRefs = [];
  component.conceptBindings[0].sourceRefs = [];
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  for (const code of [
    "component.formal.missing",
    "component.search-phrases.missing",
    "component.conditions.missing",
    "component.concepts.missing",
    "binding.condition-refs.invalid",
    "binding.source-refs.missing"
  ]) assert.ok(codes(result).includes(code), code);
});

test("source-role mappings accept only their registered role and matching local predicate", () => {
  const accepted = validNote();
  const component = accepted.models[0].components[0];
  component.concepts = ["information-structure"];
  component.conceptBindings = [binding("information-structure", 0, { mappingBasis: "source-role-predicate" })];
  let result = validateModelNoteSemantics(accepted, { authoringMode: "source-mapped", pages, concepts });
  assert.equal(codes(result).includes("binding.source.no-concept-support"), false);

  component.concepts = ["dynamic-programming"];
  component.conceptBindings = [binding("dynamic-programming", 0, { mappingBasis: "source-role-predicate" })];
  result = validateModelNoteSemantics(accepted, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(codes(result).includes("binding.source.no-concept-support"));
});

test("reused anchors and very thin coverage are warnings", () => {
  const note = validNote();
  note.coverage.pages = [1];
  note.models[0].components = [note.models[0].components[0]];
  note.models[0].components[0].sources[0] = structuredClone(note.models[0].sources[0]);
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.warnings.some((entry) => entry.code === "source.anchor.reused"));
  assert.ok(result.warnings.some((entry) => entry.code === "coverage.thin"));
  assert.equal(result.metrics.reusedSourceAnchors, 1);
});

test("a reused condition is a review warning while substantive duplicate components remain errors", () => {
  const note = validNote();
  note.models[0].components[1].conditions = [...note.models[0].components[0].conditions];
  note.models[0].components[1].conceptBindings[0].conditionRefs = [0];
  let result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.equal(result.errors.some((entry) => entry.code === "component.condition.reused"), false);
  assert.ok(result.warnings.some((entry) => entry.code === "component.condition.reused"));
  assert.equal(result.metrics.reusedComponentConditions, 1);

  const clone = structuredClone(note.models[0].components[0]);
  clone.id = "renamed-demand-state";
  clone.label = "Renamed demand-state copy";
  note.models[0].components.push(clone);
  result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.errors.some((entry) => entry.code === "component.semantic-duplicate"));
});

test("automated conditions reject result and contribution prose while preserving premise-led conditions", () => {
  const rejected = [
    "We observe that the optimal order quantity increases in demand.",
    "According to Theorem 2, the equilibrium price is higher.",
    "Our main results extend to the heterogeneous setting.",
    "Our goal is to minimize the total number of infections.",
    "The model minimizes total staffing cost.",
    "The immunology literature suggests that efficacy is constant.",
    "This upper bound is well known in the machine learning literature.",
    "Therefore, the optimal allocation improves welfare.",
    "The equilibrium price increases with demand.",
    "The theorem is formally proved in the online appendix.",
    "In Figure 6, the estimated treatment effect increases with capacity.",
    "The downward trend in all these figures suggests lower benefit per influencer.",
    "Interestingly, predictive allocation is preferred when residuals are identically distributed.",
    "The model performance remains unchanged across all tested parameter values."
  ];
  for (const condition of rejected) {
    const note = validNote();
    note.models[0].components[0].conditions = [condition];
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.ok(
      result.errors.some((entry) => entry.code === "component.condition.result-or-contribution"
        && entry.path.endsWith("components[0].conditions[0]")),
      condition
    );
  }

  for (const condition of [
    "When demand rises, the optimal order quantity increases.",
    "Under the fixed-capacity constraint, inventory cannot exceed available stock.",
    "Under the fixed budget, the planner minimizes total operating cost.",
    "Given a realized customer type, the firm chooses a feasible action.",
    "The fixed price remains unchanged throughout the selling horizon."
  ]) {
    const note = validNote();
    note.models[0].components[0].conditions = [condition];
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.equal(
      result.errors.some((entry) => entry.code === "component.condition.result-or-contribution"),
      false,
      condition
    );
  }
});

test("automated setup rejects numerical procedures, borrowed policies, and adverse outcomes as decisions", () => {
  for (const decision of [
    "Perform simulations",
    "Perform sensitivity analysis",
    "Perform numerical optimization to jointly optimize the pricing and timing decisions",
    "To compare the performance of the various mechanisms",
    "Policy used by Via (Via 2020) in that both allow for reservation and bundling",
    "Release products at the wrong time",
    "Release of the second generation delays its own market expansion and profit realization"
  ]) {
    const note = validNote();
    note.models[0].decisions = [decision];
    note.models[0].setupEvidence.decisions = [recordEvidence(decision, "actions")];
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.ok(
      result.errors.some((entry) => entry.code === "model.setup.malformed"
        && entry.path === "models[0].decisions[0]"),
      decision
    );
  }
});

test("automated setup rejects a decision extracted from cited precedent", () => {
  const note = validNote();
  note.models[0].decisions = ["A price"];
  note.models[0].setupEvidence.decisions = [{
    value: "A price",
    source: {
      type: "section",
      section: "Model Description",
      page: 1,
      matchedText: "a price",
      quote: "Stokey (1981) has suggested that a durable goods monopolist cannot charge a price above its cost."
    }
  }];
  const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
  assert.ok(result.errors.some((entry) => entry.code === "model.setup-evidence.borrowed-decision"));
});

test("automated methods reject coreferential result use and column-spliced estimation prose", () => {
  for (const method of [
    "These estimates allow us to simulate different policies and compare their performance under various market conditions.",
    "Second, we estimate the shift-length distribution, that is, what is the probability a driver prefers to be available side parameters, we discuss the details of calibrating these two quantities."
  ]) {
    const note = validNote();
    note.models[0].method = method;
    const result = validateModelNoteSemantics(note, { authoringMode: "source-mapped", pages, concepts });
    assert.ok(result.errors.some((entry) => entry.code === "model.method.malformed"), method);
  }
});

test("curated Mini notes relax automated rules and surface frozen extraction artifacts as warnings", () => {
  const note = validNote();
  note.question = "Inventory Balancing with Online Learning?";
  note.models[0].method = "Method";
  note.models[0].objects = [];
  note.models[0].components[0].conceptBindings[0].reviewStatus = "editorial";
  note.models[0].components[0].conceptBindings[0].sourceRefs = [];
  let result = validateModelNoteSemantics(note, { authoringMode: "curated", concepts });
  assert.deepEqual(result.errors, []);
  assert.equal(result.metrics.validationProfile, "editorial");

  note.models[0].components[0].explanation += " A hidden\u200B separator remains.";
  result = validateModelNoteSemantics(note, { authoringMode: "mini-editorial", concepts });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((entry) => entry.code === "text.extraction-noise-editorial"));
});
