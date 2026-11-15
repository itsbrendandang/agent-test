// Stands in for `python -m bixbench3.glhf_local` in tests (GLHF_LOCAL_CMD). It takes the same arguments, writes
// run.json the way the real runner does, and does no analysis. Behaviour comes from the environment:
//   GLHF_STUB_MS     how long the "run" takes (default 300)
//   GLHF_STUB_FAIL   a solver name: runs of that solver end with status "failed"
//   (it also writes env.json: which provider keys it was given, as blank, set or absent)
//   GLHF_STUB_LOG    a file that gets one line per start and per end, to check the order of runs
import { spawn } from "node:child_process"
import { appendFileSync, writeFileSync } from "node:fs"

const arg = (name) => process.argv[process.argv.indexOf(name) + 1]
const out = arg("--out"), solver = arg("--solver")
const log = (what) => process.env.GLHF_STUB_LOG && appendFileSync(process.env.GLHF_STUB_LOG, `${what} ${solver} ${Date.now()} ${process.argv.slice(2).join(" ")}\n`)
const ms = Number(process.env.GLHF_STUB_MS ?? 300)

log("start")
// Which of the keys that can spend reached this process: "" (blank), "set" or null (absent). Never a value.
const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "EXA_API_KEY", "PAST_API_KEY", "HF_TOKEN", "TINKER_API_KEY", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY"]
writeFileSync(`${out}/env.json`, JSON.stringify({ NO_PAID_CALLS: process.env.NO_PAID_CALLS ?? null, ...Object.fromEntries(KEYS.map((k) => [k, process.env[k] === undefined ? null : process.env[k] === "" ? "" : "set"])) }))
writeFileSync(`${out}/run.json`, JSON.stringify({ status: "running" }))
// Something the runner started (the real one starts a sandbox client): a cancel must stop it too.
const child = spawn("sleep", [String(Math.ceil(ms / 1000) + 30)], { stdio: "ignore" })
writeFileSync(`${out}/child.pid`, String(child.pid))
setTimeout(() => {
  child.kill()
  const failed = process.env.GLHF_STUB_FAIL === solver
  writeFileSync(`${out}/run.json`, JSON.stringify(failed
    ? { status: "failed", error: "the stub was told to fail\nsecond line", finished_at: Date.now() / 1000 }
    : { status: "done", score: 1, artifacts: [{ artifact_id: "a", score: 1 }], finished_at: Date.now() / 1000 }))
  log("end")
  process.exit(failed ? 1 : 0)
}, ms)
