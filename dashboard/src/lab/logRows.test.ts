import { describe, expect, it } from "vitest"
import { eventRows, filterRows, logDownload, sourceLink } from "./logRows"
import { PRACTICE_ANSWER, PRACTICE_REVIEW } from "./fixtures/practice"
import type { LabEvent } from "./adapter"

const events: LabEvent[] = [
  { seq: 1, at: 1000, type: "specialists", items: [{ agent: "specialist:toxicologist", title: "Safety portfolio", methods: [{ title: "Risk analysis" }] }] },
  { seq: 2, at: 2000, type: "step.started", step: "s", agent: "specialist:toxicologist", kind: "write", label: "Reading source evidence" },
  { seq: 3, at: 3000, type: "step.finished", step: "s", status: "completed", summary: "A safety note.", usd: 0.01 },
  { seq: 4, at: 4000, type: "sources", items: [{ n: 1, title: "Trial evidence", url: "https://example.org/trial" }, { n: 2, url: "javascript:alert(1)" }] },
  { seq: 5, at: 5000, type: "statement.checked", text: "Source supports the claim", sources: [1], verdict: "verified" },
  { seq: 6, at: 6000, type: "research.finished", usd: 0.03 },
]
describe("full event log", () => {
  it("keeps every event, its order, specialist title, inherited step agent and event costs", () => {
    const rows = eventRows(events, "answer")
    expect(rows).toHaveLength(6)
    expect(rows[2]).toMatchObject({ agent: "Safety portfolio", agentId: "specialist:toxicologist", kind: "write", text: "Reading source evidence: completed. A safety note.", usd: 0.01, costScope: "step" })
    expect(rows[4].sources).toEqual([{ title: "Trial evidence", url: "https://example.org/trial" }])
    expect(rows[5]).toMatchObject({ text: "Run finished.", usd: 0.03, costScope: "total" })
    expect(rows[0].usd).toBeUndefined()
    expect(eventRows(PRACTICE_ANSWER, "answer")).toHaveLength(PRACTICE_ANSWER.length)
    expect(eventRows(PRACTICE_REVIEW, "board")).toHaveLength(PRACTICE_REVIEW.length)
    expect(eventRows(Array.from({ length: 500 }, (_, seq) => ({ type: "answer.delta", seq, text: String(seq) })), "answer")).toHaveLength(500)
  })
  it("uses board roster titles and exposes evidence links, reply text and failures", () => {
    const rows = eventRows([
      { key: "roster", type: "run.roster", members: [{ name: "x", title: "Custom expert" }] },
      { key: "reply", type: "member.replied", member: "x", round: 1, text: "Full reply", usd: 0 },
      { key: "search", type: "evidence.triaged", member: "x", provider: "fixture", kept: 1, dropped: 0, items: [{ title: "Example", url: "https://example.org" }] },
      { key: "fail", type: "run.failed", error: "The run failed safely." },
    ], "board")
    expect(rows.find((r) => r.kind === "write")).toMatchObject({ agent: "Custom expert", text: "Replied in round 1. Full reply", usd: 0 })
    expect(rows.find((r) => r.kind === "search")?.text).toContain("practice example sources")
    expect(rows.find((r) => r.kind === "search")?.sources).toHaveLength(1)
    expect(rows.find((r) => r.kind === "error")?.text).toContain("The run failed safely.")
  })
  it("combines agent, kind and word search filters including sources", () => {
    const rows = eventRows(events, "answer")
    expect(filterRows(rows, { agent: "specialist:toxicologist", kind: "write", query: "SAFETY note" })).toHaveLength(1)
    expect(filterRows(rows, { agent: "", kind: "", query: "example.org/trial" })).toHaveLength(2)
    expect(filterRows(rows, { agent: "unknown", kind: "", query: "" })).toEqual([])
    expect(filterRows([], { agent: "", kind: "", query: "" })).toEqual([])
  })
  it("downloads only shown rows with provenance, safe CSV quoting and formula neutralization", () => {
    const rows = filterRows(eventRows(events, "answer"), { agent: "", kind: "check", query: "" })
    const run = { id: "demo", kind: "answer" as const, provenance: "practice" as const }
    expect(JSON.parse(logDownload(rows, run, "json"))).toEqual({ run, rows: JSON.parse(JSON.stringify(rows)) })
    const csv = logDownload([{ ...rows[0], text: '=SUM(1,2)\n"quoted"' }], run, "csv")
    expect(csv).toContain('"practice"')
    expect(csv).toContain('"\'=SUM(1,2)\n""quoted"""')
    expect(csv).toContain("https://example.org/trial")
    expect(logDownload([], run, "csv").split("\r\n")).toHaveLength(1)
    expect(JSON.parse(logDownload([], run, "json")).rows).toEqual([])
  })
  it("handles unknown, empty and malformed optional fields without inventing costs or links", () => {
    expect(eventRows([], "answer")).toEqual([])
    expect(sourceLink("data:text/html,hi")).toEqual([])
    expect(sourceLink("not a URL")).toEqual([])
    const rows = eventRows([{ type: "new.event", message: "New recorded action", usd: NaN }, { type: "sources", items: [null, {}, { url: "file:///private" }] }, {}], "answer")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ text: "New event. New recorded action", sources: [], agent: "Engine" })
    expect(rows[0].usd).toBeUndefined()
  })
  it("keeps swarm note actors and original second-based timestamps", () => {
    const rows = eventRows([{ kind: "claim.added", seq: 1, ts: 10.5, by: "planner", claim_id: "C1", text: "Recorded claim" }], "swarm")
    expect(rows[0]).toMatchObject({ at: 10500, agentId: "planner", text: "Recorded statement C1: Recorded claim" })
  })
})
