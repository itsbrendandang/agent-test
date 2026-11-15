// One agent's model use in a board run, for the dashboard's agent details. It reads the agent's own conversation usage
// record (pi-durable `pi.usage`), so it adds no model call and nothing a replay could repeat: reading it twice gives
// the same numbers.
import type { UsageState } from "@earendil-works/pi-durable"
import type { MemberUsage } from "../events.ts"

type Counted = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number }
const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0)

/**
 * The token counts of one conversation's usage record, summed over its models, with the dollars `usd` says they cost.
 * Tool buckets are left out: the board's tools are searches, counted in the run's total. An absent record is all zeros.
 */
export function memberUsage(state: Readonly<UsageState> | undefined, usd: (models: UsageState["models"]) => number): MemberUsage {
  const models = (state?.models ?? {}) as UsageState["models"]
  const sum: MemberUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, usd: 0 }
  for (const u of Object.values(models) as Counted[]) {
    sum.input += n(u.input); sum.output += n(u.output); sum.cacheRead += n(u.cacheRead); sum.cacheWrite += n(u.cacheWrite); sum.totalTokens += n(u.totalTokens)
  }
  sum.usd = Math.max(0, n(usd(models)))
  return sum
}
