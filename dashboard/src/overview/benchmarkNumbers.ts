// The Benchmarks card's numbers, apart from the component so they can be tested and reused. Pure.
type Rec = Record<string, unknown>
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

export interface Side {
  correct: number; n: number; accuracy: number; notGraded: number
  /** The 95% Wilson interval for the accuracy, as the engine computed it. */
  interval?: [number, number]
  tokens?: number
  seconds?: number
  /** The engine's estimate from token counts at assumed list prices. Meaningful only for a model sold by the token. */
  costUsd?: number
  failedRuns: number
}
export interface Row {
  model: string; questions: number; fair: boolean; single?: Side; team?: Side; conclusion: string
  datasets: number
  grading?: string
  answerMode?: string
  timeLimit?: number
  tokenBudget?: number
}
export interface Record3 { record?: number; realRuns: number; best?: number }

const sideOf = (v: unknown): Side | undefined => {
  const s = rec(v), correct = num(s?.correct), n = num(s?.n)
  if (correct === undefined || !n) return undefined
  const w = Array.isArray(s?.wilson95) && s.wilson95.length === 2 ? [num(s.wilson95[0]), num(s.wilson95[1])] : []
  return {
    correct, n, accuracy: correct / n, notGraded: num(s?.notGraded) ?? 0,
    interval: w[0] !== undefined && w[1] !== undefined ? [w[0], w[1]] : undefined,
    tokens: num(s?.tokens), seconds: num(s?.seconds), costUsd: num(s?.costUsd), failedRuns: num(s?.failedRuns) ?? 0,
  }
}
/** A model id as a short name: the part after the last slash. */
export const shortModel = (model: string) => model.split("/").filter(Boolean).at(-1) ?? model

/** The scoreboard's rows a person should see: real models only, the largest first. */
export function rowsOf(reply: unknown): Row[] {
  if (!Array.isArray(reply)) return []
  return reply.flatMap((r): Row[] => {
    const row = rec(r), model = str(row?.model)
    if (!row || !model || model === "mock") return []
    const single = sideOf(row.single), team = sideOf(row.swarm)
    if (!single && !team) return []
    return [{
      model, questions: num(row.questions) ?? 0, fair: row.likeForLike === true && !!single && !!team, single, team, conclusion: str(row.conclusion) ?? "",
      datasets: Array.isArray(row.capsules) ? row.capsules.length : 0, grading: str(row.gradingProfile), answerMode: str(row.answerMode), timeLimit: num(row.timeLimit), tokenBudget: num(row.maxTokensTotal),
    }]
  }).sort((a, b) => b.questions - a.questions)
}
/** BixBench3: the record, and our real runs on real tasks (not the demo task, not the practice model). */
export function record3Of(status: unknown, runs: unknown): Record3 {
  const real = (Array.isArray(runs) ? runs : []).flatMap((r) => {
    const run = rec(r)
    const practice = run?.modelClass === "scripted" || run?.model === "mock"
    return run && run.task !== "demo" && !practice && run.phase === "done" && num(run.score) !== undefined ? [num(run.score)!] : []
  })
  return { record: num(rec(status)?.record), realRuns: real.length, best: real.length ? Math.max(...real) : undefined }
}

/** The engine's sentence about a row, in the app's words: the team of nine and one agent, datasets for capsules. */
export const plainConclusion = (text: string): string => text
  .replace(/\bswarm minus single\b/g, "the team of nine minus one agent")
  .replace(/\bthe solvers\b/g, "the two")
  .replace(/\bThe solvers\b/g, "The two")
  .replace(/\beither solver\b/g, "either one")
  .replace(/\bcapsules\b/g, "datasets")
  .replace(/\bcapsule\b/g, "dataset")

/**
 * Is the engine's dollar figure meaningful for this model? It is tokens times assumed list prices, so only for a
 * model sold by the token. A model served on rented GPUs is paid by the second: for it the figure is not a cost.
 */
export const pricedByToken = (model: string): boolean => /^(anthropic|openai|google)\//.test(model)
