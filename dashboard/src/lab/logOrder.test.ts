import { expect, it } from "vitest"
import { swarmLogEvents } from "./logRows"
import { CLAIMS_BOARD, CLAIMS_EVENTS, CLAIMS_NOTES } from "./fixtures/claims"

it("merges timestamped notes and sequenced claims, retaining ties and excluding other runs", () => {
  const events = [
    { kind: "claim.transition", run_id: "r", seq: 2, ts: 20, claim_id: "C1" },
    { kind: "claim.added", run_id: "r", seq: 1, ts: 10, claim_id: "C1" },
    { kind: "claim.added", run_id: "other", seq: 3, ts: 30 },
  ]
  const note = { kind: "phase.started", phase: "workup", ts: 15 }
  expect(swarmLogEvents(events, [note], [], "r").map((e) => e.kind)).toEqual(["claim.added", "phase.started", "claim.transition"])
  expect(swarmLogEvents([events[0], events[0]], [], [], "r")).toEqual([events[0]])
  expect(swarmLogEvents([], [])).toEqual([])
  expect(swarmLogEvents([{ kind: "bad", seq: NaN }], [{ kind: "unknown" }])).toEqual([{ kind: "unknown" }])
})

it("anchors untimed ledger phases before claims and reporting after output assembly", () => {
  const merged = swarmLogEvents([...CLAIMS_EVENTS].reverse(), CLAIMS_NOTES, [], String(CLAIMS_BOARD.run_id))
  const at = (kind: string, phase?: string) => merged.findIndex((e) => e.kind === kind && (!phase || e.phase === phase))
  expect(at("phase.started", "propose")).toBeLessThan(at("claim.added"))
  expect(at("phase.finished", "propose")).toBeLessThan(at("flags"))
  expect(at("phase.started", "report")).toBeGreaterThan(at("engine.finished"))
  expect(merged.filter((e) => typeof e.seq === "number").map((e) => e.seq)).toEqual(CLAIMS_EVENTS.map((e) => e.seq))
})
