// One vocabulary for verdicts. A board checker rules a claim verified, contradicted, unsupported or unchecked; the
// swarm's ledger computes supported, refuted, insufficient or untested. They mean the same three things, and each
// has a glyph so colour is never the only signal (the glyphs are added in CSS on .v-* and .sv-*):
//   ✓ holds (verified, supported)   ✕ does not hold (contradicted, refuted)   ? not known (the rest)
import type { BoardEvent, Verdict } from "@/board/api"
import type { ClaimVerdict } from "@/swarm/api"

export type Outcome = "holds" | "fails" | "unknown"
export const outcomeOf = (verdict: Verdict | ClaimVerdict): Outcome =>
  verdict === "verified" || verdict === "supported" ? "holds" : verdict === "contradicted" || verdict === "refuted" ? "fails" : "unknown"
export const GLYPH: Record<Outcome, string> = { holds: "✓", fails: "✕", unknown: "?" }
/** What does not hold comes first, then what is not known: that is what a reader must not miss. */
const RANK: Record<Outcome, number> = { fails: 0, unknown: 1, holds: 2 }
export const byConcern = <T extends { verdict: Verdict | ClaimVerdict }>(claims: T[]): T[] =>
  claims.map((c, i) => ({ c, i })).sort((a, b) => RANK[outcomeOf(a.c.verdict)] - RANK[outcomeOf(b.c.verdict)] || a.i - b.i).map((x) => x.c)

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
