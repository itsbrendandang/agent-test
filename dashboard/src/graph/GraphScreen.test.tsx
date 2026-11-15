import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PRACTICE } from "@/lib/words"
import { routes } from "@/test/engine"
import { BOARD_EVENTS, EVIL, PRACTICE_EVENTS, ROSTER, SWARM_DETAIL, SINGLE_DETAIL } from "./fixtures"

// jsdom has no WebGL: the renderer is replaced by a recorder, and WebGL support is switched per test.
const fake = vi.hoisted(() => ({
  calls: [] as string[], throwOnCreate: false, destroyed: 0, data: [] as { nodes: { id: string }[]; links: unknown[] }[],
  styles: [] as { selected: string | null; neighbours: ReadonlySet<string>; pulse?: ReadonlySet<string> }[], reveals: [] as { nodes: ReadonlySet<string> | null; links: ReadonlySet<string> | null }[], paused: [] as boolean[], flown: [] as string[], webgl: true,
  onSelect: undefined as undefined | ((id: string | null) => void),
}))
vi.mock("./renderer", () => ({
  createRenderer: (_el: HTMLElement, o: { onSelect: (id: string | null) => void }) => {
    if (fake.throwOnCreate) throw new Error("no context")
    fake.calls.push("create"); fake.onSelect = o.onSelect
    return {
      setData: (nodes: { id: string }[], links: unknown[]) => fake.data.push({ nodes, links }),
      setStyle: (s: { selected: string | null; neighbours: ReadonlySet<string> }) => fake.styles.push(s),
      setReveal: (nodes: ReadonlySet<string> | null, links: ReadonlySet<string> | null) => fake.reveals.push({ nodes, links }),
      fly: (id: string) => fake.flown.push(id), fit: () => fake.calls.push("fit"), setPaused: (p: boolean) => fake.paused.push(p),
      resize: () => undefined, destroy: () => { fake.destroyed++ },
    }
  },
}))
vi.mock("./env", async (orig) => ({ ...(await orig<typeof import("./env")>()), webglAvailable: () => fake.webgl }))

import { WorldsView } from "@/views/WorldsView"

class FakeEventSource {
  static all: FakeEventSource[] = []
  onmessage: ((m: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 1
  closed = false
  url: string
  constructor(url: string) { this.url = url; FakeEventSource.all.push(this) }
  close() { this.closed = true; this.readyState = 2 }
  emit(e: unknown) { this.onmessage?.({ data: JSON.stringify(e) }) }
}
const T = 1_700_000_000_000
const boardRun = { id: "r1", brief: "kras.md", startedAt: T + 10, status: "done", rounds: 2, claims: 6 }
const swarmRun = { ...SWARM_DETAIL.run, startedAt: T }
const lists = { "GET /api/runs": { status: 200, body: [boardRun] }, "GET /api/glhf/runs": { status: 200, body: [swarmRun] }, "GET /api/roster": { status: 200, body: ROSTER } }
const swarmRoutes = { "GET /api/glhf/runs/s1": { status: 200, body: SWARM_DETAIL }, "GET /api/glhf/runs/s2": { status: 200, body: SINGLE_DETAIL } }
const streamBoard = async (events = BOARD_EVENTS) => {
  await waitFor(() => expect(FakeEventSource.all.length).toBeGreaterThan(0))
  act(() => { for (const e of events) FakeEventSource.all.at(-1)!.emit(e) })
}
const CONTRADICTED = /^claim:scout:/
/** The id of the contradicted claim, as the renderer received it (its id ends in a short hash of the claim text). */
const claimId = () => fake.data.at(-1)!.nodes.map((n) => n.id).find((id) => CONTRADICTED.test(id) && (fake.data.at(-1)!.nodes.find((n) => n.id === id) as { label?: string }).label?.startsWith("Piperazine"))!
const detail = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }))
const listMode = () => fireEvent.click(screen.getByRole("button", { name: "List" }))

beforeEach(() => {
  fake.calls = []; fake.throwOnCreate = false; fake.destroyed = 0; fake.data = []; fake.styles = []; fake.reveals = []; fake.paused = []; fake.flown = []; fake.webgl = true
  FakeEventSource.all = []
  vi.stubGlobal("EventSource", FakeEventSource)
  location.hash = ""
})
afterEach(() => { vi.unstubAllGlobals() })

describe("Graph view", () => {
  it("opens the newest run, here the board run, and draws it", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    await waitFor(() => expect(fake.calls).toContain("create"))
    await waitFor(() => expect(fake.data.at(-1)?.nodes.length).toBeGreaterThan(8))
    expect(screen.getByRole("combobox", { name: /run/i })).toHaveValue("board:r1")
    expect(screen.getByText(/nodes?, \d+ lines? shown/)).toBeInTheDocument()
  })

  it("labels a scripted run from the run's own flag, and a real one as real", async () => {
    routes(lists)
    const { unmount } = render(<WorldsView />)
    await streamBoard()
    expect(await screen.findByTestId("scripted-label")).toHaveTextContent(PRACTICE)
    expect(screen.getByTestId("scripted-banner")).toHaveTextContent(PRACTICE)
    unmount()
    FakeEventSource.all = []
    routes(lists)
    render(<WorldsView />)
    await streamBoard(BOARD_EVENTS.map((e) => (e.type === "run.started" ? { ...e, mock: false } : e)))
    expect(await screen.findByText("real model")).toBeInTheDocument()
    expect(screen.queryByTestId("scripted-banner")).toBeNull()
  })

  it("says when a run does not record whether it was scripted", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard(BOARD_EVENTS.filter((e) => e.type !== "run.started"))
    expect(await screen.findByText("mode not recorded")).toBeInTheDocument()
    expect(screen.queryByTestId("scripted-banner")).toBeNull()
  })

  it("shows a swarm run as scripted and as a demo case from its fields", async () => {
    sessionStorage.setItem("open.swarm", "s1")
    routes({ ...lists, ...swarmRoutes })
    render(<WorldsView />)
    expect(await screen.findByTestId("scripted-label")).toHaveTextContent(PRACTICE)
    expect(screen.getByText(/demo case/)).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: /run/i })).toHaveValue("swarm:s1")
  })

  it("explains a single-agent run, which has no shared record of claims", async () => {
    sessionStorage.setItem("open.swarm", "s2")
    routes({ ...lists, ...swarmRoutes })
    render(<WorldsView />)
    expect(await screen.findByTestId("headline")).toHaveTextContent("One agent worked alone, so there are no statements to check.")
    expect(screen.getByText(/single agent keeps no shared record/i)).toBeInTheDocument() // in "What this graph cannot show"
  })

  it("falls back to the list, with a plain message, when WebGL is not available", async () => {
    fake.webgl = false
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    expect(await screen.findByText(/3D view is not available here/)).toHaveTextContent("cannot make a WebGL context")
    expect(screen.getByRole("table", { name: /nodes of the graph/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "3D graph" })).toBeDisabled()
    expect(fake.calls).not.toContain("create")
  })

  it("falls back to the list when the renderer fails to start", async () => {
    fake.throwOnCreate = true
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    expect(await screen.findByText(/The 3D view could not start: no context/)).toBeInTheDocument()
    expect(screen.getByRole("table", { name: /nodes of the graph/i })).toBeInTheDocument()
  })

  it("lists the same nodes with their connections, contradicted first, and keeps untrusted text as text", async () => {
    routes(lists)
    const { container } = render(<WorldsView />)
    await streamBoard()
    listMode()
    const table = await screen.findByRole("table", { name: /nodes of the graph/i })
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows[0]).toHaveTextContent("Proven wrong")
    expect(rows[0].querySelector(".pill.v-contradicted")).not.toBeNull() // the dashboard's own pill: its glyph comes from CSS
    expect(rows[0]).toHaveTextContent(EVIL.slice(0, 20)) // the markup is shown as text
    expect(container.querySelector("img")).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    expect(within(rows[0]).getByRole("button", { name: /Scout \(Data Inspector\) said/ })).toBeInTheDocument()
  })

  it("selects a node from the list: panel with the claim, verdict, who wrote it and a link to the run", async () => {
    routes(lists)
    const { container } = render(<WorldsView />)
    await streamBoard()
    listMode()
    const firstRow = async () => within(await screen.findByRole("table", { name: /nodes of the graph/i })).getAllByRole("row")[1]
    fireEvent.click(within(await firstRow()).getAllByRole("button")[0])
    const panel = await screen.findByTestId("node-panel")
    expect(panel).toHaveTextContent("Piperazine quinazolines show no hERG")
    expect(panel).toHaveTextContent("Proven wrong")
    expect(panel).toHaveTextContent("contradicted") // the checker's own word, as a second line
    expect(panel).toHaveTextContent("Said by")
    expect(panel).toHaveTextContent("Scout (Data Inspector)")
    expect(panel).toHaveTextContent("Cited source")
    expect(panel).toHaveTextContent("Statement")
    expect(panel).toHaveTextContent("claim") // the technical term sits next to the plain one
    expect(container.querySelector("img")).toBeNull()
    expect(fake.flown).toEqual([]) // list mode: nothing to fly
    // selection is kept in sync with the list
    expect(within(await firstRow()).getAllByRole("button")[0]).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(within(panel).getByRole("button", { name: /Open this run in Board/ }))
    expect(sessionStorage.getItem("open.board")).toBe("r1")
    expect(location.hash).toBe("#Board")
  })

  it("links a swarm run to Compare", async () => {
    sessionStorage.setItem("open.swarm", "s1")
    routes({ ...lists, ...swarmRoutes })
    render(<WorldsView />)
    await screen.findByTestId("scripted-label")
    fireEvent.click(screen.getAllByRole("button", { name: /Open this run in Compare/ })[0])
    expect(sessionStorage.getItem("open.swarm")).toBe("s1")
    expect(location.hash).toBe("#Compare")
  })

  it("highlights a selected node's neighbours in the renderer and flies to it", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    await waitFor(() => expect(fake.onSelect).toBeDefined())
    await waitFor(() => expect(fake.data.at(-1)?.nodes.length).toBeGreaterThan(8))
    // the calm view draws members and claims only, so this claim's neighbour is the member who wrote it
    const contradicted = claimId()
    act(() => fake.onSelect!(contradicted))
    await waitFor(() => expect(fake.styles.at(-1)?.selected).toBe(contradicted))
    expect([...fake.styles.at(-1)!.neighbours]).toEqual(["agent:scout"])
    expect(fake.flown.at(-1)).toBe(contradicted)
    expect(await screen.findByTestId("node-panel")).toBeInTheDocument()
    act(() => fake.onSelect!(null))
    await waitFor(() => expect(screen.queryByTestId("node-panel")).toBeNull())
  })

  it("starts calm: members and claims only, and shows how each was checked on request", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    listMode()
    const kinds = () => new Set(within(screen.getByRole("table", { name: /nodes of the graph/i })).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent))
    await waitFor(() => expect(kinds().size).toBeGreaterThan(0))
    expect(kinds()).toEqual(new Set(["Run", "Team member", "Statement"]))
    expect(screen.getByRole("button", { name: "Team members and statements" })).toHaveAttribute("aria-pressed", "true")
    detail("Show how each was checked")
    await waitFor(() => expect(kinds().has("Checker")).toBe(true))
    expect(kinds().has("Source")).toBe(true)
    expect(kinds().has("Round")).toBe(false)
    expect(screen.getByRole("button", { name: "Show how each was checked" })).toHaveAttribute("aria-pressed", "true")
    detail("Everything")
    await waitFor(() => expect(kinds().has("Round")).toBe(true))
    expect(kinds().has("Output")).toBe(true)
  })

  it("shows everything for a run without claims, since members and claims would be an empty picture", async () => {
    sessionStorage.setItem("open.swarm", "s2")
    routes({ ...lists, ...swarmRoutes })
    render(<WorldsView />)
    await screen.findByTestId("headline")
    await waitFor(() => expect(fake.data.at(-1)?.nodes.map((n) => n.id)).toContain("artifact:gene_counts"))
  })

  it("answers what happened in one sentence from the run's data", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    expect(await screen.findByTestId("headline")).toHaveTextContent("Over 2 rounds, 4 team members made 5 statements: 2 held up, 1 was proven wrong, 2 had too little evidence.")
  })

  it("says plainly when a run has no claims", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard(BOARD_EVENTS.filter((e) => e.type !== "claim.checked"))
    expect(await screen.findByTestId("headline")).toHaveTextContent("took part, but no statements were recorded, so there is nothing to check.")
  })

  it("describes the current practice board run: two members, two claims", async () => {
    routes({ ...lists, "GET /api/runs": { status: 200, body: [{ ...boardRun, claims: 4 }] } })
    render(<WorldsView />)
    await streamBoard(PRACTICE_EVENTS)
    expect(await screen.findByTestId("headline")).toHaveTextContent("Over 2 rounds, 2 team members made 2 statements: 2 had too little evidence.")
    expect(screen.getByTestId("scripted-label")).toHaveTextContent(PRACTICE)
  })

  it("filters by kind and by verdict, in the graph and the list", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    listMode()
    const table = await screen.findByRole("table", { name: /nodes of the graph/i })
    const kindCount = (k: string) => within(table).getAllByRole("row").slice(1).filter((r) => within(r).queryAllByRole("cell")[0]?.textContent === k).length
    expect(kindCount("Statement")).toBe(5)
    fireEvent.click(screen.getByRole("checkbox", { name: "Statement" }))
    await waitFor(() => expect(kindCount("Statement")).toBe(0))
    fireEvent.click(screen.getByRole("checkbox", { name: "Statement" }))
    fireEvent.click(screen.getByRole("checkbox", { name: /Holds up/ }))
    fireEvent.click(screen.getByRole("checkbox", { name: /Not enough evidence/ }))
    await waitFor(() => expect(kindCount("Statement")).toBe(1))
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Proven wrong")
  })

  it("searches and flies to the match, contradicted first", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    await waitFor(() => expect(fake.onSelect).toBeDefined())
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the graph" }), { target: { value: "hERG" } })
    expect(await screen.findByText(/matches?; Enter for the next/)).toBeInTheDocument()
    fireEvent.submit(screen.getByRole("search"))
    await waitFor(() => expect(fake.flown.at(-1)).toBe(claimId()))
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the graph" }), { target: { value: "zzzz" } })
    expect(await screen.findByText("No match")).toBeInTheDocument()
  })

  it("jumps to contradicted and refuted claims first", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    await waitFor(() => expect(fake.onSelect).toBeDefined())
    const jump = await screen.findByRole("button", { name: /Next one proven wrong \(1\)/ })
    fireEvent.click(jump)
    await waitFor(() => expect(fake.flown.at(-1)).toBe(claimId()))
  })

  it("steps through time: nothing but the run at step 0, everything at the end", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    listMode()
    detail("Everything")
    const slider = await screen.findByRole("slider", { name: "Step through the run" })
    fireEvent.change(slider, { target: { value: "0" } })
    const table = screen.getByRole("table", { name: /nodes of the graph/i })
    expect(within(table).getAllByRole("row")).toHaveLength(2) // header and the run
    fireEvent.click(screen.getByRole("button", { name: "Round 1" })) // up to the end of round 1
    await waitFor(() => expect(within(screen.getByRole("table", { name: /nodes of the graph/i })).queryByText("Round 2")).toBeNull())
    expect(within(screen.getByRole("table", { name: /nodes of the graph/i })).getByText("Round 1")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show all" }))
    await waitFor(() => expect(within(screen.getByRole("table", { name: /nodes of the graph/i })).getByText("Round 2")).toBeInTheDocument())
  })

  it("keeps nodes where they are during a replay: it reveals them, it does not rebuild the layout", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    await waitFor(() => expect(fake.data.length).toBeGreaterThan(0))
    const all = fake.data.at(-1)!.nodes.length
    const slider = await screen.findByRole("slider", { name: "Step through the run" })
    fireEvent.change(slider, { target: { value: "3" } })
    await waitFor(() => expect(fake.reveals.at(-1)?.nodes).not.toBeNull())
    expect(fake.data.at(-1)!.nodes.length).toBe(all) // the layout still has every node
    expect(fake.reveals.at(-1)!.nodes!.size).toBeLessThan(all)
    fireEvent.click(screen.getByRole("button", { name: "Show all" }))
    await waitFor(() => expect(fake.reveals.at(-1)?.nodes).toBeNull())
  })

  it("makes Play the obvious first action and narrates each step from the recorded events", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    const play = await screen.findByRole("button", { name: "▶ Watch how this unfolded" })
    fireEvent.click(play)
    expect(await screen.findByTestId("caption")).toHaveTextContent("The run begins: KRAS G12C hit-to-lead.")
    expect(screen.getByTestId("headline")).toHaveTextContent("Nothing has been recorded for this run yet.") // the replay is at its first step
    expect(screen.getByRole("button", { name: "❚❚ Pause" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "❚❚ Pause" }))
    fireEvent.click(screen.getByRole("button", { name: "Next step" }))
    expect(screen.getByTestId("caption")).toHaveTextContent(/Lead Scientist frames the question|frames the question/)
    expect(fake.styles.at(-1)!.pulse).toBeDefined()
  })

  it("offers Play, and in its place a plain step-through under prefers-reduced-motion", async () => {
    routes(lists)
    const { unmount } = render(<WorldsView />)
    await streamBoard()
    expect(await screen.findByRole("button", { name: "▶ Watch how this unfolded" })).toBeInTheDocument()
    unmount()
    FakeEventSource.all = []
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: /reduce/.test(q), addEventListener: () => undefined, removeEventListener: () => undefined }))
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    await screen.findByRole("slider", { name: "Step through the run" })
    expect(screen.queryByRole("button", { name: "▶ Watch how this unfolded" })).toBeNull()
    expect(screen.getByRole("button", { name: "Step through how this unfolded" })).toBeInTheDocument()
  })

  it("shows a run in progress and grows as events arrive", async () => {
    routes({ ...lists, "GET /api/runs": { status: 200, body: [{ ...boardRun, status: "running" }] } })
    render(<WorldsView />)
    await streamBoard(BOARD_EVENTS.slice(0, 8))
    expect(await screen.findByText(/running: the picture grows as events arrive/)).toBeInTheDocument()
    const before = fake.data.at(-1)?.nodes.length ?? 0
    act(() => { for (const e of BOARD_EVENTS.slice(8, 14)) FakeEventSource.all.at(-1)!.emit(e) })
    await waitFor(() => expect(fake.data.at(-1)!.nodes.length).toBeGreaterThan(before))
    expect(FakeEventSource.all.at(-1)!.closed).toBe(false)
  })

  it("closes the event stream when the run ends", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard()
    expect(FakeEventSource.all.at(-1)!.closed).toBe(true)
  })

  it("cleans up the renderer and the event stream on unmount", async () => {
    routes({ ...lists, "GET /api/runs": { status: 200, body: [{ ...boardRun, status: "running" }] } })
    const { unmount } = render(<WorldsView />)
    await streamBoard(BOARD_EVENTS.slice(0, 6))
    await waitFor(() => expect(fake.calls).toContain("create"))
    unmount()
    expect(fake.destroyed).toBe(1)
    expect(FakeEventSource.all.every((s) => s.closed)).toBe(true)
  })

  it("pauses the renderer and closes the stream while the tab is hidden, and resumes after", async () => {
    routes({ ...lists, "GET /api/runs": { status: 200, body: [{ ...boardRun, status: "running" }] } })
    render(<WorldsView />)
    await streamBoard(BOARD_EVENTS.slice(0, 6))
    await waitFor(() => expect(fake.calls).toContain("create"))
    const hide = (hidden: boolean) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") }); document.dispatchEvent(new Event("visibilitychange")) }
    act(() => hide(true))
    await waitFor(() => expect(fake.paused.at(-1)).toBe(true))
    expect(FakeEventSource.all.at(-1)!.closed).toBe(true)
    act(() => hide(false))
    await waitFor(() => expect(fake.paused.at(-1)).toBe(false))
    await waitFor(() => expect(FakeEventSource.all.at(-1)!.closed).toBe(false))
    Reflect.deleteProperty(document, "visibilityState")
  })

  it("says the engine is offline when no list loads, and offers a retry", async () => {
    routes({})
    render(<WorldsView />)
    expect(await screen.findByText("Engine not running")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("keeps working when only one list fails, and says so", async () => {
    routes({ "GET /api/runs": { status: 500, body: {} }, "GET /api/glhf/runs": { status: 200, body: [swarmRun] }, ...swarmRoutes })
    render(<WorldsView />)
    expect(await screen.findByText(/board run list could not be loaded/)).toBeInTheDocument()
    expect(await screen.findByTestId("scripted-label")).toBeInTheDocument()
  })

  it("shows a message and a retry when the run itself cannot be loaded", async () => {
    routes({ ...lists, "GET /api/runs": { status: 200, body: [] }, "GET /api/glhf/runs/s1": { status: 500, body: {} } })
    render(<WorldsView />)
    expect(await screen.findByText("This run could not be loaded")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  it("handles no runs at all", async () => {
    routes({ "GET /api/runs": { status: 200, body: [] }, "GET /api/glhf/runs": { status: 200, body: [] } })
    render(<WorldsView />)
    expect(await screen.findByText(/No runs yet/)).toBeInTheDocument()
  })

  it("handles a run with nothing recorded yet", async () => {
    routes(lists)
    render(<WorldsView />)
    await streamBoard([BOARD_EVENTS[0]])
    expect(await screen.findByText(/no recorded claims, sources or tests|Nothing has been recorded yet/)).toBeInTheDocument()
  })

  it("asks for a key nowhere", async () => {
    routes(lists)
    const { container } = render(<WorldsView />)
    await streamBoard()
    expect(container.querySelector("input[type=password]")).toBeNull()
    expect(container.textContent).not.toMatch(/api key/i)
  })
})
