import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { titleFallbackQuestion } from "../scripts/model-note-authoring.mjs";
import {
  deriveResearchQuestion,
  isDirectResearchQuestion
} from "../scripts/model-note-semantic-authoring.mjs";

const { records } = JSON.parse(readFileSync(new URL("../data/atlas_articles.json", import.meta.url), "utf8"));
const recordsById = new Map(records.map((record) => [record.id, record]));

function productionQuestion(record) {
  const derived = deriveResearchQuestion(record);
  return derived.question || titleFallbackQuestion(record);
}

const GENERIC_TITLE_WRAPPER = /^How can .+ be (?:formulated as a model|modeled(?: under| in)\b.*)\?$/i;
const COMBINED_TITLE_WRAPPER = /^How are .+ combined\?$/i;
const WHAT_DETERMINES_ARTIFACT = /^What determines\s+(?:(?:a|an)\s+(?:(?:new|novel|general|stylized|parsimonious|analytics-centered|data-driven|commonly adopted|two-stage)\s+){0,3}(?:model|framework|approach|algorithm|criterion|definition|heuristic|formulation|policy|scheme|problem|extension)\b|(?:devising|understanding|jointly designing)\b|.+\b(?:and|then)\s+(?:propose|proposes|prove|proves|relate|relates|identify|identifies|analy[sz]e|explore|explores)\b|(?:many|network)\s+.+\b(?:undergo|undergoes|suffer|suffers|depends|interact|interacts)\b)/i;
const MALFORMED_CONTRIBUTE_TAIL = /\bcontribute to\b[^?]*(?:\bplatforms?\b[^?]*\b(?:collect|fund)\b|\bfirms?\b[^?]*\b(?:finance|fund)\b|\bcarriers?\b[^?]*\bcollaborate\b|\band\s+analy[sz]e\b|\buncertain\s+about\b|\b(?:and|when))\?$/i;
const DANGLING_QUESTION_END = /\b(?:and|or|but|to|when|where|which|who|whose|what|how|because|if|than|that)\?$/i;
const TRUNCATED_ABBREVIATION = /\b(?:U\.S|e\.g|i\.e|et al)\?$/i;
const UNBOUND_DEICTIC_START = /^(?:How|What|When|Why|Which|Who|Where|Can|Could|Should|Does|Do|Is|Are|Will|Would)\s+(?:(?:does|do|can|could|should|would|will|may|might|must|is|are|was|were|has|have|had)\s+)?(?:this|these|those|such|its)\b/i;
const METADATA_AS_QUESTION = /(?:Practice and Policy Oriented Abstract|\[(?:Grant|Award)\b|National Science Foundation \(NSF\))/i;

function invalidUnicodeReason(value) {
  for (const character of String(value || "")) {
    const codePoint = character.codePointAt(0);
    if ((codePoint <= 0x1f && ![0x09, 0x0a, 0x0d].includes(codePoint))
        || (codePoint >= 0x7f && codePoint <= 0x9f)) return "control_character";
    if ((codePoint >= 0xe000 && codePoint <= 0xf8ff)
        || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
        || (codePoint >= 0x100000 && codePoint <= 0x10fffd)) return "private_use_character";
    if ((codePoint >= 0xfdd0 && codePoint <= 0xfdef)
        || (codePoint & 0xffff) === 0xfffe
        || (codePoint & 0xffff) === 0xffff) return "noncharacter";
  }
  return /[�￿⇤⌘↵]/u.test(String(value || "")) ? "bad_glyph" : "";
}

function subjectVerbAgreementReason(question) {
  const match = question.match(
    /^How\s+(do|does)\s+(.+?)\s+(affect|allow|change|compare|contribute|create|determine|drive|enable|improve|increase|influence|matter|reduce|resolve|shape|use|include|make)\b/i
  );
  if (!match) return "";
  const auxiliary = match[1].toLowerCase();
  const subject = match[2];
  // A finite predicate swallowed into the alleged subject is a separate clause
  // splice, not evidence that its final noun controls do/does agreement.
  if (/\b(?:sell|generate|service|transmit|deliver)\b/i.test(subject)) return "";
  const base = subject
    .split(/\s+(?:in|of|on|through|using|with|to|when|where|that|which|who)\s+/i)[0]
    .replace(/,$/, "");
  const last = base.match(/([A-Za-z]+)(?:\s*\([^)]*\))?$/)?.[1] || "";
  const leadingArticle = /^(?:a|an|the)\b/i.test(subject);
  const leadingGerund = /^[A-Za-z-]+ing\b/i.test(subject);
  const compound = /\band\b/i.test(subject)
    && !/^a\s+(?:mix|combination|bundle|pair|set|portfolio)\s+of\b/i.test(subject)
    && !/^an?\b[^,]{0,80}\bto\b[^,]{0,80}\band\b/i.test(subject);
  const commaList = /^an?\b[^,]+,[^,]+,\s*and\b/i.test(subject);
  const pluralHead = /s$/i.test(last)
    && !/^(?:access|analysis|basis|bias|business|class|distress|emphasis|loss|news|process|status|success)$/i.test(last);
  const confidentlyPlural = (pluralHead && !leadingGerund)
    || (compound && (!leadingArticle || /^(?:his|her|its)\b/i.test(subject)))
    || commaList;
  const confidentlySingular = /^(?:each|every|one|this|that|its|his|her)\b/i.test(subject)
    || /^the\s+(?:(?:recent|sudden|continued|rapid|strategic)\s+)?(?:absence|development|effect|emergence|formation|impact|market|method|policy|power|presence|role|value)\b/i.test(subject);
  if (auxiliary === "does" && confidentlyPlural) return "does_with_plural_subject";
  if (auxiliary === "do" && confidentlySingular) return "do_with_singular_subject";
  return "";
}

function p1QuestionReasons(question) {
  const reasons = [];
  if (GENERIC_TITLE_WRAPPER.test(question)) reasons.push("generic_title_wrapper");
  if (COMBINED_TITLE_WRAPPER.test(question)) reasons.push("combined_title_wrapper");
  if (WHAT_DETERMINES_ARTIFACT.test(question)) reasons.push("what_determines_artifact");
  const contrast = question.match(/^How can (.+?),\s*but\s+(.+)\?$/i);
  if (contrast && !/\b(?:although|if|when|while)\b/i.test(contrast[1])) reasons.push("coordinated_declarative_contrast");
  if (MALFORMED_CONTRIBUTE_TAIL.test(question)) reasons.push("finite_clause_after_contribute_to");
  if (DANGLING_QUESTION_END.test(question) || TRUNCATED_ABBREVIATION.test(question)) reasons.push("truncated_question");
  if (UNBOUND_DEICTIC_START.test(question)) reasons.push("unbound_deictic_subject");
  if (METADATA_AS_QUESTION.test(question)) reasons.push("metadata_as_question");
  if (/\ba\s+(?:ambiguous|analytical|economic|engineering|empirical|optimal|unifying)\b/i.test(question)) reasons.push("indefinite_article_disagreement");
  if (/^How should (?:by|from|on|under|when|with)\b/i.test(question)) reasons.push("preposition_as_subject");
  if (/^What role does .+ play on\b/i.test(question)) reasons.push("invalid_role_preposition");
  if (/^How should (?:and\b|(?:auction|contract\s+)?design\b[^?]*\bbe designed\b|design of\b[^?]*\bbe designed\b)/i.test(question)) reasons.push("duplicated_action_nominal");
  const unicodeReason = invalidUnicodeReason(question);
  if (unicodeReason) reasons.push(unicodeReason);
  const agreementReason = subjectVerbAgreementReason(question);
  if (agreementReason) reasons.push(agreementReason);
  if (/^Can there exists\b/i.test(question)
      || /^How should (?:this|that|the)\b[^?]{0,70}\b(?:mitigates|results)\b/i.test(question)
      || /^How does while\b/i.test(question)
      || /^How is\b[^?]{0,90}\bdecisions?\s+interact\b/i.test(question)
      || /^When does\b[^?]{0,90}\bsells\b[^?]*,\s*how\b/i.test(question)) {
    reasons.push("auxiliary_inflection_or_clause_splice");
  }
  return [...new Set(reasons)];
}

test("known corpus questions avoid finite-clause and embedded-wh artifacts", () => {
  const expected = new Map([
    ["doi-10-1287-isre-2022-1128", "How can fake orders affect consumer choice?"],
    ["doi-10-1287-mnsc-2017-2785", "How should one use delay announcements to manage customer expectations while allowing a firm to prioritize among customers with different sensitivities to time and value?"],
    ["doi-10-1287-msom-2018-0733", "How do several factors (such as information disclosure, goodwill loss, inspection cost, external monitoring by nongovernmental organizations (NGOs), and penalty scheme) affect firms’ incentives to use different strategies to combat child labor?"],
    ["doi-10-1287-mnsc-2023-4899", "How should one bid in first-price auctions when a bidder knows their own value but not how others will bid?"],
    ["doi-10-1287-msom-2024-1456", "How do applicant stochastic departures affect a rolling recruitment process?"]
  ]);

  for (const [id, question] of expected) {
    assert.equal(productionQuestion(recordsById.get(id)), question, id);
    assert.equal(isDirectResearchQuestion(question), true, id);
  }

  for (const id of ["doi-10-1287-mnsc-2020-3640", "doi-10-1287-mnsc-2023-4859"]) {
    const question = productionQuestion(recordsById.get(id));
    assert.equal(isDirectResearchQuestion(question), true, `${id}: ${question}`);
    assert.doesNotMatch(question, /\b(?:shapes that are|use that neither)\b/i, id);
  }
});

test("question validation fails closed on missing subjects and nested question fragments", () => {
  for (const malformed of [
    "How will to bid in first-price auctions?",
    "How can be modeled under demand uncertainty?",
    "How does how to use delay announcements affect customers?",
    "How can when capacity expands, queue scalping increase welfare?",
    "How does which a minimum earnings rule causes instability affect marketplaces?",
    "How does rebates contribute to outcome-based pricing?",
    "How can online reviews shape purchasing, but firms struggle to answer them?",
    "How are this model improves service and uncertain demand combined?",
    "What determines a new formulation and prove its correctness?",
    "How does customer targeting contribute to transactional data and?",
    "What determines a program inspired by the U.S?"
  ]) assert.equal(isDirectResearchQuestion(malformed), false, malformed);
});

test("known P1 corpus cases retain the paper's research object and a complete predicate", () => {
  const cases = [
    {
      id: "doi-10-1287-mnsc-2018-3092",
      required: [/preferences/i, /side information/i, /learn/i],
      rejected: [/formulated as a model/i, /modeled under/i]
    },
    {
      id: "doi-10-1287-isre-2020-0988",
      required: [/support forums?/i, /software vendor/i, /pric/i],
      rejected: [/practice and policy oriented abstract/i]
    },
    {
      id: "doi-10-1287-mnsc-2022-01130",
      required: [/adaptive|adaptively/i, /personalized recommendations?/i, /short-form video/i],
      rejected: [/\bgrant\b/i, /national science foundation/i]
    },
    {
      id: "doi-10-1287-msom-2019-0781",
      required: [/operating room|\bOR\b/i, /staff/i, /schedul/i],
      rejected: [/what determines a new criterion/i]
    },
    {
      id: "doi-10-1287-msom-2020-0893",
      required: [/transactional data/i, /target promotions?/i],
      rejected: [/\bcontribute to\b/i, /\band\?$/i]
    },
    {
      id: "doi-10-1287-mnsc-2022-02947",
      required: [/sample size/i, /train/i, /certif/i, /targeting polic/i],
      rejected: [/\bwhen\?$/i]
    },
    {
      id: "doi-10-1287-msom-2024-0761",
      required: [/simultaneous/i, /sequential/i, /assortment/i, /compar/i],
      rejected: [/how do each/i, /and compare their performance affect/i]
    }
  ];

  for (const { id, required, rejected } of cases) {
    const question = productionQuestion(recordsById.get(id));
    assert.equal(isDirectResearchQuestion(question), true, `${id}: ${question}`);
    for (const pattern of required) assert.match(question, pattern, `${id}: ${question}`);
    for (const pattern of rejected) assert.doesNotMatch(question, pattern, `${id}: ${question}`);
  }
});

test("conservative title fallbacks form direct questions from wh and subtitle titles", () => {
  const cases = [
    ["When to Use Provider Triage in Emergency Departments", "When should one use provider triage in emergency departments?"],
    ["What the Past Tells About the Future: Historical Prices in the Durable Goods Market", "How can historical prices be modeled in the durable goods market?"],
    ["Why Fixed Costs Matter for Proof-of-Work–Based Cryptocurrencies", "Why do fixed costs matter for proof-of-work–based cryptocurrencies?"],
    ["When Nash Meets Stackelberg", "When does Nash meet Stackelberg?"],
    ["Influencer Authenticity: To Grow or to Monetize", "What determines whether to grow or to monetize?"],
    ["When Variability Trumps Volatility: Optimal Control and Value of Reverse Logistics in Supply Chains with Multiple Flows of Product", "How can optimal control and value of reverse logistics be modeled in supply chains with multiple flows of product?"]
  ];

  for (const [title, expected] of cases) {
    const question = titleFallbackQuestion({ title });
    assert.equal(question, expected, title);
    assert.equal(isDirectResearchQuestion(question), true, title);
  }
});

test("all 1,653 catalog records produce a validator-clean, non-template research question", () => {
  assert.equal(records.length, 1653);
  const failures = [];
  for (const record of records) {
    const question = productionQuestion(record);
    const reasons = [
      ...(!isDirectResearchQuestion(question) ? ["not_direct"] : []),
      ...(/\b(and|or|to)\s+\1\b/i.test(question) ? ["duplicated_conjunction"] : []),
      ...(/\b(?:firstand|secondand|thirdand)\b/i.test(question) ? ["joined_ordinal"] : []),
      ...(/^how\s+(?:can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had)\s+(?:to\b|be\b|how\b|when\b|where\b|why\b|which\s+(?:a|an)\b)/i.test(question)
        ? ["missing_or_nested_subject"] : []),
      ...p1QuestionReasons(question)
    ];
    if (reasons.length) failures.push({ id: record.id, reasons: [...new Set(reasons)], question });
  }

  const counts = {};
  for (const failure of failures) {
    for (const reason of failure.reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  const examples = failures.slice(0, 40);
  assert.equal(
    failures.length,
    0,
    `P1 question failures: ${JSON.stringify({ counts, examples }, null, 2)}`
  );
});
