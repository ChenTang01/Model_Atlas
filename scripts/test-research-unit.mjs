import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// These existing suites create synthetic source/ledger fixtures in temporary
// directories or exercise pure functions. They need no third-party papers,
// private extraction artifacts, Python, external service, or API credentials.
// Corpus-bound regressions stay in `npm run test:research` for local use.
const suites = [
  "author-model-notes-curated-reconciliation",
  "author-model-notes-safe-map",
  "canonicalize-paper-ledgers",
  "compact-retirements",
  "english-metadata-sanitizer",
  "extraction-qa",
  "extraction-repair-adjudication",
  "extraction-repair-promotion",
  "model-note-authoring-plan",
  "model-note-authoring-runner",
  "model-note-checkpoints",
  "model-note-extraction-qa",
  "model-note-formula-extraction",
  "model-note-formula-fragments",
  "model-note-relevance",
  "model-note-safe-map",
  "model-note-sections",
  "model-note-semantic-audit",
  "model-note-semantic-authoring",
  "model-note-semantic-setup-regressions",
  "model-note-text-quality",
  "model-note-variant-locality",
  "model-note-variants",
  "prune-workspace",
  "rebind-safe-map-qa",
  "retire-papers"
];
const child = spawn(process.execPath, ["--test", ...suites.map((name) => `tests/${name}.test.mjs`)], {
  cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit", windowsHide: true
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
