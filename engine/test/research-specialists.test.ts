// Method specialists in a research answer (src/research/pipeline.ts, src/specialists.ts): code picks them from the
// question's words, each drafts one section from the sources the searches found, and that section is checked and
// reviewed like the rest. Fake models and fake searches only: nothing here reaches the network or costs anything.
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { engine, paidAllowed } = await import("./fixtures/research/harness.ts")
const { matchSpecialists } = await import("../src/specialists.ts")

const Q = "Does semaglutide lower the risk of heart attack and stroke in people with obesity who do not have diabetes?"
const HERG = "Is hERG a risk for KRAS G12C inhibitors?"
/** The specialists the matcher gives for the hERG question, whatever the test's own question is (the fake sources are about semaglutide). */
const forHerg = () => matchSpecialists(HERG)

test("the matcher, not a model, picks the specialists; a question that fits none gets none", () => {
  assert.equal(forHerg()[0].specialist.name, "toxicologist")
  assert.deepEqual(matchSpecialists("What is the capital of France?"), [])
})

test("Demo: the matched specialist joins, drafts a section from the example sources, and it is checked; nothing is spent", async () => {
  const e = await engine({ demo: true, deps: { specialists: undefined } }) // the engine's own matcher
  try {
    const { record, events } = await e.answer({ question: HERG, effort: "quick" })
    assert.equal(record.status, "done")
    assert.deepEqual(record.specialists?.map((s) => [s.name, s.agent]), [["toxicologist", "specialist:toxicologist"]], "the quick level adds one")
    const chosen = events.filter((x) => x.type === "specialists")
    assert.equal(chosen.length, 1)
    assert.equal(record.specialists?.[0].room, "quality")
    assert.equal(chosen[0].type === "specialists" && chosen[0].items[0].room, "quality")
    assert.ok(events.indexOf(chosen[0]) < events.findIndex((x) => x.type === "step.started" && x.kind === "search"), "who joined is said before the search")
    const step = record.steps.find((s) => s.step === "specialist:toxicologist")
    assert.deepEqual([step?.status, step?.agent, step?.kind], ["completed", "specialist:toxicologist", "write"])
    assert.match(record.answer!.markdown, /### Method view: /)
    const mine = record.statements.filter((s) => /Adding polarity reduced hERG binding/.test(s.text))
    assert.deepEqual(mine.map((s) => [s.verdict, s.sources]), [["verified", [2]]], "the specialist's sentence is checked against its source like any other")
    assert.equal(record.usd, 0)
    assert.equal(e.calls.length, 0, "no model was asked")
  } finally { await e.close() }
})

test("Real (fakes): the specialist is asked once on the writer's model with its method notes and the found sources; the checker and the critic get its section", async () => {
  const e = await engine({ deps: { specialists: forHerg } })
  try {
    const { record } = await paidAllowed(() => e.answer({ question: Q, effort: "standard" }))
    assert.equal(record.status, "done")
    assert.equal(record.specialists?.length, 2, "the standard level adds at most two")
    const asked = e.calls.filter((c) => c.role === "specialist")
    assert.equal(asked.length, 2)
    const writer = e.calls.find((c) => c.role === "write")!
    assert.ok(asked.every((c) => c.provider === writer.provider && c.model === writer.model), "standard effort: the strong tier, the writer's model")
    assert.ok(asked.every((c) => c.user.includes("<method-notes>") && /<evidence|<source/.test(c.user)), "its notes are data in the message, beside the numbered sources")
    assert.ok(asked.every((c) => !/https?:\/\/(?!example)[^\s]*github|pip install/.test(c.system)), "nothing about where the notes came from")
    assert.ok(asked.every((c) => c.options.signal instanceof AbortSignal))
    assert.match(record.draft ?? "", /### Method view: /)
    assert.ok(!/### Method view: [^\n]*\n+(#|$)/.test(record.draft ?? ""), "a heading is never left with nothing under it (a sentence the writer also wrote is shown once)")
    assert.ok(e.calls.filter((c) => c.role === "critic").every((c) => c.user.includes("### Method view: ")), "the critic reads the section")
    const sections = (record.draft ?? "").split("### Method view: ").slice(1).join(" ")
    const cited = record.statements.filter((s) => sections.includes(s.text.replace(/[.!?]$/, "")))
    assert.ok(cited.length >= 1 && cited.every((s) => s.verdict !== "unchecked"), "its cited sentences went through the statement check")
    assert.ok(record.usd! <= record.caps.maxUsd)
  } finally { await e.close() }
})

test("the specialist's model follows the effort: the cheap tier at quick, the strong tier at standard; the config can say otherwise", async () => {
  const quick = await engine({ deps: { specialists: forHerg } })
  const strong = await engine({ deps: { specialists: forHerg }, research: { quick: { specialist_tier: "strong" } } })
  try {
    const modelsOf = async (e: typeof quick) => {
      const { record } = await paidAllowed(() => e.answer({ question: Q, effort: "quick" }))
      const of = (role: "specialist" | "plan" | "write") => { const c = e.calls.find((x) => x.role === role)!; return `${c.provider}/${c.model}` }
      return { record, specialist: of("specialist"), planner: of("plan"), writer: of("write") }
    }
    const a = await modelsOf(quick)
    assert.notEqual(a.planner, a.writer, "the test config has two tiers")
    assert.equal(a.specialist, a.planner, "quick: the cheap tier")
    assert.equal(a.record.steps.find((s) => s.step.startsWith("specialist:"))?.input?.model, a.planner, "the step says which model it used")
    const b = await modelsOf(strong)
    assert.equal(b.specialist, b.writer, "specialist_tier: strong")
  } finally { await quick.close(); await strong.close() }
})

test("a cheap tier on another vendor than the writer is not used: the checker must not be the specialist's own model", async () => {
  const e = await engine({ deps: { specialists: forHerg }, config: (c) => ({ ...c, models: { ...c.models, cheap: "openai/gpt-4o-mini" } }) })
  try {
    await paidAllowed(() => e.answer({ question: Q, effort: "quick" }))
    const specialist = e.calls.find((x) => x.role === "specialist")!, writer = e.calls.find((x) => x.role === "write")!
    assert.equal(`${specialist.provider}/${specialist.model}`, `${writer.provider}/${writer.model}`)
  } finally { await e.close() }
})

test("a specialist never takes money the answer needs: under a tight cap it is not asked, and the answer is still written", async () => {
  // The harness's prices are fixed: at this cap the draft fits, and the draft with a specialist held beside it does not.
  const e = await engine({ deps: { specialists: forHerg }, research: { quick: { max_usd: 0.04 } } })
  try {
    const { record } = await paidAllowed(() => e.answer({ question: Q, effort: "quick" }))
    const step = record.steps.find((s) => s.step.startsWith("specialist:"))
    assert.equal(step?.status, "empty")
    assert.match(step?.summary ?? "", /^Not asked: /)
    assert.equal(e.count("specialist"), 0)
    assert.equal(e.count("write"), 1)
    assert.ok(record.answer?.markdown && !/### Method view/.test(record.answer.markdown))
    assert.ok(record.usd! <= record.caps.maxUsd)
  } finally { await e.close() }
})

test("replay: killed after any stored step and started again, each specialist and the writer are still paid once and the answer is the same", async () => {
  const stored: string[] = []
  const calm = await engine({ deps: { specialists: forHerg }, onStored: (key) => void stored.push(key) })
  const reference = (await paidAllowed(() => calm.answer({ question: Q, effort: "quick" }))).record
  await calm.close()
  assert.equal(reference.status, "done")
  assert.equal(stored.filter((k) => k.includes(":specialist:")).length, 1, "the specialist's reply is stored under its own key")
  for (let point = 1; point <= stored.length; point++) {
    let live = true, seen = 0
    const e = await engine({ deps: { specialists: forHerg }, onStored: () => { if (live && ++seen === point) { live = false; return "stop" } } })
    try {
      await paidAllowed(async () => {
        const id = (await e.ask({ question: Q, effort: "quick" })).body.id
        await e.research.idle()
        e.research.resume()
        await e.research.idle()
        const record = await e.record(id)
        assert.equal(record.status, "done", `killed after stored step ${point}`)
        assert.ok(e.count("specialist") === 1 && e.count("write") === 1, `killed after stored step ${point}: the specialist and the writer were each paid once`)
        assert.equal(record.answer?.markdown, reference.answer?.markdown, `killed after stored step ${point}: the same answer`)
      })
    } finally { await e.close() }
  }
})
