// The Overview's numbers, pure: the engine's three lists in, work and figures out. Nothing is estimated.
import { describe, expect, it } from "vitest"
import { checksOfAll, countsOf, elapsedOf, firstScope, perAnswer, recent, recentSpend, running, sourcesOf, usdText, workOf } from "./work"

const NOW = new Date(2026, 10, 15, 12, 0, 0), T = NOW.getTime(), HOUR = 3_600_000, DAY = 24 * HOUR

describe("workOf", () => {
  it("merges the three lists, keeps what each line records, and reads a team review's scripted flag from its line", () => {
    const works = workOf(
      [{ id: "b1", brief: "chat-kras-1a2b3c4d.md", status: "running", startedAt: T - HOUR, usd: 1.2, mock: false, members: ["lead-scientist", "scout"], search: { searches: 4 }, checks: { verified: 2, contradicted: 1, unsupported: 0, unchecked: 0 } }],
      { items: [{ id: "a1", thread: "t-1", question: "Q?", status: "running", mode: "real", startedAt: T - 2 * HOUR, workStartedAt: T - HOUR, usd: 0.4, maxUsd: 2, step: { label: "Writing", agent: "writer" }, agents: ["planner", "writer"], searches: 2, sources: { kept: 5, cited: 3 } }] },
      [{ id: "s1", solver: "single", task: "demo", phase: "running", detail: "experiment", model: "mock", modelClass: "scripted", startedAt: T, usd: 99 }],
    )
    expect(works.map((w) => `${w.kind}/${w.id}`)).toEqual(["swarm/s1", "board/b1", "answer/a1"]) // newest first
    const [swarm, board, answer] = works
    expect(board).toMatchObject({ provenance: "live", usd: 1.2, agents: ["lead-scientist", "scout"], searches: 4, checks: { verified: 2, contradicted: 1 } })
    expect(answer).toMatchObject({ provenance: "live", usd: 0.4, maxUsd: 2, step: { label: "Writing", agent: "writer" }, agents: ["planner", "writer"], searches: 2, sources: { kept: 5, cited: 3 }, thread: "t-1" })
    expect(swarm.usd).toBeUndefined() // a benchmark run's line holds no dollars the Overview trusts
    expect(swarm.step).toEqual({ label: "experiment" })
    expect(workOf([{ id: "b2", brief: "x.md", status: "done", startedAt: 1 }], undefined, undefined)[0].provenance).toBeUndefined() // an older engine: not known yet
  })
  it("a list that could not be read counts as empty", () => {
    expect(workOf(undefined, undefined, undefined)).toEqual([])
  })
})

describe("running and recent", () => {
  const works = workOf([], { items: [
    { id: "a1", question: "old running", status: "running", mode: "real", startedAt: T - 2 * HOUR },
    { id: "a2", question: "new running", status: "queued", mode: "real", startedAt: T - HOUR },
    { id: "a3", question: "done", status: "done", mode: "real", startedAt: T - 3 * HOUR },
    { id: "a4", question: "example", status: "done", mode: "demo", startedAt: T, example: true },
  ] }, [])
  it("lists what runs oldest first and what ended newest first, never an example", () => {
    expect(running(works).map((w) => w.id)).toEqual(["a1", "a2"])
    expect(recent(works).map((w) => w.id)).toEqual(["a3"])
  })
  it("counts time from when the work began, up to now or to when it finished", () => {
    expect(elapsedOf({ startedAt: T - HOUR, workStartedAt: T - 60_000 }, T)).toBe(60_000)
    expect(elapsedOf({ startedAt: T - HOUR, finishedAt: T - HOUR + 5_000 }, T)).toBe(5_000)
    expect(elapsedOf({ startedAt: 0 }, T)).toBeUndefined()
  })
})

describe("the figures", () => {
  const works = workOf(
    [{ id: "b1", brief: "x.md", status: "failed", startedAt: T - HOUR, usd: 2, mock: false, members: [], checks: { verified: 1, contradicted: 0, unsupported: 2, unchecked: 0 } }],
    { items: [
      { id: "a1", question: "1", status: "done", mode: "real", startedAt: T - HOUR, usd: 0.5, seconds: 30, searches: 2, sources: { kept: 4, cited: 2 }, checks: { verified: 3, contradicted: 1, unsupported: 0, unchecked: 1 } },
      { id: "a2", question: "2", status: "done", mode: "real", startedAt: T - 10 * DAY, usd: 1.5, seconds: 90 },
      { id: "a3", question: "3", status: "done", mode: "demo", startedAt: T - HOUR, usd: 0, seconds: 1, searches: 1, sources: { kept: 2, cited: 2 } },
      { id: "a4", question: "4", status: "cancelled", mode: "real", startedAt: T - HOUR, usd: 0.1 },
    ] },
    [],
  )
  it("counts runs of one scope by how they ended, never research and practice together", () => {
    expect(countsOf(works, "research")).toEqual({ done: 2, running: 0, failed: 1, stopped: 1 }) // a1, a2; b1 failed; a4 cancelled
    expect(countsOf(works, "practice")).toEqual({ done: 1, running: 0, failed: 0, stopped: 0 }) // the Demo answer a3
  })
  it("adds the dollars research runs started in the last 7 days recorded, never practice; none recorded is not $0", () => {
    expect(recentSpend(works, 7, NOW)).toEqual({ usd: 2.6, runs: 3 }) // b1, a1, a4: the practice a3 is not counted
    expect(recentSpend(works.filter((w) => w.id === "a3"), 7, NOW)).toBeUndefined()
    expect(recentSpend([], 7, NOW)).toBeUndefined()
  })
  it("averages time and cost over finished answers of one scope only", () => {
    expect(perAnswer(works, "research")).toEqual({ answers: 2, seconds: 60, usd: 1, timed: 2, priced: 2 })
    expect(perAnswer(works, "practice")).toMatchObject({ answers: 1, seconds: 1, usd: 0 })
    expect(perAnswer([], "research")).toMatchObject({ answers: 0, seconds: undefined, usd: undefined })
  })
  it("counts searches, sources and checks from the lines that recorded them", () => {
    expect(sourcesOf(works, "research")).toEqual({ searches: 2, kept: 4, cited: 2, from: 1, answers: 1 })
    expect(checksOfAll(works, "research")).toEqual({ passed: 4, failed: 3, unchecked: 1, total: 8 })
    expect(checksOfAll(works, "practice").total).toBe(0)
  })
  it("starts on research when there is any, else on practice", () => {
    expect(firstScope(works)).toBe("research")
    expect(firstScope(works.filter((w) => w.provenance === "practice"))).toBe("practice")
    expect(firstScope([])).toBe("research")
  })
  it("writes dollars plainly and says when none were recorded", () => {
    expect(usdText(undefined)).toBe("Not recorded")
    expect(usdText(0.004)).toBe("< $0.01")
    expect(usdText(1.234)).toBe("$1.23")
  })
})
