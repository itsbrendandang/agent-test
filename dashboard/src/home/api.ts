// Client for the Home chat (engine routes /api/chat/*). The engine decides everything: which model answers, whether
// anything is paid, what a plan contains. The dashboard never sends or receives an API key; the catalog only says
// whether a key is present.
import { ENGINE } from "@/board/api"
import { engineFetch } from "@/lib/token"

export type ProviderId = "anthropic" | "openai"
export interface Provider { id: ProviderId; keyPresent: boolean; models: string[] }
export interface CatalogAgent { name: string; title: string; source: "board" | "specialist"; role: string; tools: string[]; trigger?: string; deliverable?: string }
export interface CatalogSkill { name: string; description: string; installed: boolean }
export type EffortId = "quick" | "standard" | "deep"
/** How much work a question gets: the limits, how many agents, which model tier and how much search. Set by the engine. */
export interface Effort {
  id: EffortId; label: string; description: string
  limits: PlanLimits; agents: number | "all"; modelTier: string; search: { exa: boolean; maxSearches: number }
}
/** GET /api/chat/catalog: what a chat and a plan can use on this machine. */
export interface Catalog {
  paidCalls: boolean
  providers: Provider[]
  /** usedUsd / ceilingUsd: what the engine has recorded as spent on Exa, and the lifetime ceiling it enforces. */
  search: { exa: { keyPresent: boolean; usedUsd?: number; ceilingUsd?: number } }
  agents: CatalogAgent[]
  skills: CatalogSkill[]
  /** Absent on an engine without effort levels: then no selector is shown and no effort is sent. */
  efforts?: Effort[]
  defaultEffort?: EffortId
}

export interface ChatMessage { role: "user" | "assistant"; content: string }
/** "ai": a model answered. "keyword": a word search, no model. "scripted": fixed text, no model and no research. */
export type ChatMode = "ai" | "keyword" | "scripted"
export interface CitedRun { kind: "swarm" | "board"; id: string; title: string; why: string }
export interface PlanLimits { maxUsd: number; maxMinutes: number; maxRounds: number }
/** A proposal for a board review. A plan starts nothing; POST /api/chat/plans/:id/start does, after a person confirms. */
export interface Plan {
  id: string; question: string; kind: "board"; briefTitle: string
  /** Markdown, written by a model or by a script. Untrusted. */
  brief: string
  agents: { name: string; title: string; why: string }[]
  skills: { name: string; why: string }[]
  search: { exa: boolean }
  models: { lead: string; members: string; checker: string }
  limits: PlanLimits
  estimate: { usd: number | null; basis: string }
  /** The effort level this plan was written for, when the engine says. */
  effort?: EffortId
  /** The plan would spend money when started. */
  paid: boolean
  warnings: string[]
}
export interface ChatReply { reply: string; mode: ChatMode; note?: string; runs?: CitedRun[]; plan?: Plan }
export interface ChatRequest { messages: ChatMessage[]; provider?: ProviderId; model?: string; effort?: EffortId }
export interface StartRequest { confirm: true; effort?: EffortId; limits?: PlanLimits; agents?: string[] }

export interface Started { kind: "board"; id: string }

/** The engine said no, or could not be reached (status 0). `field`: the control a 400 is about. `run`: on 409, the run the plan already started, when the engine names it. */
export class ChatRefused extends Error {
  status: number; field?: string; run?: string
  constructor(message: string, status: number, field?: string, run?: string) { super(message); this.status = status; this.field = field; this.run = run }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response
  try { r = await (init ? engineFetch : fetch)(ENGINE + path, init) } // reads need no token; requests that change something may
  catch { throw new ChatRefused("The app's engine isn't running. Start it with: npm start. Then send your question again.", 0) }
  const body: unknown = await r.json().catch(() => undefined)
  if (r.ok) return body as T
  const b = (body ?? {}) as { error?: unknown; field?: unknown; id?: unknown; run?: unknown }
  const run = typeof b.id === "string" ? b.id : typeof b.run === "string" ? b.run : undefined
  throw new ChatRefused(typeof b.error === "string" ? b.error : `The engine answered ${r.status}.`, r.status, typeof b.field === "string" ? b.field : undefined, run)
}
/** The engine is running but has no chat routes: it was started before they existed. Not the same as "not running". */
export const NO_CHAT_ROUTES = "This engine is running, but it has no chat routes yet. Stop the app and start it again with: npm start."
const routeMissing = (error: unknown): never => { throw error instanceof ChatRefused && error.status === 404 ? new ChatRefused(NO_CHAT_ROUTES, 404) : error }
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

const isRuns = (x: unknown): x is CitedRun[] => Array.isArray(x) && x.every((r) => r && (r.kind === "swarm" || r.kind === "board") && typeof r.id === "string")
/** Is this a plan the card can show? A reply with a broken plan is shown without it, never crashes the view. */
export function isPlan(x: unknown): x is Plan {
  const p = x as Plan | null
  return !!p && typeof p.id === "string" && typeof p.question === "string" && typeof p.brief === "string" && Array.isArray(p.agents) && Array.isArray(p.skills)
    && !!p.search && !!p.models && !!p.limits && typeof p.limits.maxUsd === "number" && !!p.estimate && typeof p.paid === "boolean" && Array.isArray(p.warnings)
}
export function isCatalog(x: unknown): x is Catalog {
  const c = x as Catalog | null
  return !!c && typeof c.paidCalls === "boolean" && Array.isArray(c.providers) && !!c.search?.exa && Array.isArray(c.agents) && Array.isArray(c.skills)
}

export async function getCatalog(): Promise<Catalog> {
  const body = await call<unknown>("/api/chat/catalog").catch(routeMissing)
  if (!isCatalog(body)) throw new ChatRefused("The engine sent a catalog this page cannot read.", 200)
  return body
}

/** Sends the conversation. Rejects with ChatRefused; a 2xx reply that is not a chat reply is refused too. */
export async function sendChat(request: ChatRequest): Promise<ChatReply> {
  const body = await call<Partial<ChatReply>>("/api/chat", json(request)).catch(routeMissing)
  if (!body || typeof body.reply !== "string" || (body.mode !== "ai" && body.mode !== "keyword" && body.mode !== "scripted")) {
    throw new ChatRefused("The engine sent a reply this page cannot read.", 200)
  }
  return {
    reply: body.reply, mode: body.mode,
    ...(typeof body.note === "string" && body.note && { note: body.note }),
    ...(isRuns(body.runs) && body.runs.length > 0 && { runs: body.runs }),
    ...(isPlan(body.plan) && { plan: body.plan }),
  }
}

/** Starts the plan as a board review. Only ever called after a person confirmed in the plan card. */
export async function startPlan(id: string, request: StartRequest): Promise<Started> {
  const body = await call<Partial<Started>>(`/api/chat/plans/${encodeURIComponent(id)}/start`, json(request))
  if (!body || typeof body.id !== "string") throw new ChatRefused("The engine started something but did not say what.", 200)
  return { kind: "board", id: body.id }
}
