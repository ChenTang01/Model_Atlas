import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1)));
const notesPath = process.env.ATLAS_MODEL_NOTES_PATH
  ? path.resolve(process.env.ATLAS_MODEL_NOTES_PATH)
  : path.join(root, "data", "notes", "release-candidate", "model_notes.json");

const [notesBytes, mathSource, controllerSource] = await Promise.all([
  readFile(notesPath),
  readFile(path.join(root, "assets", "math.js"), "utf8"),
  readFile(path.join(root, "assets", "galaxy-controller.js"), "utf8")
]);
const notes = JSON.parse(notesBytes);
const notesSha256 = createHash("sha256").update(notesBytes).digest("hex");

function mathRuntime() {
  const document = {
    currentScript: { src: "https://example.test/Model_Atlas/assets/math.js" },
    createElement: () => ({}),
    head: { append() {} }
  };
  const context = vm.createContext({
    console,
    URL,
    location: { href: "https://example.test/Model_Atlas/index.html" },
    document
  });
  context.window = context;
  vm.runInContext(mathSource, context, { filename: "assets/math.js" });
  return context.AtlasMath;
}

function values(value) {
  return Array.isArray(value) ? value : [];
}

function readerEntries(paper, paperIndex, model, modelIndex) {
  const entries = [];
  const add = (field, location, value) => {
    if (typeof value === "string" && value) entries.push({ paperId: paper.id, modelId: model.id, field, location, value });
  };
  const addList = (field, location, list) => values(list).forEach((value, index) => add(field, `${location}[${index}]`, value));
  const paperPath = `papers[${paperIndex}]`;
  const modelPath = `${paperPath}.models[${modelIndex}]`;

  // These are the authored strings rendered by structuredDetail. Catalog
  // metadata, coverage/provenance, source locators/quotes, formal equations,
  // and symbol keys have separate release gates and are intentionally absent.
  add("question", `${paperPath}.question`, paper.question);
  add("overview", `${paperPath}.overview`, paper.overview);
  addList("modelType", `${paperPath}.modelTypes`, paper.modelTypes);
  add("modelName", `${modelPath}.name`, model.name);
  add("modelKind", `${modelPath}.kind`, model.kind);
  add("modelRelation", `${modelPath}.relation`, model.relation);
  add("modelSummary", `${modelPath}.summary`, model.summary);
  addList("object", `${modelPath}.objects`, model.objects);
  addList("input", `${modelPath}.inputs`, model.inputs);
  addList("decision", `${modelPath}.decisions`, model.decisions);
  addList("assumption", `${modelPath}.assumptions`, model.assumptions);
  add("method", `${modelPath}.method`, model.method);

  for (const [componentIndex, component] of values(model.components).entries()) {
    const componentPath = `${modelPath}.components[${componentIndex}]`;
    add("componentLabel", `${componentPath}.label`, component.label);
    add("componentRole", `${componentPath}.role`, component.role);
    add("explanation", `${componentPath}.explanation`, component.explanation);
    addList("searchPhrase", `${componentPath}.searchPhrases`, component.searchPhrases);
    addList("condition", `${componentPath}.conditions`, component.conditions);
    for (const [symbolIndex, symbol] of values(component.symbols).entries()) {
      add("symbolMeaning", `${componentPath}.symbols[${symbolIndex}].meaning`, symbol?.meaning);
    }
    for (const [bindingIndex, binding] of values(component.conceptBindings).entries()) {
      add("conceptRepresentation", `${componentPath}.conceptBindings[${bindingIndex}].representation`, binding?.representation);
    }
  }
  return entries;
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_match, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;|&#0?39;/g, "'");
}

const mathSlotPattern = /<span class="math-inline"[^>]*>([\s\S]*?)<\/span>/g;

function renderedParts(markup) {
  const fallbacks = [...String(markup).matchAll(mathSlotPattern)].map((match) => decodeHtml(match[1].replace(/<[^>]*>/g, "")));
  const outside = decodeHtml(String(markup)
    .replace(mathSlotPattern, "")
    .replace(/<[^>]*>/g, ""));
  return { fallbacks, outside };
}

function suspiciousDollarOffsets(value) {
  const offsets = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "$") continue;
    // Monetary amounts such as $9, $3.99, and $740 billion are prose, not
    // math delimiters. Everything else is a raw math/source marker.
    if (/^\$\s*\d/.test(value.slice(index))) continue;
    // Currency-per-unit notation is prose metadata too. Keep this deliberately
    // narrow: a slash and one compact ASCII unit token must immediately follow.
    if (/^\$\/[A-Za-z][A-Za-z0-9]*\b/.test(value.slice(index))) continue;
    offsets.push(index);
  }
  return offsets;
}

test("the visible-math gate distinguishes currency units from math delimiters", () => {
  assert.deepEqual(suspiciousDollarOffsets("Costs are $3.99, $/hour, and $/m3."), []);
  assert.ok(suspiciousDollarOffsets("raw $lambda$ and $C markers").length > 0,
    "named-math and unmatched variable markers remain release failures");
});

function unbalancedBrace(value) {
  let depth = 0;
  for (const character of value) {
    if (character === "{") depth += 1;
    if (character === "}" && --depth < 0) return true;
  }
  return depth !== 0;
}

function visibleIssues(value) {
  const issues = [];
  if (value.includes("\\")) issues.push("raw-backslash");
  if (value.includes("^")) issues.push("raw-caret");
  if (value.includes("_")) issues.push("raw-underscore");
  if (suspiciousDollarOffsets(value).length) issues.push("raw-dollar-or-delimiter");
  if (/\\(?:begin|end)\s*\{|\\(?:\(|\)|\[|\])|\$\$/.test(value)) issues.push("raw-tex-wrapper-or-environment");
  if (/\\[A-Za-z]+/.test(value)) issues.push("raw-tex-command");
  if (value.includes("\uFFFD")) issues.push("replacement-character");
  if (unbalancedBrace(value)) issues.push("unbalanced-braces");
  return issues;
}

const bareNamedGreek = /(?<![A-Za-z])(?:varepsilon|vartheta|varpi|varrho|varsigma|varphi|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?![A-Za-z])/g;

function fallbackIssues(value) {
  const issues = visibleIssues(value);
  bareNamedGreek.lastIndex = 0;
  if (bareNamedGreek.test(value)) issues.push("bare-named-greek");
  bareNamedGreek.lastIndex = 0;
  return issues;
}

function sourceMarkupIssues(value) {
  const issues = [];
  if (/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i.test(value)) issues.push("encoded-html-entity-in-source");
  if (/<\/?(?:script|style|iframe|object|embed|img|a|div|span|p|br|em|strong|code|pre|math|sup|sub)\b[^>]*>/i.test(value)) issues.push("html-tag-in-source");
  if (/```|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\((?:https?:|javascript:)[^)]*\)/i.test(value)) issues.push("markdown-or-link-markup-in-source");
  return issues;
}

test(`all authored reader prose has no visible raw math markup (candidate sha256 ${notesSha256})`, () => {
  const math = mathRuntime();
  assert.equal(typeof math.prose, "function", "AtlasMath.prose is the reader prose-rendering contract");

  const failures = [];
  const diagnostics = {
    papers: notes.papers.length,
    modelViews: 0,
    renderedFields: 0,
    mathSlots: 0,
    balancedBraceFields: 0,
    currencyFields: 0
  };

  for (const [paperIndex, paper] of notes.papers.entries()) {
    for (const [modelIndex, model] of values(paper.models).entries()) {
      diagnostics.modelViews += 1;
      for (const entry of readerEntries(paper, paperIndex, model, modelIndex)) {
        diagnostics.renderedFields += 1;
        if (/[{}]/.test(entry.value) && !unbalancedBrace(entry.value)) diagnostics.balancedBraceFields += 1;
        if (/\$\s*\d/.test(entry.value)) diagnostics.currencyFields += 1;
        for (const reason of sourceMarkupIssues(entry.value)) failures.push({ ...entry, phase: "source", reason });

        const ranges = [];
        const marker = entry.value.search(/[\\$^_]/);
        if (marker >= 0) ranges.push({ start: marker, end: marker + 1 });
        for (const [mode, markup] of [
          ["ordinary", math.prose(entry.value)],
          ["search-highlight", math.prose(entry.value, ranges)]
        ]) {
          const { fallbacks, outside } = renderedParts(markup);
          diagnostics.mathSlots += fallbacks.length;
          for (const reason of visibleIssues(outside)) failures.push({ ...entry, phase: `${mode}-outside-math`, reason, visible: outside });
          for (const fallback of fallbacks) {
            for (const reason of fallbackIssues(fallback)) failures.push({ ...entry, phase: `${mode}-math-fallback`, reason, visible: fallback });
          }
        }
      }
    }
  }

  assert.ok(diagnostics.modelViews >= notes.papers.length, "every paper exposes at least one selectable model");
  assert.ok(diagnostics.renderedFields > 1000, "the gate covers the complete authored reader surface");
  assert.equal(failures.length, 0,
    `${failures.length} visible-math issue(s); candidate sha256 ${notesSha256}; diagnostics ${JSON.stringify(diagnostics)}; first failures ${JSON.stringify(failures.slice(0, 40), null, 2)}`);
});

test("the structured reader routes every authored text family through AtlasMath.prose", () => {
  assert.match(controllerSource, /function mathProse\s*\(/, "the controller has one safe prose-rendering boundary");
  const directRawRoutes = [
    ["question", /(?:escapeHTML|highlightRanges)\(note\.question\b/],
    ["overview", /(?:escapeHTML|highlightRanges)\(note\.overview\b/],
    ["model name", /(?:escapeHTML|highlightRanges)\((?:entry|model)\.name\b/],
    ["model relation", /(?:escapeHTML|highlightRanges)\(model\.relation\b/],
    ["model summary", /(?:escapeHTML|highlightRanges)\(model\.summary\b/],
    ["model method", /(?:escapeHTML|highlightRanges)\(model\.method\b/],
    ["component label", /(?:escapeHTML|highlightRanges)\(component\.label\b/],
    ["component explanation", /(?:escapeHTML|highlightRanges)\(component\.explanation\b/],
    ["symbol meaning", /(?:escapeHTML|highlightRanges)\(symbol\.meaning\b/],
    ["component condition", /(?:escapeHTML|highlightRanges)\(condition\b/],
    ["binding representation", /(?:escapeHTML|highlightRanges)\(binding\.representation\b/]
  ];
  const failures = directRawRoutes.filter(([_label, pattern]) => pattern.test(controllerSource)).map(([label]) => label);
  assert.deepEqual(failures, [], `raw rendering bypasses AtlasMath.prose for: ${failures.join(", ")}`);
  assert.ok((controllerSource.match(/mathProse\(/g) || []).length >= 10,
    "the prose renderer must cover the reader's distinct authored text paths, not only symbol definitions");
});
