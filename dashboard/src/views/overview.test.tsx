// The Overview, the home page: a one-line question box that starts research and opens it in Research, the research
// still being done (each row following its run's own events), the numbers from recorded data only, recent research,
// and a compact Agent Lab. Against a stand-in engine: no network, no model.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { forgetScripted } from "@/lib/scripted"
import { routes, to } from "@/test/engine"
import { OverviewView } from "./OverviewView"

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  forgetScripted(); streams.length = 0; sessionStorage.clear()
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; onerror?: () => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const NOW = Date.now(), HOUR = 3_600_000, MIN = 60_000
const sse = (event: object) => `data: ${JSON.stringify({ key: "run", at: 0, ...event })}\n\n`
const started = (mock: boolean, title?: string) => new Response(sse({ type: "run.started", mock, title }), { status: 200, headers: { "content-type": "text/event-stream" } })
const PAID_OFF = { paid: false, caps: { maxUsd: 5, dailyUsd: 20, spentTodayUsd: 0, exaUsedUsd: 0.035, exaCeilingUsd: 40 } }

function show(lists: { board?: unknown; answers?: unknown; swarm?: unknown; paid?: unknown }, more: Parameters<typeof routes>[0] = {}) {
  const onOpen = vi.fn()
  const sent = routes({
    "GET /api/runs": { status: 200, body: lists.board ?? [] },
    "GET /api/research": { status: 200, body: lists.answers ?? { items: [] } },
    "GET /api/glhf/runs": { status: 200, body: lists.swarm ?? [] },
    "GET /api/paid": { status: 200, body: lists.paid ?? PAID_OFF },
    "GET /api/chat/catalog": { status: 503, body: {} },
    ...more,
  })
  const real = globalThis.fetch
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    const m = /^\/api\/runs\/([\w.-]+)\/events$/.exec(path)
    return m ? started(m[1] !== "b-live", m[1] === "b-live" ? "Is KRAS G12C druggable in the lung?" : undefined) : real(url, init)
  }))
  render(<OverviewView onOpen={onOpen} />)
  return { onOpen, sent }
}
const section = (name: string) => screen.getByRole("region", { name })
const tile = (label: string) => within(section("Metrics")).getByText(label, { selector: ".ov-metric > span" }).closest(".ov-metric") as HTMLElement

describe("the home page: research in progress", () => {
  it("lists every running answer, team review and benchmark run, with its question, step, agents, time and spend", async () => {
    const { onOpen } = show({
      answers: { items: [
        { id: "a-run", thread: "t-1", question: "Is hERG a risk for KRAS G12C inhibitors?", status: "running", mode: "real", startedAt: NOW - 3 * MIN, workStartedAt: NOW - 2 * MIN, usd: 0.42, maxUsd: 2, step: { label: "Writing the draft from 3 sources", agent: "writer" }, agents: ["planner", "searcher", "writer"] },
        { id: "a-done", question: "Done one", status: "done", mode: "real", startedAt: NOW - HOUR, finishedAt: NOW - HOUR + 90_000, seconds: 90, usd: 0.3 },
      ] },
      board: [{ id: "b-live", brief: "kras.md", status: "running", startedAt: NOW - 10 * MIN, usd: 1.5, maxUsd: 1, mock: false, members: ["lead-scientist", "scout"] }],
      swarm: [{ id: "s1", solver: "glhf", task: "demo", phase: "running", detail: "critic: reviewing the analysis", model: "mock", modelClass: "scripted", startedAt: NOW - 5 * MIN }],
    })
    const list = await screen.findByRole("list", { name: "Research in progress" })
    const rows = within(list).getAllByRole("listitem").filter((li) => li.classList.contains("ov-run"))
    expect(rows).toHaveLength(3)
    // Oldest first: the team review began first.
    expect(rows.map((r) => r.querySelector(".ov-kind")?.textContent)).toEqual(["Team review", "Benchmark run", "Research answer"])
    const answer = rows[2]
    expect(answer.textContent).toContain("Is hERG a risk for KRAS G12C inhibitors?")
    // Before its events arrive the row says what its list line says, in the app's words for who does it.
    expect(within(answer).getByLabelText("Now").textContent).toContain("Writing the draft from 3 sources")
    expect(within(answer).getByRole("list", { name: "Agents taking part" }).textContent).toContain("Planner")
    expect(answer.textContent).toMatch(/Time2 minutes/)
    expect(answer.textContent).toContain("$0.42 of $2.00")
    expect(rows[1].textContent).toContain("critic: reviewing the analysis")
    expect(rows[1].textContent).toContain("Not recorded") // a benchmark run records no dollars: none are shown
    expect(rows[0].textContent).toContain("$1.50 of $1.00") // the review's own cap from its line, not the engine's $5 limit per run
    // A team review shows the question it asked (its first event), not its brief's file name.
    await waitFor(() => expect(rows[0].querySelector(".ov-run-title")?.textContent).toBe("Is KRAS G12C druggable in the lung?"))
    // Each running run follows its own events.
    await waitFor(() => expect(streams.map((s) => s.url).some((u) => u.endsWith("/api/research/a-run/events"))).toBe(true))
    expect(streams.some((s) => s.url.endsWith("/api/runs/b-live/events"))).toBe(true)
    // The answer's events move the row: who works now and what they do.
    act(() => {
      const stream = streams.find((s) => s.url.endsWith("/api/research/a-run/events"))!
      for (const e of [
        { seq: 1, at: 1, type: "research.started", id: "a-run", question: "Is hERG a risk for KRAS G12C inhibitors?", mode: "real" },
        { seq: 2, at: 2, type: "specialists", items: [{ name: "toxicologist", title: "Toxicologist", agent: "specialist:toxicologist", why: "fits", methods: [] }] },
        { seq: 3, at: 3, type: "step.started", step: "specialist:toxicologist", kind: "write", label: "Toxicologist: reading 3 sources with its method notes", agent: "specialist:toxicologist" },
      ]) stream.onmessage?.({ data: JSON.stringify(e) })
    })
    await waitFor(() => expect(within(answer).getByLabelText("Now").textContent).toContain("reading 3 sources with its method notes"))
    expect(within(answer).getByRole("list", { name: "Agents taking part" }).textContent).toContain("Toxicologist")
    // Click-through: Research for an answer, Team review for a review, and the Agent Log for any.
    await userEvent.click(within(answer).getByRole("button", { name: "Open in Research" }))
    expect(onOpen).toHaveBeenCalledWith("Home")
    expect(JSON.parse(sessionStorage.getItem("open.answer") ?? "null")).toEqual({ id: "a-run", question: "Is hERG a risk for KRAS G12C inhibitors?" })
    await userEvent.click(within(rows[0]).getByRole("button", { name: "Open review" }))
    expect(onOpen).toHaveBeenCalledWith("Board")
    expect(sessionStorage.getItem("open.board")).toBe("b-live")
    expect(within(answer).getByRole("link", { name: "Agent Log" }).getAttribute("href")).toBe("#Lab/answer/a-run")
  })

  it("a row past the followed few does not claim its run is only starting", async () => {
    show({ board: Array.from({ length: 5 }, (_, i) => ({ id: `b-${i}`, brief: "kras.md", status: "running", startedAt: NOW - (10 - i) * MIN, mock: true, members: [] })) })
    const list = await screen.findByRole("list", { name: "Research in progress" })
    const rows = within(list).getAllByRole("listitem").filter((li) => li.classList.contains("ov-run"))
    expect(rows).toHaveLength(5)
    expect(within(rows[4]).getByLabelText("Now").textContent).toBe("Step not shown here. Open the Agent Log to follow it.")
    expect(streams.some((s) => s.url.endsWith("/api/runs/b-4/events"))).toBe(false)
  })

  it("says plainly when nothing is running", async () => {
    show({ answers: { items: [{ id: "a1", question: "Old", status: "done", mode: "demo", startedAt: NOW - HOUR }] } })
    expect(await within(section("In progress")).findByText(/Nothing is running now/)).toBeTruthy()
    expect(within(document.querySelector(".ov-lab") as HTMLElement).getByRole("status").textContent).toContain("Nothing is running.")
  })

  it("the compact lab shows the first running run, and another when its row is chosen", async () => {
    show({ answers: { items: [
      { id: "a-one", question: "First question", status: "running", mode: "demo", startedAt: NOW - 2 * MIN },
      { id: "a-two", question: "Second question", status: "running", mode: "demo", startedAt: NOW - MIN },
    ] } })
    await screen.findByRole("list", { name: "Research in progress" })
    const lab = document.querySelector(".ov-lab") as HTMLElement
    await waitFor(() => expect(within(lab).getByRole("status").textContent).toBe("Showing: First question"))
    expect(lab.querySelector(".lab-both[data-compact]")).toBeTruthy() // the same lab as the Agent Log's, compact
    const second = screen.getAllByRole("listitem").find((li) => li.classList.contains("ov-run") && li.textContent?.includes("Second question")) as HTMLElement
    await userEvent.click(within(second).getByRole("button", { name: "Show in lab" }))
    expect(within(lab).getByRole("status").textContent).toBe("Showing: Second question")
  })

  it("reads the lists again while something runs, so its spend and step move", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { sent } = show({ answers: { items: [{ id: "a-run", question: "Q", status: "running", mode: "real", startedAt: NOW, usd: 0.1 }] } })
      await screen.findByRole("list", { name: "Research in progress" })
      const before = to(sent, "GET", "/api/research").length
      await act(async () => { await vi.advanceTimersByTimeAsync(5_100) })
      expect(to(sent, "GET", "/api/research").length).toBeGreaterThan(before)
    } finally { vi.useRealTimers() }
  })
})

describe("the home page: metrics from recorded data only", () => {
  it("counts done, running and failed runs of the chosen scope only (examples never)", async () => {
    show({
      board: [{ id: "b-live", brief: "kras.md", status: "done", startedAt: NOW - 2 * HOUR }, { id: "b-practice", brief: "kras.md", status: "done", startedAt: NOW - 3 * HOUR }, { id: "ex", brief: "x.md", status: "done", startedAt: NOW, example: true }],
      answers: { items: [{ id: "a1", question: "Does it work?", status: "done", mode: "real", startedAt: NOW - HOUR }, { id: "a2", question: "A practice one", status: "running", mode: "demo", startedAt: NOW }] },
      swarm: [{ id: "s1", solver: "glhf", task: "demo", phase: "done", model: "mock", modelClass: "scripted", startedAt: NOW - 4 * HOUR }, { id: "s2", solver: "single", task: "demo", phase: "failed", model: "mock", modelClass: "scripted", startedAt: NOW - 5 * HOUR }],
    })
    // The older team reviews say how they were made in their first event: wait for both to be read.
    // Research: b-live (real models, said in its first event) and a1.
    await waitFor(() => expect(tile("Runs").textContent).toContain("2 runs"))
    expect(tile("Runs").textContent).toContain("2 done0 running0 failed")
    // Practice: b-practice, the Demo answer and the two scripted benchmark runs.
    await userEvent.click(screen.getByRole("button", { name: "Practice runs" }))
    expect(tile("Runs").textContent).toContain("4 runs")
    expect(tile("Runs").textContent).toContain("2 done1 running1 failed")
  })

  it("shows today's spend against the engine's daily limit, and the recorded spend of the last 7 days", async () => {
    show({
      paid: { paid: true, caps: { maxUsd: 5, dailyUsd: 20, spentTodayUsd: 3.456, exaUsedUsd: 0.035, exaCeilingUsd: 40 } },
      answers: { items: [
        { id: "a1", question: "One", status: "done", mode: "real", startedAt: NOW - HOUR, usd: 0.5, seconds: 60 },
        { id: "a2", question: "Two", status: "done", mode: "real", startedAt: NOW - 2 * HOUR, usd: 1.5, seconds: 120 },
        { id: "a3", question: "Old", status: "done", mode: "real", startedAt: NOW - 30 * 24 * HOUR, usd: 9, seconds: 30 },
      ] },
      board: [{ id: "b1", brief: "kras.md", status: "done", startedAt: NOW - HOUR, usd: 1, mock: false, members: [] }],
    })
    await waitFor(() => expect(tile("Spent today").textContent).toContain("$3.46"))
    expect(tile("Spent today").textContent).toContain("of a $20.00 daily limit")
    expect(tile("Spent today").textContent).toContain("A running team review or answer counts at its full limit until it ends.")
    expect(tile("Last 7 days").textContent).toContain("$3.00") // 0.5 + 1.5 + 1: the answer from a month ago is not in it
    expect(tile("Limit per team review").textContent).toContain("$5.00")
    expect(tile("Limit per team review").textContent).toContain("Web search (Exa): $0.04 of a $40.00 ceiling, all time")
    // Averages over the three finished research answers, from their own records.
    expect(tile("Average time per answer").textContent).toContain("1 minute") // (60 + 120 + 30) / 3 = 70 s
    expect(tile("Average cost per answer").textContent).toContain("$3.67")
    // The spend tiles are not counted by the Research/Practice switch, so they sit above it and do not change with it.
    const metrics = tile("Spent today").closest(".ov-metrics")!
    const scopeTitle = within(metrics as HTMLElement).getByText("Which runs are counted")
    for (const label of ["Spent today", "Last 7 days", "Limit per team review"]) expect(scopeTitle.compareDocumentPosition(tile(label)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    for (const label of ["Runs", "Average time per answer", "Sources", "Checks"]) expect(scopeTitle.compareDocumentPosition(tile(label)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Practice runs" }))
    expect(tile("Last 7 days").textContent).toContain("$3.00")
    expect(tile("Last 7 days").textContent).toContain("3 research answers and reviews")
  })

  it("counts sources and checks from the records, and shows practice runs apart when asked", async () => {
    show({
      answers: { items: [
        { id: "a1", question: "Real", status: "done", mode: "real", startedAt: NOW - HOUR, usd: 0.2, seconds: 40, searches: 3, sources: { kept: 8, cited: 5 }, checks: { verified: 4, contradicted: 1, unsupported: 0, unchecked: 2 } },
        { id: "a2", question: "Practice", status: "done", mode: "demo", startedAt: NOW - HOUR, usd: 0, seconds: 2, searches: 1, sources: { kept: 3, cited: 3 }, checks: { verified: 3, contradicted: 0, unsupported: 0, unchecked: 0 } },
      ] },
      board: [{ id: "b1", brief: "kras.md", status: "done", startedAt: NOW - HOUR, usd: 1, mock: false, members: [], search: { searches: 4 }, checks: { verified: 2, contradicted: 0, unsupported: 1, unchecked: 0 } }],
    })
    await waitFor(() => expect(tile("Sources").textContent).toContain("5 cited"))
    expect(tile("Sources").textContent).toContain("7 searches run, 8 sources kept across 1 answer")
    expect(tile("Checks").textContent).toContain("6 of 10 passed6 passed2 failed2 not checked")
    await userEvent.click(screen.getByRole("button", { name: "Practice runs" }))
    expect(tile("Sources").textContent).toContain("3 cited")
    expect(tile("Checks").textContent).toContain("3 of 3 passed3 passed0 failed0 not checked")
    expect(tile("Average cost per answer").textContent).toContain("$0")
  })

  it("never invents a number: with no runs, each tile says there is nothing yet", async () => {
    show({ paid: { paid: false, caps: {} } })
    await waitFor(() => expect(tile("Runs").textContent).toContain("0 runs"))
    expect(tile("Spent today").textContent).toContain("Not recorded")
    expect(tile("Limit per team review").textContent).toContain("Not recorded")
    expect(tile("Last 7 days").textContent).toContain("Nothing recorded")
    expect(tile("Average time per answer").textContent).toContain("No data")
    expect(tile("Average cost per answer").textContent).toContain("No data")
    expect(tile("Sources").textContent).toContain("No data")
    expect(tile("Checks").textContent).toContain("No data")
    expect(screen.getByText(/No research has finished yet/)).toBeTruthy()
  })

  it("shows the engine-offline card when no list can be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    render(<OverviewView onOpen={() => {}} />)
    await waitFor(() => expect(document.querySelector(".page")?.textContent).toMatch(/engine/i))
    expect(screen.queryByRole("region", { name: "Metrics" })).toBeNull()
  })

  it("keeps reading after the engine was offline, and shows the page once it is back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
      render(<OverviewView onOpen={() => {}} />)
      await waitFor(() => expect(document.querySelector(".page")?.textContent).toMatch(/engine/i))
      routes({
        "GET /api/runs": { status: 200, body: [] },
        "GET /api/research": { status: 200, body: { items: [] } },
        "GET /api/glhf/runs": { status: 200, body: [] },
        "GET /api/paid": { status: 200, body: PAID_OFF },
        "GET /api/chat/catalog": { status: 503, body: {} },
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(10_100) })
      await waitFor(() => expect(screen.getByRole("region", { name: "Metrics" })).toBeTruthy())
    } finally { vi.useRealTimers() }
  })
})

describe("the home page: recent research", () => {
  it("lists what ended, newest first, with how it ended and what it cost, and opens it", async () => {
    const { onOpen } = show({ answers: { items: [
      { id: "a-new", question: "Newest", status: "done", mode: "real", startedAt: NOW - HOUR, finishedAt: NOW - HOUR + 45_000, seconds: 45, usd: 0.25 },
      { id: "a-bad", question: "Broken", status: "failed", mode: "real", startedAt: NOW - 2 * HOUR, usd: 0.05 },
    ] } })
    const list = await screen.findByRole("list", { name: "Recent research" })
    const items = within(list).getAllByRole("listitem")
    expect(items.map((li) => li.querySelector(".ov-run-title")?.textContent)).toEqual(["Newest", "Broken"])
    expect(items[0].textContent).toContain("45 seconds")
    expect(items[0].textContent).toContain("$0.25")
    expect(items[1].textContent).toContain("Failed")
    await userEvent.click(within(items[0]).getByRole("button", { name: "Open Newest" }))
    expect(onOpen).toHaveBeenCalledWith("Home")
    await userEvent.click(screen.getByRole("button", { name: "See everything in Saved research" }))
    expect(onOpen).toHaveBeenCalledWith("Runs")
  })
})

describe("the home page: the question box", () => {
  it("starts the answer, makes it Research's conversation and opens Research", async () => {
    const { onOpen, sent } = show({}, { "POST /api/research": { status: 202, body: { id: "a-20261115000000-0000abcd", thread: "t-1", mode: "demo" } } })
    const box = await screen.findByLabelText("Ask a research question")
    expect(box.getAttribute("rows")).toBe("1") // one line
    // The welcome heading stays above the box and names its section.
    expect(screen.getByRole("heading", { level: 2, name: "Let's research together!" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Let's research together!" }).contains(box)).toBe(true)
    await userEvent.type(box, "Is hERG a risk for KRAS G12C inhibitors?")
    await userEvent.click(screen.getByRole("button", { name: /^Send/ }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("Home"))
    expect(to(sent, "POST", "/api/research")[0].body).toEqual({ question: "Is hERG a risk for KRAS G12C inhibitors?", effort: "standard" })
    expect(JSON.parse(sessionStorage.getItem("home.chat") ?? "null")).toEqual([
      { id: 1, role: "user", content: "Is hERG a risk for KRAS G12C inhibitors?" },
      { id: 2, role: "assistant", content: "", research: { id: "a-20261115000000-0000abcd", question: "Is hERG a risk for KRAS G12C inhibitors?", thread: "t-1" } },
    ])
    expect(sessionStorage.getItem("open.ask")).toBeNull() // started here, not handed over as text
  })

  it("an engine without direct answers: the question is handed to Research, as before", async () => {
    const { onOpen } = show({}, { "POST /api/research": { status: 404, body: { error: "not found" } } })
    await userEvent.type(await screen.findByLabelText("Ask a research question"), "Does it work?")
    await userEvent.click(screen.getByRole("button", { name: /^Send/ }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("Home"))
    expect(JSON.parse(sessionStorage.getItem("open.ask") ?? "null")).toMatchObject({ question: "Does it work?", send: true })
  })

  it("a refusal is said under the box, the question stays, and nothing opens", async () => {
    const { onOpen } = show({}, { "POST /api/research": { status: 429, body: { error: "too many", field: "rate" } } })
    await userEvent.type(await screen.findByLabelText("Ask a research question"), "Does it work?")
    await userEvent.click(screen.getByRole("button", { name: /^Send/ }))
    expect((await screen.findByRole("alert")).textContent).toContain("Too many questions in a short time.")
    expect(sessionStorage.getItem("home.chat")).toBeNull()
    expect((screen.getByLabelText("Ask a research question") as HTMLTextAreaElement).value).toBe("Does it work?")
    expect(onOpen).not.toHaveBeenCalled()
  })
})
