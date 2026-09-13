import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractionQaStatus, reviewExtractions } from "../scripts/extraction-qa.mjs";
import { AUTHORING_VERSION } from "../scripts/model-note-authoring.mjs";
import {
  assertExtractionContract,
  acquireClaim,
  atomicWriteJson,
  extractionCorruptionProfile,
  preferFallbackExtraction,
  makeLedger,
  parseCli,
  selectExtractionCandidates,
  repairPromotionExtractionContractIssues,
  sha256,
  stableStringify,
  systematicFontMapCorruption,
  summarizeLedgers,
  validateStructuredSamplePopulation
} from "../scripts/corpus-pipeline.mjs";

test("a frozen Mini sample survives a corpus retirement only when the seeded top selection and PDF identities stay unchanged", () => {
  const seed = "0123456789abcdef0123456789abcdef";
  const records = Array.from({ length: 80 }, (_, index) => ({
    id: `paper-${String(index + 1).padStart(3, "0")}`,
    doi: `10.1000/${index + 1}`,
    pdf_file: `paper-${index + 1}.pdf`,
    pdf_sha256: sha256(`pdf-${index + 1}`),
    pdf_bytes: 1000 + index
  }));
  const ranked = records
    .map((record) => ({ record, draw: sha256(`${seed}\0${record.id}`) }))
    .sort((a, b) => a.draw.localeCompare(b.draw));
  const selected = ranked.slice(0, 5);
  const sample = {
    seed,
    count: 5,
    population: records.length,
    sourceSha256: sha256("old-source"),
    populationIds: records.map((record) => record.id),
    records: selected.map(({ record, draw }, index) => ({
      id: `P${String(index + 1).padStart(3, "0")}`,
      source_id: record.id,
      sample_rank: index + 1,
      draw,
      doi: record.doi,
      source_pdf_file: record.pdf_file,
      sha256: record.pdf_sha256,
      bytes: record.pdf_bytes
    }))
  };
  const selectedIds = new Set(selected.map(({ record }) => record.id));
  const removable = [...ranked].reverse().find(({ record }) => !selectedIds.has(record.id)).record;
  const current = records.filter((record) => record.id !== removable.id);
  const validation = validateStructuredSamplePopulation(sample, current, sha256("new-source"));

  assert.equal(validation.sourceDataSha256Matches, false);
  assert.equal(validation.currentPopulation, 79);
  assert.deepEqual(validation.removedPopulationIds, [removable.id]);
  assert.equal(validation.selectionRevalidated, true);

  const tampered = current.map((record) => record.id === selected[0].record.id
    ? { ...record, pdf_sha256: sha256("tampered") }
    : record);
  assert.throws(
    () => validateStructuredSamplePopulation(sample, tampered, sha256("new-source")),
    /source PDF hash changed/
  );
});

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = path.join(root, "scripts", "corpus-pipeline.mjs");
const manifestPath = path.join(root, "research", "corpus", "manifest.v1.json");
const papersLedgerDir = path.join(root, "research", "ledger", "papers");
const sourceBytes = await readFile(path.join(root, "data", "atlas_articles.json"));
const source = JSON.parse(sourceBytes.toString("utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const ledgerNames = (await readdir(papersLedgerDir)).filter((name) => name.endsWith(".json")).sort();
const ledgers = [];
for (const name of ledgerNames) {
  ledgers.push(JSON.parse(await readFile(path.join(papersLedgerDir, name), "utf8")));
}

const warningDois = [
  "10.1287/mksc.2019.1201",
  "10.1287/msom.2019.0815"
].sort();

test("CLI accepts positional and --select command semantics", () => {
  assert.equal(parseCli([]).command, "status");
  assert.equal(parseCli(["status", "--json"]).command, "status");
  const inventoryOptions = parseCli(["--select=inventory", "--check", "--jobs", "3"]);
  assert.equal(inventoryOptions.command, "inventory");
  assert.equal(inventoryOptions.check, true);
  assert.equal(inventoryOptions.jobs, 3);

  const extractOptions = parseCli([
    "--select", "extract",
    "--paper", "doi-10-1287-msom-2025-0182,10.1287/msom.2025.0182",
    "--from", "10.1287/msom.2025.0182",
    "--limit", "2",
    "--retry-failed",
    "--dry-run"
  ]);
  assert.equal(extractOptions.command, "extract");
  assert.deepEqual(extractOptions.papers, ["doi-10-1287-msom-2025-0182", "10.1287/msom.2025.0182"]);
  assert.equal(extractOptions.from, "10.1287/msom.2025.0182");
  assert.equal(extractOptions.limit, 2);
  assert.equal(extractOptions.retryFailed, true);
  assert.equal(extractOptions.dryRun, true);

  assert.throws(() => parseCli(["status", "--select", "inventory"]), /Conflicting pipeline selectors/);
  assert.throws(() => parseCli(["status", "--limit", "1"]), /extract-only/);
  assert.throws(() => parseCli(["status", "--check"]), /inventory-only/);
  assert.throws(() => parseCli(["extract", "--retry-failed", "--force"]), /mutually exclusive/);
  assert.throws(() => parseCli(["--select", "unknown"]), /Unknown selector/);
});

test("checked corpus manifest is complete, deterministic, and route-safe", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.source.dataSha256, sha256(sourceBytes));
  assert.equal(manifest.records.length, source.records.length);
  assert.equal(manifest.recordsDigest, sha256(stableStringify(manifest.records)));
  assert.equal(manifest.parser.command, undefined, "manifest must not pin a machine-local Python path");
  assert.deepEqual(manifest.relevanceVocabulary, {
    applicability: ["modeled", "unclassified", "explicitlyExcluded", "backgroundOnly", "unknown"],
    evidenceLocation: [
      "concept",
      "scenario",
      "formulation",
      "condition",
      "symbol",
      "component explanation",
      "model setup",
      "decision-state",
      "method-result",
      "bibliography-abstract"
    ],
    maturity: ["component-mapped", "legacy deep map", "evidence-index"],
    policy: "Applicability and evidence location are scoped, query-derived evidence. Maturity is a legacy source-provenance axis, not a current note-availability or quality score."
  });
  assert.deepEqual(manifest.counts, {
    bytes: 3612048792,
    detailLevels: { literature: 1355, model_map: 298 },
    duplicatePdfHashes: 0,
    journals: { isr: 129, mksc: 114, mnsc: 770, msom: 640 },
    legacyRouteIds: 63,
    orphanPdfs: 0,
    pages: 35246,
    parseFailures: 0,
    parserWarningPdfs: 2,
    pdfFiles: 1653,
    records: 1653,
    structuredNoteSeeds: 30
  });

  const ids = manifest.records.map((record) => record.id);
  const dois = manifest.records.map((record) => record.canonicalDoi);
  const hashes = manifest.records.map((record) => record.pdf.sha256);
  assert.deepEqual(ids, [...ids].sort(), "records use ordinal route-ID order");
  assert.equal(new Set(ids).size, 1653);
  assert.equal(new Set(dois).size, 1653);
  assert.equal(new Set(hashes).size, 1653);
  assert.equal(manifest.records.filter((record) => record.aliases.length).length, 63);
  assert.equal(manifest.records.reduce((sum, record) => sum + record.pdf.pageCount, 0), 35246);

  for (const record of manifest.records) {
    const { recordDigest, ...digestInput } = record;
    assert.equal(recordDigest, sha256(stableStringify(digestInput)), `${record.id}: record digest`);
    assert.equal(record.doiUrl, `https://doi.org/${record.canonicalDoi}`);
    assert.equal(record.pdf.path, `paper/${record.pdf.file}`);
    assert.deepEqual(record.integrityIssues, [], `${record.id}: inventory integrity`);
  }
});

test("paper ledgers encode the completed restartable source-to-release pipeline", async () => {
  assert.equal(ledgerNames.length, 1653);
  assert.equal(ledgers.length, manifest.records.length);
  const recordsById = new Map(manifest.records.map((record) => [record.id, record]));
  const noteCounts = new Map();
  const detailNoteCounts = new Map();
  const stageCounts = new Map();

  for (const ledger of ledgers) {
    const record = recordsById.get(ledger.paperId);
    assert.ok(record, `${ledger.paperId}: ledger belongs to manifest`);
    assert.equal(ledger.corpusRevision, manifest.corpusRevision, `${ledger.paperId}: corpus revision`);
    assert.equal(ledger.manifestRecordDigest, record.recordDigest, `${ledger.paperId}: record digest`);
    assert.equal(ledger.pdfSha256, record.pdf.sha256, `${ledger.paperId}: PDF digest`);
    assert.equal(ledger.stages.inventory.status, "complete", `${ledger.paperId}: inventory complete`);
    assert.equal(ledger.stages.extraction.status, "complete", `${ledger.paperId}: extraction complete`);

    const noteStatus = ledger.stages.noteAuthoring.status;
    noteCounts.set(noteStatus, (noteCounts.get(noteStatus) || 0) + 1);
    const detailKey = `${record.sourceDetailLevel}:${noteStatus}`;
    detailNoteCounts.set(detailKey, (detailNoteCounts.get(detailKey) || 0) + 1);
    for (const [stageName, stage] of Object.entries(ledger.stages)) {
      const key = `${stageName}:${stage.status}`;
      stageCounts.set(key, (stageCounts.get(key) || 0) + 1);
    }
  }

  assert.deepEqual(Object.fromEntries([...noteCounts].sort()), {
    complete: 1653
  });
  assert.deepEqual(Object.fromEntries([...detailNoteCounts].sort()), {
    "literature:complete": 1355,
    "model_map:complete": 298
  });
  assert.equal(stageCounts.get("inventory:complete"), 1653);
  assert.equal(stageCounts.get("extraction:complete"), 1653);
  assert.equal(stageCounts.get("sourceAudit:complete"), 1653);
  assert.equal(stageCounts.get("releaseBuild:complete"), 1653);
  assert.equal(stageCounts.get("sourceReading:complete"), 1653);
  assert.equal(stageCounts.get("sectionIndex:complete"), 1653);
  assert.equal(stageCounts.get("quoteAudit:complete"), 1653);
  assert.equal(stageCounts.get("formulaAudit:complete"), 1653);
  assert.equal(stageCounts.get("schemaValidation:complete"), 1653);
  assert.equal(stageCounts.get("contentAudit:complete"), 1653);
  assert.equal(stageCounts.get("extractQa:needs_review"), 1547);
  assert.equal(stageCounts.get("extractQa:complete"), 106);

  const qaOptions = {
    command: "review",
    root,
    papers: [],
    from: "",
    limit: null,
    jobs: 8,
    dryRun: false,
    force: false,
    check: true,
    adjudication: "",
    reviewer: "",
    rationale: "",
    reviewedPages: [],
    findings: [],
    json: false,
    help: false
  };
  const [effectiveQa, checkedQa] = await Promise.all([
    extractionQaStatus({ ...qaOptions, command: "status" }),
    reviewExtractions(qaOptions)
  ]);
  assert.deepEqual(effectiveQa.checkpoints, { current: 1653 });
  assert.deepEqual(effectiveQa.qaStatuses, { complete: 1653 });
  assert.equal(effectiveQa.terminal, 1653);
  assert.equal(effectiveQa.releaseReady, 1653);
  assert.equal(checkedQa.ok, true);
  assert.deepEqual(checkedQa.failures, []);
  assert.deepEqual(checkedQa.statuses, { complete: 1651, needs_review: 2 });

  const observedWarnings = checkedQa.results
    .filter((result) => result.status === "needs_review")
    .map((result) => recordsById.get(result.id)?.canonicalDoi)
    .sort();
  assert.deepEqual(observedWarnings, warningDois, "only the two retained adjudicated parser warnings require authoritative manual acceptance");
});

test("extraction selection is resumable, filtered, forced only explicitly, and ordered", () => {
  const fixtureManifest = {
    records: [
      {
        id: "a-pending",
        canonicalDoi: "10.1000/pending",
        doiUrl: "https://doi.org/10.1000/pending",
        aliases: []
      },
      {
        id: "b-blocked",
        canonicalDoi: "10.1000/blocked",
        doiUrl: "https://doi.org/10.1000/blocked",
        aliases: []
      },
      {
        id: "m-failed",
        canonicalDoi: "10.1000/failed",
        doiUrl: "https://doi.org/10.1000/failed",
        aliases: []
      },
      {
        id: "z-legacy-route",
        canonicalDoi: "10.1000/legacy",
        doiUrl: "https://doi.org/10.1000/legacy",
        aliases: ["doi-10-1000-legacy"]
      }
    ]
  };
  const fixtureLedgers = [
    ["z-legacy-route", "complete", "complete"],
    ["a-pending", "complete", "pending"],
    ["m-failed", "complete", "failed"],
    ["b-blocked", "needs_review", "pending"]
  ].map(([paperId, inventoryStatus, extractionStatus]) => ({
    paperId,
    stages: {
      inventory: { status: inventoryStatus },
      extraction: { status: extractionStatus }
    }
  }));

  assert.deepEqual(
    selectExtractionCandidates(fixtureManifest, fixtureLedgers).map(({ record }) => record.id),
    ["a-pending", "m-failed"]
  );
  assert.deepEqual(
    selectExtractionCandidates(fixtureManifest, fixtureLedgers, { limit: 1 }).map(({ record }) => record.id),
    ["a-pending"]
  );
  assert.deepEqual(
    selectExtractionCandidates(fixtureManifest, fixtureLedgers, { retryFailed: true }).map(({ record }) => record.id),
    ["m-failed"]
  );
  assert.deepEqual(
    selectExtractionCandidates(fixtureManifest, fixtureLedgers, { from: "10.1000/failed" }).map(({ record }) => record.id),
    ["m-failed"]
  );
  assert.deepEqual(
    selectExtractionCandidates(fixtureManifest, fixtureLedgers, {
      papers: ["https://doi.org/10.1000/legacy"],
      force: true
    }).map(({ record }) => record.id),
    ["z-legacy-route"]
  );
  assert.deepEqual(
    selectExtractionCandidates(fixtureManifest, fixtureLedgers, {
      papers: ["doi-10-1000-legacy"]
    }),
    [],
    "a completed extraction remains skipped without --force"
  );
  assert.throws(
    () => selectExtractionCandidates(fixtureManifest, fixtureLedgers, { papers: ["10.1000/missing"] }),
    /Unknown paper selector/
  );
});

test("systematic font-map corruption triggers the alternate PDF parser without flagging ordinary prose", () => {
  const corrupted = `we study policy optimization for the featureMbased newsvendorL which see®s an endMtoMend policy that renders explicit decisionsN ${"pOrNscOoNscOpNscOoNscOsNscOiNscOtNscOiNscOoNscOnNsc ".repeat(3)} ${"policiesN featuresN decisionsN robustN modelN ".repeat(30)}`;
  const ordinary = "The seller chooses an order quantity before uncertain demand arrives. ".repeat(40);
  const sparseFalsePositive = `${"DiMasi develops a featureMbased model. ".repeat(10)} Two see®s symbols occur in extracted math. policiesN featuresN decisionsN robustN modelN modelN modelN`;
  assert.equal(systematicFontMapCorruption(corrupted), true);
  assert.equal(systematicFontMapCorruption(ordinary), false);
  assert.equal(systematicFontMapCorruption(sparseFalsePositive), false);
});

test("raw glyph names, replacement floods, fused prose, and letter-spaced runs trigger the alternate parser", () => {
  const padding = "The seller chooses a quantity before demand arrives. ".repeat(30);
  const rawGlyphs = `${padding} The /uniFB01rm observes /equals and acts.`;
  const replacements = `${padding} ${"�".repeat(20)}`;
  const fused = `${padding} ${"themodeldescriptionwasfusedwithoutspaces ".repeat(20)}`;
  const letterSpaced = `${padding} ${"m o d e l s are selected. ".repeat(10)}`;
  const sparseMathLoss = `${padding} A single � marks an unsupported display glyph.`;

  for (const corrupted of [rawGlyphs, replacements, fused, letterSpaced]) {
    assert.equal(systematicFontMapCorruption(corrupted), true);
  }
  assert.equal(systematicFontMapCorruption(sparseMathLoss), false);
  assert.ok(extractionCorruptionProfile(rawGlyphs).rawGlyphNames >= 1);
  assert.equal(extractionCorruptionProfile(replacements).replacementCharacters, 20);
});

test("alternate parser selection improves hard corruption and treats letter spacing as comparative evidence", () => {
  const profile = (overrides = {}) => ({
    textLength: 10000,
    embeddedM: 0,
    brokenK: 0,
    encodedHeadings: 0,
    terminalN: 0,
    rawGlyphNames: 0,
    replacementCharacters: 0,
    veryLongLowercaseTokens: 0,
    letterSpacedRuns: 0,
    legacyFontMap: false,
    ...overrides
  });
  assert.equal(preferFallbackExtraction(
    profile({ rawGlyphNames: 14 }),
    profile({ letterSpacedRuns: 22 })
  ), true, "eliminating raw PDF glyph names outweighs benign layout spacing");
  assert.equal(preferFallbackExtraction(
    profile({ letterSpacedRuns: 20 }),
    profile({ letterSpacedRuns: 25 })
  ), false, "a layout-only fallback must be cleaner before it replaces primary text");
  assert.equal(preferFallbackExtraction(
    profile({ veryLongLowercaseTokens: 20 }),
    profile({ veryLongLowercaseTokens: 9, letterSpacedRuns: 30 })
  ), true, "materially fewer fused prose tokens should select the alternate parser");
});

test("a parser upgrade preserves frozen Mini notes and their source-reading checkpoints", () => {
  const record = {
    id: "mini-fixture",
    canonicalDoi: "10.1000/mini",
    corpusRevision: "revision-next",
    recordDigest: "record-digest",
    sourceRecordDigest: "source-record-digest",
    sourceDetailLevel: "literature",
    integrityIssues: [],
    pdf: {
      sha256: "pdf-digest",
      pageCount: 1,
      parse: { status: "ok", warningCount: 0, warningCodes: [] }
    }
  };
  const miniInputDigest = sha256(`${record.pdf.sha256}\0mini-note-digest\0mini-pages-digest`);
  const completeStage = { status: "complete", sourcePdfSha256: "pdf-digest", noteSha256: "mini-note-digest" };
  const existing = {
    paperId: record.id,
    pdfSha256: record.pdf.sha256,
    manifestRecordDigest: record.recordDigest,
    corpusRevision: "revision-next",
    pipelineInputs: { conceptRegistrySha256: "concepts" },
    stages: {
      extraction: { status: "complete", inputDigest: "old-parser-input", artifacts: { pagesSha256: "old-pages" } },
      extractQa: { status: "complete", inputDigest: "old-parser-input" },
      noteAuthoring: {
        ...completeStage,
        source: "mini-atlas-schema-v2",
        inputDigest: miniInputDigest,
        noteSha256: "mini-note-digest",
        miniPaperId: "mini-source",
        notePath: "mini-atlas/data/notes/batch-mini.json",
        pagesPath: "mini-atlas/research/pages/mini-source.json",
        pagesSha256: "mini-pages-digest"
      },
      sectionIndex: { ...completeStage, inputDigest: "mini-section-index", pagesArtifact: "mini-atlas/research/pages/mini-source.json", pagesSha256: "mini-pages-digest" },
      sourceReading: { ...completeStage, inputDigest: "mini-source-reading", pagesArtifact: "mini-atlas/research/pages/mini-source.json", pagesSha256: "mini-pages-digest" },
      quoteAudit: completeStage,
      formulaAudit: completeStage,
      schemaValidation: completeStage,
      contentAudit: completeStage,
      sourceAudit: completeStage,
      releaseBuild: completeStage
    }
  };
  const seed = {
    samplePdfSha256: record.pdf.sha256,
    noteSha256: "mini-note-digest",
    miniPaperId: "mini-source",
    notePath: "mini-atlas/data/notes/batch-mini.json",
    pagesPath: "mini-atlas/research/pages/mini-source.json",
    pagesSha256: "mini-pages-digest"
  };
  const next = makeLedger(record, {
    corpusRevision: "revision-next",
    parser: { version: "new-parser-version" }
  }, seed, "legacy", existing, "concepts");

  assert.equal(next.stages.extraction.status, "invalidated");
  assert.equal(next.stages.noteAuthoring.status, "complete");
  assert.equal(next.stages.sectionIndex.status, "complete");
  assert.equal(next.stages.sourceReading.status, "complete");
});

test("adding a frozen Mini page hash preserves the note but refreshes source-reading checkpoints", () => {
  const record = {
    id: "mini-binding-upgrade",
    canonicalDoi: "10.1000/mini-binding-upgrade",
    recordDigest: "record-digest",
    sourceRecordDigest: "source-record-digest",
    sourceDetailLevel: "literature",
    integrityIssues: [],
    pdf: {
      sha256: "pdf-digest",
      pageCount: 1,
      parse: { status: "ok", warningCount: 0, warningCodes: [] }
    }
  };
  const completeStage = { status: "complete", sourcePdfSha256: "pdf-digest", noteSha256: "mini-note-digest" };
  const existing = {
    paperId: record.id,
    pdfSha256: record.pdf.sha256,
    manifestRecordDigest: record.recordDigest,
    corpusRevision: "revision",
    pipelineInputs: { conceptRegistrySha256: "concepts" },
    stages: {
      extraction: { status: "complete", inputDigest: "parser-input", artifacts: { pagesSha256: "extracted-pages" } },
      extractQa: { status: "complete", inputDigest: "parser-input" },
      noteAuthoring: {
        ...completeStage,
        source: "mini-atlas-schema-v2",
        inputDigest: sha256(`${record.pdf.sha256}\0mini-note-digest`),
        miniPaperId: "mini-source",
        notePath: "mini-atlas/data/notes/batch-mini.json",
        noteSha256: "mini-note-digest"
      },
      sectionIndex: { ...completeStage, inputDigest: "old-section-index" },
      sourceReading: { ...completeStage, inputDigest: "old-source-reading" },
      quoteAudit: completeStage,
      formulaAudit: completeStage,
      schemaValidation: completeStage,
      contentAudit: completeStage,
      sourceAudit: completeStage,
      releaseBuild: completeStage
    }
  };
  const seed = {
    samplePdfSha256: record.pdf.sha256,
    noteSha256: "mini-note-digest",
    miniPaperId: "mini-source",
    notePath: "mini-atlas/data/notes/batch-mini.json",
    pagesPath: "mini-atlas/research/pages/mini-source.json",
    pagesSha256: "mini-pages-digest"
  };
  const next = makeLedger(record, {
    corpusRevision: "revision",
    parser: { version: "parser-version" }
  }, seed, "legacy", existing, "concepts");

  assert.equal(next.stages.noteAuthoring.status, "complete");
  assert.equal(next.stages.noteAuthoring.pagesPath, seed.pagesPath);
  assert.equal(next.stages.noteAuthoring.pagesSha256, seed.pagesSha256);
  assert.equal(next.stages.sectionIndex.status, "invalidated");
  assert.equal(next.stages.sectionIndex.invalidatedReason, "mini_pages_binding_added");
  assert.equal(next.stages.sourceReading.status, "invalidated");
  assert.equal(next.stages.sourceReading.invalidatedReason, "mini_pages_binding_added");
});

test("Mini source path and identity drift reconcile the note seed and invalidate every dependent stage", () => {
  const record = {
    id: "mini-binding-drift",
    canonicalDoi: "10.1000/mini-binding-drift",
    recordDigest: "record-digest",
    sourceRecordDigest: "source-record-digest",
    sourceDetailLevel: "literature",
    integrityIssues: [],
    pdf: {
      sha256: "pdf-digest",
      pageCount: 1,
      parse: { status: "ok", warningCount: 0, warningCodes: [] }
    }
  };
  const manifestFixture = { corpusRevision: "revision", parser: { version: "parser-version" } };
  const seed = {
    samplePdfSha256: record.pdf.sha256,
    noteSha256: "mini-note-digest",
    miniPaperId: "mini-source",
    notePath: "mini-atlas/data/notes/batch-mini.json",
    pagesPath: "mini-atlas/research/pages/mini-source.json",
    pagesSha256: "mini-pages-digest"
  };
  const initial = makeLedger(record, manifestFixture, seed, "legacy", null, "concepts");
  const completeStage = { status: "complete", sourcePdfSha256: record.pdf.sha256, noteSha256: seed.noteSha256 };
  const existing = structuredClone(initial);
  existing.stages.extraction = {
    ...initial.stages.extraction,
    status: "complete",
    artifacts: { pagesSha256: "extracted-pages" }
  };
  existing.stages.extractQa = { ...initial.stages.extractQa, status: "complete" };
  existing.stages.sectionIndex = { ...completeStage, inputDigest: "mini-section-index" };
  existing.stages.sourceReading = { ...completeStage, inputDigest: "mini-source-reading" };
  for (const stageName of ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"]) {
    existing.stages[stageName] = { ...completeStage };
  }

  for (const [field, replacement] of [
    ["notePath", "mini-atlas/data/notes/batch-moved.json"],
    ["pagesPath", "mini-atlas/research/pages/mini-source-moved.json"],
    ["miniPaperId", "mini-source-moved"]
  ]) {
    const changedSeed = { ...seed, [field]: replacement };
    const next = makeLedger(record, manifestFixture, changedSeed, "legacy", existing, "concepts");
    assert.equal(next.stages.noteAuthoring.status, "complete", field);
    assert.equal(next.stages.noteAuthoring[field], replacement, field);
    assert.deepEqual(next.stages.noteAuthoring, {
      status: "complete",
      source: "mini-atlas-schema-v2",
      sourcePdfSha256: record.pdf.sha256,
      inputDigest: sha256(`${record.pdf.sha256}\0${changedSeed.noteSha256}\0${changedSeed.pagesSha256}`),
      miniPaperId: changedSeed.miniPaperId,
      notePath: changedSeed.notePath,
      noteSha256: changedSeed.noteSha256,
      pagesPath: changedSeed.pagesPath,
      pagesSha256: changedSeed.pagesSha256
    }, `${field}: the completed Mini note stage is replaced by the canonical seed`);
    for (const stageName of ["sectionIndex", "sourceReading"]) {
      assert.equal(next.stages[stageName].status, "invalidated", `${field}/${stageName}`);
      assert.equal(next.stages[stageName].invalidatedReason, "mini_source_binding_changed", `${field}/${stageName}`);
    }
    for (const stageName of ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"]) {
      assert.equal(next.stages[stageName].status, "invalidated", `${field}/${stageName}`);
    }
  }
});

test("removing a current Mini seed invalidates the frozen note and every dependent stage", () => {
  const record = {
    id: "mini-missing-seed",
    canonicalDoi: "10.1000/mini-missing-seed",
    recordDigest: "record-digest",
    sourceRecordDigest: "source-record-digest",
    sourceDetailLevel: "literature",
    integrityIssues: [],
    pdf: {
      sha256: "pdf-digest",
      pageCount: 1,
      parse: { status: "ok", warningCount: 0, warningCodes: [] }
    }
  };
  const manifestFixture = { corpusRevision: "revision", parser: { version: "parser-version" } };
  const seed = {
    samplePdfSha256: record.pdf.sha256,
    noteSha256: "mini-note-digest",
    miniPaperId: "mini-source",
    notePath: "mini-atlas/data/notes/batch-mini.json",
    pagesPath: "mini-atlas/research/pages/mini-source.json",
    pagesSha256: "mini-pages-digest"
  };
  const initial = makeLedger(record, manifestFixture, seed, "legacy", null, "concepts");
  const completeStage = { status: "complete", sourcePdfSha256: record.pdf.sha256, noteSha256: seed.noteSha256 };
  const existing = structuredClone(initial);
  existing.stages.extraction = {
    ...initial.stages.extraction,
    status: "complete",
    artifacts: { pagesSha256: "extracted-pages" }
  };
  existing.stages.extractQa = { ...initial.stages.extractQa, status: "complete" };
  existing.stages.sectionIndex = { ...completeStage, inputDigest: "mini-section-index" };
  existing.stages.sourceReading = { ...completeStage, inputDigest: "mini-source-reading" };
  for (const stageName of ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit"]) {
    existing.stages[stageName] = { ...completeStage };
  }
  existing.stages.sourceAudit = { ...completeStage, extractionQaStatus: "complete" };
  existing.stages.releaseBuild = { ...completeStage };

  const next = makeLedger(record, manifestFixture, undefined, "legacy", existing, "concepts");

  for (const stageName of [
    "noteAuthoring",
    "sectionIndex",
    "sourceReading",
    "quoteAudit",
    "formulaAudit",
    "schemaValidation",
    "contentAudit",
    "sourceAudit",
    "releaseBuild"
  ]) {
    assert.equal(next.stages[stageName].status, "invalidated", stageName);
  }
  assert.equal(next.stages.noteAuthoring.invalidatedReason, "mini_source_mapping_missing");
  assert.equal(next.stages.sectionIndex.invalidatedReason, "mini_source_mapping_missing");
  assert.equal(next.stages.sourceReading.invalidatedReason, "mini_source_mapping_missing");
});

test("malformed extraction claims expire by file age without stealing a fresh partial claim", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-partial-claim-"));
  const paperId = "partial-claim-fixture";
  const claimPath = path.join(temporaryRoot, "research", "ledger", ".claims", `${paperId}.extract.json`);
  try {
    await mkdir(path.dirname(claimPath), { recursive: true });
    await writeFile(claimPath, "{\"schemaVersion\":", "utf8");

    assert.equal(
      await acquireClaim(temporaryRoot, paperId, "base-ledger-digest", 60),
      null,
      "a fresh partial write must still belong to its original worker"
    );

    const expired = new Date(Date.now() - 2 * 60 * 60_000);
    await utimes(claimPath, expired, expired);
    const recovered = await acquireClaim(temporaryRoot, paperId, "base-ledger-digest", 60);
    assert.ok(recovered, "an old malformed claim should be recoverable");
    assert.equal(recovered.path, claimPath);
    const payload = JSON.parse(await readFile(claimPath, "utf8"));
    assert.equal(payload.paperId, paperId);
    assert.equal(payload.baseLedgerSha256, "base-ledger-digest");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("unchanged inventory preserves a current non-Mini curated authoring version", () => {
  const record = {
    id: "curated-fixture",
    canonicalDoi: "10.1000/curated",
    recordDigest: "record-digest",
    sourceRecordDigest: "source-record-digest",
    sourceDetailLevel: "literature",
    integrityIssues: [],
    pdf: {
      sha256: "pdf-digest",
      pageCount: 1,
      parse: { status: "ok", warningCount: 0, warningCodes: [] }
    }
  };
  const manifestFixture = { corpusRevision: "revision", parser: { version: "parser-version" } };
  const initial = makeLedger(record, manifestFixture, null, "legacy", null, "concepts");
  const completeStage = { status: "complete", sourcePdfSha256: record.pdf.sha256, noteSha256: "curated-note" };
  const existing = {
    ...initial,
    stages: {
      ...initial.stages,
      extraction: {
        ...initial.stages.extraction,
        status: "complete",
        artifacts: { pagesSha256: "pages" }
      },
      extractQa: { ...initial.stages.extractQa, status: "complete" },
      noteAuthoring: {
        ...completeStage,
        source: "editor-curated-full-source",
        authoringMode: "curated",
        authoringVersion: "curated-source-v1",
        conceptRegistrySha256: "concepts"
      },
      sectionIndex: { ...completeStage, inputDigest: "pages" },
      sourceReading: { ...completeStage, inputDigest: "pages" },
      quoteAudit: completeStage,
      formulaAudit: completeStage,
      schemaValidation: completeStage,
      contentAudit: completeStage,
      sourceAudit: { ...completeStage, extractionQaStatus: "complete" },
      releaseBuild: completeStage
    }
  };
  const next = makeLedger(record, manifestFixture, null, "legacy", existing, "concepts");

  assert.equal(next.stages.noteAuthoring.status, "complete");
  assert.equal(next.stages.noteAuthoring.authoringVersion, "curated-source-v1");
  assert.notEqual(next.stages.noteAuthoring.invalidatedReason, "authoring_version_changed");
  assert.equal(next.stages.sectionIndex.status, "complete");
  assert.equal(next.stages.sourceReading.status, "complete");
});

test("extraction fails fast when manifest policy or ledger input is stale", () => {
  const currentManifest = JSON.parse(JSON.stringify(manifest));
  assert.doesNotThrow(() => assertExtractionContract(currentManifest));

  const stalePolicy = JSON.parse(JSON.stringify(currentManifest));
  stalePolicy.parser.extractionPolicy.fallbackAcceptance.minimumCharactersPerPage += 1;
  assert.throws(() => assertExtractionContract(stalePolicy), /rerun inventory/);

  const record = currentManifest.records[0];
  const ledger = ledgers.find((item) => item.paperId === record.id);
  assert.ok(ledger);
  assert.throws(
    () => assertExtractionContract(currentManifest, [{ record, ledger: {
      ...ledger,
      stages: { ...ledger.stages, extraction: { ...ledger.stages.extraction, inputDigest: "stale" } }
    } }]),
    /rerun inventory/
  );
});

test("extraction contract accepts only a fully bound repair-promotion marker", () => {
  const record = manifest.records[0];
  const producerCodeSha256 = "e75fa05f767774d6fb3898c61812bcc7175ae6fe05999a1a64eb475e9b0e512c";
  const policySha256 = "6c4cc4cbb96b9c59e25838033562efe23cd974a56c3ca1b707d087e096720692";
  const repairInputDigest = "3".repeat(64);
  const adjudicationInputDigest = "4".repeat(64);
  const adjudicationRecordDigest = "5".repeat(64);
  const quiescenceTokenDigest = "6".repeat(64);
  const baseInputDigest = "7".repeat(64);
  const hash = "8".repeat(64);
  const promotionInput = {
    schemaVersion: 1,
    stage: "extractionRepairPromotionInput",
    producerVersion: "extraction-repair-promotion-v1",
    producerCodeSha256,
    policySha256,
    paperId: record.id,
    canonicalDoi: record.canonicalDoi,
    manifestRecordDigest: record.recordDigest,
    sourcePdf: {
      path: record.pdf.path,
      sha256: record.pdf.sha256,
      bytes: record.pdf.bytes,
      header: "%PDF-",
      pageCount: record.pdf.pageCount
    },
    baseLedger: {
      path: `research/ledger/papers/${record.id}.json`,
      sha256: hash
    },
    baseExtraction: {
      inputDigest: baseInputDigest,
      stageSha256: hash,
      pagesPath: `research/ledger/artifacts/${record.id}/${baseInputDigest}/pages.json`,
      pagesSha256: hash,
      textPath: `research/ledger/artifacts/${record.id}/${baseInputDigest}/text.txt`,
      textSha256: hash
    },
    acceptedAdjudication: {
      path: `research/ledger/extraction-repair-adjudications/${record.id}/${adjudicationInputDigest}/${adjudicationRecordDigest}.json`,
      sha256: hash,
      recordDigest: adjudicationRecordDigest,
      adjudicationInputDigest,
      repairInputDigest,
      disposition: "accepted"
    },
    candidate: {
      candidatePath: `research/ledger/extraction-repair-candidates/${record.id}/${repairInputDigest}/candidate.json`,
      candidateSha256: hash,
      pagesPath: `research/ledger/extraction-repair-candidates/${record.id}/${repairInputDigest}/pages.json`,
      pagesSha256: hash,
      textPath: `research/ledger/extraction-repair-candidates/${record.id}/${repairInputDigest}/text.txt`,
      textSha256: hash,
      provenancePath: `research/ledger/extraction-repair-candidates/${record.id}/${repairInputDigest}/glyph-provenance.json`,
      provenanceSha256: hash
    },
    quiescenceToken: {
      path: `research/ledger/extraction-repair-quiescence/${record.id}/${quiescenceTokenDigest}.json`,
      sha256: hash,
      tokenDigest: quiescenceTokenDigest,
      baseLedgerSha256: hash
    }
  };
  const promotionInputDigest = sha256(stableStringify(promotionInput));
  const prepareRecordDigest = "9".repeat(64);
  const extraction = {
    status: "complete",
    inputDigest: promotionInputDigest,
    sourcePdfSha256: record.pdf.sha256,
    attempts: 2,
    completedAt: "2026-09-12T12:00:00.000Z",
    pageCount: record.pdf.pageCount,
    totalCharacters: 100,
    emptyPages: [],
    pageErrors: [],
    parserWarningCodes: [],
    parserWarningCount: 0,
    selectedEngine: "extraction-repair-promotion",
    selectedEngineVersion: "extraction-repair-promotion-v1",
    fallbackAttempted: true,
    fallbackUsed: true,
    fallbackReason: "accepted-extraction-repair-promotion",
    selectedCorruptionProfile: { textLength: 100 },
    artifacts: {
      pages: `research/ledger/artifacts/${record.id}/${promotionInputDigest}/pages.json`,
      pagesSha256: hash,
      text: `research/ledger/artifacts/${record.id}/${promotionInputDigest}/text.txt`,
      textSha256: promotionInput.candidate.textSha256
    },
    repairPromotion: {
      schemaVersion: 1,
      stage: "extractionRepairPromotion",
      producerVersion: promotionInput.producerVersion,
      producerCodeSha256,
      policySha256,
      promotionInputDigest,
      promotionInput,
      prepare: {
        path: `research/ledger/extraction-repair-promotions/${record.id}/${promotionInputDigest}/prepare/${prepareRecordDigest}.json`,
        sha256: hash,
        recordDigest: prepareRecordDigest
      }
    }
  };
  assert.deepEqual(repairPromotionExtractionContractIssues(record, extraction), []);
  assert.doesNotThrow(() => assertExtractionContract(manifest, [{ record, ledger: { stages: { extraction } } }]));

  const tampered = structuredClone(extraction);
  tampered.repairPromotion.promotionInput.candidate.pagesPath = "research/ledger/attacker/pages.json";
  assert.ok(repairPromotionExtractionContractIssues(record, tampered).includes("promotion_candidate_path_invalid"));
  assert.throws(() => assertExtractionContract(manifest, [{ record, ledger: { stages: { extraction: tampered } } }]), /rerun inventory/);
});

test("atomic JSON writes replace complete files and leave no temporary siblings", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-corpus-pipeline-"));
  try {
    const target = path.join(temporaryRoot, "nested", "state.json");
    assert.equal(await atomicWriteJson(target, { revision: 1, values: ["a"] }), true);
    assert.equal(await atomicWriteJson(target, { revision: 2, values: ["a", "b"] }), true);
    assert.equal(await atomicWriteJson(target, { revision: 2, values: ["a", "b"] }), false);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { revision: 2, values: ["a", "b"] });
    assert.deepEqual((await readdir(path.dirname(target))).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("inventory --check detects drift without mutating saved pipeline state", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-corpus-check-"));
  try {
    const fixtureRecord = source.records.find((record) => record.id === "doi-10-1287-mnsc-2014-2148");
    assert.ok(fixtureRecord, "small checked PDF fixture exists in the corpus");
    const fixturePayload = {
      schema_version: source.schema_version,
      generated_on: source.generated_on,
      records: [fixtureRecord]
    };
    const fixtureDataPath = path.join(temporaryRoot, "data", "atlas_articles.json");
    await atomicWriteJson(fixtureDataPath, fixturePayload);
    await mkdir(path.join(temporaryRoot, "paper"), { recursive: true });
    await copyFile(
      path.join(root, "paper", fixtureRecord.pdf_file),
      path.join(temporaryRoot, "paper", fixtureRecord.pdf_file)
    );

    await execFileAsync(process.execPath, [
      scriptPath,
      "inventory",
      "--root", temporaryRoot,
      "--jobs", "1",
      "--json"
    ], { cwd: root, maxBuffer: 1024 * 1024 });

    const savedPaths = [
      path.join(temporaryRoot, "research", "corpus", "manifest.v1.json"),
      path.join(temporaryRoot, "research", "ledger", "summary.json"),
      path.join(temporaryRoot, "research", "ledger", "papers", `${fixtureRecord.id}.json`)
    ];
    const before = await Promise.all(savedPaths.map((filePath) => readFile(filePath)));
    const matching = await execFileAsync(process.execPath, [
      scriptPath,
      "inventory",
      "--check",
      "--root", temporaryRoot,
      "--jobs", "1",
      "--json"
    ], { cwd: root, maxBuffer: 1024 * 1024 });
    assert.equal(JSON.parse(matching.stdout).ok, true);

    const changedPayload = structuredClone(fixturePayload);
    changedPayload.records[0].title = `${changedPayload.records[0].title} (drift fixture)`;
    await atomicWriteJson(fixtureDataPath, changedPayload);
    let rejected;
    try {
      await execFileAsync(process.execPath, [
        scriptPath,
        "--select", "inventory",
        "--check",
        "--root", temporaryRoot,
        "--jobs", "1",
        "--json"
      ], { cwd: root, maxBuffer: 1024 * 1024 });
      assert.fail("a mismatched manifest must make --check exit nonzero");
    } catch (error) {
      rejected = error;
    }
    assert.equal(rejected.code, 1);
    const report = JSON.parse(rejected.stdout);
    assert.equal(report.checked, true);
    assert.equal(report.ok, false);
    assert.equal(report.manifestMatches, false);
    assert.deepEqual(report.diagnostics.manifestIssues, ["content_mismatch"]);
    const after = await Promise.all(savedPaths.map((filePath) => readFile(filePath)));
    assert.deepEqual(after, before, "check mode leaves manifest, summary, and paper ledger byte-identical");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("inventory preserves compatible completed work and invalidates every record-dependent stage on metadata drift", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-corpus-restart-"));
  try {
    const fixtureRecord = source.records.find((record) => record.id === "doi-10-1287-mnsc-2014-2148");
    assert.ok(fixtureRecord, "small checked PDF fixture exists in the corpus");
    const fixtureDataPath = path.join(temporaryRoot, "data", "atlas_articles.json");
    const fixturePayload = {
      schema_version: source.schema_version,
      generated_on: source.generated_on,
      records: [fixtureRecord]
    };
    await atomicWriteJson(fixtureDataPath, fixturePayload);
    const conceptPath = path.join(temporaryRoot, "data", "notes", "concepts.json");
    await atomicWriteJson(conceptPath, { conceptRegistrySha256: "registry-v1" });
    await mkdir(path.join(temporaryRoot, "paper"), { recursive: true });
    await copyFile(
      path.join(root, "paper", fixtureRecord.pdf_file),
      path.join(temporaryRoot, "paper", fixtureRecord.pdf_file)
    );

    const runInventory = async () => {
      await execFileAsync(process.execPath, [
        scriptPath,
        "inventory",
        "--root", temporaryRoot,
        "--jobs", "1",
        "--json"
      ], { cwd: root, maxBuffer: 1024 * 1024 });
    };
    const ledgerPath = path.join(temporaryRoot, "research", "ledger", "papers", `${fixtureRecord.id}.json`);
    await runInventory();

    let ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    assert.notEqual(ledger.stages.noteAuthoring.source, "mini-atlas-schema-v2", "fixture exercises non-Mini authoring");
    ledger.stages.extraction = {
      ...ledger.stages.extraction,
      status: "complete",
      artifacts: {
        pages: `research/ledger/artifacts/${fixtureRecord.id}/fixture/pages.json`,
        pagesSha256: sha256("restart-lifecycle-pages"),
        text: `research/ledger/artifacts/${fixtureRecord.id}/fixture/text.txt`,
        textSha256: sha256("restart-lifecycle-text")
      }
    };
    ledger.stages.extractQa = { ...ledger.stages.extractQa, status: "complete", reasons: [] };
    ledger.stages.noteAuthoring = {
      ...ledger.stages.noteAuthoring,
      status: "complete",
      notePath: `data/notes/papers/${fixtureRecord.id}.json`,
      noteSha256: sha256("restart-lifecycle-note"),
      authoringVersion: AUTHORING_VERSION,
      conceptRegistrySha256: "registry-v1",
      completedAt: "2026-01-01T00:00:00.000Z"
    };
    await atomicWriteJson(ledgerPath, ledger);

    // Let inventory derive the canonical dependent-stage seeds from the completed note.
    await runInventory();
    ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const dependentStages = [
      "noteAuthoring",
      "sectionIndex",
      "sourceReading",
      "quoteAudit",
      "formulaAudit",
      "schemaValidation",
      "contentAudit",
      "sourceAudit",
      "releaseBuild"
    ];
    const noteSha256 = ledger.stages.noteAuthoring.noteSha256;
    for (const stageName of dependentStages) {
      assert.ok(ledger.stages[stageName]?.inputDigest, `${stageName} has a restart compatibility digest`);
      ledger.stages[stageName] = {
        ...ledger.stages[stageName],
        status: "complete",
        ...(["sectionIndex", "sourceReading"].includes(stageName)
          ? { inputDigest: ledger.stages.extraction.artifacts.pagesSha256 }
          : {}),
        ...(stageName === "sourceReading"
          ? { pagesArtifact: ledger.stages.extraction.artifacts.pages }
          : {}),
        ...(["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"].includes(stageName)
          ? { noteSha256 }
          : {}),
        ...(stageName === "sourceAudit" ? { extractionQaStatus: ledger.stages.extractQa.status } : {}),
        completedAt: "2026-01-01T00:00:00.000Z",
        fixtureMarker: stageName
      };
    }
    await atomicWriteJson(ledgerPath, ledger);
    const completed = Object.fromEntries(dependentStages.map((stageName) => [stageName, ledger.stages[stageName]]));

    await runInventory();
    const unchanged = JSON.parse(await readFile(ledgerPath, "utf8"));
    for (const stageName of dependentStages) {
      assert.deepEqual(unchanged.stages[stageName], completed[stageName], `${stageName} survives an unchanged inventory rerun`);
    }

    const preContentAuditLedger = structuredClone(unchanged);
    delete preContentAuditLedger.stages.contentAudit;
    await atomicWriteJson(ledgerPath, preContentAuditLedger);
    await runInventory();
    const migrated = JSON.parse(await readFile(ledgerPath, "utf8"));
    assert.equal(migrated.stages.contentAudit.status, "pending", "a newly introduced audit stage is seeded without disturbing its valid siblings");
    for (const stageName of ["quoteAudit", "formulaAudit", "schemaValidation"]) {
      assert.deepEqual(migrated.stages[stageName], completed[stageName], `${stageName} remains complete during content-audit migration`);
    }
    assert.equal(migrated.stages.sourceAudit.status, "invalidated", "source audit cannot remain complete without content audit");
    assert.equal(migrated.stages.releaseBuild.status, "invalidated", "release build cannot remain complete without content audit");

    await atomicWriteJson(ledgerPath, unchanged);
    await atomicWriteJson(conceptPath, { conceptRegistrySha256: "registry-v2" });
    await runInventory();
    const registryChanged = JSON.parse(await readFile(ledgerPath, "utf8"));
    for (const stageName of dependentStages) {
      assert.equal(registryChanged.stages[stageName].status, "invalidated", `${stageName} is invalidated by concept-registry drift`);
    }
    assert.notEqual(registryChanged.stages.noteAuthoring.inputDigest, completed.noteAuthoring.inputDigest);

    await atomicWriteJson(conceptPath, { conceptRegistrySha256: "registry-v1" });
    await atomicWriteJson(ledgerPath, unchanged);

    const changedPayload = structuredClone(fixturePayload);
    changedPayload.records[0].title = `${changedPayload.records[0].title} (record metadata changed)`;
    await atomicWriteJson(fixtureDataPath, changedPayload);
    await runInventory();
    const changed = JSON.parse(await readFile(ledgerPath, "utf8"));
    for (const stageName of dependentStages) {
      assert.equal(changed.stages[stageName]?.status, "invalidated", `${stageName} is invalidated by record drift`);
      assert.ok(changed.stages[stageName]?.inputDigest, `${stageName} retains a resumable replacement digest`);
      assert.notEqual(
        changed.stages[stageName].inputDigest,
        completed[stageName].inputDigest,
        `${stageName} stores the new seed digest instead of stale completed input`
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("canonical summaries count missing content audit and separate structure from release readiness", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-corpus-readiness-"));
  try {
    const paperId = "fixture-readiness-paper";
    const recordDigest = "fixture-record-digest";
    const corpusRevision = "fixture-corpus-revision";
    const canonicalStages = [
      "inventory",
      "extraction",
      "extractQa",
      "sectionIndex",
      "sourceReading",
      "noteAuthoring",
      "quoteAudit",
      "formulaAudit",
      "schemaValidation",
      "sourceAudit",
      "releaseBuild"
    ];
    const ledger = {
      schemaVersion: 1,
      paperId,
      corpusRevision,
      manifestRecordDigest: recordDigest,
      pdfSha256: "fixture-pdf-sha",
      stages: Object.fromEntries(canonicalStages.map((stageName) => [stageName, {
        status: stageName === "extractQa" ? "needs_review" : "complete"
      }]))
    };
    const manifest = {
      schemaVersion: 1,
      corpusRevision,
      counts: { detailLevels: { literature: 1 }, parserWarningPdfs: 0 },
      records: [{ id: paperId, recordDigest }]
    };

    const summarized = summarizeLedgers(manifest, [ledger]);
    assert.deepEqual(summarized.stages.contentAudit, { missing: 1 });
    assert.equal(summarized.structurallyConsistent, true);
    assert.equal(summarized.releaseReady, false);
    assert.equal(summarized.ok, true, "legacy ok continues to describe ledger structure, not release readiness");

    const readyLedger = structuredClone(ledger);
    readyLedger.stages.contentAudit = { status: "complete" };
    const readySummary = summarizeLedgers(manifest, [readyLedger]);
    assert.equal(readySummary.releaseReady, true, "extract QA review warnings do not block an otherwise complete release");

    await atomicWriteJson(path.join(temporaryRoot, "research", "corpus", "manifest.v1.json"), manifest);
    await atomicWriteJson(path.join(temporaryRoot, "research", "ledger", "papers", `${paperId}.json`), ledger);
    const ordinary = await execFileAsync(process.execPath, [
      scriptPath,
      "status",
      "--root", temporaryRoot,
      "--json"
    ], { cwd: root });
    const ordinaryReport = JSON.parse(ordinary.stdout);
    assert.equal(ordinaryReport.structurallyConsistent, true);
    assert.equal(ordinaryReport.releaseReady, false);
    assert.equal(ordinaryReport.ok, true);
    const plain = await execFileAsync(process.execPath, [scriptPath, "status", "--root", temporaryRoot], { cwd: root });
    assert.match(plain.stdout, /ledger structure consistent; release not ready/i);

    const ledgerBeforeRefresh = await readFile(path.join(temporaryRoot, "research", "ledger", "papers", `${paperId}.json`));
    const refreshed = await execFileAsync(process.execPath, [
      scriptPath,
      "status",
      "--refresh-summary",
      "--root", temporaryRoot,
      "--json"
    ], { cwd: root });
    const refreshedReport = JSON.parse(refreshed.stdout);
    assert.equal(refreshedReport.summaryRefreshed, true);
    const savedSummary = JSON.parse(await readFile(path.join(temporaryRoot, "research", "ledger", "summary.json"), "utf8"));
    assert.deepEqual(savedSummary.stages.contentAudit, { missing: 1 });
    assert.equal(savedSummary.structurallyConsistent, true);
    assert.equal(savedSummary.releaseReady, false);
    assert.deepEqual(
      await readFile(path.join(temporaryRoot, "research", "ledger", "papers", `${paperId}.json`)),
      ledgerBeforeRefresh,
      "summary refresh does not rewrite authoritative paper ledgers"
    );

    await atomicWriteJson(path.join(temporaryRoot, "research", "ledger", "papers", `${paperId}.json`), readyLedger);
    await assert.rejects(
      execFileAsync(process.execPath, [
        scriptPath,
        "status",
        "--check-ready",
        "--root", temporaryRoot,
        "--json"
      ], { cwd: root }),
      (error) => {
        assert.equal(error.code, 1);
        const readyReport = JSON.parse(error.stdout);
        assert.equal(readyReport.structurallyConsistent, true);
        assert.equal(readyReport.releaseReady, false);
        assert.equal(readyReport.ok, true);
        assert.equal(readyReport.qaReadiness.ok, false);
        assert.equal(readyReport.qaReadiness.failures[0].reason, "review_decision_missing");
        return true;
      }
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("help documents every restart selector", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "--help"], { cwd: root });
  assert.equal(stderr, "");
  for (const token of ["status", "inventory", "extract", "--check", "--check-ready", "--refresh-summary", "--from", "--retry-failed", "--dry-run"]) {
    assert.match(stdout, new RegExp(token.replaceAll("-", "\\-")), token);
  }
});

test("status selector reports a consistent checked-in ledger", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "--select", "status", "--json"], {
    cwd: root,
    maxBuffer: 1024 * 1024
  });
  assert.equal(stderr, "");
  const reported = JSON.parse(stdout);
  assert.equal(reported.ok, true);
  assert.equal(reported.recordCount, 1653);
  assert.deepEqual(reported.diagnostics, {
    extraLedgers: [],
    missingLedgers: [],
    staleLedgers: []
  });
});
