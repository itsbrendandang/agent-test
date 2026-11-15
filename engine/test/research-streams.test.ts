// The example event streams the dashboard is built against (test/fixtures/research/stream-*.jsonl) are made by the real
// code with fakes, here. This test makes them again and fails when the SHAPE of any event has changed (its type, its
// keys, the order of the stages), so the contract cannot drift unnoticed. To write the files again after a change that
// is meant: WRITE_RESEARCH_STREAMS=1 node --test test/research-streams.test.ts, and tell the dashboard's owner.
import assert from "node:assert/strict"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { DEFAULTS, engine, EUROPEPMC, jsonResponse, paidAllowed, containsKey } = await import("./fixtures/research/harness.ts")
import type { Stamped } from "../src/research/types.ts"

const Q = "Does semaglutide lower the risk of heart attack and stroke in people with obesity who do not have diabetes?"
const DIR = join(import.meta.dirname, "fixtures/research")
const TRIALS = { items: [
  { url: "https://clinicaltrials.gov/study/NCT03574597", title: "Semaglutide Effects on Heart Disease and Stroke in Patients With Overweight or Obesity (NCT03574597)", text: "ClinicalTrials.gov record NCT03574597. Status: Completed. Phase: Phase 3. Enrollment: 17604 participants. Condition: Overweight, Obesity, Cardiovascular Disease. Intervention: Semaglutide 2.4 mg once weekly, Placebo. Primary outcome: Time to first occurrence of cardiovascular death, non-fatal myocardial infarction or non-fatal stroke." },
  { url: "https://clinicaltrials.gov/study/NCT00000000", title: "An example registration with no semaglutide arm (NCT00000000)", text: "ClinicalTrials.gov record NCT00000000. Status: Recruiting. Condition: Obesity. Intervention: Diet and exercise programme only. Shares of no drug maker are involved." },
], notices: ["2 of 41 matching studies are shown."] }
const withDatabase = (call: Parameters<typeof DEFAULTS.plan>[0], n: number) => JSON.stringify({ ...JSON.parse(DEFAULTS.plan(call, n)), databases: [{ source: "clinicaltrials", query: "semaglutide obesity cardiovascular" }] })

/** Each example stream, made now by the real pipeline with fakes. */
async function make(): Promise<Record<string, Stamped[]>> {
  const out: Record<string, Stamped[]> = {}
  // 1. A standard answer: the web search, two literature searches and a database lookup; review; revision.
  const real = await engine({ script: { plan: withDatabase }, deps: { database: async () => TRIALS } })
  out.real = (await paidAllowed(() => real.answer({ question: Q, effort: "standard" }))).events
  await real.close()
  // 2. A demo answer.
  const demo = await engine({ demo: true })
  out.demo = (await demo.answer({ question: "Is hERG a risk for KRAS G12C inhibitors?", effort: "quick" })).events
  await demo.close()
  // 3. A failed source and an empty search: the web search fails, one literature search finds nothing, the database is down.
  const failed = await engine({ script: { plan: withDatabase }, deps: { database: async () => { throw new Error("ClinicalTrials.gov answered 503") } } })
  failed.net.exa = [() => jsonResponse({ error: "upstream unavailable" }, 503)]
  failed.net.europepmc = (query) => jsonResponse(query.startsWith("semaglutide cardiovascular outcomes") ? EUROPEPMC : { resultList: { result: [] } })
  out["failed-source"] = (await paidAllowed(() => failed.answer({ question: Q, effort: "standard" }))).events
  await failed.close()
  // 4. Cancelled while the answer was being written.
  let id = ""
  const cancelled = await engine({ script: { write: async (call) => { void cancelled.cancel(id); await new Promise<void>((resolve) => call.options.signal?.addEventListener("abort", () => resolve())); return "late" } } })
  await paidAllowed(async () => { id = (await cancelled.ask({ question: Q, effort: "quick" })).body.id; await cancelled.research.idle() })
  out.cancelled = cancelled.events(id)
  await cancelled.close()
  return out
}

/** What must not change without the dashboard knowing: each event's type and keys. Steps that run side by side may end in either order, so they are compared as a set. */
const shape = (events: Stamped[]) => events.map((e) => `${e.type}${"step" in e ? `(${e.step}${"status" in e ? `:${e.status}` : ""})` : ""} {${Object.keys(e).sort().join(",")}}`).sort()

test("the example streams in test/fixtures/research are what the code emits today, shape for shape", async () => {
  const streams = await make()
  for (const [name, events] of Object.entries(streams)) {
    const file = join(DIR, `stream-${name}.jsonl`)
    if (process.env.WRITE_RESEARCH_STREAMS === "1") writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n")
    assert.ok(existsSync(file), `${file} is missing: run with WRITE_RESEARCH_STREAMS=1`)
    const stored = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Stamped)
    assert.deepEqual(shape(events), shape(stored), `stream-${name}.jsonl no longer matches what the code emits`)
    // What every stream keeps, whatever happened in it.
    assert.deepEqual(events.map((e) => e.seq), events.map((_e, i) => i + 1), name)
    assert.ok(events.every((e) => e.run === events[0].run && typeof e.at === "number"), name)
    assert.equal(events.filter((e) => ["research.finished", "research.failed", "research.cancelled"].includes(e.type)).length, 1, `${name}: exactly one terminal event`)
    assert.ok(["research.finished", "research.failed", "research.cancelled"].includes(events.at(-1)!.type), `${name}: the terminal event is the last one`)
    const started = events.filter((e) => e.type === "step.started").map((e) => (e as { step: string }).step), finished = events.filter((e) => e.type === "step.finished").map((e) => (e as { step: string }).step)
    assert.deepEqual([...started].sort(), [...finished].sort(), `${name}: every step that started has finished, once`)
    assert.equal(new Set(started).size, started.length, `${name}: step ids are unique`)
    assert.equal(containsKey(JSON.stringify(events)), false, name)
  }
  const steps = (name: string) => Object.fromEntries(streams[name].filter((e) => e.type === "step.finished").map((e) => [(e as { step: string }).step, (e as { status: string }).status]))
  assert.deepEqual(steps("real"), { prepare: "completed", hypotheses: "completed", "search:exa:1": "completed", "evaluate:exa:1": "completed", "search:europepmc:1": "completed", "evaluate:europepmc:1": "completed", "search:europepmc:2": "completed", "evaluate:europepmc:2": "completed", "search:clinicaltrials:1": "completed", "evaluate:clinicaltrials:1": "completed", write: "completed", check: "completed", review: "completed", revise: "completed", "review:2": "completed", save: "completed" })
  assert.deepEqual(steps("failed-source"), { prepare: "completed", hypotheses: "completed", "search:exa:1": "failed", "search:europepmc:1": "completed", "evaluate:europepmc:1": "completed", "search:europepmc:2": "empty", "search:clinicaltrials:1": "failed", write: "completed", check: "completed", review: "completed", revise: "completed", "review:2": "completed", save: "completed" })
  assert.deepEqual(Object.values(steps("cancelled")).filter((s) => s === "cancelled").length, 1)
  assert.equal(steps("cancelled").write, "cancelled")
  // The database record is a numbered source with its own provider, kept although it "reports no results": it is on the question.
  const sources = (streams.real.find((e) => e.type === "sources") as { items: { provider: string; url: string }[] }).items
  assert.deepEqual(sources.filter((s) => s.provider === "clinicaltrials").map((s) => s.url), ["https://clinicaltrials.gov/study/NCT03574597"])
  const failedEnd = streams["failed-source"].find((e) => e.type === "missing") as { items: string[] }
  assert.deepEqual(failedEnd.items.map((m) => m.slice(0, 44)), ["Web search (Exa) could not be used (Exa 503:", "Literature search (PubMed, OpenAlex, Semanti", "ClinicalTrials.gov database could not be use"])
})
