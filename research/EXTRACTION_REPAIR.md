# Historical extraction repair candidates

> Historical pre-retirement record (2026-09-12). The paper list and counts below
> do not describe the current 1,660-paper corpus.

This document records the fail-closed recovery plan that applied to 16 papers
whose required visual Extraction QA pages exposed substantive text, formula,
layout, table, or figure loss. It is retained as a historical design record, not
as an acceptance list or live work queue.

As of 2026-09-12, the authoritative Extraction QA set contains 1,674 current
automated decisions: 1,657 automated `complete` decisions and 17 automated
`needs_review` decisions. `doi-10-1287-mksc-2019-1171` subsequently passed its
required page 1/page 10/page 19 comparison and has a hash-bound accepted manual
adjudication. The 16 papers below were unresolved at that snapshot; none was
represented as release-ready at that time.

## Engine comparison

The local comparison used pypdf 6.14.2, PyMuPDF 1.28.2, and pypdfium2 5.13.0,
with Poppler `pdftoppm` 26.07.0 for rendered-page evidence. No installed engine
can replace the selected extraction for any of the 16 papers and safely support
automatic acceptance. A clean character count, a long extraction, or agreement
between engines is not sufficient: multiple engines can make the same font-map
error, and text extraction cannot represent chart geometry.

| Paper ID | Verified blocker | Candidate recovery path |
| --- | --- | --- |
| `doi-10-1287-isre-2024-1518` | Single-column block order, out-of-bounds text, and `c` rendered as `!` | CropBox clipping, geometry ordering, and resource-level font mapping |
| `doi-10-1287-mksc-2017-1035` | `eta` rendered as `⌘`, `theta` as `✓`, and invalid code points | Reviewed font-program/glyph-code map |
| `doi-10-1287-mksc-2017-1071` | PUA/control characters and damaged comparison operators | Reviewed font mapping; image evidence for every uncovered formula |
| `doi-10-1287-mksc-2019-1201` | Column/Figure 2 caption order and missing axes, threshold, and geometry | Column-aware ordering plus a figure-crop evidence sidecar |
| `doi-10-1287-mksc-2022-1424` | Control characters, PUA glyphs, and incorrect minus signs | Reviewed font mapping and formula-by-formula visual comparison |
| `doi-10-1287-mnsc-2015-2189` | Severe mathematical corruption in all compared engines | Formula-region images and exact reviewed transcription |
| `doi-10-1287-mnsc-2015-2391` | Control characters, PUA glyphs, and incorrect operators | Formula-region images and exact reviewed transcription |
| `doi-10-1287-mnsc-2018-3152` | Equals signs and calligraphic `U`/`X` are damaged | pypdf glyph-name normalization plus a reviewed font map |
| `doi-10-1287-mnsc-2018-3230` | Equals, summation, braces, and calligraphic letters are damaged | PyMuPDF layout combined with pypdf glyph data and a reviewed font map |
| `doi-10-1287-mnsc-2020-3933` | Extensive PUA/control characters make formulas untrustworthy | Formula-region images and exact reviewed transcription |
| `doi-10-1287-mnsc-2022-4310` | Equals, union, and proof-square glyphs are wrong | Resource-level map, including reviewed mapping for the proof font |
| `doi-10-1287-mnsc-2023-00994` | Minus, division, and overbar information is lost | Font/combining-mark map with visual checks for every failed formula |
| `doi-10-1287-mnsc-2023-4810` | Negative chart ticks and boxplot geometry are lost | Keep readable prose and bind figure crops as visual evidence |
| `doi-10-1287-msom-2019-0815` | A mathematical font resource maps equals signs to `!`; its zero-width negation slash is extracted before, rather than over, the equals glyph | Exact resource/code/font-stream maps plus occurrence-bound composite-glyph recovery; then full visual QA |
| `doi-10-1287-msom-2021-0969` | The same visible characters represent epsilon, phi, inequalities, division, and equals in different resources | Per-resource/per-code multi-font mapping |
| `doi-10-1287-msom-2021-0970` | Equals, decimal points, and spanning-table order are damaged | Font mapping plus spanning-table geometry ordering |

For `doi-10-1287-msom-2019-0815`, the first mechanical candidate must bind the
specific mathematical resource and original character code. pypdf reports code
33 as `/equals`, and the embedded font stream SHA-256 is
`2280410f95eb3f76b1ccc0a7530f4522e3e276335381467935db53fbfbb0a2ea`.
The visible character `!` and the font name alone are explicitly insufficient
mapping keys.

The v2 candidate mechanism also handles a narrowly defined composite case. A
composite overlay is accepted only when its spec lists every source occurrence,
binds both component four-tuples, repeats the exact six-value text matrices,
requires single-byte `Tj` operands, proves the overlay has zero advance, and
keeps the baseline/origin deltas inside declared bounds. A diagnostic private-
use CMap identifies each source event and renderer geometry but is never emitted
as candidate text. The final edit is anchored to an exact, short pre-repair text
sequence. For this paper, three `/negationslash` + `/equals` pairs meet those
conditions and become `≠`; a missing, extra, moved, reordered, or free-standing
slash fails closed. The candidate still has `promotionEligibility: false` and
remains unresolved until all required Poppler sidecars are present and accepted.

## Candidate checkpoint contract

Each engine or repair result is written under a content-addressed candidate
path. It must not overwrite the current `pages.json`, text artifact, Extraction
QA decision, adjudication, or production ledger.

The candidate input digest binds at least:

- source PDF SHA-256;
- current extraction-pages SHA-256 and automated QA decision SHA-256;
- extractor name/version and extraction/repair code SHA-256;
- layout-policy SHA-256 and glyph-map SHA-256;
- visual-evidence manifest or adjudication SHA-256.

Every character replacement or verified no-op records page, bounding box, PDF
font resource tag, font-program SHA-256, original character code or glyph name,
and final Unicode. Composite provenance additionally records both component
events, content-operator indices, text matrices, zero-width evidence, text and
render offsets, the exact source-text range, and the bounded origin delta.
The mapped entry in `glyphEvents` and its corresponding
`mappedGlyphProvenance` entry both carry the same renderer-character bounding
box plus text and render offsets; unmapped observations are not represented as
completed replacements.
The ordinary resume path verifies the input digest and every artifact/sidecar
hash before skipping work. Missing, stale, or modified artifacts are recomputed
or rejected; files are committed with a temporary write and atomic rename.
Paper-scoped locks or compare-and-swap checks prevent overlapping workers from
committing the same paper and digest concurrently.

The implemented lock is scoped to `(paper ID, repair input digest)`. Its full
owner record is fsynced to a temporary file and atomically published with a
create-if-absent hard link. A second writer either observes byte-identical
completed candidate files or fails closed on the live owner. A lock is recovered
only when its canonical owner record is valid, the hostname matches, and the
recorded PID is confirmed not to be alive. Recovery first hard-links the old
lock to a persistent content-addressed tombstone; that tombstone is the CAS that
prevents a competing recovery process from removing a newly acquired lock.
Invalid locks and locks from an unprobeable host are never guessed stale.

After acquiring the lock and immediately before writing, the builder rereads
and revalidates the manifest record, source PDF bytes, production pages bytes,
automated Extraction QA decision, repair specification, Python/parser runtime,
and repair script/worker code. Any difference in those identities changes the
input digest or code hash and fails closed. The candidate JSON remains the last
commit marker, so an interrupted write is reconstructable without treating a
partial directory as current.

## Independent repair adjudication checkpoint

`scripts/extraction-repair-adjudication.mjs` is a separate, fail-closed layer;
it does not alter the candidate builder or the existing Extraction QA module.
Its `inspect` and `check` commands are read-only. `check` additionally requires
one valid terminal adjudication, whereas `inspect` may report
`eligible_for_manual_adjudication` when no adjudication has yet been recorded.
The only write command is the explicit `adjudicate` command, which requires a
stable reviewer ID, reviewer name, page-specific findings, rationale, and an
independence attestation.

The adjudication input digest binds the source PDF; the current production
pages and text; the automated Extraction QA decision; the repair specification;
all four candidate files (`candidate.json`, `pages.json`, `text.txt`, and
`glyph-provenance.json`); and every required visual sidecar and crop. It also
binds the candidate layout/glyph policies and producer hashes. An accepted
record must contain a distinct, concrete finding for every required page, and
the adjudicator cannot be any reviewer named by the visual sidecars. A changed,
missing, noncanonical, or hash-mismatched dependency makes the record invalid.

Records are immutable and content-addressed at
`research/ledger/extraction-repair-adjudications/<paper-id>/<adjudication-input-digest>/<record-digest>.json`.
Publication fsyncs a temporary file and uses create-if-absent hard linking. A
paper/input-scoped owner lock serializes the precommit evidence reread and
record-chain comparison. An interrupted same-host lock can be recovered only
when its canonical owner PID is demonstrably dead; invalid and remote-host
locks are never guessed stale. Corrections do not overwrite records: they must
name the one current terminal record in `supersedes`, with both its file SHA and
record digest. Missing targets, forks, cycles, or ambiguous terminals fail
closed. Even a valid accepted adjudication continues to report
`promotionEligibility: false`; production promotion remains a separate future
operation.

## Transactional production promotion

`scripts/promote-extraction-repair.mjs` implements the separate promotion
operation. It accepts only the current terminal `accepted` adjudication for the
current production extraction. Before it can prepare anything, an operator must
explicitly issue a short-lived, content-addressed quiescence token with
`quiesce --attest-writers-stopped`. That attestation means inventory, authoring,
audit, and other paper-ledger writers have been stopped for the operation. It is
not a global process lock. The promotion also takes the ordinary paper
extraction claim and compares the current ledger SHA immediately before every
ledger replacement. Until all ledger writers use one shared lock protocol, the
operator attestation is a required fail-closed precondition, not a claim of
cross-writer exclusion.

The promotion input digest binds the source PDF identity; the exact before
ledger and extraction stage; the accepted adjudication; its automated QA,
repair-spec, candidate, visual-sidecar, and crop bindings; and the quiescence
token. `prepare` rehashes that complete chain, writes the standard production
`pages.json` and `text.txt` bundle under
`research/ledger/artifacts/<paper-id>/<promotion-input-digest>/`, and records
immutable before, prepare, and planned-after transaction objects. It never
changes the paper ledger.

`commit` reloads and rehashes every bound input and performs a ledger-SHA
compare-and-swap. Immediately before its first ledger replacement it also
requires that the accepted adjudication is still current. Its single atomic
ledger replacement installs the promoted extraction, rebuilds
the legacy `extractQa` stage as `needs_review`, and invalidates exactly these
nine downstream stages: `sectionIndex`, `sourceReading`, `noteAuthoring`,
`quoteAudit`, `formulaAudit`, `schemaValidation`, `contentAudit`, `sourceAudit`,
and `releaseBuild`. Those stages must be rerun from their normal restartable
entry points; promotion never represents their old results as current.

Transaction evidence is retained at
`research/ledger/extraction-repair-promotions/<paper-id>/<promotion-input-digest>/`
as content-addressed `before`, `prepare`, `after`, `commit`, and `rollback`
records. Writes use fsynced temporary files plus exclusive publication. If a
process stops after the ledger replacement but before its commit record,
rerun `commit` with the same promotion digest and prepare-bound token; recovery
recognizes the exact after-ledger hash and only publishes the missing record.
If a one-shot `promote` command stops at that boundary, use `commit` rather than
rerunning `promote`, because the production base has already changed.

`rollback` requires an existing commit record and a new active quiescence token
bound to the promoted ledger. It restores the exact byte-for-byte before-ledger
snapshot in one atomic replacement and leaves every output and transaction
record in place for audit. A crash after restoration is resumed with the same
rollback token; `status` and `check` are read-only and distinguish prepared,
ledger-committed-but-unrecorded, committed, rolled-back, and unknown-CAS states.
Neither promotion nor rollback deletes artifacts or silently guesses which
ledger version should win.

## Promotion gate

A repair candidate remains `NO-GO` unless all of the following hold:

1. No unmapped glyph, C0/C1 control, PUA, replacement character, or raw glyph
   name remains in an affected mathematical span.
2. Every replacement has exact resource/code/font-program evidence.
3. Operators, subscripts, superscripts, delimiters, and formula order have
   page-and-bounding-box evidence.
4. Figure/table evidence binds PDF SHA, page, CropBox, bounding box, DPI,
   renderer/version, crop PNG SHA, labels, signs, axes, and meaningful geometry.
5. The entire document's mathematical and graphical regions have been scanned;
   checking only the three original trigger pages cannot accept a repaired
   document.
6. A new manual adjudication binds the repaired-pages SHA, automated decision,
   glyph-map/layout-policy hashes, and visual evidence.
7. Promotion is a separate explicit operation. Prior artifacts and rejection
   evidence remain recoverable, and any changed binding invalidates downstream
   authoring and release checks.
