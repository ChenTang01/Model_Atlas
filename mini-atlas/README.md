# Mini Atlas frozen fixture

The main Atlas project in the parent directory is authoritative. This directory is retained only as the frozen Mini fixture used to preserve and verify the original 30-paper sample; it is not a separate maintained website.

The fixture has exactly 36 retained dependency files:

- `data/atlas.json` — frozen Mini catalog (1 file)
- `data/math-notations.js` — frozen presentation notation (1 file)
- `data/notes/batch-a.json`, `batch-b.json`, and `batch-c.json` — structured Mini notes (3 files)
- `research/pages/P001.json` through `research/pages/P030.json` — page-preserving source extractions (30 files)
- `research/sample.json` — frozen sample selection and source hashes (1 file)

This README is retained as documentation and is not included in the 36-file dependency count. All other former Mini site code, generated site data, PDFs, extracted text, tests, vendor assets, and maintenance documents are legacy or duplicated content. Build, author, QA, and serve the main Atlas from the parent project.
