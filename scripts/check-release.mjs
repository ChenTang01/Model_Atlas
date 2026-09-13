import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function releaseNotes(packageVersion, changelog, tag) {
  if (!/^\d+\.\d+\.\d+$/u.test(packageVersion)) throw new Error("Release version must use stable X.Y.Z semantic versioning.");
  if (tag !== `v${packageVersion}`) throw new Error(`Tag ${JSON.stringify(tag)} does not match package.json version v${packageVersion}.`);
  const sections = [...changelog.matchAll(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\r?$/gmu)];
  const section = sections.find((entry) => entry[1] === packageVersion);
  if (!section) throw new Error(`CHANGELOG.md must contain a dated ## [${packageVersion}] - YYYY-MM-DD section.`);
  const nextHeading = changelog.indexOf("\n## ", section.index + section[0].length);
  const notes = changelog.slice(section.index, nextHeading < 0 ? undefined : nextHeading).trim();
  if (!/^- \S/mu.test(notes)) throw new Error("The release changelog section must describe at least one concrete change.");
  return `${notes}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) throw new Error("Usage: node scripts/check-release.mjs vX.Y.Z [notes-output-file]");
  const [metadata, changelog] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8")
  ]);
  const notes = releaseNotes(metadata.version, changelog, args[0]);
  if (args[1]) await writeFile(args[1], notes, "utf8");
  console.log(`Release ${args[0]} matches package.json and its dated changelog entry.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
