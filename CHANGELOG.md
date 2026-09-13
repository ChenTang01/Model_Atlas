# Changelog

This file records user-visible changes and release maintenance. Project versions follow `MAJOR.MINOR.PATCH`; research producer labels such as V20 have a separate meaning. Before this history, the repository used unversioned `beta` commits. No earlier dated releases are implied here.

## [1.0.0] - Unreleased

Prepared initial maintained baseline. The package already identifies itself as `1.0.0`; this section does not claim that a Git tag or GitHub Release has been published. The reader retains its Beta status.

### Included baseline

- Explore 1,653 papers from 2016–2026 across Management Science, Manufacturing & Service Operations Management, Information Systems Research, and Marketing Science.
- Browse eight subject lenses, search field-level evidence, use Panels, and read structured notes for every paper. Thirty Mini Atlas notes remain frozen editorial reference fixtures.
- Run the static application from HTTP, the `/Atlas/` project path, or a direct-file snapshot, with local MathJax assets.
- Resume inventory, extraction QA, authoring, candidate auditing, and explicit model-note promotion with per-paper identity checks.

### Open-source maintenance

- Add an MIT license for original project code and materials, with third-party papers excluded from that grant.
- Make third-party paper PDFs, full-text extractions, and source-page images local-only research inputs. Public artifacts still require an appropriate redistribution basis.
- Remove 1,653 PDFs and 30 historical full-text extraction caches from published branch history on 2026-09-13 while preserving the local source library and a local history backup.
- Document the [public demo](https://chentang01.github.io/Atlas/), contribution workflow, versioning, release checklist, and actionable roadmap.
- Add issue and pull-request templates, public-clone CI, fixture-based research unit checks, and an explicit local full-research validation command.
- Add tag/package/changelog validation and a tag-triggered workflow that creates GitHub Release drafts without file attachments; publication remains a separate maintainer action.

### Known limitations

- Automated extraction and content audits do not constitute independent scholarly validation. Check a paper's original source before relying on a model note.
- The full research validation requires separately acquired local source PDFs and extraction artifacts; a passing public CI run covers a narrower, documented set of checks.
- Repository history and release archives must be verified free of local-only source material before publishing this release.
- No documented redistribution permission has been provided for retained publisher abstracts and source excerpts. Existing source-derived notes remain unchanged and flagged for [review in issue #1](https://github.com/ChenTang01/Model_Atlas/issues/1). Keep this release unpublished or in draft until that review is resolved; this changelog does not assert that existing derived artifacts are legally cleared.
