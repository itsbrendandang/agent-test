// The shell: one header row, the navigation and its hierarchy, addresses that keep working, the header slot, and
// the engine notice. The views are stand-ins here, so these tests are about the shell alone.
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { HeaderSlot } from "@/components/HeaderSlot"
import { EngineOffline } from "@/components/Shared"
import { takeOpen } from "@/lib/open"
import { routes } from "@/test/engine"
import App from "./App"

vi.mock("./views/HomeView", () => ({ HomeView: () => <div className="page">research view<HeaderSlot area="title"><span className="header-title">Is hERG a risk?</span></HeaderSlot><HeaderSlot area="actions"><button type="button">Inspector</button></HeaderSlot></div> }))
vi.mock("./views/ExperimentsView", () => ({ ExperimentsView: () => <div className="page">saved view</div> }))
vi.mock("./views/SwarmView", () => ({ SwarmView: () => <div className="page">compare view</div> }))
vi.mock("./views/BoardView", () => ({ BoardView: () => <div className="page">review view <EngineOffline needs="Reviews run in the engine." /></div> }))
vi.mock("./views/AgentsView", () => ({ AgentsView: () => <div className="page">agents view</div> }))
vi.mock("./views/WorldsView", () => ({ WorldsView: () => <div className="page">graph view</div> }))
vi.mock("./views/LabView", () => ({ LabView: () => <div className="page">lab view</div> }))
vi.mock("./views/SettingsView", () => ({ SettingsView: () => <div className="page">settings view</div> }))

const ONLINE = { "GET /api/glhf/status": { status: 200, body: { paidCalls: false, paidLocked: false } }, "GET /api/chat/catalog": { status: 404, body: {} } }
const width = (px: number) => { Object.defineProperty(window, "innerWidth", { configurable: true, value: px }) }
const show = async (hash = "", table: Parameters<typeof routes>[0] = ONLINE) => {
  window.location.hash = hash
  const sent = routes(table)
  render(<App />)
  await waitFor(() => expect(sent.length).toBeGreaterThan(0))
  return { sent, user: userEvent.setup() }
}
beforeEach(() => { width(1280); window.location.hash = "" })

describe("one header row", () => {
  it("names the place, holds the Next run selector, and has none of the old top strip", async () => {
    await show("#Runs")
    const header = within(screen.getByRole("banner"))
    expect(header.getByTestId("place")).toHaveTextContent("Saved research")
    expect(await header.findByRole("radiogroup", { name: "Next run: Demo or Real" })).toBeInTheDocument()
    await waitFor(() => expect(header.getByRole("radio", { name: "Demo" })).toBeChecked())
    for (const gone of ["Engine online", "How this works", "Demo mode", "Real mode"]) expect(header.queryByText(gone)).toBeNull()
    expect(header.queryByRole("button", { name: "Settings" })).toBeNull() // Settings has one entry point: the navigation
    expect(screen.getByRole("main")).toHaveTextContent("saved view")
    expect(screen.getAllByRole("main")).toHaveLength(1)
  })
  it("a view puts its title and actions into the header through the slot; another view leaves it empty", async () => {
    const t = await show("#Home")
    const header = within(screen.getByRole("banner"))
    expect(await header.findByText("Is hERG a risk?")).toBeInTheDocument()
    expect(header.getByRole("button", { name: "Inspector" })).toBeInTheDocument()
    expect(within(screen.getByRole("main")).queryByText("Is hERG a risk?")).toBeNull() // moved, not copied
    await t.user.click(screen.getByRole("button", { name: "Compare" }))
    expect(header.queryByText("Is hERG a risk?")).toBeNull()
    expect(header.queryByRole("button", { name: "Inspector" })).toBeNull()
  })
  it("outside the shell the slot renders in place, so a view can be tested alone", () => {
    render(<div data-testid="alone"><HeaderSlot area="title">A title</HeaderSlot></div>)
    expect(screen.getByTestId("alone")).toHaveTextContent("A title")
  })
})

describe("the navigation", () => {
  it("has three primary places, a quieter More group, and Settings once at the foot", async () => {
    await show("#Home")
    const nav = within(screen.getByRole("navigation", { name: "Places" }))
    const names = nav.getAllByRole("button").map((b) => b.textContent)
    expect(names).toEqual(["Research", "Saved research", "Compare", "Team review", "Agents", "Graph", "Lab"])
    const more = within(nav.getByRole("list", { name: "More" })).getAllByRole("button")
    expect(more.map((b) => b.textContent)).toEqual(["Team review", "Agents", "Graph", "Lab"])
    for (const b of more) expect(b).toHaveAttribute("data-quiet")
    expect(nav.getByRole("button", { name: "Research" })).not.toHaveAttribute("data-quiet")
    expect(screen.getAllByRole("button", { name: "Settings" })).toHaveLength(1)
    expect(nav.queryByRole("button", { name: "Settings" })).toBeNull()
  })
  it("marks exactly one place as current, and moving changes the address, the header and the view", async () => {
    const t = await show("#Home")
    const current = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page").map((b) => b.textContent)
    expect(current()).toEqual(["Research"])
    await t.user.click(screen.getByRole("button", { name: "Team review" }))
    expect(current()).toEqual(["Team review"])
    expect(window.location.hash).toBe("#Board") // the address keeps the old key
    expect(screen.getByTestId("place")).toHaveTextContent("Team review")
    expect(screen.getByRole("main")).toHaveTextContent("review view")
    await t.user.click(screen.getByRole("button", { name: "Settings" }))
    expect(current()).toEqual(["Settings"])
    expect(screen.getByRole("main")).toHaveTextContent("settings view")
  })
  it.each([["#Experiments", "Saved research", "saved view"], ["#Swarm", "Compare", "compare view"], ["#Worlds", "Graph", "graph view"], ["#Runs", "Saved research", "saved view"],
    ["#Board", "Team review", "review view"], ["#Lab/board/r-1", "Lab", "lab view"], ["#Research", "Research", "research view"]])("the address %s still opens %s", async (hash, place, text) => {
    await show(hash)
    expect(screen.getByTestId("place")).toHaveTextContent(place)
    expect(await within(screen.getByRole("main")).findByText(new RegExp(text))).toBeInTheDocument()
  })
  it("a deep link to a run hands the run to its view, also when the address changes later", async () => {
    await show("#Board/202611150232-kras-g12c-hit-to-lead")
    expect(takeOpen("board")).toBe("202611150232-kras-g12c-hit-to-lead")
    act(() => { window.location.hash = "#Compare/glhf-7"; window.dispatchEvent(new HashChangeEvent("hashchange")) })
    await waitFor(() => expect(screen.getByTestId("place")).toHaveTextContent("Compare"))
    expect(takeOpen("swarm")).toBe("glhf-7")
  })
  it("remembers the last place for the next visit", async () => {
    const t = await show("#Home")
    await t.user.click(screen.getByRole("button", { name: "Agents" }))
    expect(localStorage.getItem("app.view")).toBe("Agents")
  })
  it("below 768 px it is a drawer: closed at first, the header names the place, choosing a place closes it", async () => {
    width(520)
    const t = await show("#Runs")
    expect(screen.queryByRole("navigation", { name: "Places" })).toBeNull()
    expect(screen.getByTestId("place")).toHaveTextContent("Saved research")
    const menu = screen.getByRole("button", { name: "Open the menu" })
    expect(menu).toHaveAttribute("aria-expanded", "false")
    await t.user.click(menu)
    const drawer = within(await screen.findByRole("dialog", { name: "Navigation" }))
    expect(drawer.getByRole("button", { name: "Saved research" })).toHaveAttribute("aria-current", "page")
    await t.user.click(drawer.getByRole("button", { name: "Compare" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull())
    expect(screen.getByTestId("place")).toHaveTextContent("Compare")
    expect(window.location.hash).toBe("#Compare")
  })
  it("on a wide window the menu button folds the navigation to icons and remembers it", async () => {
    const t = await show("#Home")
    const fold = screen.getByRole("button", { name: "Show the navigation as icons" })
    expect(fold).toHaveAttribute("aria-expanded", "true")
    await t.user.click(fold)
    expect(localStorage.getItem("shell.sidebar")).toBe("0")
    expect(screen.getByRole("button", { name: "Show the navigation with names" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: "Research" })).toHaveAttribute("aria-current", "page") // still named for a screen reader
  })
  it("the keyboard reaches a skip link first", async () => {
    const t = await show("#Home")
    await t.user.tab()
    expect(screen.getByRole("link", { name: "Skip to the content" })).toHaveFocus()
    await t.user.keyboard("{Enter}")
    expect(screen.getByRole("main")).toHaveFocus()
  })
})

describe("the engine notice", () => {
  it("says nothing while the engine answers", async () => {
    await show("#Runs")
    await waitFor(() => expect(screen.getByRole("radio", { name: "Demo" })).toBeChecked())
    expect(screen.queryByText(/Engine offline/)).toBeNull()
  })
  it("an engine that cannot be reached is said in the page, with Try again, which reads the engine again", async () => {
    let up = false
    const t = await show("#Runs", { "GET /api/glhf/status": () => { if (!up) throw new TypeError("down"); return { status: 200, body: { paidCalls: false } } } })
    const notice = await within(screen.getByRole("main")).findByRole("alert")
    expect(notice).toHaveTextContent("Engine offline. The app's engine isn't running.")
    expect(within(screen.getByRole("banner")).queryByText(/offline/i)).toBeNull() // in the page, not in the header
    up = true
    await t.user.click(within(notice).getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(screen.queryByText(/Engine offline/)).toBeNull())
    expect(screen.getByRole("radio", { name: "Demo" })).toBeChecked()
  })
  it("an engine that answers with an error shows its own words", async () => {
    await show("#Runs", { "GET /api/glhf/status": { status: 500, body: { error: "the run folder cannot be read" } } })
    expect(await screen.findByRole("alert")).toHaveTextContent("The engine answered with an error. the run folder cannot be read (HTTP 500)")
  })
  it("steps aside when the view already says it with its own card", async () => {
    await show("#Board", { "GET /api/glhf/status": () => { throw new TypeError("down") } })
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1))
    expect(screen.getByRole("alert")).toHaveTextContent("The app's engine isn't running")
    expect(screen.queryByText(/Engine offline\./)).toBeNull()
  })
})
