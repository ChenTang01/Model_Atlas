import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const html = await readFile(path.join(root, "about.html"), "utf8");

test("About focuses on what Atlas is, how to use it, and its Beta status", () => {
  assert.match(html, /<h2 id="whatTitle">What Atlas is<\/h2>/);
  assert.match(html, /<h2 id="useTitle">How to use Atlas<\/h2>/);
  assert.match(html, /<h2 id="betaTitle">About the Beta version<\/h2>/);
  assert.match(html, /Each point in the galaxy represents a research paper/);
  assert.match(html, /Choose a subject to highlight its neighborhood/);
  assert.match(html, /Drag to orbit, scroll or pinch to zoom/);
  assert.match(html, /Search for a modeling idea, title, author, or DOI/);
  assert.match(html, /Atlas is currently in Beta, which means it is a testing version/);
  assert.match(html, /not a substitute for reading the paper/);
  assert.match(html, /Verify definitions, equations, assumptions, proofs, and results/);
});

test("About hides project artifacts and internal workflow details", () => {
  for (const hiddenCopy of [
    "Project artifacts",
    "Canonical catalog index",
    "Current structured-note release",
    "Bibliography for the active corpus",
    "Restartable research workflow",
    "Collection and provenance notes",
    "Research workflow"
  ]) {
    assert.doesNotMatch(html, new RegExp(hiddenCopy, "i"));
  }
  assert.doesNotMatch(html, /data-atlas-count|coverageStatus|data-atlas-year/);
  assert.doesNotMatch(html, /assets\/(?:data-loader|about)\.js/);
});

test("About retains accessible standalone navigation", () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /class="skip-link" href="#aboutContent"/);
  assert.match(html, /id="aboutContent"[^>]*tabindex="-1"/);
  assert.match(html, /<nav[^>]*aria-label="Atlas navigation"/);
  assert.match(html, /<a href="index\.html">← Back to the galaxy<\/a>/);
});
