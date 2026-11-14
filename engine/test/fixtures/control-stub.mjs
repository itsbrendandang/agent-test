// A local runner for the run-control tests (GLHF_LOCAL_CMD in glhf-runs.test.ts): what cancel and the deadline must
// cope with. Same arguments as `python -m bixbench3.glhf_local`; no analysis, no Docker, no model.
//   GLHF_STUB_MS          when it finishes on its own with status "done" and a usage (default 60000)
//   GLHF_STUB_LINGER_MS   how long it stays alive after it wrote that result (default 0)
//   GLHF_STUB_IGNORE      signals it ignores, such as "SIGINT,SIGTERM" (a runner stuck in a container call)
//   GLHF_STUB_ON_INT=result   on SIGINT it writes run.json with status "failed" and a usage, then exits 1: what the
//                         real runner does when Inspect turns the interrupt into a cancelled eval
//   GLHF_STUB_CHILD       "plain" (default): a child that dies on any signal. "ignore": one that ignores SIGINT and
//                         SIGTERM. "none": no child
// Every signal it receives goes to <out>/signals.log, one name per line. Its child's pid goes to <out>/child.pid.
// Everything ends on its own after two minutes, so a failed test leaves nothing behind.
import { spawn } from "node:child_process"
import { appendFileSync, writeFileSync } from "node:fs"

const arg = (name) => process.argv[process.argv.indexOf(name) + 1]
const out = arg("--out")
const MAX = 120_000
const USAGE = { "mockllm/model": { input_tokens: 120, output_tokens: 30, total_tokens: 150 } }
const ignored = (process.env.GLHF_STUB_IGNORE ?? "").split(",").filter(Boolean)

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const interrupt = signal === "SIGINT" && process.env.GLHF_STUB_ON_INT === "result"
  if (!ignored.includes(signal) && !interrupt) continue
  process.on(signal, () => {
    appendFileSync(`${out}/signals.log`, `${signal}\n`)
    if (ignored.includes(signal)) return
    writeFileSync(`${out}/run.json`, JSON.stringify({ status: "failed", error: "interrupted", usage: USAGE, finished_at: Date.now() / 1000 }))
    process.exit(1)
  })
}

const kind = process.env.GLHF_STUB_CHILD ?? "plain"
if (kind !== "none") {
  const code = `${kind === "ignore" ? "process.on('SIGINT', () => {}); process.on('SIGTERM', () => {}); " : ""}setTimeout(() => process.exit(0), ${MAX})`
  const child = spawn(process.execPath, ["-e", code, "control-stub-child", out], { stdio: "ignore" })
  writeFileSync(`${out}/child.pid`, String(child.pid))
}
writeFileSync(`${out}/run.json`, JSON.stringify({ status: "running" }))
setTimeout(() => {
  writeFileSync(`${out}/run.json`, JSON.stringify({ status: "done", score: 1, artifacts: [{ artifact_id: "a", score: 1 }], usage: USAGE, finished_at: Date.now() / 1000 }))
  setTimeout(() => process.exit(0), Number(process.env.GLHF_STUB_LINGER_MS ?? 0))
}, Number(process.env.GLHF_STUB_MS ?? 60_000))
setTimeout(() => process.exit(0), MAX)
