import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ADDITIONAL_CONCEPTS,
  AUTHORING_SCHEMA_VERSION,
  AUTHORING_VERSION,
  authoringInputDigest,
  cleanText,
  curatedInputDigest,
  stableStringify
} from "../scripts/model-note-authoring.mjs";
import {
  formulaComparable,
  parseCli as parseAuthorCli,
  reconcileGeneratedQaEnvelope,
  run
} from "../scripts/author-model-notes.mjs";
import {
  assertMiniQaBoundAuthoring,
  formulaComparable as buildFormulaComparable,
  whitespaceOnly as buildWhitespaceOnly
} from "../scripts/build-model-notes.mjs";
import { checkProjectCheckpoints } from "../scripts/model-note-checkpoints.mjs";
import {
  EXTRACTION_POLICY,
  EXTRACTOR_CODE_SHA256,
  extractionCorruptionProfile,
  stableStringify as stableLedgerStringify
} from "../scripts/corpus-pipeline.mjs";
import {
  extractionQaBoundDigest,
  extractionQaCheckpointBinding,
  reviewExtractions,
  verifyExtractionQaCheckpoint
} from "../scripts/extraction-qa.mjs";
import { modelNoteExtractionQaCheckpointBinding } from "../scripts/model-note-extraction-qa.mjs";

const PAPER_ID = "curated-parser-upgrade-fixture";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const PDF_BYTES = Buffer.from("%PDF-curated parser upgrade fixture\n", "utf8");
const PDF_SHA256 = sha256(PDF_BYTES);
const OLD_PAGES_SHA256 = "pre-upgrade-pages-sha256";
const MODEL_QUOTE = "We model a platform and arriving customers in an inventory control problem with a fixed stock and uncertain customer demand.";
const COMPONENT_QUOTE = "The platform selects a feasible inventory allocation before uncertain customer demand is observed.";
const PAGE_TEXT = `Curated Parser Upgrade Fixture\n1. Model\n${MODEL_QUOTE}\n${COMPONENT_QUOTE}\nWe assume that the inventory allocation cannot exceed the fixed stock. The platform maximizes expected reward by solving the allocation problem.\n${"Readable source prose preserves the model identity and decision evidence. ".repeat(18)}`;
const PAGES = [{ page: 1, text: PAGE_TEXT }];
const CORRUPTION_PROFILE = extractionCorruptionProfile(PAGES);
const PAGES_PAYLOAD = {
  schemaVersion: 1,
  paperId: PAPER_ID,
  canonicalDoi: "10.0000/curated-parser-upgrade-fixture",
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
    primaryCorruptionProfile: CORRUPTION_PROFILE,
    fallbackCorruptionProfile: null,
    selectedCorruptionProfile: CORRUPTION_PROFILE,
    extractionPolicy: EXTRACTION_POLICY
  },
  pages: PAGES
};
const CURRENT_PAGES_SHA256 = sha256(JSON.stringify(PAGES_PAYLOAD, null, 2) + "\n");

function additionalConceptRegistry() {
  const ids = new Set(ADDITIONAL_CONCEPTS.map((concept) => concept.id));
  return ADDITIONAL_CONCEPTS.map((concept) => ({
    id: concept.id,
    label: concept.label,
    aliases: [...new Set([concept.label, ...(concept.aliases || [])].map(cleanText).filter(Boolean))],
    related: [...new Set(concept.related || [])].filter((id) => ids.has(id) && id !== concept.id)
  })).sort((left, right) => left.label.localeCompare(right.label));
}

function curatedNote() {
  return {
    id: PAPER_ID,
    question: "How should the platform allocate fixed inventory under uncertain demand?",
    overview: "The platform uses an inventory policy to allocate a fixed stock while customer demand remains uncertain.",
    modelTypes: ["Optimization"],
    coverage: {
      pages: [1],
      note: "The curated model and its decision rule are anchored to the extracted source page."
    },
    models: [{
      id: "inventory-allocation",
      name: "Inventory allocation model",
      kind: "baseline",
      summary: "A platform allocates fixed inventory to uncertain customer demand.",
      objects: ["A platform and arriving customers"],
      inputs: ["Fixed inventory and uncertain demand"],
      decisions: ["A feasible inventory allocation"],
      assumptions: ["Allocated inventory cannot exceed the fixed stock"],
      method: "The paper formulates the allocation problem and derives a reward-maximizing inventory policy.",
      sources: [{
        page: 1,
        section: "Model",
        equation: "",
        quote: MODEL_QUOTE
      }],
      relationships: [],
      components: [{
        id: "inventory-policy",
        label: "Inventory policy",
        role: "decision",
        concepts: ["inventory-control"],
        explanation: "The policy selects a feasible inventory allocation to maximize expected reward.",
        searchPhrases: ["inventory allocation policy", "fixed stock decision", "expected reward"],
        formal: "Decision rule: Select the feasible allocation that maximizes expected reward.",
        formalKind: "Atlas restatement of source rule",
        symbols: [],
        conditions: ["The allocation cannot exceed available inventory."],
        sources: [{
          page: 1,
          section: "Model",
          equation: "",
          quote: COMPONENT_QUOTE
        }],
        conceptBindings: [{
          conceptId: "inventory-control",
          status: "modeled",
          representation: "The inventory-control concept is represented by the platform's feasible allocation policy.",
          conditionRefs: [0],
          sourceRefs: [{ scope: "component", index: 0 }],
          reviewStatus: "editorial",
          formalRef: "formal"
        }]
      }]
    }],
    provenance: {
      authoringVersion: "curated-source-v1",
      sourceTier: "full-source-curated-note",
      sourcePdfSha256: PDF_SHA256
    }
  };
}

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function createFixture(mutateEnvelope = () => {}, { parserWarning = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-curated-reconcile-"));
  const concepts = additionalConceptRegistry();
  const conceptRegistrySha256 = sha256(stableStringify(concepts));
  const record = {
    id: PAPER_ID,
    doi: "10.0000/curated-parser-upgrade-fixture",
    title: "Curated Parser Upgrade Fixture",
    detail_level: "literature",
    pdf_sha256: PDF_SHA256,
    abstract: `${MODEL_QUOTE} ${COMPONENT_QUOTE} We assume that the inventory allocation cannot exceed the fixed stock.`,
    model_topic: "Inventory allocation under uncertain customer demand",
    business_question: "How should the platform select a feasible inventory allocation before uncertain customer demand is observed?",
    modeling_evidence: "PDF p. 1 states the model and inventory-policy decision rule.",
    evidence_detail: ["PDF p. 1 states the model and inventory-policy decision rule."]
  };
  const extractionInputDigest = "post-upgrade-extraction";
  const manifestRecord = {
    id: PAPER_ID,
    canonicalDoi: record.doi,
    doiUrl: `https://doi.org/${record.doi}`,
    aliases: [],
    title: record.title,
    recordDigest: "fixture-manifest-record-digest",
    pdf: {
      path: `paper/${PAPER_ID}.pdf`,
      sha256: PDF_SHA256,
      bytes: PDF_BYTES.length,
      pageCount: 1
    }
  };
  const manifest = {
    schemaVersion: 1,
    corpusRevision: "fixture-corpus-revision",
    parser: { extractionCodeSha256: EXTRACTOR_CODE_SHA256 },
    records: [manifestRecord]
  };
  const pagesRelative = path.posix.join(
    "research",
    "ledger",
    "artifacts",
    PAPER_ID,
    extractionInputDigest,
    "pages.json"
  );
  const textRelative = path.posix.join(
    "research",
    "ledger",
    "artifacts",
    PAPER_ID,
    extractionInputDigest,
    "text.txt"
  );
  const plainText = `===== PDF PAGE 1 =====\n${PAGE_TEXT}\n`;
  const envelope = {
    schemaVersion: AUTHORING_SCHEMA_VERSION,
    authoringVersion: "curated-source-v1",
    authoringMode: "curated",
    paperId: PAPER_ID,
    sourcePdfSha256: PDF_SHA256,
    extractionPagesSha256: OLD_PAGES_SHA256,
    conceptRegistrySha256,
    inputDigest: "",
    note: curatedNote()
  };
  mutateEnvelope(envelope);
  envelope.inputDigest = curatedInputDigest(envelope, conceptRegistrySha256);
  const noteRelative = path.posix.join("data", "notes", "papers", PAPER_ID + ".json");
  const oldPacketRelative = path.posix.join(
    "research",
    "ledger",
    "artifacts",
    PAPER_ID,
    envelope.inputDigest,
    "reading-packet.json"
  );
  const oldNoteSha256 = sha256(JSON.stringify(envelope, null, 2) + "\n");
  const ledger = {
    schemaVersion: 1,
    paperId: PAPER_ID,
    canonicalDoi: record.doi,
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
        parserWarningCount: parserWarning ? 1 : 0,
        parserWarningCodes: parserWarning ? ["parser_warning"] : [],
        selectedEngine: "pypdf",
        selectedEngineVersion: "fixture-pypdf",
        fallbackAttempted: false,
        fallbackUsed: false,
        fallbackReason: "",
        primaryCorruptionProfile: CORRUPTION_PROFILE,
        fallbackCorruptionProfile: null,
        selectedCorruptionProfile: CORRUPTION_PROFILE,
        artifacts: {
          pages: pagesRelative,
          pagesSha256: CURRENT_PAGES_SHA256,
          text: textRelative,
          textSha256: sha256(plainText)
        }
      },
      extractQa: {
        status: parserWarning ? "needs_review" : "complete",
        inputDigest: extractionInputDigest,
        sourcePdfSha256: PDF_SHA256,
        reasons: parserWarning ? ["parser_warning"] : [],
        warningCodes: parserWarning ? ["parser_warning"] : [],
        pageErrors: [],
        emptyPages: [],
        totalCharacters: PAGE_TEXT.length,
        selectedEngine: "pypdf",
        selectedEngineVersion: "fixture-pypdf",
        fallbackAttempted: false,
        fallbackUsed: false,
        fallbackReason: "",
        primaryCorruptionProfile: CORRUPTION_PROFILE,
        fallbackCorruptionProfile: null,
        selectedCorruptionProfile: CORRUPTION_PROFILE
      },
      sectionIndex: {
        status: "complete",
        inputDigest: OLD_PAGES_SHA256,
        sourcePdfSha256: PDF_SHA256,
        readingPacket: oldPacketRelative,
        readingPacketSha256: "pre-upgrade-packet-sha256"
      },
      sourceReading: {
        status: "complete",
        inputDigest: OLD_PAGES_SHA256,
        sourcePdfSha256: PDF_SHA256,
        pagesArtifact: pagesRelative,
        readingPacket: oldPacketRelative,
        readingPacketSha256: "pre-upgrade-packet-sha256"
      },
      noteAuthoring: {
        status: "complete",
        inputDigest: envelope.inputDigest,
        sourcePdfSha256: PDF_SHA256,
        conceptRegistrySha256,
        source: "editor-curated-full-source",
        notePath: noteRelative,
        noteSha256: oldNoteSha256,
        authoringVersion: envelope.authoringVersion,
        authoringMode: envelope.authoringMode
      }
    }
  };
  for (const stage of ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"]) {
    ledger.stages[stage] = {
      status: "complete",
      inputDigest: "pre-upgrade-audit-digest",
      sourcePdfSha256: PDF_SHA256
    };
  }
  const notePath = path.join(root, "data", "notes", "papers", PAPER_ID + ".json");
  const ledgerPath = path.join(root, "research", "ledger", "papers", PAPER_ID + ".json");
  const pagesPath = path.join(root, pagesRelative);
  await Promise.all([
    mkdir(path.dirname(pagesPath), { recursive: true }),
    mkdir(path.join(root, "paper"), { recursive: true })
  ]);
  await Promise.all([
    writeJson(path.join(root, "data", "atlas_articles.json"), { records: [record] }),
    writeJson(path.join(root, "mini-atlas", "data", "atlas.json"), { concepts: [], papers: [] }),
    writeJson(path.join(root, "research", "corpus", "manifest.v1.json"), manifest),
    writeJson(pagesPath, PAGES_PAYLOAD),
    writeFile(path.join(root, ...textRelative.split("/")), plainText, "utf8"),
    writeFile(path.join(root, "paper", `${PAPER_ID}.pdf`), PDF_BYTES),
    writeJson(notePath, envelope),
    writeJson(ledgerPath, ledger)
  ]);
  await reviewExtractions({
    command: "review",
    root,
    papers: [PAPER_ID],
    from: "",
    limit: null,
    jobs: 1,
    dryRun: false,
    force: false,
    check: false,
    json: false,
    help: false
  });
  const qaCheckpoint = await verifyExtractionQaCheckpoint(root, manifest, manifestRecord, ledger, {
    requireComplete: !parserWarning
  });
  const qaBinding = modelNoteExtractionQaCheckpointBinding(qaCheckpoint, {
    allowNeedsReview: parserWarning
  });
  return {
    root,
    record,
    manifest,
    manifestRecord,
    conceptRegistrySha256,
    envelope,
    notePath,
    ledgerPath,
    pagesPath,
    qaCheckpoint,
    qaBinding
  };
}

function priorQaBinding(current) {
  const extractionQaInputDigest = sha256("fixture-prior-extraction-qa-input");
  return {
    ...current,
    extractionQaInputDigest,
    extractionQaDecisionPath: `research/ledger/extraction-qa/${PAPER_ID}/${extractionQaInputDigest}.json`,
    extractionQaDecisionSha256: sha256("fixture-prior-extraction-qa-decision")
  };
}

async function createGeneratedV20Fixture(mutateNote = () => {}) {
  const fixture = await createFixture();
  await rm(fixture.notePath);
  const generated = await run(options(fixture.root));
  assert.deepEqual(generated.counts, { created: 1 }, JSON.stringify(generated.results));

  const currentEnvelope = JSON.parse(await readFile(fixture.notePath, "utf8"));
  assert.equal(currentEnvelope.authoringVersion, AUTHORING_VERSION);
  assert.notEqual(currentEnvelope.authoringMode, "curated");
  const oldBinding = priorQaBinding(fixture.qaBinding);
  const priorEnvelope = structuredClone(currentEnvelope);
  Object.assign(priorEnvelope, oldBinding);
  Object.assign(priorEnvelope.note.provenance, oldBinding);
  mutateNote(priorEnvelope.note);
  const baseInputDigest = authoringInputDigest(
    fixture.record,
    CURRENT_PAGES_SHA256,
    fixture.conceptRegistrySha256
  );
  priorEnvelope.inputDigest = extractionQaBoundDigest("noteAuthoring", baseInputDigest, oldBinding);
  const priorText = `${JSON.stringify(priorEnvelope, null, 2)}\n`;

  const ledger = JSON.parse(await readFile(fixture.ledgerPath, "utf8"));
  Object.assign(ledger.stages.noteAuthoring, {
    status: "complete",
    inputDigest: priorEnvelope.inputDigest,
    sourcePdfSha256: PDF_SHA256,
    conceptRegistrySha256: fixture.conceptRegistrySha256,
    source: priorEnvelope.authoringMode === "metadata-enriched"
      ? "legacy-deep-map-plus-full-source"
      : "full-source-section-map",
    notePath: path.posix.join("data", "notes", "papers", `${PAPER_ID}.json`),
    noteSha256: sha256(priorText),
    authoringVersion: AUTHORING_VERSION,
    authoringMode: priorEnvelope.authoringMode,
    ...oldBinding
  });
  await Promise.all([
    writeFile(fixture.notePath, priorText, "utf8"),
    writeJson(fixture.ledgerPath, ledger)
  ]);
  return {
    ...fixture,
    currentEnvelope,
    priorEnvelope,
    priorText,
    oldBinding
  };
}

async function createMiniFixture({ parserWarning = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-mini-qa-reconcile-"));
  const paperId = "mini-qa-reconcile-fixture";
  const miniPaperId = "P999";
  const doi = "10.0000/mini-qa-reconcile-fixture";
  const pdfBytes = Buffer.from("%PDF-mini QA reconciliation fixture\n", "utf8");
  const pdfSha256 = sha256(pdfBytes);
  const pageText = `Mini QA Reconciliation Fixture\n${"Rendered source prose preserves headings, equations, symbols, paragraphs, and layout. ".repeat(18)}`;
  const pages = [{ page: 1, text: pageText }];
  const profile = extractionCorruptionProfile(pages);
  const extractionInputDigest = "mini-extraction-input";
  const artifactBase = path.posix.join("research", "ledger", "artifacts", paperId, extractionInputDigest);
  const pagesRelative = path.posix.join(artifactBase, "pages.json");
  const textRelative = path.posix.join(artifactBase, "text.txt");
  const manifestRecord = {
    id: paperId,
    canonicalDoi: doi,
    doiUrl: `https://doi.org/${doi}`,
    aliases: [],
    title: "Mini QA Reconciliation Fixture",
    recordDigest: "mini-fixture-record-digest",
    pdf: { path: `paper/${paperId}.pdf`, sha256: pdfSha256, bytes: pdfBytes.length, pageCount: 1 }
  };
  const manifest = {
    schemaVersion: 1,
    corpusRevision: "mini-fixture-corpus-revision",
    parser: { extractionCodeSha256: EXTRACTOR_CODE_SHA256 },
    records: [manifestRecord]
  };
  const record = {
    id: paperId,
    doi,
    title: manifestRecord.title,
    detail_level: "literature",
    pdf_sha256: pdfSha256
  };
  const miniNote = {
    id: miniPaperId,
    question: "How does the Mini fixture represent a source-bound decision?",
    overview: "The fixture preserves a frozen editorial note while its checkpoint is rebound to current Extraction QA.",
    modelTypes: ["Optimization"],
    coverage: { pages: [1], note: "The frozen page anchors the fixture." },
    models: []
  };
  const miniPaper = {
    ...miniNote,
    title: record.title,
    authors: ["Fixture Author"],
    year: 2026,
    journal: "Fixture Journal",
    doi,
    pdf: manifestRecord.pdf.path,
    pageCount: 1,
    sha256: pdfSha256,
    sourceId: paperId
  };
  const pagesPayload = {
    schemaVersion: 1,
    paperId,
    canonicalDoi: doi,
    pdfSha256,
    extractor: {
      name: "pypdf+pymupdf-fallback",
      version: "fixture",
      codeSha256: EXTRACTOR_CODE_SHA256,
      selectedEngine: "pypdf",
      selectedEngineVersion: "fixture-pypdf",
      fallbackAttempted: false,
      fallbackUsed: false,
      fallbackReason: "",
      primaryCorruptionProfile: profile,
      fallbackCorruptionProfile: null,
      selectedCorruptionProfile: profile,
      extractionPolicy: EXTRACTION_POLICY
    },
    pages
  };
  const pagesText = `${JSON.stringify(pagesPayload, null, 2)}\n`;
  const plainText = `===== PDF PAGE 1 =====\n${pageText}\n`;
  const frozenPages = { schemaVersion: 1, paperId: miniPaperId, pages };
  const frozenPagesText = `${JSON.stringify(frozenPages, null, 2)}\n`;
  const noteSha256 = sha256(stableStringify(miniNote));
  const frozenPagesSha256 = sha256(frozenPagesText);
  const notePath = "mini-atlas/data/notes/batch-test.json";
  const frozenPagesPath = `mini-atlas/research/pages/${miniPaperId}.json`;
  const warningCodes = parserWarning ? ["parser_warning"] : [];
  const ledger = {
    schemaVersion: 1,
    paperId,
    canonicalDoi: doi,
    corpusRevision: manifest.corpusRevision,
    manifestRecordDigest: manifestRecord.recordDigest,
    pdfSha256,
    stages: {
      extraction: {
        status: "complete",
        inputDigest: extractionInputDigest,
        sourcePdfSha256: pdfSha256,
        pageCount: 1,
        totalCharacters: pageText.length,
        emptyPages: [],
        pageErrors: [],
        parserWarningCount: parserWarning ? 1 : 0,
        parserWarningCodes: warningCodes,
        selectedEngine: "pypdf",
        selectedEngineVersion: "fixture-pypdf",
        fallbackAttempted: false,
        fallbackUsed: false,
        fallbackReason: "",
        primaryCorruptionProfile: profile,
        fallbackCorruptionProfile: null,
        selectedCorruptionProfile: profile,
        artifacts: {
          pages: pagesRelative,
          pagesSha256: sha256(pagesText),
          text: textRelative,
          textSha256: sha256(plainText)
        }
      },
      extractQa: {
        status: parserWarning ? "needs_review" : "complete",
        inputDigest: extractionInputDigest,
        sourcePdfSha256: pdfSha256,
        reasons: warningCodes,
        warningCodes,
        pageErrors: [],
        emptyPages: [],
        totalCharacters: pageText.length,
        selectedEngine: "pypdf",
        selectedEngineVersion: "fixture-pypdf",
        fallbackAttempted: false,
        fallbackUsed: false,
        fallbackReason: "",
        primaryCorruptionProfile: profile,
        fallbackCorruptionProfile: null,
        selectedCorruptionProfile: profile
      },
      noteAuthoring: {
        status: "complete",
        inputDigest: sha256(`${pdfSha256}\0${noteSha256}\0${frozenPagesSha256}`),
        miniPaperId,
        notePath,
        noteSha256,
        pagesPath: frozenPagesPath,
        pagesSha256: frozenPagesSha256,
        source: "mini-atlas-schema-v2",
        sourcePdfSha256: pdfSha256
      },
      sectionIndex: { status: "invalidated" },
      sourceReading: { status: "invalidated" },
      quoteAudit: { status: "complete" },
      formulaAudit: { status: "complete" },
      schemaValidation: { status: "complete" },
      contentAudit: { status: "complete" },
      sourceAudit: { status: "complete" },
      releaseBuild: { status: "complete" }
    }
  };
  const ledgerPath = path.join(root, "research", "ledger", "papers", `${paperId}.json`);
  await Promise.all([
    mkdir(path.join(root, ...artifactBase.split("/")), { recursive: true }),
    mkdir(path.join(root, "paper"), { recursive: true })
  ]);
  await Promise.all([
    writeJson(path.join(root, "data", "atlas_articles.json"), { records: [record] }),
    writeJson(path.join(root, "mini-atlas", "data", "atlas.json"), { concepts: [], papers: [miniPaper] }),
    writeJson(path.join(root, "research", "corpus", "manifest.v1.json"), manifest),
    writeJson(path.join(root, ...pagesRelative.split("/")), pagesPayload),
    writeFile(path.join(root, ...textRelative.split("/")), plainText, "utf8"),
    writeFile(path.join(root, "paper", `${paperId}.pdf`), pdfBytes),
    writeJson(path.join(root, ...notePath.split("/")), { papers: [miniNote] }),
    writeJson(path.join(root, ...frozenPagesPath.split("/")), frozenPages),
    writeJson(ledgerPath, ledger)
  ]);
  await reviewExtractions({
    command: "review", root, papers: [paperId], from: "", limit: null, jobs: 1,
    dryRun: false, force: false, check: false, json: false, help: false
  });
  const checkpoint = await verifyExtractionQaCheckpoint(root, manifest, manifestRecord, ledger, { requireComplete: !parserWarning });
  const qaBinding = checkpoint.ok && checkpoint.effectiveStatus === "complete"
    ? extractionQaCheckpointBinding(checkpoint)
    : null;
  return { root, record, miniPaper, manifest, manifestRecord, ledger, ledgerPath, qaBinding };
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
    json: true,
    ...overrides
  };
}

function miniOptions(data, overrides = {}) {
  return {
    root: data.root,
    limit: 0,
    from: "",
    paper: [data.record.id],
    jobs: 1,
    force: false,
    dryRun: false,
    check: false,
    reconcileMini: true,
    json: true,
    ...overrides
  };
}

async function addBlockedPaper(fixture, id, doi) {
  const catalogPath = path.join(fixture.root, "data", "atlas_articles.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog.records.push({
    id,
    doi,
    title: `Blocked fixture ${id}`,
    detail_level: "literature",
    pdf_sha256: `${id}-pdf-sha256`
  });
  await writeJson(catalogPath, catalog);
  await writeJson(path.join(fixture.root, "research", "ledger", "papers", `${id}.json`), {
    schemaVersion: 1,
    paperId: id,
    pdfSha256: `${id}-pdf-sha256`,
    stages: { extraction: { status: "pending" } }
  });
}

test("formula-source comparison treats canonical TeX and adjacent Unicode Greek as the same notation", () => {
  assert.equal(
    formulaComparable("δc ∈(0,1]."),
    formulaComparable("\\delta{}c ∈(0,1].")
  );
  assert.equal(
    formulaComparable("$λ_j$"),
    formulaComparable("\\lambda_j")
  );
  assert.equal(
    buildFormulaComparable("$λ_j$"),
    buildFormulaComparable("\\lambda_j")
  );
  assert.equal(
    buildFormulaComparable("δc ∈(0,1]."),
    formulaComparable("\\delta{}c ∈(0,1].")
  );
  assert.equal(
    buildWhitespaceOnly("Ａ\u0088Ｂ\n C"),
    "A=B C"
  );
});

test("Mini QA reconciliation is explicit, bounded, dry-run safe, and restartable", async () => {
  const fixture = await createMiniFixture();
  try {
    const parsed = parseAuthorCli([
      "--reconcile-mini", "--paper", fixture.record.doi, "--from", fixture.record.id,
      "--limit", "1", "--jobs", "2", "--dry-run"
    ]);
    assert.equal(parsed.reconcileMini, true);
    assert.deepEqual(parsed.paper, [fixture.record.doi]);
    assert.equal(parsed.from, fixture.record.id);
    assert.equal(parsed.limit, 1);
    assert.equal(parsed.jobs, 2);
    assert.equal(parsed.dryRun, true);
    assert.throws(
      () => assertMiniQaBoundAuthoring(fixture.ledger, fixture.qaBinding),
      /Mini noteAuthoring checkpoint is not bound to current Extraction QA/
    );
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");
    const dryRun = await run(miniOptions(fixture, {
      paper: [],
      from: fixture.record.doi,
      limit: 1,
      dryRun: true
    }));
    assert.equal(dryRun.mode, "reconcile-mini");
    assert.deepEqual(dryRun.counts, { "would-reconcile": 1 });
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);

    const reconciled = await run(miniOptions(fixture));
    assert.deepEqual(reconciled.counts, { reconciled: 1 });
    const ledgerText = await readFile(fixture.ledgerPath, "utf8");
    const ledger = JSON.parse(ledgerText);
    assert.equal(ledgerText, `${stableLedgerStringify(ledger, 2)}\n`, "Mini reconciliation writes a canonical paper ledger");
    assert.equal(assertMiniQaBoundAuthoring(ledger, fixture.qaBinding), true);
    assert.equal(ledger.stages.noteAuthoring.extractionQaDecisionSha256, fixture.qaBinding.extractionQaDecisionSha256);
    assert.equal(ledger.stages.sectionIndex.extractionQaInputDigest, fixture.qaBinding.extractionQaInputDigest);
    assert.equal(ledger.stages.sourceReading.extractionQaAdjudicationStatus, "not_required");
    for (const stage of ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"]) {
      assert.equal(ledger.stages[stage].status, "pending", `${stage} is invalidated by the new QA-bound authoring identity`);
    }
    const checkpointReport = await checkProjectCheckpoints({ root: fixture.root, papers: [fixture.record.id] });
    assert.equal(checkpointReport.ok, true, JSON.stringify(checkpointReport.stale));

    const checked = await run(miniOptions(fixture, { check: true }));
    assert.deepEqual(checked.counts, { current: 1 });
    const resumed = await run(miniOptions(fixture));
    assert.deepEqual(resumed.counts, { current: 1 });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a changed Mini editorial fixture requires explicit hash acceptance and retains an audit trail", async () => {
  const fixture = await createMiniFixture();
  try {
    assert.throws(
      () => parseAuthorCli(["--accept-mini-editorial-update"]),
      /requires --reconcile-mini/
    );
    const changedNote = {
      id: fixture.miniPaper.id,
      question: fixture.miniPaper.question,
      overview: `${fixture.miniPaper.overview} Mathematical subscripts are normalized explicitly.`,
      modelTypes: fixture.miniPaper.modelTypes,
      coverage: fixture.miniPaper.coverage,
      models: fixture.miniPaper.models
    };
    const changedPaper = { ...fixture.miniPaper, ...changedNote };
    const notePath = path.join(fixture.root, ...fixture.ledger.stages.noteAuthoring.notePath.split("/"));
    await Promise.all([
      writeJson(notePath, { papers: [changedNote] }),
      writeJson(path.join(fixture.root, "mini-atlas", "data", "atlas.json"), { concepts: [], papers: [changedPaper] })
    ]);
    const previousNoteSha256 = fixture.ledger.stages.noteAuthoring.noteSha256;
    const acceptedNoteSha256 = sha256(stableStringify(changedNote));
    assert.notEqual(acceptedNoteSha256, previousNoteSha256);

    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");
    const rejected = await run(miniOptions(fixture));
    assert.deepEqual(rejected.counts, { failed: 1 });
    assert.match(rejected.results[0].reason, /--accept-mini-editorial-update/);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);

    const dryRun = await run(miniOptions(fixture, {
      dryRun: true,
      acceptMiniEditorialUpdate: true
    }));
    assert.deepEqual(dryRun.counts, { "would-reconcile": 1 });
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);

    const accepted = await run(miniOptions(fixture, { acceptMiniEditorialUpdate: true }));
    assert.deepEqual(accepted.counts, { reconciled: 1 });
    assert.equal(accepted.results[0].editorialUpdateAccepted, true);
    const ledgerText = await readFile(fixture.ledgerPath, "utf8");
    const ledger = JSON.parse(ledgerText);
    assert.equal(ledgerText, `${stableLedgerStringify(ledger, 2)}\n`);
    assert.equal(ledger.stages.noteAuthoring.status, "complete");
    assert.equal(ledger.stages.noteAuthoring.noteSha256, acceptedNoteSha256);
    assert.deepEqual(ledger.stages.noteAuthoring.editorialUpdateHistory, [{
      schemaVersion: 1,
      type: "explicit-mini-editorial-update",
      previousNoteSha256,
      acceptedNoteSha256,
      miniPaperId: fixture.miniPaper.id,
      notePath: fixture.ledger.stages.noteAuthoring.notePath,
      acceptance: "--reconcile-mini --accept-mini-editorial-update"
    }]);
    assert.equal(assertMiniQaBoundAuthoring(ledger, fixture.qaBinding), true);
    const checkpointReport = await checkProjectCheckpoints({ root: fixture.root, papers: [fixture.record.id] });
    assert.equal(checkpointReport.ok, true, JSON.stringify(checkpointReport.stale));

    const resumed = await run(miniOptions(fixture));
    assert.deepEqual(resumed.counts, { current: 1 });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Mini reconciliation fails closed for stale QA and missing manual adjudication", async () => {
  const stale = await createMiniFixture();
  const manual = await createMiniFixture({ parserWarning: true });
  try {
    const decisionPath = path.join(stale.root, ...stale.qaBinding.extractionQaDecisionPath.split("/"));
    const decision = JSON.parse(await readFile(decisionPath, "utf8"));
    decision.observations.push("tampered_after_automated_review");
    await writeJson(decisionPath, decision);
    const staleResult = await run(miniOptions(stale, { check: true }));
    assert.deepEqual(staleResult.counts, { stale: 1 });
    assert.match(staleResult.results[0].reason, /review_decision_not_reproducible/);

    const manualResult = await run(miniOptions(manual, { check: true }));
    assert.deepEqual(manualResult.counts, { blocked: 1 });
    assert.match(manualResult.results[0].reason, /manual_review_incomplete/);
  } finally {
    await Promise.all([
      rm(stale.root, { recursive: true, force: true }),
      rm(manual.root, { recursive: true, force: true })
    ]);
  }
});

test("non-Mini needs_review authoring rejects a legacy curated envelope without a reviewed safe map", async () => {
  const fixture = await createFixture(undefined, { parserWarning: true });
  try {
    assert.equal(fixture.qaCheckpoint.ok, true);
    assert.equal(fixture.qaCheckpoint.state, "current");
    assert.equal(fixture.qaCheckpoint.effectiveStatus, "needs_review");
    assert.throws(
      () => extractionQaCheckpointBinding(fixture.qaCheckpoint),
      /not release-ready/
    );

    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");
    const preview = await run(options(fixture.root, { dryRun: true }));
    assert.deepEqual(preview.counts, { failed: 1 });
    assert.match(preview.results[0].reason, /reviewed prose-only safe map is missing/);
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);

    const authored = await run(options(fixture.root));
    assert.deepEqual(authored.counts, { failed: 1 });
    assert.match(authored.results[0].reason, /reviewed prose-only safe map is missing/);
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);

    const decisionPath = path.join(fixture.root, ...fixture.qaBinding.extractionQaDecisionPath.split("/"));
    const decision = JSON.parse(await readFile(decisionPath, "utf8"));
    decision.observations.push("tampered_after_terminal_candidate_binding");
    await writeJson(decisionPath, decision);
    const stale = await run(options(fixture.root, { check: true }));
    assert.deepEqual(stale.counts, { stale: 1 });
    assert.match(stale.results[0].reason, /review_decision_not_reproducible/);
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a curated note safely rebinds to parser-upgraded pages without changing editorial content", async () => {
  const fixture = await createFixture();
  try {
    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");
    const dryRun = await run(options(fixture.root, { dryRun: true }));

    assert.deepEqual(dryRun.counts, { "would-reconcile": 1 });
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore, "dry-run must not rewrite the curated envelope");
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore, "dry-run must not rewrite its checkpoint");

    const reconciled = await run(options(fixture.root));
    assert.deepEqual(reconciled.counts, { reconciled: 1 });

    const savedText = await readFile(fixture.notePath, "utf8");
    const saved = JSON.parse(savedText);
    const expectedNote = {
      ...fixture.envelope.note,
      provenance: { ...fixture.envelope.note.provenance, ...fixture.qaBinding }
    };
    assert.deepEqual(saved.note, expectedNote, "curated editorial content is unchanged while QA provenance is added");
    assert.equal(saved.sourcePdfSha256, PDF_SHA256);
    assert.equal(saved.extractionPagesSha256, CURRENT_PAGES_SHA256);
    assert.equal(saved.conceptRegistrySha256, fixture.conceptRegistrySha256);
    assert.equal(saved.inputDigest, extractionQaBoundDigest(
      "noteAuthoring",
      curatedInputDigest(saved, fixture.conceptRegistrySha256),
      fixture.qaBinding
    ));

    const ledgerText = await readFile(fixture.ledgerPath, "utf8");
    const ledger = JSON.parse(ledgerText);
    assert.equal(ledgerText, `${stableLedgerStringify(ledger, 2)}\n`, "curated reconciliation writes a canonical paper ledger");
    assert.equal(ledger.stages.noteAuthoring.noteSha256, sha256(savedText));
    assert.equal(ledger.stages.noteAuthoring.inputDigest, saved.inputDigest);
    assert.equal(ledger.stages.sourceReading.inputDigest, extractionQaBoundDigest("sourceReading", CURRENT_PAGES_SHA256, fixture.qaBinding));
    assert.equal(ledger.stages.noteAuthoring.extractionQaDecisionSha256, fixture.qaBinding.extractionQaDecisionSha256);
    for (const stage of ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"]) {
      assert.equal(ledger.stages[stage].status, "pending", stage + " must be rebound to the refreshed envelope hash");
    }
    const packetPath = path.join(fixture.root, ...ledger.stages.sourceReading.readingPacket.split("/"));
    const packetText = await readFile(packetPath, "utf8");
    const packet = JSON.parse(packetText);
    assert.equal(packet.authoringVersion, saved.authoringVersion, "the reading packet must retain the curated authoring identity");
    assert.equal(packet.extractionPagesSha256, CURRENT_PAGES_SHA256);
    assert.equal(packet.extractionQaDecisionSha256, fixture.qaBinding.extractionQaDecisionSha256);
    assert.equal(ledger.stages.sourceReading.readingPacketSha256, sha256(packetText));
    const checkpointReport = await checkProjectCheckpoints({ root: fixture.root, papers: [PAPER_ID] });
    assert.equal(checkpointReport.ok, true, JSON.stringify(checkpointReport.stale));

    const rerun = await run(options(fixture.root));
    assert.deepEqual(rerun.counts, { curated: 1 });
    assert.equal(await readFile(fixture.notePath, "utf8"), savedText, "a completed repair must be restart-safe");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("curated checkpoint repair resumes after the rebound envelope was committed", async () => {
  const fixture = await createFixture();
  try {
    const rebound = {
      ...fixture.envelope,
      extractionPagesSha256: CURRENT_PAGES_SHA256,
      conceptRegistrySha256: fixture.conceptRegistrySha256,
      ...fixture.qaBinding,
      note: {
        ...fixture.envelope.note,
        provenance: { ...fixture.envelope.note.provenance, ...fixture.qaBinding }
      }
    };
    rebound.inputDigest = extractionQaBoundDigest(
      "noteAuthoring",
      curatedInputDigest(rebound, fixture.conceptRegistrySha256),
      fixture.qaBinding
    );
    await writeJson(fixture.notePath, rebound);
    const noteAtRestart = await readFile(fixture.notePath, "utf8");

    const result = await run(options(fixture.root));

    assert.deepEqual(result.counts, { reconciled: 1 });
    assert.equal(await readFile(fixture.notePath, "utf8"), noteAtRestart, "checkpoint repair must reuse the already committed curated envelope");
    const checkpointReport = await checkProjectCheckpoints({ root: fixture.root, papers: [PAPER_ID] });
    assert.equal(checkpointReport.ok, true, JSON.stringify(checkpointReport.stale));
    const rerun = await run(options(fixture.root));
    assert.deepEqual(rerun.counts, { curated: 1 });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("authoring --check rejects a stale generated concept registry without rewriting artifacts", async () => {
  const fixture = await createFixture();
  try {
    const reconciled = await run(options(fixture.root));
    assert.deepEqual(reconciled.counts, { reconciled: 1 });

    const check = await run(options(fixture.root, { check: true }));
    assert.deepEqual(check.counts, { curated: 1 });

    const conceptPath = path.join(fixture.root, "data", "notes", "concepts.json");
    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");
    const staleConceptText = `${await readFile(conceptPath, "utf8")} `;
    await writeFile(conceptPath, staleConceptText, "utf8");

    await assert.rejects(
      run(options(fixture.root, { check: true })),
      /Generated concept registry is stale/
    );
    assert.equal(await readFile(conceptPath, "utf8"), staleConceptText, "check mode must leave the stale registry untouched");
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("authoring selectors are sorted, inclusive, DOI-aware, and compose with limit", async () => {
  const fixture = await createFixture();
  try {
    await addBlockedPaper(fixture, "a-blocked-fixture", "10.0000/a-blocked-fixture");
    await addBlockedPaper(fixture, "z-blocked-fixture", "10.0000/z-blocked-fixture");

    const resumed = await run(options(fixture.root, {
      paper: [],
      from: "10.0000/curated-parser-upgrade-fixture",
      limit: 1,
      dryRun: true
    }));
    assert.equal(resumed.selected, 1);
    assert.deepEqual(resumed.results.map((entry) => entry.id), [PAPER_ID]);

    const exact = await run(options(fixture.root, {
      paper: ["https://doi.org/10.0000/z-blocked-fixture"],
      dryRun: true
    }));
    assert.equal(exact.selected, 1);
    assert.deepEqual(exact.results, [{ id: "z-blocked-fixture", status: "blocked", reason: "extraction incomplete" }]);

    const limited = await run(options(fixture.root, {
      paper: ["z-blocked-fixture", "a-blocked-fixture"],
      limit: 1,
      dryRun: true
    }));
    assert.deepEqual(limited.results.map((entry) => entry.id), ["a-blocked-fixture"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("one blocked paper does not discard a successful paper checkpoint", async () => {
  const fixture = await createFixture();
  try {
    await addBlockedPaper(fixture, "z-blocked-fixture", "10.0000/z-blocked-fixture");
    const result = await run(options(fixture.root, {
      paper: [PAPER_ID, "z-blocked-fixture"],
      jobs: 2
    }));

    assert.equal(result.selected, 2);
    assert.deepEqual(result.counts, { reconciled: 1, blocked: 1 });
    const checkpoint = await checkProjectCheckpoints({ root: fixture.root, papers: [PAPER_ID] });
    assert.equal(checkpoint.ok, true, JSON.stringify(checkpoint.stale));
    assert.equal(result.results.find((entry) => entry.id === "z-blocked-fixture")?.reason, "extraction incomplete");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a curated extraction rebind fails closed when a source anchor no longer validates", async () => {
  const fixture = await createFixture((envelope) => {
    envelope.note.models[0].components[0].sources[0].quote = "This quotation is absent from the upgraded extraction.";
  });
  try {
    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");

    for (const dryRun of [true, false]) {
      const result = await run(options(fixture.root, { dryRun }));
      assert.deepEqual(result.counts, { failed: 1 });
      assert.match(result.results[0].reason, /source quote differs from page 1/);
      assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore, "failed validation must not refresh the curated envelope");
      assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore, "failed validation must not refresh the curated checkpoint");
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("curated reconciliation rejects malformed symbol content before writing", async () => {
  const fixture = await createFixture((envelope) => {
    envelope.note.models[0].components[0].symbols = [{ symbol: "q)", meaning: "order quantity" }];
  });
  try {
    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");

    for (const dryRun of [true, false]) {
      const result = await run(options(fixture.root, { dryRun }));
      assert.deepEqual(result.counts, { failed: 1 });
      assert.match(result.results[0].reason, /malformed symbol content \(unexpected closing delimiter \)\)/);
      assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore, "failed validation must not refresh the curated envelope");
      assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore, "failed validation must not refresh the curated checkpoint");
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("curated reconciliation rejects inconsistent upstream PDF identity before writing", async () => {
  const fixture = await createFixture();
  try {
    const ledger = JSON.parse(await readFile(fixture.ledgerPath, "utf8"));
    ledger.pdfSha256 = "different-upstream-pdf-sha256";
    await writeJson(fixture.ledgerPath, ledger);
    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");

    const result = await run(options(fixture.root));

    assert.deepEqual(result.counts, { stale: 1 });
    assert.match(result.results[0].reason, /paper, or PDF identity is stale/);
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("authoring rejects extraction page bytes that do not match the claimed hash", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(fixture.pagesPath, JSON.stringify(PAGES_PAYLOAD, null, 2) + "\n\n", "utf8");
    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");

    const result = await run(options(fixture.root));

    assert.deepEqual(result.counts, { stale: 1 });
    assert.equal(result.results[0].reason, "Extraction QA is not a current terminal checkpoint (review_decision_not_reproducible)");
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("curated reconciliation still rejects a changed PDF identity", async () => {
  const fixture = await createFixture((envelope) => {
    envelope.sourcePdfSha256 = "different-pdf-sha256";
  });
  try {
    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");
    const result = await run(options(fixture.root));

    assert.deepEqual(result.counts, { stale: 1 });
    assert.match(result.results[0].reason, /paper, or PDF identity is stale/);
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("generated v20 QA-only rebind is check/dry-run safe, content-preserving, and restartable", async () => {
  const fixture = await createGeneratedV20Fixture();
  try {
    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");

    const checked = await run(options(fixture.root, { check: true }));
    assert.deepEqual(checked.counts, { stale: 1 });
    assert.match(checked.results[0].reason, /requires a QA-only rebind/);
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);

    const preview = await run(options(fixture.root, { dryRun: true }));
    assert.deepEqual(preview.counts, { "would-rebind-qa": 1 });
    assert.match(preview.results[0].reason, /only its QA binding is stale/);
    assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
    assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);

    const rebound = await run(options(fixture.root));
    assert.deepEqual(rebound.counts, { "qa-rebound": 1 });
    const savedText = await readFile(fixture.notePath, "utf8");
    const saved = JSON.parse(savedText);
    const expected = reconcileGeneratedQaEnvelope(fixture.priorEnvelope, {
      inputDigest: fixture.currentEnvelope.inputDigest,
      qaBinding: fixture.qaBinding
    });
    assert.deepEqual(saved, expected);
    assert.deepEqual(
      { ...saved.note, provenance: undefined },
      { ...fixture.priorEnvelope.note, provenance: undefined },
      "the generated note body must not be regenerated during a QA-only rebind"
    );
    const expectedProvenance = {
      ...fixture.priorEnvelope.note.provenance,
      ...fixture.qaBinding
    };
    assert.deepEqual(saved.note.provenance, expectedProvenance);

    const ledger = JSON.parse(await readFile(fixture.ledgerPath, "utf8"));
    assert.equal(ledger.stages.noteAuthoring.noteSha256, sha256(savedText));
    assert.equal(ledger.stages.noteAuthoring.inputDigest, saved.inputDigest);
    assert.equal(ledger.stages.noteAuthoring.extractionQaDecisionSha256, fixture.qaBinding.extractionQaDecisionSha256);
    assert.equal(ledger.stages.sourceReading.extractionQaInputDigest, fixture.qaBinding.extractionQaInputDigest);
    assert.equal(ledger.stages.sectionIndex.extractionQaDecisionSha256, fixture.qaBinding.extractionQaDecisionSha256);
    const checkpointReport = await checkProjectCheckpoints({ root: fixture.root, papers: [PAPER_ID] });
    assert.equal(checkpointReport.ok, true, JSON.stringify(checkpointReport.stale));

    const savedAtRestart = await readFile(fixture.notePath, "utf8");
    const resumed = await run(options(fixture.root));
    assert.deepEqual(resumed.counts, { current: 1 });
    assert.equal(await readFile(fixture.notePath, "utf8"), savedAtRestart);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("generated v20 QA-only rebind reruns semantic and source validation before writing", async () => {
  const fixture = await createGeneratedV20Fixture((note) => {
    note.models[0].components[0].sources[0].quote = "This fabricated quote is absent from the extracted page.";
  });
  try {
    const noteBefore = await readFile(fixture.notePath, "utf8");
    const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");
    for (const overrides of [{ dryRun: true }, {}]) {
      const result = await run(options(fixture.root, overrides));
      assert.deepEqual(result.counts, { failed: 1 });
      assert.match(result.results[0].reason, /semantic validation failed|source quote differs/);
      assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
      assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("--force bypasses generated v20 QA-only rebind and truly regenerates the note", async () => {
  const marker = "Force must replace this otherwise-valid prior-note marker.";
  const fixture = await createGeneratedV20Fixture((note) => {
    note.overview = `${note.overview} ${marker}`;
  });
  try {
    assert.match(await readFile(fixture.notePath, "utf8"), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const result = await run(options(fixture.root, { force: true }));
    assert.deepEqual(result.counts, { updated: 1 }, JSON.stringify(result.results));
    const saved = await readFile(fixture.notePath, "utf8");
    assert.doesNotMatch(saved, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(JSON.parse(saved), fixture.currentEnvelope);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("generated QA-only rebind rejects safe-map markers and stale envelope identity", async (t) => {
  for (const scenario of [
    {
      name: "safe-map marker",
      mutate(envelope) { envelope.safeMapSha256 = sha256("unexpected-safe-map-binding"); }
    },
    {
      name: "stale concept identity",
      mutate(envelope) { envelope.conceptRegistrySha256 = sha256("stale-concept-registry"); }
    },
    {
      name: "stale PDF identity",
      mutate(envelope) { envelope.sourcePdfSha256 = sha256("stale-source-pdf"); }
    }
  ]) {
    await t.test(scenario.name, async () => {
      const fixture = await createGeneratedV20Fixture();
      try {
        scenario.mutate(fixture.priorEnvelope);
        const staleText = `${JSON.stringify(fixture.priorEnvelope, null, 2)}\n`;
        await writeFile(fixture.notePath, staleText, "utf8");
        const ledger = JSON.parse(await readFile(fixture.ledgerPath, "utf8"));
        ledger.stages.noteAuthoring.noteSha256 = sha256(staleText);
        await writeJson(fixture.ledgerPath, ledger);
        const noteBefore = await readFile(fixture.notePath, "utf8");
        const ledgerBefore = await readFile(fixture.ledgerPath, "utf8");

        const result = await run(options(fixture.root, { dryRun: true }));
        assert.deepEqual(result.counts, { "would-update": 1 }, JSON.stringify(result.results));
        assert.equal(await readFile(fixture.notePath, "utf8"), noteBefore);
        assert.equal(await readFile(fixture.ledgerPath, "utf8"), ledgerBefore);
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    });
  }
});
