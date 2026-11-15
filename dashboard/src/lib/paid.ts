// The engine's kill switch for everything that costs money (NO_PAID_CALLS, on by default). The dashboard only reads
// it, from GET /api/glhf/status. Only a person can change it, in .env; there is no request that turns it on.

/** "unknown": the engine cannot be reached, or it is an older engine that does not report the switch. */
export type PaidState = "off" | "on" | "unknown"

export const PAID_LABEL: Record<PaidState, string> = {
  off: "Paid calls off: practice runs only",
  on: "Paid calls on",
  unknown: "Paid calls: not known",
}
export const HOW_TO_TURN_ON = "To turn paid calls on, a person sets NO_PAID_CALLS=0 in the .env file in the repo root and restarts the engine. The dashboard cannot turn them on."

export const paidState = (status: { paidCalls?: unknown } | undefined): PaidState =>
  status?.paidCalls === false ? "off" : status?.paidCalls === true ? "on" : "unknown"
