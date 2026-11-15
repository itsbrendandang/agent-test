// Known variants of a protein: substitutions that UniProt has already curated from the literature, each with the papers
// it cites. Nothing here proposes or generates a variant: every item is a UniProt feature with at least one PubMed
// citation, and its text is UniProt's own.
//
//   GET https://rest.uniprot.org/uniprotkb/<accession>.json?fields=...   the entry: its sequence, natural variants
//       (ft_variant) and mutagenesis features (ft_mutagen), each with its evidence (PubMed ids).
//   GET https://rest.uniprot.org/uniprotkb/search?query=(gene_exact:<SYMBOL>) AND (organism_id:9606) AND (reviewed:true)
//       the reviewed human entry of a gene symbol, when the question names a gene and not an accession.
//
// Requests go through the database clients' one request path (sources/shared.ts): HTTPS to rest.uniprot.org only, no
// redirect, a 15-second limit per request, spacing between requests, answers kept for 10 minutes. One lookup sends at
// most MAX_REQUESTS. It is free and needs no key.
//
// WHICH VARIANTS ARE KEPT (code, never a model): single-residue substitutions whose original residue matches the
// entry's sequence at that position and that cite at least one PubMed paper. Order: the ones the question names, then
// the ones with more cited papers, natural variants before mutagenesis, then by position. At most MAX_VARIANTS.
import { ACCESSION } from "../sources/uniprot.ts"
import { clean, cut, type Http, limited, list, liveHttp, num, rec, ServiceError } from "../sources/shared.ts"

export const MAX_VARIANTS = 6
export const MAX_CITATIONS = 3
export const MAX_REPORTED_CHARS = 400
/** The entry and, when a gene symbol is given, the search that finds it. */
export const MAX_REQUESTS = 2
export const ENTRY_FIELDS = "accession,gene_names,protein_name,organism_name,sequence,ft_variant,ft_mutagen"
const AMINO = "ACDEFGHIKLMNPQRSTVWY"
/** A substitution as written in a question or a table: G12D (one-letter code, position, one-letter code). */
export const CHANGE = new RegExp(`^([${AMINO}])(\\d{1,5})([${AMINO}])$`)
const CHANGES_IN_TEXT = new RegExp(`\\b[${AMINO}]\\d{1,5}[${AMINO}]\\b`, "g")
/** Words that say a question is about variants. Only then is a gene symbol in it looked up. */
const VARIANT_WORDS = /\b(variants?|mutations?|mutants?|mutated|substitutions?|polymorphisms?|SNPs?|missense|alleles?)\b/i
/** Upper-case words that are not gene symbols. */
const NOT_GENES = new Set(["DNA", "RNA", "MRNA", "PCR", "FDA", "EMA", "USA", "UK", "EU", "WHO", "NIH", "COVID", "SARS", "HIV", "AIDS", "ICU", "IC50", "EC50", "KD", "MD", "AI", "ML", "ATP", "GTP", "GDP", "ADP", "NADH", "PDB", "SNP", "SNPS", "GWAS", "CRISPR", "RCT", "OR", "AND", "NOT", "THE", "WHAT", "WHICH", "HOW", "WHY", "ARE", "IS", "DOES", "CAN"])
const GENE = /^[A-Z][A-Z0-9-]{1,9}$/

export const entryUrl = (accession: string) => `https://rest.uniprot.org/uniprotkb/${accession}.json?${new URLSearchParams({ fields: ENTRY_FIELDS })}`
export const geneUrl = (symbol: string) => `https://rest.uniprot.org/uniprotkb/search?${new URLSearchParams({ query: `(gene_exact:${symbol}) AND (organism_id:9606) AND (reviewed:true)`, fields: "accession", size: "1", format: "json" })}`
export const entryPage = (accession: string) => `https://www.uniprot.org/uniprotkb/${accession}/entry`
export const pubmedPage = (id: string) => `https://pubmed.ncbi.nlm.nih.gov/${id}/`

export interface Citation { label: string; url: string }
export interface KnownVariant {
  /** The substitution: G12D. */
  id: string
  position: number
  from: string
  to: string
  kind: "natural variant" | "mutagenesis"
  /** What UniProt reports about it, in its own words (cut to MAX_REPORTED_CHARS). */
  reported: string
  /** The papers UniProt cites for it (PubMed), at most MAX_CITATIONS. */
  citations: Citation[]
  /** UniProt's page for the entry's variants. */
  record: string
  /** UniProt's variant id (VAR_...), when it has one. */
  featureId?: string
}
export interface KnownVariants {
  accession: string
  protein?: string
  gene?: string
  organism?: string
  /** Residues in the entry's (canonical) sequence. */
  length: number
  /** The kept variants, at most MAX_VARIANTS. */
  items: KnownVariant[]
  /** How many substitutions with a cited paper the entry has, before the cut. */
  found: number
  /** The entry's page for people. */
  source: string
}
/** The entry with its sequence: what a structure comparison needs. Not stored in the answer (the sequence can be long). */
export interface Entry extends KnownVariants { sequence: string; all: KnownVariant[] }

/** What to look up for an answer: an accession, or a gene symbol to find the reviewed human entry of. */
export type Target = { accession: string } | { gene: string }

/**
 * The protein an answer is about, for the variant lookup, or undefined when it is about none. In order: an accession
 * written in the question; a gene symbol in a question that speaks of variants or mutations (or names a substitution
 * such as G12D), through the answer's UniProt source for that gene when there is one; else the first UniProt source of
 * the answer.
 */
export function variantTarget(question: string, sources: { url: string; provider: string; title?: string }[]): Target | undefined {
  const uniprot = sources.flatMap((s) => {
    const m = s.provider === "uniprot" ? /^https:\/\/www\.uniprot\.org\/uniprotkb\/([A-Z0-9]{6,10})\//.exec(s.url) : null
    return m && ACCESSION.test(m[1]) ? [{ accession: m[1], title: s.title ?? "" }] : []
  })
  const tokens = question.split(/[^A-Za-z0-9-]+/).filter(Boolean)
  const accession = tokens.find((t) => ACCESSION.test(t))
  if (accession) return { accession }
  const aboutVariants = VARIANT_WORDS.test(question) || Boolean(question.match(CHANGES_IN_TEXT))
  const gene = aboutVariants ? tokens.find((t) => GENE.test(t) && /[A-Z]{2}/.test(t) && !NOT_GENES.has(t) && !CHANGE.test(t)) : undefined
  if (gene) {
    const source = uniprot.find((s) => s.title.includes(`(${gene})`))
    return source ? { accession: source.accession } : { gene }
  }
  return uniprot[0] ? { accession: uniprot[0].accession } : undefined
}

/** The substitutions a text names (G12D), in order, each once. */
export const changesIn = (text: string): string[] => [...new Set(text.match(CHANGES_IN_TEXT) ?? [])]

const evidenceIds = (feature: Record<string, unknown>): string[] =>
  [...new Set(list(feature.evidences).map(rec).filter((e) => e.source === "PubMed" && /^\d{1,9}$/.test(String(e.id ?? ""))).map((e) => String(e.id)))]

/** A variant with the number of papers UniProt cites for it (it orders the list; it is not kept). */
interface Found extends KnownVariant { cited: number }

/** Every substitution of an entry that UniProt reports with at least one PubMed paper, one item per new residue. */
export function variantsOf(entry: Record<string, unknown>): Found[] {
  const accession = String(entry.primaryAccession ?? "")
  const sequence = clean(rec(entry.sequence).value)
  if (!ACCESSION.test(accession) || !sequence) return []
  const out: Found[] = []
  for (const f of list(entry.features).map(rec)) {
    const kind = f.type === "Natural variant" ? "natural variant" : f.type === "Mutagenesis" ? "mutagenesis" : undefined
    if (!kind) continue
    const loc = rec(f.location), start = Number(num(rec(loc.start).value)), end = Number(num(rec(loc.end).value))
    const alt = rec(f.alternativeSequence), from = clean(alt.originalSequence)
    if (!Number.isInteger(start) || start < 1 || start !== end || from.length !== 1 || sequence[start - 1] !== from) continue
    const ids = evidenceIds(f)
    if (!ids.length) continue
    const reported = cut(clean(f.description), MAX_REPORTED_CHARS) || (kind === "mutagenesis" ? "A mutagenesis experiment (no description)." : "A natural variant (no description).")
    const featureId = /^VAR_\d{1,9}$/.test(clean(f.featureId)) ? clean(f.featureId) : undefined
    for (const to of list(alt.alternativeSequences).map((x) => clean(x))) {
      if (to.length !== 1 || !AMINO.includes(to) || to === from) continue
      out.push({
        id: `${from}${start}${to}`, position: start, from, to, kind, reported,
        citations: ids.slice(0, MAX_CITATIONS).map((id) => ({ label: `PubMed ${id}`, url: pubmedPage(id) })),
        record: `https://www.uniprot.org/uniprotkb/${accession}/variant-viewer`,
        ...(featureId ? { featureId } : {}), cited: ids.length,
      })
    }
  }
  // One item per substitution: a natural variant wins over a mutagenesis feature of the same change.
  const seen = new Map<string, Found>()
  for (const v of out) if (!seen.has(v.id) || (seen.get(v.id)!.kind === "mutagenesis" && v.kind === "natural variant")) seen.set(v.id, v)
  return [...seen.values()]
}

const citedOf = (v: KnownVariant) => ("cited" in v && typeof v.cited === "number" ? v.cited : v.citations.length)
const plain = ({ id, position, from, to, kind, reported, citations, record, featureId }: KnownVariant): KnownVariant => ({ id, position, from, to, kind, reported, citations, record, ...(featureId ? { featureId } : {}) })

/** The kept variants: the ones the question names first, then by cited papers, natural before mutagenesis, then position. */
export function pickVariants(all: KnownVariant[], named: string[] = [], max = MAX_VARIANTS): KnownVariant[] {
  const rank = (v: KnownVariant) => (named.includes(v.id) ? named.indexOf(v.id) : named.length + 1)
  return [...all].sort((a, b) => rank(a) - rank(b) || citedOf(b) - citedOf(a) || (a.kind === b.kind ? 0 : a.kind === "natural variant" ? -1 : 1) || a.position - b.position || a.id.localeCompare(b.id))
    .slice(0, max).map(plain)
}

/** Read one UniProt entry (and find it by gene symbol first when that is the target). Throws ServiceError. */
export async function readEntry(target: Target, http: Http, named: string[] = []): Promise<Entry | undefined> {
  const h = limited(http, MAX_REQUESTS)
  let accession = "accession" in target ? target.accession : ""
  if (!accession) {
    const gene = "gene" in target ? target.gene : ""
    if (!GENE.test(gene)) return undefined
    const found = list(rec((await h.json("uniprot", geneUrl(gene))).body).results).map(rec)
    accession = String(found[0]?.primaryAccession ?? "")
    if (!ACCESSION.test(accession)) return undefined
  }
  if (!ACCESSION.test(accession)) throw new ServiceError("UniProt: not an accession")
  const answer = await h.json("uniprot", entryUrl(accession), { emptyOn: [400, 404] })
  if (!answer.body) return undefined
  const entry = rec(answer.body)
  const sequence = clean(rec(entry.sequence).value)
  if (String(entry.primaryAccession ?? "") !== accession || !new RegExp(`^[${AMINO}XUBZO]+$`).test(sequence)) throw new ServiceError("UniProt sent an entry this lookup could not read")
  const all = variantsOf(entry)
  const d = rec(entry.proteinDescription)
  const protein = clean(rec(rec(d.recommendedName).fullName).value) || clean(rec(rec(list(d.submissionNames)[0]).fullName).value)
  const gene = clean(rec(rec(list(entry.genes)[0]).geneName).value)
  const organism = clean(rec(entry.organism).scientificName)
  return {
    accession, ...(protein ? { protein } : {}), ...(gene ? { gene } : {}), ...(organism ? { organism } : {}),
    length: sequence.length, items: pickVariants(all, named), found: all.length, source: entryPage(accession),
    sequence, all: all.map(plain),
  }
}

/** What an answer keeps: the entry without its sequence and without the variants that were cut. */
export const keptOf = ({ sequence: _s, all: _a, ...kept }: Entry): KnownVariants => kept

/** The most time one lookup may take, waits for the shared request spacing included (as sources/index.ts LOOKUP_TIMEOUT_MS). */
export const LOOKUP_TIMEOUT_MS = 45_000

/** The lookup an answer makes: what it keeps, or undefined when there is no entry. Throws ServiceError, also when it runs out of time. */
export async function lookupVariants(target: Target, named: string[], http: Http = liveHttp, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<KnownVariants | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ServiceError(`UniProt did not finish in ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs) })
  try {
    const entry = await Promise.race([readEntry(target, http, named), late])
    return entry ? keptOf(entry) : undefined
  } catch (error) {
    throw error instanceof ServiceError ? error : new ServiceError("UniProt sent an answer this lookup could not read")
  } finally { clearTimeout(timer) }
}
