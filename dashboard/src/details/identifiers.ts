// Identifiers in a run's own text: the addresses and words a source, a statement or a reply recorded. Each one links to
// the public record it names (UniProt, ChEMBL, ClinicalTrials.gov, PubMed, DOI and others). Nothing is looked up and
// nothing is guessed: an identifier is found only in a form that cannot be mistaken for something else (a database
// address, or the database's name right before it), and what kind of thing it names is said only when the form says it.
// No React here: the detail panels draw what these functions return.

/** What kind of thing an identifier names: a drug or compound, a target (protein or gene), a disease, a trial or a paper. */
export type EntityType = "drug" | "target" | "disease" | "trial" | "paper"
export type Scheme = "chembl" | "uniprot" | "nct" | "pmid" | "pmcid" | "doi" | "pubchem" | "ensembl" | "efo" | "mondo" | "arxiv"

export interface Identifier {
  scheme: Scheme
  /** The identifier as the record writes it, e.g. "P01116", "NCT04303780", "10.1056/NEJMoa2103695". */
  value: string
  /** undefined: the form does not say (a ChEMBL id written in text can be a compound or a target). */
  type?: EntityType
  /** The public page of the record. Always https. */
  href: string
}

/** The database's own name, for a person. */
export const SCHEME_NAME: Record<Scheme, string> = {
  chembl: "ChEMBL", uniprot: "UniProt", nct: "ClinicalTrials.gov", pmid: "PubMed", pmcid: "PubMed Central", doi: "DOI",
  pubchem: "PubChem", ensembl: "Ensembl", efo: "EFO", mondo: "MONDO", arxiv: "arXiv",
}
/** The kind of thing, in plain words. */
export const TYPE_WORD: Record<EntityType, string> = { drug: "Drug or compound", target: "Target", disease: "Disease", trial: "Clinical trial", paper: "Paper" }

const make = (scheme: Scheme, value: string, type?: EntityType): Identifier => ({ scheme, value, type, href: hrefOf(scheme, value, type) })

function hrefOf(scheme: Scheme, value: string, type?: EntityType): string {
  const v = encodeURIComponent(value)
  switch (scheme) {
    case "chembl": return type === "target" ? `https://www.ebi.ac.uk/chembl/explore/target/${v}` : type === "drug" ? `https://www.ebi.ac.uk/chembl/explore/compound/${v}` : `https://www.ebi.ac.uk/chembl/g/#search_results/all/query=${v}`
    case "uniprot": return `https://www.uniprot.org/uniprotkb/${v}/entry`
    case "nct": return `https://clinicaltrials.gov/study/${v}`
    case "pmid": return `https://pubmed.ncbi.nlm.nih.gov/${v}/`
    case "pmcid": return `https://pmc.ncbi.nlm.nih.gov/articles/${v}/`
    case "doi": return `https://doi.org/${value.split("/").map(encodeURIComponent).join("/")}`
    case "pubchem": return `https://pubchem.ncbi.nlm.nih.gov/compound/${v}`
    case "ensembl": return `https://platform.opentargets.org/target/${v}`
    case "efo": case "mondo": return `https://platform.opentargets.org/disease/${v}`
    case "arxiv": return `https://arxiv.org/abs/${v}`
  }
}

/** A stable key for one identifier: the same record written twice is one entity. */
export const idKey = (id: Pick<Identifier, "scheme" | "value">) => `${id.scheme}:${id.scheme === "doi" ? id.value.toLowerCase() : id.value.toUpperCase()}`
/** "UniProt P01116". */
export const idLabel = (id: Pick<Identifier, "scheme" | "value">) => `${SCHEME_NAME[id.scheme]} ${id.value}`

const UNIPROT = "(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})"
const trimDoi = (doi: string) => doi.replace(/[.,;:)\]}>'"]+$/, "")
/** A DOI read from a web address ends where the address goes on to a query, a page format or a version. */
const doiOfUrl = (id: Identifier): Identifier => id.scheme !== "doi" ? id : make("doi", trimDoi(id.value.replace(/[?#].*$/, "").replace(/(?:\.(?:full|abstract|pdf|html?))+$/i, "").replace(/(\d)v\d+$/, "$1")), id.type)

/** Identifiers in a web address, with the kind of thing when the address's path says it. */
function fromUrl(url: string): Identifier[] {
  let u: URL
  try { u = new URL(url) } catch { return [] }
  const host = u.hostname.replace(/^www\./, ""), path = decodeURIComponent(u.pathname)
  const out: Identifier[] = []
  let m: RegExpExecArray | null
  if (/(^|\.)ebi\.ac\.uk$/.test(host) && (m = /\/chembl\/(?:explore|compound_report_card|target_report_card|g)?\/?(compound|target)?\/?(CHEMBL\d+)/i.exec(path))) out.push(make("chembl", m[2].toUpperCase(), m[1]?.toLowerCase() === "target" ? "target" : m[1]?.toLowerCase() === "compound" ? "drug" : undefined))
  if (/(^|\.)uniprot\.org$/.test(host) && (m = new RegExp(`/uniprot(?:kb)?/(${UNIPROT})(?:[/.]|$)`).exec(path))) out.push(make("uniprot", m[1], "target"))
  if (/(^|\.)clinicaltrials\.gov$/.test(host) && (m = /\b(NCT\d{8})\b/i.exec(path + u.search))) out.push(make("nct", m[1].toUpperCase(), "trial"))
  if (host === "pubmed.ncbi.nlm.nih.gov" && (m = /^\/(\d{1,9})\/?$/.exec(path))) out.push(make("pmid", m[1], "paper"))
  if (/(^|\.)europepmc\.org$/.test(host) && (m = /\/(?:article|abstract)\/MED\/(\d{1,9})/i.exec(path))) out.push(make("pmid", m[1], "paper"))
  if ((m = /\b(PMC\d{5,9})\b/.exec(path)) && /(ncbi\.nlm\.nih\.gov|europepmc\.org)$/.test(host)) out.push(make("pmcid", m[1], "paper"))
  if ((host === "doi.org" || host === "dx.doi.org") && (m = /^\/(10\.\d{4,9}\/\S+)$/.exec(path))) out.push(make("doi", trimDoi(m[1]), "paper"))
  if (host === "pubchem.ncbi.nlm.nih.gov" && (m = /^\/compound\/(\d{1,12})(?:[/#]|$)/.exec(path))) out.push(make("pubchem", m[1], "drug"))
  if (host === "platform.opentargets.org") {
    if ((m = /\b(ENSG\d{11})\b/.exec(path))) out.push(make("ensembl", m[1], "target"))
    if ((m = /\b(EFO_\d{7}|MONDO_\d{7})\b/.exec(path))) out.push(make(m[1].startsWith("EFO") ? "efo" : "mondo", m[1], "disease"))
  }
  if (host === "arxiv.org" && (m = /^\/abs\/(\d{4}\.\d{4,5})(?:v\d+)?$/.exec(path))) out.push(make("arxiv", m[1], "paper"))
  return out
}

/** Identifiers written in text, in forms that name their database. */
function fromText(text: string): Identifier[] {
  const out: Identifier[] = []
  const all = (re: RegExp, f: (m: RegExpExecArray) => Identifier | undefined) => { for (const m of text.matchAll(re)) { const id = f(m as RegExpExecArray); if (id) out.push(id) } }
  all(/\b(NCT\d{8})\b/g, (m) => make("nct", m[1], "trial"))
  all(/\b(CHEMBL\d{1,9})\b/g, (m) => make("chembl", m[1]))
  all(/\b(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s"<>]+)/gi, (m) => make("doi", trimDoi(m[1]), "paper"))
  all(/\bPMID:?\s*(\d{1,9})\b/gi, (m) => make("pmid", m[1], "paper"))
  all(/\b(PMC\d{5,9})\b/g, (m) => make("pmcid", m[1], "paper"))
  all(new RegExp(`\\bUniProt(?:KB)?(?:\\s+accession)?[:\\s]\\s*(${UNIPROT})\\b`, "g"), (m) => make("uniprot", m[1], "target"))
  all(/\bPubChem\s+CID:?\s*(\d{1,12})\b/g, (m) => make("pubchem", m[1], "drug"))
  all(/\b(ENSG\d{11})\b/g, (m) => make("ensembl", m[1], "target"))
  all(/\b(EFO_\d{7}|MONDO_\d{7})\b/g, (m) => make(m[1].startsWith("EFO") ? "efo" : "mondo", m[1], "disease"))
  all(/\barXiv:\s*(\d{4}\.\d{4,5})\b/gi, (m) => make("arxiv", m[1], "paper"))
  return out
}

/**
 * Every identifier in the given addresses and texts, once each. When the same record is found once with its kind (from
 * an address) and once without (in text), the kind is kept.
 */
export function findIdentifiers(...parts: (string | undefined)[]): Identifier[] {
  const found = new Map<string, Identifier>()
  for (const part of parts) {
    if (!part) continue
    const ids = /^https?:\/\//i.test(part.trim()) && !/\s/.test(part.trim()) ? [...fromUrl(part.trim()), ...fromText(part)].map(doiOfUrl) : fromText(part)
    for (const id of ids) {
      const key = idKey(id), old = found.get(key)
      if (!old) found.set(key, id)
      else if (!old.type && id.type) found.set(key, { ...old, type: id.type, href: id.href })
    }
  }
  return [...found.values()]
}
