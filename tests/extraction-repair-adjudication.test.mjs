import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256, stableStringify } from "../scripts/corpus-pipeline.mjs";
import {
  EXTRACTION_QA_CODE_SHA256,
  EXTRACTION_QA_POLICY_SHA256,
  EXTRACTION_QA_VERSION,
  extractionQaInputDigest
} from "../scripts/extraction-qa.mjs";
import {
  EXTRACTION_REPAIR_CODE_SHA256,
  EXTRACTION_REPAIR_LAYOUT_POLICY,
  EXTRACTION_REPAIR_VERSION,
  extractionRepairCandidatePaths,
  extractionRepairInput,
  extractionRepairVisualQaRelativePath
} from "../scripts/extraction-repair.mjs";
import {
  EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256,
  EXTRACTION_REPAIR_ADJUDICATION_POLICY_SHA256,
  EXTRACTION_REPAIR_ADJUDICATION_VERSION,
  adjudicateExtractionRepair,
  buildExtractionRepairAdjudicationInput,
  extractionRepairAdjudicationContentIssues,
  inspectExtractionRepairAdjudication,
  makeExtractionRepairAdjudicationRecord,
  parseExtractionRepairAdjudicationCli,
  repairAdjudicationInputDigest,
  writeExtractionRepairAdjudicationExclusive
} from "../scripts/extraction-repair-adjudication.mjs";

const visualReviewer = "Fixture Visual Reviewer";
const independentReviewer = "Independent Repair Adjudicator";
const independentReviewerId = "repair-adjudicator-02";

function absolute(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

async function writeBytes(root, relativePath, bytes) {
  const destination = absolute(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return sha256(bytes);
}

async function writeCanonical(root, relativePath, value) {
  const bytes = Buffer.from(`${stableStringify(value, 2)}\n`, "utf8");
  return writeBytes(root, relativePath, bytes);
}

function recordDigest(record) {
  return sha256(stableStringify(record));
}

function baseText(pages) {
  return pages.map((page) => `===== PDF PAGE ${page.page} =====\n${page.text}`).join("\n\n") + "\n";
}

function acceptedFinding(page = 1) {
  return {
    page,
    conclusion: "accept",
    observation: `Rendered source PDF page ${page} visibly matches the candidate formula: operators, subscripts, delimiters, and reading order are preserved.`
  };
}

function rejectedFinding(page = 1) {
  return {
    page,
    conclusion: "reject",
    observation: `Rendered source PDF page ${page} visibly differs from the candidate formula because the comparison operator is incorrect and misaligned.`
  };
}

function rationale(doi, disposition = "accepted") {
  return `For ${doi}, the independent comparison of every required source-PDF crop and its bound candidate page supports the ${disposition} repair disposition.`;
}

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-repair-adjudication-"));
  const paperId = "doi-10-1000-fixture-0001";
  const canonicalDoi = "10.1000/fixture.0001";
  const sourcePath = "paper/Fixture Repair Paper.pdf";
  const sourceBytes = Buffer.concat([
    Buffer.from("%PDF-1.7\n", "ascii"),
    Buffer.from("synthetic immutable fixture used only for hash-binding tests\n", "utf8")
  ]);
  const sourcePdfSha256 = await writeBytes(root, sourcePath, sourceBytes);
  const recordBody = {
    aliases: [],
    authors: ["Fixture Author"],
    bibkey: "fixture2026repair",
    canonicalDoi,
    doiUrl: `https://doi.org/${canonicalDoi}`,
    id: paperId,
    inclusion: { basis: "literature", status: "included" },
    integrityIssues: [],
    journal: "Fixture Journal",
    journalCode: "fixture",
    pdf: {
      bytes: sourceBytes.length,
      file: "Fixture Repair Paper.pdf",
      pageCount: 1,
      parse: { encrypted: false, status: "ok", warningCodes: [], warningCount: 0, warningSamples: [] },
      path: sourcePath,
      sha256: sourcePdfSha256
    },
    provenance: { disposition: "fixture", sourcePdfFile: "Fixture Repair Paper.pdf", targetPdfFile: "Fixture Repair Paper.pdf" },
    sourceDetailLevel: "literature",
    sourceRecordDigest: "fixture-source-record",
    sourceReviewStatus: "fixture",
    title: "Fixture Repair Paper",
    year: 2026
  };
  const record = { ...recordBody, recordDigest: recordDigest(recordBody) };
  await writeCanonical(root, "research/corpus/manifest.v1.json", {
    schemaVersion: 1,
    records: [record]
  });

  const basePagesPath = `research/ledger/artifacts/${paperId}/base-input/pages.json`;
  const baseTextPath = `research/ledger/artifacts/${paperId}/base-input/text.txt`;
  const basePagesValue = {
    schemaVersion: 1,
    stage: "extractionPages",
    paperId,
    pages: [{ page: 1, text: "Fixture base page with a damaged formula x ! 1." }]
  };
  const basePagesSha256 = await writeCanonical(root, basePagesPath, basePagesValue);
  const baseTextSha256 = await writeBytes(root, baseTextPath, Buffer.from(baseText(basePagesValue.pages), "utf8"));
  const extraction = {
    status: "complete",
    inputDigest: "a".repeat(64),
    sourcePdfSha256,
    pageCount: 1,
    totalCharacters: basePagesValue.pages[0].text.length,
    selectedEngine: "fixture",
    selectedEngineVersion: "1",
    artifacts: {
      pages: basePagesPath,
      pagesSha256: basePagesSha256,
      text: baseTextPath,
      textSha256: baseTextSha256
    }
  };
  const ledger = {
    schemaVersion: 1,
    paperId,
    canonicalDoi,
    manifestRecordDigest: record.recordDigest,
    pdfSha256: sourcePdfSha256,
    corpusRevision: "fixture-revision",
    stages: {
      extraction,
      extractQa: { status: "needs_review", reasons: ["parser_warning"] }
    }
  };
  await writeCanonical(root, `research/ledger/papers/${paperId}.json`, ledger);

  const qaInputDigest = extractionQaInputDigest(record, ledger);
  const qaPath = `research/ledger/extraction-qa/${paperId}/${qaInputDigest}.json`;
  const qaDecision = {
    schemaVersion: 1,
    stage: "extractQa",
    producer: "scripts/extraction-qa.mjs",
    producerVersion: EXTRACTION_QA_VERSION,
    producerCodeSha256: EXTRACTION_QA_CODE_SHA256,
    policySha256: EXTRACTION_QA_POLICY_SHA256,
    paperId,
    canonicalDoi,
    manifestRecordDigest: record.recordDigest,
    sourcePdfSha256,
    extractionInputDigest: extraction.inputDigest,
    inputDigest: qaInputDigest,
    status: "needs_review",
    disposition: "manual_review_required",
    sourceReasons: ["parser_warning"],
    unresolvedReasons: ["parser_warning"]
  };
  const qaDecisionSha256 = await writeCanonical(root, qaPath, qaDecision);

  const specPath = `research/extraction-repair-specs/${paperId}.json`;
  const glyphMap = [{
    fontResourceTag: "/FixtureFont",
    fontStreamSha256: "d".repeat(64),
    charCodeHex: "21",
    glyphName: "/equals",
    unicode: "=",
    unicodeCodePoint: "U+003D"
  }];
  const specValue = {
    schemaVersion: 1,
    stage: "extractionRepairSpec",
    paperId,
    canonicalDoi,
    bindings: {
      sourcePdfSha256,
      basePagesSha256,
      extractionQaDecisionSha256: qaDecisionSha256
    },
    strategy: {
      name: "font-resource-cmap-overlay",
      version: 1,
      resource: {
        fontResourceTag: "/FixtureFont",
        fontStreamKey: "/FontFile3",
        fontStreamSha256: "d".repeat(64)
      },
      glyphMap
    },
    visualEvidence: {
      status: "pending",
      diagnosedPages: [1],
      observation: "Rendered source PDF page 1 shows a damaged equality operator requiring exact resource-bound repair."
    }
  };
  const specSha256 = await writeCanonical(root, specPath, specValue);
  const runtime = {
    pythonExecutable: "python",
    pythonVersion: "fixture",
    pypdfVersion: "fixture",
    pymupdfVersion: "fixture"
  };
  const repairInput = extractionRepairInput({
    record,
    ledger,
    qa: { inputDigest: qaInputDigest, decisionPath: qaPath, decisionSha256: qaDecisionSha256 },
    spec: { relativePath: specPath, sha256: specSha256 },
    runtime
  });
  const repairInputDigest = sha256(stableStringify(repairInput));
  const candidatePaths = extractionRepairCandidatePaths(paperId, repairInputDigest);
  const binding = {
    paperId,
    canonicalDoi,
    sourcePdfSha256,
    basePagesSha256,
    extractionQaDecisionSha256: qaDecisionSha256,
    repairInputDigest
  };
  const engine = { name: "fixture-repair", pypdfVersion: "fixture", pymupdfVersion: "fixture" };
  const layoutVerification = {
    basePageCount: 1,
    candidatePageCount: 1,
    changedPageCount: 1,
    mappedEventCount: 1,
    compositeOccurrenceCount: 0,
    policy: "fixture exact mapping"
  };
  const observedGlyphs = [{
    fontResourceTag: "/FixtureFont",
    fontStreamSha256: "d".repeat(64),
    originalCharCodeHex: "21",
    glyphName: "/equals",
    unicode: "=",
    unicodeCodePoint: "U+003D",
    count: 1,
    mappedCount: 1,
    pages: [1],
    mappingStatus: "mapped",
    mappingKinds: { simple: 1 }
  }];
  const candidatePagesValue = {
    schemaVersion: 1,
    stage: "extractionRepairCandidatePages",
    producerVersion: EXTRACTION_REPAIR_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_CODE_SHA256,
    ...binding,
    layoutPolicy: EXTRACTION_REPAIR_LAYOUT_POLICY,
    engine,
    pages: [{ page: 1, text: "Fixture candidate page with a repaired formula x = 1." }]
  };
  const candidatePagesSha256 = await writeCanonical(root, candidatePaths.pages, candidatePagesValue);
  const candidateTextSha256 = await writeBytes(
    root,
    candidatePaths.text,
    Buffer.from(baseText(candidatePagesValue.pages), "utf8")
  );
  const mappedEvidence = [{
    page: 1,
    contentOperatorIndex: 7,
    textOperator: "Tj",
    stringOperandIndex: 0,
    byteOffset: 0,
    fontResourceTag: "/FixtureFont",
    fontStreamSha256: "d".repeat(64),
    originalCharCodeHex: "21",
    glyphName: "/equals",
    mappingStatus: "mapped",
    mappingKind: "simple",
    unicode: "=",
    unicodeCodePoint: "U+003D",
    candidateCharacter: "=",
    bbox: [10, 10, 20, 20],
    candidateTextUnicodeScalarOffset: 45,
    renderCharacterOffset: 45
  }];
  const provenanceValue = {
    schemaVersion: 1,
    stage: "extractionRepairGlyphProvenance",
    producerVersion: EXTRACTION_REPAIR_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_CODE_SHA256,
    ...binding,
    candidatePagesSha256,
    resource: specValue.strategy.resource,
    glyphMap,
    compositeGlyphMap: [],
    observedGlyphs,
    glyphEvents: mappedEvidence,
    mappedGlyphProvenance: mappedEvidence,
    compositeGlyphProvenance: [],
    unmappedGlyphs: [],
    layoutVerification
  };
  const provenanceSha256 = await writeCanonical(root, candidatePaths.provenance, provenanceValue);
  const sidecarPath = extractionRepairVisualQaRelativePath(paperId, repairInputDigest, candidatePagesSha256, 1);
  const cropPath = `${path.posix.dirname(sidecarPath)}/crops/page-1-affected.png`;
  const cropBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("fixture crop pixels")
  ]);
  const cropSha256 = await writeBytes(root, cropPath, cropBytes);
  const requirement = {
    page: 1,
    cropBox: [0, 0, 100, 100],
    bbox: [10, 10, 80, 80],
    affectedBboxes: ["10 10 20 20"],
    affectedSpanCount: 1,
    requiredRegionTypes: ["formula"],
    requiredChecks: ["operators", "subscripts", "superscripts", "delimiters", "order"],
    sidecarPath
  };
  const candidateValue = {
    schemaVersion: 1,
    stage: "extractionRepairCandidate",
    producer: "scripts/extraction-repair.mjs",
    producerVersion: EXTRACTION_REPAIR_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_CODE_SHA256,
    status: "needs_visual_review",
    promotionEligibility: false,
    paperId,
    canonicalDoi,
    manifestRecordDigest: record.recordDigest,
    sourcePdfSha256,
    basePagesSha256,
    extractionQaInputDigest: qaInputDigest,
    extractionQaDecisionPath: qaPath,
    extractionQaDecisionSha256: qaDecisionSha256,
    repairSpecPath: specPath,
    repairSpecSha256: specSha256,
    repairInputDigest,
    candidatePagesSha256,
    engine,
    runtime,
    layoutPolicy: EXTRACTION_REPAIR_LAYOUT_POLICY,
    resource: specValue.strategy.resource,
    glyphMap,
    compositeGlyphMap: [],
    mappedGlyphCount: 1,
    compositeGlyphCount: 0,
    observedGlyphs,
    unmappedGlyphs: [],
    layoutVerification,
    visualEvidence: {
      status: "pending",
      diagnosedPages: [1],
      diagnosis: specValue.visualEvidence.observation,
      eligibilityRule: "accepted sidecars and zero unmapped glyphs are required",
      requirements: [requirement]
    },
    artifacts: {
      pages: candidatePaths.pages,
      pagesSha256: candidatePagesSha256,
      text: candidatePaths.text,
      textSha256: candidateTextSha256,
      provenance: candidatePaths.provenance,
      provenanceSha256
    }
  };
  await writeCanonical(root, candidatePaths.candidate, candidateValue);
  const sidecarValue = {
    schemaVersion: 1,
    stage: "extractionRepairVisualQa",
    producer: "manual-visual-review-v1",
    paperId,
    sourcePdfSha256,
    basePagesSha256,
    candidatePagesSha256,
    repairInputDigest,
    page: 1,
    cropBox: requirement.cropBox,
    bbox: requirement.bbox,
    dpi: 180,
    renderer: { name: "pdftoppm", version: "26.07.0" },
    cropPath,
    cropSha256,
    reviewer: visualReviewer,
    outcome: "accepted",
    observation: "Rendered source PDF page 1 visibly confirms that the repaired equality operator and formula order match the source crop.",
    regions: [{
      type: "formula",
      bbox: requirement.bbox,
      checks: requirement.requiredChecks,
      outcome: "accepted",
      observation: "Rendered source PDF page 1 visibly preserves operators, subscripts, superscripts, delimiters, and reading order in the formula."
    }]
  };
  await writeCanonical(root, sidecarPath, sidecarValue);
  return {
    root,
    paperId,
    canonicalDoi,
    repairInputDigest,
    candidatePaths,
    cropPath,
    sidecarPath,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

function adjudicationOptions(fixture, overrides = {}) {
  return {
    command: "adjudicate",
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest,
    disposition: "accepted",
    reviewerId: independentReviewerId,
    reviewer: independentReviewer,
    reviewedPages: [1],
    findings: [acceptedFinding()],
    rationale: rationale(fixture.canonicalDoi),
    attestIndependent: true,
    supersedes: "",
    ...overrides
  };
}

test("CLI requires explicit identity, evidence, and independence attestation", () => {
  const digest = "a".repeat(64);
  const options = parseExtractionRepairAdjudicationCli([
    "adjudicate",
    "--paper", "paper-a",
    "--repair-digest", digest,
    "--accept",
    "--reviewer-id", "reviewer-02",
    "--reviewer", "Independent Reviewer",
    "--pages", "1,3-4",
    "--finding", "1|accept|Rendered source PDF page 1 visibly matches the repaired formula operators and order.",
    "--finding", "3|accept|Rendered source PDF page 3 visibly preserves its formula delimiters and superscripts.",
    "--finding", "4|accept|Rendered source PDF page 4 visibly confirms the aligned table signs and geometry.",
    "--rationale", "Paper paper-a has independently reviewed source crops for all required candidate pages and exact bindings.",
    "--attest-independent"
  ]);
  assert.equal(options.command, "adjudicate");
  assert.deepEqual(options.reviewedPages, [1, 3, 4]);
  assert.equal(options.findings.length, 3);
  assert.equal(options.attestIndependent, true);
  assert.throws(() => parseExtractionRepairAdjudicationCli([
    "adjudicate", "--paper", "paper-a", "--repair-digest", digest, "--accept",
    "--reviewer-id", "reviewer-02", "--reviewer", "Independent Reviewer", "--pages", "1",
    "--finding", "1|accept|Rendered source PDF page 1 visibly matches the repaired formula operators and order.",
    "--rationale", "Paper paper-a has independently reviewed source crops for the complete candidate evidence."
  ]), /--attest-independent/);
});

test("accepted adjudication binds every input and remains explicitly non-promotable", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const input = await buildExtractionRepairAdjudicationInput({
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest
  });
  assert.equal(input.producerVersion, EXTRACTION_REPAIR_ADJUDICATION_VERSION);
  assert.equal(input.producerCodeSha256, EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256);
  assert.equal(input.policySha256, EXTRACTION_REPAIR_ADJUDICATION_POLICY_SHA256);
  assert.deepEqual(input.visualQa.requiredPages, [1]);
  assert.match(repairAdjudicationInputDigest(input), /^[a-f0-9]{64}$/);
  for (const key of ["candidateSha256", "pagesSha256", "textSha256", "provenanceSha256"]) {
    assert.match(input.candidate[key], /^[a-f0-9]{64}$/, `candidate four-file binding ${key}`);
  }
  assert.match(input.sourcePdf.sha256, /^[a-f0-9]{64}$/);
  assert.match(input.baseExtraction.pagesSha256, /^[a-f0-9]{64}$/);
  assert.match(input.automatedQa.decisionSha256, /^[a-f0-9]{64}$/);
  assert.match(input.repairSpec.sha256, /^[a-f0-9]{64}$/);
  assert.match(input.visualQa.sidecars[0].sidecarSha256, /^[a-f0-9]{64}$/);
  assert.match(input.visualQa.sidecars[0].cropSha256, /^[a-f0-9]{64}$/);

  const beforeInspect = await inspectExtractionRepairAdjudication({
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest
  });
  assert.equal(beforeInspect.ok, true);
  assert.equal(beforeInspect.state, "eligible_for_manual_adjudication");
  const beforeCheck = await inspectExtractionRepairAdjudication({
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest,
    requireAdjudicated: true
  });
  assert.equal(beforeCheck.ok, false);
  assert.equal(beforeCheck.reason, "no_current_adjudication");

  const result = await adjudicateExtractionRepair(adjudicationOptions(fixture));
  assert.equal(result.ok, true);
  assert.equal(result.state, "adjudicated_accepted");
  assert.equal(result.promotionEligibility, false);
  assert.match(result.adjudicationPath, new RegExp(`/${result.adjudicationInputDigest}/${result.recordDigest}\\.json$`));
  const record = JSON.parse(await readFile(absolute(fixture.root, result.adjudicationPath), "utf8"));
  assert.equal(record.recordDigest, result.recordDigest);
  assert.deepEqual(record.reviewedPages, [1]);
  assert.equal(record.findings[0].sidecarSha256, input.visualQa.sidecars[0].sidecarSha256);
  assert.equal(record.findings[0].cropSha256, input.visualQa.sidecars[0].cropSha256);
  assert.equal(record.supersedes, null);

  const idempotent = await writeExtractionRepairAdjudicationExclusive(fixture.root, record);
  assert.equal(idempotent.changed, false, "exclusive create accepts only byte-identical content at the content address");
  const inspection = await inspectExtractionRepairAdjudication({
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest,
    requireAdjudicated: true
  });
  assert.equal(inspection.ok, true);
  assert.equal(inspection.state, "adjudicated_accepted");
  assert.equal(inspection.current.path, result.adjudicationPath);
  assert.equal(inspection.promotionEligibility, false);
});

test("accepted records require full page coverage and an independent reviewer", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const input = await buildExtractionRepairAdjudicationInput({
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest
  });
  assert.throws(() => makeExtractionRepairAdjudicationRecord({
    input,
    disposition: "accepted",
    reviewerId: "fixture-visual-reviewer",
    reviewer: visualReviewer,
    reviewedPages: [1],
    findings: [acceptedFinding()],
    rationale: rationale(fixture.canonicalDoi),
    attestIndependent: true
  }), /reviewer_not_independent/);
  const incompleteIssues = extractionRepairAdjudicationContentIssues({
    input: { ...input, visualQa: { ...input.visualQa, requiredPages: [1, 2] } },
    disposition: "accepted",
    reviewer: { id: independentReviewerId, name: independentReviewer },
    reviewedPages: [1],
    findings: [acceptedFinding()],
    rationale: rationale(fixture.canonicalDoi),
    independenceAttestation: {
      attested: true,
      reviewerIsIndependent: true,
      notAVisualEvidenceReviewer: true
    }
  });
  assert.ok(incompleteIssues.includes("accepted_required_page_coverage_incomplete"));
});

test("a correction must explicitly supersede the one terminal record", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const rejected = await adjudicateExtractionRepair(adjudicationOptions(fixture, {
    disposition: "rejected",
    findings: [rejectedFinding()],
    rationale: rationale(fixture.canonicalDoi, "rejected")
  }));
  assert.equal(rejected.state, "adjudicated_rejected");
  await assert.rejects(
    adjudicateExtractionRepair(adjudicationOptions(fixture)),
    /--supersedes .* is required/
  );
  const accepted = await adjudicateExtractionRepair(adjudicationOptions(fixture, {
    supersedes: rejected.adjudicationPath
  }));
  assert.equal(accepted.state, "adjudicated_accepted");
  assert.equal(accepted.supersedes.path, rejected.adjudicationPath);
  assert.equal(accepted.supersedes.sha256, rejected.adjudicationSha256);
  assert.equal(accepted.supersedes.recordDigest, rejected.recordDigest);
  const inspection = await inspectExtractionRepairAdjudication({
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest,
    requireAdjudicated: true
  });
  assert.equal(inspection.ok, true);
  assert.equal(inspection.records.length, 2);
  assert.equal(inspection.current.path, accepted.adjudicationPath);
  const selectedCurrent = await inspectExtractionRepairAdjudication({
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest,
    adjudicationPath: accepted.adjudicationPath,
    requireAdjudicated: true
  });
  assert.equal(selectedCurrent.ok, true);
  const selectedSuperseded = await inspectExtractionRepairAdjudication({
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest,
    adjudicationPath: rejected.adjudicationPath,
    requireAdjudicated: true
  });
  assert.equal(selectedSuperseded.ok, false);
  assert.ok(selectedSuperseded.issues.includes("requested_record_is_not_current_terminal"));
});

test("an interrupted same-host dead-PID lock is recovered through a content-addressed tombstone", async (t) => {
  const fixture = await makeFixture();
  t.after(fixture.cleanup);
  const input = await buildExtractionRepairAdjudicationInput({
    root: fixture.root,
    paper: fixture.paperId,
    repairInputDigest: fixture.repairInputDigest
  });
  const inputDigest = repairAdjudicationInputDigest(input);
  const lockDirectory = `research/ledger/extraction-repair-adjudications/${fixture.paperId}/${inputDigest}`;
  const lockPath = `${lockDirectory}/.adjudicate.lock.json`;
  const staleOwner = {
    schemaVersion: 1,
    stage: "extractionRepairAdjudicationLock",
    paperId: fixture.paperId,
    adjudicationInputDigest: inputDigest,
    hostname: os.hostname(),
    pid: 2_147_483_647,
    token: "00000000-0000-4000-8000-000000000001",
    producerCodeSha256: EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256
  };
  const staleOwnerSha256 = await writeCanonical(fixture.root, lockPath, staleOwner);
  const result = await adjudicateExtractionRepair(adjudicationOptions(fixture));
  assert.equal(result.ok, true);
  const tombstonePath = `${lockDirectory}/.recovered-locks/${staleOwnerSha256}.json`;
  assert.deepEqual(
    JSON.parse(await readFile(absolute(fixture.root, tombstonePath), "utf8")),
    staleOwner
  );
});

test("candidate, crop, and record tampering all fail closed", async (t) => {
  await t.test("otherwise-valid visual sidecar drift invalidates the old adjudication", async (t) => {
    const fixture = await makeFixture();
    t.after(fixture.cleanup);
    const result = await adjudicateExtractionRepair(adjudicationOptions(fixture));
    const sidecar = JSON.parse(await readFile(absolute(fixture.root, fixture.sidecarPath), "utf8"));
    sidecar.observation = "Rendered source PDF page 1 visibly confirms the repaired equality operator, delimiter placement, and formula order after a changed review.";
    await writeCanonical(fixture.root, fixture.sidecarPath, sidecar);
    const currentCheck = await inspectExtractionRepairAdjudication({
      root: fixture.root,
      paper: fixture.paperId,
      repairInputDigest: fixture.repairInputDigest,
      requireAdjudicated: true
    });
    assert.equal(currentCheck.ok, false);
    assert.equal(currentCheck.adjudicated, false);
    assert.equal(currentCheck.reason, "no_current_adjudication");
    assert.notEqual(currentCheck.adjudicationInputDigest, result.adjudicationInputDigest);
    const oldRecordCheck = await inspectExtractionRepairAdjudication({
      root: fixture.root,
      paper: fixture.paperId,
      repairInputDigest: fixture.repairInputDigest,
      adjudicationPath: result.adjudicationPath,
      requireAdjudicated: true
    });
    assert.equal(oldRecordCheck.ok, false);
    assert.equal(oldRecordCheck.state, "failed_closed");
    assert.ok(oldRecordCheck.issues.includes("requested_record_not_found_for_current_input"));
  });

  await t.test("crop bytes drift", async (t) => {
    const fixture = await makeFixture();
    t.after(fixture.cleanup);
    await adjudicateExtractionRepair(adjudicationOptions(fixture));
    await writeFile(absolute(fixture.root, fixture.cropPath), Buffer.from("tampered crop"));
    const inspection = await inspectExtractionRepairAdjudication({
      root: fixture.root,
      paper: fixture.paperId,
      repairInputDigest: fixture.repairInputDigest,
      requireAdjudicated: true
    });
    assert.equal(inspection.ok, false);
    assert.equal(inspection.state, "failed_closed");
    assert.match(inspection.issues.join(" "), /visual evidence is not eligible|crop/i);
  });

  await t.test("candidate metadata drift", async (t) => {
    const fixture = await makeFixture();
    t.after(fixture.cleanup);
    await adjudicateExtractionRepair(adjudicationOptions(fixture));
    const candidate = JSON.parse(await readFile(absolute(fixture.root, fixture.candidatePaths.candidate), "utf8"));
    candidate.mappedGlyphCount += 1;
    await writeCanonical(fixture.root, fixture.candidatePaths.candidate, candidate);
    const inspection = await inspectExtractionRepairAdjudication({
      root: fixture.root,
      paper: fixture.paperId,
      repairInputDigest: fixture.repairInputDigest,
      requireAdjudicated: true
    });
    assert.equal(inspection.ok, false);
    assert.equal(inspection.state, "failed_closed");
    assert.match(inspection.issues.join(" "), /mapped glyph count mismatch/i);
  });

  await t.test("adjudication record bytes drift", async (t) => {
    const fixture = await makeFixture();
    t.after(fixture.cleanup);
    const result = await adjudicateExtractionRepair(adjudicationOptions(fixture));
    const record = JSON.parse(await readFile(absolute(fixture.root, result.adjudicationPath), "utf8"));
    record.rationale += " Tampered after publication.";
    await writeCanonical(fixture.root, result.adjudicationPath, record);
    const inspection = await inspectExtractionRepairAdjudication({
      root: fixture.root,
      paper: fixture.paperId,
      repairInputDigest: fixture.repairInputDigest,
      requireAdjudicated: true
    });
    assert.equal(inspection.ok, false);
    assert.equal(inspection.state, "failed_closed");
    assert.match(inspection.issues.join(" "), /record_digest_mismatch/);
  });
});
