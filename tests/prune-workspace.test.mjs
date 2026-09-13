import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { __test } from "../scripts/prune-workspace.mjs";

const ACTIVE_EXTRACT = "a".repeat(64);
const ACTIVE_READING = "b".repeat(64);
const ACTIVE_REPAIR_BASE = "c".repeat(64);
const ORPHAN = "d".repeat(64);
const ACTIVE_QA = "e".repeat(64);
const STALE_QA = "f".repeat(64);
const MANIFEST = "research/ledger/workspace-prune-plan.v1.json";

async function put(root, relativePath, content = "fixture\n") {
  const absolute = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function putJson(root, relativePath, value) {
  await put(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(root, relativePath) {
  try {
    await readFile(path.join(root, ...relativePath.split("/")));
    return true;
  } catch (error) {
    if (error.code === "EISDIR" || error.code === "EPERM") return true;
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-prune-test-"));
  await put(root, "tmp/session/scratch.txt", "temporary");
  await put(root, "node_modules/.package-map.json", "package map");
  await put(root, "node_modules/.pnpm-workspace-state-v1.json", "workspace state");
  await put(root, "node_modules/a-package/index.js", "keep package");
  await put(root, "scripts/__pycache__/worker.pyc", "bytecode");
  await put(root, "data/notes/papers/paper.json", "published note");
  await put(root, "data/notes/papers/paper.json.writer.tmp", "abandoned write");

  await put(root, "mini-atlas/README.md", "Mini\n");
  await putJson(root, "mini-atlas/data/atlas.json", { keep: true });
  await put(root, "mini-atlas/data/math-notations.js", "export default {};");
  await putJson(root, "mini-atlas/data/notes/paper.json", { keep: true });
  await putJson(root, "mini-atlas/research/pages/paper.json", { keep: true });
  await putJson(root, "mini-atlas/research/sample.json", { keep: true });
  await put(root, "mini-atlas/index.html", "old site");
  await put(root, "mini-atlas/assets/old.css", "old css");
  await put(root, "mini-atlas/data/atlas.js", "duplicate");
  await put(root, "mini-atlas/research/text/paper.txt", "old extraction");

  for (let version = 1; version <= 5; version += 1) {
    const logDirectory = `research/ledger/logs/old-v${version}`;
    await putJson(root, `research/ledger/authoring-plan.v${version}.json`, { configuration: { logDirectory } });
    await put(root, `${logDirectory}/batch.log`, `old ${version}`);
  }
  await putJson(root, "research/ledger/authoring-plan.release-v20.json", { configuration: { logDirectory: "research/ledger/logs/model-note-authoring-release-v20" } });
  await put(root, "research/ledger/logs/model-note-authoring-release-v20/current.log", "current");
  await put(root, "research/ledger/.claims/.gitkeep", "");
  await putJson(root, "research/ledger/attempts/run-1/result.json", { complete: true });

  const artifact = (digest, file) => `research/ledger/artifacts/paper-a/${digest}/${file}`;
  await putJson(root, artifact(ACTIVE_EXTRACT, "pages.json"), { pages: [1] });
  await putJson(root, artifact(ACTIVE_READING, "reading-packet.json"), { source: artifact(ACTIVE_EXTRACT, "pages.json") });
  await put(root, artifact(ACTIVE_REPAIR_BASE, "text.txt"), "base extraction");
  await putJson(root, artifact(ORPHAN, "pages.json"), { obsolete: true });
  await putJson(root, "research/ledger/papers/paper-a.json", {
    extraction: artifact(ACTIVE_EXTRACT, "pages.json"),
    readingPacket: artifact(ACTIVE_READING, "reading-packet.json"),
    repairPromotion: { baseExtraction: artifact(ACTIVE_REPAIR_BASE, "text.txt") },
    extractionQaDecisionPath: `research/ledger/extraction-qa/paper-a/${ACTIVE_QA}.json`,
  });
  await putJson(root, "research/ledger/paper-ledger-canonicalization-quarantine/run/plan.json", { complete: true });
  await putJson(root, "research/ledger/benchmarks/old.json", { stale: true });
  await putJson(root, "research/ledger/performance/old.json", { stale: true });
  await put(root, "research/ledger/logs/mini-parity-condition-v20-affected-papers.txt", "old worklist");
  await putJson(root, `research/ledger/extraction-qa/paper-a/${ACTIVE_QA}.json`, { active: true });
  await putJson(root, `research/ledger/extraction-qa/paper-a/${STALE_QA}.json`, { stale: true });

  await putJson(root, "research/corpus/manifest.v1.json", { papers: ["paper-a"] });
  await putJson(root, "research/ledger/extraction-visual-scope-review.v1.json", { active: artifact(ACTIVE_EXTRACT, "pages.json") });
  await putJson(root, "research/ledger/safe-map-qa-provenance-rebind/tx/commit.json", { committed: true });
  await putJson(root, "data/atlas_articles.json", [{ id: "paper-a" }]);
  await putJson(root, "data/model_notes.json", [{ id: "paper-a" }]);
  await putJson(root, "data/notes/release-candidate/model_notes.json", [{ id: "paper-a" }]);
  await putJson(root, "data/notes/release-candidate/audit.v1.json", { ok: true });
  return root;
}

test("plan is precise, preserves active data, hashes targets, and resumes", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await __test.createPlanCore(root, MANIFEST);
  assert.equal(first.resumed, false);
  assert.match(first.plan.planSha256, /^[a-f0-9]{64}$/);
  assert.ok(first.plan.targets.every((target) => target.reason && target.bytes >= 0 && /^[a-f0-9]{64}$/.test(target.sha256)));

  const targets = new Set(first.plan.targets.map((target) => target.path));
  assert.ok(targets.has("tmp"));
  assert.ok(targets.has("research/ledger/attempts"));
  assert.ok(targets.has("scripts/__pycache__"));
  assert.ok(targets.has("data/notes/papers/paper.json.writer.tmp"));
  assert.ok(targets.has("research/ledger/paper-ledger-canonicalization-quarantine"));
  assert.ok(targets.has("research/ledger/benchmarks"));
  assert.ok(targets.has("research/ledger/performance"));
  assert.ok(targets.has("research/ledger/logs/mini-parity-condition-v20-affected-papers.txt"));
  assert.ok(targets.has(`research/ledger/extraction-qa/paper-a/${STALE_QA}.json`));
  assert.ok(targets.has(`research/ledger/artifacts/paper-a/${ORPHAN}`));
  assert.ok(targets.has("mini-atlas/assets"));
  assert.ok(targets.has("mini-atlas/data/atlas.js"));
  assert.ok(targets.has("research/ledger/authoring-plan.v1.json"));
  assert.ok(targets.has("research/ledger/logs/old-v5"));

  for (const kept of [
    "mini-atlas/data/atlas.json",
    "mini-atlas/data/notes/paper.json",
    "mini-atlas/research/pages/paper.json",
    "research/ledger/authoring-plan.release-v20.json",
    "research/ledger/logs/model-note-authoring-release-v20/current.log",
    `research/ledger/artifacts/paper-a/${ACTIVE_EXTRACT}`,
    `research/ledger/artifacts/paper-a/${ACTIVE_READING}`,
    `research/ledger/artifacts/paper-a/${ACTIVE_REPAIR_BASE}`,
    `research/ledger/extraction-qa/paper-a/${ACTIVE_QA}.json`,
    "data/model_notes.json",
    "data/notes/release-candidate/model_notes.json",
    "research/ledger/.claims",
  ]) {
    assert.equal([...targets].some((target) => kept === target || kept.startsWith(`${target}/`)), false, kept);
  }

  const firstBytes = await readFile(path.join(root, ...MANIFEST.split("/")), "utf8");
  const second = await __test.createPlanCore(root, MANIFEST);
  assert.equal(second.resumed, true);
  assert.equal(await readFile(path.join(root, ...MANIFEST.split("/")), "utf8"), firstBytes);
});

test("apply is restartable after interruption and verify checks retained paths", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { plan } = await __test.createPlanCore(root, MANIFEST);
  await assert.rejects(
    __test.applyPlanCore(root, MANIFEST, { afterDelete: async () => { throw new Error("simulated interruption"); } }),
    /simulated interruption/,
  );
  const result = await __test.applyPlanCore(root, MANIFEST);
  assert.equal(result.removed + result.alreadyAbsent, plan.targets.length);
  assert.deepEqual(await __test.verifyPlanCore(root, MANIFEST), {
    verifiedTargets: plan.targets.length,
    verifiedRetained: plan.retained.length,
  });
  assert.equal(await exists(root, "mini-atlas/data/atlas.json"), true);
  assert.equal(await exists(root, "research/ledger/.claims/.gitkeep"), true);
  assert.equal(await exists(root, `research/ledger/artifacts/paper-a/${ACTIVE_REPAIR_BASE}/text.txt`), true);
});

test("apply aborts before deleting anything when a planned target changed", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { plan } = await __test.createPlanCore(root, MANIFEST);
  await put(root, "tmp/session/new-after-plan.txt", "mutation");
  await assert.rejects(__test.applyPlanCore(root, MANIFEST), /changed since plan: tmp/);
  const unaffected = plan.targets.find((target) => target.path !== "tmp");
  assert.equal(await exists(root, unaffected.path), true);
});

test("root and escaping paths are rejected; tmp junction is unlinked without traversal", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.throws(() => __test.canonicalRelative("."), /root|escaping/i);
  assert.throws(() => __test.canonicalRelative("../outside"), /root|escaping/i);
  assert.throws(() => __test.resolveInside(root, "C:\\outside"), /absolute/i);

  const outside = await mkdtemp(path.join(os.tmpdir(), "atlas-prune-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await put(outside, "sentinel.txt", "must survive");
  const link = path.join(root, "tmp", "escape-link");
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return;
    throw error;
  }
  const { plan } = await __test.createPlanCore(root, MANIFEST);
  const linkTarget = plan.targets.find((target) => target.path === "tmp/escape-link");
  assert.equal(linkTarget?.type, "link");
  assert.match(linkTarget.sha256, /^[a-f0-9]{64}$/);
  await __test.applyPlanCore(root, MANIFEST);
  assert.equal(await exists(outside, "sentinel.txt"), true);
  assert.equal(await exists(root, "tmp/escape-link"), false);
});

test("links outside tmp remain hard failures", async (t) => {
  const root = await makeFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const outside = await mkdtemp(path.join(os.tmpdir(), "atlas-prune-protected-link-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  try {
    await symlink(outside, path.join(root, "mini-atlas", "linked-old-site"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return;
    throw error;
  }
  await assert.rejects(__test.createPlanCore(root, MANIFEST), /Symbolic link rejected/);
});
