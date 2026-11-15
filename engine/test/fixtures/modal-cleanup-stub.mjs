// Stands in for `python -m bixbench_v1.glhf_modal terminate --run-dir DIR` in tests (GLHF_MODAL_CLEANUP_CMD). Modal is
// never reached. It logs its call and prints what the real command prints:
//   GLHF_CLEANUP_LOG   a file that gets one line per call, with the arguments
//   GLHF_CLEANUP_SAY   what to print: "left" (one sandbox terminated, the default), "none", or "broken" (no JSON)
import { appendFileSync } from "node:fs"

if (process.env.GLHF_CLEANUP_LOG) appendFileSync(process.env.GLHF_CLEANUP_LOG, `${process.argv.slice(2).join(" ")}\n`)
const say = process.env.GLHF_CLEANUP_SAY ?? "left"
if (say === "broken") {
  console.error("modal.exception.AuthError: token missing")
  process.exit(1)
}
console.log(JSON.stringify({ terminated: say === "left" ? ["sb-left"] : [], errors: [] }))
