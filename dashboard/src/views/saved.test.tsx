// Saved research: one list of the shared row; runs of the same brief together; and the rule the owner asked for by
// name: a result keeps its own provenance whatever the run mode selector says.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModeSwitch } from "@/components/PaidSwitch"
import { TooltipProvider } from "@/components/ui/tooltip"
import { takeOpenAnswer } from "@/lib/open"
import { forgetScripted } from "@/lib/scripted"
import { useShell } from "@/lib/shell"
import { routes } from "@/test/engine"
import { ExperimentsView } from "./ExperimentsView"

beforeEach(() => forgetScripted())
const T = new Date("2026-11-14T21:02:00").getTime(), MIN = 60_000
const board = (id: string, brief: string, at: number) => ({ kind: "board", id, title: `Drug board · ${brief}`, status: "done", startedAt: at, matches: [] })
const HITS = [
  { kind: "answer", id: "a-live", title: "Does semaglutide lower heart risk?", status: "done", startedAt: T + 9 * MIN, mode: "real", matches: [] },
  { kind: "answer", id: "a-demo", title: "Is hERG a risk for KRAS G12C inhibitors?", status: "done", startedAt: T + 8 * MIN, mode: "demo", matches: [] },
  { kind: "answer", id: "a-demo-2", title: "Is hERG a risk for KRAS G12C inhibitors?", status: "failed", startedAt: T + 7 * MIN, mode: "demo", matches: [] },
  board("b-live", "kras-g12c-hit-to-lead", T + 6 * MIN),
  board("b-p3", "kras-g12c-hit-to-lead", T + 5 * MIN), board("b-p2", "kras-g12c-hit-to-lead", T + 4 * MIN), board("b-p1", "kras-g12c-hit-to-lead", T + 3 * MIN),
  board("b-other", "kras-g12c-hit-to-lead-2", T + 2 * MIN),
  board("b-chat-1", "chat-should-we-advance-a-kras-g12c-hit-that-h-1c582a84", T + MIN), board("b-chat-2", "chat-should-we-advance-a-kras-g12c-hit-that-h-1060e203", T),
  { kind: "swarm", id: "s-mock", title: "Task demo · swarm · mock", status: "done", startedAt: T - MIN, score: 1, matches: [] },
]
const LIVE = new Set(["b-live"])
const sse = (event: object) => `data: ${JSON.stringify({ key: "run", at: 0, ...event })}\n\n`
function show(paidCalls: boolean, extra: Parameters<typeof routes>[0] = {}) {
  const sent = routes({
    "GET /api/search": { status: 200, body: HITS }, "GET /api/glhf/status": { status: 200, body: { paidCalls } },
    "GET /api/glhf/runs": { status: 200, body: [{ id: "s-mock", task: "demo", model: "mock", solver: "glhf", phase: "done" }] },
    "GET /api/runs": { status: 200, body: [{ id: "b-live", brief: "kras-g12c-hit-to-lead.md", rounds: 3, claims: 204, status: "done", startedAt: T }] },
    ...extra,
  })
  const plain = globalThis.fetch // each review's own first event, as its event stream sends it
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const m = /\/api\/runs\/(b-[\w-]+)\/events$/.exec(String(url))
    return m ? Promise.resolve(new Response(sse({ type: "run.started", runId: m[1], brief: "kras", title: "", mock: !LIVE.has(m[1]) }), { status: 200 })) : plain(url, init)
  }))
  const onOpen = vi.fn()
  function Page() { const shell = useShell(1000); return <TooltipProvider><ModeSwitch paid={shell.paid} /><ExperimentsView onOpen={onOpen} /></TooltipProvider> }
  render(<Page />)
  return { sent, onOpen }
}
const rowOf = async (id: string) => await waitFor(() => { const row = document.querySelector<HTMLElement>(`li[data-record$=":${id}"]`); expect(row).not.toBeNull(); return row! })
const badge = (row: HTMLElement) => row.querySelector(":scope > .record-main > .record-meta [data-provenance]")

describe("provenance is the record's, not the mode's", () => {
  it.each([[true, "Real"], [false, "Demo"]] as const)("with run mode on %s (%s) a practice result says Practice and a live one says Live research", async (paidCalls, chosen) => {
    show(paidCalls)
    await waitFor(() => expect(screen.getByRole("radio", { name: chosen })).toBeChecked())
    expect(badge(await rowOf("a-demo"))).toHaveTextContent(/^Practice$/)
    expect(badge(await rowOf("a-live"))).toHaveTextContent(/^Live research$/)
    expect(badge(await rowOf("s-mock"))).toHaveTextContent(/^Practice$/)
    await waitFor(async () => expect(badge(await rowOf("b-live"))).toHaveTextContent(/^Live research$/))
    await waitFor(async () => expect(badge(await rowOf("b-p3"))).toHaveTextContent(/^Practice$/))
    // every badge has an icon and the word: it does not rest on colour
    for (const b of document.querySelectorAll("[data-provenance]")) { expect(b.querySelector("svg")).not.toBeNull(); expect(b.textContent).toMatch(/^(Practice|Live research)$/) }
  })
  it("switching the mode while the list is on screen relabels nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let paidCalls = false
    show(false, { "GET /api/glhf/status": () => ({ status: 200, body: { paidCalls } }) })
    await waitFor(async () => expect(badge(await rowOf("b-p3"))).toHaveTextContent(/^Practice$/))
    const before = [...document.querySelectorAll("[data-record]")].map((li) => `${li.getAttribute("data-record")}=${badge(li as HTMLElement)?.textContent}`)
    paidCalls = true
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    await waitFor(() => expect(screen.getByRole("radio", { name: "Real" })).toBeChecked())
    expect([...document.querySelectorAll("[data-record]")].map((li) => `${li.getAttribute("data-record")}=${badge(li as HTMLElement)?.textContent}`)).toEqual(before)
    vi.useRealTimers()
  })
  it("shows no badge for a review that has not said yet, rather than guessing from the mode", async () => {
    routes({ "GET /api/search": { status: 200, body: [board("b-silent", "kras", T)] }, "GET /api/glhf/status": { status: 200, body: { paidCalls: true } } })
    render(<ExperimentsView onOpen={() => {}} />)
    expect(badge(await rowOf("b-silent"))).toBeNull()
  })
})

describe("runs of the same brief are one row", () => {
  it("groups the practice runs of one brief, keeps the live run of that brief apart, and never groups a similar name", async () => {
    show(false)
    await waitFor(async () => expect(badge(await rowOf("b-p3"))).toHaveTextContent(/^Practice$/))
    const top = () => [...document.querySelectorAll('ul[aria-label="Saved research"] > li')].map((li) => li.getAttribute("data-record"))
    await waitFor(() => expect(top()).toEqual(["answer:a-live", "answer:a-demo", "board:b-live", "board:b-p3", "board:b-other", "board:b-chat-1", "board:b-chat-2", "swarm:s-mock"]))
    const practice = await rowOf("b-p3")
    expect(within(practice).getByText((_, el) => el?.tagName === "SUMMARY" && /^3 runs, latest 14 Nov 21:07$/.test(el.textContent ?? ""))).toBeInTheDocument()
    expect([...practice.querySelectorAll("li")].map((li) => li.getAttribute("data-record"))).toEqual(["board:b-p2", "board:b-p1"])
    expect((await rowOf("b-live")).querySelector("details")).toBeNull() // the one live run of the same brief stands alone
    for (const alone of ["b-other", "b-chat-1", "b-chat-2"]) expect((await rowOf(alone)).querySelector("details")).toBeNull()
    expect(screen.getByRole("status")).toHaveTextContent("11 records in 8 rows (repeat runs of a brief are grouped)") // nothing is lost
  })
  it("the same question asked twice is one row; a failed attempt in its history still says failed", async () => {
    show(false)
    const answer = await rowOf("a-demo")
    expect(within(answer).getByText((_, el) => el?.tagName === "SUMMARY" && /^2 runs, latest/.test(el.textContent ?? ""))).toBeInTheDocument()
    const earlier = answer.querySelector('li[data-record="answer:a-demo-2"]')!
    expect(earlier).toHaveTextContent("failed")
  })
})

describe("a row", () => {
  it("says what it is, when, and a result only where the record has one", async () => {
    show(false)
    const live = await rowOf("b-live")
    await waitFor(() => expect(live).toHaveTextContent("204 statements in 3 rounds")) // the list does not know how many were checked, so it does not say "checked"
    expect(live).toHaveTextContent("Team review"); expect(live).toHaveTextContent("14 Nov 21:08")
    const swarm = await rowOf("s-mock")
    expect(swarm).toHaveTextContent("Team of nine on the demo task"); expect(swarm).toHaveTextContent("Benchmark run"); expect(swarm).toHaveTextContent("Score 1.000 out of 1"); expect(swarm).toHaveTextContent("Demo task")
    expect((await rowOf("a-live")).querySelector(".record-result")).toBeNull()
  })
  it("keeps run ids out of the reading flow, and names benchmark runs in one pattern", async () => {
    routes({
      "GET /api/search": (r) => ({ status: 200, body: [
        { kind: "swarm", id: "202611142330-demo-glhf", title: "Task demo · swarm · mock", status: "done", startedAt: T, score: 1, matches: /q=2330/.test(r.query) ? [{ where: "run", text: "202611142330-demo-glhf task demo" }] : [] },
        { kind: "swarm", id: "202611142330-demo-single", title: "Task demo · single agent · mock", status: "done", startedAt: T - MIN, score: 1, matches: [] },
        { kind: "answer", id: "a-20261114233412-c49", title: "Is hERG a risk?", status: "done", startedAt: T - 2 * MIN, mode: "demo", matches: [] },
      ] }),
      "GET /api/glhf/runs": { status: 200, body: [{ id: "202611142330-demo-glhf", task: "demo", model: "mock", solver: "glhf", phase: "done" }, { id: "202611142330-demo-single", task: "demo", model: "mock", solver: "single", phase: "done" }] },
    })
    render(<ExperimentsView onOpen={() => {}} />)
    const team = await rowOf("202611142330-demo-glhf"), one = await rowOf("202611142330-demo-single")
    expect(team.querySelector(".record-titletext")).toHaveTextContent(/^Team of nine on the demo task$/)
    expect(one.querySelector(".record-titletext")).toHaveTextContent(/^One agent on the demo task$/) // the same pattern, never "Task demo · single agent · mock"
    await waitFor(() => expect([...one.querySelectorAll(".record-meta .pill, .record-meta [data-provenance]")].map((b) => b.textContent)).toEqual(["Practice", "Demo task"])) // one badge per fact
    const list = screen.getByRole("list", { name: "Saved research" })
    expect(list.textContent).not.toMatch(/2026\d{6,}|a-2026|mock|swarm|single agent|Task run/i) // no raw id and no internal word in the text
    expect(within(team).getByText("Benchmark run")).toHaveAttribute("title", "Run id: 202611142330-demo-glhf") // the id is a tooltip
    // an id is shown only when it is what the search found
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "Search saved research by word" }), "2330")
    await waitFor(async () => expect(await rowOf("202611142330-demo-glhf")).toHaveTextContent("run id: 202611142330-demo-glhf"))
  })
  it("Open goes to the right place for each kind", async () => {
    const t = show(false)
    const user = userEvent.setup()
    await user.click(within(await rowOf("a-live")).getByRole("button", { name: "Open: Does semaglutide lower heart risk?" }))
    expect(t.onOpen).toHaveBeenLastCalledWith("Home")
    expect(takeOpenAnswer()).toEqual({ id: "a-live", question: "Does semaglutide lower heart risk?" })
    await user.click(within(await rowOf("b-other")).getAllByRole("button", { name: /^Open:/ })[0])
    expect(t.onOpen).toHaveBeenLastCalledWith("Board"); expect(sessionStorage.getItem("open.board")).toBe("b-other")
    await user.click(within(await rowOf("s-mock")).getByRole("button", { name: /^Open:/ }))
    expect(t.onOpen).toHaveBeenLastCalledWith("Compare"); expect(sessionStorage.getItem("open.swarm")).toBe("s-mock")
  })
  it("a keyword search says it is keyword matches, newest first, and marks the word", async () => {
    routes({ "GET /api/search": (r) => ({ status: 200, body: /q=hERG/.test(r.query) ? [{ ...HITS[1], matches: [{ where: "answer", text: "the hERG margin is under 30x" }] }] : HITS }), "GET /api/glhf/status": { status: 200, body: {} } })
    render(<ExperimentsView onOpen={() => {}} />)
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "Search saved research by word" }), "hERG")
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 record with “hERG” · keyword matches, newest first"))
    const row = await rowOf("a-demo")
    expect([...row.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["hERG", "hERG"])
    expect(row).toHaveTextContent("answer: the hERG margin is under 30x")
  })
  it("filters by kind with plain names", async () => {
    show(false)
    await rowOf("a-live")
    expect(within(screen.getByRole("group", { name: "Kind of record" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Answers", "Team reviews", "Benchmark runs", "Examples"])
    await userEvent.setup().click(screen.getByRole("button", { name: "Answers" }))
    await waitFor(() => expect([...document.querySelectorAll('ul[aria-label="Saved research"] > li')].map((li) => li.getAttribute("data-record"))).toEqual(["answer:a-live", "answer:a-demo"]))
  })
})
