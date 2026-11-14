// Run records on disk. The durable task is the source of truth for what happens next; record.json is its
// projection for the CLI, the server and the dashboard, rewritten (atomically) at every transition.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { ROOT } from "../config.ts"
import type { GlhfRun, RunRequest, RunSettings } from "./types.ts"

export const GLHF = resolve(ROOT, "glhf")
export const BIXBENCH = resolve(GLHF, "bixbench")
/** Lessons the swarm keeps between runs. In git, so the whole team shares them. */
export const MEMORY = resolve(GLHF, "memory")
/** Where runs and the tracker's database live. GLHF_RUNS_DIR replaces it (tests and throwaway servers use a temporary folder). */
export const RUNS = process.env.GLHF_RUNS_DIR ? resolve(process.env.GLHF_RUNS_DIR) : resolve(GLHF, "runs")
export const DEMO_CASE = resolve(GLHF, "demo_case")

/** A run id is one path segment of letters, digits, "_", "." and "-". Anything else could leave glhf/runs. */
export const safeId = (id: unknown): id is string => typeof id === "string" && /^[\w.-]+$/.test(id) && !/^\.+$/.test(id) && !id.includes("..") && id.length <= 200
export class BadId extends Error {}
export const runDir = (id: string) => {
  if (!safeId(id)) throw new BadId(`not a run id: ${JSON.stringify(String(id).slice(0, 80))}`)
  return resolve(RUNS, id)
}

/** The comparable settings of a request (see RunSettings). */
export function settingsOf(request: Partial<RunRequest>): RunSettings {
  const out: RunSettings = {}
  if (request.timeLimit) out.timeLimit = request.timeLimit
  else if (request.mode === "local") out.timeLimit = 1800 // glhf_local's default
  if (request.maxTokens) out.maxTokens = request.maxTokens
  if (request.maxMessagesPerRole) out.maxMessagesPerRole = request.maxMessagesPerRole
  if (request.reviewRounds) out.reviewRounds = request.reviewRounds
  if (request.exa) out.exa = true
  if (request.memory) out.memory = true
  if (request.seed) out.seed = request.seed
  if (request.effort) out.effort = request.effort
  // Two different case folders under the same task label are different experiments.
  if (request.caseDir && resolve(request.caseDir) !== DEMO_CASE) out.caseId = createHash("sha1").update(resolve(request.caseDir)).digest("hex").slice(0, 8)
  return out
}

/** What is stored per run: the public record, the request it came from, and its durable task. */
export interface Stored { run: GlhfRun; request: RunRequest; taskId?: number }

export function writeJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

export function readJson<T>(file: string): T | undefined {
  try { return JSON.parse(readFileSync(file, "utf8")) as T } catch { return undefined }
}

export const readText = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : null)

export const loadStored = (id: string) => (safeId(id) ? readJson<Stored>(`${runDir(id)}/record.json`) : undefined)

export function saveStored(stored: Stored) {
  mkdirSync(runDir(stored.run.id), { recursive: true })
  writeJson(`${runDir(stored.run.id)}/record.json`, stored)
}

/**
 * Change the public record. Returns the new record, or undefined when the run is unknown. A cancelled run stays
 * cancelled: a phase that was half-way through when the cancel arrived cannot write "running" or "failed" over it.
 * The file is rewritten only when the record changed.
 */
export function patchRun(id: string, patch: Partial<GlhfRun>, log?: string): GlhfRun | undefined {
  const stored = loadStored(id)
  if (!stored) return undefined
  if (stored.run.phase === "cancelled" && patch.phase !== "cancelled") return stored.run
  const before = stored.run.phase, was = JSON.stringify(stored.run)
  stored.run = { ...stored.run, ...patch }
  for (const key of Object.keys(stored.run) as (keyof GlhfRun)[]) if (stored.run[key] === undefined) delete stored.run[key]
  if (JSON.stringify(stored.run) !== was) saveStored(stored) // a poll that found nothing new writes nothing
  if (log || before !== stored.run.phase) trackerLog(id, log ?? `${before} -> ${stored.run.phase}`)
  return stored.run
}

export function trackerLog(id: string, line: string) {
  appendFileSync(`${runDir(id)}/tracker.log`, `${new Date().toISOString()} ${line}\n`)
}

export function listStored(): Stored[] {
  if (!existsSync(RUNS)) return []
  return readdirSync(RUNS)
    .filter(safeId)
    .map((id) => loadStored(id))
    .filter((s): s is Stored => s !== undefined)
    .sort((a, b) => b.run.startedAt - a.run.startedAt || b.run.id.localeCompare(a.run.id))
}

/** The public record, with its settings filled in from the request for records that predate the field. */
export const publicRun = (s: Stored): GlhfRun => (s.run.settings ? s.run : { ...s.run, settings: settingsOf(s.request ?? {}) })
export const listRuns = (): GlhfRun[] => listStored().map(publicRun)

const pad = (n: number) => String(n).padStart(2, "0")

/** <yyyymmddHHMM>-<task>-<solver>, with -2, -3, ... when taken. */
export function newRunId(task: string, solver: string, now = new Date()): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task"
  const base = `${stamp}-${slug}-${solver}`
  let id = base
  for (let n = 2; existsSync(runDir(id)); n++) id = `${base}-${n}`
  return id
}

/** Last lines of a log, for error messages. */
export function tail(file: string, lines = 12): string {
  const text = readText(file)
  return text ? text.trim().split("\n").slice(-lines).join("\n") : ""
}

export interface Detail { run: GlhfRun; ledger: unknown | null; findings: string | null; methods: string | null }

export function runDetail(id: string): Detail | undefined {
  const stored = loadStored(id)
  if (!stored) return undefined
  const outputs = `${runDir(id)}/outputs`
  return {
    run: publicRun(stored),
    ledger: readJson<unknown>(`${outputs}/glhf/ledger.json`) ?? null,
    findings: readText(`${outputs}/glhf/FINDINGS.md`),
    methods: readText(`${outputs}/METHODS.md`),
  }
}
