// A THIN ADAPTER to the Structure tab's fold service, for comparing known variants with their reference protein.
//
// The Structure tab (branch fm/research-esm-structure, engine/src/structure/fold.ts) folds sequences with the free
// public ESMFold API and keeps every result on disk. Until that branch is merged, this file does the one thing the
// variant comparison needs from it, the same way: fold one sequence with ESMFold and keep the result in the same folder
// (board/runs/.structures/) under the same key (sha256 of "esmfold\n<sequence>") and in the same shape, so the two
// share their kept structures. Once fold.ts is merged, `createEsmFold` becomes a call to its `structure({ sequence })`.
//
//   POST https://api.esmatlas.com/foldSequence/v1/pdb/ with the sequence as the body. The answer is a PDB file whose
//   B-factor column holds the model's confidence (pLDDT, 0-1 or 0-100). The free API folds at most MAX_ESMFOLD residues.
//
// RULES: free and keyless, so no paid switch is involved. Only HTTPS to api.esmatlas.com, no redirect, a time limit on
// every request, a size limit on every answer, at most MAX_IN_FLIGHT folds at once in this process (more wait their
// turn). A failure is never kept. Only ESMFold is used here, for the reference too: a variant and its reference are
// compared only when the same model predicted both. (AlphaFold DB has no model of a variant.)
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { writeWhole } from "../fsx.ts"

export const ESMFOLD_HOST = "api.esmatlas.com"
export const ESMFOLD_URL = `https://${ESMFOLD_HOST}/foldSequence/v1/pdb/`
/** ESMFold's free API refuses longer sequences. */
export const MAX_ESMFOLD = 400
export const FOLD_TIMEOUT_MS = 30_000
export const MAX_BYTES = 8_000_000
export const MAX_IN_FLIGHT = 2
export const USER_AGENT = "ai-scientist-bot/0.1 (protein structure view; +https://github.com/itsbrendandang/agent-test)"
export const ESMFOLD_LABEL = "ESMFold (Meta AI), predicted through the ESM Metagenomic Atlas API"
const SEQUENCE = /^[ACDEFGHIKLMNPQRSTVWY]{1,400}$/

/** One predicted structure. The same shape as the Structure tab's `Structure` (model "esmfold"). */
export interface Folded {
  model: "esmfold"
  modelLabel: string
  link: string
  length: number
  sequence: string
  /** Mean pLDDT over the residues, 0-100. */
  meanPlddt: number
  /** PDB text; the B-factor column is pLDDT on a 0-100 scale. */
  pdb: string
  /** Read from the disk cache. */
  cached: boolean
  at: number
}
/** Fold one sequence. Throws FoldError with a plain message. */
export type Fold = (sequence: string) => Promise<Folded>

export class FoldError extends Error {}

export interface FoldDeps { dir: string; fetch?: typeof fetch; now?: () => number; timeoutMs?: number }

/** Per-residue pLDDT (0-100) from the CA atoms of a PDB text, by residue number. */
export function plddtByResidue(pdb: string): Map<number, number> {
  const out = new Map<number, number>()
  for (const line of pdb.split(/\r?\n/)) {
    if (!line.startsWith("ATOM  ") || line.length < 66 || line.slice(12, 16).trim() !== "CA") continue
    const residue = Number(line.slice(22, 26)), b = Number(line.slice(60, 66))
    if (Number.isInteger(residue) && Number.isFinite(b) && !out.has(residue)) out.set(residue, b)
  }
  return out
}

/** The PDB text kept: coordinates only, B-factors as pLDDT 0-100 (ESMFold's API writes 0-1). Throws when there are no atoms. */
export function cleanPdb(text: string): { pdb: string; residues: number; meanPlddt: number } {
  const lines = text.split(/\r?\n/).filter((l) => /^(?:ATOM  |HETATM|TER|MODEL |ENDMDL|END)/.test(l))
  const atoms = lines.filter((l) => l.startsWith("ATOM  ") && l.length >= 66)
  if (!atoms.length) throw new FoldError("ESMFold's structure file holds no atoms")
  const b = (l: string) => Number(l.slice(60, 66))
  const top = Math.max(...atoms.map(b).filter(Number.isFinite))
  const factor = top <= 1 ? 100 : 1
  const pdb = lines.map((l) => (factor === 1 || !(l.startsWith("ATOM  ") || l.startsWith("HETATM")) || l.length < 66 || !Number.isFinite(b(l)) ? l : `${l.slice(0, 60)}${(b(l) * factor).toFixed(2).padStart(6)}${l.slice(66)}`)).join("\n")
  const values = [...plddtByResidue(pdb).values()]
  const meanPlddt = values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : 0
  return { pdb, residues: values.length, meanPlddt }
}

export function createEsmFold(deps: FoldDeps): Fold {
  const fetchFn = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const timeoutMs = deps.timeoutMs ?? FOLD_TIMEOUT_MS
  const pending = new Map<string, Promise<Folded>>()
  let active = 0
  const queue: (() => void)[] = []
  const turn = async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => queue.push(resolve))
    active++
    try { return await work() } finally { active--; queue.shift()?.() }
  }
  const file = (sequence: string) => `${deps.dir}/${createHash("sha256").update(["esmfold", sequence].join("\n")).digest("hex")}.json`
  const kept = (sequence: string): Folded | undefined => {
    const f = file(sequence)
    if (!existsSync(f)) return undefined
    try { const s = JSON.parse(readFileSync(f, "utf8")) as Folded; return s.model === "esmfold" && typeof s.pdb === "string" && s.sequence === sequence ? { ...s, cached: true } : undefined } catch { return undefined }
  }
  const keep = (s: Folded) => { try { mkdirSync(deps.dir, { recursive: true }); writeWhole(file(s.sequence), JSON.stringify(s)) } catch { /* not kept: folded again next time */ } }

  async function fold(sequence: string): Promise<Folded> {
    let response: Response
    try {
      response = await fetchFn(ESMFOLD_URL, { method: "POST", body: sequence, headers: { "content-type": "text/plain", accept: "text/plain, chemical/x-pdb, */*", "user-agent": USER_AGENT }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      const name = error instanceof Error ? error.name : ""
      throw new FoldError(name === "TimeoutError" || name === "AbortError" ? `ESMFold did not answer in ${Math.round(timeoutMs / 1000)} seconds` : "ESMFold could not be reached")
    }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new FoldError(`ESMFold answered ${response.status}`) }
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new FoldError(`ESMFold sent more than ${MAX_BYTES / 1_000_000} MB`) }
      chunks.push(value)
    }
    const { pdb, residues, meanPlddt } = cleanPdb(Buffer.concat(chunks).toString("utf8"))
    const s: Folded = { model: "esmfold", modelLabel: ESMFOLD_LABEL, link: "https://esmatlas.com/about", length: residues || sequence.length, sequence, meanPlddt, pdb, cached: false, at: now() }
    keep(s)
    return s
  }

  return async (sequence: string) => {
    if (!SEQUENCE.test(sequence)) throw new FoldError(sequence.length > MAX_ESMFOLD ? `ESMFold's free API folds at most ${MAX_ESMFOLD} amino acids, and this sequence has ${sequence.length}` : "ESMFold folds only the 20 standard amino acids")
    const hit = kept(sequence)
    if (hit) return hit
    const same = pending.get(sequence)
    if (same) return same
    const work = turn(() => fold(sequence))
    pending.set(sequence, work)
    try { return await work } finally { pending.delete(sequence) }
  }
}
