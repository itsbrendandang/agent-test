// Stands in for `python -m bixbench3.glhf_local ... --sandbox modal` in tests (GLHF_LOCAL_CMD). No Modal, no analysis,
// no cost: it writes what the real runner leaves in the run folder of a Modal run, the marker (modal_run.json) when it
// has "prepared" Modal and one cost-ledger line per "sandbox" when it ends, then run.json. Behaviour:
//   GLHF_STUB_MS          how long the "run" takes (default 300)
//   GLHF_STUB_LOG         one line per start and per end, with the arguments
//   GLHF_STUB_USD         the dollars of the one ledger line it writes (default 0.0123)
//   GLHF_STUB_IGNORE_INT  "1": SIGINT is ignored, as by a runner that hangs while it cleans up (a cancel then kills it,
//                         and the engine's last net has to terminate the Modal sandboxes)
import { appendFileSync, writeFileSync } from "node:fs"

const arg = (name) => process.argv[process.argv.indexOf(name) + 1]
const out = arg("--out"), solver = arg("--solver")
const log = (what) => process.env.GLHF_STUB_LOG && appendFileSync(process.env.GLHF_STUB_LOG, `${what} ${solver} ${Date.now()} ${process.argv.slice(2).join(" ")}\n`)
const ms = Number(process.env.GLHF_STUB_MS ?? 300)

log("start")
writeFileSync(`${out}/run.json`, JSON.stringify({ status: "running" }))
writeFileSync(`${out}/modal_run.json`, JSON.stringify({ run_tag: "f".repeat(32), app: "bixbench-v1-sandbox", usd_cap: Number(arg("--modal-usd-cap")), prepared_at: Date.now() / 1000 }))
const finish = (status) => {
  const usd = Number(process.env.GLHF_STUB_USD ?? 0.0123)
  appendFileSync(`${out}/modal_ledger.jsonl`, `${JSON.stringify({ kind: "sandbox", who: "modal-sandbox", usd, sandbox_id: "sb-stub", seconds: 1 })}\nnot json, half a line\n`)
  writeFileSync(`${out}/run.json`, JSON.stringify(status === "done"
    ? { status: "done", score: 1, artifacts: [{ artifact_id: "a", score: 1 }], finished_at: Date.now() / 1000 }
    : { status: "failed", error: "interrupted", finished_at: Date.now() / 1000 }))
  log("end")
  process.exit(status === "done" ? 0 : 1)
}
process.on("SIGINT", () => { if (process.env.GLHF_STUB_IGNORE_INT !== "1") finish("failed") })
setTimeout(() => finish("done"), ms)
