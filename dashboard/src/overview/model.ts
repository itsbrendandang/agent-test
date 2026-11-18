// The Overview's numbers. Pure: the runs the engine lists in, counts out. A run counts as
// research only when its own record says it was made with real models ("live") or a model on this computer
// ("local"). A practice run is counted apart and never added to "research done". A run whose record does not say
// yet (a team review whose first event has not been read) is "unknown" and is not claimed as either.
import type { RunRef } from "@/lab/runs"
import type { RunKind } from "@/lab/model"

export type Made = "research" | "practice" | "unknown"
export const madeOf = (run: Pick<RunRef, "provenance">): Made => (run.provenance === "practice" ? "practice" : run.provenance === "live" || run.provenance === "local" ? "research" : "unknown")

export const KINDS: readonly RunKind[] = ["answer", "board", "swarm"]
/** What a person reads for each kind of run. */
export const KIND_LABEL: Record<RunKind, string> = { answer: "Research answers", board: "Team reviews", swarm: "Benchmark runs" }

export interface Totals {
  all: number
  research: number
  practice: number
  unknown: number
  inProgress: number
  failed: number
  byKind: Record<RunKind, { all: number; research: number; practice: number }>
}

export function totalsOf(runs: readonly RunRef[]): Totals {
  runs = runs.filter((r) => r.provenance !== "example")
  const byKind = Object.fromEntries(KINDS.map((k) => [k, { all: 0, research: 0, practice: 0 }])) as Totals["byKind"]
  const totals: Totals = { all: runs.length, research: 0, practice: 0, unknown: 0, inProgress: 0, failed: 0, byKind }
  for (const run of runs) {
    const made = madeOf(run)
    totals[made]++
    if (run.live) totals.inProgress++
    if (run.status === "failed") totals.failed++
    const kind = byKind[run.kind]
    if (!kind) continue
    kind.all++
    if (made !== "unknown") kind[made]++
  }
  return totals
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const midnight = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }

/** "Today", "Yesterday", or "12 Nov" (with the year when it is not this one). */
export function dayName(ms: number, now: Date = new Date()): string {
  const days = Math.round((midnight(now.getTime()) - midnight(ms)) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`}`
}
