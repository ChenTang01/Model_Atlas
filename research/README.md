# Atlas corpus pipeline

This directory is the restart boundary for rebuilding Atlas from lawfully obtained, local-only PDFs in the ignored `paper/` directory. The current tree stores the catalog, manifest, checkpoints, and structured release data while excluding source PDFs, full-text extraction caches, and page images. Earlier Git history still needs PDF cleanup; see the [source-corpus status](../README.md#source-corpus). The pipeline does not rewrite the source PDFs. The [project license excludes third-party papers and their protected content](../THIRD_PARTY_NOTICES.md).

## Public clone and local research workspace

Run `npm run check:public` in a public clone for website checks, fixture-based research tests, and the publication guard. These checks do not need PDFs, Python, API credentials, or extraction caches. Hosted CI runs this public workflow only.

For source-dependent work, obtain the papers through sources you are authorized to use, place them at the exact paths in `corpus/manifest.v1.json`, and install the extraction runtime described below. Run `inventory --check` before rebuilding extraction artifacts. A missing or different PDF must fail verification; do not change a source hash simply to pass a check.

Use `npm run test:research` for the full suite in a hydrated workspace and `npm run check:research` for that suite plus the seven-stage readiness gate. Record the commit, environment, commands, and outcomes in the pull request. Keep PDFs, extracted pages, reading packets, and review screenshots local; share paper IDs, source hashes, and original summaries of findings. CI success alone does not establish research readiness or clear redistribution rights.

## Source baseline and live progress

The checked-in source inventory covers all 1,653 records and pins all 1,653 PDFs by identity. The model-map and literature counts below describe input and authoring provenance; they no longer describe whether a paper has a structured note:

- 1,355 literature records and 298 model-map records
- 35,246 PDF pages and 3,612,048,792 PDF bytes
- 30 frozen Mini Atlas editorial fixtures
- 1,623 additional PDF-backed notes: 10 curated full-source notes, 292 metadata-enriched legacy model maps, and 1,321 generated source-section maps
- 2 inventory-time PDF parser warnings retained for extraction QA

Authored and audited stage counts change as the restartable build advances, so they are not frozen in this document. Run `status` for the authoritative live roll-up. A stage may advance only when its output is present and its recorded upstream identity still matches; `contentAudit: complete` means the deterministic maturity audit ran, not that an independent scholarly review occurred.

The authoritative content-addressed Extraction QA status is reported by
`scripts/extraction-qa.mjs status`; the rebuildable legacy ledger summary can
lag that standalone decision set. See [EXTRACTION_QA.md](EXTRACTION_QA.md) for
the review workflow and [EXTRACTION_REPAIR.md](EXTRACTION_REPAIR.md) for the
current fail-closed recovery matrix for visually rejected extractions.

## Commands

Run commands from the Atlas project root:

```powershell
node scripts/corpus-pipeline.mjs status
node scripts/corpus-pipeline.mjs status --check-ready
node scripts/corpus-pipeline.mjs status --refresh-summary
node scripts/corpus-pipeline.mjs inventory --jobs 8
node scripts/corpus-pipeline.mjs inventory --check --jobs 8
node scripts/corpus-pipeline.mjs extract --limit 25 --jobs 4
node scripts/extraction-qa.mjs review --from <paper-id> --limit 100 --jobs 8
node scripts/extraction-qa.mjs review --check --jobs 8
node scripts/author-model-notes.mjs --reconcile-mini --from <paper-id> --limit 10 --jobs 4
node scripts/author-model-notes.mjs --from <paper-id> --limit 25 --jobs 4
node scripts/plan-model-note-authoring.mjs --check --output research/ledger/authoring-plan.release-v20.json
node scripts/run-model-note-authoring-plan.mjs --plan research/ledger/authoring-plan.release-v20.json --status
node scripts/run-model-note-authoring-plan.mjs --plan research/ledger/authoring-plan.release-v20.json --from-batch 1 --through-batch 5
node scripts/benchmark-full-atlas.mjs --model-notes-dir data/notes/release-candidate --playwright-module <path> --browser-executable <path> --runs 3
node scripts/build-model-notes.mjs
node scripts/audit-model-notes.mjs --from <paper-id> --limit 25 --jobs 4
node scripts/audit-model-notes.mjs --candidate-only --jobs 8
```

The exact npm-free aggregate readiness gate is:

```powershell
node scripts/corpus-pipeline.mjs inventory --check --jobs 8
node scripts/extraction-qa.mjs review --check --jobs 8
node scripts/author-model-notes.mjs --reconcile-mini --jobs 8 --check
node scripts/model-note-checkpoints.mjs --check
node scripts/build-model-notes.mjs --check
node scripts/audit-model-notes.mjs --jobs 8 --check
node scripts/corpus-pipeline.mjs status --check-ready
```

`npm run check:ready` is an alias for those seven commands. The Extraction QA command independently recomputes every current content-addressed decision and accepted adjudication; a missing, stale, failed, or manual-incomplete result stops the gate. The Mini reconciliation check then requires all 30 frozen editorial checkpoints to carry that exact QA binding. The inventory check requires the pinned extraction environment; set `ATLAS_PYTHON` or pass `--python <path>` when it is not on `PATH`.

The equivalent selector form is supported for orchestration systems:

```powershell
node scripts/corpus-pipeline.mjs --select status
node scripts/corpus-pipeline.mjs --select inventory --jobs 8
node scripts/corpus-pipeline.mjs --select extract --limit 25 --dry-run
```

Use `--json` for machine-readable output. Ordinary `status` is informational: `ok` and `structurallyConsistent` describe manifest/ledger structure, while its `releaseReady` value describes only canonical ledger-stage statuses. `status --check-ready` additionally recomputes every authoritative QA decision/adjudication, verifies the exact eight-field QA binding on every downstream stage, and exits nonzero when that full result is not ready. `status --refresh-summary` safely rebuilds `ledger/summary.json` from the authoritative paper ledgers without changing them. `inventory --check` performs the full source/PDF inspection and compares it with the saved manifest and ledgers without writing anything; it exits nonzero on a mismatch. For commands that accept paper selectors, extraction recognizes a route ID, normalized DOI, DOI URL, or recorded alias; authoring and audit recognize a route ID, DOI, or canonical DOI URL. Repeat `--paper`/`--id` or pass a comma-separated list. `--from` starts at the selected paper, inclusively, in deterministic manifest order. `--limit` is applied after filtering and ordering. `--retry-failed` selects only failed extraction ledgers. `--force` includes already-complete extraction records and is intentionally mutually exclusive with `--retry-failed`. `--python PATH` overrides Python discovery; `ATLAS_PYTHON` is also supported. Install the hash-bound extraction runtime with `python -m pip install -r requirements-extraction.txt`; the checked manifest uses `pypdf==6.14.2` and `PyMuPDF==1.28.2`.

Examples:

```powershell
node scripts/corpus-pipeline.mjs extract --paper 10.1287/msom.2025.0182 --dry-run --json
node scripts/corpus-pipeline.mjs extract --paper agnihothri2026increasingmhealthusage --jobs 1
node scripts/corpus-pipeline.mjs extract --from doi-10-1287-mnsc-2020-3897 --limit 25 --dry-run
node scripts/corpus-pipeline.mjs extract --retry-failed --jobs 2
```

## Files and identity

`corpus/manifest.v1.json` is a deterministic, ID-sorted inventory. Each record preserves the existing Atlas route ID, uses the normalized DOI as its canonical identity, records a DOI-derived route alias when the two differ, and pins the PDF by relative path, byte length, SHA-256, page count, and parser result. The manifest also records source-file hashes, import provenance where available, and per-record digests.

`ledger/papers/<paper-id>.json` is the independently writable checkpoint for one paper. The canonical stage set is:

- `inventory`: source record, file, hash, and parser inspection reconciled
- `extraction`: page text artifacts written for the pinned PDF/parser input
- `extractQa`: parser and extraction warnings that need review
- `sectionIndex`: resumable source-section index
- `sourceReading`: source reading against the pinned PDF
- `noteAuthoring`: structured evidence note status
- `quoteAudit`: quotation text and page-reference verification
- `formulaAudit`: formula/restatement verification against the source
- `schemaValidation`: authored-note schema and reference validation
- `contentAudit`: deterministic setup, formulation, symbol, condition, binding, and variant-locality maturity metrics, with unresolved limits retained as warnings
- `sourceAudit`: source/citation verification status
- `releaseBuild`: incorporation into the public Atlas build

Stage statuses are `pending`, `complete`, `needs_review`, `failed`, `invalidated`, or `blocked` as applicable. The canonical summary reports a `missing` count even when a newly introduced stage is absent from every older ledger. `ledger/summary.json` is a rebuildable cache; the per-paper ledgers remain authoritative for work progress. Refresh it with `status --refresh-summary` rather than rerunning source work solely to update counts.

Extraction artifacts live at `ledger/artifacts/<paper-id>/<input-digest>/pages.json` and `text.txt`. The input digest binds the PDF hash, both parser versions, the font-map detector, validation policy, and extraction code. `pypdf` remains the primary reader. When its high-yield output exhibits the systematic punctuation/letter substitutions produced by a broken PDF character map, the same restartable worker re-reads the complete document with PyMuPDF. The alternate output must clear the corruption detector, preserve the page count, retain adequate readable-page coverage and text yield, and retain at least the configured fraction of the primary extraction; otherwise the paper fails closed. The manifest and worker reject stale code, policy, or ledger identities before extraction starts. The artifact and ledger record the selected engine and `alternate_parser_fallback`. The dedicated, hash-bound workflow in `EXTRACTION_QA.md` can accept a verified fallback while retaining that fact in `extractQa.sourceReasons`; parser warnings and the full legacy font-map case remain explicit `needs_review` decisions. This prevents a cleaner fallback from becoming an undocumented, irreproducible one-off.

## Restart and concurrency behavior

Every manifest, ledger, summary, and artifact write uses a same-directory temporary file followed by an atomic rename. A crash can leave no partially written target. Temporary extraction claims are created exclusively under `ledger/.claims/`; they are ignored by Git, expire after 60 minutes by default, and can be adjusted with `--claim-ttl-minutes`.

### Recoverable retirement of papers

`scripts/retire-papers.mjs` removes an explicitly named literature/model-map paper
set from the active corpus without using a broad recursive delete. `prepare` resolves every matching
PDF, paper note, ledger, extraction/QA/repair artifact, safe map, generated
candidate, and aggregate metadata input; records file/directory byte counts and
SHA-256 digests; and writes `retirement-plan.json` in a sibling quarantine.
`apply` prunes aggregate identities and moves the exact planned artifacts under
the quarantine's `retired/` tree. If it is interrupted, rerun the same `apply`
command: each move accepts either the verified live source or its verified
quarantined destination, so completed moves are not repeated.

```powershell
$retirementDir = "..\Atlas-retired\YYYY-MM-DD-blockers-v1"
node scripts/retire-papers.mjs prepare --ids <id-1,id-2> --quarantine $retirementDir
node scripts/retire-papers.mjs apply --quarantine $retirementDir
# Rebuild the workbook, catalog snapshot, authoring plan, candidate, and public release.
node scripts/retire-papers.mjs verify --quarantine $retirementDir
# Later, verify only the self-contained archive even if the active corpus changed.
node scripts/retire-papers.mjs verify-archive --quarantine $retirementDir
```

The default operation name preserves the extraction-blocker safeguards. For a
different explicit mixed record set, pass a stable identifier such as
`--operation retire-mixed-records` to `prepare`; the plan derives literature,
model-map, import-manifest, and import-audit removal counts from actual matches.
The operation flag belongs to `prepare` only and is frozen in the resulting plan.

The final `verify` command rehashes the quarantined artifacts and checks that
catalog JSON/JS, manifest records, import records, candidate notes, and public
notes contain the same current ID set and no retired identity. Recreated
candidate/plan paths are accepted only when their bytes differ from the retired
snapshots. The plan's progress fields are the restart boundary for the workbook,
public promotion, and readiness gate. Recovery remains possible by restoring
the exact `retired/<relative-path>` entries and aggregate backups listed in the
plan; do not infer restore targets by filename globbing. `verify-archive` is the
archive-integrity check: it validates the planned move entries and baseline
backups by count, byte length, and SHA-256 without consulting current corpus
counts or identities.

The three completed 2026-09-13 quarantines were later compacted after explicit
permanent-deletion authorization. `corpus/paper-retirements.v1.json` preserves
their operations, counts, source hashes, paper identities, PDF hashes, and
deletion reasons. It cannot reconstruct the removed PDFs or derived artifacts.
The compaction itself is restartable through `scripts/compact-retirements.mjs`;
workspace pruning uses the separately hash-bound `scripts/prune-workspace.mjs`
plan/apply/verify sequence.

The default extraction selector considers only records whose inventory is complete and whose extraction status is `pending`, `failed`, or `invalidated`. Completed work is skipped unless `--force` is explicit. Use `--retry-failed` to narrow a recovery run to failures, or `--from` to resume from a known inclusive checkpoint without hand-building a list. Before committing a result, the worker verifies that the ledger still has the digest it claimed; if another worker changed it, the result is not attached to that ledger.

To resume the full source-to-release workflow after interruption:

1. Run `status` and inspect structural diagnostics and per-stage counts. Use `status --check-ready` only when a nonzero not-ready result is useful to automation.
2. Run `inventory` if the source JSON or PDFs changed, or if ledgers need regeneration. An unchanged rerun preserves completed stage objects; a changed record, PDF, extraction input, authoring version, concept registry, or audit prerequisite invalidates its dependents. A corpus revision change invalidates every per-paper `releaseBuild` because the release bytes are corpus-wide.
3. Run `extract --dry-run`, then bounded `extract` batches until no candidates remain. Resume inclusively with `--from`, and isolate extraction failures with `--retry-failed`.
4. Run `extraction-qa.mjs review --dry-run`, then the same bounded review batches without `--dry-run`. A repeated batch skips current accepted/manual-pending automated decisions and retries failed work. For every `needs_review` paper, render and compare all pages listed in its decision's `manualReviewRequirements`, record one reason-specific `adjudicate --finding` per page, and accept or reject it. Finish with `extraction-qa.mjs review --check --jobs 8`; only effective `complete` results pass.
5. First run `author-model-notes.mjs --reconcile-mini --dry-run`, then bounded `--reconcile-mini` batches over the 30 frozen Mini papers. This validates the frozen note/page sources and binds `noteAuthoring`, `sectionIndex`, and `sourceReading` to current automated QA plus adjudication hashes; `--paper`, inclusive `--from`, `--limit`, `--dry-run`, and `--check` are supported, and a rerun skips current per-paper checkpoints. Then run ordinary `author-model-notes.mjs` in bounded batches for the 1,623 non-Mini papers. Rerun reported IDs with `--paper`, or resume deterministic catalog order with `--from` and `--limit`. Use `model-note-checkpoints.mjs --check` to verify the QA decision plus all three authoring artifacts; that command is deliberately not an end-to-end release check.
   The completed V20 run is frozen at `ledger/authoring-plan.release-v20.json`: four 326-paper batches and a final 319-paper batch, with complete receipts under `ledger/logs/model-note-authoring-release-v20/`. The plan uses schema version 2, which freezes a curated paper's immutable editorial seed rather than the complete mutable note envelope: all non-binding envelope fields and all note content except `note.provenance` are substantive, while extraction-page, concept-registry, input-digest, Extraction-QA, and `note.provenance` fields are operational reconciliation state. Thus a normal curated reconciliation does not invalidate the plan, but an editorial-content change does. Schema-v1 plans are rejected rather than migrated in place; freeze a new v2 plan after deliberate review. Its new plan/freeze identity invalidates old batch receipts, while already-current atomic per-paper checkpoints remain reusable. Verify the plan with `plan-model-note-authoring.mjs --check --output research/ledger/authoring-plan.release-v20.json`, then use `run-model-note-authoring-plan.mjs --plan research/ledger/authoring-plan.release-v20.json`. The runner executes the bootstrap batch alone, caps later process concurrency at the plan's recorded limit, records stdout, exit status, and a hash-bound result receipt for each batch, and skips only a verified successful receipt. A missing, stale, interrupted, or failed receipt is rerun safely; already-current per-paper checkpoints are reused. `--status` is informational and `--check` is a read-only completeness gate. Do not use the force-retry command unless source/code drift has been deliberately resolved and a new plan has been frozen.
6. Run `build-model-notes.mjs`. It writes the validated candidate pair under `data/notes/release-candidate/`; it does not publish directly. Run `audit-model-notes.mjs` in bounded `--paper`, `--from`, or `--limit` scopes so successful per-paper audit ledgers survive interruption, then finish the full prerequisite audit with `--candidate-only`. That mode writes a hash-bound `data/notes/release-candidate/audit.v1.json` and is structurally unable to promote the public pair. Benchmark those exact candidate bytes with `benchmark-full-atlas.mjs --model-notes-dir data/notes/release-candidate`; the preview server substitutes the candidate only in memory and leaves `data/model_notes.{json,js}` untouched.
7. Only after an explicit release decision, run `audit-model-notes.mjs` without `--candidate-only`. It promotes the candidate to public `data/model_notes.{json,js}` only when every paper's hash-bound audit prerequisite is current, the full `sectionIndex`/`sourceReading`/`noteAuthoring` checkpoint check passes for all 1,653 papers, and every current source PDF still matches its manifest byte length, SHA-256, and `%PDF-` header.
8. Run the seven direct Node readiness commands above (or their `npm run check:ready` alias) for the aggregate source/PDF inventory, Extraction QA, Mini QA reconciliation, authoring-artifact, candidate, audit, public-release, and canonical-stage gate. Then use `status --refresh-summary` if the checked-in roll-up should be updated.

Inventory reuses compatible completed stage state without comparing unrelated producer-specific digest formats. If a true upstream identity changes, prior derived work is marked `invalidated` with the replacement input digest instead of being silently trusted. Downstream `sourceAudit` and `releaseBuild` can never remain complete while a prerequisite is invalidated. The 30 Mini Atlas note seeds are accepted only when their source mapping and PDF hashes match the main corpus and their canonical frozen `research/pages/Pxxx.json` files match the raw-byte SHA-256 recorded in the seed and reading checkpoints. Candidate generation recomputes the authoritative Extraction QA sidecar and requires effective `complete`; an automated `needs_review` result is eligible only through a current hash-bound accepted adjudication. Candidate, authoring, reading, audit, and release provenance bind both the automated decision and any required adjudication.

## Relevance labels

Keep relevance multi-dimensional rather than forcing papers into one bucket. These vocabularies match the Mini Atlas semantics:

- `applicability`: `modeled`, `unclassified`, `explicitlyExcluded`, `backgroundOnly`, `unknown`
- `evidenceLocation`: `concept`, `scenario`, `formulation`, `condition`, `symbol`, `component explanation`, `model setup`, `decision-state`, `method-result`, `bibliography-abstract`
- legacy source-provenance axis `maturity`: `component-mapped`, `legacy deep map`, `evidence-index`

All 1,653 papers now have structured notes. Applicability and evidence location remain scoped, query-derived state rather than paper-level rank metadata. The legacy maturity field records source provenance, not current note availability or quality. The UI may derive a ranking tier from these axes, but source-linked component labels and evidence must remain intact. Never infer a structured finding solely from a title, abstract, or parser success.
