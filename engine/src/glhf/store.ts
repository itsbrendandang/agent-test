// Run records on disk. The durable task is the source of truth for what happens next; record.json is its
// projection for the CLI, the server and the dashboard, rewritten (atomically) at every transition.
import { appendFileSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve, sep } from "node:path"
import { ROOT } from "../config.ts"
import type { GlhfRun, RunRequest, RunSettings } from "./types.ts"

export const GLHF = resolve(ROOT, "glhf")
/**
 * The folder the benchmark commands are started in. GLHF_BIXBENCH_DIR replaces it; it is read at each use, so a test
 * can point it at a folder that does not exist and see what a failed spawn leaves behind.
 */
export const bixbenchDir = () => (process.env.GLHF_BIXBENCH_DIR ? resolve(process.env.GLHF_BIXBENCH_DIR) : resolve(GLHF, "bixbench"))
export const BIXBENCH = bixbenchDir()
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
  // Another machine and image for the analyses: a run on Modal is not compared with one on this machine.
  if (request.analysisBackend === "modal") out.analysisBackend = "modal"
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

/** The most that is read of one file. GLHF_MAX_READ_BYTES replaces it. Larger files count as unreadable; `tail` reads their end. */
export const maxRead = () => Number(process.env.GLHF_MAX_READ_BYTES ?? 32 << 20)

/**
 * Open a file for reading, or undefined when it must not be read. A run folder holds files the sandbox writes
 * (outputs/ and workspace/ are mounted into it), and what the engine reads there is sent on by GET
 * /api/glhf/runs/:id. A symlink left in outputs/ would make that route return any file of this machine, .env
 * included. So, for every file the engine reads:
 *   - it must be a regular file: not a symlink (lstat, and O_NOFOLLOW on the open), a folder, a pipe or a device
 *   - under glhf/runs, its real path must stay inside its run folder, which also refuses a symlinked folder on the
 *     way (outputs/glhf -> somewhere else)
 * The size is taken from the open file, so it is the size of what is read.
 */
function openSafe(file: string): { fd: number; size: number } | undefined {
  let fd: number | undefined
  try {
    if (!lstatSync(file).isFile()) return undefined
    const path = resolve(file)
    if (path.startsWith(RUNS + sep)) {
      const inside = path.slice(RUNS.length + 1).split(sep)
      const root = realpathSync(inside.length > 1 ? resolve(RUNS, inside[0]) : RUNS)
      if (!realpathSync(path).startsWith(root + sep)) return undefined
    }
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile()) { closeSync(fd); return undefined }
    return { fd, size: stat.size }
  } catch {
    if (fd !== undefined) try { closeSync(fd) } catch { /* already closed */ }
    return undefined
  }
}

/** `length` bytes of an open file from `from`, as text. Closes the file. */
function slurp(fd: number, from: number, length: number): string | null {
  try {
    const buffer = Buffer.alloc(length)
    let got = 0
    for (let n: number; got < length && (n = readSync(fd, buffer, got, length - got, from + got)) > 0;) got += n
    return buffer.toString("utf8", 0, got)
  } catch { return null } finally { closeSync(fd) }
}

/**
 * The text of a file, or null when there is none that may be read: it is missing, not a regular file, leaves its
 * run folder (openSafe), or is larger than maxRead(). The one way the engine reads a file of a run.
 */
export function readText(file: string): string | null {
  const open = openSafe(file)
  if (!open) return null
  if (open.size > maxRead()) { closeSync(open.fd); return null }
  return slurp(open.fd, 0, open.size)
}

export function readJson<T>(file: string): T | undefined {
  const text = readText(file)
  if (text === null) return undefined
  try { return JSON.parse(text) as T } catch { return undefined }
}

/** A record that has the shape the tracker works with; anything else counts as unreadable. */
export function loadStored(id: string): Stored | undefined {
  if (!safeId(id)) return undefined
  const stored = readJson<Stored>(`${runDir(id)}/record.json`)
  const run = stored?.run as Partial<GlhfRun> | undefined
  return stored && typeof stored === "object" && run && typeof run === "object" && typeof run.id === "string" && typeof run.phase === "string" && typeof run.startedAt === "number" ? stored : undefined
}

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

/** Last lines of a log, for error messages. Of a long log only the last 64 KB are read. */
export function tail(file: string, lines = 12): string {
  const open = openSafe(file)
  if (!open) return ""
  const length = Math.min(open.size, 64 << 10)
  const text = slurp(open.fd, open.size - length, length)
  return text ? text.trim().split("\n").slice(-lines).join("\n") : ""
}

/**
 * Where the files a run's solver leaves are read from, relative to the run folder. The one place these paths are
 * named: change `ledger` here when the swarm writes its trusted ledger somewhere else.
 * Today all three are inside outputs/, which the sandbox can write, so they are untrusted text: they are read
 * through readText (never through a symlink, never out of the run folder, never more than maxRead()).
 */
export const RUN_FILES = { ledger: "outputs/glhf/ledger.json", findings: "outputs/glhf/FINDINGS.md", methods: "outputs/METHODS.md" } as const
export const runFile = (id: string, name: keyof typeof RUN_FILES) => resolve(runDir(id), RUN_FILES[name])

export interface Detail { run: GlhfRun; ledger: unknown | null; findings: string | null; methods: string | null }

export function runDetail(id: string): Detail | undefined {
  const stored = loadStored(id)
  if (!stored) return undefined
  return {
    run: publicRun(stored),
    ledger: readJson<unknown>(runFile(id, "ledger")) ?? null,
    findings: readText(runFile(id, "findings")),
    methods: readText(runFile(id, "methods")),
  }
}
