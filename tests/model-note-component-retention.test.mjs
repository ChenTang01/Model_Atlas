import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADDITIONAL_CONCEPTS,
  buildAuthoredNote,
  cleanText
} from "../scripts/model-note-authoring.mjs";
import { sourceSupportsRole } from "../scripts/model-note-relevance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAPER_IDS = [
  "doi-10-1287-mnsc-2018-3124",
  "doi-10-1287-msom-2017-0619",
  "doi-10-1287-msom-2022-1092",
  "doi-10-1287-msom-2023-1187",
  "doi-10-1287-mnsc-2016-2425",
  "doi-10-1287-mnsc-2017-2752",
  "doi-10-1287-mnsc-2019-3306",
  "doi-10-1287-mnsc-2019-3417",
  "doi-10-1287-mnsc-2023-03895",
  "doi-10-1287-mnsc-2023-03914",
  "doi-10-1287-msom-2024-1332",
  "doi-10-1287-isre-2017-0766",
  "doi-10-1287-isre-2019-0898",
  "doi-10-1287-msom-2022-0230",
  "doi-10-1287-msom-2023-0398",
  "doi-10-1287-msom-2018-0705",
  "doi-10-1287-msom-2021-1037"
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

function mergeConcepts(miniConcepts) {
  const concepts = new Map();
  for (const concept of [...miniConcepts, ...ADDITIONAL_CONCEPTS]) {
    const target = concepts.get(concept.id) || {
      id: concept.id,
      label: concept.label,
      aliases: [],
      related: []
    };
    target.aliases = [...new Set([
      target.label,
      ...(target.aliases || []),
      ...(concept.aliases || [])
    ].map(cleanText).filter(Boolean))];
    target.related = [...new Set([...(target.related || []), ...(concept.related || [])])];
    concepts.set(concept.id, target);
  }
  return [...concepts.values()];
}

const [catalog, mini] = await Promise.all([
  readJson(path.join(ROOT, "data", "atlas_articles.json")),
  readJson(path.join(ROOT, "mini-atlas", "data", "atlas.json"))
]);
const records = new Map((catalog.records || []).map((record) => [record.id, record]));
const concepts = mergeConcepts(mini.concepts || []);

async function buildPaper(id) {
  const record = records.get(id);
  assert.ok(record, `${id}: catalog record is missing`);
  const ledger = await readJson(path.join(ROOT, "research", "ledger", "papers", `${id}.json`));
  const extraction = ledger?.stages?.extraction;
  assert.equal(extraction?.status, "complete", `${id}: extraction is not complete`);
  const pagesText = await readFile(path.resolve(ROOT, extraction.artifacts.pages), "utf8");
  assert.equal(sha256(pagesText), extraction.artifacts.pagesSha256, `${id}: extraction artifact is stale`);
  return buildAuthoredNote(record, JSON.parse(pagesText), concepts);
}

function components(note) {
  return (note.models || []).flatMap((model) => model.components || []);
}

test("a conditional success-and-replacement rule is a process predicate, not a generic result", () => {
  assert.equal(sourceSupportsRole(
    "process",
    "The firm develops the candidate with probability x, and if it succeeds, the new product replaces the existing product."
  ), true);
  assert.equal(sourceSupportsRole(
    "process",
    "If demand is high, the firm's equilibrium profit increases."
  ), false);
});

test("explicit licensing terms establish a contractual interaction predicate", () => {
  assert.equal(sourceSupportsRole(
    "interaction",
    "We assume that the manufacturing license involves only a fixed up-front licensing fee."
  ), true);
  assert.equal(sourceSupportsRole(
    "interaction",
    "The software license expires at the end of the year."
  ), false);
});

test("plural dynamics is accepted as a literal process predicate", () => {
  assert.equal(sourceSupportsRole(
    "process",
    "The primary difference is the impact of the hospital quality concern variable on incentive dynamics for bundling."
  ), true);
  assert.equal(sourceSupportsRole(
    "process",
    "Vaccination is modeled to proceed at time-dependent rates for the full-dose and fractional-dose vaccines."
  ), true);
});

test("plural profit language is accepted as a literal objective predicate", () => {
  assert.equal(sourceSupportsRole(
    "objective",
    "The advertisers’ expected profits are zero."
  ), true);
});

test("explicitly removed benchmark mechanisms are modeled as literal constraints", () => {
  assert.equal(sourceSupportsRole(
    "constraint",
    "First, we consider the situation where the referral rewards R are exogenously set to be equal to 0."
  ), true);
  assert.equal(sourceSupportsRole(
    "constraint",
    "Second, we consider a model in which the seller is restricted to offer only one contract to the receiver."
  ), true);
});

test("waiting time and plural decisions support their literal state and decision roles", () => {
  assert.equal(sourceSupportsRole(
    "state",
    "Let the virtual waiting time at time t be denoted by W(t)."
  ), true);
  assert.equal(sourceSupportsRole(
    "decision",
    "We define a business model as a collection of business decisions from technology development to licensing to manufacturing."
  ), true);
  assert.equal(sourceSupportsRole(
    "process",
    "The acquisition rate benefits from word of mouth, measured by the imitation coefficient times the percentage of subscribers."
  ), true);
  assert.equal(sourceSupportsRole(
    "information",
    "Demand is uncertain before its realization is observed."
  ), true);
  assert.equal(sourceSupportsRole(
    "information",
    "A random vector is a measurable mapping from the sample space."
  ), true);
});

test("role-specific source predicates recover conditioned components from generic model headings", async () => {
  const results = await Promise.allSettled(PAPER_IDS.map(buildPaper));
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [`${PAPER_IDS[index]}: ${result.reason?.message || result.reason}`]
    : []);
  assert.deepEqual(failures, []);

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    assert.ok(components(result.value).some((component) =>
      (component.conditions || []).length > 0
      && (component.conceptBindings || []).some((binding) => binding.status === "modeled"
        && (binding.conditionRefs || []).length > 0
        && (binding.sourceRefs || []).length > 0)),
    `${result.value.id}: no conditioned, source-grounded concept binding survived`);
  }
});

test("the word-of-mouth paper retains its two benchmark restrictions and full model", async () => {
  const note = await buildPaper("doi-10-1287-mnsc-2019-3417");
  assert.deepEqual(note.models.map((model) => model.name), [
    "The Full Model",
    "Benchmark Without Referral Reward",
    "Benchmark Without a Free Contract"
  ]);
  assert.equal(note.models.some((model) => /comparative statics/i.test(model.name)), false);

  const fullModel = note.models[0];
  assert.equal(
    fullModel.method,
    "The paper characterizes the optimal scheme for the full model using these two values."
  );
  assert.ok(fullModel.components.some((component) => component.label === "Model"
    && (component.sources || []).some((source) => /(?:seller offers a scheme|sender decides whether or not to talk to the receiver)/i.test(cleanText(source?.quote))
      && sourceSupportsRole(component.role, source?.quote))
    && component.conceptBindings.some((binding) => binding.status === "modeled"
      && (binding.conditionRefs || []).length > 0
      && (binding.sourceRefs || []).length > 0)),
  "word-of-mouth paper: the foundational Model primitive is missing from the full model");

  const benchmarkExpectations = [
    ["Benchmark Without Referral Reward", /referral rewards R are exogenously set to be equal to 0/i],
    ["Benchmark Without a Free Contract", /seller is restricted to offer only one contract/i]
  ];
  for (const [name, sourcePattern] of benchmarkExpectations) {
    const model = note.models.find((candidate) => candidate.name === name);
    assert.ok(model, `${name}: model is missing`);
    assert.ok(model.method && model.methodEvidence, `${name}: source-grounded method is missing`);
    assert.ok((model.assumptions || []).some((condition) => sourcePattern.test(cleanText(condition))),
      `${name}: local setup restriction is missing`);
    assert.ok((model.setupEvidence?.assumptions || []).some((entry) =>
      sourcePattern.test(cleanText(entry?.source?.quote))
        && cleanText(entry?.source?.section) === name),
    `${name}: local setup evidence is missing`);
    assert.ok((model.components || []).some((component) =>
      component.label === name
        && component.role === "constraint"
        && sourcePattern.test(cleanText(component.sources?.[0]?.quote))
        && component.conceptBindings.some((binding) => binding.status === "modeled"
          && (binding.conditionRefs || []).length > 0
          && (binding.sourceRefs || []).length > 0)),
    `${name}: locally bound restriction component is missing`);
    assert.equal((model.components || []).some((component) =>
      /substituting and complementing/i.test(component.label)), false,
    `${name}: downstream comparative analysis was incorrectly attached`);
  }

  const retained = components(note);
  assert.equal(retained.some((component) => (component.sources || []).some((source) =>
    /^We present a simple model using a specific functional form/i.test(cleanText(source?.quote)))), false);
  assert.ok(retained.some((component) => sourceSupportsRole(component.role, component.sources?.[0]?.quote)
    && component.conceptBindings.some((binding) => binding.status === "modeled"
      && (binding.conditionRefs || []).length > 0
      && (binding.sourceRefs || []).length > 0)));
});

test("the recovered papers retain their stochastic transition and licensing-timing anchors", async () => {
  const [preannouncement, licensing] = await Promise.all(PAPER_IDS.slice(0, 2).map(buildPaper));
  const productTransition = components(preannouncement).find((component) =>
    /if it succeeds.+new product will replace the firm.s existing product/i
      .test(cleanText(component.sources?.[0]?.quote)));
  assert.ok(productTransition, "preannouncement model: the stochastic product-transition anchor is missing");
  assert.equal(productTransition.role, "process");
  assert.ok(productTransition.conceptBindings.some((binding) =>
    binding.conceptId === "process-dynamics" && binding.status === "modeled"));

  const confidentialTiming = components(licensing).find((component) =>
    /technology supplier decides the design license/i.test(cleanText(component.sources?.[0]?.quote))
      && /manufacturer decides the wholesale price/i.test(cleanText(component.sources?.[0]?.quote)));
  assert.ok(confidentialTiming, "licensing model: the confidential-license decision sequence is missing");
  assert.equal(confidentialTiming.role, "interaction");
  assert.ok(confidentialTiming.conceptBindings.some((binding) => binding.status === "modeled"));
});

test("parameter settings and process dynamics retain condition-backed concept bindings", async () => {
  const [droneNetwork, bundledPayment] = await Promise.all(PAPER_IDS.slice(2, 4).map(buildPaper));
  const parameterSetting = components(droneNetwork).find((component) =>
    /acceleration\/deceleration was set to/i.test(cleanText(component.sources?.[0]?.quote)));
  assert.ok(parameterSetting, "drone-network model: the literal parameter-setting anchor is missing");
  assert.ok(parameterSetting.conditions.some((condition) =>
    /acceleration\/deceleration was set to/i.test(cleanText(condition))));
  assert.ok(parameterSetting.conceptBindings.some((binding) => binding.status === "modeled"
    && (binding.conditionRefs || []).length > 0
    && (binding.sourceRefs || []).length > 0));

  const incentiveDynamics = components(bundledPayment).find((component) =>
    /impact of wq.+incentive dynamics for bundling/i.test(cleanText(component.sources?.[0]?.quote)));
  assert.ok(incentiveDynamics, "bundled-payment model: the literal incentive-dynamics anchor is missing");
  assert.equal(incentiveDynamics.role, "process");
  assert.ok(incentiveDynamics.conceptBindings.some((binding) =>
    binding.conceptId === "process-dynamics"
      && binding.status === "modeled"
      && (binding.conditionRefs || []).length > 0
      && (binding.sourceRefs || []).length > 0));
});

test("the fractional-dose vaccine paper retains dynamics, objective, and constraint components", async () => {
  const note = await buildPaper("doi-10-1287-msom-2024-1332");
  assert.equal(note.models.length, 1);
  const retained = components(note);
  assert.equal(retained.length, 3);
  assert.deepEqual(retained.map((component) => component.label).sort(), [
    "Epidemic Dynamics with Vaccinations",
    "Optimization Model",
    "Vaccination Constraints"
  ].sort());
  assert.deepEqual(Object.fromEntries(retained.map((component) => [component.label, component.role])), {
    "Vaccination Constraints": "constraint",
    "Optimization Model": "objective",
    "Epidemic Dynamics with Vaccinations": "process"
  });

  const expectations = [
    ["Epidemic Dynamics with Vaccinations", /tracks the cumulative amount of antigen used by time t/i],
    ["Optimization Model", /our goal is to derive a feasible vaccination policy.+minimizes the total number of infections/i],
    ["Vaccination Constraints", /constraint is a cap on the total antigen stockpile/i]
  ];
  for (const [label, sourcePattern] of expectations) {
    const component = retained.find((candidate) => candidate.label === label);
    assert.ok(component, `${label}: component is missing`);
    assert.ok(sourcePattern.test(cleanText(component.sources?.[0]?.quote)), `${label}: local source anchor is wrong`);
    assert.ok(component.conditions.length > 0, `${label}: no local condition survived`);
    assert.ok(component.conceptBindings.some((binding) => binding.status === "modeled"
      && (binding.conditionRefs || []).length > 0
      && (binding.sourceRefs || []).some((reference) => reference.scope === "component" && reference.index === 0)),
    `${label}: no condition-backed local binding survived`);
  }

  const optimization = retained.find((component) => component.label === "Optimization Model");
  assert.ok(optimization.conceptBindings.some((binding) => binding.conceptId === "optimization"
    && binding.status === "modeled"
    && (binding.sourceRefs || []).some((reference) => reference.scope === "component" && reference.index === 0)));
  assert.equal(/known and deterministic/i.test(cleanText(optimization.sources?.[0]?.quote)), false);
  assert.ok(optimization.conditions.some((condition) => /vaccine efficacies are known and deterministic/i.test(cleanText(condition))));
  assert.equal(optimization.conditions.some((condition) => /our goal|minimizes the total number of infections/i.test(cleanText(condition))), false);
  assert.equal(retained.some((component) => (component.conditions || []).some((condition) =>
    /anti\s+gen|repre\s+sented|progres\s+sively|1\s*<\s*E\s*<|literature suggests|Optimal Control Problem.+Our goal|Vaccination Constraints Our goal/i.test(cleanText(condition)))), false);
});

test("combinatorial exchange and data-hiding papers retain their printed formulation sections", async () => {
  const [exchange, hiding] = await Promise.all([
    buildPaper("doi-10-1287-isre-2017-0766"),
    buildPaper("doi-10-1287-isre-2019-0898")
  ]);
  const exchangeComponents = components(exchange);
  assert.ok(exchangeComponents.some((component) => component.label === "The allocation rule"
    && component.role === "decision"
    && (component.sources || []).some((source) =>
      /(?:sealed-bid auction.+allocation and prices are computed|auctioneer cannot assign more shares)/i.test(cleanText(source?.quote))
        && sourceSupportsRole(component.role, source?.quote))
    && component.conditions?.length
    && component.conceptBindings?.some((binding) => binding.status === "modeled"
      && binding.conditionRefs?.length && binding.sourceRefs?.length)));
  assert.ok(exchangeComponents.some((component) => component.label === "The Winner Determination Problem"
    && component.role === "objective"
    && component.sources?.length
    && component.conceptBindings?.some((binding) => binding.status === "modeled"
      && binding.sourceRefs?.some((reference) => reference.scope === "component"))));

  const hidingComponents = components(hiding);
  assert.deepEqual(hidingComponents.map((component) => component.label), [
    "Definitions and Problem Formulation",
    "Integer Programming Formulation",
    "The Ensemble Approach"
  ]);
  const definitions = hidingComponents[0];
  assert.equal(definitions.role, "information");
  assert.match(cleanText(definitions.sources?.[0]?.quote), /(?:defined|denoted|set of items|transaction)/i);
  assert.equal(definitions.conditions.some((condition) => /^Notation and Definitions\b/i.test(cleanText(condition))), false);
});

test("classifier headings and practical nurse-pool structures survive as clean source-local components", async () => {
  const [classifier, staffing] = await Promise.all([
    buildPaper("doi-10-1287-msom-2022-0230"),
    buildPaper("doi-10-1287-msom-2023-0398")
  ]);
  const classifierComponents = components(classifier);
  assert.ok(classifierComponents.some((component) =>
    component.label === "The ε-Distributionally Robust Fairness Aware Classifier"));
  assert.equal(classifierComponents.some((component) => /[«»]/u.test(component.label)), false);
  assert.equal(classifierComponents.some((component) => /completes? the proof/i.test(cleanText(component.sources?.[0]?.quote))), false);
  assert.equal(classifierComponents.some((component) => (component.conditions || []).some((condition) =>
    /well known in the machine learning literature/i.test(cleanText(condition)))), false);

  const staffingModels = new Map(staffing.models.map((model) => [model.name, model]));
  for (const label of ["One Pool", "Disjoint Pools", "Chained Pools"]) {
    assert.deepEqual((staffingModels.get(label)?.components || []).map((component) => component.label), [label]);
  }
  assert.ok(components(staffing).some((component) => component.label === "Distributionally Robust Nurse Staffing"));
  for (const label of ["One Pool", "Disjoint Pools", "Chained Pools"]) {
    const component = components(staffing).find((candidate) => candidate.label === label);
    assert.equal(component?.role, "constraint", `${label}: wrong role`);
    assert.ok(component?.conditions?.length, `${label}: no local structural condition`);
    assert.ok(component?.conceptBindings?.some((binding) => binding.status === "modeled"
      && binding.conditionRefs?.length && binding.sourceRefs?.length), `${label}: incomplete local binding`);
  }
});

test("timing and supply-network variants retain unique source-section ownership", async () => {
  const [timing, flexibility] = await Promise.all([
    buildPaper("doi-10-1287-msom-2018-0705"),
    buildPaper("doi-10-1287-msom-2021-1037")
  ]);

  assert.deepEqual(timing.models.map((model) => model.name), ["Sequential Model", "Simultaneous Model"]);
  const sequentialLabels = timing.models[0].components.map((component) => component.label);
  const simultaneousLabels = timing.models[1].components.map((component) => component.label);
  assert.equal(sequentialLabels.some((label) => /review of previous papers/i.test(label)), false);
  assert.equal(sequentialLabels.some((label) => /simultaneous/i.test(label)), false);
  assert.ok(simultaneousLabels.includes("Two-Period Simultaneous Model with Direct Channel Only"));
  assert.equal(components(timing).filter((component) =>
    component.label === "Two-Period Simultaneous Model with Direct Channel Only").length, 1);

  assert.deepEqual(flexibility.models.map((model) => model.name), [
    "Dedicated Supply Network (dd)",
    "Flexible Primary Network (fd)",
    "Flexible Backup Network (df)",
    "Fully Flexible Network (ff)"
  ]);
  const ownership = new Map(flexibility.models.map((model) => [
    model.name,
    model.components.map((component) => component.label)
  ]));
  assert.ok(ownership.get("Dedicated Supply Network (dd)").includes("Dedicated Supply Network"));
  assert.ok(ownership.get("Dedicated Supply Network (dd)").includes("Model"));
  const sharedSetup = components(flexibility).filter((component) => component.label === "Model");
  assert.equal(sharedSetup.length, 1);
  assert.equal(sharedSetup[0].role, "state");
  assert.ok(sharedSetup[0].sources?.some((source) => cleanText(source.section) === "3. Model"
    && /make-to-stock.+make-\s*to-order/i.test(cleanText(source.quote))
    && sourceSupportsRole(sharedSetup[0].role, source.quote)));
  assert.ok(sharedSetup[0].conceptBindings?.some((binding) => binding.status === "modeled"
    && binding.conditionRefs?.length && binding.sourceRefs?.length));
  assert.ok(ownership.get("Flexible Primary Network (fd)").includes("Flexible Primary Network vs. Dedicated Supply Network"));
  assert.ok(ownership.get("Fully Flexible Network (ff)").includes("Fully Flexible Network vs. Flexible Backup Network"));
  assert.equal(components(flexibility).filter((component) =>
    component.label === "Flexible Primary Network vs. Dedicated Supply Network").length, 1);
  assert.equal(components(flexibility).filter((component) =>
    component.label === "Fully Flexible Network vs. Flexible Backup Network").length, 1);
});

test("distinct source sections survive variant splitting and evidence deduplication", async () => {
  const expectations = [
    ["doi-10-1287-mnsc-2022-01108", "Lagrangian Relaxation"],
    ["doi-10-1287-mnsc-2022-02947", "Problem Formulation"],
    ["doi-10-1287-mnsc-2023-01322", "A More Sophisticated Algorithm: NC-SAA"],
    ["doi-10-1287-mnsc-2023-01552", "Model Estimation and Empirical Comparison"],
    ["doi-10-1287-mnsc-2023-01726", "Approximating the Placement"],
    ["doi-10-1287-mnsc-2023-4939", "Incentive Feasible Contracts"]
  ];
  for (const [id, label] of expectations) {
    const note = await buildPaper(id);
    const retained = components(note).find((component) => component.label === label);
    assert.ok(retained, `${id}: ${label} was omitted`);
    assert.ok(retained.sources?.length, `${id}: ${label} has no source anchor`);
    assert.ok(retained.conditions?.length, `${id}: ${label} has no applicable condition`);
    assert.ok(retained.conceptBindings?.some((binding) => binding.status === "modeled"
      && binding.conditionRefs?.length && binding.sourceRefs?.length),
    `${id}: ${label} has no complete modeled binding`);
  }

  const ncSaa = await buildPaper("doi-10-1287-mnsc-2023-01322");
  const owner = ncSaa.models.find((model) => model.components?.some((component) =>
    component.label === "A More Sophisticated Algorithm: NC-SAA"));
  assert.match(owner?.name || "", /NC-SAA/i);
});
