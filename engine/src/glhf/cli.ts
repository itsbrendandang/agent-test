// GLHF run tracker CLI.  npm run glhf -- <command>
//
//   doctor [--cellranger DIR]   what this machine has and lacks, with the fix for each gap
//   demo [--solver single|glhf] scripted run on the demo case (no keys, needs Docker), followed to the end
//   run --mode local|cloud ...  start a run (see `run --help`); --follow stays until it ends
//   list                        runs, newest first
//   show <id>                   one run: status, score, claims and issues
//   resume                      continue tracking unfinished runs (when the engine server is not running)
//   scoreboard                  single agent vs swarm per task, next to the record
//
// With the engine server running (npm run engine) commands go through it; otherwise this process tracks.
import { existsSync, readFileSync } from "node:fs"
import "../env.ts"
import { doctor, tools } from "./doctor.ts"
import { TOKEN_FILE } from "./routes.ts"
import { listRuns, runDetail } from "./store.ts"
import { BadRequest, checkRequest, openTracker, type Tracker, TrackerBusy } from "./tracker.ts"
import { type GlhfRun, RECORD, type RunRequest } from "./types.ts"

const ENGINE = `http://localhost:${process.env.DRUG_BOARD_PORT ?? 8787}`
const [command, ...rest] = process.argv.slice(2)
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const settled = (run: GlhfRun) => run.phase === "done" || run.phase === "failed"
const fmt = (n: number | undefined) => (n === undefined ? "  -  " : n.toFixed(3))

/** --name value flags; a flag given twice becomes a list; a bare flag is "true". */
function flags(args: string[]) {
  const out: Record<string, string[]> = {}
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) { positional.push(args[i]); continue }
    const name = args[i].slice(2)
    const value = args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[++i] : "true"
    ;(out[name] ??= []).push(value)
  }
  return { get: (name: string) => out[name]?.at(-1), all: (name: string) => out[name] ?? [], positional }
}

const serverUp = async () => {
  try { return (await fetch(`${ENGINE}/api/glhf/runs`, { signal: AbortSignal.timeout(1_500) })).ok } catch { return false }
}

function describe(run: GlhfRun) {
  const when = new Date(run.startedAt).toISOString().slice(0, 16).replace("T", " ")
  return `${run.id.padEnd(40)} ${run.phase.padEnd(10)} ${fmt(run.score)}  ${run.mode.padEnd(5)} ${run.model}  ${when}`
}

function printResult(id: string) {
  const detail = runDetail(id)
  if (!detail) return console.log(`no such run: ${id}`)
  const { run } = detail
  console.log(`\n${run.id}: ${run.phase}${run.detail ? ` (${run.detail})` : ""}`)
  console.log(`  ${run.mode} run of task ${run.task}, solver ${run.solver}, model ${run.model}${Object.keys(run.roleModels).length ? `, roles ${JSON.stringify(run.roleModels)}` : ""}`)
  if (run.score !== undefined) console.log(`  score ${run.score.toFixed(3)} (official grader)${run.model === "mock" ? "  [scripted model: shows the plumbing works, not the science]" : ""}`)
  for (const a of run.artifacts ?? []) console.log(`    ${a.artifact_id}: ${a.score.toFixed(3)}`)
  const ledger = detail.ledger as { claims?: { id: string; verdict: string; text: string }[]; issues?: { id: string; severity: string; status: string; problem: string }[] } | null
  if (ledger) {
    const count = (v: string) => (ledger.claims ?? []).filter((c) => c.verdict === v).length
    const issues = ledger.issues ?? []
    console.log(`  claims: ${count("supported")} supported, ${count("refuted")} refuted, ${count("insufficient") + count("untested")} not established`)
    console.log(`  critic issues: ${issues.filter((i) => i.status === "fixed").length} fixed, ${issues.filter((i) => i.status !== "fixed").length} open`)
    for (const c of ledger.claims ?? []) console.log(`    ${c.id} [${c.verdict}] ${c.text}`)
    for (const i of issues) console.log(`    ${i.id} [${i.severity}/${i.status}] ${i.problem}`)
  }
  if (run.error) console.log(`  error: ${run.error}`)
}

/** Print each change until the run settles. Reads the record, so it works whoever is tracking. */
async function follow(id: string, done?: Promise<unknown>) {
  let last = ""
  let finished = false
  void done?.then(() => (finished = true))
  for (;;) {
    const run = runDetail(id)?.run
    const line = run ? `${run.phase}${run.detail ? `: ${run.detail}` : ""}` : "waiting"
    if (line !== last) console.log(`  ${new Date().toTimeString().slice(0, 8)}  ${line}`)
    last = line
    if ((run && settled(run)) || finished) break
    await sleep(1_000)
  }
  printResult(id)
  return runDetail(id)?.run
}

async function withTracker<T>(work: (tracker: Tracker) => Promise<T>): Promise<T> {
  let tracker: Tracker
  try { tracker = await openTracker() } catch (error) {
    if (error instanceof TrackerBusy) { console.error(`${error.message}. Start the engine (npm run engine) or wait for that command to end.`); process.exit(2) }
    throw error
  }
  try { return await work(tracker) } finally { await tracker.close() }
}

async function start(request: RunRequest, wait: boolean): Promise<number> {
  if (await serverUp()) {
    const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8") : ""
    const res = await fetch(`${ENGINE}/api/glhf/runs`, { method: "POST", headers: { "content-type": "application/json", "x-glhf-token": token }, body: JSON.stringify(request) })
    const body = (await res.json()) as { id?: string; error?: string }
    if (!res.ok || !body.id) { console.error(`could not start: ${body.error ?? res.status}`); return 1 }
    console.log(`started ${body.id} (tracked by the engine at ${ENGINE})`)
    if (!wait) return 0
    return (await follow(body.id))?.phase === "done" ? 0 : 1
  }
  return withTracker(async (tracker) => {
    const run = await tracker.start(request)
    console.log(`started ${run.id} (tracked by this command; the engine is not running)`)
    if (wait) return (await follow(run.id, tracker.wait(run.id)))?.phase === "done" ? 0 : 1
    while (runDetail(run.id)?.run.phase === "queued") await sleep(200) // the run itself is detached once launched
    console.log("The run continues on its own. Tracking stops with this command; continue it with:\n  npm run engine    (or)    npm run glhf -- resume")
    return 0
  })
}

async function main(): Promise<number> {
  const f = flags(rest)
  switch (command) {
    case "doctor": {
      const cellranger = f.get("cellranger")
      const checks = await doctor(cellranger === "true" ? "." : cellranger)
      for (const c of checks) {
        const mark = c.ok ? "ok     " : c.need === "optional" ? "missing" : "MISSING"
        console.log(`${mark}  ${c.name.padEnd(28)} ${c.found.padEnd(20)} [${c.need === "local" ? "all runs" : c.need === "cloud" ? "cloud runs" : "optional"}]`)
        if (!c.ok) console.log(`           -> ${c.fix}`)
      }
      const local = checks.filter((c) => c.need === "local" && !c.ok)
      const cloud = checks.filter((c) => c.need === "cloud" && !c.ok)
      console.log(local.length ? "\nNot ready for local runs." : "\nReady for local runs (npm run glhf -- demo).")
      console.log(cloud.length ? `Not ready for BixBench3 cloud runs: ${cloud.map((c) => c.name).join(", ")}.` : "Ready for BixBench3 cloud runs.")
      if (cellranger === undefined) console.log("Cell Ranger archives (needed once, for bixbench3 setup-runtime) were not checked; pass --cellranger DIR.")
      return local.length || cloud.length ? 1 : 0
    }
    case "demo":
      return start(checkRequest({ mode: "local", task: "demo", solver: f.get("solver") === "single" ? "single" : "glhf", model: "mock" }, true), true)
    case "run": {
      if (f.get("help")) {
        console.log("run --mode local|cloud --solver single|glhf --model MODEL [--task T] [--role-model ROLE=MODEL]... [--follow]\n" +
          "  local: runs the demo case in Docker. --model mock needs no key. [--time-limit SECONDS] [--case DIR]\n" +
          "  budgets (local): [--max-tokens N] whole run; [--max-messages-per-role N] swarm, per phase; [--seed N]\n" +
          "  swarm extras (local): [--exa] documentation search, needs EXA_API_KEY; [--memory] keep lessons in glhf/memory/\n" +
          "  cloud: a BixBench3 task on a GCP VM. Needs --task N --effort E; --project defaults to gcloud's. [--results-bucket gs://...] [--review-rounds N]\n" +
          "  roles: planner, experimenter, critic, reporter (swarm only), e.g. --role-model critic=openai/gpt-5.5")
        return 0
      }
      const roleModels = Object.fromEntries(f.all("role-model").map((item) => item.split("=", 2) as [string, string]))
      const mode = f.get("mode") ?? "local"
      const project = f.get("project") ?? (mode === "cloud" ? (await tools()).project ?? undefined : undefined)
      const request = checkRequest({
        mode: mode as RunRequest["mode"], task: f.get("task"), solver: (f.get("solver") ?? "glhf") as RunRequest["solver"], model: f.get("model") ?? "",
        roleModels, effort: f.get("effort"), project, resultsBucket: f.get("results-bucket"), caseDir: f.get("case"),
        timeLimit: f.get("time-limit") ? Number(f.get("time-limit")) : undefined, reviewRounds: f.get("review-rounds") ? Number(f.get("review-rounds")) : undefined,
        maxTokens: f.get("max-tokens") ? Number(f.get("max-tokens")) : undefined,
        maxMessagesPerRole: f.get("max-messages-per-role") ? Number(f.get("max-messages-per-role")) : undefined,
        seed: f.get("seed") ? Number(f.get("seed")) : undefined,
        exa: f.get("exa") !== undefined || undefined, memory: f.get("memory") !== undefined || undefined,
      }, true)
      return start(request, f.get("follow") !== undefined)
    }
    case "list": {
      const runs = listRuns()
      if (!runs.length) console.log("No runs yet. Try: npm run glhf -- demo")
      for (const run of runs) console.log(describe(run))
      if (runs.some((r) => !settled(r)) && !(await serverUp())) console.log("\nUnfinished runs are not being tracked right now. Start the engine (npm run engine) or: npm run glhf -- resume")
      return 0
    }
    case "show": {
      if (!f.positional[0]) { console.error("show <run id>"); return 1 }
      printResult(f.positional[0])
      return 0
    }
    case "resume": {
      if (await serverUp()) {
        const open = listRuns().filter((r) => !settled(r))
        console.log(`The engine at ${ENGINE} is tracking ${open.length} unfinished run(s).`)
        for (const run of open) console.log(describe(run))
        return 0
      }
      return withTracker(async (tracker) => {
        const open = tracker.unfinished()
        if (!open.length) { console.log("Nothing to resume."); return 0 }
        console.log(`Continuing ${open.length} run(s): ${open.map((r) => r.id).join(", ")}`)
        await Promise.all(open.map((run) => follow(run.id, tracker.wait(run.id))))
        return 0
      })
    }
    case "scoreboard": {
      const done = listRuns().filter((r) => r.phase === "done" && r.score !== undefined)
      if (!done.length) { console.log("No finished runs yet."); return 0 }
      console.log(`${"task".padEnd(34)} single   swarm    diff    models (single | swarm)`)
      for (const task of [...new Set(done.map((r) => r.task))].sort()) {
        const latest = (solver: string) => done.find((r) => r.task === task && r.solver === solver) // newest first
        const single = latest("single"), swarm = latest("glhf")
        const diff = single?.score !== undefined && swarm?.score !== undefined ? (swarm.score - single.score >= 0 ? "+" : "") + (swarm.score - single.score).toFixed(3) : "  -  "
        const note = task === "demo" ? "  (demo case, not a BixBench3 task)" : ""
        console.log(`${task.padEnd(34)} ${fmt(single?.score)}    ${fmt(swarm?.score)}    ${diff}   ${single?.model ?? "-"} | ${swarm?.model ?? "-"}${note}`)
      }
      console.log(`\nBixBench3 record to beat: ${RECORD} (best published score). It applies to BixBench3 tasks only.`)
      if (done.some((r) => r.model === "mock")) console.log("Runs with the mock model replay a script: they show the plumbing works, not how well agents do.")
      return 0
    }
    default:
      console.log("Commands: doctor, demo, run, list, show <id>, resume, scoreboard.  Details: engine/src/glhf/cli.ts")
      return command ? 1 : 0
  }
}

main().then((code) => process.exit(code), (error) => {
  console.error(error instanceof BadRequest ? error.message : error)
  process.exit(1)
})
