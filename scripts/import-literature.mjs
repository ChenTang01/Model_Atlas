import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ATLAS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ATLAS_ROOT, "data", "atlas_articles.json");
const PAPER_DIR = path.join(ATLAS_ROOT, "paper");
const BIB_PATH = path.join(ATLAS_ROOT, "reference.bib");
const IMPORT_DIR = path.join(ATLAS_ROOT, "data", "imports", "atlas_literature_2016_present");
const LITERATURE_REVIEW_STATUS = "PDF-verified; scope-reviewed; evidence-indexed";
const MODEL_MAP_REVIEW_STATUS = "PDF-verified; independently audited";

const JOURNAL_CODES = new Map([
  ["Information Systems Research", "isr"],
  ["Management Science", "mnsc"],
  ["Manufacturing & Service Operations Management", "msom"],
  ["Marketing Science", "mksc"]
]);

const TOPICS = {
  platforms: {
    primary: "Platforms and marketplaces",
    family: "Platforms & networks",
    patterns: [
      [8, /\bplatforms?\b/], [8, /\bmarketplaces?\b/], [7, /\btwo[- ]sided\b/],
      [6, /\bnetwork effects?\b/], [5, /\bride[- ]hailing\b/], [5, /\bsocial media\b/],
      [5, /\bsharing economy\b/], [4, /\bapp stores?\b/], [4, /\bonline communit(?:y|ies)\b/]
    ]
  },
  information: {
    primary: "Information disclosure and learning",
    family: "Information & learning",
    patterns: [
      [8, /\binformation design\b/], [7, /\bdisclos(?:ure|e|ing)\b/], [7, /\bsignal(?:ing|ling|s)?\b/],
      [7, /\bprivate information\b/], [6, /\bbayesian (?:learning|persuasion|updating)\b/],
      [6, /\bonline reviews?\b/], [5, /\bprivacy\b/], [5, /\bforecast(?:ing|s)?\b/],
      [5, /\binformation sharing\b/], [4, /\buncertainty\b/], [4, /\blearning\b/]
    ]
  },
  pricing: {
    primary: "Pricing, consumers, and revenue management",
    family: "Pricing & consumers",
    patterns: [
      [8, /\bpricing\b/], [7, /\bprice discrimination\b/], [7, /\brevenue management\b/],
      [6, /\bconsumer(?:s|'s)?\b/], [6, /\bcustomer(?:s|'s)?\b/], [6, /\bassortment\b/],
      [5, /\bretail(?:er|ing|ers)?\b/], [5, /\badvertis(?:ing|ement|ements)\b/],
      [5, /\bproduct line\b/], [4, /\bdemand\b/], [4, /\bmarketing\b/], [4, /\bsales?\b/]
    ]
  },
  "supply-chains": {
    primary: "Operations and supply chains",
    family: "Supply chains & operations",
    patterns: [
      [9, /\bsupply chains?\b/], [8, /\binventor(?:y|ies)\b/], [8, /\bsupplier(?:s)?\b/],
      [7, /\bmanufactur(?:er|ing|ers)\b/], [7, /\bproduction\b/], [7, /\bqueue(?:ing|s)?\b/],
      [7, /\bscheduling\b/], [7, /\blogistics\b/], [6, /\bprocurement\b/],
      [6, /\brouting\b/], [6, /\bfulfillment\b/], [6, /\bcapacity\b/], [5, /\bservice operations\b/]
    ]
  },
  mechanisms: {
    primary: "Auctions, matching, and market design",
    family: "Markets & mechanisms",
    patterns: [
      [9, /\bauctions?\b/], [8, /\bmarket design\b/], [8, /\bmechanism design\b/],
      [8, /\bmatching\b/], [7, /\bbidding\b/], [7, /\bcontest(?:s)?\b/],
      [6, /\ballocation mechanism\b/], [6, /\bincentive compatible\b/], [5, /\bcoalition(?:s)?\b/]
    ]
  },
  organizations: {
    primary: "Organizations, incentives, and finance",
    family: "Organizations & finance",
    patterns: [
      [8, /\bmoral hazard\b/], [8, /\bcontracting\b/], [7, /\bincentive(?:s)?\b/],
      [7, /\bworker(?:s)?\b/], [7, /\bemployee(?:s)?\b/], [7, /\borganization(?:s|al)?\b/],
      [7, /\bfinance|financial|financing\b/], [6, /\bgovernance\b/], [6, /\bcompensation\b/],
      [6, /\bdelegation\b/], [5, /\binvestment\b/], [5, /\bcredit\b/], [5, /\bteams?\b/]
    ]
  },
  innovation: {
    primary: "Innovation, analytics, and technology",
    family: "Innovation & technology",
    patterns: [
      [8, /\binnovation\b/], [8, /\bartificial intelligence\b|\bai\b/], [8, /\bmachine learning\b/],
      [8, /\bcybersecurity\b|\binformation security\b/], [7, /\balgorithm(?:s|ic)?\b/],
      [7, /\bsoftware\b/], [7, /\btechnology\b/], [7, /\bblockchain\b/],
      [6, /\bdata analytics\b/], [6, /\bcloud computing\b/], [5, /\bresearch and development\b|\br&d\b/]
    ]
  },
  policy: {
    primary: "Policy, sustainability, and public services",
    family: "Policy & sustainability",
    patterns: [
      [9, /\bsustainab(?:ility|le)\b/], [8, /\bclimate\b/], [8, /\bcarbon\b/],
      [8, /\bemissions?\b/], [8, /\bhealthcare\b|\bhealth care\b/], [7, /\bpublic polic(?:y|ies)\b/],
      [7, /\bregulat(?:ion|ory|ing)\b/], [7, /\bgovernment\b/], [6, /\benergy\b/],
      [6, /\benvironment(?:al)?\b/], [6, /\bpublic services?\b/], [5, /\bsocial welfare\b/]
    ]
  }
};

function normalizeDoi(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

function normalizedFilename(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

function recordId(doi) {
  return `doi-${normalizeDoi(doi).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function cleanText(value) {
  const source = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!source) return "";
  return source.split(/\s{2,}/).map((segment) => {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const singleCharacterShare = tokens.filter((token) => /^[A-Za-z0-9.,;:()\/-]$/.test(token)).length / Math.max(1, tokens.length);
    return tokens.length >= 4 && singleCharacterShare >= 0.7 ? tokens.join("") : segment.trim();
  }).join(" ").replace(/\s+/g, " ").trim();
}

function firstSentence(value, limit = 520) {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  const sentence = (match?.[0] || text).trim();
  return sentence.length <= limit ? sentence : `${sentence.slice(0, limit - 1).trimEnd()}…`;
}

function splitAuthors(value) {
  return String(value ?? "").split(/\s*;\s*/).map(cleanText).filter(Boolean);
}

function publicationYear(value) {
  const match = String(value ?? "").match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  if (!match) throw new Error(`Cannot determine publication year from ${JSON.stringify(value)}`);
  return Number(match[1]);
}

function classifyTopic(source) {
  const text = cleanText([
    source.title,
    source.abstract,
    source.decision_reason,
    source.method_evidence,
    source.field
  ].filter(Boolean).join(" ")).toLowerCase();
  const fallback = String(source.field ?? "").toLowerCase().includes("is")
    ? "innovation"
    : String(source.field ?? "").toLowerCase().includes("market")
      ? "pricing"
      : "supply-chains";
  let winner = fallback;
  let winnerScore = 0;
  for (const [key, topic] of Object.entries(TOPICS)) {
    const score = topic.patterns.reduce((sum, [weight, expression]) => sum + (expression.test(text) ? weight : 0), 0);
    if (score > winnerScore) {
      winner = key;
      winnerScore = score;
    }
  }
  return { id: winner, ...TOPICS[winner] };
}

function methodFamilies(source) {
  const text = cleanText([source.title, source.abstract, source.decision_reason, source.method_evidence].filter(Boolean).join(" ")).toLowerCase();
  const families = [];
  const add = (label, expression) => { if (expression.test(text)) families.push(label); };
  add("Game-theoretic modeling", /\bgame[- ]theoretic\b|\bgame theory\b|\bnash equilibrium\b|\bstrategic (?:interaction|game)\b/);
  add("Optimization", /\boptimi[sz](?:ation|e|es|ing)\b|\bmathematical program(?:ming)?\b|\blinear program(?:ming)?\b|\bmixed[- ]integer\b/);
  add("Stochastic modeling", /\bstochastic\b|\bmarkov\b|\bqueue(?:ing)?\b|\brandom process\b/);
  add("Dynamic modeling", /\bdynamic program(?:ming)?\b|\bdifferential game\b|\boptimal control\b|\bdynamic model\b/);
  add("Algorithm design", /\balgorithm(?:s|ic)?\b|\bapproximation\b|\bheuristic\b|\bcomputational\b/);
  add("Analytical modeling", /\banalytical model\b|\beconomic model\b|\bclosed[- ]form\b|\bproposition(?:s)?\b|\btheorem(?:s)?\b/);
  add("Simulation", /\bsimulat(?:ion|ions|ed|ing)\b|\bnumerical experiment(?:s)?\b/);
  add("Analytical-empirical hybrid", /\bempirical(?:ly)?\b|\bfield data\b|\bdata set\b|\bdataset\b/);
  return families.length ? [...new Set(families)] : ["Substantive modeling (scope-reviewed)"];
}

function generateBibkey(source, used) {
  const year = publicationYear(source.published);
  const code = JOURNAL_CODES.get(source.journal);
  const token = cleanText(source.authors).split(/[ ;,]+/).find(Boolean)?.replace(/[^A-Za-z0-9]/g, "").toLowerCase() || "article";
  const doiToken = createHash("sha1").update(normalizeDoi(source.doi)).digest("hex").slice(0, 8);
  let key = `${token}${year}${code}${doiToken}`;
  let suffix = 2;
  while (used.has(key.toLowerCase())) key = `${token}${year}${code}${doiToken}${suffix++}`;
  used.add(key.toLowerCase());
  return key;
}

function createLiteratureRecord(source, usedBibkeys) {
  const doi = normalizeDoi(source.doi);
  const journalCode = JOURNAL_CODES.get(source.journal);
  if (!journalCode) throw new Error(`Unsupported journal: ${source.journal}`);
  const authors = splitAuthors(source.authors);
  const abstract = cleanText(source.abstract);
  const reviewNote = cleanText(source.decision_reason);
  const explicitMethodEvidence = cleanText(source.method_evidence);
  const modelingEvidence = explicitMethodEvidence
    || reviewNote
    || (abstract ? `The scope review identified the modeling contribution summarized in the abstract: ${firstSentence(abstract)}` : "The corpus review classified this article as substantive OM/IS/Marketing modeling; consult the local PDF for the formulation and results.");
  const topic = classifyTopic(source);
  const methods = methodFamilies(source);
  const year = publicationYear(source.published);
  const question = firstSentence(abstract) || `What modeling problem does this article address in ${topic.family.toLowerCase()}?`;
  const sourceBasis = [cleanText(source.source_note), reviewNote, explicitMethodEvidence].filter(Boolean).join(" ");
  return {
    id: recordId(doi),
    detail_level: "literature",
    analysis_level: "evidence-indexed model record",
    title: cleanText(source.title),
    authors,
    authors_text: authors.join(", "),
    year,
    published_date: cleanText(source.published),
    publication_date: cleanText(source.published),
    doi,
    doi_url: `https://doi.org/${doi}`,
    bibkey: generateBibkey(source, usedBibkeys),
    pdf_availability: "available",
    pdf_file: source.filename,
    pdf_sha256: String(source.sha256).toLowerCase(),
    pdf_bytes: Number(source.bytes),
    pdf_page_count: Number(source.page_count),
    source_basis: sourceBasis || "Included by the completed corpus screening and backed by the downloaded main PDF.",
    review_status: LITERATURE_REVIEW_STATUS,
    scope: "OM/IS/Marketing substantive modeling",
    strict_game_theory: false,
    scope_note: reviewNote || "Included in the completed modeling-paper scope review; this Atlas entry indexes the review evidence and abstract rather than asserting a full independent model reconstruction.",
    primary_topic: topic.primary,
    navigation_topic: topic.id,
    topics: [topic.primary, cleanText(source.field)].filter(Boolean),
    topic_families: [topic.family],
    model_topic: firstSentence(abstract, 300) || cleanText(source.title),
    topic_details: [cleanText(source.field), ...methods].filter(Boolean),
    evidence: ["Downloaded main PDF", "Scope-screening record", ...(explicitMethodEvidence ? ["Page-specific modeling evidence"] : [])],
    evidence_families: methods,
    evidence_detail: [modelingEvidence, reviewNote].filter(Boolean),
    business_question: question,
    players: [],
    timing: "",
    actions: [],
    information: [],
    information_families: [],
    assumptions: [],
    objective: { summary: "", formula: "", formula_source: "", status: "not independently mapped" },
    notation: [],
    equilibrium: { label: "", evidence: "", status: "not independently mapped" },
    equilibrium_families: [],
    method: methods.join("; "),
    method_families: methods,
    game_architecture: [],
    architecture_families: [],
    architecture_detail: [],
    solution: { summary: "", status: "not independently mapped" },
    calibration: { summary: "", status: "not independently mapped" },
    caveat: "This is an evidence-indexed literature record, not a complete independent reconstruction of every model element. Use the local PDF for the full formulation, assumptions, proofs, and results.",
    abstract,
    modeling_evidence: modelingEvidence,
    review_note: reviewNote,
    field: cleanText(source.field),
    source_category: cleanText(source.source_category),
    source_note: cleanText(source.source_note),
    review_batch: cleanText(source.review_batch),
    source_sequence: source.sequence,
    volume: cleanText(source.volume),
    issue: cleanText(source.issue),
    pages: cleanText(source.pages),
    journal: source.journal,
    journal_code: journalCode,
    published_online: cleanText(source.published),
    online_date_status: "manifest-reported publication date"
  };
}

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

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = String(selector(record));
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
}

function requiredCoverage(records) {
  const keys = [
    "title", "authors", "year", "doi", "bibkey", "pdf_availability", "review_status", "scope",
    "business_question", "journal", "published_online", "pdf_file", "detail_level"
  ];
  return Object.fromEntries(keys.map((key) => [key, records.filter((record) => {
    const value = record[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && String(value).trim() !== "";
  }).length]));
}

function bibEscape(value) {
  return cleanText(value).replace(/[{}]/g, "").replace(/([%&#_])/g, "\\$1");
}

function renderBibEntry(record) {
  const fields = [
    `  author = {${record.authors.join(" and ")}}`,
    `  title = {{${bibEscape(record.title)}}}`,
    `  journal = {${bibEscape(record.journal)}}`,
    `  year = {${record.year}}`,
    record.volume ? `  volume = {${bibEscape(record.volume)}}` : "",
    record.issue ? `  number = {${bibEscape(record.issue)}}` : "",
    record.pages ? `  pages = {${bibEscape(record.pages).replace(/(?<=\d)-(?=\d)/g, "--")}}` : "",
    `  doi = {${record.doi}}`,
    `  url = {https://doi.org/${record.doi}}`,
    `  note = {Local PDF verified; evidence-indexed Atlas literature record}`
  ].filter(Boolean);
  return `@article{${record.bibkey},\n${fields.join(",\n")}\n}`;
}

async function writeAtomic(filePath, content) {
  const temporary = `${filePath}.atlas-import-tmp`;
  await writeFile(temporary, content);
  await copyFile(temporary, filePath);
  await rm(temporary, { force: true });
}

function assertUnique(records, key, normalizer = (value) => String(value).toLowerCase()) {
  const seen = new Map();
  for (const record of records) {
    const value = normalizer(record[key]);
    if (!value) throw new Error(`Missing ${key} for ${record.title || record.id}`);
    if (seen.has(value)) throw new Error(`Duplicate ${key}: ${value}`);
    seen.set(value, record.id);
  }
}

async function main() {
  const sourceArg = process.argv[2];
  if (!sourceArg || process.argv.length > 3) {
    throw new Error("Usage: node scripts/import-literature.mjs <Atlas_Literature_2016_present directory>");
  }
  const sourceRoot = path.resolve(sourceArg);
  const sourcePdfDir = path.join(sourceRoot, "pdf");
  const screeningDir = path.join(sourceRoot, "screening");
  const manifestPath = path.join(screeningDir, "final_included_manifest.json");
  const [payload, manifest, existingBib] = await Promise.all([
    readFile(DATA_PATH, "utf8").then(JSON.parse),
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(BIB_PATH, "utf8")
  ]);
  if (!Array.isArray(payload.records) || !Array.isArray(manifest.records)) throw new Error("Input records are missing");
  if (manifest.count !== manifest.records.length) throw new Error("Source manifest count does not match records");

  const sourceByDoi = new Map();
  for (const source of manifest.records) {
    const doi = normalizeDoi(source.doi);
    if (!doi) throw new Error(`Source record ${source.title} has no DOI`);
    if (sourceByDoi.has(doi)) throw new Error(`Duplicate source DOI: ${doi}`);
    sourceByDoi.set(doi, source);
    if (path.basename(source.filename) !== source.filename) throw new Error(`Unsafe source filename: ${source.filename}`);
    const resolvedPdf = path.resolve(source.pdf_path);
    const allowedPrefix = `${path.resolve(sourcePdfDir).toLowerCase()}${path.sep}`;
    if (!resolvedPdf.toLowerCase().startsWith(allowedPrefix) || normalizedFilename(path.basename(resolvedPdf)) !== normalizedFilename(source.filename)) {
      throw new Error(`Source PDF path escapes the source corpus: ${source.pdf_path}`);
    }
  }

  const existingByDoi = new Map(payload.records.map((record) => [normalizeDoi(record.doi), record]));
  if (existingByDoi.size !== payload.records.length) throw new Error("The existing Atlas contains duplicate DOIs");
  const usedBibkeys = new Set(payload.records.map((record) => String(record.bibkey).toLowerCase()));
  const newSources = manifest.records.filter((source) => !existingByDoi.has(normalizeDoi(source.doi)));
  const overlapSources = manifest.records.filter((source) => existingByDoi.has(normalizeDoi(source.doi)));
  console.log(`Source manifest: ${manifest.records.length}; overlaps: ${overlapSources.length}; new: ${newSources.length}`);

  console.log("Verifying every source PDF against manifest SHA-256...");
  const sourceChecks = await mapLimit(manifest.records, 8, async (source, index) => {
    const filePath = path.resolve(source.pdf_path);
    const observed = await hashFile(filePath);
    if (observed.header !== "%PDF-") throw new Error(`Not a PDF: ${filePath}`);
    if (observed.bytes !== Number(source.bytes)) throw new Error(`Source byte mismatch: ${source.filename}`);
    if (observed.sha256 !== String(source.sha256).toLowerCase()) throw new Error(`Source hash mismatch: ${source.filename}`);
    if ((index + 1) % 200 === 0) console.log(`  verified ${index + 1}/${manifest.records.length}`);
    return observed;
  });
  if (sourceChecks.length !== manifest.records.length) throw new Error("Source verification did not finish");

  console.log(`Copying ${newSources.length} new PDFs without overwriting existing files...`);
  await mapLimit(newSources, 4, async (source, index) => {
    const destination = path.join(PAPER_DIR, source.filename);
    const temporary = `${destination}.atlas-partial`;
    const existing = await stat(destination).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (existing) {
      const observed = await hashFile(destination);
      if (observed.sha256 !== String(source.sha256).toLowerCase()) throw new Error(`Destination collision: ${source.filename}`);
      return;
    }
    await rm(temporary, { force: true });
    await copyFile(path.resolve(source.pdf_path), temporary);
    const observed = await hashFile(temporary);
    if (observed.header !== "%PDF-" || observed.bytes !== Number(source.bytes) || observed.sha256 !== String(source.sha256).toLowerCase()) {
      await rm(temporary, { force: true });
      throw new Error(`Copied PDF failed verification: ${source.filename}`);
    }
    await rename(temporary, destination);
    if ((index + 1) % 100 === 0) console.log(`  copied ${index + 1}/${newSources.length}`);
  });

  const importedRecords = newSources.map((source) => createLiteratureRecord(source, usedBibkeys));
  const records = [
    ...payload.records.map((record) => ({
      ...record,
      detail_level: record.detail_level || "model_map",
      analysis_level: record.analysis_level || "deep model map"
    })),
    ...importedRecords
  ];
  records.forEach((record, index) => { record.workbook_row = index + 2; });
  assertUnique(records, "id");
  assertUnique(records, "doi", normalizeDoi);
  assertUnique(records, "pdf_file", normalizedFilename);
  assertUnique(records, "bibkey");

  console.log(`Verifying the complete ${records.length}-PDF Atlas corpus...`);
  const targetChecks = await mapLimit(records, 8, async (record, index) => {
    const filePath = path.join(PAPER_DIR, record.pdf_file);
    if (path.basename(record.pdf_file) !== record.pdf_file) throw new Error(`Unsafe target filename: ${record.pdf_file}`);
    const observed = await hashFile(filePath);
    if (observed.header !== "%PDF-") throw new Error(`Target is not a PDF: ${record.pdf_file}`);
    const source = sourceByDoi.get(normalizeDoi(record.doi));
    if (source && observed.sha256 !== String(source.sha256).toLowerCase()) throw new Error(`Target/source hash mismatch: ${record.pdf_file}`);
    record.pdf_sha256 = observed.sha256;
    record.pdf_bytes = observed.bytes;
    if ((index + 1) % 250 === 0) console.log(`  verified ${index + 1}/${records.length}`);
    return observed;
  });

  const paperFiles = (await readdir(PAPER_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => entry.name);
  const recordFiles = new Set(records.map((record) => normalizedFilename(record.pdf_file)));
  const orphanFiles = paperFiles.filter((name) => !recordFiles.has(normalizedFilename(name)));
  const missingFiles = records.filter((record) => !paperFiles.some((name) => normalizedFilename(name) === normalizedFilename(record.pdf_file)));
  if (orphanFiles.length || missingFiles.length || paperFiles.length !== records.length) {
    throw new Error(`Corpus mismatch: ${orphanFiles.length} orphan PDFs, ${missingFiles.length} missing PDFs, ${paperFiles.length} files for ${records.length} records`);
  }

  const detailLevelCounts = countBy(records, (record) => record.detail_level);
  const reviewStatusCounts = countBy(records, (record) => record.review_status);
  const journalCounts = countBy(records, (record) => record.journal_code);
  const yearCounts = countBy(records, (record) => record.year);
  const topicCounts = countBy(records, (record) => record.primary_topic);
  const mergedPayload = {
    ...payload,
    schema_version: "3.1",
    title: "Model Atlas: OM, IS, and Marketing modeling literature",
    generated_on: new Date().toISOString(),
    audit: {
      records: records.length,
      pdf_available: records.length,
      pdf_verified: targetChecks.length,
      model_maps: detailLevelCounts.model_map || 0,
      literature_records: detailLevelCounts.literature || 0,
      independently_audited: records.filter((record) => record.detail_level === "model_map" && record.review_status === MODEL_MAP_REVIEW_STATUS).length,
      imported_scope_reviewed: records.filter((record) => record.detail_level === "literature" && record.review_status === LITERATURE_REVIEW_STATUS).length,
      with_bibkey: records.filter((record) => record.bibkey).length,
      source_manifest_records: manifest.records.length,
      source_manifest_overlaps: overlapSources.length,
      source_manifest_new_records: importedRecords.length,
      journal_counts: journalCounts,
      year_counts: yearCounts,
      first_online_year_counts: yearCounts,
      primary_topic_counts: topicCounts,
      detail_level_counts: detailLevelCounts,
      review_status_counts: reviewStatusCounts,
      scope_counts: countBy(records, (record) => record.scope),
      required_field_coverage: requiredCoverage(records),
      objective_formulas_asserted: records.filter((record) => cleanText(record.objective?.formula)).length,
      objective_formulas_pdf_verified: records.filter((record) => cleanText(record.objective?.formula) && /pdf-verified/i.test(record.objective?.status || "")).length,
      formula_note: "Representative formulas are shown only for the 304 independently mapped records; evidence-indexed literature records do not invent formulas or unmapped model elements."
    },
    provenance: {
      ...payload.provenance,
      import_manifest: "Atlas/data/imports/atlas_literature_2016_present/final_included_manifest.json",
      import_audit: "Atlas/data/imports/atlas_literature_2016_present/IMPORT_AUDIT.json",
      import_source: "EBSCOhost corpus completion plus preexisting reviewed copies documented in the imported manifest",
      note: "All 1,674 records have a locally verified main PDF. The original 304 records retain independently audited deep model maps; 1,370 imported records expose scope-review evidence and abstracts without claiming a complete independent model reconstruction."
    },
    records
  };

  const bibkeysInFile = new Set([...existingBib.matchAll(/@[A-Za-z]+\s*\{\s*([^,\s]+)\s*,/g)].map((match) => match[1].toLowerCase()));
  const newBibEntries = importedRecords.filter((record) => !bibkeysInFile.has(record.bibkey.toLowerCase())).map(renderBibEntry);
  const mergedBib = `${existingBib.trimEnd()}\n\n${newBibEntries.join("\n\n")}\n`;
  const finalBibkeys = [...mergedBib.matchAll(/@[A-Za-z]+\s*\{\s*([^,\s]+)\s*,/g)].map((match) => match[1].toLowerCase());
  if (finalBibkeys.length !== records.length || new Set(finalBibkeys).size !== records.length) {
    throw new Error(`Bibliography mismatch: ${finalBibkeys.length} entries for ${records.length} records`);
  }

  await mkdir(IMPORT_DIR, { recursive: true });
  const provenanceFiles = ["final_included_manifest.json", "FINAL_AUDIT.json", "FINAL_REPORT.md", "ebsco_unavailable.csv"];
  for (const filename of provenanceFiles) await copyFile(path.join(screeningDir, filename), path.join(IMPORT_DIR, filename));
  await copyFile(path.join(sourceRoot, "HANDOFF.md"), path.join(IMPORT_DIR, "SOURCE_HANDOFF.md"));

  const mappings = manifest.records.map((source) => {
    const target = records.find((record) => normalizeDoi(record.doi) === normalizeDoi(source.doi));
    return {
      doi: normalizeDoi(source.doi),
      source_pdf: source.filename,
      target_pdf: target.pdf_file,
      sha256: source.sha256,
      disposition: importedRecords.some((record) => normalizeDoi(record.doi) === normalizeDoi(source.doi)) ? "copied-new" : "reused-identical-existing-pdf"
    };
  });
  const importAudit = {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    source_root_at_import: sourceRoot,
    target_root: ATLAS_ROOT,
    source_manifest_records: manifest.records.length,
    reused_identical_existing_records: overlapSources.length,
    copied_new_records: importedRecords.length,
    target_records: records.length,
    target_pdf_files: paperFiles.length,
    source_hashes_verified: sourceChecks.length,
    target_hashes_verified: targetChecks.length,
    orphan_target_pdfs: orphanFiles,
    missing_target_pdfs: missingFiles,
    mapping_status: "passed",
    mappings
  };

  await writeAtomic(DATA_PATH, `${JSON.stringify(mergedPayload, null, 2)}\n`);
  await writeAtomic(BIB_PATH, mergedBib);
  await writeFile(path.join(IMPORT_DIR, "IMPORT_AUDIT.json"), `${JSON.stringify(importAudit, null, 2)}\n`);
  console.log(`Imported ${importedRecords.length} new records; Atlas now contains ${records.length} verified PDFs and records.`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
