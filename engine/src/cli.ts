// board run <brief.md>      start a run and follow it to the memo
// board resume <run-id>     continue a run a previous process left unfinished
// board list                runs and their status
import { existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import "./env.ts"
import { loadState, runBoard, startRun } from "./board.ts"
import { BriefRejected } from "./brief.ts"
import { loadConfig, MOCK, path, ROOT } from "./config.ts"
import type { Stamped } from "./events.ts"

const [command, arg] = process.argv.slice(2)
const config = loadConfig()

const print = (e: Stamped) => {
  const line = {
    "run.started": () => `▶ ${e.type === "run.started" && e.title}${MOCK ? "  (mock models, no keys)" : ""}`,
    "round.started": () => e.type === "round.started" && `\n── Round ${e.round}${e.final ? " (final positions)" : ""}: ${e.message}`,
    "member.replied": () => e.type === "member.replied" && `  ${e.member}: ${e.text.split("\n")[0].slice(0, 110)}`,
    "evidence.triaged": () => e.type === "evidence.triaged" && `  🔎 ${e.member} searched "${e.query}": kept ${e.kept}, dropped ${e.dropped}`,
    "claim.checked": () => e.type === "claim.checked" && `    ${({ verified: "✓", unsupported: "?", contradicted: "✗", unchecked: "·" })[e.verdict]} [${e.checker}] ${e.claim.slice(0, 90)}`,
    constraint: () => e.type === "constraint" && `  ⏱ wrap up: ${e.detail}`,
    "memo.written": () => e.type === "memo.written" && `\n📄 ${e.decision}\n   ${e.path}`,
    "run.finished": () => e.type === "run.finished" && `✔ finished: $${e.usd.toFixed(3)}, ${e.minutes.toFixed(1)} min`,
    "run.failed": () => e.type === "run.failed" && `✘ ${e.error}`,
  } as Record<string, () => string | false>
  const text = line[e.type]?.()
  if (text) console.log(text)
}

try {
  if (command === "run") {
    const brief = resolve(ROOT, arg ?? "board/briefs/kras-g12c-hit-to-lead.md")
    const runId = await startRun(brief)
    console.log(`run ${runId}`)
    await runBoard(runId, (log) => log.listeners.add(print))
  } else if (command === "resume" && arg) {
    await runBoard(arg, (log) => log.listeners.add(print))
  } else if (command === "list") {
    const dir = path(config, "runs")
    for (const id of existsSync(dir) ? readdirSync(dir).filter((d) => !d.startsWith(".")).sort() : []) {
      try { const s = loadState(config, id); console.log(`${s.finished ? "done   " : "pending"} ${id}  rounds=${s.rounds}`) } catch { /* not a run */ }
    }
  } else {
    console.log("usage: board run [brief.md] | board resume <run-id> | board list")
  }
} catch (error) {
  if (error instanceof BriefRejected) { console.error(`✘ ${error.message}`); process.exit(2) }
  throw error
}
