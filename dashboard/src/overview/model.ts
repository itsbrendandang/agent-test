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

// ---- The activity log ---------------------------------------------------------------------------------------
export interface Entry {
  key: string
  kind: RunKind
  /** The engine name of the agent whose face stands for the run (identity.ts decides the face). */
  agent: string
  /** Who did it, as a person reads it. */
  actor: string
  /** What they did, in a few muted words. */
  verb: string
  /** What it was about: the question, the brief or the task. Untrusted text. */
  object: string
  at: number
  /** "9:12 am". */
  time: string
  failed: boolean
  provenance: RunRef["provenance"]
}
export interface DayGroup { day: string; entries: Entry[] }

const clock = (ms: number) => { const d = new Date(ms), h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}` }
/** "Today", "Yesterday", or "12 Nov" (with the year when it is not this one). */
export function dayName(ms: number, now: Date = new Date()): string {
  const days = Math.round((midnight(now.getTime()) - midnight(ms)) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`}`
}
/** Who stands for a run of each kind, and the words for what they did. A run still going or failed says so. */
function told(run: RunRef): Pick<Entry, "agent" | "actor" | "verb" | "object"> {
  const going = run.live, failed = run.status === "failed", stopped = run.status === "cancelled"
  const verb = (done: string) => (going ? "is working on" : failed ? "failed on" : stopped ? "stopped work on" : done)
  if (run.kind === "answer") return { agent: "reporter", actor: "Reporter", verb: verb("wrote an answer to"), object: run.title }
  if (run.kind === "board") return { agent: "lead-scientist", actor: "Lead Scientist", verb: verb("led a team review of"), object: run.title }
  const [who, ...rest] = run.title.split(" on ")
  const alone = /^one agent/i.test(who)
  return { agent: alone ? "experimenter" : "scout", actor: alone ? "One agent" : "Team of nine", verb: verb(alone ? "worked alone on" : "worked through"), object: rest.join(" on ") || run.title }
}
/** The newest runs as a log, grouped by day, newest first. A run with no start time is left out. */
export function activityOf(runs: readonly RunRef[], limit = 8, now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = []
  for (const run of runs.filter((r) => r.startedAt).slice(0, limit)) {
    const day = dayName(run.startedAt, now)
    const entry: Entry = { key: `${run.kind}/${run.id}`, kind: run.kind, ...told(run), at: run.startedAt, time: clock(run.startedAt), failed: run.status === "failed", provenance: run.provenance }
    const last = groups.at(-1)
    if (last && last.day === day) last.entries.push(entry); else groups.push({ day, entries: [entry] })
  }
  return groups
}
