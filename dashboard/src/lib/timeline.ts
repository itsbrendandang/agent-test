// A run's steps along its own clock, from what the run recorded. The team of nine logs each step (phase) when it
// starts and when it ends; the end carries the seconds left on the run's clock. Nothing else about time is
// recorded, so: a step is drawn from the clock reading at the end of the step before it to its own end, and the
// first step has an end but no recorded start. No time is invented.
export interface TimedStep {
  /** The step's own name, as logged: "propose", "critique 2". */
  phase: string
  /** Seconds on the run's clock, counted from the end of the first step. Undefined for the first step: its start was not recorded. */
  start?: number
  end: number
  /** The step was cut off by its limit. */
  cut: boolean
}
export interface Timeline { steps: TimedStep[]; /** Seconds from the first reading to the last. */ total: number }

/** The steps with their clock readings, in order; undefined when the run recorded no reading at all. */
export function phaseTimeline(events: readonly { kind: string; phase?: string; [k: string]: unknown }[]): Timeline | undefined {
  const ends = events.filter((e) => e.kind === "phase.finished" && typeof e.phase === "string" && typeof e.left === "number" && Number.isFinite(e.left))
  if (ends.length === 0) return undefined
  const first = ends[0].left as number
  const steps = ends.map((e, i): TimedStep => ({
    phase: e.phase as string, cut: e.limit_hit === true,
    start: i === 0 ? undefined : Math.max(0, first - (ends[i - 1].left as number)),
    end: Math.max(0, first - (e.left as number)),
  }))
  return { steps, total: Math.max(0, ...steps.map((s) => s.end)) }
}
/** "under 1 s", "4 s", "2 min 5 s": a length on the run's clock. */
export const clockLength = (seconds: number): string => {
  const s = Math.round(seconds)
  if (s < 1) return "under 1 s"
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`
}
