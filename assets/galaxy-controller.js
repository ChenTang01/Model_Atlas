(() => {
  "use strict";

  if (typeof document === "undefined") return;

  const atlas = globalThis.GameTheoryModelAtlas;
  const galaxyAPI = globalThis.AtlasGalaxy;
  const topicsAPI = globalThis.AtlasTopics;
  const notePayload = globalThis.AtlasModelNotes;
  const DATA_URL = "data/atlas_articles.json";
  const SNAPSHOT_URL = "data/atlas_articles.js";
  const PANEL_PAGE = 60;
  const $ = (selector) => document.querySelector(selector);
  const body = document.body;
  const elements = {
    canvas: $("#galaxyCanvas"), brand: $("#brandHome"), nav: $(".atlas-nav"),
    home: $("#homeView"), topicList: $("#topicList"), resetTopic: $("#resetTopic"),
    searchStage: $("#searchStage"), searchForm: $("#atlasSearch"), query: $("#atlasQuery"),
    resultsHud: $("#resultsHud"), queryLabel: $("#queryLabel"), resultsCount: $("#resultsCount"),
    matchNote: $("#galaxyMatchNote"), rankedHeader: $("#rankedHeader"), rankedTitle: $("#rankedTitle"),
    rankedBody: $("#rankedBody"), rankedGuide: $("#rankedBody .ranked-guide"), rankedMatches: $("#rankedMatches"), toggleRanked: $("#toggleRanked"),
    expandMatches: $("#expandMatches"), galaxyActions: $("#galaxyViewActions"), relevanceKey: $("#relevanceKey"),
    seeInPanels: $("#seeInPanels"), emptyState: $("#emptyState"),
    viewToggle: $("#viewToggle"), viewToggleLabel: $("#viewToggleLabel"),
    panels: $("#classicPanel"), panelsTitle: $("#panelsTitle"), closePanels: $("#closeClassic"),
    typeFilter: $("#typeFilter"), journalFilter: $("#journalFilter"), levelFilter: $("#levelFilter"),
    resetFilters: $("#resetFilters"), panelResultCount: $("#panelResultCount"), resultSort: $("#resultSort"),
    searchExplanation: $("#searchExplanation"), panelResults: $("#panelResults"), loadMore: $("#loadMorePanels"),
    tooltip: $("#nodeTooltip"), tooltipHeading: $("#tooltipHeading"), tooltipClose: $("#tooltipClose"), tooltipMeta: $("#tooltipMeta"),
    tooltipTitle: $("#tooltipTitle"), tooltipAuthors: $("#tooltipAuthors"), tooltipDimension: $("#tooltipDimension"),
    tooltipNotice: $("#tooltipNotice"), tooltipReason: $("#tooltipReason"),
    tooltipContextBlock: $("#tooltipContextBlock"), tooltipContextLabel: $("#tooltipContextLabel"),
    tooltipContextText: $("#tooltipContextText"), tooltipActions: $("#tooltipActions"),
    detail: $("#detailView"), detailContent: $("#detailContent"), back: $("#backToResults"),
    readerGuide: $("#readerSearchGuide"),
    loadState: $("#loadState"), toast: $("#toast")
  };

  if (!atlas || !elements.searchForm || !elements.canvas || !globalThis.AtlasDataLoader) return;

  const journalNames = { mnsc: "Management Science", msom: "M&SOM", isr: "ISR", isre: "ISR", mksc: "Marketing Science" };
  const applicabilityLabels = {
    modeled: "Modeled here", explicitlyExcluded: "Explicitly excluded here", backgroundOnly: "Background mention only",
    unknown: "Not specified", unclassified: "Text match · usage not classified", mixed: "Mixed concept usage"
  };
  const maturityLabels = { structured: "Component mapped", model_map: "Deep model map", literature: "Evidence index" };
  // This path is used before/without the full AtlasMath runtime, so it must
  // preserve the same TeX boundary for source-native Greek and PDF lookalikes.
  const fallbackNamedGreek = Object.freeze({
    varepsilon: "varepsilon", vartheta: "vartheta", varpi: "varpi", varrho: "varrho", varsigma: "varsigma", varphi: "varphi",
    alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta", epsilon: "epsilon", zeta: "zeta", eta: "eta", theta: "theta",
    iota: "iota", kappa: "kappa", lambda: "lambda", mu: "mu", nu: "nu", xi: "xi", pi: "pi", rho: "rho", sigma: "sigma",
    tau: "tau", upsilon: "upsilon", phi: "phi", chi: "chi", psi: "psi", omega: "omega",
    Gamma: "Gamma", Delta: "Delta", Theta: "Theta", Lambda: "Lambda", Xi: "Xi", Pi: "Pi", Sigma: "Sigma",
    Upsilon: "Upsilon", Phi: "Phi", Psi: "Psi", Omega: "Omega"
  });
  const fallbackGreekTex = Object.freeze({
    α: "\\alpha", β: "\\beta", γ: "\\gamma", ɣ: "\\gamma", δ: "\\delta", ε: "\\varepsilon", ɛ: "\\varepsilon", ϵ: "\\epsilon", Ɛ: "\\mathbb{E}",
    ζ: "\\zeta", η: "\\eta", θ: "\\theta", ϑ: "\\vartheta", ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu", µ: "\\mu",
    ν: "\\nu", ξ: "\\xi", ο: "o", π: "\\pi", ϖ: "\\varpi", ρ: "\\rho", ϱ: "\\varrho", σ: "\\sigma", ς: "\\varsigma",
    τ: "\\tau", υ: "\\upsilon", φ: "\\varphi", ɸ: "\\varphi", ϕ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega",
    Α: "A", Β: "B", Γ: "\\Gamma", Δ: "\\Delta", Ε: "E", Ζ: "Z", Η: "H", Θ: "\\Theta", Ι: "I", Κ: "K",
    Λ: "\\Lambda", Μ: "M", Ν: "N", Ξ: "\\Xi", Ο: "O", Π: "\\Pi", Ρ: "P", Σ: "\\Sigma", Τ: "T",
    Υ: "\\Upsilon", Φ: "\\Phi", Χ: "X", Ψ: "\\Psi", Ω: "\\Omega"
  });
  const fallbackReadableCommand = Object.freeze({
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
    iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
    phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
    Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
    in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", approx: "≈", equiv: "≡", propto: "∝", sim: "∼",
    to: "→", leftarrow: "←", leftrightarrow: "↔", mapsto: "↦", succeq: "≽", preceq: "≼", setminus: "∖", cdot: "·", sum: "∑", int: "∫",
    infty: "∞", varnothing: "∅", ell: "ℓ"
  });
  const fallbackReadableSubscript = Object.freeze({
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ", "+": "₊", "-": "₋"
  });
  const fallbackReadableSuperscript = Object.freeze({
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    i: "ⁱ", j: "ʲ", n: "ⁿ", T: "ᵀ", B: "ᴮ", P: "ᴾ", L: "ᴸ", U: "ᵁ", R: "ᴿ", s: "ˢ", "+": "⁺", "-": "⁻", "*": "∗"
  });
  const values = (value) => Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
  const escapeAttribute = escapeHTML;
  const plural = (count, singular, pluralForm = `${singular}s`) => `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;

  function summarizeIds(ids) {
    const shown = ids.slice(0, 3).join(", ");
    return `${ids.length}${shown ? ` (${shown}${ids.length > 3 ? ", …" : ""})` : ""}`;
  }

  function validateNotePayload(payload, catalogPapers, catalogSchemaVersion) {
    if (!payload || typeof payload !== "object") return ["the model-note layer was not loaded"];
    const errors = [];
    if (payload.schemaVersion !== 2) errors.push("model-note schemaVersion must be 2");
    if (String(payload.sourceSchemaVersion || "") !== String(catalogSchemaVersion || "")) {
      errors.push("model-note source schema does not match the catalog");
    }
    if (!Array.isArray(payload.concepts)) errors.push("model-note concepts must be an array");
    if (!Array.isArray(payload.papers)) errors.push("model-note papers must be an array");
    if (errors.length) return errors;

    const conceptIds = payload.concepts.map((concept) => String(concept?.id || "").trim());
    const duplicateConceptIds = conceptIds.filter((id, index) => id && conceptIds.indexOf(id) !== index);
    if (conceptIds.some((id) => !id)) errors.push("every model-note concept needs an id");
    if (duplicateConceptIds.length) errors.push(`duplicate model-note concept ids: ${summarizeIds([...new Set(duplicateConceptIds)])}`);

    const catalogById = new Map(catalogPapers.map((paper) => [paper.id, paper]));
    const notesById = new Map();
    const duplicateNoteIds = new Set();
    const invalidNotes = [];
    const sourceMismatches = [];
    const hashMismatches = [];
    for (const note of payload.papers) {
      const id = String(note?.id || "").trim();
      if (!id) {
        invalidNotes.push("missing id");
        continue;
      }
      if (notesById.has(id)) duplicateNoteIds.add(id);
      notesById.set(id, note);
      if (note.sourceId !== id) sourceMismatches.push(id);
      const paper = catalogById.get(id);
      if (paper?.pdf_sha256 && String(note.sha256 || "").toLowerCase() !== String(paper.pdf_sha256).toLowerCase()) {
        hashMismatches.push(id);
      }
      if (!Array.isArray(note.models) || !note.models.length) {
        invalidNotes.push(`${id}: no models`);
        continue;
      }
      const modelIds = note.models.map((model) => String(model?.id || "").trim());
      if (modelIds.some((modelId) => !modelId) || new Set(modelIds).size !== modelIds.length) {
        invalidNotes.push(`${id}: invalid model ids`);
      }
      for (const model of note.models) {
        if (!Array.isArray(model?.components) || !model.components.length) {
          invalidNotes.push(`${id}/${model?.id || "model"}: no components`);
          continue;
        }
        const componentIds = model.components.map((component) => String(component?.id || "").trim());
        if (componentIds.some((componentId) => !componentId) || new Set(componentIds).size !== componentIds.length) {
          invalidNotes.push(`${id}/${model.id}: invalid component ids`);
        }
      }
    }

    const missingIds = catalogPapers.map((paper) => paper.id).filter((id) => !notesById.has(id));
    const extraIds = [...notesById.keys()].filter((id) => !catalogById.has(id));
    if (duplicateNoteIds.size) errors.push(`duplicate model-note paper ids: ${summarizeIds([...duplicateNoteIds])}`);
    if (missingIds.length) errors.push(`catalog papers missing model notes: ${summarizeIds(missingIds)}`);
    if (extraIds.length) errors.push(`model notes without catalog papers: ${summarizeIds(extraIds)}`);
    if (sourceMismatches.length) errors.push(`model-note source ids do not match: ${summarizeIds(sourceMismatches)}`);
    if (hashMismatches.length) errors.push(`model-note PDF hashes do not match: ${summarizeIds(hashMismatches)}`);
    if (invalidNotes.length) errors.push(`invalid structured model notes: ${summarizeIds(invalidNotes)}`);
    return errors;
  }

  let papers = [];
  let paperById = new Map();
  let routeAlias = new Map();
  let noteById = new Map();
  let conceptById = new Map();
  let searchIndex = null;
  let topicIndex = [];
  let response = { results: [], corrections: [], warnings: [], query: "" };
  let state = {};
  let scene = null;
  let forcePanels = Boolean(window.matchMedia?.("(forced-colors: active)")?.matches);
  let panelLimit = PANEL_PAGE;
  let renderSignature = "";
  let rankedExpanded = false;
  let rankedCollapsed = false;
  let tooltipTimer = 0;
  let tooltipHideTimer = 0;
  let tooltipCandidate = null;
  let tooltipPaper = "";
  let tooltipPinned = false;
  let tooltipOrigin = null;
  let tooltipPointer = null;
  let tooltipDistance = Infinity;
  let tooltipProgressAt = 0;
  let tooltipReturn = null;
  let readerTargets = [];
  let readerTargetIndex = 0;
  let detailRenderToken = 0;
  let panelReturn = null;
  let panelOpener = null;
  let detailOpener = null;
  let toastTimer = 0;

  function setVisible(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.inert = !visible;
    element.setAttribute?.("aria-hidden", String(!visible));
  }

  function setClass(element, name, enabled) {
    if (!element?.classList) return;
    if (enabled) element.classList.add(name);
    else element.classList.remove(name);
  }

  function notify(message) {
    if (!elements.toast) return;
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
  }

  function normalizedDoiId(doi) {
    return `doi-${String(doi || "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  }

  function resolvePaperId(id) {
    const requested = String(id || "");
    return paperById.has(requested) ? requested : routeAlias.get(requested) || "";
  }

  function readState() {
    const parameters = new URLSearchParams(window.location.search);
    const legacyPanels = parameters.get("view") === "classic";
    const requestedPaper = parameters.get("paper") || "";
    const requestedLevel = parameters.get("level") || "";
    return {
      q: (parameters.get("q") || "").trim(),
      type: parameters.get("type") || "",
      journal: parameters.get("journal") || "",
      level: ["model_map", "literature"].includes(requestedLevel) ? requestedLevel : "",
      topic: parameters.get("topic") || "",
      layout: parameters.get("layout") === "classic" || legacyPanels ? "classic" : "galaxy",
      paper: resolvePaperId(requestedPaper),
      model: parameters.get("model") || "",
      component: parameters.get("component") || ""
    };
  }

  function stateURL(nextState) {
    const url = new URL(window.location.href);
    const parameters = new URLSearchParams();
    for (const key of ["q", "type", "journal", "level", "topic", "paper", "model", "component"]) {
      if (nextState[key]) parameters.set(key, nextState[key]);
    }
    if (nextState.layout === "classic") parameters.set("layout", "classic");
    url.search = parameters.toString();
    url.hash = "";
    return url.href;
  }

  function detailShareURL(modelId = "") {
    return stateURL({
      q: state.q,
      type: "",
      journal: "",
      level: "",
      topic: "",
      layout: "galaxy",
      paper: state.paper,
      model: modelId || state.model,
      component: state.component
    });
  }

  async function copyDetailLink(modelId) {
    const url = detailShareURL(modelId);
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await globalThis.navigator.clipboard.writeText(url);
      notify("Model link copied.");
      return;
    } catch {
      let textArea = null;
      let copied = false;
      try {
        textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.setAttribute("readonly", "");
        Object.assign(textArea.style, { position: "fixed", opacity: "0", pointerEvents: "none" });
        document.body.append(textArea);
        textArea.select();
        copied = Boolean(document.execCommand?.("copy"));
      } catch {
        copied = false;
      } finally {
        textArea?.remove?.();
      }
      notify(copied ? "Model link copied." : "Copy this page’s address from the address bar.");
    }
  }

  function writeState(patch, options = {}) {
    const next = { ...state, ...patch };
    if (next.q) next.topic = "";
    if (patch.paper === "") { next.model = ""; next.component = ""; }
    state = next;
    const method = options.replace ? "replaceState" : "pushState";
    window.history[method]({ atlas: true }, "", stateURL(state));
    render();
  }

  function readerHitKey(hit) {
    if (!hit) return "";
    const target = hit.target || {};
    return [target.kind, target.modelId, target.componentId, target.section, hit.field, hit.fieldIndex, hit.bindingIndex]
      .map((value) => encodeURIComponent(String(value ?? "")))
      .join("~");
  }

  function readerHitAttribute(hit) {
    const key = readerHitKey(hit);
    return key ? ` data-reader-hit="${escapeAttribute(key)}"` : "";
  }

  function articleLinks(paper, doiHit = null) {
    const doi = atlas.safeDoiURL(paper.doi_url || (paper.doi ? `https://doi.org/${paper.doi}` : ""));
    const scholar = `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`;
    const doiLabel = doiHit ? highlightRanges(paper.doi, doiHit.ranges) : "DOI";
    return `<span class="article-links">${doi ? `<a class="paper-doi" href="${escapeAttribute(doi)}" target="_blank" rel="noopener noreferrer" aria-label="Open publisher page for ${escapeAttribute(paper.title)}"${readerHitAttribute(doiHit)}>${doiLabel} ↗</a>` : ""}<a class="paper-scholar" href="${escapeAttribute(scholar)}" target="_blank" rel="noopener noreferrer" aria-label="Search Google Scholar for ${escapeAttribute(paper.title)}">Google Scholar ↗</a></span>`;
  }

  function highlightRanges(text, ranges) {
    const source = String(text ?? "");
    const displayRanges = globalThis.AtlasMath?.expandGreekRanges?.(source, values(ranges)) || values(ranges);
    let cursor = 0;
    let markup = "";
    for (const range of [...displayRanges].sort((left, right) => left.start - right.start)) {
      const start = Math.max(cursor, Number(range.start));
      const end = Math.min(source.length, Number(range.end));
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) continue;
      markup += `${escapeHTML(source.slice(cursor, start))}<mark class="match-term">${escapeHTML(source.slice(start, end))}</mark>`;
      cursor = end;
    }
    return markup + escapeHTML(source.slice(cursor));
  }

  const structuredProseHitFields = new Set([
    "question", "overview", "modelName", "modelSummary", "objects", "inputs", "decisions", "modelAssumptions", "modelMethod",
    "componentLabel", "searchPhrases", "explanation", "conditions", "symbols", "representation"
  ]);

  function structuredHitMarkup(hit, text = hit?.text, ranges = hit?.ranges) {
    return hit?.target?.kind === "structured" && structuredProseHitFields.has(hit.field)
      ? mathProse(text, ranges)
      : highlightRanges(text, ranges);
  }

  function resultDepth(result) {
    if (result?.note) return "structured";
    return result?.paper?.detail_level === "model_map" ? "model_map" : "literature";
  }

  function uniqueText(items) {
    const seen = new Set();
    const output = [];
    for (const item of items.flatMap((value) => values(value))) {
      const text = String(item || "").trim();
      const key = text.toLocaleLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      output.push(text);
    }
    return output;
  }

  function galaxyRecord(paper) {
    const note = noteById.get(paper.id);
    const subjectId = topicsAPI?.classifyPaper(paper);
    if (!note) return { ...paper, subject_id: subjectId };
    const models = values(note.models);
    const components = models.flatMap((model) => values(model.components));
    const conceptLabels = uniqueText(components.flatMap((component) => values(component.concepts)
      .map((id) => conceptById.get(id)?.label || id)));
    return {
      ...paper,
      subject_id: subjectId,
      business_question: note.question || paper.business_question,
      model_topic: uniqueText([note.overview, conceptLabels.join("; "), paper.model_topic]).join(" "),
      method_families: uniqueText([paper.method_families, note.modelTypes, models.map((model) => model.method)]),
      architecture_families: uniqueText([paper.architecture_families, models.map((model) => model.name)]),
      information_families: uniqueText([
        paper.information_families,
        components.filter((component) => component.role === "information").map((component) => component.label)
      ])
    };
  }

  function resolveBinding(result, hit) {
    if (!result?.note || !hit?.target?.modelId || !Number.isInteger(hit.bindingIndex)) return null;
    const model = result.note.models?.find((entry) => entry.id === hit.target.modelId);
    const component = model?.components?.find((entry) => entry.id === hit.target.componentId);
    const binding = component?.conceptBindings?.[hit.bindingIndex];
    return binding?.conceptId === hit.conceptId ? binding : null;
  }

  function applicabilityFor(result, hit) {
    return hit?.applicability || resolveBinding(result, hit)?.status || "unclassified";
  }

  function applicabilityBadge(status) {
    const key = Object.hasOwn(applicabilityLabels, status) ? status : "unclassified";
    return `<span class="applicability-badge" data-applicability="${escapeAttribute(key)}">${escapeHTML(applicabilityLabels[key])}</span>`;
  }

  function evidenceLabel(hit) {
    if (!hit) return "Paper details";
    const labels = {
      concept: "Concept", componentLabel: "Component", searchPhrases: "Scenario", formal: "Formulation", formula: "Formulation",
      representation: "Concept use", explanation: "Component passage", conditions: "Condition", assumptions: "Assumption",
      actions: "Decision", decisions: "Decision or state", timing: "Timing", information: "Information", symbols: "Notation",
      modelMethod: "Method", method: "Method", modeling_evidence: "Modeling evidence", abstract: "Abstract",
      title: "Title", authors: "Author", doi: "DOI"
    };
    return labels[hit.field] || hit.label || "Model context";
  }

  function relevanceMarkup(result, hit, compact = false) {
    const applicability = applicabilityFor(result, hit);
    const depth = resultDepth(result);
    return `<div class="relevance-labels"><span class="evidence-label">${escapeHTML(hit?.relevance || evidenceLabel(hit))}</span>${applicability !== "unclassified" ? applicabilityBadge(applicability) : ""}${compact ? "" : `<span class="maturity-label" data-depth="${depth}">${escapeHTML(maturityLabels[depth])}</span>`}</div>`;
  }

  function hitMarkup(result, hit) {
    if (!hit) return "";
    const notice = applicabilityFor(result, hit);
    const caution = notice === "explicitlyExcluded" ? "This concept is explicitly outside this part of the model."
      : notice === "backgroundOnly" ? "This is context, not a modeled mechanism."
        : notice === "unknown" ? "The note does not resolve how this concept is used." : "";
    return `<div class="match-connection">${relevanceMarkup(result, hit, true)}${caution ? `<p class="match-notice">${escapeHTML(caution)}</p>` : ""}<p class="match-excerpt">${structuredHitMarkup(hit)}</p></div>`;
  }

  function targetAttributes(result, hit) {
    const target = hit?.target || {};
    return `data-open-paper="${escapeAttribute(result.paper.id)}"${target.modelId ? ` data-open-model="${escapeAttribute(target.modelId)}"` : ""}${target.componentId ? ` data-open-component="${escapeAttribute(target.componentId)}"` : ""}${target.section ? ` data-open-section="${escapeAttribute(target.section)}"` : ""}`;
  }

  function targetHref(result, hit) {
    const target = hit?.target || {};
    return stateURL({
      ...state,
      paper: result.paper.id,
      model: target.modelId || "",
      component: target.componentId || ""
    });
  }

  function targetLinkAttributes(result, hit) {
    return `href="${escapeAttribute(targetHref(result, hit))}" ${targetAttributes(result, hit)}`;
  }

  function responseForState() {
    const filters = { type: state.type, journal: state.journal };
    const next = searchIndex.search(state.q, filters);
    if (state.level) next.results = next.results.filter((result) => result.paper.detail_level === state.level);
    const topic = topicIndex.find((entry) => entry.id === state.topic);
    if (topic && !state.q) {
      const ids = new Set(topic.ids);
      next.results = next.results.filter((result) => ids.has(result.paper.id));
    }
    next.results.forEach((result, index) => { result.rank = index + 1; });
    return next;
  }

  function activeMode() {
    if (state.paper && paperById.has(state.paper)) return "detail";
    const filtered = Boolean(state.q || state.type || state.journal || state.level);
    if (filtered) return "results";
    if (state.topic || state.layout === "classic" || forcePanels) return "browse";
    return "home";
  }

  function renderTopicIndex(topic) {
    elements.topicList?.querySelectorAll?.("[data-topic]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.topic === topic?.id));
    });
    if (elements.resetTopic) elements.resetTopic.hidden = !topic;
  }

  function renderRanked() {
    const results = response.results;
    const shown = rankedExpanded ? results : results.slice(0, 5);
    elements.rankedTitle.textContent = state.q ? "Relevant papers" : "Matching papers";
    elements.rankedGuide.textContent = state.q ? "Most relevant first" : "Explore the collection";
    elements.rankedMatches.innerHTML = shown.map((result) => {
      const hit = result.bestHit || result.hits[0];
      return `<li class="ranked-match" data-ranked-paper="${escapeAttribute(result.paper.id)}"><a class="ranked-title" ${targetLinkAttributes(result, hit)}>${escapeHTML(result.paper.title)}</a><p class="ranked-meta">${escapeHTML(journalNames[result.paper.journal_code] || result.paper.journal)} · ${escapeHTML(result.paper.year)}</p>${state.q ? hitMarkup(result, hit) : ""}<div class="ranked-actions"><button type="button" class="match-preview" data-preview-paper="${escapeAttribute(result.paper.id)}" aria-controls="nodeTooltip" aria-expanded="false">${state.q ? "See connection" : "Preview paper"} ↗</button>${articleLinks(result.paper)}</div></li>`;
    }).join("");
    const any = results.length > 0;
    elements.rankedHeader.hidden = !any;
    elements.rankedBody.hidden = !any || rankedCollapsed;
    elements.toggleRanked.setAttribute("aria-expanded", String(!rankedCollapsed));
    elements.toggleRanked.textContent = rankedCollapsed ? "Expand +" : "Collapse −";
    elements.expandMatches.hidden = results.length <= 5;
    elements.expandMatches.setAttribute("aria-expanded", String(rankedExpanded));
    elements.expandMatches.textContent = rankedExpanded ? "Show fewer −" : `Show all ${results.length.toLocaleString()} matches +`;
  }

  function panelCard(result) {
    const paper = result.paper;
    const hits = state.q ? result.hits.slice(0, 2) : [];
    const hit = result.bestHit || hits[0] || result.hits[0];
    const types = result.modelTypes.slice(0, 4);
    const depth = resultDepth(result);
    const mappedComponents = values(result.note?.models).reduce((count, model) => count + values(model.components).length, 0);
    const footer = result.note
      ? `${plural(mappedComponents, "mapped component")}${result.note.models.length > 1 ? ` · ${plural(result.note.models.length, "model")}` : ""}`
      : maturityLabels[depth];
    const evidence = hits.map((entry) => `<div class="classic-match-evidence">${hitMarkup(result, entry)}<a class="hit-button" ${targetLinkAttributes(result, entry)}>Read the matched passage ↗</a></div>`).join("");
    return `<article class="result-card" data-paper-card="${escapeAttribute(paper.id)}"><div class="card-meta"><span>${escapeHTML(journalNames[paper.journal_code] || paper.journal)}</span><span>·</span><span>${escapeHTML(paper.year)}</span></div><a class="result-title" ${targetLinkAttributes(result, hit)}>${escapeHTML(paper.title)}</a><p class="panel-authors">${escapeHTML(paper.authors_text)}</p><div class="tag-row">${types.map((type) => `<span class="tag">${escapeHTML(type)}</span>`).join("")}</div>${articleLinks(paper)}${evidence ? `<div class="hit-list">${evidence}</div>` : ""}<div class="result-footer"><span>${escapeHTML(footer)}</span></div></article>`;
  }

  function renderPanels() {
    const shown = response.results.slice(0, panelLimit);
    elements.panels.dataset.ranked = String(Boolean(state.q));
    elements.panelsTitle.textContent = state.q ? `“${state.q}”` : topicIndex.find((entry) => entry.id === state.topic)?.label || "Modeling papers";
    elements.panelResultCount.textContent = plural(response.results.length, "paper");
    elements.resultSort.textContent = state.q ? "Most relevant first" : "Corpus order";
    const messages = [];
    if (response.corrections.length) messages.push(`Typo expansion: ${response.corrections.map((entry) => `${entry.from} → ${entry.to}`).join(", ")}`);
    messages.push(...response.warnings);
    elements.searchExplanation.innerHTML = messages.map((message) => `<span class="${message.startsWith("Negation") ? "search-warning" : ""}">${escapeHTML(message)}</span>`).join("");
    elements.panelResults.innerHTML = shown.length ? shown.map(panelCard).join("") : `<div class="empty"><h3>No matching papers.</h3><p>Try a shorter phrase or remove a filter.</p><button type="button" class="secondary" data-reset>Show the full collection</button></div>`;
    elements.loadMore.hidden = shown.length >= response.results.length;
    if (!elements.loadMore.hidden) elements.loadMore.textContent = `Load ${Math.min(PANEL_PAGE, response.results.length - shown.length).toLocaleString()} more papers`;
  }

  function listMarkup(items, hitLookup) {
    const entries = values(items).filter((item) => String(item).trim());
    return entries.length ? `<ul>${entries.map((item, index) => {
      const hit = hitLookup?.(index, item);
      return `<li${readerHitAttribute(hit)}>${hit ? highlightRanges(item, hit.ranges) : escapeHTML(item)}</li>`;
    }).join("")}</ul>` : "";
  }

  function proseListMarkup(items, hitLookup) {
    const entries = values(items).filter((item) => String(item).trim());
    return entries.length ? `<ul>${entries.map((item, index) => {
      const hit = hitLookup?.(index, item);
      return `<li${readerHitAttribute(hit)}>${mathProse(item, hit?.ranges)}</li>`;
    }).join("")}</ul>` : "";
  }

  function texifySymbol(source) {
    if (globalThis.AtlasMath?.symbolTex) return globalThis.AtlasMath.symbolTex(source);
    let value = String(source || "").trim();
    const wrapped = value.match(/^(?:\$\$((?:(?!\$\$)[\s\S])+?)\$\$|\$([^$\n]+?)\$|\\\(((?:(?!\\\))[\s\S])+?)\\\)|\\\[((?:(?!\\\])[\s\S])+?)\\\])\s*[.,;:]?$/);
    if (wrapped) value = (wrapped[1] ?? wrapped[2] ?? wrapped[3] ?? wrapped[4] ?? "").trim();
    value = value.replace(/[α-ωΑ-ΩϑϖϱςϕϵɛƐµɣɸ]/gu, (symbol, offset, original) => {
      const tex = fallbackGreekTex[symbol] || symbol;
      const terminator = tex.startsWith("\\") && /[A-Za-z]/u.test(original[offset + symbol.length] || "") ? "{}" : "";
      return `${tex}${terminator}`;
    });
    return value.replace(/(?<!\\)\b(varepsilon|vartheta|varpi|varrho|varsigma|varphi|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?=\b|_)/g,
      (name) => `\\${fallbackNamedGreek[name] || fallbackNamedGreek[name.toLowerCase()]}`);
  }

  function mathInline(source) {
    if (globalThis.AtlasMath?.symbol) return globalThis.AtlasMath.symbol(source);
    const value = texifySymbol(source);
    return `<span class="math-inline" data-tex="${escapeAttribute(value)}">${escapeHTML(readableTexFallback(value))}</span>`;
  }

  function mathDisplay(source) {
    if (globalThis.AtlasMath?.display) return globalThis.AtlasMath.display(source);
    const value = texifySymbol(source);
    return `<div class="math-display" data-tex="${escapeAttribute(value)}" tabindex="0" aria-label="Scrollable formula">${escapeHTML(readableTexFallback(value))}</div>`;
  }

  function readableTexFallback(source) {
    const readableScript = (operator, body) => {
      const map = operator === "_" ? fallbackReadableSubscript : fallbackReadableSuperscript;
      const glyphs = [...body].map((character) => map[character]);
      if (glyphs.every(Boolean)) return glyphs.join("");
      return `${operator === "_" ? "₍" : "⁽"}${body}${operator === "_" ? "₎" : "⁾"}`;
    };
    const value = String(source ?? "")
      .replace(/\$([^$\n]+)\$/g, (match, body) => (
      /[\\_^=<>≤≥∈∑∫]|^\s*[\p{L}][\p{L}\p{N}]*\s*$/u.test(body) ? body : match
      ))
      // Unmatched PDF math markers before a single variable are readable in
      // the no-MathJax path; monetary amounts continue to retain their `$`.
      .replace(/\$([A-Za-z])(?![A-Za-z0-9])/g, "$1");
    let output = value
      .replace(/\\\{/g, "\uE000")
      .replace(/\\\}/g, "\uE001")
      .replace(/\\mathbb\s*\{?R\}?/g, "ℝ")
      .replace(/\\mathbb\s*\{?N\}?/g, "ℕ")
      .replace(/\\mathbb\s*\{?Z\}?/g, "ℤ")
      .replace(/\\mathbb\s*\{?Q\}?/g, "ℚ")
      .replace(/\\mathbb\s*\{?C\}?/g, "ℂ")
      .replace(/\\(?:left|right)\b\s*/g, "")
      .replace(/\\(?:text|textrm|textsf|texttt|mathrm|mathbf|mathit|mathcal|mathbb|operatorname|bar|overline|underline|hat|widehat|tilde|widetilde|dot|ddot)\*?\s*/g, "")
      .replace(/\\([A-Za-z]+)/g, (_match, command) => fallbackReadableCommand[command] ?? command)
      .replace(/\\([{}])/g, "$1")
      .replace(/\\/g, "");
    let previous = "";
    while (output !== previous) {
      previous = output;
      output = output.replace(/([_^])\{([^{}]*)\}/g, (_match, operator, body) => readableScript(operator, body));
    }
    return output
      .replace(/([_^])([A-Za-z0-9+\-*]+)/g, (_match, operator, body) => readableScript(operator, body))
      .replace(/[{}]/g, "")
      .replace(/\uE000/g, "{")
      .replace(/\uE001/g, "}");
  }

  function mathProse(source, ranges = []) {
    if (globalThis.AtlasMath?.prose) return globalThis.AtlasMath.prose(source, ranges);
    const markup = values(ranges).length ? highlightRanges(source, ranges) : escapeHTML(source);
    return readableTexFallback(markup);
  }

  function tagsMarkup(items) {
    return `<div class="tag-row">${values(items).filter(Boolean).map((item) => `<span class="tag">${escapeHTML(item)}</span>`).join("")}</div>`;
  }

  function detailHeader(paper, label, types, result, modelId = null) {
    const findHit = (field) => state.q ? result?.hits?.find((hit) => hit.field === field) : null;
    const titleHit = findHit("title");
    const authorHit = findHit("authors");
    const journalHit = findHit("journal");
    const doiHit = findHit("doi");
    const journal = journalNames[paper.journal_code] || paper.journal;
    let publication = `${escapeHTML(journal)} · ${escapeHTML(paper.year)}`;
    if (journalHit?.fieldIndex === 0) publication = `${highlightRanges(paper.journal, journalHit.ranges)} · ${escapeHTML(paper.year)}`;
    else if (journalHit?.fieldIndex === 1) publication = `${escapeHTML(journal)} (${highlightRanges(paper.journal_code, journalHit.ranges)}) · ${escapeHTML(paper.year)}`;
    else if (journalHit?.fieldIndex === 2) publication = `${escapeHTML(journal)} · ${highlightRanges(String(paper.year), journalHit.ranges)}`;
    const depth = resultDepth(result);
    const maturity = maturityLabels[depth] || maturityLabels.literature;
    const copyAction = modelId === null ? "" : `<button type="button" data-copy-link="${escapeAttribute(modelId)}" aria-label="Copy link to this model note">Copy link ↗</button>`;
    return `<header class="detail-header"><div class="detail-top"><p class="eyebrow">${escapeHTML(label)}</p><div class="detail-actions"><span class="maturity-label" data-depth="${escapeAttribute(depth)}" aria-label="Note maturity: ${escapeAttribute(maturity)}">${escapeHTML(maturity)}</span>${copyAction}</div></div><h2 id="detailTitle" tabindex="-1"${readerHitAttribute(titleHit)}>${titleHit ? highlightRanges(paper.title, titleHit.ranges) : escapeHTML(paper.title)}</h2><p class="byline"${readerHitAttribute(authorHit)}>${authorHit ? highlightRanges(paper.authors_text, authorHit.ranges) : escapeHTML(paper.authors_text)}</p><p class="paper-publication"${readerHitAttribute(journalHit)}>${publication}</p><div class="detail-links">${tagsMarkup(types)}${articleLinks(paper, doiHit)}</div></header>`;
  }

  function catalogMatches(result) {
    if (!state.q) return "";
    const hits = result.hits.filter((hit) => hit.target?.kind === "catalog");
    return hits.length ? `<aside class="catalog-matches" aria-label="Matching catalog context"><p class="section-label">Catalog connection</p>${hits.map((hit) => `<p${readerHitAttribute(hit)}><span class="match-caption">${escapeHTML(hit.label)}</span><span class="match-value">${highlightRanges(hit.text, hit.ranges)}</span></p>`).join("")}</aside>` : "";
  }

  function matchingHit(hits, target, field, text, fieldIndex) {
    return hits.find((hit) => hit.target?.kind === target.kind
      && (!target.modelId || hit.target?.modelId === target.modelId)
      && (!target.componentId || hit.target?.componentId === target.componentId)
      && (!field || hit.field === field)
      && (fieldIndex === undefined || hit.fieldIndex === fieldIndex)
      && (text === undefined || hit.text === String(text)));
  }

  function bindingCards(model, component, hits) {
    const bindings = component.conceptBindings || [];
    if (!bindings.length) return "";
    return `<div class="concept-bindings" aria-label="Concept usage in this model"><p class="section-label">Concepts in this model</p>${bindings.map((binding, bindingIndex) => {
      const concept = conceptById.get(binding.conceptId);
      const conditions = values(binding.conditionRefs).map((index) => component.conditions?.[index]).filter(Boolean);
      const sourceRecords = values(binding.sourceRefs).map((reference) => (reference.scope === "model" ? model.sources : component.sources)?.[reference.index]).filter(Boolean);
      const sections = [...new Set(sourceRecords.map((source) => String(source.section || "").trim()).filter(Boolean))];
      const symbols = values(binding.symbolRefs)
        .map((index) => ({ index, entry: component.symbols?.[index] }))
        .filter((item) => item.entry);
      const representationHit = hits.find((hit) => hit.bindingIndex === bindingIndex && hit.field === "representation");
      const conceptHits = hits.filter((hit) => hit.bindingIndex === bindingIndex && hit.field === "concept");
      const conceptHit = conceptHits[0];
      const conceptLabelHit = conceptHits.find((hit) => hit.fieldIndex === 0) || null;
      const conceptAliasHits = conceptHits.filter((hit) => hit.fieldIndex > 0);
      const label = concept?.label || binding.conceptId;
      return `<div class="concept-binding${representationHit || conceptHit ? " query-passage" : ""}" data-binding-status="${escapeAttribute(binding.status)}" data-binding-concept="${escapeAttribute(binding.conceptId)}"><div class="binding-heading"><button type="button" data-search-query="${escapeAttribute(label)}"${readerHitAttribute(conceptLabelHit)}>${conceptLabelHit ? highlightRanges(label, conceptLabelHit.ranges) : escapeHTML(label)} ↗</button>${applicabilityBadge(binding.status)}</div>${conceptAliasHits.map((hit) => `<p class="binding-match-term"${readerHitAttribute(hit)}><span class="match-caption">Matching term</span><span class="match-value">${highlightRanges(hit.text, hit.ranges)}</span></p>`).join("")}<p class="binding-summary"${readerHitAttribute(representationHit)}>${mathProse(binding.representation, representationHit?.ranges)}</p><details class="binding-evidence"${representationHit || conceptHit ? " open" : ""}><summary>Conditions &amp; evidence</summary>${conditions.length ? proseListMarkup(conditions) : "<p>No additional concept-specific condition recorded. Check the model assumptions and component conditions.</p>"}${binding.formalRef === "formal" ? "<p>Representation linked to the component formulation above.</p>" : ""}${symbols.length ? `<dl class="binding-symbols">${symbols.map(({ entry: symbol, index: symbolIndex }) => { const hit = matchingHit(hits, { kind: "structured", modelId: model.id, componentId: component.id }, "symbols", symbol.meaning, symbolIndex); return `<dt>${mathInline(symbol.symbol)}</dt><dd${hit ? " class=\"query-passage\"" : ""}>${mathProse(symbol.meaning, hit?.ranges)}</dd>`; }).join("")}</dl>` : ""}${sections.length ? `<p class="binding-source-label">Supporting sections</p>${listMarkup(sections)}` : ""}</details></div>`;
    }).join("")}</div>`;
  }

  function modelRelationships(note, model) {
    const labels = { extends: "Extends", alternativeTo: "Alternative to", approximates: "Approximates" };
    const relations = values(model.relationships).map((relation) => ({ relation, target: note.models.find((entry) => entry.id === relation.targetModelId) })).filter((entry) => entry.target);
    return relations.length ? `<div class="model-relationships" aria-label="Model relationships">${relations.map(({ relation, target }) => `<span>${escapeHTML(labels[relation.type] || "Related model")} <button type="button" data-switch-model="${escapeAttribute(target.id)}">${mathProse(target.name)} ↗</button></span>`).join("")}</div>` : "";
  }

  function structuredComponent(note, model, component, index, hits, activeComponent, closestComponent) {
    const target = { kind: "structured", modelId: model.id, componentId: component.id };
    const localHits = hits.filter((hit) => hit.target?.modelId === model.id && hit.target?.componentId === component.id);
    const find = (field, text, fieldIndex) => matchingHit(localHits, target, field, text, fieldIndex);
    const labelHit = find("componentLabel", component.label);
    const explanationHit = find("explanation", component.explanation);
    const formalHit = find("formal", component.formal);
    const scenarioHits = localHits.filter((hit) => hit.field === "searchPhrases");
    const open = activeComponent === component.id || localHits.length > 0;
    const plainFormal = `<div class="formal"><span>${escapeHTML(component.formalKind || "Formulation")}</span><pre>${escapeHTML(component.formal)}</pre></div>`;
    let formalMarkup = component.formal ? globalThis.AtlasMath?.formula?.(note, component) || plainFormal : "";
    if (formalHit && formalMarkup) {
      const decorated = formalMarkup.replace(/^<div class="formal([^"]*)"/, (match, suffix) => `<div class="formal${suffix} query-formulation"${readerHitAttribute(formalHit)}`);
      formalMarkup = decorated === formalMarkup
        ? `<div class="formal query-formulation"${readerHitAttribute(formalHit)}>${formalMarkup}</div>`
        : decorated;
    }
    return `<article class="component${activeComponent === component.id ? " focused" : ""}${closestComponent === component.id ? " query-closest" : ""}" id="component-${escapeAttribute(component.id)}" data-reader-target="${escapeAttribute(component.id)}"><div class="component-label"><h4${readerHitAttribute(labelHit)}><span class="component-number">${String(index + 1).padStart(2, "0")}</span>${mathProse(component.label, labelHit?.ranges)}</h4><span class="component-role">${escapeHTML(component.role)}</span></div>${closestComponent === component.id ? "<p class=\"reader-relevance-badge\">Closest passage in this model</p>" : ""}<p class="component-explanation${explanationHit ? " query-passage" : ""}"${readerHitAttribute(explanationHit)}>${mathProse(component.explanation, explanationHit?.ranges)}</p><details class="component-details"${open ? " open" : ""}><summary><span class="when-closed">Show details</span><span class="when-open">Hide details</span></summary><div class="component-content">${scenarioHits.map((hit) => `<p class="component-match-term"${readerHitAttribute(hit)}><span class="match-caption">Matching scenario</span><span class="match-value">${mathProse(hit.text, hit.ranges)}</span></p>`).join("")}${formalMarkup}${component.symbols?.length ? `<dl class="symbols">${component.symbols.map((symbol, symbolIndex) => { const hit = find("symbols", symbol.meaning, symbolIndex); return `<dt>${globalThis.AtlasMath?.symbol?.(symbol.symbol) || mathInline(symbol.symbol)}</dt><dd${hit ? " class=\"query-passage\"" : ""}${readerHitAttribute(hit)}>${mathProse(symbol.meaning, hit?.ranges)}</dd>`; }).join("")}</dl>` : ""}${component.conditions?.length ? `<ul class="conditions">${component.conditions.map((condition, conditionIndex) => { const hit = find("conditions", condition, conditionIndex); return `<li${hit ? " class=\"query-passage\"" : ""}${readerHitAttribute(hit)}>${mathProse(condition, hit?.ranges)}</li>`; }).join("")}</ul>` : ""}${bindingCards(model, component, localHits)}</div></details></article>`;
  }

  function detailResult(paperId) {
    let result = response.results.find((entry) => entry.paper.id === paperId);
    if (!result && state.q) result = searchIndex.search(state.q).results.find((entry) => entry.paper.id === paperId);
    if (!result) {
      const paper = paperById.get(paperId);
      result = { paper, note: noteById.get(paperId), modelTypes: atlas.modelTypesFor(paper, noteById.get(paperId)), hits: [], bestHit: null };
    }
    return result;
  }

  function structuredDetail(result) {
    const paper = result.paper;
    const note = result.note;
    const firstTargetModel = result.hits.find((hit) => hit.target?.kind === "structured" && hit.target.modelId)?.target.modelId;
    const model = note.models.find((entry) => entry.id === state.model) || note.models.find((entry) => entry.id === firstTargetModel) || note.models[0];
    const hits = state.q ? result.hits : [];
    const modelHits = hits.filter((hit) => hit.target?.modelId === model.id);
    const closestComponent = modelHits.find((hit) => hit.target?.componentId)?.target.componentId || "";
    const findModelHit = (field, text, fieldIndex) => matchingHit(modelHits, { kind: "structured", modelId: model.id }, field, text, fieldIndex);
    const questionHit = hits.find((hit) => hit.field === "question" && hit.text === note.question);
    const overviewHit = hits.find((hit) => hit.field === "overview" && hit.text === note.overview);
    const modelNameHit = findModelHit("modelName", model.name);
    const modelSummaryHit = findModelHit("modelSummary", model.summary);
    const modelMethodHit = findModelHit("modelMethod", model.method);
    const setupOpen = modelHits.some((hit) => hit.target?.section === "setup");
    const lists = [
      ["Entities / system", "objects", model.objects], ["Decisions / states", "decisions", model.decisions],
      ["Given / exogenous", "inputs", model.inputs], ["Key assumptions", "modelAssumptions", model.assumptions]
    ];
    return `${detailHeader(paper, "MODEL NOTE", note.modelTypes, result, model.id)}<div class="reader-content">${catalogMatches(result)}<p class="section-label">The research question</p><p class="research-question${questionHit ? " query-passage" : ""}"${readerHitAttribute(questionHit)}>${mathProse(note.question, questionHit?.ranges)}</p><p class="overview${overviewHit ? " query-passage" : ""}"${readerHitAttribute(overviewHit)}>${mathProse(note.overview, overviewHit?.ranges)}</p>${note.models.length > 1 ? `<div class="model-tabs" role="group" aria-label="Model variants">${note.models.map((entry) => `<button type="button" class="model-tab${entry.id === model.id ? " active" : ""}" data-switch-model="${escapeAttribute(entry.id)}"${entry.id === model.id ? readerHitAttribute(modelNameHit) : ""}>${mathProse(entry.name, entry.id === model.id ? modelNameHit?.ranges : [])}</button>`).join("")}</div>` : `<p class="section-label model-name"${readerHitAttribute(modelNameHit)}>${mathProse(model.name, modelNameHit?.ranges)}</p>`}${model.relation ? `<p class="variant-note">${mathProse(model.relation)}</p>` : ""}${modelRelationships(note, model)}<p class="overview model-summary"${readerHitAttribute(modelSummaryHit)}>${mathProse(model.summary, modelSummaryHit?.ranges)}</p><details class="model-setup" id="section-setup"${setupOpen ? " open" : ""}><summary>Model setup <span>Entities, decisions and assumptions</span></summary><div class="skeleton">${lists.map(([label, field, items]) => `<div><p class="section-label">${label}</p>${proseListMarkup(items, (index, text) => findModelHit(field, text, index))}</div>`).join("")}</div></details><div class="component-heading"><h3>Inside the model</h3><span>${plural(model.components.length, "component")}</span></div><div class="component-nav">${model.components.map((component, index) => `<button type="button" data-jump-component="${escapeAttribute(component.id)}">${String(index + 1).padStart(2, "0")} ${mathProse(component.label)}</button>`).join("")}</div><div class="component-stack">${model.components.map((component, index) => structuredComponent(note, model, component, index, modelHits, state.component, closestComponent)).join("")}</div><section class="method-box${modelHits.some((hit) => hit.target?.section === "method") ? " query-section" : ""}" id="section-method"><p class="section-label">Solution / estimation method</p><p${readerHitAttribute(modelMethodHit)}>${mathProse(model.method, modelMethodHit?.ranges)}</p></section></div>`;
  }

  function legacyHit(result, section, field, text, fieldIndex) {
    return result.hits.find((hit) => hit.target?.kind === "legacy" && hit.target.section === section && (!field || hit.field === field) && (text === undefined || hit.text === String(text)) && (fieldIndex === undefined || hit.fieldIndex === fieldIndex));
  }

  function readerSection(id, number, title, content, matched) {
    if (!content) return "";
    return `<section id="section-${escapeAttribute(id)}" class="reader-card${matched ? " query-section" : ""}" data-reader-target="${escapeAttribute(id)}"><span class="section-number">${String(number).padStart(2, "0")}</span><h3>${escapeHTML(title)}</h3>${content}</section>`;
  }

  function legacyDetail(result) {
    const paper = result.paper;
    const architecture = values(paper.architecture_detail || paper.game_architecture);
    const sections = [];
    let number = 1;
    const settingHit = result.hits.find((hit) => hit.target?.kind === "legacy" && hit.target.section === "setting");
    sections.push(readerSection("setting", number++, "Players and decisions", `<div class="reader-grid"><div><p class="section-label">Players</p>${listMarkup(paper.players, (index, text) => legacyHit(result, "setting", "players", text, index))}</div><div><p class="section-label">Actions and decision variables</p>${listMarkup(paper.actions, (index, text) => legacyHit(result, "setting", "actions", text, index))}</div>${architecture.length ? `<div class="full-width"><p class="section-label">Model architecture</p>${listMarkup(architecture, (index, text) => legacyHit(result, "setting", "architecture", text, index))}</div>` : ""}</div>`, settingHit));
    const timing = String(paper.timing || "");
    const timingHit = legacyHit(result, "timing", "timing", timing);
    const information = listMarkup(paper.information, (index, text) => legacyHit(result, "timing", "information", text, index));
    sections.push(readerSection("timing", number++, "Timing and information", `${timing ? `<p${readerHitAttribute(timingHit)}>${timingHit ? highlightRanges(timing, timingHit.ranges) : escapeHTML(timing)}</p>` : ""}${information ? `<p class="section-label">Information</p>${information}` : ""}`, timingHit || result.hits.some((hit) => hit.target?.section === "timing")));
    const assumptionItems = values(paper.assumptions);
    const assumptions = [...assumptionItems, ...values(paper.caveat)];
    sections.push(readerSection("assumptions", number++, "Assumptions and boundaries", listMarkup(assumptions, (index, text) => legacyHit(result, "assumptions", index < assumptionItems.length ? "assumptions" : "caveat", text, index < assumptionItems.length ? index : index - assumptionItems.length)), result.hits.some((hit) => hit.target?.section === "assumptions")));
    const objectiveSummary = String(paper.objective?.summary || "");
    const objectiveHit = legacyHit(result, "objective", "objective", objectiveSummary);
    const formula = String(paper.objective?.formula || "");
    const formulaHit = legacyHit(result, "objective", "formula", formula);
    const notation = atlas.notationEntries(paper.notation);
    const objectiveContent = `${objectiveSummary ? `<p${readerHitAttribute(objectiveHit)}>${objectiveHit ? highlightRanges(objectiveSummary, objectiveHit.ranges) : escapeHTML(objectiveSummary)}</p>` : ""}${formula ? `<div class="formal${formulaHit ? " query-formulation" : ""}"${readerHitAttribute(formulaHit)}><span>Objective formulation</span><div class="formula-body">${mathDisplay(formula)}</div>${paper.objective.formula_source ? `<p class="formula-source">${escapeHTML(paper.objective.formula_source)}</p>` : ""}</div>` : ""}${notation.length ? `<dl class="symbols">${notation.map((entry, index) => { const hit = legacyHit(result, "objective", "notation", entry.meaning, index); return `<dt>${entry.symbol ? mathInline(entry.symbol) : "Term"}</dt><dd${hit ? " class=\"query-passage\"" : ""}${readerHitAttribute(hit)}>${mathProse(entry.meaning, hit?.ranges)}${entry.domain ? ` · ${mathProse(entry.domain)}` : ""}</dd>`; }).join("")}</dl>` : ""}`;
    sections.push(readerSection("objective", number++, "Objective and payoffs", objectiveContent, objectiveHit || formulaHit));
    const equilibrium = [paper.equilibrium?.label, paper.equilibrium?.evidence].filter(Boolean);
    sections.push(readerSection("equilibrium", number++, "Equilibrium", equilibrium.map((text, index) => { const hit = legacyHit(result, "equilibrium", "equilibrium", text, index); return `<p${readerHitAttribute(hit)}>${hit ? highlightRanges(text, hit.ranges) : escapeHTML(text)}</p>`; }).join(""), result.hits.some((hit) => hit.target?.section === "equilibrium")));
    const solution = [paper.method, paper.solution?.summary, paper.calibration?.summary].filter(Boolean);
    sections.push(readerSection("solution", number++, "Solution and results", solution.map((text) => { const hit = result.hits.find((entry) => entry.target?.section === "solution" && entry.text === text); return `<p${readerHitAttribute(hit)}>${hit ? highlightRanges(text, hit.ranges) : escapeHTML(text)}</p>`; }).join(""), result.hits.some((hit) => hit.target?.section === "solution")));
    const question = String(paper.business_question || "");
    const questionHit = legacyHit(result, "overview", "question", question);
    return `${detailHeader(paper, "Deep model map", atlas.modelTypesFor(paper), result)}<div class="reader-content">${catalogMatches(result)}<p class="section-label">The research question</p><p class="research-question${questionHit ? " query-passage" : ""}"${readerHitAttribute(questionHit)}>${questionHit ? highlightRanges(question, questionHit.ranges) : escapeHTML(question)}</p><div class="reader-card-grid">${sections.filter(Boolean).join("")}</div></div>`;
  }

  function literatureDetail(result) {
    const paper = result.paper;
    const overview = String(paper.business_question || paper.model_topic || "");
    const fields = [
      ["overview", "Research focus", "question", overview],
      ["evidence", "Modeling evidence", "modeling_evidence", paper.modeling_evidence],
      ["abstract", "Abstract", "abstract", paper.abstract]
    ];
    const sections = fields.filter((entry) => String(entry[3] || "").trim()).map(([section, title, field, text], index) => {
      const hit = result.hits.find((entry) => entry.target?.kind === "literature" && entry.target.section === section && entry.field === field && entry.text === String(text));
      return readerSection(section, index + 1, title, `<p${readerHitAttribute(hit)}>${hit ? highlightRanges(text, hit.ranges) : escapeHTML(text)}</p>`, hit);
    }).join("");
    return `${detailHeader(paper, "Evidence-indexed paper", atlas.modelTypesFor(paper), result)}<div class="reader-content">${catalogMatches(result)}<div class="reader-card-grid">${sections}</div></div>`;
  }

  function buildReaderGuide(result, selectedModel) {
    if (!state.q || !result.hits.length) {
      setVisible(elements.readerGuide, false);
      readerTargets = [];
      return;
    }
    let hits = result.hits;
    if (result.note && selectedModel) hits = hits.filter((hit) => !hit.target?.modelId || hit.target.modelId === selectedModel.id);
    const unique = [];
    const seen = new Set();
    for (const hit of hits) {
      const target = hit.target?.componentId || hit.target?.section || "overview";
      const key = `${target}|${hit.field}|${hit.fieldIndex}|${hit.bindingIndex ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ target, hit, key: readerHitKey(hit) });
    }
    readerTargets = unique;
    readerTargetIndex = 0;
    const otherModels = result.note && selectedModel ? [...new Set(result.hits.map((hit) => hit.target?.modelId).filter((id) => id && id !== selectedModel.id))] : [];
    const variants = otherModels.map((id) => result.note.models.find((model) => model.id === id)).filter(Boolean);
    elements.readerGuide.innerHTML = `<div class="reader-query-heading"><strong>“${escapeHTML(state.q)}”</strong><span class="reader-match-count">${unique.length ? plural(unique.length, "passage") + " in this view" : "No passage in this variant"}</span></div><div class="reader-query-actions">${unique.length ? `<button type="button" data-reader-jump="0">Closest passage ↗</button>${unique.length > 1 ? `<button type="button" data-reader-next>Next passage ↗</button><span id="readerMatchPosition">1 of ${unique.length}</span>` : ""}` : ""}</div>${variants.length ? `<div class="reader-variant-matches"><span>Also matched in </span>${variants.map((model) => `<button type="button" data-switch-model="${escapeAttribute(model.id)}">${mathProse(model.name)} ↗</button>`).join("")}</div>` : ""}`;
    setVisible(elements.readerGuide, true);
  }

  function jumpReader(index) {
    if (!readerTargets.length) return;
    readerTargetIndex = ((index % readerTargets.length) + readerTargets.length) % readerTargets.length;
    const item = readerTargets[readerTargetIndex];
    const exact = item.key ? elements.detailContent.querySelector?.(`[data-reader-hit="${item.key}"]`) : null;
    const target = exact || elements.detailContent.querySelector?.(`#component-${item.target}`) || elements.detailContent.querySelector?.(`#section-${item.target}`) || elements.detailContent.querySelector?.("#detailTitle");
    globalThis.MiniAtlasStack?.reveal?.(target);
    globalThis.MiniAtlasStack?.layout?.();
    elements.detailContent.querySelectorAll?.(".query-current").forEach((node) => node.classList.remove("query-current"));
    setClass(target, "query-current", true);
    const stickyHeight = Number(elements.readerGuide.parentElement?.getBoundingClientRect?.().height) || 112;
    if (target?.style) target.style.scrollMarginTop = `${Math.ceil(stickyHeight + 20)}px`;
    target?.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth", block: "start" });
    target?.focus?.({ preventScroll: true });
    const position = elements.readerGuide.querySelector?.("#readerMatchPosition");
    if (position) position.textContent = `${readerTargetIndex + 1} of ${readerTargets.length}`;
  }

  async function renderDetail() {
    const token = ++detailRenderToken;
    const result = detailResult(state.paper);
    if (!result?.paper) return;
    elements.back.textContent = `← Back to ${plural(response.results.length, "paper")}`;
    let selectedModel = null;
    if (result.note) {
      const targetId = state.model || result.hits.find((hit) => hit.target?.modelId)?.target.modelId;
      selectedModel = result.note.models.find((model) => model.id === targetId) || result.note.models[0];
      elements.detailContent.innerHTML = structuredDetail(result);
    } else if (result.paper.detail_level === "model_map") {
      elements.detailContent.innerHTML = legacyDetail(result);
    } else {
      elements.detailContent.innerHTML = literatureDetail(result);
    }
    buildReaderGuide(result, selectedModel);
    elements.detail.scrollTop = 0;
    globalThis.MiniAtlasStack?.mount?.(elements.detailContent);
    globalThis.AtlasMath?.annotate?.(elements.detailContent, selectedModel, result.note);
    await globalThis.AtlasMath?.render?.(elements.detailContent);
    if (token !== detailRenderToken || state.paper !== result.paper.id) return;
    globalThis.MiniAtlasStack?.layout?.();
    if (state.q && readerTargets.length) {
      const requestedIndex = state.component
        ? readerTargets.findIndex((entry) => entry.target === state.component)
        : -1;
      jumpReader(requestedIndex >= 0 ? requestedIndex : 0);
    } else if (state.component) {
      const target = elements.detailContent.querySelector?.(`#component-${state.component}`);
      globalThis.MiniAtlasStack?.reveal?.(target);
      globalThis.MiniAtlasStack?.layout?.();
      target?.scrollIntoView?.({ block: "start" });
      elements.detailContent.querySelector?.("#detailTitle")?.focus?.({ preventScroll: true });
    } else {
      elements.detailContent.querySelector?.("#detailTitle")?.focus?.({ preventScroll: true });
    }
  }

  function positionTooltip(point) {
    if (!point || elements.tooltip.hidden) return;
    const bounds = elements.tooltip.getBoundingClientRect();
    const width = bounds.width || 340;
    const height = bounds.height || 280;
    let left = Number(point.x || 0) + 18;
    let top = Number(point.y || 0) - 30;
    if (left + width > window.innerWidth - 14) left = Number(point.x || 0) - width - 18;
    left = Math.max(14, Math.min(left, window.innerWidth - width - 14));
    top = Math.max(118, Math.min(top, window.innerHeight - height - 14));
    elements.tooltip.style.left = `${left}px`;
    elements.tooltip.style.top = `${top}px`;
  }

  function previewContent(result, hit) {
    if (!hit) return { text: result.note?.overview || result.paper.business_question || result.paper.model_topic || "", context: "", contextLabel: "" };
    const binding = resolveBinding(result, hit);
    const component = hit.component;
    const model = hit.model;
    let text = hit.text;
    let context = "";
    let contextLabel = "In this model";
    if (["concept", "representation"].includes(hit.field) && binding) {
      text = binding.representation;
      context = component?.explanation || "";
    } else if (component && ["concept", "componentLabel", "searchPhrases"].includes(hit.field)) {
      text = component.explanation || hit.text;
      if (hit.field === "searchPhrases") {
        context = hit.text;
        contextLabel = "Matching description";
      }
    } else if (component) {
      context = component.explanation || "";
    } else if (hit.scope === "model") {
      context = model?.summary || "";
    } else if (hit.scope === "metadata") {
      context = result.note?.question || result.paper.business_question || "";
      contextLabel = "Research question";
    }
    const normalized = (value) => String(value || "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalized(context) || normalized(context) === normalized(text) || normalized(text).includes(normalized(context))) context = "";
    return { text, context, contextLabel };
  }

  function renderTooltip(paper, point, pinned = false) {
    const result = response.results.find((entry) => entry.paper.id === paper.id) || detailResult(paper.id);
    const hit = result?.bestHit || result?.hits?.[0];
    const preview = previewContent(result, hit);
    window.clearTimeout(tooltipTimer);
    tooltipCandidate = null;
    tooltipPaper = paper.id;
    tooltipPinned = pinned;
    elements.tooltipHeading.textContent = state.q && hit ? "Why it matches" : "Model preview";
    elements.tooltipMeta.textContent = `${journalNames[paper.journal_code] || paper.journal} · ${paper.year}`;
    elements.tooltipTitle.innerHTML = `<a ${targetLinkAttributes(result, hit)}>${escapeHTML(paper.title)}</a>`;
    elements.tooltipAuthors.textContent = paper.authors_text;
    elements.tooltipDimension.textContent = hit ? evidenceLabel(hit) : maturityLabels[resultDepth(result)];
    const applicability = applicabilityFor(result, hit);
    const notice = applicability === "explicitlyExcluded" ? "Explicitly outside this part of the model"
      : applicability === "backgroundOnly" ? "Context only; not modeled here"
        : applicability === "unknown" ? "Use in this model is unresolved" : "";
    elements.tooltipNotice.textContent = notice;
    elements.tooltipNotice.hidden = !notice;
    elements.tooltipReason.innerHTML = hit && preview.text === hit.text
      ? structuredHitMarkup(hit)
      : result.note && (!hit || hit.target?.kind === "structured")
        ? mathProse(preview.text || "Open the paper note to inspect the evidence.")
        : escapeHTML(preview.text || "Open the paper note to inspect the evidence.");
    elements.tooltipContextLabel.textContent = preview.contextLabel;
    elements.tooltipContextText.innerHTML = hit?.target?.kind === "structured" ? mathProse(preview.context) : escapeHTML(preview.context);
    elements.tooltipContextBlock.hidden = !preview.context;
    elements.tooltipActions.innerHTML = `<a class="tooltip-read" ${targetLinkAttributes(result, hit)}>Read ${resultDepth(result) === "literature" ? "record" : "model"} ↗</a>${articleLinks(paper)}`;
    elements.tooltip.hidden = false;
    setClass(elements.tooltip, "is-visible", true);
    positionTooltip(point);
    tooltipOrigin = pinned ? null : { ...(tooltipPointer || point) };
    tooltipDistance = distanceToTooltip(tooltipOrigin || point, elements.tooltip.getBoundingClientRect());
    tooltipProgressAt = Date.now();
    for (const button of document.querySelectorAll?.("[data-preview-paper]") || []) {
      button.setAttribute("aria-expanded", String(button.dataset.previewPaper === paper.id));
    }
    scene?.setHighlightedPaper?.(paper.id);
    if (pinned) elements.tooltip.focus?.({ preventScroll: true });
  }

  function hideTooltip(force = false, restoreFocus = false) {
    if (tooltipPinned && !force) return;
    const returnTarget = tooltipReturn;
    window.clearTimeout(tooltipTimer);
    window.clearTimeout(tooltipHideTimer);
    tooltipCandidate = null;
    tooltipPaper = "";
    tooltipPinned = false;
    tooltipOrigin = null;
    tooltipPointer = null;
    tooltipDistance = Infinity;
    tooltipReturn = null;
    setClass(elements.tooltip, "is-visible", false);
    elements.tooltip.hidden = true;
    for (const button of document.querySelectorAll?.("[data-preview-paper]") || []) button.setAttribute("aria-expanded", "false");
    scene?.setHighlightedPaper?.(null);
    if (restoreFocus && returnTarget?.isConnected !== false) returnTarget?.focus?.({ preventScroll: true });
  }

  function scheduleTooltipHide(delay = 260) {
    if (tooltipPinned) return;
    window.clearTimeout(tooltipHideTimer);
    tooltipHideTimer = window.setTimeout(() => hideTooltip(), delay);
  }

  function distanceToTooltip(point, rect) {
    if (!point || !rect) return Infinity;
    const left = Number(rect.left) || 0;
    const top = Number(rect.top) || 0;
    const right = Number(rect.right) || left + (Number(rect.width) || 0);
    const bottom = Number(rect.bottom) || top + (Number(rect.height) || 0);
    return Math.hypot(Math.max(left - point.x, 0, point.x - right), Math.max(top - point.y, 0, point.y - bottom));
  }

  function inTooltipCorridor(point) {
    if (!point || !tooltipOrigin || elements.tooltip.hidden) return false;
    const bounds = elements.tooltip.getBoundingClientRect();
    const left = Number(bounds.left) || 0;
    const top = Number(bounds.top) || 0;
    const right = Number(bounds.right) || left + (Number(bounds.width) || 0);
    const bottom = Number(bounds.bottom) || top + (Number(bounds.height) || 0);
    const origin = tooltipOrigin;
    let a;
    let b;
    let c;
    if (origin.x < left) {
      a = { x: origin.x - 10, y: origin.y }; b = { x: left + 4, y: top - 12 }; c = { x: left + 4, y: bottom + 12 };
    } else if (origin.x > right) {
      a = { x: origin.x + 10, y: origin.y }; b = { x: right - 4, y: top - 12 }; c = { x: right - 4, y: bottom + 12 };
    } else if (origin.y < top) {
      a = { x: origin.x, y: origin.y - 10 }; b = { x: left - 12, y: top + 4 }; c = { x: right + 12, y: top + 4 };
    } else if (origin.y > bottom) {
      a = { x: origin.x, y: origin.y + 10 }; b = { x: left - 12, y: bottom - 4 }; c = { x: right + 12, y: bottom - 4 };
    } else {
      return false;
    }
    const side = (p, u, v) => (p.x - v.x) * (u.y - v.y) - (u.x - v.x) * (p.y - v.y);
    const signs = [side(point, a, b), side(point, b, c), side(point, c, a)];
    return !(signs.some((value) => value < 0) && signs.some((value) => value > 0));
  }

  function tooltipTravelProtected() {
    return !tooltipPinned && tooltipOrigin && Date.now() - tooltipProgressAt < 360
      && inTooltipCorridor(tooltipPointer || tooltipCandidate?.point);
  }

  function scheduleTooltip(paper, point, delay) {
    window.clearTimeout(tooltipTimer);
    const candidate = { paper, point };
    tooltipCandidate = candidate;
    const commit = () => {
      if (tooltipCandidate !== candidate || tooltipPinned) return;
      if (tooltipTravelProtected()) {
        tooltipTimer = window.setTimeout(commit, 120);
        return;
      }
      renderTooltip(candidate.paper, candidate.point, false);
    };
    tooltipTimer = window.setTimeout(commit, delay);
  }

  function trackTooltipPointer(event) {
    if (event.pointerType && event.pointerType !== "mouse") return;
    tooltipPointer = { x: event.clientX, y: event.clientY };
    if (!tooltipPaper || tooltipPinned || elements.tooltip.hidden) return;
    const rect = elements.tooltip.getBoundingClientRect();
    const distance = distanceToTooltip(tooltipPointer, rect);
    if (inTooltipCorridor(tooltipPointer) && distance < tooltipDistance - 0.1) tooltipProgressAt = Date.now();
    tooltipDistance = distance;
    if (elements.tooltip.contains?.(event.target)) {
      window.clearTimeout(tooltipTimer);
      tooltipCandidate = null;
      window.clearTimeout(tooltipHideTimer);
    }
  }

  function showTooltip(paper, point) {
    const mode = body.dataset.atlasMode;
    if (!paper || !point || state.layout === "classic" || !["home", "browse", "results"].includes(mode)) {
      window.clearTimeout(tooltipTimer);
      tooltipCandidate = null;
      scheduleTooltipHide();
      return;
    }
    if (tooltipPinned) return;
    window.clearTimeout(tooltipHideTimer);
    if (tooltipPaper === paper.id && !elements.tooltip.hidden) {
      positionTooltip(point);
      return;
    }
    if (tooltipCandidate?.paper?.id === paper.id) {
      tooltipCandidate.point = point;
      return;
    }
    scheduleTooltip(paper, point, elements.tooltip.hidden ? 90 : 180);
  }

  function previewPaper(id, trigger) {
    const paper = paperById.get(id);
    if (!paper) return;
    const rect = trigger?.getBoundingClientRect?.() || { right: window.innerWidth / 2, top: window.innerHeight / 2 };
    tooltipReturn = trigger || document.activeElement;
    renderTooltip(paper, { x: rect.right || window.innerWidth / 2, y: rect.top || window.innerHeight / 2 }, true);
  }

  function syncScene(mode, panelOpen) {
    if (!scene) return;
    const active = mode === "home" ? papers.map((paper) => paper.id)
      : mode === "detail" ? [state.paper]
        : response.results.map((result) => result.paper.id);
    scene.setActivePapers(active);
    scene.setMode(mode);
    scene.setPanelOpen(panelOpen);
    scene.setRankedPapers?.(mode === "results" && state.q ? response.results.map((result) => ({ id: result.paper.id, rank: result.rank })) : []);
  }

  function render() {
    const topic = topicIndex.find((entry) => entry.id === state.topic && !state.q);
    if (state.topic && !topic) state.topic = "";
    const signature = JSON.stringify([state.q, state.type, state.journal, state.level, state.topic]);
    if (signature !== renderSignature) {
      renderSignature = signature;
      panelLimit = PANEL_PAGE;
      rankedExpanded = false;
      rankedCollapsed = false;
    }
    response = responseForState();
    const mode = activeMode();
    const panelOpen = mode !== "detail" && (state.layout === "classic" || forcePanels);
    body.dataset.atlasMode = mode;
    body.dataset.resultView = panelOpen ? "classic" : "galaxy";

    elements.query.value = state.q;
    elements.typeFilter.value = state.type;
    elements.journalFilter.value = state.journal;
    elements.levelFilter.value = state.level;
    elements.viewToggle.setAttribute("aria-pressed", String(panelOpen));
    elements.viewToggleLabel.textContent = panelOpen ? "Galaxy" : "Panels";
    elements.viewToggle.disabled = forcePanels;
    elements.resetFilters.hidden = !(state.q || state.type || state.journal || state.level || state.topic);

    setVisible(elements.home, !panelOpen && ["home", "browse"].includes(mode));
    setVisible(elements.resultsHud, !panelOpen && mode === "results");
    setVisible(elements.galaxyActions, !panelOpen && mode === "results" && response.results.length > 0);
    setVisible(elements.relevanceKey, !panelOpen && mode === "results" && Boolean(state.q) && response.results.length > 0);
    setVisible(elements.emptyState, !panelOpen && mode === "results" && response.results.length === 0);
    setVisible(elements.panels, panelOpen);
    setVisible(elements.detail, mode === "detail");
    elements.nav.inert = mode === "detail";
    elements.searchStage.inert = mode === "detail";

    renderTopicIndex(topic);
    if (mode === "results") {
      elements.queryLabel.textContent = state.q || state.type || (state.journal ? journalNames[state.journal] || state.journal : "Selected papers");
      elements.resultsCount.textContent = `${plural(response.results.length, "paper")} connected to this view.`;
      elements.matchNote.textContent = response.warnings[0] || (state.q ? "Larger, brighter stars are closer matches; the double ring marks the closest." : "Select a paper to inspect its evidence.");
      renderRanked();
    }
    if (panelOpen) renderPanels();
    hideTooltip(true);
    syncScene(mode, panelOpen);
    if (mode === "detail") renderDetail();
    if (panelOpen && panelReturn) {
      const restore = panelReturn;
      panelReturn = null;
      window.requestAnimationFrame(() => {
        elements.panelResults.scrollTop = restore.scroll;
        elements.panelResults.querySelector?.(`[data-paper-card="${restore.paper}"] .result-title`)?.focus?.({ preventScroll: true });
      });
    }
  }

  function usableFocusTarget(target) {
    return target && target !== document.body && target.isConnected !== false && !target.closest?.("[hidden]");
  }

  function switchLayout(layout, opener) {
    if (layout === "classic") panelOpener = opener || document.activeElement || elements.viewToggle;
    const returning = panelOpener;
    writeState({ layout, paper: "", model: "", component: "" });
    window.requestAnimationFrame(() => {
      if (layout === "classic") elements.closePanels.focus?.({ preventScroll: true });
      else {
        (usableFocusTarget(returning) ? returning : elements.viewToggle).focus?.({ preventScroll: true });
        panelOpener = null;
      }
    });
  }

  function restoreDetailFocus() {
    const target = usableFocusTarget(detailOpener) ? detailOpener : elements.viewToggle;
    detailOpener = null;
    target.focus?.({ preventScroll: true });
  }

  function backFromDetail() {
    const panelWillRestore = Boolean(panelReturn);
    writeState({ paper: "", model: "", component: "" });
    if (!panelWillRestore) window.requestAnimationFrame(restoreDetailFocus);
  }

  function openResult(paperId, modelId = "", componentId = "", section = "") {
    const id = resolvePaperId(paperId);
    if (!id) return;
    if (!elements.panels.hidden) {
      panelReturn = { paper: id, scroll: elements.panelResults.scrollTop || 0 };
      detailOpener = null;
    } else {
      detailOpener = document.activeElement;
    }
    writeState({ paper: id, model: modelId, component: componentId || "" });
    if (section && !componentId) window.requestAnimationFrame(() => elements.detailContent.querySelector?.(`#section-${section}`)?.scrollIntoView?.({ block: "start" }));
  }

  function resetAll() {
    writeState({ q: "", type: "", journal: "", level: "", topic: "", paper: "", model: "", component: "", layout: "galaxy" });
  }

  function delegatedAction(event) {
    const target = event.target?.closest?.("[data-open-paper],[data-preview-paper],[data-reset],[data-search-query],[data-switch-model],[data-jump-component],[data-reader-jump],[data-reader-next],[data-copy-link]");
    if (!target) return;
    const modifiedLink = target.matches?.("a") && ((Number.isFinite(event.button) && event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
    if (modifiedLink) return;
    if (target.matches?.("a")) event.preventDefault();
    const data = target.dataset;
    if (data.openPaper) openResult(data.openPaper, data.openModel || "", data.openComponent || "", data.openSection || "");
    else if (data.previewPaper) previewPaper(data.previewPaper, target);
    else if (data.reset !== undefined) resetAll();
    else if (data.searchQuery !== undefined) writeState({ q: data.searchQuery, topic: "", paper: "", model: "", component: "" });
    else if (data.switchModel) writeState({ model: data.switchModel, component: "" });
    else if (data.jumpComponent) writeState({ component: data.jumpComponent });
    else if (data.readerJump !== undefined) jumpReader(Number(data.readerJump) || 0);
    else if (data.readerNext !== undefined) jumpReader(readerTargetIndex + 1);
    else if (data.copyLink !== undefined) void copyDetailLink(data.copyLink);
  }

  try {
    if (!galaxyAPI?.GalaxyScene || forcePanels) throw new Error("Accessible Panels view requested");
    scene = new galaxyAPI.GalaxyScene(elements.canvas, {
      onHover: showTooltip,
      onSelect: (paper) => {
        const result = response.results.find((entry) => entry.paper.id === paper.id) || detailResult(paper.id);
        const hit = result?.bestHit || result?.hits?.[0];
        if (state.q && window.matchMedia?.("(pointer: coarse)")?.matches) {
          previewPaper(paper.id, elements.canvas);
          return;
        }
        openResult(paper.id, hit?.target?.modelId || "", hit?.target?.componentId || "", hit?.target?.section || "");
      }
    });
    scene.setMode("boot");
  } catch (error) {
    scene = null;
    forcePanels = true;
    elements.canvas.hidden = true;
    console.warn("Galaxy unavailable; using the accessible Panels view.", error);
  }
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    writeState({ q: elements.query.value.trim(), topic: "", paper: "", model: "", component: "" });
    elements.query.blur?.();
  });
  elements.searchStage.addEventListener("click", (event) => {
    const suggestion = event.target?.closest?.("[data-query]");
    if (!suggestion) return;
    elements.query.value = suggestion.dataset.query;
    writeState({ q: suggestion.dataset.query, topic: "", paper: "", model: "", component: "" });
  });
  elements.topicList.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-topic]");
    if (!button) return;
    writeState({ topic: button.dataset.topic === state.topic ? "" : button.dataset.topic, q: "", type: "", journal: "", level: "", paper: "", model: "", component: "" });
  });
  elements.resetTopic.addEventListener("click", () => writeState({ topic: "", paper: "", model: "", component: "" }));
  elements.brand.addEventListener("click", (event) => { event.preventDefault(); resetAll(); });
  elements.viewToggle.addEventListener("click", (event) => switchLayout(state.layout === "classic" ? "galaxy" : "classic", event.currentTarget));
  elements.seeInPanels.addEventListener("click", (event) => switchLayout("classic", event.currentTarget));
  elements.closePanels.addEventListener("click", () => switchLayout("galaxy"));
  elements.back.addEventListener("click", backFromDetail);
  elements.resetFilters.addEventListener("click", resetAll);
  elements.emptyState.addEventListener("click", delegatedAction);
  elements.panelResults.addEventListener("click", delegatedAction);
  elements.rankedMatches.addEventListener("click", delegatedAction);
  elements.tooltip.addEventListener("click", delegatedAction);
  elements.detailContent.addEventListener("click", delegatedAction);
  elements.readerGuide.addEventListener("click", delegatedAction);
  elements.loadMore.addEventListener("click", () => { panelLimit += PANEL_PAGE; renderPanels(); elements.loadMore.focus?.({ preventScroll: true }); });
  elements.toggleRanked.addEventListener("click", () => { rankedCollapsed = !rankedCollapsed; renderRanked(); });
  elements.expandMatches.addEventListener("click", () => { rankedExpanded = !rankedExpanded; renderRanked(); elements.expandMatches.focus?.({ preventScroll: true }); });
  elements.tooltipClose.addEventListener("click", () => hideTooltip(true, true));
  elements.tooltip.addEventListener("pointerenter", () => {
    window.clearTimeout(tooltipTimer);
    tooltipCandidate = null;
    window.clearTimeout(tooltipHideTimer);
  });
  elements.tooltip.addEventListener("pointerleave", () => scheduleTooltipHide(180));
  elements.tooltip.addEventListener("focusin", () => {
    window.clearTimeout(tooltipTimer);
    tooltipCandidate = null;
    window.clearTimeout(tooltipHideTimer);
  });
  elements.tooltip.addEventListener("focusout", (event) => {
    if (!elements.tooltip.contains?.(event.relatedTarget)) scheduleTooltipHide(180);
  });
  elements.canvas.addEventListener("pointerdown", () => { if (!tooltipPinned) hideTooltip(true); }, { capture: true });
  elements.canvas.addEventListener("wheel", () => { if (!tooltipPinned) hideTooltip(true); }, { passive: true });
  elements.rankedMatches.addEventListener("pointerover", (event) => {
    const row = event.target?.closest?.("[data-ranked-paper]");
    if (row && !tooltipPinned) scene?.setHighlightedPaper?.(row.dataset.rankedPaper);
  });
  elements.rankedMatches.addEventListener("pointerleave", () => { if (!tooltipPinned) scene?.setHighlightedPaper?.(null); });
  elements.rankedMatches.addEventListener("focusin", (event) => {
    const row = event.target?.closest?.("[data-ranked-paper]");
    if (row && !tooltipPinned) scene?.setHighlightedPaper?.(row.dataset.rankedPaper);
  });
  elements.rankedMatches.addEventListener("focusout", (event) => {
    if (!tooltipPinned && !elements.rankedMatches.contains?.(event.relatedTarget)) scene?.setHighlightedPaper?.(null);
  });
  elements.typeFilter.addEventListener("change", (event) => writeState({ type: event.target.value, paper: "", model: "", component: "" }));
  elements.journalFilter.addEventListener("change", (event) => writeState({ journal: event.target.value, paper: "", model: "", component: "" }));
  elements.levelFilter.addEventListener("change", (event) => writeState({ level: event.target.value, paper: "", model: "", component: "" }));
  window.addEventListener("popstate", () => {
    const wasDetail = body.dataset.atlasMode === "detail";
    const wasPanelOpen = !elements.panels.hidden;
    const panelWillRestore = Boolean(panelReturn);
    state = readState();
    render();
    if (wasDetail && !panelWillRestore && body.dataset.atlasMode !== "detail") window.requestAnimationFrame(restoreDetailFocus);
    else if (!wasDetail && wasPanelOpen && elements.panels.hidden) {
      const returning = usableFocusTarget(panelOpener) ? panelOpener : elements.viewToggle;
      panelOpener = null;
      window.requestAnimationFrame(() => returning.focus?.({ preventScroll: true }));
    } else if (!wasDetail && !wasPanelOpen && !elements.panels.hidden) {
      window.requestAnimationFrame(() => elements.closePanels.focus?.({ preventScroll: true }));
    }
  });
  window.addEventListener("pointermove", (event) => {
    trackTooltipPointer(event);
    if (tooltipPinned || !tooltipPaper) return;
    if (inTooltipCorridor({ x: event.clientX, y: event.clientY })) window.clearTimeout(tooltipHideTimer);
    else scheduleTooltipHide(140);
  }, { passive: true });
  window.addEventListener("blur", () => hideTooltip(true));
  window.addEventListener("resize", () => { if (!tooltipPinned) hideTooltip(true); });
  document.addEventListener?.("pointerdown", (event) => {
    if (tooltipPinned && !event.target?.closest?.("#nodeTooltip,[data-preview-paper]")) hideTooltip(true);
  });
  window.addEventListener("keydown", (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "") || event.target?.isContentEditable;
    if (event.key === "/" && !typing && body.dataset.atlasMode !== "detail") {
      event.preventDefault(); elements.query.focus?.(); return;
    }
    if (event.key !== "Escape") return;
    if (!elements.tooltip.hidden) hideTooltip(true, true);
    else if (body.dataset.atlasMode === "detail") elements.back.click();
    else if (state.layout === "classic" && !forcePanels) switchLayout("galaxy");
    else if (state.q || state.type || state.journal || state.level || state.topic) resetAll();
  });

  globalThis.AtlasDataLoader.loadPayload({ jsonURL: DATA_URL, snapshotURL: SNAPSHOT_URL })
    .then((payload) => {
      const validated = atlas.validatePayload(payload);
      if (validated.errors.length) throw new Error(`Dataset validation failed: ${validated.errors.join("; ")}`);
      const noteErrors = validateNotePayload(notePayload, validated.records, payload.schema_version);
      if (noteErrors.length) throw new Error(`Model-note layer validation failed: ${noteErrors.join("; ")}`);
      papers = validated.records;
      paperById = new Map(papers.map((paper) => [paper.id, paper]));
      routeAlias = new Map(papers.map((paper) => [normalizedDoiId(paper.doi), paper.id]));
      noteById = new Map(values(notePayload.papers).map((note) => [note.id, note]));
      conceptById = new Map(values(notePayload.concepts).map((concept) => [concept.id, concept]));
      searchIndex = atlas.createSearchIndex(papers, notePayload);
      topicIndex = topicsAPI?.createTopicIndex(papers) || [];
      elements.topicList.innerHTML = topicIndex.map((topic, index) => `<button type="button" class="topic-button" data-topic="${escapeAttribute(topic.id)}" aria-pressed="false"><span class="topic-number">${String(index + 1).padStart(2, "0")}</span><span class="topic-name">${escapeHTML(topic.label)}</span><span class="topic-count">${topic.count}</span><span class="topic-indicator" aria-hidden="true">↗</span></button>`).join("");
      elements.topicList.setAttribute("aria-busy", "false");
      elements.typeFilter.innerHTML = `<option value="">All approaches</option>${searchIndex.modelTypes.map((type) => `<option value="${escapeAttribute(type)}">${escapeHTML(type)}</option>`).join("")}`;
      const journals = [...new Set(papers.map((paper) => paper.journal_code))].sort();
      elements.journalFilter.innerHTML = `<option value="">All journals</option>${journals.map((code) => `<option value="${escapeAttribute(code)}">${escapeHTML(journalNames[code] || code)}</option>`).join("")}`;
      scene?.setRecords(papers.map(galaxyRecord));
      state = readState();
      if (forcePanels) state.layout = "classic";
      elements.loadState.classList.add("is-ready");
      window.history.replaceState({ atlas: true }, "", stateURL(state));
      render();
    })
    .catch((error) => {
      console.error(error);
      elements.loadState.classList.add("is-ready");
      body.dataset.atlasMode = "error";
      elements.query.disabled = true;
      elements.searchForm.querySelector?.("button[type='submit']") && (elements.searchForm.querySelector("button[type='submit']").disabled = true);
      setVisible(elements.emptyState, true);
      const heading = elements.emptyState.querySelector?.("h2");
      const copy = elements.emptyState.querySelector?.("p:last-of-type");
      if (heading) heading.textContent = "The collection could not be mapped.";
      if (copy) copy.textContent = `${error.message}. Keep the data folder beside index.html or use the local preview server.`;
    });
})();
