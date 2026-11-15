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
    expect(rows.find((r) => r.kind === "write")).toMatchObject({ agent: "Custom expert", text: "Full reply", usd: 0, round: { n: 1 } })
    expect(rows.find((r) => r.kind === "search")?.text).toContain("practice example sources")
    expect(rows.find((r) => r.kind === "search")?.sources).toHaveLength(1)
    expect(rows.find((r) => r.kind === "error")?.text).toContain("The run failed safely.")
  })
  it("gives a team review's speakers their jobs, flags a reply a check contradicted, and names the checkers in plain words", () => {
    const rows = eventRows([
      { key: "roster", type: "run.roster", members: [{ name: "critic", title: "Critic", role: "member", source: "board" }, { name: "tox", title: "Toxicologist", role: "member", source: "specialist" }] },
      { key: "r1", type: "round.started", round: 1, message: "Go." },
      { key: "a", type: "member.replied", member: "critic", round: 1, text: "Two claims." },
      { key: "b", type: "member.replied", member: "tox", round: 1, text: "One claim." },
      { key: "c1", type: "claim.checked", member: "critic", round: 1, claim: "x", verdict: "contradicted", checker: "first-pass", checkedBy: "scripted" },
      { key: "c2", type: "claim.checked", member: "critic", round: 1, claim: "y", verdict: "contradicted", checker: "openai", checkedBy: "gpt-x" },
      { key: "c3", type: "claim.checked", member: "tox", round: 1, claim: "z", verdict: "verified", checker: "claude-code" },
      { key: "d", type: "member.replied", member: "critic", round: 2, text: "Later." },
    ], "board")
    const reply = (key: string) => rows.find((r) => r.id.endsWith(`:${key}`))!
    expect(reply("r1").job).toBe("runs the discussion; does not do the research or decide what is true")
    expect(reply("a")).toMatchObject({ job: "tries to prove the others wrong", wrong: 2 })
    expect(reply("b")).toMatchObject({ job: "method specialist: reads method notes, has no tools and runs nothing" })
    expect(reply("b").wrong).toBeUndefined()
    expect(reply("d").wrong).toBeUndefined() // a check in round 1 does not mark the same member's round 2 reply
    expect(reply("c1")).toMatchObject({ agent: "The quick first check", agentId: "first-pass" })
    expect(reply("c1").text).toContain("Practice run: no model checked it.")
    expect(reply("c2")).toMatchObject({ agent: "The second, careful check", agentId: "openai" })
    expect(reply("c2").text).toContain("Checked by gpt-x.")
    expect(reply("c3").agent).toBe("The second, careful check")
    const sourced = eventRows([
      { key: "f", type: "claim.checked", member: "critic", round: 1, claim: "x", verdict: "verified", checker: "first-pass", source: "analysis.py" },
      { key: "u", type: "claim.checked", member: "critic", round: 1, claim: "y", verdict: "verified", checker: "first-pass", source: "https://example.org/p" },
    ], "board")
    expect(sourced[0].text).toContain("Source: analysis.py.")
    expect(sourced[1].text).not.toContain("Source:")
    expect(sourced[1].sources).toEqual([{ title: "https://example.org/p", url: "https://example.org/p" }])
    expect(rows.every((r) => !r.note || r.job === undefined)).toBe(true)
    expect(eventRows([{ key: "a", type: "member.replied", member: "critic", round: 1, text: "x" }], "answer")[0].job).toBeUndefined()
  })
  it("credits Exa for an old real review's search that recorded no provider, and nobody for a practice one", () => {
    const search = { key: "s", type: "evidence.triaged", member: "scout", query: "q", kept: 1, dropped: 0 }
    const real = eventRows([{ key: "start", type: "run.started", mock: false }, search], "board").find((r) => r.kind === "search")!
    expect(real.provider).toBe("exa")
    expect(real.text).toBe("Searched the web for “q”: kept 1, dropped 0.")
    const practice = eventRows([{ key: "start", type: "run.started", mock: true }, search], "board").find((r) => r.kind === "search")!
    expect(practice.provider).toBeUndefined()
    expect(practice.text).toBe("Searched sources for “q”: kept 1, dropped 0.")
    expect(eventRows([{ key: "start", type: "run.started", mock: false }, { ...search, provider: "europepmc" }], "board").find((r) => r.kind === "search")!.provider).toBe("europepmc")
  })
  it("marks every row of the final round as final, so a filtered log keeps the final heading", () => {
    const rows = eventRows([
      // Real board events carry `at`; without it the log orders rows by kind, not by when they happened.
      { key: "r1", at: 1, type: "round.started", round: 1, message: "Round 1." },
      { key: "m1", at: 2, type: "member.replied", member: "scout", round: 1, text: "a" },
      { key: "r2", at: 3, type: "round.started", round: 2, final: true, message: "Round 2. Final." },
      { key: "m2", at: 4, type: "member.replied", member: "scout", round: 2, text: "b" },
      { key: "c2", at: 5, type: "claim.checked", member: "scout", round: 2, claim: "b", verdict: "verified", checker: "first-pass" },
    ], "board")
    expect(rows.map((r) => r.round)).toEqual([{ n: 1 }, { n: 1 }, { n: 2, final: true }, { n: 2, final: true }, { n: 2, final: true }])
    expect(filterRows(rows, { agent: "scout", kind: "", query: "" }).map((r) => r.round)).toEqual([{ n: 1 }, { n: 2, final: true }])
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
  it("keeps claim transition reasons, call outcomes and failed calls", () => {
    const rows = eventRows([
      { kind: "claim.transition", claim_id: "C1", from: "under_review", to: "sent_back", reason: "A control is missing" },
      { kind: "agent.call", claim_id: "C1", role: "experimenter", mode: "revise", outcome: "ok", attempt: 2, model: "mock", note: "Added the control" },
      { kind: "claim.error", claim_id: "C2", error: "The pilot timed out" },
      { kind: "claim.illegal_transition", claim_id: "C3", from: "triaged", to: "supported", reason: "Review is required" },
      { kind: "agent.call", claim_id: "C2", role: "critic", mode: "review", outcome: "error" },
    ], "swarm")
    expect(rows[0]).toMatchObject({ agentId: "engine", text: "Moved claim C1 from under_review to sent_back. A control is missing" })
    expect(rows[1]).toMatchObject({ agentId: "experimenter", text: "Ended revise call on claim C1. Role: experimenter. Outcome: ok. Attempt: 2. Model: mock. Added the control" })
    expect(rows[2]).toMatchObject({ kind: "error", text: "A call on claim C2 did not finish. The pilot timed out" })
    expect(rows[3].text).toContain("Refused an illegal move of claim C3 from triaged to supported. Review is required")
    expect(rows[4]).toMatchObject({ agentId: "critic", text: "Ended review call on claim C2. Role: critic. Outcome: error." })
    expect(eventRows([], "swarm")).toEqual([])
    const sparse = eventRows([{ kind: "agent.call", attempt: NaN, outcome: null }, { kind: "claim.transition", from: null }], "swarm")
    expect(sparse[0].text).toBe("Ended (mode not recorded) call on claim (id not recorded).")
    expect(sparse[1].text).toBe("Moved claim (id not recorded) from (state not recorded) to (state not recorded).")
  })
  it("preserves swarm issues, test registration, execution and recorded verdict details", () => {
    const rows = eventRows([
      { kind: "issue.raised", issue: "I1", severity: "blocking", problem: "Missing samples", by: "critic" },
      { kind: "issue.resolved", issue: "I1", status: "wontfix", by: "planner" },
      { kind: "test.registered", claim: "C1", name: "Shape check", method: "Compare every column", test_null: "Columns disagree", script_path: "check.py", by: "experimenter" },
      { kind: "test.executed", claim: "C1", name: "Shape check", status: "ok", exit_code: 0, detail: "All columns present", p: 0, contradicts: false },
      { kind: "test.recorded", claim: "C1", name: "Shape check", p: 0.01, contradicts: true, e: 0, verdict_at_the_time: "refuted", by: "harness" },
    ], "swarm")
    expect(rows[0]).toMatchObject({ agentId: "critic", text: "Raised blocking issue I1: Missing samples" })
    expect(rows[1]).toMatchObject({ agentId: "planner", text: "Updated issue I1: wontfix." })
    expect(rows[2].text).toBe("Registered test Shape check for statement C1. Compare every column Null hypothesis: Columns disagree check.py")
    expect(rows[3].text).toBe("Ran test Shape check for statement C1. Status: ok. Exit code: 0. All columns present p = 0. Contradicts the statement: no.")
    expect(rows[4]).toMatchObject({ agentId: "harness", text: "Recorded test Shape check for statement C1. p = 0.01. Contradicts the statement: yes. e = 0. Verdict at the time: refuted." })
    const sparse = eventRows([{ kind: "test.executed", status: "failed", detail: "Script missing", p: null, contradicts: null }, { kind: "issue.raised" }, { kind: "test.recorded", e: NaN }], "swarm")
    expect(sparse[0].text).toContain("Status: failed. Script missing")
    expect(sparse.every((r) => !r.text.includes("p =") && !r.text.includes("e =") && !r.text.includes("Contradicts the statement:"))).toBe(true)
    expect(sparse[1].text).toContain("id not recorded")
  })
  it("says where each test ran: a Modal sandbox with its id, or Docker", () => {
    const rows = eventRows([
      { kind: "test.executed", claim: "C1", name: "Permutation", status: "ok", exit_code: 0, backend: "modal", sandbox_id: "sb-7" },
      { kind: "test.executed", claim: "C2", name: "Row count", status: "timeout", backend: "docker", sandbox_id: null },
      { kind: "test.executed", claim: "C3", name: "Old run", status: "ok" },
    ], "swarm")
    expect(rows[0].text).toBe("Ran test Permutation for statement C1. Ran in a Modal sandbox (sb-7). Status: ok. Exit code: 0.")
    expect(rows[1].text).toBe("Ran test Row count for statement C2. Ran in a Docker sandbox. Status: timeout.")
    expect(rows[2].text).toBe("Ran test Old run for statement C3. Status: ok.")
  })
})
