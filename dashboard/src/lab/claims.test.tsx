// The fourth source: a swarm run on the claims engine. The fixture is a real run folder of the scripted model.
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { LabEvent } from "./adapter"
import { claimsLab, claimsOrder, claimsTimeline } from "./claims"
import { CLAIMS_BOARD, CLAIMS_EVENTS, CLAIMS_NOTES, CLAIMS_RUN_JSON } from "./fixtures/claims"
import { Lab } from "./Lab"
import { CHARACTER_IDS, type CharacterId, type LabModel } from "./model"

const RUN = { id: "c-1", solver: "glhf", model: "mock", task: "demo", phase: "done", startedAt: Math.round(CLAIMS_RUN_JSON.started_at * 1000) }
const NOTES = { events: CLAIMS_NOTES }
const upToSeq = (seq: number) => CLAIMS_EVENTS.filter((e) => (e.seq as number) <= seq)
const claim = (m: LabModel, id: string) => m.claims!.find((c) => c.id === id)!
const states = (m: LabModel) => Object.fromEntries(CHARACTER_IDS.map((id) => [id, m.characters[id].inRun ? m.characters[id].state : "not in run"]))
const trips = (m: LabModel, id: CharacterId) => m.characters[id].trips
const live = (events: LabEvent[], more: Partial<Parameters<typeof claimsLab>[0]> = {}) => claimsLab({ run: { ...RUN, phase: "running" }, events, ...more })

describe("a claims-engine run (claimsLab)", () => {
  it("maps each actor to its character, by the engine's own names", () => {
    const m = claimsLab({ run: RUN, board: CLAIMS_BOARD, events: CLAIMS_EVENTS, notes: NOTES })
    expect(CHARACTER_IDS.filter((id) => !m.characters[id].inRun)).toEqual(["librarian"])
    expect([m.characters.proposer.label, m.characters.navigator.label, m.characters.guardian.label]).toEqual(["Planner", "Engine", "Test runner"])
    expect(m.characters.navigator.standsFor).toMatch(/it alone moves a claim/)
    expect(m.characters.pilot.standsFor).toMatch(/pilot call/)
    expect(m.characters.reviser.standsFor).toMatch(/revise call/)
    expect(m.characters.guardian.standsFor).toMatch(/relevance judge and the test runner/)
  })

  it("syncs from the board snapshot: each claim's state, reason, budget, attempts and errors", () => {
    const m = claimsLab({ run: RUN, board: CLAIMS_BOARD, events: CLAIMS_EVENTS, notes: NOTES })
    expect(m.claims!.map((c) => [c.id, c.acuity, c.state, c.room])).toEqual([["C1", "high", "supported", "report"], ["C2", "low", "rejected", "quality"]])
    expect(claim(m, "C1").reason).toBe("the ledger supports the claim and no issue is open")
    expect(claim(m, "C2").reason).toBe("dead on arrival: pilot outputs fail the shape check (gene_counts)")
    expect(claim(m, "C1").attempts).toEqual({ pilot: 1, workup: 1, revise: 1, "audit 1": 1, "critique 1": 1, "audit 2": 1, "critique 2": 1 })
    expect(claim(m, "C1").budget.secondsSpent).toBeCloseTo(1.19, 2)
    expect(claim(m, "C1").activity).toBe("Closed. Nothing more is done on it.")
    expect(m.status).toBe("done")
    expect(m.needsSync).toBeUndefined()
  })

  it("builds the same claims from the events alone when there is no snapshot (a replay)", () => {
    const fromBoard = claimsLab({ run: RUN, board: CLAIMS_BOARD, events: CLAIMS_EVENTS, notes: NOTES })
    const fromEvents = claimsLab({ run: RUN, events: CLAIMS_EVENTS, notes: NOTES })
    expect(fromEvents.claims!.map((c) => [c.id, c.state, c.reason, c.attempts])).toEqual(fromBoard.claims!.map((c) => [c.id, c.state, c.reason, c.attempts]))
    expect(claim(fromEvents, "C1").budget.secondsSpent).toBeCloseTo(claim(fromBoard, "C1").budget.secondsSpent, 2)
  })

  it("applies only the events after the snapshot, in order, and asks for the snapshot again on a gap", () => {
    // a snapshot taken at seq 13 (C1 in workup, C2 rejected), then the events up to seq 16
    const early = claimsLab({ run: RUN, events: upToSeq(13) })
    const board13 = { run_id: CLAIMS_BOARD.run_id, seq: 13, claims: early.claims!.map((c) => ({ id: c.id, text: c.text, acuity: c.acuity, state: c.state, budget: { tokens_spent: 0, seconds_spent: 0 }, attempts: c.attempts, errors: [], history: [{ reason: c.reason, at: 1 }] })) }
    const next = live(upToSeq(16), { board: board13 })
    expect(claim(next, "C1").state).toBe("under_review")
    expect(claim(next, "C1").attempts.workup).toBe(1)
    expect(next.needsSync).toBeUndefined()
    // seq 15 never arrived: nothing after the gap is applied, and the reader is told to sync
    const gap = live(upToSeq(16).filter((e) => e.seq !== 15), { board: board13 })
    expect(gap.needsSync).toBe(true)
    expect(claim(gap, "C1").state).toBe("in_workup")
    expect(claim(gap, "C1").attempts.workup).toBeUndefined()
    // an event the snapshot already holds changes no claim (it is history only), also when it arrives twice
    const again = live([...upToSeq(16), ...upToSeq(10)], { board: board13 })
    expect(again.claims).toEqual(next.claims)
    // events that start after seq 1 with no snapshot cannot be stood on
    expect(live(CLAIMS_EVENTS.filter((e) => (e.seq as number) > 5)).needsSync).toBe(true)
  })

  it("counts only the events of the snapshot's run when an older run left lines in the same file", () => {
    const old: LabEvent[] = [{ seq: 1, ts: 1, run_id: "demo-1", kind: "claim.added", claim_id: "X9", by: "planner", acuity: "low", text: "from an older run" }, { seq: 2, ts: 2, run_id: "demo-1", kind: "claim.transition", claim_id: "X9", from: "triaged", to: "rejected", reason: "old" }]
    const m = claimsLab({ run: RUN, board: CLAIMS_BOARD, events: [...old, ...CLAIMS_EVENTS], notes: NOTES })
    expect(m.claims!.map((c) => c.id)).toEqual(["C1", "C2"])
    expect(m.log.some((l) => l.text.includes("X9"))).toBe(false)
    expect(claimsOrder([...old, ...CLAIMS_EVENTS]).runId).toBe(CLAIMS_BOARD.run_id) // without a snapshot: the newest event's run
    expect(claimsOrder([...CLAIMS_EVENTS, { kind: "claim.added" }, { seq: 3 }, null as unknown as LabEvent]).events).toHaveLength(34) // half-written or shapeless lines are skipped
  })

  it("carries a claim when the Engine moves it to another room, with the move's reason as the explanation", () => {
    const m = live(upToSeq(16), { notes: NOTES })
    const moves = trips(m, "navigator").filter((t) => t.kind === "carry")
    expect(moves.map((t) => [t.claim, t.from, t.room])).toEqual([["C1", "planning", "bench"], ["C2", "planning", "bench"], ["C2", "bench", "quality"], ["C1", "bench", "review"]])
    expect(moves[2].label).toBe("claim C2 from Piloting to Rejected: dead on arrival: pilot outputs fail the shape check (gene_counts)")
    // a move inside one room (piloting to workup at the bench) changes the card's words and needs no walk
    expect(m.log.some((l) => l.text === "Engine moved claim C1 from Piloting to In workup: pilot outputs pass the shape check")).toBe(true)
    expect(claim(m, "C1")).toMatchObject({ state: "under_review", room: "review", reason: "artifacts pass the shape check" })
    expect(claim(m, "C2")).toMatchObject({ state: "rejected", room: "quality" })
    expect(m.log.find((l) => l.text.includes("to ✕ Rejected"))?.tone).toBe("bad")
  })

  it("never shows a specific agent working when the engine has not said so", () => {
    // C1 is under review after seq 16; no audit or critique call has ended yet
    const m = live(upToSeq(16), { notes: NOTES })
    expect(claim(m, "C1").activity).toBe("Being worked on or waiting. The engine reports a call when it ends, not when it starts.")
    for (const id of ["auditor", "critic"] as const) {
      expect(m.characters[id].state).toBe("idle")
      expect(m.characters[id].doing).toBe("Nothing reported yet for claim C1: it is under review, being worked on or waiting. A call is reported when it ends.")
    }
    expect(CHARACTER_IDS.filter((id) => m.characters[id].state === "working")).toEqual(["navigator"]) // the Engine's loop, which the flags event started
    expect(m.status).toBe("running") // a silence is not a failure
    expect(CHARACTER_IDS.some((id) => m.characters[id].state === "failed")).toBe(false)
    // in workup after the pilot: the Experimenter may be at work, and is not drawn as working
    const workup = live(upToSeq(13), { notes: NOTES })
    expect(workup.characters.experimenter).toMatchObject({ state: "idle" })
    expect(workup.characters.experimenter.doing).toMatch(/claim C1: it is in workup, being worked on or waiting/)
  })

  it("shows the pilot call as running, the one start the engine's order makes known", () => {
    const m = live(upToSeq(7), { notes: NOTES })
    expect(m.characters.pilot).toMatchObject({ state: "working" })
    expect(m.characters.pilot.doing).toMatch(/Pilot call on 2 claims \(C1, C2\): a pilot starts right after the claim is moved to piloting/)
    expect(claim(m, "C1").activity).toMatch(/^Its pilot call is running/)
    const after = live(upToSeq(9), { notes: NOTES }) // C2's pilot call ended
    expect(after.characters.pilot.doing).toMatch(/Pilot call on 1 claim \(C1\)/)
  })

  it("hands a finished call to the Engine, and keeps a call that did not succeed on its teammate", () => {
    const m = live(upToSeq(12), { notes: NOTES })
    expect(trips(m, "pilot").filter((t) => t.kind === "handoff").map((t) => [t.to, t.label])).toEqual([["navigator", "its pilot result on claim C2 for the Engine"], ["navigator", "its pilot result on claim C1 for the Engine"]])
    expect(m.log.some((l) => l.text === "Pilot: finished its pilot call on claim C1: ok. pilot outputs shaped on a subsample")).toBe(true)
    const failed = live([...upToSeq(13), { seq: 14, ts: 1794711370.5, run_id: CLAIMS_BOARD.run_id, kind: "claim.error", claim_id: "C1", error: "workup attempt 1: error TimeoutError" }, { seq: 15, ts: 1794711370.6, run_id: CLAIMS_BOARD.run_id, kind: "agent.call", claim_id: "C1", role: "experimenter", mode: "workup", model: "mockllm/model", outcome: "error", attempt: 1, note: "" }])
    expect(failed.characters.experimenter).toMatchObject({ state: "failed", problem: { text: "Ended its workup call on claim C1: error." } })
    expect(claim(failed, "C1").errors).toEqual(["workup attempt 1: error TimeoutError"])
    expect(failed.status).toBe("running") // the engine tries again if budget is left; the run has not failed
  })

  it("places the ledger's notes where they belong: Scout and Planner before the claims, a round's tests before its decision, the report last", () => {
    const steps = claimsTimeline(CLAIMS_EVENTS, CLAIMS_NOTES)
    expect(steps).toHaveLength(CLAIMS_EVENTS.length + CLAIMS_NOTES.length)
    const order = steps.map((s) => (s.event ? `e${s.event.seq}` : `n:${s.note!.kind}${s.note!.phase ? `:${s.note!.phase}` : ""}`))
    const at = (name: string) => order.indexOf(name)
    expect(at("n:scout.code")).toBeLessThan(at("e1"))
    expect(at("n:phase.started:propose")).toBeLessThan(at("e1"))
    expect(at("n:phase.finished:propose")).toBeGreaterThan(at("e2")); expect(at("n:phase.finished:propose")).toBeLessThan(at("e4"))
    expect(at("n:issue.raised")).toBeLessThan(at("e21")) // raised before the move that names it
    expect(at("n:test.executed")).toBeLessThan(at("e31")); expect(at("n:test.executed")).toBeGreaterThan(at("e26")) // round 2's test before round 2's decision
    expect(at("n:phase.started:report")).toBeGreaterThan(at("e34"))
    expect(steps.every((s, i) => i === 0 || s.at >= steps[i - 1].at)).toBe(true)
    const m = claimsLab({ run: RUN, events: CLAIMS_EVENTS, notes: NOTES })
    expect(m.roughTimes).toBe(true)
    expect(m.characters.scout).toMatchObject({ state: "done", doing: "Looked at the data: 2 files, 0 problems." })
    expect(trips(m, "guardian").map((t) => [t.room, t.label])).toEqual([["review", "the result of the test “label permutation” for claim C1: ok"]])
    expect(m.characters.reporter.state).toBe("done")
    expect(m.characters.finisher.doing).toBe("Copied 2 required outputs from the best claims.")
    // without the ledger those actors are not guessed at
    const bare = claimsLab({ run: RUN, events: CLAIMS_EVENTS })
    expect([bare.characters.scout.doing, bare.characters.reporter.doing]).toEqual(["Had nothing to do in this run.", "Had nothing to do in this run."])
  })

  it("says which model ran, that a scripted run is practice, and which switches were off", () => {
    const m = claimsLab({ run: RUN, board: CLAIMS_BOARD, events: CLAIMS_EVENTS, notes: NOTES })
    expect(m.provenance).toBe("practice")
    expect(m.labels).toEqual(["Model: mockllm/model", "Practice: scripted run, not a benchmark result", "All four switches on (Critic, Auditor, pilot, re-triage)"])
    const ablated = CLAIMS_EVENTS.map((e) => (e.kind === "flags" ? { ...e, critic: false, retriage: false } : e.kind === "agent.call" ? { ...e, model: "anthropic/claude-sonnet-5-5" } : e))
    const real = claimsLab({ run: { ...RUN, model: "anthropic/claude-sonnet-5-5" }, events: ablated, notes: NOTES })
    expect(real.labels).toEqual(["Model: anthropic/claude-sonnet-5-5", "Switched off for this run: the Critic, re-triage"])
    expect(real.provenance).toBe("live")
    expect(states(real).critic).toBe("not in run")
    expect(real.characters.critic.standsFor).toMatch(/Switched off for this run\.$/)
  })

  it("shows no grade, no ideal answer and no judge's reply, whatever the files hold", () => {
    const spiked = { events: [...CLAIMS_NOTES.map((n) => (n.kind === "test.relevance" ? { ...n, reason: "JUDGE-REPLY-TEXT", score: 0.93 } : n)), { kind: "grade", score: 0.875, ideal: "IDEAL-ANSWER-TEXT", grader_notes: "GRADER-NOTE-TEXT" }] }
    const m = claimsLab({ run: { ...RUN, score: 0.875 } as never, board: { ...CLAIMS_BOARD, grade: { score: 0.875 }, ideal: "IDEAL-ANSWER-TEXT" } as never, events: [...CLAIMS_EVENTS, { seq: 35, ts: 1794711373, run_id: CLAIMS_BOARD.run_id, kind: "grade.written", score: 0.875, ideal: "IDEAL-ANSWER-TEXT" }], notes: spiked })
    const everything = JSON.stringify(m)
    for (const secret of ["JUDGE-REPLY-TEXT", "IDEAL-ANSWER-TEXT", "GRADER-NOTE-TEXT", "0.875", "0.93"]) expect(everything).not.toContain(secret)
    expect(m.log.some((l) => l.text === "The test “label permutation” for claim C1 was judged relevant.")).toBe(true)
  })

  it("ends the run from the tracker's record: done, failed with the failure on whoever was working, or cancelled", () => {
    const failed = claimsLab({ run: { ...RUN, phase: "failed", error: "the local runner stopped\nmore" }, events: upToSeq(7), notes: NOTES })
    expect(failed.status).toBe("failed")
    expect(failed.characters.pilot.state).toBe("failed")
    expect(claim(failed, "C1").activity).toBe("The run ended while it was open.")
    const cancelled = claimsLab({ run: { ...RUN, phase: "cancelled" }, events: upToSeq(16), notes: NOTES })
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.characters.navigator.state).toBe("cancelled")
    expect(claimsLab({ run: { ...RUN, phase: "queued", detail: "waiting for s-1" }, events: [] })).toMatchObject({ status: "waiting", note: "waiting for s-1", claims: [] })
    // a replay that has not reached the end is a run still going
    const steps = claimsTimeline(CLAIMS_EVENTS, CLAIMS_NOTES).length
    expect(claimsLab({ run: RUN, events: CLAIMS_EVENTS, notes: NOTES }, { upTo: 20 }).status).toBe("running")
    expect(claimsLab({ run: RUN, events: CLAIMS_EVENTS, notes: NOTES }, { upTo: steps }).status).toBe("done")
  })
})

describe("a claims-engine run in the scene and the panel", () => {
  const scene = (m: LabModel) => { vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); return render(<Lab model={m} clock={(m.at ?? 0) + 3_600_000} />) }

  it("shows each claim as a card in the room of its state, with the state in words", () => {
    scene(live(upToSeq(16), { notes: NOTES }))
    const review = screen.getByRole("list", { name: "Claims in Evidence review" }), shelf = screen.getByRole("list", { name: "Claims in Quality control" })
    expect(within(review).getByRole("listitem")).toHaveTextContent("C1 Under review")
    expect(within(shelf).getByRole("listitem")).toHaveTextContent("C2 ✕ Rejected")
    expect(within(shelf).getByRole("listitem")).toHaveAttribute("title", expect.stringContaining("Why it is here: dead on arrival: pilot outputs fail the shape check (gene_counts)"))
    for (const room of ["Discovery", "Planning", "Experiment bench", "Report studio"]) expect(within(screen.getByRole("list", { name: `Claims in ${room}` })).queryAllByRole("listitem")).toHaveLength(0)
    expect(screen.getByRole("button", { name: /^Inspect Engine: Working/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Inspect Planner:/ })).toBeInTheDocument()
  })

  it("lists every claim in the side panel: id, text, acuity, state, why, budget, calls and errors", () => {
    scene(claimsLab({ run: RUN, board: CLAIMS_BOARD, events: CLAIMS_EVENTS, notes: NOTES }))
    const list = screen.getByRole("list", { name: "Claims of this run" })
    const [c1, c2] = within(list).getAllByRole("listitem")
    expect(c1).toHaveTextContent("C1 ✓ Supported")
    expect(c1).toHaveTextContent("acuity high")
    expect(c1).toHaveTextContent("Every required output is derived from all listed samples.")
    expect(c1).toHaveTextContent("Why it is here: the ledger supports the claim and no issue is open")
    expect(c1).toHaveTextContent("Budget: 0 tokens spent (no token budget set); 1.2 seconds of calls.")
    expect(c1).toHaveTextContent("Calls: pilot, workup, revise, audit 1, critique 1, audit 2, critique 2.")
    expect(c2).toHaveTextContent("C2 ✕ Rejected")
    expect(c2).toHaveTextContent("acuity low")
    expect(screen.getByText("Practice: scripted run, not a benchmark result")).toBeInTheDocument()
    expect(screen.getByText("Model: mockllm/model")).toBeInTheDocument()
  })

  it("shows a claim's errors and a second attempt", () => {
    const board = { ...CLAIMS_BOARD, claims: [{ ...CLAIMS_BOARD.claims[0], state: "not_established", attempts: { pilot: 2 }, errors: ["pilot attempt 1: error TimeoutError"] }] }
    scene(claimsLab({ run: RUN, board, events: [] }))
    const item = within(screen.getByRole("list", { name: "Claims of this run" })).getByRole("listitem")
    expect(item).toHaveTextContent("C1 ? Not established")
    expect(item).toHaveTextContent("Calls: pilot ×2.")
    expect(item).toHaveTextContent("✕ 1 error: pilot attempt 1: error TimeoutError")
  })
})
