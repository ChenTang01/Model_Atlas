import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AUTHORING_VERSION } from "./model-note-authoring.mjs";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS = new Set(["status", "inventory", "extract"]);
const ELIGIBLE_EXTRACTION_STATUSES = new Set(["pending", "failed", "invalidated"]);
const PARSER_NAME = "pypdf+pymupdf-fallback";
export const CANONICAL_STAGE_NAMES = Object.freeze([
  "inventory",
  "extraction",
  "extractQa",
  "sectionIndex",
  "sourceReading",
  "noteAuthoring",
  "quoteAudit",
  "formulaAudit",
  "schemaValidation",
  "contentAudit",
  "sourceAudit",
  "releaseBuild"
]);
const RELEASE_READY_STATUSES = Object.freeze({
  inventory: new Set(["complete"]),
  extraction: new Set(["complete"]),
  extractQa: new Set(["complete", "needs_review"]),
  sectionIndex: new Set(["complete"]),
  sourceReading: new Set(["complete"]),
  noteAuthoring: new Set(["complete"]),
  quoteAudit: new Set(["complete"]),
  formulaAudit: new Set(["complete"]),
  schemaValidation: new Set(["complete"]),
  contentAudit: new Set(["complete"]),
  sourceAudit: new Set(["complete"]),
  releaseBuild: new Set(["complete"])
});

const PYTHON_INSPECT_SOURCE = String.raw`
import json, logging, pathlib, sys
import pypdf
import pymupdf
from pypdf import PdfReader

payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
logger = logging.getLogger("pypdf")
logger.setLevel(logging.WARNING)
logger.propagate = False

class Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.current = None
        self.messages = {}
    def emit(self, record):
        if self.current is not None:
            self.messages.setdefault(self.current, []).append(record.getMessage())

capture = Capture()
logger.handlers = [capture]
results = []
paper_dir = pathlib.Path(payload["paperDir"])
for item in payload["records"]:
    capture.current = item["id"]
    result = {"id": item["id"], "pageCount": None, "encrypted": None, "error": None}
    try:
        reader = PdfReader(paper_dir / item["file"], strict=False)
        result["encrypted"] = bool(reader.is_encrypted)
        result["pageCount"] = len(reader.pages)
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
    messages = capture.messages.get(item["id"], [])
    codes = set()
    for message in messages:
        if message.startswith("Ignoring wrong pointing object"):
            codes.add("wrong_pointing_object")
        else:
            codes.add("parser_warning")
    result["warningCount"] = len(messages)
    result["warningCodes"] = sorted(codes)
    result["warningSamples"] = sorted(set(messages))[:5]
    results.append(result)

output = {
    "parser": "pypdf+pymupdf-fallback",
    "version": f"pypdf-{pypdf.__version__}+pymupdf-{pymupdf.__version__}",
    "records": results,
}
sys.stdout.buffer.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
`;

const PYTHON_EXTRACT_SOURCE = String.raw`
import json, logging, pathlib, sys
import pypdf
import pymupdf
from pypdf import PdfReader

payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
logger = logging.getLogger("pypdf")
logger.setLevel(logging.WARNING)
logger.propagate = False
messages = []

class Capture(logging.Handler):
    def emit(self, record):
        messages.append(record.getMessage())

logger.handlers = [Capture()]
reader = PdfReader(pathlib.Path(payload["path"]), strict=False)
pages = []
page_errors = []
for index, page in enumerate(reader.pages):
    try:
        text = page.extract_text() or ""
    except Exception as error:
        text = ""
        page_errors.append({"page": index + 1, "error": f"{type(error).__name__}: {error}"})
    pages.append({"page": index + 1, "text": text})
codes = set()
for message in messages:
    if message.startswith("Ignoring wrong pointing object"):
        codes.add("wrong_pointing_object")
    else:
        codes.add("parser_warning")
output = {
    "parser": "pypdf+pymupdf-fallback",
    "version": f"pypdf-{pypdf.__version__}+pymupdf-{pymupdf.__version__}",
    "primaryParser": "pypdf",
    "primaryVersion": pypdf.__version__,
    "fallbackParser": "pymupdf",
    "fallbackVersion": pymupdf.__version__,
    "encrypted": bool(reader.is_encrypted),
    "warningCount": len(messages),
    "warningCodes": sorted(codes),
    "warningSamples": sorted(set(messages))[:5],
    "pageErrors": page_errors,
    "pages": pages,
}
sys.stdout.buffer.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
`;

const PYTHON_PYMUPDF_EXTRACT_SOURCE = String.raw`
import json, pathlib, sys
import pymupdf

payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
document = pymupdf.open(pathlib.Path(payload["path"]))
pages = []
page_errors = []
for index in range(document.page_count):
    try:
        text = document[index].get_text() or ""
    except Exception as error:
        text = ""
        page_errors.append({"page": index + 1, "error": f"{type(error).__name__}: {error}"})
    pages.append({"page": index + 1, "text": text})
output = {
    "parser": "pymupdf",
    "version": pymupdf.__version__,
    "pageErrors": page_errors,
    "pages": pages,
}
sys.stdout.buffer.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
`;

/** Detect the systematic character-map failure where punctuation and common
 * letters are decoded as M/N/L/® tokens despite a high apparent text yield. */
export const EXTRACTION_POLICY = Object.freeze({
  schemaVersion: 1,
  corruptionTrigger: Object.freeze({
    minimumTextLength: 1000,
    minimumEncodedHeadings: 2,
    minimumEmbeddedM: 50,
    minimumBrokenK: 20,
    minimumTerminalN: 100,
    minimumRawGlyphNames: 1,
    minimumReplacementCharacters: 20,
    minimumVeryLongLowercaseTokens: 20,
    minimumLetterSpacedRuns: 10
  }),
  fallbackAcceptance: Object.freeze({
    minimumTotalCharacters: 1000,
    minimumCharactersPerPage: 200,
    minimumNonemptyPageFraction: 0.8,
    primaryComparisonStartsAtCharacters: 5000,
    minimumPrimaryCharacterFraction: 0.2
  })
});

export function extractionCorruptionProfile(input) {
  const text = Array.isArray(input)
    ? input.map((page) => String(page?.text || "")).join("\n")
    : String(input ?? "");
  const embeddedM = (text.match(/(?<=[a-z])M(?=[a-z])/g) || []).length;
  const brokenK = (text.match(/(?<=[a-z])®(?=[a-z])/g) || []).length;
  const encodedHeadings = (text.match(/(?:NscO|OoneNalt|tOhNscO|pOrNscO|lOeNscO|rOeNscO)/g) || []).length;
  const terminalN = (text.match(/(?<=[a-z])N(?=\s|$)/g) || []).length;
  const rawGlyphNames = (text.match(/\/(?:uni[0-9A-F]{4,6}|equals?|equal[a-z]*|radicaltpext|summationdisplay|SL[A-Za-z]+)/g) || []).length;
  const replacementCharacters = (text.match(/�/g) || []).length;
  const veryLongLowercaseTokens = (text.match(/\b[a-z]{24,}\b/g) || []).length;
  const letterSpacedRuns = (text.match(/(?:^|\s)(?:[A-Za-z]\s+){5,}[A-Za-z](?=\s|$)/gm) || []).length;
  const legacyFontMap = encodedHeadings >= EXTRACTION_POLICY.corruptionTrigger.minimumEncodedHeadings
    || (embeddedM >= EXTRACTION_POLICY.corruptionTrigger.minimumEmbeddedM
      && brokenK >= EXTRACTION_POLICY.corruptionTrigger.minimumBrokenK
      && terminalN >= EXTRACTION_POLICY.corruptionTrigger.minimumTerminalN);
  return {
    textLength: text.length,
    embeddedM,
    brokenK,
    encodedHeadings,
    terminalN,
    rawGlyphNames,
    replacementCharacters,
    veryLongLowercaseTokens,
    letterSpacedRuns,
    legacyFontMap
  };
}

function corruptionSeverity(profile) {
  return (profile.legacyFontMap ? 1_000_000 : 0)
    + profile.rawGlyphNames * 50
    + profile.replacementCharacters * 2
    + profile.veryLongLowercaseTokens * 5
    + profile.letterSpacedRuns * 20;
}

function hardCorruptionSeverity(profile) {
  return (profile.legacyFontMap ? 1_000_000 : 0)
    + profile.rawGlyphNames * 50
    + profile.replacementCharacters * 2
    + profile.veryLongLowercaseTokens * 5;
}

/** Prefer the alternate parser only when it improves the corruption profile.
 * Dense letter spacing can be legitimate in tables and headings, so it is a
 * comparison trigger rather than a reason to discard otherwise clean text. */
export function preferFallbackExtraction(primaryProfile, fallbackProfile) {
  const primaryHard = hardCorruptionSeverity(primaryProfile);
  const fallbackHard = hardCorruptionSeverity(fallbackProfile);
  if (fallbackHard !== primaryHard) return fallbackHard < primaryHard;
  return corruptionSeverity(fallbackProfile) < corruptionSeverity(primaryProfile);
}

export function systematicFontMapCorruption(input) {
  const profile = extractionCorruptionProfile(input);
  if (profile.textLength < EXTRACTION_POLICY.corruptionTrigger.minimumTextLength) return false;
  return profile.legacyFontMap
    || profile.rawGlyphNames >= EXTRACTION_POLICY.corruptionTrigger.minimumRawGlyphNames
    || profile.replacementCharacters >= EXTRACTION_POLICY.corruptionTrigger.minimumReplacementCharacters
    || profile.veryLongLowercaseTokens >= EXTRACTION_POLICY.corruptionTrigger.minimumVeryLongLowercaseTokens
    || profile.letterSpacedRuns >= EXTRACTION_POLICY.corruptionTrigger.minimumLetterSpacedRuns;
}

function extractedTextStats(pages) {
  const values = Array.isArray(pages) ? pages.map((page) => String(page?.text || "")) : [];
  const totalCharacters = values.reduce((sum, value) => sum + value.length, 0);
  const nonemptyPages = values.filter((value) => value.trim()).length;
  return {
    totalCharacters,
    nonemptyPages,
    charactersPerPage: totalCharacters / Math.max(1, values.length)
  };
}

export const INSPECTOR_CODE_SHA256 = sha256(PYTHON_INSPECT_SOURCE);
export const EXTRACTOR_CODE_SHA256 = sha256([
  PYTHON_EXTRACT_SOURCE,
  PYTHON_PYMUPDF_EXTRACT_SOURCE,
  extractionCorruptionProfile.toString(),
  corruptionSeverity.toString(),
  hardCorruptionSeverity.toString(),
  preferFallbackExtraction.toString(),
  systematicFontMapCorruption.toString(),
  extractedTextStats.toString(),
  stableStringify(EXTRACTION_POLICY)
].join("\0"));

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function stableStringify(value, space = 0) {
  return JSON.stringify(canonicalize(value), null, space);
}

export function normalizeDoi(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

export function doiRouteId(value) {
  return `doi-${normalizeDoi(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function normalizeFilename(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

export function parseCli(argv) {
  const options = {
    command: null,
    root: SCRIPT_ROOT,
    python: "",
    limit: null,
    jobs: null,
    papers: [],
    from: "",
    dryRun: false,
    force: false,
    retryFailed: false,
    check: false,
    checkReady: false,
    refreshSummary: false,
    json: false,
    help: false,
    claimTtlMinutes: 60
  };
  let selected = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (COMMANDS.has(argument)) {
      if (options.command && options.command !== argument) throw new Error("Only one pipeline command may be selected");
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
      case "--python": options.python = takeValue(); break;
      case "--limit": options.limit = positiveInteger(takeValue(), "--limit"); break;
      case "--jobs": options.jobs = positiveInteger(takeValue(), "--jobs"); break;
      case "--paper":
      case "--id": options.papers.push(...takeValue().split(",").map((value) => value.trim()).filter(Boolean)); break;
      case "--from": options.from = takeValue().trim(); break;
      case "--claim-ttl-minutes": options.claimTtlMinutes = positiveInteger(takeValue(), "--claim-ttl-minutes"); break;
      case "--dry-run": options.dryRun = true; break;
      case "--force": options.force = true; break;
      case "--retry-failed": options.retryFailed = true; break;
      case "--check": options.check = true; break;
      case "--check-ready": options.checkReady = true; break;
      case "--refresh-summary": options.refreshSummary = true; break;
      case "--json": options.json = true; break;
      case "--help":
      case "-h": options.help = true; break;
      default: throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (selected && !COMMANDS.has(selected)) throw new Error(`Unknown selector: ${selected}`);
  if (selected && options.command && selected !== options.command) {
    throw new Error(`Conflicting pipeline selectors: ${options.command} and ${selected}`);
  }
  options.command = selected || options.command || "status";
  if (options.command !== "extract" && (options.papers.length || options.from || options.limit || options.dryRun || options.force || options.retryFailed)) {
    throw new Error("--paper, --from, --limit, --dry-run, --force, and --retry-failed are extract-only options");
  }
  if (options.command !== "inventory" && options.check) throw new Error("--check is an inventory-only option");
  if (options.command !== "status" && (options.checkReady || options.refreshSummary)) {
    throw new Error("--check-ready and --refresh-summary are status-only options");
  }
  if (options.force && options.retryFailed) throw new Error("--force and --retry-failed are mutually exclusive");
  options.jobs ??= options.command === "inventory" ? 8 : Math.max(1, Math.min(4, os.cpus().length));
  return options;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfPresent(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function atomicWriteText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function atomicWriteJson(filePath, value) {
  const text = `${stableStringify(value, 2)}\n`;
  const current = await readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (current === text) return false;
  await atomicWriteText(filePath, text);
  return true;
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

function duplicateGroups(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].filter(([, values]) => values.length > 1);
}

function assertUniqueSourceIdentity(records) {
  const checks = [
    ["ID", (record) => String(record.id ?? "")],
    ["DOI", (record) => normalizeDoi(record.doi)],
    ["bibkey", (record) => String(record.bibkey ?? "").toLowerCase()],
    ["PDF filename", (record) => normalizeFilename(record.pdf_file)]
  ];
  for (const [label, keyOf] of checks) {
    const blank = records.find((record) => !keyOf(record));
    if (blank) throw new Error(`Missing ${label}: ${blank.id || blank.title || "unknown record"}`);
    const duplicate = duplicateGroups(records, keyOf)[0];
    if (duplicate) throw new Error(`Duplicate ${label}: ${duplicate[0]}`);
  }
}

function pythonCandidates(options) {
  const candidates = [];
  const add = (command, prefix = []) => {
    if (command && !candidates.some((item) => item.command === command && String(item.prefix) === String(prefix))) {
      candidates.push({ command, prefix });
    }
  };
  add(options.python);
  add(process.env.ATLAS_PYTHON);
  if (process.env.USERPROFILE) {
    add(path.join(process.env.USERPROFILE, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"));
  }
  add("python");
  add("python3");
  if (process.platform === "win32") add("py", ["-3"]);
  return candidates;
}

async function spawnBuffered(command, args, input, maxBytes = 256 * 1024 * 1024) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.on("error", fail);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) fail(new Error(`Python output exceeded ${maxBytes} bytes`));
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxBytes) stderr.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const output = Buffer.concat(stdout).toString("utf8");
      const errors = Buffer.concat(stderr).toString("utf8");
      if (code === 0) resolve({ stdout: output, stderr: errors });
      else reject(Object.assign(new Error(errors.trim() || `Python exited with code ${code}`), { exitCode: code }));
    });
    child.stdin.on("error", fail);
    child.stdin.end(input);
  });
}

async function runPython(source, input, options) {
  const failures = [];
  for (const candidate of pythonCandidates(options)) {
    try {
      const result = await spawnBuffered(candidate.command, [...candidate.prefix, "-c", source], input);
      return { ...result, command: candidate.command };
    } catch (error) {
      failures.push(`${candidate.command}: ${error.message}`);
      if (options.python || process.env.ATLAS_PYTHON) break;
    }
  }
  throw new Error(`A Python runtime with pypdf and PyMuPDF is required. Set ATLAS_PYTHON or --python. Attempts: ${failures.join(" | ")}`);
}

async function inspectPdfs(paperDir, records, options) {
  const payload = JSON.stringify({ paperDir, records: records.map((record) => ({ id: record.id, file: record.pdf_file })) });
  const { stdout, command } = await runPython(PYTHON_INSPECT_SOURCE, payload, options);
  const parsed = JSON.parse(stdout);
  parsed.command = command;
  return parsed;
}

async function loadImportMappings(root) {
  const auditPath = path.join(root, "data", "imports", "atlas_literature_2016_present", "IMPORT_AUDIT.json");
  const audit = await readJsonIfPresent(auditPath);
  const mappings = new Map();
  for (const mapping of audit?.mappings || []) mappings.set(normalizeDoi(mapping.doi), mapping);
  return {
    path: audit ? path.relative(root, auditPath).replaceAll(path.sep, "/") : "",
    sha256: audit ? sha256(await readFile(auditPath)) : "",
    mappings
  };
}

export function validateStructuredSamplePopulation(sample, sourceRecords, sourceDataSha256 = "") {
  if (!sample || !Array.isArray(sample.records) || !sample.records.length) {
    throw new Error("Mini Atlas sample has no frozen records");
  }
  const seed = String(sample.seed || "");
  const count = Number(sample.count);
  if (!/^[a-f0-9]{32}$/i.test(seed) || !Number.isInteger(count) || count !== sample.records.length) {
    throw new Error("Mini Atlas sample has an invalid seed or count");
  }

  const recordsById = new Map(sourceRecords.map((record) => [String(record.id), record]));
  if (recordsById.size !== sourceRecords.length) throw new Error("Current Atlas source IDs are not unique");
  const rankedCurrent = sourceRecords
    .map((record) => ({
      id: String(record.id),
      draw: sha256(`${seed}\0${String(record.id)}`)
    }))
    .sort((a, b) => compareOrdinal(a.draw, b.draw))
    .slice(0, count);
  const frozen = [...sample.records]
    .sort((a, b) => Number(a.sample_rank) - Number(b.sample_rank));

  for (const [index, sampleRecord] of frozen.entries()) {
    const expectedRank = index + 1;
    const sourceId = String(sampleRecord.source_id || "");
    const source = recordsById.get(sourceId);
    if (!source) throw new Error(`Mini sample source is absent from the current Atlas corpus: ${sourceId || sampleRecord.id}`);
    const expectedDraw = sha256(`${seed}\0${sourceId}`);
    if (Number(sampleRecord.sample_rank) !== expectedRank || String(sampleRecord.draw) !== expectedDraw) {
      throw new Error(`Mini sample draw or rank is invalid: ${sampleRecord.id}`);
    }
    if (rankedCurrent[index]?.id !== sourceId || rankedCurrent[index]?.draw !== expectedDraw) {
      throw new Error(`Mini sample selection changed against the current Atlas corpus at rank ${expectedRank}`);
    }
    if (String(sampleRecord.source_pdf_file || "") !== String(source.pdf_file || "")) {
      throw new Error(`Mini sample source PDF mapping changed: ${sampleRecord.id}`);
    }
    if (String(sampleRecord.sha256 || "").toLowerCase() !== String(source.pdf_sha256 || "").toLowerCase()) {
      throw new Error(`Mini sample source PDF hash changed: ${sampleRecord.id}`);
    }
    if (Number(sampleRecord.bytes) !== Number(source.pdf_bytes)) {
      throw new Error(`Mini sample source PDF byte count changed: ${sampleRecord.id}`);
    }
    if (normalizeDoi(sampleRecord.doi) !== normalizeDoi(source.doi)) {
      throw new Error(`Mini sample source DOI changed: ${sampleRecord.id}`);
    }
  }

  const currentIds = [...recordsById.keys()].sort(compareOrdinal);
  const frozenPopulationIds = Array.isArray(sample.populationIds)
    ? sample.populationIds.map(String).sort(compareOrdinal)
    : [];
  const currentIdSet = new Set(currentIds);
  const frozenIdSet = new Set(frozenPopulationIds);
  return {
    sourceDataSha256Matches: Boolean(sourceDataSha256)
      && String(sample.sourceSha256 || "").toLowerCase() === String(sourceDataSha256).toLowerCase(),
    originalSourceDataSha256: String(sample.sourceSha256 || "").toLowerCase(),
    originalPopulation: Number(sample.population),
    currentPopulation: currentIds.length,
    removedPopulationIds: frozenPopulationIds.filter((id) => !currentIdSet.has(id)),
    addedPopulationIds: currentIds.filter((id) => !frozenIdSet.has(id)),
    currentPopulationIdsSha256: sha256(stableStringify(currentIds)),
    selectionRevalidated: true
  };
}

async function loadStructuredNoteSeeds(root, sourceRecords, sourceDataSha256) {
  const miniRoot = path.join(root, "mini-atlas");
  const samplePath = path.join(miniRoot, "research", "sample.json");
  const sample = await readJsonIfPresent(samplePath);
  if (!sample) {
    // A fixture root with no Mini tree may intentionally have no frozen seed.
    // Once the Mini tree exists, however, its canonical sample is part of the
    // release contract: silently treating a deleted sample as zero seeds would
    // let stale frozen-note checkpoints survive inventory reconciliation.
    if (await exists(miniRoot)) throw new Error("Mini Atlas tree exists but research/sample.json is missing");
    return { records: new Map(), samplePath: "", sampleSha256: "" };
  }
  const populationValidation = validateStructuredSamplePopulation(sample, sourceRecords, sourceDataSha256);
  const notesDir = path.join(miniRoot, "data", "notes");
  const noteFiles = (await readdir(notesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^batch-[a-z0-9_-]+\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const notes = new Map();
  for (const filename of noteFiles) {
    const payload = await readJson(path.join(notesDir, filename));
    for (const note of payload.papers || []) {
      if (notes.has(note.id)) throw new Error(`Duplicate Mini authored note: ${note.id}`);
      notes.set(note.id, { note, filename });
    }
  }
  const seeds = new Map();
  for (const sampleRecord of sample.records || []) {
    const authored = notes.get(sampleRecord.id);
    if (!authored) throw new Error(`Mini sample paper has no authored note: ${sampleRecord.id}`);
    const sourceId = String(sampleRecord.source_id || "");
    if (!sourceId || seeds.has(sourceId)) throw new Error(`Invalid Mini source mapping: ${sampleRecord.id}`);
    const pagesPath = path.posix.join("mini-atlas", "research", "pages", `${sampleRecord.id}.json`);
    const pagesBytes = await readFile(path.join(root, ...pagesPath.split("/")));
    const pagesPayload = JSON.parse(pagesBytes.toString("utf8"));
    const pageEntries = Array.isArray(pagesPayload) ? pagesPayload : pagesPayload?.pages;
    if (!Array.isArray(pageEntries) || !pageEntries.length) throw new Error(`Mini sample paper has no frozen source pages: ${sampleRecord.id}`);
    seeds.set(sourceId, {
      miniPaperId: sampleRecord.id,
      notePath: path.posix.join("mini-atlas", "data", "notes", authored.filename),
      noteSha256: sha256(stableStringify(authored.note)),
      pagesPath,
      pagesSha256: sha256(pagesBytes),
      samplePdfSha256: String(sampleRecord.sha256).toLowerCase()
    });
  }
  return {
    records: seeds,
    samplePath: path.relative(root, samplePath).replaceAll(path.sep, "/"),
    sampleSha256: sha256(await readFile(samplePath)),
    populationValidation
  };
}

function extractionInputDigest(record, parserVersion) {
  return sha256(stableStringify({
    schemaVersion: 1,
    pdfSha256: record.pdf.sha256,
    parser: PARSER_NAME,
    parserVersion,
    extractorCodeSha256: EXTRACTOR_CODE_SHA256
  }));
}

const REPAIR_PROMOTION_VERSION = "extraction-repair-promotion-v1";
const REPAIR_PROMOTION_CODE_SHA256 = "e75fa05f767774d6fb3898c61812bcc7175ae6fe05999a1a64eb475e9b0e512c";
const REPAIR_PROMOTION_POLICY_SHA256 = "6c4cc4cbb96b9c59e25838033562efe23cd974a56c3ca1b707d087e096720692";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function repairPromotionExtractionContractIssues(record, extraction) {
  const issues = [];
  const marker = extraction?.repairPromotion;
  const input = marker?.promotionInput;
  const accepted = input?.acceptedAdjudication;
  const candidateBase = path.posix.join(
    "research", "ledger", "extraction-repair-candidates", String(record?.id || ""), String(accepted?.repairInputDigest || "")
  );
  const baseArtifactBase = path.posix.join(
    "research", "ledger", "artifacts", String(record?.id || ""), String(input?.baseExtraction?.inputDigest || "")
  );
  const expectedArtifactBase = path.posix.join(
    "research", "ledger", "artifacts", String(record?.id || ""), String(extraction?.inputDigest || "")
  );
  const expectedTransactionBase = path.posix.join(
    "research", "ledger", "extraction-repair-promotions", String(record?.id || ""), String(extraction?.inputDigest || "")
  );
  const mismatch = (condition, code) => { if (condition) issues.push(code); };
  mismatch(extraction?.status !== "complete", "promotion_extraction_not_complete");
  mismatch(marker?.schemaVersion !== 1 || marker?.stage !== "extractionRepairPromotion", "promotion_marker_schema_invalid");
  mismatch(marker?.producerVersion !== REPAIR_PROMOTION_VERSION, "promotion_version_invalid");
  mismatch(marker?.producerCodeSha256 !== REPAIR_PROMOTION_CODE_SHA256, "promotion_code_hash_invalid");
  mismatch(marker?.policySha256 !== REPAIR_PROMOTION_POLICY_SHA256, "promotion_policy_hash_invalid");
  mismatch(!SHA256_PATTERN.test(extraction?.inputDigest || "")
    || marker?.promotionInputDigest !== extraction?.inputDigest, "promotion_input_digest_binding_invalid");
  mismatch(!input || sha256(stableStringify(input)) !== extraction?.inputDigest, "promotion_input_digest_invalid");
  mismatch(input?.schemaVersion !== 1 || input?.stage !== "extractionRepairPromotionInput", "promotion_input_schema_invalid");
  mismatch(input?.producerVersion !== marker?.producerVersion
    || input?.producerCodeSha256 !== marker?.producerCodeSha256
    || input?.policySha256 !== marker?.policySha256, "promotion_input_producer_binding_invalid");
  mismatch(input?.paperId !== record?.id || input?.canonicalDoi !== record?.canonicalDoi
    || input?.manifestRecordDigest !== record?.recordDigest, "promotion_manifest_identity_invalid");
  mismatch(input?.sourcePdf?.sha256 !== record?.pdf?.sha256
    || input?.sourcePdf?.pageCount !== record?.pdf?.pageCount
    || input?.sourcePdf?.path !== record?.pdf?.path
    || input?.sourcePdf?.bytes !== record?.pdf?.bytes
    || input?.sourcePdf?.header !== "%PDF-", "promotion_source_identity_invalid");
  mismatch(accepted?.disposition !== "accepted"
    || !SHA256_PATTERN.test(accepted?.sha256 || "")
    || !SHA256_PATTERN.test(accepted?.recordDigest || "")
    || !SHA256_PATTERN.test(accepted?.adjudicationInputDigest || "")
    || !SHA256_PATTERN.test(accepted?.repairInputDigest || "")
    || accepted?.path !== path.posix.join("research", "ledger", "extraction-repair-adjudications",
      String(record?.id || ""), String(accepted?.adjudicationInputDigest || ""), `${accepted?.recordDigest}.json`),
  "promotion_adjudication_binding_invalid");
  for (const field of ["candidateSha256", "pagesSha256", "textSha256", "provenanceSha256"]) {
    mismatch(!SHA256_PATTERN.test(input?.candidate?.[field] || ""), `promotion_${field}_invalid`);
  }
  mismatch(input?.candidate?.candidatePath !== path.posix.join(candidateBase, "candidate.json")
    || input?.candidate?.pagesPath !== path.posix.join(candidateBase, "pages.json")
    || input?.candidate?.textPath !== path.posix.join(candidateBase, "text.txt")
    || input?.candidate?.provenancePath !== path.posix.join(candidateBase, "glyph-provenance.json"),
  "promotion_candidate_path_invalid");
  mismatch(!SHA256_PATTERN.test(input?.baseLedger?.sha256 || "")
    || !SHA256_PATTERN.test(input?.baseExtraction?.stageSha256 || "")
    || !SHA256_PATTERN.test(input?.baseExtraction?.inputDigest || ""), "promotion_base_binding_invalid");
  mismatch(input?.baseLedger?.path !== path.posix.join("research", "ledger", "papers", `${record?.id}.json`)
    || input?.baseExtraction?.pagesPath !== path.posix.join(baseArtifactBase, "pages.json")
    || input?.baseExtraction?.textPath !== path.posix.join(baseArtifactBase, "text.txt")
    || !SHA256_PATTERN.test(input?.baseExtraction?.pagesSha256 || "")
    || !SHA256_PATTERN.test(input?.baseExtraction?.textSha256 || ""), "promotion_base_path_invalid");
  mismatch(!SHA256_PATTERN.test(input?.quiescenceToken?.sha256 || "")
    || !SHA256_PATTERN.test(input?.quiescenceToken?.tokenDigest || "")
    || input?.quiescenceToken?.baseLedgerSha256 !== input?.baseLedger?.sha256
    || input?.quiescenceToken?.path !== path.posix.join("research", "ledger", "extraction-repair-quiescence",
      String(record?.id || ""), `${input?.quiescenceToken?.tokenDigest}.json`), "promotion_quiescence_binding_invalid");
  mismatch(extraction?.sourcePdfSha256 !== record?.pdf?.sha256
    || extraction?.pageCount !== record?.pdf?.pageCount, "promotion_extraction_source_invalid");
  mismatch(!Number.isInteger(extraction?.attempts) || extraction.attempts < 1
    || Number.isNaN(Date.parse(extraction?.completedAt || "")), "promotion_extraction_completion_invalid");
  mismatch(!Number.isInteger(extraction?.totalCharacters) || extraction.totalCharacters < 0
    || !Array.isArray(extraction?.emptyPages)
    || !Array.isArray(extraction?.pageErrors)
    || !Array.isArray(extraction?.parserWarningCodes)
    || !Number.isInteger(extraction?.parserWarningCount)
    || extraction.parserWarningCount < 0, "promotion_extraction_metrics_invalid");
  mismatch(extraction?.selectedEngine !== "extraction-repair-promotion"
    || extraction?.selectedEngineVersion !== REPAIR_PROMOTION_VERSION, "promotion_engine_identity_invalid");
  mismatch(typeof extraction?.fallbackAttempted !== "boolean"
    || typeof extraction?.fallbackUsed !== "boolean"
    || extraction?.fallbackReason !== "accepted-extraction-repair-promotion"
    || !extraction?.selectedCorruptionProfile
    || typeof extraction.selectedCorruptionProfile !== "object", "promotion_provenance_invalid");
  mismatch(extraction?.artifacts?.pages !== path.posix.join(expectedArtifactBase, "pages.json")
    || extraction?.artifacts?.text !== path.posix.join(expectedArtifactBase, "text.txt"), "promotion_artifact_path_invalid");
  mismatch(!SHA256_PATTERN.test(extraction?.artifacts?.pagesSha256 || "")
    || extraction?.artifacts?.textSha256 !== input?.candidate?.textSha256, "promotion_artifact_hash_invalid");
  mismatch(marker?.prepare?.path !== path.posix.join(expectedTransactionBase, "prepare", `${marker?.prepare?.recordDigest}.json`)
    || !SHA256_PATTERN.test(marker?.prepare?.recordDigest || "")
    || !SHA256_PATTERN.test(marker?.prepare?.sha256 || ""), "promotion_prepare_binding_invalid");
  return [...new Set(issues)].sort();
}

function validRepairPromotionExtraction(record, extraction) {
  return Boolean(extraction?.repairPromotion)
    && repairPromotionExtractionContractIssues(record, extraction).length === 0;
}

export function makeRepairPromotionExtractQaStage(record, extraction) {
  const input = extraction.repairPromotion.promotionInput;
  return {
    status: "needs_review",
    inputDigest: extraction.inputDigest,
    sourcePdfSha256: record.pdf.sha256,
    reasons: ["repair_promotion_requires_authoritative_qa"],
    warningCodes: [...(extraction.parserWarningCodes || [])],
    pageErrors: [...(extraction.pageErrors || [])],
    emptyPages: [...(extraction.emptyPages || [])],
    totalCharacters: extraction.totalCharacters,
    selectedEngine: extraction.selectedEngine,
    selectedEngineVersion: extraction.selectedEngineVersion,
    fallbackAttempted: Boolean(extraction.fallbackAttempted),
    fallbackUsed: Boolean(extraction.fallbackUsed),
    fallbackReason: extraction.fallbackReason,
    primaryCorruptionProfile: extraction.primaryCorruptionProfile || null,
    fallbackCorruptionProfile: extraction.fallbackCorruptionProfile || null,
    selectedCorruptionProfile: extraction.selectedCorruptionProfile,
    repairPromotionInputDigest: extraction.inputDigest,
    acceptedRepairAdjudicationPath: input.acceptedAdjudication.path,
    acceptedRepairAdjudicationSha256: input.acceptedAdjudication.sha256
  };
}

function validRepairPromotionExtractQa(record, extraction, extractQa) {
  return stableStringify(extractQa) === stableStringify(makeRepairPromotionExtractQaStage(record, extraction));
}

export function assertExtractionContract(manifest, selected = []) {
  if (
    manifest?.parser?.extractionCodeSha256 !== EXTRACTOR_CODE_SHA256
    || stableStringify(manifest?.parser?.extractionPolicy ?? null) !== stableStringify(EXTRACTION_POLICY)
  ) {
    throw new Error("Extraction code or policy differs from the corpus manifest; rerun inventory");
  }
  for (const item of selected) {
    const expected = extractionInputDigest(item.record, manifest.parser.version);
    const extraction = item.ledger?.stages?.extraction;
    if (extraction?.inputDigest !== expected && !validRepairPromotionExtraction(item.record, extraction)) {
      throw new Error(`${item.record.id}: extraction ledger input differs from the current manifest contract; rerun inventory`);
    }
  }
}

function initialNoteStage(record, structuredSeed, legacyNotesSha256) {
  const sourcePdfSha256 = record.pdf.sha256;
  if (structuredSeed) {
    if (structuredSeed.samplePdfSha256 !== sourcePdfSha256) {
      return {
        status: "invalidated",
        reasonCode: "mini_pdf_hash_changed",
        source: "mini-atlas-schema-v2",
        sourcePdfSha256,
        inputDigest: sha256(`${sourcePdfSha256}\0${structuredSeed.noteSha256}\0${structuredSeed.pagesSha256}`),
        miniPaperId: structuredSeed.miniPaperId,
        notePath: structuredSeed.notePath,
        noteSha256: structuredSeed.noteSha256,
        pagesPath: structuredSeed.pagesPath,
        pagesSha256: structuredSeed.pagesSha256
      };
    }
    return {
      status: "complete",
      source: "mini-atlas-schema-v2",
      sourcePdfSha256,
      inputDigest: sha256(`${sourcePdfSha256}\0${structuredSeed.noteSha256}\0${structuredSeed.pagesSha256}`),
      miniPaperId: structuredSeed.miniPaperId,
      notePath: structuredSeed.notePath,
      noteSha256: structuredSeed.noteSha256,
      pagesPath: structuredSeed.pagesPath,
      pagesSha256: structuredSeed.pagesSha256
    };
  }
  if (record.sourceDetailLevel === "model_map") {
    return {
      status: "needs_review",
      source: "legacy-deep-model-map",
      sourcePdfSha256,
      inputDigest: sha256(`${sourcePdfSha256}\0${record.sourceRecordDigest}\0${legacyNotesSha256}`),
      reasonCode: "legacy_map_requires_component_migration",
      notePath: "atlas_game_theory_preliminary_analysis.md",
      noteSha256: legacyNotesSha256
    };
  }
  return {
    status: "pending",
    source: "evidence-index-record",
    sourcePdfSha256,
    inputDigest: sha256(`${sourcePdfSha256}\0${record.sourceRecordDigest}`),
    reasonCode: "full_source_authoring_required"
  };
}

function preserveCompatibleProgress(seed, existing, invalidatedReason = "") {
  if (!existing) return seed;
  if (invalidatedReason) {
    if (existing.status === "pending" && seed.status === "pending") return seed;
    return {
      ...existing,
      ...seed,
      status: "invalidated",
      invalidatedReason
    };
  }
  if (existing.status === "complete") return existing;
  if (seed.status === "complete") return seed;
  if (["needs_review", "failed", "invalidated", "blocked"].includes(existing.status) && seed.status === "pending") return existing;
  return seed;
}

function pendingReviewStage(stageName, record, noteStage, additions = {}) {
  const input = {
    schemaVersion: 1,
    stage: stageName,
    sourcePdfSha256: record.pdf.sha256,
    manifestRecordDigest: record.recordDigest,
    ...additions
  };
  if (!["sectionIndex", "sourceReading"].includes(stageName)) {
    input.noteInputDigest = noteStage.inputDigest || null;
    input.noteSha256 = noteStage.noteSha256 || null;
  }
  return {
    status: "pending",
    inputDigest: sha256(stableStringify(input)),
    sourcePdfSha256: record.pdf.sha256
  };
}

function stageDependencySnapshot(stages, stageNames) {
  return Object.fromEntries(stageNames.map((stageName) => {
    const stage = stages[stageName] || {};
    return [stageName, {
      status: stage.status || "missing",
      inputDigest: stage.inputDigest || null,
      noteSha256: stage.noteSha256 || null
    }];
  }));
}

function firstReason(...reasons) {
  return reasons.find(Boolean) || "";
}

function noteRestartSeed(record, noteSeed, extractionDigest, conceptRegistrySha256, isMini) {
  if (isMini) return noteSeed;
  return {
    ...noteSeed,
    inputDigest: sha256(stableStringify({
      schemaVersion: 1,
      stage: "noteAuthoring",
      sourcePdfSha256: record.pdf.sha256,
      manifestRecordDigest: record.recordDigest,
      extractionInputDigest: extractionDigest,
      authoringVersion: AUTHORING_VERSION,
      conceptRegistrySha256: conceptRegistrySha256 || null
    }))
  };
}

export function makeLedger(record, manifest, structuredSeed, legacyNotesSha256, existing, conceptRegistrySha256 = "") {
  const inventoryStatus = record.integrityIssues.length ? "needs_review" : "complete";
  const extractionDigest = extractionInputDigest(record, manifest.parser.version);
  const parserWarnings = record.pdf.parse.warningCount > 0;
  const noteSeed = initialNoteStage(record, structuredSeed, legacyNotesSha256);
  const base = {
    schemaVersion: 1,
    paperId: record.id,
    canonicalDoi: record.canonicalDoi,
    corpusRevision: manifest.corpusRevision,
    manifestRecordDigest: record.recordDigest,
    pdfSha256: record.pdf.sha256,
    pipelineInputs: {
      authoringVersion: AUTHORING_VERSION,
      conceptRegistrySha256: conceptRegistrySha256 || null
    },
    stages: {
      inventory: {
        status: inventoryStatus,
        inputDigest: record.recordDigest,
        pdfSha256: record.pdf.sha256,
        pageCount: record.pdf.pageCount,
        parseStatus: record.pdf.parse.status,
        issues: record.integrityIssues
      },
      extraction: {
        status: inventoryStatus === "complete" ? "pending" : "blocked",
        inputDigest: extractionDigest,
        sourcePdfSha256: record.pdf.sha256,
        attempts: 0,
        ...(inventoryStatus === "complete" ? {} : { reasonCode: "inventory_not_complete" })
      },
      extractQa: {
        status: parserWarnings ? "needs_review" : "pending",
        inputDigest: extractionDigest,
        sourcePdfSha256: record.pdf.sha256,
        reasons: parserWarnings ? ["parser_warning"] : [],
        warningCodes: record.pdf.parse.warningCodes
      },
      noteAuthoring: noteSeed,
      sectionIndex: pendingReviewStage("sectionIndex", record, noteSeed),
      sourceReading: pendingReviewStage("sourceReading", record, noteSeed),
      quoteAudit: pendingReviewStage("quoteAudit", record, noteSeed),
      formulaAudit: pendingReviewStage("formulaAudit", record, noteSeed),
      schemaValidation: pendingReviewStage("schemaValidation", record, noteSeed),
      contentAudit: pendingReviewStage("contentAudit", record, noteSeed),
      sourceAudit: pendingReviewStage("sourceAudit", record, noteSeed),
      releaseBuild: pendingReviewStage("releaseBuild", record, noteSeed, { corpusRevision: manifest.corpusRevision })
    }
  };
  if (!existing) return base;
  const pdfChanged = existing.pdfSha256 !== record.pdf.sha256;
  const recordChanged = existing.manifestRecordDigest !== record.recordDigest;
  const corpusChanged = existing.corpusRevision !== manifest.corpusRevision;
  const existingExtraction = existing.stages?.extraction;
  const validRepairPromotion = validRepairPromotionExtraction(record, existingExtraction);
  const effectiveExtractionDigest = validRepairPromotion ? existingExtraction.inputDigest : extractionDigest;
  const extractionInputChanged = Boolean(existingExtraction && existingExtraction.inputDigest !== extractionDigest && !validRepairPromotion);
  const extractionReason = firstReason(
    pdfChanged && "pdf_sha256_changed",
    extractionInputChanged && "extraction_input_changed"
  );
  base.stages.extraction = preserveCompatibleProgress(base.stages.extraction, existingExtraction, extractionReason);
  base.stages.extractQa = validRepairPromotion
    ? (validRepairPromotionExtractQa(record, existingExtraction, existing.stages?.extractQa)
      ? existing.stages.extractQa
      : makeRepairPromotionExtractQaStage(record, existingExtraction))
    : preserveCompatibleProgress(base.stages.extractQa, existing.stages?.extractQa, extractionReason);
  const extractionReady = base.stages.extraction.status === "complete";

  const existingNote = existing.stages?.noteAuthoring;
  const hadMiniSeed = existingNote?.source === "mini-atlas-schema-v2";
  const hasMiniSeed = Boolean(structuredSeed);
  const miniSourceMappingMissing = hadMiniSeed && !hasMiniSeed;
  // Mini status is conferred only by the current canonical seed. An old ledger
  // cannot keep frozen privileges after its source mapping disappears.
  const isMini = hasMiniSeed;
  const isCurated = existingNote?.authoringMode === "curated" || existingNote?.source === "editor-curated-full-source";
  const replacementNoteSeed = noteRestartSeed(record, noteSeed, effectiveExtractionDigest, conceptRegistrySha256, isMini);
  const registryChangedGlobally = Boolean(existing.pipelineInputs?.conceptRegistrySha256 && conceptRegistrySha256
    && existing.pipelineInputs.conceptRegistrySha256 !== conceptRegistrySha256);
  const miniNoteChanged = Boolean(structuredSeed && existingNote?.noteSha256 && existingNote.noteSha256 !== structuredSeed.noteSha256);
  const miniPagesChanged = Boolean(structuredSeed && existingNote?.pagesSha256 && existingNote.pagesSha256 !== structuredSeed.pagesSha256);
  const miniPagesBindingUpgrade = Boolean(structuredSeed && (!existingNote?.pagesSha256 || !existingNote?.pagesPath));
  const miniSourceBindingChanged = Boolean(structuredSeed && [
    ["source", "mini-atlas-schema-v2"],
    ["sourcePdfSha256", record.pdf.sha256],
    ["miniPaperId", structuredSeed.miniPaperId],
    ["notePath", structuredSeed.notePath],
    ["noteSha256", structuredSeed.noteSha256],
    ["pagesPath", structuredSeed.pagesPath]
  ].some(([field, expected]) => existingNote?.[field] !== expected));
  const miniInputBindingChanged = Boolean(structuredSeed && existingNote?.inputDigest !== replacementNoteSeed.inputDigest);
  const authoringVersionChanged = Boolean(!isMini && !isCurated && existingNote?.status === "complete" && existingNote.authoringVersion !== AUTHORING_VERSION);
  const conceptRegistryChanged = Boolean(!isMini && existingNote?.status === "complete" && conceptRegistrySha256
    && existingNote.conceptRegistrySha256 !== conceptRegistrySha256);
  const noteReason = firstReason(
    pdfChanged && "pdf_sha256_changed",
    recordChanged && "manifest_record_changed",
    miniSourceMappingMissing && "mini_source_mapping_missing",
    !isMini && extractionInputChanged && "extraction_input_changed",
    !isMini && !extractionReady && existingNote?.status === "complete" && "extraction_not_complete",
    miniNoteChanged && "mini_note_changed",
    miniPagesChanged && "mini_pages_changed",
    authoringVersionChanged && "authoring_version_changed",
    conceptRegistryChanged && "concept_registry_changed"
  );
  base.stages.noteAuthoring = preserveCompatibleProgress(replacementNoteSeed, existingNote, noteReason);
  if (isMini && structuredSeed && !noteReason && base.stages.noteAuthoring.status === "complete") {
    base.stages.noteAuthoring = replacementNoteSeed;
  }

  const readingReason = firstReason(
    pdfChanged && "pdf_sha256_changed",
    recordChanged && "manifest_record_changed",
    miniSourceMappingMissing && "mini_source_mapping_missing",
    !isMini && extractionInputChanged && "extraction_input_changed",
    !isMini && !extractionReady && "extraction_not_complete",
    miniNoteChanged && "mini_note_changed",
    miniPagesChanged && "mini_pages_changed",
    miniPagesBindingUpgrade && "mini_pages_binding_added",
    (miniSourceBindingChanged || miniInputBindingChanged) && "mini_source_binding_changed",
    !isMini && authoringVersionChanged && "authoring_version_changed",
    !isMini && (conceptRegistryChanged || registryChangedGlobally) && "concept_registry_changed"
  );
  for (const stageName of ["sectionIndex", "sourceReading"]) {
    const existingStage = existing.stages?.[stageName];
    const pagesMismatch = Boolean(!isMini && stageName === "sourceReading"
      && existingStage?.status === "complete" && existingExtraction?.artifacts?.pages
      && existingStage.pagesArtifact !== existingExtraction.artifacts.pages);
    const seed = pendingReviewStage(stageName, record, noteReason ? replacementNoteSeed : base.stages.noteAuthoring);
    base.stages[stageName] = preserveCompatibleProgress(
      seed,
      existingStage,
      firstReason(readingReason, pagesMismatch && "extraction_pages_changed")
    );
  }

  const noteReady = base.stages.noteAuthoring.status === "complete";
  const readingReady = base.stages.sourceReading.status === "complete" && base.stages.sectionIndex.status === "complete";
  const noteIdentity = noteReason ? replacementNoteSeed : base.stages.noteAuthoring;
  const auditStageNames = ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit"];
  for (const stageName of auditStageNames) {
    const existingStage = existing.stages?.[stageName];
    const completedAuditMismatch = existingStage?.status === "complete" && (
      existingStage.sourcePdfSha256 !== record.pdf.sha256
      || !noteIdentity.noteSha256
      || existingStage.noteSha256 !== noteIdentity.noteSha256
    );
    const auditReason = firstReason(
      noteReason,
      registryChangedGlobally && "concept_registry_changed",
      !extractionReady && "extraction_not_complete",
      !noteReady && "note_authoring_not_complete",
      !readingReady && "source_reading_not_complete",
      completedAuditMismatch && "audit_input_changed"
    );
    const seed = pendingReviewStage(stageName, record, noteIdentity);
    base.stages[stageName] = preserveCompatibleProgress(seed, existingStage, auditReason);
  }

  const auditDependencies = stageDependencySnapshot(base.stages, auditStageNames);
  const sourceSeed = pendingReviewStage("sourceAudit", record, noteIdentity, { dependencies: auditDependencies });
  const auditDependenciesReady = auditStageNames.every((stageName) => base.stages[stageName]?.status === "complete");
  const existingSourceAudit = existing.stages?.sourceAudit;
  const sourceAuditMismatch = existingSourceAudit?.status === "complete" && (
    existingSourceAudit.sourcePdfSha256 !== record.pdf.sha256
    || existingSourceAudit.noteSha256 !== noteIdentity.noteSha256
    || existingSourceAudit.extractionQaStatus !== base.stages.extractQa.status
  );
  const sourceReason = firstReason(
    noteReason,
    !noteReady && "note_authoring_not_complete",
    !readingReady && "source_reading_not_complete",
    !auditDependenciesReady && "audit_dependency_changed",
    sourceAuditMismatch && "source_audit_input_changed"
  );
  base.stages.sourceAudit = preserveCompatibleProgress(sourceSeed, existingSourceAudit, sourceReason);

  const releaseSeed = pendingReviewStage("releaseBuild", record, noteIdentity, {
    corpusRevision: manifest.corpusRevision,
    dependencies: stageDependencySnapshot(base.stages, ["contentAudit", "sourceAudit"])
  });
  const existingRelease = existing.stages?.releaseBuild;
  const releaseMismatch = existingRelease?.status === "complete" && (
    existingRelease.sourcePdfSha256 !== record.pdf.sha256
    || existingRelease.noteSha256 !== noteIdentity.noteSha256
  );
  const releaseReason = firstReason(
    corpusChanged && "corpus_revision_changed",
    sourceReason,
    base.stages.sourceAudit.status !== "complete" && "source_audit_not_complete",
    base.stages.contentAudit.status !== "complete" && "content_audit_not_complete",
    releaseMismatch && "release_input_changed"
  );
  base.stages.releaseBuild = preserveCompatibleProgress(releaseSeed, existingRelease, releaseReason);
  return base;
}

function countBy(items, keyOf) {
  const result = {};
  for (const item of items) {
    const key = String(keyOf(item));
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => compareOrdinal(a, b)));
}

function compareOrdinal(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function summarizeLedgers(manifest, ledgers, diagnostics = {}) {
  const manifestIds = new Set(manifest.records.map((record) => record.id));
  const ledgersById = new Map(ledgers.map((ledger) => [ledger.paperId, ledger]));
  const missingLedgers = diagnostics.missingLedgers
    || manifest.records.filter((record) => !ledgersById.has(record.id)).map((record) => record.id);
  const extraLedgers = diagnostics.extraLedgers
    || ledgers.filter((ledger) => !manifestIds.has(ledger.paperId)).map((ledger) => ledger.paperId).sort();
  const staleLedgers = diagnostics.staleLedgers
    || manifest.records.filter((record) => {
      const ledger = ledgersById.get(record.id);
      return ledger && (ledger.manifestRecordDigest !== record.recordDigest || ledger.corpusRevision !== manifest.corpusRevision);
    }).map((record) => record.id);
  const stages = {};
  const stageNames = new Set([
    ...CANONICAL_STAGE_NAMES,
    ...ledgers.flatMap((ledger) => Object.keys(ledger.stages || {}))
  ]);
  for (const stageName of [...stageNames].sort()) {
    stages[stageName] = countBy(manifest.records, (record) => ledgersById.get(record.id)?.stages?.[stageName]?.status || "missing");
  }
  const structurallyConsistent = !missingLedgers.length && !extraLedgers.length && !staleLedgers.length;
  const releaseReady = structurallyConsistent && manifest.records.every((record) => {
    const ledger = ledgersById.get(record.id);
    return ledger && CANONICAL_STAGE_NAMES.every((stageName) => RELEASE_READY_STATUSES[stageName].has(ledger.stages?.[stageName]?.status));
  });
  return {
    schemaVersion: 1,
    corpusRevision: manifest.corpusRevision,
    recordCount: manifest.records.length,
    detailLevels: manifest.counts.detailLevels,
    parserWarningPdfs: manifest.counts.parserWarningPdfs,
    stages,
    structurallyConsistent,
    releaseReady,
    ok: structurallyConsistent,
    diagnostics: {
      missingLedgers,
      extraLedgers,
      staleLedgers
    }
  };
}

async function loadLedgerSet(root, manifest) {
  const papersDir = path.join(root, "research", "ledger", "papers");
  const manifestIds = new Set(manifest.records.map((record) => record.id));
  const missingLedgers = [];
  const staleLedgers = [];
  const ledgers = [];
  for (const record of manifest.records) {
    const ledgerPath = path.join(papersDir, `${record.id}.json`);
    const ledger = await readJsonIfPresent(ledgerPath);
    if (!ledger) {
      missingLedgers.push(record.id);
      continue;
    }
    if (ledger.manifestRecordDigest !== record.recordDigest || ledger.corpusRevision !== manifest.corpusRevision) {
      staleLedgers.push(record.id);
    }
    ledgers.push(ledger);
  }
  const extraLedgers = (await readdir(papersDir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -5))
    .filter((id) => !manifestIds.has(id))
    .sort();
  return { ledgers, missingLedgers, extraLedgers, staleLedgers };
}

export async function inventory(options) {
  const root = options.root;
  const dataPath = path.join(root, "data", "atlas_articles.json");
  const paperDir = path.join(root, "paper");
  const dataBytes = await readFile(dataPath);
  const dataSha256 = sha256(dataBytes);
  const payload = JSON.parse(dataBytes.toString("utf8"));
  if (!Array.isArray(payload.records)) throw new Error("atlas_articles.json has no records array");
  const sourceRecords = [...payload.records].sort((a, b) => compareOrdinal(String(a.id), String(b.id)));
  assertUniqueSourceIdentity(sourceRecords);
  const fileEntries = (await readdir(paperDir, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name));
  const filesByNormalizedName = new Map();
  for (const entry of fileEntries) {
    const key = normalizeFilename(entry.name);
    if (filesByNormalizedName.has(key)) throw new Error(`Duplicate normalized paper filename on disk: ${entry.name}`);
    filesByNormalizedName.set(key, entry.name);
  }
  const sourceFilenameSet = new Set(sourceRecords.map((record) => normalizeFilename(record.pdf_file)));
  const orphanPdfs = fileEntries.map((entry) => entry.name).filter((name) => !sourceFilenameSet.has(normalizeFilename(name))).sort();
  const fileChecks = await mapLimit(sourceRecords, options.jobs, async (record) => {
    const actualName = filesByNormalizedName.get(normalizeFilename(record.pdf_file));
    if (!actualName) return { missing: true, actualName: "", sha256: "", bytes: 0, header: "" };
    const observed = await hashFile(path.join(paperDir, actualName));
    return { ...observed, missing: false, actualName };
  });
  const parseCandidates = sourceRecords.filter((record, index) => !fileChecks[index].missing && fileChecks[index].header === "%PDF-");
  const inspection = await inspectPdfs(paperDir, parseCandidates, options);
  const inspectionById = new Map(inspection.records.map((record) => [record.id, record]));
  const imports = await loadImportMappings(root);
  const structured = await loadStructuredNoteSeeds(root, sourceRecords, dataSha256);
  const conceptPayload = await readJsonIfPresent(path.join(root, "data", "notes", "concepts.json"));
  const conceptRegistrySha256 = String(conceptPayload?.conceptRegistrySha256 || "");
  const legacyNotesPath = path.join(root, "atlas_game_theory_preliminary_analysis.md");
  const legacyNotesSha256 = await exists(legacyNotesPath) ? sha256(await readFile(legacyNotesPath)) : "";
  const manifestRecords = sourceRecords.map((source, index) => {
    const observed = fileChecks[index];
    const parsed = inspectionById.get(source.id) || { pageCount: null, encrypted: null, error: observed.missing ? "missing PDF" : "invalid PDF header", warningCount: 0, warningCodes: [], warningSamples: [] };
    const doi = normalizeDoi(source.doi);
    const mapping = imports.mappings.get(doi);
    const integrityIssues = [];
    if (observed.missing) integrityIssues.push("missing_pdf");
    if (!observed.missing && observed.actualName !== source.pdf_file) integrityIssues.push("filename_case_or_normalization_mismatch");
    if (!observed.missing && observed.header !== "%PDF-") integrityIssues.push("invalid_pdf_header");
    if (!observed.missing && observed.bytes !== Number(source.pdf_bytes)) integrityIssues.push("pdf_byte_mismatch");
    if (!observed.missing && observed.sha256 !== String(source.pdf_sha256).toLowerCase()) integrityIssues.push("pdf_sha256_mismatch");
    if (parsed.error) integrityIssues.push("pdf_parse_failure");
    if (source.pdf_page_count != null && parsed.pageCount != null && Number(source.pdf_page_count) !== parsed.pageCount) integrityIssues.push("pdf_page_count_mismatch");
    if (mapping && String(mapping.target_pdf) !== String(source.pdf_file)) integrityIssues.push("import_target_filename_mismatch");
    if (mapping && String(mapping.sha256).toLowerCase() !== String(source.pdf_sha256).toLowerCase()) integrityIssues.push("import_sha256_mismatch");
    const sourceRecordDigest = sha256(stableStringify(source));
    const routeAlias = doiRouteId(doi);
    const base = {
      id: String(source.id),
      canonicalDoi: doi,
      doiUrl: `https://doi.org/${doi}`,
      aliases: routeAlias === source.id ? [] : [routeAlias],
      title: String(source.title),
      authors: Array.isArray(source.authors) ? source.authors.map(String) : [],
      year: Number(source.year),
      journal: String(source.journal),
      journalCode: String(source.journal_code),
      bibkey: String(source.bibkey),
      sourceDetailLevel: String(source.detail_level || "model_map"),
      sourceReviewStatus: String(source.review_status || ""),
      sourceRecordDigest,
      pdf: {
        path: `paper/${String(source.pdf_file)}`,
        file: String(source.pdf_file),
        bytes: observed.missing ? Number(source.pdf_bytes) : observed.bytes,
        sha256: observed.missing ? String(source.pdf_sha256).toLowerCase() : observed.sha256,
        pageCount: parsed.pageCount,
        parse: {
          status: parsed.error ? "error" : parsed.warningCount ? "ok_with_warnings" : "ok",
          encrypted: parsed.encrypted,
          warningCount: parsed.warningCount || 0,
          warningCodes: parsed.warningCodes || [],
          warningSamples: parsed.warningSamples || [],
          ...(parsed.error ? { error: parsed.error } : {})
        }
      },
      provenance: mapping ? {
        disposition: String(mapping.disposition),
        sourcePdfFile: String(mapping.source_pdf),
        targetPdfFile: String(mapping.target_pdf)
      } : {
        disposition: "preexisting-outside-import",
        sourcePdfFile: String(source.pdf_file),
        targetPdfFile: String(source.pdf_file)
      },
      inclusion: { status: "included", basis: String(source.detail_level || "model_map") },
      integrityIssues
    };
    return { ...base, recordDigest: sha256(stableStringify(base)) };
  });
  const duplicateHashes = duplicateGroups(manifestRecords.filter((record) => record.pdf.sha256), (record) => record.pdf.sha256);
  for (const [, duplicates] of duplicateHashes) {
    for (const duplicate of duplicates) {
      if (!duplicate.integrityIssues.includes("duplicate_pdf_sha256")) duplicate.integrityIssues.push("duplicate_pdf_sha256");
      const { recordDigest: ignored, ...base } = duplicate;
      duplicate.recordDigest = sha256(stableStringify(base));
    }
  }
  const corpusRevisionMaterial = manifestRecords
    .map((record) => [record.id, record.canonicalDoi, record.pdf.path.normalize("NFC"), record.pdf.bytes, record.pdf.sha256].join("\0"))
    .join("\n") + "\n";
  const corpusRevision = sha256(corpusRevisionMaterial);
  const manifest = {
    schemaVersion: 1,
    source: {
      schemaVersion: String(payload.schema_version || ""),
      dataPath: "data/atlas_articles.json",
      dataSha256,
      generatedOn: String(payload.generated_on || ""),
      importAuditPath: imports.path,
      importAuditSha256: imports.sha256,
      miniSamplePath: structured.samplePath,
      miniSampleSha256: structured.sampleSha256,
      miniSamplePopulationValidation: structured.populationValidation || null
    },
    identity: {
      canonicalKey: "normalized DOI",
      routeIdPolicy: "Preserve the existing record ID; expose the DOI-derived ID as an alias when different.",
      corpusRevisionAlgorithm: "SHA-256 of ordinal ID-sorted UTF-8 lines: id NUL normalized-doi NUL NFC-relative-pdf-path NUL bytes NUL pdf-sha256."
    },
    relevanceVocabulary: {
      applicability: ["modeled", "unclassified", "explicitlyExcluded", "backgroundOnly", "unknown"],
      evidenceLocation: [
        "concept",
        "scenario",
        "formulation",
        "condition",
        "symbol",
        "component explanation",
        "model setup",
        "decision-state",
        "method-result",
        "bibliography-abstract"
      ],
      maturity: ["component-mapped", "legacy deep map", "evidence-index"],
      policy: "Applicability and evidence location are scoped, query-derived evidence. Maturity is a legacy source-provenance axis, not a current note-availability or quality score."
    },
    corpusRevision,
    parser: {
      name: inspection.parser,
      version: inspection.version,
      inspectionCodeSha256: INSPECTOR_CODE_SHA256,
      extractionCodeSha256: EXTRACTOR_CODE_SHA256,
      extractionPolicy: EXTRACTION_POLICY
    },
    counts: {
      records: manifestRecords.length,
      pdfFiles: fileEntries.length,
      bytes: manifestRecords.reduce((sum, record) => sum + record.pdf.bytes, 0),
      pages: manifestRecords.reduce((sum, record) => sum + Number(record.pdf.pageCount || 0), 0),
      detailLevels: countBy(manifestRecords, (record) => record.sourceDetailLevel),
      journals: countBy(manifestRecords, (record) => record.journalCode),
      parserWarningPdfs: manifestRecords.filter((record) => record.pdf.parse.warningCount > 0).length,
      parseFailures: manifestRecords.filter((record) => record.pdf.parse.status === "error").length,
      legacyRouteIds: manifestRecords.filter((record) => record.aliases.length).length,
      structuredNoteSeeds: [...structured.records.keys()].filter((id) => manifestRecords.some((record) => record.id === id)).length,
      orphanPdfs: orphanPdfs.length,
      duplicatePdfHashes: duplicateHashes.length
    },
    orphanPdfs,
    records: manifestRecords
  };
  manifest.recordsDigest = sha256(stableStringify(manifestRecords));
  const manifestPath = path.join(root, "research", "corpus", "manifest.v1.json");
  if (options.check) {
    const checkedManifest = await readJsonIfPresent(manifestPath);
    const manifestMatches = Boolean(checkedManifest)
      && stableStringify(checkedManifest) === stableStringify(manifest);
    const ledgerSet = checkedManifest
      ? await loadLedgerSet(root, checkedManifest)
      : {
          ledgers: [],
          missingLedgers: manifest.records.map((record) => record.id),
          extraLedgers: [],
          staleLedgers: []
        };
    const summary = summarizeLedgers(checkedManifest || manifest, ledgerSet.ledgers, ledgerSet);
    const manifestIssues = !checkedManifest ? ["missing"] : manifestMatches ? [] : ["content_mismatch"];
    const structurallyConsistent = manifestMatches && summary.structurallyConsistent;
    return {
      ...summary,
      checked: true,
      manifestMatches,
      expectedCorpusRevision: manifest.corpusRevision,
      structurallyConsistent,
      releaseReady: structurallyConsistent && summary.releaseReady,
      diagnostics: { ...summary.diagnostics, manifestIssues },
      ok: structurallyConsistent
    };
  }
  await atomicWriteJson(manifestPath, manifest);
  const papersDir = path.join(root, "research", "ledger", "papers");
  await mkdir(papersDir, { recursive: true });
  const ledgers = [];
  for (const record of manifest.records) {
    const ledgerPath = path.join(papersDir, `${record.id}.json`);
    const existing = await readJsonIfPresent(ledgerPath);
    const seed = structured.records.get(record.id);
    if (seed && seed.samplePdfSha256 !== record.pdf.sha256) {
      // Keep the mismatch explicit in the stage instead of silently accepting stale Mini work.
    }
    const ledger = makeLedger(record, manifest, seed, legacyNotesSha256, existing, conceptRegistrySha256);
    await atomicWriteJson(ledgerPath, ledger);
    ledgers.push(ledger);
  }
  const ledgerSet = await loadLedgerSet(root, manifest);
  const summary = summarizeLedgers(manifest, ledgers, ledgerSet);
  await atomicWriteJson(path.join(root, "research", "ledger", "summary.json"), summary);
  return { manifest, summary };
}

export async function status(options) {
  const manifestPath = path.join(options.root, "research", "corpus", "manifest.v1.json");
  const manifest = await readJsonIfPresent(manifestPath);
  if (!manifest) throw new Error("Corpus manifest is missing. Run corpus-pipeline.mjs inventory first.");
  const ledgerSet = await loadLedgerSet(options.root, manifest);
  const summary = summarizeLedgers(manifest, ledgerSet.ledgers, ledgerSet);
  let qaReadiness = null;
  if (options.checkReady) {
    // Dynamic import avoids a static cycle: extraction-qa reuses the canonical
    // extraction policy and hashing helpers exported by this module.
    const {
      extractionQaBindingsMatch,
      extractionQaCheckpointBinding,
      verifyExtractionQaCheckpoint
    } = await import("./extraction-qa.mjs");
    const qaBoundStages = [
      "sectionIndex", "sourceReading", "noteAuthoring", "quoteAudit", "formulaAudit",
      "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"
    ];
    const ledgerById = new Map(ledgerSet.ledgers.map((ledger) => [ledger.paperId, ledger]));
    const results = await mapLimit(manifest.records, Math.max(1, Number(options.jobs) || 4), async (record) => {
      const ledger = ledgerById.get(record.id);
      if (!ledger) return { id: record.id, ok: false, state: "missing", status: "missing", reason: "paper_ledger_missing" };
      try {
        const checkpoint = await verifyExtractionQaCheckpoint(options.root, manifest, record, ledger);
        const downstreamBindingIssues = checkpoint.ok
          ? qaBoundStages.filter((stageName) => !extractionQaBindingsMatch(
              ledger.stages?.[stageName],
              extractionQaCheckpointBinding(checkpoint)
            )).map((stageName) => `${stageName}_qa_binding_mismatch`)
          : [];
        return {
          id: record.id,
          ok: checkpoint.ok && !downstreamBindingIssues.length,
          state: checkpoint.state,
          status: checkpoint.effectiveStatus || checkpoint.decision?.status || "missing",
          automatedStatus: checkpoint.decision?.status || "missing",
          reason: checkpoint.reason || (downstreamBindingIssues.length ? "downstream_qa_binding_mismatch" : ""),
          ...(downstreamBindingIssues.length ? { downstreamBindingIssues } : {})
        };
      } catch (error) {
        return {
          id: record.id,
          ok: false,
          state: "stale",
          status: "failed",
          reason: `extraction_qa_verification_error:${error?.message || String(error)}`
        };
      }
    });
    qaReadiness = {
      checked: results.length,
      ok: results.every((result) => result.ok),
      states: countBy(results, (result) => result.state),
      statuses: countBy(results, (result) => result.status),
      failures: results.filter((result) => !result.ok)
    };
    summary.releaseReady = summary.releaseReady && qaReadiness.ok;
  }
  if (options.refreshSummary) {
    await atomicWriteJson(path.join(options.root, "research", "ledger", "summary.json"), summary);
  }
  return {
    ...summary,
    ...(qaReadiness ? { qaReadiness } : {}),
    summaryRefreshed: Boolean(options.refreshSummary)
  };
}

function buildSelectorIndex(manifest) {
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

function resolvePaperSelector(selectorIndex, selector, label = "paper") {
  const normalized = selector.startsWith("10.") || /^https?:\/\/(?:dx\.)?doi\.org\//i.test(selector)
    ? normalizeDoi(selector)
    : selector;
  const id = selectorIndex.get(normalized);
  if (!id) throw new Error(`Unknown ${label} selector: ${selector}`);
  return id;
}

export function selectExtractionCandidates(manifest, ledgers, options = {}) {
  const ledgerById = new Map(ledgers.map((ledger) => [ledger.paperId, ledger]));
  const selectorIndex = buildSelectorIndex(manifest);
  let requestedIds = null;
  if (options.papers?.length) {
    requestedIds = new Set();
    for (const selector of options.papers) {
      requestedIds.add(resolvePaperSelector(selectorIndex, selector));
    }
  }
  const fromId = options.from ? resolvePaperSelector(selectorIndex, options.from, "--from") : "";
  const fromIndex = fromId ? manifest.records.findIndex((record) => record.id === fromId) : 0;
  let selected = manifest.records.slice(fromIndex)
    .filter((record) => !requestedIds || requestedIds.has(record.id))
    .map((record) => ({ record, ledger: ledgerById.get(record.id) }))
    .filter(({ ledger }) => ledger && ledger.stages?.inventory?.status === "complete")
    .filter(({ ledger }) => options.retryFailed
      ? ledger.stages?.extraction?.status === "failed"
      : options.force || ELIGIBLE_EXTRACTION_STATUSES.has(ledger.stages?.extraction?.status))
    .sort((a, b) => compareOrdinal(a.record.id, b.record.id));
  if (options.limit) selected = selected.slice(0, options.limit);
  return selected;
}

export async function acquireClaim(root, paperId, baseLedgerSha256, ttlMinutes) {
  const claimsDir = path.join(root, "research", "ledger", ".claims");
  await mkdir(claimsDir, { recursive: true });
  const claimPath = path.join(claimsDir, `${paperId}.extract.json`);
  const now = Date.now();
  const value = {
    schemaVersion: 1,
    paperId,
    stage: "extraction",
    runId: randomUUID(),
    baseLedgerSha256,
    claimedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMinutes * 60_000).toISOString()
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(claimPath, "wx");
      await handle.writeFile(`${stableStringify(value, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      return { path: claimPath, value };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existing = null;
      try {
        existing = await readJsonIfPresent(claimPath);
      } catch (readError) {
        // A worker can die after creating the claim but before completing its
        // JSON write. Recover it by age, never by immediately stealing a fresh
        // partial claim.
        if (!(readError instanceof SyntaxError)) throw readError;
      }
      const claimStat = await stat(claimPath).catch((statError) => {
        if (statError.code === "ENOENT") return null;
        throw statError;
      });
      if (!claimStat) continue;
      const declaredExpiry = Date.parse(existing?.expiresAt || "");
      const effectiveExpiry = Number.isFinite(declaredExpiry)
        ? declaredExpiry
        : claimStat.mtimeMs + ttlMinutes * 60_000;
      if (effectiveExpiry >= now) return null;
      await unlink(claimPath).catch(() => {});
    }
  }
  return null;
}

async function extractOne(root, manifest, selected, options, runId) {
  const ledgerPath = path.join(root, "research", "ledger", "papers", `${selected.record.id}.json`);
  const baseText = await readFile(ledgerPath, "utf8");
  const baseLedgerSha256 = sha256(baseText);
  const claim = await acquireClaim(root, selected.record.id, baseLedgerSha256, options.claimTtlMinutes);
  if (!claim) return { id: selected.record.id, status: "claimed_elsewhere" };
  let attempt;
  try {
    const pdfPath = path.join(root, selected.record.pdf.path);
    const sourceBefore = await hashFile(pdfPath);
    if (sourceBefore.sha256 !== selected.record.pdf.sha256
      || sourceBefore.bytes !== selected.record.pdf.bytes
      || sourceBefore.header !== "%PDF-") {
      throw new Error("Source PDF differs from the inventoried manifest; rerun inventory before extraction");
    }
    const extractionPayload = JSON.stringify({ path: pdfPath });
    const { stdout } = await runPython(PYTHON_EXTRACT_SOURCE, extractionPayload, options);
    const extracted = JSON.parse(stdout);
    if (extracted.parser !== manifest.parser.name || extracted.version !== manifest.parser.version) {
      throw new Error(`Extractor changed from ${manifest.parser.name} ${manifest.parser.version} to ${extracted.parser} ${extracted.version}; rerun inventory`);
    }
    const primaryCorruptionProfile = extractionCorruptionProfile(extracted.pages);
    const fallbackAttempted = systematicFontMapCorruption(extracted.pages);
    let fallbackUsed = false;
    let fallbackCorruptionProfile = null;
    let selectedEngine = extracted.primaryParser || "pypdf";
    let selectedEngineVersion = extracted.primaryVersion || manifest.parser.version;
    let selectedPages = extracted.pages;
    let selectedPageErrors = extracted.pageErrors || [];
    let selectedCorruptionProfile = primaryCorruptionProfile;
    if (fallbackAttempted) {
      const fallbackRun = await runPython(PYTHON_PYMUPDF_EXTRACT_SOURCE, extractionPayload, options);
      const fallback = JSON.parse(fallbackRun.stdout);
      if (fallback.parser !== extracted.fallbackParser || fallback.version !== extracted.fallbackVersion) {
        throw new Error(`Fallback extractor changed from ${extracted.fallbackParser} ${extracted.fallbackVersion} to ${fallback.parser} ${fallback.version}; rerun inventory`);
      }
      if (!Array.isArray(fallback.pages) || fallback.pages.length !== extracted.pages.length) {
        throw new Error(`Fallback extractor returned ${fallback.pages?.length ?? 0} pages; expected ${extracted.pages.length}`);
      }
      fallbackCorruptionProfile = extractionCorruptionProfile(fallback.pages);
      const selectFallback = preferFallbackExtraction(primaryCorruptionProfile, fallbackCorruptionProfile);
      if (!selectFallback && hardCorruptionSeverity(primaryCorruptionProfile) > 0) {
        throw new Error("Neither PDF parser produced a cleaner hard-corruption profile");
      }
      if (!selectFallback) {
        // The primary trigger was layout-only and the alternate parser made it
        // no cleaner. Retain the higher-fidelity primary text and carry both
        // profiles into provenance for review.
      } else {
      const primaryStats = extractedTextStats(extracted.pages);
      const fallbackStats = extractedTextStats(fallback.pages);
      const acceptance = EXTRACTION_POLICY.fallbackAcceptance;
      if (
        fallbackStats.totalCharacters < acceptance.minimumTotalCharacters
        || fallbackStats.charactersPerPage < acceptance.minimumCharactersPerPage
        || fallbackStats.nonemptyPages < Math.ceil(fallback.pages.length * acceptance.minimumNonemptyPageFraction)
      ) {
        throw new Error(`Fallback extractor text yield is inadequate (${fallbackStats.totalCharacters} characters across ${fallbackStats.nonemptyPages}/${fallback.pages.length} readable pages)`);
      }
      if (
        primaryStats.totalCharacters >= acceptance.primaryComparisonStartsAtCharacters
        && fallbackStats.totalCharacters < primaryStats.totalCharacters * acceptance.minimumPrimaryCharacterFraction
      ) {
        throw new Error(`Fallback extractor retained less than ${acceptance.minimumPrimaryCharacterFraction * 100}% of primary text (${fallbackStats.totalCharacters}/${primaryStats.totalCharacters} characters)`);
      }
      selectedEngine = fallback.parser;
      selectedEngineVersion = fallback.version;
      selectedPages = fallback.pages;
      selectedPageErrors = fallback.pageErrors || [];
      selectedCorruptionProfile = fallbackCorruptionProfile;
      fallbackUsed = true;
      }
    }
    const inputDigest = extractionInputDigest(selected.record, manifest.parser.version);
    const artifactDir = path.join(root, "research", "ledger", "artifacts", selected.record.id, inputDigest);
    const pagesPayload = {
      schemaVersion: 1,
      paperId: selected.record.id,
      canonicalDoi: selected.record.canonicalDoi,
      pdfSha256: selected.record.pdf.sha256,
      extractor: {
        name: extracted.parser,
        version: extracted.version,
        codeSha256: EXTRACTOR_CODE_SHA256,
        selectedEngine,
        selectedEngineVersion,
        fallbackAttempted,
        fallbackUsed,
        fallbackReason: fallbackUsed ? "systematic-text-corruption" : fallbackAttempted ? "alternate-parser-not-cleaner" : "",
        primaryCorruptionProfile,
        fallbackCorruptionProfile,
        selectedCorruptionProfile,
        extractionPolicy: EXTRACTION_POLICY
      },
      pages: selectedPages
    };
    const pagesText = `${stableStringify(pagesPayload, 2)}\n`;
    const plainText = selectedPages.map((page) => `===== PDF PAGE ${page.page} =====\n${page.text}`).join("\n\n") + "\n";
    const pagesPath = path.join(artifactDir, "pages.json");
    const textPath = path.join(artifactDir, "text.txt");
    const sourceAfter = await hashFile(pdfPath);
    if (sourceAfter.sha256 !== selected.record.pdf.sha256
      || sourceAfter.bytes !== selected.record.pdf.bytes
      || sourceAfter.header !== "%PDF-") {
      throw new Error("Source PDF changed while extraction was running; output was not committed");
    }
    await atomicWriteText(pagesPath, pagesText);
    await atomicWriteText(textPath, plainText);
    const emptyPages = selectedPages.filter((page) => !String(page.text).trim()).map((page) => page.page);
    const totalCharacters = selectedPages.reduce((sum, page) => sum + String(page.text).length, 0);
    const qaReasons = [];
    if (extracted.warningCount) qaReasons.push("parser_warning");
    if (selectedPageErrors.length) qaReasons.push("page_extraction_error");
    if (fallbackUsed) qaReasons.push("alternate_parser_fallback");
    if (emptyPages.length) qaReasons.push("empty_extracted_page");
    if (totalCharacters < 1000 || totalCharacters / Math.max(1, extracted.pages.length) < 200) qaReasons.push("low_text_yield");
    const currentText = await readFile(ledgerPath, "utf8");
    if (sha256(currentText) !== baseLedgerSha256) throw new Error("Ledger changed while extraction was running; output was retained but not committed");
    const ledger = JSON.parse(currentText);
    ledger.stages.extraction = {
      status: "complete",
      inputDigest,
      sourcePdfSha256: selected.record.pdf.sha256,
      attempts: Number(ledger.stages?.extraction?.attempts || 0) + 1,
      completedAt: new Date().toISOString(),
      pageCount: selectedPages.length,
      totalCharacters,
      emptyPages,
      pageErrors: selectedPageErrors,
      parserWarningCount: extracted.warningCount,
      parserWarningCodes: extracted.warningCodes,
      selectedEngine,
      selectedEngineVersion,
      fallbackAttempted,
      fallbackUsed,
      fallbackReason: fallbackUsed ? "systematic-text-corruption" : fallbackAttempted ? "alternate-parser-not-cleaner" : "",
      primaryCorruptionProfile,
      fallbackCorruptionProfile,
      selectedCorruptionProfile,
      artifacts: {
        pages: path.relative(root, pagesPath).replaceAll(path.sep, "/"),
        pagesSha256: sha256(pagesText),
        text: path.relative(root, textPath).replaceAll(path.sep, "/"),
        textSha256: sha256(plainText)
      }
    };
    ledger.stages.extractQa = {
      status: qaReasons.length ? "needs_review" : "complete",
      inputDigest,
      sourcePdfSha256: selected.record.pdf.sha256,
      reasons: qaReasons,
      warningCodes: extracted.warningCodes,
      pageErrors: selectedPageErrors,
      emptyPages,
      totalCharacters,
      selectedEngine,
      selectedEngineVersion,
      fallbackAttempted,
      fallbackUsed,
      fallbackReason: fallbackUsed ? "systematic-text-corruption" : fallbackAttempted ? "alternate-parser-not-cleaner" : "",
      primaryCorruptionProfile,
      fallbackCorruptionProfile,
      selectedCorruptionProfile
    };
    await atomicWriteJson(ledgerPath, ledger);
    attempt = {
      schemaVersion: 1,
      runId,
      paperId: selected.record.id,
      stage: "extraction",
      result: "complete",
      inputDigest,
      completedAt: new Date().toISOString(),
      pagesSha256: ledger.stages.extraction.artifacts.pagesSha256,
      textSha256: ledger.stages.extraction.artifacts.textSha256,
      qaStatus: ledger.stages.extractQa.status,
      selectedEngine,
      fallbackUsed
    };
    return { id: selected.record.id, status: "complete", qaStatus: ledger.stages.extractQa.status };
  } catch (error) {
    const currentText = await readFile(ledgerPath, "utf8").catch(() => "");
    if (currentText && sha256(currentText) === baseLedgerSha256) {
      const ledger = JSON.parse(currentText);
      ledger.stages.extraction = {
        ...ledger.stages.extraction,
        status: "failed",
        attempts: Number(ledger.stages?.extraction?.attempts || 0) + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: { name: error.name, message: error.message }
      };
      await atomicWriteJson(ledgerPath, ledger);
    }
    attempt = {
      schemaVersion: 1,
      runId,
      paperId: selected.record.id,
      stage: "extraction",
      result: "failed",
      completedAt: new Date().toISOString(),
      error: { name: error.name, message: error.message }
    };
    return { id: selected.record.id, status: "failed", error: error.message };
  } finally {
    if (attempt) {
      const attemptPath = path.join(root, "research", "ledger", "attempts", runId, `${selected.record.id}.extract.json`);
      await atomicWriteJson(attemptPath, attempt).catch(() => {});
    }
    await unlink(claim.path).catch(() => {});
  }
}

export async function extract(options) {
  const manifest = await readJson(path.join(options.root, "research", "corpus", "manifest.v1.json"));
  assertExtractionContract(manifest);
  const ledgerSet = await loadLedgerSet(options.root, manifest);
  if (ledgerSet.missingLedgers.length || ledgerSet.staleLedgers.length) {
    throw new Error("Ledger is incomplete or stale. Run inventory before extraction.");
  }
  const selected = selectExtractionCandidates(manifest, ledgerSet.ledgers, options);
  assertExtractionContract(manifest, selected);
  if (options.dryRun) {
    return {
      dryRun: true,
      eligible: selected.length,
      selected: selected.map(({ record, ledger }) => ({ id: record.id, doi: record.canonicalDoi, status: ledger.stages.extraction.status }))
    };
  }
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const results = await mapLimit(selected, options.jobs, (item) => extractOne(options.root, manifest, item, options, runId));
  const refreshed = await loadLedgerSet(options.root, manifest);
  const summary = summarizeLedgers(manifest, refreshed.ledgers, refreshed);
  await atomicWriteJson(path.join(options.root, "research", "ledger", "summary.json"), summary);
  return { dryRun: false, runId, selected: selected.length, results, summary };
}

function usage() {
  return `Usage:
  node scripts/corpus-pipeline.mjs status [--check-ready] [--refresh-summary] [--json]
  node scripts/corpus-pipeline.mjs inventory [--check] [--jobs N] [--python PATH] [--json]
  node scripts/corpus-pipeline.mjs extract [--paper ID_OR_DOI] [--from ID_OR_DOI] [--limit N] [--jobs N] [--retry-failed] [--dry-run] [--force] [--json]

The positional command may also be supplied as --select status|inventory|extract.
--from resumes at an inclusive point in manifest order; --retry-failed selects only failed extraction ledgers.
--check-ready recomputes every authoritative Extraction QA decision/adjudication and exits nonzero unless it and every canonical source-to-release stage are ready; ordinary status remains informational.
--refresh-summary safely rebuilds research/ledger/summary.json from the authoritative paper ledgers.
Set ATLAS_PYTHON or use --python when Python with pypdf and PyMuPDF is not on PATH.`;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.summary && result.manifest) {
    console.log(`Inventory complete: ${result.manifest.counts.records} records, ${result.manifest.counts.pdfFiles} PDFs, revision ${result.manifest.corpusRevision}.`);
    console.log(`Ledger noteAuthoring: ${JSON.stringify(result.summary.stages.noteAuthoring)}; extractQa: ${JSON.stringify(result.summary.stages.extractQa)}.`);
    return;
  }
  if (result.checked) {
    console.log(`Inventory check ${result.ok ? "passed" : "failed"}: manifest ${result.manifestMatches ? "matches" : "differs"}; expected revision ${result.expectedCorpusRevision}.`);
    return;
  }
  if (result.corpusRevision && result.stages) {
    const structure = result.structurallyConsistent ? "consistent" : "needs repair";
    const readiness = result.releaseReady ? "ready" : "not ready";
    console.log(`Corpus ${result.corpusRevision}: ${result.recordCount} records; ledger structure ${structure}; release ${readiness}.`);
    for (const [stage, counts] of Object.entries(result.stages)) console.log(`  ${stage}: ${JSON.stringify(counts)}`);
    if (result.qaReadiness) console.log(`  authoritative Extraction QA: ${JSON.stringify(result.qaReadiness.statuses)}; failures: ${result.qaReadiness.failures.length}`);
    if (result.summaryRefreshed) console.log("  Refreshed research/ledger/summary.json from paper ledgers.");
    return;
  }
  if (result.dryRun) {
    console.log(`Extraction dry run selected ${result.selected.length} paper(s).`);
    for (const item of result.selected) console.log(`  ${item.id} (${item.status})`);
    return;
  }
  console.log(`Extraction run ${result.runId}: ${result.selected} selected.`);
  console.log(`  ${JSON.stringify(countBy(result.results, (item) => item.status))}`);
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = options.command === "inventory"
    ? await inventory(options)
    : options.command === "extract"
      ? await extract(options)
      : await status(options);
  printResult(result, options.json);
  if (result.ok === false || (options.checkReady && !result.releaseReady) || result.results?.some((item) => item.status === "failed")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
