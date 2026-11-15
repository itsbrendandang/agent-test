// The engine's kill switch for everything that costs money (NO_PAID_CALLS, on by default). The dashboard only reads
// it, from GET /api/glhf/status. Only a person can change it, in .env; there is no request that turns it on.

/** "unknown": the engine cannot be reached, or it is an older engine that does not report the switch. */
export type PaidState = "off" | "on" | "unknown"

export const PAID_LABEL: Record<PaidState, string> = {
  off: "Demo: practice runs only",
  on: "Real: costs money",
  unknown: "Demo or Real: not known",
}
/** The plain words under the switch. */
export const MODE_WORDS = { off: "Practice runs. Fixed example answers. Free.", on: "Real AI models and web search. Costs money." } as const
export const HOW_TO_TURN_ON = "To use real models, choose Real at the top of the page. It asks you to confirm that it costs money."

export const paidState = (status: { paidCalls?: unknown } | undefined): PaidState =>
  status?.paidCalls === false ? "off" : status?.paidCalls === true ? "on" : "unknown"
