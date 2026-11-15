// Protein structures over HTTP, for the Structure tab of the Search screen (fold.ts, proteins.ts).
//
//   GET /api/structure/tests                         the built-in test proteins (test-proteins.json), with their sequences
//   GET /api/structure?test=<id>                     the structure of one test protein
//   GET /api/structure?accession=<UniProt>           the structure of a UniProt entry (its sequence is read from UniProt)
//   GET /api/structure?sequence=<residues>[&accession=]   the structure of a sequence (the accession allows AlphaFold DB as a fallback)
//       &prefer=alphafold                            AlphaFold DB's model instead of an ESMFold prediction
//       &retry=1                                     a person asked again: ESMFold is asked even after a recent failure
//
// Free and keyless (no paid switch is involved), only read, and open to local callers like the other reads. A structure is
// fetched only when a person opens one, and kept on disk afterwards (fold.ts).
import type { IncomingMessage, ServerResponse } from "node:http"
import { type BoardConfig, path } from "../config.ts"
import { HttpError } from "../http.ts"
import { createFolder, type FoldDeps, type Model, StructureError } from "./fold.ts"
import { testProteins } from "./proteins.ts"

export interface StructureOptions { fetch?: FoldDeps["fetch"]; now?: FoldDeps["now"]; dir?: string }

/** Where kept structures live: board/runs/.structures/ (DRUG_BOARD_RUNS_DIR moves it with the rest). */
export const structureDir = (config: BoardConfig): string => path(config, "runs", ".structures")

/** A test protein as the dashboard lists it. */
export const testList = () => testProteins().map((t) => ({ ...t, uniprot: `https://www.uniprot.org/uniprotkb/${t.accession}/entry` }))

export function createStructure(config: BoardConfig, options: StructureOptions = {}) {
  const folder = createFolder({ dir: options.dir ?? structureDir(config), fetch: options.fetch, now: options.now })
  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" })
    res.end(JSON.stringify(body))
  }

  async function handle(req: IncomingMessage, res: ServerResponse, parts: string[], url: URL): Promise<void> {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" })
    if (parts.length === 3 && parts[2] === "tests") return json(res, 200, { items: testList() })
    if (parts.length !== 2) throw new HttpError(404, "not found")
    const q = url.searchParams
    const prefer = q.get("prefer")
    if (prefer !== null && prefer !== "esmfold" && prefer !== "alphafold") return json(res, 400, { error: "prefer must be esmfold or alphafold" })
    let sequence = q.get("sequence") ?? undefined, accession = q.get("accession")?.trim().toUpperCase() || undefined
    const testId = q.get("test")
    if (testId !== null) {
      const t = testProteins().find((p) => p.id === testId)
      if (!t) return json(res, 404, { error: "no such test protein" })
      sequence = t.sequence; accession = t.accession
    }
    try {
      json(res, 200, await folder.structure({ sequence, accession, ...(prefer ? { prefer: prefer as Model } : {}), ...(q.get("retry") === "1" ? { retry: true } : {}) }))
    } catch (error) {
      if (error instanceof StructureError) return json(res, error.status, { error: error.message })
      throw error
    }
  }

  return { handle }
}
