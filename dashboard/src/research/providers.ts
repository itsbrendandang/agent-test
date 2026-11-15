// Where a source came from, in plain words, with the link its credit carries. One entry per search or database the
// engine names. Exa is credited only for a live Exa search; a practice run's sources are examples and say so; the
// six databases hold records (not papers), so they are called records.
export interface ProviderInfo { label: string; link?: string; linkText?: string; place: string; kind: "web" | "literature" | "database" | "example" }
export const PROVIDERS: Record<string, ProviderInfo> = {
  exa: { label: "Found through Exa (web search)", link: "https://exa.ai", linkText: "Exa", place: "the web", kind: "web" },
  europepmc: { label: "Found in PubMed and preprints (Europe PMC)", link: "https://europepmc.org", linkText: "Europe PMC", place: "PubMed and preprints", kind: "literature" },
  openalex: { label: "Found in OpenAlex (scholarly index)", link: "https://openalex.org", linkText: "OpenAlex", place: "OpenAlex", kind: "literature" },
  semanticscholar: { label: "Found in Semantic Scholar", link: "https://www.semanticscholar.org", linkText: "Semantic Scholar", place: "Semantic Scholar", kind: "literature" },
  arxiv: { label: "Found in arXiv (preprints)", link: "https://arxiv.org", linkText: "arXiv", place: "arXiv", kind: "literature" },
  crossref: { label: "Found in Crossref (scholarly records)", link: "https://www.crossref.org", linkText: "Crossref", place: "Crossref", kind: "literature" },
  biorxiv: { label: "Found in bioRxiv/medRxiv (preprints)", link: "https://www.biorxiv.org", linkText: "bioRxiv/medRxiv", place: "bioRxiv/medRxiv", kind: "literature" },
  chembl: { label: "ChEMBL record", link: "https://www.ebi.ac.uk/chembl/", linkText: "ChEMBL", place: "ChEMBL", kind: "database" },
  clinicaltrials: { label: "ClinicalTrials.gov record", link: "https://clinicaltrials.gov", linkText: "ClinicalTrials.gov", place: "ClinicalTrials.gov", kind: "database" },
  openfda: { label: "FDA label or report counts (openFDA)", link: "https://open.fda.gov", linkText: "openFDA", place: "openFDA", kind: "database" },
  opentargets: { label: "Open Targets record", link: "https://platform.opentargets.org", linkText: "Open Targets", place: "Open Targets", kind: "database" },
  uniprot: { label: "UniProt record", link: "https://www.uniprot.org", linkText: "UniProt", place: "UniProt", kind: "database" },
  pubchem: { label: "PubChem record", link: "https://pubchem.ncbi.nlm.nih.gov", linkText: "PubChem", place: "PubChem", kind: "database" },
  fixture: { label: "Example source (practice run)", place: "the example sources", kind: "example" },
}
/** Where a search step looked. The literature search asks six sources at once, though its steps carry the provider "europepmc". */
export const searchPlace = (provider: string): string => (provider === "europepmc" ? "the literature (Europe PMC, OpenAlex, Semantic Scholar, arXiv, Crossref, bioRxiv/medRxiv)" : PROVIDERS[provider]?.place ?? provider)
