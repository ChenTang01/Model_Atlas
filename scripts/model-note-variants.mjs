import {
  hasExtractionNoise,
  isBoilerplate,
  isCaption
} from "./model-note-text-quality.mjs";
import { headingLabelRejectionReason } from "./model-note-semantic-audit.mjs";

export const ALLOWED_VARIANT_RELATIONSHIPS = Object.freeze(["extends", "alternativeTo", "approximates"]);
export const MAX_MODEL_VARIANTS = 5;

const GENERIC_WORDS = new Set([
  "alternative", "analysis", "architecture", "baseline", "benchmark", "case", "component", "counterfactual",
  "extension", "framework", "game", "layer", "learning", "main", "meta", "model", "regime", "scenario",
  "setting", "stage", "structure", "system", "the", "under"
]);

const GENERIC_ARCHITECTURE = [
  /^(?:players?|actors?|timing|sequence|process|actions?|decisions?)$/i,
  /^(?:information(?: structure)?|objective(?: and constraints?)?|constraints?|solution|method|equilibrium)$/i,
  /^(?:(?:the|main|base|baseline|basic|core|benchmark)\s+)?(?:models?|models and analysis|model analysis|model definition|definition of (?:the )?model|model description|model framework|model setting|model setup|model formulation|game formulation|problem formulation|analytical framework)(?:\s+and\s+(?:analysis|benchmark analysis|sequence of events))?$/i,
  /^(?:meta[- ]?game|market|process|player|decision|information) layers?$/i,
  /^(?:sequential\s*\/\s*stackelberg|simultaneous-move|dynamic\s*\/\s*stochastic|bayesian\s*\/\s*incomplete-information) game$/i,
  /^(?:mechanism\s*\/\s*contract\s*\/\s*auction|demand\s*\/\s*participation equilibrium|signaling\s*\/\s*information-design game)$/i,
  /^(?:cooperative\s*\/\s*bargaining game|non-game analytical\s*\/\s*empirical model)$/i
];
const GENERIC_BASELINE_ANCHOR = /^(?:(?:the|main|base|baseline|basic|core)\s+)?(?:models?|models and analysis|model definition|definition of (?:the )?model|model description|model framework|model setting|model setup|model formulation|problem formulation|(?:analytical|empirical|theoretical) framework)(?:\s+and\s+(?:analysis|benchmark analysis|sequence of events))?$/i;

// These headings name constituent blocks of one model, not competing model
// families.  Treating a demand block, a supply block, or the model's primitive
// definitions as an alternative creates exactly the wrong hierarchy in the
// note reader (and often copies the whole-paper setup into a fake variant).
const CONSTITUENT_MODEL_HEADING = /^(?:(?:model\s+)?(?:environment|primitives?|setup|setting)(?::.*)?|(?:data|demand|supply|arrival|choice|utility|cost|state|transition|matching|information)\s+(?:model|specification|formulation)|model\s+(?:environment|primitives?|setup|setting|sequence|timing)(?::.*)?)$/i;

const EXPLICIT_MARKER = /\b(?:alternatives?|baseline|benchmarks?|counterfactuals?|extensions?|regimes?|approximations?|relaxations?)\b/i;
const APPROXIMATION_MARKER = /\b(?:approximations?|approximate|relaxations?|surrogate)\b/i;
const EXTENSION_MARKER = /\b(?:extensions?|extended model)\b/i;
const BASELINE_MARKER = /\b(?:baseline|benchmarks?)\b/i;
const FIRST_BEST_MARKER = /\bfirst[ -]best\b/i;
const FULL_MODEL_HEADING = /^(?:the\s+)?full\s+model$/i;
const UNVERIFIABLE_REGIME = /\b(?:unverifiable|unobservable|without\s+(?:effort\s+)?monitoring|double\s+moral\s+hazard)\b/i;
const MONITORED_REGIME = /\b(?:(?:effort\s+)?monitoring|monitored\s+effort|verifiable\s+effort)\b/i;
const NAMED_LEARNING = /\b([A-Z])-Learning\b/g;
const GENERIC_EXTENSION_HEADING = /^(?:(?:other|further|additional|model)\s+extensions?|extensions?(?:\s+and\s+(?:discussions?|robustness(?:\s+of\s+(?:the\s+)?main\s+results?)?|numerical\s+examples?))?)$/i;
const GENERIC_VARIANT_HEADING = /^(?:counterfactual analys(?:is|es)|(?:other|further|additional|model)\s+extensions?|extensions?(?:\s+and\s+(?:discussions?|robustness(?:\s+of\s+(?:the\s+)?main\s+results?)?|numerical\s+examples?))?)$/i;
const DISTINCT_MODEL_EVIDENCE = /\b(?:(?:extended|alternative|counterfactual|modified|new)\s+(?:model|formulation|specification|framework|setting)|(?:model|formulation|specification|framework)\s+(?:is|are)\s+(?:extended|modified|changed)|(?:we|this section|the paper)\s+(?:introduce|develop|formulate|specify|extend|modify)\w*\s+(?:the\s+|an?\s+)?(?:baseline\s+|main\s+)?(?:model|formulation|specification|framework|setting)|(?:relax|replace|change)\w*\s+(?:an?\s+|the\s+)?(?:assumption|constraint|objective|timing|information structure)\s+(?:in|of|from)\s+(?:the\s+)?(?:baseline|main)\s+model)\b/i;
const FORMULATION_EVIDENCE = /\b(?:(?:we|this section|the paper)\s+(?:now\s+)?(?:construct|introduce|develop|formulate|specify|derive)\w*\b.{0,100}\b(?:model|formulation|specification|dynamic program)|(?:model|formulation|specification|dynamic program)\s+(?:can\s+be|is|are|was|were)\s+(?:then\s+)?(?:reformulated|recast|replaced|converted)|(?:replace|reformulate|recast)\w*\b.{0,100}\b(?:model|formulation|dynamic program))\b/i;
const DISTINCT_EXTENSION_FORMULATION_EVIDENCE = /\b(?:(?:we|this section|the paper)\s+(?:now\s+)?(?:introduce|develop|formulate|specify|construct)\w*\s+(?:an?\s+|the\s+)?(?:extended|modified|generalized|alternative)?\s*(?:model|formulation|specification|framework|setting)\b.{0,140}\b(?:that|where|in which|with|by|to\s+(?:allow|include|incorporate|permit|cover)|relax|replace|change|remove|add|incorporat)|(?:extend|modify|generalize)\w*\s+(?:an?\s+|the\s+|our\s+)?(?:baseline\s+|main\s+)?(?:model|formulation|specification|framework|setting)\s+(?:by|with|so that|to\s+(?:allow|include|incorporate|permit|cover))\b.{0,120}|(?:relax|replace|change|remove|add|incorporate)\w*\s+(?:an?\s+|the\s+)?(?:baseline\s+|main\s+)?(?:assumption|constraint|objective|timing|information structure|state|action|decision|demand|capacity)\b)\b/i;
const MODEL_FAMILY_HEADING = /\b(?:models?|formulations?|regimes?)\b/i;
const PLURAL_MODELS_HEADING = /\bmodels\b/i;
const STATIC_OPTIMIZATION_HEADING = /\bstatic\s+(?:(?:deterministic|nominal)\s+)?optimization\b/i;
const PAPER_DEFINITION_VOICE = /\b(?:we|this (?:paper|section|study))\s+(?:now\s+)?(?:provide|develop|introduce|formulate|define|characterize|present|propose|construct|study|consider)\w*\b/i;
const METHOD_OR_VALIDATION_HEADING = /\b(?:literature review|related (?:work|literature)|inference|estimat(?:ion|or)s?|numerical (?:experiments?|stud(?:y|ies))|experiments?|simulations?|evaluations?|validation|coverage analysis|predictive performance|robustness checks?|empirical (?:analysis|application)|debiased estimator)\b/i;
const NON_VARIANT_STUDY_HEADING = /^(?:(?:computational|numerical|empirical|simulation)\s+(?:stud(?:y|ies)|analys(?:is|es)|experiments?|experience|results?|examples?|illustrations?|insights?|evaluation|validation)\b|(?:real|synthetic)[ -]?data\s+(?:stud(?:y|ies)|analys(?:is|es)|experiments?|results?|evaluation|validation)\b|calibration\b|(?:data\s+(?:description|sources?)\s+and\s+)?model\s+calibration\b|model\s+recap\s+and\s+(?:an?\s+)?numerical\s+example\b|extensions?\s+and\s+(?:computational|numerical|empirical|simulation)\b)/i;
const NON_MODEL_CONTAINER_HEADING = /^(?:introduction(?:\s+and\s+(?:motivation|overview|contributions?|related\s+literature))?|motivation(?:\s+for\b.*)?|overview|data|conclusions?|literature review|related (?:work|literature)|background|(?:a\s+)?case\s+stud(?:y|ies)(?::.*)?|solution approach|(?:roadmap|outline)\s+of\s+(?:the\s+)?paper|organi[sz]ation(?:\s+of\s+(?:the\s+)?paper)?|(?:more\s+)?illustrative\s+examples?\b.*|(?:managerial\s+)?implications?|discussion|numerical (?:experiments?|stud(?:y|ies))|experiments?|simulations?)$/i;
// These labels describe how one model is explained, fitted, checked, or
// compared. They are useful component headings, but they do not establish a
// separate model family. In extracted journal PDFs they otherwise tend to win
// merely because they contain words such as "model" or "benchmark," which can
// displace the paper's actual formulation from the baseline.
const NON_VARIANT_DISCOURSE_HEADING = /^(?:(?:general|additional|further)\s+)?(?:discussion(?:\s+(?:(?:of|on)\b.*|and\s+(?:summary|conclusions?|concluding\s+remarks?|implications?)))?|comments?\s+on\b.*|summary\s+(?:of\s+contributions?|and\s+(?:conclusions?|concluding\s+remarks?)|and\s+future\s+work)|(?:key\s+results?\s+and\s+contributions?|main\s+(?:insights?\s+and\s+contributions?|contributions?(?:\s+of\s+this\s+paper|\s+and\s+(?:insights?|managerial\s+implications?))?)|objectives?\s+and\s+proposed\s+contributions?|approach\s+and\s+contributions?|research\s+questions?,?\s+objective,?\s+and\s+contributions?|contributions?\s+and\s+(?:managerial\s+implications?|structure|paper\s+overview)|contribution\s+(?:statement\s+and\s+organization\s+of\s+the\s+study|and\s+main\s+results?))|(?:(?:main\s+)?contributions?|contribution\s+and\s+overview\s+of\s+results?|contributions?\s+and\s+(?:contents?|overview))|conclusions?\s+and\s+(?:discussion|robustness|extensions?|future\s+work|further\s+research|insights?|final\s+remarks?)|conclusions?|concluding\s+remarks?|future\s+work)$/i;
const NON_VARIANT_ASSUMPTION_HEADING = /^(?:(?:discussion|comments?)\s+(?:of|on)\s+)?(?:the\s+)?(?:(?:data\s+and\s+)?model(?:ing)?\s+)?assumptions?(?:\s+(?:and|,)\s+.*)?$/i;
const NON_VARIANT_TRAINING_HEADING = /(?:\bmodel\s+training\b|^training\s+(?:an?\s+)?(?:predictive\s+)?model\b|\btraining\s+(?:procedure|process|strategy|and\s+predictive\s+test)\b|\bpredictive\s+(?:test|performance|evaluation)\b|^stabili[sz]ation\s+and\s+tuning\b|^(?:building\s+and\s+)?fitting\b.*\b(?:model|residuals?|prediction)\b)/i;
const NON_VARIANT_BENCHMARK_CONTAINER_HEADING = /^(?:benchmarks?$|benchmark\s+(?:methods?|models|strategies|scenarios|analysis|comparisons?|evaluation|performance|results?)\b|benchmark\b.*\bmodels$|(?:a|the)\s+benchmark\s+results?$|.*\bbenchmark\s+\d+\b)/i;
const NON_VARIANT_LITERATURE_HEADING = /^(?:(?:(?:prior|previous|existing|related)\s+)?literature\b|previous\s+work\s+on\b)/i;
const NON_VARIANT_MODEL_PROCESS_HEADING = /^(?:model\s+(?:overview|operationali[sz]ation|implications?|complexity\s+guarantees?)(?:\s+and\s+main\s+contributions?)?|overview\s+of\s+(?:the\s+)?model\s+and\s+results?|testing\s+model\s+implications?|properties\s+of\b.*\bmodel|selection\s+and\s+implementation\s+of\s+analytical\s+models?|numerics\s+on\s+(?:an?\s+)?calibrated\s+model|data\s*:\s*model\s+calibration|model\s+(?:fitting|selection)(?:\s+and\b.*)?|phase\s+\d+\s*:\s*fitting\s+(?:the\s+)?model\b.*|.+\bmodel\s+fitting\s+process|mapping\s+(?:the\s+)?theoretical\s+model\s+to\s+empirical\s+data|data\s+preparation\s+and\s+model\s+implementation|counterfactual\s+implementation|empirical\s+operationali[sz]ation|reformulat(?:ing|ion\s+of)\b.*\bproblem|relating\s+model\s+(?:analysis\s+to\s+field\s+data|predictions?\s+to\s+empirical\s+observations?)\b.*|calibrat(?:ing|ion\s+of)\s+model\s+parameters?\b.*|application\s+of\s+.+\s+model|model\s+variant\s+solution\s+structure|model\s+\d+)$/i;
const NON_VARIANT_COUNTERFACTUAL_ANALYSIS_HEADING = /^counterfactual\b.*\banalys(?:is|es)\b.*$/i;
const NON_VARIANT_ALTERNATIVES_CONTAINER_HEADING = /^(?:(?:financing|policy|solution|method|model)\s+)?alternatives?$/i;
// Some headings contain a model/extension keyword because they introduce a
// subsection of an already named formulation.  They should remain available
// for component ownership, but must not themselves become peer models.
const NON_VARIANT_CANDIDATE_ONLY_HEADING = /^(?:model\s+description\s+and\s+(?:equilibrium\s+)?results?\b.*|(?:model\s+framework|model)\s+and\s+benchmark\s+analysis|baseline\s+algorithm\s+design\s+and\s+regret\s+analysis|tractable\s+cases?\s*:\s*practical\s+pool(?:\s+structures?)?|further\s+analysis\s+and\s+model\s+extensions?)$/i;
const NON_VARIANT_REVIEW_SCAFFOLDING_HEADING = /^(?:review|summary)\s+of\s+(?:previous|prior|existing|related)\b.*$/i;
const NON_VARIANT_CITATION_PROSE_HEADING = /^(?:[A-Z][\p{L}'’.-]+(?:\s+(?:and|&)\s+[A-Z][\p{L}'’.-]+)?(?:\s+et\s+al\.)?)\s*\(\d{4}[a-z]?\)\s+(?:also\s+)?(?:analy[sz](?:e|es|ed)|appl(?:y|ies|ied)|deriv(?:e|es|ed)|find(?:s|ing)?|model(?:s|ed)?|obtain(?:s|ed)?|propos(?:e|es|ed)|show(?:s|ed)?|stud(?:y|ies|ied)|use(?:s|d)?)\b/iu;
const NON_VARIANT_PROSE_HEADING = /^(?:the\s+following\s+(?:proposition|theorem|lemma|corollary)\b|(?:first|second|third|fourth|finally),?\s+(?:we|the\s+paper)\b|(?:as\s+an\s+extension|following\s+the\s+dual\s+interpretation|whereas\s+the\b)|unlike\s+our\s+implementation,?\b|the\s+(?:driving\s+force\s+of\s+the\s+model|main\s+insights?\s+from\s+this\s+paper|value\s+of\b)|usually,?\s+.+\bresults?\s+in\b|in\s+(?:an?|the)\s+model\s+extension,?\s+(?:we|the\s+paper)\b|analogous\s+to\b|.*\b(?:model\s+and\s+)?(?:empirical\s+)?results?\s+appl(?:y|ies)$)/i;
const NON_VARIANT_RESEARCH_META_HEADING = /^(?:research\s+(?:questions?|contributions?|methodologies)(?:\s+(?:and|&)\s+(?:results?\s+preview|contributions?|practical\s+relevance))?|overview\s+and\s+main\s+contributions?|key\s+findings?(?:\s+(?:and|&)\s+(?:policy\s+)?implications?)?|the\s+percentage\s+improvements?\s+by\b.*)$/i;
const NON_VARIANT_RELATION_HEADING = /^(?:(?:relation|relationship)\s+to\s+(?:models?\s+of|prior\s+work\s+on|the\s+literature|benchmarks?)|contribution\s+to\s+the\s+literature)\b.*$/i;
const NON_VARIANT_OUTPUT_HEADING = /^(?:(?:response|output|text|image)\s+generated\s+by\s+(?:our|the)\s+model|section\s+\d+(?:\.\d+)*\s*:\s*(?:base|baseline|main)\s+model)$/i;
const NON_VARIANT_METHOD_APPROACH_HEADING = /^(?:(?:.*:\s*)?(?:an?\s+)?(?:optimization|solution|learning|estimation|computational|analytical)\s+approach(?:\s+from\s+(?:the\s+)?literature)?|.+\bapproximation\s+approach\s+from\s+(?:the\s+)?literature|alternative\s+approaches?\s+for\s+obtaining\s+(?:the\s+)?model\s+inputs?|rounding\s+(?:an?\s+)?(?:continuous|linear|convex)\s+relaxation)$/i;
const EMPIRICAL_VALIDATION_MODEL_HEADING = /^empirical\s+model$/i;
const EMPIRICAL_VALIDATION_EVIDENCE = /\b(?:empirical\s+validation|validat(?:e|es|ed|ing|ion)|simulat(?:e|es|ed|ing|ion)\b.{0,80}\bperformance|out-of-sample\s+performance)\b/i;
const CALIBRATED_MODEL_INSTANTIATION_HEADING = /^numerics\s+on\s+a\s+calibrated\s+model$/i;
const CALIBRATED_MODEL_SIMULATION_EVIDENCE = /\b(?:perform|run|conduct)\w*\s+simulations?\b[^.!?]{0,180}\b(?:parameters?\s+)?calibrat(?:e|es|ed|ing|ion)\b/i;
const CALIBRATED_MODEL_COMPARISON_EVIDENCE = /\bcompar\w*\s+(?:the\s+)?performance\b[^.!?]{0,140}\b(?:mechanisms?|polic(?:y|ies))\b/i;
const NON_VARIANT_EMPIRICAL_APPLICATION_HEADING = /^(?:using|applying|application\s+of)\s+(?:industry|field|administrative|observational|real[ -]?world|empirical)\s+data\b.*\b(?:model|formulation)\b/i;
const NON_VARIANT_POLICY_EVALUATION_HEADING = /^(?:benchmark\s+(?:algorithms?\s+and\s+evaluation\s+framework|polic(?:y|ies)\s+as\s+(?:lower|upper)\b.*\bbounds?)|counterfactual\s+polic(?:y|ies)\s+evaluation|(?:performance\s+and\s+)?comparison\s+with\s+benchmark\s+polic(?:y|ies)|(?:[A-Z][A-Za-z0-9-]*\s+)?polic(?:y|ies)\s+development\s+and\s+analysis|.*\bheuristic(?:\s+(?:solution|policy|algorithm))?)$/i;
const NON_VARIANT_ANALYSIS_RESULT_HEADING = /^(?:comparative\s+statics\b.*|sensitivity\b.*|performance\b.*|comparison\b.*|comparing\b.*|(?:privacy[- ]?)?regime(?:\s+and\s+welfare)?\s+comparison\b.*|.*\bcomparison\s+of\b.*|.*\bmodel\s+comparison\b.*|.*\bin\s+comparison|.*\bbetween\s+(?:the\s+)?benchmark\s+and\s+(?:the\s+)?main\s+model|.*\band\s+evaluation|(?:impact|effect)\s+of\b.*|equilibrium\s+(?:analys(?:is|es)|outcomes?|results?)\b.*|model\s+(?:and\s+)?proof\s+of\b.*|model\s+discussion|models\s+and\s+results?|case\s+stud(?:y|ies)\s*:\s*(?:(?:empirical|numerical|computational|simulation)\s+)?results?\b.*|(?:convergence\s+results?|key\s+results?(?:\s+and\s+main\s+contributions?)?|overview\s+of\s+(?:main\s+)?results?|overview\s+of\s+main\s+contributions?|findings?\s+and\s+contributions?)|(?:algorithm|policy|method)\s+and\s+results?\b.*|(?:competitive\s+and\s+)?approximation\s+ratios?\b.*|calibrating\s+(?:the\s+)?models?\s+and\s+testing\s+(?:the\s+)?approximations?|(?:computational\s+performance|performance\s+evaluation)\b.*|evaluation\s+of\s+(?:approximations?|polic(?:y|ies)|models?|methods?)\b.*|(?:(?:comparative|sensitivity|preliminary|supplementary|additional|computational|numerical|empirical|simulation)\s+)?analys(?:is|es)(?:\s+(?:of|for|from|under|and|with\s+respect\s+to)\b.*)?|(?:(?:main|additional|preliminary|supplemental|theoretical|analytical|numerical|computational|simulation|empirical|model|extended\s+model|baseline\s+model)\s+)?results?\b.*|baseline\s+model\s+analysis|(?:approximation\s+errors?|error\s+bounds?)\b.*|(?:.*:\s*)?approximation\s+bounds?\b.*|(?:approximation|performance)\s+guarantees?|(?:upper|lower)\s+bounds?(?:\s+.*)?|robustness(?:\s+(?:checks?|analysis|results?))?(?:\s+(?:of|for|under|and)\b.*)?|proofs?(?:\s+(?:of|for)\b.*)?)$/i;
const NON_VARIANT_ADDITIONAL_ANALYSIS_HEADING = /^(?:baseline\s+evaluation|versus\s+benchmark\s+solution|compared\s+with\b.*|.*\bcomparisons?\s+with\b.*|nonimplementability\b.*|first[ -]best\s+(?:payoff|outcome|result)\b.*|(?:competitive\s+and\s+)?approximation\s+factors?\b.*)$/i;
const NON_VARIANT_ADDITIONAL_META_HEADING = /^(?:discussions?\s+and\s+extensions?|model\s+parameters?|remarks?\s+on\s+(?:the\s+)?model|(?:managerial\s+)?implications?\s+of\s+(?:the\s+)?model|foundations?\s+for\s+(?:the\s+)?demand\s+model|model,?\s+problem\s+description,?\s+and\s+an?\s+approximation\s+algorithm|model\s+and\s+benchmark|alternative\s+benchmark\s+polic(?:y|ies)|alternative\s+(?:levers?\s+for\s+managing\s+congestion|shapes?\s+of\s+the\s+value\s+function)|first[ -]best\s+bound|(?:the\s+)?(?:reward\s+)?approximation\s+error|step\s+\d+\s*:\s*.*\bdeploy\s+polic(?:y|ies)|performing\s+an?\s+rollout\b.*|contrasting\b.*\bregimes?|(?:two\s+parametric|operating)\s+regimes?|the\s+optimal\s+operating\s+regime)$/i;
// These headings identify documentation, solution machinery, robustness
// checks, or a constituent block of an already named model.  A body sentence
// that happens to mention a model must not promote them to peer formulations.
const NON_VARIANT_NOTATION_HEADING = /^(?:(?:the\s+)?model\s+)?(?:notation|nomenclature|symbols?|parameter\s+definitions?)(?:\s+and\s+(?:definitions?|assumptions?))?$/i;
const NON_VARIANT_METHOD_COMPONENT_HEADING = /^(?:(?:learning|solution|optimization|estimation|training)\s+algorithms?|(?:devising|constructing|developing)\s+an?\s+(?:fptas|ptas|algorithm|heuristic)\b.*|.+\s+(?:pruning|solution|estimation|learning)\s+method|rationale\s+for\s+(?:the\s+)?approximation\b.*|alternative\s+measures?\s+for\b.*|dealing\s+with\b.*\bterms?|counterfactual\s+assignments?|.+\bpriority[- ]index\s+polic(?:y|ies)|model\s+limitations?|alternatives?\s+to\s+[A-Z0-9][A-Z0-9/+-]*(?:\s+and\s+[A-Z0-9][A-Z0-9/+-]*)?|alternative\s+to\s+the\s+(?:error|loss|metric|measure))$/i;
const NON_VARIANT_CONSTITUENT_FORMULATION_HEADING = /^(?:full\s+(?:model\s+)?formulation|(?:complete|combined|final)\s+formulation)$/i;
const SEQUENTIAL_SIMULTANEOUS_FORMULATION_HEADING = /^(?:sequential\s+model|simultaneous\s+model|simultaneous\s+quantity\s+competition)$/i;
const PRACTICAL_POOL_STRUCTURE_HEADING = /^(?:one\s+pool|disjoint\s+pools?|chained\s+pools?)$/i;
const GENERAL_POOL_FORMULATION_HEADING = /^solution\s+approach\s*:\s*general$/i;
const SIBLING_REGIME_CONTAINER_HEADING = /^(?:price|pricing|payment|selling|access|rental|service|contract|policy)\s+(?:systems?|schemes?|regimes?|formats?|models?)$/i;
const SIBLING_REGIME_MEMBER_HEADING = /\b(?:pricing|fees?|rates?|scheme|regime|format|rental\s+model|access)\b/i;
const PRICE_MECHANISM_HEADING = /^(?:price\s+rates?|per[- ]use\s+fees?)$/i;
const VARIANT_COMPARISON_HEADING = /(?:\bvs\.?(?=\s|$)|\bversus\b|\bcomparison\s+between\b)/i;
const VARIANT_RESULT_HEADING = /^results?\s*:\s*\S/i;
const CONSTITUENT_STAGE_MODEL_HEADING = /^(?:(?:first|second|third|fourth|final)[ -]stage\s+model|model\s+of\s+the\s+(?:first|second|third|fourth|final)[ -]stage\s+problem)$/i;
const NON_VARIANT_RESULT_LABEL = /^(?:(?:computed|estimated|predicted|generated)\s+from\b.*\bagainst\b.*\bbenchmark\b|baseline\b.*\b(?:after|over|across)\b.*\b(?:different|varying)\b.*\b(?:parameter|scenario)\s+ranges?\b)/i;
const PRELIMINARY_HEADING = /^(?:(?:model|problem)\s+)?preliminar(?:y|ies)$/i;
const DANGLING_TERMINAL_AUXILIARY = /\b(?:am|is|are|was|were|be|been|being|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would)$/i;
const PROSE_CONTINUATION_BOUNDARY = /\s+(?=(?:in\s+(?:the|this|our|a|an|previous|following)\b|we\b|this\s+(?:section|paper|study)\b|the\s+(?:paper|model|analysis|result|results|manager|seller|buyer|firm|platform)\b|our\s+(?:paper|model|analysis)\b|literature\b|consumers?\b))/i;
const HEADING_CONNECTOR = /^(?:a|an|and|as|at|by|ex|for|from|in|into|not|of|on|or|the|to|under|via|versus|with|without)$/i;
const BENCHMARK_SPECIFICATION_EVIDENCE = /\b(?:we\s+(?:assume|consider|define|let|model|suppose)\b|(?:platform|firms?|retailers?|suppliers?|consumers?|sellers?|buyers?|planners?|managers?|players?|inventory\s+management|mechanism|policy)\b[^.!?]{0,160}\b(?:choos(?:e|es)|decid(?:e|es)|follow(?:s)?|ha(?:s|ve)|know(?:s)?|observ(?:e|es)|offer(?:s)?|select(?:s)?|set(?:s)?|is\s+sold|are\s+sold)\b)/iu;

function cleanText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAuditedCalibratedModelInstantiation(record, section) {
  const text = cleanText(section?.text);
  return record?.detail_level === "model_map"
    && /\bindependently\s+audited\b/i.test(cleanText(record?.review_status))
    && /^\d+$/.test(cleanText(section?.number))
    && CALIBRATED_MODEL_INSTANTIATION_HEADING.test(cleanText(section?.title))
    && CALIBRATED_MODEL_SIMULATION_EVIDENCE.test(text)
    && CALIBRATED_MODEL_COMPARISON_EVIDENCE.test(text);
}

function stripSectionNumber(value) {
  return cleanText(value)
    .replace(/^(?:appendix\s+[A-Z](?:\.\d+){0,4}[.):]?|(?:\d+|[A-Z]\.\d+)(?:\.\d+){0,4}[.):]?|[A-Z][.):])\s+/i, "")
    .replace(/[.:]$/, "")
    .trim();
}

function hasDanglingTerminalAuxiliary(value) {
  return DANGLING_TERMINAL_AUXILIARY.test(cleanText(value).replace(/[.:;,]+$/, ""));
}

function recoverTruncatedSectionTitle(value, sectionText) {
  const title = stripSectionNumber(value);
  if (!hasDanglingTerminalAuxiliary(title)) {
    // PDF columns sometimes move the final noun of a colon-qualified
    // benchmark heading into the first body token (for example, `Simple
    // Random` + `Sampling`). Restore exactly one token only when the complete
    // phrase is repeated later in the same bounded section; this prevents an
    // ordinary sentence opener from being appended speculatively.
    if (/\bbenchmark\s*:\s*\S/iu.test(title)) {
      const text = cleanText(sectionText);
      const continuation = text.match(/^([\p{Lu}][\p{L}\p{N}'’\-]{2,})\b/u)?.[1] || "";
      const suffix = cleanText(title.split(":").slice(1).join(":"));
      const completePhrase = cleanText(`${suffix} ${continuation}`);
      if (continuation && !HEADING_CONNECTOR.test(continuation)
        && completePhrase.split(/\s+/u).length >= 3
        && text.slice(continuation.length).toLocaleLowerCase().includes(completePhrase.toLocaleLowerCase())) {
        return `${title} ${continuation}`;
      }
    }
    return title;
  }
  let remainder = cleanText(sectionText);
  if (!remainder) return title;
  if (remainder.toLowerCase().startsWith(title.toLowerCase())) remainder = remainder.slice(title.length).trim();
  const boundary = remainder.search(PROSE_CONTINUATION_BOUNDARY);
  const continuation = (boundary > 0 ? remainder.slice(0, boundary) : remainder)
    .replace(/[.:;,]+$/, "")
    .trim();
  const words = continuation.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
  const titleLike = words.length > 0 && words.length <= 8 && continuation.length <= 80
    && !/[.!?;:]/.test(continuation)
    && words.every((word) => HEADING_CONNECTOR.test(word) || /^(?:\p{Lu}|\d)/u.test(word));
  if (!titleLike) return title;
  const repaired = `${title} ${continuation}`;
  return hasDanglingTerminalAuxiliary(repaired) ? title : repaired;
}

function repeatedOrFragmentedCandidate(value) {
  const text = cleanText(value);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!text || text.length > 170 || words.length > 20) return true;
  if (/^\p{Ll}[\p{Ll}\d-]*(?:\s+\p{Ll}[\p{Ll}\d-]*){2,}/u.test(text)) return true;
  if (/\b(?:yes|no)$/i.test(text)) return true;
  if (/^[^\p{L}\p{N}]/u.test(text)) return true;
  if (/^(?:[,;:.)\]}]|and\b|or\b|of\b|with\b|without\b|to\b|for\b|from\b|under\b|if\b|when\b|where\b|while\b|then\b|thus\b|therefore\b|suppose\b|assuming\b|given\b|as\b|see\b|which\b|whether\b|how\b|in\s+all\s+other\b)/i.test(text)) return true;
  if (/\b(?:and|or|of|with|without|to|for|from|under|versus|vs\.?)$/i.test(text)) return true;
  if (hasDanglingTerminalAuxiliary(text)) return true;
  if ((text.match(/\(/g) || []).length !== (text.match(/\)/g) || []).length) return true;
  if (words.some((word, index) => index > 0 && word.length > 2 && word === words[index - 1])) return true;
  for (let width = 2; width <= Math.floor(words.length / 2); width += 1) {
    const tail = words.slice(-width).join(" ");
    const prior = words.slice(-2 * width, -width).join(" ");
    if (tail && tail === prior) return true;
  }
  return false;
}

function isCandidateArtifact(value) {
  const text = cleanText(value);
  return repeatedOrFragmentedCandidate(text)
    || hasExtractionNoise(text)
    || isBoilerplate(text)
    || isCaption(text);
}

function isNonVariantFacetHeading(value) {
  const text = stripSectionNumber(value);
  return NON_VARIANT_DISCOURSE_HEADING.test(text)
    || NON_VARIANT_ASSUMPTION_HEADING.test(text)
    || NON_VARIANT_TRAINING_HEADING.test(text)
    || NON_VARIANT_BENCHMARK_CONTAINER_HEADING.test(text)
    || NON_VARIANT_LITERATURE_HEADING.test(text)
    || NON_VARIANT_MODEL_PROCESS_HEADING.test(text)
    || NON_VARIANT_COUNTERFACTUAL_ANALYSIS_HEADING.test(text)
    || NON_VARIANT_ALTERNATIVES_CONTAINER_HEADING.test(text)
    || NON_VARIANT_REVIEW_SCAFFOLDING_HEADING.test(text)
    || NON_VARIANT_CITATION_PROSE_HEADING.test(text)
    || NON_VARIANT_PROSE_HEADING.test(text)
    || NON_VARIANT_RESEARCH_META_HEADING.test(text)
    || NON_VARIANT_RELATION_HEADING.test(text)
    || NON_VARIANT_OUTPUT_HEADING.test(text)
    || NON_VARIANT_EMPIRICAL_APPLICATION_HEADING.test(text)
    || NON_VARIANT_POLICY_EVALUATION_HEADING.test(text)
    || NON_VARIANT_ANALYSIS_RESULT_HEADING.test(text)
    || NON_VARIANT_ADDITIONAL_ANALYSIS_HEADING.test(text)
    || NON_VARIANT_ADDITIONAL_META_HEADING.test(text)
    || NON_VARIANT_NOTATION_HEADING.test(text)
    || NON_VARIANT_METHOD_COMPONENT_HEADING.test(text)
    || NON_VARIANT_CONSTITUENT_FORMULATION_HEADING.test(text)
    || /^extensions?\s+and\s+future\s+work$/i.test(text)
    || /\bpropert(?:y|ies)\s+(?:for|of)\s+(?:the\s+)?[^.!?]{0,80}\bmodel$/i.test(text);
}

function isExperimentalProcedureHeading(title, text) {
  const heading = stripSectionNumber(title);
  if (!/^(?:pick|fit|compute|compare|evaluate|generate|optimi[sz]e|use)\b/i.test(heading)) return false;
  return /\b(?:ground[- ]truth|simulated|transaction\s+data|test\s+bed|benchmark|run\s+time|revenue\s+under\s+the\s+decision)\b/i.test(`${heading} ${text}`)
    || /\b(?:as|and|our|the|with|against)\s*$/i.test(heading);
}

function isResultTableModelArtifact(title, number, text) {
  if (!/\b(?:model|benchmark|baseline|regime|formulation)\b/i.test(title)) return false;
  const prefix = cleanText(text).slice(0, 420);
  const tablePrefix = /^(?:\d{2,4}\s+)?(?:notes?\b|unadjusted\s+adjusted\b|product\s+capacities\b|problem\s+size\s+run\s+time\b|(?:[A-Za-z][A-Za-z0-9()*-]*\s+){0,4}(?:95%\s+CI|p-value|CPU\s*\(seconds\)|mean\s+standard\s+deviation)\b)/i.test(prefix)
    || /^(?:\d+(?:\.\d+)?\s+){5,}/.test(prefix);
  if (!tablePrefix) return false;
  return !FORMULATION_EVIDENCE.test(text)
    && !DISTINCT_MODEL_EVIDENCE.test(text)
    && !isExplicitBenchmarkModification({ text });
}

function isTabularOutputHeadingArtifact(title, number, text) {
  if (number) return false;
  const heading = stripSectionNumber(title);
  // Units printed at the end of an unnumbered model-comparison header are
  // table/figure output labels, never formulation names (for example,
  // "M2L and Model M1L (%)"). The body can start in the next PDF column and
  // contain few numeric cells, so reject this artifact from the heading alone.
  if (/\bmodels?\b.*\(%\)\s*$/iu.test(heading)) return true;
  if (!/^optimal\b/i.test(heading)) return false;
  const prefix = cleanText(text).slice(0, 520);
  const numericCells = prefix.match(/(?:^|\s)[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?=\s|$)/g) || [];
  return numericCells.length >= 8
    && !FORMULATION_EVIDENCE.test(prefix)
    && !DISTINCT_MODEL_EVIDENCE.test(prefix);
}

function isUnmodeledSpeculativeSection(title, text) {
  const heading = stripSectionNumber(title);
  const proposedOnly = /\b(?:could|would|might)\b[^.!?]{0,180}\b(?:model|setting|extension|formulation|allow|generalize)\b/i.test(text)
    && /\b(?:beyond\s+the\s+scope|do\s+not\s+pursue|future\s+(?:work|research)|left\s+for\s+future|not\s+(?:considered|modeled|analysed|analyzed))\b/i.test(text);
  if (!proposedOnly) return false;
  return /\b(?:extension|future|print\s+to\s+stock|model|formulation)\b/i.test(heading)
    && !/\b(?:we|this\s+(?:paper|section))\s+(?:now\s+)?(?:formulate|construct|develop|introduce|propose)\b/i.test(text);
}

function genericVariantHasModelEvidence(section) {
  if (GENERIC_EXTENSION_HEADING.test(section.title)) return DISTINCT_EXTENSION_FORMULATION_EVIDENCE.test(cleanText(section.text));
  return !GENERIC_VARIANT_HEADING.test(section.title) || hasDistinctModelEvidence(section.text);
}

function hasDistinctModelEvidence(value) {
  const text = cleanText(value);
  return DISTINCT_MODEL_EVIDENCE.test(text) || FORMULATION_EVIDENCE.test(text)
    || /\bwe\s+propose\s+(?:a|an|the)\s+[^.!?]{0,80}\bmodel\b[^.!?]{0,180}\b(?:replace|add|remove|allow|keep|identical|same|different)\b/i.test(text);
}

function sectionNumberTokens(value) {
  return cleanText(value).match(/[A-Za-z]+|\d+/g)?.map((token) => /^\d+$/.test(token) ? Number(token) : token.toUpperCase()) || [];
}

function compareSectionNumbers(left, right) {
  const leftTokens = sectionNumberTokens(left);
  const rightTokens = sectionNumberTokens(right);
  for (let index = 0; index < Math.max(leftTokens.length, rightTokens.length); index += 1) {
    if (leftTokens[index] === undefined) return -1;
    if (rightTokens[index] === undefined) return 1;
    if (leftTokens[index] === rightTokens[index]) continue;
    if (typeof leftTokens[index] === "number" && typeof rightTokens[index] === "number") return leftTokens[index] - rightTokens[index];
    return String(leftTokens[index]).localeCompare(String(rightTokens[index]));
  }
  return 0;
}

function isNumberedDescendant(number, ancestorNumber) {
  return Boolean(number && ancestorNumber && number.startsWith(`${ancestorNumber}.`));
}

function sameNumberedRoot(left, right) {
  const [leftRoot] = sectionNumberTokens(left);
  const [rightRoot] = sectionNumberTokens(right);
  return leftRoot !== undefined && leftRoot === rightRoot;
}

function slug(value, fallback = "model") {
  const result = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  return result || fallback;
}

function tokens(value) {
  const normalized = cleanText(value).toLowerCase();
  const compounds = normalized.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) || [];
  const words = normalized.match(/[a-z0-9]+/g) || [];
  return [...new Set([...compounds, ...words].filter((token) => token.length > 1 && !GENERIC_WORDS.has(token)))];
}

function overlapCount(left, right) {
  const wanted = new Set(tokens(left));
  let score = 0;
  for (const token of tokens(right)) if (wanted.has(token)) score += token.includes("-") ? 4 : token.length > 7 ? 2 : 1;
  return score;
}

function nearRecordTitleArtifact(recordTitle, sectionTitle, sectionPage, sectionNumber) {
  if (sectionNumber || Number(sectionPage) > 1) return false;
  const normalizedSectionTitle = cleanText(sectionTitle).replace(/[.!?]+$/, "").toLowerCase();
  const normalizedRecordTitle = cleanText(recordTitle).replace(/[.!?]+$/, "").toLowerCase();
  const sectionWords = normalizedSectionTitle.match(/[a-z0-9]+/g) || [];
  if (sectionWords.length < 4) return false;
  if (normalizedSectionTitle === normalizedRecordTitle || normalizedRecordTitle.startsWith(`${normalizedSectionTitle} `)) return true;
  const withoutAuthorPrefix = normalizedSectionTitle.replace(/^[a-z][a-z'-]+(?:\s+[a-z][a-z'-]+){0,2}\s*:\s*/, "");
  if (withoutAuthorPrefix !== normalizedSectionTitle
    && (withoutAuthorPrefix === normalizedRecordTitle || normalizedRecordTitle.startsWith(`${withoutAuthorPrefix} `))) return true;
  // A partial first-page heading that explicitly says model/formulation may be
  // a genuine section; exact/full title repeats above are always artifacts.
  if (/\b(?:model|formulation|regime|benchmark|extension)\b/i.test(sectionTitle)) return false;
  const titleWords = new Set(normalizedRecordTitle.match(/[a-z0-9]+/g) || []);
  const shared = sectionWords.filter((word) => titleWords.has(word)).length;
  return shared === sectionWords.length && shared / Math.max(1, titleWords.size) >= 0.4;
}

function isExplicitBenchmarkModification(section) {
  const text = cleanText(section?.text);
  return /\b(?:in|for)\s+this\s+benchmark\s+case\b.{0,140}\b(?:modify|change|relax|remove|replace|assum)\w*\b.{0,100}\b(?:main\s+)?model\b/i.test(text)
    || /\b(?:modify|change|relax|remove|replace|assum)\w*\s+(?:the\s+)?(?:main\s+)?model\b.{0,140}\bbenchmark\s+case\b/i.test(text);
}

function isConcreteBenchmarkFormulation(section) {
  const title = stripSectionNumber(section?.title);
  if (!/\bbenchmark\b/iu.test(title)
    || NON_VARIANT_BENCHMARK_CONTAINER_HEADING.test(title)
    || tokens(title).length < 1) return false;
  return BENCHMARK_SPECIFICATION_EVIDENCE.test(cleanText(section?.text));
}

function normalizeSections(sections) {
  if (!Array.isArray(sections)) throw new Error("sections must be an array");
  const normalized = sections.map((section, index) => {
    const literalSectionText = section?.sourceText || section?.text || section?.summary || "";
    const title = recoverTruncatedSectionTitle(section?.title, literalSectionText);
    if (!title) throw new Error(`sections[${index}].title is required`);
    const number = cleanText(section.number);
    // `extractSections` keeps a layout-cleaned `text` field for authoring and a
    // more literal `sourceText` field for provenance.  Variant claims such as
    // "we modify the main model" can be lost during column cleanup, so prefer
    // the literal text for source-grounded hierarchy decisions.
    const sourceText = cleanText(literalSectionText);
    const tableLikeModelSection = !number && /\bmodel\b/i.test(title)
      && /\b(?:absolute\s+distance|relative\s+distance|standard\s+error|coefficient|sample\s+size)\b.{0,100}\b(?:absolute\s+distance|relative\s+distance|standard\s+error|coefficient|sample\s+size)\b/i.test(sourceText);
    const resultTableModelArtifact = isResultTableModelArtifact(title, number, sourceText);
    const experimentalProcedureHeading = isExperimentalProcedureHeading(title, sourceText);
    const unmodeledSpeculativeSection = isUnmodeledSpeculativeSection(title, sourceText);
    return {
      index,
      number,
      title,
      page: Number(section.page) || 0,
      endPage: Number(section.endPage) || Number(section.page) || 0,
      text: sourceText,
      ancestorTitles: (section.ancestorTitles || []).map(cleanText).filter(Boolean),
      authoredHeadingRejection: headingLabelRejectionReason(title),
      rejectedArtifact: isCandidateArtifact(title),
      rejectedVariantSection: isCandidateArtifact(title)
        || tableLikeModelSection
        || resultTableModelArtifact
        || isTabularOutputHeadingArtifact(title, number, sourceText)
        || NON_VARIANT_RESULT_LABEL.test(title)
        || CONSTITUENT_STAGE_MODEL_HEADING.test(title)
        || experimentalProcedureHeading
        || unmodeledSpeculativeSection
        || isNonVariantFacetHeading(title)
        || NON_VARIANT_METHOD_APPROACH_HEADING.test(title)
        || (EMPIRICAL_VALIDATION_MODEL_HEADING.test(title)
          && EMPIRICAL_VALIDATION_EVIDENCE.test(sourceText))
        || NON_MODEL_CONTAINER_HEADING.test(title)
        || NON_VARIANT_STUDY_HEADING.test(title)
        || (GENERIC_VARIANT_HEADING.test(title) && !genericVariantHasModelEvidence({
          title,
          text: literalSectionText
        }))
    };
  });
  for (const section of normalized) {
    const lineage = normalized.filter((ancestor) => ancestor !== section
      && isNumberedDescendant(section.number, ancestor.number));
    const printedAncestors = (section.ancestorTitles || []).map((title) => ({ title }));
    section.methodOrValidationLineage = [section, ...lineage, ...printedAncestors]
      .some((entry) => METHOD_OR_VALIDATION_HEADING.test(entry.title)
        || NON_VARIANT_STUDY_HEADING.test(entry.title)
        || isNonVariantFacetHeading(entry.title)
        || /^(?:experimental|evaluation|validation)\s+(?:setup|design)$/i.test(entry.title));
    section.surveyModelTaxonomy = PLURAL_MODELS_HEADING.test(section.title)
      && !PAPER_DEFINITION_VOICE.test(section.text)
      && !hasDistinctModelEvidence(section.text);
    if ((section.methodOrValidationLineage && !isExplicitBenchmarkModification(section)
        && !isConcreteBenchmarkFormulation(section)
        && !hasDistinctModelEvidence(section.text))
      || section.surveyModelTaxonomy) section.rejectedVariantSection = true;
  }
  // A repeated section number immediately followed by a proper model heading
  // commonly comes from a running-column continuation misread as a heading.
  // Reject only the lowercase, earlier fragment; retain the later source-real
  // heading (for example §3 `Pricing Models and Assumptions`).
  for (const section of normalized) {
    if (!section.number || !/^\p{Ll}/u.test(section.text)) continue;
    const replacement = normalized.find((candidate) => candidate.index > section.index
      && candidate.number === section.number
      && candidate.page >= section.page
      && candidate.page <= section.page + 2
      && (MODEL_FAMILY_HEADING.test(candidate.title)
        || GENERIC_BASELINE_ANCHOR.test(candidate.title)));
    if (replacement) section.rejectedVariantSection = true;
  }
  return normalized;
}

function isGenericArchitecture(value) {
  const cleaned = cleanText(value);
  return !cleaned || GENERIC_ARCHITECTURE.some((pattern) => pattern.test(cleaned));
}

function classify(name, pairedWithWithout = false) {
  if (APPROXIMATION_MARKER.test(name)) return "approximation";
  if (EXTENSION_MARKER.test(name)) return "extension";
  if (BASELINE_MARKER.test(name) || FIRST_BEST_MARKER.test(name) || (pairedWithWithout && /\bwithout\b/i.test(name))) return "baseline";
  return "alternative";
}

function sectionCandidateName(title, text = "") {
  const named = [...title.matchAll(NAMED_LEARNING)][0]?.[0];
  if (named) return `${named} regime`;
  if (/^simultaneous\s+quantity\s+competition$/i.test(title)) return "Simultaneous Model";
  if (GENERAL_POOL_FORMULATION_HEADING.test(title)
    && /\bgeneral\s+pool\s+structures?\b/i.test(text)) return "General Pool Structure";
  return title;
}

function meaningfulKey(name) {
  return tokens(name).sort().join(" ");
}

function isNamedModelFamilySection(section) {
  const explicitBenchmarkModification = isExplicitBenchmarkModification(section);
  if (section.rejectedVariantSection || (section.methodOrValidationLineage && !explicitBenchmarkModification)
    || PRELIMINARY_HEADING.test(section.title) || isGenericArchitecture(section.title)
    || CONSTITUENT_MODEL_HEADING.test(section.title)) return false;
  if (PLURAL_MODELS_HEADING.test(section.title)
    && !PAPER_DEFINITION_VOICE.test(section.text)
    && !hasDistinctModelEvidence(section.text)) return false;
  // A passing sentence such as "we consider a model" inside a short or noisy
  // subsection is not enough to promote its heading to an alternative model.
  // A family must be named by the heading itself, or the local prose must
  // explicitly say that the formulation is being constructed/reformulated.
  const practicalPoolFormulation = PRACTICAL_POOL_STRUCTURE_HEADING.test(section.title)
    && /\bunder\s+structure\s+(?:1|D|C)\b/i.test(section.text)
    && /\b(?:DRNS|model|formulation|reformulation|recast)\b/i.test(section.text);
  return MODEL_FAMILY_HEADING.test(section.title)
    || STATIC_OPTIMIZATION_HEADING.test(section.title)
    || SEQUENTIAL_SIMULTANEOUS_FORMULATION_HEADING.test(section.title)
    || practicalPoolFormulation
    || explicitBenchmarkModification
    || (/\bcase\b/i.test(section.title) && hasDistinctModelEvidence(section.text))
    || FORMULATION_EVIDENCE.test(cleanText(section.text));
}

function candidatesOverlap(left, right) {
  const leftTokens = new Set(tokens(left.name));
  const rightTokens = new Set(tokens(right.name));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token));
  if (!shared.length) return false;
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  return left.kind === right.kind && shared.length === smallerSize
    && (smallerSize >= 2 || shared[0].length >= 8);
}

function addCandidate(candidates, candidate) {
  const key = meaningfulKey(candidate.name);
  const distinctFamilyPeers = (left, right) => left.distinctFamilyKey && right.distinctFamilyKey
    && left.distinctFamilyKey === right.distinctFamilyKey
    && left.familyMember !== right.familyMember;
  const existing = candidates.find((item) => meaningfulKey(item.name) === key
    || (!distinctFamilyPeers(item, candidate) && candidatesOverlap(item, candidate)));
  if (existing) {
    for (const sectionIndex of candidate.originSectionIndexes || []) existing.originSectionIndexes.add(sectionIndex);
    existing.evidence.push(...candidate.evidence);
    existing.originTitleOverrides = {
      ...(existing.originTitleOverrides || {}),
      ...(candidate.originTitleOverrides || {})
    };
    existing.allowSharedOrigin ||= Boolean(candidate.allowSharedOrigin);
    if (candidate.distinctFamilyKey) existing.distinctFamilyKey = candidate.distinctFamilyKey;
    if (candidate.familyMember) existing.familyMember = candidate.familyMember;
    if (candidate.foundational) existing.foundational = true;
    if (candidate.priority < existing.priority) existing.priority = candidate.priority;
    if (candidate.sectionNumber && (!existing.sectionNumber
      || compareSectionNumbers(candidate.sectionNumber, existing.sectionNumber) < 0)) existing.sectionNumber = candidate.sectionNumber;
    return existing;
  }
  const added = {
    ...candidate,
    originSectionIndexes: new Set(candidate.originSectionIndexes || []),
    originTitleOverrides: { ...(candidate.originTitleOverrides || {}) },
    evidence: [...candidate.evidence]
  };
  candidates.push(added);
  return added;
}

function addEmbeddedNetworkConfigurations(candidates, sections) {
  const configurations = [
    {
      code: "dd",
      name: "Dedicated Supply Network (dd)",
      pattern: /\bdedicated(?:\s+supply)?\s+net\s*work\s*\(\s*dd\s*\)/i,
      kind: "baseline"
    },
    {
      code: "fd",
      name: "Flexible Primary Network (fd)",
      pattern: /\b(?:partially\s+)?flexible(?:\s+net\s*work\s+with)?\s+primary(?:\s+flexibility|\s+net\s*work)?\s*\(\s*fd\s*\)/i,
      kind: "alternative"
    },
    {
      code: "df",
      name: "Flexible Backup Network (df)",
      pattern: /\b(?:partially\s+)?flexible(?:\s+net\s*work\s+with)?\s+backup(?:\s+flexibility|\s+net\s*work)?\s*\(\s*df\s*\)/i,
      kind: "alternative"
    },
    {
      code: "ff",
      name: "Fully Flexible Network (ff)",
      pattern: /\b(?:fully|full)\s+flexible(?:\s+net\s*work)?\s*\(\s*ff\s*\)/i,
      kind: "alternative"
    }
  ];
  const container = sections.find((section) => /\bfour\s+possible\b.{0,100}\b(?:network\s+)?(?:configurations?|networks?)\b/i.test(section.text)
    && configurations.every((configuration) => configuration.pattern.test(section.text)));
  if (!container) return;
  configurations.forEach((configuration, familyIndex) => {
    const explicit = sections.find((section) => !/\b(?:vs\.?|versus|comparison|analysis)\b/i.test(section.title)
      && new RegExp(`\\(\\s*${configuration.code}\\s*\\)`, "i").test(section.title));
    const origin = explicit || container;
    const sourcePhrase = configuration.pattern.exec(origin.text)?.[0]
      || configuration.pattern.exec(container.text)?.[0]
      || configuration.name;
    const syntheticNumber = container.number ? `${container.number}.${familyIndex + 1}` : "";
    addCandidate(candidates, {
      name: configuration.name,
      kind: configuration.kind,
      foundational: true,
      sectionNumber: explicit?.number || syntheticNumber,
      priority: -2,
      order: container.index + familyIndex / 10,
      originSectionIndexes: [origin.index],
      originTitleOverrides: explicit ? {} : { [origin.index]: configuration.name },
      allowSharedOrigin: !explicit,
      distinctFamilyKey: "network-flexibility-configuration",
      familyMember: configuration.code,
      evidence: [{ source: "section", sectionIndex: origin.index, text: cleanText(sourcePhrase) }]
    });
  });
}

function collapseSequentialSimultaneousCases(candidates) {
  const sequential = candidates.find((candidate) => /^sequential\s+model$/i.test(candidate.name));
  const simultaneous = candidates.find((candidate) => /^simultaneous\s+model$/i.test(candidate.name));
  if (!sequential || !simultaneous) return;
  const nested = candidates.filter((candidate) => candidate !== sequential && candidate !== simultaneous
    && /\bdirect\s+channel\s+only\b/i.test(candidate.name));
  for (const candidate of nested) {
    const target = /\bsimultaneous\b/i.test(candidate.name) ? simultaneous : sequential;
    for (const sectionIndex of candidate.originSectionIndexes) target.originSectionIndexes.add(sectionIndex);
    target.evidence.push(...candidate.evidence);
    target.originTitleOverrides = {
      ...(target.originTitleOverrides || {}),
      ...(candidate.originTitleOverrides || {})
    };
  }
  for (const candidate of nested) candidates.splice(candidates.indexOf(candidate), 1);
}

function absorbCandidate(parent, child) {
  for (const sectionIndex of child.originSectionIndexes) parent.originSectionIndexes.add(sectionIndex);
  parent.evidence.push(...child.evidence);
  parent.originTitleOverrides = {
    ...(parent.originTitleOverrides || {}),
    ...(child.originTitleOverrides || {})
  };
}

function collapseNestedFormulationSections(candidates, sections) {
  const genericChild = /^(?:(?:(?:problem|system)\s+description\s+and\s+)?(?:model|problem)\s+formulation|formulation\s+and\s+structural\s+properties)$/i;
  const children = candidates.filter((candidate) => genericChild.test(candidate.name));
  for (const child of children) {
    const childOrigins = [...child.originSectionIndexes].map((index) => sections[index]).filter(Boolean);
    const parents = candidates.filter((candidate) => candidate !== child
      && /\b(?:model|formulation)\b/i.test(candidate.name))
      .flatMap((candidate) => [...candidate.originSectionIndexes].map((index) => ({
        candidate,
        section: sections[index]
      })))
      .filter((entry) => entry.section?.number
        && childOrigins.some((origin) => isNumberedDescendant(origin.number, entry.section.number)
          // PDF column extraction sometimes drops the subsection number while
          // preserving the source order.  A generic formulation/structural-
          // properties heading immediately after a numbered model container is
          // still that container's body, not a second formulation.
          || (!origin.number && origin.index === entry.section.index + 1
            && origin.page >= entry.section.page
            && origin.page <= entry.section.endPage + 1)))
      .sort((left, right) => right.section.number.length - left.section.number.length);
    if (!parents.length) continue;
    absorbCandidate(parents[0].candidate, child);
    candidates.splice(candidates.indexOf(child), 1);
  }
}

function collapseNestedApproximationSections(candidates, sections) {
  const parents = candidates.filter((candidate) => /^relaxations?\s+and\s+polic(?:y|ies)\b/i.test(candidate.name));
  for (const parent of parents) {
    const parentOrigins = [...parent.originSectionIndexes].map((index) => sections[index]).filter(Boolean);
    const children = candidates.filter((candidate) => candidate !== parent
      && candidate.kind === "approximation"
      && [...candidate.originSectionIndexes].some((index) => parentOrigins.some((origin) =>
        origin.number && isNumberedDescendant(sections[index]?.number, origin.number))));
    for (const child of children) {
      absorbCandidate(parent, child);
      candidates.splice(candidates.indexOf(child), 1);
    }
  }
}

function isDirectNumberedChild(childNumber, parentNumber) {
  if (!isNumberedDescendant(childNumber, parentNumber)) return false;
  return sectionNumberTokens(childNumber).length === sectionNumberTokens(parentNumber).length + 1;
}

function addSiblingRegimeFamilies(candidates, sections) {
  for (const container of sections) {
    if (!container.number || container.rejectedVariantSection || container.authoredHeadingRejection) continue;
    const children = sections.filter((section) => !section.rejectedVariantSection
      && !section.authoredHeadingRejection
      && isDirectNumberedChild(section.number, container.number));
    const explicitContainer = SIBLING_REGIME_CONTAINER_HEADING.test(container.title);
    const priceMechanismPair = children.filter((section) => PRICE_MECHANISM_HEADING.test(section.title));
    const members = explicitContainer
      ? children.filter((section) => SIBLING_REGIME_MEMBER_HEADING.test(section.title))
      : priceMechanismPair;
    if (members.length < 2) continue;
    members.forEach((member, familyIndex) => addCandidate(candidates, {
      name: member.title,
      kind: familyIndex === 0 ? "baseline" : "alternative",
      foundational: true,
      sectionNumber: member.number,
      priority: -1,
      order: member.index,
      originSectionIndexes: [member.index],
      distinctFamilyKey: `sibling-regime-${container.index}`,
      familyMember: meaningfulKey(member.title),
      evidence: [{ source: "section", sectionIndex: member.index, text: member.title }]
    }));
  }
}

function collapseModelDevelopmentComponents(candidates, sections) {
  const parents = candidates.filter((candidate) => /^(?:model|framework)\s+(?:development|construction)$/i.test(candidate.name));
  for (const parent of parents) {
    const parentOrigins = [...parent.originSectionIndexes].map((index) => sections[index]).filter(Boolean);
    const children = candidates.filter((candidate) => candidate !== parent
      && candidate.kind !== "extension" && candidate.kind !== "approximation"
      && !candidate.distinctFamilyKey
      && !EXPLICIT_MARKER.test(candidate.name)
      && [...candidate.originSectionIndexes].some((index) => parentOrigins.some((origin) =>
        origin.number && isNumberedDescendant(sections[index]?.number, origin.number)))
      && ![...candidate.originSectionIndexes].some((index) => isExplicitBenchmarkModification(sections[index])));
    for (const child of children) {
      absorbCandidate(parent, child);
      candidates.splice(candidates.indexOf(child), 1);
    }
  }
}

function explicitCandidates(record, sections) {
  const candidates = [];
  const bestOriginFor = (name) => {
    const ranked = sections.filter((section) => !section.rejectedVariantSection && !section.authoredHeadingRejection)
      .map((section) => ({ section, score: overlapCount(name, section.title) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.section.index - right.section.index);
    return ranked[0] ? [ranked[0].section.index] : [];
  };
  const sectionTitles = sections.map((section) => section.title);
  const hasWith = sectionTitles.some((title) => /\bwith\b/i.test(title) && !/\bwithout\b/i.test(title));
  const hasWithout = sectionTitles.some((title) => /\bwithout\b/i.test(title));
  const pairedWithWithout = hasWith && hasWithout;
  const pairedMonitoringRegimes = sectionTitles.some((title) => UNVERIFIABLE_REGIME.test(title))
    && sectionTitles.some((title) => MONITORED_REGIME.test(title));
  const normalizedTitles = new Map(sectionTitles.map((title, index) => [cleanText(title).toLowerCase(), index]));
  const pairedNoTitleIndexes = new Set();
  sectionTitles.forEach((title, index) => {
    const negative = cleanText(title).match(/^no\s+(.+)$/i);
    if (!negative) return;
    const positiveIndex = normalizedTitles.get(cleanText(negative[1]).toLowerCase());
    if (positiveIndex === undefined) return;
    pairedNoTitleIndexes.add(index);
    pairedNoTitleIndexes.add(positiveIndex);
  });

  for (const section of sections) {
    if (section.rejectedVariantSection || section.authoredHeadingRejection
      || NON_VARIANT_CANDIDATE_ONLY_HEADING.test(section.title)
      || !genericVariantHasModelEvidence(section)) continue;
    if (nearRecordTitleArtifact(record.title, section.title, section.page, section.number)) continue;
    const namedLearning = NAMED_LEARNING.test(section.title);
    NAMED_LEARNING.lastIndex = 0;
    const namedModelFamily = isNamedModelFamilySection(section);
    const pairedTitle = pairedWithWithout && /\bwith(?:out)?\b/i.test(section.title);
    const firstBest = FIRST_BEST_MARKER.test(section.title);
    const monitoringRegime = pairedMonitoringRegimes && (UNVERIFIABLE_REGIME.test(section.title) || MONITORED_REGIME.test(section.title));
    const pairedNoTitle = pairedNoTitleIndexes.has(section.index);
    if (!EXPLICIT_MARKER.test(section.title) && !namedLearning && !namedModelFamily
      && !pairedTitle && !pairedNoTitle && !firstBest && !monitoringRegime) continue;
    const name = sectionCandidateName(section.title, section.text);
    const specialBaseline = (pairedNoTitle && /^no\s+/i.test(section.title))
      || name === "General Pool Structure";
    const timingFamilyMember = /\bsimultaneous\b/i.test(name)
      ? "simultaneous"
      : (/^sequential\s+model$/i.test(name) || /^two-period\s+model\s+with\s+direct\s+channel\s+only$/i.test(name)
        ? "sequential"
        : "");
    addCandidate(candidates, {
      name,
      kind: firstBest || specialBaseline ? "baseline" : classify(name, pairedTitle),
      foundational: namedModelFamily && !EXPLICIT_MARKER.test(section.title),
      sectionNumber: section.number,
      priority: 0,
      order: section.index,
      originSectionIndexes: [section.index],
      distinctFamilyKey: timingFamilyMember ? "sequential-simultaneous-timing" : undefined,
      familyMember: timingFamilyMember || undefined,
      evidence: [{ source: "section", sectionIndex: section.index, text: section.title }]
    });
  }

  // A specifically named, top-level calibrated numerical instantiation is a
  // source-defined model view in independently audited model maps when its own
  // prose literally says both how it is calibrated and what policies or
  // mechanisms it compares. Keep the broad numerical-study exclusion above;
  // this narrow evidence gate prevents generic calibration/results sections
  // from becoming peer formulations.
  for (const section of sections) {
    if (!isAuditedCalibratedModelInstantiation(record, section)) continue;
    addCandidate(candidates, {
      name: section.title,
      kind: "alternative",
      foundational: false,
      calibratedModelInstantiation: true,
      sectionNumber: section.number,
      priority: 0,
      order: section.index,
      originSectionIndexes: [section.index],
      evidence: [{ source: "section", sectionIndex: section.index, text: section.title }]
    });
  }

  addEmbeddedNetworkConfigurations(candidates, sections);
  addSiblingRegimeFamilies(candidates, sections);
  collapseSequentialSimultaneousCases(candidates);
  collapseNestedFormulationSections(candidates, sections);
  collapseNestedApproximationSections(candidates, sections);
  collapseModelDevelopmentComponents(candidates, sections);

  const recordText = [record.timing, ...(record.architecture_detail || [])].map(cleanText).filter(Boolean).join(" ");
  for (const match of recordText.matchAll(NAMED_LEARNING)) {
    const name = `${match[0]} regime`;
    addCandidate(candidates, {
      name,
      kind: "alternative",
      priority: 1,
      order: candidates.length,
      originSectionIndexes: bestOriginFor(name),
      evidence: [{ source: "record", field: "timing/architecture_detail", text: match[0] }]
    });
  }

  for (const architecture of record.game_architecture || []) {
    const value = cleanText(architecture);
    const originIndexes = bestOriginFor(value);
    const origin = originIndexes.length ? sections[originIndexes[0]] : null;
    if (isGenericArchitecture(value)
      || isCandidateArtifact(value)
      || isNonVariantFacetHeading(value)
      || METHOD_OR_VALIDATION_HEADING.test(value)
      || NON_VARIANT_STUDY_HEADING.test(value)
      || !EXPLICIT_MARKER.test(value)
      || (GENERIC_VARIANT_HEADING.test(value) && (!origin || !genericVariantHasModelEvidence(origin)))) continue;
    addCandidate(candidates, {
      name: value,
      kind: classify(value),
      priority: 2,
      order: candidates.length,
      originSectionIndexes: originIndexes,
      evidence: [{ source: "record", field: "game_architecture", text: value }]
    });
  }

  return {
    candidates,
    ignoredArchitectureFacets: (record.game_architecture || []).map(cleanText)
      .filter((value) => isGenericArchitecture(value) || isCandidateArtifact(value)
        || isNonVariantFacetHeading(value)
        || METHOD_OR_VALIDATION_HEADING.test(value) || NON_VARIANT_STUDY_HEADING.test(value) || !EXPLICIT_MARKER.test(value))
  };
}

function baselineName(record) {
  const topic = cleanText(record.model_topic);
  const topicWords = topic.split(/\s+/).filter(Boolean);
  const topicHeadingRejection = headingLabelRejectionReason(topic);
  const hardTopicHeadingRejection = topicHeadingRejection
    && topicHeadingRejection !== "not a recognizable semantic heading"
    && topicHeadingRejection !== "a single noncanonical noun";
  const metadataLabel = /^(?:problem definition|research (?:focus|question)|model (?:summary|description)|scope|abstract|objective|main finding|managerial insight)\s*:/i;
  const sentenceLike = /[.!?]$/.test(topic)
    || /^(?:we|our (?:paper|study|model)|this (?:paper|study|model)|the (?:paper|study|model))\b/i.test(topic)
    || (topicWords.length >= 7 && /\b(?:is|are|was|were|feels|shows|finds|demonstrates|examines|studies|investigates|proposes|establishes)\b/i.test(topic));
  if (topic && topicWords.length <= 14 && !metadataLabel.test(topic) && !sentenceLike
    && !hardTopicHeadingRejection) return topic;
  const title = cleanText(record.title).replace(/[.!?]+$/, "");
  const decisionTail = title.match(/^(?:should|can|could|would|will|may|might|must)\s+.+?\s+(?:offer|choose|use|adopt|provide|set|share|disclose|invest(?:\s+in)?)\s+(.+)$/i)?.[1]
    ?.replace(/\b(It|This|That|These|Those)\b/g, (word) => word.toLowerCase());
  if (decisionTail) return /\b(?:model|formulation|regime)$/i.test(decisionTail)
    ? decisionTail
    : `${decisionTail} baseline model`;
  return title
    ? (/\b(?:model|formulation|regime)$/i.test(title) ? title : `${title} baseline model`)
    : "Main model";
}

function hasIndependentBaselineAnchor(baseline, candidates, sections) {
  const alternativeOrigins = new Set(candidates.filter((candidate) => candidate !== baseline)
    .flatMap((candidate) => [...candidate.originSectionIndexes]));
  return sections.some((section) => !section.rejectedVariantSection
    && !section.authoredHeadingRejection
    && !alternativeOrigins.has(section.index)
    && (isGenericArchitecture(section.title) || overlapCount(baseline.name, section.title) > 0));
}

function groundsBaselineRelationship(candidate, sections) {
  if (candidate.kind !== "extension" && candidate.kind !== "approximation") return false;
  return [...candidate.originSectionIndexes].some((sectionIndex) => {
    const section = sections[sectionIndex];
    return section && /\b(?:baseline|main)\s+(?:model|formulation|specification|framework|setting)\b/i.test(section.text);
  });
}

function explicitlyModifiesEarlierModel(candidate, sections) {
  return [...candidate.originSectionIndexes].some((sectionIndex) => {
    const text = cleanText(sections[sectionIndex]?.text);
    return /\b(?:we|this\s+(?:paper|section|study))\s+(?:now\s+)?(?:modify|extend|expand|generalize)\w*\s+(?:it|(?:the|our)\s+(?:main\s+)?(?:model|formulation|framework))\b/i.test(text)
      || /\b(?:modify|extend|expand|generalize)\w*\s+(?:the|our)\s+(?:main\s+)?(?:model|formulation|framework)\b/i.test(text);
  });
}

function modelMapHasFoundationalPeerFamily(candidates, sections) {
  const foundational = candidates.filter((candidate) => candidate.foundational
    && candidate.kind !== "extension" && candidate.kind !== "approximation"
    && !isGenericArchitecture(candidate.name));
  if (foundational.length < 2) return false;
  const distinctFamilies = new Map();
  for (const candidate of foundational) {
    if (!candidate.distinctFamilyKey) continue;
    distinctFamilies.set(candidate.distinctFamilyKey, (distinctFamilies.get(candidate.distinctFamilyKey) || 0) + 1);
  }
  if ([...distinctFamilies.values()].some((count) => count >= 2)) return true;
  const parentKeys = foundational.map((candidate) => {
    const origin = [...candidate.originSectionIndexes].map((index) => sections[index]).find((section) => section?.number);
    const numberTokens = sectionNumberTokens(origin?.number);
    return numberTokens.length > 1 ? numberTokens.slice(0, -1).join(".") : "";
  });
  return parentKeys[0] && parentKeys.every((key) => key === parentKeys[0]);
}

function hasExplicitDistinctPeerFamily(candidates) {
  const familyCounts = new Map();
  for (const candidate of candidates) {
    if (!candidate.foundational || !candidate.distinctFamilyKey
      || candidate.kind === "extension" || candidate.kind === "approximation") continue;
    familyCounts.set(candidate.distinctFamilyKey, (familyCounts.get(candidate.distinctFamilyKey) || 0) + 1);
  }
  return [...familyCounts.values()].some((count) => count >= 2);
}

function chooseCandidates(record, discovered, sections, maximum) {
  const candidates = [...discovered].sort((left, right) => left.priority - right.priority
    || (left.sectionNumber && right.sectionNumber ? compareSectionNumbers(left.sectionNumber, right.sectionNumber) : 0)
    || left.order - right.order
    || left.name.localeCompare(right.name));
  const explicitBaseline = candidates.find((candidate) => candidate.kind === "baseline");
  const explicitFullModel = candidates.find((candidate) => FULL_MODEL_HEADING.test(candidate.name));
  const foundationalBaseline = candidates.find((candidate) => candidate.foundational
    && candidate.kind !== "extension" && candidate.kind !== "approximation");
  const coreFormulationBaseline = candidates.find((candidate) => candidate.foundational
    && candidate.kind !== "extension" && candidate.kind !== "approximation"
    && /\b(?:model|formulation)\b/i.test(candidate.name)
    && !/\bbenchmark\b/i.test(candidate.name));
  const genericBaselineAnchor = sections.find((section) => !section.rejectedVariantSection
    && !section.authoredHeadingRejection
    && GENERIC_BASELINE_ANCHOR.test(section.title));
  const preservePaperModel = record.detail_level === "model_map";
  const foundationalPeerFamily = preservePaperModel && modelMapHasFoundationalPeerFamily(candidates, sections);
  const explicitDistinctPeerFamily = hasExplicitDistinctPeerFamily(candidates);
  const laterExplicitDerivative = genericBaselineAnchor && candidates.find((candidate) =>
    [...candidate.originSectionIndexes].every((index) => genericBaselineAnchor.index < index)
      && explicitlyModifiesEarlierModel(candidate, sections));
  const genericAnchorPrecedesDerivative = genericBaselineAnchor && coreFormulationBaseline
    && [...coreFormulationBaseline.originSectionIndexes].every((index) => genericBaselineAnchor.index < index)
    && ([...coreFormulationBaseline.originSectionIndexes].some((index) => hasDistinctModelEvidence(sections[index]?.text || ""))
      || explicitlyModifiesEarlierModel(coreFormulationBaseline, sections));
  const syntheticBaseline = {
    name: preservePaperModel
      ? "Baseline model"
      : (genericBaselineAnchor && /^(?:analytical|empirical|theoretical)\s+framework$/i.test(genericBaselineAnchor.title)
        ? genericBaselineAnchor.title
        : baselineName(record)),
    kind: "baseline",
    priority: -1,
    order: -1,
    syntheticBaseline: true,
    sectionNumber: genericBaselineAnchor?.number || "",
    originSectionIndexes: new Set(genericBaselineAnchor ? [genericBaselineAnchor.index] : []),
    evidence: [
      { source: "record", field: record.model_topic ? "model_topic" : "title", text: cleanText(record.model_topic || record.title) },
      ...(genericBaselineAnchor
        ? [{ source: "section", sectionIndex: genericBaselineAnchor.index, text: genericBaselineAnchor.title }]
        : [])
    ]
  };
  // When a paper studies benchmark restrictions alongside an explicitly named
  // full model, the full formulation is the paper-level baseline. Benchmark
  // headings remain genuine locally owned alternatives; they must not displace
  // the common/full setup merely because they occur first numerically.
  const genericAnchorPrecedesBenchmark = genericBaselineAnchor && explicitBaseline
    && BASELINE_MARKER.test(explicitBaseline.name)
    && !explicitDistinctPeerFamily
    && [...explicitBaseline.originSectionIndexes].every((index) => genericBaselineAnchor.index < index);
  const baseline = preservePaperModel && !foundationalPeerFamily
    ? syntheticBaseline
    : explicitFullModel || (genericAnchorPrecedesDerivative || laterExplicitDerivative ? syntheticBaseline : coreFormulationBaseline)
      || (genericAnchorPrecedesBenchmark ? syntheticBaseline : explicitBaseline)
      || foundationalBaseline || syntheticBaseline;
  // Downstream section assignment uses the candidate kind to decide where
  // generic/shared formulation sections belong. Normalize a full/foundational
  // candidate selected as the first model here, rather than waiting until the
  // public output mapping, so shared `Model` material follows the true
  // baseline instead of remaining unassigned.
  const selectedBaseline = baseline.kind === "baseline" ? baseline : { ...baseline, kind: "baseline" };
  const selected = [selectedBaseline];
  for (const candidate of candidates) {
    if (candidate === baseline || selected.length >= maximum) continue;
    if (preservePaperModel && !foundationalPeerFamily && candidate.foundational
      && candidate.kind !== "extension" && candidate.kind !== "approximation"
      && !EXPLICIT_MARKER.test(candidate.name)) continue;
    selected.push(candidate.kind === "baseline" ? { ...candidate, kind: "alternative" } : candidate);
  }
  // One isolated regime heading is not enough to split a paper when the
  // supposed baseline is only a metadata label and no independent, authorable
  // source heading identifies that baseline. Multiple explicit regimes remain
  // mutually corroborating, as do extensions that explicitly name the main or
  // baseline formulation they modify.
  const isolatedConcreteBenchmark = selected.length === 2
    && [...(selected[1]?.originSectionIndexes || [])]
      .some((index) => isConcreteBenchmarkFormulation(sections[index]));
  if (selected.length === 2 && baseline.syntheticBaseline
    && !selected[1]?.calibratedModelInstantiation
    && !isolatedConcreteBenchmark
    && !hasIndependentBaselineAnchor(baseline, selected, sections)
    && !groundsBaselineRelationship(selected[1], sections)) {
    return { selected: [baseline], capped: false };
  }
  return { selected, capped: candidates.length + Number(!explicitBaseline && !foundationalBaseline) > maximum };
}

function assignSections(variants, sections) {
  const assigned = new Set();
  const allocations = new Map(variants.map((variant) => [variant, []]));

  for (const variant of variants) {
    for (const sectionIndex of [...variant.originSectionIndexes].sort((left, right) => left - right)) {
      if ((assigned.has(sectionIndex) && !variant.allowSharedOrigin) || !sections[sectionIndex]) continue;
      assigned.add(sectionIndex);
      allocations.get(variant).push({
        ...sections[sectionIndex],
        title: variant.originTitleOverrides?.[sectionIndex] || sections[sectionIndex].title,
        score: 1000,
        reason: "explicit-heading"
      });
    }
  }

  for (const section of sections) {
    // Pairwise comparison sections analyze already identified formulations.
    // They may still supply a locally owned component, but they can never
    // establish a new model merely because both model names occur in the
    // heading.
    if (assigned.has(section.index)
      || (section.rejectedVariantSection
        && !VARIANT_COMPARISON_HEADING.test(section.title)
        && !VARIANT_RESULT_HEADING.test(section.title))) continue;
    const directionalComparison = section.title.match(/^(.*?)\s+(?:vs\.?|versus)\s+/i);
    if (directionalComparison?.[1]) {
      const primaryOwners = variants.map((variant, variantIndex) => ({
        variant,
        variantIndex,
        score: overlapCount(variant.name, directionalComparison[1])
      })).filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.variantIndex - right.variantIndex);
      if (primaryOwners.length && primaryOwners[0].score > (primaryOwners[1]?.score || 0)) {
        assigned.add(section.index);
        allocations.get(primaryOwners[0].variant).push({
          ...section,
          score: 950 + primaryOwners[0].score,
          reason: "variant-comparison-primary"
        });
        continue;
      }
    }
    const numberedOwners = variants.map((variant, variantIndex) => {
      const origins = [...variant.originSectionIndexes]
        .map((sectionIndex) => sections[sectionIndex])
        .filter((origin) => origin?.number && isNumberedDescendant(section.number, origin.number))
        .sort((left, right) => right.number.length - left.number.length || left.index - right.index);
      return { variant, variantIndex, origin: origins[0] };
    }).filter((entry) => entry.origin)
      .sort((left, right) => right.origin.number.length - left.origin.number.length || left.variantIndex - right.variantIndex);
    if (numberedOwners.length) {
      assigned.add(section.index);
      allocations.get(numberedOwners[0].variant).push({ ...section, score: 900, reason: "numbered-descendant" });
      continue;
    }

    const numberedOrigins = variants.flatMap((variant, variantIndex) => [...variant.originSectionIndexes]
      .map((sectionIndex) => sections[sectionIndex])
      .filter((origin) => origin?.number)
      .map((origin) => ({ variant, variantIndex, origin })));
    const ancestorOwners = numberedOrigins
      .filter((entry) => isNumberedDescendant(entry.origin.number, section.number))
      .sort((left, right) => compareSectionNumbers(left.origin.number, right.origin.number)
        || left.variantIndex - right.variantIndex);
    if (ancestorOwners.length) {
      const nearest = ancestorOwners[0];
      // A later extension subsection does not own the common parent chapter.
      // When the baseline is synthetic (and therefore has no numbered origin),
      // keep that shared container with the baseline instead of allowing the
      // extension to erase the paper's common setup.
      const baselineTitleOverlap = overlapCount(variants[0].name, section.title) > 0;
      const owner = baselineTitleOverlap
        ? variants[0]
        : ancestorOwners.some((entry) => entry.variant !== nearest.variant)
        ? variants[0]
        : nearest.variant.kind === "extension" || nearest.variant.kind === "approximation"
        ? variants[0]
        : nearest.variant;
      assigned.add(section.index);
      allocations.get(owner).push({ ...section, score: 850, reason: "numbered-ancestor" });
      continue;
    }

    // Within a numbered model chapter, prelude sections before the first
    // family belong to that first (foundational) family. Later unmarked sibling
    // sections return to the baseline unless their heading explicitly names a
    // family. This prevents an extension at 3.2 from swallowing an unrelated
    // baseline section at 3.3 merely because both share the chapter root.
    const siblingOrigins = numberedOrigins
      .filter((entry) => sameNumberedRoot(entry.origin.number, section.number))
      .sort((left, right) => compareSectionNumbers(left.origin.number, right.origin.number)
        || left.variantIndex - right.variantIndex);
    if (section.number && siblingOrigins.length) {
      const preceding = siblingOrigins.filter((entry) => compareSectionNumbers(entry.origin.number, section.number) <= 0);
      const baseline = siblingOrigins.find((entry) => entry.variant === variants[0]);
      const prior = preceding.at(-1);
      const explicitExtensionContinuation = prior?.variant?.kind === "extension"
        && EXTENSION_MARKER.test(section.text);
      const firstOrigin = siblingOrigins[0];
      const syntheticBaseline = { variant: variants[0], variantIndex: 0 };
      const owner = !preceding.length
        ? (firstOrigin.variant.kind !== "baseline"
          ? syntheticBaseline
          : firstOrigin)
        : explicitExtensionContinuation ? prior
          : (baseline || syntheticBaseline);
      if (!owner) continue;
      assigned.add(section.index);
      allocations.get(owner.variant).push({ ...section, score: 800, reason: "numbered-sibling-lineage" });
      continue;
    }
    if (!section.number) continue;
    const ranked = variants.map((variant, variantIndex) => {
      // A heading about the active mechanism (for example "Referral Rewards
      // Substituting ...") is not owned by a benchmark that explicitly removes
      // that mechanism.  Require the later heading to repeat the restriction
      // before token overlap can attach it to a `without`/`no-X` regime.
      const restrictedVariant = /\bwithout\b|\bno[- ](?=[A-Za-z])/i.test(variant.name);
      const repeatsRestriction = /\bwithout\b|\bno[- ](?=[A-Za-z])/i.test(section.title);
      const titleOverlap = restrictedVariant && !repeatsRestriction
        ? 0
        : overlapCount(variant.name, section.title);
      const titleScore = titleOverlap * 8;
      // Variant ownership must be visible in the section heading.  A passing
      // mention in an introduction, comparison, or conclusion is contextual
      // discussion, not evidence that the whole section specifies that model.
      const bodyScore = titleOverlap > 0 ? Math.min(8, overlapCount(variant.name, section.text)) : 0;
      const genericBaseline = variant.kind === "baseline" && /\b(?:model|formulation|framework|setting|setup)\b/i.test(section.title) ? 1 : 0;
      return { variant, variantIndex, titleOverlap, genericBaseline, score: titleScore + bodyScore + genericBaseline };
    }).sort((left, right) => right.score - left.score || left.variantIndex - right.variantIndex);
    if (!ranked[0] || ranked[0].score <= 0) continue;
    assigned.add(section.index);
    allocations.get(ranked[0].variant).push({ ...section, score: ranked[0].score, reason: "token-overlap" });
  }

  // Once the peer-model families are fixed, any remaining authorable
  // substantive section describes the paper-level formulation unless the
  // source explicitly ties it to another variant. This is especially
  // important for extraction runs that lose section numbers (for example,
  // an unnumbered Demand Specification immediately after Model) and for
  // single-model papers whose core method is named without the word "model."
  const baseline = variants[0];
  for (const section of sections) {
    if (assigned.has(section.index) || section.rejectedVariantSection || section.authoredHeadingRejection) continue;
    if (!section.number && variants.length > 1 && !CONSTITUENT_MODEL_HEADING.test(section.title)) continue;
    assigned.add(section.index);
    allocations.get(baseline).push({ ...section, score: 1, reason: "paper-baseline-facet" });
  }

  return allocations;
}

function uniqueId(name, used) {
  const base = slug(name);
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

export function planModelVariants(record, extractedSections, options = {}) {
  if (!record || typeof record !== "object") throw new Error("record is required");
  const maximum = Number.isInteger(options.maxVariants)
    ? Math.max(1, Math.min(MAX_MODEL_VARIANTS, options.maxVariants))
    : MAX_MODEL_VARIANTS;
  const sections = normalizeSections(extractedSections);
  // Running-title fragments on page 1 can be close enough to a later model
  // subsection to merge into it. Reject them from both discovery and fallback
  // ownership, not merely from the candidate-name pass.
  for (const section of sections) {
    if (nearRecordTitleArtifact(record.title, section.title, section.page, section.number)) {
      section.rejectedVariantSection = true;
    }
  }
  const discovered = explicitCandidates(record, sections);
  const chosen = chooseCandidates(record, discovered.candidates, sections, maximum);
  const allocations = assignSections(chosen.selected, sections);
  const usedIds = new Set();
  const baselineId = uniqueId(chosen.selected[0].name, usedIds);
  const variants = chosen.selected.map((candidate, index) => {
    const id = index === 0 ? baselineId : uniqueId(candidate.name, usedIds);
    const relationshipType = candidate.kind === "extension" ? "extends"
      : candidate.kind === "approximation" ? "approximates"
        : index === 0 ? "" : "alternativeTo";
    const relationshipPhrase = {
      extends: "an extension of",
      approximates: "an approximation of",
      alternativeTo: "an alternative to"
    }[relationshipType];
    return {
      id,
      name: candidate.name,
      kind: index === 0 ? "baseline" : candidate.kind,
      relation: relationshipType ? `${candidate.name} is source-identified as ${relationshipPhrase} ${chosen.selected[0].name}.` : "",
      relationships: relationshipType ? [{ type: relationshipType, targetModelId: baselineId }] : [],
      sections: allocations.get(candidate).map(({ index: sectionIndex, title, page, endPage, score, reason }) => ({
        sectionIndex,
        title,
        page,
        endPage,
        score,
        reason
      })).sort((left, right) => left.sectionIndex - right.sectionIndex),
      evidence: candidate.evidence
    };
  });

  return {
    paperId: cleanText(record.id),
    variants,
    diagnostics: {
      explicitCandidateCount: discovered.candidates.length,
      ignoredArchitectureFacets: discovered.ignoredArchitectureFacets,
      capped: chosen.capped,
      unassignedSectionIndexes: sections.map((section) => section.index)
        .filter((sectionIndex) => !variants.some((variant) => variant.sections.some((section) => section.sectionIndex === sectionIndex)))
    }
  };
}
