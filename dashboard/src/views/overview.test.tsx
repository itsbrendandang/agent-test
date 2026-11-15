// The Overview page: the question box with the Agent Lab under it (idle until a question is sent from this page), and
// one line of counts from the engine's three lists, in which a practice run is never counted as research.
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { forgetScripted } from "@/lib/scripted"
import { routes } from "@/test/engine"
import { OverviewView } from "./OverviewView"

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  forgetScripted(); streams.length = 0
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; onerror?: () => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const NOW = Date.now(), HOUR = 3_600_000
const sse = (event: object) => `data: ${JSON.stringify({ key: "run", at: 0, ...event })}\n\n`
const started = (mock: boolean) => new Response(sse({ type: "run.started", mock, question: "Q" }), { status: 200, headers: { "content-type": "text/event-stream" } })

function show(lists: { board?: unknown; answers?: unknown; swarm?: unknown; paid?: unknown }, more: Parameters<typeof routes>[0] = {}) {
  const onOpen = vi.fn()
  routes({
    "GET /api/runs": { status: 200, body: lists.board ?? [] },
    "GET /api/research": { status: 200, body: lists.answers ?? { items: [] } },
    "GET /api/glhf/runs": { status: 200, body: lists.swarm ?? [] },
    "GET /api/paid": { status: 200, body: lists.paid ?? { paid: false, caps: { maxUsd: 5, dailyUsd: 20, spentTodayUsd: 0, exaUsedUsd: 0.035, exaCeilingUsd: 40 } } },
    ...more,
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
const counts = () => screen.getByLabelText("Totals").textContent ?? ""

describe("Overview", () => {
  it("counts research and practice apart in one line, and points to Saved research", async () => {
    const onOpen = show({
      board: [{ id: "b-live", brief: "kras.md", status: "done", startedAt: NOW - 2 * HOUR }, { id: "b-practice", brief: "kras.md", status: "done", startedAt: NOW - 3 * HOUR }],
      answers: { items: [{ id: "a1", question: "Does it work?", status: "done", mode: "real", startedAt: NOW - HOUR }, { id: "a2", question: "A practice one", status: "running", mode: "demo", startedAt: NOW }] },
      swarm: [{ id: "s1", solver: "glhf", task: "demo", phase: "done", model: "mock", modelClass: "scripted", startedAt: NOW - 4 * HOUR }, { id: "s2", solver: "single", task: "demo", phase: "failed", model: "mock", modelClass: "scripted", startedAt: NOW - 5 * HOUR }],
    })
    // The team reviews say how they were made in their first event: wait for both to be read.
    await waitFor(() => expect(counts()).toContain("2 research runs, 4 practice, 1 in progress, 1 failed."))
    await userEvent.click(screen.getByRole("button", { name: "See everything in Saved research" }))
    expect(onOpen).toHaveBeenCalledWith("Runs")
    // The old statistics block is gone: no tiles, no chart, no activity log.
    expect(screen.queryByText("Research runs")).toBeNull()
    expect(screen.queryByText("By kind")).toBeNull()
    expect(screen.queryByRole("region", { name: "Activity log" })).toBeNull()
  })

  it("a practice run is not research even when it is the only thing there", async () => {
    show({ answers: { items: [{ id: "a2", question: "A practice one", status: "done", mode: "demo", startedAt: NOW }] } })
    await waitFor(() => expect(counts()).toContain("0 research runs, 1 practice, 0 in progress."))
  })

  it("shows the engine-offline card when no list can be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    render(<OverviewView onOpen={() => {}} />)
    await waitFor(() => expect(document.querySelector(".page")?.textContent).toMatch(/engine/i))
    expect(screen.queryByLabelText("Totals")).toBeNull()
  })
})

describe("the Agent Lab under the question box", () => {
  const lab = () => document.querySelector(".ov-lab") as HTMLElement
  it("is idle until a question is sent; Send starts the answer on this page and the lab follows that answer", async () => {
    const onOpen = show({}, { "POST /api/research": { status: 202, body: { id: "a-20261115000000-0000abcd", thread: "t-1", mode: "demo" } } })
    await screen.findByText("Your research team is ready")
    expect(lab().querySelector(".ov-row-label [role=status]")?.textContent).toContain("The team is at its desks.")
    expect(lab().querySelector(".lab-both")).toBeTruthy() // the same lab as the Agent Lab page, not a look-alike
    expect(screen.queryByRole("region", { name: /hERG/ })).toBeNull()
    await userEvent.type(screen.getByLabelText("Ask a research question"), "Is hERG a risk for KRAS G12C inhibitors?")
    await userEvent.click(screen.getByRole("button", { name: /^Send/ }))
    await waitFor(() => expect(lab().querySelector(".ov-row-label [role=status]")?.textContent).toContain("The team is working on your question."))
    expect(onOpen).not.toHaveBeenCalled() // the page stays: no jump to Research
    expect(sessionStorage.getItem("open.ask")).toBeNull()
    expect(screen.getByRole("heading", { name: "Is hERG a risk for KRAS G12C inhibitors?" })).toBeTruthy()
    expect((screen.getByLabelText("Ask a research question") as HTMLTextAreaElement).value).toBe("")
    // The answer's own events move the lab: a specialist the engine added joins as a visitor, then works.
    const who = { name: "toxicologist", title: "Toxicologist", agent: "specialist:toxicologist", why: "Its method notes match the question's words: herg, risk.", methods: [] }
    const feed = (events: object[]) => act(() => { for (const stream of streams.filter((x) => /\/api\/research\//.test(x.url))) for (const e of events) stream.onmessage?.({ data: JSON.stringify(e) }) })
    await waitFor(() => expect(streams.some((x) => /\/api\/research\/a-20261115000000-0000abcd\/events/.test(x.url))).toBe(true))
    await feed([
      { seq: 1, at: 1, type: "research.started", id: "a-20261115000000-0000abcd", question: "Is hERG a risk for KRAS G12C inhibitors?", mode: "demo" },
      { seq: 2, at: 2, type: "specialists", items: [who] },
      { seq: 3, at: 3, type: "step.started", step: "specialist:toxicologist", kind: "write", label: "Toxicologist: reading 3 sources with its method notes", agent: "specialist:toxicologist" },
    ])
    await waitFor(() => expect(lab().textContent).toContain("Toxicologist"))
    // When the answer ends, the line says so and the counts are read again.
    const reads = () => (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.filter(([url]) => String(url).endsWith("/api/research?all=1")).length
    const before = reads()
    await feed([{ seq: 4, at: 4, type: "research.finished", usd: 0, seconds: 1, counts: { sources: 3, statements: 2, verified: 2 }, searches: {}, review: { checker: "scripted", critic: "scripted", revised: false, notes: { raised: 0, resolved: 0 } } }])
    await waitFor(() => expect(lab().querySelector(".ov-row-label [role=status]")?.textContent).toContain("The team finished your question."))
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
  })

  it("an engine without direct answers: the question is handed to Research, as before", async () => {
    const onOpen = show({}, { "POST /api/research": { status: 404, body: { error: "not found" } } })
    await screen.findByText("Your research team is ready")
    await userEvent.type(screen.getByLabelText("Ask a research question"), "Does it work?")
    await userEvent.click(screen.getByRole("button", { name: /^Send/ }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("Home"))
    expect(JSON.parse(sessionStorage.getItem("open.ask") ?? "null")).toMatchObject({ question: "Does it work?", send: true })
    sessionStorage.removeItem("open.ask")
  })

  it("a refusal is said on the page and nothing is started", async () => {
    show({}, { "POST /api/research": { status: 429, body: { error: "too many", field: "rate" } } })
    await screen.findByText("Your research team is ready")
    await userEvent.type(screen.getByLabelText("Ask a research question"), "Does it work?")
    await userEvent.click(screen.getByRole("button", { name: /^Send/ }))
    expect((await screen.findByRole("alert")).textContent).toContain("Too many questions in a short time.")
    expect((screen.getByLabelText("Ask a research question") as HTMLTextAreaElement).value).toBe("Does it work?") // kept, to send again
    expect(lab().querySelector(".ov-row-label [role=status]")?.textContent).toContain("The team is at its desks.")
  })
})

describe("the welcome on the home page", () => {
  it("a starter question fills the box and the team perks up; the agents are named in text", async () => {
    show({})
    await screen.findByText("Your research team is ready")
    const box = screen.getByLabelText("Ask a research question") as HTMLTextAreaElement
    const ask = screen.getByRole("button", { name: /^Send/ }) as HTMLButtonElement
    expect(ask.disabled).toBe(true)
    await userEvent.click(screen.getByRole("button", { name: "What GLP-1s are working in the market right now?" }))
    expect(box.value).toBe("What GLP-1s are working in the market right now?")
    expect(document.activeElement).toBe(box)
    expect(document.querySelector(".ov-hero")?.getAttribute("data-eager")).toBe("true") // the team perks up
    expect(document.querySelector(".ov-hero .search-composer")).toBeTruthy() // the same composer as Research, not a look-alike
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
