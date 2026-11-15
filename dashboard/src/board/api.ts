// Client for the engine (engine/src/server.ts). The engine owns runs; the dashboard only watches and starts them.
import { useEffect, useMemo, useState } from "react"
import { ENGINE, readEngine, tracked } from "@/lib/engine"
import { engineFetch } from "@/lib/token"

export { ENGINE }

export type Verdict = "verified" | "unsupported" | "contradicted" | "unchecked"

export interface RosterMember {
  name: string; title: string; role: "lead" | "member"; model: string; modelId: string; tools: string[]; deliverable?: string
  /** One agent playing several roles: mode id -> role title. The active mode is on each member.replied event. */
  modes?: Record<string, string>
}
export interface RunSummary { id: string; brief: string; rounds: number; startedAt: number; status: "done" | "running" | "paused" | "failed"; claims: number; /** Why a failed run stopped, in plain words. */ error?: string; /** Present when the run searched. */ search?: { searches: number; provider?: SearchProvider } }
/** "exa": a live web search. "europepmc": a free literature search. The six databases return records, not papers. "fixture": a practice run's example sources, not a search. */
export type SearchProvider = "exa" | "fixture" | "europepmc" | "chembl" | "clinicaltrials" | "openfda" | "opentargets" | "uniprot" | "pubchem"
/** The public databases a scout can look records up in. */
export const DATABASES: readonly SearchProvider[] = ["chembl", "clinicaltrials", "openfda", "opentargets", "uniprot", "pubchem"]
/** `paidCalls` false: the engine's NO_PAID_CALLS switch is on, so the board runs with scripted models only. */
export interface Status { mock: boolean; paidCalls?: boolean; keys: Record<string, boolean>; meeting: { max_minutes: number; max_usd: number; max_rounds: number; max_searches?: number; max_literature_searches?: number } }

// Mirrors engine/src/events.ts
/** A source a search kept. `relevance` and `studyType` are what the engine recorded; the title and URL are untrusted. */
export interface EvidenceItem { url: string; title: string; studyType?: string; relevance?: number; provider?: SearchProvider; /** The query that found it (newer runs). */ query?: string }
export type BoardEvent = { key: string; at: number } & (
  | { type: "run.started"; runId: string; brief: string; title: string; mock: boolean }
  | { type: "round.started"; round: number; message: string; final: boolean }
  /** Who took part in this run, in speaking order. Runs recorded before this event existed have none. */
  | { type: "run.roster"; members: { name: string; title: string; role: "lead" | "member"; source?: "board" | "specialist"; why?: string; methods?: { name: string; title: string }[] }[] }
  | { type: "member.replied"; round: number; member: string; text: string; /** What this reply cost. */ usd?: number; /** The sentence after "In short:", when the member wrote one. */ summary?: string }
  | { type: "evidence.triaged"; member: string; query: string; kept: number; dropped: number; provider?: SearchProvider; items: EvidenceItem[] }
  | never
  | { type: "claim.checked"; round: number; member: string; claim: string; kind: string; verdict: Verdict; checker: string; p?: number; note?: string; checkedBy?: string; source?: string; /** Whether the passage the checker quoted was found in the source text. */ quoteFound?: boolean }
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
export const memo = (runId: string) => tracked(fetch(`${ENGINE}/api/runs/${encodeURIComponent(runId)}/memo`)).then((r) => (r.ok ? r.text() : ""))

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
