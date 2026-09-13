((root, factory) => {
  const api = factory();
  root.AtlasAbout = api;
  if (typeof module === "object" && module.exports) module.exports = api;

  if (!root.document) return;
  const start = () => api.hydrate(root.document, root.AtlasDataLoader);
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(typeof globalThis === "undefined" ? this : globalThis, () => {
  "use strict";

  const JOURNAL_CODES = ["mnsc", "msom", "isr", "mksc"];

  function nonnegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be a nonnegative integer`);
    return number;
  }

  function summarizeCatalog(payload) {
    if (!payload || !Array.isArray(payload.records)) throw new Error("Atlas catalog records are unavailable");
    const records = payload.records;
    const detailLevels = { model_map: 0, literature: 0 };
    const journals = Object.fromEntries(JOURNAL_CODES.map((code) => [code, 0]));
    let pdfVerified = 0;
    let minimumYear = Infinity;
    let maximumYear = -Infinity;

    for (const record of records) {
      if (Object.hasOwn(detailLevels, record.detail_level)) detailLevels[record.detail_level] += 1;
      if (Object.hasOwn(journals, record.journal_code)) journals[record.journal_code] += 1;
      if (record.pdf_file && record.pdf_sha256 && /^PDF-verified\b/.test(String(record.review_status || ""))) pdfVerified += 1;
      const year = Number(record.year);
      if (Number.isInteger(year)) {
        minimumYear = Math.min(minimumYear, year);
        maximumYear = Math.max(maximumYear, year);
      }
    }

    const summary = {
      records: records.length,
      model_maps: detailLevels.model_map,
      literature_records: detailLevels.literature,
      pdf_verified: pdfVerified,
      journals,
      minimumYear: Number.isFinite(minimumYear) ? minimumYear : null,
      maximumYear: Number.isFinite(maximumYear) ? maximumYear : null
    };
    if (summary.model_maps + summary.literature_records !== summary.records) throw new Error("Catalog contains an unknown detail level");
    if (Object.values(summary.journals).reduce((total, value) => total + value, 0) !== summary.records) throw new Error("Catalog contains an unknown journal code");

    const audit = payload.audit || {};
    const expected = {
      records: summary.records,
      model_maps: summary.model_maps,
      literature_records: summary.literature_records,
      pdf_verified: summary.pdf_verified
    };
    for (const [key, value] of Object.entries(expected)) {
      if (audit[key] !== undefined && nonnegativeInteger(audit[key], `audit.${key}`) !== value) {
        throw new Error(`Catalog audit.${key} does not match its records`);
      }
    }
    for (const code of JOURNAL_CODES) {
      const audited = audit.journal_counts?.[code];
      if (audited !== undefined && nonnegativeInteger(audited, `audit.journal_counts.${code}`) !== summary.journals[code]) {
        throw new Error(`Catalog audit.journal_counts.${code} does not match its records`);
      }
    }
    return summary;
  }

  function formatCount(value) {
    return nonnegativeInteger(value, "count").toLocaleString("en-US");
  }

  function renderCatalogSummary(document, summary) {
    for (const element of document.querySelectorAll("[data-atlas-count]")) {
      const key = element.dataset.atlasCount;
      const value = key.startsWith("journal:") ? summary.journals[key.slice(8)] : summary[key];
      if (value !== undefined) element.textContent = formatCount(value);
    }
    const minimum = document.querySelector('[data-atlas-year="minimum"]');
    const maximum = document.querySelector('[data-atlas-year="maximum"]');
    if (minimum && summary.minimumYear !== null) minimum.textContent = String(summary.minimumYear);
    if (maximum && summary.maximumYear !== null) maximum.textContent = String(summary.maximumYear);
  }

  async function hydrate(document, loader) {
    const status = document.getElementById("coverageStatus");
    try {
      if (!loader?.loadPayload) throw new Error("Atlas data loader is unavailable");
      const payload = await loader.loadPayload({
        jsonURL: "data/atlas_articles.json",
        snapshotURL: "data/atlas_articles.js"
      });
      const summary = summarizeCatalog(payload);
      renderCatalogSummary(document, summary);
      if (status) {
        status.dataset.state = "current";
        status.textContent = "Counts verified against the current canonical catalog.";
      }
      return summary;
    } catch {
      if (status) {
        status.dataset.state = "fallback";
        status.textContent = "Snapshot counts shown; the live catalog check was unavailable.";
      }
      return null;
    }
  }

  return { formatCount, hydrate, renderCatalogSummary, summarizeCatalog };
});
