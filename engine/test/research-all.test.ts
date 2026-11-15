// GET /api/research?all=1: a short line for every saved answer, for totals. Without it the list stops at the newest 50. No model, no network.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { engine } = await import("./fixtures/research/harness.ts")

test("?all=1 lists every answer in short form; the plain list still stops at the newest 50", async () => {
  const e = await engine({ demo: true })
  try {
    for (let i = 0; i < 60; i++) {
      const id = `a-202611${String(10 + Math.floor(i / 24)).padStart(2, "0")}${String(i % 24).padStart(2, "0")}0000-${i.toString(16).padStart(8, "0")}`
      mkdirSync(join(e.runs, ".research", id), { recursive: true })
      writeFileSync(join(e.runs, ".research", id, "record.json"), JSON.stringify({ id, thread: "t-x", question: `Question ${i}?`, effort: "quick", mode: "demo", status: "done", startedAt: 1_000 + i, finishedAt: 2_000 + i, usd: 0, steps: [], sources: [], statements: [], answer: "long text ".repeat(50) }))
    }
    const plain = await e.get<{ items: { id: string }[] }>("/api/research")
    assert.equal(plain.body.items.length, 50)
    const all = await e.get<{ items: Record<string, unknown>[] }>("/api/research?all=1")
    assert.equal(all.status, 200)
    assert.equal(all.body.items.length, 60)
    assert.deepEqual(Object.keys(all.body.items[0]).sort(), ["agents", "checks", "effort", "finishedAt", "id", "mode", "question", "searches", "sources", "startedAt", "status", "thread", "usd"], "short lines: no answer text, sources or steps")
  } finally { await e.close() }
})

test("?all=1 says what a running answer is doing, who took part, and counts searches, sources and checks from the record", async () => {
  const e = await engine({ demo: true })
  try {
    const id = "a-20261115090000-0000beef"
    mkdirSync(join(e.runs, ".research", id), { recursive: true })
    const record = {
      id, thread: "t-x", question: "Does it work?", effort: "standard", mode: "real", status: "running", startedAt: Date.now() - 2_000, workStartedAt: Date.now() - 1_000, usd: 0.42, caps: { maxUsd: 2, maxSeconds: 300 },
      steps: [
        { step: "plan", kind: "plan", label: "Planning", agent: "planner", status: "done" },
        { step: "search:1", kind: "search", label: "Searching Europe PMC", agent: "searcher", status: "done" },
        { step: "write", kind: "write", label: "Writing the draft from 3 sources", agent: "writer", status: "running" },
      ],
      specialists: [{ name: "toxicologist", title: "Toxicologist", agent: "specialist:toxicologist", why: "", methods: [] }],
      searches: [{ provider: "europepmc", query: "q", ran: true, found: 5, kept: 3 }, { provider: "exa", query: "q", ran: false, found: 0, kept: 0, reason: "off" }],
      sources: [{ n: 1, url: "u", title: "t", provider: "europepmc", cited: true, text: "SECRET SOURCE TEXT" }, { n: 2, url: "u", title: "t", provider: "europepmc", text: "x" }, { n: 3, url: "u", title: "t", provider: "europepmc", earlier: true, cited: true, text: "x" }],
      statements: [{ verdict: "verified" }, { verdict: "verified" }, { verdict: "contradicted" }, { verdict: "unchecked" }],
      answer: { markdown: "SECRET ANSWER TEXT", direct: "x" },
    }
    writeFileSync(join(e.runs, ".research", id, "record.json"), JSON.stringify(record))
    const all = await e.get<{ items: Record<string, unknown>[] }>("/api/research?all=1")
    const line = all.body.items.find((x) => x.id === id) as Record<string, unknown>
    assert.ok(line, "the answer is listed")
    assert.deepEqual(line.step, { label: "Writing the draft from 3 sources", agent: "writer" })
    assert.deepEqual(line.agents, ["planner", "searcher", "writer", "specialist:toxicologist"])
    assert.equal(line.searches, 1, "only searches that ran")
    assert.deepEqual(line.sources, { kept: 2, cited: 2 }, "a source listed again from an earlier answer is not counted as kept here")
    assert.deepEqual(line.checks, { verified: 2, contradicted: 1, unsupported: 0, unchecked: 1 })
    assert.equal(line.maxUsd, 2)
    assert.equal(typeof line.workStartedAt, "number")
    assert.doesNotMatch(JSON.stringify(all.body), /SECRET/, "no answer or source text")
  } finally { await e.close() }
})
