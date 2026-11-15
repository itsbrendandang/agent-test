import { describe, expect, it } from "vitest"
import { chatItems, splitThought, SAY_MAX } from "./chat"
import { eventRows, type EventRow } from "./logRows"
import { CLAIMS_EVENTS } from "./fixtures/claims"

const row = (id: string, agentId: string, note = false): EventRow => ({ id, agentId, agent: agentId, kind: "write", text: id, sources: [], ...(note ? { note } : {}) })

describe("group chat thread", () => {
  it("keeps a short message whole and puts longer reasoning behind the short line", () => {
    expect(splitThought("  Short reply.  ")).toEqual({ say: "Short reply." })
    expect(splitThought("Plan: pilot first.\nThe subset is cheap and shows the shape.")).toEqual({ say: "Plan: pilot first.", thinking: "The subset is cheap and shows the shape." })
    const long = `Registered test Shape check for statement C1. ${"Compare every column against the brief ".repeat(6)}end.`
    const { say, thinking } = splitThought(long)
    expect(say).toBe("Registered test Shape check for statement C1.")
    expect(`${say} ${thinking}`).toBe(long)
    const words = "word ".repeat(60).trim()
    const cut = splitThought(words)
    expect(cut.say.endsWith("…")).toBe(true)
    expect(cut.say.length).toBeLessThanOrEqual(SAY_MAX + 1)
    expect(cut.thinking?.startsWith("…")).toBe(true)
    expect(splitThought("")).toEqual({ say: "" })
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
})
