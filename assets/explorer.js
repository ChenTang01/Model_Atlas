((root, factory) => {
  const api = factory();
  root.GameTheoryModelAtlas = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis, () => {
  "use strict";

  const values = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const normalize = (value) => String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const stopwords = new Set(["a", "an", "and", "for", "how", "in", "is", "of", "on", "the", "to", "with"]);

  function stem(word) {
    if (word.length > 7 && word.endsWith("ally")) return word.slice(0, -4);
    if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
    if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
    if (word.length > 4 && word.endsWith("s")) return word.slice(0, -1);
    return word;
  }

  function queryTerms(query) {
    return [...new Set(normalize(query).split(/\s+/).filter((term) => term && !stopwords.has(term)).map(stem))];
  }

  const aliases = {
    consumer: ["consumer", "customer"],
    customer: ["customer", "consumer"],
    disclosure: ["disclosure", "disclose", "reveal", "provision"],
    disclose: ["disclosure", "disclose", "reveal", "provision"],
    competition: ["competition", "competitive", "competing", "rivalry"],
    compete: ["competition", "competitive", "competing", "rivalry"],
    platform: ["platform", "marketplace"],
    marketplace: ["marketplace", "platform"]
  };

  function queryGroupSpecs(query) {
    const terms = queryTerms(query);
    const consumerIdea = terms.includes("consumer") || terms.includes("customer");
    return terms.map((term) => {
      let related = aliases[term] || [term];
      if (consumerIdea && term === "strategic") {
        related = ["strategic", "forward", "anticipatory"];
      }
      return {
        term,
        aliases: new Set(related.map((word) => stem(normalize(word))))
      };
    });
  }

  function queryGroups(query) {
    return queryGroupSpecs(query).map((group) => group.aliases);
  }

  function queryAliases(query) {
    return [...new Set(queryGroups(query).flatMap((group) => [...group]))];
  }

  function words(text) {
    return new Set(normalize(text).split(/\s+/).filter(Boolean).map(stem));
  }

  function fuzzyThreshold(term) {
    if (term.length >= 8) return 2;
    if (term.length >= 4) return 1;
    return 0;
  }

  // Optimal-string-alignment distance: adjacent transpositions count as one
  // edit, which catches common search slips such as "platfrom".
  function damerauLevenshtein(left, right, limit = Number.POSITIVE_INFINITY) {
    const a = String(left);
    const b = String(right);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    if (Math.abs(a.length - b.length) > limit) return limit + 1;

    let beforePrevious = null;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
        if (
          beforePrevious
          && i > 1
          && j > 1
          && a[i - 1] === b[j - 2]
          && a[i - 2] === b[j - 1]
        ) {
          current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
        }
      }
      beforePrevious = previous;
      previous = current;
    }
    return previous[b.length];
  }

  function tokenMatchQuality(group, textWords) {
    if (textWords.has(group.term)) return 1;
    if ([...group.aliases].some((alias) => alias !== group.term && textWords.has(alias))) return 0.92;

    const candidates = [...textWords];
    const prefixMatch = (needle) => needle.length >= 4 && candidates.some((word) =>
      word.length >= 4
      && Math.abs(word.length - needle.length) <= 3
      && (word.startsWith(needle) || needle.startsWith(word))
    );
    if (prefixMatch(group.term)) return 0.8;
    if ([...group.aliases].some((alias) => alias !== group.term && prefixMatch(alias))) return 0.72;

    const fuzzyQuality = (needle, base) => {
      const threshold = fuzzyThreshold(needle);
      if (!threshold) return 0;
      let best = threshold + 1;
      for (const word of candidates) {
        if (Math.abs(word.length - needle.length) > threshold) continue;
        best = Math.min(best, damerauLevenshtein(needle, word, threshold));
      }
      return best <= threshold ? base - Math.max(0, best - 1) * 0.08 : 0;
    };
    const direct = fuzzyQuality(group.term, 0.58);
    if (direct) return direct;
    return Math.max(0, ...[...group.aliases]
      .filter((alias) => alias !== group.term)
      .map((alias) => fuzzyQuality(alias, 0.5)));
  }

  function wordMatchesQuery(word, query) {
    const textWords = words(word);
    return queryGroupSpecs(query).some((group) => tokenMatchQuality(group, textWords) > 0);
  }

  function fragmentsFor(paper) {
    const fragments = [];
    const add = (field, label, input, weight = 1) => values(input).forEach((text) => {
      if (String(text ?? "").trim()) fragments.push({ field, label, text: String(text).trim(), weight });
    });

    add("title", "Paper", paper.title, 4);
    add("author", "Authors", paper.authors_text, 1);
    add("journal", "Journal", [paper.journal, paper.journal_code], 3.2);
    add("topic", "Topic", [paper.primary_topic, paper.model_topic, ...(paper.topic_details || []), ...(paper.topics || [])], 2.2);
    add("family", "Model family", [
      ...(paper.topic_families || []),
      ...(paper.evidence_families || []),
      ...(paper.information_families || []),
      ...(paper.equilibrium_families || []),
      ...(paper.method_families || []),
      ...(paper.architecture_families || [])
    ], 1.9);
    add("question", "Research question", paper.business_question, 3);
    add("players", "Players", paper.players, 2.5);
    add("timing", "Timing", paper.timing, 2.6);
    add("actions", "Actions", paper.actions, 2.7);
    add("information", "Information", paper.information, 2.8);
    add("assumptions", "Assumption", paper.assumptions, 3.1);
    add("objective", "Objective", paper.objective?.summary, 2.7);
    add("equilibrium", "Equilibrium", [paper.equilibrium?.label, paper.equilibrium?.evidence], 2.4);
    add("method", "Solution", [paper.method, paper.solution?.summary], 2.2);
    add("architecture", "Game structure", paper.architecture_detail || paper.game_architecture, 1.8);
    add("abstract", "Abstract", paper.abstract, 1.45);
    add("modeling_evidence", "Modeling evidence", paper.modeling_evidence, 2.35);
    add("review_note", "Review note", paper.review_note, 1.15);
    return fragments;
  }

  function fragmentScore(fragment, query) {
    const groups = queryGroupSpecs(query);
    if (!groups.length) return 0;
    const textWords = words(fragment.text);
    const qualities = groups.map((group) => tokenMatchQuality(group, textWords));
    const matches = qualities.filter((quality) => quality > 0);
    if (!matches.length) return 0;
    const phraseBonus = normalize(fragment.text).includes(normalize(query)) ? 8 : 0;
    const coverage = matches.length / groups.length;
    const matchStrength = matches.reduce((sum, quality) => sum + quality, 0);
    return fragment.weight * (2 + matchStrength * 3 + coverage * 4) + phraseBonus;
  }

  function scorePaper(paper, query) {
    const groups = queryGroupSpecs(query);
    if (!groups.length) return null;
    const normalizedQuery = normalize(query);
    if (["mnsc", "mksc", "isr", "msom"].includes(normalizedQuery)
        && normalize(paper.journal_code) !== normalizedQuery) return null;
    const fragments = fragmentsFor(paper);
    const completeText = words(fragments.map((fragment) => fragment.text).join(" "));
    if (!groups.every((group) => tokenMatchQuality(group, completeText) > 0)) return null;
    if (groups.length > 1) {
      const cohesiveMatch = fragments.some((fragment) => {
        const fragmentWords = words(fragment.text);
        return groups.every((group) => tokenMatchQuality(group, fragmentWords) > 0);
      });
      if (!cohesiveMatch) return null;
    }

    const ranked = fragments.map((fragment) => fragmentScore(fragment, query)).sort((a, b) => b - a);
    const phraseBonus = normalize(fragments.map((fragment) => fragment.text).join(" ")).includes(normalize(query)) ? 35 : 0;
    return ranked.slice(0, 5).reduce((sum, score) => sum + score, 0) + phraseBonus;
  }

  function relevantSnippets(paper, query, limit = 3) {
    const groups = queryGroupSpecs(query);
    const ranked = fragmentsFor(paper)
      .filter((fragment) => !["title", "author", "journal", "topic", "family"].includes(fragment.field))
      .map((fragment, index) => ({ ...fragment, score: fragmentScore(fragment, query), index }))
      .filter((fragment) => fragment.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    let ordered = ranked;
    if (groups.length > 1) {
      const cohesive = ranked.filter((fragment) => {
        const fragmentWords = words(fragment.text);
        return groups.every((group) => tokenMatchQuality(group, fragmentWords) > 0);
      });
      if (cohesive.length) {
        const cohesiveIndexes = new Set(cohesive.map((fragment) => fragment.index));
        const contextPriority = {
          actions: 9,
          timing: 8,
          information: 7,
          assumptions: 6,
          objective: 5,
          players: 4,
          equilibrium: 3,
          method: 2,
          question: 1
        };
        const context = ranked
          .filter((fragment) => !cohesiveIndexes.has(fragment.index))
          .sort((a, b) => {
            const coverage = (fragment) => {
              const fragmentWords = words(fragment.text);
              return groups.filter((group) => tokenMatchQuality(group, fragmentWords) > 0).length;
            };
            return coverage(b) - coverage(a)
              || (contextPriority[b.field] || 0) - (contextPriority[a.field] || 0)
              || b.score - a.score
              || a.index - b.index;
          });
        ordered = [...cohesive, ...context];
      }
    }

    const unique = [];
    const usedText = new Set();
    for (const fragment of ordered) {
      const key = normalize(fragment.text);
      if (!usedText.has(key)) {
        unique.push(fragment);
        usedText.add(key);
      }
    }

    // A result card should answer how the queried idea changes the game, not
    // merely repeat an objective or identify a player.  Keep the strongest
    // query match first, but reserve the second slot for a structural modeling
    // choice whenever one is available.
    const structuralFields = new Set(["actions", "timing", "information", "assumptions"]);
    let displayOrder = unique;
    if (limit > 1 && unique.length > 1 && !structuralFields.has(unique[0].field)) {
      const structuralPriority = { actions: 4, timing: 3, information: 2, assumptions: 1 };
      const structural = unique
        .filter((fragment) => structuralFields.has(fragment.field))
        .sort((a, b) => structuralPriority[b.field] - structuralPriority[a.field] || b.score - a.score)[0];
      if (structural) {
        displayOrder = [unique[0], structural, ...unique.filter((fragment) => fragment !== unique[0] && fragment !== structural)];
      }
    }
    const selected = displayOrder.slice(0, limit);

    if (!selected.length) {
      const fallback = fragmentsFor(paper).find((fragment) => fragment.field === "question");
      if (fallback) selected.push({ ...fallback, score: 0 });
    }
    return selected;
  }

  function matchingPaperIds(records, query) {
    return records
      .map((paper) => ({ id: paper.id, score: scorePaper(paper, query) }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
      .map((entry) => entry.id);
  }

  function safeDoiURL(value) {
    try {
      const url = new URL(String(value ?? ""));
      return url.protocol === "https:" && url.hostname.toLocaleLowerCase() === "doi.org" ? url.href : "";
    } catch {
      return "";
    }
  }

  function timingSteps(text) {
    const source = String(text ?? "").trim();
    if (!source) return [];
    const semicolonParts = source.split(/;\s+/).map((part) => part.trim()).filter(Boolean);
    return semicolonParts.length > 1 ? semicolonParts : [source];
  }

  function notationEntries(value) {
    return values(value).map((entry) => {
      if (typeof entry === "string") {
        return { symbol: "", meaning: entry.trim(), domain: "", role: "", source: "" };
      }
      if (!entry || typeof entry !== "object") return null;
      return {
        symbol: String(entry.symbol ?? "").trim(),
        meaning: String(entry.meaning ?? "").trim(),
        domain: String(entry.domain ?? "").trim(),
        role: String(entry.role ?? "").trim(),
        source: String(entry.source ?? "").trim()
      };
    }).filter((entry) => entry && (entry.symbol || entry.meaning));
  }

  const MODEL_TYPE_RULES = Object.freeze([
    ["Game theory", /\b(game|equilibrium|nash|stackelberg|auction|mechanism design|bargain|signaling|screening|competition)\b/i],
    ["Optimization", /\b(optimization|optimisation|programming|optimal control|robust|integer program|linear program|convex|decomposition)\b/i],
    ["Stochastic model", /\b(stochastic|markov|mdp|random process|dynamic program|renewal|diffusion|brownian|poisson)\b/i],
    ["Queueing", /\b(queue|queueing|queuing|waiting time|arrival rate|service rate|congestion)\b/i],
    ["Simulation", /\b(simulation|simulator|agent-based|monte carlo)\b/i],
    ["Structural model", /\b(structural|demand estimation|choice model|random coefficients|maximum likelihood|econometric)\b/i],
    ["Learning & algorithms", /\b(learning|algorithm|bandit|reinforcement|neural|online policy|approximation algorithm|heuristic)\b/i],
    ["Economic theory", /\b(economic theory|consumer|pricing|market|welfare|contract|incentive|utility)\b/i]
  ]);

  function modelTypesFor(paper, note) {
    if (Array.isArray(note?.modelTypes) && note.modelTypes.length) return [...new Set(note.modelTypes)];
    const source = [
      paper.scope,
      paper.model_topic,
      paper.method,
      paper.equilibrium?.label,
      ...values(paper.topic_details),
      ...values(paper.topic_families),
      ...values(paper.evidence_families),
      ...values(paper.method_families),
      ...values(paper.architecture_families),
      ...values(paper.information_families)
    ].join(" ");
    const types = MODEL_TYPE_RULES.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
    if (paper.strict_game_theory && !types.includes("Game theory")) types.unshift("Game theory");
    return types.length ? types : ["Economic theory"];
  }

  const richStopwords = new Set("a an the of to in on for and or how is are was were be being with by as at from model models modeled modelling modeling paper papers study studies does do can using use into this that it".split(" "));
  const applicabilityOrder = Object.freeze({ modeled: 0, unclassified: 1, explicitlyExcluded: 2, backgroundOnly: 3, unknown: 4 });
  const searchNormalize = (value) => String(value ?? "")
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‐‑–—]/g, "-");
  const searchTokens = (value) => (searchNormalize(value).match(/[a-z0-9]+/g) || [])
    .filter((word) => !richStopwords.has(word))
    .map(stem);
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const phrasePattern = (value) => escapeRegex(searchNormalize(value).trim()).replace(/\s+/g, "\\s+");
  const hasPhrase = (text, phrase) => Boolean(searchNormalize(phrase).trim())
    && new RegExp(`(^|[^a-z0-9])${phrasePattern(phrase)}(?=$|[^a-z0-9])`).test(searchNormalize(text));
  const restriction = (text) => /\b(?:no|not|without|neither|nor|never|except|excluding|only|unless|conditional|restricted|restricts|rather than)\b|\bnon[ -]/i.test(text);

  // NFKD can expand a single source character (for example, the ligature "ﬁ").
  // Search offsets therefore retain the corresponding UTF-16 span in the
  // unmodified source string instead of indexing normalized offsets directly.
  function indexedText(text) {
    const source = String(text ?? "");
    return { source, normalized: searchNormalize(source) };
  }

  function sourceRange(indexed, start, end) {
    if (indexed.source.length === indexed.normalized.length) return { start, end };
    let normalizedOffset = 0;
    let sourceOffset = 0;
    let mappedStart;
    let mappedEnd;
    for (const character of indexed.source) {
      const nextNormalizedOffset = normalizedOffset + searchNormalize(character).length;
      if (mappedStart === undefined && start < nextNormalizedOffset) mappedStart = sourceOffset;
      if (end <= nextNormalizedOffset) {
        mappedEnd = sourceOffset + character.length;
        break;
      }
      normalizedOffset = nextNormalizedOffset;
      sourceOffset += character.length;
    }
    return Number.isInteger(mappedStart) && Number.isInteger(mappedEnd) && mappedEnd > mappedStart
      ? { start: mappedStart, end: mappedEnd }
      : null;
  }

  function phraseRanges(indexed, query) {
    if (!query) return [];
    const regex = new RegExp(`(^|[^a-z0-9])(${phrasePattern(query)})(?=$|[^a-z0-9])`, "g");
    const ranges = [];
    for (const match of indexed.normalized.matchAll(regex)) {
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      const range = sourceRange(indexed, start, end);
      if (range) ranges.push(range);
    }
    return ranges;
  }

  function mergeRanges(ranges) {
    const sorted = ranges
      .filter((range) => Number.isInteger(range.start) && Number.isInteger(range.end) && range.end > range.start)
      .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [];
    for (const range of sorted) {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
    }
    return merged;
  }

  function createSearchIndex(records, notePayload = {}) {
    const concepts = values(notePayload.concepts).filter((concept) => concept && typeof concept === "object");
    const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]));
    const notesById = new Map();
    for (const note of values(notePayload.papers)) {
      if (!note || typeof note !== "object") continue;
      if (note.id) notesById.set(note.id, note);
      if (note.sourceId) notesById.set(note.sourceId, note);
    }

    const entries = records.map((paper) => {
      const candidate = notesById.get(paper.id);
      const note = candidate && Array.isArray(candidate.models) && candidate.models.length ? candidate : null;
      return {
        paper,
        note,
        modelTypes: modelTypesFor(paper, note),
        maturity: note ? "structured" : paper.detail_level === "model_map" ? "model_map" : "literature"
      };
    });
    const entryByPaper = new Map(entries.map((entry) => [entry.paper, entry]));
    const docs = [];
    const vocabulary = new Set();
    const documentFrequency = new Map();
    const postings = new Map();
    const modelKnowledge = new WeakMap();

    const array = (value) => Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
    const field = (uiField, schemaField, fieldLabel, text, weight, target, relevance, fieldIndex, origin = {}) => {
      const source = String(text ?? "").trim();
      if (!source) return null;
      return {
        uiField,
        schemaField,
        fieldLabel,
        text: source,
        weight,
        target,
        relevance,
        fieldIndex,
        ...origin
      };
    };
    const fieldValues = (uiField, schemaField, fieldLabel, items, weight, target, relevance, origin = {}) => array(items)
      .map((item, fieldIndex) => {
        const text = origin.member && item && typeof item === "object" ? item[origin.member] : item;
        return field(uiField, schemaField, fieldLabel, text, weight, target, relevance, fieldIndex, origin);
      })
      .filter(Boolean);

    function addDoc(entry, model, component, scope, fields, knowledge = null, modelConcepts = new Set()) {
      const usable = fields.filter(Boolean);
      if (!usable.length) return;
      const tf = new Map();
      for (const value of usable) {
        for (const token of searchTokens(value.text)) tf.set(token, (tf.get(token) || 0) + value.weight);
      }
      const index = docs.length;
      for (const token of tf.keys()) {
        vocabulary.add(token);
        documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
        if (!postings.has(token)) postings.set(token, []);
        postings.get(token).push(index);
      }
      docs.push({
        entry,
        paper: entry.paper,
        note: entry.note,
        model,
        component,
        scope,
        fields: usable,
        tf,
        knowledge,
        modelConcepts,
        length: [...tf.values()].reduce((sum, count) => sum + count, 0)
      });
    }

    function knowledgeFor(model) {
      const knowledge = {
        entries: array(model?.components).flatMap((component) => array(component.conceptBindings).map((binding, bindingIndex) => ({
          binding,
          bindingIndex,
          component,
          model
        }))),
        conceptIds: new Set(array(model?.components).flatMap((component) => [
          ...array(component.concepts),
          ...array(component.conceptBindings).map((binding) => binding.conceptId)
        ]).filter(Boolean))
      };
      modelKnowledge.set(model, knowledge);
      return knowledge;
    }

    function uniqueConceptTerms(concept) {
      const seen = new Set();
      return [concept?.label, ...array(concept?.aliases)].filter((term) => {
        const key = searchNormalize(term).trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    for (const entry of entries) {
      const { paper, note } = entry;
      if (note) {
        const models = array(note.models);
        const paperConcepts = new Set();
        for (const model of models) {
          const knowledge = knowledgeFor(model);
          knowledge.conceptIds.forEach((id) => paperConcepts.add(id));
        }
        for (const model of models) {
          const knowledge = modelKnowledge.get(model);
          for (const component of array(model.components)) {
            const target = { kind: "structured", modelId: model.id, componentId: component.id, section: "component" };
            const componentFields = [
              field("componentLabel", "label", "Component label", component.label, 4, target, "Direct component match")
            ];
            if (Array.isArray(component.conceptBindings)) {
              component.conceptBindings.forEach((binding, bindingIndex) => {
                const concept = conceptsById.get(binding.conceptId);
                const bindingTarget = { ...target, bindingIndex, conceptId: binding.conceptId };
                uniqueConceptTerms(concept).forEach((term, fieldIndex) => componentFields.push(field(
                  "concept",
                  "concepts",
                  "Concept alias",
                  term,
                  4,
                  bindingTarget,
                  binding.status === "modeled" ? "Direct concept match" : "Scoped concept contrast",
                  fieldIndex,
                  { bindingIndex, conceptId: binding.conceptId }
                )));
                componentFields.push(field(
                  "representation",
                  "representation",
                  "Concept representation",
                  binding.representation,
                  3,
                  bindingTarget,
                  binding.status === "modeled" ? "Mapped concept representation" : "Scoped concept contrast",
                  bindingIndex,
                  { bindingIndex, conceptId: binding.conceptId }
                ));
              });
            } else {
              for (const conceptId of array(component.concepts)) {
                uniqueConceptTerms(conceptsById.get(conceptId)).forEach((term, fieldIndex) => componentFields.push(field(
                  "concept", "concepts", "Concept alias", term, 4, target, "Concept vocabulary match", fieldIndex, { conceptId }
                )));
              }
            }
            componentFields.push(
              ...fieldValues("searchPhrases", "searchPhrases", "Scenario description", component.searchPhrases, 4, target, "Direct scenario match"),
              field("explanation", "explanation", "Component explanation", component.explanation, 2.2, target, "Mapped mechanism"),
              field("formal", "formal", "Model formulation", component.formal, 2.2, target, "Direct formulation"),
              ...fieldValues("conditions", "conditions", "Model condition", component.conditions, 2.2, target, "Mapped condition"),
              ...fieldValues("symbols", "symbols", "Symbol meaning", component.symbols, 2.2, target, "Notation match", { member: "meaning" })
            );
            addDoc(entry, model, component, "component", componentFields, knowledge, knowledge.conceptIds);
          }
          const setupTarget = { kind: "structured", modelId: model.id, section: "setup" };
          addDoc(entry, model, array(model.components)[0] || null, "model", [
            field("modelName", "name", "Model name", model.name, 0.65, setupTarget, "Model-variant context"),
            field("modelSummary", "summary", "Model summary", model.summary, 0.65, setupTarget, "Model-context match"),
            ...fieldValues("objects", "objects", "Model entity", model.objects, 0.65, setupTarget, "Model-context match"),
            ...fieldValues("inputs", "inputs", "Model input", model.inputs, 0.65, setupTarget, "Model-context match"),
            ...fieldValues("decisions", "decisions", "Model decision or state", model.decisions, 0.65, setupTarget, "Model-context match"),
            ...fieldValues("modelAssumptions", "assumptions", "Model assumption", model.assumptions, 0.65, setupTarget, "Model-context match"),
            field("modelMethod", "method", "Model method", model.method, 0.65, { ...setupTarget, section: "method" }, "Method match")
          ], knowledge, knowledge.conceptIds);
        }
        addDoc(entry, models[0] || null, array(models[0]?.components)[0] || null, "note", [
          field("question", "question", "Research question", note.question, 0.65, { kind: "structured", section: "overview" }, "Mapped research question"),
          field("overview", "overview", "Modeling overview", note.overview, 0.65, { kind: "structured", section: "overview" }, "Mapped model overview")
        ], null, paperConcepts);
      } else if (paper.detail_level === "model_map") {
        addDoc(entry, null, null, "legacy", [
          field("question", "business_question", "Research question", paper.business_question, 3, { kind: "legacy", section: "overview" }, "Mapped research question")
        ]);
        addDoc(entry, null, null, "legacy", [
          ...fieldValues("players", "players", "Entities", paper.players, 2.5, { kind: "legacy", section: "setting" }, "Mapped entities"),
          ...fieldValues("actions", "actions", "Decisions", paper.actions, 2.9, { kind: "legacy", section: "setting" }, "Mapped decisions"),
          ...fieldValues("architecture", "architecture_detail", "Model architecture", paper.architecture_detail || paper.game_architecture, 2.4, { kind: "legacy", section: "setting" }, "Mapped architecture")
        ]);
        addDoc(entry, null, null, "legacy", [
          field("timing", "timing", "Timing", paper.timing, 2.8, { kind: "legacy", section: "timing" }, "Mapped timing"),
          ...fieldValues("information", "information", "Information", paper.information, 2.8, { kind: "legacy", section: "timing" }, "Mapped information")
        ]);
        addDoc(entry, null, null, "legacy", [
          ...fieldValues("assumptions", "assumptions", "Assumption", paper.assumptions, 3.1, { kind: "legacy", section: "assumptions" }, "Mapped condition"),
          field("caveat", "caveat", "Model boundary", paper.caveat, 2.2, { kind: "legacy", section: "assumptions" }, "Mapped boundary")
        ]);
        addDoc(entry, null, null, "legacy", [
          field("objective", "objective", "Objective", paper.objective?.summary, 2.9, { kind: "legacy", section: "objective" }, "Mapped objective"),
          field("formula", "objective", "Formulation", paper.objective?.formula, 3.2, { kind: "legacy", section: "objective" }, "Direct formulation"),
          ...fieldValues("notation", "notation", "Symbol meaning", paper.notation, 2.2, { kind: "legacy", section: "objective" }, "Notation match", { member: "meaning" })
        ]);
        addDoc(entry, null, null, "legacy", fieldValues("equilibrium", "equilibrium", "Solution concept", [paper.equilibrium?.label, paper.equilibrium?.evidence], 2.7, { kind: "legacy", section: "equilibrium" }, "Mapped solution concept"));
        addDoc(entry, null, null, "legacy", [
          field("method", "method", "Solution or estimation method", paper.method, 2.6, { kind: "legacy", section: "solution" }, "Method match"),
          field("solution", "solution", "Result", paper.solution?.summary, 2.3, { kind: "legacy", section: "solution" }, "Mapped result"),
          field("calibration", "calibration", "Calibration or validation", paper.calibration?.summary, 1.8, { kind: "legacy", section: "solution" }, "Validation context")
        ]);
      } else {
        addDoc(entry, null, null, "literature", [
          field("question", "business_question", "Research focus", paper.business_question || paper.model_topic, 2.5, { kind: "literature", section: "overview" }, "Screened research focus")
        ]);
        addDoc(entry, null, null, "literature", [
          field("modeling_evidence", "modeling_evidence", "Modeling evidence", paper.modeling_evidence, 3, { kind: "literature", section: "evidence" }, "Screened modeling evidence")
        ]);
        addDoc(entry, null, null, "literature", [
          field("abstract", "abstract", "Abstract", paper.abstract, 1.8, { kind: "literature", section: "abstract" }, "Abstract context")
        ]);
      }

      addDoc(entry, entry.note?.models?.[0] || null, entry.note?.models?.[0]?.components?.[0] || null, "metadata", [
        field("title", "title", "Paper title", paper.title, 0.65, { kind: "bibliography", section: "title" }, "Bibliographic match"),
        field("authors", "authors", "Author", paper.authors_text || array(paper.authors).join(", "), 0.65, { kind: "bibliography", section: "authors" }, "Bibliographic match"),
        field("doi", "doi", "DOI", paper.doi, 0.65, { kind: "bibliography", section: "doi" }, "Bibliographic match"),
        field("journal", "journal", "Journal", paper.journal, 0.65, { kind: "bibliography", section: "publication" }, "Bibliographic match", 0),
        field("journal", "journalCode", "Journal", paper.journal_code || paper.journalCode, 0.65, { kind: "bibliography", section: "publication" }, "Bibliographic match", 1),
        field("journal", "year", "Journal", paper.year, 0.65, { kind: "bibliography", section: "publication" }, "Bibliographic match", 2)
      ], null, new Set(entry.note?.models?.flatMap((model) => [...(modelKnowledge.get(model)?.conceptIds || [])]) || []));
      addDoc(entry, entry.note?.models?.[0] || null, entry.note?.models?.[0]?.components?.[0] || null, "catalog", [
        ...fieldValues("topic", "topics", "Topic", [paper.primary_topic, paper.model_topic, ...array(paper.topic_details), ...array(paper.topics)], 0.65, { kind: "catalog", section: "overview" }, "Topic connection"),
        ...fieldValues("family", "topicFamilies", "Research family", [
          ...array(paper.topic_families),
          ...array(paper.evidence_families),
          ...array(paper.information_families),
          ...array(paper.equilibrium_families),
          ...array(paper.method_families),
          ...array(paper.architecture_families)
        ], 0.65, { kind: "catalog", section: "overview" }, "Research-family connection"),
        field("review_note", "review_note", "Supporting scope context", paper.review_note, 0.65, { kind: "catalog", section: "overview" }, "Scope-review context")
      ], null, new Set(entry.note?.models?.flatMap((model) => [...(modelKnowledge.get(model)?.conceptIds || [])]) || []));
    }

    const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / (docs.length || 1);
    const vocabularyArray = [...vocabulary].sort();

    function variantsFor(queryTokens) {
      const corrections = [];
      const consumerIdea = queryTokens.includes("consumer") || queryTokens.includes("customer");
      const variants = queryTokens.map((token) => {
        let semantic = aliases[token] || [token];
        if (consumerIdea && token === "strategic") semantic = ["strategic", "forward", "anticipatory"];
        const direct = [...new Set([token, ...semantic.flatMap(searchTokens)])].filter((term) => vocabulary.has(term));
        if (direct.length) return { terms: direct, type: direct.includes(token) ? "Lexical match" : "Alias-expanded" };
        if (!/^[a-z]{4,}$/.test(token)) return { terms: [token], type: "Lexical match" };
        const prefixes = vocabularyArray.filter((term) => term.startsWith(token) && term.length - token.length <= 5).slice(0, 8);
        if (prefixes.length) return { terms: prefixes, type: "Prefix-expanded" };
        const limit = token.length >= 8 ? 2 : 1;
        const nearby = vocabularyArray
          .filter((term) => /^[a-z]+$/.test(term) && Math.abs(term.length - token.length) <= limit && damerauLevenshtein(token, term, limit) <= limit)
          .sort((left, right) => damerauLevenshtein(token, left, limit) - damerauLevenshtein(token, right, limit) || left.localeCompare(right))
          .slice(0, 3);
        if (nearby.length) corrections.push({ from: token, to: nearby[0] });
        return { terms: nearby.length ? nearby : [token], type: nearby.length ? "Typo-expanded" : "Lexical match" };
      });
      return { variants, corrections };
    }

    function entryPasses(entry, filters) {
      if (filters.journal && (entry.paper.journal_code || entry.paper.journalCode) !== filters.journal) return false;
      if (filters.type && !entry.modelTypes.includes(filters.type)) return false;
      if (filters.level && entry.maturity !== filters.level) return false;
      if (filters.concept) {
        if (!entry.note) return false;
        const modeled = entry.note.models.some((model) => array(model.components).some((component) =>
          array(component.concepts).includes(filters.concept)
          || array(component.conceptBindings).some((binding) => binding.conceptId === filters.concept && binding.status === "modeled")));
        if (!modeled) return false;
      }
      return true;
    }

    function modeledComponents(entry, conceptId) {
      if (!entry.note) return [];
      return entry.note.models.flatMap((model) => array(model.components)
        .filter((component) => array(component.concepts).includes(conceptId)
          || array(component.conceptBindings).some((binding) => binding.conceptId === conceptId && binding.status === "modeled"))
        .map((component) => ({ model, component })));
    }

    function noteProvenance(entry) {
      if (!entry?.note) return "Catalog record";
      return entry.note.provenance?.bindingReviewStatus === "automated-source-map"
        ? "Automated source map"
        : "Editorial note";
    }

    function browseHit(entry, model = null, component = null) {
      const target = entry.note
        ? { kind: "structured", ...(model ? { modelId: model.id } : {}), ...(component ? { componentId: component.id, section: "component" } : { section: "overview" }) }
        : { kind: entry.maturity === "model_map" ? "legacy" : "literature", section: "overview" };
      const text = entry.note?.question || entry.paper.business_question || entry.paper.model_topic || entry.paper.title;
      const match = {
        scope: component ? "component" : "browse",
        field: "browse",
        fieldLabel: "Paper",
        fieldIndex: undefined,
        text,
        ranges: [],
        type: "Browse",
        provenance: noteProvenance(entry),
        caution: null,
        applicability: "unclassified",
        conflict: false,
        mixedScopes: false,
        bindings: [],
        bindingRefs: [],
        representation: "",
        conditionTexts: [],
        reviewStatus: null,
        representationRef: null
      };
      return {
        paper: entry.paper,
        model: model || entry.note?.models?.[0] || null,
        component: component || model?.components?.[0] || entry.note?.models?.[0]?.components?.[0] || null,
        scope: match.scope,
        tier: 8,
        score: 0,
        coverage: 1,
        applicabilityGroup: "unclassified",
        conceptHits: [],
        matched: [],
        partial: false,
        reason: "Paper · Browse",
        match,
        field: "browse",
        label: "Paper",
        text,
        ranges: [],
        target,
        relevance: entry.note ? "Structured model note" : entry.maturity === "model_map" ? "Deep model map" : "Evidence-index record",
        applicability: "unclassified",
        status: "unclassified",
        exact: false,
        expansion: ""
      };
    }

    function browse(filters, sourceQuery) {
      const grouped = [];
      let componentCount = 0;
      for (const entry of entries) {
        if (!entryPasses(entry, filters)) continue;
        const hits = filters.concept
          ? modeledComponents(entry, filters.concept).map(({ model, component }) => browseHit(entry, model, component))
          : [browseHit(entry)];
        if (!hits.length) continue;
        componentCount += filters.concept ? hits.length : 0;
        const bestHit = hits[0];
        grouped.push({
          paper: entry.paper,
          note: entry.note,
          modelTypes: entry.modelTypes,
          score: bestHit.score,
          tier: bestHit.tier,
          coverage: bestHit.coverage,
          applicabilityGroup: "unclassified",
          rank: grouped.length + 1,
          bestHit,
          hits
        });
      }
      return { results: grouped, mapped: [], corrections: [], warnings: [], componentCount, contextCount: 0, query: sourceQuery };
    }

    function candidateDocs(variants) {
      if (!variants.length) return docs;
      const candidates = new Set();
      for (const variant of variants) {
        for (const term of variant.terms) for (const index of postings.get(term) || []) candidates.add(index);
      }
      return [...candidates].sort((left, right) => left - right).map((index) => docs[index]);
    }

    function search(query, filters = {}) {
      const sourceQuery = String(query ?? "").trim();
      if (!sourceQuery) return browse(filters, sourceQuery);
      const normalizedQuery = searchNormalize(sourceQuery).trim();
      const queryTokens = [...new Set(searchTokens(normalizedQuery))];
      const warnings = /\b(without|not|no|exclude|excluding|except)\b/.test(normalizedQuery)
        ? ["Negation is not interpreted. These are lexical matches, not confirmation that a condition is absent."]
        : [];
      const { variants, corrections } = variantsFor(queryTokens);
      const candidateAliasMatches = concepts.flatMap((concept) => uniqueConceptTerms(concept).flatMap((alias) => {
        const aliasTokens = [...new Set(searchTokens(alias))];
        const exact = hasPhrase(normalizedQuery, alias);
        const expanded = aliasTokens.length && aliasTokens.every((token) => variants.some((variant) => variant.terms.includes(token)));
        return exact || expanded ? [{ concept, alias, aliasTokens, exact }] : [];
      }));
      // An exact concept phrase is stronger than a generic alias that happens
      // to cover only part of the query (for example, "model constraint"
      // inside "budget constraints"). Keep every exact concept in a genuine
      // multi-concept query, but do not let weaker subset aliases make the
      // coherence gate discard the exact match.
      const exactConceptIds = new Set(candidateAliasMatches.filter((match) => match.exact).map((match) => match.concept.id));
      const aliasMatches = exactConceptIds.size
        ? candidateAliasMatches.filter((match) => match.exact)
        : candidateAliasMatches;
      const mapped = concepts.filter((concept) => aliasMatches.some((match) => match.concept.id === concept.id));
      const coveredByAlias = new Set();
      for (const aliasMatch of aliasMatches) {
        queryTokens.forEach((token, index) => {
          if (aliasMatch.aliasTokens.some((aliasToken) => variants[index]?.terms.includes(aliasToken))) coveredByAlias.add(token);
        });
      }
      const residualTokens = queryTokens.filter((token) => !coveredByAlias.has(token));
      const requestedIds = new Set(mapped.map((concept) => concept.id));

      function resolveStatus(bindingEntries) {
        const statuses = new Set(bindingEntries.map((entry) => entry.binding.status));
        if (statuses.has("modeled") && statuses.has("explicitlyExcluded")) return { status: "unknown", conflict: true };
        for (const status of ["modeled", "explicitlyExcluded", "unknown", "backgroundOnly"]) {
          if (statuses.has(status)) return { status, conflict: false };
        }
        return { status: "unclassified", conflict: false };
      }

      function applicability(doc, evidence) {
        if (!doc.knowledge || !doc.model || !["component", "model"].includes(doc.scope)) {
          return { status: "unclassified", entries: [], best: null, conflict: false, mixedScopes: false };
        }
        let candidates = doc.knowledge.entries.filter((entry) => requestedIds.has(entry.binding.conceptId));
        if (!candidates.length && evidence.value.schemaField === "representation" && queryTokens.length >= 3 && evidence.covered.size === queryTokens.length) {
          candidates = doc.knowledge.entries.filter((entry) => entry.component === doc.component && entry.bindingIndex === evidence.value.bindingIndex);
        }
        if (!candidates.length) return { status: "unclassified", entries: [], best: null, conflict: false, mixedScopes: false };
        const relevantIds = requestedIds.size ? [...requestedIds] : [...new Set(candidates.map((entry) => entry.binding.conceptId))];
        const selectedEntries = [];
        const statuses = [];
        let mixedScopes = false;
        for (const id of relevantIds) {
          const pool = candidates.filter((entry) => entry.binding.conceptId === id);
          const groups = [...new Set(pool.map((entry) => entry.component))].map((component) => {
            const scoped = pool.filter((entry) => entry.component === component);
            return { entries: scoped, ...resolveStatus(scoped) };
          });
          mixedScopes ||= new Set(groups.map((group) => group.status)).size > 1;
          const local = doc.scope === "component" && groups.find((group) => group.entries[0].component === doc.component);
          const selected = local || [...groups].sort((left, right) => applicabilityOrder[left.status] - applicabilityOrder[right.status])[0];
          statuses.push(selected || { status: "unclassified", conflict: false });
          if (selected) selectedEntries.push(...(doc.scope === "model" ? pool : selected.entries));
        }
        const localEntries = selectedEntries.filter((entry) => doc.scope === "model" || entry.component === doc.component);
        const conflict = statuses.some((status) => status.conflict);
        let status = conflict ? "unknown"
          : statuses.some((item) => item.status === "explicitlyExcluded") ? "explicitlyExcluded"
            : statuses.some((item) => item.status === "unknown") ? "unknown"
              : statuses.some((item) => item.status === "backgroundOnly") ? "backgroundOnly"
                : statuses.every((item) => item.status === "modeled") ? "modeled" : "unclassified";
        if (doc.scope === "component" && !localEntries.length && status === "modeled") status = "unclassified";
        const bindingRelevance = (entry) => {
          const concept = conceptsById.get(entry.binding.conceptId);
          return (concept && uniqueConceptTerms(concept).some((alias) => hasPhrase(evidence.value.text, alias)) ? 100 : 0)
            + queryTokens.filter((token, index) => searchTokens(entry.binding.representation).some((word) => variants[index]?.terms.includes(word))).length;
        };
        const best = localEntries.find((entry) => entry.bindingIndex === evidence.value.bindingIndex && entry.component === doc.component)
          || [...localEntries].sort((left, right) => (doc.scope === "model" ? Number(right.binding.status === status) - Number(left.binding.status === status) : 0)
            || bindingRelevance(right) - bindingRelevance(left)
            || Number(right.binding.status === status) - Number(left.binding.status === status))[0]
          || null;
        return { status, entries: selectedEntries, best, conflict, mixedScopes };
      }

      function inspectField(value) {
        // Keep the permanent index compact. Exact source offsets are only needed
        // for fields in candidate documents, so derive their Unicode-safe map at
        // query time instead of retaining two offsets for every indexed character.
        const indexed = indexedText(value.text);
        const covered = new Set();
        const ranges = [];
        let expandedType = "";
        for (const match of indexed.normalized.matchAll(/[a-z0-9]+/g)) {
          if (richStopwords.has(match[0])) continue;
          const word = { token: stem(match[0]), start: match.index, end: match.index + match[0].length };
          let matched = false;
          variants.forEach((variant, index) => {
            if (!variant.terms.includes(word.token)) return;
            matched = true;
            covered.add(queryTokens[index]);
            if (variant.type === "Typo-expanded" || ((variant.type === "Prefix-expanded" || variant.type === "Alias-expanded") && !expandedType)) expandedType = variant.type;
          });
          if (matched) {
            const range = sourceRange(indexed, word.start, word.end);
            if (range) ranges.push(range);
          }
        }
        const exactRanges = normalizedQuery.length >= 3 ? phraseRanges(indexed, normalizedQuery) : [];
        return { value, covered, ranges: mergeRanges(exactRanges.length ? exactRanges : ranges), exact: exactRanges.length > 0, expandedType };
      }

      function tierFor(doc, evidence, aliasMatched) {
        if (doc.scope === "component") {
          const curated = (evidence.exact && evidence.value.schemaField === "searchPhrases" && queryTokens.length >= 3)
            || (aliasMatched && evidence.covered.size === queryTokens.length);
          return curated ? 1 : 2;
        }
        if (doc.scope === "legacy") return ["formula", "objective", "equilibrium", "actions", "timing", "information", "assumptions"].includes(evidence.value.uiField) ? 2 : 3;
        if (doc.scope === "model" || doc.scope === "note" || doc.scope === "literature") return 3;
        return 4;
      }

      function relevanceFor(value, aliasMatched, applied) {
        if (value.uiField === "concept") {
          if (!aliasMatched) return "Concept vocabulary match";
          return applied.status === "modeled" ? "Direct concept match" : "Scoped concept contrast";
        }
        if (value.uiField === "representation") return applied.status === "modeled" ? "Mapped concept representation" : "Scoped concept contrast";
        return value.relevance;
      }

      const scored = [];
      for (const doc of candidateDocs(variants)) {
        if (!entryPasses(doc.entry, filters)) continue;
        if (filters.concept) {
          const modeledIn = (model) => array(model?.components).some((component) => array(component.concepts).includes(filters.concept)
            || array(component.conceptBindings).some((binding) => binding.conceptId === filters.concept && binding.status === "modeled"));
          if (doc.scope === "component") {
            if (!array(doc.component?.concepts).includes(filters.concept)
              && !array(doc.component?.conceptBindings).some((binding) => binding.conceptId === filters.concept && binding.status === "modeled")) continue;
          } else if (doc.model ? !modeledIn(doc.model) : !doc.entry.note?.models?.some(modeledIn)) continue;
        }

        const inspected = doc.fields.map(inspectField);
        const matchedTerms = new Set(inspected.flatMap((item) => [...item.covered]));
        const coverage = queryTokens.length ? matchedTerms.size / queryTokens.length : 0;
        const localConceptIds = new Set([
          ...array(doc.component?.concepts),
          ...array(doc.component?.conceptBindings).map((binding) => binding.conceptId)
        ]);
        const conceptHits = doc.scope === "component" ? mapped.filter((concept) => localConceptIds.has(concept.id)) : [];
        const exact = inspected.some((item) => item.exact);

        if (doc.entry.note && mapped.length > 1) {
          const coherent = (model) => mapped.every((concept) => modelKnowledge.get(model)?.conceptIds.has(concept.id));
          const hasKnownConcept = doc.entry.note.models.some((model) => mapped.some((concept) => modelKnowledge.get(model)?.conceptIds.has(concept.id)));
          if (hasKnownConcept && !(doc.model ? coherent(doc.model) : doc.entry.note.models.some(coherent))) continue;
        }
        if (doc.entry.note && !exact && mapped.length) {
          const coherentHere = doc.model
            ? mapped.every((concept) => modelKnowledge.get(doc.model)?.conceptIds.has(concept.id))
            : doc.entry.note.models.some((model) => mapped.every((concept) => modelKnowledge.get(model)?.conceptIds.has(concept.id)));
          if (!coherentHere || (doc.scope === "component" && !conceptHits.length)) continue;
        }
        if (!exact && mapped.length && residualTokens.length
          && residualTokens.filter((token) => matchedTerms.has(token)).length / residualTokens.length < 0.65) continue;
        if (!exact && !conceptHits.length && (!queryTokens.length || coverage < 0.75)) continue;
        if (!matchedTerms.size && !exact) continue;

        let score = 0;
        variants.forEach((variant) => {
          let best = 0;
          for (const token of variant.terms) {
            const frequency = doc.tf.get(token) || 0;
            if (!frequency) continue;
            const df = documentFrequency.get(token) || 0;
            const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
            best = Math.max(best, idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * doc.length / averageLength)));
          }
          score += best;
        });
        score = (score + conceptHits.length * 8 + (exact ? 15 : 0)) * (0.5 + 0.5 * coverage);

        const evidence = inspected
          .filter((item) => item.covered.size || item.exact)
          .sort((left, right) => Number(right.exact) - Number(left.exact)
            || right.covered.size - left.covered.size
            || Number(["concepts", "searchPhrases"].includes(right.value.schemaField)) - Number(["concepts", "searchPhrases"].includes(left.value.schemaField))
            || right.value.weight - left.value.weight
            || doc.fields.indexOf(left.value) - doc.fields.indexOf(right.value))[0];
        if (!evidence) continue;
        const aliasMatched = evidence.value.schemaField === "concepts"
          && aliasMatches.some((match) => searchNormalize(match.alias) === searchNormalize(evidence.value.text));
        const type = evidence.expandedType || (aliasMatched ? "Concept alias" : evidence.exact ? "Exact phrase" : "Lexical match");
        const applied = applicability(doc, evidence);
        let caution = warnings.length
          ? "The query contains negation, which is not interpreted. This match does not confirm that a condition is absent."
          : null;
        if (applied.conflict) caution = "Conflicting modeled and excluded annotations exist for the same component and concept. Applicability is unresolved; inspect the linked concept notes.";
        else if (applied.status === "explicitlyExcluded") caution = "This concept is explicitly excluded in the cited component annotation; this is a contrast, not an example of how it is modeled.";
        else if (applied.status === "backgroundOnly") caution = "This concept is mentioned as background or a separate extension, not modeled in this model record.";
        else if (applied.status === "unknown") caution = doc.entry.note?.provenance?.bindingReviewStatus === "automated-source-map"
          ? "Applicability has not been established by this component's automated source map. Unknown does not mean absent."
          : "Applicability has not been established by the editorial notes. Unknown does not mean absent.";
        else if (doc.scope === "model" && applied.mixedScopes && !caution) caution = "Applicability differs across components of this model. Inspect each scoped concept annotation rather than treating all entities alike.";
        else if (applied.status !== "modeled" && !caution && restriction(evidence.value.text)) caution = "This statement contains a restriction or negation. Read it in full; a lexical match does not establish that the queried feature is included.";

        const bestBinding = applied.best?.binding;
        const conditionTexts = bestBinding
          ? [...new Set(array(bestBinding.conditionRefs).map((index) => applied.best.component.conditions?.[index]).filter((text) => typeof text === "string"))]
          : [];
        let representativeModel = doc.model || doc.entry.note?.models?.[0] || null;
        let representativeComponent = doc.component || representativeModel?.components?.[0] || null;
        if (filters.concept && doc.entry.note && doc.scope !== "component") {
          representativeModel = (doc.model ? [doc.model] : doc.entry.note.models).find((model) => modeledComponents({ note: { models: [model] } }, filters.concept).length) || representativeModel;
          representativeComponent = modeledComponents({ note: { models: [representativeModel] } }, filters.concept)[0]?.component || representativeComponent;
        }
        const value = evidence.value;
        const tier = tierFor(doc, evidence, aliasMatched);
        const relevance = relevanceFor(value, aliasMatched, applied);
        const match = {
          scope: doc.scope,
          field: value.schemaField,
          fieldLabel: value.fieldLabel,
          fieldIndex: value.fieldIndex,
          ...(value.bindingIndex !== undefined ? { bindingIndex: value.bindingIndex, conceptId: value.conceptId } : {}),
          ...(value.member ? { member: value.member } : {}),
          text: value.text,
          ranges: evidence.ranges,
          type,
          provenance: doc.scope === "metadata" ? "Bibliographic metadata" : noteProvenance(doc.entry),
          caution,
          applicability: applied.status,
          conflict: applied.conflict,
          mixedScopes: Boolean(applied.mixedScopes),
          bindings: applied.entries.map((entry) => entry.binding),
          bindingRefs: applied.entries.map((entry) => ({ modelId: entry.model.id, componentId: entry.component.id, bindingIndex: entry.bindingIndex, conceptId: entry.binding.conceptId })),
          representation: bestBinding?.representation || "",
          conditionTexts,
          reviewStatus: bestBinding?.reviewStatus || null,
          representationRef: applied.best ? {
            modelId: applied.best.model.id,
            componentId: applied.best.component.id,
            bindingIndex: applied.best.bindingIndex,
            conceptId: bestBinding.conceptId
          } : null
        };
        scored.push({
          paper: doc.paper,
          model: representativeModel,
          component: representativeComponent,
          scope: doc.scope,
          tier,
          score,
          coverage,
          applicabilityGroup: applied.status,
          conceptHits,
          matched: [...matchedTerms],
          partial: Boolean(!exact && coverage < 1),
          reason: `${value.fieldLabel} · ${type}`,
          match,
          field: value.uiField,
          label: value.fieldLabel,
          text: value.text,
          ranges: evidence.ranges,
          fieldIndex: value.fieldIndex,
          target: value.target,
          relevance,
          applicability: applied.status,
          status: applied.status,
          exact: evidence.exact,
          expansion: evidence.expandedType,
          caution,
          ...(value.bindingIndex === undefined ? {} : { bindingIndex: value.bindingIndex }),
          ...(value.conceptId ? { conceptId: value.conceptId } : {})
        });
      }

      const modelKey = (hit) => `${hit.paper.id}/${hit.model?.id || ""}`;
      const directModels = new Map();
      for (const hit of scored.filter((hit) => hit.scope === "component")) {
        directModels.set(modelKey(hit), Math.min(directModels.get(modelKey(hit)) ?? Number.POSITIVE_INFINITY, applicabilityOrder[hit.match.applicability]));
      }
      const substantivePapers = new Set(scored.filter((hit) => hit.scope !== "metadata").map((hit) => hit.paper.id));
      const hits = scored.filter((hit) => !(hit.scope === "model" && directModels.has(modelKey(hit))
        && directModels.get(modelKey(hit)) <= applicabilityOrder[hit.match.applicability])
        && !(hit.scope === "metadata" && substantivePapers.has(hit.paper.id)));
      hits.sort((left, right) => applicabilityOrder[left.match.applicability] - applicabilityOrder[right.match.applicability]
        || left.tier - right.tier
        || right.coverage - left.coverage
        || right.score - left.score
        || String(left.paper.id).localeCompare(String(right.paper.id))
        || String(left.model?.id || "").localeCompare(String(right.model?.id || ""))
        || String(left.component?.id || "").localeCompare(String(right.component?.id || ""))
        || String(left.field).localeCompare(String(right.field))
        || Number(left.fieldIndex || 0) - Number(right.fieldIndex || 0));
      const grouped = new Map();
      for (const hit of hits) {
        const entry = entryByPaper.get(hit.paper);
        if (!grouped.has(hit.paper.id)) grouped.set(hit.paper.id, {
          paper: hit.paper,
          note: entry?.note || null,
          modelTypes: entry?.modelTypes || [],
          score: hit.score,
          tier: hit.tier,
          coverage: hit.coverage,
          applicabilityGroup: hit.match.applicability,
          rank: grouped.size + 1,
          bestHit: hit,
          hits: []
        });
        grouped.get(hit.paper.id).hits.push(hit);
      }
      return {
        results: [...grouped.values()],
        mapped,
        corrections,
        warnings,
        componentCount: hits.filter((hit) => hit.scope === "component").length,
        contextCount: hits.filter((hit) => hit.scope !== "component").length,
        query: sourceQuery
      };
    }

    return {
      search,
      entries,
      docs,
      vocabularySize: vocabulary.size,
      modelTypes: [...new Set(entries.flatMap((entry) => entry.modelTypes))].sort()
    };
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.records)) {
      throw new Error("Dataset must contain a records array");
    }
    const schemaVersion = String(payload.schema_version ?? "");
    const supportedSchema = schemaVersion === "3.0" || schemaVersion === "3.1";
    const commonStrings = [
      "id", "title", "authors_text", "doi", "journal", "journal_code", "pdf_file", "review_status"
    ];
    const modelMapStrings = ["business_question", "timing", "method", "published_online"];
    const modelMapArrays = ["assumptions", "players", "actions", "information"];
    const modelMapObjects = ["objective", "equilibrium", "solution"];
    const literatureStrings = ["abstract", "modeling_evidence", "review_note"];
    const errors = [];
    const levels = [];
    const records = payload.records.filter((paper, index) => {
      const level = schemaVersion === "3.0" && paper?.detail_level == null
        ? "model_map"
        : paper?.detail_level;
      levels[index] = level;
      const commonValid = paper && typeof paper === "object"
        && commonStrings.every((key) => typeof paper[key] === "string" && paper[key].trim())
        && (typeof paper.year === "number" || typeof paper.year === "string");
      const modelMapValid = level === "model_map"
        && modelMapStrings.every((key) => typeof paper[key] === "string")
        && modelMapArrays.every((key) => Array.isArray(paper[key]))
        && modelMapObjects.every((key) => paper[key] && typeof paper[key] === "object" && !Array.isArray(paper[key]))
        && paper.review_status === "PDF-verified; independently audited";
      const literatureValid = schemaVersion === "3.1" && level === "literature"
        && paper.analysis_level === "evidence-indexed model record"
        && paper.review_status === "PDF-verified; scope-reviewed; evidence-indexed"
        && literatureStrings.every((key) => typeof paper[key] === "string");
      const valid = commonValid && (modelMapValid || literatureValid);
      if (!valid) errors.push(`record ${index + 1}`);
      return valid;
    });
    if (!records.length) throw new Error("Dataset contains no valid records");
    const duplicateValues = (key) => {
      const seen = new Set();
      const duplicates = new Set();
      records.forEach((paper) => {
        const value = normalize(paper[key]);
        if (seen.has(value)) duplicates.add(value);
        seen.add(value);
      });
      return [...duplicates];
    };
    for (const key of ["id", "doi", "pdf_file"]) {
      const duplicates = duplicateValues(key);
      if (duplicates.length) errors.push(`duplicate ${key}: ${duplicates.join(", ")}`);
    }
    if (!supportedSchema) errors.push("unsupported schema version");
    if (!payload.audit || Number(payload.audit.records) !== payload.records.length) {
      errors.push("audit record count does not match the dataset");
    }
    const modelMapCount = levels.filter((level) => level === "model_map").length;
    const literatureCount = levels.filter((level) => level === "literature").length;
    if (!payload.audit || Number(payload.audit.independently_audited) !== modelMapCount) {
      errors.push("independent-audit count does not match the dataset");
    }
    if (schemaVersion === "3.1") {
      if (!payload.audit || Number(payload.audit.model_maps) !== modelMapCount) {
        errors.push("model-map count does not match the dataset");
      }
      if (!payload.audit || Number(payload.audit.literature_records) !== literatureCount) {
        errors.push("literature-record count does not match the dataset");
      }
      if (!payload.audit || Number(payload.audit.pdf_available) !== payload.records.length) {
        errors.push("available-PDF count does not match the dataset");
      }
      if (!payload.audit || Number(payload.audit.pdf_verified) !== payload.records.length) {
        errors.push("verified-PDF count does not match the dataset");
      }
    }
    return { records, errors };
  }

  return {
    distance: damerauLevenshtein,
    damerauLevenshtein,
    createSearchIndex,
    fragmentScore,
    fragmentsFor,
    hasPhrase,
    matchingPaperIds,
    modelTypesFor,
    normalize,
    notationEntries,
    queryAliases,
    queryGroupSpecs,
    queryGroups,
    queryTerms,
    relevantSnippets,
    safeDoiURL,
    scorePaper,
    timingSteps,
    tokens: searchTokens,
    tokenMatchQuality,
    validatePayload,
    wordMatchesQuery
  };
});
