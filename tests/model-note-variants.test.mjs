import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_VARIANT_RELATIONSHIPS,
  MAX_MODEL_VARIANTS,
  planModelVariants
} from "../scripts/model-note-variants.mjs";

function section(title, page, text = "") {
  return { title, page, endPage: page, text };
}

test("generic architectural facets remain one baseline model", () => {
  const record = {
    id: "facets-only",
    title: "A Layered Marketplace Model",
    model_topic: "Marketplace participation and platform decisions",
    game_architecture: [
      "Players",
      "Process layer",
      "Meta-game layer",
      "Information structure",
      "Sequential / Stackelberg game",
      "Mechanism / contract / auction"
    ],
    architecture_detail: [
      "The player layer supplies actions to the process layer.",
      "The meta-game describes the same model's timing."
    ]
  };
  const result = planModelVariants(record, [
    section("2. Model Setting", 4, "The platform and sellers act sequentially."),
    section("2.1 Players", 4, "The platform and sellers are the players."),
    section("2.2 Timing and Information", 5, "The platform moves first."),
    section("2.3 Objective", 6, "The platform maximizes profit.")
  ]);
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].kind, "baseline");
  assert.deepEqual(result.variants[0].relationships, []);
  assert.deepEqual(result.diagnostics.ignoredArchitectureFacets, record.game_architecture);
});

test("an interrogative decision title yields a clean baseline model name", () => {
  const result = planModelVariants({
    id: "geoconquesting",
    title: "Should an Ad Agency Offer Geoconquesting or Protection from It?",
    model_topic: "This study examines the interaction between advertising channels.",
    game_architecture: [],
    architecture_detail: []
  }, [section("Model Setup", 4, "The agency chooses whether to offer geoconquesting or protection.")]);
  assert.equal(result.variants[0].name, "Geoconquesting or Protection from it baseline model");
});

test("environment, demand, supply, and primitive subsections remain components of one model", () => {
  const result = planModelVariants({
    id: "structural-market-blocks",
    title: "A Structural Ride-Hailing Model",
    model_topic: "Dynamic spatial matching equilibrium",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model Environment: Space and Time", 6, "The city is divided into locations and time periods."), number: "4.1" },
    { ...section("Demand Model", 7, "The demand model characterizes riders who choose among transportation modes."), number: "4.2" },
    { ...section("Supply Model", 8, "Our structural model contains driver acceptance and relocation decisions."), number: "4.3" },
    { ...section("Matching Technologies", 12, "The platform matches riders and available drivers."), number: "4.4" },
    { ...section("Equilibrium", 13, "A fixed point makes beliefs and market outcomes consistent."), number: "4.5" },
    { ...section("Model Primitives", 15, "The primitives specify common costs and arrival rates."), number: "4.6" }
  ]);

  assert.equal(result.variants.length, 1);
  assert.equal(result.diagnostics.explicitCandidateCount, 0);
});

test("a short OCR heading is not promoted by an incidental model sentence", () => {
  const result = planModelVariants({
    id: "short-ocr-heading",
    title: "Innovation Competition",
    model_topic: "Project development competition",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Baseline Model", 4, "The baseline model specifies the two projects and their development choices."),
    section("KI", 18, "We consider a model in which incremental consumer welfare is the same in both cases.")
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Baseline Model"]);
});

test("an explicit benchmark and A-Learning/O-Learning regimes become three genuine variants", () => {
  const record = {
    id: "voice-customization",
    title: "The Voice of Customers in Customization",
    model_topic: "Customer preference revelation before bargaining",
    game_architecture: [
      "Cheap-talk customization game",
      "Action-signaling customization game",
      "Bilateral bargaining game",
      "Nonlinear-screening benchmark"
    ],
    architecture_detail: [
      "A-Learning gives the seller design rights after a customer message.",
      "O-Learning delegates design initiation to the buyer."
    ],
    timing: "The paper compares a screening benchmark. Under A-Learning the buyer sends a message. Under O-Learning the buyer requests quality."
  };
  const result = planModelVariants(record, [
    section("2. Screening Benchmark", 6, "The seller offers a screening menu."),
    section("3. Customization Under A-Learning", 9, "A-Learning uses a cheap-talk message."),
    section("4. Customization Under O-Learning", 13, "O-Learning uses action signaling."),
    section("5. Bilateral Bargaining", 16, "All customization regimes use the bargaining stage.")
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Screening Benchmark",
    "A-Learning regime",
    "O-Learning regime"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative", "alternative"]);
  assert.deepEqual(result.variants.slice(1).map((variant) => variant.relationships[0].type), ["alternativeTo", "alternativeTo"]);
  assert.deepEqual(result.variants.map((variant) => variant.sections[0].page), [6, 9, 13]);
  assert.ok(result.diagnostics.ignoredArchitectureFacets.includes("Bilateral bargaining game"));
});

test("paired with/without regimes and an extension receive allowed relationships", () => {
  const result = planModelVariants({
    id: "sharing-regimes",
    title: "Data Sharing",
    model_topic: "Firms choose whether to share data",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Model Without Data Sharing", 3, "Firms retain their own data."),
    section("3. Model With Data Sharing", 7, "Firms pool data before investing."),
    section("5. Extension: Partial Sharing", 14, "The extension permits partial sharing.")
  ]);
  assert.equal(result.variants.length, 3);
  assert.match(result.variants[0].name, /Without Data Sharing/i);
  assert.equal(result.variants[0].kind, "baseline");
  assert.equal(result.variants[1].relationships[0].type, "alternativeTo");
  assert.equal(result.variants[2].relationships[0].type, "extends");
  const types = result.variants.flatMap((variant) => variant.relationships.map((relationship) => relationship.type));
  assert.ok(types.every((type) => ALLOWED_VARIANT_RELATIONSHIPS.includes(type)));
});

test("a named extension is added to, rather than substituted for, the baseline", () => {
  const result = planModelVariants({
    id: "extension-only",
    title: "Inventory Control",
    model_topic: "Finite-horizon inventory control",
    game_architecture: ["Dynamic / stochastic game"],
    architecture_detail: []
  }, [
    { ...section("2. Model Formulation", 4, "The baseline controls finite-horizon inventory."), number: "2" },
    { ...section("6. Extension to Multiple Products", 18, "The extension adds multiple products."), number: "6" }
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "extension"]);
  assert.equal(result.variants[1].relationships[0].type, "extends");
  assert.deepEqual(result.variants.map((variant) => variant.sections.map((item) => item.page)), [[4], [18]]);
});

test("an approximation is related with approximates and section ownership is unique", () => {
  const result = planModelVariants({
    id: "approximation",
    title: "Network Planning",
    model_topic: "Network capacity planning",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Baseline Model", 2, "The baseline model optimizes network capacity."),
    section("4. Approximation Model", 8, "The approximation model replaces the nonlinear constraint."),
    section("4.1 Approximation Guarantee", 9, "The approximation guarantee bounds performance.")
  ]);
  assert.equal(result.variants[1].relationships[0].type, "approximates");
  const assigned = result.variants.flatMap((variant) => variant.sections.map((item) => item.sectionIndex));
  assert.equal(new Set(assigned).size, assigned.length, "a section belongs to at most one variant");
});

test("variant selection is deterministic and never exceeds the cap", () => {
  const record = { id: "many", title: "Many Regimes", model_topic: "A common baseline", game_architecture: [], architecture_detail: [] };
  const sections = [
    section("Baseline Model", 2),
    section("Alternative Regime Alpha", 5),
    section("Alternative Regime Beta", 8),
    section("Extension Gamma", 11),
    section("Approximation Delta", 14),
    section("Alternative Regime Epsilon", 17)
  ];
  const first = planModelVariants(record, sections);
  const second = planModelVariants(record, sections);
  assert.deepEqual(first, second);
  assert.equal(first.variants.length, MAX_MODEL_VARIANTS);
  assert.equal(first.diagnostics.capped, true);
  assert.equal(first.variants.filter((variant) => variant.kind === "baseline").length, 1);
});

test("developer-player, version, and tournament layers do not become false variants", () => {
  const result = planModelVariants({
    id: "pvp",
    title: "Player-vs.-Player Game Design and Pricing",
    model_topic: "PvP tournament balance, versioning, and freemium pricing",
    game_architecture: [
      "Two-stage developer-player game",
      "Version-choice game with network effects",
      "Endogenous tournament design"
    ],
    architecture_detail: [
      "The developer commits to design variables before players choose versions.",
      "Random matching makes demand composition enter utility."
    ]
  }, [
    section("3. Model", 5, "The developer chooses tournament design and players choose versions."),
    section("3.1 Developer Decisions", 5),
    section("3.2 Player Version Choice", 7),
    section("3.3 Tournament Equilibrium", 9)
  ]);
  assert.equal(result.variants.length, 1);
  assert.equal(result.diagnostics.explicitCandidateCount, 0);
});

test("an explicitly named counterfactual is retained while adjacent facets are ignored", () => {
  const result = planModelVariants({
    id: "platform-policy",
    title: "Platform Information Policy",
    model_topic: "Platform entry and information policy",
    game_architecture: [
      "Referral-fee commitment",
      "Platform learning or signal generation",
      "Regulatory ban counterfactuals"
    ],
    architecture_detail: []
  }, [
    section("2. Model", 4, "The platform selects a fee before seller entry."),
    section("7. Ban on Information Sharing", 16, "The regulatory ban prevents information sharing.")
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative"]);
  assert.equal(result.variants[1].name, "Regulatory ban counterfactuals");
  assert.deepEqual(result.variants[1].sections.map((item) => item.page), [16]);
  assert.deepEqual(result.diagnostics.ignoredArchitectureFacets, [
    "Referral-fee commitment",
    "Platform learning or signal generation"
  ]);
});

test("body-only mentions do not assign generic sections to a named variant", () => {
  const result = planModelVariants({
    id: "learning-regimes",
    title: "Customer Learning",
    model_topic: "Customer learning regimes",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("1. Introduction", 1, "We compare A-Learning and O-Learning throughout the paper."),
    section("2. Model", 4, "The common environment is introduced."),
    section("3. A-Learning Regime", 8, "A-Learning uses an informed message."),
    section("4. O-Learning Regime", 12, "O-Learning uses an observable action."),
    section("7. Conclusion", 20, "A-Learning and O-Learning have different implications.")
  ]);
  const assignedTitles = result.variants.flatMap((variant) => variant.sections.map((item) => item.title));
  assert.ok(!assignedTitles.includes("Introduction"));
  assert.ok(!assignedTitles.includes("Conclusion"));
  assert.ok(assignedTitles.includes("A-Learning Regime"));
  assert.ok(assignedTitles.includes("O-Learning Regime"));
});

test("table rows and generic analysis headings do not become mksc-style variants", () => {
  const result = planModelVariants({
    id: "mksc-permutation-demand",
    title: "Choice Models and Permutation Invariance",
    model_topic: "Permutation-invariant demand estimation",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("3. Choice Models and Permutation Invariance", 6, "In this section, we provide a general characterization of consumer choice functions."), number: "3.1" },
    section("Almost Ideal Demand System Deaton and Muellbauer (1980) No", 8, "Multinomial Probit with Flexible Error Structure Train (2009) No"),
    section("Latent Class Logit Model Kamakura and Russell (1989) Yes", 8, "Markov Chain Choice Model Blanchet et al. (2016) Yes"),
    section("3.2 Extensions to Individual-Level Data and Additional Covariates", 9, "This formulation maintains the same permutation-invariant structure while incorporating individual-specific features."),
    section("5.2 Counterfactual Analysis", 28, "The estimators are compared on predictive outcomes in simulated counterfactual data."),
    section("6. Extensions", 32, "Additional results and discussion appear in the web appendix.")
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Choice Models and Permutation Invariance",
    "Extensions to Individual-Level Data and Additional Covariates"
  ]);
  const assigned = result.variants.flatMap((variant) => variant.sections.map((item) => item.title));
  assert.ok(!assigned.some((title) => /\b(?:Yes|No)$/i.test(title)));
  assert.ok(!assigned.includes("Counterfactual Analysis"));
  assert.ok(!assigned.includes("Extensions"));
});

test("a generic extension requires explicit local model-specification evidence", () => {
  const rejected = planModelVariants({
    id: "generic-extension-results",
    title: "Inventory Policy",
    model_topic: "Inventory policy",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Model", 3, "The retailer selects inventory before demand."),
    section("6. Extensions", 14, "We discuss additional results and managerial implications.")
  ]);
  assert.equal(rejected.variants.length, 1);

  const retained = planModelVariants({
    id: "generic-extension-model",
    title: "Inventory Policy",
    model_topic: "Inventory policy",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Model", 3, "The retailer selects inventory before demand."),
    section("6. Extensions", 14, "We introduce an extended model that relaxes the baseline capacity constraint.")
  ]);
  assert.deepEqual(retained.variants.map((variant) => variant.kind), ["baseline", "extension"]);
});

test("repeated and dangling variant-name fragments are rejected", () => {
  const result = planModelVariants({
    id: "fragmented-variants",
    title: "Service Design",
    model_topic: "Service design",
    game_architecture: ["Extension Extension", "Alternative Model with"],
    architecture_detail: []
  }, [
    section("2. Baseline Model", 3, "The baseline model selects service capacity."),
    section("5. Extension Extension", 10, "The extension repeats an extraction fragment."),
    section("6. Alternative Model with", 12, "The alternative heading is truncated.")
  ]);
  assert.equal(result.variants.length, 1);
  assert.equal(result.diagnostics.explicitCandidateCount, 1);
});

test("a wrapped extension heading is completed from its source continuation, never emitted as a dangling auxiliary", () => {
  const result = planModelVariants({
    id: "offline-price-observability",
    title: "Consumer Showrooming",
    model_topic: "Showrooming under channel competition",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Baseline Model", 4, "The baseline model assumes consumers observe the offline price before visiting the store."),
    section(
      "5. Extension: When the Offline Price Is",
      15,
      "Not Observable Ex Ante In the previous discussion, we assume that consumers observe the offline price before they visit the physical retailer's store. In this section, we relax the baseline model's observability assumption."
    )
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Baseline Model",
    "Extension: When the Offline Price Is Not Observable Ex Ante"
  ]);
  assert.equal(result.variants.some((variant) => variant.name === "Extension: When the Offline Price Is"), false);
  assert.equal(result.variants[1].relationships[0].type, "extends");
});

test("an unrecoverable variant heading ending in an auxiliary is rejected", () => {
  const result = planModelVariants({
    id: "truncated-extension",
    title: "Retail Pricing",
    model_topic: "Retail pricing",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Baseline Model", 3, "The baseline model chooses the retail price."),
    section("5. Extension: When the Offline Price Is", 12, "In this section, the paper reports additional results.")
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Baseline Model"]);
});

test("one isolated regime cannot split an unanchored baseline whose matching source heading is unauthorable", () => {
  const result = planModelVariants({
    id: "invalid-baseline-heading",
    title: "Customization",
    model_topic: "Multiple Inputs and Impact Categories",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Multiple Inputs and Impact Categories", 2, "The manager chooses which supplier impacts to inspect before making a disclosure decision."),
    section("3. A-Learning Regime", 4, "A-Learning uses a message-contingent quality decision.")
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Customization baseline model"]);
  assert.equal(result.diagnostics.explicitCandidateCount, 1);
});

test("conditional fragments and generic main-model headings do not create duplicate variants", () => {
  const result = planModelVariants({
    id: "generic-heading-noise",
    title: "Provider Competition",
    model_topic: "Provider pricing and customer search",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. If", 3, "If demand is high, the provider changes its price."),
    section("3. The Model", 4, "The provider chooses a price before customers search."),
    section("4. Main Model", 5, "The main model studies provider competition."),
    section("7. Alternative Service Cost Structure", 14, "The alternative model changes the provider's service cost.")
  ]);
  assert.ok(result.variants.some((variant) => /Alternative Service Cost Structure/i.test(variant.name)));
  assert.equal(result.variants.some((variant) => /^(?:If|The Model|Main Model)$/i.test(variant.name)), false);
});

test("first-best and monitored-effort regimes become three explicit payment models", () => {
  const result = planModelVariants({
    id: "co-creation-contract",
    title: "Managing Co-Creation in Information Technology Projects",
    model_topic: "Dynamic client-vendor effort and payment design",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Problem Definition and the First Best Scenario", 4, "The first-best formulation chooses both parties' effort paths."),
    { ...section("2.3 Model Preliminaries", 6, "The model preliminaries define the common client and vendor timing."), number: "2.3" },
    section("3. Unverifiable Effort Levels", 7, "The client cannot verify effort and therefore offers an output-dependent payment."),
    section("4. Monitoring Vendor's Effort", 10, "Monitoring makes vendor effort verifiable and supports an effort-dependent payment."),
    section("5. Comparison of the Payment Structures", 16, "The two payment structures are compared under common primitives.")
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative", "alternative"]);
  assert.match(result.variants[0].name, /First Best/i);
  assert.match(result.variants[1].name, /Unverifiable Effort/i);
  assert.match(result.variants[2].name, /Monitoring Vendor/i);
  assert.deepEqual(result.variants.slice(1).map((variant) => variant.relationships[0].type), ["alternativeTo", "alternativeTo"]);
  assert.equal(result.variants.some((variant) => /Preliminaries/i.test(variant.name)), false);
});

test("an unmarked sibling after an extension returns to the foundational baseline", () => {
  const result = planModelVariants({
    id: "choice-extension-sibling",
    title: "Choice Models and Permutation Invariance",
    model_topic: "Choice and demand estimation",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Choice Models and Permutation Invariance", 6, "We characterize a permutation-invariant choice model."), number: "3.1" },
    { ...section("Extensions to Individual-Level Data", 9, "We extend the model to individual-level data."), number: "3.2" },
    { ...section("Endogenous Covariates", 10, "The baseline estimator permits an endogenous price covariate."), number: "3.3" }
  ]);
  const baseline = result.variants.find((variant) => variant.kind === "baseline");
  const extension = result.variants.find((variant) => variant.kind === "extension");
  assert.ok(baseline && extension);
  assert.ok(baseline.sections.some((entry) => entry.title === "Endogenous Covariates"));
  assert.equal(extension.sections.some((entry) => entry.title === "Endogenous Covariates"), false);
});

test("numbered subsections stay with their explicit regime when extracted columns are out of order", () => {
  const result = planModelVariants({
    id: "numbered-contract-regimes",
    title: "Contract Monitoring",
    model_topic: "Payment and effort regimes",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("First Best", 4, "The first-best model chooses both effort paths."), number: "2" },
    { ...section("Unverifiable Effort Levels", 7, "Effort cannot be verified without monitoring."), number: "3" },
    { ...section("Monitoring Vendor Effort", 10, "Monitoring makes vendor effort verifiable."), number: "4" },
    // PDF column order can place the 3.4 heading after the top-level 4 heading.
    { ...section("Self-Learning of Vendor", 10, "Vendor effort costs fall through learning."), number: "3.4" },
    { ...section("Optimal Monitored Payment", 12, "The monitored contract uses effort-dependent payment."), number: "4.1" }
  ]);

  const unverifiable = result.variants.find((variant) => /Unverifiable/i.test(variant.name));
  const monitored = result.variants.find((variant) => /Monitoring/i.test(variant.name));
  assert.deepEqual(unverifiable.sections.map((item) => item.title), ["Unverifiable Effort Levels", "Self-Learning of Vendor"]);
  assert.deepEqual(monitored.sections.map((item) => item.title), ["Monitoring Vendor Effort", "Optimal Monitored Payment"]);
  assert.equal(unverifiable.sections.find((item) => item.title === "Self-Learning of Vendor").reason, "numbered-descendant");
});

test("explicit DP, discrete-rate, nominal-static, and robust-static formulations remain four model families", () => {
  const result = planModelVariants({
    id: "charging-rate-families",
    title: "Balancing Cost and Service: Charging-Rate Optimization",
    model_topic: "Electric-vehicle battery-swapping charging control",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Battery-Charging Process", 5, "Charging decisions update each battery's state of charge."), number: "3.1" },
    { ...section("Problem Formulation", 5, "The common battery-swapping system and its horizon are defined."), number: "3" },
    { ...section("Dynamics of Battery Inventory", 6, "Inventory changes with swapping demand and charged batteries."), number: "3.2" },
    { ...section("System Cost", 6, "The common cost includes energy and battery degradation."), number: "3.3" },
    { ...section("Discrete Charging Rate", 8, "By imposing an additional rate constraint, the DP model can be reformulated to capture the discrete-rate charging problem."), number: "3.5" },
    { ...section("A Stochastic Dynamic-Programming Model", 7, "The stochastic dynamic-programming model optimizes a continuous charging rate."), number: "3.4" },
    { ...section("Solution Approach", 9, "The solution uses two static formulations in a rolling policy."), number: "4" },
    { ...section("Static Optimization Under Demand Forecast", 9, "We replace stochastic demand with its forecast and formulate a static deterministic optimization model."), number: "4.1" },
    { ...section("The Static RS Model", 10, "In this section, we construct the static RS model used in the resolving algorithm."), number: "4.2" },
    section("Total Demand", 11, "A table reports total demand for each static test case."),
    { ...section("Numerical Experiment", 12, "We validate all policies in numerical experiments."), number: "5" },
    { ...section("Experiment Setup", 12, "This section reports simulation parameters."), number: "5.1" }
  ], { maxVariants: 5 });

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "A Stochastic Dynamic-Programming Model",
    "Discrete Charging Rate",
    "Static Optimization Under Demand Forecast",
    "The Static RS Model"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative", "alternative", "alternative"]);
  assert.equal(result.diagnostics.capped, false);
  const baselineTitles = result.variants[0].sections.map((item) => item.title);
  assert.ok(baselineTitles.includes("Problem Formulation"));
  assert.ok(baselineTitles.includes("Battery-Charging Process"));
  const assignedTitles = result.variants.flatMap((variant) => variant.sections.map((item) => item.title));
  assert.ok(!assignedTitles.includes("Solution Approach"));
  assert.ok(!assignedTitles.includes("Numerical Experiment"));
  assert.ok(!assignedTitles.includes("Experiment Setup"));
  assert.ok(!assignedTitles.includes("Total Demand"));
});

test("a baseline word inside inference cannot displace foundational theory", () => {
  const result = planModelVariants({
    id: "permutation-theory",
    title: "Choice Models and Permutation Invariance: Demand Estimation in Differentiated Products Markets",
    model_topic: "Permutation-invariant demand estimation",
    game_architecture: ["Inference in baseline setting"],
    architecture_detail: []
  }, [
    { ...section("Parametric Discrete Choice Models", 3, "Discrete choice models play a crucial role and trace back to prior literature."), number: "2.1" },
    { ...section("Nonparametric Demand Estimation", 4, "Recent research has developed flexible estimators."), number: "2.2" },
    { ...section("Choice Models and Permutation Invariance", 6, "We characterize consumer choice functions through permutation invariance."), number: "3.1" },
    { ...section("Extensions to Individual-Level Data and Additional Covariates", 9, "This formulation incorporates individual-specific features into the choice function."), number: "3.2" },
    { ...section("Endogenous Covariates", 10, "The extension also permits endogenous observable features."), number: "3.3" },
    { ...section("Background for Inference Procedure", 11, "This subsection develops inferential notation."), number: "3.4.1" },
    { ...section("Inference in Baseline Exogeneous Setting", 13, "We derive inference results without endogenous variables."), number: "3.4.2" },
    { ...section("Estimation Procedure", 17, "We estimate the choice function and average price effect."), number: "4" },
    { ...section("Numerical Experiments", 19, "The estimators are validated in simulations."), number: "5" },
    { ...section("Predictive Performance", 20, "This subsection compares out-of-sample error."), number: "5.1" },
    { ...section("Multinomial Logit and Random Coefficient Logit with Linear Utility", 21, "These are simulation data-generating processes."), number: "5.1.1" },
    { ...section("Other Simulations", 27, "Additional simulation results are reported."), number: "5.1.4" },
    section("Change with the Debiased Estimator", 31, "Figure 3 plots the estimator distribution.")
  ], { maxVariants: 5 });

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Choice Models and Permutation Invariance",
    "Extensions to Individual-Level Data and Additional Covariates"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "extension"]);
  assert.ok(result.variants[1].sections.some((item) => item.title === "Endogenous Covariates"));
  const planned = result.variants.flatMap((variant) => [variant.name, ...variant.sections.map((item) => item.title)]);
  assert.ok(!planned.some((value) => /inference|estimation procedure|experiment|simulation|debiased estimator/i.test(value)));
});

test("sentence-like metadata labels do not become baseline names and numerical studies are not variants", () => {
  const result = planModelVariants({
    id: "waiting-study",
    title: "Perceived Waiting and Service Design",
    model_topic: "Problem definition: Unoccupied waiting feels longer than it actually is.",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model", 4, "The service system determines quoted and experienced waiting."), number: "2" },
    { ...section("Numerical Study", 12, "The numerical study validates comparative statics."), number: "5" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Perceived Waiting and Service Design baseline model"]);
  assert.ok(!result.variants[0].sections.some((item) => item.title === "Numerical Study"));
});

test("corpus affiliation and truncated-footnote headings never become model variants", () => {
  const affiliation = planModelVariants({
    id: "doi-10-1287-msom-2024-0989",
    title: "Managing Payment Flexibility in Rent-to-Own Contracts",
    model_topic: "Rent-to-own payment flexibility",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("Pricing Department, Priceline, Toronto, Ontario M5V 2H2, Canada", 1, "We formulate a dynamic programming model that chooses payment flexibility."),
    section("Engineering, North Carolina State University, Raleigh, North Carolina 27695", 1, "We formulate an optimization model for service capacity."),
    section("2. Model", 5, "The firm chooses payment flexibility before uncertain income is realized.")
  ]);
  assert.deepEqual(affiliation.variants.map((variant) => variant.name), ["Rent-to-own payment flexibility"]);
  assert.ok(!affiliation.variants[0].sections.some((item) => /Pricing Department|State University/i.test(item.title)));

  const footnote = planModelVariants({
    id: "doi-10-1287-msom-2020-0958",
    title: "Information Fusion",
    model_topic: "Dynamic sensor information fusion",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Baseline Model", 4, "The sensor chooses an information source in each period."),
    section("8. The extension to a setting in which the means of these normal", 18, "The extension is contained in an online appendix and the main results still hold.")
  ]);
  assert.deepEqual(footnote.variants.map((variant) => variant.name), ["Baseline Model"]);
});

test("computational, calibration, and data-study headings cannot masquerade as formulations", () => {
  const result = planModelVariants({
    id: "study-headings",
    title: "Capacity Planning",
    model_topic: "Stochastic capacity planning",
    game_architecture: ["Computational Study: Using Real Data", "Model Calibration"],
    architecture_detail: []
  }, [
    section("2. Baseline Model", 3, "The baseline model selects capacity before stochastic demand."),
    section("Computational Study: Using Real Data", 10, "We formulate a model for evaluating the policy on observed data."),
    section("Computational Study: Using Synthetic Data", 12, "We develop a model for evaluating synthetic test instances."),
    section("Calibration", 14, "We specify the calibrated model and compare its fitted parameters."),
    section("Model Calibration", 15, "The model is modified during calibration against historical observations."),
    section("Numerical Results", 17, "We introduce an alternative model in the numerical evaluation."),
    section("Real-Data Study", 19, "We formulate a model for the empirical evaluation."),
    section("Synthetic-Data Study", 21, "We formulate a model for simulation evaluation."),
    section("7. Extension to Correlated Demand", 24, "The extension changes the baseline demand assumption to allow correlation."),
    section("8. Alternative High-Capacity Regime", 27, "The alternative regime changes the capacity constraint.")
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Baseline Model",
    "Extension to Correlated Demand",
    "Alternative High-Capacity Regime"
  ]);
  assert.ok(result.diagnostics.ignoredArchitectureFacets.includes("Computational Study: Using Real Data"));
  assert.ok(result.diagnostics.ignoredArchitectureFacets.includes("Model Calibration"));
});

test("an audited model map retains a top-level calibrated numerical instantiation only with literal comparison evidence", () => {
  const record = {
    id: "audited-calibrated-model",
    title: "Workforce Scheduling",
    model_topic: "Workforce scheduling mechanisms",
    detail_level: "model_map",
    review_status: "PDF-verified; independently audited",
    game_architecture: [],
    architecture_detail: []
  };
  const calibrated = {
    ...section(
      "Numerics on a Calibrated Model",
      14,
      "We perform simulations based on parameters calibrated using a ride-hailing data set to compare the performance of the various mechanisms."
    ),
    number: "5"
  };
  const result = planModelVariants(record, [calibrated]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Baseline model",
    "Numerics on a Calibrated Model"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative"]);
  assert.deepEqual(result.variants[1].relationships, [{
    type: "alternativeTo",
    targetModelId: result.variants[0].id
  }]);

  const missingComparison = planModelVariants(record, [{
    ...calibrated,
    text: "We perform simulations based on parameters calibrated using a ride-hailing data set and report numerical results."
  }]);
  assert.deepEqual(missingComparison.variants.map((variant) => variant.name), ["Baseline model"]);

  const unaudited = planModelVariants({ ...record, review_status: "PDF-verified" }, [calibrated]);
  assert.deepEqual(unaudited.variants.map((variant) => variant.name), ["Baseline model"]);
});

test("a generic Extensions heading needs a locally stated formulation change", () => {
  const weak = planModelVariants({
    id: "weak-generic-extension",
    title: "Inventory Control",
    model_topic: "Inventory control",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Baseline Model", 3, "The baseline model chooses inventory before demand."),
    section("6. Extensions", 14, "We extend the model and report additional numerical results."),
    section("6.1 Other Extensions", 15, "All remaining extensions and results are reported in the online appendix."),
    section("6.2 Extensions and Robustness of Main Results", 16, "This section summarizes robustness checks and their numerical results.")
  ]);
  assert.deepEqual(weak.variants.map((variant) => variant.name), ["Baseline Model"]);

  const strong = planModelVariants({
    id: "strong-generic-extension",
    title: "Inventory Control",
    model_topic: "Inventory control",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("2. Baseline Model", 3, "The baseline model chooses inventory before demand."),
    section("6. Extensions", 14, "We extend the baseline model by allowing correlated product demands.")
  ]);
  assert.deepEqual(strong.variants.map((variant) => variant.kind), ["baseline", "extension"]);
});

test("doi-10-1287-isre-2022-1131 keeps the GDMR as baseline instead of benchmark and literature facets", () => {
  const result = planModelVariants({
    id: "doi-10-1287-isre-2022-1131",
    title: "Estimating Life Cycle Sales of Technology Products with Frequent Repeat Purchases: A Fractional Calculus-Based Approach",
    model_topic: "The paper develops a generalized diffusion model with repeat purchases.",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Prior Literature on Diffusion Models", 2, "Prior diffusion models omit frequent repeat purchases."), number: "2" },
    { ...section("Generalized Diffusion Model with Repeat Purchases", 3, "We introduce a generalized diffusion model with repeat purchases."), number: "4" },
    { ...section("Model Operationalization", 5, "We operationalize the same GDMR with a fractional integral."), number: "4.2" },
    { ...section("Approximation and Dynamics of GDMR", 5, "The approximation replaces the fractional operator with a computable rule."), number: "4.3" },
    { ...section("Benchmark Repeat Purchase Models", 6, "We create two benchmark sales models for comparison."), number: "5.1" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Generalized Diffusion Model with Repeat Purchases",
    "Approximation and Dynamics of GDMR"
  ]);
  assert.equal(result.variants[0].kind, "baseline");
  assert.equal(result.variants[1].kind, "approximation");
  const planned = result.variants.flatMap((variant) => [variant.name, ...variant.sections.map((item) => item.title)]);
  assert.ok(!planned.some((value) => /prior literature|benchmark repeat purchase|model operationalization/i.test(value)));
});

test("doi-10-1287-mksc-2022-1429 treats training, tests, and benchmarks as facets of the aesthetic model", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mksc-2022-1429",
    title: "Product Aesthetic Design: A Machine Learning Augmentation",
    model_topic: "Aesthetics are critically important to market acceptance.",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Overview of a Machine Learning", 4, "The common architecture predicts ratings and generates product images."), number: "3" },
    { ...section("Deep Learning Architecture", 8, "The common neural-network layers define the predictive and generative models."), number: "5.1" },
    { ...section("Stabilization and Tuning of Model Training", 9, "This subsection reports how the model is trained and tuned."), number: "5.3" },
    { ...section("Potential Model Extensions", 10, "We extend the baseline model to allow multiple aesthetic outputs."), number: "5.4" },
    { ...section("Benchmarks", 12, "The table compares prediction errors against benchmark methods."), number: "7.1" },
    { ...section("Sophisticated Benchmark 2: Pretrained Deep", 12, "A pretrained network is used only as an evaluation benchmark."), number: "7.1.3" },
    { ...section("Model Training and Predictive Test", 16, "We train the same model in a replication category."), number: "8.2" },
    { ...section("Discussion and Summary", 17, "We summarize the findings and managerial implications."), number: "9.1" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "extension"]);
  assert.equal(result.variants[1].name, "Potential Model Extensions");
  assert.deepEqual(result.variants[1].sections.map((item) => item.title), ["Potential Model Extensions"]);
  const planned = result.variants.flatMap((variant) => [variant.name, ...variant.sections.map((item) => item.title)]);
  assert.ok(!planned.some((value) => /model training|predictive test|benchmarks?|discussion and summary/i.test(value)));
});

test("doi-10-1287-mnsc-2017-2863 does not turn alternatives, assumptions, or counterfactual analysis containers into models", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mnsc-2017-2863",
    title: "Buyer Intermediation in Supplier Finance",
    model_topic: "Buyer-intermediated supplier financing",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model Description and Sequence of Events", 3, "The supplier, retailer, and bank act in a common sequence."), number: "3.1" },
    { ...section("Financing Alternatives", 4, "This section presents the two financing schemes studied in the paper."), number: "3.2" },
    { ...section("Discussion of Model Assumptions", 7, "The discussion explains the assumptions of the same model."), number: "3.3" },
    { ...section("Counterfactual Efficiency Analysis", 17, "The analysis combines estimates and theoretical results."), number: "5" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Buyer-intermediated supplier financing"]);
  assert.ok(result.variants[0].sections.some((item) => item.title === "Model Description and Sequence of Events"));
  assert.ok(!result.variants[0].sections.some((item) => /alternatives|assumptions|counterfactual/i.test(item.title)));
});

test("doi-10-1287-mnsc-2017-2992 rejects extracted table and conclusion headings without losing the true formulation", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mnsc-2017-2992",
    title: "Inverse Optimization: Closed-Form Solutions, Geometry, and Goodness of Fit",
    model_topic: "Inverse linear optimization",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Inverse Linear Optimization", 4, "We introduce a general inverse optimization model for linear optimization."), number: "2" },
    section("Model Variant Solution Structure", 12, "Type norm decision space objective space."),
    { ...section("Model Selection and Inverse Optimization", 23, "This section gives practitioner guidance for model selection."), number: "4" },
    section("Model 3", 32, "The cells in this extracted table indicate the objectives included for each model."),
    { ...section("Conclusions and Future Work", 33, "The paper concludes and describes future work."), number: "6" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Inverse Linear Optimization"]);
  assert.deepEqual(result.variants[0].sections.map((item) => item.title), ["Inverse Linear Optimization"]);
});

test("doi-10-1287-mnsc-2019-3417 keeps its full model and two benchmarks but not comparative statics", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mnsc-2019-3417",
    title: "Contracting with Word-of-Mouth Management",
    model_topic: "Word-of-mouth contracting",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model", 4, "The seller offers a menu of contracts and referral rewards before the sender decides whether to talk."), number: "2" },
    { ...section("Optimal Scheme", 5, "We characterize the optimal scheme and compare referral rewards with a free contract."), number: "3" },
    { ...section("Benchmark Without Referral Reward", 5, "Referral rewards are exogenously set to zero in this benchmark model."), number: "3.1" },
    { ...section("Benchmark Without a Free Contract", 6, "The seller is restricted to offer only one contract in this benchmark model."), number: "3.2" },
    { ...section("The Full Model", 7, "We now consider the full model with both referral rewards and free contracts."), number: "3.3" },
    { ...section("Comparative Statics for the Full Model", 11, "The characterization allows us to conduct comparative statics of the full model."), number: "5" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "The Full Model",
    "Benchmark Without Referral Reward",
    "Benchmark Without a Free Contract"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative", "alternative"]);
  assert.ok(result.variants[0].sections.some((item) => item.title === "Model"));
  assert.ok(result.variants[0].sections.some((item) => item.title === "Optimal Scheme"));
  assert.equal(result.variants.some((variant) => /comparative statics/i.test(variant.name)), false);
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(5));
});

test("doi-10-1287-msom-2021-1037 preserves four explicitly formulated supply-network configurations", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2021-1037",
    title: "Product Flexibility Strategy Under Supply and Demand Risk",
    model_topic: "Supply-network flexibility under supply and demand risk",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model", 5, [
      "There are four possible flexibility configurations of our supply network: a dedicated supply network (dd), a flexible backup network (df), a flexible primary network (fd), and a fully flexible network (ff).",
      "We now formulate the objective functions for each of the four network configurations."
    ].join(" ")), number: "3" },
    { ...section("Flexible Backup Network (df)", 8, "Let udf denote the expected profit associated with the flexible backup network (df)."), number: "3.3" },
    { ...section("Fully Flexible Network (ff)", 8, "Let uff denote the expected profit associated with the fully flexible network (ff)."), number: "3.4" },
    { ...section("Analysis of Flexibility", 8, "We compare the four configurations."), number: "4" },
    { ...section("Flexible Primary Network (fd) vs. Dedicated Supply Network (dd)", 9, "This comparison isolates demand pooling and supplier diversification."), number: "4.1" },
    { ...section("Fully Flexible Network (ff) vs. Flexible Backup Network (df)", 10, "This comparison characterizes their relative performance."), number: "4.2" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Dedicated Supply Network (dd)",
    "Flexible Primary Network (fd)",
    "Flexible Backup Network (df)",
    "Fully Flexible Network (ff)"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative", "alternative", "alternative"]);
  assert.deepEqual(result.variants.slice(1).map((variant) => variant.relationships[0]), [
    { type: "alternativeTo", targetModelId: "dedicated-supply-network-dd" },
    { type: "alternativeTo", targetModelId: "dedicated-supply-network-dd" },
    { type: "alternativeTo", targetModelId: "dedicated-supply-network-dd" }
  ]);
  assert.ok(result.variants[0].sections.some((item) => item.title === "Dedicated Supply Network (dd)"));
  assert.ok(result.variants[1].sections.some((item) => /Flexible Primary Network.*vs\./i.test(item.title)));
  assert.ok(result.variants[3].sections.some((item) => /Fully Flexible Network.*vs\./i.test(item.title)));
  assert.equal(result.variants.flatMap((variant) => variant.sections)
    .filter((item) => /Flexible Primary Network.*vs\./i.test(item.title)).length, 1);
  assert.equal(result.variants.flatMap((variant) => variant.sections)
    .filter((item) => /Fully Flexible Network.*vs\./i.test(item.title)).length, 1);
  assert.equal(result.variants.some((variant) => /analysis|\bvs\.?\b/i.test(variant.name)), false);
});

test("doi-10-1287-msom-2018-0705 keeps sequential and simultaneous timing as the only peer models", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2018-0705",
    title: "Strategic Inventory and Supplier Encroachment",
    model_topic: "Strategic inventory and supplier encroachment",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Sequential Model", 4, "We consider a sequential move from the buyer to the supplier in the main model."), number: "2.1" },
    { ...section("Review of Previous Papers and Extension", 5, "We review earlier papers before complementing one result."), number: "3.1" },
    { ...section("Two-Period Model with Direct Channel Only", 6, "This model is in effect our main model without the inventory withholding option."), number: "3.2" },
    { ...section("Simultaneous Quantity Competition", 11, "We consider an alternative timing structure and describe the simultaneous model."), number: "5" },
    { ...section("Model Description and Equilibrium Results", 11, "The sequence of moves in the simultaneous model differs in period 2."), number: "5.1" },
    { ...section("Two-Period Simultaneous Model with Direct Channel Only", 12, "This model is our simultaneous model without the inventory withholding option."), number: "5.2" },
    { ...section("Comparison Between Sequential and Simultaneous Models", 13, "We compare the two timing structures."), number: "5.3" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Sequential Model", "Simultaneous Model"]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative"]);
  assert.equal(result.variants[1].relationships[0].targetModelId, "sequential-model");
  assert.ok(result.variants[0].sections.some((item) => item.title === "Two-Period Model with Direct Channel Only"));
  assert.ok(!result.variants[0].sections.some((item) => /simultaneous/i.test(item.title)));
  assert.ok(result.variants[1].sections.some((item) => item.title === "Model Description and Equilibrium Results"));
  assert.ok(result.variants[1].sections.some((item) => /Two-Period Simultaneous Model/i.test(item.title)));
  assert.ok(result.variants[1].sections.some((item) => /Comparison Between Sequential and Simultaneous Models/i.test(item.title)));
  assert.equal(result.variants.flatMap((variant) => variant.sections)
    .filter((item) => /Two-Period Simultaneous Model/i.test(item.title)).length, 1);
  assert.ok(!result.variants.flatMap((variant) => variant.sections).some((item) => /Review of Previous Papers/i.test(item.title)));
  assert.equal(result.variants.some((variant) => /review|equilibrium results|direct channel only/i.test(variant.name)), false);
});

test("doi-10-1287-msom-2020-0187 keeps the irrigation model and heterogeneous-soil extension only", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2020-0187",
    title: "Dynamic Irrigation Management Under Weather Uncertainty and Soil Heterogeneity",
    model_topic: "Dynamic irrigation management",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Irrigation Model", 3, "We formulate the irrigation problem as a stochastic dynamic program."), number: "3" },
    { ...section("Numerical Study", 6, "The numerical study evaluates the irrigation policy."), number: "3.1" },
    { ...section("Model Extension: Heterogenous", 9, "We extend the baseline model by allowing heterogeneous soil zones."), number: "4" },
    { ...section("Numerical Study on a Field with Heterogenous Soil", 11, "The numerical study evaluates the extension."), number: "4.1" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Irrigation Model", "Model Extension: Heterogenous"]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "extension"]);
  assert.equal(result.variants[1].relationships[0].type, "extends");
  assert.ok(!result.variants.flatMap((variant) => variant.sections).some((item) => /numerical study/i.test(item.title)));
});

test("doi-10-1287-msom-2023-0398 separates general, one, disjoint, and chained pool formulations", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2023-0398",
    title: "Nurse Staffing Under Absenteeism",
    model_topic: "Distributionally robust nurse staffing",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Distributionally Robust Nurse Staffing", 3, "We consider the following two-stage DRO model (DRNS) for nurse staffing under absenteeism."), number: "2" },
    { ...section("Solution Approach: General", 4, "We consider general pool structures, recast DRNS as a min-max formulation, and derive a separation algorithm."), number: "3" },
    { ...section("Tractable Cases: Practical Pool", 7, "We consider three special nurse pool structures and derive tractable reformulations of the DRNS model."), number: "4" },
    { ...section("One Pool", 8, "Under Structure 1, the DRNS model yields a distinct MILP reformulation."), number: "4.1" },
    { ...section("Disjoint Pools", 9, "Under Structure D, the DRNS model is recast as a separable MILP reformulation."), number: "4.2" },
    { ...section("Chained Pools", 10, "Under Structure C, we adopt an alternative approach to recast the DRNS formulation using a dynamic program."), number: "4.3" },
    { ...section("Computational Efficacy", 12, "We compare computation times across the formulations."), number: "5.2" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "General Pool Structure",
    "One Pool",
    "Disjoint Pools",
    "Chained Pools"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative", "alternative", "alternative"]);
  assert.ok(result.variants.slice(1).every((variant) => variant.relationships[0].targetModelId === "general-pool-structure"));
  assert.ok(result.variants[0].sections.some((item) => item.title === "Tractable Cases: Practical Pool"));
  assert.deepEqual(result.variants.slice(1).map((variant) => variant.sections[0].title), ["One Pool", "Disjoint Pools", "Chained Pools"]);
  assert.equal(result.variants.some((variant) => /tractable cases|computational/i.test(variant.name)), false);
});

test("doi-10-1287-msom-2019-0809 treats disclosure and no-disclosure as paired model settings", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2019-0809",
    title: "Motivating Supplier Social Responsibility Under Incomplete Visibility",
    model_topic: "Supplier social responsibility under incomplete visibility",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model Setup", 4, "We first discuss no disclosure and then introduce the disclosure case."), number: "2" },
    { ...section("No Firm Disclosure", 4, "We consider a supply chain in which the firm does not disclose SR information."), number: "2.1" },
    { ...section("Firm Disclosure", 6, "The key difference is that the firm chooses an SR level to disclose before third-party scrutiny."), number: "2.2" },
    { ...section("Results: No Firm Disclosure", 7, "We characterize the no-disclosure results."), number: "3" },
    { ...section("Results: Firm Disclosure", 10, "We characterize the disclosure results."), number: "4" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["No Firm Disclosure", "Firm Disclosure"]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative"]);
  assert.equal(result.variants[1].relationships[0].targetModelId, "no-firm-disclosure");
  assert.ok(result.variants[0].sections.some((item) => item.title === "Results: No Firm Disclosure"));
  assert.ok(result.variants[1].sections.some((item) => item.title === "Results: Firm Disclosure"));
  assert.equal(result.variants.some((variant) => /^results:/i.test(variant.name)), false);
});

test("doi-10-1287-msom-2022-0159 keeps relaxations and computational checks inside its General Model", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2022-0159",
    title: "Optimal Intraproject Learning",
    model_topic: "Optimal intraproject learning",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("General Model", 4, "We provide a mathematical model of the intraproject learning problem."), number: "4" },
    { ...section("Learning in General Projects", 5, "We formulate the project-learning optimization problem."), number: "4.3" },
    { ...section("Lower Bounds", 9, "We derive a strong relaxation that allows partial knowledge transfer."), number: "5.2" },
    { ...section("Computational Study", 14, "We evaluate the heuristic and relaxation."), number: "7" },
    { ...section("Robustness Check of the Algorithm", 14, "We report robustness checks."), number: "7.1" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["General Model"]);
  assert.ok(result.variants[0].sections.some((item) => item.title === "Learning in General Projects"));
  assert.ok(!result.variants[0].sections.some((item) => /computational|robustness/i.test(item.title)));
});

test("doi-10-1287-mnsc-2021-04108 keeps approximation guarantees and theorem bounds out of the model hierarchy", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mnsc-2021-04108",
    title: "Submodular Order Functions and Assortment Optimization",
    model_topic: "We define a new class of set functions that, in addition to being monotone and subadditive, also admit a very limited form of submodularity defined over a permutation of the ground set.",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Algorithms for Submodular Order Functions", 12, "The paper proposes threshold augmentation and directed local-search algorithms."), number: "3" },
    { ...section("Algorithms for Constrained Assortment Optimization", 16, "We translate the algorithms from submodular order maximization to constrained assortment optimization."), number: "3.3" },
    { ...section("Approximation Guarantees", 18, "We analyze the approximation factors achieved by the preceding algorithms."), number: "4" },
    { ...section("Cardinality Constraint", 20, "The following theorem establishes the guarantee under a cardinality constraint."), number: "4.1" },
    { ...section("Upper Bound of 0.5", 27, "The proof constructs a family of instances for the oracle lower bound."), number: "5" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Submodular Order Functions and Assortment Optimization baseline model"
  ]);
  assert.equal(result.variants.some((variant) => /guarantee|upper bound/i.test(variant.name)), false);
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(2));
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(4));
});

test("result, discussion, bound, and citation-prose headings never become peer models", () => {
  const rejected = [
    "Key Results",
    "Overview of Results",
    "Overview of Main Contributions",
    "Findings and Contribution",
    "Comparing Model-Generated Results to Industry Data",
    "Case Study: Empirical Results",
    "A Case Study: Repatha",
    "Equilibrium Analysis",
    "Model Discussion",
    "Computational Performance for Model Levels",
    "Data and Model Assumptions",
    "Model Overview",
    "Comparison with Common Practices and the Base Model",
    "Building and Fitting the General Tree Model",
    "Using Industry Data in Proposed Model",
    "Application of Wallenius Model",
    "Evaluation of Approximations",
    "Comparison with Nested Logit Model",
    "Comparison: Two Alternative Mechanisms",
    "Relating Model Predictions to Empirical Observations",
    "Performance Evaluation of the Proposed Policy",
    "Data Preparation and Model Implementation",
    "CDC Model Comparison",
    "Value of a Fork-Join Model in Comparison",
    "Comparison with Benchmarks",
    "Comparison with First Best",
    "Summary and Conclusions",
    "Benchmark Algorithms and Evaluation Framework",
    "Competitive and Approximation Ratios",
    "Algorithm and Results Based on the Truncated LP",
    "Preliminary Results: Benchmarks and Recommendation Policy",
    "Relating Model Analysis to Field Data: Bengal Gram in Karnataka",
    "Calibrating Model Parameters",
    "Sensitivity with Respect to the Dissimilarity",
    "Motivation",
    "Models and Results",
    "Results Compared with Benchmark Strategies",
    "Two-Dimensional Heterogeneity: Approximation Bound",
    "Preliminary Analysis",
    "Conclusions and Discussion",
    "The Stylized Model and Empirical Results Apply",
    "Analogous to Those in the Stylized Model",
    "Counterfactual Implementation",
    "Counterfactual Analysis: Efficiency Gains",
    "A Benchmark Result",
    "Additional results on search model",
    "Counterfactual Policy Evaluation",
    "Comparing Optimal Prices Under Fully Myopic and Rational Regimes",
    "Summary of Contributions",
    "Average-Case Comparison of Formulations",
    "Conclusion and Robustness",
    "Contributions and Contents",
    "Overview",
    "Previous Work on Upper-Bound Approximations",
    "Equilibrium Outcomes in the Main Model",
    "Equilibrium Results Without the Feature Remain",
    "Profits Between Benchmark and Main Model",
    "In a model extension, we examine the scenario in which platforms enter",
    "Benchmark Repeat Purchase Models",
    "Training a Predictive Model for Utility",
    "Motivation for a Parametric Model",
    "Contributions",
    "Main Contributions",
    "Decision Rule based Approximation Approach from the Literature",
    "Conclusion and Extension",
    "More illustrative examples of the double moral hazard problem",
    "Roadmap of Paper",
    "Organization of the Paper",
    "Organization",
    "Discussion and Concluding Remarks",
    "Contribution and Overview of Results",
    "Performance of the Policy with Covariate Diversity",
    "Reformulating the Platform's Problem",
    "Key Results and Main Contributions",
    "Bridging the Gap with a Constructive Heuristic",
    "Model and Proof of Theorem 1",
    "Usually, input perturbation results in a much worse outcome",
    "Empirical Operationalization",
    "Approximation Error Analysis",
    "Error Bounds for the Approximation",
    "Implications",
    "Upper Bound with Known Variation",
    "Upper Bound with Unknown Variation",
    "Upper Bound by Relaxation",
    "Kominers (2024) applied this result to obtain alternative direct",
    "Research Contributions",
    "Overview and Main Contribution",
    "Research Questions and Results Preview",
    "Unlike our implementation, the traditional IP formulation discussed",
    "Selection and Implementation of Analytical Models",
    "Discussions and Extensions",
    "Versus Benchmark Solution",
    "Baseline Evaluation",
    "Research Questions",
    "The percentage improvements by our method over benchmarks",
    "Research Questions and Contributions",
    "Contrasting the Large Batch and Batch-and-Rate Regimes",
    "Alternative Benchmark Policies",
    "The Approximation Error",
    "Implications of the Model",
    "Step 4: Deploy Policies",
    "Reward Approximation Error",
    "Model Implications",
    "Two Parametric Regimes",
    "Operating Regimes",
    "The Optimal Operating Regime",
    "Performing a Rollout on the Randomized Policy",
    "Relationship to Benchmarks",
    "Chioveanu (2023) analyzes a variant of the model",
    "Following the dual interpretation, we reformulate the problem",
    "expected degree is lower under the proposed policy",
    "social welfare increases under the mechanism",
    "Compared with the benchmark, the policy performs better",
    "Nonimplementability of the First Best",
    "First-Best Payoff",
    "Remarks on the Model",
    "Relation to Models of Absorptive Capacity",
    "Relation to Prior Work on Rogers' Paradox",
    "As an extension, we allow heterogeneous firms",
    "Rounding a Continuous Relaxation",
    "Benchmark Strategies",
    "Contributions and Managerial Implications",
    "Key Results and Contributions",
    "Convergence Results",
    "Conclusions and Further Research",
    "Overview of Main Results",
    "Calibrating the Models and Testing the Approximations",
    "Main Insights and Contributions",
    "Conclusions and Insights",
    "Main Contributions of This Paper",
    "Objectives and Proposed Contributions",
    "Approach and Contributions",
    "Research Questions, Objective, and Contributions",
    "Contributions and Structure",
    "Contributions and Paper Overview",
    "Contribution and Main Results",
    "Contribution Statement and Organization of the Study",
    "Main Contributions and Insights",
    "Phase 2: Fitting the Model and Measuring Outcomes",
    "Mapping Theoretical Model to Empirical Data",
    "Neural ODE-Inspired Model Fitting Process",
    "Privacy-Regime Comparison",
    "Regime and Welfare Comparison",
    "Baseline Model Analysis"
  ];
  const result = planModelVariants({
    id: "result-heading-regression",
    title: "A Structural Operations Model",
    model_topic: "The paper formulates a structural operations model.",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model", 3, "We formulate the paper's structural operations model."), number: "2" },
    ...rejected.map((title, index) => ({
      ...section(title, 5 + index, "We formulate an analysis and report the resulting performance comparison."),
      number: String(3 + index)
    }))
  ]);

  assert.equal(result.variants.length, 1);
  assert.equal(result.variants.some((variant) => rejected.includes(variant.name)), false);
  assert.deepEqual(rejected.filter((_title, index) =>
    !result.diagnostics.unassignedSectionIndexes.includes(index + 1)), []);
});

test("model-bearing analytical headings remain eligible when they name an independently formulated model", () => {
  const result = planModelVariants({
    id: "model-analysis-preservation",
    title: "Analytical and Econometric Models",
    model_topic: "The paper develops analytical and econometric formulations.",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Analytical Model", 3, "We formulate an analytical product-returns model."), number: "2" },
    { ...section("Econometric Model and Main Results", 9, "We formulate a separate econometric demand model and estimate its parameters."), number: "4" },
    { ...section("Model with Multiple Interim Analyses", 14, "We formulate a model in which several interim analyses change the stopping decision."), number: "6" },
    { ...section("Relaxations and Policies with Performance Guarantees", 18, "We formulate policy relaxations that define distinct implementable controls."), number: "7" }
  ]);

  assert.ok(result.variants.some((variant) => variant.name === "Econometric Model and Main Results"));
  assert.ok(result.variants.some((variant) => variant.name === "Model with Multiple Interim Analyses"));
  assert.ok(result.variants.some((variant) => variant.name === "Relaxations and Policies with Performance Guarantees"));
});

test("a singular named benchmark model remains eligible while benchmark result containers do not", () => {
  const result = planModelVariants({
    id: "named-benchmark-model",
    title: "Feature Design",
    model_topic: "Feature-design equilibrium",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Benchmark Model: Without the Feature", 4, "The benchmark model removes the feature."), number: "3.1" },
    { ...section("Main Model: With the Feature", 7, "The main model includes the feature."), number: "3.2" },
    { ...section("A Benchmark Result", 9, "The proposition reports the benchmark result."), number: "4.1" },
    { ...section("Benchmark Repeat Purchase Models", 10, "This section compares several benchmark models."), number: "4.2" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Main Model: With the Feature",
    "Benchmark Model: Without the Feature"
  ]);
});

test("a plural Benchmark Scenarios container does not become one synthetic peer model", () => {
  const result = planModelVariants({
    id: "benchmark-scenarios-container",
    title: "Delegating Innovation Projects with Deadline",
    model_topic: "Committed versus flexible stopping",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model", 4, "The client chooses between committed and flexible stopping policies."), number: "3" },
    { ...section("Benchmark Scenarios", 6, "This section considers two benchmark models: one has no deadline and one fixes provider effort."), number: "3.3" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Committed versus flexible stopping"]);
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(1));
});

test("nested structural formulation and empirical validation stay within one source model", () => {
  const result = planModelVariants({
    id: "nested-structural-formulation",
    title: "Stochastic Service Control",
    model_topic: "Stochastic service control",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model and Problem Formulation", 3, "We formulate a stochastic dynamic program."), number: "2" },
    { ...section("Formulation and Structural Properties", 4, "We derive structural properties of the same dynamic program."), number: "2.1" },
    { ...section("Empirical Model", 10, "This empirical validation measures simulated growth-path performance."), number: "5.1" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Model and Problem Formulation"]);
  assert.deepEqual(result.variants[0].sections.map((item) => item.title), [
    "Model and Problem Formulation",
    "Formulation and Structural Properties"
  ]);
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(2));
});

test("a mixed analysis-and-extensions container is not promoted as one composite peer model", () => {
  const result = planModelVariants({
    id: "mixed-extension-container",
    title: "Market Design",
    model_topic: "Market-design model",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model", 3, "The paper formulates the market-design model."), number: "2" },
    { ...section("Further Analysis and Model Extensions", 10, "This section collects a benchmark analysis and several unrelated extensions."), number: "6" }
  ]);

  assert.equal(result.variants.length, 1);
  assert.ok(!result.variants.some((variant) => variant.name === "Further Analysis and Model Extensions"));
});

test("doi-10-1287-msom-2018-0722 uses the formulation as baseline and keeps industry-data analysis as facets", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2018-0722",
    title: "Contract Design for the Stockist in Indian Distribution Networks",
    model_topic: "Stockist contract design",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Introduction and Motivation", 1, "The paper motivates the stockist setting."), number: "1" },
    { ...section("Model Building and Analysis", 4, "We formulate the stockist and firm's contracting model."), number: "3" },
    { ...section("Stockist's Problem", 6, "The stockist chooses its order quantity."), number: "3.1" },
    { ...section("Firm's Problem", 7, "The firm chooses the screening contract."), number: "3.2" },
    { ...section("Using Industry Data in Proposed Model", 12, "We apply the proposed model to industry data."), number: "4.1" },
    { ...section("Comparing Model-Generated Results to Industry Data", 15, "We compare model predictions with the data."), number: "4.2" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Model Building and Analysis"]);
  assert.deepEqual(result.variants[0].sections.map((item) => item.title), [
    "Model Building and Analysis",
    "Stockist's Problem",
    "Firm's Problem"
  ]);
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(4));
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(5));
});

test("doi-10-1287-msom-2019-0856 collapses a nested formulation into its base model", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2019-0856",
    title: "Rewarding Suppliers' Performance via Allocation of Business",
    model_topic: "Supplier allocation rules",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Base Model and Analytical Results", 4, "We develop the base allocation model."), number: "3" },
    { ...section("Problem Description and Model Formulation", 4, "We formulate the buyer's allocation problem."), number: "3.1" },
    section("Allocation Rule Without Participation Constraints", 7, "The rule omits suppliers' participation constraints."),
    section("Allocation Rule with Participation Constraints", 8, "The rule imposes suppliers' participation constraints."),
    { ...section("Summary and Conclusions", 14, "We summarize the analytical results."), number: "7" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Base Model and Analytical Results",
    "Allocation Rule Without Participation Constraints",
    "Allocation Rule with Participation Constraints"
  ]);
  assert.deepEqual(result.variants[0].sections.map((item) => item.title), [
    "Base Model and Analytical Results",
    "Problem Description and Model Formulation"
  ]);
  assert.ok(result.variants.slice(1).every((variant) => variant.relationships[0].targetModelId === "base-model-and-analytical-results"));
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(4));
});

test("doi-10-1287-msom-2021-0354 keeps policy bounds and evaluations out of the OFD model hierarchy", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2021-0354",
    title: "On-Demand Food Delivery",
    model_topic: "On-demand food-delivery matching",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("OFD Model Description", 5, "We formulate the OFD matching model."), number: "3" },
    { ...section("Orders", 5, "Orders arrive dynamically."), number: "3.1" },
    { ...section("Cost Model", 6, "The cost model defines delivery distance and delay."), number: "3.5" },
    { ...section("Benchmark Policies as Lower and Upper Bounds", 7, "Benchmark policies bound the value of the same model."), number: "4.1" },
    { ...section("KT Policy Development and Analysis", 9, "We develop and analyze the KT policy."), number: "4.3" },
    { ...section("Performance Evaluation of the Proposed Policy", 14, "We evaluate the policy computationally."), number: "5.2" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["OFD Model Description"]);
  assert.deepEqual(result.variants[0].sections.map((item) => item.title), ["OFD Model Description", "Orders", "Cost Model"]);
});

test("doi-10-1287-msom-2025-0529 keeps comparison analysis outside its model and approximation families", () => {
  const result = planModelVariants({
    id: "doi-10-1287-msom-2025-0529",
    title: "Near-Optimal Dispatch Policies for Emergency Medical Services",
    model_topic: "Emergency-medical dispatch",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model and Problem Formulation", 4, "We formulate the emergency-dispatch problem."), number: "2" },
    { ...section("Relaxations and Policies with Performance Guarantees", 5, "We formulate relaxations and implementable dispatch policies."), number: "3" },
    { ...section("Lagrangian Relaxation and Decomposition", 5, "We formulate a Lagrangian relaxation of the dispatch problem."), number: "3.1" },
    { ...section("Policies and Performance Guarantees", 7, "We give policies and prove their guarantees."), number: "3.3" },
    { ...section("Performance and Comparison with Benchmark Policies", 15, "We compare the policies with benchmarks."), number: "6.2" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Model and Problem Formulation",
    "Relaxations and Policies with Performance Guarantees"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "approximation"]);
  assert.ok(result.variants[1].sections.some((item) => item.title === "Lagrangian Relaxation and Decomposition"));
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(4));
});

test("singh2025 rejects its truncated paper-title heading and keeps the schemes model plus first-best benchmark", () => {
  const result = planModelVariants({
    id: "singh2025incorporatingincomedisparity",
    title: "Incorporating Income Disparity and Utility Heterogeneity into the Design of Public Services",
    model_topic: "Income-disparity mechanisms",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("Incorporating Income Disparity and Utility Heterogeneity", 1, "We formulate public-service mechanisms."),
    { ...section("Modeling Consumer Heterogeneity", 4, "Consumers differ in income and utility."), number: "3.1" },
    section("Schemes: Model and Analysis", 4, "We formulate the service schemes."),
    { ...section("First-Best Benchmark", 5, "The first-best benchmark permits full information."), number: "3.2" },
    { ...section("Our Proposal: IDM", 6, "The paper proposes the IDM mechanism."), number: "3.3" },
    { ...section("The Data-Driven Regime", 8, "We formulate a distinct data-driven regime."), number: "3.4" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Schemes: Model and Analysis",
    "First-Best Benchmark",
    "The Data-Driven Regime"
  ]);
  assert.ok(!result.variants.some((variant) => variant.name === "Incorporating Income Disparity and Utility Heterogeneity"));
  assert.ok(result.variants[0].sections.some((item) => item.title === "Modeling Consumer Heterogeneity"));
});

test("doi-10-1287-mnsc-2023-02068 keeps the newsvendor formulation and policy in one model", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mnsc-2023-02068",
    title: "From Contextual Data to Newsvendor Decisions: On the Actual Performance of Data-Driven Algorithms",
    model_topic: "Contextual newsvendor data-driven policy",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Problem Formulation", 5, "We formulate the contextual newsvendor problem."), number: "2" },
    { ...section("Data-Generation Process", 5, "Historical context-outcome pairs are independently generated."), number: "2.1" },
    { ...section("Data-Driven Policy and Objective", 5, "The policy maps historical data to an inventory decision minimizing worst-case regret."), number: "2.2" },
    { ...section("Main Results: Policies and Performance Characterization", 7, "We characterize policy performance."), number: "3" },
    { ...section("Learning Without Concentration: An Optimization Approach", 8, "The analysis uses an optimization approach to characterize regret."), number: "3.2" },
    { ...section("Sensitivity with Respect to the Dissimilarity", 15, "This subsection analyzes sensitivity to the dissimilarity function."), number: "4.4" }
  ]);

  assert.equal(result.variants.length, 1);
  assert.deepEqual(result.variants[0].sections.map((item) => item.title), [
    "Problem Formulation",
    "Data-Generation Process",
    "Data-Driven Policy and Objective"
  ]);
  assert.ok(!result.variants.some((variant) => /optimization approach|sensitivity/i.test(variant.name)));
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(4));
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(5));
});

test("literal source provenance preserves a generic framework before its stated model extension", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mksc-2015-0929",
    title: "Estimation of Beauty Contest Auctions",
    model_topic: "Auction estimation",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Empirical Framework", 6, "The cleaned column text omits the decisive sentence."), number: "3",
      sourceText: "We first present the basic model and estimation framework, and then expand it to include unobserved auction heterogeneity in Section 5." },
    { ...section("Model with Unobserved", 11, "Auction heterogeneity and finite types."), number: "5.1",
      sourceText: "We now modify the model in Section 3 to include an auction-specific unobservable." }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Empirical Framework", "Model with Unobserved"]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative"]);
  assert.equal(result.variants[1].relationships[0].targetModelId, "empirical-framework");
});

test("a source-explicit benchmark case remains a peer even inside a comparison chapter", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mnsc-2019-3377",
    title: "Correlated Search",
    model_topic: "Correlated consumer search",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("A Model of Correlated Search", 4, "We formulate the correlated-search model."), number: "2" },
    { ...section("Competitive Pricing Under Correlated Search", 9, "The paper compares correlated and independent search."), number: "4" },
    { ...section("Correlated Case", 9, "This case retains correlated product attributes."), number: "4.0" },
    { ...section("Independent Case", 10, "The cleaned column text starts after the formulation sentence."), number: "4.1",
      sourceText: "In this benchmark case, we modify the main model by assuming independent product attributes." }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["A Model of Correlated Search", "Independent Case"]);
  assert.deepEqual(result.variants[1].relationships, [{ type: "alternativeTo", targetModelId: "a-model-of-correlated-search" }]);
  assert.deepEqual(result.variants[1].sections.map((item) => item.title), ["Independent Case"]);
  assert.ok(result.variants[0].sections.some((item) => item.title === "Competitive Pricing Under Correlated Search"));
});

test("an integrated Model Development chapter owns its constituent models and rejects a running-title fragment", () => {
  const result = planModelVariants({
    id: "doi-10-1287-isre-2017-0722",
    title: "Software Diversity for Improved Network Security: Optimal Distribution of Software-Based Shared Vulnerabilities",
    model_topic: "Software-diversity network security",
    game_architecture: [],
    architecture_detail: []
  }, [
    section("Distribution of Software-Based Shared Vulnerabilities", 1, "Author affiliations and the abstract follow."),
    { ...section("Model Development", 5, "We develop an integrated allocation and propagation model."), number: "3" },
    { ...section("Model of Software Diversity", 5, "This subsection defines the diversity measure."), number: "3.1" },
    { ...section("Information Theoretic Decision Model for Software Allocation", 7, "This subsection defines allocation decisions."), number: "3.2" },
    { ...section("Software Distribution Model", 8, "This subsection formulates the distribution program."), number: "3.3" },
    { ...section("Virus Propagation Model", 11, "This subsection integrates the SIS propagation model."), number: "3.5" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Model Development"]);
  assert.deepEqual(result.variants[0].sections.map((item) => item.title), [
    "Model Development",
    "Model of Software Diversity",
    "Information Theoretic Decision Model for Software Allocation",
    "Software Distribution Model",
    "Virus Propagation Model"
  ]);
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(0));
});

test("a preserved model-map base suppresses a generic duplicate but retains a sourced extension", () => {
  const result = planModelVariants({
    id: "model-map-preserved-base",
    title: "School Testing Policies",
    model_topic: "A two-school testing-policy game",
    detail_level: "model_map",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Research Questions", 2, "The paper asks how schools choose tests."), number: "1.2" },
    { ...section("Model", 4, "We formulate the two-school testing-policy game."), number: "2" },
    { ...section("Extensions: Strategic Students and Two Schools", 14,
      "We extend the baseline model to allow strategic testing by students at two schools."), number: "6" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Baseline model",
    "Extensions: Strategic Students and Two Schools"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "extension"]);
});

test("model-map preservation keeps a genuine sibling formulation family", () => {
  const result = planModelVariants({
    id: "model-map-rental-family",
    title: "Equipment Rental Models",
    model_topic: "Equipment rental pricing",
    detail_level: "model_map",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Rental Models", 4, "The paper defines three rental formulations."), number: "3" },
    { ...section("Long-Term Rental Model", 5, "The long-term formulation uses a fixed contract."), number: "3.1" },
    { ...section("On-Demand Rental Model", 7, "The on-demand formulation charges per use."), number: "3.2" },
    { ...section("Hybrid Rental Model", 9, "The hybrid formulation combines both channels."), number: "3.3" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Long-Term Rental Model",
    "On-Demand Rental Model",
    "Hybrid Rental Model"
  ]);
});

test("unnumbered formulation continuations and method-only relaxations do not become peer models", () => {
  const result = planModelVariants({
    id: "method-facet-regression",
    title: "Online Fulfillment",
    model_topic: "Joint placement and fulfillment",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model and Problem Formulation", 4, "We formulate the joint optimization problem."), number: "2" },
    section("Formulation and Structural Properties", 5, "We formulate the same problem as a stochastic dynamic program."),
    { ...section("Rounding a Continuous Relaxation", 9, "The theorem rounds the relaxation."), number: "5.1" },
    { ...section("Benchmark Strategies", 15, "The section compares the method with benchmark strategies."), number: "8.1" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Model and Problem Formulation"]);
  assert.deepEqual(result.variants[0].sections.map((item) => item.title), [
    "Model and Problem Formulation",
    "Formulation and Structural Properties"
  ]);
});

test("a lowercase duplicate-number continuation cannot displace the true model-section heading", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mnsc-2021-4129",
    title: "Privacy-Preserving Dynamic Personalized Pricing with Demand Learning",
    model_topic: "Privacy-aware personalized dynamic pricing",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("The generalized linear model for demand rate", 4,
      "modeling resembles existing works on parametric contextual bandits without privacy constraints."), number: "3" },
    { ...section("Pricing Models and Assumptions", 5,
      "In this section, we provide technical details of the pricing problem and specify its generalized linear demand model."), number: "3" },
    { ...section("Algorithmic Framework", 8, "The algorithm learns demand while preserving privacy."), number: "5" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Pricing Models and Assumptions"]);
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(0));
});

test("an exact page-one paper-title repeat is never a peer model even when the title contains model", () => {
  const title = "A Data-Driven Approach Under a Multiple Binary Choice Model with Copula";
  const result = planModelVariants({
    id: "paper-title-model-artifact",
    title,
    model_topic: "Data-driven upgrade pricing",
    game_architecture: [],
    architecture_detail: []
  }, [
    section(title, 1, "Authors, affiliations, and abstract."),
    { ...section("Model and Problem Formulation", 4, "We formulate the pricing problem."), number: "3" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), ["Model and Problem Formulation"]);
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(0));
});

test("price-scheme siblings are peer formulations while bounds and robustness remain facets", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mnsc-2021-4236",
    title: "The Important Role of Time Limits When Consumers Choose Their Time in Service",
    model_topic: "Service congestion with endogenous service duration",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model Description", 4, "The model defines customers, congestion, prices, and time limits."), number: "3" },
    { ...section("First-Best Bound", 5, "The first best provides an upper bound."), number: "4" },
    { ...section("Benchmark: Per-Use Fees", 6, "The benchmark charges one fee per use."), number: "5.1" },
    { ...section("Price Schemes", 6, "The paper studies per-use fees and price rates."), number: "5" },
    { ...section("Price Rates", 7, "The alternative charges a rate per unit of service time."), number: "5.2" },
    { ...section("Alternative Levers for Managing Congestion", 15, "The section discusses other managerial levers."), number: "9.1" },
    { ...section("Alternative Shapes of the Value Function", 18, "The main results are robust to other value functions."), number: "9.6" }
  ]);

  assert.deepEqual(result.variants.map((variant) => variant.name), [
    "Benchmark: Per-Use Fees",
    "Price Rates"
  ]);
  assert.deepEqual(result.variants.map((variant) => variant.kind), ["baseline", "alternative"]);
  assert.ok(result.variants[0].sections.some((item) => item.title === "Model Description"));
  assert.ok(result.variants[1].sections.some((item) => item.title === "Price Rates"));
  assert.ok(!result.variants.some((variant) => /first-best|alternative levers|alternative shapes/i.test(variant.name)));
});

test("paper outline and input-acquisition methods cannot displace the targeting-policy formulation", () => {
  const result = planModelVariants({
    id: "doi-10-1287-mnsc-2022-02947",
    title: "A Sample Size Calculation for Training and Certifying Targeting Policies",
    model_topic: "Training and certifying targeting policies",
    game_architecture: [],
    architecture_detail: []
  }, [
    { ...section("Model", 3, "The paper defines customer segments, treatments, outcomes, and prior beliefs."), number: "2" },
    { ...section("Outline of the Paper", 3, "The remainder of the paper is organized as follows."), number: "1.2" },
    { ...section("Problem Formulation", 6, "We formulate the firm's minimum-sample-size decision problem."), number: "3.1" },
    { ...section("Alternative Benchmark Policies", 8, "This subsection compares certification against other benchmarks."), number: "3.3" },
    { ...section("Alternative Approaches for Obtaining the Model Inputs", 18, "The empirical application discusses eliciting inputs."), number: "5.5" }
  ]);

  assert.equal(result.variants.length, 1);
  assert.ok(result.variants[0].sections.some((item) => item.title === "Model"));
  assert.ok(result.variants[0].sections.some((item) => item.title === "Problem Formulation"));
  assert.ok(!result.variants.some((variant) => /outline|benchmark policies|obtaining.*inputs/i.test(variant.name)));
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(1));
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(3));
  assert.ok(result.diagnostics.unassignedSectionIndexes.includes(4));
});
