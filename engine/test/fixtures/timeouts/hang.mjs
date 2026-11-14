// A runner (or launcher) that starts and never finishes. Stands in for GLHF_LOCAL_CMD in glhf-timeouts.test.ts.
//   GLHF_STUB_WRITE=running   write run.json {"status":"running"} first, as the real runner does once it is up
//   GLHF_STUB_IGNORE_TERM=1   ignore SIGTERM, like a runner stuck in a container call
//   GLHF_STUB_LOG             a file that gets one line per start, to count launches
// It starts a child (the real runner starts a sandbox client); both carry the --out folder in their command line,
// so the test finds leftovers with pgrep. Both end on their own after GLHF_STUB_MAX_MS, so a failed test leaks nothing.
import { spawn } from "node:child_process"
import { appendFileSync, writeFileSync } from "node:fs"

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
const out = arg("--out")
const max = Number(process.env.GLHF_STUB_MAX_MS ?? 120_000)
if (process.env.GLHF_STUB_LOG) appendFileSync(process.env.GLHF_STUB_LOG, `start hang ${process.pid} ${process.argv.slice(2).join(" ")}\n`)
console.log("hang stub: started; it will never finish")
if (out && process.env.GLHF_STUB_WRITE === "running") writeFileSync(`${out}/run.json`, JSON.stringify({ status: "running" }))
if (process.env.GLHF_STUB_IGNORE_TERM === "1") for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"]) process.on(signal, () => console.log(`hang stub: ignoring ${signal}`))
spawn(process.execPath, ["-e", `setTimeout(() => process.exit(0), ${max})`, "hang-stub-child", out ?? ""], { stdio: "ignore" })
setTimeout(() => process.exit(0), max)
