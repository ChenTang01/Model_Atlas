# Atlas Extraction QA

`scripts/extraction-qa.mjs` is the restart boundary between PDF extraction and source reading. It does not extract papers again and it never treats use of PyMuPDF as proof of success. Each paper is checked against its live PDF, its content-addressed extraction artifacts, and the current QA code and policy before an authoritative sidecar decision can be used downstream.

## Commands

Run from the Atlas project root:

```powershell
node scripts/extraction-qa.mjs status
node scripts/extraction-qa.mjs review --dry-run --jobs 8
node scripts/extraction-qa.mjs review --from <paper-id> --limit 100 --jobs 8
node scripts/extraction-qa.mjs review --paper <paper-id> --force
node scripts/extraction-qa.mjs review --check --jobs 8
node scripts/extraction-qa.mjs adjudicate --paper <paper-id> --accept --reviewer "<reviewer>" --pages <required-pages> --finding "<page>|accept|<reason>|<concrete visual observation>" --rationale "<paper- and page-specific visual comparison>"
```

`--paper` accepts a route ID, DOI, DOI URL, or recorded alias and may be repeated or comma-separated. `--from` is inclusive in deterministic manifest order. `--limit` is applied after selection. A normal review skips current `complete` and `needs_review` automated decisions, but retries a current `failed` decision; `--force` recomputes all selected decisions. `review --check` recomputes the evidence without writing and fails if a decision is missing, stale, tampered with, failed, no longer reproducible, or still awaiting a valid accepted adjudication.

## Per-paper evidence and decisions

The review verifies all of the following before an extraction can be accepted:

- the live source PDF still has the inventoried byte length, SHA-256, and `%PDF-` header;
- the paper ledger, extraction input, and PDF identity agree with the manifest;
- `pages.json` and `text.txt` occupy the exact content-addressed paths recorded by extraction and match their recorded SHA-256 values;
- page IDs are consecutive, page counts match the manifest and ledger, and `text.txt` is an exact reconstruction of `pages.json`;
- parser selection, fallback provenance, extraction policy, extractor code hash, and corruption profiles agree across the artifact and ledger;
- selected text retains adequate total yield, per-page yield, readable-page coverage, alphabetic content, and title-token identity;
- a selected fallback is actually cleaner than the primary result and retains the required fraction of primary text.

Every decision is deterministic JSON at:

```text
research/ledger/extraction-qa/<paper-id>/<qa-input-digest>.json
```

The QA input digest binds the manifest record, source PDF, extraction input, both artifact hashes, the full extraction and legacy-`extractQa` evidence objects, policy hash, and QA script hash. There are no timestamps in an automated decision, so the same inputs produce the same bytes. The decision is discovered from those inputs and is not referenced by a mutable ledger pointer. Review writes only its dedicated sidecar and never rewrites a paper ledger; this removes the ledger read/check/write window that could otherwise overwrite a concurrent pipeline-stage update. If PDF or artifact bytes move during a sidecar commit, the worker reports a conflict and a later rerun safely resumes that paper.

The decision separates provenance from unresolved risk:

- `sourceReasons` retains facts such as `alternate_parser_fallback` even after review;
- `unresolvedReasons` contains only unresolved QA reasons;
- `observations` records nonblocking facts such as residual formula/control glyphs;
- `status: complete` means the extraction passed deterministic QA;
- automated `status: needs_review` preserves a parser warning or high-risk condition and blocks source reading/release until an accepted adjudication is current;
- `status: failed` means identity, hash, artifact, or policy validation failed closed.

Source-reading, authoring, candidate-build, audit, and release gates recompute the decision and bind its input digest, path, and SHA-256. When manual review is required they also bind the automated status plus the adjudication path and SHA-256. Therefore any extraction evidence, rule, automated decision, or adjudication change makes downstream provenance stale even when the effective status remains `complete`.

## Manual adjudication

Only a reproducible automated `needs_review` decision can be adjudicated; a deterministic `failed` decision cannot be waived. Its `manualReviewRequirements` lists every required page and maps each unresolved reason to the pages that expose it. Render those exact source-PDF pages and compare them with `pages.json`/`text.txt`, then supply one `--finding` per required page. A finding uses:

```text
PAGE|accept-or-reject|REASON[,REASON...]|CONCRETE_VISUAL_OBSERVATION
```

The findings must cover every reason/page pair, use distinct page-specific observations, and agree with the overall `--accept` or `--reject` disposition. Reviewer identity and the overall rationale are mandatory. Repeated characters, low-diversity prose, copied page findings, generic phrases such as “looks good,” missing visual-comparison language, missing paper identity, and missing required-page references are rejected.

The adjudication is stored at:

```text
research/ledger/extraction-qa-adjudications/<paper-id>/<qa-input-digest>/<automated-decision-sha256>.json
```

It binds the paper ID and DOI, source-PDF SHA-256, extraction-pages SHA-256, automated decision path/SHA-256/input digest, automated producer code/version/policy, and the original source/unresolved reasons. Missing, malformed, rejected, stale, or tampered adjudication fails closed. Re-running `adjudicate` atomically supersedes an earlier rejection or malformed sidecar at that exact content-addressed path, so recovery does not require manual deletion.

## Fallback policy

`alternate_parser_fallback` alone is not an unresolved defect. It is accepted only after the checks above establish that the selected PyMuPDF output is complete, hash-bound, readable, title-consistent, cleaner than the primary result, and above the extraction retention floor. The fallback remains recorded in `sourceReasons` and the decision evidence.

Parser warnings remain `needs_review`. A primary extraction exhibiting the full legacy font-map signature also remains `needs_review`, even when PyMuPDF produces visibly readable text, because the fallback replaced a systematically decoded character map. Page errors, empty pages, low text yield, failed title identity, low alphabetic content, selected legacy-font corruption, and selected replacement-character counts at or above the extraction trigger likewise remain unresolved or fail closed.

Long lowercase tokens, letter-spaced runs, and encoded control glyphs are recorded as observations rather than automatic failures when all hard checks pass. The anomaly-stratified visual review in `research/extraction-qa-visual-sample.v1.json` shows why: in the sampled extremes, those signals were localized to formulas, plots, URLs, or dense appendices while headings and prose remained visually intact. They must not be used as source-grounded formulas without separate formula verification.

## Historical pre-retirement dry-run result (2026-09-12)

Against the then-current 1,674-record manifest, the full read-only command completed with:

```text
statuses: {"complete":1657,"needs_review":17}
dispositions: {"accepted":1657,"manual_review_required":17}
```

At that snapshot, sixteen papers retained `parser_warning`. One additional paper, `doi-10-1287-mnsc-2023-4810`, retained `primary_legacy_font_map`. The automated decisions for those 17 were subsequently written and all required pages were rendered and compared. `doi-10-1287-mksc-2019-1171` passed and received a content-addressed accepted adjudication; effective status at that point was therefore 1,658 `complete` and 16 `needs_review`. The other 16 visual comparisons exposed substantive extraction loss and remained unresolved rather than being manually waived. This is a historical record from before the corpus retirement; it does not describe the current 1,660-paper corpus.

The deterministic required-page plan for that historical snapshot was:

| Paper ID | Reason | Required PDF pages |
| --- | --- | --- |
| `doi-10-1287-isre-2024-1518` | `parser_warning` | 1, 46, 92 |
| `doi-10-1287-mksc-2017-1035` | `parser_warning` | 1, 12, 23 |
| `doi-10-1287-mksc-2017-1071` | `parser_warning` | 1, 11, 21 |
| `doi-10-1287-mksc-2019-1171` | `parser_warning` | 1, 10, 19 |
| `doi-10-1287-mksc-2019-1201` | `parser_warning` | 1, 12, 24 |
| `doi-10-1287-mksc-2022-1424` | `parser_warning` | 1, 12, 24 |
| `doi-10-1287-mnsc-2015-2189` | `parser_warning` | 1, 11, 22 |
| `doi-10-1287-mnsc-2015-2391` | `parser_warning` | 1, 10, 19 |
| `doi-10-1287-mnsc-2018-3152` | `parser_warning` | 1, 10, 20 |
| `doi-10-1287-mnsc-2018-3230` | `parser_warning` | 1, 12, 24 |
| `doi-10-1287-mnsc-2020-3933` | `parser_warning` | 1, 41, 81 |
| `doi-10-1287-mnsc-2022-4310` | `parser_warning` | 1, 11, 22 |
| `doi-10-1287-mnsc-2023-00994` | `parser_warning` | 1, 14, 27 |
| `doi-10-1287-mnsc-2023-4810` | `primary_legacy_font_map` | 1, 17, 34 |
| `doi-10-1287-msom-2019-0815` | `parser_warning` | 1, 9, 17 |
| `doi-10-1287-msom-2021-0969` | `parser_warning` | 1, 10, 19 |
| `doi-10-1287-msom-2021-0970` | `parser_warning` | 1, 5, 9 |

This table was derived from the code and corpus bytes at that snapshot, not a permanent waiver list or a statement of current corpus membership. Rerun the dry run to obtain the required pages for the live corpus.

## Restart procedure

1. Run `status` to see current, missing, and stale checkpoints.
2. Run `review --dry-run` on the next bounded range.
3. Run the same range without `--dry-run`.
4. If interrupted, repeat the exact command. Current accepted/manual-pending automated decisions are skipped; missing, stale, and failed work is selected again.
5. Continue with the next inclusive `--from` marker, or rerun a reported paper with `--paper`.
6. For each `needs_review` decision, render every page in `manualReviewRequirements.requiredPages`, record reason-specific `--finding` evidence, and run `adjudicate`. A rejected or malformed adjudication can be replaced by rerunning the same command with corrected evidence.
7. Run `review --check --jobs 8` over all papers before source reading or release checks. This passes only when every selected paper has an effective `complete` result.
8. Run `author-model-notes.mjs --reconcile-mini` in bounded batches so all 30 frozen Mini `noteAuthoring`, `sectionIndex`, and `sourceReading` stages bind the same decision/adjudication hashes; repeat the command after interruption and finish with `--reconcile-mini --check`.
9. Run `node scripts/corpus-pipeline.mjs status --refresh-summary` only when the rebuildable summary cache should be refreshed.
