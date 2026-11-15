import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { StatusLine } from "@/components/StatusLine"
import type { Shell } from "./shell"
import { byConcern, boardFacts, outcomeOf } from "./verdict"

describe("StatusLine", () => {
  it.each([
    [{ engine: "online", paid: "off" }, "Engine online", "Practice runs. Fixed example answers. Free."],
    [{ engine: "online", paid: "on" }, "Engine online", "Real AI models and web search. Costs money."],
    [{ engine: "offline", paid: "unknown" }, "Engine not running", "Not known: the engine did not say."],
    [{ engine: "unknown", paid: "unknown" }, "Engine: checking", "Not known: the engine did not say."],
  ] as const)("says in plain words what the engine can do: %j", (shell, engine, mode) => {
    render(<StatusLine shell={shell as Shell} onOpenSettings={() => {}} />)
    const line = screen.getByRole("group", { name: "Status" })
    expect(line).toHaveTextContent("AI Scientist Bot")
    expect(line).toHaveTextContent(engine)
    expect(line).toHaveTextContent(mode)
  })
  it("links to Settings", async () => {
    const onOpenSettings = vi.fn()
    render(<StatusLine shell={{ engine: "online", paid: "off" }} onOpenSettings={onOpenSettings} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Settings" }))
    expect(onOpenSettings).toHaveBeenCalled()
  })
})

describe("one verdict vocabulary", () => {
  it("maps both sets of words onto holds, fails and unknown", () => {
    expect((["verified", "supported"] as const).map(outcomeOf)).toEqual(["holds", "holds"])
    expect((["contradicted", "refuted"] as const).map(outcomeOf)).toEqual(["fails", "fails"])
    expect((["unsupported", "unchecked", "insufficient", "untested"] as const).map(outcomeOf)).toEqual(["unknown", "unknown", "unknown", "unknown"])
  })
  it("puts what does not hold first, then what is not known, keeping the order within each", () => {
    const claims = [{ id: 1, verdict: "supported" }, { id: 2, verdict: "untested" }, { id: 3, verdict: "refuted" }, { id: 4, verdict: "insufficient" }, { id: 5, verdict: "refuted" }] as const
    expect(byConcern([...claims]).map((c) => c.id)).toEqual([3, 5, 2, 4, 1])
  })
  it("reads a board review's facts from its own events", () => {
    const ev = (e: object, i: number) => ({ key: String(i), at: i, ...e }) as never
    const f = boardFacts([
      { type: "run.started", runId: "r", brief: "b", title: "KRAS", mock: true }, { type: "round.started", round: 1, message: "", final: false },
      { type: "evidence.triaged", member: "m", query: "q", kept: 2, dropped: 0, items: [{ url: "u1", title: "t" }, { url: "u2", title: "t" }] },
      { type: "claim.checked", round: 1, member: "m", claim: "a", kind: "k", verdict: "verified", checker: "jev" },
      { type: "claim.checked", round: 1, member: "m", claim: "b", kind: "k", verdict: "contradicted", checker: "jev" },
      { type: "memo.written", path: "p", decision: "Go" }, { type: "run.finished", usd: 0, minutes: 1 },
    ].map(ev))
    expect(f).toMatchObject({ verified: 1, contradicted: 1, unsupported: 0, unchecked: 0, sources: 2, rounds: 1, scripted: true, title: "KRAS", decision: "Go", state: "done" })
    expect(boardFacts([]).scripted).toBeUndefined()
    expect(boardFacts([ev({ type: "run.failed", error: "x" }, 0)]).state).toBe("failed")
  })
})
