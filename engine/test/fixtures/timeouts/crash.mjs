// A runner that fails: one line on stderr, then exit status GLHF_STUB_EXIT (default 3). No result is written.
//   GLHF_STUB_WRITE=running   write run.json {"status":"running"} first: it got as far as starting, then died
//   GLHF_STUB_LOG             a file that gets one line per start, to count launches
import { appendFileSync, writeFileSync } from "node:fs"

const out = process.argv[process.argv.indexOf("--out") + 1]
if (process.env.GLHF_STUB_LOG) appendFileSync(process.env.GLHF_STUB_LOG, `start crash ${process.pid} ${process.argv.slice(2).join(" ")}\n`)
if (process.env.GLHF_STUB_WRITE === "running") writeFileSync(`${out}/run.json`, JSON.stringify({ status: "running" }))
console.error("crash stub: the sandbox image is missing")
process.exit(Number(process.env.GLHF_STUB_EXIT ?? 3))
