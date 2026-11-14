// Client for the GLHF run tracker routes of the engine (/api/glhf/*). Polling, no SSE.
import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"

// "queued": waits for another run (`after`) or for the runner. "cancelled": stopped on request; settled, but not a result.
export type GlhfPhase = "queued" | "launching" | "running" | "completing" | "done" | "failed" | "cancelled"
/** A run that will not change any more. */
export const settled = (phase: GlhfPhase) => phase === "done" || phase === "failed" || phase === "cancelled"
export type Solver = "single" | "glhf"
export interface Usage { input_tokens: number; output_tokens: number; total_tokens: number }
/** Budgets and extras of a run: what decides whether two runs can be compared. */
export interface RunSettings {
  timeLimit?: number; maxTokens?: number; maxMessagesPerRole?: number; reviewRounds?: number
  exa?: boolean; memory?: boolean; seed?: number; effort?: string; caseId?: string
}
export interface GlhfRun {
  id: string; mode: "local" | "cloud"; task: string; solver: Solver; model: string
  roleModels: Record<string, string>; settings?: RunSettings; phase: GlhfPhase; detail?: string
  startedAt: number; finishedAt?: number; score?: number
  artifacts?: { artifact_id: string; score: number }[]
  usage?: Record<string, Usage>; error?: string
  /** The run this one waits for: it starts when that run is settled (the second run of a pair). */
  after?: string
  /** The other run of a matched pair. */
  pairedWith?: string
  /** Something to keep in mind when reading this run, such as "started although <id> failed". */
  note?: string
}
/** [smallest, largest] */
export type Range = readonly [number, number]
export interface GlhfStatus {
  record: number
  tools: { docker: boolean; uv: boolean; gcloud: boolean }
  keys: { ANTHROPIC_API_KEY: boolean; OPENAI_API_KEY: boolean; HF_TOKEN: boolean; EXA_API_KEY?: boolean }
  project: string | null
  /** What a request may ask for. timeLimit is in seconds. Absent on an older engine; the engine checks in any case. */
  limits?: { timeLimit: Range; maxTokens: Range; reviewRounds: Range; maxMessagesPerRole: Range; seed?: Range }
  /** Models the form offers: "mock" first, then the models whose key is set. */
  models?: string[]
}

// Mirrors engine/src/glhf/scoreboard.ts, which does the pairing (GET /api/glhf/scoreboard).
export interface ScoreCell { id: string; phase: "done" | "failed"; score?: number; startedAt: number; extras: string[] }
export interface ScoreRow {
  task: string; model: string; timeLimit?: number; maxTokens?: number
  single?: ScoreCell; swarm?: ScoreCell; diff?: number; note?: string
}

// Mirrors Ledger.to_json in glhf/bixbench/src/bixbench3/inspect_harness/swarm/ledger.py
export type ClaimVerdict = "supported" | "refuted" | "insufficient" | "untested"
/** `registered` false: a result that goes against the claim, recorded without registration. Absent on older ledgers. */
export interface LedgerTest { name: string; p_value: number; contradicts: boolean; note: string; by: string; e_value: number; registered?: boolean }
/** A test written down before any result of its claim exists: its name, and what will be run and what would contradict the claim. */
export interface LedgerRegistration { name: string; method: string; by: string }
export interface LedgerClaim {
  id: string; text: string; artifact_ids: string[]; proposed_by: string; null_hypothesis: string
  tests: LedgerTest[]; replication_failed: boolean; e_value: number; verdict: ClaimVerdict
  /** Every test registered for this claim. Absent on older ledgers. */
  registered?: LedgerRegistration[]
  /** Names of registered tests with no result yet. Each counts as 0 and keeps the claim from being supported. */
  pending_tests?: string[]
  /** The evidence score this claim needs to be supported (claims in the run / alpha). */
  threshold?: number
}
export interface LedgerIssue {
  id: string; severity: "blocking" | "major" | "minor"; artifact_ids: string[]; problem: string
  evidence: string; raised_by: string; status: "open" | "fixed" | "wontfix"; resolution: string
}
export interface LedgerEvent { kind: string; phase?: string; [k: string]: unknown }
export interface Ledger {
  alpha: number; kappa: number; claims: LedgerClaim[]; issues: LedgerIssue[]; events: LedgerEvent[]
  /** How a claim's test scores are combined. Present on ledgers that use the mean; older ones multiplied. */
  combination?: string; claims_in_family?: number; support_threshold?: number; max_tests_per_claim?: number
}
export interface RunDetail { run: GlhfRun; ledger: Ledger | null; findings: string | null; methods: string | null }

const get = <T,>(path: string): Promise<T> =>
  fetch(ENGINE + path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))

/**
 * POST /api/glhf/runs body for a local run on the demo case. Mirrors StartBody in engine/src/glhf/types.ts. `solvers`
 * with two entries starts a matched pair: the second run is queued and starts when the first has ended. In a pair the
 * engine applies reviewRounds, exa and memory to the swarm only.
 */
export interface StartRequest {
  mode: "local"; task: "demo"; model: string; solver?: Solver; solvers?: Solver[]
  timeLimit: number; maxTokens?: number; reviewRounds?: number; exa?: boolean; memory?: boolean; seed?: number
}
/** The fields a refusal can be about ({error, field?} from the engine). */
export type StartField = "timeLimit" | "maxTokens" | "seed" | "reviewRounds" | "maxMessagesPerRole" | "model" | "exa" | "memory" | "mode" | "caseDir" | "solver"
/** The engine said no. `field`: the input it is about (400). `run`: the local run that is in the way (409). */
export class Refused extends Error {
  status: number; field?: StartField; run?: string
  constructor(message: string, status: number, field?: StartField, run?: string) { super(message); this.status = status; this.field = field; this.run = run }
}

const send = async <T,>(path: string, body?: unknown): Promise<T> => {
  let r: Response
  try {
    r = await fetch(ENGINE + path, body === undefined ? { method: "POST" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  } catch { throw new Refused("The engine cannot be reached. Start it with npm run engine.", 0) }
  const reply = await r.json().catch(() => ({}))
  if (r.ok) return reply as T
  throw new Refused(typeof reply.error === "string" ? reply.error : `The engine answered ${r.status}.`, r.status,
    typeof reply.field === "string" ? reply.field : undefined, typeof reply.run === "string" ? reply.run : undefined)
}

/** Starts one run, or a pair. `ids` are in the order the runs will go. Rejects with Refused. */
export const startRun = async (body: StartRequest): Promise<string[]> => {
  const reply = await send<{ id?: string; ids?: string[] }>("/api/glhf/runs", body)
  const ids = Array.isArray(reply.ids) ? reply.ids : reply.id ? [reply.id] : []
  if (!ids.length) throw new Refused("The engine started a run but did not say which.", 200)
  return ids
}
/** Stops a live or queued run. The engine also cancels a partner queued behind it. Rejects with Refused (409 for a cloud run). */
export const cancelRun = (id: string): Promise<GlhfRun> => send<GlhfRun>(`/api/glhf/runs/${encodeURIComponent(id)}/cancel`)

export const isLive = (r: GlhfRun) => !settled(r.phase)
/** Demo case or scripted model: never a benchmark result. */
export const isDemo = (r: GlhfRun) => r.task === "demo" || r.model === "mock"

/** Status, the run list, the scoreboard and the selected run, polled every 2 s while a run is live and every 15 s otherwise. */
/** The newest swarm run, for views that show the swarm's roles. Module-level, so its identity is stable. */
export const latestSwarmRun = (runs: GlhfRun[]) => runs.find((r) => r.solver === "glhf")?.id

/** `choose` picks the run to load when none is selected; by default the newest run. It must be a stable function. */
export function useSwarm(selected: string | undefined, nudge: number, choose?: (runs: GlhfRun[]) => string | undefined) {
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
        const id = selected ?? (choose ? choose(list) : list[0]?.id)
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
  }, [selected, nudge, choose])

  return { status, runs, detail, offline, scoreboard: board }
}
