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
  it("says what this is in one sentence, and offers three examples that send in one click", async () => {
    const sent = home(CATALOG_OFF)
    expect(screen.getByRole("heading", { name: "Ask a science question." })).toBeInTheDocument()
    expect(screen.getByText("A team of AI agents works on it, and every statement they make gets checked.")).toBeInTheDocument()
    const examples = within(screen.getByRole("group", { name: "Example questions" })).getAllByRole("button")
    expect(examples).toHaveLength(3)
    await userEvent.setup().click(examples[0])
    await waitFor(() => expect(to(sent, "POST", "/api/chat")).toHaveLength(1)) // filled and sent, one click
  })
  it("says once, kindly, when only practice runs are possible; and not when real runs are", async () => {
    home(CATALOG_OFF)
    expect(await screen.findByText("You're in Demo mode. Answers are fixed examples, so you can see how it works for free.")).toBeInTheDocument()
  })
  it("does not say Demo when the engine can use real models", async () => {
    home(CATALOG_ON)
    await screen.findAllByText("Real: costs money")
    expect(screen.queryByText(/You're in Demo mode/)).toBeNull()
  })
  it("keeps effort and the model list out of the way, under More options", async () => {
    home(CATALOG_OFF)
    const more = (await screen.findByRole("radio", { name: "Standard", hidden: true })).closest("details")!
    expect(more).not.toHaveAttribute("open")
    expect(within(more).getByText("More options")).toBeInTheDocument()
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
