// A stand-in for the engine in tests: records each request and answers from a list of replies, in order.
import { vi } from "vitest"
import type { GlhfStatus } from "@/swarm/api"

export interface Sent { url: string; method: string; body: unknown }

export function engine(...replies: { status: number; body: unknown }[]) {
  const sent: Sent[] = []
  const queue = [...replies]
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined })
    const reply = queue.shift()
    if (!reply) throw new TypeError("no reply left")
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } })
  }))
  return sent
}

const LIMITS = { timeLimit: [60, 86_400], maxTokens: [1_000, 500_000_000], reviewRounds: [1, 10], maxMessagesPerRole: [2, 5_000], seed: [1, 2_147_483_647] } as const
const KEYS = { ANTHROPIC_API_KEY: true, OPENAI_API_KEY: true, HF_TOKEN: false, EXA_API_KEY: true }

/** GET /api/glhf/status as the engine answers with the NO_PAID_CALLS switch on (its default). */
export const PAID_OFF: GlhfStatus = { record: 0.523, tools: { docker: true, uv: true, gcloud: false }, keys: KEYS, project: null, paidCalls: false, limits: LIMITS, models: ["mock"] }
/** The same engine after a person set NO_PAID_CALLS=0. */
export const PAID_ON: GlhfStatus = { ...PAID_OFF, paidCalls: true, models: ["mock", "anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "openai/gpt-5.5"] }

type Reply = { status: number; body: unknown }
export type SentTo = Sent & { headers: Record<string, string>; query: string }
type Answer = Reply | ((sent: SentTo) => Reply | Promise<Reply>)
/**
 * A stand-in engine with routes: "GET /api/chat/catalog": reply. A list of replies is used up in order (the last one
 * repeats); a function sees the request. A request to a route that is not listed fails like a network error.
 */
export function routes(table: Record<string, Answer | Answer[]>) {
  const sent: Sent[] = []
  const left = new Map(Object.entries(table).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]))
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const at = new URL(String(url))
    const request: Sent & { headers: Record<string, string>; query: string } = {
      url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: { ...(init?.headers as Record<string, string> | undefined) }, query: at.search,
    }
    sent.push(request)
    const queue = left.get(`${request.method} ${at.pathname}`)
    if (!queue) throw new TypeError(`no route for ${request.method} ${at.pathname}`)
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    const reply = typeof next === "function" ? await next(request) : next
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } })
  }))
  return sent as (Sent & { headers: Record<string, string>; query: string })[]
}
/** The requests to one route, in order. */
export const to = <T extends Sent>(sent: T[], method: string, path: string) => sent.filter((s) => s.method === method && new URL(s.url).pathname === path)
