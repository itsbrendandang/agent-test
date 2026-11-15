// Known variants of an answer's protein, as the engine sends them (engine/src/variants/known.ts), and the predicted
// confidence comparison (engine/src/variants/compare.ts). Everything is checked here before the page uses it: a
// malformed field is dropped, never guessed at, and a link must be https to UniProt or PubMed.
import { ENGINE } from "@/lib/engine"

export const NOT_MEASURED = "Predicted structures and the model's confidence (pLDDT, 0-100), not measurements. pLDDT says how sure the model is of its own prediction; it does not measure stability, activity or the effect of a variant."

export interface Citation { label: string; url: string }
export interface KnownVariant { id: string; position: number; from: string; to: string; kind: "natural variant" | "mutagenesis"; reported: string; citations: Citation[]; record: string }
export interface KnownVariants { accession: string; protein?: string; gene?: string; organism?: string; length: number; found: number; source: string; items: KnownVariant[] }

export interface Profile { meanPlddt: number; plddt: number[] }
export interface ConfidenceRow { id: string; position: number; reference?: number; variant?: number; change?: number; profile?: Profile; error?: string }
export interface Comparison { accession: string; modelLabel: string; label: string; length: number; reference?: Profile; rows: ConfidenceRow[]; error?: string }

const ACCESSION = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/
const CHANGE = /^[ACDEFGHIKLMNPQRSTVWY]\d{1,5}[ACDEFGHIKLMNPQRSTVWY]$/
const LINK = /^https:\/\/(?:www\.uniprot\.org\/uniprotkb\/|pubmed\.ncbi\.nlm\.nih\.gov\/)[\w/#.-]*$/
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown, max = 400): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const link = (v: unknown): string | undefined => (typeof v === "string" && LINK.test(v) ? v : undefined)

/** The engine's `variants` event or record field, or undefined when it is not usable. At most 6 items. */
export function variantsOf(value: unknown): KnownVariants | undefined {
  const v = rec(value)
  const accession = str(v.accession), source = link(v.source), length = num(v.length)
  if (!accession || !ACCESSION.test(accession) || !source || !length) return undefined
  const items = (Array.isArray(v.items) ? v.items : []).flatMap((x): KnownVariant[] => {
    const i = rec(x), id = str(i.id, 12), position = num(i.position), record = link(i.record), reported = str(i.reported)
    if (!id || !CHANGE.test(id) || !position || !record || !reported) return []
    const citations = (Array.isArray(i.citations) ? i.citations : []).flatMap((c) => { const label = str(rec(c).label, 40), url = link(rec(c).url); return label && url ? [{ label, url }] : [] }).slice(0, 3)
    return [{ id, position, from: id[0], to: id.at(-1)!, kind: i.kind === "mutagenesis" ? "mutagenesis" : "natural variant", reported, citations, record }]
  }).slice(0, 6)
  if (!items.length) return undefined
  return { accession, length, found: num(v.found) ?? items.length, source, items, ...(str(v.protein, 200) ? { protein: str(v.protein, 200) } : {}), ...(str(v.gene, 40) ? { gene: str(v.gene, 40) } : {}), ...(str(v.organism, 200) ? { organism: str(v.organism, 200) } : {}) }
}

const profileOf = (v: unknown): Profile | undefined => {
  const p = rec(v), mean = num(p.meanPlddt)
  return mean === undefined || !Array.isArray(p.plddt) ? undefined : { meanPlddt: mean, plddt: p.plddt.map((x) => num(x) ?? 0).slice(0, 5000) }
}

/** GET /api/variants/compare's answer, checked. */
export function comparisonOf(value: unknown): Comparison | undefined {
  const c = rec(value), accession = str(c.accession)
  if (!accession || !Array.isArray(c.rows)) return undefined
  const rows = c.rows.flatMap((x): ConfidenceRow[] => {
    const r = rec(x), id = str(r.id, 12), position = num(r.position)
    if (!id || !position) return []
    const profile = profileOf(r.profile)
    return [{ id, position, ...(num(r.reference) !== undefined ? { reference: num(r.reference) } : {}), ...(num(r.variant) !== undefined ? { variant: num(r.variant) } : {}), ...(num(r.change) !== undefined ? { change: num(r.change) } : {}), ...(profile ? { profile } : {}), ...(str(r.error) ? { error: str(r.error) } : {}) }]
  })
  const reference = profileOf(c.reference)
  return { accession, modelLabel: str(c.modelLabel, 200) ?? "ESMFold", label: str(c.label, 600) ?? "Predicted structures and confidence, not measurements.", length: num(c.length) ?? 0, rows, ...(reference ? { reference } : {}), ...(str(c.error, 600) ? { error: str(c.error, 600) } : {}) }
}

/** GET /api/variants/compare for an answer's variants. */
export const compareUrl = (v: KnownVariants) => `${ENGINE}/api/variants/compare?${new URLSearchParams({ accession: v.accession, variants: v.items.map((i) => i.id).join(",") })}`

/** "+3.2", "−12.0", "0.0": a change in pLDDT points. */
export const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n < 0 ? `−${Math.abs(n).toFixed(1)}` : "0.0")
