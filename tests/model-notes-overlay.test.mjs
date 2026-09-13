import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [mainBytes, overlay, snapshotSource, corpusManifest] = await Promise.all([
  readFile(path.join(root, "data", "atlas_articles.json")),
  readFile(path.join(root, "data", "model_notes.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "data", "model_notes.js"), "utf8"),
  readFile(path.join(root, "research", "corpus", "manifest.v1.json"), "utf8").then(JSON.parse)
]);
const mainPayload = JSON.parse(mainBytes);
const manifestById = new Map(corpusManifest.records.map((record) => [record.id, record]));

// Freeze the distributable 30-note editorial content itself. Provenance is
// operational state refreshed by the local pipeline, not editorial content.
const EXPECTED_EDITORIAL_SHA256 = "6ce5f2b78ec88b06ac627766fa905af506a0a28827aac9f17866bd86e374411f";
const EXPECTED_CROSSWALK = Object.freeze([
  ["P001", "doi-10-1287-msom-2025-0215"],
  ["P002", "doi-10-1287-msom-2024-1575"],
  ["P003", "doi-10-1287-mnsc-2020-3585"],
  ["P004", "doi-10-1287-mnsc-2023-03738"],
  ["P005", "doi-10-1287-mksc-2020-1280"],
  ["P006", "doi-10-1287-msom-2024-0852"],
  ["P007", "doi-10-1287-msom-2022-0572"],
  ["P008", "doi-10-1287-mnsc-2020-3656"],
  ["P009", "doi-10-1287-mnsc-2022-4415"],
  ["P010", "doi-10-1287-msom-2021-0993"],
  ["P011", "doi-10-1287-mnsc-2025-03558"],
  ["P012", "doi-10-1287-mnsc-2022-4614"],
  ["P013", "doi-10-1287-isre-2017-0692"],
  ["P014", "doi-10-1287-mnsc-2023-00316"],
  ["P015", "doi-10-1287-msom-2023-0057"],
  ["P016", "doi-10-1287-isre-2023-0659"],
  ["P017", "doi-10-1287-msom-2023-0081"],
  ["P018", "doi-10-1287-isre-2023-0258"],
  ["P019", "doi-10-1287-mnsc-2021-4171"],
  ["P020", "doi-10-1287-isre-2025-2166"],
  ["P021", "doi-10-1287-mnsc-2024-05215"],
  ["P022", "doi-10-1287-msom-2024-0984"],
  ["P023", "doi-10-1287-mnsc-2023-03479"],
  ["P024", "doi-10-1287-msom-2021-1066"],
  ["P025", "doi-10-1287-mnsc-2022-00490"],
  ["P026", "doi-10-1287-mnsc-2018-3089"],
  ["P027", "doi-10-1287-msom-2022-0497"],
  ["P028", "doi-10-1287-msom-2017-0703"],
  ["P029", "doi-10-1287-mksc-2015-0945"],
  ["P030", "nageswaran2026roleproductquality"]
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function numericRankPaths(value, pathParts = [], output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => numericRankPaths(entry, [...pathParts, index], output));
    return output;
  }
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = [...pathParts, key];
    if (key.toLowerCase().includes("rank") && typeof entry === "number") {
      output.push(entryPath.join("."));
    }
    numericRankPaths(entry, entryPath, output);
  }
  return output;
}

test("the model-note overlay retains the frozen deterministic 30-paper crosswalk", () => {
  assert.equal(overlay.schemaVersion, 2);
  assert.equal(String(overlay.sourceSchemaVersion), "3.1");
  assert.equal(overlay.sourceDataSha256, sha256(mainBytes), "the release is bound to the complete current catalog");
  const referencePapers = overlay.papers
    .filter((paper) => paper.referenceFixtureId)
    .sort((left, right) => left.referenceFixtureId.localeCompare(right.referenceFixtureId));
  const editorialContent = referencePapers.map(({ provenance, ...paper }) => paper);
  assert.equal(sha256(JSON.stringify(editorialContent)), EXPECTED_EDITORIAL_SHA256,
    "the published frozen editorial content has not drifted");
  assert.deepEqual(
    referencePapers.map((paper) => [paper.referenceFixtureId, paper.sourceId]),
    EXPECTED_CROSSWALK
  );
  assert.ok(overlay.papers.every((paper) => paper.id === paper.sourceId));
  assert.equal(new Set(overlay.papers.map((paper) => paper.id)).size, mainPayload.records.length);

  const snapshotMatch = snapshotSource.match(/window\.AtlasModelNotes=(.*);\s*$/s);
  assert.ok(snapshotMatch, "the direct-file snapshot publishes AtlasModelNotes");
  const snapshot = JSON.parse(snapshotMatch[1]);
  assert.deepEqual(snapshot, overlay, "JSON and direct-file JavaScript snapshots stay identical");
});

test("every overlay ID resolves to one main record and one hash-pinned private PDF", () => {
  for (const note of overlay.papers) {
    const matches = mainPayload.records.filter((paper) => paper.id === note.id);
    assert.equal(matches.length, 1, `${note.referenceFixtureId}: resolves exactly once in the main corpus`);
    const [paper] = matches;
    assert.equal(note.sourceId, paper.id, `${note.referenceFixtureId}: stable main ID`);
    assert.equal(note.doi.toLowerCase(), paper.doi.toLowerCase(), `${note.referenceFixtureId}: DOI match`);
    assert.equal(note.sha256.toLowerCase(), paper.pdf_sha256.toLowerCase(), `${note.referenceFixtureId}: recorded PDF hash match`);
    const source = manifestById.get(paper.id);
    assert.ok(source, `${note.referenceFixtureId}: private corpus manifest entry exists`);
    assert.equal(source.pdf.path, `paper/${paper.pdf_file}`, `${note.referenceFixtureId}: private PDF path match`);
    assert.equal(source.pdf.sha256.toLowerCase(), note.sha256.toLowerCase(), `${note.referenceFixtureId}: manifest PDF hash match`);
  }
});

test("overlay schema counts are exact and editorial data persists no numeric ranks", () => {
  const actual = {
    papers: overlay.papers.length,
    concepts: overlay.concepts.length,
    models: 0,
    components: 0,
    bindings: 0,
    relationships: 0,
    extractionQa: { complete: 0, needs_review: 0 }
  };
  const bindingStatuses = new Map();
  for (const paper of overlay.papers) {
    const qaStatus = paper.provenance?.extractionQaStatus;
    assert.ok(Object.hasOwn(actual.extractionQa, qaStatus), `${paper.id}: recognized effective Extraction QA status`);
    actual.extractionQa[qaStatus] += 1;
    actual.models += paper.models.length;
    for (const model of paper.models) {
      actual.components += model.components.length;
      actual.relationships += (model.relationships || []).length;
      for (const component of model.components) {
        actual.bindings += (component.conceptBindings || []).length;
        for (const binding of component.conceptBindings || []) {
          bindingStatuses.set(binding.status, (bindingStatuses.get(binding.status) || 0) + 1);
        }
      }
    }
  }

  assert.deepEqual(overlay.audit, {
    papers: 1653,
    concepts: 190,
    models: 2636,
    components: 11529,
    bindings: 13722,
    relationships: 980,
    tiers: {
      "mini-editorial": 30,
      curated: 10,
      "metadata-enriched": 292,
      "source-mapped": 1321
    },
    extractionQa: {
      complete: 1653,
      needs_review: 0
    }
  });
  const { tiers: ignoredTiers, ...auditCounts } = overlay.audit;
  assert.deepEqual(actual, auditCounts);
  assert.equal(bindingStatuses.get("modeled"), 13705);
  assert.equal(bindingStatuses.get("explicitlyExcluded"), 16);
  assert.equal(bindingStatuses.get("backgroundOnly"), 1);
  assert.equal(bindingStatuses.size, 3);
  assert.deepEqual(numericRankPaths(overlay), [], "relevance order is derived query state, not persisted metadata");
});
