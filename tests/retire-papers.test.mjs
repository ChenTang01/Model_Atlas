import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  calculateRetirementExpectations,
  parseCli,
  pruneImportMetadata,
  verifyArchiveContents
} from "../scripts/retire-papers.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

test("retirement CLI accepts custom prepare operations and archive-only verification", () => {
  const prepare = parseCli([
    "prepare",
    "--ids", "model-1,lit-1",
    "--quarantine", "archive",
    "--operation", "retire-mixed-records"
  ]);
  assert.deepEqual(prepare.ids, ["model-1", "lit-1"]);
  assert.equal(prepare.operation, "retire-mixed-records");
  assert.equal(parseCli(["verify-archive", "--quarantine", "archive"]).command, "verify-archive");
  const checkpoint = parseCli(["checkpoint", "--quarantine", "archive", "--step", "workbookPruned"]);
  assert.equal(checkpoint.step, "workbookPruned");
  assert.throws(
    () => parseCli(["verify", "--quarantine", "archive", "--operation", "not-allowed"]),
    /supported only by prepare/
  );
  assert.throws(() => parseCli(["prepare", "--ids", "model-1", "--quarantine"]), /requires a value/);
  assert.throws(
    () => parseCli(["prepare", "--ids", "model-1", "--quarantine", "archive", "--operation", "bad operation"]),
    /must be a 1-128 character identifier/
  );
  assert.throws(() => parseCli(["checkpoint", "--quarantine", "archive", "--step", "wrong"]), /checkpoint requires/);
});

test("retirement expectations use actual detail levels and imported-record matches", () => {
  const literatureSha = hash("literature");
  const modelSha = hash("model");
  const records = [
    {
      id: "lit-1",
      detailLevel: "literature",
      doi: "https://doi.org/10.1000/LIT",
      pdfSha256: literatureSha,
      pdfBytes: 120,
      pdfPageCount: 8,
      inventoryParserWarning: true,
      fallbackUsed: false,
      extractionParserWarning: true
    },
    {
      id: "model-1",
      detailLevel: "model_map",
      doi: "10.1000/model",
      pdfSha256: modelSha,
      pdfBytes: 280,
      pdfPageCount: 12,
      inventoryParserWarning: false,
      fallbackUsed: true,
      extractionParserWarning: false
    }
  ];
  const result = calculateRetirementExpectations({
    catalog: { records: [
      { id: "lit-1", detail_level: "literature" },
      { id: "lit-2", detail_level: "literature" },
      { id: "model-1", detail_level: "model_map" },
      { id: "model-2", detail_level: "model_map" }
    ] },
    manifest: { counts: { bytes: 1000, pages: 50, parserWarningPdfs: 3 } },
    visualSample: { corpus: { fallbackSelected: 4, parserWarnings: 5 } },
    imported: { records: [
      { doi: "10.1000/lit", sha256: literatureSha },
      { doi: "10.1000/keep", sha256: hash("keep") }
    ] },
    importAudit: { mappings: [
      { doi: "10.1000/lit", sha256: literatureSha },
      { sha256: modelSha },
      { doi: "10.1000/keep", sha256: hash("keep") }
    ] },
    records
  });

  assert.deepEqual(result.expectedRemoval.detailLevels, { literature: 1, model_map: 1 });
  assert.equal(result.expectedRemoval.literature, 1);
  assert.equal(result.expectedRemoval.modelMaps, 1);
  assert.equal(result.expectedRemoval.importManifestRecords, 1);
  assert.equal(result.expectedRemoval.importAuditMappings, 2);
  assert.equal(result.expectedRemoval.pdfBytes, 400);
  assert.equal(result.expectedRemoval.pdfPages, 20);
  assert.deepEqual(result.expectedAfter, {
    records: 2,
    literature: 1,
    modelMaps: 1,
    pdfBytes: 600,
    pdfPages: 30,
    parserWarningPdfs: 2,
    fallbackSelected: 3,
    visualParserWarnings: 4,
    importManifestRecords: 1,
    importAuditMappings: 1
  });
});

test("import pruning validates distinct manifest/audit removals and remains idempotent", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-retire-imports-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const importRoot = path.join(root, "data", "imports", "atlas_literature_2016_present");
  const literatureSha = hash("literature");
  const modelSha = hash("model");
  const keepSha = hash("keep");
  await writeJson(path.join(importRoot, "final_included_manifest.json"), {
    count: 2,
    records: [
      { doi: "10.1000/lit", sha256: literatureSha },
      { doi: "10.1000/keep", sha256: keepSha }
    ]
  });
  await writeJson(path.join(importRoot, "IMPORT_AUDIT.json"), {
    mappings: [
      { doi: "10.1000/lit", sha256: literatureSha, disposition: "copied-new" },
      { sha256: modelSha, disposition: "reused-identical-existing-pdf" },
      { doi: "10.1000/keep", sha256: keepSha, disposition: "copied-new" }
    ]
  });
  const plan = {
    paperIds: ["lit-1", "model-1"],
    records: [
      { id: "lit-1", doi: "10.1000/lit", pdfSha256: literatureSha },
      { id: "model-1", doi: "10.1000/model", pdfSha256: modelSha }
    ],
    expectedRemoval: { importManifestRecords: 1, importAuditMappings: 2 },
    expectedAfter: { records: 2, importManifestRecords: 1, importAuditMappings: 1 }
  };

  await pruneImportMetadata(root, plan);
  await pruneImportMetadata(root, plan);
  const manifest = JSON.parse(await readFile(path.join(importRoot, "final_included_manifest.json"), "utf8"));
  const audit = JSON.parse(await readFile(path.join(importRoot, "IMPORT_AUDIT.json"), "utf8"));
  assert.deepEqual(manifest.records.map((entry) => entry.doi), ["10.1000/keep"]);
  assert.deepEqual(audit.mappings.map((entry) => entry.doi), ["10.1000/keep"]);
  assert.equal(audit.source_manifest_records, 1);
});

test("import pruning accepts legacy plans that expected one imported record per paper", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-retire-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const importRoot = path.join(root, "data", "imports", "atlas_literature_2016_present");
  const retired = [hash("retired-a"), hash("retired-b")];
  const keepSha = hash("keep");
  const mappings = [
    { doi: "10.1000/a", sha256: retired[0], disposition: "copied-new" },
    { doi: "10.1000/b", sha256: retired[1], disposition: "copied-new" },
    { doi: "10.1000/keep", sha256: keepSha, disposition: "copied-new" }
  ];
  await writeJson(path.join(importRoot, "final_included_manifest.json"), { count: 3, records: mappings });
  await writeJson(path.join(importRoot, "IMPORT_AUDIT.json"), { mappings });
  const plan = {
    paperIds: ["a", "b"],
    records: [
      { id: "a", doi: "10.1000/a", pdfSha256: retired[0] },
      { id: "b", doi: "10.1000/b", pdfSha256: retired[1] }
    ],
    expectedAfter: { records: 1, importManifestRecords: 1 }
  };

  await pruneImportMetadata(root, plan);
  const manifest = JSON.parse(await readFile(path.join(importRoot, "final_included_manifest.json"), "utf8"));
  const audit = JSON.parse(await readFile(path.join(importRoot, "IMPORT_AUDIT.json"), "utf8"));
  assert.equal(manifest.records.length, 1);
  assert.equal(audit.mappings.length, 1);
});

test("archive-only verification checks retired and baseline hashes without a live corpus", async (t) => {
  const quarantine = await mkdtemp(path.join(os.tmpdir(), "atlas-retire-archive-"));
  t.after(() => rm(quarantine, { recursive: true, force: true }));
  const retiredA = Buffer.from("retired-a");
  const retiredB = Buffer.from("retired-b");
  const baseline = Buffer.from("baseline");
  await mkdir(path.join(quarantine, "retired", "data"), { recursive: true });
  await mkdir(path.join(quarantine, "baseline", "data"), { recursive: true });
  await writeFile(path.join(quarantine, "retired", "data", "a.json"), retiredA);
  await writeFile(path.join(quarantine, "retired", "data", "b.json"), retiredB);
  await writeFile(path.join(quarantine, "baseline", "data", "catalog.json"), baseline);
  await writeJson(path.join(quarantine, "retirement-plan.json"), {
    operation: "test-retirement",
    paperIds: ["a", "b"],
    records: [{ id: "a" }, { id: "b" }],
    moveEntries: [
      { relativePath: "data/a.json", type: "file", bytes: retiredA.length, sha256: hash(retiredA) },
      { relativePath: "data/b.json", type: "file", bytes: retiredB.length, sha256: hash(retiredB) }
    ],
    backups: [
      { relativePath: "data/catalog.json", bytes: baseline.length, sha256: hash(baseline) }
    ]
  });

  const result = await verifyArchiveContents(quarantine);
  assert.equal(result.retiredFiles, 2);
  assert.equal(result.backups, 1);
  await writeFile(path.join(quarantine, "retired", "data", "a.json"), "tampered");
  await assert.rejects(() => verifyArchiveContents(quarantine), /Quarantine digest mismatch: data\/a\.json/);
});
