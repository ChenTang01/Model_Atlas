import assert from "node:assert/strict";
import test from "node:test";
import {
  ADDITIONAL_CONCEPTS,
  buildAuthoredNote as buildAuthoredNoteWithParity,
  buildVariantModels,
  componentSourceSentence,
  finalizeNoteModels,
  materializeSetup,
  modelName,
  nonbaselineVariantSections,
  sourceFor,
  firstUsefulSentences
} from "../scripts/model-note-authoring.mjs";
import { isSubstantiveMethodStatement } from "../scripts/model-note-semantic-authoring.mjs";
import { isWhitespaceNormalizedSubstring } from "../scripts/model-note-text-quality.mjs";

// These fixtures exercise component/formula/variant behavior, not missing
// setup handling. Give each synthetic paper an explicit, source-authored base
// setup so the frozen Mini nonempty-setup invariant is not bypassed by a
// production fallback.
function buildAuthoredNote(record, pagesPayload, conceptDefinitions) {
  const withSetup = structuredClone(record);
  if (!(withSetup.players || []).length) withSetup.players = ["A focal decision maker"];
  if (!(withSetup.information || []).length) withSetup.information = ["Observed demand"];
  if (!(withSetup.actions || []).length) withSetup.actions = ["The decision maker chooses a source-defined policy"];
  if (!(withSetup.assumptions || []).length) {
    const premise = String(withSetup.model_topic || withSetup.title || "source-defined model").replace(/[.!?]+$/, "");
    withSetup.assumptions = [`The ${premise.toLowerCase()} parameters remain fixed throughout the modeled horizon.`];
  }
  // Most fixtures below isolate component, formula, and variant behavior. Give
  // those without a method an explicit reviewed procedure so an unrelated
  // method-completeness gate does not obscure the assertion under test.
  if (!withSetup.method) {
    withSetup.method = "The paper solves the model by deriving the decision rule from the stated objective and constraints.";
  }
  return buildAuthoredNoteWithParity(withSetup, pagesPayload, conceptDefinitions);
}

test("authored prose preserves complete sentences instead of clipping into extraction noise", () => {
  const first = "The seller chooses a price after observing demand and before allocating its limited inventory.";
  const second = "The model then evaluates a deliberately long parenthetical specification (with many additional parameters for capacity, service, demand, inventory, allocation, and customer behavior that would cross a short display budget before the closing delimiter).";
  assert.equal(firstUsefulSentences(`${first} ${second}`, 2, 20, { modelOnly: true }), first);
});

test("question-form paper titles yield a clean source-derived model name", () => {
  assert.equal(modelName({
    id: "geoconquesting",
    title: "Should an Ad Agency Offer Geoconquesting or Protection from It?",
    detail_level: "literature"
  }), "Geoconquesting or Protection from it model");
});

function source(page, section, quote) {
  return { page, section, equation: "", quote };
}

function richComponent(id, label, explanation, evidence = source(2, "Baseline Model", "The seller chooses a baseline menu for buyers under known demand.")) {
  return {
    id,
    label,
    role: "decision",
    concepts: [],
    explanation,
    searchPhrases: ["first query", "second query", "third query"],
    formal: "Decision rule: select the source-supported action.",
    formalKind: "Atlas restatement of source rule",
    symbols: [],
    conditions: [],
    sources: [evidence],
    conceptBindings: []
  };
}

const pages = [
  { page: 2, text: "2. Baseline Model The seller chooses a baseline menu for buyers under known demand. We assume buyers are risk neutral." },
  { page: 4, text: "3. A-Learning Regime The seller chooses message-contingent quality after each buyer sends a signal. Each buyer privately knows its valuation. We assume buyers send costless messages." },
  { page: 6, text: "4. O-Learning Regime The buyer chooses a requested quality and the seller decides whether to accept it. The seller observes the requested quality. We assume requests determine implemented quality." }
];

const sections = [
  {
    number: "2",
    title: "Baseline Model",
    page: 2,
    endPage: 2,
    text: "The seller chooses a baseline menu for buyers under known demand. We assume buyers are risk neutral.",
    lines: []
  },
  {
    number: "3",
    title: "A-Learning Regime",
    page: 4,
    endPage: 4,
    text: "The seller chooses message-contingent quality after each buyer sends a signal. Each buyer privately knows its valuation. We assume buyers send costless messages.",
    lines: []
  },
  {
    number: "4",
    title: "O-Learning Regime",
    page: 6,
    endPage: 6,
    text: "The buyer chooses a requested quality and the seller decides whether to accept it. The seller observes the requested quality. We assume requests determine implemented quality.",
    lines: []
  }
];

function baseModel() {
  return {
    id: "main-model",
    name: "Customization model",
    kind: "baseline",
    relation: "",
    relationships: [],
    summary: "The model compares customization regimes.",
    objects: ["Pooled actors"],
    inputs: ["Pooled inputs"],
    decisions: ["Pooled decisions"],
    assumptions: ["Pooled assumptions"],
    method: "The paper derives equilibrium choices under each regime.",
    sources: [source(2, "Baseline Model", "The seller chooses a baseline menu for buyers under known demand.")],
    components: [
      richComponent("baseline-menu", "Baseline menu", "The baseline menu governs known demand."),
      richComponent("a-message", "A-Learning message choice", "A-Learning uses message-contingent quality.", source(4, "A-Learning Regime", "The seller chooses message-contingent quality after each buyer sends a signal.")),
      richComponent("a-regime-duplicate", "A-Learning Regime", "A second source-derived description of the A-Learning regime.", source(4, "A-Learning Regime", "The seller chooses message-contingent quality after each buyer sends a signal.")),
      richComponent("o-request", "O-Learning request choice", "O-Learning uses requested quality.", source(6, "O-Learning Regime", "The buyer chooses a requested quality and the seller decides whether to accept it.")),
      richComponent("both-regimes", "Regime comparison", "A-Learning and O-Learning are compared."),
      richComponent("common-environment", "Common environment", "Customization uses a shared seller and buyer environment.")
    ]
  };
}

const record = {
  id: "synthetic-locality",
  title: "Customization",
  model_topic: "Customization",
  game_architecture: [],
  architecture_detail: [],
  assumptions: [],
  notation: []
};

test("multi-variant models use local source setup and uniquely owned components", () => {
  const base = baseModel();
  const before = structuredClone(base);
  const models = buildVariantModels(record, base, pages, sections, ADDITIONAL_CONCEPTS);

  assert.equal(models.length, 3);
  assert.deepEqual(base, before, "variant authoring must not mutate the whole-paper base model");

  const baseline = models.find((model) => model.kind === "baseline");
  const aLearning = models.find((model) => /^A-Learning/i.test(model.name));
  const oLearning = models.find((model) => /^O-Learning/i.test(model.name));
  assert.ok(baseline && aLearning && oLearning);

  assert.deepEqual(aLearning.decisions, ["Message-contingent quality"]);
  assert.deepEqual(aLearning.assumptions, ["Buyers send costless messages"]);
  assert.equal(aLearning.setupMaturity.decisions, "source-derived");
  assert.equal(aLearning.setupEvidence.decisions[0].source.section, "A-Learning Regime");
  assert.deepEqual(oLearning.decisions, ["A requested quality and the seller decides whether to accept it"]);
  assert.deepEqual(oLearning.assumptions, ["Requests determine implemented quality"]);
  assert.deepEqual(baseline.decisions, ["Pooled decisions"], "an unresolved local category may retain the common setup");
  assert.equal(baseline.setupMaturity.decisions, "unresolved");
  assert.deepEqual(baseline.setupEvidence.decisions, [], "unsupported base values do not receive fabricated evidence");
  assert.ok(baseline.setupDiagnostics.some((entry) => entry.code === "setup_inherited_from_base_model"));

  assert.deepEqual(aLearning.components.map((component) => component.id), ["a-learning-regime", "a-message"]);
  assert.equal(new Set(aLearning.components.map((component) => component.label.toLowerCase())).size, aLearning.components.length);
  assert.deepEqual(oLearning.components.map((component) => component.id), ["o-learning-regime", "o-request"]);
  assert.ok(!models.some((model) => model.components.some((component) => component.id === "both-regimes")));
  assert.ok(!models.some((model) => model.components.some((component) => component.id === "common-environment")));
  assert.equal(baseline.components.length, 2, "baseline components are not padded to an arbitrary quota");
});

test("a variant without a local procedure inherits the paper's source-grounded method", () => {
  const paperMethod = "The paper derives equilibrium allocation rules by solving the constrained dynamic program, characterizes threshold policies through first-order conditions, compares the baseline and extension under common demand primitives, and evaluates both regimes with numerical experiments calibrated to the source setting while retaining the same feasibility constraints and state transitions for a direct comparison of expected cost, service quality, actor payoffs, capacity use, inventory levels, and welfare across all modeled cases.";
  const base = { ...baseModel(), method: paperMethod };

  assert.equal(paperMethod.split(/\s+/).length, 69, "the fixture must remain near the semantic length limit");
  assert.equal(isSubstantiveMethodStatement(paperMethod), true);

  const models = buildVariantModels(record, base, pages, sections, ADDITIONAL_CONCEPTS);
  const variants = models.filter((model) => model.kind !== "baseline");

  assert.equal(variants.length, 2);
  for (const variant of variants) {
    assert.equal(variant.method, paperMethod);
    assert.equal(isSubstantiveMethodStatement(variant.method), true);
    assert.equal(variant.methodMaturity, "inherited-paper-method");
  }
});

test("variant setup does not misclassify author data collection as a model assumption", () => {
  const collectionSentence = "Instead, we collect the most popular books in five categories to a maximum number that is allowed by the platform.";
  const localSections = sections.map((section) => section.title === "A-Learning Regime"
    ? {
        ...section,
        text: `${collectionSentence} ${section.text}`,
        sourceText: `${collectionSentence} ${section.text}`
      }
    : section);
  const localPages = pages.map((page) => page.page === 4
    ? { ...page, text: `${collectionSentence} ${localSections.find((section) => section.page === 4).text.slice(collectionSentence.length + 1)}` }
    : page);
  const models = buildVariantModels(record, baseModel(), localPages, localSections, ADDITIONAL_CONCEPTS);
  const aLearning = models.find((model) => /^A-Learning/i.test(model.name));

  assert.ok(aLearning);
  assert.deepEqual(aLearning.assumptions, ["Buyers send costless messages"]);
  assert.ok(aLearning.setupEvidence.assumptions.every(({ value, source }) => (
    !/we collect|most popular books/i.test(value)
      && isWhitespaceNormalizedSubstring(source.quote, localPages.find((page) => page.page === source.page).text)
  )));
});

test("a local mathematical setup assumption supplements an existing component condition", () => {
  const preferenceAssumption = "With two message-contingent products, we assume that each buyer strictly prefers product 1 to product 2, that is, v1 > v2.";
  const localSections = sections.map((section) => section.title === "A-Learning Regime"
    ? {
        ...section,
        text: section.text.replace("We assume buyers send costless messages.", preferenceAssumption),
        sourceText: section.text.replace("We assume buyers send costless messages.", preferenceAssumption)
      }
    : section);
  const localPages = pages.map((page) => page.page === 4
    ? {
        ...page,
        text: page.text.replace("We assume buyers send costless messages.", preferenceAssumption)
      }
    : page);

  const models = buildVariantModels(record, baseModel(), localPages, localSections, ADDITIONAL_CONCEPTS);
  const aLearning = models.find((model) => /^A-Learning/i.test(model.name));
  const messageChoice = aLearning?.components.find((component) => component.id === "a-message");
  const preferenceIndex = (messageChoice?.conditions || [])
    .findIndex((condition) => condition.includes("v1 > v2"));

  assert.ok(messageChoice, "the source-grounded component must survive variant authoring");
  assert.ok(preferenceIndex >= 0, "the local mathematical assumption must supplement the existing source condition");
  assert.ok(messageChoice.conditions.some((condition) => /message-contingent quality/i.test(condition)),
    "supplementing setup must not displace the component's existing condition");
  assert.ok(messageChoice.conditions.length <= 3, "component condition bounds must remain intact");
  const evidence = (messageChoice.conditionEvidence || [])
    .find((entry) => entry.conditionIndex === preferenceIndex);
  assert.equal(evidence?.inheritedFromSetupField, "assumptions");
  assert.equal(evidence?.setupEvidence?.source?.page, 4);
  assert.equal(evidence?.setupEvidence?.source?.section, "A-Learning Regime");
  assert.equal(evidence?.setupEvidence?.source?.quote, preferenceAssumption);
});

test("same-page mathematical setup still requires component-local semantics", () => {
  const unrelatedAssumption = "The external bank reserve parameter satisfies r > 0.";
  const localSections = sections.map((section) => section.title === "A-Learning Regime"
    ? {
        ...section,
        text: section.text.replace("We assume buyers send costless messages.", unrelatedAssumption),
        sourceText: section.text.replace("We assume buyers send costless messages.", unrelatedAssumption)
      }
    : section);
  const localPages = pages.map((page) => page.page === 4
    ? { ...page, text: page.text.replace("We assume buyers send costless messages.", unrelatedAssumption) }
    : page);

  const models = buildVariantModels(record, baseModel(), localPages, localSections, ADDITIONAL_CONCEPTS);
  const messageChoice = models.find((model) => /^A-Learning/i.test(model.name))
    ?.components.find((component) => component.id === "a-message");

  assert.ok(messageChoice, "the independently grounded message component must survive");
  assert.equal(messageChoice.conditions.some((condition) => condition.includes("r > 0")), false,
    "page proximity alone cannot make an unrelated mathematical setup premise locally applicable");
});

test("a variant rejects subsection roadmap prose and inherits the paper method", () => {
  const paperMethod = "The paper derives equilibrium choices under each regime by solving the constrained optimization problem.";
  const localSections = sections.map((section) => section.title === "A-Learning Regime"
    ? {
        ...section,
        text: `${section.text} In Section 3.2.3, we first derive an analytic forest harvesting problem, which contrasts with the benchmark model.`
      }
    : section);
  const localPages = pages.map((page) => page.page === 4
    ? { ...page, text: localSections.find((section) => section.page === 4).text }
    : page);
  const models = buildVariantModels(record, { ...baseModel(), method: paperMethod }, localPages, localSections, ADDITIONAL_CONCEPTS);
  const aLearning = models.find((model) => /^A-Learning/i.test(model.name));
  assert.ok(aLearning);
  assert.equal(aLearning.method, paperMethod);
  assert.equal(aLearning.methodMaturity, "inherited-paper-method");
  assert.doesNotMatch(aLearning.method, /^In Section/i);
});

test("a paper without source-identified variants retains its base model unchanged", () => {
  const base = baseModel();
  const result = buildVariantModels(record, base, pages, [sections[0]], ADDITIONAL_CONCEPTS);
  assert.equal(result.length, 1);
  assert.strictEqual(result[0], base);
});

test("ordinary model subsections do not strand common setup in synthetic alternatives", () => {
  const ordinarySubsections = [
    { number: "2", title: "Model Development", page: 2, endPage: 2, text: "The planner chooses a deployment policy." },
    { number: "2.1", title: "Model of Software Diversity", page: 3, endPage: 3, text: "The planner allocates software across nodes." },
    { number: "2.2", title: "Information Theoretic Decision Model for Software Allocation", page: 4, endPage: 4, text: "The planner maximizes network diversity." },
    { number: "2.3", title: "Virus Propagation Model", page: 5, endPage: 5, text: "The model represents virus propagation on the network." }
  ];

  assert.deepEqual(nonbaselineVariantSections(record, ordinarySubsections), []);
  assert.ok(nonbaselineVariantSections(record, sections).some((section) => /Learning Regime/i.test(section.title)),
    "explicitly named regimes still own their local setup sections");
});

test("source variants cannot displace a reviewed whole-paper deep model map", () => {
  const objective = richComponent(
    "objective-and-constraints",
    "Objective and constraints",
    "Each firm chooses its regularization parameter to maximize expected profit.",
    source(5, "Main Model", "Each firm chooses its regularization parameter to maximize expected profit.")
  );
  objective.role = "objective";
  objective.formal = "\\lambda_j^*=\\arg\\max_{\\lambda_j}\\Pi_j(\\lambda_j)";
  objective.symbols = [
    { symbol: "\\lambda_j", meaning: "regularization parameter chosen by firm j" },
    { symbol: "\\Pi_j(\\lambda_j)", meaning: "firm j's expected profit" }
  ];
  const reviewedBase = {
    ...baseModel(),
    name: "Competitive targeting model",
    components: [objective]
  };
  const localPages = [
    { page: 3, text: "3. Monopoly Benchmark The monopoly benchmark chooses its targeting rule to maximize expected profit. We assume monopoly demand is known before the targeting rule is chosen." },
    { page: 5, text: "5. Main Model Each firm chooses its regularization parameter to maximize expected profit." }
  ];
  const localSections = [
    {
      number: "3",
      title: "Monopoly Benchmark",
      page: 3,
      endPage: 3,
      text: "The monopoly benchmark chooses its targeting rule to maximize expected profit. We assume monopoly demand is known before the targeting rule is chosen.",
      lines: []
    },
    {
      number: "5",
      title: "Main Model",
      page: 5,
      endPage: 5,
      text: "Each firm chooses its regularization parameter to maximize expected profit.",
      lines: []
    }
  ];
  const models = buildVariantModels(
    { ...record, detail_level: "model_map", model_topic: "Competitive targeting model" },
    reviewedBase,
    localPages,
    localSections,
    ADDITIONAL_CONCEPTS
  );

  assert.strictEqual(models[0], reviewedBase, "the reviewed whole-paper model remains the release baseline");
  assert.equal(models.filter((model) => model.kind === "baseline").length, 1);
  assert.ok(models[0].components.some((component) => component.id === "objective-and-constraints"));
  assert.equal(models[0].components[0].formal, objective.formal);
  assert.deepEqual(models[0].components[0].symbols, objective.symbols);
  const benchmark = models.find((model) => /monopoly benchmark/i.test(model.name));
  assert.ok(benchmark, "the source-identified benchmark remains an additive model variant");
  assert.equal(benchmark.relationships[0].targetModelId, reviewedBase.id);
});

test("a generic numbered Extended Model subsection is merged into its descriptive parent extension", () => {
  const reviewedBase = { ...baseModel(), name: "Reviewed customer-information game" };
  const localPages = [{
    page: 2,
    text: "5. Extensions: Strategic Customers\nIn this extension, customers instead observe a private signal before choosing whether to purchase. We analyze the resulting equilibrium by backward induction."
  }, {
    page: 3,
    text: "5.1. Extended Model\nThe extended model allows each seller to choose a price after observing the signal. We assume the private signal is conditionally independent across customers."
  }];
  const localSections = [{
    number: "5",
    title: "Extensions: Strategic Customers",
    page: 2,
    endPage: 2,
    text: "In this extension, customers instead observe a private signal before choosing whether to purchase. We analyze the resulting equilibrium by backward induction.",
    sourceText: "In this extension, customers instead observe a private signal before choosing whether to purchase. We analyze the resulting equilibrium by backward induction.",
    lines: [],
    sourceLines: []
  }, {
    number: "5.1",
    title: "Extended Model",
    page: 3,
    endPage: 3,
    text: "The extended model allows each seller to choose a price after observing the signal. We assume the private signal is conditionally independent across customers.",
    sourceText: "The extended model allows each seller to choose a price after observing the signal. We assume the private signal is conditionally independent across customers.",
    lines: [],
    sourceLines: []
  }];
  const models = buildVariantModels(
    { ...record, detail_level: "model_map", model_topic: "Reviewed customer-information game" },
    reviewedBase,
    localPages,
    localSections,
    ADDITIONAL_CONCEPTS
  );

  assert.strictEqual(models[0], reviewedBase);
  assert.equal(models.length, 2);
  assert.equal(models.some((model) => /^Extended Model$/i.test(model.name)), false);
  const extension = models.find((model) => /^Extensions: Strategic Customers$/i.test(model.name));
  assert.ok(extension);
  assert.ok(extension.components.some((component) => component.label === "Extended Model"));
});

test("a named variant without a literal local component is dropped instead of borrowing a base component", () => {
  const mismatchedSections = sections.map((section) => section.title === "O-Learning Regime"
    ? { ...section, text: "The phantom extension chooses a laboratory treatment under a hidden protocol." }
    : section);
  const mismatchedPages = pages.map((page) => page.page === 6
    ? { ...page, text: "Unrelated appendix prose discusses archival citations and acknowledgments." }
    : page);
  const models = buildVariantModels(record, baseModel(), mismatchedPages, mismatchedSections, ADDITIONAL_CONCEPTS);

  assert.equal(models.length, 2);
  assert.ok(models.some((model) => /^A-Learning/i.test(model.name)));
  assert.equal(models.some((model) => /^O-Learning/i.test(model.name)), false);
  assert.equal(models.some((model) => model.components.some((component) => component.id === "o-request")), false);
});

test("a current page-backed explicit variant fails closed when semantic materialization is empty", () => {
  const unsupportedSections = sections.map((section) => section.title === "O-Learning Regime"
    ? { ...section, text: "Archival citations and acknowledgments are recorded for completeness." }
    : section);
  const currentPages = pages.map((page) => page.page === 6
    ? { ...page, text: "4. O-Learning Regime Archival citations and acknowledgments are recorded for completeness." }
    : page);

  assert.throws(
    () => buildVariantModels(record, baseModel(), currentPages, unsupportedSections, ADDITIONAL_CONCEPTS),
    /explicitly planned nonbaseline formulation did not materialize \(O-Learning Regime\)/i
  );
});

test("variant setup ignores a source heading that becomes invalid when its authoring prefix is removed", () => {
  const localPages = [
    { page: 2, text: "2. Multiple Inputs and Impact Categories The manager chooses which supplier impacts to inspect before making a disclosure decision. We assume supplier impacts are observable before the disclosure decision." },
    pages[1]
  ];
  const localSections = [
    {
      number: "2",
      title: "Multiple Inputs and Impact Categories",
      page: 2,
      endPage: 2,
      text: "The manager chooses which supplier impacts to inspect before making a disclosure decision. We assume supplier impacts are observable before the disclosure decision.",
      lines: []
    },
    sections[1]
  ];
  const localRecord = { ...record, model_topic: "Multiple Inputs and Impact Categories" };
  const base = baseModel();
  const models = buildVariantModels(localRecord, base, localPages, localSections, ADDITIONAL_CONCEPTS);

  assert.equal(models.length, 1);
  assert.strictEqual(models[0], base, "a nonmodel source heading cannot force a synthetic baseline variant");
});

test("a repaired wrapped variant title is propagated without leaking its continuation into component prose", () => {
  const localPages = [
    {
      page: 4,
      text: "2. Baseline Model\nThe supplier sets a wholesale price before the retailer chooses an offline price. We assume consumers observe both prices before visiting the store."
    },
    {
      page: 15,
      text: "5. Extension: When the Offline Price Is\nNot Observable Ex Ante In the previous discussion, we assume that consumers observe the offline price before they visit the physical retailer's store. In this extension, consumers instead form an expected offline price after observing the online price."
    }
  ];
  const localSections = [
    {
      number: "2",
      title: "Baseline Model",
      page: 4,
      endPage: 4,
      text: "The supplier sets a wholesale price before the retailer chooses an offline price. We assume consumers observe both prices before visiting the store.",
      lines: []
    },
    {
      number: "5",
      title: "Extension: When the Offline Price Is",
      page: 15,
      endPage: 15,
      text: "Not Observable Ex Ante In the previous discussion, we assume that consumers observe the offline price before they visit the physical retailer's store. In this extension, consumers instead form an expected offline price after observing the online price.",
      sourceText: "Not Observable Ex Ante In the previous discussion, we assume that consumers observe the offline price before they visit the physical retailer's store. In this extension, consumers instead form an expected offline price after observing the online price.",
      lines: [],
      sourceLines: []
    }
  ];
  const base = {
    ...baseModel(),
    objects: ["The supplier, retailer, and consumers"],
    inputs: ["Online and offline prices"],
    decisions: ["The supplier and retailer choose channel prices"],
    assumptions: ["Consumers observe both prices before visiting the store"]
  };
  const models = buildVariantModels({
    ...record,
    id: "synthetic-wrapped-variant-title",
    title: "Consumer Showrooming",
    model_topic: "Showrooming under channel competition"
  }, base, localPages, localSections, ADDITIONAL_CONCEPTS);

  const extension = models.find((model) => model.kind === "extension");
  assert.ok(extension);
  assert.equal(extension.name, "Extension: When the Offline Price Is Not Observable Ex Ante");
  assert.equal(extension.components[0].label, "Extension: When the Offline Price Is Not Observable Ex Ante");
  assert.doesNotMatch(extension.components[0].explanation, /^Not Observable Ex Ante\b/);
  assert.doesNotMatch(extension.components[0].sources[0].quote, /^Not Observable Ex Ante\b/);
  assert.match(extension.components[0].sources[0].quote, /consumers observe the offline price|expected offline price/i);
  assert.match(extension.components[0].sources[0].quote, /relax this assumption|instead form an expected offline price/i);
  assert.match(extension.components[0].conditions[0], /relax this assumption|instead form an expected offline price/i);
});

test("heading-free source text receives one honest literal fallback component", () => {
  const pageText = "The decision maker chooses an order quantity before uncertain demand is observed. The policy minimizes expected shortage and holding costs over the demand distribution.";
  const note = buildAuthoredNote({
    id: "synthetic-heading-free-model",
    title: "Robust Inventory Policy",
    business_question: "How should the decision maker choose inventory under uncertain demand?",
    model_topic: "Inventory policy under uncertain demand",
    primary_topic: "inventory control",
    abstract: "The paper studies an inventory policy that chooses an order quantity before uncertain demand is observed.",
    detail_level: "literature"
  }, { pages: [{ page: 1, text: pageText }] }, ADDITIONAL_CONCEPTS);

  assert.equal(note.models[0].components.length, 1);
  const component = note.models[0].components[0];
  assert.match(component.label, /model/i);
  assert.ok(pageText.includes(component.sources[0].quote));
  assert.match(component.sources[0].quote, /order quantity|uncertain demand/i);
  assert.ok(["objects", "inputs", "decisions", "assumptions"]
    .every((field) => note.models[0][field].length && note.models[0].setupEvidence[field].length));
  assert.ok(component.conditions.length > 0);
  assert.ok(component.concepts.length > 0);
  assert.ok(component.searchPhrases.length > 0);
  assert.ok(component.conceptBindings.every((binding) => binding.status === "modeled"
    && binding.conditionRefs.length > 0 && binding.sourceRefs.length > 0));
});

test("setup evidence remaps normalized PDF ligatures to the exact raw page sentence", () => {
  const pageText = [
    "1. Model Setup",
    "The ﬁrm chooses an order quantity before uncertain demand is observed.",
    "We assume that demand is stationary over the modeled horizon.",
    "The policy minimizes expected shortage and holding costs over the demand distribution."
  ].join("\n");
  const note = buildAuthoredNoteWithParity({
    id: "synthetic-setup-ligature-remap",
    title: "Robust Inventory Policy",
    business_question: "How should the firm choose inventory under uncertain demand?",
    model_topic: "Inventory policy under uncertain demand",
    primary_topic: "inventory control",
    abstract: "The paper studies an inventory policy under uncertain demand.",
    method: "The paper derives the inventory decision rule from the stated objective and constraints.",
    detail_level: "literature"
  }, { pages: [{ page: 1, text: pageText }] }, ADDITIONAL_CONCEPTS);

  const objectEvidence = note.models[0].setupEvidence.objects[0];
  assert.equal(objectEvidence.value, "The firm");
  assert.match(objectEvidence.source.quote, /The ﬁrm chooses an order quantity/);
  assert.equal(isWhitespaceNormalizedSubstring(objectEvidence.source.quote, pageText), true);
  assert.doesNotMatch(objectEvidence.source.quote, /The firm chooses/,
    "the citation retains the raw ligature instead of publishing a repaired nonliteral quote");
  const modelAndComponentSources = note.models.flatMap((model) => [
    ...(model.sources || []),
    ...(model.components || []).flatMap((component) => component.sources || [])
  ]);
  assert.ok(modelAndComponentSources.length > 0);
  assert.ok(modelAndComponentSources.every((source) => isWhitespaceNormalizedSubstring(source.quote, pageText)),
    "every authored model and component source remains a raw-page literal");
});

test("component source selection restores raw ligatures, combining marks, and mathematical glyphs", () => {
  const rawSentence = "The ﬁrm chooses capacity a\u0304 and multiplier 𝜆 before uncertain demand is observed.";
  const normalizedSentence = rawSentence.normalize("NFKC");
  const pageText = ["2. Capacity Decision", rawSentence].join("\n");
  const section = {
    number: "2",
    title: "Capacity Decision",
    page: 2,
    endPage: 2,
    text: normalizedSentence,
    sourceText: normalizedSentence,
    lines: [{ page: 2, text: normalizedSentence }],
    sourceLines: [{ page: 2, text: normalizedSentence }]
  };

  const source = sourceFor(
    [{ page: 2, text: pageText }],
    section,
    "firm capacity multiplier uncertain demand",
    "",
    { componentRole: "decision", preferredQuote: normalizedSentence }
  );

  assert.ok(source);
  assert.equal(source.quote, rawSentence);
  assert.equal(isWhitespaceNormalizedSubstring(source.quote, pageText), true);
  assert.match(source.quote, /ﬁrm/u);
  assert.match(source.quote, /a\u0304/u);
  assert.match(source.quote, /𝜆/u);
});

test("component source selection retains an exact leading model clause when only the trailing comparison is line-break damaged", () => {
  const rawPrefix = "We now extend the model to allow contracts with a ﬁxed-payment component and per-unit prices";
  const normalizedSentence = "We now extend the model to allow contracts with a fixed-payment component and per-unit prices, similar to two-part tariffs.";
  const pageText = [
    "3.6. Model Extension: Two-Part Tariffs",
    `${rawPrefix}, sim-`,
    "ilar to two-part tariffs."
  ].join("\n");
  const section = {
    number: "3.6",
    title: "Model Extension: Two-Part Tariffs",
    page: 13,
    endPage: 13,
    text: normalizedSentence,
    sourceText: normalizedSentence,
    lines: [{ page: 13, text: normalizedSentence }],
    sourceLines: [{ page: 13, text: normalizedSentence }]
  };

  const source = sourceFor(
    [{ page: 13, text: pageText }],
    section,
    `Two-Part Tariffs ${normalizedSentence}`,
    "",
    { componentRole: "decision", preferredQuote: normalizedSentence }
  );

  assert.ok(source);
  assert.equal(source.quote, rawPrefix);
  assert.equal(isWhitespaceNormalizedSubstring(source.quote, pageText), true);
  assert.doesNotMatch(source.quote, /sim-?\s*ilar/i,
    "the exact clause must not manufacture a repaired version of the damaged trailing word");
});

test("setup evidence skips repaired line-break hyphens and retains a later clean literal choice", () => {
  const pageText = [
    "1. Model Setup",
    "The firm chooses a pre-",
    "announcement policy before uncertain demand is observed.",
    "The retailer chooses an order quantity before uncertain demand is observed.",
    "We assume that demand is stationary over the modeled horizon.",
    "The policy minimizes expected shortage and holding costs over the demand distribution."
  ].join("\n");
  const note = buildAuthoredNoteWithParity({
    id: "synthetic-setup-linebreak-hyphen",
    title: "Robust Inventory Policy",
    business_question: "How should the retailer choose inventory under uncertain demand?",
    model_topic: "Inventory policy under uncertain demand",
    primary_topic: "inventory control",
    abstract: "The paper studies an inventory policy under uncertain demand.",
    method: "The paper derives the inventory decision rule from the stated objective and constraints.",
    detail_level: "literature"
  }, { pages: [{ page: 1, text: pageText }] }, ADDITIONAL_CONCEPTS);

  const decisionEvidence = note.models[0].setupEvidence.decisions;
  assert.ok(decisionEvidence.some((entry) => /retailer chooses an order quantity/i.test(entry.source.quote)));
  assert.ok(decisionEvidence.every((entry) => isWhitespaceNormalizedSubstring(entry.source.quote, pageText)));
  assert.ok(decisionEvidence.every((entry) => !/preannouncement/i.test(entry.source.quote)),
    "a repaired line-break word must never become a nonliteral citation");
});

test("setup evidence narrows noisy raw sentences to clean literal inputs and trims fused footnote prefixes", () => {
  const primaryInput = "The topography, the type of vegetation, an ignition risk map, and climate conditions of Uruguay";
  const packageChoice = "A package of three shares at a total price of $9";
  const pageText = [
    "2. Model Setup",
    "The simula -",
    "tion considers the topography, the type of vegetation, an ignition risk map, and climate conditions of Uruguay as the primary input.",
    "4 Suppose, for instance, that a single seller offers a package of three shares at a total price of $9."
  ].join("\n");
  const setup = {
    entities: [],
    inputs: [primaryInput],
    decisions: [packageChoice],
    assumptions: [],
    maturity: { inputs: "source-derived", decisions: "source-derived" },
    diagnostics: [],
    evidence: {
      entities: [],
      inputs: [{
        value: primaryInput,
        source: {
          type: "section",
          section: "Model Setup",
          page: 2,
          quote: `The simulation considers ${primaryInput.replace(/^The/, "the")} as the primary input.`,
          matchedText: primaryInput.replace(/^The/, "the"),
          derivation: "literal-explicit-input"
        }
      }],
      decisions: [{
        value: packageChoice,
        source: {
          type: "section",
          section: "Model Setup",
          page: 2,
          quote: `4 Suppose, for instance, that a single seller offers ${packageChoice.toLowerCase()}.`
        }
      }],
      assumptions: []
    }
  };

  const materialized = materializeSetup(setup, {}, { pages: [{ page: 2, text: pageText }] });
  assert.deepEqual(materialized.inputs, [primaryInput]);
  assert.equal(materialized.setupEvidence.inputs[0].source.quote, primaryInput.replace(/^The/, "the"));
  assert.deepEqual(materialized.decisions, [packageChoice]);
  assert.match(materialized.setupEvidence.decisions[0].source.quote, /^Suppose, for instance/);
  assert.doesNotMatch(materialized.setupEvidence.decisions[0].source.quote, /^4\s/);
  for (const field of ["inputs", "decisions"]) {
    assert.ok(materialized.setupEvidence[field].every(({ source }) => (
      isWhitespaceNormalizedSubstring(source.quote, pageText)
    )));
  }
});

test("finalization preserves local qualifications and permits shared evidence without retaining clones", () => {
  const sharedQuote = "The retailer chooses order quantity q to maximize profit in an inventory optimization under fixed demand and capacity.";
  const sharedConditions = [
    "Demand remains fixed before the retailer chooses its inventory quantity.",
    "The order quantity q cannot exceed fixed inventory capacity."
  ];
  const component = ({ id, label, role, explanation, formal }) => ({
    id,
    label,
    role,
    concepts: [],
    explanation,
    searchPhrases: [`${label} first`, `${label} second`, `${label} third`],
    formal,
    formalKind: "Atlas restatement of source rule",
    symbols: [],
    conditions: [...sharedConditions],
    sources: [source(2, "Inventory optimization", sharedQuote)],
    conceptBindings: []
  });
  const decision = component({
    id: "inventory-decision",
    label: "Inventory quantity decision",
    role: "decision",
    explanation: "The retailer chooses inventory quantity q under fixed demand and available capacity.",
    formal: "Decision rule: choose a capacity-feasible inventory quantity."
  });
  const objective = component({
    id: "inventory-objective",
    label: "Inventory profit objective",
    role: "objective",
    explanation: "The retailer maximizes profit over inventory quantities under fixed demand and available capacity.",
    formal: "Objective rule: maximize profit over capacity-feasible inventory quantities."
  });
  const clone = structuredClone(decision);
  clone.id = "renamed-inventory-decision";
  clone.label = "Renamed inventory decision copy";
  clone.searchPhrases = ["renamed first", "renamed second", "renamed third"];

  const [model] = finalizeNoteModels([{
    id: "inventory-model",
    components: [decision, objective, clone]
  }], ADDITIONAL_CONCEPTS, "synthetic-shared-evidence");

  assert.equal(model.components.length, 2, "the renamed substantive clone is removed within its model");
  for (const retained of model.components) {
    assert.ok(sharedConditions.every((condition) => retained.conditions.includes(condition)),
      "all independently applicable component conditions survive finalization");
    assert.equal(retained.sources[0].quote, sharedQuote,
      "one multifunction source sentence may support distinct components");
    assert.ok(retained.conceptBindings.every((binding) => binding.conditionRefs.length > 0
      && binding.conditionRefs.every((index) => index >= 0 && index < retained.conditions.length)));
  }
});

test("component prose cannot be copied wholesale into a missing setup field", () => {
  assert.throws(() => buildAuthoredNoteWithParity({
    id: "synthetic-field-semantic-setup",
    title: "Bound Tightening",
    business_question: "How are valid bounds computed?",
    model_topic: "Computing valid bounds for a decision problem",
    method: "The paper derives valid bounds using a dynamic program.",
    detail_level: "literature",
    players: ["A decision maker"],
    information: ["Observed demand"],
    actions: [],
    assumptions: ["Demand is stationary"]
  }, {
    pages: [{
      page: 1,
      text: "1. Model Analysis\nTighter bounds can be derived using the Bonferroni inequalities. More details of CMM are presented in the Online Appendix."
    }]
  }, ADDITIONAL_CONCEPTS), /source-grounded model setup is incomplete \(decisions\)/);
});

test("an unrelated setup premise cannot become a component condition", () => {
  assert.throws(() => buildAuthoredNoteWithParity({
    id: "synthetic-unrelated-component-condition",
    title: "Assignment Decomposition",
    business_question: "How should assignments be computed?",
    model_topic: "Decomposition for an assignment problem",
    method: "The paper solves the assignment problem with a decomposition algorithm.",
    detail_level: "literature",
    players: ["A planner"],
    information: ["Observed demand"],
    actions: ["The planner chooses assignments"],
    assumptions: ["Demand is stationary over the modeled horizon."]
  }, {
    pages: [{
      page: 2,
      text: "2. Decomposition Algorithm\nThe procedure separates coupling constraints and solves each assignment subproblem iteratively."
    }]
  }, ADDITIONAL_CONCEPTS), /no component retained a source-grounded condition and modeled concept binding/);
});

test("finalization drops prebound nonlocal conditions and incomplete source fragments", () => {
  const localCondition = "The retailer chooses an order quantity subject to available inventory capacity.";
  const component = {
    id: "inventory-order-decision",
    label: "Inventory order decision",
    role: "decision",
    concepts: ["inventory-control"],
    explanation: "The retailer chooses an inventory order quantity that respects available capacity.",
    searchPhrases: ["inventory order decision", "retailer quantity choice", "capacity-feasible inventory"],
    formal: "Decision rule: choose a capacity-feasible inventory order quantity.",
    formalKind: "Atlas restatement of source rule",
    symbols: [],
    conditions: [
      "The analysis is partial equilibrium and omits banking-system feedback.",
      "We formulate the problem for which, in each period",
      localCondition
    ],
    sources: [source(2, "Inventory optimization", localCondition)],
    conceptBindings: [{
      conceptId: "inventory-control",
      status: "modeled",
      representation: "The retailer chooses its capacity-feasible inventory order quantity.",
      conditionRefs: [0, 1, 2],
      sourceRefs: [{ scope: "component", index: 0 }],
      reviewStatus: "automated-source-map"
    }]
  };

  const [model] = finalizeNoteModels([{
    id: "inventory-model",
    components: [component]
  }], ADDITIONAL_CONCEPTS, "synthetic-strict-condition-locality");

  assert.deepEqual(model.components[0].conditions, [localCondition],
    "a stale modeled binding cannot preserve an unrelated premise or a clipped modeling declaration");
});

test("reviewed mathematical formals require symbols and are classified honestly", () => {
  const record = {
    id: "synthetic-reviewed-objective",
    title: "Profit Optimization",
    business_question: "How should the planner maximize expected profit?",
    model_topic: "Expected-profit optimization under stationary demand",
    primary_topic: "optimization",
    detail_level: "model_map",
    objective: {
      summary: "The planner maximizes expected profit under stationary demand.",
      formula: "max_{q >= 0} p q - c q",
      formula_source: "PDF p. 2, objective formulation"
    }
  };
  const pagesPayload = { pages: [{
    page: 2,
    text: "2. Model Objective\nThe planner maximizes expected profit under stationary demand."
  }] };

  const withoutSymbol = buildAuthoredNote(record, pagesPayload, ADDITIONAL_CONCEPTS);
  const downgraded = withoutSymbol.models[0].components.find((component) => component.label === "Objective and constraints");
  assert.ok(downgraded);
  assert.equal(downgraded.formalKind, "Atlas restatement of source rule");
  assert.notEqual(downgraded.formal, record.objective.formula);

  const withSymbol = buildAuthoredNote({
    ...record,
    id: "synthetic-reviewed-objective-with-symbol",
    notation: [{ symbol: "q", meaning: "quantity chosen by the planner" }]
  }, pagesPayload, ADDITIONAL_CONCEPTS);
  const retained = withSymbol.models[0].components.find((component) => component.label === "Objective and constraints");
  assert.ok(retained);
  assert.equal(retained.formalKind, "Atlas normalized notation");
  assert.equal(retained.formal, record.objective.formula);
  assert.ok(retained.symbols.some((symbol) => symbol.symbol === "q"));
});

test("legacy equilibrium labels are concise while the full reviewed wording remains in the explanation", () => {
  const fullLabel = "Region-forecast information-sharing equilibrium (partition cheap-talk equilibrium); no meaningful point-forecast equilibrium when products are substitutes";
  const note = buildAuthoredNote({
    id: "synthetic-equilibrium-label",
    title: "Information Sharing",
    business_question: "How does information sharing affect equilibrium outcomes?",
    model_topic: "Information-sharing equilibrium",
    primary_topic: "information sharing",
    detail_level: "model_map",
    equilibrium: {
      label: fullLabel,
      evidence: "The paper characterizes the equilibrium under substitutable products."
    }
  }, { pages: [{
    page: 2,
    text: [
      "2. Model",
      "The model studies a region-forecast information-sharing equilibrium when products are substitutes.",
      "The firms choose messages before competing in the product market under known demand."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const equilibrium = note.models[0].components.find((component) => /equilibrium/i.test(component.label));
  assert.ok(equilibrium);
  assert.equal(equilibrium.label, "Region-forecast information-sharing equilibrium");
  assert.match(equilibrium.explanation, /no meaningful point-forecast equilibrium/i);
  assert.ok(equilibrium.sources[0].quote.includes("region-forecast information-sharing equilibrium"));
});

test("reviewed legacy components reserve literal quotes that support each component role", () => {
  const note = buildAuthoredNote({
    id: "synthetic-role-aware-legacy-sources",
    title: "Capacity and Reimbursement",
    business_question: "How should a payer and provider coordinate reimbursement and capacity?",
    model_topic: "Three-stage reimbursement and capacity game",
    primary_topic: "healthcare operations",
    detail_level: "model_map",
    players: ["The payer", "The healthcare provider", "Patients"],
    actions: [
      "The payer sets a reimbursement payment.",
      "The healthcare provider chooses a capacity commitment.",
      "Patients choose a service channel."
    ],
    information: ["All participants observe the reimbursement and capacity commitment."],
    assumptions: [
      "Patients arrive according to a stationary Poisson process.",
      "We assume the reimbursement payment is publicly observed.",
      "We assume the provider's capacity commitment is nonnegative.",
      "We assume reimbursement revenue is the provider's objective.",
      "We assume patients use symmetric waiting-time expectations.",
      "We assume the three modeled stages occur sequentially."
    ],
    timing: "The payer moves first, the provider moves second, and patients move third in a Stackelberg game.",
    objective: { summary: "The healthcare provider chooses capacity to maximize reimbursement revenue." },
    equilibrium: { label: "Symmetric patient-choice equilibrium", evidence: "Patients use symmetric equilibrium waiting-time expectations." },
    method: "The paper solves the payer, provider, and patient stages by backward induction."
  }, { pages: [{
    page: 2,
    text: [
      "2. Model",
      "Patients incur a holding cost and a copayment for each service visit.",
      "We formulate a three-stage Stackelberg game with a payer, a healthcare provider, and patients.",
      "In the first stage, the payer sets a reimbursement payment.",
      "In the second stage, the healthcare provider chooses a capacity commitment.",
      "In the third stage, patients choose a service channel.",
      "All participants observe the reimbursement and capacity commitment.",
      "The healthcare provider chooses capacity to maximize reimbursement revenue.",
      "Patients use symmetric equilibrium waiting-time expectations.",
      "The paper solves the payer, provider, and patient stages by backward induction.",
      "Patients arrive according to a stationary Poisson process.",
      "We assume the reimbursement payment is publicly observed.",
      "We assume the provider's capacity commitment is nonnegative.",
      "We assume reimbursement revenue is the provider's objective.",
      "We assume patients use symmetric waiting-time expectations.",
      "We assume the three modeled stages occur sequentially."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const components = note.models[0].components;
  const decision = components.find((component) => component.label === "Decisions and actions");
  const objective = components.find((component) => component.label === "Objective and constraints");
  const method = components.find((component) => component.label === "Solution or estimation method");
  assert.ok(decision && objective && method, JSON.stringify(components.map((component) => ({ label: component.label, quote: component.sources?.[0]?.quote }))));
  assert.match(decision.sources[0].quote, /(?:sets a reimbursement|chooses a capacity|choose a service channel)/i);
  assert.doesNotMatch(decision.sources[0].quote, /holding cost|copayment/i);
  assert.match(objective.sources[0].quote, /maximize reimbursement revenue/i);
  assert.match(method.sources[0].quote, /backward induction/i);
});

test("reviewed TeX notation and domains survive deep-map component authoring", () => {
  const note = buildAuthoredNote({
    id: "synthetic-reviewed-notation",
    title: "Competitive Algorithm Choice",
    business_question: "How should competing firms choose algorithm complexity?",
    model_topic: "Competitive algorithm selection",
    primary_topic: "algorithm competition",
    detail_level: "model_map",
    players: ["two competing firms"],
    actions: ["each firm chooses a nonnegative regularization parameter"],
    objective: {
      summary: "Each firm chooses regularization to maximize expected profit.",
      formula: "\\lambda_j^*=\\arg\\max_{\\lambda_j}\\Pi_j(\\lambda_j)",
      formula_source: "Equation (13), PDF p. 4"
    },
    notation: [
      { symbol: "\\lambda_j", meaning: "regularization parameter selected by firm j", domain: "nonnegative", role: "algorithm choice" },
      { symbol: "\\lambda_j^*", meaning: "firm j's equilibrium regularization", domain: "nonnegative", role: "equilibrium choice" },
      { symbol: "\\Pi_j(\\lambda_j)", meaning: "firm j's expected profit under its algorithm choice", domain: "real-valued expected profit", role: "firm objective" },
      { symbol: "j\\in\\{1,2\\}", meaning: "index of the two competing firms", domain: "two-element player set", role: "player index" }
    ]
  }, { pages: [{
    page: 4,
    text: "4. Competitive Model\nEach firm chooses a nonnegative regularization parameter to maximize expected profit in competition.\nEquation (13) characterizes the equilibrium algorithm choices."
  }] }, ADDITIONAL_CONCEPTS);

  const objective = note.models[0].components.find((component) => component.id === "objective-and-constraints");
  assert.ok(objective);
  assert.equal(objective.formal, "\\lambda_j^*=\\arg\\max_{\\lambda_j}\\Pi_j(\\lambda_j)");
  assert.equal(objective.sources[0].page, 4, "the reviewed formula uses its documented PDF page");
  assert.equal(objective.sources[0].equation, "(13)");
  assert.deepEqual(objective.symbols.map((entry) => entry.symbol), [
    "\\lambda_j",
    "\\lambda_j^*",
    "\\Pi_j(\\lambda_j)",
    "j\\in\\{1, 2\\}"
  ]);
  assert.deepEqual(objective.symbols.map((entry) => entry.meaning), [
    "regularization parameter selected by firm j · nonnegative",
    "firm j's equilibrium regularization · nonnegative",
    "firm j's expected profit under its algorithm choice · real-valued expected profit",
    "index of the two competing firms · two-element player set"
  ]);
});

test("the objective component preserves the complete reviewed notation catalog", () => {
  const notation = [
    { symbol: "S(X;c)", meaning: "surplus generated by allocation X under cost c" },
    { symbol: "pi_n(w_n)", meaning: "retailer payoff under wholesale price w n" },
    { symbol: "Pi_n(w_n)", meaning: "manufacturer payoff under wholesale price w n" },
    { symbol: "w_ij", meaning: "match weight for pair i and j" },
    { symbol: "p_hat", meaning: "estimated probability of a successful outcome" },
    { symbol: "theta_tilde", meaning: "reported type used by the mechanism" },
    { symbol: "V_bar", meaning: "upper continuation value in the dynamic program" },
    { symbol: "y:X→Y, ≽_y", meaning: "mapping and preference relation induced by y" },
    { symbol: "Y_i(t)∈{0,1,∅}", meaning: "observed outcome including the empty outcome" },
    { symbol: "psi* in {psi_1, ..., psi_N}", meaning: "optimal policy selected from the candidate policy set" },
    { symbol: "In, Out", meaning: "binary participation labels available to each firm" },
    { symbol: "calligraphic F", meaning: "feasible family of allocation rules" },
    { symbol: "q_i=r_i+nu_i", meaning: "quality of firm i's proof-of-concept prototype" },
    { symbol: "D(p), alpha", meaning: "linear service demand and its market-size intercept, with D(p)=alpha-p" },
    { symbol: "bad�symbol", meaning: "corrupt notation must never be published" }
  ];
  const note = buildAuthoredNote({
    id: "synthetic-reviewed-notation-catalog",
    title: "Allocation Rules",
    business_question: "How should the planner select an allocation rule?",
    model_topic: "Allocation-rule design",
    primary_topic: "allocation design",
    detail_level: "model_map",
    players: ["a planner and participating firms"],
    actions: ["the planner selects a feasible allocation rule"],
    objective: {
      summary: "The planner selects a feasible rule to maximize expected allocation surplus.",
      formula: "X^*=\\arg\\max_{X\\in\\mathcal F}S(X;c)",
      formula_source: "Equation (2), PDF p. 2"
    },
    notation
  }, { pages: [{
    page: 2,
    text: "2. Allocation Model\nThe planner selects a feasible allocation rule to maximize expected surplus for participating firms.\nEquation (2) states the planner's objective."
  }] }, ADDITIONAL_CONCEPTS);

  const objective = note.models[0].components.find((component) => component.id === "objective-and-constraints");
  assert.ok(objective);
  assert.deepEqual(
    objective.symbols.map((entry) => entry.symbol),
    [
      "S(X;c)",
      "\\pi_n(w_n)",
      "\\Pi_n(w_n)",
      "w_ij",
      "p_hat",
      "\\theta_tilde",
      "V_bar",
      "y:X→Y, ≽_y",
      "Y_i(t)∈{0, 1, ∅}",
      "\\psi* in {\\psi_1, ..., \\psi_N}",
      "In, Out",
      "calligraphic F",
      "q_i=r_i+\\nu_i",
      "D(p), \\alpha"
    ]
  );
  assert.ok(objective.symbols.length > 6, "reviewed notation is not truncated to the local extraction cap");
  assert.ok(objective.symbols.every((entry) => entry.sourceKind === "reviewed-catalog"));
  assert.equal(objective.symbols.some((entry) => entry.symbol.includes("�")), false);
});

test("reviewed formulas use mathematical validation and documented page/range anchors", () => {
  const reviewedFormula = "\\pi_a(\\theta,p)=\\theta\\left(1-\\frac{h}{[1-\\rho(1-B(p))]^2}\\right)-p";
  const note = buildAuthoredNote({
    id: "synthetic-reviewed-formula-anchor",
    title: "Priority Auctions",
    business_question: "How should a creator bid for priority?",
    model_topic: "Priority-payment auction",
    primary_topic: "auction design",
    detail_level: "model_map",
    players: ["a creator"],
    actions: ["the creator chooses a priority payment"],
    objective: {
      summary: "The creator chooses a priority payment to maximize expected viewership value net of the payment.",
      formula: reviewedFormula,
      formula_source: "Equations (13)-(16), PDF page 4"
    },
    notation: [{ symbol: "\\pi_a(\\theta,p)", meaning: "creator payoff for type theta and payment p" }]
  }, { pages: [{
    page: 4,
    text: "4. Auction Model\nThe creator chooses a priority payment to maximize expected viewership value net of the payment.\nEquations (13)-(16) characterize the creator's expected payoff."
  }] }, ADDITIONAL_CONCEPTS);

  const objective = note.models[0].components.find((component) => component.id === "objective-and-constraints");
  assert.ok(objective);
  assert.equal(objective.formal, reviewedFormula);
  assert.equal(objective.sources[0].page, 4);
  assert.equal(objective.sources[0].equation, "(13)–(16)");
});

test("paper-organization comparisons are not clipped into model conditions", () => {
  const note = buildAuthoredNote({
    id: "synthetic-condition-filter",
    title: "Platform Wage Design",
    business_question: "How should a platform set wages under demand uncertainty?",
    model_topic: "Platform wage setting under demand uncertainty",
    primary_topic: "platform pricing",
    detail_level: "literature"
  }, { pages: [{
    page: 2,
    text: [
      "2. Model",
      "The platform sets a wage before uncertain applicant demand is observed in the matching market.",
      "In contrast to the remainder of the paper, we assume that employer and applicant welfare are quasilinear in the wage.",
      "We assume applicant demand is independently distributed across periods.",
      "This implies that the platform earns more profit under the policy.",
      "We further observe that equilibrium profit increases as applicant demand grows.",
      "According to Proposition 2, the optimal wage decreases in demand volatility.",
      "Our results in Section 4 apply equally when applicant demand is random.",
      "Therefore, equilibrium welfare is higher under the policy.",
      "The objective maximizes matching welfare subject to the platform's feasibility constraint."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const conditions = note.models.flatMap((model) => model.components.flatMap((component) => component.conditions));
  assert.ok(conditions.some((condition) => /demand is independently distributed across periods/i.test(condition)));
  assert.equal(conditions.some((condition) => /remainder of the paper/i.test(condition)), false);
  assert.equal(conditions.some((condition) => /earns more profit under the policy/i.test(condition)), false);
  assert.equal(conditions.some((condition) => /we further observe|according to proposition|our results in section|therefore, equilibrium welfare/i.test(condition)), false);
});

test("display-math splices cannot become model conditions", () => {
  const note = buildAuthoredNote({
    id: "synthetic-condition-equation-splice",
    title: "Targeting Under Competition",
    business_question: "How should a firm target consumers under competition?",
    model_topic: "Competitive targeting",
    primary_topic: "targeting",
    detail_level: "literature"
  }, { pages: [{
    page: 3,
    text: [
      "3. Monopoly Benchmark",
      "Suppose consumer demand is independently distributed and symmetric around zero.",
      "The firm chooses a targeting policy for independently distributed consumer demand.",
      "Suppose the firm targets consumers, which implies that",
      "max{0, theta + phi - 1} <= k <= min{theta, phi}:",
      "Given alpha(lambda) and beta(lambda), we have the estimated profit from beta(lambda)x.",
      "We assume that $lambda$ is nonnegative for every firm.",
      "We assume the agent has limited liability—that is, the"
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const conditions = note.models.flatMap((model) => model.components.flatMap((component) => component.conditions));
  assert.ok(conditions.some((condition) => /demand is independently distributed and symmetric around zero/i.test(condition)));
  assert.equal(conditions.some((condition) => /implies that Given|estimated profit from beta/i.test(condition)), false);
  assert.equal(conditions.some((condition) => /\$lambda\$/i.test(condition)), false);
  assert.equal(conditions.some((condition) => /limited liability—that is, the/i.test(condition)), false);
});

test("lowercase page and column continuations cannot become model conditions", () => {
  const note = buildAuthoredNote({
    id: "synthetic-condition-column-splice",
    title: "Coalition Formation",
    business_question: "How should agents form risk-sharing coalitions?",
    model_topic: "Risk-sharing coalition formation",
    primary_topic: "coalition formation",
    detail_level: "literature"
  }, { pages: [{
    page: 2,
    text: [
      "2. Coalition Model",
      "out loss of generality, we assume the classes are ranked in descending order of potential success.",
      "cess probabilities but also in their earnings conditional on whether they succeed or fail.",
      "there is a small probability of large profits and a large in all treatments, provided that all agreements are secured.",
      "We assume each agent observes its own class before choosing a coalition."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const conditions = note.models.flatMap((model) => model.components.flatMap((component) => component.conditions));
  assert.ok(conditions.some((condition) => /each agent observes its own class/i.test(condition)));
  assert.equal(conditions.some((condition) => /out loss|cess probabilities|a large in all treatments/i.test(condition)), false);
});

test("automated components retain a clean local equation but reject dangling equation fragments", () => {
  const note = buildAuthoredNote({
    id: "synthetic-source-equation",
    title: "Capacity-Constrained Inventory",
    business_question: "How should a retailer choose inventory under uncertain demand?",
    model_topic: "Capacity-constrained inventory under uncertain demand",
    primary_topic: "inventory control",
    detail_level: "literature"
  }, { pages: [{
    page: 2,
    text: [
      "2. Inventory Model",
      "The retailer chooses an order quantity before uncertain demand is observed.",
      "Let q be the retailer order quantity selected before demand.",
      "≥ γ E[d] Constraints (2)",
      "q* = min{K, F^{-1}(c)} (3),",
      "The order quantity is capped by available capacity."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const component = note.models[0].components[0];
  assert.equal(component.formalKind, "Source-extracted equation (not visually verified)");
  assert.equal(component.formal, "q* = min{K, F^{-1}(c)} (3)");
  assert.equal(component.sources[0].equation, "(3)");
  assert.doesNotMatch(component.formal, /Constraints/i);
});

test("a trailing conditional branch is not published as a complete source equation", () => {
  for (const branch of ["if t <= t2,", "if t ≤ t2,"]) {
    const note = buildAuthoredNote({
      id: "synthetic-trailing-equation-branch",
      title: "Time-Dependent Diffusion",
      business_question: "How does diffusion change across time regimes?",
      model_topic: "Time-dependent diffusion control",
      primary_topic: "dynamic control",
      detail_level: "literature"
    }, { pages: [{
      page: 2,
      text: `2. Diffusion Model\nThe controller selects the intervention time before the diffusion path is realized.\n${branch}\nThe state then evolves according to the selected regime.`
    }] }, ADDITIONAL_CONCEPTS);

    assert.ok(note.models[0].components.every((component) => component.formalKind !== "Source-extracted equation (not visually verified)"));
    const component = note.models[0].components[0];
    assert.equal(component.explanation.includes(branch), false);
    assert.equal(component.formal.includes(branch), false);
    assert.equal(component.sources[0].quote.includes(branch), false);
    assert.match(component.sources[0].quote, /controller selects the intervention time|state then evolves/i);
  }
});

test("a named-Greek argmax remains formal while its display line is excluded from prose evidence", () => {
  const formula = "lambda_j^* = argmax_{x in [0,1]} p_j(lambda_j) (3)";
  const note = buildAuthoredNote({
    id: "synthetic-named-greek-equation",
    title: "Interval Allocation",
    business_question: "How should a planner choose allocation under capacity?",
    model_topic: "Capacity allocation",
    primary_topic: "allocation",
    detail_level: "literature"
  }, { pages: [{
    page: 2,
    text: [
      "2. Allocation Model",
      "The planner chooses an allocation before uncertain demand is realized.",
      "Let lambda_j be the allocation selected by the planner.",
      formula,
      "The allocation maximizes expected reward subject to capacity."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const component = note.models[0].components[0];
  assert.equal(component.formalKind, "Source-extracted equation (not visually verified)");
  assert.equal(component.formal, "\\lambda_j^* = argmax_{x in [0,1]} p_j(\\lambda_j) (3)");
  assert.equal(component.sources[0].equation, "(3)");
  assert.doesNotMatch(component.explanation, /lambda_j|argmax/);
  assert.doesNotMatch(component.sources[0].quote, /lambda_j|argmax/);
  assert.match(component.sources[0].quote, /planner chooses an allocation|allocation maximizes expected reward/i);
});

test("named-Greek variants remain equations without leaking their display line into prose", () => {
  const formula = "vartheta_j = alpha_j + beta_j (3),";
  const note = buildAuthoredNote({
    id: "synthetic-named-greek-variant",
    title: "Targeting Model",
    business_question: "How should the firm choose targeting?",
    model_topic: "Targeting choice",
    primary_topic: "targeting",
    abstract: "The firm chooses targeting to maximize expected profit.",
    notation: [{ symbol: "vartheta_j", meaning: "Targeting score assigned to consumer j" }],
    detail_level: "literature"
  }, { pages: [{
    page: 2,
    text: [
      "2. Targeting Model",
      "The targeting decision uses the rule",
      formula,
      "The firm chooses the targeting threshold used for eligible consumers."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const component = note.models[0].components[0];
  assert.equal(component.formalKind, "Source-extracted equation (not visually verified)");
  assert.equal(component.formal, "\\vartheta_j = \\alpha_j + \\beta_j (3)");
  assert.doesNotMatch(component.explanation, /vartheta_j|alpha_j|beta_j/);
  assert.doesNotMatch(component.sources[0].quote, /vartheta_j|alpha_j|beta_j/);
  assert.match(component.sources[0].quote, /chooses the targeting threshold/i);
});

test("operator, constraint, and Unicode-relation display rows cannot enter prose evidence", () => {
  const note = buildAuthoredNote({
    id: "synthetic-multiline-program",
    title: "Capacity Choice",
    business_question: "How should a planner choose capacity?",
    model_topic: "Capacity optimization",
    primary_topic: "optimization",
    abstract: "The planner chooses capacity to maximize expected reward under a budget.",
    detail_level: "literature"
  }, { pages: [{
    page: 2,
    text: [
      "2. Capacity Model",
      "The optimization problem is",
      "max_q R(q)",
      "subject to c(q) <= B.",
      "x_t ≡ f(x_{t-1},a_t).",
      "The planner chooses capacity subject to its budget constraint."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const component = note.models[0].components[0];
  assert.doesNotMatch(component.explanation, /max_q|c\(q\)|x_t|f\(x_/);
  assert.doesNotMatch(component.formal, /max_q|c\(q\)|x_t|f\(x_/);
  assert.doesNotMatch(component.sources[0].quote, /max_q|c\(q\)|x_t|f\(x_/);
  assert.match(component.sources[0].quote, /chooses capacity subject to its budget constraint/i);
});

test("source equation fragments are rejected before authoring a formal or prose quote", () => {
  const fragments = [
    "where δ ≥ 0.",
    "where σ ≤ 0 and",
    "where HkT =∑T",
    "where ì = 1",
    "{}, or (iii) c ≥ coi. Otherwise",
    "where q ∈{ 1=n, n ∈ N}.",
    "where i n v(F)(x)¢i n f{y: F(y) ≥ x} for all x ∈ R. Let U (S)",
    "in the set, i.e., pa = epa/fpA.",
    "in x. For x ≤ x",
    "x ̃xd ̃x =v−",
    "min Ef [h(X, Y)] = E0[h(X, Y)] −",
    "p∗(Λ1)≥ R −",
    "θ,σ(T) = θ∗ · T −"
  ];
  for (const fragment of fragments) {
    const note = buildAuthoredNote({
      id: `synthetic-fragment-${fragments.indexOf(fragment)}`,
      title: "Time-Dependent Targeting",
      business_question: "How should a firm choose targeting over time?",
      model_topic: "Time-dependent targeting control",
      primary_topic: "dynamic control",
      abstract: "The firm chooses a targeting action before uncertain demand is known.",
      detail_level: "literature"
    }, { pages: [{
      page: 2,
      text: [
        "2. Targeting Model",
        "The firm chooses a targeting action before uncertain demand is known.",
        fragment,
        "The targeting state then evolves under the selected action."
      ].join("\n")
    }] }, ADDITIONAL_CONCEPTS);

    const authored = note.models.flatMap((model) => model.components);
    assert.ok(authored.length > 0, fragment);
    assert.ok(authored.every((component) => component.formalKind !== "Source-extracted equation (not visually verified)"), fragment);
    assert.equal(JSON.stringify(authored).includes(fragment), false, fragment);
  }
});

test("adjacent parameter cells are not presented as one source equation", () => {
  const note = buildAuthoredNote({
    id: "synthetic-equation-table-row",
    title: "Effort and Salvage Value",
    business_question: "How does salvage value affect effort incentives?",
    model_topic: "Effort incentives under salvage value",
    primary_topic: "contract design",
    detail_level: "literature"
  }, { pages: [{
    page: 4,
    text: [
      "4. Salvage Value",
      "The client chooses a payment structure as salvage value changes.",
      "S = 0 S/k = 2",
      "A larger salvage value increases the client's net project value."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const component = note.models[0].components[0];
  assert.notEqual(component.formalKind, "Source-extracted equation (not visually verified)");
  assert.doesNotMatch(component.formal, /S\s*=\s*0\s+S\/k\s*=\s*2/);
});

test("a source line ending in a bare right-hand symbol is treated as a clipped equation", () => {
  const note = buildAuthoredNote({
    id: "synthetic-clipped-equation",
    title: "Permutation-Invariant Demand",
    business_question: "How is permutation-invariant demand estimated?",
    model_topic: "Permutation-invariant demand estimation",
    primary_topic: "demand estimation",
    detail_level: "literature"
  }, { pages: [{
    page: 3,
    text: "3. Demand Formulation\nThe estimator maps observed prices and product characteristics to demand.\nπijt = g\nThe full mapping continues on the following extracted lines."
  }] }, ADDITIONAL_CONCEPTS);
  assert.notEqual(note.models[0].components[0].formalKind, "Source-extracted equation (not visually verified)");
});

test("a slash-prefixed membership glyph is not published as a source equation", () => {
  const note = buildAuthoredNote({
    id: "synthetic-slash-membership-equation",
    title: "Static Demand Estimation",
    business_question: "How is static demand estimated from observed choices?",
    model_topic: "Static demand estimation from observed choices",
    primary_topic: "demand estimation",
    detail_level: "literature"
  }, { pages: [{
    page: 3,
    text: "3. Static Demand Model\nThe estimator maps observed choices and prices into fitted demand.\nl := {yt, zt}t /∈ l\nThe fitted demand model is evaluated on held-out observations."
  }] }, ADDITIONAL_CONCEPTS);
  assert.ok(note.models[0].components.every((component) => component.formalKind !== "Source-extracted equation (not visually verified)"));
});

test("component authoring prefers paper-owned definitions over literature and theorem scaffolding", () => {
  const note = buildAuthoredNote({
    id: "synthetic-owned-model-prose",
    title: "Charging Cost and Service",
    business_question: "How should a station choose its charging rate?",
    model_topic: "Charging-rate optimization under service constraints",
    primary_topic: "service operations",
    abstract: "Problem definition: The station chooses a charging rate to minimize operating cost while satisfying service constraints.",
    detail_level: "literature",
    assumptions: [
      "Electricity and degradation costs apply to each charging decision.",
      "Every battery state permits a finite set of charging rates.",
      "The client and vendor are risk neutral under the payment contract.",
      "Cumulative production experience reduces the vendor's effort cost."
    ],
    notation: [
      { symbol: "q", meaning: "charging rate" },
      { symbol: "mt", meaning: "or education levels, and Fd is the demand distribution" }
    ]
  }, { pages: [{
    page: 2,
    text: [
      "2. Model",
      "The station chooses a charging rate q while tracking the battery state mt under uncertain arrivals.",
      "2.1 System Cost",
      "The literature indicates that battery replacement is expensive for charging stations.",
      "The model minimizes electricity and degradation cost subject to its service constraint.",
      "2.2 Discrete Charging Rate",
      "Theorem 2 shows that the objective is bounded under regularity conditions.",
      "The discrete formulation chooses one feasible charging rate in each battery state.",
      "2.3 Client's Net Value",
      "The client's objective maximizes expected project value net of the vendor payment, implementation expense, and induced effort cost.",
      "2.4 Self-Learning of Vendor",
      "The vendor's unit effort cost declines as cumulative production experience increases across repeatedly completed client projects."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);

  const components = note.models.flatMap((model) => model.components);
  const byLabel = (pattern) => components.find((component) => pattern.test(component.label));
  assert.match(byLabel(/System Cost/i).sources[0].quote, /^The model minimizes/i);
  assert.match(byLabel(/Discrete Charging Rate/i).sources[0].quote, /^The discrete formulation/i);
  assert.equal(byLabel(/Client's Net Value/i).role, "objective");
  assert.equal(byLabel(/Self-Learning of Vendor/i).role, "process");
  assert.equal(components.some((component) => component.symbols.some((entry) => entry.symbol === "mt")), false);
  assert.doesNotMatch(note.overview, /^Problem definition:/i);
  assert.ok(note.models.every((model) => !/^Problem definition:/i.test(model.summary)));
});

test("component authoring ranks definitions and optimizing decisions above downstream consequences", () => {
  const note = buildAuthoredNote({
    id: "synthetic-component-ranking",
    title: "Collaborative Effort Contract",
    business_question: "How should a client design a collaborative effort contract?",
    model_topic: "Collaborative effort contract design",
    primary_topic: "contract design",
    abstract: "The client chooses payment terms to maximize value while a vendor learns to reduce effort costs.",
    detail_level: "literature",
    assumptions: [
      "The client faces a fixed collaboration budget.",
      "The cost multiplier c is exogenously given.",
      "The payment terms are feasible for both the client and the vendor.",
      "Participation cost decreases with cumulative vendor experience."
    ]
  }, { pages: [{
    page: 4,
    text: [
      "2. Model Formulation",
      "The client's objective is to choose a payment structure that maximizes project value net of collaboration costs.",
      "The model allocates collaborative effort subject to the client's budget constraint.",
      "2.1 Input Parameters",
      "Here, c is the cost multiplier in the contract model for the client's effort.",
      "In such a case, the client can use a payment structure based on effort while the vendor responds to the contractual incentives.",
      "2.2 Optimal Payment Terms",
      "Therefore, first and second order conditions reveal the optimal payment terms presented in Lemma 2.",
      "By setting the payment terms to the stated levels, the client maximizes total system value and her utility.",
      "2.3 Self-Learning of Vendor",
      "The vendor's participation cost decreases with time due to self-learning.",
      "Hence, the parties can generate more output at lower cost."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);
  const components = note.models.flatMap((model) => model.components);
  const byLabel = (label) => components.find((component) => component.label === label);
  assert.match(byLabel("Model Formulation").sources[0].quote, /objective.+maximizes/i);
  assert.match(byLabel("Input Parameters").sources[0].quote, /^Here, c is the cost multiplier/i);
  assert.match(byLabel("Optimal Payment Terms").sources[0].quote, /^By setting the payment terms/i);
  assert.match(byLabel("Self-Learning of Vendor").sources[0].quote, /participation cost decreases.+self-learning/i);
});

test("component source sentences reject prose that only points to a display", () => {
  assert.equal(componentSourceSentence(
    "Figure 1 shows the battery dynamics under the selected charging policy.",
    "process"
  ), false);
  assert.equal(componentSourceSentence(
    "The state-transition equations are given by Equations (1) and (4).",
    "process"
  ), false);
  assert.equal(componentSourceSentence(
    "The proof of Theorem 1 exploits structural properties of the optimal value function.",
    "process"
  ), false);
  assert.equal(componentSourceSentence(
    "The battery state evolves according to the selected charging policy.",
    "process"
  ), true);
  assert.equal(componentSourceSentence(
    "For each condition, k = 3, so there are six population-level parameters. proposed methods approximate L(y).",
    "estimation"
  ), false);
  assert.equal(componentSourceSentence(
    "35: end while 36: end for 37: return theta1 and theta2.",
    "algorithm"
  ), false);
  assert.equal(componentSourceSentence(
    "For all sets S, the extracted row states $q$ before the capacity comparison.",
    "constraint"
  ), false);
  assert.equal(componentSourceSentence(
    "of the service if he accepts the offer.",
    "decision"
  ), false);
  assert.equal(componentSourceSentence(
    "We use a linear demand model; that is, if platform i charges price pi",
    "interaction"
  ), false);
  assert.equal(componentSourceSentence(
    "We use a linear demand model; that is",
    "interaction"
  ), false);
  assert.equal(componentSourceSentence(
    "We use the standard linear model of competition (e.g., Choi 1991)",
    "interaction"
  ), false);
});

test("component source sentences reject ordinal section-roadmap prose before source anchoring", () => {
  assert.equal(componentSourceSentence(
    "First, in Section 6.1 , we derive the reward approximation error between the hierarchical reformulation and the frozen-state approximation.",
    "algorithm"
  ), false);
  assert.equal(componentSourceSentence(
    "The frozen-state approximation replaces the slow-state transition with its fixed short-horizon value.",
    "algorithm"
  ), true);
  assert.equal(componentSourceSentence(
    "CRM literature (e.g., prior studies), contagion effects were typically ignored.",
    "process"
  ), false);
  assert.equal(componentSourceSentence(
    "We obtain our next two corollaries by comparing equilibrium qualities across the benchmark and platform-entry cases.",
    "interaction"
  ), false);
  assert.equal(componentSourceSentence(
    "We treat in some detail this special case, for a reason that will become apparent in the next section.",
    "process"
  ), false);
});

test("source fallback cannot borrow an adjacent section quote from the same page", () => {
  const localQuote = "Each service day incurs a fixed administrative fee before operations begin.";
  const adjacentQuote = "The charging policy updates the battery state using the chosen charging rate.";
  const pageText = [
    "2. System Cost",
    localQuote,
    "2.1 Charging Dynamics",
    adjacentQuote
  ].join("\n");
  const section = {
    number: "2",
    title: "System Cost",
    page: 2,
    endPage: 2,
    text: localQuote,
    lines: [{ page: 2, text: localQuote }]
  };

  const source = sourceFor(
    [{ page: 2, text: pageText }],
    section,
    "charging policy battery state chosen charging rate",
    "",
    { componentRole: "process" }
  );

  assert.equal(source, null);
});

test("full authoring retains four literal charging-rate formulations", () => {
  const localPages = [
    {
      page: 5,
      text: [
        "3. Problem Formulation",
        "The battery-swapping station chooses charging and loading decisions for every battery bay and period while satisfying service constraints under uncertain swapping demand.",
      ].join("\n"),
    },
    {
      page: 7,
      text: [
        "3.4. A Stochastic Dynamic-Programming Model",
        "The stochastic dynamic program selects a continuous charging rate for every battery bay to minimize expected energy, degradation, and unmet-service costs under uncertain swapping demand.",
      ].join("\n"),
    },
    {
      page: 8,
      text: [
        "3.5. Discrete Charging Rate",
        "By imposing an additional constraint on the charging rates, the dynamic program can be reformulated to capture a discrete-rate charging problem that selects one admissible speed for every battery and period.",
      ].join("\n"),
    },
    {
      page: 9,
      text: [
        "4.1. Static Optimization Under Demand Forecast",
        "The nominal static formulation replaces stochastic demand with its forecast and chooses loading and charging decisions over the entire planning horizon under inventory constraints.",
      ].join("\n"),
    },
    {
      page: 10,
      text: [
        "4.2. The Static RS Model",
        "The robust-satisficing formulation chooses loading and charging decisions that meet a worst-case demand target under a fixed total operating-cost budget and inventory constraints.",
      ].join("\n"),
    },
  ];
  const note = buildAuthoredNote({
    id: "synthetic-charging-formulations",
    title: "Balancing Cost and Service: Charging-Rate Optimization",
    business_question: "How should a battery-swapping station choose charging rates under uncertain demand?",
    model_topic: "Battery-swapping charging-rate control under demand uncertainty",
    primary_topic: "operations and supply chains",
    abstract: "The paper formulates charging-rate optimization models for a battery-swapping station under uncertain demand.",
    detail_level: "literature",
  }, { pages: localPages }, ADDITIONAL_CONCEPTS);

  assert.deepEqual(note.models.map((model) => model.name), [
    "A Stochastic Dynamic-Programming Model",
    "Discrete Charging Rate",
    "Static Optimization Under Demand Forecast",
    "The Static RS Model",
  ]);
  assert.ok(note.models.every((model) => model.components.length > 0));
  assert.deepEqual(note.models.slice(1).map((model) => model.components[0].sources[0].page), [8, 9, 10]);
  assert.match(note.models[1].components[0].sources[0].quote, /^By imposing an additional constraint/);
  assert.match(note.models[2].components[0].sources[0].quote, /^The nominal static formulation/);
  assert.match(note.models[3].components[0].sources[0].quote, /^The robust-satisficing formulation/);
});

test("symbol definitions retain the source-local variable in canonical indexed notation", () => {
  const note = buildAuthoredNote({
    id: "synthetic-symbol-boundary",
    title: "Demand Estimation",
    business_question: "How is product demand estimated?",
    model_topic: "Demand estimation from observed product characteristics",
    primary_topic: "demand estimation",
    detail_level: "literature"
  }, { pages: [{
    page: 3,
    text: [
      "3. Demand Model",
      "Here, pjt ∈ C denotes the observed prices, Xjt ∈ Cd represents other product characteristics, and yjt ∈ R refers to observed demand.",
      "The error εijt represents an independently distributed demand shock for consumer i and product j.",
      "The researchers estimate the demand function from prices and characteristics."
    ].join("\n")
  }] }, ADDITIONAL_CONCEPTS);
  const symbols = note.models[0].components[0].symbols;
  assert.deepEqual(symbols, [{
    symbol: "\\varepsilon_{ijt}",
    meaning: "an independently distributed demand shock for consumer i and product j"
  }]);
  assert.equal(symbols.some((entry) => entry.symbol === "ijt"), false);
  assert.equal(note.models[0].components[0].formal.includes("\\varepsilon_{ijt}"), true);
});

test("domain words alone do not misclassify Beer Game learning or an arrival waitlist as game theory and queueing", () => {
  const beer = buildAuthoredNote({
    id: "synthetic-beer-game",
    title: "Deep Reinforcement Learning for the Beer Game",
    business_question: "How should inventory actions be learned under delayed demand?",
    model_topic: "Inventory control with deep reinforcement learning",
    primary_topic: "inventory control",
    abstract: "The paper trains a reinforcement-learning policy to choose inventory orders under delayed demand.",
    detail_level: "literature"
  }, { pages: [{ page: 2, text: "2. Inventory Model\nThe policy chooses an inventory order after observing current stock and delayed demand." }] }, ADDITIONAL_CONCEPTS);
  assert.equal(beer.modelTypes.includes("Game theory"), false);

  const waitlist = buildAuthoredNote({
    id: "synthetic-arrival-waitlist",
    title: "Rolling Recruitment with an Applicant Waitlist",
    business_question: "How should applicants be admitted when arrival times are uncertain?",
    model_topic: "Recruitment decisions under applicant arrivals",
    primary_topic: "recruitment",
    abstract: "Applicants arrive over time and the planner selects admission offers under uncertain departures.",
    detail_level: "literature"
  }, { pages: [{ page: 2, text: "2. Recruitment Model\nThe planner chooses admission offers as applicants arrive and depart over time." }] }, ADDITIONAL_CONCEPTS);
  assert.equal(waitlist.modelTypes.includes("Queueing"), false);
});
