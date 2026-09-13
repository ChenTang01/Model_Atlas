import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function privateContentReason(filename) {
  const normalized = filename.replaceAll("\\", "/");
  if (/\.pdf$/iu.test(normalized)) return "PDF files must remain local";
  if (/^(?:mini-atlas\/)?paper\//iu.test(normalized)
      && !/^(?:mini-atlas\/)?paper\/(?:README\.md|\.gitkeep)$/iu.test(normalized)) {
    return "source-paper directories must remain local";
  }
  if (/^research\/ledger\/(?:artifacts|extraction-repair-candidates|extraction-repair-visual-qa|attempts|[^/]*quarantine[^/]*)\//iu.test(normalized)) {
    return "extracted text, page images, and temporary research artifacts must remain local";
  }
  if (/^mini-atlas\/research\/pages\//iu.test(normalized)
      || /^research\/ledger\/(?:.*\/)?(?:pages\.json|text\.txt)$/iu.test(normalized)) {
    return "full-page source reproductions must remain local";
  }
  return null;
}

export async function checkPublicContent(root = projectRoot) {
  const options = { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true };
  // Inspect the index: ignored files force-added to Git still fail, and staged
  // removals pass without deleting the maintainer's local source corpus.
  const { stdout } = await execFileAsync("git", ["ls-files", "--cached", "-z"], options);
  const files = [...new Set(stdout.split("\0").filter(Boolean))];
  const violations = new Map(files.flatMap((filename) => {
    const reason = privateContentReason(filename);
    return reason ? [[filename, reason]] : [];
  }));
  // Git searches staged bytes, including binary blobs. This catches a PDF
  // renamed to .bin/.dat or a clean worktree copy masking a staged PDF.
  try {
    const result = await execFileAsync("git", [
      "grep", "--cached", "--files-with-matches", "--null", "--no-textconv",
      "-e", "^[[:space:]]*%PDF-[0-9][.][0-9]", "--"
    ], options);
    for (const filename of result.stdout.split("\0").filter(Boolean)) {
      violations.set(filename, "PDF header found in staged content; source papers must remain local");
    }
  } catch (error) {
    if (error.code !== 1) throw error; // Git grep returns 1 when nothing matches.
  }
  return { checkedFiles: files.length, violations: [...violations].map(([filename, reason]) => ({ filename, reason })) };
}

async function main() {
  if (process.argv.length > 2) throw new Error("Usage: node scripts/check-public-content.mjs");
  const result = await checkPublicContent();
  if (result.violations.length) {
    const details = result.violations.map(({ filename, reason }) => `- ${JSON.stringify(filename)}: ${reason}`).join("\n");
    throw new Error(`Public-content check failed (${result.violations.length} files):\n${details}\nRemove these files from the Git index with git rm --cached, preserving local copies.`);
  }
  console.log(`Public-content check passed for ${result.checkedFiles} indexed files. No PDFs or local extraction directories are tracked.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
