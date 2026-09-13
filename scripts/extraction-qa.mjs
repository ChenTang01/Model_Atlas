import { createHash } from "node:crypto";
import {
  open,
  readFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  atomicWriteJson,
  EXTRACTION_POLICY,
  EXTRACTOR_CODE_SHA256,
  extractionCorruptionProfile,
  makeRepairPromotionExtractQaStage,
  normalizeDoi,
  preferFallbackExtraction,
  repairPromotionExtractionContractIssues,
  sha256,
  stableStringify
} from "./corpus-pipeline.mjs";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS = new Set(["status", "review", "check", "adjudicate"]);
const TERMINAL_QA_STATUSES = new Set(["complete", "needs_review"]);
export const EXTRACTION_QA_BINDING_KEYS = Object.freeze([
  "extractionQaStatus",
  "extractionQaAutomatedStatus",
  "extractionQaInputDigest",
  "extractionQaDecisionPath",
  "extractionQaDecisionSha256",
  "extractionQaAdjudicationStatus",
  "extractionQaAdjudicationPath",
  "extractionQaAdjudicationSha256"
]);
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "with",
  "by", "from", "through", "under", "when", "how", "is", "are", "as", "at", "vs"
]);

export const EXTRACTION_QA_VERSION = "extraction-qa-v1";
export const EXTRACTION_QA_POLICY = Object.freeze({
  schemaVersion: 1,
  version: EXTRACTION_QA_VERSION,
  minimumTitleTokenRecall: 0.75,
  minimumLetterFraction: 0.7,
  minimumTotalCharacters: EXTRACTION_POLICY.fallbackAcceptance.minimumTotalCharacters,
  minimumCharactersPerPage: EXTRACTION_POLICY.fallbackAcceptance.minimumCharactersPerPage,
  minimumNonemptyPageFraction: EXTRACTION_POLICY.fallbackAcceptance.minimumNonemptyPageFraction,
  minimumFallbackPrimaryFraction: EXTRACTION_POLICY.fallbackAcceptance.minimumPrimaryCharacterFraction,
  replacementCharacterReviewThreshold: EXTRACTION_POLICY.corruptionTrigger.minimumReplacementCharacters,
  manualReviewTriggers: Object.freeze([
    "parser_warning",
    "page_extraction_error",
    "empty_extracted_page",
    "low_text_yield",
    "primary_legacy_font_map",
    "repair_promotion_requires_authoritative_qa",
    "selected_legacy_font_map",
    "selected_replacement_characters",
    "title_identity_not_verified",
    "low_letter_fraction",
    "unclassified_extraction_warning"
  ])
});
export const EXTRACTION_QA_POLICY_SHA256 = sha256(stableStringify(EXTRACTION_QA_POLICY));
export const EXTRACTION_QA_CODE_SHA256 = sha256(await readFile(fileURLToPath(import.meta.url)));

function compareOrdinal(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

export function parseExtractionQaCli(argv) {
  const options = {
    command: null,
    root: SCRIPT_ROOT,
    papers: [],
    from: "",
    limit: null,
    jobs: Math.max(1, Math.min(4, os.cpus().length)),
    dryRun: false,
    force: false,
    check: false,
    adjudication: "",
    reviewer: "",
    rationale: "",
    reviewedPages: [],
    findings: [],
    json: false,
    help: false
  };
  let selected = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (COMMANDS.has(argument)) {
      if (options.command && options.command !== argument) throw new Error("Only one Extraction QA command may be selected");
      options.command = argument;
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
      case "--select": selected = takeValue(); break;
      case "--root": options.root = path.resolve(takeValue()); break;
      case "--paper":
      case "--id": options.papers.push(...takeValue().split(",").map((value) => value.trim()).filter(Boolean)); break;
      case "--from": options.from = takeValue().trim(); break;
      case "--limit": options.limit = positiveInteger(takeValue(), "--limit"); break;
      case "--jobs": options.jobs = positiveInteger(takeValue(), "--jobs"); break;
      case "--dry-run": options.dryRun = true; break;
      case "--force": options.force = true; break;
      case "--check": options.check = true; break;
      case "--accept":
        if (options.adjudication) throw new Error("Only one of --accept or --reject may be supplied");
        options.adjudication = "accepted";
        break;
      case "--reject":
        if (options.adjudication) throw new Error("Only one of --accept or --reject may be supplied");
        options.adjudication = "rejected";
        break;
      case "--reviewer": options.reviewer = takeValue().trim(); break;
      case "--rationale": options.rationale = takeValue().trim(); break;
      case "--pages": options.reviewedPages.push(...takeValue().split(",").map((value) => positiveInteger(value.trim(), "--pages"))); break;
      case "--finding": options.findings.push(parseAdjudicationFinding(takeValue())); break;
      case "--json": options.json = true; break;
      case "--help":
      case "-h": options.help = true; break;
      default: throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (selected && !COMMANDS.has(selected)) throw new Error(`Unknown selector: ${selected}`);
  if (selected && options.command && selected !== options.command) {
    throw new Error(`Conflicting Extraction QA selectors: ${options.command} and ${selected}`);
  }
  options.command = selected || options.command || "status";
  if (options.command === "check") {
    options.command = "review";
    options.check = true;
  }
  if (options.command !== "review" && (options.dryRun || options.force || options.check)) {
    throw new Error("--dry-run, --force, and --check are review-only options");
  }
  const hasAdjudicationOptions = Boolean(options.adjudication || options.reviewer || options.rationale || options.reviewedPages.length || options.findings.length);
  if (options.command !== "adjudicate" && hasAdjudicationOptions) {
    throw new Error("--accept, --reject, --reviewer, --rationale, --pages, and --finding are adjudicate-only options");
  }
  if (options.command === "adjudicate") {
    if (options.papers.length !== 1 || options.from || options.limit) throw new Error("adjudicate requires exactly one --paper and does not accept --from or --limit");
    if (!options.adjudication) throw new Error("adjudicate requires exactly one of --accept or --reject");
    options.reviewedPages = [...new Set(options.reviewedPages)].sort((a, b) => a - b);
    options.findings.sort((a, b) => a.page - b.page);
    const contentIssues = adjudicationContentIssues(options);
    if (contentIssues.length) throw new Error(`Invalid adjudication evidence: ${contentIssues.join(", ")}`);
  }
  if (options.check && options.dryRun) throw new Error("--check and --dry-run are mutually exclusive");
  if (options.check && options.force) throw new Error("--check and --force are mutually exclusive");
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
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
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function countBy(items, keyOf) {
  const result = {};
  for (const item of items) {
    const key = String(keyOf(item));
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => compareOrdinal(a, b)));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort(compareOrdinal);
}

function assertSafePaperId(value) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(String(value))) throw new Error(`Unsafe paper ID for checkpoint path: ${value}`);
}

function samePath(a, b) {
  if (process.platform === "win32") return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function resolveBoundPath(root, relativePath, expectedRelativePath, errorCode, errors) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    errors.push({ code: errorCode, detail: "missing_or_absolute_path" });
    return "";
  }
  const resolved = path.resolve(root, ...String(relativePath).split("/"));
  const containment = path.relative(root, resolved);
  if (containment.startsWith("..") || path.isAbsolute(containment)) {
    errors.push({ code: errorCode, detail: "path_outside_root" });
    return "";
  }
  const expected = path.resolve(root, ...String(expectedRelativePath).split("/"));
  if (!samePath(resolved, expected)) {
    errors.push({ code: errorCode, detail: "unexpected_artifact_path" });
    return "";
  }
  return resolved;
}

function titleTokens(value) {
  return uniqueSorted(String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
}

function evidenceWords(value) {
  return (String(value || "").normalize("NFKC").toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((word) => word.length >= 3);
}

function evidenceTextIssues(value, { rationale = false } = {}) {
  const text = String(value || "").trim();
  const words = evidenceWords(text);
  const uniqueWords = new Set(words);
  const counts = countBy(words, (word) => word);
  const maxFrequency = Math.max(0, ...Object.values(counts));
  const visualTerms = new Set(["pdf", "render", "rendered", "source", "visual", "visually"]);
  const comparisonTerms = new Set([
    "absent", "align", "aligned", "compare", "compared", "comparison", "confirm", "confirmed",
    "contrast", "contrasted", "inspect", "inspected", "match", "matched", "preserve", "preserved",
    "retain", "retained", "verify", "verified", "visible", "visibly"
  ]);
  const concreteFeatureTerms = new Set([
    "author", "caption", "character", "column", "equation", "figure", "font", "formula", "glyph",
    "heading", "layout", "line", "paragraph", "punctuation", "reference", "spacing", "symbol", "table", "title"
  ]);
  const issues = [];
  if (text.length < (rationale ? 60 : 45)) issues.push("text_too_short");
  if (words.length < (rationale ? 12 : 8) || uniqueWords.size < (rationale ? 8 : 6)) issues.push("low_word_diversity");
  if (maxFrequency > Math.max(3, Math.ceil(words.length * 0.35))) issues.push("repetitive_wording");
  if (/(.)\1{7,}/iu.test(text)) issues.push("repeated_characters");
  if (/\b(?:looks? good|all good|seems? fine|no issues?|reviewed and (?:accepted|fine|good|okay)|appears? correct|everything is fine)\b/iu.test(text)) {
    issues.push("placeholder_or_boilerplate");
  }
  if (!words.some((word) => visualTerms.has(word))) issues.push("visual_comparison_not_described");
  if (!words.some((word) => comparisonTerms.has(word))) issues.push("comparison_result_not_described");
  if (!words.some((word) => concreteFeatureTerms.has(word))) issues.push("concrete_feature_missing");
  return uniqueSorted(issues);
}

const REASON_EVIDENCE_PATTERNS = Object.freeze({
  parser_warning: /\b(?:caption|character|column|equation|figure|font|formula|glyph|heading|layout|line|paragraph|punctuation|spacing|symbol|table|title)\b/iu,
  page_extraction_error: /\b(?:blank|caption|equation|figure|heading|line|missing|omission|paragraph|table)\b/iu,
  empty_extracted_page: /\b(?:blank|caption|content|empty|equation|figure|heading|paragraph|table)\b/iu,
  low_text_yield: /\b(?:appendix|caption|column|equation|figure|formula|heading|line|paragraph|reference|table)\b/iu,
  primary_legacy_font_map: /\b(?:character|equation|font|formula|glyph|heading|letter|punctuation|symbol)\b/iu,
  selected_legacy_font_map: /\b(?:character|equation|font|formula|glyph|heading|letter|punctuation|symbol)\b/iu,
  selected_replacement_characters: /\b(?:character|equation|formula|glyph|replacement|symbol)\b/iu,
  title_identity_not_verified: /\b(?:author|heading|journal|title)\b/iu,
  low_letter_fraction: /\b(?:character|equation|formula|glyph|letter|prose|symbol|word)\b/iu,
  unclassified_extraction_warning: /\b(?:caption|character|column|equation|figure|font|formula|glyph|heading|layout|line|paragraph|punctuation|spacing|symbol|table|title)\b/iu
});

function parseAdjudicationFinding(value) {
  const [pageText, conclusion, reasonText, ...observationParts] = String(value || "").split("|");
  const page = positiveInteger(pageText, "--finding page");
  if (!["accept", "reject"].includes(conclusion)) throw new Error("--finding conclusion must be accept or reject");
  const reasonCodes = uniqueSorted(String(reasonText || "").split(",").map((reason) => reason.trim()).filter(Boolean));
  const observation = observationParts.join("|").trim();
  if (!reasonCodes.length || !observation) {
    throw new Error("--finding must use PAGE|CONCLUSION|REASON[,REASON...]|CONCRETE_OBSERVATION format");
  }
  return { page, conclusion, reasonCodes, observation };
}

export function adjudicationContentIssues({ reviewer, rationale, reviewedPages, findings, record = null, decision = null, disposition = "" }) {
  const issues = [];
  if (typeof reviewer !== "string" || reviewer.trim().length < 3) issues.push("reviewer_invalid");
  issues.push(...evidenceTextIssues(rationale, { rationale: true }).map((issue) => `rationale_${issue}`));
  if (!Array.isArray(reviewedPages) || !reviewedPages.length
    || new Set(reviewedPages).size !== reviewedPages.length
    || reviewedPages.some((page) => !Number.isInteger(page) || page < 1)
    || stableStringify(reviewedPages) !== stableStringify([...(reviewedPages || [])].sort((a, b) => a - b))) {
    issues.push("reviewed_pages_invalid");
  }
  if (!Array.isArray(findings) || !findings.length) {
    issues.push("page_findings_missing");
  } else {
    const findingPages = findings.map((finding) => finding?.page);
    if (new Set(findingPages).size !== findingPages.length) issues.push("duplicate_page_findings");
    if (stableStringify(findingPages) !== stableStringify([...findingPages].sort((a, b) => a - b))) issues.push("page_findings_not_sorted");
    if (stableStringify(findingPages) !== stableStringify(reviewedPages || [])) issues.push("reviewed_pages_findings_mismatch");
    const normalizedObservations = [];
    for (const finding of findings) {
      if (!finding || !Number.isInteger(finding.page) || finding.page < 1) issues.push("page_finding_page_invalid");
      if (!["accept", "reject"].includes(finding?.conclusion)) issues.push("page_finding_conclusion_invalid");
      if (!Array.isArray(finding?.reasonCodes) || !finding.reasonCodes.length) issues.push("page_finding_reasons_missing");
      else if (stableStringify(finding.reasonCodes) !== stableStringify(uniqueSorted(finding.reasonCodes))) issues.push("page_finding_reasons_invalid");
      const textIssues = evidenceTextIssues(finding?.observation);
      issues.push(...textIssues.map((issue) => `page_${finding?.page || "unknown"}_${issue}`));
      const observation = String(finding?.observation || "");
      if (Number.isInteger(finding?.page)
        && !new RegExp(`\\bpage\\s*(?:no\\.?\\s*)?${finding.page}\\b`, "i").test(observation)) {
        issues.push("page_finding_page_reference_missing");
      }
      for (const reason of finding?.reasonCodes || []) {
        const pattern = REASON_EVIDENCE_PATTERNS[reason];
        if (pattern && !pattern.test(observation)) issues.push("page_finding_reason_evidence_missing");
      }
      normalizedObservations.push(observation.normalize("NFKC").toLowerCase()
        .replace(/\bpage\s*(?:no\.?\s*)?\d+\b/giu, "page #")
        .replace(/\s+/g, " ").trim());
    }
    if (new Set(normalizedObservations).size !== normalizedObservations.length) issues.push("duplicate_page_observations");
    if (disposition === "accepted" && findings.some((finding) => finding.conclusion !== "accept")) issues.push("accepted_with_reject_finding");
    if (disposition === "rejected" && !findings.some((finding) => finding.conclusion === "reject")) issues.push("rejected_without_reject_finding");
  }
  if (record) {
    if ((reviewedPages || []).some((page) => page > record.pdf.pageCount)) issues.push("reviewed_page_out_of_range");
    const rationaleText = String(rationale || "").toLowerCase();
    const identityTokens = titleTokens(record.title).filter((token) => token.length >= 5);
    if (!rationaleText.includes(String(record.canonicalDoi || "").toLowerCase())
      && !identityTokens.some((token) => rationaleText.includes(token))) issues.push("rationale_paper_identity_missing");
  }
  if (decision) {
    const requiredPages = decision.manualReviewRequirements?.requiredPages || [];
    if (requiredPages.some((page) => !(reviewedPages || []).includes(page))) issues.push("required_page_missing");
    const expectedReasons = new Set(decision.unresolvedReasons || []);
    for (const finding of findings || []) {
      if ((finding.reasonCodes || []).some((reason) => !expectedReasons.has(reason))) issues.push("unknown_finding_reason");
    }
    for (const requirement of decision.manualReviewRequirements?.triggerCoverage || []) {
      for (const page of requirement.requiredPages || []) {
        const finding = (findings || []).find((entry) => entry.page === page);
        if (!finding?.reasonCodes?.includes(requirement.reason)) issues.push("trigger_page_reason_not_covered");
      }
    }
    const rationaleText = String(rationale || "").toLowerCase();
    if (requiredPages.some((page) => !new RegExp(`\\bpage\\s*(?:no\\.?\\s*)?${page}\\b`, "i").test(rationaleText))) {
      issues.push("rationale_required_page_reference_missing");
    }
  }
  return uniqueSorted(issues);
}

function roundRatio(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function textEvidence(pages, title) {
  const texts = pages.map((page) => String(page.text));
  const combined = texts.join("\n");
  const totalCharacters = texts.reduce((sum, text) => sum + text.length, 0);
  const nonemptyPages = texts.filter((text) => text.trim()).length;
  const emptyPages = pages.filter((page) => !String(page.text).trim()).map((page) => page.page);
  const visibleCharacters = [...combined].filter((character) => !/\s/u.test(character)).length;
  const letterCharacters = (combined.match(/\p{L}/gu) || []).length;
  const c0Controls = (combined.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length;
  const c1Controls = (combined.match(/[\u0080-\u009F]/g) || []).length;
  const expectedTitleTokens = titleTokens(title);
  const firstPages = new Set(titleTokens(texts.slice(0, 3).join(" ")));
  const matchedTitleTokens = expectedTitleTokens.filter((token) => firstPages.has(token));
  return {
    totalCharacters,
    nonemptyPages,
    emptyPages,
    charactersPerPage: roundRatio(totalCharacters / Math.max(1, pages.length)),
    nonemptyPageFraction: roundRatio(nonemptyPages / Math.max(1, pages.length)),
    letterFraction: roundRatio(letterCharacters / Math.max(1, visibleCharacters)),
    c0ControlCharacters: c0Controls,
    c1ControlCharacters: c1Controls,
    titleTokenCount: expectedTitleTokens.length,
    matchedTitleTokenCount: matchedTitleTokens.length,
    titleTokenRecall: roundRatio(matchedTitleTokens.length / Math.max(1, expectedTitleTokens.length))
  };
}

function extractionSourceReasons(ledger) {
  const extraction = ledger.stages?.extraction || {};
  const qa = ledger.stages?.extractQa || {};
  const reasons = [];
  if (Number(extraction.parserWarningCount || 0) > 0 || (extraction.parserWarningCodes || []).length) reasons.push("parser_warning");
  if ((extraction.pageErrors || []).length) reasons.push("page_extraction_error");
  if ((extraction.emptyPages || []).length) reasons.push("empty_extracted_page");
  if (extraction.fallbackUsed) reasons.push("alternate_parser_fallback");
  if (Number(extraction.totalCharacters || 0) < EXTRACTION_QA_POLICY.minimumTotalCharacters
    || Number(extraction.totalCharacters || 0) / Math.max(1, Number(extraction.pageCount || 0)) < EXTRACTION_QA_POLICY.minimumCharactersPerPage) {
    reasons.push("low_text_yield");
  }
  const preserved = Array.isArray(qa.sourceReasons)
    ? qa.sourceReasons
    : qa.review
      ? []
      : Array.isArray(qa.reasons) ? qa.reasons : [];
  return uniqueSorted([...reasons, ...preserved]);
}

function expectedLegacyQaSnapshot(extraction) {
  const reasons = [];
  if (Number(extraction.parserWarningCount || 0) > 0) reasons.push("parser_warning");
  if ((extraction.pageErrors || []).length) reasons.push("page_extraction_error");
  if (extraction.fallbackUsed) reasons.push("alternate_parser_fallback");
  if ((extraction.emptyPages || []).length) reasons.push("empty_extracted_page");
  if (Number(extraction.totalCharacters || 0) < EXTRACTION_QA_POLICY.minimumTotalCharacters
    || Number(extraction.totalCharacters || 0) / Math.max(1, Number(extraction.pageCount || 0)) < EXTRACTION_QA_POLICY.minimumCharactersPerPage) {
    reasons.push("low_text_yield");
  }
  return {
    status: reasons.length ? "needs_review" : "complete",
    inputDigest: extraction.inputDigest || null,
    sourcePdfSha256: extraction.sourcePdfSha256 || null,
    reasons,
    warningCodes: extraction.parserWarningCodes || [],
    pageErrors: extraction.pageErrors || [],
    emptyPages: extraction.emptyPages || [],
    totalCharacters: Number(extraction.totalCharacters || 0),
    selectedEngine: extraction.selectedEngine,
    selectedEngineVersion: extraction.selectedEngineVersion,
    fallbackAttempted: Boolean(extraction.fallbackAttempted),
    fallbackUsed: Boolean(extraction.fallbackUsed),
    fallbackReason: extraction.fallbackReason || "",
    primaryCorruptionProfile: extraction.primaryCorruptionProfile || null,
    fallbackCorruptionProfile: extraction.fallbackCorruptionProfile || null,
    selectedCorruptionProfile: extraction.selectedCorruptionProfile || null
  };
}

export function extractionQaEvidenceDigest(ledger) {
  return sha256(stableStringify({
    schemaVersion: 1,
    extraction: ledger.stages?.extraction || null,
    legacyExtractQa: ledger.stages?.extractQa || null
  }));
}

export function extractionQaInput(record, ledger) {
  const extraction = ledger.stages?.extraction || {};
  return {
    schemaVersion: 1,
    stage: "extractQa",
    producerVersion: EXTRACTION_QA_VERSION,
    producerCodeSha256: EXTRACTION_QA_CODE_SHA256,
    policySha256: EXTRACTION_QA_POLICY_SHA256,
    paperId: record.id,
    manifestRecordDigest: record.recordDigest,
    sourcePdfSha256: record.pdf?.sha256 || null,
    extractionInputDigest: extraction.inputDigest || null,
    extractionPagesSha256: extraction.artifacts?.pagesSha256 || null,
    extractionTextSha256: extraction.artifacts?.textSha256 || null,
    extractionEvidenceSha256: extractionQaEvidenceDigest(ledger)
  };
}

export function extractionQaInputDigest(record, ledger) {
  return sha256(stableStringify(extractionQaInput(record, ledger)));
}

export function extractionQaDecisionRelativePath(record, ledger) {
  assertSafePaperId(record.id);
  return path.posix.join(
    "research",
    "ledger",
    "extraction-qa",
    record.id,
    `${extractionQaInputDigest(record, ledger)}.json`
  );
}

export function extractionQaAdjudicationRelativePath(record, inputDigest, decisionSha256) {
  assertSafePaperId(record.id);
  if (!/^[a-f0-9]{64}$/.test(inputDigest || "") || !/^[a-f0-9]{64}$/.test(decisionSha256 || "")) {
    throw new Error(`Invalid Extraction QA adjudication binding for ${record.id}`);
  }
  return path.posix.join(
    "research",
    "ledger",
    "extraction-qa-adjudications",
    record.id,
    inputDigest,
    `${decisionSha256}.json`
  );
}

function stableProfileEqual(a, b) {
  return stableStringify(a ?? null) === stableStringify(b ?? null);
}

function addMismatch(errors, condition, code, detail = "mismatch") {
  if (condition) errors.push({ code, detail });
}

export async function verifyRepairPromotionForExtractionQa(root, record, ledger) {
  const extraction = ledger?.stages?.extraction || {};
  const contractIssues = repairPromotionExtractionContractIssues(record, extraction);
  const canonicalLedgerBytes = Buffer.from(`${stableStringify(ledger, 2)}\n`, "utf8");
  const ledgerSha256 = sha256(canonicalLedgerBytes);
  if (contractIssues.length) {
    return {
      ok: false,
      state: "failed_closed",
      promotionInputDigest: extraction.inputDigest || null,
      ledgerSha256,
      contractIssues,
      transactionIssues: []
    };
  }

  try {
    assertSafePaperId(record.id);
    const ledgerPath = path.posix.join("research", "ledger", "papers", `${record.id}.json`);
    const absoluteLedgerPath = path.resolve(root, ...ledgerPath.split("/"));
    const currentLedgerBytes = await readFile(absoluteLedgerPath);
    const transactionIssues = [];
    if (!currentLedgerBytes.equals(canonicalLedgerBytes)) {
      transactionIssues.push("qa_ledger_bytes_do_not_match_current_canonical_ledger");
    }

    // A static import would create extraction-qa -> promotion -> adjudication ->
    // repair -> extraction-qa. Loading the read-only inspector only after this
    // module is initialized keeps the dependency acyclic at evaluation time.
    const {
      EXTRACTION_REPAIR_PROMOTION_CODE_SHA256,
      EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256,
      EXTRACTION_REPAIR_PROMOTION_VERSION,
      inspectExtractionRepairPromotion
    } = await import("./promote-extraction-repair.mjs");
    const inspection = await inspectExtractionRepairPromotion({
      root,
      paper: record.id,
      promotionInputDigest: extraction.inputDigest,
      requireCommitted: true
    });
    transactionIssues.push(...(inspection.issues || []));

    let ledgerBinding = inspection.afterLedgerSha256 === ledgerSha256
      ? "exact_committed_after_snapshot"
      : "unverified";
    if (
      inspection.state === "committed"
      && inspection.afterLedgerSha256 !== ledgerSha256
      && transactionIssues.every((issue) => issue === "commit_ledger_mismatch")
    ) {
      const afterRelativePath = path.posix.join(
        "research",
        "ledger",
        "extraction-repair-promotions",
        record.id,
        extraction.inputDigest,
        "after",
        `${inspection.afterLedgerSha256}.json`
      );
      const afterBytes = await readFile(path.resolve(root, ...afterRelativePath.split("/")));
      const afterLedger = JSON.parse(afterBytes.toString("utf8"));
      const canonicalAfterBytes = Buffer.from(`${stableStringify(afterLedger, 2)}\n`, "utf8");
      if (sha256(afterBytes) !== inspection.afterLedgerSha256 || !afterBytes.equals(canonicalAfterBytes)) {
        transactionIssues.push("committed_after_snapshot_hash_or_canonical_form_invalid");
      } else {
        const promotionProjection = (value) => ({
          schemaVersion: value?.schemaVersion ?? null,
          paperId: value?.paperId ?? null,
          canonicalDoi: value?.canonicalDoi ?? null,
          manifestRecordDigest: value?.manifestRecordDigest ?? null,
          pdfSha256: value?.pdfSha256 ?? null,
          extraction: value?.stages?.extraction ?? null,
          extractQa: value?.stages?.extractQa ?? null
        });
        if (stableStringify(promotionProjection(ledger)) !== stableStringify(promotionProjection(afterLedger))) {
          transactionIssues.push("qa_promotion_projection_does_not_match_committed_after_snapshot");
        } else {
          const mismatchIndex = transactionIssues.indexOf("commit_ledger_mismatch");
          transactionIssues.splice(mismatchIndex, 1);
          ledgerBinding = "committed_promotion_projection_descendant";
        }
      }
    } else if (inspection.afterLedgerSha256 !== ledgerSha256) {
      transactionIssues.push("qa_ledger_does_not_match_committed_after_snapshot");
    }

    const finalLedgerBytes = await readFile(absoluteLedgerPath);
    if (!finalLedgerBytes.equals(currentLedgerBytes)) transactionIssues.push("qa_ledger_changed_during_promotion_verification");
    return {
      ok: inspection.state === "committed" && transactionIssues.length === 0,
      state: inspection.state || "failed_closed",
      promotionInputDigest: extraction.inputDigest,
      ledgerSha256,
      ledgerBinding,
      contractIssues: [],
      transactionIssues: [...new Set(transactionIssues)].sort(),
      preparePath: inspection.preparePath || null,
      commitPath: inspection.commitPath || null,
      afterLedgerSha256: inspection.afterLedgerSha256 || null,
      promotionVersion: EXTRACTION_REPAIR_PROMOTION_VERSION,
      promotionCodeSha256: EXTRACTION_REPAIR_PROMOTION_CODE_SHA256,
      promotionPolicySha256: EXTRACTION_REPAIR_PROMOTION_POLICY_SHA256
    };
  } catch (error) {
    return {
      ok: false,
      state: "failed_closed",
      promotionInputDigest: extraction.inputDigest || null,
      ledgerSha256,
      ledgerBinding: "unverified",
      contractIssues: [],
      transactionIssues: [error.message || error.name]
    };
  }
}

function manualReviewRequirements(record, pages, manualReasons, extraction) {
  const uniqueReasons = uniqueSorted(manualReasons);
  if (!uniqueReasons.length || !Array.isArray(pages) || !pages.length) return { requiredPages: [], triggerCoverage: [] };
  const lastPage = pages.length;
  const representativePages = uniqueSorted([1, Math.ceil(lastPage / 2), lastPage]).map(Number);
  const pageProfiles = pages.map((page) => ({
    page: page.page,
    profile: extractionCorruptionProfile([page]),
    textLength: String(page.text || "").length,
    letterFraction: textEvidence([page], "").letterFraction
  }));
  const maxPage = (field) => pageProfiles.reduce((best, current) => (
    Number(current.profile[field] || 0) > Number(best.profile[field] || 0) ? current : best
  ), pageProfiles[0]).page;
  const minPage = (field) => pageProfiles.reduce((best, current) => (
    Number(current[field]) < Number(best[field]) ? current : best
  ), pageProfiles[0]).page;
  const errorPages = (extraction.pageErrors || []).map((entry) => (
    Number.isInteger(entry) ? entry : Number(entry?.page || entry?.pageNumber || 0)
  )).filter((page) => page >= 1 && page <= lastPage);
  const coverage = uniqueReasons.map((reason) => {
    let requiredPages;
    if (reason === "empty_extracted_page") requiredPages = extraction.emptyPages || [];
    else if (reason === "page_extraction_error") requiredPages = errorPages;
    else if (reason === "title_identity_not_verified") requiredPages = pages.slice(0, 3).map((page) => page.page);
    else if (reason === "low_text_yield") requiredPages = [minPage("textLength")];
    else if (reason === "low_letter_fraction") requiredPages = [minPage("letterFraction")];
    else if (reason === "selected_replacement_characters") requiredPages = [maxPage("replacementCharacters")];
    else if (reason === "selected_legacy_font_map") requiredPages = [maxPage("encodedHeadings"), ...representativePages];
    else requiredPages = representativePages;
    requiredPages = uniqueSorted(requiredPages.filter((page) => Number.isInteger(page) && page >= 1 && page <= lastPage)).map(Number);
    if (!requiredPages.length) requiredPages = representativePages;
    return { reason, requiredPages };
  });
  return {
    requiredPages: uniqueSorted(coverage.flatMap((entry) => entry.requiredPages)).map(Number),
    triggerCoverage: coverage
  };
}

function makeDecision(record, ledger, sourceReasons, validationErrors, manualReasons, observations, evidence, requirements) {
  const unresolvedReasons = uniqueSorted([
    ...validationErrors.map((entry) => entry.code),
    ...manualReasons
  ]);
  const status = validationErrors.length ? "failed" : unresolvedReasons.length ? "needs_review" : "complete";
  return {
    schemaVersion: 1,
    stage: "extractQa",
    producer: "scripts/extraction-qa.mjs",
    producerVersion: EXTRACTION_QA_VERSION,
    producerCodeSha256: EXTRACTION_QA_CODE_SHA256,
    policySha256: EXTRACTION_QA_POLICY_SHA256,
    inputDigest: extractionQaInputDigest(record, ledger),
    paperId: record.id,
    canonicalDoi: record.canonicalDoi,
    manifestRecordDigest: record.recordDigest,
    sourcePdfSha256: record.pdf.sha256,
    extractionInputDigest: ledger.stages?.extraction?.inputDigest || null,
    extractionEvidenceSha256: extractionQaEvidenceDigest(ledger),
    disposition: status === "complete" ? "accepted" : status === "needs_review" ? "manual_review_required" : "failed_validation",
    status,
    sourceReasons,
    unresolvedReasons,
    observations: uniqueSorted(observations),
    validationErrors: [...validationErrors].sort((a, b) => compareOrdinal(a.code, b.code)),
    manualReviewRequirements: requirements,
    evidence
  };
}

export async function evaluateExtractionQa(root, manifest, record, ledger) {
  const extraction = ledger.stages?.extraction || {};
  const qa = ledger.stages?.extractQa || {};
  const isRepairPromotion = Boolean(extraction.repairPromotion);
  const sourceReasons = extractionSourceReasons(ledger);
  const validationErrors = [];
  const manualReasons = [];
  const observations = [];
  const evidence = {
    sourcePdf: null,
    artifacts: null,
    extraction: null,
    readability: null,
    repairPromotion: null
  };

  addMismatch(validationErrors, ledger.paperId !== record.id, "ledger_paper_id_mismatch");
  addMismatch(validationErrors, ledger.canonicalDoi !== record.canonicalDoi, "ledger_doi_mismatch");
  addMismatch(validationErrors, ledger.manifestRecordDigest !== record.recordDigest, "manifest_record_digest_mismatch");
  addMismatch(validationErrors, ledger.pdfSha256 !== record.pdf.sha256, "ledger_pdf_digest_mismatch");
  addMismatch(validationErrors, extraction.status !== "complete", "extraction_not_complete", extraction.status || "missing");
  addMismatch(validationErrors, extraction.sourcePdfSha256 !== record.pdf.sha256, "extraction_pdf_digest_mismatch");
  addMismatch(validationErrors, qa.inputDigest !== extraction.inputDigest, "qa_input_digest_mismatch");
  addMismatch(validationErrors, qa.sourcePdfSha256 !== record.pdf.sha256, "qa_pdf_digest_mismatch");
  const repairPromotionVerification = isRepairPromotion
    ? await verifyRepairPromotionForExtractionQa(root, record, ledger)
    : null;
  if (repairPromotionVerification) {
    evidence.repairPromotion = {
      status: repairPromotionVerification.ok ? "verified" : "failed_closed",
      state: repairPromotionVerification.state,
      promotionInputDigest: repairPromotionVerification.promotionInputDigest,
      committedAfterLedgerSha256: repairPromotionVerification.afterLedgerSha256 || null,
      preparePath: repairPromotionVerification.preparePath || null,
      commitPath: repairPromotionVerification.commitPath || null,
      promotionVersion: repairPromotionVerification.promotionVersion || null,
      promotionCodeSha256: repairPromotionVerification.promotionCodeSha256 || null,
      promotionPolicySha256: repairPromotionVerification.promotionPolicySha256 || null,
      contractIssues: repairPromotionVerification.contractIssues || [],
      transactionIssues: repairPromotionVerification.transactionIssues || []
    };
    for (const issue of repairPromotionVerification.contractIssues || []) {
      validationErrors.push({ code: "repair_promotion_contract_invalid", detail: issue });
    }
    for (const issue of repairPromotionVerification.transactionIssues || []) {
      validationErrors.push({ code: "repair_promotion_transaction_invalid", detail: issue });
    }
    if (!repairPromotionVerification.ok
      && !(repairPromotionVerification.contractIssues || []).length
      && !(repairPromotionVerification.transactionIssues || []).length) {
      validationErrors.push({ code: "repair_promotion_verification_failed", detail: repairPromotionVerification.state });
    }
    if (repairPromotionVerification.ok) observations.push("repair_promotion_transaction_verified");
  }
  const promotionSnapshotAvailable = isRepairPromotion
    && !(repairPromotionVerification?.contractIssues || []).length;
  const expectedQa = promotionSnapshotAvailable
    ? makeRepairPromotionExtractQaStage(record, extraction)
    : expectedLegacyQaSnapshot(extraction);
  const qaSnapshotFields = [
    "status", "inputDigest", "sourcePdfSha256", "reasons", "warningCodes", "pageErrors", "emptyPages",
    "totalCharacters", "selectedEngine", "selectedEngineVersion", "fallbackAttempted", "fallbackUsed",
    "fallbackReason", "primaryCorruptionProfile", "fallbackCorruptionProfile", "selectedCorruptionProfile"
  ];
  if (promotionSnapshotAvailable) qaSnapshotFields.push(
    "repairPromotionInputDigest",
    "acceptedRepairAdjudicationPath",
    "acceptedRepairAdjudicationSha256"
  );
  for (const field of qaSnapshotFields) {
    addMismatch(
      validationErrors,
      stableStringify(qa[field] ?? null) !== stableStringify(expectedQa[field] ?? null),
      `qa_${field}_mismatch`
    );
  }

  const sourcePath = resolveBoundPath(root, record.pdf.path, record.pdf.path, "source_pdf_path_invalid", validationErrors);
  if (sourcePath) {
    try {
      const observed = await hashFile(sourcePath);
      evidence.sourcePdf = observed;
      const sourceValid = observed.sha256 === record.pdf.sha256
        && observed.bytes === record.pdf.bytes
        && observed.header === "%PDF-";
      addMismatch(validationErrors, observed.sha256 !== record.pdf.sha256, "source_pdf_hash_mismatch");
      addMismatch(validationErrors, observed.bytes !== record.pdf.bytes, "source_pdf_byte_length_mismatch");
      addMismatch(validationErrors, observed.header !== "%PDF-", "source_pdf_header_mismatch");
      if (sourceValid) observations.push("source_pdf_hash_verified");
    } catch (error) {
      validationErrors.push({ code: "source_pdf_unreadable", detail: error.code || error.name });
    }
  }

  const artifactBase = path.posix.join("research", "ledger", "artifacts", record.id, String(extraction.inputDigest || ""));
  const expectedPagesPath = path.posix.join(artifactBase, "pages.json");
  const expectedTextPath = path.posix.join(artifactBase, "text.txt");
  const pagesPath = resolveBoundPath(root, extraction.artifacts?.pages, expectedPagesPath, "pages_artifact_path_invalid", validationErrors);
  const textPath = resolveBoundPath(root, extraction.artifacts?.text, expectedTextPath, "text_artifact_path_invalid", validationErrors);
  let pagesBytes = null;
  let textBytes = null;
  let payload = null;
  let pagesHashVerified = false;
  let textHashVerified = false;
  if (pagesPath) {
    try {
      pagesBytes = await readFile(pagesPath);
      pagesHashVerified = sha256(pagesBytes) === extraction.artifacts?.pagesSha256;
      addMismatch(validationErrors, !pagesHashVerified, "pages_artifact_hash_mismatch");
      payload = JSON.parse(pagesBytes.toString("utf8"));
    } catch (error) {
      validationErrors.push({ code: error instanceof SyntaxError ? "pages_artifact_json_invalid" : "pages_artifact_unreadable", detail: error.code || error.name });
    }
  }
  if (textPath) {
    try {
      textBytes = await readFile(textPath);
      textHashVerified = sha256(textBytes) === extraction.artifacts?.textSha256;
      addMismatch(validationErrors, !textHashVerified, "text_artifact_hash_mismatch");
    } catch (error) {
      validationErrors.push({ code: "text_artifact_unreadable", detail: error.code || error.name });
    }
  }
  evidence.artifacts = {
    pagesPath: extraction.artifacts?.pages || null,
    pagesSha256: pagesBytes ? sha256(pagesBytes) : null,
    textPath: extraction.artifacts?.text || null,
    textSha256: textBytes ? sha256(textBytes) : null
  };
  if (pagesHashVerified && textHashVerified) observations.push("artifact_hashes_verified");

  const pages = Array.isArray(payload?.pages) ? payload.pages : null;
  if (!pages) {
    validationErrors.push({ code: "pages_array_missing", detail: "artifact has no pages array" });
  } else {
    addMismatch(validationErrors, payload.schemaVersion !== 1, "pages_schema_mismatch");
    addMismatch(validationErrors, payload.paperId !== record.id, "pages_paper_id_mismatch");
    addMismatch(validationErrors, payload.canonicalDoi !== record.canonicalDoi, "pages_doi_mismatch");
    addMismatch(validationErrors, payload.pdfSha256 !== record.pdf.sha256, "pages_pdf_digest_mismatch");
    const pageSequenceValid = pages.length === record.pdf.pageCount
      && pages.length === extraction.pageCount
      && !pages.some((page, index) => page?.page !== index + 1 || typeof page?.text !== "string");
    addMismatch(validationErrors, pages.length !== record.pdf.pageCount, "pages_manifest_count_mismatch");
    addMismatch(validationErrors, pages.length !== extraction.pageCount, "pages_ledger_count_mismatch");
    addMismatch(validationErrors, pages.some((page, index) => page?.page !== index + 1 || typeof page?.text !== "string"), "page_sequence_invalid");
    if (pageSequenceValid) observations.push("page_sequence_verified");
    if (isRepairPromotion) {
      const marker = extraction.repairPromotion || {};
      const promotionInput = marker.promotionInput || {};
      const expectedRepairEvidence = {
        promotionInputDigest: extraction.inputDigest,
        acceptedAdjudicationPath: promotionInput.acceptedAdjudication?.path,
        acceptedAdjudicationSha256: promotionInput.acceptedAdjudication?.sha256,
        acceptedAdjudicationRecordDigest: promotionInput.acceptedAdjudication?.recordDigest,
        candidatePagesSha256: promotionInput.candidate?.pagesSha256,
        candidateProvenanceSha256: promotionInput.candidate?.provenanceSha256
      };
      addMismatch(validationErrors, payload.extractor?.name !== "extraction-repair-promotion", "repair_promotion_extractor_name_mismatch");
      addMismatch(validationErrors, payload.extractor?.version !== marker.producerVersion, "repair_promotion_extractor_version_mismatch");
      addMismatch(validationErrors, payload.extractor?.codeSha256 !== marker.producerCodeSha256, "repair_promotion_extractor_code_digest_mismatch");
      if (repairPromotionVerification?.promotionVersion) {
        addMismatch(validationErrors, marker.producerVersion !== repairPromotionVerification.promotionVersion, "repair_promotion_current_version_mismatch");
        addMismatch(validationErrors, marker.producerCodeSha256 !== repairPromotionVerification.promotionCodeSha256, "repair_promotion_current_code_digest_mismatch");
        addMismatch(validationErrors, marker.policySha256 !== repairPromotionVerification.promotionPolicySha256, "repair_promotion_current_policy_digest_mismatch");
      }
      addMismatch(
        validationErrors,
        stableStringify(payload.extractor?.repairPromotion ?? null) !== stableStringify(expectedRepairEvidence),
        "repair_promotion_page_evidence_mismatch"
      );
    } else {
      addMismatch(validationErrors, payload.extractor?.codeSha256 !== EXTRACTOR_CODE_SHA256, "extractor_code_digest_mismatch");
      addMismatch(validationErrors, payload.extractor?.codeSha256 !== manifest.parser?.extractionCodeSha256, "manifest_extractor_digest_mismatch");
    }
    addMismatch(validationErrors, stableStringify(payload.extractor?.extractionPolicy ?? null) !== stableStringify(EXTRACTION_POLICY), "extraction_policy_mismatch");
    for (const field of ["selectedEngine", "selectedEngineVersion", "fallbackAttempted", "fallbackUsed", "fallbackReason"]) {
      addMismatch(validationErrors, payload.extractor?.[field] !== extraction[field], `extractor_${field}_mismatch`);
    }
    for (const field of ["primaryCorruptionProfile", "fallbackCorruptionProfile", "selectedCorruptionProfile"]) {
      addMismatch(validationErrors, !stableProfileEqual(payload.extractor?.[field], extraction[field]), `extractor_${field}_mismatch`);
    }

    const computedProfile = extractionCorruptionProfile(pages);
    addMismatch(validationErrors, !stableProfileEqual(computedProfile, extraction.selectedCorruptionProfile), "selected_corruption_profile_mismatch");
    const readability = textEvidence(pages, record.title);
    evidence.readability = readability;
    evidence.extraction = {
      pageCount: pages.length,
      selectedEngine: extraction.selectedEngine,
      selectedEngineVersion: extraction.selectedEngineVersion,
      fallbackAttempted: Boolean(extraction.fallbackAttempted),
      fallbackUsed: Boolean(extraction.fallbackUsed),
      fallbackReason: extraction.fallbackReason || "",
      primaryCorruptionProfile: extraction.primaryCorruptionProfile || null,
      selectedCorruptionProfile: computedProfile,
      fallbackPrimaryCharacterFraction: extraction.fallbackUsed
        ? roundRatio(computedProfile.textLength / Math.max(1, Number(extraction.primaryCorruptionProfile?.textLength || 0)))
        : null
    };
    addMismatch(validationErrors, readability.totalCharacters !== extraction.totalCharacters, "total_character_count_mismatch");
    addMismatch(validationErrors, stableStringify(readability.emptyPages) !== stableStringify(extraction.emptyPages || []), "empty_page_list_mismatch");
    const expectedPlainText = pages.map((page) => `===== PDF PAGE ${page.page} =====\n${page.text}`).join("\n\n") + "\n";
    if (textBytes) addMismatch(validationErrors, !textBytes.equals(Buffer.from(expectedPlainText, "utf8")), "plain_text_artifact_mismatch");

    if (readability.totalCharacters < EXTRACTION_QA_POLICY.minimumTotalCharacters
      || readability.charactersPerPage < EXTRACTION_QA_POLICY.minimumCharactersPerPage
      || readability.nonemptyPageFraction < EXTRACTION_QA_POLICY.minimumNonemptyPageFraction) {
      manualReasons.push("low_text_yield");
    }
    if (readability.emptyPages.length) manualReasons.push("empty_extracted_page");
    if ((extraction.pageErrors || []).length) manualReasons.push("page_extraction_error");
    if (readability.titleTokenRecall < EXTRACTION_QA_POLICY.minimumTitleTokenRecall) manualReasons.push("title_identity_not_verified");
    else observations.push("title_identity_verified");
    if (readability.letterFraction < EXTRACTION_QA_POLICY.minimumLetterFraction) manualReasons.push("low_letter_fraction");
    if (extraction.selectedCorruptionProfile?.legacyFontMap) manualReasons.push("selected_legacy_font_map");
    if (Number(extraction.selectedCorruptionProfile?.replacementCharacters || 0) >= EXTRACTION_QA_POLICY.replacementCharacterReviewThreshold) {
      manualReasons.push("selected_replacement_characters");
    }

    if (repairPromotionVerification?.ok) {
      observations.push("repair_promotion_extractor_verified");
    } else if (extraction.fallbackUsed) {
      const fallbackErrorsBefore = validationErrors.length;
      addMismatch(validationErrors, !extraction.fallbackAttempted, "fallback_used_without_attempt");
      addMismatch(validationErrors, extraction.selectedEngine !== "pymupdf", "fallback_engine_mismatch");
      addMismatch(validationErrors, extraction.fallbackReason !== "systematic-text-corruption", "fallback_reason_mismatch");
      addMismatch(validationErrors, !extraction.fallbackCorruptionProfile, "fallback_profile_missing");
      if (extraction.primaryCorruptionProfile && extraction.fallbackCorruptionProfile) {
        addMismatch(validationErrors, !preferFallbackExtraction(extraction.primaryCorruptionProfile, extraction.fallbackCorruptionProfile), "fallback_not_cleaner");
      }
      const retained = computedProfile.textLength / Math.max(1, Number(extraction.primaryCorruptionProfile?.textLength || 0));
      addMismatch(validationErrors, retained < EXTRACTION_QA_POLICY.minimumFallbackPrimaryFraction, "fallback_text_retention_too_low");
      if (validationErrors.length === fallbackErrorsBefore) observations.push("alternate_parser_fallback_verified");
    } else {
      addMismatch(validationErrors, extraction.selectedEngine === "pymupdf", "pymupdf_without_fallback_provenance");
      if (extraction.fallbackAttempted) {
        const fallbackErrorsBefore = validationErrors.length;
        addMismatch(validationErrors, extraction.selectedEngine !== "pypdf", "retained_primary_engine_mismatch");
        addMismatch(validationErrors, extraction.fallbackReason !== "alternate-parser-not-cleaner", "retained_primary_fallback_reason_mismatch");
        addMismatch(validationErrors, !extraction.fallbackCorruptionProfile, "fallback_profile_missing");
        if (extraction.primaryCorruptionProfile && extraction.fallbackCorruptionProfile) {
          addMismatch(
            validationErrors,
            preferFallbackExtraction(extraction.primaryCorruptionProfile, extraction.fallbackCorruptionProfile),
            "cleaner_fallback_not_selected"
          );
        }
        if (validationErrors.length === fallbackErrorsBefore) observations.push("alternate_parser_rejection_verified");
      } else {
        addMismatch(validationErrors, extraction.selectedEngine !== "pypdf", "primary_engine_mismatch");
        addMismatch(validationErrors, Boolean(extraction.fallbackReason), "fallback_reason_without_attempt");
        addMismatch(validationErrors, Boolean(extraction.fallbackCorruptionProfile), "fallback_profile_without_attempt");
      }
    }
    if (extraction.primaryCorruptionProfile?.legacyFontMap) manualReasons.push("primary_legacy_font_map");
    if (readability.c0ControlCharacters || readability.c1ControlCharacters) observations.push("encoded_formula_or_control_glyphs_present");
    if (
      Number(computedProfile.rawGlyphNames || 0)
      || Number(computedProfile.veryLongLowercaseTokens || 0) >= EXTRACTION_POLICY.corruptionTrigger.minimumVeryLongLowercaseTokens
      || Number(computedProfile.letterSpacedRuns || 0) >= EXTRACTION_POLICY.corruptionTrigger.minimumLetterSpacedRuns
      || Number(computedProfile.embeddedM || 0) >= EXTRACTION_POLICY.corruptionTrigger.minimumEmbeddedM
      || Number(computedProfile.terminalN || 0) >= EXTRACTION_POLICY.corruptionTrigger.minimumTerminalN
    ) observations.push("residual_soft_corruption_signal");
  }

  if (sourceReasons.includes("parser_warning")) manualReasons.push("parser_warning");
  if (sourceReasons.includes("page_extraction_error")) manualReasons.push("page_extraction_error");
  if (sourceReasons.includes("empty_extracted_page")) manualReasons.push("empty_extracted_page");
  if (sourceReasons.includes("low_text_yield")) manualReasons.push("low_text_yield");
  if (sourceReasons.includes("repair_promotion_requires_authoritative_qa") || repairPromotionVerification?.ok) {
    manualReasons.push("repair_promotion_requires_authoritative_qa");
  }
  const recognizedSourceReasons = new Set([
    "alternate_parser_fallback", "parser_warning", "page_extraction_error", "empty_extracted_page", "low_text_yield",
    "repair_promotion_requires_authoritative_qa"
  ]);
  if (sourceReasons.some((reason) => !recognizedSourceReasons.has(reason))) manualReasons.push("unclassified_extraction_warning");
  return makeDecision(
    record,
    ledger,
    sourceReasons,
    validationErrors,
    manualReasons,
    observations,
    evidence,
    manualReviewRequirements(record, pages || [], manualReasons, extraction)
  );
}

function selectorIndex(manifest) {
  const index = new Map();
  for (const record of manifest.records) {
    for (const value of [record.id, record.canonicalDoi, record.doiUrl, ...(record.aliases || [])]) {
      const key = value.startsWith("10.") || /^https?:\/\/(?:dx\.)?doi\.org\//i.test(value) ? normalizeDoi(value) : value;
      if (index.has(key) && index.get(key) !== record.id) throw new Error(`Ambiguous paper selector: ${value}`);
      index.set(key, record.id);
    }
  }
  return index;
}

function selectRecords(manifest, options) {
  const index = selectorIndex(manifest);
  const resolve = (value, label) => {
    const key = value.startsWith("10.") || /^https?:\/\/(?:dx\.)?doi\.org\//i.test(value) ? normalizeDoi(value) : value;
    const id = index.get(key);
    if (!id) throw new Error(`Unknown ${label} selector: ${value}`);
    return id;
  };
  let requested = null;
  if (options.papers.length) requested = new Set(options.papers.map((value) => resolve(value, "paper")));
  const fromId = options.from ? resolve(options.from, "--from") : "";
  const fromIndex = fromId ? manifest.records.findIndex((record) => record.id === fromId) : 0;
  let records = manifest.records.slice(fromIndex).filter((record) => !requested || requested.has(record.id));
  if (options.limit) records = records.slice(0, options.limit);
  return records;
}

async function loadCorpus(root) {
  const manifest = await readJson(path.join(root, "research", "corpus", "manifest.v1.json"));
  const ledgers = new Map();
  for (const record of manifest.records) {
    assertSafePaperId(record.id);
    const ledgerPath = path.join(root, "research", "ledger", "papers", `${record.id}.json`);
    try {
      ledgers.set(record.id, { path: ledgerPath, text: await readFile(ledgerPath, "utf8") });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { manifest, ledgers };
}

export async function inspectExtractionQaCheckpoint(root, record, ledger) {
  const expectedInputDigest = extractionQaInputDigest(record, ledger);
  const expectedPath = extractionQaDecisionRelativePath(record, ledger);
  const absolute = path.resolve(root, ...expectedPath.split("/"));
  let bytes;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    return {
      state: error.code === "ENOENT" ? "missing" : "stale",
      reason: error.code === "ENOENT" ? "review_decision_missing" : "review_decision_unreadable",
      inputDigest: expectedInputDigest,
      decisionPath: expectedPath
    };
  }
  let decision;
  try {
    decision = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { state: "stale", reason: "review_decision_json_invalid", inputDigest: expectedInputDigest, decisionPath: expectedPath };
  }
  const decisionSha256 = sha256(bytes);
  if (
    decision.schemaVersion !== 1
    || decision.stage !== "extractQa"
    || decision.producer !== "scripts/extraction-qa.mjs"
    || decision.producerVersion !== EXTRACTION_QA_VERSION
    || decision.producerCodeSha256 !== EXTRACTION_QA_CODE_SHA256
    || decision.policySha256 !== EXTRACTION_QA_POLICY_SHA256
    || decision.inputDigest !== expectedInputDigest
    || decision.paperId !== record.id
    || decision.canonicalDoi !== record.canonicalDoi
    || decision.manifestRecordDigest !== record.recordDigest
    || decision.sourcePdfSha256 !== record.pdf.sha256
    || decision.extractionInputDigest !== (ledger.stages?.extraction?.inputDigest || null)
    || decision.extractionEvidenceSha256 !== extractionQaEvidenceDigest(ledger)
  ) {
    return {
      state: "stale",
      reason: "review_decision_binding_mismatch",
      inputDigest: expectedInputDigest,
      decisionPath: expectedPath,
      decisionSha256
    };
  }
  return { state: "current", decision, inputDigest: expectedInputDigest, decisionPath: expectedPath, decisionSha256 };
}

export async function verifyExtractionQaCheckpoint(root, manifest, record, ledger, { requireComplete = true, ignoreAdjudication = false } = {}) {
  const checkpoint = await inspectExtractionQaCheckpoint(root, record, ledger);
  if (checkpoint.state !== "current") return { ...checkpoint, ok: false };
  const expected = await evaluateExtractionQa(root, manifest, record, ledger);
  const expectedBytes = Buffer.from(`${stableStringify(expected, 2)}\n`, "utf8");
  if (sha256(expectedBytes) !== checkpoint.decisionSha256) {
    return { ...checkpoint, state: "stale", ok: false, reason: "review_decision_not_reproducible" };
  }
  if (expected.status === "complete") {
    return { ...checkpoint, ok: true, effectiveStatus: "complete", decision: expected };
  }
  if (expected.status === "failed") {
    return {
      ...checkpoint,
      state: "incomplete",
      ok: !requireComplete,
      effectiveStatus: "failed",
      reason: "qa_validation_failed",
      decision: expected
    };
  }
  if (ignoreAdjudication) {
    return {
      ...checkpoint,
      state: "current",
      ok: true,
      effectiveStatus: "needs_review",
      reason: "manual_review_incomplete",
      decision: expected
    };
  }
  const adjudicationPath = extractionQaAdjudicationRelativePath(record, checkpoint.inputDigest, checkpoint.decisionSha256);
  let adjudicationBytes;
  try {
    adjudicationBytes = await readFile(path.resolve(root, ...adjudicationPath.split("/")));
  } catch (error) {
    return {
      ...checkpoint,
      state: requireComplete ? "incomplete" : "current",
      ok: !requireComplete,
      effectiveStatus: "needs_review",
      reason: error.code === "ENOENT" ? "manual_review_incomplete" : "manual_adjudication_unreadable",
      decision: expected,
      adjudicationPath
    };
  }
  const adjudicationSha256 = sha256(adjudicationBytes);
  let adjudication;
  try {
    adjudication = JSON.parse(adjudicationBytes.toString("utf8"));
  } catch {
    return {
      ...checkpoint,
      state: "stale",
      ok: false,
      effectiveStatus: "needs_review",
      reason: "manual_adjudication_json_invalid",
      decision: expected,
      adjudicationPath,
      adjudicationSha256
    };
  }
  const bindingValid = adjudication.schemaVersion === 1
    && adjudication.stage === "extractQaAdjudication"
    && adjudication.producer === "manual-review-v1"
    && adjudication.paperId === record.id
    && adjudication.canonicalDoi === record.canonicalDoi
    && adjudication.sourcePdfSha256 === record.pdf.sha256
    && adjudication.extractionPagesSha256 === ledger.stages?.extraction?.artifacts?.pagesSha256
    && adjudication.automatedDecisionPath === checkpoint.decisionPath
    && adjudication.automatedDecisionSha256 === checkpoint.decisionSha256
    && adjudication.automatedInputDigest === checkpoint.inputDigest
    && adjudication.automatedProducerVersion === expected.producerVersion
    && adjudication.automatedProducerCodeSha256 === expected.producerCodeSha256
    && adjudication.automatedPolicySha256 === expected.policySha256
    && stableStringify(adjudication.sourceReasons || []) === stableStringify(expected.sourceReasons || [])
    && stableStringify(adjudication.unresolvedReasons || []) === stableStringify(expected.unresolvedReasons || [])
    && ["accepted", "rejected"].includes(adjudication.disposition);
  const contentIssues = adjudicationContentIssues({ ...adjudication, record, decision: expected });
  if (!bindingValid || contentIssues.length) {
    return {
      ...checkpoint,
      state: "stale",
      ok: false,
      effectiveStatus: "needs_review",
      reason: bindingValid ? "manual_adjudication_content_invalid" : "manual_adjudication_binding_mismatch",
      decision: expected,
      adjudicationPath,
      adjudicationSha256,
      adjudication,
      adjudicationIssues: contentIssues
    };
  }
  const effectiveStatus = adjudication.disposition === "accepted" ? "complete" : "failed";
  return {
    ...checkpoint,
    state: effectiveStatus === "complete" ? "current" : "incomplete",
    ok: effectiveStatus === "complete" || !requireComplete,
    effectiveStatus,
    reason: effectiveStatus === "complete" ? "" : "manual_review_rejected",
    decision: expected,
    adjudicationPath,
    adjudicationSha256,
    adjudication
  };
}

export function extractionQaCheckpointBinding(checkpoint) {
  if (!checkpoint?.ok || checkpoint.state !== "current" || checkpoint.effectiveStatus !== "complete") {
    throw new Error(`Extraction QA checkpoint is not release-ready (${checkpoint?.reason || checkpoint?.state || "missing"})`);
  }
  return {
    extractionQaStatus: checkpoint.effectiveStatus,
    extractionQaAutomatedStatus: checkpoint.decision.status,
    extractionQaInputDigest: checkpoint.inputDigest,
    extractionQaDecisionPath: checkpoint.decisionPath,
    extractionQaDecisionSha256: checkpoint.decisionSha256,
    extractionQaAdjudicationStatus: checkpoint.adjudication?.disposition || "not_required",
    extractionQaAdjudicationPath: checkpoint.adjudicationPath || null,
    extractionQaAdjudicationSha256: checkpoint.adjudicationSha256 || null
  };
}

export function extractionQaBindingsMatch(value, expected) {
  return Boolean(expected) && EXTRACTION_QA_BINDING_KEYS.every((key) => value?.[key] === expected[key]);
}

export function extractionQaBoundDigest(stage, baseInputDigest, binding) {
  return sha256(stableStringify({
    schemaVersion: 1,
    stage,
    baseInputDigest,
    extractionQaStatus: binding.extractionQaStatus,
    extractionQaAutomatedStatus: binding.extractionQaAutomatedStatus,
    extractionQaInputDigest: binding.extractionQaInputDigest,
    extractionQaDecisionPath: binding.extractionQaDecisionPath,
    extractionQaDecisionSha256: binding.extractionQaDecisionSha256,
    extractionQaAdjudicationStatus: binding.extractionQaAdjudicationStatus,
    extractionQaAdjudicationPath: binding.extractionQaAdjudicationPath,
    extractionQaAdjudicationSha256: binding.extractionQaAdjudicationSha256
  }));
}

async function commitDecision(root, record, ledgerEntry, decision) {
  const baseLedger = JSON.parse(ledgerEntry.text);
  const relativePath = extractionQaDecisionRelativePath(record, baseLedger);
  const decisionPath = path.resolve(root, ...relativePath.split("/"));
  const changed = await atomicWriteJson(decisionPath, decision);
  const decisionBytes = await readFile(decisionPath);
  const decisionSha256 = sha256(decisionBytes);
  const expectedDecisionBytes = Buffer.from(`${stableStringify(decision, 2)}\n`, "utf8");
  if (!decisionBytes.equals(expectedDecisionBytes)) {
    return { id: record.id, status: "conflict", disposition: decision.disposition, reasons: ["decision_changed_during_commit"], changed };
  }
  if (decision.status !== "failed") {
    const sourcePath = path.resolve(root, ...record.pdf.path.split("/"));
    const pagesPath = path.resolve(root, ...baseLedger.stages.extraction.artifacts.pages.split("/"));
    const textPath = path.resolve(root, ...baseLedger.stages.extraction.artifacts.text.split("/"));
    const [sourceNow, pagesNow, textNow] = await Promise.all([
      hashFile(sourcePath),
      readFile(pagesPath).then((bytes) => sha256(bytes)),
      readFile(textPath).then((bytes) => sha256(bytes))
    ]);
    if (
      sourceNow.sha256 !== decision.sourcePdfSha256
      || sourceNow.bytes !== record.pdf.bytes
      || sourceNow.header !== "%PDF-"
      || pagesNow !== decision.evidence.artifacts.pagesSha256
      || textNow !== decision.evidence.artifacts.textSha256
    ) {
      return { id: record.id, status: "conflict", disposition: decision.disposition, reasons: ["review_inputs_changed_during_commit"] };
    }
  }
  return {
    id: record.id,
    status: decision.status,
    disposition: decision.disposition,
    reasons: decision.unresolvedReasons,
    inputDigest: decision.inputDigest,
    decisionPath: relativePath,
    decisionSha256,
    changed
  };
}

export async function extractionQaStatus(options) {
  const { manifest, ledgers } = await loadCorpus(options.root);
  const records = selectRecords(manifest, options);
  const results = await mapLimit(records, options.jobs, async (record) => {
    const entry = ledgers.get(record.id);
    if (!entry) return { id: record.id, checkpoint: "missing", qaStatus: "missing", reason: "paper_ledger_missing" };
    const ledger = JSON.parse(entry.text);
    const checkpoint = await verifyExtractionQaCheckpoint(options.root, manifest, record, ledger, { requireComplete: false });
    const decision = checkpoint.decision || null;
    return {
      id: record.id,
      checkpoint: checkpoint.state,
      qaStatus: checkpoint.effectiveStatus || decision?.status || "missing",
      automatedStatus: decision?.status || "missing",
      disposition: decision?.disposition || "unreviewed",
      ...(checkpoint.inputDigest ? { inputDigest: checkpoint.inputDigest } : {}),
      ...(checkpoint.decisionSha256 ? { decisionSha256: checkpoint.decisionSha256 } : {}),
      ...(checkpoint.reason ? { reason: checkpoint.reason } : {})
    };
  });
  return {
    schemaVersion: 1,
    producerVersion: EXTRACTION_QA_VERSION,
    producerCodeSha256: EXTRACTION_QA_CODE_SHA256,
    policySha256: EXTRACTION_QA_POLICY_SHA256,
    selected: records.length,
    checkpoints: countBy(results, (result) => result.checkpoint),
    qaStatuses: countBy(results, (result) => result.qaStatus),
    automatedStatuses: countBy(results, (result) => result.automatedStatus),
    dispositions: countBy(results, (result) => result.disposition),
    terminal: results.filter((result) => result.checkpoint === "current" && TERMINAL_QA_STATUSES.has(result.qaStatus)).length,
    releaseReady: results.filter((result) => result.checkpoint === "current" && result.qaStatus === "complete").length,
    results
  };
}

async function expectedReview(root, manifest, record, ledgerEntry) {
  const ledger = JSON.parse(ledgerEntry.text);
  const decision = await evaluateExtractionQa(root, manifest, record, ledger);
  return { ledger, decision };
}

async function checkExpectedDecision(root, manifest, record, ledger) {
  const checkpoint = await verifyExtractionQaCheckpoint(root, manifest, record, ledger);
  return { ok: checkpoint.ok, reason: checkpoint.reason || "" };
}

export async function reviewExtractions(options) {
  const { manifest, ledgers } = await loadCorpus(options.root);
  const records = selectRecords(manifest, options);
  if (options.check) {
    const results = await mapLimit(records, options.jobs, async (record) => {
      const entry = ledgers.get(record.id);
      if (!entry) return { id: record.id, ok: false, status: "missing", reason: "paper_ledger_missing" };
      const { ledger, decision } = await expectedReview(options.root, manifest, record, entry);
      const checked = await checkExpectedDecision(options.root, manifest, record, ledger);
      return { id: record.id, ok: checked.ok, status: decision.status, disposition: decision.disposition, reason: checked.reason };
    });
    return {
      checked: true,
      selected: records.length,
      ok: results.every((result) => result.ok),
      statuses: countBy(results, (result) => result.status),
      failures: results.filter((result) => !result.ok),
      results
    };
  }

  const candidates = [];
  for (const record of records) {
    const entry = ledgers.get(record.id);
    if (!entry) {
      candidates.push({ record, entry: null });
      continue;
    }
    const ledger = JSON.parse(entry.text);
    const checkpoint = await verifyExtractionQaCheckpoint(options.root, manifest, record, ledger, {
      requireComplete: false,
      ignoreAdjudication: true
    });
    if (options.force
      || checkpoint.state !== "current"
      || !checkpoint.ok
      || !TERMINAL_QA_STATUSES.has(checkpoint.decision?.status)) {
      candidates.push({ record, entry });
    }
  }
  const results = await mapLimit(candidates, options.jobs, async ({ record, entry }) => {
    if (!entry) return { id: record.id, status: "failed", disposition: "failed_validation", reasons: ["paper_ledger_missing"], changed: false };
    const { decision } = await expectedReview(options.root, manifest, record, entry);
    if (options.dryRun) {
      return {
        id: record.id,
        status: decision.status,
        disposition: decision.disposition,
        reasons: decision.unresolvedReasons,
        sourceReasons: decision.sourceReasons,
        observations: decision.observations,
        manualReviewRequirements: decision.manualReviewRequirements,
        inputDigest: decision.inputDigest,
        changed: false
      };
    }
    return await commitDecision(options.root, record, entry, decision);
  });
  return {
    checked: false,
    dryRun: options.dryRun,
    selected: candidates.length,
    skippedCurrent: records.length - candidates.length,
    statuses: countBy(results, (result) => result.status),
    dispositions: countBy(results, (result) => result.disposition),
    results
  };
}

export async function adjudicateExtractionQa(options) {
  const { manifest, ledgers } = await loadCorpus(options.root);
  const [record] = selectRecords(manifest, options);
  const entry = record ? ledgers.get(record.id) : null;
  if (!record || !entry) throw new Error("The selected paper or its ledger is missing");
  if (options.reviewedPages.some((page) => page > record.pdf.pageCount)) {
    throw new Error(`--pages must be within the ${record.pdf.pageCount}-page source PDF`);
  }
  const ledger = JSON.parse(entry.text);
  const automated = await verifyExtractionQaCheckpoint(options.root, manifest, record, ledger, {
    requireComplete: false,
    ignoreAdjudication: true
  });
  if (!automated.ok || automated.state !== "current") {
    throw new Error(`${record.id}: automated Extraction QA decision is not current (${automated.reason || automated.state})`);
  }
  if (automated.decision.status !== "needs_review") {
    throw new Error(`${record.id}: only a current needs_review decision may be manually adjudicated (status=${automated.decision.status})`);
  }
  const adjudicationPath = extractionQaAdjudicationRelativePath(record, automated.inputDigest, automated.decisionSha256);
  const adjudication = {
    schemaVersion: 1,
    stage: "extractQaAdjudication",
    producer: "manual-review-v1",
    paperId: record.id,
    canonicalDoi: record.canonicalDoi,
    sourcePdfSha256: record.pdf.sha256,
    extractionPagesSha256: ledger.stages.extraction.artifacts.pagesSha256,
    automatedDecisionPath: automated.decisionPath,
    automatedDecisionSha256: automated.decisionSha256,
    automatedInputDigest: automated.inputDigest,
    automatedProducerVersion: automated.decision.producerVersion,
    automatedProducerCodeSha256: automated.decision.producerCodeSha256,
    automatedPolicySha256: automated.decision.policySha256,
    sourceReasons: automated.decision.sourceReasons,
    unresolvedReasons: automated.decision.unresolvedReasons,
    disposition: options.adjudication,
    reviewedPages: options.reviewedPages,
    findings: options.findings,
    reviewer: options.reviewer,
    rationale: options.rationale
  };
  const contentIssues = adjudicationContentIssues({ ...adjudication, record, decision: automated.decision });
  if (contentIssues.length) throw new Error(`${record.id}: invalid adjudication evidence (${contentIssues.join(", ")})`);
  const changed = await atomicWriteJson(path.resolve(options.root, ...adjudicationPath.split("/")), adjudication);
  const verified = await verifyExtractionQaCheckpoint(options.root, manifest, record, ledger);
  return {
    paperId: record.id,
    recorded: true,
    changed,
    disposition: adjudication.disposition,
    effectiveStatus: verified.effectiveStatus,
    ok: verified.ok,
    adjudicationPath,
    adjudicationSha256: verified.adjudicationSha256,
    reason: verified.reason || ""
  };
}

function usage() {
  return `Usage:
  node scripts/extraction-qa.mjs status [--paper ID_OR_DOI] [--from ID_OR_DOI] [--limit N] [--jobs N] [--json]
  node scripts/extraction-qa.mjs review [--paper ID_OR_DOI] [--from ID_OR_DOI] [--limit N] [--jobs N] [--dry-run] [--force] [--json]
  node scripts/extraction-qa.mjs review --check [--paper ID_OR_DOI] [--from ID_OR_DOI] [--limit N] [--jobs N] [--json]
  node scripts/extraction-qa.mjs adjudicate --paper ID_OR_DOI (--accept|--reject) --reviewer NAME --pages N[,N...] --finding "PAGE|accept|REASON[,REASON...]|CONCRETE_VISUAL_OBSERVATION" [--finding ...] --rationale TEXT [--json]

The positional command may also be supplied as --select status|review|check. The check selector is an alias for review --check.
Review verifies the live PDF, both extraction artifacts, parser provenance, page sequence, text yield, readability, and title identity before writing an authoritative content-addressed per-paper decision. It never rewrites the shared paper ledger, so concurrent pipeline-stage updates cannot be clobbered.
Fallback provenance remains in sourceReasons even when the selected extraction is accepted. Parser warnings and full legacy font-map fallbacks remain needs_review.`;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.checkpoints) {
    console.log(`Extraction QA status: ${result.selected} selected; ${result.terminal} current terminal checkpoint(s), ${result.releaseReady} release-ready.`);
    console.log(`  checkpoints: ${JSON.stringify(result.checkpoints)}`);
    console.log(`  QA statuses: ${JSON.stringify(result.qaStatuses)}`);
    console.log(`  dispositions: ${JSON.stringify(result.dispositions)}`);
    return;
  }
  if (result.recorded) {
    console.log(`Extraction QA adjudication recorded for ${result.paperId}: ${result.disposition}; effective status ${result.effectiveStatus}.`);
    return;
  }
  if (result.checked) {
    console.log(`Extraction QA check ${result.ok ? "passed" : "failed"}: ${result.selected} selected.`);
    console.log(`  statuses: ${JSON.stringify(result.statuses)}; failures: ${result.failures.length}`);
    return;
  }
  console.log(`Extraction QA ${result.dryRun ? "dry run" : "review"}: ${result.selected} selected; ${result.skippedCurrent} current checkpoint(s) skipped.`);
  console.log(`  statuses: ${JSON.stringify(result.statuses)}`);
  console.log(`  dispositions: ${JSON.stringify(result.dispositions)}`);
}

async function main() {
  const options = parseExtractionQaCli(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = options.command === "status"
    ? await extractionQaStatus(options)
    : options.command === "adjudicate"
      ? await adjudicateExtractionQa(options)
      : await reviewExtractions(options);
  printResult(result, options.json);
  if ((options.check && !result.ok)
    || (options.command === "adjudicate" && !result.ok)
    || result.results?.some((item) => ["failed", "conflict"].includes(item.status))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
