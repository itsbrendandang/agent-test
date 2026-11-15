import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import { loadConfig } from "../src/config.ts"
import type { EvidenceItem } from "../src/events.ts"
import { FirstPass } from "../src/triage.ts"
import { demoBrain } from "../src/research/demo.ts"
import { runAnswer, type Brain, type PipelineDeps } from "../src/research/pipeline.ts"
import { newAnswerId, newThreadId, ResearchLog } from "../src/research/store.ts"
import { limitsOf, type ResearchRecord } from "../src/research/types.ts"

process.env.NO_PAID_CALLS = "1"

const reply = (text: string, usd = 0.01) => ({ text, usd, truncated: false })
const item = (i: number): EvidenceItem => ({ url: `https://example.org/study-${i}`, title: `Growth experiment ${i}`, text: "The compound inhibits growth in a carefully controlled experiment with adequate controls." })

function fixture(t: TestContext) {
  const config = loadConfig()
  config.paths.runs = mkdtempSync(join(tmpdir(), "research-budget-"))
  t.after(() => rmSync(config.paths.runs, { recursive: true, force: true }))
  const record: ResearchRecord = {
    id: newAnswerId(), thread: newThreadId(), kind: "answer", question: "Does the compound inhibit growth?", effort: "quick", mode: "real", status: "running", startedAt: Date.now(),
    caps: { maxUsd: 0.15, maxSeconds: 120 }, models: demoBrain.names, steps: [], searches: [], sources: [], statements: [], recommendations: [], usd: 0,
    review: { checker: "fake", critic: "fake", revised: false, notes: [] },
  }
  const calls: string[] = []
  const brain: Brain = {
    ...demoBrain,
    worstCase: (step) => ["check", "critic"].includes(step) ? 0.08 : 0.01,
    plan: async () => reply(JSON.stringify({ web: [{ query: "growth compound", objective: "study" }], literature: ["growth compound"] })),
    write: async () => { calls.push("write"); return reply("The compound inhibits growth in the first experiment [1]. The compound inhibits growth in the second experiment [2].") },
    critique: async () => { calls.push("critic"); return reply('{"notes":[]}', 0.08) },
  }
  const deps: PipelineDeps = {
    config, limits: limitsOf(config), env: { EXA_API_KEY: "fake-only" }, brain,
    firstPass: () => {
      const firstPass = new FirstPass(undefined as never, config, true)
      firstPass.triage = async (items) => { firstPass.usd = 0.01; return items.map((item) => ({ keep: true, item })) }
      firstPass.check = async (_model, claims, source) => {
        calls.push("check")
        await new Promise<void>((resolve) => setImmediate(resolve))
        firstPass.usd = 0.08
        return claims.map(() => ({ verdict: "verified", quote: source, quoteFound: true, checkedBy: "fake" }))
      }
      return firstPass
    },
    remember: (_key, work) => work(), earlier: [], paidOff: () => false,
    exa: async () => ({ items: [item(1)], notices: [], costUsd: 0.007 }),
    literature: async () => ({ items: [item(2)], notices: [] }),
  }
  return { record, calls, brain, deps, run: () => runAnswer(deps, record, new ResearchLog(config, record.id)) }
}

test("parallel check, check and critic reserve their worst cases before starting under a $0.15 cap", async (t) => {
  const f = fixture(t)
  await f.run()
  assert.deepEqual(f.calls, ["write", "check"])
  assert.equal(f.record.usd, 0.127)
  assert.ok(f.record.usd <= f.record.caps.maxUsd)
  assert.equal(f.record.stopped, "cap")
  assert.equal(f.record.statements.filter((s) => s.verdict === "verified").length, 1)
  assert.equal(f.record.statements.filter((s) => s.verdict === "unchecked").length, 1)
})

test("completed reservations are replaced by actual cost, leaving room for later calls", async (t) => {
  const f = fixture(t)
  f.brain.worstCase = (step) => ["check", "critic"].includes(step) ? 0.02 : 0.08
  f.deps.firstPass = () => {
    const firstPass = new FirstPass(undefined as never, f.deps.config, true)
    firstPass.triage = async (items) => { firstPass.usd = 0.01; return items.map((item) => ({ keep: true, item })) }
    firstPass.check = async (_model, claims, source) => {
      f.calls.push("check"); firstPass.usd = 0.01
      return claims.map(() => ({ verdict: "verified", quote: source, quoteFound: true, checkedBy: "fake" }))
    }
    return firstPass
  }
  f.brain.critique = async () => { f.calls.push("critic"); return reply('{"notes":[]}') }
  await f.run()
  assert.deepEqual(f.calls, ["write", "check", "check", "critic"])
  assert.equal(f.record.usd, 0.077)
  assert.equal(f.record.stopped, undefined)
})

test("a failed call releases its unused reservation and counts only the charged cost", async (t) => {
  const f = fixture(t)
  const worst = f.brain.worstCase
  f.brain.worstCase = (step, chars) => step === "plan" ? 0.149 : worst(step, chars)
  f.brain.plan = async () => { throw Object.assign(new Error("fake planner failure"), { usd: 0.003 }) }
  await f.run()
  assert.ok(f.calls.includes("write"), "the failed planner's reservation must not block the writer")
  assert.ok(f.record.usd >= 0.003 && f.record.usd <= f.record.caps.maxUsd)
})

test("cancellation releases the call's reservation without booking its worst case as spend", async (t) => {
  const f = fixture(t), cancel = new AbortController()
  f.deps.cancel = cancel.signal
  f.brain.worstCase = () => 0.149
  f.brain.plan = async () => { cancel.abort(); throw Object.assign(new Error("fake cancellation"), { usd: 0.003 }) }
  await f.run()
  assert.equal(f.record.status, "cancelled")
  assert.equal(f.record.usd, 0.003)
  assert.deepEqual(f.calls, [])
})
