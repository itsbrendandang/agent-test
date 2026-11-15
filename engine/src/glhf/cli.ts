// GLHF run tracker CLI.  npm run glhf -- <command>
//
//   doctor [--cellranger DIR]   what this machine has and lacks, with the fix for each gap
//   demo [--solver single|glhf] scripted run on the demo case (no keys, needs Docker), followed to the end
//   run --mode local|cloud ...  start a run (see `run --help`); --follow stays until it ends
//   list                        runs, newest first
//   show <id>                   one run: status, score, claims and issues
//   cancel <id>                 stop a local run and mark it cancelled
//   resume                      continue tracking unfinished runs (when the engine server is not running)
//   scoreboard                  single agent vs swarm per task, next to the record
//
// With the engine server running (npm run engine) commands go through it; otherwise this process tracks.
import { existsSync, readFileSync } from "node:fs"
import "../env.ts"
import { paidCallsLine, paidCallsOff } from "../paid/paid.ts"
import { doctor, tools } from "./doctor.ts"
import { TOKEN_FILE } from "./routes.ts"
import { type Cell, scoreboard } from "./scoreboard.ts"
import { listRuns, runDetail } from "./store.ts"
import { BadRequest, CannotCancel, checkStart, LocalBusy, NoSuchRun, openTracker, type Tracker, TrackerBusy } from "./tracker.ts"
import { type GlhfRun, RECORD, type RunRequest, settled as settledPhase, type Solver, type StartBody } from "./types.ts"

const ENGINE = `http://127.0.0.1:${process.env.DRUG_BOARD_PORT ?? 8787}`
const [command, ...rest] = process.argv.slice(2)
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const settled = (run: GlhfRun) => settledPhase(run.phase)
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

/** Start one run, or with `solvers` a pair that runs one after the other. Checked here first, so a refusal needs no server. */
async function start(body: StartBody, wait: boolean): Promise<number> {
  const requests = checkStart(body, true)
  const followAll = async (ids: string[], done?: (id: string) => Promise<unknown>) => {
    let ok = true
    for (const id of ids) ok = (await follow(id, done?.(id)))?.phase === "done" && ok // in the order they run
    return ok ? 0 : 1
  }
  const queued = (ids: string[]) => { if (ids.length > 1) console.log(`${ids[1]} starts when ${ids[0]} has ended. Cancelling ${ids[0]} cancels both.`) }
  if (await serverUp()) {
    const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8") : ""
    const res = await fetch(`${ENGINE}/api/glhf/runs`, { method: "POST", headers: { "content-type": "application/json", "x-glhf-token": token }, body: JSON.stringify(body) })
    const reply = (await res.json()) as { id?: string; ids?: string[]; error?: string }
    const ids = reply.ids ?? (reply.id ? [reply.id] : [])
    if (!res.ok || !ids.length) { console.error(`could not start: ${reply.error ?? res.status}`); return 1 }
    console.log(`started ${ids.join(", ")} (tracked by the engine at ${ENGINE})`)
    queued(ids)
    return wait ? followAll(ids) : 0
  }
  return withTracker(async (tracker) => {
    const ids = (await tracker.startChain(requests)).map((run) => run.id)
    console.log(`started ${ids.join(", ")} (tracked by this command; the engine is not running)`)
    queued(ids)
    if (wait) return followAll(ids, (id) => tracker.wait(id))
    while (runDetail(ids[0])?.run.phase === "queued") await sleep(200) // the run itself is detached once launched
    console.log(ids.length > 1
      ? `The first run continues on its own. ${ids[1]} is started by whoever tracks next: npm run engine    (or)    npm run glhf -- resume`
      : "The run continues on its own. Tracking stops with this command; continue it with:\n  npm run engine    (or)    npm run glhf -- resume")
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
      console.log(`\n${paidCallsLine()}`)
      console.log(local.length ? "Not ready for local runs." : "\nReady for local runs (npm run glhf -- demo).")
      console.log(cloud.length ? `Not ready for BixBench3 cloud runs: ${cloud.map((c) => c.name).join(", ")}.` : paidCallsOff() ? "The tools and keys for BixBench3 cloud runs are there, but cloud runs are refused while paid calls are off." : "Ready for BixBench3 cloud runs.")
      if (cellranger === undefined) console.log("Cell Ranger archives (needed once, for bixbench3 setup-runtime) were not checked; pass --cellranger DIR.")
      return local.length || cloud.length ? 1 : 0
    }
    case "demo":
      return start({ mode: "local", task: "demo", solver: f.get("solver") === "single" ? "single" : "glhf", model: "mock" }, true)
    case "run": {
      if (f.get("help")) {
        console.log("run --mode local|cloud --solver single|glhf --model MODEL [--task T] [--role-model ROLE=MODEL]... [--follow]\n" +
          "  pair (local): --solvers glhf,single instead of --solver. Two runs with the same model, time limit, token\n" +
          "    budget and seed, the second when the first has ended, so the scoreboard can compare them.\n" +
          "  a real model needs --max-tokens N: the limit on what the run can spend.\n" +
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
      const solvers = f.get("solvers")?.split(",").map((s) => s.trim()) as Solver[] | undefined
      if (solvers && f.get("solver")) throw new BadRequest("give --solver or --solvers, not both", "solver")
      const request: StartBody = {
        mode: mode as RunRequest["mode"], task: f.get("task"), ...(solvers ? { solvers } : { solver: (f.get("solver") ?? "glhf") as Solver }), model: f.get("model") ?? "",
        roleModels, effort: f.get("effort"), project, resultsBucket: f.get("results-bucket"), caseDir: f.get("case"),
        timeLimit: f.get("time-limit") ? Number(f.get("time-limit")) : undefined, reviewRounds: f.get("review-rounds") ? Number(f.get("review-rounds")) : undefined,
        maxTokens: f.get("max-tokens") ? Number(f.get("max-tokens")) : undefined,
        maxMessagesPerRole: f.get("max-messages-per-role") ? Number(f.get("max-messages-per-role")) : undefined,
        seed: f.get("seed") ? Number(f.get("seed")) : undefined,
        exa: f.get("exa") !== undefined || undefined, memory: f.get("memory") !== undefined || undefined,
      }
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
    case "cancel": {
      const id = f.positional[0]
      if (!id) { console.error("cancel <run id>"); return 1 }
      if (await serverUp()) {
        const res = await fetch(`${ENGINE}/api/glhf/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "content-type": "application/json", "x-glhf-token": existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8") : "" }, body: "{}" })
        const body = (await res.json()) as Partial<GlhfRun> & { error?: string }
        if (!res.ok) { console.error(`could not cancel: ${body.error ?? res.status}`); return 1 }
        console.log(`${body.id}: ${body.phase}${body.detail ? ` (${body.detail})` : ""}`)
        return 0
      }
      return withTracker(async (tracker) => {
        const run = await tracker.cancel(id)
        console.log(`${run.id}: ${run.phase}${run.detail ? ` (${run.detail})` : ""}`)
        return 0
      })
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
      const rows = scoreboard(listRuns())
      if (!rows.length) { console.log("No finished runs yet."); return 0 }
      const show = (c: Cell | undefined) => (c ? (c.score === undefined ? (c.phase === "failed" ? "failed" : "  -  ") : `${c.score.toFixed(3)}${c.phase === "failed" ? "!" : " "}`) : "  -  ").padEnd(8)
      console.log(`${"task".padEnd(22)} single   swarm    diff     settings`)
      for (const row of rows) {
        const diff = row.diff === undefined ? "  -   " : (row.diff >= 0 ? "+" : "") + row.diff.toFixed(3)
        const settings = [row.model, row.timeLimit ? `${row.timeLimit} s` : "", row.maxTokens ? `${row.maxTokens} tokens` : "no token cap"].filter(Boolean).join(", ")
        console.log(`${row.task.padEnd(22)} ${show(row.single)} ${show(row.swarm)} ${diff}   ${settings}${row.task === "demo" ? "  (demo case, not a BixBench3 task)" : ""}`)
        if (row.single) console.log(`    single agent: ${row.single.id}${row.single.extras.length ? `  [${row.single.extras.join("; ")}]` : ""}`)
        if (row.swarm) console.log(`    swarm:        ${row.swarm.id}${row.swarm.extras.length ? `  [${row.swarm.extras.join("; ")}]` : ""}`)
        if (row.note) console.log(`    note: ${row.note}`)
      }
      console.log("\nA difference is shown only for runs with the same task, model, time limit and token budget. Each row shows the")
      console.log("latest settled run per solver, also when it failed (marked failed, or ! after a score).")
      console.log(`BixBench3 record to beat: ${RECORD} (best published score). It applies to BixBench3 tasks only.`)
      if (rows.some((r) => r.model === "mock")) console.log("Runs with the mock model replay a script: they show the plumbing works, not how well agents do.")
      return 0
    }
    default:
      console.log("Commands: doctor, demo, run, list, show <id>, cancel <id>, resume, scoreboard.  Details: engine/src/glhf/cli.ts")
      return command ? 1 : 0
  }
}

main().then((code) => process.exit(code), (error) => {
  console.error(error instanceof BadRequest || error instanceof LocalBusy || error instanceof NoSuchRun || error instanceof CannotCancel ? error.message : error)
  process.exit(1)
})
