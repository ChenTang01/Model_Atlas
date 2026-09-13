import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADDITIONAL_CONCEPTS,
  buildAuthoredNote,
  cleanLiteralQuoteSubclause,
  cleanText,
  remapSetupEntryToLiteralPage
} from "../scripts/model-note-authoring.mjs";
import { formulaContaminatedProse } from "../scripts/model-note-formula-quality.mjs";
import { validateModelNoteSemantics } from "../scripts/model-note-semantic-audit.mjs";
import {
  hasExtractionNoise,
  isCaption,
  isCitation,
  isWhitespaceNormalizedSubstring
} from "../scripts/model-note-text-quality.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAPER_IDS = [
  "doi-10-1287-mksc-2022-0262",
  "doi-10-1287-mksc-2022-1399",
  "doi-10-1287-mnsc-2021-04108",
  "doi-10-1287-mnsc-2021-00160",
  "doi-10-1287-mnsc-2021-4263",
  "doi-10-1287-mnsc-2022-03512",
  "doi-10-1287-mnsc-2022-4375",
  "doi-10-1287-mnsc-2023-02973",
  "doi-10-1287-msom-2021-0189",
  "doi-10-1287-msom-2024-1317"
];

const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));

function mergeConcepts(miniConcepts) {
  const concepts = new Map();
  for (const concept of [...miniConcepts, ...ADDITIONAL_CONCEPTS]) {
    const target = concepts.get(concept.id) || { id: concept.id, label: concept.label, aliases: [], related: [] };
    target.aliases = [...new Set([target.label, ...(target.aliases || []), ...(concept.aliases || [])]
      .map(cleanText).filter(Boolean))];
    target.related = [...new Set([...(target.related || []), ...(concept.related || [])])];
    concepts.set(concept.id, target);
  }
  return [...concepts.values()];
}

const [catalog, mini] = await Promise.all([
  readJson(path.join(ROOT, "data", "atlas_articles.json")),
  readJson(path.join(ROOT, "mini-atlas", "data", "atlas.json"))
]);
const records = new Map(catalog.records.map((record) => [record.id, record]));
const concepts = mergeConcepts(mini.concepts || []);

async function buildPaper(id) {
  const record = records.get(id);
  assert.ok(record, `${id}: catalog record missing`);
  const ledger = await readJson(path.join(ROOT, "research", "ledger", "papers", `${id}.json`));
  const pagesPayload = await readJson(path.join(ROOT, ledger.stages.extraction.artifacts.pages));
  return { record, pages: pagesPayload.pages || pagesPayload, note: buildAuthoredNote(record, pagesPayload, concepts) };
}

function authoredSources(note) {
  return (note.models || []).flatMap((model) => [
    ...(model.sources || []),
    ...(model.components || []).flatMap((component) => component.sources || [])
  ]);
}

function setupSources(note) {
  return (note.models || []).flatMap((model) => Object.values(model.setupEvidence || {})
    .flatMap((entries) => entries || [])
    .map((entry) => entry.source)
    .filter((source) => source?.type === "section"));
}

test("literal clause narrowing removes adjacent display math without inventing text", () => {
  const rawPage = [
    "Given a parameter setting gamma, let",
    "(S, R) := A(f, N),",
    "denote the output of A when ground set N is ordered."
  ].join("\n");
  const joined = "Given a parameter setting gamma, let (S, R) := A(f, N), denote the output of A when ground set N is ordered.";
  const narrowed = cleanLiteralQuoteSubclause(joined, rawPage, "the output", "the output");
  assert.equal(narrowed, "the output of A when ground set N is ordered.");
  assert.equal(isWhitespaceNormalizedSubstring(narrowed, rawPage), true);
  assert.equal(formulaContaminatedProse(narrowed, rawPage, { conservative: true }), false);
});

test("setup remapping narrows a formula-spliced parameter definition to literal prose", () => {
  const rawPage = [
    "Given a parameter setting gamma, let",
    "(S, R) := A(f, N),",
    "denote the output of A when ground set N is ordered."
  ].join("\n");
  const remapped = remapSetupEntryToLiteralPage({
    value: "The output",
    source: {
      type: "section",
      section: "Algorithm",
      page: 1,
      quote: "Given a parameter setting gamma, let (S, R) := A(f, N), denote the output of A when ground set N is ordered.",
      matchedText: "the output",
      derivation: "literal-source-phrase"
    }
  }, [{ page: 1, text: rawPage }], "inputs");
  assert.equal(remapped.source.quote, "the output of A when ground set N is ordered.");
});

test("audited noise, formula, and caption cases build with clean literal source anchors", async () => {
  const settled = await Promise.all(PAPER_IDS.map(buildPaper));
  for (const { record, pages, note } of settled) {
    const semantic = validateModelNoteSemantics(note, {
      authoringMode: record.detail_level === "model_map" ? "metadata-enriched" : "source-mapped",
      pages,
      concepts
    });
    assert.deepEqual(semantic.errors, [], `${record.id}: semantic sanitation regression`);
    const pagesByNumber = new Map(pages.map((page) => [Number(page.page), page.text]));
    for (const source of [...authoredSources(note), ...setupSources(note)]) {
      const rawPage = pagesByNumber.get(Number(source.page));
      assert.equal(isWhitespaceNormalizedSubstring(source.quote, rawPage), true, `${record.id}: nonliteral quote`);
      assert.equal(hasExtractionNoise(source.quote), false, `${record.id}: noisy quote`);
      assert.equal(isCaption(source.quote), false, `${record.id}: caption quote`);
      assert.equal(isCitation(source.quote), false, `${record.id}: citation quote`);
      assert.equal(formulaContaminatedProse(source.quote, rawPage, { conservative: true }), false, `${record.id}: formula-contaminated quote`);
    }
    if (record.id === "doi-10-1287-mnsc-2021-04108") {
      const labels = (note.models || []).flatMap((model) => model.components || []).map((component) => component.label);
      assert.ok(labels.includes("Algorithms for Constrained Assortment Optimization"),
        `${record.id}: the substantive section 3.3 algorithm component was omitted`);
      assert.equal(labels.some((label) => /^Upper Bound of 0\.5$/i.test(cleanText(label))), false,
        `${record.id}: theorem-bound result section was promoted to a model component`);
    }
    if (record.id === "doi-10-1287-mnsc-2021-00160") {
      assert.equal(authoredSources(note).some((source) => /V ayanos, Georghiou, Y u:/i.test(source.section)), false,
        `${record.id}: a repeated running header survived as source structure`);
    }
    if (record.id === "doi-10-1287-mnsc-2022-03512") {
      assert.equal(authoredSources(note).some((source) => /Simchi-Levi, Zheng and Zhu:Optimal/i.test(source.section)), false,
        `${record.id}: a repeated author/title running header survived as source structure`);
    }
    if (["doi-10-1287-mnsc-2021-4263", "doi-10-1287-mnsc-2022-4375"].includes(record.id)) {
      assert.equal(authoredSources(note).some((source) => /^(?:model|method|equilibrium)$/u.test(cleanText(source.section))), false,
        `${record.id}: a lowercase column fragment survived as source structure`);
    }
    if (record.id === "doi-10-1287-mnsc-2023-02973") {
      const labels = (note.models || []).flatMap((model) => model.components || []).map((component) => component.label);
      assert.equal(labels.some((label) => /^(?:notations?\s+(?:and\s+)?definitions?|definitions?\s+(?:and\s+)?notations?)$/i.test(cleanText(label))), false,
        `${record.id}: a notation table was promoted to a standalone component`);
    }
  }
});

test("the curated stochastic-matching quote remains literal after extraction refresh", async () => {
  const id = "doi-10-1287-mnsc-2021-4216";
  const [envelope, ledger] = await Promise.all([
    readJson(path.join(ROOT, "data", "notes", "papers", `${id}.json`)),
    readJson(path.join(ROOT, "research", "ledger", "papers", `${id}.json`))
  ]);
  const pagesPayload = await readJson(path.join(ROOT, ledger.stages.extraction.artifacts.pages));
  const pages = pagesPayload.pages || pagesPayload;
  const pagesByNumber = new Map(pages.map((page) => [Number(page.page), page.text]));
  for (const source of authoredSources(envelope.note)) {
    assert.equal(
      isWhitespaceNormalizedSubstring(source.quote, pagesByNumber.get(Number(source.page))),
      true,
      `${id}: curated source quote is stale on page ${source.page}`
    );
  }
});
