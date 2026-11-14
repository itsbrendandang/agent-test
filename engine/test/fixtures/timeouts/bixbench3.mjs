// Stands in for `uv run bixbench3` (GLHF_BIXBENCH3_CMD) in glhf-timeouts.test.ts. No cloud, no network, no cost.
// The test passes `--tag <folder>` first, so every process of this stub can be found with pgrep.
//   run        GLHF_STUB_RUN: hang (default) | silent (exit 0, prints nothing) | garbage (prints text that is not
//              the JSON the real command prints, exit 0) | crash (stderr line, exit 3)
//              GLHF_STUB_MANIFEST=<run id>: first write the run manifest, as the real command does before it creates the VM
//   status     prints {"status": GLHF_STUB_STATUS ?? "succeeded"}
//   complete   writes a grade and prints where
//   GLHF_STUB_LOG   a file that gets one line per `run`, to count launches
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"

const args = process.argv.slice(2)
const arg = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const command = ["run", "status", "complete"].find((c) => args.includes(c))
const root = process.env.GLHF_BIXBENCH3_RUNS
const print = (value) => console.log(JSON.stringify(value, null, 2))

if (command === "run") {
  if (process.env.GLHF_STUB_LOG) appendFileSync(process.env.GLHF_STUB_LOG, `start bixbench3-run ${process.pid} ${args.join(" ")}\n`)
  console.error("bixbench3 stub: provisioning")
  const id = process.env.GLHF_STUB_MANIFEST
  if (id) {
    mkdirSync(`${root}/${id}`, { recursive: true })
    writeFileSync(`${root}/${id}/run_manifest.json`, JSON.stringify({ run_id: id, task_id: arg("--task"), model: { id: arg("--model") }, solver: arg("--solver"), started_at: new Date().toISOString() }))
  }
  const mode = process.env.GLHF_STUB_RUN ?? "hang"
  if (mode === "silent") process.exit(0)
  if (mode === "garbage") { console.log("Provisioning...\nOK (run id withheld)"); process.exit(0) }
  if (mode === "crash") { console.error("bixbench3 stub: quota exceeded in region"); process.exit(3) }
  setTimeout(() => process.exit(0), Number(process.env.GLHF_STUB_MAX_MS ?? 120_000))
} else if (command === "status") {
  print({ status: process.env.GLHF_STUB_STATUS ?? "succeeded", phase: "done", vm_state: "TERMINATED" })
} else if (command === "complete") {
  const dir = `${root}/${arg("--run")}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/grade.json`, JSON.stringify({ score: 0.5, artifacts: [{ artifact_id: "a", score: 0.5 }] }))
  print({ status: "succeeded", local_dir: dir })
} else {
  console.error(`bixbench3 stub: unknown command: ${args.join(" ")}`)
  process.exit(2)
}
