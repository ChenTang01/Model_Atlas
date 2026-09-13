import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { checkPublicContent } from "../scripts/check-public-content.mjs";

const execFileAsync = promisify(execFile);
const ignoreRules = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-public-content-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileAsync("git", args, { cwd: root, windowsHide: true });
  const write = async (name, content) => {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  };
  await git("init", "--quiet");
  await write(".gitignore", ignoreRules);
  await git("add", ".gitignore");
  return { root, git, write };
}

test("ignored local papers remain on disk while ordinary project metadata passes", async (t) => {
  const { root, git, write } = await fixture(t);
  await write("paper/source.PdF", "%PDF-1.7\nsynthetic test fixture\n");
  await write("data/corpus.json", JSON.stringify({ path: "paper/source.PdF", title: "Original metadata" }));
  await git("add", "--all");
  assert.deepEqual((await checkPublicContent(root)).violations, []);
  assert.match(await readFile(path.join(root, "paper/source.PdF"), "utf8"), /synthetic test fixture/u);
});

test("force-added mixed-case PDFs anywhere and local extraction/page-image areas fail", async (t) => {
  const { root, git, write } = await fixture(t);
  const paths = [
    "paper/source.pdf", "docs/SOURCE.PDF", "mini-atlas/paper/copy.PdF",
    "research/ledger/artifacts/example/pages.json",
    "research/ledger/extraction-repair-candidates/example/text.txt",
    "research/ledger/extraction-repair-visual-qa/example/page.png",
    "research/ledger/attempts/example/raw.txt",
    "research/ledger/retired-quarantine/example/source.txt",
    "mini-atlas/research/pages/example.json",
    "research/ledger/extra/nested/pages.json",
    "research/ledger/extra/text.txt"
  ];
  for (const filename of paths) await write(filename, "synthetic test fixture");
  await git("add", "--force", "--", ...paths);
  const result = await checkPublicContent(root);
  assert.deepEqual(result.violations.map(({ filename }) => filename).sort(), paths.sort());
});

test("renamed PDF bytes are detected in the index even when the worktree copy is replaced", async (t) => {
  const { root, git, write } = await fixture(t);
  const filename = "docs/renamed source.dat";
  await write(filename, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0, 255, 0]), Buffer.from("synthetic only\n")]));
  await git("add", "--", filename);
  await write(filename, "ordinary local text");
  const result = await checkPublicContent(root);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].filename, filename);
  assert.match(result.violations[0].reason, /PDF header/u);
});

test("removing a forced addition from the index passes and preserves its local bytes", async (t) => {
  const { root, git, write } = await fixture(t);
  await write("paper/source.pdf", "synthetic source fixture");
  await git("add", "--force", "paper/source.pdf");
  assert.equal((await checkPublicContent(root)).violations.length, 1);
  await git("rm", "--cached", "--", "paper/source.pdf");
  assert.deepEqual((await checkPublicContent(root)).violations, []);
  assert.equal(await readFile(path.join(root, "paper/source.pdf"), "utf8"), "synthetic source fixture");
});
