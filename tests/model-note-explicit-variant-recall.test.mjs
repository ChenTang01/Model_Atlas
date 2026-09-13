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
import { noteFormalStructureIssues } from "../scripts/model-note-formula-quality.mjs";
import { validateModelNoteSemantics } from "../scripts/model-note-semantic-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES = [
  {
    id: "doi-10-1287-isre-2023-0625",
    model: "Benchmark Case",
    component: "Benchmark Case",
    role: "constraint",
    page: 4,
    condition: "Following Nian and Sundararajan (2022, section 4.2.1), we first analyze the benchmark case where SMM spending s does not play the information revelation role (i.e., the precision of quality signals does not depend on s); rather, such spending simply increases the number of consumers who are aware of the product as given by (1)."
  },
  {
    id: "doi-10-1287-isre-2024-1115",
    model: "Best-Case Benchmark: Simple Random Sampling",
    component: "Best-Case Benchmark: Simple Random Sampling",
    role: "decision",
    page: 10,
    condition: "In this approach, the platform randomly selects a sample of size n and offers each data subject compensation equal to her reservation price."
  },
  {
    id: "doi-10-1287-isre-2024-1175",
    model: "Publisher multihoming extension",
    component: "Multihoming Publishers",
    role: "decision",
    page: 9,
    condition: "It is to be noted here that along the lines of recent work (Bakos and Halaburda 2020, Chellappa and Mukherjee 2021), we endogenize the decision of a publisher to multihome, that is, publishers may choose to exclusively develop for a single platform or for both platforms based on their utilities from doing so."
  },
  {
    id: "doi-10-1287-isre-2024-1425",
    model: "Endogenous price extension",
    component: "Fixed-Price Scenario",
    role: "constraint",
    page: 8,
    condition: "This section examines the impact of AR fitting application on a physical store with fixed price—that is, the price of clothing remains unchanged regardless of market size."
  },
  {
    id: "doi-10-1287-mksc-2023-0148",
    model: "Model Extensions and Variations",
    component: "Investment by the Competitive Supplier",
    role: "decision",
    page: 13,
    condition: "In this extension, we also allow firm S to invest in its own input."
  },
  {
    id: "doi-10-1287-mksc-2023-0211",
    model: "Commission-design extension",
    component: "Endogenous Commission Rate",
    role: "decision",
    page: 11,
    condition: "In other words, δ ∈ [0,1] can be endogenously set by the platform."
  },
  {
    id: "doi-10-1287-mksc-2023-0573",
    model: "Interplatform competition extension",
    component: "Content Promotion Under Interplatform Competition",
    role: "interaction",
    page: 9,
    condition: "In this section, we broaden the scope of our base model to examine how interplatform competition influences equilibrium content promotion, contrasting this with the monopolistic scenario."
  },
  {
    id: "doi-10-1287-mksc-2023-0623",
    model: "Extensions",
    component: "A Dynamic Model with Reentry",
    role: "process",
    page: 12,
    condition: "This section introduces a dynamic extension of our framework in which agents can reenter the market across multiple periods."
  }
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
    const target = existing || { id: concept.id, label: concept.label, aliases: [], related: [] };
    assert.ok(!existing || cleanText(existing.label) === cleanText(concept.label), `Concept label conflict: ${concept.id}`);
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

function normalizedLiteral(value) {
  return cleanText(value).toLocaleLowerCase();
}

const [catalog, mini] = await Promise.all([
  readJson(path.join(ROOT, "data", "atlas_articles.json")),
  readJson(path.join(ROOT, "mini-atlas", "data", "atlas.json"))
]);
const records = new Map((catalog.records || []).map((record) => [record.id, record]));
const concepts = mergeConcepts(mini.concepts || []);

async function buildCase(specification) {
  const record = records.get(specification.id);
  assert.ok(record, `${specification.id}: catalog record is missing`);
  const ledger = await readJson(path.join(ROOT, "research", "ledger", "papers", `${specification.id}.json`));
  const extraction = ledger?.stages?.extraction;
  assert.equal(extraction?.status, "complete", `${specification.id}: extraction is incomplete`);
  const pagesText = await readFile(path.resolve(ROOT, extraction.artifacts.pages), "utf8");
  assert.equal(sha256(pagesText), extraction.artifacts.pagesSha256, `${specification.id}: extraction hash is stale`);
  const pagesPayload = JSON.parse(pagesText);
  const pages = pagesPayload.pages || pagesPayload;
  return { specification, pages, note: buildAuthoredNote(record, pagesPayload, concepts) };
}

const fixturesPromise = Promise.all(CASES.map(buildCase));

test("explicit paper variants retain their page-local defining statement", async () => {
  for (const { specification, pages, note } of await fixturesPromise) {
    const model = (note.models || []).find((candidate) => candidate.name === specification.model);
    assert.ok(model, `${specification.id}: ${specification.model} is missing`);
    const component = (model.components || []).find((candidate) => candidate.label === specification.component);
    assert.ok(component, `${specification.id}: ${specification.component} is missing`);
    assert.equal(component.role, specification.role, `${specification.id}: wrong component role`);
    assert.equal(component.sources?.[0]?.page, specification.page, `${specification.id}: wrong source page`);
    assert.ok(component.conditions?.includes(specification.condition), `${specification.id}: defining condition is missing`);
    assert.equal(component.conditions[0], specification.condition, `${specification.id}: defining condition lost priority`);

    const page = pages.find((entry, index) => Number(entry?.page || index + 1) === specification.page);
    assert.ok(page, `${specification.id}: source page is missing`);
    assert.ok(
      normalizedLiteral(page.text).includes(normalizedLiteral(component.sources[0].quote)),
      `${specification.id}: component quote is not literal on page ${specification.page}`
    );
    assert.equal(
      (component.conceptBindings || []).some((binding) => binding.status === "modeled"
        && binding.conditionRefs?.length && binding.sourceRefs?.length),
      true,
      `${specification.id}: source/condition binding is incomplete`
    );
    const prosePayload = JSON.stringify({
      label: component.label,
      explanation: component.explanation,
      searchPhrases: component.searchPhrases,
      conditions: component.conditions,
      sources: component.sources
    });
    assert.doesNotMatch(
      prosePayload,
      /[\u0000-\u001f\u007f-\u009f]|(?<!\\)\$|\\(?:lambda|alpha|beta|gamma|delta|theta|tau)\b/u,
      `${specification.id}: raw TeX or extraction controls leaked into prose`
    );
  }
});

test("explicit-variant fixtures pass semantic and formal-structure audits", async () => {
  for (const { specification, pages, note } of await fixturesPromise) {
    const semantic = validateModelNoteSemantics(note, {
      authoringMode: "source-mapped",
      pages,
      concepts
    });
    assert.deepEqual(semantic.errors, [], `${specification.id}: ${JSON.stringify(semantic.errors)}`);
    assert.deepEqual(noteFormalStructureIssues(note), [], `${specification.id}: formal structure issues remain`);
  }
});
