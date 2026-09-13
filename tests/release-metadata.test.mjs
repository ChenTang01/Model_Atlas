import assert from "node:assert/strict";
import test from "node:test";
import { releaseNotes } from "../scripts/check-release.mjs";

const changelog = "# Changelog\n\n## [Unreleased]\n\n- Next change.\n\n## [1.2.3] - 2026-09-13\n\n### Added\n\n- A concrete release change.\n\n## [1.2.2] - 2026-09-01\n\n- Previous release.\n";

test("release notes include only the matching dated version", () => {
  const notes = releaseNotes("1.2.3", changelog, "v1.2.3");
  assert.match(notes, /A concrete release change/u);
  assert.doesNotMatch(notes, /Next change|Previous release|Unreleased/u);
});

test("release publication rejects mismatched tags, absent history, and empty entries", () => {
  assert.throws(() => releaseNotes("1.2.3", changelog, "v9.9.9"), /does not match/u);
  assert.throws(() => releaseNotes("1.2.4", changelog, "v1.2.4"), /dated/u);
  assert.throws(() => releaseNotes("1.2.3", "## [1.2.3] - 2026-09-13\n", "v1.2.3"), /concrete change/u);
});
