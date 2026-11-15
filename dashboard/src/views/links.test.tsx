// The links between views (lib/links.ts), each where a person meets it: the Agent Log links a run to its own view and its
// graph and opens on the agent an address names; Agents opens the card an address names and links it to its messages;
// Saved research links each record to its Agent Log and graph; Compare links a run to both; the Agent Lab's panel links
// the selected teammate to its messages.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LabEvent } from "@/lab/adapter"
import { PRACTICE_ANSWER, PRACTICE_REVIEW } from "@/lab/fixtures/practice"
import { T0 } from "@/lab/fixtures/streams"
import { LabPanel } from "@/lab/LabPanel"
import { answerLab, boardLab } from "@/lab/adapter"
import { forgetScripted } from "@/lib/scripted"
import { claimNodeId, sourceNodeId } from "@/graph/model"
import { graphLink } from "@/lib/links"
import { PAID_OFF, routes } from "@/test/engine"
import { CATALOG_ON } from "@/test/home"
import { AgentsView } from "./AgentsView"
import { BoardView } from "./BoardView"
import { SwarmView } from "./SwarmView"
import { ExperimentsView } from "./ExperimentsView"
import { LabView } from "./LabView"

class FakeSource {
  static all: FakeSource[] = []
  onmessage: ((m: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  closed = false
  url: string
  constructor(url: string) { this.url = url; FakeSource.all.push(this) }
  close() { this.closed = true }
  static to(part: string) { return FakeSource.all.filter((s) => s.url.includes(part)) }
}
const ok = (body: unknown) => ({ status: 200, body })
const emit = (source: FakeSource, events: LabEvent[]) => act(async () => { source.onopen?.(); for (const e of events) source.onmessage?.({ data: JSON.stringify(e) }); await vi.advanceTimersByTimeAsync(0) })
const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const REVIEW = { id: "r-practice", brief: "kras-g12c-hit-to-lead.md", startedAt: T0 - 60_000, status: "done", rounds: 3, claims: 13 }
const OLD_REVIEW = { ...REVIEW, id: "r-old", startedAt: T0 - 600_000 }
const ANSWER = { id: "a-practice", question: "Is hERG a risk for KRAS G12C inhibitors?", mode: "demo", status: "done", startedAt: T0 - 30_000 }
const lists = () => routes({ "GET /api/runs": ok([REVIEW, OLD_REVIEW]), "GET /api/research": ok({ items: [ANSWER] }), "GET /api/glhf/runs": ok([]) })

describe("the Agent Log", () => {
  beforeEach(() => {
    FakeSource.all = []; forgetScripted()
    vi.useFakeTimers(); vi.setSystemTime(T0 + 1000)
    vi.stubGlobal("EventSource", FakeSource)
  })
  afterEach(() => { vi.useRealTimers(); window.location.hash = "" })

  it("links a team review to its own page and its graph, and an answer to Research", async () => {
    lists()
    window.location.hash = "#Lab/board/r-practice"
    const { unmount } = render(<LabView />)
    await tick()
    await emit(FakeSource.to("/api/runs/r-practice/events")[0], PRACTICE_REVIEW)
    const elsewhere = within(screen.getByRole("navigation", { name: "This run elsewhere" }))
    expect(elsewhere.getByRole("link", { name: "Open the team review" })).toHaveAttribute("href", "#Board/r-practice")
    expect(elsewhere.getByRole("link", { name: "See it as a graph" })).toHaveAttribute("href", "#Graph/board/r-practice")
    unmount()
    window.location.hash = "#Lab/answer/a-practice"
    render(<LabView />)
    await tick()
    await emit(FakeSource.to("/api/research/a-practice/events")[0], PRACTICE_ANSWER)
    const research = within(screen.getByRole("navigation", { name: "This run elsewhere" }))
    expect(research.queryByRole("link", { name: /graph/ })).toBeNull() // an answer has no graph
    fireEvent.click(research.getByRole("link", { name: "Open in Research" }))
    expect(JSON.parse(sessionStorage.getItem("open.answer")!)).toEqual({ id: "a-practice", question: ANSWER.question }) // Research opens this answer
  })

  it("opens the newest run of a kind on the agent an address names, keeps both in the address, and a face changes the agent", async () => {
    lists()
    window.location.hash = "#Lab/board?agent=critic"
    render(<LabView />)
    await tick()
    expect(FakeSource.to("/api/runs/r-practice/events")).toHaveLength(1) // the newest review, not the older one
    await emit(FakeSource.to("/api/runs/r-practice/events")[0], PRACTICE_REVIEW)
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveTextContent(/^Critic/)
    expect(window.location.hash).toBe("#Lab/board/r-practice?agent=critic")
    fireEvent.click(screen.getAllByRole("button", { name: /^Show every agent$/ })[0])
    expect(window.location.hash).toBe("#Lab/board/r-practice")
    fireEvent.click(screen.getAllByRole("button", { name: /^Show only Scout.*'s messages$/ })[0])
    expect(window.location.hash).toBe("#Lab/board/r-practice?agent=scout")
    expect(screen.getByRole("link", { name: "About this agent" })).toHaveAttribute("href", "#Agents/scout?from=board")
  })

  it("follows Back and Forward between two agents of the same run", async () => {
    lists()
    window.location.hash = "#Lab/board/r-practice?agent=critic"
    render(<LabView />)
    await tick()
    await emit(FakeSource.to("/api/runs/r-practice/events")[0], PRACTICE_REVIEW)
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveTextContent(/^Critic/)
    await act(async () => { window.location.hash = "#Lab/board/r-practice?agent=scout"; window.dispatchEvent(new HashChangeEvent("hashchange")); await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveTextContent(/^Scout/)
  })
})

describe("Agents", () => {
  const ROLES = { shared_rules: "Write only what you did.", roles: [] }
  const show = () => {
    routes({ "GET /api/chat/catalog": ok(CATALOG_ON), "GET /api/glhf/roles": ok(ROLES), "GET /api/glhf/runs": ok([]) })
    return render(<AgentsView />)
  }
  afterEach(() => { window.location.hash = "" })

  it("opens the card an address names, as the team the run belongs to, and links it to its messages", async () => {
    window.location.hash = "#Agents/critic?from=board"
    show()
    const panel = await screen.findByRole("dialog", { name: "Critic (Scientific Reviewer)" }) // the review's critic, not the team of nine's
    expect(within(panel).getByRole("link", { name: /messages in the Agent Log/ })).toHaveAttribute("href", "#Lab/board?agent=critic")
    expect(window.location.hash).toBe("#Agents/critic?from=board")
  })
  it("a benchmark run's name opens the team of nine's card", async () => {
    window.location.hash = "#Agents/critique?from=swarm"
    show()
    const panel = await screen.findByRole("dialog", { name: "Critic" })
    expect(within(panel).getByRole("link", { name: /messages in the Agent Log/ })).toHaveAttribute("href", "#Lab/swarm?agent=critique")
  })
  it("a research answer's step opens no card, even one named like a team member", async () => {
    window.location.hash = "#Agents/critic?from=answer"
    show()
    await screen.findByRole("heading", { name: "Toxicologist" })
    await waitFor(() => expect(window.location.hash).toBe("#Agents"))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
  it("the open card is in the address, and closing it takes it out", async () => {
    window.location.hash = "#Agents"
    show()
    await screen.findByRole("heading", { name: "Toxicologist" })
    await userEvent.setup().click(screen.getByRole("button", { name: "Details of Toxicologist" }))
    await waitFor(() => expect(window.location.hash).toBe("#Agents/toxicologist?from=board"))
    await userEvent.setup().keyboard("{Escape}")
    await waitFor(() => expect(window.location.hash).toBe("#Agents"))
  })
})

describe("Saved research", () => {
  beforeEach(() => forgetScripted())
  it("links every record to its Agent Log, and a review or a benchmark run to its graph", async () => {
    routes({
      "GET /api/search": ok([
        { kind: "answer", id: "a-1", title: "Is hERG a risk?", status: "done", startedAt: 3, mode: "demo", matches: [] },
        { kind: "board", id: "b-1", title: "Drug board · kras", status: "done", startedAt: 2, matches: [] },
        { kind: "swarm", id: "s-1", title: "Task demo · swarm · mock", status: "done", startedAt: 1, score: 1, matches: [] },
      ]),
      "GET /api/glhf/runs": ok([]), "GET /api/runs": ok([]), "GET /api/runs/b-1/events": ok(""),
    })
    render(<ExperimentsView onOpen={() => {}} />)
    const links = async (id: string) => { const row = await waitFor(() => { const r = document.querySelector<HTMLElement>(`li[data-record$=":${id}"]`); expect(r).not.toBeNull(); return r! }); return [...row.querySelectorAll("a.record-link")].map((a) => `${a.textContent} ${a.getAttribute("href")}`) }
    expect(await links("a-1")).toEqual(["Agent Log #Lab/answer/a-1"])
    expect(await links("b-1")).toEqual(["Agent Log #Lab/board/b-1", "Graph #Graph/board/b-1"])
    expect(await links("s-1")).toEqual(["Agent Log #Lab/swarm/s-1", "Graph #Graph/swarm/s-1"])
  })
})

describe("the Agent Lab's panel", () => {
  it("links the selected teammate to its messages of this run in the Agent Log", () => {
    const review = boardLab(PRACTICE_REVIEW, "r-practice")
    const { unmount } = render(<LabPanel model={review} selected="navigator" />)
    expect(screen.getByRole("link", { name: /in the Agent Log$/ })).toHaveAttribute("href", "#Lab/board/r-practice?agent=navigator")
    unmount()
    const answer = answerLab(PRACTICE_ANSWER, "a-practice")
    render(<LabPanel model={answer} selected="reporter" />)
    expect(screen.getByRole("link", { name: /in the Agent Log$/ })).toHaveAttribute("href", "#Lab/answer/a-practice?agent=reporter")
  })
  it("has no link for a teammate that is not in the run, or before there is a run", () => {
    const review = boardLab(PRACTICE_REVIEW, "r-practice")
    render(<LabPanel model={review} selected="librarian" />) // a review's searches are all the Scout's
    expect(screen.queryByRole("link", { name: /in the Agent Log$/ })).toBeNull()
  })
})

describe("Team review and Compare", () => {
  const streams: { url: string; onmessage?: (m: { data: string }) => void; close: () => void }[] = []
  beforeEach(() => {
    streams.length = 0; forgetScripted()
    vi.stubGlobal("EventSource", class { url: string; onmessage?: (m: { data: string }) => void; constructor(url: string) { this.url = url; streams.push(this) } close() {} })
  })
  const send = (event: object) => act(() => { for (const s of streams) s.onmessage?.({ data: JSON.stringify({ key: JSON.stringify(event), at: 0, ...event }) }) })
  const ROSTER = [{ name: "scout", title: "Scout (Data Inspector)", role: "member", model: "cheap", modelId: "m", tools: [] }]
  const SRC = "https://example.org/paper"

  it("a review links to its Agent Log and graph; a member to its messages; a source and a statement to their graph nodes", async () => {
    routes({
      "GET /api/status": ok({ mock: true, paidCalls: false, keys: {}, meeting: { max_minutes: 15, max_usd: 5, max_rounds: 4 } }), "GET /api/roster": ok(ROSTER), "GET /api/briefs": ok(["kras.md"]),
      "GET /api/runs": ok([{ id: "run-1", brief: "kras.md", rounds: 1, startedAt: 1, status: "done", claims: 1 }]), "GET /api/runs/run-1/memo": ok(""),
    })
    render(<BoardView />)
    await waitFor(() => expect(streams.length).toBeGreaterThan(0))
    await send({ type: "run.started", runId: "run-1", brief: "kras", title: "KRAS", mock: true })
    await send({ type: "evidence.triaged", member: "scout", query: "hERG", kept: 1, dropped: 0, provider: "exa", items: [{ url: SRC, title: "A paper", text: "t" }] })
    await send({ type: "member.replied", round: 1, member: "scout", text: "The margin is thin." })
    await send({ type: "claim.checked", round: 1, member: "scout", claim: "The margin is thin", kind: "web", verdict: "verified", checker: "first-pass", source: SRC })
    await send({ type: "run.finished", usd: 0, minutes: 0.1 })
    const next = within(screen.getByRole("navigation", { name: "What you can do next" }))
    expect(next.getByRole("link", { name: "Open in the Agent Log" })).toHaveAttribute("href", "#Lab/board/run-1")
    expect(next.getByRole("link", { name: "See this run as a graph" })).toHaveAttribute("href", "#Graph/board/run-1")
    expect(within(screen.getByRole("list", { name: "Who took part" })).getByRole("link", { name: /Scout: messages in the Agent Log/ })).toHaveAttribute("href", "#Lab/board/run-1?agent=scout")
    const sources = within(screen.getByRole("region", { name: "Sources" }))
    expect(sources.getAllByRole("link", { name: "In the graph" })[0]).toHaveAttribute("href", graphLink("board", "run-1", sourceNodeId(SRC)))
    expect(sources.getByRole("link", { name: "Show in the graph: The margin is thin" })).toHaveAttribute("href", graphLink("board", "run-1", claimNodeId("scout", "The margin is thin")))
    // The check is a quiet note in the discussion (the Agent Log's chat); it links to the statement's node.
    expect(within(screen.getByRole("list", { name: "Run events" })).getByRole("link", { name: "Show this statement and its checks in the graph" })).toHaveAttribute("href", graphLink("board", "run-1", claimNodeId("scout", "The margin is thin")))
  })

  it("a benchmark run links to its Agent Log and graph", async () => {
    const RUN = { id: "s-mock", mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase: "done", startedAt: Date.now() - 60_000, finishedAt: Date.now() - 43_000, score: 1, settings: { timeLimit: 1800 } }
    routes({ "GET /api/glhf/status": ok(PAID_OFF), "GET /api/glhf/runs": ok([RUN]), "GET /api/glhf/scoreboard": ok([]),
      "GET /api/glhf/runs/s-mock": ok({ run: RUN, ledger: { alpha: 0.1, kappa: 1, issues: [], claims: [], events: [] }, findings: null, methods: null }) })
    render(<SwarmView />)
    const next = within(await screen.findByRole("navigation", { name: "What you can do next" }))
    expect(next.getByRole("link", { name: "Open in the Agent Log" })).toHaveAttribute("href", "#Lab/swarm/s-mock")
    expect(next.getByRole("link", { name: "See this run as a graph" })).toHaveAttribute("href", "#Graph/swarm/s-mock")
  })
})
