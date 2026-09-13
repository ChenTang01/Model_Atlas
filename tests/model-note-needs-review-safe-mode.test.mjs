import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyExtractionQaCheckpoint } from "../scripts/extraction-qa.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RAW_WARNING_IDS = Object.freeze([
  "doi-10-1287-mksc-2019-1201",
  "doi-10-1287-msom-2019-0815"
]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, ...relativePath.split("/")), "utf8"));
}

const manifest = await readJson("research/corpus/manifest.v1.json");
const manifestById = new Map(manifest.records.map((record) => [record.id, record]));

test("the retired blocker corpus leaves exactly two raw parser-warning papers", () => {
  const observed = manifest.records
    .filter((record) => record.pdf.parse.status === "ok_with_warnings")
    .map((record) => record.id)
    .sort();
  assert.deepEqual(observed, RAW_WARNING_IDS);
  assert.equal(manifest.counts.parserWarningPdfs, RAW_WARNING_IDS.length);
});

test("all remaining parser warnings are current, hash-bound, and terminally accepted by adjudication", async () => {
  const terminalNeedsReview = [];
  for (const id of RAW_WARNING_IDS) {
    const record = manifestById.get(id);
    assert.ok(record, `${id}: missing manifest record`);
    const ledger = await readJson(`research/ledger/papers/${id}.json`);
    assert.equal(ledger.stages.extractQa.status, "needs_review", `${id}: raw warning disposition`);

    const checkpoint = await verifyExtractionQaCheckpoint(ROOT, manifest, record, ledger, { requireComplete: false });
    assert.equal(checkpoint.ok, true, `${id}: QA checkpoint is not reproducible`);
    assert.equal(checkpoint.state, "current", `${id}: QA checkpoint is stale`);
    assert.equal(checkpoint.effectiveStatus, "complete", `${id}: adjudication is not terminally accepted`);
    assert.match(checkpoint.decisionSha256, /^[a-f0-9]{64}$/u, `${id}: decision hash`);
    assert.match(checkpoint.adjudicationSha256, /^[a-f0-9]{64}$/u, `${id}: adjudication hash`);
    assert.equal(checkpoint.adjudication?.disposition, "accepted", `${id}: adjudication disposition`);
    assert.equal(checkpoint.adjudication?.automatedDecisionSha256, checkpoint.decisionSha256, `${id}: adjudication binding`);
    if (checkpoint.effectiveStatus === "needs_review") terminalNeedsReview.push(id);
  }
  assert.deepEqual(terminalNeedsReview, [], "no current paper should require safe-mode authoring");
});
