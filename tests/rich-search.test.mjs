import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const atlas = require("../assets/explorer.js");
const [mainPayload, modelNotes] = await Promise.all([
  readFile(path.join(root, "data", "atlas_articles.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "model_notes.json"), "utf8").then(JSON.parse)
]);
const searchIndex = atlas.createSearchIndex(mainPayload.records, modelNotes);
const mappedIds = new Map(modelNotes.papers.map((paper) => [paper.referenceFixtureId, paper.id]));

function componentFor(result, target) {
  const model = result.note.models.find((entry) => entry.id === target.modelId);
  assert.ok(model, `${target.modelId}: target model exists`);
  const component = model.components.find((entry) => entry.id === target.componentId);
  assert.ok(component, `${target.componentId}: target component exists`);
  return component;
}

function assertQualitativeLabel(hit) {
  assert.equal(typeof hit.relevance, "string");
  assert.ok(hit.relevance.trim(), "a relevance label is present");
  assert.doesNotMatch(hit.relevance, /^\s*#?\d+(?:\.\d+)?%?\s*$/, "the relevance label is qualitative");
}

test("a strategic-consumers typo leads to P016 and exposes all of its mapped component hits", () => {
  const output = searchIndex.search("startegic consumers");
  assert.deepEqual(output.corrections, [{ from: "startegic", to: "strategic" }]);
  const position = output.results.findIndex((entry) => entry.paper.id === mappedIds.get("P016"));
  assert.ok(position >= 0 && position < 10, "P016 remains near the top when equally direct full-corpus matches are present");
  const result = output.results[position];
  assert.equal(result.paper.id, mappedIds.get("P016"));
  assert.equal(result.note.referenceFixtureId, "P016");
  assert.equal(result.bestHit.target.kind, "structured");
  assert.equal(result.bestHit.target.section, "component");
  assert.ok(["concept", "searchPhrases"].includes(result.bestHit.field));
  assert.ok(result.hits.some((hit) => hit.target.modelId === "baseline" && hit.target.componentId === "waiting-choice"));
  assert.ok(result.hits.some((hit) => hit.target.modelId === "baseline" && hit.target.componentId === "responsive-pricing"));
  assertQualitativeLabel(result.bestHit);
});

test("P018 distinguishes a modeled budget constraint from an excluded effort contest", () => {
  const cases = [
    {
      query: "budget constraints",
      componentId: "budgeted-choice",
      conceptId: "budget-constraints",
      status: "modeled",
      relevance: "Direct concept match"
    },
    {
      query: "endogenous effort contest",
      componentId: "winning-matrix",
      conceptId: "endogenous-effort-contest",
      status: "explicitlyExcluded",
      relevance: "Scoped concept contrast"
    }
  ];

  for (const expected of cases) {
    const result = searchIndex.search(expected.query).results.find((entry) => entry.paper.id === mappedIds.get("P018"));
    assert.ok(result, `${expected.query}: P018 remains discoverable`);
    assert.equal(result.paper.id, mappedIds.get("P018"), expected.query);
    assert.equal(result.note.referenceFixtureId, "P018", expected.query);
    assert.equal(result.bestHit.target.modelId, "version-tournament-design", expected.query);
    assert.equal(result.bestHit.target.componentId, expected.componentId, expected.query);
    assert.equal(result.bestHit.target.conceptId, expected.conceptId, expected.query);
    assert.equal(result.bestHit.relevance, expected.relevance, expected.query);
    assertQualitativeLabel(result.bestHit);

    const component = componentFor(result, result.bestHit.target);
    const binding = component.conceptBindings[result.bestHit.target.bindingIndex];
    assert.equal(binding.conceptId, expected.conceptId, `${expected.query}: binding identity`);
    assert.equal(binding.status, expected.status, `${expected.query}: local applicability`);
    for (const key of ["applicability", "status"]) {
      if (Object.hasOwn(result.bestHit, key)) {
        assert.equal(result.bestHit[key], expected.status, `${expected.query}: exposed ${key}`);
      }
    }
  }
});

test("maximum-principle search retains P017's method target without borrowing a component", () => {
  const output = searchIndex.search("maximum principle");
  const position = output.results.findIndex((result) => result.paper.id === mappedIds.get("P017"));
  assert.ok(position >= 0 && position < 10, "P017 remains near the top of the expanded full-corpus result set");
  const result = output.results[position];
  assert.equal(result.note.referenceFixtureId, "P017");
  assert.equal(result.bestHit.field, "modelMethod");
  assert.equal(result.bestHit.target.kind, "structured");
  assert.equal(result.bestHit.target.modelId, "physician-fluid-control");
  assert.equal(result.bestHit.target.section, "method");
  assert.equal(Object.hasOwn(result.bestHit.target, "componentId"), false, "a model-level hit does not illuminate an arbitrary component");
  assert.equal(result.bestHit.relevance, "Method match");
  assertQualitativeLabel(result.bestHit);
  assert.ok(result.hits.every((hit) => hit.target.modelId === "physician-fluid-control"));
});

test("relevance labels remain qualitative while numeric order is derived per search", () => {
  const before = JSON.stringify(modelNotes);
  const first = searchIndex.search("budget constraints");
  assert.ok(first.results.length > 1);
  first.results.forEach((result, index) => {
    assert.equal(result.rank, index + 1);
    assertQualitativeLabel(result.bestHit);
  });

  first.results[0].rank = 999;
  const repeated = searchIndex.search("budget constraints");
  assert.equal(repeated.results[0].rank, 1, "a later query derives a fresh order");
  assert.equal(JSON.stringify(modelNotes), before, "search does not persist ranks into the model-note payload");
});

const localConcepts = [
  { id: "capacity", label: "Capacity allocation", aliases: ["capacity assignment"], related: ["budget"] },
  { id: "budget", label: "Budget constraints", aliases: ["budget limits"], related: [] },
  { id: "screening", label: "Screening", aliases: ["type screening"], related: [] }
];
const source = { page: 1, section: "Model definition", quote: "Original source wording." };
const binding = (conceptId, status = "modeled", extra = {}) => ({
  conceptId,
  status,
  representation: `An editorial representation of ${conceptId}.`,
  conditionRefs: [0],
  sourceRefs: [{ scope: "component", index: 0 }],
  reviewStatus: "editorial",
  ...extra
});
const component = (id, bindings = [], extra = {}) => ({
  id,
  label: "Allocation rule",
  role: "constraint",
  explanation: "A formal allocation rule.",
  formal: "x <= B",
  formalKind: "Atlas normalized notation",
  symbols: [],
  conditions: ["Only feasible allocations are admitted."],
  searchPhrases: [],
  concepts: bindings.filter((item) => item.status === "modeled").map((item) => item.conceptId),
  conceptBindings: bindings,
  sources: [source],
  ...extra
});
const model = (id, components, extra = {}) => ({
  id,
  name: "Baseline",
  summary: "A formal specification.",
  objects: [],
  inputs: [],
  decisions: [],
  assumptions: [],
  method: "Analytical solution.",
  sources: [source],
  relationships: [],
  components,
  ...extra
});
const note = (id, models, extra = {}) => ({
  id,
  title: `Structured ${id}`,
  question: "How is the mechanism specified?",
  overview: "A component-mapped model note.",
  modelTypes: ["Optimization"],
  models,
  ...extra
});
const record = (id, extra = {}) => ({
  id,
  title: `Structured ${id}`,
  authors_text: "Research Author",
  authors: ["Research Author"],
  doi: `10.test/${id}`,
  journal: "Test Journal",
  journal_code: "test",
  year: 2026,
  detail_level: "model_map",
  ...extra
});
const localIndex = (notes, concepts = localConcepts) => atlas.createSearchIndex(
  notes.map((entry) => record(entry.id, { title: entry.title })),
  { papers: notes, concepts }
);

test("applicability is the primary ordering key and exact Mini provenance remains available", () => {
  const statuses = ["unknown", "backgroundOnly", "explicitlyExcluded", "modeled"];
  const notes = statuses.map((status) => note(status, [model("m", [component("c", [binding("capacity", status)])])]));
  notes.push(note("lexical", [model("m", [component("c", [], { explanation: "Capacity allocation is mentioned here." })])]));
  const output = localIndex(notes).search("capacity allocation");

  assert.deepEqual(output.results.map((result) => result.applicabilityGroup), [
    "modeled", "unclassified", "explicitlyExcluded", "backgroundOnly", "unknown"
  ]);
  assert.deepEqual(output.results.map((result) => result.rank), [1, 2, 3, 4, 5]);
  const hit = output.results[0].bestHit;
  assert.equal(hit.scope, "component");
  assert.equal(hit.field, "concept", "the main reader keeps its compatibility field name");
  assert.equal(hit.match.field, "concepts", "the evidence object names the authored Mini field");
  assert.equal(hit.match.applicability, "modeled");
  assert.equal(hit.match.bindings[0], notes.find((entry) => entry.id === "modeled").models[0].components[0].conceptBindings[0]);
  assert.deepEqual(hit.match.bindingRefs, [{ modelId: "m", componentId: "c", bindingIndex: 0, conceptId: "capacity" }]);
  assert.deepEqual(hit.target, {
    kind: "structured", modelId: "m", componentId: "c", section: "component", bindingIndex: 0, conceptId: "capacity"
  });
});

test("concept conjunctions stay in one model and every matching component remains revealable", () => {
  const alpha = { id: "alpha", label: "Alpha mechanism", aliases: [], related: [] };
  const beta = { id: "beta", label: "Beta mechanism", aliases: [], related: [] };
  const alphaComponent = component("alpha-component", [binding("alpha")]);
  const betaComponent = component("beta-component", [binding("beta")]);
  const query = "alpha mechanism beta mechanism";
  const split = note("split", [
    model("alpha-variant", [alphaComponent], { summary: query }),
    model("beta-variant", [betaComponent])
  ], { title: query });
  const coherent = note("coherent", [model("joint", [alphaComponent, betaComponent])]);
  const output = localIndex([split, coherent], [alpha, beta]).search(query);

  assert.deepEqual(output.results.map((result) => result.paper.id), ["coherent"]);
  assert.deepEqual(new Set(output.results[0].hits.map((hit) => hit.target.componentId)), new Set(["alpha-component", "beta-component"]));
  assert.ok(output.results[0].hits.every((hit) => hit.target.modelId === "joint"));
  assert.equal(output.componentCount, 2);
});

test("related concepts are not aliases, while complete scenario and typo matches retain their filters", () => {
  const scenario = "consumers wait for future price cuts";
  const capacity = { id: "capacity", label: "Capacity allocation", aliases: ["capacity assignment"], related: ["screening"] };
  const screening = { id: "screening", label: "Screening", aliases: ["type screening"], related: [] };
  const scenarioConcept = { id: "future-price", label: "Future price cuts", aliases: ["later discounts"], related: [] };
  const scenarioNote = note("scenario", [model("m", [component("scenario-component", [binding("capacity")], {
    searchPhrases: [scenario]
  })])]);
  const engine = localIndex([scenarioNote], [capacity, screening, scenarioConcept]);

  assert.deepEqual(engine.search("capacity allocation").mapped.map((concept) => concept.id), ["capacity"]);
  assert.ok(!engine.search("capacity allocation").mapped.some((concept) => concept.id === "screening"));
  const scenarioHit = engine.search(scenario, { journal: "test", type: "Optimization", level: "structured" }).results[0].bestHit;
  assert.equal(scenarioHit.field, "searchPhrases");
  assert.equal(scenarioHit.match.type, "Exact phrase");
  assert.equal(scenarioHit.tier, 1);
  assert.deepEqual(scenarioHit.ranges.map((range) => scenarioHit.text.slice(range.start, range.end)), [scenario]);
  assert.equal(engine.search("capacity assigment").corrections[0].to, "assignment");
  assert.equal(engine.search(scenario, { journal: "other" }).results.length, 0);
});

test("query and evidence negation are warnings, never inferred applicability", () => {
  const constrained = note("negation", [model("m", [component("c", [], {
    explanation: "Agents are not strategic consumers.",
    conditions: ["Only capacity allocation without credit is permitted."]
  })])]);
  const engine = localIndex([constrained]);
  const lexical = engine.search("strategic consumers").results[0].bestHit;
  assert.equal(lexical.match.applicability, "unclassified");
  assert.deepEqual(lexical.match.bindings, []);
  assert.match(lexical.match.caution, /restriction or negation/);
  const negated = engine.search("capacity allocation without credit");
  assert.ok(negated.warnings.length);
  assert.match(negated.results[0].bestHit.match.caution, /query contains negation/);
  assert.equal(negated.results[0].bestHit.match.text, "Only capacity allocation without credit is permitted.");
});

test("source ranges stay exact after Unicode normalization and search never mutates notes", () => {
  const original = "A ﬁrm chooses strategy; strategy uses <x> & y.";
  const unicode = note("unicode", [model("m", [component("c", [], { explanation: original })])]);
  const payload = { papers: [unicode], concepts: localConcepts };
  const before = JSON.stringify(payload);
  const engine = atlas.createSearchIndex([record("unicode")], payload);
  const firm = engine.search("firm").results[0].bestHit;
  assert.deepEqual(firm.ranges.map((range) => firm.text.slice(range.start, range.end)), ["ﬁrm"]);
  const strategy = engine.search("strategy").results[0].bestHit;
  assert.deepEqual(strategy.ranges.map((range) => strategy.text.slice(range.start, range.end)), ["strategy", "strategy"]);
  engine.search("not strategy");
  assert.equal(JSON.stringify(payload), before);
});

test("the permanent full-corpus index does not retain per-character highlight maps", () => {
  const fields = searchIndex.docs.flatMap((document) => document.fields);
  assert.ok(fields.length > searchIndex.docs.length, "the index contains searchable fields");
  assert.ok(fields.every((field) => !Object.hasOwn(field, "indexed")),
    "Unicode-safe highlight offsets are derived only for query candidates");
});
