import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  adjudicateExtractionRepair
} from "../scripts/extraction-repair-adjudication.mjs";
import {
  EXTRACTION_POLICY,
  EXTRACTOR_CODE_SHA256,
  acquireClaim,
  assertExtractionContract,
  makeLedger,
  repairPromotionExtractionContractIssues,
  sha256,
  stableStringify
} from "../scripts/corpus-pipeline.mjs";
import {
  EXTRACTION_QA_CODE_SHA256,
  EXTRACTION_QA_POLICY_SHA256,
  EXTRACTION_QA_VERSION,
  evaluateExtractionQa,
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
  commitExtractionRepairPromotion,
  inspectExtractionRepairPromotion,
  issuePromotionQuiescenceToken,
  parseExtractionRepairPromotionCli,
  prepareExtractionRepairPromotion,
  rollbackExtractionRepairPromotion
} from "../scripts/promote-extraction-repair.mjs";

const paperId = "doi-10-1000-fixture-0001";
const canonicalDoi = "10.1000/fixture.0001";
const ledgerPath = `research/ledger/papers/${paperId}.json`;
const downstreamStages = [
  "sectionIndex",
  "sourceReading",
  "noteAuthoring",
  "quoteAudit",
  "formulaAudit",
  "schemaValidation",
  "contentAudit",
  "sourceAudit",
  "releaseBuild"
];

function absolute(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

async function json(root, relativePath) {
  return JSON.parse(await readFile(absolute(root, relativePath), "utf8"));
}

async function writeCanonical(root, relativePath, value) {
  const destination = absolute(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  const bytes = Buffer.from(`${stableStringify(value, 2)}\n`, "utf8");
  await writeFile(destination, bytes);
  return sha256(bytes);
}

async function writeBytes(root, relativePath, bytes) {
  const destination = absolute(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return sha256(bytes);
}

function recordDigest(record) {
  return sha256(stableStringify(record));
}

function pagesText(pages) {
  return pages.map((page) => `===== PDF PAGE ${page.page} =====\n${page.text}`).join("\n\n") + "\n";
}

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-repair-promotion-"));
  const sourcePath = "paper/Fixture Repair Paper.pdf";
  const sourceBytes = Buffer.from("%PDF-1.7\nsynthetic immutable promotion fixture\n", "utf8");
  const sourcePdfSha256 = await writeBytes(root, sourcePath, sourceBytes);
  const recordBody = {
    aliases: [],
    authors: ["Fixture Author"],
    bibkey: "fixture2026promotion",
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
    corpusRevision: "fixture-revision",
    parser: {
      version: "fixture-parser",
      extractionCodeSha256: EXTRACTOR_CODE_SHA256,
      extractionPolicy: EXTRACTION_POLICY
    },
    records: [record]
  });

  const baseInputDigest = "a".repeat(64);
  const basePagesPath = `research/ledger/artifacts/${paperId}/${baseInputDigest}/pages.json`;
  const baseTextPath = `research/ledger/artifacts/${paperId}/${baseInputDigest}/text.txt`;
  const basePagesValue = {
    schemaVersion: 1,
    stage: "extractionPages",
    paperId,
    pages: [{ page: 1, text: "Fixture base page with a damaged formula x ! 1." }]
  };
  const basePagesSha256 = await writeCanonical(root, basePagesPath, basePagesValue);
  const baseTextSha256 = await writeBytes(root, baseTextPath, Buffer.from(pagesText(basePagesValue.pages), "utf8"));
  const extraction = {
    status: "complete",
    inputDigest: baseInputDigest,
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
    pipelineInputs: { authoringVersion: "fixture", conceptRegistrySha256: "fixture" },
    stages: {
      inventory: { status: "complete", inputDigest: record.recordDigest },
      extraction,
      extractQa: { status: "needs_review", reasons: ["parser_warning"] }
    }
  };
  await writeCanonical(root, ledgerPath, ledger);

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
    bindings: { sourcePdfSha256, basePagesSha256, extractionQaDecisionSha256: qaDecisionSha256 },
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
  const candidateTextSha256 = await writeBytes(root, candidatePaths.text,
    Buffer.from(pagesText(candidatePagesValue.pages), "utf8"));
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
    reviewer: "Fixture Visual Reviewer",
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
  const accepted = await adjudicateExtractionRepair({
    root,
    paper: paperId,
    repairInputDigest,
    disposition: "accepted",
    reviewerId: "fixture-independent-adjudicator",
    reviewer: "Fixture Independent Adjudicator",
    reviewedPages: [1],
    findings: [{
      page: 1,
      conclusion: "accept",
      observation: "Rendered source PDF page 1 visibly matches the candidate formula: operators, subscripts, delimiters, and reading order are preserved."
    }],
    rationale: `For ${canonicalDoi}, the independent comparison of the required source-PDF crop and its bound candidate page supports acceptance.`,
    attestIndependent: true,
    supersedes: ""
  });
  const adjudication = await json(root, accepted.adjudicationPath);
  const input = adjudication.adjudicationInput;
  for (const stage of downstreamStages) {
    ledger.stages[stage] = {
      status: "complete",
      inputDigest: sha256(`fixture-complete:${stage}`),
      sourcePdfSha256: ledger.pdfSha256,
      fixtureMarker: stage
    };
  }
  await writeCanonical(root, ledgerPath, ledger);
  return {
    root,
    adjudication,
    input,
    repairInputDigest,
    acceptedAdjudicationPath: accepted.adjudicationPath
  };
}

async function tokenFor(root, issuer = "promotion-test-operator") {
  return issuePromotionQuiescenceToken({
    root,
    paper: paperId,
    issuer,
    ttlMinutes: 15,
    attestWritersStopped: true
  });
}

async function withFixture(callback) {
  const fixture = await makeFixture();
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

test("promotion CLI and quiescence issuance fail closed", async () => {
  const parsed = parseExtractionRepairPromotionCli([
    "prepare",
    "--paper", paperId,
    "--repair-digest", "a".repeat(64),
    "--quiescence-token", "research/ledger/token.json"
  ]);
  assert.equal(parsed.command, "prepare");
  assert.throws(() => parseExtractionRepairPromotionCli([
    "quiesce", "--paper", paperId, "--issuer", "operator"
  ]), /attest-writers-stopped/);
  assert.throws(() => parseExtractionRepairPromotionCli([
    "commit", "--paper", paperId, "--promotion-digest", "a".repeat(64)
  ]), /quiescence-token/);

  await withFixture(async ({ root, repairInputDigest }) => {
    await assert.rejects(issuePromotionQuiescenceToken({
      root,
      paper: paperId,
      issuer: "promotion-test-operator"
    }), /attest-writers-stopped/);
    const token = await tokenFor(root);
    assert.match(token.quiescenceTokenPath, new RegExp(`${paperId}/[a-f0-9]{64}\\.json$`));
    assert.equal(token.changed, true);
    const currentLedgerSha256 = sha256(await readFile(absolute(root, ledgerPath)));
    const claim = await acquireClaim(root, paperId, currentLedgerSha256, 60);
    assert.ok(claim);
    try {
      await assert.rejects(prepareExtractionRepairPromotion({
        root,
        paper: paperId,
        repairInputDigest,
        quiescenceTokenPath: token.quiescenceTokenPath
      }), /claim is held elsewhere/);
    } finally {
      await unlink(claim.path);
    }
  });
});

test("prepare is immutable and commit atomically installs the accepted candidate contract", async () => {
  await withFixture(async ({ root, input, repairInputDigest }) => {
    const beforeBytes = await readFile(absolute(root, ledgerPath));
    const token = await tokenFor(root);
    const prepared = await prepareExtractionRepairPromotion({
      root,
      paper: paperId,
      repairInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    });
    assert.equal(prepared.state, "prepared");
    assert.deepEqual(await readFile(absolute(root, ledgerPath)), beforeBytes, "prepare must not change the paper ledger");
    assert.equal(prepared.output.textSha256, input.candidate.textSha256);
    assert.equal(prepared.output.pagesPath,
      `research/ledger/artifacts/${paperId}/${prepared.promotionInputDigest}/pages.json`);
    assert.equal(prepared.output.textPath,
      `research/ledger/artifacts/${paperId}/${prepared.promotionInputDigest}/text.txt`);

    const preparedInspection = await inspectExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest
    });
    assert.equal(preparedInspection.ok, true);
    assert.equal(preparedInspection.state, "prepared");

    const committed = await commitExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    });
    assert.equal(committed.state, "committed");
    const ledger = await json(root, ledgerPath);
    const manifest = await json(root, "research/corpus/manifest.v1.json");
    const record = manifest.records.find((item) => item.id === paperId);
    const extraction = ledger.stages.extraction;
    assert.equal(extraction.inputDigest, prepared.promotionInputDigest);
    assert.equal(extraction.repairPromotion.promotionInput.acceptedAdjudication.disposition, "accepted");
    assert.deepEqual(repairPromotionExtractionContractIssues(record, extraction), []);
    assert.doesNotThrow(() => assertExtractionContract(manifest, [{ record, ledger }]));
    assert.equal(ledger.stages.extractQa.status, "needs_review");
    assert.deepEqual(ledger.stages.extractQa.reasons, ["repair_promotion_requires_authoritative_qa"]);
    assert.equal(ledger.stages.extractQa.repairPromotionInputDigest, prepared.promotionInputDigest);
    const qaDecision = await evaluateExtractionQa(root, manifest, record, ledger);
    assert.equal(qaDecision.status, "needs_review");
    assert.equal(qaDecision.disposition, "manual_review_required");
    assert.deepEqual(qaDecision.validationErrors, []);
    assert.ok(qaDecision.unresolvedReasons.includes("repair_promotion_requires_authoritative_qa"));
    assert.ok(qaDecision.observations.includes("repair_promotion_transaction_verified"));
    assert.ok(qaDecision.observations.includes("repair_promotion_extractor_verified"));
    assert.equal(qaDecision.evidence.repairPromotion.status, "verified");
    assert.equal(qaDecision.evidence.repairPromotion.committedAfterLedgerSha256,
      sha256(await readFile(absolute(root, ledgerPath))));
    for (const stage of downstreamStages) {
      assert.equal(ledger.stages[stage].status, "invalidated", stage);
      assert.equal(ledger.stages[stage].invalidatedReason, "extraction_repair_promoted", stage);
      assert.equal(ledger.stages[stage].invalidatedByPromotionInputDigest, prepared.promotionInputDigest, stage);
    }

    const nativeRefresh = makeLedger(record, manifest, null, "f".repeat(64), ledger,
      ledger.pipelineInputs?.conceptRegistrySha256 || "");
    assert.equal(nativeRefresh.stages.extraction.inputDigest, prepared.promotionInputDigest,
      "inventory refresh must preserve a strictly valid promotion");
    assert.equal(nativeRefresh.stages.extractQa.repairPromotionInputDigest, prepared.promotionInputDigest);
    const qaTamperedLedger = structuredClone(ledger);
    qaTamperedLedger.stages.extractQa.status = "complete";
    const repairedRefresh = makeLedger(record, manifest, null, "f".repeat(64), qaTamperedLedger,
      ledger.pipelineInputs?.conceptRegistrySha256 || "");
    assert.equal(repairedRefresh.stages.extractQa.status, "needs_review",
      "inventory refresh must rebuild, not preserve, a tampered promotion extractQa stage");
    assert.deepEqual(repairedRefresh.stages.extractQa.reasons,
      ["repair_promotion_requires_authoritative_qa"]);

    const repeated = await commitExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    });
    assert.equal(repeated.changed, false);
    const checked = await inspectExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      requireCommitted: true
    });
    assert.equal(checked.ok, true);
    assert.equal(checked.state, "committed");

    ledger.stages.noteAuthoring = {
      status: "complete",
      inputDigest: sha256("fixture-note-authoring-after-promotion"),
      sourcePdfSha256: ledger.pdfSha256,
      noteSha256: sha256("fixture-note-after-promotion")
    };
    await writeCanonical(root, ledgerPath, ledger);
    const descendantDecision = await evaluateExtractionQa(root, manifest, record, ledger);
    assert.deepEqual(descendantDecision, qaDecision,
      "downstream-only ledger progress must preserve the authoritative QA decision bytes");

    const descendantInspection = await inspectExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      requireCommitted: true
    });
    assert.equal(descendantInspection.ok, true,
      "downstream-only ledger progress must not invalidate a committed promotion");
    assert.equal(descendantInspection.state, "committed");
    assert.equal(descendantInspection.promotionCurrent, true);
    assert.equal(descendantInspection.ledgerAdvanced, true);
    assert.notEqual(descendantInspection.currentLedgerSha256, descendantInspection.afterLedgerSha256);

    const restartedCommit = await commitExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    });
    assert.equal(restartedCommit.changed, false,
      "a commit retry after valid downstream progress must remain idempotent");

    ledger.stages.extraction.totalCharacters += 1;
    await writeCanonical(root, ledgerPath, ledger);
    const tamperedExtractionInspection = await inspectExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      requireCommitted: true
    });
    assert.equal(tamperedExtractionInspection.ok, false);
    assert.equal(tamperedExtractionInspection.promotionCurrent, false);
    assert.ok(tamperedExtractionInspection.issues.includes("commit_extraction_mismatch"));
  });
});

test("Extraction QA fails closed for forged, tampered, or uncommitted repair promotions", async () => {
  await withFixture(async ({ root, input, repairInputDigest }) => {
    const token = await tokenFor(root);
    const prepared = await prepareExtractionRepairPromotion({
      root,
      paper: paperId,
      repairInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    });
    const committed = await commitExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    });
    const manifest = await json(root, "research/corpus/manifest.v1.json");
    const record = manifest.records.find((item) => item.id === paperId);
    const ledger = await json(root, ledgerPath);

    const forgedLedger = structuredClone(ledger);
    forgedLedger.stages.extraction.repairPromotion.promotionInput.acceptedAdjudication.sha256 = "b".repeat(64);
    const forged = await evaluateExtractionQa(root, manifest, record, forgedLedger);
    assert.equal(forged.status, "failed");
    assert.ok(forged.validationErrors.some((entry) => entry.code === "repair_promotion_contract_invalid"));

    const provenancePath = absolute(root, input.candidate.provenancePath);
    const provenanceBytes = await readFile(provenancePath);
    await writeFile(provenancePath, Buffer.concat([provenanceBytes, Buffer.from("tampered") ]));
    const tampered = await evaluateExtractionQa(root, manifest, record, ledger);
    assert.equal(tampered.status, "failed");
    assert.ok(tampered.validationErrors.some((entry) => (
      entry.code === "repair_promotion_transaction_invalid"
      && /candidate provenance/.test(entry.detail)
    )));
    await writeFile(provenancePath, provenanceBytes);

    await unlink(absolute(root, committed.commitPath));
    const uncommitted = await evaluateExtractionQa(root, manifest, record, ledger);
    assert.equal(uncommitted.status, "failed");
    assert.ok(uncommitted.validationErrors.some((entry) => (
      entry.code === "repair_promotion_transaction_invalid"
      && entry.detail === "current_commit_required"
    )));
  });
});

test("prepare, commit, and rollback recover idempotently at injected crash boundaries", async () => {
  await withFixture(async ({ root, repairInputDigest }) => {
    const beforeBytes = await readFile(absolute(root, ledgerPath));
    const token = await tokenFor(root);
    await assert.rejects(prepareExtractionRepairPromotion({
      root,
      paper: paperId,
      repairInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath,
      faultAt: "after_output_pages"
    }), /Injected.*after_output_pages/);
    const prepared = await prepareExtractionRepairPromotion({
      root,
      paper: paperId,
      repairInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    });

    await assert.rejects(commitExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath,
      faultAt: "after_ledger_commit"
    }), /Injected.*after_ledger_commit/);
    const pendingCommit = await inspectExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest
    });
    assert.equal(pendingCommit.state, "ledger_committed_pending_commit_record");
    assert.equal(pendingCommit.ok, true);
    await commitExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    });

    const rollbackToken = await tokenFor(root, "rollback-test-operator");
    await assert.rejects(rollbackExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: rollbackToken.quiescenceTokenPath,
      faultAt: "after_ledger_rollback"
    }), /Injected.*after_ledger_rollback/);
    assert.deepEqual(await readFile(absolute(root, ledgerPath)), beforeBytes,
      "rollback crash boundary must already have restored the exact before snapshot");
    const rollback = await rollbackExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: rollbackToken.quiescenceTokenPath
    });
    assert.equal(rollback.state, "rolled_back");
    const repeated = await rollbackExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: rollbackToken.quiescenceTokenPath
    });
    assert.equal(repeated.changed, false);
    const inspected = await inspectExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest
    });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.state, "rolled_back");
  });
});

test("promotion detects artifact tampering and unknown ledger CAS state", async () => {
  await withFixture(async ({ root, input, repairInputDigest }) => {
    const token = await tokenFor(root);
    const prepared = await prepareExtractionRepairPromotion({
      root,
      paper: paperId,
      repairInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    });
    const outputPath = absolute(root, prepared.output.pagesPath);
    const validOutput = await readFile(outputPath);
    const sidecarPath = absolute(root, input.visualQa.sidecars[0].sidecarPath);
    const validSidecar = await readFile(sidecarPath);
    await writeFile(sidecarPath, Buffer.concat([validSidecar, Buffer.from("tampered") ]));
    await assert.rejects(commitExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    }), /visual sidecar is not valid JSON|visual sidecar is not canonical|visual sidecar binding mismatch/);
    await writeFile(sidecarPath, validSidecar);

    await writeFile(outputPath, Buffer.concat([validOutput, Buffer.from("tampered") ]));
    await assert.rejects(commitExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    }), /promoted pages is not valid JSON|promoted pages is not canonical|promoted pages hash mismatch/);
    await writeFile(outputPath, validOutput);

    const ledger = await json(root, ledgerPath);
    ledger.testConcurrentWriter = "CAS must reject this changed ledger";
    await writeCanonical(root, ledgerPath, ledger);
    await assert.rejects(commitExtractionRepairPromotion({
      root,
      paper: paperId,
      promotionInputDigest: prepared.promotionInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    }), /ledger SHA CAS failed before commit/);
  });
});

test("prepare rejects a superseding current terminal rejection", async () => {
  await withFixture(async ({ root, input, repairInputDigest, acceptedAdjudicationPath }) => {
    const page = input.visualQa.requiredPages[0];
    await adjudicateExtractionRepair({
      root,
      paper: paperId,
      repairInputDigest,
      disposition: "rejected",
      reviewerId: "promotion-gate-independent-rejector",
      reviewer: "Promotion gate independent rejector",
      reviewedPages: [page],
      findings: [{
        page,
        conclusion: "reject",
        observation: `Rendered source PDF page ${page} formula differs from the candidate because the comparison operator is visibly incorrect in the bound crop.`
      }],
      rationale: `For ${canonicalDoi}, the independently reviewed source crop shows a material formula mismatch, so the current repair must be rejected.`,
      attestIndependent: true,
      supersedes: acceptedAdjudicationPath
    });
    const token = await tokenFor(root);
    await assert.rejects(prepareExtractionRepairPromotion({
      root,
      paper: paperId,
      repairInputDigest,
      quiescenceTokenPath: token.quiescenceTokenPath
    }), /current terminal accepted repair adjudication required/);
  });
});
