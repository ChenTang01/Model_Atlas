import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCleanSections,
  selectModelSections,
  selectSectionSource,
} from "../scripts/model-note-sections.mjs";
import { isWhitespaceNormalizedSubstring } from "../scripts/model-note-text-quality.mjs";

test("extractCleanSections handles wrapped headings and removes extraction artifacts", () => {
  const pages = [
    {
      page: 1,
      text: [
        "MANAGEMENT SCIENCE ADVANCE ARTICLE",
        "2. Model of",
        "Dynamic Pricing",
        "1. The seller chooses a price before each customer arrives",
        "The seller chooses a price before demand arrives and observes the resulting purchase decision.",
        "Demand follows a stochastic choice model whose state changes after every customer arrival.",
        "Figure 1. Timeline of the pricing mechanism",
        "price demand revenue",
        "17",
      ].join("\n"),
    },
    {
      page: 2,
      text: [
        "MANAGEMENT SCIENCE ADVANCE ARTICLE",
        "The objective maximizes expected revenue subject to the remaining inventory constraint.",
        "The dynamic program uses inventory as its state and price as its action in every period.",
        "Table 2: price demand revenue",
        "Smith, J. (2020). Dynamic pricing models. Management Science 66(2):1-20.",
        "18",
      ].join("\n"),
    },
  ];

  const sections = extractCleanSections(pages);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "Model of Dynamic Pricing");
  assert.equal(sections[0].page, 1);
  assert.equal(sections[0].endPage, 2);
  assert.ok(sections[0].lines.some((line) => line.page === 2));
  assert.doesNotMatch(sections[0].text, /Figure 1|Table 2|Smith, J|ADVANCE ARTICLE/);
  assert.match(sections[0].text, /^1\. The seller chooses/);
});

test("a compact numbered parent prelude survives when its direct child confirms the hierarchy", () => {
  const pages = [{
    page: 7,
    text: [
      "4. Equilibrium Analyses",
      "We use backward induction to analyze the game. Sub-",
      "sections 4.1 and 4.2 examine the final and initial stages,",
      "respectively.",
      "4.1 Price Competition",
      "Retailers choose prices simultaneously after consumers select a shopping location.",
      "The equilibrium price maximizes each retailer's expected profit under the demand conditions.",
    ].join("\n"),
  }];

  const sections = extractCleanSections(pages);
  assert.deepEqual(sections.map((section) => section.title), ["Equilibrium Analyses", "Price Competition"]);
  assert.match(sections[0].text, /^We use backward induction to analyze the game\./);
  assert.doesNotMatch(sections[0].text, /Sub-/);
  assert.ok(isWhitespaceNormalizedSubstring(sections[0].lines[0].text, pages[0].text));
  assert.deepEqual(sections[1].ancestorTitles, ["Equilibrium Analyses"]);
});

test("direct children do not revive empty or fragmentary numbered parents", () => {
  const pages = [{
    page: 7,
    text: [
      "4. Equilibrium Analyses",
      "4.1 Price Competition",
      "Retailers choose prices simultaneously after consumers select a shopping location.",
      "The equilibrium price maximizes each retailer's expected profit under the demand conditions.",
      "5. Solution Method",
      "Backward.",
      "5.1 Dynamic Program",
      "The algorithm solves the stochastic pricing problem backward over the planning horizon.",
      "Each state evaluates every feasible price under the remaining inventory constraint.",
    ].join("\n"),
  }];

  const sections = extractCleanSections(pages);
  assert.deepEqual(new Set(sections.map((section) => section.title)), new Set(["Price Competition", "Dynamic Program"]));
  assert.deepEqual(sections.find((section) => section.title === "Price Competition")?.ancestorTitles, ["Equilibrium Analyses"]);
  assert.deepEqual(sections.find((section) => section.title === "Dynamic Program")?.ancestorTitles, ["Solution Method"]);
});

test("heading-bounded source spans retain line fragments without publishing a repaired quote", () => {
  const pages = [{
    page: 4,
    text: [
      "2. Input Parameters",
      "The manager defines a cost multi-",
      "plier for each effort level.",
      "The effort cost is observed before the manager chooses an action.",
      "A capacity constraint limits the feasible action in every decision period.",
      "2.1 Adjacent Objective",
      "The adjacent objective maximizes profit under a separate constraint."
    ].join("\n")
  }];
  const section = extractCleanSections(pages).find((entry) => entry.title === "Input Parameters");
  assert.ok(section);
  assert.match(section.sourceText, /cost multi- plier/);
  const source = selectSectionSource(pages, section, "effort cost observed manager action");
  assert.equal(source?.quote, "The effort cost is observed before the manager chooses an action.");
  assert.ok(isWhitespaceNormalizedSubstring(source.quote, pages[0].text));
  assert.doesNotMatch(source.quote, /multiplier/i);
});

test("integration junk cannot split or title a model section", () => {
  const pages = [{
    page: 533,
    text: [
      "Model",
      "The vendor chooses a service capacity before uncertain client demand is observed in the market.",
      "Information Systems Research 27(3), pp. 517–537, © 2016 INFORMS 533",
      "The objective maximizes expected revenue subject to a capacity constraint in every demand state.",
      "W",
      "(iii) the implementation of the solution. For example,",
      "In our setting, the client (respectively, vendor) can",
      "The equilibrium policy assigns each client to a feasible service action after demand arrives.",
    ].join("\n"),
  }];

  const sections = extractCleanSections(pages);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "Model");
  assert.doesNotMatch(sections[0].text, /Information Systems Research|\bW\b|implementation of the solution|respectively/);
  assert.match(sections[0].text, /equilibrium policy/);
});

test("representative bylines and sentence fragments never become headings", () => {
  const falseHeadings = [
    "Subodha Kumar, Bala Shetty",
    "Vendor",
    "For brevity, we present the results only for the effort",
    "It is never optimal in our setting to serve both types of buyers",
    "By sustaining informative communication, the A-Learning",
    "The first customization strategy, which we label as the A-Learning approach, starts with asking directly each",
    "A-Learning and O-Learning would converge to zero",
    "A-Learning approach. That is, when",
    "O-Learning case (i.e., ∆",
    "(i.e., Λ) to sustain the cheap-signaling equilibrium under the O-Learning",
    "17 Calculate",
    "0. Let",
    "2012. study the pricing problem of a monopolist that",
    "2009. develop a column generation algorithm to solve",
    "500. historical samples, which makes the problem",
    "1. instead of ASEQ",
    "2. such that the optimal action at state",
    "2.6. , our policy",
    "2. B20",
    "2. Q2",
    "1. Furthermore, we adopt a sequential search framework",
    "2. > S/2 in the nonboundary equilibrium",
    "Pricing Department, Priceline, Toronto, Ontario M5V 2H2, Canada",
    "Engineering, North Carolina State University, Raleigh, North Carolina 27695",
    "8. The extension to a setting in which the means of these normal",
    "13. This state dependency does not arise if the underlying environment",
    "A participating user can post information about any",
    "More details of CMM are presented in Online Appendix",
    "We consider a Figure 2.Timing of the Model Policy instrument Participating decisions Posting decisions Stage 2Stage 1 Stage 3 rational-expectations equilibrium...",
    "푛observations",
    "픐to",
    "휌Wasserstein",
    "achieve the best ous sections.",
  ];
  const pages = falseHeadings.map((heading, index) => ({
    page: index + 1,
    text: [
      heading,
      `The stochastic pricing model for scenario ${index + 1} selects an inventory action to maximize expected revenue subject to a capacity constraint.`,
    ].join("\n"),
  }));
  pages.push({
    page: falseHeadings.length + 1,
    text: [
      "Model",
      "The seller chooses a pricing action before stochastic demand arrives and records remaining inventory as the state.",
      "The objective maximizes expected revenue subject to the capacity constraint in every decision period.",
    ].join("\n"),
  });

  assert.deepEqual(extractCleanSections(pages).map((section) => section.title), ["Model"]);
});

test("computational, calibration, and real/synthetic-data studies cannot win model-section selection", () => {
  const pages = [
    {
      page: 2,
      text: [
        "2 Model Formulation",
        "The planner chooses capacity before stochastic demand is observed in each operating period.",
        "The optimization model maximizes expected profit subject to the capacity constraint."
      ].join("\n")
    },
    {
      page: 10,
      text: [
        "4 Computational Study: Using Real Data",
        "The computational study evaluates the capacity policy using historical demand observations.",
        "The numerical evaluation reports profit and service performance for each fitted instance."
      ].join("\n")
    },
    {
      page: 11,
      text: [
        "4.1 Using Synthetic Data",
        "The simulation generates synthetic demand instances to evaluate the proposed capacity policy.",
        "The experiment reports numerical performance over every generated demand scenario."
      ].join("\n")
    },
    {
      page: 12,
      text: [
        "5 Calibration",
        "The calibration estimates demand parameters from observed transactions before evaluation.",
        "The fitted values are inputs to the computational experiment and its reported results."
      ].join("\n")
    },
    {
      page: 13,
      text: [
        "6 Numerical Results",
        "The numerical results compare expected profit and capacity utilization across test cases.",
        "The evaluation reports the performance of the optimization policy under each scenario."
      ].join("\n")
    },
    {
      page: 14,
      text: [
        "7 Real-Data Study",
        "The real-data study evaluates the estimated policy on observed customer transactions.",
        "The results compare prediction and allocation performance across historical samples."
      ].join("\n")
    },
    {
      page: 15,
      text: [
        "8 Synthetic-Data Study",
        "The synthetic-data study evaluates the estimated policy on generated customer transactions.",
        "The results compare prediction and allocation performance across simulated samples."
      ].join("\n")
    }
  ];

  const selected = selectModelSections(
    pages,
    { title: "Stochastic capacity planning under uncertain demand" },
    { minSections: 5, maxSections: 7 }
  );
  assert.deepEqual(selected.map((section) => section.title), ["Model Formulation"]);
});

test("wrapped headings cannot absorb body prose or a citation year", () => {
  const pages = [{
    page: 1,
    text: [
      "5.1.2 General Formulation to Quantify the Self-",
      "Selection Effects. We now generalize the utility",
      "The pricing model chooses a tariff to maximize revenue subject to the capacity constraint.",
      "2019. model, the proposed model is a sequential",
      "The sequential model chooses an action after observing uncertain demand in each period.",
      "3 Model Setup",
      "The seller chooses a price before stochastic demand arrives and observes the resulting purchase action.",
      "The objective maximizes expected revenue subject to the inventory capacity constraint.",
    ].join("\n"),
  }];

  assert.deepEqual(extractCleanSections(pages).map((section) => section.title), ["Model Setup"]);
});

test("real short, acronym, mixed-case, and sentence-case headings remain", () => {
  const pages = [
    {
      page: 1,
      text: [
        "2.1 Firms",
        "The firms choose production quantities before uncertain market demand is realized in the network.",
        "Each firm maximizes profit subject to its production capacity and market access constraints.",
      ].join("\n"),
    },
    {
      page: 2,
      text: [
        "3.5 LM",
        "The learning model estimates uncertain demand and chooses an allocation policy for each customer type.",
        "The algorithm maximizes expected reward subject to the available inventory constraint.",
      ].join("\n"),
    },
    {
      page: 3,
      text: [
        "4.3 Erlang-S",
        "The queueing model uses a stochastic arrival process and server capacity to determine the service state.",
        "The policy allocates customers to servers while minimizing expected congestion cost.",
      ].join("\n"),
    },
    {
      page: 4,
      text: [
        "5 mHealth treatment policy",
        "The treatment policy chooses a mobile-health intervention after observing the patient's dynamic state.",
        "The model maximizes expected health benefit subject to the intervention budget.",
      ].join("\n"),
    },
    {
      page: 5,
      text: [
        "6 A model with asymmetric information",
        "The seller chooses price before learning the buyer's private demand type in the market.",
        "The model maximizes profit subject to incentive and participation constraints.",
      ].join("\n"),
    },
  ];

  assert.deepEqual(
    extractCleanSections(pages).map((section) => section.title),
    ["Firms", "LM", "Erlang-S", "mHealth treatment policy", "A model with asymmetric information"],
  );
});

test("safe heading repairs retain real headings without carrying extraction gaps", () => {
  const pages = [{
    page: 1,
    text: [
      "3.1 The Monopolistic Firm ’s Problem",
      "The monopolistic firm chooses a price and quantity to maximize profit under uncertain market demand.",
      "The optimization problem imposes a capacity constraint on every feasible production decision.",
      "3.2 Necessary and Suf ficient Conditions",
      "The conditions characterize the optimal pricing policy under the demand and capacity assumptions.",
      "The solution follows from the first-order conditions of the firm's optimization problem.",
      "4.3 Optimality of Periodic-Af fine Policies",
      "The periodic-affine policy maps the observed inventory state to a feasible replenishment action.",
      "The policy minimizes expected cost over the stochastic demand process and planning horizon.",
    ].join("\n"),
  }];

  assert.deepEqual(
    new Set(extractCleanSections(pages).map((section) => section.title)),
    new Set(["The Monopolistic Firm’s Problem", "Necessary and Sufficient Conditions", "Optimality of Periodic-Affine Policies"]),
  );
});

test("heading repair rejoins the common split Profit extraction", () => {
  const pages = [{
    page: 1,
    text: [
      "3. The Impact on Expected Pro fit",
      "The model maximizes expected profit by choosing a feasible price and inventory allocation under uncertain customer demand and a fixed production capacity constraint."
    ].join("\n")
  }];
  const sections = extractCleanSections(pages);
  assert.equal(sections[0]?.title, "The Impact on Expected Profit");
});

test("single-name bylines, table labels, and lowercase equation fragments are not headings", () => {
  const pages = [{
    page: 1,
    text: [
      "Liang Guo",
      "Payment        Output        Vendor",
      "I C",
      "benchmark, the seller learns the buyers’ preferences",
      "equilibrium: U",
      "2. Model Setting",
      "The seller chooses a quality and price before the buyer observes the offer. The buyer then selects a product to maximize utility, while the seller evaluates expected profit under demand uncertainty."
    ].join("\n")
  }];
  assert.deepEqual(extractCleanSections(pages).map((section) => section.title), ["Model Setting"]);
});

test("repeated phrases, dangling prose, and Boolean bibliography rows are not headings", () => {
  const pages = [
    {
      page: 1,
      text: [
        "11 Model without Model without Model without Model without",
        "The capacity game lets each retailer choose an order before the supplier allocates scarce inventory.",
        "The payoff depends on realized demand and the proportional allocation rule.",
      ].join("\n"),
    },
    {
      page: 2,
      text: [
        "50 This results in a large inventory underage cost due",
        "The capacity game lets each retailer choose an order before the supplier allocates scarce inventory.",
        "The payoff depends on realized demand and the proportional allocation rule.",
      ].join("\n"),
    },
    {
      page: 3,
      text: [
        "Almost Ideal Demand System Deaton and Muellbauer (1980) No",
        "The demand model estimates product choice probabilities from observed prices and product characteristics.",
        "The estimator permits counterfactual price changes under the maintained demand assumptions.",
      ].join("\n"),
    },
    {
      page: 4,
      text: [
        "Latent Class Logit Model Kamakura and Russell (1989) Yes",
        "The demand model estimates product choice probabilities from observed prices and product characteristics.",
        "The estimator permits counterfactual price changes under the maintained demand assumptions.",
      ].join("\n"),
    },
    {
      page: 5,
      text: [
        "Choice Model Literature Satisfies Permutation Invariance",
        "The table compares named demand models and records whether each satisfies the permutation property.",
        "The rows report the literature source and a Boolean value rather than a new model component.",
      ].join("\n"),
    },
    {
      page: 6,
      text: [
        "4.2 Model without Demand Censoring",
        "The uncensored demand model estimates customer choice from observed prices and product characteristics.",
        "The estimator maximizes a likelihood subject to the maintained demand assumptions.",
      ].join("\n"),
    },
    {
      page: 7,
      text: [
        "5.1 Deaton and Muellbauer Demand System",
        "The named demand system maps prices and expenditure to product shares in each observed market.",
        "The estimation model identifies price effects under the stated demand restrictions.",
      ].join("\n"),
    },
  ];

  assert.deepEqual(
    extractCleanSections(pages).map((section) => section.title),
    ["Model without Demand Censoring", "Deaton and Muellbauer Demand System"],
  );
});

test("true title-case and numbered headings survive the conservative gate", () => {
  const pages = [
    {
      page: 1,
      text: [
        "Strategic Communication Equilibrium",
        "The communication model chooses a signaling policy before uncertain buyer demand is realized.",
        "The equilibrium maximizes expected utility subject to the sender's incentive constraint.",
      ].join("\n"),
    },
    {
      page: 2,
      text: [
        "4 Vendor Decisions",
        "The vendor selects service capacity and price before observing the stochastic customer type.",
        "The resulting optimization program maximizes revenue over every feasible allocation action.",
      ].join("\n"),
    },
    {
      page: 3,
      text: [
        "A-Learning and O-Learning",
        "The two learning models use different information policies to estimate uncertain customer demand.",
        "Each algorithm chooses an action that maximizes its expected reward under the applicable constraint.",
      ].join("\n"),
    },
    {
      page: 4,
      text: [
        "6 Salvage Value",
        "The parties receive a terminal salvage payoff after choosing effort throughout the dynamic project game.",
        "The terminal value changes each participant's optimal action and the resulting equilibrium trajectory.",
      ].join("\n"),
    },
  ];

  assert.deepEqual(
    extractCleanSections(pages).map((section) => section.title),
    ["Strategic Communication Equilibrium", "Vendor Decisions", "A-Learning and O-Learning", "Salvage Value"],
  );
});

test("legitimate canonical short headings remain available", () => {
  const pages = [
    {
      page: 1,
      text: [
        "Model",
        "The model selects inventory before stochastic demand arrives and records remaining stock as the state.",
        "Its objective maximizes expected revenue subject to a capacity constraint in each period.",
      ].join("\n"),
    },
    {
      page: 2,
      text: [
        "Method",
        "The algorithm computes a pricing policy by solving the dynamic program backward over time.",
        "The procedure evaluates every feasible action for each inventory state and demand realization.",
      ].join("\n"),
    },
    {
      page: 3,
      text: [
        "Setup",
        "Customers arrive according to a stochastic demand process and choose among the offered prices.",
        "The initial inventory and planning horizon define the capacity available to the seller.",
      ].join("\n"),
    },
  ];

  assert.deepEqual(extractCleanSections(pages).map((section) => section.title), ["Model", "Method", "Setup"]);
});

test("References is a sticky tail even when later pages resemble model sections", () => {
  const pages = [
    {
      page: 4,
      text: [
        "3 Model Formulation",
        "The platform maximizes expected revenue by choosing capacity before stochastic demand is observed.",
        "The formulation imposes a capacity constraint for every demand state in the planning horizon.",
      ].join("\n"),
    },
    {
      page: 5,
      text: [
        "References",
        "Brown, A. (2019). Capacity allocation. Operations Research 67(1):1-20.",
      ].join("\n"),
    },
    {
      page: 6,
      text: [
        "A. Alternative Model",
        "The appendix model changes the objective and solves a stochastic pricing program with demand constraints.",
        "This apparent section must not be revived after the bibliography has begun.",
      ].join("\n"),
    },
  ];

  const sections = extractCleanSections(pages);
  assert.deepEqual(sections.map((section) => section.title), ["Model Formulation"]);
});

test("semantic duplicate sections collapse to the more substantive extraction", () => {
  const pages = [
    {
      page: 2,
      text: [
        "2 Model Formulation",
        "The model chooses inventory and price to maximize revenue under uncertain demand.",
        "The state records remaining inventory and the action is the posted price.",
      ].join("\n"),
    },
    {
      page: 3,
      text: [
        "2 Model Formulation",
        "The model chooses inventory and price to maximize revenue under uncertain demand.",
        "The state records remaining inventory and the action is the posted price.",
        "A capacity constraint links feasible prices and allocations in each period.",
      ].join("\n"),
    },
  ];

  const sections = extractCleanSections(pages);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].page, 3);
  assert.match(sections[0].text, /capacity constraint/);
});

test("selectSectionSource is section-bounded, literal, and requires focus overlap", () => {
  const pages = [
    { page: 1, text: "The paper studies an inventory replenishment decision in a broad operations setting." },
    {
      page: 2,
      text: "The retailer chooses an inventory replenishment quantity before stochastic demand is realized. The price is fixed outside the model.",
    },
    {
      page: 3,
      text: "A capacity constraint limits the replenishment quantity in each decision period. The policy is computed by dynamic programming.",
    },
  ];
  const section = {
    title: "Inventory policy",
    page: 2,
    endPage: 3,
    text: "The retailer chooses an inventory replenishment quantity before stochastic demand is realized. A capacity constraint limits the replenishment quantity in each decision period.",
  };

  const source = selectSectionSource(pages, section, "inventory replenishment decision");
  assert.ok(source);
  assert.equal(source.page, 2);
  assert.notEqual(source.page, 1);
  assert.ok(isWhitespaceNormalizedSubstring(source.quote, pages[1].text));
  assert.ok(source.lexicalOverlap.length > 0);
  assert.equal(selectSectionSource(pages, section, "astronomy telescope orbit"), null);
});

test("selectSectionSource does not borrow an adjacent component on the same page", () => {
  const pages = [{
    page: 7,
    text: "The inventory model chooses a replenishment quantity before demand arrives. The pricing policy sets a posted price for each arriving customer.",
  }];
  const pricingSection = {
    title: "Pricing policy",
    page: 7,
    endPage: 7,
    text: "The pricing policy sets a posted price for each arriving customer.",
  };

  assert.equal(selectSectionSource(pages, pricingSection, "inventory replenishment demand"), null);
  const source = selectSectionSource(pages, pricingSection, "pricing policy posted price");
  assert.equal(source?.quote, pricingSection.text);
});

test("selectSectionSource recovers a first sentence joined to its own heading", () => {
  const quote = "By imposing an additional constraint on charging rates, the dynamic program becomes a discrete-rate formulation.";
  const adjacent = "The system-cost section minimizes electricity procurement and battery degradation costs.";
  const pages = [{
    page: 8,
    text: [
      "3.5. Discrete Charging Rate",
      quote,
      "3.6. System Cost",
      adjacent,
    ].join("\n"),
  }];
  const section = {
    number: "3.5",
    title: "Discrete Charging Rate",
    page: 8,
    endPage: 8,
    text: quote,
  };

  const source = selectSectionSource(pages, section, "discrete charging rate dynamic program");
  assert.equal(source?.quote, quote);
  assert.ok(isWhitespaceNormalizedSubstring(source.quote, pages[0].text));
  assert.notEqual(source?.quote, adjacent);
});

test("heading-free fallback uses distinct non-first pages and literal sentences", () => {
  const pages = [
    { page: 1, text: "This paper presents our findings and discusses their managerial importance for future research." },
    { page: 2, text: "The pricing model chooses a posted price to maximize expected revenue before uncertain demand arrives." },
    { page: 3, text: "The inventory model uses remaining stock as the state and replenishment quantity as the decision action." },
    { page: 4, text: "The capacity formulation constrains allocation decisions in every period of the stochastic optimization problem." },
  ];
  const record = {
    title: "Pricing, inventory, and capacity decisions",
    model_topic: "stochastic pricing inventory capacity allocation",
  };

  const sections = selectModelSections(pages, record, { minSections: 3, maxSections: 3 });
  assert.equal(sections.length, 3);
  assert.deepEqual(new Set(sections.map((section) => section.page)), new Set([2, 3, 4]));
  assert.ok(sections.every((section) => section.synthetic && section.lines.length === 1));
  assert.ok(sections.every((section) => isWhitespaceNormalizedSubstring(section.text, pages.find((page) => page.page === section.page).text)));

  const sources = sections.map((section) => selectSectionSource(pages, section, section.text));
  assert.ok(sources.every(Boolean));
  assert.deepEqual(new Set(sources.map((source) => source.page)), new Set([2, 3, 4]));
});

test("generic Introduction and Conclusions sections cannot win selection or return as fallbacks", () => {
  const pages = [
    {
      page: 1,
      text: [
        "Introduction",
        "We introduce a stochastic pricing model that chooses inventory and maximizes expected revenue under demand uncertainty.",
        "The introductory discussion describes the capacity constraint and dynamic policy used throughout the paper.",
      ].join("\n"),
    },
    {
      page: 2,
      text: [
        "Model",
        "The seller chooses a posted price before stochastic demand arrives and observes the customer's purchase action.",
        "The dynamic program maximizes expected revenue with remaining inventory as the state variable.",
      ].join("\n"),
    },
    {
      page: 3,
      text: [
        "Conclusions",
        "The pricing model improves revenue when demand is uncertain and inventory capacity is scarce.",
        "We conclude that the dynamic policy performs well across the reported market settings.",
      ].join("\n"),
    },
  ];

  const selected = selectModelSections(
    pages,
    { title: "Stochastic pricing model under inventory and demand uncertainty" },
    { minSections: 3, maxSections: 5 },
  );
  assert.deepEqual(selected.map((section) => section.title), ["Model"]);
  assert.ok(selected.every((section) => section.page === 2 && !section.synthetic));
});

test("concluding discussions are excluded as conclusion lineage", () => {
  const pages = [{
    page: 8,
    text: [
      "7 Concluding Discussions",
      "The discussion summarizes how the pricing mechanism changes revenue under demand uncertainty.",
      "The paper concludes with implications for managers who choose inventory levels."
    ].join("\n")
  }];
  assert.deepEqual(selectModelSections(pages, { title: "Pricing under uncertainty" }, { minSections: 2, maxSections: 3 }), []);
});

test("model-lineage mechanics outrank result, illustration, and conclusion sections", () => {
  const pages = [
    {
      page: 2,
      text: [
        "3 Model",
        "The planner selects a combination of tests to maximize predictive accuracy subject to an operational budget constraint.",
        "The formulation treats noisy test results as inputs to the robust optimization problem.",
        "3.1 Accounting for Operational Constraints",
        "The feasible test combinations satisfy a capacity constraint before the classification policy is selected.",
        "The model chooses the combination that maximizes accuracy over the uncertainty set.",
      ].join("\n"),
    },
    {
      page: 7,
      text: [
        "5 Results",
        "The reported results compare predictive accuracy and cost for each estimated testing policy.",
        "The numerical experiment evaluates performance under multiple demand scenarios and capacity levels.",
        "5.1 An Illustration of a Specific Policy",
        "The illustration reports the performance of one selected policy under the test data.",
        "The result shows higher accuracy for the robust model in this numerical case.",
      ].join("\n"),
    },
    {
      page: 9,
      text: [
        "6 Conclusion and Implications",
        "The conclusion summarizes how the optimization model improves accuracy under noisy data.",
        "The paper concludes with implications for policy makers who face operational constraints.",
      ].join("\n"),
    },
  ];

  const selected = selectModelSections(
    pages,
    { title: "Robust combination testing with noisy data and operational constraints" },
    { minSections: 1, maxSections: 2 },
  );
  assert.deepEqual(selected.map((section) => section.title), ["Accounting for Operational Constraints", "Model"]);
  assert.ok(selected.every((section) => section.page === 2));
});

test("construction and process headings outrank later application headings at the section cap", () => {
  const pages = [
    {
      page: 6,
      text: [
        "3 Random-walks on Hypergraphs",
        "The hypergraph model represents higher-order interactions and defines a random-walk transition process over connected nodes and hyperedges.",
      ].join("\n"),
    },
    {
      page: 7,
      text: [
        "3.1 Defining Hypergraphs",
        "The formulation represents each firm as a node and each multientity news event as a hyperedge connecting all mentioned firms.",
      ].join("\n"),
    },
    {
      page: 8,
      text: [
        "3.2 Designing Random-walks on Hypergraphs",
        "The discrete-time Markov model first selects a hyperedge according to an edge-selection distribution and then selects a new node according to a node-selection transition distribution.",
      ].join("\n"),
    },
    {
      page: 9,
      text: [
        "3.3 Designing Random-walks on Graphs",
        "The graph benchmark model defines pairwise transition probabilities over adjacent nodes and updates the current state under the corresponding random-walk process at every step.",
      ].join("\n"),
    },
    {
      page: 10,
      text: [
        "3.4 Simulating Random-walks",
        "The algorithm simulates repeated state transitions for many time steps and estimates each node's centrality from the empirical limiting visitation distribution across independent runs.",
      ].join("\n"),
    },
    {
      page: 11,
      text: [
        "4 Theory-Informed Diffusion Processes and Information Centrality",
        "The diffusion model specifies how information flows within group interactions and propagates across groups through linked transition processes.",
      ].join("\n"),
    },
    {
      page: 12,
      text: [
        "4.1 Theory-Informed Micro-Level NS Processes",
        "The micro-level process assigns node-selection probabilities from theory-grounded attributes within the currently selected hyperedge and updates the random-walk state after every transition.",
      ].join("\n"),
    },
    {
      page: 13,
      text: [
        "4.2 Theory-Informed Meso-Level ES Processes",
        "The meso-level process assigns hyperedge-selection probabilities from theory-grounded attributes across the available groups and updates the random-walk state before node selection.",
      ].join("\n"),
    },
    {
      page: 14,
      text: [
        "6.1 TIIC for Preemptive Detection of Spreading Processes",
        "The application reports predictive detection performance for spreading events using the estimated information centrality feature across multiple fitted classification models and evaluation samples.",
      ].join("\n"),
    },
    {
      page: 15,
      text: [
        "6.2 TIIC as a Predictive Feature",
        "The application compares predictive models and reports out-of-sample performance gains from adding the estimated information centrality feature to every fitted classification specification.",
      ].join("\n"),
    },
    {
      page: 16,
      text: [
        "6.3 TIIC for Theory Development and Mechanism Discovery",
        "The application interprets fitted model results to discuss theory development and mechanism discovery across several observed diffusion processes and empirical data samples.",
      ].join("\n"),
    },
    {
      page: 17,
      text: [
        "6.5 Hypergraph Diffusion for Enhancing Node Embeddings",
        "The application evaluates learned node embeddings and reports predictive performance for each downstream classification model across several empirical outcome measures and test samples.",
      ].join("\n"),
    },
  ];

  const selected = selectModelSections(
    pages,
    {
      title: "Preemptive detection, predictive features, theory discovery, and node embeddings",
      abstract: "Applications use information centrality for detection, prediction, mechanism discovery, and node embedding performance.",
    },
    { minSections: 3, maxSections: 8 },
  );
  const titles = new Set(selected.map((section) => section.title));
  for (const required of [
    "Defining Hypergraphs",
    "Random-walks on Hypergraphs",
    "Designing Random-walks on Hypergraphs",
    "Simulating Random-walks",
    "Theory-Informed Diffusion Processes and Information Centrality",
  ]) assert.ok(
    titles.has(required),
    `missing core construction section: ${required}; selected: ${[...titles].join(" | ")}`,
  );
  assert.equal(selected.length, 8);
  assert.equal(selected.some((section) => /^TIIC\b|Enhancing Node Embeddings/i.test(section.title)), false);
});

test("numbered subsections inherit an Introduction ancestor and title fragments are not model components", () => {
  const pages = [{
    page: 1,
    text: [
      "Projects: A Differential Games Approach",
      "This title fragment mentions a differential game and dynamic decisions but is not a section.",
      "1 Introduction",
      "The introduction motivates a stochastic game and describes the decision problem broadly.",
      "1.1 Dynamic Collaborative Environments",
      "This subsection previews a dynamic game in which the parties choose effort over time.",
      "2 Model Formulation",
      "The client and vendor choose effort levels to maximize their discounted payoffs under unverifiable actions.",
      "The differential game defines state dynamics and payment decisions over the project horizon."
    ].join("\n")
  }];
  const selected = selectModelSections(pages, {
    title: "Managing Co-Creation in Information Technology Projects: A Differential Games Approach"
  }, { minSections: 1, maxSections: 3 });
  assert.deepEqual(selected.map((section) => section.title), ["Model Formulation"]);
});

test("a near-copy of the paper title missing one word is not a model component", () => {
  const pages = [{
    page: 1,
    text: [
      "Choice Models and Permutation Invariance: Demand Estimation in Differentiated Products Markets",
      "We propose a neural estimator for a permutation-invariant aggregate demand function.",
      "3 Model and Estimation Framework",
      "The estimator maps observed prices and product features to aggregate demand under identity-independence and permutation-invariance assumptions.",
      "The researchers fit the demand function using observed market-level data."
    ].join("\n")
  }];
  const selected = selectModelSections(pages, {
    title: "Choice Models and Permutation Invariance: Deep Demand Estimation in Differentiated Products Markets"
  }, { minSections: 1, maxSections: 3 });
  assert.deepEqual(selected.map((section) => section.title), ["Model and Estimation Framework"]);
});

test("out-of-order extracted columns do not attach a subsection to the wrong top-level section", () => {
  const pages = [{
    page: 13,
    text: [
      "4 Extensions",
      "The extension changes the pricing decision while retaining the buyer demand model.",
      "5 Concluding Remarks",
      "The conclusion summarizes the pricing and quality results for the model.",
      "4.1 Ex Ante Pricing",
      "The seller chooses an ex ante price before observing the buyer's quality preference.",
      "The extension solves the resulting expected-profit objective under the demand constraint."
    ].join("\n")
  }];
  const selected = selectModelSections(pages, { title: "Customization and Ex Ante Pricing" }, { minSections: 1, maxSections: 3 });
  assert.ok(selected.some((section) => section.title === "Ex Ante Pricing"));
  assert.ok(selected.every((section) => section.title !== "Concluding Remarks"));
});

test("generic overview and contribution prose yields to source-bearing fallback elsewhere", () => {
  const pages = [
    {
      page: 1,
      text: "The pricing model chooses a posted price before uncertain demand arrives and maximizes expected revenue under an inventory constraint.",
    },
    {
      page: 2,
      text: [
        "Overview",
        "This overview introduces the pricing model, inventory state, customer demand, and dynamic revenue objective.",
        "It summarizes how the paper organizes the optimization framework and reports the main policy results.",
      ].join("\n"),
    },
    {
      page: 3,
      text: [
        "Contributions",
        "Our contribution develops a stochastic demand model and an inventory pricing policy for the seller.",
        "The paper also contributes a revenue bound and a capacity-aware optimization algorithm.",
      ].join("\n"),
    },
  ];
  const record = { title: "Dynamic pricing under uncertain demand and inventory constraints" };

  const preferred = selectModelSections(pages, record, { minSections: 3, maxSections: 3 });
  assert.equal(preferred.length, 1);
  assert.equal(preferred[0].page, 1);
  assert.equal(preferred[0].synthetic, true);

  const noAlternative = selectModelSections(pages.slice(1), record, { minSections: 2, maxSections: 3 });
  assert.deepEqual(new Set(noAlternative.map((section) => section.title)), new Set(["Overview", "Contributions"]));
  assert.ok(noAlternative.every((section) => !section.synthetic));
});

test("fallback never substitutes a whole page or fabricates an unmatched component", () => {
  const pages = [
    { page: 1, text: "This page contains administrative publication information without a model sentence." },
    { page: 2, text: "The unrelated historical narrative describes an archive and gives no analytical formulation at all." },
  ];
  const sections = selectModelSections(pages, { title: "Dynamic pricing under demand uncertainty" }, { minSections: 3 });
  assert.deepEqual(sections, []);
});
