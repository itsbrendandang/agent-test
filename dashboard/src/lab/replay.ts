// Agent Lab design by Anh Lam. Replaying a finished run from its stored events. Pure: a list of event times in, and
// for any moment of the replay the number of events that have happened by then. Two ways to pace it:
//   "real"  the events keep their real distances in time (played at 1x or 4x);
//   "even"  one event after the other at a fixed gap, for a run that was over in a blink (a practice run takes a
//           few seconds, a practice answer a few milliseconds). The view says which one is on.

export type Pace = "real" | "even"
/** A run shorter than this is offered evenly paced first: at its real timing there would be nothing to watch. */
export const SHORT_RUN_MS = 20_000
/** The gap between two events when they are evenly paced. */
export const EVEN_GAP_MS = 700

export interface Timeline {
  /** When each event happened, in ms from the first one. Never goes down. */
  offsets: number[]
  /** The run's real length, first event to last. */
  realMs: number
}

/** Event times (ms; a missing one takes the time before it) as offsets from the first. Times that go backwards are held. */
export function timelineOf(times: readonly (number | undefined)[]): Timeline {
  const first = times.find((t): t is number => typeof t === "number" && Number.isFinite(t)) ?? 0
  let last = 0
  const offsets = times.map((t) => { if (typeof t === "number" && Number.isFinite(t)) last = Math.max(last, t - first); return last })
  return { offsets, realMs: last }
}

/** How long the replay takes at 1x. */
export const lengthOf = (t: Timeline, pace: Pace): number => (pace === "even" ? Math.max(0, t.offsets.length - 1) * EVEN_GAP_MS : t.realMs)
/** How many events have happened `position` ms into the replay. The first event is there from the start. */
export function countAt(t: Timeline, pace: Pace, position: number): number {
  const n = t.offsets.length
  if (!n) return 0
  if (pace === "even") return Math.min(n, Math.floor(Math.max(0, position) / EVEN_GAP_MS) + 1)
  let lo = 0, hi = n // the first index whose offset is after `position`
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t.offsets[mid] <= position) lo = mid + 1; else hi = mid }
  return Math.max(1, lo)
}
/** The pace a replay opens with. */
export const defaultPace = (t: Timeline): Pace => (t.realMs < SHORT_RUN_MS ? "even" : "real")
