import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceURL = new URL("../data/atlas_articles.json", import.meta.url);
const snapshotURL = new URL("../data/atlas_articles.js", import.meta.url);

export function renderSnapshot(payload) {
  if (!payload || !Array.isArray(payload.records)) throw new Error("Collection records are missing");
  const json = JSON.stringify(payload)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return "// Generated from atlas_articles.json by node scripts/build-data.mjs. Do not edit.\n"
    + `globalThis.AtlasArticleSnapshot = ${json};\n`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Usage: node scripts/build-data.mjs [--check]");
  const payload = JSON.parse(await readFile(sourceURL, "utf8"));
  const expected = renderSnapshot(payload);
  if (args.includes("--check")) {
    const actual = await readFile(snapshotURL, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (actual !== expected) throw new Error("Local snapshot is out of date. Run node scripts/build-data.mjs");
    console.log(`Local snapshot matches all ${payload.records.length} JSON records.`);
  } else {
    await writeFile(snapshotURL, expected, "utf8");
    console.log(`Generated local snapshot with ${payload.records.length} records.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
