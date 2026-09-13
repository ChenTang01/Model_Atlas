import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sha256, stableStringify } from "../scripts/corpus-pipeline.mjs";
import {
  EXTRACTION_REPAIR_CODE_SHA256,
  acquireExtractionRepairCandidateLock,
  assertExtractionRepairPrecommitIdentity,
  classifyObservedGlyphEvents,
  commitExtractionRepairBundle,
  compareExtractionRepairBundle,
  extractionRepairCandidatePaths,
  extractionRepairIdentitySnapshot,
  extractionRepairLockRelativePath,
  inspectExtractionRepairVisualEvidence,
  makeExtractionRepairBundle,
  matchGlyphRepairMapping,
  parseExtractionRepairCli,
  validateGeneratedRepairEvidence,
  validateRepairSpec
} from "../scripts/extraction-repair.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sixtyFour = (character) => character.repeat(64);

function runJsonWorker(executable, args, { cwd, input, maxBuffer }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxBuffer) {
        child.kill();
        reject(new Error(`worker output exceeded ${maxBuffer} bytes`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(input);
  });
}

function syntheticContext() {
  const specValue = {
    schemaVersion: 1,
    stage: "extractionRepairSpec",
    paperId: "paper-a",
    canonicalDoi: "10.1000/paper-a",
    bindings: {
      sourcePdfSha256: sixtyFour("a"),
      basePagesSha256: sixtyFour("b"),
      extractionQaDecisionSha256: sixtyFour("c")
    },
    strategy: {
      name: "font-resource-cmap-overlay",
      version: 1,
      resource: {
        fontResourceTag: "/Target",
        fontStreamKey: "/FontFile3",
        fontStreamSha256: sixtyFour("d")
      },
      glyphMap: [{
        fontResourceTag: "/Target",
        fontStreamSha256: sixtyFour("d"),
        charCodeHex: "21",
        glyphName: "/equals",
        unicode: "=",
        unicodeCodePoint: "U+003D"
      }]
    },
    visualEvidence: {
      status: "pending",
      diagnosedPages: [1],
      observation: "Rendered source PDF page 1 was visually compared and its equality operator was decoded incorrectly."
    }
  };
  return {
    record: {
      id: "paper-a",
      canonicalDoi: "10.1000/paper-a",
      recordDigest: "record-a",
      pdf: { sha256: sixtyFour("a") }
    },
    ledger: {
      stages: {
        extraction: {
          inputDigest: "base-input",
          selectedEngine: "pymupdf",
          selectedEngineVersion: "fixture",
          artifacts: { pagesSha256: sixtyFour("b") }
        }
      }
    },
    qa: {
      inputDigest: "qa-input",
      decisionPath: "research/ledger/extraction-qa/paper-a/qa-input.json",
      decisionSha256: sixtyFour("c")
    },
    spec: {
      value: specValue,
      relativePath: "research/extraction-repair-specs/paper-a.json",
      sha256: sha256(`${stableStringify(specValue, 2)}\n`)
    },
    runtime: {
      pythonExecutable: "python",
      pythonVersion: "fixture",
      pypdfVersion: "fixture",
      pymupdfVersion: "fixture"
    }
  };
}

function syntheticV2Spec() {
  const base = syntheticContext().spec.value;
  const first = {
    fontResourceTag: "/Greek",
    fontStreamKey: "/FontFile",
    fontStreamSha256: sixtyFour("e")
  };
  const second = {
    fontResourceTag: "/Operators",
    fontStreamKey: "/FontFile3",
    fontStreamSha256: sixtyFour("f")
  };
  return {
    ...base,
    strategy: {
      name: "font-resource-cmap-overlay",
      version: 2,
      resources: [first, second],
      glyphMap: [{
        ...first,
        rawCodeHex: "21",
        glyphName: "/theta",
        unicode: "θ",
        unicodeCodePoint: "U+03B8"
      }, {
        ...second,
        rawCodeHex: "2A",
        glyphName: "/equals",
        unicode: "=",
        unicodeCodePoint: "U+003D"
      }]
    }
  };
}

function syntheticGenerated({ unmapped = true } = {}) {
  const event = {
    page: 1,
    contentOperatorIndex: 7,
    textOperator: "Tj",
    stringOperandIndex: 0,
    byteOffset: 2,
    fontResourceTag: "/Target",
    fontStreamSha256: sixtyFour("d"),
    originalCharCodeHex: "21",
    glyphName: "/equals",
    mappingStatus: "mapped",
    unicode: "=",
    unicodeCodePoint: "U+003D",
    baseExtractedCharacter: "!",
    candidateCharacter: "=",
    candidateTextUnicodeScalarOffset: 2,
    renderCharacterOffset: 2,
    bbox: [10, 10, 20, 20]
  };
  const unknown = {
    fontResourceTag: "/Target",
    fontStreamSha256: sixtyFour("d"),
    originalCharCodeHex: "22",
    glyphName: "/minus",
    count: 1,
    pages: [1],
    mappingStatus: "unmapped",
    reason: "no_explicit_four_tuple_mapping"
  };
  return {
    engine: { name: "fixture", pypdfVersion: "fixture", pymupdfVersion: "fixture" },
    candidatePages: [{ page: 1, text: "x = y" }],
    observedGlyphs: [event, ...(unmapped ? [unknown] : [])],
    unmappedGlyphs: unmapped ? [unknown] : [],
    glyphEvents: [event],
    mappedGlyphProvenance: [{ ...event, pageEventOrdinal: 0 }],
    compositeGlyphProvenance: [],
    visualReviewRequirements: [{
      page: 1,
      cropBox: [0, 0, 100, 100],
      bbox: [10, 10, 20, 20],
      affectedBboxes: [[10, 10, 20, 20]],
      affectedSpanCount: 1,
      requiredRegionTypes: ["formula"],
      requiredChecks: ["operators", "subscripts", "superscripts", "delimiters", "order"]
    }],
    layoutVerification: {
      policy: "fixture",
      basePageCount: 1,
      candidatePageCount: 1,
      mappedEventCount: 1,
      changedPageCount: 1
    }
  };
}

function syntheticV2Generated() {
  const mapped = {
    page: 1,
    contentOperatorIndex: 7,
    textOperator: "Tj",
    stringOperandIndex: 0,
    byteOffset: 0,
    fontResourceTag: "/Greek",
    fontStreamKey: "/FontFile",
    fontStreamSha256: sixtyFour("e"),
    rawCodeHex: "21",
    glyphName: "/theta",
    mappingStatus: "mapped",
    mappingMode: "substitution",
    unicode: "θ",
    unicodeCodePoint: "U+03B8",
    baseExtractedCharacter: "✓",
    candidateCharacter: "θ",
    candidateTextUnicodeScalarOffset: 0,
    renderCharacterOffset: 0,
    bbox: [10, 10, 20, 20]
  };
  const unmapped = {
    page: 1,
    contentOperatorIndex: 8,
    textOperator: "Tj",
    stringOperandIndex: 0,
    byteOffset: 0,
    fontResourceTag: "/Operators",
    fontStreamKey: "/FontFile3",
    fontStreamSha256: sixtyFour("f"),
    rawCodeHex: "2B",
    glyphName: "/minus",
    mappingStatus: "unmapped",
    mappingMode: "unmapped",
    baseExtractedCharacter: "−",
    candidateCharacter: "−",
    candidateTextUnicodeScalarOffset: 2,
    renderCharacterOffset: 2,
    bbox: [30, 10, 40, 20]
  };
  return {
    engine: {
      name: "fixture-v2",
      pypdfVersion: "fixture",
      pymupdfVersion: "fixture",
      selectedTextEngine: "pypdf",
      selectedTextEngineVersion: "fixture"
    },
    candidatePages: [{ page: 1, text: "θ −" }],
    observedGlyphs: [{ ...mapped, resourceIndex: 0, count: 1, mappedCount: 1, pages: [1] }, {
      ...unmapped,
      resourceIndex: 1,
      count: 1,
      mappedCount: 0,
      pages: [1]
    }],
    unmappedGlyphs: [{
      ...unmapped,
      resourceIndex: 1,
      count: 1,
      mappedCount: 0,
      pages: [1],
      reason: "no_explicit_resource_stream_raw_code_glyph_mapping"
    }],
    glyphEvents: [mapped, unmapped],
    mappedGlyphProvenance: [{ ...mapped, pageEventOrdinal: 0 }],
    unmappedGlyphProvenance: [{ ...unmapped, pageEventOrdinal: 0 }],
    compositeGlyphProvenance: [],
    visualReviewRequirements: [{
      page: 1,
      cropBox: [0, 0, 100, 100],
      bbox: [10, 10, 20, 20],
      affectedBboxes: [[10, 10, 20, 20]],
      affectedSpanCount: 1,
      requiredRegionTypes: ["formula"],
      requiredChecks: ["operators", "subscripts", "superscripts", "delimiters", "order"]
    }],
    layoutVerification: {
      policy: "fixture-v2",
      basePageCount: 1,
      candidatePageCount: 1,
      mappedEventCount: 1,
      unmappedEventCount: 1,
      changedPageCount: 1
    }
  };
}

test("repair CLI supports bounded, restartable selectors and check mode", () => {
  const parsed = parseExtractionRepairCli([
    "build", "--paper", "paper-a,10.1000/paper-b", "--from", "paper-a",
    "--limit", "2", "--jobs", "1", "--check", "--json"
  ]);
  assert.equal(parsed.command, "build");
  assert.deepEqual(parsed.papers, ["paper-a", "10.1000/paper-b"]);
  assert.equal(parsed.from, "paper-a");
  assert.equal(parsed.limit, 2);
  assert.equal(parsed.jobs, 1);
  assert.equal(parsed.check, true);
  assert.equal(parseExtractionRepairCli(["check"]).check, true);
  assert.throws(() => parseExtractionRepairCli(["status", "--check"]), /mutually exclusive/);
  assert.throws(() => parseExtractionRepairCli(["--limit", "0"]), /positive integer/);
});

test("glyph repair matches the complete font-resource identity, never the visible character alone", () => {
  const glyphMap = syntheticContext().spec.value.strategy.glyphMap;
  const exact = {
    fontResourceTag: "/Target",
    fontStreamSha256: sixtyFour("d"),
    originalCharCodeHex: "21",
    glyphName: "/equals",
    baseExtractedCharacter: "!"
  };
  assert.equal(matchGlyphRepairMapping(exact, glyphMap)?.unicode, "=");
  assert.equal(matchGlyphRepairMapping({ ...exact, fontResourceTag: "/Other" }, glyphMap), null, "same character in another font is untouched");
  assert.equal(matchGlyphRepairMapping({ ...exact, fontStreamSha256: sixtyFour("e") }, glyphMap), null);
  assert.equal(matchGlyphRepairMapping({ ...exact, originalCharCodeHex: "22" }, glyphMap), null);
  assert.equal(matchGlyphRepairMapping({ ...exact, glyphName: "/exclam" }, glyphMap), null);
  assert.equal(matchGlyphRepairMapping({ ...exact, baseExtractedCharacter: "not-an-exclamation" }, glyphMap)?.unicode, "=", "visible fallback text is not repair evidence");

  const classified = classifyObservedGlyphEvents([exact, { ...exact, originalCharCodeHex: "22", glyphName: "/minus" }], glyphMap);
  assert.deepEqual(classified.map((item) => item.mappingStatus), ["mapped", "unmapped"]);
});

test("v2 specs preserve ordered resources and bind every mapping to stream key, SHA, raw byte, and glyph", () => {
  const spec = syntheticV2Spec();
  assert.equal(validateRepairSpec(spec), true);
  assert.deepEqual(spec.strategy.resources.map((item) => item.fontResourceTag), ["/Greek", "/Operators"]);

  const [mapping] = spec.strategy.glyphMap;
  const exact = {
    fontResourceTag: mapping.fontResourceTag,
    fontStreamKey: mapping.fontStreamKey,
    fontStreamSha256: mapping.fontStreamSha256,
    rawCodeHex: mapping.rawCodeHex,
    glyphName: mapping.glyphName
  };
  assert.equal(matchGlyphRepairMapping(exact, spec.strategy.glyphMap)?.unicode, "θ");
  assert.equal(matchGlyphRepairMapping({ ...exact, fontStreamKey: "/FontFile3" }, spec.strategy.glyphMap), null);
  assert.equal(matchGlyphRepairMapping({ ...exact, rawCodeHex: "22" }, spec.strategy.glyphMap), null);

  const duplicateTag = structuredClone(spec);
  duplicateTag.strategy.resources[1].fontResourceTag = "/Greek";
  assert.throws(() => validateRepairSpec(duplicateTag), /ambiguous repair resource tag/);

  const missingStreamKey = structuredClone(spec);
  delete missingStreamKey.strategy.glyphMap[0].fontStreamKey;
  assert.throws(() => validateRepairSpec(missingStreamKey), /exact resource tag, stream key/);

  const namedCff = structuredClone(spec);
  namedCff.strategy.resources[0].fontStreamKey = "/FontFile3";
  namedCff.strategy.resources[0].encodingEvidence = {
    kind: "named-cff",
    encodingName: "/MacRomanEncoding",
    encodingMapSha256: sixtyFour("1"),
    cffCharsetSha256: sixtyFour("2")
  };
  namedCff.strategy.glyphMap[0].fontStreamKey = "/FontFile3";
  namedCff.strategy.glyphMap[0].glyphOutlineSha256 = sixtyFour("3");
  assert.equal(validateRepairSpec(namedCff), true);

  const missingOutlineBinding = structuredClone(namedCff);
  delete missingOutlineBinding.strategy.glyphMap[0].glyphOutlineSha256;
  assert.throws(() => validateRepairSpec(missingOutlineBinding), /bind the embedded glyph outline SHA/);

  const variableWidth = structuredClone(spec);
  variableWidth.strategy.glyphMap[0].rawCodeHex = "0021";
  assert.throws(() => validateRepairSpec(variableWidth), /variable-width codes are unsupported/);

  const v1Alias = structuredClone(spec);
  v1Alias.strategy.glyphMap[0].charCodeHex = "21";
  assert.throws(() => validateRepairSpec(v1Alias), /mapping fields are unsupported: charCodeHex/);

  const occurrenceScope = structuredClone(spec);
  occurrenceScope.strategy.glyphMap[0].page = 3;
  assert.throws(() => validateRepairSpec(occurrenceScope), /mapping fields are unsupported: page/);

  const occurrenceTranscription = structuredClone(spec);
  occurrenceTranscription.strategy.compositeGlyphMap = [{ name: "zero-width-overlay-prefix", version: 1 }];
  assert.throws(() => validateRepairSpec(occurrenceTranscription), /occurrence transcription\/composite mappings are unsupported/);

  const figureGeometry = structuredClone(spec);
  figureGeometry.visualEvidence.visualRequirements = [{ regionType: "figure" }];
  assert.throws(() => validateRepairSpec(figureGeometry), /figure geometry/);
});

test("worker CMap editing replaces one exact binding and rejects overlapping or duplicate mappings", async () => {
  const workerPath = path.join(projectRoot, "scripts", "extraction-repair-worker.py");
  const probe = String.raw`
import importlib.util, json
spec = importlib.util.spec_from_file_location("repair_worker", ${JSON.stringify(workerPath)})
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
mapping = {"rawCodeHex":"21","unicode":"=","glyphName":"/equals"}
prefix = b"1 begincodespacerange\n<00><FF>\nendcodespacerange\n"
singleton = prefix + b"1 beginbfrange\n<21><21><21E4>\nendbfrange\n"
duplicate = prefix + b"2 beginbfchar\n<21><21E4>\n<21><003D>\nendbfchar\n"
overlap = prefix + b"1 beginbfrange\n<20><22><0020>\nendbfrange\n"
def outcome(value):
    try:
        return worker.cmap_with_mappings(value, [mapping]).decode("ascii")
    except worker.RepairError as error:
        return str(error)
print(json.dumps({"singleton": outcome(singleton), "duplicate": outcome(duplicate), "overlap": outcome(overlap)}))
`;
  const result = JSON.parse(await runJsonWorker("python", ["-c", probe], {
    cwd: projectRoot,
    input: "",
    maxBuffer: 1024 * 1024
  }));
  assert.match(result.singleton, /<21><21><003D>/);
  assert.doesNotMatch(result.singleton, /21E4/);
  assert.match(result.duplicate, /to_unicode_cmap_ambiguity/);
  assert.match(result.overlap, /to_unicode_cmap_ambiguity/);
});

test("v2 candidate bundles retain resource order and complete unmapped provenance without a v1 alias", () => {
  const context = syntheticContext();
  context.ledger.stages.extraction.selectedEngine = "pypdf";
  context.spec.value = syntheticV2Spec();
  context.spec.sha256 = sha256(`${stableStringify(context.spec.value, 2)}\n`);
  const generated = syntheticV2Generated();
  const bundle = makeExtractionRepairBundle(context, generated);
  assert.equal(validateGeneratedRepairEvidence(generated, context.spec.value.strategy.glyphMap, [], {
    requireExactResourceBinding: true,
    resources: context.spec.value.strategy.resources
  }), true);
  assert.equal(bundle.candidate.strategyVersion, 2);
  assert.equal(Object.hasOwn(bundle.candidate, "resource"), false);
  assert.deepEqual(bundle.candidate.resources.map((item) => item.fontResourceTag), ["/Greek", "/Operators"]);
  const provenance = JSON.parse(bundle.bytes.provenance);
  assert.equal(Object.hasOwn(provenance, "resource"), false);
  assert.deepEqual(provenance.resources, context.spec.value.strategy.resources);
  assert.deepEqual(provenance.unmappedGlyphProvenance, generated.unmappedGlyphProvenance);

  const missing = structuredClone(generated);
  missing.unmappedGlyphProvenance = [];
  assert.throws(
    () => makeExtractionRepairBundle(context, missing),
    /unmapped event\/provenance counts differ/
  );

  const geometryDrift = structuredClone(generated);
  geometryDrift.unmappedGlyphProvenance[0].bbox = [31, 10, 40, 20];
  assert.throws(
    () => validateGeneratedRepairEvidence(geometryDrift, context.spec.value.strategy.glyphMap, [], {
      requireExactResourceBinding: true,
      resources: context.spec.value.strategy.resources
    }),
    /unmapped event\/provenance mismatch/
  );
});

test("mapped glyph events must carry the same renderer bbox and offsets as provenance", () => {
  const glyphMap = syntheticContext().spec.value.strategy.glyphMap;
  const generated = syntheticGenerated();
  assert.equal(validateGeneratedRepairEvidence(generated, glyphMap), true);

  const missingBbox = structuredClone(generated);
  delete missingBbox.glyphEvents[0].bbox;
  assert.throws(() => validateGeneratedRepairEvidence(missingBbox, glyphMap), /lacks renderer bbox/);

  const mismatchedBbox = structuredClone(generated);
  mismatchedBbox.mappedGlyphProvenance[0].bbox = [11, 10, 20, 20];
  assert.throws(() => validateGeneratedRepairEvidence(mismatchedBbox, glyphMap), /geometry mismatch/);
});

test("candidate bundle is deterministic, restartable, atomically committed, and tamper evident", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-extraction-repair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = syntheticContext();
  const bundle = makeExtractionRepairBundle(context, syntheticGenerated());
  assert.equal(bundle.candidate.status, "needs_visual_review");
  assert.equal(bundle.candidate.promotionEligibility, false);
  assert.equal(bundle.candidate.unmappedGlyphs.length, 1);

  const firstLock = await acquireExtractionRepairCandidateLock(root, bundle.candidate.paperId, bundle.inputDigest);
  try {
    await commitExtractionRepairBundle(root, bundle);
  } finally {
    await firstLock.release();
  }
  assert.equal((await compareExtractionRepairBundle(root, bundle)).ok, true);
  const directory = path.join(root, ...bundle.paths.base.split("/"));
  assert.deepEqual((await readdir(directory)).sort(), ["candidate.json", "glyph-provenance.json", "pages.json", "text.txt"]);
  assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);

  await writeFile(path.join(root, ...bundle.paths.pages.split("/")), `${bundle.bytes.pages}tampered`);
  const tampered = await compareExtractionRepairBundle(root, bundle);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) => error.code === "pages_not_reproducible"));

  const repairLock = await acquireExtractionRepairCandidateLock(root, bundle.candidate.paperId, bundle.inputDigest);
  try {
    await commitExtractionRepairBundle(root, bundle);
  } finally {
    await repairLock.release();
  }
  assert.equal((await compareExtractionRepairBundle(root, bundle)).ok, true, "a restart reconstructs a partial or tampered bundle");

  const staleContext = syntheticContext();
  staleContext.ledger.stages.extraction.artifacts.pagesSha256 = sixtyFour("f");
  const replacement = makeExtractionRepairBundle(staleContext, syntheticGenerated());
  assert.notEqual(replacement.inputDigest, bundle.inputDigest, "changed base pages create a new content-addressed path");
  assert.equal((await compareExtractionRepairBundle(root, replacement)).ok, false, "old bytes are never accepted for new inputs");
  assert.deepEqual(extractionRepairCandidatePaths("paper-a", replacement.inputDigest), replacement.paths);
});

test("paper+digest lock admits one writer, refuses live owners, and recovers only a dead PID", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-extraction-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paperId = "paper-a";
  const inputDigest = sixtyFour("e");
  const relativePath = extractionRepairLockRelativePath(paperId, inputDigest);

  const contenders = await Promise.allSettled([
    acquireExtractionRepairCandidateLock(root, paperId, inputDigest, {
      token: "11111111-1111-4111-8111-111111111111"
    }),
    acquireExtractionRepairCandidateLock(root, paperId, inputDigest, {
      token: "22222222-2222-4222-8222-222222222222"
    })
  ]);
  const fulfilled = contenders.filter((item) => item.status === "fulfilled");
  const rejected = contenders.filter((item) => item.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one concurrent contender owns the lock");
  assert.equal(rejected.length, 1, "the other concurrent contender fails closed");
  assert.match(rejected[0].reason.message, new RegExp(`locked by active PID ${process.pid}`));
  const first = fulfilled[0].value;
  assert.equal(JSON.parse(await readFile(path.join(root, ...relativePath.split("/")), "utf8")).token, first.owner.token);
  await first.release();

  const deadPid = 2_147_483_000;
  await acquireExtractionRepairCandidateLock(root, paperId, inputDigest, {
    pid: deadPid,
    token: "33333333-3333-4333-8333-333333333333",
    acquiredAt: "2026-01-01T00:00:00.000Z"
  });
  const probed = [];
  const recovered = await acquireExtractionRepairCandidateLock(root, paperId, inputDigest, {
    token: "44444444-4444-4444-8444-444444444444",
    processAlive: (pid) => {
      probed.push(pid);
      return false;
    }
  });
  assert.deepEqual(probed, [deadPid]);
  assert.equal(recovered.recoveredLocks.length, 1);
  const tombstone = recovered.recoveredLocks[0];
  assert.equal(tombstone.pid, deadPid);
  assert.equal(JSON.parse(await readFile(path.join(root, ...tombstone.path.split("/")), "utf8")).pid, deadPid);
  assert.equal(JSON.parse(await readFile(path.join(root, ...relativePath.split("/")), "utf8")).token, recovered.owner.token);
  await recovered.release();
  await assert.rejects(readFile(path.join(root, ...relativePath.split("/"))), { code: "ENOENT" });
});

test("precommit identity comparison fails closed for source, base, QA, spec, runtime, or code drift", () => {
  const context = syntheticContext();
  const expected = extractionRepairIdentitySnapshot(context);
  assert.deepEqual(
    assertExtractionRepairPrecommitIdentity(expected, context, EXTRACTION_REPAIR_CODE_SHA256),
    expected
  );

  const cases = [
    ["sourcePdfSha256", (current) => { current.record.pdf.sha256 = sixtyFour("f"); }],
    ["basePagesSha256", (current) => { current.ledger.stages.extraction.artifacts.pagesSha256 = sixtyFour("f"); }],
    ["selectedExtractionEngine", (current) => { current.ledger.stages.extraction.selectedEngine = "pypdf"; }],
    ["selectedExtractionEngineVersion", (current) => { current.ledger.stages.extraction.selectedEngineVersion = "changed"; }],
    ["extractionQaDecisionSha256", (current) => { current.qa.decisionSha256 = sixtyFour("f"); }],
    ["repairSpecSha256", (current) => { current.spec.sha256 = sixtyFour("f"); }],
    ["runtime", (current) => { current.runtime.pymupdfVersion = "changed"; }]
  ];
  for (const [field, mutate] of cases) {
    const current = structuredClone(context);
    mutate(current);
    assert.throws(
      () => assertExtractionRepairPrecommitIdentity(expected, current, EXTRACTION_REPAIR_CODE_SHA256),
      new RegExp(field)
    );
  }
  assert.throws(
    () => assertExtractionRepairPrecommitIdentity(expected, context, sixtyFour("0")),
    /producerCodeSha256OnDisk/
  );
});

test("visual sidecars are hash-bound and unmapped glyphs keep eligibility closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-extraction-visual-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = syntheticContext();
  const bundle = makeExtractionRepairBundle(context, syntheticGenerated());
  const [requirement] = bundle.candidate.visualEvidence.requirements;
  const cropPath = "research/ledger/extraction-repair-visual-qa/paper-a/crop-page-1.png";
  const cropBytes = Buffer.from("deterministic visual crop", "utf8");
  await mkdir(path.join(root, ...path.dirname(cropPath).split("/")), { recursive: true });
  await writeFile(path.join(root, ...cropPath.split("/")), cropBytes);
  const sidecar = {
    schemaVersion: 1,
    stage: "extractionRepairVisualQa",
    producer: "manual-visual-review-v1",
    paperId: bundle.candidate.paperId,
    sourcePdfSha256: bundle.candidate.sourcePdfSha256,
    basePagesSha256: bundle.candidate.basePagesSha256,
    candidatePagesSha256: bundle.candidate.candidatePagesSha256,
    repairInputDigest: bundle.candidate.repairInputDigest,
    page: requirement.page,
    cropBox: requirement.cropBox,
    bbox: requirement.bbox,
    dpi: 180,
    renderer: { name: "pdftoppm", version: "fixture" },
    cropPath,
    cropSha256: sha256(cropBytes),
    reviewer: "Fixture reviewer",
    outcome: "accepted",
    observation: "Rendered source PDF page 1 visibly confirms that the repaired equality operator and formula order match the source.",
    regions: [{
      type: "formula",
      bbox: requirement.bbox,
      checks: requirement.requiredChecks,
      outcome: "accepted",
      observation: "Rendered source PDF page 1 visibly preserves operators, subscripts, superscripts, delimiters, and reading order."
    }]
  };
  await mkdir(path.join(root, ...path.dirname(requirement.sidecarPath).split("/")), { recursive: true });
  await writeFile(
    path.join(root, ...requirement.sidecarPath.split("/")),
    `${stableStringify(sidecar, 2)}\n`
  );

  const blocked = await inspectExtractionRepairVisualEvidence(root, bundle.candidate);
  assert.equal(blocked.allAffectedPagesAccepted, true);
  assert.equal(blocked.zeroUnmappedGlyphs, false);
  assert.equal(blocked.eligibleForManualAdjudication, false);
  assert.equal(blocked.promotionEligibility, false);
  assert.match(blocked.sidecarBindingSha256, /^[a-f0-9]{64}$/);

  const fullyMappedCandidate = { ...bundle.candidate, unmappedGlyphs: [] };
  const eligible = await inspectExtractionRepairVisualEvidence(root, fullyMappedCandidate);
  assert.equal(eligible.state, "eligible_for_manual_adjudication");
  assert.equal(eligible.eligibleForManualAdjudication, true);
  assert.equal(eligible.promotionEligibility, false, "even complete visual evidence never promotes automatically");

  const tamperedSidecar = { ...sidecar, candidatePagesSha256: sixtyFour("0") };
  await writeFile(path.join(root, ...requirement.sidecarPath.split("/")), `${stableStringify(tamperedSidecar, 2)}\n`);
  const stale = await inspectExtractionRepairVisualEvidence(root, fullyMappedCandidate);
  assert.equal(stale.eligibleForManualAdjudication, false);
  assert.equal(stale.sidecars[0].state, "invalid");
  assert.ok(stale.sidecars[0].errors.includes("candidatePagesSha256_mismatch"));
});

test("v2 worker rejects a selected-engine version that cannot replay production", async () => {
  await assert.rejects(
    runJsonWorker("python", [path.join(projectRoot, "scripts", "extraction-repair-worker.py")], {
      cwd: projectRoot,
      input: JSON.stringify({
        sourcePath: "unused.pdf",
        basePages: [],
        repairSpec: {
          strategy: {
            name: "font-resource-cmap-overlay",
            version: 2,
            resources: [],
            glyphMap: []
          }
        },
        selectedEngine: { name: "pypdf", version: "0.0.0" }
      }),
      maxBuffer: 1024 * 1024
    }),
    /selected_engine_version_mismatch/
  );
});

test("msom.2019.0815 worker maps every exact /Tc22 glyph and composes only the three audited not-equal overlays", async () => {
  const paperId = "doi-10-1287-msom-2019-0815";
  const ledger = JSON.parse(await readFile(path.join(projectRoot, "research", "ledger", "papers", `${paperId}.json`), "utf8"));
  const basePagesPath = ledger.stages.extraction.repairPromotion?.promotionInput?.baseExtraction?.pagesPath
    || ledger.stages.extraction.artifacts.pages;
  const pages = JSON.parse(await readFile(path.join(projectRoot, ...basePagesPath.split("/")), "utf8"));
  const spec = JSON.parse(await readFile(path.join(projectRoot, "research", "extraction-repair-specs", `${paperId}.json`), "utf8"));
  const record = JSON.parse(await readFile(path.join(projectRoot, "research", "corpus", "manifest.v1.json"), "utf8"))
    .records.find((item) => item.id === paperId);
  const stdout = await runJsonWorker("python", [path.join(projectRoot, "scripts", "extraction-repair-worker.py")], {
    cwd: projectRoot,
    input: JSON.stringify({
      sourcePath: path.join(projectRoot, ...record.pdf.path.split("/")),
      basePages: pages.pages,
      repairSpec: spec
    }),
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true
  });
  const result = JSON.parse(stdout);
  assert.equal(result.mappedGlyphProvenance.length, 389);
  assert.deepEqual(result.observedGlyphs.map((item) => item.originalCharCodeHex), ["21", "22", "23", "24", "25", "26", "27", "28"]);
  assert.deepEqual(result.observedGlyphs.map((item) => item.glyphName), [
    "/equals", "/minus", "/greaterequal", "/lessequal", "/element", "/negationslash", "/infinity", "/prime"
  ]);
  assert.deepEqual(result.observedGlyphs.map((item) => item.count), [146, 157, 45, 19, 16, 3, 1, 2]);
  assert.equal(result.unmappedGlyphs.length, 0);
  assert.ok(result.mappedGlyphProvenance.every((item) => (
    item.fontResourceTag === "/Tc22"
    && item.fontStreamSha256 === "2280410f95eb3f76b1ccc0a7530f4522e3e276335381467935db53fbfbb0a2ea"
  )));
  const mappedEvents = result.glyphEvents.filter((item) => item.mappingStatus === "mapped");
  const unmappedEvents = result.glyphEvents.filter((item) => item.mappingStatus === "unmapped");
  assert.equal(mappedEvents.length, 389);
  assert.equal(unmappedEvents.length, 0);
  assert.ok(mappedEvents.every((item) => (
    Array.isArray(item.bbox)
    && item.bbox.length === 4
    && item.bbox.every(Number.isFinite)
    && Number.isInteger(item.renderCharacterOffset)
    && Number.isInteger(item.candidateTextUnicodeScalarOffset)
    && typeof item.baseExtractedCharacter === "string"
    && typeof item.candidateCharacter === "string"
  )), "every replacement event binds the exact renderer character bbox and text/render offsets");
  assert.equal(mappedEvents.filter((item) => item.mappingMode === "verified-noop").length, 240);
  assert.equal(mappedEvents.filter((item) => item.mappingKind === "simple").length, 383);
  assert.equal(mappedEvents.filter((item) => item.mappingKind === "composite-component").length, 6);
  const provenanceBySourceEvent = new Map(result.mappedGlyphProvenance.map((item) => [
    [item.page, item.contentOperatorIndex, item.stringOperandIndex, item.byteOffset].join("|"),
    item
  ]));
  assert.ok(mappedEvents.every((item) => {
    const provenance = provenanceBySourceEvent.get(
      [item.page, item.contentOperatorIndex, item.stringOperandIndex, item.byteOffset].join("|")
    );
    return provenance
      && stableStringify(provenance.bbox) === stableStringify(item.bbox)
      && provenance.renderCharacterOffset === item.renderCharacterOffset
      && provenance.candidateTextUnicodeScalarOffset === item.candidateTextUnicodeScalarOffset;
  }), "glyphEvents and mappedGlyphProvenance bind the same replacement geometry");
  assert.equal(validateGeneratedRepairEvidence(result, spec.strategy.glyphMap, spec.strategy.compositeGlyphMap), true);
  assert.deepEqual(
    result.compositeGlyphProvenance.map((item) => [
      item.page,
      item.components[0].contentOperatorIndex,
      item.components[1].contentOperatorIndex,
      item.contentOperatorGap,
      item.textMatrixOriginDelta,
      item.standardTextSequence,
      item.replacementText
    ]),
    [
      [8, 682, 687, 5, [0.1704, 0], "̸ =", " ≠"],
      [8, 1056, 1061, 5, [0.1704, 0], "̸ =", " ≠"],
      [14, 2807, 2812, 5, [0.1704, 0], "̸ =", " ≠"]
    ]
  );
  for (const occurrence of result.compositeGlyphProvenance) {
    assert.equal(occurrence.unicode, "≠");
    assert.equal(occurrence.components[0].role, "overlay");
    assert.equal(occurrence.components[0].fontAdvanceWidth, 0);
    assert.equal(occurrence.components[1].role, "anchor");
    assert.ok(occurrence.components.every((component) => (
      Array.isArray(component.bbox)
      && component.bbox.length === 4
      && component.bbox.every(Number.isFinite)
      && Array.isArray(component.textMatrix)
      && component.textMatrix.length === 6
    )));
  }
  const page8 = result.candidatePages[7].text;
  const page14 = result.candidatePages[13].text;
  assert.equal((page8.match(/≠/gu) || []).length, 2);
  assert.equal((page14.match(/≠/gu) || []).length, 1);
  assert.equal(result.candidatePages.some((page) => page.text.includes("̸ =") || page.text.includes("̸")), false);
  assert.match(page8, /i ≠ j/);
  assert.match(page14, /i ≠ j/);
  const changedPages = result.visualReviewRequirements.map((item) => item.page);
  assert.deepEqual(changedPages, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(result.visualReviewRequirements.find((item) => item.page === 8).requiredChecks, [
    "operators", "subscripts", "superscripts", "delimiters", "order", "signs", "geometry"
  ]);
});

test("msom.2019.0815 composite repair fails closed when an occurrence matrix drifts", async () => {
  const paperId = "doi-10-1287-msom-2019-0815";
  const ledger = JSON.parse(await readFile(path.join(projectRoot, "research", "ledger", "papers", `${paperId}.json`), "utf8"));
  const basePagesPath = ledger.stages.extraction.repairPromotion?.promotionInput?.baseExtraction?.pagesPath
    || ledger.stages.extraction.artifacts.pages;
  const pages = JSON.parse(await readFile(path.join(projectRoot, ...basePagesPath.split("/")), "utf8"));
  const spec = JSON.parse(await readFile(path.join(projectRoot, "research", "extraction-repair-specs", `${paperId}.json`), "utf8"));
  spec.strategy.compositeGlyphMap[0].expectedOccurrences[0].overlayTextMatrix[4] += 1;
  const record = JSON.parse(await readFile(path.join(projectRoot, "research", "corpus", "manifest.v1.json"), "utf8"))
    .records.find((item) => item.id === paperId);
  await assert.rejects(
    runJsonWorker("python", [path.join(projectRoot, "scripts", "extraction-repair-worker.py")], {
      cwd: projectRoot,
      input: JSON.stringify({
        sourcePath: path.join(projectRoot, ...record.pdf.path.split("/")),
        basePages: pages.pages,
        repairSpec: spec
      }),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    }),
    /composite_expected_text_matrix_mismatch/
  );
});
