// The Exa account holds a fixed amount of money that is not topped up, so Exa spend is counted three ways:
//   per run    meeting.max_searches searches, and their cost counts toward meeting.max_usd (board.ts totalUsd);
//   per day    through the run's saved spend, so it is inside meeting.daily_usd (board.ts spentToday);
//   lifetime   this file: board/runs/.exa-ledger.jsonl, one line per money movement, appended and never rewritten,
//              summed before every search and checked against meeting.exa_ceiling_usd (default $40, under the real
//              $50 to leave room for searches made outside this engine, for example by the Python swarm).
// Scripted runs never write here. A line is either a "reserve" written BEFORE a search (at the assumed price, so
// searches running in parallel cannot all pass the check) or an "adjust" written after it: the difference to the cost
// Exa reported, or minus the reservation when the search failed.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { type BoardConfig, path } from "../config.ts"
import { mirrorExa } from "../db/supabase.ts"

/** ASSUMPTION: $0.007 per search, measured once from two live searches ($0.014); a small sample, not a contract price. */
export const EXA_ASSUMED_USD = 0.007
export const EXA_CEILING_USD = 40
export const DEFAULT_MAX_SEARCHES = 20

export interface ExaEntry {
  at: number
  runId: string
  callId: string
  usd: number
  kind: "reserve" | "adjust"
  /** reserve: "assumed". adjust: "reported" (Exa's costDollars replaced the assumption) or "refund" (the search failed). */
  basis: "assumed" | "reported" | "refund"
}

export const exaLedgerFile = (config: BoardConfig) => path(config, "runs", ".exa-ledger.jsonl")
export const exaCeiling = (config: BoardConfig) => config.meeting.exa_ceiling_usd ?? EXA_CEILING_USD
export const exaAssumed = (config: BoardConfig) => config.meeting.exa_usd_per_search ?? EXA_ASSUMED_USD
export const maxSearches = (config: BoardConfig) => config.meeting.max_searches ?? DEFAULT_MAX_SEARCHES

/** Total Exa spend recorded in the file. A line that cannot be read counts as one assumed search: the total never shrinks by damage. */
export function exaTotal(file: string, assumed = EXA_ASSUMED_USD): number {
  if (!existsSync(file)) return 0
  let total = 0
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as Partial<ExaEntry>
      total += typeof e.usd === "number" && Number.isFinite(e.usd) ? e.usd : assumed
    } catch { total += assumed }
  }
  return Math.max(0, total)
}

const append = (file: string, entry: ExaEntry) => { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify(entry) + "\n"); mirrorExa(entry) }

/** What a refusal at the ceiling says. */
export const ceilingMessage = (total: number, ceiling: number) =>
  `Exa search refused: this engine has recorded $${total.toFixed(2)} of Exa spend, and the ceiling is $${ceiling.toFixed(2)} (meeting.exa_ceiling_usd in board/config.yaml). The Exa account is a fixed amount that is not topped up. Raise the ceiling only if the account still has credit. No fixture results are used in its place.`

/** Reserve one search at the assumed price, or refuse when the total plus it would pass the ceiling. */
export function reserveSearch(config: BoardConfig, runId: string, callId: string, now = Date.now()): { ok: true; reserved: number } | { ok: false; message: string } {
  const file = exaLedgerFile(config), ceiling = exaCeiling(config), usd = exaAssumed(config)
  const total = exaTotal(file, usd)
  if (total + usd > ceiling) return { ok: false, message: ceilingMessage(total, ceiling) }
  append(file, { at: now, runId, callId, usd, kind: "reserve", basis: "assumed" })
  return { ok: true, reserved: usd }
}

/** After a search: replace the reservation by the cost Exa reported, or cancel it when the search failed (`reported` undefined, failed true). */
export function settleSearch(config: BoardConfig, runId: string, callId: string, reserved: number, result: { reported?: number; failed?: boolean }, now = Date.now()): { usd: number; basis: "reported" | "assumed" } {
  const file = exaLedgerFile(config)
  if (result.failed) { append(file, { at: now, runId, callId, usd: -reserved, kind: "adjust", basis: "refund" }); return { usd: 0, basis: "assumed" } }
  if (result.reported === undefined) return { usd: reserved, basis: "assumed" }
  if (result.reported !== reserved) append(file, { at: now, runId, callId, usd: result.reported - reserved, kind: "adjust", basis: "reported" })
  return { usd: result.reported, basis: "reported" }
}
