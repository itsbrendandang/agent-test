// The short path: a plain factual question ("What is the powerhouse of the cell?") gets one search, a short answer
// written with the least thinking, and one round of statement checks. Harder questions keep the full pipeline.
// Fakes only (test/fixtures/research/harness.ts): fake models, a fake fetch for Exa and Europe PMC, fake keys.
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { DEFAULTS, engine, jsonResponse, paidAllowed } = await import("./fixtures/research/harness.ts")
const { fallbackPlan, readPlan, SHORT, SHORT_OPENING, shortPath } = await import("../src/research/pipeline.ts")
const { DEFAULTS: LIMITS } = await import("../src/research/types.ts")
import type { Stamped } from "../src/research/types.ts"

const Q = "What is the powerhouse of the cell?"
const of = <T extends Stamped["type"]>(events: Stamped[], type: T) => events.filter((e) => e.type === type) as Extract<Stamped, { type: T }>[]
const PLAN = JSON.stringify({
  key_question: "Which organelle is called the powerhouse of the cell?", medical: false, simple: true, researchable: true,
  opening: "I'll search the web and PubMed for the organelle called the powerhouse of the cell, screen what comes back, and check each statement against its source.",
  web: [{ query: "which organelle is called the powerhouse of the cell", objective: "Textbook and encyclopedia pages first." }],
  literature: ["mitochondria powerhouse cell ATP", "mitochondrial respiration energy"],
})
const PAGES = [
  { url: "https://www.example-biology.org/mitochondria", title: "Mitochondria: the powerhouse of the cell", highlights: ["Mitochondria are called the powerhouse of the cell because they make most of the cell's ATP through respiration.", "They have their own DNA."] },
  { url: "https://www.example-biology.org/organelles", title: "Cell organelles", highlights: ["Mitochondria produce ATP, the energy currency of the cell, in eukaryotic cells."] },
  { url: "https://www.example-biology.org/atp", title: "ATP synthesis", highlights: ["Mitochondria generate ATP by oxidative phosphorylation in the inner membrane."] },
  { url: "https://www.example-biology.org/respiration", title: "Cellular respiration", highlights: ["Mitochondria carry out aerobic respiration, which releases energy from glucose."] },
]
/** Keeps every passage: the fake pages are all on the question. */
const keepAll = (call: { user: string }) => JSON.stringify({ items: [...call.user.matchAll(/<passage i="(\d+)">/g)].map((p) => ({ i: Number(p[1]), answers_question: "yes", reports_results: "yes", study_type: "review" })) })

test("a plain factual question takes the short path: one web search, at most three sources, a short quiet draft, one round of checks; no hypotheses, critic or revision", async () => {
  const e = await engine({ script: { plan: () => PLAN, screen: keepAll } })
  e.net.exa = [() => jsonResponse({ results: PAGES, costDollars: { total: 0.005 } })]
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "standard" }))
    assert.equal(record.status, "done")
    assert.equal(record.short, true)
    // The run says the short path was taken: in its own event, the prepare step's summary, the opening and the record's note.
    const marked = of(events, "short.path")
    assert.equal(marked.length, 1)
    assert.deepEqual(marked[0].skipped, ["hypotheses", "method specialists", "further searches", "the critic's review", "the revision"])
    assert.ok(of(events, "opening")[0].seq < marked[0].seq)
    assert.match(of(events, "step.finished").find((s) => s.step === "prepare")!.summary!, /short path/)
    assert.equal(record.opening, SHORT_OPENING)
    assert.match(record.note ?? "", /short path was taken/)
    assert.equal(record.hypothesesNote, "A plain factual question: no hypotheses were needed.")
    // Only these steps ran.
    assert.deepEqual(of(events, "step.started").map((s) => s.step), ["prepare", "search:exa:1", "evaluate:exa:1", "write", "check", "save"])
    assert.ok(of(events, "step.finished").every((s) => s.status === "completed"))
    assert.deepEqual([e.count("plan"), e.count("hypothesize"), e.count("write"), e.count("critic"), e.count("revise"), e.count("rejudge"), e.count("specialist")], [1, 0, 1, 0, 0, 0, 0])
    assert.equal(e.exaRequests().length, 1)
    assert.equal(e.pmcRequests().length, 0, "PubMed is not searched when the web gave a source")
    // A short draft, written with fewer tokens and less thinking than a standard one.
    const write = e.calls.find((c) => c.role === "write")!
    assert.equal(write.options.maxTokens, SHORT.outputTokens)
    assert.ok(SHORT.outputTokens < LIMITS.levels.standard.maxOutputTokens)
    assert.match(write.system, new RegExp(`${SHORT.words}\\b`), "the writer is asked for a short answer")
    assert.equal(of(events, "step.started").find((s) => s.step === "write")!.input?.shortPath, true)
    // Sourced: at most three numbered sources, at least one cited, every cited sentence checked once.
    assert.equal(record.sources.length, SHORT.sourcesKept)
    assert.ok(record.sources.some((s) => s.cited))
    assert.ok(record.statements.length > 0 && record.statements.every((s) => s.stage === "draft"))
    assert.ok(record.statements.some((s) => s.verdict === "verified"))
    assert.equal(record.review.revised, false)
    assert.deepEqual(record.review.notes, [])
    assert.match(record.selection!.notSelected.at(-1)!.reason, /at most 3 sources are numbered at the standard \(short path\) level/)
  } finally { await e.close() }
})

test("the short path still cites a source when the web search fails: PubMed is searched instead", async () => {
  const e = await engine({ script: { plan: () => PLAN, screen: keepAll } })
  e.net.exa = [() => jsonResponse({ error: "upstream unavailable" }, 503)]
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "quick" }))
    assert.equal(record.short, true)
    assert.deepEqual(of(events, "step.started").map((s) => s.step).filter((s) => s.startsWith("search")), ["search:exa:1", "search:europepmc:1"])
    assert.equal(e.pmcRequests().length, 1)
    assert.ok(record.sources.length >= 1 && record.sources.length <= SHORT.sourcesKept)
    assert.ok(record.sources.every((s) => s.provider === "europepmc"))
    assert.ok(record.sources.some((s) => s.cited))
    assert.equal(e.count("critic"), 0)
  } finally { await e.close() }
})

test("a harder question keeps the full pipeline: the planner does not say simple, or the question is about health", async () => {
  // The default plan (a question about semaglutide and heart attacks) has no "simple".
  const full = await engine()
  try {
    const { record, events } = await paidAllowed(() => full.answer({ question: "Does semaglutide lower the risk of heart attack and stroke in people with obesity who do not have diabetes?", effort: "quick" }))
    assert.equal(record.short, undefined)
    assert.equal(of(events, "short.path").length, 0)
    assert.equal(full.count("critic"), 1)
    assert.equal(full.pmcRequests().length, 2)
    assert.equal(full.calls.find((c) => c.role === "write")!.options.maxTokens, LIMITS.levels.quick.maxOutputTokens)
  } finally { await full.close() }
  // Health: the planner's "simple" is not enough; a medical answer always gets the full review.
  const medical = await engine({ script: { plan: () => DEFAULTS.plan({} as never, 1).replace('"medical":true', '"medical":true,"simple":true') } })
  try {
    const { record } = await paidAllowed(() => medical.answer({ question: "What dose of semaglutide was used in the SELECT trial?", effort: "quick" }))
    assert.equal(record.short, undefined)
    assert.equal(medical.count("critic"), 1)
  } finally { await medical.close() }
})

test("shortPath: the planner's word decides, except for health questions and a plan that was not read", () => {
  const level = LIMITS.levels.standard
  const simple = readPlan(PLAN, Q, level)
  assert.equal(simple.simple, true)
  assert.equal(shortPath(simple, false), true)
  assert.equal(shortPath({ ...simple, simple: false }, false), false, "the planner did not say simple")
  assert.equal(shortPath(simple, true), false, "about health")
  assert.equal(shortPath({ ...fallbackPlan(Q), simple: true }, false), false, "the planner's reply was not read")
  assert.equal(readPlan(PLAN.replace('"simple":true', '"simple":"yes"'), Q, level).simple, false, "only a JSON true counts")
})

test("the short draft asks for less thinking than a full draft, on a model that can reason", async () => {
  // Oracle: the faux models report `reasoning: true` with no thinking-level map, so a full draft is sent "low" and the
  // short path the least the model allows (no level at all). A short path that still sent "low" fails here.
  const short = await engine({ script: { plan: () => PLAN, screen: keepAll }, reasoning: true })
  short.net.exa = [() => jsonResponse({ results: PAGES, costDollars: { total: 0.005 } })]
  try {
    await paidAllowed(() => short.answer({ question: Q, effort: "quick" }))
    assert.equal(short.calls.find((c) => c.role === "write")!.options.reasoning, undefined)
  } finally { await short.close() }
  const full = await engine({ reasoning: true })
  try {
    await paidAllowed(() => full.answer({ question: "Does semaglutide lower the risk of heart attack and stroke in people with obesity who do not have diabetes?", effort: "quick" }))
    assert.equal(full.calls.find((c) => c.role === "write")!.options.reasoning, "low")
  } finally { await full.close() }
})

test("the budget check prices a short draft at its smaller output cap", async () => {
  const { realBrain } = await import("../src/research/pipeline.ts")
  const { fakeModels } = await import("./fixtures/research/harness.ts")
  const { loadConfig } = await import("../src/config.ts")
  const level = LIMITS.levels.standard
  const brain = realBrain(fakeModels({}, []), loadConfig(), level, () => {})
  const full = brain.worstCase("write", 10_000), short = brain.worstCase("write", 10_000, true)
  assert.ok(short < full, `a short draft (${SHORT.outputTokens} tokens) is priced below a full one (${level.maxOutputTokens} tokens)`)
  assert.equal(brain.worstCase("revise", 10_000, true), brain.worstCase("revise", 10_000))
})
