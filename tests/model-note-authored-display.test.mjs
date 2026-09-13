import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { hasOrphanMathScriptMarker } from "../scripts/model-note-text-quality.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTES_DIR = path.join(ROOT, "data", "notes", "papers");

const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));

function authoredDisplayProse(note) {
  const entries = [
    ["question", note?.question],
    ["overview", note?.overview],
    ["coverage.note", note?.coverage?.note]
  ];
  for (const [modelIndex, model] of (note?.models || []).entries()) {
    const modelPath = `models[${modelIndex}]`;
    entries.push(
      [`${modelPath}.name`, model?.name],
      [`${modelPath}.relation`, model?.relation],
      [`${modelPath}.summary`, model?.summary],
      [`${modelPath}.method`, model?.method]
    );
    for (const field of ["objects", "inputs", "decisions", "assumptions"]) {
      for (const [valueIndex, value] of (model?.[field] || []).entries()) {
        entries.push([`${modelPath}.${field}[${valueIndex}]`, value]);
      }
      for (const [valueIndex, entry] of (model?.setupEvidence?.[field] || []).entries()) {
        // The authored value may be displayed with the setup list. Its literal
        // evidence quote is deliberately excluded and must remain source exact.
        entries.push([`${modelPath}.setupEvidence.${field}[${valueIndex}].value`, entry?.value]);
      }
    }
    for (const [componentIndex, component] of (model?.components || []).entries()) {
      const componentPath = `${modelPath}.components[${componentIndex}]`;
      entries.push(
        [`${componentPath}.label`, component?.label],
        [`${componentPath}.explanation`, component?.explanation]
      );
      for (const [valueIndex, value] of (component?.searchPhrases || []).entries()) {
        entries.push([`${componentPath}.searchPhrases[${valueIndex}]`, value]);
      }
      for (const [valueIndex, value] of (component?.conditions || []).entries()) {
        entries.push([`${componentPath}.conditions[${valueIndex}]`, value]);
      }
      // Symbol meanings may deliberately contain TeX domains (for example,
      // `x \\in \\mathbb R`). The reader sends those strings through its
      // math-aware prose renderer; they are audited separately from ordinary
      // authored display prose.
      for (const [bindingIndex, binding] of (component?.conceptBindings || []).entries()) {
        entries.push([
          `${componentPath}.conceptBindings[${bindingIndex}].representation`,
          binding?.representation
        ]);
      }
    }
  }
  return entries.filter(([, value]) => typeof value === "string" && value.trim());
}

test("published authored prose never exposes source-native math delimiters or ASCII set difference", async () => {
  const files = (await readdir(NOTES_DIR)).filter((filename) => filename.endsWith(".json")).sort();
  const violations = [];
  for (const filename of files) {
    const envelope = await readJson(path.join(NOTES_DIR, filename));
    const note = envelope?.note || envelope;
    for (const [fieldPath, value] of authoredDisplayProse(note)) {
      if (value.includes("\\") || /\$[CU]\b/u.test(value) || hasOrphanMathScriptMarker(value)) {
        violations.push(`${note.id}:${fieldPath}=${JSON.stringify(value)}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("supplier equilibrium labels are clean in prose while the literal source quote stays unchanged", async () => {
  const paperId = "doi-10-1287-msom-2018-0744";
  const envelope = await readJson(path.join(NOTES_DIR, `${paperId}.json`));
  const component = (envelope.note.models || [])
    .flatMap((model) => model.components || [])
    .find((entry) => entry.id === "nonexclusive-suppliers");
  assert.ok(component, `${paperId}: nonexclusive-suppliers component missing`);
  assert.equal(
    component.sources[0].quote,
    "We denote the equilibrium where both buyers sharing a supplier by $C and one where the buyers sourcing from different suppliers by $U."
  );
  for (const [field, value] of [
    ["explanation", component.explanation],
    ["formal", component.formal],
    ["condition", component.conditions[0]],
    ["binding", component.conceptBindings[0].representation]
  ]) {
    assert.doesNotMatch(value, /\$[CU]\b|\\/u, `${paperId}: raw source notation leaked into ${field}`);
  }
  assert.match(component.conditions[0], /\bshare a supplier as C\b[\s\S]*\bdifferent suppliers as U\b/u);
});
