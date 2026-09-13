import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { run } from "../scripts/author-model-notes.mjs";
import {
  AUTHORING_VERSION
} from "../scripts/model-note-authoring.mjs";
import {
  SAFE_MAP_BINDING_FIELDS,
  SAFE_MAP_REVIEW_VERSION,
  SAFE_MAP_SCHEMA_VERSION,
  SAFE_MAP_VERSION,
  VISUAL_SCOPE_REPORT_PATH,
  safeMapRelativePath
} from "../scripts/model-note-safe-map.mjs";
import {
  EXTRACTION_POLICY,
  EXTRACTOR_CODE_SHA256,
  extractionCorruptionProfile
} from "../scripts/corpus-pipeline.mjs";
import { reviewExtractions, verifyExtractionQaCheckpoint } from "../scripts/extraction-qa.mjs";
import { modelNoteExtractionQaCheckpointBinding } from "../scripts/model-note-extraction-qa.mjs";

const PAPER_ID = "safe-map-authoring-fixture";
const DOI = "10.0000/safe-map-authoring-fixture";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const PDF_BYTES = Buffer.from("%PDF-safe-map authoring fixture\n", "utf8");
const PDF_SHA256 = sha256(PDF_BYTES);
const SECTION = "2. Model Setup";
const QUESTION_SOURCE = "The platform must decide how to assign customer requests to available capacity.";
const MODEL_SOURCE = "The platform serves customer requests using available capacity.";
const INPUT_SOURCE = "The request arrival rate, capacity level, and reward per served request are exogenous model inputs.";
const DECISION_SOURCE = "The platform chooses an assignment for each request.";
const ARRIVAL_SOURCE = "Requests arrive before allocation begins.";
const CAPACITY_SOURCE = "Each unit of capacity can serve at most one request.";
const METHOD_SOURCE = "The paper solves the allocation problem by ranking customer requests before assigning capacity.";
const PAGE_TEXT = `Safe Map Authoring Fixture\n${SECTION}\n${QUESTION_SOURCE} ${MODEL_SOURCE} ${INPUT_SOURCE} ${DECISION_SOURCE} ${ARRIVAL_SOURCE}\n3. Assignment Algorithm\n${METHOD_SOURCE} The algorithm repeatedly selects the next customer request before assigning available capacity.\n4. Capacity Constraint\n${CAPACITY_SOURCE} The allocation remains feasible only when assigned requests do not exceed available capacity.\n${"Readable source prose preserves the reviewed model setup and procedure. ".repeat(20)}`;
const PAGES = [{ page: 1, text: PAGE_TEXT }];
const PROFILE = extractionCorruptionProfile(PAGES);

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filename, raw, "utf8");
  return { raw, sha256: sha256(raw) };
}

function source(quote) {
  return { page: 1, section: SECTION, quote };
}

function safeSpec({ pagesSha256, visualSha256, qaBinding, textSha256 }) {
  return {
    schemaVersion: SAFE_MAP_SCHEMA_VERSION,
    safeMapVersion: SAFE_MAP_VERSION,
    paperId: PAPER_ID,
    sourcePdfSha256: PDF_SHA256,
    extractionPagesSha256: pagesSha256,
    visualScopeReview: {
      path: VISUAL_SCOPE_REPORT_PATH,
      sha256: visualSha256,
      entryBinding: {
        qaDecisionSha256: qaBinding.extractionQaDecisionSha256,
        textSha256,
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
      text: "How should the platform assign customer requests to available capacity?",
      source: source(QUESTION_SOURCE)
    },
    overview: {
      text: "The model studies how the platform assigns customer requests to available capacity before allocation begins.",
      sources: [source(MODEL_SOURCE), source(ARRIVAL_SOURCE)]
    },
    models: [{
      id: "request-allocation-model",
      name: "Request Allocation Model",
      kind: "baseline",
      relation: "",
      summary: {
        text: "The platform assigns customer requests while respecting its available capacity.",
        sources: [source(MODEL_SOURCE), source(CAPACITY_SOURCE)]
      },
      setup: {
        objects: [{ value: "The platform", source: source(MODEL_SOURCE) }],
        inputs: [{ value: "customer requests", source: source(MODEL_SOURCE) }],
        decisions: [{ value: "an assignment for each request", source: source(DECISION_SOURCE) }],
        assumptions: [{ value: "Requests arrive before allocation begins", source: source(ARRIVAL_SOURCE) }]
      },
      method: { text: METHOD_SOURCE, sources: [source(METHOD_SOURCE)] },
      components: [{
        id: "assignment-rule",
        label: "Request Assignment Rule",
        role: "decision",
        conceptIds: ["decision-making"],
        explanation: { text: DECISION_SOURCE, sources: [source(DECISION_SOURCE)] },
        conditions: [{ text: ARRIVAL_SOURCE, source: source(ARRIVAL_SOURCE) }]
      }, {
        id: "capacity-limit",
        label: "Available Capacity Limit",
        role: "constraint",
        conceptIds: ["feasibility-constraints"],
        explanation: { text: CAPACITY_SOURCE, sources: [source(CAPACITY_SOURCE)] },
        conditions: [{ text: CAPACITY_SOURCE, source: source(CAPACITY_SOURCE) }]
      }]
    }]
  };
}

function options(root, overrides = {}) {
  return {
    root,
    limit: 0,
    from: "",
    paper: [PAPER_ID],
    jobs: 1,
    force: false,
    dryRun: false,
    check: false,
    reconcileMini: false,
    json: true,
    ...overrides
  };
}

async function createFixture({ needsReview = true, withSpec = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-author-safe-map-"));
  const extractionInputDigest = "safe-map-extraction-input";
  const artifactBase = path.posix.join("research", "ledger", "artifacts", PAPER_ID, extractionInputDigest);
  const pagesRelative = path.posix.join(artifactBase, "pages.json");
  const textRelative = path.posix.join(artifactBase, "text.txt");
  const pagesPayload = {
    schemaVersion: 1,
    paperId: PAPER_ID,
    canonicalDoi: DOI,
    pdfSha256: PDF_SHA256,
    extractor: {
      name: "pypdf+pymupdf-fallback",
      version: "fixture",
      codeSha256: EXTRACTOR_CODE_SHA256,
      selectedEngine: "pypdf",
      selectedEngineVersion: "fixture-pypdf",
      fallbackAttempted: false,
      fallbackUsed: false,
      fallbackReason: "",
      primaryCorruptionProfile: PROFILE,
      fallbackCorruptionProfile: null,
      selectedCorruptionProfile: PROFILE,
      extractionPolicy: EXTRACTION_POLICY
    },
    pages: PAGES
  };
  const pagesRaw = `${JSON.stringify(pagesPayload, null, 2)}\n`;
  const pagesSha256 = sha256(pagesRaw);
  const plainText = `===== PDF PAGE 1 =====\n${PAGE_TEXT}\n`;
  const textSha256 = sha256(plainText);
  const record = {
    id: PAPER_ID,
    doi: DOI,
    title: "Safe Map Authoring Fixture",
    detail_level: "literature",
    pdf_sha256: PDF_SHA256,
    primary_topic: "Resource allocation",
    model_topic: "Assign customer requests to limited capacity",
    abstract: `${MODEL_SOURCE} ${DECISION_SOURCE} ${CAPACITY_SOURCE}`,
    business_question: "How should customer requests be assigned to limited capacity?",
    modeling_evidence: "PDF p. 1 states the request-allocation model and its capacity restriction.",
    evidence_detail: ["PDF p. 1 states the request-allocation model and its capacity restriction."]
  };
  const manifestRecord = {
    id: PAPER_ID,
    canonicalDoi: DOI,
    doiUrl: `https://doi.org/${DOI}`,
    aliases: [],
    title: record.title,
    recordDigest: "safe-map-fixture-record-digest",
    pdf: { path: `paper/${PAPER_ID}.pdf`, sha256: PDF_SHA256, bytes: PDF_BYTES.length, pageCount: 1 }
  };
  const manifest = {
    schemaVersion: 1,
    corpusRevision: "safe-map-fixture-corpus-revision",
    parser: { extractionCodeSha256: EXTRACTOR_CODE_SHA256 },
    records: [manifestRecord]
  };
  const warningCodes = needsReview ? ["parser_warning"] : [];
  const ledger = {
    schemaVersion: 1,
    paperId: PAPER_ID,
    canonicalDoi: DOI,
    corpusRevision: manifest.corpusRevision,
    manifestRecordDigest: manifestRecord.recordDigest,
    pdfSha256: PDF_SHA256,
    stages: {
      extraction: {
        status: "complete",
        inputDigest: extractionInputDigest,
        sourcePdfSha256: PDF_SHA256,
        pageCount: 1,
        totalCharacters: PAGE_TEXT.length,
        emptyPages: [],
        pageErrors: [],
        parserWarningCount: warningCodes.length,
        parserWarningCodes: warningCodes,
        selectedEngine: "pypdf",
        selectedEngineVersion: "fixture-pypdf",
        fallbackAttempted: false,
        fallbackUsed: false,
        fallbackReason: "",
        primaryCorruptionProfile: PROFILE,
        fallbackCorruptionProfile: null,
        selectedCorruptionProfile: PROFILE,
        artifacts: { pages: pagesRelative, pagesSha256, text: textRelative, textSha256 }
      },
      extractQa: {
        status: needsReview ? "needs_review" : "complete",
        inputDigest: extractionInputDigest,
        sourcePdfSha256: PDF_SHA256,
        reasons: warningCodes,
        warningCodes,
        pageErrors: [],
        emptyPages: [],
        totalCharacters: PAGE_TEXT.length,
        selectedEngine: "pypdf",
        selectedEngineVersion: "fixture-pypdf",
        fallbackAttempted: false,
        fallbackUsed: false,
        fallbackReason: "",
        primaryCorruptionProfile: PROFILE,
        fallbackCorruptionProfile: null,
        selectedCorruptionProfile: PROFILE
      },
      sectionIndex: { status: "pending" },
      sourceReading: { status: "pending" },
      noteAuthoring: { status: "pending" },
      quoteAudit: { status: "pending" },
      formulaAudit: { status: "pending" },
      schemaValidation: { status: "pending" },
      contentAudit: { status: "pending" },
      sourceAudit: { status: "pending" },
      releaseBuild: { status: "pending" }
    }
  };
  const ledgerPath = path.join(root, "research", "ledger", "papers", `${PAPER_ID}.json`);
  const notePath = path.join(root, "data", "notes", "papers", `${PAPER_ID}.json`);
  await Promise.all([
    writeJson(path.join(root, "data", "atlas_articles.json"), { records: [record] }),
    writeJson(path.join(root, "mini-atlas", "data", "atlas.json"), { concepts: [], papers: [] }),
    writeJson(path.join(root, "research", "corpus", "manifest.v1.json"), manifest),
    writeJson(path.join(root, ...pagesRelative.split("/")), pagesPayload),
    writeJson(ledgerPath, ledger),
    mkdir(path.join(root, "paper"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(root, ...textRelative.split("/")), plainText, "utf8"),
    writeFile(path.join(root, "paper", `${PAPER_ID}.pdf`), PDF_BYTES)
  ]);
  await reviewExtractions({
    command: "review", root, papers: [PAPER_ID], from: "", limit: null, jobs: 1,
    dryRun: false, force: false, check: false, json: false, help: false
  });
  const checkpoint = await verifyExtractionQaCheckpoint(root, manifest, manifestRecord, ledger, { requireComplete: false });
  assert.equal(checkpoint.ok, true, checkpoint.reason);
  const qaBinding = modelNoteExtractionQaCheckpointBinding(checkpoint, { allowNeedsReview: true });
  if (needsReview) {
    const visualReport = {
      schemaVersion: 1,
      reportVersion: "extraction-visual-scope-review-v1",
      entries: [{
        paperId: PAPER_ID,
        sourcePdf: { path: manifestRecord.pdf.path, sha256: PDF_SHA256 },
        productionExtraction: { pagesPath: pagesRelative, pagesSha256, textPath: textRelative, textSha256 },
        qaDecision: { path: qaBinding.extractionQaDecisionPath, sha256: qaBinding.extractionQaDecisionSha256 },
        proseAuthoringAllowed: true,
        formalMathAllowed: false,
        structuredFigureTableAllowed: false,
        reviewDisposition: "needs_review",
        reviewVersion: "extraction-visual-scope-review-v1"
      }]
    };
    const visual = await writeJson(path.join(root, ...VISUAL_SCOPE_REPORT_PATH.split("/")), visualReport);
    if (withSpec) {
      await writeJson(path.join(root, ...safeMapRelativePath(PAPER_ID).split("/")), safeSpec({
        pagesSha256,
        visualSha256: visual.sha256,
        qaBinding,
        textSha256
      }));
    }
  }
  return {
    root,
    ledgerPath,
    notePath,
    pagesPath: path.join(root, ...pagesRelative.split("/")),
    checkpoint,
    qaBinding
  };
}

async function cloneFixture(fixture, t, label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `atlas-author-safe-${label}-`));
  await cp(fixture.root, root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    ...fixture,
    root,
    ledgerPath: path.join(root, "research", "ledger", "papers", `${PAPER_ID}.json`),
    notePath: path.join(root, "data", "notes", "papers", `${PAPER_ID}.json`),
    pagesPath: path.join(root, "research", "ledger", "artifacts", PAPER_ID, "safe-map-extraction-input", "pages.json")
  };
}

async function assertReadOnlyFailure(fixture, action, expected) {
  const noteBefore = await readFile(fixture.notePath, "utf8");
  const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");
  let result;
  let thrown = null;
  try {
    result = await run(options(fixture.root, { check: true }));
  } catch (error) {
    thrown = error;
  }
  const message = thrown?.message || result?.results?.[0]?.reason || "";
  assert.match(message, expected, `${action}: ${message}`);
  if (!thrown) assert.ok(["failed", "stale", "blocked"].includes(result.results[0].status), `${action}: ${JSON.stringify(result)}`);
  assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore, `${action}: note changed during fail-closed check`);
  assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore, `${action}: ledger changed during fail-closed check`);
}

test("needs_review authoring is restartable only through a fully bound prose-only safe map", async (t) => {
  await t.test("a missing safe map fails without writing a note or ledger checkpoint", async () => {
    const fixture = await createFixture({ withSpec: false });
    try {
      const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");
      const result = await run(options(fixture.root));
      assert.deepEqual(result.counts, { failed: 1 });
      assert.match(result.results[0].reason, /reviewed prose-only safe map is missing/);
      await assert.rejects(readFile(fixture.notePath, "utf8"), { code: "ENOENT" });
      assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const first = await run(options(fixture.root));
  assert.deepEqual(first.counts, { created: 1 });
  const envelope = JSON.parse(await readFile(fixture.notePath, "utf8"));
  const ledger = JSON.parse(await readFile(fixture.ledgerPath, "utf8"));
  const authored = ledger.stages.noteAuthoring;
  const packetPath = path.join(fixture.root, ...ledger.stages.sourceReading.readingPacket.split("/"));
  const packet = JSON.parse(await readFile(packetPath, "utf8"));
  assert.equal(envelope.authoringVersion, AUTHORING_VERSION);
  assert.equal(envelope.note.provenance.formalEvidenceAllowed, false);
  assert.equal(authored.source, "reviewed-prose-only-safe-map");
  for (const field of SAFE_MAP_BINDING_FIELDS) {
    assert.equal(authored[field], envelope[field], `ledger ${field}`);
    assert.equal(packet[field], envelope[field], `reading packet ${field}`);
    assert.equal(envelope.note.provenance[field], envelope[field], `note provenance ${field}`);
  }
  assert.deepEqual((await run(options(fixture.root))).counts, { current: 1 });
  assert.deepEqual((await run(options(fixture.root, { check: true }))).counts, { current: 1 });

  await t.test("spec bytes are part of the current input identity", async (t) => {
    const copy = await cloneFixture(fixture, t, "spec");
    const filename = path.join(copy.root, ...safeMapRelativePath(PAPER_ID).split("/"));
    await writeFile(filename, `${await readFile(filename, "utf8")}\n`, "utf8");
    await assertReadOnlyFailure(copy, "spec drift", /note input digest is stale/);
  });

  await t.test("visual-scope report drift fails before reuse", async (t) => {
    const copy = await cloneFixture(fixture, t, "visual");
    const filename = path.join(copy.root, ...VISUAL_SCOPE_REPORT_PATH.split("/"));
    await writeFile(filename, `${await readFile(filename, "utf8")}\n`, "utf8");
    await assertReadOnlyFailure(copy, "visual report drift", /visual-scope report hash is missing or stale/);
  });

  await t.test("QA-decision drift fails before reuse", async (t) => {
    const copy = await cloneFixture(fixture, t, "qa");
    const filename = path.join(copy.root, ...copy.qaBinding.extractionQaDecisionPath.split("/"));
    await writeFile(filename, `${await readFile(filename, "utf8")}\n`, "utf8");
    await assertReadOnlyFailure(copy, "QA drift", /review_decision_not_reproducible|not a current terminal checkpoint/);
  });

  await t.test("pages drift fails before reuse", async (t) => {
    const copy = await cloneFixture(fixture, t, "pages");
    await writeFile(copy.pagesPath, `${await readFile(copy.pagesPath, "utf8")}\n`, "utf8");
    await assertReadOnlyFailure(copy, "pages drift", /pages artifact hash is stale|review_decision_not_reproducible/);
  });

  await t.test("concept-registry drift fails before reuse", async (t) => {
    const copy = await cloneFixture(fixture, t, "concepts");
    const filename = path.join(copy.root, "data", "notes", "concepts.json");
    const payload = JSON.parse(await readFile(filename, "utf8"));
    payload.concepts[0].label = "Tampered concept label";
    await writeJson(filename, payload);
    await assertReadOnlyFailure(copy, "concept drift", /Generated concept registry is stale/);
  });

  await t.test("note payload drift fails deterministic materialization", async (t) => {
    const copy = await cloneFixture(fixture, t, "note");
    const payload = JSON.parse(await readFile(copy.notePath, "utf8"));
    payload.note.overview = "A tampered overview remains syntactically readable.";
    await writeJson(copy.notePath, payload);
    await assertReadOnlyFailure(copy, "note drift", /note differs from deterministic safe-map materialization/);
  });
});

test("complete QA never reads a safe-map file", async () => {
  const fixture = await createFixture({ needsReview: false, withSpec: false });
  try {
    assert.equal(fixture.qaBinding.extractionQaStatus, "complete", JSON.stringify(fixture.checkpoint));
    const filename = path.join(fixture.root, ...safeMapRelativePath(PAPER_ID).split("/"));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, "{ deliberately invalid safe-map JSON", "utf8");
    const result = await run(options(fixture.root, { dryRun: true }));
    const reason = result.results[0]?.reason || "";
    assert.ok(["would-create", "would-update"].includes(result.results[0]?.status), JSON.stringify(result));
    assert.doesNotMatch(reason, /safe map is not valid JSON|reviewed prose-only safe map is missing/i, JSON.stringify(result));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
