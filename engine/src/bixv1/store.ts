// Reads the run folders the BixBench v1 adapter writes. Read-only: nothing here creates, changes or deletes a file.
//
//   <runs>/<run>/report.json, budget.json                        optional
//   <runs>/<run>/<capsule>/<solver>/run.json                     one capsule run (settings, status, tokens)
//   <runs>/<run>/<capsule>/<question>/<solver>/run.json          the same with `--unit question`
//   .../grade.json                                               verdicts per grading profile (no ideal answers)
//   .../outputs/answers.json, outputs/glhf/ledger.json           the answers and, for the swarm, each derivation
//   .../outputs/glhf/questions.json                              the swarm's record per question (also `questions` in run.json)
//
// The numbers are computed here from run.json and grade.json, not copied from report.json, so they cannot be
// stale and a folder without a report still lists. A file that is missing or is not JSON never throws: the run
// is returned with what could be read and an `error` saying what could not.
//
// BUDGET. `settings.max_tokens` is what the single agent gets. What a swarm may really spend is
// `settings.total_budget_tokens`: the same in budget mode "equal", 2.25 times as much in "extended". A swarm
// run.json without these fields was written before budget modes existed and is counted as "legacy": the pilot's
// allocation (analyst and critic 42% each, 16% for the reconciler) inside max_tokens, so its total is max_tokens.
//
// STALLED. A capsule run that crashed says "running" for ever. One whose folder nothing has written to for
// longer than its time limit plus a margin (STALL_MARGIN_SECONDS) is reported as "stalled" instead.
//
// CACHE. A loaded run is kept in memory and reused while the modification times and sizes of its folders and
// files are unchanged (see `signature`), so the dashboard's polling costs a few stat calls per capsule run and
// no parsing. The objects returned are shared with the cache: callers must not change them.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isSafeId } from "../http.ts"
import { wilson } from "./stats.ts"
import type { BixAnswer, BixBudgetMode, BixDesign, BixGrader, BixQuestion, BixResult, BixRun, BixSolverSummary } from "./types.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

/** Where the adapter's run folders are. BIXV1_RUNS_DIR replaces it (tests use a fixture folder). Read at each call. */
export const runsRoot = (env: NodeJS.ProcessEnv = process.env) =>
  env.BIXV1_RUNS_DIR ? resolve(env.BIXV1_RUNS_DIR) : resolve(ROOT, "glhf/bixbench_v1/runs")

/** The dataset's question file, the only place ideal answers are. BIXV1_QUESTIONS_FILE replaces it. */
export const questionsFile = (env: NodeJS.ProcessEnv = process.env) =>
  env.BIXV1_QUESTIONS_FILE ? resolve(env.BIXV1_QUESTIONS_FILE) : resolve(ROOT, "glhf/data/bixbench_v1/hub/BixBench.jsonl")

/** A run id is one path segment of letters, digits, "_", "." and "-" (http.ts). Anything else could leave the runs folder. */
export const safeId = isSafeId

/** The swarm's solver name in run.json; everything else is treated as a single agent. */
export const SINGLE = "single", SWARM = "glhf"
/** Extra quiet time beyond a run's time limit before "running" is read as "stalled". BIXV1_STALL_MARGIN_SECONDS replaces it. */
export const STALL_MARGIN_SECONDS = 600
const DEFAULT_TIME_LIMIT_SECONDS = 1800 // the adapter's default, for a run.json without one
const stallMargin = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.BIXV1_STALL_MARGIN_SECONDS)
  return env.BIXV1_STALL_MARGIN_SECONDS && Number.isFinite(n) && n >= 0 ? n : STALL_MARGIN_SECONDS
}

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
  /** run.json's status, except "stalled" for a "running" one that has been silent too long. */
  status: string
  /** settings.max_tokens: the single agent's budget for this capsule run, whichever solver ran. */
  maxTokens: number | null
  /** What this solver could spend in all. Single agent: maxTokens. Swarm: its total under its budget mode. */
  effectiveTokens: number | null
  /** null for the single agent. */
  budgetMode: BixBudgetMode | null
  /** The adapter's own word: "same budget" or "more budget". null when not recorded. */
  budgetReading: string | null
  /** Tokens per swarm phase (analyst, critic, reconciler). Empty when not recorded. */
  tokensByPhase: Record<string, number>
  /** When anything in the capsule run's folder was last written (ms). */
  lastActivity: number | null
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

const mtime = (path: string): number | null => { try { return statSync(path).mtimeMs } catch { return null } }

/** The newest modification time of a capsule run's folder, its files and what is one and two levels below. */
function lastActivity(dir: string): number | null {
  let newest = mtime(dir)
  const visit = (at: string, depth: number) => {
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(at, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const t = mtime(join(at, e.name))
      if (t !== null && (newest === null || t > newest)) newest = t
      if (depth < 2 && e.isDirectory()) visit(join(at, e.name), depth + 1)
    }
  }
  visit(dir, 1)
  return newest
}

const normalise = (text: string) => text.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() // text.py's normalise

/** Counts for judging the swarm's design. See BixDesign in types.ts for what each one means. */
function design(answers: BixAnswer[]): BixDesign {
  const out: BixDesign = {
    questions: answers.length, compared: 0, agreed: 0, agreedCorrect: 0, agreedWrong: 0, agreedNotGraded: 0, agreedSameMethod: 0,
    agreedSameMethodCorrect: 0, agreedSameMethodWrong: 0, sameMethodKnown: 0, disagreed: 0, oneDerivation: 0, forced: 0,
    reconcilerRan: 0, reconcilerChanged: 0, reconcilerChangedToCorrect: 0, reconcilerChangedToWrong: 0,
  }
  for (const a of answers) {
    const right = a.result === "correct", ungraded = a.result === "not_graded", changed = a.reconcilerChanged === true
    if (a.forced) out.forced++
    if (a.reconcilerAnswer !== undefined) out.reconcilerRan++
    if (changed) {
      out.reconcilerChanged++
      if (right) out.reconcilerChangedToCorrect++
      else if (!ungraded) out.reconcilerChangedToWrong++
    }
    if (a.agreed === undefined || a.agreed === null) { out.oneDerivation++; continue }
    out.compared++
    if (!a.agreed) { out.disagreed++; continue }
    out.agreed++
    if (a.sameMethod !== undefined && a.sameMethod !== null) out.sameMethodKnown++
    if (a.sameMethod === true) out.agreedSameMethod++
    // The graded answer is the agreed one only when the reconciler did not replace it.
    if (changed) continue
    if (ungraded) { out.agreedNotGraded++; continue }
    if (right) out.agreedCorrect++; else out.agreedWrong++
    if (a.sameMethod === true) { if (right) out.agreedSameMethodCorrect++; else out.agreedSameMethodWrong++ }
  }
  return out
}

export interface LoadOptions {
  /** Grading profile to report. Default: report.json's, else "per-mode", else the first one any grade.json has. */
  profile?: string
  /** Also return judge replies and grader notes (they can quote the ideal answer). Only with ?ideal=1. */
  withJudgeText?: boolean
  /** The time "stalled" is judged against (ms). Default: now. A load with `now` set does not use the cache. */
  now?: number
}

// The cache ------------------------------------------------------------------------------------------------
const WATCHED = ["run.json", "grade.json", "outputs/answers.json", "outputs/glhf/ledger.json", "outputs/glhf/questions.json"]
const stamp = (path: string) => { try { const s = statSync(path); return `${s.mtimeMs}:${s.size}` } catch { return "-" } }

/** Everything a loaded run depends on, as one string: the folders (a new or removed capsule run changes one) and the files read. */
export function signature(dir: string): string {
  const parts = [stamp(dir), stamp(join(dir, "report.json")), stamp(join(dir, "budget.json"))]
  for (const rel of capsuleRunDirs(dir)) {
    parts.push(rel, stamp(join(dir, rel)), stamp(join(dir, rel, "outputs")), stamp(join(dir, rel, "outputs", "glhf")))
    for (const file of WATCHED) parts.push(stamp(join(dir, rel, file)))
    for (let up = dirname(rel); up !== "."; up = dirname(up)) parts.push(stamp(join(dir, up))) // capsule (and question) folders
  }
  return parts.join("|")
}

interface Entry {
  signature: string
  loaded: Loaded
  /** Capsule runs that said "running" when loaded, with their last activity then: a change means look again. */
  watching: { dir: string; activity: number | null }[]
  /** When the first of them would turn "stalled" if nothing more is written (ms). Infinity when none is running. */
  staleAt: number
}
const cache = new Map<string, Entry>()
const MAX_ENTRIES = 300
const counts = { hits: 0, misses: 0 }
/** How often a run was served from memory and how often it was read from disk, since the last clearCache. */
export const cacheStats = () => ({ ...counts, entries: cache.size })
export function clearCache() { cache.clear(); counts.hits = 0; counts.misses = 0 }

/** Read one run folder. undefined when there is no such folder (or the id is not a safe name). Never throws. */
export function loadRun(id: string, options: LoadOptions = {}, root = runsRoot()): Loaded | undefined {
  if (!isSafeId(id)) return undefined
  const dir = resolve(root, id)
  try { if (!lstatSync(dir).isDirectory()) return undefined } catch { return undefined } // a symlink is not a run folder
  if (options.now !== undefined) return readRun(id, dir, options, options.now).loaded
  const key = [dir, options.profile ?? "", options.withJudgeText ? 1 : 0].join("\0")
  const now = Date.now(), sig = signature(dir), hit = cache.get(key)
  if (hit && hit.signature === sig && now < hit.staleAt && hit.watching.every((w) => lastActivity(w.dir) === w.activity)) { counts.hits++; return hit.loaded }
  counts.misses++
  const fresh = readRun(id, dir, options, now)
  cache.delete(key) // re-inserted at the end: the Map's order is the order of last load
  cache.set(key, { signature: sig, ...fresh })
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  return fresh.loaded
}

/** Read a run folder from disk, with no cache. */
function readRun(id: string, dir: string, options: LoadOptions, now: number): Omit<Entry, "signature"> {
  const errors: string[] = []
  const watching: Entry["watching"] = []
  let staleAt = Infinity

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
    let status = str(run.status) ?? "unknown"
    const activity = status === "running" ? lastActivity(join(dir, rel)) : null
    if (status === "running") {
      const quietUntil = (activity ?? ms(run.started_at) ?? 0) + ((num(settings.time_limit_seconds) ?? DEFAULT_TIME_LIMIT_SECONDS) + stallMargin()) * 1000
      if (now >= quietUntil) status = "stalled"
      else staleAt = Math.min(staleAt, quietUntil)
      watching.push({ dir: join(dir, rel), activity })
    }
    // Budget: what the single agent gets (max_tokens) and what this solver could really spend.
    const swarm = solver === SWARM, plan = obj(settings.swarm_budget), spent = obj(run.budget)
    const maxTokens = num(settings.max_tokens)
    const recorded = isObject(settings.swarm_budget) || settings.total_budget_tokens !== undefined
    const budgetMode: BixBudgetMode | null = !swarm ? null : !recorded ? "legacy" : plan.mode === "extended" ? "extended" : plan.mode === "equal" ? "equal" : "unknown"
    const effectiveTokens = !swarm || budgetMode === "legacy" ? maxTokens : num(settings.total_budget_tokens) ?? num(plan.swarm_total_tokens) ?? num(spent.total_budget_tokens) ?? maxTokens
    const tokensByPhase = Object.fromEntries(Object.entries(obj(spent.tokens_by_phase)).filter((e): e is [string, number] => num(e[1]) !== null))
    // The swarm's record per question: run.json repeats outputs/glhf/questions.json; either will do.
    const recordsFile = swarm && !Array.isArray(run.questions) ? readObject(join(dir, rel, "outputs", "glhf", "questions.json")) : "missing"
    if (recordsFile === "invalid") errors.push(`${rel}/outputs/glhf/questions.json is not a JSON object`)
    const records = new Map<string, Json>()
    for (const r of list(Array.isArray(run.questions) ? run.questions : obj(recordsFile).questions)) if (isObject(r) && typeof r.question_id === "string") records.set(r.question_id, r)
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
      maxTokens, effectiveTokens, budgetMode, budgetReading: str(settings.budget_reading) ?? str(plan.reading) ?? str(spent.reading), tokensByPhase,
      lastActivity: activity, timeLimit: num(settings.time_limit_seconds), seed: num(settings.seed), criticHints: str(settings.critic_hints),
      benchmark: str(run.benchmark), revision: str(run.dataset_revision), judgeModel, profiles: Object.keys(obj(grade?.profiles)),
      startedAt: ms(run.started_at), finishedAt: ms(run.finished_at), seconds: num(run.seconds), tokens: num(run.total_tokens),
      costUsd: costUsd(run.usage, prices), results: {},
    }
    capsuleRuns.push(cr)

    for (const questionId of questionIds) {
      const grade = grades.get(questionId)
      const result = status === "running" || status === "stalled" ? "not_graded" : resultOf(grade)
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
      // The swarm's derivations: the per-question record when the run has one, else the ledger (older runs).
      const record = records.get(questionId)
      const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null)
      const analyst = record ? str(record.analyst_answer) : standing(questionId, "analyst")
      const critic = record ? str(record.critic_answer) : standing(questionId, "critic")
      if (analyst !== null) answer.analystAnswer = analyst
      if (critic !== null) answer.criticAnswer = critic
      const resolution = list(ledger.resolutions).filter(isObject).find((r) => r.question_id === questionId)
      if (record || analyst !== null || critic !== null) {
        const comparison = record ? str(record.comparison) : str(list(ledger.final).filter(isObject).find((f) => f.question_id === questionId)?.comparison)
        answer.comparison = comparison
        answer.agreed = (record ? bool(record.agreed) : null) ?? (comparison === null ? null : comparison === "agree")
        // Not recorded before the per-question record existed: null means "unknown", not "different methods".
        answer.sameMethod = record ? bool(record.same_method) : null
        answer.analystForced = record?.analyst_forced === true
        answer.criticForced = record?.critic_forced === true
        answer.forced = answer.analystForced || answer.criticForced
        const reconciler = record ? str(record.reconciler_answer) : str(resolution?.final_answer)
        if (reconciler !== null) answer.reconcilerAnswer = reconciler
        const before = analyst ?? critic // what would have been reported with no reconciler
        answer.reconcilerChanged = bool(record?.reconciler_changed) ?? (reconciler !== null && before !== null && normalise(reconciler) !== normalise(before))
        answer.runPhaseTokens = tokensByPhase
      }
      if (record) {
        for (const [field, key] of [["analystMethod", "analyst_method"], ["criticMethod", "critic_method"], ["reconcilerAction", "reconciler_action"], ["reconcilerCause", "reconciler_cause"]] as const) {
          const text = str(record[key])
          if (text) answer[field] = text
        }
        if (bool(record.same_method_by_code) !== null) answer.sameMethodByCode = bool(record.same_method_by_code)!
        if (bool(record.same_method_by_reconciler) !== null) answer.sameMethodByReconciler = bool(record.same_method_by_reconciler)!
        if (num(record.method_similarity) !== null) answer.methodSimilarity = num(record.method_similarity)!
      }
      if (resolution) {
        if (str(resolution.keep) !== null) answer.reconcilerKeep = str(resolution.keep)!
        if (answer.reconcilerCause === undefined && str(resolution.cause) !== null) answer.reconcilerCause = str(resolution.cause)!
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
    const settled = mine.filter((r) => r.status !== "running" && r.status !== "stalled")
    const questionsOf = (status: string) => mine.filter((r) => r.status === status).reduce((n, r) => n + r.questionIds.length, 0)
    const modes = [...new Set(mine.map((r) => r.budgetMode))]
    const mode: BixBudgetMode | null = modes.length === 1 ? modes[0] : "mixed"
    const sum = (values: (number | null)[]) => (values.length && values.every((v): v is number => v !== null) ? (values as number[]).reduce((a, b) => a + b, 0) : null)
    const singleTotal = sum(mine.map((r) => r.maxTokens)), total = sum(mine.map((r) => r.effectiveTokens))
    const tokensByPhase: Record<string, number> = {}
    for (const r of mine) for (const [phase, n] of Object.entries(r.tokensByPhase)) tokensByPhase[phase] = (tokensByPhase[phase] ?? 0) + n
    const swarmAnswers = [...questions.values()].map((q) => q.answers[solver]).filter((a): a is BixAnswer => a !== undefined && a.agreed !== undefined)
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
      pending: questionsOf("running"),
      stalled: questionsOf("stalled"),
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
        failed: mine.filter((r) => !["done", "running", "stalled"].includes(r.status)).length,
        running: mine.filter((r) => r.status === "running").length,
        stalled: mine.filter((r) => r.status === "stalled").length,
      },
      budget: {
        mode, label: budgetLabel(mode), singleBudgetTokens: singleTotal, totalBudgetTokens: total,
        ratio: singleTotal && total !== null ? round(total / singleTotal, 3) : null,
        reading: uniq(mine.map((r) => r.budgetReading)).join(", ") || null,
      },
      tokensByPhase,
      ...(solver === SWARM && swarmAnswers.length ? { design: design(swarmAnswers) } : {}),
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
    state: !capsuleRuns.length ? "empty" : running ? "running" : capsuleRuns.some((r) => r.status === "stalled") ? "stalled" : "done",
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
  return { loaded: { run, questions: [...questions.values()], capsuleRuns, reportPaired: isObject(reportJson?.paired) ? reportJson.paired : null, reportProfile: str(reportJson?.profile) }, watching, staleAt }
}

/** A budget mode in plain words, for a label next to a swarm's numbers. */
export function budgetLabel(mode: BixBudgetMode | null): string | null {
  if (mode === null) return null
  return {
    equal: "equal: the swarm's total is the single agent's budget",
    extended: "extended: the swarm's total is larger than the single agent's budget",
    legacy: "legacy: run before budget modes were recorded; the pilot's allocation (analyst 42%, critic 42%, reconciler 16%) inside the single agent's budget",
    mixed: "mixed: the capsule runs of this folder did not all use one budget mode",
    unknown: "unknown: the run recorded a budget mode this reader does not know",
  }[mode]
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
