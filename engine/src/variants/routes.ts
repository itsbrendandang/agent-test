// Known variants of a protein and their predicted structures, over HTTP (known.ts, compare.ts, fold.ts).
//
//   GET /api/variants/compare?accession=<UniProt>&variants=G12D,G13D
//       folds the reference and each named variant with ESMFold and gives the model's confidence (pLDDT) at the
//       changed position in each, and its change. Only variants UniProt reports for that entry are accepted: nothing
//       new is predicted or proposed.
//
// Free and keyless (no paid switch is involved), only read, and open to local callers like the other reads. Folds are
// made only when a person asks for them (the Variants tab of an answer), and kept on disk afterwards (fold.ts).
import type { IncomingMessage, ServerResponse } from "node:http"
import { type BoardConfig, path } from "../config.ts"
import { liveHttp, type Http, ServiceError } from "../sources/shared.ts"
import { ACCESSION } from "../sources/uniprot.ts"
import { compareVariants, COMPARE_TIMEOUT_MS } from "./compare.ts"
import { createEsmFold, ESMFOLD_LABEL, type Fold } from "./fold.ts"
import { CHANGE, MAX_VARIANTS, readEntry } from "./known.ts"

/** Comparisons running at once in this process; more are refused (429) rather than queued. */
export const MAX_COMPARES = 2

export interface VariantsOptions {
  /** The UniProt request path (tests: a fake). Default: the database clients' live one, with its spacing and its cache. */
  http?: Http
  /** The fold service (tests: a fake). Default: ESMFold, kept in `dir`. */
  fold?: Fold
  fetch?: typeof fetch
  dir?: string
  timeoutMs?: number
}

/** Where kept structures live: board/runs/.structures/ (DRUG_BOARD_RUNS_DIR moves it with the rest). Shared with the Structure tab. */
export const structureDir = (config: BoardConfig): string => path(config, "runs", ".structures")

export function createVariants(config: BoardConfig, options: VariantsOptions = {}) {
  const http = options.http ?? liveHttp
  const fold = options.fold ?? createEsmFold({ dir: options.dir ?? structureDir(config), fetch: options.fetch })
  let comparing = 0
  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" })
    res.end(JSON.stringify(body))
  }

  async function handle(req: IncomingMessage, res: ServerResponse, parts: string[], url: URL): Promise<void> {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" })
    if (parts.length !== 3 || parts[2] !== "compare") return json(res, 404, { error: "not found" })
    const accession = (url.searchParams.get("accession") ?? "").trim().toUpperCase()
    if (!ACCESSION.test(accession)) return json(res, 400, { error: "accession must be a UniProt accession, such as P01116" })
    const asked = [...new Set((url.searchParams.get("variants") ?? "").split(",").map((v) => v.trim().toUpperCase()).filter(Boolean))]
    if (!asked.length || asked.length > MAX_VARIANTS || !asked.every((v) => CHANGE.test(v))) return json(res, 400, { error: `variants must be 1 to ${MAX_VARIANTS} substitutions written like G12D, separated by commas` })
    if (comparing >= MAX_COMPARES) return json(res, 429, { error: `${MAX_COMPARES} comparisons are being predicted now. Try again in a moment.` })
    comparing++
    try {
      let entry
      try { entry = await readEntry({ accession }, http) } catch (error) {
        return json(res, 502, { error: error instanceof ServiceError ? error.message : "UniProt could not be read" })
      }
      if (!entry) return json(res, 404, { error: `UniProt has no entry ${accession}` })
      const known = new Map(entry.all.map((v) => [v.id, v]))
      const unknown = asked.filter((v) => !known.has(v))
      if (unknown.length) return json(res, 400, { error: `UniProt reports no substitution ${unknown.join(", ")} with a cited paper for ${accession}. Only reported variants are compared; nothing new is predicted.` })
      json(res, 200, await compareVariants(entry, asked.map((v) => known.get(v)!), fold, { timeoutMs: options.timeoutMs ?? COMPARE_TIMEOUT_MS, modelLabel: ESMFOLD_LABEL }))
    } finally { comparing-- }
  }

  return { handle }
}
