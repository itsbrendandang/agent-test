// Known variants in a research answer (pipeline.ts lookVariants), with fakes only (fixtures/research/harness.ts): the
// lookup is a fake that counts its calls. It runs beside the writing, is stored under a stable key (a replay does not
// ask again), and never fails the answer.
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { engine, paidAllowed } = await import("./fixtures/research/harness.ts")
import type { KnownVariants, Target } from "../src/variants/known.ts"
import type { Stamped } from "../src/research/types.ts"

const Q = "Which KRAS mutations, such as G12D, are reported in lung cancer?"
const FOUND: KnownVariants = {
  accession: "P01116", protein: "GTPase KRas", gene: "KRAS", organism: "Homo sapiens", length: 189, found: 30, source: "https://www.uniprot.org/uniprotkb/P01116/entry",
  items: [{ id: "G12D", position: 12, from: "G", to: "D", kind: "natural variant", reported: "in GASC, JMML, SFM and RALD2; somatic mutation", citations: [{ label: "PubMed 16474405", url: "https://pubmed.ncbi.nlm.nih.gov/16474405/" }], record: "https://www.uniprot.org/uniprotkb/P01116/variant-viewer", featureId: "VAR_006839" }],
}
const step = (events: Stamped[], id: string) => events.filter((e) => (e.type === "step.started" || e.type === "step.finished") && e.step === id)

test("an answer about a protein's variants: the known variants are looked up once, kept in the record and sent as an event", async () => {
  const asked: { target: Target; named: string[] }[] = []
  const e = await engine({ deps: { variants: async (target, named) => { asked.push({ target, named }); return FOUND } } })
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "standard" }))
    assert.equal(record.status, "done")
    assert.deepEqual(asked, [{ target: { gene: "KRAS" }, named: ["G12D"] }])
    assert.deepEqual(record.variants, FOUND)
    const event = events.find((x) => x.type === "variants") as (Stamped & KnownVariants) | undefined
    assert.deepEqual(event?.items, FOUND.items)
    const [start, end] = step(events, "variants")
    assert.equal(start.type === "step.started" && start.kind, "fetch")
    assert.equal(end.type === "step.finished" && end.status, "completed")
    assert.ok(events.findIndex((x) => x.type === "variants") < events.findIndex((x) => x.type === "research.finished"))
  } finally { await e.close() }
})

test("a lookup that fails never fails the answer: its own step says so; a quick answer and a question about no protein look nothing up", async () => {
  let calls = 0
  const e = await engine({ deps: { variants: async () => { calls++; throw new Error("UniProt answered 503") } } })
  try {
    const { record, events } = await paidAllowed(() => e.answer({ question: Q, effort: "standard" }))
    assert.equal(record.status, "done")
    assert.equal(record.variants, undefined)
    const end = step(events, "variants")[1]
    assert.ok(end.type === "step.finished" && end.status === "failed" && /UniProt answered 503/.test(end.error ?? "") && /not affected/.test(end.consequence ?? ""))
    assert.equal(calls, 1)
    await paidAllowed(() => e.answer({ question: Q, effort: "quick" }))
    await paidAllowed(() => e.answer({ question: "Does semaglutide lower the risk of heart attack and stroke?", effort: "standard" }))
    assert.equal(calls, 1, "quick allows no database lookup; the other question names no protein")
  } finally { await e.close() }
})

test("killed right after the lookup was stored: after the restart the answer ends with the same variants and the lookup is not made again", async () => {
  let calls = 0
  let live = true
  const e = await engine({
    deps: { variants: async () => { calls++; return FOUND } },
    onStored: (key) => { if (live && key.split(":")[1] === "variants") { live = false; return "stop" } },
  })
  try {
    await paidAllowed(async () => {
      const started = await e.ask({ question: Q, effort: "standard" })
      await e.research.idle()
      assert.equal(calls, 1)
      assert.deepEqual(e.research.resume(), [started.body.id])
      await e.research.idle()
      const record = await e.record(started.body.id)
      assert.equal(record.status, "done")
      assert.deepEqual(record.variants, FOUND)
      assert.equal(calls, 1, "the stored lookup is read back, not made again")
      assert.equal(e.events(started.body.id).filter((x) => x.type === "variants").length, 1, "the event is not written twice")
    })
  } finally { await e.close() }
})
