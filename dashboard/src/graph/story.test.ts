import { describe, expect, it } from "vitest"
import type { BoardEvent } from "@/board/api"
import { BOARD_EVENTS, PRACTICE_EVENTS, ROSTER, SINGLE_DETAIL, SWARM_DETAIL } from "./fixtures"
import { buildBoardGraph, buildSwarmGraph, statsOf } from "./model"
import { headline, verdictParts } from "./story"

const board = (events: BoardEvent[] = BOARD_EVENTS) => buildBoardGraph({ runId: "r1", events, roster: ROSTER })
const said = (g: ReturnType<typeof board>, partial = false) => headline(g, g.totals, partial)

describe("the headline says what happened, from the run's own counts", () => {
  it("board: members, claims and each verdict by its own name", () => {
    expect(said(board())).toBe("Over 2 rounds, 4 team members made 5 statements: 2 held up, 1 was proven wrong, 2 had too little evidence.")
  })
  it("swarm: roles, claims, not-established counted together, problems fixed and open", () => {
    expect(said(buildSwarmGraph(SWARM_DETAIL) as never)).toBe("3 roles made 3 statements: 1 held up, 1 was proven wrong, 1 had too little evidence. The reviewers found 2 problems: 1 fixed, 1 still open.")
  })
  it("a board run with no claims says so plainly", () => {
    const g = board(BOARD_EVENTS.filter((e) => e.type !== "claim.checked"))
    expect(g.totals.claims).toBe(0)
    expect(said(g)).toBe("Over 2 rounds, 3 team members took part, but no statements were recorded, so there is nothing to check.")
  })
  it("a swarm run with no claims says so plainly", () => {
    const l = SWARM_DETAIL.ledger!
    const g = buildSwarmGraph({ ...SWARM_DETAIL, ledger: { ...l, claims: [], issues: [], events: [...l.events.filter((e) => e.kind.startsWith("phase")), { kind: "issue.raised", issue: "I1", severity: "minor", problem: "p", by: "critic" }] } })
    expect(said(g as never)).toMatch(/^1 role worked on this run, but made no statements, so nothing was tested\. The reviewers found 1 problem: 0 fixed, 1 still open\.$/)
  })
  it("a single agent has no claims and the grader's score is the result", () => {
    expect(said(buildSwarmGraph(SINGLE_DETAIL) as never)).toBe("One agent worked alone, so there are no statements to check. It produced 1 required output, and the grader scored them 1.000.")
  })
  it("an empty run is not described as having an outcome", () => {
    expect(said(board([]))).toBe("Nothing has been recorded for this run yet.")
    expect(said(board(BOARD_EVENTS.slice(0, 1)))).toBe("Nothing has been recorded for this run yet.")
  })
  it("a run in progress, or a replay part of the way, says 'so far'", () => {
    const g = board()
    expect(said(g, true)).toMatch(/^So far, over 2 rounds, 4 team members made 5 statements/)
    const early = headline(g, statsOf(g.nodes.filter((n) => n.order <= g.marks[1].order - 1)), true)
    expect(early).toMatch(/^So far, over 1 round, 4 team members made 5 statements/)
  })
  it("uses singular words for one", () => {
    const one = board(BOARD_EVENTS.filter((e) => e.type !== "claim.checked" || e.member === "proposer"))
    expect(said(one)).toMatch(/made 1 statement: 1 held up\.$/)
  })
  it("counts a verdict word it does not know as not enough evidence, never as a success", () => {
    expect(verdictParts({ holds: 1, fails: 0, unknown: 2 })).toBe("1 held up, 2 had too little evidence")
    const g = board([{ type: "claim.checked", round: 1, member: "x", claim: "c", kind: "literature", verdict: "mystery", checker: "first-pass", key: "c", at: 2 } as never])
    expect(said(g)).toMatch(/1 had too little evidence\.$/)
  })
  it("describes the current practice run: two members, two distinct claims, none checked against a source", () => {
    const g = board(PRACTICE_EVENTS)
    expect(g.nodes.filter((n) => n.kind === "claim")).toHaveLength(2) // four rulings, two claims carried into round 2
    expect(said(g)).toBe("Over 2 rounds, 2 team members made 2 statements: 2 had too little evidence.")
    expect(g.scripted).toBe(true)
    expect(g.links.every((l) => g.nodes.some((n) => n.id === l.source) && g.nodes.some((n) => n.id === l.target))).toBe(true)
  })
})

describe("the replay's sentences come only from recorded events", () => {
  const g = board()
  const sorted = [...BOARD_EVENTS].sort((a, b) => a.at - b.at)
  const NAMES = ["Lead Scientist", "Scout (Data Inspector)", "Proposer (Research Planner)", "Critic"]
  const INVENTED = /replied to|responds? to|answers?\b|challeng|disagree|rebut|argu(es|ed)|in response|criticis|agreed/i

  it("has one sentence per event, in order, and every node it names exists", () => {
    expect(g.steps).toHaveLength(BOARD_EVENTS.length)
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const s of g.steps) for (const id of s.nodes) expect(ids.has(id), id).toBe(true)
  })
  it("never says who replied to whom, because the data does not record it", () => {
    for (const s of g.steps) expect(s.label).not.toMatch(INVENTED)
    for (const s of buildSwarmGraph(SWARM_DETAIL).steps) expect(s.label).not.toMatch(INVENTED)
    const replies = sorted.map((e, i) => ({ e, s: g.steps[i] })).filter((x) => x.e.type === "member.replied")
    expect(replies).toHaveLength(3)
    for (const { e, s } of replies) {
      if (e.type !== "member.replied") continue
      // only the member who spoke is named: no other member of the board appears in the sentence outside their own quoted words
      const who = ROSTER.find((m) => m.name === e.member)!.title
      const outside = s.label.replace(/“[^”]*”/, "")
      for (const other of NAMES.filter((n) => n !== who)) expect(outside).not.toContain(other)
      expect(outside).toContain(who)
      expect(s.nodes).toEqual([`agent:${e.member}`, `phase:${e.round}`])
    }
  })
  it("names the two things a ruling really links: who said the statement and who checked it", () => {
    sorted.forEach((e, i) => {
      if (e.type !== "claim.checked") return
      const s = g.steps[i]
      expect(s.label).toMatch(/it (held up|was proven wrong|had too little evidence)\.$/)
      expect(s.label).toContain(ROSTER.find((m) => m.name === e.member)!.title)
      expect(s.nodes).toHaveLength(3)
      expect(s.nodes[0]).toBe(`agent:${e.member}`)
    })
  })
  it("quotes only what the event carried, cut to length", () => {
    const long = BOARD_EVENTS.map((e) => (e.type === "member.replied" ? { ...e, text: "A".repeat(400) } : e))
    for (const s of board(long).steps) expect(s.label.length).toBeLessThan(330)
  })
  it("tells a swarm in the roles' own words and says what each event recorded", () => {
    const s = buildSwarmGraph(SWARM_DETAIL)
    const labels = s.steps.map((x) => x.label)
    expect(labels).toContain("planner said (statement C1): “Every required output is derived from all listed samples.”")
    expect(labels.some((l) => /^Proposer starts: plans the analysis/.test(l))).toBe(true)
    expect(labels).toContain("Pilot does not run (plan).")
    expect(labels.some((l) => l.includes("ran the test “row count”") && l.includes("it went against the statement"))).toBe(true)
    expect(labels.some((l) => l.includes("ran the test “label permutation”") && l.includes("it did not go against the statement"))).toBe(true)
    expect(labels).toContain("experimenter fixed problem I1.")
    expect(labels.some((l) => l.startsWith("Critic · review round 1 ends, out of budget"))).toBe(true)
  })
  it("gives a ledger event it has no sentence for its own name, and invents nothing", () => {
    const l = SWARM_DETAIL.ledger!
    const s = buildSwarmGraph({ ...SWARM_DETAIL, ledger: { ...l, events: [...l.events, { kind: "memory.recalled", source: "x" }] } })
    expect(s.steps.at(-1)!.label).toBe("memory recalled was recorded.")
  })
})

describe("the replay of a long run stays short", () => {
  it("steps several events at a time for a long run, and one at a time for a short one", async () => {
    const { stepsPerTick, replaySeconds, stepMs } = await import("./story")
    expect(stepsPerTick(20)).toBe(1)
    expect(stepsPerTick(750)).toBe(8)
    expect(replaySeconds(750)).toBeLessThanOrEqual(40)
    expect(replaySeconds(57)).toBe(Math.round((57 * stepMs(57)) / 1000))
  })
})
