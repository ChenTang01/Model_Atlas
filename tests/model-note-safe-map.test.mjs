import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { safeMapBindingsMatch } from "../scripts/author-model-notes.mjs";
import {
  SAFE_MAP_REVIEW_VERSION,
  SAFE_MAP_SCHEMA_VERSION,
  SAFE_MAP_VERSION,
  SAFE_MAP_AUTHORING_MODE,
  SAFE_MAP_FORMAL_KIND,
  VISUAL_SCOPE_REPORT_PATH,
  loadBoundSafeMap,
  materializeSafeMapNote,
  safeMapEnvelopeBindings,
  safeMapInputDigest,
  safeMapRelativePath,
  validateBoundSafeMapEnvelope,
  validateProseOnlySafeMapNote
} from "../scripts/model-note-safe-map.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const fakeHash = (character) => character.repeat(64);

async function writeJson(root, relativePath, value) {
  const filename = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filename), { recursive: true });
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filename, raw, "utf8");
  return { filename, raw, sha256: hash(raw) };
}

function source(page, section, quote) {
  return { page, section, quote };
}

async function fixture({
  questionSentence = "The platform must decide how to assign customer requests to available capacity.",
  questionText = "How should the platform assign customer requests to available capacity?",
  arrivalSentence = "Requests arrive before allocation begins."
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-safe-map-"));
  const record = {
    id: "doi-10-1287-test-2026-0001",
    pdf_sha256: fakeHash("a"),
    title: "Allocating Requests to Capacity",
    primary_topic: "Resource allocation"
  };
  const qaBinding = {
    extractionQaStatus: "needs_review",
    extractionQaDecisionSha256: fakeHash("d")
  };
  const modelSentence = "The platform serves customer requests using available capacity.";
  const decisionSentence = "The platform chooses an assignment for each request.";
  const capacitySentence = "Each unit of capacity can serve at most one request.";
  const methodSentence = "The paper solves the allocation problem by ranking customer requests before assigning capacity.";
  const pagesPayload = {
    paperId: record.id,
    pdfSha256: record.pdf_sha256,
    pages: [{
      page: 1,
      text: `2. Model Setup\n${questionSentence} ${modelSentence} ${decisionSentence} ${arrivalSentence} ${capacitySentence} ${methodSentence}`
    }]
  };
  const pagesRaw = `${JSON.stringify(pagesPayload, null, 2)}\n`;
  const pagesSha256 = hash(pagesRaw);
  const visualReport = {
    schemaVersion: 1,
    reportVersion: "extraction-visual-scope-review-v1",
    entries: [{
      paperId: record.id,
      sourcePdf: { sha256: record.pdf_sha256 },
      productionExtraction: { pagesSha256, textSha256: fakeHash("b") },
      qaDecision: { sha256: qaBinding.extractionQaDecisionSha256 },
      proseAuthoringAllowed: true,
      formalMathAllowed: false,
      structuredFigureTableAllowed: false,
      reviewDisposition: "needs_review",
      reviewVersion: "extraction-visual-scope-review-v1"
    }]
  };
  const visual = await writeJson(root, VISUAL_SCOPE_REPORT_PATH, visualReport);
  const setupSection = "2. Model Setup";
  const spec = {
    schemaVersion: SAFE_MAP_SCHEMA_VERSION,
    safeMapVersion: SAFE_MAP_VERSION,
    paperId: record.id,
    sourcePdfSha256: record.pdf_sha256,
    extractionPagesSha256: pagesSha256,
    visualScopeReview: {
      path: VISUAL_SCOPE_REPORT_PATH,
      sha256: visual.sha256,
      entryBinding: {
        qaDecisionSha256: qaBinding.extractionQaDecisionSha256,
        textSha256: fakeHash("b"),
        reviewDisposition: "needs_review",
        reviewVersion: "extraction-visual-scope-review-v1"
      },
      formalMathAllowed: false,
      structuredFigureTableAllowed: false
    },
    review: {
      status: "approved",
      reviewerRole: "independent_content_qa",
      reviewedAt: "2026-09-12",
      version: SAFE_MAP_REVIEW_VERSION
    },
    question: {
      text: questionText,
      source: source(1, setupSection, questionSentence)
    },
    overview: {
      text: "The model studies how the platform assigns customer requests to available capacity before allocation begins.",
      sources: [source(1, setupSection, modelSentence), source(1, setupSection, arrivalSentence)]
    },
    models: [{
      id: "request-allocation-model",
      name: "Request Allocation Model",
      kind: "baseline",
      relation: "",
      summary: {
        text: "The platform assigns customer requests while respecting its available capacity.",
        sources: [source(1, setupSection, modelSentence), source(1, setupSection, capacitySentence)]
      },
      setup: {
        objects: [{ value: "The platform", source: source(1, setupSection, modelSentence) }],
        inputs: [{ value: "customer requests", source: source(1, setupSection, modelSentence) }],
        decisions: [{ value: "an assignment for each request", source: source(1, setupSection, decisionSentence) }],
        assumptions: [{ value: "Requests arrive before allocation begins", source: source(1, setupSection, arrivalSentence) }]
      },
      method: {
        text: methodSentence,
        sources: [source(1, setupSection, methodSentence)]
      },
      components: [{
        id: "assignment-rule",
        label: "Request Assignment Rule",
        role: "decision",
        conceptIds: ["decisions"],
        explanation: { text: decisionSentence, sources: [source(1, setupSection, decisionSentence)] },
        conditions: [{ text: arrivalSentence, source: source(1, setupSection, arrivalSentence) }]
      }, {
        id: "capacity-limit",
        label: "Available Capacity Limit",
        role: "constraint",
        conceptIds: ["constraints"],
        explanation: { text: capacitySentence, sources: [source(1, setupSection, capacitySentence)] },
        conditions: [{ text: capacitySentence, source: source(1, setupSection, capacitySentence) }]
      }]
    }]
  };
  await writeJson(root, safeMapRelativePath(record.id), spec);
  return {
    root,
    record,
    qaBinding,
    pagesPayload,
    pagesSha256,
    concepts: [
      { id: "decisions", label: "Decisions", aliases: ["assignment", "chooses"], related: [] },
      { id: "constraints", label: "Constraints", aliases: ["capacity", "capacity limit"], related: [] }
    ]
  };
}

test("a concise literal direct question is valid evidence, but a short declaration is not", async (t) => {
  const direct = await fixture({
    questionSentence: "Should we assign requests?",
    questionText: "Should we assign requests?"
  });
  t.after(() => rm(direct.root, { recursive: true, force: true }));
  await assert.doesNotReject(loadBoundSafeMap(direct));

  const declaration = await fixture({
    questionSentence: "Assign customer requests.",
    questionText: "Should we assign customer requests?"
  });
  t.after(() => rm(declaration.root, { recursive: true, force: true }));
  await assert.rejects(loadBoundSafeMap(declaration), /quote must contain at least four meaningful words/);
});

test("prose-only safe-map loader, materializer, digest, and tamper gate share one contract", async (t) => {
  const context = await fixture();
  t.after(() => rm(context.root, { recursive: true, force: true }));
  const bound = await loadBoundSafeMap(context);
  assert.match(bound.specSha256, /^[a-f0-9]{64}$/);
  assert.match(bound.visualReportSha256, /^[a-f0-9]{64}$/);

  const note = materializeSafeMapNote({
    record: context.record,
    pagesPayload: context.pagesPayload,
    conceptDefinitions: context.concepts,
    bound,
    qaBinding: context.qaBinding
  });
  assert.equal(note.provenance.formalEvidenceAllowed, false);
  assert.equal(note.provenance.safeMapSha256, bound.specSha256);
  assert.ok(note.models.every((model) => model.components.every((component) => (
    component.symbols.length === 0
      && component.formalKind === SAFE_MAP_FORMAL_KIND
      && component.sources.every((entry) => entry.equation === "")
  ))));
  assert.deepEqual(validateProseOnlySafeMapNote(note, context.pagesPayload, {
    bound,
    qaBinding: context.qaBinding,
    record: context.record,
    conceptDefinitions: context.concepts
  }), []);

  const digest = safeMapInputDigest({ baseInputDigest: fakeHash("e"), bound, qaBinding: context.qaBinding });
  assert.match(digest, /^[a-f0-9]{64}$/);
  const envelope = {
    schemaVersion: 1,
    authoringVersion: note.provenance.authoringVersion,
    authoringMode: SAFE_MAP_AUTHORING_MODE,
    paperId: context.record.id,
    sourcePdfSha256: context.record.pdf_sha256,
    extractionPagesSha256: context.pagesSha256,
    conceptRegistrySha256: fakeHash("f"),
    inputDigest: digest,
    ...safeMapEnvelopeBindings(bound),
    ...context.qaBinding,
    note
  };
  assert.deepEqual(validateBoundSafeMapEnvelope(envelope, {
    bound,
    qaBinding: context.qaBinding,
    record: context.record,
    pagesPayload: context.pagesPayload,
    pagesSha256: context.pagesSha256,
    conceptDefinitions: context.concepts,
    conceptRegistrySha256: fakeHash("f"),
    expectedInputDigest: digest
  }), []);
  assert.equal(safeMapBindingsMatch(envelope, envelope), true);
  const staleCheckpoint = { ...envelope };
  delete staleCheckpoint.safeMapSha256;
  assert.equal(safeMapBindingsMatch(staleCheckpoint, envelope), false);
  const tampered = structuredClone(note);
  tampered.models[0].decisions[0] = "a different decision";
  assert.ok(validateProseOnlySafeMapNote(tampered, context.pagesPayload, {
    bound,
    qaBinding: context.qaBinding,
    record: context.record,
    conceptDefinitions: context.concepts
  }).some((entry) => entry.reason.includes("deterministic safe-map materialization")));

  const specRaw = await readFile(path.join(context.root, ...safeMapRelativePath(context.record.id).split("/")), "utf8");
  assert.equal(hash(specRaw), bound.specSha256);
});

test("safe-map materialization restores only omitted terminal condition punctuation", async (t) => {
  const context = await fixture({ arrivalSentence: "Requests arrive before allocation begins" });
  t.after(() => rm(context.root, { recursive: true, force: true }));
  const bound = await loadBoundSafeMap(context);
  const note = materializeSafeMapNote({
    record: context.record,
    pagesPayload: context.pagesPayload,
    conceptDefinitions: context.concepts,
    bound,
    qaBinding: context.qaBinding
  });

  assert.equal(note.models[0].components[0].conditions[0], "Requests arrive before allocation begins.");
  assert.equal(
    note.models[0].components[0].sources.some((entry) => entry.quote === "Requests arrive before allocation begins"),
    true
  );
});
