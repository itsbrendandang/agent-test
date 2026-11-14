import { describe, expect, it } from "vitest"
import { paidState } from "./paid"
import { runState, STATE_KIND, type RunState } from "./status"

describe("runState", () => {
  it("calls every phase before the end 'running', except the queue", () => {
    expect(runState("launching")).toBe("running")
    expect(runState("running")).toBe("running")
    expect(runState("completing")).toBe("running")
    expect(runState("queued")).toBe("queued")
  })
  it("keeps failed, cancelled and paused as they are", () => {
    expect(runState("failed")).toBe("failed")
    expect(runState("cancelled")).toBe("cancelled")
    expect(runState("paused")).toBe("paused")
  })
  it("calls a finished run without a score 'not graded'", () => {
    expect(runState("done")).toBe("done")
    expect(runState("done", true)).toBe("done")
    expect(runState("done", false)).toBe("not graded")
  })
  it("does not let a missing score change a run that failed or was cancelled", () => {
    expect(runState("failed", false)).toBe("failed")
    expect(runState("cancelled", false)).toBe("cancelled")
  })
})

describe("STATE_KIND", () => {
  it("gives cancelled a neutral colour, apart from failed", () => {
    expect(STATE_KIND.cancelled).toBe("neutral")
    expect(STATE_KIND.failed).toBe("danger")
    expect(STATE_KIND.cancelled).not.toBe(STATE_KIND.failed)
  })
  it("has a colour for every state", () => {
    const states: RunState[] = ["queued", "running", "done", "failed", "cancelled", "not graded", "paused"]
    for (const s of states) expect(STATE_KIND[s]).toBeTruthy()
  })
})

describe("paidState", () => {
  it("reads the engine's switch", () => {
    expect(paidState({ paidCalls: false })).toBe("off")
    expect(paidState({ paidCalls: true })).toBe("on")
  })
  it("does not guess when the engine did not say", () => {
    expect(paidState(undefined)).toBe("unknown")
    expect(paidState({})).toBe("unknown")
    expect(paidState({ paidCalls: "false" })).toBe("unknown")
  })
})
