// One durable task per benchmark run. Each phase does one small step and stores a checkpoint, and waiting is
// a stored sleep, so killing the engine at any point loses nothing: on restart the task continues from its
// last checkpoint. The benchmark processes themselves are started detached and outlive the engine.
//
//   local:  launch -> watchLocal (poll run.json every 2 s) -> done | failed
//   cloud:  launch -> awaitLaunch (`bixbench3 run` provisions, then detaches) -> watchCloud (`status` every
//           5 min) -> complete (`complete` collects grades and deletes the VM) -> done | failed
import { execFile, spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import type { Context } from "@earendil-works/chord/context"
import { defineTask, type TaskRuntime } from "@earendil-works/pi-durable"
import { BIXBENCH, DEMO_CASE, MEMORY, patchRun, readJson, readText, runDir, tail, trackerLog } from "./store.ts"
import type { GlhfRun, RunRequest, Usage } from "./types.ts"

export type RunInput = RunRequest & { id: string }
type Checkpoint =
  | { phase: "launch" }
  | { phase: "watchLocal"; polls: number }
  | { phase: "awaitLaunch"; polls: number }
  | { phase: "watchCloud"; remoteId: string; polls: number; errors: number }
  | { phase: "complete"; remoteId: string; remoteStatus: string; attempts: number }
export type RunResult = { phase: "done" | "failed"; score: number | null }

const ms = (name: string, fallback: number) => Number(process.env[name] ?? fallback)
const LOCAL_POLL = () => ms("GLHF_LOCAL_POLL_MS", 2_000)
const LAUNCH_POLL = () => ms("GLHF_LAUNCH_POLL_MS", 5_000)
const CLOUD_POLL = () => ms("GLHF_CLOUD_POLL_MS", 5 * 60_000)
const COMPLETE_RETRIES = 5

/** The `bixbench3` command. GLHF_BIXBENCH3_CMD replaces it (tests use a stub script). */
const bixbench3 = () => (process.env.GLHF_BIXBENCH3_CMD ?? "uv run bixbench3").split(/\s+/).filter(Boolean)
const manifestsRoot = () => process.env.GLHF_BIXBENCH3_RUNS ?? resolve(BIXBENCH, "runs")

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

/**
 * Start `argv` detached, so it survives this process. The shell writes its own pid before the command and the
 * exit status after it, which is how a later process (after a restart) knows whether it was started and how it
 * ended. Returns false, starting nothing, when it was already started.
 */
function startOnce(dir: string, name: string, argv: string[], stdout: string, stderr: string | null): boolean {
  const pidFile = `${dir}/${name}.pid`
  if (existsSync(pidFile)) return false
  const redirect = stderr ? `> ${quote(stdout)} 2> ${quote(stderr)}` : `> ${quote(stdout)} 2>&1`
  const script = `echo $$ > ${quote(pidFile)}; "$@" ${redirect}; echo $? > ${quote(`${dir}/${name}.exit`)}`
  spawn("sh", ["-c", script, "sh", ...argv], { cwd: BIXBENCH, detached: true, stdio: "ignore", env: process.env }).unref()
  return true
}

/** "running" while the process is alive, its exit status once it ended, "gone" if it died without one. */
function processState(dir: string, name: string, polls: number): "running" | "gone" | number {
  const exit = readText(`${dir}/${name}.exit`)
  if (exit !== null && exit.trim() !== "") return Number(exit.trim())
  const pid = Number(readText(`${dir}/${name}.pid`)?.trim())
  if (!pid) return polls < 5 ? "running" : "gone" // the shell has not written its pid yet
  try { process.kill(pid, 0); return "running" } catch { return "gone" }
}

const run = (argv: string[], timeoutMs: number) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((ok) => {
    execFile(argv[0], argv.slice(1), { cwd: BIXBENCH, env: process.env, timeout: timeoutMs, maxBuffer: 64 << 20 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0
      ok({ code, stdout, stderr: stderr || (error && typeof error.code !== "number" ? String(error.message) : "") })
    })
  })

/** `bixbench3` prints one pretty JSON object (indent 2), sometimes followed by plain text. */
export function leadingJson(text: string): Record<string, unknown> | undefined {
  const lines = text.split("\n")
  const start = lines.findIndex((l) => l === "{")
  const end = lines.findIndex((l, i) => i > start && l === "}")
  if (start < 0 || end < 0) return undefined
  try { return JSON.parse(lines.slice(start, end + 1).join("\n")) as Record<string, unknown> } catch { return undefined }
}

/** The run manifest `bixbench3 run` writes before it creates the VM, for a launch whose output was lost. */
function findManifest(input: RunInput, since: number): string | undefined {
  const found: { id: string; at: number }[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const file = `${dir}/${name}`
      if (statSync(file).isDirectory()) walk(file)
      else if (name === "run_manifest.json") {
        const m = readJson<{ run_id?: string; task_id?: string; paper_id?: string; started_at?: string; model?: { id?: string } }>(file)
        const at = Date.parse(m?.started_at ?? "")
        if (m?.run_id && m.model?.id === input.model && [m.task_id, m.paper_id].includes(input.task) && at >= since - 1_000) found.push({ id: m.run_id, at })
      }
    }
  }
  walk(manifestsRoot())
  return found.sort((a, b) => a.at - b.at)[0]?.id
}

const grade = (dir: string) => {
  const g = readJson<{ score?: number; artifacts?: { artifact_id?: string; score?: number }[] }>(`${dir}/grade.json`)
  if (typeof g?.score !== "number") return {}
  const artifacts = (g.artifacts ?? []).flatMap((a) => (typeof a.artifact_id === "string" && typeof a.score === "number" ? [{ artifact_id: a.artifact_id, score: a.score }] : []))
  return { score: g.score, artifacts }
}

const lastPhase = (dir: string) => {
  const ledger = readJson<{ events?: { kind?: string; phase?: string }[] }>(`${dir}/outputs/glhf/ledger.json`)
  return ledger?.events?.findLast((e) => e.kind === "phase.started")?.phase
}

export const RunTask = defineTask<RunInput, Checkpoint, RunResult>({
  name: "glhf.run",
  version: 1,
  initial: () => ({ phase: "launch" }),
  phases: {
    launch: async (task, runtime, context) => {
      const input = task.input
      const dir = runDir(input.id)
      mkdirSync(dir, { recursive: true })
      const roles = Object.entries(input.roleModels ?? {}).flatMap(([role, model]) => ["--role-model", `${role}=${model}`])
      if (input.mode === "local") {
        const argv = ["uv", "run", "python", "-m", "bixbench3.glhf_local", "--case", input.caseDir ?? DEMO_CASE, "--solver", input.solver,
          "--model", input.model, "--out", dir, ...roles,
          ...(input.timeLimit ? ["--time-limit", String(input.timeLimit)] : []),
          ...(input.reviewRounds ? ["--review-rounds", String(input.reviewRounds)] : []),
          ...(input.maxTokens ? ["--max-tokens", String(input.maxTokens)] : []),
          ...(input.maxMessagesPerRole ? ["--max-messages-per-role", String(input.maxMessagesPerRole)] : []),
          ...(input.seed ? ["--seed", String(input.seed)] : []),
          ...(input.exa ? ["--exa"] : []),
          ...(input.memory ? ["--memory-dir", input.model === "mock" ? `${dir}/memory` : MEMORY] : [])]
        const started = startOnce(dir, "runner", argv, `${dir}/runner.log`, null)
        patchRun(input.id, { phase: "launching", detail: "starting the local runner" }, started ? "local runner started" : "local runner was already started; not starting again")
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "watchLocal", polls: 0 } }), context)
        return
      }
      const missing = (["task", "effort", "project"] as const).filter((k) => !input[k])
      if (missing.length) return finish(runtime, context, input.id, { phase: "failed", error: `cloud runs need ${missing.join(", ")}` })
      const argv = [...bixbench3(), "run", "--task", input.task!, "--model", input.model, "--effort", input.effort!, "--project", input.project!,
        "--solver", input.solver, ...roles,
        ...(input.reviewRounds ? ["--review-rounds", String(input.reviewRounds)] : []),
        ...(input.resultsBucket ? ["--results-bucket", input.resultsBucket] : [])]
      const started = startOnce(dir, "launch", argv, `${dir}/launch.out`, `${dir}/launch.log`)
      patchRun(input.id, { phase: "launching", detail: "provisioning the cloud run" }, started ? "bixbench3 run started" : "bixbench3 run was already started; not launching again")
      await runtime.commit(() => ({ status: "running", checkpoint: { phase: "awaitLaunch", polls: 0 } }), context)
    },

    watchLocal: async (task, runtime, context) => {
      const { id } = task.input
      const dir = runDir(id)
      const { polls } = task.state.checkpoint
      type LocalRun = { status?: string; score?: number; artifacts?: GlhfRun["artifacts"]; usage?: Usage; error?: string | null; finished_at?: number }
      const read = () => readJson<LocalRun>(`${dir}/run.json`)
      let local = read()
      const state = processState(dir, "runner", polls)
      if (state !== "running" && local?.status === "running") local = read() // it may have finished between the two reads
      if (local?.status === "done" || local?.status === "failed") {
        return finish(runtime, context, id, {
          phase: local.status, score: local.score, artifacts: local.artifacts, usage: local.usage,
          error: local.error ?? (local.status === "failed" ? "the run failed; see runner.log" : undefined),
          finishedAt: local.finished_at ? Math.round(local.finished_at * 1000) : undefined,
        })
      }
      if (state !== "running") {
        const why = state === "gone" ? "the local runner stopped without finishing" : `the local runner exited with status ${state}`
        return finish(runtime, context, id, { phase: "failed", error: `${why}\n${tail(`${dir}/runner.log`)}`.trim() })
      }
      patchRun(id, local ? { phase: "running", detail: lastPhase(dir) ?? "running" } : { phase: "launching", detail: "starting the sandbox" })
      await runtime.sleepUntil(runtime.now() + LOCAL_POLL(), { phase: "watchLocal", polls: polls + 1 }, context)
    },

    awaitLaunch: async (task, runtime, context) => {
      const input = task.input
      const dir = runDir(input.id)
      const { polls } = task.state.checkpoint
      const state = processState(dir, "launch", polls)
      if (state === "running") {
        patchRun(input.id, { phase: "launching", detail: tail(`${dir}/launch.log`, 1) || "provisioning the cloud run" })
        return runtime.sleepUntil(runtime.now() + LAUNCH_POLL(), { phase: "awaitLaunch", polls: polls + 1 }, context)
      }
      const started = statSync(`${dir}/launch.pid`, { throwIfNoEntry: false })?.mtimeMs ?? Date.now()
      const printed = leadingJson(readText(`${dir}/launch.out`) ?? "")?.run_id
      const remoteId = typeof printed === "string" ? printed : findManifest(input, started)
      if (state === 0 && remoteId) {
        patchRun(input.id, { phase: "running", detail: `cloud run ${remoteId}: detached` }, `cloud run ${remoteId} launched`)
        return runtime.commit(() => ({ status: "running", checkpoint: { phase: "watchCloud", remoteId, polls: 0, errors: 0 } }), context)
      }
      if (state === "gone" && remoteId) { // the launcher died mid-way: follow what it created instead of launching again
        patchRun(input.id, { phase: "running", detail: `cloud run ${remoteId}: launcher interrupted, checking` }, `adopted cloud run ${remoteId} from its manifest`)
        return runtime.commit(() => ({ status: "running", checkpoint: { phase: "watchCloud", remoteId, polls: 0, errors: 0 } }), context)
      }
      const cancel = remoteId ? `\nA VM may be left stopped. Remove it with: ${bixbench3().join(" ")} cancel --run ${remoteId} --project ${input.project}` : ""
      const why = state === "gone" ? "the launcher stopped before it reported a run (no run manifest was written, so no VM was created by it)" : `bixbench3 run exited with status ${state}`
      return finish(runtime, context, input.id, { phase: "failed", error: `${why}\n${tail(`${dir}/launch.log`)}${cancel}`.trim() })
    },

    watchCloud: async (task, runtime, context) => {
      const input = task.input
      const { remoteId, polls, errors } = task.state.checkpoint
      const result = await run([...bixbench3(), "status", "--run", remoteId, "--project", input.project!], 180_000)
      const status = leadingJson(result.stdout) as { status?: string; phase?: string; vm_state?: string } | undefined
      if (result.code !== 0 || !status?.status) {
        // Never give up on a run whose VM may be billing; keep checking and say what is wrong.
        patchRun(input.id, { detail: `cloud run ${remoteId}: status check failed ${errors + 1}x (${(result.stderr.trim().split("\n").pop() ?? "no output").slice(0, 200)})` })
        return runtime.sleepUntil(runtime.now() + CLOUD_POLL(), { phase: "watchCloud", remoteId, polls: polls + 1, errors: errors + 1 }, context)
      }
      if (status.status === "succeeded" || status.status === "failed") {
        patchRun(input.id, { phase: "completing", detail: `cloud run ${remoteId}: ${status.status}; collecting grades and deleting the VM` })
        return runtime.commit(() => ({ status: "running", checkpoint: { phase: "complete", remoteId, remoteStatus: status.status!, attempts: 0 } }), context)
      }
      if (status.status === "cancelled") return finish(runtime, context, input.id, { phase: "failed", error: `cloud run ${remoteId} was cancelled` })
      patchRun(input.id, { phase: "running", detail: `cloud run ${remoteId}: ${status.status} (phase=${status.phase}, vm=${status.vm_state})` })
      await runtime.sleepUntil(runtime.now() + CLOUD_POLL(), { phase: "watchCloud", remoteId, polls: polls + 1, errors: 0 }, context)
    },

    complete: async (task, runtime, context) => {
      const input = task.input
      const { remoteId, remoteStatus, attempts } = task.state.checkpoint
      // `complete` is safe to repeat: once it has cleaned up, it returns the stored result.
      const result = await run([...bixbench3(), "complete", "--run", remoteId, "--project", input.project!], 60 * 60_000)
      const done = leadingJson(result.stdout) as { status?: string; local_dir?: string } | undefined
      if (!done?.local_dir) {
        const command = `${bixbench3().join(" ")} complete --run ${remoteId} --project ${input.project}`
        const why = (result.stderr.trim().split("\n").pop() ?? "no output").slice(0, 300)
        if (attempts + 1 >= COMPLETE_RETRIES) {
          return finish(runtime, context, input.id, { phase: "failed", error: `could not collect cloud run ${remoteId} after ${COMPLETE_RETRIES} tries (${why}). The VM may still be running and billing. Run: ${command}` })
        }
        patchRun(input.id, { detail: `cloud run ${remoteId}: collecting failed ${attempts + 1}x (${why}); retrying` })
        return runtime.sleepUntil(runtime.now() + LAUNCH_POLL() * 12, { phase: "complete", remoteId, remoteStatus, attempts: attempts + 1 }, context)
      }
      const dir = resolve(BIXBENCH, done.local_dir)
      const ok = (done.status ?? remoteStatus) === "succeeded"
      return finish(runtime, context, input.id, {
        phase: ok ? "done" : "failed", ...grade(dir), detail: `cloud run ${remoteId}: results in ${dir}`,
        error: ok ? undefined : `cloud run ${remoteId} ${done.status ?? remoteStatus}; see ${dir}/run_manifest.json`,
      })
    },
  },
  // Stops tracking only. It does not stop a local runner or delete a cloud VM.
  abort: async (task, runtime, context) => {
    patchRun(task.input.id, { phase: "failed", error: "tracking was aborted; the run itself was not stopped", finishedAt: Date.now() })
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context)
  },
})

type Runtime = TaskRuntime<RunInput, Checkpoint, RunResult, object>

/** Settle a run: the record first (rewriting it is harmless), then the task's outcome. Logged once. */
async function finish(runtime: Runtime, context: Context, id: string, final: Partial<GlhfRun> & { phase: "done" | "failed" }): Promise<void> {
  const stamp = { at: final.finishedAt ?? runtime.now() }
  const first = await runtime.memo("finished", stamp, context) // the first attempt wins, also across restarts
  const score = typeof final.score === "number" ? final.score : null
  if (first.at === stamp.at) trackerLog(id, `finished: ${final.phase}${score === null ? "" : ` score=${score}`}`)
  patchRun(id, { detail: undefined, ...final, finishedAt: first.at })
  await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: { phase: final.phase, score } } }), context)
}

