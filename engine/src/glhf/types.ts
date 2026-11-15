// The GLHF run-tracker contract. The dashboard's Swarm view is built against these shapes; do not rename.
import { discoverLocalModels, type LocalModel, type ModelClass } from "../local.ts"
import { paidCallsOff } from "../paid/paid.ts"

// "cancelled": stopped on request (POST /api/glhf/runs/:id/cancel). It is settled like done and failed, but it is
// not a result: the scoreboard leaves it out.
export type GlhfPhase = "queued" | "launching" | "running" | "completing" | "done" | "failed" | "cancelled"
/** A run that will not change any more. */
export const settled = (phase: GlhfPhase) => phase === "done" || phase === "failed" || phase === "cancelled"
export type Solver = "single" | "glhf"
export type Mode = "local" | "cloud"
/**
 * Where a local run's analyses execute (every command the roles run and every registered test): "local" is a Docker
 * container on this machine, "modal" a Modal sandbox (ANALYSIS_BACKEND, see modal.ts). Cloud runs run theirs on their VM.
 */
export type AnalysisBackend = "local" | "modal"
export type Usage = Record<string, { input_tokens: number; output_tokens: number; total_tokens: number }>

/** The settings that decide whether two runs can be compared. Copied from the request when a run starts. */
export interface RunSettings {
  /** Seconds for the whole run. Local runs default to 1800; cloud runs use the benchmark's limit. */
  timeLimit?: number
  maxTokens?: number
  maxMessagesPerRole?: number
  reviewRounds?: number
  exa?: boolean
  memory?: boolean
  seed?: number
  effort?: string
  /** A short fingerprint of the case directory, when the run did not use the built-in demo case. */
  caseId?: string
  /** "modal" when the analyses ran in a Modal sandbox (another machine and image: not comparable with a local run). Absent: on this machine. */
  analysisBackend?: AnalysisBackend
}

export interface GlhfRun {
  id: string
  mode: Mode
  task: string
  solver: Solver
  model: string
  roleModels: Record<string, string>
  /** Budgets and extras of this run. Records written before this field existed get it from their request. */
  settings?: RunSettings
  /** Cloud runs: the id of the run on the benchmark's side, once known. */
  remoteId?: string
  /**
   * "scripted", "local" (a real model on this machine: free, nothing leaves it) or "paid"; over the model and the
   * role models, the costliest class wins. From runModelClass in ../local.ts when the run is created. Records
   * written before this field existed do not have it: read `model` then ("mock" is scripted).
   */
  modelClass?: ModelClass
  /** The same for a reader: "scripted model", "local model (qwen2.5:14b)", "paid model (openai/gpt-5.5)". Show this, not `model`, next to a score. */
  modelLabel?: string
  phase: GlhfPhase
  detail?: string
  startedAt: number // ms
  finishedAt?: number
  score?: number
  artifacts?: { artifact_id: string; score: number }[]
  usage?: Usage
  error?: string
  /** The run this one waits for: it starts only when that run is settled (the second run of a matched pair). */
  after?: string
  /** The other run of a matched pair (POST /api/glhf/runs with `solvers`). */
  pairedWith?: string
  /** Something to keep in mind when reading this run, such as "started although <id> failed: ...". Kept to the end. */
  note?: string
  /** Runs on Modal, once settled: what their sandboxes cost by the run's cost ledger (an estimate; Modal's bill is the authority), and how many there were. */
  modal?: { usd: number; sandboxes: number; maxUsd: number }
}

/** POST /api/glhf/runs body, and the input of the durable task. JSON only (it is stored in the task). */
export interface RunRequest {
  mode: Mode
  task?: string
  solver: Solver
  model: string
  roleModels?: Record<string, string>
  effort?: string
  project?: string
  resultsBucket?: string
  timeLimit?: number
  reviewRounds?: number
  caseDir?: string
  /** Token budget for the whole run (both solvers). */
  maxTokens?: number
  /** Swarm: message cap per phase. A model call with one tool call is two messages. */
  maxMessagesPerRole?: number
  /** Swarm: documentation search through Exa (needs EXA_API_KEY). */
  exa?: boolean
  /** Swarm: read and write lessons in glhf/memory/ between runs. */
  memory?: boolean
  /** Sent to providers that support a seed. */
  seed?: number
  /** Start only when this run is settled. Set by the tracker for the second run of a pair, never by a caller. */
  after?: string
  /** "modal" when the analyses run in a Modal sandbox (ANALYSIS_BACKEND=modal, local runs; billed, needs the token). Set by the tracker, never by a caller. */
  analysisBackend?: AnalysisBackend
  /** Modal runs: the most this run may cost on Modal, in USD (GLHF_MODAL_MAX_USD when the run was started). Set by the tracker, never by a caller. */
  modalMaxUsd?: number
}

/**
 * POST /api/glhf/runs body: a RunRequest, where `solvers` may replace `solver`. Two solvers start a matched pair of
 * local runs, one after the other in the order given, with the same task, model, time limit, token budget and seed.
 */
export type StartBody = Partial<Omit<RunRequest, "after" | "analysisBackend" | "modalMaxUsd">> & { solvers?: Solver[] }

/** A field of the New-run form that a refusal is about, so the form can show the message next to the right input. */
export type Field = "timeLimit" | "maxTokens" | "seed" | "reviewRounds" | "maxMessagesPerRole" | "model" | "exa" | "memory" | "mode" | "caseDir" | "solver" | "analysisBackend"

export const MAX_SEED = 2 ** 31 - 1

/**
 * What a request may ask for, as [smallest, largest]. The one place these numbers live: checkRequest enforces them
 * and GET /api/glhf/status publishes them, so the dashboard does not keep a copy.
 */
export const LIMITS = {
  timeLimit: [60, 86_400], // seconds; the largest is the benchmark's 24 hours
  maxTokens: [1_000, 500_000_000],
  reviewRounds: [1, 10],
  maxMessagesPerRole: [2, 5_000],
  seed: [1, MAX_SEED],
} as const

/**
 * The models the New-run form offers, after "mock", and the key each needs. Any other model id can still be typed.
 */
export const MODEL_CHOICES = [
  { id: "anthropic/claude-sonnet-5-5", key: "ANTHROPIC_API_KEY" },
  { id: "anthropic/claude-haiku-5-5", key: "ANTHROPIC_API_KEY" },
  { id: "openai/gpt-5.5", key: "OPENAI_API_KEY" },
] as const

/**
 * "mock" first, then the models whose key is set. Only "mock" while paid calls are off (NO_PAID_CALLS, ../paid.ts).
 * Local models are not in this list: they are found by asking the server (modelCatalogue below).
 */
export const modelsFor = (env: NodeJS.ProcessEnv = process.env): string[] => ["mock", ...(paidCallsOff(env) ? [] : MODEL_CHOICES.filter((m) => Boolean(env[m.key])).map((m) => m.id))]

/** One model the New-run form can offer. `cost` is what to print next to the token budget. */
export type CatalogueEntry =
  | { id: string; class: "scripted"; local: false; cost: "free"; label: string }
  | { id: string; class: "paid"; local: false; cost: "paid"; label: string; key: string }
  | (LocalModel & { class: "local" })

/**
 * Every model a run can be started with now, in three classes: the scripted one, the local ones the Ollama server
 * on this machine lists at this moment (none when it is down; see discoverLocalModels), and the paid ones whose key
 * is set, which are absent while paid calls are off. Local models stay while paid calls are off.
 */
export async function modelCatalogue(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<CatalogueEntry[]> {
  const local = await discoverLocalModels(env, fetcher)
  return [
    { id: "mock", class: "scripted", local: false, cost: "free", label: "scripted model" },
    ...local.map((m) => ({ ...m, class: "local" as const })),
    ...modelsFor(env).slice(1).map((id) => ({ id, class: "paid" as const, local: false as const, cost: "paid" as const, label: `paid model (${id})`, key: MODEL_CHOICES.find((m) => m.id === id)!.key })),
  ]
}

/**
 * The token budget of a local run. maxTokens is required for a local model as for a paid one: nothing is billed,
 * but a model that loops would hold the machine until the time limit, and the budget is what the solvers plan by.
 * The estimate of its cost is zero and reads "local, free".
 */
export const costEstimate = (modelClass: ModelClass): { usd: number | null; note: string } =>
  modelClass === "paid" ? { usd: null, note: "paid: billed by the provider" } : { usd: 0, note: modelClass === "local" ? "local, free" : "scripted, free" }

export const RECORD = 0.523 // BixBench3 best published score (the bar to beat)
