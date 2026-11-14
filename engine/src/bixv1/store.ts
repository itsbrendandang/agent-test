// Reads the run folders the BixBench v1 adapter writes. Read-only: nothing here creates, changes or deletes a file.
//
//   <runs>/<run>/report.json, budget.json                        optional
//   <runs>/<run>/<capsule>/<solver>/run.json                     one capsule run (settings, status, tokens)
//   <runs>/<run>/<capsule>/<question>/<solver>/run.json          the same with `--unit question`
//   .../grade.json                                               verdicts per grading profile (no ideal answers)
//   .../outputs/answers.json, outputs/glhf/ledger.json           the answers and, for the swarm, each derivation
//
// The numbers are computed here from run.json and grade.json, not copied from report.json, so they cannot be
// stale and a folder without a report still lists. A file that is missing or is not JSON never throws: the run
// is returned with what could be read and an `error` saying what could not.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isSafeId } from "../http.ts"
import { wilson } from "./stats.ts"
import type { BixAnswer, BixGrader, BixQuestion, BixResult, BixRun, BixSolverSummary } from "./types.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

/** Where the adapter's run folders are. BIXV1_RUNS_DIR replaces it (tests use a fixture folder). Read at each call. */
export const runsRoot = (env: NodeJS.ProcessEnv = process.env) =>
  env.BIXV1_RUNS_DIR ? resolve(env.BIXV1_RUNS_DIR) : resolve(ROOT, "glhf/bixbench_v1/runs")

/** The dataset's question file, the only place ideal answers are. BIXV1_QUESTIONS_FILE replaces it. */
export const questionsFile = (env: NodeJS.ProcessEnv = process.env) =>
  env.BIXV1_QUESTIONS_FILE ? resolve(env.BIXV1_QUESTIONS_FILE) : resolve(ROOT, "glhf/data/bixbench_v1/hub/BixBench.jsonl")

/** A run id is one path segment of letters, digits, "_", "." and "-" (http.ts). Anything else could leave the runs folder. */
export const safeId = isSafeId

type Json = Record<string, unknown>
const MAX_FILE_BYTES = 32 << 20 // a ledger or report far larger than any real one is not parsed

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)
const obj = (v: unknown): Json => (isObject(v) ? v : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const ms = (v: unknown): number | null => { const n = num(v); return n === null ? null : Math.round(n * 1000) }
const uniq = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => v !== null && v !== ""))].sort()

/** "missing", "invalid" or the parsed object. Never throws. */
function readObject(file: string): Json | "missing" | "invalid" {
  try {
    if (!existsSync(file)) return "missing"
    if (statSync(file).size > MAX_FILE_BYTES) return "invalid"
    const value: unknown = JSON.parse(readFileSync(file, "utf8"))
    return isObject(value) ? value : "invalid"
  } catch { return "invalid" }
}

/** One capsule run with one solver, as far as pairing and totals need it. */
export interface CapsuleRun {
  dir: string
  capsule: string
  solver: string
  model: string | null
  roleModels: Record<string, string>
  answerMode: string | null
  questionIds: string[]
  status: string
  maxTokens: number | null
  timeLimit: number | null
  seed: number | null
  criticHints: string | null
  benchmark: string | null
  revision: string | null
  judgeModel: string | null
  profiles: string[]
  startedAt: number | null
  finishedAt: number | null
  seconds: number | null
  tokens: number | null
  costUsd: number | null
  /** Result per question under the chosen grading profile. */
  results: Record<string, BixResult>
}

export interface Loaded {
  run: BixRun
  questions: BixQuestion[]
  capsuleRuns: CapsuleRun[]
  /** report.json's `paired` block and profile, for the scoreboard to pass the capsule bootstrap on. */
  reportPaired: Json | null
  reportProfile: string | null
}

/** Folders that hold run.json, at most three levels below the run folder. Symlinks are not followed. */
function capsuleRunDirs(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string, rel: string, depth: number) => {
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (rel && entries.some((e) => e.isFile() && e.name === "run.json")) { found.push(rel); return }
    if (depth >= 3) return
    for (const e of entries) {
      if (e.isDirectory() && isSafeId(e.name)) walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1)
    }
  }
  walk(root, "", 0)
  return found.sort()
}

function grader(method: string | null, graded: boolean, judgeModel: string | null): BixGrader {
  const judge = judgeModel ? { model: judgeModel } : {}
  if (method === null) return { kind: "none", method: null }
  if (!graded || method === "judge_error") return { kind: "none", method, ...judge }
  if (method === "range") return { kind: "range", method }
  if (method === "empty") return { kind: "rule", method }
  if (method.startsWith("llm")) return { kind: "model", method, ...judge }
  return { kind: "exact_match", method } // exact, numeric, partial, letter
}

const resultOf = (grade: Json | undefined): BixResult => {
  if (!grade || grade.graded === false || grade.method === "judge_error") return "not_graded"
  if (grade.correct === true) return "correct"
  return grade.refused === true ? "refused" : "incorrect"
}

/** The same sum as report.py's cost_usd. null without prices or usage. */
function costUsd(usage: unknown, prices: Json | null): number | null {
  const kinds = [["input_tokens", "input"], ["output_tokens", "output"], ["cache_read_tokens", "cache_read"], ["cache_write_tokens", "cache_write"]]
  if (!prices || !isObject(usage) || kinds.some(([, p]) => num(prices[p]) === null)) return null
  let total = 0
  for (const u of Object.values(usage)) for (const [field, price] of kinds) total += (num(obj(u)[field]) ?? 0) * num(prices[price])!
  return total / 1e6
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

export interface LoadOptions {
  /** Grading profile to report. Default: report.json's, else "per-mode", else the first one any grade.json has. */
  profile?: string
  /** Also return judge replies and grader notes (they can quote the ideal answer). Only with ?ideal=1. */
  withJudgeText?: boolean
}

/** Read one run folder. undefined when there is no such folder (or the id is not a safe name). Never throws. */
export function loadRun(id: string, options: LoadOptions = {}, root = runsRoot()): Loaded | undefined {
  if (!isSafeId(id)) return undefined
  const dir = resolve(root, id)
  try { if (!lstatSync(dir).isDirectory()) return undefined } catch { return undefined } // a symlink is not a run folder
  const errors: string[] = []

  const report = readObject(join(dir, "report.json"))
  if (report === "invalid") errors.push("report.json is not a JSON object")
  const reportJson = isObject(report) ? report : null
  const prices = reportJson && isObject(reportJson.prices_usd_per_million_tokens) ? reportJson.prices_usd_per_million_tokens : null
  const budget = readObject(join(dir, "budget.json"))
  if (budget === "invalid") errors.push("budget.json is not a JSON object")

  // First pass: run.json and grade.json of every capsule run, to learn which profiles exist.
  const raw: { rel: string; run: Json; grade: Json | null }[] = []
  for (const rel of capsuleRunDirs(dir)) {
    const run = readObject(join(dir, rel, "run.json"))
    if (!isObject(run)) { errors.push(`${rel}/run.json is not a JSON object`); continue }
    const grade = readObject(join(dir, rel, "grade.json"))
    if (grade === "invalid") errors.push(`${rel}/grade.json is not a JSON object`)
    raw.push({ rel, run, grade: isObject(grade) ? grade : null })
  }
  if (!raw.length) errors.push("no capsule run (run.json) could be read in this folder")
  const profiles = uniq(raw.flatMap((r) => Object.keys(obj(r.grade?.profiles))))
  const profile = options.profile ?? [str(reportJson?.profile), "per-mode"].find((p) => p && profiles.includes(p)) ?? profiles[0] ?? null

  const capsuleRuns: CapsuleRun[] = []
  const questions = new Map<string, BixQuestion>()
  for (const { rel, run, grade } of raw) {
    const settings = obj(run.settings)
    const solver = str(settings.solver) ?? rel.split("/").at(-1)!
    const capsule = str(run.capsule) ?? rel.split("/")[0]
    const questionIds = list(run.question_ids).filter((q): q is string => typeof q === "string")
    const status = str(run.status) ?? "unknown"
    const judgeModel = str(grade?.judge_model)
    const grades = new Map<string, Json>()
    if (profile) for (const g of list(obj(obj(grade?.profiles)[profile]).grades)) if (isObject(g) && typeof g.question_id === "string") grades.set(g.question_id, g)

    const answersFile = readObject(join(dir, rel, "outputs", "answers.json"))
    if (answersFile === "invalid") errors.push(`${rel}/outputs/answers.json is not a JSON object`)
    const answers = obj(obj(answersFile).answers)
    const ledgerFile = readObject(join(dir, rel, "outputs", "glhf", "ledger.json"))
    if (ledgerFile === "invalid") errors.push(`${rel}/outputs/glhf/ledger.json is not a JSON object`)
    const ledger = obj(ledgerFile)
    const derivations = list(ledger.derivations).filter(isObject)
    const texts = obj(ledger.questions)
    /** The standing (not replaced) derivation of a role for a question, as answers.py's `current`. */
    const standing = (question: string, by: string) =>
      str(derivations.findLast((d) => d.question_id === question && d.by === by && (d.superseded_by ?? null) === null)?.answer)

    const cr: CapsuleRun = {
      dir: rel, capsule, solver, model: str(settings.model), answerMode: str(settings.answer_mode), questionIds, status,
      roleModels: Object.fromEntries(Object.entries(obj(settings.role_models)).filter((e): e is [string, string] => typeof e[1] === "string")),
      maxTokens: num(settings.max_tokens), timeLimit: num(settings.time_limit_seconds), seed: num(settings.seed), criticHints: str(settings.critic_hints),
      benchmark: str(run.benchmark), revision: str(run.dataset_revision), judgeModel, profiles: Object.keys(obj(grade?.profiles)),
      startedAt: ms(run.started_at), finishedAt: ms(run.finished_at), seconds: num(run.seconds), tokens: num(run.total_tokens),
      costUsd: costUsd(run.usage, prices), results: {},
    }
    capsuleRuns.push(cr)

    for (const questionId of questionIds) {
      const grade = grades.get(questionId)
      const result = status === "running" ? "not_graded" : resultOf(grade)
      cr.results[questionId] = result
      const recorded = obj(answers[questionId])
      const answer: BixAnswer = {
        solver,
        answer: str(recorded.answer) ?? str(grade?.predicted) ?? null,
        result,
        grader: grader(str(grade?.method), grade?.graded !== false, judgeModel),
        status: str(recorded.status) ?? str(obj(run.answer_statuses)[questionId]) ?? "missing",
        runDir: rel, runTokens: cr.tokens, runSeconds: cr.seconds, runQuestions: questionIds.length,
      }
      if (answer.answer === "") answer.answer = null
      const analyst = standing(questionId, "analyst"), critic = standing(questionId, "critic")
      if (analyst !== null) answer.analystAnswer = analyst
      if (critic !== null) answer.criticAnswer = critic
      if (analyst !== null || critic !== null) {
        const comparison = str(list(ledger.final).filter(isObject).find((f) => f.question_id === questionId)?.comparison)
        answer.comparison = comparison
        answer.agreed = comparison === null ? null : comparison === "agree"
      }
      const resolution = list(ledger.resolutions).filter(isObject).find((r) => r.question_id === questionId)
      if (resolution) {
        if (str(resolution.final_answer) !== null) answer.reconcilerAnswer = str(resolution.final_answer)!
        if (str(resolution.keep) !== null) answer.reconcilerKeep = str(resolution.keep)!
        if (str(resolution.cause) !== null) answer.reconcilerCause = str(resolution.cause)!
      }
      if (options.withJudgeText) {
        if (str(grade?.judge_response)) answer.judgeResponse = str(grade?.judge_response)!
        if (str(grade?.note)) answer.graderNote = str(grade?.note)!
      }
      let row = questions.get(questionId)
      if (!row) questions.set(questionId, (row = { questionId, capsuleId: capsule, question: null, evalMode: null, answerMode: cr.answerMode, answers: {} }))
      row.question ??= str(texts[questionId])
      row.evalMode ??= str(grade?.eval_mode)
      row.answers[solver] = answer
    }
  }

  const bySolver: BixSolverSummary[] = uniq(capsuleRuns.map((r) => r.solver)).map((solver) => {
    const mine = capsuleRuns.filter((r) => r.solver === solver)
    const settled = mine.filter((r) => r.status !== "running")
    const results = settled.flatMap((r) => Object.values(r.results))
    const count = (what: BixResult) => results.filter((r) => r === what).length
    const statuses: Record<string, number> = {}
    for (const q of questions.values()) { const a = q.answers[solver]; if (a) statuses[a.status] = (statuses[a.status] ?? 0) + 1 }
    const interval = wilson(count("correct"), results.length)
    const budgets = mine.map((r) => r.maxTokens), costs = mine.map((r) => r.costUsd)
    const allBudgets = budgets.every((b): b is number => b !== null) && budgets.length > 0
    return {
      solver,
      models: uniq(mine.map((r) => r.model)),
      roleModels: Object.assign({}, ...mine.map((r) => r.roleModels)) as Record<string, string>,
      questions: mine.reduce((n, r) => n + r.questionIds.length, 0),
      correct: count("correct"), incorrect: count("incorrect"), refused: count("refused"), notGraded: count("not_graded"),
      pending: mine.filter((r) => r.status === "running").reduce((n, r) => n + r.questionIds.length, 0),
      accuracy: results.length ? count("correct") / results.length : null,
      denominator: results.length,
      wilson95: interval ? [round(interval[0], 4), round(interval[1], 4)] : null,
      unsure: statuses.disputed ?? 0,
      statuses,
      tokens: mine.reduce((n, r) => n + (r.tokens ?? 0), 0),
      seconds: round(mine.reduce((n, r) => n + (r.seconds ?? 0), 0), 1),
      costUsd: costs.length && costs.every((c): c is number => c !== null) ? round(costs.reduce((a, b) => a + b, 0), 2) : null,
      capsuleRuns: {
        done: mine.filter((r) => r.status === "done").length,
        failed: mine.filter((r) => r.status !== "done" && r.status !== "running").length,
        running: mine.filter((r) => r.status === "running").length,
      },
      maxTokens: allBudgets && new Set(budgets).size === 1 ? budgets[0] : null,
      maxTokensTotal: allBudgets ? (budgets as number[]).reduce((a, b) => a + b, 0) : null,
    }
  })

  const models = uniq(capsuleRuns.map((r) => r.model))
  const started = capsuleRuns.map((r) => r.startedAt).filter((t): t is number => t !== null)
  const finished = capsuleRuns.map((r) => r.finishedAt).filter((t): t is number => t !== null)
  const running = capsuleRuns.some((r) => r.status === "running")
  const judgeTokens = isObject(budget) ? list(budget.runs).reduce<number | null>((n, r) => (num(obj(r).judge_tokens) === null ? n : (n ?? 0) + num(obj(r).judge_tokens)!), null) : null
  let folderTime: number | null = null
  try { folderTime = Math.round(statSync(dir).mtimeMs) } catch { /* listed without a time */ }
  const run: BixRun = {
    id,
    dataset: uniq(capsuleRuns.map((r) => r.benchmark))[0] ?? null,
    datasetRevision: uniq(capsuleRuns.map((r) => r.revision)).join(", ") || null,
    model: models.join(", ") || null,
    models,
    solvers: bySolver.map((s) => s.solver),
    gradingProfile: profile,
    gradingProfiles: profiles,
    judgeModels: uniq(capsuleRuns.map((r) => r.judgeModel)),
    answerModes: uniq(capsuleRuns.map((r) => r.answerMode)),
    state: !capsuleRuns.length ? "empty" : running ? "running" : "done",
    startedAt: started.length ? Math.min(...started) : folderTime,
    finishedAt: !running && finished.length ? Math.max(...finished) : null,
    capsules: uniq(capsuleRuns.map((r) => r.capsule)),
    questions: questions.size,
    bySolver,
    tokens: bySolver.reduce((n, s) => n + s.tokens, 0),
    judgeTokens,
    costUsd: bySolver.length && bySolver.every((s) => s.costUsd !== null) ? round(bySolver.reduce((n, s) => n + s.costUsd!, 0), 2) : null,
    scripted: models.includes("mock") || reportJson?.scripted_model === true,
  }
  if (errors.length) run.error = errors.join("; ")
  return { run, questions: [...questions.values()], capsuleRuns, reportPaired: isObject(reportJson?.paired) ? reportJson.paired : null, reportProfile: str(reportJson?.profile) }
}

/** Every run folder, newest first. A folder that cannot be read is listed with an `error`. Never throws. */
export function loadAll(options: LoadOptions = {}, root = runsRoot()): Loaded[] {
  let names: string[]
  try { names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && isSafeId(e.name)).map((e) => e.name) } catch { return [] }
  return names
    .map((id) => {
      try { return loadRun(id, options, root) } catch (error) {
        // loadRun reads defensively; this is the backstop that keeps one bad folder from hiding the others.
        const run: BixRun = {
          id, dataset: null, datasetRevision: null, model: null, models: [], solvers: [], gradingProfile: null, gradingProfiles: [], judgeModels: [],
          answerModes: [], state: "empty", startedAt: null, finishedAt: null, capsules: [], questions: 0, bySolver: [], tokens: 0, judgeTokens: null,
          costUsd: null, scripted: false, error: `could not be read: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`,
        }
        return { run, questions: [], capsuleRuns: [], reportPaired: null, reportProfile: null } satisfies Loaded
      }
    })
    .filter((l): l is Loaded => l !== undefined)
    .sort((a, b) => (b.run.startedAt ?? 0) - (a.run.startedAt ?? 0) || b.run.id.localeCompare(a.run.id))
}

export const listRuns = (options: LoadOptions = {}, root = runsRoot()): BixRun[] => loadAll(options, root).map((l) => l.run)

/**
 * Ideal answers by question id, from the dataset's question file. null when the file is not there or cannot be
 * read. Call only for the ?ideal=1 path of routes.ts; nothing else in the engine may read this file.
 */
export function readIdeals(file = questionsFile()): Map<string, string> | null {
  let text: string
  try {
    if (!existsSync(file) || statSync(file).size > MAX_FILE_BYTES) return null
    text = readFileSync(file, "utf8")
  } catch { return null }
  const out = new Map<string, string>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const row: unknown = JSON.parse(line)
      if (isObject(row) && typeof row.question_id === "string" && row.ideal !== undefined && row.ideal !== null) out.set(row.question_id, String(row.ideal))
    } catch { /* a bad line hides one answer, not the rest */ }
  }
  return out
}
