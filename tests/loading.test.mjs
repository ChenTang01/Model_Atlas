import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { renderSnapshot } from "../scripts/build-data.mjs";
import { literatureRecord, schema31Payload } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const atlas = require("../assets/explorer.js");
const topics = require("../assets/topics.js");
const payload = JSON.parse(await readFile(new URL("../data/atlas_articles.json", import.meta.url), "utf8"));
const modelNotes = JSON.parse(await readFile(new URL("../data/model_notes.json", import.meta.url), "utf8"));
const loaderSource = await readFile(new URL("../assets/data-loader.js", import.meta.url), "utf8");
const controllerSource = await readFile(new URL("../assets/galaxy-controller.js", import.meta.url), "utf8");
const snapshotSource = await readFile(new URL("../data/atlas_articles.js", import.meta.url), "utf8");
const sources = { jsonURL: "data/atlas_articles.json", snapshotURL: "data/atlas_articles.js" };
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const modelMapRecord = payload.records.find((paper) => paper.detail_level !== "literature");
const searchIndex = atlas.createSearchIndex(payload.records, modelNotes);
const platformCompetitionResults = searchIndex.search("platform competition").results;
const platformCompetitionIds = platformCompetitionResults.map((result) => result.paper.id);

function singleNoteOverlay(note, paper, concepts = []) {
  return {
    schemaVersion: 2,
    sourceSchemaVersion: payload.schema_version,
    concepts,
    papers: [{ ...note, sourceId: paper.id, sha256: paper.pdf_sha256 }]
  };
}

function catalogWithRecords(records) {
  const modelMaps = records.filter((paper) => paper.detail_level === "model_map").length;
  const literatureRecords = records.filter((paper) => paper.detail_level === "literature").length;
  return {
    ...payload,
    audit: {
      ...payload.audit,
      records: records.length,
      pdf_available: records.length,
      pdf_verified: records.length,
      independently_audited: modelMaps,
      model_maps: modelMaps,
      literature_records: literatureRecords
    },
    records
  };
}

function element() {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();
  const children = new Map();
  let topicMarkup = "";
  let topicButtons = [];
  return {
    dataset: {}, style: {}, value: "", textContent: "", innerHTML: "", hidden: false,
    isConnected: true, focusCount: 0, blurCount: 0,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name)
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) || []).filter((listener) => listener !== handler));
    },
    dispatch(type, details = {}) {
      const event = {
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        target: this,
        currentTarget: this,
        ...details
      };
      this[`on${type}`]?.(event);
      (listeners.get(type) || []).forEach((handler) => handler(event));
      return event;
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    querySelectorAll(selector) {
      if (selector !== "[data-topic]") return [];
      if (topicMarkup !== this.innerHTML) {
        topicMarkup = this.innerHTML;
        topicButtons = [...topicMarkup.matchAll(/data-topic="([^"]+)"/g)].map((match) => {
          const button = element();
          button.dataset.topic = match[1];
          return button;
        });
      }
      return topicButtons;
    },
    contains(candidate) { return candidate === this; },
    remove() { this.isConnected = false; },
    focus() { this.focusCount += 1; },
    blur() { this.blurCount += 1; },
    scrollIntoView() {},
    click() { this.dispatch("click"); },
    getBoundingClientRect() { return { width: 240, height: 100 }; }
  };
}

function createEnvironment({
  href = "file:///C:/Example%20Library/Atlas/index.html",
  snapshot = payload,
  missingSnapshot = false,
  scriptError = false,
  fetchImplementation = async () => ({ ok: true, status: 200, json: async () => payload })
} = {}) {
  const nodes = new Map();
  const scripts = [];
  const fetches = [];
  const errors = [];
  const browserEvents = element();
  const documentEvents = element();
  const context = vm.createContext({
    URL, URLSearchParams, Promise, setTimeout, clearTimeout,
    innerWidth: 1280, innerHeight: 800,
    location: new URL(href),
    console: { log() {}, warn() {}, error: (...messages) => errors.push(messages) },
    fetch: (...args) => {
      fetches.push(args);
      return fetchImplementation(...args);
    }
  });
  context.window = context;
  context.document = {
    body: element(),
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    querySelectorAll() { return []; },
    addEventListener(type, listener) { documentEvents.addEventListener(type, listener); },
    createElement(tag) {
      assert.equal(tag, "script");
      return element();
    },
    head: {
      appendChild(script) {
        scripts.push(script);
        queueMicrotask(() => {
          if (scriptError) {
            script.dispatch("error");
            return;
          }
          if (!missingSnapshot) context.AtlasArticleSnapshot = snapshot;
          script.dispatch("load");
        });
        return script;
      }
    }
  };
  context.document.body.dataset = { atlasMode: "boot", resultView: "galaxy" };
  vm.runInContext(loaderSource, context, { filename: "assets/data-loader.js" });
  return { context, nodes, scripts, fetches, errors, browserEvents, documentEvents };
}

test("the checked-in direct-open snapshot is generated from the authoritative JSON", () => {
  assert.equal(snapshotSource, renderSnapshot(payload), "regenerate the snapshot with node scripts/build-data.mjs");
  const context = vm.createContext({});
  vm.runInContext(snapshotSource, context, { filename: "data/atlas_articles.js" });
  assert.deepEqual(plain(context.AtlasArticleSnapshot), payload);
  assert.equal(context.AtlasArticleSnapshot.records.length, payload.records.length);
  assert.deepEqual(atlas.validatePayload(context.AtlasArticleSnapshot).errors, []);
});

test("direct-open loading uses a classic script and never fetches a file URL", async () => {
  const environment = createEnvironment({
    fetchImplementation: () => { throw new Error("file URLs must not be fetched"); }
  });
  const loaded = await environment.context.AtlasDataLoader.loadPayload(sources);
  assert.deepEqual(plain(loaded), payload);
  assert.equal(environment.fetches.length, 0);
  assert.equal(environment.scripts.length, 1);
  assert.equal(new URL(environment.scripts[0].src, environment.context.location).href,
    new URL(sources.snapshotURL, environment.context.location).href);
  assert.notEqual(environment.scripts[0].type, "module", "local files require a classic script");
});

test("missing, unreadable, or malformed local snapshots reject with a useful error", async (context) => {
  const cases = [
    ["script cannot be loaded", { scriptError: true }],
    ["script did not publish data", { missingSnapshot: true }],
    ["null snapshot", { snapshot: null }],
    ["missing records", { snapshot: {} }],
    ["non-array records", { snapshot: { records: "invalid" } }]
  ];
  for (const [name, options] of cases) {
    await context.test(name, async () => {
      const environment = createEnvironment(options);
      await assert.rejects(environment.context.AtlasDataLoader.loadPayload(sources), /snapshot|dataset|records|local|load/i);
      assert.equal(environment.fetches.length, 0);
    });
  }
});

test("HTTP and HTTPS load current JSON without loading or using the local snapshot", async () => {
  for (const href of ["http://127.0.0.1:8000/", "https://example.test/Model_Atlas/"]) {
    const livePayload = { ...payload, testVersion: "fresh JSON" };
    const environment = createEnvironment({
      href,
      fetchImplementation: async () => ({ ok: true, status: 200, json: async () => livePayload })
    });
    environment.context.AtlasArticleSnapshot = { ...payload, testVersion: "stale snapshot" };
    const loaded = await environment.context.AtlasDataLoader.loadPayload(sources);
    assert.equal(loaded.testVersion, "fresh JSON");
    assert.equal(environment.fetches.length, 1);
    assert.equal(environment.fetches[0][0], sources.jsonURL);
    assert.equal(environment.scripts.length, 0);
  }
});

test("hosted HTTP, network, and JSON errors are not hidden by a stale snapshot", async (context) => {
  const cases = [
    ["HTTP error", async () => ({ ok: false, status: 503, json: async () => payload }), /503/],
    ["network error", async () => { throw new Error("Network is offline"); }, /offline/],
    ["malformed JSON", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Malformed JSON"); } }), /Malformed JSON/]
  ];
  for (const [name, fetchImplementation, expected] of cases) {
    await context.test(name, async () => {
      const environment = createEnvironment({ href: "https://example.test/Model_Atlas/", fetchImplementation });
      environment.context.AtlasArticleSnapshot = payload;
      await assert.rejects(environment.context.AtlasDataLoader.loadPayload(sources), expected);
      assert.equal(environment.scripts.length, 0);
    });
  }
});

function startController(environment) {
  const { context, browserEvents } = environment;
  const entries = [{ url: context.location.href, state: null }];
  let index = 0;
  const route = (state, target, push) => {
    const nextURL = new URL(target, context.location.href);
    assert.equal(nextURL.protocol, context.location.protocol);
    assert.equal(nextURL.host, context.location.host);
    if (nextURL.protocol === "file:") assert.equal(nextURL.pathname, context.location.pathname);
    if (push) {
      entries.splice(index + 1);
      index += 1;
    }
    entries[index] = { url: nextURL.href, state };
    context.location = nextURL;
  };
  context.history = {
    get state() { return entries[index].state; },
    replaceState(state, unused, target) { route(state, target, false); },
    pushState(state, unused, target) { route(state, target, true); },
    back() {
      if (!index) return;
      index -= 1;
      context.location = new URL(entries[index].url);
      browserEvents.dispatch("popstate");
    }
  };
  context.GameTheoryModelAtlas = atlas;
  context.AtlasTopics = topics;
  context.AtlasModelNotes = Object.prototype.hasOwnProperty.call(environment, "modelNotes")
    ? environment.modelNotes
    : modelNotes;
  environment.retargetCount = 0;
  environment.zoomState = { scale: 1, min: 0.5, max: 3.5 };
  environment.zoomCalls = [];
  context.AtlasGalaxy = {
    GalaxyScene: class {
      constructor(canvas, callbacks) {
        if (environment.rendererUnavailable) throw new Error("Canvas is unavailable");
        environment.sceneCallbacks = callbacks;
      }
      setMode(mode) { environment.sceneMode = mode; }
      setPanelOpen(open) { environment.panelOpen = open; }
      setActivePapers(ids) {
        environment.activePapers = [...ids];
        environment.retargetCount += 1;
      }
      setRankedPapers(entries) { environment.rankedPapers = entries.map((entry) => ({ ...entry })); }
      setHighlightedPaper(id) { environment.highlightedPaper = id || null; }
      setRecords(records) { environment.sceneRecords = records; }
      getZoomState() { return { ...environment.zoomState }; }
      zoomBy(factor) {
        environment.zoomCalls.push(factor);
        const state = environment.zoomState;
        state.scale = Math.max(state.min, Math.min(state.max, state.scale * factor));
        environment.sceneCallbacks.onZoomChange?.(this.getZoomState());
      }
      resetZoom() {
        environment.zoomCalls.push("reset");
        environment.zoomState.scale = 1;
        environment.sceneCallbacks.onZoomChange?.(this.getZoomState());
      }
    }
  };
  context.matchMedia = (query) => ({
    matches: query === "(forced-colors: active)" && Boolean(environment.forcedColors)
      || query === "(pointer: coarse)" && Boolean(environment.coarsePointer)
  });
  context.requestAnimationFrame = (callback) => callback();
  const timeouts = new Map();
  let timeoutId = 0;
  context.setTimeout = (callback, delay = 0) => {
    timeoutId += 1;
    timeouts.set(timeoutId, { callback, delay });
    return timeoutId;
  };
  context.clearTimeout = (id) => timeouts.delete(id);
  environment.runTimeouts = (delay) => {
    for (const [id, timeout] of [...timeouts]) {
      if (delay !== undefined && timeout.delay !== delay) continue;
      timeouts.delete(id);
      timeout.callback();
    }
  };
  context.addEventListener = (type, listener) => browserEvents.addEventListener(type, listener);
  context.MathJax = { typesetClear() {}, typesetPromise: async () => {} };
  if (environment.atlasMath) context.AtlasMath = environment.atlasMath;
  vm.runInContext(controllerSource, context, { filename: "assets/galaxy-controller.js" });
}

test("controller startup, search, details, and history preserve local and hosted URL paths", async () => {
  // A deterministic controller harness, not a claim of file:// browser automation.
  for (const href of [
    "file:///C:/Example%20Library/Atlas/index.html",
    "file://research-server/shared%20library/Atlas/index.html",
    "https://example.test/Model_Atlas/"
  ]) {
    const environment = createEnvironment({
      href,
      fetchImplementation: async () => {
        if (href.startsWith("file:")) throw new TypeError("Failed to fetch");
        return { ok: true, status: 200, json: async () => payload };
      }
    });
    startController(environment);
    await flush();
    const { context, nodes } = environment;
    assert.equal(context.document.body.dataset.atlasMode, "home", href);
    assert.equal(environment.sceneRecords.length, payload.records.length);
    assert.deepEqual(environment.activePapers, payload.records.map((paper) => paper.id));
    assert.deepEqual(environment.errors, []);

    environment.sceneCallbacks.onHover(modelMapRecord, { x: 320, y: 220 });
    environment.runTimeouts(90);
    assertPaperRouteAnchors(environment, nodes.get("#tooltipTitle").innerHTML, null, [modelMapRecord.id]);
    assertPaperRouteAnchors(environment, nodes.get("#tooltipActions").innerHTML, "tooltip-read", [modelMapRecord.id]);
    assert.match(nodes.get("#tooltipActions").innerHTML, /Read model/);
    nodes.get("#tooltipClose").click();

    nodes.get("#atlasQuery").value = "platform competition";
    nodes.get("#atlasSearch").dispatch("submit");
    assert.equal(context.document.body.dataset.atlasMode, "results");
    assert.equal(context.location.searchParams.get("q"), "platform competition");
    assert.equal(context.location.pathname, new URL(href).pathname);
    assert.equal(context.location.host, new URL(href).host);
    assert.deepEqual(environment.activePapers, platformCompetitionIds);
    assert.deepEqual(environment.rankedPapers,
      platformCompetitionIds.map((id, index) => ({ id, rank: index + 1 })));
    assertPaperRouteAnchors(environment, nodes.get("#rankedMatches").innerHTML,
      "ranked-title", platformCompetitionIds.slice(0, 5));

    nodes.get("#viewToggle").click();
    assert.equal(context.location.searchParams.get("layout"), "classic");
    assert.equal(context.location.searchParams.has("view"), false);
    assertPaperRouteAnchors(environment, nodes.get("#panelResults").innerHTML,
      "result-title", platformCompetitionIds.slice(0, 60));
    assertPaperRouteAnchors(environment, nodes.get("#panelResults").innerHTML,
      "hit-button", platformCompetitionResults.slice(0, 60)
        .flatMap((result) => Array.from({ length: Math.min(2, result.hits.length) }, () => result.paper.id)));
    const paper = payload.records.find((record) => record.id === environment.activePapers[0]);
    environment.sceneCallbacks.onSelect(paper);
    assert.equal(context.document.body.dataset.atlasMode, "detail");
    assert.equal(context.location.searchParams.get("paper"), paper.id);
    assert.equal(context.location.searchParams.get("q"), "platform competition");

    nodes.get("#backToResults").click();
    assert.equal(context.document.body.dataset.atlasMode, "results");
    assert.equal(context.document.body.dataset.resultView, "classic");
    assert.equal(context.location.searchParams.has("paper"), false);
    assert.deepEqual(environment.activePapers, platformCompetitionIds);
    assert.deepEqual(environment.errors, []);
  }
});

test("controller startup fails closed when the structured model-note layer is incomplete or corrupt", async (context) => {
  const paper = payload.records[0];
  const note = modelNotes.papers.find((candidate) => candidate.id === paper.id);
  assert.ok(note, "the release contains a note for the startup fixture");
  const catalog = catalogWithRecords([paper]);
  const valid = singleNoteOverlay(note, paper, modelNotes.concepts);
  const cases = [
    ["missing overlay", undefined, /model-note layer was not loaded/i],
    ["wrong schema", { ...valid, schemaVersion: 1 }, /schemaVersion must be 2/i],
    ["duplicate paper id", { ...valid, papers: [valid.papers[0], valid.papers[0]] }, /duplicate model-note paper ids/i],
    ["missing paper id", { ...valid, papers: [] }, /catalog papers missing model notes/i],
    ["extra paper id", {
      ...valid,
      papers: [...valid.papers, { ...valid.papers[0], id: "not-in-catalog", sourceId: "not-in-catalog" }]
    }, /model notes without catalog papers/i],
    ["mismatched PDF hash", {
      ...valid,
      papers: [{ ...valid.papers[0], sha256: "0".repeat(64) }]
    }, /model-note PDF hashes do not match/i],
    ["component-free model", {
      ...valid,
      papers: [{
        ...valid.papers[0],
        models: [{ ...valid.papers[0].models[0], components: [] }]
      }]
    }, /no components/i]
  ];

  for (const [name, overlay, expected] of cases) {
    await context.test(name, async () => {
      const environment = createEnvironment({
        href: "https://example.test/Model_Atlas/",
        fetchImplementation: async () => ({ ok: true, status: 200, json: async () => catalog })
      });
      environment.modelNotes = overlay;
      startController(environment);
      await flush();
      assert.equal(environment.context.document.body.dataset.atlasMode, "error");
      assert.equal(environment.nodes.get("#atlasQuery").disabled, true);
      assert.equal(environment.sceneRecords, undefined, "invalid notes never initialize the galaxy catalog");
      assert.match(environment.errors.flat().map(String).join(" "), expected);
    });
  }
});

const topicIndex = topics.createTopicIndex(payload.records);
const platformTopic = topicIndex.find((topic) => topic.id === "platforms");
const allBrowseIds = searchIndex.search("").results.map((result) => result.paper.id);
const topicResultIds = (topic) => {
  const members = new Set(topic.ids);
  const ids = allBrowseIds.filter((id) => members.has(id));
  assert.deepEqual([...ids].sort(), [...topic.ids].sort(), `${topic.id}: rich browse index preserves exact subject coverage`);
  return ids;
};

async function openController(href, data = payload) {
  const options = {
    snapshot: data,
    fetchImplementation: async () => ({ ok: true, status: 200, json: async () => data })
  };
  if (href) options.href = href;
  const environment = createEnvironment(options);
  const ids = new Set(data.records.map((paper) => paper.id));
  environment.modelNotes = { ...modelNotes, papers: modelNotes.papers.filter((note) => ids.has(note.id)) };
  startController(environment);
  await flush();
  assert.deepEqual(environment.errors, []);
  return environment;
}

test("structured note semantics enrich galaxy records without mutating the catalog", async () => {
  const note = modelNotes.papers.find((candidate) => candidate.models.some((model) =>
    model.method && model.components.some((component) => component.concepts?.length)));
  assert.ok(note, "the release includes a structured note with method and concept metadata");
  const paper = payload.records.find((candidate) => candidate.id === note.id);
  const originalQuestion = paper.business_question;
  const environment = await openController();
  const record = environment.sceneRecords.find((candidate) => candidate.id === note.id);
  const conceptIds = new Set(note.models.flatMap((model) => model.components).flatMap((component) => component.concepts));
  const concept = modelNotes.concepts.find((candidate) => conceptIds.has(candidate.id));

  assert.equal(record.business_question, note.question);
  assert.ok(record.model_topic.includes(note.overview));
  assert.ok(record.model_topic.includes(concept.label));
  assert.ok(record.architecture_families.includes(note.models[0].name));
  assert.ok(record.method_families.includes(note.models[0].method));
  assert.equal(record.subject_id, topics.classifyPaper(paper), "note enrichment cannot move a paper out of its indexed subject");
  assert.equal(paper.business_question, originalQuestion, "galaxy enrichment does not rewrite the canonical catalog record");
});

test("Panels retain two local hits, mapped counts, and relevance wording", async () => {
  const query = "platform competition";
  const expected = searchIndex.search(query).results.slice(0, 60);
  assert.ok(expected.some((result) => result.hits.length > 1), "the fixture query has a paper with multiple retained hits");
  const environment = await openController();
  environment.nodes.get("#atlasQuery").value = query;
  environment.nodes.get("#atlasSearch").dispatch("submit");
  environment.nodes.get("#viewToggle").click();

  const markup = environment.nodes.get("#panelResults").innerHTML;
  const evidenceCount = [...markup.matchAll(/class="classic-match-evidence"/g)].length;
  assert.equal(evidenceCount, expected.reduce((count, result) => count + Math.min(2, result.hits.length), 0));
  assert.equal(environment.nodes.get("#resultSort").textContent, "Most relevant first");
  assert.equal(environment.nodes.get("#rankedBody .ranked-guide").textContent, "Most relevant first");

  const first = expected[0];
  const start = markup.indexOf(`data-paper-card="${first.paper.id}"`);
  const end = markup.indexOf("<article", start + 1);
  const card = markup.slice(start, end < 0 ? undefined : end);
  const componentCount = first.note.models.reduce((count, model) => count + model.components.length, 0);
  assert.match(card, new RegExp(`${componentCount} mapped components?`));
  if (first.note.models.length > 1) assert.match(card, new RegExp(`${first.note.models.length} models?`));
});

test("Panels source-provenance filters retain structured notes while selecting the original catalog tier", async () => {
  const environment = await openController();
  const filter = environment.nodes.get("#levelFilter");
  const paperById = new Map(payload.records.map((paper) => [paper.id, paper]));
  environment.nodes.get("#viewToggle").click();

  for (const level of ["model_map", "literature"]) {
    filter.value = level;
    filter.dispatch("change");
    const expected = allBrowseIds.filter((id) => paperById.get(id)?.detail_level === level);
    assert.ok(expected.length > 0, `${level}: the catalog contains this provenance tier`);
    assert.equal(environment.context.location.searchParams.get("level"), level);
    assert.equal(environment.nodes.get("#rankedBody .ranked-guide").textContent, "Explore the collection");
    assert.deepEqual(environment.activePapers, expected);
    assert.equal(environment.nodes.get("#panelResultCount").textContent,
      `${expected.length.toLocaleString()} ${expected.length === 1 ? "paper" : "papers"}`);
    const markup = environment.nodes.get("#panelResults").innerHTML;
    const shown = [...markup.matchAll(/data-paper-card="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(shown.length > 0);
    assert.ok(shown.every((id) => paperById.get(id)?.detail_level === level));
    assert.match(markup, /mapped components?/, "source provenance does not downgrade the structured reader");
  }

  const legacy = await openController("https://example.test/Model_Atlas/?layout=classic&level=structured");
  assert.equal(legacy.context.location.searchParams.has("level"), false,
    "the removed all-structured filter no longer creates an empty result route");
  assert.equal(legacy.activePapers.length, payload.records.length);
});

test("Panels and paper-detail transitions restore focus and the originating panel scroll", async () => {
  const environment = await openController();
  const { nodes } = environment;
  const seeInPanels = nodes.get("#seeInPanels");
  const closePanels = nodes.get("#closeClassic");
  seeInPanels.click();
  assert.equal(closePanels.focusCount, 1, "Panels entry focuses its close control");
  environment.context.history.back();
  assert.equal(seeInPanels.focusCount, 1, "browser Back from Panels restores its opener");
  seeInPanels.click();
  assert.equal(closePanels.focusCount, 2, "browser history leaves Panels ready for keyboard users");
  closePanels.click();
  assert.equal(seeInPanels.focusCount, 2, "closing Panels restores its opener");

  const galaxyPaper = environment.sceneRecords[0];
  const viewToggle = nodes.get("#viewToggle");
  const beforeGalaxyReturn = viewToggle.focusCount;
  environment.sceneCallbacks.onSelect(galaxyPaper);
  await flush();
  assert.ok(nodes.get("#detailContent").querySelector("#detailTitle").focusCount > 0,
    "opening an unscoped paper focuses the reader title");
  nodes.get("#backToResults").click();
  assert.equal(viewToggle.focusCount, beforeGalaxyReturn + 1,
    "leaving a galaxy-opened paper restores a stable galaxy control");

  const beforeBrowserReturn = viewToggle.focusCount;
  environment.sceneCallbacks.onSelect(galaxyPaper);
  await flush();
  environment.context.history.back();
  assert.equal(viewToggle.focusCount, beforeBrowserReturn + 1,
    "browser Back from a paper restores the same stable galaxy control");

  viewToggle.click();
  nodes.get("#panelResults").scrollTop = 173;
  const returnSelector = `[data-paper-card="${galaxyPaper.id}"] .result-title`;
  const returnLink = nodes.get("#panelResults").querySelector(returnSelector);
  const openLink = {
    dataset: { openPaper: galaxyPaper.id },
    matches: (selector) => selector === "a"
  };
  nodes.get("#panelResults").dispatch("click", {
    button: 0,
    target: { closest: () => openLink }
  });
  await flush();
  nodes.get("#backToResults").click();
  assert.equal(nodes.get("#panelResults").scrollTop, 173);
  assert.equal(returnLink.focusCount, 1, "Back restores the exact originating paper card");
});

test("pinned previews resist neighboring hover, restore focus, and clear on external interaction", async () => {
  const environment = await openController();
  const { nodes } = environment;
  nodes.get("#atlasQuery").value = "platform competition";
  nodes.get("#atlasSearch").dispatch("submit");
  assert.match(nodes.get("#rankedMatches").innerHTML, /aria-controls="nodeTooltip" aria-expanded="false"/);
  const [firstId, secondId] = platformCompetitionIds;
  assert.ok(firstId && secondId, "the fixture query has neighboring preview candidates");
  const previewTrigger = element();
  previewTrigger.dataset.previewPaper = firstId;
  previewTrigger.matches = () => false;
  nodes.get("#rankedMatches").dispatch("click", { target: { closest: () => previewTrigger } });
  assert.equal(nodes.get("#nodeTooltip").hidden, false);
  assert.match(nodes.get("#tooltipTitle").innerHTML, new RegExp(`data-open-paper="${firstId}"`));

  const secondPaper = environment.sceneRecords.find((paper) => paper.id === secondId);
  environment.sceneCallbacks.onHover(secondPaper, { x: 40, y: 700 });
  environment.runTimeouts(180);
  assert.match(nodes.get("#tooltipTitle").innerHTML, new RegExp(`data-open-paper="${firstId}"`),
    "hover cannot replace a pinned preview");

  nodes.get("#tooltipClose").click();
  assert.equal(nodes.get("#nodeTooltip").hidden, true);
  assert.equal(previewTrigger.focusCount, 1, "closing a keyboard/touch preview restores its trigger");

  nodes.get("#rankedMatches").dispatch("click", { target: { closest: () => previewTrigger } });
  environment.documentEvents.dispatch("pointerdown", { target: { closest: () => null } });
  assert.equal(nodes.get("#nodeTooltip").hidden, true, "an outside pointer action dismisses a pinned preview");

  nodes.get("#rankedMatches").dispatch("click", { target: { closest: () => previewTrigger } });
  environment.browserEvents.dispatch("blur");
  assert.equal(nodes.get("#nodeTooltip").hidden, true, "window blur clears stale preview intent");
});

test("hover preview travel stays stable, deliberate switching works, and map manipulation clears it", async () => {
  const environment = await openController();
  const { nodes } = environment;
  nodes.get("#atlasQuery").value = "platform competition";
  nodes.get("#atlasSearch").dispatch("submit");
  const [firstId, secondId] = platformCompetitionIds;
  const first = environment.sceneRecords.find((paper) => paper.id === firstId);
  const second = environment.sceneRecords.find((paper) => paper.id === secondId);

  environment.sceneCallbacks.onHover(first, { x: 320, y: 220 });
  environment.runTimeouts(90);
  assert.match(nodes.get("#tooltipTitle").innerHTML, new RegExp(`data-open-paper="${firstId}"`));

  environment.sceneCallbacks.onHover(second, { x: 280, y: 130 });
  environment.runTimeouts(180);
  assert.match(nodes.get("#tooltipTitle").innerHTML, new RegExp(`data-open-paper="${firstId}"`),
    "crossing the card corridor does not immediately replace the preview");
  nodes.get("#nodeTooltip").dispatch("pointerenter");

  environment.sceneCallbacks.onHover(second, { x: 40, y: 700 });
  environment.runTimeouts(180);
  assert.match(nodes.get("#tooltipTitle").innerHTML, new RegExp(`data-open-paper="${secondId}"`),
    "a deliberate hover away from the corridor switches previews");
  nodes.get("#galaxyCanvas").dispatch("wheel");
  assert.equal(nodes.get("#nodeTooltip").hidden, true, "map manipulation clears an unpinned preview");
});

test("coarse-pointer search selection pins a preview while mouse selection opens the paper", async () => {
  const environment = createEnvironment({ href: "https://example.test/Model_Atlas/" });
  environment.coarsePointer = true;
  startController(environment);
  await flush();
  environment.nodes.get("#atlasQuery").value = "platform competition";
  environment.nodes.get("#atlasSearch").dispatch("submit");
  const paper = environment.sceneRecords.find((candidate) => candidate.id === platformCompetitionIds[0]);
  environment.sceneCallbacks.onSelect(paper);
  assert.equal(environment.context.document.body.dataset.atlasMode, "results");
  assert.equal(environment.nodes.get("#nodeTooltip").hidden, false);

  environment.coarsePointer = false;
  environment.sceneCallbacks.onSelect(paper);
  assert.equal(environment.context.document.body.dataset.atlasMode, "detail");
});

test("previews expose Mini-style context and formal hits keep the MathJax presentation", async () => {
  const paper = payload.records[0];
  const source = { page: 1, section: "Model definition", quote: "The model uses a local source anchor." };
  const note = {
    id: paper.id,
    question: "How should the parity mechanism be modeled?",
    overview: "A compact fixture for reader parity.",
    modelTypes: ["Optimization"],
    models: [{
      id: "parity-model", name: "Parity benchmark", kind: "baseline", relation: "", relationships: [],
      summary: "The benchmark connects a decision to a capacity limit.",
      objects: ["A decision maker"], inputs: ["A capacity limit"], decisions: ["Choose an allocation"],
      assumptions: ["Capacity is fixed."], method: "Solve the constrained optimization problem.", sources: [source],
      components: [{
        id: "parity-component", label: "Capacity rule", role: "constraint", concepts: [],
        explanation: "The component limits the feasible allocation chosen by the decision maker.",
        searchPhrases: ["quasar flux mechanism"], formal: "aurora balance = lunar capacity",
        formalKind: "Source-extracted equation (not visually verified)", symbols: [], conditions: ["Capacity is fixed."],
        sources: [source], conceptBindings: []
      }]
    }]
  };
  const formulaCalls = [];
  const fixturePayload = catalogWithRecords([paper]);
  const environment = createEnvironment({
    href: "https://example.test/Model_Atlas/",
    fetchImplementation: async () => ({ ok: true, status: 200, json: async () => fixturePayload })
  });
  environment.modelNotes = singleNoteOverlay(note, paper);
  environment.atlasMath = {
    formula(modelNote, component) {
      formulaCalls.push([modelNote.id, component.id]);
      return `<div class="formal" data-formula-probe="${component.id}"><span>${component.formalKind}</span><div class="math-display" data-tex="aurora">${component.formal}</div></div>`;
    },
    symbol(value) { return String(value); },
    annotate() {},
    render() { return Promise.resolve(); }
  };
  startController(environment);
  await flush();

  environment.nodes.get("#atlasQuery").value = "quasar flux mechanism";
  environment.nodes.get("#atlasSearch").dispatch("submit");
  const galaxyPaper = environment.sceneRecords.find((candidate) => candidate.id === paper.id);
  environment.sceneCallbacks.onHover(galaxyPaper, { x: 320, y: 220 });
  environment.runTimeouts(90);
  assert.equal(environment.nodes.get("#tooltipHeading").textContent, "Why it matches");
  assert.equal(environment.nodes.get("#tooltipContextBlock").hidden, false);
  assert.equal(environment.nodes.get("#tooltipContextLabel").textContent, "Matching description");
  assert.match(environment.nodes.get("#tooltipContextText").innerHTML, /quasar flux mechanism/);
  assert.match(environment.nodes.get("#tooltipReason").innerHTML, /limits the feasible allocation/);

  environment.nodes.get("#atlasQuery").value = "aurora balance lunar capacity";
  environment.nodes.get("#atlasSearch").dispatch("submit");
  environment.sceneCallbacks.onSelect(galaxyPaper);
  const markup = environment.nodes.get("#detailContent").innerHTML;
  assert.deepEqual(formulaCalls.at(-1), [paper.id, "parity-component"]);
  assert.match(markup, /class="formal query-formulation"[^>]*data-reader-hit=/);
  assert.match(markup, /data-formula-probe="parity-component"/);
  assert.match(markup, /class="math-display"/);
});

test("query details preserve Greek-token highlights while annotating before MathJax", async () => {
  const paper = payload.records[0];
  const identifier = "theta_1i";
  const source = { page: 1, section: "Model", quote: "Demand depends on the buyer type." };
  const note = {
    id: paper.id,
    question: "How does buyer type affect demand?",
    overview: "A fixture for highlighted notation.",
    modelTypes: ["Demand model"],
    models: [{
      id: "greek-model", name: "Greek model", kind: "baseline", relation: "", relationships: [],
      summary: "The model relates buyer type to demand.", objects: ["Buyer"], inputs: ["Type"],
      decisions: ["Choose demand"], assumptions: ["Type is observed."], method: "Solve the demand relation.", sources: [source],
      components: [{
        id: "greek-component", label: "Demand response", role: "decision", concepts: [],
        explanation: `Demand responds to ${identifier} before the decision.`, searchPhrases: [identifier],
        formal: "Decision rule: demand responds to buyer type.", formalKind: "Atlas restatement of source rule",
        symbols: [{ symbol: "\\theta_{ki}", meaning: "buyer type" }], conditions: ["Type is observed."],
        sources: [source], conceptBindings: []
      }]
    }]
  };
  const mathCalls = [];
  const fixturePayload = catalogWithRecords([paper]);
  const environment = createEnvironment({
    href: "https://example.test/Model_Atlas/",
    fetchImplementation: async () => ({ ok: true, status: 200, json: async () => fixturePayload })
  });
  environment.modelNotes = singleNoteOverlay(note, paper);
  environment.atlasMath = {
    expandGreekRanges(text, ranges) {
      const tokenStart = text.indexOf(identifier);
      if (tokenStart < 0) return ranges;
      const tokenEnd = tokenStart + identifier.length;
      return ranges.map((range) => range.start < tokenEnd && range.end > tokenStart
        ? { ...range, start: tokenStart, end: tokenEnd }
        : range);
    },
    formula(_modelNote, component) { return `<div class="formal"><pre>${component.formal}</pre></div>`; },
    symbol(value) { return String(value); },
    annotate(root) { mathCalls.push({ kind: "annotate", markup: root.innerHTML }); },
    render(root) { mathCalls.push({ kind: "render", markup: root.innerHTML }); return Promise.resolve(); }
  };
  startController(environment);
  await flush();

  environment.nodes.get("#atlasQuery").value = "theta";
  environment.nodes.get("#atlasSearch").dispatch("submit");
  const galaxyPaper = environment.sceneRecords.find((candidate) => candidate.id === paper.id);
  environment.sceneCallbacks.onSelect(galaxyPaper);
  await flush();

  const markup = environment.nodes.get("#detailContent").innerHTML;
  assert.match(markup, /class="component-match-term"[^>]*data-reader-hit=/,
    "the reader-jump target remains on the highlighted passage ancestor");
  assert.match(markup, /<mark class="match-term">theta₁ᵢ<\/mark>/,
    "a partial query expands to the complete readable notation token before annotation");
  assert.deepEqual(mathCalls.slice(-2).map((call) => call.kind), ["annotate", "render"]);
  assert.match(mathCalls.at(-2).markup, /<mark class="match-term">theta₁ᵢ<\/mark>/,
    "annotation receives the highlighted detail DOM without removing the reader hit");
});

test("concept-binding symbols use the same AtlasMath normalizer as the primary symbol table", async () => {
  const paper = payload.records[0];
  const source = { page: 2, section: "Model", equation: "", quote: "The model chooses an allocation under uncertain demand." };
  const symbols = [
    { symbol: "\\theta_{ki}", meaning: "type parameter" },
    { symbol: "Gamma=(pi,M)", meaning: "game description" },
    { symbol: "nu_t", meaning: "period-specific rate" }
  ];
  const note = {
    id: paper.id,
    question: "How should the model choose an allocation?",
    overview: "A fixture that exercises both symbol-table call sites.",
    modelTypes: ["Optimization"],
    models: [{
      id: "binding-model", name: "Binding model", kind: "baseline", relation: "", relationships: [],
      summary: "The model chooses an allocation under uncertain demand.", objects: ["Planner"], inputs: ["Demand"],
      decisions: ["Choose an allocation"], assumptions: ["Demand is uncertain."], method: "Solve the allocation problem.", sources: [source],
      components: [{
        id: "binding-component", label: "Allocation", role: "decision", concepts: ["allocation"],
        explanation: "The model chooses an allocation under uncertain demand.", searchPhrases: ["allocation"],
        formal: "Decision rule: choose a feasible allocation.", formalKind: "Atlas restatement of source rule",
        symbols, conditions: ["Demand is uncertain."], sources: [source],
        conceptBindings: [{
          conceptId: "allocation", status: "modeled", representation: "Allocation is the component decision.",
          conditionRefs: [0], sourceRefs: [{ scope: "component", index: 0 }], symbolRefs: [0, 1, 2],
          reviewStatus: "automated", formalRef: "formal"
        }]
      }]
    }]
  };
  const symbolCalls = [];
  const fixturePayload = catalogWithRecords([paper]);
  const environment = createEnvironment({
    href: `https://example.test/Model_Atlas/?paper=${encodeURIComponent(paper.id)}&model=binding-model`,
    fetchImplementation: async () => ({ ok: true, status: 200, json: async () => fixturePayload })
  });
  environment.modelNotes = singleNoteOverlay(note, paper,
    [{ id: "allocation", label: "Allocation", aliases: ["resource allocation"], related: [] }]);
  environment.atlasMath = {
    formula(_paper, component) { return `<div class="formal"><pre>${component.formal}</pre></div>`; },
    symbol(value) {
      symbolCalls.push(value);
      return `<span class="math-inline" data-normalized-symbol="${value.replaceAll("\\", "command-")}">normalized</span>`;
    },
    annotate() {},
    render() { return Promise.resolve(); }
  };
  startController(environment);
  await flush();

  const markup = environment.nodes.get("#detailContent").innerHTML;
  const bindingMarkup = markup.match(/<dl class="binding-symbols">([\s\S]*?)<\/dl>/)?.[1] || "";
  assert.ok(bindingMarkup, "the concept binding renders its referenced symbols");
  assert.equal((bindingMarkup.match(/data-normalized-symbol=/g) || []).length, symbols.length);
  assert.deepEqual(symbolCalls, [...symbols.map((item) => item.symbol), ...symbols.map((item) => item.symbol)],
    "each symbol is normalized in both the primary and concept-binding tables");
  assert.doesNotMatch(bindingMarkup, /data-tex="\\\\theta/, "valid TeX is not double-escaped by a fallback path");
});

test("primary and concept-binding symbol meanings share highlighted math-prose rendering", async () => {
  const paper = payload.records[0];
  const source = { page: 2, section: "Model", equation: "", quote: "The contract constrains prices and customer types." };
  const symbols = [
    { symbol: "w", meaning: "wholesale price committed by the firm · w \\ge r" },
    { symbol: "P", meaning: "candidate demand distribution · P \\in \\mathcal D" },
    { symbol: "\\theta", meaning: "customer type · [\\underline\\theta,\\overline\\theta]" }
  ];
  const note = {
    id: paper.id,
    question: "How should the contract constrain prices?",
    overview: "A fixture for mathematical symbol meanings.",
    modelTypes: ["Contract model"],
    models: [{
      id: "meaning-model", name: "Meaning model", kind: "baseline", relation: "", relationships: [],
      summary: "The contract constrains prices and customer types.", objects: ["Firm"], inputs: ["Types"],
      decisions: ["Choose a wholesale price"], assumptions: ["Prices are feasible."], method: "Solve the contract.", sources: [source],
      components: [{
        id: "meaning-component", label: "Contract domain", role: "decision", concepts: ["contract"],
        explanation: "The firm commits to a wholesale price.", searchPhrases: ["wholesale price"],
        formal: "Decision rule: choose a feasible contract.", formalKind: "Atlas restatement of source rule",
        symbols, conditions: ["Prices are feasible."], sources: [source],
        conceptBindings: [{
          conceptId: "contract", status: "modeled", representation: "The component specifies the contract domain.",
          conditionRefs: [0], sourceRefs: [{ scope: "component", index: 0 }], symbolRefs: [0, 1, 2],
          reviewStatus: "automated", formalRef: "formal"
        }]
      }]
    }]
  };
  const calls = [];
  const environment = createEnvironment({
    href: `https://example.test/Model_Atlas/?q=committed&paper=${encodeURIComponent(paper.id)}&model=meaning-model`,
    fetchImplementation: async () => ({ ok: true, status: 200, json: async () => catalogWithRecords([paper]) })
  });
  environment.modelNotes = singleNoteOverlay(note, paper,
    [{ id: "contract", label: "Contract", aliases: [], related: [] }]);
  environment.atlasMath = {
    formula(_paper, component) { return `<div class="formal"><pre>${component.formal}</pre></div>`; },
    symbol(value) { return `<span class="math-inline">${value}</span>`; },
    prose(value, ranges) {
      calls.push({ value, ranges: plain(ranges) });
      const marked = ranges?.length ? `<mark class="match-term">${value.slice(ranges[0].start, ranges[0].end)}</mark>` : "";
      return `<span data-math-prose="true">${marked || value}</span>`;
    },
    annotate() {}, render() { return Promise.resolve(); }
  };
  startController(environment);
  await flush();

  const markup = environment.nodes.get("#detailContent").innerHTML;
  const meaningCalls = calls.filter((call) => symbols.some((symbol) => symbol.meaning === call.value));
  assert.equal(meaningCalls.length, symbols.length * 2,
    "primary and binding tables render every meaning through the same contract");
  const wholesaleCalls = calls.filter((call) => call.value === symbols[0].meaning);
  assert.equal(wholesaleCalls.length, 2);
  assert.ok(wholesaleCalls.every((call) => call.ranges.length > 0), "the search hit reaches both symbol-meaning presentations");
  assert.ok((markup.match(/<mark class="match-term">committed<\/mark>/g) || []).length >= 2);
  assert.match(markup, /<dl class="binding-symbols">[\s\S]*data-math-prose="true"/);
});

test("controller fallback keeps TeX-bearing symbol meanings readable without raw commands", async () => {
  const paper = payload.records[0];
  const source = { page: 2, section: "Model", equation: "", quote: "The contract constrains prices and customer types." };
  const symbols = [
    { symbol: "w", meaning: "wholesale price committed by the firm · w \\ge r" },
    { symbol: "P", meaning: "candidate demand distribution · P \\in \\mathcal D" },
    { symbol: "\\theta", meaning: "customer type · [\\underline\\theta,\\overline\\theta]" },
    { symbol: "z_t", meaning: "binary indicator · \\{0,1\\}" }
  ];
  const note = {
    id: paper.id, question: "How should the contract constrain prices?", overview: "Fallback fixture.", modelTypes: ["Contract model"],
    models: [{
      id: "fallback-meaning-model", name: "Fallback meaning model", kind: "baseline", relation: "", relationships: [],
      summary: "The contract constrains prices.", objects: ["Firm"], inputs: ["Types"], decisions: ["Choose price"],
      assumptions: ["Prices are feasible."], method: "Solve the contract.", sources: [source],
      components: [{
        id: "fallback-meaning-component", label: "Contract domain", role: "decision", concepts: [], explanation: "The firm chooses price.",
        searchPhrases: ["wholesale price"], formal: "Decision rule: choose price.", formalKind: "Atlas restatement of source rule",
        symbols, conditions: ["Prices are feasible."], sources: [source], conceptBindings: []
      }]
    }]
  };
  const environment = createEnvironment({
    href: `https://example.test/Model_Atlas/?q=wholesale&paper=${encodeURIComponent(paper.id)}&model=fallback-meaning-model`,
    fetchImplementation: async () => ({ ok: true, status: 200, json: async () => catalogWithRecords([paper]) })
  });
  environment.modelNotes = singleNoteOverlay(note, paper);
  startController(environment);
  await flush();

  const markup = environment.nodes.get("#detailContent").innerHTML;
  const visible = markup.replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'");
  assert.doesNotMatch(visible, /\\/, "no-MathJax fallback never exposes TeX control syntax");
  assert.match(visible, /w ≥ r/);
  assert.match(visible, /P ∈ D/);
  assert.match(visible, /\[θ,θ\]/);
  assert.match(visible, /\{0,1\}/);
  assert.match(markup, /<mark class="match-term">wholesale<\/mark>/, "fallback preserves search highlighting");
});

test("controller fallback canonicalizes wrapped Greek names and PDF epsilon/mu lookalikes", async () => {
  const paper = payload.records[0];
  const source = { page: 2, section: "Model", equation: "", quote: "The model defines vaccine efficacy and an arrival rate." };
  const symbols = [
    { symbol: "$lambda$", meaning: "arrival rate" },
    { symbol: "ɛ_i", meaning: "PDF-extracted vaccine efficacy" },
    { symbol: "ε_i", meaning: "Greek epsilon vaccine efficacy" },
    { symbol: "ϵ_i", meaning: "Greek lunate epsilon vaccine efficacy" },
    { symbol: "µ_i", meaning: "PDF-extracted service rate" },
    { symbol: "Ɛ[X]", meaning: "PDF-extracted expectation operator" }
  ];
  const note = {
    id: paper.id,
    question: "How does the model represent rates and efficacy?",
    overview: "A fixture for the controller's pre-MathJax fallback.",
    modelTypes: ["Optimization"],
    models: [{
      id: "fallback-model", name: "Fallback model", kind: "baseline", relation: "", relationships: [],
      summary: "The model represents rates and efficacy.", objects: ["Planner"], inputs: ["Rates and efficacy"],
      decisions: ["Choose an allocation"], assumptions: ["Parameters are fixed."], method: "Solve the allocation problem.", sources: [source],
      components: [{
        id: "fallback-component", label: "Rates and efficacy", role: "input", concepts: [],
        explanation: "The model defines vaccine efficacy and an arrival rate.", searchPhrases: ["vaccine efficacy"],
        formal: "Input relation: vaccine efficacy and arrival rate.", formalKind: "Atlas restatement of source rule",
        symbols, conditions: ["Parameters are fixed."], sources: [source], conceptBindings: []
      }]
    }]
  };
  const fixturePayload = catalogWithRecords([paper]);
  const environment = createEnvironment({
    href: `https://example.test/Model_Atlas/?paper=${encodeURIComponent(paper.id)}&model=fallback-model`,
    fetchImplementation: async () => ({ ok: true, status: 200, json: async () => fixturePayload })
  });
  environment.modelNotes = singleNoteOverlay(note, paper);
  startController(environment);
  await flush();

  const markup = environment.nodes.get("#detailContent").innerHTML;
  assert.match(markup, /data-tex="\\lambda"/, "raw $lambda$ is unwrapped and canonicalized");
  assert.equal((markup.match(/data-tex="\\varepsilon_i"/g) || []).length, 2,
    "Latin open e and Greek epsilon share the intended varepsilon rendering");
  assert.match(markup, /data-tex="\\epsilon_i"/, "lunate epsilon retains the epsilon variant");
  assert.match(markup, /data-tex="\\mu_i"/, "compatibility mu becomes the TeX mu command");
  assert.match(markup, /data-tex="\\mathbb\{E\}\[X\]"/, "the PDF expectation lookalike becomes an explicit TeX operator");
  assert.doesNotMatch(markup, /data-tex="[^"]*[$ɛƐεϵµ]/u, "no raw wrapper or PDF epsilon/mu/expectation glyph reaches TeX");
});

function attributeValue(tag, name) {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
}

function assertPaperRouteAnchors(environment, markup, className, expectedIds) {
  const anchors = [...markup.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
  const matching = className
    ? anchors.filter((tag) => attributeValue(tag, "class").split(/\s+/).includes(className))
    : anchors;
  assert.deepEqual(matching.map((tag) => attributeValue(tag, "data-open-paper")), expectedIds,
    `${className || "paper title"} controls are anchors for the expected papers`);
  for (const [index, tag] of matching.entries()) {
    const href = attributeValue(tag, "href").replaceAll("&amp;", "&");
    assert.ok(href, `${className || "paper title"}: anchor has a usable href`);
    const target = new URL(href, environment.context.location.href);
    assert.equal(target.protocol, environment.context.location.protocol);
    assert.equal(target.host, environment.context.location.host);
    assert.equal(target.pathname, environment.context.location.pathname);
    assert.equal(target.searchParams.get("paper"), expectedIds[index]);
  }
}

function paperAnchorTarget(paperId, details = {}) {
  return {
    dataset: { openPaper: paperId, ...details },
    matches: (selector) => selector === "a"
  };
}

function assertExternalArticleLinks(environment, paper) {
  const markup = environment.nodes.get("#detailContent").innerHTML;
  const anchors = [...markup.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
  const byClass = (name) => anchors.find((tag) => attributeValue(tag, "class").split(/\s+/).includes(name));
  const doi = byClass("paper-doi");
  const scholar = byClass("paper-scholar");
  assert.ok(doi, `${paper.id}: detail includes its DOI action`);
  assert.ok(scholar, `${paper.id}: detail includes its Google Scholar action`);
  assert.equal(attributeValue(doi, "href"), new URL(paper.doi_url || `https://doi.org/${paper.doi}`).href);
  assert.equal(attributeValue(scholar, "href"), `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`);
  for (const anchor of [doi, scholar]) {
    assert.equal(attributeValue(anchor, "target"), "_blank");
    assert.match(attributeValue(anchor, "rel"), /\bnoopener\b/);
    assert.match(attributeValue(anchor, "rel"), /\bnoreferrer\b/);
  }
  assert.doesNotMatch(markup, /\blocal-pdf-button\b/);
  assert.doesNotMatch(markup, /href=["']paper\//i);
}

function assertStructuredNoteDetail(environment, paper) {
  assert.equal(environment.context.document.body.dataset.atlasMode, "detail");
  assert.equal(environment.context.location.searchParams.get("paper"), paper.id);
  const markup = environment.nodes.get("#detailContent").innerHTML;
  const readableMarkup = markup.replace(/<[^>]+>/g, "");
  const note = modelNotes.papers.find((candidate) => candidate.id === paper.id);
  assert.ok(note, `${paper.id}: every catalog paper has a structured note`);
  assert.match(markup, /MODEL NOTE/);
  assert.ok(readableMarkup.includes(paper.title), `${paper.id}: detail includes its title`);
  assert.ok(readableMarkup.includes(note.overview), `${paper.id}: detail includes its structured overview`);
  assert.doesNotMatch(markup, /class="note-provenance"/,
    `${paper.id}: internal provenance is not repeated as a reader disclaimer`);
  assert.doesNotMatch(readableMarkup, /Automated reconstruction does not imply independent expert review/);
  assert.match(markup, /Model setup/);
  assert.match(markup, /Inside the model/);
  if (paper.review_note) assert.ok(!markup.includes(paper.review_note), `${paper.id}: internal review notes stay out of the reader`);
  const firstRawQuote = note.models.flatMap((model) => model.components).flatMap((component) => component.sources)[0]?.quote;
  if (firstRawQuote) assert.ok(!markup.includes(firstRawQuote), `${paper.id}: raw source excerpts stay out of the public reader`);
  assertExternalArticleLinks(environment, paper);
}

test("Inside the model navigation deep-links to and expands the selected component", async () => {
  const note = modelNotes.papers.find((candidate) => candidate.models.some((model) => model.components.length > 1));
  assert.ok(note, "the structured-note release includes a multi-component model");
  const model = note.models.find((candidate) => candidate.components.length > 1);
  const component = model.components.at(-1);
  const environment = await openController(`https://example.test/Model_Atlas/?paper=${encodeURIComponent(note.id)}&model=${encodeURIComponent(model.id)}`);
  const control = {
    dataset: { jumpComponent: component.id },
    closest: () => control
  };

  environment.nodes.get("#detailContent").dispatch("click", { target: control });

  assert.equal(environment.context.location.searchParams.get("paper"), note.id);
  assert.equal(environment.context.location.searchParams.get("model"), model.id);
  assert.equal(environment.context.location.searchParams.get("component"), component.id,
    "component navigation persists a shareable reader target");
  const markup = environment.nodes.get("#detailContent").innerHTML;
  const start = markup.indexOf(`id="component-${component.id}"`);
  assert.ok(start >= 0, "the selected component remains in the rendered model");
  assert.match(markup.slice(start), /<details class="component-details" open>/,
    "the selected component disclosure opens like the Mini reader");
});

test("schema 3.1 literature opens its structured note from title search, Panels, and fresh deep links", async () => {
  assert.ok(modelMapRecord, "the fixture needs one legacy model map");
  const mixed = schema31Payload(modelMapRecord);
  for (const baseURL of [
    "file:///C:/Example%20Library/Atlas/index.html",
    "https://example.test/Model_Atlas/"
  ]) {
    const search = await openController(baseURL, mixed);
    search.nodes.get("#atlasQuery").value = literatureRecord.title;
    search.nodes.get("#atlasSearch").dispatch("submit");
    assert.equal(search.context.document.body.dataset.atlasMode, "results");
    assert.ok(search.activePapers.includes(literatureRecord.id));
    search.nodes.get("#seeInPanels").click();
    assert.equal(search.context.location.searchParams.get("layout"), "classic");
    assert.match(search.nodes.get("#panelResults").innerHTML,
      new RegExp(`data-paper-card="${literatureRecord.id}"`));
    assertPaperRouteAnchors(search, search.nodes.get("#panelResults").innerHTML,
      "result-title", [literatureRecord.id]);
    assertPaperRouteAnchors(search, search.nodes.get("#panelResults").innerHTML,
      "hit-button", [literatureRecord.id]);
    const paper = search.sceneRecords.find((record) => record.id === literatureRecord.id);
    const open = paperAnchorTarget(paper.id);
    const modifiedClick = search.nodes.get("#panelResults").dispatch("click", {
      button: 0,
      ctrlKey: true,
      target: { closest: () => open }
    });
    assert.equal(modifiedClick.defaultPrevented, false, "modified paper-link clicks remain native browser navigation");
    assert.equal(search.context.document.body.dataset.atlasMode, "results");
    const normalClick = search.nodes.get("#panelResults").dispatch("click", {
      button: 0,
      target: { closest: () => open }
    });
    assert.equal(normalClick.defaultPrevented, true, "normal paper-link clicks use SPA navigation");
    assertStructuredNoteDetail(search, paper);
    assert.doesNotMatch(search.nodes.get("#readerSearchGuide").innerHTML, /No passage in this variant/,
      "a title or bibliographic hit remains a navigable reader passage");

    const deepURL = new URL(baseURL);
    deepURL.searchParams.set("paper", literatureRecord.id);
    const deepLink = await openController(deepURL.href, mixed);
    assertStructuredNoteDetail(deepLink, literatureRecord);
  }
});

test("curated-note provenance remains internal rather than becoming a repeated reader banner", async () => {
  const note = modelNotes.papers.find((candidate) => candidate.provenance?.sourceTier === "full-source-curated-note");
  assert.ok(note, "the release includes a full-source curated note fixture");
  const environment = await openController(`https://example.test/Model_Atlas/?paper=${encodeURIComponent(note.id)}`);
  const markup = environment.nodes.get("#detailContent").innerHTML;
  assert.doesNotMatch(markup, /note-provenance|Curated full-source note|Automated reconstruction/);
});

test("checked-in literature records preserve deep links without exposing local PDF URLs", async () => {
  const paper = payload.records.find((record) => record.detail_level === "literature");
  if (!paper) {
    assert.equal(payload.schema_version, "3.0", "the pre-migration dataset has no literature records yet");
    return;
  }
  for (const baseURL of [
    "file:///C:/Example%20Library/Atlas/index.html",
    "https://example.test/Model_Atlas/"
  ]) {
    const deepURL = new URL(baseURL);
    deepURL.searchParams.set("paper", paper.id);
    const environment = await openController(deepURL.href);
    assert.equal(environment.context.document.body.dataset.atlasMode, "detail");
    assert.equal(environment.context.location.searchParams.get("paper"), paper.id);
    assertExternalArticleLinks(environment, paper);
  }
});

function clickTopic(environment, topicId) {
  const list = environment.nodes.get("#topicList");
  const button = list.querySelectorAll("[data-topic]").find((candidate) => candidate.dataset.topic === topicId);
  assert.ok(button, `the subject index contains ${topicId}`);
  list.dispatch("click", { target: { closest: () => button } });
}

function escape(environment) {
  environment.browserEvents.dispatch("keydown", { key: "Escape", target: { tagName: "INPUT" } });
}

function assertTopicSelection(environment, topic, view = "galaxy") {
  const { context, nodes } = environment;
  const expectedIds = topicResultIds(topic);
  assert.equal(context.document.body.dataset.atlasMode, "browse");
  assert.equal(context.document.body.dataset.resultView, view);
  assert.equal(context.location.searchParams.get("topic"), topic.id);
  assert.equal(context.location.searchParams.has("q"), false);
  assert.equal(context.location.searchParams.has("paper"), false);
  assert.equal(nodes.get("#atlasQuery").value, "");
  assert.equal(nodes.get("#resultsHud").hidden, true);
  assert.equal(nodes.get("#resetTopic").hidden, false);
  assert.equal(nodes.get("#homeView").inert, view === "classic");
  assert.equal(nodes.get("#homeView").hidden, view === "classic");
  assert.equal(nodes.get("#classicPanel").inert, view !== "classic");
  assert.equal(nodes.get("#classicPanel").hidden, view !== "classic");
  assert.equal(environment.sceneMode, "browse");
  assert.deepEqual(environment.activePapers, expectedIds);
  if (view === "classic") {
    const cardIds = [...nodes.get("#panelResults").innerHTML.matchAll(/data-paper-card="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(cardIds, expectedIds.slice(0, 60), "the first Panels page follows rich-index subject order");
    assertPaperRouteAnchors(environment, nodes.get("#panelResults").innerHTML,
      "result-title", expectedIds.slice(0, 60));
    assert.equal(nodes.get("#loadMorePanels").hidden, expectedIds.length <= 60);
  }
  for (const button of nodes.get("#topicList").querySelectorAll("[data-topic]")) {
    assert.equal(button.getAttribute("aria-pressed"), String(button.dataset.topic === topic.id));
  }
}

function assertHome(environment, expectedSearch = "") {
  assert.equal(environment.context.document.body.dataset.atlasMode, "home");
  assert.equal(environment.context.location.search, expectedSearch);
  assert.equal(environment.nodes.get("#resetTopic").hidden, true);
  assert.deepEqual(environment.activePapers, payload.records.map((paper) => paper.id), "every real paper star is selectable at home");
}

test("each homepage subject browses its exact indexed IDs without issuing a search", async () => {
  const environment = await openController();
  assert.equal(environment.nodes.get("#topicList").querySelectorAll("[data-topic]").length, topicIndex.length);
  assert.equal(environment.nodes.get("#topicList").getAttribute("aria-busy"), "false");
  for (const topic of topicIndex) {
    clickTopic(environment, topic.id);
    assertTopicSelection(environment, topic);
  }
  clickTopic(environment, topicIndex.at(-1).id);
  assertHome(environment);
  assert.deepEqual(environment.errors, []);
});

test("subject Panels cards and details retain their subject through Back, Escape, and reset", async () => {
  const environment = await openController();
  const { nodes, context } = environment;
  clickTopic(environment, platformTopic.id);
  nodes.get("#viewToggle").click();
  assertTopicSelection(environment, platformTopic, "classic");
  assert.equal(context.location.searchParams.get("layout"), "classic");
  assert.equal(context.location.searchParams.has("view"), false);

  const card = paperAnchorTarget(topicResultIds(platformTopic)[0]);
  const cardClick = nodes.get("#panelResults").dispatch("click", {
    button: 0,
    target: { closest: () => card }
  });
  assert.equal(cardClick.defaultPrevented, true);
  assert.equal(context.document.body.dataset.atlasMode, "detail");
  assert.equal(context.location.searchParams.get("paper"), card.dataset.openPaper);
  assert.equal(context.location.searchParams.get("topic"), platformTopic.id);
  assert.equal(context.location.searchParams.has("q"), false);
  assert.equal(nodes.get("#classicPanel").inert, true);
  assert.deepEqual(environment.activePapers, [card.dataset.openPaper]);
  nodes.get("#backToResults").click();
  assertTopicSelection(environment, platformTopic, "classic");

  escape(environment);
  assertTopicSelection(environment, platformTopic);
  escape(environment);
  assertHome(environment);
  clickTopic(environment, platformTopic.id);
  nodes.get("#resetTopic").click();
  assertHome(environment);
});

test("search focus and unsubmitted text leave the subject, layout, URL, and camera target unchanged", async () => {
  for (const view of ["galaxy", "classic"]) {
    const environment = await openController();
    const { nodes, context } = environment;
    clickTopic(environment, platformTopic.id);
    if (view === "classic") nodes.get("#viewToggle").click();
    const previousURL = context.location.href;
    const previousRetargetCount = environment.retargetCount;
    const previousSelection = [...environment.activePapers];
    nodes.get("#atlasQuery").dispatch("focus");
    nodes.get("#atlasQuery").value = "unfinished query";
    assert.equal(context.document.body.dataset.atlasMode, "browse");
    assert.equal(context.document.body.dataset.resultView, view);
    assert.equal(environment.sceneMode, "browse");
    assert.equal(context.location.href, previousURL);
    assert.deepEqual(environment.activePapers, previousSelection);
    assert.equal(environment.retargetCount, previousRetargetCount,
      "focusing and typing do not rerun or retarget search before submit");
  }
});

test("submitting search clears its previous subject, and browser Back restores that subject", async () => {
  const environment = await openController();
  const { nodes, context } = environment;
  clickTopic(environment, platformTopic.id);
  nodes.get("#viewToggle").click();
  nodes.get("#atlasQuery").dispatch("focus");
  nodes.get("#atlasQuery").value = "platform competition";
  nodes.get("#atlasSearch").dispatch("submit");
  assert.equal(context.document.body.dataset.atlasMode, "results");
  assert.equal(context.location.searchParams.has("topic"), false);
  assert.equal(context.location.searchParams.get("q"), "platform competition");
  assert.deepEqual(environment.activePapers, platformCompetitionIds);
  assert.deepEqual(environment.rankedPapers,
    platformCompetitionIds.map((id, index) => ({ id, rank: index + 1 })));
  assert.equal(nodes.get("#resetTopic").hidden, true);
  for (const button of nodes.get("#topicList").querySelectorAll("[data-topic]")) {
    assert.equal(button.getAttribute("aria-pressed"), "false");
  }
  context.history.back();
  assertTopicSelection(environment, platformTopic, "classic");
});

test("direct subject and subject-detail URLs restore browsing after a fresh load", async () => {
  for (const baseURL of ["file:///C:/Example%20Library/Atlas/index.html", "https://example.test/Model_Atlas/"]) {
    for (const layoutParameter of ["layout=classic", "view=classic"]) {
      const subjectURL = `${baseURL}?topic=${platformTopic.id}&${layoutParameter}`;
      const subject = await openController(subjectURL);
      assertTopicSelection(subject, platformTopic, "classic");
      assert.equal(subject.context.location.searchParams.get("layout"), "classic", "legacy URLs canonicalize to the rebuilt layout route");
      assert.equal(subject.context.location.searchParams.has("view"), false);

      const detail = await openController(`${subjectURL}&paper=${encodeURIComponent(platformTopic.ids[0])}`);
      assert.equal(detail.context.document.body.dataset.atlasMode, "detail");
      assert.equal(detail.context.location.searchParams.get("topic"), platformTopic.id);
      detail.nodes.get("#backToResults").click();
      assertTopicSelection(detail, platformTopic, "classic");

      const invalidPaper = await openController(`${subjectURL}&paper=not-a-paper`);
      assertTopicSelection(invalidPaper, platformTopic, "classic");
    }
  }
});

test("invalid subjects fall back safely, and a search query takes precedence over a subject URL", async () => {
  const invalid = await openController("https://example.test/Model_Atlas/?topic=not-a-subject");
  assertHome(invalid, "?topic=not-a-subject");
  const legacyPanels = await openController("https://example.test/Model_Atlas/?topic=not-a-subject&view=classic");
  assert.equal(legacyPanels.context.document.body.dataset.atlasMode, "browse");
  assert.equal(legacyPanels.context.document.body.dataset.resultView, "classic");
  assert.equal(legacyPanels.context.location.searchParams.get("layout"), "classic");
  assert.equal(legacyPanels.context.location.searchParams.get("topic"), "not-a-subject");
  assert.deepEqual(legacyPanels.activePapers, allBrowseIds);
  const search = await openController("https://example.test/Model_Atlas/?topic=platforms&q=platform+competition");
  assert.equal(search.context.document.body.dataset.atlasMode, "results");
  assert.equal(search.context.location.searchParams.get("topic"), "platforms");
  for (const button of search.nodes.get("#topicList").querySelectorAll("[data-topic]")) {
    assert.equal(button.getAttribute("aria-pressed"), "false", "the query, not the retained URL hint, controls the view");
  }
  assert.deepEqual(search.activePapers, platformCompetitionIds);
});

test("subject browsing keeps canvas gestures but registers no removed zoom-toolbar callback", async () => {
  const environment = await openController();
  clickTopic(environment, platformTopic.id);
  assertTopicSelection(environment, platformTopic);
  assert.equal(environment.sceneCallbacks.onZoomChange, undefined);
});
