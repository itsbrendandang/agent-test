import { describe, expect, it } from "vitest"
import { chatItems, splitMessage, SAY_MAX } from "./chat"
import { eventRows, type EventRow } from "./logRows"
import { CLAIMS_EVENTS } from "./fixtures/claims"

const row = (id: string, agentId: string, note = false): EventRow => ({ id, agentId, agent: agentId, kind: "write", text: id, sources: [], ...(note ? { note } : {}) })

describe("group chat thread", () => {
  it("keeps a short message whole and puts longer reasoning behind the short line", () => {
    expect(splitMessage("  Short reply.  ")).toEqual({ say: "Short reply." })
    expect(splitMessage("Plan: pilot first.\nThe subset is cheap and shows the shape.")).toEqual({ say: "Plan: pilot first.", more: "The subset is cheap and shows the shape." })
    const long = `Registered test Shape check for statement C1. ${"Compare every column against the brief ".repeat(6)}end.`
    const { say, more } = splitMessage(long)
    expect(say).toBe("Registered test Shape check for statement C1.")
    expect(`${say} ${more}`).toBe(long)
    const words = "word ".repeat(60).trim()
    const cut = splitMessage(words)
    expect(cut.say.endsWith("…")).toBe(true)
    expect(cut.say.length).toBeLessThanOrEqual(SAY_MAX + 1)
    expect(cut.more?.startsWith("…")).toBe(true)
    expect(splitMessage("")).toEqual({ say: "" })
  })

  it("groups consecutive messages from the same agent and lets notes end a run", () => {
    const items = chatItems([row("a", "planner"), row("b", "planner"), row("c", "critic"), row("n", "engine", true), row("d", "critic"), row("e", "planner")])
    expect(items.map((i) => [i.row.id, i.first, i.last])).toEqual([
      ["a", true, false], ["b", false, true], ["c", true, true], ["n", false, false], ["d", true, true], ["e", true, true],
    ])
    expect(chatItems([])).toEqual([])
  })

  it("draws a round line where a team review's round begins, and a new round starts a new run of messages", () => {
    const rows = eventRows([
      { key: "r1", at: 1, type: "round.started", round: 1, message: "Round 1. State your position.", final: false },
      { key: "a", at: 2, type: "member.replied", member: "scout", round: 1, text: "In short: the data is complete.\nTwelve samples." },
      { key: "s", at: 3, type: "evidence.triaged", member: "scout", provider: "exa", query: "q", kept: 1, dropped: 0 },
      { key: "c", at: 4, type: "claim.checked", member: "scout", round: 1, claim: "Twelve samples", verdict: "contradicted", checker: "first-pass" },
      { key: "r2", at: 5, type: "round.started", round: 2, message: "", final: true },
      { key: "b", at: 6, type: "member.replied", member: "lead-scientist", round: 2, text: "We stop here." },
    ], "board")
    const items = chatItems(rows)
    expect(items.map((i) => i.round)).toEqual([{ n: 1 }, undefined, undefined, undefined, { n: 2, final: true }, undefined])
    // The lead opens round 2 and replies in it: one run. The lead's last message of round 1 would not join it.
    expect(items.slice(4).map((i) => [i.first, i.last])).toEqual([[true, false], [false, true]])
    expect(chatItems([{ ...row("x", "lead-scientist"), round: { n: 1 } }, { ...row("y", "lead-scientist"), round: { n: 2 } }]).map((i) => [i.first, i.last])).toEqual([[true, true], [true, true]])
    // What each row says: the lead's own words without the "Round 1." prefix, the reply's one line first, the check as a quiet note with its mark.
    expect(rows[0]).toMatchObject({ agentId: "lead-scientist", text: "State your position.", thought: true })
    expect(rows[1]).toMatchObject({ agentId: "scout", text: "the data is complete.\nTwelve samples.", thought: true })
    expect(rows[2]).toMatchObject({ note: true, provider: "exa", text: "Searched the web for “q”: kept 1, dropped 0." })
    expect(rows[3]).toMatchObject({ note: true, kind: "check", mark: "contradicted", agentId: "first-pass" })
    expect(rows[3].text).toMatch(/^Contradicted: .*'s statement “Twelve samples”\.$/)
    expect(rows[4]).toMatchObject({ text: "Started round 2.", round: { n: 2, final: true } })
  })

  it("marks tool calls, searches and system steps as notes, and agents' turns as messages", () => {
    const rows = eventRows(CLAIMS_EVENTS, "swarm")
    const of = (kind: string) => rows.filter((r) => CLAIMS_EVENTS[Number(r.id.split(":")[0])]?.kind === kind)
    expect(of("claim.added").every((r) => !r.note && r.agentId === "planner")).toBe(true)
    expect(of("agent.call").every((r) => !r.note)).toBe(true)
    expect(of("claim.transition").every((r) => r.note)).toBe(true)
    expect(of("budget.spent").every((r) => r.note)).toBe(true)
    const board = eventRows([
      { key: "s", type: "evidence.triaged", member: "scout", provider: "fixture", kept: 1, dropped: 0 },
      { key: "r", type: "member.replied", member: "scout", round: 1, text: "Two trials agree." },
    ], "board")
    expect(board.map((r) => !!r.note)).toEqual([true, false])
  })

  it("labels only reasoning as thinking and keeps an answer draft's markdown out of the short line", () => {
    const rows = eventRows([
      { key: "r", type: "member.replied", member: "scout", round: 1, text: "Two trials agree." },
      { key: "w", type: "answer.written", markdown: "## Answer\nSemaglutide lowers the risk." },
      { key: "t", type: "test.registered", agent: "planner", name: "Shape", claim: "C1", method: "Compare columns." },
      { key: "s", type: "selection", criteria: "Kept relevant results.", selected: [{ n: 1, why: "On topic." }] },
      { key: "c", type: "agent.call", agent: "experimenter", mode: "pilot", claim_id: "C2", outcome: "error", note: "RuntimeError: the pilot script stopped." },
    ], "answer")
    expect(rows.map((r) => !!r.thought)).toEqual([true, false, false, false, false])
    expect(splitMessage(rows[1].text)).toEqual({ say: "Wrote the draft.", more: "## Answer\nSemaglutide lowers the risk." })
  })
})
