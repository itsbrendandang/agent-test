// The GLHF run-tracker contract. The dashboard's Swarm view is built against these shapes; do not rename.
export type GlhfPhase = "queued" | "launching" | "running" | "completing" | "done" | "failed"
export type Solver = "single" | "glhf"
export type Mode = "local" | "cloud"
export type Usage = Record<string, { input_tokens: number; output_tokens: number; total_tokens: number }>

export interface GlhfRun {
  id: string
  mode: Mode
  task: string
  solver: Solver
  model: string
  roleModels: Record<string, string>
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
}

export const RECORD = 0.523 // BixBench3 best published score (the bar to beat)
