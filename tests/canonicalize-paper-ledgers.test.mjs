import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalizePaperLedgers,
  parsePaperLedgerCanonicalizationCli
} from "../scripts/canonicalize-paper-ledgers.mjs";
import { sha256, stableStringify } from "../scripts/corpus-pipeline.mjs";

function paperRecord(id) {
  return {
    id,
    recordDigest: sha256(`record:${id}`)
  };
}

function paperLedger(record, corpusRevision, marker = "original") {
  return {
    paperId: record.id,
    schemaVersion: 1,
    stages: {
      extraction: { status: "complete" },
      noteAuthoring: { status: "pending" }
    },
    marker,
    manifestRecordDigest: record.recordDigest,
    corpusRevision
  };
}

async function writeJson(filename, value, canonical = false) {
  await mkdir(path.dirname(filename), { recursive: true });
  const text = canonical
    ? `${stableStringify(value, 2)}\n`
    : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filename, text, "utf8");
}

async function makeFixture({ ids = ["paper-a", "paper-b"], canonicalIds = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-canonical-ledgers-"));
  const corpusRevision = "fixture-revision";
  const records = ids.map(paperRecord);
  const manifest = {
    schemaVersion: 1,
    corpusRevision,
    counts: {
      records: records.length,
      detailLevels: { literature: records.length },
      parserWarningPdfs: 0
    },
    records
  };
  await writeJson(path.join(root, "research", "corpus", "manifest.v1.json"), manifest, true);
  const ledgers = new Map();
  for (const record of records) {
    const ledger = paperLedger(record, corpusRevision);
    const filename = path.join(root, "research", "ledger", "papers", `${record.id}.json`);
    await writeJson(filename, ledger, canonicalIds.includes(record.id));
    ledgers.set(record.id, { filename, value: ledger });
  }
  const summaryPath = path.join(root, "research", "ledger", "summary.json");
  await writeJson(summaryPath, { sentinel: true }, true);
  return { root, manifest, records, ledgers, summaryPath };
}

async function isCanonical(filename) {
  const bytes = await readFile(filename);
  const value = JSON.parse(bytes.toString("utf8"));
  return bytes.equals(Buffer.from(`${stableStringify(value, 2)}\n`, "utf8"));
}

test("check is read-only and write is canonical, summary-refreshing, and idempotent", async () => {
  const fixture = await makeFixture({ canonicalIds: ["paper-a"] });
  try {
    const canonicalBefore = await readFile(fixture.ledgers.get("paper-a").filename);
    const noncanonicalBefore = await readFile(fixture.ledgers.get("paper-b").filename);
    const summaryBefore = await readFile(fixture.summaryPath);

    const checked = await canonicalizePaperLedgers({ root: fixture.root, command: "check" });
    assert.equal(checked.ok, false);
    assert.equal(checked.state, "needs_canonicalization");
    assert.equal(checked.safeToWrite, true);
    assert.deepEqual(checked.counts, {
      expected: 2,
      scanned: 2,
      canonical: 1,
      noncanonical: 1,
      rewritten: 0,
      structuralProblems: 0,
      drifted: 0,
      hazards: 0,
      orphanWriterTemps: 0,
      pendingQuarantineTransactions: 0,
      quarantined: 0
    });
    assert.deepEqual(await readFile(fixture.ledgers.get("paper-a").filename), canonicalBefore);
    assert.deepEqual(await readFile(fixture.ledgers.get("paper-b").filename), noncanonicalBefore);
    assert.deepEqual(await readFile(fixture.summaryPath), summaryBefore);

    await assert.rejects(
      canonicalizePaperLedgers({ root: fixture.root, command: "write" }),
      /requires --attest-writers-stopped/
    );

    const written = await canonicalizePaperLedgers({
      root: fixture.root,
      command: "write",
      attestWritersStopped: true
    });
    assert.equal(written.ok, true);
    assert.equal(written.counts.rewritten, 1);
    assert.equal(written.counts.canonical, 2);
    assert.equal(written.counts.noncanonical, 0);
    assert.equal(written.summaryRefreshed, true);
    assert.equal(written.summaryChanged, true);
    assert.deepEqual(await readFile(fixture.ledgers.get("paper-a").filename), canonicalBefore,
      "already-canonical bytes remain untouched");
    assert.equal(await isCanonical(fixture.ledgers.get("paper-b").filename), true);
    assert.equal((await readFile(fixture.summaryPath, "utf8")),
      `${stableStringify(written.ledgerSummary, 2)}\n`);

    const hashesBeforeRestart = await Promise.all(
      [...fixture.ledgers.values()].map(async ({ filename }) => sha256(await readFile(filename)))
    );
    const restarted = await canonicalizePaperLedgers({
      root: fixture.root,
      command: "write",
      attestWritersStopped: true
    });
    const hashesAfterRestart = await Promise.all(
      [...fixture.ledgers.values()].map(async ({ filename }) => sha256(await readFile(filename)))
    );
    assert.equal(restarted.ok, true);
    assert.equal(restarted.counts.rewritten, 0);
    assert.equal(restarted.summaryRefreshed, true);
    assert.equal(restarted.summaryChanged, false);
    assert.deepEqual(hashesAfterRestart, hashesBeforeRestart);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("an interrupted write resumes from already-canonical ledgers", async () => {
  const fixture = await makeFixture();
  try {
    let commits = 0;
    await assert.rejects(
      canonicalizePaperLedgers({
        root: fixture.root,
        command: "write",
        attestWritersStopped: true,
        hooks: {
          afterCommit() {
            commits += 1;
            if (commits === 1) throw new Error("simulated interruption");
          }
        }
      }),
      /simulated interruption/
    );
    assert.equal(commits, 1);
    assert.equal(await isCanonical(fixture.ledgers.get("paper-a").filename), true);
    assert.equal(await isCanonical(fixture.ledgers.get("paper-b").filename), false);
    assert.deepEqual(JSON.parse(await readFile(fixture.summaryPath, "utf8")), { sentinel: true },
      "an incomplete run does not refresh the cache summary");

    const resumed = await canonicalizePaperLedgers({
      root: fixture.root,
      command: "write",
      attestWritersStopped: true
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.counts.rewritten, 1);
    assert.equal(resumed.counts.canonical, 2);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("compare-and-swap drift fails closed without overwriting the changed ledger", async () => {
  const fixture = await makeFixture({ ids: ["paper-a"] });
  try {
    const filename = fixture.ledgers.get("paper-a").filename;
    const driftedValue = { ...fixture.ledgers.get("paper-a").value, marker: "concurrent-writer" };
    const result = await canonicalizePaperLedgers({
      root: fixture.root,
      command: "write",
      attestWritersStopped: true,
      hooks: {
        async beforeCommit() {
          await writeJson(filename, driftedValue, false);
        }
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "failed_closed");
    assert.equal(result.counts.rewritten, 0);
    assert.equal(result.counts.drifted, 1);
    assert.equal(result.diagnostics.drifted[0].reason, "ledger_compare_and_swap_failed");
    assert.equal(JSON.parse(await readFile(filename, "utf8")).marker, "concurrent-writer");
    assert.deepEqual(JSON.parse(await readFile(fixture.summaryPath, "utf8")), { sentinel: true });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("dead-writer temporary files move to an evidenced quarantine and an interrupted move resumes", async () => {
  const fixture = await makeFixture();
  try {
    const uuid = "11111111-2222-4333-8444-555555555555";
    const temporaryName = `paper-a.json.99999999-${uuid}.tmp`;
    const temporaryPath = path.join(fixture.root, "research", "ledger", "papers", temporaryName);
    const staleLedger = { ...fixture.ledgers.get("paper-a").value, marker: "orphaned-writer-output" };
    await writeJson(temporaryPath, staleLedger, false);

    const checked = await canonicalizePaperLedgers({
      root: fixture.root,
      command: "check",
      hooks: { processIsAlive: () => false }
    });
    assert.equal(checked.counts.orphanWriterTemps, 1);
    assert.equal(checked.counts.hazards, 0);
    assert.equal(checked.safeToWrite, true);
    assert.equal(checked.diagnostics.orphanWriterTemps[0].jsonComplete, true);
    assert.equal(checked.diagnostics.orphanWriterTemps[0].jsonPaperIdMatches, true);
    assert.equal(checked.diagnostics.orphanWriterTemps[0].pidAlive, false);

    let moves = 0;
    const interrupted = await canonicalizePaperLedgers({
      root: fixture.root,
      command: "write",
      attestWritersStopped: true,
      hooks: {
        processIsAlive: () => false,
        afterQuarantineMove() {
          moves += 1;
          throw new Error("simulated quarantine interruption");
        }
      }
    });
    assert.equal(moves, 1);
    assert.equal(interrupted.ok, false);
    assert.equal(interrupted.state, "failed_closed");
    assert.match(interrupted.diagnostics.drifted[0].reason, /simulated quarantine interruption/);
    assert.equal(interrupted.counts.pendingQuarantineTransactions, 1);
    await assert.rejects(readFile(temporaryPath), (error) => error.code === "ENOENT");
    const transactionDigest = interrupted.diagnostics.pendingQuarantineTransactions[0];
    const transactionDir = path.join(
      fixture.root,
      "research",
      "ledger",
      "paper-ledger-canonicalization-quarantine",
      transactionDigest
    );
    const planPath = path.join(transactionDir, "plan.json");
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    assert.equal(plan.transactionDigest, transactionDigest);
    assert.equal(plan.entries[0].sourceSha256, sha256(Buffer.from(`${JSON.stringify(staleLedger, null, 2)}\n`)));
    assert.equal(plan.entries[0].jsonComplete, true);
    assert.equal(plan.entries[0].semanticMatchesAuthoritative, false);
    assert.equal(await isCanonical(planPath), true);
    await assert.rejects(readFile(path.join(transactionDir, "completion.json")), (error) => error.code === "ENOENT");

    const resumed = await canonicalizePaperLedgers({
      root: fixture.root,
      command: "write",
      attestWritersStopped: true,
      hooks: { processIsAlive: () => false }
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.quarantine.length, 1);
    assert.equal(resumed.quarantine[0].transactionDigest, transactionDigest);
    assert.equal(resumed.quarantine[0].moved, 0);
    assert.equal(resumed.quarantine[0].resumed, 1);
    assert.equal(resumed.counts.pendingQuarantineTransactions, 0);
    const quarantinedPath = path.resolve(fixture.root, ...plan.entries[0].quarantinePath.split("/"));
    assert.equal(sha256(await readFile(quarantinedPath)), plan.entries[0].sourceSha256);
    assert.equal(await isCanonical(path.join(transactionDir, "completion.json")), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a recognized temporary file with a live embedded PID blocks quarantine and canonicalization", async () => {
  const fixture = await makeFixture({ ids: ["paper-a"] });
  try {
    const temporaryName = "paper-a.json.4242-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.tmp";
    const temporaryPath = path.join(fixture.root, "research", "ledger", "papers", temporaryName);
    await writeJson(temporaryPath, fixture.ledgers.get("paper-a").value, false);
    const result = await canonicalizePaperLedgers({
      root: fixture.root,
      command: "write",
      attestWritersStopped: true,
      hooks: { processIsAlive: () => true }
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "failed_closed");
    assert.equal(result.safeToWrite, false);
    assert.equal(result.counts.hazards, 1);
    assert.equal(result.counts.orphanWriterTemps, 0);
    assert.equal(result.diagnostics.liveWriterTemps[0].embeddedPid, 4242);
    assert.equal(result.diagnostics.liveWriterTemps[0].pidAlive, true);
    assert.equal(result.quarantine.length, 0);
    assert.equal((await readFile(temporaryPath, "utf8")).length > 0, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("manifest/file-set mismatches and writer artifacts block every write", async () => {
  const fixture = await makeFixture();
  try {
    const missing = fixture.ledgers.get("paper-b").filename;
    await rm(missing);
    await writeJson(
      path.join(fixture.root, "research", "ledger", "papers", "extra-paper.json"),
      { paperId: "extra-paper" },
      true
    );
    await writeFile(
      path.join(fixture.root, "research", "ledger", "papers", "orphan.canonicalize.tmp"),
      "temporary",
      "utf8"
    );
    await writeJson(
      path.join(fixture.root, "research", "ledger", ".claims", "paper-a.extract.json"),
      { active: true },
      true
    );
    const paperABefore = await readFile(fixture.ledgers.get("paper-a").filename);
    const result = await canonicalizePaperLedgers({
      root: fixture.root,
      command: "write",
      attestWritersStopped: true
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "failed_closed");
    assert.equal(result.safeToWrite, false);
    assert.deepEqual(result.diagnostics.missingLedgers, ["paper-b"]);
    assert.deepEqual(result.diagnostics.extraLedgers, ["extra-paper"]);
    assert.deepEqual(result.diagnostics.unexpectedPaperEntries, ["orphan.canonicalize.tmp"]);
    assert.deepEqual(result.diagnostics.activeArtifacts, ["research/ledger/.claims/paper-a.extract.json"]);
    assert.equal(result.counts.rewritten, 0);
    assert.deepEqual(await readFile(fixture.ledgers.get("paper-a").filename), paperABefore);
    assert.deepEqual(JSON.parse(await readFile(fixture.summaryPath, "utf8")), { sentinel: true });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("CLI parsing defaults to check and makes the writer attestation explicit", () => {
  const checked = parsePaperLedgerCanonicalizationCli(["--json"]);
  assert.equal(checked.command, "check");
  assert.equal(checked.attestWritersStopped, false);
  assert.equal(checked.json, true);
  assert.equal(checked.help, false);
  assert.equal(path.isAbsolute(checked.root), true);
  assert.throws(() => parsePaperLedgerCanonicalizationCli(["write"]), /requires --attest-writers-stopped/);
  assert.equal(parsePaperLedgerCanonicalizationCli([
    "write",
    "--attest-writers-stopped",
    "--root",
    "."
  ]).command, "write");
  assert.throws(
    () => parsePaperLedgerCanonicalizationCli(["check", "--attest-writers-stopped"]),
    /write-only/
  );
});
