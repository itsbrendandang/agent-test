// PubChem (NCBI): what a compound is, its computed properties, and experimental properties reported by other sources.
// APIs: PUG REST (https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest) and PUG View (https://pubchem.ncbi.nlm.nih.gov/docs/pug-view).
// PubChem asks for no more than 5 requests a second; this client sends at most one every 1.5 seconds (shared.ts).
// A query is a compound name or a PubChem compound id (CID, digits only).
// One lookup = two requests and up to two items: identity with PubChem's computed properties, and the experimental
// properties (solubility, LogP, pKa, melting point ...) with the name of the source of each value (see LICENCES).
// PubChem's answer gives the computed properties without units, so none are written here.
// LICENCES: an experimental value belongs to the source PubChem took it from, and the sources' terms differ (DrugBank:
// non-commercial; Haz-Map: all rights reserved; HMDB: permission for commercial use). A value is passed on only when
// PubChem's own record of its source states public domain, CC BY or CC0, or the source is NLM's HSDB. The others are
// left out, and the member is told how many and from which sources.
// Pages: https://pubchem.ncbi.nlm.nih.gov/compound/<CID> and the same with #section=Experimental-Properties.
import type { EvidenceItem } from "../events.ts"
import { clean, type Http, join, type Json, list, num, rec, record, say, ServiceError, type SourceResult } from "./shared.ts"

const REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound"
const VIEW = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound"
const PAGE = "https://pubchem.ncbi.nlm.nih.gov/compound"
export const CID = /^[1-9]\d{0,11}$/
const cidOf = (value: unknown): string => (CID.test(num(value)) ? num(value) : "")

export const PROPERTIES = "Title,MolecularFormula,MolecularWeight,IUPACName,SMILES,InChIKey,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount,HeavyAtomCount,Charge,Complexity"
export const propertyUrl = (query: string) => (CID.test(query) ? `${REST}/cid/${query}/property/${PROPERTIES}/JSON` : `${REST}/name/${encodeURIComponent(query)}/property/${PROPERTIES}/JSON`)
export const experimentalUrl = (cid: string) => `${VIEW}/${cid}/JSON?heading=Experimental+Properties`

const OPEN_SOURCES = new Set(["Hazardous Substances Data Bank (HSDB)"]) // NLM: a US government work; its record in PubChem carries no licence text

/** True when PubChem's record of a value's source states an open licence: public domain, CC BY or CC0, and nothing non-commercial or reserved. */
export function openLicence(reference: Json): boolean {
  const terms = `${clean(reference.LicenseNote)} ${clean(reference.LicenseURL)}`
  if (/non-?\s?commercial|\bby-nc\b|all rights reserved/i.test(terms)) return false
  return OPEN_SOURCES.has(clean(reference.SourceName)) || /public domain|creativecommons\.org\/(?:licenses\/by\/|publicdomain\/)|\bCC[- ]?BY[- ]?4\.0\b|\bCC0\b/i.test(terms)
}

/** The compound's identity and PubChem's computed properties. */
export function compoundItem(p: Json): EvidenceItem | undefined {
  const cid = cidOf(p.CID)
  if (!cid) return undefined
  const title = clean(p.Title)
  const text = join([
    `PubChem compound record CID ${cid}${title ? `: ${title}` : ""}.`,
    say("IUPAC name", clean(p.IUPACName, 400)), say("Molecular formula", clean(p.MolecularFormula)), say("Molecular weight", num(p.MolecularWeight)),
    say("InChIKey", clean(p.InChIKey)), say("SMILES", clean(p.SMILES, 400)),
    say("Computed by PubChem", join([
      num(p.XLogP) && `XLogP ${num(p.XLogP)}`, num(p.TPSA) && `topological polar surface area (TPSA) ${num(p.TPSA)}`, num(p.HBondDonorCount) && `hydrogen bond donors ${num(p.HBondDonorCount)}`,
      num(p.HBondAcceptorCount) && `hydrogen bond acceptors ${num(p.HBondAcceptorCount)}`, num(p.RotatableBondCount) && `rotatable bonds ${num(p.RotatableBondCount)}`,
      num(p.HeavyAtomCount) && `heavy atoms ${num(p.HeavyAtomCount)}`, num(p.Charge) && `formal charge ${num(p.Charge)}`, num(p.Complexity) && `complexity ${num(p.Complexity)}`,
    ], "; ")),
  ])
  return record(`${PAGE}/${cid}`, `${title || `CID ${cid}`}: PubChem compound record (CID ${cid})`, text)
}

function valueText(value: Json): string {
  const strings = list(value.StringWithMarkup).map((s) => clean(rec(s).String)).filter(Boolean).join(" ")
  if (strings) return strings
  const numbers = list(value.Number).map((n) => num(n)).filter(Boolean).join(", ")
  return numbers ? join([numbers, clean(value.Unit)]) : ""
}

/** The experimental properties of a PUG View answer, one "<property>: <value> (source: <name>)" per value. `skipped` counts the values left out for their licence. */
export function experimentalValues(body: unknown): { lines: string[]; skipped: number; skippedSources: string[] } {
  const root = rec(rec(body).Record)
  const references = new Map(list(root.Reference).map(rec).map((r) => [num(r.ReferenceNumber), r] as const))
  const lines: string[] = [], skippedSources = new Set<string>()
  let skipped = 0
  const walk = (section: Json, depth: number) => {
    if (depth > 6) return
    const heading = clean(section.TOCHeading)
    for (const info of list(section.Information).map(rec)) {
      const reference = references.get(num(info.ReferenceNumber))
      const text = valueText(rec(info.Value))
      if (!heading || !text || !reference) continue // a value with no known source is not passed on
      if (!openLicence(reference)) { skipped++; skippedSources.add(clean(reference.SourceName) || "a source"); continue }
      const name = clean(info.Name)
      lines.push(`${heading}${name && name.toLowerCase() !== heading.toLowerCase() ? ` (${name})` : ""}: ${clean(text, 300)}${clean(reference.SourceName) ? ` (source: ${clean(reference.SourceName)})` : ""}`)
    }
    for (const child of list(section.Section).map(rec)) walk(child, depth + 1)
  }
  for (const section of list(root.Section).map(rec)) walk(section, 0)
  return { lines, skipped, skippedSources: [...skippedSources] }
}

export function experimentalItem(cid: string, title: string, lines: string[]): EvidenceItem | undefined {
  if (!CID.test(cid) || !lines.length) return undefined
  return record(`${PAGE}/${cid}#section=Experimental-Properties`, `${title || `CID ${cid}`}: experimental properties (PubChem CID ${cid})`,
    `PubChem compound record CID ${cid}${title ? ` (${title})` : ""}, experimental properties as reported by the named sources. ${lines.map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)).join(" ")}`)
}

/** One PubChem lookup: 2 requests (properties by name or CID, then the experimental properties). */
export async function pubchemSearch(query: string, http: Http): Promise<SourceResult> {
  const name = query.trim()
  if (!name) return { items: [], notices: ["Write a compound name or a PubChem CID. Nothing was looked up."] }
  const answer = await http.json("pubchem", propertyUrl(name), { emptyOn: [400, 404] }) // PubChem answers 404 for a name it does not know, 400 for one it cannot read
  const found = list(rec(rec(answer.body).PropertyTable).Properties).map(rec).filter((p) => cidOf(p.CID))
  const head = found[0] ? compoundItem(found[0]) : undefined
  if (!head) return { items: [], notices: [`PubChem has no compound named "${name}". Try another name (a generic drug name works best) or a CID.`] }
  const cid = cidOf(found[0].CID), title = clean(found[0].Title)
  const notices: string[] = []
  if (found.length > 1) notices.push(`PubChem has ${found.length} compounds for this name; this is the first (CID ${cid}). Others: ${found.slice(1, 6).map((p) => `CID ${cidOf(p.CID)}`).join(", ")}.`)
  const items = [head]
  try {
    const view = await http.json("pubchem", experimentalUrl(cid), { emptyOn: [404] }) // 404: the record has no such section
    const { lines, skipped, skippedSources } = view.status === 404 ? { lines: [], skipped: 0, skippedSources: [] } : experimentalValues(view.body)
    const experimental = experimentalItem(cid, title, lines)
    if (experimental) items.push(experimental)
    else if (!skipped) notices.push("PubChem lists no experimental property for this compound.")
    if (skipped) notices.push(`${skipped} experimental value${skipped === 1 ? " was" : "s were"} left out: PubChem's record of the source (${skippedSources.join(", ")}) does not state an open licence. They can be read on the PubChem page.`)
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error
    notices.push(`The experimental properties could not be fetched (${error.message}); the computed properties are complete.`)
  }
  notices.push("PubChem gives its computed properties without units; none were added.")
  return { items, notices }
}
