// The board's models, called directly: Anthropic and OpenAI, through @earendil-works/pi-ai's own providers.
// There is no gateway in between. Every tier in board/config.yaml is a provider-qualified id, "<vendor>/<model>".
//
// Three jobs live here, all pure so tests can run them with fake environments:
//   1. parseModelId: split and check an id (only the two vendors we hold keys for are accepted).
//   2. keysFor / assertBoardKeys: which key each tier needs, and a loud, specific error when one is missing.
//      A real board run with a missing key must stop at the start. It must never fall back to scripted turns:
//      a run that looks real but is scripted is the worst outcome for this product.
//   3. firstPassModel: the cheap model that makes the first check of a claim, chosen so that it is NOT from the
//      same vendor as the member who made the claim (the independence rule, see triage.ts).
import { HttpError } from "./http.ts"
import type { BoardConfig, Tier } from "./config.ts"

export type Vendor = "anthropic" | "openai"
export const VENDOR_KEY: Record<Vendor, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" }
export const TIERS: Tier[] = ["lead", "strong", "cheap", "rival"]

export interface ModelId { vendor: Vendor; id: string; qualified: string }

/** "anthropic/claude-sonnet-5-5" -> { vendor: "anthropic", id: "claude-sonnet-5-5" }. Throws for anything else (a gateway id, a "~" alias, no vendor). */
export function parseModelId(value: unknown, where = "model"): ModelId {
  const m = typeof value === "string" ? /^(anthropic|openai)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(value.trim()) : null
  if (!m) throw new Error(`${where}: ${JSON.stringify(value)} is not a model id of the form anthropic/<model> or openai/<model>`)
  return { vendor: m[1] as Vendor, id: m[2], qualified: `${m[1]}/${m[2]}` }
}

/** A real board run needs a key that is not set. Maps to HTTP 503: nothing the caller sent was wrong. */
export class MissingTierKey extends HttpError {
  readonly missing: { tier: string; model: string; key: string }[]
  constructor(missing: { tier: string; model: string; key: string }[]) {
    super(503, `Cannot start a board run with real models: ${missing.map((m) => `tier "${m.tier}" (${m.model}) needs ${m.key}, which is not set`).join("; ")}. ` +
      `Set the key in .env, or run with scripted models (leave NO_PAID_CALLS on, or set DRUG_BOARD_MOCK=1). A run is never silently made scripted.`)
    this.missing = missing
  }
}

/** Every model the board calls and the key each one needs: the four tiers and the first-pass checker's other-vendor model. */
export function modelsNeeded(config: BoardConfig): { tier: string; model: ModelId }[] {
  return [
    ...TIERS.map((tier) => ({ tier: tier as string, model: parseModelId(config.models?.[tier], `board/config.yaml models.${tier}`) })),
    { tier: "first_pass.alt", model: parseModelId(config.checkers?.first_pass?.alt, "board/config.yaml checkers.first_pass.alt") },
  ]
}

/** The tiers whose key is not in `env` (empty when a real run can start). Throws for a malformed id in the config. */
export function missingKeys(config: BoardConfig, env: NodeJS.ProcessEnv = process.env, exa = true): { tier: string; model: string; key: string }[] {
  const missing = modelsNeeded(config).filter(({ model }) => !env[VENDOR_KEY[model.vendor]]?.trim())
    .map(({ tier, model }) => ({ tier, model: model.qualified, key: VENDOR_KEY[model.vendor] }))
  // Members with the search tool need Exa. Without the key a real run would have no evidence, and fixture papers must never stand in for it.
  if (exa && !env.EXA_API_KEY?.trim()) missing.push({ tier: "search", model: "Exa", key: "EXA_API_KEY" })
  return missing
}

/** Throws MissingTierKey (naming each tier and key) when a real run could not use every tier. Call before anything is created or spent. */
export function assertBoardKeys(config: BoardConfig, env: NodeJS.ProcessEnv = process.env, exa = true): void {
  const missing = missingKeys(config, env, exa)
  if (missing.length) throw new MissingTierKey(missing)
}

/** One line for the engine's start-up and for `npm run doctor`: whether a real board run can start with these keys. */
export function boardKeysLine(config: BoardConfig, env: NodeJS.ProcessEnv = process.env): string {
  const missing = missingKeys(config, env)
  return missing.length
    ? `Board models: a real run would be REFUSED: ${missing.map((m) => `${m.tier} (${m.model}) needs ${m.key}`).join("; ")}.`
    : `Board models: every tier has its key (${[...new Set(modelsNeeded(config).map((m) => m.model.qualified))].join(", ")}).`
}

/**
 * The model for the first check of a claim made by a member running on `memberModel`. Candidates are the cheap
 * tier and the other-vendor cheap model, in that order; the first one from a different vendor than the member's wins.
 * `independent` is false only when both candidates share the member's vendor (a config with one vendor): then the
 * caller must not let that check verify anything.
 */
export function firstPassModel(config: BoardConfig, memberModel: string | undefined): { model: ModelId; independent: boolean } {
  const cheap = parseModelId(config.models.cheap, "board/config.yaml models.cheap")
  const alt = parseModelId(config.checkers.first_pass.alt, "board/config.yaml checkers.first_pass.alt")
  const memberVendor = memberModel ? parseModelId(memberModel, "the member's model").vendor : undefined
  if (memberVendor === undefined) return { model: cheap, independent: false } // unknown author: independence cannot be shown
  const pick = [cheap, alt].find((m) => m.vendor !== memberVendor)
  return pick ? { model: pick, independent: true } : { model: cheap, independent: false }
}

/**
 * The model that rules on a contested literature claim made by a member running on `memberModel`: the OpenAI checker
 * model, or the strong-tier Claude model when the author is on OpenAI. `independent` is false only when neither is
 * from another vendor than the author's; the caller then records the claim as unchecked instead of letting a model grade
 * its own vendor's claim.
 */
export function escalationModel(config: BoardConfig, memberModel: string | undefined): { model: ModelId; independent: boolean } {
  const openai = parseModelId(`openai/${config.checkers.openai_model}`, "board/config.yaml checkers.openai_model")
  const claude = parseModelId(config.models.strong, "board/config.yaml models.strong")
  const memberVendor = memberModel ? parseModelId(memberModel, "the member's model").vendor : undefined
  if (memberVendor === undefined) return { model: openai, independent: false }
  const pick = [openai, claude].find((m) => m.vendor !== memberVendor)
  return pick ? { model: pick, independent: true } : { model: openai, independent: false }
}

/**
 * One line saying what a board run started now would be: scripted, local or real. Printed at start-up next to the
 * paid-calls line, so the two cannot be read as contradicting each other.
 */
export function boardModeLine(config: BoardConfig, mock: boolean, local: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (local) return `Board runs: LOCAL model ${local}. The agents are real; it costs nothing and nothing leaves this machine. Exa and the checkers are scripted, so nothing is fact-checked.`
  if (mock) return env.NO_PAID_CALLS?.trim() === "0"
    ? "Board runs: SCRIPTED (DRUG_BOARD_MOCK=1), although paid calls are ON. Replies are fixed text, not research. Only a GLHF run started with a real model can spend."
    : "Board runs: SCRIPTED (paid calls are off). Replies are fixed text, not research."
  const ids = [...new Set(modelsNeeded(config).map((m) => m.model.qualified))].join(", ")
  return `Board runs: REAL (${ids}). Each run is capped at $${config.meeting.max_usd}, all runs of a day at $${config.meeting.daily_usd}.`
}
