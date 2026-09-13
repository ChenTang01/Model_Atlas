import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reconcileCuratedEnvelope } from "../scripts/author-model-notes.mjs";
import {
  CURATED_EDITORIAL_IDENTITY_VERSION,
  parseCli,
  run
} from "../scripts/plan-model-note-authoring.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-authoring-plan-"));
  const records = ["z-paper", "mini-b", "c-paper", "a-paper", "mini-a", "d-paper", "b-paper"]
    .map((id) => ({ id, doi: `10.0000/${id}`, title: id, pdf_sha256: sha256(id) }));
  const manifest = {
    schemaVersion: 1,
    records: [...records].reverse().map((record) => ({ id: record.id }))
  };
  await Promise.all([
    writeJson(path.join(root, "data", "atlas_articles.json"), { records }),
    writeJson(path.join(root, "mini-atlas", "data", "atlas.json"), {
      concepts: [{ id: "fixture-concept", label: "Fixture" }],
      papers: [{ sourceId: "mini-b" }, { sourceId: "mini-a" }]
    }),
    writeJson(path.join(root, "research", "corpus", "manifest.v1.json"), manifest),
    writeJson(path.join(root, "data", "notes", "papers", "c-paper.json"), {
      schemaVersion: 1,
      authoringVersion: "curated-source-v1",
      authoringMode: "curated",
      paperId: "c-paper",
      sourcePdfSha256: sha256("c-paper"),
      extractionPagesSha256: sha256("old-pages"),
      conceptRegistrySha256: sha256("old-concepts"),
      inputDigest: sha256("old-input"),
      note: {
        id: "c-paper",
        question: "What is the curated fixture question?",
        provenance: {
          authoringVersion: "curated-source-v1",
          sourceTier: "full-source-curated-note",
          sourcePdfSha256: sha256("c-paper")
        }
      }
    }),
    writeJson(path.join(root, "data", "notes", "papers", "a-paper.json"), {
      schemaVersion: 1,
      authoringMode: "source-mapped",
      paperId: "a-paper"
    })
  ]);
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(root, "scripts", "author-model-notes.mjs"),
      'import { fixture } from "./fixture-dependency.mjs";\nexport { fixture };\n',
      "utf8"
    ),
    writeFile(path.join(root, "scripts", "fixture-dependency.mjs"), "export const fixture = true;\n", "utf8"),
    writeFile(path.join(root, "scripts", "plan-model-note-authoring.mjs"), "// fixture planner identity\n", "utf8")
  ]);
  return root;
}

test("authoring plan freezes sorted non-Mini IDs into exact nonoverlapping restart ranges", async () => {
  const root = await createFixture();
  try {
    const result = await run({ root, batchSize: 2, jobs: 3 });
    const plan = result.plan;
    assert.equal(result.changed, true);
    assert.deepEqual(plan.paperIds, ["a-paper", "b-paper", "c-paper", "d-paper", "z-paper"]);
    assert.equal(plan.frozenInputs.catalogCount, 7);
    assert.equal(plan.frozenInputs.miniCount, 2);
    assert.equal(plan.frozenInputs.nonMiniCount, 5);
    assert.deepEqual(plan.frozenInputs.miniSourceIds, ["mini-a", "mini-b"]);
    assert.deepEqual(plan.batches.map((batch) => ({
      ordinal: batch.ordinal,
      phase: batch.phase,
      start: batch.startIndex,
      end: batch.endIndexExclusive,
      from: batch.fromId,
      through: batch.throughId,
      limit: batch.limit
    })), [
      { ordinal: 1, phase: "bootstrap", start: 0, end: 2, from: "a-paper", through: "b-paper", limit: 2 },
      { ordinal: 2, phase: "parallel-after-bootstrap", start: 2, end: 4, from: "c-paper", through: "d-paper", limit: 2 },
      { ordinal: 3, phase: "parallel-after-bootstrap", start: 4, end: 5, from: "z-paper", through: "z-paper", limit: 1 }
    ]);
    assert.equal(
      plan.batches[1].command,
      'node scripts/author-model-notes.mjs --from "c-paper" --limit 2 --jobs 3 --json'
    );
    assert.equal(
      plan.batches[1].forceRetryCommand,
      'node scripts/author-model-notes.mjs --from "c-paper" --limit 2 --jobs 3 --json --force'
    );
    assert.match(plan.batches[1].logPath, /research\/ledger\/logs\/model-note-authoring\/[a-f0-9]{16}\/batch-02\.log$/);
    assert.equal(new Set(plan.paperIds).size, plan.paperIds.length);
    assert.equal(plan.batches.reduce((sum, batch) => sum + batch.limit, 0), plan.paperIds.length);
    assert.deepEqual(
      plan.frozenInputs.codeFiles.map((entry) => entry.path),
      ["scripts/author-model-notes.mjs", "scripts/fixture-dependency.mjs", "scripts/plan-model-note-authoring.mjs"]
    );
    assert.deepEqual(plan.frozenInputs.curatedNotes.map((entry) => entry.paperId), ["c-paper"]);
    assert.deepEqual(plan.frozenInputs.safeMaps, []);
    assert.deepEqual(plan.frozenInputs.safeMapReviewReports, []);
    assert.equal(plan.schemaVersion, 2);
    assert.equal(plan.frozenInputs.curatedNotes[0].identityVersion, CURATED_EDITORIAL_IDENTITY_VERSION);
    assert.match(plan.frozenInputs.curatedNotes[0].editorialPayloadSha256, /^[a-f0-9]{64}$/);
    assert.equal("sha256" in plan.frozenInputs.curatedNotes[0], false,
      "a plan must not freeze the mutable curated envelope bytes");
    assert.equal("bytes" in plan.frozenInputs.curatedNotes[0], false,
      "a plan must not freeze the mutable curated envelope size");

    const second = await run({ root, batchSize: 2, jobs: 3 });
    assert.equal(second.changed, false, "identical inputs must preserve the exact plan bytes");
    assert.equal(second.plan.planSha256, plan.planSha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reviewed safe maps and their visual-scope reports are exact frozen restart inputs", async () => {
  const root = await createFixture();
  const reportPath = path.join(root, "research", "ledger", "safe-map-scope.json");
  const mapPath = path.join(root, "research", "model-note-safe-maps", "v1", "b-paper.json");
  const planPath = path.join(root, "research", "ledger", "authoring-plan.release-v20.json");
  try {
    await writeJson(reportPath, { schemaVersion: 1, entries: [{ paperId: "b-paper" }] });
    await writeJson(mapPath, {
      schemaVersion: "fixture-safe-map-v1",
      paperId: "b-paper",
      visualScopeReview: { path: "research/ledger/safe-map-scope.json" },
      question: { text: "How is the fixture modeled?" }
    });
    const written = await run({ root, batchSize: 2, jobs: 2 });
    assert.deepEqual(written.plan.frozenInputs.safeMaps.map((entry) => entry.paperId), ["b-paper"]);
    assert.deepEqual(written.plan.frozenInputs.safeMaps.map((entry) => entry.path), [
      "research/model-note-safe-maps/v1/b-paper.json"
    ]);
    assert.deepEqual(written.plan.frozenInputs.safeMapReviewReports.map((entry) => entry.path), [
      "research/ledger/safe-map-scope.json"
    ]);
    assert.match(written.plan.frozenInputs.safeMaps[0].sha256, /^[a-f0-9]{64}$/);
    const before = await readFile(planPath, "utf8");

    const spec = JSON.parse(await readFile(mapPath, "utf8"));
    spec.question.text = "How did the reviewed safe-map text drift?";
    await writeJson(mapPath, spec);
    await assert.rejects(run({ root, check: true }), /Authoring plan is stale: reviewed safe-map input changed/);
    assert.equal(await readFile(planPath, "utf8"), before, "safe-map drift check must be read-only");

    await run({ root, batchSize: 2, jobs: 2 });
    const rebound = await readFile(planPath, "utf8");
    await writeJson(reportPath, { schemaVersion: 1, entries: [{ paperId: "b-paper", drift: true }] });
    await assert.rejects(run({ root, check: true }), /Authoring plan is stale: reviewed safe-map input changed/);
    assert.equal(await readFile(planPath, "utf8"), rebound, "scope-report drift check must be read-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("curated reconciliation changes only mutable bindings while substantive editorial drift invalidates the plan", async () => {
  const root = await createFixture();
  const notePath = path.join(root, "data", "notes", "papers", "c-paper.json");
  const qaBinding = {
    extractionQaStatus: "complete",
    extractionQaAutomatedStatus: "complete",
    extractionQaInputDigest: sha256("qa-input"),
    extractionQaDecisionPath: "research/ledger/extraction-qa/c-paper/decision.json",
    extractionQaDecisionSha256: sha256("qa-decision"),
    extractionQaAdjudicationStatus: "not_required",
    extractionQaAdjudicationPath: null,
    extractionQaAdjudicationSha256: null
  };
  try {
    await run({ root, batchSize: 2, jobs: 3 });
    const existing = JSON.parse(await readFile(notePath, "utf8"));
    const reconciled = reconcileCuratedEnvelope(existing, {
      extractionPagesSha256: sha256("reconciled-pages"),
      conceptRegistrySha256: sha256("reconciled-concepts"),
      qaBinding
    });
    await writeJson(notePath, reconciled);

    const afterReconcile = await run({ root, check: true });
    assert.equal(afterReconcile.ok, true,
      "a normal curated reconciliation must not invalidate its own frozen plan");

    reconciled.note.provenance.sourceTier = "checkpoint-provenance-refreshed";
    reconciled.note.provenance.reconciledAt = "2099-01-01T00:00:00.000Z";
    await writeJson(notePath, reconciled);
    assert.equal((await run({ root, check: true })).ok, true,
      "note.provenance is an explicitly mutable operational wrapper");

    reconciled.note.question = "A substantively changed curated research question";
    await writeJson(notePath, reconciled);
    await assert.rejects(run({ root, check: true }),
      /Authoring plan is stale: curated editorial seed changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema-v1 plans fail closed and require an explicit schema-v2 migration", async () => {
  const root = await createFixture();
  try {
    await run({ root, batchSize: 2, jobs: 2 });
    const planPath = path.join(root, "research", "ledger", "authoring-plan.release-v20.json");
    const legacy = JSON.parse(await readFile(planPath, "utf8"));
    legacy.schemaVersion = 1;
    await writeJson(planPath, legacy);
    const before = await readFile(planPath, "utf8");
    await assert.rejects(run({ root, check: true }), /unsupported schema or kind/);
    assert.equal(await readFile(planPath, "utf8"), before,
      "a failed legacy-plan check must not rewrite or migrate it implicitly");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan --check reuses saved configuration, is read-only, and detects frozen-input drift", async () => {
  const root = await createFixture();
  try {
    await run({ root, batchSize: 3, jobs: 4, logDirectory: "research/ledger/custom-authoring-logs" });
    const planPath = path.join(root, "research", "ledger", "authoring-plan.release-v20.json");
    const before = await readFile(planPath, "utf8");
    const checked = await run({ root, check: true });
    assert.equal(checked.ok, true);
    assert.equal(checked.plan.configuration.batchSize, 3);
    assert.equal(checked.plan.configuration.jobsPerProcess, 4);
    assert.equal(checked.plan.configuration.logDirectory, "research/ledger/custom-authoring-logs");
    assert.equal(await readFile(planPath, "utf8"), before);

    await writeFile(path.join(root, "scripts", "fixture-dependency.mjs"), "export const fixture = false;\n", "utf8");
    await assert.rejects(run({ root, check: true }), /Authoring plan is stale: frozen authoring inputs changed/);
    assert.equal(await readFile(planPath, "utf8"), before, "failed check must not rewrite the saved plan");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan --check rejects tampered batch metadata before comparing current inputs", async () => {
  const root = await createFixture();
  try {
    await run({ root, batchSize: 2, jobs: 2 });
    const planPath = path.join(root, "research", "ledger", "authoring-plan.release-v20.json");
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    plan.batches[0].command = "node unsafe-or-overlapping-command.mjs";
    await writeJson(planPath, plan);
    const tampered = await readFile(planPath, "utf8");
    await assert.rejects(run({ root, check: true }), /Existing authoring plan SHA-256 is invalid/);
    assert.equal(await readFile(planPath, "utf8"), tampered);
    assert.deepEqual((await readdir(path.dirname(planPath))).filter((name) => name.includes(".tmp")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan CLI validates bounds and keeps output and logs inside the project root", async () => {
  assert.deepEqual(parseCli(["--batch-size", "25", "--jobs", "2", "--check", "--json"]), {
    root: "",
    output: "research/ledger/authoring-plan.release-v20.json",
    batchSize: 25,
    jobs: 2,
    logDirectory: "",
    check: true,
    json: true,
    help: false
  });
  assert.throws(() => parseCli(["--batch-size", "0"]), /positive integer/);
  assert.throws(() => parseCli(["--unknown"]), /Unknown argument/);

  const root = await createFixture();
  try {
    await assert.rejects(run({ root, output: "../outside-plan.json" }), /output path must stay inside/);
    await assert.rejects(run({ root, logDirectory: "../outside-logs" }), /log directory must stay inside/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
