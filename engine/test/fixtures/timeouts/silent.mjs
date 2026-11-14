// A runner that exits 0 at once and writes nothing: no run.json, no output.
//   GLHF_STUB_LOG   a file that gets one line per start, to count launches
import { appendFileSync } from "node:fs"

if (process.env.GLHF_STUB_LOG) appendFileSync(process.env.GLHF_STUB_LOG, `start silent ${process.pid} ${process.argv.slice(2).join(" ")}\n`)
process.exit(0)
