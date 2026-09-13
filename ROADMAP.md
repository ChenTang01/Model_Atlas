# Atlas roadmap

The current baseline explores 1,653 papers with structured notes and a restartable research pipeline. The work below is planned, not a claim of completed review or a delivery schedule. Track implementation and evidence in [GitHub issues](https://github.com/ChenTang01/Model_Atlas/issues); a milestone is complete only when its acceptance criteria are met.

## First priority: distribution and provenance review

[Track issue #1](https://github.com/ChenTang01/Model_Atlas/issues/1).

Review retained public artifacts field by field, including abstracts, quotations, imported notes, and bundled dependencies. The current catalog and model notes contain source abstracts and excerpts, and no documented redistribution permission has been provided for those fields. They remain unchanged pending this review; generated JSON is not evidence of permission. Record the source and redistribution basis for retained third-party material, identify uncertain fields, and resolve them through permission, removal, or replacement with distributable content. Keep the evidence register limited to citations and original review notes; PDFs, extracted full text, and source-page images remain local. Close this work after the review covers every public artifact class, uncertain material has been resolved, and the publication checks cover any newly identified sensitive paths. This review blocks publication of the prepared initial release.

## Independent scholarly review pilot

[Track issue #2](https://github.com/ChenTang01/Model_Atlas/issues/2).

Define a review record separate from deterministic extraction and content-audit statuses. Pilot it on at least one note from each of the four journals and each authoring provenance class, allowing the same note to cover multiple categories. Review research question, assumptions, timing, formulas, variants, and conclusions against authorized local sources. Record reviewer, note/source hashes, findings, and unresolved limits using original prose and page references. Publish reviewed coverage without presenting unreviewed notes as independently validated.

## Repeatable performance budgets

[Track issue #3](https://github.com/ChenTang01/Model_Atlas/issues/3).

Use `scripts/benchmark-full-atlas.mjs` to record desktop and `mobile390` baselines for the same candidate and runtime, with at least three runs per profile. Document startup, search, Panels, note/math readiness, and payload metrics. Define measured budgets and a comparison command with a nonzero result for a deliberate regression. Keep metrics bound to candidate hashes and runtime details; do not add paper data to benchmark artifacts.

## Browser accessibility regression coverage

[Track issue #4](https://github.com/ChenTang01/Model_Atlas/issues/4).

Add browser tests for keyboard-only subject/search navigation, paper opening and focus restoration, zoom controls, Escape/Back behavior, reduced motion, and the Canvas-unavailable Panels fallback. Exercise a narrow mobile viewport and the `/Atlas/` deployment path. Make the tests runnable from a public clone and integrate them into CI using redistributable fixtures. Document any remaining manual screen-reader and touch checks.
