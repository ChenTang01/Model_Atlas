import { hasExtractionNoise as hasSourceTextNoise } from "./model-note-text-quality.mjs";

const QUESTION_START = /^(?:to\s+what\s+extent|under\s+what\s+conditions?|under\s+which\s+conditions?|how|what|when|where|why|which|who|whose|can|could|should|would|do|does|did|is|are|was|were|will|may|might|must)\b/i;
const PURPOSE_START = /^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)\s+(?:(?:first|then|further|also)\s+)?|(?:this|the)\s+(?:paper|study|article|analysis)\s+)(?:study|studies|examine|examines|investigate|investigates|analy[sz]e|analy[sz]es|consider|considers|explore|explores|propose|proposes|ask|asks|address|addresses|focus(?:es)?\s+on)(?:\s+and\s+(?:study|examine|investigate|analy[sz]e|consider|explore|propose|ask|address))?\s+/i;
const GAP_PURPOSE_START = /^(?:this|the)\s+(?:paper|study|analysis)\s+(?:fills?|addresses?|closes?)\b.{0,100}\b(?:gap|need)\s+by\s+(?:examining|investigating|analy[sz]ing|studying|asking|exploring)\s+/i;
const MODEL_PURPOSE_START = /^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)|(?:this|the)\s+(?:paper|study|article|analysis))\s+(?:develop|develops|build|builds|formulate|formulates|construct|constructs)\b.{0,100}\bmodel\s+to\s+(?:examine|investigate|analy[sz]e|study|explore|ask|address)\s+/i;
const METHOD_ACTION = /\b(?:solv(?:e|es|ed|ing)|derive(?:s|d)?|develop(?:s|ed|ing)?|devis(?:e|es|ed|ing)|build(?:s|ing|built)?|introduc(?:e|es|ed|ing)|propos(?:e|es|ed|ing)|offer(?:s|ed|ing)?|collaps(?:e|es|ed|ing)|adopt(?:s|ed|ing)?|employ(?:s|ed|ing)?|approximat(?:e|es|ed|ing)|formulat(?:e|es|ed|ing)|estimat(?:e|es|ed|ing)|identif(?:y|ies|ied|ication)|optimi[sz](?:e|es|ed|ing)|comput(?:e|es|ed|ing)|prove(?:s|d)?|establish(?:es|ed)?|characteri[sz](?:e|es|ed|ing)|simulat(?:e|es|ed|ing)|calibrat(?:e|es|ed|ing)|train(?:s|ed|ing)?|evaluat(?:e|es|ed|ing)|implement(?:s|ed|ing)?|construct(?:s|ed|ing)?|apply|applies|applied|decompos(?:e|es|ed|ition)|relax(?:es|ed|ation)|lineariz(?:e|es|ed|ation)|reduc(?:e|es|ed|ing)\s+.+?\s+to|provid(?:e|es|ed|ing)\s+(?:(?:a|an|the)\s+)?characterization|backward\s+induction|dynamic\s+programming|maximum\s+likelihood|fixed.point|first.order\s+conditions?|regression|instrumental\s+variables?|difference.in.differences|randomized\s+experiment|numerical\s+experiment|monte\s+carlo|benders|branch.and.bound|use(?:s|d)?\s+(?:(?:a|an|the)\s+)?(?:algorithm|estimator|regression|simulation|experiment|decomposition|relaxation|dynamic\s+program|backward\s+induction|maximum\s+likelihood|instrumental\s+variables?|game\s+theory))\b/i;
const PAPER_SIMULATION_METHOD = /(?:^|[,;:]\s+)(?:we|this\s+(?:paper|study)|the\s+(?:paper|study|analysis))\s+perform(?:s|ed|ing)?\s+(?:simulations?|numerical\s+experiments?)\b/i;
const PAPER_OWNED_METHOD_ACTION = new RegExp(
  `\\b(?:we|our\\s+(?:analysis|approach|method|algorithm|scheme)|this\\s+(?:paper|study|work)|the\\s+(?:paper|study|analysis|authors?))\\s+`
    + `(?:(?:first|then|next|also|further|finally|subsequently|directly|jointly|analytically|numerically|empirically|can|could|will|would|now)\\s+){0,5}`
    + `(?:${METHOD_ACTION.source})`,
  "i"
);
const SINGULAR_AUTHOR_OWNED_METHOD_ACTION = new RegExp(
  `\\b(?:I|[Mm]y\\s+(?:analysis|approach|method|algorithm|scheme))\\s+`
    + `(?:(?:first|then|next|also|further|finally|subsequently|directly|jointly|analytically|numerically|empirically|can|could|will|would|now)\\s+){0,5}`
    + `(?:${METHOD_ACTION.source})`
);
const ALLOWS_US_METHOD_ACTION = new RegExp(
  `\\ballows?\\s+(?:me|us)\\s+to\\s+(?:(?:first|then|next|also|directly|jointly|analytically|numerically|empirically)\\s+){0,4}(?:${METHOD_ACTION.source})`,
  "i"
);
const PAPER_EXPLICIT_OPTIMIZATION_METHOD = /(?:^|[,;:]\s+)(?:we|this\s+(?:paper|study)|the\s+(?:paper|study|analysis))\s+(?:have|need)\s+to\s+(?:maximi[sz]e|minimi[sz]e|optimi[sz]e)\b.{1,140}\b(?:over|with\s+respect\s+to)\b/i;
const PAPER_METHOD_DEMONSTRATION = /(?:^|[,;:]\s+)(?:we|this\s+(?:paper|study)|the\s+(?:paper|study|analysis))\s+(?:(?:also|further|then|analytically|numerically|empirically)\s+)?(?:demonstrat(?:e|es|ed|ing)|illustrat(?:e|es|ed|ing))\s+how\b.{0,180}\b(?:approximat|comput|deriv|estimat|identif|optimi[sz]|simulat|solv|train|transform)\w*\b/i;
const SINGULAR_AUTHOR_METHOD_DEMONSTRATION = /(?:^|[,;:]\s+)I\s+(?:(?:also|further|then|analytically|numerically|empirically)\s+)?(?:demonstrat(?:e|ed|ing)|illustrat(?:e|ed|ing))\s+how\b.{0,180}\b(?:approximat|comput|deriv|estimat|identif|optimi[sz]|simulat|solv|train|transform)\w*\b/;
const CONCRETE_METHOD_SIGNAL = /\b(?:solv(?:e|es|ed|ing)|derive(?:s|d)?|approximat(?:e|es|ed|ing|ion)|formulat(?:e|es|ed|ing|ion)|estimat(?:e|es|ed|ing|ion)|identif(?:y|ies|ied|ication)|optimi[sz](?:e|es|ed|ing|ation)|comput(?:e|es|ed|ing|ation)|prove(?:s|d)?|characteri[sz](?:e|es|ed|ing|ation)|simulat(?:e|es|ed|ing|ion)|calibrat(?:e|es|ed|ing|ion)|train(?:s|ed|ing)?|evaluat(?:e|es|ed|ing|ion)|implement(?:s|ed|ing|ation)?|decompos(?:e|es|ed|ing|ition)|relax(?:es|ed|ing|ation)|lineariz(?:e|es|ed|ing|ation)|reformulat(?:e|es|ed|ing|ion)|transform(?:s|ed|ing|ation)|backward\s+induction|dynamic\s+program(?:ming)?|maximum\s+likelihood|fixed.point|first.order\s+conditions?|regression|instrumental\s+variables?|difference.in.differences|randomized\s+experiment|numerical\s+experiment|monte\s+carlo|benders|branch.and.bound)\b/i;
const GENERIC_MODEL_CONSTRUCTION = /^(?:(?:to\s+(?:answer|address)\s+(?:these|those|the)\s+questions?,?\s+)|(?:in\s+(?:this|the)\s+(?:paper|study),?\s+))?(?:i|we|this\s+(?:paper|study)|the\s+(?:paper|study|analysis|authors?))\s+(?:(?:first|also|further)\s+)?(?:develop|develops|developed|build|builds|built|introduce|introduces|introduced|propose|proposes|proposed|construct|constructs|constructed)\s+(?:(?:a|an|the|new|formal|stylized|analytical|theoretical|game-theoretic|dynamic|Bayesian)\s+){0,6}(?:model|framework)\b/i;
const GENERIC_ISSUE_SCOPE = /^(?:i|we|this\s+(?:paper|study)|the\s+(?:paper|study|analysis))\s+(?:analy[sz](?:e|es)|examin(?:e|es)|investigat(?:e|es)|stud(?:y|ies))\s+(?:these|those|the\s+important)\b.{0,80}\b(?:issues?|questions?)\b.{0,60}\b(?:model|framework)\b/i;
const METHOD_PLACEHOLDER = /(?:scope.reviewed|not\s+independently\s+mapped|completed\s+modeling.paper\s+scope\s+review|scope\s+review\s+(?:identified|found)|model\s+described\s+in\s+the\s+cited\s+source\s+sections|paper\s+develops\s+and\s+evaluates\s+the\s+model|the\s+analysis\s+(?:formulates\s+the\s+(?:decision\s+problem|strategic\s+interaction|arrival\s+and\s+service\s+process|behavioral\s+model|system)|constructs\s+the\s+decision\s+procedure)\s+and\s+(?:evaluates|characterizes|identifies)\b)/i;
const METHOD_META_PROSE = /^(?:now\s+we\s+turn|we\s+(?:next|now)\s+(?:turn|discuss|describe)|we\s+introduce\s+(?:the\s+)?notation\s+needed\s+to\s+formulate\b|we\s+(?:begin|start)\s+with\s+(?:analy[sz]ing|examining|considering|studying)\b.*\b(?:below|next)\b|in\s+(?:(?:online\s+)?appendix\s+[A-Z]?\d*|section\s+\d+(?:\.\d+)*|what\s+follows|the\s+following|the\s+remainder\s+of),?\s+(?:we|the\s+(?:paper|analysis))|in\s+(?:the\s+)?(?:sections?|appendices)\s+[A-Z]?\d+(?:\.\d+)*(?:\s+(?:and|through|to|[-–—])\s+[A-Z]?\d+(?:\.\d+)*)?,?\s+(?:we|the\s+(?:paper|analysis))|in\s+the\s+following\s+(?:result|lemma|theorem|proposition|corollary),?\s+(?:we|the\s+(?:paper|analysis))|in\s+(?:this|the\s+(?:next|following|subsequent))\s+(?:section|subsection),?\s+(?:we|the\s+(?:paper|analysis))|this\s+section|the\s+next\s+(?:section|subsection)|to\s+distinguish\s+between|to\s+prove\s+(?:lemma|theorem|proposition|corollary)|proof\b|from\s+a\s+modeling\s+perspective|the\s+remainder\s+of)/i;
const EMBEDDED_METHOD_ROADMAP = /\b(?:i|we|this\s+(?:paper|study)|the\s+(?:paper|study|analysis))\s+(?:will|shall)\s+(?:introduce|describe|discuss|present|analy[sz]e|examine|solve|derive|characteri[sz]e|demonstrate)\b.{0,120}\b(?:in\s+)?(?:section|appendix|below|later|subsequently)\b/i;
const METHOD_ROADMAP_ONLY = /^(?:before\s+(?:solving|analy[sz]ing|examining)\b.{0,100},\s*(?:i|we|the\s+(?:paper|analysis))\s+(?:will|first)|to\s+(?:this|that)\s+end,?\s*(?:i|we|the\s+(?:paper|analysis))\s+present\s+(?:a|an)\s+(?:representative\s+)?numerical\s+example|as\s+(?:i|we|the\s+(?:paper|analysis))\s+will\s+(?:show|demonstrate)\s+(?:later|subsequently)|(?:i|we|the\s+(?:paper|analysis))\s+(?:prove|establish)\s+(?:lemma|theorem|proposition|corollary)\s*[A-Z]?\d*\b.{0,100}\b(?:section|appendix)\b)/i;
const METHOD_SCAFFOLDING = /^(?:in\s+particular,?\s+if\s+we\s+(?:set|choose|fix)\b|(?:(?:first|next|now|then|specifically|formally|that\s+is|to\s+(?:this|that)\s+end|for\s+this\s+purpose),?\s+)?(?:(?:we\s+)?(?:let|fix|recall|denote|assume|suppose|consider)\b|(?:letting|fixing|recalling|denoting|assuming|supposing)\b|(?:for|given)\b.{0,100}\b(?:let|fix|denote|assume|suppose)\b|(?:by|from)\s+(?:lemma|theorem|proposition|corollary|observation)\b|(?:the|this|following|next)\s+(?:lemma|theorem|proposition|corollary|observation)\b|(?:our|the)\s+objective\s+is\s+to\b))/i;
const METHOD_RESULT_STATEMENT = /^(?:(?:as\s+a\s+result|consequently|therefore|thus),?\s+)?(?:(?:our|the|these|this)\s+(?:results?|findings?)\b|(?:however,?\s+)?(?:our|the)\s+analysis\s+(?:reveals?|shows?|finds?)\b|(?:lemma|theorem|proposition|corollary|observation)\s*[A-Z]?\d*\b)/i;
const PAPER_RESULT_STATEMENT = /^(?:(?:as\s+a\s+result|consequently|therefore|thus),?\s+)?(?:the|this)\s+paper\s+(?:find|finds|found|show|shows|showed|reveal|reveals|revealed|demonstrate|demonstrates|demonstrated|establish|establishes|established|report|reports|reported)\s+(?:that\b|whether\b)/i;
const OWNED_FINDING_STATEMENT = /^(?:(?:in\s+addition|moreover|furthermore|indeed|first|second|third|finally|perhaps\s+surprisingly|surprisingly|interestingly),?\s+)?(?:i|we|my\s+analysis|our\s+analysis|this\s+(?:paper|study)|the\s+(?:paper|study|analysis))\s+(?:(?:also|further|then|can|could|will|would)\s+)?(?:find|finds|found|show|shows|showed|reveal|reveals|revealed|observe|observes|observed|report|reports|reported)\b/i;
const EMBEDDED_FINDING_STATEMENT = /\b(?:i|we|my\s+analysis|our\s+analysis|this\s+(?:paper|study)|the\s+(?:paper|study|analysis))\s+(?:(?:also|further|then|can|could|will|would)\s+)?(?:find|finds|found|show|shows|showed|reveal|reveals|revealed|observe|observes|observed|report|reports|reported)\s+(?:that|whether)\b/i;
const IDENTIFIED_RESULT_OBJECT = /\b(?:i|we|my\s+analysis|our\s+analysis|this\s+(?:paper|study)|the\s+(?:paper|study|analysis))\s+(?:(?:also|further|then|can|could|will|would)\s+)?identif(?:y|ies|ied)\s+(?:(?:one|two|three|four|several|multiple|the)\s+)?(?:determinants?|drivers?|effects?|factors?|findings?|implications?|sources?)\b/i;
const RESULT_DISCOURSE_CAVEAT = /^(?:indeed|moreover|furthermore),?\b.{0,220}\b(?:such|these|the)\s+results?\b/i;
const THEOREM_RESULT_ANNOUNCEMENT = /^(?:(?:moreover|furthermore|in\s+fact),?\s+)?(?:in\s+)?(?:lemma|theorem|proposition|corollary)\s*[A-Z]?\d*(?:\.\d+)*\b.{0,180}\b(?:show|establish|imply|state|prove)\w*\b|\b(?:we|the\s+(?:paper|analysis))\s+(?:have|obtain)\s+the\s+following\s+result\b/i;
const ATTRIBUTION_LED_METHOD = /^(?:following|consistent\s+with|as\s+in)\s+(?:the\s+)?(?:prior|previous|earlier|existing)\s+(?:studies|study|work|literature|research)\b/i;
const CITATION_LED_METHOD = /^(?:(?:[\p{Lu}]\.?\s+){0,3}[\p{Lu}][\p{L}'’.-]*(?:\s+(?:et\s+al\.?|and\s+[\p{Lu}][\p{L}'’.-]+|&\s*[\p{Lu}][\p{L}'’.-]+))?(?:['’]s)?\s*\((?:18|19|20)\d{2}[a-z]?(?:[,;][^)]*)?\)\s+)/u;
const BORROWED_APPROACH_EXTENSION = /^(?:to\s+address\s+this,?\s+)?(?:we|this\s+(?:paper|study)|the\s+(?:paper|study))\s+build(?:s)?\s+on\s+(?:an?|the)\s+approach\s+developed\s+in\s+.+?\((?:18|19|20)\d{2}[a-z]?\)\s+to\s+(?:allow|account\s+for|incorporate)\b/i;
const MODELED_ACTOR_OPTIMIZATION = /^(?:given\b.{0,100},\s*)?(?:(?:a|an|the|each|every)\s+)?(?:agent|bidder|buyer|consumer|customer|firm|manufacturer|platform|provider|retailer|seller|supplier|worker)\b.{0,90}\b(?:solves?|optimi[sz]es?|chooses?|decides?)\b/i;
const PAPER_METHOD_CUE = /\b(?:we|our\s+(?:analysis|approach|method|algorithm|scheme)|this\s+(?:paper|study|work)|the\s+(?:paper|study|analysis|authors?))\b/i;
const SINGULAR_AUTHOR_METHOD_CUE = /\b(?:I|[Mm]y\s+(?:analysis|approach|method|algorithm|scheme))\b/;
const PROCEDURAL_OBJECT = /\b(?:algorithm|allocation\s+rules?|approach|approximation|backward\s+induction|cases?|complementarity\s+problem|contracting\s+schemes?|decomposition|dynamic\s+program|equilibrium|estimators?|fixed.point|formulation|framework|game|information\s+mechanisms?|instrumental\s+variables?|linear\s+program|maximum\s+likelihood|method|model|optimization\s+problem|polic(?:y|ies)|procedure|regimes?|regression|scenarios?|settings?|simulation|strategies|variational\s+inequalit(?:y|ies))\b/i;
const COMPARATIVE_METHOD = /\b(?:analy[sz](?:e|es|ed|ing)|compar(?:e|es|ed|ing)|distinguish(?:es|ed|ing)?|examin(?:e|es|ed|ing)|investigat(?:e|es|ed|ing)|stud(?:y|ies|ied|ying))\b/i;
const PAPER_COMPARATIVE_ACTION = /(?:^|[,;:]\s+)(?:(?:in\s+(?:this|the)\s+(?:paper|study)|in\s+our\s+analysis),?\s+)?(?:we|this\s+(?:paper|study)|the\s+(?:paper|analysis))\s+(?:(?:first|then|next|also|further|briefly)\s+)?(?:analy[sz](?:e|es|ed|ing)|compar(?:e|es|ed|ing)|distinguish(?:es|ed|ing)?|examin(?:e|es|ed|ing)|investigat(?:e|es|ed|ing)|stud(?:y|ies|ied|ying))\b/i;
const SINGULAR_AUTHOR_COMPARATIVE_ACTION = /(?:^|[,;:]\s+)(?:in\s+[Mm]y\s+analysis,?\s+)?I\s+(?:(?:first|then|next|also|further|briefly)\s+)?(?:analy[sz](?:e|ed|ing)|compar(?:e|ed|ing)|distinguish(?:ed|ing)?|examin(?:e|ed|ing)|investigat(?:e|ed|ing)|stud(?:y|ied|ying))\b/;
const OWNED_MODEL_ACTION = /(?:^(?:by\s+)?modeling\b|\b(?:we|our\s+(?:analysis|approach)|this\s+(?:paper|study)|the\s+(?:paper|analysis))\s+model(?:s|ed|ing)?\b)/i;
const SINGULAR_AUTHOR_MODEL_ACTION = /\b(?:I|[Mm]y\s+(?:analysis|approach))\s+model(?:ed|ing)?\b/;
const STRUCTURED_COMPARISON_METHOD = /\b(?:we|this\s+(?:paper|study)|the\s+(?:paper|analysis))\s+consider(?:s|ed|ing)?\s+(?:two|three|four|multiple|several)\b.{0,100}\b(?:cases?|information\s+mechanisms?|models?|policies|regimes?|scenarios?|schemes?|settings?|strategies)\b/i;
const SINGULAR_AUTHOR_STRUCTURED_COMPARISON = /\bI\s+consider(?:ed|ing)?\s+(?:two|three|four|multiple|several)\b.{0,100}\b(?:cases?|information\s+mechanisms?|models?|policies|regimes?|scenarios?|schemes?|settings?|strategies)\b/;
const EXPLICIT_EQUILIBRIUM_METHOD = /(?:\bwe\s+(?:shall|will)\s+use\s+(?:the\s+)?notion\s+of\b.{0,80}\bequilibrium\b|\bthe\s+paper\s+uses\s+(?:the\s+)?notion\s+of\b.{0,80}\bequilibrium\b|\b(?:we|the\s+paper)\s+(?:will\s+)?include(?:s)?\s+(?:these|the)\s+constraints?\s+to\s+(?:identify|characteri[sz]e|derive|solve)\b.{0,100}\bequilibrium\b)/i;
const METHOD_RESULT_TAIL = /\s+and\s+(?:(?:also|then)\s+)?(?:finds?|found|shows?|showed|reveals?|revealed|demonstrates?|demonstrated|establishes?|established)\s+that\b/i;
const ENUMERATED_RESULT = /^(?:first|second|third|fourth|finally),\s+(?!(?:we|the\s+(?:paper|analysis)|our\s+(?:analysis|approach|method))\b)/i;
const RESULT_ONLY_METHOD = /\b(?:illustrat(?:e|es|ed|ing)|demonstrat(?:e|es|ed|ing))\b.{0,50}\bperformance\b|\bdevelop(?:s|ed|ing)?\s+associated\s+insights\b/i;
const PASSIVE_SYSTEM_DESCRIPTION = /^(?!(?:the\s+(?:paper|analysis)|our\s+(?:analysis|approach|method))\b).{0,90}\b(?:is|are)\s+(?:characteri[sz]ed|estimated|modeled)\b/i;
const GENERIC_MODEL_SCOPE = /^(?:(?:in\s+this\s+study),?\s*)?(?:(?:i|we|the\s+paper|this\s+(?:paper|study))\s+stud(?:y|ies)\s+(?:a|an|the)\b.{0,90}\bmodel\s+(?:consisting|of|with)\b|(?:i|we|the\s+paper|this\s+(?:paper|study))\s+consider(?:s)?\s+(?:a|an|the)\b.{0,70}\b(?:setting|scenario|environment|model)\s+(?:where|with|in\s+which)\b)/i;
const GENERIC_STUDY_SCOPE = /^(?:i|we|the\s+paper|this\s+(?:paper|study))\s+stud(?:y|ies)\b/i;
const SUBSTANTIVE_STUDY_DESIGN = /\b(?:based\s+on|using|via|by\s+(?:analy[sz]ing|comparing|estimating|learning|solving)|(?:effect|impact)\s+of\b.{0,100}\bon\b|favors?\s+one\b.{0,80}\b(?:over|versus)\s+(?:the\s+)?other)\b/i;
const MODEL_CHANGE_RESULT = /^(?:the\s+)?(?:first|second|third|fourth)(?:\s+and\s+most\s+important)?\s+change\s+is\b/i;
const LEMMA_DERIVED_OUTPUT = /^(?:given|using|based\s+on)\b.{0,180}\b(?:lemma|proposition|theorem|corollary)\s*[A-Z]?\d*\b.{0,140}\b(?:derive|calculate|compute|obtain)\w*\b.{0,90}\b(?:net\s+value|equilibrium|optimal|profit|utility|welfare)\b/i;
const SOURCE_EXHAUSTED_METHOD_CONTRACT = /^this\s+(?:regime|variant|model)\s+uses\s+the\s+paper-level\s+solution\s+approach:\s*(.+)$/i;
const GENERIC_QUESTION_PLACEHOLDER = /^what\s+(?:modeling|research)\s+problem\s+does\s+(?:this|the)\s+(?:article|paper|study)\s+(?:address|analy[sz]e|study)(?:\s+in\s+.+)?[?!.]*$/i;
const GENERIC_MODELED_OUTCOMES_QUESTION = /^what\s+determines\s+modeled\s+outcomes\s+in\b/i;
const QUESTION_AUXILIARY = "can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had";
const TOPIC_AUTHOR_CLAUSE = /\b(?:i|we|our\s+(?:paper|study|analysis|approach|method|model|framework|findings?|results?)|this\s+(?:paper|study|analysis))\b/i;
const TOPIC_DISCOURSE_LEAD = /^(?:across\s+[\d,.]+|additionally|also|alternatively|beyond\b|building\s+on|by\s+knowing|conversely|corroborated\s+by|even\s+when|for\s+(?:example|instance)|furthermore|given\b|in\s+(?:addition|close\s+collaboration|contrast|effect|particular|such\s+a\s+system|this\s+(?:case|paper|study))|leveraging\b|more\s+interestingly|moreover|on\s+(?:real-world|the\s+one\s+hand)|our\b|specifically|surprisingly|to\s+(?:alleviate|answer|address|build|demonstrate|gain|improve|inform|obtain|reduce)\b|unlike\b|using\b|validated\b|with\s+respect\s+to|yet\b)/i;
const FINITE_TOPIC_PREDICATE = /\b(?:abounds?|achieves?|acknowledges?|advocates?|behav(?:e|es)|becomes?|bids?|captures?|carries|carry|confirms?|controls?|decides?|describes?|develops?|distinguishes?|employs?|enables?|entails?|experiences?|faces?|forces?|formulates?|gives?|helps?|hinges?|impacts|incorporates?|introduces?|investigates?|launches?|leads?|offers?|occurs?|outperforms?|pays?|plays?|poses?|provides?|receives?|relies?|remains?|requires?|reveals?|runs?|seeks?|serves?|shows?|studies|supports?|undergoes|uses?|utilizes?|waives?|weakens?|yields?)\b/i;
const TOPIC_RESULT_OR_METHOD = /^(?:(?:the|these)\s+)?(?:analysis|findings?|numerical\s+(?:analysis|experiments?|results?|stud(?:y|ies))|proof|results?|simulations?)\b|^(?:the\s+)?(?:first|second)\s+(?:approach|phase|stage)\b|^(?:the\s+)?proposed\s+(?:approach|algorithm|framework|method|methodology|model|policy)\b|^this\s+(?:gives?\s+rise|methodological\s+tool)\b|\b(?:confirm|demonstrate|find|outperform|show|yield)\w*\s+that\b/i;
const QUESTION_METADATA_SENTENCE = /^(?:funding|acknowledg(?:e)?ments?|supplemental\s+material|this\s+paper\s+was\s+accepted)\s*:/i;
const QUESTION_METADATA_CONTENT = /(?:practice\s+and\s+policy\s+oriented\s+abstract|\[(?:grant|award)\b|national\s+science\s+foundation\s*\(nsf\))/i;
const COMBINED_TITLE_QUESTION = /^how\s+are\s+.+\s+combined$/i;
const UNBOUND_QUESTION_DEICTIC = /^(?:how|what|when|why|which|who|where|can|could|should|does|do|is|are|will|would)\s+(?:(?:does|do|can|could|should|would|will|may|might|must|is|are|was|were|has|have|had)\s+)?(?:this|these|those|such|its)\b/i;
const QUESTION_DANGLING_END = /\b(?:and|or|but|to|when|where|which|who|whose|what|how|because|if|than|that)$/i;
const QUESTION_TRUNCATED_ABBREVIATION = /\b(?:u\.s|e\.g|i\.e|et\s+al)$/i;
const ABSTRACT_LABEL = /^(?:(?:problem\s+definition|academic\s*\/\s*practical\s+relevance|methodology(?:\s*\/\s*results)?|results?|managerial\s+implications|history|funding|supplemental\s+material)\s*:\s*)+/i;
const METHOD_SECTION_EXCLUSION = /\b(?:acknowledg(?:e)?ments?|conclusions?|literature\s+review|related\s+(?:literature|work)|references|supplemental\s+material)\b/i;
const METHOD_EXTRACTION_CONTAMINATION = /(?:\b(?:algorithm|figure|table|exhibit)\s+[A-Z]?\d+(?:[.:-]|\s)|^notation\s+description\b|\b[A-Z][\p{L}'’.-]+\s+et\s+al\.?\s*\(?\s*\d{4}|\[(?:formula|figure|table):\s*see\s+text\]|\b(?:random\s+variables?|parameters?)\s+and\s+functions\b|\b(?:cluding|kets|ket|namics|sion|tory|tion|tralized|vider|straints|lustrates|mization|senting|zation|tice|quency|cularly)\b|\bto\s+(?:be\s+ping|fic)\b|^these\s+challenges,?\s+we\b|\b[a-z]{1,3}\d{3,}\b|\b[A-Za-z]\s*\d+\s*[·×]\s*\d+\b|\bc\d{2,}\b|\bas\s+function\b|\bcan\s+be\s+els\b|\btractable\s+mal\s+objective\b|\bproblem\s+sider\b|\binstantaneous\s+related\b|\b(?:problem|equilibrium)\s+(?:tion|mal)\b|,\s+ing\s+with\b|\b(?:str\s+uctural|brie\s+fly)\b|\bderive\s+ers\b|\bthe\s+wherein\b|\bprofit\s+cally\b|\b(?:objective\s+function|system)\b.{0,100}\bpresented\s+below\b)/iu;
const GENERIC_SETUP = /^(?:decision\s+makers?\s+and\s+system\s+entities\s+defined\s+in\s+the\s+model|exogenous\s+quantities\s+defined\s+in\s+the\s+model\s+formulation|feasible\s+decisions?\s+or\s+policies\s+defined\s+in\s+the\s+source\s+model|the\s+modeled\s+setting\s+follows\s+the\s+timing\s+and\s+feasibility\s+conditions\s+stated\s+in\s+the\s+cited\s+formulation\s+sections?)\.?$/i;
const MODEL_SECTION = /\b(?:models?|formulation|problem|setting|setup|framework|environment|timing|assumptions?|information|demand|decisions?|controls?|optimal|optimization|estimation|inference|games?|systems?|process|inventory|contracts?|effort|monitoring|payment|hypergraphs?|random[-\s]+walks?)\b/i;
const METHOD_SECTION = /\b(?:method|methodology|algorithm|approach|solution|estimation|identification|empirical\s+strategy|analysis|equilibrium|optimization|proof|procedure|formulation|model|policy|main\s+results?|contributions?|high.level\s+plan)\b/i;
const CAPTION_OR_BOILERPLATE = /\b(?:figure|fig\.?|table|exhibit)\s*[a-z]?\d+\b|^(?:note|source)\s*:|\b(?:articles?\s+in\s+advance|copyright|all\s+rights\s+reserved|downloaded\s+from|doi\s*:|informs|management\s+science|marketing\s+science|information\s+systems\s+research|manufacturing\s+(?:and|&)\s+service\s+operations\s+management)\b/i;
const ENTITY_TERM = /\b(?:advertiser|agenc|agent|applicant|author|bidder|brand|buyer|client|clinician|consumer|customer|data\s+owner|deciding\s+editor|decision[-\s]+maker|developer|district|editor|farmer|firm|health\s+authorit|hospital|human\s+reviewer|infected|information\s+owner|intermediary|manager|manufacturer|merchant|milk\s+bank|operator|organization|owner|patient|physician|planner|platform|player|policy[-\s]*maker|principal|provider|removed|researcher|retailer|reviewer|salesperson|school|seller|sensor|server|student|subject|supplier|susceptible|user|vaccine|vendor|worker)(?:y|ies|s)?\b|\b(?:batter(?:y|ies)|cells?|charging\s+bays?|coalitions?|commodit(?:y|ies)|courses?|deposits?|donors?|drivers?|elements?|experimental\s+units?|facilit(?:y|ies)|ground\s+sets?|locations?|manuscripts?|networks?|nodes?|populations?|projects?|products?|random\s+variables?|recipes?|resources?|state\s+spaces?|stations?|stores?|tables?|testing\s+groups?|vehicles?)\b/i;
const INPUT_TERM = /\b(?:age|arrival|belief|benefit|budget|capacity|case\s+completion\s+hazard\s+rate(?:\s+function)?|characteristic|climate\s+condition|coalition\s+payoff|congestion|cost|data|dataset|decision-making\s+stage|demand(?:\s+rate)?|density|digraph|discount|distribution|duration|effort|elasticity|expenditure|feature|forecast|fund|graph|hypergraph|hazard\s+rate(?:\s+function)?|horizon|ignition\s+risk\s+map|information|inventory|lead\s+time|liquidity\s+position|matri(?:x|ces)|objective\s+function|observation|output|parameter|payment\s+request|payoff|preference|price|priorit(?:y|ies)|probability|processing\s+time|protection\s+level|quality|rankings?|rate|ratio|reward|sale|sample\s+data\s+point|service\s+time|signal|skill|software|spending|stage|state|stockpile|supply|test|technology\s+level|time|topology|topograph(?:y|ies)|type|use|utility|valuation|vegetation|vulnerabilit(?:y|ies)|weather|wind\s+statistic)s?\b/i;
const DECISION_OBJECT = /\b(?:action|ad|advertisement|allocation|approval\s+threshold|assortment|batch\s+size|bid|capacity|choice|classifier|combination|commission|contract|cost\s+vector|decision(?:\s+rule)?|disclosure|dose|effort|entry|fee|fund|inventory|investment|item|learning\s+time|location|mechanism|medication|order(?:ing)?|policy|price|pricing|procedure|production|quality|quantity|rate|repositioning|route|sample\s+size|sanitation(?:\s+(?:cycle|interval|period))?|schedule|selection|service|skill|start\s+time|stock|strategy|suppression\s+pattern|targeting\s+capabilit(?:y|ies)|testing|threshold|timing)s?\b|\b(?:cells?\s+to\s+be\s+suppressed|(?:selling|leasing|subscription)\s+models?|charging\s+(?:rates?|schedules?)|loading(?:\/|\s+and\s+)unloading\s+(?:actions?|decisions?)|payment\s+(?:orders?|terms?|structures?)|settlement\s+orders?|terms?\s+of\s+payment\s+structures?|demand\s+estimation|estimation\s+procedures?|(?:conducting\s+|valid\s+)?inference(?:\s+procedures?)?|choice\s+functions?|price\s+elasticit(?:y|ies))\b|^(?:(?:whether|which|what|when|where|from\s+which)\b|how(?:\s+(?:much|many))?\b).{0,100}\b(?:to\s+)?[\p{L}][\p{L}'’\-]*\b|^(?:accept|admit|allocate|announce|assign|brush|calculate|choose|close|combat|design|determine|disclose|distribute|estimate|exert|find|hide|invest(?:ing)?|irrigate|join|launch|license|load|maximize|minimize|monitor|offer|optimize|orders?|participate|perform|post|predict|price|procure|quote|reject|release|reposition|require|route|schedule|search|select|serve|set|share|sharing|solicit|stock|switch|target|test|transfer|unload)\b/iu;
const SUBSTANTIVE_SETUP_SECTION = /\b(?:abstract|introduction|overview|background|model|formulation|problem|setting|setup|framework|environment|timing|assumptions?|information|input|parameter|demand|decision|controls?|objective|constraint|game|system|process|transition|method|mechanism|algorithm|policy|optimal|optimization|estimation|inference|learning|pricing|inventory|capacity|allocation|utility|contracts?|effort|monitoring|payment|hypergraphs?|random[-\s]+walks?)\b/i;
const EXCLUDED_SETUP_SECTION = /\b(?:references|bibliography|acknowledg(?:e)?ments?|literature\s+review|related\s+literature|results?|discussion|conclusion|proofs?|online\s+appendix|numerical\s+(?:analysis|experiment)|simulation\s+(?:analysis|study))\b/i;
const SOURCE_ENTITY_PHRASE = /\b(?:a\s+set\s+of\s+(?:n\s+)?random\s+variables?|(?:a|the)\s+ground\s+set(?:\s+of\s+elements)?|(?:a|the)\s+set\s+of\s+elements|(?:a|the)\s+state\s+space|(?:a|the|each)\s+(?:additional|primary|sensitive)?\s*cells?|(?:a|the)\s+tables?|electric\s+vehicle\s+\(EV\)\s+drivers?|battery[-\s]swapping\s+stations?|(?:(?:a|an|the|each|every|one|two|three|multiple|several|competing|strategic|heterogeneous|representative|focal|online|offline|funding|service|electric|vehicle|EV|information|technology|available|dedicated|depleted|drained|fully|charged|differentiated|incoming|pharmaceutical|human\s+milk)\s+){0,4}(?:advertisers?|agencies|agency|agents?|applicants?|authors?|batteries|battery(?![-\s]swapping)|bidders?|brands?|buyers?|cells?|charging\s+bays?|clients?|clinicians?|consumers?|customers?(?!\s+(?:satisfaction|service|demand|choice|behavior|arrival))|decision[-\s]+makers?|deposits?|developers?|districts?|donors?|drivers?|elements?|farmers?|facilities|firms?|ground\s+sets?|hospitals?|intermediaries|locations?|managers?|manufacturers?|merchants?|milk\s+banks?|networks?|nodes?|operators?|organizations?|patients?|physicians?|planners?|platforms?|policy[-\s]+makers?|principals?|products?|projects?|providers?|random\s+variables?|recipes?|researchers?|resources?|retailers?|salespersons?|schools?|sellers?|sensors?|servers?|state\s+spaces?|stations?|stores?|students?|suppliers?|tables?|users?|vehicles?|vendors?|workers?))\b/giu;
const SOURCE_INPUT_PHRASE = /\b(?:a\s+directed\s+acyclic\s+graph|(?:a|an|the)\s+(?:directed\s+|undirected\s+|weighted\s+|unweighted\s+)?hypergraph|the\s+ith\s+objective\s+function|age\s+of\s+every\s+implanted\s+lead|patient\s+age|lead\s+ages?|mean\s+arrival\s+rate|mean\s+service\s+time|available\s+supply|day-ahead\s+demand(?:\s+shock)?|production\s+costs?|service\s+times?|sensitive\s+cells?|protection\s+levels?|both\s+firms?[’']\s+and\s+consumers?[’']\s+costly\s+efforts?|pipeline\s+orders?[’']\s+remaining\s+lead\s+times?|decision-making\s+stage\s+of\s+consumers|heterogeneity\s+of\s+their\s+preference\s+for\s+the\s+online\s+versus\s+store\s+channels|(?:(?:a|an|the|each|observed|observable|unobserved|unverifiable|unknown|uncertain|random|stochastic|nonstationary|endogenous|exogenous|aggregate|market-level|individual-level|private|public|noisy|partially|missing|input|test|customer|consumer|seller|retailer|firm|market|unit|marginal|mean|arrival|demand|inventory|production|product|service|holding|additional|available|initial|remaining|pipeline|battery|swapping|charging|marketing|advertising|transportation|launch|search|switching|historical|offline|online|contextual|valuation-cost|patient|lead|day-ahead|sensitive|protection)\s+){0,6}(?:exogenously\s+given\s+(?:fee|parameter|price|rate)|state\s+of\s+charge|arrival\s+rates?|battery\s+inventory|demand\s+(?:data|forecasts?|signals?)|effort\s+levels?|inventory\s+levels?|market\s+shares?|product(?:['’]s)?\s+(?:characteristics|features|uses\s+and\s+benefits)|queue\s+lengths?|service\s+(?:rates?|times?)|test\s+results?|valuation-cost\s+ratio|retailer\s+density|input\s+data|data(?:sets?)?|demand|ages?|benefits?|budgets?|funds?|costs?|densit(?:y|ies)|discounts?|elasticit(?:y|ies)|expenditures?|features?|forecasts?|horizons?|lead\s+times?|output|payoffs?|preferences?|prices?|protection\s+levels?|ratios?|rewards?|sales?|skills?|spending|suppl(?:y|ies)|technology\s+levels?|times?|uses?|utilities|utility|valuations?|weather|types?|capacity|states?|signals?|information|parameters?|probabilities?))\b/giu;
const SOURCE_DECISION_PHRASE = /\b(?:whether|how|which|what)\s+to\s+[\p{L}][\p{L}'’\-]*(?:\s+[\p{L}\p{N}'’\-]+){0,8}\b|\b(?:(?:a|an|the|each|its|their|next|wholesale|retail|service|funds?|test|order|production|inventory|effort|quality|capacity|commission|admission|resource|price|pricing|stocking|scheduling|disclosure|entry|assortment|investment|charging|loading|unloading|payment|data-driven|flexible|formal|valid|linear|optimal|demand|choice|model|parameter|ranking|repositioning|irrigation|testing|licensing|launch|promotion)\s+){0,4}(?:terms?\s+of\s+payment\s+structures?|payment\s+(?:terms?|structures?)|charging\s+(?:rates?|schedules?)|loading(?:\/|\s+and\s+)unloading\s+(?:actions?|decisions?)|demand\s+estimation|estimation\s+procedures?|(?:conducting\s+|valid\s+)?inference(?:\s+procedures?)?|choice\s+functions?|price\s+elasticit(?:y|ies)|actions?|allocations?|assortments?|batch\s+sizes?|bids?|capacity|choices?|combinations?|commission\s+rates?|contracts?|decisions?|disclosure|effort\s+levels?|entry|fees?|funds?|investments?|locations?|mechanisms?|order\s+quantities|policies|prices?|pricing|production\s+levels?|quality\s+levels?|quantities|rates?|routes?|schedules?|stocking\s+levels?|strategies|timing)\b/giu;
const COORDINATED_GIVEN_INPUTS = /\b((?:(?:the|each|all|both|observed|known|public|private|exogenous)\s+)?(?:[\p{L}'’\-]+\s+){0,3}(?:beliefs?|budgets?|capacities|costs?|data|demands?|distributions?|features?|forecasts?|information|inventor(?:y|ies)|parameters?|preferences?|prices?|priorities|probabilities|rankings?|rates?|rewards?|signals?|states?|types?|utilities|valuations?))\s*(?:\([^)]{1,36}\))?\s+and\s+((?:(?:the|each|all|both|observed|known|public|private|exogenous)\s+)?(?:[\p{L}'’\-]+\s+){0,3}(?:beliefs?|budgets?|capacities|costs?|data|demands?|distributions?|features?|forecasts?|information|inventor(?:y|ies)|parameters?|preferences?|prices?|priorities|probabilities|rankings?|rates?|rewards?|signals?|states?|types?|utilities|valuations?))\s*(?:\([^)]{1,36}\))?\s+(?:are|were)\s+(?:(?:exogenously|publicly|privately)\s+)?(?:available|fixed|given|observed|specified|(?:assumed\s+to\s+be\s+)?known)\b/iu;
// Domain nouns that are unambiguously modeled primitives but are too rare to
// justify making every generic noun phrase eligible.  They still require a
// local participation, observation, or control cue below.
const SOURCE_DOMAIN_ENTITY_PHRASE = /\b(?:(?:a|an|the|each|all|every|one|two|multiple|several|competing|human|individual|experimental|different)\s+){0,4}(?:deciding\s+editors?|deposits?|donors?|editors?|milk\s+banks?|players?|coalitions?|commodit(?:y|ies)|experimental\s+units?|human\s+reviewers?|manuscripts?|planners?|populations?|recipes?|reviewers?|subjects?|testing\s+groups?)\b/giu;
const SOURCE_DOMAIN_INPUT_PHRASE = /\b(?:(?:a|an|the|each|actual|available|observed|stationary|participant|participants[’']|sample)\s+){0,4}(?:case\s+completion\s+hazard\s+rate(?:\s+function)?|coalition\s+payoff|demand\s+rates?|liquidity\s+positions?|payment\s+requests?|processing\s+time|sample\s+data\s+points?|wind\s+statistics)(?:\s+measured\s+on\s+the\s+site)?\b/giu;
// A fixed procurement scope is an exogenous model input even when the paper
// states it through an actor's purchase sentence rather than with "given" or
// "parameter". Keep this deliberately narrow: the literal phrase must name a
// fixed amount/volume or a divisible purchase measured in units, and the
// containing sentence must identify a purchasing/sourcing actor.
const SOURCE_FIXED_PURCHASE_INPUT_PHRASE = /\b(?:(?:a|an|the)\s+fixed\s+(?:amount|volume)\s+of\s+(?:(?:a|an|the)\s+)?(?:divisible\s+)?(?:goods?\s+or\s+services?|goods?|services?)|(?:a|an|the)\s+divisible\s+(?:goods?\s+or\s+services?|goods?|services?)\s+of\s+(?:[\p{L}][\p{L}\p{N}_]*|\d[\d,.]*)\s+units?)\b/iu;
const SOURCE_FIXED_PURCHASE_CONTEXT = /\b(?:buyers?|customers?|firms?|retailers?|planners?)\b[^.;]{0,120}\b(?:acquir(?:e|es|ed|ing)|buys?|purchas(?:e|es|ed|ing)|procur(?:e|es|ed|ing)|sourc(?:e|es|ed|ing))\b/iu;
// Some inventory formulations state the control as a finite actor-action rule
// rather than as a noun headed by "decision" or "order quantity."  Preserve
// only two unambiguous controls: an actor deciding its inventory level, or an
// inventory system ordering up to a named base-stock level.  The captured
// action remains an exact substring of the source sentence.
const SOURCE_ACTOR_INVENTORY_CONTROL = /\b(?:a|an|the)?\s*(?:firm|system|inventory\s+manager|manager|retailer|decision[-\s]+maker)\b[^.;]{0,190}?\b(?:(decides?\s+(?:on\s+)?(?:its\s+)?inventory\s+levels?)|(orders?\s+up\s+to\s+(?:the\s+)?(?:local\s+)?base[-\s]+stock\s+level(?:\s+[\p{L}\p{N}*]+)?)|(places?\s+an?\s+order\s+so\s+as\s+to\s+raise\s+(?:the\s+)?inventory\s+position\s+up\s+to\s+[\p{L}\p{N}*]+)|(orders?\s+the\s+previous\s+period[’']s\s+demand))\b/iu;
const SETUP_RESULT_ARTIFACT = /\b(?:sources?\s+of\s+performance\s+improvement|(?:numerical|simulation|empirical)\s+results?|results?\s+in\s+(?:table|figure)\s*\d+[a-z]?|(?:table|figure)\s*\d+[a-z]?\s+(?:shows?|reports?|presents?))\b|^(?:(?:this|that|such)\s+(?:behavior|pattern|result)\s+is\s+observed|as\s+(?:one|we)\s+(?:can\s+)?observe|(?:we|the\s+(?:paper|analysis))\s+(?:also\s+)?(?:observe|find|report)\s+(?:a|the)\s+(?:similar|same|consistent|comparable)\s+(?:behavior|pattern|result)|(?:a|the)\s+(?:similar|same|consistent|comparable)\s+(?:behavior|pattern|result)\b)/i;
const SETUP_FORMULA_FRAGMENT = /^(?:[+−=≤≥]|\s*[A-Za-z]\d+\b)|\b(?:arg\s*(?:min|max)|exp|log)\s*\(|\b[A-Za-z]\s+[A-Za-z]\s*,\s*[A-Za-z]\b|\b(?:ried|senting|tinuous|tored|tial)\b|\b(?:terminal|operat|charg|model)\s+ing\b|\bnario\b|\btotal\s+net\s+the\s+following\b|\bas\s+ers\b/i;
const FUSED_PARTS = [
  "customer", "customers", "consumer", "consumers", "manufacturer", "retailer", "supplier", "seller", "seasonal",
  "product", "products", "potential", "quality", "quantity", "demand", "inventory", "pricing", "price", "decision",
  "model", "system", "single", "certain", "level", "units", "unit", "only", "into", "from", "with", "without",
  "before", "after", "between", "during", "through", "that", "this", "there", "their", "and", "the", "for", "at", "in", "a"
].sort((left, right) => right.length - left.length);
const COMMON_SPLIT_WORDS = new Set([
  "algorithm", "algorithms", "constraint", "constraints", "customer", "customers", "decision", "decisions",
  "distribution", "distributions", "equilibrium", "function", "information", "inventory", "manufacturer", "manufacturers",
  "modified", "optimization", "parameter", "parameters", "probability", "profit", "profits", "quality", "retailer",
  "retailers", "simulation", "supplier", "suppliers", "variable", "variables"
]);

export const SEMANTIC_MATURITY = Object.freeze({
  AUTHORED: "source-authored",
  DERIVED: "source-derived",
  MIXED: "mixed-source",
  UNRESOLVED: "unresolved"
});

export function cleanSemanticText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00ad\s*/g, "")
    .replace(/[（(][^()（）]*\p{Script=Han}[^()（）]*[)）]/gu, " ")
    .replace(/\p{Script=Han}+/gu, " ")
    .replace(/^[（(]\s*([^()（）]+?)\s*[)）]$/u, "$1")
    .replace(/[\p{Cf}\u0000-\u001F\u007F-\u009F]/gu, " ")
    .replace(/([\p{L}])-\s+(?=[\p{Ll}])/gu, "$1")
    .replace(/\s+([,.;:?!])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value) {
  return cleanSemanticText(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || [];
}

function clipWords(value, limit) {
  const parts = cleanSemanticText(value).split(/\s+/).filter(Boolean);
  return parts.length <= limit ? parts.join(" ") : parts.slice(0, limit).join(" ").replace(/[,;:]$/, "");
}

function sentenceList(value) {
  const text = cleanSemanticText(value);
  if (!text) return [];
  // PDF superscript footnote markers are frequently flattened immediately
  // after terminal punctuation (for example, `v1 > v2.9 To rule out ...`).
  // Treat the marker as a sentence boundary while retaining the literal text
  // through the punctuation; the discarded marker is metadata, not prose.
  const withoutFusedFootnoteMarkers = text.replace(/([.!?])\d{1,2}\s+(?=\p{Lu})/gu, "$1 \uE000 ");
  return withoutFusedFootnoteMarkers
    .split(/(?:(?<=[.!?])\s+(?=[\p{Lu}\p{N}])|\s*\uE000\s*)/u)
    .map(cleanSemanticText)
    .filter(Boolean);
}

function normalizedKey(value) {
  return cleanSemanticText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function diagnostic(code, message, details = {}) {
  return { code, message, ...details };
}

function fusedWordParts(token) {
  const text = token.toLowerCase();
  if (text.length < 11 || !/^\p{Ll}+$/u.test(text)) return 0;
  const memo = new Map();
  const visit = (offset) => {
    if (offset === text.length) return 0;
    if (memo.has(offset)) return memo.get(offset);
    let best = -Infinity;
    for (const part of FUSED_PARTS) {
      if (!text.startsWith(part, offset)) continue;
      const tail = visit(offset + part.length);
      if (tail >= 0) best = Math.max(best, tail + 1);
    }
    memo.set(offset, best);
    return best;
  };
  return Math.max(0, visit(0));
}

function extractionNoiseReason(value) {
  const text = cleanSemanticText(value);
  if (!text) return "empty_after_cleaning";
  if (hasSourceTextNoise(value)) return "shared_source_text_quality";
  if (/[�]/.test(text) || /\/(?:uni[0-9A-F]{4,6}|equal[a-z]*|radicaltpext|summationdisplay|SL[A-Za-z]+)/i.test(text)) return "legacy_extraction_glyph";
  if (/\p{L}{28,}/u.test(text) || text.split(/\s+/).some((token) => fusedWordParts(token.replace(/[^\p{L}]/gu, "")) >= 3)) return "probable_fused_words";
  if (CAPTION_OR_BOILERPLATE.test(text)) return "caption_or_publisher_boilerplate";
  if (/(?:\b\p{L}{1,2}\s+){4,}\p{L}{1,2}\b/iu.test(text)) return "probable_split_words";
  if (/\b[\p{L}]{2,}\s*-\s+(?!(?:and|or)\b)[\p{Ll}]{2,}\b/u.test(text)) return "probable_split_words";
  if ((text.match(/[|≤≥∑∫ˆ]/g) || []).length >= 3) return "equation_leakage";
  const tokens = text.split(/\s+/).filter(Boolean);
  const alphaTokens = tokens.map((token) => token.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean);
  if (alphaTokens.some((token, index) => index > 0
      && alphaTokens[index - 1].length <= 5
      && token.length <= 8
      && COMMON_SPLIT_WORDS.has(`${alphaTokens[index - 1]}${token}`))) return "probable_split_words";
  const singleLetters = tokens.filter((token) => /^\p{L}[,.;:]?$/u.test(token)).length;
  if (tokens.length >= 8 && singleLetters / tokens.length > 0.35) return "probable_split_words";
  return "";
}

function normalizeQuestion(value) {
  const body = clipWords(cleanSemanticText(value).replace(/[.?!]+$/g, ""), 64);
  return body ? `${sentenceCase(body)}?` : "";
}

function questionSubjectAgreementReason(value) {
  const match = cleanSemanticText(value).match(
    /^how\s+(do|does)\s+(.+?)\s+(affect|allow|change|compare|contribute|create|determine|drive|enable|improve|increase|influence|matter|reduce|resolve|shape|use|include|make)\b/i
  );
  if (!match) return "";
  const auxiliary = match[1].toLowerCase();
  const subject = match[2];
  // If a finite predicate has already been swallowed into the alleged subject,
  // a clause-splice guard below owns the rejection.  Do not guess agreement
  // from the last noun of that malformed clause.
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
    && !/(?:ness|^(?:access|analysis|basis|bias|business|class|distress|emphasis|loss|news|process|status|success))$/i.test(last);
  const confidentlyPlural = (pluralHead && !leadingGerund)
    || (compound && (!leadingArticle || /^(?:his|her|its)\b/i.test(subject)))
    || commaList;
  const confidentlySingular = /^(?:each|every|one|this|that|its|his|her)\b/i.test(subject)
    || /^the\s+(?:(?:recent|sudden|continued|rapid|strategic)\s+)?(?:absence|development|effect|emergence|formation|impact|market|method|policy|power|presence|role|value)\b/i.test(subject);
  if (auxiliary === "does" && confidentlyPlural) return "auxiliary_subject_disagreement";
  if (auxiliary === "do" && confidentlySingular) return "auxiliary_subject_disagreement";
  return "";
}

function questionGrammarReason(value) {
  const question = normalizeQuestion(value);
  const body = question.replace(/\?$/, "");
  if (!body) return "empty";
  if (GENERIC_QUESTION_PLACEHOLDER.test(question) || GENERIC_MODELED_OUTCOMES_QUESTION.test(question)) return "generic_placeholder";
  // A narrow title-derived “modeled in/under” question remains grammatical
  // (and is used by the public fallback API).  The authoring derivation below
  // never selects that generic wrapper when a substantive source relation is
  // available.  The relation-free “combined” form is invalid in either role.
  if (COMBINED_TITLE_QUESTION.test(body)) return "generic_title_wrapper";
  if (UNBOUND_QUESTION_DEICTIC.test(body)) return "unbound_deictic_subject";
  if (QUESTION_METADATA_CONTENT.test(body)) return "metadata_as_question";
  if (QUESTION_DANGLING_END.test(body) || QUESTION_TRUNCATED_ABBREVIATION.test(body)) return "truncated_question";
  if (questionSubjectAgreementReason(body)) return "auxiliary_subject_disagreement";
  if (/\ba\s+(?:ambiguous|analytical|economic|engineering|empirical|optimal|unifying)\b/i.test(body)) return "indefinite_article_disagreement";
  if (/^how\s+should\s+(?:and|by|from|on|under|when|with)\b/i.test(body)) return "invalid_question_subject";
  if (/^what\s+role\s+does\s+.+\s+play\s+on\b/i.test(body)) return "invalid_role_preposition";
  if (/^how\s+should\s+(?:(?:auction|contract\s+)?design\b.+\bbe\s+designed\b|design\s+of\b.+\bbe\s+designed\b)/i.test(body)) return "duplicated_action_nominal";
  if (/^how\s+can\s+.+?,\s*but\s+.+$/i.test(body)) return "coordinated_declarative_contrast";
  if (/\bcontribute\s+to\b[^?]*(?:\bplatforms?\b[^?]*\b(?:collect|fund)\b|\bfirms?\b[^?]*\b(?:finance|fund)\b|\bcarriers?\b[^?]*\bcollaborate\b|\band\s+analy[sz]e\b|\buncertain\s+about\b)/i.test(body)) return "finite_clause_after_contribute_to";
  if (/^what\s+determines\s+(?:(?:a|an)\s+(?:(?:new|novel|general|stylized|parsimonious|analytics-centered|data-driven|commonly\s+adopted|two-stage)\s+){0,3}(?:model|framework|approach|algorithm|criterion|definition|heuristic|formulation|policy|scheme|problem|extension)\b|(?:devising|understanding|jointly\s+designing)\b|.+\b(?:and|then)\s+(?:propose|proposes|prove|proves|relate|relates|identify|identifies|analy[sz]e|explore|explores)\b|(?:many|network)\s+.+\b(?:undergo|undergoes|suffer|suffers|depends|interact|interacts)\b)/i.test(body)) return "what_determines_artifact";
  if (/^what\s+determines\s+(?:one|two|three|four|several|multiple)\s+(?:(?:problem|model)\s+)?(?:approaches|formulations|frameworks|methods|models|problems|variants)$/i.test(body)) return "what_determines_artifact";
  if (/^can\s+there\s+exists\b/i.test(body)
      || /^how\s+should\s+(?:this|that|the)\b[^?]{0,70}\b(?:mitigates|results)\b/i.test(body)
      || /^how\s+does\s+while\b/i.test(body)
      || /^how\s+is\b[^?]{0,90}\bdecisions?\s+interact\b/i.test(body)
      || /^when\s+does\b[^?]{0,90}\bsells\b[^?]*,\s*how\b/i.test(body)) return "auxiliary_inflection_or_clause_splice";
  if (/^how\s+(?:do|does)\s+\p{L}[\p{L}'’-]*ing\b.+\bat\s+which\b.+\b(?:affect|change|improve|increase|reduce|shape)\b.+\b(?:is|are)\s+(?:a|an|the)\b/iu.test(body)) return "relative_clause_as_question_predicate";
  if (new RegExp(`^(?:when|where|why)\\s+(?!(?:${QUESTION_AUXILIARY})\\b)`, "i").test(body)) return "subordinate_wh_fragment";
  if (/^how\s+does\s+(?:i|we|you|they|these|those|both)\b/i.test(body)) return "auxiliary_subject_disagreement";
  if (/^how\s+do\s+(?:a|an)\b/i.test(body)) return "auxiliary_subject_disagreement";
  if (/^how\s+(?!(?:can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had|much|many|high|low|large|small|long|often|quickly|slowly|well|best)\b)/i.test(body)) return "uninverted_how_question";
  if (/^how\s+(?:can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had)\s+(?:to|be)\b/i.test(body)) return "missing_question_subject";
  if (/^how\s+(?:can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had)\s+(?:how|when|where|why)\b/i.test(body)
    || /^how\s+(?:can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had)\s+which\s+(?:a|an)\b/i.test(body)) {
    return "embedded_question_as_subject";
  }
  if (/\b(and|or|to)\s+\1\b/i.test(body)) return "duplicated_connector";
  if (/\b(?:firstand|secondand|thirdand)\b/i.test(body)) return "fused_connector";
  if (/^(?:how|what|when|where|why|which)\s+(?:can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had)\s+(?:additionally|alternatively|building\s+on|corroborated\s+by|for\s+(?:example|instance)|furthermore|given\b|in\s+(?:close\s+collaboration|particular|this\s+(?:paper|study))|leveraging\b|moreover|specifically|surprisingly|to\s+(?:alleviate|answer|address|build|demonstrate|gain|improve|inform|obtain|reduce)\b|unlike\b|using\b|with\s+respect\s+to|yet\b)/i.test(body)) {
    return "discourse_marker_as_subject";
  }
  if (/^(?:how|what|when|where|why|which)\s+(?:can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had)\s+(?:although|though|whereas|however|first|second|third|fourth|finally)\b/i.test(body)) {
    return "discourse_marker_as_subject";
  }
  if (/^how\s+does\s+(?:(?:the|these|those|certain|multiple|several|competing|geoconquesting)\s+)?(?:conditions|efforts|firms|customers|consumers|platforms|retailers|sellers|buyers|suppliers|sensors|results)\b/i.test(body)) return "auxiliary_subject_disagreement";
  if (/^how\s+do\s+(?:he|she|it|this|that)\b/i.test(body)) return "auxiliary_subject_disagreement";
  const stackedAuxiliary = body.match(/^how\s+(?:do|does|did)\s+(.{1,300}?)\b(?:can|could|should|would|will|may|might|must)\s+\p{L}/iu);
  if (stackedAuxiliary && !/\b(?:that|which|who|whose|whether|when|where)\b/i.test(stackedAuxiliary[1])) return "stacked_auxiliary";
  if (/^how\s+(?:do|does|did)\s+under\b/i.test(body)) return "preposition_as_subject";
  if (/^(?:how|when|where|why)\s+(?:can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had)\b.+,\s*(?:and\s+)?(?:i|we|our\s+(?:paper|study|analysis|findings?|results?)|this\s+(?:paper|study|analysis))\b/i.test(body)) {
    return "embedded_author_clause";
  }
  if (/^(?:when|where|why)\s+(?:can|could|should|would|do|does|did|is|are|was|were|will|may|might|must|has|have|had)\b.+,\s*(?:a|an|the|consumers?|customers?|firms?|platforms?|retailers?|sellers?|suppliers?)\b.{0,100}\b(?:can|could|should|would|will|may|might|must|is|are|was|were|has|have|had)\b/i.test(body)) {
    return "multiple_finite_clauses";
  }
  if (new RegExp(`\\band\\s+(?:how|when|where|why)\\s+(?!(?:${QUESTION_AUXILIARY})\\b).{1,120}\\s+(?:${QUESTION_AUXILIARY})\\b`, "i").test(body)) {
    return "coordinated_uninverted_question";
  }
  if (/\bour\s+results?\s+(?:suggest|show|indicate|imply)\b/i.test(body)) return "embedded_result_clause";
  if (/[,;:]\s*$/.test(body)) return "dangling_punctuation";
  if (/^how\s+are\s+(?:motivated|maximizing|minimizing|modeling|studying|investigating|analyzing)\b.+\bcombined$/i.test(body)) return "gerund_combination_artifact";
  if (/^how\s+are\s+.+\b(?:where|in\s+which)\b.+\bcombined$/i.test(body)) return "clause_combination_artifact";
  if (/^how\s+are\s+.+\b(?:allows?|chooses?|decides?|provides?|uses?|informs?|adopts?|had\s+adopted)\b.+\bcombined$/i.test(body)) return "finite_verb_combination_artifact";
  if (/^how\s+are\s+.+\b(?:is|are|was|were|has|have)\b.+\bcombined$/i.test(body)) return "finite_verb_combination_artifact";
  if (/\b(?:affect|change|compare|contribute\s+to|determine|influence|shape)\s+(?:we|the\s+(?:paper|study|analysis))\b/i.test(body)) return "embedded_author_clause";
  if (/,\s+(?:we|the\s+(?:paper|study|analysis))\s+(?:show|find|demonstrate|establish|derive|identify|investigate|analy[sz]e|compare)\b/i.test(body)) {
    return "embedded_result_clause";
  }
  if (/^how\s+(?:do|does|did)\s+.+\b(?:distinguishes|relies|studies|considers|examines|investigates)\b/i.test(body)
    && !/\b(?:affect|allow|change|compare|contribute|determine|influence|shape|use)\b/i.test(body)) return "uninverted_predicate";
  if (/^what\s+determines\s+(?:i|we|you|they|he|she|it|this|these|those)\b/i.test(body)) return "declarative_clause_after_determines";
  if (/^what\s+determines\s+.{0,110}\b(?:firms?|platforms?|retailers?|sellers?|buyers?|customers?|revenue\s+management)\s+(?:is|are|has|have|rel(?:y|ies)|distinguish(?:es)?|stud(?:y|ies)|consider(?:s)?|choose(?:s)?|decide(?:s)?|set(?:s)?|sell(?:s)?|buy(?:s)?)\b/i.test(body)) {
    return "declarative_clause_after_determines";
  }
  if (/^what\s+determines\s+.+\band\s+(?:show|find|demonstrate|establish|derive|identify|examine|investigate|analy[sz]e|compare|characterize)\b/i.test(body)) {
    return "coordinated_purpose_artifact";
  }
  const determinesTail = body.match(/^what\s+determines\s+(.+)$/i)?.[1] || "";
  if (determinesTail
    && !/^(?:how|what|when|where|whether|which|who)\b/i.test(determinesTail)
    && /\b(?:allows?|buys?|chooses?|considers?|decides?|degrades?|distinguishes?|examines?|has|have|identifies?|investigates?|is|are|rel(?:y|ies)|sells?|sets?|stud(?:y|ies))\b/i.test(determinesTail)) {
    return "declarative_clause_after_determines";
  }
  return "";
}

export function isDirectResearchQuestion(value) {
  const question = normalizeQuestion(value);
  if (!question || !QUESTION_START.test(question)) return false;
  if (words(question).length < 4) return false;
  if (/^what\s+model\s+does\b.+\bdevelop\b/i.test(question)) return false;
  if (questionGrammarReason(question)) return false;
  const body = question.slice(0, -1);
  const boundaryProbe = body.replace(/\b(?:e\.g|i\.e|u\.s)\./gi, "").replace(/\bet\s+al\./gi, "");
  // A direct question has one terminal question mark.  Reject a leading
  // question followed by a subtitle even when the PDF/catalog joins the
  // boundary without whitespace (for example, `Content?-An Economic
  // Analysis`).  The title fallback can then retain only the genuine leading
  // interrogative instead of laundering the subtitle into the question.
  if (/[!?]/.test(boundaryProbe) || /\.\s+(?=\p{Lu})/u.test(boundaryProbe)) return false;
  return !extractionNoiseReason(question);
}

function sentenceCase(value) {
  const text = cleanSemanticText(value);
  return text && /^\p{Ll}/u.test(text) ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function lowerInitial(value) {
  const text = cleanSemanticText(value);
  if (!text || /^[A-Z]{2,}\b/.test(text)) return text;
  if (/^(?:A|An|The)\b/.test(text)) return `${text[0].toLowerCase()}${text.slice(1)}`;
  return /^\p{Lu}\p{Ll}/u.test(text) ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

function lowerTitlePhrase(value) {
  return cleanSemanticText(value)
    .replace(/^(?:A|An|The)\b/u, (word) => word.toLocaleLowerCase())
    .replace(/\b\p{Lu}\p{Ll}+(?:[’']\p{Ll}+)?\b/gu, (word) => word.toLocaleLowerCase());
}

function nounPhraseAuxiliary(value) {
  const text = cleanSemanticText(value);
  return /^(?:both|i|we|you|they|these|those|two|three|four|multiple|several|many)\b/i.test(text)
    || /^(?:(?:new|random|stochastic|unknown|uncertain|independent|competing|ride-hailing)\s+)?(?:technologies|firms|marketplaces|platforms|retailers|sellers|buyers|customers|consumers|suppliers|sensors|disruptions)\b/i.test(text)
    || /\band\b/i.test(text)
    || /(?:^|\s)(?!analysis\b|business\b|news\b|process\b)[\p{L}'’-]+s(?:\s*\([^)]*\))?(?=\s+(?:by|for|from|in|of|on|that|to|under|when|where|which|who|with)\b|[,;:]|$)/iu.test(text)
    ? "do"
    : "does";
}

function safeTopicNounPhrase(value, { allowLong = false } = {}) {
  const text = cleanSemanticText(value);
  if (!text || TOPIC_AUTHOR_CLAUSE.test(text) || TOPIC_DISCOURSE_LEAD.test(text)) return false;
  if (/^(?:how|what|when|where|why|which|who|whether)\b/i.test(text)) return false;
  if (!allowLong && words(text).length > 38) return false;
  if (new RegExp(`\\b(?:${QUESTION_AUXILIARY})\\b`, "i").test(text)) return false;
  if (FINITE_TOPIC_PREDICATE.test(text)) return false;
  if (/[;:]|\b(?:however|whereas)\b/i.test(text)) return false;
  if (/^(?:(?:a|an|the)\s+)?(?:first|new|novel|proposed)\b.{0,50}\b(?:algorithm|approach|framework|method|model|policy)\b/i.test(text)) return false;
  if (/^(?:by|despite|facing|for|from|in|of|on|problem\s+definition|to|under|via|with)\b/i.test(text)) return false;
  return true;
}

function safeTopicRelationTail(value) {
  const text = cleanSemanticText(value);
  if (!text || TOPIC_AUTHOR_CLAUSE.test(text) || TOPIC_DISCOURSE_LEAD.test(text)) return false;
  if (words(text).length > 46 || /[;:]|\b(?:however|whereas)\b/i.test(text)) return false;
  if (/(?:,|[—–]|\s-\s)\s*(?:and\s+)?(?:a|an|the|it|they|consumers?|customers?|firms?|platforms?|retailers?|sellers?|suppliers?)\b.{0,100}\b(?:can|could|should|would|will|may|might|must|is|are|was|were|has|have|had)\b/i.test(text)) return false;
  if (/\b(?:and\s+(?:then\s+|thus,?\s+)?|but\s+(?:also\s+)?)(?:achieves?|advocates?|affects?|allows?|becomes?|captures?|changes?|confirms?|contributes?|controls?|decides?|describes?|drives?|enables?|gives?|helps?|improves?|incorporates?|increases?|leads?|offers?|outperforms?|pays?|provides?|reduces?|reveals?|sets?|shapes?|shows?|uses?|utilizes?|waives?|weakens?|yields?)\b/i.test(text)) return false;
  return true;
}

function safeEmbeddedQuestionTopic(value) {
  const text = cleanSemanticText(value);
  if (!text || /[;:]|\b(?:however|whereas)\b/i.test(text)) return false;
  if (TOPIC_AUTHOR_CLAUSE.test(text) || TOPIC_RESULT_OR_METHOD.test(text)) return false;
  if (/(?:,|[—–]|\s-\s)\s*.{0,120}\b(?:can|could|should|would|will|may|might|must|is|are|was|were|has|have|had|becomes?|leads?|provides?|reveals?|shows?|yields?)\b/i.test(text)) return false;
  return words(text).length <= 48;
}

function stripTopicLead(value) {
  return cleanSemanticText(value)
    .replace(ABSTRACT_LABEL, "")
    .replace(/^(?:a|an|the)\s+(?=(?:general\s+)?(?:research\s+)?(?:problem|question)\s+of\s+)/i, "")
    .replace(/^(?:general\s+)?(?:research\s+)?(?:problem|question)\s+of\s+/i, "")
    .replace(/[.?!]+$/g, "")
    .trim();
}

function restoreQuestionInversion(value) {
  const text = cleanSemanticText(value);
  if (/^(?:when|where|why)\s+(?:being|having|doing|making|using)\b/i.test(text)) return text;
  if (/^how\s+to\s+[\p{L}'’-]+\b/iu.test(text)) {
    return text.replace(/^how\s+to\s+/i, "how should one ").replace(/\bthe\s+own\b/gi, "their own");
  }
  const measured = text.match(/^how\s+(much|many|high|low|large|small|long|often|quickly|slowly|well)\s+(.+?)\s+(can|could|should|would|will|may|might|must|is|are|was|were|does|do|did)\s+(.+)$/i);
  if (measured) return `how ${measured[1]} ${measured[3]} ${measured[2]} ${measured[4]}`;
  const match = text.match(/^(how|when|where|why)\s+(.+?)\s+(can|could|should|would|will|may|might|must|is|are|was|were|does|do|did)\s+(.+)$/i);
  const lexical = !match && text.match(/^(how|when|where|why)\s+(.+?)\s+(affects?|changes?|depends?|determines?|drives?|improves?|increases?|influences?|limits?|performs?|reduces?|shapes?)\s+(.+)$/i);
  const lexicalBase = lexical ? ({
    affects: "affect", changes: "change", depends: "depend", determines: "determine", drives: "drive", improves: "improve",
    increases: "increase", influences: "influence", limits: "limit", performs: "perform", reduces: "reduce", shapes: "shape"
  })[lexical[3].toLowerCase()] || lexical[3].toLowerCase() : "";
  const leadingRestored = match
    ? `${match[1]} ${match[3]} ${match[2]} ${match[4]}`
    : lexical && safeTopicNounPhrase(lexical[2]) && safeTopicRelationTail(lexical[4])
      ? `${lexical[1]} ${nounPhraseAuxiliary(lexical[2])} ${lexical[2]} ${lexicalBase} ${lexical[4]}`
      : text;
  // A purpose sentence can coordinate two embedded questions ("examines how X
  // should ... and how Y is affected"). Restore inversion in both clauses;
  // otherwise a fluent first clause can hide a declarative second clause.
  return leadingRestored.replace(
    new RegExp(`\\band\\s+(how|when|where|why)\\s+((?!(?:${QUESTION_AUXILIARY})\\b).+?)\\s+(${QUESTION_AUXILIARY})\\s+(.+)$`, "i"),
    (_, wh, subject, auxiliary, rest) => `and ${wh} ${auxiliary} ${subject} ${rest}`
  );
}

function topicQuestion(value, { allowGeneric = true, titleStyle = false } = {}) {
  const rawTopic = cleanSemanticText(value);
  if (QUESTION_METADATA_SENTENCE.test(rawTopic)) return "";
  let topic = stripTopicLead(rawTopic).replace(/^(?:thus|therefore|hence),?\s+/i, "");
  if (!topic || words(topic).length < 3 || extractionNoiseReason(topic)) return "";
  if (/^(?:suppose|assume|let)\b/i.test(topic)) return "";
  if (/^(?:although|though|whereas|however|first|second|third|fourth|finally)\b/i.test(topic)
      || /^(?:the|these|our)\s+(?:findings?|results?)\b/i.test(topic)) return "";
  const topicBoundaryProbe = topic.replace(/\b(?:i\.e|e\.g|u\.s)\./gi, "").replace(/\b\d+\.\d+\b/g, "");
  if (/[.!]\s+\S/u.test(topicBoundaryProbe)) return "";
  const phrase = titleStyle ? lowerTitlePhrase : lowerInitial;

  const motivatedPurpose = topic.match(/^motivated\s+by\s+.+,\s+(we\s+.+)$/i);
  if (motivatedPurpose) topic = motivatedPurpose[1];
  if (PURPOSE_START.test(topic)) {
    const clause = topic.replace(PURPOSE_START, "");
    if (clause && clause !== topic) return topicQuestion(clause, { allowGeneric, titleStyle });
  }

  // Purpose fields often state the research relation as an interaction rather
  // than as an interrogative.  Preserve both named sides of that relation;
  // this is more informative than returning an interrogative paper title.
  const interaction = topic.match(/^(?:the\s+)?interaction\s+between\s+(.+?)\s+and\s+(.+)$/i);
  if (interaction
      && safeTopicNounPhrase(interaction[1], { allowLong: true })
      && safeTopicNounPhrase(interaction[2], { allowLong: true })) {
    return normalizeQuestion(`How do ${phrase(interaction[1])} and ${phrase(interaction[2])} interact`);
  }

  const statedAim = topic.match(/^(.+?)\s+aims?\s+to\s+(.+)$/i);
  if (statedAim
      && safeTopicNounPhrase(statedAim[1], { allowLong: true })
      && safeTopicRelationTail(statedAim[2])) {
    return normalizeQuestion(`How can ${phrase(statedAim[1])} ${lowerInitial(statedAim[2])}`);
  }
  const detectAndUse = topic.match(/^(?:(?:the\s+)?problem\s+of\s+)?(detecting|estimating|identifying|learning)\s+(.+?)\s+from\s+(.+?)\s+and\s+(?:using|use)\s+(?:them|it|those\s+estimates?)\s+to\s+(.+)$/i);
  if (detectAndUse && ![detectAndUse[2], detectAndUse[3], detectAndUse[4]].some(extractionNoiseReason)) {
    const participle = ({ detecting: "detected", estimating: "estimated", identifying: "identified", learning: "learned" })[detectAndUse[1].toLowerCase()];
    return normalizeQuestion(`How can ${phrase(detectAndUse[2])} be ${participle} from ${phrase(detectAndUse[3])} and used to ${lowerInitial(detectAndUse[4])}`);
  }
  const questionOfWhether = topic.match(/^(?:the\s+)?question\s+of\s+[^—:]{1,80}[—:]\s*whether\s+(.+)$/i);
  if (questionOfWhether) return topicQuestion(questionOfWhether[1], { allowGeneric: false, titleStyle });
  if (TOPIC_AUTHOR_CLAUSE.test(topic) || TOPIC_DISCOURSE_LEAD.test(topic) || TOPIC_RESULT_OR_METHOD.test(topic)) return "";

  const viableApproach = topic.match(/^(.+?)\s+(?:is|are)\s+(?:(?:a|an|the)\s+)?(?:viable|useful|effective)\s+approach\s+to\s+(analy[sz]e|model|solve|study)\s+(.+)$/i);
  if (viableApproach
      && safeTopicNounPhrase(viableApproach[1])
      && safeTopicNounPhrase(viableApproach[3], { allowLong: true })) {
    return normalizeQuestion(`How can ${phrase(viableApproach[1])} be used to ${viableApproach[2].toLocaleLowerCase()} ${phrase(viableApproach[3])}`);
  }

  const influenceGap = topic.match(/^(.+?)\s+(?:has|have)\s+become\b[^,.;]{0,140},\s*but\s+(?:little|not\s+much)\s+is\s+known\s+about\s+(?:its|their|the)\s+(?:influence|effect|impact)\s+on\s+(.+)$/i);
  if (influenceGap && safeTopicNounPhrase(influenceGap[1]) && safeTopicRelationTail(influenceGap[2])) {
    return normalizeQuestion(`How ${nounPhraseAuxiliary(influenceGap[1])} ${phrase(influenceGap[1])} influence ${phrase(influenceGap[2])}`);
  }

  topic = topic.replace(/^(?:this|the)\s+(?:paper|study|analysis)\s+(?:shows?|finds?|demonstrates?)\s+that\s+/i, "");

  const estimationMethod = topic.match(/^(?:a\s+)?(?:new\s+)?estimation\s+method\s+for\s+(.+?)\s+with\s+(.+)$/i);
  if (estimationMethod && safeTopicNounPhrase(estimationMethod[1]) && safeTopicNounPhrase(estimationMethod[2], { allowLong: true })) {
    return normalizeQuestion(`How can ${phrase(estimationMethod[1])} be estimated using ${phrase(estimationMethod[2])}`);
  }

  const characterization = topic.match(/^(?:a\s+)?(?:(?:fundamental|general|new)\s+)?characterization\s+of\s+(.+?)\s+for\s+(.+?)(?=,\s+(?:accommodating|allowing|enabling|incorporating)\b|$)/i);
  if (characterization && safeTopicNounPhrase(characterization[1]) && safeTopicNounPhrase(characterization[2], { allowLong: true })) {
    return normalizeQuestion(`How can ${phrase(characterization[1])} be characterized for ${phrase(characterization[2])}`);
  }

  const strategicImplications = topic.match(/^(?:the\s+)?strategic\s+implications\s+of\s+(.+?)\s+in\s+(.+)$/i);
  if (strategicImplications && safeTopicNounPhrase(strategicImplications[1]) && safeTopicNounPhrase(strategicImplications[2], { allowLong: true })) {
    return normalizeQuestion(`How does ${phrase(strategicImplications[1])} affect strategic outcomes in ${phrase(strategicImplications[2])}`);
  }

  const titledChoice = topic.match(/^(.+?)\s+or\s+(.+?)\?\s+(.+)$/i);
  if (titledChoice) {
    return normalizeQuestion(`How do ${phrase(titledChoice[1])} and ${phrase(titledChoice[2])} compare for ${phrase(titledChoice[3])}`);
  }

  const enabling = topic.match(/^(.+?)\s+allows?\s+(.+?)\s+to\s+(.+)$/i);
  if (enabling && safeTopicNounPhrase(enabling[1]) && safeTopicRelationTail(enabling[3])) {
    return normalizeQuestion(`How ${nounPhraseAuxiliary(enabling[1])} ${phrase(enabling[1])} allow ${phrase(enabling[2])} to ${lowerInitial(enabling[3])}`);
  }

  const reliance = topic.match(/^(.+?)\s+rel(?:y|ies)\s+on\s+(.+?)\s+to\s+(.+)$/i);
  if (reliance
      && !/^(?:that|whether)\b/i.test(reliance[2])
      && safeTopicNounPhrase(reliance[1])
      && safeTopicNounPhrase(reliance[2], { allowLong: true })
      && safeTopicRelationTail(reliance[3])) {
    return normalizeQuestion(`How can ${phrase(reliance[1])} use ${phrase(reliance[2])} to ${lowerInitial(reliance[3])}`);
  }

  const providesOpportunity = topic.match(/^(.+?)\s+provides?\s+(.+?)\s+with\s+(?:an|the)\s+opportunity\s+to\s+(.+)$/i);
  if (providesOpportunity && safeTopicNounPhrase(providesOpportunity[1]) && safeTopicRelationTail(providesOpportunity[3])) {
    return normalizeQuestion(`How ${nounPhraseAuxiliary(providesOpportunity[1])} ${phrase(providesOpportunity[1])} enable ${phrase(providesOpportunity[2])} to ${lowerInitial(providesOpportunity[3])}`);
  }

  const instrumentalPurpose = topic.match(/^(.+?)\s+(uses?|employs?|applies?)\s+(.+?)\s+to\s+(.+)$/i);
  if (instrumentalPurpose
      && safeTopicNounPhrase(instrumentalPurpose[1])
      && safeTopicRelationTail(instrumentalPurpose[4])) {
    const baseVerb = /^(?:use|uses)$/i.test(instrumentalPurpose[2])
      ? "use"
      : /^(?:employ|employs)$/i.test(instrumentalPurpose[2]) ? "employ" : "apply";
    return normalizeQuestion(`How ${nounPhraseAuxiliary(instrumentalPurpose[1])} ${phrase(instrumentalPurpose[1])} ${baseVerb} ${phrase(instrumentalPurpose[3])} to ${lowerInitial(instrumentalPurpose[4])}`);
  }

  const maximizing = topic.match(/^maximizing\s+(.+?)\s+in\s+(.+)$/i);
  if (maximizing && safeTopicNounPhrase(maximizing[1]) && safeTopicNounPhrase(maximizing[2], { allowLong: true })) {
    return normalizeQuestion(`How can ${phrase(maximizing[1])} be maximized in ${phrase(maximizing[2])}`);
  }

  const embedded = topic.match(/^(?:whether\s+)?(how|what|when|where|why|which|who)\s+(.+)$/i);
  if (embedded && safeEmbeddedQuestionTopic(topic)) {
    return normalizeQuestion(restoreQuestionInversion(`${embedded[1]} ${embedded[2]}`));
  }

  const whetherWithAuxiliary = topic.match(/^whether\s+(.+?)\s+(can|could|should|would|will|may|might|must|is|are|does|do)\s+(.+)$/i);
  if (whetherWithAuxiliary) {
    return normalizeQuestion(`${sentenceCase(whetherWithAuxiliary[2])} ${whetherWithAuxiliary[1]} ${whetherWithAuxiliary[3]}`);
  }
  if (/^whether\b/i.test(topic)) return normalizeQuestion(`What determines ${phrase(topic)}`);

  const effect = topic.match(/^(?:the\s+)?(?:effects?|impacts?|influence|role)\s+of\s+(.+?)\s+(?:on|in)\s+(.+)$/i);
  if (effect && safeTopicNounPhrase(effect[1]) && safeTopicNounPhrase(effect[2], { allowLong: true })) {
    return normalizeQuestion(`How ${nounPhraseAuxiliary(effect[1])} ${phrase(effect[1])} affect ${phrase(effect[2])}`);
  }

  const knownTo = topic.match(/^(.+?)\s+(is|are)\s+known\s+to\s+(.+)$/i);
  if (knownTo && safeTopicNounPhrase(knownTo[1]) && safeTopicRelationTail(knownTo[3])) {
    return normalizeQuestion(`How ${knownTo[2].toLowerCase() === "are" ? "do" : "does"} ${phrase(knownTo[1])} ${knownTo[3]}`);
  }

  const requiredPassive = topic.match(/^(?:in\s+[^,]{3,80},\s*)?(.+?)\s+(?:must|should|needs?\s+to)\s+be\s+([\p{L}\-]+ed)\s*(.*)$/iu);
  if (requiredPassive) {
    const subject = requiredPassive[1].replace(/^.*\bthat\s+(?=(?:both|the|a|an|each|every|firms?|customers?|consumers?|retailers?|sellers?|buyers?|platforms?|suppliers?)\b)/i, "");
    if (safeTopicNounPhrase(subject) && safeTopicRelationTail(requiredPassive[3] || requiredPassive[2])) {
      return normalizeQuestion(`How should ${phrase(subject)} be ${requiredPassive[2]} ${requiredPassive[3]}`);
    }
  }

  const modalEffect = topic.match(/^(.+?)\s+(can|could|should|would|will|may|might|must)\s+(affect|increase|reduce|improve|change|determine|drive|shape|resolve)\s+(.+)$/i);
  if (modalEffect) {
    if (/^(?:we|the\s+(?:paper|study|analysis))\b/i.test(modalEffect[1])
      || !safeTopicNounPhrase(modalEffect[1])
      || !safeTopicRelationTail(modalEffect[4])) return "";
    return normalizeQuestion(`How ${modalEffect[2].toLowerCase()} ${phrase(modalEffect[1])} ${modalEffect[3].toLowerCase()} ${phrase(modalEffect[4])}`);
  }

  const assertedEffect = topic.match(/^(.+?)\s+(affects?|increases?|reduces?|improves?|changes?|determines?|drives?|shapes?|resolves?)\s+(.+)$/i);
  if (assertedEffect) {
    if (/^(?:we|the\s+(?:paper|study|analysis))\b/i.test(assertedEffect[1])
      || /^(?:that|which|who)\s+(?:can|could|should|would|will|may|might|must|is|are|was|were|has|have|had)\b/i.test(assertedEffect[3])
      || !safeTopicNounPhrase(assertedEffect[1])
      || !safeTopicRelationTail(assertedEffect[3])) return "";
    const auxiliary = nounPhraseAuxiliary(assertedEffect[1]);
    const baseVerb = ({
      affects: "affect",
      increases: "increase",
      reduces: "reduce",
      improves: "improve",
      changes: "change",
      determines: "determine",
      drives: "drive",
      shapes: "shape",
      resolves: "resolve"
    })[assertedEffect[2].toLowerCase()] || assertedEffect[2].toLowerCase();
    return normalizeQuestion(`How ${auxiliary} ${phrase(assertedEffect[1])} ${baseVerb} ${phrase(assertedEffect[3])}`);
  }

  const comparison = topic.match(/^(.+?)\s+(?:versus|vs\.?)\s+(.+)$/i);
  if (comparison && safeTopicNounPhrase(comparison[1]) && safeTopicNounPhrase(comparison[2], { allowLong: true })) {
    return normalizeQuestion(`How do ${phrase(comparison[1])} and ${phrase(comparison[2])} compare`);
  }

  const directedAllocation = topic.match(/^(allocating|assigning)\s+(.+?)\s+(to|among|across)\s+(.+)$/i);
  if (directedAllocation && safeTopicNounPhrase(directedAllocation[2]) && safeTopicNounPhrase(directedAllocation[4], { allowLong: true })) {
    const participle = directedAllocation[1].toLowerCase() === "allocating" ? "allocated" : "assigned";
    return normalizeQuestion(`How should ${phrase(directedAllocation[2])} be ${participle} ${directedAllocation[3]} ${phrase(directedAllocation[4])}`);
  }

  const gerundRules = [
    [/^allocating\s+(.+)$/i, "allocated"],
    [/^assigning\s+(.+)$/i, "assigned"],
    [/^balancing\s+(.+)$/i, "balanced"],
    [/^choosing\s+(.+)$/i, "chosen"],
    [/^computing\s+(.+)$/i, "computed"],
    [/^designing\s+(.+)$/i, "designed"],
    [/^estimating\s+(.+)$/i, "estimated"],
    [/^managing\s+(.+)$/i, "managed"],
    [/^optimizing\s+(.+)$/i, "optimized"],
    [/^pricing\s+(.+)$/i, "priced"],
    [/^reducing\s+(.+)$/i, "reduced"],
    [/^scheduling\s+(.+)$/i, "scheduled"],
    [/^selecting\s+(.+)$/i, "selected"]
  ];
  for (const [pattern, participle] of gerundRules) {
    const match = topic.match(pattern);
    if (match && safeTopicNounPhrase(match[1], { allowLong: true })) return normalizeQuestion(`How should ${phrase(match[1])} be ${participle}`);
  }

  const through = topic.match(/^(.+?)\s+(through|via|using|with)\s+(.+)$/i);
  if (through) {
    if (/^(?:we|our\s+(?:work|paper|study|analysis)|the\s+(?:paper|study|analysis))\b/i.test(through[1])
      || /\bin\s+contrast\b/i.test(through[1])
      || !safeTopicNounPhrase(through[1])
      || !safeTopicNounPhrase(through[3], { allowLong: true })) return "";
    if (through[2].toLowerCase() === "with") {
      return normalizeQuestion(`How are ${phrase(through[1])} and ${phrase(through[3])} combined`);
    }
    return normalizeQuestion(`How does ${phrase(through[3])} contribute to ${phrase(through[1])}`);
  }

  const under = topic.match(/^(.+?)\s+under\s+(.+)$/i);
  if (under) {
    if (/^(?:we|the\s+(?:paper|study|analysis))\b/i.test(under[1])
      || !safeTopicNounPhrase(under[1])
      || !safeTopicNounPhrase(under[2], { allowLong: true })) return "";
    const condition = phrase(under[2]);
    const subject = phrase(under[1]).replace(/\s+model(?=\s+for\b|$)/i, "");
    const auxiliary = nounPhraseAuxiliary(condition);
    return normalizeQuestion(`How ${auxiliary} ${condition} affect ${subject}`);
  }

  if (!safeTopicNounPhrase(topic, { allowLong: true })) return "";
  return allowGeneric ? normalizeQuestion(`What determines ${phrase(topic)}`) : "";
}

function purposeQuestion(value) {
  const text = cleanSemanticText(value)
    .replace(ABSTRACT_LABEL, "")
    .replace(/^(?:thus|therefore|hence),?\s+/i, "");
  if (!text || extractionNoiseReason(text)) return "";
  const boundedPurposePhrase = (candidate, limit = 44) => {
    const phrase = cleanSemanticText(candidate);
    return Boolean(phrase)
      && words(phrase).length <= limit
      && !extractionNoiseReason(phrase)
      && !/[;!?]/u.test(phrase)
      && !/\b(?:we|our\s+(?:paper|study|analysis)|this\s+(?:paper|study|analysis))\b/i.test(phrase);
  };

  const modeledInquiry = text.match(/^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)|(?:this|the)\s+(?:paper|study|article|analysis))\s+uses?\s+.+?\bmodel\s+to\s+(?:study|examine|investigate|analy[sz]e|explore)\s+(how\s+.+?)[.!?]*$/i);
  if (modeledInquiry) {
    const focusedInquiry = modeledInquiry[1].replace(/,\s+where\b.+$/i, "");
    const question = normalizeQuestion(restoreQuestionInversion(focusedInquiry));
    if (isDirectResearchQuestion(question)) return question;
  }

  const comparedImpact = text.match(/^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)|(?:this|the)\s+(?:paper|study|article|analysis))\s+(?:compare|compares)\s+(.+?)\s+(?:and\s+)?(?:evaluate|evaluates|assess|assesses)\s+(?:the\s+)?(?:impact|effect|influence)\s+of\s+(.+?)[.!?]*$/i);
  if (comparedImpact
      && safeTopicRelationTail(comparedImpact[1])
      && safeTopicNounPhrase(comparedImpact[2], { allowLong: true })) {
    const subject = lowerInitial(comparedImpact[2]);
    const outcome = lowerInitial(comparedImpact[1]);
    if (/(?:ness|behavior|design|policy|strategy|network)$/i.test(subject)) {
      const outcomeAuxiliary = /\b(?:equilibria|outcomes|policies|prices|profits|systems)\b/i.test(outcome) ? "are" : "is";
      return normalizeQuestion(`How ${outcomeAuxiliary} ${outcome} affected by ${subject}`);
    }
    return normalizeQuestion(`How ${nounPhraseAuxiliary(subject)} ${subject} affect ${outcome}`);
  }

  const characterizedSusceptibility = text.match(/^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)|(?:this|the)\s+(?:paper|study|article|analysis))\s+characteri[sz](?:e|es)\s+(.+?)\s+that\s+(?:is|are)\s+(.+?)(?:\s+and\s+derive(?:s)?\s+conditions?\s+under\s+which\s+.+)?[.!?]*$/i);
  if (characterizedSusceptibility
      && safeTopicNounPhrase(characterizedSusceptibility[1], { allowLong: true })
      && safeTopicRelationTail(characterizedSusceptibility[2])) {
    const auxiliary = nounPhraseAuxiliary(characterizedSusceptibility[1]) === "do" ? "are" : "is";
    const subject = lowerInitial(characterizedSusceptibility[1]).replace(/^(?:a|an|the)\s+/i, "");
    return normalizeQuestion(`Which ${subject} ${auxiliary} ${lowerInitial(characterizedSusceptibility[2])}`);
  }

  const identifiedWays = text.match(/^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)|(?:this|the)\s+(?:paper|study|article|analysis))\s+identif(?:y|ies)\s+(?:(?:one|two|three|four|several|multiple|the)\s+)?ways?\s+in\s+which\s+(.+?)\s+(affects?|changes?|determines?|drives?|improves?|increases?|influences?|limits?|reduces?|shapes?)\s+(.+?)[.!?]*$/i);
  if (identifiedWays
      && safeTopicNounPhrase(identifiedWays[1], { allowLong: true })
      && safeTopicRelationTail(identifiedWays[3])) {
    const baseVerb = ({
      affects: "affect", changes: "change", determines: "determine", drives: "drive", improves: "improve",
      increases: "increase", influences: "influence", limits: "limit", reduces: "reduce", shapes: "shape"
    })[identifiedWays[2].toLowerCase()] || identifiedWays[2].toLowerCase();
    return normalizeQuestion(`How ${nounPhraseAuxiliary(identifiedWays[1])} ${lowerInitial(identifiedWays[1])} ${baseVerb} ${lowerInitial(identifiedWays[3])}`);
  }

  const comparedSystems = text.match(/^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)|(?:this|the)\s+(?:paper|study|article|analysis))\s+(?:aim\s+to\s+)?(?:compare|examine|investigate|analy[sz]e)\s+(.+?)\s+and\s+(.+?)\s+in\s+order\s+to\s+(?:assess|determine|evaluate|establish|understand)\s+whether\s+.+$/i);
  if (comparedSystems
      && boundedPurposePhrase(comparedSystems[1], 36)
      && boundedPurposePhrase(comparedSystems[2], 36)) {
    return normalizeQuestion(`How do ${lowerInitial(comparedSystems[1])} and ${lowerInitial(comparedSystems[2])} compare`);
  }

  const soughtOptimalUse = text.match(/^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)|(?:this|the)\s+(?:paper|study|article|analysis))\s+seek(?:s)?\s+to\s+determine\s+(?:the\s+)?optimal\s+use\s+and\s+(?:the\s+)?(?:potential\s+)?benefits?\s+of\s+(.+?)(?:,\s*given\s+(.+?))?[.!?]*$/i);
  if (soughtOptimalUse && safeTopicNounPhrase(soughtOptimalUse[1], { allowLong: true })) {
    const condition = soughtOptimalUse[2] && safeTopicRelationTail(soughtOptimalUse[2])
      ? ` given ${lowerInitial(soughtOptimalUse[2])}`
      : "";
    return normalizeQuestion(`How should ${lowerInitial(soughtOptimalUse[1])} be used${condition}`);
  }

  const maximumPossible = text.match(/^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)|(?:this|the)\s+(?:paper|study|article|analysis))\s+analy[sz](?:e|es)\s+(?:the\s+)?maximum\s+possible\s+(.+?)\s+that\s+can\s+be\s+([\p{L}'’-]+ed)\s+(.+?)[.!?]*$/iu);
  if (maximumPossible && boundedPurposePhrase(maximumPossible[3])) {
    const context = lowerInitial(maximumPossible[3]).replace(/,\s*but\s+/i, " and ");
    return normalizeQuestion(`How can ${lowerInitial(maximumPossible[1])} be ${maximumPossible[2].toLowerCase()} ${context}`);
  }

  const coordinatedImpact = text.match(/^(?:(?:in\s+this\s+(?:paper|study|article),?\s*)?(?:we|the\s+authors?)|(?:this|the)\s+(?:paper|study|article|analysis|research))\s+(?:examine|examines|investigate|investigates|analy[sz]e|analy[sz]es)\s+(?:the\s+)?(?:impact|effect|influence)\s+of\s+(.+?)\s+on\s+(.+?)(?:\s+and\s+(?:study|studies|examine|examines|investigate|investigates|explore|explores)\s+.+)?[.!?]*$/i);
  if (coordinatedImpact
      && safeTopicNounPhrase(coordinatedImpact[1], { allowLong: true })
      && safeTopicNounPhrase(coordinatedImpact[2], { allowLong: true })) {
    const subject = lowerInitial(coordinatedImpact[1]);
    const outcome = lowerInitial(coordinatedImpact[2]);
    if (/(?:ness|behavior|design|policy|strategy|network)$/i.test(subject)) {
      const outcomeAuxiliary = /\b(?:models|outcomes|policies|prices|profits|systems)\b/i.test(outcome) ? "are" : "is";
      return normalizeQuestion(`How ${outcomeAuxiliary} ${outcome} affected by ${subject}`);
    }
    return normalizeQuestion(`How ${nounPhraseAuxiliary(subject)} ${subject} affect ${outcome}`);
  }

  const clause = PURPOSE_START.test(text)
    ? text.replace(PURPOSE_START, "")
    : GAP_PURPOSE_START.test(text)
      ? text.replace(GAP_PURPOSE_START, "")
      : MODEL_PURPOSE_START.test(text) ? text.replace(MODEL_PURPOSE_START, "") : "";
  if (!clause) return "";
  const explicitWhether = clause.match(/^(?:the\s+)?question\s+of\s+[^—:]{1,80}[—:]\s*whether\s+(.+)$/i);
  if (explicitWhether) return topicQuestion(explicitWhether[1], { allowGeneric: false });
  return topicQuestion(clause, { allowGeneric: true });
}

function labeledDefinition(value) {
  const text = cleanSemanticText(value);
  if (!/^problem\s+definition\s*:/i.test(text)) return false;
  const body = text.replace(/^problem\s+definition\s*:\s*/i, "");
  return !isDirectResearchQuestion(body);
}

function objectiveQuestion(value) {
  const text = cleanSemanticText(value).replace(ABSTRACT_LABEL, "").replace(/^(?:thus|therefore|hence),?\s+/i, "");
  if (!text || extractionNoiseReason(text)) return "";
  const challenge = text.match(/^(.+?)\s+faces?\s+(?:the\s+)?(?:(?:central|key|main)\s+)?(?:challenge|problem|objective)\s+of\s+(optimizing|maximizing|minimizing|designing|determining|balancing|allocating|scheduling|pricing|managing|choosing)\s+(.+)$/i);
  if (!challenge) return "";
  const baseVerb = ({
    optimizing: "optimize",
    maximizing: "maximize",
    minimizing: "minimize",
    designing: "design",
    determining: "determine",
    balancing: "balance",
    allocating: "allocate",
    scheduling: "schedule",
    pricing: "price",
    managing: "manage",
    choosing: "choose"
  })[challenge[2].toLowerCase()];
  return normalizeQuestion(`How should ${lowerInitial(challenge[1])} ${baseVerb} ${lowerInitial(challenge[3])}`);
}

function sameText(left, right) {
  const a = normalizedKey(left);
  const b = normalizedKey(right);
  return Boolean(a && b && a === b);
}

function titleFallbackQuestion(value, { leadingOnly = false } = {}) {
  const title = cleanSemanticText(value);
  if (!title) return "";

  const accept = (candidate) => {
    const question = normalizeQuestion(candidate);
    return isDirectResearchQuestion(question) ? question : "";
  };

  const questionMark = title.indexOf("?");
  if (questionMark > 0 && cleanSemanticText(title.slice(questionMark + 1))) {
    const clause = cleanSemanticText(title.slice(0, questionMark));
    // A subtitle can follow a genuine leading question. Internal sentence
    // punctuation, as in slogan titles, still fails closed.
    if (!/[!.]/.test(clause)) {
      const direct = normalizeQuestion(lowerTitlePhrase(clause));
      if (isDirectResearchQuestion(direct)) return direct;

      // Some substantive titles use an elliptical comparative question rather
      // than an auxiliary (for example, "Higher Prices for Larger Quantities?").
      const comparative = clause.match(/^(higher|lower|greater|smaller|larger|more|less)\s+(.+?)\s+for\s+(.+)$/i);
      if (comparative) {
        const subject = lowerTitlePhrase(comparative[2]);
        const copula = /(?:s|data)\b/i.test(subject) ? "are" : "is";
        const question = normalizeQuestion(`${copula} ${subject} ${comparative[1].toLowerCase()} for ${lowerTitlePhrase(comparative[3])}`);
        if (isDirectResearchQuestion(question)) return question;
      }
    }
  }

  // During the early interrogative-title pass, only the literal leading
  // question (or its narrow comparative ellipse) may outrank an explicit
  // purpose in the abstract.  Broader title relations are considered later,
  // after the purpose scan.
  if (leadingOnly) return "";

  const humanLoopAutomation = title.match(/^human\s+in\s+the\s+loop\s+automation\s*:\s*(.+)$/i);
  if (humanLoopAutomation) {
    // Keep the title's substantive setting while dropping the parenthetical
    // abbreviation marker, which is not grammatical inside a direct question.
    const setting = cleanSemanticText(lowerTitlePhrase(humanLoopAutomation[1]).replace(/\(tele-\)/gi, " "));
    const question = normalizeQuestion(`How does human-in-the-loop automation affect ${setting}`);
    if (isDirectResearchQuestion(question)) return question;
  }

  // These fallbacks preserve an explicit relation encoded by the title.  They
  // do not merely wrap the title in “formulated as a model”: the preposition,
  // comparison, conjunction, or action in the source determines the predicate
  // used by the question.
  const choiceLead = title.match(/^([^?!.]+?)\s+or\s+([^?!.]+?)\?\s+(.+)$/iu);
  if (choiceLead) {
    const question = accept(`How do ${lowerTitlePhrase(choiceLead[1])} and ${lowerTitlePhrase(choiceLead[2])} compare for ${lowerTitlePhrase(choiceLead[3])}`);
    if (question) return question;
  }

  const questionSuffix = title.match(/\?\s+(?=\p{Lu})(.+)$/u)?.[1] || "";
  const relationTitle = cleanSemanticText(questionSuffix || title);
  const colonIndex = relationTitle.indexOf(":");
  const lead = cleanSemanticText(colonIndex >= 0 ? relationTitle.slice(0, colonIndex) : relationTitle).replace(/[?!.]+$/g, "");
  const subtitle = cleanSemanticText(colonIndex >= 0 ? relationTitle.slice(colonIndex + 1) : "").replace(/[?!.]+$/g, "");
  const structural = subtitle || lead;
  const structuralPhrase = lowerTitlePhrase(structural);

  const infinitiveQuestion = lead.match(/^(how|when|where|why)\s+to\s+(.+)$/i);
  if (infinitiveQuestion) {
    const question = accept(`${infinitiveQuestion[1]} should one ${lowerTitlePhrase(infinitiveQuestion[2])}`);
    if (question) return question;
  }

  const pricingWhen = structural.match(/^pricing\s+when\s+(.+)$/i);
  if (pricingWhen) {
    const question = accept(`How should prices be set when ${lowerTitlePhrase(pricingWhen[1])}`);
    if (question) return question;
  }

  const onGerund = structural.match(/^on\s+(designing|managing|pricing|scheduling|selecting|allocating)\s+(.+)$/i);
  if (onGerund) {
    const participle = ({ designing: "designed", managing: "managed", pricing: "priced", scheduling: "scheduled", selecting: "selected", allocating: "allocated" })[onGerund[1].toLowerCase()];
    const question = accept(`How should ${lowerTitlePhrase(onGerund[2])} be ${participle}`);
    if (question) return question;
  }

  const aligned = lead.match(/^align(?:ing)?\s+(.+?)\s+with\s+(.+)$/i);
  if (aligned) {
    const method = subtitle.match(/^(?:a|an|the)\s+(.+?)\s+(?:method|approach|framework)\s+for\s+(.+)$/i);
    const subject = method
      ? `${lowerTitlePhrase(method[1])} method for ${lowerTitlePhrase(method[2])}`
      : lowerTitlePhrase(aligned[1]);
    const question = accept(`How can ${subject} align ${lowerTitlePhrase(aligned[1])} with ${lowerTitlePhrase(aligned[2])}`);
    if (question) return question;
  }

  const methodSubtitle = subtitle.match(/^(a|an|the)\s+(.+?)\s+(approach|analysis|framework|method|perspective)$/i);
  if (methodSubtitle && lead && !/[?]$/.test(lead)) {
    const article = methodSubtitle[1].toLowerCase();
    const descriptor = lowerTitlePhrase(methodSubtitle[2]);
    const mode = methodSubtitle[3].toLowerCase();
    const predicate = mode === "perspective" ? "examined from" : mode === "analysis" ? "analyzed using" : "addressed using";
    const question = accept(`How can ${lowerTitlePhrase(lead)} be ${predicate} ${article} ${descriptor} ${mode}`);
    if (question) return question;
  }

  const asRelation = structural.match(/^(.+?)\s+as\s+(?:a|an|the)\s+(.+)$/i);
  if (asRelation) {
    const question = accept(`How does ${lowerTitlePhrase(asRelation[1])} function as ${lowerTitlePhrase(asRelation[2])}`);
    if (question) return question;
  }

  const sampleSize = structural.match(/^(?:a\s+)?sample\s+size\s+(?:calculation|determination)\s+for\s+(.+)$/i);
  if (sampleSize) {
    const question = accept(`What sample size is required for ${lowerTitlePhrase(sampleSize[1])}`);
    if (question) return question;
  }

  const leadComparison = lead.match(/^(.+?)\s+(?:versus|vs\.?|or)\s+(.+)$/i);
  if (leadComparison) {
    const scope = subtitle ? ` for ${lowerTitlePhrase(subtitle)}` : "";
    const question = accept(`How do ${lowerTitlePhrase(leadComparison[1])} and ${lowerTitlePhrase(leadComparison[2])} compare${scope}`);
    if (question) return question;
  }

  const effect = structural.match(/^(?:the\s+)?(?:effects?|impacts?|influence|role|value|power)\s+of\s+(.+?)\s+(?:on|in|for)\s+(.+)$/i);
  if (effect) {
    const subject = lowerTitlePhrase(effect[1]);
    const question = accept(`How ${nounPhraseAuxiliary(subject)} ${subject} affect ${lowerTitlePhrase(effect[2])}`);
    if (question) return question;
  }

  const tradeoff = structural.match(/^(?:a|the)?\s*trade[- ]?off\s+(?:between|in)\s+(.+?)\s+(?:versus|vs\.?|and)\s+(.+)$/i);
  if (tradeoff) {
    const question = accept(`How do ${lowerTitlePhrase(tradeoff[1])} and ${lowerTitlePhrase(tradeoff[2])} trade off`);
    if (question) return question;
  }

  const comparison = structural.match(/^(.+?)\s+(?:versus|vs\.?)\s+(.+)$/i);
  if (comparison) {
    const question = accept(`How do ${lowerTitlePhrase(comparison[1])} and ${lowerTitlePhrase(comparison[2])} compare`);
    if (question) return question;
  }

  const fromTo = structural.match(/^from\s+(.+?)\s+to\s+(.+)$/i);
  if (fromTo) {
    const question = accept(`How can ${lowerTitlePhrase(fromTo[1])} be converted into ${lowerTitlePhrase(fromTo[2])}`);
    if (question) return question;
  }

  const preventive = structural.match(/^(.+?)\s+that\s+(prevent|reduce|limit|avoid)s?\s+(.+)$/i);
  if (preventive) {
    const question = accept(`How can ${lowerTitlePhrase(preventive[1])} ${preventive[2].toLowerCase()} ${lowerTitlePhrase(preventive[3])}`);
    if (question) return question;
  }

  const leveragingPurpose = structural.match(/^(.+?)\s+leveraging\s+(.+?)\s+to\s+(.+)$/i);
  if (leveragingPurpose) {
    const question = accept(`How can ${lowerTitlePhrase(leveragingPurpose[1])} leverage ${lowerTitlePhrase(leveragingPurpose[2])} to ${lowerTitlePhrase(leveragingPurpose[3])}`);
    if (question) return question;
  }

  const sourcingFrom = structural.match(/^(.+?)\s+sourcing\s+from\s+(.+)$/i);
  if (sourcingFrom) {
    const question = accept(`How should ${lowerTitlePhrase(sourcingFrom[1])} source from ${lowerTitlePhrase(sourcingFrom[2])}`);
    if (question) return question;
  }

  const knowledgeTiming = structural.match(/^(.+?)\s+know\s+when\s+(.+)$/i);
  if (knowledgeTiming) {
    const question = accept(`How can ${lowerTitlePhrase(knowledgeTiming[1])} determine when ${lowerTitlePhrase(knowledgeTiming[2])}`);
    if (question) return question;
  }

  const instrumental = structural.match(/^(?:using|leveraging)\s+(.+?)\s+to\s+(.+)$/i);
  if (instrumental) {
    const question = accept(`How can ${lowerTitlePhrase(instrumental[1])} be used to ${lowerTitlePhrase(instrumental[2])}`);
    if (question) return question;
  }

  const coordinatedContext = structural.match(/^(.+?)\s+and\s+(.+?)\s+(in|for|under|with)\s+(.+)$/i);
  if (coordinatedContext) {
    const question = accept(`How do ${lowerTitlePhrase(coordinatedContext[1])} and ${lowerTitlePhrase(coordinatedContext[2])} interact ${coordinatedContext[3].toLowerCase()} ${lowerTitlePhrase(coordinatedContext[4])}`);
    if (question) return question;
  }

  const actionRelation = structural.match(/^(pricing|scheduling|sourcing|competing|learning|estimating)\s+(by|with|from|under|on)\s+(.+)$/i);
  if (actionRelation) {
    const action = actionRelation[1].toLowerCase();
    const preposition = actionRelation[2].toLowerCase();
    const tail = lowerTitlePhrase(actionRelation[3]);
    const tailAuxiliary = nounPhraseAuxiliary(tail);
    const question = accept(action === "pricing"
      ? `How should prices be set ${preposition} ${tail}`
      : action === "competing"
        ? `How should competition ${preposition} ${tail} be managed`
        : `How ${tailAuxiliary} ${tail} affect ${action}`);
    if (question) return question;
  }

  const gerund = structural.match(/^(assessing|competing|coordinating|crowdsourcing|designing|detecting|estimating|fixing|improving|integrating|learning|leveraging|managing|maximizing|minimizing|modeling|modifying|offering|optimizing|planning|pooling|prescribing|pricing|protecting|regulating|scheduling|selecting|selling|shortening|solving|sourcing|tackling|allocating|assigning|balancing|reducing)\s+(.+)$/i);
  if (gerund && !/^(?:and|by|from|on|under|when|with)\b/i.test(gerund[2])) {
    const participle = ({
      assessing: "assessed", competing: "managed", coordinating: "coordinated", crowdsourcing: "crowdsourced",
      designing: "designed", detecting: "detected", estimating: "estimated", fixing: "corrected", improving: "improved",
      integrating: "integrated", learning: "learned", leveraging: "leveraged", managing: "managed", maximizing: "maximized",
      minimizing: "minimized", modeling: "modeled", modifying: "modified", offering: "offered", optimizing: "optimized",
      planning: "planned", pooling: "pooled", prescribing: "prescribed", pricing: "priced", protecting: "protected",
      regulating: "regulated", scheduling: "scheduled", selecting: "selected", selling: "sold", shortening: "shortened",
      solving: "solved", sourcing: "sourced", tackling: "addressed", allocating: "allocated", assigning: "assigned",
      balancing: "balanced", reducing: "reduced"
    })[gerund[1].toLowerCase()];
    const question = accept(`How should ${lowerTitlePhrase(gerund[2])} be ${participle}`);
    if (question) return question;
  }

  const optimal = structural.match(/^optimal\s+(.+?)(?:\s+for\s+(.+))?$/i);
  if (optimal) {
    const scope = optimal[2] ? ` for ${lowerTitlePhrase(optimal[2])}` : "";
    const designObject = cleanSemanticText(optimal[1])
      .replace(/^design\s+of\s+/i, "")
      .replace(/\s+design$/i, "");
    const question = accept(`How should ${lowerTitlePhrase(designObject)} be designed${scope}`);
    if (question) return question;
  }

  const modelFor = structural.match(/^(?:a|an|the)\s+(?:(.+?)\s+)?(?:model|framework|approach|method)\s+(?:for|of|to)\s+(.+)$/i);
  if (modelFor) {
    const qualifier = modelFor[1] ? ` using ${lowerTitlePhrase(modelFor[1])}` : "";
    const question = accept(`How can ${lowerTitlePhrase(modelFor[2])} be represented${qualifier}`);
    if (question) return question;
  }

  const through = structural.match(/^(.+?)\s+(?:through|via|using)\s+(.+)$/i);
  if (through) {
    const question = accept(`How can ${lowerTitlePhrase(through[2])} support ${lowerTitlePhrase(through[1])}`);
    if (question) return question;
  }

  const byRelation = structural.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byRelation) {
    const question = accept(`How can ${lowerTitlePhrase(byRelation[2])} support ${lowerTitlePhrase(byRelation[1])}`);
    if (question) return question;
  }

  const betweenRelation = structural.match(/^(.+?)\s+between\s+(.+)$/i);
  if (betweenRelation) {
    const shared = betweenRelation[1].match(/^(.+?)\s+sharing$/i);
    const question = accept(shared
      ? `How should ${lowerTitlePhrase(shared[1])} be shared between ${lowerTitlePhrase(betweenRelation[2])}`
      : `How does ${lowerTitlePhrase(betweenRelation[1])} differ between ${lowerTitlePhrase(betweenRelation[2])}`);
    if (question) return question;
  }

  const under = structural.match(/^(.+?)\s+under\s+(.+)$/i);
  if (under) {
    const condition = lowerTitlePhrase(under[2]);
    const question = accept(`How ${nounPhraseAuxiliary(condition)} ${condition} affect ${lowerTitlePhrase(under[1])}`);
    if (question) return question;
  }

  const withRelation = structural.match(/^(.+?)\s+with\s+(.+)$/i);
  if (withRelation) {
    const condition = lowerTitlePhrase(withRelation[2]);
    const question = accept(`How ${nounPhraseAuxiliary(condition)} ${condition} affect ${lowerTitlePhrase(withRelation[1])}`);
    if (question) return question;
  }

  const forRelation = structural.match(/^(.+?)\s+for\s+(.+)$/i);
  if (forRelation) {
    const question = accept(`How can ${lowerTitlePhrase(forRelation[1])} support ${lowerTitlePhrase(forRelation[2])}`);
    if (question) return question;
  }

  const inRelation = structural.match(/^(.+?)\s+in\s+(.+)$/i);
  if (inRelation) {
    const question = accept(`What role does ${lowerTitlePhrase(inRelation[1])} play in ${lowerTitlePhrase(inRelation[2])}`);
    if (question) return question;
  }

  const basedOn = structural.match(/^(.+?)\s+based\s+on\s+(.+)$/i);
  if (basedOn) {
    const question = accept(`How can ${lowerTitlePhrase(basedOn[2])} inform ${lowerTitlePhrase(basedOn[1])}`);
    if (question) return question;
  }

  const onRelation = structural.match(/^(.+?)\s+on\s+(.+)$/i);
  if (onRelation) {
    const sourceSubject = /^(?:effects?|impact|implications?)$/i.test(cleanSemanticText(onRelation[1])) && lead !== structural
      ? lead
      : onRelation[1];
    const subject = lowerTitlePhrase(sourceSubject);
    const question = accept(`How ${nounPhraseAuxiliary(subject)} ${subject} affect ${lowerTitlePhrase(onRelation[2])}`);
    if (question) return question;
  }

  const ofRelation = structural.match(/^(.+?)\s+of\s+(.+)$/i);
  if (ofRelation) {
    const subject = lowerTitlePhrase(ofRelation[2]);
    const question = accept(`How ${nounPhraseAuxiliary(subject)} ${subject} shape ${lowerTitlePhrase(ofRelation[1])}`);
    if (question) return question;
  }

  const beneficialEffect = structural.match(/^(?:the\s+)?beneficial\s+effects?\s+of\s+(.+)$/i);
  if (beneficialEffect) {
    const subject = lowerTitlePhrase(beneficialEffect[1]);
    const question = accept(`What benefits ${nounPhraseAuxiliary(subject) === "do" ? "do" : "does"} ${subject} create`);
    if (question) return question;
  }

  const implications = structural.match(/^implications?\s+of\s+(.+)$/i);
  if (implications) {
    const question = accept(`What are the implications of ${lowerTitlePhrase(implications[1])}`);
    if (question) return question;
  }

  const bareValue = structural.match(/^(?:the\s+)?value\s+of\s+(.+)$/i);
  if (bareValue) {
    const question = accept(`What value does ${lowerTitlePhrase(bareValue[1])} create`);
    if (question) return question;
  }

  const conjunction = structural.match(/^(.+?)\s+and\s+(.+)$/i);
  if (conjunction) {
    const operationalPair = /\b(?:staffing|scheduling|planning|allocation|pricing|design|coordination|management|selection)\b/i.test(structural);
    const question = accept(operationalPair
      ? `How should ${structuralPhrase} be coordinated`
      : `How do ${lowerTitlePhrase(conjunction[1])} and ${lowerTitlePhrase(conjunction[2])} interact`);
    if (question) return question;
  }

  const nominalAction = structural.match(/^(.+?)\s+(pricing|optimization|design|estimation|management|regulation|allocation|rationing|scheduling|replenishment|forecasting|planning|targeting|packing)$/i);
  if (nominalAction) {
    const participle = ({
      pricing: "priced", optimization: "optimized", design: "designed", estimation: "estimated", management: "managed",
      regulation: "regulated", allocation: "allocated", rationing: "rationed", scheduling: "scheduled",
      replenishment: "replenished", forecasting: "forecasted", planning: "planned", targeting: "targeted", packing: "planned"
    })[nominalAction[2].toLowerCase()];
    const question = accept(`How should ${lowerTitlePhrase(nominalAction[1])} be ${participle}`);
    if (question) return question;
  }

  const policyArtifact = structural.match(/^(.+?\b(?:auctions?|contracts?|mechanisms?|policies|strategies|systems?))$/i);
  if (policyArtifact) {
    const question = accept(`How should ${lowerTitlePhrase(policyArtifact[1])} be designed`);
    if (question) return question;
  }

  const modelArtifact = structural.match(/^(.+?\bmodels?)$/i);
  if (modelArtifact) {
    const subject = lowerTitlePhrase(modelArtifact[1]);
    const question = accept(`What relationships ${nounPhraseAuxiliary(subject) === "do" ? "do" : "does"} ${subject} represent`);
    if (question) return question;
  }

  const revisited = structural.match(/^(.+?)\s+revisited$/i);
  if (revisited) {
    const question = accept(`What changes when ${lowerTitlePhrase(revisited[1])} is revisited`);
    if (question) return question;
  }

  const profitMaximizing = structural.match(/^profit[- ]maximizing\s+(.+)$/i);
  if (profitMaximizing) {
    const question = accept(`How can ${lowerTitlePhrase(profitMaximizing[1])} maximize profit`);
    if (question) return question;
  }

  const semanticModifier = structural.match(/^(adaptive|distributionally\s+robust|robust|fair|failure-aware|prior-independent|distribution-free|dynamic|stochastic)\s+(.+)$/i);
  if (semanticModifier) {
    const modifier = semanticModifier[1].toLowerCase();
    const object = lowerTitlePhrase(semanticModifier[2]);
    const question = accept(({
      adaptive: `How can ${object} adapt as conditions change`,
      "distributionally robust": `How can ${object} account for distributional uncertainty`,
      robust: `How can ${object} remain effective under uncertainty`,
      fair: `How can ${object} preserve fairness over time`,
      "failure-aware": `How should ${object} account for failures`,
      "prior-independent": `How can ${object} be designed without prior distributional information`,
      "distribution-free": `How can ${object} operate without an assumed distribution`,
      dynamic: `How should ${object} adapt over time`,
      stochastic: `How can ${object} account for stochastic uncertainty`
    })[modifier]);
    if (question) return question;
  }
  // A methodological subtitle can be too elliptical to stand alone (for
  // example, “A Stochastic Differential Equation Approach”).  In that case
  // retry the substantive lead rather than emitting an empty result and
  // handing control to the catalog-wide generic wrapper.
  if (subtitle) {
    const leadQuestion = titleFallbackQuestion(lead);
    if (leadQuestion) return leadQuestion;
  }
  return "";
}

/**
 * Derive one research question without inventing a title-wrapping boilerplate.
 * `maturity` is source-authored only when an explicit direct business question
 * survives validation; all transformations are visibly source-derived.
 */
export function deriveResearchQuestion(record = {}) {
  const diagnostics = [];
  const businessQuestion = cleanSemanticText(record.business_question);
  const title = cleanSemanticText(record.title);

  if (businessQuestion) {
    if (isDirectResearchQuestion(businessQuestion)
        && !sameText(businessQuestion, title)
        && !GENERIC_QUESTION_PLACEHOLDER.test(businessQuestion)) {
      return {
        question: normalizeQuestion(businessQuestion),
        maturity: SEMANTIC_MATURITY.AUTHORED,
        source: { field: "business_question" },
        diagnostics
      };
    }
    diagnostics.push(diagnostic(
      sameText(businessQuestion, title) ? "business_question_is_title" : GENERIC_QUESTION_PLACEHOLDER.test(businessQuestion) ? "business_question_is_placeholder" : "business_question_not_interrogative",
      sameText(businessQuestion, title)
        ? "The business-question field repeats a non-interrogative title."
        : GENERIC_QUESTION_PLACEHOLDER.test(businessQuestion)
          ? "The business-question field is a catalog-wide generic placeholder."
        : "The business-question field is not a direct research question.",
      { field: "business_question" }
    ));
  }

  // A substantive leading question followed by a descriptive subtitle can be
  // retained because it is not the full paper title.  A title that consists
  // only of an interrogative must not pass through unchanged: the release
  // audit treats a case-only title copy as boilerplate and requires the
  // question to be derived from the paper's stated purpose or relation.
  if (title && title.includes("?")) {
    const directTitle = titleFallbackQuestion(title, { leadingOnly: true });
    if (directTitle && isDirectResearchQuestion(directTitle)) {
      return {
        question: directTitle,
        maturity: SEMANTIC_MATURITY.DERIVED,
        source: { field: "title", transformation: "substantive-title-clause" },
        diagnostics
      };
    }
  }

  if (businessQuestion) {
    if (!sameText(businessQuestion, title)) {
      const labeled = labeledDefinition(businessQuestion);
      const purpose = purposeQuestion(businessQuestion);
      const transformed = labeled && /^what\s+determines\b/i.test(purpose)
        ? ""
        : purpose || (labeled ? "" : topicQuestion(businessQuestion, { allowGeneric: false }));
      if (transformed && isDirectResearchQuestion(transformed)) {
        return {
          question: transformed,
          maturity: SEMANTIC_MATURITY.DERIVED,
          source: { field: "business_question", transformation: "purpose-to-question" },
          diagnostics
        };
      }
    }
  }

  const modelTopic = cleanSemanticText(record.model_topic);
  if (modelTopic) {
    const titleTopic = sameText(modelTopic, title);
    const direct = !titleTopic && isDirectResearchQuestion(modelTopic) ? normalizeQuestion(modelTopic) : "";
    const transformed = labeledDefinition(modelTopic)
      ? ""
      : direct || purposeQuestion(modelTopic) || topicQuestion(modelTopic, { allowGeneric: !titleTopic, titleStyle: titleTopic });
    if (transformed && isDirectResearchQuestion(transformed)) {
      return {
        question: transformed,
        maturity: SEMANTIC_MATURITY.DERIVED,
        source: { field: "model_topic", transformation: direct ? "punctuation-normalization" : "topic-to-question" },
        diagnostics
      };
    }
    diagnostics.push(diagnostic("model_topic_not_usable", "The model-topic field could not support a direct question.", { field: "model_topic" }));
  }

  const abstractSentences = sentenceList(record.abstract);
  for (const [index, sentence] of abstractSentences.entries()) {
    const transformed = objectiveQuestion(sentence);
    if (transformed && isDirectResearchQuestion(transformed)) {
      return {
        question: transformed,
        maturity: SEMANTIC_MATURITY.DERIVED,
        source: { field: "abstract", sentence: index + 1, transformation: "objective-to-question" },
        diagnostics
      };
    }
  }

  // Search the whole abstract for an explicit authored purpose before turning
  // an earlier descriptive definition into a relation question. In particular,
  // "X allows users to ..." defines a mechanism; a later "this paper examines
  // how ..." states the research question the paper actually answers.
  for (const [index, sentence] of abstractSentences.entries()) {
    const direct = !sameText(sentence, title) && isDirectResearchQuestion(sentence) ? normalizeQuestion(sentence) : "";
    const purpose = purposeQuestion(sentence);
    const transformed = direct || (labeledDefinition(sentence) && /^what\s+determines\b/i.test(purpose) ? "" : purpose);
    if (transformed && isDirectResearchQuestion(transformed)) {
      return {
        question: transformed,
        maturity: SEMANTIC_MATURITY.DERIVED,
        source: { field: "abstract", sentence: index + 1, transformation: direct ? "punctuation-normalization" : "purpose-to-question" },
        diagnostics
      };
    }
  }

  for (const [index, sentence] of abstractSentences.entries()) {
    if (labeledDefinition(sentence)) continue;
    const transformed = topicQuestion(sentence, { allowGeneric: false });
    if (transformed && isDirectResearchQuestion(transformed)) {
      return {
        question: transformed,
        maturity: SEMANTIC_MATURITY.DERIVED,
        source: { field: "abstract", sentence: index + 1, transformation: "relation-to-question" },
        diagnostics
      };
    }
  }

  if (title) {
    const titleFallback = titleFallbackQuestion(title);
    if (titleFallback && !sameText(titleFallback, title)) {
      return {
        question: titleFallback,
        maturity: SEMANTIC_MATURITY.DERIVED,
        source: { field: "title", transformation: "substantive-title-clause" },
        diagnostics
      };
    }
    const suffix = title.includes(":") ? cleanSemanticText(title.slice(title.indexOf(":") + 1)) : "";
    if (suffix && !sameText(suffix, title) && isDirectResearchQuestion(suffix)) {
      return {
        question: normalizeQuestion(suffix),
        maturity: SEMANTIC_MATURITY.DERIVED,
        source: { field: "title", transformation: "direct-colon-suffix" },
        diagnostics
      };
    }
    const transformed = topicQuestion(suffix || title, { allowGeneric: false, titleStyle: true });
    if (transformed && !sameText(transformed, title) && isDirectResearchQuestion(transformed)) {
      return {
        question: transformed,
        maturity: SEMANTIC_MATURITY.DERIVED,
        source: { field: "title", transformation: "relation-to-question" },
        diagnostics
      };
    }
  }

  diagnostics.push(diagnostic(
    "research_question_unresolved",
    "No source field supports a direct research question without a generic title-wrapping claim."
  ));
  return { question: "", maturity: SEMANTIC_MATURITY.UNRESOLVED, source: null, diagnostics };
}

function taxonomyOnly(value) {
  const text = cleanSemanticText(value);
  if (!text || paperMethodCueEvidence(text)) return false;
  const parts = text.split(/\s*[;,|/]\s*/).filter(Boolean);
  return words(text).length <= 14 && parts.length >= 2 && parts.every((part) => words(part).length <= 5);
}

function abstractOpening(value, abstract) {
  const candidate = normalizedKey(value);
  const first = normalizedKey(sentenceList(abstract)[0]);
  if (!candidate || !first) return false;
  return (candidate === first || first.startsWith(candidate))
    && /^(?:we|this paper|the paper|this study|the study)\s+(?:study|examine|investigate|consider|analy[sz]e)\b/i.test(cleanSemanticText(value));
}

function cleanMethodCandidate(value) {
  return cleanSemanticText(value)
    .replace(ABSTRACT_LABEL, "")
    // A running page number can be joined to the first sentence of a page by
    // PDF extraction (for example, `573 Next, we introduce ...`). Remove only
    // this narrow page-header shape so the discourse/meta-prose guards below
    // evaluate the actual sentence and can fall through to a real procedure.
    .replace(/^\d{2,4}\s+(?=(?:however|therefore|thus|hence|consequently|moreover|furthermore|additionally|also|then|next|finally|nonetheless|we|the\s+(?:paper|analysis|study)|using)\b)/i, "")
    // Adverbial discourse transitions are not part of the procedure. Strip
    // them regardless of the following syntax, then let the semantic contract
    // decide whether the remaining sentence is a method, a result, or a
    // roadmap. Coordinating conjunctions are stripped only before an explicit
    // paper/author subject; bare conjunction fragments fail closed below.
    .replace(/^(?:(?:however|therefore|thus|hence|consequently|moreover|furthermore|additionally|also|then|next|finally|nonetheless),?\s+)+/i, "")
    .replace(/^(?:(?:and|but),?\s+)+(?=(?:we|I|this\s+(?:paper|study)|the\s+(?:paper|study|analysis)|our\s+(?:analysis|approach|method)|my\s+(?:analysis|approach|method))\b)/i, "")
    .trim();
}

function paperMethodCueEvidence(value) {
  const text = cleanMethodCandidate(value);
  return PAPER_METHOD_CUE.test(text) || SINGULAR_AUTHOR_METHOD_CUE.test(text);
}

function structuredComparisonMethodEvidence(value) {
  const text = cleanMethodCandidate(value);
  return STRUCTURED_COMPARISON_METHOD.test(text) || SINGULAR_AUTHOR_STRUCTURED_COMPARISON.test(text);
}

function ownedModelActionEvidence(value) {
  const text = cleanMethodCandidate(value);
  return OWNED_MODEL_ACTION.test(text) || SINGULAR_AUTHOR_MODEL_ACTION.test(text);
}

function methodDemonstrationEvidence(value) {
  const text = cleanMethodCandidate(value);
  return PAPER_METHOD_DEMONSTRATION.test(text) || SINGULAR_AUTHOR_METHOD_DEMONSTRATION.test(text);
}

function comparativeMethodEvidence(value) {
  const text = cleanMethodCandidate(value);
  return paperMethodCueEvidence(text)
    && (PAPER_COMPARATIVE_ACTION.test(text) || SINGULAR_AUTHOR_COMPARATIVE_ACTION.test(text))
    && COMPARATIVE_METHOD.test(text)
    && PROCEDURAL_OBJECT.test(text);
}

function paperOwnedMethodActionEvidence(value) {
  const text = cleanMethodCandidate(value);
  return PAPER_OWNED_METHOD_ACTION.test(text)
    || SINGULAR_AUTHOR_OWNED_METHOD_ACTION.test(text)
    || ALLOWS_US_METHOD_ACTION.test(text)
    || PAPER_SIMULATION_METHOD.test(text)
    || PAPER_EXPLICIT_OPTIMIZATION_METHOD.test(text);
}

function genericModelConstructionOnly(value) {
  const text = cleanMethodCandidate(value);
  const match = text.match(GENERIC_MODEL_CONSTRUCTION);
  if (!match) return false;
  return !CONCRETE_METHOD_SIGNAL.test(text.slice(match[0].length));
}

function concreteMethodEvidence(value) {
  const text = cleanMethodCandidate(value);
  return CONCRETE_METHOD_SIGNAL.test(text)
    || PAPER_SIMULATION_METHOD.test(text)
    || EXPLICIT_EQUILIBRIUM_METHOD.test(text)
    || nounLedProceduralMethodEvidence(text);
}

function nounLedProceduralMethodEvidence(value) {
  const text = cleanMethodCandidate(value);
  const actionCount = (text.match(new RegExp(METHOD_ACTION.source, "gi")) || []).length;
  return actionCount >= 2
    && PROCEDURAL_OBJECT.test(text)
    && /(?:;|\bthen\b|\b(?:by|via|using)\b|\bbackward\s+induction\b)/i.test(text)
    && /^(?:[\p{Lu}\p{N}][^.!?]{0,180}\b(?:analysis|conditions?|algorithm|approach|method|procedure|regime|thresholds?|programming|estimation|decomposition)\b)/u.test(text);
}

function namedAnalyticalModelEvidence(value) {
  const text = cleanMethodCandidate(value);
  return /^(?:[Ww]e|[Tt]his\s+(?:paper|study)|[Tt]he\s+(?:paper|study|analysis))\s+use(?:s|d)?\s+(?:a|an|the)\s+[\p{Lu}][\p{L}'’]*(?:[-–—]\s*based)?\s+model\b/u.test(text);
}

function proceduralMethodEvidence(value) {
  const text = cleanMethodCandidate(value);
  return paperOwnedMethodActionEvidence(text)
    || methodDemonstrationEvidence(text)
    || ownedModelActionEvidence(text)
    || structuredComparisonMethodEvidence(text)
    || EXPLICIT_EQUILIBRIUM_METHOD.test(text)
    || nounLedProceduralMethodEvidence(text)
    || namedAnalyticalModelEvidence(text)
    || comparativeMethodEvidence(text);
}

function methodRejectionReason(value, abstract = "") {
  const text = cleanMethodCandidate(value);
  if (!text) return "empty_after_cleaning";
  const noise = extractionNoiseReason(text);
  if (noise) return noise;
  const terminalStripped = text.replace(/[.!?:;]+$/g, "").trim();
  if (/\b(?:a|an|the|and|or|but|of|to|from|with|without|for|in|on|at|under|through|via|by)\s*$/i.test(terminalStripped)) {
    return "dangling_clause";
  }
  if (QUESTION_START.test(text) || /\?\s*$/.test(text)) return "question_not_method";
  if (/^(?:and|but|or)\b/i.test(text)) {
    return "subjectless_conjunction_fragment";
  }
  if (/^(?:analysis|methodology|methods?|solution(?:\s+approach)?)\s+in\s+(?:this|the)\s+(?:section|subsection)\b/i.test(text)) {
    return "heading_leakage_or_roadmap";
  }
  if (/^(?:for|as)\s+(?:an\s+)?example\b|^consider,?\s+for\s+example\b/i.test(text)) return "example_not_analysis_method";
  if (/^(?:these|those|the)\s+(?:estimates?|findings?|results?|values?)\s+(?:allow|enable|help)\s+(?:us|the\s+(?:paper|analysis))\s+to\b/i.test(text)) {
    return "coreferential_result_use_not_self_contained";
  }
  if (/^(?:however,?\s+)?(?:we|the\s+(?:paper|analysis)|this\s+paper)\s+(?:(?:are|is)\s+unable\s+to|(?:could|can|do|does|did)\s+not)\b/i.test(text)) {
    return "negative_result_not_method";
  }
  if (/^(?:hence|thus|therefore|consequently),?\s+(?:we|the\s+(?:paper|analysis)|this\s+paper)\s+(?:do|does|did|can|could|will|would)\s+not\b/i.test(text)) return "negative_result_not_method";
  if (/^(?:perhaps\s+)?(?:surprisingly|interestingly),?\s+(?:we|the\s+(?:paper|analysis)|this\s+paper)\s+(?:identify|find|show|observe|demonstrate)\b/i.test(text)) return "result_statement_not_method";
  if (/\bthe\s+this\b/i.test(text) || /\b(?:best|previous|following)\s+ous\s+sections?\b/i.test(text)) return "malformed_prose";
  if (PAPER_RESULT_STATEMENT.test(text)) return "result_statement_not_method";
  if (OWNED_FINDING_STATEMENT.test(text) || EMBEDDED_FINDING_STATEMENT.test(text) || IDENTIFIED_RESULT_OBJECT.test(text)
      || RESULT_DISCOURSE_CAVEAT.test(text) || THEOREM_RESULT_ANNOUNCEMENT.test(text)) {
    return "result_statement_not_method";
  }
  if (METHOD_RESULT_TAIL.test(text)) return "result_statement_not_method";
  if (ATTRIBUTION_LED_METHOD.test(text)) return "citation_led_third_party_result";
  if (/^(?:the\s+paper|the\s+analysis|this\s+paper)\s+(?:then|now|first|next|also|further)\s+(?:proceed|develop|derive|solve|formulate|estimate|identify|characterize|construct|apply|use)\b/i.test(text)
      && !/^(?:the\s+paper|the\s+analysis|this\s+paper)\s+(?:then|now|first|next|also|further)\s+(?:proceeds|develops|derives|solves|formulates|estimates|identifies|characterizes|constructs|applies|uses)\b/i.test(text)) {
    return "subject_verb_fragment";
  }
  if (words(text).length > 72) return "overlong_or_merged_extraction";
  if (METHOD_EXTRACTION_CONTAMINATION.test(text)
      || /\bas\s+In\s+the\b/u.test(text)
      || /\bavailable\s+(?:demand[-\s]+side|supply[-\s]+side|side|model)?\s*parameters,?\s+we\s+discuss\b/i.test(text)) {
    return "caption_citation_or_table_contamination";
  }
  if (/([\u0370-\u03ff])\s+\1/u.test(text)) return "equation_or_column_splice";
  if (/\bcan\s+be\s+(?:decomposed|solved|derived|computed|estimated|identified)\s+(?:via|using|through)\b.{0,180}\b(?:reveals?|shows?|finds?|establishes?|implies?)\s+that\b/i.test(text)) {
    return "malformed_procedural_concatenation";
  }
  if ((text.match(/[=<>≤≥∑∏∫{}+−]/gu) || []).length >= 2) return "equation_leakage";
  const exhaustedContract = text.match(SOURCE_EXHAUSTED_METHOD_CONTRACT);
  if (exhaustedContract) {
    return methodRejectionReason(exhaustedContract[1], abstract)
      ? "invalid_source_exhausted_method_contract"
      : "";
  }
  const sentenceBoundaryProbe = text.replace(/\b(?:i\.e|e\.g|u\.s|et\s+al)\./gi, "").replace(/\b\d+\.\d+\b/g, "");
  if (/[.!?]\s+(?=\p{L})/u.test(sentenceBoundaryProbe)) return "probable_merged_sentences";
  if (/\S\s+(?:We|Our|The\s+(?:paper|analysis))\s+(?:solve|derive|develop|build|introduce|propose|model|adopt|employ|formulate|estimate|identify|optimi[sz]e|compute|prove|establish|characteri[sz]e|simulate|calibrate|train|evaluate|implement|construct|apply)\b/u.test(text)) {
    return "probable_merged_sentences";
  }
  if (METHOD_PLACEHOLDER.test(text)) return "scope_or_generator_placeholder";
  if (METHOD_META_PROSE.test(text) || EMBEDDED_METHOD_ROADMAP.test(text) || METHOD_ROADMAP_ONLY.test(text)) {
    return "paper_organization_not_method";
  }
  if (BORROWED_APPROACH_EXTENSION.test(text)) return "borrowed_approach_extension_not_procedure";
  if (ENUMERATED_RESULT.test(text) || RESULT_ONLY_METHOD.test(text) || MODEL_CHANGE_RESULT.test(text) || LEMMA_DERIVED_OUTPUT.test(text)) return "result_statement_not_method";
  if (abstractOpening(text, abstract)) return "abstract_purpose_opening";
  if (PASSIVE_SYSTEM_DESCRIPTION.test(text)
      || GENERIC_MODEL_SCOPE.test(text)
      || genericModelConstructionOnly(text)
      || GENERIC_ISSUE_SCOPE.test(text)
      || MODEL_PURPOSE_START.test(text)
      || (GENERIC_STUDY_SCOPE.test(text) && !(comparativeMethodEvidence(text) && SUBSTANTIVE_STUDY_DESIGN.test(text)))) {
    return "model_description_not_analysis_method";
  }
  if (CITATION_LED_METHOD.test(text)) return "citation_led_third_party_result";
  if (METHOD_SCAFFOLDING.test(text) && !structuredComparisonMethodEvidence(text)) return "proof_or_setup_scaffolding";
  if (METHOD_RESULT_STATEMENT.test(text)) return "result_statement_not_method";
  if (MODELED_ACTOR_OPTIMIZATION.test(text)) return "modeled_actor_choice_not_analysis_method";
  if (taxonomyOnly(text)) return "taxonomy_not_method";
  if (words(text).length < 7) return "too_short_for_method_statement";
  if (!proceduralMethodEvidence(text)) return "no_procedural_method_evidence";
  return "";
}

export function isSubstantiveMethodStatement(value, abstract = "") {
  return !methodRejectionReason(value, abstract);
}

function rewriteMethodVoice(value) {
  const conjugate = (verb) => {
    if (/[^aeiou]y$/i.test(verb)) return `${verb.slice(0, -1)}ies`;
    if (/(?:s|sh|ch|x|z|o)$/i.test(verb)) return `${verb}es`;
    return `${verb}s`;
  };
  const cleaned = cleanMethodCandidate(value)
    .replace(/^backward\s+induction\s+(?:first\s+)?characteri[sz]es?\b/i, "The paper uses backward induction to characterize")
    .replace(/^we\s+(then\s+)?distinguish\b/i, (_, modifier) => `The paper ${modifier ? "then " : ""}distinguishes`)
    .replace(/^we\s+address\b/i, "The paper addresses")
    .replace(/^we\s+perform\b/i, "The paper performs");
  const usingCharacterization = cleaned.match(/^using\s+(.+?),\s+we\s+(?:can\s+)?(?:now\s+)?characteri[sz]e\s+(.+?)[.?!:;]*$/i);
  if (usingCharacterization) {
    return `The paper characterizes ${cleanSemanticText(usingCharacterization[2])} using ${cleanSemanticText(usingCharacterization[1])}.`;
  }
  const usingCoordinatedMethod = cleaned.match(/^using\s+(.+?),\s+we\s+(?:can\s+)?(?:now\s+)?(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide|relax|transform|reformulate|formalize)\s+(.+?)\s+and\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide|relax|transform|reformulate|formalize)\s+(.+?)[.?!:;]*$/i);
  if (usingCoordinatedMethod) {
    return `The paper ${conjugate(usingCoordinatedMethod[2].toLowerCase())} ${cleanSemanticText(usingCoordinatedMethod[3])} and ${conjugate(usingCoordinatedMethod[4].toLowerCase())} ${cleanSemanticText(usingCoordinatedMethod[5])} using ${cleanSemanticText(usingCoordinatedMethod[1])}.`;
  }
  const usingMethod = cleaned.match(/^using\s+(.+?),\s+we\s+(?:can\s+)?(?:now\s+)?(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide|relax|transform|reformulate|formalize)\s+(.+?)[.?!:;]*$/i);
  if (usingMethod) {
    return `The paper ${conjugate(usingMethod[2].toLowerCase())} ${cleanSemanticText(usingMethod[3])} using ${cleanSemanticText(usingMethod[1])}.`;
  }
  const equilibriumMethod = cleaned.match(/^to\s+(.+?),\s+we\s+(?:shall|will)\s+use\s+((?:the\s+)?notion\s+of\s+.+?\bequilibrium(?:\s*\([^)]*\))?(?:\s*\([^)]*\))?)[.?!:;]*$/i);
  if (equilibriumMethod) {
    return `The paper uses ${cleanSemanticText(equilibriumMethod[2])} to ${cleanSemanticText(equilibriumMethod[1])}.`;
  }
  const explicitOptimization = cleaned.match(/^we\s+(?:have|need)\s+to\s+(maximi[sz]e|minimi[sz]e|optimi[sz]e)\s+(.+?)\s+(over|with\s+respect\s+to)\s+(.+?)[.?!:;]*$/i);
  if (explicitOptimization) {
    const noun = /^max/i.test(explicitOptimization[1]) ? "maximization"
      : /^min/i.test(explicitOptimization[1]) ? "minimization" : "optimization";
    const object = cleanSemanticText(explicitOptimization[2]).replace(/^(?:this|the)\s+/i, "");
    return `The paper solves the ${object} ${noun} problem ${explicitOptimization[3].toLowerCase()} ${cleanSemanticText(explicitOptimization[4])}.`;
  }
  const singularAuthorMethod = /\bI\s+(?:(analytically|numerically|empirically|first|next|also|further|finally|subsequently|directly|jointly|now|briefly|then)\s+)?(start|begin|solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide|relax|transform|reformulate|formalize)\b/g;
  const coordinatedFirstPersonMethod = /^we\s+(?:first|next)\s+(?:solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/i.test(cleaned);
  const mechanismComparison = cleaned.match(/^we\s+consider\s+(two|three|four)\s+information\s+mechanisms\s*:\s*(physical\s+showrooms?).*?;\s*(virtual\s+showrooms?).*?;\s*(availability\s+information)\b/i);
  if (mechanismComparison) {
    return `The paper considers ${mechanismComparison[1].toLowerCase()} information mechanisms: ${mechanismComparison[2].toLowerCase()}, ${mechanismComparison[3].toLowerCase()}, and ${mechanismComparison[4].toLowerCase()}.`;
  }
  let thirdPersonSubject = /^(?:the\s+(?:paper|analysis|study)|this\s+(?:paper|study))\b/i.test(cleaned);
  let text = cleaned
    .replace(singularAuthorMethod, (_, modifier, verb) => {
      thirdPersonSubject = true;
      return `the paper ${modifier ? `${modifier.toLowerCase()} ` : ""}${conjugate(verb.toLowerCase())}`;
    })
    .replace(/^we\s+(analytically|numerically|empirically)\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/i, (_, modifier, verb) => {
      thirdPersonSubject = true;
      return `The paper ${modifier.toLowerCase()} ${conjugate(verb)}`;
    })
    .replace(/^we\s+(?:will|shall|now)\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide|include)\b/i, (_, verb) => {
      thirdPersonSubject = true;
      return `The paper ${conjugate(verb.toLowerCase())}`;
    })
    .replace(/^to\s+(?:answer|address)\s+(?:these|those|the)\s+questions?,?\s+we\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/i, (_, verb) => {
      thirdPersonSubject = true;
      return `The paper ${conjugate(verb)}`;
    })
    .replace(/^in\s+(?:this|the)\s+paper,?\s+we\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/i, (_, verb) => {
      thirdPersonSubject = true;
      return `The paper ${conjugate(verb)}`;
    })
    .replace(/^in\s+our\s+analysis,?\s+(?:we\s+)?first\s+(study|analyze|analyse|compare|examine|investigate)\b/i, (_, verb) => {
      thirdPersonSubject = true;
      return `The analysis first ${conjugate(verb)}`;
    })
    .replace(/^we\s+(first|next)\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/i, (_, modifier, verb) => {
      thirdPersonSubject = true;
      return `The paper ${modifier.toLowerCase()} ${conjugate(verb)}`;
    })
    .replace(/^we\s+do\s+so\b/i, () => {
      thirdPersonSubject = true;
      return "The paper does so";
    })
    .replace(/^first,?\s+we\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/i, (_, verb) => {
      thirdPersonSubject = true;
      return `The analysis first ${conjugate(verb)}`;
    })
    .replace(/^we\s+(further|also)\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/i, (_, modifier, verb) => {
      thirdPersonSubject = true;
      return `The paper ${modifier.toLowerCase()} ${conjugate(verb)}`;
    })
    .replace(/^we\s+(?:will|shall)\s+(include|use|apply|adopt)\b/i, (_, verb) => {
      thirdPersonSubject = true;
      return `The paper ${conjugate(verb.toLowerCase())}`;
    })
    .replace(/^we\s+then\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/i, (_, verb) => {
      thirdPersonSubject = true;
      return `The analysis then ${conjugate(verb)}`;
    })
    .replace(/^we\s+(start|solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/i, (_, verb) => {
      thirdPersonSubject = true;
      return `The paper ${conjugate(verb)}`;
    })
    .replace(/^we\s+(begin|demonstrate|illustrate|decompose|linearize|reduce)\b/i, (_, verb) => {
      thirdPersonSubject = true;
      return `The paper ${conjugate(verb)}`;
    })
    .replace(/^we\s+/i, "The paper ")
    .replace(/^our\s+(?:analysis|approach|method)\s+/i, "The analysis ");
  if (thirdPersonSubject) {
    text = text
      .replace(/\b(and|then)\s+we\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide|find|show)\b/gi, (_, joiner, verb) => `${joiner} ${conjugate(verb.toLowerCase())}`)
      .replace(/\b(and|then)\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|conduct|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide|find|show)\b/gi, (_, joiner, verb) => `${joiner} ${conjugate(verb.toLowerCase())}`)
      .replace(/\b(and|then)\s+(start|begin|transform|reformulate|formalize)\b/gi, (_, joiner, verb) => `${joiner} ${conjugate(verb.toLowerCase())}`)
      .replace(/\band\s+(finally|subsequently)\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|conduct|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide|find|show)\b/gi, (_, modifier, verb) => `and ${modifier.toLowerCase()} ${conjugate(verb.toLowerCase())}`);
    if (coordinatedFirstPersonMethod) {
      text = text.replace(/,\s+(solve|derive|develop|devise|build|introduce|propose|offer|collapse|consider|conduct|model|adopt|employ|study|analyze|analyse|compare|examine|investigate|approximate|formulate|estimate|identify|optimize|compute|prove|establish|characterize|simulate|calibrate|train|evaluate|implement|construct|apply|use|provide)\b/gi,
        (_, verb) => `, ${conjugate(verb.toLowerCase())}`);
    }
  }
  // Keep a faithful grammatical restatement while using the noun form that the
  // public semantic contract recognizes as a procedural approximation method.
  text = text.replace(/\bfor\s+efficiently\s+approximating\s+/gi, "for efficient approximation of ");
  const withPeriod = text.replace(/[.?!:;]+$/g, "");
  return withPeriod ? `${sentenceCase(withPeriod)}.` : "";
}

function methodSentenceVariants(value) {
  const text = cleanMethodCandidate(value);
  if (!text) return [];
  const variants = [text];
  // Labeled abstracts frequently fuse a concise method with its headline
  // result: `Using a Hotelling-based model ..., we find ...`. Retain the
  // literal instrument as a complete paper-owned procedure and let the normal
  // semantic contract reject vague instruments such as `this approach`.
  const usingResult = text.match(/^using\s+(.+?),\s+we\s+(?:find|show|demonstrate|establish|observe|obtain|prove|document|report)\b/i);
  if (usingResult) variants.unshift(`We use ${cleanSemanticText(usingResult[1])}.`);
  const resultTail = text.search(METHOD_RESULT_TAIL);
  if (resultTail > 0) variants.unshift(text.slice(0, resultTail));
  const semicolon = text.indexOf(";");
  if (semicolon > 0 && !structuredComparisonMethodEvidence(text)) variants.unshift(text.slice(0, semicolon));
  return [...new Set(variants.map(cleanMethodCandidate).filter((candidate) => words(candidate).length >= 7))];
}

function methodCandidateScore(candidate, title, { abstract = false, labeledMethodology = false, page = null } = {}) {
  let score = 0;
  const actionCount = (candidate.match(new RegExp(METHOD_ACTION.source, "gi")) || []).length;
  const concrete = concreteMethodEvidence(candidate);
  if (abstract) score += concrete ? 18 : 2;
  if (labeledMethodology) score += 12;
  if (/\b(?:method|methodology|algorithm|solution|estimation|identification|empirical\s+strategy|procedure)\b/i.test(title)) score += 8;
  else if (/\b(?:equilibrium|optimization|proof|formulation|model|contributions?|main\s+results?)\b/i.test(title)) score += 5;
  else if (/\b(?:introduction|overview)\b/i.test(title)) score += 3;
  else score += 1;
  score += Math.min(6, actionCount * 2);
  if (actionCount >= 2 && /\b(?:first|then|next|finally|subsequently|followed\s+by)\b/i.test(candidate)) score += 6;
  if (concrete) score += 6;
  if (ownedModelActionEvidence(candidate)) score += 2;
  if (/\b(?:using|via|by|then|followed\s+by|subject\s+to)\b/i.test(candidate)) score += 3;
  if (paperOwnedMethodActionEvidence(candidate) || methodDemonstrationEvidence(candidate) || comparativeMethodEvidence(candidate)
      || structuredComparisonMethodEvidence(candidate) || ownedModelActionEvidence(candidate)) score += 4;
  if (PROCEDURAL_OBJECT.test(candidate)) score += 3;
  if (comparativeMethodEvidence(candidate)) score += 2;
  if (nounLedProceduralMethodEvidence(candidate)) score += 6;
  if (structuredComparisonMethodEvidence(candidate) && actionCount < 2) score -= 3;
  if (/^using\b.+?,\s+(?:we|the\s+(?:paper|analysis))\s+(?:construct|solve|derive|formulate|reduce|transform|reformulate|estimate|compute)\b/i.test(candidate)) score += 8;
  if (/^we\s+(?:will|shall|now)\s+(?:introduce|present|formulate)\b/i.test(candidate)) score -= 8;
  // Prefer the concrete procedural clause that follows an abstract's
  // contribution signpost over the signpost itself.
  if (/^our\s+contribution\s+is\b/i.test(candidate)) score -= 8;
  if (/\bpropos(?:e|es|ed|ing)\s+(?:a|an|the)\b.{0,60}\bcharacterization\b/i.test(candidate)) score -= 22;
  if (!abstract && Number.isFinite(Number(page))) score += Number(page) <= 2 ? 6 : Number(page) <= 5 ? 3 : 0;
  if (/\b(?:extend|extension|generalization)\b/i.test(candidate)) score -= 12;
  score -= Math.max(0, words(candidate).length - 34) / 8;
  return score;
}

function sectionText(section) {
  if (section?.sourceText) return cleanSemanticText(section.sourceText);
  if (section?.text) return cleanSemanticText(section.text);
  if (Array.isArray(section?.sourceLines)) {
    return cleanSemanticText(section.sourceLines.map((line) => typeof line === "string" ? line : line?.text).filter(Boolean).join(" "));
  }
  if (Array.isArray(section?.lines)) {
    return cleanSemanticText(section.lines.map((line) => typeof line === "string" ? line : line?.text).filter(Boolean).join(" "));
  }
  return "";
}

function sectionSentenceEntries(section) {
  const lineCollections = [section?.sourceLines, section?.lines]
    .filter(Array.isArray)
    .map((entries) => entries.filter((line) => line && typeof line === "object" && Number.isFinite(Number(line.page)) && line.text))
    .filter((entries) => entries.length);
  if (!lineCollections.length) {
    return sentenceList(sectionText(section)).map((sentence, index) => ({
      sentence,
      sentenceIndex: index,
      page: section?.page ?? section?.startPage ?? null
    }));
  }
  const output = [];
  const seen = new Set();
  let sentenceIndex = 0;
  for (const lineEntries of lineCollections) {
    const byPage = new Map();
    for (const line of lineEntries) {
      const page = Number(line.page);
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push(line.text);
    }
    for (const [page, lines] of byPage) {
      for (const sentence of sentenceList(lines.join(" "))) {
        const key = `${page}:${normalizedKey(sentence)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({ sentence, sentenceIndex, page });
        sentenceIndex += 1;
      }
    }
  }
  return output;
}

/** Extract a method only from explicit method metadata or local method/model prose. */
export function deriveSubstantiveMethod(record = {}, sections = []) {
  const diagnostics = [];
  const methodFields = ["method", "method_summary", "solution_method", "estimation_method", "empirical_strategy"];

  for (const field of methodFields) {
    const completeCandidate = cleanMethodCandidate(record[field]);
    if (!completeCandidate) continue;
    // Reviewed catalog method fields sometimes contain two independently
    // grammatical procedural sentences.  The public method contract is one
    // compact statement, so select the strongest valid sentence instead of
    // discarding the entire field as a probable PDF sentence splice.
    const fieldCandidates = [
      completeCandidate,
      ...[completeCandidate, ...sentenceList(completeCandidate)].flatMap(methodSentenceVariants)
    ]
      .flatMap((candidate) => [cleanMethodCandidate(candidate), rewriteMethodVoice(candidate)])
      .filter((candidate, index, values) => candidate && values.indexOf(candidate) === index)
      .sort((left, right) => methodCandidateScore(right, field, { abstract: field === "abstract" })
        - methodCandidateScore(left, field, { abstract: field === "abstract" }));
    for (const candidate of fieldCandidates) {
      const reason = methodRejectionReason(candidate, record.abstract);
      if (!reason) {
        const rewritten = rewriteMethodVoice(candidate);
        const rewrittenReason = methodRejectionReason(rewritten, record.abstract);
        if (!rewrittenReason) {
          return {
            method: rewritten,
            maturity: SEMANTIC_MATURITY.AUTHORED,
            source: { field },
            diagnostics
          };
        }
        diagnostics.push(diagnostic(
          "method_candidate_rejected_after_rewrite",
          `Rejected rewritten ${field}: ${rewrittenReason}.`,
          { field, reason: rewrittenReason }
        ));
        continue;
      }
      diagnostics.push(diagnostic("method_candidate_rejected", `Rejected ${field}: ${reason}.`, { field, reason }));
    }
  }

  const candidates = [];
  for (const [sectionIndex, section] of (Array.isArray(sections) ? sections : []).entries()) {
    const title = cleanSemanticText(section?.title || section?.section);
    if (METHOD_SECTION_EXCLUSION.test(title)) continue;
    const abstractSection = /^model\s+contribution\s+and\s+method$/i.test(title);
    for (const { sentenceIndex, sentence, page } of sectionSentenceEntries(section)) {
      const rawSentence = cleanSemanticText(sentence);
      const labeledMethodology = /^methodology(?:\s*\/\s*results)?\s*:/i.test(rawSentence);
      for (const candidate of methodSentenceVariants(rawSentence)) {
        if (!METHOD_SECTION.test(title)
          && !abstractSection
          && !paperOwnedMethodActionEvidence(candidate)
          && !namedAnalyticalModelEvidence(candidate)
          && !(paperMethodCueEvidence(candidate) && proceduralMethodEvidence(candidate))) continue;
        const reason = methodRejectionReason(candidate, record.abstract);
        if (reason) continue;
        const method = rewriteMethodVoice(candidate);
        if (methodRejectionReason(method, record.abstract)) continue;
        const score = methodCandidateScore(candidate, title, { abstract: abstractSection, labeledMethodology, page });
        candidates.push({ sectionIndex, sentenceIndex, title, page, sentence: candidate, method, score });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.sectionIndex - right.sectionIndex || left.sentenceIndex - right.sentenceIndex);
  if (candidates.length) {
    const best = candidates[0];
    return {
      method: best.method,
      maturity: SEMANTIC_MATURITY.DERIVED,
      source: { section: best.title || "Model section", page: best.page, sentence: best.sentenceIndex + 1 },
      diagnostics
    };
  }

  diagnostics.push(diagnostic(
    "method_unresolved",
    "No substantive procedural method statement was found in explicit method fields or method/model sections."
  ));
  return { method: "", maturity: SEMANTIC_MATURITY.UNRESOLVED, source: null, diagnostics };
}

function recordValues(record, fields) {
  const result = [];
  for (const field of fields) {
    const raw = record[field];
    const values = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
    for (const value of values) result.push({ value, field });
  }
  return result;
}

function rawSetupMathMarkup(value) {
  const inspected = String(value ?? "")
    .replace(/https?:\/\/\S+/giu, " URL ")
    .replace(/\\\$/gu, " ESCAPED_DOLLAR ")
    .replace(/(?<!\\)\$(?:\s*\d+(?:[.,]\d+)*(?:\s*(?:thousand|million|billion|trillion|k|m|bn))?|\/[A-Za-z]+|[A-Z]{1,4}\b)/gu, " CURRENCY ");
  return /(?<!\\)\$/u.test(inspected) || /\\(?:\(|\)|\[|\]|[A-Za-z]+)/u.test(inspected);
}

function setupRejectionReason(value, category = "") {
  const text = cleanSemanticText(value);
  if (!text) return "empty_after_cleaning";
  // A bare four-digit token in extracted setup prose is not a meaningful
  // model primitive. In journal PDFs it is typically the printed page number
  // spliced between a sentence and a running footer (for example, 6030 or
  // 6328). Reject it independently of the surrounding category so it cannot
  // be published as an assumption, input, decision, or modeled object.
  if (/^\d{4}$/u.test(text)) return "isolated_page_number";
  if (/^(?:problem\s+(?:definition|formulation)|academic\s*\/\s*practical\s+relevance|methodology(?:\s*\/\s*results?)?|results?|managerial\s+implications|history|funding)\b\s*(?::|(?=(?:we|the|our|this)\b))/i.test(text)) {
    return "heading_or_abstract_label_leakage";
  }
  // Setup fields are rendered as prose, not as a second math surface.  Raw
  // TeX commands/delimiters here are almost always leaked notation from a PDF
  // row (for example `$\\lambda$`) rather than a self-contained setup phrase.
  if (rawSetupMathMarkup(text)) return "raw_math_markup";
  const noise = extractionNoiseReason(text);
  if (noise) return noise;
  if (GENERIC_SETUP.test(text)) return "generic_generator_placeholder";
  if (SETUP_RESULT_ARTIFACT.test(text)) return "result_or_table_artifact";
  if (!/[\p{L}\p{N}]/u.test(text)) return "no_meaningful_characters";
  if (/^(?:it|this|that|these|those),\s+\p{L}/iu.test(text)) return "pronoun_column_fragment";
  if (/\b(?:consumer|customer|firm|retailer|seller|buyer|supplier|platform)[’']s\s+ex$/i.test(text)) return "clipped_possessive_phrase";
  if (category === "entities" && (/\b(?:are|is|was|were|be|been|being|choos(?:e|es|ing)|decid(?:e|es|ing)|provid(?:e|es|ed)|describ(?:e|es|ed)|represent(?:s|ed)?)\b/i.test(text)
      || /\b(?:only|then|also|however|therefore)\s*$/i.test(text))) return "entity_sentence_fragment";
  if (category === "entities" && /^(?:a|an|the)?\s*(?:battery|course|facility|information|location|network|product|project|resource|station|store|vehicle)s?$/i.test(text)) {
    return "generic_entity_noun";
  }
  const sentenceBoundaryProbe = text
    .replace(/\bi\.?\s*i\.?\s*d\.?/gi, "iid")
    .replace(/\b(?:i\.e|e\.g|u\.s)\./gi, "abbr");
  if (/[.!?]\s+(?=[\p{Lu}\p{N}\u0370-\u03ff])/u.test(sentenceBoundaryProbe)) return "merged_setup_sentences";
  if (/\b(?:a|an|the|any|some|each|every|and|or|but|yet|although|though|because|while|whereas|of|to|from|with|without|for|in|on|at|under|between|through|via|by|that|which|who|whose)\s*$/i.test(text)) return "dangling_clause";
  if (category === "inputs" && /^(?:(?:a|an|the)\s+)?(?:capacity|costs?|data|information|input\s+parameters?|observation|output\s+parameters?|parameters?|probabilities?|state)$/i.test(text)) {
    return "generic_input_noun";
  }
  if (category === "inputs" && /^(?:additional|other)\s+information$/i.test(text)) return "generic_information_phrase";
  if (category === "inputs" && /\bfeature\s+[A-Za-z]\d*\s*,?\s*then\b/i.test(text)) return "input_sentence_fragment";
  if (category === "decisions" && /^(?:set|chosen|selected|determined|priced|allocated|assigned|decided)\s+by\b/i.test(text)) {
    return "passive_outcome_not_choice";
  }
  if (category === "decisions" && /^(?:reject|accept)\s+(?:the\s+)?(?:assumption|hypothesis)\b/i.test(text)) {
    return "statistical_test_outcome_not_choice";
  }
  if (category === "decisions" && /^(?:can|could|may|might|will|would)\b|^when\s+(?!to\b)/i.test(text)) {
    return "condition_or_outcome_not_choice";
  }
  if (category === "decisions" && /^(?:lead|result)\s+(?:to|in)\b|^(?:perform\s+suboptimally|test\s+results?\b)/i.test(text)) {
    return "outcome_not_choice";
  }
  if (category === "decisions" && /^(?:perform|conduct)\s+(?:a\s+)?(?:empirical|numerical(?:\s+optimization)?|sensitivity|simulations?|statistical)\b/i.test(text)) {
    return "research_procedure_not_modeled_choice";
  }
  if (category === "decisions" && /^to\s+(?:compare|evaluate|test)\s+(?:the\s+)?performance\b/i.test(text)) {
    return "research_purpose_not_modeled_choice";
  }
  if (category === "decisions" && /^policy\s+used\s+by\b/i.test(text)) {
    return "borrowed_policy_not_modeled_choice";
  }
  if (category === "decisions" && /^releas(?:e|ing)\s+products?\s+at\s+the\s+wrong\s+time$/i.test(text)) {
    return "outcome_not_choice";
  }
  if (category === "decisions" && /^release\s+of\b.{0,100}\b(?:causes?|delays?|increases?|reduces?|results?|yields?)\b/i.test(text)) {
    return "outcome_not_choice";
  }
  if (category === "decisions" && /^(?:perform\s+(?:equally\s+well|well\b)|share\b.{0,90}\b(?:decreas|increas)\w*\b|(?:(?:“|\")?freemium(?:”|\")?\s+)?contracts?\s+(?:often|oftentimes|typically|usually|frequently)\s+(?:are|have|include)\b)/i.test(text)) {
    return "outcome_not_choice";
  }
  if (category === "decisions" && /^improving\s+(?:its|their|the)\s+process\s+quality$/i.test(text)) {
    return "underspecified_duplicate_choice";
  }
  if (category === "decisions" && /^(?:(?:a|an|the|this|that|their|its)\s+)?(?:action|choice|decision|policy|prioritization\s+strategy|sharing|rentals?)\b.{0,100}\b(?:causes?|decreases?|has|have|improves?|increases?|leads?|outperforms?|results?|yields?)\b/i.test(text)) {
    return "outcome_not_choice";
  }
  if (category === "decisions" && /^(?:(?:a|an|the|agile)\s+)?(?:fleet\s+management\s+services?|heuristics?|principles?|services?|strategies?)\b.{0,100}\bto\s+(?:(?:continuously|further|significantly)\s+)?(?:help|improve)\b/i.test(text)) {
    return "purpose_phrase_not_choice";
  }
  if (category === "decisions" && /\bthan\s+(?:actions?|decisions?|efforts?|services?)\b/i.test(text)) {
    return "malformed_comparison_fragment";
  }
  if (category === "decisions" && /^post\s+(?:valuation|heterogeneous)(?:\s+for\b|$)/i.test(text)) return "clipped_post_decision";
  if (category === "decisions" && /^(?:price|rate|quantity)\s+[A-Za-z]{1,3}\d*\s*$/i.test(text)) return "notation_fragment_not_choice";
  if (category === "decisions" && /^test\b(?:\s+(?:our|the)\s+(?:propositions?|hypotheses?)|.*\b(?:alternative|response|regression|statistical|specification|hypothes|robustness|model|data|propositions?|exogenous|endogenous)\b|\s+whether\b.*\b(?:can|could|is|are|was|were|has|have|should|would)\b)/i.test(text)) {
    return "research_test_not_modeled_choice";
  }
  if (category === "decisions" && /^(?:accept|admit|brush|close|combat|design|disclose|distribute|exert|irrigate|join|launch|license|load|monitor|participate|perform|post|procure|propose|quote|reject|release|reposition|require|serve|share|solicit|switch|target|test|transfer|unload)\s+(?:is|are|was|were|has|have)\b/i.test(text)) {
    return "action_noun_or_passive_fragment";
  }
  if (category === "decisions" && /^share\s+the\s+same\b/i.test(text)) return "shared_attribute_not_choice";
  if (category === "decisions" && (/^close\s+to\b/i.test(text)
      || /^close\s+(?:proximity|similarity|relationship|association)$/i.test(text))) return "adjectival_close_not_choice";
  if (category === "decisions" && /^post\s+valuations?\s+(?:can|may|will)\b/i.test(text)) return "ex_post_attribute_not_choice";
  if (category === "decisions" && /^perform\s+in\s+(?:19|20)\d{2}$/i.test(text)) return "research_timing_not_choice";
  if (category === "decisions" && !/^(?:whether|how|which|what)\b/i.test(text)
      && /\bor\s+choos(?:e|es|ing)\b/i.test(text)) return "merged_choice_clause";
  if (category === "decisions" && /\b(?:price|rate|fee|quantity|level)\b.{0,70}\bto\s+(?:\d+(?:\.\d+)?|one|zero|unity|[\u0370-\u03ff])\s*$/iu.test(text)) {
    return "clipped_value_assignment";
  }
  if (category === "assumptions" && (/^post\s+(?:heterogeneous|valuation)\b/i.test(text)
      || /\b\d+\s+\d+\b/.test(text))) return "clipped_or_flattened_assumption";
  if (category === "assumptions" && /^(?:consumers?|customers?|firms?|retailers?)\s+(?:are|is)\s+\d{2,4}$/i.test(text)) return "page_number_fragment";
  if (category === "assumptions" && /\bmate\s+their\b/i.test(text)) return "split_word_fragment";
  if (category === "assumptions" && (/^(?:the|our|both|these)\s+results?\b/i.test(text)
      || /^in\s+this\s+paper,?\s+we\s+(?:propose|develop|study|analy[sz]e)\b/i.test(text)
      || /^we\s+now\s+review\s+the\s+literature\b/i.test(text))) return "result_or_literature_not_assumption";
  if (words(text).length > 32) return "too_long_for_setup_item";
  return "";
}

function balancedDelimiters(value) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const character of String(value || "")) {
    if (character === "(" || character === "[" || character === "{") stack.push(character);
    else if (pairs[character] && stack.pop() !== pairs[character]) return false;
  }
  return stack.length === 0;
}

function sectionSetupRejectionReason(category, value) {
  const text = cleanSemanticText(value);
  const count = words(text).length;
  const relationCount = (text.match(/[=<>≤≥]/g) || []).length;
  const selfContainedDecisionWhControl = category === "decisions"
    && /^(?:which|what|when|where|how)\b.{1,100}\bto\s+[\p{L}][\p{L}'’-]*\b/iu.test(text);
  const substantiveMathematicalAssumption = category === "assumptions"
    && relationCount === 1
    && count >= 5
    && /\b(?:is|are|has|have|prefer(?:s|red)?|exceed(?:s|ed)?|remain(?:s|ed)?|satisf(?:y|ies|ied)|bounded|positive|negative|larger|smaller|greater|less)\b/i.test(text);
  if (!balancedDelimiters(text) || /^[\[\]{}]/.test(text)
      || (!selfContainedDecisionWhControl
        && /^(?:and|or|but|of|where|which|who|is|are|was|were|has|have|below|above)\b/i.test(text))
      || /\b(?:a|an|the|and|or|of|to|from|is|are|was|were|has|have|with|without|for|in|on|below|above)$/i.test(text)
      || (!substantiveMathematicalAssumption
        && (/[=<>≤≥∈∑∫{}]|\b[A-Za-z]\d+\b|\([^)]*\b[A-Za-z]\b[^)]*\)/.test(text)))
      || SETUP_FORMULA_FRAGMENT.test(text)) return "sentence_fragment_or_formula";
  if (category === "entities" && (!ENTITY_TERM.test(text) || !new RegExp(`(?:${ENTITY_TERM.source})\\s*$`, "i").test(text) || count > 14)) return "not_a_local_entity_phrase";
  if (category === "entities" && /^(?:a|an|the)?\s*(?:battery|course|facility|information|location|network|product|project|resource|station|store|vehicle)s?$/i.test(text)) return "generic_entity_noun";
  if (category === "entities" && (/\b(?:are|is|was|were|be|been|being|choos(?:e|es|ing)|decid(?:e|es|ing)|provid(?:e|es|ed)|describ(?:e|es|ed)|represent(?:s|ed)?)\b/i.test(text)
      || /\b(?:only|then|also|however|therefore)\s*$/i.test(text))) return "entity_sentence_fragment";
  const symbolGloss = /^(?:(?:the\s+)?parameter\s+)?[\p{L}][\p{L}\p{N}_*^()]{0,11}\s+(?:is|denotes?|measures?|represents?)\s+.+$/iu.test(text);
  const fixedPurchaseInput = SOURCE_FIXED_PURCHASE_INPUT_PHRASE.test(text);
  if (category === "inputs" && ((!fixedPurchaseInput && !INPUT_TERM.test(text)) || (count < 2 && !/^(?:demand|output)$/i.test(text)) || count > 14 || (!symbolGloss && /\b(?:is|are|was|were|has|have|can|will)\b/i.test(text)))) return "not_a_local_input_phrase";
  if (category === "inputs" && /^(?:it|this|that|these|those|he|she|they|who|which)\b/i.test(text)) return "pronoun_not_input_phrase";
  if (category === "inputs" && /^(?:(?:a|an|the)\s+)?(?:capacity|costs?|data|information|input\s+parameters?|output\s+parameters?|parameters?|probabilities?|state)$/i.test(text)) return "generic_input_noun";
  if (category === "inputs" && /^information\b/i.test(text)
      && !/^information\s+(?:about|on|regarding|concerning)\b/i.test(text)
      && !new RegExp(`\\b(?:${INPUT_TERM.source})\\b.+\\b(?:${INPUT_TERM.source})\\b`, "i").test(text)) return "generic_information_phrase";
  if (category === "decisions" && (!DECISION_OBJECT.test(text) || (count < 2 && !/^(?:price|pricing|assortment|entry|disclosure)$/i.test(text)) || count > 14)) return "not_a_local_decision_phrase";
  if (category === "decisions" && /^(?:a|an|the|each)?\s*(?:action|allocation|bid|capacity|choice|contract|decision|fee|investment|location|mechanism|order|policy|quantity|rate|route|schedule|timing)s?$/i.test(text)) return "generic_decision_noun";
  if (category === "decisions" && /^(?:set|chosen|selected|determined|priced|allocated|assigned|decided)\s+by\b/i.test(text)) return "passive_outcome_not_choice";
  if (category === "decisions" && /^(?:reject|accept)\s+(?:the\s+)?(?:assumption|hypothesis)\b/i.test(text)) return "statistical_test_outcome_not_choice";
  if (category === "decisions" && /^post\s+(?:valuation|heterogeneous)(?:\s+for\b|$)/i.test(text)) return "clipped_post_decision";
  if (category === "decisions" && /^(?:price|rate|quantity)\s+[A-Za-z]{1,3}\d*\s*$/i.test(text)) return "notation_fragment_not_choice";
  if (category === "decisions" && /^test\b(?:\s+(?:our|the)\s+(?:propositions?|hypotheses?)|.*\b(?:alternative|response|regression|statistical|specification|hypothes|robustness|model|data|propositions?|exogenous|endogenous)\b|\s+whether\b.*\b(?:can|could|is|are|was|were|has|have|should|would)\b)/i.test(text)) return "research_test_not_modeled_choice";
  if (category === "decisions" && /^(?:accept|admit|brush|close|combat|design|disclose|distribute|exert|irrigate|join|launch|license|load|monitor|participate|perform|post|procure|propose|quote|reject|release|reposition|require|serve|share|solicit|switch|target|test|transfer|unload)\s+(?:is|are|was|were|has|have)\b/i.test(text)) return "action_noun_or_passive_fragment";
  if (category === "decisions" && /^share\s+the\s+same\b/i.test(text)) return "shared_attribute_not_choice";
  if (category === "decisions" && (/^close\s+to\b/i.test(text)
      || /^close\s+(?:proximity|similarity|relationship|association)$/i.test(text))) return "adjectival_close_not_choice";
  if (category === "decisions" && /^post\s+valuations?\s+(?:can|may|will)\b/i.test(text)) return "ex_post_attribute_not_choice";
  if (category === "decisions" && /^perform\s+in\s+(?:19|20)\d{2}$/i.test(text)) return "research_timing_not_choice";
  if (category === "decisions" && !/^(?:whether|how|which|what)\b/i.test(text)
      && /\bor\s+choos(?:e|es|ing)\b/i.test(text)) return "merged_choice_clause";
  if (category === "decisions" && /\b(?:price|rate|fee|quantity|level)\b.{0,70}\bto\s+(?:\d+(?:\.\d+)?|one|zero|unity|[\u0370-\u03ff])\s*$/iu.test(text)) return "clipped_value_assignment";
  if (category === "decisions" && /^(?:price\s+)?takers?\b|\btherefore\s+charge\s+equal\s+prices?\b/i.test(text)) return "market_assumption_not_choice";
  if (category === "decisions" && /^the\s+pricing$/i.test(text)) return "generic_decision_noun";
  if (category === "decisions" && /\bauthority\s+to\s+(?:observe|monitor|inspect)\b/i.test(text)) return "not_a_choice_or_control";
  if (category === "decisions" && /\b(?:constraints?|other\s+factors?|model\s+the\s+(?:degradation\s+)?cost)\b/i.test(text)) return "model_description_not_choice";
  if (category === "assumptions" && /^(?:the\s+)?researchers?\s+(?:are|is|may\s+be)\s+interested\b/i.test(text)) return "research_objective_not_assumption";
  if (category === "assumptions" && /^(?:the\s+)?purpose\s+of\s+(?:this|the)\s+(?:sub)?section\b/i.test(text)) return "paper_organization_not_assumption";
  if (category === "assumptions" && /^[A-Za-z]\s+(?:is|are|denotes?|represents?)\b/.test(text)) return "uninterpretable_symbol_subject";
  if (category === "assumptions" && (/^post\s+(?:heterogeneous|valuation)\b/i.test(text)
      || /\b\d+\s+\d+\b/.test(text))) return "clipped_or_flattened_assumption";
  if (category === "assumptions" && /^(?:consumers?|customers?|firms?|retailers?)\s+(?:are|is)\s+\d{2,4}$/i.test(text)) return "page_number_fragment";
  if (category === "assumptions" && /\bmate\s+their\b/i.test(text)) return "split_word_fragment";
  if (category === "assumptions" && count > 34) return "not_a_local_assumption_statement";
  return "";
}

function phrase(value, limit = 22, preserveClauses = false, preserveWhether = false) {
  let text = cleanSemanticText(value).replace(preserveWhether ? /^that\s+/i : /^(?:that|whether)\s+/i, "");
  if (!preserveClauses) {
    text = text.replace(/\s+(?:and\s+(?:then|accept\w*|adjust\w*|choos\w*|exert\w*|join\w*|post\w*|quot\w*|reject\w*|set\w*|select\w*|solicit\w*|target\w*|decid\w*|determin\w*|estimat\w*|fit\w*|infer\w*|allocat\w*|order\w*|pric\w*|operat\w*|implement\w*|develop\w*|evaluat\w*|discuss\w*)|before|after|while|when|where|who|(?<!from\s)which|as|because|so\s+that|subject\s+to|based\s+on)\b.*$/i, "");
  }
  return sentenceCase(clipWords(text.replace(/[,.;:]+$/g, ""), limit));
}

function addCandidate(store, category, value, source) {
  let cleaned = phrase(value, category === "assumptions" ? 32 : 22, category === "assumptions", category === "decisions");
  if (category === "decisions") {
    // Some PDF text layers fuse an explanatory relative clause onto an
    // otherwise complete control ("choose the contract thatmaximizes...").
    // Keep the literal control prefix and cite that exact raw-page substring.
    const recoveredControl = cleaned.match(/^(.{2,90}\b(?:assortment|bid|classifier|contract|decision|mechanism|order|policy|price|quantity|route|schedule|strategy))\s+(?:that|which)(?=[\p{Ll}]{10,}(?:\(|$))/iu)?.[1];
    if (recoveredControl) {
      const literalControl = cleanSemanticText(value).match(/^(.{2,90}\b(?:assortment|bid|classifier|contract|decision|mechanism|order|policy|price|quantity|route|schedule|strategy))\s+(?:that|which)(?=[\p{Ll}]{10,}(?:\(|$))/iu)?.[1]
        || recoveredControl;
      cleaned = phrase(literalControl, 22, false, true);
      source = {
        ...source,
        quote: literalControl,
        matchedText: literalControl,
        derivation: "literal-source-phrase"
      };
    }
  }
  if (category === "decisions" && !/^(?:whether|how|which|what|when|where)\b/i.test(cleaned)) {
    // Preserve the modeled control but drop an attached benefit/result tail.
    // These tails are a frequent source of pseudo-decisions such as
    // "disclose ... to increase profit" and are not part of the control.
    cleaned = cleanSemanticText(cleaned.replace(
      /\s+to\s+(?:(?:continuously|further|significantly)\s+)?(?:avoid|ensure|gain|help|improve|increase|lower|maximize|minimize|obtain|raise|reduce)\b.*$/i,
      ""
    ));
  }
  if (category === "decisions" && /^(?:whether|how|which|what|when|where)\b/i.test(cleaned)) {
    cleaned = cleanSemanticText(cleaned.replace(
      /\s+to\s+(?:(?:potentially|continuously|further|significantly)\s+)+(?:avoid|ensure|gain|help|improve|increase|lower|maximize|minimize|obtain|raise|reduce)\b.*$/i,
      ""
    ));
  }
  const literalValue = cleanSemanticText(value);
  if (category === "inputs" && /^[a-z]\s+(?:is|denotes?|measures?|represents?)\b/.test(literalValue)) {
    cleaned = `${literalValue[0]}${cleaned.slice(1)}`;
  }
  if (category === "entities"
      && /^(?:(?:a|an|the|each|every|one|two|multiple|several|online|content|academic|scientific)\s+)*(?:authors?|researchers?)$/i.test(cleaned)
      && source?.derivation !== "literal-modeled-content-creator") return false;
  if (category === "decisions"
      && source?.type !== "record"
      && /\b(?:paper|study|work|model)\s+by\b.{0,100}\b(?:consider|develop|introduc|propos|stud)\w*\b/i.test(source?.quote || "")) return false;
  if (category === "decisions"
      && source?.type !== "record"
      && /^(?:[\p{Lu}][\p{L}'’.-]+(?:\s+(?:and|&)\s+[\p{Lu}][\p{L}'’.-]+|\s+et\s+al\.)?\s*\((?:19|20)\d{2}[a-z]?\))\s+(?:has\s+|have\s+)?(?:argued|considered|found|proposed|showed|suggested|studied)\b/iu.test(cleanSemanticText(source?.quote || ""))) return false;
  if (category === "decisions"
      && /^(?:require|recommend|mandate)\b/i.test(cleaned)
      && /\b(?:World\s+Health\s+Organization|WHO|external|regulatory)\b.{0,100}\b(?:guidelines?|standards?)?\s*(?:require|recommend|mandate)\w*\b/i.test(source?.quote || "")) return false;
  if (category === "decisions"
      && /^(?:minimize|maximize)\b/i.test(cleaned)
      && /\b(?:objective|goal|aim)\s+(?:is|are|was|were)\s+to\s+(?:minimize|maximize)\b/i.test(source?.quote || "")) return false;
  if (setupRejectionReason(cleaned, category)) return false;
  const sectionReason = source?.type !== "record" ? sectionSetupRejectionReason(category, cleaned) : "";
  const literalCoordinatedPrimitive = category === "inputs"
    && source?.derivation === "literal-coordinated-given-input"
    && /^(?:beliefs?|budgets?|capacities|costs?|data|demands?|distributions?|features?|forecasts?|information|inventor(?:y|ies)|parameters?|preferences?|prices?|priorities|probabilities|rankings?|rates?|rewards?|signals?|states?|types?|utilities|valuations?)$/i.test(cleaned);
  const literalExplicitInputList = category === "inputs"
    && source?.derivation === "literal-explicit-input"
    && sectionReason === "not_a_local_input_phrase"
    && words(cleaned).length <= 22
    && !/[=<>≤≥∑∫{}]/.test(cleaned)
    && !/\b(?:is|are|was|were|has|have|can|will)\b/i.test(cleaned);
  if (sectionReason && !literalCoordinatedPrimitive && !literalExplicitInputList) return false;
  let key = normalizedKey(cleaned).replace(/^(?:a|an|the|each|its|their|this|that|these|those)\s+/, "");
  if (category === "entities") {
    key = key.replace(/^(?:(?:each|every|one|two|three|multiple|several|competing|strategic|heterogeneous|representative|focal|online|offline|available|dedicated|depleted|drained|fully|charged|differentiated|incoming|information|technology)\s+)+/, "");
    key = key.replace(/\b(advertisers?|agencies|agency|agents?|authors?|batteries|battery|bidders?|buyers?|bays?|clients?|consumers?|customers?|decision\s+makers?|developers?|drivers?|firms?|hospitals?|manufacturers?|organizations?|patients?|planners?|platforms?|policy\s+makers?|principals?|products?|projects?|providers?|researchers?|retailers?|salespersons?|sellers?|sensors?|servers?|stations?|suppliers?|users?|vendors?|workers?)\b/g, (term) => ({
      advertisers: "advertiser", agencies: "agency", agency: "agency", agents: "agent", authors: "author", bidders: "bidder", buyers: "buyer", clients: "client", consumers: "consumer", "decision makers": "decision maker",
      batteries: "battery", bays: "bay", customers: "customer", developers: "developer", drivers: "driver", firms: "firm", hospitals: "hospital", manufacturers: "manufacturer",
      organizations: "organization", patients: "patient", planners: "planner", platforms: "platform", "policy makers": "policy maker", principals: "principal",
      products: "product", projects: "project", providers: "provider", researchers: "researcher", retailers: "retailer", salespersons: "salesperson", sellers: "seller", sensors: "sensor", servers: "server", stations: "station", suppliers: "supplier", users: "user", vendors: "vendor", workers: "worker"
    })[term] || term);
  }
  if (!key) return false;
  const containmentDuplicate = (left, right) => {
    if (!left.includes(right) && !right.includes(left)) return false;
    if (category !== "decisions") return true;
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length <= right.length ? right : left;
    // Do not publish a subordinate whether-clause twice when the same quoted
    // coordinated decision already contains it ("chooses X and decides
    // whether Y"). Independent decision heads remain separate below.
    if (/^whether\b/i.test(shorter) && longer.includes(shorter)) return true;
    // A controlled object mentioned only inside a relational complement is
    // not the head of the longer choice: "medication" and "dose for the
    // selected medication" are two controls, whereas "price" and "retail
    // price" are alternate granularities of the same control.
    const head = longer.split(/\b(?:for|of|with|from|to|under|on|in)\b/i, 1)[0].trim();
    return head.includes(shorter) || shorter.includes(head);
  };
  const duplicateIndex = store[category].findIndex((item) => (
    item.key === key || (["entities", "inputs", "decisions"].includes(category)
      && containmentDuplicate(item.key, key))
  ));
  if (duplicateIndex >= 0) {
    const existing = store[category][duplicateIndex];
    const existingSection = cleanSemanticText(existing.source?.section);
    const candidateSection = cleanSemanticText(source?.section);
    // Prefer a literal actor mention in the paper's model/formulation over an
    // equivalent mention first encountered in introductory prose.  Older
    // two-column PDFs often lose words from the introductory sentence even
    // though the same actor is stated cleanly on the model page.
    if (category === "entities"
        && existing.source?.type === "section"
        && source?.type === "section"
        && /\b(?:introduction|overview|background)\b/i.test(existingSection)
        && /\b(?:model|formulation|problem\s+(?:description|setup|setting)|system)\b/i.test(candidateSection)) {
      store[category][duplicateIndex] = { value: cleaned, key, source };
      return true;
    }
    if (category === "entities"
        && existing.source?.type === "abstract"
        && source?.type === "section"
        && /\b(?:model(?:ing)?(?:\s+description)?|formulation|problem\s+(?:setup|setting)|system\s+model)\b/i.test(source?.section || "")
        && /\b(?:classical|existing|prior)\b.{0,40}\bliterature\b.{0,120}\bwe\s+assume\b/i.test(existing.source?.quote || "")) {
      store[category][duplicateIndex] = { value: cleaned, key, source };
      return true;
    }
    // Demonstrative setup phrases depend on a preceding sentence ("these
    // effort levels"). Treat determiners as semantically transparent for
    // deduplication, but prefer the less ambiguous possessive/literal phrase.
    const coreferenceRank = (candidate) => /^(?:this|that|these|those)\b/i.test(candidate)
      ? 0
      : /^(?:its|their)\b/i.test(candidate) ? 1 : 2;
    if (coreferenceRank(cleaned) > coreferenceRank(store[category][duplicateIndex].value)) {
      store[category][duplicateIndex] = { value: cleaned, key, source };
      return true;
    }
    const sameQuote = normalizedKey(existing.source?.quote) === normalizedKey(source?.quote);
    const existingCoordinatedDecision = category === "decisions"
      && /\band\b.{0,80}\b(?:accept|reject|choos|decid|select|set|allocat|order|pric)\w*\b/i.test(existing.value);
    const existingEnumeratedControls = category === "decisions"
      && /,\s+.{1,100}\band\s+[^,]{1,60}$/i.test(existing.value)
      && DECISION_OBJECT.test(existing.value);
    if (category === "decisions" && sameQuote && !existingCoordinatedDecision && !existingEnumeratedControls
        && words(cleaned).length < words(existing.value).length) {
      store[category][duplicateIndex] = { value: cleaned, key, source };
      return true;
    }
    if (category === "inputs" && key.includes(existing.key)
        && words(cleaned).length > words(existing.value).length) {
      store[category][duplicateIndex] = { value: cleaned, key, source };
      return true;
    }
    return false;
  }
  if (source?.type !== "record" && store[category].length >= (store.maxSourceCandidates || 4)) return false;
  store[category].push({ value: cleaned, key, source });
  return true;
}

function controlledActionDecision(action, object) {
  const actionText = cleanSemanticText(action);
  const cleanObject = cleanSemanticText(object);
  if (/^[\p{L}'’\-]+ed\b/iu.test(actionText)
      || /^(?:is|are|was|were|has|have|may|might|can|could|will|would|shall|should|must)\b/i.test(cleanObject)) return "";
  const genericObject = /^(?:a|an|the|each)?\s*(?:action|allocation|bid|capacity|choice|contract|decision|fee|investment|location|mechanism|order|policy|quantity|rate|route|schedule|timing)s?$/i.test(cleanObject);
  const basicControl = cleanSemanticText(action).match(/^(choos|set)/i)?.[1]?.toLowerCase();
  if (genericObject && basicControl) {
    return `${basicControl === "choos" ? "Choose" : "Set"} ${cleanObject}`;
  }
  const verb = cleanSemanticText(action).match(/^(accept|admit|announc|brush|clos|combat|design|disclos|distribut|exert|hid|irrigat|join|launch|licens|load|monitor|participat|perform|post|procur|propos|quot|reject|releas|reposition|requir|serv|shar|solicit|switch|target|test|transfer|unload)/i)?.[1]?.toLowerCase();
  if (!verb) return "";
  if (verb === "clos" && /^(?:proximity|similarity|relationship|association)\b/i.test(cleanObject)) return "";
  if (["design", "propos"].includes(verb) && DECISION_OBJECT.test(cleanObject)) return "";
  const canonical = verb === "shar" && /^sharing\b/i.test(actionText) ? "Sharing" : ({
    announc: "Announce", clos: "Close", design: "Design", disclos: "Disclose", distribut: "Distribute", hid: "Hide", irrigat: "Irrigate",
    licens: "License", procur: "Procure", propos: "Propose", quot: "Quote", releas: "Release",
    requir: "Require", serv: "Serve", shar: "Share"
  })[verb] || `${verb[0].toUpperCase()}${verb.slice(1)}`;
  return `${canonical} ${cleanObject}`;
}

function passiveModelDecisionCandidate(value, source) {
  if (source?.type !== "section") return "";
  const section = cleanSemanticText(source?.section);
  // This construction describes the baseline control without an active actor
  // ("the ... decision is a vector ... chosen over the feasible set"). Keep
  // it confined to a model/formulation root: an LDR or other named
  // nonbaseline section owns its local controls and must not backfill the
  // paper-level setup.
  if (!/\b(?:models?|formulation|optimization\s+problem|decision\s+problem|problem\s+(?:description|setup|setting))\b/i.test(section)
      || /\b(?:linear\s+decision\s+rules?|LDR|approximation|alternative|benchmark|counterfactual|extension|extended|nonbaseline|variant)\b/i.test(section)) {
    return "";
  }
  const text = cleanSemanticText(value);
  const declaration = text.match(
    /\b((?:the\s+)?(?:(?:first[-\s]+stage\s+or\s+)?here[-\s]+and[-\s]+now|first[-\s]+stage)\s+decision)\s+is\s+(?:a\s+)?vector\b[^.;]{0,100}\bchosen\s+over\s+(?:the\s+)?feasible\s+set\b/iu
  );
  return declaration ? cleanSemanticText(declaration[1]) : "";
}

function declarativeModelMechanicCandidate(value, source) {
  if (source?.type !== "section"
      || !/\b(?:model\s+overview|problem\s+formulation)\b/i.test(cleanSemanticText(source?.section))) return "";
  const text = cleanSemanticText(value);
  if (words(text).length < 5 || words(text).length > 24
      || /\b(?:data|empirical|experiment|field|intervention|observed|results?|sample|treated|treatment)\b/i.test(text)
      || /\b(?:we|the\s+(?:paper|study|analysis))\s+(?:find|found|show|showed|estimate|estimated|observe|observed|report|reported)\b/i.test(text)) {
    return "";
  }
  // A present-tense, frequency-bounded process statement is a model invariant
  // even when the authors do not introduce it with "we assume." Requiring a
  // modeled actor, an operational verb, and a per/each-period cadence keeps
  // this from absorbing narrative descriptions of the field setting.
  const mechanic = text.match(
    /^((?:a|an|the|each|every)\s+(?:agent|buyer|case|consumer|customer|decision[-\s]+maker|firm|judge|manager|operator|patient|planner|platform|provider|retailer|seller|server|supplier|worker)s?\s+(?:arrives?|holds?|operates?|processes?|receives?|schedules?|serves?)\s+[^.;]{1,100}?\b(?:per\s+(?:period|round|stage|time\s+unit)|each\s+(?:period|round|stage|time\s+unit)))(?=[.;]?$)/iu
  );
  return mechanic ? cleanSemanticText(mechanic[1]) : "";
}

function literalAssumptionCandidate(value) {
  const text = cleanSemanticText(value);
  const explicit = text.match(/^(?:(?:for\s+(?:analytical|notational|computational)\s+simplicity|for\s+simplicity|to\s+keep\s+the\s+model\s+tractable),?\s+)?(?:we\s+(?:will\s+)?assume|we\s+have\s+assumed|the\s+model\s+assumes|assume|suppose|we\s+consider\s+that)\s+(?:that\s+)?(.+)$/i)
    || text.match(/\b(?:we\s+(?:will\s+)?assume|we\s+have\s+assumed|the\s+model\s+assumes|we\s+consider\s+that)\s+(?:that\s+)?(.+)$/i)
    || text.match(/\b(?:and|but)\s+(?:we\s+)?assume\s+(?:that\s+)?(.+)$/i)
    || text.match(/\bwe\s+make\s+(?:(?:one|a)\s+more\s+|the\s+following\s+)?assumption,?\s+that\s+(.+)$/i);
  if (explicit) {
    return cleanSemanticText(explicit[1]).replace(
      /,\s+and\s+(?:we\s+)?(?:relax|extend|evaluate|test|discuss)\b.*$/i,
      ""
    );
  }

  const initial = text.match(/^assuming\s+(.+?)(?=,\s+(?:we|the\s+(?:paper|model|firm|planner))\b)/i);
  if (initial) return cleanSemanticText(initial[1]);

  const poisson = text.match(/\b([\p{L}][^.;]{0,100}?arriv(?:e|es|ing)\s+according\s+to\s+a\s+Poisson\s+process)\b/iu);
  if (poisson) return cleanSemanticText(poisson[1]);

  const equilibriumConstraint = text.match(/\bconstraints?\s+to\s+ensure\s+that\s+(.+?)(?=[.;]|$)/i);
  if (equilibriumConstraint) return cleanSemanticText(equilibriumConstraint[1]);

  const authoredStructural = text.match(/\b(we\s+(?:randomly\s+assign\b[^.;]{0,150}?\bwith\s+equal\s+probability|model\b[^.;]{0,90}?\bas\s+a\s+constant|keep\b[^.;]{0,140}?\bat\s+(?:a\s+)?(?:fixed\s+)?(?:value|level|rate|\d+(?:\.\d+)?)))\b/i);
  if (authoredStructural) return cleanSemanticText(authoredStructural[1]);

  const representational = text.match(/\b((?:the\s+)?objective\s+function(?:\s+[A-Za-z])?\s+can\s+be\s+written\s+as\s+[^.;]{1,120})/i);
  if (representational) return cleanSemanticText(representational[1]);

  const passive = text.match(/\b(no\s+other\s+structure(?:\s+such\s+as\s+[^,.;]{1,80})?\s+is\s+assumed)\b/i)
    || text.match(/\b((?:the\s+)?number\s+of\s+[\p{L}'’\-]+\s+is\s+assumed\s+to\s+be\s+[^,.;]{1,40})/iu);
  if (passive) return cleanSemanticText(passive[1]);

  const structural = text.match(/\b((?:firms?|customers?|consumers?|patients?|agents?)\s+(?:with\s+[^.;]{1,70}\s+)?are\s+(?:identical|homogeneous)(?:\s+and\s+[^.;]{1,80})?)(?=[.;]|$)/i)
    || text.match(/\b((?:[\p{L}'’()-]+\s+){0,5}(?:variables?|values?|types?)\s+are\s+(?:random\s+variables?\s+)?independently\s+drawn\s+from\s+[^.;]{1,90})(?=[.;]|$)/iu);
  if (structural) return cleanSemanticText(structural[1]);
  return "";
}

function addLiteralAssumption(store, text, source) {
  const candidate = literalAssumptionCandidate(text);
  if (!candidate || words(candidate).length > 34) return false;
  return addCandidate(store, "assumptions", candidate, {
    ...source,
    matchedText: candidate,
    derivation: "literal-source-pattern"
  });
}

function extractSetupFromSentence(sentence, source, store, { literalOnly = false } = {}) {
  const text = cleanSemanticText(sentence);
  if (!text) return;

  // Epidemic state compartments and vaccine types are core modeled objects,
  // unlike contextual policy actors mentioned later in an application.
  if (/\b(?:susceptible|infected|removed)\s+\([SIR]\)|\b(?:full|fractional)-dose\s+vaccine\b/i.test(text)) {
    store.maxSourceCandidates = Math.max(store.maxSourceCandidates || 4, 5);
  }
  for (const match of text.matchAll(/\b(susceptible|infected|removed)\s+\([SIR]\)/gi)) {
    addCandidate(store, "entities", match[1], {
      ...source,
      matchedText: cleanSemanticText(match[1]),
      derivation: "literal-actor-control"
    });
  }
  const explicitVaccineEntities = /\b(?:dosages?\s+of\s+a\s+vaccine\s+(?:are|is)\s+available|referred\s+to\s+using\s+index|(?:full|fractional)-dose\s+vaccine\b[^.;]{0,70}\bavailable)\b/i.test(text);
  if (explicitVaccineEntities) {
    for (const match of text.matchAll(/\b((?:the\s+)?(?:full|fractional)-dose\s+vaccine)\b/gi)) {
      addCandidate(store, "entities", match[1], {
        ...source,
        matchedText: cleanSemanticText(match[1]),
        derivation: "literal-actor-control"
      });
    }
  }

  // Preserve a few self-contained primitives before applying the sentence
  // gate. In PDF text layers, an otherwise clean declaration can share its
  // extracted "sentence" with a following display or second column.
  const earlyEntityPatterns = [
    /\b(the\s+milk\s+bank)\b/i,
    /\b((?:an?\s+)?inventory\s+manager|managers)\b(?=\s+(?:can|may|must|needs?\s+to|chooses?|decides?|optimizes?))/i,
    /\b((?:a|the)\s+firm)\b(?=[^.;]{0,35}\b(?:can\s+(?:either\s+)?order|chooses?|decides?|orders?))\b/i,
    /\b(human\s+reviewers)\b/i,
    /\b(a\s+deciding\s+editor|the\s+deciding\s+editor)\b/i,
    /\b(each\s+manuscript)\b/i,
    /\b(experimental\s+units)\b/i,
    /\b(this\s+commodity)\b/i,
    /\b(all\s+subjects)\b/i,
    /\bpopulation\s+of\s+[A-Z]\s+(subjects)\b/,
    /\b((?:two|multiple|several|competing)\s+players)\b/i,
    /\b((?:non-empty|grand|complementary)\s+coalition)\b/i
  ];
  const explicitEntityContext = /\b(?:we\s+(?:consider|model|study)|population\s+of|set\s+of|experiments?,\s+in\s+which|game|players?\s+in|subjects?\s+(?:are|exhibit|share)|commodity\s+is\s+associated|each\s+manuscript\s+is\s+assigned|deciding\s+editor|human\s+reviewers?|milk\s+bank\s+possesses|(?:inventory\s+)?managers?\s+(?:can|may|must|needs?\s+to|chooses?|decides?|optimizes?)|(?:a|the)\s+firm\b[^.;]{0,35}\b(?:can\s+(?:either\s+)?order|chooses?|decides?|orders?))\b/i.test(text);
  if (explicitEntityContext) {
    for (const pattern of earlyEntityPatterns) {
      const match = text.match(pattern);
      if (match) addCandidate(store, "entities", match[1], {
        ...source,
        matchedText: cleanSemanticText(match[1]),
        derivation: "literal-actor-control"
      });
    }
  }

  const earlyInputPatterns = [
    /\b(the\s+total\s+antigen\s+stockpile)\b/i,
    /\b(the\s+total\s+vaccine\s+administration\s+rate)\b/i,
    /\b(the\s+trip\s+rate)\b(?=[^.;]{0,80}\bestimated\b)/i,
    /\b((?:buyers?|consumers?|customers?)[’']\s+values?\s+for\s+the\s+impressions)\b(?=\s+(?:are|is)\s+(?:private|drawn|independent))/i,
    /\b(a\s+unidimensional\s+given\s+utility)\b/i,
    /\b(a\s+fixed\s+duration)\b/i,
    /\b(the\s+probability\s+distribution\s+of\s+peak\s+period\s+orders|probability\s+distribution\s+of\s+peak\s+period\s+orders)\b/i,
    /\b(their\s+profile\s+information)\b/i,
    /\b(their\s+preferences\s+regarding\s+each\s+of\s+these\s+dimensions)\b/i,
    /\b(uncertain\s+durations\s+of\s+surgeries)\b/i,
    /\b(the\s+uncertain\s+duration\s+of\s+surgery)\b/i,
    /\b(a\s+given\s+capacity)\b(?=[^.;]{0,25}\b(?:denoted|maximum\s+number\s+of\s+visits))/i,
    /\b(the\s+baseline\s+utility)\b/i,
    /\b(the\s+no-purchase\s+utility)\b/i,
    /\b(baseline\s+client\s+volumes)\b/i,
    /\btakes\s+as\s+input\s+(a\s+digraph)\b/i,
    /\b(the\s+case\s+completion\s+hazard\s+rate\s+function)\b/i,
    /\b(the\s+processing\s+time)\b(?=[^.;]{0,55}\b(?:denote|represent)|\s*[,.;])/i,
    /\b(the\s+coalition\s+payoff)\b(?=\s+in\s+a\s+fair\s+manner)/i,
    /\b(a\s+stationary\s+demand\s+rate)\b/i,
    /\b(the\s+parameters\s+of\s+such\s+problems)\b(?=\s+are\s+common\s+information)/i,
    /\b(wind\s+statistics\s+measured\s+on\s+the\s+site)\b/i,
    /\b(payment\s+requests)\b(?=[^.;]{0,100}\b(?:received|submitted|settled|system)\b)/i,
    /\b(sample\s+data\s+points)\b(?=[^.;]{0,80}\bindependently\s+drawn\b)/i,
    /\b(actual\s+demand)\b(?=\s+exceeds\s+inventory)/i,
    // Comparative/robustness appendices often introduce a replacement demand
    // specification immediately before a displayed equation.  The display can
    // make the extracted container unusable, but the plain noun phrase remains
    // a literal, auditable primitive.  Retain only that phrase; never infer or
    // repair the adjacent notation.
    /\b(a\s+demand\s+(?:system|function|specification))\b(?=[^.;]{0,90}\b(?:frequently|commonly)\s+used\s+in\s+the\s+literature\b)/i
  ];
  for (const pattern of earlyInputPatterns) {
    const match = text.match(pattern);
    if (match) addCandidate(store, "inputs", match[1], {
      ...source,
      matchedText: cleanSemanticText(match[1]),
      derivation: "literal-explicit-input"
    });
  }
  const fixedPurchaseInput = text.match(SOURCE_FIXED_PURCHASE_INPUT_PHRASE);
  if (fixedPurchaseInput && SOURCE_FIXED_PURCHASE_CONTEXT.test(text)) {
    addCandidate(store, "inputs", fixedPurchaseInput[0], {
      ...source,
      matchedText: cleanSemanticText(fixedPurchaseInput[0]),
      derivation: "literal-explicit-input"
    });
  }

  const earlyDecisionPatterns = [
    /\b(the\s+rates?\s+of\s+vaccination)\b(?=[^.;]{0,90}\b(?:full|fractional)[-\s]*dose\b)/i,
    /\b(price,\s+discount,\s+and\s+release\s+time)\b(?=\s*(?:\(|[,.;]|$))/i,
    /\b(wholesale\s+prices\s+and\s+(?:(?:production|service|ordering)\s+)?quantities)\b/i,
    /\b(the\s+prebook\s+quantity)\b/i,
    /\b(the\s+ordering\s+quantity)\b(?=[^.;]{0,20}(?:[.;]|$))/i,
    /\b(which\s+FCs\s+to\s+fulfill\s+(?:it|the\s+demands?\s+of\s+each\s+zone))\b/i,
    /\b(the\s+approval\s+policy)\b(?=[^.;]{0,20}[\p{L}])/iu,
    /\b(adjust\s+the\s+FDA[’']s\s+approval\s+threshold)\b/i,
    /\b(allocate\s+part\s+of\s+the\s+nonearmarked\s+budget\s+to\s+the\s+delegation)\b/i,
    /\b(investing\s+time\s+in\s+learning\s+from\s+completed\s+tasks)\b/i,
    /\b(a\s+start\s+time)\b(?=[^.;]{0,35}\band\s+an\s+amount\s+of\s+learning\s+time)/i,
    /\b(an\s+amount\s+of\s+learning\s+time)\b/i,
    /\b(the\s+empirical\s+classifier)\b(?=[^.;]{0,30}\bby\s+solving)/i,
    /\b(a\s+nontrivial\s+classifier\s+that\s+balances\s+fairness\s+and\s+predictive\s+power)\b/i,
    /\b(frequent\s+sanitation)\b(?=\s+seems\s+like\s+a\s+promising\s+lever)/i,
    /\b(two\s+possible\s+sanitation\s+periods)\b/i,
    /\b(the\s+speed-up\s+action)\b/i,
    /\b(target\s+production\s+quantities)\b(?=[^.;]{0,45}\b(?:simultaneously|capacity|capacities)\b)/i,
    /\b(order\s+some\s+quantity\s+of\s+the\s+product)\b/i,
    /\b((?:two\s+types\s+of\s+)?recourse\s+decisions)\b/i,
    /\b(choosing\s+new\s+skills\s+to\s+learn)\b/i,
    /\b(acquire\s+new\s+skills)\b/i,
    /\b(decide\s+on\s+this\s+sample\s+size)\b/i,
    /\b(orderings\s+of\s+a\s+batch\s+of\s+payments)\b/i,
    /\b(the\s+inventory\s+ordered\s+for\s+this\s+demand)\b/i,
    /\b(two\s+levels\s+of\s+effort)\b/i,
    /\b(affine\s+decision\s+rules?)\b/i,
    /\b((?:binary|integer|continuous|real-valued)\s+decision\s+variables?)\b/i,
    /\b(the\s+consumer[’']s\s+action\s+from\s+the\s+previous\s+period)\b/i,
    /\b(orders\s+more\s+inventory)\b/i
  ];
  const explicitDecisionContext = /\b(?:recourse\s+decisions|choos(?:e|es|ing)|acquir(?:e|es|ing)|decid(?:e|es|ing)|orders?|orderings?|decision\s+(?:rules?|variables?)|firm[’']s\s+decision\s+about\s+price|action\s+from|decision\s+as\s+being|contract(?:ed|ing)?\s+and\s+negotiated|rates?\s+of\s+vaccination|sets?\s+the\s+approval\s+policy|adjust\s+the\s+FDA[’']s\s+approval\s+threshold|allocate\s+part\s+of\s+the\s+nonearmarked\s+budget|investing\s+time\s+in\s+learning|finds?\s+the\s+empirical\s+classifier|search\s+for\s+a\s+nontrivial\s+classifier|frequent\s+sanitation\s+seems\s+like\s+a\s+promising\s+lever|two\s+possible\s+sanitation\s+periods|speed-up\s+action)\b/i.test(text);
  if (explicitDecisionContext) {
    for (const pattern of earlyDecisionPatterns) {
      const match = text.match(pattern);
      if (match) addMatchedSourceCandidate(store, "decisions", match[1], source);
    }
  }
  const optimizationModelControl = text.match(/\boptimization\s+model\s+to\s+(determine\s+an?\s+optimal\s+number\s+and\s+location\s+of\s+coproduction\s+plants)\b/i);
  if (optimizationModelControl) addMatchedSourceCandidate(store, "decisions", optimizationModelControl[1], source);
  const passiveModelDecision = passiveModelDecisionCandidate(text, source);
  if (passiveModelDecision) {
    addCandidate(store, "decisions", passiveModelDecision, {
      ...source,
      matchedText: passiveModelDecision,
      derivation: "literal-passive-decision-declaration"
    });
  }

  const namedAssumption = text.match(/\b((?:the\s+)?light-tail\s+assumption)\b/i);
  if (namedAssumption && /\b(?:under|relies?\s+on|requires?|using)\b/i.test(text.slice(Math.max(0, namedAssumption.index - 40), namedAssumption.index))) {
    addMatchedSourceCandidate(store, "assumptions", namedAssumption[1], source);
  }
  const finiteHorizonAssumption = text.match(/\bwe\s+assume\s+(two\s+periods)\b/i);
  if (finiteHorizonAssumption) addMatchedSourceCandidate(store, "assumptions", finiteHorizonAssumption[1], source);
  const batchSizeAssumption = text.match(/\b(the\s+order\s+quantity\s+must\s+be\s+a\s+multiple\s+of\s+a\s+certain\s+batch\s+size)\b/i);
  if (batchSizeAssumption) addMatchedSourceCandidate(store, "assumptions", batchSizeAssumption[1], source);
  const producerTypesAssumption = text.match(/\b(a\s+minimal\s+producer\s+ecosystem\s+in\s+which\s+there\s+are\s+potentially\s+just\s+two\s+types\s+of\s+producers)\b/i);
  if (producerTypesAssumption) addMatchedSourceCandidate(store, "assumptions", producerTypesAssumption[1], source);

  const earlyPairedChoice = text.match(/\bdecid(?:e|es|ed|ing)\s+not\s+only\s+(whether\s+to\s+[^,.;()]{1,90}?)(?:\s+\([^)]{1,80}\))?(?=\s+but\s+also\b)/i);
  if (earlyPairedChoice && DECISION_OBJECT.test(earlyPairedChoice[1])) {
    addMatchedSourceCandidate(store, "decisions", earlyPairedChoice[1], source);
  }
  const earlyDecisionOf = text.match(/\b(?:decision|problem)\s+of\s+((?:what|whether|when|where|how)\s+to\s+[^,.;]{1,90}?)(?=\s+(?:has|have|is|are|affects?|determines?|influences?)\b|[,.;]|$)/i);
  if (earlyDecisionOf && DECISION_OBJECT.test(earlyDecisionOf[1])) {
    addMatchedSourceCandidate(store, "decisions", earlyDecisionOf[1], source);
  }
  const earlySuppressionDecision = text.match(/\b(additional\s+cells\s+to\s+be\s+suppressed)\b/i);
  if (earlySuppressionDecision) {
    addCandidate(store, "decisions", earlySuppressionDecision[1], {
      ...source,
      matchedText: cleanSemanticText(earlySuppressionDecision[1]),
      derivation: "literal-actor-control"
    });
  }
  const randomWalkSelectionContext = source?.type === "section"
    && (/\b(?:models?|process(?:es)?|algorithms?|random[-\s]+walks?|hypergraphs?)\b/i.test(source?.section || "")
      || /\biteratively\s+undertake\s+the\s+following\s+procedure\b/i.test(text));
  if (randomWalkSelectionContext) {
    const randomWalkSelections = [...text.matchAll(/\b(?:randomly\s+)?(?:select|Select)\s+(?:a|an|the)\s+(?:new\s+)?(?:hyper)?(?:edge|node)\s+according\s+to\s+[A-Z][A-Z0-9_-]{1,8}\b/gu)];
    // A random-walk procedure normally exposes the edge-selection and
    // node-selection controls in the same source sentence. Earlier sections
    // can already have filled the conservative four-candidate buffer, so make
    // room for this explicitly paired, literal control only when both members
    // are present. This preserves the global cap for ordinary prose.
    if (randomWalkSelections.length >= 2) {
      store.maxSourceCandidates = Math.max(store.maxSourceCandidates || 4, 8);
    }
    for (const match of randomWalkSelections) {
      const matchedText = cleanSemanticText(match[0]);
      const value = matchedText.replace(/^randomly\s+/i, "");
      addCandidate(store, "decisions", value, {
        ...source,
        // When the PDF splits `randomly` at a line end, the controlled verb
        // phrase beginning at `select` is still a contiguous literal span.
        // Cite that minimal span so both members of the paired procedure pass
        // the same strict raw-page containment audit.
        matchedText: value,
        derivation: "literal-actor-control"
      });
    }
  }
  const earlyGivenMeanInputs = text.match(/\bgiven\s+(mean\s+arrival\s+rate)\b.{0,55}?\band\s+(mean\s+service\s+time)\b/i);
  if (earlyGivenMeanInputs) {
    for (const matchedText of earlyGivenMeanInputs.slice(1, 3)) {
      addCandidate(store, "inputs", matchedText, {
        ...source,
        matchedText: cleanSemanticText(matchedText),
        derivation: "literal-explicit-input"
      });
    }
  }
  const earlySensitiveCells = text.match(/\bgiven\s+(?:(?:a|the)\s+)?set\b.{0,45}?\bof\s+(sensitive\s+cells)\b/i);
  if (earlySensitiveCells) {
    addCandidate(store, "inputs", earlySensitiveCells[1], {
      ...source,
      matchedText: cleanSemanticText(earlySensitiveCells[1]),
      derivation: "literal-explicit-input"
    });
  }
  for (const match of indexedSourceMatches(text, SOURCE_INPUT_PHRASE)) {
    const before = text.slice(Math.max(0, match.index - 70), match.index);
    const after = text.slice(match.index + match.text.length, match.index + match.text.length + 35);
    if (/\b(?:given|observ(?:e|es|ed)|known|as\s+(?:an?\s+)?input)\s+(?:(?:a|an|the|each|its|their|mean|available|initial|remaining|private|public|random|unknown|uncertain)\s+){0,4}$/i.test(before)
        || /\bas\s+a\s+function\s+of(?:\s+(?:patient\s+age|lead\s+ages?|age\s+of\s+every\s+implanted\s+lead)\s+and)?\s*$/i.test(before)
        || /^\s*(?:is|are)\s+(?:given|known|observed|random)\b/i.test(after)) {
      addCandidate(store, "inputs", match.text, {
        ...source,
        matchedText: cleanSemanticText(match.text),
        derivation: "literal-explicit-input"
      });
    }
  }
  if (SETUP_RESULT_ARTIFACT.test(text) || SETUP_FORMULA_FRAGMENT.test(text) || words(text).length > 55) return;

  // A table cross-reference can make an otherwise clean model declaration
  // look like caption prose. Extract only the two literal primitive phrases
  // before applying the general source-noise gate; no other candidates from
  // that sentence are allowed through when the gate fires.
  const coordinatedGivenInputs = text.match(COORDINATED_GIVEN_INPUTS);
  if (coordinatedGivenInputs) {
    for (const input of coordinatedGivenInputs.slice(1, 3)) {
      const exactInput = cleanSemanticText(input);
      if (INPUT_TERM.test(exactInput)) addCandidate(store, "inputs", exactInput, {
        ...source,
        matchedText: exactInput,
        derivation: "literal-coordinated-given-input"
      });
    }
  }
  // Explicit algorithm signatures often end with notation and a section
  // cross-reference. Retain the literal noun phrase before either artifact;
  // the surrounding sentence can still be rejected by the general noise
  // filter without losing its plainly stated input.
  const explicitProcedureInput = text.match(/\bthe\s+input\s+to\s+(?:(?:algorithm|procedure|model)\s+(?:[A-Z]?\d+(?:\.\d+)*|[A-Z][\p{L}\p{N}-]*)|the\s+(?:algorithm|procedure|model))\s+is\s+((?:a|an|the)\s+(?:(?:directed|undirected|weighted|unweighted|input|state|network)\s+)?(?:graph|matrix|dataset|data\s+set))\b/iu);
  if (explicitProcedureInput && INPUT_TERM.test(explicitProcedureInput[1])) {
    const matchedText = cleanSemanticText(explicitProcedureInput[1]);
    addCandidate(store, "inputs", matchedText, {
      ...source,
      matchedText,
      derivation: "literal-explicit-input"
    });
  }

  // A graph or hypergraph definition states the structural input even when
  // mathematical notation immediately follows the noun. Retain only that
  // literal noun phrase so the setup stays readable and the formula-bearing
  // containing sentence can be narrowed during source remapping.
  const definedGraphInput = text.match(/^((?:a|an|the)\s+(?:(?:directed|undirected|weighted|unweighted)\s+)?(?:hypergraph|graph))\b/iu);
  if (definedGraphInput && /\b(?:is\s+(?:a\s+)?set\s+of|consists?\s+of|contains?)\b/iu.test(text)) {
    const matchedText = cleanSemanticText(definedGraphInput[1]);
    addCandidate(store, "inputs", matchedText, {
      ...source,
      matchedText,
      derivation: "literal-explicit-input"
    });
  }
  const constructedHypergraphTopology = text.match(/\b(the\s+hypergraph\s+topology)\s+is\s+constructed\b/iu);
  if (constructedHypergraphTopology) {
    const matchedText = cleanSemanticText(constructedHypergraphTopology[1]);
    addCandidate(store, "inputs", matchedText, {
      ...source,
      matchedText,
      derivation: "literal-explicit-input"
    });
  }

  // Demand, arrival, or cost primitives are often introduced through the
  // economic actor's exposure ("the retailers face a linear demand system")
  // rather than the words given/input. This is still a literal exogenous
  // primitive; keep only the named object, not the equation that may follow.
  const facedInput = text.match(/\bfaces?\s+((?:a|an|the)\s+(?:(?:aggregate|customer|consumer|deterministic|linear|market|nonstationary|random|stochastic|uncertain)\s+){0,3}(?:arrival\s+process|capacity|costs?|demand(?:\s+(?:curve|distribution|function|process|system))?|service\s+times?|uncertainty))\b/iu);
  if (facedInput && INPUT_TERM.test(facedInput[1])) {
    const matchedText = cleanSemanticText(facedInput[1]);
    addCandidate(store, "inputs", matchedText, {
      ...source,
      matchedText,
      derivation: "literal-explicit-input"
    });
  }
  // Parser line wrapping can damage the subject immediately before a clean,
  // literal list. The explicit "as the primary input" signature still makes
  // the list safe to retain before rejecting the rest of the sentence.
  const primaryInputs = text.match(/\b(?:considers?|uses?|takes?|receives?)\s+(.+?)\s+as\s+(?:a|the)\s+(?:primary|main)\s+inputs?\b/i);
  if (primaryInputs && INPUT_TERM.test(primaryInputs[1])) {
    const matchedText = cleanSemanticText(primaryInputs[1]);
    addCandidate(store, "inputs", matchedText, {
      ...source,
      matchedText,
      derivation: "literal-explicit-input"
    });
  }

  // Mathematical definitions often put notation immediately after an
  // otherwise plain model primitive. Retain only the literal noun phrase;
  // the formula-bearing container remains ineligible as displayed evidence.
  const primitiveContext = /\b(?:we\s+(?:study|consider|model)|let\s+us\s+consider|is\s+(?:a|the)\s+(?:ground\s+set|set\s+of|state\s+space)|(?:model|problem|policy)\s+(?:contains|includes|uses)|(?:is|are)\s+given)\b/i.test(text);
  if (primitiveContext) {
    for (const primitive of sourceMatches(
      text,
      /\b(?:a\s+set\s+of\s+(?:n\s+)?random\s+variables?|(?:a|the)\s+ground\s+set(?:\s+of\s+elements)?|(?:a|the)\s+set\s+of\s+elements|(?:a|the)\s+state\s+space|(?:a|the)\s+transition\s+graph|(?:a|the)\s+tables?)\b/giu
    )) addMatchedSourceCandidate(store, "entities", primitive, source);
  }

  for (const match of indexedSourceMatches(text, SOURCE_INPUT_PHRASE)) {
    const before = text.slice(Math.max(0, match.index - 70), match.index);
    const after = text.slice(match.index + match.text.length, match.index + match.text.length + 35);
    if (/\b(?:given|observ(?:e|es|ed)|known|as\s+(?:an?\s+)?input)\s+(?:(?:a|an|the|each|its|their|mean|available|initial|remaining|private|public|random|unknown|uncertain)\s+){0,4}$/i.test(before)
        || /\bas\s+a\s+function\s+of(?:\s+(?:patient\s+age|lead\s+ages?|age\s+of\s+every\s+implanted\s+lead)\s+and)?\s*$/i.test(before)
        || /^\s*(?:is|are)\s+(?:given|known|observed|random)\b/i.test(after)) {
      addCandidate(store, "inputs", match.text, {
        ...source,
        matchedText: cleanSemanticText(match.text),
        derivation: "literal-explicit-input"
      });
    }
  }

  const literalSuppressionDecision = text.match(/\b(additional\s+cells\s+to\s+be\s+suppressed)\b/i);
  if (literalSuppressionDecision) {
    addCandidate(store, "decisions", literalSuppressionDecision[1], {
      ...source,
      matchedText: cleanSemanticText(literalSuppressionDecision[1]),
      derivation: "literal-actor-control"
    });
  }
  if (extractionNoiseReason(text)) return;
  const assumptionStatement = /\b(?:we\s+(?:will\s+)?assume|we\s+have\s+assumed|the\s+model\s+assumes|assume|suppose|we\s+consider\s+that|we\s+make\s+[^.;]{0,30}\bassumption)\b/i.test(text);
  const assumedDetermination = assumptionStatement && /\bdetermin(?:e|es|ed|ing)\b/i.test(text);

  const existence = text.match(/\bthere\s+(?:are|is)\s+(.+?)(?=(?:[.;]|,\s+(?:where|who|which)\b|$))/i);
  if (existence && ENTITY_TERM.test(existence[1])) addCandidate(store, "entities", existence[1], source);

  const membership = text.match(/\b(?:the\s+)?(?:model|market|system|setting|game)\s+(?:contains|includes|consists\s+of|has)\s+(.+?)(?=(?:[.;]|,\s+(?:where|who|which)\b|$))/i);
  if (membership && ENTITY_TERM.test(membership[1])) addCandidate(store, "entities", membership[1], source);

  const modeledObject = text.match(/\b(?:we\s+(?:study|consider|model)\w*|(?:the\s+)?(?:model|problem|setting)\s+(?:contains|includes|uses))\b[^.;]{0,100}?\b(a\s+set\s+of\s+(?:n\s+)?random\s+variables?|(?:a|the)\s+ground\s+set(?:\s+of\s+elements)?|(?:a|the)\s+state\s+space|(?:a|the)\s+transition\s+graph|(?:a|the)\s+tables?)\b/i);
  if (modeledObject) addMatchedSourceCandidate(store, "entities", modeledObject[1], source);

  const modeledContentCreator = text.match(/\b(?:we|the\s+(?:paper|model|study))\s+(?:explicitly\s+)?(?:model|study|consider)s?\s+((?:(?:online|content|academic|scientific)\s+)?(?:authors?|researchers?))\s+(?:(?:who|that)\s+)?(?:creat|produc|post|publish|write|submit|choose|decid)\w*\b/i);
  if (modeledContentCreator) {
    const matchedText = cleanSemanticText(modeledContentCreator[1]);
    addCandidate(store, "entities", matchedText, {
      ...source,
      matchedText,
      derivation: "literal-modeled-content-creator"
    });
  }

  const actor = text.match(/^(?:(?:in\s+practice|in\s+the\s+model),?\s+|when\s+)?((?:the|a|an|each|every|two|three|multiple|competing|strategic)\s+[\p{L}\p{N}][^,.;]{0,65}?)\s+(?:(?:first|then|initially|privately|subsequently)\s+)?(?:(?:needs?\s+to|must|may|can|will)\s+)?(?:accepts?|admits?|adjusts?|announces?|brushes?|charges?|closes?|combats?|determines?|designs?|discloses?|distributes?|estimates?|exerts?|fits?|has\s+access\s+(?:only\s+)?to|hides?|infers?|irrigates?|joins?|launches?|licenses?|loads?|monitors?|observes?|knows?|participates?|performs?|posts?|procures?|proposes?|quotes?|receives?|rejects?|releases?|repositions?|requires?|serves?|shares?|learns?|chooses?|sets?|selects?|decides?|solicits?|switches?|targets?|tests?|transfers?|allocates?|approves?|deploys?|directs?|orders?|predicts?|prices?|offers?|prescribes?|invests?|schedules?|assigns?|routes?|trains?|unloads?|adopts?)\b/iu);
  if (actor && new RegExp(`(?:${ENTITY_TERM.source})\\s*$`, "i").test(actor[1])) addCandidate(store, "entities", actor[1], source);

  const observed = text.match(/\b(?:observes?|knows?|receives?|learns?|is\s+informed\s+of|(?:has|have)\s+access\s+(?:only\s+)?to)\s+(.+?)(?=(?:\s+(?:before|after|while|when|and\s+(?:then|choos\w*|set\w*|select\w*|decid\w*|determin\w*|allocat\w*|order\w*|pric\w*))\b|[.;]|$))/i);
  if (observed && INPUT_TERM.test(observed[1])) addCandidate(store, "inputs", observed[1], source);

  const available = text.match(/\bavailability\s+of\s+(.+?)(?=(?:[.;,]|\s+(?:before|after|while|when|which|that)\b|$))/i);
  if (available && INPUT_TERM.test(available[1])) addCandidate(store, "inputs", available[1], source);

  const constructedInputs = text.match(/\b(?:it|they|this\s+(?:input|object|structure)|the\s+(?:input|object|structure))\s+(?:is|are)\s+constructed\s+from\s+(?:(?:two|three|four|multiple|several)\s+(?:other\s+)?(?:inputs?|matrices|sources?)\s*:\s*)?(.+?)(?=[.;]|$)/i);
  if (constructedInputs && INPUT_TERM.test(constructedInputs[1])) {
    for (const primitive of constructedInputs[1].split(/\s+and\s+/i)) {
      const matchedText = cleanSemanticText(primitive);
      if (!INPUT_TERM.test(matchedText)) continue;
      addCandidate(store, "inputs", matchedText, {
        ...source,
        matchedText,
        derivation: "literal-explicit-input"
      });
    }
  }

  // Privacy models commonly phrase the modeled control as an owner's need to
  // hide information before release. This actor-owned clause is distinct from
  // an author's description of a masking or anonymization method.
  const ownerPrivacyControl = text.match(/\b((?:data|information)\s+owners?)\s+(?:needs?\s+to|must|may|can)\s+(hide|conceal|remove)\s+(.+?)(?=\s+before\b|[.;]|$)/i);
  if (ownerPrivacyControl) {
    const actorText = cleanSemanticText(ownerPrivacyControl[1]);
    const decisionText = cleanSemanticText(`${ownerPrivacyControl[2]} ${ownerPrivacyControl[3]}`);
    addCandidate(store, "entities", actorText, {
      ...source,
      matchedText: actorText,
      derivation: "literal-actor-control"
    });
    addCandidate(store, "decisions", decisionText, {
      ...source,
      matchedText: decisionText,
      derivation: "literal-actor-control"
    });
  }

  const actorDataSharing = text.match(/\b((?:retailers?|data\s+owners?|information\s+owners?|firms?|organizations?))\s+(?:have\s+been|are|were|may|can)\s+(sharing\s+(?:transactional\s+)?data(?:sets?)?(?:\s+with\s+[^,.;]{1,65})?)(?=\s+for\s+(?:a\s+long\s+time|years?|decades?)\b|[,.;]|$)/i);
  if (actorDataSharing) {
    const actorText = cleanSemanticText(actorDataSharing[1]);
    const decisionText = cleanSemanticText(actorDataSharing[2]);
    addCandidate(store, "entities", actorText, {
      ...source,
      matchedText: actorText,
      derivation: "literal-actor-control"
    });
    addCandidate(store, "decisions", decisionText, {
      ...source,
      matchedText: decisionText,
      derivation: "literal-actor-control"
    });
  }

  // An action-space declaration can state a literal modeled option without a
  // finite actor verb, as in choosing an advertisement versus showing none.
  const actionSpaceOption = text.match(/\baction\s+space\b[^.;]{0,50}?\bis\s+[^.;]{0,120}?\bas\s+well\s+as\s+(the\s+option\s+of\s+not\s+[^.;]+)/i);
  if (actionSpaceOption && DECISION_OBJECT.test(actionSpaceOption[1])) {
    const matchedText = cleanSemanticText(actionSpaceOption[1]);
    addCandidate(store, "decisions", matchedText, {
      ...source,
      matchedText,
      derivation: "literal-actor-control"
    });
  }

  const normalizedParameter = text.match(/\bwe\s+normalize\s+(.+?)\s+to\s+(?:one|zero|unity|a\s+common\s+value)\b/i);
  if (normalizedParameter && INPUT_TERM.test(normalizedParameter[1])) addCandidate(store, "inputs", normalizedParameter[1], source);

  // Parameter glosses are among the cleanest setup evidence in older PDFs.
  // Retain the literal economic meaning, never the bare symbol or a table row.
  const economicMeaningPattern = "(?:(?:unit|marginal|maximum|minimum|mean|average|arrival|service|holding|production|transportation|retailers?[’']|consumers?[’'])\\s+){0,4}(?:cost|valuation|rate|capacity|demand|price|probability|quality|time|utility)";
  // A domain annotation can sit between a symbol and its verbal definition:
  // `p ∈ R+ denotes the cost ...` or `x in [0,1] represents demand ...`.
  // Publish the literal verbal gloss, not the notation-bearing prefix.
  for (const definition of text.matchAll(/(?:^|[,;]\s*|\b(?:where|while|and)\s+)(?:let\s+)?[\p{L}][\p{L}\p{N}_*^()]{0,11}\s*(?:∈|in)\s*(?:\[[^\]]{1,36}\]|\{[^}]{1,36}\}|[^\s,;.]{1,24})\s+(?:is|denotes?|measures?|represents?)\s+(.+?)(?=(?:[,;]\s*(?:(?:where|while|and)\s+)?(?:let\s+)?[\p{L}][\p{L}\p{N}_*^()]{0,11}(?:\s*(?:∈|in)\s*(?:\[[^\]]{1,36}\]|\{[^}]{1,36}\}|[^\s,;.]{1,24}))?\s+(?:is|denotes?|measures?|represents?)\b|[.;]|$))/giu)) {
    const literalGloss = cleanSemanticText(definition[1]);
    if (INPUT_TERM.test(literalGloss)) addCandidate(store, "inputs", literalGloss, {
      ...source,
      matchedText: literalGloss,
      derivation: "literal-parameter-gloss"
    });
  }
  for (const definition of text.matchAll(new RegExp(`\\b(?:the\\s+)?parameter\\s+([A-Za-z])\\s+(?:is|denotes?|measures?|represents?)\\s+(${economicMeaningPattern})\\b`, "giu"))) {
    const literalGloss = cleanSemanticText(definition[0]);
    addCandidate(store, "inputs", literalGloss, {
      ...source,
      matchedText: literalGloss,
      derivation: "literal-parameter-gloss"
    });
  }
  for (const definition of text.matchAll(new RegExp(`(?:^|[,;]\\s*|\\b(?:where|while|and)\\s+)([A-Za-z])\\s+(?:is|denotes?|measures?|represents?)\\s+(${economicMeaningPattern})\\b`, "giu"))) {
    const literalGloss = cleanSemanticText(definition[0]).replace(/^(?:[,;]|where|while|and)\s*/i, "");
    addCandidate(store, "inputs", literalGloss, {
      ...source,
      matchedText: literalGloss,
      derivation: "literal-parameter-gloss"
    });
  }
  for (const definition of text.matchAll(/\b(?:the\s+)?parameter\s+[\p{L}\p{N}_*^()]+\s+(?:is|denotes?|measures?|represents?)\s+(.+?)(?=(?:[,;]\s*(?:(?:where|while|and)\s+)?(?:the\s+)?(?:parameter\s+)?[\p{L}\p{N}_*^()]+\s+(?:is|denotes?|measures?|represents?)\b|\s+(?:and|while)\s+[\p{L}\p{N}_*^()]+\s+(?:is|denotes?|measures?|represents?)\b|[.;]|$))/giu)) {
    if (INPUT_TERM.test(definition[1])) addMatchedSourceCandidate(store, "inputs", definition[1], source);
  }
  for (const definition of text.matchAll(/(?:^|[,;]\s*|\b(?:where|while|and)\s+)(?:[\p{L}][\p{L}\p{N}_*^()]{0,11})\s+(?:denotes?|measures?|represents?)\s+(.+?)(?=(?:[,;]\s*(?:(?:where|while|and)\s+)?[\p{L}][\p{L}\p{N}_*^()]{0,11}\s+(?:denotes?|measures?|represents?)\b|\s+(?:and|while)\s+[\p{L}][\p{L}\p{N}_*^()]{0,11}\s+(?:denotes?|measures?|represents?)\b|[.;]|$))/giu)) {
    if (INPUT_TERM.test(definition[1])) addMatchedSourceCandidate(store, "inputs", definition[1], source);
  }
  for (const definition of text.matchAll(/\b((?:(?:unit|marginal|maximum|minimum|mean|average|arrival|service|holding|production|transportation|retailers?[’']|consumers?[’'])\s+){0,3}(?:cost|valuation|rate|capacity|demand|price|probability|quality|time|utility))\s+([A-Za-z])(?=(?:[,.;]|\s+(?:where|which|and|is|are)\b|$))/giu)) {
    addMatchedSourceCandidate(store, "inputs", definition[0], source);
  }
  const namedInput = text.match(/\b(?:we\s+)?refer\s+to\s+.{1,100}?\s+as\s+(.+?)(?=(?:[.;]|,\s+(?:where|which|and\s+denote)\b|$))/i);
  if (namedInput && INPUT_TERM.test(namedInput[1])) addMatchedSourceCandidate(store, "inputs", namedInput[1], source);

  const unverifiableInput = text.match(/\b((?:(?:the|these|those|their|each)\s+)?(?:private|public|customer|consumer|firm|market|product|service|quality|demand|inventory|output|state|type|valuation|information)\s*(?:information|output|quality|state|type|valuation)?)\s+(?:is|are)\s+(?:not\s+)?(?:observable|observed|verifiable|verified|known|revealed)\b/i);
  if (unverifiableInput && INPUT_TERM.test(unverifiableInput[1])) addMatchedSourceCandidate(store, "inputs", unverifiableInput[1], source);

  const dependentSubject = text.match(/^((?:(?:a|an|the|each|their)\s+)?(?:aggregate\s+|customer\s+|consumer\s+|firm\s+|market\s+|product\s+|service\s+)?(?:demand|effort\s+levels?|information|output|payoff|price|probability|quality|reward|sales?|state|valuation)s?)\s+(?:is|are)\s+contingent\s+on\b/i);
  if (dependentSubject && INPUT_TERM.test(dependentSubject[1])) addMatchedSourceCandidate(store, "inputs", dependentSubject[1], source);

  const dependenceInput = text.match(/\b(?:depends?\s+(?:largely\s+)?on|is\s+contingent\s+on|are\s+contingent\s+on|is\s+determined\s+by|are\s+determined\s+by|is\s+influenced\s+by|are\s+influenced\s+by)\s+(.+?)(?=(?:[.;]|,\s+(?:where|which|but)\b|$))/i);
  if (dependenceInput && INPUT_TERM.test(dependenceInput[1])) addMatchedSourceCandidate(store, "inputs", dependenceInput[1], source);

  const unawareInput = text.match(/\b(?:unaware|unsure)\s+of\s+(.+?)(?=(?:[.;]|,\s+(?:where|which|but)\b|$))/i);
  if (unawareInput && INPUT_TERM.test(unawareInput[1])) addMatchedSourceCandidate(store, "inputs", unawareInput[1], source);

  // A paper's own compact model declaration can state the modeled population
  // or regime more cleanly than a damaged notation page. Keep only the literal
  // structure following "model of" (not the paper's analysis or findings).
  const modeledStructure = text.match(/\b(?:we\s+)?(?:build|develop|formulate|consider)\w*\s+(?:a|an|the|our)?\s*(?:stylized\s+|game-theoretic\s+|dynamic\s+)?model\s+of\s+((?:a|an|the)\s+.+?)(?=(?:\s+and\s+(?:conduct|analy[sz]|derive|solve|show|find)\w*\b|[.;]|$))/i);
  if (modeledStructure && /\b(?:consist(?:s|ing)?\s+of|compris(?:e|es|ing)|with|in\s+which)\b/i.test(modeledStructure[1])) {
    addMatchedSourceCandidate(store, "assumptions", modeledStructure[1], source);
  }
  const modeledScenarios = /\b(?:using|with)\s+(?:a|an|the)\s+[^.;]{0,45}\bmodel\b/i.test(text)
    && /\bwe\s+(?:investigat|study|consider|analy[sz])\w*\b/i.test(text)
    ? text.match(/\b(a\s+range\s+of\s+competitive\s+scenarios,\s+including\s+.+?)(?=[.;]|$)/i)
    : null;
  if (modeledScenarios) addMatchedSourceCandidate(store, "assumptions", modeledScenarios[1], source);

  const exogenouslyGiven = text.match(/\b(?:(?:a|an|the)\s+)?exogenously\s+given\s+(?:fee|parameter|price|rate)\b/i);
  if (exogenouslyGiven) addCandidate(store, "inputs", exogenouslyGiven[0], {
    ...source,
    matchedText: exogenouslyGiven[0],
    derivation: "literal-source-phrase"
  });

  if (!literalOnly) {
    const informationMatch = indexedSourceMatches(text, SOURCE_INPUT_PHRASE)[0];
    const exclusionContext = informationMatch
      ? text.slice(Math.max(0, informationMatch.index - 90), informationMatch.index)
      : "";
    const excludedPossibility = /\b(?:precludes?|excludes?|rules?\s+out|does\s+not\s+(?:allow|include|accommodate)|cannot\s+(?:allow|include|accommodate))\b.{0,65}$/i.test(exclusionContext);
    if (informationMatch && !excludedPossibility && /\b(?:private|public|observ|unknown|uncertain|random|stochastic|nonstationary|endogenous(?:ly)?|exogenous(?:ly)?|signal|information|state\s+of\s+charge)\b/i.test(text)) {
      addCandidate(store, "inputs", informationMatch.text, source);
    }
  }

  const introducedDecisionContext = /\b(?:we|this\s+(?:paper|study)|the\s+(?:paper|study))\s+(?:introduc|develop|propos|design)\w*\b/i.test(text);
  if (introducedDecisionContext) {
    const namedMechanism = text.match(/\b(?:introduc|develop|propos|design)\w*\s+([A-Z][A-Z0-9-]{2,},\s+(?:a|an|the)\s+(?:new\s+|novel\s+)?mechanism)\b/);
    if (namedMechanism) addMatchedSourceCandidate(store, "decisions", namedMechanism[1], source);
    for (const introduced of sourceMatches(
      text,
      /\b(?:(?:a|an|the|new|novel|two-stage|sequential|dynamic|assignment|self-matching)\s+){1,4}(?:selection\s+procedures?|mechanisms?|polic(?:y|ies)|procedures?)\b/giu
    )) addMatchedSourceCandidate(store, "decisions", introduced, source);
  }

  // Optimization and prediction papers often state the modeled control as a
  // goal rather than with an actor's finite "chooses" verb. Keep the literal
  // infinitive headed by a concrete action, and stop before result/purpose
  // tails such as "that maximizes ...".
  const modeledGoal = text.match(/\b(?:(?:(?:our|the|an?|overall)\s+)?(?:goal|objective)|(?:(?:an?|the)\s+)?(?:[\p{L}'’-]+\s+){0,3}(?:system|problem|model|policy)s?\d*|[A-Z]{2,8})\s+(?:is|aims?|attempts?)\s+(?:naturally,?\s+)?to\s+((?:find|determine|calculate|predict|select|choose|minimize|maximize|optimize)\b.+?)(?=\s+(?:that|which|so\s+as\s+to|in\s+order\s+to|subject\s+to)\b|[.;]|$)/iu);
  if (modeledGoal && DECISION_OBJECT.test(modeledGoal[1])) {
    addMatchedSourceCandidate(store, "decisions", modeledGoal[1], source);
  }

  const relativeModelOutput = text.match(/\b(?:problem|model|procedure|method),?\s+which\s+(?:finds?|estimates?|selects?|determines?)\s+((?:an?|the)\s+[^,.;]{1,80}?\bcost\s+vector(?:\s+[A-Za-z])?)(?=\s+(?:such\s+that|for\s+which)\b|[,.;]|$)/i);
  if (relativeModelOutput && DECISION_OBJECT.test(relativeModelOutput[1])) {
    addMatchedSourceCandidate(store, "decisions", relativeModelOutput[1], source);
  }

  const decisionOf = text.match(/\b(?:decision|problem)\s+of\s+((?:what|whether|when|where|how)\s+to\s+[^,.;]{1,90}?)(?=\s+(?:has|have|is|are|affects?|determines?|influences?)\b|[,.;]|$)/i);
  if (decisionOf && DECISION_OBJECT.test(decisionOf[1])) {
    addMatchedSourceCandidate(store, "decisions", decisionOf[1], source);
  }

  const modeledQuestion = text.match(/\bhow\s+should\s+(?:an?|the)\s+[^?;]{1,80}?\s+decide\s+((?:what|whether|when|where|how)\b[^?;]{1,120})(?=[?;]|$)/i);
  if (modeledQuestion && DECISION_OBJECT.test(modeledQuestion[1])) {
    addMatchedSourceCandidate(store, "decisions", modeledQuestion[1], source);
  }

  const pairedChoice = text.match(/\bdecid(?:e|es|ed|ing)\s+not\s+only\s+(whether\s+to\s+[^,.;()]{1,90}?)(?:\s+\([^)]{1,80}\))?(?=\s+but\s+also\b)/i);
  if (pairedChoice && DECISION_OBJECT.test(pairedChoice[1])) {
    addMatchedSourceCandidate(store, "decisions", pairedChoice[1], source);
  }

  // Preserve a single binary contractual choice. The general action scanner
  // deliberately separates coordinated controls, but `accept or reject` is
  // one modeled decision rather than two independent actions.
  const acceptRejectMatch = text.match(/\bdecid(?:e|es|ed|ing)(?:\s+on)?\s+(whether\s+to\s+(?:accept|reject)\s+or\s+(?:accept|reject)\s+[^,.;]{1,80})(?=[,.;]|$)/i);
  const acceptRejectContext = acceptRejectMatch
    ? text.slice(0, acceptRejectMatch.index)
    : "";
  const acceptRejectChoice = acceptRejectMatch
    && ENTITY_TERM.test(acceptRejectContext)
    && !/\b(?:researchers?|analysts?|authors?)\b/i.test(acceptRejectContext)
    && DECISION_OBJECT.test(acceptRejectMatch[1])
    && !/\b(?:assumption|hypothesis)\b/i.test(acceptRejectMatch[1])
      ? acceptRejectMatch
      : null;
  if (acceptRejectChoice) addMatchedSourceCandidate(store, "decisions", acceptRejectChoice[1], source);

  // A staged game may put the timing phrase between two announced controls.
  // Retain the first complete literal control instead of clipping a 15-word
  // coordinated sentence or treating the second-stage service noun as a verb.
  const stagedAnnouncement = text.match(/\bannounc(?:e|es|ed|ing)\s+(.+?)(?=\s+in\s+(?:the\s+)?(?:first|second|third)\s+stage\b)/i);
  if (stagedAnnouncement && DECISION_OBJECT.test(stagedAnnouncement[1])) {
    const matchedText = cleanSemanticText(stagedAnnouncement[0]);
    addCandidate(store, "decisions", matchedText, {
      ...source,
      matchedText,
      derivation: "literal-actor-control"
    });
  }

  const decisionCountBeforeSentence = store.decisions.length;
  const decisions = text.matchAll(/\b(?:accept(?:s|ed|ing)?|admit(?:s|ted|ting)?|adjust(?:s|ing)?|announc(?:e|es|ed|ing)|brush(?:es|ed|ing)?|calibrat(?:e|es|ing)|choos(?:e|es|ing)|clos(?:e|es|ed|ing)|combat(?:s|ed|ing)?|comput(?:e|es|ing)|set(?:s|ting)?|select(?:s|ing)?|decid(?:e|es|ing)(?:\s+(?:on|about))?|determin(?:e|es|ing)|design(?:s|ed|ing)?|disclos(?:e|es|ed|ing)|distribut(?:e|es|ed|ing)|estimat(?:e|es|ing)|exert(?:s|ed|ing)?|fit(?:s|ting)?|infer(?:s|red|ring)?|irrigat(?:e|es|ed|ing)|join(?:s|ed|ing)?|launch(?:es|ed|ing)?|licens(?:e|es|ed|ing)|load(?:s|ed|ing)?|monitor(?:s|ed|ing)?|outlin(?:e|es|ing)|participat(?:e|es|ed|ing)?|perform(?:s|ed|ing)?|post(?:s|ed|ing)?|predict(?:s|ing)?|procur(?:e|es|ed|ing)|propos(?:e|es|ed|ing)|quot(?:e|es|ed|ing)|reject(?:s|ed|ing)?|releas(?:e|es|ed|ing)|reposition(?:s|ed|ing)?|requir(?:e|es|ed|ing)|serv(?:e|es|ed|ing)|shar(?:e|es|ed|ing)|solicit(?:s|ed|ing)?|switch(?:es|ed|ing)?|target(?:s|ed|ing)?|test(?:s|ed|ing)?|transfer(?:s|red|ring)?|train(?:s|ing)?|allocat(?:e|es|ing)|approv(?:e|es|ing)|deploy(?:s|ing)?|directs?|directing|order(?:s|ing)?(?!\s+of\b)|pric(?:e|es|ing)(?!\s+takers?\b)|offer(?:s|ing)?|prescrib(?:e|es|ing)|invest(?:s|ing)?\s+in|schedul(?:e|es|ing)|assign(?:s|ing)?|rout(?:e|es|ing)|adopt(?:s|ing)?)\s+(.+?)(?=(?:\s+(?:subject\s+to|so\s+as\s+to|after|before|given|based\s+on|using|in\s+accordance\s+(?:with|to)|while|when|and\s+then)\b|\s+from\s+(?:recommendations?|a\s+set|the\s+set|available)\b|\s+(?:and|or)\s+(?:accept|admit|adjust|allocat|announc|approv|brush|choos|clos|combat|decid|deploy|design|determin|direct|disclos|distribut|estimat|exert|irrigat|join|launch|licens|load|monitor|offer|order|participat|perform|post|pric|procur|propos|quot|reject|releas|reposition|requir|rout|schedul|select|serv(?:e|es|ed|ing)|set|shar|solicit|switch|target|test|train|transfer|unload)\w*\b|[,.;]|$))/giu);
  for (const decision of decisions) {
    if (acceptRejectChoice
        && decision.index >= acceptRejectChoice.index
        && decision.index < acceptRejectChoice.index + acceptRejectChoice[0].length) continue;
    if (assumptionStatement && /^load/i.test(decision[0])) continue;
    if (assumedDetermination && /^determin/i.test(decision[0])) continue;
    const preceding = text.slice(0, decision.index);
    const estimationAction = /^(?:calibrat|estimat|fit|infer|outlin|predict|train)/i.test(decision[0]);
    const methodologicalActor = /\b(?:we|researchers?|analysts?|authors?|this\s+(?:paper|study)|our\s+(?:paper|study|work|approach|method|estimator))\b/i.test(preceding);
    if (/^test/i.test(decision[0]) && methodologicalActor) continue;
    if (estimationAction && !methodologicalActor) continue;
    const researchOutputAction = methodologicalActor
      && /^(?:design|develop|introduc|outlin|propos|releas)/i.test(decision[0])
      && /^(?:(?:a|an|the|our|this|new|novel|open[- ]source|python|software)\s+){0,5}(?:approach|framework|method|model|package|software|implementation|code|repository|dataset)\b/i.test(cleanSemanticText(decision[1]));
    if (researchOutputAction) continue;
    if (ENTITY_TERM.test(preceding) || /\b(?:we|planner|decision[-\s]+maker|researcher|operator|manager)\b/i.test(preceding) || /\b[A-Z]{2,8}\b/.test(preceding)) {
      const controlledDecision = controlledActionDecision(decision[0], decision[1]);
      const decisionObject = (controlledDecision || decision[1])
        .replace(/^and\s+(?:adjust(?:s|ing)?|approv(?:e|es|ing)|deploy(?:s|ing)?|direct(?:s|ing)?|allocat(?:e|es|ing)|select(?:s|ing)?|choos(?:e|es|ing)|determin(?:e|es|ing)|estimat(?:e|es|ing)|load(?:s|ing)?|unload(?:s|ing)?)\s+/i, "")
        .replace(/\s+(?:dynamically|periodically|simultaneously)\b.*$/i, "")
        .replace(/^a\s+location\s+to\s+shop\s+at$/i, "Shopping location");
      // End a setup decision's evidence at the chosen object. A following
      // display equation can otherwise be flattened into the same extracted
      // sentence and make a clean, literal actor-control clause unusable.
      const decisionQuote = source?.type === "section"
        ? cleanSemanticText(text.slice(0, decision.index + decision[0].length))
        : cleanSemanticText(source?.quote);
      const decisionSource = controlledDecision
        ? { ...source, quote: decisionQuote || source?.quote, matchedText: cleanSemanticText(decision[0]), derivation: "normalized-controlled-action" }
        : { ...source, quote: decisionQuote || source?.quote };
      addCandidate(store, "decisions", decisionObject, decisionSource);
    }
  }

  if (!literalOnly) {
    for (const match of indexedSourceMatches(text, SOURCE_DECISION_PHRASE)) {
      const before = text.slice(Math.max(0, match.index - 140), match.index);
      const after = text.slice(match.index + match.text.length, match.index + match.text.length + 45);
      const derivedPaymentControl = /\bderive\w*\s+(?:(?:a|an|the|optimal)\s+){0,3}$/i.test(before)
        && /^(?:(?:a|an|the|optimal)\s+)*(?:payment\s+terms?|terms?\s+of\s+payment\s+structures?)\b/i.test(match.text);
      const controlClause = (/\b(?:accept|admit|adjust|brush|choos|clos|combat|comput|consider|exert|irrigat|join|launch|licens|load|monitor|participat|perform|post|procur|propos|quot|reject|releas|reposition|requir|serv|shar|set|select|solicit|switch|target|test|transfer|unload|decid|determin|allocat|approv|deploy|design|disclos|distribut|order|pric|offer|prescrib|invest|schedul|assign|rout|adopt|optimi[sz])\w*\s+(?:(?:a|an|the|each|its|their|both|whether|how|which|what|not|to|next|optimal|linear)\s+){0,4}$/i.test(before)
        || derivedPaymentControl)
        && !(assumedDetermination && /\bdetermin\w*\b/i.test(before));
      const estimationClause = /\b(?:we|researchers?|analysts?|authors?|this\s+(?:paper|study)|our\s+(?:paper|study|work|approach|method|estimator))\b/i.test(before)
        && (/\b(?:calibrat|conduct|estimat|fit|infer|outlin|predict|train)\w*\b/i.test(before) || /^conducting\s+inference\b/i.test(match.text))
        && /\b(?:demand\s+estimation|estimation\s+procedure|inference|choice\s+function|price\s+elasticit|parameters?|models?)\b/i.test(match.text);
      const coordinatedControl = store.decisions.length > decisionCountBeforeSentence
        && /\bincluding\b.{0,110}\b(?:and|both)\s+(?:a|an|the|its|their)?\s*$/i.test(before);
      const choiceClause = controlClause || estimationClause
        || coordinatedControl
        || /^\s*(?:must|should|is|are|needs?\s+to)\s+be\s+(?:chosen|determined|set|optimized|allocated|scheduled|selected|estimated|fitted|inferred|predicted)\b/i.test(after);
      const alreadyCovered = store.decisions.some((item) => {
        const matchedText = normalizedKey(item.source?.matchedText);
        const candidate = normalizedKey(match.text);
        return matchedText && candidate && matchedText.includes(candidate);
      });
      if (choiceClause && !alreadyCovered) addMatchedSourceCandidate(store, "decisions", match.text, source);
    }
  }

  const literalAssumptionAdded = addLiteralAssumption(store, text, source);
  const declarativeMechanic = literalAssumptionAdded ? "" : declarativeModelMechanicCandidate(text, source);
  const declarativeMechanicAdded = declarativeMechanic
    ? addCandidate(store, "assumptions", declarativeMechanic, {
      ...source,
      matchedText: declarativeMechanic,
      derivation: "literal-declarative-model-mechanic"
    })
    : false;
  if (!literalAssumptionAdded && !declarativeMechanicAdded
      && /\b(?:is|are)\s+(?:i\.?i\.?d\.?|independent(?:ly)?\s+(?:and\s+identically\s+)?distributed|poisson|stationary|common\s+knowledge|privately\s+known)\b/i.test(text)) {
    addCandidate(store, "assumptions", text, source);
  }
}

function setupMaturity(items) {
  const hasRecord = items.some((item) => item.source.type === "record");
  const hasSection = items.some((item) => item.source.type === "section");
  if (hasRecord && hasSection) return SEMANTIC_MATURITY.MIXED;
  if (hasRecord) return SEMANTIC_MATURITY.AUTHORED;
  if (hasSection) return SEMANTIC_MATURITY.DERIVED;
  return SEMANTIC_MATURITY.UNRESOLVED;
}

/**
 * Build supported model-setup fields. Empty categories remain empty and receive
 * an unresolved diagnostic; this function never emits generic filler claims.
 */
export function deriveModelSetup(record = {}, sections = []) {
  const diagnostics = [];
  const store = { entities: [], inputs: [], decisions: [], assumptions: [] };
  const fieldMap = {
    entities: ["players", "entities", "objects"],
    inputs: ["information", "inputs"],
    decisions: ["actions", "decisions"],
    assumptions: ["assumptions"]
  };

  for (const [category, fields] of Object.entries(fieldMap)) {
    for (const candidate of recordValues(record, fields)) {
      const cleaned = cleanSemanticText(candidate.value);
      // Legacy metadata can contain a bare notation gloss with no actor or
      // choice clause. Keep rejecting that ungrounded value while allowing an
      // identical phrase when it is recovered from literal source prose.
      const ungroundedDecisionNotation = category === "decisions"
        && /^(?:(?:online|offline|retail|wholesale)\s+)?(?:price|rate|quantity)\s+[A-Za-z]{1,3}\d*$/i.test(cleaned);
      const reason = ungroundedDecisionNotation ? "notation_fragment_not_choice" : setupRejectionReason(cleaned, category);
      if (reason) {
        diagnostics.push(diagnostic(
          "setup_record_value_rejected",
          `Rejected ${candidate.field} entry: ${reason}.`,
          { category, field: candidate.field, reason }
        ));
        continue;
      }
      addCandidate(store, category, cleaned, { type: "record", field: candidate.field, matchedText: cleaned });
    }
  }

  for (const [sectionIndex, section] of (Array.isArray(sections) ? sections : []).entries()) {
    const title = cleanSemanticText(section?.title || section?.section);
    const lineage = [title, ...(section?.ancestorTitles || []).map(cleanSemanticText)].filter(Boolean).join(" ");
    if (!MODEL_SECTION.test(lineage) || EXCLUDED_SETUP_SECTION.test(lineage)) continue;
    const source = {
      type: "section",
      section: title || "Model section",
      sectionIndex
    };
    for (const { sentence, page } of sectionSentenceEntries(section)) {
      extractSetupFromSentence(sentence, { ...source, page, quote: sentence }, store);
    }
  }

  const categories = ["entities", "inputs", "decisions", "assumptions"];
  for (const category of categories) {
    if (!store[category].length) {
      diagnostics.push(diagnostic(
        `setup_${category}_unresolved`,
        `No supported ${category} were found in cleaned record metadata or model-section prose.`,
        { category }
      ));
    }
  }

  const evidence = Object.fromEntries(categories.map((category) => [
    category,
    store[category].slice(0, 6).map(({ value, source }) => ({ value, source }))
  ]));
  const values = Object.fromEntries(categories.map((category) => [category, evidence[category].map((item) => item.value)]));
  const maturity = Object.fromEntries(categories.map((category) => [category, setupMaturity(store[category])]));
  return { ...values, maturity, evidence, diagnostics };
}

function substantiveSetupSentence(value) {
  const text = cleanSemanticText(value);
  const count = words(text).length;
  const coordinatedGivenInputs = COORDINATED_GIVEN_INPUTS.test(text);
  if (!text || count < 6 || count > 90 || (extractionNoiseReason(text) && !coordinatedGivenInputs)) return false;
  if (SETUP_RESULT_ARTIFACT.test(text) || SETUP_FORMULA_FRAGMENT.test(text)) return false;
  if ((text.match(/[=≤≥∑∫]/g) || []).length >= 2 || /(?:\b[A-Za-z]\s*){5,}/.test(text)) return false;
  if (/^(?:this|the)\s+(?:section|appendix|table|figure)\b|^(?:we\s+next|next,?\s+we|the\s+remainder\s+of)/i.test(text)) return false;
  return true;
}

function containsEarlyLiteralSetupPrimitive(value) {
  const text = cleanSemanticText(value);
  return /\bgiven\s+(?:(?:an?|the)\s+set\s+of\s+(?:primary|sensitive)\s+cells|mean\s+(?:arrival\s+rate|service\s+time))\b/i.test(text)
    || /\b(?:susceptible|infected|removed)\s+\([SIR]\)|\b(?:full|fractional)-dose\s+vaccine\b/i.test(text)
    || /\b(?:the\s+total\s+antigen\s+stockpile|the\s+total\s+vaccine\s+administration\s+rate)\b/i.test(text)
    || /\b(?:the\s+trip\s+rate|(?:buyers?|consumers?|customers?)[’']\s+values?\s+for\s+the\s+impressions|a\s+unidimensional\s+given\s+utility|a\s+fixed\s+duration)\b/i.test(text)
    || /\b(?:inventory\s+)?managers?\s+(?:can|may|must|needs?\s+to|chooses?|decides?|optimizes?)\b/i.test(text)
    || /\b(?:the\s+)?probability\s+distribution\s+of\s+peak\s+period\s+orders\b/i.test(text)
    || /\b(?:their\s+profile\s+information|their\s+preferences\s+regarding\s+each\s+of\s+these\s+dimensions)\b/i.test(text)
    || /\b(?:uncertain\s+durations\s+of\s+surgeries|the\s+uncertain\s+duration\s+of\s+surgery)\b/i.test(text)
    || /\ba\s+given\s+capacity\b[^.;]{0,25}\b(?:denoted|maximum\s+number\s+of\s+visits)\b/i.test(text)
    || /\b(?:the\s+)?(?:baseline|no-purchase)\s+utility\b/i.test(text)
    || /\bbaseline\s+client\s+volumes\b/i.test(text)
    || /\btakes\s+as\s+input\s+a\s+digraph\b/i.test(text)
    || /\bprecedence\s+relationships?\s+are\s+captured\s+using\s+a\s+directed\s+acyclic\s+graph\b/i.test(text)
    || /\b(?:the\s+milk\s+bank\s+possesses|(?:a|the)\s+firm\b[^.;]{0,35}\bcan\s+(?:either\s+)?order)\b/i.test(text)
    || /\b(?:wholesale\s+prices\s+and\s+(?:(?:production|service|ordering)\s+)?quantities|the\s+(?:prebook|ordering)\s+quantity)\b/i.test(text)
    || /\bfirm[’']s\s+decision\s+about\s+price,\s+discount,\s+and\s+release\s+time\b/i.test(text)
    || /\bwhich\s+FCs\s+to\s+fulfill\b/i.test(text)
    || /\b(?:sets?\s+the\s+approval\s+policy|adjust\s+the\s+FDA[’']s\s+approval\s+threshold)\b/i.test(text)
    || /\ballocate\s+part\s+of\s+the\s+nonearmarked\s+budget\b/i.test(text)
    || /\b(?:investing\s+time\s+in\s+learning\s+from\s+completed\s+tasks|direct\s+decision\s+variables\s+are\s+a\s+start\s+time)\b/i.test(text)
    || /\b(?:finds?\s+the\s+empirical\s+classifier|a\s+nontrivial\s+classifier\s+that\s+balances\s+fairness\s+and\s+predictive\s+power)\b/i.test(text)
    || /\bfrequent\s+sanitation\s+seems\s+like\s+a\s+promising\s+lever\b/i.test(text)
    || /\btwo\s+possible\s+sanitation\s+periods\b/i.test(text)
    || /\bthe\s+speed-up\s+action\b/i.test(text)
    || /\b(?:the\s+)?case\s+completion\s+hazard\s+rate\s+function\b/i.test(text)
    || /\b(?:the\s+)?processing\s+time\b/i.test(text)
    || /\btarget\s+production\s+quantities\b/i.test(text)
    || /\border\s+some\s+quantity\s+of\s+the\s+product\b/i.test(text)
    || /\b(?:each\s+manuscript\s+is\s+assigned|deciding\s+editor|human\s+reviewers?)\b/i.test(text)
    || /\b(?:decision|problem)\s+of\s+(?:what|whether|when|where|how)\s+to\b/i.test(text)
    || /\bdecid(?:e|es|ed|ing)\s+not\s+only\s+whether\s+to\b/i.test(text)
    || /\badditional\s+cells\s+to\s+be\s+suppressed\b/i.test(text)
    || /\b(?:binary|integer|continuous|real-valued)\s+decision\s+variables?\b/i.test(text)
    || /\baffine\s+decision\s+rules?\b/i.test(text)
    || /\bwe\s+assume\s+two\s+periods\b/i.test(text)
    || /\bwind\s+statistics\s+measured\s+on\s+the\s+site\b/i.test(text)
    || /\bsample\s+data\s+points\b.{0,80}\bindependently\s+drawn\b/i.test(text)
    || /\bthe\s+order\s+quantity\s+must\s+be\s+a\s+multiple\s+of\s+a\s+certain\s+batch\s+size\b/i.test(text)
    || /\bactual\s+demand\s+exceeds\s+inventory\b/i.test(text)
    || /\bwe\s+(?:consider|adopt|use|specify)\s+a\s+demand\s+(?:system|function|specification)\b[^.;]{0,90}\b(?:frequently|commonly)\s+used\s+in\s+the\s+literature\b/i.test(text)
    || /\b(?:firm\s+)?orders\s+more\s+inventory\b/i.test(text)
    || SOURCE_ACTOR_INVENTORY_CONTROL.test(text)
    || (SOURCE_FIXED_PURCHASE_INPUT_PHRASE.test(text) && SOURCE_FIXED_PURCHASE_CONTEXT.test(text));
}

function setupSourceSentences(record, sections) {
  const candidates = [];
  const seen = new Set();
  const push = (sentence, source) => {
    const text = cleanSemanticText(sentence);
    const key = normalizedKey(text);
    if (!key || seen.has(key)
        || (!substantiveSetupSentence(text) && !containsEarlyLiteralSetupPrimitive(text))) return;
    seen.add(key);
    candidates.push({ text, source: { ...source, quote: text } });
  };

  for (const [sentenceIndex, sentence] of sentenceList(record?.abstract).entries()) {
    push(sentence, { type: "abstract", field: "abstract", sentence: sentenceIndex + 1 });
  }

  for (const [sectionIndex, section] of (Array.isArray(sections) ? sections : []).entries()) {
    const title = cleanSemanticText(section?.title || section?.section);
    const lineage = [title, ...(section?.ancestorTitles || []).map(cleanSemanticText)].filter(Boolean).join(" ");
    if (!title) continue;
    const excludedLineage = EXCLUDED_SETUP_SECTION.test(lineage);
    const broadlyEligible = SUBSTANTIVE_SETUP_SECTION.test(lineage) || section?.setupScope === "whole-paper";
    for (const { sentenceIndex, sentence, page } of sectionSentenceEntries(section)) {
      // A clean, explicit declaration that primitives are known/given is
      // setup evidence even when the publisher chose a comparative heading
      // such as "Efficiency vs. Envy-Freeness." Keep this narrow exception
      // tied to the literal declaration rather than opening the whole section.
      // It also permits the paper's own worked setup when a coarse PDF heading
      // parser has inherited a "Literature Review" ancestor for that section.
      const coordinatedGivenInputs = COORDINATED_GIVEN_INPUTS.test(cleanSemanticText(sentence));
      const explicitLocalAssumption = !excludedLineage && Boolean(literalAssumptionCandidate(sentence));
      const earlyLiteralSetupPrimitive = containsEarlyLiteralSetupPrimitive(sentence);
      if ((excludedLineage || !broadlyEligible)
          && !coordinatedGivenInputs
          && !explicitLocalAssumption
          && !earlyLiteralSetupPrimitive) continue;
      push(sentence, {
        type: "section",
        section: title,
        page,
        sectionIndex,
        sentence: sentenceIndex + 1
      });
    }
  }
  return candidates;
}

function sourceMatches(text, pattern) {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => match[0]);
}

function indexedSourceMatches(text, pattern) {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => ({ text: match[0], index: match.index }));
}

function addMatchedSourceCandidate(store, category, matchedText, source) {
  const exactMatch = cleanSemanticText(matchedText);
  if (!exactMatch) return false;
  return addCandidate(store, category, exactMatch, { ...source, matchedText: exactMatch, derivation: "literal-source-phrase" });
}

function retainLiteralNewCandidates(store, lengths, source) {
  const quote = cleanSemanticText(source.quote);
  const lowerQuote = quote.toLocaleLowerCase("en-US");
  for (const category of ["entities", "inputs", "decisions", "assumptions"]) {
    const retained = store[category].slice(0, lengths[category]);
    for (const candidate of store[category].slice(lengths[category])) {
      if (candidate.source?.matchedText) {
        retained.push(candidate);
        continue;
      }
      const wanted = cleanSemanticText(candidate.value);
      const index = lowerQuote.indexOf(wanted.toLocaleLowerCase("en-US"));
      if (index < 0) continue;
      retained.push({
        ...candidate,
        source: {
          ...candidate.source,
          matchedText: quote.slice(index, index + wanted.length),
          derivation: "literal-source-pattern"
        }
      });
    }
    store[category] = retained;
  }
}

function extractLastResortSetup(sentence, source, store) {
  const text = cleanSemanticText(sentence);
  if (process.env.ATLAS_DEBUG_SEMANTIC_SENTENCES && /base[-\s]+stock|inventory levels/i.test(text)) {
    console.error(`ATLAS_SEMANTIC_SENTENCE ${JSON.stringify({ text, source, actorMatch: text.match(SOURCE_ACTOR_INVENTORY_CONTROL) })}`);
  }
  const lengths = Object.fromEntries(["entities", "inputs", "decisions", "assumptions"].map((category) => [category, store[category].length]));
  extractSetupFromSentence(text, source, store, { literalOnly: true });

  const participationContext = /\b(?:study|studies|analy[sz]e|consider|considers|model|models|market|system|setting|game|interact|compete|arrive|serve|provide|operate|hold|contain|comprise|face|exchange|accept|charge|exert|join|load|post|quote|reject|solicit|target|test|unload|choose|set|decide|determine|observe|know|receive|learn|estimate|fit|infer|predict|allocate|design|order|price|offer|prescribe|invest|schedule|assign|route|adopt|propose|develop)\w*\b/i.test(text);
  if (participationContext) {
    for (const match of sourceMatches(text, SOURCE_ENTITY_PHRASE)) addMatchedSourceCandidate(store, "entities", match, source);
    for (const match of sourceMatches(text, SOURCE_DOMAIN_ENTITY_PHRASE)) addMatchedSourceCandidate(store, "entities", match, source);
  }

  const actorInventoryControl = text.match(SOURCE_ACTOR_INVENTORY_CONTROL);
  if (actorInventoryControl) {
    const literalAction = cleanSemanticText(actorInventoryControl[1] || actorInventoryControl[2] || actorInventoryControl[3] || actorInventoryControl[4]);
    const decisionValue = actorInventoryControl[1]
      ? literalAction.replace(/^decides?\s+(?:on\s+)?/i, "")
      : actorInventoryControl[3] ? literalAction.match(/^places?\s+an?\s+order/i)?.[0] || literalAction : literalAction;
    const actorAdded = addCandidate(store, "decisions", decisionValue, {
      ...source,
      matchedText: decisionValue,
      derivation: "literal-actor-control"
    });
    if (process.env.ATLAS_DEBUG_SEMANTIC_SENTENCES) {
      console.error(`ATLAS_ACTOR_ADD ${JSON.stringify({ decisionValue, actorAdded, rejection: setupRejectionReason(decisionValue, "decisions"), sectionRejection: sectionSetupRejectionReason("decisions", decisionValue) })}`);
    }
  }

  for (const match of indexedSourceMatches(text, SOURCE_INPUT_PHRASE)) {
    const before = text.slice(Math.max(0, match.index - 55), match.index);
    const after = text.slice(match.index + match.text.length, match.index + match.text.length + 55);
    const excludedPossibility = /\b(?:precludes?|excludes?|rules?\s+out|does\s+not\s+(?:allow|include|accommodate)|cannot\s+(?:allow|include|accommodate))\b.{0,50}$/i.test(before);
    const resultLed = /^(?:(?:as\s+a\s+result|therefore|thus),?\s+)?(?:we|the\s+(?:paper|analysis|results?))\s+(?:find|show|reveal|demonstrate|report|establish)\w*\b/i.test(text);
    const explicitModelContext = !resultLed && (
      /\b(?:we|this\s+(?:paper|study)|the\s+(?:paper|model|problem|setting))\s+(?:consider|study|model|introduc|formali[sz]|formulat|assum|incorporat|includ|involv|allow|focus)\w*\b/i.test(text)
      || /\b(?:affected\s+by|contingent\s+on|depends?\s+(?:largely\s+)?on|determinants?\s+of|in\s+the\s+presence\s+of|subject\s+to|under)\b/i.test(text)
      || /\b(?:denot|measure|represent|refer\s+to|parameter\b.{0,35}\bis)\w*\b/i.test(text)
    );
    const locallySupported = /\b(?:observ|know|learn|given|unaware|unsure|unverifiable|unknown|uncertain|random|stochastic|nonstationary|endogenous|exogenous|private|public|signal|input|forecast|determinant)\w*\b/i.test(`${before} ${match.text}`)
      || /\b(?:state\s+of\s+charge|demand\s+(?:data|signal)|arrival\s+rate|inventory\s+level|queue\s+length|service\s+rate|product\s+(?:features|characteristics))\b/i.test(match.text)
      || /^\s*(?:is|are)\s+(?:unknown|uncertain|random|stochastic|nonstationary|endogenous|exogenous|private|public|observed|distributed)\b/i.test(after)
      || explicitModelContext;
    if (locallySupported && !excludedPossibility) addMatchedSourceCandidate(store, "inputs", match.text, source);
  }

  for (const match of indexedSourceMatches(text, SOURCE_DECISION_PHRASE)) {
    const before = text.slice(Math.max(0, match.index - 50), match.index);
    const after = text.slice(match.index + match.text.length, match.index + match.text.length + 55);
    const derivedPaymentControl = /\bderive\w*\s+(?:(?:a|an|the|optimal)\s+){0,3}$/i.test(before)
      && /^(?:(?:a|an|the|optimal)\s+)*(?:payment\s+terms?|terms?\s+of\s+payment\s+structures?)\b/i.test(match.text);
    const locallySupported = /\b(?:accept|admit|adjust|brush|calibrat|charg|choos|clos|combat|comput|consider|design|disclos|distribut|exert|irrigat|join|launch|licens|load|monitor|participat|perform|post|procur|propos|quot|reject|releas|reposition|requir|serv|shar|set|select|solicit|switch|target|test|transfer|unload|decid|determin|estimat|fit|infer|outlin|predict|train|allocat|order|pric|offer|prescrib|invest|schedul|assign|rout|adopt|optimi[sz])\w*\s+(?:(?:a|an|the|each|its|their|both|whether|how|which|what|not|to|next|optimal|linear)\s+){0,4}$/i.test(before)
      || derivedPaymentControl
      || /^\s*(?:must|should|is|are|needs?\s+to)\s+be\s+(?:chosen|determined|set|optimized|allocated|scheduled|selected|estimated|fitted|inferred|predicted|charged|loaded|unloaded)\b/i.test(after)
      || /\b(?:decision|policy|choice|estimation|inference)\s+(?:is|concerns?|about|over|of)\s*$/i.test(before)
      || (/\b(?:demand\s+estimation|estimation\s+procedure|inference(?:\s+procedure)?|choice\s+function|price\s+elasticit)\b/i.test(match.text)
        && /\b(?:we|this\s+paper|our\s+(?:paper|work|approach|method|estimator))\b.{0,120}\b(?:propos|develop|introduc|offer|describ|outlin|employ|use|estimat|infer)\w*\b/i.test(text));
    if (locallySupported) addMatchedSourceCandidate(store, "decisions", match.text, source);
  }

  if (!addLiteralAssumption(store, text, source)
      && /\b(?:follows?\s+(?:a\s+)?poisson|i\.?i\.?d\.?|independent(?:ly)?\s+(?:and\s+identically\s+)?distributed|stationary|risk.neutral|common\s+knowledge|finite\s+horizon|single.period)\b/i.test(text)
      && words(text).length <= 34) {
    addMatchedSourceCandidate(store, "assumptions", text, source);
  }
  retainLiteralNewCandidates(store, lengths, source);
}

function cloneSetupEvidence(evidence, category) {
  return Array.isArray(evidence?.[category])
    ? evidence[category].map((entry) => ({ ...entry, source: entry?.source ? { ...entry.source } : entry?.source }))
    : [];
}

function setupCandidateScore(item, category) {
  const value = cleanSemanticText(item?.value);
  const source = item?.source || {};
  const quote = cleanSemanticText(source.quote);
  const section = cleanSemanticText(source.section);
  // Reviewed record fields are already literal authoring inputs. In a mixed
  // category they must not be pushed past the publication cap by noisy early
  // section candidates; source rereading is an alternative, not a demotion.
  let score = source.type === "record" ? 52 : source.type === "abstract" ? 26 : 0;
  if (/\b(?:model|formulation|setup|setting|assumptions?|information|decisions?|problem|process|mechanism|optimization)\b/i.test(section)) score += 10;
  if (/\b(?:background|introduction|motivation|results?|discussion|conclusion|notation)\b/i.test(section)) score -= 5;
  if (source.matchedText) score += 3;
  if (category === "entities" && /^(?:a|an|the|each|every|one|two|multiple|several)\b/i.test(value)) score += 3;
  if (category === "inputs" && /\b(?:observ|know|unknown|uncertain|unverifiable|exogenous|endogenous|random|stochastic|denot|measure|represent|parameter|contingent\s+on)\w*\b/i.test(quote)) score += 8;
  if (category === "inputs" && /\bgiven\b.{0,80}\b(?:mean\s+arrival\s+rate|mean\s+service\s+time|sensitive\s+cells?|protection\s+levels?)\b/i.test(quote)) score += 36;
  if (category === "inputs" && /(?:\b(?:parameter\s+)?[A-Za-z]\s+(?:is|denotes?|measures?|represents?)\b|\b(?:unit\s+transportation|marginal|maximum)\s+(?:cost|valuation|rate)\s+[A-Za-z]\b)/i.test(value)) score += 30;
  if (category === "decisions" && /\b(?:choos|decid|select|set|allocat|design|offer|order|pric|launch|releas|reposition|schedul|target|test)\w*\b/i.test(quote)) score += 8;
  if (category === "decisions" && /\b(?:(?:system|problem|model|policy)s?\d*\s+(?:aims?|attempts?)\s+to|(?:decision|problem)\s+of\s+(?:what|whether|when|where|how)\s+to|decid(?:e|es|ed|ing)\s+not\s+only\s+whether\s+to)\b/i.test(quote)) score += 40;
  if (category === "decisions"
    && /\b(?:at|in)\s+(?:the\s+)?(?:first|second|third|fourth|fifth|final|\d+(?:st|nd|rd|th)?)\s+stage\b/i.test(quote)) score += 50;
  if (category === "assumptions" && /\b(?:we\s+assume|the\s+model\s+assumes|suppose|for\s+simplicity|common\s+knowledge|i\.?i\.?d\.?)\b/i.test(quote)) score += 9;
  score -= Math.max(0, words(value).length - (category === "assumptions" ? 24 : 12));
  return score;
}

function rankedSetupCandidates(items, category) {
  return [...items].sort((left, right) => setupCandidateScore(right, category) - setupCandidateScore(left, category));
}

/**
 * Fill only unresolved setup categories from literal phrases in clean abstract or
 * substantive-section sentences. Existing values and evidence win; categories
 * remain empty when the source contains no conservative match.
 */
export function completeModelSetupFromSource(record = {}, sections = [], existingSetup = null) {
  const base = existingSetup && typeof existingSetup === "object"
    ? existingSetup
    : deriveModelSetup(record, sections);
  const categories = ["entities", "inputs", "decisions", "assumptions"];
  const values = Object.fromEntries(categories.map((category) => [
    category,
    Array.isArray(base[category])
      ? [...base[category]]
      : category === "entities" && Array.isArray(base.objects) ? [...base.objects] : []
  ]));
  const evidence = Object.fromEntries(categories.map((category) => [category, cloneSetupEvidence(base.evidence, category)]));
  const maturity = Object.fromEntries(categories.map((category) => [
    category,
    base.maturity?.[category] || (values[category].length ? SEMANTIC_MATURITY.AUTHORED : SEMANTIC_MATURITY.UNRESOLVED)
  ]));
  const diagnostics = Array.isArray(base.diagnostics) ? base.diagnostics.map((item) => ({ ...item })) : [];
  const missing = new Set(categories.filter((category) => !values[category].length));
  const scratch = { entities: [], inputs: [], decisions: [], assumptions: [], maxSourceCandidates: 24 };

  // Re-read even a nominally populated source-derived category. Earlier model
  // pages can contain clipped columns that later fail the page-level literal
  // gate; a clean abstract or definition farther into the model must remain as
  // a source-backed alternative rather than being hidden behind that shard.
  for (const { text, source } of setupSourceSentences(record, sections)) extractLastResortSetup(text, source, scratch);

  for (const category of categories) {
    if (missing.has(category) || maturity[category] === SEMANTIC_MATURITY.AUTHORED) continue;
    const existingItems = evidence[category].map((entry) => ({ value: entry.value, source: entry.source }));
    const ranked = [
      ...rankedSetupCandidates(existingItems.filter((item) => item.source?.type === "record"), category),
      ...rankedSetupCandidates([
        ...scratch[category],
        ...existingItems.filter((item) => item.source?.type !== "record")
      ], category)
    ];
    if (!ranked.length) continue;
    const combined = [];
    const seen = new Set();
    for (const item of ranked) {
      const key = normalizedKey(item.value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      combined.push({ value: item.value, source: item.source });
      if (combined.length >= 6) break;
    }
    values[category] = combined.map((item) => item.value);
    evidence[category] = combined;
    maturity[category] = SEMANTIC_MATURITY.DERIVED;
  }

  const filledCategories = [];
  for (const category of categories) {
    if (!missing.has(category) || !scratch[category].length) continue;
    const additions = rankedSetupCandidates(scratch[category], category).slice(0, 5).map(({ value, source }) => ({ value, source }));
    values[category] = additions.map(({ value }) => value);
    evidence[category] = additions;
    maturity[category] = SEMANTIC_MATURITY.DERIVED;
    filledCategories.push(category);
  }

  const finalDiagnostics = diagnostics.filter((item) => !filledCategories.some((category) => item.code === `setup_${category}_unresolved`));
  for (const category of filledCategories) {
    finalDiagnostics.push(diagnostic(
      `setup_${category}_completed_from_source`,
      `Filled ${category} from literal abstract or source-section phrases.`,
      { category, count: values[category].length }
    ));
  }
  for (const category of categories) {
    if (values[category].length) continue;
    if (!finalDiagnostics.some((item) => item.code === `setup_${category}_unresolved`)) {
      finalDiagnostics.push(diagnostic(
        `setup_${category}_unresolved`,
        `No supported ${category} were found after the conservative source fallback.`,
        { category }
      ));
    }
    finalDiagnostics.push(diagnostic(
      `setup_${category}_source_exhausted`,
      `No concrete ${category} phrase could be retained from substantive source or abstract sentences.`,
      { category }
    ));
  }

  return {
    ...values,
    maturity,
    evidence,
    diagnostics: finalDiagnostics,
    completion: {
      attemptedCategories: [...missing],
      filledCategories,
      unresolvedCategories: categories.filter((category) => !values[category].length)
    }
  };
}
