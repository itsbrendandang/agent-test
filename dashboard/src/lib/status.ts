/** The states a run can be in, plus a paused board review. Same word and colour in every view (StatusPill). */
export type RunState = "queued" | "running" | "done" | "failed" | "cancelled" | "not graded" | "paused"

/** Pill colour per state. Cancelled is neutral grey: it was stopped on request, which is not a failure. */
export const STATE_KIND: Record<RunState, string> = {
  queued: "waiting", running: "info", done: "success", failed: "danger", cancelled: "neutral", "not graded": "warning", paused: "warning",
}

/** From a swarm phase or a board status. A finished swarm run without a score is "not graded". */
export function runState(status: string, graded = true): RunState {
  if (status === "failed" || status === "cancelled" || status === "paused" || status === "queued") return status
  if (status === "done") return graded ? "done" : "not graded"
  return "running" // launching, running, completing
}
