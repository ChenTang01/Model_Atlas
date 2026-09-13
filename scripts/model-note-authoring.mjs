import { createHash } from "node:crypto";
import {
  completeModelSetupFromSource,
  deriveModelSetup,
  deriveResearchQuestion,
  deriveSubstantiveMethod,
  isDirectResearchQuestion,
  isSubstantiveMethodStatement
} from "./model-note-semantic-authoring.mjs";
import {
  AUTOMATED_REVIEW_STATUS,
  mapComponentRelevance,
  sourceSupportsRole,
  usableRelevanceSourceExcerpt
} from "./model-note-relevance.mjs";
import {
  hasExtractionNoise as hasSourceTextNoise,
  hasOrphanMathScriptMarker,
  isBoilerplate,
  isCaption,
  isCitation,
  NAMED_MATH_IDENTIFIERS,
  isPaperOrganizationProse,
  isTableRow,
  isWhitespaceNormalizedSubstring,
  literalSourceSentenceCandidates,
  meaningfulText,
  normalizeWhitespace,
  remapNormalizedSourceQuote,
  selectLiteralSourceSentence,
  semanticFingerprint
} from "./model-note-text-quality.mjs";
import { planModelVariants } from "./model-note-variants.mjs";
import {
  headingLabelRejectionReason,
  sourceHeadingRejectionReason
} from "./model-note-semantic-audit.mjs";
import {
  extractCleanSections,
  selectModelSections,
  selectSectionSource
} from "./model-note-sections.mjs";
import {
  canonicalizeMathNotation,
  formalStructureIssue,
  formulaContaminatedProse,
  hasMathematicalExtractionNoise
} from "./model-note-formula-quality.mjs";

export const AUTHORING_SCHEMA_VERSION = 1;
export const AUTHORING_VERSION = "source-sections-v20";

export const ALLOWED_MODEL_TYPES = new Set([
  "Game theory",
  "Optimization",
  "Stochastic model",
  "Queueing",
  "Simulation",
  "Structural model",
  "Learning & algorithms",
  "Economic theory"
]);

export const ALLOWED_COMPONENT_ROLES = new Set([
  "decision",
  "state",
  "process",
  "preference",
  "constraint",
  "information",
  "interaction",
  "objective",
  "estimation",
  "algorithm"
]);

export const ADDITIONAL_CONCEPTS = [
  { id: "adversarial-arrivals", label: "Adversarial arrivals", aliases: ["adversarial customer sequence", "arbitrary arrival sequence"], related: ["uncertainty"] },
  { id: "advertising-allocation", label: "Advertising allocation", aliases: ["ad allocation", "advertisement allocation"], related: ["resource-assignment"] },
  { id: "algorithm-design", label: "Algorithm design", aliases: ["algorithmic design", "solution algorithm"], related: ["approximation-algorithms"] },
  { id: "analytical-model", label: "Analytical modeling", aliases: ["analytical model", "mathematical modeling"], related: ["optimization"] },
  { id: "approximation-algorithms", label: "Approximation algorithms", aliases: ["approximation algorithm", "approximation guarantee"], related: ["algorithm-design"] },
  { id: "assortment-optimization", label: "Assortment optimization", aliases: ["product assortment optimization", "assortment planning"], related: ["consumer-choice", "optimization"] },
  { id: "auctions", label: "Auctions", aliases: ["auction design", "bidding mechanism"], related: ["mechanism-design"] },
  { id: "bandit-feedback", label: "Bandit feedback", aliases: ["partial feedback", "bandit learning"], related: ["online-learning"] },
  { id: "capacity-planning", label: "Capacity planning", aliases: ["capacity investment", "capacity choice"], related: ["resource-capacity"] },
  { id: "choice-model", label: "Discrete choice model", aliases: ["choice model", "discrete choice"], related: ["consumer-choice"] },
  { id: "clinical-trial-design", label: "Clinical trial design", aliases: ["trial design", "adaptive clinical trial"], related: ["healthcare-operations"] },
  { id: "competition", label: "Competition", aliases: ["competitive interaction", "market competition"], related: ["strategic-interaction"] },
  { id: "competitive-analysis", label: "Competitive analysis", aliases: ["competitive ratio analysis", "online competitive guarantee"], related: ["regret-analysis"] },
  { id: "contract-design", label: "Contract design", aliases: ["contracting", "contractual mechanism", "payment structure", "payment terms", "compensation contract"], related: ["incentive-compatibility", "principal-agent"] },
  { id: "crowdsourcing", label: "Crowdsourcing", aliases: ["crowd sourcing", "crowd work"], related: ["platform-markets"] },
  { id: "data-driven-optimization", label: "Data-driven optimization", aliases: ["data driven optimization", "prescriptive analytics"], related: ["optimization", "machine-learning"] },
  { id: "decision-making", label: "Decision making", aliases: ["decision rule", "policy choice"], related: ["optimization"] },
  { id: "demand-forecasting", label: "Demand forecasting", aliases: ["demand prediction", "forecasting demand"], related: ["demand-learning"] },
  { id: "dynamic-pricing", label: "Dynamic pricing", aliases: ["time-varying pricing", "intertemporal pricing"], related: ["pricing"] },
  { id: "energy-systems", label: "Energy systems", aliases: ["electricity systems", "power systems"], related: ["sustainability"] },
  { id: "estimation", label: "Model estimation", aliases: ["parameter estimation", "statistical estimation"], related: ["structural-estimation"] },
  { id: "empirical-validation", label: "Empirical validation", aliases: ["numerical validation", "computational evaluation"], related: ["simulation"] },
  { id: "exploration-exploitation", label: "Exploration-exploitation trade-off", aliases: ["exploration versus exploitation", "explore-exploit tradeoff"], related: ["online-learning"] },
  { id: "facility-planning", label: "Facility planning", aliases: ["facility design", "service network planning"], related: ["facility-location"] },
  { id: "feasibility-constraints", label: "Feasibility constraints", aliases: ["feasibility condition", "feasible set", "model constraint"], related: ["optimization"] },
  { id: "forecasting", label: "Forecasting", aliases: ["prediction", "predictive model"], related: ["demand-forecasting"] },
  { id: "healthcare-operations", label: "Healthcare operations", aliases: ["health care operations", "medical operations"], related: ["resource-assignment"] },
  { id: "information-asymmetry", label: "Information asymmetry", aliases: ["asymmetric information", "information imbalance"], related: ["private-information"] },
  { id: "information-disclosure", label: "Information disclosure", aliases: ["disclosure policy", "information release"], related: ["information-design"] },
  { id: "information-structure", label: "Information structure", aliases: ["available information", "observed information", "information set"], related: ["private-information"] },
  { id: "inventory-control", label: "Inventory control", aliases: ["inventory policy", "stock control"], related: ["inventory"] },
  { id: "inventory-balancing", label: "Inventory balancing", aliases: ["inventory balancing potential", "depletion balancing"], related: ["inventory-control", "resource-capacity"] },
  { id: "iid-arrivals", label: "IID arrivals", aliases: ["independent identically distributed arrivals"], related: ["adversarial-arrivals"] },
  { id: "logistics", label: "Logistics", aliases: ["delivery operations", "distribution logistics"], related: ["supply-chain-coordination"] },
  { id: "machine-learning", label: "Machine learning", aliases: ["predictive learning", "statistical learning"], related: ["data-driven-optimization"] },
  { id: "matching", label: "Matching", aliases: ["matching market", "bipartite matching"], related: ["resource-assignment"] },
  { id: "mechanism-design", label: "Mechanism design", aliases: ["market mechanism design", "incentive mechanism"], related: ["incentive-compatibility"] },
  { id: "model-interaction", label: "Model interaction", aliases: ["actor interaction", "modeled interaction", "interaction structure"], related: ["strategic-interaction"] },
  { id: "model-objective", label: "Model objective", aliases: ["modeled objective", "objective criterion", "objective rule"], related: ["optimization", "decision-making"] },
  { id: "newsvendor", label: "Newsvendor", aliases: ["newsvendor model", "single-period inventory"], related: ["inventory"] },
  { id: "network-optimization", label: "Network optimization", aliases: ["network flow optimization", "network design"], related: ["optimization"] },
  { id: "optimization", label: "Optimization", aliases: ["mathematical optimization", "mathematical programming", "maximize the objective", "minimize expected cost", "objective function", "optimal solution"], related: ["decision-making"] },
  { id: "platform-markets", label: "Platform markets", aliases: ["digital platform", "two-sided platform"], related: ["network-effects"] },
  { id: "policy-learning", label: "Policy learning", aliases: ["learning a policy", "treatment policy learning"], related: ["online-learning"] },
  { id: "pricing", label: "Pricing", aliases: ["price setting", "pricing decision"], related: ["dynamic-pricing"] },
  { id: "preference-modeling", label: "Preference modeling", aliases: ["preference specification", "modeled preferences", "utility preferences"], related: ["consumer-choice"] },
  { id: "procurement", label: "Procurement", aliases: ["sourcing", "purchasing"], related: ["supplier-selection"] },
  { id: "process-dynamics", label: "Process dynamics", aliases: ["system dynamics", "dynamic process"], related: ["stochastic-transition"] },
  { id: "recommendation", label: "Recommendation systems", aliases: ["product recommendation", "recommender system"], related: ["consumer-choice"] },
  { id: "regret-analysis", label: "Regret analysis", aliases: ["online regret bound", "learning regret"], related: ["online-learning", "competitive-analysis"] },
  { id: "replenishment", label: "Replenishment", aliases: ["inventory replenishment", "stock replenishment"], related: ["inventory"] },
  { id: "resource-allocation", label: "Resource allocation", aliases: ["allocation of resources", "capacity allocation"], related: ["resource-assignment", "resource-capacity"] },
  { id: "revenue-management", label: "Revenue management", aliases: ["revenue optimization", "RM model"], related: ["network-revenue-management", "pricing"] },
  { id: "risk-management", label: "Risk management", aliases: ["risk-sensitive decision", "risk control"], related: ["robust-optimization"] },
  { id: "scheduling", label: "Scheduling", aliases: ["schedule optimization", "sequencing"], related: ["appointment-scheduling"] },
  { id: "service-operations", label: "Service operations", aliases: ["service system", "service operations model"], related: ["queueing"] },
  { id: "simulation", label: "Simulation", aliases: ["simulation model", "computational simulation"], related: ["process-dynamics"] },
  { id: "strategic-interaction", label: "Strategic interaction", aliases: ["game-theoretic interaction", "strategic behavior", "best response", "strategic game"], related: ["competition", "equilibrium-analysis"] },
  { id: "structural-estimation", label: "Structural estimation", aliases: ["structural econometric model", "structural model estimation"], related: ["estimation"] },
  { id: "stochastic-resource-consumption", label: "Stochastic resource consumption", aliases: ["random resource consumption", "probabilistic resource use"], related: ["resource-allocation", "stochastic-transition"] },
  { id: "supply-chain-coordination", label: "Supply-chain coordination", aliases: ["supply chain coordination", "channel coordination"], related: ["contract-design"] },
  { id: "sustainability", label: "Sustainability", aliases: ["environmental sustainability", "sustainable operations"], related: ["environmental-quality"] },
  { id: "system-state", label: "System state", aliases: ["state representation", "decision state"], related: ["process-dynamics"] },
  { id: "transportation-systems", label: "Transportation systems", aliases: ["mobility system", "transport operations"], related: ["network-optimization"] },
  { id: "contextual-bandit", label: "Contextual bandit", aliases: ["contextual multi-armed bandit", "bandit with contexts"], related: ["online-learning", "bandit-feedback"] },
  { id: "multinomial-logit-choice", label: "Multinomial logit choice", aliases: ["MNL choice model", "multinomial logit demand"], related: ["choice-model"] },
  { id: "thompson-sampling", label: "Thompson sampling", aliases: ["posterior sampling", "Bayesian bandit sampling"], related: ["online-learning", "bayesian-updating"] },
  { id: "upper-confidence-bound", label: "Upper confidence bound", aliases: ["UCB", "optimism under uncertainty"], related: ["online-learning", "exploration-exploitation"] },
  { id: "uncertainty", label: "Uncertainty", aliases: ["model uncertainty", "uncertain environment", "unknown parameter", "random input"], related: ["distributional-ambiguity"] },
  { id: "bargaining", label: "Bargaining", aliases: ["price bargaining", "bilateral bargaining", "negotiation", "bargaining power"], related: ["strategic-interaction", "pricing"] },
  { id: "cheap-talk", label: "Cheap talk", aliases: ["costless message", "nonbinding message", "cheap-talk communication"], related: ["signaling", "information-disclosure"] },
  { id: "differential-games", label: "Differential games", aliases: ["differential game", "dynamic continuous-time game"], related: ["strategic-interaction", "optimal-control"] },
  { id: "effort-choice", label: "Effort choice", aliases: ["effort level", "effort decision", "costly effort"], related: ["moral-hazard", "principal-agent"] },
  { id: "equilibrium-analysis", label: "Equilibrium analysis", aliases: ["equilibrium characterization", "equilibrium conditions", "perfect bayesian equilibrium", "nash equilibrium"], related: ["strategic-interaction"] },
  { id: "learning-by-doing", label: "Learning by doing", aliases: ["learning effect", "self-learning", "experience curve"], related: ["process-dynamics"] },
  { id: "moral-hazard", label: "Moral hazard", aliases: ["hidden action", "unobservable effort", "unverifiable effort", "double moral hazard"], related: ["principal-agent", "information-asymmetry"] },
  { id: "participation-constraint", label: "Participation constraint", aliases: ["individual rationality", "reservation utility", "acceptance constraint"], related: ["incentive-compatibility", "contract-design"] },
  { id: "principal-agent", label: "Principal-agent model", aliases: ["principal agent", "client and vendor", "buyer and supplier contract"], related: ["contract-design", "moral-hazard"] },
  { id: "quality-choice", label: "Quality choice", aliases: ["product quality", "quality decision", "customized quality"], related: ["endogenous-quality", "product-line"] },
  { id: "signaling", label: "Signaling", aliases: ["costly signal", "type signaling", "signal private information"], related: ["information-asymmetry", "cheap-talk"] }
];

const STOP_WORDS = new Set("a an and are as at be been being by can could did do does for from had has have how if in into is it its may might model models of on or paper problem should system than that the their them then there these they this those through to under use uses using was we were what when where which who will with would".split(" "));
const SOURCE_STOP_WORDS = new Set([...STOP_WORDS, "modeled", "modeling", "section", "study", "why"]);

const TYPE_RULES = [
  ["Queueing", /\b(queue|queueing|queuing|waiting time|congestion)\b/i],
  ["Game theory", /\b(nash|stackelberg|equilibrium|strategic interaction|noncooperative|cooperative game|bargain|auction|mechanism design|game-theoretic)\b/i],
  ["Structural model", /\b(structural model|random coefficients?|mixed logit|maximum likelihood|econometric|identification|estimate demand)\b/i],
  ["Simulation", /\b(simulation model|agent-based simulation|monte carlo simulation|fluid simulation|discrete-event simulation)\b/i],
  ["Learning & algorithms", /\b(algorithm|online learning|bandit|reinforcement learning|machine learning|neural|approximation|regret|heuristic)\b/i],
  ["Stochastic model", /\b(stochastic|random|uncertain|probability|probabilistic|markov|poisson|brownian|renewal)\b/i],
  ["Optimization", /\b(optimi[sz]|linear program|integer program|dynamic program|objective|constraint|scheduling|allocation|control policy)\b/i],
  ["Economic theory", /\b(utility|welfare|consumer surplus|firm profit|demand system|economic model|market design|pricing)\b/i]
];

const ROLE_RULES = [
  ["estimation", /\b(estimat|identif|likelihood|regression|inference|calibrat)\b/i],
  ["algorithm", /\b(algorithm|heuristic|policy iteration|learning|oracle|approximation|procedure|training|solve[sd]?|backward induction|working backward|dynamic program|decomposition)\b/i],
  ["objective", /\b(objective|maximi[sz](?:e|es|ed|ing|ation)?|minimi[sz](?:e|es|ed|ing|ation)?|welfare|profit|cost function|loss function|reward)\b/i],
  ["constraint", /\b(constraint|capacity|budget|feasib|limit|restriction|balance equation)\b/i],
  ["information", /\b(information|observ(?:e|es|ed|ing|able|ation)?|belief|signal|unknown|uncertain|random\s+(?:variable|vector|quantity)|learn(?:s|ed|ing)?|forecast|data)\b/i],
  ["interaction", /\b(equilibrium|competition|game|strategic|bargain|auction|mechanism|contract|(?:manufacturing|design|technology)\s+licens(?:e|ing)|licens(?:e|ing)\s+(?:agreement|contract|fee|terms?|strateg(?:y|ies)))\b/i],
  ["preference", /\b(utility|choice|valuation|preference|demand)\b/i],
  ["decision", /\b(decisions?|action|choice|allocation|pricing|scheduling|control|choos(?:e|es|ing)|decid(?:e|es|ing)|select(?:s|ed|ing)?|set(?:s|ting)?|offer(?:s|ed|ing)?|disclos(?:e|es|ed|ing)|saniti[sz](?:e|es|ed|ing|ation))\b/i],
  ["state", /\b(state|inventory level|queue length|waiting time|system status|stock level)\b/i],
  ["process", /\b(process|dynamics|arrival|transition|demand|flow|evolution|service|adaptation|accommodat(?:e|es|ed|ing))\b|\bproceed(?:s|ed|ing)?\s+at\s+(?:time(?:\s*-\s*|\s+)dependent|constant|variable)\s+rates?\b|\btracks?\b[^.!?]{0,120}\b(?:over|by)\s+time\b/i]
];

const CONCEPT_RULES = [
  ["newsvendor", /\bnewsvendor\b/i],
  ["inventory-balancing", /\binventory balancing\b/i],
  ["inventory-control", /\b(inventory control|inventory policy|replenish|base.stock|order quantity)\b/i],
  ["inventory", /\b(inventory|stock|backorder|lost sales)\b/i],
  ["online-learning", /\b(online learning|learn(?:ing)? while|regret|upper confidence|ucb|bandit)\b/i],
  ["upper-confidence-bound", /\b(upper confidence bound|ucb|optimism in the face of uncertainty)\b/i],
  ["contextual-bandit", /\b(contextual bandit|contextual multi.?armed bandit)\b/i],
  ["exploration-exploitation", /\b(exploration.{0,15}exploitation|explore.{0,12}exploit)\b/i],
  ["regret-analysis", /\b(regret bound|regret analysis|relaxed regret)\b/i],
  ["competitive-analysis", /\b(competitive ratio|competitive analysis)\b/i],
  ["bandit-feedback", /\b(bandit feedback|partial feedback|multi.?armed bandit|ucb)\b/i],
  ["reinforcement-learning", /\b(reinforcement learning|deep q|policy gradient|proximal policy)\b/i],
  ["machine-learning", /\b(machine learning|deep learning|neural network|prediction model)\b/i],
  ["demand-learning", /\b(demand learning|learn(?:ing)? demand|unknown demand)\b/i],
  ["demand-forecasting", /\b(demand forecast|forecasting demand|sales forecast)\b/i],
  ["forecasting", /\b(forecast|prediction)\b/i],
  ["queueing", /\b(queue|queueing|queuing|waiting line|service system)\b/i],
  ["waiting-cost", /\b(waiting cost|delay cost|cost of waiting)\b/i],
  ["resource-allocation", /\b(resource allocation|capacity allocation|allocate limited|allocation decision)\b/i],
  ["stochastic-resource-consumption", /\b(stochastic resource consumption|outcome distribution|probabilistic resource)\b/i],
  ["adversarial-arrivals", /\b(adversarial (?:arrival|context|customer)|arbitrary arrival sequence)\b/i],
  ["resource-assignment", /\b(assignment|matching resources?|assign(?:ing|ment))\b/i],
  ["resource-capacity", /\b(capacity|resource constraint|limited resource|budget constraint)\b/i],
  ["capacity-planning", /\b(capacity planning|capacity investment|expand capacity)\b/i],
  ["scheduling", /\b(schedul|sequenc|timetable)\b/i],
  ["appointment-scheduling", /\bappointment schedul/i],
  ["dynamic-pricing", /\b(dynamic pricing|intertemporal pricing|time.varying price)\b/i],
  ["personalized-pricing", /\b(personalized pricing|individualized price)\b/i],
  ["pricing", /\b(price|pricing|tariff|fee)\b/i],
  ["assortment-optimization", /\b(assortment|product selection)\b/i],
  ["consumer-choice", /\b(consumer choice|customer choice|purchase choice|demand model)\b/i],
  ["choice-model", /\b(logit|choice model|choice probabilities)\b/i],
  ["multinomial-logit-choice", /\b(multinomial logit|mnl (?:choice|demand))\b/i],
  ["consumer-heterogeneity", /\b(heterogeneous consumers?|customer heterogeneity|consumer segment)\b/i],
  ["strategic-consumers", /\b(strategic consumers?|forward.looking consumers?|strategic waiting)\b/i],
  ["strategic-interaction", /\b(strategic|equilibrium|best response|game.theoretic)\b/i],
  ["competition", /\b(competition|competitive|rival firms?)\b/i],
  ["price-competition", /\b(price competition|bertrand)\b/i],
  ["mechanism-design", /\b(mechanism design|incentive mechanism)\b/i],
  ["auctions", /\b(auction|bidder|bidding)\b/i],
  ["contract-design", /\b(contract|contracting)\b/i],
  ["incentive-compatibility", /\b(incentive compatib|truthful|self.selection)\b/i],
  ["private-information", /\b(private information|private type|privately known)\b/i],
  ["information-asymmetry", /\b(asymmetric information|information asymmetry)\b/i],
  ["information-disclosure", /\b(disclos|information release|transparency)\b/i],
  ["information-design", /\b(information design|signal design|persuasion)\b/i],
  ["bayesian-updating", /\b(bayesian|posterior|belief updat)\b/i],
  ["thompson-sampling", /\bthompson sampling\b/i],
  ["uncertainty", /\b(uncertain|unknown|ambigu|random)\b/i],
  ["distributional-ambiguity", /\b(distributional(?:ly)? robust|ambiguity set|wasserstein)\b/i],
  ["robust-optimization", /\b(robust optimization|worst.case|robust counterpart)\b/i],
  ["risk-management", /\b(risk|cvar|value.at.risk|risk sensitive)\b/i],
  ["markov-decision-process", /\b(markov decision|mdp|state transition)\b/i],
  ["dynamic-programming", /\b(dynamic program|bellman equation)\b/i],
  ["optimal-control", /\b(optimal control|hamiltonian|maximum principle)\b/i],
  ["simulation", /\b(simulation|agent.based|discrete.event)\b/i],
  ["optimization", /\b(optimi[sz]|linear program|integer program|objective function)\b/i],
  ["data-driven-optimization", /\b(data.driven|prescriptive analytics|sample.based optimization)\b/i],
  ["approximation-algorithms", /\b(approximation algorithm|approximation guarantee|constant.factor)\b/i],
  ["algorithm-design", /\b(algorithm|heuristic|oracle|procedure)\b/i],
  ["structural-estimation", /\b(structural model|structural estimation|econometric model)\b/i],
  ["estimation", /\b(estimat|maximum likelihood|regression|inference)\b/i],
  ["platform-markets", /\b(platform|marketplace|two.sided)\b/i],
  ["network-effects", /\b(network effect|network externalit)\b/i],
  ["matching", /\b(matching|match market|kidney exchange)\b/i],
  ["network-optimization", /\b(network flow|network design|routing network)\b/i],
  ["revenue-management", /\b(revenue management|revenue optimization)\b/i],
  ["recommendation", /\b(recommend|recommender)\b/i],
  ["advertising-allocation", /\b(advertis|ad allocation|display ad)\b/i],
  ["crowdsourcing", /\b(crowdsourc|crowd work)\b/i],
  ["supply-chain-coordination", /\b(supply chain|channel coordination)\b/i],
  ["procurement", /\b(procurement|sourcing|supplier selection)\b/i],
  ["logistics", /\b(logistics|delivery|fulfillment|warehouse)\b/i],
  ["healthcare-operations", /\b(patient|hospital|healthcare|health care|clinical)\b/i],
  ["clinical-trial-design", /\b(clinical trial|dose.finding|patient recruitment)\b/i],
  ["transportation-systems", /\b(vehicle|transport|ride.hailing|mobility|airline|rail)\b/i],
  ["energy-systems", /\b(electricity|energy|power grid|renewable|battery)\b/i],
  ["sustainability", /\b(sustainab|carbon|emission|environmental|green product)\b/i],
  ["facility-location", /\b(facility location|site location|facility siting)\b/i],
  ["facility-planning", /\b(facility planning|network planning|service network)\b/i]
];

const ROLE_DEFAULT_CONCEPT = {
  decision: "decision-making",
  state: "system-state",
  process: "process-dynamics",
  preference: "consumer-choice",
  constraint: "resource-capacity",
  information: "uncertainty",
  interaction: "strategic-interaction",
  objective: "optimization",
  estimation: "estimation",
  algorithm: "algorithm-design"
};

const ROLE_QUERY = {
  decision: "decision rule",
  state: "decision-relevant state",
  process: "system process",
  preference: "modeled preferences",
  constraint: "feasibility condition",
  information: "information available to the decision maker",
  interaction: "strategic response",
  objective: "modeled objective",
  estimation: "estimation procedure",
  algorithm: "solution algorithm"
};

const ENTITY_RULES = [
  [/\bplatforms?\b/i, "Platform or intermediary"],
  [/\b(retailer|seller|firm|manufacturer)s?\b/i, "Firm or seller"],
  [/\b(consumers?|customers?|buyers?|users?)\b/i, "Customers or users"],
  [/\b(suppliers?|vendors?)\b/i, "Suppliers or vendors"],
  [/\b(patients?|hospitals?|physicians?|clinics?)\b/i, "Healthcare providers and patients"],
  [/\b(resources?|capacity|servers?|facilities?)\b/i, "Resources and service capacity"],
  [/\b(products?|items?|inventory|stock)\b/i, "Products or inventory units"],
  [/\b(vehicles?|drivers?|riders?|passengers?)\b/i, "Transportation participants and vehicles"],
  [/\b(advertisers?|advertisements?|publishers?)\b/i, "Advertisers, content, or audiences"],
  [/\b(agents?|players?|bidders?)\b/i, "Strategic agents"],
  [/\b(nodes?|arcs?|networks?|locations?)\b/i, "Network nodes, links, or locations"]
];

const INPUT_RULES = [
  [/\b(demand|arrival|request)s?\b/i, "Demand or arrival information"],
  [/\b(cost|price|reward|revenue|profit)s?\b/i, "Economic rewards and cost parameters"],
  [/\b(capacity|inventory|budget|resource)s?\b/i, "Resource and capacity parameters"],
  [/\b(probabilit|distribution|stochastic|random|uncertain)/i, "Probability distributions and uncertainty parameters"],
  [/\b(valuation|utility|preference|choice)s?\b/i, "Preferences, valuations, or choice parameters"],
  [/\b(context|feature|covariate|data|observation)s?\b/i, "Observed data or contextual information"],
  [/\b(time|horizon|period|epoch|discount)/i, "Timing and horizon parameters"],
  [/\b(network|distance|location|route)s?\b/i, "Network or spatial inputs"]
];

const DECISION_RULES = [
  [/\b(price|pricing|tariff|fee)s?\b/i, "Prices or pricing policies"],
  [/\b(inventory|replenish|order quantity|stock)\b/i, "Inventory or replenishment decisions"],
  [/\b(allocat|assign|match|admit|route)/i, "Resource-allocation or assignment actions"],
  [/\b(schedul|sequenc|appointment)/i, "Scheduling or sequencing decisions"],
  [/\b(capacity|facility|location|network design)/i, "Capacity, facility, or network-design decisions"],
  [/\b(contract|mechanism|auction|bid)/i, "Contract or mechanism-design choices"],
  [/\b(assortment|product line|recommend)/i, "Assortment, product, or recommendation choices"],
  [/\b(policy|control|action|decision)/i, "State-dependent policy or control actions"],
  [/\b(estimat|learn|forecast|predict)/i, "Estimation, learning, or prediction decisions"]
];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value, space = 0) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item, space)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], space)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cleanText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0088/g, "=")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\u00ad\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize source-native notation only in Atlas-authored display prose.
 * Literal evidence fields deliberately do not call this helper: their raw
 * `$C`/`$U` labels and ASCII set-difference backslashes remain auditable
 * byte-for-byte against the frozen page extraction.
 */
export function normalizeAuthoredDisplayProse(value) {
  let text = String(value ?? "");
  const supplierEquilibriumLabels = text.match(
    /^(?:we\s+denote|the model\s+denotes)\s+the equilibrium where both buyers sharing a supplier by\s+\$?([A-Za-z])\s+and one where the buyers sourcing from different suppliers by\s+\$?([A-Za-z])\s*[.]?$/iu
  );
  if (supplierEquilibriumLabels) {
    const owner = /^we\s+denote\b/iu.test(text) ? "We denote" : "The model denotes";
    text = `${owner} the equilibrium in which both buyers share a supplier as ${supplierEquilibriumLabels[1]} and the equilibrium in which they source from different suppliers as ${supplierEquilibriumLabels[2]}.`;
  } else if (/\b(?:buyers?|supplier|sourc(?:e|es|ed|ing))\b/iu.test(text)) {
    // A relevance snippet can begin after the first half of the definition.
    // In that bounded supplier context C and U are equilibrium labels, not
    // currency markers or TeX delimiters.
    text = text.replace(/(?<!\\)\$([CU])\b/gu, "$1");
  }
  // PDF text layers write set difference in several compact forms: N\A,
  // S \ {i}, S1\S2, and clconv(Fi)\Fi. Recognize the operator from its
  // set-like boundary rather than from operand spelling, while leaving TeX
  // commands, filesystem paths, escaped hyphens, and ordinary prose alone.
  return text.replace(/(\S)(\s*)\\(\s*)(\S)/gu, (match, left, _leftSpace, rightSpace, right, offset, whole) => {
    if (/[-\d]/u.test(right) || /[#^:]/u.test(left)) return match;
    const beforeOperator = whole.slice(0, offset + 1 + _leftSpace.length);
    if (/\b[A-Za-z]:\\[^\s]*$/u.test(beforeOperator)) return match;
    const prefix = whole.slice(0, offset + 1);
    const leftToken = prefix.match(/([\p{L}\p{N}′’*∗+(){}\[\]]+)$/u)?.[1] || left;
    const strongRight = /^(?:[\p{Lu}\p{M}Α-Ωα-ω{([∪⋃])/u.test(right);
    const setLikeLeft = /[\p{Lu}\p{N}Α-Ωα-ω′’*∗+)}\]]$/u.test(leftToken)
      || /^\p{Lu}/u.test(leftToken);
    const lowercaseIdentifier = /^\p{Ll}/u.test(right)
      && (setLikeLeft || /^[A-Z][A-Za-z0-9]*$/u.test(leftToken));
    if (!strongRight && !lowercaseIdentifier) return match;
    if (!rightSpace && /^\\(?:alpha|beta|gamma|delta|epsilon|lambda|mid|le|ge|in|notin|subset|supset)\b/u.test(match.slice(1))) return match;
    return `${left} ∖ ${right}`;
  });
}

function residualAuthoredBackslash(value) {
  return normalizeAuthoredDisplayProse(value).includes("\\");
}

function authoredEnglish(value) {
  return normalizeAuthoredDisplayProse(meaningfulText(cleanText(value)
    .replace(/[（(][^()（）]*[\p{Script=Han}][^()（）]*[)）]/gu, "")
    .replace(/\p{Script=Han}+/gu, "")
    .replace(/\s+/g, " ")
    .trim()));
}

function truncateWords(value, limit = 52) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length <= limit) return words.join(" ");
  return `${words.slice(0, limit).join(" ").replace(/[,:;]$/, "")}.`;
}

function sentenceList(value) {
  const normalized = cleanText(value)
    .replace(/([\p{L}])-\s+(?=[\p{Ll}])/gu, "$1")
    .replace(/\s+/g, " ");
  if (!normalized) return [];
  return normalized.split(/(?<=[.!?])\s+(?=(?:[A-Z0-9]|i\.e\.,))/).map((sentence) => cleanText(sentence)).filter((sentence) => sentence.length >= 20);
}

function hasExtractionNoise(value) {
  // Provenance quotes remain byte-literal even when PDF extraction leaves an
  // orphan script marker. Authored/display candidates must never inherit it.
  return hasSourceTextNoise(value) || hasOrphanMathScriptMarker(value);
}

function readableProse(value) {
  const text = cleanText(value);
  if (!text || hasExtractionNoise(value) || residualAuthoredBackslash(text)
      || isBoilerplate(text) || isCaption(text) || isCitation(text) || isTableRow(value)) return false;
  const words = text.match(/[\p{L}][\p{L}'’\-]{2,}/gu) || [];
  const symbols = text.match(/[=≤≥∑∫√]/g) || [];
  return words.length >= 5 && symbols.length <= Math.max(2, Math.floor(words.length / 4));
}

function organizationProse(value) {
  const text = cleanText(value);
  return isPaperOrganizationProse(text)
    || /^(?:the remainder of (?:this|the) paper|the rest of (?:this|the) paper|this paper is organized|the paper proceeds|in the next (?:sub)?section|the following (?:sub)?section|section \d+ (?:presents|describes|discusses)|we organize|we conclude)/i.test(text)
    || /^in\s+this\s+section,?\s+(?:we|the\s+(?:paper|analysis))\s+(?:first\s+|next\s+|also\s+)?(?:review|consider|discuss|describe|present|examine|analy[sz]e|construct|formulate|develop|derive)\b/i.test(text)
    || /^(?:(?:first|second|third|fourth|fifth|finally|then),?\s+)?(?:in\s+)?(?:sub)?section\s+\d+(?:\.\d+)*\b.{0,90}\b(?:introduces?|incorporates?|considers?|reviews?|discusses?|examines?|presents?|reports?|extends?|shows?)\b/i.test(text)
    || /^(?:(?:first|second|third|fourth|fifth|finally|then),?\s+)?(?:in\s+)?(?:sub)?section\s+\d+(?:\.\d+)*\b.{0,90}\b(?:summari[sz]es?|describes?)\b/i.test(text)
    || /^(?:next|finally|then),?\s+we\s+(?:conduct|present|discuss|examine|report|turn\s+to)\b.*\b(?:next|following)\s+section\b/i.test(text)
    || /^we\s+next\s+(?:present|introduce|turn\s+to|discuss|explain|analy[sz]e|examine)\b/i.test(text)
    || /^(?:next|then|finally),?\s+we\s+(?:analy[sz]e|examine|discuss|report|turn\s+to)\b/i.test(text)
    || /^(?:detailed\s+)?(?:analysis|discussion|proofs?)\b.{0,80}\b(?:is|are)\s+provided\s+in\s+(?:section|appendix)\b/i.test(text)
    || /^(?:now,?\s+)?in\s+(?:sub)?section\s+\d+(?:\.\d+)*,?\s+we\s+(?:present|discuss|examine|report|consider|analy[sz]e)\b/i.test(text)
    || /^(?:however,?\s+)?for brevity,?\s+we\s+(?:limit|restrict)\s+(?:our\s+)?discussion\b/i.test(text)
    || /\b(?:will|may|should)\s+become\s+apparent\s+in\s+the\s+(?:next|following)\s+(?:sub)?section\b/i.test(text)
    || /\b(?:is organized as follows|road map of the paper|organization of the paper|(?:remainder|rest) of (?:this|the) paper)\b/i.test(text);
}

function displayOrResultOnlyProse(value) {
  const text = cleanText(value);
  return /^(?:in|from|as\s+shown\s+in)\s+(?:figure|table|exhibit|panel)\s*[A-Z]?\d+\b/i.test(text)
    || /(?:\b(?:illustrated|shown|depicted|summarized|reported)\b.{0,90}\b(?:figure|table|exhibit)\s*\d*\b|\b(?:figure|table|exhibit)\s*\d+\b.{0,90}\b(?:illustrates|shows|depicts|summarizes|reports)\b)/i.test(text)
    || /\b(?:equations?|constraints?|formulation)\b.{0,48}\b(?:is|are)\s+(?:given|stated|presented)\s+by\s+(?:equations?|constraints?|formulation)\b/i.test(text)
    || /^(?:together,?\s+)?these\s+(?:structural\s+)?results\b/i.test(text)
    || /^(?:the\s+)?coverage rates?\b/i.test(text)
    || /^(?:our|the paper's)\s+empirical analysis confirms\b/i.test(text);
}

function backgroundOnlyProse(value) {
  const text = cleanText(value);
  return /^(?:the\s+)?(?:prior|previous|existing|extant)\s+(?:literature|research|studies|work|models?|analyses)\b/i.test(text)
    || /\b(?:the\s+)?literature\b.{0,160}\b(?:indicates?|shows?|suggests?|finds?|assumes?|ignores?|ignored|neglects?|neglected|omits?|omitted|has\s+(?:shown|found|studied))\b/i.test(text)
    || /\b(?:well[- ]known|documented|established)\b.{0,100}\bin\s+(?:the\s+)?(?:(?:[a-z-]+\s+){0,3})literature\b/i.test(text)
    || /^(?:according\s+to|as\s+(?:shown|established|documented)\s+by)\b/i.test(text)
    || /^[A-Z][\p{L}'’.-]+(?:\s+et\s+al\.)?\s*\(\d{4}[a-z]?\)\s+(?:show|find|study|consider|assume|propose)s?\b/u.test(text);
}

function resultAssertionProse(value) {
  const text = cleanText(value);
  return /^(?:the\s+)?(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)?\b/i.test(text)
    || /^(?:we|the\s+(?:paper|analysis|authors?))\s+(?:show|find|demonstrate|prove|establish|confirm)\b/i.test(text)
    || /^we\s+(?:now\s+)?obtain\s+(?:our\s+)?(?:next\s+)?(?:(?:two|three|several)\s+)?(?:corollaries|theorems|propositions|lemmas)\b/i.test(text)
    || /^(?:it|this)\s+(?:follows|shows|implies)\s+that\b/i.test(text)
    || /\b(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)\b.{0,100}\b(?:shows?|implies?|highlights?|establishes?|presents?|shifts?|follows?)\b/i.test(text)
    || /\b(?:shown|presented|stated|described|established)\s+in\s+(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)\b/i.test(text)
    || /\b(?:present|derive|report)\s+(?:it|them)?\s*in\s+(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)\b/i.test(text)
    || /\b(?:all|none)\s+of\s+(?:our|the)\s+(?:results?|insights?)\b/i.test(text)
    || /\b(?:can\s+be|is)\s+readily\s+extended\b/i.test(text)
    || /\b(?:as\s+(?:shown|proved|established)|follows\s+directly)\s+(?:in|from)\s+(?:theorem|proposition|lemma|corollary)\b/i.test(text);
}

function conditionResultOrContributionProse(value) {
  const text = cleanText(value);
  if (resultAssertionProse(text)) return true;
  // An objective defines what the model optimizes; it is not itself a premise
  // under which that component applies. Keep premise-led objective bounds but
  // never use a paper's goal merely to fill Mini's required condition slot.
  if (/^(?:our\s+(?:goal|objective)|the\s+(?:paper's|model's|planner's|firm's)?\s*objective|we\s+(?:seek|aim|want)\s+to)\b/i.test(text)
    || /^(?:the\s+)?(?:paper|model|planner|firm)\s+(?:maximi[sz]es|minimi[sz]es)\b/i.test(text)) return true;
  // Conditions describe premises, timing, domains, or feasibility. A sentence
  // that explicitly reports or points back to a result is a conclusion even
  // when mathematical notation would otherwise satisfy the condition grammar.
  if (/^in\s+the\s+(?:outcomes?|results?)\b/i.test(text)
    || /^(?:in|from)\s+(?:theorem|proposition|lemma|corollary)\s+[A-Z]?(?:\d+(?:\.\d+)*)?\b[^.!?]{0,100}\b(?:we\s+)?(?:find|show|observe|see|note|obtain|know)\b/i.test(text)
    || /^(?:according\s+to|recall(?:ing)?\s+from)\s+(?:theorem|proposition|lemma|corollary|section|equation|expression|figure|table)\b/i.test(text)
    || /^(?:we\s+(?:(?:also|further)\s+)?(?:observe|note|see)|comparing\b[^.!?]{0,120}\bwe\s+(?:find|observe|see))\b/i.test(text)
    || /\b(?:first|second|third|previous|preceding|above)\s+(?:result|statement|expression)\s+(?:shows?|implies?|establishes?|yields?)\b/i.test(text)) return true;
  if (/^(?:the\s+)?(?:upward|downward|increasing|decreasing)\s+trend\b[^.!?]{0,180}\b(?:figures?|tables?|results?|estimates?)\b/i.test(text)
    || /^(?:interestingly|notably),?\s+[^.!?]{0,180}\b(?:is|are)\s+(?:preferred|optimal|better|worse|higher|lower)\b/i.test(text)
    || /\b(?:performance|outcomes?|profits?|revenues?|welfare|results?)\b[^.!?]{0,100}\bremains?\s+unchanged\b/i.test(text)) return true;
  if (/\bour\s+(?:main\s+|qualitative\s+)?results?\b[^.!?]{0,140}\b(?:apply|extend|generalize|hold|show|suggest|indicate|confirm)\b/i.test(text)
    || /^(?:the\s+same|these|such)\s+(?:qualitative\s+)?results?\s+(?:apply|extend|generalize|hold)\b/i.test(text)
    || /^(?:our|this|the\s+paper(?:'s)?)\s+(?:analysis|contribution|framework|approach)\b[^.!?]{0,140}\b(?:contributes?|extends?|generalizes?|applies?)\b/i.test(text)) return true;
  if (/^(?:hence|therefore|thus|consequently|as\s+a\s+result)\b/i.test(text)
    || /^(?:it\s+is\s+(?:clear|immediate)|this\s+is\s+because)\b/i.test(text)) return true;
  // Comparative statics of an equilibrium or optimum are model outcomes, not
  // setup conditions. Preserve explicit premise-led conditional predicates.
  const explicitPremise = /^(?:if|when|whenever|provided\s+that|subject\s+to|under\b|given\b|suppose\b|assume\b|we\s+assume\b)/i.test(text);
  if (!explicitPremise
    && /^As\b[^.!?]{0,140}\b(?:becomes?|increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|grows?|shrinks?)\b/iu.test(text)
    && /\b(?:profit\s+margins?|profits?|revenues?|welfare|consumer\s+surplus|bankruptcy\s+risk|agency\s+cost|risk[-\s]+shifting|order\s+quantit(?:y|ies))\b[^.!?]{0,100}\b(?:increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|grows?|shrinks?|improves?|worsens?)\b/iu.test(text)) return true;
  return !explicitPremise
    && /\b(?:equilibrium|optimal)\b[^.!?]{0,140}\b(?:increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|is\s+(?:higher|lower|better|worse)|are\s+(?:higher|lower|better|worse)|improv(?:e|es|ed|ing)|worsen(?:s|ed|ing)?)\b/i.test(text);
}

export function componentSourceSentence(value, role = "") {
  const text = cleanText(value).replace(/^["'“‘(\[]+/, "");
  const proseWithoutAbbreviations = text.replace(/\b(?:e\.g|i\.e|etc|vs|et\s+al)\./giu, "ABBREVIATION");
  // A complete conditional move is substantive model evidence, even though it
  // begins with a dependent conjunction. This occurs naturally in sequential
  // games (for example, "If the license is confidential, ... then the supplier
  // decides ..."). Keep only clauses with an explicit modeled action after the
  // comma so isolated PDF fragments still fail closed.
  const explicitConditionalModelRule = /^(?:if|when)\b[^.!?]{8,220},\s+(?:then\s+)?(?:the|a|an)\b[^.!?]{0,220}\b(?:decides?|chooses?|sets?|selects?|allocates?|assigns?|offers?|prices?)\b/i.test(text);
  const dependentLead = /^(?:at|in|on|of|the|and|or|until|with|from|for|to|by|which|where|when|while|because|if)\b/u.test(text)
    && !explicitConditionalModelRule
    && !(role === "constraint" && /^in\s+this\s+structure\b/i.test(text));
  if (/^\p{Ll}{3}/u.test(text)
    || /^(?:hence|therefore|thus|consequently|as\s+a\s+result)\b/i.test(text)
    || dependentLead
    // A clause ending after the antecedent of "that is, if ..." is a
    // display-adjacent extraction prefix, not a complete model rule. The
    // consequent commonly appears after an intervening demand equation.
    || /\b(?:that\s+is|i\.e\.),?\s+if\b[^.!?]{8,260}$/iu.test(text)
    || /\b(?:that\s+is|i\.e\.)\s*$/iu.test(text)
    // A clipped literature-attribution prefix can precede the paper's actual
    // demand equation. It identifies a standard family but does not state the
    // local consumer behavior needed for a component-level explanation.
    || /^we\s+use\s+the\s+standard\b[^.!?]{0,180}\bmodel\b[^.!?]{0,180}\((?:e\.g\.,?\s*)?[^)]*\b(?:19|20)\d{2}\)\s*$/iu.test(text)
    // Sentence recovery must not join a table note to the lowercase tail of
    // another sentence. This exact corruption produced `... parameters.
    // proposed methods ...` and then masqueraded as an estimation component.
    || /[.!?]\s+\p{Ll}{3}/u.test(proseWithoutAbbreviations)
    || (organizationProse(text) && !explicitLocalVariantCondition(text))
    || backgroundOnlyProse(text)
    || displayOrResultOnlyProse(text)) return false;
  // Embedded links and malformed inline math are usually footnotes, adjacent
  // display rows, or broken PDF columns rather than a component-level source
  // sentence. Preserve them in the extraction artifact, but do not promote
  // them into authored explanations or verbal rules.
  if (/\b(?:https?:\/\/|www\.)/i.test(text)
    || formalStructureIssue(text, "Atlas restatement of source rule")) return false;
  const numberedAlgorithmSteps = text.match(/(?:^|\s)\d+\s*:\s*/gu) || [];
  if (/^\d+\s*:\s*(?:end|return|while|for|if|sample|set|input|initialize|update)\b/iu.test(text)
    || numberedAlgorithmSteps.length >= 2) return false;
  if (/^(?:the\s+)?proof\b|\bproof of (?:this|the)\s+(?:theorem|lemma|proposition|corollary)\b|\bcompletes?\s+the\s+proof\b/i.test(text)) return false;
  if (/\b(?:model|formulation|program)\s+(?:yields?|has)\s+(?:the\s+)?(?:same\s+)?optimal\s+objective\s+value\b/i.test(text)) return false;
  if (/^(?:similarly|likewise),?\s+(?:as\s+)?the\s+objective\s+function\b[^.!?]{0,120}\b(?:issue|problem|difficulty)\b/i.test(text)) return false;
  // A proposition part that begins after terminal punctuation is a second
  // sentence fused by PDF extraction, not one auditable component quote.
  if (/[.!?]\s+\((?:i{1,4}|v|vi|[a-z])\)\s+(?=[A-Z])/i.test(text)) return false;
  if (/\b(?:presented|shown|given|stated|reported)\s+(?:below|above|next)\b/i.test(text)) return false;
  const relationOperators = text.match(/[=≤≥∈∑∫]/gu) || [];
  if (/^(?:that\s+is|i\.e\.|where|let)\s*:/i.test(text) && relationOperators.length) return false;
  if (relationOperators.length >= 3) return false;
  const substantiveDecisionResult = role === "decision"
    && /\b(?:set(?:s|ting)?|choos(?:e|es|ing)|payment|price|quantity|allocation|policy|action)\b/i.test(text)
    && /\b(?:maximi[sz](?:e|es|ing)|minimi[sz](?:e|es|ing)|optimal|binding)\b/i.test(text);
  const substantiveEstimationProcedure = role === "estimation"
    && /\b(?:estimat(?:e|es|ed|ing|ion)|maximum likelihood|likelihood function|regression|inference)\b/i.test(text)
    && /\b(?:using|based on|criterion|procedure|training data|simulated data|sample)\b/i.test(text);
  if (resultAssertionProse(value) && !/^(?:objective|constraint)$/.test(role)
    && !substantiveDecisionResult && !substantiveEstimationProcedure) return false;
  return true;
}

const NONMODEL_SECTION = /\b(?:introduction|literature(?: review)?|related work|summary|motivations?|conclusions?|concluding (?:remarks?|discussions?)|further discussion|managerial (?:implications?|insights?)|acknowledg|paper overview|our contributions?|research contributions?|coverage analysis|experiment setup|computational experiments?|numerical (?:analysis|experiments?|study)|simulation (?:analysis|experiments?|study))\b/i;
const NON_COMPONENT_REFERENCE_SECTION = /^(?:notations?|notations?\s+(?:and\s+)?definitions?|definitions?\s+(?:and\s+)?notations?|list\s+of\s+(?:symbols|notations?)|symbols\s+and\s+notations?|parameters\s+and\s+decision\s+variables)$/i;

function nearPaperTitle(candidateValue, titleValue) {
  const candidate = new Set(tokens(candidateValue));
  const title = new Set(tokens(titleValue));
  if (candidate.size < 4 || title.size < 4) return false;
  const shared = [...candidate].filter((token) => title.has(token)).length;
  return shared / Math.min(candidate.size, title.size) >= 0.78;
}

function repeatedRunningHeaderSection(section, record, allSections) {
  if (!Array.isArray(allSections) || allSections.length < 3) return false;
  const title = authoredEnglish(section.title);
  const stem = normalizedSourceSection(title).replace(/\s+\d+$/, "");
  const words = stem.split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;
  const matchingPages = new Set(allSections
    .filter((candidate) => normalizedSourceSection(candidate.title).replace(/\s+\d+$/, "") === stem)
    .map((candidate) => Number(candidate.page))
    .filter(Number.isFinite));
  if (matchingPages.size < 3) return false;
  const recordTitle = authoredEnglish(record.title);
  return /:/.test(title) || nearPaperTitle(stem, recordTitle);
}

export function usableSourceSection(section, record = {}, allSections = []) {
  const lineage = [section.title, ...(section.ancestorTitles || [])].join(" ");
  if (NONMODEL_SECTION.test(lineage)) return false;
  // PDF running headers are frequently reconstructed as numbered sections
  // because the printed page number sits beside `Authors: Paper title`.  Reject
  // only a long title-like stem repeated on at least three distinct pages so a
  // legitimate repeated heading such as `Model` remains eligible.
  if (repeatedRunningHeaderSection(section, record, allSections)) return false;
  // Lowercase singleton labels without a printed section number are column or
  // table continuations in the audited corpus, not authored headings. Preserve
  // the conventional capitalized, numbered forms used by genuine sections.
  if (!authoredEnglish(section.number)
    && /^(?:model|method|equilibrium)$/u.test(authoredEnglish(section.title))) return false;
  if (!section.number && section.page <= 2) {
    const title = authoredEnglish(record.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const candidate = authoredEnglish(section.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const candidateWords = candidate.split(/\s+/u).filter(Boolean);
    const titleEdgeFragment = candidateWords.length >= 2
      && (title === candidate || title.startsWith(`${candidate} `) || title.endsWith(` ${candidate}`));
    const frontMatterBody = /\b(?:contact|received|accepted|revision|orcid|university|business\s+school|school\s+of|institute\s+of|https?:\/\/)\b/iu
      .test(authoredEnglish(section.text).slice(0, 900));
    if ((candidate.length >= 18 && (title.includes(candidate) || nearPaperTitle(candidate, title)))
      || (titleEdgeFragment && frontMatterBody)) return false;
  }
  // The cleaned body can lose every other PDF line when a column contains
  // line-end hyphenation. The heading-bounded source span is still eligible
  // when it contains coherent model prose; component authoring subsequently
  // requires an independently clean literal page quotation.
  const sourceText = section.sourceText || section.text;
  const explicitProcessSource = sentenceList(sourceText).some((sentence) =>
    PROCESS_MODELING_CONDITION.test(sentence)
      || /\bwe\s+formali[sz]e\s+the\s+diffusion\s+process\b[^.!?]{0,180}\b(?:using|through)\s+(?:a|the)\s+[^.!?]{0,80}\bframework\b/i.test(sentence));
  return Boolean(firstUsefulSentences(sourceText, 1, 36, { modelOnly: true }) || explicitProcessSource);
}

function modelBearingProse(value) {
  const text = cleanText(value);
  if (!readableProse(value) || organizationProse(text)) return false;
  return /\b(?:assume|suppose|consider|consists? of|contains?|observes?|knows?|arrives?|departs?|chooses?|decides?|sets?|selects?|allocates?|assigns?|routes?|orders?|prices?|offers?|invests?|maximi[sz]|minimi[sz]|objective|constraint|subject to|utility|payoff|profit|cost|demand|arrival|capacity|inventory|queue|state|transition|probability|distribution|policy|algorithm|heuristic|equilibrium|best response|estimate|regression|likelihood|learn|regret|theorem|proposition|mechanism|contract|bargain|screening|signal)\b/i.test(text);
}

function distinct(values, limit = Infinity) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function slug(value, fallback = "component") {
  const result = authoredEnglish(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  return result || fallback;
}

function tokens(value) {
  return authoredEnglish(value).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)?.filter((token) => !STOP_WORDS.has(token)) || [];
}

function overlapScore(left, right) {
  const wanted = new Set(tokens(left));
  if (!wanted.size) return 0;
  let score = 0;
  for (const token of tokens(right)) if (wanted.has(token)) score += token.length > 7 ? 2 : 1;
  return score;
}

function sourceSemanticTokens(value) {
  return authoredEnglish(value).toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length >= 3 && !SOURCE_STOP_WORDS.has(token))
    .map((token) => /^vaccin(?:e|es|ation|ations)$/u.test(token)
      ? "vaccin"
      : /^(?:allocat\w*|assign\w*)$/u.test(token)
        ? "alloc"
        : /^(?:bid|bids|bidding|bidder|bidders|bidd)$/u.test(token)
          ? "bid"
          : /^auctioneers?$/u.test(token)
            ? "auction"
      : token.length > 6
        ? token.replace(/(?:ies|ing|ed|es|s)$/, (suffix) => suffix === "ies" ? "y" : "")
        : token.length > 4 ? token.replace(/s$/, "") : token) || [];
}

function hasSourceOverlap(left, right) {
  const wanted = new Set(sourceSemanticTokens(left));
  return sourceSemanticTokens(right).some((token) => wanted.has(token));
}

export function firstUsefulSentences(value, count = 2, wordLimit = 64, options = {}) {
  const candidates = sentenceList(value)
    .filter(readableProse)
    .filter((sentence) => !organizationProse(sentence))
    .filter((sentence) => !displayOrResultOnlyProse(sentence))
    .filter((sentence) => !options.modelOnly || modelBearingProse(sentence))
    .filter((sentence) => !/^(copyright|downloaded|this article was|accepted by|supplemental material)/i.test(sentence))
    .filter((sentence) => !/^(throughout this paper,? we let|for any [a-z] |we denote [A-Za-z]\b)/i.test(sentence))
    .filter((sentence) => !/\b(?:[A-Za-z]\s){5,}[A-Za-z]\b/.test(sentence))
    .filter((sentence) => sentence.split(/\s+/).length <= 90)
    .map(rewriteSourceVoice);
  const selected = [];
  let usedWords = 0;
  for (const sentence of candidates) {
    const sentenceWords = sentence.split(/\s+/).filter(Boolean).length;
    // Preserve sentence boundaries. Hard clipping a valid long sentence can
    // create dangling parentheses, extraction fragments, or a false claim.
    if (!selected.length && sentenceWords > wordLimit) {
      selected.push(sentence);
      break;
    }
    if (usedWords + sentenceWords > wordLimit) continue;
    selected.push(sentence);
    usedWords += sentenceWords;
    if (selected.length >= count) break;
  }
  return selected.join(" ");
}

function completeAuthoredSummary(value, count = 4, wordLimit = 180) {
  const full = authoredEnglish(value);
  if (!full) return "";
  const complete = firstUsefulSentences(full, count, wordLimit);
  if (complete) return complete;
  return !hasExtractionNoise(full) && !organizationProse(full) && readableProse(full) ? full : "";
}

function withoutRecordFieldLabels(value) {
  return String(value || "").replace(
    /(^|[.!?]\s+)(?:problem\s+definition|academic\s*\/\s*practical\s+relevance|methodology(?:\s*\/\s*results)?|results?|managerial\s+implications)\s*:\s*/gi,
    "$1"
  );
}

function rewriteSourceVoice(value) {
  const rewritten = cleanText(value)
    // A discourse contrast has no antecedent when the sentence is lifted into
    // a standalone component explanation. Drop only the leading connector;
    // the literal source quote remains unchanged in provenance.
    .replace(/^however,\s+/i, "")
    .replace(/^we\s+study\b/i, "This paper studies")
    .replace(/^we\s+address\b/i, "The paper addresses")
    .replace(/^we\s+consider\b/i, "The model considers")
    .replace(/^we\s+construct\b/i, "The paper constructs")
    .replace(/^we\s+develop\b/i, "The paper develops")
    .replace(/^we\s+propose\b/i, "The paper proposes")
    .replace(/^we\s+formulate\b/i, "The paper formulates")
    .replace(/^we\s+analy[sz]e\b/i, "The paper analyzes")
    .replace(/^we\s+examine\b/i, "The paper examines")
    .replace(/^we\s+show\b/i, "The paper shows")
    .replace(/^we\s+prove\b/i, "The paper proves")
    .replace(/^we\s+derive\b/i, "The paper derives")
    .replace(/^we\s+find\b/i, "The paper finds")
    .replace(/^we\s+start\b/i, "The analysis starts")
    .replace(/^we\s+first\s+derive\b/i, "The analysis first derives")
    .replace(/^we\s+denote\b/i, "The model denotes")
    .replace(/^we\s+can\s+show\b/i, "The analysis shows")
    .replace(/^our\s+model\b/i, "The model")
    .replace(/^our\s+objective\b/i, "The model's objective")
    .replace(/^our\s+analysis\b/i, "The paper's analysis")
    .replace(/^our\s+/i, "The paper's ");
  const voiced = /^[a-z]/.test(rewritten) ? `${rewritten[0].toUpperCase()}${rewritten.slice(1)}` : rewritten;
  return normalizeAuthoredDisplayProse(voiced);
}

function cleanHeadingTitle(value) {
  let title = cleanText(value).replace(/\s+[·•]\s+.*$/, "");
  title = title.split(/(?:[.:]\s+|\s+)(?=(?:Now,?|Next,?|We\s+(?:model|consider|study|analy[sz]e|derive|show)|Our\s+(?:model|analysis)|The\s+(?:paper|model|analysis)|This\s+(?:section|model|paper|study)|In\s+this\s+(?:section|model|study)|Similarly\s+to|Suppose\s+that|Consider\s+|Let\s+)\b)/i)[0];
  return cleanText(title).replace(/[.:]+$/, "");
}

function titleContinuationNeeded(title) {
  return /-$|\b(?:and|or|of|for|with|from|to|the|a|an|in|on|under|versus|vs|first|second|third)\s*$/i.test(title);
}

function looksLikeHeadingContinuation(value) {
  const text = cleanText(value);
  if (!text || text.length > 105 || /[.!?;:]$/.test(text) || hasExtractionNoise(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 13) return false;
  const titleWords = words.filter((word) => /^(?:[A-Z][\p{L}'’\-]*|and|or|of|for|with|from|to|the|a|an|in|on|under|vs\.?|[A-Z]{2,})$/u.test(word));
  return titleWords.length / words.length >= 0.72;
}

function splitHeadingContinuation(title, value) {
  const text = cleanText(value);
  const marker = text.search(/\s+(?=(?:Now,?|Next,?|We\s+|Our\s+|The\s+(?:paper|model|analysis)|This\s+(?:section|model|paper|study)|In\s+this\s+(?:section|model|study)|Similarly\s+to|Suppose\s+that|Consider\s+|Let\s+)\b)/i);
  let titlePart = marker > 0 ? text.slice(0, marker) : text;
  let remainder = marker > 0 ? text.slice(marker + 1) : "";
  const sentenceBreak = titlePart.indexOf(". ");
  if (sentenceBreak > 0) {
    remainder = `${titlePart.slice(sentenceBreak + 2)} ${remainder}`.trim();
    titlePart = titlePart.slice(0, sentenceBreak);
  }
  if (!title.endsWith("-") && !looksLikeHeadingContinuation(titlePart)) return null;
  if (titlePart.split(/\s+/).length > 12) return null;
  return { titlePart, remainder };
}

function headingFromLine(line) {
  const value = cleanText(line);
  if (value.length < 4 || value.length > 150) return null;
  if (/^(?:references|bibliography|acknowledg(?:e)?ments?|online appendix|appendix)$/i.test(value)) return { number: "", title: value, excluded: true };
  let match = value.match(/^((?:\d+(?:\.\d+){0,4}|[A-Z](?:\.\d+){0,3}))[.)]\s+(.{3,130})$/);
  if (match) {
    const title = cleanHeadingTitle(match[2]);
    if (!/^[A-Z0-9]/.test(title) || /^(?:where|when|because|although|therefore|hence)\b/i.test(title)) return null;
    return { number: match[1], title, excluded: false };
  }
  if (/^(model|model formulation|problem formulation|problem setting|system model|methodology|methods?|algorithm|solution approach|estimation|theoretical model|analytical model|framework|experimental design|empirical strategy)$/i.test(value)) {
    return { number: "", title: value, excluded: false };
  }
  if (/^Algorithm\s+[A-Z]?\d+(?:\s*\([^)]{1,70}\)|\s*:?)$/i.test(value)) return { number: "", title: cleanHeadingTitle(value), excluded: false };
  return null;
}

function sectionScore(section) {
  const heading = section.title;
  const body = section.text.slice(0, 2500);
  let score = 0;
  if (/\b(model|formulation|problem setting|system|framework|setup)\b/i.test(heading)) score += 12;
  if (/\b(objective|decision|state|constraint|utility|demand|timing|information)\b/i.test(heading)) score += 11;
  if (/\b(algorithm|policy|learning|estimation|method|equilibrium|mechanism|optimization)\b/i.test(heading)) score += 10;
  if (/\b(application|benchmark|extension|scenario)\b/i.test(heading)) score += 7;
  if (/\b(model|decision|objective|constraint|state|algorithm|equilibrium|estimate|stochastic|utility)\b/i.test(body)) score += 4;
  if (/\b(introduction|literature|background|conclusion|discussion|references|appendix|proofs?)\b/i.test(heading)) score -= 18;
  if (/\b(numerical|experiment|results?|case study|data description)\b/i.test(heading)) score -= 6;
  if (section.text.length < 90) score -= 5;
  return score;
}

export function extractSections(pages) {
  return extractCleanSections(pages).map((section) => ({ ...section, score: sectionScore(section) }));
}

const INLINE_NUMBERED_HEADING = /\b([1-9]\d{0,2}(?:\.\d+){0,4})[.)]?\s+([A-Z][\p{L}\p{N}'’&(),:\-–—/ ]{3,110}?)(?=\s+(?:Although|As|Building|Consider|During|First|Given|Here|In|Next|Our|Suppose|The|This|To|Under|We|With|Figure|Table)\b|\s{2,}|$)/gu;
const SAFE_MODE_SETUP_HEADING = /\b(?:model(?:ing)?|problem\s+(?:definition|formulation|setting)|formulation|system\s+(?:model|setting)|decision\s+(?:model|problem)|information\s+structure|market\s+setting|game\s+structure|framework|setup|overview|method|algorithm|optimization|constraint|fine[-\s]?tun|preference\s+pair)\b/i;
const SAFE_MODE_STRUCTURAL_SETUP_HEADING = /^(?:retailers?|consumers?|consumer\s+utility|brand\s+position\s+formation|notations?(?:\s+and\s+preliminaries)?|preliminaries|sequence\s+of\s+events|timing|full[-\s]+information\s+benchmark|local\s+monopolist\b.*|the\s+markov\s+chain\s+model\b.*|first\s+price\s+pacing\s+equilibria|pacing\s+equilibria\b.*|action\s+[A-Z]|strategies\s+and\s+equilibrium\s+concepts|policy\s+optimization\b.*|distributionally\s+robust\s+formulation|service\s+clustering\b.*|activity\s+(?:selection|sequencing)\b.*)$/i;
const SAFE_MODE_SECTION_EXCLUSION = /\b(?:ablation|analysis|appendix|bibliography|case\s+study|conclusion|contribution|dataset|discussion|empirical|evaluation|experiment|figure|hardness|human\s+evaluation|literature|notice|organization|outline|proof|references?|results?|robustness|simulation|survey|table|technical\s+lemm?as?|response\s+generated|generated\s+(?:managerial\s+)?response|benchmark\s+methods?)\b/i;
const SAFE_MODE_COMPONENT_HEADING_EXCLUSION = /^(?:analysis|technical\s+lemm?as?|(?:empirical|estimation|numerical|simulation)?\s*results?|proofs?|robustness(?:\s+checks?)?|case\s+stud(?:y|ies)|discussion|survey|organization|outline|overview(?:\s+of\b.*)?|notations?(?:\s+and\s+preliminaries)?|preliminaries|applications?|comparative\s+statics\b.*|operationalizing\b.*|challenges?\s+in\s+extensions?\b.*|(?:some|oracle|performance)\s+benchmarks?|(?:fixed|data[-\s]?driven)\s+anchors?\s+and\s+strongly[-\s]?convex\s+optimization\s+problems?|revenue\s+and\s+(?:social\s+)?welfare|heterogeneous\s+memory\s+decay\s+and\s+optimality\b.*|nonmonotone\s+change\s+in\s+the\s+optimal\b.*|model\s+shapley|bi|demand\s+pj)$/i;
const SAFE_MODE_AUTHOR_YEAR_HEADING = /^(?:(?:\d+(?:\.\d+)*[.)]?\s+)?[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+|\s*,\s*[A-Z][\p{L}'’.-]+|\s+(?:and|&)\s+[A-Z][\p{L}'’.-]+|\s+et\s+al\.){0,5}\s*\(\d{4}[a-z]?\))/u;

function safeModeSetupSection(section) {
  const lineage = [section?.title, ...(section?.ancestorTitles || [])].map(authoredEnglish).join(" ");
  return (SAFE_MODE_SETUP_HEADING.test(lineage)
      || SAFE_MODE_STRUCTURAL_SETUP_HEADING.test(authoredEnglish(section?.title)))
    && !SAFE_MODE_SECTION_EXCLUSION.test(lineage)
    && !SAFE_MODE_AUTHOR_YEAR_HEADING.test(authoredEnglish(section?.title))
    && !sourceHeadingRejectionReason(authoredEnglish(section?.title));
}

function safeModeAuthoredSection(section) {
  const lineage = [section?.title, ...(section?.ancestorTitles || [])].map(authoredEnglish).join(" ");
  const text = authoredEnglish(section?.sourceText || section?.text);
  const hasCleanStructuralProse = safeModeSetupSection(section)
    && sentenceList(text).some((sentence) => safeModeSetupValue(sentence)
      && readableProse(sentence)
      && !isTableRow(sentence)
      && !isCaption(sentence)
      && !isCitation(sentence)
      && !organizationProse(sentence)
      && modelBearingProse(sentence));
  return Boolean(text) && !SAFE_MODE_SECTION_EXCLUSION.test(lineage)
    && !SAFE_MODE_AUTHOR_YEAR_HEADING.test(authoredEnglish(section?.title))
    && (hasCleanStructuralProse
      || /\b(?:we\s+(?:apply|build|compute|construct|develop|design|formulate|give|introduce|model|present|propose|select|use)|our\s+(?:algorithm|approach|framework|method|model|objective|policy|procedure|solution|study)|objective\s+of\s+(?:our|this)\s+study|this\s+(?:paper|study)\s+(?:develops?|models?|proposes?))\b/iu.test(text));
}

function safeModeLiteralProse(value, rawPage = "") {
  const text = authoredEnglish(value);
  if (!text || hasExtractionNoise(text) || hasMathematicalExtractionNoise(text)) return false;
  if (/[�￿⇤⌘↵♣⊎⇐⇒]|(?:^|\s)!(?:\s|$|[<>=])|(?:[A-Za-zΑ-Ωα-ω]\s+){4,}[A-Za-zΑ-Ωα-ω](?:\s|$)/u.test(text)) return false;
  if (/[=<>≤≥∑∏∫{}]|\b(?:arg\s*(?:min|max)|exp|log)\s*\(/iu.test(text)) return false;
  if (/\b(?:figure|table)\s+[A-Z]?\d|(?:x|y)[- ]axis|column\s+(?:header|row)|shaded\s+(?:area|region)\b/iu.test(text)) return false;
  if (/\b(?:in\s+this\s+experiment|we\s+simulate|computational\s+experiment|empirical\s+investigation|consumer\s+survey|proof\s+of|we\s+(?:now\s+)?prove|(?:the\s+following\s+)?(?:theorem|proposition|lemma|corollary)\s+[A-Z]?\d+|we\s+(?:find|found|observe|show|showed|establish|established|demonstrate|demonstrated)\b|results?\s+(?:show|continue\s+to\s+hold)|equilibrium\s+exists?\b|approximation\s+ratio|APX[-\s]?hard|cdf\b|x[-\s]?axes?)\b/iu.test(text)) return false;
  if (/\b[A-Z][\p{L}'’\-]+(?:\s+(?:and|&)\s+[A-Z][\p{L}'’\-]+|\s+et\s+al\.)?\s*\(\d{4}[a-z]?\)\s+(?:proves?|shows?|finds?|develops?|considers?)\b/iu.test(text)) return false;
  if (/\b[\p{L}]{2,}-\s+[\p{Ll}]{3,}\b/u.test(text)) return false;
  if (rawPage && formulaContaminatedProse(text, rawPage, { conservative: true })) return false;
  return readableProse(text) && !isTableRow(text) && !isCaption(text) && !isCitation(text)
    && !organizationProse(text) && !displayOrResultOnlyProse(text);
}

function safeModeBackMatterOrCaptionSection(section, pages) {
  const page = pages.find((candidate) => Number(candidate?.page) === Number(section?.page));
  const raw = String(page?.text || "");
  const title = authoredEnglish(section?.title);
  if (!raw || !title) return false;
  const normalizedRaw = raw.normalize("NFKC");
  const normalizedTitle = title.normalize("NFKC");
  const titleIndex = normalizedRaw.indexOf(normalizedTitle);
  if (titleIndex < 0) return false;
  const prefix = normalizedRaw.slice(0, titleIndex);
  // Table and figure captions frequently have title-case prose on the next
  // physical line. Such captions are not authored model sections.
  if (/(?:^|\n)\s*(?:Table|Figure|Exhibit)\s+[A-Z]?\d+(?:\.\d+)?\s*\r?\n\s*$/iu.test(prefix.slice(-120))) return true;
  // Numbered endnotes can otherwise look exactly like top-level numbered
  // headings. Once a terminal back-matter marker has occurred on the page,
  // nothing after it is eligible for safe-mode model authoring.
  const terminal = [...prefix.matchAll(/(?:^|\n)\s*(?:Endnotes?|References?|Bibliography|Acknowledg(?:e)?ments?|Supplemental\s+Material)\s*(?=\r?\n|$)/giu)].at(-1);
  return Boolean(terminal);
}

function safeModeSetupValue(value) {
  const text = authoredEnglish(value);
  return Boolean(text) && !hasExtractionNoise(text) && !hasMathematicalExtractionNoise(text)
    && !/[�￿⇤⌘↵♣⊎⇐⇒]|(?:^|\s)!(?:\s|$|[<>=])|[=<>≤≥∑∏∫{}]/u.test(text)
    && !/(?:\p{L}[àá]\d+\p{L}\d+)|[⇧„]|\bÑ\b/iu.test(text)
    && !/\b(?:everything\s+at\s+no\s+cost|time\s+threshold\s+of|figure|table)\s*[A-Z]?\d*\b|^(?:figure|table|editor|output)$/iu.test(text);
}

function safeModeSetupQuote(value, rawPage = "") {
  const text = authoredEnglish(value);
  return safeModeSetupValue(text)
    && (!rawPage || isWhitespaceNormalizedSubstring(text, rawPage))
    && !isTableRow(text) && !isCaption(text) && !isCitation(text)
    && !organizationProse(text)
    && !/\b(?:in\s+this\s+experiment|time\s+threshold\s+of|we\s+simulate|computational\s+experiment|consumer\s+survey|proof\s+of|we\s+(?:now\s+)?prove|(?:theorem|proposition|lemma|corollary)\s+[A-Z]?\d+|we\s+(?:find|found|observe|show|showed|establish|established|demonstrate|demonstrated)\b|results?\s+(?:show|continue\s+to\s+hold)|equilibrium\s+exists?\b)\b/iu.test(text)
    && !/\b[A-Z][\p{L}'’\-]+(?:\s+(?:and|&)\s+[A-Z][\p{L}'’\-]+|\s+et\s+al\.)?\s*\(\d{4}[a-z]?\)\s+(?:proves?|shows?|finds?|develops?|considers?)\b/iu.test(text)
    && !/\b[\p{L}]{2,}-\s+[\p{Ll}]{3,}\b/u.test(text)
    && (!rawPage || !formulaContaminatedProse(text, rawPage, { conservative: true }));
}

function enforceSafeModeSetup(setup, pages) {
  const output = structuredClone(setup);
  for (const field of SETUP_FIELDS) {
    const retained = (output.setupEvidence?.[field] || []).filter((entry) => {
      const source = entry?.source || {};
      const page = pages.find((candidate) => Number(candidate?.page) === Number(source.page));
      return source.type === "section"
        && safeModeSetupSection({ title: source.section })
        && safeModeSetupValue(entry?.value)
        && safeModeSetupQuote(source.quote, page?.text || "");
    });
    output.setupEvidence[field] = retained;
    output[field] = retained.map((entry) => entry.value);
    output.setupMaturity[field] = retained.length ? "source-derived" : "unresolved";
  }
  return output;
}

/**
 * Some warning-bearing PDFs flatten a numbered heading into the middle of a
 * page paragraph. Recover only unambiguous multi-level headings, and only when
 * the normal section parser found no usable numbered hierarchy. Every retained
 * body span remains a literal substring of its original page.
 */
export function recoverInlineNumberedSections(pages, parsedSections) {
  const numbered = parsedSections.filter((section) => /^\d+(?:\.\d+)+$/u.test(authoredEnglish(section?.number)));
  const parsedTopLevels = new Set(parsedSections
    .map((section) => authoredEnglish(section?.number).match(/^\d+/u)?.[0])
    .filter(Boolean));
  const recoverWholeHierarchy = numbered.length < 2;
  const matches = [];
  for (const page of pages) {
    const raw = String(page?.text || "");
    for (const match of raw.matchAll(INLINE_NUMBERED_HEADING)) {
      const prefix = raw.slice(Math.max(0, match.index - 24), match.index).toLocaleLowerCase();
      const prefixRejected = /\b(?:appendix|figure|section|sections|table|see|cf)\s*$/u.test(prefix);
      const number = authoredEnglish(match[1]);
      if (!recoverWholeHierarchy && parsedTopLevels.has(number.split(".")[0])) continue;
      const title = authoredEnglish(match[2]).replace(/[.:;,]+$/u, "");
      const titleRejected = !title || headingLabelRejectionReason(title) || SAFE_MODE_SECTION_EXCLUSION.test(title);
      if (prefixRejected || !title) continue;
      matches.push({ page: Number(page.page), number, title, start: match.index, bodyStart: match.index + match[0].length, emit: !titleRejected });
    }
  }
  if (!matches.length) return [];
  const byPage = new Map(pages.map((page) => [Number(page.page), String(page?.text || "")]));
  const parsedTopLevelBoundaries = parsedSections
    .filter((section) => /^\d+$/u.test(authoredEnglish(section?.number)))
    .sort((left, right) => Number(left.page) - Number(right.page));
  return matches.flatMap((heading, index) => {
    const next = matches[index + 1];
    if (!heading.emit) return [];
    const nextParsed = parsedTopLevelBoundaries.find((section) => Number(section.page) > heading.page);
    const recoveredBoundaryPage = next?.page || Number.POSITIVE_INFINITY;
    const parsedBoundaryPage = Number(nextParsed?.page) || Number.POSITIVE_INFINITY;
    const boundaryPage = Math.min(recoveredBoundaryPage, parsedBoundaryPage);
    const endPage = Number.isFinite(boundaryPage)
      ? (boundaryPage === recoveredBoundaryPage ? boundaryPage : Math.max(heading.page, boundaryPage - 1))
      : heading.page;
    const sourceLines = [];
    for (let pageNumber = heading.page; pageNumber <= endPage; pageNumber += 1) {
      const raw = byPage.get(pageNumber) || "";
      const start = pageNumber === heading.page ? heading.bodyStart : 0;
      const end = next && boundaryPage === recoveredBoundaryPage && pageNumber === next.page ? next.start : raw.length;
      const text = raw.slice(start, end).trim();
      if (text) sourceLines.push({ page: pageNumber, text });
    }
    const sourceText = sourceLines.map((line) => line.text).join(" ");
    const explicitModelingSpan = safeModeSetupSection({ title: heading.title })
      || /\b(?:we\s+(?:construct|develop|design|formulate|introduce|model|propose)|algorithm|constraint|decision|fine[-\s]?tun|framework|learning|method|model|optimization|policy|preference|procedure|system)\b/iu.test(`${heading.title} ${sourceText}`);
    if (sourceText.length < 80 || (!modelBearingProse(sourceText) && !explicitModelingSpan)) return [];
    const section = {
      number: heading.number,
      title: heading.title,
      page: heading.page,
      endPage: sourceLines.at(-1)?.page || heading.page,
      lines: sourceLines,
      text: sourceText,
      sourceLines,
      sourceText,
      synthetic: false,
      ancestorTitles: []
    };
    return [{ ...section, score: sectionScore(section) }];
  });
}

function fallbackSections(pages, record) {
  return selectModelSections(pages, record, { maxSections: 4, minSections: 3 })
    .filter((section) => section.synthetic || section.fallback);
}

function chooseSections(pages, record, maximum = 5) {
  const ranked = selectModelSections(pages, record, { maxSections: maximum, minSections: Math.min(3, maximum) });
  const preferred = ranked.filter((section) => !/\b(?:introduction|literature review|related work|conclusion|concluding remarks|paper organization)\b/i.test(section.title));
  const selected = [...preferred];
  for (const section of ranked) {
    if (selected.length >= Math.min(3, maximum)) break;
    if (!selected.includes(section)) selected.push(section);
  }
  return selected.slice(0, maximum).sort((left, right) => left.page - right.page || right.score - left.score);
}

function pageQuote(pageText, focus = "", options = {}) {
  // Keep public/source audit excerpts literal. The selector rejects captions,
  // citation rows, extraction corruption, and zero-overlap page fallbacks.
  const sentence = selectLiteralSourceSentence(pageText, focus, {
    minWords: 6,
    maxWords: 84,
    accept: (candidate) => componentSourceSentence(candidate, options.componentRole)
      && !formulaContaminatedProse(candidate, pageText)
  });
  if (!sentence) return "";
  // Preserve the complete literal sentence. Mid-sentence clipping can create
  // dangling delimiters and turns an evidence anchor into an ambiguous shard.
  return readableProse(sentence) ? sentence : "";
}

function findBestPage(pages, focus, preferredPage = 0) {
  const candidates = pages.filter((page) => cleanText(page.text).length > 40);
  const ranked = candidates.map((page) => ({
    page,
    score: overlapScore(focus, page.text) + (page.page === preferredPage ? 5 : 0) - (page.page === 1 ? 1 : 0)
  })).sort((left, right) => right.score - left.score || left.page.page - right.page.page);
  return ranked[0]?.page || pages[0] || { page: 1, text: "" };
}

function cleanFormula(value) {
  return canonicalizeMathNotation(cleanText(value)
    .replace(/\/equals/g, "=")
    .replace(/\/summationdisplay/g, "Σ")
    .replace(/\/radicaltpext(?:\/radicaltpext)*/g, "√")
    .replace(/:::+/g, "…")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/[,;:]+$/, "")
    .slice(0, 360)
    .trim());
}

function comparableFormula(value) {
  return canonicalizeMathNotation(String(value ?? ""))
    .normalize("NFKC")
    .replace(/\/equals/gi, "=")
    .replace(/\/summationdisplay/gi, "Σ")
    .replace(/\/radicaltpext(?:\/radicaltpext)*/gi, "√")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function plausibleExtractedFormula(value) {
  const candidate = cleanFormula(value);
  if (!candidate || formalStructureIssue(candidate, "Source-extracted equation (not visually verified)")) return false;
  if (/\/[∈∉≤≥]/u.test(candidate)) return false;
  if (/^(?::=|≔|≜|[=<>≤≥≠∈∉∑∫])|(?::=|≔|≜|[=<>≤≥≠∈∉+\-*/∑∫]|\b(?:max|min|arg\s*max|arg\s*min))\s*(?:\([A-Z]?\.?\d+(?:\.\d+)?\))?\s*$/i.test(candidate)) return false;
  if (/\b(?:algorithm|constraint|constraints|figure|however|method|solution|table|theorem)\b/i.test(candidate)) return false;
  // Multiple extracted relations on one visual row are commonly adjacent table
  // cells (for example, "S = 0 S/k = 2"), not one source equation. Prefer an
  // explicit verbal restatement over presenting such a row as mathematics.
  // A compact monotone inequality such as `0 ≤ q ≤ K` is the one safe
  // exception: all three operands remain visible and both relations point in
  // the same direction.
  const relations = [...candidate.matchAll(/:=|≔|≜|<=|>=|!=|=|≤|≥|≠|∈|∉|(?<![<>])<(?![=>])|(?<![<])>(?![=])/g)];
  const delimiterDepth = new Array(candidate.length + 1).fill(0);
  let depth = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    delimiterDepth[index] = depth;
    if (/[([{]/u.test(candidate[index])) depth += 1;
    else if (/[)\]}]/u.test(candidate[index])) depth = Math.max(0, depth - 1);
  }
  const topLevelRelations = relations.filter((match) => delimiterDepth[match.index] === 0);
  if (!topLevelRelations.length && !/^(?:arg\s*max|arg\s*min|max|min)\b/i.test(candidate)) return false;
  if (topLevelRelations.length === 1 && /^(?:∈|∉)$/u.test(topLevelRelations[0][0])) {
    const membership = candidate.replace(/\s+\([A-Z]?\.?\d+(?:\.\d+)?\)\s*[,.;:]?\s*$/u, "").replace(/[.;:]\s*$/u, "");
    const parts = membership.split(/∈|∉/u);
    const right = parts[1]?.trim() || "";
    // A domain declaration is complete only when both the declared object and
    // one compact domain survive on the same physical line. Quantifier tails
    // and a second whitespace-separated expression indicate a wrapped row.
    if (parts.length !== 2 || /^(?:∀|\\forall)\b/u.test(parts[0].trim())
      || !right || /\s/u.test(right.replace(/\s*([,;])\s*/gu, "$1"))) return false;
  }
  if (topLevelRelations.length > 1) {
    const compact = candidate.replace(/\s+/g, "");
    const monotoneChain = /^(?:[^=<>≤≥≠∈∉:]+)(?:<=|≤|<)(?:[^=<>≤≥≠∈∉:]+)(?:<=|≤|<)(?:[^=<>≤≥≠∈∉:]+)(?:\s+\([A-Z]?\.?\d+(?:\.\d+)?\))?$/u.test(compact)
      || /^(?:[^=<>≤≥≠∈∉:]+)(?:>=|≥|>)(?:[^=<>≤≥≠∈∉:]+)(?:>=|≥|>)(?:[^=<>≤≥≠∈∉:]+)(?:\s+\([A-Z]?\.?\d+(?:\.\d+)?\))?$/u.test(compact);
    if (!monotoneChain || topLevelRelations.length !== 2) return false;
  }
  const longWords = (candidate.match(/[A-Za-z]{4,}/g) || [])
    .filter((word) => !NAMED_MATH_IDENTIFIERS.has(word.toLowerCase()))
    .filter((word) => !/^(?:argmax|argmin|ceil|exp|floor|log|max|min|otherwise|where)$/i.test(word));
  if (longWords.length) return false;
  const topRelation = topLevelRelations[0];
  const relation = topRelation ? [
    candidate,
    candidate.slice(0, topRelation.index).trim(),
    topRelation[0],
    candidate.slice(topRelation.index + topRelation[0].length).trim()
  ] : null;
  if (relation && (!/[\p{L}\p{N}]/u.test(relation[1]) || !/[\p{L}\p{N}]/u.test(relation[3]))) return false;
  if (relation && /^\s*[\p{L}][\p{L}\p{N}_^{}]*\s*$/u.test(relation[1])
      && /^\s*[\p{L}][\p{L}\p{N}_^{}]*\s*$/u.test(relation[3])
      && !/\(\s*[A-Z]?\.?\d+(?:\.\d+)?\s*\)\s*$/i.test(candidate)) return false;
  if (!relation && !/^(?:arg\s*max|arg\s*min|max|min)\b/i.test(candidate)) return false;
  const identifiers = candidate.match(/[\p{L}\p{N}]/gu) || [];
  return identifiers.length >= 2;
}

export function formulaFromSection(section, focus = "", preferredPage = 0) {
  // Equations are often omitted from the cleaned prose lines by design. Read
  // the exact heading-bounded source lines, then apply math-specific corruption
  // and completeness checks before retaining any one-line display.
  const sourceLines = Array.isArray(section.sourceLines) && section.sourceLines.length
    ? section.sourceLines
    : section.lines;
  const lines = (sourceLines || [])
    .map((line) => ({ raw: String(line?.text ?? ""), text: cleanText(line?.text), page: Number(line?.page) || Number(section.page) || 0 }))
    .filter((line) => line.text && (!preferredPage || line.page === Number(preferredPage)));
  const candidates = [];
  const adjacentMathContinuation = (entry) => {
    const text = cleanText(entry?.raw);
    // A terminal equation label closes its own display even when a corrupt
    // text layer has prefixed a clipped expression to that line. It must not
    // poison an otherwise complete equation on the following physical line.
    if (!text || /\(\s*[A-Z]?\.?\d+(?:\.\d+)?\s*\)\s*[,.;:]?$/u.test(text)) return false;
    if (/^\d+(?:\s*[./]\s*\d+)?\s*[.]?$/u.test(text)) return true;
    const proseWords = (text.match(/[A-Za-z]{4,}/g) || [])
      .filter((word) => !NAMED_MATH_IDENTIFIERS.has(word.toLowerCase()));
    return proseWords.length <= 1
      && /:=|≔|≜|[=≤≥≠∈∉∑∫∀]|^(?:[+−*/]|\\(?:sum|prod|int)\b)/u.test(text);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].text;
    if (!/:=|≔|≜|[=≤≥≠∈∉∑∫]|\b(?:max|min|arg\s*max|arg\s*min)\b/i.test(line)) continue;
    // A formula is retained only when it survives on one extracted line. PDF
    // line wrapping often drops summation limits or interleaves columns; joining
    // those fragments would create a plausible-looking but incomplete equation.
    for (const span of [1]) {
      const raw = lines[index].raw;
      if (hasMathematicalExtractionNoise(raw)) continue;
      const candidate = cleanFormula(raw);
      const equation = candidate.match(/\(\s*([A-Z]?\.?\d+(?:\.\d+)?)\s*\)\s*$/)?.[1]
        || line.match(/\(\s*([A-Z]?\.?\d+(?:\.\d+)?)\s*\)/)?.[1]
        || "";
      const proseWords = candidate.match(/[A-Za-z]{4,}/g)?.length || 0;
      const operatorCount = candidate.match(/:=|≔|≜|[=≤≥≠∈∉∑∫√]|\b(?:max|min|arg\s*max|arg\s*min)\b/gi)?.length || 0;
      if (candidate.length < 8 || candidate.length > 180 || proseWords > 5 || operatorCount < 1
        || adjacentMathContinuation(lines[index - 1]) || adjacentMathContinuation(lines[index + 1])
        || /^\s*(?:and|if|or)\b/i.test(raw)
        || (/\bif\b/i.test(raw) && /[,;:]\s*$/.test(raw))
        || /^(?:\([ivx]+\)){2,}/i.test(candidate)
        || !plausibleExtractedFormula(candidate) || hasExtractionNoise(candidate)
        || hasMathematicalExtractionNoise(candidate)
        || /(?:\b[A-Za-z]\s+){3,}[A-Za-z]\b/.test(candidate)
        || /^(?:the|we|our|this|for|although|because)\b/i.test(candidate)) continue;
      const score = operatorCount * 5
        + (equation ? 4 : 0)
        + Math.min(8, overlapScore(focus, `${lines[index - 1]?.text || ""} ${line} ${lines[index + 1]?.text || ""}`))
        - (span - 1) * 2;
      candidates.push({ formal: candidate, equation: equation ? `(${equation})` : "", score, index, page: lines[index].page });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.index - right.index || left.formal.length - right.formal.length);
  const selected = candidates[0];
  return selected ? { formal: selected.formal, equation: selected.equation, page: selected.page } : { formal: "", equation: "", page: 0 };
}

function fallbackFormal(role) {
  return {
    decision: "Decision rule: select the feasible action defined in this component.",
    state: "State rule: collect the decision-relevant variables defined in this component.",
    process: "Transition rule: update the modeled system using the current state and realized inputs.",
    preference: "Evaluation rule: compare choices using the payoff or utility specified in this component.",
    constraint: "Feasibility rule: retain only decisions satisfying the stated resource and system restrictions.",
    information: "Information rule: decisions use the observations available at the stated decision time.",
    interaction: "Response rule: each modeled actor responds to the actions and information specified here.",
    objective: "Optimization rule: choose feasible decisions to optimize the stated objective.",
    estimation: "Estimation rule: fit the stated model to observations under its identifying conditions.",
    algorithm: "Algorithmic rule: update from observed outcomes, then select the next feasible action."
  }[role];
}

function sourceGroundedVerbalStatement(value) {
  const statement = authoredEnglish(value);
  if (!statement) return "";

  // These rewrites are intentionally semantic and narrow. They turn an
  // explicit prose definition or comparison into ordinary English instead of
  // copying flattened PDF notation into an "Atlas restatement". Complete,
  // locally defined display equations continue through formulaFromSection.
  if (/(?:\binitiali[sz](?:e|es|ed|ing|ation)\b[\s\S]*\bstarting time|\bseed(?:s|ed|ing)?\s+the simulation\b[\s\S]*\bstarting time)\s+t\s*=\s*0\b/iu.test(statement)) {
    return "The simulation is seeded with realistic items, users, preferences, and prior ratings before the simulated interactions begin.";
  }
  if (/\bfollower(?:’s|'s) location\b[\s\S]*\bSPE\b[\s\S]*\bswitching cost satisfies\s*0\s*<\s*s\s*<\s*3\b/iu.test(statement)) {
    return "When the follower's location is fixed at one, a subgame-perfect equilibrium exists when switching cost is positive and below three.";
  }
  if (/\bsufficiently large preference shift\s*\([^)]*[=<>≤≥][^)]*\)[\s\S]*\bsocial welfare\b/iu.test(statement)) {
    return statement.replace(/\s*\([^)]*[=<>≤≥][^)]*\)/u, "");
  }
  if (/\bdenote\b[\s\S]*\bprice a monopoly would set\b[\s\S]*\barg\s*max|\bdenote\b[\s\S]*\bprice a monopoly would set\b[\s\S]*\bargmax/iu.test(statement)) {
    return "The monopoly chooses the retail price that maximizes its profit for the stated market condition and marginal cost.";
  }
  if (/\bimpression is legitimate\b[\s\S]*\bwinning advertiser\b[\s\S]*\bimpression is fraudulent\b/iu.test(statement)) {
    return "A legitimate impression gives the winning advertiser a positive payoff, whereas a fraudulent impression gives it a negative payoff.";
  }
  if (/\bcommission rate\b[\s\S]*(?:α|\\alpha|\balpha\b)[\s\S]*\bmaximi[sz](?:e|es|ing)\b[\s\S]*\bexpected profit\b/iu.test(statement)) {
    return "The extension lets the open exchange choose a commission rate between zero and one to maximize expected profit, instead of treating that rate as fixed near zero.";
  }
  if (/\bchoice function\b[\s\S]*\bdoes not depend\b[\s\S]*\bidentity of the product\b/iu.test(statement)) {
    return "For every product in every market, the choice function is invariant to product identity.";
  }
  if (/\bprice\s+[pP][a-z]{1,3}\s*∈[\s\S]*\bendogenous variable\b[\s\S]*\bcharacteristics? of the product\s+[Xx][a-z]{1,3}\s*∈[\s\S]*\bexogenous variables?\b/iu.test(statement)) {
    return "Price is endogenous, whereas all other observed product characteristics are exogenous.";
  }
  if (/\bsender wishes\b[\s\S]*\btake action G\b[\s\S]*\breceiver wishes\b[\s\S]*\bmatch the decision with the state\b/iu.test(statement)) {
    return "The sender favors one receiver action in either state, whereas the receiver favors the action that matches the realized state.";
  }
  if (/\bactions? in the training data\b[\s\S]*\bfixed underlying policy\b[\s\S]*\bprobability of selecting action\b/iu.test(statement)) {
    return "Training actions are sampled from a fixed policy known to the decision-maker, conditional on the observed context.";
  }
  if (/\blearn a good policy\b[\s\S]*\bfixed deterministic policy class\b[\s\S]*\btraining data\b/iu.test(statement)) {
    return "The learner selects a policy from a fixed deterministic policy class using already-collected training data.";
  }
  if (/\baction space\s+[A-Za-zΑ-Ωα-ω][^\s]{0,30}\s+characterizes the set of inventory positions\b[\s\S]*\bfeasible order adjustment vector\b/iu.test(statement)) {
    return "The feasible adjustment action space contains the inventory positions reachable from the current state through an admissible order adjustment.";
  }
  if (/\bq[∗*]{2}\s*i\b[\s\S]*\bis decreasing\b[\s\S]*\bregion of (?:θ|\\theta|theta)i\b/iu.test(statement)) {
    return "Under the stated hot-spot cost assumptions, the optimal quantity schedule decreases with hot-spot type within either auction region.";
  }
  if (/\bsynergy level\s+[A-Za-z]\s+is nonnegative when the marginal cost of the postmerger firm\s+[A-Za-z][A-Za-z0-9]{0,3}\s+is at least as small as\s+min\s*\{\s*[A-Za-z][A-Za-z0-9]{0,3}\s*,\s*[A-Za-z][A-Za-z0-9]{0,3}\s*\}/iu.test(statement)) {
    return "The synergy level is nonnegative when the postmerger firm's marginal cost is no greater than the smaller of the two referenced marginal costs.";
  }
  const supplierEquilibriumLabels = statement.match(
    /\b(?:we\s+denote|the model\s+denotes)\s+the equilibrium (?:where both buyers sharing a supplier by|in which both buyers share a supplier as)\s+\$?([A-Za-z])\s+and (?:one where the buyers sourcing from different suppliers by|the equilibrium in which they source from different suppliers as)\s+\$?([A-Za-z])\b/iu
  );
  if (supplierEquilibriumLabels) {
    return `The model labels the equilibrium in which both buyers share a supplier as ${supplierEquilibriumLabels[1]} and the equilibrium in which they source from different suppliers as ${supplierEquilibriumLabels[2]}.`;
  }
  return statement;
}

function canonicalizeRestatementNotation(value, symbols = []) {
  const known = new Set((symbols || []).map((entry) => cleanText(entry?.symbol)).filter(Boolean));
  let output = String(value ?? "");
  output = output.replace(/[Α-Ωα-ωϑϖϱςϕϵ][A-Za-z0-9]{1,3}/gu, (raw) => {
    const candidate = canonicalizeDeclaredSymbol(raw);
    return known.has(candidate) ? candidate : canonicalizeMathNotation(raw);
  });
  output = output.replace(/[A-Za-z][∗*]\s*[A-Za-zΑ-Ωα-ωϑϖϱςϕϵ]/gu, (raw) => {
    const candidate = canonicalizeDeclaredSymbol(raw);
    return known.has(candidate) ? candidate : raw;
  });
  output = output.replace(/\b[A-Za-z][a-z]{1,2}(?=$|[\s,.;:)])/gu, (raw) => {
    const candidate = canonicalizeDeclaredSymbol(raw);
    return known.has(candidate) ? candidate : raw;
  });
  return canonicalizeMathNotation(output);
}

function residualRestatementMath(value, symbols = []) {
  // A verbal formal is ordinary English, not a second equation-extraction
  // channel. If source notation survives the narrow, source-grounded rewrites
  // above, use the role-specific prose fallback rather than publishing a
  // function, indexed token, relation, or TeX identifier whose local meaning
  // may not have been defined by this component.
  let inspected = String(value ?? "");
  const defined = (symbols || [])
    .map((entry) => cleanText(entry?.symbol))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const symbol of defined) {
    let cursor = 0;
    let masked = "";
    while (cursor < inspected.length) {
      const offset = inspected.indexOf(symbol, cursor);
      if (offset < 0) {
        masked += inspected.slice(cursor);
        break;
      }
      const before = inspected[offset - 1] || "";
      const after = inspected[offset + symbol.length] || "";
      const leftBounded = !/[\p{L}\p{N}]/u.test(symbol[0] || "") || !/[\p{L}\p{N}]/u.test(before);
      const rightBounded = !/[\p{L}\p{N}]/u.test(symbol.at(-1) || "") || !/[\p{L}\p{N}]/u.test(after);
      masked += inspected.slice(cursor, offset);
      masked += leftBounded && rightBounded ? "DEFINED_SYMBOL" : symbol;
      cursor = offset + symbol.length;
    }
    inspected = masked;
  }
  return /DEFINED_SYMBOL\s*[_^(]|\\[A-Za-z]+|[=<>≤≥≠≈≡∈∉⊂⊃⊆⊇∑∏∫ˆ˜¯]|\p{Ll}\p{Lu}\([^)]{1,80}\)|\b[A-Za-z][A-Za-z0-9]{0,4}\s*[_^]\s*(?:\{[^}]+\}|[A-Za-z0-9*+\-]+)|\b[A-Za-z][A-Za-z0-9]{0,4}\([^)]{1,80}\)/u.test(inspected);
}

export function sourceRestatement(role, explanation, symbols = []) {
  const statement = firstUsefulSentences(explanation, 1, 90) || authoredEnglish(explanation);
  const lead = {
    decision: "Decision rule",
    state: "State definition",
    process: "Process relation",
    preference: "Evaluation relation",
    constraint: "Feasibility condition",
    information: "Information structure",
    interaction: "Strategic response",
    objective: "Objective relation",
    estimation: "Estimation relation",
    algorithm: "Algorithmic rule"
  }[role] || "Model relation";
  const verbalStatement = sourceGroundedVerbalStatement(statement);
  const candidate = canonicalizeRestatementNotation(
    verbalStatement ? `${lead}: ${verbalStatement}` : fallbackFormal(role),
    symbols
  );
  return hasSourceTextNoise(candidate)
    || formalStructureIssue(candidate, "Atlas restatement of source rule")
    || residualRestatementMath(candidate, symbols)
    ? fallbackFormal(role)
    : candidate;
}

function roleFor(title, text) {
  const heading = cleanText(title);
  // A named benchmark that removes a mechanism is a restricted formulation,
  // not an objective merely because the removed mechanism happens to be a
  // reward.  Classify the local regime change before the generic reward and
  // contract cues below so its literal restriction can ground the component.
  if (/\bbest-case\s+benchmark\b.*\bsimple\s+random\s+sampling\b/i.test(heading)) return "decision";
  if (/^(?:best-case\s+)?benchmark(?:\s+case)?\b/i.test(heading)
    || /\b(?:benchmark|model|regime)\s+without\b/i.test(heading)) return "constraint";
  if (/\bwinner\s+determination\s+problem\b/i.test(heading)) return "objective";
  if (/\b(?:one|disjoint|chained)\s+pools?\b|\bpractical\s+pool\s+structures?\b/i.test(heading)) return "constraint";
  if (/\b(?:substitute|complementary)\s+goods?\b/i.test(heading)) return "preference";
  if (/\bmultihoming\s+publishers?\b|\bendogenous\s+commission\s+rate\b/i.test(heading)) return "decision";
  if (/\binvestment\s+by\s+(?:the\s+)?competitive\s+supplier\b/i.test(heading)) return "decision";
  if (/\bfixed[-\s]+price\s+(?:scenario|case|model|formulation)\b/i.test(heading)) return "constraint";
  if (/\badjustable[-\s]+price\s+(?:scenario|case|model|formulation)\b/i.test(heading)) return "decision";
  if (/\binterplatform\b/i.test(heading)) return "interaction";
  if (/\b(?:notation\s+and\s+)?definitions?\b|\bdefining\b/i.test(heading)) return "information";
  if (/^simulat(?:e|ing|ion)\s+random[-\s]+walks?\b/i.test(heading)) return "algorithm";
  if (/^(?:designing\s+)?random[-\s]+walks?\s+on\b/i.test(heading)) return "process";
  if (/\bdiffusion\s+process(?:es)?\b/i.test(heading)) return "process";
  if (/\b(estimation|identification|likelihood|regression|empirical strategy)\b/i.test(heading)) return "estimation";
  if (/\b(?:self[ -]learning|learning by doing|experience(?: curve| effect)|cost improvement)\b/i.test(heading)) return "process";
  if (/\bclassifiers?\b/i.test(heading)) return "objective";
  if (/\b(algorithm|heuristic|solution (?:approach|method|procedure)|computational method|training procedure)\b/i.test(heading)) return "algorithm";
  if (/\b(?:optimization|optimal control)\s+(?:model|problem)\b/i.test(heading)) return "objective";
  if (/\b(linear programm?(?:ing)?|integer programm?(?:ing)?|objective|first[ -]best|performance guarantee|welfare|profit|net value|system cost|cost function|loss function|optimality bound)\b/i.test(heading)) return "objective";
  if (/\b(constraints?|feasibility|capacity restriction|budget restriction|balance equation)\b/i.test(heading)) return "constraint";
  if (/\b(state(?: space)?|system state|inventory state|queue state)\b/i.test(heading)) return "state";
  if (/\b(?:student|consumer|customer|patient|agent)s?[’']?\s+(?:optimal\s+)?(?:test[- ]taking|application|participation|adoption|purchase)\s+behavior\b/i.test(heading)
    || /\boptimal\s+(?:student|consumer|customer|patient|agent)s?[’']?\s+(?:test[- ]taking|application|participation|adoption|purchase|choice)\b/i.test(heading)) return "decision";
  if (/\b(input|parameter|primitive|information|belief|signal|observation|monitoring|unverifiable|uncertainty)\b/i.test(heading)) return "information";
  if (/\bchoice\s+of\s+(?:payment|contract)\s+structure\b/i.test(heading)) return "preference";
  if (/\b(utility|preference|consumer choice|choice models?|demand (?:model|function|system|specification)|valuation)\b/i.test(heading)) return "preference";
  if (/\b(equilibrium|competition|game|bargain|auction|mechanism|contract|strategic interaction)\b/i.test(heading)) return "interaction";
  if (/\b(decision|action|allocation|assignment|target(?:ing)?|payment terms?|effort levels?|charging rates?|pricing policy|control policy|scheduling decision)\b/i.test(heading)) return "decision";
  // A formulation heading centered on staffing names the first-stage staffing
  // decision even when its body later previews a solution algorithm. Classify
  // the formulation from that modeled choice so the local decision statement
  // is not displaced by a roadmap sentence near the end of the section.
  if (/\bstaffing\b/i.test(heading)
    && !/\b(?:solution|algorithm|method|analysis|results?)\b/i.test(heading)) return "decision";
  if (/\b(model|formulation|framework|setting|system|process(?:es)?|dynamics|output parameters?|arrival|transition)\b/i.test(heading)) return "process";
  return ROLE_RULES.find(([, pattern]) => pattern.test(text))?.[0] || "process";
}

const SYMBOL_WORD_REJECTIONS = new Set([
  "also", "and", "are", "els", "for", "from", "let", "model", "plots", "ratio", "setting", "that", "the", "then", "these", "this", "we", "where", "which", "with"
]);

function plausibleSymbol(value) {
  const symbol = cleanText(value);
  if (!symbol || symbol.length > 16 || hasExtractionNoise(symbol)) return false;
  if (/^(?:let|where|define|denote)\b/i.test(symbol)) return false;
  if (SYMBOL_WORD_REJECTIONS.has(symbol.toLowerCase())) return false;
  if (/^[a-z]{2,}$/u.test(symbol) && !(symbol.length <= 4 && !/[aeiou]/i.test(symbol))) return false;
  return /^(?:[\p{L}](?:[\p{L}\p{N}]|[_^][\p{L}\p{N}{}(),+\-*]+)*(?:\([^)]{1,12}\))?|[\p{L}](?:,[\p{L}]){1,2})$/u.test(symbol);
}

function plausibleRecordSymbol(value) {
  const raw = String(value ?? "");
  const symbol = cleanText(raw);
  // model_map notation is a reviewed catalog, not prose recovered from a PDF
  // line. Preserve source-native scripts, accents, semicolon-separated
  // arguments, Unicode relations, and named treatment labels. Only hard
  // mathematical corruption and structurally broken delimiters are grounds for
  // dropping a reviewed entry.
  if (!symbol || symbol.length > 96 || hasMathematicalExtractionNoise(raw)) return false;
  if (!/[\p{L}\p{N}\p{Sm}]/u.test(symbol)) return false;
  return !formalStructureIssue(symbol, "");
}

function containsIdentifierToken(value, token) {
  if (!token) return false;
  if (token.startsWith("\\")) return value.includes(token);
  let offset = value.indexOf(token);
  while (offset >= 0) {
    const before = value[offset - 1] || "";
    const after = value[offset + token.length] || "";
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    offset = value.indexOf(token, offset + token.length);
  }
  return false;
}

function usableSymbolMeaning(value) {
  const meaning = authoredEnglish(value);
  const meaningWords = meaning.match(/[\p{L}][\p{L}'’\-]*/gu) || [];
  if (!meaning || meaningWords.length < 2 || meaningWords.length > 24 || hasExtractionNoise(meaning)) return false;
  if (isBoilerplate(meaning) || isCaption(meaning) || isCitation(meaning) || isTableRow(meaning)
    || organizationProse(meaning) || displayOrResultOnlyProse(meaning)) return false;
  if (/\b(?:online\s+appendix|appendix|figure|table|exhibit|proofs?|see\s+(?:online\s+)?appendix)\b/i.test(meaning)) return false;
  if (/[=≤≥∑∫∈]/u.test(meaning) || /^[),.;:\]}]|[({[]\s*$/.test(meaning)) return false;
  if (/^(?:and|or)\b/i.test(meaning) || /:\s*$/.test(meaning)) return false;
  if (/\b(?:introduce|introduces|introduced)\b.{0,36}\bvariables?\b/i.test(meaning)) return false;
  if (/[,;]\s*(?:and\s+)?let\s+[\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20}\s*$/iu.test(meaning)) return false;
  if (/\b(?:an?|another)\s+(?:integer|parameter|variable)\s+[\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20}\b/iu.test(meaning)) return false;
  if (/,\s*(?:and\s+)?(?:let\s+)?[\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20}\s+(?:is|denotes?|represents?|refers?\s+to)\b/iu.test(meaning)) return false;
  if (/\b(?:the|a|an|and|or|of|for|with|by|to|in|on|under|where|which)\s*[.]?$/i.test(meaning)) return false;
  return true;
}

function usableReviewedSymbolMeaning(value) {
  const raw = String(value ?? "");
  const meaning = authoredEnglish(raw);
  const words = meaning.match(/[\p{L}][\p{L}'’\-]*/gu) || [];
  if (!meaning || words.length < 2 || words.length > 36 || hasMathematicalExtractionNoise(raw)) return false;
  if (isBoilerplate(meaning) || isCaption(meaning) || isCitation(meaning) || isTableRow(meaning)
    || organizationProse(meaning) || displayOrResultOnlyProse(meaning)) return false;
  // A reviewed-catalog gloss must still be a self-contained definition. A
  // leading conjunction is a reliable sign that a flattened notation row has
  // contributed only the tail of the preceding symbol's meaning.
  if (/^(?:and|or)\b/i.test(meaning)) return false;
  if (/\b(?:online\s+appendix|appendix|figure|table|exhibit|proofs?(?![-‑–—]of[-‑–—]concept)|see\s+(?:online\s+)?appendix)\b/i.test(meaning)) return false;
  return !/^[),.;:\]}]/u.test(meaning) && !/:\s*$/.test(meaning);
}

function usableReviewedSymbolDomain(value) {
  const raw = String(value ?? "");
  const domain = authoredEnglish(raw);
  if (!domain || domain.length > 180 || hasMathematicalExtractionNoise(raw)) return false;
  return !isBoilerplate(domain) && !isCaption(domain) && !isCitation(domain) && !isTableRow(domain)
    && !organizationProse(domain);
}

function sectionTextOnPage(section, pageNumber = 0) {
  if (!pageNumber) return cleanText(section.text);
  const local = (section.lines || [])
    .filter((line) => Number(line?.page) === Number(pageNumber))
    .map((line) => cleanText(line?.text))
    .filter(Boolean)
    .join(" ");
  if (local) return local;
  if (Number(section.page) === Number(pageNumber) && Number(section.endPage ?? section.page) === Number(pageNumber)) return cleanText(section.text);
  return "";
}

function sectionSourceTextOnPage(section, pageNumber = 0) {
  const sourceLines = Array.isArray(section.sourceLines) && section.sourceLines.length
    ? section.sourceLines
    : section.lines;
  if (!pageNumber) return cleanText(section.sourceText || sourceLines?.map((line) => line?.text).join(" ") || section.text);
  // Join the raw line text before normalization. Cleaning each physical line
  // independently loses the join semantics of a trailing PDF soft hyphen
  // (`monopo\u00ad` + `listic`) and can make an otherwise exact sentence look
  // absent from its own page-bounded section.
  const local = cleanText((sourceLines || [])
    .filter((line) => Number(line?.page) === Number(pageNumber))
    .map((line) => String(line?.text || ""))
    .filter(Boolean)
    .join("\n"));
  if (local) return local;
  if (Number(section.page) === Number(pageNumber) && Number(section.endPage ?? section.page) === Number(pageNumber)) {
    return cleanText(section.sourceText || section.text);
  }
  return "";
}

const LOCAL_SYMBOL_ATOM = String.raw`(?:[A-Za-zΑ-Ωα-ωϑϖϱςϕϵ](?:[A-Za-z0-9Α-Ωα-ωϑϖϱςϕϵ]|[_^][A-Za-z0-9{}*+\-]+|[∗*]{1,2}\s*[A-Za-z0-9]?)*)`;

function canonicalizeDeclaredSymbol(value) {
  let symbol = cleanText(value)
    .replace(/[.,;:]+$/u, "")
    .replace(/∗/gu, "*")
    .trim();
  if (!symbol) return "";
  symbol = symbol
    .replace(/^([A-Za-z])\*{2}\s*([a-z0-9])$/u, "$1_{$2}^{**}")
    .replace(/^([A-Za-z])\*{2}_?\{?([a-z0-9])\}?$/u, "$1_{$2}^{**}")
    .replace(/^([A-Za-z])\*\s*([A-Za-zΑ-Ωα-ωϑϖϱςϕϵ])$/u, "$1_{$2}^{*}")
    .replace(/([Α-Ωα-ωϑϖϱςϕϵ])([A-Za-z0-9]{1,3})(?=$|[,(])/gu, "$1_{$2}")
    .replace(/([A-Za-z])([Α-Ωα-ωϑϖϱςϕϵ])(?=$|[,(])/gu, "$1_{$2}")
    // In an explicit symbol-definition slot, compact tokens such as pjt,
    // Xjt, y_t, or pi_0 are indexed identifiers rather than English words.
    // This rewrite is never applied to free prose or an extracted equation.
    .replace(/\b([A-Za-z])([a-z]{1,2}|[0-9])(?=$|[(),])/gu, "$1_{$2}");
  return canonicalizeMathNotation(symbol);
}

function plausibleDeclaredSymbol(value) {
  const raw = cleanText(value);
  if (!raw || raw.length > 48 || hasMathematicalExtractionNoise(value) || /\s{2,}/u.test(raw)) return false;
  if (STOP_WORDS.has(raw.toLowerCase()) || SYMBOL_WORD_REJECTIONS.has(raw.toLowerCase())) return false;
  if (/^[a-z]{2,}$/u.test(raw) && !/^[pqtyosw][a-z0-9]{1,2}$/u.test(raw)) return false;
  const canonical = canonicalizeDeclaredSymbol(raw);
  return Boolean(canonical) && !formalStructureIssue(canonical, "");
}

function sourceMentionsDeclaredSymbol(source, rawSymbol) {
  const text = cleanText(source);
  const raw = cleanText(rawSymbol);
  if (!text || !raw) return false;
  let offset = text.indexOf(raw);
  while (offset >= 0) {
    const before = text[offset - 1] || "";
    const after = text[offset + raw.length] || "";
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    offset = text.indexOf(raw, offset + 1);
  }
  return false;
}

function declaredNounMeaning(value) {
  const noun = authoredEnglish(value).toLowerCase()
    .replace(/^(?:some|a|an|the)\s+/u, "")
    .replace(/^(?:fixed|current|observed|feasible)\s+/u, "")
    .trim();
  if (/^starting time$/u.test(noun)) return "the simulation starting time";
  if (/^price$/u.test(noun)) return "the product price";
  if (/^action$/u.test(noun)) return "the receiver action";
  if (/^state$/u.test(noun)) return "the modeled state";
  return noun ? `the ${noun}` : "";
}

export function symbolCandidates(section, record, focus, pageNumber = 0, options = {}) {
  const output = [];
  const focusText = cleanText(focus);
  const includeReviewedCatalog = options.includeReviewedCatalog === true;
  const localFormula = includeReviewedCatalog
    ? ""
    : cleanText(options.formal !== undefined
      ? options.formal
      : formulaFromSection(section, focus, pageNumber).formal);
  const supportsLocalFormula = (candidateSymbol) => {
    if (!localFormula) return true;
    const symbol = canonicalizeMathNotation(cleanText(candidateSymbol));
    if (!symbol) return false;
    if (containsIdentifierToken(localFormula, symbol)) return true;
    const base = symbol.replace(/\([^()]*\)\s*$/u, "");
    return base !== symbol && containsIdentifierToken(localFormula, base);
  };
  const reviewedLimit = includeReviewedCatalog
    ? Math.max(1, (record.notation || []).length)
    : 6;
  for (const item of record.notation || []) {
    if (!item?.symbol || !item?.meaning) continue;
    const symbol = canonicalizeMathNotation(cleanText(item.symbol).replace(/,(?=\S)/g, ", "));
    const meaning = authoredEnglish(item.meaning);
    if (!plausibleRecordSymbol(symbol) || !usableReviewedSymbolMeaning(item.meaning)
      || !supportsLocalFormula(symbol)) continue;
    const domain = usableReviewedSymbolDomain(item.domain) ? authoredEnglish(item.domain) : "";
    const displayMeaning = domain && !meaning.toLowerCase().includes(domain.toLowerCase())
      ? `${meaning} · ${domain}`
      : meaning;
    const localScore = overlapScore(focus, `${symbol} ${meaning} ${item.role || ""}`);
    const head = symbol.match(/^(?:\\[A-Za-z]+|[\p{L}])/u)?.[0] || "";
    const headMentioned = containsIdentifierToken(focusText, head);
    const symbolMentioned = focusText.includes(symbol) || headMentioned;
    if (includeReviewedCatalog || !focus || localScore >= 2 || symbolMentioned) {
      output.push({ symbol, meaning: displayMeaning, sourceKind: "reviewed-catalog" });
    }
    if (output.length >= reviewedLimit) break;
  }
  if (output.length) return distinctObjects(output, "symbol", reviewedLimit, { caseSensitive: true });
  const sourceQuote = cleanText(options.sourceQuote || "");
  const cleanPageText = sectionTextOnPage(section, pageNumber);
  const sourcePageText = sectionSourceTextOnPage(section, pageNumber);
  const text = distinct([sourceQuote, cleanPageText, sourcePageText]).join(" ");
  if (!text) return [];
  const addGroundedSymbol = (rawSymbol, rawMeaning) => {
    const raw = cleanText(rawSymbol);
    const meaning = truncateWords(authoredEnglish(rawMeaning), 24);
    if (!plausibleDeclaredSymbol(raw) || !usableSymbolMeaning(meaning)) return;
    if (sourceQuote && !sourceMentionsDeclaredSymbol(sourceQuote, raw)) return;
    const symbol = canonicalizeDeclaredSymbol(raw);
    if (!supportsLocalFormula(symbol)) return;
    output.push({ symbol, meaning });
  };
  const symbolMeaning = (value) => {
    const cleaned = authoredEnglish(value).replace(
      /,\s+(?:and\s+)?(?=[\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20}(?:\s*∈\s*[^,;.]{1,20})?\s+(?:denote[s]?|represent[s]?|refer[s]?\s+to)\b).*$/iu,
      ""
    ).replace(/,\s+(?:and\s+)?we\s+(?:assume|let|define)\b.*$/i, "")
      .replace(/,\s+and\s+(?:the\s+)?(?:expectation|assumption)\b.*$/i, "");
    return truncateWords(cleaned.replace(
      /,\s*[\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20}\s*(?:[=<>≤≥≠∈∉]|\\(?:leq?|geq?|neq?|in|notin)\b).*$/iu,
      ""
    ), 24);
  };
  const nounLabels = [
    "starting time", "switching cost", "preference shift", "commission rate", "choice function",
    "underlying policy", "logging policy", "deterministic policy class", "policy class", "action space",
    "system state", "order adjustment vector", "market state", "marginal cost", "monopoly price",
    "monopoly profit", "product price", "price", "product characteristics", "characteristics of the product"
  ].sort((left, right) => right.length - left.length).join("|");
  const nounDefinitionPattern = new RegExp(
    `\\b(?:the\\s+|a\\s+|an\\s+|some\\s+|fixed\\s+|current\\s+|observed\\s+|feasible\\s+)*(${nounLabels})\\s+(?:(?:of|is)\\s+)?(${LOCAL_SYMBOL_ATOM}(?:\\([^.;]{1,28}\\))?)`,
    "giu"
  );
  for (const match of text.matchAll(nounDefinitionPattern)) {
    const rawSymbol = cleanText(match[2]);
    // Function arguments are part of an action-space or policy signature;
    // canonicalize them only after the noun-symbol apposition proves that the
    // token is mathematical, not a neighboring word.
    if (rawSymbol !== "a" && rawSymbol !== "an" && rawSymbol !== "the") {
      addGroundedSymbol(rawSymbol, declaredNounMeaning(match[1]));
    }
  }
  for (const match of text.matchAll(new RegExp(
    `\\b(?:I|we|the model)\\s+denote[s]?\\s+([^.;]{8,110}?)\\s+by\\s+(${LOCAL_SYMBOL_ATOM}(?:\\([^.;]{1,28}\\))?)`,
    "giu"
  ))) {
    const meaning = /\bprice a monopoly would set\b/iu.test(match[1])
      ? "the monopoly price as a function of market state and marginal cost"
      : match[1].replace(/^(?:the|a|an)\s+/iu, "the ");
    addGroundedSymbol(match[2], meaning);
  }
  for (const match of text.matchAll(/\bmagnitude of (?:the )?([^,.;]{2,36}),\s*([A-Za-zΑ-Ωα-ωϑϖϱςϕϵ]),/giu)) {
    addGroundedSymbol(match[2], `the magnitude of ${authoredEnglish(match[1]).toLowerCase()}`);
  }
  const boundedSwitchingCost = text.match(/\bswitching cost satisfies\s*0\s*<\s*([A-Za-z])\s*<\s*3\b/iu);
  if (boundedSwitchingCost) addGroundedSymbol(boundedSwitchingCost[1], "the switching cost");
  if (/\bimpression is legitimate\b[\s\S]*\bwinning advertiser\b/iu.test(text)) {
    const payoff = text.match(/=\s*([Α-Ωα-ωϑϖϱςϕϵA-Za-z])(?=[,.;\s])/u);
    if (payoff) addGroundedSymbol(payoff[1], "the winning advertiser's payoff from a legitimate impression");
  }
  const statePair = text.match(/\btwo states?,\s*good\s*\(([A-Za-z])\)\s*and\s*bad\s*\(([A-Za-z])\)/iu);
  if (statePair) {
    addGroundedSymbol(statePair[1], "the good state");
    addGroundedSymbol(statePair[2], "the bad state");
  }
  const actionPair = text.match(/\btaking action\s+([A-Za-z])\s*\(([A-Za-z])\)\s+when the state is\s+([A-Za-z])\s*\(([A-Za-z])\)/iu);
  if (actionPair) {
    addGroundedSymbol(actionPair[1], "the receiver action matched to the good state");
    addGroundedSymbol(actionPair[2], "the receiver action matched to the bad state");
    addGroundedSymbol(actionPair[3], "the good state");
    addGroundedSymbol(actionPair[4], "the bad state");
  }
  if (/\boptimal quantity (?:schedule|functions?)\b/iu.test(text)) {
    const quantity = text.match(/\b([qQ][∗*]{2}\s*[a-z0-9])\b[^.;]{0,90}\bis decreasing\b/iu);
    if (quantity) addGroundedSymbol(quantity[1], "the optimal quantity schedule for hot-spot provider i");
  }
  const chainedDefinitionPattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${LOCAL_SYMBOL_ATOM})(?:\\s*∈\\s*[^,;.]{1,20})?\\s+(?:denote[s]?|represent[s]?|refer[s]?\\s+to)\\s+(?:the\\s+)?([^,;.]{4,100}?)(?=,\\s*(?:and\\s+)?${LOCAL_SYMBOL_ATOM}(?:\\s*∈\\s*[^,;.]{1,20})?\\s+(?:denote[s]?|represent[s]?|refer[s]?\\s+to)|[.;]|$)`,
    "giu"
  );
  for (const match of text.matchAll(chainedDefinitionPattern)) {
    addGroundedSymbol(match[1], match[2]);
  }
  const patterns = [
    /(?:where|let|define)\s+([\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20})(?:\s*∈\s*[^,;.]{1,20})?\s+(?:denote[s]?|be|is|represent[s]?)\s+([^.;]{8,140})/giu,
    /we\s+(?:denote|use|write)\s+([\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20})\s+(?:as|to\s+represent|for)\s+([^.;]{8,140})/giu,
    /(?<![\p{L}\p{N}_])([\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20})(?:\s*∈\s*[^,;.]{1,20})?\s+(?:denote[s]?|represent[s]?|refer[s]?\s+to)\s+(?:the\s+)?([^.;]{8,140})/giu
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawSymbol = cleanText(match[1]).replace(/^(?:the|a)\s+/i, "");
      // In first-person source prose, "I denote ..." introduces the symbol
      // after "by"; the subject pronoun is never itself a model identifier.
      if (rawSymbol === "I" && /^I\s+denote\b/u.test(match[0])) continue;
      const symbol = canonicalizeDeclaredSymbol(rawSymbol);
      const meaning = symbolMeaning(match[2]);
      const ambiguousGreekScript = /[Α-Ωα-ωϑϖϱςϕϵ][ijkmnt0-9]$/iu.test(rawSymbol)
        || /(?<![\\A-Za-z])(?:varepsilon|vartheta|varpi|varrho|varsigma|varphi|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)(?:\d+|[ijkmnt])$/i.test(rawSymbol);
      const validSymbol = !ambiguousGreekScript && plausibleSymbol(rawSymbol)
        && !formalStructureIssue(symbol, "") && supportsLocalFormula(symbol)
        && (!sourceQuote || sourceMentionsDeclaredSymbol(sourceQuote, rawSymbol) || Boolean(localFormula));
      const clippedMeaning = meaning;
      const meaningWords = clippedMeaning.match(/[\p{L}][\p{L}'’\-]*/gu) || [];
      if (validSymbol && meaningWords.length >= 2
        && usableSymbolMeaning(clippedMeaning)
        && !/\b(?:of|for|where)\s*,|^[,.;:]/i.test(clippedMeaning)
        && !/\/equals|[=≤≥∑∫∈]/.test(clippedMeaning)) {
        output.push({ symbol, meaning: clippedMeaning });
      }
      if (output.length >= 6) break;
    }
    if (output.length >= 6) break;
  }
  return distinctObjects(output, "symbol", 6, { caseSensitive: true });
}

function distinctObjects(values, key, limit, { caseSensitive = false } = {}) {
  const seen = new Set();
  return values.filter((value) => {
    const cleaned = cleanText(value?.[key]);
    const normalized = caseSensitive ? cleaned : cleaned.toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, limit);
}

const CONDITION_MATH_SIGNAL = /(?:[=<>≤≥≠≈≡∈∉⊂⊃⊆⊇]|\\(?:leq?|geq?|neq?|in|notin|subset(?:eq)?|supset(?:eq)?|approx|equiv)\b)/iu;
const CONDITION_PREDICATE_SIGNAL = /\b(?:is|are|was|were|be|been|being|has|have|had|may|might|must|can|could|should|would|will|shall|assum(?:e|es|ed|ing)|suppos(?:e|es|ed|ing)|subject\s+to|provided\s+that|conditional\s+on|given|observ(?:e|es|ed)|know(?:s|n)?|arriv(?:e|es)|choos(?:e|es)|decid(?:e|es|ed|ing)|announc(?:e|es|ed|ing)|set(?:s)?|charg(?:e|es)|contain(?:s)?|depend(?:s)?|follow(?:s)?|hold(?:s)?|includ(?:e|es)|limit(?:s)?|normaliz(?:e|es|ed)|preced(?:e|es)|remain(?:s)?|require(?:s)?|reveal(?:s)?|sell(?:s)?|use(?:s)?|yield(?:s)?|defin(?:e|es|ed|ing)|denot(?:e|es|ed|ing)|represent(?:s|ed|ing)?|(?:allocat|assign|determin|estimat|evolv|maximiz|minimiz|operat|receiv|select|specif)[a-z]*|[a-z]{4,}(?:ed|ing))\b/iu;
// Release locality deliberately ignores schema words (for example, `model`,
// `objective`, and `result`).  Those words are useful for finding a section,
// but sharing one of them does not make a premise applicable to a component.
// Keep this vocabulary and stemmer aligned with the independent release gate;
// authoring should never create a note that only the later audit can discover
// is locally unsupported.
const CONDITION_LOCALITY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "can", "case", "component",
  "condition", "could", "did", "do", "does", "entry", "for", "formal", "framework", "from", "had",
  "has", "have", "how", "if", "in", "into", "is", "it", "its", "may", "might", "model", "modeled",
  "modeling", "no", "not", "objective", "of", "on", "only", "or", "paper", "result", "results", "role",
  "section", "should", "source", "study", "system", "that", "the", "their", "them", "these", "they",
  "this", "to", "under", "was", "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would"
]);
const CONDITION_LOCALITY_TOKEN_EQUIVALENTS = new Map([
  ...["denominator", "fraction", "normaliz", "normalization", "normalize", "numerator", "quotient", "ratio", "relative"]
    .map((token) => [token, "ratio"]),
  ...["care", "clinical", "health", "healthcare", "medical", "prevention", "preventive", "screen", "screening", "test", "tested", "testing", "treatment"]
    .map((token) => [token, "clinical-care"]),
  ...["fatigue", "productivity", "tired", "tiredness"]
    .map((token) => [token, "fatigue-productivity"])
]);

function conditionLocalityStem(token) {
  if (token === "prices" || token === "priced" || token === "pricing") return "price";
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 7) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 6) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 6) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) return token.slice(0, -1);
  return token;
}

function conditionLocalityTokens(value) {
  return (String(value ?? "").normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .map(conditionLocalityStem)
    .map((token) => CONDITION_LOCALITY_TOKEN_EQUIVALENTS.get(token) || token)
    .filter((token) => !CONDITION_LOCALITY_STOP_WORDS.has(token) && !/^\d+$/u.test(token));
}

function hasConditionLocalityOverlap(left, right) {
  const wanted = new Set(conditionLocalityTokens(left));
  return conditionLocalityTokens(right).some((token) => wanted.has(token));
}
const CONDITION_CONTEXT_SIGNAL = /\b(?:we\s+assume|is\s+assumed|our\s+assumptions?|suppose|subject\s+to|provided\s+that|conditional\s+on|under\s+the\s+assumption|in\s+the\s+case\s+where|before|after|prior\s+to|at\s+the\s+(?:beginning|start|end)|in\s+each\s+(?:period|stage)|with\s+time|as\s+[^.;]{0,90}\b(?:increas|decreas|declin|grow|evolv)[a-z]*|(?:impos|add)[a-z]*\s+(?:an?\s+)?(?:additional\s+)?constraint|while\s+[^.;]{0,80}\bsatisf(?:y|ies|ied|ying)\b|observ(?:e|es|ed|able)|know(?:s|n)?|unknown|uncertain|private(?:ly)?|public(?:ly)?|independent(?:ly)?|identically\s+distributed|follows?\s+(?:a|an|the)\s+[^.;]{0,40}\s+distribution|(?:feasible|admissible)\s+(?:allocation|assignment|decision|policy|rule|set|solution|schedule|flow|region|rate|speed)|(?:is|are|was|were)\s+(?:explicitly\s+)?set\s+to|(?:nonnegative|positive|bounded|fixed|constant)\s+(?:[\p{L}'’\-]+\s+){0,2}(?:parameter|price|rate|cost|quantity|value|horizon|capacity|budget|demand|number)|capacity\s+(?:is|equals|limits?)|budget\s+(?:is|equals|limits?)|is\s+(?:fixed|constant|nonnegative|positive|bounded|normalized)|are\s+(?:fixed|constant|nonnegative|positive|bounded|normalized)|cannot|must|required?\s+to)\b/iu;
const VARIANT_CHANGE_CONDITION = /^(?:in\s+this\s+(?:section|extension|variant)\b[^.;]{0,120}\b(?:relax|replace|remove|instead|does?\s+not|without)|this\s+(?:extension|variant)\s+(?:relaxes|replaces|removes)|(?:first|second|next|finally)?\s*,?\s*we\s+consider\s+(?:(?:a|the)\s+)?(?:model|situation|case)\s+(?:where|in\s+which)\b[^.;]{0,180}\b(?:exogenously\s+set|restrict(?:ed|s)?|without|does?\s+not|cannot|only\s+one)|instead\b)/i;
const MODELING_DECLARATION_CONDITION = /^(?:we|the\s+(?:paper|model|analysis))\s+(?:consider|adopt|use|specify|formulate|model)\w*\s+(?:a|an|the)\s+(?:(?:[\p{L}'’–-]+\s+){0,4})?(?:demand\s+(?:system|function|specification)|utility\s+(?:function|model)|choice\s+(?:function|model)|arrival\s+(?:process|model)|cost\s+(?:function|model))\b/iu;
const VARIANT_LOCAL_INVARIANT_CONDITION = /^we\s+continue\s+to\s+use\s+the\s+same\s+(?:timing|sequence|information\s+structure|assumptions?)\b[^.;]{0,180}\b(?:as|from)\b/iu;
const PREFERENCE_REGIME_CONDITION = /^(?:In\s+this\s+section,?\s+)?we\s+consider\s+(?:the\s+)?case\s+where\s+(?:the\s+)?goods?\s+(?:are|is)\s+(?:a\s+)?(?:substitutes?|complements?)\.?$/iu;
const EXPLICIT_VARIANT_SPECIFICATION_CONDITION = /(?:\bbenchmark\s+case\s+where\b[^.!?]{0,260}\b(?:does?\s+not|without|rather|instead)\b|\bwe\s+endogenize\s+the\s+decision\b[^.!?]{0,220}\b(?:choose|singlehome|multihome)\b|^This\s+section\s+examines\b[^.!?]{0,220}\bfixed\s+price\b[^.!?]{0,180}\b(?:remains?\s+unchanged|regardless)\b|^(?:In\s+other\s+words,?\s+)?[^.!?]{0,180}\bcan\s+be\s+endogenously\s+set\s+by\s+the\s+platform\b|^In\s+this\s+approach,?\s+the\s+platform\s+randomly\s+selects?\b[^.!?]{0,220}\boffers?\b|^In\s+this\s+section,?\s+we\s+broaden\s+the\s+scope\s+of\s+our\s+base\s+model\b|^We\s+model\s+a\s+duopoly\s+scenario\b|^In\s+this\s+extension,?\s+we\s+(?:also\s+)?allow\b|^This\s+section\s+introduces\s+a\s+dynamic\s+extension\b|^For\s+the\s+best-case\s+benchmark\s+approach,?\s+we\s+consider\b)/iu;
const EXPLICIT_LOCAL_FORMULATION_CONDITION = /(?:^We\s+(?:(?:now|further)\s+)?extend\s+(?:our|the)\s+(?:[\p{L}'’–-]+\s+){0,5}model\s+(?:by\s+(?:incorporating|relaxing|allowing)|to(?:\s+allow)?)\b|^Without\s+loss\s+of\s+generality,?\s+we\s+extend\s+(?:our|the)\s+(?:[\p{L}'’–-]+\s+){0,5}model\s+to\b|^Since\s+[^.!?]{0,180}\bcan\s+decide\s+whether\b[^.!?]{0,180}\bpossible\s+cases?\s+arise\b)/iu;
// Variant-local setup needs a literal proposition that actually defines the
// changed formulation.  Keep this narrower than general paper-definition
// prose: it requires both an authorial construction/change verb and an
// explicit model, formulation, approximation, relaxation, or benchmark noun.
const EXPLICIT_VARIANT_DEFINITION_CONDITION = /(?:^(?:We|This\s+section|The\s+paper)\s+(?:now\s+)?(?:propose|present|introduce|develop|construct|formulate|derive|adapt|obtain|define)\w*\b[^.!?]{0,180}\b(?:model|formulation|approximation|relaxation|benchmark|mechanism|optimization\s+problem|dynamic\s+program)\b|^In\s+(?:this\s+section|(?:the\s+)?Online\s+Appendix\s+[A-Z0-9.]+),?\s+we\s+(?:propose|present|introduce|develop|construct|formulate|derive|adapt|obtain|define)\w*\b[^.!?]{0,180}\b(?:model|formulation|approximation|relaxation|benchmark|mechanism|optimization\s+problem|dynamic\s+program|MDP)\b|^(?:Our|The|This)\s+(?:[\p{L}\p{N}'’–-]+\s+){0,5}(?:model|MDP)\s+can\s+be\s+(?:modified|extended|generalized|adapted)\s+to\s+(?:relax|allow|incorporate)\b|^Here,?\s+we\s+consider\s+an?\s+alternative\s+[^.!?]{0,100}\bformulation\s+by\s+modeling\b|^This\s+section\s+introduces?\s+(?:an?\s+)?(?:stochastic|deterministic|dynamic|static|robust|extended|modified)?\s*(?:version|extension)\s+of\s+(?:the|our)\s+model\b|^In\s+(?:a\s+)?similar\s+manner,?\s+we\s+obtain\b[^.!?]{0,140}\bmodel\s+when\b|^(?:While|Although)\b[^.!?]{0,180}\b(?:model|framework|formulation)\b[^.!?]{0,120}\b(?:naturally\s+)?extends?\s+to\b|^We\s+(?:now\s+)?(?:reformulate|replace|relax|modify|generalize)\w*\s+(?:the|our|this)\s+(?:problem|model|formulation|program)\b|^Under\s+(?:the|this|our|an?)\s+[^.!?]{0,80}\b(?:approximation|model|formulation|policy|business\s+rule)\b[^.!?]{0,180}\b(?:assume|replace|restrict|set|cannot|must|is|are)\b|^In\s+this\s+(?:section|model|formulation|approximation|relaxation|benchmark|case|setting|policy),?\s+we\s+(?:assume|consider|replace|restrict|allow|impose|ignore|model|examine)\b|^We\s+consider\s+(?:the\s+)?(?:benchmark(?:ing)?\s+)?(?:case|setting|system|model)\s+(?:where|when|with|of)\b|^(?:The|This)\s+(?:model|formulation|approximation|relaxation|benchmark|optimization\s+problem)\b[^.!?]{0,180}\b(?:is|are|serves?|constitutes?|replaces?|relaxes?|assumes?|restricts?|allows?|uses?)\b)/iu;
const NAMED_BENCHMARK_STRUCTURE_CONDITION = /^In\s+the\s+(?:(?:[\p{L}\p{N}'’–-]+)\s+){0,5}benchmark\s+case,?\s+[^.!?]{0,220}\b(?:is\s+sold\s+by|are\s+sold\s+by|consists?\s+of|contains?|comprises?|uses?|does\s+not|do\s+not|competes?|participates?)\b/iu;
const EXPLICIT_MODEL_POLICY_CONDITION = /\b(?:inventory|replenishment)\s+management\b[^.!?]{0,140}\bfollows?\s+(?:a|an|the)\s+[^.!?]{0,60}\bpolicy\b/iu;
const PROCESS_MODELING_CONDITION = /^(?:[A-Z][A-Z0-9_-]{1,8}\s+models?\b[^.!?]{0,220}\b(?:dynamics?|flows?|random[-\s]+walks?|process(?:es)?|propagat(?:e|es|ed|ing))|The\s+design\s+of\s+the\s+[A-Z][A-Z0-9_-]{1,8}\s+process\s+requires\b)/u;
const FORMAL_PROCESS_DEFINITION_CONDITION = /^To\s+make\s+the\s+above\s+process\s+more\s+formal,?\s+we\s+define\b[^.!?]{0,220}\b(?:random[-\s]+walk|Markov\s+chain|state\s+space)\b/iu;
const STRUCTURAL_MODEL_LIMITATION_CONDITION = /^(?:Such\s+interactions\b[^.!?]{0,220}\b(?:oversimplified|losing\s+critical\s+information)|(?:Networks?|graphs?)\b[^.!?]{0,220}\b(?:constrained|limited)\b[^.!?]{0,120}\bpairwise\s+interactions?|Although\s+traditional\s+network\s+models\b[^.!?]{0,220}\bfall\s+short\b[^.!?]{0,120}\bhigher[-\s]+order\s+interactions?)\b/iu;
const EXPLICIT_CONSTRAINT_CONDITION = /^Constraints?\s*\([A-Za-z0-9.]+\)\s+(?:ensures?|requires?|imposes?|guarantees?|restricts?)\b/iu;
// A paper-owned, declarative procedure can be the literal applicability rule
// for an algorithm or design component even when it contains no mathematical
// premise word such as "given" or "subject to". Keep this deliberately narrow:
// it must name the authors' own algorithm/model and state the modeled action.
const PAPER_OWNED_PROCEDURAL_CONDITION = /^(?:Our\s+(?:algorithm|method|procedure|policy)\s+(?:builds?|chooses?|constructs?|iterates?|selects?|sequences?|updates?)\b|We\s+(?:first\s+)?(?:give|present|describe)\b[^.!?]{0,90}\bour\s+(?:algorithm|method|procedure|policy)\b[^.!?]{0,120}\b(?:builds?|chooses?|constructs?|iterates?|selects?|sequences?|updates?)\b|We\s+consider\s+(?:a|an|the)\s+[^.!?]{0,100}\b(?:design|decision|optimization)\s+problem\s+consisting\s+of\s+(?:selecting|sequencing|choosing|ordering|allocating|designing|pricing|scheduling)\b)/iu;
// Some formulation sections state their primitive as a stage action, a
// parameter/decision-variable definition, or an equation-level restriction
// without using an explicit "assume" lead. These remain genuine model
// conditions: each pattern requires a declarative, paper-local predicate and
// is still subject to the prose/noise/result screens above.
const STAGE_LOCAL_DECISION_CONDITION = /^In\s+(?:Stage|Period|Round)\s+\d+\b[^.!?]{0,220}\b(?:chooses?|sets?|selects?|allocates?|assigns?|schedules?|orders?)\b/iu;
const SOURCE_VARIABLE_DEFINITION_CONDITION = /^(?:Finally,?\s+)?(?:Let\s+[\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20}\s+(?:be|denote|represent)\b|[\p{L}][\p{L}\p{N}_{}^()*,+\-]{0,20}\s+is\s+(?:a|an|the)\s+(?:decision|state|control|input|cost|capacity|demand|price|rate|time|inventory|holding|return)\s+(?:variable|parameter|quantity|value|cost|rate))\b/iu;
const SOURCE_CONSTRAINT_DEFINITION_CONDITION = /^(?:(?:Equation|Constraint)s?\s*\(?[A-Za-z0-9.\-]+\)?|The\s+(?:first|second|third|fourth)\s+(?:set\s+of\s+)?constraints?)\s+(?:ensures?|requires?|imposes?|limits?|restricts?|keeps?|links?|enforces?|guarantees?)\b/iu;
const PAPER_OWNED_RESTRICTION_CONDITION = /^In\s+(?:the\s+)?[^.!?]{0,100}\bsystem,?\s+[^.!?]{0,160}\bis\s+constrained\s+by\s+(?:an?\s+)?(?:capacity|budget|limit|bound)\b/iu;
const SOURCE_STATE_DEFINITION_CONDITION = /^(?:Vector\s+[^.!?]{0,80}\s+is\s+the\s+[^.!?]{0,80}\bstate\b|The\s+[^.!?]{0,80}\bstate\s+(?:is|consists?\s+of|contains?)\b)/iu;
const FORMULATION_TRANSFORMATION_CONDITION = /^(?:Until\s+now,?\s+)?Constraints?\s*\([A-Za-z0-9.]+\)\s+(?:(?:can|have|has)\s+(?:also\s+)?(?:be|been)\s+)?(?:transformed|reformulated)\s+into\s+(?:an?\s+)?(?:equivalent\s+)?(?:linear|mixed[-\s]+integer|conic|convex)\s+(?:model|program(?:ming)?\s+problem)\b/iu;
const PAPER_OWNED_MODELING_OPERATION_CONDITION = /^(?:Specifically,?\s+)?(?:By\s+using\b[^.!?]{0,160}\b)?(?:we|the\s+(?:paper|model|formulation))\s+(?:can\s+)?(?:construct|formulate|model|reformulate|represent|encode)\w*\b[^.!?]{0,180}\b(?:model|problem|formulation|program|system|schedule)\b/iu;
const PAPER_OWNED_MECHANISM_OPERATION_CONDITION = /^(?:In\s+(?:Proposition|Theorem)\s+[A-Z0-9.]+,?\s+)?(?:my|our|the)\s+(?:proposed\s+)?(?:mechanism|policy|contract)\b[^.!?]{0,220}\b(?:charges?|taxes?|subsidizes?|offers?|allocates?|assigns?|sets?|selects?|pays?|rewards?)\b/iu;

function explicitLocalVariantCondition(value) {
  const text = authoredEnglish(value);
  // A sentence can begin as a local extension declaration and then report
  // that the paper's results continue to hold.  The declaration prefix does
  // not turn that mixed proposition into a setup condition: conditions must
  // remain premises, domains, timing rules, or feasibility restrictions.
  // Apply the same fail-closed result/contribution screen before any variant
  // whitelist so authoring and the independent semantic audit agree.
  if (conditionResultOrContributionProse(text)) return false;
  return PREFERENCE_REGIME_CONDITION.test(text)
    || EXPLICIT_VARIANT_SPECIFICATION_CONDITION.test(text)
    || EXPLICIT_LOCAL_FORMULATION_CONDITION.test(text)
    || EXPLICIT_VARIANT_DEFINITION_CONDITION.test(text)
    || /^(?:In\s+[^.!?]{0,80},?\s+)?we\s+(?:examine|study|consider)\b[^.!?]{0,100}\bextensions?\b[^.!?]{0,160}\bin\s+which\b/iu.test(text)
    || /^In\s+particular,?\s+we\s+ignore\b[^.!?]{0,180}\binfluence\b/iu.test(text)
    // A named benchmark can be defined in a shared setup subsection rather
    // than beneath its later analysis heading. Retain only structural
    // declarations (for example, who sells or participates), never a
    // comparative-static or theorem result that merely mentions a benchmark.
    || (NAMED_BENCHMARK_STRUCTURE_CONDITION.test(text)
      && !conditionResultOrContributionProse(text));
}

function rawMathWrapperInProse(value) {
  const inspected = String(value ?? "")
    .replace(/https?:\/\/\S+/giu, " URL ")
    .replace(/\\\$/gu, " ESCAPED_DOLLAR ")
    .replace(/(?<!\\)\$(?:\s*\d+(?:[.,]\d+)*(?:\s*(?:thousand|million|billion|trillion|k|m|bn))?|\/[A-Za-z]+|[A-Z]{1,4}\b)/gu, " CURRENCY ");
  return /(?<!\\)\$/u.test(inspected) || /\\(?:\(|\)|\[|\])/u.test(inspected);
}

function rawSetupMathMarkup(value) {
  const inspected = String(value ?? "").replace(/\\\$/gu, " ESCAPED_DOLLAR ");
  return rawMathWrapperInProse(value)
    || /\\[A-Za-z]+/u.test(inspected)
    || /[\p{L}\p{N}′’*∗})\]]\s*\\\s*[\p{L}](?=$|[^\p{L}\p{N}_])/u.test(inspected);
}

// This is the authoring grammar for a declarative condition.  The release
// audit imports it as an additional, deliberately bounded predicate signal so
// source definitions such as "we denote ..." are not rejected merely because
// the independent English-verb heuristic lacks that base form.
export function authoredConditionHasPredicate(value) {
  const condition = authoredEnglish(value);
  return Boolean(condition) && (CONDITION_MATH_SIGNAL.test(condition)
    || MODELING_DECLARATION_CONDITION.test(condition)
    || explicitLocalVariantCondition(condition)
    || PAPER_OWNED_RESTRICTION_CONDITION.test(condition)
    || PAPER_OWNED_PROCEDURAL_CONDITION.test(condition)
    || CONDITION_PREDICATE_SIGNAL.test(condition));
}

function substantiveSourceCondition(value) {
  const condition = authoredEnglish(value);
  if (!condition || rawMathWrapperInProse(value) || residualAuthoredBackslash(value)
    || hasExtractionNoise(condition) || hasSourceTextNoise(value)
    // A stacked fraction can lose its bar in PDF text extraction and become
    // two adjacent numeric tokens after a comparison (for example,
    // `k2 > 49 144`).  That is not a recoverable mathematical premise: using
    // it would publish a different restriction from the printed formula.
    || /(?:[=<>≤≥≠≈≡]\s*[+−-]?\d+(?:[.,]\d+)?\s+[+−-]?\d+(?:[.,]\d+)?)(?=\s|[.;,:]|$)/u.test(condition)
    || /\b[A-Za-z][A-Za-z0-9]{1,5}\s+0\s+\(i\.e\.,/u.test(condition)
    || /\b(?:anti\s+gen|repre\s+sent(?:ed|ing)|enti\s+ties|popu\s+lation|vaccina\s+tion|frac\s+tion(?:al|ation)?|administra\s+tion|epi\s+demic|suscepti\s+ble|transmis\s+sion|immuni\s+zation|progres\s+sively|probabil\s+ity|cur\s+rent|effi\s+ciency|simu\s+lating|un-\s+like)\b/i.test(condition)
    || /^[A-Z][^.!?]{2,100}\([a-z]{1,4}\)\s+(?=(?:When|If|The|A|An|We|Unlike)\b)/u.test(condition)
    || /\b\d+(?:\.\d+)?\s*<\s*[A-Za-z]\s*<\s*[A-Za-z0-9]+\s*=\s*[A-Za-z0-9]+\b/u.test(condition)
    || /\b[A-Za-z]\s*∈\s*[A-Za-z]\s*\|[A-Za-z]\s*\|\s*×\s*\|[A-Za-z]\s*\|\s*P0\b/u.test(condition)
    || /^(?:(?:[A-Z][\p{L}'’&-]*|with|and|of|for|the)\s+){0,12}(?:Model|Problem|Constraints?|Formulation|Objective|Notation|Definitions?)\s+(?=(?:Our|We|The|A|An)\b)/u.test(condition)
    || (organizationProse(condition) && !explicitLocalVariantCondition(condition))
    || backgroundOnlyProse(condition) || displayOrResultOnlyProse(condition)
    || (conditionResultOrContributionProse(condition) && !explicitLocalVariantCondition(condition))
    || isBoilerplate(condition) || isCaption(condition) || isCitation(condition) || isTableRow(condition)) return false;
  const termCount = condition.match(/[\p{L}\p{N}]+/gu)?.length || 0;
  const lexicalCount = sourceSemanticTokens(condition).length;
  const mathematical = CONDITION_MATH_SIGNAL.test(condition);
  // A release condition is a complete proposition, not a line- or column-end
  // fragment.  Model/variant prefixes do not waive terminal punctuation: that
  // exception previously retained truncated clauses such as "for which, in
  // each period" and pushed the defect downstream to Mini-parity audit.
  if (termCount < 5 || !/[.!?]\s*$/u.test(condition)) return false;
  if (!mathematical && lexicalCount < 4) return false;
  return authoredConditionHasPredicate(condition);
}

function sourceModelsCondition(value) {
  const condition = authoredEnglish(value);
  return substantiveSourceCondition(condition)
    && (CONDITION_MATH_SIGNAL.test(condition) || CONDITION_CONTEXT_SIGNAL.test(condition)
      || /\b(?:is|are)\s+(?:defined|denoted|represented)\b|\bwe\s+(?:define|denote|represent)\b/i.test(condition)
      || /\b(?:nurse\s+)?pools?\b[^.!?]{0,120}\b(?:shared|disjoint|cross[- ]trained|covered)\b|\bshare\s+one\s+nurse\s+pool\b/i.test(condition)
      || /\b(?:conduct\s+\d[\d,]*\s+iterations?|based\s+on\s+(?:an?\s+)?(?:random\s+)?sample\s+of\s+\d[\d,]*|(?:out-of-sample\s+)?tests?\s+runs?\s+on\s+\d[\d,]*)\b/i.test(condition)
      || VARIANT_CHANGE_CONDITION.test(condition)
      || MODELING_DECLARATION_CONDITION.test(condition)
      || VARIANT_LOCAL_INVARIANT_CONDITION.test(condition)
      || PROCESS_MODELING_CONDITION.test(condition)
      || FORMAL_PROCESS_DEFINITION_CONDITION.test(condition)
      || STRUCTURAL_MODEL_LIMITATION_CONDITION.test(condition)
      || EXPLICIT_CONSTRAINT_CONDITION.test(condition)
      || EXPLICIT_MODEL_POLICY_CONDITION.test(condition)
      || PAPER_OWNED_PROCEDURAL_CONDITION.test(condition)
      || STAGE_LOCAL_DECISION_CONDITION.test(condition)
      || SOURCE_VARIABLE_DEFINITION_CONDITION.test(condition)
      || SOURCE_CONSTRAINT_DEFINITION_CONDITION.test(condition)
      || PAPER_OWNED_RESTRICTION_CONDITION.test(condition)
      || SOURCE_STATE_DEFINITION_CONDITION.test(condition)
      || FORMULATION_TRANSFORMATION_CONDITION.test(condition)
      || PAPER_OWNED_MODELING_OPERATION_CONDITION.test(condition)
      || PAPER_OWNED_MECHANISM_OPERATION_CONDITION.test(condition)
      || explicitLocalVariantCondition(condition));
}

function normalizedConditionSentence(value) {
  return authoredEnglish(value)
    // Running journal page numbers can be flattened directly in front of the
    // first proposition on a page.  Strip only a standalone 2–4 digit prefix
    // followed by an unmistakable premise opener; the remaining proposition
    // is still a contiguous literal source span.
    .replace(/^\d{2,4}\s+(?=(?:Assume|Given|If|In|Since|Suppose|Under|We|When)\b)/u, "");
}

function explicitAssumptionClause(value) {
  const text = authoredEnglish(value);
  const match = text.match(/\b(we\s+assume\b[^.;]{8,240}?)(?=\s+and\s+(?:defer|postpone|leave)\b|[.;]|$)/i);
  if (!match) return "";
  const clause = authoredEnglish(match[1]);
  return clause && clause.split(/\s+/).length >= 6 ? `${clause.replace(/[,:;.]$/, "")}.` : "";
}

function componentConditionFocus(component) {
  return [
    component?.label,
    component?.explanation,
    component?.formal,
    ...(component?.searchPhrases || []),
    ...(component?.symbols || []).flatMap((symbol) => [symbol?.symbol, symbol?.meaning]),
    ...(component?.sources || []).flatMap((source) => [source?.section, source?.quote])
  ].filter(Boolean).join(" ");
}

function componentConditionLocalText(component, { includeSources = true, conditionIndex = -1 } = {}) {
  // Binding prose may support only the conditions it actually references.
  // Including every generated binding here lets an unrelated condition
  // support itself during the first mapping pass even though the release gate
  // correctly ignores that binding for this condition index.
  const bindings = Number.isInteger(conditionIndex) && conditionIndex >= 0
    ? (Array.isArray(component?.conceptBindings) ? component.conceptBindings : [])
      .filter((binding) => Array.isArray(binding?.conditionRefs)
        && binding.conditionRefs.includes(conditionIndex))
    : [];
  return [
    component?.role,
    ...(Array.isArray(component?.concepts) ? component.concepts : []),
    component?.label,
    component?.explanation,
    component?.formal,
    ...(Array.isArray(component?.searchPhrases) ? component.searchPhrases : []),
    ...(Array.isArray(component?.symbols)
      ? component.symbols.flatMap((symbol) => [symbol?.symbol, symbol?.meaning])
      : []),
    ...(includeSources && Array.isArray(component?.sources)
      ? component.sources.flatMap((source) => [source?.section, source?.equation, source?.quote])
      : []),
    ...bindings.flatMap((binding) => [binding?.conceptId, binding?.representation])
  ].filter(Boolean).join(" ");
}

function locallyApplicableCondition(component, condition, { includeSources = true, conditionIndex = -1 } = {}) {
  return substantiveSourceCondition(condition)
    && (hasConditionLocalityOverlap(componentConditionLocalText(component, { includeSources, conditionIndex }), condition)
      || VARIANT_LOCAL_INVARIANT_CONDITION.test(condition));
}

function conditionsFrom(section, record, focus, pageNumber = 0, pages = []) {
  // The normalized section lines and the heading-bounded source lines are
  // complementary. Multi-column PDFs can drop alternating clauses from the
  // former, while the latter can retain a clean literal premise. Treat them as
  // separate candidate streams so joining them cannot manufacture a sentence.
  const eligible = (sentence, { requireFocus = true } = {}) => {
    if (!readableProse(sentence)) return false;
    if (hasSourceTextNoise(sentence)) return false;
    // Conditions are especially vulnerable to PDF display-math splices: the
    // text before and after an equation can be joined into one grammatical-
    // looking sentence after the display rows are removed.  Use the stricter
    // release filter here and reject a second, capitalized premise opener that
    // appears without sentence punctuation (for example, `... that Given ...`).
    if (formulaContaminatedProse(sentence, section.sourceLines || section.lines, { conservative: true })) return false;
    // A condition must begin at a sentence boundary. Lowercase page/column
    // continuations such as `out loss of generality, we assume ...` or
    // `cess probabilities ... provided that ...` are literal extraction spans
    // but not complete propositions.
    if (/^\p{Ll}{3}/u.test(sentence)) return false;
    const sectionTitle = cleanText(section.title).replace(/^\d+(?:\.\d+)*\.?\s+/, "").toLowerCase();
    const withoutNumber = cleanText(sentence).replace(/^\d+(?:\.\d+)*\.?\s+/, "").toLowerCase();
    // Page-level sentence recovery can flatten the section heading directly
    // into its first prose line. That string is literal, but the heading is
    // not part of the proposition and must not survive as a model condition.
    if (sectionTitle && withoutNumber.startsWith(`${sectionTitle} `)) return false;
    const proseWithoutAbbreviations = sentence.replace(/\b(?:e\.g|i\.e|etc|vs|et\s+al)\./giu, "ABBREVIATION");
    if (/[.!?]\s+\p{Ll}{3}/u.test(proseWithoutAbbreviations)) return false;
    if (/[\p{Ll})\]]\s+(?:Given|Suppose|Assume|Let)\b/u.test(sentence)) return false;
    if (/\b(?:is|are|was|were|be|been|the|a|an|and|or|of|for|with|by|to|in|on|under|where|which)\s*[.]?$/i.test(sentence)) return false;
    if ((organizationProse(sentence) && !explicitLocalVariantCondition(sentence))
      || displayOrResultOnlyProse(sentence) || /\b(?:remainder|rest) of (?:this|the) paper\b/i.test(sentence)) return false;
    if (/^(?:theorem|lemma|proposition|corollary|proof)\b/i.test(sentence)) return false;
    if (/[.!?]\s+\((?:i{1,4}|v|vi|[a-z])\)\s+(?=[A-Z])/i.test(sentence)) return false;
    if (/\/equals|\/radical|[∑∫]/.test(sentence)) return false;
    if ((sentence.match(/[A-Za-z]{3,}/g)?.length || 0) < 6) return false;
    if (sentence.split(/\s+/).length > 48) return false;
    if (!sourceModelsCondition(sentence)) return false;
    return !requireFocus || hasSourceOverlap(focus, sentence);
  };
  const literalSpanSentences = distinct(sentenceList(sectionSourceTextOnPage(section, pageNumber))
    .map(normalizedConditionSentence)
    .flatMap((sentence) => distinct([explicitAssumptionClause(sentence), sentence]).filter(Boolean)));
  const focusAnchor = literalSpanSentences
    .map((sentence, index) => ({ index, score: overlapScore(focus, sentence) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];
  const literalSpanConditions = literalSpanSentences
    .filter((sentence, index) => eligible(sentence, { requireFocus: false })
      && (hasConditionLocalityOverlap(focus, sentence)
        || (focusAnchor?.score > 0 && index >= focusAnchor.index - 1 && index <= focusAnchor.index + 2)));
  const invariantConditions = distinct([
    sectionSourceTextOnPage(section, pageNumber),
    section.sourceText,
    section.text
  ].flatMap((value) => {
    const dehyphenated = cleanText(value).replace(/([\p{L}])-\s+(?=[\p{Ll}])/gu, "$1");
    return [...dehyphenated.matchAll(/\bWe\s+continue\s+to\s+use\s+the\s+same\s+(?:timing|sequence|information\s+structure|assumptions?)\b[^.!?]{0,180}[.!?]/giu)]
      .map((match) => authoredEnglish(match[0]))
      .filter((condition) => VARIANT_LOCAL_INVARIANT_CONDITION.test(condition)
        && sourceModelsCondition(condition));
  }));
  const withInvariants = (conditions) => distinct([...conditions, ...invariantConditions], 3);
  // Prefer the heading-bounded source stream whenever it yields a usable
  // proposition. The normalized multi-column stream is a recovery fallback:
  // merging it into an already-good literal stream can reintroduce table rows
  // or splice halves of neighboring columns into a second, corrupted copy of
  // an otherwise clean condition.
  // Some two-column PDFs corrupt the heading-bounded line order while the raw
  // page still contains an intact sentence. Recover only raw-page sentences
  // whose semantic tokens are overwhelmingly present in this section's local
  // source span. This admits a clean literal proposition without opening the
  // page to a neighboring column or manufacturing text from normalized lines.
  const rawPage = (pages || []).find((page) => Number(page?.page) === Number(pageNumber));
  const localSectionText = sectionSourceTextOnPage(section, pageNumber);
  if (rawPage && localSectionText) {
    const localTokens = new Set(sourceSemanticTokens(localSectionText));
    const pageLiteralConditions = literalSourceSentenceCandidates(rawPage.text, { minWords: 6, maxWords: 90 })
      .map(normalizedConditionSentence)
      .flatMap((sentence) => distinct([explicitAssumptionClause(sentence), sentence]).filter(Boolean))
      .filter((candidate) => eligible(candidate, { requireFocus: false }))
      .filter((candidate) => {
        const tokens = sourceSemanticTokens(candidate);
        if (tokens.length < 5) return false;
        const supported = tokens.filter((token) => localTokens.has(token)).length;
        return supported / tokens.length >= 0.8;
      });
    if (pageLiteralConditions.length) {
      return withInvariants([...literalSpanConditions, ...pageLiteralConditions]);
    }
  }
  if (literalSpanConditions.length) return withInvariants(literalSpanConditions);
  return withInvariants(distinct(sentenceList(sectionTextOnPage(section, pageNumber)).map(normalizedConditionSentence))
    .filter(eligible)
    .slice(0, 3));
}

function conceptsFor(value, role, availableConceptIds) {
  const matches = [];
  for (const [id, pattern] of CONCEPT_RULES) {
    if (availableConceptIds.has(id) && pattern.test(value)) matches.push(id);
  }
  const fallback = ROLE_DEFAULT_CONCEPT[role];
  if (fallback && availableConceptIds.has(fallback)) matches.push(fallback);
  return distinct(matches, 3);
}

function literalSourcePage(pages, quote, focus, pageNumber = 0, options = {}) {
  if (!quote || !readableProse(quote) || organizationProse(quote)
    || !componentSourceSentence(quote, options.componentRole)
    || !hasSourceOverlap(focus, quote)) return null;
  return pages.find((entry) => (!pageNumber || Number(entry.page) === Number(pageNumber))
    && remapNormalizedSourceQuote(quote, entry.text)) || null;
}

function literalSourceRecord(page, section, equation, quote) {
  const literalQuote = page ? remapNormalizedSourceQuote(quote, page.text) : "";
  if (!literalQuote) return null;
  return {
    page: Number(page.page) || 1,
    section,
    equation,
    quote: literalQuote
  };
}

function withoutInlineHeadingLead(value) {
  const text = cleanText(value);
  // Some older PDFs flatten an unnumbered title directly into its opening
  // sentence (`Salvage Value Here, we consider ...`). Restrict recovery to the
  // explicit "Here," discourse boundary so ordinary capitalized subjects are
  // never trimmed as headings.
  return text.replace(/^(?:[A-Z][\p{L}'’&-]*\s+){1,6}(?=Here,\s+(?:we|the)\b)/u, "");
}

function preferredLiteralClausePrefixes(value) {
  const text = cleanText(value);
  if (!text) return [];
  // Preserve only a complete leading modeling clause before a discourse
  // continuation. This is intentionally narrower than general sentence
  // splitting: the caller still requires a literal raw-page remap, local
  // section membership, role support, and a substantive model condition.
  const boundaries = [...text.matchAll(/[,;:–—]\s+/gu)].map((match) => match.index);
  return distinct(boundaries
    .map((index) => authoredEnglish(text.slice(0, index).replace(/[,;:–—]+$/u, "")))
    .filter((candidate) => {
      const words = candidate.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
      return words.length >= 6 && words.length <= 72
        && !/\b(?:and|or|but|because|if|when|while|with|to|of|for|the|a|an)$/iu.test(candidate);
    }))
    .sort((left, right) => right.length - left.length);
}

export function sourceFor(pages, section, focus, equation = "", options = {}) {
  const sectionLabel = authoredEnglish(section.number ? `${section.number}. ${section.title}` : section.title) || "Model formulation";
  if (sourceHeadingRejectionReason(sectionLabel)) return null;
  const sectionPages = pages
    .filter((entry) => Number(entry.page) >= Number(section.page) && Number(entry.page) <= Number(section.endPage ?? section.page))
    .sort((left, right) => Number(left.page) - Number(right.page));
  const preferred = sectionPages.find((entry) => Number(entry.page) === Number(section.page)) || sectionPages[0];
  const sourceSentence = cleanText(section.sourceSentence || "");
  const sourceFocus = focus || section.text;
  const preferredQuote = cleanText(options.preferredQuote || "");
  const sectionTitle = authoredEnglish(section.title);
  const preferredLiteral = sectionPages.flatMap((page) => literalSourceSentenceCandidates(page.text, { minWords: 6, maxWords: 90 })
    .flatMap((quote) => {
      const normalized = cleanText(quote);
      const withoutHeading = sectionTitle && normalized.startsWith(`${sectionTitle} `)
        ? normalized.slice(sectionTitle.length).trim()
        : "";
      return distinct([normalized, withoutHeading, withoutInlineHeadingLead(normalized)])
        .map((candidate) => ({ page, quote: candidate }));
    }))
    .find((entry) => cleanText(entry.quote) === preferredQuote
      && componentSourceSentence(entry.quote, options.componentRole)
      && !formulaContaminatedProse(entry.quote, entry.page.text)
      && sectionSourceTextOnPage(section, entry.page.page).includes(cleanText(entry.quote))
      && hasSourceOverlap(sourceFocus, entry.quote));
  if (preferredLiteral) {
    return literalSourceRecord(preferredLiteral.page, sectionLabel, equation, preferredLiteral.quote);
  }
  // Some equations or indexed controls inside an otherwise grammatical source
  // sentence make the atomic sentence scanner decline the span. A successful
  // normalized remap still proves that the complete preferred proposition is
  // contiguous on the raw PDF page, so retain it after the same prose, role,
  // locality, and formula-contamination gates used above.
  const preferredRemapped = sectionPages
    .map((page) => ({ page, quote: remapNormalizedSourceQuote(preferredQuote, page.text) }))
    .find((entry) => entry.quote
      && readableProse(entry.quote)
      && componentSourceSentence(entry.quote, options.componentRole)
      && !formulaContaminatedProse(entry.quote, entry.page.text)
      && sectionSourceTextOnPage(section, entry.page.page).includes(cleanText(preferredQuote))
      && hasSourceOverlap(sourceFocus, entry.quote));
  if (preferredRemapped) {
    return literalSourceRecord(preferredRemapped.page, sectionLabel, equation, preferredRemapped.quote);
  }
  // The preferred sentence may end in a PDF word split that cannot be quoted
  // literally (`sim- ilar`) even though its leading model declaration is an
  // intact, self-contained clause. Recover only that exact leading clause as
  // component evidence; it still cannot become a release condition without
  // terminal punctuation. Never dehyphenate or synthesize the damaged tail.
  const preferredClause = preferredLiteralClausePrefixes(preferredQuote)
    .flatMap((quote) => sectionPages.map((page) => ({
      page,
      quote,
      literal: remapNormalizedSourceQuote(quote, page.text)
    })))
    .find((entry) => entry.literal
      && readableProse(entry.literal)
      && componentSourceSentence(entry.literal, options.componentRole)
      && authoredConditionHasPredicate(entry.literal)
      && !formulaContaminatedProse(entry.literal, entry.page.text)
      && sectionSourceTextOnPage(section, entry.page.page).includes(cleanText(entry.quote))
      && hasSourceOverlap(sourceFocus, entry.literal));
  if (preferredClause) {
    return literalSourceRecord(preferredClause.page, sectionLabel, equation, preferredClause.literal);
  }
  const selected = selectSectionSource(pages, section, sourceFocus);
  const selectedPage = literalSourcePage(pages, selected?.quote, sourceFocus, selected?.page, options);
  if (selectedPage && !formulaContaminatedProse(selected.quote, selectedPage.text)) {
    return literalSourceRecord(selectedPage, sectionLabel, equation, selected.quote);
  }
  const sourceSentencePage = sectionPages.find((entry) => sourceSentence
    && readableProse(sourceSentence)
    && !organizationProse(sourceSentence)
    && componentSourceSentence(sourceSentence, options.componentRole)
    && !formulaContaminatedProse(sourceSentence, entry.text)
    && cleanText(entry.text).includes(sourceSentence)
    && hasSourceOverlap(sourceFocus, sourceSentence));
  if (sourceSentencePage) {
    return literalSourceRecord(sourceSentencePage, sectionLabel, equation, sourceSentence);
  }
  for (const page of [preferred, ...sectionPages.filter((entry) => entry !== preferred)].filter(Boolean)) {
    const quote = pageQuote(page.text, sourceFocus, options);
    const localSectionText = sectionSourceTextOnPage(section, page.page);
    if (!quote || !localSectionText.includes(cleanText(quote))
      || !literalSourcePage(pages, quote, sourceFocus, page.page, options)) continue;
    return literalSourceRecord(page, sectionLabel, equation, quote);
  }
  return null;
}

function componentId(label, used) {
  const base = slug(label);
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) candidate = `${base}-${index++}`;
  used.add(candidate);
  return candidate;
}

function searchPhrases(label, role, record) {
  const topic = [record.primary_topic, record.model_topic, record.title]
    .map(authoredEnglish)
    .find((value) => value && !hasExtractionNoise(value) && !organizationProse(value)
      && !isBoilerplate(value) && !isCaption(value) && !isCitation(value) && !isTableRow(value)) || "the paper's model";
  const authoredLabel = authoredEnglish(label);
  const safeLabel = authoredLabel && !hasExtractionNoise(authoredLabel) && !organizationProse(authoredLabel)
    && !isBoilerplate(authoredLabel) && !isCaption(authoredLabel) && !isCitation(authoredLabel) && !isTableRow(authoredLabel)
    && !/^(?:algorithm|figure|table|exhibit)\s+[A-Z]?\d+\b/i.test(authoredLabel)
    ? authoredLabel
    : `${role} component`;
  const candidates = [
    `how ${safeLabel.toLowerCase()} is represented`,
    `${ROLE_QUERY[role]} in ${topic.toLowerCase()}`,
    `${safeLabel.toLowerCase()} ${ROLE_QUERY[role]} specification`,
    `${safeLabel.toLowerCase()} model specification`,
    `${topic.toLowerCase()} ${role} evidence`
  ];
  return distinct(candidates.filter((value) => !hasExtractionNoise(value) && !organizationProse(value)
    && !isBoilerplate(value) && !isCaption(value) && !isCitation(value) && !isTableRow(value)), 3);
}

function attachAutomatedRelevance(component, conceptDefinitions) {
  const mapped = mapComponentRelevance({
    title: component.label,
    text: component.explanation,
    role: component.role,
    conceptDefinitions,
    conditions: component.conditions,
    symbols: component.symbols,
    sources: component.sources,
    maxConcepts: 3
  });
  component.concepts = mapped.concepts;
  component.conceptBindings = mapped.conceptBindings.map((binding) => ({
    ...binding,
    representation: normalizeAuthoredDisplayProse(binding.representation)
  }));
  return component;
}

function reviewedAnchorPages(record, pages) {
  const source = [record.modeling_evidence, ...(record.evidence_detail || [])].filter(Boolean).join(" ");
  const found = [];
  for (const match of source.matchAll(/\bPDF\s+p(?:p)?\.\s*(\d{1,4})(?:\s*[–-]\s*(\d{1,4}))?/gi)) {
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    for (let page = start; page <= Math.min(end, start + 8); page += 1) {
      if (pages.some((entry) => Number(entry.page) === page)) found.push(page);
    }
  }
  return [...new Set(found)];
}

function mergeReviewedAnchors(record, pages, allSections, existingComponents, conceptDefinitions) {
  const evidence = authoredEnglish(record.modeling_evidence || record.evidence_detail?.[0] || "");
  if (!evidence || /^the scope review identified/i.test(evidence) || !existingComponents.length) return existingComponents;
  for (const pageNumber of reviewedAnchorPages(record, pages)) {
    if (existingComponents.some((component) => component.sources.some((source) => source.page === pageNumber))) continue;
    const sourcePage = pages.find((entry) => Number(entry.page) === pageNumber);
    if (!sourcePage) continue;
    const ranked = existingComponents.map((component) => ({
      component,
      score: overlapScore(evidence, `${component.label} ${component.explanation}`)
    })).sort((left, right) => right.score - left.score || left.component.id.localeCompare(right.component.id));
    const target = ranked[0]?.component;
    if (!target || ranked[0].score <= 0) continue;
    const section = allSections.find((entry) => entry.page <= pageNumber && entry.endPage >= pageNumber);
    if (!section) continue;
    const sourceSection = authoredEnglish(section.number ? `${section.number}. ${section.title}` : section.title);
    if (sourceHeadingRejectionReason(sourceSection)) continue;
    const localFocus = [
      target.label,
      target.explanation,
      target.formal,
      ...(target.conditions || []),
      ...(target.symbols || []).map((symbol) => symbol?.meaning)
    ].filter(Boolean).join(" ");
    const quote = pageQuote(sourcePage.text, localFocus, { componentRole: target.role });
    if (!quote || !hasSourceOverlap(localFocus, quote)) continue;
    const theoremLabel = evidence.match(/\b(?:Theorem|Proposition|Lemma|Corollary|Algorithm|Assumption)\s+[A-Z]?(?:\d+(?:\.\d+)*)\b/i)?.[0] || "";
    target.sources.push({
      page: pageNumber,
      section: sourceSection,
      equation: theoremLabel,
      quote
    });
    attachAutomatedRelevance(target, conceptDefinitions);
  }
  return existingComponents;
}

const ROLE_SENTENCE_CUES = Object.freeze({
  decision: /\b(?:decision|choos(?:e|es|ing)|decid(?:e|es|ing)|set(?:s|ting)?|select(?:s|ing)?|allocat(?:e|es|ing)|assign(?:s|ing)?|order(?:s|ing)?|pric(?:e|es|ing)|offer(?:s|ing)?|invest(?:s|ing)?|control(?:s|ling)?|disclos(?:e|es|ed|ing)|saniti[sz](?:e|es|ed|ing|ation))\b/i,
  state: /\b(?:state|inventory level|queue length|remaining|stock|balance)\b/i,
  process: /\b(?:arriv(?:e|es|al)|depart(?:s|ure)?|transition|evolv(?:e|es)|dynamics?|update(?:s)?|output|flows?|process(?:es)?|propagat(?:e|es|ed|ing)|random[-\s]+walks?|iterat(?:e|es|ed|ing|ion)|adaptation|accommodat(?:e|es|ed|ing))\b|\bmodel(?:ing)?\s+framework\b|\bproceed(?:s|ed|ing)?\s+at\s+(?:time(?:\s*-\s*|\s+)dependent|constant|variable)\s+rates?\b|\btracks?\b[^.!?]{0,120}\b(?:over|by)\s+time\b/i,
  preference: /\b(?:utility|valuation|preference|choice (?:probability|function|model)|demand|goods?\s+(?:are|is)\s+(?:a\s+)?substitutes?|substitute\s+goods?)\b/i,
  constraint: /\b(?:constraint|subject to|feasible|capacity|budget|cannot|must not|limited)\b/i,
  information: /\b(?:observ(?:e|es|ed|ing|ation|able)|infer(?:s|red|ring|ence)?|know(?:s|n)?|signal|information|belief|monitor(?:s|ed|ing)?|verif(?:y|ies|ied|iable)|uncertain|unknown|defin(?:e|es|ed|ing)|denot(?:e|es|ed|ing)|represent(?:s|ed|ing)?)\b/i,
  interaction: /\b(?:equilibrium|best response|compete|strategic|bargain|contract|auction|client|vendor|buyer|seller|platform)\b/i,
  objective: /\b(?:objective|optimi[sz](?:e|es|ation)|maximi[sz](?:e|es)|minimi[sz](?:e|es)|profit|cost|welfare|payoff|net value|first[ -]best)\b/i,
  estimation: /\b(?:estimat(?:e|es|or)|identify|likelihood|regression|inference|fit(?:s)?|moment|data)\b/i,
  algorithm: /\b(?:algorithm|procedure|iterate|update rule|dynamic program|decomposition|heuristic|policy|solve(?:s)?|simulat(?:e|es|ed|ing|ion))\b/i
});

function roleAlignedComponentSentence(sentence, role, title) {
  if (role === "objective") {
    const objectiveHeading = /\b(?:cost|objective|net value|profit|utility|welfare|optimization)\b/i.test(title);
    return !objectiveHeading || ROLE_SENTENCE_CUES.objective.test(sentence);
  }
  if (role === "constraint" && /\bconstraints?\b/i.test(title)) {
    return /\b(?:constraints?|subject\s+to|cap(?:ped)?\s+on|limited\s+(?:by|to)|cannot|must|restrict(?:ed|s|ion)|stockpile|capacity|budget)\b/i.test(sentence);
  }
  return true;
}

function literalComponentSentences(section, pages, role) {
  const title = authoredEnglish(section.title);
  const results = [];
  for (const page of pages) {
    if (Number(page.page) < Number(section.page) || Number(page.page) > Number(section.endPage ?? section.page)) continue;
    const localText = sectionSourceTextOnPage(section, page.page);
    if (!localText) continue;
    for (const rawQuote of literalSourceSentenceCandidates(page.text, { minWords: 5, maxWords: 90 })) {
      const headingTrimmed = title && cleanText(rawQuote).startsWith(`${title} `)
        ? cleanText(rawQuote).slice(title.length).trim()
        : rawQuote;
      const quote = withoutInlineHeadingLead(headingTrimmed);
      if (!localText.includes(cleanText(quote)) || !readableProse(quote)
        || formulaContaminatedProse(quote, page.text)
        || (organizationProse(quote) && !explicitLocalVariantCondition(quote))
        || displayOrResultOnlyProse(quote)
        || !componentSourceSentence(quote, role)
        || !roleAlignedComponentSentence(quote, role, title)) continue;
      results.push(quote);
    }
  }
  const atomic = distinct(results);
  return atomic.filter((candidate) => !atomic.some((suffix) => {
    if (suffix === candidate || !candidate.endsWith(suffix)) return false;
    const prefix = candidate.slice(0, candidate.length - suffix.length).trim();
    const prefixWords = prefix.split(/\s+/).filter(Boolean);
    if (prefixWords.length < 2 || prefixWords.length > 12) return false;
    const headingWords = prefixWords.filter((word) => /^(?:[A-Z][\p{L}'’&-]*|and|or|of|on|the|for|with)$/u.test(word)).length;
    return headingWords / prefixWords.length >= 0.7;
  }));
}

// A displayed equation can be fused into the same extracted sentence as the
// prose that introduces its model primitive.  Recover only a narrow, contiguous
// declaration ending before the display introducer.  The returned text must be
// present both in the heading-bounded section span and on the cited raw page;
// the equation itself remains excluded unless separately verified.
function literalModelingDeclarationFragments(section, pages, role) {
  if (role !== "preference") return [];
  const output = [];
  const pattern = /\b(?:we|the\s+(?:paper|model|analysis))\s+(?:consider|adopt|use|specify|formulate|model)\w*\s+(?:a|an|the)\s+(?:(?:[\p{L}'’–-]+\s+){0,4})?(?:demand\s+(?:system|function|specification)|utility\s+(?:function|model)|choice\s+(?:function|model))\b(?:\s+(?:frequently|commonly)\s+used\s+in\s+the\s+literature(?:\s+\([^)]{1,80}\))?)?/giu;
  for (const page of pages) {
    if (Number(page.page) < Number(section.page) || Number(page.page) > Number(section.endPage ?? section.page)) continue;
    const localText = sectionSourceTextOnPage(section, page.page);
    if (!localText) continue;
    for (const match of cleanText(localText).matchAll(pattern)) {
      const candidate = cleanText(match[0]);
      const literal = remapNormalizedSourceQuote(candidate, page.text);
      if (!literal || !cleanText(localText).includes(candidate)
        || !readableProse(literal)
        || formulaContaminatedProse(literal, page.text)
        || organizationProse(literal)
        || displayOrResultOnlyProse(literal)
        || !componentSourceSentence(literal, role)
        || !sourceSupportsRole(role, literal)) continue;
      output.push(literal);
    }
  }
  return distinct(output);
}

// A local relaxation can state its defining restriction before a second,
// formula-bearing clause in the same printed sentence. Two-column extraction
// may splice the continuation with the neighboring column even though the
// leading restriction is an intact raw-page span. Recover only that complete
// authorial prefix, ending immediately before `we assume`; it must remain
// literal on the page, local to the heading-bounded section, and independently
// pass the ordinary role, condition, result, formula, and noise gates.
//
// The literal prefix ends immediately before the source comma, so it is valid
// evidence but not itself a release-ready condition. Materialize the condition
// by adding only terminal punctuation. This preserves the exact source quote,
// keeps the complete-proposition gate intact, and never admits the damaged
// formula-bearing continuation.
function materializedVariantRestrictionCondition(value) {
  const literal = authoredEnglish(value);
  if (!/^In\s+particular,?\s+we\s+ignore\b[^.!?]{0,260}\binfluence\b/iu.test(literal)
    || /[.!?]\s*$/u.test(literal)) return "";
  const materialized = `${literal.replace(/[,;:]\s*$/u, "")}.`;
  return explicitLocalVariantCondition(materialized) && substantiveSourceCondition(materialized)
    ? materialized
    : "";
}

function conditionBearingComponentSource(value) {
  return sourceModelsCondition(value) || Boolean(materializedVariantRestrictionCondition(value));
}

function literalVariantRestrictionFragments(section, pages, role) {
  if (role !== "constraint") return [];
  const output = [];
  const pattern = /\bIn\s+particular,\s+we\s+ignore\b[^.!?]{8,260}?(?=,\s+we\s+(?:now\s+)?assume\b)/giu;
  for (const page of pages) {
    if (Number(page.page) < Number(section.page) || Number(page.page) > Number(section.endPage ?? section.page)) continue;
    const localText = sectionSourceTextOnPage(section, page.page);
    if (!localText) continue;
    const localTokens = new Set(sourceSemanticTokens(localText));
    for (const match of cleanText(page.text).matchAll(pattern)) {
      const candidate = cleanText(match[0]);
      const candidateTokens = sourceSemanticTokens(candidate);
      const locallySupported = candidateTokens.length >= 6
        && candidateTokens.filter((token) => localTokens.has(token)).length / candidateTokens.length >= 0.8;
      const literal = locallySupported ? remapNormalizedSourceQuote(candidate, page.text) : "";
      if (!literal
        || !readableProse(literal)
        || formulaContaminatedProse(literal, page.text)
        || organizationProse(literal)
        || displayOrResultOnlyProse(literal)
        || conditionResultOrContributionProse(literal)
        || !componentSourceSentence(literal, role)
        || !sourceSupportsRole(role, literal)
        || !conditionBearingComponentSource(literal)) continue;
      output.push(literal);
    }
  }
  return distinct(output);
}

export function rankedComponentSentences(section, pages, role, record, options = {}) {
  const title = authoredEnglish(section.title);
  const paperFocus = [record.model_topic, record.primary_topic, record.abstract].filter(Boolean).join(" ");
  const literalCandidates = literalComponentSentences(section, pages, role);
  const modelingDeclarations = literalModelingDeclarationFragments(section, pages, role);
  const variantRestrictions = literalVariantRestrictionFragments(section, pages, role);
  // Source spans preserve sentences that cross physical PDF line breaks even
  // when the page-level candidate splitter sees a soft-hyphen fragment. Every
  // ranked candidate is still revalidated by sourceFor against the actual page
  // before it can become a quote, so this improves recall without relaxing
  // literal provenance or allowing a neighboring section to leak in.
  const sourceSpanCandidates = sentenceList(section.sourceText || "");
  const candidates = distinct([
    ...variantRestrictions,
    ...modelingDeclarations,
    ...literalCandidates,
    ...sourceSpanCandidates,
    ...(!literalCandidates.length && !sourceSpanCandidates.length ? sentenceList(section.text) : [])
  ])
    .filter(readableProse)
    .filter((sentence) => !formulaContaminatedProse(sentence, section.sourceLines || section.lines))
    .filter((sentence) => (!organizationProse(sentence) || explicitLocalVariantCondition(sentence))
      && !displayOrResultOnlyProse(sentence))
    .filter((sentence) => componentSourceSentence(sentence, role))
    .filter((sentence) => roleAlignedComponentSentence(sentence, role, title));
  return candidates.map((sentence, index) => {
    const wordCount = sentence.split(/\s+/).filter(Boolean).length;
    const roleMatch = ROLE_SENTENCE_CUES[role]?.test(sentence) ? 12 : 0;
    const roleSourceMatch = sourceSupportsRole(role, sentence) ? 40 : 0;
    const competingSourceRole = roleFor("", sentence);
    const competingRolePenalty = !roleSourceMatch && competingSourceRole !== role
      && sourceSupportsRole(competingSourceRole, sentence) ? 14 : 0;
    const modelMatch = modelBearingProse(sentence) ? 8 : 0;
    const titleMatch = Math.min(8, overlapScore(title, sentence) * 2);
    const paperMatch = Math.min(6, overlapScore(paperFocus, sentence));
    const definition = /\b(?:we (?:define|denote|use|consider|assume|provide|present|propose|develop|introduce|formali[sz]e|characterize|specify|refer\s+to)|let\b|is defined as|represents?|denotes?|refers?\s+to|interpretation of .{1,30}\bis|by\s+[“"']?[^,;]{1,36}[”"']?,?\s+we\s+mean)\b/i.test(sentence) ? 7 : 0;
    const earlySectionBonus = Math.max(0, 10 - index * 2);
    const namedBaselineBonus = /\bfirst[ -]best\b/i.test(title) && /^(?:the\s+)?FB\s+(?:setting|scenario)|\bideal case\b|\bsingle firm\b/i.test(sentence) ? 18 : 0;
    const specificTitleBonus = overlapScore(title, sentence) > 0 ? 10 : 0;
    const paperOwned = /\b(?:we\s+(?:define|consider|model|assume|let|formulate|formali[sz]e|propose|develop|introduce|choose|set|minimi[sz]e|maximi[sz]e|provide|present|characterize|specify)|our\s+(?:model|formulation|objective|decision)|the\s+(?:model|formulation|decision maker|firm|platform|planner|seller|buyer|client|vendor|station|BSS|manager|retailer)\s+(?:defines?|assumes?|models?|considers?|formulates?|chooses?|sets?|controls?|minimi[sz]es?|maximi[sz]es?|increases?|reduces?|responds?|exerts?|determines?))\b/i.test(sentence) ? 8 : 0;
    const paperOwnedModelConstructionBonus = /\bwe\s+(?:propose|develop|introduce|formali[sz]e)\b[^.!?]{0,100}\b(?:model|modeling\s+framework|framework|method|algorithm|random[-\s]+walk|HGRW)\b/i.test(sentence) ? 32 : 0;
    const paperOwnedDefinitionBonus = /^here,?\s+we\s+(?:consider|define|model|assume|formulate|specify)\b/i.test(sentence) ? 50 : 0;
    // For an explicitly planned nonbaseline formulation, prefer a literal
    // sentence that can itself serve as the component's local condition. This
    // is only a ranking tie-break/bonus: the selected sentence must still pass
    // the same role, source-literal, formula, and semantic gates below.
    const conditionedSourceBonus = options.preferConditionedSource && conditionBearingComponentSource(sentence) ? 70 : 0;
    const formalProcessDefinitionBonus = role === "process"
      && FORMAL_PROCESS_DEFINITION_CONDITION.test(sentence) ? 55 : 0;
    const thirdPartyPenalty = /^(?:[A-Z][\p{L}'’.-]+(?:\s+et\s+al\.)?\s*\(\d{4}[a-z]?\)|unlike\s+prior\s+work)\b/u.test(sentence) ? 10 : 0;
    const resultPenalty = resultAssertionProse(sentence) || /\b(?:our results|numerical results|managerial insight)\b/i.test(sentence) ? 12 : 0;
    const consequencePenalty = /^(?:hence|therefore|thus|consequently|as a result|on the other hand)\b/i.test(sentence) ? 6 : 0;
    const variantHeading = /\b(?:extension|alternative|benchmark|counterfactual|variant|regime|with(?:out)?|observable|unobservable)\b/i.test(title);
    const explicitVariantChange = /\b(?:relax(?:es|ed|ing)?|instead|does?\s+not|without|replac(?:e|es|ed|ing)|differ(?:s|ed|ent)?|allow(?:s|ed|ing)?|no\s+longer|counterfactual)\b/i.test(sentence)
      || explicitLocalVariantCondition(sentence);
    const variantDeltaBonus = explicitLocalVariantCondition(sentence)
      ? 55
      : variantHeading && explicitVariantChange ? 40
      : variantHeading && /\b(?:not\s+observable|unobservable)\b/i.test(sentence) ? 12 : 0;
    const previousBaselinePenalty = variantHeading
      && /^(?:in\s+the\s+previous\s+(?:discussion|model|section)|the\s+(?:baseline|main)\s+model\s+assumes?)\b/i.test(sentence)
      ? 14 : 0;
    const parameterDefinitionBonus = /\b(?:input parameters?|parameters?|primitives?|notation)\b/i.test(title)
      && /\b(?:denote|represent|refer to|interpretation|cost multiplier|valuation|state variable|control variable|decision variable|is the [a-z -]{0,30}(?:parameter|multiplier|rate|horizon))\b/i.test(sentence) ? 20 : 0;
    const outputMechanismBonus = /\boutput parameters?\b/i.test(title)
      && /\b(?:output (?:is|as|function|depends|evolves|increases)|Cobb[–-]Douglas|generate output|production function)\b/i.test(sentence) ? 24 : 0;
    const outputScalarPenalty = /\boutput parameters?\b/i.test(title)
      && /\b(?:interpretation of|refer to)\s+[A-Za-z][A-Za-z0-9*]*\b/i.test(sentence) ? 12 : 0;
    const optimalDecisionBonus = role === "decision"
      && /\boptimal\b/i.test(sentence)
      && /\b(?:payment|price|quantity|allocation|decision|policy|share|term|action)\b/i.test(sentence) ? 8 : 0;
    const decisionOutcomeBonus = role === "decision"
      && /\b(?:set(?:s|ting)?|choos(?:e|es|ing))\b.{0,100}\b(?:payment|price|quantity|allocation|policy|action|term)\b/i.test(sentence)
      && /\b(?:maximi[sz](?:e|es|ing)|minimi[sz](?:e|es|ing)|optimal)\b/i.test(sentence) ? 18 : 0;
    const conditionalDecisionSequenceBonus = /^(?:interaction|decision)$/.test(role)
      && /^(?:if|when)\b[^.!?]{8,240},\s+(?:then\s+)?[^.!?]{0,240}\b(?:decides?|chooses?|sets?|selects?|allocates?|assigns?)\b[^.!?]{0,180}\b(?:and|then)\b[^.!?]{0,180}\b(?:decides?|chooses?|sets?|selects?|allocates?|assigns?)\b/i.test(sentence)
      ? 50 : 0;
    const objectiveDefinitionBonus = role === "objective"
      && /\bobjective\b.{0,180}\b(?:maximi[sz]|minimi[sz]|optimi[sz])(?:e|es|ed|ing|ation)?\b/i.test(sentence) ? 30 : 0;
    // Prefer a paper's literal, declarative constraint definition over a
    // secondary availability assumption in the same constraint section. This
    // keeps the semantic anchor on what is capped while conditions can still
    // retain the rate or timing assumptions that qualify that cap.
    const explicitConstraintDefinitionBonus = role === "constraint"
      && /\b(?:the\s+)?(?:first|second|third)?\s*(?:such\s+)?constraint\s+is\s+(?:a|an|the)\s+(?:cap|limit|bound|restriction)\b/i.test(sentence)
      ? 60 : 0;
    // Formulation sections sometimes state their modeled choice only near the
    // end, after notation and recourse details. An explicit named model that
    // "decides" a local quantity is stronger decision evidence than generic
    // sentences about actors or feasible assignments earlier in the section.
    const namedFormulationDecisionBonus = role === "decision"
      && /\b\([A-Z][A-Z0-9_-]{1,12}\)\s+decides?\b[^.!?]{0,180}\b(?:level|quantity|amount|policy|schedule|allocation|assignment)s?\b/i.test(sentence)
      ? 60 : 0;
    const poolStructureBonus = role === "constraint"
      && /\b(?:one|disjoint|chained)\s+pools?\b/i.test(title)
      && /\b(?:share\s+one\s+nurse\s+pool|nurse\s+pools?\s+are\s+dis\s*joint|covered\s+by\s+two\s+nurse\s+pools?|pools?\s+form\s+a\s+(?:long\s+)?chain)\b/i.test(sentence) ? 55 : 0;
    const backwardMethodBonus = role === "algorithm"
      && /\b(?:solve\s+the\s+(?:game|model|problem)\s+backward|backward\s+induction|working\s+backward)\b/i.test(sentence) ? 55 : 0;
    const proceduralDerivationPenalty = /\b(?:first and second order conditions|present(?:ed)? in (?:theorem|lemma|proposition)|proof of (?:this|the) (?:theorem|lemma|proposition))\b/i.test(sentence) ? 10 : 0;
    const lengthPenalty = wordCount > 72 ? 8 : wordCount < 8 ? 5 : 0;
    return { sentence, index, score: roleMatch + roleSourceMatch + modelMatch + titleMatch + specificTitleBonus + paperMatch + definition + paperOwned + paperOwnedDefinitionBonus + paperOwnedModelConstructionBonus + formalProcessDefinitionBonus + conditionedSourceBonus + earlySectionBonus + namedBaselineBonus + parameterDefinitionBonus + outputMechanismBonus + optimalDecisionBonus + decisionOutcomeBonus + conditionalDecisionSequenceBonus + objectiveDefinitionBonus + explicitConstraintDefinitionBonus + namedFormulationDecisionBonus + poolStructureBonus + backwardMethodBonus + variantDeltaBonus - competingRolePenalty - thirdPartyPenalty - resultPenalty - consequencePenalty - previousBaselinePenalty - outputScalarPenalty - proceduralDerivationPenalty - lengthPenalty };
  }).sort((left, right) => right.score - left.score || left.index - right.index || left.sentence.length - right.sentence.length)
    .map((entry) => entry.sentence);
}

function completedComponentSectionHeading(inputSection) {
  let section = inputSection;
  const initialSourceText = authoredEnglish(section.sourceText || section.text);
  if (/[«»]/u.test(section.title) && /ε(?:\s*[-–]\s*DRFC|\s*∈\s*R)|\bepsilon(?:\s*[-–]\s*DRFC)?\b/i.test(initialSourceText)) {
    section = { ...section, title: authoredEnglish(section.title).replace(/[«»]/gu, "ε") };
  }
  const firstLine = authoredEnglish((section.sourceLines || section.lines || [])[0]?.text);
  const continuationWords = firstLine.split(/\s+/).filter(Boolean);
  const titleStyleContinuation = continuationWords.length >= 1 && continuationWords.length <= 5
    && !/[.!?;:]$/.test(firstLine)
    && continuationWords.every((word) => /^(?:[A-ZΕ][\p{L}\p{N}'’&-]*|\([a-z]{1,4}\)|and|or|of|with|vs\.?)$/u.test(word));
  // A printed algorithm can be followed by a Step/Action table. Those column
  // headers are source structure, not a continuation of the algorithm title.
  const algorithmTableHeader = /^Algorithm\s+[A-Z]?\d+$/i.test(authoredEnglish(section.title))
    && /^(?:Step|Action)$/i.test(firstLine);
  if (titleStyleContinuation && !algorithmTableHeader) {
    const combined = authoredEnglish(`${section.title} ${firstLine}`);
    const validationLabel = combined.replace(/\s+\([a-z]{1,4}\)/gu, "");
    if (!headingLabelRejectionReason(validationLabel)) {
      const stripContinuation = (value) => {
        const text = String(value || "").trimStart();
        return cleanText(text).startsWith(firstLine)
          ? text.slice(text.indexOf(firstLine) + firstLine.length).trimStart()
          : text;
      };
      section = {
        ...section,
        title: combined,
        text: stripContinuation(section.text),
        sourceText: stripContinuation(section.sourceText),
        lines: (section.lines || []).slice(1),
        sourceLines: (section.sourceLines || section.lines || []).slice(1)
      };
    }
  }
  return section;
}

function componentLabelForSection(title) {
  const sourceLabel = authoredEnglish(title).replace(/[:.]$/, "");
  // Short parenthesized network codes are source notation, not part of the
  // human-facing semantic label.  Keeping them in the source-section anchor
  // preserves provenance while stripping them here prevents lowercase math
  // tokens from making a genuine printed heading look like body prose.
  const withoutNetworkCodes = sourceLabel.replace(/\s+\([a-z]{1,4}\)/gu, "");
  if (/^the\s+winner\s+determination\s+problem$/i.test(withoutNetworkCodes)) {
    return "The Winner Determination Problem";
  }
  return authoredEnglish(withoutNetworkCodes);
}

export function roleQualifiedComponentLabel(label, paperTitle, role) {
  const cleanLabel = authoredEnglish(label);
  if (!cleanLabel
      || normalizedSourceSection(cleanLabel) !== normalizedSourceSection(paperTitle)) return cleanLabel;
  const qualifier = ({
    decision: "Decision Rule",
    state: "State Definition",
    process: "Process",
    information: "Information Structure",
    interaction: "Strategic Interaction",
    constraint: "Feasibility Conditions",
    objective: "Objective",
    preference: "Preferences",
    algorithm: "Algorithm",
    estimation: "Estimation"
  })[role] || "Model Component";
  // A paper's eponymous model section is a valid source anchor but the whole
  // paper title is not a useful component heading. Add only the semantic role
  // inferred from that section's own literal evidence.
  return `${cleanLabel}: ${qualifier}`;
}

export function sectionComponent(section, pages, record, conceptDefinitions, usedIds, options = {}) {
  section = completedComponentSectionHeading(section);
  let label = componentLabelForSection(section.title);
  if (!label || headingLabelRejectionReason(label)
      || NON_COMPONENT_REFERENCE_SECTION.test(label)) return null;
  if (options.formalEvidenceAllowed === false
      && (!safeModeSetupValue(label)
        || SAFE_MODE_AUTHOR_YEAR_HEADING.test(label)
        || SAFE_MODE_COMPONENT_HEADING_EXCLUSION.test(label)
        || SAFE_MODE_SECTION_EXCLUSION.test([label, ...(section.ancestorTitles || [])].join(" ")))) return null;
  // Literature-summary headings can contain the word "Extension" and look
  // model-bearing to a generic heading scorer, but they do not define a paper
  // component. Keep actual extension formulations; reject only headings that
  // explicitly announce a review of prior papers/work/models.
  if (/^review\s+of\s+(?:previous|prior|earlier)\s+(?:papers?|work|models?|literature)\b/i.test(label)) return null;
  // A generic results heading reports outputs rather than defining a model
  // primitive. In particular, publisher table headers under "Estimation
  // Results" can otherwise masquerade as an estimation component.
  if (/^(?:estimation|empirical|computational|numerical|simulation)\s+results?$/i.test(label)) return null;
  // Numeric theorem-bound sections report proof results rather than a model
  // primitive, even when their proof text mentions a polynomial algorithm.
  if (/^(?:upper|lower)\s+bound\s+(?:of|on)\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)\b/i.test(label)) return null;
  if (/\btractable\s+cases?\b.*\b(?:pool\s+)?structures?\b/i.test(label)) return null;
  // Heading-bounded source text preserves first-sentence method cues that the
  // normalized multi-column stream can omit. Generic headings such as
  // "Analysis" must therefore be classified from the source union, or a
  // backward-induction section can be mislabeled as an objective/interaction.
  // Classify from clean propositions only. A flattened display can splice a
  // trailing profit/estimation clause onto unrelated prose and otherwise make
  // a generic Benchmark heading select that contaminated clause as its role.
  const safeModeSentence = (sentence) => {
    if (options.formalEvidenceAllowed !== false) return true;
    const page = pages.find((candidate) => isWhitespaceNormalizedSubstring(sentence, candidate?.text || ""));
    const safe = Boolean(page) && safeModeLiteralProse(sentence, page.text);
    return safe;
  };
  const roleEvidence = sentenceList(section.sourceText || section.text)
    .filter((sentence) => readableProse(sentence)
      && (options.formalEvidenceAllowed === false || !formulaContaminatedProse(sentence, section.sourceLines || section.lines))
      && safeModeSentence(sentence)
      && !organizationProse(sentence)
      && !displayOrResultOnlyProse(sentence))
    .join(" ");
  let role = roleFor(section.title, roleEvidence || section.sourceText || section.text);
  const roleEvidenceSentences = sentenceList(section.sourceText || section.text)
    .filter((sentence) => readableProse(sentence)
      && (options.formalEvidenceAllowed === false || !formulaContaminatedProse(sentence, section.sourceLines || section.lines))
      && safeModeSentence(sentence)
      && !organizationProse(sentence)
      && !displayOrResultOnlyProse(sentence));
  // Include only already-audited literal restriction fragments in role
  // inference. This lets a generic relaxation heading recognize its actual
  // feasibility role without admitting the corrupted continuation that made
  // the page-level sentence unusable.
  roleEvidenceSentences.push(...literalVariantRestrictionFragments(section, pages, "constraint"));
  const inferredRoles = [
    "decision", "state", "process", "information", "interaction",
    "constraint", "objective", "preference", "algorithm", "estimation"
  ].filter((candidateRole) => roleEvidenceSentences.some((sentence) => sourceSupportsRole(candidateRole, sentence)));
  const hasConditionalInteractionSequence = roleEvidenceSentences.some((sentence) =>
    /^(?:if|when)\b[^.!?]{8,240},\s+(?:then\s+)?[^.!?]{0,240}\b(?:decides?|chooses?|sets?|selects?|allocates?|assigns?)\b[^.!?]{0,180}\b(?:and|then)\b[^.!?]{0,180}\b(?:decides?|chooses?|sets?|selects?|allocates?|assigns?)\b/i.test(sentence)
      && sourceSupportsRole("interaction", sentence));
  const roleCandidates = distinct([role, ...(hasConditionalInteractionSequence ? ["interaction"] : []), ...inferredRoles]);
  // An explicit nonbaseline section can be headed by the analytical lens
  // (for example, "equilibrium" or "formulation") even though its literal
  // defining sentence is a decision, feasibility rule, or state definition.
  // Prefer the role whose own ranked source is itself a substantive condition;
  // every candidate still passes the ordinary literal, role, and formula gates
  // below. This changes ordering only and does not create evidence.
  const rankedByRole = new Map();
  const rankedForRole = (candidateRole) => {
    if (!rankedByRole.has(candidateRole)) {
      rankedByRole.set(candidateRole, rankedComponentSentences(section, pages, candidateRole, record, options));
    }
    return rankedByRole.get(candidateRole);
  };
  const orderedRoleCandidates = options.preferConditionedSource
    ? roleCandidates.map((candidateRole, index) => ({
        candidateRole,
        index,
        conditioned: rankedForRole(candidateRole).some((sentence) =>
          conditionBearingComponentSource(sentence) && sourceSupportsRole(candidateRole, sentence))
      })).sort((left, right) => Number(right.conditioned) - Number(left.conditioned)
        || left.index - right.index)
      .map((entry) => entry.candidateRole)
    : roleCandidates;
  // Retain only compact, locally extracted equations that pass the shared text
  // audit.  When PDF character maps do not support one, use an explicitly
  // labeled paper-specific verbal restatement instead of inventing notation.
  let source = null;
  let candidateExplanation = "";
  for (const candidateRole of orderedRoleCandidates) {
    const candidateExplanations = distinct([
      ...rankedForRole(candidateRole),
      firstUsefulSentences(section.text, 1, 64, { modelOnly: true }),
      firstUsefulSentences(section.text, 1, 64)
    ]);
    for (const candidate of candidateExplanations) {
      if (!roleAlignedComponentSentence(candidate, candidateRole, label)) continue;
      if (options.formalEvidenceAllowed !== false && formulaContaminatedProse(candidate, section.sourceLines || section.lines)) continue;
      const candidateSource = sourceFor(pages, section, `${section.title} ${candidate}`, "", {
        componentRole: candidateRole,
        preferredQuote: candidate
      });
      if (!candidateSource || !usableRelevanceSourceExcerpt(candidateSource.quote)
        || (candidateSource.quote.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length < 6
        || !sourceSupportsRole(candidateRole, candidateSource.quote)) continue;
      if (options.formalEvidenceAllowed === false) {
        const page = pages.find((entry) => Number(entry?.page) === Number(candidateSource.page));
        if (!page || !safeModeLiteralProse(candidateSource.quote, page.text)) continue;
      }
      source = candidateSource;
      candidateExplanation = candidate;
      role = candidateRole;
      break;
    }
    if (source) break;
  }
  if (!source) {
    // A strongly typed heading can still contain a literal sentence whose
    // registered predicate is more precise than the heading-derived role.
    for (const candidate of roleEvidenceSentences) {
      const inferredRole = roleFor("", candidate);
      if (!sourceSupportsRole(inferredRole, candidate)) continue;
      const candidateSource = sourceFor(pages, section, `${section.title} ${candidate}`, "", {
        componentRole: inferredRole,
        preferredQuote: candidate
      });
      if (candidateSource && usableRelevanceSourceExcerpt(candidateSource.quote)
        && (candidateSource.quote.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length >= 6
        && sourceSupportsRole(inferredRole, candidateSource.quote)) {
        if (options.formalEvidenceAllowed === false) {
          const page = pages.find((entry) => Number(entry?.page) === Number(candidateSource.page));
          if (!page || !safeModeLiteralProse(candidateSource.quote, page.text)) continue;
        }
        source = candidateSource;
        candidateExplanation = candidate;
        role = inferredRole;
        break;
      }
    }
  }
  if (!source) return null;
  if (!sourceSupportsRole(role, source.quote)) {
    const sourceRole = roleFor("", source.quote);
    if (sourceSupportsRole(sourceRole, source.quote)) role = sourceRole;
  }
  if (EXPLICIT_CONSTRAINT_CONDITION.test(source.quote)) role = "constraint";
  label = roleQualifiedComponentLabel(label, record.title, role);
  const materializedSourceCondition = options.formalEvidenceAllowed === false
    ? ""
    : materializedVariantRestrictionCondition(source.quote);
  const formulaAdjacentDemandDeclaration = MODELING_DECLARATION_CONDITION.test(source.quote)
    && /\bdemand\s+(?:function|system|specification)\b/i.test(label);
  const candidateFormula = formulaAdjacentDemandDeclaration || options.formalEvidenceAllowed === false
    ? { formal: "", equation: "", page: 0 }
    : formulaFromSection(section, `${section.title} ${candidateExplanation}`, source.page);
  const sourcePage = pages.find((page) => Number(page.page) === Number(source.page));
  const formula = candidateFormula.formal && sourcePage
    && !formalStructureIssue(candidateFormula.formal, "Source-extracted equation (not visually verified)")
    && comparableFormula(sourcePage.text).includes(comparableFormula(candidateFormula.formal))
    ? candidateFormula
    : { formal: "", equation: "", page: 0 };
  source.equation = formula.equation;
  // Prefer the audited, literal local sentence as the component explanation.
  // Section text can join PDF columns even when an individual page sentence is
  // clean; sourceFor has already rejected those malformed joins.
  let explanation = materializedSourceCondition
    || firstUsefulSentences(source.quote, 1, 90, { modelOnly: true })
    || firstUsefulSentences(source.quote, 1, 90)
    || candidateExplanation;
  if (formulaAdjacentDemandDeclaration) {
    const declared = authoredEnglish(source.quote).match(/^we\s+consider\s+((?:a|an|the)\s+.+)$/iu)?.[1];
    if (declared) explanation = `The alternative formulation considers ${declared.replace(/[,:;.]$/, "")}.`;
  }
  const normalizedLabel = authoredEnglish(label);
  if (normalizedLabel && explanation.toLowerCase().startsWith(`${normalizedLabel.toLowerCase()} `)) {
    const withoutRepeatedHeading = explanation.slice(normalizedLabel.length).trim();
    if (withoutRepeatedHeading.split(/\s+/).length >= 6) explanation = withoutRepeatedHeading;
  }
  const symbols = formulaAdjacentDemandDeclaration ? [] : symbolCandidates(
    section,
    record,
    `${section.title} ${explanation}`,
    source.page,
    {
      formal: formula.formal,
      sourceQuote: source.quote
    }
  );
  const retainedFormula = formula.formal && symbols.length ? formula : { formal: "", equation: "", page: 0 };
  if (!retainedFormula.formal) source.equation = "";
  const conditions = distinct((materializedSourceCondition
    ? [materializedSourceCondition]
    : conditionsFrom(section, record, `${section.title} ${explanation}`, source.page, pages)))
    .filter((condition) => options.formalEvidenceAllowed !== false
      || safeModeLiteralProse(condition, pages.find((page) => Number(page?.page) === Number(source.page))?.text || ""));
  const component = {
    id: componentId(label, usedIds),
    label,
    role,
    concepts: [],
    explanation,
    searchPhrases: searchPhrases(section.title, role, record),
    formal: retainedFormula.formal || sourceRestatement(role, explanation, symbols),
    formalKind: retainedFormula.formal ? "Source-extracted equation (not visually verified)" : "Atlas restatement of source rule",
    symbols,
    conditions,
    sources: [source],
    conceptBindings: [],
    conditionEvidence: materializedSourceCondition && conditions.includes(materializedSourceCondition)
      ? [{
          conditionIndex: conditions.indexOf(materializedSourceCondition),
          componentSourceRef: 0,
          derivation: "terminal-punctuation-only-source-condition"
        }]
      : []
  };
  return attachAutomatedRelevance(component, conceptDefinitions);
}

function groundedSourceForFocus(pages, sections, focus, options = {}) {
  const rankedPages = pages.map((page) => ({ page, score: overlapScore(focus, page.text) }))
    .sort((left, right) => right.score - left.score || Number(left.page.page) - Number(right.page.page));
  for (const { page } of rankedPages) {
    const quote = pageQuote(page.text, focus, options);
    if (!literalSourcePage(pages, quote, focus, page.page, options)) continue;
    if (options.modelOnly && !modelBearingProse(quote)) continue;
    const localSection = sections.find((section) => Number(section.page) <= Number(page.page)
      && Number(section.endPage ?? section.page) >= Number(page.page));
    const candidateLabel = localSection
      ? authoredEnglish(localSection.number ? `${localSection.number}. ${localSection.title}` : localSection.title)
      : "";
    return {
      page: Number(page.page) || 1,
      section: candidateLabel && !sourceHeadingRejectionReason(candidateLabel) ? candidateLabel : "Model formulation",
      equation: "",
      quote
    };
  }
  return null;
}

function fallbackGroundedComponent(pages, sections, record, conceptDefinitions, usedIds) {
  const focus = [record.title, record.model_topic, record.business_question, record.abstract, record.scope_note].filter(Boolean).join(" ");
  const source = groundedSourceForFocus(pages, sections, focus, { modelOnly: true });
  if (!source || !usableRelevanceSourceExcerpt(source.quote)) return null;
  const label = "Model formulation";
  const explanation = firstUsefulSentences(record.abstract || record.model_topic || source.quote, 2, 64, { modelOnly: true })
    || rewriteSourceVoice(source.quote);
  let role = roleFor(label, `${explanation} ${source.quote}`);
  if (!sourceSupportsRole(role, source.quote)) {
    const sourceRole = roleFor("", source.quote);
    if (sourceSupportsRole(sourceRole, source.quote)) role = sourceRole;
  }
  return attachAutomatedRelevance({
    id: componentId(label, usedIds),
    label,
    role,
    concepts: [],
    explanation,
    searchPhrases: searchPhrases(label, role, record),
    formal: sourceRestatement(role, explanation),
    formalKind: "Atlas restatement of source rule",
    symbols: [],
    conditions: [],
    sources: [source],
    conceptBindings: []
  }, conceptDefinitions);
}

function bestSectionForText(sections, text) {
  return [...sections].sort((left, right) => overlapScore(text, right.text) - overlapScore(text, left.text) || left.page - right.page)[0];
}

function conciseLegacyHeading(value, fallback) {
  const full = authoredEnglish(value);
  const candidates = [
    full.split(/[;(]/)[0],
    full.replace(/\([^)]*\)/g, " ").split(/[;,.](?=\s)/)[0]
  ].map((candidate) => truncateWords(cleanText(candidate).replace(/[-,:]+$/, ""), 12));
  return candidates.find((candidate) => candidate && !headingLabelRejectionReason(candidate)) || fallback;
}

function documentedPdfPage(value) {
  const source = cleanText(value);
  const explicit = source.match(/\bPDF\s+(?:p{1,2}\.|pages?)\s*(\d{1,4})/i);
  if (explicit) return Number(explicit[1]) || 0;
  // A few reviewed records put the page marker before "of the main PDF".
  // Keep this fallback narrowly scoped so a journal/printed page is never
  // mistaken for a PDF page.
  const trailing = source.match(/\bp{1,2}\.\s*(\d{1,4})[^.;]{0,48}\bof\s+the\s+main\s+PDF\b/i);
  return Number(trailing?.[1] || 0);
}

function documentedEquationLabel(value) {
  const source = cleanText(value);
  const labeled = source.match(/\b(?:equations?|problems?|formulation|condition)\s*(\([^)]{1,24}\))(?:\s*(?:([–—-])|\b(and)\b)\s*(\([^)]{1,24}\)))?/i);
  if (labeled) {
    if (!labeled[4]) return labeled[1];
    return labeled[3] ? `${labeled[1]}, ${labeled[4]}` : `${labeled[1]}–${labeled[4]}`;
  }
  const namedProblem = source.match(/\b(problem|formulation)\s+([A-Za-z][A-Za-z0-9_-]*(?:\([^)]{1,24}\))?)/i);
  return namedProblem ? `${namedProblem[1][0].toUpperCase()}${namedProblem[1].slice(1).toLowerCase()} ${namedProblem[2]}` : "";
}

function reviewedFormulaIsUsable(value) {
  const formal = cleanFormula(value);
  return Boolean(formal)
    && !hasMathematicalExtractionNoise(formal)
    && !formalStructureIssue(formal, "Atlas normalized notation");
}

function reviewedFormalIsMathematical(value) {
  const formal = cleanFormula(value);
  return CONDITION_MATH_SIGNAL.test(formal)
    || /\b(?:arg\s*)?(?:max|min)\s*[_({]/iu.test(formal)
    || /[∑Σ∏Π∫]/u.test(formal);
}

function reviewedEquilibriumExplanation(record) {
  const label = authoredEnglish(record.equilibrium?.label).replace(/[.!?;:]+$/, "");
  const evidence = authoredEnglish(record.equilibrium?.evidence);
  const lead = label
    ? `The model's equilibrium concept is ${label}.`
    : "The model characterizes its solution concept under the stated timing and information structure.";
  return [lead, evidence && !hasExtractionNoise(evidence) ? evidence : ""].filter(Boolean).join(" ");
}

function legacyItems(record) {
  const items = [];
  const architecture = distinct([record.timing, ...(record.architecture_detail || []), ...(record.game_architecture || [])], 3);
  // Allocate the strongest literal anchors to the reviewed decisions,
  // objective, and solution concept before the broad architecture summary.
  // Otherwise a generic sequence item can consume the one source sentence
  // that exactly states the actors' stage decisions, leaving the decision
  // component anchored to a downstream equilibrium result.
  if ((record.actions || []).length) items.push({ label: "Decisions and actions", role: "decision", explanation: record.actions.join(" ") });
  if ((record.information || []).length) items.push({ label: "Information structure", role: "information", explanation: record.information.join(" ") });
  if (record.objective?.summary) items.push({ label: "Objective and constraints", role: "objective", explanation: record.objective.summary, formal: record.objective.formula || "" });
  if (record.equilibrium?.label || record.equilibrium?.evidence) items.push({
    label: conciseLegacyHeading(record.equilibrium.label, "Equilibrium or solution concept"),
    role: "interaction",
    explanation: reviewedEquilibriumExplanation(record),
    reviewedExplanation: true,
    sourceEvidence: "equilibrium"
  });
  if (record.method) items.push({ label: "Solution or estimation method", role: /estimat|likelihood|regression/i.test(record.method) ? "estimation" : "algorithm", explanation: record.method });
  if (architecture.length) items.push({ label: "Model sequence and system structure", role: "interaction", explanation: architecture.join(" ") });
  return items.slice(0, 6);
}

function legacySourceQuoteScore(item, quote, record = {}) {
  const text = cleanText(quote);
  const role = cleanText(item?.role).toLowerCase();
  const explanation = authoredEnglish(item?.explanation);
  const paperFocus = [record.model_topic, record.primary_topic, record.title].filter(Boolean).join(" ");
  const paperOwned = /\b(?:we\s+(?:use|model|formulate|assume|define|consider|analy[sz]e|solve|derive|estimate|characterize)|our\s+(?:model|analysis|method|objective)|the\s+(?:model|payer|provider|firm|seller|buyer|platform|planner|manager|patients?|consumers?)\s+(?:chooses?|decides?|sets?|selects?|observes?|knows?|maximi[sz]es?|minimi[sz]es?|responds?))\b/i.test(text) ? 8 : 0;
  const roleSpecific = role === "decision"
    ? (/\b(?:payer|provider|firm|seller|buyer|platform|planner|manager|patients?|consumers?)\b.{0,120}\b(?:choos(?:e|es|ing)|decid(?:e|es|ing)|set(?:s|ting)?|select(?:s|ing)?|allocat(?:e|es|ing)|announc(?:e|es|ing))\b/i.test(text) ? 22 : 0)
    : role === "information"
      ? (/\b(?:common knowledge|observ(?:e|es|ed|ing|able)|know(?:s|n)?|information|signal|belief|private|public|expected\s+(?:delay|waiting|sojourn))\b/i.test(text) ? 22 : 0)
      : role === "objective"
        ? (/\b(?:objective|maximi[sz]|minimi[sz]|profit|revenue|welfare|payoff|cost)\b/i.test(text) ? 22 : 0)
        : role === "algorithm" || role === "estimation"
          ? (/\b(?:algorithm|procedure|methodology|backward\s+induction|working\s+backward|queueing\s+(?:analysis|models?)|indifference\s+conditions?|solve|derive|estimate|likelihood|regression)\b/i.test(text) ? 22 : 0)
          : role === "interaction"
            ? (/\b(?:equilibrium|best response|Stackelberg|game|first\s+stage|second\s+stage|third\s+stage|then|subsequently)\b/i.test(text) ? 22 : 0)
            : 0;
  const equilibriumBonus = item?.sourceEvidence === "equilibrium"
    && /\b(?:nash|equilibrium|best response|first[ -]order conditions?|fo[ck]s?)\b/i.test(text) ? 30 : 0;
  const equilibriumCharacterizationBonus = item?.sourceEvidence === "equilibrium"
    && /\b(?:(?:pure|mixed(?:-strategy)?|symmetric|unique|multiple)\s+(?:strategy\s+)?equilibr(?:ium|ia)|equilibr(?:ium|ia)\s+(?:is|are|consists?|exists?))\b/i.test(text)
      ? 48
      : 0;
  const equilibriumRegimeEnumerationBonus = item?.sourceEvidence === "equilibrium"
    && /\b(?:one|two|three|four|multiple|several)\s+possible\b[^.!?]{0,120}\bequilibr(?:ium|ia)\b[^.!?]{0,220}\b(?:one|two|three|four|multiple|several)\s+possible\b[^.!?]{0,120}\bequilibr(?:ium|ia)\b/i.test(text)
      ? 50
      : 0;
  const sequenceBonus = role === "interaction"
    && /\b(?:three-stage|first\s+stage|second\s+stage|third\s+stage|Stackelberg|working\s+backward)\b/i.test(text) ? 16 : 0;
  const decisionObjectivePenalty = role === "decision"
    && /\b(?:maximi[sz]|minimi[sz]|profit|revenue|welfare|objective)\b/i.test(text) ? 20 : 0;
  const stagedDecisionBonus = role === "decision"
    && /^(?:in\s+)?(?:the\s+)?(?:first|second|third)\s+stage\b/i.test(text)
    && /\b(?:provider|firm|seller|buyer|platform|planner|manager|consumer|customer|patient)\b.{0,120}\b(?:choos(?:e|es|ing)|decid(?:e|es|ing)|set(?:s|ting)?|select(?:s|ing)?|allocat(?:e|es|ing))\b/i.test(text)
      ? 60
      : 0;
  const resultPenalty = resultAssertionProse(text) ? 18 : 0;
  return overlapScore(explanation, text) * 6
    + overlapScore(item?.label, text) * 2
    + Math.min(8, overlapScore(paperFocus, text))
    + paperOwned
    + roleSpecific
    + equilibriumBonus
    + equilibriumCharacterizationBonus
    + equilibriumRegimeEnumerationBonus
    + sequenceBonus
    + stagedDecisionBonus
    - decisionObjectivePenalty
    - resultPenalty;
}

function preferredLegacySourceQuote(item, section, pages, record) {
  const candidates = [];
  for (const page of pages) {
    if (Number(page.page) < Number(section.page) || Number(page.page) > Number(section.endPage ?? section.page)) continue;
    const localText = sectionSourceTextOnPage(section, page.page);
    if (!localText) continue;
    for (const quote of literalSourceSentenceCandidates(page.text, { minWords: 6, maxWords: 90 })) {
      const normalized = cleanText(quote);
      if (!localText.includes(normalized)
        || !componentSourceSentence(normalized, item.role)
        || formulaContaminatedProse(normalized, page.text)
        || !sourceSupportsRole(item.role, normalized)) continue;
      if (item.sourceEvidence === "equilibrium"
        && !/\b(?:nash|equilibrium|best response|first[ -]order conditions?|fo[ck]s?)\b/i.test(normalized)) continue;
      candidates.push({ quote: normalized, page: Number(page.page), score: legacySourceQuoteScore(item, normalized, record) });
    }
  }
  return candidates.sort((left, right) => right.score - left.score
    || left.page - right.page
    || left.quote.length - right.quote.length)[0]?.quote || "";
}

function legacyComponents(record, pages, sections, conceptDefinitions) {
  const usedIds = new Set();
  const usedSections = new Set();
  const usedAnchors = new Set();
  const fallbacks = fallbackSections(pages, record);
  const components = legacyItems(record).map((item, itemIndex) => {
    const focus = `${item.label} ${item.explanation}`;
    const formulaSource = cleanText(record.objective?.formula_source);
    const documentedObjectivePage = item.formal
      ? documentedPdfPage(formulaSource)
      : 0;
    const ranked = [...sections].map((section) => ({
      section,
      score: overlapScore(focus, `${section.title} ${section.sourceText || section.text}`)
        + (sourceSupportsRole(item.role, section.sourceText || section.text) ? 8 : 0)
    })).sort((left, right) => right.score - left.score
      || Number(usedSections.has(`${left.section.page}:${left.section.title}`)) - Number(usedSections.has(`${right.section.page}:${right.section.title}`))
      || left.section.page - right.section.page);
    const documentedSections = documentedObjectivePage
      ? sections.filter((section) => documentedObjectivePage >= Number(section.page)
        && documentedObjectivePage <= Number(section.endPage ?? section.page))
      : [];
    const documentedPage = documentedObjectivePage
      ? pages.find((page) => Number(page.page) === documentedObjectivePage)
      : null;
    const documentedPageLines = documentedPage
      ? String(documentedPage.text || "").split(/\r?\n/).map((text) => ({ page: documentedObjectivePage, text }))
      : [];
    const documentedObjectiveSection = documentedPage ? {
      number: "",
      title: "Expected-profit objective",
      page: documentedObjectivePage,
      endPage: documentedObjectivePage,
      text: String(documentedPage.text || ""),
      sourceText: String(documentedPage.text || ""),
      lines: documentedPageLines,
      sourceLines: documentedPageLines
    } : null;
    const candidates = [
      documentedObjectiveSection,
      ...documentedSections,
      ...ranked.filter((entry) => entry.score > 0 && !usedSections.has(`${entry.section.page}:${entry.section.title}`)).map((entry) => entry.section),
      ...ranked.filter((entry) => entry.score > 0).map((entry) => entry.section),
      ...fallbacks.slice(itemIndex % Math.max(1, fallbacks.length)),
      ...fallbacks.slice(0, itemIndex % Math.max(1, fallbacks.length))
    ].filter((section, index, values) => section && values.indexOf(section) === index);
    // The deep-map formula is a reviewed Atlas restatement. Generic extracted
    // equations are never copied into every component merely because a section
    // happens to contain mathematical glyphs.
    const formula = item.formal
      ? { formal: cleanFormula(item.formal), equation: documentedEquationLabel(formulaSource) }
      : { formal: "", equation: "" };
    const explanation = item.reviewedExplanation
      ? authoredEnglish(item.explanation)
      : completeAuthoredSummary(item.explanation, 4, 180);
    if (!explanation) return null;
    const conditions = distinct((record.assumptions || [])
      .filter((condition) => overlapScore(`${item.label} ${explanation}`, condition) > 0)
      .map(authoredEnglish)
      .filter((condition) => condition && !hasExtractionNoise(condition) && !organizationProse(condition)), 3);
    const sourceCandidates = [];
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const preferredQuote = preferredLegacySourceQuote(item, candidate, pages, record);
      if (!preferredQuote) continue;
      const candidateSource = sourceFor(pages, candidate, focus, formula.equation, {
        componentRole: item.role,
        preferredQuote
      });
      if (!candidateSource || !usableRelevanceSourceExcerpt(candidateSource.quote)) continue;
      if (!sourceSupportsRole(item.role, candidateSource.quote)) continue;
      const anchor = normalizedComponentAnchor(candidateSource);
      if (!anchor || usedAnchors.has(anchor)) continue;
      if (item.sourceEvidence === "equilibrium"
        && !/\b(?:nash|equilibrium|best response|first[ -]order conditions?|fo[ck]s?)\b/i.test(candidateSource.quote)) continue;
      sourceCandidates.push({
        section: candidate,
        source: candidateSource,
        candidateIndex,
        score: legacySourceQuoteScore(item, candidateSource.quote, record)
          + (item.formal && Number(candidateSource.page) === documentedObjectivePage ? 1_000 : 0)
          + (usedSections.has(`${candidate.page}:${candidate.title}`) ? 0 : 4)
      });
    }
    sourceCandidates.sort((left, right) => right.score - left.score
      || left.candidateIndex - right.candidateIndex
      || Number(left.source.page) - Number(right.source.page));
    const chosenSource = sourceCandidates[0] || null;
    const section = chosenSource?.section || null;
    const source = chosenSource?.source || null;
    if (!section || !source) return null;
    usedSections.add(`${section.page}:${section.title}`);
    usedAnchors.add(normalizedComponentAnchor(source));
    const symbols = symbolCandidates(
      section,
      record,
      `${item.label} ${explanation} ${formula.formal}`,
      source.page,
      {
        includeReviewedCatalog: record.detail_level === "model_map" && item.role === "objective",
        formal: formula.formal,
        sourceQuote: source.quote
      }
    );
    const usableReviewedFormal = reviewedFormulaIsUsable(formula.formal);
    const mathematicalReviewedFormal = usableReviewedFormal && reviewedFormalIsMathematical(formula.formal);
    const retainReviewedFormal = usableReviewedFormal && (!mathematicalReviewedFormal || symbols.length > 0);
    const component = {
      id: componentId(item.label, usedIds),
      label: item.label,
      role: item.role,
      concepts: [],
      explanation,
      searchPhrases: searchPhrases(item.label, item.role, record),
      formal: retainReviewedFormal ? formula.formal : sourceRestatement(item.role, explanation, symbols),
      formalKind: retainReviewedFormal && mathematicalReviewedFormal
        ? "Atlas normalized notation"
        : "Atlas restatement of source rule",
      symbols,
      conditions,
      sources: [source],
      conceptBindings: []
    };
    return attachAutomatedRelevance(component, conceptDefinitions);
  }).filter(Boolean);
  const fallback = chooseSections(pages, record, 5);
  for (const section of fallback) {
    if (components.length >= 3) break;
    const component = sectionComponent(section, pages, record, conceptDefinitions, usedIds);
    if (component) components.push(component);
  }
  return components;
}

function modelTypes(record, content) {
  const source = authoredEnglish([
    record.method,
    ...(record.method_families || []),
    ...(record.evidence_families || []),
    ...(record.architecture_families || []),
    record.scope_note,
    record.abstract,
    content
  ].filter(Boolean).join(" "));
  const matched = TYPE_RULES.filter(([, pattern]) => pattern.test(source)).map(([type]) => type);
  if (record.strict_game_theory && !matched.includes("Game theory")) matched.push("Game theory");
  if (!matched.length) matched.push("Optimization");
  return distinct(matched, 4).filter((type) => ALLOWED_MODEL_TYPES.has(type));
}

function unusableLiteralQuote(value, rawPage = "") {
  return hasExtractionNoise(value)
    || (organizationProse(value) && !explicitLocalVariantCondition(authoredEnglish(value)))
    || isBoilerplate(value)
    || isCaption(value)
    || isCitation(value)
    || isTableRow(value)
    || formulaContaminatedProse(value, rawPage, { conservative: true });
}

/**
 * Recover a literal prose clause when a PDF sentence contains an inline
 * display, a fused footnote/caption lead, or extraction noise elsewhere in
 * the sentence.  Every returned clause remains a contiguous raw-page span;
 * this is citation-boundary narrowing, never dehyphenation or paraphrase.
 */
export function cleanLiteralQuoteSubclause(rawQuote, rawPage, focus = "", requiredPhrase = "") {
  const quote = normalizeWhitespace(rawQuote);
  if (!quote || !rawPage) return "";
  const cutPoints = new Set([0, quote.length]);
  const boundaryPatterns = [
    /[,;:] ?\s+(?=(?:and|but|where|which|when|while|although|because|as|so|see)\b)/giu,
    /\.\d{1,3}\s+(?=[A-Z])/gu,
    /\b(?:to\s+)?(?:denote|represent(?:s)?|refer(?:s)?\s+to)\s+/giu,
    /\b(?:such\s+that|which\s+is|when\s+an?|input\s*:|output\s*:)\s+/giu,
    /\s+\/\/\s*/gu
  ];
  for (const pattern of boundaryPatterns) {
    for (const match of quote.matchAll(pattern)) {
      cutPoints.add(match.index);
      cutPoints.add(match.index + match[0].length);
    }
  }
  const required = normalizeWhitespace(requiredPhrase);
  if (required) {
    const at = quote.toLocaleLowerCase("en-US").indexOf(required.toLocaleLowerCase("en-US"));
    if (at >= 0) {
      cutPoints.add(at);
      cutPoints.add(at + required.length);
    }
  }
  const ordered = [...cutPoints].sort((left, right) => left - right);
  const requiredKey = cleanText(required).toLocaleLowerCase("en-US");
  const candidates = [];
  for (let startIndex = 0; startIndex < ordered.length - 1; startIndex += 1) {
    for (let endIndex = startIndex + 1; endIndex < ordered.length; endIndex += 1) {
      const candidate = quote.slice(ordered[startIndex], ordered[endIndex])
        .replace(/^[,;:\s]+|[,;:\s]+$/gu, "")
        .replace(/^\d{1,3}\s+(?=[A-Z])/u, "")
        .trim();
      const lexicalWords = candidate.match(/[\p{L}][\p{L}'’\-]{2,}/gu) || [];
      if (lexicalWords.length < 4 || lexicalWords.length > 60) continue;
      if (!rawSetupLiteralIncludes(candidate, rawPage) || unusableLiteralQuote(candidate, rawPage)) continue;
      if (requiredKey && !cleanText(candidate).toLocaleLowerCase("en-US").includes(requiredKey)) continue;
      if (focus && !hasSourceOverlap(focus, candidate)) continue;
      candidates.push({
        quote: candidate,
        score: overlapScore(focus, candidate) * 20
          + (/[.!?][”"')\]}]*$/u.test(candidate) ? 3 : 0)
          - candidate.split(/\s+/u).length / 100
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.quote.length - right.quote.length);
  return candidates[0]?.quote || "";
}

function remapAuthoredSourceQuotes(models, pages, paperId) {
  const pagesByNumber = new Map(pages.map((page) => [Number(page?.page), page]));
  const phraseKey = (value) => cleanText(value)
    .normalize("NFKC")
    .replace(/\u00ad/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const remap = (source, path, focus, { role = "", requiredPhrases = [] } = {}) => {
    if (!source?.quote) throw new Error(`${paperId}: ${path} has no source quotation`);
    const page = pagesByNumber.get(Number(source.page));
    const originalQuote = normalizeWhitespace(source.quote);
    const normalizedRemap = page ? remapNormalizedSourceQuote(source.quote, page.text) : "";
    let literalQuote = normalizedRemap
      || (page && isWhitespaceNormalizedSubstring(originalQuote, page.text) ? originalQuote : "");
    if (literalQuote && unusableLiteralQuote(literalQuote, page?.text)) {
      literalQuote = cleanLiteralQuoteSubclause(literalQuote, page.text, focus);
    }
    if (!literalQuote && page && role) {
      const localFallback = literalSourceSentenceCandidates(page.text, { minWords: 5, maxWords: 100 })
        .map((quote) => ({
          quote,
          sectionScore: overlapScore(source.section || "", quote),
          focusScore: overlapScore(focus, quote)
        }))
        .filter((candidate) => candidate.sectionScore > 0
          && candidate.focusScore > 0
          && isWhitespaceNormalizedSubstring(candidate.quote, page.text)
          && !unusableLiteralQuote(candidate.quote, page.text)
          && usableRelevanceSourceExcerpt(candidate.quote)
          && componentSourceSentence(candidate.quote, role)
          && sourceSupportsRole(role, candidate.quote))
        .sort((left, right) => right.sectionScore - left.sectionScore
          || right.focusScore - left.focusScore
          || left.quote.length - right.quote.length)[0];
      if (localFallback) literalQuote = localFallback.quote;
    }
    // Clause narrowing can remove the phrase that grounded a modeled concept.
    // When that happens, re-anchor to another clean literal sentence on the
    // same page that repeats the same source phrase and supports the component
    // role. This preserves both citation literalness and semantic binding.
    const originalKey = phraseKey(originalQuote);
    const literalKey = phraseKey(literalQuote);
    const lostRequiredPhrases = distinct(requiredPhrases)
      .map((phrase) => ({ phrase, key: phraseKey(phrase) }))
      .filter(({ key }) => key.split(/\s+/u).length >= 2
        && originalKey.includes(key)
        && !literalKey.includes(key));
    if (page && lostRequiredPhrases.length) {
      const replacement = literalSourceSentenceCandidates(page.text, { minWords: 5, maxWords: 100 })
        .map((quote) => {
          const candidateKey = phraseKey(quote);
          const phraseMatches = lostRequiredPhrases.filter(({ key }) => candidateKey.includes(key)).length;
          return {
            quote,
            phraseMatches,
            score: phraseMatches * 200 + overlapScore(focus, quote) * 20
          };
        })
        .filter((candidate) => candidate.phraseMatches > 0
          && isWhitespaceNormalizedSubstring(candidate.quote, page.text)
          && !unusableLiteralQuote(candidate.quote, page.text)
          && usableRelevanceSourceExcerpt(candidate.quote)
          && componentSourceSentence(candidate.quote, role)
          && sourceSupportsRole(role, candidate.quote)
          && hasSourceOverlap(focus, candidate.quote))
        .sort((left, right) => right.score - left.score || left.quote.length - right.quote.length)[0];
      if (replacement) literalQuote = replacement.quote;
    }
    if (!literalQuote || !isWhitespaceNormalizedSubstring(literalQuote, page?.text)) {
      throw new Error(`${paperId}: ${path} could not be remapped to raw page ${source.page}`);
    }
    source.quote = literalQuote;
  };
  for (const [modelIndex, model] of models.entries()) {
    const modelFocus = [model.name, model.summary, model.method].filter(Boolean).join(" ");
    for (const [sourceIndex, source] of (model.sources || []).entries()) {
      remap(source, `models[${modelIndex}].sources[${sourceIndex}]`, modelFocus);
    }
    for (const [componentIndex, component] of (model.components || []).entries()) {
      const componentFocus = [
        component.label,
        component.explanation,
        component.formal,
        ...(component.conditions || []),
        ...(component.symbols || []).flatMap((symbol) => [symbol?.symbol, symbol?.meaning])
      ].filter(Boolean).join(" ");
      const requiredPhrases = (component.conceptBindings || [])
        .filter((binding) => binding?.status === "modeled")
        .map((binding) => String(binding.conceptId || "").replace(/-/gu, " "))
        .filter(Boolean);
      for (const [sourceIndex, source] of (component.sources || []).entries()) {
        remap(
          source,
          `models[${modelIndex}].components[${componentIndex}].sources[${sourceIndex}]`,
          componentFocus,
          { role: component.role, requiredPhrases }
        );
      }
    }
    for (const [field, semanticField] of SETUP_FIELD_MAP) {
      model.setupEvidence[field] = (model.setupEvidence?.[field] || [])
        .map((entry) => remapSetupEntryToLiteralPage(entry, pages, semanticField));
    }
  }
  return models;
}

const SETUP_FIELD_MAP = [
  ["objects", "entities"],
  ["inputs", "inputs"],
  ["decisions", "decisions"],
  ["assumptions", "assumptions"]
];
const SETUP_FIELDS = SETUP_FIELD_MAP.map(([field]) => field);

function cloneSetupEntries(entries = []) {
  return entries.map((entry) => ({
    ...entry,
    source: entry?.source ? { ...entry.source } : entry?.source
  }));
}

function setupLiteralKey(value) {
  return cleanText(value).toLocaleLowerCase("en-US");
}

function setupEquivalenceKey(value) {
  return setupLiteralKey(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function distinctSetupValues(values = [], limit = Infinity) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const key = setupEquivalenceKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function setupLiteralTokens(value) {
  return setupLiteralKey(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{1,}/gu) || [];
}

function rawSetupLiteralIncludes(candidate, rawPage) {
  return isWhitespaceNormalizedSubstring(candidate, rawPage);
}

const GENERIC_DETERMINER_SETUP_PHRASE = /^(?:a|an|the|each|its|their|this|that|these|those)\s+(?:cost|data|demand|information|inventory|output|parameter|price|rate|state|time|type|use|utility|value)s?$/i;

function specificSourceSetupPhrase(entry, category = "") {
  const matchedText = cleanText(entry?.source?.matchedText);
  const derivation = entry?.source?.derivation || "";
  const tokenCount = setupLiteralTokens(matchedText).length;
  const strongSingleEntity = category === "entities"
    && /^(?:coalitions?|commodit(?:y|ies)|editors?|manuscripts?|planners?|players?|populations?|reviewers?|subjects?)$/i.test(matchedText);
  if (!/^(?:literal-source-phrase|literal-source-pattern)$/.test(derivation)
      || (tokenCount < 2 && !strongSingleEntity)
      || GENERIC_DETERMINER_SETUP_PHRASE.test(matchedText)
      || hasExtractionNoise(matchedText)
      || /[=<>≤≥∑∫{}]|\b(?:arg\s*(?:min|max)|exp|log)\s*\(/i.test(matchedText)) return "";

  if (category === "entities") {
    return /\b(?:advertisers?|agencies|agents?|applicants?|authors?|batteries|bidders?|brands?|buyers?|cells?|clients?|clinicians?|coalitions?|commodit(?:y|ies)|consumers?|customers?|deciding\s+editors?|decision[-\s]+makers?|deposits?|developers?|districts?|donors?|drivers?|editors?|elements?|experimental\s+units?|facilities|farmers?|firms?|ground\s+sets?|hospitals?|human\s+reviewers?|intermediaries|locations?|managers?|manufacturers?|manuscripts?|merchants?|milk\s+banks?|networks?|nodes?|operators?|organizations?|owners?|patients?|physicians?|planners?|platforms?|players?|polic(?:y|ies)|populations?|principals?|products?|projects?|providers?|random\s+variables?|recipes?|researchers?|resources?|retailers?|reviewers?|salespersons?|schools?|sellers?|sensors?|servers?|state\s+spaces?|stations?|stores?|students?|subjects?|suppliers?|tables?|testing\s+groups?|users?|vehicles?|vendors?|workers?)\b/i.test(matchedText)
      ? matchedText
      : "";
  }
  if (category === "inputs") {
    return /\b(?:ages?|arrival\s+rates?|beliefs?|benefits?|budgets?|capacities|case\s+completion\s+hazard\s+rate(?:\s+function)?|characteristics?|coalition\s+payoffs?|costs?|data|datasets?|demand(?:\s+rates?)?|densit(?:y|ies)|digraphs?|discounts?|distributions?|durations?|efforts?|elasticit(?:y|ies)|expenditures?|features?|forecasts?|funds?|graphs?|hypergraphs?|hazard\s+rate(?:\s+function)?|horizons?|information|inventor(?:y|ies)|lead\s+times?|liquidity\s+positions?|matri(?:x|ces)|objective\s+functions?|observations?|outputs?|parameters?|payment\s+requests?|payoffs?|preferences?|prices?|priorities|probabilities|processing\s+times?|qualities|rankings?|rates?|rewards?|sales?|sample\s+data\s+points?|service\s+times?|signals?|skills?|spending|stages?|states?|suppl(?:y|ies)|tests?|times?|topolog(?:y|ies)|types?|uses?|utilities|valuations?|weather|wind\s+statistics)\b/i.test(matchedText)
      ? matchedText
      : "";
  }
  if (category === "decisions") {
    return /^(?:whether|which|what|when|where|how|acquire|adjust|allocate|choosing|decide|investing|orders?|search)\b|\b(?:actions?|allocations?|approval\s+thresholds?|assortments?|batch\s+sizes?|bids?|capacities|choices?|classifiers?|contracts?|decision\s+rules?|decisions?|efforts?|fees?|inventor(?:y|ies)|investments?|learning\s+times?|locations?|mechanisms?|orderings?|order\s+quantities|payment\s+orders?|polic(?:y|ies)|prices?|pricing|production\s+levels?|qualities|quantit(?:y|ies)|rates?|recourse\s+decisions?|routes?|sample\s+sizes?|sanitation(?:\s+(?:cycles?|intervals?|periods?))?|schedules?|selections?|settlement\s+orders?|skills?|start\s+times?|strategies|suppression\s+patterns?|thresholds?|timing)\b/i.test(matchedText)
      ? matchedText
      : "";
  }
  if (category === "assumptions") {
    const conciseNamedAssumption = tokenCount >= 2
      && /^(?:two\s+periods|(?:the\s+)?light-tail\s+assumption)$/i.test(matchedText);
    return (conciseNamedAssumption || (tokenCount >= 4
      && /\b(?:assum|batch\s+size|constant|equal\s+probability|fixed|homogeneous|independent|increments?|known|multiple\s+of|poisson|producer\s+ecosystem|random|stationary|two\s+types|written)\w*\b/i.test(matchedText)))
      ? matchedText
      : "";
  }
  return "";
}

/**
 * Semantic section extraction intentionally normalizes compatibility glyphs
 * (for example, PDF `ﬁ` -> `fi`).  It can therefore produce a readable setup
 * value from a quote that is no longer byte-for-byte present on the frozen
 * page.  Recover the corresponding clean, contiguous raw sentence here so the
 * displayed value stays readable while its citation remains literally
 * auditable against the page artifact.
 *
 * Broken line-end words are deliberately not repaired.  The literal sentence
 * selector excludes such spans, allowing a later clean setup candidate to win
 * instead of publishing either a noisy `pre- announce` quote or a fabricated
 * `preannounce` quote.
 */
export function remapSetupEntryToLiteralPage(entry, pages = [], category = "") {
  if (!entry?.source || entry.source.type !== "section") return entry;
  const page = pages.find((item) => Number(item?.page) === Number(entry.source.page));
  if (!page) return entry;

  const originalQuote = String(entry.source.quote || "").trim();
  let literalQuote = rawSetupLiteralIncludes(originalQuote, page.text)
    ? normalizeWhitespace(originalQuote)
    : remapNormalizedSourceQuote(originalQuote, page.text);
  // Strip a fused superscript footnote before deciding whether the remaining
  // sentence needs clause narrowing. Otherwise the numeric prefix can make a
  // clean complete sentence look like citation prose and unnecessarily reduce
  // it to a short matched phrase.
  const withoutLeadingFootnote = String(literalQuote || "").replace(/^\d{1,3}\s+(?=[A-Z])/u, "");
  if (withoutLeadingFootnote !== literalQuote
      && rawSetupLiteralIncludes(withoutLeadingFootnote, page.text)) {
    literalQuote = withoutLeadingFootnote;
  }
  const focusedLiteralMinimum = entry.source.derivation === "literal-actor-control"
    ? 1
    : entry.source.derivation === "literal-explicit-input" ? 2 : 4;
  const narrowSourcePhrase = specificSourceSetupPhrase(entry, category);
  const focusedCandidate = (/^(?:literal-parameter-gloss|literal-explicit-input|literal-actor-control)$/.test(entry.source.derivation || "")
    && setupLiteralTokens(entry.source.matchedText).length >= focusedLiteralMinimum
      ? String(entry.source.matchedText).trim()
      : "") || narrowSourcePhrase;
  const focusedLiteral = focusedCandidate && (rawSetupLiteralIncludes(focusedCandidate, page.text)
    ? focusedCandidate
    : remapNormalizedSourceQuote(focusedCandidate, page.text));
  const focusedMathContainer = (/^(?:literal-parameter-gloss|literal-explicit-input|literal-actor-control)$/.test(entry.source.derivation || "")
      || Boolean(narrowSourcePhrase))
    && /[=<>≤≥∈∑∫{}]/u.test(literalQuote || "");
  const cleanSubclause = literalQuote
    ? cleanLiteralQuoteSubclause(
      literalQuote,
      page.text,
      `${entry.value || ""} ${entry.source.matchedText || ""}`,
      entry.value
    )
    : "";
  // Prefer a clean literal subclause when the full raw sentence contains an
  // unrelated split word or extraction artifact. Both alternatives remain
  // strict raw-page substrings; this only narrows the citation boundary.
  if (focusedLiteral && (!literalQuote
      || !rawSetupLiteralIncludes(literalQuote, page.text)
      || hasExtractionNoise(literalQuote)
      || formulaContaminatedProse(literalQuote, page.text, { conservative: true })
      || focusedMathContainer
      || organizationProse(literalQuote)
      || isBoilerplate(literalQuote)
      || isCaption(literalQuote)
      || isCitation(literalQuote)
      || isTableRow(literalQuote))) {
    literalQuote = focusedLiteral;
  }
  if (cleanSubclause && (!literalQuote || unusableLiteralQuote(literalQuote, page.text))) {
    literalQuote = cleanSubclause;
  }
  if (!literalQuote
      && /^(?:literal-parameter-gloss|literal-explicit-input|literal-actor-control)$/.test(entry.source.derivation || "")
      && setupLiteralTokens(entry.source.matchedText).length >= focusedLiteralMinimum
      && rawSetupLiteralIncludes(entry.source.matchedText, page.text)) {
    literalQuote = String(entry.source.matchedText).trim();
  }
  if (!literalQuote && entry.source.matchedText) {
    const normalizedQuote = cleanText(originalQuote);
    const normalizedMatch = cleanText(entry.source.matchedText);
    const matchIndex = normalizedQuote.toLowerCase().indexOf(normalizedMatch.toLowerCase());
    if (matchIndex >= 0) {
      const prefix = normalizedQuote.slice(0, matchIndex);
      const action = prefix.match(/\b(?:accepts?|admits?|adjusts?|allocates?|assigns?|charges?|chooses?|decides?(?:\s+(?:on|about))?|determines?|offers?|orders?|prices?|selects?|sets?)\s*$/i)?.[0] || "";
      const actionClause = `${action}${normalizedQuote.slice(matchIndex, matchIndex + normalizedMatch.length)}`.trim();
      if (setupLiteralTokens(actionClause).length >= 3
          && rawSetupLiteralIncludes(actionClause, page.text)) {
        literalQuote = actionClause;
      }
    }
  }
  if (!literalQuote) {
    const wantedKey = setupLiteralKey(originalQuote);
    const valueKey = setupLiteralKey(entry.value);
    const wantedTokens = setupLiteralTokens(originalQuote);
    const candidates = literalSourceSentenceCandidates(page.text, {
      minWords: 5,
      maxWords: 120
    }).map((quote) => {
      const candidateKey = setupLiteralKey(quote);
      const candidateTokens = new Set(setupLiteralTokens(quote));
      const shared = wantedTokens.reduce((count, token) => count + (candidateTokens.has(token) ? 1 : 0), 0);
      const coverage = wantedTokens.length ? shared / wantedTokens.length : 0;
      const exact = Boolean(wantedKey) && candidateKey === wantedKey;
      const nested = Boolean(wantedKey) && (candidateKey.includes(wantedKey) || wantedKey.includes(candidateKey));
      const containsValue = Boolean(valueKey) && candidateKey.includes(valueKey);
      const eligible = exact || (containsValue && (nested || (shared >= 4 && coverage >= 0.6)));
      return {
        quote,
        eligible,
        score: (exact ? 10_000 : 0) + (nested ? 1_000 : 0) + (containsValue ? 100 : 0) + shared * 3 + coverage
      };
    }).filter((candidate) => candidate.eligible)
      .sort((left, right) => right.score - left.score || left.quote.length - right.quote.length);
    literalQuote = candidates[0]?.quote || "";
  }
  if (!literalQuote) return entry;

  const source = { ...entry.source, quote: literalQuote };
  // `matchedText` is optional provenance detail.  A normalized copy that is
  // absent from the raw quote would fail the strict containment audit even
  // when the containing quote itself has been recovered exactly (notably for
  // PDF ligatures), so let the literal quote be the container in that case.
  if (source.matchedText && !rawSetupLiteralIncludes(source.matchedText, literalQuote)) {
    delete source.matchedText;
  }
  return { ...entry, source };
}

function literalSetupEvidence(entry, pages = [], category = "") {
  const value = cleanText(entry?.value).toLowerCase();
  const source = entry?.source || {};
  const support = cleanText(source.matchedText || source.quote).toLowerCase();
  const recognizedSourcePattern = category === "decisions"
    && source.derivation === "literal-source-pattern"
    && Boolean(specificSourceSetupPhrase(entry, category));
  const focusedDerivation = /^(?:literal-parameter-gloss|literal-explicit-input|literal-actor-control)$/.test(source.derivation || "")
    || recognizedSourcePattern;
  // A raw ligature can make the normalized matchedText fail byte containment
  // and therefore be removed during remapping. The narrowed raw quote itself
  // still provides the same focused support for these explicit derivations.
  const focusedMatch = cleanText(source.matchedText || (focusedDerivation ? source.quote : ""));
  const focusedLiteralSupport = focusedMatch
    && cleanText(source.quote).includes(focusedMatch)
    && !hasExtractionNoise(focusedMatch)
    && !/[=<>≤≥∑∫{}]|\b(?:arg\s*(?:min|max)|exp|log)\s*\(/i.test(focusedMatch)
    && (setupLiteralTokens(focusedMatch).length >= 2
      || (category === "entities"
        && source.derivation === "literal-actor-control"
        && setupLiteralTokens(focusedMatch).length >= 1)
      || (category === "entities" && /^(?:editors?|manuscripts?|planners?|reviewers?)$/i.test(focusedMatch)));
  if (!value || !support || !support.includes(value)) return false;
  const setupSourceText = `${entry?.value || ""} ${source.matchedText || ""} ${source.quote || ""}`;
  const supplierEquilibriumNotation = /\$(?:C|U)\b/u.test(setupSourceText)
    && /\b(?:buyers?|supplier|sourc(?:e|es|ed|ing))\b/iu.test(setupSourceText);
  // The evidence quote stays literal, but a setup value is rendered as plain
  // prose. Never copy a source backslash into that display value. A different
  // clean setup phrase can still cite the same unchanged source sentence.
  if (supplierEquilibriumNotation || String(entry?.value ?? "").includes("\\")
    || residualAuthoredBackslash(setupSourceText) || rawSetupMathMarkup(setupSourceText)
    || hasExtractionNoise(entry?.value) || hasExtractionNoise(source.matchedText)
    || hasExtractionNoise(source.quote) || organizationProse(source.quote)
    || backgroundOnlyProse(source.quote) || isBoilerplate(source.quote)
    || isCaption(source.quote) || isCitation(source.quote) || isTableRow(source.quote)) return false;
  if (isBoilerplate(entry?.value) || isCaption(entry?.value) || isCitation(entry?.value) || isTableRow(entry?.value)
    || organizationProse(entry?.value) || displayOrResultOnlyProse(entry?.value)) return false;
  if (source.type !== "section") return source.type === "record" || source.type === "abstract";
  const page = pages.find((item) => Number(item.page) === Number(source.page));
  if (!page || !source.quote || sourceHeadingRejectionReason(source.section)
      || (!readableProse(source.quote) && !focusedLiteralSupport)
      || organizationProse(source.quote)) return false;
  // A clean literal phrase remains valid setup evidence when unrelated inline
  // notation appears elsewhere in its containing sentence. This is common in
  // parameter definitions and stage descriptions in older two-column PDFs.
  if (formulaContaminatedProse(source.quote, page.text, { conservative: true }) && !focusedLiteralSupport) return false;
  return rawSetupLiteralIncludes(source.quote, page.text);
}

export function materializeSetup(setup, fallback, options = {}) {
  const values = {};
  const setupEvidence = {};
  const setupMaturity = {};
  const fallbackFields = [];
  const unresolvedFields = [];
  for (const [field, semanticField] of SETUP_FIELD_MAP) {
    const remappedEvidence = cloneSetupEntries(setup?.evidence?.[semanticField])
      .map((entry) => remapSetupEntryToLiteralPage(entry, options.pages, semanticField));
    const localEvidence = remappedEvidence
      .filter((entry) => literalSetupEvidence(entry, options.pages, semanticField));
    const supported = new Set(localEvidence.map((entry) => cleanText(entry.value).toLowerCase()));
    const localValues = distinct(setup?.[semanticField] || [], 16)
      .filter((value) => supported.has(cleanText(value).toLowerCase()))
      .slice(0, 5);
    const hasLocal = localValues.length > 0;
    const inheritedValues = distinct(fallback?.[field] || [], 5);
    values[field] = hasLocal ? localValues : inheritedValues;
    if (hasLocal) {
      const retained = new Set(localValues.map((value) => cleanText(value).toLowerCase()));
      setupEvidence[field] = localEvidence
        .filter((entry) => retained.has(cleanText(entry?.value).toLowerCase()));
      setupMaturity[field] = setup?.maturity?.[semanticField] || "source-derived";
    } else if (inheritedValues.length) {
      fallbackFields.push(field);
      setupEvidence[field] = cloneSetupEntries(options.fallbackEvidence?.[field]);
      setupMaturity[field] = options.fallbackMaturity?.[field] || "unresolved";
    } else {
      unresolvedFields.push(field);
      setupEvidence[field] = [];
      setupMaturity[field] = "unresolved";
    }
  }
  const setupDiagnostics = [
    ...(setup?.diagnostics || []).map((entry) => ({ ...entry })),
    ...fallbackFields.map((field) => ({
      code: options.fallbackCode || "setup_authoring_fallback_used",
      category: field,
      message: options.fallbackMessage || `The ${field} field uses the authoring fallback because local source extraction was unresolved.`
    })),
    ...unresolvedFields.map((field) => ({
      code: "setup_unresolved_after_source_reading",
      category: field,
      message: `No conservative source-supported ${field} entry was retained.`
    }))
  ];
  return { ...values, setupEvidence, setupMaturity, setupDiagnostics };
}

const WHOLE_PAPER_SETUP_EXCLUSION = /\b(?:references|bibliography|acknowledg(?:e)?ments?|related\s+(?:work|literature)|literature\s+review|online\s+appendix|supplemental\s+material)\b/i;
const WHOLE_PAPER_SETUP_HEADING = /\b(?:model(?:ing)?|formulation|problem\s+(?:definition|formulation)|setting|setup|framework|environment|timing|assumptions?|information\s+structure|demand\s+model|decision\s+problem|objective|constraints?|game|system\s+model|process\s+model|mechanism|optimal|optimization\s+(?:model|problem)|estimation\s+(?:model|procedure))\b/i;
const SETUP_ROLE_PRIORITY = Object.freeze({
  objects: ["interaction", "decision", "preference", "process", "state", "information", "objective", "constraint", "algorithm", "estimation"],
  inputs: ["information", "state", "preference", "process", "constraint", "estimation", "decision", "objective", "algorithm", "interaction"],
  decisions: ["decision", "objective", "algorithm", "estimation", "interaction", "constraint", "process", "state", "information", "preference"],
  assumptions: ["constraint", "information", "state", "process", "preference", "interaction", "decision", "objective", "algorithm", "estimation"]
});

function wholePaperSetupSections(record, pages, sections) {
  const referencePage = Math.min(...sections
    .filter((section) => /^(?:\d+(?:\.\d+)*[.)]?\s+)?(?:references|bibliography)\b/i.test(authoredEnglish(section.title)))
    .map((section) => Number(section.page))
    .filter(Number.isFinite));
  return pages.filter((page) => !Number.isFinite(referencePage) || Number(page.page) < referencePage)
    .map((page) => {
      const covering = sections.filter((section) => Number(section.page) <= Number(page.page)
        && Number(section.endPage ?? section.page) >= Number(page.page))
        .sort((left, right) => Number(right.page) - Number(left.page)
          || String(right.number || "").split(".").length - String(left.number || "").split(".").length);
      const local = covering.find((section) => {
        const label = authoredEnglish(section.title);
        const lineage = [label, ...(section.ancestorTitles || [])].join(" ");
        return label && WHOLE_PAPER_SETUP_HEADING.test(lineage)
          && !WHOLE_PAPER_SETUP_EXCLUSION.test(lineage)
          && !sourceHeadingRejectionReason(label)
          && !nearPaperTitle(label, record.title);
      });
      if (!local) return null;
      return {
        title: authoredEnglish(local.title),
        ancestorTitles: local?.ancestorTitles || [],
        page: Number(page.page),
        endPage: Number(page.page),
        text: String(page.text || ""),
        setupScope: "whole-paper"
      };
    })
    .filter((section) => section?.text.trim());
}

function pageContainingLiteral(pages, value, preferredPage = 0) {
  const wanted = cleanText(value);
  if (!wanted) return null;
  return pages.find((page) => (!preferredPage || Number(page.page) === Number(preferredPage))
    && cleanText(page.text).includes(wanted))
    || pages.find((page) => cleanText(page.text).includes(wanted))
    || null;
}

function setupPhraseFromQuote(field, quote) {
  const text = cleanText(quote);
  const patterns = {
    objects: [
      /\b((?:(?:a|an|the|each|every|one|two|multiple|several|competing|strategic|heterogeneous|representative|focal|online|offline)\s+){0,4}(?:decision\s+makers?|agencies|agents?|advertisers?|batteries|bidders?|buyers?|clients?|consumers?|customers?|developers?|drivers?|firms?|hospitals?|manufacturers?|markets?|networks?|nodes?|organizations?|patients?|platforms?|products?|providers?|retailers?|sellers?|servers?|stations?|suppliers?|vendors?|vehicles?|workers?))\b/i
    ],
    inputs: [
      /\b((?:(?:a|an|the)\s+)?exogenously\s+given\s+(?:fee|parameter|price|rate))\b/i,
      /\b((?:(?:a|an|the|each|observed|observable|unobserved|unknown|uncertain|random|stochastic|nonstationary|endogenous|exogenous|aggregate|private|public|noisy|initial|remaining|market|customer|product|service)\s+){0,5}(?:arrival\s+rates?|beliefs?|budgets?|capacity|characteristics?|costs?|data|demand|directed\s+acyclic\s+graphs?|distributions?|features?|forecasts?|horizons?|information|inventory|objective\s+functions?|observations?|outputs?|parameters?|prices?|probabilities|quality|queue\s+lengths?|service\s+rates?|signals?|states?|types?|valuations?))\b/i
    ],
    decisions: [
      /\b(?:adjusts?|allocates?|assigns?|bids?|charges?|chooses?|controls?|decides?|determines?|estimates?|fits?|infers?|invests?|loads?|locates?|monitors?|offers?|optimizes?|orders?|posts?|predicts?|prices?|produces?|routes?|schedules?|selects?|sets?|stocks?|trains?|unloads?)\s+((?:(?:a|an|the|each|its|their|optimal|retail|wholesale|service|inventory|production|quality|capacity|commission|admission|resource|pricing|stocking|scheduling|disclosure|investment|charging|loading|unloading|payment)\s+){0,5}(?:actions?|allocations?|assortments?|bids?|capacity|choices?|contracts?|decisions?|effort|fees?|investments?|locations?|mechanisms?|order\s+quantities|policies|prices?|production\s+levels?|quality|quantities|rates?|routes?|schedules?|strateg(?:y|ies)|timing))\b/i
    ]
  };
  for (const pattern of patterns[field] || []) {
    const match = text.match(pattern);
    const value = authoredEnglish(match?.[1]);
    if (!value || hasExtractionNoise(value)) continue;
    if (field === "inputs"
        && /^(?:(?:a|an|the)\s+)?(?:capacity|costs?|data|information|observation|parameters?|probabilities?|state)$/i.test(value)) continue;
    if (field === "objects" && /^(?:products?)$/.test(value)) continue;
    if (field === "inputs" && value.split(/\s+/).length < 2
      && !/\b(?:observ(?:e|es|ed|able)|known|given|exogenous(?:ly)?|endogenous(?:ly)?|unknown|uncertain|random|stochastic|distributed|parameteri[sz]ed)\b/i.test(text)) continue;
    if (field === "decisions" && /\bprice\s+takers?\b/i.test(text)) continue;
    return value;
  }
  return "";
}

function safeModeDecisionFromQuote(quote) {
  const text = authoredEnglish(quote);
  if (!text || !safeModeSetupValue(text)) return "";
  const patterns = [
    /\b((?:develops?|proposes?|constructs?|designs?|selects?|chooses?|performs?|orders?|allocates?|sets?|optimizes?|trains?|fine[-\s]?tunes?|augments?)\s+(?:(?:an?|the|its|their|our|this)\s+)?(?:[\p{L}'’\-]+\s+){0,8}(?:actions?|allocations?|approach|assortments?|bids?|capacity|choices?|constraints?|contracts?|decisions?|effort|fees?|framework|investments?|locations?|mechanisms?|method|model|order\s+quantities|pairs?|policies|prices?|procedure|production\s+levels?|quality|quantities|rates?|responses?|routes?|schedules?|strateg(?:y|ies)|tests?|timing))\b/iu,
    /\b((?:selecting|sequencing|choosing|ordering|allocating|designing|pricing|scheduling)\s+(?:(?:and|or)\s+(?:selecting|sequencing|choosing|ordering|allocating|designing|pricing|scheduling)\s+)?(?:[\p{L}'’\-]+\s+){0,8}(?:activities|actions?|assortments?|items?|orders?|policies|prices?|products?|resources?|services?))\b/iu,
    /\b((?:whether|which|what|when|where|how)\s+to\s+(?:[\p{L}'’\-]+\s+){1,14}[\p{L}'’\-]+)\b/iu
  ];
  for (const pattern of patterns) {
    const value = authoredEnglish(text.match(pattern)?.[1]);
    if (value && safeModeSetupValue(value)) return value;
  }
  return "";
}

function componentSetupCandidate(field, components, pages, options = {}) {
  const priorities = new Map((SETUP_ROLE_PRIORITY[field] || []).map((role, index) => [role, index]));
  const ordered = [...components].sort((left, right) => (priorities.get(left.role) ?? 99) - (priorities.get(right.role) ?? 99));
  if (field === "assumptions") {
    for (const component of ordered) {
      for (const condition of component.conditions || []) {
        const page = pageContainingLiteral(pages, condition, component.sources?.[0]?.page);
        const section = authoredEnglish(component.sources?.[0]?.section || component.label);
        if (!page || !section || sourceHeadingRejectionReason(section)) continue;
        if (options.formalEvidenceAllowed === false
            && (!safeModeSetupSection({ title: section }) || !safeModeLiteralProse(condition, page.text))) continue;
        const entry = {
          value: authoredEnglish(condition),
          source: {
            type: "section",
            section,
            page: Number(page.page),
            quote: cleanText(condition),
            matchedText: authoredEnglish(condition),
            derivation: "literal-component-condition"
          }
        };
        const remapped = remapSetupEntryToLiteralPage(
          entry,
          pages,
          SETUP_FIELD_MAP.find(([name]) => name === field)?.[1] || field
        );
        if (literalSetupEvidence(remapped, pages, "assumptions")) return remapped;
      }
    }
  }
  for (const component of ordered) {
    for (const source of component.sources || []) {
      const quote = cleanText(source.quote);
      const page = pageContainingLiteral(pages, quote, source.page);
      const section = authoredEnglish(source.section || component.label);
      if (!page || !section || sourceHeadingRejectionReason(section)) continue;
      if (options.formalEvidenceAllowed === false
          && (!safeModeSetupSection({ title: section }) || !safeModeLiteralProse(quote, page.text))) continue;
      let value = setupPhraseFromQuote(field, quote);
      if (!value && field === "decisions" && options.formalEvidenceAllowed === false) {
        value = safeModeDecisionFromQuote(quote);
      }
      if (!value && field === "assumptions"
        && /\b(?:assum(?:e|es|ed|ing)|suppose|given|subject\s+to|under|we\s+(?:model|consider)|the\s+model\s+(?:has|contains|considers|assumes))\b/i.test(quote)) value = quote;
      if (!value && field === "objects") {
        const subject = quote.match(/^((?:A|An|The|Each|Every|One|Two|Multiple|Several)\s+(?:[\p{L}'’\-]+\s+){0,5}(?:agent|bidder|buyer|consumer|customer|decision\s+maker|firm|hospital|manufacturer|market|network|organization|patient|platform|product|provider|retailer|seller|server|station|supplier|vendor|vehicle|worker)s?)\b/u);
        value = authoredEnglish(subject?.[1]);
      }
      if (!value) continue;
      const entry = {
        value,
        source: {
          type: "section",
          section,
          page: Number(page.page),
          quote,
          matchedText: value,
          derivation: "literal-component-source-fallback"
        }
      };
      const remapped = remapSetupEntryToLiteralPage(
        entry,
        pages,
        SETUP_FIELD_MAP.find(([name]) => name === field)?.[1] || field
      );
      if (literalSetupEvidence(remapped, pages, SETUP_FIELD_MAP.find(([name]) => name === field)?.[1] || field)) return remapped;
    }
  }
  return null;
}

function safeModeSectionSetupCandidate(field, sections, pages) {
  const candidates = [];
  for (const section of sections || []) {
    if (!safeModeSetupSection(section)) continue;
    const sectionTitle = authoredEnglish(section.title);
    const sectionText = authoredEnglish(section.sourceText || section.text);
    const shortPatterns = field === "objects" ? [
      /\b((?:(?:a|an|the|each|every|one|two|multiple|several|competing|strategic|heterogeneous|representative|focal|online|offline|selected|candidate)\s+){0,4}(?:activities|decision\s+makers?|advertisers?|bidders?|buyers?|clients?|consumers?|customers?|experts?|firms?|hospitals?|markets?|networks?|nodes?|patients?|platforms?|products?|providers?|receivers?|retailers?|senders?|sellers?|service\s+designers?|suppliers?|workers?))\b/iu
    ] : field === "decisions" ? [
      /\b(?:is|are|denotes?|represents?)\s+((?:the|an?)\s+(?:order\s+quantit(?:y|ies)|decision\s+variables?|selection|sequence|schedule|policy|price))\b/iu,
      /\b((?:selecting|sequencing|choosing|ordering|allocating|designing|pricing|scheduling)\s+(?:(?:and|or)\s+(?:selecting|sequencing|choosing|ordering|allocating|designing|pricing|scheduling)\s+)?(?:activities|actions?|assortments?|items?|orders?|policies|prices?|products?|resources?|services?))\b/iu
    ] : field === "inputs" ? [
      /\b((?:(?:an?|the|each)\s+)?(?:(?:observed|observable|unobserved|unknown|uncertain|random|stochastic|nonstationary|endogenous|exogenous|aggregate|private|public|noisy|initial|remaining|market|customer|product|service|given|fixed)\s+){1,3}(?:arrival\s+rate|belief|budget|capacity|characteristic|cost|data|demand|distribution|duration|feature|forecast|horizon|information|inventory|observation|parameter|price|probability|quality|rate|signal|state|type|utility|valuation)s?)\b/iu
    ] : [];
    for (const pattern of shortPatterns) {
      const value = authoredEnglish(sectionText.match(pattern)?.[1]);
      if (!value || !safeModeSetupValue(value)) continue;
      const page = pages.find((candidate) => Number(candidate?.page) >= Number(section.page)
        && Number(candidate?.page) <= Number(section.endPage ?? section.page)
        && isWhitespaceNormalizedSubstring(value, candidate?.text || ""));
      if (!page || !safeModeSetupQuote(value, page.text)) continue;
      candidates.push({
        entry: {
          value,
          source: {
            type: "section",
            section: sectionTitle,
            page: Number(page.page),
            quote: value,
            matchedText: value,
            derivation: "literal-safe-mode-defined-phrase"
          }
        },
        score: 18
      });
    }
    const literalPageSentences = pages
      .filter((page) => Number(page?.page) >= Number(section.page)
        && Number(page?.page) <= Number(section.endPage ?? section.page))
      .flatMap((page) => literalSourceSentenceCandidates(page.text, { minWords: 4, maxWords: 90 }))
      .filter((sentence) => cleanText(section.sourceText || section.text).includes(cleanText(sentence)));
    for (const sentence of distinct([
      ...sentenceList(section.sourceText || section.text),
      ...literalPageSentences
    ])) {
      const quote = authoredEnglish(sentence);
      const page = pages.find((candidate) => Number(candidate?.page) >= Number(section.page)
        && Number(candidate?.page) <= Number(section.endPage ?? section.page)
        && isWhitespaceNormalizedSubstring(quote, candidate?.text || ""));
      if (!page || !safeModeLiteralProse(quote, page.text)
          || resultAssertionProse(quote)
          || /\b(?:theorem|proposition|lemma|corollary|proof|simulation|experiment|empirical\s+(?:analysis|investigation)|we\s+(?:find|show|observe|demonstrate))\b/iu.test(quote)) continue;
      let value = setupPhraseFromQuote(field, quote);
      if (field === "decisions" && !value) value = safeModeDecisionFromQuote(quote);
      if (field === "objects" && !value) {
        value = authoredEnglish(quote.match(/\b((?:(?:a|an|the|each|every|one|two|multiple|several|competing|strategic|heterogeneous|representative|focal|online|offline|selected|candidate)\s+){0,4}(?:activities|decision\s+makers?|agencies|agents?|advertisers?|batteries|bidders?|buyers?|clients?|consumers?|customers?|developers?|drivers?|experts?|firms?|hospitals?|manufacturers?|markets?|networks?|nodes?|organizations?|patients?|platforms?|products?|providers?|receivers?|retailers?|senders?|sellers?|servers?|service\s+designers?|stations?|suppliers?|vendors?|vehicles?|workers?))\b/iu)?.[1]);
      }
      if (field === "assumptions" && !value
          && /\b(?:assum(?:e|es|ed|ing)|suppose|given|we\s+(?:consider|model)|is\s+(?:known|fixed|given|observed|unknown)|are\s+(?:known|fixed|given|observed|unknown)|follows?\s+(?:a|an|the)|consists?\s+of|contains?|reveals?|does\s+not|cannot|before|after|subject\s+to|under\s+(?:the|our|this))\b/iu.test(quote)) {
        value = quote;
      }
      if (!value || !safeModeSetupValue(value)) continue;
      const entry = remapSetupEntryToLiteralPage({
        value,
        source: {
          type: "section",
          section: sectionTitle,
          page: Number(page.page),
          quote,
          matchedText: value,
          derivation: "literal-safe-mode-section-setup"
        }
      }, pages, SETUP_FIELD_MAP.find(([name]) => name === field)?.[1] || field);
      const semanticField = SETUP_FIELD_MAP.find(([name]) => name === field)?.[1] || field;
      if (!literalSetupEvidence(entry, pages, semanticField)
          || !safeModeSetupQuote(entry.source?.quote, page.text)) continue;
      const explicitCue = field === "assumptions"
        ? /\b(?:assum(?:e|es|ed|ing)|suppose|given|known|fixed|subject\s+to)\b/iu.test(quote)
        : field === "decisions"
          ? /\b(?:chooses?|decides?|selects?|sets?|orders?|allocates?|designs?|develops?|proposes?|constructs?|optimizes?|performs?)\b/iu.test(quote)
          : 0;
      const headingBonus = /^(?:model|problem|formulation|setup|notations?|preliminaries)\b/iu.test(sectionTitle) ? 8 : 0;
      candidates.push({
        entry,
        score: (explicitCue ? 12 : 0) + headingBonus + Math.min(8, overlapScore(sectionTitle, quote))
          - Math.min(6, Math.floor(quote.split(/\s+/u).length / 20))
      });
    }
  }
  return candidates.sort((left, right) => right.score - left.score
    || Number(left.entry.source.page) - Number(right.entry.source.page)
    || left.entry.value.length - right.entry.value.length)[0]?.entry || null;
}

function requireCompleteSetup(record, setup, components, pages, options = {}) {
  const completed = structuredClone(setup);
  for (const field of SETUP_FIELDS) {
    if ((completed[field] || []).length) continue;
    const entry = componentSetupCandidate(field, components, pages, options)
      || (options.formalEvidenceAllowed === false
        ? safeModeSectionSetupCandidate(field, options.setupSections || [], pages)
        : null);
    if (!entry) continue;
    completed[field] = [entry.value];
    completed.setupEvidence[field] = [entry];
    completed.setupMaturity[field] = "source-derived";
    completed.setupDiagnostics = completed.setupDiagnostics
      .filter((diagnostic) => !(String(diagnostic?.code || "").includes("unresolved")
        || String(diagnostic?.code || "").includes("source_exhausted"))
        || ![field, SETUP_FIELD_MAP.find(([name]) => name === field)?.[1]].includes(diagnostic?.category))
      .concat({
        code: "setup_completed_from_component_source",
        category: field,
        message: `The ${field} field was completed from a literal source anchor retained by the component map.`
      });
  }
  const missing = SETUP_FIELDS.filter((field) => !(completed[field] || []).length
    || !(completed.setupEvidence?.[field] || []).length);
  if (missing.length) throw new Error(`${record.id}: source-grounded model setup is incomplete (${missing.join(", ")})`);
  return completed;
}

function setupEvidenceForComponent(modelSetup, component, fields = ["assumptions", "inputs"], options = {}) {
  // Setup evidence is inherited rather than a component source.  Test its
  // applicability against the component's own semantics; otherwise the same
  // setup quote can make itself appear relevant merely because it was copied
  // into the component source list.
  const focus = componentConditionLocalText(component, { includeSources: false });
  const componentPages = new Set((component.sources || []).map((source) => Number(source?.page)).filter(Number.isFinite));
  const componentSections = new Set((component.sources || [])
    .map((source) => normalizedSourceSection(source?.section))
    .filter(Boolean));
  const candidates = fields.flatMap((field) => (modelSetup.setupEvidence?.[field] || []).flatMap((entry) => {
    const sourceQuote = authoredEnglish(entry?.source?.quote);
    const matchedText = authoredEnglish(entry?.source?.matchedText);
    const sourcePage = Number(entry?.source?.page);
    const sourceSection = normalizedSourceSection(entry?.source?.section);
    const samePage = Number.isFinite(sourcePage) && componentPages.has(sourcePage);
    const sameSection = Boolean(sourceSection && componentSections.has(sourceSection));
    const sourceIsLocal = Number.isFinite(sourcePage)
      ? [...componentPages].some((page) => Math.abs(page - sourcePage) <= 1)
        || sameSection
      : entry?.source?.type === "record" || entry?.source?.type === "abstract";
    if (!sourceIsLocal) return [];
    const conditionCandidates = distinct([
      authoredEnglish(entry?.value),
      ...sentenceList(matchedText),
      matchedText,
      ...sentenceList(sourceQuote),
      sourceQuote
    ]).filter((condition) => {
      if (!substantiveSourceCondition(condition)) return false;
      if (options.mathematicalOnly && !CONDITION_MATH_SIGNAL.test(condition)) return false;
      // Page/section proximity proves provenance, not semantic applicability.
      // Even a mathematical premise on the exact page needs a non-generic
      // token in the component itself.
      return hasConditionLocalityOverlap(focus, condition);
    });
    return conditionCandidates.map((condition) => ({
      field,
      entry,
      condition,
      score: overlapScore(focus, condition) + (sameSection ? 2 : 0) + (samePage ? 3 : 0),
    })).filter((candidate) => candidate.score > 0);
  }));
  return candidates.sort((left, right) => right.score - left.score
    || (left.field === "assumptions" ? -1 : 1)
    || left.condition.length - right.condition.length)[0] || null;
}

function completeComponentParity(component, modelSetup, conceptDefinitions, paperId, diagnostics = null) {
  let completed = structuredClone(component);
  const retainedConditions = distinct((completed.conditions || [])
    .map(authoredEnglish)
    .filter((condition, conditionIndex) => locallyApplicableCondition(completed, condition, { conditionIndex })), 3);
  const localVariantCondition = (completed.sources || [])
    .map((source, sourceIndex) => ({ condition: authoredEnglish(source?.quote), sourceIndex }))
    .find(({ condition }) => (VARIANT_CHANGE_CONDITION.test(condition)
        || MODELING_DECLARATION_CONDITION.test(condition)
        || explicitLocalVariantCondition(condition))
      && sourceModelsCondition(condition)
      && hasSourceOverlap(componentConditionFocus(completed), condition));
  completed.conditions = localVariantCondition
    ? distinct([localVariantCondition.condition, ...retainedConditions], 3)
    : retainedConditions;
  if (localVariantCondition) {
    completed.conditionEvidence = [{
      conditionIndex: 0,
      componentSourceRef: localVariantCondition.sourceIndex,
      derivation: VARIANT_CHANGE_CONDITION.test(localVariantCondition.condition)
        || explicitLocalVariantCondition(localVariantCondition.condition)
        ? "literal-component-source-variant-change"
        : "literal-component-source-modeling-declaration"
    }];
  }
  if (!completed.conditions.length) {
    const localSourceCondition = (completed.sources || [])
      .map((source) => authoredEnglish(source?.quote))
      .find((condition) => sourceModelsCondition(condition)
        && hasSourceOverlap(componentConditionFocus(completed), condition));
    if (localSourceCondition) {
      completed.conditions = [localSourceCondition];
      completed.conditionEvidence = [{
        conditionIndex: 0,
        componentSourceRef: 0,
        derivation: "literal-component-source-condition"
      }];
    }
  }
  const appendInheritedCondition = (inherited) => {
    const inheritedCondition = authoredEnglish(inherited?.condition);
    if (!inheritedCondition || completed.conditions.length >= 3) return false;
    const duplicate = completed.conditions.some((condition) =>
      normalizedConditionKey(condition) === normalizedConditionKey(inheritedCondition));
    if (duplicate) return false;
    const conditionIndex = completed.conditions.length;
    completed.conditions = distinct([...completed.conditions, inheritedCondition], 3);
    if (completed.conditions.length <= conditionIndex) return false;
    completed.conditionEvidence = [...(completed.conditionEvidence || []), {
      conditionIndex,
      inheritedFromSetupField: inherited.field,
      setupEvidence: structuredClone(inherited.entry)
    }];
    return true;
  };
  if (!completed.conditions.length) {
    appendInheritedCondition(setupEvidenceForComponent(modelSetup, completed));
  }
  // A component can already have a usable local condition while a second,
  // mathematically explicit assumption in the same page/section defines its
  // regime. Preserve that assumption instead of consulting setup only as an
  // empty-condition fallback. The existing setup selector still requires
  // page/section locality plus lexical overlap, and the supplement is limited
  // to assumptions with an explicit mathematical relation so model-wide setup
  // prose cannot be copied indiscriminately into every component.
  const localAssumption = setupEvidenceForComponent(modelSetup, completed, ["assumptions"], {
    mathematicalOnly: true
  });
  const localAssumptionCondition = authoredEnglish(localAssumption?.condition);
  if (CONDITION_MATH_SIGNAL.test(localAssumptionCondition)) appendInheritedCondition(localAssumption);
  if (!completed.conditions.length) {
    diagnostics?.push({ componentId: completed.id, reason: "no source-grounded condition" });
    return null;
  }
  attachAutomatedRelevance(completed, conceptDefinitions);
  let modeled = (completed.conceptBindings || []).filter((binding) => binding.status === "modeled"
    && (binding.conditionRefs || []).length && (binding.sourceRefs || []).length);
  // If heading-led role classification cannot materialize a binding, retry only
  // roles that the retained literal source itself supports.  This handles mixed
  // headings such as an equilibrium discussion whose actual local rule is the
  // firm's decision, while keeping the same sources and substantive conditions.
  if (!modeled.length) {
    const sourceQuotes = (completed.sources || []).map((source) => source?.quote).filter(Boolean);
    const alternateRoles = completed.role === "interaction"
      && sourceQuotes.some((quote) => sourceSupportsRole("decision", quote))
      ? ["decision"]
      : [];
    for (const role of alternateRoles) {
      const reclassified = structuredClone(completed);
      reclassified.role = role;
      if (reclassified.formalKind === "Atlas restatement of source rule") {
        reclassified.formal = sourceRestatement(role, reclassified.explanation, reclassified.symbols);
      }
      attachAutomatedRelevance(reclassified, conceptDefinitions);
      const reclassifiedModeled = (reclassified.conceptBindings || []).filter((binding) => binding.status === "modeled"
        && (binding.conditionRefs || []).length && (binding.sourceRefs || []).length);
      if (!reclassifiedModeled.length) continue;
      completed = reclassified;
      modeled = reclassifiedModeled;
      break;
    }
  }
  if (!modeled.length) {
    diagnostics?.push({ componentId: completed.id, reason: "no condition-and-source-bound modeled concept" });
    return null;
  }
  completed.conceptBindings = modeled;
  completed.concepts = distinct(modeled.map((binding) => binding.conceptId));
  if (!(completed.searchPhrases || []).some((phrase) => authoredEnglish(phrase))) {
    throw new Error(`${paperId}: ${completed.id} has no substantive search phrase`);
  }
  return completed;
}

function normalizedConditionKey(value) {
  return authoredEnglish(value).toLocaleLowerCase();
}

function conditionRestatesLocalSource(candidate, localConditions) {
  const candidateTokens = sourceSemanticTokens(candidate);
  if (candidateTokens.length < 10) return false;
  return localConditions.some((localCondition) => {
    const localTokens = sourceSemanticTokens(localCondition);
    if (localTokens.length < 10) return false;
    const prefixLength = Math.min(10, candidateTokens.length, localTokens.length);
    if (candidateTokens.slice(0, prefixLength).join(" ") !== localTokens.slice(0, prefixLength).join(" ")) return false;
    const localSet = new Set(localTokens);
    const shared = new Set(candidateTokens.filter((token) => localSet.has(token))).size;
    return shared / Math.min(new Set(candidateTokens).size, localSet.size) >= 0.7;
  });
}

function conditionDuplicatesPublicExplanation(condition, explanation) {
  const rawCondition = authoredEnglish(condition);
  if (!/^however,\s+/i.test(rawCondition)) return false;
  const withoutDiscourseLead = normalizeAuthoredDisplayProse(
    cleanText(rawCondition).replace(/^however,\s+/i, "")
  );
  const authoredCondition = rewriteSourceVoice(rawCondition);
  // A condition may legitimately define the model even when its independently
  // authored explanation has the same wording (for example, "We consider ..."
  // or "Following ..., we first analyze ..."). Suppress duplication only when
  // the two public strings became equal solely because the orphaned standalone
  // discourse connector "However," was removed. Any additional voice rewrite
  // means that the literal source predicate still carries distinct evidence.
  return authoredCondition
    && normalizedConditionKey(authoredCondition) === normalizedConditionKey(explanation)
    && normalizedConditionKey(authoredCondition) === normalizedConditionKey(withoutDiscourseLead);
}

function normalizedComponentAnchor(source) {
  const quote = authoredEnglish(source?.quote).toLocaleLowerCase();
  if (!quote) return "";
  return [
    Number(source?.page) || 0,
    normalizedSourceSection(source?.section),
    authoredEnglish(source?.equation).toLocaleLowerCase(),
    quote
  ].join("|");
}

function componentSubstanceFingerprint(component) {
  const normalizedList = (values) => (Array.isArray(values) ? values : [])
    .map((value) => authoredEnglish(value).toLocaleLowerCase())
    .filter(Boolean)
    .sort();
  const symbols = (component?.symbols || []).map((symbol) => ({
    symbol: authoredEnglish(symbol?.symbol).toLocaleLowerCase(),
    meaning: authoredEnglish(symbol?.meaning).toLocaleLowerCase()
  })).sort((left, right) => `${left.symbol}|${left.meaning}`.localeCompare(`${right.symbol}|${right.meaning}`));
  const bindings = (component?.conceptBindings || []).map((binding) => ({
    conceptId: authoredEnglish(binding?.conceptId).toLocaleLowerCase(),
    status: authoredEnglish(binding?.status).toLocaleLowerCase(),
    representation: authoredEnglish(binding?.representation).toLocaleLowerCase()
  })).sort((left, right) => `${left.conceptId}|${left.status}|${left.representation}`
    .localeCompare(`${right.conceptId}|${right.status}|${right.representation}`));
  const signature = {
    role: authoredEnglish(component?.role).toLocaleLowerCase(),
    explanation: authoredEnglish(component?.explanation).toLocaleLowerCase(),
    formalKind: authoredEnglish(component?.formalKind).toLocaleLowerCase(),
    formal: authoredEnglish(component?.formal).toLocaleLowerCase(),
    concepts: normalizedList(component?.concepts),
    symbols,
    bindings
  };
  if (!signature.role && !signature.explanation && !signature.formal && !signature.bindings.length) return "";
  return sha256(JSON.stringify(signature));
}

function componentRetentionPriority(component) {
  let priority = 0;
  if (component?.id === "objective-and-constraints") priority += 1_000;
  if (/source-extracted|atlas normalized notation|reviewed/iu.test(authoredEnglish(component?.formalKind))) priority += 500;
  if ((component?.symbols || []).length) priority += 100;
  if (["objective", "constraint"].includes(component?.role)) priority += 50;
  return priority;
}

function conditionRetentionPriority(condition, { localSource = false } = {}) {
  const text = authoredEnglish(condition);
  let priority = localSource ? 8 : 0;
  if (/^(?:we\s+assume|assume|suppose|under\s+the\s+assumption|provided\s+that|subject\s+to|conditional\s+on|given\s+that|if\b|when\b)/i.test(text)) priority += 100;
  if (VARIANT_CHANGE_CONDITION.test(text)) priority += 200;
  if (explicitLocalVariantCondition(text)) priority += 200;
  if (MODELING_DECLARATION_CONDITION.test(text)) priority += 105;
  if (VARIANT_LOCAL_INVARIANT_CONDITION.test(text)) priority += 90;
  if (CONDITION_MATH_SIGNAL.test(text)) priority += 45;
  if (/\b(?:independent(?:ly)?|unknown|uncertain|observable|unobservable|nonnegative|positive|bounded|fixed|constant)\b/i.test(text)) priority += 20;
  if (/\b(?:choos(?:e|es)|set(?:s)?|select(?:s)?|allocat(?:e|es)|assign(?:s)?|decid(?:e|es)|determin(?:e|es))\b/i.test(text)
    && !explicitLocalVariantCondition(text)
    && !/^(?:if|when|suppose|assume|we\s+assume|under|provided|subject|conditional|given)\b/i.test(text)) priority -= 25;
  return priority;
}

export function finalizeNoteModels(inputModels, conceptDefinitions, paperId) {
  const models = [];
  for (const [modelIndex, model] of inputModels.entries()) {
    const retained = [];
    const seenSubstantiveComponents = new Map();
    const candidates = (model.components || [])
      .map((sourceComponent, sourceIndex) => ({ sourceComponent, sourceIndex }))
      .sort((left, right) => componentRetentionPriority(right.sourceComponent)
        - componentRetentionPriority(left.sourceComponent)
        || left.sourceIndex - right.sourceIndex);
    for (const { sourceComponent, sourceIndex } of candidates) {
      const component = structuredClone(sourceComponent);
      const anchors = (component.sources || []).map(normalizedComponentAnchor).filter(Boolean);
      if (!anchors.length) {
        continue;
      }
      const localConditions = (component.sources || [])
        .map((source) => authoredEnglish(source?.quote))
        .filter((condition) => sourceModelsCondition(condition)
          && hasSourceOverlap(componentConditionFocus(component), condition));
      const authoredOriginalConditions = (component.conditions || []).map(authoredEnglish);
      const originalConditions = authoredOriginalConditions
        .filter((condition) => condition
          && !conditionRestatesLocalSource(condition, localConditions));
      // Source anchors remain internal provenance. When another independently
      // supported condition is available, do not publish the primary quote a
      // second time merely because its standalone authored form is already the
      // component explanation (for example, after dropping a leading
      // "However,"). Binding and evidence indices are rebuilt below from the
      // retained condition list.
      const publicLocalConditions = originalConditions.length
        ? localConditions.filter((condition) =>
          !conditionDuplicatesPublicExplanation(condition, component.explanation))
        : localConditions;
      const localConditionKeys = new Set(publicLocalConditions.map(normalizedConditionKey));
      const conditions = distinct([
        ...publicLocalConditions,
        ...originalConditions
      ]).map((candidate, candidateIndex) => ({
        candidate,
        candidateIndex,
        localSource: localConditionKeys.has(normalizedConditionKey(candidate))
      })).filter(({ candidate }) => {
        const originalIndex = authoredOriginalConditions
          .findIndex((value) => normalizedConditionKey(value) === normalizedConditionKey(candidate));
        return candidate && locallyApplicableCondition(component, candidate, { conditionIndex: originalIndex });
      })
        .sort((left, right) => conditionRetentionPriority(right.candidate, right)
          - conditionRetentionPriority(left.candidate, left)
          || left.candidateIndex - right.candidateIndex)
        .map(({ candidate }) => candidate);
      if (!conditions.length) {
        continue;
      }
      const originalEvidence = Array.isArray(component.conditionEvidence) ? component.conditionEvidence : [];
      component.conditions = conditions;
      component.conditionEvidence = conditions.flatMap((condition, conditionIndex) => {
        const originalIndex = authoredOriginalConditions.findIndex((candidate) => normalizedConditionKey(candidate) === normalizedConditionKey(condition));
        const inherited = originalEvidence.find((entry) => entry?.conditionIndex === originalIndex);
        if (inherited) return [{ ...structuredClone(inherited), conditionIndex }];
        const componentSourceRef = (component.sources || [])
          .findIndex((source) => normalizedConditionKey(source?.quote) === normalizedConditionKey(condition));
        return componentSourceRef >= 0 ? [{
          conditionIndex,
          componentSourceRef,
          derivation: "literal-component-source-condition"
        }] : [];
      });
      attachAutomatedRelevance(component, conceptDefinitions);
      const modeled = (component.conceptBindings || []).filter((binding) => binding.status === "modeled"
        && (binding.conditionRefs || []).length && (binding.sourceRefs || []).length);
      if (!modeled.length) continue;
      component.conceptBindings = modeled;
      component.concepts = distinct(modeled.map((binding) => binding.conceptId));
      const fingerprint = componentSubstanceFingerprint(component);
      const priorAnchorSets = fingerprint ? seenSubstantiveComponents.get(fingerprint) || [] : [];
      // Equivalent prose under the same literal source anchor is duplicate
      // extraction. The same modeled rule printed under a distinct substantive
      // section is independent provenance and must remain available; otherwise
      // a later algorithm, relaxation, or contract section can disappear merely
      // because its concise explanation matches an earlier component.
      if (priorAnchorSets.some((priorAnchors) => anchors.some((anchor) => priorAnchors.has(anchor)))) {
        continue;
      }
      if (fingerprint) seenSubstantiveComponents.set(fingerprint, [
        ...priorAnchorSets,
        new Set(anchors)
      ]);
      retained.push({ component, sourceIndex });
    }
    const components = retained
      .sort((left, right) => left.sourceIndex - right.sourceIndex)
      .map((entry) => entry.component);
    if (!components.length) {
      if (modelIndex === 0) throw new Error(`${paperId}: no component retained a substantive local source anchor and condition`);
      continue;
    }
    models.push({ ...model, components });
  }
  if (!models.length) throw new Error(`${paperId}: no releasable source-grounded model remains`);
  return models;
}

function componentGroundedMethod(components) {
  for (const component of components) {
    if (!new Set(["algorithm", "estimation"]).has(component.role)) continue;
    for (const source of component.sources || []) {
      const quote = authoredEnglish(source?.quote);
      const section = authoredEnglish(source?.section);
      if (!quote || !section || hasExtractionNoise(quote) || hasExtractionNoise(section)) continue;
      const derived = deriveSubstantiveMethod({}, [{
        title: section,
        page: Number(source?.page) || 1,
        endPage: Number(source?.page) || 1,
        text: quote,
        sourceText: quote
      }]);
      const candidate = completeAuthoredSummary(derived.method, 2, 120);
      if (!candidate || hasExtractionNoise(candidate) || !isSubstantiveMethodStatement(candidate)) continue;
      return {
        method: candidate,
        maturity: derived.maturity || "source-derived",
        evidence: { componentId: component.id, source: structuredClone(source) },
        diagnostics: [{
          code: "method_recovered_from_component_source",
          message: "The procedural statement was recovered from the literal source anchor of an algorithm or estimation component."
        }]
      };
    }
  }
  return { method: "", maturity: "unresolved", evidence: null, diagnostics: [] };
}

export function recoverParentOptimizationObjectives(selectedSections) {
  return selectedSections.map((section) => {
    const title = authoredEnglish(section.title);
    if (!/\boptimization\s+model\b/i.test(title)) return section;

    // PDF column ordering can leave a numbered parent optimization heading
    // with only its roadmap while the first literal objective is bounded by
    // the immediately following optimal-control/constraint subsection. Let
    // that one source sentence ground the parent objective; the child section
    // remains available independently for its own feasibility component.
    const nearby = selectedSections
      .filter((candidate) => candidate !== section
        && Number(candidate.page) >= Number(section.page)
        && Number(candidate.page) <= Number(section.endPage ?? section.page) + 1
        && /\b(?:optimal control|constraints?|formulation|objective)\b/i.test(authoredEnglish(candidate.title)))
      .sort((left, right) => Number(left.page) - Number(right.page));
    for (const candidate of nearby) {
      const objective = sentenceList(candidate.sourceText || candidate.text).find((sentence) =>
        /^(?:our\s+goal|our\s+objective|we\s+(?:seek|aim|want))\b/i.test(sentence)
          && sourceSupportsRole("objective", sentence)
          && readableProse(sentence)
          && !organizationProse(sentence)
          && !displayOrResultOnlyProse(sentence));
      if (!objective) continue;
      const objectivePage = (candidate.sourceLines || candidate.lines || [])
        .find((line) => cleanText(line?.text) && cleanText(objective).includes(cleanText(line.text)))?.page
        || candidate.page;
      const objectiveLine = { page: Number(objectivePage) || Number(candidate.page), text: objective };
      return {
        ...section,
        endPage: Math.max(Number(section.endPage ?? section.page), Number(objectiveLine.page)),
        text: `${section.text || ""} ${objective}`,
        sourceText: `${section.sourceText || section.text || ""} ${objective}`,
        lines: [...(section.lines || []), objectiveLine],
        sourceLines: [...(section.sourceLines || section.lines || []), objectiveLine]
      };
    }
    return section;
  });
}

function recoverNestedDefinitionFormulations(selectedSections, pages) {
  return selectedSections.map((section) => {
    const title = authoredEnglish(section.title);
    const ownSentences = sentenceList(section.sourceText || section.text)
      .filter((sentence) => readableProse(sentence) && !organizationProse(sentence));
    if (!/\bdefinitions?\s+and\s+problem\s+formulation\b/i.test(title)
      || ownSentences.some((sentence) => /\b(?:defined|denoted|decision|select(?:s|ed)|subject\s+to|feasible)\b/i.test(sentence))) {
      return section;
    }

    // Some PDFs print a parent formulation heading at the bottom of one page
    // and begin its numbered Definitions subsection on the next. The section
    // index correctly stops the parent at that child, but the child heading can
    // be lost to a ligature/font map. Recover only literal sentences following
    // that numbered child marker and keep their original page anchors.
    const rootNumber = authoredEnglish(section.number).replace(/\.$/, "");
    const childMarker = rootNumber
      ? new RegExp(`(?:^|\\n)\\s*${rootNumber.replace(/\./g, "\\.")}\\.1\\.?\\s+[^\\n]+\\n`, "iu")
      : null;
    const recoveredLines = [];
    for (const page of pages) {
      if (Number(page.page) < Number(section.page) || Number(page.page) > Number(section.endPage ?? section.page)) continue;
      const raw = String(page.text || "");
      const marker = childMarker?.exec(raw);
      if (!marker) continue;
      const afterMarker = raw.slice(marker.index + marker[0].length);
      const peerMarker = rootNumber
        ? new RegExp(`(?:^|\\n)\\s*${rootNumber.replace(/\./g, "\\.")}\\.[2-9]\\.?\\s+`, "iu").exec(afterMarker)
        : null;
      const bounded = peerMarker ? afterMarker.slice(0, peerMarker.index) : afterMarker;
      const candidates = literalSourceSentenceCandidates(bounded, { minWords: 6, maxWords: 90 })
        .filter((sentence) => readableProse(sentence)
          && !organizationProse(sentence)
          && !backgroundOnlyProse(sentence)
          && !displayOrResultOnlyProse(sentence)
          && !formulaContaminatedProse(sentence, bounded))
        .filter((sentence) => /\b(?:transaction|dataset|itemset|hiding\s+threshold|saniti[sz]|owner\s+(?:select|wish)|defined|denoted)\b/i.test(sentence));
      for (const sentence of candidates.slice(0, 10)) {
        recoveredLines.push({ page: Number(page.page), text: sentence });
      }
    }
    if (!recoveredLines.length) return section;
    const recoveredText = recoveredLines.map((line) => line.text).join(" ");
    return {
      ...section,
      text: `${section.text || ""} ${recoveredText}`.trim(),
      sourceText: `${section.sourceText || section.text || ""} ${recoveredText}`.trim(),
      lines: [...(section.lines || []), ...recoveredLines],
      sourceLines: [...(section.sourceLines || section.lines || []), ...recoveredLines]
    };
  });
}

export function recoverPoolStructureDefinitions(selectedSections) {
  const structureParent = selectedSections.find((section) =>
    /\bpractical\s+pool\s+structures?\b/i.test(authoredEnglish(`${section.title} ${(section.sourceLines || section.lines || [])[0]?.text || ""}`)));
  if (!structureParent) return selectedSections;
  const parentSentences = sentenceList(structureParent.sourceText || structureParent.text);
  const definitionFor = (title) => {
    if (/\bone\s+pool\b/i.test(title)) {
      return parentSentences.find((sentence) => /\bshare\s+one\s+nurse\s+pool\b/i.test(sentence))
        || parentSentences.find((sentence) => /\bnurse\s+pool\s+shared\s+among\s+all\s+units\b/i.test(sentence));
    }
    if (/\bdisjoint\s+pools?\b/i.test(title)) {
      return parentSentences.find((sentence) => /\bnurse\s+pools?\s+are\s+dis\s*joint\b/i.test(sentence));
    }
    if (/\bchained\s+pools?\b/i.test(title)) {
      return parentSentences.find((sentence) => /\bevery\s+unit\s+is\s+covered\s+by\s+two\s+nurse\s+pools?\b/i.test(sentence))
        || parentSentences.find((sentence) => /\bnurse\s+pools?\s+form\s+a\s+(?:long\s+)?chain\b/i.test(sentence));
    }
    return "";
  };
  return selectedSections.map((section) => {
    const definition = definitionFor(authoredEnglish(section.title));
    if (!definition || cleanText(section.sourceText || section.text).includes(cleanText(definition))) return section;
    const parentLine = (structureParent.sourceLines || structureParent.lines || [])
      .find((line) => cleanText(definition).includes(cleanText(line?.text))
        || cleanText(line?.text).includes(cleanText(definition).slice(0, 40)));
    const sourceLine = { page: Number(parentLine?.page) || Number(structureParent.page), text: definition };
    return {
      ...section,
      page: Math.min(Number(section.page), Number(sourceLine.page)),
      text: `${definition} ${section.text || ""}`.trim(),
      sourceText: `${definition} ${section.sourceText || section.text || ""}`.trim(),
      lines: [sourceLine, ...(section.lines || [])],
      sourceLines: [sourceLine, ...(section.sourceLines || section.lines || [])]
    };
  });
}

function mainModel(record, pages, selectedSections, allSections, conceptDefinitions, setupSections = allSections, options = {}) {
  const componentSections = recoverPoolStructureDefinitions(recoverNestedDefinitionFormulations(
    recoverParentOptimizationObjectives(selectedSections),
    pages
  ));
  const content = componentSections.map((section) => `${section.title} ${section.text}`).join(" ");
  let components = record.detail_level === "model_map"
    ? legacyComponents(record, pages, allSections, conceptDefinitions)
    : (() => {
        const usedIds = new Set();
        return componentSections
          .map((section) => sectionComponent(section, pages, record, conceptDefinitions, usedIds, options))
          .filter(Boolean);
      })();
  if (!components.length) {
    const fallback = fallbackGroundedComponent(pages, allSections, record, conceptDefinitions, new Set());
    if (fallback) components = [fallback];
  }
  mergeReviewedAnchors(record, pages, allSections, components, conceptDefinitions);
  components = dedupeComponents(components);
  if (!components.length) {
    const fallback = fallbackGroundedComponent(pages, allSections, record, conceptDefinitions, new Set());
    if (fallback) components = [fallback];
  }
  const strictSetupSections = options.formalEvidenceAllowed === false
    ? setupSections.filter(safeModeSetupSection)
    : setupSections;
  const paperSetupSections = options.formalEvidenceAllowed === false
    ? []
    : wholePaperSetupSections(record, pages, setupSections);
  const semanticSections = [
    ...(options.formalEvidenceAllowed === false ? selectedSections : setupSections),
    ...paperSetupSections,
    ...(record.abstract ? [{ title: "Model contribution and method", text: record.abstract, page: 1, endPage: 1 }] : [])
  ];
  const setupRecord = options.formalEvidenceAllowed === false ? {} : record;
  const setup = completeModelSetupFromSource(
    setupRecord,
    [...strictSetupSections, ...paperSetupSections],
    deriveModelSetup(setupRecord, strictSetupSections)
  );
  let materializedSetup = materializeSetup(setup, {}, { pages });
  if (options.formalEvidenceAllowed === false) materializedSetup = enforceSafeModeSetup(materializedSetup, pages);
  materializedSetup = requireCompleteSetup(record, materializedSetup, components, pages, {
    ...options,
    setupSections: strictSetupSections
  });
  components = components
    .map((component) => completeComponentParity(component, materializedSetup, conceptDefinitions, record.id))
    .filter(Boolean);
  if (!components.length) {
    throw new Error(`${record.id}: no component retained a source-grounded condition and modeled concept binding`);
  }
  components = sortComponentsBySourceOrder(components, pages);
  const methodResult = deriveSubstantiveMethod(record, semanticSections);
  const methodFallback = methodResult.method ? null : componentGroundedMethod(components);
  const methodSummary = methodResult.method || methodFallback?.method || "";
  const name = modelName(record, components);
  const summary = completeAuthoredSummary(record.detail_level === "model_map"
    ? withoutRecordFieldLabels(record.scope_note || record.model_topic || firstUsefulSentences(record.abstract, 2, 64))
    : (firstUsefulSentences(withoutRecordFieldLabels(record.abstract), 3, 82)
      || withoutRecordFieldLabels(record.model_topic || record.scope_note)), 4, 180);
  const method = completeAuthoredSummary(methodSummary, 1, 120);
  if (!method || !isSubstantiveMethodStatement(method)) {
    throw new Error(`${record.id}: no substantive source-grounded method survived v15 authoring`);
  }
  const modelFocus = `${name} ${summary} ${method} ${["objects", "inputs", "decisions", "assumptions"].flatMap((field) => materializedSetup[field] || []).join(" ")}`;
  const modelSource = modelSourceFromComponents(
    components,
    modelFocus,
    pages,
    allSections
  );
  return {
    id: "main-model",
    name,
    kind: "baseline",
    relation: "",
    relationships: [],
    summary,
    ...materializedSetup,
    method,
    methodMaturity: methodResult.method ? methodResult.maturity : methodFallback.maturity,
    methodEvidence: methodResult.method ? methodResult.source : methodFallback.evidence,
    methodDiagnostics: methodResult.method ? methodResult.diagnostics : methodFallback.diagnostics,
    sources: modelSource ? [modelSource] : [],
    components
  };
}

function sortComponentsBySourceOrder(components, pages) {
  const position = (component, originalIndex) => {
    const anchors = (component.sources || []).map((source) => {
      const pageNumber = Number(source?.page) || Number.MAX_SAFE_INTEGER;
      const page = pages.find((entry) => Number(entry?.page) === pageNumber);
      const pageText = normalizeWhitespace(page?.text || "");
      const quote = normalizeWhitespace(source?.quote || "");
      const offset = pageText && quote ? pageText.indexOf(quote) : -1;
      return { pageNumber, offset: offset >= 0 ? offset : Number.MAX_SAFE_INTEGER };
    }).sort((left, right) => left.pageNumber - right.pageNumber || left.offset - right.offset);
    return { ...(anchors[0] || { pageNumber: Number.MAX_SAFE_INTEGER, offset: Number.MAX_SAFE_INTEGER }), originalIndex };
  };
  return components.map((component, originalIndex) => ({ component, ...position(component, originalIndex) }))
    .sort((left, right) => left.pageNumber - right.pageNumber || left.offset - right.offset || left.originalIndex - right.originalIndex)
    .map((entry) => entry.component);
}

function dedupeComponents(components) {
  const seenIds = new Set();
  const seenLabels = new Set();
  const seenFingerprints = new Set();
  const seenExplanations = new Set();
  const result = [];
  for (const component of components) {
    const fingerprint = semanticFingerprint(component);
    const label = cleanText(component.label).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const explanation = cleanText(component.explanation).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seenIds.has(component.id) || (label && seenLabels.has(label)) || (explanation && seenExplanations.has(explanation))
      || (fingerprint && seenFingerprints.has(fingerprint))) continue;
    seenIds.add(component.id);
    if (label) seenLabels.add(label);
    if (explanation) seenExplanations.add(explanation);
    if (fingerprint) seenFingerprints.add(fingerprint);
    result.push(component);
  }
  return result;
}

function modelSourceFromComponents(components, focus, pages = [], sections = []) {
  const ranked = components.flatMap((component) => component.sources || [])
    .map((source) => ({ source, score: overlapScore(focus, source.quote || "") }))
    .sort((left, right) => right.score - left.score || Number(left.source.page) - Number(right.source.page));
  const supported = ranked.find((entry) => entry.score > 0 && hasSourceOverlap(focus, entry.source.quote || ""));
  if (supported) return structuredClone(supported.source);
  return groundedSourceForFocus(pages, sections, focus);
}

function variantFocus(variant) {
  return [
    variant.name,
    ...variant.evidence.map((item) => item.text),
    ...variant.sections.map((section) => section.title)
  ].filter(Boolean).join(" ");
}

function sectionMatchesOwnedVariant(section, ownedSections) {
  const title = normalizedSourceSection(section?.title);
  const page = Number(section?.page);
  return ownedSections.some((owned) => {
    const ownedTitle = normalizedSourceSection(owned?.title);
    return Number.isFinite(page)
      && page === Number(owned?.page)
      && title && ownedTitle
      && (title === ownedTitle || title.startsWith(ownedTitle) || ownedTitle.startsWith(title));
  });
}

export function nonbaselineVariantSections(record, sections) {
  if (record.detail_level === "model_map") return [];
  const plan = planModelVariants(record, sections, { maxVariants: 5 });
  if (plan.variants.length < 2) return [];
  // A collection of ordinary model subsections is not, by itself, evidence
  // of mutually exclusive formulations. Exclude prose from the paper-level
  // baseline only when the source names a real extension, regime, benchmark,
  // or contrasting case; otherwise the planner's clustering can strand the
  // common setup in a synthetic "alternative."
  const explicitVariants = plan.variants.slice(1).filter((variant) => (
    ["extension", "approximation"].includes(variant.kind)
      || /\b(?:alternative|benchmark|centralized|decentralized|extension|extended|first[-\s]+best|second[-\s]+best|regime|scenario|variant|with(?:out)?\s+(?:information|learning|observation|sharing))\b/i.test(authoredEnglish(variant.name))
  ));
  if (!explicitVariants.length) return [];
  return explicitVariants.flatMap((variant) => variant.sections
    .map((entry) => sections[entry.sectionIndex])
    .filter(Boolean));
}

function variantChangeSetupEntry(assignedSections, pages) {
  for (const section of assignedSections) {
    if (sourceHeadingRejectionReason(authoredEnglish(section.title))) continue;
    const candidates = sentenceList(section.sourceText || section.text)
      .map(authoredEnglish)
      .filter((sentence) => sentence.split(/\s+/).length <= 48)
      .filter((sentence) => !/\b(?:we|the\s+(?:paper|study)|researchers?)\s+(?:collect|gather|download|scrape|sample|survey|interview)\w*\b/i.test(sentence))
      .filter((sentence) => (VARIANT_CHANGE_CONDITION.test(sentence)
        || explicitLocalVariantCondition(sentence)) && sourceModelsCondition(sentence));
    for (const value of candidates) {
      const page = pages.find((item) => Number(item.page) >= Number(section.page)
        && Number(item.page) <= Number(section.endPage ?? section.page)
        && cleanText(item.text).includes(cleanText(value)));
      if (!page) continue;
      const literalQuote = rawSetupLiteralIncludes(value, page.text)
        ? normalizeWhitespace(value)
        : remapNormalizedSourceQuote(value, page.text);
      if (!literalQuote || !rawSetupLiteralIncludes(literalQuote, page.text)) continue;
      // “Instead” is a useful variant cue, but it also begins ordinary method
      // and result prose. Never promote a corrupted/display/caption span into
      // setup evidence merely because it occurs under a variant heading.
      if (unusableLiteralQuote(literalQuote, page.text)) continue;
      return {
        value,
        source: {
          type: "section",
          section: authoredEnglish(section.title),
          page: Number(page.page),
          quote: literalQuote
        }
      };
    }
  }
  return null;
}

function variantLocalSetup(assignedSections, baseModel, pages, {
  mergePaperBaseline = false,
  formalEvidenceAllowed = true,
  paperBaseline = false
} = {}) {
  // A variant assignment is already supported by an explicit source heading.
  // Prefixing that heading for the semantic extractor lets named regimes such
  // as “A-Learning” participate without broadening the corpus-wide section
  // rules. Values still have to be literal matches from the assigned prose.
  const semanticSections = assignedSections
    .filter((section) => {
      const label = authoredEnglish(section.title);
      return !sourceHeadingRejectionReason(label);
    })
    .map((section) => ({
      ...section,
      title: `Model variant: ${section.title}`
    }));
  const local = completeModelSetupFromSource(
    {},
    semanticSections,
    deriveModelSetup({}, semanticSections)
  );
  let materialized = materializeSetup(local, baseModel, {
    pages,
    fallbackEvidence: baseModel.setupEvidence || {},
    fallbackMaturity: baseModel.setupMaturity || {},
    fallbackCode: "setup_inherited_from_base_model",
    fallbackMessage: "The locally unresolved field inherits the common whole-paper model setup."
  });
  if (formalEvidenceAllowed === false) {
    materialized = enforceSafeModeSetup(materialized, pages);
    const safeBase = enforceSafeModeSetup(structuredClone(baseModel), pages);
    for (const field of SETUP_FIELDS) {
      if ((materialized[field] || []).length || !(safeBase[field] || []).length) continue;
      materialized[field] = structuredClone(safeBase[field]);
      materialized.setupEvidence[field] = cloneSetupEntries(safeBase.setupEvidence?.[field]);
      materialized.setupMaturity[field] = safeBase.setupMaturity?.[field] || "source-derived";
      materialized.setupDiagnostics.push({
        code: "setup_inherited_from_safe_paper_baseline",
        category: field,
        message: "The locally unresolved field inherits a clean source-grounded field from the common paper setup."
      });
    }
  }
  if (mergePaperBaseline) {
    for (const field of SETUP_FIELDS) {
      const mergedValues = distinctSetupValues([
        ...(baseModel[field] || []),
        ...(materialized[field] || [])
      ], 5);
      const evidencePool = [
        ...cloneSetupEntries(baseModel.setupEvidence?.[field]),
        ...cloneSetupEntries(materialized.setupEvidence?.[field])
      ];
      materialized[field] = mergedValues;
      materialized.setupEvidence[field] = mergedValues.flatMap((value) => {
        const key = setupEquivalenceKey(value);
        const evidence = evidencePool.find((entry) => setupEquivalenceKey(entry?.value) === key);
        return evidence ? [evidence] : [];
      });
      if ((baseModel[field] || []).length) {
        materialized.setupMaturity[field] = baseModel.setupMaturity?.[field]
          || materialized.setupMaturity[field];
      }
    }
    materialized.setupDiagnostics.push({
      code: "setup_paper_baseline_merged",
      message: "The first literature variant retains the complete whole-paper setup alongside its locally assigned sections."
    });
  }
  for (const entries of Object.values(materialized.setupEvidence)) {
    for (const entry of entries) {
      if (entry.source?.section?.startsWith("Model variant: ")) {
        entry.source.section = entry.source.section.slice("Model variant: ".length);
      }
    }
  }
  let variantChange = variantChangeSetupEntry(assignedSections, pages);
  if (!variantChange && formalEvidenceAllowed === false && !paperBaseline) {
    for (const section of assignedSections) {
      if (sourceHeadingRejectionReason(authoredEnglish(section.title))) continue;
      const quote = sentenceList(section.sourceText || section.text).map(authoredEnglish).find((sentence) => {
        const page = pages.find((candidate) => Number(candidate?.page) >= Number(section.page)
          && Number(candidate?.page) <= Number(section.endPage ?? section.page)
          && isWhitespaceNormalizedSubstring(sentence, candidate?.text || ""));
        return page && safeModeLiteralProse(sentence, page.text)
          && modelBearingProse(sentence)
          && !resultAssertionProse(sentence)
          && !/\b(?:theorem|proposition|lemma|corollary|proof|simulation|experiment|we\s+(?:find|show|observe))\b/iu.test(sentence);
      });
      if (!quote) continue;
      const page = pages.find((candidate) => Number(candidate?.page) >= Number(section.page)
        && Number(candidate?.page) <= Number(section.endPage ?? section.page)
        && isWhitespaceNormalizedSubstring(quote, candidate?.text || ""));
      variantChange = {
        value: quote,
        source: {
          type: "section",
          section: authoredEnglish(section.title),
          page: Number(page.page),
          quote,
          matchedText: quote,
          derivation: "literal-safe-mode-variant-condition"
        }
      };
      break;
    }
  }
  if (variantChange) {
    materialized.assumptions = distinct([
      variantChange.value,
      ...(materialized.assumptions || [])
    ], 5);
    materialized.setupEvidence.assumptions = [
      variantChange,
      ...(materialized.setupEvidence.assumptions || [])
        .filter((entry) => cleanText(entry?.value).toLowerCase() !== cleanText(variantChange.value).toLowerCase())
    ].slice(0, 5);
    materialized.setupMaturity.assumptions = "source-derived";
    materialized.setupDiagnostics = materialized.setupDiagnostics
      .filter((diagnostic) => diagnostic?.category !== "assumptions"
        || !/unresolved|fallback|inherited/i.test(String(diagnostic?.code || "")))
      .concat({
        code: "setup_variant_change_retained",
        category: "assumptions",
        message: "The variant's explicit formulation change is retained as local setup evidence."
      });
  }
  return materialized;
}

function uniquelyMatchedComponents(baseComponents, focuses, variantIndex) {
  return baseComponents.filter((component) => {
    const componentText = `${component.label} ${component.explanation}`;
    const scores = focuses.map((focus) => overlapScore(focus, componentText));
    const best = Math.max(...scores);
    return best > 0
      && scores[variantIndex] === best
      && scores.filter((score) => score === best).length === 1;
  });
}

function normalizedSourceSection(value) {
  return authoredEnglish(value).replace(/^(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)[.)]?\s+/, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function componentHasLiteralVariantSupport(component, pages, focus, assignedSections = []) {
  return (component.sources || []).some((source) => {
    const sourceSection = normalizedSourceSection(source.section);
    const belongsToAssignedSection = assignedSections.some((section) => {
      const page = Number(source.page);
      const inRange = page >= Number(section.page) && page <= Number(section.endPage ?? section.page);
      const assignedTitle = normalizedSourceSection(section.title);
      return inRange && sourceSection && assignedTitle
        && (sourceSection === assignedTitle
          || sourceSection.endsWith(assignedTitle)
          || assignedTitle.endsWith(sourceSection)
          // The section extractor can lose the last words of a wrapped
          // heading while the authoring layer later recovers the complete
          // source label. Prefix equivalence retains the planner's unique
          // ownership in that case instead of supplementing the component
          // into both compared variants.
          || sourceSection.startsWith(assignedTitle)
          || assignedTitle.startsWith(sourceSection));
    });
    if (!belongsToAssignedSection) return false;
    const page = literalSourcePage(
      pages,
      source.quote,
      `${source.section || ""} ${source.quote || ""}`,
      source.page,
      { componentRole: component.role }
    );
    return Boolean(page) && hasSourceOverlap(focus, `${source.section || ""} ${source.quote || ""}`);
  });
}

function assignedSectionHasCurrentPageSupport(section, pages) {
  const sourceText = section.sourceText || section.text;
  const sourceSentences = sentenceList(sourceText).filter((sentence) =>
    readableProse(sentence) && !organizationProse(sentence));
  const title = authoredEnglish(section.title);
  const numberedTitle = authoredEnglish(section.number ? `${section.number}. ${title}` : title);
  return pages.some((page) => {
    const pageNumber = Number(page?.page);
    if (pageNumber < Number(section.page) || pageNumber > Number(section.endPage ?? section.page)) return false;
    const pageText = cleanText(page?.text);
    if (!pageText) return false;
    // The printed heading is sufficient to prove that the planner is looking
    // at the current page even when every body sentence contains a PDF
    // line-break artifact. Otherwise require a complete section sentence to
    // be literally recoverable from that page.
    if ((numberedTitle && pageText.includes(numberedTitle))
      || (title && pageText.includes(title))) return true;
    return sourceSentences.some((sentence) => pageText.includes(cleanText(sentence))
      || Boolean(remapNormalizedSourceQuote(sentence, page?.text)));
  });
}

function sectionWithPlannedVariantTitle(sourceSection, plannedTitle) {
  const title = authoredEnglish(plannedTitle) || sourceSection.title;
  const originalTitle = authoredEnglish(sourceSection.title);
  if (!title || title === originalTitle) return sourceSection;
  const recoveredPrefix = title.toLocaleLowerCase().startsWith(originalTitle.toLocaleLowerCase())
    ? title.slice(originalTitle.length).trim()
    : "";
  const stripRecoveredPrefix = (value) => {
    const text = String(value || "").trimStart();
    if (!recoveredPrefix || !text.toLocaleLowerCase().startsWith(recoveredPrefix.toLocaleLowerCase())) return text;
    const boundary = text[recoveredPrefix.length] || "";
    return boundary && !/[\s:;,.!?–—-]/u.test(boundary)
      ? text
      : text.slice(recoveredPrefix.length).replace(/^[\s:;,.!?–—-]+/u, "");
  };
  const stripFirstLine = (lines) => Array.isArray(lines)
    ? lines.map((line, index) => index === 0 ? { ...line, text: stripRecoveredPrefix(line?.text) } : line)
    : lines;
  return {
    ...sourceSection,
    title,
    text: stripRecoveredPrefix(sourceSection.text),
    sourceText: stripRecoveredPrefix(sourceSection.sourceText),
    lines: stripFirstLine(sourceSection.lines),
    sourceLines: stripFirstLine(sourceSection.sourceLines)
  };
}

export function recoverExplicitVariantPageSpan(sourceSection, allSections, pages, record) {
  const sectionIndex = allSections.indexOf(sourceSection) >= 0
    ? allSections.indexOf(sourceSection)
    : allSections.findIndex((candidate) => Number(candidate?.page) === Number(sourceSection?.page)
      && authoredEnglish(candidate?.number) === authoredEnglish(sourceSection?.number)
      && normalizedSourceSection(candidate?.title) === normalizedSourceSection(sourceSection?.title));
  const sectionNumber = authoredEnglish(sourceSection?.number);
  // Only a printed top-level formulation heading owns the intervening pages.
  // Nested headings already carry their own bounded spans, and extending an
  // unnumbered heading could absorb an unrelated neighboring section.
  if (sectionIndex < 0 || !/^\d+$/u.test(sectionNumber)) return sourceSection;
  const nextBoundary = allSections.slice(sectionIndex + 1).find((candidate) => {
    if (repeatedRunningHeaderSection(candidate, record, allSections)) return false;
    const candidateNumber = authoredEnglish(candidate?.number);
    const lineage = [candidate?.title, ...(candidate?.ancestorTitles || [])]
      .map(authoredEnglish)
      .filter(Boolean)
      .join(" ");
    return /^\d+$/u.test(candidateNumber)
      || NONMODEL_SECTION.test(lineage)
      || /\b(?:references|bibliography)\b/iu.test(lineage);
  });
  // Without an observed boundary, the safe span is the parser's original span.
  // Extending to the final PDF page can absorb footnotes, acknowledgments, or
  // references into the named model and silently change its evidence.
  if (!nextBoundary) return sourceSection;
  const recoveredEndPage = Math.max(Number(sourceSection.page), Number(nextBoundary.page) - 1);
  if (!Number.isFinite(recoveredEndPage) || recoveredEndPage <= Number(sourceSection.endPage ?? sourceSection.page)) {
    return sourceSection;
  }
  const appendedPages = pages
    .filter((page) => Number(page?.page) > Number(sourceSection.endPage ?? sourceSection.page)
      && Number(page?.page) <= recoveredEndPage)
    .sort((left, right) => Number(left.page) - Number(right.page));
  if (!appendedPages.length) return sourceSection;
  const appendedLines = appendedPages.flatMap((page) => String(page?.text || "")
    .split(/\r?\n/u)
    .map((text) => ({ page: Number(page.page), text }))
    .filter((line) => cleanText(line.text)));
  const appendedText = appendedPages.map((page) => String(page?.text || "")).join("\n");
  return {
    ...sourceSection,
    endPage: recoveredEndPage,
    text: `${sourceSection.text || ""}\n${appendedText}`.trim(),
    sourceText: `${sourceSection.sourceText || sourceSection.text || ""}\n${appendedText}`.trim(),
    lines: [...(sourceSection.lines || []), ...appendedLines],
    sourceLines: [...(sourceSection.sourceLines || sourceSection.lines || []), ...appendedLines]
  };
}

function recoverableFilteredVariantRoot(section, record, allSections) {
  if (usableSourceSection(section, record, allSections)) return true;
  const ancestorLineage = (section?.ancestorTitles || []).map(authoredEnglish).join(" ");
  if (NONMODEL_SECTION.test(ancestorLineage)) return false;
  const text = authoredEnglish(section?.sourceText || section?.text);
  return /\bbenchmark\s+case\s+where\b[^.!?]{0,260}\b(?:does?\s+not|without|rather|instead)\b/iu.test(text)
    || /\bintroduce\s+model\s+extensions?\s+that\s+(?:relax|change)\b[^.!?]{0,160}\bmodel\s+setup\b/iu.test(text)
    || /\bextend\s+(?:the|our)\s+(?:main|base)\s+model\s+by\s+relaxing\b/iu.test(text);
}

function normalizedVariantLookupPhrase(value) {
  return authoredEnglish(value)
    .replace(/^(?:(?:model|formulation)\s+)?(?:extension|alternative|approximation)\s*:\s*/iu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function recoverNamedVariantDefinitionComponent(
  variant,
  planningSections,
  pages,
  record,
  conceptDefinitions,
  usedIds,
  options = {}
) {
  const variantPhrase = normalizedVariantLookupPhrase(variant?.name);
  const phraseWords = variantPhrase.split(/\s+/u).filter(Boolean);
  if (phraseWords.length < 2) return null;
  const normalizedContainsVariant = (value) => authoredEnglish(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ")
    .includes(variantPhrase);
  const variantDefinitionTokens = distinct(sourceSemanticTokens(variant?.name)
    .filter((token) => !new Set(["model", "formulation", "alternative", "extension", "variant"]).has(token)));
  const directDefinitionCandidates = [];
  const candidates = [];
  for (const section of planningSections) {
    const lineage = [section?.title, ...(section?.ancestorTitles || [])]
      .map(authoredEnglish)
      .filter(Boolean)
      .join(" ");
    if (NONMODEL_SECTION.test(lineage)) continue;
    for (const page of pages) {
      const pageNumber = Number(page?.page);
      if (pageNumber < Number(section.page) || pageNumber > Number(section.endPage ?? section.page)) continue;
      const localText = sectionSourceTextOnPage(section, pageNumber);
      if (!localText) continue;
      for (const sentence of sentenceList(localText).map(normalizedConditionSentence)) {
        const literalDefinition = remapNormalizedSourceQuote(sentence, page.text);
        const directLiterals = distinct([
          literalDefinition,
          ...preferredLiteralClausePrefixes(literalDefinition)
            .map((prefix) => remapNormalizedSourceQuote(prefix, page.text))
        ].filter(Boolean));
        for (const directLiteral of directLiterals) {
          const supportedRoles = [...ALLOWED_COMPONENT_ROLES]
            .filter((role) => sourceSupportsRole(role, directLiteral));
          const sentenceTokens = new Set(sourceSemanticTokens(directLiteral));
          // A restrictive predicate such as "maximum order quantity ... cannot
          // exceed" semantically realizes a heading's plural "Constraints"
          // even if the noun itself is not repeated in the defining sentence.
          if (supportedRoles.includes("constraint")) sentenceTokens.add("constraint");
          const sharedDefinitionTokens = variantDefinitionTokens.filter((token) => sentenceTokens.has(token));
          // Some papers introduce two named formulations inline inside a shared
          // model section, while the later same-name heading contains analysis
          // only. Recover a definition only when at least two distinctive title
          // tokens recur in one literal, substantive modeling proposition. This
          // admits e.g. "system has capacity ... cannot exceed" for a printed
          // capacity formulation, but not a generic result that merely says
          // "this model" or mentions an extension.
          if (variantDefinitionTokens.length >= 2
            && sharedDefinitionTokens.length >= 2
            && sharedDefinitionTokens.length / variantDefinitionTokens.length >= 2 / 3
            && supportedRoles.length
            && sourceModelsCondition(directLiteral)
            && !/\b(?:i\.e|e\.g)\.?$/iu.test(directLiteral)
            && !conditionResultOrContributionProse(directLiteral)
            && !formulaContaminatedProse(directLiteral, page.text)
            && (options.formalEvidenceAllowed !== false
              || safeModeLiteralProse(directLiteral, page.text))) {
            directDefinitionCandidates.push({
              section,
              page,
              sentence: directLiteral,
              role: supportedRoles[0],
              score: sharedDefinitionTokens.length * 100
                + overlapScore(variant.name, directLiteral)
            });
          }
        }
        if (!normalizedContainsVariant(sentence)
          || !explicitLocalVariantCondition(sentence)
          || !sourceModelsCondition(sentence)
          || conditionResultOrContributionProse(sentence)) continue;
        if (!literalDefinition || formulaContaminatedProse(literalDefinition, page.text)) continue;
        candidates.push({
          section,
          page,
          sentence,
          literalDefinition,
          score: overlapScore(`${variant.name} ${sentence}`, `${section.title} ${sentence}`)
        });
      }
    }
  }
  directDefinitionCandidates.sort((left, right) => right.score - left.score
    || Number(left.page.page) - Number(right.page.page));
  for (const candidate of directDefinitionCandidates) {
    const recoveredSection = {
      ...candidate.section,
      title: authoredEnglish(variant.name),
      page: Number(candidate.page.page),
      endPage: Number(candidate.page.page),
      text: candidate.sentence,
      sourceText: candidate.sentence,
      lines: [{ page: Number(candidate.page.page), text: candidate.sentence }],
      sourceLines: [{ page: Number(candidate.page.page), text: candidate.sentence }],
      sourceSentence: candidate.sentence
    };
    const recoveredOptions = { ...options, preferConditionedSource: true };
    const provisional = sectionComponent(
      recoveredSection,
      pages,
      record,
      conceptDefinitions,
      new Set(),
      recoveredOptions
    );
    const paritySeeded = provisional
      && (provisional.conditions || []).some((condition) => sourceModelsCondition(condition))
      && (provisional.conceptBindings || []).some((binding) => binding.status === "modeled"
        && (binding.conditionRefs || []).length
        && (binding.sourceRefs || []).length);
    if (!paritySeeded) continue;
    const recovered = sectionComponent(
      recoveredSection,
      pages,
      record,
      conceptDefinitions,
      usedIds,
      recoveredOptions
    );
    if (recovered) {
      const actualSection = authoredEnglish(candidate.section.number
        ? `${candidate.section.number}. ${candidate.section.title}`
        : candidate.section.title) || "Model formulation";
      recovered.sources = (recovered.sources || []).map((source) => ({ ...source, section: actualSection }));
    }
    return recovered;
  }
  // Needs-review safe mode may recover only the fully literal, single-source
  // definition above. The older paired-condition recovery below can combine
  // two propositions and therefore remains unavailable without formal
  // evidence approval.
  if (options.formalEvidenceAllowed === false) return null;
  candidates.sort((left, right) => right.score - left.score
    || Number(left.page.page) - Number(right.page.page));
  for (const candidate of candidates) {
    const localText = sectionSourceTextOnPage(candidate.section, candidate.page.page);
    const support = sentenceList(localText)
      .map((sentence, index) => ({ sentence: normalizedConditionSentence(sentence), index }))
      .flatMap((entry) => [...ALLOWED_COMPONENT_ROLES].map((role) => ({ ...entry, role })))
      .map((entry) => ({
        ...entry,
        literal: remapNormalizedSourceQuote(entry.sentence, candidate.page.text),
        score: overlapScore(candidate.sentence, entry.sentence)
      }))
      .filter((entry) => entry.literal
        && entry.sentence !== candidate.sentence
        && readableProse(entry.literal)
        && componentSourceSentence(entry.literal, entry.role)
        && sourceSupportsRole(entry.role, entry.literal)
        && !organizationProse(entry.literal)
        && !displayOrResultOnlyProse(entry.literal)
        && !conditionResultOrContributionProse(entry.literal)
        && !formulaContaminatedProse(entry.literal, candidate.page.text)
        && hasSourceOverlap(candidate.sentence, entry.literal))
      .sort((left, right) => right.score - left.score
        || left.index - right.index
        || left.sentence.length - right.sentence.length)[0];
    if (!support) continue;
    const evidenceSentences = distinct([candidate.sentence, support.sentence]);
    const recoveredSection = {
      ...candidate.section,
      page: Number(candidate.page.page),
      endPage: Number(candidate.page.page),
      text: evidenceSentences.join(" "),
      sourceText: evidenceSentences.join(" "),
      lines: evidenceSentences.map((text) => ({ page: Number(candidate.page.page), text })),
      sourceLines: evidenceSentences.map((text) => ({ page: Number(candidate.page.page), text })),
      sourceSentence: support.sentence
    };
    const component = sectionComponent(
      recoveredSection,
      pages,
      record,
      conceptDefinitions,
      usedIds,
      options
    );
    if (!component || !(component.conditions || []).some((condition) =>
      normalizedContainsVariant(condition) && sourceModelsCondition(condition))) continue;
    return component;
  }
  return null;
}

export function buildVariantModels(
  record,
  baseModel,
  pages,
  allSections,
  conceptDefinitions,
  boundarySections = allSections,
  options = {}
) {
  // Deep model-map records already contain a reviewed, paper-level model with
  // decisions, notation, objective, equilibrium, and method evidence.  A
  // source-identified benchmark or extension is additive in that case; it
  // must never replace the richer whole-paper model merely because its
  // heading happens to contain the word "benchmark".
  const preservePaperModel = record.detail_level === "model_map";
  // Reviewed paper maps keep the original complete-section hierarchy for
  // variant recall. Filtering out a meta heading such as `Extensions` or its
  // analysis parent can otherwise erase a genuine child formulation before
  // the fail-closed materialization checks ever see it. Literature notes keep
  // the narrower source-section plan because their baseline is also inferred.
  const candidatePlanningSections = preservePaperModel ? boundarySections : allSections;
  const planningSections = options.formalEvidenceAllowed === false
    ? candidatePlanningSections.filter((section) => {
        const title = authoredEnglish(section?.title);
        const text = authoredEnglish(section?.sourceText || section?.text);
        if (/\b(?:experiment|simulation|empirical\s+(?:analysis|results?)|case\s+study)\b/iu.test(title)) return false;
        if (!safeModeSetupValue(title)
          || SAFE_MODE_AUTHOR_YEAR_HEADING.test(title)
          || SAFE_MODE_COMPONENT_HEADING_EXCLUSION.test(title)) return false;
        if (/\bbenchmarks?\b/iu.test(title)) {
          const definesInformationRegime = /\b(?:full|complete|perfect|limited|partial|asymmetric|symmetric|no)[-\s]+information\b/iu.test(title)
            || /\bbenchmark\s+(?:case|model|formulation)\b[^.!?]{0,160}\b(?:assume|suppose|where|without|with)\b/iu.test(text);
          if (!definesInformationRegime) return false;
        }
        return true;
      })
    : candidatePlanningSections;
  const plan = planModelVariants(record, planningSections, { maxVariants: preservePaperModel ? 4 : 5 });
  if (plan.variants.length < (preservePaperModel ? 1 : 2)) return [baseModel];
  const viable = plan.variants.filter((variant, index) => preservePaperModel
    ? !(variant.kind === "baseline"
        && /^(?:analysis\s+of\s+(?:the\s+)?)?(?:base|baseline|main)(?:\s+model|\s+formulation)?$/i.test(authoredEnglish(variant.name)))
      && variant.sections.length > 0
      && variant.sections
        .filter((section) => section.reason === "explicit-heading")
        .some((section) => recoverableFilteredVariantRoot(
          planningSections[section.sectionIndex],
          record,
          boundarySections
        ))
    : index === 0 || variant.sections.length > 0);
  if (viable.length < (preservePaperModel ? 1 : 2)) return [baseModel];
  const recoveredComponentSections = recoverPoolStructureDefinitions(planningSections);
  const sectionByIndex = new Map(recoveredComponentSections.map((section, index) => [index, section]));
  const authoredVariants = viable.map((variant, variantIndex) => {
    const assignments = variant.sections.map((entry) => {
      const sourceSection = sectionByIndex.get(entry.sectionIndex);
      if (!sourceSection) return null;
      const pageBounded = entry.reason === "explicit-heading"
        ? recoverExplicitVariantPageSpan(sourceSection, boundarySections, pages, record)
        : sourceSection;
      return {
        entry,
        section: sectionWithPlannedVariantTitle(pageBounded, entry.title),
        // A top-level explicit formulation may own the intervening pages for
        // setup and variant assignment, but its own component must stay on its
        // originally bounded prose. Otherwise a generic owner can select the
        // strongest sentence from a substantive child heading and then erase
        // that child as a duplicate. Descendant sections are materialized
        // independently below and therefore retain their own exact anchors.
        componentSection: sectionWithPlannedVariantTitle(sourceSection, entry.title)
      };
    }).filter(Boolean);
    const assignedSections = assignments.map((assignment) => assignment.section);
    const plannedName = authoredEnglish(variant.name);
    const repairedRootTitle = authoredEnglish(assignments
      .find((assignment) => assignment.entry.reason === "explicit-heading")?.section?.title);
    const plannedWords = plannedName.split(/\s+/).filter(Boolean).length;
    const repairedWords = repairedRootTitle.split(/\s+/).filter(Boolean).length;
    // A wrapped heading can be complete in the recovered section while the
    // planner name still ends at the first physical line. Propagate only a
    // short, exact suffix of that same heading; semantic aliases and renamed
    // catalog variants must remain untouched.
    const namedVariant = repairedRootTitle
      && repairedRootTitle.toLocaleLowerCase().startsWith(`${plannedName.toLocaleLowerCase()} `)
      && repairedWords > plannedWords
      && repairedWords <= plannedWords + 4
      && !sourceHeadingRejectionReason(repairedRootTitle)
      ? { ...variant, name: repairedRootTitle }
      : variant;
    const usedIds = new Set();
    let sectionComponents = assignments
      .map((assignment) => {
        const componentOptions = {
          ...options,
          preferConditionedSource: (preservePaperModel || variantIndex > 0)
            && assignment.entry.reason === "explicit-heading"
        };
        const locallyBound = sectionComponent(
          assignment.componentSection,
          pages,
          record,
          conceptDefinitions,
          usedIds,
          componentOptions
        );
        if (locallyBound) return locallyBound;
        // Some explicit formulation owners contain only a short introduction
        // before their first substantive child section. Prefer the owner's own
        // bounded prose whenever it can ground a component (so a generic owner
        // cannot consume its child's independent anchor), but recover the
        // already heading-bounded descendant span when the owner itself has no
        // usable proposition. This retains calibrated or instantiated model
        // formulations without relaxing any component/source validation.
        const hasExpandedSpan = Number(assignment.section.page) !== Number(assignment.componentSection.page)
          || Number(assignment.section.endPage ?? assignment.section.page)
            !== Number(assignment.componentSection.endPage ?? assignment.componentSection.page)
          || cleanText(assignment.section.sourceText || assignment.section.text)
            !== cleanText(assignment.componentSection.sourceText || assignment.componentSection.text);
        if (!hasExpandedSpan) return null;
        return sectionComponent(
          assignment.section,
          pages,
          record,
          conceptDefinitions,
          usedIds,
          componentOptions
        );
      })
      .filter(Boolean);
    const explicitNonbaseline = (preservePaperModel || variantIndex > 0)
      && variant.sections.some((section) => section.reason === "explicit-heading");
    const hasLocalModeledCondition = sectionComponents.some((component) =>
      (component.conditions || []).some((condition) => locallyApplicableCondition(component, condition))
      && (component.conceptBindings || []).some((binding) => binding.status === "modeled"
        && (binding.conditionRefs || []).length
        && (binding.sourceRefs || []).length));
    // Some papers define a named benchmark in the shared model setup and use
    // its later explicit heading only for formula derivation. If the heading's
    // local prose cannot ground a condition, recover one same-page setup
    // component whose literal sentence contains the full variant name. This
    // preserves the printed setup section and never borrows a result merely
    // because it mentions the benchmark.
    if (explicitNonbaseline && !hasLocalModeledCondition) {
      const recoveredDefinition = recoverNamedVariantDefinitionComponent(
        variant,
        planningSections,
        pages,
        record,
        conceptDefinitions,
        usedIds,
        options
      );
      if (recoveredDefinition) {
        // The recovered definition is invoked only when the same-label local
        // component lacks condition-and-source parity. Put the stronger
        // literal definition first so label deduplication replaces, rather
        // than discards, it.
        sectionComponents = dedupeComponents([recoveredDefinition, ...sectionComponents]);
      }
    }
    const componentRootTitle = authoredEnglish(sectionComponents[0]?.label);
    const currentName = authoredEnglish(namedVariant.name);
    const currentWords = currentName.split(/\s+/).filter(Boolean).length;
    const componentWords = componentRootTitle.split(/\s+/).filter(Boolean).length;
    const finalizedVariant = componentRootTitle
      && componentRootTitle.toLocaleLowerCase().startsWith(`${currentName.toLocaleLowerCase()} `)
      && componentWords > currentWords
      && componentWords <= currentWords + 4
      && !sourceHeadingRejectionReason(componentRootTitle)
      ? { ...namedVariant, name: componentRootTitle }
      : namedVariant;
    return { variant: finalizedVariant, assignedSections, sectionComponents };
  });
  // A descriptive extension heading and its generic numbered child (for
  // example, `5 Extensions: Strategic Students` followed by `5.1 Extended
  // Model`) describe one formulation, not two peer variants. Merge the child
  // section/component material into the descriptive parent before applying
  // source-support gates. A standalone generic extension remains eligible.
  const collapsedVariantIndexes = new Set();
  for (const [childIndex, child] of authoredVariants.entries()) {
    if (!/^extended\s+model$|^extension\s+model$|^model\s+extension$/i.test(authoredEnglish(child.variant.name))) continue;
    const childRoot = child.variant.sections.find((section) => section.reason === "explicit-heading");
    const childNumber = authoredEnglish(planningSections[childRoot?.sectionIndex]?.number);
    if (!childNumber) continue;
    const parentIndex = authoredVariants.findIndex((candidate, candidateIndex) => {
      if (candidateIndex === childIndex || candidate.variant.kind !== "extension") return false;
      if (/^extended\s+model$|^extension\s+model$|^model\s+extension$/i.test(authoredEnglish(candidate.variant.name))) return false;
      const parentRoot = candidate.variant.sections.find((section) => section.reason === "explicit-heading");
      const parentNumber = authoredEnglish(planningSections[parentRoot?.sectionIndex]?.number);
      return parentNumber && childNumber.startsWith(`${parentNumber}.`);
    });
    if (parentIndex < 0) continue;
    const parent = authoredVariants[parentIndex];
    parent.assignedSections = [...parent.assignedSections, ...child.assignedSections]
      .filter((section, index, values) => values.findIndex((candidate) => candidate === section
        || (Number(candidate.page) === Number(section.page)
          && normalizedSourceSection(candidate.title) === normalizedSourceSection(section.title))) === index);
    parent.sectionComponents = dedupeComponents([...parent.sectionComponents, ...child.sectionComponents]);
    collapsedVariantIndexes.add(childIndex);
  }
  const collapsedVariants = authoredVariants.filter((_entry, index) => !collapsedVariantIndexes.has(index));
  const explicitlyPlannedNonbaseline = (entry, index) => (preservePaperModel || index > 0)
    && entry.variant.sections.some((section) => section.reason === "explicit-heading");
  const supportedVariants = collapsedVariants.filter((entry, index) => (
    preservePaperModel
      ? entry.assignedSections.length > 0
        && (entry.variant.evidence.some((evidence) => evidence.source === "section")
          || entry.variant.sections.some((section) => section.reason === "explicit-heading"))
      : index === 0 || entry.sectionComponents.length > 0
  ));
  const unsupportedExplicit = collapsedVariants
    .filter((entry, index) => explicitlyPlannedNonbaseline(entry, index)
      && !supportedVariants.includes(entry)
      && entry.assignedSections.some((section) => assignedSectionHasCurrentPageSupport(section, pages)));
  if (unsupportedExplicit.length) {
    throw new Error(`${record.id}: explicitly planned nonbaseline formulation did not materialize (${unsupportedExplicit.map((entry) => entry.variant.name).join(", ")})`);
  }
  if (preservePaperModel ? supportedVariants.length < 1 : supportedVariants.length < 2) return [baseModel];
  const focuses = supportedVariants.map((entry) => variantFocus(entry.variant));
  const usedModelIds = new Set(preservePaperModel ? [baseModel.id] : []);
  const emittedId = (candidate) => {
    let id = candidate;
    let suffix = 2;
    while (usedModelIds.has(id)) id = `${candidate}-${suffix++}`;
    usedModelIds.add(id);
    return id;
  };
  const emittedIds = new Map(supportedVariants.map((entry) => [entry.variant.id, emittedId(entry.variant.id)]));
  let authoredLiteratureBaseline = null;
  const materializationIssues = new Map();
  const authoredModels = supportedVariants.map(({ variant, assignedSections, sectionComponents }, variantIndex) => {
    const rejectMaterialization = (reason) => {
      materializationIssues.set(variant.id, reason);
      return null;
    };
    const isPaperBaseline = !preservePaperModel && variantIndex === 0;
    const focus = focuses[variantIndex];
    const matchedRich = (preservePaperModel ? [] : uniquelyMatchedComponents(baseModel.components, focuses, variantIndex))
      .filter((component) => componentHasLiteralVariantSupport(component, pages, focus, assignedSections))
      .map((component) => structuredClone(component));
    // Variant planning must not erase common paper-level structure. A base
    // component that matches none of the named variants belongs to the first
    // (paper-level) formulation and remains there alongside its local section
    // components.
    const unmatchedBase = isPaperBaseline
      ? baseModel.components.filter((component) => {
          return !supportedVariants.some((entry, candidateIndex) =>
            componentHasLiteralVariantSupport(
              component,
              pages,
              focuses[candidateIndex],
              entry.assignedSections
            ));
        }).map((component) => structuredClone(component))
      : [];
    // A true variant may own several distinct formulation and algorithm
    // subsections. Retain every source-grounded, semantically distinct
    // component instead of imposing a count ceiling after local authoring.
    let components = dedupeComponents([...sectionComponents, ...matchedRich, ...unmatchedBase]);
    // A synthetic baseline can legitimately have no exclusively assigned
    // section. In that one case it remains the whole-paper base model. Named
    // variants always have assigned source sections and are never quota-filled.
    if (isPaperBaseline && !components.length) {
      components = dedupeComponents(baseModel.components.map((component) => structuredClone(component)));
    }
    if (!components.length) return rejectMaterialization("no source-grounded component");
    const setupFallback = !preservePaperModel && variantIndex > 0 && authoredLiteratureBaseline
      ? authoredLiteratureBaseline
      : baseModel;
    let setup = variantLocalSetup(assignedSections, setupFallback, pages, {
      mergePaperBaseline: isPaperBaseline && options.formalEvidenceAllowed !== false,
      formalEvidenceAllowed: options.formalEvidenceAllowed,
      paperBaseline: isPaperBaseline
    });
    if (options.formalEvidenceAllowed === false) {
      try {
        setup = requireCompleteSetup(record, setup, components, pages, {
          ...options,
          setupSections: [...assignedSections, ...allSections]
        });
      } catch (error) {
        return rejectMaterialization(error.message.replace(`${record.id}: `, ""));
      }
    }
    const missingSetup = SETUP_FIELDS.filter((field) => !(setup[field] || []).length);
    if (missingSetup.length) return rejectMaterialization(`incomplete setup: ${missingSetup.join(", ")}`);
    const parityIssues = [];
    components = components
      .map((component) => completeComponentParity(component, setup, conceptDefinitions, record.id, parityIssues))
      .filter(Boolean);
    if (!components.length) {
      const summary = [...new Set(parityIssues.map((issue) => issue.reason))].join(", ");
      return rejectMaterialization(`no component retained semantic parity${summary ? `: ${summary}` : ""}`);
    }
    // The first planned model is the paper-level baseline. Its abstract-backed
    // summary is more complete and less vulnerable to columns lost while a PDF
    // section was reconstructed. Named extensions still receive local prose.
    const preferenceRegime = components
      .flatMap((component) => component.conditions || [])
      .map(authoredEnglish)
      .find((condition) => PREFERENCE_REGIME_CONDITION.test(condition));
    const preferenceRegimeSummary = preferenceRegime
      ? `This extension models the goods as ${/complement/iu.test(preferenceRegime) ? "complements" : "substitutes"}.`
      : "";
    const summary = isPaperBaseline
      ? baseModel.summary
      : preferenceRegimeSummary
        || completeAuthoredSummary(components.map((component) => component.explanation).join(" "), 3, 120)
        || firstUsefulSentences(assignedSections.map((section) => section.text).join(" "), 3, 82, { modelOnly: true })
        || completeAuthoredSummary(variant.evidence.map((item) => item.text).join(" "), 3, 120)
        || baseModel.summary;
    const localMethodResult = deriveSubstantiveMethod({}, assignedSections);
    const localMethod = localMethodResult.method;
    // A named regime can share the paper-level solution method when its
    // assigned source section contains no separate procedural statement.
    // Preserve that already source-derived method verbatim: adding a
    // synthetic scope prefix can turn a valid method into an overlong one
    // without contributing any new source evidence.
    const localMethodSummary = completeAuthoredSummary(localMethod, 2, 120);
    const groundedMethodFallback = localMethodSummary ? null : componentGroundedMethod(components);
    const groundedMethodSummary = completeAuthoredSummary(groundedMethodFallback?.method, 1, 120);
    const method = localMethodSummary
      && !hasExtractionNoise(localMethodSummary)
      && !organizationProse(localMethodSummary)
      ? localMethodSummary
        : groundedMethodSummary
        && !hasExtractionNoise(groundedMethodSummary)
        && !organizationProse(groundedMethodSummary)
        ? groundedMethodSummary
        : baseModel.method;
    if (!method || !isSubstantiveMethodStatement(method)) return rejectMaterialization("no substantive method");
    const sourceFocus = `${variant.name} ${summary} ${method} ${["objects", "inputs", "decisions", "assumptions"].flatMap((field) => setup[field] || []).join(" ")}`;
    const localPages = pages.filter((page) => assignedSections.some((section) => Number(section.page) <= Number(page.page)
      && Number(section.endPage ?? section.page) >= Number(page.page)));
    const modelSource = modelSourceFromComponents(
      components,
      sourceFocus,
      isPaperBaseline && !localPages.length ? pages : localPages,
      assignedSections
    );
    if (!modelSource) return rejectMaterialization("no source anchor overlapping the modeled formulation");
    const relationshipType = preservePaperModel
      ? (variant.kind === "extension" ? "extends" : variant.kind === "approximation" ? "approximates" : "alternativeTo")
      : variant.relationships[0]?.type;
    const relationshipTarget = preservePaperModel ? baseModel.id : variant.relationships[0]?.targetModelId;
    const relationshipTargetName = preservePaperModel ? baseModel.name : supportedVariants[0].variant.name;
    const relation = !relationshipType ? ""
      : relationshipType === "extends" ? `This extension builds on ${relationshipTargetName}.`
        : relationshipType === "approximates" ? `This formulation approximates ${relationshipTargetName}.`
          : `This is an alternative to ${relationshipTargetName}.`;
    const authoredModel = {
      ...baseModel,
      id: emittedIds.get(variant.id),
      name: variant.name,
      kind: preservePaperModel && variant.kind === "baseline" ? "alternative" : variant.kind,
      relation,
      relationships: relationshipType ? [{ type: relationshipType, targetModelId: relationshipTarget }] : [],
      summary,
      ...setup,
      method,
      methodMaturity: localMethodSummary
        ? localMethodResult.maturity
        : groundedMethodSummary ? groundedMethodFallback.maturity : "inherited-paper-method",
      methodEvidence: localMethodSummary
        ? localMethodResult.source
        : groundedMethodSummary ? groundedMethodFallback.evidence : structuredClone(baseModel.methodEvidence || null),
      methodDiagnostics: localMethodSummary
        ? localMethodResult.diagnostics
        : groundedMethodSummary ? groundedMethodFallback.diagnostics : [{
            code: "method_inherited_from_base_model",
            message: "The paper-level baseline retains its already source-grounded method."
          }],
      sources: [modelSource],
      components
    };
    if (isPaperBaseline) authoredLiteratureBaseline = authoredModel;
    return authoredModel;
  });
  const models = authoredModels.filter(Boolean);
  const droppedExplicit = supportedVariants
    .filter((entry, index) => explicitlyPlannedNonbaseline(entry, index) && !authoredModels[index]);
  if (droppedExplicit.length) {
    const diagnostics = droppedExplicit.map((entry) => {
      const reason = materializationIssues.get(entry.variant.id) || "unknown materialization failure";
      return `${entry.variant.name}: ${reason}`;
    });
    throw new Error(`${record.id}: explicitly planned nonbaseline formulation failed semantic materialization (${diagnostics.join("; ")})`);
  }
  if (preservePaperModel) return models.length ? [baseModel, ...models] : [baseModel];
  if (!authoredModels[0]) return [baseModel];
  return models.length >= 2 ? models : [baseModel];
}

export function modelName(record, components = []) {
  const mapped = authoredEnglish(record.model_topic || "");
  if (record.detail_level === "model_map" && mapped && mapped.split(/\s+/).length <= 18
    && !hasExtractionNoise(mapped) && !organizationProse(mapped) && !/[.!?;:]\s|[.!?;:]$/.test(mapped)
    && !headingLabelRejectionReason(mapped)) return mapped;
  const title = authoredEnglish(record.title).split(/:\s+/)[0].replace(/[?!.]+$/, "");
  const titleCandidate = truncateWords(`${title} model`, 18);
  if (titleCandidate && !hasExtractionNoise(titleCandidate)) return titleCandidate;
  const decisionTail = title.match(/^(?:should|can|could|would|will|may|might|must)\s+.+?\s+(?:offer|choose|use|adopt|provide|set|share|disclose|invest(?:\s+in)?)\s+(.+)$/i)?.[1]
    ?.replace(/\b(It|This|That|These|Those)\b/g, (word) => word.toLowerCase());
  const decisionCandidate = truncateWords(`${decisionTail || ""} model`, 18);
  if (decisionTail && decisionCandidate && !hasExtractionNoise(decisionCandidate)) return decisionCandidate;
  const componentLabel = components.map((component) => authoredEnglish(component?.label))
    .find((label) => label && !hasExtractionNoise(label) && !headingLabelRejectionReason(label));
  const componentCandidate = truncateWords(`${componentLabel || "Paper-level"} model`, 18);
  if (!hasExtractionNoise(componentCandidate)) return componentCandidate;
  throw new Error(`${record.id}: no clean source-derived model name survived authoring`);
}

function lowerQuestionPhrase(value) {
  const text = authoredEnglish(value).replace(/[?!.]+$/, "").replace(/^(?:A|An|The)\b/u, (word) => word.toLocaleLowerCase());
  if (!text || /^[A-Z]{2,}(?:\b|[-/])/.test(text)) return text;
  return text.replace(/\b\p{Lu}\p{Ll}+(?:[’']\p{Ll}+)?\b/gu, (word) => word.toLocaleLowerCase());
}

function fallbackQuestionAuxiliary(value) {
  const text = authoredEnglish(value);
  return /^(?:both|these|those|two|three|four|multiple|several|many)\b/i.test(text)
    || /\band\b/i.test(text)
    || /(?:^|\s)(?!analysis\b|business\b|news\b|process\b)[\p{L}'’-]+s(?=\s+(?:by|for|from|in|of|on|that|to|under|when|where|which|who|with)\b|[,;:]|$)/iu.test(text)
    ? "do"
    : "does";
}

export function titleFallbackQuestion(record) {
  const rawTitle = authoredEnglish(record.title).replace(/[?!.]+$/, "");
  const questionSuffix = rawTitle.match(/\?\s+(?=\p{Lu})(.+)$/u)?.[1] || "";
  const title = authoredEnglish(questionSuffix || rawTitle).replace(/[?!.]+$/, "");
  if (!title) return "Which decisions, constraints, and relationships define the paper's focal model?";
  const repeatedPricing = title.match(/^Pricing\s+(.+?)\s*:\s*Pricing\s+(.+)$/i);
  if (repeatedPricing) return `How should ${lowerQuestionPhrase(repeatedPricing[1])} be priced ${lowerQuestionPhrase(repeatedPricing[2])}?`;
  const structuralTitle = authoredEnglish(title.includes(":") ? title.slice(title.indexOf(":") + 1) : title).replace(/[?!.]+$/, "");
  const infinitiveQuestion = structuralTitle.match(/^(How|When|Where|Why)\s+to\s+(.+)$/i);
  if (infinitiveQuestion) return `${infinitiveQuestion[1][0].toUpperCase()}${infinitiveQuestion[1].slice(1).toLowerCase()} should one ${lowerQuestionPhrase(infinitiveQuestion[2])}?`;
  const infinitiveChoice = structuralTitle.match(/^To\s+(.+?)\s+or\s+to\s+(.+)$/i);
  if (infinitiveChoice) return `What determines whether to ${lowerQuestionPhrase(infinitiveChoice[1])} or to ${lowerQuestionPhrase(infinitiveChoice[2])}?`;
  const whAssertion = structuralTitle.match(/^(Why|When)\s+(.+?)\s+(Affects?|Changes?|Determines?|Drives?|Improves?|Increases?|Influences?|Matters?|Meets?|Occurs?|Reduces?|Shapes?|Works?)(\s+.+)?$/i);
  if (whAssertion) {
    const baseVerb = ({
      affects: "affect", changes: "change", determines: "determine", drives: "drive", improves: "improve",
      increases: "increase", influences: "influence", matters: "matter", meets: "meet", occurs: "occur",
      reduces: "reduce", shapes: "shape", works: "work"
    })[whAssertion[3].toLowerCase()] || whAssertion[3].toLowerCase();
    const wh = `${whAssertion[1][0].toUpperCase()}${whAssertion[1].slice(1).toLowerCase()}`;
    const rawSubject = authoredEnglish(whAssertion[2]);
    const rawTail = authoredEnglish(whAssertion[4] || "");
    const subject = /^\p{Lu}[\p{L}'’-]+$/u.test(rawSubject) ? rawSubject : lowerQuestionPhrase(rawSubject);
    const tail = /^\p{Lu}[\p{L}'’-]+$/u.test(rawTail) ? rawTail : lowerQuestionPhrase(rawTail);
    return `${wh} ${fallbackQuestionAuxiliary(rawSubject)} ${subject} ${baseVerb}${tail ? ` ${tail}` : ""}?`;
  }
  const effect = structuralTitle.match(/^(?:The\s+)?(?:Effect|Impact|Influence|Role|Value|Power)\s+of\s+(.+?)\s+(?:on|in|for)\s+(.+)$/i);
  if (effect) return `How ${fallbackQuestionAuxiliary(effect[1])} ${lowerQuestionPhrase(effect[1])} affect ${lowerQuestionPhrase(effect[2])}?`;
  const tradeoff = structuralTitle.match(/^(?:A|The)?\s*Trade-off\s+(?:between|in)\s+(.+?)\s+(?:versus|vs\.?|and)\s+(.+)$/i);
  if (tradeoff) return `How do ${lowerQuestionPhrase(tradeoff[1])} and ${lowerQuestionPhrase(tradeoff[2])} trade off?`;
  const comparison = structuralTitle.match(/^(.+?)\s+(?:versus|vs\.?)\s+(.+)$/i);
  if (comparison) return `How do ${lowerQuestionPhrase(comparison[1])} and ${lowerQuestionPhrase(comparison[2])} compare?`;
  const instrumentalGerund = structuralTitle.match(/^(Using|Leveraging)\s+(.+?)\s+to\s+(.+)$/i);
  if (instrumentalGerund) {
    const participle = instrumentalGerund[1].toLowerCase() === "using" ? "used" : "leveraged";
    return `How can ${lowerQuestionPhrase(instrumentalGerund[2])} be ${participle} to ${lowerQuestionPhrase(instrumentalGerund[3])}?`;
  }
  const gerund = structuralTitle.match(/^(Maximizing|Minimizing|Optimizing|Managing|Modeling|Designing|Allocating|Assigning|Scheduling|Selecting|Balancing|Reducing|Improving|Estimating|Pricing|Planning|Protecting)\s+(.+)$/i);
  if (gerund) {
    const participle = ({
      maximizing: "maximized", minimizing: "minimized", optimizing: "optimized", managing: "managed", modeling: "modeled",
      designing: "designed", allocating: "allocated", assigning: "assigned", scheduling: "scheduled",
      selecting: "selected", balancing: "balanced", reducing: "reduced", improving: "improved",
      estimating: "estimated", pricing: "priced", planning: "planned", protecting: "protected"
    })[gerund[1].toLowerCase()];
    return `How should ${lowerQuestionPhrase(gerund[2])} be ${participle}?`;
  }
  const modeled = structuralTitle.match(/^(?:A|An|The)?\s*(?:Model|Framework|Approach|Method)\s+(?:for|of|to)\s+(.+)$/i);
  if (modeled) return `How can ${lowerQuestionPhrase(modeled[1])} be modeled?`;
  const conditional = structuralTitle.match(/^(.+?)\s+under\s+(.+)$/i);
  if (conditional) return `How can ${lowerQuestionPhrase(conditional[1])} be modeled under ${lowerQuestionPhrase(conditional[2])}?`;
  const contextual = structuralTitle.match(/^(.+?)\s+in\s+(.+)$/i);
  if (contextual) return `How can ${lowerQuestionPhrase(contextual[1])} be modeled in ${lowerQuestionPhrase(contextual[2])}?`;
  return `How can ${lowerQuestionPhrase(structuralTitle)} be formulated as a model?`;
}

function safeModeTitleQuestion(record) {
  const title = authoredEnglish(record.title).replace(/[?!.]+$/, "");
  if (!title) return "";
  const colonIndex = title.indexOf(":");
  const lead = authoredEnglish(colonIndex >= 0 ? title.slice(0, colonIndex) : title);
  const subtitle = authoredEnglish(colonIndex >= 0 ? title.slice(colonIndex + 1) : "");
  // Some source titles lead with a short rhetorical question and then state
  // the substantive modeled relation after the question mark. Treat that
  // second clause like a subtitle so the punctuation cannot be embedded in a
  // generated question (for example, "Match Your Own Price? Self-Matching as
  // a Retailer's Multichannel Pricing Strategy").
  const questionMarkIndex = lead.indexOf("?");
  const questionTail = authoredEnglish(questionMarkIndex >= 0 ? lead.slice(questionMarkIndex + 1) : "");
  const structural = subtitle || questionTail || lead;
  const patterns = [
    [title.match(/^Align(?:ing)?\s+(.+?)\s+with\s+(.+?)(?::|$)/iu), (match) => `How can ${lowerQuestionPhrase(match[1])} be aligned with ${lowerQuestionPhrase(match[2])}?`],
    [structural.match(/^Guiding\s+(.+?)\s+(?:Through|Using|Via)\s+(.+)$/iu), (match) => `How can ${lowerQuestionPhrase(match[2])} guide ${lowerQuestionPhrase(match[1])}?`],
    [structural.match(/^Activity\s+Sequencing\s+and\s+Selection\s+for\s+(.+)$/iu), (match) => `How should activities be sequenced and selected for ${lowerQuestionPhrase(match[1])}?`],
    [structural.match(/^(.+?)\s+as\s+((?:an?|the)\s+.+)$/iu), (match) => `How does ${lowerQuestionPhrase(match[1])} function as ${lowerQuestionPhrase(match[2])}?`],
    [title.match(/^(?:A|An|The)\s+Model\s+of\s+(.+?)\s+for\s+(.+)$/iu), (match) => `How can ${lowerQuestionPhrase(match[1])} support ${lowerQuestionPhrase(match[2])}?`],
    [structural.match(/^Optimizing\s+(.+?)\s+in\s+the\s+Presence\s+of\s+(.+)$/iu), (match) => `How does ${lowerQuestionPhrase(match[2])} affect optimal ${lowerQuestionPhrase(match[1])}?`],
    [structural.match(/^Closed[-\s]?Form\s+Solutions?\s+for\s+(.+)$/iu), (match) => `How can ${lowerQuestionPhrase(match[1])} be solved in closed form?`],
    [structural.match(/^(.+?)\s+with\s+(.+?)\s+and\s+Application\s+to\s+(.+)$/iu), (match) => `How can ${lowerQuestionPhrase(match[2])} support ${lowerQuestionPhrase(match[1])} in ${lowerQuestionPhrase(match[3])}?`],
    [structural.match(/^Constrained\s+(.+?)\s+Optimization\s+Under\s+(.+)$/iu), (match) => `How should ${lowerQuestionPhrase(match[1])} decisions be optimized under ${lowerQuestionPhrase(match[2])}?`],
    [structural.match(/^Optimal\s+(.+?)\s+for\s+(.+)$/iu), (match) => `How should ${lowerQuestionPhrase(match[1])} be designed for ${lowerQuestionPhrase(match[2])}?`],
    [structural.match(/^(.+?\bEquilibrium)\s+in\s+(.+)$/iu), (match) => `What characterizes ${lowerQuestionPhrase(match[1])} in ${lowerQuestionPhrase(match[2])}?`],
    [structural.match(/^(.+?)\s+and\s+(.+?)\s+in\s+(.+)$/iu), (match) => `How do ${lowerQuestionPhrase(match[1])} and ${lowerQuestionPhrase(match[2])} affect ${lowerQuestionPhrase(match[3])}?`],
    [structural.match(/^(.+?)\s+and\s+(.+)$/iu), (match) => `How do ${lowerQuestionPhrase(match[1])} and ${lowerQuestionPhrase(match[2])} interact?`],
    [structural.match(/^(.+?)\s+in\s+(.+)$/iu), (match) => `What role does ${lowerQuestionPhrase(match[1])} play in ${lowerQuestionPhrase(match[2])}?`],
    [structural.match(/^(.+?)\s+Under\s+(.+)$/iu), (match) => `How does ${lowerQuestionPhrase(match[2])} affect ${lowerQuestionPhrase(match[1])}?`]
  ];
  for (const [match, author] of patterns) {
    if (!match) continue;
    const question = authoredEnglish(author(match));
    if (isDirectResearchQuestion(question)
        && !/^How can .+ be (?:modeled|formulated as a model)\?$/iu.test(question)) return question;
  }
  return "";
}

function paperQuestion(record, options = {}) {
  if (options.formalEvidenceAllowed === false) {
    const safeQuestion = safeModeTitleQuestion(record);
    if (!safeQuestion) throw new Error(`${record.id}: no non-generic grammatical title-derived research question survived needs-review safe mode`);
    return {
      question: safeQuestion,
      maturity: "title-derived-fallback",
      source: { field: "title", transformation: "safe-mode-substantive-title-relation" },
      diagnostics: [{
        code: "research_question_safe_mode_title",
        message: "The warning-bearing extraction was excluded from question authoring; Atlas used a grammatical substantive relation stated in the title."
      }]
    };
  }
  const result = deriveResearchQuestion(record);
  if (result.question && isDirectResearchQuestion(result.question)) return result;
  const fallback = titleFallbackQuestion(record);
  if (!isDirectResearchQuestion(fallback)) throw new Error(`${record.id}: no grammatical source-derived research question`);
  return {
    question: fallback,
    maturity: "title-derived-fallback",
    source: { field: "title", transformation: "conservative-title-relation" },
    diagnostics: [...(result.diagnostics || []), {
      code: "research_question_title_fallback",
      message: "No explicit source question survived validation; Atlas generated a grammatical title-relation question and marks it as a fallback."
    }]
  };
}

function paperOverview(record) {
  const sources = record.detail_level === "model_map"
    ? [record.scope_note, record.review_note, firstUsefulSentences(record.abstract, 3, 88), record.model_topic]
    : [firstUsefulSentences(record.abstract, 3, 108), record.modeling_evidence, record.model_topic];
  const cleaned = sources.map((value) => authoredEnglish(withoutRecordFieldLabels(String(value || ""))
    .replace(/^(?:practice\s+and\s+policy\s+abstract|research\s+summary)\s*:\s*/i, "")
  ))
    .filter((value) => value
      && !/^included in the completed modeling-paper scope review/i.test(value)
      && !/^the scope review identified the modeling contribution/i.test(value));
  return completeAuthoredSummary(distinct(cleaned, 1).join(" "), 4, 180);
}

function locallyCompleteSectionComponents(record, pages, sections, conceptDefinitions, options = {}) {
  if (record.detail_level === "model_map") return [];
  const recovered = recoverPoolStructureDefinitions(recoverNestedDefinitionFormulations(
    recoverParentOptimizationObjectives(sections),
    pages
  ));
  const usedIds = new Set();
  return recovered
    // Notation/glossary tables inform setup and symbol authoring, but are not a
    // standalone model component. Treating the prose swallowed after such a
    // table as `Notation Definition` creates a false completeness obligation.
    .filter((section) => !NON_COMPONENT_REFERENCE_SECTION.test(authoredEnglish(section.title)))
    // This inventory becomes a release-completeness obligation after model
    // finalization.  Prefer a literal sentence that can itself ground a local
    // condition; otherwise a generic heading can select a descriptive aside,
    // create an expected component that finalization must correctly discard,
    // and then fail coverage even though a parity-ready sentence exists in
    // the same heading-bounded section.
    .map((section) => sectionComponent(section, pages, record, conceptDefinitions, usedIds, {
      ...options,
      preferConditionedSource: true
    }))
    .filter((component) => component
      && (component.conditions || []).some((condition) => locallyApplicableCondition(component, condition))
      && (component.conceptBindings || []).some((binding) => binding.status === "modeled"
        && (binding.conditionRefs || []).length
        && (binding.sourceRefs || []).length));
}

function componentAnchorKeys(component) {
  return (component?.sources || []).map((source) =>
    `${Number(source?.page) || 0}|${authoredEnglish(source?.quote).toLocaleLowerCase()}`);
}

function componentLocalSemanticText(component) {
  return [
    component?.label,
    component?.role,
    component?.explanation,
    component?.formal,
    ...(component?.searchPhrases || []),
    ...(component?.conditions || []),
    ...(component?.symbols || []).flatMap((symbol) => [symbol?.symbol, symbol?.meaning])
  ].filter(Boolean).join(" ");
}

function componentSectionKeys(component) {
  const label = normalizedSourceSection(component?.label);
  return (component?.sources || []).map((source) => {
    const section = authoredEnglish(source?.section).toLocaleLowerCase();
    return label && section ? `${label}|${section}` : "";
  }).filter(Boolean);
}

function assertSubstantiveHeadingCoverage(record, expectedComponents, models) {
  const retainedComponents = models.flatMap((model) => model.components || []);
  const retainedAnchors = new Set(retainedComponents.flatMap(componentAnchorKeys));
  const retainedSections = new Set(retainedComponents.flatMap(componentSectionKeys));
  const omitted = expectedComponents.filter((component) => {
    const hasExactAnchor = componentAnchorKeys(component).some((anchor) => retainedAnchors.has(anchor));
    // A recovered multi-page formulation and the original bounded section can
    // independently choose different semantic facets under the same printed
    // heading. One retained component is sufficient heading coverage; forcing
    // its unrelated sibling quote into that component creates false locality.
    const hasRepresentedSection = componentSectionKeys(component).some((key) => retainedSections.has(key));
    return !hasExactAnchor && !hasRepresentedSection;
  });
  if (omitted.length) {
    throw new Error(`${record.id}: recoverable substantive headings were omitted (${omitted.map((component) => component.label).join(", ")})`);
  }
}

function plannedSectionOwnsComponent(section, component) {
  const sectionTitle = normalizedSourceSection(section?.title);
  const sectionPage = Number(section?.page) || 0;
  const sectionEndPage = Number(section?.endPage ?? section?.page) || sectionPage;
  return (component?.sources || []).some((source) => {
    const sourceTitle = normalizedSourceSection(source?.section);
    const sourcePage = Number(source?.page) || 0;
    const sameTitle = sourceTitle && sectionTitle && (sourceTitle === sectionTitle
      || sourceTitle.startsWith(sectionTitle)
      || sectionTitle.startsWith(sourceTitle));
    return sameTitle && sourcePage >= sectionPage && sourcePage <= sectionEndPage;
  });
}

function retainExpectedSourceComponents(record, pages, sourceSections, expectedComponents, inputModels, conceptDefinitions) {
  if (!expectedComponents.length || !inputModels.length) return inputModels;
  const models = inputModels.map((model) => ({ ...model, components: [...(model.components || [])] }));
  const plan = planModelVariants(record, sourceSections, {
    maxVariants: record.detail_level === "model_map" ? 4 : 5
  });
  const modelByName = new Map(models.map((model) => [normalizedSourceSection(model.name), model]));
  const baseline = models.find((model) => model.kind === "baseline") || models[0];

  for (const expected of expectedComponents) {
    const anchors = componentAnchorKeys(expected);
    const expectedLabel = normalizedSourceSection(expected.label);
    const exactNamedOwners = plan.variants.filter((variant) =>
      (variant.sections || []).some((section) => normalizedSourceSection(section.title) === expectedLabel));
    // An exact, unique printed section heading is stronger ownership evidence
    // than lexical similarity to another model name.  This prevents a later
    // comparison such as "A Free Contract Substituting ..." from being kept
    // inside the similarly named no-free-contract benchmark merely because a
    // first component pass selected a quote from the benchmark's page span.
    const uniquelyNamedOwner = exactNamedOwners.length === 1 ? exactNamedOwners[0] : null;
    const plannedOwner = uniquelyNamedOwner || plan.variants.find((variant) =>
      (variant.sections || []).some((section) => plannedSectionOwnsComponent(section, expected)));
    const componentFocus = [
      expected.label,
      ...(expected.sources || []).map((source) => source?.section)
    ].filter(Boolean).join(" ");
    const lexicalOwner = models.map((model, index) => ({
      model,
      index,
      score: overlapScore(model.name, componentFocus)
    })).sort((left, right) => right.score - left.score || left.index - right.index)[0];
    const target = modelByName.get(normalizedSourceSection(plannedOwner?.name))
      || (lexicalOwner?.score > 0 ? lexicalOwner.model : null)
      || baseline;
    if (uniquelyNamedOwner) {
      for (const model of models) {
        if (model === target) continue;
        model.components = (model.components || []).filter((component) =>
          normalizedSourceSection(component.label) !== expectedLabel
            // A shared setup subsection may define a named benchmark even
            // though the section itself is planned under the paper-level
            // formulation. Keep that component in the benchmark only when a
            // retained structural condition explicitly names the model. This
            // preserves shared, source-grounded benchmark definitions without
            // allowing an unrelated same-label component to remain attached
            // to the wrong variant.
            || (component.conditions || []).some((condition) =>
              explicitLocalVariantCondition(condition)
                && hasSourceOverlap(model.name, condition)));
      }
    }
    const targetAnchors = new Set((target.components || []).flatMap(componentAnchorKeys));
    if (anchors.some((anchor) => targetAnchors.has(anchor))) continue;
    const completed = completeComponentParity(structuredClone(expected), target, conceptDefinitions, record.id);
    if (!completed?.sources?.length || !(completed.conditions || []).length
      || !(completed.conceptBindings || []).some((binding) => binding.status === "modeled"
        && (binding.conditionRefs || []).length && (binding.sourceRefs || []).length)) {
      continue;
    }
    const identityIndex = target.components.findIndex((component) => component.id === completed.id
      || normalizedSourceSection(component.label) === normalizedSourceSection(completed.label));
    if (identityIndex >= 0) {
      const current = target.components[identityIndex];
      const localText = componentLocalSemanticText(current);
      const compatibleSources = (completed.sources || []).filter((source) =>
        hasSourceOverlap(source?.quote || "", localText));
      // Two passes can select distinct facets of one multi-page heading. Keep
      // the already-retained facet when the sibling source has no overlap with
      // its local component instead of creating a false source citation.
      if (!compatibleSources.length) continue;
      const sourceKeys = new Set();
      const mergedSources = [...(current.sources || []), ...compatibleSources].filter((source) => {
        const key = normalizedComponentAnchor(source);
        if (!key || sourceKeys.has(key)) return false;
        sourceKeys.add(key);
        return true;
      });
      const merged = completeComponentParity({
        ...structuredClone(current),
        sources: mergedSources,
        conditions: distinct([...(current.conditions || []), ...(completed.conditions || [])])
      }, target, conceptDefinitions, record.id);
      if (merged) target.components[identityIndex] = merged;
    } else {
      target.components = dedupeComponents([...target.components, completed]);
    }
  }
  for (const model of models) model.components = sortComponentsBySourceOrder(model.components, pages);
  return models;
}

function enforceFormalEvidenceSafeMode(inputModels, pages, conceptDefinitions, paperId, setupSections = []) {
  return inputModels.map((inputModel) => {
    const model = enforceSafeModeSetup(structuredClone(inputModel), pages);
    let components = (model.components || []).flatMap((inputComponent) => {
      const component = structuredClone(inputComponent);
      const safeSources = (component.sources || []).filter((source) => {
        const page = pages.find((candidate) => Number(candidate?.page) === Number(source?.page));
        return page && !SAFE_MODE_SECTION_EXCLUSION.test(authoredEnglish(source?.section))
          && safeModeLiteralProse(source?.quote, page.text);
      }).map((source) => ({ ...source, equation: "" }));
      if (!safeSources.length || !safeModeLiteralProse(component.explanation)) return [];
      component.sources = safeSources;
      component.conditions = distinct((component.conditions || []).filter((condition) => {
        return safeSources.some((source) => {
          const page = pages.find((candidate) => Number(candidate?.page) === Number(source.page));
          return safeModeLiteralProse(condition, page?.text || "")
            && (isWhitespaceNormalizedSubstring(condition, page?.text || "")
              || hasSourceOverlap(condition, source.quote));
        });
      }));
      component.symbols = [];
      component.formal = sourceRestatement(component.role, component.explanation, []);
      component.formalKind = "Atlas restatement of source rule";
      component.conceptBindings = [];
      component.concepts = [];
      attachAutomatedRelevance(component, conceptDefinitions);
      const completed = completeComponentParity(component, model, conceptDefinitions, paperId);
      return completed ? [completed] : [];
    });
    components = dedupeComponents(components);
    if (!components.length) throw new Error(`${paperId}: no prose-grounded component survived needs-review safe mode`);
    const completedSetup = requireCompleteSetup(paperId ? { id: paperId } : {}, model, components, pages, {
      formalEvidenceAllowed: false,
      setupSections
    });
    components = components
      .map((component) => completeComponentParity(component, completedSetup, conceptDefinitions, paperId))
      .filter(Boolean);
    if (!components.length) throw new Error(`${paperId}: no component retained semantic parity in needs-review safe mode`);
    const sources = (model.sources || []).filter((source) => {
      const page = pages.find((candidate) => Number(candidate?.page) === Number(source?.page));
      return page && safeModeLiteralProse(source?.quote, page.text);
    }).map((source) => ({ ...source, equation: "" }));
    const method = safeModeLiteralProse(model.method)
      ? model.method
      : componentGroundedMethod(components)?.method || "";
    if (!method || !isSubstantiveMethodStatement(method)) {
      throw new Error(`${paperId}: no prose-grounded method survived needs-review safe mode`);
    }
    return {
      ...model,
      ...completedSetup,
      summary: completeAuthoredSummary(distinct([
        ...components.slice(0, 3).map((component) => component.explanation),
        method
      ]).join(" "), 3, 150),
      method,
      methodMaturity: method === model.method ? model.methodMaturity : "source-derived",
      sources: sources.length ? sources : [structuredClone(components[0].sources[0])],
      components: sortComponentsBySourceOrder(components, pages)
    };
  });
}

export function buildAuthoredNote(record, pagesPayload, conceptDefinitions, options = {}) {
  const pages = pagesPayload.pages || pagesPayload;
  if (!Array.isArray(pages) || !pages.length) throw new Error(`${record.id}: extracted pages are missing`);
  const parsedSections = extractSections(pages);
  const inlineSections = options.formalEvidenceAllowed === false
    ? recoverInlineNumberedSections(pages, parsedSections)
    : [];
  const allSections = [...parsedSections, ...inlineSections]
    .sort((left, right) => Number(left.page) - Number(right.page)
      || String(left.number || "").localeCompare(String(right.number || "")));
  const usableSections = allSections.filter((section) => usableSourceSection(section, record, allSections));
  const sourceSections = options.formalEvidenceAllowed === false
    ? [...allSections]
      .filter((section, index, values) => values.findIndex((candidate) => Number(candidate.page) === Number(section.page)
        && authoredEnglish(candidate.number) === authoredEnglish(section.number)
        && normalizedSourceSection(candidate.title) === normalizedSourceSection(section.title)) === index)
      .filter((section) => safeModeAuthoredSection(section)
      && !safeModeBackMatterOrCaptionSection(section, pages)
      && Number(section.endPage ?? section.page) - Number(section.page) <= 12)
    : usableSections;
  // A numbered Definitions and Problem Formulation parent can contain only a
  // roadmap sentence before its child heading starts on the following page.
  // Recover that narrowly verified child definition span before the general
  // model-prose filter; otherwise the parent is discarded before recovery can
  // establish that it is substantive.
  const selectedSections = options.formalEvidenceAllowed === false
    ? sourceSections
        .filter((section) => !SAFE_MODE_SECTION_EXCLUSION.test(authoredEnglish(section.title)))
        .slice(0, 12)
    : chooseSections(pages, record, 8);
  const sections = recoverNestedDefinitionFormulations(selectedSections, pages)
    .filter((section) => usableSourceSection(section, record, allSections));
  // Build a literature paper's baseline from common/baseline prose only. A
  // named extension may define a different information regime or assumption;
  // letting its section fill a missing whole-paper setup field silently merges
  // incompatible formulations before variant authoring has a chance to split
  // them. Deep, independently mapped records deliberately retain their richer
  // paper-level model and receive variants additively.
  const ownedByNonbaseline = nonbaselineVariantSections(record, sourceSections);
  const baselineSourceSections = ownedByNonbaseline.length
    ? sourceSections.filter((section) => !sectionMatchesOwnedVariant(section, ownedByNonbaseline))
    : sourceSections;
  const baselineAllSections = ownedByNonbaseline.length
    ? allSections.filter((section) => !sectionMatchesOwnedVariant(section, ownedByNonbaseline))
    : allSections;
  const baselineSelectedSections = ownedByNonbaseline.length
    ? sections.filter((section) => !sectionMatchesOwnedVariant(section, ownedByNonbaseline))
    : sections;
  const safeSelectedSections = baselineSelectedSections.length
    ? baselineSelectedSections
    : baselineSourceSections.slice(0, 8);
  const baseModel = mainModel(
    record,
    pages,
    safeSelectedSections,
    baselineSourceSections,
    conceptDefinitions,
    options.formalEvidenceAllowed === false ? baselineSourceSections : baselineAllSections,
    options
  );
  const expectedComponents = locallyCompleteSectionComponents(record, pages, sections, conceptDefinitions, options);
  let preFinalModels = retainExpectedSourceComponents(
    record,
    pages,
    sourceSections,
    expectedComponents,
    buildVariantModels(record, baseModel, pages, sourceSections, conceptDefinitions, allSections, options),
    conceptDefinitions
  );
  if (options.formalEvidenceAllowed === false) {
    preFinalModels = enforceFormalEvidenceSafeMode(preFinalModels, pages, conceptDefinitions, record.id, sourceSections);
  }
  const models = finalizeNoteModels(
    preFinalModels,
    conceptDefinitions,
    record.id
  );
  const retainedModelIds = new Set(models.map((model) => model.id));
  const lostModels = preFinalModels.filter((model) => !retainedModelIds.has(model.id));
  if (lostModels.length) {
    throw new Error(`${record.id}: source-grounded formulations were lost during finalization (${lostModels.map((model) => model.name).join(", ")})`);
  }
  assertSubstantiveHeadingCoverage(
    record,
    expectedComponents,
    models
  );
  if (options.formalEvidenceAllowed !== false) remapAuthoredSourceQuotes(models, pages, record.id);
  const researchQuestion = paperQuestion(record, options);
  const coveragePages = [...new Set(models.flatMap((model) => [
    ...model.sources.map((source) => source.page),
    ...model.components.flatMap((component) => component.sources.map((source) => source.page))
  ]))].sort((left, right) => left - right);
  const overview = options.formalEvidenceAllowed === false
    ? completeAuthoredSummary(distinct(models.flatMap((model) => [
      model.summary,
      model.method
    ])).join(" "), 4, 180)
    : paperOverview(record);
  return {
    id: record.id,
    question: researchQuestion.question,
    overview,
    modelTypes: modelTypes(record, sections.map((section) => `${section.title} ${section.text}`).join(" ")),
    coverage: {
      pages: coveragePages,
      note: record.detail_level === "model_map"
        ? "The existing independently audited model map was decomposed into Mini-style components and linked back to the page-preserving source extraction."
        : "Model, method, and formulation sections were mapped from the page-preserving source extraction; source anchors and schema references are checked independently from substantive expert review."
    },
    models,
    provenance: {
      authoringVersion: AUTHORING_VERSION,
      sourceTier: record.detail_level === "model_map" ? "audited-metadata-plus-source-map" : "full-text-source-map",
      editorialStatus: record.detail_level === "model_map" ? "PDF-audited catalog map with automated component bindings" : "automated full-text source map",
      bindingReviewStatus: AUTOMATED_REVIEW_STATUS,
      questionMaturity: researchQuestion.maturity,
      questionSource: researchQuestion.source,
      questionDiagnostics: researchQuestion.diagnostics,
      formulaPolicy: "Clean source transcriptions are retained; otherwise Atlas supplies an explicitly labeled verbal rule.",
      formalEvidenceAllowed: options.formalEvidenceAllowed !== false,
      sourcePdfSha256: record.pdf_sha256
    }
  };
}

export function buildReadingPacket(record, pagesPayload, pagesSha256, extractionQaStatus = "unknown") {
  const pages = pagesPayload.pages || pagesPayload;
  if (!Array.isArray(pages) || !pages.length) throw new Error(`${record.id}: extracted pages are missing`);
  const allSections = extractSections(pages);
  const selected = chooseSections(pages, record, 8);
  return {
    schemaVersion: 1,
    authoringVersion: AUTHORING_VERSION,
    paperId: record.id,
    sourcePdfSha256: record.pdf_sha256,
    extractionPagesSha256: pagesSha256,
    extractionQaStatus,
    pageCount: pages.length,
    sectionIndex: allSections.map((section) => ({
      number: section.number,
      title: section.title,
      startPage: section.page,
      endPage: section.endPage,
      relevanceScore: section.score
    })),
    selectedSections: selected.map((section) => ({
      number: section.number,
      title: section.title,
      startPage: section.page,
      endPage: section.endPage,
      sourceExcerpt: pageQuote(pages.find((page) => Number(page.page) === Number(section.page))?.text || "", section.title)
    })),
    reviewAnchors: reviewedAnchorPages(record, pages).map((page) => ({
      page,
      evidence: authoredEnglish(record.modeling_evidence || record.evidence_detail?.[0] || "")
    })),
    policy: "Candidate section index for resumable authoring. Selection is source-grounded but does not itself constitute independent expert verification."
  };
}

export function authoringInputDigest(record, pagesSha256, conceptRegistrySha256 = "") {
  return sha256(stableStringify({
    version: AUTHORING_VERSION,
    record,
    pagesSha256,
    conceptRegistrySha256
  }));
}

export function curatedInputDigest(envelope, conceptRegistrySha256 = envelope?.conceptRegistrySha256 || "") {
  return sha256(stableStringify({
    authoringVersion: envelope.authoringVersion,
    paperId: envelope.paperId,
    sourcePdfSha256: envelope.sourcePdfSha256,
    extractionPagesSha256: envelope.extractionPagesSha256,
    conceptRegistrySha256,
    note: envelope.note
  }));
}
