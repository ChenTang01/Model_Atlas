import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  unlink
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256, stableStringify } from "./corpus-pipeline.mjs";
import {
  EXTRACTION_QA_CODE_SHA256,
  EXTRACTION_QA_POLICY_SHA256,
  EXTRACTION_QA_VERSION,
  extractionQaInputDigest
} from "./extraction-qa.mjs";
import {
  EXTRACTION_REPAIR_CODE_SHA256,
  EXTRACTION_REPAIR_LAYOUT_POLICY,
  EXTRACTION_REPAIR_VERSION,
  extractionRepairCandidatePaths,
  extractionRepairInput,
  inspectExtractionRepairVisualEvidence,
  validateGeneratedRepairEvidence,
  validateRepairSpec
} from "./extraction-repair.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const ADJUDICATION_DIR = path.posix.join("research", "ledger", "extraction-repair-adjudications");
const MANIFEST_PATH = path.posix.join("research", "corpus", "manifest.v1.json");
const PAPER_LEDGER_DIR = path.posix.join("research", "ledger", "papers");
const COMMANDS = new Set(["inspect", "check", "adjudicate"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const RECORD_FILE_PATTERN = /^([a-f0-9]{64})\.json$/;
const REVIEWER_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}@._:+-]{2,127}$/u;
const TERMINAL_DISPOSITIONS = new Set(["accepted", "rejected"]);
const FINDING_CONCLUSIONS = new Set(["accept", "reject"]);

export const EXTRACTION_REPAIR_ADJUDICATION_VERSION = "extraction-repair-adjudication-v1";
export const EXTRACTION_REPAIR_ADJUDICATION_LOCK_VERSION = 1;
export const EXTRACTION_REPAIR_ADJUDICATION_POLICY = Object.freeze({
  schemaVersion: 1,
  name: "independent-hash-bound-extraction-repair-adjudication",
  evidenceBinding: "source, base extraction, automated QA, repair spec, candidate four-file bundle, every visual sidecar, and every crop are content-bound",
  acceptedCoverage: "accepted requires one independent adjudication finding for every visual-review requirement page",
  reviewerIndependence: "the adjudicator must explicitly attest independence and must not be any visual-evidence reviewer",
  immutability: "records are content-addressed and published create-if-absent; corrections form an explicit linear supersedes chain",
  mutation: "adjudication never mutates candidates, production extraction, QA decisions, paper ledgers, authoring, or public artifacts",
  promotion: "a valid accepted adjudication remains ineligible for promotion until a separate promotion operation succeeds"
});
export const EXTRACTION_REPAIR_ADJUDICATION_POLICY_SHA256 = sha256(
  stableStringify(EXTRACTION_REPAIR_ADJUDICATION_POLICY)
);
export const EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256 = sha256(await readFile(SCRIPT_PATH));

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function uniqueSortedNumbers(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function parsePages(value) {
  const pages = [];
  for (const part of String(value || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = positiveInteger(range[1], "--pages range start");
      const end = positiveInteger(range[2], "--pages range end");
      if (end < start) throw new Error("--pages ranges must be ascending");
      for (let page = start; page <= end; page += 1) pages.push(page);
    } else {
      pages.push(positiveInteger(part, "--pages"));
    }
  }
  if (!pages.length) throw new Error("--pages requires at least one page");
  return uniqueSortedNumbers(pages);
}

function parseFinding(value) {
  const [pageText, conclusion, ...observationParts] = String(value || "").split("|");
  const page = positiveInteger(pageText, "--finding page");
  if (!FINDING_CONCLUSIONS.has(conclusion)) throw new Error("--finding conclusion must be accept or reject");
  const observation = observationParts.join("|").trim();
  if (!observation) throw new Error("--finding must use PAGE|CONCLUSION|CONCRETE_OBSERVATION format");
  return { page, conclusion, observation };
}

export function parseExtractionRepairAdjudicationCli(argv) {
  const options = {
    command: "inspect",
    root: SCRIPT_ROOT,
    paper: "",
    repairInputDigest: "",
    adjudicationPath: "",
    disposition: "",
    reviewerId: "",
    reviewer: "",
    reviewedPages: [],
    findings: [],
    rationale: "",
    attestIndependent: false,
    supersedes: "",
    json: false,
    help: false
  };
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (COMMANDS.has(argument)) {
      if (command && command !== argument) throw new Error("Only one repair-adjudication command may be selected");
      command = argument;
      continue;
    }
    const [rawName, inlineValue] = argument.startsWith("--") ? argument.split(/=(.*)/s, 2) : [argument, undefined];
    const takeValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${rawName} requires a value`);
      return value;
    };
    switch (rawName) {
      case "--root": options.root = path.resolve(takeValue()); break;
      case "--paper":
      case "--id":
        if (options.paper) throw new Error("Only one --paper may be selected");
        options.paper = takeValue().trim();
        break;
      case "--repair-digest": options.repairInputDigest = takeValue().trim(); break;
      case "--adjudication":
      case "--record": options.adjudicationPath = takeValue().trim(); break;
      case "--accept":
        if (options.disposition && options.disposition !== "accepted") throw new Error("--accept and --reject are mutually exclusive");
        options.disposition = "accepted";
        break;
      case "--reject":
        if (options.disposition && options.disposition !== "rejected") throw new Error("--accept and --reject are mutually exclusive");
        options.disposition = "rejected";
        break;
      case "--reviewer-id": options.reviewerId = takeValue().trim(); break;
      case "--reviewer": options.reviewer = takeValue().trim(); break;
      case "--pages": options.reviewedPages = parsePages(takeValue()); break;
      case "--finding": options.findings.push(parseFinding(takeValue())); break;
      case "--rationale": options.rationale = takeValue().trim(); break;
      case "--attest-independent": options.attestIndependent = true; break;
      case "--supersedes": options.supersedes = takeValue().trim(); break;
      case "--json": options.json = true; break;
      case "--help":
      case "-h": options.help = true; break;
      default: throw new Error(`Unknown argument: ${argument}`);
    }
  }
  options.command = command || options.command;
  if (options.help) return options;
  if (!options.paper) throw new Error("--paper is required");
  if (!SHA256_PATTERN.test(options.repairInputDigest)) throw new Error("--repair-digest must be a lowercase SHA-256 digest");
  if (options.command === "adjudicate") {
    if (!options.disposition) throw new Error("adjudicate requires --accept or --reject");
    if (!options.reviewerId) throw new Error("adjudicate requires --reviewer-id");
    if (!options.reviewer) throw new Error("adjudicate requires --reviewer");
    if (!options.reviewedPages.length) throw new Error("adjudicate requires --pages");
    if (!options.findings.length) throw new Error("adjudicate requires at least one --finding");
    if (!options.rationale) throw new Error("adjudicate requires --rationale");
    if (!options.attestIndependent) throw new Error("adjudicate requires --attest-independent");
  } else if (options.disposition || options.reviewerId || options.reviewer || options.reviewedPages.length
    || options.findings.length || options.rationale || options.attestIndependent || options.supersedes) {
    throw new Error("Adjudication evidence options are valid only with the adjudicate command");
  }
  return options;
}

function assertSafeId(value, label = "paper ID") {
  if (!SAFE_ID_PATTERN.test(String(value || ""))) throw new Error(`Unsafe ${label}: ${value}`);
}

function assertSha256(value, label) {
  if (!SHA256_PATTERN.test(String(value || ""))) throw new Error(`${label} is not a lowercase SHA-256 digest`);
}

function assertEqual(condition, message) {
  if (!condition) throw new Error(message);
}

function absoluteFromRelative(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)
    || relativePath.includes("\\") || path.posix.normalize(relativePath) !== relativePath
    || relativePath.startsWith("../")) {
    throw new Error(`Unsafe relative path: ${relativePath}`);
  }
  const absolute = path.resolve(root, ...relativePath.split("/"));
  const containment = path.relative(root, absolute);
  if (containment.startsWith("..") || path.isAbsolute(containment)) throw new Error(`Path leaves project root: ${relativePath}`);
  return absolute;
}

async function assertRegularFile(filePath, label) {
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  return stats;
}

async function hashFile(filePath, label) {
  await assertRegularFile(filePath, label);
  const handle = await open(filePath, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      bytes += result.bytesRead;
    }
    return { sha256: hash.digest("hex"), bytes };
  } finally {
    await handle.close();
  }
}

async function readCanonicalJson(root, relativePath, label) {
  const filePath = absoluteFromRelative(root, relativePath);
  await assertRegularFile(filePath, label);
  const bytes = await readFile(filePath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  const canonical = Buffer.from(`${stableStringify(value, 2)}\n`, "utf8");
  if (!bytes.equals(canonical)) throw new Error(`${label} is not canonical stable JSON`);
  return { relativePath, value, bytes, sha256: sha256(bytes) };
}

async function readHashedFile(root, relativePath, label) {
  const filePath = absoluteFromRelative(root, relativePath);
  const identity = await hashFile(filePath, label);
  return { relativePath, ...identity };
}

function selectorIndex(manifest) {
  const result = new Map();
  for (const record of manifest.records || []) {
    for (const selector of [record.id, record.canonicalDoi, record.doiUrl, ...(record.aliases || [])]) {
      const normalized = String(selector || "").toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
      if (!normalized) continue;
      if (result.has(normalized) && result.get(normalized) !== record.id) throw new Error(`Ambiguous paper selector: ${selector}`);
      result.set(normalized, record.id);
    }
  }
  return result;
}

function resolveRecord(manifest, selector) {
  const normalized = String(selector || "").toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
  const paperId = selectorIndex(manifest).get(normalized);
  if (!paperId) throw new Error(`Unknown paper selector: ${selector}`);
  const record = manifest.records.find((item) => item.id === paperId);
  assertSafeId(record.id);
  const { recordDigest, ...recordBody } = record;
  assertEqual(recordDigest === sha256(stableStringify(recordBody)), `${record.id}: manifest record digest mismatch`);
  return record;
}

function candidateBindingIssues(candidate, expected) {
  const issues = [];
  const equal = (condition, code) => { if (!condition) issues.push(code); };
  equal(candidate?.schemaVersion === 1, "schema_version_mismatch");
  equal(candidate?.stage === "extractionRepairCandidate", "stage_mismatch");
  equal(candidate?.producer === "scripts/extraction-repair.mjs", "producer_mismatch");
  equal(candidate?.producerVersion === EXTRACTION_REPAIR_VERSION, "producer_version_mismatch");
  equal(candidate?.producerCodeSha256 === EXTRACTION_REPAIR_CODE_SHA256, "producer_code_mismatch");
  equal(candidate?.paperId === expected.record.id, "paper_id_mismatch");
  equal(candidate?.canonicalDoi === expected.record.canonicalDoi, "canonical_doi_mismatch");
  equal(candidate?.manifestRecordDigest === expected.record.recordDigest, "manifest_record_digest_mismatch");
  equal(candidate?.sourcePdfSha256 === expected.record.pdf.sha256, "source_pdf_hash_mismatch");
  equal(candidate?.basePagesSha256 === expected.extraction.artifacts.pagesSha256, "base_pages_hash_mismatch");
  equal(candidate?.extractionQaInputDigest === expected.qaInputDigest, "qa_input_digest_mismatch");
  equal(candidate?.extractionQaDecisionPath === expected.qa.relativePath, "qa_path_mismatch");
  equal(candidate?.extractionQaDecisionSha256 === expected.qa.sha256, "qa_hash_mismatch");
  equal(candidate?.repairSpecPath === expected.spec.relativePath, "repair_spec_path_mismatch");
  equal(candidate?.repairSpecSha256 === expected.spec.sha256, "repair_spec_hash_mismatch");
  equal(candidate?.repairInputDigest === expected.repairInputDigest, "repair_input_digest_mismatch");
  equal(candidate?.status === "needs_visual_review", "candidate_status_mismatch");
  equal(candidate?.promotionEligibility === false, "candidate_promotion_flag_mismatch");
  equal(stableStringify(candidate?.layoutPolicy) === stableStringify(EXTRACTION_REPAIR_LAYOUT_POLICY), "layout_policy_mismatch");
  equal(Array.isArray(candidate?.unmappedGlyphs), "unmapped_glyphs_invalid");
  equal(Array.isArray(candidate?.visualEvidence?.requirements) && candidate.visualEvidence.requirements.length > 0, "visual_requirements_missing");
  return issues;
}

function artifactBindingIssues(value, stage, candidate, pagesSha256 = null) {
  const issues = [];
  const equal = (condition, code) => { if (!condition) issues.push(code); };
  equal(value?.schemaVersion === 1, `${stage}_schema_version_mismatch`);
  equal(value?.stage === stage, `${stage}_stage_mismatch`);
  equal(value?.producerVersion === candidate.producerVersion, `${stage}_producer_version_mismatch`);
  equal(value?.producerCodeSha256 === candidate.producerCodeSha256, `${stage}_producer_code_mismatch`);
  for (const field of ["paperId", "canonicalDoi", "sourcePdfSha256", "basePagesSha256", "extractionQaDecisionSha256", "repairInputDigest"]) {
    equal(value?.[field] === candidate[field], `${stage}_${field}_mismatch`);
  }
  if (pagesSha256 !== null) equal(value?.candidatePagesSha256 === pagesSha256, `${stage}_candidate_pages_hash_mismatch`);
  return issues;
}

function plainTextFromPages(pages) {
  return pages.map((page) => `===== PDF PAGE ${page.page} =====\n${page.text}`).join("\n\n") + "\n";
}

function validatePageSequence(pages, pageCount, label) {
  assertEqual(Array.isArray(pages) && pages.length === pageCount, `${label} page count mismatch`);
  for (let index = 0; index < pages.length; index += 1) {
    assertEqual(pages[index]?.page === index + 1 && typeof pages[index]?.text === "string", `${label} page sequence is invalid at ${index + 1}`);
  }
}

export function repairAdjudicationInputDigest(input) {
  return sha256(stableStringify(input));
}

export async function buildExtractionRepairAdjudicationInput({ root = SCRIPT_ROOT, paper, repairInputDigest }) {
  root = path.resolve(root);
  assertSha256(repairInputDigest, "repair input digest");
  const manifest = await readCanonicalJson(root, MANIFEST_PATH, "corpus manifest");
  assertEqual(manifest.value?.schemaVersion === 1 && Array.isArray(manifest.value.records), "Corpus manifest schema is invalid");
  const record = resolveRecord(manifest.value, paper);

  const ledgerPath = path.posix.join(PAPER_LEDGER_DIR, `${record.id}.json`);
  const ledgerLoaded = await readCanonicalJson(root, ledgerPath, `${record.id} paper ledger`);
  const ledger = ledgerLoaded.value;
  assertEqual(ledger?.schemaVersion === 1 && ledger.paperId === record.id, `${record.id}: paper ledger identity mismatch`);
  assertEqual(ledger.canonicalDoi === record.canonicalDoi, `${record.id}: paper ledger DOI mismatch`);
  assertEqual(ledger.manifestRecordDigest === record.recordDigest, `${record.id}: paper ledger manifest binding mismatch`);
  assertEqual(ledger.pdfSha256 === record.pdf.sha256, `${record.id}: paper ledger PDF binding mismatch`);
  const extraction = ledger.stages?.extraction;
  assertEqual(extraction?.status === "complete", `${record.id}: complete base extraction required`);
  assertSha256(extraction?.inputDigest, `${record.id} base extraction input digest`);
  assertEqual(extraction.sourcePdfSha256 === record.pdf.sha256, `${record.id}: base extraction source hash mismatch`);
  assertEqual(extraction.pageCount === record.pdf.pageCount, `${record.id}: base extraction page count mismatch`);
  const basePagesPath = extraction.artifacts?.pages;
  const baseTextPath = extraction.artifacts?.text;
  const basePages = await readCanonicalJson(root, basePagesPath, `${record.id} base pages`);
  const baseText = await readHashedFile(root, baseTextPath, `${record.id} base text`);
  assertEqual(basePages.sha256 === extraction.artifacts.pagesSha256, `${record.id}: base pages hash mismatch`);
  assertEqual(baseText.sha256 === extraction.artifacts.textSha256, `${record.id}: base text hash mismatch`);
  validatePageSequence(basePages.value.pages, record.pdf.pageCount, `${record.id} base extraction`);
  const baseTextBytes = await readFile(absoluteFromRelative(root, baseTextPath));
  assertEqual(baseTextBytes.equals(Buffer.from(plainTextFromPages(basePages.value.pages), "utf8")), `${record.id}: base text/pages mismatch`);

  const sourcePdf = await readHashedFile(root, record.pdf.path, `${record.id} source PDF`);
  assertEqual(sourcePdf.sha256 === record.pdf.sha256 && sourcePdf.bytes === record.pdf.bytes, `${record.id}: source PDF identity mismatch`);
  const sourceHandle = await open(absoluteFromRelative(root, record.pdf.path), "r");
  let sourceHeader;
  try {
    const headerBuffer = Buffer.alloc(5);
    const { bytesRead } = await sourceHandle.read(headerBuffer, 0, headerBuffer.length, 0);
    sourceHeader = headerBuffer.subarray(0, bytesRead).toString("ascii");
  } finally {
    await sourceHandle.close();
  }
  assertEqual(sourceHeader === "%PDF-", `${record.id}: source PDF header mismatch`);

  const qaInputDigest = extractionQaInputDigest(record, ledger);
  const qaPath = path.posix.join("research", "ledger", "extraction-qa", record.id, `${qaInputDigest}.json`);
  const qa = await readCanonicalJson(root, qaPath, `${record.id} automated Extraction QA decision`);
  assertEqual(qa.value?.schemaVersion === 1 && qa.value.stage === "extractQa", `${record.id}: automated QA schema/stage mismatch`);
  assertEqual(qa.value.producerVersion === EXTRACTION_QA_VERSION, `${record.id}: automated QA producer version mismatch`);
  assertEqual(qa.value.producerCodeSha256 === EXTRACTION_QA_CODE_SHA256, `${record.id}: automated QA producer code mismatch`);
  assertEqual(qa.value.policySha256 === EXTRACTION_QA_POLICY_SHA256, `${record.id}: automated QA policy mismatch`);
  assertEqual(qa.value.paperId === record.id && qa.value.canonicalDoi === record.canonicalDoi, `${record.id}: automated QA identity mismatch`);
  assertEqual(qa.value.manifestRecordDigest === record.recordDigest, `${record.id}: automated QA manifest binding mismatch`);
  assertEqual(qa.value.sourcePdfSha256 === record.pdf.sha256, `${record.id}: automated QA source hash mismatch`);
  assertEqual(qa.value.extractionInputDigest === extraction.inputDigest, `${record.id}: automated QA extraction input mismatch`);
  assertEqual(qa.value.inputDigest === qaInputDigest, `${record.id}: automated QA input digest mismatch`);
  assertEqual(qa.value.status === "needs_review", `${record.id}: current needs_review automated QA decision required`);

  const specPath = path.posix.join("research", "extraction-repair-specs", `${record.id}.json`);
  const spec = await readCanonicalJson(root, specPath, `${record.id} repair spec`);
  validateRepairSpec(spec.value);
  assertEqual(spec.value.paperId === record.id && spec.value.canonicalDoi === record.canonicalDoi, `${record.id}: repair spec identity mismatch`);
  assertEqual(spec.value.bindings.sourcePdfSha256 === record.pdf.sha256, `${record.id}: repair spec source binding mismatch`);
  assertEqual(spec.value.bindings.basePagesSha256 === basePages.sha256, `${record.id}: repair spec base binding mismatch`);
  assertEqual(spec.value.bindings.extractionQaDecisionSha256 === qa.sha256, `${record.id}: repair spec QA binding mismatch`);

  const paths = extractionRepairCandidatePaths(record.id, repairInputDigest);
  const candidateLoaded = await readCanonicalJson(root, paths.candidate, `${record.id} repair candidate`);
  const candidate = candidateLoaded.value;
  const repairContext = {
    record,
    ledger,
    qa: { inputDigest: qaInputDigest, decisionPath: qaPath, decisionSha256: qa.sha256 },
    spec: { relativePath: specPath, sha256: spec.sha256 },
    runtime: candidate.runtime
  };
  const expectedRepairInput = extractionRepairInput(repairContext);
  assertEqual(repairAdjudicationInputDigest(expectedRepairInput) === repairInputDigest, `${record.id}: repair input digest/path mismatch`);
  const candidateIssues = candidateBindingIssues(candidate, {
    record,
    extraction,
    qaInputDigest,
    qa,
    spec,
    repairInputDigest
  });
  assertEqual(candidateIssues.length === 0, `${record.id}: invalid repair candidate (${candidateIssues.join(", ")})`);
  assertEqual(candidate.artifacts?.pages === paths.pages && candidate.artifacts?.text === paths.text
    && candidate.artifacts?.provenance === paths.provenance, `${record.id}: candidate artifact paths are nonstandard`);

  const candidatePages = await readCanonicalJson(root, paths.pages, `${record.id} candidate pages`);
  const candidateText = await readHashedFile(root, paths.text, `${record.id} candidate text`);
  const provenance = await readCanonicalJson(root, paths.provenance, `${record.id} candidate provenance`);
  assertEqual(candidatePages.sha256 === candidate.artifacts.pagesSha256, `${record.id}: candidate pages hash mismatch`);
  assertEqual(candidate.candidatePagesSha256 === candidatePages.sha256, `${record.id}: candidate top-level pages hash mismatch`);
  assertEqual(candidateText.sha256 === candidate.artifacts.textSha256, `${record.id}: candidate text hash mismatch`);
  assertEqual(provenance.sha256 === candidate.artifacts.provenanceSha256, `${record.id}: candidate provenance hash mismatch`);
  const pagesIssues = artifactBindingIssues(candidatePages.value, "extractionRepairCandidatePages", candidate);
  const provenanceIssues = artifactBindingIssues(provenance.value, "extractionRepairGlyphProvenance", candidate, candidatePages.sha256);
  assertEqual(pagesIssues.length === 0, `${record.id}: invalid candidate pages (${pagesIssues.join(", ")})`);
  assertEqual(provenanceIssues.length === 0, `${record.id}: invalid candidate provenance (${provenanceIssues.join(", ")})`);
  validatePageSequence(candidatePages.value.pages, record.pdf.pageCount, `${record.id} candidate extraction`);
  const candidateTextBytes = await readFile(absoluteFromRelative(root, paths.text));
  assertEqual(candidateTextBytes.equals(Buffer.from(plainTextFromPages(candidatePages.value.pages), "utf8")), `${record.id}: candidate text/pages mismatch`);
  assertEqual(Array.isArray(provenance.value.glyphEvents)
    && Array.isArray(provenance.value.mappedGlyphProvenance)
    && Array.isArray(provenance.value.compositeGlyphProvenance)
    && Array.isArray(provenance.value.unmappedGlyphs), `${record.id}: candidate provenance arrays are invalid`);
  validateGeneratedRepairEvidence(provenance.value, candidate.glyphMap, candidate.compositeGlyphMap || []);
  assertEqual(provenance.value.glyphEvents.every((event) => event.mappingStatus === "mapped"), `${record.id}: candidate provenance contains an unmapped glyph event`);
  assertEqual(stableStringify(provenance.value.unmappedGlyphs) === stableStringify(candidate.unmappedGlyphs), `${record.id}: candidate/provenance unmapped glyph mismatch`);
  assertEqual(provenance.value.mappedGlyphProvenance.length === candidate.mappedGlyphCount, `${record.id}: candidate mapped glyph count mismatch`);
  assertEqual(provenance.value.compositeGlyphProvenance.length === candidate.compositeGlyphCount, `${record.id}: candidate composite glyph count mismatch`);
  for (const field of ["glyphMap", "compositeGlyphMap", "observedGlyphs", "layoutVerification"]) {
    assertEqual(stableStringify(provenance.value[field]) === stableStringify(candidate[field]), `${record.id}: candidate/provenance ${field} mismatch`);
  }

  const visual = await inspectExtractionRepairVisualEvidence(root, candidate);
  assertEqual(visual.eligibleForManualAdjudication === true
    && visual.state === "eligible_for_manual_adjudication"
    && visual.promotionEligibility === false
    && visual.zeroUnmappedGlyphs === true
    && visual.allAffectedPagesAccepted === true, `${record.id}: repair candidate visual evidence is not eligible for manual adjudication`);
  const requirements = candidate.visualEvidence.requirements;
  const requiredPages = requirements.map((requirement) => requirement.page);
  assertEqual(stableStringify(requiredPages) === stableStringify(uniqueSortedNumbers(requiredPages)), `${record.id}: visual requirement pages must be unique and sorted`);
  const visualSidecars = [];
  for (const requirement of requirements) {
    const inspected = visual.sidecars.find((item) => item.page === requirement.page);
    assertEqual(inspected?.state === "accepted" && inspected.sha256, `${record.id}: page ${requirement.page} visual sidecar is not accepted`);
    const sidecar = await readCanonicalJson(root, requirement.sidecarPath, `${record.id} page ${requirement.page} visual sidecar`);
    assertEqual(sidecar.sha256 === inspected.sha256, `${record.id}: page ${requirement.page} visual sidecar hash drifted`);
    const expectedCropPrefix = `${path.posix.dirname(requirement.sidecarPath)}/crops/`;
    assertEqual(sidecar.value.cropPath.startsWith(expectedCropPrefix), `${record.id}: page ${requirement.page} crop path is outside its visual-evidence directory`);
    const crop = await readHashedFile(root, sidecar.value.cropPath, `${record.id} page ${requirement.page} visual crop`);
    assertEqual(crop.sha256 === sidecar.value.cropSha256, `${record.id}: page ${requirement.page} crop hash mismatch`);
    const cropBytes = await readFile(absoluteFromRelative(root, sidecar.value.cropPath));
    assertEqual(cropBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${record.id}: page ${requirement.page} crop is not a PNG`);
    visualSidecars.push({
      page: requirement.page,
      sidecarPath: requirement.sidecarPath,
      sidecarSha256: sidecar.sha256,
      cropPath: sidecar.value.cropPath,
      cropSha256: crop.sha256,
      reviewer: sidecar.value.reviewer,
      outcome: sidecar.value.outcome,
      dpi: sidecar.value.dpi,
      renderer: sidecar.value.renderer,
      cropBox: sidecar.value.cropBox,
      bbox: sidecar.value.bbox,
      regionsSha256: sha256(stableStringify(sidecar.value.regions))
    });
  }
  assertEqual(visual.sidecarBindingSha256 === sha256(stableStringify(visualSidecars.map((item) => ({
    page: item.page,
    path: item.sidecarPath,
    sha256: item.sidecarSha256
  })))), `${record.id}: visual sidecar binding digest mismatch`);

  return {
    schemaVersion: 1,
    stage: "extractionRepairAdjudicationInput",
    producerVersion: EXTRACTION_REPAIR_ADJUDICATION_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256,
    policySha256: EXTRACTION_REPAIR_ADJUDICATION_POLICY_SHA256,
    paperId: record.id,
    canonicalDoi: record.canonicalDoi,
    manifestRecordDigest: record.recordDigest,
    sourcePdf: {
      path: record.pdf.path,
      sha256: sourcePdf.sha256,
      bytes: sourcePdf.bytes,
      header: sourceHeader,
      pageCount: record.pdf.pageCount
    },
    baseExtraction: {
      inputDigest: extraction.inputDigest,
      stageSha256: sha256(stableStringify(extraction)),
      pagesPath: basePagesPath,
      pagesSha256: basePages.sha256,
      textPath: baseTextPath,
      textSha256: baseText.sha256
    },
    automatedQa: {
      inputDigest: qaInputDigest,
      decisionPath: qaPath,
      decisionSha256: qa.sha256,
      producerVersion: qa.value.producerVersion,
      producerCodeSha256: qa.value.producerCodeSha256,
      policySha256: qa.value.policySha256,
      status: qa.value.status
    },
    repairSpec: {
      path: specPath,
      sha256: spec.sha256
    },
    repairInputDigest,
    candidate: {
      candidatePath: paths.candidate,
      candidateSha256: candidateLoaded.sha256,
      pagesPath: paths.pages,
      pagesSha256: candidatePages.sha256,
      textPath: paths.text,
      textSha256: candidateText.sha256,
      provenancePath: paths.provenance,
      provenanceSha256: provenance.sha256,
      producerVersion: candidate.producerVersion,
      producerCodeSha256: candidate.producerCodeSha256,
      layoutPolicySha256: sha256(stableStringify(candidate.layoutPolicy)),
      layoutVerificationSha256: sha256(stableStringify(candidate.layoutVerification)),
      glyphMapSha256: sha256(stableStringify(candidate.glyphMap)),
      compositeGlyphMapSha256: sha256(stableStringify(candidate.compositeGlyphMap || [])),
      mappedGlyphCount: candidate.mappedGlyphCount,
      compositeGlyphCount: candidate.compositeGlyphCount,
      unmappedGlyphCount: candidate.unmappedGlyphs.length
    },
    visualQa: {
      state: visual.state,
      requiredPages,
      sidecarBindingSha256: visual.sidecarBindingSha256,
      sidecars: visualSidecars
    }
  };
}

function normalizeReviewer(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizedObservation(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/\bpage\s*(?:no\.?\s*)?\d+\b/giu, "page #")
    .replace(/\s+/g, " ").trim();
}

function evidenceTextIssues(value, { page = null, rationale = false } = {}) {
  const text = String(value || "").normalize("NFKC").trim();
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  const issues = [];
  if (text.length < (rationale ? 60 : 45) || words.length < (rationale ? 10 : 8)) issues.push("too_short");
  if (/\b(?:looks? good|all good|seems? fine|no issues?|everything is fine|reviewed and (?:accepted|fine|good|okay))\b/iu.test(text)) {
    issues.push("placeholder_or_boilerplate");
  }
  if (page !== null && !new RegExp(`\\bpage\\s*(?:no\\.?\\s*)?${page}\\b`, "iu").test(text)) issues.push("page_reference_missing");
  if (!rationale) {
    if (!/\b(?:source|rendered|pdf|crop|formula|equation|operator|subscript|superscript|delimiter|order|axis|sign|geometry|table|figure|glyph|symbol)\b/iu.test(text)) {
      issues.push("visual_feature_missing");
    }
    if (!/\b(?:match(?:es|ed)?|preserv(?:e|es|ed)|confirm(?:s|ed)?|differ(?:s|ed)?|incorrect|missing|misordered|aligned|visible|agrees?)\b/iu.test(text)) {
      issues.push("comparison_result_missing");
    }
  }
  return issues;
}

export function extractionRepairAdjudicationContentIssues({
  input,
  disposition,
  reviewer,
  reviewedPages,
  findings,
  rationale,
  independenceAttestation,
  supersedes = null
}) {
  const issues = [];
  if (!input || input.stage !== "extractionRepairAdjudicationInput") issues.push("input_invalid");
  if (!TERMINAL_DISPOSITIONS.has(disposition)) issues.push("disposition_invalid");
  if (!REVIEWER_ID_PATTERN.test(String(reviewer?.id || ""))) issues.push("reviewer_id_invalid");
  if (typeof reviewer?.name !== "string" || reviewer.name.trim().length < 3 || reviewer.name.trim().length > 160) issues.push("reviewer_name_invalid");
  if (independenceAttestation?.attested !== true
    || independenceAttestation?.reviewerIsIndependent !== true
    || independenceAttestation?.notAVisualEvidenceReviewer !== true) issues.push("independence_attestation_missing");
  const adjudicatorKeys = new Set([normalizeReviewer(reviewer?.id), normalizeReviewer(reviewer?.name)].filter(Boolean));
  const visualReviewerKeys = new Set((input?.visualQa?.sidecars || []).map((item) => normalizeReviewer(item.reviewer)).filter(Boolean));
  if ([...adjudicatorKeys].some((key) => visualReviewerKeys.has(key))) issues.push("reviewer_not_independent");
  if (!Array.isArray(reviewedPages) || !reviewedPages.length
    || stableStringify(reviewedPages) !== stableStringify(uniqueSortedNumbers(reviewedPages || []))) issues.push("reviewed_pages_invalid");
  const findingPages = Array.isArray(findings) ? findings.map((finding) => finding?.page) : [];
  if (!Array.isArray(findings) || !findings.length) issues.push("findings_missing");
  else {
    if (stableStringify(findingPages) !== stableStringify(reviewedPages || [])) issues.push("reviewed_pages_findings_mismatch");
    if (new Set(findingPages).size !== findingPages.length) issues.push("duplicate_page_findings");
    const normalized = [];
    for (const finding of findings) {
      if (!Number.isInteger(finding?.page) || finding.page < 1) issues.push("finding_page_invalid");
      if (!FINDING_CONCLUSIONS.has(finding?.conclusion)) issues.push(`page_${finding?.page || "unknown"}_conclusion_invalid`);
      for (const issue of evidenceTextIssues(finding?.observation, { page: finding?.page })) {
        issues.push(`page_${finding?.page || "unknown"}_${issue}`);
      }
      normalized.push(normalizedObservation(finding?.observation));
    }
    if (new Set(normalized).size !== normalized.length) issues.push("duplicate_page_observations");
  }
  const requiredPages = input?.visualQa?.requiredPages || [];
  if (disposition === "accepted") {
    if (stableStringify(reviewedPages || []) !== stableStringify(requiredPages)) issues.push("accepted_required_page_coverage_incomplete");
    if ((findings || []).some((finding) => finding.conclusion !== "accept")) issues.push("accepted_with_reject_finding");
  }
  if (disposition === "rejected") {
    if (!(findings || []).some((finding) => finding.conclusion === "reject")) issues.push("rejected_without_reject_finding");
    if ((reviewedPages || []).some((page) => !requiredPages.includes(page))) issues.push("rejected_page_not_required");
  }
  for (const issue of evidenceTextIssues(rationale, { rationale: true })) issues.push(`rationale_${issue}`);
  const rationaleText = String(rationale || "").toLocaleLowerCase("en-US");
  if (input && !rationaleText.includes(String(input.canonicalDoi || "").toLocaleLowerCase("en-US"))
    && !rationaleText.includes(String(input.paperId || "").toLocaleLowerCase("en-US"))
    && !rationaleText.includes(String(input.repairInputDigest || "").slice(0, 12))) issues.push("rationale_paper_identity_missing");
  if (supersedes !== null) {
    if (typeof supersedes !== "object" || !SHA256_PATTERN.test(supersedes.sha256 || "")
      || !SHA256_PATTERN.test(supersedes.recordDigest || "") || typeof supersedes.path !== "string") issues.push("supersedes_invalid");
  }
  return [...new Set(issues)].sort();
}

export function extractionRepairAdjudicationRecordDigest(record) {
  const { recordDigest: ignored, ...body } = record;
  return sha256(stableStringify(body));
}

export function extractionRepairAdjudicationRelativePath(paperId, inputDigest, recordDigest) {
  assertSafeId(paperId);
  assertSha256(inputDigest, "adjudication input digest");
  assertSha256(recordDigest, "adjudication record digest");
  return path.posix.join(ADJUDICATION_DIR, paperId, inputDigest, `${recordDigest}.json`);
}

export function makeExtractionRepairAdjudicationRecord({
  input,
  disposition,
  reviewerId,
  reviewer,
  reviewedPages,
  findings,
  rationale,
  attestIndependent,
  supersedes = null,
  createdAt = new Date().toISOString()
}) {
  assertEqual(input?.schemaVersion === 1 && input.stage === "extractionRepairAdjudicationInput", "Adjudication input is invalid");
  const sidecars = new Map(input.visualQa.sidecars.map((item) => [item.page, item]));
  const boundFindings = findings.map((finding) => {
    const sidecar = sidecars.get(finding.page);
    return {
      page: finding.page,
      conclusion: finding.conclusion,
      sidecarPath: sidecar?.sidecarPath || null,
      sidecarSha256: sidecar?.sidecarSha256 || null,
      cropPath: sidecar?.cropPath || null,
      cropSha256: sidecar?.cropSha256 || null,
      observation: finding.observation.trim()
    };
  });
  const record = {
    schemaVersion: 1,
    stage: "extractionRepairAdjudication",
    producer: "scripts/extraction-repair-adjudication.mjs",
    producerVersion: EXTRACTION_REPAIR_ADJUDICATION_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256,
    policySha256: EXTRACTION_REPAIR_ADJUDICATION_POLICY_SHA256,
    paperId: input.paperId,
    canonicalDoi: input.canonicalDoi,
    repairInputDigest: input.repairInputDigest,
    adjudicationInputDigest: repairAdjudicationInputDigest(input),
    adjudicationInput: input,
    disposition,
    reviewedPages: [...reviewedPages],
    findings: boundFindings,
    reviewer: { id: reviewerId.trim(), name: reviewer.trim() },
    independenceAttestation: {
      attested: attestIndependent === true,
      reviewerIsIndependent: attestIndependent === true,
      notAVisualEvidenceReviewer: attestIndependent === true
    },
    rationale: rationale.trim(),
    supersedes,
    createdAt
  };
  const issues = extractionRepairAdjudicationContentIssues({
    input: record.adjudicationInput,
    disposition: record.disposition,
    reviewer: record.reviewer,
    reviewedPages: record.reviewedPages,
    findings: record.findings,
    rationale: record.rationale,
    independenceAttestation: record.independenceAttestation,
    supersedes: record.supersedes
  });
  if (issues.length) throw new Error(`${input.paperId}: invalid repair adjudication evidence (${issues.join(", ")})`);
  assertEqual(!Number.isNaN(Date.parse(createdAt)) && new Date(createdAt).toISOString() === createdAt, `${input.paperId}: createdAt must be canonical ISO-8601`);
  record.recordDigest = extractionRepairAdjudicationRecordDigest(record);
  return record;
}

function exactKeys(value, expected) {
  return stableStringify(Object.keys(value || {}).sort()) === stableStringify([...expected].sort());
}

function recordSchemaIssues(record) {
  const issues = [];
  const topKeys = [
    "schemaVersion", "stage", "producer", "producerVersion", "producerCodeSha256", "policySha256",
    "paperId", "canonicalDoi", "repairInputDigest", "adjudicationInputDigest", "adjudicationInput",
    "disposition", "reviewedPages", "findings", "reviewer", "independenceAttestation", "rationale",
    "supersedes", "createdAt", "recordDigest"
  ];
  if (!exactKeys(record, topKeys)) issues.push("record_keys_invalid");
  if (record?.schemaVersion !== 1 || record.stage !== "extractionRepairAdjudication") issues.push("record_schema_stage_invalid");
  if (record?.producer !== "scripts/extraction-repair-adjudication.mjs"
    || record.producerVersion !== EXTRACTION_REPAIR_ADJUDICATION_VERSION
    || record.producerCodeSha256 !== EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256
    || record.policySha256 !== EXTRACTION_REPAIR_ADJUDICATION_POLICY_SHA256) issues.push("record_producer_policy_invalid");
  if (!exactKeys(record?.reviewer, ["id", "name"])) issues.push("reviewer_keys_invalid");
  if (!exactKeys(record?.independenceAttestation, ["attested", "reviewerIsIndependent", "notAVisualEvidenceReviewer"])) {
    issues.push("independence_attestation_keys_invalid");
  }
  for (const finding of record?.findings || []) {
    if (!exactKeys(finding, ["page", "conclusion", "sidecarPath", "sidecarSha256", "cropPath", "cropSha256", "observation"])) {
      issues.push("finding_keys_invalid");
    }
  }
  if (record?.supersedes !== null && !exactKeys(record?.supersedes, ["path", "sha256", "recordDigest"])) issues.push("supersedes_keys_invalid");
  if (!SHA256_PATTERN.test(record?.recordDigest || "") || extractionRepairAdjudicationRecordDigest(record) !== record.recordDigest) {
    issues.push("record_digest_mismatch");
  }
  if (!SHA256_PATTERN.test(record?.adjudicationInputDigest || "")
    || repairAdjudicationInputDigest(record?.adjudicationInput) !== record.adjudicationInputDigest) issues.push("adjudication_input_digest_mismatch");
  if (record?.paperId !== record?.adjudicationInput?.paperId
    || record?.canonicalDoi !== record?.adjudicationInput?.canonicalDoi
    || record?.repairInputDigest !== record?.adjudicationInput?.repairInputDigest) issues.push("record_input_identity_mismatch");
  if (Number.isNaN(Date.parse(record?.createdAt)) || new Date(record.createdAt).toISOString() !== record.createdAt) issues.push("created_at_invalid");
  const contentIssues = extractionRepairAdjudicationContentIssues({
    input: record?.adjudicationInput,
    disposition: record?.disposition,
    reviewer: record?.reviewer,
    reviewedPages: record?.reviewedPages,
    findings: record?.findings,
    rationale: record?.rationale,
    independenceAttestation: record?.independenceAttestation,
    supersedes: record?.supersedes
  });
  issues.push(...contentIssues);
  const sidecars = new Map((record?.adjudicationInput?.visualQa?.sidecars || []).map((item) => [item.page, item]));
  for (const finding of record?.findings || []) {
    const sidecar = sidecars.get(finding.page);
    if (!sidecar || finding.sidecarPath !== sidecar.sidecarPath || finding.sidecarSha256 !== sidecar.sidecarSha256
      || finding.cropPath !== sidecar.cropPath || finding.cropSha256 !== sidecar.cropSha256) issues.push(`page_${finding.page}_visual_binding_mismatch`);
  }
  return [...new Set(issues)].sort();
}

async function loadRecordEnvelope(root, relativePath) {
  const loaded = await readCanonicalJson(root, relativePath, `repair adjudication ${relativePath}`);
  const record = loaded.value;
  const issues = recordSchemaIssues(record);
  const expectedPath = SHA256_PATTERN.test(record?.recordDigest || "")
    && SHA256_PATTERN.test(record?.adjudicationInputDigest || "")
    && SAFE_ID_PATTERN.test(record?.paperId || "")
    ? extractionRepairAdjudicationRelativePath(record.paperId, record.adjudicationInputDigest, record.recordDigest)
    : null;
  if (expectedPath !== relativePath) issues.push("record_path_mismatch");
  return { relativePath, sha256: loaded.sha256, record, issues: [...new Set(issues)].sort() };
}

async function listRecordEnvelopes(root, paperId, inputDigest) {
  const relativeDirectory = path.posix.join(ADJUDICATION_DIR, paperId, inputDigest);
  const directory = absoluteFromRelative(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const names = [];
  for (const entry of entries) {
    if (RECORD_FILE_PATTERN.test(entry.name)) {
      if (!entry.isFile()) throw new Error(`${paperId}: adjudication record path is not a regular file (${entry.name})`);
      names.push(entry.name);
    } else if (entry.name.endsWith(".json") && entry.name !== ".adjudicate.lock.json") {
      throw new Error(`${paperId}: unexpected JSON file in adjudication content directory (${entry.name})`);
    }
  }
  names.sort();
  const records = [];
  for (const name of names) records.push(await loadRecordEnvelope(root, path.posix.join(relativeDirectory, name)));
  return records;
}

function inspectRecordGraph(envelopes, expectedInput) {
  const issues = [];
  const byPath = new Map(envelopes.map((entry) => [entry.relativePath, entry]));
  const superseded = new Map();
  for (const envelope of envelopes) {
    issues.push(...envelope.issues.map((issue) => `${path.posix.basename(envelope.relativePath)}:${issue}`));
    if (stableStringify(envelope.record.adjudicationInput) !== stableStringify(expectedInput)) {
      issues.push(`${path.posix.basename(envelope.relativePath)}:current_input_mismatch`);
    }
    const prior = envelope.record.supersedes;
    if (prior) {
      const target = byPath.get(prior.path);
      if (!target || target.sha256 !== prior.sha256 || target.record.recordDigest !== prior.recordDigest) {
        issues.push(`${path.posix.basename(envelope.relativePath)}:supersedes_target_invalid`);
      } else {
        const children = superseded.get(prior.path) || [];
        children.push(envelope.relativePath);
        superseded.set(prior.path, children);
      }
    }
  }
  for (const [target, children] of superseded) if (children.length > 1) issues.push(`${path.posix.basename(target)}:supersedes_fork`);
  for (const envelope of envelopes) {
    const seen = new Set([envelope.relativePath]);
    let cursor = envelope;
    while (cursor.record.supersedes) {
      const nextPath = cursor.record.supersedes.path;
      if (seen.has(nextPath)) {
        issues.push(`${path.posix.basename(envelope.relativePath)}:supersedes_cycle`);
        break;
      }
      seen.add(nextPath);
      const next = byPath.get(nextPath);
      if (!next) break;
      cursor = next;
    }
  }
  const terminals = envelopes.filter((entry) => !superseded.has(entry.relativePath));
  if (envelopes.length && terminals.length !== 1) issues.push("terminal_record_count_invalid");
  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)].sort(),
    terminals,
    current: issues.length === 0 && terminals.length === 1 ? terminals[0] : null
  };
}

export async function inspectExtractionRepairAdjudication({
  root = SCRIPT_ROOT,
  paper,
  repairInputDigest,
  adjudicationPath = "",
  requireAdjudicated = false
}) {
  root = path.resolve(root);
  try {
    const input = await buildExtractionRepairAdjudicationInput({ root, paper, repairInputDigest });
    const inputDigest = repairAdjudicationInputDigest(input);
    const envelopes = await listRecordEnvelopes(root, input.paperId, inputDigest);
    const graph = inspectRecordGraph(envelopes, input);
    if (adjudicationPath) {
      absoluteFromRelative(root, adjudicationPath);
      const selected = envelopes.find((entry) => entry.relativePath === adjudicationPath);
      if (!selected) graph.issues.push("requested_record_not_found_for_current_input");
      else if (graph.current?.relativePath !== adjudicationPath) graph.issues.push("requested_record_is_not_current_terminal");
      if (graph.issues.length) {
        graph.ok = false;
        graph.current = null;
        graph.issues = [...new Set(graph.issues)].sort();
      }
    }
    const current = graph.current;
    const ok = graph.ok && (!requireAdjudicated || Boolean(current));
    return {
      schemaVersion: 1,
      producerVersion: EXTRACTION_REPAIR_ADJUDICATION_VERSION,
      producerCodeSha256: EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256,
      paperId: input.paperId,
      repairInputDigest,
      adjudicationInputDigest: inputDigest,
      evidenceState: input.visualQa.state,
      state: !graph.ok ? "failed_closed"
        : current ? `adjudicated_${current.record.disposition}`
          : "eligible_for_manual_adjudication",
      ok,
      adjudicated: Boolean(current),
      promotionEligibility: false,
      reason: !graph.ok ? "invalid_or_ambiguous_adjudication_chain"
        : requireAdjudicated && !current ? "no_current_adjudication"
          : "",
      issues: graph.issues,
      current: current ? {
        path: current.relativePath,
        sha256: current.sha256,
        recordDigest: current.record.recordDigest,
        disposition: current.record.disposition,
        reviewer: current.record.reviewer,
        supersedes: current.record.supersedes
      } : null,
      records: envelopes.map((entry) => ({
        path: entry.relativePath,
        sha256: entry.sha256,
        recordDigest: entry.record.recordDigest,
        disposition: entry.record.disposition,
        supersedes: entry.record.supersedes,
        issues: entry.issues
      }))
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      producerVersion: EXTRACTION_REPAIR_ADJUDICATION_VERSION,
      paperId: String(paper || ""),
      repairInputDigest,
      state: "failed_closed",
      ok: false,
      adjudicated: false,
      promotionEligibility: false,
      reason: "evidence_validation_failed",
      issues: [error.message],
      current: null,
      records: []
    };
  }
}

async function writeBytesExclusive(root, relativePath, bytes) {
  const target = absoluteFromRelative(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
    return { changed: true, path: relativePath };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readFile(target);
    if (!existing.equals(bytes)) throw new Error(`Exclusive-create conflict at ${relativePath}`);
    return { changed: false, path: relativePath };
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function writeExtractionRepairAdjudicationExclusive(root, record) {
  const issues = recordSchemaIssues(record);
  if (issues.length) throw new Error(`${record?.paperId || "unknown"}: invalid adjudication record (${issues.join(", ")})`);
  const relativePath = extractionRepairAdjudicationRelativePath(
    record.paperId,
    record.adjudicationInputDigest,
    record.recordDigest
  );
  const bytes = Buffer.from(`${stableStringify(record, 2)}\n`, "utf8");
  const result = await writeBytesExclusive(path.resolve(root), relativePath, bytes);
  const verified = await loadRecordEnvelope(path.resolve(root), relativePath);
  if (verified.issues.length || verified.sha256 !== sha256(bytes)) {
    throw new Error(`${record.paperId}: adjudication record failed post-write verification (${verified.issues.join(", ")})`);
  }
  return { ...result, sha256: verified.sha256, recordDigest: record.recordDigest };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function acquireAdjudicationLock(root, paperId, inputDigest) {
  const directory = path.posix.join(ADJUDICATION_DIR, paperId, inputDigest);
  const lockPath = path.posix.join(directory, ".adjudicate.lock.json");
  const absoluteLock = absoluteFromRelative(root, lockPath);
  await mkdir(path.dirname(absoluteLock), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const owner = {
      schemaVersion: EXTRACTION_REPAIR_ADJUDICATION_LOCK_VERSION,
      stage: "extractionRepairAdjudicationLock",
      paperId,
      adjudicationInputDigest: inputDigest,
      hostname: os.hostname(),
      pid: process.pid,
      token: randomUUID(),
      producerCodeSha256: EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256
    };
    const ownerBytes = Buffer.from(`${stableStringify(owner, 2)}\n`, "utf8");
    const temporary = `${absoluteLock}.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(ownerBytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, absoluteLock);
      await unlink(temporary);
      return {
        relativePath: lockPath,
        async release() {
          const current = await readFile(absoluteLock).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
          if (current && current.equals(ownerBytes)) await unlink(absoluteLock);
          else if (current) throw new Error(`${paperId}: adjudication lock ownership changed before release`);
        }
      };
    } catch (error) {
      await unlink(temporary).catch((unlinkError) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
      if (error.code !== "EEXIST") throw error;
      let existingBytes;
      let existing;
      try {
        existingBytes = await readFile(absoluteLock);
        existing = JSON.parse(existingBytes.toString("utf8"));
      } catch (readError) {
        throw new Error(`${paperId}: existing adjudication lock is unreadable; refusing recovery (${readError.message})`);
      }
      const canonical = Buffer.from(`${stableStringify(existing, 2)}\n`, "utf8");
      const valid = existingBytes.equals(canonical)
        && existing.schemaVersion === EXTRACTION_REPAIR_ADJUDICATION_LOCK_VERSION
        && existing.stage === "extractionRepairAdjudicationLock"
        && existing.paperId === paperId
        && existing.adjudicationInputDigest === inputDigest
        && typeof existing.hostname === "string"
        && Number.isSafeInteger(existing.pid) && existing.pid > 0
        && typeof existing.token === "string" && existing.token.length >= 16
        && SHA256_PATTERN.test(existing.producerCodeSha256 || "");
      if (!valid) throw new Error(`${paperId}: existing adjudication lock is invalid; refusing recovery`);
      if (existing.hostname !== os.hostname()) throw new Error(`${paperId}: adjudication lock belongs to unprobeable host ${existing.hostname}`);
      if (processAlive(existing.pid)) throw new Error(`${paperId}: adjudication lock is held by live PID ${existing.pid}`);
      const tombstoneDirectory = absoluteFromRelative(root, path.posix.join(directory, ".recovered-locks"));
      await mkdir(tombstoneDirectory, { recursive: true });
      const tombstone = path.join(tombstoneDirectory, `${sha256(existingBytes)}.json`);
      try {
        await link(absoluteLock, tombstone);
      } catch (linkError) {
        if (linkError.code !== "EEXIST") throw linkError;
        const tombstoneBytes = await readFile(tombstone);
        if (!tombstoneBytes.equals(existingBytes)) throw new Error(`${paperId}: stale-lock recovery tombstone conflict`);
      }
      const currentBytes = await readFile(absoluteLock);
      if (!currentBytes.equals(existingBytes)) throw new Error(`${paperId}: adjudication lock changed during recovery`);
      await unlink(absoluteLock);
    }
  }
  throw new Error(`${paperId}: adjudication lock contention did not settle`);
}

function supersedesBinding(envelope) {
  return {
    path: envelope.relativePath,
    sha256: envelope.sha256,
    recordDigest: envelope.record.recordDigest
  };
}

function resolveRequestedSupersedes(envelopes, graph, requestedPath) {
  if (!graph.ok) throw new Error(`Existing adjudication chain is invalid (${graph.issues.join(", ")})`);
  if (!envelopes.length) {
    if (requestedPath) throw new Error("--supersedes was provided but no prior adjudication exists for this input");
    return null;
  }
  if (!requestedPath) throw new Error(`A prior adjudication exists; --supersedes ${graph.current.relativePath} is required`);
  if (requestedPath !== graph.current.relativePath) throw new Error("--supersedes must identify the one current terminal adjudication");
  return supersedesBinding(graph.current);
}

export async function adjudicateExtractionRepair(options) {
  const root = path.resolve(options.root || SCRIPT_ROOT);
  const initialInput = await buildExtractionRepairAdjudicationInput({
    root,
    paper: options.paper,
    repairInputDigest: options.repairInputDigest
  });
  const inputDigest = repairAdjudicationInputDigest(initialInput);
  const lock = await acquireAdjudicationLock(root, initialInput.paperId, inputDigest);
  try {
    const currentInput = await buildExtractionRepairAdjudicationInput({
      root,
      paper: options.paper,
      repairInputDigest: options.repairInputDigest
    });
    assertEqual(stableStringify(currentInput) === stableStringify(initialInput), `${initialInput.paperId}: adjudication inputs drifted before commit`);
    assertEqual(sha256(await readFile(SCRIPT_PATH)) === EXTRACTION_REPAIR_ADJUDICATION_CODE_SHA256, `${initialInput.paperId}: adjudication code changed before commit`);
    const existing = await listRecordEnvelopes(root, initialInput.paperId, inputDigest);
    const graph = inspectRecordGraph(existing, initialInput);
    const supersedes = resolveRequestedSupersedes(existing, graph, options.supersedes || "");
    const record = makeExtractionRepairAdjudicationRecord({
      input: initialInput,
      disposition: options.disposition,
      reviewerId: options.reviewerId,
      reviewer: options.reviewer,
      reviewedPages: options.reviewedPages,
      findings: options.findings,
      rationale: options.rationale,
      attestIndependent: options.attestIndependent,
      supersedes
    });
    const written = await writeExtractionRepairAdjudicationExclusive(root, record);
    const verified = await inspectExtractionRepairAdjudication({
      root,
      paper: initialInput.paperId,
      repairInputDigest: options.repairInputDigest,
      requireAdjudicated: true
    });
    if (!verified.ok || verified.current?.path !== written.path) {
      throw new Error(`${initialInput.paperId}: adjudication failed post-commit chain verification`);
    }
    return {
      schemaVersion: 1,
      producerVersion: EXTRACTION_REPAIR_ADJUDICATION_VERSION,
      paperId: initialInput.paperId,
      recorded: true,
      changed: written.changed,
      disposition: record.disposition,
      adjudicationInputDigest: inputDigest,
      adjudicationPath: written.path,
      adjudicationSha256: written.sha256,
      recordDigest: written.recordDigest,
      supersedes,
      state: verified.state,
      ok: true,
      promotionEligibility: false
    };
  } finally {
    await lock.release();
  }
}

export async function runExtractionRepairAdjudication(options) {
  if (options.command === "adjudicate") return adjudicateExtractionRepair(options);
  return inspectExtractionRepairAdjudication({
    root: options.root,
    paper: options.paper,
    repairInputDigest: options.repairInputDigest,
    adjudicationPath: options.adjudicationPath,
    requireAdjudicated: options.command === "check"
  });
}

function usage() {
  return `Usage:
  node scripts/extraction-repair-adjudication.mjs inspect --paper ID_OR_DOI --repair-digest SHA256 [--record RELATIVE_PATH] [--json]
  node scripts/extraction-repair-adjudication.mjs check --paper ID_OR_DOI --repair-digest SHA256 [--record RELATIVE_PATH] [--json]
  node scripts/extraction-repair-adjudication.mjs adjudicate --paper ID_OR_DOI --repair-digest SHA256 (--accept|--reject) --reviewer-id STABLE_ID --reviewer NAME --pages N[,N...|N-M] --finding "PAGE|accept|CONCRETE_OBSERVATION" [--finding ...] --rationale TEXT --attest-independent [--supersedes RELATIVE_RECORD_PATH] [--json]

inspect and check are read-only. check succeeds only when the current evidence has one valid terminal adjudication.
adjudicate is the only write command. It creates an immutable content-addressed record and never mutates a
candidate, production extraction, QA decision, paper ledger, authoring artifact, or public artifact. An accepted
record still reports promotionEligibility=false; promotion is a separate operation not provided by this script.`;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.recorded) {
    console.log(`Repair adjudication recorded for ${result.paperId}: ${result.disposition} (${result.adjudicationPath}).`);
    console.log("  Promotion eligibility remains false; promotion is a separate operation.");
    return;
  }
  console.log(`Repair adjudication ${result.ok ? "valid" : "failed"} for ${result.paperId}: ${result.state}.`);
  if (result.reason) console.log(`  reason: ${result.reason}`);
  if (result.issues?.length) console.log(`  issues: ${result.issues.join("; ")}`);
}

async function main() {
  const options = parseExtractionRepairAdjudicationCli(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await runExtractionRepairAdjudication(options);
  printResult(result, options.json);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
