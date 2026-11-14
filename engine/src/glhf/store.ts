// Run records on disk. The durable task is the source of truth for what happens next; record.json is its
// projection for the CLI, the server and the dashboard, rewritten (atomically) at every transition.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { ROOT } from "../config.ts"
import type { GlhfRun, RunRequest } from "./types.ts"

export const GLHF = resolve(ROOT, "glhf")
export const BIXBENCH = resolve(GLHF, "bixbench")
/** Lessons the swarm keeps between runs. In git, so the whole team shares them. */
export const MEMORY = resolve(GLHF, "memory")
export const RUNS = resolve(GLHF, "runs")
export const DEMO_CASE = resolve(GLHF, "demo_case")
export const runDir = (id: string) => resolve(RUNS, id)

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

export const loadStored = (id: string) => readJson<Stored>(`${runDir(id)}/record.json`)

export function saveStored(stored: Stored) {
  mkdirSync(runDir(stored.run.id), { recursive: true })
  writeJson(`${runDir(stored.run.id)}/record.json`, stored)
}

/** Change the public record. Returns the new record, or undefined when the run is unknown. */
export function patchRun(id: string, patch: Partial<GlhfRun>, log?: string): GlhfRun | undefined {
  const stored = loadStored(id)
  if (!stored) return undefined
  const before = stored.run.phase
  stored.run = { ...stored.run, ...patch }
  for (const key of Object.keys(stored.run) as (keyof GlhfRun)[]) if (stored.run[key] === undefined) delete stored.run[key]
  saveStored(stored)
  if (log || before !== stored.run.phase) trackerLog(id, log ?? `${before} -> ${stored.run.phase}`)
  return stored.run
}

export function trackerLog(id: string, line: string) {
  appendFileSync(`${runDir(id)}/tracker.log`, `${new Date().toISOString()} ${line}\n`)
}

export function listStored(): Stored[] {
  if (!existsSync(RUNS)) return []
  return readdirSync(RUNS)
    .map((id) => loadStored(id))
    .filter((s): s is Stored => s !== undefined)
    .sort((a, b) => b.run.startedAt - a.run.startedAt || b.run.id.localeCompare(a.run.id))
}

export const listRuns = (): GlhfRun[] => listStored().map((s) => s.run)

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
    run: stored.run,
    ledger: readJson<unknown>(`${outputs}/glhf/ledger.json`) ?? null,
    findings: readText(`${outputs}/glhf/FINDINGS.md`),
    methods: readText(`${outputs}/METHODS.md`),
  }
}
