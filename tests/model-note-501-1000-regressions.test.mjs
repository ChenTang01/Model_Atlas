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
import { validateModelNoteSemantics } from "../scripts/model-note-semantic-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAPER_IDS = [
  "doi-10-1287-mnsc-2020-3586",
  "doi-10-1287-mnsc-2020-3681",
  "doi-10-1287-mnsc-2020-3704",
  "doi-10-1287-mnsc-2020-3800",
  "doi-10-1287-mnsc-2022-4302",
  "doi-10-1287-mnsc-2023-4712",
  "doi-10-1287-mnsc-2023-4948"
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
  return { pages, note };
}

const fixturesPromise = Promise.all(PAPER_IDS.map(async (id) => [id, await loadFixture(id)]));

async function fixture(id) {
  return new Map(await fixturesPromise).get(id);
}

function models(note) {
  return note.models || [];
}

function components(note) {
  return models(note).flatMap((model) => model.components || []);
}

function lexicalWords(value) {
  return cleanText(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
}

test("501-1000 authoring regressions build with no semantic errors", async () => {
  for (const [id, built] of await fixturesPromise) {
    const result = validateModelNoteSemantics(built.note, {
      authoringMode: "source-mapped",
      pages: built.pages,
      concepts
    });
    assert.deepEqual(result.errors, [], `${id}: ${JSON.stringify(result.errors)}`);
  }
});

test("a generic estimation-results table does not become a model component", async () => {
  const { note } = await fixture("doi-10-1287-mnsc-2020-3586");
  assert.equal(components(note).some((component) => component.label === "Estimation Results"), false);
  for (const component of components(note)) {
    assert.ok(lexicalWords(component.explanation).length >= 6, component.label);
  }
});

test("short component prose falls through to the next substantive local sentence", async () => {
  const { note } = await fixture("doi-10-1287-mnsc-2022-4302");
  const demand = components(note).find((component) => component.label === "Demand/Consumers");
  assert.ok(demand, "Demand/Consumers component is missing");
  assert.match(cleanText(demand.explanation), /multihome between the platforms.+higher surplus/i);
  assert.ok(lexicalWords(demand.sources[0].quote).length >= 6);
  assert.notEqual(cleanText(demand.sources[0].quote), "The platforms compete for consumers.");
});

test("first-person address is conjugated in a source-derived method", async () => {
  const { note } = await fixture("doi-10-1287-mnsc-2020-3681");
  const dynamicProgram = models(note).find((model) => model.name === "Dynamic Program Under Unique-Ranking Distributions");
  assert.ok(dynamicProgram, "dynamic-program variant is missing");
  assert.match(dynamicProgram.method, /^The paper addresses these difficulties by proposing an efficient algorithm/i);
  assert.doesNotMatch(dynamicProgram.method, /\bThe paper address\b/i);
});

test("the unique-ranking paper does not promote a literature-only Choice Models heading", async () => {
  const { note } = await fixture("doi-10-1287-mnsc-2020-3681");
  const labels = [
    ...models(note).map((model) => model.name),
    ...components(note).map((component) => component.label)
  ];
  assert.equal(labels.some((label) => /^Choice Models$/i.test(cleanText(label))), false);
});

test("an explicit precedence digraph declaration completes process inputs", async () => {
  const { note } = await fixture("doi-10-1287-mnsc-2020-3704");
  const model = models(note)[0];
  assert.ok(model.inputs.includes("A directed acyclic graph"));
  const evidence = model.setupEvidence.inputs.find((entry) => entry.value === "A directed acyclic graph");
  assert.deepEqual(
    { page: evidence?.source?.page, section: evidence?.source?.section, quote: evidence?.source?.quote },
    { page: 5, section: "Preliminaries", quote: "a directed acyclic graph" }
  );
});

test("a defined objective function completes multiobjective-program inputs", async () => {
  const { note } = await fixture("doi-10-1287-mnsc-2023-4712");
  const model = models(note)[0];
  assert.ok(model.inputs.includes("The ith objective function"));
  const evidence = model.setupEvidence.inputs.find((entry) => entry.value === "The ith objective function");
  assert.deepEqual(
    { page: evidence?.source?.page, section: evidence?.source?.section, quote: evidence?.source?.quote },
    { page: 2, section: "Definitions and Some Theory", quote: "the ith objective function" }
  );
});

test("journal page numbers spliced into assumption clauses are not authored as setup", async () => {
  for (const id of ["doi-10-1287-mnsc-2020-3800", "doi-10-1287-mnsc-2023-4948"]) {
    const { note } = await fixture(id);
    for (const model of models(note)) {
      assert.equal(
        (model.assumptions || []).some((assumption) => /^\d{4}$/.test(cleanText(assumption))),
        false,
        `${id}: ${model.name}`
      );
      assert.equal(
        (model.setupEvidence?.assumptions || []).some((entry) => /^\d{4}$/.test(cleanText(entry.value))),
        false,
        `${id}: ${model.name} evidence`
      );
    }
  }
});
