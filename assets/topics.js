((root, factory) => {
  const api = factory();
  if (root) root.AtlasTopics = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis, () => {
  "use strict";

  // These are navigational lenses, not author-supplied classifications. One
  // primary lens anchors each paper; its other metadata still shapes its
  // position within the lens. No title, abstract, or search-query text is used.
  const DEFINITIONS = Object.freeze([
    { id: "platforms", label: "Platforms & networks", description: "Intermediaries, digital ecosystems, and network effects.", color: "#9c624b" },
    { id: "information", label: "Information & learning", description: "Signals, disclosure, beliefs, and the value of knowing.", color: "#697b85" },
    { id: "pricing", label: "Pricing & consumers", description: "Prices, product choice, and strategic demand.", color: "#ac8256" },
    { id: "supply-chains", label: "Supply chains", description: "Sourcing, production, and coordination across firms.", color: "#778071" },
    { id: "mechanisms", label: "Markets & mechanisms", description: "Auctions, matching, and rules for allocating resources.", color: "#88737e" },
    { id: "organizations", label: "Organizations & finance", description: "People, incentives, governance, and capital.", color: "#787a86" },
    { id: "innovation", label: "Innovation & technology", description: "New ideas, algorithms, and technological change.", color: "#a66d59" },
    { id: "policy", label: "Policy & sustainability", description: "Public services, regulation, and shared resources.", color: "#6d827b" }
  ].map((definition) => Object.freeze(definition)));

  // Concept weights distinguish domain-specific signals from broad vocabulary.
  // The strongest concept in a field counts once, so long or repeated tag lists
  // cannot overwhelm a paper's primary topic. Ties use DEFINITIONS order.
  const CONCEPTS = {
    platforms: [
      [4, /\b(?:platforms?|marketplaces?|two sided|ecosystems?|multihoming|ride hailing|social media|streaming|creator platforms?)\b/],
      [3, /\b(?:networks?|network effects?|intermediar(?:y|ies)|digital content|media firms?|content exclusivity|food delivery|influencers?|sponsored search|shadowbanning)\b/],
      [2, /\b(?:digital markets?|on demand|content supply|content strategy|membership|data brokers?|online advertising)\b/]
    ],
    information: [
      [4, /\b(?:information design|information disclosure|information acquisition|information aggregation|information revelation|information transmission|preference revelation|disclosure|signaling|signals?|cheap talk|persuasion|observational learning|bayesian learning|beliefs?|forecast communication|adverse selection)\b/],
      [3, /\b(?:information|informative(?:ness)?|learning|communication|privacy|reputation|transparency|uncertainty|reviews?|fact checking)\b/],
      [2, /\b(?:data|attention|forecast|screening|search activity)\b/]
    ],
    pricing: [
      [4, /\b(?:pricing|prices?|price discrimination|consumers?|customers?|assortment|revenue management|product variety|product line|product offerings?|product complexity|product customization|customization|personalized product|retail treasure hunt|loyalty programs?)\b/],
      [3, /\b(?:selling|retail|advertising|marketing|product design|product quality|product ranking|bundling|resale|targeting|consumer search|demand)\b/],
      [2, /\b(?:bargaining|quality competition|product market|service choice|search prominence)\b/]
    ],
    "supply-chains": [
      [4, /\b(?:supply chains?|supply chain|supply cost|supplier(?:s| development)?|sourcing|inventory|wholesale|manufacturer(?:s)?|distribution channels?|vertical channels?|channel coordination|channel contracting|supply concentration|supply chains and contracts|commodity contracts?)\b/],
      [3, /\b(?:procurement|production|distribution|logistics|fulfillment|agricultural contracting|capacity|commodity contracts?|global sourcing|retail contracts?|upstream|downstream|vertical contracting|buy online|bopis|omnichannel)\b/],
      [2, /\b(?:channels?|operations|delivery cost|transportation and logistics)\b/]
    ],
    mechanisms: [
      [4, /\b(?:auctions?|bidding|mechanism(?:s| design)?|market design|matching|deferred acceptance|strategy proof|allocation rules?|fair allocation|divide and choose|walrasian|contest design|contests?)\b/],
      [3, /\b(?:allocation|mediation|admissions|college choice|incentive compatible|cooperative allocation|revenue allocation|voting|collective choice|coalitions?|equilibrium computation|computational equilibrium)\b/],
      [2, /\b(?:contract theory|bargaining|general equilibrium|game theory)\b/]
    ],
    organizations: [
      [4, /\b(?:finance|financial|financing|capital|credit|loans?|debt|invest(?:ment|ors?)|funding|crowdfunding|bank(?:s|ing)?|bonds?|portfolio|asset pricing|short selling|share repurchases|liquidity|stablecoins?|currency|trading strategies|workers?|workforce|labor|employees?|personnel|talent|human capital|management|managers?|managerial|organizations?|organizational|corporate|governance|ownership|compensation|firms? boundaries|firm boundaries|teams?|acquihiring)\b/],
      [3, /\b(?:incentives?|moral hazard|delegation|effort|cooperation|committees?|auditing|auditors?|mergers?|takeover|insurance|risk sharing|income sharing|internal control|retaliate|collusion|accounting|career|dao|daos)\b/],
      [2, /\b(?:behavioral|experimental|industrial organization|competitive strategy|firm policy|service operations|queueing|contracting)\b/]
    ],
    innovation: [
      [4, /\b(?:innovation|technology|technological|artificial intelligence|ai|algorithms?|algorithmic|q learning|machine learning|automation|automating|autonomous|blockchain|cybersecurity|ransomware|cloud computing|knowledge production|knowledge transfer|knowledge spillovers?|research and development|r d|product development|data analytics|data driven|analytics markets?)\b/],
      [3, /\b(?:computational|computation|digital products?|human algorithm|human ai|bug bounty|voice cloning|central bank digital currency|ar fitting|development|compatibility|knowledge)\b/],
      [2, /\b(?:information systems|digital strategy|adoption|co creation|crowdsourcing|data and analytics|information security)\b/]
    ],
    policy: [
      [4, /\b(?:sustainability|sustainable|environmental|climate|carbon|emissions?|responsible operations|public policy|public services?|public goods?|healthcare|health care|cancer|antimalarial|subsid(?:y|ies|izing)|regulation|regulatory|regulating|antitrust|government|political|nonmarket|education|electricity|energy|resource pooling)\b/],
      [3, /\b(?:policy|welfare|fairness|equality|public resources?|public economics|social responsibility|circular economy|congestion|parking|commuting|data portability fines|liability rules?|corruption|bribery|deceptive counterfeits|excessive overtime)\b/],
      [2, /\b(?:externalities|polarization|compliance|collective|social dilemmas|fair|transportation|agricultural markets)\b/]
    ]
  };

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function metadataValues(value) {
    return (Array.isArray(value) ? value : [value])
      .filter((item) => typeof item === "string")
      .map(normalize)
      .filter(Boolean);
  }

  function fieldScore(values, concepts) {
    let score = 0;
    for (const value of values) {
      for (const [weight, expression] of concepts) {
        if (weight > score && expression.test(value)) score = weight;
      }
    }
    return score;
  }

  function classifyPaper(record = {}) {
    const paper = record || {};
    const fields = [
      [20, metadataValues(paper.primary_topic)],
      [5, metadataValues(paper.topic_families)],
      [3, metadataValues(paper.topics)],
      [2, metadataValues(paper.model_topic)]
    ];
    let winner = "organizations";
    let winnerScore = 0;
    for (const definition of DEFINITIONS) {
      const score = fields.reduce((total, [weight, values]) => total + weight * fieldScore(values, CONCEPTS[definition.id]), 0);
      if (score > winnerScore) {
        winner = definition.id;
        winnerScore = score;
      }
    }
    return winner;
  }

  function createTopicIndex(records = []) {
    const index = DEFINITIONS.map((definition) => ({ ...definition, ids: [], count: 0 }));
    const byId = new Map(index.map((entry) => [entry.id, entry]));
    for (const record of records) {
      const entry = byId.get(classifyPaper(record));
      entry.ids.push(record.id);
      entry.count += 1;
    }
    return index;
  }

  return Object.freeze({ DEFINITIONS, classifyPaper, createTopicIndex });
});
