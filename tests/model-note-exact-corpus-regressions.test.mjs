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
} from "../scripts/model-note-authoring.mjs";
import { validateModelNoteSemantics } from "../scripts/model-note-semantic-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAPER_IDS = [
  "akc2025telehealthacutecare",
  "doi-10-1287-mnsc-2020-01990",
  "doi-10-1287-mnsc-2023-02573",
  "doi-10-1287-msom-2017-0663",
  "doi-10-1287-mnsc-2014-2102",
  "doi-10-1287-msom-2019-0477",
  "doi-10-1287-isre-2016-0636",
  "besbes2024workforceschedulingheterogeneous",
  "doi-10-1287-isre-2017-0720",
  "doi-10-1287-isre-2017-0693",
  "doi-10-1287-isre-2017-0697",
  "doi-10-1287-isre-2018-0805",
  "doi-10-1287-isre-2021-1042",
  "doi-10-1287-isre-2022-0283",
  "doi-10-1287-mksc-2020-1237",
  "doi-10-1287-mksc-2020-1249",
  "doi-10-1287-mnsc-2015-2338",
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

const [catalog, manifest, mini] = await Promise.all([
  readJson(path.join(ROOT, "data", "atlas_articles.json")),
  readJson(path.join(ROOT, "research", "corpus", "manifest.v1.json")),
  readJson(path.join(ROOT, "mini-atlas", "data", "atlas.json")),
]);
const records = new Map((catalog.records || []).map((record) => [record.id, record]));
const manifestRecords = new Map((manifest.records || []).map((record) => [record.id, record]));
const concepts = mergeConcepts(mini.concepts || []);

async function loadFixture(id) {
  const manifestRecord = manifestRecords.get(id);
  const record = records.get(id);
  assert.ok(manifestRecord, `${id}: missing from the checked corpus manifest`);
  assert.ok(record, `${id}: missing from the deep-map/catalog records`);

  const ledger = await readJson(path.join(ROOT, "research", "ledger", "papers", `${id}.json`));
  const extraction = ledger?.stages?.extraction;
  assert.equal(extraction?.status, "complete", `${id}: extraction must be complete`);
  assert.ok(extraction?.artifacts?.pages, `${id}: extraction pages artifact is missing`);

  const pagesText = await readFile(path.resolve(ROOT, extraction.artifacts.pages), "utf8");
  if (extraction.artifacts.pagesSha256) {
    assert.equal(sha256(pagesText), extraction.artifacts.pagesSha256, `${id}: extraction pages hash is stale`);
  }
  const pagesPayload = JSON.parse(pagesText);
  const pages = pagesPayload.pages || pagesPayload;
  return {
    id,
    manifestRecord,
    record,
    pages,
    note: buildAuthoredNote(record, pagesPayload, concepts),
  };
}

const settledFixturesPromise = Promise.all(PAPER_IDS.map(async (id) => {
  try {
    return { id, status: "fulfilled", value: await loadFixture(id) };
  } catch (reason) {
    return { id, status: "rejected", reason };
  }
}));

async function fixture(id) {
  const result = (await settledFixturesPromise).find((entry) => entry.id === id);
  assert.ok(result, `${id}: paper is not in the pinned regression set`);
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

function components(note) {
  return (note.models || []).flatMap((model) => model.components || []);
}

function conditions(note) {
  return components(note).flatMap((component) => component.conditions || []);
}

function compactMath(value) {
  return cleanText(String(value || ""))
    .replace(/\\(?:left|right|mathrm|operatorname|text)/g, "")
    .replace(/[\\_$^{}()[\]\s]/g, "");
}

function hasIdentifier(value, identifier) {
  const plain = cleanText(String(value || ""))
    .replace(/\\(?:left|right|mathrm|operatorname|text)/g, "")
    .replace(/[\\_${}()[\]]/g, " ");
  return new RegExp(`(?:^|[^A-Za-z0-9])${identifier}(?:$|[^A-Za-z0-9])`).test(plain);
}

function normalizedLiteral(value) {
  return cleanText(String(value || ""))
    .replace(/[\u00ad\u200b]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function assertLiteralOnPage(fixtureValue, pageNumber, value, message) {
  const page = fixtureValue.pages.find((entry, index) => Number(entry?.page || index + 1) === pageNumber);
  assert.ok(page, `${fixtureValue.id}: extracted page ${pageNumber} is missing`);
  assert.ok(
    normalizedLiteral(page.text).includes(normalizedLiteral(value)),
    `${fixtureValue.id}: ${message}: ${JSON.stringify(value)}`,
  );
}

test("the audited real papers all build from their current extraction artifacts", async () => {
  const results = await settledFixturesPromise;
  const failures = results
    .filter((entry) => entry.status === "rejected")
    .map((entry) => `${entry.id}: ${entry.reason?.message || entry.reason}`);
  assert.deepEqual(failures, []);
});

test("batch-01 regressions retain explicit formulations with semantically local source anchors", async () => {
  const expectedModels = new Map([
    ["doi-10-1287-isre-2017-0693", /Strategic Role of Cash Back/i],
    ["doi-10-1287-isre-2017-0697", /Extensions: Relaxing Our Assumptions/i],
    ["doi-10-1287-isre-2018-0805", /Model Extension: Multidimensional Strategy/i],
    ["doi-10-1287-isre-2021-1042", /Benchmark: No Information Technology/i],
    ["doi-10-1287-isre-2022-0283", /Model for Sales Generation Process/i],
  ]);

  for (const [id, expectedName] of expectedModels) {
    const built = await fixture(id);
    assert.ok(
      built.note.models.some((model) => expectedName.test(cleanText(model.name))),
      `${id}: expected source-identified formulation was not materialized`,
    );
    const audit = validateModelNoteSemantics({
      note: built.note,
      pages: built.pages,
      concepts,
      authoringMode: "source-mapped",
    });
    const localityErrors = audit.errors.filter((entry) => entry.code === "source.quote.no-local-overlap");
    assert.deepEqual(localityErrors, [], `${id}: source anchors must overlap their local model/component`);
  }
});

test("contract extensions and named benchmarks retain their literal setup definitions", async () => {
  const contract = await fixture("doi-10-1287-mksc-2020-1237");
  const twoPart = contract.note.models.find((model) => /Two-Part Tariffs/i.test(cleanText(model.name)));
  assert.ok(twoPart, "contract paper: two-part-tariff extension is missing");
  const twoPartComponent = (twoPart.components || []).find((component) =>
    (component.conditions || []).some((condition) =>
      /extend the model to allow contracts with a fixed-payment component and per-unit prices/i.test(condition)));
  assert.ok(twoPartComponent, "contract paper: literal two-part-tariff setup condition is missing");
  assert.equal(twoPartComponent.sources[0].page, 13);
  assert.match(twoPartComponent.sources[0].section, /3\.6\. Model Extension: Two-Part Tariffs/i);
  assertLiteralOnPage(contract, 13, twoPartComponent.sources[0].quote,
    "two-part-tariff component source is not an exact raw-page clause");
  assert.doesNotMatch(twoPartComponent.sources[0].quote, /sim-?\s*ilar/i,
    "the source must not synthesize the damaged trailing comparison");

  const entry = await fixture("doi-10-1287-mksc-2020-1249");
  const benchmark = entry.note.models.find((model) => /^Two-Firm Benchmark$/i.test(cleanText(model.name)));
  assert.ok(benchmark, "platform-entry paper: two-firm benchmark is missing");
  const firms = (benchmark.components || []).find((component) =>
    (component.conditions || []).some((condition) =>
      /two-firm benchmark case, the access product is sold by two firms, A and B/i.test(condition)));
  assert.ok(firms, "platform-entry paper: benchmark must recover its shared model-section definition");
  assert.equal(firms.sources[0].page, 4);
  assert.match(firms.sources[0].section, /^3\.1\. Firms$/i);
  assertLiteralOnPage(entry, 4, firms.sources[0].quote,
    "benchmark component source is not literal page-4 model evidence");
  const benchmarkCondition = firms.conditions.find((condition) => /two-firm benchmark case/i.test(condition));
  assertLiteralOnPage(entry, 4, benchmarkCondition,
    "benchmark condition is not literal page-4 model evidence");
  assert.doesNotMatch(JSON.stringify(benchmark), /obtain our next two corollaries|Effect of Entry on Quality/i,
    "a result comparison must not replace the benchmark's setup definition");
});

test("extension setup excludes a mixed roadmap and reported-result sentence", async () => {
  const built = await fixture("doi-10-1287-mnsc-2015-2338");
  const asymmetric = components(built.note).find((component) => /^Asymmetric Firms$/i.test(cleanText(component.label)));
  assert.ok(asymmetric, "retail-merger paper: asymmetric-firms extension is missing");
  assert.equal(
    (asymmetric.conditions || []).some((condition) => /we demonstrate that our main results continue to hold/i.test(condition)),
    false,
    "a local extension roadmap must not whitelist its reported-result clause as a condition",
  );
  assert.ok(
    (asymmetric.conditions || []).some((condition) => /synergy level s is nonnegative/i.test(condition)),
    "the extension must retain its source-defined parameter restriction",
  );

  const audit = validateModelNoteSemantics({
    note: built.note,
    pages: built.pages,
    concepts,
    authoringMode: "source-mapped",
  });
  assert.deepEqual(
    audit.errors.filter((entry) => entry.code === "component.condition.result-or-contribution"),
    [],
    "generated extension conditions must agree with the independent semantic audit",
  );
});

test("audited papers never receive the generic 'Using the ...' method template", async () => {
  const results = await settledFixturesPromise;
  const offenders = results
    .filter((entry) => entry.status === "fulfilled")
    .flatMap((entry) => entry.value.note.models
      .filter((model) => /^Using the\b/i.test(cleanText(model.method)))
      .map((model) => `${entry.id}: ${model.name}: ${model.method}`));
  assert.deepEqual(offenders, []);
});

test("telehealth keeps the backward-induction method and page-local decision and equilibrium evidence", async () => {
  const { note } = await fixture("akc2025telehealthacutecare");
  const model = note.models[0];
  assert.match(model.method, /backward induction/i);

  const decision = components(note).find((component) => component.role === "decision");
  assert.ok(decision, "telehealth: expected a decision component");
  assert.ok(decision.sources.some((source) => Number(source.page) === 5), "telehealth: decision evidence must come from PDF p. 5");

  const equilibrium = components(note).find((component) =>
    component.role === "interaction"
      && /equilibrium/i.test([component.label, component.explanation, component.formal].join(" "))
  );
  assert.ok(equilibrium, "telehealth: expected an equilibrium component");
  assert.ok(equilibrium.sources.some((source) => Number(source.page) === 7), "telehealth: equilibrium evidence must come from PDF p. 7");
});

test("showrooming recovers all three staged price decisions and a clean literal extension condition", async () => {
  const built = await fixture("doi-10-1287-mnsc-2020-01990");
  const baseline = built.note.models.find((model) => model.kind === "baseline");
  const extension = built.note.models.find((model) => model.kind === "extension");
  assert.ok(baseline, "showrooming: baseline model is missing");
  assert.ok(extension, "showrooming: offline-price-observability extension is missing");

  const decisionText = baseline.decisions.join(" ");
  const compactDecisions = compactMath(decisionText);
  for (const identifier of ["pO", "wF", "pF"]) {
    assert.ok(compactDecisions.includes(identifier), `showrooming: decisions must retain ${identifier}`);
  }

  const extensionCondition = (extension.components || [])
    .flatMap((component) => component.conditions || [])
    .find((condition) => /consumers do not observe the offline price before visiting the store/i.test(condition));
  assert.ok(extensionCondition, "showrooming: the extension must state the changed observability assumption");
  assert.doesNotMatch(extensionCondition, /do not ture|litera\s*ture refers/i);
  assertLiteralOnPage(built, 15, extensionCondition, "extension condition is not literal page-15 evidence");
});

test("testing-policy deep map stays at two models and preserves the extension's actual analysis", async () => {
  const built = await fixture("doi-10-1287-mnsc-2023-02573");
  assert.equal(built.note.models.length, 2);
  const extension = built.note.models.find((model) => model.kind === "extension");
  assert.ok(extension, "testing-policy paper: extension model is missing");
  assert.match(extension.method, /characteriz\w* (?:the )?student test-taking behavior/i);
  assert.match(extension.method, /characteriz\w* equilibrium testing polic/i);

  const extensionComponents = extension.components || [];
  assert.ok(
    extensionComponents.some((component) => /student test-taking behavior/i.test([
      component.label,
      component.explanation,
      ...(component.sources || []).map((source) => source.section),
    ].join(" "))),
    "testing-policy paper: student-behavior analysis is missing",
  );
  assert.ok(
    extensionComponents.some((component) => /equilibrium testing polic/i.test([
      component.label,
      component.explanation,
      ...(component.sources || []).map((source) => source.section),
    ].join(" "))),
    "testing-policy paper: equilibrium-policy analysis is missing",
  );

  const preferenceComponent = (extension.components || []).find((component) =>
    (component.conditions || []).some((condition) => compactMath(condition).includes("v1>v2")));
  const preferenceConditionIndex = (preferenceComponent?.conditions || [])
    .findIndex((condition) => compactMath(condition).includes("v1>v2"));
  const preferenceCondition = preferenceComponent?.conditions?.[preferenceConditionIndex];
  assert.ok(preferenceCondition, "testing-policy paper: extension must retain the v1 > v2 school-preference condition");
  assertLiteralOnPage(built, 10, preferenceCondition, "v1 > v2 condition is not literal page-10 evidence");
  const preferenceEvidence = (preferenceComponent.conditionEvidence || [])
    .find((entry) => entry.conditionIndex === preferenceConditionIndex);
  assert.equal(preferenceEvidence?.inheritedFromSetupField, "assumptions");
  assert.equal(preferenceEvidence?.setupEvidence?.source?.page, 10);
  assert.equal(preferenceEvidence?.setupEvidence?.source?.section, "Extended Model");
  assert.equal(
    normalizedLiteral(preferenceEvidence?.setupEvidence?.source?.quote),
    normalizedLiteral(preferenceCondition),
    "v1 > v2 component condition must retain its exact setup-source provenance",
  );
});

test("retail-cluster setup retains t, c, and v and the genuine three-stage game", async () => {
  const { note } = await fixture("doi-10-1287-msom-2017-0663");
  const baseline = note.models.find((model) => model.kind === "baseline") || note.models[0];
  const expectedInputs = [
    { symbol: "t", meaning: /transportation cost/i },
    { symbol: "c", meaning: /(?:marginal|production) cost/i },
    { symbol: "v", meaning: /maximum valuation/i },
  ];
  for (const { symbol, meaning } of expectedInputs) {
    assert.ok(
      baseline.inputs.some((input) => meaning.test(input) && hasIdentifier(input, symbol)),
      `retail clusters: inputs must define ${symbol}`,
    );
  }

  assert.match(baseline.method, /backward induction/i);
  const decisionText = baseline.decisions.join(" ");
  assert.match(decisionText, /physical locations?/i, "retail clusters: Stage 1 location decisions are missing");
  assert.match(decisionText, /(?:shopping|shop at a) location/i, "retail clusters: Stage 2 shopping-location decisions are missing");
  assert.match(decisionText, /prices?/i, "retail clusters: Stage 3 price decisions are missing");
});

test("marketing-volatility note excludes researcher actions and table-footnote fragments", async () => {
  const { note } = await fixture("doi-10-1287-mnsc-2014-2102");
  const authoredText = JSON.stringify(note);
  const baseline = note.models.find((model) => model.kind === "baseline") || note.models[0];
  assert.ok(baseline.decisions.some((decision) => /optimal marketing spending policy/i.test(decision)));
  assert.ok(baseline.setupEvidence.decisions.some(({ source }) => Number(source.page) === 6));
  assert.doesNotMatch(authoredText, /test our propositions/i);
  assert.doesNotMatch(authoredText, /test whether/i);
  assert.doesNotMatch(authoredText, /reported cell values/i);
  assert.doesNotMatch(authoredText, /\b(?:bLevel|cBecause)\b/);
});

test("cross-licensing keeps a backward-solution Analysis component without extraction splice artifacts", async () => {
  const { note } = await fixture("doi-10-1287-msom-2019-0477");
  const authoredText = JSON.stringify(note);
  assert.doesNotMatch(authoredText, /49\s+144/i);
  assert.doesNotMatch(authoredText, /invest in pare/i);
  assert.doesNotMatch(authoredText, /Surplus and Social Welfare\s+Cross-Licensing/i);

  const embeddedPartTwo = conditions(note).filter((condition) => /[.!?]\s*\(ii\)/i.test(condition));
  assert.deepEqual(embeddedPartTwo, [], `cross-licensing: embedded proposition part (ii): ${JSON.stringify(embeddedPartTwo)}`);

  const analysis = components(note).find((component) => /^Analysis$/i.test(cleanText(component.label)));
  assert.ok(analysis, "cross-licensing: Analysis component is missing");
  assert.equal(analysis.role, "algorithm");
  assert.ok(analysis.sources.some((source) => Number(source.page) === 6), "cross-licensing: Analysis evidence must come from PDF p. 6");
  assert.match([
    analysis.explanation,
    analysis.formal,
    ...(analysis.sources || []).map((source) => source.quote),
  ].join(" "), /solve the game backward/i);
});

test("multi-column fallback text cannot contaminate clean source-span conditions", async () => {
  const { note } = await fixture("doi-10-1287-isre-2016-0636");
  const authoredText = JSON.stringify(note);
  const firstComponent = components(note)[0];
  assert.ok(firstComponent?.sources?.[0]?.quote);
  assert.notEqual(firstComponent.explanation, firstComponent.sources[0].quote,
    "public component prose must not duplicate its internal source excerpt");
  assert.ok(!firstComponent.conditions.includes(firstComponent.sources[0].quote),
    "the primary internal source excerpt must not be repeated as a public condition");
  for (const evidence of firstComponent.conditionEvidence || []) {
    assert.ok(evidence.conditionIndex >= 0 && evidence.conditionIndex < firstComponent.conditions.length,
      "condition evidence must reference the retained public-condition indices");
  }
  for (const binding of firstComponent.conceptBindings || []) {
    for (const conditionIndex of binding.conditionRefs || []) {
      assert.ok(conditionIndex >= 0 && conditionIndex < firstComponent.conditions.length,
        "concept bindings must reference the retained public-condition indices");
    }
  }
  assert.doesNotMatch(firstComponent.sources[0].quote, /Vendor rejects No collaboration/i);
  assert.doesNotMatch(authoredText, /\(a\) Without fixed cost of monitoring\s+0\.25/i);
  assert.doesNotMatch(authoredText, /salvage (?:utation|success, reflected).+successful the vendor/is);
  assert.ok(conditions(note).some((condition) => /value obtained after the collaboration period.+salvage value/i.test(condition)));
  const salvage = components(note).find((component) => /client.s choice of payment structure/i.test(component.label));
  assert.ok(salvage);
  assert.match(salvage.sources[0].quote, /^Here, we consider that the client or the vendor gets utility/i);
  assert.doesNotMatch(salvage.formal, /Salvage Value Here/i);
});

test("calibrated workforce numerics inherit modeled controls instead of research procedures", async () => {
  const { note } = await fixture("besbes2024workforceschedulingheterogeneous");
  const baseline = note.models.find((model) => model.kind === "baseline") || note.models[0];
  const numerics = note.models.find((model) => /Numerics on a Calibrated Model/i.test(model.name));
  assert.ok(numerics, "workforce scheduling: calibrated numerical model is missing");
  assert.match(baseline.method, /characterize their performance with respect to the platform’s ability to gather the required supply/i);
  assert.doesNotMatch(baseline.method, /^these estimates allow us/i);
  assert.equal(
    numerics.method,
    "The paper performs simulations based on parameters calibrated using an NYC ride-hailing data set to compare the performance of the various mechanisms."
  );
  assert.doesNotMatch(numerics.method, /available side parameters|we discuss the details of calibrating/i);
  assert.match(numerics.decisions.join(" "), /DC, FCFS, or PFCFS allocation mechanism/i);
  assert.doesNotMatch(
    numerics.decisions.join(" "),
    /perform (?:simulations?|sensitivity analysis)|compare the performance|policy used by Via/i,
  );
});

test("product-diffusion setup retains literal firm controls and rejects method, precedent, and outcomes", async () => {
  const built = await fixture("doi-10-1287-isre-2017-0720");
  const baseline = built.note.models.find((model) => model.kind === "baseline") || built.note.models[0];
  assert.deepEqual(baseline.decisions, ["Price, discount, and release time"]);
  const evidence = baseline.setupEvidence.decisions[0];
  assert.equal(evidence.source.page, 11);
  assert.equal(evidence.source.matchedText, "price, discount, and release time");
  assertLiteralOnPage(built, 11, evidence.source.quote, "firm controls are not literal page-11 evidence");
  assert.doesNotMatch(
    JSON.stringify(baseline.setupEvidence.decisions),
    /Stokey \(1981\)|wrong time|numerical optimization|delays its own market expansion/i,
  );
});
