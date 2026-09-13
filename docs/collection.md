# Model Atlas: Merged Collection and Audit Notes

Model Atlas is a searchable evidence index of 1,653 modeling papers published from 2016 through 2026 in four INFORMS journals. Each paper has a record in the web interface and a hash-pinned source PDF in the restartable research corpus.

[Launch the full-screen Model Atlas](../index.html)

## Collection coverage

| Journal | Papers |
| --- | ---: |
| *Management Science* | 770 |
| *Manufacturing & Service Operations Management* | 640 |
| *Information Systems Research* | 129 |
| *Marketing Science* | 114 |
| **Total** | **1,653** |

The merged date range is 2016–2026. Dates reflect the publication information available in the source records through the 2026 corpus snapshot. The annual record counts are 76, 86, 94, 102, 99, 132, 208, 173, 166, 213, and 304 respectively for 2016 through 2026.

## Model-note coverage

Every paper has a structured model note in the public reader. The common schema records a research question, overview, model setup, method, explicit variants, substantive components, formulations, symbols, conditions, concept bindings, and page-specific source anchors when the extraction supports them. Thirty frozen Mini Atlas notes are the editorial reference fixtures; the remaining 1,623 notes comprise 10 curated full-source notes, 292 metadata-enriched legacy maps, and 1,321 source-mapped notes. Deterministic content audits report unresolved extraction limits as warnings and do not claim independent scholarly review.

The historical input provenance remains useful but no longer determines reader availability:

| Source provenance | Papers | Original material |
| --- | ---: | --- |
| Retained model-map catalog | 298 | Structured players, timing, actions, information, assumptions, objective, equilibrium, method, and solution fields. |
| Merged literature catalog | 1,355 | Scope-screened bibliographic metadata, abstracts, review evidence, and validated PDF identities. |
| **Total** | **1,653** | Every record is bound to one source PDF in the corpus manifest. |

The [legacy detailed reading notes](../atlas_game_theory_preliminary_analysis.md) document the 298 retained model-map records. `data/model_notes.json` is the canonical audited full-corpus note layer.

## Merge and deduplication

The current screened import manifest contains 1,545 PDF-backed records. DOI, normalized title, and SHA-256 comparison identifies 190 exact overlaps with the retained 298-record model-map catalog. Those copies are deduplicated, leaving 1,355 distinct additions and an active total of 1,653 records.

The active corpus retains 298 model-map records, including 108 outside the incoming manifest. No incoming record was treated as new merely because its PDF filename used different punctuation. Twenty-one later exclusions are recorded in `research/corpus/paper-retirements.v1.json`.

## PDF and record checks

- All 1,545 PDFs in the current import manifest are present; their recorded byte lengths and SHA-256 hashes match the files.
- The 190 overlapping PDFs matched retained Atlas copies by DOI, normalized title, and file hash.
- The 1,355 additions have unique DOI, normalized-title, and file-hash keys within the incoming set and do not collide with existing Atlas PDF filenames.
- All 1,653 web records are bound to files in the local `paper/` corpus by path, byte length, and SHA-256 identity. Together the PDFs contain 35,246 pages and 3,612,048,792 bytes; two retain inventory-time parser warnings for explicit QA handling. Public reader actions are limited to the DOI publisher route and a Google Scholar title search.

PDF validation confirms file identity and availability. Automated model-note audits verify literal anchors, structural formulas, schema, provenance, and deterministic semantic rules; they do not imply independent validation of every result, theorem, or interpretation in an article.

## Reading the Atlas

Search by title, author, DOI, journal, year, abstract language, or available model evidence. The subject index provides broad navigational lenses; distances in the galaxy are aids to exploration rather than calibrated similarity scores or a new scholarly taxonomy.

Open any record to inspect its structured model note and source information. Variant tabs and component cards are shown only when source-grounded content exists; missing setup categories remain explicit unresolved fields rather than fabricated entries. Original catalog provenance remains available independently of the current note schema.

## Reproducible sources

The canonical web dataset is `data/atlas_articles.json`; `data/atlas_articles.js` is its generated direct-file snapshot. The paired audited note release is `data/model_notes.json` and `data/model_notes.js`; JSON is the machine-readable artifact, while the browser always consumes JS, which promotion writes last as the release commit marker. The workbook and bibliography contain all 1,653 active records and retain their input provenance. The legacy long-form reading notes remain limited to the 298 retained model-map records.

Third-party articles retain their original copyright and licensing terms. Model Atlas supplies an index and local research workflow; it does not grant additional rights to the PDFs.
