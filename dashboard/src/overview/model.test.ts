// The Overview's counting rules: practice is never research and an unread run is claimed as neither.
import { describe, expect, it } from "vitest"
import type { RunRef } from "@/lab/runs"
import { dayName, madeOf, totalsOf } from "./model"

const NOW = new Date(2026, 10, 14, 21, 0) // 14 Nov 2026, 9 pm local
const at = (daysAgo: number, hour = 12) => new Date(2026, 10, 14 - daysAgo, hour).getTime()
const run = (kind: RunRef["kind"], provenance: RunRef["provenance"], startedAt: number, more: Partial<RunRef> = {}): RunRef =>
  ({ kind, id: `${kind}-${startedAt}-${provenance}`, title: "t", startedAt, live: false, status: "finished", provenance, ...more })

const RUNS: RunRef[] = [
  run("answer", "live", at(0)), run("answer", "practice", at(0, 9)), run("answer", "practice", at(1)),
  run("board", "live", at(1, 23)), run("board", undefined, at(2)), run("board", "practice", at(13, 0)),
  run("swarm", "practice", at(0), { live: true, status: "in progress" }), run("swarm", "local", at(3), { status: "failed" }),
  run("swarm", "live", at(14)),
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

describe("day names", () => {
  it("names today, yesterday and older dates in local time", () => {
    expect([dayName(at(0), NOW), dayName(at(1, 23), NOW), dayName(at(5), NOW), dayName(new Date(2025, 0, 3).getTime(), NOW)]).toEqual(["Today", "Yesterday", "9 Nov", "3 Jan 2025"])
  })
})
