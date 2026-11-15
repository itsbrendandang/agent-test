// "Scripted" or "real" is a fact of the run on screen, never of the engine's state now. These tests show a real run
// while paid calls are off (NO_PAID_CALLS on, the engine would run scripted models) and a scripted run while they
// are on, in the Board view and in the Runs list.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { forgetScripted, swarmScripted } from "@/lib/scripted"
import { routes } from "@/test/engine"
import { BoardView } from "./BoardView"
import { ExperimentsView } from "./ExperimentsView"

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0; forgetScripted()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const emit = (event: object) => act(() => { for (const s of streams) s.onmessage?.({ data: JSON.stringify({ key: JSON.stringify(event), at: 0, ...event }) }) })

const status = (paidCalls: boolean) => ({ mock: !paidCalls, paidCalls, keys: {}, meeting: { max_minutes: 15, max_usd: 5, max_rounds: 4 } })
const board = (paidCalls: boolean) => routes({
  "GET /api/status": { status: 200, body: status(paidCalls) }, "GET /api/roster": { status: 200, body: [{ name: "lead", title: "Lead Scientist", role: "lead", model: "lead", modelId: "~anthropic/claude-opus-latest", tools: [] }] },
  "GET /api/briefs": { status: 200, body: ["kras.md"] }, "GET /api/runs": { status: 200, body: [{ id: "run-1", brief: "kras.md", rounds: 1, startedAt: 1, status: "done", claims: 1 }] },
  "GET /api/runs/run-1/memo": { status: 200, body: "" },
})
const started = (mock: boolean) => ({ type: "run.started", runId: "run-1", brief: "kras", title: "KRAS", mock })

describe("Board view", () => {
  it("a real review shown while paid calls are off is labelled real, not scripted", async () => {
    board(false)
    render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await emit(started(false))
    const mode = within(await screen.findByTestId("run-mode"))
    expect(mode.getByText("real model")).toBeInTheDocument()
    expect(mode.queryByText(/scripted/)).toBeNull()
    expect(screen.getByTestId("run-mode")).toHaveTextContent("This review ran with real models.")
    // what a NEW review would use is said separately, and is about new reviews only
    expect(screen.getByTestId("next-mode")).toHaveTextContent("Paid calls are off, so a new review runs with scripted models.")
  })
  it("a scripted review shown while paid calls are on is labelled scripted, not real", async () => {
    board(true)
    render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await emit(started(true))
    const mode = within(await screen.findByTestId("run-mode"))
    expect(mode.getByText("scripted: fixed text, not research")).toBeInTheDocument()
    expect(mode.queryByText("real model")).toBeNull()
    expect(screen.queryByTestId("next-mode")).toBeNull() // the engine would run real models now; that says nothing about this run
  })
  it("says nothing about the mode until the run itself has said", async () => {
    board(false)
    render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    expect(screen.queryByTestId("run-mode")).toBeNull()
  })
})

describe("Runs list", () => {
  const sse = (event: object) => `data: ${JSON.stringify({ key: "run", at: 0, ...event })}\n\n`
  const HITS = [
    { kind: "swarm", id: "s-mock", title: "Task demo · swarm · mock", status: "done", startedAt: 4, score: 1, matches: [] },
    { kind: "swarm", id: "s-real", title: "Task bix-12 · swarm · claude", status: "done", startedAt: 3, score: 0.5, matches: [] },
    { kind: "board", id: "b-real", title: "Drug board · kras", status: "done", startedAt: 2, matches: [] },
    { kind: "board", id: "b-mock", title: "Drug board · kras", status: "done", startedAt: 1, matches: [] },
  ]
  const list = (paidCalls: boolean) => {
    routes({
      "GET /api/search": { status: 200, body: HITS }, "GET /api/glhf/status": { status: 200, body: { paidCalls } },
      "GET /api/glhf/runs": { status: 200, body: [{ id: "s-mock", task: "demo", model: "mock", solver: "glhf", phase: "done" }, { id: "s-real", task: "bix-12", model: "anthropic/claude-sonnet-5-5", solver: "glhf", phase: "done" }] },
    })
    // the board runs' own first event, as the event stream sends it
    const plain = globalThis.fetch
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      const m = /\/api\/runs\/(b-[a-z]+)\/events$/.exec(String(url))
      return m ? Promise.resolve(new Response(sse({ type: "run.started", runId: m[1], brief: "kras", title: "KRAS", mock: m[1] === "b-mock" }), { status: 200 })) : plain(url, init)
    }))
    render(<ExperimentsView onOpen={() => {}} />)
  }
  const card = async (id: string) => (await screen.findByText(id)).closest("button")!

  it.each([[false, "paid calls off"], [true, "paid calls on"]])("labels each run from the run itself (%s: %s)", async (paidCalls) => {
    list(paidCalls)
    await waitFor(async () => expect(await card("s-mock")).toHaveTextContent("scripted: fixed text, not research · demo case"))
    expect(await card("s-real")).toHaveTextContent("real model")
    expect(await card("s-real")).not.toHaveTextContent("scripted")
    await waitFor(async () => expect(await card("b-real")).toHaveTextContent("real model"))
    expect(await card("b-real")).not.toHaveTextContent("scripted")
    await waitFor(async () => expect(await card("b-mock")).toHaveTextContent("scripted: fixed text, not research"))
    expect(await card("b-mock")).not.toHaveTextContent("real model")
  })
  it("does not move the keyboard focus to the keyword box", async () => {
    list(false)
    await card("s-mock")
    expect(screen.getByRole("searchbox", { name: "Search experiments by keyword" })).not.toHaveFocus()
  })
})

describe("swarmScripted", () => {
  it("reads the run's own model", () => {
    expect(swarmScripted({ model: "mock" })).toBe(true)
    expect(swarmScripted({ model: "anthropic/claude-sonnet-5-5" })).toBe(false)
    expect(swarmScripted(undefined)).toBeUndefined()
    expect(swarmScripted({})).toBeUndefined()
  })
})
