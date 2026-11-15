// The Lab view against a stand-in engine: which run it shows, live or as a labelled replay, each run's own
// provenance, the picker, reconnecting without counting an event twice, and that it only ever reads.
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CLAIMS_BOARD, CLAIMS_EVENTS, CLAIMS_NOTES } from "@/lab/fixtures/claims"
import { PRACTICE_ANSWER, PRACTICE_REVIEW } from "@/lab/fixtures/practice"
import { REAL_ANSWER, REVIEW_WITH_VISITOR, SWARM_NOTES, SWARM_RUN, T0 } from "@/lab/fixtures/streams"
import type { LabEvent } from "@/lab/adapter"
import { forgetScripted } from "@/lib/scripted"
import { routes } from "@/test/engine"
import { LabView } from "./LabView"

/** A stand-in for the browser's EventSource: the test decides what arrives and when the stream breaks. */
class FakeSource {
  static all: FakeSource[] = []
  onmessage: ((m: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  closed = false
  url: string
  constructor(url: string) { this.url = url; FakeSource.all.push(this) }
  close() { this.closed = true }
  send(...events: LabEvent[]) { for (const e of events) this.onmessage?.({ data: JSON.stringify(e) }) }
  fail() { this.onerror?.() }
  static to(part: string) { return FakeSource.all.filter((s) => s.url.includes(part)) }
}
const ok = (body: unknown) => ({ status: 200, body })
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const emit = (source: FakeSource, ...events: LabEvent[]) => act(async () => { source.onopen?.(); source.send(...events); await vi.advanceTimersByTimeAsync(0) })
const agent = (name: string) => screen.getByRole("button", { name: new RegExp(`^Inspect ${name}:`) })

const DONE_REVIEW = { id: "r-practice", brief: "kras-g12c-hit-to-lead.md", startedAt: T0 - 60_000, status: "done", rounds: 3, claims: 13 }
const LIVE_REVIEW = { id: "r-live", brief: "placeholder.md", startedAt: T0, status: "running", rounds: 0, claims: 0 }
const DONE_ANSWER = { id: "a-practice", question: "Is hERG a risk for KRAS G12C inhibitors?", mode: "demo", status: "done", startedAt: T0 - 30_000 }
const engine = (lists: { board?: unknown[]; answers?: unknown[]; swarm?: unknown[] }, more: Parameters<typeof routes>[0] = {}) =>
  routes({ "GET /api/runs": ok(lists.board ?? []), "GET /api/research": ok({ items: lists.answers ?? [] }), "GET /api/glhf/runs": ok(lists.swarm ?? []), ...more })

beforeEach(() => {
  FakeSource.all = []
  forgetScripted()
  window.location.hash = "#Lab"
  vi.useFakeTimers()
  vi.setSystemTime(T0 + 1000)
  vi.stubGlobal("EventSource", FakeSource)
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1))
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { vi.useRealTimers(); window.location.hash = "" })

describe("LabView", () => {
  it("shows the run in progress, live, from its own event stream", async () => {
    engine({ board: [DONE_REVIEW, LIVE_REVIEW], answers: [DONE_ANSWER] })
    render(<LabView />)
    await tick(0)
    const stream = FakeSource.to("/api/runs/r-live/events")
    expect(stream).toHaveLength(1)
    expect(FakeSource.to("a-practice")).toHaveLength(0) // the finished answer is not opened
    await emit(stream[0], ...REVIEW_WITH_VISITOR.slice(0, 4))
    expect(screen.getByText("Live: this run is in progress")).toBeInTheDocument()
    expect(screen.queryByText("Replay of a finished run")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Placeholder review question" })).toBeInTheDocument()
    expect(screen.getByText("Team review")).toBeInTheDocument()
    expect(document.querySelector('[data-provenance="live"]')).toHaveTextContent("Live research") // run.started said mock: false
    expect(agent("Scout")).toHaveAttribute("data-state", "working")
    expect(agent("Lead Scientist")).toHaveAttribute("data-state", "working")
    const entries = within(screen.getByRole("log")).getAllByRole("listitem").map((li) => li.textContent ?? "")
    expect(entries.some((t) => /^Scout searched the web \(Exa\).* and brought back \d+ results?/.test(t) && t.includes("placeholder web query"))).toBe(true)
    expect(screen.getAllByText(/Search powered by/).length).toBeGreaterThan(0) // credited because the run's own event says provider exa
  })

  it("stays on a run it showed live when that run ends, and offers the replay instead of starting it", async () => {
    const sent = engine({ board: [LIVE_REVIEW] }, { "GET /api/runs": [ok([LIVE_REVIEW]), ok([{ ...LIVE_REVIEW, status: "done" }, { ...DONE_REVIEW, startedAt: T0 + 500 }])] })
    render(<LabView />)
    await tick(0)
    const stream = FakeSource.to("/api/runs/r-live/events")[0]
    await emit(stream, ...REVIEW_WITH_VISITOR)
    await tick(2500) // the list is read again: the run has ended and a newer finished run exists
    expect(screen.getByText("This run has ended")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Placeholder review question" })).toBeInTheDocument()
    expect(stream.closed).toBe(true) // its last event arrived
    fireEvent.click(screen.getByRole("button", { name: "Replay it" }))
    expect(screen.getByText("Replay of a finished run")).toBeInTheDocument()
    expect(sent.every((s) => s.method === "GET")).toBe(true)
  })

  it("offers the newest finished run as a replay, clearly labelled, with the run's own provenance", async () => {
    engine({ board: [DONE_REVIEW], answers: [DONE_ANSWER] })
    render(<LabView />)
    await tick(0)
    await emit(FakeSource.to("/api/research/a-practice/events")[0], ...PRACTICE_ANSWER)
    const replay = screen.getByRole("group", { name: "Replay" })
    expect(within(replay).getByText("Replay of a finished run")).toBeInTheDocument()
    expect(document.querySelector('[data-provenance="practice"]')).toHaveTextContent("Practice") // mode demo, from the record
    expect(screen.getByText("Research answer")).toBeInTheDocument()
    // a run that was over in milliseconds is played one event at a time, and the view says so
    expect(screen.getByText("Replay, slowed down so you can follow it.")).toBeInTheDocument()
    expect(within(replay).getByRole("button", { name: "Step by step" })).toHaveAttribute("aria-pressed", "true")
    expect(within(replay).getByText("Event 1 of 41")).toBeInTheDocument()
    expect(agent("Navigator")).toHaveAttribute("data-state", "idle") // the replay starts before anyone worked
    await tick(2200)
    expect(within(replay).getByText("Event 4 of 41")).toBeInTheDocument()
    expect(agent("Navigator")).toHaveAttribute("data-state", "done")
    await tick(41 * 700)
    expect(within(replay).getByText("Event 41 of 41")).toBeInTheDocument()
    expect(within(replay).getByRole("button", { name: "Play again" })).toBeInTheDocument()
    expect(screen.getByText("Run finished")).toBeInTheDocument()
    expect(agent("Proposer")).toHaveAccessibleName("Inspect Proposer: Not in this run.")
  })

  it("plays a longer run at its real timing, at 1x or 4x, and jumps with the scrubber", async () => {
    engine({ board: [{ ...DONE_REVIEW, id: "r-long" }] })
    render(<LabView />)
    await tick(0)
    await emit(FakeSource.to("/api/runs/r-long/events")[0], ...REVIEW_WITH_VISITOR)
    const replay = screen.getByRole("group", { name: "Replay" })
    expect(screen.getByText("Replay at its real speed (the run took 2 minutes 1 second).")).toBeInTheDocument()
    expect(within(replay).getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "true")
    expect(within(replay).getByText("Event 1 of 25")).toBeInTheDocument()
    await tick(4200) // round 1 starts 4 seconds in
    expect(within(replay).getByText("Event 3 of 25")).toBeInTheDocument()
    fireEvent.click(within(replay).getByRole("button", { name: "4×" })) // starts again, four times as fast
    expect(screen.getByText(/^Replay at 4 times its real speed/)).toBeInTheDocument()
    await tick(2400) // 9.6 seconds of the run: the web search at 9 s has happened
    expect(within(replay).getByText("Event 4 of 25")).toBeInTheDocument()
    fireEvent.click(within(replay).getByRole("button", { name: "Pause replay" }))
    await tick(5000)
    expect(within(replay).getByText("Event 4 of 25")).toBeInTheDocument()
    fireEvent.change(within(replay).getByRole("slider", { name: "Position in the replay" }), { target: { value: "121000" } })
    expect(within(replay).getByText("Event 25 of 25")).toBeInTheDocument()
    expect(screen.getByText("Run finished")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /Visitor Toxicologist/ })).toBeInTheDocument()
  })

  it("waits to be started when the person asked for less motion", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }))
    engine({ answers: [DONE_ANSWER] })
    render(<LabView />)
    await tick(0)
    await emit(FakeSource.to("a-practice")[0], ...PRACTICE_ANSWER)
    await tick(5000)
    expect(screen.getByText("Event 1 of 41")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Play replay" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reduced motion enabled" })).toBeDisabled()
  })

  it("lets the picker choose another run, and opens the run an address names", async () => {
    engine({ board: [DONE_REVIEW], answers: [DONE_ANSWER] })
    const { unmount } = render(<LabView />)
    await tick(0)
    const picker = screen.getByRole("combobox", { name: "Run shown in the Agent Lab" })
    const options = within(picker).getAllByRole("option").map((o) => o.textContent)
    expect(options[0]).toMatch(/^Is hERG a risk for KRAS G12C inhibitors\? · Research answer · .* · Practice · finished$/)
    expect(options[1]).toMatch(/^Kras g12c hit to lead · Team review · .* · finished$/)
    expect(picker).toHaveValue("answer/a-practice") // the run that is shown
    expect(screen.getByRole("button", { name: "Follow newest" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.change(picker, { target: { value: "board/r-practice" } })
    await tick(0)
    await emit(FakeSource.to("/api/runs/r-practice/events")[0], ...PRACTICE_REVIEW)
    expect(screen.getByRole("heading", { name: "KRAS G12C hit-to-lead (illustrative data)" })).toBeInTheDocument()
    expect(document.querySelector('[data-provenance="practice"]')).toHaveTextContent("Practice")
    expect(window.location.hash).toBe("#Lab/board/r-practice")
    expect(screen.getByRole("button", { name: "Follow newest" })).toHaveAttribute("aria-pressed", "false")
    expect(FakeSource.to("a-practice")[0].closed).toBe(true) // the stream of the run that is no longer shown is closed
    unmount()
    FakeSource.all = []
    window.location.hash = "#Lab/answer/a-practice"
    engine({ board: [DONE_REVIEW], answers: [DONE_ANSWER] })
    render(<LabView />)
    await tick(0)
    expect(FakeSource.to("/api/research/a-practice/events")).toHaveLength(1)
    expect(FakeSource.to("/api/runs/r-practice/events")).toHaveLength(0)
  })

  it("opens the stream again when it breaks, from the last event it had, and counts no event twice", async () => {
    engine({ answers: [{ ...DONE_ANSWER, id: "a-live", status: "running", mode: "real" }] })
    render(<LabView />)
    await tick(0)
    const first = FakeSource.to("/api/research/a-live/events")[0]
    await emit(first, ...REAL_ANSWER.slice(0, 13))
    expect(screen.getByText("Live: this run is in progress")).toBeInTheDocument()
    act(() => first.fail())
    expect(screen.getByText(/The connection to the engine broke\. Trying again…/)).toBeInTheDocument()
    expect(first.closed).toBe(true)
    await tick(1000)
    const second = FakeSource.to("/api/research/a-live/events")[1]
    expect(second.url).toMatch(/\?after=13$/)
    await emit(second, ...REAL_ANSWER.slice(8, 20)) // the engine sends some events again
    expect(screen.getByText(/Connected to the engine\./)).toBeInTheDocument()
    const log = within(screen.getByRole("log")).getAllByRole("listitem").map((li) => li.textContent ?? "")
    expect(log.filter((l) => l.includes("searching PubMed and preprints: found 8 papers"))).toHaveLength(1)
    expect(agent("Auditor")).toHaveAttribute("data-state", "done")
    // out of order: an event from before the break arrives late and changes nothing that came after
    await emit(second, REAL_ANSWER[4])
    expect(agent("Scout")).toHaveAttribute("data-state", "handing-off")
  })

  it("only reads: leaving the view closes its streams and cancels nothing", async () => {
    const sent = engine({ board: [LIVE_REVIEW] })
    const { unmount } = render(<LabView />)
    await tick(0)
    const stream = FakeSource.to("/api/runs/r-live/events")[0]
    await emit(stream, ...REVIEW_WITH_VISITOR.slice(0, 5))
    unmount()
    await tick(20_000)
    expect(stream.closed).toBe(true)
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((s) => s.method === "GET")).toBe(true)
    expect(sent.some((s) => /cancel|resume/.test(s.url))).toBe(false)
    const polls = sent.length
    await tick(20_000)
    expect(sent).toHaveLength(polls) // and it stops asking
  })

  it("follows a swarm run by reading its record, and labels the scripted model as Practice", async () => {
    const running = { ...SWARM_RUN, id: "s-live", phase: "running", finishedAt: undefined }
    const notes = (n: number) => ({ events: (SWARM_NOTES.events as unknown[]).slice(0, n) })
    engine({ swarm: [running] }, { "GET /api/glhf/runs/s-live": [ok({ run: running, ledger: notes(2) }), ok({ run: running, ledger: notes(4) }), ok({ run: { ...running, phase: "done", finishedAt: T0 + 9000 }, ledger: SWARM_NOTES })] })
    render(<LabView />)
    await tick(0)
    await tick(0)
    expect(screen.getByText("Swarm run")).toBeInTheDocument()
    expect(document.querySelector('[data-provenance="practice"]')).toHaveTextContent("Practice")
    expect(agent("Scout")).toHaveAttribute("data-state", "working")
    await tick(2000)
    expect(agent("Proposer")).toHaveAttribute("data-state", "working")
    expect(agent("Scout")).toHaveAttribute("data-state", "handing-off")
    await tick(2000)
    expect(screen.getByText("Run finished")).toBeInTheDocument()
    expect(agent("Navigator")).toHaveAccessibleName("Inspect Navigator: Not in this run.")
  })

  it("shows a claims-engine run from its board and its events, reads the board again while it runs, and only ever reads", async () => {
    const running = { id: "s-claims", solver: "glhf", model: "mock", task: "demo", phase: "running", startedAt: T0 }
    const upTo = (seq: number) => CLAIMS_EVENTS.filter((e) => (e.seq as number) <= seq)
    const early = { run_id: CLAIMS_BOARD.run_id, seq: 7, claims: CLAIMS_BOARD.claims.map((c) => ({ ...c, state: "piloting", history: [{ reason: "pilot granted", at: 1 }], attempts: {}, verdicts: [] })) }
    const sent = engine({ swarm: [running] }, {
      "GET /api/glhf/runs/s-claims": [ok({ run: running, ledger: null }), ok({ run: running, ledger: null }), ok({ run: { ...running, phase: "done", finishedAt: T0 + 9000 }, ledger: null })],
      "GET /api/glhf/runs/s-claims/board": [ok({ ...early, ledgerEvents: CLAIMS_NOTES.slice(0, 8) }), ok({ ...CLAIMS_BOARD, ledgerEvents: CLAIMS_NOTES })],
      "GET /api/glhf/runs/s-claims/claims-events": [ok({ events: upTo(9) }), ok({ events: CLAIMS_EVENTS.filter((e) => (e.seq as number) > 9) })],
    })
    render(<LabView />)
    await tick(0); await tick(0); await tick(0)
    expect(screen.getByText("Swarm run")).toBeInTheDocument()
    expect(screen.getAllByText("Practice: scripted run, not a benchmark result").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Model: mockllm/model").length).toBeGreaterThan(0)
    const list = screen.getByRole("list", { name: "Claims of this run" })
    expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("data-claim"))).toEqual(["C1", "C2"])
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("C1 Piloting")
    expect(agent("Pilot")).toHaveAttribute("data-state", "working")
    expect(agent("Engine")).toHaveAttribute("data-state", "working")
    expect(sent.filter((r) => r.url.includes("claims-events")).map((r) => r.query)).toEqual(["?after=0"])
    await tick(2100) // the next read: a new snapshot and the events after the last seq held
    await tick(0)
    expect(sent.filter((r) => r.url.includes("claims-events")).map((r) => r.query)).toEqual(["?after=0", "?after=9"])
    expect(within(screen.getByRole("list", { name: "Claims of this run" })).getAllByRole("listitem")[0]).toHaveTextContent("C1 ✓ Supported")
    expect(within(screen.getByRole("list", { name: "Claims in Report studio" })).getByRole("listitem")).toHaveTextContent("C1 ✓ Supported")
    await tick(2100)
    expect(screen.getByText("Run finished")).toBeInTheDocument()
    expect(sent.every((r) => r.method === "GET")).toBe(true)
  })

  it("says so when there is no run yet, and when the engine cannot be reached", async () => {
    engine({})
    const { unmount } = render(<LabView />)
    await tick(0)
    expect(screen.getAllByText(/No run yet\./).length).toBeGreaterThan(0)
    expect(screen.getByText("Team idle")).toBeInTheDocument()
    expect(FakeSource.all).toHaveLength(0)
    unmount()
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("connection refused"))))
    render(<LabView />)
    await tick(0)
    expect(screen.getByRole("alert")).toHaveTextContent("The app's engine isn't running")
  })
})
