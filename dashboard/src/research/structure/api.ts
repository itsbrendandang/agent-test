// Calls for the Structure tab: a protein's predicted 3D structure (GET /api/structure) and the built-in test proteins
// (GET /api/structure/tests). Both are free and keyless on the engine (engine/src/structure/), and only read.
import { ENGINE, tracked } from "@/lib/engine"
import type { Protein } from "../model"

export type Model = "esmfold" | "alphafold"
export interface Structure {
  model: Model; modelLabel: string; link: string; uniprot?: string; accession?: string
  length: number; meanPlddt: number; pdb: string; cached: boolean; note?: string; at: number
  /** The sequence the model is of, when the engine knows it. */
  sequence?: string
}
export interface TestProtein {
  id: string; name: string; label: string; gene: string; organism: string; accession: string; entry: string; uniprot: string
  uniprotLength: number; range?: [number, number]; mutation?: string; length: number; sequence: string; question: string; about: string
}

/** What to ask the engine for, for one protein: a test protein by id, a sequence (with its accession for the fallback), or an accession. `retry`: a person asked again, so a recent ESMFold failure is not reused. */
export function structureQuery(p: Protein, prefer?: Model, retry = false): string {
  const q = new URLSearchParams()
  if (p.key.startsWith("test:")) q.set("test", p.key.slice(5))
  else {
    if (p.sequence) q.set("sequence", p.sequence)
    if (p.accession) q.set("accession", p.accession)
  }
  if (prefer) q.set("prefer", prefer)
  if (retry) q.set("retry", "1")
  return q.toString()
}

const MODELS: Model[] = ["esmfold", "alphafold"]
/** A reply as the page may use it: the model must be one of the two, the PDB text must hold atoms, links must be the services' own https pages. */
export function readStructure(body: unknown): Structure | undefined {
  const b = body as Record<string, unknown> | null
  if (!b || !MODELS.includes(b.model as Model) || typeof b.pdb !== "string" || !b.pdb.includes("ATOM")) return undefined
  const link = (v: unknown, host: RegExp) => (typeof v === "string" && host.test(v) ? v : undefined)
  return {
    model: b.model as Model, modelLabel: typeof b.modelLabel === "string" ? b.modelLabel : String(b.model), pdb: b.pdb,
    link: link(b.link, /^https:\/\/(?:esmatlas\.com|alphafold\.ebi\.ac\.uk)\//) ?? (b.model === "esmfold" ? "https://esmatlas.com/about" : "https://alphafold.ebi.ac.uk/"),
    uniprot: link(b.uniprot, /^https:\/\/www\.uniprot\.org\/uniprotkb\/[A-Z0-9]{6,10}\/entry$/), accession: typeof b.accession === "string" ? b.accession : undefined,
    length: typeof b.length === "number" ? b.length : 0, meanPlddt: typeof b.meanPlddt === "number" ? b.meanPlddt : 0,
    cached: b.cached === true, note: typeof b.note === "string" ? b.note : undefined, at: typeof b.at === "number" ? b.at : 0,
  }
}

/** A structure that could not be fetched. `retry`: trying again may help (the engine or a service failed, or was busy); false when the request itself cannot be served. */
export class StructureFailed extends Error {
  retry: boolean
  constructor(message: string, retry = true) { super(message); this.retry = retry }
}

/** One structure. Rejects with StructureFailed and a plain message. */
export async function fetchStructure(p: Protein, prefer?: Model, signal?: AbortSignal, retry = false): Promise<Structure> {
  let r: Response
  try { r = await tracked(fetch(`${ENGINE}/api/structure?${structureQuery(p, prefer, retry)}`, { signal })) }
  catch (error) {
    if (signal?.aborted) throw error
    throw new StructureFailed("The app's engine isn't running, so the structure could not be fetched. Start it with: npm start.")
  }
  const body = await r.json().catch(() => undefined) as { error?: unknown } | undefined
  if (r.status === 404 && !body?.error) throw new StructureFailed("This engine has no structure route yet. Update and restart it.")
  if (!r.ok) throw new StructureFailed(typeof body?.error === "string" ? body.error : `The engine answered ${r.status}.`, r.status >= 500 || r.status === 429)
  const s = readStructure(body)
  if (!s) throw new StructureFailed("The engine sent a structure this page could not read.")
  return s
}

/** The built-in test proteins, or [] when the engine is not running or has none. */
export async function fetchTestProteins(): Promise<TestProtein[]> {
  try {
    const r = await tracked(fetch(`${ENGINE}/api/structure/tests`))
    if (!r.ok) return []
    const body = await r.json() as { items?: unknown }
    return Array.isArray(body.items) ? (body.items as TestProtein[]).filter((t) => t && typeof t.id === "string" && typeof t.name === "string" && typeof t.sequence === "string") : []
  } catch { return [] }
}

/** A test protein as a protein of the Structure tab. */
export const testAsProtein = (t: TestProtein): Protein => ({
  key: `test:${t.id}`, name: t.name, accession: t.accession, gene: t.gene || undefined, organism: t.organism, length: t.length, sequence: t.sequence, from: "test",
  note: [t.range && `Residues ${t.range[0]}-${t.range[1]} of ${t.uniprotLength}`, t.mutation && `${t.mutation} variant`].filter(Boolean).join(", ") || undefined,
})
