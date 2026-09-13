import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADDITIONAL_CONCEPTS,
  buildAuthoredNote,
  cleanText,
  extractSections,
  roleQualifiedComponentLabel,
  sectionComponent
} from "../scripts/model-note-authoring.mjs";
import {
  headingLabelRejectionReason,
  validateModelNoteSemantics
} from "../scripts/model-note-semantic-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAPER_IDS = [
  "doi-10-1287-isre-2017-0722",
  "doi-10-1287-isre-2020-0970",
  "doi-10-1287-isre-2017-0742",
  "doi-10-1287-isre-2025-2160",
  "doi-10-1287-mnsc-2015-2230",
  "doi-10-1287-isre-2024-1097"
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
    const existing = concepts.get(concept.id);
    if (existing && cleanText(existing.label) !== cleanText(concept.label)) {
      throw new Error(`Concept label conflict: ${concept.id}`);
    }
    const target = existing || { id: concept.id, label: concept.label, aliases: [], related: [] };
    target.aliases = [...new Set([
      target.label,
      ...(target.aliases || []),
      ...(concept.aliases || [])
    ].map(cleanText).filter(Boolean))];
    target.related = [...new Set([...(target.related || []), ...(concept.related || [])])];
    concepts.set(concept.id, target);
  }
  for (const concept of concepts.values()) {
    concept.related = concept.related.filter((id) => concepts.has(id) && id !== concept.id);
  }
  return [...concepts.values()].sort((left, right) => left.label.localeCompare(right.label));
}

const [catalog, mini] = await Promise.all([
  readJson(path.join(ROOT, "data", "atlas_articles.json")),
  readJson(path.join(ROOT, "mini-atlas", "data", "atlas.json"))
]);
const records = new Map((catalog.records || []).map((record) => [record.id, record]));
const concepts = mergeConcepts(mini.concepts || []);

async function loadFixture(id) {
  const record = records.get(id);
  assert.ok(record, `${id}: catalog record is missing`);
  const ledger = await readJson(path.join(ROOT, "research", "ledger", "papers", `${id}.json`));
  const extraction = ledger?.stages?.extraction;
  assert.equal(extraction?.status, "complete", `${id}: extraction is not complete`);
  const pagesText = await readFile(path.resolve(ROOT, extraction.artifacts.pages), "utf8");
  assert.equal(sha256(pagesText), extraction.artifacts.pagesSha256, `${id}: extraction artifact is stale`);
  const pagesPayload = JSON.parse(pagesText);
  const pages = pagesPayload.pages || pagesPayload;
  const note = buildAuthoredNote(record, pagesPayload, concepts);
  note.provenance.extractionQaStatus = ledger.stages?.extractQa?.status || "unknown";
  return { record, pages, note };
}

const fixturesPromise = Promise.all(PAPER_IDS.map(async (id) => [id, await loadFixture(id)]));

async function fixture(id) {
  return new Map(await fixturesPromise).get(id);
}

function components(note) {
  return (note.models || []).flatMap((model) => model.components || []);
}

test("first-batch authoring regressions build with no semantic errors", async () => {
  for (const [id, built] of await fixturesPromise) {
    const result = validateModelNoteSemantics(built.note, {
      authoringMode: "source-mapped",
      pages: built.pages,
      concepts
    });
    assert.deepEqual(result.errors, [], `${id}: ${JSON.stringify(result.errors)}`);
  }
});

test("algorithm table headers are not fused into printed algorithm section names", async () => {
  const built = await fixture("doi-10-1287-isre-2017-0722");
  const section = extractSections(built.pages).find((candidate) => candidate.title === "Algorithm 2");
  assert.ok(section, "software-allocation paper: Algorithm 2 section is missing");
  const component = sectionComponent(section, built.pages, built.record, concepts, new Set());
  assert.ok(component, "software-allocation paper: Algorithm 2 component is missing");
  assert.equal(component.label, "Algorithm 2");
  assert.equal(component.sources[0].section, "Algorithm 2");
  assert.equal(components(built.note).some((candidate) => /Algorithm 2 Step/i.test(candidate.label)), false);
});

test("an eponymous source section receives a local role-qualified component label", () => {
  const paperTitle = "Discrete Choice via Sequential Search";
  assert.equal(
    roleQualifiedComponentLabel(paperTitle, paperTitle, "estimation"),
    "Discrete Choice via Sequential Search: Estimation"
  );
  assert.equal(
    roleQualifiedComponentLabel("Model Estimation", paperTitle, "estimation"),
    "Model Estimation"
  );
  assert.equal(headingLabelRejectionReason(
    roleQualifiedComponentLabel(paperTitle, paperTitle, "estimation")
  ), "");
});

test("deduplication retains more than eight distinct source-grounded baseline components", async () => {
  const { note } = await fixture("doi-10-1287-isre-2020-0970");
  const baseline = note.models.find((model) => model.kind === "baseline") || note.models[0];
  assert.ok(baseline.components.length > 8, "intermediary-network baseline was truncated to eight components");
  assert.equal(new Set(baseline.components.map((component) => component.id)).size, baseline.components.length);
  assert.ok(baseline.components.some((component) =>
    component.label === "Price of Anarchy: Refined Lower Bound"
      && /network structure on welfare/i.test(cleanText(component.sources?.[0]?.quote))),
  "intermediary-network paper: the selected refined lower-bound component is missing");
});

test("plural source assumptions and a printed numeric regime heading recover both auction components", async () => {
  const { note } = await fixture("doi-10-1287-isre-2017-0742");
  const retained = components(note);
  assert.deepEqual(retained.map((component) => component.label), [
    "Model Setup",
    "Global Auction",
    "Integrating Global and Local Auctions, M > 2"
  ]);

  const global = retained.find((component) => component.label === "Global Auction");
  assert.ok(global.conditions.some((condition) => /by our assumptions on hot spot cost structure/i.test(condition)));
  assert.ok(global.symbols.some((symbol) => symbol.symbol === "q_{i}^{**}"));
  assert.ok(global.conceptBindings.some((binding) => binding.status === "modeled"
    && binding.conditionRefs?.length && binding.sourceRefs?.length));

  const integrated = retained.find((component) => component.label === "Integrating Global and Local Auctions, M > 2");
  assert.equal(integrated.role, "algorithm");
  assert.equal(integrated.sources[0].section, "3.4. Integrating Global and Local Auctions, M > 2");
  assert.match(cleanText(integrated.sources[0].quote), /irreversible shrinking of Rg.+algorithm complexity/i);
});

test("bid morphology does not discard the paper's equilibrium-strategy component", async () => {
  const { note } = await fixture("doi-10-1287-isre-2025-2160");
  const equilibrium = components(note).find((component) => component.label === "Equilibrium Strategies");
  assert.ok(equilibrium, "auction-learning paper: Equilibrium Strategies component is missing");
  assert.equal(equilibrium.role, "interaction");
  assert.deepEqual(equilibrium.sources[0], {
    page: 12,
    section: "3. Equilibrium Strategies",
    equation: "",
    quote: "We now formalize the equilibrium problem for the different bidder utility models introduced in Section 2.1."
  });
  assert.ok(equilibrium.conditions.some((condition) =>
    /bidding policy layer of a demand-?side platform \(DSP\).+impression-level value estimates.+primitives/i.test(cleanText(condition))),
  "auction-learning paper: the local DSP bidding-policy condition is missing");
  assert.ok(equilibrium.conceptBindings.some((binding) => binding.status === "modeled"
    && binding.conditionRefs?.length && binding.sourceRefs?.length),
  "auction-learning paper: Equilibrium Strategies has no complete modeled binding");
});

test("an equation-adjacent alternative demand declaration remains a separate source-grounded model", async () => {
  const { note } = await fixture("doi-10-1287-mnsc-2015-2230");
  const baseline = note.models.find((model) => model.kind === "baseline");
  const alternative = note.models.find((model) => model.name === "Analysis with Alternative Demand Function");

  assert.ok(baseline, "agency-selling paper: baseline model is missing");
  assert.ok(alternative, "agency-selling paper: alternative demand model is missing");
  assert.equal(alternative.kind, "alternative");
  assert.deepEqual(alternative.relationships, [{
    type: "alternativeTo",
    targetModelId: baseline.id
  }]);
  assert.ok(alternative.inputs.some((value) => /^A demand system$/i.test(value)));
  assert.equal(alternative.inputs.some((value) => /linear demand system/i.test(value)), false);

  const component = alternative.components.find((item) => item.label === "Analysis with Alternative Demand Function");
  assert.ok(component, "agency-selling paper: alternative-demand component is missing");
  assert.equal(component.role, "preference");
  assert.equal(component.sources[0].page, 20);
  assert.equal(
    cleanText(component.sources[0].quote),
    "we consider a demand system frequently used in the literature (e.g., Raju et al. 1995)"
  );
  assert.doesNotMatch(component.explanation, /agency fee charged in equilibrium/i);
  assert.ok(component.conditions.some((value) => cleanText(value)
    === "We continue to use the same timing of the game as presented in §3."));
  assert.equal(component.formalKind, "Atlas restatement of source rule");
  assert.deepEqual(component.symbols, []);
  assert.ok(component.conceptBindings.some((binding) => binding.status === "modeled"
    && binding.conditionRefs?.length && binding.sourceRefs?.length));
  assert.doesNotMatch(JSON.stringify(component), /[\u0000-\u001f\u007f-\u009f]|(?<!\\)\$/u);
});

test("the substitute-goods extension stays page-local and uses a clean preference-regime statement", async () => {
  const { note } = await fixture("doi-10-1287-isre-2020-0970");
  const baseline = note.models.find((model) => model.kind === "baseline");
  const extension = note.models.find((model) => model.name === "Extension for Substitute Goods");

  assert.ok(baseline, "intermediary-networks paper: baseline model is missing");
  assert.ok(extension, "intermediary-networks paper: substitute-goods extension is missing");
  assert.equal(extension.kind, "extension");
  assert.deepEqual(extension.relationships, [{
    type: "extends",
    targetModelId: baseline.id
  }]);
  assert.equal(extension.summary, "This extension models the goods as substitutes.");
  assert.ok(extension.assumptions.includes(
    "In this section, we consider the case where the goods are a substitute."
  ));

  const component = extension.components.find((item) => item.label === "Extension for Substitute Goods");
  assert.ok(component, "intermediary-networks paper: preference component is missing");
  assert.equal(component.role, "preference");
  assert.deepEqual(component.sources[0], {
    page: 13,
    section: "7. Extension for Substitute Goods",
    equation: "",
    quote: "In this section, we consider the case where the goods are a substitute."
  });
  assert.deepEqual(component.conditions, [
    "In this section, we consider the case where the goods are a substitute."
  ]);
  assert.deepEqual(component.symbols, []);
  assert.ok(component.conceptBindings.some((binding) => binding.status === "modeled"
    && binding.conditionRefs?.length && binding.sourceRefs?.length));
  assert.doesNotMatch(JSON.stringify(component), /[\u0000-\u001f\u007f-\u009f]|(?<!\\)\$|\\(?:lambda|alpha|beta|gamma|tau)\b/u);
});

test("the hypergraph paper retains its full random-walk construction without setup false positives", async () => {
  const { note } = await fixture("doi-10-1287-isre-2024-1097");
  const baseline = note.models.find((model) => model.kind === "baseline") || note.models[0];
  assert.ok(baseline.decisions.includes("Select a hyperedge according to ES"));
  assert.ok(baseline.decisions.includes("Select a new node according to NS"));
  assert.equal(baseline.decisions.some((value) => /open[- ]source.*package|close proximity/i.test(value)), false);

  const expected = new Map([
    ["Random-walks on Hypergraphs", ["process", 6]],
    ["Defining Hypergraphs", ["information", 6]],
    ["Designing Random-walks on Hypergraphs", ["process", 7]],
    ["Designing Random-walks on Graphs", ["process", 8]],
    ["Simulating Random-walks", ["algorithm", 8]],
    ["Theory-Informed Diffusion Processes and Information Centrality", ["process", 8]],
    ["Theory-Informed Micro-Level NS Processes", ["process", 9]],
    ["Theory-Informed Meso-Level ES Processes", ["process", 9]]
  ]);
  const retained = new Map(baseline.components.map((component) => [component.label, component]));
  for (const [label, [role, page]] of expected) {
    const component = retained.get(label);
    assert.ok(component, `hypergraph paper: ${label} is missing`);
    assert.equal(component.role, role, `${label}: wrong component role`);
    assert.equal(component.sources[0].page, page, `${label}: wrong source page`);
    assert.ok(component.conditions.length, `${label}: no local condition survived`);
    assert.ok(component.conceptBindings.some((binding) => binding.status === "modeled"
      && binding.conditionRefs?.length && binding.sourceRefs?.length),
    `${label}: no complete modeled binding survived`);
  }

  const requiredPayload = JSON.stringify([...expected.keys()].map((label) => retained.get(label)));
  assert.doesNotMatch(requiredPayload, /[\u0000-\u001f\u007f-\u009f]|(?<!\\)\$|\\(?:lambda|alpha|beta|gamma|tau)\b/u);
  assert.doesNotMatch(requiredPayload, /\b(?:repre\s+senting|enti\s+ties|probabil\s+ity|cur\s+rent|effi\s+ciency|simu\s+lating)\b/i);
});

test("only a title-like trailing scalar regime bypasses equation-fragment heading rejection", () => {
  assert.equal(headingLabelRejectionReason("Integrating Global and Local Auctions, M > 2"), "");
  for (const rejected of [
    "M > 2",
    "Global Auction M > 2",
    "Global Auction, x > 2",
    "Global Auction, M + N > 2"
  ]) {
    assert.equal(headingLabelRejectionReason(rejected), "an equation fragment rather than a heading", rejected);
  }
});
