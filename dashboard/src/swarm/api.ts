// Client for the GLHF run tracker routes of the engine (/api/glhf/*). Polling, no SSE.
import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"

export type GlhfPhase = "queued" | "launching" | "running" | "completing" | "done" | "failed"
export type Solver = "single" | "glhf"
export interface Usage { input_tokens: number; output_tokens: number; total_tokens: number }
/** Budgets and extras of a run: what decides whether two runs can be compared. */
export interface RunSettings {
  timeLimit?: number; maxTokens?: number; maxMessagesPerRole?: number; reviewRounds?: number
  exa?: boolean; memory?: boolean; seed?: number; effort?: string
}
export interface GlhfRun {
  id: string; mode: "local" | "cloud"; task: string; solver: Solver; model: string
  roleModels: Record<string, string>; settings?: RunSettings; phase: GlhfPhase; detail?: string
  startedAt: number; finishedAt?: number; score?: number
  artifacts?: { artifact_id: string; score: number }[]
  usage?: Record<string, Usage>; error?: string
}
export interface GlhfStatus {
  record: number
  tools: { docker: boolean; uv: boolean; gcloud: boolean }
  keys: { ANTHROPIC_API_KEY: boolean; OPENAI_API_KEY: boolean; HF_TOKEN: boolean }
  project: string | null
}

// Mirrors engine/src/glhf/scoreboard.ts, which does the pairing (GET /api/glhf/scoreboard).
export interface ScoreCell { id: string; phase: "done" | "failed"; score?: number; startedAt: number; extras: string[] }
export interface ScoreRow {
  task: string; model: string; timeLimit?: number; maxTokens?: number
  single?: ScoreCell; swarm?: ScoreCell; diff?: number; note?: string
}

// Mirrors Ledger.to_json in glhf/bixbench/src/bixbench3/inspect_harness/swarm/ledger.py
export type ClaimVerdict = "supported" | "refuted" | "insufficient" | "untested"
export interface LedgerTest { name: string; p_value: number; contradicts: boolean; note: string; by: string; e_value: number }
export interface LedgerClaim {
  id: string; text: string; artifact_ids: string[]; proposed_by: string; null_hypothesis: string
  tests: LedgerTest[]; replication_failed: boolean; e_value: number; verdict: ClaimVerdict
}
export interface LedgerIssue {
  id: string; severity: "blocking" | "major" | "minor"; artifact_ids: string[]; problem: string
  evidence: string; raised_by: string; status: "open" | "fixed" | "wontfix"; resolution: string
}
export interface LedgerEvent { kind: string; phase?: string; [k: string]: unknown }
export interface Ledger { alpha: number; kappa: number; claims: LedgerClaim[]; issues: LedgerIssue[]; events: LedgerEvent[] }
export interface RunDetail { run: GlhfRun; ledger: Ledger | null; findings: string | null; methods: string | null }

const get = <T,>(path: string): Promise<T> =>
  fetch(ENGINE + path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))

/** POST /api/glhf/runs body for a local run. Mirrors RunRequest in engine/src/glhf/types.ts; the engine checks it again. */
export interface StartRequest {
  mode: "local"; task: "demo"; solver: Solver; model: string
  timeLimit: number; maxTokens?: number; reviewRounds?: number; exa?: boolean; memory?: boolean; seed?: number
}
/** Limits the engine enforces (checkRequest in engine/src/glhf/tracker.ts and the constants in types.ts). */
export const LIMITS = { minutes: [1, 1440], tokens: [1_000, 500_000_000], reviewRounds: [1, 10], seed: [1, 2 ** 31 - 1] } as const
export const MODEL_ID = /^[\w./:@-]{1,200}$/

/** Starts one run. Rejects with the engine's own message when it refuses the request. */
export const startRun = (body: StartRequest): Promise<{ id: string }> =>
  fetch(`${ENGINE}/api/glhf/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => {
      const reply = await r.json().catch(() => ({}))
      if (r.ok && typeof reply.id === "string") return reply as { id: string }
      throw new Error(typeof reply.error === "string" ? reply.error : `The engine answered ${r.status}.`)
    }, () => { throw new Error("The engine cannot be reached. Start it with npm run engine.") })

export const isLive = (r: GlhfRun) => r.phase !== "done" && r.phase !== "failed"
/** Demo case or scripted model: never a benchmark result. */
export const isDemo = (r: GlhfRun) => r.task === "demo" || r.model === "mock"

/** Status, the run list, the scoreboard and the selected run, polled every 2 s while a run is live and every 15 s otherwise. */
export function useSwarm(selected: string | undefined, nudge: number) {
  const [status, setStatus] = useState<GlhfStatus>()
  const [runs, setRuns] = useState<GlhfRun[]>()
  const [detail, setDetail] = useState<RunDetail>()
  const [board, setBoard] = useState<ScoreRow[] | null>() // undefined: not loaded yet; null: the engine has no scoreboard
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      let live = false
      try {
        const [s, list, rows] = await Promise.all([
          get<GlhfStatus>("/api/glhf/status"), get<GlhfRun[]>("/api/glhf/runs"),
          get<ScoreRow[]>("/api/glhf/scoreboard").catch(() => null), // an older engine has no scoreboard route
        ])
        if (stopped) return
        setStatus(s); setRuns(list); setBoard(rows); setOffline(false)
        live = list.some(isLive)
        const id = selected ?? list[0]?.id
        if (id) {
          const d = await get<RunDetail>(`/api/glhf/runs/${encodeURIComponent(id)}`).catch(() => undefined)
          if (stopped) return
          setDetail(d)
        } else setDetail(undefined)
      } catch {
        if (stopped) return
        setOffline(true)
      }
      timer = setTimeout(tick, live ? 2000 : 15000)
    }
    void tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [selected, nudge])

  return { status, runs, detail, offline, scoreboard: board }
}
