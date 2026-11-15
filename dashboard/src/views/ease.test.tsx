// Easy to use without instructions: the first visit, where you were, a link to a run, help on every view, and a
// next step after every result.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { HowItWorks } from "@/components/HowItWorks"
import { StatusLine } from "@/components/StatusLine"
import { lastRun, linkTo, showing } from "@/lib/open"
import { forgetScripted } from "@/lib/scripted"
import { initialView, rememberView, runOfHash, viewOfHash } from "@/nav"
import { routes, to } from "@/test/engine"
import { CATALOG_OFF, CATALOG_ON } from "@/test/home"
import { BoardView } from "./BoardView"
import { HomeView } from "./HomeView"

const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
beforeEach(() => {
  streams.length = 0; forgetScripted(); window.location.hash = ""
  vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
})
const emit = (event: object) => act(() => { for (const s of streams) s.onmessage?.({ data: JSON.stringify({ key: JSON.stringify(event), at: 0, ...event }) }) })

describe("first visit", () => {
  const home = (catalog: unknown) => {
    const sent = routes({ "GET /api/chat/catalog": { status: 200, body: catalog }, "GET /api/status": { status: 200, body: {} }, "GET /api/runs": { status: 200, body: [] }, "GET /api/glhf/scoreboard": { status: 200, body: [] },
      "POST /api/chat": { status: 200, body: { reply: "ok", mode: "scripted" } } })
    render(<HomeView onOpen={() => {}} />)
    return sent
  }
  it("is one clear thing: the headline, the search box right under it, and three short examples that send in one click", async () => {
    const sent = home(CATALOG_OFF)
    const headline = screen.getByRole("heading", { level: 1, name: "What do you want to research?" })
    expect(screen.getByText("Ask a question. Explore evidence and sources.")).toBeInTheDocument()
    const box = screen.getByRole("textbox", { name: "Ask a research question" })
    expect(box).toHaveAttribute("placeholder", "Ask a research question…")
    expect(headline.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // the box comes right after the headline
    const examples = within(screen.getByRole("group", { name: "Example questions" })).getAllByRole("button")
    expect(examples).toHaveLength(3)
    for (const e of examples) expect(e.textContent!.length).toBeLessThanOrEqual(60)
    expect(box.compareDocumentPosition(examples[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.setup().click(examples[0])
    await waitFor(() => expect(to(sent, "POST", "/api/chat")).toHaveLength(1)) // filled and sent, one click
  })
  it("has no setup cards, model names, key status or agent lists until they are asked for", async () => {
    home(CATALOG_ON)
    await screen.findByRole("radio", { name: "Standard" })
    expect(screen.queryByRole("complementary", { name: "What this can use" })).toBeNull()
    // nothing technical in the open; the one model list sits inside the closed "Research options"
    expect(screen.queryAllByText(/key present|key missing|claude-|gpt-|ANTHROPIC|\.env/i).filter((e) => !e.closest("details:not([open])"))).toEqual([])
    await userEvent.setup().click(screen.getByRole("button", { name: "Recent results and setup" }))
    expect(await screen.findByRole("complementary", { name: "What this can use" })).toBeInTheDocument()
  })
  it("explains Demo mode once, in the owner's words", async () => {
    home(CATALOG_OFF)
    const note = await screen.findByRole("note")
    expect(note).toHaveTextContent("Demo mode. AI answers and web search are unavailable. You can search saved research.")
    expect(screen.getAllByText(/AI answers and web search are unavailable/)).toHaveLength(1)
  })
  it("does not say Demo when the engine can use real models", async () => {
    home(CATALOG_ON)
    await screen.findByRole("radio", { name: "Standard" })
    expect(screen.queryByText(/Demo mode/)).toBeNull()
  })
  it("keeps Quick, Standard and Deep in one compact selector, and everything advanced under Research options", async () => {
    home(CATALOG_OFF)
    const pick = within(await screen.findByRole("group", { name: "Effort" }))
    expect(pick.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["quick", "standard", "deep"])
    expect(pick.getByRole("radio", { name: "Standard" }).closest("label")).toHaveAttribute("title", expect.stringMatching(/up to 15 minutes · up to \$5\.00/)) // each option explains itself
    const options = screen.getByText("Research options").closest("details")!
    expect(options).not.toHaveAttribute("open")
    expect(within(options).getByLabelText("Model")).toBeInTheDocument()
    expect(options).toHaveTextContent("You see the plan, its limits and its cost before anything starts.")
  })
})

describe("where you were", () => {
  it("reopening returns to the last view; an address that names a view wins", () => {
    expect(initialView("")).toBe("Home")
    rememberView("Board")
    expect(initialView("")).toBe("Board")
    expect(initialView("#Runs")).toBe("Runs")
    localStorage.setItem("app.view", "Nowhere")
    expect(initialView("")).toBe("Home")
  })
  it("an address can name a run, and only something shaped like a run id", () => {
    expect(viewOfHash("#Board/202611150024-kras-1060e203")).toBe("Board")
    expect(runOfHash("#Board/202611150024-kras-1060e203")).toBe("202611150024-kras-1060e203")
    expect(runOfHash("#Board")).toBeUndefined()
    expect(runOfHash("#Board/../../etc")).toBeUndefined()
    expect(runOfHash("#Board/<script>")).toBeUndefined()
    expect(linkTo("board", "run-1")).toMatch(/#Board\/run-1$/)
    expect(linkTo("swarm", "s-1")).toMatch(/#Compare\/s-1$/)
  })
  it("the run a view shows is remembered and put in the address", () => {
    window.location.hash = "#Board"
    showing("board", "run-7")
    expect(lastRun("board")).toBe("run-7")
    expect(window.location.hash).toBe("#Board/run-7")
    window.location.hash = "#Home"
    showing("board", "run-8") // another view is on screen: its address is left alone
    expect(window.location.hash).toBe("#Home")
    expect(lastRun("board")).toBe("run-8")
  })
})

describe("help and next steps", () => {
  it("How this works is reachable from the status line on every view, and is four plain steps", async () => {
    const onHelp = vi.fn()
    render(<StatusLine shell={{ engine: "online", paid: "off" }} onOpenSettings={() => {}} onHelp={onHelp} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "How this works" }))
    expect(onHelp).toHaveBeenCalled()
    render(<HowItWorks open onClose={() => {}} />)
    const steps = within(screen.getByRole("list", { name: "The four steps" })).getAllByRole("listitem")
    expect(steps.map((s) => s.querySelector("b")!.textContent)).toEqual(["You ask", "A team discusses", "Every statement is checked", "You get an answer"])
    expect(screen.getByRole("dialog")).toHaveTextContent("Nothing that costs money ever starts without asking you first.")
  })
  it("a finished review offers what to do next, and reopens on the review shown last time", async () => {
    localStorage.setItem("last.board", "run-2")
    routes({
      "GET /api/status": { status: 200, body: { mock: true, paidCalls: false, keys: {}, meeting: { max_minutes: 15, max_usd: 5, max_rounds: 4 } } }, "GET /api/roster": { status: 200, body: [] }, "GET /api/briefs": { status: 200, body: ["kras.md"] },
      "GET /api/runs": { status: 200, body: [{ id: "run-1", brief: "a.md", rounds: 1, startedAt: 2, status: "done", claims: 0 }, { id: "run-2", brief: "b.md", rounds: 1, startedAt: 1, status: "done", claims: 0 }] },
    })
    render(<BoardView />)
    await waitFor(() => expect(streams.some((s) => s.url.endsWith("/api/runs/run-2/events"))).toBe(true)) // not the newest: the one from last time
    await emit({ type: "run.started", runId: "run-2", brief: "b", title: "B", mock: true })
    await emit({ type: "run.finished", usd: 0, minutes: 0.1 })
    const next = within(screen.getByRole("navigation", { name: "What you can do next" }))
    expect(next.getByRole("link", { name: "Ask a follow-up" })).toHaveAttribute("href", "#Home")
    expect(next.getByRole("link", { name: "Watch it as a graph" })).toHaveAttribute("href", "#Graph")
    await userEvent.setup().click(next.getByRole("button", { name: "See how each statement was checked" }))
    expect(screen.getByRole("heading", { name: "Every check, counted" })).toBeInTheDocument()
    expect(next.getByRole("button", { name: "Copy a link to this review" })).toBeInTheDocument()
  })
})
