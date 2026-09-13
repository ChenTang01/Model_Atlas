import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderSnapshot } from "../scripts/build-data.mjs";
import {
  sanitizeMetadataValue,
  sanitizePayload,
  TITLE_ABSTRACT_INFERENCE_SUFFIX
} from "../scripts/sanitize-english-metadata.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = path.join(root, "scripts", "sanitize-english-metadata.mjs");

function fixturePayload() {
  return {
    schema_version: "fixture",
    records: [
      {
        id: "paper-one",
        title: "A title that remains untouched",
        topics: [`Marketing/RM${TITLE_ABSTRACT_INFERENCE_SUFFIX}`, "Pricing"],
        topic_details: [`OM/Analytics${TITLE_ABSTRACT_INFERENCE_SUFFIX}`],
        field: `IS${TITLE_ABSTRACT_INFERENCE_SUFFIX}`
      }
    ]
  };
}

test("known title/abstract inference provenance is removed only from target metadata", () => {
  const input = fixturePayload();
  const { payload, report } = sanitizePayload(input);
  assert.deepEqual(payload.records[0].topics, ["Marketing/RM", "Pricing"]);
  assert.deepEqual(payload.records[0].topic_details, ["OM/Analytics"]);
  assert.equal(payload.records[0].field, "IS");
  assert.equal(payload.records[0].title, input.records[0].title);
  assert.deepEqual(report, {
    records: 1,
    changedRecords: 1,
    replacements: 3,
    byField: { topics: 1, topic_details: 1, field: 1 }
  });

  const second = sanitizePayload(payload);
  assert.deepEqual(second.payload, payload, "sanitization is idempotent");
  assert.equal(second.report.replacements, 0);
});

test("unrecognized Chinese text in a target field fails closed", () => {
  const input = fixturePayload();
  input.records[0].field = "IS（未知来源）";
  assert.throws(() => sanitizePayload(input), /unrecognized non-English metadata remains/);
  assert.deepEqual(sanitizeMetadataValue(42), { value: 42, replacements: 0 });
});

test("CLI check detects stale source or snapshot and the write path repairs both", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-metadata-sanitizer-"));
  try {
    const dataDir = path.join(temporaryRoot, "data");
    await mkdir(dataDir, { recursive: true });
    const input = fixturePayload();
    await writeFile(path.join(dataDir, "atlas_articles.json"), `${JSON.stringify(input, null, 2)}\n`, "utf8");
    await writeFile(path.join(dataDir, "atlas_articles.js"), renderSnapshot(input), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath, "--check", "--root", temporaryRoot, "--json"]),
      (error) => {
        const report = JSON.parse(error.stdout);
        assert.equal(report.ok, false);
        assert.equal(report.sourceMatches, false);
        assert.equal(report.snapshotMatches, false);
        return true;
      }
    );

    await execFileAsync(process.execPath, [scriptPath, "--root", temporaryRoot, "--json"]);
    const checked = await execFileAsync(process.execPath, [scriptPath, "--check", "--root", temporaryRoot, "--json"]);
    const report = JSON.parse(checked.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.replacements, 0);

    const saved = JSON.parse(await readFile(path.join(dataDir, "atlas_articles.json"), "utf8"));
    assert.equal(saved.records[0].field, "IS");
    assert.equal(
      await readFile(path.join(dataDir, "atlas_articles.js"), "utf8"),
      renderSnapshot(saved)
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
