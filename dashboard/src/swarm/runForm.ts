// The rules of the New run form, apart from its markup so they can be tested: which model is in effect, what the
// form refuses before the engine is asked, the request body it sends, and which input an engine refusal belongs to.
import { fmtTokens } from "@/lib/format"
import type { GlhfStatus, Range, StartField, StartRequest } from "@/swarm/api"

export const OTHER = "other"
export type Who = "glhf" | "single" | "both"
/** The form's inputs. Engine fields without an input of their own (mode, caseDir, maxMessagesPerRole) go under the form. */
export type Input = "who" | "model" | "minutes" | "tokens" | "rounds" | "seed" | "exa" | "memory"
export type Errors = Partial<Record<Input, string>>
/** What the person typed and ticked. Numbers stay text until they are checked. */
export interface FormValues {
  who: Who; choice: string; custom: string; minutes: string; tokens: string; rounds: string; exa: boolean; memory: boolean; seed: string
}
export const DEFAULTS: FormValues = { who: "glhf", choice: "mock", custom: "", minutes: "30", tokens: "", rounds: "3", exa: false, memory: false, seed: "" }

const INPUT_OF: Partial<Record<StartField, Input>> = {
  solver: "who", model: "model", timeLimit: "minutes", maxTokens: "tokens", reviewRounds: "rounds", seed: "seed", exa: "exa", memory: "memory",
}
/** The input an engine refusal ({error, field}) is shown next to. Undefined: it goes under the form. */
export const inputOf = (field: StartField | undefined): Input | undefined => (field ? INPUT_OF[field] : undefined)

/** The engine's kill switch (NO_PAID_CALLS) is on. Unknown on an older engine, which has no switch: then not off. */
export const paidOff = (status: Pick<GlhfStatus, "paidCalls"> | undefined) => status?.paidCalls === false

/** The key a model needs, by its provider prefix. Only used to warn; the engine decides. */
const KEY_OF: Record<string, keyof GlhfStatus["keys"]> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" }
/** The key the model needs and the engine does not have, if any. */
export function missingKey(model: string, keys: GlhfStatus["keys"] | undefined): string | undefined {
  const key = model === "mock" ? undefined : KEY_OF[model.split("/")[0]]
  return key !== undefined && keys?.[key] === false ? key : undefined
}

/** A whole number, inside the engine's range when the engine published one. Returns the number, or what is wrong. */
export function whole(text: string, name: string, range?: Range): number | string {
  const n = Number(text)
  const within = range ? ` from ${fmtTokens(range[0])} to ${fmtTokens(range[1])}` : ""
  if (!text.trim() || !Number.isInteger(n) || n < 1) return `${name} must be a whole number${within}.`
  return range && (n < range[0] || n > range[1]) ? `${name} must be a whole number${within}.` : n
}

/** Minutes the form accepts, from the engine's limit in seconds. */
export const minuteRange = (status: GlhfStatus | undefined): Range | undefined =>
  status?.limits && [Math.ceil(status.limits.timeLimit[0] / 60), Math.floor(status.limits.timeLimit[1] / 60)]

export interface Plan {
  /** The model in effect: always "mock" while paid calls are off, whatever was chosen before. */
  model: string
  /** A model that costs money. Never true while paid calls are off. */
  real: boolean
  swarm: boolean
  /** Exa is sent only when ticked, the engine has its key, and paid calls are on. */
  exa: boolean
  errors: Errors
  request: StartRequest
}

/** Checks the form the way the engine will, and builds the one request to send. */
export function plan(v: FormValues, status: GlhfStatus | undefined): Plan {
  const off = paidOff(status)
  const limits = status?.limits
  const model = off ? "mock" : v.choice === OTHER ? v.custom.trim() : v.choice
  const real = model !== "mock"
  const swarm = v.who !== "single"
  const exa = v.exa && !off && status?.keys.EXA_API_KEY !== false
  const errors: Errors = {}
  if (!model) errors.model = "Type a model id, such as anthropic/claude-sonnet-5-5."
  else if (/\s/.test(model)) errors.model = "A model id has no spaces."
  const m = whole(v.minutes, "The time limit", minuteRange(status))
  if (typeof m === "string") errors.minutes = m
  let budget: number | undefined
  if (v.tokens.trim()) { const t = whole(v.tokens, "The token budget", limits?.maxTokens); if (typeof t === "string") errors.tokens = t; else budget = t }
  else if (real) errors.tokens = "A run with a real model needs a token budget. It is the limit on what the run can spend."
  let rounds: number | undefined
  if (swarm) { const x = whole(v.rounds, "Review rounds", limits?.reviewRounds); if (typeof x === "string") errors.rounds = x; else rounds = x }
  let seed: number | undefined
  if (v.seed.trim()) { const x = whole(v.seed, "The seed", limits?.seed); if (typeof x === "string") errors.seed = x; else seed = x }
  const request: StartRequest = {
    mode: "local", task: "demo", model, ...(v.who === "both" ? { solvers: ["glhf", "single"] } : { solver: v.who }),
    timeLimit: (typeof m === "number" ? m : 0) * 60, ...(budget !== undefined && { maxTokens: budget }), ...(seed !== undefined && { seed }),
    ...(swarm && { reviewRounds: rounds, ...(exa && { exa: true }), ...(v.memory && { memory: true }) }),
  }
  return { model, real, swarm, exa, errors, request }
}
