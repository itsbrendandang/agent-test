// Where a local swarm run's analyses execute: on this machine (Docker, the default) or in a Modal sandbox.
//
// Every piece of analysis code of a swarm run runs in one sandbox: the commands the roles run (bash, Python, R), the
// shape checks, and the registered falsification tests the harness runs to decide a claim's verdict. The research
// answers and the team review run no code (their checkers cannot re-run a calculation), so this is the one place.
//
//   ANALYSIS_BACKEND=local   (or unset) a Docker container on this machine, as before
//   ANALYSIS_BACKEND=modal   a Modal sandbox, made by PR #32's code in glhf/bixbench_v1 (bixbench_v1/glhf_modal.py): the
//                            checked R/conda image, no network, only the case's data files uploaded, a timeout, every
//                            sandbox terminated. The runner is started in glhf/bixbench_v1's environment with its
//                            `modal` group (modalRunner). If Modal cannot be used the run fails with the reason: it
//                            never falls back to this machine on its own.
//
// Modal bills by the second, so a Modal run is a paid call, also with the scripted model: refused while NO_PAID_CALLS
// is on, and it needs the token (tracker.ts checkRequest, routes.ts needsToken). Its cost is capped twice:
//   per run   GLHF_MODAL_MAX_USD (default $2). The runner refuses a run whose worst case (the sandbox alive until its
//             timeout, which Modal enforces) is above it, so the cap cannot be passed.
//   per day   the board's daily cap, meeting.daily_usd in board/config.yaml, which answers and team reviews already
//             share. board.ts spentToday adds glhfModalSpentToday: what Modal runs spent today, and a running one at its
//             whole cap. tracker.ts refuses a start that would pass it.
// What a run spent is read from its cost ledger, <run folder>/modal_ledger.jsonl (one line per sandbox, written by
// the runner; an estimate from Modal's prices, Modal's own bill is the authority).
//
// board.ts imports this file, so it imports nothing of the board or the tracker: store.ts, types.ts and paid.ts only.
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, resolve } from "node:path"
import { childEnv } from "../paid/paid.ts"
import { bixbenchDir, GLHF, listStored, loadStored, readText, runDir, type Stored } from "./store.ts"
import { type AnalysisBackend, type RunRequest, settled } from "./types.ts"

export const BACKENDS: readonly AnalysisBackend[] = ["local", "modal"]
/** The per-run Modal cap when GLHF_MODAL_MAX_USD is not set, in USD. */
export const DEFAULT_MODAL_MAX_USD = 2
/** What the runner writes into the run folder once it has prepared Modal (bixbench_v1/glhf_modal.py MARKER). */
export const MODAL_MARKER = "modal_run.json"
/** The run's cost ledger (bixbench_v1/modal_cost.py LEDGER_NAME). */
export const MODAL_LEDGER = "modal_ledger.jsonl"

/** A setting this file reads has a value it does not accept. Refused, never read as the default. */
export class BadSetting extends Error {}

/**
 * ANALYSIS_BACKEND: "local" when unset or empty. Any other value than "local" or "modal" is refused: a typo must not
 * quietly run the analyses somewhere else than the person asked for.
 */
export function analysisBackend(env: NodeJS.ProcessEnv = process.env): AnalysisBackend {
  const value = (env.ANALYSIS_BACKEND ?? "").trim().toLowerCase()
  if (value === "") return "local"
  if ((BACKENDS as readonly string[]).includes(value)) return value as AnalysisBackend
  throw new BadSetting(`ANALYSIS_BACKEND must be "local" (the analyses run in Docker on this machine, the default) or "modal" (in a Modal sandbox); it is ${JSON.stringify(String(env.ANALYSIS_BACKEND).slice(0, 40))}`)
}

/** GLHF_MODAL_MAX_USD: the most one Modal run may cost. A value that is not a positive number is refused, never read as "no cap". */
export function modalMaxUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.GLHF_MODAL_MAX_USD ?? "").trim()
  if (raw === "") return DEFAULT_MODAL_MAX_USD
  const usd = Number(raw)
  if (!Number.isFinite(usd) || usd <= 0) throw new BadSetting(`GLHF_MODAL_MAX_USD must be a positive number of US dollars (the most one run's Modal sandboxes may cost); it is ${JSON.stringify(raw.slice(0, 40))}`)
  return usd
}

/** For GET /api/glhf/status and the doctor: where new local runs' analyses would run, the per-run cap, or why the settings cannot be read. */
export function analysisStatus(env: NodeJS.ProcessEnv = process.env): { backend: AnalysisBackend | null; modalMaxUsd: number | null; error?: string } {
  try {
    const backend = analysisBackend(env)
    return { backend, modalMaxUsd: backend === "modal" ? modalMaxUsd(env) : null }
  } catch (error) {
    return { backend: null, modalMaxUsd: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Does this request run its analyses on Modal? */
export const onModal = (request: Pick<RunRequest, "analysisBackend"> | undefined) => request?.analysisBackend === "modal"

/** Is the run of this folder a Modal run: its request says so, or the runner prepared Modal there? */
export function modalRunDir(dir: string): boolean {
  const id = basename(dir)
  try { if (onModal(loadStored(id)?.request)) return true } catch { /* not a run id */ }
  return existsSync(`${dir}/${MODAL_MARKER}`)
}

/** Dollars in a run's cost ledger (the sum of `usd` over its lines; a line that cannot be read counts 0), and how many lines. */
export function modalSpent(dir: string): { usd: number; sandboxes: number } {
  const text = readText(`${dir}/${MODAL_LEDGER}`)
  let usd = 0, sandboxes = 0
  for (const line of (text ?? "").split("\n")) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as { usd?: unknown }
      const value = Number(row.usd)
      if (Number.isFinite(value) && value > 0) usd += value
      sandboxes++
    } catch { /* a half-written line: skipped, as the Python reader does */ }
  }
  return { usd: Math.round(usd * 1e6) / 1e6, sandboxes }
}

/**
 * Dollars Modal runs count against today's cap (local time), as tokensToday counts tokens: every run on Modal that
 * started today.
 *   running or queued:  its whole per-run cap (or what its ledger already says, when that is more)
 *   settled:            what its ledger says, or its whole cap when its runner was started and there is no ledger to
 *                       read (it may have spent it; its sandboxes end at their timeout at the latest)
 */
export function glhfModalSpentToday(now = new Date(), stored: Stored[] = listStored()): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let usd = 0
  for (const { run, request } of stored) {
    if (run.startedAt < midnight || !onModal(request)) continue
    const cap = request.modalMaxUsd ?? DEFAULT_MODAL_MAX_USD
    const dir = runDir(run.id)
    const spent = modalSpent(dir)
    if (!settled(run.phase)) usd += Math.max(spent.usd, cap)
    else if (spent.sandboxes) usd += spent.usd
    else if (existsSync(`${dir}/${MODAL_MARKER}`)) usd += cap
  }
  return usd
}

const words = (name: string, fallback: string) => (process.env[name] ?? fallback).split(/\s+/).filter(Boolean)
/** glhf/bixbench_v1, where PR #32's Modal sandbox and its `modal` dependency group live. */
export const BIXBENCH_V1 = resolve(GLHF, "bixbench_v1")

/**
 * The local runner for a Modal run: the same module, in glhf/bixbench_v1's environment with its `modal` group (that
 * package depends on bixbench3, so bixbench3.glhf_local is there too). GLHF_LOCAL_MODAL_CMD replaces it; tests set
 * GLHF_LOCAL_CMD, which then serves both.
 */
export const modalRunner = () => words("GLHF_LOCAL_MODAL_CMD", process.env.GLHF_LOCAL_CMD ?? `uv run --project ${BIXBENCH_V1} --group modal python -m bixbench3.glhf_local`)

/** The arguments that put a run's analyses on Modal, for the local runner. */
export const modalArgs = (request: Pick<RunRequest, "modalMaxUsd">) => ["--sandbox", "modal", "--modal-usd-cap", String(request.modalMaxUsd ?? DEFAULT_MODAL_MAX_USD)]

/** What the engine's last net did about a run's Modal sandboxes. `left` undefined: it could not ask Modal. */
export interface ModalCleanup { terminated: string[]; errors: string[]; checked: boolean }

/**
 * The last net after the engine stopped a Modal run's runner: a runner that had to be killed could not terminate its
 * own sandboxes, so they are found on Modal by the run's tag (from MODAL_MARKER) and terminated, each with a line in
 * the run's cost ledger (`python -m bixbench_v1.glhf_modal terminate`). undefined when the runner never prepared
 * Modal (no marker: nothing can be running there). GLHF_MODAL_CLEANUP_CMD replaces the command (tests use a stub).
 */
export function terminateModal(dir: string, timeoutMs = Number(process.env.GLHF_MODAL_CLEANUP_MS ?? 180_000)): Promise<ModalCleanup | undefined> {
  if (!existsSync(`${dir}/${MODAL_MARKER}`)) return Promise.resolve(undefined)
  const argv = [...words("GLHF_MODAL_CLEANUP_CMD", `uv run --project ${BIXBENCH_V1} --group modal python -m bixbench_v1.glhf_modal`), "terminate", "--run-dir", dir]
  return new Promise((ok) => {
    execFile(argv[0], argv.slice(1), { cwd: bixbenchDir(), env: childEnv(), timeout: timeoutMs, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      const line = String(stdout).trim().split("\n").at(-1) ?? ""
      try {
        const out = JSON.parse(line) as { terminated?: unknown; errors?: unknown }
        const list = (value: unknown) => (Array.isArray(value) ? value.map((v) => String(v).slice(0, 300)) : [])
        return ok({ terminated: list(out.terminated), errors: list(out.errors), checked: true })
      } catch {
        const why = (String(stderr).trim().split("\n").at(-1) || (error ? error.message : "no answer")).slice(0, 300)
        return ok({ terminated: [], errors: [why], checked: false })
      }
    })
  })
}

/** What happened to a run's Modal sandboxes, in words that claim only what was checked. "" when it never used Modal. */
export function modalNote(cleanup: ModalCleanup | undefined): string {
  if (!cleanup) return ""
  const look = "look with `uv run --group modal bixbench-v1 modal-sandboxes` in glhf/bixbench_v1"
  if (!cleanup.checked) return `its Modal sandboxes could not be checked (${cleanup.errors[0] ?? "no answer"}); they end at their timeout at the latest; ${look}`
  const n = cleanup.terminated.length
  const ended = n ? `${n} Modal sandbox${n === 1 ? "" : "es"} left by the runner terminated` : "Modal shows no sandbox of this run still running"
  return cleanup.errors.length ? `${ended}, but ${cleanup.errors.length} could not be (${cleanup.errors[0]}); ${look}` : ended
}
