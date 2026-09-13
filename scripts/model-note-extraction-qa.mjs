import { EXTRACTION_QA_BINDING_KEYS } from "./extraction-qa.mjs";

/**
 * Model-note consumers have two deliberately different gates:
 *
 * - public release work requires an effective `complete` checkpoint;
 * - internal authoring/candidate work may also retain a current, reproducible
 *   `needs_review` checkpoint as explicit provenance.
 *
 * This adapter lives outside extraction-qa.mjs because that producer's exact
 * file bytes are part of every extraction-QA decision identity. Changing a
 * downstream release policy must not invalidate the underlying QA evidence.
 */
export function modelNoteExtractionQaCheckpointUsable(checkpoint, { allowNeedsReview = false } = {}) {
  return Boolean(checkpoint?.ok)
    && checkpoint.state === "current"
    && (checkpoint.effectiveStatus === "complete"
      || (allowNeedsReview && checkpoint.effectiveStatus === "needs_review"));
}

export function modelNoteExtractionQaCheckpointBinding(checkpoint, { allowNeedsReview = false } = {}) {
  if (!modelNoteExtractionQaCheckpointUsable(checkpoint, { allowNeedsReview })) {
    const requirement = allowNeedsReview ? "terminal" : "release-ready";
    throw new Error(`Extraction QA checkpoint is not ${requirement} (${checkpoint?.reason || checkpoint?.state || "missing"})`);
  }
  const binding = {
    extractionQaStatus: checkpoint.effectiveStatus,
    extractionQaAutomatedStatus: checkpoint.decision.status,
    extractionQaInputDigest: checkpoint.inputDigest,
    extractionQaDecisionPath: checkpoint.decisionPath,
    extractionQaDecisionSha256: checkpoint.decisionSha256,
    extractionQaAdjudicationStatus: checkpoint.adjudication?.disposition
      || (checkpoint.effectiveStatus === "needs_review" ? "pending" : "not_required"),
    extractionQaAdjudicationPath: checkpoint.adjudicationPath || null,
    extractionQaAdjudicationSha256: checkpoint.adjudicationSha256 || null
  };
  if (Object.keys(binding).length !== EXTRACTION_QA_BINDING_KEYS.length
    || EXTRACTION_QA_BINDING_KEYS.some((key) => !(key in binding))) {
    throw new Error("Model-note Extraction QA binding keys diverge from the extraction contract");
  }
  return binding;
}
