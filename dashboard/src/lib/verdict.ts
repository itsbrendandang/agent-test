// The checks' own verdict words, and what a team review's event stream says about itself. A board checker rules a
// statement verified, contradicted, unsupported or unchecked; the swarm's notes compute supported, refuted,
// insufficient or untested. What a person reads is one of four marks (lib/words.ts: markOf, MARK_WORD, MARK_GLYPH).
// `Outcome` is the coarser three-way grouping the graph draws by (shape and colour).
import type { BoardEvent, Verdict } from "@/board/api"
import type { ClaimVerdict } from "@/swarm/api"
import { markOf } from "./words"

export type Outcome = "holds" | "fails" | "unknown"
export const outcomeOf = (verdict: Verdict | ClaimVerdict): Outcome =>
  verdict === "verified" || verdict === "supported" ? "holds" : verdict === "contradicted" || verdict === "refuted" ? "fails" : "unknown"
export const GLYPH: Record<Outcome, string> = { holds: "✓", fails: "✕", unknown: "?" }
export type CheckedClaim = Extract<BoardEvent, { type: "claim.checked" }>
/** What a board review's event stream says about itself. */
export function boardFacts(events: BoardEvent[]) {
  const claims = events.filter((e): e is CheckedClaim => e.type === "claim.checked")
  const count = (v: Verdict) => claims.filter((c) => c.verdict === v).length
  const started = events.find((e) => e.type === "run.started")
  const memo = events.find((e) => e.type === "memo.written")
  const failed = events.find((e) => e.type === "run.failed")
  const done = events.find((e) => e.type === "run.finished")
  return {
    claims,
    verified: count("verified"), contradicted: count("contradicted"), unsupported: count("unsupported"), unchecked: count("unchecked"),
    sources: new Set(events.flatMap((e) => (e.type === "evidence.triaged" ? e.items.map((i) => i.url) : []))).size,
    rounds: new Set(events.flatMap((e) => (e.type === "round.started" ? [e.round] : []))).size,
    scripted: started?.type === "run.started" ? started.mock : undefined,
    title: started?.type === "run.started" ? started.title : undefined,
    decision: memo?.type === "memo.written" ? memo.decision : undefined,
    error: failed?.type === "run.failed" ? failed.error : undefined,
    state: (failed ? "failed" : done ? "done" : "running") as "failed" | "done" | "running",
  }
}

/** One reason statements went unchecked: how many, the check record's own note, and the same in plain words. */
export interface Unchecked { n: number; /** The engine's words, as recorded on the check. */ note: string; /** "are calculations, which the checker does not re-run" */ plain: string }
const clause = (note: string) => note.split(/[:(;.]/)[0].trim()
/** Plain words for a note the page knows; the note's own first clause, quoted, for one it does not. Never invented. */
function plainReason(note: string, n: number): string {
  const one = n === 1
  if (!note) return one ? "has no reason recorded" : "have no reason recorded"
  if (/not re-?executed|not re-?run|cannot run code/i.test(note)) return one ? "is a calculation, which the checker does not re-run" : "are calculations, which the checker does not re-run"
  if (/budget (used up|spent|exhausted|ran out)/i.test(note)) return one ? "was left when the second-check budget ran out" : "were left when the second-check budget ran out"
  if (/carried over/i.test(note)) return one ? "kept an earlier ruling and was not checked again" : "kept an earlier ruling and were not checked again"
  return `${one ? "was" : "were"} not checked (the record says: “${clause(note)}”)`
}
/**
 * Why statements were not checked, read from the check records' own notes and grouped by the note's first clause,
 * largest group first. Every unchecked statement is in exactly one group, so the counts add up to the total.
 */
export function uncheckedReasons(claims: readonly { verdict: unknown; note?: string }[]): Unchecked[] {
  const groups = new Map<string, { n: number; note: string }>()
  for (const c of claims) {
    if (markOf(c.verdict) !== "unchecked") continue
    const note = (c.note ?? "").replace(/\s+/g, " ").trim()
    const key = clause(note).toLowerCase()
    const g = groups.get(key)
    if (g) g.n++; else groups.set(key, { n: 1, note })
  }
  return [...groups.values()].sort((a, b) => b.n - a.n).map((g) => ({ ...g, plain: plainReason(g.note, g.n) }))
}
