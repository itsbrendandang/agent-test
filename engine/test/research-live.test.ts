// The answer text is streamed while it is written (answer.delta), so the Overview's chat can show it in real time. A
// demo answer's scripted writer gives its text a few words at a time (demo.ts pacedDemoBrain), and the event stream
// delivers each piece as it is stored, before the answer is finished. Fakes only; nothing reaches the network.
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { engine, ORIGIN } = await import("./fixtures/research/harness.ts")
const { DEMO_DRAFT, demoBrain, pacedDemoBrain } = await import("../src/research/demo.ts")
import type { Stamped } from "../src/research/types.ts"

const Q = "Is hERG a risk for KRAS G12C inhibitors?"
const shown = DEMO_DRAFT.slice(0, DEMO_DRAFT.indexOf("\nNEXT STEPS")).trim()
const of = <T extends Stamped["type"]>(events: Stamped[], type: T) => events.filter((e) => e.type === type) as Extract<Stamped, { type: T }>[]

test("the paced demo writer gives the same text as the plain one, a few words at a time", async () => {
  const pieces: string[] = []
  const reply = await pacedDemoBrain(1).write("system", "user", new AbortController().signal, (text) => pieces.push(text))
  assert.equal(reply.text, DEMO_DRAFT)
  assert.equal(pieces.join(""), DEMO_DRAFT, "nothing is lost or added between the pieces")
  assert.ok(pieces.length > 10, `${pieces.length} pieces`)
  assert.ok(pieces.at(-1)!.startsWith("\nNEXT STEPS"), "the lines nobody sees come in one piece")
  assert.equal(pacedDemoBrain(0), demoBrain, "pace 0 is the plain demo brain")
})

test("a cancelled answer stops the paced writer's pauses at once", async () => {
  const abort = new AbortController(), pieces: string[] = []
  const started = Date.now()
  const writing = pacedDemoBrain(1_000).write("system", "user", abort.signal, (text) => { pieces.push(text); abort.abort() })
  const reply = await writing
  assert.ok(Date.now() - started < 500, "it did not wait out its pauses")
  assert.equal(reply.text, DEMO_DRAFT)
})

test("a demo answer is streamed while it is written: several pieces, in order, inside the write step, before the text is final", async () => {
  const e = await engine({ demo: true, deps: { demoPaceMs: 15 } })
  try {
    const { events, record } = await e.answer({ question: Q, effort: "quick" })
    assert.equal(record.status, "done")
    const deltas = of(events, "answer.delta")
    assert.ok(deltas.length >= 2, `${deltas.length} pieces`)
    assert.deepEqual(deltas.map((d) => d.key), deltas.map((_d, i) => `answer.delta:${i}`), "numbered in order")
    assert.equal(deltas.map((d) => d.text).join("").trim(), shown, "the pieces add up to the draft, without the lines a program reads")
    assert.ok(deltas.at(-1)!.at > deltas[0].at, "the pieces were written over time, not at once")
    const seqOf = (key: string) => events.find((x) => x.key === key)!.seq
    assert.ok(deltas.every((d) => d.seq > seqOf("step.started:write") && d.seq < seqOf("step.finished:write")), "every piece is inside the write step")
    assert.ok(deltas.at(-1)!.seq < seqOf("answer.written"))
  } finally { await e.close() }
})

test("the event stream delivers the pieces as they are written, and a reconnect resumes after the last one it got", async () => {
  const e = await engine({ demo: true, deps: { demoPaceMs: 30 } })
  try {
    const { body } = await e.ask({ question: Q, effort: "quick" })
    const got: { at: number; event: Stamped }[] = []
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 10_000)
    const res = await fetch(`${e.url}/api/research/${body.id}/events`, { headers: { origin: ORIGIN }, signal: abort.signal })
    assert.equal(res.status, 200)
    let buffer = ""
    try {
      outer: for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += Buffer.from(chunk).toString("utf8")
        for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
          const frame = buffer.slice(0, at); buffer = buffer.slice(at + 2)
          const data = /^data: (.*)$/m.exec(frame)?.[1]
          if (!data) continue
          const event = JSON.parse(data) as Stamped
          got.push({ at: Date.now(), event })
          if (event.type === "research.finished") break outer
        }
      }
    } finally { clearTimeout(timer); abort.abort() }
    const deltas = got.filter((x) => x.event.type === "answer.delta")
    const written = got.find((x) => x.event.type === "answer.written")!
    assert.ok(deltas.length >= 2, `${deltas.length} pieces`)
    assert.ok(written.at - deltas[0].at >= 100, `the first piece came ${written.at - deltas[0].at} ms before the final text: it was live, not replayed at the end`)
    assert.deepEqual(got.map((x) => x.event.seq), got.map((_x, i) => i + 1), "each event once, in order")
    await e.research.idle()
    // A client that lost the connection after the first piece asks for what follows it, and gets the rest only.
    const first = deltas[0].event.seq
    const again = await fetch(`${e.url}/api/research/${body.id}/events?after=${first}`, { headers: { origin: ORIGIN } })
    const reader = (again.body as ReadableStream<Uint8Array>).getReader()
    let text = ""
    while (!text.includes("research.finished")) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString("utf8") }
    await reader.cancel()
    const seqs = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]))
    assert.equal(seqs[0], first + 1)
    assert.equal(seqs.at(-1), got.at(-1)!.event.seq)
  } finally { await e.close() }
})
