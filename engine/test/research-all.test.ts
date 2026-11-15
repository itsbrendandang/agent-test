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
    assert.deepEqual(Object.keys(all.body.items[0]).sort(), ["finishedAt", "id", "mode", "question", "startedAt", "status", "thread", "usd"], "short lines: no answer text, sources or steps")
  } finally { await e.close() }
})
