// Replaying a finished run: which events have happened at a moment of the replay, at real or even pacing; and which
// run the Lab shows.
import { describe, expect, it } from "vitest"
import { EVEN_GAP_MS, SHORT_RUN_MS, countAt, defaultPace, lengthOf, timelineOf } from "./replay"
import { answerRuns, boardRuns, mergeRuns, pickRun, runOfLabHash, swarmRuns } from "./runs"

describe("replay timing", () => {
  const t = timelineOf([1000, 1000, 1500, undefined, 4000, 3000, 9000])

  it("keeps the real distances between events, holds a time that goes backwards, and gives a missing one the time before it", () => {
    expect(t.offsets).toEqual([0, 0, 500, 500, 3000, 3000, 8000])
    expect(t.realMs).toBe(8000)
    expect(timelineOf([])).toEqual({ offsets: [], realMs: 0 })
  })

  it("at real timing shows exactly the events that had happened by then", () => {
    expect([0, 499, 500, 2999, 3000, 7999, 8000, 99_999].map((p) => countAt(t, "real", p))).toEqual([2, 2, 4, 4, 6, 6, 7, 7])
    expect(lengthOf(t, "real")).toBe(8000)
    expect(countAt(timelineOf([]), "real", 5)).toBe(0)
  })

  it("at even pacing shows one more event each gap, whatever the real times were", () => {
    expect([0, EVEN_GAP_MS - 1, EVEN_GAP_MS, EVEN_GAP_MS * 3, EVEN_GAP_MS * 6, EVEN_GAP_MS * 60].map((p) => countAt(t, "even", p))).toEqual([1, 1, 2, 4, 7, 7])
    expect(lengthOf(t, "even")).toBe(6 * EVEN_GAP_MS)
  })

  it("opens a run that was over in a blink evenly paced, and a longer one at its real timing", () => {
    expect(defaultPace(timelineOf([0, 13]))).toBe("even")
    expect(defaultPace(timelineOf([0, SHORT_RUN_MS - 1]))).toBe("even")
    expect(defaultPace(timelineOf([0, SHORT_RUN_MS]))).toBe("real")
    expect(defaultPace(timelineOf([0, 479_000]))).toBe("real")
  })
})

describe("which run the Lab shows", () => {
  const board = boardRuns([{ id: "b-old", brief: "kras-g12c-hit-to-lead.md", startedAt: 100, status: "done" }, { id: "b-live", brief: "chat-should-we-advance-04bb17d2.md", startedAt: 300, status: "running" }, { id: "b-paused", brief: "x.md", startedAt: 50, status: "paused" }, { brief: "no id" }])
  const answers = answerRuns({ items: [{ id: "a-1", question: "Is this a question?", mode: "demo", status: "done", startedAt: 400 }, { id: "a-2", question: "Waiting?", mode: "real", status: "queued", startedAt: 350 }] })
  const swarm = swarmRuns([{ id: "s-1", solver: "glhf", task: "demo", model: "mock", phase: "done", startedAt: 200 }, { id: "s-2", solver: "single", task: "demo", model: "ollama/qwen2.5:14b", phase: "cancelled", startedAt: 150 }])

  it("reads the three lists, with each run's provenance from its own record", () => {
    expect(board.map((r) => [r.id, r.title, r.live, r.status, r.provenance])).toEqual([["b-old", "Kras g12c hit to lead", false, "finished", undefined], ["b-live", "Should we advance", true, "in progress", undefined], ["b-paused", "X", false, "paused", undefined]])
    expect(answers.map((r) => [r.id, r.live, r.status, r.provenance])).toEqual([["a-1", false, "finished", "practice"], ["a-2", true, "waiting", "live"]])
    expect(swarm.map((r) => [r.title, r.live, r.status, r.provenance])).toEqual([["Team of nine on the demo task", false, "finished", "practice"], ["One agent alone on the demo task", false, "cancelled", "local"]])
    expect(boardRuns("broken")).toEqual([]); expect(answerRuns(undefined)).toEqual([]); expect(swarmRuns({})).toEqual([])
  })

  it("picks the newest run in progress over all three kinds, else the newest run", () => {
    const all = mergeRuns(board, answers, swarm)
    expect(all.map((r) => r.id)).toEqual(["a-1", "a-2", "b-live", "s-1", "s-2", "b-old", "b-paused"])
    expect(pickRun(all)?.id).toBe("a-2")
    expect(pickRun(all.filter((r) => !r.live))?.id).toBe("a-1")
    expect(pickRun([])).toBeUndefined()
  })

  it("reads a run from the address and nothing else", () => {
    expect(runOfLabHash("#Lab/board/202611150251-kras-g12c-hit-to-lead")).toEqual({ kind: "board", id: "202611150251-kras-g12c-hit-to-lead" })
    expect(runOfLabHash("#Lab/answer/a-1")).toEqual({ kind: "answer", id: "a-1" })
    for (const bad of ["#Lab", "#Lab/board/", "#Lab/other/x", "#Lab/board/../../etc", "#Lab/board/a b", "#Board/x", "#Lab/board/%E0%A4%A"]) expect(runOfLabHash(bad)).toBeUndefined()
  })
})
