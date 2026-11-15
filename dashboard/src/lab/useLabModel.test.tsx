// Reading a run for the lab: each event once, and the engine's own example streams through the adapter.
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { answerLab, type LabEvent } from "./adapter"
import { ENGINE_CANCELLED, ENGINE_DEMO, ENGINE_FAILED_SOURCE, ENGINE_HYPOTHESES, ENGINE_HYPOTHESES_DEMO, ENGINE_REAL } from "./fixtures/engine-streams"
import { REAL_ANSWER } from "./fixtures/streams"
import { Lab } from "./Lab"
import { CHARACTER_IDS } from "./model"
import { eventId, mergeEvent, useLabModel } from "./useLabModel"

describe("mergeEvent", () => {
  it("keeps one copy of an answer's event by seq, and lets a team review's later event replace the one with the same key", () => {
    const a = { seq: 1, type: "x" }, b = { seq: 2, type: "y" }
    expect(mergeEvent("answer", [a, b], { seq: 2, type: "y" })).toEqual([a, b])
    expect(mergeEvent("answer", [a], b)).toEqual([a, b])
    const k1 = { key: "claim:1", type: "claim.checked", verdict: "unchecked" }, k2 = { key: "round:1", type: "round.started" }
    expect(mergeEvent("board", [k1, k2], { ...k1, verdict: "verified" })).toEqual([k2, { ...k1, verdict: "verified" }])
    expect(mergeEvent("board", [k1], { type: "no key" })).toHaveLength(2)
    expect(eventId("board", { seq: 5 })).toBeUndefined()
  })
})

class FakeSource {
  static last: FakeSource
  onmessage: ((m: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  closed = false
  url: string
  constructor(url: string) { this.url = url; FakeSource.last = this }
  close() { this.closed = true }
}

function Embedded({ id }: { id: string }) {
  const { model, connection } = useLabModel("answer", id)
  return <><p data-testid="connection">{connection}</p><Lab model={model} compact /></>
}

describe("useLabModel", () => {
  it("gives another view the lab of a run in progress, and closes the stream when that view goes away or the run ends", () => {
    vi.stubGlobal("EventSource", FakeSource)
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1))
    const { unmount } = render(<Embedded id="a-1" />)
    const source = FakeSource.last
    expect(source.url).toMatch(/\/api\/research\/a-1\/events$/)
    expect(screen.getByTestId("connection")).toHaveTextContent("connecting")
    act(() => { source.onopen?.(); for (const e of REAL_ANSWER.slice(0, 5)) source.onmessage?.({ data: JSON.stringify(e) }); source.onmessage?.({ data: "{not json" }) })
    expect(screen.getByTestId("connection")).toHaveTextContent("live")
    expect(screen.getByRole("button", { name: /^Inspect Scout: Fetching\. Searching the web/ })).toBeInTheDocument()
    act(() => { for (const e of REAL_ANSWER.slice(5)) source.onmessage?.({ data: JSON.stringify(e) }) })
    expect(screen.getByTestId("connection")).toHaveTextContent("ended")
    expect(source.closed).toBe(true)
    expect(screen.getByText("Run finished")).toBeInTheDocument()
    unmount()
  })

  it("shows an empty lab where the browser cannot open a stream", () => {
    vi.stubGlobal("EventSource", undefined)
    render(<Embedded id="a-1" />)
    expect(screen.getByTestId("connection")).toHaveTextContent("offline")
    expect(screen.getByText("Waiting to start")).toBeInTheDocument()
  })
})

// The engine's own example streams, copied into fixtures/engine-streams.ts.
const STREAMS: Record<string, LabEvent[]> = { "stream-real.jsonl": ENGINE_REAL, "stream-failed-source.jsonl": ENGINE_FAILED_SOURCE, "stream-cancelled.jsonl": ENGINE_CANCELLED, "stream-demo.jsonl": ENGINE_DEMO }
const stream = (name: string): LabEvent[] => STREAMS[name]
describe("the engine's example answer streams", () => {
  const working = (events: LabEvent[]) => CHARACTER_IDS.filter((id) => ["working", "fetching"].includes(answerLab(events).characters[id].state))

  it("a standard answer: every step lands on a teammate and nobody is left working at the end", () => {
    const events = stream("stream-real.jsonl"), m = answerLab(events)
    expect(m.status).toBe("done")
    expect(m.provenance).toBe("live")
    expect(working(events)).toEqual([])
    for (const id of ["navigator", "scout", "librarian", "auditor", "reporter", "guardian", "critic", "finisher"] as const) expect(m.characters[id].state, id).toBe("done")
    expect(m.characters.scout.trips.find((t) => t.kind === "fetch")).toMatchObject({ room: "discovery", outcome: "carried", provider: "exa" })
    expect(m.characters.librarian.trips.filter((t) => t.kind === "fetch").length).toBeGreaterThanOrEqual(3) // the overlapping literature and database searches
    expect(m.characters.guardian.trips.filter((t) => t.id.startsWith("check:")).every((t) => t.room === "review")).toBe(true)
    expect(m.searches?.exa).toBe(1)
    // at every prefix the model can be built, and no step is ever attributed to someone outside an answer
    for (let n = 0; n <= events.length; n++) expect(["experimenter", "pilot"].some((id) => answerLab(events.slice(0, n)).characters[id as "pilot"].inRun)).toBe(false)
  })

  it("an answer with failed and empty searches still finishes, and the failures stay on their teammates", () => {
    const m = answerLab(stream("stream-failed-source.jsonl"))
    expect(m.status).toBe("done")
    expect(m.characters.scout.problem?.text).toMatch(/did not work/)
    expect(m.characters.librarian.problem?.text).toMatch(/did not work/)
    expect(m.characters.librarian.trips.some((t) => t.outcome === "empty")).toBe(true)
    expect(m.log.filter((l) => l.tone === "bad").length).toBeGreaterThanOrEqual(2)
  })

  it("a cancelled answer sends everyone back to their desks", () => {
    const m = answerLab(stream("stream-cancelled.jsonl"))
    expect(m.status).toBe("cancelled")
    expect(CHARACTER_IDS.filter((id) => m.characters[id].inRun).every((id) => m.characters[id].state === "cancelled")).toBe(true)
    expect(CHARACTER_IDS.flatMap((id) => m.characters[id].trips).every((t) => t.kind !== "fetch" || t.back !== undefined)).toBe(true)
  })

  it("a Standard answer with hypotheses: three investigators work at once, each on its own hypothesis, and the Guardian carries each result to its investigator", () => {
    const m = answerLab(ENGINE_HYPOTHESES)
    expect(m.status).toBe("done")
    expect(working(ENGINE_HYPOTHESES)).toEqual([])
    // the three teammates that search and screen play the three investigators, and are captioned so
    expect([m.characters.scout.label, m.characters.librarian.label, m.characters.auditor.label]).toEqual(["Investigator 1", "Investigator 2", "Investigator 3"])
    expect(m.characters.scout.standsFor).toMatch(/Investigator 1 of this answer: it does all the work on one hypothesis \(h1\)/)
    for (const id of ["scout", "librarian", "auditor"] as const) {
      expect(m.characters[id].state, id).toBe("done")
      expect(m.characters[id].trips.some((t) => t.kind === "fetch" && t.provider === "exa"), id).toBe(true) // each made its own web search
    }
    expect(m.searches?.exa).toBe(3)
    // each section goes to the Reporter, who compares the hypotheses
    expect(m.log.filter((l) => /gave its section on h[123] to the Reporter\.$/.test(l.text))).toHaveLength(3)
    expect(m.log.some((l) => /^Investigator \d gave .* to the Investigator/.test(l.text))).toBe(false) // no work passes between investigators
    const results = m.characters.guardian.trips.filter((t) => t.id.startsWith("hypothesis:"))
    expect(results.map((t) => [t.kind, t.to, t.room])).toEqual([["handoff", "scout", "discovery"], ["handoff", "librarian", "discovery"], ["handoff", "auditor", "review"]])
    for (const t of results) expect(t.label).toMatch(/^the result for hypothesis h[123]: (✓ Supported|✕ Contradicted|\? Insufficient evidence|○ Not checked)(: the sources disagree)? \(\d+ sources? for, \d+ against\)$/)
    expect(m.log.some((l) => l.text === "3 hypotheses set up. Tested against published sources, not by experiment.")).toBe(true)
    // twice in the run all three are busy at once: with their first searches, and with their sections
    const at = (step: string) => answerLab(ENGINE_HYPOTHESES.filter((e) => (e.seq as number) <= (ENGINE_HYPOTHESES.find((x) => x.type === "step.started" && x.step === step)!.seq as number)))
    expect(["scout", "librarian", "auditor"].map((id) => at("search:exa:3").characters[id as "scout"].state)).toEqual(["fetching", "fetching", "fetching"])
    expect(["scout", "librarian", "auditor"].map((id) => at("write:h3").characters[id as "scout"].state)).toEqual(["working", "working", "working"])
    expect(at("write:h3").characters.scout.doing).toMatch(/^Drafting the section for H1/)
  })

  it("a practice answer with hypotheses says its results are examples", () => {
    const m = answerLab(ENGINE_HYPOTHESES_DEMO)
    expect(m).toMatchObject({ status: "done", provenance: "practice" })
    const results = m.characters.guardian.trips.filter((t) => t.id.startsWith("hypothesis:"))
    expect(results).toHaveLength(2)
    for (const t of results) { expect(t.label).toMatch(/Example result: /); expect(t.label).not.toMatch(/[✓✕?○]/) }
  })

  it("the practice answer is Practice", () => {
    const m = answerLab(stream("stream-demo.jsonl"))
    expect(m).toMatchObject({ status: "done", provenance: "practice" })
  })
})
