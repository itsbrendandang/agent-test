// One engine process for the crash test (research-durable.test.ts). Fakes only: the harness's fake models and fake
// network; the runs folder is the temp folder given as the first argument.
//   start   asks one question and hangs inside the writer's call, having printed "WRITING <id>". The test then kills
//           this process with SIGKILL: nothing is closed, nothing is flushed, as when an engine dies.
//   resume  a new process on the same folder: it does what the engine does at start (research.resume()), waits for the
//           answer to end and prints what THIS process bought and how the answer ended, as one JSON line.
import { DEFAULTS, engine, type Role } from "./harness.ts"

const [runs, mode] = process.argv.slice(2)
process.env.NO_PAID_CALLS = "0" // paid-allowed logic, with fake keys and a fetch that reaches nothing; in this process only
const ROLES: Role[] = ["plan", "screen", "write", "check", "critic", "revise", "rejudge"]
const Q = "Does semaglutide lower the risk of heart attack and stroke in people with obesity who do not have diabetes?"

if (mode === "start") {
  let id = ""
  const e = await engine({ runs, script: { write: () => { console.log(`WRITING ${id}`); return new Promise<string>(() => {}) } } })
  id = (await e.ask({ question: Q, effort: "quick" })).body.id
  setInterval(() => {}, 1_000) // stay alive until killed
} else {
  const e = await engine({ runs, script: { write: DEFAULTS.write } })
  const taken = e.research.resume()
  await e.research.idle()
  const record = await e.record(taken[0])
  console.log(JSON.stringify({ taken, bought: { ...Object.fromEntries(ROLES.map((r) => [r, e.count(r)])), exa: e.exaRequests().length, europepmc: e.pmcRequests().length }, status: record.status, statements: record.statements.map((s) => s.verdict), usd: record.usd, events: e.events(taken[0]).map((x) => [x.seq, x.type]) }))
  await e.close()
  process.exit(0)
}
