// Client for the engine (engine/src/server.ts). The engine owns runs; the dashboard only watches and starts them.
import { useEffect, useMemo, useState } from "react"
import { ENGINE, readEngine } from "@/lib/engine"
import { engineFetch } from "@/lib/token"

export { ENGINE }

export type Verdict = "verified" | "unsupported" | "contradicted" | "unchecked"

export interface RosterMember {
  name: string; title: string; role: "lead" | "member"; model: string; modelId: string; tools: string[]; deliverable?: string
}
export interface RunSummary { id: string; brief: string; rounds: number; startedAt: number; status: "done" | "running" | "paused"; claims: number }
/** `paidCalls` false: the engine's NO_PAID_CALLS switch is on, so the board runs with scripted models only. */
export interface Status { mock: boolean; paidCalls?: boolean; keys: Record<string, boolean>; meeting: { max_minutes: number; max_usd: number; max_rounds: number } }

// Mirrors engine/src/events.ts
export type BoardEvent = { key: string; at: number } & (
  | { type: "run.started"; runId: string; brief: string; title: string; mock: boolean }
  | { type: "round.started"; round: number; message: string; final: boolean }
  | { type: "member.replied"; round: number; member: string; text: string }
  | { type: "evidence.triaged"; member: string; query: string; kept: number; dropped: number; items: { url: string; title: string; studyType?: string }[] }
  | { type: "claim.checked"; round: number; member: string; claim: string; kind: string; verdict: Verdict; checker: string; p?: number; note?: string; checkedBy?: string; source?: string }
  | { type: "constraint"; reason: string; detail: string }
  | { type: "memo.written"; path: string; decision: string }
  | { type: "run.finished"; usd: number; minutes: number }
  | { type: "run.failed"; error: string }
  | { type: "run.resumed" | "lead.framed"; [k: string]: unknown }
)

export const get = readEngine
export const post = <T,>(path: string, body?: unknown): Promise<T> =>
  engineFetch(ENGINE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) })
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `The engine answered ${r.status}.`))))
export const memo = (runId: string) => fetch(`${ENGINE}/api/runs/${encodeURIComponent(runId)}/memo`).then((r) => (r.ok ? r.text() : ""))

/** Every event of a run, replayed then live. Events with the same key replace each other (replays after a crash). */
export function useRunEvents(runId: string | undefined): BoardEvent[] {
  // Events are kept with the run they belong to, so another run's events are never shown while a new stream opens.
  const [got, setGot] = useState<{ runId: string; events: BoardEvent[] }>()
  useEffect(() => {
    if (!runId) return
    const source = new EventSource(`${ENGINE}/api/runs/${encodeURIComponent(runId)}/events`)
    source.onmessage = (m) => {
      const e = JSON.parse(m.data) as BoardEvent
      setGot((old) => ({ runId, events: [...(old?.runId === runId ? old.events : []).filter((x) => x.key !== e.key), e] }))
    }
    return () => source.close()
  }, [runId])
  return useMemo(() => (got && got.runId === runId ? got.events : []), [got, runId])
}
