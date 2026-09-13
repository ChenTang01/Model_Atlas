import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUDIT_VERSION,
  assertCurrentPdfFiles,
  auditCliShouldFail,
  auditStages as auditStagesWithBinding,
  fullCorpusAuditRequested,
  miniParityReleaseIssues,
  miniReadingStages as miniReadingStagesWithBinding,
  noteMetrics,
  parseCli,
  prerequisiteAuditCurrent as prerequisiteAuditCurrentWithBinding,
  releaseBuildStage as releaseBuildStageWithBinding,
  selectRecords,
} from "../scripts/audit-model-notes.mjs";
import {
  canonicalizeMathNotation,
  formalStructureIssue,
  formulaContaminatedProse,
  noteFormalStructureIssues,
  standaloneFormulaLine
} from "../scripts/model-note-formula-quality.mjs";
import { run as authorModelNotes } from "../scripts/author-model-notes.mjs";
import {
  EXTRACTION_POLICY,
  EXTRACTOR_CODE_SHA256,
  extractionCorruptionProfile,
  stableStringify
} from "../scripts/corpus-pipeline.mjs";
import { reviewExtractions, verifyExtractionQaCheckpoint } from "../scripts/extraction-qa.mjs";
import { modelNoteExtractionQaCheckpointBinding } from "../scripts/model-note-extraction-qa.mjs";
import {
  SAFE_MAP_REVIEW_VERSION,
  SAFE_MAP_SCHEMA_VERSION,
  SAFE_MAP_VERSION,
  VISUAL_SCOPE_REPORT_PATH,
  safeMapRelativePath
} from "../scripts/model-note-safe-map.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");

const ledger = {
  paperId: "paper-1",
  pdfSha256: "a".repeat(64),
  stages: {
    extraction: {
      status: "complete",
      inputDigest: "1".repeat(64),
      sourcePdfSha256: "a".repeat(64),
      artifacts: { pagesSha256: "b".repeat(64) }
    },
    extractQa: {
      status: "complete",
      inputDigest: "1".repeat(64),
      sourcePdfSha256: "a".repeat(64)
    },
  },
};

const semantic = { metrics: { checked: 1 }, warnings: [] };
const qaBinding = {
  extractionQaStatus: "complete",
  extractionQaAutomatedStatus: "complete",
  extractionQaInputDigest: "6".repeat(64),
  extractionQaDecisionPath: "research/ledger/extraction-qa/paper-1/decision.json",
  extractionQaDecisionSha256: "7".repeat(64),
  extractionQaAdjudicationStatus: "not_required",
  extractionQaAdjudicationPath: null,
  extractionQaAdjudicationSha256: null
};
const needsReviewQaBinding = {
  ...qaBinding,
  extractionQaStatus: "needs_review",
  extractionQaAutomatedStatus: "needs_review",
  extractionQaAdjudicationStatus: "pending",
  extractionQaAdjudicationPath: "research/ledger/extraction-qa-adjudications/paper-1.json"
};
const auditStages = (args) => auditStagesWithBinding({ ...args, qaBinding });
const miniReadingStages = (value) => miniReadingStagesWithBinding(value, qaBinding);
const prerequisiteAuditCurrent = (value, conceptDigest, paperDigest, binding = qaBinding) => (
  prerequisiteAuditCurrentWithBinding(value, conceptDigest, paperDigest, binding)
);
const releaseBuildStage = (value, args) => releaseBuildStageWithBinding(value, { ...args, qaBinding });

test("candidate-only audit mode is explicit and cannot promote through check mode", () => {
  const options = parseCli(["--candidate-only", "--jobs", "3"]);
  assert.equal(options.candidateOnly, true);
  assert.equal(options.check, false);
  assert.equal(options.jobs, 3);
  assert.throws(() => parseCli(["--candidate-only", "--check"]), /cannot be combined/);
  assert.throws(() => parseCli(["--candidate-only", "--limit", "1"]), /cannot be combined/);
});

test("only an explicit unbounded public audit can reach promotion and rejected promotion exits nonzero", () => {
  const full = parseCli(["--jobs", "3"]);
  const bounded = [
    parseCli(["--paper", "paper-1"]),
    parseCli(["--from", "paper-1"]),
    parseCli(["--limit", "1"])
  ];
  assert.equal(fullCorpusAuditRequested(full), true);
  assert.ok(bounded.every((options) => fullCorpusAuditRequested(options) === false));
  assert.equal(auditCliShouldFail(full, { releaseReady: false }), true);
  assert.equal(auditCliShouldFail(full, { releaseReady: true }), false);
  assert.equal(auditCliShouldFail(parseCli(["--candidate-only"]), { releaseReady: false }), false);
  assert.equal(auditCliShouldFail(parseCli(["--check"]), { releaseReady: false }), false);
});

function component(id, formalKind, { symbols = [], conditions = [], bindingStatus = "modeled", page = 1, section = "Base Model", formal = "" } = {}) {
  return {
    id,
    formalKind,
    formal: formal || (formalKind === "Source-extracted equation (not visually verified)"
      ? "q = min{K, F^{-1}(c)}"
      : "Decision rule: choose a supported feasible action."),
    symbols,
    conditions,
    sources: [{ page, section, quote: "A literal source sentence." }],
    conceptBindings: [{ conceptId: "optimization", status: bindingStatus }],
  };
}

function model(id, method, setup, components, { page = 1, section = "Base Model" } = {}) {
  return {
    id,
    method,
    ...setup,
    sources: [{ page, section, quote: "A literal model source sentence." }],
    components,
  };
}

function sourceMappedNote() {
  return {
    id: "paper-1",
    models: [
      model("base", "Solve the baseline dynamic program.", {
        objects: ["Retailer"],
        inputs: ["Demand"],
        decisions: ["Order quantity"],
        assumptions: ["Demand is independent"],
      }, [
        component("objective", "Source-extracted equation (not visually verified)", {
          symbols: [{ symbol: "q", meaning: "order quantity" }],
          conditions: ["Capacity is fixed."],
        }),
      ]),
      model("extension", "Solve the baseline dynamic program.", {
        objects: [],
        inputs: ["Demand"],
        decisions: ["Order quantity"],
        assumptions: [],
        setupMaturity: { objects: "unresolved", inputs: "source-derived", decisions: "source-derived", assumptions: "unresolved" },
      }, [
        component("extension-rule", "Atlas restatement of source rule", {
          bindingStatus: "unknown",
          page: 2,
          section: "Capacity Extension",
        }),
      ], { page: 2, section: "Capacity Extension" }),
    ],
  };
}

function automatedReleaseNote({
  formalKind = "Atlas normalized notation",
  formal = "0 <= q <= K",
  symbols = [{ symbol: "q", meaning: "Retailer order quantity" }],
  conditions = ["The order quantity q cannot exceed available inventory capacity."]
} = {}) {
  return {
    id: "automated-release-note",
    question: "How should a retailer choose an order quantity under limited inventory capacity?",
    provenance: { sourceTier: "full-source-section-map" },
    models: [{
      id: "inventory-model",
      method: "Solve the retailer's capacity-constrained inventory optimization problem.",
      objects: ["Retailer"],
      inputs: ["Demand distribution"],
      decisions: ["Choose order quantity q"],
      assumptions: ["Patients arrive according to a Poisson process."],
      sources: [{
        page: 1,
        section: "Inventory model",
        equation: "",
        quote: "The retailer chooses an order quantity subject to available inventory capacity."
      }],
      components: [{
        id: "order-quantity",
        label: "Capacity-constrained order quantity",
        role: "decision",
        concepts: ["inventory-control"],
        explanation: "The retailer selects order quantity q without exceeding the available inventory capacity.",
        searchPhrases: ["inventory order quantity", "capacity constrained order", "retailer inventory decision"],
        formal,
        formalKind,
        symbols,
        conditions,
        sources: [{
          page: 1,
          section: "Inventory model",
          equation: "",
          quote: "The retailer chooses an order quantity subject to available inventory capacity."
        }],
        conceptBindings: [{
          conceptId: "inventory-control",
          status: "modeled",
          representation: "The retailer's order quantity is bounded by its available inventory capacity.",
          conditionRefs: [0],
          sourceRefs: [{ scope: "component", index: 0 }],
          reviewStatus: "automated-source-map"
        }]
      }]
    }]
  };
}

test("release parity is pinned to universal frozen Mini structure without imposing incidental cardinalities", async () => {
  const miniBatches = await Promise.all(["a", "b", "c"].map(async (batch) => JSON.parse(await readFile(
    new URL(`../mini-atlas/data/notes/batch-${batch}.json`, import.meta.url),
    "utf8"
  ))));
  const papers = miniBatches.flatMap((batch) => batch.papers);
  const models = papers.flatMap((paper) => paper.models);
  const components = models.flatMap((model) => model.components);
  const bindings = components.flatMap((component) => component.conceptBindings);

  assert.equal(papers.length, 30);
  assert.equal(models.length, 38);
  assert.equal(components.length, 134);
  assert.equal(bindings.length, 285);
  assert.equal(bindings.filter((binding) => binding.status === "modeled").length, 270);
  assert.equal(bindings.filter((binding) => binding.status === "explicitlyExcluded").length, 15);
  const symbolLessComponents = components.filter((component) => component.symbols.length === 0);
  assert.equal(symbolLessComponents.length, 2,
    "symbols are not universally nonempty and must not become a release cardinality gate");
  assert.ok(symbolLessComponents.every((component) => component.formalKind === "Atlas restatement of source rule"),
    "only explicit verbal Mini components omit symbol definitions");

  for (const paper of papers) {
    assert.deepEqual(miniParityReleaseIssues(paper), [], paper.id);

    const mutated = structuredClone(paper);
    let mathematicalComponent;
    for (const model of mutated.models) {
      mathematicalComponent = model.components.find((component) => component.formalKind !== "Atlas restatement of source rule");
      if (mathematicalComponent) break;
    }
    assert.ok(mathematicalComponent, `${paper.id}: expected a mathematical component fixture`);
    mathematicalComponent.symbols = [];
    assert.ok(
      miniParityReleaseIssues(mutated).some((entry) => entry.code === "component.symbols.mathematical-definition"),
      `${paper.id}: missing mathematical symbols must block release`
    );

    const nounPhraseCondition = structuredClone(paper);
    nounPhraseCondition.models[0].components[0].conditions[0] = "Retail inventory demand capacity policy.";
    assert.ok(
      miniParityReleaseIssues(nounPhraseCondition).some((entry) => entry.code === "component.condition.not-predicate"),
      `${paper.id}: a noun-phrase condition must block release`
    );
  }

  const curatedEnvelope = JSON.parse(await readFile(
    new URL("../data/notes/papers/doi-10-1287-mnsc-2021-4216.json", import.meta.url),
    "utf8"
  ));
  assert.equal(
    curatedEnvelope.note.models.flatMap((model) => model.components)
      .flatMap((component) => component.conceptBindings)
      .filter((binding) => binding.status === "backgroundOnly").length,
    1
  );
  assert.deepEqual(miniParityReleaseIssues(curatedEnvelope.note), [],
    "the source-grounded curated backgroundOnly label remains release eligible");

  const expectIssue = (name, mutate, code) => {
    const note = structuredClone(papers[0]);
    mutate(note);
    const issues = miniParityReleaseIssues(note);
    assert.ok(issues.some((entry) => entry.code === code), `${name}: ${JSON.stringify(issues)}`);
  };
  for (const field of ["objects", "inputs", "decisions", "assumptions"]) {
    expectIssue(`empty ${field}`, (note) => { note.models[0][field] = []; }, "model.setup.nonempty");
  }
  expectIssue("empty conditions", (note) => { note.models[0].components[0].conditions = []; }, "component.conditions.nonempty");
  expectIssue("empty concepts", (note) => { note.models[0].components[0].concepts = []; }, "component.concepts.nonempty");
  expectIssue("empty bindings", (note) => { note.models[0].components[0].conceptBindings = []; }, "component.concept-bindings.nonempty");
  expectIssue("component without a modeled binding", (note) => {
    for (const binding of note.models[0].components[0].conceptBindings) binding.status = "backgroundOnly";
  }, "component.modeled-binding.nonempty");
  expectIssue("unresolved binding", (note) => { note.models[0].components[0].conceptBindings[0].status = "unknown"; }, "binding.status.release-ineligible");
  expectIssue("binding without sources", (note) => { note.models[0].components[0].conceptBindings[0].sourceRefs = []; }, "binding.source-refs.nonempty");
  expectIssue("binding without conditions", (note) => { note.models[0].components[0].conceptBindings[0].conditionRefs = []; }, "binding.condition-refs.nonempty");

  const oneEntryPerSetupField = structuredClone(papers[0]);
  for (const model of oneEntryPerSetupField.models) {
    for (const field of ["objects", "inputs", "decisions", "assumptions"]) model[field] = [model[field][0]];
  }
  assert.deepEqual(miniParityReleaseIssues(oneEntryPerSetupField), [],
    "the release gate requires nonempty setup, not Mini's incidental field cardinalities");
});

test("release parity requires valid symbols for mathematical formals and permits explicit verbal rules", () => {
  assert.deepEqual(miniParityReleaseIssues(automatedReleaseNote()), []);

  for (const formalKind of ["Atlas normalized notation", "Source-extracted equation (not visually verified)"]) {
    const missing = automatedReleaseNote({ formalKind, symbols: [] });
    assert.ok(miniParityReleaseIssues(missing).some((entry) => entry.code === "component.symbols.mathematical-definition"), formalKind);

    const malformed = automatedReleaseNote({
      formalKind,
      symbols: [{ symbol: "q)", meaning: "Retailer order quantity" }]
    });
    assert.ok(miniParityReleaseIssues(malformed).some((entry) => entry.code === "component.symbols.mathematical-definition"), formalKind);

    const undefinedMeaning = automatedReleaseNote({
      formalKind,
      symbols: [{ symbol: "q", meaning: " " }]
    });
    assert.ok(miniParityReleaseIssues(undefinedMeaning).some((entry) => entry.code === "component.symbols.mathematical-definition"), formalKind);
  }

  const verbal = automatedReleaseNote({
    formalKind: "Atlas restatement of source rule",
    formal: "Choose a feasible order quantity under the cited capacity rule.",
    symbols: []
  });
  assert.equal(
    miniParityReleaseIssues(verbal).some((entry) => entry.code === "component.symbols.mathematical-definition"),
    false
  );

  for (const formal of ["q = min(K, D)", "max_q R(q)", "R(q)", "q_t^*"]) {
    const mislabeledMathematicalFormal = automatedReleaseNote({
      formalKind: "Atlas restatement of source rule",
      formal,
      symbols: []
    });
    assert.ok(
      miniParityReleaseIssues(mislabeledMathematicalFormal)
        .some((entry) => entry.code === "component.symbols.mathematical-definition"),
      `${formal}: mathematical content cannot bypass symbol validation through a legacy verbal formalKind label`
    );
  }
});

test("release parity rejects terse, nonpredicate, and setup-only inherited conditions", () => {
  const issueCodes = (note) => miniParityReleaseIssues(note).map((entry) => entry.code);

  assert.ok(issueCodes(automatedReleaseNote({ conditions: ["Inventory."] }))
    .includes("component.condition.not-substantive"));
  assert.ok(issueCodes(automatedReleaseNote({ conditions: ["Retail inventory demand capacity policy."] }))
    .includes("component.condition.not-predicate"));
  const sourceDefinition = automatedReleaseNote({
    conditions: ["We denote the retailer's maximum inventory capacity by m1."]
  });
  assert.equal(issueCodes(sourceDefinition).includes("component.condition.not-predicate"), false,
    "a source-definition predicate explicitly admitted by authoring must remain a predicate at release audit");
  const explicitDecision = automatedReleaseNote({
    conditions: ["We now consider the case where the firm decides on a launch policy in advance and announces it to the consumer market."]
  });
  assert.equal(issueCodes(explicitDecision).includes("component.condition.not-predicate"), false,
    "a paper-owned decision and announcement admitted by authoring must remain a predicate at release audit");
  assert.ok(issueCodes(automatedReleaseNote({
    conditions: ["Denotation of the retailer's maximum inventory capacity parameter."]
  })).includes("component.condition.not-predicate"),
  "a definition-themed noun phrase cannot use the bounded authoring predicate grammar as a bypass");
  const inheritedSetup = automatedReleaseNote({ conditions: ["Patients arrive according to a Poisson process."] });
  const component = inheritedSetup.models[0].components[0];
  component.sources.push({
    page: 1,
    section: "Arrival assumptions",
    equation: "",
    quote: "Patients arrive according to a Poisson process."
  });
  component.conceptBindings[0].sourceRefs = [{ scope: "component", index: 1 }];
  assert.ok(issueCodes(inheritedSetup).includes("component.condition.no-local-support"),
    "a legacy setup-value copy cannot manufacture relevance by reattaching its source");
  component.conditionEvidence = [{
    conditionIndex: 0,
    inheritedFromSetupField: "assumptions",
    setupEvidence: {
      value: "Patients arrive according to a Poisson process.",
      source: component.sources[1]
    }
  }];
  assert.ok(issueCodes(inheritedSetup).includes("component.condition.no-local-support"),
    "explicit setup inheritance also requires component-local lexical support");

  const sourceGrounded = automatedReleaseNote({
    conditions: ["The retailer chooses an order quantity subject to available inventory capacity."]
  });
  assert.deepEqual(miniParityReleaseIssues(sourceGrounded), []);

  const arbitraryDeclarativeVerb = automatedReleaseNote({
    conditions: ["The retailer prioritizes inventory capacity across customer segments."]
  });
  assert.deepEqual(miniParityReleaseIssues(arbitraryDeclarativeVerb), [],
    "predicate detection must accept ordinary source prose without a closed verb whitelist");

  const inflectedLocalVerb = automatedReleaseNote({
    conditions: ["The seller brushes only when cumulative sales are tied."]
  });
  inflectedLocalVerb.models[0].components[0].label = "Dynamic brushing";
  inflectedLocalVerb.models[0].components[0].explanation = "The model studies a dynamic brushing decision.";
  assert.deepEqual(miniParityReleaseIssues(inflectedLocalVerb), [],
    "ordinary -es and -ing forms of the same local verb must share a relevance stem");
});

test("release parity blocks generic bindings and substantive clones without banning shared local evidence", () => {
  const genericBinding = automatedReleaseNote();
  const binding = genericBinding.models[0].components[0].conceptBindings[0];
  binding.mappingBasis = "component-role";
  binding.representation = "The decision documented in Inventory model is classified under Inventory control through the component's local source anchor.";
  assert.ok(miniParityReleaseIssues(genericBinding)
    .some((entry) => entry.code === "binding.representation.generic-role"));

  const repeatedCondition = automatedReleaseNote();
  repeatedCondition.models[0].components.push(structuredClone(repeatedCondition.models[0].components[0]));
  repeatedCondition.models[0].components[1].id = "second-order-quantity";
  repeatedCondition.models[0].components[1].label = "Renamed copy of the order decision";
  repeatedCondition.models[0].components[1].searchPhrases = ["renamed order copy", "copied inventory rule", "duplicate decision content"];
  const duplicateIssues = miniParityReleaseIssues(repeatedCondition).map((entry) => entry.code);
  assert.ok(duplicateIssues.includes("component.semantic-duplicate"));
  assert.equal(duplicateIssues.includes("component.condition.reused"), false);
  assert.equal(duplicateIssues.includes("component.source-anchor.reused"), false);

  const sharedEvidence = automatedReleaseNote();
  const decision = sharedEvidence.models[0].components[0];
  const sharedQuote = "The retailer chooses an order quantity to maximize profit subject to available inventory capacity.";
  decision.sources[0].quote = sharedQuote;
  const objective = structuredClone(decision);
  objective.id = "profit-objective";
  objective.label = "Capacity-constrained profit objective";
  objective.role = "objective";
  objective.explanation = "The retailer maximizes profit over order quantities that satisfy its available inventory capacity.";
  objective.searchPhrases = ["inventory profit objective", "capacity feasible profit", "retailer objective function"];
  objective.formal = "Objective rule: maximize profit over capacity-feasible order quantities.";
  objective.formalKind = "Atlas restatement of source rule";
  objective.symbols = [];
  objective.concepts = ["optimization"];
  objective.conceptBindings = [{
    conceptId: "optimization",
    status: "modeled",
    representation: "The retailer maximizes profit over the capacity-feasible order quantities.",
    conditionRefs: [0],
    sourceRefs: [{ scope: "component", index: 0 }],
    reviewStatus: "automated-source-map"
  }];
  sharedEvidence.models[0].components.push(objective);
  assert.deepEqual(miniParityReleaseIssues(sharedEvidence), [],
    "distinct components may reuse a genuinely applicable condition and multifunction source sentence");

  const repeatedVariant = automatedReleaseNote();
  const variant = structuredClone(repeatedVariant.models[0]);
  variant.id = "inventory-extension";
  repeatedVariant.models.push(variant);
  const variantIssues = miniParityReleaseIssues(repeatedVariant).map((entry) => entry.code);
  assert.ok(variantIssues.includes("model.variant.no-substantive-delta"));
});

test("formal structure requires canonical Greek notation and accepts valid half-open intervals", () => {
  const kind = "Source-extracted equation (not visually verified)";
  assert.equal(formalStructureIssue("lambda_j^* = argmax_{x in [0,1)} p_j(lambda_j)", kind), "contains bare named Greek notation");
  assert.equal(formalStructureIssue("vartheta_j^* = argmax_{x in [0,1)} p_j(varrho_j)", kind), "contains bare named Greek notation");
  assert.equal(
    formalStructureIssue("Affordable set = {i: pᵢ ≤ m}; choose i maximizing WTPᵢ(θ) − pᵢ or take outside utility 0.", "Atlas normalized notation"),
    "",
    "NFKC must not flatten pᵢ into the named Greek token pi before lexical validation"
  );
  assert.equal(
    canonicalizeMathNotation("$lambda_j^* = argmax_{x in [0,1)} p_j(λ_j)$"),
    "\\lambda_j^* = argmax_{x in [0,1)} p_j(\\lambda_j)"
  );
  assert.equal(formalStructureIssue("$\\lambda_j$", kind), "contains a raw $ math delimiter");
  assert.equal(formalStructureIssue("\\(\\lambda_j\\)", kind), "contains a raw TeX math wrapper");
  assert.equal(formalStructureIssue("®\\theta \\in \\Theta_1", kind), "contains PDF extraction noise");
  assert.equal(formalStructureIssue("s_i\\in\\{O,B\\}", kind), "");
  assert.equal(formalStructureIssue("R^B(\\alpha) has slope in (-1, 0]", "Atlas normalized notation"), "");
  assert.equal(formalStructureIssue("x\\in[0,1)", kind), "");
  assert.equal(formalStructureIssue("[D-q]^+", kind), "");
  assert.equal(formalStructureIssue("[D-q]_-", kind), "");
});

test("standalone display detection covers relation glyphs, optimization rows, constraints, and named Greek variants", () => {
  const displayLines = [
    "x_t ≡ f(x_{t-1},a_t).",
    "x_t ≈ f(x_{t-1},a_t).",
    "x_t ← f(x_{t-1},a_t).",
    "max_q R(q)",
    "subject to c(q) <= B.",
    "vartheta_j = alpha_j + beta_j (3).",
    "where i n v(F)(x)¢i n f{y: F(y) ≥ x} for all x ∈ R. Let U (S)"
  ];
  for (const line of displayLines) {
    assert.equal(standaloneFormulaLine(line), true, line);
    assert.equal(formulaContaminatedProse(`A recovered source sentence absorbs ${line}`, [line]), true, line);
  }
  assert.equal(standaloneFormulaLine("The model sets q equal to one before demand arrives."), false);
  for (const [line, prose] of [
    [", ˆα , 0) < G(r", "Because G(r d , ˆα , 0) < G(r d , 0, ˆα ) only one case occurs."],
    ["> 0 and c", "Patients incur holding cost h > 0 and copayment c > 0."],
    ["j∈J", "The allocation requires P j∈J i x j ≥ 1."],
    ["ˆm =1", "The term 1 ⊤ ˆm =1 ⊤ m captures availability."],
    ["β > β (αk),", "A cycle occurs when β > β (αk), and incentives differ."],
    ["<", "Demand is < capacity."],
    ["max", "The planner maximizes reward."]
  ]) assert.equal(formulaContaminatedProse(prose, [line], { conservative: true }), false, line);
});

test("formal structure rejects unbalanced grouping and clipped mathematical boundaries", () => {
  const kind = "Source-extracted equation (not visually verified)";
  assert.match(formalStructureIssue("p_j(lambda_j] = 0", kind), /mismatched delimiters/);
  assert.match(formalStructureIssue("q = min{K, F^{-1}(c)", kind), /unclosed delimiter/);
  assert.match(formalStructureIssue(") <= 0; there is a number of issues x", "Atlas normalized notation"), /unexpected closing delimiter/);
  assert.equal(formalStructureIssue("<= lambda_j", kind), "starts with a dangling operator");
  assert.equal(formalStructureIssue("lambda_j =", kind), "ends with a dangling operator");
  assert.equal(formalStructureIssue("\\leq x", kind), "starts with a dangling operator");
  assert.equal(formalStructureIssue("− q", kind), "starts with a dangling operator");
  assert.equal(formalStructureIssue("⊆ X", kind), "starts with a dangling operator");
  assert.equal(formalStructureIssue("x \\leq", kind), "ends with a dangling operator");
});

test("formal structure rejects source fragments, equation-label-masked boundaries, and unmatched math dollars", () => {
  const kind = "Source-extracted equation (not visually verified)";
  for (const fragment of [
    "where δ ≥ 0.",
    "where σ ≤ 0 and",
    "where HkT =∑T",
    "where ì = 1",
    "{}, or (iii) c ≥ coi. Otherwise",
    "where q ∈{ 1=n, n ∈ N}.",
    "where i n v(F)(x)¢i n f{y: F(y) ≥ x} for all x ∈ R. Let U (S)",
    "in the set, i.e., pa = epa/fpA.",
    "in x. For x ≤ x"
  ]) assert.match(formalStructureIssue(fragment, kind), /starts with/iu, fragment);

  for (const fragment of [
    "x ̃xd ̃x =v−",
    "min Ef [h(X, Y)] = E0[h(X, Y)] −",
    "p∗(Λ1)≥ R −",
    "θ,σ(T) = θ∗ · T −",
    "q^*=x and"
  ]) assert.match(formalStructureIssue(fragment, kind), /ends with/iu, fragment);

  assert.equal(formalStructureIssue("q^*=min{K,F^{-1}(c)}^ (3)", kind), "ends with a dangling operator");
  assert.equal(formalStructureIssue("q^*=min{K,F^{-1}(c)}_ (3)", kind), "ends with a dangling operator");
  assert.equal(formalStructureIssue("q^*=min{K,F^{-1}(c)} \\ (3)", kind), "ends with an incomplete TeX command");
  assert.equal(formalStructureIssue("q^*=min{K,F^{-1}(c)} \\leq (3)", kind), "ends with a dangling operator");
  assert.equal(formalStructureIssue("q^*=$min{K,F^{-1}(c)} (3)", kind), "unmatched math delimiter $");
  assert.equal(formalStructureIssue("$q^*=min{K,F^{-1}(c)}$ (3)", kind), "contains a raw $ math delimiter");
  assert.equal(formalStructureIssue("Process relation: Capacity costs $500 per day.", "Atlas restatement of source rule"), "");
});

test("verbal rules distinguish complete domain notation, references, currency, and raw TeX delimiters", () => {
  const verbal = "Atlas restatement of source rule";
  const strict = "Source-extracted equation (not visually verified)";
  assert.equal(formalStructureIssue("Objective relation: Recall that the policy is some subset of R+.", verbal), "");
  assert.equal(formalStructureIssue("Process relation: T belongs to N + .", verbal), "");
  assert.equal(formalStructureIssue("Process relation: T belongs to \\mathbb{N}+.", verbal), "");
  assert.equal(formalStructureIssue("Strategic response: The first-order conditions are Equations (3)-(5).", verbal), "");
  assert.equal(formalStructureIssue("Process relation: Costs are $1.25 and $3.50 per unit.", verbal), "");
  assert.equal(formalStructureIssue("Process relation: The rate is $/unit and the budget is $W.", verbal), "");
  assert.equal(formalStructureIssue("Process relation: See https://example.test/$value/path/ .", verbal), "");
  assert.equal(
    formalStructureIssue("Process relation: Compare $q$ with capacity.", verbal),
    "contains a raw $ math delimiter"
  );
  assert.equal(formalStructureIssue("Process relation: Pay \\$500.", verbal), "");
  assert.equal(formalStructureIssue("Process relation: profit +", verbal), "ends with a dangling operator");
  assert.equal(formalStructureIssue("q=x+", strict), "ends with a dangling operator");
  assert.equal(formalStructureIssue("Process relation: cost $500 but raw $lambda remains.", verbal), "unmatched math delimiter $");
  assert.equal(formalStructureIssue("Process relation: raw $lambda remains.", verbal), "unmatched math delimiter $");
  assert.equal(formalStructureIssue("q = x - (5)", strict), "ends with a dangling operator");
  assert.equal(formalStructureIssue("q = x - (5)", verbal), "ends with a dangling operator");
});

test("conservative contamination recognizes wrapped inline subscript continuations", () => {
  const quote = "Without loss of generality, we index the products in the increasing order of their selling prices so that p 1 < p2 < ⋯ < pm.";
  const lines = [
    "Without loss of generality, we index",
    "the products in the increasing order of their selling",
    "prices so that p",
    "1 < p2 < ⋯ < pm."
  ];
  assert.equal(formulaContaminatedProse(quote, lines, { conservative: true }), false);
  assert.equal(formulaContaminatedProse(
    "Denote the planning vector by dt = (dt,...,d t+H−1). (6) We assume that backlog is met by slow orders.",
    ["Denote the planning vector by", "dt = (dt,...,d t+H−1). (6)", "We assume that backlog is met by slow orders."],
    { conservative: true }
  ), true);
});

test("formula audit cannot complete for malformed formal content", () => {
  const note = sourceMappedNote();
  note.models[0].components[0].formal = "q = min{K, F^{-1}(c)";
  const issues = noteFormalStructureIssues(note);
  assert.equal(issues.length, 1);
  assert.match(issues[0].path, /models\[0\]\.components\[0\]\.formal/);
  assert.throws(() => auditStages({
    ledger,
    note,
    noteSha256: "c".repeat(64),
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    semantic,
  }), /formal-structure audit failed.*unclosed delimiter/i);
});

test("formula audit cannot complete for malformed symbol content", () => {
  const note = sourceMappedNote();
  note.models[0].components[0].symbols = [{ symbol: "q)", meaning: "order quantity" }];
  const issues = noteFormalStructureIssues(note);
  assert.equal(issues.length, 1);
  assert.match(issues[0].path, /models\[0\]\.components\[0\]\.symbols\[0\]\.symbol/);
  assert.throws(() => auditStages({
    ledger,
    note,
    noteSha256: "c".repeat(64),
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    semantic,
  }), /formal-structure audit failed.*unexpected closing delimiter/i);
});

test("content metrics expose setup, formal, binding, and variant maturity", () => {
  const metrics = noteMetrics(sourceMappedNote());
  assert.deepEqual({
    setupFieldsTotal: metrics.setupFieldsTotal,
    setupFieldsPopulated: metrics.setupFieldsPopulated,
    setupFieldsCovered: metrics.setupFieldsCovered,
    setupFieldsUnresolved: metrics.setupFieldsUnresolved,
    sourceExtractedEquations: metrics.sourceExtractedEquations,
    verbalRestatements: metrics.verbalRestatements,
    componentsWithSymbols: metrics.componentsWithSymbols,
    componentsWithoutSymbols: metrics.componentsWithoutSymbols,
    componentsWithConditions: metrics.componentsWithConditions,
    componentsWithoutConditions: metrics.componentsWithoutConditions,
    modeledBindings: metrics.modeledBindings,
    unknownBindings: metrics.unknownBindings,
    variantModels: metrics.variantModels,
    variantsWithDistinctMethod: metrics.variantsWithDistinctMethod,
    variantsSharingBaseMethod: metrics.variantsSharingBaseMethod,
    variantsWithDistinctSectionEvidence: metrics.variantsWithDistinctSectionEvidence,
    variantsWithoutDistinctSectionEvidence: metrics.variantsWithoutDistinctSectionEvidence,
  }, {
    setupFieldsTotal: 8,
    setupFieldsPopulated: 6,
    setupFieldsCovered: 6,
    setupFieldsUnresolved: 2,
    sourceExtractedEquations: 1,
    verbalRestatements: 1,
    componentsWithSymbols: 1,
    componentsWithoutSymbols: 1,
    componentsWithConditions: 1,
    componentsWithoutConditions: 1,
    modeledBindings: 1,
    unknownBindings: 1,
    variantModels: 1,
    variantsWithDistinctMethod: 0,
    variantsSharingBaseMethod: 1,
    variantsWithDistinctSectionEvidence: 1,
    variantsWithoutDistinctSectionEvidence: 0,
  });
});

test("contentAudit is deterministic, warning-bearing, and release-digest bound", () => {
  const note = sourceMappedNote();
  const args = {
    ledger,
    note,
    noteSha256: "c".repeat(64),
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    semantic,
  };
  const first = auditStages(args);
  const repeated = auditStages(args);
  assert.equal(AUDIT_VERSION, "model-note-release-audit-v8");
  assert.deepEqual(first.contentAudit, repeated.contentAudit);
  assert.equal(first.contentAudit.status, "complete");
  assert.equal(first.contentAudit.maturity, "audited-with-warnings");
  assert.equal(first.contentAudit.expertReview, false);
  assert.match(first.contentAudit.method, /does not claim substantive expert review/i);
  assert.ok(first.contentAudit.warnings.some((warning) => warning.startsWith("setup_unresolved:")));
  assert.ok(first.contentAudit.warnings.some((warning) => warning.startsWith("bindings_unknown:")));
  assert.ok(first.contentAudit.warnings.some((warning) => warning.startsWith("variant_method_shared:")));
  assert.equal(first.formulaAudit.sourceExtractedEquations, 1);
  assert.equal(first.formulaAudit.structurallyValidatedFormals, 2);
  assert.match(first.quoteAudit.candidatePaperSha256, /^[a-f0-9]{64}$/);

  const sameMetricsTextChange = structuredClone(note);
  sameMetricsTextChange.overview = "The public paper text changed without altering any audit count.";
  const changedText = auditStages({ ...args, note: sameMetricsTextChange });
  assert.notEqual(changedText.quoteAudit.inputDigest, first.quoteAudit.inputDigest, "audits bind the exact candidate paper, not only aggregate metrics");

  const changedNote = structuredClone(note);
  changedNote.models[1].method = "Solve the capacity extension with an additional state variable.";
  changedNote.models[1].sources = changedNote.models[0].sources;
  changedNote.models[1].components[0].sources = changedNote.models[0].components[0].sources;
  const changed = auditStages({ ...args, note: changedNote });
  assert.notEqual(changed.contentAudit.inputDigest, first.contentAudit.inputDigest);
  assert.notEqual(changed.releaseBuild.inputDigest, first.releaseBuild.inputDigest);
  assert.equal(changed.contentAudit.metrics.variants.withDistinctMethod, 1);
  assert.equal(changed.contentAudit.metrics.variants.withoutDistinctSectionEvidence, 1);
});

test("Mini-style curated notes remain valid without setup maturity metadata", () => {
  const note = {
    id: "paper-1",
    models: [model("base", "Solve the model by backward induction.", {
      objects: ["Seller", "Buyer"],
      inputs: ["Private valuation"],
      decisions: ["Price"],
      assumptions: ["Players are risk neutral"],
    }, [component("utility", "Atlas normalized notation", {
      symbols: [{ symbol: "u", meaning: "buyer utility" }],
      conditions: ["The buyer observes the price."],
    })])],
  };
  const stages = auditStages({
    ledger,
    note,
    noteSha256: "1".repeat(64),
    modelNotesSha256: "2".repeat(64),
    modelNotesJsSha256: "3".repeat(64),
    conceptRegistrySha256: "4".repeat(64),
    semantic,
  });
  assert.equal(stages.contentAudit.status, "complete");
  assert.equal(stages.contentAudit.maturity, "audited");
  assert.equal(stages.contentAudit.metrics.setup.fieldsCovered, 4);
  assert.equal(stages.contentAudit.metrics.formalContent.normalizedNotation, 1);
  assert.deepEqual(stages.contentAudit.warnings, []);
});

test("prerequisite readiness is hash-bound and release completion is separate", () => {
  const working = structuredClone(ledger);
  working.stages.noteAuthoring = { status: "complete", noteSha256: "c".repeat(64) };
  const stages = auditStages({
    ledger: working,
    note: sourceMappedNote(),
    noteSha256: "c".repeat(64),
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    semantic,
  });
  Object.assign(working.stages, stages);
  const candidatePaperSha256 = stages.quoteAudit.candidatePaperSha256;
  assert.equal(prerequisiteAuditCurrent(working, "f".repeat(64), candidatePaperSha256), true);
  assert.equal(prerequisiteAuditCurrent(working, "f".repeat(64), "0".repeat(64)), false);
  assert.deepEqual(releaseBuildStage(working, {
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    candidatePaperSha256,
  }), stages.releaseBuild);

  working.stages.contentAudit.metrics.setup.entries += 1;
  assert.equal(prerequisiteAuditCurrent(working, "f".repeat(64), candidatePaperSha256), false);
});

test("prerequisite readiness requires the exact content-addressed Extraction QA binding", () => {
  const conceptRegistrySha256 = "f".repeat(64);
  const noteSha256 = "c".repeat(64);
  const makeAuditedLedger = (binding = qaBinding) => {
    const working = structuredClone(ledger);
    working.stages.noteAuthoring = { status: "complete", noteSha256 };
    const stages = auditStagesWithBinding({
      ledger: working,
      note: sourceMappedNote(),
      noteSha256,
      modelNotesSha256: "d".repeat(64),
      modelNotesJsSha256: "e".repeat(64),
      conceptRegistrySha256,
      semantic,
      qaBinding: binding
    });
    Object.assign(working.stages, stages);
    return { working, candidatePaperSha256: stages.quoteAudit.candidatePaperSha256, stages };
  };

  const { working, candidatePaperSha256 } = makeAuditedLedger();
  assert.equal(prerequisiteAuditCurrent(working, conceptRegistrySha256, candidatePaperSha256), true);
  assert.equal(prerequisiteAuditCurrentWithBinding(working, conceptRegistrySha256, candidatePaperSha256), false, "missing binding");

  for (const field of ["extractionQaInputDigest", "extractionQaDecisionSha256", "extractionQaAdjudicationStatus"]) {
    const changedBinding = { ...qaBinding, [field]: field === "extractionQaAdjudicationStatus" ? "accepted" : "8".repeat(64) };
    assert.equal(
      prerequisiteAuditCurrent(working, conceptRegistrySha256, candidatePaperSha256, changedBinding),
      false,
      field
    );
  }
});

test("audit helpers reject a partial or internally inconsistent Extraction QA binding", () => {
  const working = structuredClone(ledger);
  working.stages.noteAuthoring = { status: "complete", noteSha256: "c".repeat(64) };
  const partial = { extractionQaStatus: "complete" };
  const args = {
    ledger: working,
    note: sourceMappedNote(),
    noteSha256: "c".repeat(64),
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    semantic,
    qaBinding: partial
  };
  assert.throws(() => auditStagesWithBinding(args), /eight-field|terminal Extraction QA binding/);
  assert.equal(prerequisiteAuditCurrentWithBinding(working, "f".repeat(64), "9".repeat(64), partial), false);
  assert.throws(() => releaseBuildStageWithBinding(working, {
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    candidatePaperSha256: "9".repeat(64),
    qaBinding: partial
  }), /eight-field/);

  const inconsistentNeedsReview = {
    ...needsReviewQaBinding,
    extractionQaAdjudicationPath: null
  };
  assert.throws(() => auditStagesWithBinding({ ...args, qaBinding: inconsistentNeedsReview }), /terminal Extraction QA binding/);
});

test("candidate audit accepts the adapter's path-present pending needs_review binding", () => {
  const binding = modelNoteExtractionQaCheckpointBinding({
    ok: true,
    state: "current",
    effectiveStatus: "needs_review",
    inputDigest: "6".repeat(64),
    decisionPath: "research/ledger/extraction-qa/paper-1/decision.json",
    decisionSha256: "7".repeat(64),
    decision: { status: "needs_review" },
    adjudicationPath: "research/ledger/extraction-qa-adjudications/paper-1.json",
    adjudicationSha256: null
  }, { allowNeedsReview: true });
  const working = structuredClone(ledger);
  working.stages.noteAuthoring = { status: "complete", noteSha256: "c".repeat(64) };
  const stages = auditStagesWithBinding({
    ledger: working,
    note: sourceMappedNote(),
    noteSha256: "c".repeat(64),
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    semantic,
    qaBinding: binding,
    qaDecision: { unresolvedReasons: ["manual_visual_review_required"] }
  });
  assert.equal(binding.extractionQaAdjudicationStatus, "pending");
  assert.equal(binding.extractionQaAdjudicationSha256, null);
  assert.equal(stages.sourceAudit.status, "complete");
  assert.equal(stages.releaseBuild.status, "pending");
});

test("candidate prerequisite audits preserve terminal needs_review without enabling releaseBuild", () => {
  const working = structuredClone(ledger);
  working.stages.noteAuthoring = { status: "complete", noteSha256: "c".repeat(64) };
  const stages = auditStagesWithBinding({
    ledger: working,
    note: sourceMappedNote(),
    noteSha256: "c".repeat(64),
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    semantic,
    qaBinding: needsReviewQaBinding,
    qaDecision: {
      sourceReasons: ["parser_warning"],
      unresolvedReasons: ["manual_visual_review_required"]
    }
  });
  Object.assign(working.stages, stages);

  assert.equal(stages.sourceAudit.status, "complete");
  assert.deepEqual(stages.sourceAudit.extractionUnresolvedReasons, ["manual_visual_review_required"]);
  assert.ok(stages.sourceAudit.warnings.some((warning) => warning.includes("remains unresolved")));
  assert.equal(stages.releaseBuild.status, "pending");
  assert.equal(prerequisiteAuditCurrentWithBinding(
    working,
    "f".repeat(64),
    stages.quoteAudit.candidatePaperSha256,
    needsReviewQaBinding
  ), true);
  assert.throws(() => releaseBuildStageWithBinding(working, {
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    candidatePaperSha256: stages.quoteAudit.candidatePaperSha256,
    qaBinding: needsReviewQaBinding
  }), /release-ready Extraction QA/);
});

test("Mini reading stages and prerequisite readiness are bound to the frozen-page path and hash", () => {
  const working = structuredClone(ledger);
  working.stages.noteAuthoring = {
    status: "complete",
    source: "mini-atlas-schema-v2",
    sourcePdfSha256: working.pdfSha256,
    inputDigest: "9".repeat(64),
    miniPaperId: "P001",
    notePath: "mini-atlas/data/notes/batch-a.json",
    noteSha256: "c".repeat(64),
    pagesPath: "mini-atlas/research/pages/P001.json",
    pagesSha256: "7".repeat(64)
  };
  const args = {
    ledger: working,
    note: sourceMappedNote(),
    noteSha256: working.stages.noteAuthoring.noteSha256,
    modelNotesSha256: "d".repeat(64),
    modelNotesJsSha256: "e".repeat(64),
    conceptRegistrySha256: "f".repeat(64),
    semantic
  };
  const audits = auditStages(args);
  const reading = miniReadingStages(working);
  assert.equal(reading.sectionIndex.pagesArtifact, working.stages.noteAuthoring.pagesPath);
  assert.equal(reading.sectionIndex.pagesSha256, working.stages.noteAuthoring.pagesSha256);
  assert.equal(reading.sourceReading.pagesSha256, working.stages.noteAuthoring.pagesSha256);
  Object.assign(working.stages, audits, reading);
  assert.equal(prerequisiteAuditCurrent(
    working,
    args.conceptRegistrySha256,
    audits.quoteAudit.candidatePaperSha256
  ), true);

  const changedHash = structuredClone(working);
  changedHash.stages.noteAuthoring.pagesSha256 = "8".repeat(64);
  assert.notEqual(miniReadingStages(changedHash).sourceReading.inputDigest, reading.sourceReading.inputDigest);
  assert.equal(prerequisiteAuditCurrent(
    changedHash,
    args.conceptRegistrySha256,
    audits.quoteAudit.candidatePaperSha256
  ), false);

  const missingHash = structuredClone(working);
  delete missingHash.stages.noteAuthoring.pagesSha256;
  assert.equal(prerequisiteAuditCurrent(
    missingHash,
    args.conceptRegistrySha256,
    audits.quoteAudit.candidatePaperSha256
  ), false);
});

test("audit selectors resume deterministically by ID, DOI, and limit", () => {
  const records = [
    { id: "paper-c", doi: "10/c" },
    { id: "paper-a", doi: "10/a" },
    { id: "paper-b", doi: "10/b" },
  ];
  assert.deepEqual(selectRecords(records, { from: "10/b", paper: [], limit: 1 }).map((record) => record.id), ["paper-b"]);
  assert.deepEqual(selectRecords(records, { from: "", paper: ["https://doi.org/10/c"], limit: 0 }).map((record) => record.id), ["paper-c"]);
});

test("release PDF preflight rejects current hash, size, and header drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-release-pdf-preflight-"));
  const relativePath = "paper/source.pdf";
  const filename = path.join(root, "paper", "source.pdf");
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const valid = Buffer.from("%PDF-1.7\nfixture body\n");
  const recordFor = (bytes) => ({
    id: "pdf-preflight-fixture",
    pdf: { path: relativePath, bytes: bytes.length, sha256: digest(bytes) }
  });
  try {
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, valid);
    await assert.doesNotReject(assertCurrentPdfFiles(root, [recordFor(valid)], 2));

    const sameSizeDrift = Buffer.from("%PDF-1.7\nfixture BODY\n");
    assert.equal(sameSizeDrift.length, valid.length);
    await writeFile(filename, sameSizeDrift);
    await assert.rejects(
      assertCurrentPdfFiles(root, [recordFor(valid)], 2),
      /pdf_sha256_mismatch/
    );

    const longer = Buffer.concat([valid, Buffer.from("extra")]);
    await writeFile(filename, longer);
    await assert.rejects(
      assertCurrentPdfFiles(root, [recordFor(valid)], 2),
      /pdf_byte_mismatch/
    );

    const invalidHeader = Buffer.from("NOTDF-1.7\nfixture body\n");
    await writeFile(filename, invalidHeader);
    await assert.rejects(
      assertCurrentPdfFiles(root, [recordFor(invalidHeader)], 2),
      /invalid_pdf_header/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const SENTINEL_PAPER_ID = "needs-review-public-sentinel";
const SENTINEL_DOI = "10.0000/needs-review-public-sentinel";
const SENTINEL_TITLE = "Needs Review Public Sentinel";
const SENTINEL_MODEL_QUOTE = "We model an inventory control problem with a fixed stock and uncertain customer demand.";
const SENTINEL_COMPONENT_QUOTE = "The inventory policy selects a feasible allocation that maximizes expected reward.";
const SENTINEL_PAGE_TEXT = `${SENTINEL_TITLE}\n${SENTINEL_MODEL_QUOTE}\n${SENTINEL_COMPONENT_QUOTE}\n${
  "Readable source prose preserves the model identity, inventory decision, conditions, and supporting evidence. ".repeat(18)
}`;

function sentinelCuratedNote(pdfSha256) {
  return {
    id: SENTINEL_PAPER_ID,
    question: "How should a platform allocate fixed inventory under uncertain demand?",
    overview: "The platform uses an inventory policy to allocate a fixed stock while customer demand remains uncertain.",
    modelTypes: ["Optimization"],
    coverage: {
      pages: [1],
      note: "The curated model and its decision rule are anchored to the extracted source page."
    },
    models: [{
      id: "inventory-allocation",
      name: "Inventory allocation model",
      kind: "baseline",
      summary: "A platform allocates fixed inventory to uncertain customer demand.",
      objects: ["A platform and arriving customers"],
      inputs: ["Fixed inventory and uncertain demand"],
      decisions: ["A feasible inventory allocation"],
      assumptions: ["Allocated inventory cannot exceed the fixed stock"],
      method: "The paper formulates the allocation problem and derives a reward-maximizing inventory policy.",
      sources: [{ page: 1, section: "Model", equation: "", quote: SENTINEL_MODEL_QUOTE }],
      relationships: [],
      components: [{
        id: "inventory-policy",
        label: "Inventory policy",
        role: "decision",
        concepts: ["inventory-control"],
        explanation: "The policy selects a feasible inventory allocation to maximize expected reward.",
        searchPhrases: ["inventory allocation policy", "fixed stock decision", "expected reward"],
        formal: "Decision rule: Select the feasible allocation that maximizes expected reward.",
        formalKind: "Atlas restatement of source rule",
        symbols: [],
        conditions: ["The allocation cannot exceed available inventory."],
        sources: [{ page: 1, section: "Model", equation: "", quote: SENTINEL_COMPONENT_QUOTE }],
        conceptBindings: [{
          conceptId: "inventory-control",
          status: "modeled",
          representation: "The inventory-control concept is represented by the platform's feasible allocation policy.",
          conditionRefs: [0],
          sourceRefs: [{ scope: "component", index: 0 }],
          reviewStatus: "editorial",
          formalRef: "formal"
        }]
      }]
    }],
    provenance: {
      authoringVersion: "curated-sentinel-v1",
      sourceTier: "full-source-curated-note",
      editorialStatus: "Curated source-bound fixture",
      formulaPolicy: "Only the cited verbal decision rule is retained.",
      sourcePdfSha256: pdfSha256
    }
  };
}

async function writeFixtureJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filename, text, "utf8");
  return text;
}

async function createNeedsReviewPublicSentinelFixture() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-needs-review-public-sentinel-"));
  const pdfBytes = Buffer.from("%PDF-1.7\nneeds-review public sentinel fixture\n", "utf8");
  const pdfSha256 = digest(pdfBytes);
  const parserVersion = "sentinel-parser-v1";
  const extractionInputDigest = digest(stableStringify({
    schemaVersion: 1,
    pdfSha256,
    parser: "pypdf+pymupdf-fallback",
    parserVersion,
    extractorCodeSha256: EXTRACTOR_CODE_SHA256
  }));
  const pages = [{ page: 1, text: SENTINEL_PAGE_TEXT }];
  const corruptionProfile = extractionCorruptionProfile(pages);
  const pagesPayload = {
    schemaVersion: 1,
    paperId: SENTINEL_PAPER_ID,
    canonicalDoi: SENTINEL_DOI,
    pdfSha256,
    extractor: {
      name: "pypdf+pymupdf-fallback",
      version: parserVersion,
      codeSha256: EXTRACTOR_CODE_SHA256,
      selectedEngine: "pypdf",
      selectedEngineVersion: "sentinel-pypdf-v1",
      fallbackAttempted: false,
      fallbackUsed: false,
      fallbackReason: "",
      primaryCorruptionProfile: corruptionProfile,
      fallbackCorruptionProfile: null,
      selectedCorruptionProfile: corruptionProfile,
      extractionPolicy: EXTRACTION_POLICY
    },
    pages
  };
  const pagesRelative = path.posix.join(
    "research", "ledger", "artifacts", SENTINEL_PAPER_ID, extractionInputDigest, "pages.json"
  );
  const textRelative = path.posix.join(
    "research", "ledger", "artifacts", SENTINEL_PAPER_ID, extractionInputDigest, "text.txt"
  );
  const pagesText = `${JSON.stringify(pagesPayload, null, 2)}\n`;
  const plainText = `===== PDF PAGE 1 =====\n${SENTINEL_PAGE_TEXT}\n`;
  const catalogRecord = {
    id: SENTINEL_PAPER_ID,
    doi: SENTINEL_DOI,
    title: SENTINEL_TITLE,
    authors: ["Atlas Test Fixture"],
    year: 2024,
    journal: "Fixture Journal",
    journal_code: "FJ",
    navigation_topic: "Optimization",
    primary_topic: "Inventory control",
    topic_families: ["Optimization"],
    topics: ["Inventory control"],
    detail_level: "literature",
    pdf_page_count: 1,
    pdf_sha256: pdfSha256,
    modeling_evidence: "PDF p. 1 states the inventory model and its decision rule.",
    evidence_detail: ["PDF p. 1 states the inventory model and its decision rule."]
  };
  const catalog = { schema_version: "3.1", records: [catalogRecord] };
  const catalogText = `${JSON.stringify(catalog, null, 2)}\n`;
  const manifestRecord = {
    id: SENTINEL_PAPER_ID,
    canonicalDoi: SENTINEL_DOI,
    doiUrl: `https://doi.org/${SENTINEL_DOI}`,
    aliases: [],
    title: SENTINEL_TITLE,
    recordDigest: digest(stableStringify(catalogRecord)),
    pdf: {
      path: `paper/${SENTINEL_PAPER_ID}.pdf`,
      sha256: pdfSha256,
      bytes: pdfBytes.length,
      pageCount: 1
    }
  };
  const manifest = {
    schemaVersion: 1,
    corpusRevision: "needs-review-public-sentinel-v1",
    source: {
      path: "data/atlas_articles.json",
      dataSha256: digest(catalogText)
    },
    parser: {
      name: "pypdf+pymupdf-fallback",
      version: parserVersion,
      extractionCodeSha256: EXTRACTOR_CODE_SHA256,
      extractionPolicy: EXTRACTION_POLICY
    },
    recordsDigest: digest(stableStringify([manifestRecord])),
    records: [manifestRecord]
  };
  const noteRelative = path.posix.join("data", "notes", "papers", `${SENTINEL_PAPER_ID}.json`);
  const envelope = {
    schemaVersion: 1,
    authoringVersion: "curated-sentinel-v1",
    authoringMode: "curated",
    paperId: SENTINEL_PAPER_ID,
    sourcePdfSha256: pdfSha256,
    extractionPagesSha256: "0".repeat(64),
    conceptRegistrySha256: "0".repeat(64),
    inputDigest: "0".repeat(64),
    note: sentinelCuratedNote(pdfSha256)
  };
  const noteText = `${JSON.stringify(envelope, null, 2)}\n`;
  const extraction = {
    status: "complete",
    inputDigest: extractionInputDigest,
    sourcePdfSha256: pdfSha256,
    attempts: 1,
    pageCount: 1,
    totalCharacters: SENTINEL_PAGE_TEXT.length,
    emptyPages: [],
    pageErrors: [],
    parserWarningCount: 1,
    parserWarningCodes: ["fixture_parser_warning"],
    selectedEngine: "pypdf",
    selectedEngineVersion: "sentinel-pypdf-v1",
    fallbackAttempted: false,
    fallbackUsed: false,
    fallbackReason: "",
    primaryCorruptionProfile: corruptionProfile,
    fallbackCorruptionProfile: null,
    selectedCorruptionProfile: corruptionProfile,
    artifacts: {
      pages: pagesRelative,
      pagesSha256: digest(pagesText),
      text: textRelative,
      textSha256: digest(plainText)
    }
  };
  const ledger = {
    schemaVersion: 1,
    paperId: SENTINEL_PAPER_ID,
    canonicalDoi: SENTINEL_DOI,
    corpusRevision: manifest.corpusRevision,
    manifestRecordDigest: manifestRecord.recordDigest,
    pdfSha256,
    stages: {
      extraction,
      extractQa: {
        status: "needs_review",
        inputDigest: extractionInputDigest,
        sourcePdfSha256: pdfSha256,
        reasons: ["parser_warning"],
        warningCodes: extraction.parserWarningCodes,
        pageErrors: [],
        emptyPages: [],
        totalCharacters: SENTINEL_PAGE_TEXT.length,
        selectedEngine: extraction.selectedEngine,
        selectedEngineVersion: extraction.selectedEngineVersion,
        fallbackAttempted: false,
        fallbackUsed: false,
        fallbackReason: "",
        primaryCorruptionProfile: corruptionProfile,
        fallbackCorruptionProfile: null,
        selectedCorruptionProfile: corruptionProfile
      },
      sectionIndex: { status: "pending" },
      sourceReading: { status: "pending" },
      noteAuthoring: {
        status: "complete",
        inputDigest: envelope.inputDigest,
        sourcePdfSha256: pdfSha256,
        conceptRegistrySha256: envelope.conceptRegistrySha256,
        source: "editor-curated-full-source",
        notePath: noteRelative,
        noteSha256: digest(noteText),
        authoringVersion: envelope.authoringVersion,
        authoringMode: envelope.authoringMode
      }
    }
  };
  for (const stage of ["quoteAudit", "formulaAudit", "schemaValidation", "contentAudit", "sourceAudit", "releaseBuild"]) {
    ledger.stages[stage] = { status: "pending" };
  }

  await Promise.all([
    mkdir(path.join(temporaryRoot, "data"), { recursive: true }),
    mkdir(path.dirname(path.join(temporaryRoot, ...textRelative.split("/"))), { recursive: true }),
    mkdir(path.join(temporaryRoot, "paper"), { recursive: true })
  ]);
  await Promise.all([
    cp(path.join(repositoryRoot, "scripts"), path.join(temporaryRoot, "scripts"), { recursive: true }),
    writeFile(path.join(temporaryRoot, "data", "atlas_articles.json"), catalogText, "utf8"),
    writeFixtureJson(path.join(temporaryRoot, "mini-atlas", "data", "atlas.json"), { schemaVersion: 2, concepts: [], papers: [] }),
    writeFixtureJson(path.join(temporaryRoot, "research", "corpus", "manifest.v1.json"), manifest),
    writeFixtureJson(path.join(temporaryRoot, ...pagesRelative.split("/")), pagesPayload),
    writeFile(path.join(temporaryRoot, ...textRelative.split("/")), plainText, "utf8"),
    writeFixtureJson(path.join(temporaryRoot, ...noteRelative.split("/")), envelope),
    writeFixtureJson(path.join(temporaryRoot, "research", "ledger", "papers", `${SENTINEL_PAPER_ID}.json`), ledger),
    writeFile(path.join(temporaryRoot, "paper", `${SENTINEL_PAPER_ID}.pdf`), pdfBytes)
  ]);
  const reviewed = await reviewExtractions({
    command: "review",
    root: temporaryRoot,
    papers: [SENTINEL_PAPER_ID],
    from: "",
    limit: null,
    jobs: 1,
    dryRun: false,
    force: false,
    check: false,
    json: false,
    help: false
  });
  assert.deepEqual(reviewed.statuses, { needs_review: 1 });
  const reviewedLedger = JSON.parse(await readFile(
    path.join(temporaryRoot, "research", "ledger", "papers", `${SENTINEL_PAPER_ID}.json`),
    "utf8"
  ));
  const qaCheckpoint = await verifyExtractionQaCheckpoint(
    temporaryRoot,
    manifest,
    manifestRecord,
    reviewedLedger,
    { requireComplete: false }
  );
  const terminalQaBinding = modelNoteExtractionQaCheckpointBinding(qaCheckpoint, { allowNeedsReview: true });
  assert.equal(terminalQaBinding.extractionQaStatus, "needs_review");

  const visualScopeReport = {
    schemaVersion: 1,
    reportVersion: "extraction-visual-scope-review-v1",
    entries: [{
      paperId: SENTINEL_PAPER_ID,
      sourcePdf: { sha256: pdfSha256 },
      productionExtraction: {
        pagesSha256: extraction.artifacts.pagesSha256,
        textSha256: extraction.artifacts.textSha256
      },
      qaDecision: { sha256: terminalQaBinding.extractionQaDecisionSha256 },
      proseAuthoringAllowed: true,
      formalMathAllowed: false,
      structuredFigureTableAllowed: false,
      reviewDisposition: "needs_review",
      reviewVersion: "extraction-visual-scope-review-v1"
    }]
  };
  const visualScopeText = await writeFixtureJson(
    path.join(temporaryRoot, ...VISUAL_SCOPE_REPORT_PATH.split("/")),
    visualScopeReport
  );
  const source = (quote) => ({ page: 1, section: "Model", quote });
  const safeMap = {
    schemaVersion: SAFE_MAP_SCHEMA_VERSION,
    safeMapVersion: SAFE_MAP_VERSION,
    paperId: SENTINEL_PAPER_ID,
    sourcePdfSha256: pdfSha256,
    extractionPagesSha256: extraction.artifacts.pagesSha256,
    visualScopeReview: {
      path: VISUAL_SCOPE_REPORT_PATH,
      sha256: digest(visualScopeText),
      entryBinding: {
        qaDecisionSha256: terminalQaBinding.extractionQaDecisionSha256,
        textSha256: extraction.artifacts.textSha256,
        reviewDisposition: "needs_review",
        reviewVersion: "extraction-visual-scope-review-v1"
      },
      formalMathAllowed: false,
      structuredFigureTableAllowed: false
    },
    review: {
      status: "approved",
      reviewerRole: "independent_content_qa",
      reviewedAt: "2026-09-12",
      version: SAFE_MAP_REVIEW_VERSION
    },
    question: {
      text: "How should a platform allocate fixed inventory under uncertain demand?",
      source: source(SENTINEL_MODEL_QUOTE)
    },
    overview: {
      text: "The model allocates a fixed inventory stock to uncertain customer demand through a feasible reward-maximizing policy.",
      sources: [source(SENTINEL_MODEL_QUOTE), source(SENTINEL_COMPONENT_QUOTE)]
    },
    models: [{
      id: "inventory-allocation",
      name: "Inventory Allocation Model",
      kind: "baseline",
      relation: "",
      summary: {
        text: "A platform allocates fixed inventory to uncertain customer demand through a feasible inventory policy.",
        sources: [source(SENTINEL_MODEL_QUOTE), source(SENTINEL_COMPONENT_QUOTE)]
      },
      setup: {
        objects: [{ value: "an inventory control problem", source: source(SENTINEL_MODEL_QUOTE) }],
        inputs: [
          { value: "a fixed stock", source: source(SENTINEL_MODEL_QUOTE) },
          { value: "uncertain customer demand", source: source(SENTINEL_MODEL_QUOTE) }
        ],
        decisions: [{ value: "a feasible allocation", source: source(SENTINEL_COMPONENT_QUOTE) }],
        assumptions: [{ value: "fixed stock", source: source(SENTINEL_MODEL_QUOTE) }]
      },
      method: {
        text: "The paper formulates the allocation problem and derives a reward-maximizing inventory policy.",
        sources: [source(SENTINEL_MODEL_QUOTE), source(SENTINEL_COMPONENT_QUOTE)]
      },
      components: [{
        id: "inventory-policy",
        label: "Inventory Allocation Policy",
        role: "decision",
        conceptIds: ["inventory-control"],
        explanation: {
          text: "The inventory policy selects the feasible allocation that maximizes expected reward.",
          sources: [source(SENTINEL_COMPONENT_QUOTE)]
        },
        conditions: [{ text: SENTINEL_COMPONENT_QUOTE, source: source(SENTINEL_COMPONENT_QUOTE) }]
      }, {
        id: "capacity-feasibility",
        label: "Fixed-Stock Feasibility",
        role: "constraint",
        conceptIds: ["feasibility-constraints"],
        explanation: {
          text: "Feasibility restricts the allocation made from fixed stock under uncertain customer demand.",
          sources: [source(SENTINEL_MODEL_QUOTE), source(SENTINEL_COMPONENT_QUOTE)]
        },
        conditions: [{ text: SENTINEL_COMPONENT_QUOTE, source: source(SENTINEL_COMPONENT_QUOTE) }]
      }]
    }]
  };
  await writeFixtureJson(
    path.join(temporaryRoot, ...safeMapRelativePath(SENTINEL_PAPER_ID).split("/")),
    safeMap
  );
  const authored = await authorModelNotes({
    root: temporaryRoot,
    limit: 0,
    from: "",
    paper: [SENTINEL_PAPER_ID],
    jobs: 1,
    force: false,
    dryRun: false,
    check: false,
    reconcileMini: false,
    json: true
  });
  assert.deepEqual(authored.counts, { updated: 1 }, JSON.stringify(authored.results));
  await execFileAsync(process.execPath, [path.join(temporaryRoot, "scripts", "build-model-notes.mjs")], {
    cwd: temporaryRoot,
    maxBuffer: 4 * 1024 * 1024
  });
  return temporaryRoot;
}

test("candidate-only and unresolved normal audit runs preserve both public release files", async () => {
  const temporaryRoot = await createNeedsReviewPublicSentinelFixture();
  try {
    const publicJsonPath = path.join(temporaryRoot, "data", "model_notes.json");
    const publicJsPath = path.join(temporaryRoot, "data", "model_notes.js");
    const publicJsonSentinel = Buffer.from('{"release":"preexisting-public-json-sentinel"}\n', "utf8");
    const publicJsSentinel = Buffer.from('window.AtlasModelNotes={release:"preexisting-public-js-sentinel"};\n', "utf8");
    await Promise.all([
      writeFile(publicJsonPath, publicJsonSentinel),
      writeFile(publicJsPath, publicJsSentinel)
    ]);
    const auditScript = path.join(temporaryRoot, "scripts", "audit-model-notes.mjs");

    await execFileAsync(process.execPath, [auditScript, "--candidate-only", "--jobs", "1"], {
      cwd: temporaryRoot,
      maxBuffer: 4 * 1024 * 1024
    });
    const paperLedgerPath = path.join(
      temporaryRoot,
      "research",
      "ledger",
      "papers",
      `${SENTINEL_PAPER_ID}.json`
    );
    const paperLedgerText = await readFile(paperLedgerPath, "utf8");
    assert.equal(paperLedgerText, `${stableStringify(JSON.parse(paperLedgerText), 2)}\n`,
      "candidate audit leaves the paper ledger canonical");
    const candidateReportText = await readFile(
      path.join(temporaryRoot, "data", "notes", "release-candidate", "audit.v1.json"),
      "utf8"
    );
    assert.equal(candidateReportText, `${JSON.stringify(JSON.parse(candidateReportText), null, 2)}\n`,
      "candidate audit report serialization remains unchanged");
    assert.deepEqual(await readFile(publicJsonPath), publicJsonSentinel);
    assert.deepEqual(await readFile(publicJsPath), publicJsSentinel);

    await assert.rejects(
      execFileAsync(process.execPath, [auditScript, "--jobs", "1"], {
        cwd: temporaryRoot,
        maxBuffer: 4 * 1024 * 1024
      }),
      (error) => {
        assert.equal(error.code, 1, "an unresolved normal audit must fail closed at the CLI boundary");
        assert.equal(error.stderr, "");
        return true;
      }
    );
    assert.deepEqual(await readFile(publicJsonPath), publicJsonSentinel);
    assert.deepEqual(await readFile(publicJsPath), publicJsSentinel);

    const safeMapPath = path.join(temporaryRoot, ...safeMapRelativePath(SENTINEL_PAPER_ID).split("/"));
    const tamperedSafeMap = JSON.parse(await readFile(safeMapPath, "utf8"));
    tamperedSafeMap.overview.text = `${tamperedSafeMap.overview.text} The inventory policy allocates the fixed stock.`;
    await writeFixtureJson(safeMapPath, tamperedSafeMap);
    await assert.rejects(
      execFileAsync(process.execPath, [auditScript, "--candidate-only", "--jobs", "1"], {
        cwd: temporaryRoot,
        maxBuffer: 4 * 1024 * 1024
      }),
      (error) => {
        assert.equal(error.code, 1, "a changed safe map must invalidate the candidate audit");
        assert.match(`${error.stdout || ""}\n${error.stderr || ""}`, /safe-map|safe map/i);
        return true;
      }
    );
    assert.deepEqual(await readFile(publicJsonPath), publicJsonSentinel);
    assert.deepEqual(await readFile(publicJsPath), publicJsSentinel);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
