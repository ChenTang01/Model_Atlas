# Restartable model-note authoring support

The public release and the research checkpoints serve different purposes. Draft reading and authoring artifacts remain outside public `data/model_notes.*` until their quotation, formula, schema, content-maturity, and source audits pass. A validated but not-yet-promoted release candidate lives under `data/notes/release-candidate/`.

## Active full-corpus workflow

### Completed V20 release checkpoint (2026-09-13)

The source-mapped authoring engine is frozen at `source-sections-v20`. Its
authoring, variant-locality, formula, semantic, safe-map, planner, candidate,
and public-release regression gates pass. V20 retains repaired nonbaseline
definitions only when strict source and semantic checks succeed, rejects
affiliation headings, result prose, and ambiguous hard-hyphen joins as model
definitions, and supports a content-preserving QA-only rebind when a valid V20
note's extraction decision changes without changing its source content.

The current 1,623-paper non-Mini run is frozen in
`research/ledger/authoring-plan.release-v20.json`. Its five exact batches contain
326 papers each except the final 319-paper batch, and all five hash-bound result receipts are complete under
`research/ledger/logs/model-note-authoring-release-v20/`. The 30 Mini fixtures
were reconciled separately, the 1,653-paper candidate was audited and promoted
after explicit authorization, and `npm run check:ready` passed. Older V18/V19
plans and receipts are historical inputs and must not be resumed against this
corpus.

The internal-candidate authoring sequence is paper-granular and safe to rerun:

```powershell
npm run author:notes
npm run author:mini
npm run build:notes
npm run audit:candidate
```

`npm run audit:notes` is deliberately not part of this sequence: it is the
separate public-promotion command and must be run only after release acceptance
and publication authorization. `audit:candidate` never writes
`data/model_notes.json` or `data/model_notes.js`.

For each of the 1,613 generated or reconciled non-Mini notes, `scripts/author-model-notes.mjs` binds the full catalog record, PDF hash, extracted-pages hash, concept-registry hash, and authoring version through `authoringInputDigest`. The 10 curated non-Mini notes use `curatedInputDigest`, which binds the authoring version, paper/PDF/extraction/concept-registry identities, and curated note content. The command atomically writes the note to `data/notes/papers/<paper-id>.json`, writes a reading packet to `research/ledger/artifacts/<paper-id>/<inputDigest>/reading-packet.json`, and only then reconciles that paper's ledger. A rerun skips a fully matching paper, reconstructs a missing packet, or repairs a stale ledger pointer from the already written artifacts. The 30 frozen Mini notes remain their editorial reference fixtures and are tracked through the same paper ledgers. Each Mini seed is additionally bound to its canonical `mini-atlas/research/pages/Pxxx.json` path and the SHA-256 of those exact file bytes; parsed-equivalent rewrites, moved files, duplicate source membership, and note/page/PDF drift therefore fail closed instead of silently changing the frozen reference.

`build-model-notes.mjs` validates the complete authored note set and writes `data/notes/release-candidate/model_notes.json` and `.js`; it does not overwrite the public pair. Candidate creation reads the recorded `extractQa` state for every paper. Generated non-Mini notes permit only the terminal `complete` or explicit `needs_review` states, preserving the latter through all eight provenance fields rather than laundering it into a clean extraction; frozen Mini fixtures remain strict `complete` references. A `needs_review` paper cannot use the general heuristic author: it requires a paper-specific, independently reviewed map at `research/model-note-safe-maps/v1/<paper-id>.json`. Each map binds the current PDF, extracted-page bytes, exact QA decision, and independent visual-scope report; supplies source-literal evidence for the research question, overview, every setup category, method, model, component, applicability condition, and reviewed concept ID; and forbids source equations, symbols, raw math notation, plot geometry, and table-cell structure. `scripts/model-note-safe-map.mjs` deterministically materializes the note and fails closed on a missing, stale, malformed, semantically ungrounded, or tampered map. The independent, hash-bound scope decisions for the current unresolved set are recorded in `research/ledger/extraction-visual-scope-review.v1.json`; that report authorizes prose scope only and cannot change QA disposition, adjudicate a repair, promote extraction, or publish a release.

The downstream policy adapter lives in `scripts/model-note-extraction-qa.mjs`, outside the content-hashed QA producer, so changing release policy does not invalidate the underlying review decisions. A safe-map authoring commit records the map/report bindings in the note envelope, note provenance, content-addressed reading packet, and paper ledger. Reuse reloads the current map and reconstructs the expected note byte-for-byte. Candidate build and candidate audit independently reload and validate the same inputs, compare the authored fields with deterministic materialization, and reject binding or payload drift. `audit-model-notes.mjs --candidate-only` consumes that candidate and commits completed prerequisite audit stages paper by paper. Its candidate report lists every unresolved Extraction QA paper and keeps `releaseBuild` pending for them. Each audit stage is bound to a stable digest of the exact candidate paper object, in addition to its authored-note, PDF, extraction, and concept-registry identities. Before either a successful full-release check or promotion, the audit verifies candidate/manifest and ledger/manifest identity, reruns the full authoring-artifact integrity check, and hashes every current source PDF to confirm its manifest byte length, SHA-256, and `%PDF-` header. Normal public audit/check remains strict: it promotes only when every corpus prerequisite and every Extraction QA checkpoint are release-ready, writing public `data/model_notes.json` first and the browser-consumed `.js` last as the release commit marker. Interruption between those two atomic writes can temporarily leave a mixed pair; rerunning the audit converges both files to the audited candidate. A candidate-only, bounded, or interrupted audit can never promote a partially or previously audited candidate.

Paper failures are isolated. A bad extraction or semantic-validation failure is recorded in the command summary while other workers continue authoring independent papers. The extraction checkpoint normally uses pypdf and deterministically switches the whole document to PyMuPDF when the primary text exhibits systematic font-map substitutions; parser identities, detector code, selected engine, and the review warning are hash-bound in the artifact and paper ledger. The command exits nonzero when any paper is blocked, but every successfully committed paper remains restartable; rerun only the reported IDs with `--paper`, or resume the sorted corpus at an ID with `--from`.

Useful recovery scopes are:

```powershell
node scripts/author-model-notes.mjs --paper <paper-id>
node scripts/author-model-notes.mjs --from <paper-id> --jobs 8
node scripts/audit-model-notes.mjs --paper <paper-id>
node scripts/audit-model-notes.mjs --from <paper-id> --limit 25 --jobs 8
node scripts/corpus-pipeline.mjs status --check-ready
node scripts/corpus-pipeline.mjs status --refresh-summary
npm run check:author
npm run check:checkpoints
npm run check:notes
npm run check:audit
npm run check:ready
```

### Safe parallel rebuilds

Freeze the authoring code, catalog, Mini source, and curated-note inputs before
splitting a full rebuild. Generate one sorted paper-ID manifest from that frozen
state, record its SHA-256, and divide it into exact, nonoverlapping `--from` plus
`--limit` ranges. Do not add, remove, or reorder catalog records while those
ranges are running; regenerate the manifest and ranges if any frozen input
changes.

The checked-in planner creates that frozen manifest and the exact restart ranges:

```powershell
node scripts/plan-model-note-authoring.mjs --batch-size 100 --jobs 8
node scripts/plan-model-note-authoring.mjs --check
```

Its default output is the current frozen V20 plan,
`research/ledger/authoring-plan.release-v20.json`. Use an explicitly new filename
after deliberate authoring-code changes rather than overwriting that release
plan. The plan records the
deterministically sorted non-Mini paper IDs, catalog/Mini/manifest byte
hashes, the transitive local authoring-code hashes, any curated non-Mini note
inputs, every reviewed safe-map byte hash, every visual-scope report referenced
by those maps, and a hash for the complete plan. Each batch records its inclusive
`--from` selector, exact `--limit`, command, forced-retry command, log path,
result path, and exit-code path. `--check` is read-only and fails if any frozen
input, code file, curated input, safe-map/report input, ID membership, order, or batch configuration no
longer matches. Use `--log-dir` to choose a different in-project log directory;
use `--output` only when a separately named plan is required.

The completed V20 release uses the separately named five-batch plan shown
above. Recheck it and its receipts with:

```powershell
node scripts/plan-model-note-authoring.mjs --check --output research/ledger/authoring-plan.release-v20.json
node scripts/run-model-note-authoring-plan.mjs --plan research/ledger/authoring-plan.release-v20.json --check
```

Run the first range by itself. Every authoring invocation refreshes the shared
`data/notes/concepts.json`, so the first successful range is the bootstrap that
establishes the concept-registry version and hash for the frozen run. After that
bootstrap, disjoint ranges may run concurrently against the same code snapshot.
On a memory-constrained workstation, prefer two authoring processes at a time;
each process may still use `--jobs 8` internally. Never overlap paper IDs, and do
not run extraction, inventory repair, release building, auditing, promotion, or
checkpoint repair while parallel authoring processes are writing paper ledgers.

Persist each range's command, stdout/stderr, and exit code. Accept a range only
when its selected count equals its planned count and it reports no blocked,
stale, or failed paper. If a process is interrupted or its receipt is missing,
rerun that exact batch through `run-model-note-authoring-plan.mjs`; individual
note and packet files use atomic replacement, and already-current checkpoints
are reused. Use a forced retry only after deliberate source/code review. If
authoring behavior changes after a production failure, bump the
authoring version, stop the current wave, and rerun every range from the frozen
manifest because source bytes alone do not identify a code-behavior change.

After all ranges finish, explicitly reconcile the frozen Mini papers, run the
full non-writing authoring and checkpoint checks, then build and audit the
release candidate:

```powershell
npm run author:mini
npm run check:author
npm run check:checkpoints
npm run build:notes
npm run check:notes
npm run audit:candidate
```

This ordering matters immediately after the Mini reading-audit policy changes:
the read-only checkpoint check correctly remains stale until `author:mini` has
rebound the frozen `sectionIndex` and `sourceReading` stages. Only one
build/audit sequence may run at a time. Public promotion remains a later,
separately authorized operation.

A changed Mini editorial fixture fails closed instead of silently replacing its
content-addressed note identity. After reviewing a deliberately scoped Mini
edit, accept and rebind only that paper with:

```powershell
node scripts/author-model-notes.mjs --reconcile-mini --paper <paper-id> --accept-mini-editorial-update
```

The canonical paper ledger retains the previous and accepted note SHA-256
values in `noteAuthoring.editorialUpdateHistory`. Dry runs remain write-free,
and later restarts no longer need the acceptance flag once the exact fixture is
current. The operation does not build or promote candidate/public data.

When npm is unavailable, run the exact aggregate readiness gate directly with Node:

```powershell
node scripts/corpus-pipeline.mjs inventory --check --jobs 8
node scripts/extraction-qa.mjs review --check --jobs 8
node scripts/author-model-notes.mjs --reconcile-mini --jobs 8 --check
node scripts/model-note-checkpoints.mjs --check
node scripts/build-model-notes.mjs --check
node scripts/audit-model-notes.mjs --jobs 8 --check
node scripts/corpus-pipeline.mjs status --check-ready
```

The inventory check requires the pinned extraction environment. Set `ATLAS_PYTHON` or pass `--python <path>` to its command when that Python is not on `PATH`.

`--check` modes are read-only. `check:checkpoints` is intentionally scoped to `sectionIndex`, `sourceReading`, and `noteAuthoring` artifacts, including the frozen Mini reading artifacts; a current `needs_review` binding is valid for those internal artifacts and the output does not claim release readiness. `check:ready` composes source/PDF inventory, authoring-artifact, candidate-build, audit/public-release, and canonical-stage readiness checks, and therefore remains strict. `scripts/audit-model-notes.mjs` records quotation, formal-policy, schema, content-maturity, source, and release checks independently in each paper ledger; interrupted or bounded audit runs are safe to repeat. Content-audit warnings preserve unresolved extraction or authoring limits and never claim an independent scholarly review.

Ordinary corpus `status` remains informational and exits successfully when ledger structure is sound, even if work remains. Its `structurallyConsistent` field covers manifest/ledger identity; `releaseReady` requires every canonical stage. Use `status --check-ready` when incomplete release state must produce a nonzero exit. `status --refresh-summary` rebuilds `research/ledger/summary.json` from paper ledgers without modifying them.

## English metadata normalization

Run:

```powershell
node scripts/sanitize-english-metadata.mjs
node scripts/sanitize-english-metadata.mjs --check
```

The sanitizer removes only the known Chinese `title/abstract inferred` suffix from `topics`, `topic_details`, and `field`. It fails closed if other Chinese text remains in those fields. A successful write also regenerates `data/atlas_articles.js` from the sanitized JSON using the same renderer as `scripts/build-data.mjs`. The operation is idempotent and does not change `generated_on`.

## Content-addressed reading packets

`scripts/model-note-checkpoints.mjs` exports restart helpers for the source-reading stage. A caller supplies an input identity containing:

- paper ID;
- source PDF SHA-256;
- extracted-pages SHA-256;
- editorial-contract digest;
- reading-packet version.

`readingPacketInputDigest` binds those inputs. `ensureReadingPacket` stores the deterministic packet at:

```text
research/ledger/artifacts/<paper-id>/sourceReading/<artifact-sha256>/reading.json
```

That path is the reusable helper's content-addressed layout. The production full-corpus authoring command stores its richer combined packet at `research/ledger/artifacts/<paper-id>/<inputDigest>/reading-packet.json`; both forms are digest-bound and restart-safe.

If the ledger, section index, and artifact match, the builder is skipped. If either ledger pointer is stale but an intact matching artifact exists, the `sectionIndex` and `sourceReading` stages are recovered without rebuilding. If the referenced artifact is missing or corrupt and no other verified matching artifact is recoverable, the builder runs and the hash-addressed artifact and both ledger pointers are repaired. The helper reloads the ledger and verifies the PDF and extraction hashes before committing the stages.

Reading packets should record actual section page ranges, pages read, sections read or skipped, review anchors used or rejected, formula/render candidates, exact quotation candidates, and extraction-quality flags. The helper guarantees checkpoint integrity; it does not declare heuristic section selection to be substantive source reading.

## Read-only integrity check

Run:

```powershell
node scripts/model-note-checkpoints.mjs --check
node scripts/model-note-checkpoints.mjs --check --paper <paper-id> --json
```

The authoring check first compares the generated concept registry byte for byte with the registry implied by the current Mini concepts, additional concepts, and authoring version. The checkpoint check recomputes note-file hashes and compares the note envelope with its ledger, PDF, extraction artifact, input digest, concept-registry binding, and authoring version. For generated notes it also hashes the extracted-pages bytes and verifies the reading packet's authoring and extraction-QA identities. It cross-checks the section-index pointer against the reading checkpoint, validates both content-addressed reading packets and frozen Mini source-reading artifacts—including the canonical frozen path and raw-byte page hash—and treats missing stage pointers as stale. Neither check rewrites project state. Audit and release readiness belong to `check:audit` and the aggregate `check:ready`, not to this artifact-only command.

The intended dependency order is:

```text
inventory -> extraction -> extractQa
extraction + authoring inputs -> sectionIndex + sourceReading + noteAuthoring
all note sources -> complete release candidate
noteAuthoring + exact candidate paper
  -> quoteAudit + formulaAudit + schemaValidation + contentAudit
  -> sourceAudit
candidate + all authoring checkpoints + all audits
  -> public promotion -> releaseBuild
```

Later stages digest immutable upstream artifacts rather than merely reusing a paper or PDF identifier. Inventory preserves completed stages when those upstream identities are unchanged and invalidates every dependent stage, including `sourceAudit` and `releaseBuild`, after real drift. Candidate generation requires exact corpus coverage; public promotion additionally requires every audit stage to be current for that paper's exact candidate digest and every authoring checkpoint to pass.

## Tests

The focused tests use temporary fixture directories and do not generate corpus notes:

```powershell
node --test tests/english-metadata-sanitizer.test.mjs tests/author-model-notes-curated-reconciliation.test.mjs tests/author-model-notes-safe-map.test.mjs tests/model-note-safe-map.test.mjs tests/model-note-needs-review-safe-mode.test.mjs tests/model-note-checkpoints.test.mjs tests/model-note-release-audit.test.mjs tests/model-note-authoring-plan.test.mjs tests/corpus-pipeline.test.mjs
```

They cover idempotent metadata cleanup, stale snapshot detection, content addressing, skip-on-match, ledger recovery, corrupt-artifact recovery, Mini reading verification, note and concept-registry hash verification, deterministic authoring selectors, paper-isolated authoring failure, unchanged-inventory preservation, dependency invalidation, canonical missing-stage counts, summary refresh, and explicit nonzero readiness checks.
