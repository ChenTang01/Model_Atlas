export const literatureRecord = Object.freeze({
  id: "doi-10-1287-isre-2016-0636",
  detail_level: "literature",
  analysis_level: "evidence-indexed model record",
  title: "Managing Co-Creation in Information Technology Projects: A Differential Games Approach",
  authors: ["Emre M. Demirezen", "Subodha Kumar", "Bala Shetty"],
  authors_text: "Emre M. Demirezen; Subodha Kumar; Bala Shetty",
  year: 2016,
  published_date: "2016-09-01",
  published_online: "2016-09-01",
  doi: "10.1287/isre.2016.0636",
  doi_url: "https://doi.org/10.1287/isre.2016.0636",
  bibkey: "",
  pdf_availability: "available",
  pdf_file: "Managing Co-Creation in Information Technology Projects_ A Differential Games Approach.pdf",
  source_basis: "Downloaded through EBSCOhost and matched to the journal metadata.",
  source_category: "EBSCOhost",
  source_note: "Downloaded through EBSCOhost in the completed literature collection.",
  review_status: "PDF-verified; scope-reviewed; evidence-indexed",
  abstract: "A client and vendor choose dynamic effort in an information-technology project under alternative payment and monitoring structures.",
  modeling_evidence: "The article formulates and solves a differential game with dynamic client and vendor effort, double moral hazard, and equilibrium payment design.",
  review_note: "Title, authors, PDF identity, and substantive mathematical-modeling scope were checked against the downloaded article.",
  journal: "Information Systems Research",
  journal_code: "isr"
});

export function schema31Payload(modelMapRecord) {
  const modelMap = structuredClone(modelMapRecord);
  modelMap.detail_level = "model_map";
  return {
    schema_version: "3.1",
    title: "Model Atlas mixed-detail fixture",
    generated_on: "2026-09-07",
    audit: {
      records: 2,
      pdf_available: 2,
      pdf_verified: 2,
      independently_audited: 1,
      with_bibkey: modelMap.bibkey ? 1 : 0,
      model_maps: 1,
      literature_records: 1
    },
    records: [modelMap, structuredClone(literatureRecord)]
  };
}
