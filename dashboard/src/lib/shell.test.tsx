import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { NextRun } from "@/components/PaidSwitch"
import { TooltipProvider } from "@/components/ui/tooltip"
import { byConcern, boardFacts, outcomeOf } from "./verdict"

describe("the one mode selector, in the header", () => {
  it.each([["off", "Demo"], ["on", "Real"]] as const)("the engine's state %s shows as %s chosen", (paid, chosen) => {
    render(<TooltipProvider><NextRun paid={paid} /></TooltipProvider>)
    const group = screen.getByRole("radiogroup", { name: "Next run: Demo or Real" })
    expect(group).toHaveAttribute("data-state", paid)
    expect(screen.getByRole("radio", { name: chosen })).toBeChecked()
    expect(screen.getByRole("radio", { name: chosen === "Demo" ? "Real" : "Demo" })).not.toBeChecked()
  })
  it("an engine that did not say shows neither as chosen, and nothing can be pressed", () => {
    render(<TooltipProvider><NextRun paid="unknown" /></TooltipProvider>)
    for (const name of ["Demo", "Real"]) { expect(screen.getByRole("radio", { name })).not.toBeChecked(); expect(screen.getByRole("radio", { name })).toBeDisabled() }
    expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription("Not known: the engine did not say.")
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
