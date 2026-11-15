// Predicted structures of known variants beside their reference protein, and how the model's confidence changes.
//
// The reference sequence and each variant's sequence (the reference with one residue changed, as UniProt reports it)
// are folded by the same model (fold.ts: ESMFold). For each variant the table gets the model's confidence (pLDDT, 0-100)
// at the changed position in the reference and in the variant, and the difference. These are PREDICTIONS and the
// model's confidence in them: not measured structures, and not a measure of stability, activity or disease effect.
//
// It never throws: a fold that fails or does not finish in time gives that row (or the whole comparison) a plain reason.
import { FoldError, type Fold, MAX_ESMFOLD, plddtByResidue } from "./fold.ts"
import type { KnownVariant } from "./known.ts"

export const COMPARE_TIMEOUT_MS = 120_000
export const LABEL = "Predicted structures and the model's confidence (pLDDT), not measurements. pLDDT says how sure the model is of its own prediction at each residue; it does not measure stability, activity or the effect of a variant."

export interface Profile { meanPlddt: number; /** pLDDT per residue, residue 1 first, rounded to 0.1. */ plddt: number[]; cached: boolean }
export interface ConfidenceRow {
  id: string
  position: number
  /** pLDDT at the changed position: in the reference's prediction, in the variant's, and variant minus reference. */
  reference?: number
  variant?: number
  change?: number
  profile?: Profile
  error?: string
}
export interface Comparison {
  accession: string
  model: "esmfold"
  modelLabel: string
  label: string
  length: number
  reference?: Profile
  rows: ConfidenceRow[]
  /** Why nothing could be compared, when that is so. */
  error?: string
}

const round = (n: number) => Math.round(n * 10) / 10
const why = (error: unknown) => (error instanceof FoldError ? error.message : "the prediction failed")

/** The variant's sequence: the reference with one residue changed. Undefined when the reference does not have `from` there. */
export function mutate(sequence: string, v: Pick<KnownVariant, "position" | "from" | "to">): string | undefined {
  return sequence[v.position - 1] === v.from ? `${sequence.slice(0, v.position - 1)}${v.to}${sequence.slice(v.position)}` : undefined
}

function profileOf(pdb: string, length: number, meanPlddt: number, cached: boolean): Profile {
  const by = plddtByResidue(pdb)
  return { meanPlddt, plddt: Array.from({ length }, (_x, i) => round(by.get(i + 1) ?? 0)), cached }
}

export async function compareVariants(entry: { accession: string; sequence: string }, variants: KnownVariant[], fold: Fold, options: { timeoutMs?: number; modelLabel?: string } = {}): Promise<Comparison> {
  const base = { accession: entry.accession, model: "esmfold" as const, modelLabel: options.modelLabel ?? "ESMFold (Meta AI), predicted through the ESM Metagenomic Atlas API", label: LABEL, length: entry.sequence.length }
  const rows = (error: string): ConfidenceRow[] => variants.map((v) => ({ id: v.id, position: v.position, error }))
  if (entry.sequence.length > MAX_ESMFOLD) {
    const error = `ESMFold's free API folds at most ${MAX_ESMFOLD} amino acids, and this protein has ${entry.sequence.length}, so no variant could be predicted. AlphaFold DB has a model of the reference only, not of variants.`
    return { ...base, error, rows: rows("Not predicted: the protein is too long for ESMFold's free API.") }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((resolve) => { timer = setTimeout(() => resolve("late"), options.timeoutMs ?? COMPARE_TIMEOUT_MS); timer.unref?.() })
  const inTime = <T>(work: Promise<T>): Promise<T | "late"> => { work.catch(() => {}); return Promise.race([work, late]) }
  const seconds = Math.round((options.timeoutMs ?? COMPARE_TIMEOUT_MS) / 1000)
  try {
    let ref
    try { ref = await inTime(fold(entry.sequence)) } catch (error) {
      return { ...base, error: `The reference could not be predicted (${why(error)}), so nothing could be compared.`, rows: rows("Not predicted: the reference failed.") }
    }
    if (ref === "late") return { ...base, error: `The reference was not predicted within ${seconds} seconds. Try again: what finished is kept.`, rows: rows("Not predicted in time.") }
    const reference = profileOf(ref.pdb, entry.sequence.length, ref.meanPlddt, ref.cached)
    // Two at a time: the fold service allows two in flight; the others wait their turn.
    const out: ConfidenceRow[] = variants.map((v) => ({ id: v.id, position: v.position }))
    let next = 0, over = false
    const worker = async () => {
      while (next < variants.length) {
        const i = next++, v = variants[i], row = out[i]
        if (over) { row.error = "Not predicted in time."; continue }
        const sequence = mutate(entry.sequence, v)
        if (!sequence) { row.error = `Not predicted: the reference has no ${v.from} at position ${v.position}.`; continue }
        try {
          const got = await inTime(fold(sequence))
          if (got === "late") { over = true; row.error = `Not predicted within ${seconds} seconds. Try again: what finished is kept.`; continue }
          const profile = profileOf(got.pdb, sequence.length, got.meanPlddt, got.cached)
          const r = reference.plddt[v.position - 1], m = profile.plddt[v.position - 1]
          Object.assign(row, { reference: r, variant: m, change: round(m - r), profile })
        } catch (error) { row.error = `Not predicted (${why(error)}).` }
      }
    }
    await Promise.all([worker(), worker()])
    return { ...base, reference, rows: out }
  } finally { clearTimeout(timer) }
}
