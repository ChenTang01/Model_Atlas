import assert from "node:assert/strict";
import test from "node:test";

import { extractionQaCheckpointBinding } from "../scripts/extraction-qa.mjs";
import {
  modelNoteExtractionQaCheckpointBinding,
  modelNoteExtractionQaCheckpointUsable
} from "../scripts/model-note-extraction-qa.mjs";

function checkpoint(effectiveStatus = "complete", additions = {}) {
  return {
    ok: true,
    state: "current",
    effectiveStatus,
    inputDigest: "1".repeat(64),
    decisionPath: "research/ledger/extraction-qa/paper/decision.json",
    decisionSha256: "2".repeat(64),
    decision: { status: effectiveStatus },
    ...additions
  };
}

test("the model-note adapter is byte-for-byte compatible with a complete QA binding", () => {
  const current = checkpoint();
  assert.deepEqual(modelNoteExtractionQaCheckpointBinding(current), extractionQaCheckpointBinding(current));
  assert.equal(modelNoteExtractionQaCheckpointUsable(current), true);
});

test("internal candidates retain needs_review while public release binding remains strict", () => {
  const current = checkpoint("needs_review", {
    reason: "manual_review_incomplete",
    adjudicationPath: "research/ledger/extraction-qa/paper/adjudication.json"
  });
  assert.equal(modelNoteExtractionQaCheckpointUsable(current), false);
  assert.equal(modelNoteExtractionQaCheckpointUsable(current, { allowNeedsReview: true }), true);
  assert.throws(() => modelNoteExtractionQaCheckpointBinding(current), /not release-ready/);
  assert.deepEqual(modelNoteExtractionQaCheckpointBinding(current, { allowNeedsReview: true }), {
    extractionQaStatus: "needs_review",
    extractionQaAutomatedStatus: "needs_review",
    extractionQaInputDigest: "1".repeat(64),
    extractionQaDecisionPath: "research/ledger/extraction-qa/paper/decision.json",
    extractionQaDecisionSha256: "2".repeat(64),
    extractionQaAdjudicationStatus: "pending",
    extractionQaAdjudicationPath: "research/ledger/extraction-qa/paper/adjudication.json",
    extractionQaAdjudicationSha256: null
  });
});

test("stale, failed, and rejected checkpoints cannot enter an internal candidate", () => {
  for (const invalid of [
    checkpoint("needs_review", { state: "stale", reason: "binding_mismatch" }),
    checkpoint("failed", { state: "incomplete", reason: "qa_validation_failed" }),
    checkpoint("failed", {
      state: "incomplete",
      reason: "manual_review_rejected",
      adjudication: { disposition: "rejected" }
    })
  ]) {
    assert.equal(modelNoteExtractionQaCheckpointUsable(invalid, { allowNeedsReview: true }), false);
    assert.throws(
      () => modelNoteExtractionQaCheckpointBinding(invalid, { allowNeedsReview: true }),
      /not terminal/
    );
  }
});
