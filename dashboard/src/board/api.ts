// Client for the engine (engine/src/server.ts). The engine owns runs; the dashboard only watches and starts them.
import { useEffect, useState } from "react"

export const ENGINE = (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? "http://localhost:8787"

export type Verdict = "verified" | "unsupported" | "contradicted" | "unchecked"

export interface RosterMember {
  name: string; title: string; role: "lead" | "member"; model: string; modelId: string; tools: string[]; deliverable?: string
}
export interface RunSummary { id: string; brief: string; rounds: number; startedAt: number; status: "done" | "running" | "paused"; claims: number }
export interface Status { mock: boolean; keys: Record<string, boolean>; meeting: { max_minutes: number; max_usd: number; max_rounds: number } }

// Mirrors engine/src/events.ts
export type BoardEvent = { key: string; at: number } & (
  | { type: "run.started"; runId: string; brief: string; title: string; mock: boolean }
  | { type: "round.started"; round: number; message: string; final: boolean }
  | { type: "member.replied"; round: number; member: string; text: string }
  | { type: "evidence.triaged"; member: string; query: string; kept: number; dropped: number; items: { url: string; title: string; studyType?: string }[] }
  | { type: "claim.checked"; round: number; member: string; claim: string; kind: string; verdict: Verdict; checker: string; p?: number; note?: string }
  | { type: "constraint"; reason: string; detail: string }
  | { type: "memo.written"; path: string; decision: string }
  | { type: "run.finished"; usd: number; minutes: number }
  | { type: "run.failed"; error: string }
  | { type: "run.resumed" | "lead.framed"; [k: string]: unknown }
)

export const get = <T,>(path: string): Promise<T> => fetch(ENGINE + path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
export const post = <T,>(path: string, body?: unknown): Promise<T> =>
  fetch(ENGINE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) })
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? r.status))))
export const memo = (runId: string) => fetch(`${ENGINE}/api/runs/${encodeURIComponent(runId)}/memo`).then((r) => (r.ok ? r.text() : ""))

/** Every event of a run, replayed then live. Events with the same key replace each other (replays after a crash). */
export function useRunEvents(runId: string | undefined): BoardEvent[] {
  const [events, setEvents] = useState<BoardEvent[]>([])
  useEffect(() => {
    setEvents([])
    if (!runId) return
    const source = new EventSource(`${ENGINE}/api/runs/${encodeURIComponent(runId)}/events`)
    source.onmessage = (m) => {
      const e = JSON.parse(m.data) as BoardEvent
      setEvents((all) => [...all.filter((x) => x.key !== e.key), e])
    }
    return () => source.close()
  }, [runId])
  return events
}
