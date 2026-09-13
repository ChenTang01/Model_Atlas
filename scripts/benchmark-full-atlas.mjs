import { createHash, randomUUID } from "node:crypto";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAtlasServer } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = "research/ledger/performance/full-atlas.v1.json";
const IDENTITY_FILES = [
  "index.html",
  "data/atlas_articles.json",
  "data/atlas_articles.js",
  "data/model_notes.json",
  "data/model_notes.js",
  "assets/data-loader.js",
  "assets/explorer.js",
  "assets/galaxy.js",
  "assets/galaxy-controller.js",
  "assets/math.js",
  "assets/component-stack.js",
  "scripts/benchmark-full-atlas.mjs"
];
const PROFILES = Object.freeze({
  desktop: { context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, cpuThrottlingRate: 1 },
  mobile390: { context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, cpuThrottlingRate: 4 }
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export function parseCli(argv) {
  const options = {
    root: "",
    output: DEFAULT_OUTPUT,
    modelNotesDir: "",
    playwrightModule: "",
    browserExecutable: "",
    runs: 3,
    profiles: [],
    force: false,
    json: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      return value;
    };
    if (argument === "--root") options.root = take();
    else if (argument === "--output") options.output = take();
    else if (argument === "--model-notes-dir") options.modelNotesDir = take();
    else if (argument === "--playwright-module") options.playwrightModule = take();
    else if (argument === "--browser-executable") options.browserExecutable = take();
    else if (argument === "--runs") options.runs = positiveInteger(take(), "--runs");
    else if (argument === "--profile") options.profiles.push(take());
    else if (argument === "--force") options.force = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.profiles = options.profiles.length ? [...new Set(options.profiles)] : Object.keys(PROFILES);
  for (const profile of options.profiles) if (!PROFILES[profile]) throw new Error(`Unknown --profile ${profile}`);
  return options;
}

function resolveWithin(root, requested, label) {
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the project root`);
  }
  return resolved;
}

async function atomicWriteJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}-${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, filename);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

function metricPath(value, pathParts) {
  return pathParts.reduce((current, key) => current?.[key], value);
}

export function summarizeRuns(runs) {
  const metrics = {
    readyMs: ["startup", "readyMs"],
    domContentLoadedMs: ["startup", "domContentLoadedMs"],
    loadMs: ["startup", "loadMs"],
    searchIndexMs: ["startup", "searchIndexMs"],
    galaxyLayoutMs: ["startup", "galaxyLayoutMs"],
    initialPayloadBytes: ["startup", "initialPayloadBytes"],
    initialHeapUsedBytes: ["startup", "heapUsedBytes"],
    broadQueryMs: ["queries", "game theory", "durationMs"],
    typoQueryMs: ["queries", "startegic consumers", "durationMs"],
    allPanelsMs: ["panels", "allResultsDurationMs"],
    allPanelsHeapUsedBytes: ["panels", "heapUsedBytes"],
    detailReadyMs: ["detail", "readyMs"],
    detailMathMs: ["detail", "mathReadyMs"]
  };
  const summary = { runs: runs.length, metrics: {} };
  for (const [name, pathParts] of Object.entries(metrics)) {
    const values = runs.map((run) => Number(metricPath(run, pathParts))).filter(Number.isFinite);
    summary.metrics[name] = {
      min: values.length ? round(Math.min(...values)) : null,
      median: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      max: values.length ? round(Math.max(...values)) : null
    };
  }
  return summary;
}

async function fileIdentities(root, fileOverrides = {}) {
  return Promise.all(IDENTITY_FILES.map(async (relativePath) => {
    const sourcePath = fileOverrides[relativePath] || relativePath;
    const bytes = await readFile(path.resolve(root, sourcePath));
    return {
      path: relativePath,
      ...(sourcePath === relativePath ? {} : { sourcePath: sourcePath.replaceAll(path.sep, "/") }),
      bytes: bytes.length,
      sha256: sha256(bytes)
    };
  }));
}

function instrumentBrowser() {
  globalThis.__atlasBenchmark = { timings: { searchIndex: [], galaxyLayout: [] }, longTasks: [] };
  const timed = (owner, methodName, timingName) => {
    if (!owner || typeof owner[methodName] !== "function" || owner[methodName].__atlasBenchWrapped) return;
    const original = owner[methodName];
    const wrapped = function (...args) {
      const start = performance.now();
      try { return original.apply(this, args); }
      finally { globalThis.__atlasBenchmark.timings[timingName].push(performance.now() - start); }
    };
    Object.defineProperty(wrapped, "__atlasBenchWrapped", { value: true });
    owner[methodName] = wrapped;
  };
  const wrapGlobal = (globalName, prepare) => {
    let stored;
    Object.defineProperty(globalThis, globalName, {
      configurable: true,
      get() { return stored; },
      set(value) {
        prepare(value);
        stored = value;
      }
    });
  };
  wrapGlobal("GameTheoryModelAtlas", (value) => timed(value, "createSearchIndex", "searchIndex"));
  // GalaxyScene.setRecords calls the layout function through the module's
  // lexical binding, so wrapping only the exported createSemanticLayout would
  // report a misleading zero. setRecords is the exact synchronous startup
  // boundary used by the controller.
  wrapGlobal("AtlasGalaxy", (value) => timed(value?.GalaxyScene?.prototype, "setRecords", "galaxyLayout"));
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) globalThis.__atlasBenchmark.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
}

async function twoFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function heapMetrics(session) {
  const beforePayload = await session.send("Performance.getMetrics");
  const before = Object.fromEntries(beforePayload.metrics.map((entry) => [entry.name, entry.value]));
  await session.send("HeapProfiler.collectGarbage").catch(() => {});
  const afterPayload = await session.send("Performance.getMetrics");
  const after = Object.fromEntries(afterPayload.metrics.map((entry) => [entry.name, entry.value]));
  return {
    heapUsedBytes: Math.round(before.JSHeapUsedSize || 0),
    heapTotalBytes: Math.round(before.JSHeapTotalSize || 0),
    heapUsedAfterGcBytes: Math.round(after.JSHeapUsedSize || 0),
    heapTotalAfterGcBytes: Math.round(after.JSHeapTotalSize || 0),
    nodes: Math.round(after.Nodes || 0),
    documents: Math.round(after.Documents || 0)
  };
}

async function waitReady(page) {
  // The ready class intentionally hides the live-region overlay, so visibility
  // is the wrong synchronization primitive here.
  await page.waitForFunction(() => document.querySelector("#loadState")?.classList.contains("is-ready"), null, { timeout: 60000 });
  const mode = await page.locator("body").getAttribute("data-atlas-mode");
  if (mode === "error") throw new Error(await page.locator("#emptyState").innerText());
  await twoFrames(page);
}

async function measureQuery(page, query) {
  await page.locator("#atlasQuery").fill(query);
  const durationMs = await page.evaluate(async () => {
    const start = performance.now();
    document.querySelector("#atlasSearch").requestSubmit();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - start;
  });
  const countText = await page.locator("#resultsCount").innerText();
  return { durationMs: round(durationMs), countText };
}

async function measurePanels(page, baseUrl, session) {
  await page.goto(`${baseUrl}?layout=classic`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitReady(page);
  const firstPainted = await page.locator("#panelResults .result-card").count();
  const measurement = await page.evaluate(async () => {
    const button = document.querySelector("#loadMorePanels");
    const start = performance.now();
    let clicks = 0;
    while (button && !button.hidden && clicks < 100) {
      button.click();
      clicks += 1;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const root = document.documentElement;
    return {
      durationMs: performance.now() - start,
      clicks,
      cardCount: document.querySelectorAll("#panelResults .result-card").length,
      pageOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth)
    };
  });
  return { firstPainted, allResultsDurationMs: round(measurement.durationMs), ...measurement, ...await heapMetrics(session) };
}

async function measureDetail(page, baseUrl, session) {
  const started = Date.now();
  await page.goto(`${baseUrl}?paper=doi-10-1287-mksc-2023-0175`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitReady(page);
  await page.waitForSelector("#detailView:not([hidden])", { timeout: 30000 });
  const readyMs = Date.now() - started;
  const mathStart = Date.now();
  await page.evaluate(() => {
    for (const details of document.querySelectorAll("#detailContent details")) details.open = true;
    globalThis.MiniAtlasStack?.layout?.();
    return globalThis.AtlasMath?.render?.(document.querySelector("#detailContent"));
  });
  await page.waitForFunction(() => ["ready", "partial", "fallback"].includes(document.querySelector("#detailContent")?.dataset.mathStatus || ""), null, { timeout: 60000 });
  await twoFrames(page);
  const checks = await page.evaluate(() => {
    const slots = [...document.querySelectorAll("#detailContent [data-tex]")];
    const lambdaSlots = slots.filter((slot) => /lambda|λ/u.test(slot.dataset.originalText || ""));
    const cards = [...document.querySelectorAll("#detailContent .component")].map((element) => {
      const box = element.getBoundingClientRect();
      return { id: element.id, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    });
    let overlaps = 0;
    for (let left = 0; left < cards.length; left += 1) for (let right = left + 1; right < cards.length; right += 1) {
      const a = cards[left];
      const b = cards[right];
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps += 1;
    }
    return {
      mathStatus: document.querySelector("#detailContent")?.dataset.mathStatus || "none",
      mathSlots: slots.length,
      unrenderedMathSlots: slots.filter((slot) => slot.dataset.mathReady !== "true").length,
      rawDollarTexSlots: slots.filter((slot) => (slot.dataset.tex || "").includes("$")).length,
      lambdaSlots: lambdaSlots.map((slot) => ({ original: slot.dataset.originalText, tex: slot.dataset.tex, ready: slot.dataset.mathReady === "true" })),
      overlappingComponentPairs: overlaps,
      pageOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
    };
  });
  return { readyMs, mathReadyMs: Date.now() - mathStart, ...checks, ...await heapMetrics(session) };
}

async function measureOne(browser, profileName, runOrdinal, baseUrl) {
  const profile = PROFILES[profileName];
  const context = await browser.newContext({ ...profile.context, reducedMotion: "reduce", colorScheme: "light" });
  await context.addInitScript(instrumentBrowser);
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  if (profile.cpuThrottlingRate > 1) {
    await session.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuThrottlingRate });
  }
  const messages = [];
  const failedRequests = [];
  const responseBytes = new Map();
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) messages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => messages.push({ type: "pageerror", text: error.message }));
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "unknown" }));
  page.on("response", async (response) => {
    if (!response.url().startsWith(baseUrl)) return;
    const length = Number((await response.allHeaders())["content-length"] || 0);
    responseBytes.set(response.url(), length);
  });
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitReady(page);
    const startup = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const timings = globalThis.__atlasBenchmark?.timings || {};
      const resources = performance.getEntriesByType("resource");
      return {
        readyMs: performance.now(),
        domContentLoadedMs: navigation?.domContentLoadedEventEnd || 0,
        loadMs: navigation?.loadEventEnd || 0,
        searchIndexMs: timings.searchIndex?.reduce((sum, value) => sum + value, 0) || 0,
        galaxyLayoutMs: timings.galaxyLayout?.reduce((sum, value) => sum + value, 0) || 0,
        resourceCount: resources.length,
        longTasks: globalThis.__atlasBenchmark?.longTasks || []
      };
    });
    startup.initialPayloadBytes = [...responseBytes.values()].reduce((sum, value) => sum + value, 0);
    Object.assign(startup, await heapMetrics(session));
    const queries = {};
    for (const query of ["game theory", "strategic consumers", "startegic consumers"]) queries[query] = await measureQuery(page, query);
    const panels = await measurePanels(page, baseUrl, session);
    const detail = await measureDetail(page, baseUrl, session);
    return { profile: profileName, runOrdinal, startup, queries, panels, detail, messages, failedRequests };
  } finally {
    await context.close();
  }
}

async function importPlaywright(requested) {
  const value = requested || process.env.PLAYWRIGHT_MODULE || "";
  if (!value) throw new Error("Set PLAYWRIGHT_MODULE or pass --playwright-module with the installed Playwright package directory or index.mjs");
  let target = path.resolve(value);
  if (!path.extname(target)) target = path.join(target, "index.mjs");
  return import(pathToFileURL(target).href);
}

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

async function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function loadExisting(filename) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function run(options) {
  const root = path.resolve(options.root || ROOT);
  const output = resolveWithin(root, options.output || DEFAULT_OUTPUT, "benchmark output");
  const fileOverrides = {};
  if (options.modelNotesDir) {
    const notesDirectory = resolveWithin(root, options.modelNotesDir, "model notes directory");
    for (const filename of ["model_notes.json", "model_notes.js"]) {
      const source = resolveWithin(root, path.join(notesDirectory, filename), `${filename} candidate`);
      fileOverrides[`data/${filename}`] = path.relative(root, source);
    }
  }
  const identities = await fileIdentities(root, fileOverrides);
  const playwright = await importPlaywright(options.playwrightModule);
  const executablePath = path.resolve(options.browserExecutable || process.env.CHROME_PATH || "");
  if (!options.browserExecutable && !process.env.CHROME_PATH) throw new Error("Set CHROME_PATH or pass --browser-executable");
  const browser = await playwright.chromium.launch({ executablePath, headless: true, args: ["--enable-precise-memory-info"] });
  const server = createAtlasServer({ root, fileOverrides });
  try {
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    const configuration = { runs: options.runs, profiles: options.profiles, profileDefinitions: Object.fromEntries(options.profiles.map((name) => [name, PROFILES[name]])) };
    const inputSha256 = sha256(JSON.stringify({ identities, configuration, browserVersion: browser.version(), executablePath }));
    let report = await loadExisting(output);
    if (report && report.inputSha256 !== inputSha256 && !options.force) {
      throw new Error("Existing benchmark output is bound to different inputs; pass --force or choose another --output");
    }
    if (!report || report.inputSha256 !== inputSha256) {
      report = {
        schemaVersion: 1,
        kind: "full-atlas-browser-benchmark",
        status: "in_progress",
        inputSha256,
        inputs: identities,
        configuration,
        environment: {
          platform: platform(), release: release(), cpu: cpus()[0]?.model || "unknown", logicalCpus: cpus().length,
          totalMemoryBytes: totalmem(), freeMemoryBytesAtStart: freemem(), browserVersion: browser.version(), executablePath
        },
        runs: []
      };
      await atomicWriteJson(output, report);
    }
    for (const profile of options.profiles) {
      for (let ordinal = 1; ordinal <= options.runs; ordinal += 1) {
        if (report.runs.some((entry) => entry.profile === profile && entry.runOrdinal === ordinal)) continue;
        report.runs.push(await measureOne(browser, profile, ordinal, baseUrl));
        report.runs.sort((left, right) => left.profile.localeCompare(right.profile) || left.runOrdinal - right.runOrdinal);
        report.summaries = Object.fromEntries(options.profiles.map((name) => [name, summarizeRuns(report.runs.filter((entry) => entry.profile === name))]));
        await atomicWriteJson(output, report);
      }
    }
    report.status = "complete";
    report.completedAt = new Date().toISOString();
    report.summaries = Object.fromEntries(options.profiles.map((name) => [name, summarizeRuns(report.runs.filter((entry) => entry.profile === name))]));
    await atomicWriteJson(output, report);
    return { ok: true, outputPath: path.relative(root, output).replaceAll(path.sep, "/"), report };
  } finally {
    await closeServer(server).catch(() => {});
    await browser.close().catch(() => {});
  }
}

function usage() {
  return `Usage:
  node scripts/benchmark-full-atlas.mjs --playwright-module PATH --browser-executable PATH [--model-notes-dir PATH] [--runs 3] [--profile desktop] [--profile mobile390] [--output PATH] [--force] [--json]

Pass --model-notes-dir data/notes/release-candidate to benchmark the audited candidate without changing data/model_notes.*. Each completed browser run is atomically checkpointed. Rerunning with identical code, data, browser, and configuration resumes only missing profile/run pairs; changed inputs fail closed unless --force or a new output path is selected.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseCli(process.argv.slice(2));
  if (options.help) console.log(usage());
  else run(options).then((result) => {
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Full Atlas benchmark complete: ${result.outputPath}`);
      for (const [profile, summary] of Object.entries(result.report.summaries)) {
        console.log(`${profile}: ready median ${summary.metrics.readyMs.median} ms; search index ${summary.metrics.searchIndexMs.median} ms; galaxy layout ${summary.metrics.galaxyLayoutMs.median} ms; heap ${summary.metrics.initialHeapUsedBytes.median} bytes.`);
      }
    }
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
