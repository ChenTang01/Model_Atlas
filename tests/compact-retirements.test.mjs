import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyRetirementCompactionCore,
  createRetirementCompactionCore,
  verifyRetirementCompactionCore,
} from "../scripts/compact-retirements.mjs";

const ARCHIVES = [
  "2026-09-13-extraction-blockers-v1",
  "2026-09-13-pure-empirical-v1",
  "2026-09-13-release-blocker-v1",
];
const LEDGER = "research/corpus/paper-retirements.v1.json";
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function put(filename, content) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content);
}

async function putJson(filename, value) {
  await put(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(filename) {
  try {
    await readFile(filename);
    return true;
  } catch (error) {
    if (error.code === "EISDIR" || error.code === "EPERM") return true;
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function makeFixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "atlas-retirement-compact-"));
  const atlas = path.join(parent, "Atlas");
  const retired = path.join(parent, "Atlas-retired");
  await mkdir(atlas, { recursive: true });
  const workbook = Buffer.from("current workbook");
  await put(path.join(atlas, "atlas_game_theory_articles.xlsx"), workbook);
  await putJson(path.join(atlas, "data", "atlas_articles.json"), { records: [{ id: "keep" }] });
  await putJson(path.join(atlas, "research", "corpus", "manifest.v1.json"), { records: [{ id: "keep", pdf: { sha256: hash("keep") } }] });
  await put(path.join(atlas, "outputs", "workspace-cleanup-2026-09-13", "atlas_game_theory_articles.xlsx"), workbook);
  await put(path.join(atlas, "outputs", "workspace-cleanup-2026-09-13", "atlas_game_theory_articles.xlsx.inspect.ndjson"), "inspection\n");
  await putJson(path.join(atlas, "research", "ledger", "workbook-reconciliation-pure-empirical-v1.json"), { operation: "reconcile", rows: { removed: ["retired-2"] } });
  await putJson(path.join(atlas, "research", "ledger", "workbook-reconciliation-release-blocker-v1.json"), { operation: "reconcile", rows: { removed: ["retired-3"] } });

  for (let index = 0; index < ARCHIVES.length; index += 1) {
    const name = ARCHIVES[index];
    const id = `retired-${index + 1}`;
    const archive = path.join(retired, name);
    const retiredBytes = Buffer.from(`retired payload ${id}`);
    const baselineBytes = Buffer.from(`baseline ${id}`);
    await put(path.join(archive, "retired", "data", `${id}.json`), retiredBytes);
    await put(path.join(archive, "baseline", "data", "catalog.json"), baselineBytes);
    await putJson(path.join(archive, "retirement-plan.json"), {
      schemaVersion: 1,
      operation: `operation-${index + 1}`,
      status: "complete",
      preparedAt: "2026-09-13T00:00:00.000Z",
      completedAt: "2026-09-13T01:00:00.000Z",
      paperIds: [id],
      source: { catalogRecords: 4 - index },
      expectedAfter: { records: 3 - index },
      records: [{
        id,
        doi: `10.1000/${id}`,
        bibkey: id,
        title: `Retired ${index + 1}`,
        detailLevel: "literature",
        pdfFile: `${id}.pdf`,
        pdfSha256: hash(`pdf ${id}`),
        pdfBytes: 100 + index,
        pdfPageCount: 10 + index,
      }],
      moveEntries: [{ relativePath: `data/${id}.json`, type: "file", bytes: retiredBytes.length, sha256: hash(retiredBytes) }],
      backups: [{ relativePath: "data/catalog.json", bytes: baselineBytes.length, sha256: hash(baselineBytes) }],
    });
  }
  return { parent, atlas, retired };
}

test("compaction preserves a hash-bound identity ledger and removes only planned archives and duplicates", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.parent, { recursive: true, force: true }));
  const { ledger, resumed } = await createRetirementCompactionCore(fixture.atlas, fixture.retired, LEDGER);
  assert.equal(resumed, false);
  assert.equal(ledger.retirementCount, 3);
  assert.equal(ledger.batches.length, 3);
  assert.equal(ledger.workbookReconciliation.length, 2);
  assert.match(ledger.ledgerSha256, /^[a-f0-9]{64}$/);
  assert.equal((await createRetirementCompactionCore(fixture.atlas, fixture.retired, LEDGER)).resumed, true);

  await assert.rejects(
    applyRetirementCompactionCore(fixture.atlas, fixture.retired, LEDGER, { afterDelete: async () => { throw new Error("interrupted"); } }),
    /interrupted/,
  );
  const result = await applyRetirementCompactionCore(fixture.atlas, fixture.retired, LEDGER);
  assert.equal(result.removed + result.alreadyAbsent, result.total);
  assert.deepEqual(await verifyRetirementCompactionCore(fixture.atlas, fixture.retired, LEDGER), { verifiedTargets: 6, retiredPapers: 3 });
  assert.equal(await exists(path.join(fixture.atlas, "atlas_game_theory_articles.xlsx")), true);
  assert.equal(await exists(path.join(fixture.atlas, ...LEDGER.split("/"))), true);
  assert.equal(await exists(fixture.retired), false);
  assert.equal(await exists(path.join(fixture.atlas, "outputs")), false);
});

test("compaction aborts before deletion when a target changes after planning", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.parent, { recursive: true, force: true }));
  await createRetirementCompactionCore(fixture.atlas, fixture.retired, LEDGER);
  await put(path.join(fixture.atlas, "outputs", "unexpected.txt"), "changed");
  await assert.rejects(
    applyRetirementCompactionCore(fixture.atlas, fixture.retired, LEDGER),
    /changed after planning/,
  );
  assert.equal(await exists(path.join(fixture.retired, ARCHIVES[0], "retirement-plan.json")), true);
});
