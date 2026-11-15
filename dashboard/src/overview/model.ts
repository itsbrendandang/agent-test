// The Overview's numbers. Pure: the runs the engine lists in, counts and one bar per day out. A run counts as
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

export interface Day {
  /** Local midnight of the day, ms. */
  at: number
  /** "14 Nov". */
  label: string
  research: number
  practice: number
  unknown: number
  total: number
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const midnight = (ms: number) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }

/** One entry per day for the last `days` days ending today, oldest first. A run with no start time is left out. */
export function perDay(runs: readonly RunRef[], days = 14, now: Date = new Date()): Day[] {
  const out: Day[] = []
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    out.push({ at: d.getTime(), label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, research: 0, practice: 0, unknown: 0, total: 0 })
  }
  const index = new Map(out.map((day, i) => [day.at, i]))
  for (const run of runs) {
    if (!run.startedAt) continue
    const i = index.get(midnight(run.startedAt))
    if (i === undefined) continue
    out[i][madeOf(run)]++
    out[i].total++
  }
  return out
}

/** A round number at or above the tallest bar, for the chart's scale: 1, 2, 5, 10, 20, 50... */
export function niceTop(max: number): number {
  if (max <= 1) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 5, 10]) if (step * power >= max) return step * power
  return 10 * power
}
