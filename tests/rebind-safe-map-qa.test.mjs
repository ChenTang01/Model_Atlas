import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256, stableStringify } from "../scripts/corpus-pipeline.mjs";
import {
  SAFE_MAP_QA_REBIND_CODE_SHA256,
  SAFE_MAP_QA_REBIND_POLICY_SHA256,
  SAFE_MAP_QA_REBIND_VERSION,
  inspectSafeMapQaRebind,
  parseSafeMapQaRebindCli
} from "../scripts/rebind-safe-map-qa.mjs";

const transactionDirectory = "research/ledger/safe-map-qa-provenance-rebind";
const paperId = "doi-10-1000-safe-map-rebind";

function absolute(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

async function write(root, relativePath, bytes) {
  const filename = absolute(root, relativePath);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, bytes);
}

function contentRecord(value) {
  return { ...value, recordDigest: sha256(stableStringify(value)) };
}

test("safe-map QA rebind CLI requires an explicit digest for transaction inspection", () => {
  assert.equal(parseSafeMapQaRebindCli(["prepare"]).command, "prepare");
  assert.equal(parseSafeMapQaRebindCli(["rebind", "--json"]).json, true);
  assert.throws(() => parseSafeMapQaRebindCli(["commit"]), /--digest/);
  assert.throws(() => parseSafeMapQaRebindCli(["status", "--digest", "not-a-hash"]), /SHA-256/);
});

test("transaction inspection recognizes restartable partial state and fails closed on unknown target bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-safe-map-qa-rebind-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reportPath = "research/ledger/extraction-visual-scope-review.v1.json";
  const safeMapPath = `research/model-note-safe-maps/v1/${paperId}.json`;
  const reportBefore = Buffer.from("{\"state\":\"report-before\"}\n");
  const reportAfter = Buffer.from("{\"state\":\"report-after\"}\n");
  const safeMapBefore = Buffer.from("{\"state\":\"safe-map-before\"}\n");
  const safeMapAfter = Buffer.from("{\"state\":\"safe-map-after\"}\n");
  const fake = (character) => character.repeat(64);
  const input = {
    schemaVersion: 1,
    stage: "safeMapQaProvenanceRebindInput",
    producerVersion: SAFE_MAP_QA_REBIND_VERSION,
    producerCodeSha256: SAFE_MAP_QA_REBIND_CODE_SHA256,
    policySha256: SAFE_MAP_QA_REBIND_POLICY_SHA256,
    visualReport: { path: reportPath, sha256: sha256(reportBefore) },
    papers: [{
      paperId,
      sourcePdfSha256: fake("a"),
      pagesPath: "research/ledger/artifacts/test/pages.json",
      pagesSha256: fake("b"),
      textPath: "research/ledger/artifacts/test/text.txt",
      textSha256: fake("c"),
      unresolvedReasons: ["parser_warning"],
      sourceReasons: ["parser_warning"],
      manualReviewRequirements: { requiredPages: [1], triggerCoverage: [] },
      previousQa: { path: "research/ledger/extraction-qa/old.json", sha256: fake("d") },
      currentQa: { path: "research/ledger/extraction-qa/new.json", sha256: fake("e") },
      safeMap: { path: safeMapPath, sha256: sha256(safeMapBefore) }
    }]
  };
  const digest = sha256(stableStringify(input));
  const snapshotBase = `${transactionDirectory}/${digest}/snapshots`;
  const targets = [{
    role: "visual_report",
    paperId: null,
    path: reportPath,
    beforeSha256: sha256(reportBefore),
    afterSha256: sha256(reportAfter),
    beforeSnapshotPath: `${snapshotBase}/before/visual-report.json`,
    afterSnapshotPath: `${snapshotBase}/after/visual-report.json`
  }, {
    role: "safe_map",
    paperId,
    path: safeMapPath,
    beforeSha256: sha256(safeMapBefore),
    afterSha256: sha256(safeMapAfter),
    beforeSnapshotPath: `${snapshotBase}/before/${paperId}.json`,
    afterSnapshotPath: `${snapshotBase}/after/${paperId}.json`
  }];
  const prepare = contentRecord({
    schemaVersion: 1,
    stage: "safeMapQaProvenanceRebindPrepare",
    producerVersion: SAFE_MAP_QA_REBIND_VERSION,
    producerCodeSha256: SAFE_MAP_QA_REBIND_CODE_SHA256,
    policySha256: SAFE_MAP_QA_REBIND_POLICY_SHA256,
    transactionInputDigest: digest,
    input,
    targets,
    preparedAt: "2026-09-13T00:00:00.000Z"
  });
  await Promise.all([
    write(root, reportPath, reportBefore),
    write(root, safeMapPath, safeMapBefore),
    write(root, targets[0].beforeSnapshotPath, reportBefore),
    write(root, targets[0].afterSnapshotPath, reportAfter),
    write(root, targets[1].beforeSnapshotPath, safeMapBefore),
    write(root, targets[1].afterSnapshotPath, safeMapAfter),
    write(root, `${transactionDirectory}/${digest}/prepare/${prepare.recordDigest}.json`,
      Buffer.from(`${stableStringify(prepare, 2)}\n`))
  ]);

  const prepared = await inspectSafeMapQaRebind({ root, transactionInputDigest: digest });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.state, "prepared");

  await write(root, reportPath, reportAfter);
  const partial = await inspectSafeMapQaRebind({ root, transactionInputDigest: digest });
  assert.equal(partial.ok, true);
  assert.equal(partial.state, "partially_committed");

  await write(root, safeMapPath, Buffer.from("unknown concurrent bytes"));
  const failed = await inspectSafeMapQaRebind({ root, transactionInputDigest: digest });
  assert.equal(failed.ok, false);
  assert.equal(failed.state, "failed_closed");
  assert.ok(failed.issues.some((issue) => issue.includes(`unknown_target_sha:${safeMapPath}`)));
});
