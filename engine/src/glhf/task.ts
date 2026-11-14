// One durable task per benchmark run. Each phase does one small step and stores a checkpoint, and waiting is
// a stored sleep, so killing the engine at any point loses nothing: on restart the task continues from its
// last checkpoint. The benchmark processes themselves are started detached and outlive the engine.
//
//   pair:   the second run of a matched pair stays in launch (checking every 2 s) until the run it waits for
//           (input.after) is settled, then launches like any other run. The wait is a stored sleep too.
//   local:  launch -> watchLocal (poll run.json every 2 s) -> done | failed
//   cloud:  launch -> awaitLaunch (`bixbench3 run` provisions, then detaches) -> watchCloud (`status` every
//           5 min) -> complete (`complete` collects grades and deletes the VM) -> done | failed
import { execFile, execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Context } from "@earendil-works/chord/context"
import { defineTask, type TaskRuntime } from "@earendil-works/pi-durable"
import { childEnv, HOW_TO_ALLOW, paidCallsOff } from "../paid.ts"
import { alive, parseStamp, stamp } from "./proc.ts"
import { BIXBENCH, DEMO_CASE, listStored, loadStored, MEMORY, patchRun, readJson, readText, runDir, type Stored, tail, trackerLog } from "./store.ts"
import { type GlhfRun, type RunRequest, settled, type Usage } from "./types.ts"

export type RunInput = RunRequest & { id: string }
type Checkpoint =
  | { phase: "launch" }
  | { phase: "watchLocal"; polls: number }
  | { phase: "awaitLaunch"; polls: number }
  | { phase: "watchCloud"; remoteId: string; polls: number; errors: number }
  | { phase: "complete"; remoteId: string; remoteStatus: string; attempts: number }
export type RunResult = { phase: "done" | "failed" | "cancelled"; score: number | null }

const ms = (name: string, fallback: number) => Number(process.env[name] ?? fallback)
export const LOCAL_POLL = () => ms("GLHF_LOCAL_POLL_MS", 2_000)
const LAUNCH_POLL = () => ms("GLHF_LAUNCH_POLL_MS", 5_000)
const CLOUD_POLL = () => ms("GLHF_CLOUD_POLL_MS", 5 * 60_000)
const COMPLETE_RETRIES = 5
/** How long `bixbench3 run` may take to provision and detach before the launch counts as stuck. */
const LAUNCH_TIMEOUT = () => ms("GLHF_LAUNCH_TIMEOUT_MS", 2 * 60 * 60_000)
/** Local runs: time allowed beyond the run's own limit (image build, sandbox start, grading). */
const localDeadline = (startedAt: number, timeLimit: number | undefined) => {
  const limit = (timeLimit ?? 1800) * 1000
  return startedAt + limit + ms("GLHF_LOCAL_MARGIN_MS", Math.max(30 * 60_000, limit / 4))
}

/** The local runner. GLHF_LOCAL_CMD replaces it (tests use a stub script); the arguments stay the same. */
const localRunner = () => (process.env.GLHF_LOCAL_CMD ?? "uv run python -m bixbench3.glhf_local").split(/\s+/).filter(Boolean)
/** The `bixbench3` command. GLHF_BIXBENCH3_CMD replaces it (tests use a stub script). */
const bixbench3 = () => (process.env.GLHF_BIXBENCH3_CMD ?? "uv run bixbench3").split(/\s+/).filter(Boolean)
const manifestsRoot = () => process.env.GLHF_BIXBENCH3_RUNS ?? resolve(BIXBENCH, "runs")

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

/**
 * Start `argv` detached, so it survives this process. Returns false, starting nothing, when it was already
 * started. The marker file is created (exclusively) before anything is spawned, so two attempts can never both
 * start it, and a crash between the marker and the spawn leaves a run that fails rather than one that may be
 * started twice. The marker then gets "<pid> <start time>" of the wrapping shell, which stays alive for as long
 * as the command runs and writes the exit status after it: that is how a later process (after a restart) knows
 * whether it was started, whether it is still the same process, and how it ended.
 *
 * The pid is recorded twice, so that a crash right after the spawn does not leave a runner nobody knows: this
 * process writes it at once (the start time, which takes a `ps`, follows), and the shell writes its own pid to
 * `<name>.self` before it starts the command (see adopt).
 */
export function startOnce(dir: string, name: string, argv: string[], stdout: string, stderr: string | null, cwd = BIXBENCH): boolean {
  const pidFile = `${dir}/${name}.pid`
  try { writeFileSync(pidFile, "", { flag: "wx" }) } catch { return false }
  const redirect = stderr ? `> ${quote(stdout)} 2> ${quote(stderr)}` : `> ${quote(stdout)} 2>&1`
  const script = `echo $$ > ${quote(`${dir}/${name}.self`)}; "$@" ${redirect}; echo $? > ${quote(`${dir}/${name}.exit`)}`
  const child = spawn("sh", ["-c", script, "sh", ...argv], { cwd, detached: true, stdio: "ignore", env: childEnv() }) // keys blanked while paid calls are off
  child.on("error", () => { /* reported by processState as "gone" */ })
  child.unref()
  if (child.pid) {
    writeFileSync(pidFile, String(child.pid)) // at once: nothing slow may stand between the spawn and this
    writeFileSync(pidFile, stamp(child.pid))
  }
  return true
}

/** When the process started, in ms, or undefined when `ps` cannot say. */
const startedAtMs = (pid: number) => {
  try {
    const at = Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim().replace(/\s+/g, " "))
    return Number.isFinite(at) ? at : undefined
  } catch { return undefined }
}

/**
 * A command whose pid this process never recorded (the engine died right after the spawn) but which did start:
 * its shell wrote `<name>.self`. When that process is still there and is not younger than the file (a reused pid
 * would be), its stamp is written to the pid file, and from then on it is watched and stopped like any other.
 */
function adopt(dir: string, name: string): boolean {
  const self = `${dir}/${name}.self`
  const pid = parseStamp(readText(self))?.pid
  if (!pid || !pidExists(pid)) return false
  const started = startedAtMs(pid), written = statSync(self, { throwIfNoEntry: false })?.mtimeMs
  if (started === undefined || written === undefined || started > written + 2_000) return false
  writeFileSync(`${dir}/${name}.pid`, stamp(pid))
  return true
}

/**
 * "running" while the process is alive, its exit status once it ended, "gone" if it died without one.
 * Alive means the pid exists and started when we recorded it, so a reused pid does not count.
 */
export function processState(dir: string, name: string, polls: number): "running" | "gone" | number {
  const exit = readText(`${dir}/${name}.exit`)
  if (exit !== null && exit.trim() !== "") return Number(exit.trim())
  let mark = readText(`${dir}/${name}.pid`)
  if (!parseStamp(mark) && mark !== null && adopt(dir, name)) mark = readText(`${dir}/${name}.pid`)
  if (!parseStamp(mark)) return polls < 5 ? "running" : "gone" // the pid is not written yet; if it never is, the spawn failed
  return alive(mark) ? "running" : "gone"
}

type Kill = (pid: number, signal: NodeJS.Signals | 0) => unknown
const pidExists = (pid: number) => { try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM" } }
/** Is any member of the process group left? kill(-pgid, 0) fails with ESRCH only when there is none. */
const groupExists = (pgid: number) => { try { process.kill(-pgid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH" } }

/**
 * Is the command that wrote this stamp, or anything it started, still running? The command leads its own process
 * group (startOnce spawns it detached), so the question is about the group.
 *   the leader is there:  it must be the process we started (same start time), so a reused pid does not count
 *   the leader is gone:   the group is ours for as long as it has a member, because a pid is not given out again
 *                         while a process group of that number exists (POSIX)
 */
export function groupAlive(mark: string | null | undefined): boolean {
  const pid = parseStamp(mark)?.pid
  if (!pid) return false
  return pidExists(pid) ? alive(mark) : groupExists(pid)
}
/** Is the runner of this run folder, or anything it started, still running? */
export const runnerAlive = (dir: string, name = "runner") => groupAlive(readText(`${dir}/${name}.pid`))

export interface StopOptions { intMs?: number; termMs?: number; killMs?: number; /** Sends the signals (tests replace it). */ kill?: Kill }

/**
 * Stop a detached command and everything in its process group, and wait until the group is empty: SIGINT (the
 * Python runner cleans up its sandbox on it), then SIGTERM after `intMs`, then SIGKILL after `termMs`.
 *   "stopped"  no process of the group is left
 *   "none"     it was not running (never started, already ended, or the pid now belongs to another program)
 *   "stuck"    members are still there after SIGKILL and `killMs`. `<name>.stuck` is left in the folder, and for
 *              as long as the group lives the machine counts as busy (tracker.ts).
 * Before each signal it is checked again that the group is still ours (groupAlive).
 */
export async function stopAndWait(dir: string, name: string, options: StopOptions = {}): Promise<"stopped" | "none" | "stuck"> {
  const mark = readText(`${dir}/${name}.pid`)
  const pid = parseStamp(mark)?.pid
  const stuck = `${dir}/${name}.stuck`
  if (!pid || !groupAlive(mark)) { rmSync(stuck, { force: true }); return "none" }
  const kill: Kill = options.kill ?? ((p, signal) => process.kill(p, signal))
  const gone = async (within: number) => {
    for (const end = Date.now() + within; Date.now() < end;) {
      if (!groupAlive(mark)) return true
      await new Promise((ok) => setTimeout(ok, 25))
    }
    return !groupAlive(mark)
  }
  const steps: [NodeJS.Signals, number][] = [
    ["SIGINT", options.intMs ?? ms("GLHF_CANCEL_INT_MS", 4_000)],
    ["SIGTERM", options.termMs ?? ms("GLHF_CANCEL_GRACE_MS", 2_000)],
    ["SIGKILL", options.killMs ?? ms("GLHF_CANCEL_KILL_MS", 2_000)],
  ]
  for (const [signal, wait] of steps) {
    if (!groupAlive(mark)) break
    try { kill(-pid, signal) } catch { /* it ended just now, or it is not ours to signal: the check below decides */ }
    if (await gone(wait)) break
  }
  if (groupAlive(mark)) { writeFileSync(stuck, `${new Date().toISOString()} still running after SIGKILL: process group ${pid}\n`); return "stuck" }
  rmSync(stuck, { force: true })
  return "stopped"
}

const run = (argv: string[], timeoutMs: number) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((ok) => {
    execFile(argv[0], argv.slice(1), { cwd: BIXBENCH, env: childEnv(), timeout: timeoutMs, maxBuffer: 64 << 20 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0
      ok({ code, stdout, stderr: stderr || (error && typeof error.code !== "number" ? String(error.message) : "") })
    })
  })

/** The `docker` command. GLHF_DOCKER_CMD replaces it (tests use a stub script). */
const docker = () => (process.env.GLHF_DOCKER_CMD ?? "docker").split(/\s+/).filter(Boolean)

export interface Container { id: string; name: string; project: string }

/**
 * The sandbox containers of a run: those with a bind mount from the run's folder. The local runner mounts
 * <run folder>/workspace and <run folder>/outputs into its sandbox (sandbox/local-compose.yaml), and nothing
 * else does, so this needs no name: Inspect gives each compose project a random one (inspect-<task>-i<random>).
 * undefined when Docker could not be asked.
 */
export async function sandboxOf(dir: string): Promise<Container[] | undefined> {
  const list = await run([...docker(), "ps", "-aq", "--no-trunc"], 20_000)
  if (list.code !== 0) return undefined
  const ids = list.stdout.split(/\s+/).filter(Boolean)
  if (!ids.length) return []
  const format = '{{.Id}}\t{{.Name}}\t{{index .Config.Labels "com.docker.compose.project"}}\t{{range .Mounts}}{{.Source}}\t{{end}}'
  // A non-zero status here means a container went away since the list was made; the lines that did come are right.
  const seen = await run([...docker(), "inspect", "--format", format, ...ids], 20_000)
  if (seen.code !== 0 && !seen.stdout.trim()) return undefined
  const roots = [dir]
  try { roots.push(realpathSync(dir)) } catch { /* the folder is gone */ }
  return seen.stdout.split("\n").flatMap((line) => {
    const [id, name, project, ...sources] = line.split("\t")
    const mine = sources.some((source) => roots.some((root) => source === root || source.startsWith(`${root}/`)))
    return id && mine ? [{ id, name: (name ?? "").replace(/^\//, ""), project: project ?? "" }] : []
  })
}

/** What was found and what is left. `left` undefined: the second look, after the removal, did not work. */
export interface SandboxCleanup { found: number; left?: string[] }

/** Remove the sandbox containers of a run (and the networks of their compose projects), then look again. */
export async function removeSandbox(dir: string): Promise<SandboxCleanup | undefined> {
  const found = await sandboxOf(dir)
  if (!found) return undefined
  if (!found.length) return { found: 0, left: [] }
  await run([...docker(), "rm", "-f", "-v", ...found.map((c) => c.id)], 60_000)
  for (const project of new Set(found.map((c) => c.project).filter((p) => /^[\w.-]+$/.test(p)))) {
    const networks = (await run([...docker(), "network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], 20_000)).stdout.split(/\s+/).filter(Boolean)
    if (networks.length) await run([...docker(), "network", "rm", ...networks], 20_000)
  }
  const after = await sandboxOf(dir)
  return { found: found.length, left: after?.map((c) => c.name || c.id.slice(0, 12)) }
}

/** What happened to the sandbox, in words that claim only what was checked. */
export function sandboxNote(sandbox: SandboxCleanup | undefined): string {
  if (!sandbox) return "its sandbox containers were not checked (Docker did not answer); look with `docker ps`"
  if (sandbox.found === 0) return "Docker shows no sandbox container of this run"
  const n = `${sandbox.found} sandbox container${sandbox.found === 1 ? "" : "s"}`
  if (!sandbox.left) return `${n} found and asked to be removed, but the check afterwards failed; look with \`docker ps -a\``
  return sandbox.left.length ? `${sandbox.left.length} of ${n} could not be removed (${sandbox.left.join(", ")}); remove with \`docker rm -f\`` : `${n} removed`
}

export interface Stopped { runner: "stopped" | "none" | "stuck"; sandbox: SandboxCleanup | undefined }
const stopping = new Map<string, Promise<Stopped>>()

/**
 * Stop the local runner of a run folder (stopAndWait), then remove the sandbox containers it left: they belong
 * to the Docker daemon, not to the runner's process group, and stay when the runner did not get to clean up.
 * Two callers at once (a cancel and the watcher) share one attempt.
 */
export function stopRun(dir: string, options?: StopOptions): Promise<Stopped> {
  const going = stopping.get(dir)
  if (going) return going
  const attempt = (async () => {
    const runner = await stopAndWait(dir, "runner", options)
    return { runner, sandbox: await removeSandbox(dir) }
  })().finally(() => stopping.delete(dir))
  stopping.set(dir, attempt)
  return attempt
}
/** Is a stopRun for this folder under way? */
export const beingStopped = (dir: string) => stopping.has(dir)

/** The result a local runner wrote, when run.json says that it finished. */
export type LocalRun = { status?: string; score?: number; artifacts?: GlhfRun["artifacts"]; usage?: Usage; error?: string | null; finished_at?: number }
export const localRun = (dir: string) => readJson<LocalRun>(`${dir}/run.json`)
export const localEnded = (dir: string) => ["done", "failed"].includes(localRun(dir)?.status ?? "")
/** The token usage in run.json, when it has the shape the record wants. */
export function localUsage(dir: string): Usage | undefined {
  const usage = localRun(dir)?.usage
  return usage && typeof usage === "object" && !Array.isArray(usage) && Object.keys(usage).length ? usage : undefined
}

/** `bixbench3` prints one pretty JSON object (indent 2), sometimes followed by plain text. */
export function leadingJson(text: string): Record<string, unknown> | undefined {
  const lines = text.split("\n")
  const start = lines.findIndex((l) => l === "{")
  const end = lines.findIndex((l, i) => i > start && l === "}")
  if (start < 0 || end < 0) return undefined
  try { return JSON.parse(lines.slice(start, end + 1).join("\n")) as Record<string, unknown> } catch { return undefined }
}

export interface Manifest { run_id?: string; task_id?: string; paper_id?: string; started_at?: string; model?: { id?: string }; solver?: string }

/** Which solver a run manifest belongs to, when the manifest says so (a `solver` field, or solver=... in its command). */
export function manifestSolver(manifest: unknown): "single" | "glhf" | undefined {
  const named = (manifest as Manifest | undefined)?.solver
  if (named === "single" || named === "glhf") return named
  const found = JSON.stringify(manifest ?? {}).match(/solver=(single|glhf)\b/)
  return found ? (found[1] as "single" | "glhf") : undefined
}

/**
 * The run manifest `bixbench3 run` wrote before it created the VM, for a launch whose output was lost. It must
 * match the task, the model and the solver, be no older than the launch, and not belong to another tracked run.
 * When manifests do not name their solver and more than one fits, none is adopted: attributing a score to the
 * wrong solver is worse than asking a person. The same holds for a single such manifest while `rival` is true
 * (another unfinished run of the other solver, same task and model, has no cloud run yet). Returns the
 * candidates in those cases.
 */
export function findManifest(input: Pick<RunInput, "task" | "model" | "solver">, since: number, root = manifestsRoot(), taken: string[] = [], rival = false): { id?: string; ambiguous?: string[] } {
  const found: { id: string; at: number; solver?: "single" | "glhf" }[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const file = `${dir}/${name}`
      if (statSync(file).isDirectory()) walk(file)
      else if (name === "run_manifest.json") {
        const m = readJson<Manifest>(file)
        const at = Date.parse(m?.started_at ?? "")
        if (m?.run_id && !taken.includes(m.run_id) && m.model?.id === input.model && [m.task_id, m.paper_id].includes(input.task) && at >= since - 1_000) found.push({ id: m.run_id, at, solver: manifestSolver(m) })
      }
    }
  }
  walk(root)
  const fits = found.filter((f) => f.solver === undefined || f.solver === input.solver).sort((a, b) => a.at - b.at)
  const sure = fits.filter((f) => f.solver === input.solver)
  if (sure.length) return { id: sure[0].id }
  // No manifest names our solver. One that names none is ours only if nobody else could have written it:
  // not when several fit, and not when a run of the other solver for the same task and model (`rival`) is
  // still waiting for its own cloud run.
  if (fits.length > 1 || (fits.length === 1 && rival)) return { ambiguous: fits.map((f) => f.id) }
  return { id: fits[0]?.id }
}

/** Is another cloud run of the other solver, for the same task and model, unfinished and still without its cloud run id? */
export const hasRival = (input: Pick<RunInput, "id" | "task" | "model" | "solver">, stored: Stored[] = listStored()) => stored.some((s) =>
  s.run.id !== input.id && s.run.mode === "cloud" && s.run.solver !== input.solver && s.run.task === input.task && s.run.model === input.model &&
  !settled(s.run.phase) && !s.run.remoteId)

/** Cloud runs other tracked runs already follow. */
const takenRemoteIds = (except: string) => listStored().filter((s) => s.run.id !== except).flatMap((s) => (s.run.remoteId ? [s.run.remoteId] : []))

const grade = (dir: string) => {
  const g = readJson<{ score?: number; artifacts?: { artifact_id?: string; score?: number }[] }>(`${dir}/grade.json`)
  if (typeof g?.score !== "number") return {}
  const artifacts = (g.artifacts ?? []).flatMap((a) => (typeof a.artifact_id === "string" && typeof a.score === "number" ? [{ artifact_id: a.artifact_id, score: a.score }] : []))
  return { score: g.score, artifacts }
}

/** The note of a queued run that was cancelled together with the run it waited for. */
export const cancelledWith = (after: string) => `cancelled because ${after}, the run it was queued behind, was cancelled`

/** Was the run cancelled (tracker.cancel)? Then its task only has to end: nothing is started, read or written. */
const cancelled = (id: string) => loadStored(id)?.run.phase === "cancelled"

/**
 * The second run of a pair: is the run it waits for settled? A run whose record is missing or unreadable counts as
 * unsettled for as long as its runner (the pid file in its folder) is alive. `note` says what to remember when that run did not
 * finish. After a failure the partner starts anyway (a pair with one failed side is still worth its other side).
 * After a cancel it does not (`cancel`): whoever stopped a pair expects the spending to stop.
 */
export function predecessor(after: string, stored = loadStored(after)): { settled: boolean; note?: string; cancel?: true } {
  if (!stored) {
    // No record, or one that cannot be read, says nothing about its runner: ask the run folder's pid file.
    let live = false
    try { live = runnerAlive(runDir(after)) } catch { /* not a run id: there is no folder to ask */ }
    if (live) return { settled: false }
    return { settled: true, note: `started although the record of ${after}, the run it was queued behind, is gone` }
  }
  const { phase, error } = stored.run
  if (!settled(phase)) return { settled: false }
  if (phase === "failed") return { settled: true, note: `started although ${after}, the run it was queued behind, failed: ${(error ?? "no error message").split("\n")[0].slice(0, 300)}` }
  if (phase === "cancelled") return { settled: true, cancel: true, note: cancelledWith(after) }
  return { settled: true }
}

/**
 * Why this run may not be launched, or go on, while paid calls are off; undefined when it costs nothing (a local
 * run of the scripted model without Exa). checkRequest refuses such a request, so this is for runs that were
 * accepted earlier: a queued partner, or a run that an engine with paid calls on left behind.
 */
export function paidRun(input: Pick<RunInput, "mode" | "model" | "exa" | "roleModels">): string | undefined {
  if (!paidCallsOff()) return undefined
  const what = input.mode === "cloud" ? "a cloud run" : input.model !== "mock" || Object.keys(input.roleModels ?? {}).length ? "a run with a real model" : input.exa ? "a run with Exa search" : undefined
  return what && `${what} is refused. ${HOW_TO_ALLOW}`
}

/** The `detail` of a cancelled run: what was done about its runner and its sandbox, and only what was checked. */
export function cancelDetail(stopped: Stopped): string {
  const runner = stopped.runner === "stopped" ? "cancelled; the runner was stopped and no process of its group is left"
    : stopped.runner === "none" ? "cancelled; no runner was running (it had ended, or its pid was never recorded)"
    : "cancelled, but the runner could not be stopped: processes of its group are still there after SIGKILL (see runner.pid). The machine counts as busy until they are gone"
  return `${runner}; ${sandboxNote(stopped.sandbox)}`
}
/** For error messages: said only when containers of the run were found. */
const leftNote = (sandbox: SandboxCleanup | undefined) => (sandbox && sandbox.found > 0 ? `; ${sandboxNote(sandbox)}` : "")

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
      if (cancelled(input.id)) return endCancelled(runtime, context)
      const dir = runDir(input.id)
      mkdirSync(dir, { recursive: true })
      if (input.after && !existsSync(`${dir}/runner.pid`) && !existsSync(`${dir}/launch.pid`)) {
        const before = predecessor(input.after)
        if (!before.settled) {
          patchRun(input.id, { phase: "queued", detail: `waiting for ${input.after} to finish` })
          return runtime.sleepUntil(runtime.now() + LOCAL_POLL(), { phase: "launch" }, context)
        }
        if (before.cancel) { // tracker.cancel does this at once; this covers an engine that stopped in between
          patchRun(input.id, { phase: "cancelled", detail: "cancelled before the runner started", note: before.note, finishedAt: runtime.now() }, before.note)
          return endCancelled(runtime, context)
        }
        // The clock of this run starts now, not when it was queued: its time limit and its duration count from here.
        patchRun(input.id, { startedAt: runtime.now(), note: before.note }, before.note ?? `${input.after} is settled; starting`)
      }
      const refused = paidRun(input)
      if (refused && !existsSync(`${dir}/runner.pid`) && !existsSync(`${dir}/launch.pid`)) return finish(runtime, context, input.id, { phase: "failed", error: `not launched: ${refused}` })
      const roles = Object.entries(input.roleModels ?? {}).flatMap(([role, model]) => ["--role-model", `${role}=${model}`])
      if (input.mode === "local") {
        const argv = [...localRunner(), "--case", input.caseDir ?? DEMO_CASE, "--solver", input.solver,
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
      if (cancelled(id)) {
        // The record says cancelled. When the cancel itself is not at work (the engine died after it wrote the
        // record, before it stopped the runner), the runner is stopped here.
        if (!beingStopped(dir) && runnerAlive(dir)) {
          const detail = cancelDetail(await stopRun(dir)), usage = localUsage(dir)
          patchRun(id, { phase: "cancelled", detail, ...(usage && { usage }) }, "the runner of this cancelled run was still going; stopped it")
        }
        return endCancelled(runtime, context)
      }
      const { polls } = task.state.checkpoint
      // The switch was turned on while a run that spends was going: stop it. (A finished one is read as usual below.)
      const refused = paidRun(task.input)
      if (refused && !localEnded(dir) && processState(dir, "runner", polls) === "running" && parseStamp(readText(`${dir}/runner.pid`))) {
        const stopped = await stopRun(dir)
        return finish(runtime, context, id, { phase: "failed", usage: localUsage(dir), error: `stopped: ${refused}${stopped.runner === "stuck" ? " The runner could not be stopped; check for a leftover process (runner.pid) or container." : ""}${leftNote(stopped.sandbox)}` })
      }
      let local = localRun(dir)
      const state = processState(dir, "runner", polls)
      if (state !== "running" && local?.status === "running") local = localRun(dir) // it may have finished between the two reads
      if (local?.status === "done" || local?.status === "failed") {
        return finish(runtime, context, id, {
          phase: local.status, score: local.score, artifacts: local.artifacts, usage: local.usage,
          error: local.error ?? (local.status === "failed" ? "the run failed; see runner.log" : undefined),
          finishedAt: typeof local.finished_at === "number" && Number.isFinite(local.finished_at) && local.finished_at > 0 ? Math.round(local.finished_at * 1000) : undefined, // anything else would fault the task (NaN is not JSON)
        })
      }
      if (state !== "running") {
        // "gone" with a pid that was never recorded is a guess (processState). When run.json shows that a runner did
        // start, the message does not claim that it stopped.
        const unknown = state === "gone" && !parseStamp(readText(`${dir}/runner.pid`)) && local?.status === "running"
        const why = unknown ? "the local runner stopped without finishing, or it may still be running: its pid was never recorded, and run.json shows that it started. Check for a leftover process or container"
          : state === "gone" ? "the local runner stopped without finishing" : `the local runner exited with status ${state}`
        // A runner that was killed did not remove its sandbox.
        const sandbox = state === "gone" ? leftNote(await removeSandbox(dir)) : ""
        return finish(runtime, context, id, { phase: "failed", error: `${why}${sandbox}\n${tail(`${dir}/runner.log`)}`.trim() })
      }
      const startedAt = loadStored(id)?.run.startedAt ?? runtime.now()
      if (runtime.now() > localDeadline(startedAt, task.input.timeLimit)) {
        const stopped = await stopRun(dir)
        const limit = task.input.timeLimit ?? 1800
        const how = stopped.runner === "stopped" ? "it was stopped" : "it could not be stopped, check for a leftover process or container"
        return finish(runtime, context, id, { phase: "failed", usage: localUsage(dir), error: `the local runner was still going ${Math.round((runtime.now() - startedAt) / 60_000)} minutes after the start, far past its ${limit} s limit; ${how}${leftNote(stopped.sandbox)}\n${tail(`${dir}/runner.log`)}`.trim() })
      }
      patchRun(id, local ? { phase: "running", detail: lastPhase(dir) ?? "running" } : { phase: "launching", detail: "starting the sandbox" })
      await runtime.sleepUntil(runtime.now() + LOCAL_POLL(), { phase: "watchLocal", polls: polls + 1 }, context)
    },

    awaitLaunch: async (task, runtime, context) => {
      const input = task.input
      if (cancelled(input.id)) return endCancelled(runtime, context)
      const dir = runDir(input.id)
      const { polls } = task.state.checkpoint
      // The switch was turned on while `bixbench3 run` was still provisioning: stop the launcher before it starts
      // the run on the VM. What it already created is not removed from here; the message says how to check.
      const refused = paidRun(input)
      if (refused && processState(dir, "launch", polls) === "running" && parseStamp(readText(`${dir}/launch.pid`))) {
        await stopAndWait(dir, "launch")
        return finish(runtime, context, input.id, { phase: "failed", error: `launch stopped: ${refused}\nA VM may already exist and bill. Check with: gcloud compute instances list --project ${input.project}` })
      }
      let state = processState(dir, "launch", polls)
      const started = statSync(`${dir}/launch.pid`, { throwIfNoEntry: false })?.birthtimeMs || (loadStored(input.id)?.run.startedAt ?? runtime.now())
      const stuck = state === "running" && runtime.now() > started + LAUNCH_TIMEOUT()
      if (state === "running" && !stuck) {
        patchRun(input.id, { phase: "launching", detail: tail(`${dir}/launch.log`, 1) || "provisioning the cloud run" })
        return runtime.sleepUntil(runtime.now() + LAUNCH_POLL(), { phase: "awaitLaunch", polls: polls + 1 }, context)
      }
      if (stuck) state = "gone" // treated like a launcher that died: follow what it created, or fail
      const printed = leadingJson(readText(`${dir}/launch.out`) ?? "")?.run_id
      const manifest = typeof printed === "string" ? { id: printed } : findManifest(input, started, manifestsRoot(), takenRemoteIds(input.id), hasRival(input))
      const remoteId = manifest.id
      if (state === 0 && remoteId) {
        patchRun(input.id, { phase: "running", remoteId, detail: `cloud run ${remoteId}: detached` }, `cloud run ${remoteId} launched`)
        return runtime.commit(() => ({ status: "running", checkpoint: { phase: "watchCloud", remoteId, polls: 0, errors: 0 } }), context)
      }
      if (state === "gone" && remoteId) { // the launcher died or hung mid-way: follow what it created instead of launching again
        patchRun(input.id, { phase: "running", remoteId, detail: `cloud run ${remoteId}: launcher ${stuck ? "stuck" : "interrupted"}, checking` }, `adopted cloud run ${remoteId} from its manifest`)
        return runtime.commit(() => ({ status: "running", checkpoint: { phase: "watchCloud", remoteId, polls: 0, errors: 0 } }), context)
      }
      const command = (id: string) => `${bixbench3().join(" ")} cancel --run ${id} --project ${input.project}`
      const cancel = remoteId ? `\nA VM may be left stopped. Remove it with: ${command(remoteId)}`
        : manifest.ambiguous ? `\nSeveral cloud runs fit this launch and their manifests do not name the solver, so none was adopted: ${manifest.ambiguous.join(", ")}. Each may have a VM that is running and billing. Check each with: ${bixbench3().join(" ")} status --run ID --project ${input.project}` : ""
      const why = stuck ? `the launcher did not finish within ${Math.round(LAUNCH_TIMEOUT() / 60_000)} minutes and reported no run; it may still be running (see launch.pid)`
        : state === "gone" ? (manifest.ambiguous ? "the launcher stopped before it reported a run" : "the launcher stopped before it reported a run (no run manifest was written, so no VM was created by it)") : `bixbench3 run exited with status ${state}`
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
      // A cloud run that was launched before the switch came on has its keys on the VM. The engine cannot take
      // them back, and it does not delete a VM on its own; it says how a person stops it.
      const paid = paidRun(input) ? ` Paid calls are off now, but this run keeps spending on its VM. Stop it with: ${bixbench3().join(" ")} cancel --run ${remoteId} --project ${input.project}` : ""
      patchRun(input.id, { phase: "running", detail: `cloud run ${remoteId}: ${status.status} (phase=${status.phase}, vm=${status.vm_state})${paid}` })
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
  // Stops tracking only. It does not stop a local runner or delete a cloud VM. tracker.cancel stops the runner
  // itself and marks the record cancelled before it aborts the task; that record is left as it is (patchRun).
  abort: async (task, runtime, context) => {
    if (cancelled(task.input.id)) trackerLog(task.input.id, "tracking ended: the run was cancelled")
    else patchRun(task.input.id, { phase: "failed", error: "tracking was aborted; the run itself was not stopped", finishedAt: Date.now() })
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context)
  },
})

type Runtime = TaskRuntime<RunInput, Checkpoint, RunResult, object>

/** End the task of a run that was cancelled. The record already says so. */
const endCancelled = (runtime: Runtime, context: Context) =>
  runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: { phase: "cancelled", score: null } } }), context)

/** Settle a run: the record first (rewriting it is harmless), then the task's outcome. Logged once. */
async function finish(runtime: Runtime, context: Context, id: string, final: Partial<GlhfRun> & { phase: "done" | "failed" }): Promise<void> {
  if (cancelled(id)) return endCancelled(runtime, context) // the cancel arrived while this phase was working
  const stamp = { at: final.finishedAt ?? runtime.now() }
  const first = await runtime.memo("finished", stamp, context) // the first attempt wins, also across restarts
  const score = typeof final.score === "number" ? final.score : null
  if (first.at === stamp.at) trackerLog(id, `finished: ${final.phase}${score === null ? "" : ` score=${score}`}`)
  patchRun(id, { detail: undefined, ...final, finishedAt: first.at })
  await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: { phase: final.phase, score } } }), context)
}

