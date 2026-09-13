import assert from "node:assert/strict";
import test from "node:test";

import {
  assessHeading,
  componentFingerprint,
  directQuestion,
  hasExtractionNoise,
  hasOrphanMathScriptMarker,
  isBoilerplate,
  isCaption,
  isCitation,
  isDirectQuestion,
  isMeaningfulText,
  isPaperOrganizationProse,
  isQualityHeading,
  isTableRow,
  isWhitespaceNormalizedSubstring,
  literalSourceSentenceCandidates,
  meaningfulText,
  normalizeWhitespace,
  remapNormalizedSourceQuote,
  sameSemanticComponent,
  selectLiteralSourceSentence,
  semanticFingerprint,
  semanticSignature,
  stripInvisible
} from "../scripts/model-note-text-quality.mjs";

test("meaningfulText strips invisible characters and requires a letter or digit", () => {
  assert.equal(stripInvisible("Inven\u200Btory\u2060 policy\ufeff"), "Inventory policy");
  assert.equal(meaningfulText("  Inven\u200Btory\u2060   policy  "), "Inventory policy");
  assert.equal(meaningfulText("\u200B — • \ufeff"), "");
  assert.equal(isMeaningfulText("  42  "), true);
  assert.equal(isMeaningfulText("…"), false);
});

test("legacy PDF equality controls normalize to a renderable equality sign", () => {
  const extracted = "The policy π \u0088 (u1(t), u2(t)) minimizes infections.";
  assert.equal(normalizeWhitespace(extracted), "The policy π = (u1(t), u2(t)) minimizes infections.");
  assert.equal(hasExtractionNoise(extracted), false);
  assert.equal(isWhitespaceNormalizedSubstring("The policy π = (u1(t), u2(t)) minimizes infections.", extracted), true);
});

test("orphan PDF script markers are rejected without banning valid indexed notation", () => {
  for (const corrupt of [
    "The time period and the observed history ^t",
    "The distribution belongs to ^reg.",
    "Consider each keyword i ∈_.",
    "For every vector 8 ∈ˆ_, the estimate is defined.",
    "We define by _j the relevant user set.",
    "The admissible range is [_C, C].",
    "The policy is written ht(^t)."
  ]) {
    assert.equal(hasOrphanMathScriptMarker(corrupt), true, corrupt);
  }
  const literalProvenance = "The function class ^NN is used to approximate the continuation value.";
  assert.equal(hasOrphanMathScriptMarker(literalProvenance), true);
  assert.equal(hasExtractionNoise(literalProvenance), false,
    "orphan markers alone must not invalidate a byte-literal provenance quote");
  assert.deepEqual(literalSourceSentenceCandidates(literalProvenance), [],
    "the same literal source text must not become an authored/display candidate");
  for (const valid of [
    "The action is a^M.",
    "The indexed rate is λ_ij.",
    "The inverse is C'^{-1}(b_q).",
    "The outcome law is ρ_(x,a).",
    "The depleted fraction is N_i^(t−1)/b_i.",
    "The probability is q_(i,k).",
    "The potential is Φ_(P_i).",
    "The cost is $/hour and water is priced in $/m3."
  ]) {
    assert.equal(hasOrphanMathScriptMarker(valid), false, valid);
  }
});

test("directQuestion detects direct wording and normalizes double question marks", () => {
  assert.equal(directQuestion(" Research question: How should inventory be balanced??\u200B "), "How should inventory be balanced?");
  assert.equal(directQuestion("What policy minimizes expected stockouts."), "What policy minimizes expected stockouts?");
  assert.equal(directQuestion("Inventory Balancing with Online Learning?"), "");
  assert.equal(isDirectQuestion("Could the policy learn demand?"), true);
  assert.equal(isDirectQuestion("A demand-learning policy."), false);
});

test("extraction noise catches split words, fused tokens, glyph junk, and invisibles", () => {
  assert.equal(hasExtractionNoise("The mod- ified policy balances inventory."), true);
  assert.equal(hasExtractionNoise("The formulation is ﬂex- ible across demand states."), true);
  assert.equal(hasExtractionNoise("The policy is history- and report-contingent."), false);
  assert.equal(hasExtractionNoise("The stockpile becomes progres sively available."), true);
  assert.equal(hasExtractionNoise("The stan - dard screening problem is solved analytically."), true);
  assert.equal(hasExtractionNoise("Applicant welfare is qua silinear in the platform wage."), true);
  assert.equal(hasExtractionNoise("The reward loses total mar - ), minus the fi rm cost."), true);
  assert.equal(hasExtractionNoise("The salesperson incurs C4v4t55 from effort."), true);
  assert.equal(hasExtractionNoise("themodeldescriptionwasfusedwithoutspaces and cannot be trusted"), true);
  assert.equal(hasExtractionNoise("The ffiff glyph sequence is corrupt."), true);
  assert.equal(hasExtractionNoise("The objective becomes u4t51 v4t5 {∫ T kq4t5 dt − u4t5 ≥ 03} under the extracted rule."), true);
  assert.equal(hasExtractionNoise("l := {yt, zt}t /∈ l"), true);
  assert.equal(hasExtractionNoise("A hidden\u200B separator remains."), true);
  assert.equal(hasExtractionNoise("The forecast assumes stan - dard demand."), true);
  assert.equal(hasExtractionNoise("The experts are exchangeable. cess for an expert is truncated."), true);
  assert.equal(hasExtractionNoise("The objective includes all costs related to ence between the parties."), true);
  assert.equal(hasExtractionNoise("The monitoring contract has a variable ing cost."), true);
  assert.equal(hasExtractionNoise("The policy is."), true);
  assert.equal(hasExtractionNoise("The unit production cost is known. (We extend this assumption later."), true);
  assert.equal(hasExtractionNoise("We denote the learned estimator as."), true);
  assert.equal(hasExtractionNoise(") between the two online channels."), true);
  assert.equal(hasExtractionNoise("The assembly cost facturers choose contracts."), true);
  assert.equal(hasExtractionNoise("The policy has access to the full distribution and the of queries."), true);
  assert.equal(hasExtractionNoise("The charging arcs are indexed by {1, : : : , T}."), true);
  assert.equal(hasExtractionNoise("We consider the random swapping demand dom vector following distribution P ent periods are independent."), true);
  assert.equal(hasExtractionNoise("Let N denote the battery count, and let f , t represent available inventory."), true);
  assert.equal(hasExtractionNoise("Any backlogged and fulfilled by batteries unloaded. • EV arrivals occur. • Costs are incurred."), true);
  assert.equal(hasExtractionNoise("The modified policy balances inventory across locations."), false);
  assert.equal(hasExtractionNoise("The benchmarks cover full-, no-information, and costless-search regimes."), false);
  assert.equal(hasExtractionNoise("The model compares no-, partial-, and full-adoption equilibria."), false);
  assert.equal(hasExtractionNoise("Client: max_{p in [0,1]} gamma T(1-s)p mu - delta(p s T)^2 - d|u-u_j|."), false);
  assert.equal(hasExtractionNoise("Z_r <= V*: the relaxation bounds the optimal sys - tem cost in the DP formulation."), true);
  assert.equal(hasExtractionNoise("T ) denote the vector of demand forecasts."), true);
  assert.equal(hasExtractionNoise("SOC, and the cost of the battery cell."), true);
  assert.equal(hasExtractionNoise("X i∈[K] h(x_i), where h is convex and increasing."), true);
  assert.equal(hasExtractionNoise("The comparison uses gamma - delta as a symbolic difference."), false);
  assert.equal(hasExtractionNoise("E_0 = max E_0[integral_0^tau e^{-rt}(p_t dG_t - phi dC_t) | A_0]"), false);
  assert.equal(hasExtractionNoise("common discount factor · [0,1)"), false);
  assert.equal(hasExtractionNoise("algorithm accuracy · (1/2,1]"), false);
  assert.equal(hasExtractionNoise("private forecast mean and accuracy · a in [a-underbar,a-bar], b in {b_l,b_h} in the baseline"), false);
  assert.equal(hasExtractionNoise("The malformed extraction fused words,without a separating space."), true);
  assert.equal(hasExtractionNoise("Reported cell values reflect group means. bLevel of marketing expenditures was scaled by unit sales."), true);
  assert.equal(hasExtractionNoise("cBecause the cash-flow relationship is nonmonotonic, no directional prediction is made."), true);
  assert.equal(hasExtractionNoise("The malformed function domain f(x,y] remains unbalanced in a longer sentence."), true);
  assert.equal(hasExtractionNoise("Finally, we assume that the reputation externality decreases As the figure shows, a levy changes emissions."), true);
  assert.equal(hasExtractionNoise("We consider a Figure 2.Timing of the Model Policy instrument Participating decisions Posting decisions Stage 2Stage 1 Stage 3 rational-expectations equilibrium..."), true);
  assert.equal(hasExtractionNoise("Payment structure Vendor rejects No collaboration (a) Traditional vendor-client environment offers a payment to the vendor."), true);
  assert.equal(hasExtractionNoise("Vendor rejects No collaboration (a) Traditional vendor-client environment offers a payment to the vendor."), true);
  assert.equal(hasExtractionNoise("The client selects the payment structure before collaboration begins."), false);
  assert.equal(hasExtractionNoise("A participating user can post information about any"), true);
  assert.equal(hasExtractionNoise("The extension to a setting in which the means of these normal"), true);
  assert.equal(hasExtractionNoise("achieve the best ous sections."), true);
  assert.equal(hasExtractionNoise("The /uniFB01rm selects a target."), true);
  assert.equal(hasExtractionNoise("Suppose ®θ ∈ Θ1 indexes the buyer type."), true);
  assert.equal(hasExtractionNoise("Uber® operates in many cities."), false);
  assert.equal(hasExtractionNoise("This finding holds in business settings Since the fixed cost is positive."), true);
  assert.equal(hasExtractionNoise("The client increases her the complementary effort level."), true);
  assert.equal(hasExtractionNoise("The policy creates salvage utation or history after collaboration."), true);
  assert.equal(hasExtractionNoise("In this secti on, we develop a benchmark parison."), true);
  assert.equal(hasExtractionNoise("푛observations"), true);
  assert.equal(hasExtractionNoise("픐to"), true);
  assert.equal(hasExtractionNoise("휌Wasserstein"), true);
  assert.equal(hasExtractionNoise("Figure 2 shows the timing of the model's three decision stages."), false);
  assert.equal(hasExtractionNoise("The extension to a setting in which demands are correlated"), false);
  assert.equal(hasExtractionNoise("The platform has information about any arriving customer's type."), false);
});

test("boilerplate, captions, and table-like rows are classified independently", () => {
  assert.equal(isBoilerplate("MANAGEMENT SCIENCE Vol. 70, No. 1, January 2024"), true);
  assert.equal(isBoilerplate("Downloaded from informs.org by University Library"), true);
  assert.equal(isBoilerplate("Rubel and Prasad: Dynamic Incentives in Sales Force Compensation 680 Marketing Science 35(4), pp. 676–695"), true);
  assert.equal(isBoilerplate("517–537, © 2016 INFORMS 521 and utilizes more costly options"), true);
  assert.equal(isCaption("Figure 2. Inventory trajectories under the learned policy"), true);
  assert.equal(isCaption("Table 4: Summary statistics"), true);
  assert.equal(isTableRow("1.  0.42   18.7   0.03"), true);
  assert.equal(isTableRow("Placement procedure 0.80 0.82 0.84 0.86 0.88 0.90 Competitive ratio"), true);
  assert.equal(isTableRow("(a) Without monitoring 0.25 0.75 1.00 (b) With monitoring 0.45 0.15 1.00"), true);
  assert.equal(isTableRow("Fd Fixed transfer payment (decision variable) H(·) Transfer payment function (decision variable)"), true);
  assert.equal(isTableRow("Here, S and A denote the state and action spaces; P(·|s, a) is a probability measure."), false);
  assert.equal(isTableRow("The estimator uses E[R | X, Y, P] and V(π) under observed demand."), false);
  assert.equal(isTableRow("Buyers know R(q | q) but do not observe R(q | q′)."), false);
  assert.equal(isBoilerplate("Pricing Department, Priceline, Toronto, Ontario M5V 2H2, Canada"), true);
  assert.equal(isBoilerplate("Engineering, North Carolina State University, Raleigh, North Carolina 27695"), true);
  assert.equal(isBoilerplate("More details of CMM are presented in Online Appendix"), true);
  assert.equal(isBoilerplate("Emergency Department Pricing and Capacity"), false);
  assert.equal(isBoilerplate("Inventory balancing under uncertain demand"), false);
});

test("a two-comma university postal heading is affiliation boilerplate", () => {
  assert.equal(
    isBoilerplate("Pennsylvania State University, University Park, Pennsylvania 16802"),
    true,
  );
});

test("paper roadmaps are reusable organizational boilerplate, not model prose", () => {
  const roadmaps = [
    "In Section 5, I extend the model by allowing dynamic discounts.",
    "Section 4.1 derives the optimal price and credit refund.",
    "In Section 7.1,w e analyze the case with a general demand function.",
    "First, in Section 6.1 , we derive the reward approximation error between the hierarchical reformulation and the frozen-state approximation.",
    "Finally, Section 6.4 develops the regret bound for the selected horizon.",
    "In the following section, we propose a heuristic policy for the relaxed problem.",
    "In the next subsection, we derive the charging-rate reformulation.",
    "The remainder of this paper is organized as follows."
  ];
  for (const value of roadmaps) {
    assert.equal(isPaperOrganizationProse(value), true, value);
    assert.equal(isBoilerplate(value), true, value);
  }
  assert.equal(isPaperOrganizationProse("The model derives the optimal price under uncertain demand."), false);
  assert.equal(assessHeading("3. In Section 5, I extend the model by giving").reason, "boilerplate");
});

test("citation and caption checks retain substantive prose and generated search language", () => {
  assert.equal(isCitation("Keneally et al. (2016)"), true);
  assert.equal(isCitation("The myopic policy of Keneally et al. (2016) serves requests in arrival order."), false);
  assert.equal(isCaption("Algorithm 1. Online allocation procedure"), true);
  assert.equal(isCaption("algorithm 1 for exchangeable online decisions"), false);
});

test("heading assessment rejects citations, captions, numbered list rows, and prose", () => {
  assert.deepEqual(assessHeading("2. Smith et al. (2021)"), {
    accepted: false, number: "", title: "", consumedContinuation: false, reason: "citation"
  });
  assert.equal(assessHeading("Table 2. Summary Statistics").reason, "caption");
  assert.equal(assessHeading("1) Estimate demand for every item").reason, "list-row");
  assert.equal(assessHeading("3. We now derive the optimal policy.").reason, "prose-fragment");
  assert.equal(assessHeading("MARKETING SCIENCE Vol. 42, No. 3").reason, "boilerplate");
  assert.equal(assessHeading("Pricing Department, Priceline, Toronto, Ontario M5V 2H2, Canada").reason, "boilerplate");
  assert.equal(assessHeading("8. The extension to a setting in which the means of these normal").reason, "extraction-noise");
  assert.equal(isQualityHeading("4. Model Formulation"), true);
});

test("wrapped headings are joined only through a plausible continuation", () => {
  const wrapped = assessHeading("3.2 Inventory Balancing with", "Online Learning");
  assert.deepEqual(wrapped, {
    accepted: true,
    number: "3.2",
    title: "Inventory Balancing with Online Learning",
    consumedContinuation: true,
    reason: "heading"
  });
  assert.equal(assessHeading("3.2 Inventory Balancing with").reason, "dangling-heading");
  assert.equal(assessHeading("3.2 Inventory Balancing with", "we next prove the theorem.").reason, "dangling-heading");

  const byWrapped = assessHeading("4.2 Implementation of Optimal Mechanism by", "Two-Part Tariff Contracts");
  assert.equal(byWrapped.accepted, true);
  assert.equal(byWrapped.title, "Implementation of Optimal Mechanism by Two-Part Tariff Contracts");
});

test("literal source selection skips audit failures and preserves an exact normalized substring", () => {
  const rawPage = [
    "MANAGEMENT SCIENCE Vol. 70, No. 1, January 2024",
    "Figure 1. Inventory paths under three policies.",
    "The mod- ified benchmark cannot be used as a clean quotation.",
    "The inventory policy balances stock across locations under uncertain demand.",
    "The proof then establishes a logarithmic regret bound for this policy."
  ].join("\n");
  const quote = selectLiteralSourceSentence(rawPage, "inventory balancing uncertain demand");
  assert.equal(quote, "The inventory policy balances stock across locations under uncertain demand.");
  assert.equal(isWhitespaceNormalizedSubstring(quote, rawPage), true);
  assert.ok(literalSourceSentenceCandidates(rawPage).includes(quote));
  assert.ok(!literalSourceSentenceCandidates(rawPage).some((candidate) => /mod- ified|Figure 1|MANAGEMENT SCIENCE/.test(candidate)));
});

test("literal quote checks preserve the raw PDF ligature", () => {
  assert.equal(
    isWhitespaceNormalizedSubstring("The firm chooses a policy.", "The ﬁrm\nchooses a policy."),
    false
  );
  assert.equal(
    isWhitespaceNormalizedSubstring("The ﬁrm chooses a policy.", "The ﬁrm\nchooses a policy."),
    true
  );
});

test("normalized source quotes remap to raw ligatures, combining marks, and math alphabets", () => {
  const rawPage = "The ﬁrm chooses capacity a\u0304 and multiplier 𝜆 under uncertain demand.";
  const normalizedCandidate = "The firm chooses capacity ā and multiplier λ under uncertain demand.";
  const quote = remapNormalizedSourceQuote(normalizedCandidate, rawPage);

  assert.equal(quote, rawPage);
  assert.equal(isWhitespaceNormalizedSubstring(quote, rawPage), true);
  assert.match(quote, /ﬁrm/u);
  assert.match(quote, /a\u0304/u);
  assert.match(quote, /𝜆/u);
  assert.doesNotMatch(quote, /The firm/u);
});

test("soft-hyphen line wraps join for scoring while preserving a literal raw source span", () => {
  const publisherPage = "The pub\u00ad\nlisher may multihome when doing so raises its utility.";
  const publisherQuote = "The publisher may multihome when doing so raises its utility.";
  const monopolyPage = "The monopo\u00ad listic platform sets its commission before publishers enter.";
  const monopolyQuote = "The monopolistic platform sets its commission before publishers enter.";

  assert.equal(stripInvisible(publisherPage), publisherQuote);
  assert.equal(stripInvisible(monopolyPage), monopolyQuote);
  assert.equal(hasExtractionNoise(publisherPage), false);
  assert.equal(hasExtractionNoise(monopolyPage), false);
  assert.equal(remapNormalizedSourceQuote(publisherQuote, publisherPage), "The pub\u00ad lisher may multihome when doing so raises its utility.");
  assert.equal(remapNormalizedSourceQuote(monopolyQuote, monopolyPage), monopolyPage);
  assert.equal(hasExtractionNoise("The mod- ified allocation rule is used."), true);
});

test("literal selection never repairs a noisy source into a nonliteral quote", () => {
  const rawPage = "The mod- ified allocation rule is the only candidate sentence.";
  assert.equal(selectLiteralSourceSentence(rawPage, "modified allocation"), "");
  assert.equal(isWhitespaceNormalizedSubstring("The modified allocation rule", rawPage), false);
  const ligaturePage = "The ﬁrm balances inventory across locations before demand is observed.";
  assert.equal(selectLiteralSourceSentence(ligaturePage, "firm inventory"), ligaturePage);
});

test("literal selection excludes caption-timeline splices, mojibake, and appendix pointers", () => {
  const rawPage = [
    "We consider a Figure 2.Timing of the Model Policy instrument Participating decisions Posting decisions Stage 2Stage 1 Stage 3 rational-expectations equilibrium.",
    "The estimator uses 휌Wasserstein ambiguity around the empirical distribution.",
    "More details of CMM are presented in Online Appendix.",
    "The platform chooses a participation policy before users post information."
  ].join("\n");
  assert.deepEqual(literalSourceSentenceCandidates(rawPage), [
    "The platform chooses a participation policy before users post information."
  ]);
  assert.equal(
    selectLiteralSourceSentence(rawPage, "platform participation policy users"),
    "The platform chooses a participation policy before users post information."
  );
});

test("literal selection recovers clean multiline prose without repairing broken words", () => {
  const rawPage = [
    "The preceding display ends without sentence punctuation",
    "By setting the payment terms to the stated levels, the client",
    "maximizes total value and her utility. This implication is",
    "discussed after the lemma.",
    "The mod-",
    "ified policy is not a publishable literal quotation."
  ].join("\n");
  const quote = "By setting the payment terms to the stated levels, the client maximizes total value and her utility.";
  assert.ok(literalSourceSentenceCandidates(rawPage).includes(quote));
  assert.equal(isWhitespaceNormalizedSubstring(quote, rawPage), true);
  assert.equal(literalSourceSentenceCandidates(rawPage).some((candidate) => /modified policy/i.test(candidate)), false);
});

test("literal selection rejects lowercase line-tail fragments masquerading as sentences", () => {
  const rawPage = [
    "prac",
    "tical sense, and therefore we impose this inventory constraint.",
    "The model instead imposes a practical inventory constraint on every allocation."
  ].join("\n");
  const candidates = literalSourceSentenceCandidates(rawPage);
  assert.equal(candidates.some((candidate) => candidate.startsWith("tical sense")), false);
  assert.equal(literalSourceSentenceCandidates("at the station until fulfilled in subsequent periods.").length, 0);
  assert.equal(
    selectLiteralSourceSentence(rawPage, "practical inventory constraint allocation"),
    "The model instead imposes a practical inventory constraint on every allocation."
  );
});

test("literal selection retains explicit stage-timing sentences", () => {
  const rawPage = [
    "In the first stage, the payer announces a reimbursement payment for telehealth visits.",
    "In the second stage, the provider decides on a capacity commitment between the two channels.",
    "In the third stage, patients choose strategically between the channels."
  ].join("\n");
  const candidates = literalSourceSentenceCandidates(rawPage);
  assert.ok(candidates.includes("In the first stage, the payer announces a reimbursement payment for telehealth visits."));
  assert.ok(candidates.includes("In the second stage, the provider decides on a capacity commitment between the two channels."));
  assert.ok(candidates.includes("In the third stage, patients choose strategically between the channels."));
});

test("literal selection separates a complete clause from a lowercase i.e. formula", () => {
  const rawPage = "Without loss of generality, price is the endogenous variable. i.e., E[p · ε] = 0.";
  assert.ok(literalSourceSentenceCandidates(rawPage).includes("Without loss of generality, price is the endogenous variable."));
});

test("literal selection requires positive local overlap when a focus is supplied", () => {
  const page = "The seller chooses a price before demand arrives. The proof is deferred to the appendix.";
  assert.equal(selectLiteralSourceSentence(page, "hospital bed allocation"), "");
  assert.equal(selectLiteralSourceSentence(page, "seller price"), "The seller chooses a price before demand arrives.");
});

test("semantic component fingerprints ignore superficial order and invisible characters", () => {
  const left = {
    id: "allocation-a",
    label: "Inventory allocation",
    role: "decision",
    concepts: ["inventory-control", "resource-allocation"],
    explanation: "Allocate inventory across locations under uncertain demand.",
    searchPhrases: ["balancing inventory", "allocation policy"],
    conditions: ["Capacity is finite."],
    formal: "x_1 + x_2 <= B"
  };
  const right = {
    id: "different-id",
    label: "Inventory\u200B allocation!",
    role: "decision",
    concepts: ["resource-allocation", "inventory-control"],
    explanation: "Allocate inventory across locations under uncertain demand",
    searchPhrases: ["allocation policy", "balancing inventory"],
    conditions: ["Capacity is finite"],
    formal: "x_1 + x_2 <= B"
  };
  assert.match(semanticFingerprint(left), /^[a-f0-9]{64}$/);
  assert.equal(componentFingerprint(left), semanticFingerprint(left));
  assert.equal(semanticSignature(left), semanticSignature(right));
  assert.equal(sameSemanticComponent(left, right), true);
  assert.notEqual(semanticFingerprint(left), semanticFingerprint({ ...right, role: "objective" }));
  assert.equal(semanticFingerprint("\u200B"), "");
});
