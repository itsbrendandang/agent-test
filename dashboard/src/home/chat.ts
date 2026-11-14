// The rules of the Home chat, apart from its markup so they can be tested: the labels, what is sent, what a person
// must do before a plan may start, and where an engine refusal is shown.
import { HOW_TO_TURN_ON } from "@/lib/paid"
import { fmtDuration } from "@/lib/format"
import type { Catalog, ChatMessage, ChatMode, ChatReply, ChatRequest, Effort, EffortId, Plan, PlanLimits, ProviderId, SearchKind, SearchResult, StartRequest } from "./api"

/** The plain label on every assistant reply: did a model write this? */
export const MODE_LABEL: Record<ChatMode, string> = {
  ai: "AI answer",
  keyword: "Keyword search, not an AI answer",
  scripted: "Scripted: fixed text, not research",
}
export const MODE_KIND: Record<ChatMode, string> = { ai: "success", keyword: "warning", scripted: "neutral" }

export const EXAMPLES = [
  "Should we advance a KRAS G12C hit that has a hERG liability?",
  "What did past board reviews decide about hERG risk?",
  "Which runs had a rejected claim, and what was wrong with it?",
  "Plan a review of a covalent kinase inhibitor with poor solubility.",
]

export const MAX_MESSAGE = 4000
/** How many past messages go with a new one. Older ones stay on screen but are not sent. */
export const MAX_HISTORY = 40

/** What happened to the plan of one reply. */
export type PlanState = { state: "open" } | { state: "discarded" } | { state: "expired" } | { state: "started"; runId: string }
/** One line of the conversation as kept for the session. An assistant turn keeps the whole reply. */
export type Turn = { id: number; role: "user"; content: string }
  | { id: number; role: "assistant"; content: string; reply: ChatReply; plan?: PlanState; /** The effort the question was asked with. */ effort?: EffortId }
export interface Choice { provider?: ProviderId; model?: string; effort?: EffortId }

/** Common API key shapes. A key must never be typed into the chat: it would be sent to the engine and to a model. */
const KEY_SHAPES = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bsk-ant-[A-Za-z0-9_-]{10,}/, /\bsk-or-[A-Za-z0-9_-]{10,}/, /\bxai-[A-Za-z0-9]{16,}/, /\bAIza[0-9A-Za-z_-]{20,}/, /\bhf_[A-Za-z0-9]{20,}/]
export const looksLikeKey = (text: string) => KEY_SHAPES.some((shape) => shape.test(text))
export const KEY_REFUSAL = "This looks like an API key, so it was not sent. Keys are never typed here: a person puts them in the .env file in the repo root."

/** Why this text cannot be sent, or undefined when it can. */
export function refuseText(text: string): string | undefined {
  if (!text.trim()) return "Type a question first."
  if (text.length > MAX_MESSAGE) return `A message can have at most ${MAX_MESSAGE.toLocaleString("en-US")} characters.`
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
export function effortFacts(e: Effort): string {
  return [
    e.agents === "all" ? "all agents" : `${e.agents} agent${e.agents === 1 ? "" : "s"}`,
    `up to ${e.limits.maxRounds} round${e.limits.maxRounds === 1 ? "" : "s"}`,
    `up to ${fmtDuration(e.limits.maxMinutes * 60_000)}`,
    `up to $${e.limits.maxUsd.toFixed(2)}`,
    `${e.modelTier} models`,
    e.search.exa ? `Exa search, up to ${e.search.maxSearches} search${e.search.maxSearches === 1 ? "" : "es"}` : "no Exa search",
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
  if (plan.paid && paidCalls === false) return `This plan uses paid models or paid search, and paid calls are off. ${HOW_TO_TURN_ON}`
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
      && (t.role === "user" || (t.role === "assistant" && !!t.reply && typeof t.reply.reply === "string" && t.reply.mode in MODE_LABEL)))
  } catch { return [] }
}
export const saveTurns = (turns: Turn[]) => {
  try { if (turns.length) sessionStorage.setItem(STORE, JSON.stringify(turns)); else sessionStorage.removeItem(STORE) } catch { /* storage full or off: the conversation stays in memory */ }
}

// ---- search (finds what exists; the chat asks a question)
export const SEARCH_KINDS: readonly { id: SearchKind | "all"; label: string }[] = [
  { id: "all", label: "All" }, { id: "swarm", label: "Swarm runs" }, { id: "board", label: "Board reviews" }, { id: "agent", label: "Agents" }, { id: "skill", label: "Skills" },
]
export const KIND_LABEL: Record<SearchKind, string> = { swarm: "swarm run", board: "board review", agent: "agent", skill: "skill" }
/** Where a result opens: a run in its view, an agent or a skill in the Agents view. */
export const viewOfResult = (r: Pick<SearchResult, "kind">): "Swarm" | "Board" | "Agents" => (r.kind === "swarm" ? "Swarm" : r.kind === "board" ? "Board" : "Agents")

/** Text cut into pieces, with the pieces that are one of the query's words marked. Matching ignores case. */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
  if (!words.length || !text) return text ? [{ text, hit: false }] : []
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")})`, "gi")
  return text.split(pattern).filter(Boolean).map((part) => ({ text: part, hit: words.includes(part.toLowerCase()) }))
}
/** The row the arrow keys move to. -1 is the search field itself; the ends do not wrap. */
export const moveActive = (active: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End", count: number): number =>
  count === 0 ? -1 : key === "ArrowDown" ? Math.min(count - 1, active + 1) : key === "ArrowUp" ? Math.max(-1, active - 1) : key === "Home" ? 0 : count - 1
