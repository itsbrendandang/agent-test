// A runner that writes a run.json nobody can use. GLHF_STUB_GARBAGE picks which:
//   text        not JSON at all
//   truncated   JSON cut off half-way, as after a full disk or a kill during the write
//   array       valid JSON of the wrong shape
//   status      valid JSON with a status the tracker does not know
//   types       status "done" with the wrong type in score, artifacts, usage and error
//   date        a complete result, except that finished_at is an ISO date instead of seconds since 1970
// Then it exits 0, or with GLHF_STUB_THEN=hang it stays alive like hang.mjs (and ends on its own after GLHF_STUB_MAX_MS).
//   GLHF_STUB_LOG   a file that gets one line per start, to count launches
import { appendFileSync, writeFileSync } from "node:fs"

const out = process.argv[process.argv.indexOf("--out") + 1]
const kinds = {
  text: "Traceback (most recent call last):\n  disk quota exceeded\n",
  truncated: '{"status": "done", "score": 0.',
  array: "[1, 2, 3]",
  status: '{"status": "finished-ish", "score": 1}',
  types: '{"status": "done", "score": "high", "artifacts": "none", "usage": 7, "error": 5}',
  date: '{"status": "done", "score": 1, "artifacts": [{"artifact_id": "a", "score": 1}], "finished_at": "2026-11-14T22:27:23Z"}',
}
if (process.env.GLHF_STUB_LOG) appendFileSync(process.env.GLHF_STUB_LOG, `start garbage ${process.pid} ${process.argv.slice(2).join(" ")}\n`)
writeFileSync(`${out}/run.json`, kinds[process.env.GLHF_STUB_GARBAGE ?? "text"])
console.log("garbage stub: wrote run.json")
if (process.env.GLHF_STUB_THEN === "hang") setTimeout(() => process.exit(0), Number(process.env.GLHF_STUB_MAX_MS ?? 120_000))
else process.exit(0)
