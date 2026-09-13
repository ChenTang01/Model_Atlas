import assert from "node:assert/strict";
import test from "node:test";

import { parseCli, percentile, summarizeRuns } from "../scripts/benchmark-full-atlas.mjs";

test("benchmark CLI keeps candidate, viewport, and run configuration explicit", () => {
  const options = parseCli(["--model-notes-dir", "data/notes/release-candidate", "--runs", "5", "--profile", "mobile390", "--profile", "desktop", "--force", "--json"]);
  assert.equal(options.modelNotesDir, "data/notes/release-candidate");
  assert.equal(options.runs, 5);
  assert.deepEqual(options.profiles, ["mobile390", "desktop"]);
  assert.equal(options.force, true);
  assert.equal(options.json, true);
  assert.throws(() => parseCli(["--runs", "0"]), /positive integer/);
  assert.throws(() => parseCli(["--profile", "tablet"]), /Unknown --profile/);
});

test("benchmark summaries use stable interpolated percentiles", () => {
  assert.equal(percentile([30, 10, 20], 0.5), 20);
  assert.equal(percentile([10, 20], 0.5), 15);
  const runs = [10, 20, 30].map((value) => ({
    startup: { readyMs: value, domContentLoadedMs: value / 2, loadMs: value, searchIndexMs: value + 1, galaxyLayoutMs: value + 2, initialPayloadBytes: 1000, heapUsedBytes: 2000 },
    queries: { "game theory": { durationMs: value + 3 }, "startegic consumers": { durationMs: value + 4 } },
    panels: { allResultsDurationMs: value + 5, heapUsedBytes: 3000 },
    detail: { readyMs: value + 6, mathReadyMs: value + 7 }
  }));
  const summary = summarizeRuns(runs);
  assert.equal(summary.runs, 3);
  assert.deepEqual(summary.metrics.readyMs, { min: 10, median: 20, p95: 29, max: 30 });
  assert.equal(summary.metrics.broadQueryMs.median, 23);
  assert.equal(summary.metrics.allPanelsHeapUsedBytes.median, 3000);
});
