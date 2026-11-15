import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PRACTICE_ANSWER, PRACTICE_REVIEW } from "@/lab/fixtures/practice"
import { REAL_ANSWER, REVIEW_WITH_VISITOR, T0 } from "@/lab/fixtures/streams"
import type { LabEvent } from "@/lab/adapter"
import { forgetScripted } from "@/lib/scripted"
import { routes } from "@/test/engine"
import { LabView } from "./LabView"
import { CLAIMS_BOARD, CLAIMS_EVENTS, CLAIMS_NOTES } from "@/lab/fixtures/claims"

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

describe("Agent Log view", () => {
  it("interleaves claims-engine ledger notes rather than appending proposal after assembly", async () => {
    const run = { id: "claims-run", task: "demo", model: "mock", solver: "glhf", phase: "done", startedAt: T0 }
    engine({ swarm: [run] }, {
      "GET /api/glhf/runs/claims-run": ok({ run, ledger: { events: [] } }),
      "GET /api/glhf/runs/claims-run/board": ok({ ...CLAIMS_BOARD, ledgerEvents: CLAIMS_NOTES }),
      "GET /api/glhf/runs/claims-run/claims-events": ok(CLAIMS_EVENTS),
    })
    render(<LabView />)
    await tick(0)
    const rows = [...document.querySelectorAll(".event-log-row")].map((e) => e.textContent ?? "")
    const propose = rows.findIndex((s) => s.includes("Started the propose phase"))
    const claim = rows.findIndex((s) => s.includes("Recorded statement C1"))
    const report = rows.findIndex((s) => s.includes("Started the report phase"))
    expect(propose).toBeGreaterThanOrEqual(0)
    expect(propose).toBeLessThan(claim)
    expect(report).toBeGreaterThan(claim)
  })
  it("shows the live run and appends events without a room scene", async () => {
    engine({ board: [LIVE_REVIEW], answers: [DONE_ANSWER] })
    render(<LabView />)
    await tick(0)
    const source = FakeSource.to("/api/runs/r-live/events")[0]
    expect(screen.getByText("Loading event log…")).toBeInTheDocument()
    await emit(source, ...REVIEW_WITH_VISITOR.slice(0, 4))
    expect(screen.getByRole("heading", { name: "Agent Log" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Placeholder review question" })).toBeInTheDocument()
    expect(document.querySelector(".lab-scene")).toBeNull()
    expect(within(screen.getByRole("list", { name: "Run events" })).getAllByRole("listitem").length).toBeGreaterThanOrEqual(4)
    await emit(source, ...REVIEW_WITH_VISITOR.slice(4))
    expect(screen.getByText(/Finished run ·/)).toBeInTheDocument()
    expect(source.closed).toBe(true)
  })

  it("shows every finished practice event immediately, filters and clears filters", async () => {
    engine({ answers: [DONE_ANSWER] })
    render(<LabView />)
    await tick(0)
    await emit(FakeSource.to("a-practice")[0], ...PRACTICE_ANSWER)
    expect(document.querySelector('[data-provenance="practice"]')).toHaveTextContent("Practice")
    expect(screen.getByText(/Practice run · scripted example/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(PRACTICE_ANSWER.length + " of " + PRACTICE_ANSWER.length + " events shown"))).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search log" }), { target: { value: "definitely no matching event" } })
    expect(screen.getByText("No events match these filters.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(screen.queryByText("No events match these filters.")).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole("combobox", { name: "Kind of step" }), { target: { value: "run" } })
    expect(screen.getByRole("combobox", { name: "Kind of step" })).toHaveValue("run")
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeEnabled()
  })

  it("keeps a watched run when it finishes and only ever reads", async () => {
    const sent = engine({ board: [LIVE_REVIEW] }, { "GET /api/runs": [ok([LIVE_REVIEW]), ok([{ ...LIVE_REVIEW, status: "done" }, { ...DONE_REVIEW, startedAt: T0 + 500 }])] })
    const { unmount } = render(<LabView />)
    await tick(0)
    const source = FakeSource.to("r-live")[0]
    await emit(source, ...REVIEW_WITH_VISITOR)
    await tick(2500)
    expect(screen.getByRole("combobox", { name: "Run shown in the Agent Log" })).toHaveValue("board/r-live")
    expect(screen.getByText(/Finished run ·/)).toBeInTheDocument()
    unmount()
    await tick(20000)
    expect(source.closed).toBe(true)
    expect(sent.every((s) => s.method === "GET")).toBe(true)
  })

  it("picks another run, closes the old stream and preserves deep links", async () => {
    engine({ board: [DONE_REVIEW], answers: [DONE_ANSWER] })
    const { unmount } = render(<LabView />)
    await tick(0)
    fireEvent.change(screen.getByRole("combobox", { name: "Run shown in the Agent Log" }), { target: { value: "board/r-practice" } })
    await tick(0)
    await emit(FakeSource.to("/api/runs/r-practice/events")[0], ...PRACTICE_REVIEW)
    expect(screen.getByRole("heading", { name: "KRAS G12C hit-to-lead (illustrative data)" })).toBeInTheDocument()
    expect(window.location.hash).toBe("#Lab/board/r-practice")
    expect(FakeSource.to("a-practice")[0].closed).toBe(true)
    unmount()
    FakeSource.all = []
    window.location.hash = "#Lab/answer/a-practice"
    render(<LabView />)
    await tick(0)
    expect(FakeSource.to("/api/research/a-practice/events")).toHaveLength(1)
  })

  it("reconnects without duplicate events and keeps received rows on connection errors", async () => {
    engine({ answers: [{ ...DONE_ANSWER, id: "a-live", status: "running", mode: "real" }] })
    render(<LabView />)
    await tick(0)
    const first = FakeSource.to("a-live")[0]
    await emit(first, ...REAL_ANSWER.slice(0, 13))
    act(() => first.fail())
    expect(screen.getByText(/The event connection failed/)).toBeInTheDocument()
    await tick(1000)
    const second = FakeSource.to("a-live")[1]
    expect(second.url).toMatch(/after=13$/)
    await emit(second, ...REAL_ANSWER.slice(8, 20))
    expect(screen.getByText(/20 of 20 events shown/)).toBeInTheDocument()
  })

  it("shows a run failure, empty list and unavailable engine", async () => {
    engine({ board: [LIVE_REVIEW] })
    const { unmount } = render(<LabView />)
    await tick(0)
    await emit(FakeSource.to("r-live")[0], { type: "run.failed", key: "failed", at: T0, error: "Something stopped the review" })
    expect(screen.getAllByText(/Something stopped the review/).length).toBeGreaterThan(0)
    expect(screen.getByRole("alert")).toBeInTheDocument()
    unmount()
    engine({})
    const empty = render(<LabView />)
    await tick(0)
    expect(screen.getByText(/No run yet/)).toBeInTheDocument()
    expect(document.querySelector(".lab-scene")).toBeNull()
    empty.unmount()
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("connection refused"))))
    render(<LabView />)
    await tick(0)
    expect(screen.getByRole("alert")).toHaveTextContent("The app's engine isn't running")
  })
})
