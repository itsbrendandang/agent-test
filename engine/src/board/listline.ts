// What GET /api/runs adds to each team review's line for the Overview: the dollars the run has recorded, who takes
// part, and its checked claims counted by the verdict code gave them. Only what run.json holds; nothing is estimated.
import type { RunState } from "./board.ts"

export interface BoardExtras {
  /** The run's own running total (models and checkers). Absent in runs recorded before the field. */
  usd?: number
  /** True when the run used scripted models (it costs nothing). Absent when run.json does not say. */
  mock?: boolean
  /** The members of the review, as the run recorded them. */
  members: string[]
  checks: { verified: number; contradicted: number; unsupported: number; unchecked: number }
}

export function boardExtras(state: Pick<RunState, "usd" | "mock" | "members" | "ledger">): BoardExtras {
  const checks = { verified: 0, contradicted: 0, unsupported: 0, unchecked: 0 }
  for (const entry of Array.isArray(state.ledger) ? state.ledger : []) if (entry && entry.verdict in checks) checks[entry.verdict]++
  return {
    ...(typeof state.usd === "number" && Number.isFinite(state.usd) ? { usd: state.usd } : {}),
    ...(typeof state.mock === "boolean" ? { mock: state.mock } : {}),
    members: state.members && typeof state.members === "object" ? Object.keys(state.members).slice(0, 30) : [],
    checks,
  }
}
