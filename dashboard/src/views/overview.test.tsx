// The Overview page: the numbers come from the engine's three lists, a practice run is never counted as research
// (whatever the app's mode), and the page says so when nothing was run or the engine is away.
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { forgetScripted } from "@/lib/scripted"
import { routes } from "@/test/engine"
import { OverviewView } from "./OverviewView"

beforeEach(() => forgetScripted())
const NOW = Date.now(), HOUR = 3_600_000
const sse = (event: object) => `data: ${JSON.stringify({ key: "run", at: 0, ...event })}\n\n`
const started = (mock: boolean) => new Response(sse({ type: "run.started", mock, question: "Q" }), { status: 200, headers: { "content-type": "text/event-stream" } })

function show(lists: { board?: unknown; answers?: unknown; swarm?: unknown }) {
  const onOpen = vi.fn()
  routes({
    "GET /api/runs": { status: 200, body: lists.board ?? [] },
    "GET /api/research": { status: 200, body: lists.answers ?? { items: [] } },
    "GET /api/glhf/runs": { status: 200, body: lists.swarm ?? [] },
  })
  const real = globalThis.fetch
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    const m = /^\/api\/runs\/([\w.-]+)\/events$/.exec(path)
    return m ? started(m[1] !== "b-live") : real(url, init)
  }))
  render(<OverviewView onOpen={onOpen} />)
  return onOpen
}
const tile = (name: string) => screen.getByText(name).closest(".ov-tile") as HTMLElement

describe("Overview", () => {
  it("counts research and practice apart, by kind, with a chart and its table", async () => {
    show({
      board: [{ id: "b-live", brief: "kras.md", status: "done", startedAt: NOW - 2 * HOUR }, { id: "b-practice", brief: "kras.md", status: "done", startedAt: NOW - 3 * HOUR }],
      answers: { items: [{ id: "a1", question: "Does it work?", status: "done", mode: "real", startedAt: NOW - HOUR }, { id: "a2", question: "A practice one", status: "running", mode: "demo", startedAt: NOW }] },
      swarm: [{ id: "s1", solver: "glhf", task: "demo", phase: "done", model: "mock", modelClass: "scripted", startedAt: NOW - 4 * HOUR }, { id: "s2", solver: "single", task: "demo", phase: "failed", model: "mock", modelClass: "scripted", startedAt: NOW - 5 * HOUR }],
    })
    await waitFor(() => expect(within(tile("All runs")).getByText("6")).toBeTruthy())
    // The team reviews say how they were made in their first event: wait for both to be read.
    await waitFor(() => expect(within(tile("Research runs")).getByText("2")).toBeTruthy())
    expect(within(tile("Practice runs")).getByText("4")).toBeTruthy()
    expect(within(tile("In progress")).getByText("1")).toBeTruthy()
    expect(tile("All runs").textContent).toContain("1 failed.")
    const kinds = screen.getByRole("region", { name: "By kind" })
    expect(kinds.textContent).toContain("Research answers2")
    expect(kinds.textContent).toContain("1 research, 1 practice")
    expect(kinds.textContent).toContain("Benchmark runs2")
    expect(kinds.textContent).toContain("0 research, 2 practice")
    expect(screen.getByRole("img", { name: /Runs started on each of the last 14 days: 6 in all/ })).toBeTruthy()
    expect(screen.getByRole("table").textContent).toMatch(/Research.*Practice.*All/)
    // The latest five, newest first, each with its own label.
    const latest = screen.getByRole("region", { name: "Latest" })
    const rows = within(latest).getAllByRole("listitem")
    expect(rows[0].textContent).toContain("A practice one")
    expect(rows[0].textContent).toContain("Practice")
    expect(rows[1].textContent).toContain("Does it work?")
    expect(rows[1].textContent).toContain("Live research")
    expect(rows).toHaveLength(5)
  })

  it("a practice run is not research even when it is the only thing there", async () => {
    show({ answers: { items: [{ id: "a2", question: "A practice one", status: "done", mode: "demo", startedAt: NOW }] } })
    await waitFor(() => expect(within(tile("Practice runs")).getByText("1")).toBeTruthy())
    expect(within(tile("Research runs")).getByText("0")).toBeTruthy()
  })

  it("says so when nothing was run, and points to Research and to Saved research", async () => {
    const onOpen = show({})
    await screen.findByText("Nothing has been run yet")
    expect(screen.queryByRole("img")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Go to Research" }))
    expect(onOpen).toHaveBeenCalledWith("Home")
  })

  it("shows the engine-offline card when no list can be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    render(<OverviewView onOpen={() => {}} />)
    await waitFor(() => expect(document.querySelector(".page")?.textContent).toMatch(/engine/i))
    expect(screen.queryByText("Research runs")).toBeNull()
  })
})
