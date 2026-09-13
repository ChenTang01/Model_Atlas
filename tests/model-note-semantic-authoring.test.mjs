import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanSemanticText,
  completeModelSetupFromSource,
  deriveModelSetup,
  deriveResearchQuestion,
  deriveSubstantiveMethod,
  isDirectResearchQuestion,
  isSubstantiveMethodStatement,
  SEMANTIC_MATURITY
} from "../scripts/model-note-semantic-authoring.mjs";

test("an authored research question is retained with exactly one terminal question mark", () => {
  const result = deriveResearchQuestion({
    business_question: "When can customers reveal their private preferences??"
  });

  assert.equal(result.question, "When can customers reveal their private preferences?");
  assert.equal(result.maturity, SEMANTIC_MATURITY.AUTHORED);
  assert.deepEqual(result.source, { field: "business_question" });
  assert.equal(isDirectResearchQuestion(result.question), true);
});

test("a title copied into business_question is rejected in favor of an abstract purpose sentence", () => {
  const title = "Pricing Data Services: Pricing by Minutes or by Megabytes?";
  const result = deriveResearchQuestion({
    title,
    business_question: title,
    abstract: "We study how a data-service provider should choose between time-based and volume-based pricing."
  });

  assert.equal(
    result.question,
    "How should a data-service provider choose between time-based and volume-based pricing?"
  );
  assert.equal(result.maturity, SEMANTIC_MATURITY.DERIVED);
  assert.deepEqual(result.source, {
    field: "abstract",
    sentence: 1,
    transformation: "purpose-to-question"
  });
  assert.ok(result.diagnostics.some(({ code }) => code === "business_question_is_title"));
  assert.doesNotMatch(result.question, /What model does/i);
});

test("a purpose sentence is transformed into a grounded allocation question", () => {
  const result = deriveResearchQuestion({
    title: "Inventory Balancing with Online Learning",
    abstract: "We study a general problem of allocating limited resources to heterogeneous customers over time under model uncertainty."
  });

  assert.equal(
    result.question,
    "How should limited resources be allocated to heterogeneous customers over time under model uncertainty?"
  );
  assert.equal(result.maturity, SEMANTIC_MATURITY.DERIVED);
});

test("an explicit study purpose outranks an earlier mechanism definition", () => {
  const result = deriveResearchQuestion({
    title: "Clocking in or Not? Optimal Design of a Novel Gamified Business Model in Online Learning",
    business_question: "Clocking-in cash-back (CIC), an emerging gamified business model in online learning, has recently garnered significant attention.",
    model_topic: "Clocking-in cash-back (CIC), an emerging gamified business model in online learning, has recently garnered significant attention.",
    abstract: [
      "Clocking-in cash-back (CIC), an emerging gamified business model in online learning, has recently garnered significant attention.",
      "CIC allows users to secure a full refund of the course fee through consecutive completion of specific tasks within a required time window.",
      "This paper fills this critical gap by examining how an online learning firm should set the optimal time window for its course and how the time window is affected by context-specific factors."
    ].join(" ")
  });

  assert.equal(
    result.question,
    "How should an online learning firm set the optimal time window for its course and how is the time window affected by context-specific factors?"
  );
  assert.deepEqual(result.source, {
    field: "abstract",
    sentence: 3,
    transformation: "purpose-to-question"
  });
  assert.doesNotMatch(result.question, /CIC allow users to secure a full refund/i);
  assert.equal(isDirectResearchQuestion(result.question), true);
  assert.equal(
    isDirectResearchQuestion("How should a firm set the time window and how the time window is affected by context-specific factors?"),
    false
  );
});

test("green-but-malformed question transforms fall through to grounded study questions", () => {
  for (const malformed of [
    "How may although volatile marketing spending improve performance, it can also increase volatility?",
    "How are the findings inform the retailer about aligning and the upstream supplier combined?",
    "How does second, the equilibrium cluster size increase in the valuation-cost ratio?",
    "How are Qualcomm had adopted a cross-licensing agreement and its clients combined?"
  ]) assert.equal(isDirectResearchQuestion(malformed), false, malformed);

  const volatility = deriveResearchQuestion({
    business_question: "Although volatile marketing spending, as opposed to even-level spending, may improve a brand’s financial performance, it can also increase the volatility of performance, which is not a desirable outcome.",
    model_topic: "Although volatile marketing spending, as opposed to even-level spending, may improve a brand’s financial performance, it can also increase the volatility of performance, which is not a desirable outcome.",
    abstract: "Although volatile marketing spending may improve performance, it can also increase volatility. This article analyzes how revenue and cash-flow volatility are influenced by own and competitive marketing spending volatility."
  });
  assert.equal(
    volatility.question,
    "How are revenue and cash-flow volatility influenced by own and competitive marketing spending volatility?"
  );

  const showrooming = deriveResearchQuestion({
    business_question: "Consumer showrooming has become a common phenomenon in the retail industry, but little is known about its influence on the interplay between an upstream supplier and a downstream retailer in a distribution channel."
  });
  assert.equal(
    showrooming.question,
    "How does consumer showrooming influence the interplay between an upstream supplier and a downstream retailer in a distribution channel?"
  );

  const clusters = deriveResearchQuestion({
    business_question: "We develop a game-theoretic model to explore why retail clusters are so popular in developing economies and when governments should facilitate the formation of retail clusters to improve social welfare."
  });
  assert.equal(
    clusters.question,
    "Why are retail clusters so popular in developing economies and when should governments facilitate the formation of retail clusters to improve social welfare?"
  );

  const crossLicensing = deriveResearchQuestion({
    business_question: "Problem definition: Qualcomm, the largest cellphone chipmaker in the world, had adopted a cross-licensing agreement with its clients, downstream cellphone manufacturers.",
    abstract: "Problem definition: Qualcomm had adopted a cross-licensing agreement with its clients. We study the impacts of cross-licensing in a supply chain with asymmetric manufacturers."
  });
  assert.equal(
    crossLicensing.question,
    "How does cross-licensing affect a supply chain with asymmetric manufacturers?"
  );
});

test("a full interrogative paper title cannot bypass a substantive source purpose", () => {
  const result = deriveResearchQuestion({
    title: "Should an Ad Agency Offer Geoconquesting or Protection from It?",
    business_question: "This study examines the interaction between top-of-funnel advertising and bottom-of-funnel advertising.",
    abstract: "Geoconquesting efforts by a competing firm should reduce a focal firm’s incentive to invest in top-of-funnel efforts."
  });

  assert.equal(result.question, "How do top-of-funnel advertising and bottom-of-funnel advertising interact?");
  assert.deepEqual(result.source, { field: "business_question", transformation: "purpose-to-question" });
  assert.notEqual(cleanSemanticText(result.question).toLowerCase(), "should an ad agency offer geoconquesting or protection from it?");
  assert.equal(isDirectResearchQuestion(result.question), true);
});

test("explicit purpose relations produce direct questions instead of interrogative-title copies", () => {
  const cases = [
    [
      "We characterize the social norms and network structures that are susceptible to this kind of manipulation and derive conditions under which a social network is impervious and cannot be manipulated.",
      "Which social norms and network structures are susceptible to this kind of manipulation?"
    ],
    [
      "In this paper, we analyze the maximum possible revenue that can be earned in this setting, given that the buyer’s preference is private, but drawn from a known distribution.",
      "How can revenue be earned in this setting, given that the buyer’s preference is private and drawn from a known distribution?"
    ],
    [
      "We compare the resulting equilibria for these two scenarios and evaluate the impact of customers’ strategic behavior.",
      "How are the resulting equilibria for these two scenarios affected by customers’ strategic behavior?"
    ],
    [
      "We aim to examine the centralized dispute system and the decentralized dispute system in order to assess whether the latter has an advantage over the former.",
      "How do the centralized dispute system and the decentralized dispute system compare?"
    ],
    [
      "We seek to determine the optimal use and potential benefits of a fractionated vaccine dose, given the supply constraints faced by a country.",
      "How should a fractionated vaccine dose be used given the supply constraints faced by a country?"
    ],
    [
      "We identify two ways in which competition limits the effectiveness of advance selling.",
      "How does competition limit the effectiveness of advance selling?"
    ],
    [
      "Problem definition: This paper examines the impact of nonrandomness on random choice models and studies various operations problems under the new discrete choice models.",
      "How are random choice models affected by nonrandomness?"
    ],
    [
      "We examine when the decision to purchase the discrete service depends only on its full price.",
      "When does the decision to purchase the discrete service depend only on its full price?"
    ]
  ];

  for (const [source, expected] of cases) {
    const result = deriveResearchQuestion({ business_question: source });
    assert.equal(result.question, expected, source);
    assert.equal(isDirectResearchQuestion(result.question), true, source);
  }
});

test("modal effect assertions produce grammatical questions and stacked auxiliaries fail closed", () => {
  const result = deriveResearchQuestion({
    abstract: "We study how geoconquesting efforts by a competing firm should reduce a focal firm’s incentive to invest in top-of-funnel efforts."
  });

  assert.equal(
    result.question,
    "How should geoconquesting efforts by a competing firm reduce a focal firm’s incentive to invest in top-of-funnel efforts?"
  );
  assert.equal(
    isDirectResearchQuestion("How does geoconquesting efforts by a competing firm should reduce a focal firm’s incentive to invest?"),
    false
  );
});

test("active purpose clauses stay active instead of becoming finite-verb combination artifacts", () => {
  const surge = deriveResearchQuestion({
    title: "Driver Surge Pricing",
    business_question: "Ride-hailing marketplaces like Uber and Lyft use dynamic pricing, often called surge, to balance the supply of available drivers with the demand for rides."
  });
  assert.equal(
    surge.question,
    "How do ride-hailing marketplaces like Uber and Lyft use dynamic pricing, often called surge, to balance the supply of available drivers with the demand for rides?"
  );

  const cluster = deriveResearchQuestion({
    title: "Co-Opetition in Service Clusters with Waiting-Area Entertainment",
    business_question: "Problem definition: Unoccupied waiting feels longer than it actually is.",
    abstract: "A service cluster with a common space provides firms with an opportunity to cooperate in the investment for providing entertainment options while competing on other service dimensions."
  });
  assert.equal(
    cluster.question,
    "How does a service cluster with a common space enable firms to cooperate in the investment for providing entertainment options while competing on other service dimensions?"
  );
  assert.equal(
    isDirectResearchQuestion("How are platforms use dynamic pricing with demand combined?"),
    false
  );
});

test("a punctuated title fragment is not mislabeled as a direct research question", () => {
  const title = "Bring a Friend! Privately or Publicly?";
  const result = deriveResearchQuestion({ title, business_question: title });

  assert.equal(result.question, "");
  assert.equal(result.maturity, SEMANTIC_MATURITY.UNRESOLVED);
  assert.equal(result.source, null);
  assert.ok(result.diagnostics.some(({ code }) => code === "research_question_unresolved"));
  assert.equal(isDirectResearchQuestion(title), false);
});

test("a relation-bearing model topic yields a question without quoting the paper title", () => {
  const result = deriveResearchQuestion({
    title: "A Long Paper Title That Must Not Be Wrapped in Boilerplate",
    model_topic: "Customer preference revelation through cheap talk before bilateral price bargaining"
  });

  assert.equal(
    result.question,
    "How does cheap talk before bilateral price bargaining contribute to customer preference revelation?"
  );
  assert.equal(result.maturity, SEMANTIC_MATURITY.DERIVED);
  assert.equal(result.source.field, "model_topic");
  assert.doesNotMatch(result.question, /A Long Paper Title/);
});

test("a paper-proposed characterization yields a source question instead of a title wrapper", () => {
  const result = deriveResearchQuestion({
    title: "Choice Models and Permutation Invariance: Deep Demand Estimation in Differentiated Products Markets",
    business_question: "This paper proposes a fundamental characterization of choice functions for flexible, data-driven demand estimation in differentiated products markets, accommodating endogenous product features and enabling valid inference on price elasticities."
  });

  assert.equal(
    result.question,
    "How can choice functions be characterized for flexible, data-driven demand estimation in differentiated products markets?"
  );
  assert.equal(result.maturity, SEMANTIC_MATURITY.DERIVED);
  assert.equal(result.source.field, "business_question");
  assert.doesNotMatch(result.question, /Choice Models and Permutation Invariance|operate in/i);
});

test("catalog-wide question boilerplate falls through to a relation-specific title question", () => {
  const cases = [
    [
      "The Strategic Implications of Scale in Choice-Based Conjoint Analysis",
      "How does scale affect strategic outcomes in choice-based conjoint analysis?"
    ],
    [
      "Direct Sourcing or Agent Sourcing? Contract Negotiation in Procurement Outsourcing",
      "How do direct sourcing and agent sourcing compare for contract negotiation in procurement outsourcing?"
    ],
    [
      "Reliable Hub Location Model for Air Transportation Networks Under Random Disruptions",
      "How do random disruptions affect reliable hub location for air transportation networks?"
    ],
    [
      "Dynamic Capacity Allocation for Elective Surgeries: Reducing Urgency-Weighted Wait Times",
      "How should urgency-weighted wait times be reduced?"
    ],
    [
      "Rewarding Suppliers’ Performance via Allocation of Business",
      "How does allocation of business contribute to rewarding suppliers’ performance?"
    ]
  ];

  for (const [title, expected] of cases) {
    const result = deriveResearchQuestion({
      title,
      model_topic: title,
      business_question: "What modeling problem does this article address in supply chains & operations?"
    });
    assert.equal(result.question, expected, title);
    assert.ok(result.diagnostics.some(({ code }) => code === "business_question_is_placeholder"));
    assert.doesNotMatch(result.question, /what modeling problem does this article/i);
  }
});

test("substantive interrogative title clauses survive descriptive subtitles", () => {
  const cases = [
    [
      "Should Online Content Providers Be Allowed To Subsidize Content?-An Economic Analysis",
      "Should online content providers be allowed to subsidize content?"
    ],
    [
      "Higher Prices for Larger Quantities? Nonmonotonic Price–Quantity Relations in B2B Markets",
      "Are prices higher for larger quantities?"
    ],
    [
      "Should We Wait Before Outsourcing? Analysis of a Revenue-Generating Blended Contact Center",
      "Should we wait before outsourcing?"
    ],
    [
      "Can Deep Reinforcement Learning Improve Inventory Management? Performance on Lost Sales, Dual-Sourcing, and Multi-Echelon Problems",
      "Can deep reinforcement learning improve inventory management?"
    ],
    [
      "Human in the Loop Automation: Ride-Hailing with Remote (Tele-)Drivers",
      "How does human-in-the-loop automation affect ride-hailing with remote drivers?"
    ]
  ];

  for (const [title, expected] of cases) {
    const result = deriveResearchQuestion({
      title,
      model_topic: title,
      business_question: "What modeling problem does this article address in operations?"
    });

    assert.equal(result.question, expected, title);
    assert.equal(result.maturity, SEMANTIC_MATURITY.DERIVED, title);
    assert.deepEqual(result.source, {
      field: "title",
      transformation: "substantive-title-clause"
    });
    assert.equal(isDirectResearchQuestion(result.question), true, title);
  }
});

test("an explicit optimization challenge outranks labeled definitional allows prose", () => {
  const definition = "Problem definition: Battery swapping allows electric vehicle (EV) drivers to exchange depleted batteries for fully charged ones at dedicated stations.";
  const challenge = "Thus, the battery-swapping station (BSS) faces the central challenge of optimizing charging rate to jointly ensure service quality and cost efficiency.";
  const result = deriveResearchQuestion({
    business_question: definition,
    model_topic: definition,
    abstract: `${definition} ${challenge}`
  });

  assert.equal(
    result.question,
    "How should the battery-swapping station (BSS) optimize charging rate to jointly ensure service quality and cost efficiency?"
  );
  assert.deepEqual(result.source, {
    field: "abstract",
    sentence: 2,
    transformation: "objective-to-question"
  });
  assert.doesNotMatch(result.question, /allow.+exchange/i);
  assert.equal(isDirectResearchQuestion(result.question), true);
});

test("abstract field labels are removed before retaining a direct source question", () => {
  const result = deriveResearchQuestion({
    business_question: "Problem definition: How should online retailers make demand predictions with limited relevant data?"
  });

  assert.equal(result.question, "How should online retailers make demand predictions with limited relevant data?");
  assert.equal(result.maturity, SEMANTIC_MATURITY.DERIVED);
});

test("malformed wh clauses, slogan fragments, and generic fallbacks are not direct questions", () => {
  const rejected = [
    "How does we allocate inventory?",
    "What determines two-sided platforms rely on recommendation algorithms?",
    "What determines revenue management in railways distinguishes itself from airline revenue management?",
    "How are motivated by practice, we consider a model with commitment combined?",
    "When Being Hot Is Not Cool?",
    "What determines modeled outcomes in queueing systems?",
    "How does under the special case of stationary demand single-item pricing, our results improve understanding?",
    "How does sensors can improve their own estimates by soliciting estimates from other sensors?",
    "How does certain conditions affect our results suggest that an intermediate level of flexibility may help?",
    "How does a given batch constraint and only able to observe rewards, can dynamically decide the next batch affect learning?"
  ];

  for (const question of rejected) assert.equal(isDirectResearchQuestion(question), false, question);
  assert.equal(isDirectResearchQuestion("When can customers reveal their private preferences?"), true);
  assert.equal(isDirectResearchQuestion("How should online retailers make decisions with limited data?"), true);
});

test("a slogan-like when title remains unresolved instead of being inverted into a question", () => {
  const title = "When Being Hot Is Not Cool";
  const result = deriveResearchQuestion({ title, model_topic: title, business_question: title });

  assert.equal(result.question, "");
  assert.equal(result.maturity, SEMANTIC_MATURITY.UNRESOLVED);
  assert.ok(result.diagnostics.some(({ code }) => code === "research_question_unresolved"));
});

test("declarative source clauses are transformed only when they express a recoverable relation", () => {
  const platform = deriveResearchQuestion({
    business_question: "Two-sided platforms rely on their recommendation algorithms to help visitors successfully find a match."
  });
  assert.equal(
    platform.question,
    "How can two-sided platforms use their recommendation algorithms to help visitors successfully find a match?"
  );

  const marketplace = deriveResearchQuestion({
    business_question: "We consider a two-sided marketplace in which a market operator sells services to clients and buys services from vendors.",
    abstract: "The market operator determines the prices dynamically for both clients and vendors."
  });
  assert.equal(
    marketplace.question,
    "How does the market operator determine the prices dynamically for both clients and vendors?"
  );

  const resourceAllocation = deriveResearchQuestion({
    business_question: "We study the problem of maximizing payoff in a closed queueing network with a fixed number of supply units."
  });
  assert.equal(
    resourceAllocation.question,
    "How can payoff be maximized in a closed queueing network with a fixed number of supply units?"
  );

  const focalPoint = deriveResearchQuestion({
    title: "Comment on “Is Leasing Greener Than Selling?” and Remark on the Focal Point Analysis in Durable Goods Models",
    business_question: "The focal point analysis is a viable approach to analyze models of finitely durable goods in infinite time horizon."
  });
  assert.equal(
    focalPoint.question,
    "How can the focal point analysis be used to analyze models of finitely durable goods in infinite time horizon?"
  );
});

test("malformed intermediate abstract transformations are skipped for a later grounded question", () => {
  const result = deriveResearchQuestion({
    business_question: "Observable priority queues are prevalent in many service systems.",
    model_topic: "Observable priority queues are prevalent in many service systems.",
    abstract: [
      "We then examine steady-state performance under rational abandonment in contrast with an exogenous abandonment model.",
      "We further investigate optimal pricing strategies under rational abandonment."
    ].join(" ")
  });

  assert.equal(result.question, "How does rational abandonment affect optimal pricing strategies?");
  assert.equal(isDirectResearchQuestion(result.question), true);
});

test("a copular clause containing with is not rewritten as a combined-items question", () => {
  const result = deriveResearchQuestion({
    title: "To Brush or Not to Brush: Product Rankings, Consumer Search, and Fake Orders",
    business_question: "Brushing-online merchants placing fake orders of their own products-has been a widespread phenomenon on major e-commerce platforms.",
    model_topic: "Brushing-online merchants placing fake orders of their own products-has been a widespread phenomenon on major e-commerce platforms.",
    abstract: "Products with higher sales volume are more likely to rank higher. Thus, fake orders can affect consumer choice."
  });
  assert.equal(result.question, "How can fake orders affect consumer choice?");
  assert.equal(isDirectResearchQuestion(result.question), true);
});

test("taxonomy metadata is rejected and a local solution sentence supplies the method", () => {
  const result = deriveSubstantiveMethod(
    {
      method: "Optimization; Analytical modeling",
      abstract: "We study inventory allocation under uncertainty."
    },
    [{
      title: "Solution Approach",
      page: 5,
      text: "We formulate a mixed-integer program and solve it using Benders decomposition. We report numerical results afterward."
    }]
  );

  assert.equal(
    result.method,
    "The paper formulates a mixed-integer program and solves it using Benders decomposition."
  );
  assert.equal(result.maturity, SEMANTIC_MATURITY.DERIVED);
  assert.deepEqual(result.source, { section: "Solution Approach", page: 5, sentence: 1 });
  assert.ok(result.diagnostics.some(({ reason }) => reason === "taxonomy_not_method"));
  assert.equal(isSubstantiveMethodStatement(result.method), true);
});

test("a substantive authored method is preferred over section inference", () => {
  const method = "The authors solve the screening benchmark by backward induction and derive separation thresholds using Bayesian incentive constraints.";
  const result = deriveSubstantiveMethod(
    { method },
    [{ title: "Method", text: "We solve a smaller illustrative problem." }]
  );

  assert.equal(result.method, method);
  assert.equal(result.maturity, SEMANTIC_MATURITY.AUTHORED);
  assert.deepEqual(result.source, { field: "method" });
});

test("reviewed noun-led procedures are retained while result tails are trimmed", () => {
  const reviewed = "Stationary queueing analysis and patient indifference conditions characterize the downstream symmetric equilibrium; regime thresholds and concavity then solve the provider response and payer policy by backward induction.";
  const result = deriveSubstantiveMethod({ method: reviewed });

  assert.equal(result.method, reviewed);
  assert.equal(result.maturity, SEMANTIC_MATURITY.AUTHORED);
  assert.equal(isSubstantiveMethodStatement(reviewed), true);

  const tailed = deriveSubstantiveMethod({}, [{
    title: "Equilibrium Analysis",
    page: 4,
    text: "We solve the provider's response by backward induction and find that the payer never selects the high-access regime."
  }]);
  assert.equal(tailed.method, "The paper solves the provider's response by backward induction.");
  assert.equal(isSubstantiveMethodStatement("We solve the provider's response by backward induction and find that the payer never selects the high-access regime."), false);
});

test("abstract openings and scope-review placeholders do not masquerade as methods", () => {
  const abstract = "We study a general inventory allocation problem under uncertainty. Demand varies over time.";
  const result = deriveSubstantiveMethod({
    method: "We study a general inventory allocation problem under uncertainty.",
    method_summary: "The scope review identified the modeling contribution but did not independently map it.",
    abstract
  });

  assert.equal(result.method, "");
  assert.equal(result.maturity, SEMANTIC_MATURITY.UNRESOLVED);
  assert.ok(result.diagnostics.some(({ reason }) => reason === "abstract_purpose_opening"));
  assert.ok(result.diagnostics.some(({ reason }) => reason === "scope_or_generator_placeholder"));
  assert.ok(result.diagnostics.some(({ code }) => code === "method_unresolved"));
});

test("proof scaffolding and split-word extraction noise are not substantive methods", () => {
  const result = deriveSubstantiveMethod(
    { method: "Optimization; Analytical modeling" },
    [{
      title: "Proof and Analysis",
      text: "To prove Lemma 1, we make use of the following result. Using Lemma A.1,w ec a ns t a t et h a t the inequality follows."
    }]
  );

  assert.equal(result.method, "");
  assert.equal(result.maturity, SEMANTIC_MATURITY.UNRESOLVED);
  assert.equal(
    isSubstantiveMethodStatement("First, we derive the expected manufacturer and retailer pro fits in a decentralized supply chain."),
    false
  );
});

test("citation-led third-party results are rejected in favor of the paper's own method", () => {
  const result = deriveSubstantiveMethod(
    { method: "Analytical modeling; Analytical-empirical hybrid" },
    [
      {
        title: "Equilibrium Analysis",
        page: 4,
        text: "Harker (1986) establishes a similar result using variational inequalities."
      },
      {
        title: "Model contribution and method",
        page: 1,
        text: "We provide a characterization of equilibrium quantities by reducing the firms' first-order conditions to a linear complementarity problem."
      }
    ]
  );

  assert.equal(
    result.method,
    "The paper provides a characterization of equilibrium quantities by reducing the firms' first-order conditions to a linear complementarity problem."
  );
  assert.deepEqual(result.source, { section: "Model contribution and method", page: 1, sentence: 1 });
  assert.equal(isSubstantiveMethodStatement("Harker (1986) establishes a similar result using variational inequalities."), false);
});

test("proof and setup scaffolding cannot qualify through a later action verb", () => {
  const scaffolding = [
    "Let x denote the candidate allocation constructed by Algorithm 1.",
    "Fix a price vector and derive the resulting first-order conditions.",
    "Recall that the dynamic program solves the finite-horizon problem.",
    "Denote by beta the parameter estimated in the second stage.",
    "Assume demand is stationary and solve the retailer's optimization problem.",
    "That is, letting M be the feasible set, our objective is to identify a minimizing policy.",
    "Given graph G, each firm solves the following optimization problem."
  ];

  for (const sentence of scaffolding) {
    assert.equal(isSubstantiveMethodStatement(sentence), false, sentence);
  }
});

test("method citations remain valid when the paper owns the procedural action", () => {
  const sentence = "Following Harker (1986), we formulate the equilibrium conditions as variational inequalities and solve them by fixed-point iteration.";
  assert.equal(isSubstantiveMethodStatement(sentence), true);

  const result = deriveSubstantiveMethod(
    { method: "Optimization; Algorithm design" },
    [{
      title: "Main Results",
      page: 3,
      text: "The latter mechanism allows us to devise a purely combinatorial algorithm for efficiently approximating optimal replenishment policies within any degree of accuracy."
    }]
  );

  assert.equal(
    result.method,
    "The latter mechanism allows us to devise a purely combinatorial algorithm for efficient approximation of optimal replenishment policies within any degree of accuracy."
  );
  assert.deepEqual(result.source, { section: "Main Results", page: 3, sentence: 1 });
});

test("clean abstract methodology outranks formula, citation, and table-contaminated candidates", () => {
  const result = deriveSubstantiveMethod(
    {
      method: "Optimization; Algorithm design",
      abstract: "Because solving the MDP directly is impractical, we study a discrete-time fluid approximation of the problem."
    },
    [
      {
        title: "Identification",
        page: 27,
        text: "We then have 3tγ−αp3t +δ3 +ξ3t, which is the standard regression model."
      },
      {
        title: "Solution Method",
        page: 8,
        text: "Algorithm 1 formally outlines the general procedure to generate decisions."
      },
      {
        title: "Model contribution and method",
        page: 1,
        text: "Because solving the MDP directly is impractical, we study a discrete-time fluid approximation of the problem."
      }
    ]
  );

  assert.equal(
    result.method,
    "Because solving the MDP directly is impractical, we study a discrete-time fluid approximation of the problem."
  );
  assert.deepEqual(result.source, { section: "Model contribution and method", page: 1, sentence: 1 });
});

test("a finite source-defined mechanism comparison is a method, while generic consider scaffolding remains rejected", () => {
  const result = deriveSubstantiveMethod(
    { method: "Analytical modeling" },
    [{
      title: "Model contribution and method",
      page: 1,
      text: "We consider three information mechanisms: physical showrooms allow in-store learning; virtual showrooms provide a signal; availability information reports stock status."
    }]
  );

  assert.equal(
    result.method,
    "The paper considers three information mechanisms: physical showrooms, virtual showrooms, and availability information."
  );
  assert.equal(isSubstantiveMethodStatement("Consider a retailer with uncertain demand and let q be its order."), false);
});

test("early paper-owned method prose beats late model-description fragments", () => {
  const result = deriveSubstantiveMethod(
    { method: "Optimization; Analytical modeling" },
    [
      {
        title: "Allocation of Business",
        page: 1,
        text: "We analytically derive the optimal allocation rule and conduct numerical experiments to evaluate simple heuristics against that rule."
      },
      {
        title: "Model Formulation",
        page: 9,
        text: "The third and most important change is that future value in the multiperiod model is approximated by one-period utility."
      }
    ]
  );

  assert.equal(
    result.method,
    "The paper analytically derives the optimal allocation rule and conducts numerical experiments to evaluate simple heuristics against that rule."
  );
});

test("corpus method regressions return only self-validating paper-owned procedures", () => {
  const malformedDoganMerge = "In the more stationary case, we prove that the optimal mechanism can be decomposed via dynamic programming with a state space comprising the collective virtual value and the number of suppliers reveals that sharing is optimal.";
  assert.equal(isSubstantiveMethodStatement(malformedDoganMerge), false);

  const cases = [
    {
      id: "dogan2026demandservicesharing",
      record: {
        method: "Dynamic revelation principle, Myerson virtual-value transformation, envelope elimination of payments, continuous-time dynamic programming, threshold/index characterization, and numerical discretization for benchmarks."
      },
      text: "In the two-customer setting, we show it via an explicit case analysis; in the more stationary case, we prove that the optimal mechanism can be decomposed via dynamic decomposition reveals that sharing is optimal. We prove that the problem can be decomposed via dynamic programming, based on the novel notion of collective virtual value, defined as the marginal revenue that the platform can extract from all customers.",
      expected: "The paper proves that the problem can be decomposed via dynamic programming, based on the novel notion of collective virtual value, defined as the marginal revenue that the platform can extract from all customers."
    },
    {
      id: "doi-10-1287-mnsc-2020-3640",
      record: {
        method: "Optimization",
        abstract: "Robust optimization obtains safeguarding solutions for optimization problems with uncertain constraints. In this paper, we study a statistical framework to integrate data into RO based on learning a prediction set using geometric shapes and on a data-splitting validation step."
      },
      text: "Robust optimization obtains safeguarding solutions for optimization problems with uncertain constraints. In this paper, we study a statistical framework to integrate data into RO based on learning a prediction set using geometric shapes and on a data-splitting validation step.",
      expected: "The paper studies a statistical framework to integrate data into RO based on learning a prediction set using geometric shapes and on a data-splitting validation step."
    },
    {
      id: "doi-10-1287-mnsc-2022-4365",
      record: {
        method: "Analytical modeling",
        abstract: "Recent years have seen debate about global quantity and price commitments. In this paper, we study the impact of the cap-and-trade policy and the carbon tax policy on a firm’s technology investment and production decisions."
      },
      text: "Recent years have seen debate about global quantity and price commitments. In this paper, we study the impact of the cap-and-trade policy and the carbon tax policy on a firm’s technology investment and production decisions.",
      expected: "The paper studies the impact of the cap-and-trade policy and the carbon tax policy on a firm’s technology investment and production decisions."
    },
    {
      id: "doi-10-1287-msom-2019-0860",
      record: {
        method: "Stochastic modeling; Analytical modeling; Analytical-empirical hybrid",
        abstract: "Governments have adopted subsidy policies to promote renewable-energy investment. In this paper, we study the key practical factors that favor one policy over the other from the perspective of the government."
      },
      text: "Governments have adopted subsidy policies to promote renewable-energy investment. In this paper, we study the key practical factors that favor one policy over the other from the perspective of the government.",
      expected: "The paper studies the key practical factors that favor one policy over the other from the perspective of the government."
    },
    {
      id: "doi-10-1287-msom-2020-0878",
      record: {
        method: "Optimization; Algorithm design; Analytical modeling; Analytical-empirical hybrid",
        abstract: "In this paper, we study the estimation of preferences under a multinomial logit model of demand. We formulate the problem as a maximum-likelihood estimation problem, which turns out to be nonconvex. Our contribution is twofold: From a theoretical perspective, we characterize conditions under which the maximum-likelihood estimates are unique and the model is identifiable. From a practical perspective, we propose a minorization-maximization (MM) algorithm to ease the optimization of the likelihood function."
      },
      text: "In this paper, we study the estimation of preferences under a multinomial logit model of demand. We formulate the problem as a maximum-likelihood estimation problem, which turns out to be nonconvex. Our contribution is twofold: From a theoretical perspective, we characterize conditions under which the maximum-likelihood estimates are unique and the model is identifiable. From a practical perspective, we propose a minorization-maximization (MM) algorithm to ease the optimization of the likelihood function.",
      expected: "From a practical perspective, we propose a minorization-maximization (MM) algorithm to ease the optimization of the likelihood function."
    },
    {
      id: "doi-10-1287-msom-2021-1019",
      record: {
        method: "Dynamic modeling; Analytical modeling; Analytical-empirical hybrid"
      },
      text: "We devise an intuitive and practically implementable policy for scheduling charging of electric vehicles under given completion times.",
      expected: "The paper devises an intuitive and practically implementable policy for scheduling charging of electric vehicles under given completion times."
    },
    {
      id: "doi-10-1287-msom-2021-1054",
      record: {
        method: "Analytical modeling",
        abstract: "A fast fashion system allows firms to react quickly to demand. In this paper, we study the environmental impact of the fast fashion business model by analyzing its implications for product quality, variety, and inventory decisions."
      },
      text: "A fast fashion system allows firms to react quickly to demand. In this paper, we study the environmental impact of the fast fashion business model by analyzing its implications for product quality, variety, and inventory decisions.",
      expected: "The paper studies the environmental impact of the fast fashion business model by analyzing its implications for product quality, variety, and inventory decisions."
    },
    {
      id: "doi-10-1287-msom-2022-0398",
      record: {
        method: "Game-theoretic modeling; Analytical modeling; Analytical-empirical hybrid"
      },
      text: "We use game theory to analyze both the centralized and decentralized dispute systems, and we model the tribunal’s voting game using the global games framework.",
      expected: "The paper uses game theory to analyze both the centralized and decentralized dispute systems, and models the tribunal’s voting game using the global games framework."
    }
  ];

  for (const { id, record, text, expected } of cases) {
    const result = deriveSubstantiveMethod(record, [{
      title: "Model contribution and method",
      page: 1,
      text
    }]);

    assert.equal(result.method, expected, id);
    assert.equal(result.maturity, SEMANTIC_MATURITY.DERIVED, id);
    assert.equal(isSubstantiveMethodStatement(result.method, record.abstract), true, id);
  }
});

test("coordinated paper-method verbs retain third-person agreement", () => {
  const source = "We analyze the performance of different payment structures and find the best one for the client in diverse settings.";
  const abstract = `We study a client and vendor in an information technology project. ${source}`;
  const result = deriveSubstantiveMethod(
    { method: "Substantive modeling (scope-reviewed)", abstract },
    [{ title: "Model contribution and method", page: 1, text: abstract }]
  );

  assert.equal(
    result.method,
    "The paper analyzes the performance of different payment structures and finds the best one for the client in diverse settings."
  );
  assert.equal(isSubstantiveMethodStatement(result.method, abstract), true);
});

test("a staged extension analysis outranks an earlier single-policy evaluation", () => {
  const result = deriveSubstantiveMethod(
    { method: "Analytical modeling" },
    [
      {
        title: "Policy Metrics",
        page: 5,
        text: "The paper evaluates a policy P using three metrics on the admitted class."
      },
      {
        title: "Extensions",
        page: 10,
        text: "We first develop the model with incentives for schools and students, characterize the student test-taking behavior illustrating that it may exhibit a nonmonotonic pattern, and finally characterize equilibrium testing policies when schools compete and decide their test policy strategically."
      }
    ]
  );

  assert.equal(
    result.method,
    "The paper first develops the model with incentives for schools and students, characterizes the student test-taking behavior illustrating that it may exhibit a nonmonotonic pattern, and finally characterizes equilibrium testing policies when schools compete and decide their test policy strategically."
  );
  assert.deepEqual(result.source, { section: "Extensions", page: 10, sentence: 1 });
  assert.equal(isSubstantiveMethodStatement(result.method), true);
});

test("source-preserving lines restore a soft-hyphenated staged method and outrank a generic setting description", () => {
  const result = deriveSubstantiveMethod(
    { method: "Analytical modeling" },
    [
      {
        title: "Extended Model",
        page: 10,
        lines: [{
          page: 10,
          text: "We consider two settings with strategic students: with one and two schools, respectively; the latter introduces competition between schools."
        }]
      },
      {
        title: "Extensions: Strategic Students and Two Schools",
        page: 10,
        // The cleaned layout stream lost the two wrapped continuations. The
        // source stream is the literal extraction artifact and must remain a
        // candidate rather than being silently replaced by the lossy stream.
        lines: [
          { page: 10, text: "We first develop the model with incentives for schools and students, characterize the" },
          { page: 10, text: "student test-taking behavior illustrating that it may" },
          { page: 10, text: "ize equilibrium testing policies when schools compete." }
        ],
        sourceLines: [
          { page: 10, text: "We first develop the model with incentives for schools and students, characterize the" },
          { page: 10, text: "student test-taking behavior illustrating that it may exhibit a nonmonotonic pattern, and finally character\u00ad" },
          { page: 10, text: "ize equilibrium testing policies when schools compete and decide their test policy strategically." }
        ]
      }
    ]
  );

  assert.match(result.method, /characterizes the student test-taking behavior/i);
  assert.match(result.method, /finally characterizes equilibrium testing policies/i);
  assert.deepEqual(result.source, {
    section: "Extensions: Strategic Students and Two Schools",
    page: 10,
    sentence: 1
  });
  assert.equal(cleanSemanticText("character\u00ad ize"), "characterize");
});

test("method ownership is clause-local and result or roadmap prose cannot borrow an unrelated action verb", () => {
  const falsePositives = [
    "The key issue we seek to understand is whether retailers are compelled by competitive forces to adopt self-matching.",
    "These factors are subject to brushing (we will introduce the brushing game in Section 3.3).",
    "In addition, we show implementing a bundled payment scheme may discourage use of the procedure.",
    "Indeed, though it is possible to identify which regime maximizes surplus, such results depend on the functional form we consider.",
    "Moreover, in Theorem 2 of Section 2.2, we show that the solution coincides with the steady-state probability.",
    "Before solving our model in the next section, we will work out several benchmarks to illustrate its value.",
    "To this end, we present a representative numerical example using calibrated parameters in Section 4.",
    "As previously discussed, we assume that the purchase probability follows a logistic regression.",
    "By incorporating more general consumers' maximum valuation, unit transportation cost, and retailers' production cost, we identify two determinants of retailer clusters."
  ];

  for (const candidate of falsePositives) {
    assert.equal(isSubstantiveMethodStatement(candidate), false, candidate);
  }

  const result = deriveSubstantiveMethod({}, [{
    title: "Analysis",
    page: 6,
    text: `${falsePositives.join(" ")} We solve the game backward and start by analyzing the firms' quantity competition.`
  }]);
  assert.equal(
    result.method,
    "The paper solves the game backward and starts by analyzing the firms' quantity competition."
  );
});

test("a generic model-construction abstract cannot outrank a concrete body solution", () => {
  const abstract = "We build a stylized model of a supply chain consisting of one supplier and two competing manufacturers and conduct game-theoretic analysis.";
  const result = deriveSubstantiveMethod(
    { method: "Game-theoretic modeling", abstract },
    [
      { title: "Model contribution and method", page: 1, text: abstract },
      { title: "Analysis", page: 6, text: "We solve the game backward and start by analyzing manufacturers' quantity competition." }
    ]
  );

  assert.equal(
    result.method,
    "The paper solves the game backward and starts by analyzing manufacturers' quantity competition."
  );
  assert.deepEqual(result.source, { section: "Analysis", page: 6, sentence: 1 });
  assert.equal(isSubstantiveMethodStatement(abstract), false);
});

test("a single-author comparative method is retained and rewritten in paper voice", () => {
  const method = "To evaluate the attractiveness of this collusion method, I also study an alternative collusive method (denoted by S3) in which the retailers collude without any information sharing.";
  const result = deriveSubstantiveMethod(
    { method: "Analytical modeling" },
    [{ title: "The One-Period Model", page: 5, text: method }]
  );

  assert.equal(
    result.method,
    "To evaluate the attractiveness of this collusion method, the paper also studies an alternative collusive method (denoted by S3) in which the retailers collude without any information sharing."
  );
  assert.deepEqual(result.source, { section: "The One-Period Model", page: 5, sentence: 1 });
  assert.equal(isSubstantiveMethodStatement(method), true);
  assert.equal(isSubstantiveMethodStatement("I develop a stylized model to study retailer collusion."), false);
  assert.equal(isSubstantiveMethodStatement("I show that implementing the policy raises retailer profit."), false);
});

test("OCR-truncated and organization-led local methods fail closed to a clean paper procedure", () => {
  const corrupted = [
    "These challenges, we develop a heuristic algorithm that produces high-quality approximate solutions to the mization, which quickly become intractable because zation model that balances tractability, interpretability, and performance.",
    "In this section, we construct the static RS model to be ping demand is met using the available battery inventory whenever possible.",
    "To capture system dynamics without explicitly modeling random demand, we introduce an auxiliary decision variable w senting the worst-case demand that reduces the service level.",
    "In the following result, we establish the connection between the RS Model (20) and the static optimization Model (12).",
    "In particular, if we set gamma and choose theta below one, the constraint effectively computes a convex combination of the upper bound and the mean demand.",
    "In the next subsection, we derive the optimal payment terms based on Lemma 4."
  ];
  for (const fragment of corrupted) {
    assert.equal(isSubstantiveMethodStatement(fragment), false, fragment);
  }

  const cleanSource = "In this paper, we formulate a stochastic dynamic program (DP) to optimize the charging rate of a BSS under service-level constraints, explicitly accounting for nonlinear battery degradation cost.";
  const result = deriveSubstantiveMethod(
    { method: "Optimization; Stochastic modeling; Algorithm design" },
    [
      { title: "Discrete Charging Rate", page: 8, text: corrupted[0] },
      { title: "The Static RS Model", page: 10, text: `${corrupted[1]} ${corrupted[2]} ${corrupted[3]} ${corrupted[4]}` },
      { title: "Unverifiable Effort Levels", page: 8, text: corrupted[5] },
      { title: "Model contribution and method", page: 1, text: cleanSource }
    ]
  );

  assert.equal(
    result.method,
    "The paper formulates a stochastic dynamic program (DP) to optimize the charging rate of a BSS under service-level constraints, explicitly accounting for nonlinear battery degradation cost."
  );
  assert.deepEqual(result.source, { section: "Model contribution and method", page: 1, sentence: 1 });
  assert.equal(isSubstantiveMethodStatement(result.method), true);
});

test("a concrete neural estimation procedure outranks a generic characterization contribution", () => {
  const contribution = "This paper proposes a fundamental characterization of choice functions for flexible, data-driven demand estimation in differentiated products markets, accommodating endogenous product features and enabling valid inference on economic objects such as price elasticities.";
  const procedure = "We demonstrate how non-parametric estimators like neural nets can easily approximate such functionals and overcome the curse of dimensionality that is inherent in the non-parametric estimation of choice functions.";
  const citedExtension = "To address this, we build on the approach developed in Petrin and Train (2010) to allow for endogenous observable features.";
  const result = deriveSubstantiveMethod(
    {
      method: "Substantive modeling (scope-reviewed)",
      abstract: contribution
    },
    [
      { title: "Endogenous Covariates", page: 10, text: citedExtension },
      { title: "Model contribution and method", page: 1, text: contribution },
      { title: "Choice Models and Permutation Invariance", page: 1, text: procedure }
    ]
  );

  assert.equal(
    result.method,
    "The paper demonstrates how non-parametric estimators like neural nets can easily approximate such functionals and overcome the curse of dimensionality that is inherent in the non-parametric estimation of choice functions."
  );
  assert.deepEqual(result.source, { section: "Choice Models and Permutation Invariance", page: 1, sentence: 1 });
  assert.equal(isSubstantiveMethodStatement(result.method, contribution), true);

  const localOnly = deriveSubstantiveMethod({}, [{
    title: "Endogenous Covariates",
    page: 10,
    text: citedExtension
  }]);
  assert.equal(localOnly.method, "");
  assert.equal(localOnly.maturity, SEMANTIC_MATURITY.UNRESOLVED);
  assert.equal(isSubstantiveMethodStatement(citedExtension), false);
});

test("IT-project method extraction rejects organizational and OCR fragments and fails closed when no procedure remains", () => {
  const firstBestHeading = "We begin with analyzing the first best (FB) setting below.";
  const damagedLearningMethod = "As in the self-learning case of the FB scenario, for a given learning rate w, we model the change in the tion cost (i.e., cv405) as c0.";
  const derivedResult = "Given the equilibrium effort levels presented in Lemma 7 and the payment structure presented in Proposition 3, we can derive the net value of the Lemma 8.";
  const clippedFormulation = "We formulate a stochastic straints, explicitly accounting for nonlinear battery degradation cost.";

  for (const fragment of [firstBestHeading, damagedLearningMethod, derivedResult, clippedFormulation]) {
    assert.equal(isSubstantiveMethodStatement(fragment), false, fragment);
  }

  const clean = deriveSubstantiveMethod({}, [{
    title: "Model Preliminaries",
    page: 6,
    text: `${firstBestHeading} We formulate the client-vendor collaboration as a differential game and solve it by backward induction.`
  }]);
  assert.equal(
    clean.method,
    "The paper formulates the client-vendor collaboration as a differential game and solves it by backward induction."
  );

  const exhausted = deriveSubstantiveMethod({}, [{
    title: "Self-Learning of Vendor",
    page: 13,
    text: `${damagedLearningMethod} ${derivedResult}`
  }]);
  assert.equal(exhausted.method, "");
  assert.equal(exhausted.maturity, SEMANTIC_MATURITY.UNRESOLVED);
  assert.ok(exhausted.diagnostics.some(({ code }) => code === "method_unresolved"));
});

test("subsection roadmap prose is never accepted as a variant method", () => {
  const roadmap = "In Section 3.2.3, we first derive an analytic forest harvesting problem, which contrasts with the benchmark model.";
  assert.equal(isSubstantiveMethodStatement(roadmap), false);
  const result = deriveSubstantiveMethod({}, [{
    title: "Alternative Harvesting Model",
    page: 8,
    text: roadmap
  }]);
  assert.equal(result.method, "");
  assert.equal(result.maturity, SEMANTIC_MATURITY.UNRESOLVED);
});

test("method voice remains grammatical for paper-owned demonstration prose", () => {
  const result = deriveSubstantiveMethod({}, [{
    title: "Estimation Method",
    page: 2,
    text: "We demonstrate how nonparametric estimators approximate choice functions using permutation-invariant neural networks."
  }]);

  assert.equal(
    result.method,
    "The paper demonstrates how nonparametric estimators approximate choice functions using permutation-invariant neural networks."
  );
});

test("a source-exhausted regime contract is valid only when its embedded paper method is substantive", () => {
  assert.equal(
    isSubstantiveMethodStatement("This regime uses the paper-level solution approach: The paper analyzes three contracting settings and compares their equilibrium payment structures."),
    true
  );
  assert.equal(
    isSubstantiveMethodStatement("This regime uses the paper-level solution approach: As in Table 4, we model the change in the tion cost as cv405."),
    false
  );
});

test("reviewed multi-sentence methods retain a clean procedural sentence", () => {
  const result = deriveSubstantiveMethod({
    method: "The paper derives two qualitative predictions from a stylized game and estimates demand with a finite-mixture Gibbs procedure. Comparative-static simulations then separate the pricing and placement effects."
  });
  assert.match(result.method, /^The paper derives two qualitative predictions/);
  assert.equal(isSubstantiveMethodStatement(result.method), true);
});

test("named procedures are normalized while noisy questions and result fragments are rejected", () => {
  const named = deriveSubstantiveMethod({
    method: "Backward induction first characterizes customer queues and acceptance probabilities for posted prices, then embeds them in each provider's deviation-profit problem."
  });
  assert.match(named.method, /^The paper uses backward induction to characterize/);
  for (const candidate of [
    "How can we utilize customer strategies to inform a provider's pricing decision.",
    "However, we are unable to identify a numerical example that supports the equilibrium.",
    "The paper builds a decentralized matching model to explore kets.",
    "For example, a hospital employs a physician to provide care.",
    "The paper then proceed to solve the pricing game.",
    "Hence, we do not characterize the optimal policy in closed form.",
    "Perhaps surprisingly, we identify that the flexible policy performs best.",
    "We develop a game-theoretic model to study the this phenomenon.",
    "The algorithm achieves the best ous sections."
  ]) assert.equal(isSubstantiveMethodStatement(candidate), false, candidate);
});

test("an explicit author-owned optimization step is retained as an analysis method", () => {
  const result = deriveSubstantiveMethod({}, [{
    title: "Vendor Investment and Support Quality",
    page: 13,
    endPage: 13,
    sourceText: "We have to maximize this revised profit over rho, p, s, and theta. To do so, we start with a fixed theta and solve the remaining pricing problem."
  }]);
  assert.equal(
    result.method,
    "The paper solves the revised profit maximization problem over rho, p, s, and theta."
  );
  assert.equal(isSubstantiveMethodStatement(result.method), true);
});

test("adversarial garble, borrowed citations, results, and clipped clauses fail closed as methods", () => {
  const rejected = [
    "Note that users have the option to retake the wherein users who complete the required learning sections, we start with formulating the users’ problem.",
    "In our main model, we focus on courses in which the tice, firms can employ additional refund policies.",
    "The paper find that symmetric platforms may adopt asymmetric pricing strategies in an attempt to soften interplatform competition.",
    "Following previous studies of the ride-hailing market (Buchholz 2022), we model rider arrivals in.",
    "That is, we focus on the most challenging quency in which both projects are developed.",
    "Because solving the first order condition of the profit cally tractable, we resort to numerical methods to study contextual factors.",
    "The paper models consumers who forgo the showrooming option with probability η η keep the option."
  ];
  for (const candidate of rejected) {
    assert.equal(isSubstantiveMethodStatement(candidate), false, candidate);
  }

  const result = deriveSubstantiveMethod({}, [{
    title: "Model and Analysis",
    page: 7,
    text: rejected.join(" ")
  }]);
  assert.equal(result.method, "");
  assert.equal(result.maturity, SEMANTIC_MATURITY.UNRESOLVED);

  assert.equal(
    isSubstantiveMethodStatement("The paper models rider arrivals as a Poisson process following previous studies and solves drivers’ dynamic programs by backward induction."),
    true
  );
});

test("cleaned record arrays fall back to evidence found in model-section prose", () => {
  const result = deriveModelSetup(
    {
      players: ["中文", "\u200B"],
      information: ["Exogenous quantities defined in the model formulation"],
      actions: [],
      assumptions: []
    },
    [{
      title: "Model Setup",
      page: 3,
      text: "There are a platform and two sellers. The platform observes a demand signal before choosing a commission rate. Demand is independently distributed across periods. We assume sellers have private marginal costs."
    }]
  );

  assert.deepEqual(result.entities, ["A platform and two sellers"]);
  assert.deepEqual(result.inputs, ["A demand signal", "Private marginal costs"]);
  assert.deepEqual(result.decisions, ["A commission rate"]);
  assert.deepEqual(result.assumptions, [
    "Demand is independently distributed across periods",
    "Sellers have private marginal costs"
  ]);
  assert.deepEqual(result.maturity, {
    entities: SEMANTIC_MATURITY.DERIVED,
    inputs: SEMANTIC_MATURITY.DERIVED,
    decisions: SEMANTIC_MATURITY.DERIVED,
    assumptions: SEMANTIC_MATURITY.DERIVED
  });
  assert.ok(result.diagnostics.some(({ reason }) => reason === "generic_generator_placeholder"));
  assert.equal(result.diagnostics.some(({ code }) => code.endsWith("_unresolved")), false);
});

test("valid record setup is cleaned and deduplicated before section-derived additions", () => {
  const result = deriveModelSetup({
    players: ["Retailer", "Retailer", "消费者（consumer）"],
    information: ["Demand signal"],
    actions: ["Choose an order quantity"],
    assumptions: ["Demand is i.i.d. across periods"]
  });

  assert.deepEqual(result.entities, ["Retailer", "Consumer"]);
  assert.deepEqual(result.inputs, ["Demand signal"]);
  assert.deepEqual(result.decisions, ["Choose an order quantity"]);
  assert.deepEqual(result.assumptions, ["Demand is i.i.d. across periods"]);
  assert.equal(result.maturity.entities, SEMANTIC_MATURITY.AUTHORED);
  assert.deepEqual(result.diagnostics, []);
});

test("generic, clipped, and coreferential duplicate setup values are not published", () => {
  const generic = deriveModelSetup({
    information: [
      "cost",
      "Additional information",
      "Brand-retailer level demand shocks but",
      "It, faces the publisher’s legitimate impression with probability 1, conditional on receiving a request-for-bid"
    ],
    actions: ["Set by the publisher", "The reserve price in the PX to 1"],
    assumptions: [
      "A consumer’s ex",
      "Bi’s are i.i.d. such that eachBi is uniformly distributed on[0, 1]. βi v A consumer’s ex post valuation for retaileri. k Number of clusters"
    ]
  });
  assert.deepEqual(generic.inputs, []);
  assert.deepEqual(generic.decisions, []);
  assert.deepEqual(generic.assumptions, []);
  assert.ok(generic.diagnostics.some(({ reason }) => reason === "generic_input_noun"));
  assert.ok(generic.diagnostics.some(({ reason }) => reason === "generic_information_phrase"));
  assert.ok(generic.diagnostics.some(({ reason }) => reason === "dangling_clause"));
  assert.ok(generic.diagnostics.some(({ reason }) => reason === "pronoun_column_fragment"));
  assert.ok(generic.diagnostics.some(({ reason }) => reason === "passive_outcome_not_choice"));
  assert.ok(generic.diagnostics.some(({ reason }) => reason === "clipped_value_assignment"));
  assert.ok(generic.diagnostics.some(({ reason }) => reason === "clipped_possessive_phrase"));
  assert.ok(generic.diagnostics.some(({ reason }) => reason === "merged_setup_sentences"));

  const effort = deriveModelSetup({}, [
    {
      title: "First Best",
      ancestorTitles: ["Model"],
      page: 6,
      text: "When the client and vendor choose these effort levels, total value is generated."
    },
    {
      title: "Model Preliminaries",
      page: 7,
      text: "The client and vendor select and adjust their effort levels dynamically."
    }
  ]);
  assert.deepEqual(effort.decisions, ["Their effort levels"]);
  assert.equal(effort.evidence.decisions[0].source.page, 7);
  assert.equal(effort.decisions.includes("These effort levels"), false);
});

test("model-section extraction rejects headers, formulas, and fragments but keeps a local decision", () => {
  const result = deriveModelSetup({}, [{
    title: "Model and Decisions",
    text: "Information Systems Research, Articles in Advance. On averageE min(D, q) customers receive service. The retailer chooses a lower quality as demand uncertainty increases. Information is immediately accessible online."
  }]);

  assert.deepEqual(result.entities, ["The retailer"]);
  assert.deepEqual(result.inputs, []);
  assert.deepEqual(result.decisions, ["A lower quality"]);
  assert.deepEqual(result.assumptions, []);
  assert.ok(result.diagnostics.some(({ code }) => code === "setup_inputs_unresolved"));
});

test("a setup assumption is not promoted to a question solely because a title ends in punctuation", () => {
  const result = deriveResearchQuestion({
    title: "Observable Queues?",
    business_question: "Suppose customers arrive at an observable queueing system with heterogeneous waiting costs."
  });

  assert.equal(result.question, "");
  assert.equal(result.maturity, SEMANTIC_MATURITY.UNRESOLVED);
});

test("missing setup categories remain empty with explicit unresolved diagnostics", () => {
  const result = deriveModelSetup({}, [{ title: "Results", text: "Profit increases in the treatment." }]);

  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.inputs, []);
  assert.deepEqual(result.decisions, []);
  assert.deepEqual(result.assumptions, []);
  assert.equal(result.diagnostics.filter(({ code }) => code.endsWith("_unresolved")).length, 4);
  assert.deepEqual(result.maturity, {
    entities: SEMANTIC_MATURITY.UNRESOLVED,
    inputs: SEMANTIC_MATURITY.UNRESOLVED,
    decisions: SEMANTIC_MATURITY.UNRESOLVED,
    assumptions: SEMANTIC_MATURITY.UNRESOLVED
  });
});

test("last-resort setup completion extracts literal values from abstract sentences", () => {
  const record = {
    abstract: "We consider a retailer that observes uncertain demand and chooses an order quantity before sales. Demand is independently distributed across periods."
  };
  const base = deriveModelSetup(record, []);
  const result = completeModelSetupFromSource(record, [], base);

  assert.deepEqual(result.entities, ["A retailer"]);
  assert.deepEqual(result.inputs, ["Uncertain demand"]);
  assert.deepEqual(result.decisions, ["An order quantity"]);
  assert.deepEqual(result.assumptions, ["Demand is independently distributed across periods"]);
  assert.deepEqual(result.completion, {
    attemptedCategories: ["entities", "inputs", "decisions", "assumptions"],
    filledCategories: ["entities", "inputs", "decisions", "assumptions"],
    unresolvedCategories: []
  });
  for (const category of ["entities", "inputs", "decisions", "assumptions"]) {
    assert.equal(result.maturity[category], SEMANTIC_MATURITY.DERIVED);
    assert.ok(result.evidence[category][0].source.quote);
    assert.ok(result.evidence[category][0].source.matchedText);
    assert.ok(
      result.evidence[category][0].source.quote.toLowerCase()
        .includes(result.evidence[category][0].source.matchedText.toLowerCase())
    );
  }
  assert.equal(result.diagnostics.some(({ code }) => code.endsWith("_unresolved")), false);
});

test("last-resort setup completion can use a substantive non-model section", () => {
  const sections = [{
    title: "Introduction",
    page: 2,
    text: "A platform and two sellers compete in the market. The platform sets a commission rate after observing seller costs. We assume seller costs are privately known."
  }];
  const result = completeModelSetupFromSource({}, sections, deriveModelSetup({}, sections));

  assert.deepEqual(result.entities, ["A platform", "Two sellers"]);
  assert.deepEqual(result.inputs, ["Seller costs"]);
  assert.deepEqual(result.decisions, ["A commission rate"]);
  assert.deepEqual(result.assumptions, ["Seller costs are privately known"]);
  assert.equal(result.evidence.entities[0].source.section, "Introduction");
  assert.equal(result.evidence.entities[0].source.page, 2);
});

test("last-resort completion preserves resolved values and fills only missing categories", () => {
  const existing = {
    entities: ["Retailer"],
    inputs: ["Demand signal"],
    decisions: [],
    assumptions: ["Demand is stationary"],
    maturity: {
      entities: SEMANTIC_MATURITY.AUTHORED,
      inputs: SEMANTIC_MATURITY.AUTHORED,
      decisions: SEMANTIC_MATURITY.UNRESOLVED,
      assumptions: SEMANTIC_MATURITY.AUTHORED
    },
    evidence: {
      entities: [{ value: "Retailer", source: { type: "record", field: "players" } }],
      inputs: [{ value: "Demand signal", source: { type: "record", field: "information" } }],
      decisions: [],
      assumptions: [{ value: "Demand is stationary", source: { type: "record", field: "assumptions" } }]
    },
    diagnostics: [{ code: "setup_decisions_unresolved", category: "decisions", message: "Missing." }]
  };
  const record = { abstract: "The retailer observes demand and chooses a price before the selling season." };
  const result = completeModelSetupFromSource(record, [], existing);

  assert.deepEqual(result.entities, ["Retailer"]);
  assert.deepEqual(result.inputs, ["Demand signal"]);
  assert.deepEqual(result.assumptions, ["Demand is stationary"]);
  assert.deepEqual(result.decisions, ["A price"]);
  assert.deepEqual(result.completion.attemptedCategories, ["decisions"]);
  assert.equal(result.diagnostics.some(({ code }) => code === "setup_decisions_unresolved"), false);
  assert.deepEqual(result.evidence.entities, existing.evidence.entities);
});

test("last-resort completion fails closed without source-backed concrete phrases", () => {
  const result = completeModelSetupFromSource(
    { model_topic: "Pricing and inventory control" },
    [{ title: "Results", text: "The numerical results are discussed next." }],
    deriveModelSetup({}, [])
  );

  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.inputs, []);
  assert.deepEqual(result.decisions, []);
  assert.deepEqual(result.assumptions, []);
  assert.deepEqual(result.completion.filledCategories, []);
  assert.deepEqual(result.completion.unresolvedCategories, ["entities", "inputs", "decisions", "assumptions"]);
  assert.equal(result.diagnostics.filter(({ code }) => code.endsWith("_source_exhausted")).length, 4);
  assert.equal(JSON.stringify(result).includes("Actors and system entities"), false);
  assert.equal(JSON.stringify(result).includes("The analysis is scoped to"), false);
});

test("last-resort completion rejects noisy and caption-only source text", () => {
  const sections = [{
    title: "Introduction",
    page: 4,
    text: "Table 2 Customer Price Demand. Theplatformobservesuncertaindemandandchoosesaprice."
  }];
  const result = completeModelSetupFromSource({}, sections, deriveModelSetup({}, []));

  assert.deepEqual(result.completion.filledCategories, []);
  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.inputs, []);
  assert.deepEqual(result.decisions, []);
});

test("split social-surplus notation and price-taker assumptions are not inputs or decisions", () => {
  const sections = [{
    title: "Model Setup",
    page: 4,
    text: [
      "That is, Soc ial Sur plu s(P; o ) ≤ Soc ial Sur plu s(G; o ) ≤ Soc ial Sur plu s (NG; o ).",
      "We assume that these firms are price takers and therefore charge equal prices."
    ].join(" ")
  }];
  const result = completeModelSetupFromSource({}, sections, deriveModelSetup({}, sections));

  assert.deepEqual(result.inputs, []);
  assert.deepEqual(result.decisions, []);
  assert.deepEqual(result.assumptions, ["These firms are price takers and therefore charge equal prices"]);
  assert.equal(JSON.stringify(result).includes('"Soc"'), false);
  assert.equal(JSON.stringify(result).includes("Takers and therefore"), false);
});

test("author-method prose and organization fragments cannot fill field-semantic setup", () => {
  const sections = [{
    title: "Model Analysis",
    page: 5,
    text: [
      "Tighter bounds can be derived using the Bonferroni inequalities.",
      "More details of CMM are presented in the Online Appendix.",
      "The purpose of this subsection is to study service flexibility.",
      "To study the arrival patterns of walk-ins, we adopt a Poisson regression framework to model the number of walk-ins in each hour.",
      "To generate insights into the policy, we analyze a stylized two-station open-shop service network."
    ].join(" ")
  }];
  const result = completeModelSetupFromSource({}, sections, deriveModelSetup({}, sections));

  assert.deepEqual(result.inputs, []);
  assert.deepEqual(result.decisions, []);
  assert.deepEqual(result.assumptions, []);
});

test("literal completion retains available inputs and coordinated policy decisions but rejects clipped formulas", () => {
  const record = {
    abstract: [
      "The funding agency faces information asymmetry about availability of additional funds.",
      "Policy makers should consider approving and deploying a curated combination of rapid tests.",
      "Assume that [ p, p + rho estimated sensitivity of test k."
    ].join(" ")
  };
  const result = completeModelSetupFromSource(record, [], deriveModelSetup({}, []));

  assert.deepEqual(result.inputs, ["Additional funds"]);
  assert.deepEqual(result.decisions, ["A curated combination of rapid tests"]);
  assert.deepEqual(result.assumptions, []);
  assert.ok(result.evidence.inputs[0].source.quote.includes("availability of additional funds"));
  assert.ok(result.evidence.decisions[0].source.matchedText.includes("curated combination"));
});

test("section-derived setup evidence keeps the page containing its sentence", () => {
  const section = {
    title: "Model Formulation",
    page: 2,
    endPage: 3,
    text: "The seller chooses a price. The seller observes uncertain demand before choosing an inventory quantity.",
    lines: [
      { page: 2, text: "The seller chooses a price." },
      { page: 3, text: "The seller observes uncertain demand before choosing an inventory quantity." }
    ]
  };
  const result = deriveModelSetup({}, [section]);

  assert.equal(result.evidence.inputs[0].source.page, 3);
  assert.equal(result.evidence.inputs[0].source.quote, section.lines[1].text);
});

test("IT co-creation setup retains actors, observed output, payment and effort choices, and a literal modeling assumption", () => {
  const record = {
    abstract: "We study the relationship between a client and a vendor in value co-creation environments such as information technology projects."
  };
  const sections = [{
    title: "Model Overview",
    page: 4,
    text: [
      "We consider that the client gets utility from the project throughout the development period and that the effort levels are not verifiable if not monitored.",
      "Hence, the client needs to optimally decide the terms of payment structures so as to maximize her net value.",
      "Although the client can infer the vendor’s effort level by observing the output, the agreement cannot be based on effort.",
      "If the offer is accepted by the vendor, both parties select and adjust their effort levels dynamically."
    ].join(" ")
  }];
  const result = completeModelSetupFromSource(record, sections, deriveModelSetup(record, sections));

  assert.deepEqual(result.entities, ["A client", "A vendor", "Information technology projects"]);
  assert.deepEqual(result.inputs, ["The output", "The effort levels"]);
  assert.deepEqual(result.decisions, ["The terms of payment structures", "Their effort levels"]);
  assert.deepEqual(result.assumptions, [
    "The client gets utility from the project throughout the development period and that the effort levels are not verifiable if not monitored"
  ]);
  assert.equal(result.decisions.some((value) => value.includes("by observing")), false);
});

test("unverifiable and monitored effort variants recover only their own literal payment and effort controls", () => {
  const unverifiableSections = [{
    title: "Unverifiable Effort Levels",
    page: 8,
    text: "In the next subsection, we derive the optimal payment terms based on Lemma 4."
  }];
  const unverifiable = completeModelSetupFromSource(
    {},
    unverifiableSections,
    deriveModelSetup({}, unverifiableSections)
  );
  assert.deepEqual(unverifiable.decisions, ["The optimal payment terms"]);
  assert.equal(unverifiable.evidence.decisions[0].source.section, "Unverifiable Effort Levels");
  assert.equal(unverifiable.evidence.decisions[0].source.quote, unverifiableSections[0].text);

  const monitoringSections = [{
    title: "Monitoring Vendor’s Effort",
    page: 11,
    text: [
      "The client aligns the parties’ objectives by designing a payment structure that eliminates the game between them.",
      "Because the client can verify the vendor’s effort level, she can prescribe the vendor’s effort throughout the collaboration."
    ].join(" ")
  }];
  const monitoring = completeModelSetupFromSource(
    {},
    monitoringSections,
    deriveModelSetup({}, monitoringSections)
  );
  assert.deepEqual(monitoring.decisions, ["A payment structure", "The vendor’s effort throughout the collaboration"]);
  assert.ok(monitoring.evidence.decisions.every(({ source }) => source.section === "Monitoring Vendor’s Effort"));
  assert.ok(monitoring.evidence.decisions.every(({ source, value }) => (
    source.quote.toLowerCase().includes((source.matchedText || value).toLowerCase())
  )));

  const derivedResultOnly = deriveModelSetup({}, [{
    title: "Inference in Baseline Exogeneous Setting",
    page: 13,
    text: "We now formally derive the inference results when there are no endogenous variables."
  }]);
  assert.deepEqual(derivedResultOnly.decisions, []);
});

test("battery-swapping setup retains physical system objects, charge state, charging controls, and an explicit simplification", () => {
  const record = {
    abstract: "Battery swapping allows electric vehicle (EV) drivers to exchange depleted batteries for fully charged ones at dedicated stations."
  };
  const sections = [
    {
      title: "Battery-Charging Process",
      page: 5,
      text: "Drained batteries can be unloaded once they reach the desired state of charge. For simplicity, we assume that loading and unloading actions are instantaneous and that the associated operation time is negligible."
    },
    {
      title: "Problem Formulation",
      page: 6,
      text: "The BSS must determine its charging schedule, including both the number of batteries to charge and the charging rate to apply in each period."
    }
  ];
  const result = completeModelSetupFromSource(record, sections, deriveModelSetup(record, sections));

  assert.deepEqual(result.entities, ["Electric vehicle (EV) drivers", "Depleted batteries", "Dedicated stations"]);
  assert.deepEqual(result.inputs, ["State of charge"]);
  assert.deepEqual(result.decisions, ["Its charging schedule", "The charging rate"]);
  assert.deepEqual(result.assumptions, [
    "Loading and unloading actions are instantaneous and that the associated operation time is negligible"
  ]);
});

test("demand-estimation setup treats products, features, estimation, and inference as concrete setup elements", () => {
  const record = {
    abstract: "This paper proposes a fundamental characterization of choice functions for flexible, data-driven demand estimation in differentiated products markets, accommodating endogenous product features and enabling valid inference on economic objects such as price elasticities."
  };
  const result = completeModelSetupFromSource(record, [], deriveModelSetup(record, []));

  assert.deepEqual(result.entities, ["Differentiated products"]);
  assert.deepEqual(result.inputs, ["Endogenous product features"]);
  assert.deepEqual(result.decisions, ["Data-driven demand estimation", "Valid inference"]);
  for (const category of ["entities", "inputs", "decisions"]) {
    for (const evidence of result.evidence[category]) {
      assert.ok(evidence.source.quote.toLowerCase().includes(evidence.source.matchedText.toLowerCase()));
    }
  }
});

test("model and estimation sections retain demand data, fit targets, and explicit assumptions while rejecting result and formula artifacts", () => {
  const sections = [
    {
      title: "Choice Models and Permutation Invariance",
      page: 6,
      text: "Researchers have access only to aggregate market-level demand data. For any product in any market, we assume the choice function does not depend on the identity of the product. Researchers are interested in conducting inference over price elasticities."
    },
    {
      title: "Estimation Procedure",
      page: 17,
      text: "We outline an estimation procedure and estimate the choice function."
    },
    {
      title: "Choice Model Analysis",
      page: 20,
      text: "We observe both sources of performance improvement in the numerical simulation results in Table 2a. Suppose researchers are interested in the average effect of a transformation. Suppose there is only one feature, price, then the choice probability is 1 + exp(price). As one can observe the distribution appears multi-modal."
    }
  ];
  const result = deriveModelSetup({}, sections);

  assert.deepEqual(result.inputs, ["Aggregate market-level demand data"]);
  assert.deepEqual(result.decisions, ["Conducting inference", "An estimation procedure", "The choice function"]);
  assert.deepEqual(result.assumptions, ["The choice function does not depend on the identity of the product"]);
  assert.equal(JSON.stringify(result).includes("sources of performance improvement"), false);
  assert.equal(JSON.stringify(result).includes("exp(price)"), false);
  assert.equal(JSON.stringify(result).includes("distribution appears"), false);
});

test("comparative elasticity results are not promoted to extension inputs", () => {
  const result = deriveModelSetup({}, [{
    title: "Choice Model Extension",
    page: 18,
    text: [
      "We observe a similar pattern even for the true model–the accuracy of own-elasticity decreases as the number of products increases.",
      "The extension accommodates endogenous prices as input data."
    ].join(" ")
  }]);

  assert.deepEqual(result.inputs, ["Endogenous prices"]);
  assert.equal(JSON.stringify(result).includes("similar pattern"), false);
  assert.equal(JSON.stringify(result).includes("own-elasticity decreases"), false);
});

test("an excluded endogenous feature is not asserted as an extension input", () => {
  const result = deriveModelSetup({}, [{
    title: "Choice Model Extension",
    page: 10,
    text: [
      "The baseline restriction precludes the possibility of endogenous prices.",
      "The extension builds on a control-function approach to allow for endogenous observable features."
    ].join(" ")
  }]);

  assert.deepEqual(result.inputs, ["Endogenous observable features"]);
  assert.equal(result.inputs.includes("Endogenous prices"), false);
  assert.ok(result.evidence.inputs[0].source.quote.includes("allow for endogenous observable features"));
});

test("substantive child headings inherit model-lineage eligibility while excluded ancestors still veto them", () => {
  const result = deriveModelSetup({}, [
    {
      title: "Consumers",
      ancestorTitles: ["Model"],
      page: 5,
      text: "Each consumer first observes a private valuation. Each consumer decides whether to join the platform."
    },
    {
      title: "Advertisers",
      ancestorTitles: ["Model"],
      page: 6,
      text: "The advertiser targets a consumer segment and sets a bid."
    },
    {
      title: "Platforms",
      ancestorTitles: ["Model"],
      page: 6,
      text: "The platform has access to aggregate demand data. The platform needs to decide the commission rate."
    },
    {
      title: "Consumers",
      ancestorTitles: ["Results and Discussion", "Model"],
      page: 14,
      text: "The consumer chooses a price."
    }
  ]);

  assert.deepEqual(result.entities, ["Each consumer", "The advertiser", "The platform"]);
  assert.deepEqual(result.inputs, ["A private valuation", "Aggregate demand data"]);
  assert.deepEqual(result.decisions, [
    "Whether to join the platform",
    "Target a consumer segment",
    "Set a bid",
    "The commission rate"
  ]);
  assert.equal(result.decisions.includes("A price"), false);
  assert.ok(result.evidence.entities.every(({ source }) => [5, 6].includes(source.page)));
});

test("an explicit model definition nested under the introduction remains eligible, but ordinary introduction descendants do not", () => {
  const result = deriveModelSetup({}, [
    {
      title: "Model Definition",
      ancestorTitles: ["Introduction"],
      page: 3,
      text: "The principal observes a demand signal and chooses a contract type."
    },
    {
      title: "Participants",
      ancestorTitles: ["Introduction"],
      page: 2,
      text: "The salesperson chooses a price."
    }
  ]);

  assert.deepEqual(result.entities, ["The principal"]);
  assert.deepEqual(result.inputs, ["A demand signal"]);
  assert.deepEqual(result.decisions, ["A contract type"]);
  assert.equal(JSON.stringify(result).includes("salesperson"), false);
});

test("sensor setup retains first-observed and accessible information plus solicitation choices", () => {
  const result = deriveModelSetup({}, [{
    title: "Information Structure",
    ancestorTitles: ["Model"],
    page: 5,
    text: [
      "Each sensor first observes a noisy signal.",
      "Each sensor has access to public quality data.",
      "Each sensor chooses from which other sensors to solicit information."
    ].join(" ")
  }]);

  assert.deepEqual(result.entities, ["Each sensor"]);
  assert.deepEqual(result.inputs, ["A noisy signal", "Public quality data"]);
  assert.deepEqual(result.decisions, ["From which other sensors to solicit information"]);
});

test("principal and salesperson controls retain quoted terms, acceptance, rejection, and effort", () => {
  const result = deriveModelSetup({}, [{
    title: "Decision Sequence",
    ancestorTitles: ["Model"],
    page: 7,
    text: [
      "The principal quotes a wholesale price.",
      "The salesperson decides whether to accept or reject the contract.",
      "The salesperson exerts an effort level."
    ].join(" ")
  }]);

  assert.deepEqual(result.entities, ["The principal", "The salesperson"]);
  assert.deepEqual(result.decisions, [
    "Quote a wholesale price",
    "Whether to accept or reject the contract",
    "Exert an effort level"
  ]);
  assert.equal(result.evidence.decisions[0].source.matchedText, "quotes a wholesale price");
});

test("firm spending-policy controls survive while author-run tests are not modeled decisions", () => {
  const result = deriveModelSetup({}, [{
    title: "Optimal Mean Expenditure Level and Volatility",
    page: 6,
    text: [
      "We assume that the firm decides about its optimal marketing spending policy, which we characterize in terms of its mean and variance.",
      "We test our propositions with brand data.",
      "We also test whether marketing expenditures are endogenous."
    ].join(" ")
  }]);

  assert.deepEqual(result.decisions, ["Its optimal marketing spending policy"]);
  assert.equal(result.decisions.some((value) => /^test\b/i.test(value)), false);
});

test("random-walk transition controls survive while research artifacts and adjectival close do not", () => {
  const result = deriveModelSetup({}, [{
    title: "Simulating Random-walks",
    ancestorTitles: ["Random-walks on Hypergraphs"],
    page: 8,
    text: [
      "We release an open-source Python package (HyperCentral) to support adoption.",
      "Second, we iteratively undertake the following procedure: We randomly select a hyperedge according to ES and then we select a new node according to NS.",
      "The embedding places structurally similar nodes in close proximity."
    ].join(" ")
  }]);

  assert.deepEqual(result.decisions, [
    "Select a hyperedge according to ES",
    "Select a new node according to NS"
  ]);
  assert.equal(result.decisions.some((value) => /open[- ]source.*package|close proximity/i.test(value)), false);
  assert.ok(result.evidence.decisions.every(({ source }) => source.derivation === "literal-actor-control"));
});

test("decision-maker batch controls and user targeting, joining, and posting remain actor-gated", () => {
  const decisionMaker = deriveModelSetup({}, [{
    title: "Batch Decision Model",
    ancestorTitles: ["Introduction"],
    page: 6,
    text: [
      "The decision maker first observes product features.",
      "The decision maker has access to a noise parameter.",
      "The decision maker needs to decide the next batch size and chooses an action."
    ].join(" ")
  }]);
  assert.deepEqual(decisionMaker.entities, ["The decision maker"]);
  assert.deepEqual(decisionMaker.inputs, ["Product features", "A noise parameter"]);
  assert.deepEqual(decisionMaker.decisions, ["The next batch size", "Choose an action"]);

  const user = deriveModelSetup({}, [{
    title: "User Decisions",
    ancestorTitles: ["Model"],
    page: 8,
    text: [
      "The user targets a customer segment.",
      "The user decides whether to join the platform.",
      "The user decides how much information to post."
    ].join(" ")
  }]);
  assert.deepEqual(user.entities, ["The user"]);
  assert.deepEqual(user.decisions, [
    "Target a customer segment",
    "Whether to join the platform",
    "How much information to post"
  ]);

  const authorProse = deriveModelSetup({}, [{
    title: "Model Overview",
    page: 2,
    text: "This paper targets a broad research audience and posts results online."
  }]);
  assert.deepEqual(authorProse.entities, []);
  assert.deepEqual(authorProse.decisions, []);
});

test("clinicians and hyphenated decision-makers remain actors inside narrow lead-in clauses", () => {
  const clinician = deriveModelSetup({}, [{
    title: "Making Medication Decisions",
    ancestorTitles: ["Two-Dimensional Control"],
    page: 5,
    text: "In practice, a clinician must choose a medication from a set of possible options for a patient and determine the appropriate dose for the selected medication."
  }]);
  assert.deepEqual(clinician.entities, ["A clinician"]);
  assert.deepEqual(clinician.decisions, ["A medication", "The appropriate dose for the selected medication"]);

  const decisionMaker = deriveModelSetup({}, [{
    title: "Making Dose Decisions",
    ancestorTitles: ["Two-Dimensional Control"],
    page: 6,
    text: "When the decision-maker decides on a patient’s dose for a selected medication, the treatment response is observed."
  }]);
  assert.deepEqual(decisionMaker.entities, ["The decision-maker"]);
  assert.deepEqual(decisionMaker.decisions, ["A patient’s dose for a selected medication"]);
});

test("known setup false greens are rejected as fragments, generic nouns, methodology, or flattened math", () => {
  const result = deriveModelSetup({
    players: ["product", "A consumer only", "A location to shop at or chooses another"],
    information: ["The data", "An information", "Feature K, then the choice changes"],
    actions: [
      "Reject the assumption",
      "Offline price pF",
      "Post valuation for retailer i",
      "Test several alternative response models"
    ],
    assumptions: [
      "Post heterogeneous consumers",
      "We further restrict that k2 > 49 144 so neither manufacturer chooses an infinite Ti."
    ]
  });

  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.inputs, []);
  assert.deepEqual(result.decisions, []);
  assert.deepEqual(result.assumptions, []);
  const reasons = new Set(result.diagnostics.map(({ reason }) => reason).filter(Boolean));
  for (const reason of [
    "generic_entity_noun",
    "entity_sentence_fragment",
    "generic_input_noun",
    "input_sentence_fragment",
    "statistical_test_outcome_not_choice",
    "notation_fragment_not_choice",
    "clipped_post_decision",
    "research_test_not_modeled_choice",
    "clipped_or_flattened_assumption"
  ]) assert.ok(reasons.has(reason), `missing rejection reason ${reason}`);
});

test("literal parameter definitions and a coordinated explicit assumption recover clean setup", () => {
  const sections = [{
    title: "Model",
    page: 5,
    text: [
      "The parameter t is unit transportation cost, while c denotes marginal cost and v represents maximum valuation.",
      "We set the travel cost for a consumer’s first shopping trip to zero and assume that additional trips are sufficiently costly."
    ].join(" ")
  }];
  const result = completeModelSetupFromSource({}, sections, deriveModelSetup({}, sections));

  assert.deepEqual(result.inputs, [
    "The parameter t is unit transportation cost",
    "c denotes marginal cost",
    "v represents maximum valuation"
  ]);
  assert.deepEqual(result.assumptions, ["Additional trips are sufficiently costly"]);
  for (const item of [...result.evidence.inputs, ...result.evidence.assumptions]) {
    assert.ok(item.source.quote.toLowerCase().includes(item.source.matchedText.toLowerCase()));
  }
});

test("a symbol domain before denotes retains only its literal economic gloss", () => {
  const sections = [{
    title: "Model",
    page: 6,
    text: "Using subscripts to identify firms, let p ∈ R+ denote the cost per unit of resource investment."
  }];
  const result = deriveModelSetup({}, sections);

  assert.deepEqual(result.inputs, ["The cost per unit of resource investment"]);
  assert.equal(result.evidence.inputs[0].source.matchedText, "the cost per unit of resource investment");
  assert.equal(result.evidence.inputs[0].source.derivation, "literal-parameter-gloss");
  assert.ok(result.evidence.inputs[0].source.quote.includes(result.evidence.inputs[0].source.matchedText));
});

test("coordinated given inputs survive a comparative heading and table cross-reference", () => {
  const sections = [{
    title: "Efficiency vs. Envy-Freeness",
    page: 6,
    text: "The course priorities ( ≻c) and the student preferences (≻s) are given in Table 2 as strict ordinal rankings."
  }];
  const result = completeModelSetupFromSource({}, sections, deriveModelSetup({}, sections));

  assert.deepEqual(result.inputs, ["The course priorities", "The student preferences"]);
  assert.deepEqual(
    result.evidence.inputs.map(({ source }) => source.matchedText),
    ["The course priorities", "the student preferences"]
  );
  assert.ok(result.evidence.inputs.every(({ source }) => source.quote.includes(source.matchedText)));

  const assumedKnown = completeModelSetupFromSource({}, [{
    title: "Auction Environment",
    page: 7,
    text: "The valuations and budgets are assumed to be known to the auctioneer."
  }], deriveModelSetup({}, []));
  assert.deepEqual(assumedKnown.inputs, ["The valuations", "Budgets"]);
});

test("a fused PDF footnote marker does not swallow a mathematical assumption", () => {
  const sourceText = [
    "With two schools, we assume that students in both groups strictly prefer J1 to J2, that is, v1 > v2.9",
    "To rule out trivial equilibria, we assume that testing costs are positive."
  ].join(" ");
  const result = deriveModelSetup({}, [{
    title: "Extended Model",
    page: 10,
    endPage: 10,
    sourceText,
    text: sourceText,
    sourceLines: [{ page: 10, text: sourceText }],
    lines: [{ page: 10, text: sourceText }]
  }]);

  assert.ok(result.assumptions.includes(
    "Students in both groups strictly prefer J1 to J2, that is, v1 > v2"
  ));
  assert.equal(result.evidence.assumptions.find((entry) => /v1 > v2/.test(entry.value))?.source.quote,
    "With two schools, we assume that students in both groups strictly prefer J1 to J2, that is, v1 > v2.");
});

test("paper-introduced mechanisms and selection procedures remain literal decisions", () => {
  const record = {
    abstract: "We introduce RESPCT, a mechanism that respects minimum quotas. We develop a two-stage selection procedure and a sequential selection procedure."
  };
  const result = completeModelSetupFromSource(record, [], deriveModelSetup({}, []));

  assert.deepEqual(result.decisions, [
    "A two-stage selection procedure",
    "A sequential selection procedure",
    "RESPCT, a mechanism"
  ]);
  assert.ok(result.evidence.decisions.every(({ value, source }) => (
    source.quote.toLowerCase().includes((source.matchedText || value).toLowerCase())
  )));
});

test("abstract model declarations recover specific inputs and settings without notation placeholders", () => {
  const selfMatching = completeModelSetupFromSource({
    abstract: [
      "Using a game-theoretic model, we investigate strategic forces across a range of competitive scenarios, including a monopolist, two competing multichannel retailers, as well as a mixed duopoly.",
      "Its effectiveness depends on the decision-making stage of consumers and the heterogeneity of their preference for the online versus store channels."
    ].join(" ")
  }, [], deriveModelSetup({}, []));
  assert.deepEqual(selfMatching.inputs, [
    "Decision-making stage of consumers",
    "Heterogeneity of their preference for the online versus store channels"
  ]);
  assert.deepEqual(selfMatching.assumptions, [
    "A range of competitive scenarios, including a monopolist, two competing multichannel retailers, as well as a mixed duopoly"
  ]);

  const asymmetricSupplyChain = completeModelSetupFromSource({
    abstract: "We build a stylized model of a supply chain consisting of one supplier and two competing manufacturers and conduct game-theoretic analysis."
  }, [], deriveModelSetup({}, []));
  assert.deepEqual(asymmetricSupplyChain.assumptions, [
    "A supply chain consisting of one supplier and two competing manufacturers"
  ]);

  const leadTime = completeModelSetupFromSource({
    abstract: "We introduce and formalize a concept in which a manufacturer requests that suppliers dynamically adjust the pipeline orders’ remaining lead times."
  }, [], deriveModelSetup({}, []));
  assert.deepEqual(leadTime.inputs, ["Pipeline orders’ remaining lead times"]);
  assert.ok(leadTime.evidence.inputs[0].source.quote.includes(leadTime.evidence.inputs[0].source.matchedText));
});

test("semantic cleaning removes invisible and non-English-only values", () => {
  assert.equal(cleanSemanticText("\u200B 中文 \u0007"), "");
});

test("business-model adoption, staged announcements, and action-space options remain modeled choices", () => {
  const result = deriveModelSetup({}, [{
    title: "Model and Decision Sequence",
    page: 4,
    text: [
      "A monopolistic vendor adopts the selling model or the leasing model for information goods or services.",
      "Platforms announce their targeting capabilities in the first stage and advertising fees in the second stage.",
      "The action space A is a collection of ads as well as the option of not showing an ad (no ad)."
    ].join(" ")
  }]);

  assert.deepEqual(result.decisions, [
    "The selling model or the leasing model for information goods or services",
    "Announce their targeting capabilities",
    "The option of not showing an ad (no ad)"
  ]);
  assert.equal(result.evidence.decisions[1].source.derivation, "literal-actor-control");
  assert.equal(result.evidence.decisions[2].source.derivation, "literal-actor-control");
});

test("construction signatures, algorithm declarations, and primary-input lists retain literal primitives", () => {
  const result = deriveModelSetup({}, [{
    title: "Model Inputs",
    page: 6,
    text: [
      "It is constructed from two other matrices: a node-software matrix and a software-vulnerability matrix.",
      "The input to Algorithm 1 is the directed graph G(V, E) from Section 2.2.",
      "The simulation considers the topography, the type of vegetation, an ignition risk map, and climate conditions of Uruguay as the primary input."
    ].join(" ")
  }]);

  assert.deepEqual(result.inputs, [
    "A node-software matrix",
    "A software-vulnerability matrix",
    "The directed graph",
    "The topography, the type of vegetation, an ignition risk map, and climate conditions of Uruguay"
  ]);
  assert.ok(result.evidence.inputs.every(({ source }) => source.derivation === "literal-explicit-input"));
  assert.ok(result.evidence.inputs.every(({ value, source }) => source.quote.toLowerCase().includes(source.matchedText.toLowerCase())
    && value.toLowerCase().includes(source.matchedText.toLowerCase())));
});

test("a literal gerund preserves actor-owned data sharing instead of fabricating a finite verb", () => {
  const abstract = "Although retailers recognize the potential value of sharing transactional data with supply chain partners, many remain reluctant to share.";
  const result = completeModelSetupFromSource(
    { abstract },
    [],
    deriveModelSetup({ abstract }, [])
  );

  assert.deepEqual(result.decisions, ["Sharing transactional data with supply chain partners"]);
  assert.equal(result.evidence.decisions[0].source.matchedText, "sharing transactional data with supply chain partners");
  assert.ok(result.evidence.decisions[0].source.quote.includes(result.evidence.decisions[0].source.matchedText));
});

test("formula-spliced setup keeps literal given inputs and a parenthetical binary choice", () => {
  const result = completeModelSetupFromSource({}, [{
    title: "Introduction and Summary of Results",
    page: 1,
    text: [
      "Given mean arrival rate λi and mean service time mi = μ−1 for activity i, the activity load is ρi = λimi.",
      "In our model, a customer decides not only whether to purchase a product (i.e., the cardigan) but also how often to monitor it."
    ].join(" ")
  }], deriveModelSetup({}, []));

  assert.deepEqual(result.inputs, ["Mean arrival rate", "Mean service time"]);
  assert.ok(result.decisions.includes("Whether to purchase a product"));
  assert.ok(result.evidence.inputs.every(({ source }) => source.derivation === "literal-explicit-input"));
});

test("research authors are not model objects unless the paper explicitly models content creators", () => {
  const ordinary = completeModelSetupFromSource({}, [{
    title: "Model",
    page: 2,
    text: "Researchers estimate demand and authors propose an algorithm for the platform."
  }], deriveModelSetup({}, []));
  assert.deepEqual(ordinary.entities, ["The platform"]);

  const creators = completeModelSetupFromSource({}, [{
    title: "Creator Model",
    page: 3,
    text: "The paper explicitly models content authors who produce articles and choose publication timing."
  }], deriveModelSetup({}, []));
  assert.ok(creators.entities.includes("Content authors"));
});

test("method discourse leads are normalized while subjectless conjunctions and heading leaks fail closed", () => {
  const result = deriveSubstantiveMethod({}, [{
    title: "Solution Method",
    page: 5,
    text: "Therefore, we employ Benders decomposition to solve the mixed-integer program."
  }]);
  assert.equal(result.method, "The paper employs Benders decomposition to solve the mixed-integer program.");
  const paperLead = deriveSubstantiveMethod({}, [{
    title: "Solution Method",
    page: 6,
    text: "Thus, in this paper, we develop a decomposition algorithm to solve the dynamic program."
  }]);
  assert.equal(paperLead.method, "The paper develops a decomposition algorithm to solve the dynamic program.");
  const enumeratedLead = deriveSubstantiveMethod({}, [{
    title: "Numerical Method",
    page: 7,
    text: "Finally, we evaluate the allocation policy using numerical simulation."
  }]);
  assert.equal(enumeratedLead.method, "The paper evaluates the allocation policy using numerical simulation.");
  assert.equal(isSubstantiveMethodStatement("And investigate how the reference effect changes firm strategy."), false);
  assert.equal(isSubstantiveMethodStatement("And by incorporating total purchases, the analysis derives a demand estimate."), false);
  assert.equal(isSubstantiveMethodStatement("Analysis In this section, we solve the benchmark game."), false);
  assert.equal(isSubstantiveMethodStatement("Then, in Sections 7 and 8, we characterize the equilibrium and solve the extension."), false);
  assert.equal(isSubstantiveMethodStatement("Nonetheless, it is encouraging that our findings are robust."), false);
});

test("page-prefixed notation roadmaps fall through and using-clauses become self-contained paper voice", () => {
  const result = deriveSubstantiveMethod({}, [{
    title: "Formulation of the Optimal Mechanism",
    page: 8,
    text: [
      "573 Next, we introduce the notation needed to formulate the optimal mechanism design problem.",
      "Using the solution of the reduced dynamic program, we construct an allocation and payment tuple that solves the original mechanism design problem."
    ].join(" ")
  }]);
  assert.equal(
    result.method,
    "The paper constructs an allocation and payment tuple that solves the original mechanism design problem using the solution of the reduced dynamic program."
  );
  assert.equal(isSubstantiveMethodStatement("573 Next, we introduce the notation needed to formulate the optimal mechanism design problem."), false);

  const characterization = deriveSubstantiveMethod({}, [{
    title: "The Full Model",
    page: 7,
    text: "Using these two values, we can now characterize the optimal scheme for the full model."
  }]);
  assert.equal(
    characterization.method,
    "The paper characterizes the optimal scheme for the full model using these two values."
  );

  const coordinatedMethod = deriveSubstantiveMethod({}, [{
    title: "Model contribution and method",
    page: 1,
    text: "Using dynamic programming, we optimize storage operations and derive value function properties that are key to analyzing the storage investment decisions."
  }]);
  assert.equal(
    coordinatedMethod.method,
    "The paper optimizes storage operations and derives value function properties that are key to analyzing the storage investment decisions using dynamic programming."
  );

  const methodResultAbstract = deriveSubstantiveMethod({}, [{
    title: "Model contribution and method",
    page: 1,
    text: "Methodology/results: Using a Hotelling-based model of a multiproduct retailer, we find that the retailer assigns equal probability to each product."
  }]);
  assert.equal(
    methodResultAbstract.method,
    "The paper uses a Hotelling-based model of a multiproduct retailer."
  );

  const formulation = deriveSubstantiveMethod({}, [{
    title: "Formulation of the Mechanism",
    page: 11,
    text: "We will formulate the mechanism design problem with these relaxed constraints."
  }]);
  assert.equal(formulation.method, "The paper formulates the mechanism design problem with these relaxed constraints.");
  assert.equal(isSubstantiveMethodStatement("The paper now formulate the mechanism design problem."), false);
});

test("equilibrium concepts and binding constraints remain substantive analytical methods", () => {
  const rationalExpectations = deriveSubstantiveMethod({}, [{
    title: "Model",
    page: 4,
    text: "To study the strategic interaction between the retailer and customers, we shall use the notion of rational expectations (RE) equilibrium."
  }]);
  assert.equal(
    rationalExpectations.method,
    "The paper uses the notion of rational expectations (RE) equilibrium to study the strategic interaction between the retailer and customers."
  );

  const refinement = deriveSubstantiveMethod({}, [{
    title: "Pooling Equilibrium and Intuitive Criterion",
    page: 2,
    text: "Next we will include these constraints to identify the pooling equilibrium and then show that all pooling equilibria are eliminated by the intuitive criterion."
  }]);
  assert.equal(refinement.method, "The paper includes these constraints to identify the pooling equilibrium.");
});

test("a paper-owned comparison between named analytical approaches is a substantive method", () => {
  const comparison = deriveSubstantiveMethod({}, [{
    title: "Model contribution and method",
    page: 1,
    text: "We then distinguish the focal point analysis from the rental price approach for durable goods models."
  }]);
  assert.equal(
    comparison.method,
    "The paper then distinguishes the focal point analysis from the rental price approach for durable goods models."
  );
  assert.equal(isSubstantiveMethodStatement(comparison.method), true);
});

test("setup extraction recovers a clean control before fused prose and rejects borrowed or descriptive pseudo-decisions", () => {
  const abstract = "We show that companies offering freemium contracts oftentimes have a high percentage of free users.";
  const result = completeModelSetupFromSource({ abstract }, [{
    title: "Model",
    page: 4,
    text: [
      "The objective of the receiver is to choose the contract thatmaximizeshersurplus(asinMaskinandRiley1984).",
      "A recent working paper by Smith et al. (2019) considers a static model of product line design without referrals."
    ].join(" ")
  }], deriveModelSetup({ abstract }, []));

  assert.ok(result.decisions.includes("Choose the contract"));
  assert.equal(result.decisions.some((value) => /oftentimes|thatmaximizes|design without referrals/i.test(value)), false);
  const recovered = result.evidence.decisions.find(({ value }) => value === "Choose the contract");
  assert.equal(recovered.source.quote, "choose the contract");
  assert.equal(recovered.source.matchedText, "choose the contract");
});

test("literal model inputs outrank generic component-style nouns", () => {
  const result = completeModelSetupFromSource({}, [{
    title: "Model Inputs",
    page: 3,
    text: [
      "The trip rate Nt for each route is estimated using the gravity model.",
      "We assume that buyers’ values for the impressions are private and drawn from a common-knowledge distribution.",
      "Each selected activity has a unidimensional given utility ui and a fixed duration ti.",
      "Managers can optimize replenishment timing and replenishment quantity.",
      "When facing an epidemic, policymakers may also be concerned with mortality.",
      "Health authorities maintain an emergency stockpile of vaccines."
    ].join(" ")
  }], deriveModelSetup({}, []));

  assert.ok(result.inputs.includes("The trip rate"));
  assert.ok(result.inputs.includes("Buyers’ values for the impressions"));
  assert.ok(result.inputs.includes("A unidimensional given utility"));
  assert.ok(result.inputs.includes("A fixed duration"));
  assert.ok(result.entities.includes("Managers"));
  assert.equal(result.entities.includes("Policymakers"), false);
  assert.equal(result.entities.includes("Health authorities"), false);
});

test("fixed purchase scope is retained as literal input without raw dollar-delimited notation", () => {
  const sections = [{
    title: "Problem Description and Model Formulation",
    page: 4,
    text: [
      "We consider a buyer sourcing a fixed amount of good or service from two competing suppliers.",
      "The buyer purchases a divisible good or service of Q units worth a total of $W per period from two suppliers over an infinite horizon."
    ].join(" ")
  }];
  const result = completeModelSetupFromSource({}, sections, deriveModelSetup({}, sections));

  assert.ok(result.inputs.includes("A fixed amount of good or service"));
  assert.ok(result.inputs.includes("A divisible good or service of Q units"));
  assert.equal(result.inputs.some((value) => value.includes("$")), false);
  for (const expected of ["a fixed amount of good or service", "a divisible good or service of Q units"]) {
    const evidence = result.evidence.inputs.find(({ source }) => source.matchedText.toLowerCase() === expected.toLowerCase());
    assert.ok(evidence, `missing literal input evidence for ${expected}`);
    assert.ok(evidence.source.quote.toLowerCase().includes(expected.toLowerCase()));
  }
});

test("epidemic stockpile constraints supply literal actors and inputs", () => {
  const result = completeModelSetupFromSource({}, [{
    title: "Introduction",
    page: 2,
    text: [
      "World Health Organization guidelines require noninferiority trials to be conducted for new vaccine dosages.",
      "The decisions are the rates of vaccination with full- and fractional-dose vaccines, and the objective is to minimize infections at the population level."
    ].join(" ")
  }, {
    title: "Epidemic Dynamics with Vaccinations",
    page: 5,
    text: [
      "Specifically, consider a closed homogeneous population consisting of three compartments: susceptible (S), infected (I), and removed (R).",
      "The full-dose vaccine and the fractional-dose vaccine are available."
    ].join(" ")
  }, {
    title: "Resource Constraints",
    page: 6,
    text: [
      "When facing an epidemic, policymakers may also be concerned with mortality.",
      "Health authorities maintain an emergency stockpile of vaccines.",
      "The first constraint is a cap on the total antigen stockpile available for the duration of the epidemic, denoted vmax.",
      "Our model accounts for these limitations through a cap on the total vaccine administration rate, denoted as umax."
    ].join(" ")
  }], deriveModelSetup({}, []));

  assert.equal(result.entities.includes("Policymakers"), false);
  assert.equal(result.entities.includes("Health authorities"), false);
  assert.ok(result.entities.includes("Susceptible"));
  assert.ok(result.entities.includes("Infected"));
  assert.ok(result.entities.includes("Removed"));
  assert.ok(result.entities.includes("The full-dose vaccine"));
  assert.ok(result.inputs.includes("The total antigen stockpile"));
  assert.ok(result.inputs.includes("The total vaccine administration rate"));
  assert.ok(result.decisions.includes("The rates of vaccination"));
  assert.equal(result.decisions.some((value) => /noninferiority|minimize infections/i.test(value)), false);
});

test("numerical-study prose is not promoted to model controls", () => {
  const result = completeModelSetupFromSource({}, [{
    title: "Model variant: Numerics on a Calibrated Model",
    page: 14,
    text: [
      "We perform simulations based on parameters calibrated using an NYC ride-hailing data set to compare the performance of the various mechanisms.",
      "PFCFS is analogous to the scheduling policy used by Via (Via 2020) in that both allow for reservation and bundling.",
      "We vary the driver pool to perform sensitivity analysis.",
      "Given the abundant supply, we expect a supply ratio close to 1."
    ].join(" ")
  }], deriveModelSetup({}, []));

  assert.deepEqual(result.decisions, []);
});

test("literal firm controls survive while cited precedent, numerical method, and adverse outcomes do not", () => {
  const result = completeModelSetupFromSource({}, [{
    title: "Model Description",
    page: 5,
    text: "Stokey (1981) has suggested that a durable goods monopolist cannot charge a price above its cost."
  }, {
    title: "Impact of Strategic Consumer Behavior on Diffusion Dynamics",
    page: 11,
    text: "Given the firm’s decision about price, discount, and release time (p, δ, τ), we illustrate the product diffusion curves."
  }, {
    title: "Optimal Product Release Time with Preannounced Prices",
    page: 14,
    text: [
      "This finding indicates that ignorance of consumers’ strategic behavior can lead firms to release products at the wrong time.",
      "A late release of the second generation delays its own market expansion and profit realization."
    ].join(" ")
  }, {
    title: "Optimal Pricing and Timing Strategies",
    page: 14,
    text: "In this section, we perform numerical optimization to jointly optimize the pricing and timing decisions."
  }], deriveModelSetup({}, []));

  assert.ok(result.decisions.includes("Price, discount, and release time"));
  assert.equal(result.decisions.some((value) => /a price|wrong time|delays its own|perform numerical|the pricing/i.test(value)), false);
  const recovered = result.evidence.decisions.find(({ value }) => value === "Price, discount, and release time");
  assert.equal(recovered.source.matchedText, "price, discount, and release time");
});

test("method selection skips coreferential result use and column-spliced estimation prose", () => {
  const result = deriveSubstantiveMethod({}, [{
    title: "Introduction",
    page: 2,
    text: "These estimates allow us to simulate different policies and compare their performance under various market conditions."
  }, {
    title: "Numerics on a Calibrated Model",
    page: 14,
    text: "We perform simulations based on parameters calibrated using an NYC ride-hailing data set to compare the performance of the various mechanisms."
  }, {
    title: "Data and Parameters",
    page: 15,
    text: "Second, we estimate the shift-length distribution, that is, what is the probability a driver prefers to be available side parameters, we discuss the details of calibrating these two quantities."
  }]);

  assert.equal(
    result.method,
    "The paper performs simulations based on parameters calibrated using an NYC ride-hailing data set to compare the performance of the various mechanisms."
  );
});
