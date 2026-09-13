import { createHash } from "node:crypto";
import { open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSnapshot } from "./build-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!sourceRoot || process.argv.length > 3) {
  throw new Error("Usage: node scripts/audit-migration.mjs <Atlas_Literature_2016_present directory>");
}

const normalizeDoi = (value) => String(value ?? "")
  .trim()
  .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
  .replace(/^doi:\s*/i, "")
  .toLowerCase();
const normalizeFile = (value) => String(value ?? "").normalize("NFKC").toLowerCase();

async function hashFile(filePath) {
  const handle = await open(filePath, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    let header = "";
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      if (!position) header = buffer.subarray(0, Math.min(5, bytesRead)).toString("ascii");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return { sha256: hash.digest("hex"), bytes: position, header };
  } finally {
    await handle.close();
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dataPath = path.join(root, "data", "atlas_articles.json");
const snapshotPath = path.join(root, "data", "atlas_articles.js");
const manifestPath = path.join(sourceRoot, "screening", "final_included_manifest.json");
const bibliographyPath = path.join(root, "reference.bib");
const workbookPath = path.join(root, "atlas_game_theory_articles.xlsx");
const paperDir = path.join(root, "paper");
const auditPath = path.join(root, "data", "imports", "atlas_literature_2016_present", "FINAL_MIGRATION_AUDIT.json");

const [payload, snapshot, manifest, bibliography, workbookInfo] = await Promise.all([
  readFile(dataPath, "utf8").then(JSON.parse),
  readFile(snapshotPath, "utf8"),
  readFile(manifestPath, "utf8").then(JSON.parse),
  readFile(bibliographyPath, "utf8"),
  stat(workbookPath)
]);

assert(payload.schema_version === "3.1", `Unexpected schema ${payload.schema_version}`);
assert(payload.records.length === 1674, `Expected 1674 records, found ${payload.records.length}`);
assert(payload.audit.records === 1674 && payload.audit.pdf_verified === 1674, "Dataset audit totals are inconsistent");
assert(payload.audit.model_maps === 304 && payload.audit.literature_records === 1370, "Record-tier totals are inconsistent");
assert(manifest.count === 1561 && manifest.records.length === 1561, "Source manifest total is inconsistent");
assert(snapshot === renderSnapshot(payload), "Direct-open JS snapshot is stale");
assert(workbookInfo.size > 1_000_000, "Merged workbook is unexpectedly small");

const recordsByDoi = new Map();
const ids = new Set();
const filenames = new Set();
const bibkeys = new Set();
for (const record of payload.records) {
  const doi = normalizeDoi(record.doi);
  assert(doi && !recordsByDoi.has(doi), `Duplicate or missing target DOI: ${doi}`);
  assert(record.id && !ids.has(record.id), `Duplicate or missing target ID: ${record.id}`);
  assert(record.bibkey && !bibkeys.has(String(record.bibkey).toLowerCase()), `Duplicate or missing target bibkey: ${record.bibkey}`);
  assert(path.basename(record.pdf_file) === record.pdf_file, `Unsafe PDF filename: ${record.pdf_file}`);
  const filename = normalizeFile(record.pdf_file);
  assert(!filenames.has(filename), `Duplicate target PDF filename: ${record.pdf_file}`);
  recordsByDoi.set(doi, record);
  ids.add(record.id);
  filenames.add(filename);
  bibkeys.add(String(record.bibkey).toLowerCase());
}

const targetPdfFiles = (await readdir(paperDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
  .map((entry) => entry.name);
assert(targetPdfFiles.length === payload.records.length, `Expected ${payload.records.length} target PDFs, found ${targetPdfFiles.length}`);
assert(targetPdfFiles.every((filename) => filenames.has(normalizeFile(filename))), "Target paper directory contains an orphan PDF");

console.log("Rehashing all 1,674 target PDFs...");
const targetChecks = await mapLimit(payload.records, 8, async (record, index) => {
  const observed = await hashFile(path.join(paperDir, record.pdf_file));
  assert(observed.header === "%PDF-", `Invalid target PDF header: ${record.pdf_file}`);
  assert(observed.sha256 === record.pdf_sha256, `Stored target hash mismatch: ${record.pdf_file}`);
  assert(observed.bytes === Number(record.pdf_bytes), `Stored target byte mismatch: ${record.pdf_file}`);
  if ((index + 1) % 250 === 0) console.log(`  target ${index + 1}/${payload.records.length}`);
  return observed;
});

console.log("Rehashing all 1,561 source PDFs and checking DOI-to-target identity...");
let overlaps = 0;
let additions = 0;
const sourceChecks = await mapLimit(manifest.records, 8, async (source, index) => {
  const doi = normalizeDoi(source.doi);
  const target = recordsByDoi.get(doi);
  assert(target, `Source DOI missing from target: ${doi}`);
  const observed = await hashFile(path.resolve(source.pdf_path));
  assert(observed.header === "%PDF-", `Invalid source PDF header: ${source.filename}`);
  assert(observed.sha256 === String(source.sha256).toLowerCase(), `Source manifest hash mismatch: ${source.filename}`);
  assert(observed.bytes === Number(source.bytes), `Source manifest byte mismatch: ${source.filename}`);
  assert(target.pdf_sha256 === observed.sha256, `Source/target PDF mismatch for DOI ${doi}`);
  if (target.detail_level === "model_map") overlaps += 1;
  else additions += 1;
  if ((index + 1) % 250 === 0) console.log(`  source ${index + 1}/${manifest.records.length}`);
  return observed;
});
assert(overlaps === 191 && additions === 1370, `Unexpected source disposition: ${overlaps} overlaps, ${additions} additions`);

const bibEntries = [...bibliography.matchAll(/@[A-Za-z]+\s*\{\s*([^,\s]+)\s*,/g)].map((match) => match[1].toLowerCase());
assert(bibEntries.length === 1674 && new Set(bibEntries).size === 1674, "Bibliography does not contain 1,674 unique entries");
assert([...bibkeys].every((key) => bibEntries.includes(key)), "A record bibkey is missing from the bibliography");

const workbookHash = await hashFile(workbookPath);
const finalAudit = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  result: "passed",
  source_root_validated: sourceRoot,
  target_root: root,
  checks: {
    source_manifest_records: sourceChecks.length,
    source_hashes_verified: sourceChecks.length,
    source_dois_mapped_to_target: sourceChecks.length,
    reused_existing_identical_pdfs: overlaps,
    copied_distinct_pdfs: additions,
    target_records: payload.records.length,
    target_pdf_files: targetPdfFiles.length,
    target_hashes_verified: targetChecks.length,
    deep_model_maps: payload.audit.model_maps,
    evidence_indexed_records: payload.audit.literature_records,
    bibliography_entries: bibEntries.length,
    snapshot_exact_match: true,
    workbook_exists: true,
    orphan_pdfs: 0,
    missing_pdfs: 0,
    duplicate_dois: 0,
    duplicate_ids: 0,
    duplicate_pdf_filenames: 0
  },
  workbook: {
    path: "Atlas/atlas_game_theory_articles.xlsx",
    bytes: workbookHash.bytes,
    sha256: workbookHash.sha256
  },
  deletion_gate: "All content-identity and corpus-completeness checks passed. The validated source root may be deleted after web and workbook tests pass."
};
await writeFile(auditPath, `${JSON.stringify(finalAudit, null, 2)}\n`, "utf8");
console.log(`PASS: ${sourceChecks.length} source PDFs map by DOI and SHA-256 to ${targetChecks.length} target PDFs.`);
console.log(`Audit written to ${auditPath}`);
