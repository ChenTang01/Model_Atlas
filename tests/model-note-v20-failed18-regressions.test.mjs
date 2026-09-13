import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADDITIONAL_CONCEPTS,
  AUTHORING_VERSION,
  buildAuthoredNote,
  cleanText,
} from "../scripts/model-note-authoring.mjs";
import { validateModelNoteSemantics } from "../scripts/model-note-semantic-audit.mjs";
import { isWhitespaceNormalizedSubstring } from "../scripts/model-note-text-quality.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUCCESS_IDS = [
  "doi-10-1287-mnsc-2017-2886",
  "doi-10-1287-mnsc-2020-3899",
  "doi-10-1287-mnsc-2022-4638",
  "doi-10-1287-mnsc-2023-04203",
  "doi-10-1287-msom-2020-0874",
  "doi-10-1287-msom-2022-0339",
];
const QUALITY_REGRESSION_IDS = [
  "doi-10-1287-mnsc-2017-3005",
  "doi-10-1287-mnsc-2017-3024",
  "doi-10-1287-mnsc-2021-4134",
  "doi-10-1287-msom-2022-1101",
  "doi-10-1287-msom-2023-0042",
];
const FAILED_DEHYPHENATION_ID = "doi-10-1287-mnsc-2016-2515";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));

const [catalog, mini] = await Promise.all([
  readJson(path.join(ROOT, "data", "atlas_articles.json")),
  readJson(path.join(ROOT, "mini-atlas", "data", "atlas.json")),
]);
const records = new Map((catalog.records || []).map((record) => [record.id, record]));

function mergedConcepts() {
  const concepts = new Map();
  for (const concept of [...(mini.concepts || []), ...ADDITIONAL_CONCEPTS]) {
    const existing = concepts.get(concept.id);
    if (existing && cleanText(existing.label) !== cleanText(concept.label)) {
      throw new Error(`Concept label conflict: ${concept.id}`);
    }
    const target = existing || { id: concept.id, label: concept.label, aliases: [], related: [] };
    target.aliases = [...new Set([
      target.label,
      ...(target.aliases || []),
      ...(concept.aliases || []),
    ].map(cleanText).filter(Boolean))];
    target.related = [...new Set([...(target.related || []), ...(concept.related || [])])];
    concepts.set(concept.id, target);
  }
  for (const concept of concepts.values()) {
    concept.related = concept.related.filter((id) => concepts.has(id) && id !== concept.id);
  }
  return [...concepts.values()].sort((left, right) => left.label.localeCompare(right.label));
}

const concepts = mergedConcepts();

async function sourceFixture(id) {
  const record = records.get(id);
  assert.ok(record, `${id}: catalog record is missing`);
  const ledger = await readJson(path.join(ROOT, "research", "ledger", "papers", `${id}.json`));
  const extraction = ledger?.stages?.extraction;
  assert.equal(extraction?.status, "complete", `${id}: extraction must be complete`);
  const pagesText = await readFile(path.resolve(ROOT, extraction.artifacts.pages), "utf8");
  assert.equal(sha256(pagesText), extraction.artifacts.pagesSha256, `${id}: extraction pages hash is stale`);
  const pagesPayload = JSON.parse(pagesText);
  return { id, record, pagesPayload, pages: pagesPayload.pages || pagesPayload };
}

async function builtFixture(id) {
  const fixture = await sourceFixture(id);
  return {
    ...fixture,
    note: buildAuthoredNote(fixture.record, fixture.pagesPayload, concepts, { formalEvidenceAllowed: true }),
  };
}

const builtPromise = Promise.all([...new Set([...SUCCESS_IDS, ...QUALITY_REGRESSION_IDS])].map(builtFixture));

function components(note) {
  return (note.models || []).flatMap((model) => model.components || []);
}

function componentWithSource(note, pattern) {
  return components(note).find((component) => (component.sources || []).some((source) => pattern.test(cleanText(source.quote))));
}

function assertStrictComponent(fixture, component, expectedRole) {
  assert.ok(component, `${fixture.id}: expected component source was not retained`);
  assert.equal(component.role, expectedRole);
  assert.ok((component.conditions || []).length > 0, `${fixture.id}: component condition is missing`);
  assert.ok((component.conceptBindings || []).some((binding) => binding.status === "modeled"
    && (binding.conditionRefs || []).length
    && (binding.sourceRefs || []).length), `${fixture.id}: condition/source-bound modeled concept is missing`);
  for (const source of component.sources || []) {
    const page = fixture.pages.find((entry) => Number(entry.page) === Number(source.page));
    assert.ok(page && isWhitespaceNormalizedSubstring(source.quote, page.text), `${fixture.id}: source is not literal on page ${source.page}`);
  }
}

test("v20 retains the six repaired nonbaseline definitions under strict source and semantic gates", async () => {
  assert.equal(AUTHORING_VERSION, "source-sections-v20");
  const fixtures = new Map((await builtPromise).map((fixture) => [fixture.id, fixture]));

  const capacity = fixtures.get("doi-10-1287-mnsc-2017-2886");
  const capacityComponent = componentWithSource(capacity.note, /maximum order quantity.+cannot exceed/iu);
  assertStrictComponent(capacity, capacityComponent, "constraint");
  assert.equal(capacityComponent.sources[0].page, 4);
  assert.match(capacityComponent.sources[0].section, /Model Formulation/iu);

  const influence = fixtures.get("doi-10-1287-mnsc-2020-3899");
  const influenceComponent = componentWithSource(influence.note, /^In particular, we ignore the influence/iu);
  assertStrictComponent(influence, influenceComponent, "constraint");
  assert.equal(influenceComponent.conditions.length, 1);
  assert.match(influenceComponent.conditions[0], /^In particular, we ignore the influence.+set V\.$/iu);
  assert.doesNotMatch(influenceComponent.sources[0].quote, /[.!?]\s*$/u,
    `${influence.id}: the literal source fragment must not gain synthesized punctuation`);
  assert.equal(influenceComponent.conditionEvidence?.[0]?.derivation, "terminal-punctuation-only-source-condition");
  assert.doesNotMatch(JSON.stringify(influenceComponent), /NP-complete|onstrate|users in (?:the )?relaxed model provides/iu);
  assert.ok((influence.note.models || []).every((model) => !/\(%\)\s*$/u.test(cleanText(model.name))),
    `${influence.id}: tabular percentage heading became a model`);

  const bogo = fixtures.get("doi-10-1287-mnsc-2022-4638");
  assertStrictComponent(bogo, componentWithSource(bogo.note, /^With BOGO, the retailer sets/iu), "decision");

  const priorBound = fixtures.get("doi-10-1287-mnsc-2023-04203");
  assertStrictComponent(priorBound, componentWithSource(priorBound.note, /there exists an upper bound q on the optimal solution/iu), "constraint");

  const echelon = fixtures.get("doi-10-1287-msom-2020-0874");
  assertStrictComponent(echelon, componentWithSource(echelon.note, /^Let Y\(yt\) be the feasible set given yt/iu), "constraint");

  const reformulation = fixtures.get("doi-10-1287-msom-2022-0339");
  assertStrictComponent(reformulation, componentWithSource(reformulation.note, /Constraints \(15a\) have been transformed into a linear programming problem/iu), "constraint");

  for (const id of SUCCESS_IDS) {
    const fixture = fixtures.get(id);
    const audit = validateModelNoteSemantics({
      note: fixture.note,
      pages: fixture.pages,
      concepts,
      authoringMode: "source-mapped",
    });
    assert.deepEqual(audit.errors, [], `${fixture.id}: ${JSON.stringify(audit.errors, null, 2)}`);
  }
});

test("v20 rejects affiliation headings, result prose, and generic definition headings exposed by the repaired corpus", async () => {
  const fixtures = new Map((await builtPromise).map((fixture) => [fixture.id, fixture]));

  const capacity = fixtures.get("doi-10-1287-mnsc-2017-2886");
  assert.doesNotMatch(
    JSON.stringify(components(capacity.note)),
    /Pennsylvania State University, University Park, Pennsylvania 16802/iu,
  );

  const influence = fixtures.get("doi-10-1287-mnsc-2020-3899");
  assert.doesNotMatch(
    JSON.stringify(components(influence.note)),
    /the theorem is formally proved in online appendix|the downward trend in all these figures/iu,
  );

  const investment = fixtures.get("doi-10-1287-mnsc-2017-3005");
  assert.doesNotMatch(
    JSON.stringify(components(investment.note)),
    /In Figure 6, as \u03b1 approaches/iu,
  );

  const socialLearning = fixtures.get("doi-10-1287-mnsc-2017-3024");
  assert.doesNotMatch(
    JSON.stringify(components(socialLearning.note)),
    /firm(?:'s|’s) profit in the first period remains unchanged/iu,
  );

  const reusableResources = fixtures.get("doi-10-1287-mnsc-2021-4134");
  assert.doesNotMatch(
    JSON.stringify(components(reusableResources.note)),
    /expected total revenue of OPT and ALG remains unchanged/iu,
  );

  const allocation = fixtures.get("doi-10-1287-msom-2022-1101");
  assert.doesNotMatch(
    JSON.stringify(components(allocation.note)),
    /Interestingly, the predictive allocation is preferred/iu,
  );

  const opioid = fixtures.get("doi-10-1287-msom-2023-0042");
  assert.equal(
    (opioid.note.models || []).some((model) => /^Model Definition$/iu.test(cleanText(model.name))),
    false,
    `${opioid.id}: a generic definition subsection became a peer model`,
  );
});

test("v20 fails closed when a named model condition exists only behind ambiguous hard-hyphen line joins", async () => {
  const fixture = await sourceFixture(FAILED_DEHYPHENATION_ID);
  assert.throws(
    () => buildAuthoredNote(fixture.record, fixture.pagesPayload, concepts, { formalEvidenceAllowed: true }),
    /Linear Demand Model: no component retained semantic parity: no source-grounded condition/iu,
  );
  const page = fixture.pages.find((entry) => Number(entry.page) === 4);
  assert.match(page?.text || "", /faces lin-\r?\near demand curves.+additive uncer-\r?\ntainty/isu);
  assert.equal(isWhitespaceNormalizedSubstring(
    "Suppose that the firm faces linear demand curves that are subject to additive uncertainty.",
    page?.text || "",
  ), false);
});
