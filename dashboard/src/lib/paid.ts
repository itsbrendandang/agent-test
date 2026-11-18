// The engine's switch for everything that costs money. The page reads it from GET /api/glhf/status; a person
// changes it with the Demo / Real selector (lib/paidSwitch.ts), which the engine may refuse or lock.

/** "unknown": the engine cannot be reached, or it is an older engine that does not report the switch. */
export type PaidState = "off" | "on" | "unknown"

/** The plain words under the switch. */
export const MODE_WORDS = { off: "Practice runs. Fixed example answers. Free.", on: "Real AI models and web search. Costs money." } as const
/** The tooltip of the "Next run" selector. */
export const MODE_TIP = "Demo: fixed example answers, free. Real: real models and searches, costs money."
export const HOW_TO_TURN_ON = "To use real models, choose Real in Settings. It asks you to confirm that it costs money."

export const paidState = (status: { paidCalls?: unknown } | undefined): PaidState =>
  status?.paidCalls === false ? "off" : status?.paidCalls === true ? "on" : "unknown"
