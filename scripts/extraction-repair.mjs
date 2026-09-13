import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  unlink
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  atomicWriteJson,
  atomicWriteText,
  sha256,
  stableStringify
} from "./corpus-pipeline.mjs";
import { verifyExtractionQaCheckpoint } from "./extraction-qa.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const WORKER_PATH = path.join(path.dirname(SCRIPT_PATH), "extraction-repair-worker.py");
const SPEC_DIR = path.posix.join("research", "extraction-repair-specs");
const CANDIDATE_DIR = path.posix.join("research", "ledger", "extraction-repair-candidates");
const VISUAL_QA_DIR = path.posix.join("research", "ledger", "extraction-repair-visual-qa");
const LOCK_DIR_NAME = ".locks";
const COMMANDS = new Set(["build", "check", "status"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const VISUAL_REGION_TYPES = new Set(["text", "formula", "table", "figure"]);
const VISUAL_CHECKS = new Set([
  "operators", "subscripts", "superscripts", "delimiters", "order",
  "axes", "signs", "geometry"
]);

export const EXTRACTION_REPAIR_VERSION = "extraction-repair-candidate-v2";
export const EXTRACTION_REPAIR_LOCK_VERSION = 1;
export const EXTRACTION_REPAIR_LAYOUT_POLICY = Object.freeze({
  schemaVersion: 2,
  name: "same-engine-resource-cmap-overlay-and-explicit-composite",
  pageCount: "must_equal_production_extraction",
  textOrder: "must_equal_production_extraction_except_authorized_single-scalar_substitutions_and_occurrence-bound_composites",
  characterGeometry: "all flattened renderer-character bboxes must remain unchanged",
  compositeGeometry: "zero-width overlays require exact source occurrences, single-byte Tj operands, and bounded text-matrix deltas",
  sourceMutation: "forbidden",
  productionArtifactMutation: "forbidden",
  ledgerMutation: "forbidden"
});

export const EXTRACTION_REPAIR_CODE_SHA256 = sha256(Buffer.concat([
  await readFile(SCRIPT_PATH),
  Buffer.from("\0", "utf8"),
  await readFile(WORKER_PATH)
]));

export async function currentExtractionRepairCodeSha256() {
  return sha256(Buffer.concat([
    await readFile(SCRIPT_PATH),
    Buffer.from("\0", "utf8"),
    await readFile(WORKER_PATH)
  ]));
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export function parseExtractionRepairCli(argv) {
  const options = {
    command: "build",
    root: SCRIPT_ROOT,
    python: "",
    papers: [],
    from: "",
    limit: null,
    jobs: Math.max(1, Math.min(2, os.cpus().length)),
    check: false,
    json: false,
    help: false
  };
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (COMMANDS.has(argument)) {
      if (command && command !== argument) throw new Error("Only one extraction-repair command may be selected");
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
      case "--python": options.python = takeValue(); break;
      case "--paper":
      case "--id": options.papers.push(...takeValue().split(",").map((value) => value.trim()).filter(Boolean)); break;
      case "--from": options.from = takeValue().trim(); break;
      case "--limit": options.limit = positiveInteger(takeValue(), "--limit"); break;
      case "--jobs": options.jobs = positiveInteger(takeValue(), "--jobs"); break;
      case "--check": options.check = true; break;
      case "--json": options.json = true; break;
      case "--help":
      case "-h": options.help = true; break;
      default: throw new Error(`Unknown argument: ${argument}`);
    }
  }
  options.command = command || options.command;
  if (options.command === "check") options.check = true;
  if (options.command === "status" && options.check) throw new Error("status and --check are mutually exclusive");
  return options;
}

function assertSafeId(value, label = "paper ID") {
  if (!SAFE_ID_PATTERN.test(String(value || ""))) throw new Error(`Unsafe ${label}: ${value}`);
}

function absoluteFromRelative(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`Unsafe relative path: ${relativePath}`);
  const absolute = path.resolve(root, ...String(relativePath).split("/"));
  const containment = path.relative(root, absolute);
  if (containment.startsWith("..") || path.isAbsolute(containment)) throw new Error(`Path leaves project root: ${relativePath}`);
  return absolute;
}

async function hashFile(filePath) {
  const handle = await open(filePath, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, bytes);
      if (!result.bytesRead) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      bytes += result.bytesRead;
    }
    return { sha256: hash.digest("hex"), bytes };
  } finally {
    await handle.close();
  }
}

async function readCanonicalJson(filePath, label) {
  const bytes = await readFile(filePath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  const canonical = Buffer.from(`${stableStringify(value, 2)}\n`, "utf8");
  if (!bytes.equals(canonical)) throw new Error(`${label} is not canonical stable JSON`);
  return { value, bytes, sha256: sha256(bytes) };
}

function selectorIndex(manifest) {
  const result = new Map();
  for (const record of manifest.records) {
    for (const selector of [record.id, record.canonicalDoi, record.doiUrl, ...(record.aliases || [])]) {
      const normalized = String(selector).toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
      if (result.has(normalized) && result.get(normalized) !== record.id) throw new Error(`Ambiguous paper selector: ${selector}`);
      result.set(normalized, record.id);
    }
  }
  return result;
}

function resolveSelector(index, value, label) {
  const normalized = String(value).toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
  const id = index.get(normalized);
  if (!id) throw new Error(`Unknown ${label} selector: ${value}`);
  return id;
}

async function loadRepairSpecs(root) {
  const directory = absoluteFromRelative(root, SPEC_DIR);
  let names;
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
  const result = new Map();
  for (const name of names) {
    const relativePath = path.posix.join(SPEC_DIR, name);
    const loaded = await readCanonicalJson(absoluteFromRelative(root, relativePath), `repair spec ${name}`);
    validateRepairSpec(loaded.value);
    if (result.has(loaded.value.paperId)) throw new Error(`Duplicate extraction repair spec for ${loaded.value.paperId}`);
    result.set(loaded.value.paperId, { ...loaded, relativePath });
  }
  return result;
}

export function validateRepairSpec(spec) {
  if (spec?.schemaVersion !== 1 || spec?.stage !== "extractionRepairSpec") throw new Error("Repair spec schema/stage is invalid");
  assertSafeId(spec.paperId);
  if (!spec.canonicalDoi || typeof spec.canonicalDoi !== "string") throw new Error("Repair spec canonicalDoi is missing");
  for (const field of ["sourcePdfSha256", "basePagesSha256", "extractionQaDecisionSha256"]) {
    if (!SHA256_PATTERN.test(spec.bindings?.[field] || "")) throw new Error(`Repair spec ${field} is invalid`);
  }
  if (spec.strategy?.name !== "font-resource-cmap-overlay" || ![1, 2].includes(spec.strategy?.version)) {
    throw new Error("Only font-resource-cmap-overlay v1 or v2 repair specs are supported");
  }
  const strategyVersion = spec.strategy.version;
  if (strategyVersion === 2) {
    const allowed = new Set(["name", "version", "resources", "glyphMap", "compositeGlyphMap"]);
    const unsupported = Object.keys(spec.strategy).filter((field) => !allowed.has(field));
    if (unsupported.length) throw new Error(`Repair v2 strategy fields are unsupported: ${unsupported.sort().join(", ")}`);
  }
  const resources = strategyVersion === 1 ? [spec.strategy.resource] : spec.strategy.resources;
  if (!Array.isArray(resources) || !resources.length) throw new Error("Repair resources are empty");
  if (strategyVersion === 2 && spec.strategy.resource !== undefined) {
    throw new Error("Repair v2 must use only the ordered resources array");
  }
  const resourceTags = new Set();
  const resourceIdentities = new Set();
    for (const resource of resources) {
      if (strategyVersion === 2) {
      const allowed = new Set(["fontResourceTag", "fontStreamKey", "fontStreamSha256", "encodingEvidence"]);
      const unsupported = Object.keys(resource || {}).filter((field) => !allowed.has(field));
      if (unsupported.length) throw new Error(`Repair v2 resource fields are unsupported: ${unsupported.sort().join(", ")}`);
    }
    if (!/^\/[A-Za-z0-9_.-]+$/.test(resource?.fontResourceTag || "")) throw new Error("Repair fontResourceTag is invalid");
    if (!["/FontFile", "/FontFile2", "/FontFile3"].includes(resource?.fontStreamKey)) throw new Error("Repair fontStreamKey is invalid");
    if (!SHA256_PATTERN.test(resource?.fontStreamSha256 || "")) throw new Error("Repair fontStreamSha256 is invalid");
    if (strategyVersion === 2 && resource.encodingEvidence !== undefined) {
      const evidence = resource.encodingEvidence;
      const allowed = new Set(["kind", "encodingName", "encodingMapSha256", "cffCharsetSha256"]);
      const unsupported = Object.keys(evidence || {}).filter((field) => !allowed.has(field));
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || unsupported.length) {
        throw new Error(`Repair named encoding evidence is invalid${unsupported.length ? `; unsupported fields: ${unsupported.sort().join(", ")}` : ""}`);
      }
      if (evidence.kind !== "named-cff") throw new Error("Repair named encoding evidence kind is unsupported");
      if (!["/MacRomanEncoding", "/StandardEncoding"].includes(evidence.encodingName)) {
        throw new Error("Repair named encoding is unsupported");
      }
      if (resource.fontStreamKey !== "/FontFile3") throw new Error("Repair named CFF evidence requires /FontFile3");
      for (const field of ["encodingMapSha256", "cffCharsetSha256"]) {
        if (!SHA256_PATTERN.test(evidence[field] || "")) throw new Error(`Repair named encoding ${field} is invalid`);
      }
    }
    if (resourceTags.has(resource.fontResourceTag)) {
      throw new Error(`Duplicate or ambiguous repair resource tag: ${resource.fontResourceTag}`);
    }
    resourceTags.add(resource.fontResourceTag);
    const identity = [resource.fontResourceTag, resource.fontStreamKey, resource.fontStreamSha256].join("|");
    if (resourceIdentities.has(identity)) throw new Error(`Duplicate repair resource identity: ${identity}`);
    resourceIdentities.add(identity);
  }
  const resource = resources[0];
  if (!Array.isArray(spec.strategy.glyphMap) || !spec.strategy.glyphMap.length) throw new Error("Repair glyphMap is empty");
  const keys = new Set();
  for (const mapping of spec.strategy.glyphMap) {
    if (strategyVersion === 2) {
      const allowed = new Set([
        "fontResourceTag", "fontStreamKey", "fontStreamSha256", "rawCodeHex",
        "glyphName", "unicode", "unicodeCodePoint", "glyphOutlineSha256"
      ]);
      const unsupported = Object.keys(mapping || {}).filter((field) => !allowed.has(field));
      if (unsupported.length) throw new Error(`Repair v2 mapping fields are unsupported: ${unsupported.sort().join(", ")}`);
    }
    const mappedResource = resources.find((item) => (
      item.fontResourceTag === mapping.fontResourceTag
      && item.fontStreamSha256 === mapping.fontStreamSha256
      && (strategyVersion === 1 || item.fontStreamKey === mapping.fontStreamKey)
    ));
    if (!mappedResource) {
      throw new Error("Every glyph mapping must repeat one exact resource tag, stream key, and font stream SHA binding");
    }
    if (strategyVersion === 2 && mappedResource.encodingEvidence !== undefined) {
      if (!SHA256_PATTERN.test(mapping.glyphOutlineSha256 || "")) {
        throw new Error("Every named-CFF glyph mapping must bind the embedded glyph outline SHA");
      }
    } else if (strategyVersion === 2 && mapping.glyphOutlineSha256 !== undefined) {
      throw new Error("Repair glyph outline evidence requires named-CFF encoding evidence");
    }
    const rawCodeHex = strategyVersion === 1 ? mapping.charCodeHex : mapping.rawCodeHex;
    if (!/^[0-9A-F]{2}$/i.test(rawCodeHex || "")) {
      throw new Error(strategyVersion === 1
        ? "Repair charCodeHex must contain one byte"
        : "Repair rawCodeHex must contain exactly one byte; variable-width codes are unsupported");
    }
    if (!/^\/[A-Za-z0-9_.-]+$/.test(mapping.glyphName || "")) {
      throw new Error("Repair glyphName is invalid; outline-only glyph evidence is unsupported");
    }
    if ([...String(mapping.unicode || "")].length !== 1) throw new Error("Repair unicode must contain one Unicode scalar");
    const expectedPoint = `U+${mapping.unicode.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
    if (mapping.unicodeCodePoint !== expectedPoint) throw new Error(`Repair unicodeCodePoint must be ${expectedPoint}`);
    const key = (strategyVersion === 1 ? [
      mapping.fontResourceTag,
      mapping.fontStreamSha256,
      rawCodeHex.toUpperCase(),
      mapping.glyphName
    ] : [
      mapping.fontResourceTag,
      mappedResource.fontStreamKey,
      mapping.fontStreamSha256,
      rawCodeHex.toUpperCase(),
      mapping.glyphName
    ]).join("|");
    if (keys.has(key)) throw new Error(`Duplicate repair glyph mapping: ${key}`);
    keys.add(key);
  }
  if (strategyVersion === 2 && (spec.strategy.compositeGlyphMap || []).length) {
    throw new Error("Repair v2 occurrence transcription/composite mappings are unsupported");
  }
  if (strategyVersion === 2 && [
    spec.strategy.visualRequirements,
    spec.strategy.figureGeometry,
    spec.strategy.occurrenceTranscriptions,
    spec.visualEvidence?.visualRequirements
  ].some((value) => value !== undefined && stableStringify(value) !== "[]")) {
    throw new Error("Repair v2 independent visual requirements, figure geometry, and occurrence transcription are unsupported");
  }
  const compositeIds = new Set();
  const compositeOccurrences = new Set();
  for (const composite of spec.strategy.compositeGlyphMap || []) {
    if (composite?.name !== "zero-width-overlay-prefix" || composite?.version !== 1) {
      throw new Error("Only zero-width-overlay-prefix v1 composite glyph mappings are supported");
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(composite.id || "") || compositeIds.has(composite.id)) {
      throw new Error(`Repair composite glyph mapping id is invalid or duplicated: ${composite?.id}`);
    }
    compositeIds.add(composite.id);
    for (const role of ["overlay", "anchor"]) {
      const component = composite[role];
      if (component?.fontResourceTag !== resource.fontResourceTag
        || component?.fontStreamSha256 !== resource.fontStreamSha256) {
        throw new Error(`Repair composite ${role} must repeat the exact resource tag and font stream SHA binding`);
      }
      if (!/^[0-9A-F]{2}$/i.test(component?.charCodeHex || "")
        || !/^\/[A-Za-z0-9_.-]+$/.test(component?.glyphName || "")) {
        throw new Error(`Repair composite ${role} glyph identity is invalid`);
      }
    }
    const overlayKey = [
      composite.overlay.fontResourceTag,
      composite.overlay.fontStreamSha256,
      composite.overlay.charCodeHex.toUpperCase(),
      composite.overlay.glyphName
    ].join("|");
    const anchorKey = [
      composite.anchor.fontResourceTag,
      composite.anchor.fontStreamSha256,
      composite.anchor.charCodeHex.toUpperCase(),
      composite.anchor.glyphName
    ].join("|");
    if (keys.has(overlayKey)) throw new Error("Repair composite overlay must not also be a simple glyph mapping");
    const anchorMapping = spec.strategy.glyphMap.find((mapping) => [
      mapping.fontResourceTag,
      mapping.fontStreamSha256,
      mapping.charCodeHex.toUpperCase(),
      mapping.glyphName
    ].join("|") === anchorKey);
    if (!anchorMapping) throw new Error("Repair composite anchor must have an exact simple glyph mapping");
    if ([...String(composite.unicode || "")].length !== 1) throw new Error("Repair composite unicode must contain one Unicode scalar");
    const compositePoint = `U+${composite.unicode.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
    if (composite.unicodeCodePoint !== compositePoint) throw new Error(`Repair composite unicodeCodePoint must be ${compositePoint}`);
    const placement = composite.placement;
    if (placement?.requireSingleByteTj !== true
      || !Number.isInteger(placement.maxContentOperatorGap) || placement.maxContentOperatorGap < 1
      || !Number.isFinite(placement.maxAbsBaselineDelta) || placement.maxAbsBaselineDelta < 0
      || !Number.isFinite(placement.maxAbsOriginDelta) || placement.maxAbsOriginDelta <= 0
      || placement.requireOverlayAdvanceWidth !== 0) {
      throw new Error("Repair composite placement policy is invalid");
    }
    const transform = composite.textTransform;
    const expected = [...String(transform?.expected || "")];
    const replacement = [...String(transform?.replacement || "")];
    for (const field of ["overlayScalarOffset", "anchorScalarOffset", "compositeScalarOffset"]) {
      if (!Number.isInteger(transform?.[field]) || transform[field] < 0) throw new Error(`Repair composite ${field} is invalid`);
    }
    if (!expected.length || expected.length > 8 || !replacement.length || replacement.length > 8
      || transform.overlayScalarOffset >= expected.length || transform.anchorScalarOffset >= expected.length
      || transform.compositeScalarOffset >= replacement.length
      || expected[transform.anchorScalarOffset] !== anchorMapping.unicode
      || replacement[transform.compositeScalarOffset] !== composite.unicode
      || replacement.join("").trim() !== composite.unicode) {
      throw new Error("Repair composite text transform is invalid");
    }
    if (!Array.isArray(composite.expectedOccurrences) || !composite.expectedOccurrences.length) {
      throw new Error("Repair composite expectedOccurrences are required");
    }
    for (const occurrence of composite.expectedOccurrences) {
      if (!Number.isInteger(occurrence.page) || occurrence.page < 1
        || !Number.isInteger(occurrence.overlayContentOperatorIndex) || occurrence.overlayContentOperatorIndex < 0
        || !Number.isInteger(occurrence.anchorContentOperatorIndex) || occurrence.anchorContentOperatorIndex < 0) {
        throw new Error("Repair composite occurrence is invalid");
      }
      for (const field of ["overlayTextMatrix", "anchorTextMatrix"]) {
        if (!Array.isArray(occurrence[field]) || occurrence[field].length !== 6
          || occurrence[field].some((value) => !Number.isFinite(value))) {
          throw new Error(`Repair composite occurrence ${field} is invalid`);
        }
      }
      const occurrenceKey = `${occurrence.page}|${occurrence.overlayContentOperatorIndex}|${occurrence.anchorContentOperatorIndex}`;
      if (compositeOccurrences.has(occurrenceKey)) throw new Error(`Duplicate repair composite occurrence: ${occurrenceKey}`);
      compositeOccurrences.add(occurrenceKey);
    }
  }
  if (spec.visualEvidence?.status !== "pending") throw new Error("A new repair spec must begin with pending visual evidence");
  if (!Array.isArray(spec.visualEvidence.diagnosedPages) || !spec.visualEvidence.diagnosedPages.length) {
    throw new Error("Repair spec diagnosedPages are required");
  }
  const diagnosedPages = new Set(spec.visualEvidence.diagnosedPages);
  for (const composite of spec.strategy.compositeGlyphMap || []) {
    for (const occurrence of composite.expectedOccurrences) {
      if (!diagnosedPages.has(occurrence.page)) throw new Error(`Repair composite page ${occurrence.page} lacks diagnosed visual evidence`);
    }
  }
  return true;
}

export function matchGlyphRepairMapping(event, glyphMap) {
  return (glyphMap || []).find((mapping) => (
    mapping.fontResourceTag === event.fontResourceTag
    && (mapping.fontStreamKey === undefined || mapping.fontStreamKey === event.fontStreamKey)
    && mapping.fontStreamSha256 === event.fontStreamSha256
    && String(mapping.rawCodeHex ?? mapping.charCodeHex ?? "").toUpperCase()
      === String(event.rawCodeHex ?? event.originalCharCodeHex ?? "").toUpperCase()
    && mapping.glyphName === event.glyphName
  )) || null;
}

export function classifyObservedGlyphEvents(events, glyphMap) {
  return (events || []).map((event) => ({
    ...event,
    mappingStatus: matchGlyphRepairMapping(event, glyphMap) ? "mapped" : "unmapped"
  }));
}

function glyphSourceEventKey(event) {
  return [
    event.page,
    event.contentOperatorIndex,
    event.textOperator,
    event.stringOperandIndex,
    event.byteOffset
  ].join("|");
}

function matchCompositeComponent(event, compositeGlyphMap) {
  const composite = (compositeGlyphMap || []).find((item) => item.id === event.compositeId);
  if (!composite) return null;
  const component = composite[event.compositeRole];
  if (!component) return null;
  const matches = component.fontResourceTag === event.fontResourceTag
    && component.fontStreamSha256 === event.fontStreamSha256
    && component.charCodeHex.toUpperCase() === String(event.originalCharCodeHex || "").toUpperCase()
    && component.glyphName === event.glyphName;
  return matches ? { composite, component } : null;
}

export function validateGeneratedRepairEvidence(generated, glyphMap, compositeGlyphMap = [], options = {}) {
  if (!Array.isArray(generated?.glyphEvents) || !Array.isArray(generated?.mappedGlyphProvenance)) {
    throw new Error("Generated repair glyph evidence is missing");
  }
  if (!Array.isArray(generated?.compositeGlyphProvenance)) {
    throw new Error("Generated repair composite glyph evidence is missing");
  }
  const requireExactResourceBinding = options.requireExactResourceBinding === true;
  if (requireExactResourceBinding && !Array.isArray(generated?.unmappedGlyphProvenance)) {
    throw new Error("Generated repair unmapped glyph provenance is missing");
  }
  if (requireExactResourceBinding) {
    const resources = options.resources || [];
    const declaredResources = new Map(resources.map((resource, index) => [[
      resource.fontResourceTag,
      resource.fontStreamKey,
      resource.fontStreamSha256
    ].join("|"), index]));
    const eventIdentity = (event) => [
      event.fontResourceTag,
      event.fontStreamKey,
      event.fontStreamSha256,
      String(event.rawCodeHex || "").toUpperCase(),
      event.glyphName
    ].join("|");
    for (const event of generated.glyphEvents) {
      if (!/^\/[A-Za-z0-9_.-]+$/.test(event.fontResourceTag || "")
        || !["/FontFile", "/FontFile2", "/FontFile3"].includes(event.fontStreamKey)
        || !SHA256_PATTERN.test(event.fontStreamSha256 || "")
        || !/^[0-9A-F]{2}$/i.test(event.rawCodeHex || "")
        || !/^\/[A-Za-z0-9_.-]+$/.test(event.glyphName || "")) {
        throw new Error(`Generated repair event lacks exact resource/raw-code/glyph binding: ${glyphSourceEventKey(event)}`);
      }
      const resourceKey = [event.fontResourceTag, event.fontStreamKey, event.fontStreamSha256].join("|");
      if (declaredResources.size && !declaredResources.has(resourceKey)) {
        throw new Error(`Generated repair event uses an undeclared resource: ${glyphSourceEventKey(event)}`);
      }
      if (!Array.isArray(event.bbox) || event.bbox.length !== 4 || event.bbox.some((value) => !Number.isFinite(value))
        || !Number.isInteger(event.candidateTextUnicodeScalarOffset)
        || !Number.isInteger(event.renderCharacterOffset)) {
        throw new Error(`Generated repair event lacks complete renderer provenance: ${glyphSourceEventKey(event)}`);
      }
      if ((event.mappingStatus === "unmapped" && event.mappingMode !== "unmapped")
        || (event.mappingStatus === "mapped" && !["substitution", "verified-noop"].includes(event.mappingMode))) {
        throw new Error(`Generated repair event mapping mode is invalid: ${glyphSourceEventKey(event)}`);
      }
      const mapping = matchGlyphRepairMapping(event, glyphMap);
      if ((event.mappingStatus === "mapped") !== Boolean(mapping)) {
        throw new Error(`Generated repair event mapping classification is invalid: ${glyphSourceEventKey(event)}`);
      }
    }
    const unmappedEvents = generated.glyphEvents.filter((event) => event.mappingStatus === "unmapped");
    if (unmappedEvents.length !== generated.unmappedGlyphProvenance.length) {
      throw new Error("Generated repair unmapped event/provenance counts differ");
    }
    const unmappedProvenance = new Map(generated.unmappedGlyphProvenance.map((item) => [glyphSourceEventKey(item), item]));
    for (const event of unmappedEvents) {
      const item = unmappedProvenance.get(glyphSourceEventKey(event));
      if (!item
        || stableStringify(item.bbox) !== stableStringify(event.bbox)
        || item.fontResourceTag !== event.fontResourceTag
        || item.fontStreamKey !== event.fontStreamKey
        || item.fontStreamSha256 !== event.fontStreamSha256
        || item.rawCodeHex !== event.rawCodeHex
        || item.glyphName !== event.glyphName) {
        throw new Error(`Generated repair unmapped event/provenance mismatch: ${glyphSourceEventKey(event)}`);
      }
    }
    if (!Array.isArray(generated?.observedGlyphs) || !Array.isArray(generated?.unmappedGlyphs)) {
      throw new Error("Generated repair mapped/unmapped resource summaries are missing");
    }
    const eventCounts = new Map();
    for (const event of generated.glyphEvents) {
      const key = eventIdentity(event);
      const value = eventCounts.get(key) || { count: 0, mappedCount: 0, pages: new Set() };
      value.count += 1;
      if (event.mappingStatus === "mapped") value.mappedCount += 1;
      value.pages.add(event.page);
      eventCounts.set(key, value);
    }
    const observedKeys = new Set();
    for (const item of generated.observedGlyphs) {
      const key = eventIdentity(item);
      const expected = eventCounts.get(key);
      const resourceKey = [item.fontResourceTag, item.fontStreamKey, item.fontStreamSha256].join("|");
      if (observedKeys.has(key) || !expected
        || item.count !== expected.count
        || item.mappedCount !== expected.mappedCount
        || stableStringify(item.pages) !== stableStringify([...expected.pages].sort((left, right) => left - right))
        || (declaredResources.size && item.resourceIndex !== declaredResources.get(resourceKey))) {
        throw new Error(`Generated repair observed resource summary is incomplete or ambiguous: ${key}`);
      }
      observedKeys.add(key);
    }
    if (observedKeys.size !== eventCounts.size) {
      throw new Error("Generated repair observed resource/event coverage differs");
    }
    const unmappedCounts = new Map();
    for (const event of unmappedEvents) {
      const key = eventIdentity(event);
      unmappedCounts.set(key, (unmappedCounts.get(key) || 0) + 1);
    }
    const unmappedKeys = new Set();
    for (const item of generated.unmappedGlyphs) {
      const key = eventIdentity(item);
      if (unmappedKeys.has(key) || item.count !== unmappedCounts.get(key) || typeof item.reason !== "string") {
        throw new Error(`Generated repair unmapped resource summary is incomplete or ambiguous: ${key}`);
      }
      unmappedKeys.add(key);
    }
    if (unmappedKeys.size !== unmappedCounts.size) {
      throw new Error("Generated repair unmapped resource/event coverage differs");
    }
  }
  const mappedEvents = generated.glyphEvents.filter((event) => event.mappingStatus === "mapped");
  if (mappedEvents.length !== generated.mappedGlyphProvenance.length) {
    throw new Error("Generated repair mapped event/provenance counts differ");
  }
  const provenance = new Map();
  for (const item of generated.mappedGlyphProvenance) {
    const key = glyphSourceEventKey(item);
    if (provenance.has(key)) throw new Error(`Duplicate generated repair provenance event: ${key}`);
    provenance.set(key, item);
  }
  for (const event of mappedEvents) {
    if ((event.mappingKind || "simple") === "composite-component") {
      const match = matchCompositeComponent(event, compositeGlyphMap);
      if (!match || event.candidateCharacter !== match.composite.unicode
        || event.unicodeCodePoint !== match.composite.unicodeCodePoint) {
        throw new Error(`Generated repair event lacks exact composite mapping: ${glyphSourceEventKey(event)}`);
      }
    } else {
      const mapping = matchGlyphRepairMapping(event, glyphMap);
      if (!mapping || event.candidateCharacter !== mapping.unicode || event.unicodeCodePoint !== mapping.unicodeCodePoint) {
        throw new Error(`Generated repair event lacks exact four-tuple mapping: ${glyphSourceEventKey(event)}`);
      }
    }
    if (!Array.isArray(event.bbox) || event.bbox.length !== 4 || event.bbox.some((value) => !Number.isFinite(value))) {
      throw new Error(`Generated repair event lacks renderer bbox: ${glyphSourceEventKey(event)}`);
    }
    if (!Number.isInteger(event.candidateTextUnicodeScalarOffset) || !Number.isInteger(event.renderCharacterOffset)) {
      throw new Error(`Generated repair event lacks text/render offsets: ${glyphSourceEventKey(event)}`);
    }
    const item = provenance.get(glyphSourceEventKey(event));
    if (!item
      || stableStringify(item.bbox) !== stableStringify(event.bbox)
      || item.candidateTextUnicodeScalarOffset !== event.candidateTextUnicodeScalarOffset
      || item.renderCharacterOffset !== event.renderCharacterOffset
      || item.candidateCharacter !== event.candidateCharacter) {
      throw new Error(`Generated repair event/provenance geometry mismatch: ${glyphSourceEventKey(event)}`);
    }
  }
  const compositeComponentKeys = new Set();
  for (const occurrence of generated.compositeGlyphProvenance) {
    const spec = compositeGlyphMap.find((item) => item.id === occurrence.id);
    if (!spec || occurrence.unicode !== spec.unicode || occurrence.unicodeCodePoint !== spec.unicodeCodePoint
      || !Number.isInteger(occurrence.candidateTextUnicodeScalarOffset)
      || !Array.isArray(occurrence.standardTextRange) || occurrence.standardTextRange.length !== 2
      || !Array.isArray(occurrence.textMatrixOriginDelta) || occurrence.textMatrixOriginDelta.length !== 2
      || !Array.isArray(occurrence.components) || occurrence.components.length !== 2) {
      throw new Error(`Generated repair composite occurrence is invalid: ${occurrence?.id}`);
    }
    for (const component of occurrence.components) {
      if (!['overlay', 'anchor'].includes(component.role)
        || typeof component.sourceEventKey !== "string"
        || compositeComponentKeys.has(component.sourceEventKey)) {
        throw new Error(`Generated repair composite component is invalid: ${occurrence.id}`);
      }
      compositeComponentKeys.add(component.sourceEventKey);
    }
  }
  const mappedCompositeKeys = new Set(mappedEvents
    .filter((event) => event.mappingKind === "composite-component")
    .map(glyphSourceEventKey));
  if (stableStringify([...mappedCompositeKeys].sort()) !== stableStringify([...compositeComponentKeys].sort())) {
    throw new Error("Generated repair composite component/provenance coverage differs");
  }
  return true;
}

function selectRecords(manifest, specs, options) {
  const index = selectorIndex(manifest);
  let requested = null;
  if (options.papers.length) requested = new Set(options.papers.map((value) => resolveSelector(index, value, "paper")));
  const fromId = options.from ? resolveSelector(index, options.from, "--from") : "";
  const fromIndex = fromId ? manifest.records.findIndex((record) => record.id === fromId) : 0;
  let records = manifest.records.slice(fromIndex).filter((record) => specs.has(record.id));
  if (requested) {
    const missingSpecs = [...requested].filter((id) => !specs.has(id));
    if (missingSpecs.length) throw new Error(`No extraction repair spec exists for: ${missingSpecs.join(", ")}`);
    records = records.filter((record) => requested.has(record.id));
  }
  if (options.limit) records = records.slice(0, options.limit);
  return records;
}

function runWorker(python, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [WORKER_PATH], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`Extraction repair worker failed (${code}): ${errorText || "no diagnostic"}`));
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch (error) {
        reject(new Error(`Extraction repair worker returned invalid JSON: ${error.message}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function runtimeIdentity(python) {
  const versions = await runWorker(python, { command: "versions" });
  return {
    pythonExecutable: path.basename(python),
    pythonVersion: versions.python,
    pypdfVersion: versions.pypdf,
    pymupdfVersion: versions.pymupdf,
    fontToolsVersion: versions.fontTools
  };
}

export function extractionRepairInput(context) {
  return {
    schemaVersion: 1,
    stage: "extractionRepairCandidate",
    producerVersion: EXTRACTION_REPAIR_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_CODE_SHA256,
    layoutPolicy: EXTRACTION_REPAIR_LAYOUT_POLICY,
    paperId: context.record.id,
    canonicalDoi: context.record.canonicalDoi,
    manifestRecordDigest: context.record.recordDigest,
    sourcePdfSha256: context.record.pdf.sha256,
    baseExtractionInputDigest: context.ledger.stages.extraction.inputDigest,
    basePagesSha256: context.ledger.stages.extraction.artifacts.pagesSha256,
    selectedExtractionEngine: context.ledger.stages.extraction.selectedEngine,
    selectedExtractionEngineVersion: context.ledger.stages.extraction.selectedEngineVersion,
    extractionQaInputDigest: context.qa.inputDigest,
    extractionQaDecisionPath: context.qa.decisionPath,
    extractionQaDecisionSha256: context.qa.decisionSha256,
    repairSpecPath: context.spec.relativePath,
    repairSpecSha256: context.spec.sha256,
    runtime: context.runtime
  };
}

export function extractionRepairInputDigest(context) {
  return sha256(stableStringify(extractionRepairInput(context)));
}

export function extractionRepairIdentitySnapshot(context) {
  const input = extractionRepairInput(context);
  return {
    input,
    inputDigest: sha256(stableStringify(input))
  };
}

export function assertExtractionRepairPrecommitIdentity(expected, currentContext, currentCodeSha256) {
  const observed = extractionRepairIdentitySnapshot(currentContext);
  const mismatches = [];
  const keys = new Set([...Object.keys(expected.input || {}), ...Object.keys(observed.input)]);
  for (const key of [...keys].sort()) {
    if (stableStringify(expected.input?.[key] ?? null) !== stableStringify(observed.input[key] ?? null)) {
      mismatches.push(key);
    }
  }
  if (expected.inputDigest !== observed.inputDigest) mismatches.push("inputDigest");
  if (currentCodeSha256 !== EXTRACTION_REPAIR_CODE_SHA256) mismatches.push("producerCodeSha256OnDisk");
  if (mismatches.length) {
    throw new Error(`${expected.input?.paperId || currentContext.record?.id}: extraction repair inputs drifted before commit (${[...new Set(mismatches)].join(", ")})`);
  }
  return observed;
}

export function extractionRepairCandidatePaths(paperId, inputDigest) {
  assertSafeId(paperId);
  if (!SHA256_PATTERN.test(inputDigest || "")) throw new Error("Invalid extraction repair input digest");
  const base = path.posix.join(CANDIDATE_DIR, paperId, inputDigest);
  return {
    base,
    candidate: path.posix.join(base, "candidate.json"),
    pages: path.posix.join(base, "pages.json"),
    text: path.posix.join(base, "text.txt"),
    provenance: path.posix.join(base, "glyph-provenance.json")
  };
}

export function extractionRepairLockRelativePath(paperId, inputDigest) {
  assertSafeId(paperId);
  if (!SHA256_PATTERN.test(inputDigest || "")) throw new Error("Invalid extraction repair lock digest");
  return path.posix.join(CANDIDATE_DIR, paperId, LOCK_DIR_NAME, `${inputDigest}.lock.json`);
}

function validateRepairLockOwner(value, paperId, inputDigest) {
  if (value?.schemaVersion !== EXTRACTION_REPAIR_LOCK_VERSION || value?.stage !== "extractionRepairCandidateLock") {
    throw new Error(`${paperId}: extraction repair lock owner is invalid`);
  }
  if (value.paperId !== paperId || value.repairInputDigest !== inputDigest) {
    throw new Error(`${paperId}: extraction repair lock identity mismatch`);
  }
  if (!Number.isSafeInteger(value.pid) || value.pid < 1) throw new Error(`${paperId}: extraction repair lock PID is invalid`);
  if (typeof value.hostname !== "string" || !value.hostname.trim()) throw new Error(`${paperId}: extraction repair lock hostname is invalid`);
  if (typeof value.token !== "string" || !/^[a-f0-9-]{16,}$/i.test(value.token)) {
    throw new Error(`${paperId}: extraction repair lock token is invalid`);
  }
  if (!SHA256_PATTERN.test(value.producerCodeSha256 || "")) throw new Error(`${paperId}: extraction repair lock code hash is invalid`);
  if (!Number.isFinite(Date.parse(value.acquiredAt || ""))) throw new Error(`${paperId}: extraction repair lock timestamp is invalid`);
  return true;
}

export function extractionRepairProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error(`Invalid PID: ${pid}`);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

async function publishRepairLock(lockPath, ownerText) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const temporaryPath = `${lockPath}.${process.pid}-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx");
    await handle.writeFile(ownerText, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      // Publishing a hard link is an atomic create-if-absent operation on both
      // Windows and POSIX.  Unlike rename, it never replaces a live lock.
      await link(temporaryPath, lockPath);
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
  }
}

export async function acquireExtractionRepairCandidateLock(root, paperId, inputDigest, overrides = {}) {
  const relativePath = extractionRepairLockRelativePath(paperId, inputDigest);
  const lockPath = absoluteFromRelative(root, relativePath);
  const owner = {
    schemaVersion: EXTRACTION_REPAIR_LOCK_VERSION,
    stage: "extractionRepairCandidateLock",
    paperId,
    repairInputDigest: inputDigest,
    pid: overrides.pid ?? process.pid,
    hostname: overrides.hostname ?? os.hostname(),
    token: overrides.token ?? randomUUID(),
    producerCodeSha256: EXTRACTION_REPAIR_CODE_SHA256,
    acquiredAt: overrides.acquiredAt ?? new Date().toISOString()
  };
  validateRepairLockOwner(owner, paperId, inputDigest);
  const ownerText = `${stableStringify(owner, 2)}\n`;
  const processAlive = overrides.processAlive || extractionRepairProcessAlive;
  const recoveredLocks = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await publishRepairLock(lockPath, ownerText)) {
      let released = false;
      return {
        relativePath,
        owner,
        recoveredLocks,
        async release() {
          if (released) return;
          const current = await readCanonicalJson(lockPath, `${paperId} extraction repair lock`);
          validateRepairLockOwner(current.value, paperId, inputDigest);
          if (current.value.token !== owner.token || current.sha256 !== sha256(ownerText)) {
            throw new Error(`${paperId}: extraction repair lock ownership changed before release`);
          }
          await unlink(lockPath);
          released = true;
        }
      };
    }

    let existing;
    try {
      existing = await readCanonicalJson(lockPath, `${paperId} extraction repair lock`);
      validateRepairLockOwner(existing.value, paperId, inputDigest);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`${paperId}: extraction repair lock exists but cannot be safely recovered (${error.message})`);
    }
    if (existing.value.hostname !== owner.hostname) {
      throw new Error(`${paperId}: extraction repair lock belongs to another host and cannot be probed safely`);
    }
    const alive = await processAlive(existing.value.pid);
    if (alive !== false) {
      throw new Error(`${paperId}: extraction repair candidate is locked by active PID ${existing.value.pid}`);
    }

    const recoveryRelativePath = path.posix.join(
      CANDIDATE_DIR,
      paperId,
      LOCK_DIR_NAME,
      "recovered",
      inputDigest,
      `${existing.sha256}.json`
    );
    const recoveryPath = absoluteFromRelative(root, recoveryRelativePath);
    await mkdir(path.dirname(recoveryPath), { recursive: true });
    try {
      // The persistent, content-addressed hard link is the recovery CAS.  A
      // second reclaimer cannot move a newly published live lock because this
      // destination already exists.
      await link(lockPath, recoveryPath);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EEXIST") continue;
      throw error;
    }
    const recovered = await readFile(recoveryPath);
    if (sha256(recovered) !== existing.sha256) {
      await unlink(recoveryPath).catch(() => {});
      continue;
    }
    await unlink(lockPath);
    recoveredLocks.push({
      path: recoveryRelativePath,
      sha256: existing.sha256,
      pid: existing.value.pid,
      token: existing.value.token
    });
  }
  throw new Error(`${paperId}: extraction repair lock contention did not settle`);
}

export function extractionRepairVisualQaRelativePath(paperId, inputDigest, candidatePagesSha256, page) {
  assertSafeId(paperId);
  if (!SHA256_PATTERN.test(inputDigest || "") || !SHA256_PATTERN.test(candidatePagesSha256 || "")) {
    throw new Error("Invalid visual-QA binding digest");
  }
  return path.posix.join(VISUAL_QA_DIR, paperId, inputDigest, candidatePagesSha256, `page-${positiveInteger(page, "page")}.json`);
}

async function loadContext(root, manifest, record, spec, runtime) {
  const ledgerRelative = path.posix.join("research", "ledger", "papers", `${record.id}.json`);
  const ledger = (await readCanonicalJson(absoluteFromRelative(root, ledgerRelative), `${record.id} ledger`)).value;
  const qa = await verifyExtractionQaCheckpoint(root, manifest, record, ledger, {
    requireComplete: false,
    ignoreAdjudication: true
  });
  if (!qa.ok || qa.state !== "current" || qa.decision?.status !== "needs_review") {
    throw new Error(`${record.id}: current needs_review automated Extraction QA decision required (${qa.reason || qa.state})`);
  }
  if (spec.value.paperId !== record.id || spec.value.canonicalDoi !== record.canonicalDoi) {
    throw new Error(`${record.id}: repair spec identity mismatch`);
  }
  const expectedBindings = {
    sourcePdfSha256: record.pdf.sha256,
    basePagesSha256: ledger.stages?.extraction?.artifacts?.pagesSha256,
    extractionQaDecisionSha256: qa.decisionSha256
  };
  for (const [field, expected] of Object.entries(expectedBindings)) {
    if (spec.value.bindings[field] !== expected) throw new Error(`${record.id}: stale repair spec ${field}`);
  }
  const basePagesRelative = ledger.stages.extraction.artifacts.pages;
  const basePagesLoaded = await readCanonicalJson(absoluteFromRelative(root, basePagesRelative), `${record.id} production pages`);
  if (basePagesLoaded.sha256 !== expectedBindings.basePagesSha256) throw new Error(`${record.id}: production pages hash mismatch`);
  if (!Array.isArray(basePagesLoaded.value.pages) || basePagesLoaded.value.pages.length !== record.pdf.pageCount) {
    throw new Error(`${record.id}: production pages artifact is structurally invalid`);
  }
  const selectedEngine = ledger.stages?.extraction?.selectedEngine;
  const selectedEngineVersion = ledger.stages?.extraction?.selectedEngineVersion;
  if (!["pypdf", "pymupdf"].includes(selectedEngine) || typeof selectedEngineVersion !== "string") {
    throw new Error(`${record.id}: production-selected extraction engine is invalid`);
  }
  const runtimeVersion = selectedEngine === "pypdf" ? runtime.pypdfVersion : runtime.pymupdfVersion;
  if (selectedEngineVersion !== runtimeVersion) {
    throw new Error(`${record.id}: production-selected ${selectedEngine} version ${selectedEngineVersion} is unavailable (runtime ${runtimeVersion})`);
  }
  if (basePagesLoaded.value.extractor?.selectedEngine !== selectedEngine
    || basePagesLoaded.value.extractor?.selectedEngineVersion !== selectedEngineVersion) {
    throw new Error(`${record.id}: production pages engine binding mismatch`);
  }
  return { root, manifest, record, ledger, qa, spec, runtime, basePagesLoaded };
}

async function revalidateExtractionRepairPrecommit(root, paperId, expectedIdentity, python) {
  const codeSha256 = await currentExtractionRepairCodeSha256();
  if (codeSha256 !== EXTRACTION_REPAIR_CODE_SHA256) {
    throw new Error(`${paperId}: extraction repair code changed before commit`);
  }
  const manifest = (await readCanonicalJson(
    absoluteFromRelative(root, "research/corpus/manifest.v1.json"),
    "corpus manifest"
  )).value;
  const record = manifest.records.find((item) => item.id === paperId);
  if (!record) throw new Error(`${paperId}: manifest record disappeared before commit`);
  const specs = await loadRepairSpecs(root);
  const spec = specs.get(paperId);
  if (!spec) throw new Error(`${paperId}: repair spec disappeared before commit`);
  const runtime = await runtimeIdentity(python);
  const currentContext = await loadContext(root, manifest, record, spec, runtime);
  assertExtractionRepairPrecommitIdentity(expectedIdentity, currentContext, codeSha256);
  return currentContext;
}

function makePlainText(pages) {
  return pages.map((page) => `===== PDF PAGE ${page.page} =====\n${page.text}`).join("\n\n") + "\n";
}

export function makeExtractionRepairBundle(context, generated) {
  const strategy = context.spec.value.strategy;
  validateGeneratedRepairEvidence(
    generated,
    strategy.glyphMap,
    strategy.compositeGlyphMap || [],
    {
      requireExactResourceBinding: strategy.version === 2,
      resources: strategy.version === 2 ? strategy.resources : []
    }
  );
  const input = extractionRepairInput(context);
  const inputDigest = sha256(stableStringify(input));
  const paths = extractionRepairCandidatePaths(context.record.id, inputDigest);
  const binding = {
    sourcePdfSha256: context.record.pdf.sha256,
    basePagesSha256: context.ledger.stages.extraction.artifacts.pagesSha256,
    extractionQaDecisionSha256: context.qa.decisionSha256,
    repairInputDigest: inputDigest
  };
  const pagesPayload = {
    schemaVersion: 1,
    stage: "extractionRepairCandidatePages",
    producerVersion: EXTRACTION_REPAIR_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_CODE_SHA256,
    paperId: context.record.id,
    canonicalDoi: context.record.canonicalDoi,
    ...binding,
    engine: generated.engine,
    layoutPolicy: EXTRACTION_REPAIR_LAYOUT_POLICY,
    pages: generated.candidatePages
  };
  const pagesText = `${stableStringify(pagesPayload, 2)}\n`;
  const plainText = makePlainText(generated.candidatePages);
  const candidatePagesSha256 = sha256(pagesText);
  const resourceBinding = strategy.version === 1
    ? { resource: strategy.resource }
    : { resources: strategy.resources };
  const provenancePayload = {
    schemaVersion: 1,
    stage: "extractionRepairGlyphProvenance",
    producerVersion: EXTRACTION_REPAIR_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_CODE_SHA256,
    paperId: context.record.id,
    canonicalDoi: context.record.canonicalDoi,
    ...binding,
    candidatePagesSha256,
    strategyVersion: strategy.version,
    ...resourceBinding,
    glyphMap: strategy.glyphMap,
    compositeGlyphMap: strategy.compositeGlyphMap || [],
    observedGlyphs: generated.observedGlyphs,
    unmappedGlyphs: generated.unmappedGlyphs,
    glyphEvents: generated.glyphEvents,
    mappedGlyphProvenance: generated.mappedGlyphProvenance,
    unmappedGlyphProvenance: generated.unmappedGlyphProvenance || [],
    compositeGlyphProvenance: generated.compositeGlyphProvenance,
    layoutVerification: generated.layoutVerification
  };
  const provenanceText = `${stableStringify(provenancePayload, 2)}\n`;
  const visualRequirements = generated.visualReviewRequirements.map((requirement) => ({
    ...requirement,
    sidecarPath: extractionRepairVisualQaRelativePath(context.record.id, inputDigest, candidatePagesSha256, requirement.page)
  }));
  const candidate = {
    schemaVersion: 1,
    stage: "extractionRepairCandidate",
    producer: "scripts/extraction-repair.mjs",
    producerVersion: EXTRACTION_REPAIR_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_CODE_SHA256,
    status: "needs_visual_review",
    promotionEligibility: false,
    paperId: context.record.id,
    canonicalDoi: context.record.canonicalDoi,
    manifestRecordDigest: context.record.recordDigest,
    ...binding,
    candidatePagesSha256,
    extractionQaInputDigest: context.qa.inputDigest,
    extractionQaDecisionPath: context.qa.decisionPath,
    repairSpecPath: context.spec.relativePath,
    repairSpecSha256: context.spec.sha256,
    engine: generated.engine,
    runtime: context.runtime,
    layoutPolicy: EXTRACTION_REPAIR_LAYOUT_POLICY,
    strategyVersion: strategy.version,
    ...resourceBinding,
    glyphMap: strategy.glyphMap,
    compositeGlyphMap: strategy.compositeGlyphMap || [],
    mappedGlyphCount: generated.mappedGlyphProvenance.length,
    compositeGlyphCount: generated.compositeGlyphProvenance.length,
    observedGlyphs: generated.observedGlyphs,
    unmappedGlyphs: generated.unmappedGlyphs,
    layoutVerification: generated.layoutVerification,
    visualEvidence: {
      status: "pending",
      diagnosedPages: context.spec.value.visualEvidence.diagnosedPages,
      diagnosis: context.spec.value.visualEvidence.observation,
      eligibilityRule: "eligible_for_manual_adjudication requires accepted hash-bound sidecars for every affected page and zero unmapped glyphs; it never promotes production extraction",
      requirements: visualRequirements
    },
    artifacts: {
      pages: paths.pages,
      pagesSha256: candidatePagesSha256,
      text: paths.text,
      textSha256: sha256(plainText),
      provenance: paths.provenance,
      provenanceSha256: sha256(provenanceText)
    }
  };
  const candidateText = `${stableStringify(candidate, 2)}\n`;
  return {
    input,
    inputDigest,
    paths,
    candidate,
    bytes: {
      candidate: candidateText,
      pages: pagesText,
      text: plainText,
      provenance: provenanceText
    }
  };
}

export async function compareExtractionRepairBundle(root, bundle) {
  const errors = [];
  for (const key of ["candidate", "pages", "text", "provenance"]) {
    const relativePath = bundle.paths[key];
    let observed;
    try {
      observed = await readFile(absoluteFromRelative(root, relativePath), "utf8");
    } catch (error) {
      errors.push({ code: `${key}_missing_or_unreadable`, detail: error.code || error.name });
      continue;
    }
    if (observed !== bundle.bytes[key]) errors.push({ code: `${key}_not_reproducible`, detail: "bytes differ from current inputs and producer" });
  }
  return { ok: errors.length === 0, errors };
}

export async function commitExtractionRepairBundle(root, bundle) {
  // Production callers hold the paper+digest lock around this operation.
  // candidate.json is the commit marker and is always written last.  A crash
  // before that point leaves an incomplete directory that the next lock owner
  // safely reconstructs instead of treating as current.
  await atomicWriteText(absoluteFromRelative(root, bundle.paths.pages), bundle.bytes.pages);
  await atomicWriteText(absoluteFromRelative(root, bundle.paths.text), bundle.bytes.text);
  await atomicWriteText(absoluteFromRelative(root, bundle.paths.provenance), bundle.bytes.provenance);
  await atomicWriteText(absoluteFromRelative(root, bundle.paths.candidate), bundle.bytes.candidate);
  return { changed: true };
}

function numbersEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function visualEvidenceTextValid(value, page) {
  const text = String(value || "").trim();
  return text.length >= 35 && new RegExp(`\\bpage\\s*${page}\\b`, "i").test(text);
}

async function inspectVisualSidecar(root, candidate, requirement) {
  const expectedPath = requirement.sidecarPath;
  let loaded;
  try {
    loaded = await readCanonicalJson(absoluteFromRelative(root, expectedPath), `${candidate.paperId} page ${requirement.page} visual QA`);
  } catch (error) {
    return {
      page: requirement.page,
      state: error.code === "ENOENT" ? "missing" : "invalid",
      path: expectedPath,
      errors: [error.message]
    };
  }
  const value = loaded.value;
  const errors = [];
  const requireEqual = (condition, code) => { if (!condition) errors.push(code); };
  requireEqual(value.schemaVersion === 1 && value.stage === "extractionRepairVisualQa", "schema_or_stage_invalid");
  requireEqual(value.producer === "manual-visual-review-v1", "producer_invalid");
  for (const key of ["paperId", "sourcePdfSha256", "basePagesSha256", "candidatePagesSha256", "repairInputDigest"]) {
    requireEqual(value[key] === candidate[key], `${key}_mismatch`);
  }
  requireEqual(value.page === requirement.page, "page_mismatch");
  requireEqual(numbersEqual(value.cropBox, requirement.cropBox), "crop_box_mismatch");
  requireEqual(numbersEqual(value.bbox, requirement.bbox), "bbox_mismatch");
  requireEqual(Number.isInteger(value.dpi) && value.dpi >= 72, "dpi_invalid");
  requireEqual(typeof value.renderer?.name === "string" && value.renderer.name.length >= 2, "renderer_name_invalid");
  requireEqual(typeof value.renderer?.version === "string" && value.renderer.version.length >= 1, "renderer_version_invalid");
  requireEqual(SHA256_PATTERN.test(value.cropSha256 || ""), "crop_sha_invalid");
  requireEqual(typeof value.cropPath === "string", "crop_path_invalid");
  if (typeof value.cropPath === "string" && SHA256_PATTERN.test(value.cropSha256 || "")) {
    try {
      const crop = await hashFile(absoluteFromRelative(root, value.cropPath));
      requireEqual(crop.sha256 === value.cropSha256, "crop_hash_mismatch");
    } catch (error) {
      errors.push(`crop_unreadable:${error.code || error.name}`);
    }
  }
  requireEqual(typeof value.reviewer === "string" && value.reviewer.trim().length >= 3, "reviewer_invalid");
  requireEqual(["accepted", "rejected"].includes(value.outcome), "outcome_invalid");
  requireEqual(visualEvidenceTextValid(value.observation, requirement.page), "observation_invalid");
  requireEqual(Array.isArray(value.regions) && value.regions.length > 0, "regions_missing");
  const coveredTypes = new Set();
  const coveredChecks = new Set();
  for (const [index, region] of (value.regions || []).entries()) {
    if (!VISUAL_REGION_TYPES.has(region.type)) errors.push(`region_${index}_type_invalid`);
    else coveredTypes.add(region.type);
    if (!Array.isArray(region.bbox) || region.bbox.length !== 4 || region.bbox.some((item) => !Number.isFinite(item))) {
      errors.push(`region_${index}_bbox_invalid`);
    }
    if (!Array.isArray(region.checks) || region.checks.some((item) => !VISUAL_CHECKS.has(item))) {
      errors.push(`region_${index}_checks_invalid`);
    } else {
      for (const check of region.checks) coveredChecks.add(check);
    }
    if (!["accepted", "rejected"].includes(region.outcome)) errors.push(`region_${index}_outcome_invalid`);
    if (!visualEvidenceTextValid(region.observation, requirement.page)) errors.push(`region_${index}_observation_invalid`);
  }
  for (const type of requirement.requiredRegionTypes) if (!coveredTypes.has(type)) errors.push(`required_region_${type}_missing`);
  for (const check of requirement.requiredChecks) if (!coveredChecks.has(check)) errors.push(`required_check_${check}_missing`);
  const regionRejected = (value.regions || []).some((region) => region.outcome === "rejected");
  if (value.outcome === "accepted" && regionRejected) errors.push("accepted_with_rejected_region");
  return {
    page: requirement.page,
    state: errors.length ? "invalid" : value.outcome,
    path: expectedPath,
    sha256: loaded.sha256,
    errors
  };
}

export async function inspectExtractionRepairVisualEvidence(root, candidate) {
  const sidecars = [];
  for (const requirement of candidate.visualEvidence?.requirements || []) {
    sidecars.push(await inspectVisualSidecar(root, candidate, requirement));
  }
  const allCovered = sidecars.length === (candidate.visualEvidence?.requirements || []).length
    && sidecars.every((sidecar) => sidecar.state === "accepted");
  const zeroUnmapped = (candidate.unmappedGlyphs || []).length === 0;
  const eligibleForManualAdjudication = allCovered && zeroUnmapped;
  const binding = sidecars
    .filter((sidecar) => sidecar.sha256)
    .map((sidecar) => ({ page: sidecar.page, path: sidecar.path, sha256: sidecar.sha256 }));
  return {
    state: eligibleForManualAdjudication ? "eligible_for_manual_adjudication" : "needs_visual_review",
    eligibleForManualAdjudication,
    promotionEligibility: false,
    zeroUnmappedGlyphs: zeroUnmapped,
    allAffectedPagesAccepted: allCovered,
    sidecarBindingSha256: binding.length ? sha256(stableStringify(binding)) : null,
    sidecars
  };
}

async function staleCandidateDigests(root, paperId, currentDigest) {
  const directory = absoluteFromRelative(root, path.posix.join(CANDIDATE_DIR, paperId));
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && SHA256_PATTERN.test(entry.name) && entry.name !== currentDigest)
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function generateBundle(context, python) {
  const sourcePath = absoluteFromRelative(context.root, context.record.pdf.path);
  const generated = await runWorker(python, {
    sourcePath,
    basePages: context.basePagesLoaded.value.pages,
    repairSpec: context.spec.value,
    selectedEngine: {
      name: context.ledger.stages.extraction.selectedEngine,
      version: context.ledger.stages.extraction.selectedEngineVersion
    }
  });
  if (generated.engine?.pypdfVersion !== context.runtime.pypdfVersion
    || generated.engine?.pymupdfVersion !== context.runtime.pymupdfVersion
    || generated.engine?.fontToolsVersion !== context.runtime.fontToolsVersion
    || generated.engine?.selectedTextEngine !== context.ledger.stages.extraction.selectedEngine
    || generated.engine?.selectedTextEngineVersion !== context.ledger.stages.extraction.selectedEngineVersion) {
    throw new Error(`${context.record.id}: worker runtime changed during candidate generation`);
  }
  return makeExtractionRepairBundle(context, generated);
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, run));
  return output;
}

export async function runExtractionRepair(options) {
  const manifestPath = absoluteFromRelative(options.root, "research/corpus/manifest.v1.json");
  const manifest = (await readCanonicalJson(manifestPath, "corpus manifest")).value;
  const specs = await loadRepairSpecs(options.root);
  const records = selectRecords(manifest, specs, options);
  const python = options.python || process.env.ATLAS_PYTHON || "python";
  const runtime = await runtimeIdentity(python);
  const results = await mapLimit(records, options.jobs, async (record) => {
    try {
      const context = await loadContext(options.root, manifest, record, specs.get(record.id), runtime);
      const expectedIdentity = extractionRepairIdentitySnapshot(context);
      const bundle = await generateBundle(context, python);
      if (bundle.inputDigest !== expectedIdentity.inputDigest) {
        throw new Error(`${record.id}: generated candidate input identity changed unexpectedly`);
      }
      const comparison = await compareExtractionRepairBundle(options.root, bundle);
      const staleDigests = await staleCandidateDigests(options.root, record.id, bundle.inputDigest);
      if (options.command === "status") {
        if (!comparison.ok) {
          return { id: record.id, ok: false, status: "missing_or_invalid", errors: comparison.errors, staleDigests };
        }
      } else if (options.check) {
        if (!comparison.ok) {
          return { id: record.id, ok: false, status: "check_failed", errors: comparison.errors, staleDigests };
        }
      } else if (!comparison.ok) {
        const lock = await acquireExtractionRepairCandidateLock(options.root, record.id, bundle.inputDigest);
        let committed = null;
        try {
          // Compare again under the lock.  A peer may have completed the same
          // deterministic bundle between our first comparison and acquisition.
          const lockedComparison = await compareExtractionRepairBundle(options.root, bundle);
          if (!lockedComparison.ok) {
            await revalidateExtractionRepairPrecommit(options.root, record.id, expectedIdentity, python);
            committed = await commitExtractionRepairBundle(options.root, bundle);
            const verified = await compareExtractionRepairBundle(options.root, bundle);
            if (!verified.ok) {
              return { id: record.id, ok: false, status: "commit_verification_failed", errors: verified.errors, staleDigests };
            }
          }
        } finally {
          await lock.release();
        }
        if (committed) {
          const visual = await inspectExtractionRepairVisualEvidence(options.root, bundle.candidate);
          return {
            id: record.id,
            ok: true,
            status: "written",
            changed: committed.changed,
            candidatePath: bundle.paths.candidate,
            candidatePagesSha256: bundle.candidate.artifacts.pagesSha256,
            mappedGlyphCount: bundle.candidate.mappedGlyphCount,
            unmappedGlyphCount: bundle.candidate.unmappedGlyphs.length,
            visual,
            lock: { path: lock.relativePath, recoveredLocks: lock.recoveredLocks },
            staleDigests
          };
        }
      }
      const visual = await inspectExtractionRepairVisualEvidence(options.root, bundle.candidate);
      return {
        id: record.id,
        ok: true,
        status: options.check ? "check_passed" : "current",
        changed: false,
        candidatePath: bundle.paths.candidate,
        candidatePagesSha256: bundle.candidate.artifacts.pagesSha256,
        mappedGlyphCount: bundle.candidate.mappedGlyphCount,
        unmappedGlyphCount: bundle.candidate.unmappedGlyphs.length,
        visual,
        staleDigests
      };
    } catch (error) {
      return { id: record.id, ok: false, status: "failed_closed", error: error.message };
    }
  });
  return {
    schemaVersion: 1,
    producerVersion: EXTRACTION_REPAIR_VERSION,
    producerCodeSha256: EXTRACTION_REPAIR_CODE_SHA256,
    command: options.command,
    check: Boolean(options.check),
    selected: records.length,
    ok: results.every((result) => result.ok),
    results
  };
}

function usage() {
  return `Usage:
  node scripts/extraction-repair.mjs build [--paper ID_OR_DOI] [--from ID_OR_DOI] [--limit N] [--jobs N] [--python PATH] [--json]
  node scripts/extraction-repair.mjs check [--paper ID_OR_DOI] [--from ID_OR_DOI] [--limit N] [--jobs N] [--python PATH] [--json]
  node scripts/extraction-repair.mjs status [--paper ID_OR_DOI] [--from ID_OR_DOI] [--limit N] [--jobs N] [--python PATH] [--json]

--check is an alias for the check command. Every output is isolated under
research/ledger/extraction-repair-candidates. The command never updates a
production pages artifact, shared paper ledger, QA decision, or adjudication.`;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  console.log(`Extraction repair ${result.command}: ${result.selected} selected; ${result.ok ? "valid" : "failed closed"}.`);
  for (const item of result.results) {
    const glyphs = item.ok ? `; mapped=${item.mappedGlyphCount}, unmapped=${item.unmappedGlyphCount}` : "";
    console.log(`  ${item.id}: ${item.status}${glyphs}${item.error ? `; ${item.error}` : ""}`);
  }
}

async function main() {
  const options = parseExtractionRepairCli(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const result = await runExtractionRepair(options);
  printResult(result, options.json);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
