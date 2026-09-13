import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXTRACTION_POLICY,
  EXTRACTOR_CODE_SHA256,
  extractionCorruptionProfile,
  sha256,
  status as corpusStatus,
  stableStringify
} from "../scripts/corpus-pipeline.mjs";
import {
  adjudicationContentIssues,
  adjudicateExtractionQa,
  evaluateExtractionQa,
  extractionQaCheckpointBinding,
  extractionQaDecisionRelativePath,
  extractionQaStatus,
  parseExtractionQaCli,
  reviewExtractions,
  verifyExtractionQaCheckpoint
} from "../scripts/extraction-qa.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-extraction-qa-"));
  const pdfBytes = Buffer.from("%PDF-deterministic extraction QA fixture\n", "utf8");
  const repeated = "Readable extraction test content preserves paragraphs and page identity. ".repeat(10);
  const pages = [
    { page: 1, text: `Readable Extraction Test\n${repeated}` },
    { page: 2, text: repeated }
  ];
  const selectedProfile = extractionCorruptionProfile(pages);
  let primaryProfile = options.primaryLegacy
    ? {
        ...selectedProfile,
        embeddedM: 100,
        brokenK: 50,
        encodedHeadings: 10,
        terminalN: 150,
        legacyFontMap: true
      }
    : { ...selectedProfile, rawGlyphNames: 10 };
  let fallbackProfile = selectedProfile;
  let selectedEngine = "pymupdf";
  let selectedEngineVersion = "fixture-pymupdf";
  let fallbackUsed = true;
  let fallbackReason = "systematic-text-corruption";
  if (options.fallbackRejected) {
    primaryProfile = selectedProfile;
    fallbackProfile = { ...selectedProfile, rawGlyphNames: 10 };
    selectedEngine = "pypdf";
    selectedEngineVersion = "fixture-pypdf";
    fallbackUsed = false;
    fallbackReason = "alternate-parser-not-cleaner";
  }
  const record = {
    id: "paper-a",
    canonicalDoi: "10.1000/paper-a",
    doiUrl: "https://doi.org/10.1000/paper-a",
    aliases: ["doi-10-1000-paper-a"],
    title: "Readable Extraction Test",
    recordDigest: "record-digest",
    pdf: {
      path: "paper/paper-a.pdf",
      sha256: sha256(pdfBytes),
      bytes: pdfBytes.length,
      pageCount: pages.length
    }
  };
  const extractionInputDigest = "extraction-input";
  const artifactBase = path.posix.join("research", "ledger", "artifacts", record.id, extractionInputDigest);
  const pagesRelativePath = path.posix.join(artifactBase, "pages.json");
  const textRelativePath = path.posix.join(artifactBase, "text.txt");
  const pagesPayload = {
    schemaVersion: 1,
    paperId: record.id,
    canonicalDoi: record.canonicalDoi,
    pdfSha256: record.pdf.sha256,
    extractor: {
      name: "pypdf+pymupdf-fallback",
      version: "fixture",
      codeSha256: EXTRACTOR_CODE_SHA256,
      selectedEngine,
      selectedEngineVersion,
      fallbackAttempted: true,
      fallbackUsed,
      fallbackReason,
      primaryCorruptionProfile: primaryProfile,
      fallbackCorruptionProfile: fallbackProfile,
      selectedCorruptionProfile: selectedProfile,
      extractionPolicy: EXTRACTION_POLICY
    },
    pages
  };
  const pagesText = `${stableStringify(pagesPayload, 2)}\n`;
  const plainText = pages.map((page) => `===== PDF PAGE ${page.page} =====\n${page.text}`).join("\n\n") + "\n";
  const warningCodes = options.parserWarning ? ["parser_warning"] : [];
  const ledger = {
    schemaVersion: 1,
    paperId: record.id,
    canonicalDoi: record.canonicalDoi,
    corpusRevision: "fixture-revision",
    manifestRecordDigest: record.recordDigest,
    pdfSha256: record.pdf.sha256,
    stages: {
      inventory: { status: "complete" },
      extraction: {
        status: "complete",
        inputDigest: extractionInputDigest,
        sourcePdfSha256: record.pdf.sha256,
        pageCount: pages.length,
        totalCharacters: pages.reduce((sum, page) => sum + page.text.length, 0),
        emptyPages: [],
        pageErrors: [],
        parserWarningCount: options.parserWarning ? 1 : 0,
        parserWarningCodes: warningCodes,
        selectedEngine,
        selectedEngineVersion,
        fallbackAttempted: true,
        fallbackUsed,
        fallbackReason,
        primaryCorruptionProfile: primaryProfile,
        fallbackCorruptionProfile: fallbackProfile,
        selectedCorruptionProfile: selectedProfile,
        artifacts: {
          pages: pagesRelativePath,
          pagesSha256: sha256(pagesText),
          text: textRelativePath,
          textSha256: sha256(plainText)
        }
      },
      extractQa: {
        status: (options.parserWarning || fallbackUsed) ? "needs_review" : "complete",
        inputDigest: extractionInputDigest,
        sourcePdfSha256: record.pdf.sha256,
        reasons: [
          ...(options.parserWarning ? ["parser_warning"] : []),
          ...(fallbackUsed ? ["alternate_parser_fallback"] : [])
        ],
        warningCodes,
        pageErrors: [],
        emptyPages: [],
        totalCharacters: pages.reduce((sum, page) => sum + page.text.length, 0),
        selectedEngine,
        selectedEngineVersion,
        fallbackAttempted: true,
        fallbackUsed,
        fallbackReason,
        primaryCorruptionProfile: primaryProfile,
        fallbackCorruptionProfile: fallbackProfile,
        selectedCorruptionProfile: selectedProfile
      },
      sectionIndex: { status: "complete" },
      sourceReading: { status: "complete" },
      noteAuthoring: { status: "complete" },
      quoteAudit: { status: "complete" },
      formulaAudit: { status: "complete" },
      schemaValidation: { status: "complete" },
      contentAudit: { status: "complete" },
      sourceAudit: { status: "complete" },
      releaseBuild: { status: "complete" }
    }
  };
  const manifest = {
    schemaVersion: 1,
    corpusRevision: "fixture-revision",
    counts: { detailLevels: { literature: 1 }, parserWarningPdfs: options.parserWarning ? 1 : 0 },
    parser: { extractionCodeSha256: EXTRACTOR_CODE_SHA256 },
    records: [record]
  };
  await mkdir(path.join(root, "paper"), { recursive: true });
  await mkdir(path.join(root, ...artifactBase.split("/")), { recursive: true });
  await mkdir(path.join(root, "research", "corpus"), { recursive: true });
  await mkdir(path.join(root, "research", "ledger", "papers"), { recursive: true });
  await writeFile(path.join(root, "paper", "paper-a.pdf"), pdfBytes);
  await writeFile(path.join(root, ...pagesRelativePath.split("/")), pagesText);
  await writeFile(path.join(root, ...textRelativePath.split("/")), plainText);
  await writeFile(path.join(root, "research", "corpus", "manifest.v1.json"), `${stableStringify(manifest, 2)}\n`);
  const ledgerPath = path.join(root, "research", "ledger", "papers", `${record.id}.json`);
  await writeFile(ledgerPath, `${stableStringify(ledger, 2)}\n`);
  return { root, manifest, record, ledger, ledgerPath, pagesRelativePath };
}

function cliOptions(root, additions = {}) {
  return {
    command: "review",
    root,
    papers: [],
    from: "",
    limit: null,
    jobs: 2,
    dryRun: false,
    force: false,
    check: false,
    adjudication: "",
    reviewer: "",
    rationale: "",
    reviewedPages: [],
    findings: [],
    json: false,
    help: false,
    ...additions
  };
}

test("Extraction QA CLI provides bounded dry-run, check, and resume selectors", () => {
  assert.equal(parseExtractionQaCli([]).command, "status");
  const review = parseExtractionQaCli([
    "review", "--paper", "paper-a,10.1000/paper-a", "--from", "paper-a",
    "--limit", "2", "--jobs", "3", "--dry-run"
  ]);
  assert.equal(review.command, "review");
  assert.deepEqual(review.papers, ["paper-a", "10.1000/paper-a"]);
  assert.equal(review.from, "paper-a");
  assert.equal(review.limit, 2);
  assert.equal(review.jobs, 3);
  assert.equal(review.dryRun, true);
  const check = parseExtractionQaCli(["--select", "check"]);
  assert.equal(check.command, "review");
  assert.equal(check.check, true);
  assert.throws(() => parseExtractionQaCli(["status", "--dry-run"]), /review-only/);
  assert.throws(() => parseExtractionQaCli(["review", "--check", "--dry-run"]), /mutually exclusive/);
  const adjudicate = parseExtractionQaCli([
    "adjudicate", "--paper", "paper-a", "--accept", "--reviewer", "QA reviewer",
    "--pages", "2,1",
    "--finding", "1|accept|parser_warning|Rendered source PDF page 1 visibly preserves the title heading, paragraph spacing, and equation glyphs in extracted text.",
    "--finding", "2|accept|parser_warning|Visual comparison of source PDF page 2 confirms readable body text, stable line layout, and intact mathematical symbols.",
    "--rationale", "For Readable Extraction Test, rendered source PDF page 1 and page 2 were visually compared with extracted text; equations, headings, paragraphs, and glyph layout remained readable."
  ]);
  assert.equal(adjudicate.command, "adjudicate");
  assert.deepEqual(adjudicate.reviewedPages, [1, 2]);
  assert.deepEqual(adjudicate.findings.map((finding) => finding.page), [1, 2]);
  assert.throws(() => parseExtractionQaCli([
    "adjudicate", "--paper", "paper-a", "--accept", "--reviewer", "QA",
    "--pages", "1", "--rationale", "too short"
  ]), /Invalid adjudication evidence/);
});

function validAdjudication(data, additions = {}) {
  return cliOptions(data.root, {
    command: "adjudicate",
    papers: [data.record.id],
    adjudication: "accepted",
    reviewer: "Fixture QA reviewer",
    rationale: "For Readable Extraction Test, rendered source PDF page 1 and page 2 were visually compared with extracted text; equations, headings, paragraphs, and glyph layout remained readable.",
    reviewedPages: [1, 2],
    findings: [
      {
        page: 1,
        conclusion: "accept",
        reasonCodes: ["parser_warning"],
        observation: "Rendered source PDF page 1 visibly preserves the title heading, paragraph spacing, and equation glyphs in extracted text."
      },
      {
        page: 2,
        conclusion: "accept",
        reasonCodes: ["parser_warning"],
        observation: "Visual comparison of source PDF page 2 confirms readable body text, stable line layout, and intact mathematical symbols."
      }
    ],
    ...additions
  });
}

test("a clean fallback is accepted without erasing fallback provenance", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));
  const decision = await evaluateExtractionQa(data.root, data.manifest, data.record, data.ledger);
  assert.equal(decision.status, "complete");
  assert.equal(decision.disposition, "accepted");
  assert.deepEqual(decision.unresolvedReasons, []);
  assert.deepEqual(decision.sourceReasons, ["alternate_parser_fallback"]);
  assert.ok(decision.observations.includes("alternate_parser_fallback_verified"));
  assert.ok(decision.observations.includes("source_pdf_hash_verified"));
});

test("parser warnings and whole-font-map corruption stay visible for manual review", async (t) => {
  const warning = await fixture({ parserWarning: true });
  const legacy = await fixture({ primaryLegacy: true });
  t.after(async () => {
    await rm(warning.root, { recursive: true, force: true });
    await rm(legacy.root, { recursive: true, force: true });
  });
  const warningDecision = await evaluateExtractionQa(warning.root, warning.manifest, warning.record, warning.ledger);
  assert.equal(warningDecision.status, "needs_review");
  assert.deepEqual(warningDecision.unresolvedReasons, ["parser_warning"]);
  assert.ok(warningDecision.sourceReasons.includes("alternate_parser_fallback"));
  assert.ok(warningDecision.sourceReasons.includes("parser_warning"));
  const legacyDecision = await evaluateExtractionQa(legacy.root, legacy.manifest, legacy.record, legacy.ledger);
  assert.equal(legacyDecision.status, "needs_review");
  assert.deepEqual(legacyDecision.unresolvedReasons, ["primary_legacy_font_map"]);
});

test("artifact tampering fails closed", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));
  await writeFile(path.join(data.root, ...data.pagesRelativePath.split("/")), "{}\n");
  const decision = await evaluateExtractionQa(data.root, data.manifest, data.record, data.ledger);
  assert.equal(decision.status, "failed");
  assert.ok(decision.unresolvedReasons.includes("pages_artifact_hash_mismatch"));
  assert.ok(decision.unresolvedReasons.includes("pages_array_missing"));
});

test("review checkpoints are content-addressed, restartable, and checkable", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));
  const originalLedgerText = await readFile(data.ledgerPath, "utf8");
  const first = await reviewExtractions(cliOptions(data.root));
  assert.equal(first.selected, 1);
  assert.deepEqual(first.statuses, { complete: 1 });
  const ledger = JSON.parse(await readFile(data.ledgerPath, "utf8"));
  assert.equal(await readFile(data.ledgerPath, "utf8"), originalLedgerText, "QA does not mutate the shared ledger");
  const decisionRelativePath = extractionQaDecisionRelativePath(data.record, ledger);
  assert.ok(await readFile(path.join(data.root, ...decisionRelativePath.split("/")), "utf8"));

  const status = await extractionQaStatus(cliOptions(data.root, { command: "status" }));
  assert.deepEqual(status.checkpoints, { current: 1 });
  assert.deepEqual(status.qaStatuses, { complete: 1 });
  assert.equal(status.terminal, 1);
  assert.equal(status.releaseReady, 1);
  const second = await reviewExtractions(cliOptions(data.root));
  assert.equal(second.selected, 0);
  assert.equal(second.skippedCurrent, 1);
  const checked = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(checked.ok, true);

  await writeFile(path.join(data.root, ...data.pagesRelativePath.split("/")), "{}\n");
  const failedCheck = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(failedCheck.ok, false);
  assert.equal(failedCheck.failures[0].reason, "review_decision_not_reproducible");
});

test("normal resume retries a current failed decision and check rejects manual-incomplete decisions", async (t) => {
  const failed = await fixture();
  const manual = await fixture({ parserWarning: true });
  t.after(async () => {
    await rm(failed.root, { recursive: true, force: true });
    await rm(manual.root, { recursive: true, force: true });
  });

  const originalPages = await readFile(path.join(failed.root, ...failed.pagesRelativePath.split("/")));
  await writeFile(path.join(failed.root, ...failed.pagesRelativePath.split("/")), "{}\n");
  const first = await reviewExtractions(cliOptions(failed.root));
  assert.deepEqual(first.statuses, { failed: 1 });
  await writeFile(path.join(failed.root, ...failed.pagesRelativePath.split("/")), originalPages);
  const retried = await reviewExtractions(cliOptions(failed.root));
  assert.equal(retried.selected, 1, "a failed current decision is not skipped");
  assert.deepEqual(retried.statuses, { complete: 1 });

  const manualReview = await reviewExtractions(cliOptions(manual.root));
  assert.deepEqual(manualReview.statuses, { needs_review: 1 });
  const checked = await reviewExtractions(cliOptions(manual.root, { check: true }));
  assert.equal(checked.ok, false);
  assert.equal(checked.failures[0].reason, "manual_review_incomplete");
});

test("normal resume repairs a terminal decision whose content no longer reproduces", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));
  await reviewExtractions(cliOptions(data.root));
  const ledger = JSON.parse(await readFile(data.ledgerPath, "utf8"));
  const relativePath = extractionQaDecisionRelativePath(data.record, ledger);
  const decisionPath = path.join(data.root, ...relativePath.split("/"));
  const tampered = JSON.parse(await readFile(decisionPath, "utf8"));
  tampered.observations.push("invented_terminal_observation");
  await writeFile(decisionPath, `${stableStringify(tampered, 2)}\n`);

  const beforeRepair = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(beforeRepair.ok, false);
  assert.equal(beforeRepair.failures[0].reason, "review_decision_not_reproducible");
  const repaired = await reviewExtractions(cliOptions(data.root));
  assert.equal(repaired.selected, 1);
  assert.deepEqual(repaired.statuses, { complete: 1 });
  assert.equal((await reviewExtractions(cliOptions(data.root, { check: true }))).ok, true);
});

test("standalone corpus check-ready verifies missing, tampered, and failed authoritative QA", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));
  await reviewExtractions(cliOptions(data.root));
  const ledger = JSON.parse(await readFile(data.ledgerPath, "utf8"));
  const relativePath = extractionQaDecisionRelativePath(data.record, ledger);
  const decisionPath = path.join(data.root, ...relativePath.split("/"));
  const statusOptions = { root: data.root, checkReady: true, refreshSummary: false, jobs: 1 };
  const checkpoint = await verifyExtractionQaCheckpoint(data.root, data.manifest, data.record, ledger);
  const binding = extractionQaCheckpointBinding(checkpoint);
  for (const stage of [
    "sectionIndex", "sourceReading", "noteAuthoring", "quoteAudit", "formulaAudit",
    "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"
  ]) Object.assign(ledger.stages[stage], binding);
  await writeFile(data.ledgerPath, `${stableStringify(ledger, 2)}\n`);

  const current = await corpusStatus(statusOptions);
  assert.equal(current.releaseReady, true);
  assert.equal(current.qaReadiness.ok, true);

  const staleDownstream = structuredClone(ledger);
  staleDownstream.stages.releaseBuild.extractionQaDecisionSha256 = "9".repeat(64);
  await writeFile(data.ledgerPath, `${stableStringify(staleDownstream, 2)}\n`);
  const unbound = await corpusStatus(statusOptions);
  assert.equal(unbound.releaseReady, false);
  assert.equal(unbound.qaReadiness.failures[0].reason, "downstream_qa_binding_mismatch");
  assert.ok(unbound.qaReadiness.failures[0].downstreamBindingIssues.includes("releaseBuild_qa_binding_mismatch"));
  await writeFile(data.ledgerPath, `${stableStringify(ledger, 2)}\n`);

  await rm(decisionPath);
  const missing = await corpusStatus(statusOptions);
  assert.equal(missing.releaseReady, false);
  assert.equal(missing.qaReadiness.failures[0].reason, "review_decision_missing");
  await reviewExtractions(cliOptions(data.root));

  const tampered = JSON.parse(await readFile(decisionPath, "utf8"));
  tampered.observations.push("invented_release_ready_observation");
  await writeFile(decisionPath, `${stableStringify(tampered, 2)}\n`);
  const stale = await corpusStatus(statusOptions);
  assert.equal(stale.releaseReady, false);
  assert.equal(stale.qaReadiness.failures[0].reason, "review_decision_not_reproducible");
  await reviewExtractions(cliOptions(data.root));

  await writeFile(path.join(data.root, ...data.pagesRelativePath.split("/")), "{}\n");
  await reviewExtractions(cliOptions(data.root));
  const failed = await corpusStatus(statusOptions);
  assert.equal(failed.releaseReady, false);
  assert.equal(failed.qaReadiness.failures[0].reason, "qa_validation_failed");
});

test("a hash-bound manual adjudication resolves needs_review and fails closed when tampered", async (t) => {
  const data = await fixture({ parserWarning: true });
  t.after(() => rm(data.root, { recursive: true, force: true }));
  await reviewExtractions(cliOptions(data.root));
  const incomplete = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.failures[0].reason, "manual_review_incomplete");

  const adjudicated = await adjudicateExtractionQa(validAdjudication(data));
  assert.equal(adjudicated.ok, true);
  const checked = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(checked.ok, true);
  const ledger = JSON.parse(await readFile(data.ledgerPath, "utf8"));
  const verified = await verifyExtractionQaCheckpoint(data.root, data.manifest, data.record, ledger);
  const binding = extractionQaCheckpointBinding(verified);
  assert.equal(binding.extractionQaStatus, "complete");
  assert.equal(binding.extractionQaAutomatedStatus, "needs_review");
  assert.equal(binding.extractionQaAdjudicationStatus, "accepted");
  assert.match(binding.extractionQaAdjudicationSha256, /^[a-f0-9]{64}$/);

  const adjudicationPath = path.join(data.root, ...adjudicated.adjudicationPath.split("/"));
  const tampered = JSON.parse(await readFile(adjudicationPath, "utf8"));
  tampered.rationale = "too short";
  await writeFile(adjudicationPath, `${stableStringify(tampered, 2)}\n`);
  const tamperedCheck = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(tamperedCheck.ok, false);
  assert.equal(tamperedCheck.failures[0].reason, "manual_adjudication_content_invalid");

  const repaired = await adjudicateExtractionQa(validAdjudication(data));
  assert.equal(repaired.ok, true, "the command can replace a malformed adjudication without manual deletion");

  const wrongDecision = JSON.parse(await readFile(adjudicationPath, "utf8"));
  wrongDecision.automatedDecisionSha256 = "0".repeat(64);
  await writeFile(adjudicationPath, `${stableStringify(wrongDecision, 2)}\n`);
  const wrongDecisionCheck = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(wrongDecisionCheck.ok, false);
  assert.equal(wrongDecisionCheck.failures[0].reason, "manual_adjudication_binding_mismatch");
  await adjudicateExtractionQa(validAdjudication(data));

  const wrongPages = JSON.parse(await readFile(adjudicationPath, "utf8"));
  wrongPages.extractionPagesSha256 = "f".repeat(64);
  await writeFile(adjudicationPath, `${stableStringify(wrongPages, 2)}\n`);
  const wrongPagesCheck = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(wrongPagesCheck.ok, false);
  assert.equal(wrongPagesCheck.failures[0].reason, "manual_adjudication_binding_mismatch");
  const restored = await adjudicateExtractionQa(validAdjudication(data));
  assert.equal(restored.ok, true);
});

test("manual adjudication evidence rejects repetition, boilerplate, duplicates, and missing page references", async (t) => {
  const data = await fixture({ parserWarning: true });
  t.after(() => rm(data.root, { recursive: true, force: true }));
  const decision = await evaluateExtractionQa(data.root, data.manifest, data.record, data.ledger);
  const valid = validAdjudication(data);
  const context = { record: data.record, decision, disposition: "accepted" };

  assert.ok(adjudicationContentIssues({ ...valid, ...context, rationale: "a".repeat(60) })
    .some((issue) => issue === "rationale_repeated_characters"));
  assert.ok(adjudicationContentIssues({
    ...valid,
    ...context,
    rationale: "For Readable Extraction Test, reviewed source PDF page 1 and page 2 and everything looks good after visual comparison with extracted text and equations."
  }).some((issue) => issue === "rationale_placeholder_or_boilerplate"));
  assert.ok(adjudicationContentIssues({
    ...valid,
    ...context,
    findings: valid.findings.map((finding) => ({
      ...finding,
      observation: valid.findings[0].observation.replace("page 1", `page ${finding.page}`)
    }))
  }).some((issue) => issue === "duplicate_page_observations"));
  assert.ok(adjudicationContentIssues({
    ...valid,
    ...context,
    findings: valid.findings.map((finding) => ({
      ...finding,
      observation: `Rendered source PDF page ${finding.page} was visually compared and inspected carefully against the extracted material in detail.`
    }))
  }).some((issue) => issue.endsWith("concrete_feature_missing")));
  assert.ok(adjudicationContentIssues({
    ...valid,
    ...context,
    rationale: "For Readable Extraction Test, the rendered source PDF was visually compared with extracted text, and detailed equation, heading, paragraph, symbol, and layout evidence remained readable."
  }).some((issue) => issue === "rationale_required_page_reference_missing"));
});

test("a rejected adjudication can be corrected to accepted without deleting its sidecar", async (t) => {
  const data = await fixture({ parserWarning: true });
  t.after(() => rm(data.root, { recursive: true, force: true }));
  await reviewExtractions(cliOptions(data.root));
  const rejected = validAdjudication(data, {
    adjudication: "rejected",
    rationale: "For Readable Extraction Test, rendered source PDF page 1 and page 2 were visually compared; page 1 contains a damaged equation glyph while page 2 retains readable paragraph layout.",
    findings: [
      {
        page: 1,
        conclusion: "reject",
        reasonCodes: ["parser_warning"],
        observation: "Rendered source PDF page 1 exposes a visibly damaged equation glyph absent from the extracted text near the title heading."
      },
      validAdjudication(data).findings[1]
    ]
  });
  const recordedReject = await adjudicateExtractionQa(rejected);
  assert.equal(recordedReject.recorded, true);
  assert.equal(recordedReject.effectiveStatus, "failed");
  assert.equal(recordedReject.ok, false);
  const rejectedCheck = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(rejectedCheck.ok, false);
  assert.equal(rejectedCheck.failures[0].reason, "manual_review_rejected");

  const corrected = await adjudicateExtractionQa(validAdjudication(data));
  assert.equal(corrected.ok, true);
  const correctedCheck = await reviewExtractions(cliOptions(data.root, { check: true }));
  assert.equal(correctedCheck.ok, true);
});

test("manual adjudication cannot bypass failed validation or omit a required trigger page", async (t) => {
  const manual = await fixture({ parserWarning: true });
  const failed = await fixture();
  t.after(async () => {
    await rm(manual.root, { recursive: true, force: true });
    await rm(failed.root, { recursive: true, force: true });
  });
  await reviewExtractions(cliOptions(manual.root));
  await assert.rejects(adjudicateExtractionQa(validAdjudication(manual, {
    rationale: "For Readable Extraction Test, rendered source PDF page 1 was visually compared with extracted text; the title, equations, paragraphs, and glyph layout remained readable.",
    reviewedPages: [1],
    findings: [validAdjudication(manual).findings[0]]
  })), /required_page_missing|trigger_page_reason_not_covered|rationale_required_page_reference_missing/);

  await writeFile(path.join(failed.root, ...failed.pagesRelativePath.split("/")), "{}\n");
  await reviewExtractions(cliOptions(failed.root));
  await assert.rejects(adjudicateExtractionQa(validAdjudication(failed)), /qa_validation_failed|only a current needs_review decision may be manually adjudicated/);
});

test("legacy QA metadata is fully evidence-bound and stale fields fail validation", async (t) => {
  const data = await fixture();
  t.after(() => rm(data.root, { recursive: true, force: true }));
  data.ledger.stages.extractQa.selectedEngineVersion = "tampered-version";
  data.ledger.stages.extractQa.warningCodes = ["invented_warning"];
  const decision = await evaluateExtractionQa(data.root, data.manifest, data.record, data.ledger);
  assert.equal(decision.status, "failed");
  assert.ok(decision.unresolvedReasons.includes("qa_selectedEngineVersion_mismatch"));
  assert.ok(decision.unresolvedReasons.includes("qa_warningCodes_mismatch"));
});

test("an attempted but rejected alternate parser preserves and validates provenance", async (t) => {
  const data = await fixture({ fallbackRejected: true });
  t.after(() => rm(data.root, { recursive: true, force: true }));
  const decision = await evaluateExtractionQa(data.root, data.manifest, data.record, data.ledger);
  assert.equal(decision.status, "complete");
  assert.equal(decision.evidence.extraction.selectedEngine, "pypdf");
  assert.ok(decision.observations.includes("alternate_parser_rejection_verified"));
  assert.ok(!decision.sourceReasons.includes("alternate_parser_fallback"));

  data.ledger.stages.extraction.fallbackReason = "systematic-text-corruption";
  const invalid = await evaluateExtractionQa(data.root, data.manifest, data.record, data.ledger);
  assert.equal(invalid.status, "failed");
  assert.ok(invalid.unresolvedReasons.includes("retained_primary_fallback_reason_mismatch"));
});

test("the anomaly-stratified visual sample stays bound to current corpus bytes", async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "research", "corpus", "manifest.v1.json"), "utf8"));
  const byId = new Map(manifest.records.map((record) => [record.id, record]));
  const sample = JSON.parse(await readFile(path.join(projectRoot, "research", "extraction-qa-visual-sample.v1.json"), "utf8"));
  assert.equal(sample.schemaVersion, 1);
  assert.equal(sample.policyVersion, "extraction-qa-v1");
  assert.deepEqual(sample.corpus, {
    records: 1653,
    fallbackSelected: 1547,
    parserWarnings: 2
  });
  assert.equal(sample.entries.length, 4);
  assert.equal(new Set(sample.entries.map((entry) => entry.stratum)).size, sample.entries.length);
  for (const entry of sample.entries) {
    const record = byId.get(entry.paperId);
    assert.ok(record, `${entry.paperId}: sampled paper remains in manifest`);
    assert.equal(entry.doi, record.canonicalDoi, `${entry.paperId}: DOI binding`);
    assert.equal(entry.sourcePdf, record.pdf.path, `${entry.paperId}: PDF path binding`);
    assert.equal(entry.sourcePdfSha256, record.pdf.sha256, `${entry.paperId}: PDF hash binding`);
    const reviewedPages = Array.isArray(entry.pagesReviewed) ? entry.pagesReviewed : [entry.pageReviewed];
    assert.ok(reviewedPages.length > 0
      && reviewedPages.every((page) => Number.isInteger(page) && page >= 1 && page <= record.pdf.pageCount),
    `${entry.paperId}: reviewed page exists`);
    const ledger = JSON.parse(await readFile(path.join(projectRoot, "research", "ledger", "papers", `${entry.paperId}.json`), "utf8"));
    assert.equal(entry.pagesSha256, ledger.stages.extraction.artifacts.pagesSha256, `${entry.paperId}: extraction artifact binding`);
    assert.equal(entry.selectedEngine, ledger.stages.extraction.selectedEngine, `${entry.paperId}: parser binding`);
  }
});
