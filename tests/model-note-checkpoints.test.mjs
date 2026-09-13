import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stableStringify as stableLedgerStringify } from "../scripts/corpus-pipeline.mjs";
import {
  atomicWriteJson,
  checkProjectCheckpoints,
  ensureReadingPacket,
  inspectNoteCheckpoint,
  inspectReadingCheckpoint,
  MINI_READING_AUDIT_VERSION,
  miniReadingInputDigest,
  readingPacketInputDigest,
  renderJson,
  sha256,
  stableStringify
} from "../scripts/model-note-checkpoints.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = path.join(root, "scripts", "model-note-checkpoints.mjs");

const identity = {
  paperId: "fixture-paper",
  sourcePdfSha256: "pdf-sha-fixture",
  extractionPagesSha256: "pages-sha-fixture",
  contractDigest: "editorial-contract-sha-fixture",
  packetVersion: "reading-packet-fixture-v1"
};

function expectedIdentity(overrides = {}) {
  const input = { ...identity, ...overrides };
  return { ...input, inputDigest: readingPacketInputDigest(input) };
}

async function writeFixtureLedger(temporaryRoot, sourceReading = { status: "pending" }) {
  const ledger = {
    paperId: identity.paperId,
    pdfSha256: identity.sourcePdfSha256,
    stages: {
      extraction: {
        status: "complete",
        artifacts: { pagesSha256: identity.extractionPagesSha256 }
      },
      sourceReading,
      noteAuthoring: { status: "pending" }
    }
  };
  const ledgerPath = path.join(temporaryRoot, "research", "ledger", "papers", `${identity.paperId}.json`);
  await atomicWriteJson(ledgerPath, ledger);
  return ledgerPath;
}

test("reading packets are content-addressed and a matching checkpoint skips rebuilding", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-reading-checkpoint-"));
  try {
    await writeFixtureLedger(temporaryRoot);
    const expected = expectedIdentity();
    let builds = 0;
    const first = await ensureReadingPacket({
      root: temporaryRoot,
      expected,
      buildPacket: async () => {
        builds += 1;
        return { pagesRead: [3, 4], sectionsRead: [{ title: "Model", pages: [3, 4] }] };
      }
    });
    assert.equal(first.status, "created");
    assert.equal(builds, 1);
    assert.match(first.stage.artifactPath, new RegExp(`/sourceReading/${first.stage.artifactSha256}/reading\\.json$`));

    const ledgerPath = path.join(temporaryRoot, "research", "ledger", "papers", `${identity.paperId}.json`);
    const ledgerText = await readFile(ledgerPath, "utf8");
    assert.equal(ledgerText, `${stableLedgerStringify(JSON.parse(ledgerText), 2)}\n`,
      "reading checkpoint updates leave the paper ledger canonical");

    const savedArtifact = await readFile(path.join(temporaryRoot, ...first.stage.artifactPath.split("/")), "utf8");
    assert.equal(sha256(savedArtifact), first.stage.artifactSha256);
    assert.equal(savedArtifact, renderJson(JSON.parse(savedArtifact)),
      "reading packet serialization remains unchanged while the ledger is canonicalized");

    const second = await ensureReadingPacket({
      root: temporaryRoot,
      expected,
      buildPacket: async () => {
        builds += 1;
        throw new Error("matching checkpoints must not rebuild");
      }
    });
    assert.equal(second.status, "skipped");
    assert.equal(builds, 1);

    const missingIndex = JSON.parse(await readFile(ledgerPath, "utf8"));
    delete missingIndex.stages.sectionIndex;
    await atomicWriteJson(ledgerPath, missingIndex);
    const recoveredIndex = await ensureReadingPacket({
      root: temporaryRoot,
      expected,
      buildPacket: async () => {
        builds += 1;
        throw new Error("an intact reading artifact must repair only the missing section index");
      }
    });
    assert.equal(recoveredIndex.status, "recovered");
    assert.equal(builds, 1);
    assert.equal(JSON.parse(await readFile(ledgerPath, "utf8")).stages.sectionIndex.status, "complete");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("a valid artifact repairs a stale ledger, while a corrupt artifact is rebuilt", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-reading-recovery-"));
  try {
    const ledgerPath = await writeFixtureLedger(temporaryRoot);
    const expected = expectedIdentity();
    const packet = { pagesRead: [8], coverageNote: "Core formulation inspected." };
    const created = await ensureReadingPacket({ root: temporaryRoot, expected, buildPacket: async () => packet });
    const artifactPath = path.join(temporaryRoot, ...created.stage.artifactPath.split("/"));

    const staleLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
    staleLedger.stages.sourceReading = { status: "pending", inputDigest: "stale" };
    await atomicWriteJson(ledgerPath, staleLedger);
    let builds = 0;
    const recovered = await ensureReadingPacket({
      root: temporaryRoot,
      expected,
      buildPacket: async () => {
        builds += 1;
        return packet;
      }
    });
    assert.equal(recovered.status, "recovered");
    assert.equal(builds, 0, "ledger recovery reuses the hash-verified artifact");

    await writeFile(artifactPath, "{corrupt", "utf8");
    const rebuilt = await ensureReadingPacket({
      root: temporaryRoot,
      expected,
      buildPacket: async () => {
        builds += 1;
        return packet;
      }
    });
    assert.equal(rebuilt.status, "rebuilt");
    assert.equal(builds, 1);
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const inspected = await inspectReadingCheckpoint({ root: temporaryRoot, ledger, expected });
    assert.equal(inspected.ok, true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("note inspection and the --check CLI detect stale ledger or artifact state", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-note-check-"));
  try {
    const ledgerPath = await writeFixtureLedger(temporaryRoot);
    await ensureReadingPacket({
      root: temporaryRoot,
      expected: expectedIdentity(),
      buildPacket: async () => ({ pagesRead: [1], coverageNote: "Fixture source was read." })
    });
    const notePath = path.join(temporaryRoot, "research", "notes", "papers", `${identity.paperId}.json`);
    const conceptRegistrySha256 = "e".repeat(64);
    const envelope = {
      schemaVersion: 1,
      authoringVersion: "fixture-author-v1",
      paperId: identity.paperId,
      sourcePdfSha256: identity.sourcePdfSha256,
      extractionPagesSha256: identity.extractionPagesSha256,
      conceptRegistrySha256,
      inputDigest: "note-input-fixture",
      note: { id: identity.paperId, question: "What is modeled?", models: [] }
    };
    await mkdir(path.dirname(notePath), { recursive: true });
    const noteText = `${JSON.stringify(envelope, null, 2)}\n`;
    await writeFile(notePath, noteText, "utf8");
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    ledger.stages.noteAuthoring = {
      status: "complete",
      inputDigest: envelope.inputDigest,
      sourcePdfSha256: identity.sourcePdfSha256,
      conceptRegistrySha256,
      authoringVersion: envelope.authoringVersion,
      notePath: path.relative(temporaryRoot, notePath).replaceAll(path.sep, "/"),
      noteSha256: sha256(noteText)
    };
    await atomicWriteJson(ledgerPath, ledger);

    const current = await inspectNoteCheckpoint({ root: temporaryRoot, ledger });
    assert.equal(current.status, "current");
    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath, "--check", "--root", temporaryRoot, "--json"]),
      (error) => {
        const report = JSON.parse(error.stdout);
        assert.equal(report.ok, false);
        assert.deepEqual(report.stale.map((entry) => entry.stage), ["extractQa"]);
        return true;
      }
    );

    const staleInput = await inspectNoteCheckpoint({ root: temporaryRoot, ledger, expectedInputDigest: "new-authoring-input" });
    assert.deepEqual(staleInput.issues, ["note_expected_input_digest_mismatch"]);

    await writeFile(notePath, noteText.replace("What is modeled?", "What changed?"), "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath, "--check", "--root", temporaryRoot, "--json"]),
      (error) => {
        const report = JSON.parse(error.stdout);
        assert.equal(report.ok, false);
        const noteFailure = report.stale.find((entry) => entry.stage === "noteAuthoring");
        assert.deepEqual(noteFailure.issues, ["note_file_hash_mismatch"]);
        return true;
      }
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("authoring checkpoint verification hashes extracted pages and binds the reading packet version", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-authoring-artifact-integrity-"));
  try {
    const paperId = "source-mapped-paper";
    const pdfSha256 = "a".repeat(64);
    const authoringVersion = "source-author-v1";
    const inputDigest = "b".repeat(64);
    const conceptRegistrySha256 = "c".repeat(64);
    const pagesRelative = `research/ledger/artifacts/${paperId}/extract/pages.json`;
    const pagesPath = path.join(temporaryRoot, ...pagesRelative.split("/"));
    const pagesPayload = { schemaVersion: 1, paperId, pdfSha256, pages: [{ page: 1, text: "Model source text." }] };
    await mkdir(path.dirname(pagesPath), { recursive: true });
    const pagesText = `${JSON.stringify(pagesPayload, null, 2)}\n`;
    await writeFile(pagesPath, pagesText, "utf8");
    const pagesSha256 = sha256(pagesText);

    const packetRelative = `research/ledger/artifacts/${paperId}/${inputDigest}/reading-packet.json`;
    const packetPath = path.join(temporaryRoot, ...packetRelative.split("/"));
    const packet = {
      schemaVersion: 1,
      authoringVersion,
      paperId,
      sourcePdfSha256: pdfSha256,
      extractionPagesSha256: pagesSha256,
      extractionQaStatus: "complete",
      pageCount: 1,
      sectionIndex: [],
      selectedSections: []
    };
    await mkdir(path.dirname(packetPath), { recursive: true });
    let packetText = `${JSON.stringify(packet, null, 2)}\n`;
    await writeFile(packetPath, packetText, "utf8");

    const noteRelative = `data/notes/papers/${paperId}.json`;
    const notePath = path.join(temporaryRoot, ...noteRelative.split("/"));
    const envelope = {
      schemaVersion: 1,
      authoringVersion,
      paperId,
      sourcePdfSha256: pdfSha256,
      extractionPagesSha256: pagesSha256,
      conceptRegistrySha256,
      inputDigest,
      note: { id: paperId, question: "What is modeled?", models: [] }
    };
    await mkdir(path.dirname(notePath), { recursive: true });
    const noteText = `${JSON.stringify(envelope, null, 2)}\n`;
    await writeFile(notePath, noteText, "utf8");

    const readingPacketSha256 = sha256(packetText);
    const ledger = {
      paperId,
      pdfSha256,
      stages: {
        extraction: { status: "complete", artifacts: { pages: pagesRelative, pagesSha256 } },
        extractQa: { status: "complete" },
        sectionIndex: { status: "complete", inputDigest: pagesSha256, sourcePdfSha256: pdfSha256, readingPacket: packetRelative, readingPacketSha256 },
        sourceReading: { status: "complete", inputDigest: pagesSha256, sourcePdfSha256: pdfSha256, pagesArtifact: pagesRelative, readingPacket: packetRelative, readingPacketSha256 },
        noteAuthoring: { status: "complete", inputDigest, sourcePdfSha256: pdfSha256, conceptRegistrySha256, authoringVersion, notePath: noteRelative, noteSha256: sha256(noteText) }
      }
    };
    const ledgerPath = path.join(temporaryRoot, "research", "ledger", "papers", `${paperId}.json`);
    await atomicWriteJson(ledgerPath, ledger);
    const initiallyChecked = await checkProjectCheckpoints({ root: temporaryRoot });
    assert.equal(initiallyChecked.ok, false, "a missing Extraction QA decision is a hard gate");
    assert.deepEqual(initiallyChecked.stale.filter((entry) => entry.stage !== "extractQa"), []);

    const staleConceptLedger = structuredClone(ledger);
    staleConceptLedger.stages.noteAuthoring.conceptRegistrySha256 = "d".repeat(64);
    await atomicWriteJson(ledgerPath, staleConceptLedger);
    const staleConcept = await checkProjectCheckpoints({ root: temporaryRoot });
    assert.equal(staleConcept.ok, false);
    assert.ok(staleConcept.stale.some((entry) => entry.stage === "noteAuthoring"
      && entry.issues.includes("note_concept_registry_mismatch")));
    await atomicWriteJson(ledgerPath, ledger);

    await writeFile(pagesPath, pagesText.replace("Model source text.", "Tampered source text."), "utf8");
    const tampered = await checkProjectCheckpoints({ root: temporaryRoot });
    assert.equal(tampered.ok, false);
    assert.ok(tampered.stale.some((entry) => entry.issues.includes("reading_extraction_artifact_hash_mismatch")));

    await writeFile(pagesPath, pagesText, "utf8");
    packet.authoringVersion = "source-author-v0";
    packetText = `${JSON.stringify(packet, null, 2)}\n`;
    await writeFile(packetPath, packetText, "utf8");
    const staleVersionLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
    staleVersionLedger.stages.sourceReading.readingPacketSha256 = sha256(packetText);
    staleVersionLedger.stages.sectionIndex.readingPacketSha256 = sha256(packetText);
    await atomicWriteJson(ledgerPath, staleVersionLedger);
    const staleVersion = await checkProjectCheckpoints({ root: temporaryRoot });
    assert.equal(staleVersion.ok, false);
    assert.ok(staleVersion.stale.some((entry) => entry.issues.includes("reading_authoringVersion_mismatch")));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("project checkpoint checks explicitly scope themselves and inspect every scoped authoring artifact", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-checkpoint-scope-"));
  try {
    await writeFixtureLedger(temporaryRoot);
    const report = await checkProjectCheckpoints({ root: temporaryRoot });
    assert.equal(report.scope, "extraction-qa-and-authoring-artifacts");
    assert.equal(report.ok, false);
    assert.equal(report.checkedPapers, 1);
    assert.equal(report.checkedStages, 4);
    assert.deepEqual(report.results[0].checks.map((check) => check.stage), ["extractQa", "sectionIndex", "sourceReading", "noteAuthoring"]);
    assert.ok(report.results[0].checks.every((check) => check.status !== "current"));
    assert.equal("releaseReady" in report, false, "a checkpoint-only command makes no aggregate release-readiness claim");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("frozen Mini checkpoints bind raw page bytes to both reading stages and the note input", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-mini-pages-integrity-"));
  try {
    const paperId = "mini-source-paper";
    const miniPaperId = "P900";
    const pdfSha256 = "c".repeat(64);
    const pagesRelative = `mini-atlas/research/pages/${miniPaperId}.json`;
    const pagesPath = path.join(temporaryRoot, ...pagesRelative.split("/"));
    const pagesText = `${JSON.stringify([{ page: 1, text: "Frozen editorial source page." }], null, 2)}\n`;
    const pagesSha256 = sha256(pagesText);
    await mkdir(path.dirname(pagesPath), { recursive: true });
    await writeFile(pagesPath, pagesText, "utf8");

    const note = {
      id: miniPaperId,
      question: "What does the frozen Mini model represent?",
      overview: "Fixture note.",
      modelTypes: ["analytical"],
      coverage: { pages: [1], note: "Frozen page." },
      models: []
    };
    const noteSha256 = sha256(stableStringify(note));
    const noteRelative = "mini-atlas/data/notes/batch-fixture.json";
    const notePath = path.join(temporaryRoot, ...noteRelative.split("/"));
    await mkdir(path.dirname(notePath), { recursive: true });
    await writeFile(notePath, `${JSON.stringify({ papers: [note] }, null, 2)}\n`, "utf8");

    const noteInputDigest = sha256(`${pdfSha256}\0${noteSha256}\0${pagesSha256}`);
    const readingInputDigest = miniReadingInputDigest({
      paperId,
      sourcePdfSha256: pdfSha256,
      noteSha256,
      pagesArtifact: pagesRelative,
      pagesSha256
    });
    const ledger = {
      paperId,
      pdfSha256,
      stages: {
        sectionIndex: {
          status: "complete",
          auditVersion: MINI_READING_AUDIT_VERSION,
          inputDigest: readingInputDigest,
          sourcePdfSha256: pdfSha256,
          pagesArtifact: pagesRelative,
          pagesSha256,
          source: "Mini Atlas editorial fixture"
        },
        sourceReading: {
          status: "complete",
          auditVersion: MINI_READING_AUDIT_VERSION,
          inputDigest: readingInputDigest,
          sourcePdfSha256: pdfSha256,
          pagesArtifact: pagesRelative,
          pagesSha256,
          notePath: noteRelative,
          noteSha256,
          mode: "Frozen Mini Atlas editorial source map"
        },
        noteAuthoring: {
          status: "complete",
          source: "mini-atlas-schema-v2",
          inputDigest: noteInputDigest,
          sourcePdfSha256: pdfSha256,
          miniPaperId,
          notePath: noteRelative,
          noteSha256,
          pagesPath: pagesRelative,
          pagesSha256
        }
      }
    };
    const ledgerPath = path.join(temporaryRoot, "research", "ledger", "papers", `${paperId}.json`);
    await atomicWriteJson(ledgerPath, ledger);

    const current = await checkProjectCheckpoints({ root: temporaryRoot });
    assert.equal(current.ok, false, "a missing Extraction QA decision is a hard gate");
    assert.deepEqual(current.stale.filter((entry) => entry.stage !== "extractQa"), []);

    await writeFile(notePath, `${JSON.stringify({ papers: [note, note] }, null, 2)}\n`, "utf8");
    const duplicateNote = await checkProjectCheckpoints({ root: temporaryRoot });
    assert.equal(duplicateNote.ok, false);
    assert.ok(duplicateNote.stale.some((entry) => entry.stage === "noteAuthoring"
      && entry.issues.includes("note_paper_identity_count_mismatch")));
    await writeFile(notePath, `${JSON.stringify({ papers: [note] }, null, 2)}\n`, "utf8");

    await writeFile(pagesPath, pagesText.replace("Frozen editorial", "Tampered editorial"), "utf8");
    const tampered = await checkProjectCheckpoints({ root: temporaryRoot });
    assert.equal(tampered.ok, false);
    assert.ok(tampered.stale.some((entry) => entry.stage === "sourceReading"
      && entry.issues.includes("reading_pages_hash_mismatch")));

    await writeFile(pagesPath, pagesText, "utf8");
    const staleBinding = JSON.parse(await readFile(ledgerPath, "utf8"));
    staleBinding.stages.sourceReading.pagesSha256 = "d".repeat(64);
    await atomicWriteJson(ledgerPath, staleBinding);
    const mismatched = await checkProjectCheckpoints({ root: temporaryRoot });
    assert.equal(mismatched.ok, false);
    assert.ok(mismatched.stale.some((entry) => entry.stage === "sectionIndex"
      && entry.issues.includes("section_index_pages_hash_mismatch")));
    assert.ok(mismatched.stale.some((entry) => entry.stage === "sourceReading"
      && entry.issues.includes("reading_pages_hash_binding_mismatch")));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("project checkpoint CLI reports all four scoped stages and fails closed in a hermetic root", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-checkpoint-cli-scope-"));
  try {
    await writeFixtureLedger(temporaryRoot);
    const report = await checkProjectCheckpoints({ root: temporaryRoot, papers: [identity.paperId] });
    assert.equal(report.scope, "extraction-qa-and-authoring-artifacts");
    assert.equal(report.ok, false);
    assert.equal(report.checkedPapers, 1);
    assert.equal(report.checkedStages, 4);
    assert.deepEqual(report.results[0].checks.map((check) => check.stage), [
      "extractQa", "sectionIndex", "sourceReading", "noteAuthoring"
    ]);
    assert.ok(report.results[0].checks.every((check) => check.status !== "current"));

    await assert.rejects(
      execFileAsync(process.execPath, [
        scriptPath, "--check", "--root", temporaryRoot, "--paper", identity.paperId, "--json"
      ], { cwd: temporaryRoot }),
      (error) => {
        const cliReport = JSON.parse(error.stdout);
        assert.equal(cliReport.ok, false);
        assert.equal(cliReport.checkedPapers, 1);
        assert.equal(cliReport.checkedStages, 4);
        assert.deepEqual(cliReport.results[0].checks.map((check) => check.stage), [
          "extractQa", "sectionIndex", "sourceReading", "noteAuthoring"
        ]);
        assert.equal(error.stderr, "");
        return true;
      }
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
