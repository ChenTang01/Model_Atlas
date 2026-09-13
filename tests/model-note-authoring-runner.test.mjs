import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { run as buildPlan } from "../scripts/plan-model-note-authoring.mjs";
import { countReceiptStates, inspectReceipt, parseCli, run } from "../scripts/run-model-note-authoring-plan.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-authoring-runner-"));
  const records = ["paper-c", "mini", "paper-a", "paper-b"].map((id) => ({ id, doi: `10.0/${id}`, title: id }));
  await Promise.all([
    writeJson(path.join(root, "data", "atlas_articles.json"), { records }),
    writeJson(path.join(root, "mini-atlas", "data", "atlas.json"), { papers: [{ sourceId: "mini" }] }),
    writeJson(path.join(root, "research", "corpus", "manifest.v1.json"), { records })
  ]);
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "scripts", "author-model-notes.mjs"), "// fixture author\n", "utf8"),
    writeFile(path.join(root, "scripts", "plan-model-note-authoring.mjs"), "// fixture planner\n", "utf8")
  ]);
  const planned = await buildPlan({ root, batchSize: 2, jobs: 3 });
  return { root, plan: planned.plan };
}

function childResult(plan, batch, statuses = []) {
  const ids = plan.paperIds.slice(batch.startIndex, batch.endIndexExclusive);
  const results = ids.map((id, index) => ({ id, status: statuses[index] || "created", models: 1, components: 2 }));
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  return { exitCode: results.some((entry) => entry.status === "failed") ? 1 : 0, signal: "", stdout: JSON.stringify({ selected: ids.length, counts, results }), stderr: "" };
}

test("runner parses bounded selectors and rejects ambiguous ranges", () => {
  assert.deepEqual(parseCli(["--batch", "3,2", "--max-concurrent", "2", "--json"]), {
    root: "", plan: "research/ledger/authoring-plan.release-v20.json", batches: [3, 2], fromBatch: null,
    throughBatch: null, maxConcurrent: 2, status: false, check: false, json: true, help: false
  });
  assert.throws(() => parseCli(["--batch", "1", "--from-batch", "2"]), /cannot be combined/);
  assert.throws(() => parseCli(["--from-batch", "3", "--through-batch", "2"]), /must not exceed/);
  assert.equal(parseCli(["--plan", "research/ledger/authoring-plan.v3.json"]).plan,
    "research/ledger/authoring-plan.v3.json");
});

test("receipt-state accounting fails closed instead of emitting an undefined bucket", () => {
  assert.deepEqual(countReceiptStates([
    { ordinal: 1, state: "complete" },
    { ordinal: 2, state: "failed" },
    { ordinal: 3, state: "stale" },
    { ordinal: 4, state: "missing" },
    { ordinal: 5, state: "failed" }
  ]), { complete: 1, failed: 2, stale: 1, missing: 1 });
  assert.throws(
    () => countReceiptStates(Array.from({ length: 17 }, (_unused, index) => ({ ordinal: index + 1, status: "failed" }))),
    /invalid-receipt-inspection-row index=0 ordinal=1 keys=ordinal,status/
  );
});

test("runner serializes bootstrap, writes hash-bound receipts, and skips verified work", async () => {
  const { root, plan } = await createFixture();
  const calls = [];
  const spawnChild = async (_executable, args) => {
    const fromId = args[args.indexOf("--from") + 1];
    const batch = plan.batches.find((entry) => entry.fromId === fromId);
    calls.push(batch.ordinal);
    return childResult(plan, batch);
  };
  try {
    const first = await run({ root, batches: [], fromBatch: 1, throughBatch: 2 }, { spawnChild });
    assert.equal(first.ok, true);
    assert.deepEqual(calls, [1, 2]);
    assert.deepEqual(first.results.map((entry) => entry.state), ["complete", "complete"]);
    const second = await run({ root, batches: [], fromBatch: 1, throughBatch: 2 }, { spawnChild });
    assert.equal(second.ok, true);
    assert.deepEqual(calls, [1, 2], "verified receipts must prevent duplicate child runs");
    assert.deepEqual(second.results.map((entry) => entry.action), ["skipped", "skipped"]);
    const checked = await run({ root, batches: [], fromBatch: 1, throughBatch: 2, check: true });
    assert.equal(checked.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed paper receipt is durable and reruns without unlocking later batches from a failed bootstrap", async () => {
  const { root, plan } = await createFixture();
  let calls = 0;
  const spawnChild = async (_executable, args) => {
    calls += 1;
    const fromId = args[args.indexOf("--from") + 1];
    const batch = plan.batches.find((entry) => entry.fromId === fromId);
    return childResult(plan, batch, ["failed", "created"]);
  };
  try {
    const result = await run({ root, batches: [1] }, { spawnChild });
    assert.equal(result.ok, false);
    assert.equal(result.results[0].state, "failed");
    assert.deepEqual(result.results[0].failedPaperIds, ["paper-a"]);
    const status = await run({ root, batches: [1], status: true });
    assert.equal(status.results[0].state, "failed");
    await assert.rejects(run({ root, batches: [2] }, { spawnChild }), /Batch 1 must have a verified successful receipt/);
    await run({ root, batches: [1] }, { spawnChild });
    assert.equal(calls, 2, "failed receipts are retried");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tampered log invalidates a receipt and check remains read-only", async () => {
  const { root, plan } = await createFixture();
  try {
    await run({ root, batches: [1] }, { spawnChild: async () => childResult(plan, plan.batches[0]) });
    const logPath = path.join(root, ...plan.batches[0].logPath.split("/"));
    await writeFile(logPath, "tampered\n", "utf8");
    const inspected = await inspectReceipt({ root, plan, batch: plan.batches[0] });
    assert.equal(inspected.state, "stale");
    assert.match(inspected.reason, /hash mismatch/);
    const before = await readFile(logPath, "utf8");
    await assert.rejects(
      run({ root, batches: [1], check: true }),
      /receipts are incomplete: \{"stale":1\}/
    );
    assert.equal(await readFile(logPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
