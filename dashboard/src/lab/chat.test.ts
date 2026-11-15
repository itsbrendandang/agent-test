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
