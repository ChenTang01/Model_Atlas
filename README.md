# Model Atlas

**[Open the public demo →](https://chentang01.github.io/Atlas/)** ·
[Contribute](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) ·
[Change history](CHANGELOG.md) · [MIT license](LICENSE)

Explore modeling research as a three-dimensional galaxy on a deep-space field. Each of the 1,653 papers has a stable node in one shared disc; subject lenses change emphasis, not the underlying coordinates. Search returns field-level evidence and qualitative relevance labels, while Panels lists the identical order with filters and progressive rendering. Every paper opens a structured model note with source-linked setup, methods, components, formulations, conditions, symbols, concepts, and explicit model variants when the paper defines them. Thirty frozen Mini Atlas notes remain the editorial reference fixtures; automated note artifacts retain internal provenance and unresolved-source status for audit and restart.

Model Atlas is a standalone project extracted from [Game Theory for Business Research](https://github.com/ChenTang01/Game_Theory_For_Business_Research). It does not require that repository, Jupyter Book, Sphinx, a backend service, or API credentials.

## Run locally

For a quick preview, open `index.html` directly in your browser. The checked-in local snapshot lets the galaxy and search work without an HTTP server. Keep the `assets/` and `data/` folders beside the HTML files.

For development or an HTTP preview:

With Node.js 22 or newer:

```sh
git clone https://github.com/ChenTang01/Model_Atlas.git
cd Model_Atlas
node scripts/serve.mjs
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). `npm start` is an equivalent shortcut if npm is available. There are no packages to install. The public repository contains the Beta website, structured-note release, and research tooling. Source paper PDFs are local only and are not needed to browse the website.

Alternatively, serve the repository with Python 3:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Over HTTP, the browser reads the canonical JSON article index with `fetch`. When opened directly using a `file:` URL, it loads the equivalent generated classic-script snapshot instead, since browsers block local JSON fetches. The static site can also be hosted under a project subdirectory; its app, data, and asset URLs are relative.

### Source corpus

The 1,653 source PDFs belong in the ignored local `paper/` directory. They must not be uploaded to the public repository, Git LFS, issue or pull-request attachments, releases, CI artifacts, or the demo. The current tree and published branch history exclude them. Obtain any papers needed for research through sources you are authorized to use.

Published history was cleaned of source PDFs and historical full-text extraction caches on 2026-09-13. If your clone predates that cleanup, preserve any authorized local research files separately and make a fresh clone before contributing. Do not merge or push the old history or local backup branches; doing so can reintroduce these sources. The separate [rights review for retained abstracts and excerpts](https://github.com/ChenTang01/Model_Atlas/issues/1) remains open.

`research/corpus/manifest.v1.json` records each expected local path, byte length, page count, and SHA-256 so a hydrated research workspace can be verified before source work resumes. Extracted full text and page images also remain local. The project license excludes third-party papers and their protected content; see [license scope and third-party notices](THIRD_PARTY_NOTICES.md).

## Collection

### Navigate the galaxy

Drag to orbit. Scroll over the galaxy to zoom, or use a two-finger pinch on a touch screen. After choosing a subject, the **+**, **−**, and **Fit** controls are also keyboard-accessible; the uncluttered home view and search results keep that toolbar hidden. Magnification ranges from 50% to 350% of the automatically fitted view. **Fit** restores the framing of the current constellation; it does not clear the subject or search. Selecting a new subject or submitting a new search fits that new selection. Browser Ctrl/Cmd-wheel zoom is left untouched. Camera gestures are inactive while a paper or Panels is open.

### Browse by subject

The homepage offers eight subjects: platforms and networks; information and learning; pricing and consumers; supply chains; markets and mechanisms; organizations and finance; innovation and technology; and policy and sustainability. Counts are calculated from the loaded records. Every paper star can be selected from the home galaxy; choosing a subject highlights its papers and focuses their 3D centroid. Select it again, use **All subjects**, or press Escape to return to the whole collection. **View papers** opens the same selection in Panels.

Subject URLs use `?topic=platforms`, with optional `layout=classic` or `paper=...`; refresh and Back preserve the selection. The legacy `view=classic` form remains a supported alias for Panels. Submitting a search searches the whole collection, not only the current subject.

These are deterministic **navigational lenses**, not a new scholarly classification or trained embedding model. Weighted existing topic metadata assigns each paper one primary lens, while its original cross-topic tags remain untouched. A deterministic low-discrepancy sequence spreads all papers across the shared thin disc, with restrained semantic texture that does not create subject containers. Filtering changes the camera and emphasis, never the positions. Distances are exploratory cues, not calibrated similarity scores.

### Coverage

The current snapshot contains 1,653 papers published from 2016 through 2026 in four INFORMS journals:

| Journal | Papers |
| --- | ---: |
| Management Science | 770 |
| Manufacturing & Service Operations Management | 640 |
| Information Systems Research | 129 |
| Marketing Science | 114 |
| **Total** | **1,653** |

All 1,653 papers have structured model notes in the reader. The public release combines 30 frozen Mini Atlas editorial fixtures and 1,623 additional PDF-backed notes: 10 separately curated full-source notes, 292 metadata-enriched legacy maps, and 1,321 generated source-section maps. Their literal anchors, formulas, schema, semantic content, and candidate identity pass the release audit. The 298 model-map and 1,355 literature-record split is retained as catalog provenance, not as a difference in current reader availability. Public article actions are limited to **DOI ↗** and **Google Scholar ↗**; both open only when selected. Merged coverage and audit details are in [docs/collection.md](docs/collection.md).

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Galaxy explorer entry point |
| `about.html` | Standalone collection overview |
| `assets/` | Galaxy renderer, search engine, interaction controller, styles, and icon |
| `assets/topics.js` | Deterministic metadata-based subject index and primary lenses |
| `data/atlas_articles.json` | Complete merged web-record snapshot, schema 3.1 |
| `data/atlas_articles.js` | Generated copy for direct-file preview; do not edit manually |
| `data/model_notes.json` / `.js` | Audited full-corpus structured-note release; the 30 Mini notes remain frozen reference fixtures |
| `paper/` | Ignored, local-only source PDFs; absent from a public clone |
| `research/corpus/manifest.v1.json` | Immutable source identity and corpus-revision manifest |
| `research/corpus/paper-retirements.v1.json` | Hash-bound compact record of the 21 permanently removed papers and their retirement batches |
| `research/ledger/` | Independent, restartable stage state for every paper; copyright-sensitive extracted text and page images remain local and rebuildable |
| `scripts/corpus-pipeline.mjs` | Inventory, status, extraction, retry, and resume commands |
| `scripts/retire-papers.mjs` | Exact, recoverable blocker retirement with a hash-bound sibling quarantine |
| `scripts/prune-workspace.mjs` / `compact-retirements.mjs` | Hash-bound, restartable workspace cleanup and permanent retirement-archive compaction |
| `reference.bib` | 1,653-entry merged bibliography |
| `atlas_game_theory_articles.xlsx` | 1,653-record workbook with evidence level, abstract, review evidence, and local PDF path |
| `atlas_game_theory_preliminary_analysis.md` | Legacy detailed reading notes for the 298 retained deep-model records |
| `docs/collection.md` | Merged scope, coverage, provenance, and audit notes |
| `scripts/serve.mjs` | Dependency-free development server |
| `scripts/build-data.mjs` | Regenerate or check the direct-file snapshot from the JSON source |
| `tests/` | Corpus, asset-path, search, and HTTP checks |

The active JSON, local PDF library, workbook, and bibliography contain 298 retained original model-map records and 1,355 distinct literature records. That split describes input provenance; every record now has a structured note in the public reader. The legacy long-form markdown is limited to the retained model-map subset. Historical `Atlas/...` provenance paths in those notes describe the original workspace; merged record provenance is documented in `docs/collection.md` and `data/imports/atlas_literature_2016_present/`.

## Development

```sh
npm run check:public
node scripts/serve.mjs --port 8080
```

`npm test` runs website and research-pipeline fixture tests in a public clone. `npm run check:public` also checks distributable content, JavaScript syntax, and generated catalog consistency. CI runs these checks on supported Node.js versions. The full research suite, `npm run test:research`, expects locally obtained PDFs and extraction artifacts; `npm run check:research` also runs the existing seven-stage readiness gate. Public CI never downloads the source corpus or promotes model notes.

`npm start -- --port 8080` starts the preview server. To preview the demo's subdirectory hosting, add `--base-path /Atlas` and visit `/Atlas/`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks appropriate to a code, metadata, or research change.

After editing `data/atlas_articles.json`, run `node scripts/build-data.mjs` and include the generated `data/atlas_articles.js` in the same change. Model-note releases follow four gates: author paper-granular notes, build the complete candidate under `data/notes/release-candidate/`, audit that exact candidate, then explicitly promote it. `build-model-notes.mjs` never overwrites the public pair directly. `npm run audit:candidate` completes and records the full candidate audit without touching `data/model_notes.{json,js}`; the normal `audit:notes` command is the separate promotion action. The corresponding `--check` commands and the test suite detect stale artifacts. HTTP errors are reported directly; the local snapshot does not hide failed hosted requests.

No application build step is required. The renderer uses three-dimensional coordinates and perspective projection on Canvas, with cool-white stars, blue-violet dust, a warm core, and restrained selection highlights. Stable low-discrepancy positions distribute papers across one shared disc; semantic offsets add texture without rebuilding subject clusters. Neither search nor subject selection rearranges the papers. The checked-in MathJax SVG bundle loads only when a reader needs notation; the application makes no automatic external runtime requests.

The UI supports full-width Panels, keyboard-accessible search and zoom controls, touch dragging and pinch zoom, reduced motion, and a Panels fallback if Canvas is unavailable.

## Restartable research workflow

The corpus pipeline isolates every paper and stage so interrupted work resumes from verified outputs instead of restarting the corpus. See [research/README.md](research/README.md) for the stage model and commands. Typical checks are:

```sh
node scripts/corpus-pipeline.mjs status
node scripts/corpus-pipeline.mjs inventory --check
node scripts/corpus-pipeline.mjs extract --limit 10
node scripts/corpus-pipeline.mjs extract --retry-failed
```

Writes are validated in a same-directory temporary file and renamed atomically. Stage input digests invalidate only dependent work; a failure remains local to one paper and is visible in its ledger.

## Origin

The initial standalone import uses the Atlas collection from source commit `5401195`, together with the galaxy interface developed afterward in that workspace. The original book retains the bibliography entries its chapters cite and links to this repository; it no longer contains the Atlas app or material library.

## License and maintenance

Atlas's original code and materials are available under the [MIT license](LICENSE). **Third-party papers and their protected content are excluded**, as is separately licensed bundled software. The inherited data includes abstracts and source excerpts whose distribution basis must be reviewed before a new public release; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The [roadmap](ROADMAP.md), [issue tracker](https://github.com/ChenTang01/Model_Atlas/issues), and [change history](CHANGELOG.md) track planned work and versioned changes. [CONTRIBUTING.md](CONTRIBUTING.md) describes contribution checks, local research validation, semantic versioning, and the draft-release review process. The public interface remains Beta; a software version does not certify scholarly validation of its notes.
