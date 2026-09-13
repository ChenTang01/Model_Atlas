import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, readdir, stat } from "node:fs/promises";
import { request } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAtlasServer } from "../scripts/serve.mjs";
import { literatureRecord, schema31Payload } from "./fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const atlas = require("../assets/explorer.js");
const payload = JSON.parse(await readFile(path.join(root, "data/atlas_articles.json"), "utf8"));
const modelMapRecord = payload.records.find((paper) => paper.detail_level !== "literature");

test("schema 3.0 model maps and schema 3.1 mixed-detail records validate", () => {
  assert.ok(modelMapRecord, "the collection retains at least one detailed model map");
  const legacyRecord = structuredClone(modelMapRecord);
  delete legacyRecord.detail_level;
  const legacy = {
    schema_version: "3.0",
    audit: { records: 1, independently_audited: 1 },
    records: [legacyRecord]
  };
  assert.deepEqual(atlas.validatePayload(legacy).errors, []);

  const mixed = schema31Payload(modelMapRecord);
  const validated = atlas.validatePayload(mixed);
  assert.deepEqual(validated.errors, []);
  assert.deepEqual(validated.records.map((paper) => paper.id), mixed.records.map((paper) => paper.id));
  assert.deepEqual(mixed.records.map((paper) => paper.detail_level), ["model_map", "literature"]);
});

test("the complete audited dataset retains its bibliography and private-corpus identities", async () => {
  const { records, errors } = atlas.validatePayload(payload);
  assert.deepEqual(errors, []);
  assert.equal(records.length, payload.records.length);
  assert.equal(records.length, Number(payload.audit.records));
  const [bibliography, manifest] = await Promise.all([
    readFile(path.join(root, "reference.bib"), "utf8"),
    readFile(path.join(root, "research", "corpus", "manifest.v1.json"), "utf8").then(JSON.parse)
  ]);
  const bibkeys = new Set([...bibliography.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)].map((match) => match[1]));
  const manifestById = new Map(manifest.records.map((record) => [record.id, record]));
  assert.equal(manifest.records.length, records.length);
  const recordsWithBibkeys = records.filter((paper) => String(paper.bibkey || "").trim());
  assert.equal(bibkeys.size, recordsWithBibkeys.length);
  for (const paper of records) {
    assert.equal(path.basename(paper.pdf_file), paper.pdf_file, `${paper.id}: PDF filename is local`);
    if (paper.bibkey) assert.ok(bibkeys.has(paper.bibkey), `${paper.id}: bibliography entry exists`);
    const source = manifestById.get(paper.id);
    assert.ok(source, `${paper.id}: private corpus manifest entry exists`);
    assert.equal(source.pdf.path, `paper/${paper.pdf_file}`, `${paper.id}: private PDF path is pinned`);
    assert.match(source.pdf.sha256, /^[a-f0-9]{64}$/u, `${paper.id}: private PDF hash is pinned`);
    assert.ok(Number.isSafeInteger(source.pdf.bytes) && source.pdf.bytes > 5, `${paper.id}: private PDF length is pinned`);
  }
});

test("the migrated search engine retains established results and typo handling", () => {
  const baselines = [
    ["strategic consumers", 69],
    ["information disclosure", 52],
    ["platform competition", 50],
    ["strategic customers", 69],
    ["platfrom competition", 47],
    ["zzzxxyynever", 0]
  ];
  for (const [query, baselineCount] of baselines) {
    const ids = atlas.matchingPaperIds(payload.records, query);
    if (baselineCount === 0) assert.equal(ids.length, 0, query);
    else assert.ok(ids.length >= baselineCount, `${query}: retains at least ${baselineCount} established results`);
    assert.equal(new Set(ids).size, ids.length, `${query}: unique results`);
  }
});

test("literature records are discoverable by their exact title", () => {
  const fixtureMatches = atlas.matchingPaperIds(schema31Payload(modelMapRecord).records, literatureRecord.title);
  assert.ok(fixtureMatches.includes(literatureRecord.id));

  const migrated = payload.records.filter((paper) => paper.detail_level === "literature");
  if (!migrated.length) {
    assert.equal(payload.schema_version, "3.0", "the pre-migration dataset has no literature records yet");
    return;
  }
  assert.equal(payload.schema_version, "3.1");
  assert.equal(migrated.length, Number(payload.audit.literature_records));
  const samples = [migrated[0], migrated[Math.floor(migrated.length / 2)], migrated.at(-1)];
  for (const paper of new Map(samples.map((record) => [record.id, record])).values()) {
    assert.ok(atlas.matchingPaperIds(payload.records, paper.title).includes(paper.id), paper.title);
  }
});

async function assertLocalReference(reference, documentName, mount) {
  if (!reference || /^(?:https?:|mailto:|tel:|data:|#)/i.test(reference)) return;
  const documentURL = new URL(`${mount}${documentName}`, "https://example.test");
  const target = new URL(reference, documentURL);
  assert.equal(target.origin, documentURL.origin, `${documentName}: ${reference} stays local`);
  assert.ok(target.pathname.startsWith(mount), `${documentName}: ${reference} stays inside ${mount}`);
  const relative = decodeURIComponent(target.pathname.slice(mount.length));
  const targetFile = path.join(root, relative || "index.html");
  assert.ok((await stat(targetFile)).isFile(), `${documentName}: ${reference} resolves`);
}

test("page assets, navigation, CSS URLs, and dataset work at root and project URLs", async () => {
  const controller = await readFile(path.join(root, "assets/galaxy-controller.js"), "utf8");
  const dataURL = /\bDATA_URL\s*=\s*["']([^"']+)["']/.exec(controller)?.[1];
  assert.ok(dataURL, "controller exposes its dataset URL");
  for (const mount of ["/", "/Model_Atlas/"]) {
    for (const documentName of ["index.html", "about.html"]) {
      const html = await readFile(path.join(root, documentName), "utf8");
      const references = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]);
      await Promise.all(references.map((reference) => assertLocalReference(reference, documentName, mount)));
    }
    await assertLocalReference(dataURL, "index.html", mount);
    const css = await readFile(path.join(root, "assets/explorer.css"), "utf8");
    const references = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)]
      .map((match) => match[1] ?? match[2] ?? match[3]);
    await Promise.all(references.map((reference) => assertLocalReference(reference, "assets/explorer.css", mount)));
  }
});

test("homepage presents the concise Atlas Beta identity and purpose", async () => {
  const [html, css] = await Promise.all([
    readFile(path.join(root, "index.html"), "utf8"),
    readFile(path.join(root, "assets/explorer.css"), "utf8")
  ]);

  assert.match(html, /<title>Atlas \(Beta\) · Research Model Galaxy<\/title>/);
  assert.match(html, /aria-label="Atlas Beta — return to the galaxy"/);
  assert.match(html, /<span class="brand-name">Atlas<\/span><span class="brand-beta">\(Beta\)<\/span>/);
  assert.match(html, /<h1 id="homeTitle">Research models,<br><em>mapped\.<\/em><\/h1>/);
  assert.match(html, /Atlas maps 1,653 research papers/);
  assert.match(html, /A research galaxy with 1,653 selectable paper nodes/);
  assert.doesNotMatch(html, /1,660/);
  assert.doesNotMatch(html, /01—08/, "the subject index does not show a redundant range label");

  for (const discardedCopy of [
    "A collection of research models",
    "FULL CORPUS",
    "Modeling research, in context",
    "Find how a mechanism is modeled",
    "Choose a subject to trace its constellation"
  ]) {
    assert.doesNotMatch(html, new RegExp(discardedCopy, "i"));
  }

  const betaRule = /\.brand-copy \.brand-beta\s*\{([^}]+)\}/.exec(css);
  assert.ok(betaRule, "the Beta label has a dedicated style");
  assert.match(betaRule[1], /color:\s*var\(--gold\)/, "the Beta label uses a distinct accent color");
  assert.match(betaRule[1], /font:\s*inherit/, "the Beta label is the same size as Atlas");

  for (const removedChrome of ["collection-stamp", "mapCaption", "zoomControls"]) {
    assert.doesNotMatch(html, new RegExp(`(?:class|id)="${removedChrome}"`), `${removedChrome} is absent from the subject view`);
  }

  const shortDesktopRule = /@media \(min-width: 761px\) and \(max-height: 760px\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(shortDesktopRule, "short desktop viewports have a dedicated layout");
  assert.match(shortDesktopRule[1], /\.topic-index\s*\{[^}]*overflow-x:\s*hidden/, "the subject index never introduces a horizontal scrollbar");
});

async function startServer(context, basePath = "", fileOverrides = {}) {
  const server = createAtlasServer({ root, basePath, fileOverrides });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function rawRequest(origin, pathname) {
  return new Promise((resolve, reject) => {
    const outgoing = request(`${origin}/`, { path: pathname }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("HTTP serves the standalone pages, JSON, and Unicode PDF byte ranges", async (context) => {
  const origin = await startServer(context);
  for (const pathname of ["/", "/about.html", "/assets/galaxy.js", "/assets/explorer.css"]) {
    const response = await fetch(`${origin}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.ok((await response.arrayBuffer()).byteLength > 0, pathname);
  }
  const data = await fetch(`${origin}/data/atlas_articles.json`);
  assert.match(data.headers.get("content-type"), /^application\/json/);
  assert.equal((await data.json()).records.length, payload.records.length);

  let localPdfs;
  try {
    localPdfs = new Set((await readdir(path.join(root, "paper"))).filter((name) => name.toLowerCase().endsWith(".pdf")));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const paper = payload.records.find((record) => localPdfs.has(record.pdf_file) && /[^\x00-\x7F]/.test(record.pdf_file));
  assert.ok(paper, "exercise a Unicode PDF filename");
  const pdfURL = `${origin}/paper/${encodeURIComponent(paper.pdf_file)}`;
  const head = await fetch(pdfURL, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "application/pdf");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const size = Number(head.headers.get("content-length"));
  assert.ok(size > 5);
  const partial = await fetch(pdfURL, { headers: { Range: "bytes=0-4" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes 0-4/${size}`);
  assert.equal(await partial.text(), "%PDF-");
  const suffix = await fetch(pdfURL, { headers: { Range: "bytes=-12" } });
  assert.equal(suffix.status, 206);
  assert.equal((await suffix.arrayBuffer()).byteLength, 12);
  const invalid = await fetch(pdfURL, { headers: { Range: `bytes=${size}-` } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), `bytes */${size}`);
});

test("HTTP can preview a candidate file without mutating the public bundle", async (context) => {
  const origin = await startServer(context, "", { "data/model_notes.js": "data/atlas_articles.js" });
  const [served, candidate, publicBundle] = await Promise.all([
    fetch(`${origin}/data/model_notes.js`).then((response) => response.text()),
    readFile(path.join(root, "data/atlas_articles.js"), "utf8"),
    readFile(path.join(root, "data/model_notes.js"), "utf8")
  ]);
  assert.equal(served, candidate);
  assert.notEqual(served, publicBundle);
});

test("HTTP rejects hidden paths, traversal, malformed URLs, and writes", async (context) => {
  const origin = await startServer(context);
  for (const pathname of ["/.git/config", "/.env", "/assets/.secret", "/../reference.bib", "/%2e%2e/reference.bib", "/assets/%2e%2e/reference.bib", "/%5c..%5creference.bib"]) {
    assert.equal(await rawRequest(origin, pathname), 403, pathname);
  }
  assert.equal(await rawRequest(origin, "/%ZZ"), 400);
  assert.equal((await fetch(`${origin}/missing.html`)).status, 404);
  const write = await fetch(origin, { method: "POST", body: "not a write endpoint" });
  assert.equal(write.status, 405);
  assert.equal(write.headers.get("allow"), "GET, HEAD");
});

test("HTTP previews GitHub project hosting below /Model_Atlas/", async (context) => {
  const origin = await startServer(context, "/Model_Atlas");
  const redirect = await fetch(`${origin}/Model_Atlas?q=platform`, { redirect: "manual" });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "/Model_Atlas/?q=platform");
  for (const resource of ["", "about.html", "assets/galaxy-controller.js", "data/atlas_articles.json"]) {
    const response = await fetch(`${origin}/Model_Atlas/${resource}`);
    assert.equal(response.status, 200, resource || "index");
    await response.arrayBuffer();
  }
  const paper = payload.records.find((record) => record.detail_level === "literature") || payload.records[0];
  const hasLocalPdf = await stat(path.join(root, "paper", paper.pdf_file)).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  const pdf = await fetch(`${origin}/Model_Atlas/paper/${encodeURIComponent(paper.pdf_file)}`, { method: "HEAD" });
  assert.equal(pdf.status, hasLocalPdf ? 200 : 404);
  if (hasLocalPdf) assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal((await fetch(`${origin}/data/atlas_articles.json`)).status, 404);
});
