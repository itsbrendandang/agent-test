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

function show(lists: { board?: unknown; answers?: unknown; swarm?: unknown; paid?: unknown }) {
  const onOpen = vi.fn()
  routes({
    "GET /api/runs": { status: 200, body: lists.board ?? [] },
    "GET /api/research": { status: 200, body: lists.answers ?? { items: [] } },
    "GET /api/glhf/runs": { status: 200, body: lists.swarm ?? [] },
    "GET /api/paid": { status: 200, body: lists.paid ?? { paid: false, caps: { maxUsd: 5, dailyUsd: 20, spentTodayUsd: 0, exaUsedUsd: 0.035, exaCeilingUsd: 40 } } },
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
    // The activity log: newest first under a day pill, each entry with an agent's face, who did what, and its own label.
    const log = screen.getByRole("region", { name: "Activity log" })
    expect(within(log).getByText("Today")).toBeTruthy()
    const rows = within(log).getAllByRole("listitem")
    expect(rows).toHaveLength(6)
    expect(rows[0].textContent).toContain("Reporter")
    expect(rows[0].textContent).toContain("is working on")
    expect(rows[0].textContent).toContain("A practice one")
    expect(rows[0].textContent).toContain("Practice")
    expect(rows[1].textContent).toContain("wrote an answer to")
    expect(rows[1].textContent).toContain("Does it work?")
    expect(rows[1].textContent).toContain("Live research")
    expect(rows[2].textContent).toContain("Lead Scientist")
    expect(rows[2].textContent).toContain("led a team review of")
    expect(rows[4].textContent).toContain("Team of nine")
    expect(rows[4].textContent).toContain("the demo task")
    expect(rows[5].textContent).toContain("One agent")
    expect(rows[5].textContent).toContain("failed on")
    expect(rows[5].getAttribute("data-failed")).toBe("true")
    expect(rows[0].querySelector("svg[data-agent]")).toBeTruthy()
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

describe("the welcome on the home page", () => {
  it("a starter question fills the box, and the send button hands the question to Research to start", async () => {
    const onOpen = show({})
    await screen.findByText("Your research team is ready")
    const box = screen.getByLabelText("Ask a research question") as HTMLTextAreaElement
    const ask = screen.getByRole("button", { name: "Ask the team" }) as HTMLButtonElement
    expect(ask.disabled).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "What GLP-1s are working in the market right now?" }))
    expect(box.value).toBe("What GLP-1s are working in the market right now?")
    expect(document.activeElement).toBe(box)
    expect(document.querySelector(".ov-hero")?.getAttribute("data-eager")).toBe("true") // the team perks up
    const posts = () => (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.filter(([, init]) => init?.method && init.method !== "GET")
    await userEvent.click(ask)
    expect(onOpen).toHaveBeenCalledWith("Home")
    // The question is handed to Research marked "send": Research starts the search through its own Send path.
    expect(JSON.parse(sessionStorage.getItem("open.ask") ?? "null")).toEqual({ question: "What GLP-1s are working in the market right now?", send: true })
    expect(posts()).toHaveLength(0) // this page itself sends nothing to the engine
    sessionStorage.removeItem("open.ask")
    // The agents are named in text for a screen reader; the moving picture is hidden from it.
    expect(document.querySelector(".ov-stage")?.getAttribute("aria-hidden")).toBe("true")
    expect(screen.getByText("Scout: finds sources")).toBeTruthy()
    expect(screen.getByRole("group", { name: "Example questions" }).querySelectorAll("button")).toHaveLength(3)
  })
})

describe("API credits on the home page", () => {
  it("shows the engine's own spend and limits, and says what it cannot know", async () => {
    show({ paid: { paid: true, caps: { maxUsd: 5, dailyUsd: 20, spentTodayUsd: 3.456, exaUsedUsd: 0.035, exaCeilingUsd: 40 } } })
    const credits = (await screen.findByText("Spent today")).closest("section") as HTMLElement
    expect(credits.textContent).toContain("Real mode: runs spend money, inside these limits.")
    expect(credits.textContent).toContain("$3.46Spent todayof a $20.00 daily limit")
    expect(credits.textContent).toContain("$5.00Limit per run")
    expect(credits.textContent).toContain("$0.04Web search (Exa)of a $40.00 ceiling, all time")
    expect(credits.textContent).toContain("Not knownAccount balances")
  })
  it("says nothing can be spent in Demo mode, and Not known for a number the engine did not give", async () => {
    show({ paid: { paid: false, caps: { dailyUsd: 20 } } })
    const credits = (await screen.findByText("Spent today")).closest("section") as HTMLElement
    expect(credits.textContent).toContain("Demo mode: nothing can be spent.")
    expect(credits.textContent).toContain("Not knownSpent today")
  })
})
