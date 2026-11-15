// UniProt (UniProtKB): what a protein does, the diseases it is involved in, its natural variants and where it is in the cell.
// API: https://rest.uniprot.org/uniprotkb/search (documented at https://www.uniprot.org/help/api_queries).
// A query is a gene symbol or protein name, or a UniProt accession (P01116). Words are searched in reviewed
// (Swiss-Prot) human entries first; when there is none, in reviewed entries of any organism (one more request).
// One lookup = the best-matching entry, as up to four items: function, disease involvement, natural variants,
// subcellular location. The other matching entries are named in a note, so the member can ask for one by accession.
// The text is UniProt's own curated text; its "(PubMed:123)" markers are kept as written.
// Pages: https://www.uniprot.org/uniprotkb/<accession>/entry#function, #disease_variants, #subcellular_location
// (sections of the entry page) and https://www.uniprot.org/uniprotkb/<accession>/variant-viewer.
import type { EvidenceItem } from "../events.ts"
import { clean, type Http, join, type Json, list, num, rec, record, say, type SourceResult, words } from "./shared.ts"

const API = "https://rest.uniprot.org/uniprotkb/search"
const PAGE = "https://www.uniprot.org/uniprotkb"
/** UniProt's own pattern for an accession (https://www.uniprot.org/help/accession_numbers). */
export const ACCESSION = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/
const accessionOf = (value: unknown): string => (typeof value === "string" && ACCESSION.test(value) ? value : "")

export const FIELDS = "accession,id,reviewed,protein_name,gene_names,organism_name,cc_function,cc_disease,cc_subcellular_location,ft_variant"
const MAX_ENTRIES = 3

export const searchUrl = (query: string) => `${API}?${new URLSearchParams({ query, format: "json", size: String(MAX_ENTRIES), fields: FIELDS })}`
/** The queries to try, in order. Free text is reduced to plain words, so none of UniProt's query syntax can be written by the member. */
export function uniprotQueries(query: string): string[] {
  const one = query.trim().toUpperCase()
  if (ACCESSION.test(one)) return [`accession:${one}`]
  const terms = words(query).slice(0, 8).join(" ")
  return terms ? [`(${terms}) AND (reviewed:true) AND (organism_id:9606)`, `(${terms}) AND (reviewed:true)`] : []
}

const texts = (value: unknown): string => list(rec(value).texts ?? value).map((t) => clean(rec(t).value)).filter(Boolean).join(" ")

function names(entry: Json): { accession: string; protein: string; gene: string; organism: string; head: string } {
  const accession = accessionOf(entry.primaryAccession)
  const description = rec(entry.proteinDescription)
  const protein = clean(rec(rec(description.recommendedName).fullName).value) || clean(rec(rec(list(description.submissionNames)[0]).fullName).value)
  const gene = clean(rec(rec(list(entry.genes)[0]).geneName).value)
  const o = rec(entry.organism), organism = join([clean(o.scientificName), clean(o.commonName) && `(${clean(o.commonName)})`])
  const head = join([
    `UniProtKB entry ${accession}${clean(entry.uniProtkbId) ? ` (${clean(entry.uniProtkbId)})` : ""}${/unreviewed/i.test(clean(entry.entryType)) ? ", unreviewed (TrEMBL)" : /reviewed/i.test(clean(entry.entryType)) ? ", reviewed (Swiss-Prot)" : ""}.`,
    say("Protein", protein), say("Gene", gene), say("Organism", organism),
  ])
  return { accession, protein, gene, organism, head }
}

/** One UniProt entry as evidence items: function, disease involvement, natural variants, subcellular location. A part the entry does not have gives no item. */
export function entryItems(entry: Json): EvidenceItem[] {
  const n = names(entry)
  if (!n.accession) return []
  const comments = list(entry.comments).map(rec)
  const label = `${n.protein || n.accession}${n.gene ? ` (${n.gene})` : ""}`
  const items: (EvidenceItem | undefined)[] = []

  const functionText = comments.filter((c) => c.commentType === "FUNCTION").map((c) => texts(c)).filter(Boolean).join(" ")
  if (functionText) items.push(record(`${PAGE}/${n.accession}/entry#function`, `${label}: function (UniProt ${n.accession})`, join([n.head, say("Function", functionText)])))

  const diseaseComments = comments.filter((c) => c.commentType === "DISEASE").map((c) => ({ d: rec(c.disease), note: texts(c.note) }))
  const diseases = diseaseComments.filter((x) => clean(x.d.diseaseId))
  const otherNotes = diseaseComments.filter((x) => !clean(x.d.diseaseId) && x.note).map((x) => (/[.!?]$/.test(x.note) ? x.note : `${x.note}.`)) // a disease note with no disease record
  if (diseases.length || otherNotes.length) {
    const short = diseases.map(({ d }) => join([clean(d.diseaseId), clean(d.acronym) && `(${clean(d.acronym)})`]))
    const details = diseases.map(({ d, note }) => {
      const xref = rec(d.diseaseCrossReference)
      return join([`${clean(d.diseaseId)}${clean(d.acronym) ? ` (${clean(d.acronym)})` : ""}${clean(xref.database) && clean(xref.id) ? ` [${clean(xref.database)}:${clean(xref.id)}]` : ""}:`, clean(d.description), note && `Note: ${note}`])
    })
    items.push(record(`${PAGE}/${n.accession}/entry#disease_variants`, `${label}: involvement in disease (UniProt ${n.accession})`,
      join([n.head, diseases.length > 0 && `Involvement in disease, as curated by UniProt (${diseases.length}): ${short.join("; ")}.`, ...details.map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)), otherNotes.length > 0 && `Other disease notes: ${otherNotes.join(" ")}`])))
  }

  const variants = list(entry.features).map(rec).filter((f) => f.type === "Natural variant").map((f) => {
    const loc = rec(f.location), start = num(rec(loc.start).value), end = num(rec(loc.end).value)
    const alt = rec(f.alternativeSequence), from = clean(alt.originalSequence), to = list(alt.alternativeSequences).map((x) => clean(x)).filter(Boolean).join(" or ")
    if (!start) return ""
    const change = from && to && start === end && /^[A-Z]$/.test(from) && /^[A-Z]$/.test(to) ? `${from}${start}${to}` : join([from && `${from} ->`, to || (from ? "missing" : ""), `at position ${start}${end && end !== start ? `-${end}` : ""}`])
    const about = clean(f.description)
    return `${change}${clean(f.featureId) ? ` (${clean(f.featureId)})` : ""}${about ? `: ${about}` : ""}`
  }).filter(Boolean)
  if (variants.length) items.push(record(`${PAGE}/${n.accession}/variant-viewer`, `${label}: natural variants (UniProt ${n.accession})`,
    join([n.head, `Natural variants curated by UniProt (${variants.length}), as original residue, position, new residue: ${variants.join("; ")}.`])))

  const locations = comments.filter((c) => c.commentType === "SUBCELLULAR LOCATION").map((c) => {
    const places = list(c.subcellularLocations).map(rec).map((s) => join([clean(rec(s.location).value), clean(rec(s.topology).value), clean(rec(s.orientation).value)], ", ")).filter(Boolean).join("; ")
    return join([clean(c.molecule) && `${clean(c.molecule)}:`, places && (/[.!?]$/.test(places) ? places : `${places}.`), texts(c.note)])
  }).filter(Boolean)
  if (locations.length) items.push(record(`${PAGE}/${n.accession}/entry#subcellular_location`, `${label}: subcellular location (UniProt ${n.accession})`, join([n.head, `Subcellular location: ${locations.join(" ")}`])))

  return items.filter((i): i is EvidenceItem => Boolean(i))
}

/** One UniProt lookup: at most 2 requests. */
export async function uniprotSearch(query: string, http: Http): Promise<SourceResult> {
  const queries = uniprotQueries(query)
  if (!queries.length) return { items: [], notices: ["Write a gene symbol, a protein name or a UniProt accession (for example KRAS, or P01116). Nothing was looked up."] }
  for (const [i, q] of queries.entries()) {
    const entries = list(rec((await http.json("uniprot", searchUrl(q))).body).results).map(rec).filter((e) => accessionOf(e.primaryAccession))
    if (!entries.length) continue
    const items = entryItems(entries[0])
    const first = names(entries[0])
    const notices: string[] = []
    if (i > 0) notices.push("UniProt has no reviewed human entry for this query. This is the best match among reviewed entries of other organisms: check the organism.")
    const others = entries.slice(1).map((e) => { const n = names(e); return `${n.accession} ${join([n.protein, n.gene && `(${n.gene})`, n.organism && `, ${n.organism}`]).replace(" ,", ",")}` })
    notices.push(`UniProt's best match is ${first.accession} ${join([first.protein, first.gene && `(${first.gene})`])}.${others.length ? ` Other matches: ${others.join("; ")}. Ask again with an accession to read one of them.` : ""} Long sections are cut to 3000 characters.`)
    if (!items.length) notices.push("That entry has no curated function, disease, variant or location text.")
    return { items, notices }
  }
  return { items: [], notices: ["UniProt has no reviewed entry for this query. Try the official gene symbol or a UniProt accession."] }
}
