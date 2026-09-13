import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyExtractionQaCheckpoint } from "../scripts/extraction-qa.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPORT_PATH = path.join(ROOT, "research", "ledger", "extraction-visual-scope-review.v1.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

function resolveWithinRoot(relativePath, label) {
  assert.equal(typeof relativePath, "string", `${label}: path must be a string`);
  assert.equal(path.isAbsolute(relativePath), false, `${label}: path must be project-relative`);
  const resolved = path.resolve(ROOT, ...relativePath.split("/"));
  const relative = path.relative(ROOT, resolved);
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${label}: path escapes the project root`);
  return resolved;
}

const [report, manifest] = await Promise.all([
  readJson(REPORT_PATH),
  readJson(path.join(ROOT, "research", "corpus", "manifest.v1.json"))
]);
const manifestById = new Map(manifest.records.map((record) => [record.id, record]));

test("the visual scope report retains the two current-corpus historical reviews without granting release authority", () => {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.reportVersion, "extraction-visual-scope-review-v1");
  assert.deepEqual(report.authority, {
    changesExtractionQaDisposition: false,
    authorizesAdjudication: false,
    authorizesPromotion: false,
    authorizesPublicRelease: false
  });
  assert.equal(report.accounting.expectedEntries, 2);
  assert.equal(report.entries.length, 2);
  assert.deepEqual(report.entries.map((entry) => entry.paperId).sort(), [
    "doi-10-1287-mksc-2019-1201",
    "doi-10-1287-msom-2019-0815"
  ]);
  assert.equal(new Set(report.entries.map((entry) => entry.paperId)).size, 2);
  assert.equal(report.entries.filter((entry) => entry.reviewDisposition === "needs_review").length, 2);
  assert.equal(report.entries.filter((entry) => entry.proseAuthoringAllowed === true).length, 2);
  assert.equal(report.entries.filter((entry) => entry.formalMathAllowed === true).length, 0);
  assert.equal(report.entries.filter((entry) => entry.structuredFigureTableAllowed === true).length, 0);
  assert.deepEqual(report.accounting, {
    expectedEntries: 2,
    recordedEntries: 2,
    uniquePaperIds: 2,
    hashBoundEntries: 2,
    needsReviewEntries: 2,
    proseAuthoringAllowedEntries: 2,
    formalMathAllowedEntries: 0,
    structuredFigureTableAllowedEntries: 0
  });
});

test("every visual scope entry remains byte-bound to current source, extraction, and QA evidence", async () => {
  const bindingLines = [];
  for (const entry of [...report.entries].sort((left, right) => left.paperId.localeCompare(right.paperId))) {
    const manifestRecord = manifestById.get(entry.paperId);
    assert.ok(manifestRecord, `${entry.paperId}: missing manifest record`);
    const ledger = await readJson(path.join(ROOT, "research", "ledger", "papers", `${entry.paperId}.json`));
    const checkpoint = await verifyExtractionQaCheckpoint(ROOT, manifest, manifestRecord, ledger, { requireComplete: false });
    assert.equal(checkpoint.ok, true, `${entry.paperId}: QA checkpoint is not reproducible`);
    assert.equal(checkpoint.state, "current", `${entry.paperId}: QA checkpoint is stale`);
    assert.equal(checkpoint.effectiveStatus, "complete", `${entry.paperId}: later QA adjudication is not current and accepted`);
    assert.equal(entry.qaDecision.path, checkpoint.decisionPath, `${entry.paperId}: QA decision path drift`);
    assert.equal(entry.qaDecision.sha256, checkpoint.decisionSha256, `${entry.paperId}: QA decision hash drift`);

    for (const [label, relativePath, expectedSha256] of [
      ["source PDF", entry.sourcePdf.path, entry.sourcePdf.sha256],
      ["pages extraction", entry.productionExtraction.pagesPath, entry.productionExtraction.pagesSha256],
      ["text extraction", entry.productionExtraction.textPath, entry.productionExtraction.textSha256],
      ["QA decision", entry.qaDecision.path, entry.qaDecision.sha256]
    ]) {
      const bytes = await readFile(resolveWithinRoot(relativePath, `${entry.paperId}: ${label}`));
      assert.equal(sha256(bytes), expectedSha256, `${entry.paperId}: ${label} hash drift`);
    }

    const reviewedPages = new Set(entry.reviewedPages);
    assert.ok(entry.requiredPages.length > 0, `${entry.paperId}: required pages are missing`);
    assert.ok(entry.diagnosticPages.length > 0, `${entry.paperId}: diagnostic pages are missing`);
    for (const page of [...entry.requiredPages, ...entry.diagnosticPages]) {
      assert.ok(Number.isInteger(page) && page > 0, `${entry.paperId}: invalid reviewed page`);
      assert.ok(reviewedPages.has(page), `${entry.paperId}: page ${page} is not accounted for`);
    }
    assert.ok(entry.pageObservations.length > 0, `${entry.paperId}: visual observations are missing`);
    assert.ok(entry.proseScope.length > 0, `${entry.paperId}: prose allowance is not scoped`);
    assert.ok(entry.explicitExclusions.length > 0, `${entry.paperId}: formal/structured exclusions are missing`);

    bindingLines.push([
      entry.paperId,
      entry.sourcePdf.sha256,
      entry.productionExtraction.pagesSha256,
      entry.productionExtraction.textSha256
    ].join("\t") + "\n");
  }
  assert.equal(sha256(bindingLines.join("")), report.restartSafety.bindingSetSha256);
});
