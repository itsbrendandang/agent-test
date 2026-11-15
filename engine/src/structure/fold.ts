// A predicted 3D structure for one protein, for the Structure tab of the Search screen.
//
//   ESMFold (Meta AI's ESM model), through the free public API of the ESM Metagenomic Atlas:
//     POST https://api.esmatlas.com/foldSequence/v1/pdb/ with the sequence as the body; the answer is a PDB file whose
//     B-factor column holds the model's confidence (pLDDT, 0-1). The API folds at most MAX_ESMFOLD residues.
//   AlphaFold DB (Google DeepMind and EMBL-EBI): the model already computed for a UniProt accession,
//     GET https://alphafold.ebi.ac.uk/api/prediction/<accession>, then its pdbUrl. pLDDT is 0-100.
//   UniProt: the sequence of an accession, when the answer did not hold it: GET https://rest.uniprot.org/uniprotkb/<acc>.json.
//
// RULES: none of these needs a key and none costs money, so no paid switch is involved; a structure is fetched only when
// a person opens one, never while an answer is made, so it can never block or fail an answer. Only HTTPS to the three
// hosts in HOSTS, no redirects, a time limit on every request, a size limit on every answer. A good result is kept on
// disk under the hash of what was asked (board/runs/.structures/<sha256>.json) and read from there afterwards; a failure
// is never kept. Every reply names the model that produced the structure.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { writeWhole } from "../fsx.ts"
import { AMINO, isAccession, MAX_SEQUENCE } from "./proteins.ts"

export const HOSTS = { esmfold: "api.esmatlas.com", alphafold: "alphafold.ebi.ac.uk", uniprot: "rest.uniprot.org" } as const
export const ESMFOLD_URL = "https://api.esmatlas.com/foldSequence/v1/pdb/"
/** ESMFold's free API refuses longer sequences. */
export const MAX_ESMFOLD = 400
export const TIMEOUT_MS = { esmfold: 30_000, alphafold: 20_000, uniprot: 15_000 } as const
export const MAX_BYTES = 8_000_000
/** How long ESMFold's failure on one sequence is remembered (in memory only): meanwhile that sequence goes straight to AlphaFold DB, or gets the same error. */
export const FAILURE_MS = 10 * 60_000
/** Folds or downloads at once in this process; more are refused (429) rather than queued. */
export const MAX_IN_FLIGHT = 2
export const USER_AGENT = "ai-scientist-bot/0.1 (protein structure view; +https://github.com/itsbrendandang/agent-test)"

export type Model = "esmfold" | "alphafold"
export const MODEL_LABEL: Record<Model, string> = {
  esmfold: "ESMFold (Meta AI), predicted through the ESM Metagenomic Atlas API",
  alphafold: "AlphaFold (Google DeepMind and EMBL-EBI), from the AlphaFold Protein Structure Database",
}

export interface StructureAsk {
  /** The residues to fold. Without it the sequence of `accession` is read from UniProt. */
  sequence?: string
  /** A UniProt accession: the sequence when none is given, and AlphaFold DB's model when ESMFold cannot fold it. */
  accession?: string
  /** "alphafold": skip ESMFold. Default: ESMFold when the sequence fits, else AlphaFold DB. */
  prefer?: Model
}

export interface Structure {
  model: Model
  modelLabel: string
  /** A page about the model or the entry, for people. */
  link: string
  /** The UniProt entry, when there is an accession. */
  uniprot?: string
  accession?: string
  length: number
  /** The sequence the model is of, when known (AlphaFold DB says it; for ESMFold it is the sequence sent). */
  sequence?: string
  /** Mean pLDDT over the residues, 0-100. */
  meanPlddt: number
  /** PDB text: ATOM, HETATM, TER, MODEL, ENDMDL and END lines only. The B-factor column is pLDDT on a 0-100 scale. */
  pdb: string
  /** Read from the disk cache. */
  cached: boolean
  /** Why this model and not the other, in plain words. */
  note?: string
  at: number
}

/** A refusal or a failure with the HTTP status the route answers. */
export class StructureError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export interface FoldDeps {
  /** The folder for kept structures. */
  dir: string
  fetch?: typeof fetch
  now?: () => number
}

/** The PDB text kept: coordinates only, B-factors as pLDDT 0-100. Returns the text, the residue count and the mean pLDDT; throws when there are no atoms. */
export function cleanPdb(text: string, scale: "auto" | 1 | 100): { pdb: string; residues: number; meanPlddt: number } {
  const lines = text.split(/\r?\n/).filter((l) => /^(?:ATOM  |HETATM|TER|MODEL |ENDMDL|END)/.test(l))
  const atoms = lines.filter((l) => l.startsWith("ATOM  ") && l.length >= 66)
  if (!atoms.length) throw new StructureError(502, "the structure file holds no atoms")
  const b = (l: string) => Number(l.slice(60, 66))
  const top = Math.max(...atoms.map(b).filter(Number.isFinite))
  const factor = scale === "auto" ? (top <= 1 ? 100 : 1) : scale === 1 ? 100 : 1
  const out = lines.map((l) => (factor === 1 || !(l.startsWith("ATOM  ") || l.startsWith("HETATM")) || l.length < 66 || !Number.isFinite(b(l)) ? l : `${l.slice(0, 60)}${(b(l) * factor).toFixed(2).padStart(6)}${l.slice(66)}`))
  const ca = atoms.filter((l) => l.slice(12, 16).trim() === "CA")
  const values = ca.map((l) => b(l) * factor).filter(Number.isFinite)
  const meanPlddt = values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : 0
  return { pdb: out.join("\n"), residues: ca.length, meanPlddt }
}

/** A sequence as ESMFold takes it: capitals of the 20 amino acids, whitespace removed. undefined when it is not one. */
export function plainSequence(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const s = value.replace(/\s+/g, "").toUpperCase().replace(/\*$/, "")
  return s.length >= 1 && s.length <= MAX_SEQUENCE && AMINO.test(s) ? s : undefined
}

export function createFolder(deps: FoldDeps) {
  const fetchFn = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const pending = new Map<string, Promise<Structure>>()

  async function get(host: keyof typeof HOSTS, url: string, init: RequestInit = {}, accept = "application/json"): Promise<{ status: number; text: string }> {
    const target = new URL(url)
    if (target.protocol !== "https:" || target.host !== HOSTS[host] || target.username || target.password) throw new StructureError(500, `refused to call ${target.host}`)
    let response: Response
    try {
      response = await fetchFn(target.href, { ...init, headers: { accept, "user-agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS[host]) })
    } catch (error) {
      const name = error instanceof Error ? error.name : ""
      throw new StructureError(504, name === "TimeoutError" || name === "AbortError" ? `${NAMES[host]} did not answer in ${TIMEOUT_MS[host] / 1000} seconds` : `${NAMES[host]} could not be reached`)
    }
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new StructureError(502, `${NAMES[host]} sent more than ${MAX_BYTES / 1_000_000} MB`) }
      chunks.push(value)
    }
    return { status: response.status, text: Buffer.concat(chunks).toString("utf8") }
  }

  const keyOf = (parts: string[]) => createHash("sha256").update(parts.join("\n")).digest("hex")
  const file = (key: string) => `${deps.dir}/${key}.json`
  function kept(key: string): Structure | undefined {
    if (!existsSync(file(key))) return undefined
    try { const s = JSON.parse(readFileSync(file(key), "utf8")) as Structure; return typeof s.pdb === "string" && (s.model === "esmfold" || s.model === "alphafold") ? { ...s, cached: true } : undefined } catch { return undefined }
  }
  function keep(key: string, s: Structure): void {
    try { mkdirSync(deps.dir, { recursive: true }); writeWhole(file(key), JSON.stringify(s)) } catch { /* not kept: it is fetched again next time */ }
  }

  const sequences = new Map<string, string>() // accession -> sequence, read from UniProt once per process
  async function sequenceOf(accession: string): Promise<string> {
    const known = sequences.get(accession)
    if (known) return known
    const r = await get("uniprot", `https://rest.uniprot.org/uniprotkb/${accession}.json?fields=accession,sequence`)
    if (r.status === 404 || r.status === 400) throw new StructureError(404, `UniProt has no entry ${accession}`)
    if (r.status < 200 || r.status > 299) throw new StructureError(502, `UniProt answered ${r.status}`)
    let body: { sequence?: { value?: unknown } }
    try { body = JSON.parse(r.text) as typeof body } catch { throw new StructureError(502, "UniProt answered with something that is not JSON") }
    const s = plainSequence(body.sequence?.value)
    if (!s) throw new StructureError(502, `UniProt gave no usable sequence for ${accession}`)
    return s
  }

  const failed = new Map<string, { at: number; error: StructureError }>() // ESMFold's recent failures, by sequence key
  async function esmfold(sequence: string, accession?: string): Promise<Structure> {
    const key = keyOf(["esmfold", sequence])
    const hit = kept(key)
    if (hit) return hit
    const recent = failed.get(key)
    if (recent && now() - recent.at < FAILURE_MS) throw recent.error
    let pdb: string, residues: number, meanPlddt: number
    try {
      const r = await get("esmfold", ESMFOLD_URL, { method: "POST", body: sequence, headers: { "content-type": "text/plain" } }, "text/plain, chemical/x-pdb, */*")
      if (r.status < 200 || r.status > 299) throw new StructureError(502, `ESMFold answered ${r.status}`)
      ;({ pdb, residues, meanPlddt } = cleanPdb(r.text, "auto"))
    } catch (error) {
      if (error instanceof StructureError) failed.set(key, { at: now(), error })
      throw error
    }
    const s: Structure = { model: "esmfold", modelLabel: MODEL_LABEL.esmfold, link: "https://esmatlas.com/about", ...(accession ? { accession, uniprot: `https://www.uniprot.org/uniprotkb/${accession}/entry` } : {}), length: residues || sequence.length, sequence, meanPlddt, pdb, cached: false, at: now() }
    keep(key, s)
    return s
  }

  async function alphafold(accession: string): Promise<Structure> {
    const key = keyOf(["alphafold", accession])
    const hit = kept(key)
    if (hit) return hit
    const r = await get("alphafold", `https://alphafold.ebi.ac.uk/api/prediction/${accession}`)
    if (r.status === 404 || r.status === 422) throw new StructureError(404, `AlphaFold DB has no model for ${accession}`)
    if (r.status < 200 || r.status > 299) throw new StructureError(502, `AlphaFold DB answered ${r.status}`)
    let entries: { pdbUrl?: unknown; uniprotAccession?: unknown; sequence?: unknown }[]
    try { entries = JSON.parse(r.text) as typeof entries } catch { throw new StructureError(502, "AlphaFold DB answered with something that is not JSON") }
    const entry = Array.isArray(entries) ? entries.find((e) => e?.uniprotAccession === accession) ?? entries[0] : undefined
    const pdbUrl = typeof entry?.pdbUrl === "string" ? entry.pdbUrl : ""
    if (!/^https:\/\/alphafold\.ebi\.ac\.uk\/files\/[\w.-]+\.pdb$/.test(pdbUrl)) throw new StructureError(502, `AlphaFold DB gave no structure file for ${accession}`)
    const f = await get("alphafold", pdbUrl, {}, "chemical/x-pdb, text/plain, */*")
    if (f.status < 200 || f.status > 299) throw new StructureError(502, `AlphaFold DB answered ${f.status} for the structure file`)
    const { pdb, residues, meanPlddt } = cleanPdb(f.text, 100)
    const sequence = plainSequence(entry?.sequence)
    const s: Structure = { model: "alphafold", modelLabel: MODEL_LABEL.alphafold, link: `https://alphafold.ebi.ac.uk/entry/${accession}`, accession, uniprot: `https://www.uniprot.org/uniprotkb/${accession}/entry`, length: residues, ...(sequence ? { sequence } : {}), meanPlddt, pdb, cached: false, at: now() }
    keep(key, s)
    return s
  }

  /** The structure asked for. Throws StructureError with a plain message when there is none. */
  async function structure(ask: StructureAsk): Promise<Structure> {
    const accession = ask.accession === undefined ? undefined : isAccession(ask.accession) ? ask.accession : (() => { throw new StructureError(400, "accession must be a UniProt accession, such as P01116") })()
    const given = ask.sequence === undefined ? undefined : plainSequence(ask.sequence) ?? (() => { throw new StructureError(400, `sequence must be 1 to ${MAX_SEQUENCE} letters of the 20 standard amino acids`) })()
    if (!given && !accession) throw new StructureError(400, "send a sequence or a UniProt accession")
    const key = keyOf([ask.prefer ?? "", given ?? "", accession ?? ""])
    const same = pending.get(key)
    if (same) return same
    if (pending.size >= MAX_IN_FLIGHT) throw new StructureError(429, `${MAX_IN_FLIGHT} structures are being fetched now. Try again in a moment.`)
    const work = (async () => {
      if (ask.prefer === "alphafold") {
        if (!accession) throw new StructureError(400, "AlphaFold DB needs a UniProt accession")
        return alphafold(accession)
      }
      let sequence = given
      if (!sequence) {
        try { sequence = await sequenceOf(accession!) } catch (error) {
          if (error instanceof StructureError && error.status === 404) throw error
          return { ...(await alphafold(accession!)), note: `AlphaFold DB's model is shown because the sequence could not be read from UniProt (${error instanceof Error ? error.message : "it failed"}).` }
        }
        sequences.set(accession!, sequence)
      }
      const long = sequence.length > MAX_ESMFOLD
      if (long && !accession) throw new StructureError(422, `ESMFold's free API folds at most ${MAX_ESMFOLD} amino acids, and this sequence has ${sequence.length}. With a UniProt accession, AlphaFold DB's model could be shown instead.`)
      if (long) return { ...(await alphafold(accession!)), note: `AlphaFold DB's model is shown because this protein has ${sequence.length} amino acids, and ESMFold's free API folds at most ${MAX_ESMFOLD}.` }
      try { return await esmfold(sequence, accession) } catch (error) {
        if (!accession || (error instanceof StructureError && error.status === 400)) throw error
        const why = error instanceof Error ? error.message : "ESMFold failed"
        const af = await alphafold(accession)
        const differs = af.sequence !== sequence // a fragment or a variant: the model is of the whole entry
        return { ...af, note: `AlphaFold DB's model is shown because ESMFold could not be used (${why}).${differs ? " It is the model of the whole UniProt entry, which differs from the sequence asked for." : ""}` }
      }
    })()
    pending.set(key, work)
    try { return await work } finally { pending.delete(key) }
  }

  return { structure }
}

const NAMES: Record<keyof typeof HOSTS, string> = { esmfold: "ESMFold (ESM Atlas)", alphafold: "AlphaFold DB", uniprot: "UniProt" }
