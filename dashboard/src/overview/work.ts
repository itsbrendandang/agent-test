// The Overview's data. Pure: the three lists the engine serves in, one list of work out, and the numbers the page
// shows, all read from what the engine recorded. Nothing here is estimated: a number the records do not hold is
// undefined, and the page says so instead of showing a made-up value. Example runs (the read-only library) are never
// counted, and practice runs (scripted models, $0) are never added to research.
import { answerRuns, boardRuns, mergeRuns, swarmRuns, type RunRef } from "@/lab/runs"
import type { RunKind } from "@/lab/model"
import { madeOf, type Made } from "./model"

export interface Checks { verified: number; contradicted: number; unsupported: number; unchecked: number }

/** One run of any kind, as the Overview reads it: the shared run line plus what its list says about cost and progress. */
export interface Work extends RunRef {
  /** Dollars the run has recorded so far (answers and team reviews). Undefined: the list does not say (benchmark runs). */
  usd?: number
  /** The run's own dollar cap (answers). */
  maxUsd?: number
  /** When the work itself began (an answer that waited in a queue starts later than it was asked). */
  workStartedAt?: number
  finishedAt?: number
  /** Seconds the answer took, as the engine recorded it when it finished. */
  seconds?: number
  /** The step running now, as the engine's record says, with who does it. */
  step?: { label: string; agent?: string }
  /** The engine names of the agents that have worked on it so far. */
  agents: string[]
  /** Searches that ran. */
  searches?: number
  /** Sources kept and cited (answers). */
  sources?: { kept: number; cited: number }
  /** Checked statements (answers) or claims (team reviews), by verdict. */
  checks?: Checks
  /** The research thread of an answer, to open it in Research. */
  thread?: string
}

type Rec = Record<string, unknown>
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((x): x is Rec => !!x && typeof x === "object") : [])
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 30) : [])
const checksOf = (v: unknown): Checks | undefined => {
  if (!v || typeof v !== "object") return undefined
  const c = v as Rec
  return { verified: num(c.verified) ?? 0, contradicted: num(c.contradicted) ?? 0, unsupported: num(c.unsupported) ?? 0, unchecked: num(c.unchecked) ?? 0 }
}

function extras(kind: RunKind, r: Rec): Omit<Work, keyof RunRef> {
  const step = r.step && typeof r.step === "object" ? (r.step as Rec) : undefined
  const sources = r.sources && typeof r.sources === "object" && !Array.isArray(r.sources) ? (r.sources as Rec) : undefined
  const search = r.search && typeof r.search === "object" ? (r.search as Rec) : undefined
  return {
    usd: kind === "swarm" ? undefined : num(r.usd),
    maxUsd: num(r.maxUsd),
    workStartedAt: num(r.workStartedAt),
    finishedAt: num(r.finishedAt),
    seconds: num(r.seconds),
    step: str(step?.label) ? { label: str(step?.label) as string, agent: str(step?.agent) } : kind === "swarm" && str(r.detail) ? { label: str(r.detail) as string } : undefined,
    agents: kind === "board" ? strings(r.members) : strings(r.agents),
    searches: kind === "board" ? num(search?.searches) : num(r.searches),
    sources: sources ? { kept: num(sources.kept) ?? 0, cited: num(sources.cited) ?? 0 } : undefined,
    checks: checksOf(r.checks),
    thread: str(r.thread),
  }
}

/** The three replies in, one list of work out, newest first. A reply that could not be read is undefined (counts as empty). */
export function workOf(board: unknown, answers: unknown, swarm: unknown): Work[] {
  const raw = new Map<string, Rec>()
  for (const r of list(board)) if (str(r.id)) raw.set(`board/${r.id}`, r)
  for (const r of list((answers as Rec | undefined)?.items ?? answers)) if (str(r.id)) raw.set(`answer/${r.id}`, r)
  for (const r of list(swarm)) if (str(r.id)) raw.set(`swarm/${r.id}`, r)
  const runs = mergeRuns(boardRuns(board ?? []), answerRuns(answers ?? []), swarmRuns(swarm ?? []))
  return runs.map((run) => {
    const r = raw.get(`${run.kind}/${run.id}`) ?? {}
    // A team review's line says whether it used scripted models (newer engines); older ones say it in the first event.
    const provenance = run.kind === "board" && run.provenance === undefined && typeof r.mock === "boolean" ? (r.mock ? "practice" as const : "live" as const) : run.provenance
    return { ...run, provenance, ...extras(run.kind, r) }
  })
}

/** Example runs are the read-only library: they are never counted. */
export const counted = (works: readonly Work[]): Work[] => works.filter((w) => w.provenance !== "example")

/** Everything still going (or waiting to start), oldest first: the one that started first is at the top. */
export const running = (works: readonly Work[]): Work[] => counted(works).filter((w) => w.live).sort((a, b) => a.startedAt - b.startedAt)

/** The newest runs that ended, newest first. */
export const recent = (works: readonly Work[], limit = 6): Work[] => counted(works).filter((w) => !w.live).slice(0, limit)

/** Time the run has been worked on, ms: from when its work began to `now` (or to when it finished). */
export const elapsedOf = (w: Pick<Work, "startedAt" | "workStartedAt" | "finishedAt">, now: number): number | undefined => {
  const from = w.workStartedAt ?? w.startedAt
  if (!from) return undefined
  return Math.max(0, (w.finishedAt ?? now) - from)
}

// ---- The numbers ---------------------------------------------------------------------------------------------------
export interface Counts { done: number; running: number; failed: number; stopped: number; research: number; practice: number }
export function countsOf(works: readonly Work[]): Counts {
  const c: Counts = { done: 0, running: 0, failed: 0, stopped: 0, research: 0, practice: 0 }
  for (const w of counted(works)) {
    if (w.live) c.running++
    else if (w.status === "failed") c.failed++
    else if (w.status === "cancelled" || w.status === "paused") c.stopped++
    else c.done++
    const made = madeOf(w)
    if (made === "research") c.research++
    else if (made === "practice") c.practice++
  }
  return c
}

const DAY = 86_400_000
/** Dollars recorded by runs started in the last `days` days (today included). Undefined when no run in that window records dollars. */
export function recentSpend(works: readonly Work[], days = 7, now: Date = new Date()): { usd: number; runs: number } | undefined {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (days - 1) * DAY
  const priced = counted(works).filter((w) => w.startedAt >= start && w.usd !== undefined)
  if (!priced.length) return undefined
  return { usd: priced.reduce((sum, w) => sum + (w.usd ?? 0), 0), runs: priced.length }
}

/** Which runs the numbers below count: research (real or local models) or practice (scripted, $0). */
export type Scope = Extract<Made, "research" | "practice">
const inScope = (works: readonly Work[], scope: Scope) => counted(works).filter((w) => madeOf(w) === scope)

/** Average time and cost of a finished answer. `answers` is how many finished answers there are; a mean is undefined when none recorded it. */
export function perAnswer(works: readonly Work[], scope: Scope): { answers: number; seconds?: number; usd?: number; timed: number; priced: number } {
  const done = inScope(works, scope).filter((w) => w.kind === "answer" && !w.live && w.status === "finished")
  const timed = done.filter((w) => w.seconds !== undefined), priced = done.filter((w) => w.usd !== undefined)
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined)
  return { answers: done.length, seconds: mean(timed.map((w) => w.seconds as number)), usd: mean(priced.map((w) => w.usd as number)), timed: timed.length, priced: priced.length }
}

/** Searches run, sources kept and cited. `from` counts the runs whose lists recorded them; zero means there is nothing to show. */
export function sourcesOf(works: readonly Work[], scope: Scope): { searches: number; kept: number; cited: number; from: number; answers: number } {
  let searches = 0, kept = 0, cited = 0, from = 0, answers = 0
  for (const w of inScope(works, scope)) {
    if (w.searches === undefined && !w.sources) continue
    from++
    searches += w.searches ?? 0
    if (w.sources) { answers++; kept += w.sources.kept; cited += w.sources.cited }
  }
  return { searches, kept, cited, from, answers }
}

/** Checked statements and claims by verdict: passed (verified), failed (contradicted or unsupported), not checked. */
export function checksOfAll(works: readonly Work[], scope: Scope): { passed: number; failed: number; unchecked: number; total: number } {
  let passed = 0, failed = 0, unchecked = 0
  for (const w of inScope(works, scope)) {
    if (!w.checks) continue
    passed += w.checks.verified
    failed += w.checks.contradicted + w.checks.unsupported
    unchecked += w.checks.unchecked
  }
  return { passed, failed, unchecked, total: passed + failed + unchecked }
}

/** The scope to start with: research when there is any, else practice when there is only that. */
export const firstScope = (works: readonly Work[]): Scope => (inScope(works, "research").length || !inScope(works, "practice").length ? "research" : "practice")

/** "$1.25", "less than 1 cent", "$0.00". */
export const usdText = (usd: number | undefined): string => (usd === undefined ? "Not recorded" : usd > 0 && usd < 0.01 ? "< $0.01" : `$${usd.toFixed(2)}`)

// ---- The engine's spend and limits (GET /api/paid): its own count; this page adds nothing up. ----------------------
export interface Paid { real?: boolean; spentToday?: number; daily?: number; perRun?: number; exaUsed?: number; exaCeiling?: number }

/** GET /api/paid in, the figures the tiles show out. Null: the engine did not answer. */
export function paidOf(reply: unknown): Paid | null {
  if (!reply || typeof reply !== "object") return null
  const r = reply as Rec
  const caps = (r.caps && typeof r.caps === "object" ? r.caps : {}) as Rec
  return { real: typeof r.paid === "boolean" ? r.paid : undefined, spentToday: num(caps.spentTodayUsd), daily: num(caps.dailyUsd), perRun: num(caps.maxUsd), exaUsed: num(caps.exaUsedUsd), exaCeiling: num(caps.exaCeilingUsd) }
}

