# Contributing to Atlas

Atlas welcomes fixes to the explorer, reproducible research tooling, and carefully sourced catalog and model-note corrections. Start with an existing [issue](https://github.com/ChenTang01/Model_Atlas/issues), or open one with a concrete example and expected outcome. The [roadmap](ROADMAP.md) lists work that still needs implementation and review.

## Local development

Use Node.js 22 or newer and Git. The application and Node test suite have no npm dependencies to install.

```sh
git clone --depth 1 https://github.com/ChenTang01/Model_Atlas.git
cd Model_Atlas
npm run check:public
npm start -- --base-path /Atlas
```

Open `http://127.0.0.1:8000/Atlas/`. For a direct-file preview, open `index.html`; keep its sibling `assets/`, `data/`, and `vendor/` directories. Verify both HTTP and direct-file behavior when changing data loading. Check the `/Atlas/` base path when changing asset URLs.

`npm test` runs the public website tests, research unit tests that use redistributable fixtures, and publication-boundary regression tests. `npm run check:public` also checks the publication boundary, JavaScript syntax, and the generated article snapshot. These checks run in GitHub Actions on pushes and pull requests with Node.js 22 and 24. They do not require the local paper library or prove the full source-to-release research audit passed.

## What belongs in a contribution

- Submit original code and materials, plus metadata and structured artifacts that you have the right to distribute. Contributions of original work use the project's [MIT license](LICENSE).
- Keep source PDFs under the ignored local `paper/` directory. Never commit, force-add, attach to an issue, include in a release, or upload to CI any third-party paper PDF, full-text extraction, or source-page image. This policy also covers extraction fixtures and copies with different filenames or extensions.
- Third-party papers and any material retained from them keep their applicable rights and terms. The project's MIT license does not relicense them. Publisher abstracts, quotations, and other retained source excerpts require a documented lawful redistribution basis before addition or release; attribution alone does not establish permission. Resolve uncertain material by obtaining the required permission or removing/replacing it with distributable content.
- Report a paper correction with its DOI or Atlas ID, the affected note field, page/section references, and an explanation in your own words. Link to the publisher or other authorized source. Do not attach the paper or copied page images.
- Use synthetic or otherwise redistributable fixtures for automated tests. Keep local extraction outputs, rendered source pages, credentials, and research scratch files out of Git and GitHub Actions artifacts.

Before committing, inspect `git diff --stat`, `git diff --cached --stat`, and the actual changed contents. Ignore rules and automated checks are safeguards; they do not establish redistribution rights.

## Code and data changes

Follow the surrounding native JavaScript module and formatting conventions. Keep static asset paths relative and preserve offline behavior. Add focused regression coverage when fixing behavior or changing a pipeline identity, validation rule, or release gate.

`data/atlas_articles.json` is the canonical article index. After an intentional edit, run `npm run build:data` and include its generated `data/atlas_articles.js` sibling. Do not manually edit generated snapshots or the public `data/model_notes.{json,js}` pair.

For model-note corrections, edit the appropriate authoring input and use the research workflow below. Preserve paper IDs, DOI identity, source attribution, explicit unresolved fields, and the 30 frozen Mini Atlas editorial fixtures. A deterministic audit result is not independent scholarly verification.

Include the problem, resulting behavior, relevant test results, and any unresolved limits in your pull request. For user-visible or released data changes, add a short entry to [CHANGELOG.md](CHANGELOG.md). Screenshots of the Atlas interface can help explain UI changes; omit source-paper pages and local-only material.

## Research workspace and promotion

The full pipeline requires a separately acquired, authorized local paper library matching `research/corpus/manifest.v1.json`, plus local extraction artifacts. These inputs are excluded from the current checkout; do not recover them from the legacy Git history awaiting cleanup. Install the pinned extraction runtime in a local Python environment:

```sh
python -m pip install -r requirements-extraction.txt
npm run corpus:status
node scripts/corpus-pipeline.mjs inventory --check --jobs 8
```

Set `ATLAS_PYTHON` to that environment's Python executable if it is not on `PATH`. Follow [research/README.md](research/README.md) for inventory, bounded extraction, QA/adjudication, Mini reconciliation, authoring, and restart behavior. Keep source-derived text and images local throughout. Do not bypass a failed or stale source identity, QA decision, or audit prerequisite to make a release pass.

For a model-note release, complete the upstream stages, then:

1. Run `npm run build:notes` to generate the candidate under `data/notes/release-candidate/`.
2. Run `npm run audit:candidate` to audit those exact candidate bytes without promoting them.
3. Benchmark the candidate with `npm run benchmark:full -- --model-notes-dir data/notes/release-candidate --playwright-module <local-module-path> --browser-executable <local-browser-path> --runs 3`. Review desktop and mobile results, and share only a redistributable metrics summary.
4. Inspect the candidate diff and source evidence. After the maintainer's release decision, run `npm run audit:notes` to promote the candidate. This command writes the public pair; `audit:candidate` does not.
5. Run `npm run check:research` in the hydrated local workspace. It runs the full research test suite and the seven-stage `check:ready` gate, including live PDF identities, Extraction QA, authoring checkpoints, candidate/public consistency, and audit readiness. Run `npm run check:public` on the resulting public tree as well.

Use `npm run test:research` for the complete test suite alone. Report exactly which checks ran and their exit results in the PR; do not describe public CI success as a full research validation. Attach concise, reviewed status/count/hash summaries when useful, never PDFs, extracted pages, or raw source-bearing logs. If inputs change after candidate audit or benchmarking, rebuild and recheck the affected stages before promotion.

## Versions and releases

The version in `package.json` is the project release version. Use `vMAJOR.MINOR.PATCH` Git tags: increment patch for compatible corrections, minor for compatible capabilities or corpus additions, and major for incompatible public schema or supported behavior changes. Internal authoring versions such as V20 identify research producers and are separate from project release versions. The interface may retain its Beta label while research content continues to be reviewed.

The [Draft release workflow](.github/workflows/release.yml) runs on `v*` tag pushes. It requires `check:public` and `check:release`, then creates a **draft** GitHub Release from the matching changelog section without uploading file attachments. It leaves an existing release unchanged. Draft creation is not permission to publish: the maintainer must resolve release blockers, including the [distribution review](https://github.com/ChenTang01/Model_Atlas/issues/1).

Before publishing a release:

1. Update `package.json` and the matching changelog section with the version, release date, changes, and known limitations. Replace the prepared section's `Unreleased` date with a heading in the exact form `## [X.Y.Z] - YYYY-MM-DD` before tagging, then run `npm run check:release -- vX.Y.Z`. The tag, package version, and dated changelog section must agree. A dated draft entry does not establish public release status.
2. Require successful public CI for the intended commit. For model-note or corpus changes, record the candidate audit/benchmark review and a successful local `check:research` for the final promoted artifacts.
3. Review the exact commit and distributable files. Verify the repository history and release/source archives contain no third-party PDFs, extracted full text, or source-page images; a clean working tree alone is insufficient. Resolve the rights/provenance review for retained abstracts and excerpts before publishing. Keep a proposed release as a draft while that review is unresolved.
4. Create the matching tag from that reviewed commit and inspect the workflow-generated draft. Use the changelog for release notes, state the corpus count, and link the [public demo](https://chentang01.github.io/Atlas/). Publish the draft only after the checks and rights review are resolved. Include only reviewed original or redistributable assets; do not upload the local research workspace.
5. Smoke-test the deployed `/Atlas/` homepage, search, note reader, DOI links, and direct-file snapshot. Link follow-up defects to the affected release.
