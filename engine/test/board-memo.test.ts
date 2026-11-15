// A board run is finished only when the memo is written. Scripted models only: the lead is the scripted lead
// (src/mock.ts) with its write_memo call replaced by plain text, as a real model can do. Nothing is paid.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type MutableModels, type TranscriptContext } from "@earendil-works/pi-ai"
import { createApp } from "../src/app.ts"
import { loadState, MemoMissing, runBoard, startRun } from "../src/board/board.ts"
import { type BoardConfig, loadConfig } from "../src/config.ts"
import { EventLog } from "../src/events.ts"
import { mockLeadTurn, type Step } from "../src/mock.ts"
import { buildModels } from "../src/models.ts"

process.env.NO_PAID_CALLS = "1"

const BRIEF = join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md")
const tempConfig = (): BoardConfig => {
  const base = loadConfig(), dir = mkdtempSync(join(tmpdir(), "board-memo-"))
  return { ...base, paths: { ...base.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") } }
}

/** The scripted models, with a lead that answers in text where the scripted lead calls write_memo. `calls` counts the lead's model calls. */
function textLead() {
  const seen = { calls: 0 }
  const models: typeof buildModels = (agents, mock, ...rest) => {
    const m = buildModels(agents, mock, ...rest) as MutableModels // createModels() underneath: providers can be replaced
    const faux = fauxProvider({ provider: "mock-lead-scientist", models: [{ id: "mock", cost: { input: 15, output: 75, cacheRead: 0, cacheWrite: 0 } }], tokensPerSecond: 10_000 })
    faux.setResponses(Array.from({ length: 200 }, () => (ctx: TranscriptContext) => {
      seen.calls++
      let step: Step = mockLeadTurn(ctx)
      if (step.tool?.name === "write_memo") step = { text: "Decision: Go with conditions. CMP-0423 goes forward if the resistance panel is clean." }
      return step.tool ? fauxAssistantMessage([fauxText(step.text), fauxToolCall(step.tool.name, step.tool.args as never)], { stopReason: "toolUse" }) : fauxAssistantMessage(step.text)
    }))
    m.setProvider(faux.provider)
    return m
  }
  return { models, seen }
}

test("a lead that ends in text without write_memo leaves a failed run, not a finished one, and is not asked again", async () => {
  const config = tempConfig()
  const id = await startRun(BRIEF, { config, mock: true })
  const dir = join(config.paths.runs, id)
  const silent = textLead()
  await assert.rejects(runBoard(id, undefined, { config, mock: true, models: silent.models }), MemoMissing)
  assert.ok(silent.seen.calls > 0)
  const state = loadState(config, id)
  assert.equal(state.finished, undefined, "not finished")
  assert.match(state.failed ?? "", /without writing the memo/)
  assert.equal(existsSync(join(dir, "memo.md")), false)
  const events = EventLog.read(join(dir, "events.jsonl"))
  assert.equal(events.some((e) => e.type === "run.finished"), false, "no run.finished event")
  assert.ok(events.some((e) => e.type === "run.failed"))
  const listed = createApp({ config, mock: true, env: {} }).listRuns().find((r) => r.id === id) as { status: string; error?: string }
  assert.equal(listed.status, "failed"); assert.match(listed.error ?? "", /without writing the memo/)

  // A person resumes it: the kickoff replays from the session (same request id), so the lead is not called again and the run stays failed.
  const again = textLead()
  await assert.rejects(runBoard(id, undefined, { config, mock: true, models: again.models }), MemoMissing)
  assert.equal(again.seen.calls, 0, "no new lead call")
  const after = loadState(config, id)
  assert.equal(after.finished, undefined)
  assert.match(after.failed ?? "", /without writing the memo/)
})
