# License scope and third-party materials

The [MIT license](LICENSE) covers Atlas's original code, documentation,
original annotations, and original contributions to structured artifacts,
to the extent the contributors hold the relevant rights. It does not
relicense third-party content embedded in or referenced by those artifacts.

## Research papers

Research papers, publisher PDFs, abstracts, verbatim quotations, figures,
tables, and other third-party material retain their respective authors'
and publishers' rights. **The Atlas MIT license does not apply to them.**
A DOI, citation, source hash, or attribution identifies a source; it does
not grant permission to redistribute that source's protected content.

Keep lawfully obtained PDFs in the ignored local `paper/` directory.
Full-text extraction caches, page images, reading packets, repair candidates,
and source-review screenshots also stay local. Do not commit them or upload
them to GitHub issues, pull requests, Actions artifacts, releases, or the demo.
Public users can follow each record's DOI or Google Scholar link to its source.

Only original materials and derived metadata or structured artifacts with a
documented basis for distribution belong in the public repository. Before
adding third-party expressive content, record the source, the applicable
license or permission (or other reviewed basis for distribution), its scope,
and required attribution. A generated or transformed passage is not
automatically original or cleared for redistribution.

The inherited structured release includes publisher abstracts and source
excerpts. Their presence is **not** a representation that they are covered
by MIT or that a complete rights review has occurred. The rights review in
[ROADMAP.md](ROADMAP.md) is a release gate: retain content only where its
distribution basis is established; otherwise remove it or replace it with
original summaries and citation metadata, including generated copies.

## Bundled MathJax

`vendor/mathjax/` is third-party software distributed under its own
[Apache License 2.0](vendor/mathjax/LICENSE), with the bundle details in
[vendor/mathjax/README.md](vendor/mathjax/README.md). Preserve that license
and the bundle's existing notices when redistributing it. Atlas's MIT
license does not replace those terms.
