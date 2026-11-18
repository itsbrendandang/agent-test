// The rules of the Home chat, apart from its markup so they can be tested: the labels, what is sent, what a person
// must do before a plan may start, and where an engine refusal is shown.
import { HOW_TO_TURN_ON } from "@/lib/paid"
import { plainDuration } from "@/lib/format"
import type { Catalog, CatalogAgent, CatalogSkill, ChatMessage, ChatMode, ChatReply, ChatRequest, Effort, EffortId, Plan, PlanLimits, ProviderId, StartRequest } from "./api"

/** The plain label on every assistant reply: did a model write this? */
/** The three kinds of reply, named for what they are. They must never be mistaken for each other. */
export const MODE_LABEL: Record<ChatMode, string> = { ai: "AI answer", keyword: "Saved-research search", scripted: "Demo response" }
/** One short line under the label: what produced this reply. */
export const MODE_MEANS: Record<ChatMode, string> = {
  ai: "Written by an AI model.",
  keyword: "Matched by words in saved research. No AI model read the question.",
  scripted: "Fixed example text. Not an AI answer and not research.",
}
export const MODE_KIND: Record<ChatMode, string> = { ai: "info", keyword: "outline", scripted: "neutral" }
/**
 * The words over the saved runs listed under a reply. Only an AI answer was written from them, so only it may say
 * "this answer used". Under any other reply they are runs that share words with the question: nothing read them,
 * and the words claim no support for a conclusion.
 */
export function sourcesWords(mode: string): { heading: string; about: string; label: string } {
  if (mode === "ai") return { heading: "Sources", about: "Saved research this answer used. Open one to read it and see how each statement in it was checked.", label: "Saved research this answer used" }
  return { heading: "Related saved research", about: "Saved research that shares words with your question. Nothing read it to write this reply. Open one to read it and see how each statement in it was checked.", label: "Related saved research" }
}

export const EXAMPLES = [
  "Should we advance a KRAS G12C hit with a hERG risk?",
  "What did past reviews decide about hERG risk?",
  "Which statements were contradicted, and why?",
]

// The engine's own limits (engine/src/chat/routes.ts): a question of at most 2,000 characters, at most 20 messages.
export const MAX_MESSAGE = 2000
/** How many messages go in one request, the new question included. Older ones stay on screen but are not sent. */
export const MAX_HISTORY = 20

/** What happened to the plan of one reply. */
export type PlanState = { state: "open" } | { state: "discarded" } | { state: "expired" } | { state: "started"; runId: string }
/** One line of the conversation as kept for the session. An assistant turn keeps the whole reply. */
export type Turn = { id: number; role: "user"; content: string }
  | { id: number; role: "assistant"; content: string; reply: ChatReply; plan?: PlanState; /** The effort the question was asked with. */ effort?: EffortId }
  /** A direct, sourced answer: the engine keeps it; the page follows its events by id. `content` is its text once finished. */
  | { id: number; role: "assistant"; content: string; research: { id: string; question: string; thread?: string } }
export type ReplyTurn = Extract<Turn, { reply: ChatReply }>
export interface Choice { provider?: ProviderId; model?: string; effort?: EffortId }

/** Common API key shapes. A key must never be typed into the chat: it would be sent to the engine and to a model. */
const KEY_SHAPES = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bsk-ant-[A-Za-z0-9_-]{10,}/, /\bsk-or-[A-Za-z0-9_-]{10,}/, /\bxai-[A-Za-z0-9]{16,}/, /\bAIza[0-9A-Za-z_-]{20,}/, /\bhf_[A-Za-z0-9]{20,}/]
export const looksLikeKey = (text: string) => KEY_SHAPES.some((shape) => shape.test(text))
export const KEY_REFUSAL = "This looks like an API key, so it was not sent. Keys are never typed here: a person puts them in the .env file in the repo root."

/** Why this text cannot be sent, or undefined when it can. */
export function refuseText(text: string): string | undefined {
  if (!text.trim()) return "Type a question first."
  if (text.trim().length > MAX_MESSAGE) return `A message can have at most ${MAX_MESSAGE.toLocaleString("en-US")} characters.`
  if (looksLikeKey(text)) return KEY_REFUSAL
  return undefined
}

/** POST /api/chat body: the conversation as role and text only, then the new question. Provider and model only when chosen. */
export function chatRequest(turns: Turn[], text: string, choice: Choice = {}): ChatRequest {
  const history: ChatMessage[] = turns.map((t) => ({ role: t.role, content: t.content }))
  const messages = [...history, { role: "user" as const, content: text.trim() }].slice(-MAX_HISTORY)
  return { messages, ...(choice.provider && choice.model && { provider: choice.provider, model: choice.model }), ...(choice.effort && { effort: choice.effort }) }
}

const EFFORT_KEY = "home.effort"
/** The effort in effect: the last choice if the engine still offers it, else the engine's default, else its first. Undefined when the engine has no effort levels. */
export function effortInEffect(catalog: Pick<Catalog, "efforts" | "defaultEffort"> | null | undefined, chosen: string | undefined): EffortId | undefined {
  const efforts = catalog?.efforts ?? []
  return (efforts.find((e) => e.id === chosen) ?? efforts.find((e) => e.id === catalog?.defaultEffort) ?? efforts[0])?.id
}
/** The last effort a person chose, kept across sessions. Not a secret, so localStorage is fine. */
export const loadEffort = (): string | undefined => { try { return localStorage.getItem(EFFORT_KEY) ?? undefined } catch { return undefined } }
export const saveEffort = (id: EffortId) => { try { localStorage.setItem(EFFORT_KEY, id) } catch { /* not remembered */ } }
/** What an effort level implies, in one visible line: agents, rounds, time, cost, model tier, search. */
/** The engine's names for how strong a model is, in plain words. */
const TIER_WORD: Record<string, string> = { cheap: "small, fast", strong: "strong", lead: "the strongest", "per agent": "each member's own" }

export function effortFacts(e: Effort): string {
  return [
    e.agents === "all" ? "all agents" : `${e.agents} agent${e.agents === 1 ? "" : "s"}`,
    `up to ${e.limits.maxRounds} round${e.limits.maxRounds === 1 ? "" : "s"}`,
    `up to ${plainDuration(e.limits.maxMinutes * 60_000)}`,
    `up to $${e.limits.maxUsd.toFixed(2)}`,
    `${TIER_WORD[e.modelTier] ?? e.modelTier} models`,
    e.search.exa ? `web search, up to ${e.search.maxSearches} search${e.search.maxSearches === 1 ? "" : "es"}` : "no web search",
  ].join(" · ")
}

/**
 * The request that asks for the plan of one reply again, at another effort: the conversation as it was before that
 * reply, ending with the question it answered. Undefined when the turn is not a reply that follows a question.
 */
export function replanRequest(turns: Turn[], turnId: number, choice: Choice): ChatRequest | undefined {
  const at = turns.findIndex((t) => t.id === turnId)
  const question = turns[at - 1]
  if (at < 1 || turns[at].role !== "assistant" || question.role !== "user") return undefined
  return chatRequest(turns.slice(0, at - 1), question.content, choice)
}

/** Cost as the engine estimated it, or "unknown". Never a guess made here. */
export const estimateText = (plan: Plan): string => (plan.estimate.usd === null ? "unknown" : `about $${plan.estimate.usd.toFixed(2)}`)

/** What a person may change before a plan starts. Numbers stay text until they are checked. */
export interface Edits { maxUsd: string; maxMinutes: string; maxRounds: string; agents: string[] }
export const editsOf = (plan: Plan): Edits => ({
  maxUsd: String(plan.limits.maxUsd), maxMinutes: String(plan.limits.maxMinutes), maxRounds: String(plan.limits.maxRounds), agents: plan.agents.map((a) => a.name),
})

export type StartControl = "maxUsd" | "maxMinutes" | "maxRounds" | "agents" | "confirm" | "effort"
export type StartErrors = Partial<Record<StartControl, string>>
const CONTROLS: readonly StartControl[] = ["maxUsd", "maxMinutes", "maxRounds", "agents", "confirm", "effort"]
/** The control an engine refusal belongs to: "maxUsd" or "limits.maxUsd" both mean the cost limit. Undefined: under the card. */
export function controlOf(field: string | undefined): StartControl | undefined {
  const last = field?.split(".").pop()
  return CONTROLS.find((c) => c === last)
}

/**
 * Checks the confirm step and builds POST /api/chat/plans/:id/start. `limits` and `agents` are sent only when the
 * person changed them, so an untouched plan starts exactly as the engine wrote it. A limit can be lowered, not raised.
 */
export function startRequest(plan: Plan, edits: Edits, effort?: EffortId): { errors: StartErrors; request: StartRequest } {
  const errors: StartErrors = {}
  const num = (control: "maxUsd" | "maxMinutes" | "maxRounds", name: string, whole: boolean): number => {
    const text = edits[control], n = Number(text), top = plan.limits[control]
    if (!text.trim() || !Number.isFinite(n) || n <= 0 || (whole && !Number.isInteger(n))) errors[control] = `${name} must be a ${whole ? "whole number" : "number"} above 0.`
    else if (n > top) errors[control] = `${name} can be lowered, not raised above ${top}. Ask for a new plan to raise it.`
    return n
  }
  const limits: PlanLimits = { maxUsd: num("maxUsd", "The cost limit", false), maxMinutes: num("maxMinutes", "The time limit", true), maxRounds: num("maxRounds", "The number of rounds", true) }
  const all = plan.agents.map((a) => a.name)
  const agents = all.filter((name) => edits.agents.includes(name))
  if (agents.length === 0) errors.agents = "Keep at least one agent."
  const limitsChanged = limits.maxUsd !== plan.limits.maxUsd || limits.maxMinutes !== plan.limits.maxMinutes || limits.maxRounds !== plan.limits.maxRounds
  return { errors, request: { confirm: true, ...(effort && { effort }), ...(limitsChanged && { limits }), ...(agents.length !== all.length && { agents }) } }
}

/**
 * May the Start button of the confirm step be pressed? A paid plan needs the tick, and cannot start at all while the
 * engine's paid-calls switch is off. `paidCalls` undefined: the catalog is not known, so the engine decides (403).
 */
export function startBlock(plan: Plan, paidCalls: boolean | undefined, agreed: boolean): string | undefined {
  if (plan.paid && paidCalls === false) return `This plan uses paid models or paid search, and you are in Demo mode. ${HOW_TO_TURN_ON}`
  if (plan.paid && !agreed) return "Tick the box to confirm that this may spend money."
  return undefined
}

const STORE = "home.chat"
/** The conversation of this browser session. Anything unreadable is dropped, never shown. */
export function loadTurns(): Turn[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(STORE) ?? "[]")
    if (!Array.isArray(saved)) return []
    return saved.filter((t): t is Turn => !!t && typeof t.id === "number" && typeof t.content === "string"
      && (t.role === "user" || (t.role === "assistant" && (("reply" in t && !!t.reply && typeof t.reply.reply === "string" && t.reply.mode in MODE_LABEL)
        || ("research" in t && !!t.research && typeof t.research.id === "string" && /^[\w.-]{1,120}$/.test(t.research.id) && typeof t.research.question === "string")))))
  } catch { return [] }
}
export const saveTurns = (turns: Turn[]) => {
  try { if (turns.length) sessionStorage.setItem(STORE, JSON.stringify(turns)); else sessionStorage.removeItem(STORE) } catch { /* storage full or off: the conversation stays in memory */ }
}
/**
 * A direct answer started from the Overview's question box becomes Research's conversation: a new one, as if New
 * search had been pressed there and the question sent. Research shows it when it opens (also while it is still being
 * written), and a follow-up there continues the answer's thread. The earlier conversation stays in Saved research.
 */
export const startConversation = (question: string, answer: { id: string; thread: string }) =>
  saveTurns([{ id: 1, role: "user", content: question }, { id: 2, role: "assistant", content: "", research: { id: answer.id, question, thread: answer.thread } }])

// ---- can a board review use real models?
const KEY_FOR: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" }
const KEY_NAME: Record<string, string> = { ANTHROPIC_API_KEY: "Anthropic", OPENAI_API_KEY: "OpenAI" }
/** The key a board model id needs: the provider is the part before the slash. Undefined for a provider that needs none. */
export const keyOfModel = (id: string): string | undefined => KEY_FOR[id.split("/")[0]]

/**
 * Why a board review can only run with scripted models, in one plain sentence, or undefined when it can use real
 * ones. From the engine's own facts (GET /api/status: the board's model ids, which keys are set, the paid switch,
 * and whether it is in scripted mode), plus the catalog's provider list.
 */
export function boardScriptedWhy(status: { mock?: unknown; paidCalls?: unknown; keys?: Record<string, unknown>; models?: Record<string, unknown> } | undefined,
  providers: { id: string; keyPresent: boolean }[] = []): string | undefined {
  const needed = new Set(Object.values(status?.models ?? {}).flatMap((id) => (typeof id === "string" ? [keyOfModel(id)] : [])).filter((k): k is string => !!k))
  const missing = [...needed].filter((key) => status?.keys?.[key] === false || providers.some((p) => KEY_FOR[p.id] === key && !p.keyPresent))
  if (missing.length) return `${missing.map((k) => KEY_NAME[k] ?? k).join(" and ")} key missing: team reviews are practice runs only`
  if (status?.paidCalls === false) return "Demo mode: reviews are practice runs only"
  if (status?.mock === true) return "The engine is in practice mode: team reviews are practice runs only"
  return undefined
}

// ---- the words the Agents view filter looks in
export const agentText = (a: CatalogAgent) => [a.name, a.title, a.role, a.trigger, a.deliverable, a.tools.join(" ")].join(" ")
export const skillText = (s: CatalogSkill) => `${s.title ?? ""} ${s.name} ${s.description} ${s.installed ? "installed" : "index only not installed"}`
