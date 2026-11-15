// What the research answers spent today, for the board's daily cap (board.ts spentToday adds this, so one
// `meeting.daily_usd` holds for board runs and answers together). Kept apart from the rest of research/ and free of
// imports from it, because board.ts imports this file.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { type BoardConfig, path } from "../config.ts"

/** The folder that holds one folder per answer: board/runs/.research/<id>/ (events.jsonl and record.json). */
export const researchRoot = (config: BoardConfig): string => path(config, "runs", ".research")

const two = (n: number) => String(n).padStart(2, "0")
/** The day part of an answer id, in local time: an id is "a-YYYYMMDDHHMMSS-<random>". */
export const dayStamp = (d: Date): string => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`

/** After this long an answer marked "running" cannot be running any more: its time limit, plus a minute. */
export const staleAfterMs = (maxSeconds: number): number => (maxSeconds + 60) * 1000

/**
 * Dollars the answers started today have spent (local day, read from each record.json). A demo answer costs nothing.
 * An answer still in progress counts for its whole cap, so several started together cannot each pass the daily check
 * at $0; one left "running" by a crash counts for what it had recorded once its time limit is long past. A record
 * that cannot be read counts for nothing here: its Exa spend is in the Exa ledger, and no model call is made without
 * the record having been written first.
 */
export function researchSpentToday(config: BoardConfig, now = new Date()): number {
  const root = researchRoot(config)
  if (!existsSync(root)) return 0
  const prefix = `a-${dayStamp(now)}`
  let usd = 0
  for (const id of readdirSync(root)) {
    if (!id.startsWith(prefix)) continue
    let r: { mode?: unknown; status?: unknown; usd?: unknown; startedAt?: unknown; caps?: { maxUsd?: unknown; maxSeconds?: unknown } }
    try { r = JSON.parse(readFileSync(`${root}/${id}/record.json`, "utf8")) } catch { continue }
    if (r.mode !== "real") continue
    const spent = typeof r.usd === "number" && Number.isFinite(r.usd) && r.usd > 0 ? r.usd : 0
    const cap = typeof r.caps?.maxUsd === "number" && Number.isFinite(r.caps.maxUsd) ? r.caps.maxUsd : 0
    const limit = typeof r.caps?.maxSeconds === "number" ? r.caps.maxSeconds : 120
    const live = r.status === "running" && typeof r.startedAt === "number" && now.getTime() - r.startedAt < staleAfterMs(limit)
    usd += live ? Math.max(spent, cap) : spent
  }
  return usd
}
