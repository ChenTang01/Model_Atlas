import assert from "node:assert/strict";
import test from "node:test";

import {
  completeModelSetupFromSource,
  deriveModelSetup,
  SEMANTIC_MATURITY
} from "../scripts/model-note-semantic-authoring.mjs";

test("a baseline model root retains a narrow passive here-and-now decision without borrowing from LDR", () => {
  const sections = [
    {
      title: "2. An adaptive distributionally robust linear optimization problem",
      page: 4,
      text: "We first focus on a two-stage adaptive distributionally robust linear optimization problem where the first stage or here-and-now decision is a vector x ∈ R chosen over the feasible set X."
    },
    {
      title: "3. Linear decision rule (LDR) approximation",
      page: 11,
      text: "Correspondingly, the here-and-now decision x is determined by the LDR approximation."
    }
  ];

  const result = completeModelSetupFromSource({}, sections, deriveModelSetup({}, sections));

  assert.deepEqual(result.decisions, ["The first stage or here-and-now decision"]);
  assert.equal(result.maturity.decisions, SEMANTIC_MATURITY.DERIVED);
  assert.equal(result.evidence.decisions[0].source.section, sections[0].title);
  assert.equal(result.evidence.decisions[0].source.matchedText, "the first stage or here-and-now decision");
  assert.equal(result.evidence.decisions[0].source.derivation, "literal-passive-decision-declaration");
  assert.equal(result.evidence.decisions.some(({ source }) => /LDR/i.test(source.section)), false);
});

test("a declarative process cadence is an assumption only in model overview or problem formulation", () => {
  const modelOverview = {
    title: "3.1. Model Overview",
    page: 3,
    text: "The judge holds one hearing per period."
  };
  const result = completeModelSetupFromSource({}, [modelOverview], deriveModelSetup({}, [modelOverview]));

  assert.deepEqual(result.assumptions, ["The judge holds one hearing per period"]);
  assert.equal(result.maturity.assumptions, SEMANTIC_MATURITY.DERIVED);
  assert.equal(result.evidence.assumptions[0].source.section, modelOverview.title);
  assert.equal(result.evidence.assumptions[0].source.matchedText, "The judge holds one hearing per period");
  assert.equal(result.evidence.assumptions[0].source.derivation, "literal-declarative-model-mechanic");

  const problemFormulation = {
    title: "2. Problem Formulation",
    page: 4,
    text: "Each server processes one request per period."
  };
  const formulationResult = deriveModelSetup({}, [problemFormulation]);
  assert.deepEqual(formulationResult.assumptions, ["Each server processes one request per period"]);

  for (const section of [
    { title: "Results", page: 8, text: "The judge holds one hearing per period." },
    { title: "Field Experiment", page: 9, text: "The judge holds one hearing per period." },
    { title: "3.1. Model Overview", page: 3, text: "The treated judge holds one hearing per period in the field experiment." }
  ]) {
    const rejected = completeModelSetupFromSource({}, [section], deriveModelSetup({}, [section]));
    assert.deepEqual(rejected.assumptions, [], `${section.title}: ${section.text}`);
  }
});
