// The Overview's counting rules: practice is never research, an unread run is claimed as neither, and the chart
// has one bar a day in the person's own time zone.
import { describe, expect, it } from "vitest"
import type { RunRef } from "@/lab/runs"
import { activityOf, dayName, madeOf, niceTop, perDay, totalsOf } from "./model"

const NOW = new Date(2026, 10, 14, 21, 0) // 14 Nov 2026, 9 pm local
const at = (daysAgo: number, hour = 12) => new Date(2026, 10, 14 - daysAgo, hour).getTime()
const run = (kind: RunRef["kind"], provenance: RunRef["provenance"], startedAt: number, more: Partial<RunRef> = {}): RunRef =>
  ({ kind, id: `${kind}-${startedAt}-${provenance}`, title: "t", startedAt, live: false, status: "finished", provenance, ...more })

const RUNS: RunRef[] = [
  run("answer", "live", at(0)), run("answer", "practice", at(0, 9)), run("answer", "practice", at(1)),
  run("board", "live", at(1, 23)), run("board", undefined, at(2)), run("board", "practice", at(13, 0)),
  run("swarm", "practice", at(0), { live: true, status: "in progress" }), run("swarm", "local", at(3), { status: "failed" }),
  run("swarm", "live", at(14)), // older than the chart's window
  run("answer", "practice", 0), // no start time
]

describe("what counts as research", () => {
  it("is only a run whose own record says real or local models; practice and unread runs are apart", () => {
    expect(madeOf({ provenance: "live" })).toBe("research")
    expect(madeOf({ provenance: "local" })).toBe("research")
    expect(madeOf({ provenance: "practice" })).toBe("practice")
    expect(madeOf({ provenance: undefined })).toBe("unknown")
    const totals = totalsOf(RUNS)
    expect([totals.all, totals.research, totals.practice, totals.unknown]).toEqual([10, 4, 5, 1])
    expect(totals.research + totals.practice + totals.unknown).toBe(totals.all)
    expect([totals.inProgress, totals.failed]).toEqual([1, 1])
    expect(totals.byKind).toEqual({
      answer: { all: 4, research: 1, practice: 3 },
      board: { all: 3, research: 1, practice: 1 }, // the unread review is in "all" and in neither column
      swarm: { all: 3, research: 2, practice: 1 },
    })
    expect(totalsOf([])).toMatchObject({ all: 0, research: 0, practice: 0, inProgress: 0 })
  })
})

describe("runs per day", () => {
  it("has one entry a day, oldest first, ending today, and leaves out what is older or has no start time", () => {
    const days = perDay(RUNS, 14, NOW)
    expect(days).toHaveLength(14)
    expect([days[0].label, days[13].label]).toEqual(["1 Nov", "14 Nov"])
    const today = days[13], yesterday = days[12]
    expect([today.research, today.practice, today.unknown, today.total]).toEqual([1, 2, 0, 3])
    expect([yesterday.research, yesterday.practice, yesterday.total]).toEqual([1, 1, 2]) // 11 pm still counts for that day
    expect([days[11].unknown, days[11].total]).toEqual([1, 1])
    expect(days[10].research).toBe(1)
    expect(days[0].practice).toBe(1) // midnight, 13 days ago: inside the window
    expect(days.reduce((n, d) => n + d.total, 0)).toBe(8) // not the 14-day-old run, not the one with no time
    expect(perDay([], 7, NOW).every((d) => d.total === 0)).toBe(true)
  })
  it("scales the chart to a round number at or above the tallest bar", () => {
    expect([0, 1, 2, 3, 5, 7, 10, 11, 37, 50, 120].map(niceTop)).toEqual([1, 1, 2, 5, 5, 10, 10, 20, 50, 50, 200])
  })
})

describe("the activity log", () => {
  it("groups the newest runs by day and says who did what", () => {
    expect([dayName(at(0), NOW), dayName(at(1, 23), NOW), dayName(at(5), NOW), dayName(new Date(2025, 0, 3).getTime(), NOW)]).toEqual(["Today", "Yesterday", "9 Nov", "3 Jan 2025"])
    const runs: RunRef[] = [
      run("answer", "practice", at(0, 9), { title: "Is it safe?" }),
      run("swarm", "practice", at(0, 8), { title: "Team of nine on the demo task", live: true, status: "in progress" }),
      run("swarm", "live", at(1), { title: "One agent alone on task 9", status: "failed" }),
      run("board", "live", at(1, 8), { title: "Kras hit to lead" }),
      run("answer", "practice", 0, { title: "no time" }),
    ]
    const log = activityOf(runs, 8, NOW)
    expect(log.map((g) => [g.day, g.entries.length])).toEqual([["Today", 2], ["Yesterday", 2]])
    expect(log[0].entries.map((e) => [e.actor, e.verb, e.object, e.time])).toEqual([["Reporter", "wrote an answer to", "Is it safe?", "9:00 am"], ["Team of nine", "is working on", "the demo task", "8:00 am"]])
    expect(log[1].entries.map((e) => [e.agent, e.actor, e.verb, e.object, e.failed])).toEqual([["experimenter", "One agent", "failed on", "task 9", true], ["lead-scientist", "Lead Scientist", "led a team review of", "Kras hit to lead", false]])
    expect(activityOf(runs, 1, NOW)[0].entries).toHaveLength(1)
  })
})
