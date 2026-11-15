// board run <brief.md> [--max-usd N]  start a run and follow it to the memo; --max-usd only lowers its spend cap
// board resume <run-id>     continue a run a previous process left unfinished
// board list                runs and their status
import { existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import "./env.ts"
import { BudgetReached, loadState, RunBusy, runBoard, startRun } from "./board/board.ts"
import { BriefRejected } from "./brief.ts"
import { loadConfig, MOCK, path, ROOT } from "./config.ts"
import type { Stamped } from "./events.ts"
import { PaidCallsOff } from "./paid/paid.ts"
import { MissingTierKey } from "./providers.ts"

const rest = process.argv.slice(2)
// --max-usd <dollars>: lower this run's spend cap (never raises it). For a careful first real run.
const flag = rest.indexOf("--max-usd")
const maxUsd = flag >= 0 ? Number(rest.splice(flag, 2)[1]) : undefined
const [command, arg] = rest
if (maxUsd !== undefined && !(Number.isFinite(maxUsd) && maxUsd > 0)) { console.error("✘ --max-usd needs a positive number of dollars, for example --max-usd 0.5"); process.exit(2) }
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
    const runId = await startRun(brief, { maxUsd })
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
    console.log("usage: board run [brief.md] [--max-usd N] | board resume <run-id> | board list")
  }
} catch (error) {
  if (error instanceof BriefRejected) { console.error(`✘ ${error.message}`); process.exit(2) }
  if (error instanceof RunBusy || error instanceof BudgetReached || error instanceof PaidCallsOff || error instanceof MissingTierKey) { console.error(`✘ ${error.message}`); process.exit(3) }
  throw error
}
