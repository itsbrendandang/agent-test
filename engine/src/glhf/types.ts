// The GLHF run-tracker contract. The dashboard's Swarm view is built against these shapes; do not rename.
export type GlhfPhase = "queued" | "launching" | "running" | "completing" | "done" | "failed"
export type Solver = "single" | "glhf"
export type Mode = "local" | "cloud"
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
  phase: GlhfPhase
  detail?: string
  startedAt: number // ms
  finishedAt?: number
  score?: number
  artifacts?: { artifact_id: string; score: number }[]
  usage?: Usage
  error?: string
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
}

/** Largest budgets a request may ask for. */
export const MAX_TIME_LIMIT = 86_400 // seconds: the benchmark's 24 hours
export const MAX_TOKENS = 500_000_000
export const MAX_MESSAGES_PER_ROLE = 5_000
export const MAX_REVIEW_ROUNDS = 10

export const RECORD = 0.523 // BixBench3 best published score (the bar to beat)
