import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderSnapshot } from "./build-data.mjs";

export const SANITIZED_FIELDS = Object.freeze(["topics", "topic_details", "field"]);
export const TITLE_ABSTRACT_INFERENCE_SUFFIX = "（题名/摘要推断）";

const HAN_PATTERN = /\p{Script=Han}/u;

export function sanitizeMetadataValue(value) {
  if (typeof value !== "string") return { value, replacements: 0 };
  const pieces = value.split(TITLE_ABSTRACT_INFERENCE_SUFFIX);
  return {
    value: pieces.join("").replace(/\s{2,}/g, " ").trim(),
    replacements: pieces.length - 1
  };
}

function sanitizeFieldValue(value) {
  if (Array.isArray(value)) {
    let replacements = 0;
    const sanitized = value.map((item) => {
      const result = sanitizeMetadataValue(item);
      replacements += result.replacements;
      return result.value;
    });
    return { value: sanitized, replacements };
  }
  return sanitizeMetadataValue(value);
}

function assertEnglishTargetField(record, field) {
  const values = Array.isArray(record[field]) ? record[field] : [record[field]];
  for (const value of values) {
    if (typeof value === "string" && HAN_PATTERN.test(value)) {
      throw new Error(`${record.id || "unknown record"}.${field}: unrecognized non-English metadata remains: ${value}`);
    }
  }
}

export function sanitizePayload(input) {
  if (!input || !Array.isArray(input.records)) throw new Error("Collection records are missing");
  const payload = structuredClone(input);
  const byField = Object.fromEntries(SANITIZED_FIELDS.map((field) => [field, 0]));
  const changedRecords = new Set();

  for (const record of payload.records) {
    for (const field of SANITIZED_FIELDS) {
      if (!(field in record)) continue;
      const result = sanitizeFieldValue(record[field]);
      record[field] = result.value;
      byField[field] += result.replacements;
      if (result.replacements) changedRecords.add(record.id);
      assertEnglishTargetField(record, field);
    }
  }

  return {
    payload,
    report: {
      records: payload.records.length,
      changedRecords: changedRecords.size,
      replacements: Object.values(byField).reduce((sum, count) => sum + count, 0),
      byField
    }
  };
}

export function renderSource(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

async function atomicWrite(filename, content) {
  await mkdir(path.dirname(filename), { recursive: true });
  const current = await readFile(filename, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  if (current === content) return false;
  const temporary = `${filename}.${process.pid}-${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, filename);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return true;
}

function parseCli(argv) {
  const options = { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), check: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--root") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("--root requires a directory");
      options.root = path.resolve(value);
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export async function run(options) {
  const sourcePath = path.join(options.root, "data", "atlas_articles.json");
  const snapshotPath = path.join(options.root, "data", "atlas_articles.js");
  const sourceText = await readFile(sourcePath, "utf8");
  const { payload, report } = sanitizePayload(JSON.parse(sourceText));
  const expectedSource = renderSource(payload);
  const expectedSnapshot = renderSnapshot(payload);
  const snapshotText = await readFile(snapshotPath, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  const result = {
    ...report,
    checked: options.check,
    sourceMatches: sourceText === expectedSource,
    snapshotMatches: snapshotText === expectedSnapshot
  };

  if (options.check) {
    result.ok = result.sourceMatches && result.snapshotMatches;
    return result;
  }

  result.sourceWritten = await atomicWrite(sourcePath, expectedSource);
  result.snapshotWritten = await atomicWrite(snapshotPath, expectedSnapshot);
  result.ok = true;
  return result;
}

function usage() {
  return "Usage: node scripts/sanitize-english-metadata.mjs [--check] [--root DIR] [--json]";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseCli(process.argv.slice(2));
  if (options.help) console.log(usage());
  else run(options).then((result) => {
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (options.check) console.log(result.ok
      ? `English metadata and local snapshot are current for ${result.records} records.`
      : "English metadata or its local snapshot is stale; run node scripts/sanitize-english-metadata.mjs.");
    else console.log(`Sanitized ${result.replacements} provenance suffixes across ${result.changedRecords} records; regenerated the local snapshot.`);
    if (!result.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
