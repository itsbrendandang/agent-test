import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ModeIndicator } from "@/components/PaidSwitch"
import { byConcern, boardFacts, outcomeOf } from "./verdict"

describe("the one status indicator", () => {
  it.each([["off", "Demo mode", "Demo"], ["on", "Real mode", "Real"], ["unknown", "Mode not known", "?"]] as const)("says %s as '%s', small", (paid, name, chip) => {
    render(<ModeIndicator paid={paid} short />)
    const button = screen.getByRole("button", { name })
    expect(button).toHaveTextContent(chip)
    expect(button).toHaveAttribute("data-state", paid)
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
