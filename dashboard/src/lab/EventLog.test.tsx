import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { choose, chooseMenuItem, openMenu } from "@/test/menus"
import { EventLog } from "./EventLog"
import type { EventRow } from "./logRows"

const rows: EventRow[] = [
  { id: "1", at: 1000, agent: "Safety scientist", agentId: "s", kind: "write", text: "Wrote a safety note", usd: 0.01, costScope: "step", sources: [{ title: "Evidence", url: "https://example.org" }] },
  { id: "2", agent: "Engine", agentId: "engine", kind: "run", text: "Run finished.", usd: 0.01, costScope: "total", sources: [] },
]
const run = { id: "a-demo", kind: "answer" as const, provenance: "practice" as const }
afterEach(() => vi.useRealTimers())

it("filters by agent and kind, uses accessible links and downloads the shown rows", () => {
  vi.useFakeTimers()
  const blob = vi.fn(() => "blob:log"), revoke = vi.fn(), click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  vi.stubGlobal("URL", class extends URL { static createObjectURL = blob; static revokeObjectURL = revoke })
  render(<EventLog rows={rows} run={run} connection="ended" />)
  expect(screen.getByRole("link", { name: "Evidence" })).toHaveAttribute("href", "https://example.org")
  expect(screen.getByText("run total")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled()
  choose(screen.getByRole("combobox", { name: "Agent" }), /Safety scientist/)
  expect(screen.getByRole("combobox", { name: "Agent" })).toHaveTextContent("Safety scientist")
  choose(screen.getByRole("combobox", { name: "Kind of step" }), /Write/)
  expect(screen.getByRole("status")).toHaveTextContent("1 of 2 events shown")
  chooseMenuItem(screen.getByRole("button", { name: "Download" }), /Download JSON/)
  expect(blob).toHaveBeenCalledWith(expect.any(Blob))
  expect(click).toHaveBeenCalledOnce()
  expect(click.mock.instances[0]).toHaveAttribute("download", "agent-log-a-demo.json")
  chooseMenuItem(screen.getByRole("button", { name: "Download" }), /Download CSV/)
  expect(click.mock.instances[1]).toHaveAttribute("download", "agent-log-a-demo.csv")
  act(() => vi.advanceTimersByTime(1000))
  expect(revoke).toHaveBeenCalledTimes(2)
  fireEvent.change(screen.getByRole("searchbox", { name: "Search log" }), { target: { value: "nothing" } })
  expect(screen.getByText("No events match these filters.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
  expect(within(screen.getByRole("list", { name: "Run events" })).getAllByRole("listitem")).toHaveLength(3)
})

it("handles loading, empty, unsupported streams, errors and appended events", () => {
  const { rerender } = render(<EventLog rows={[]} run={run} connection="connecting" />)
  expect(screen.getByText("Loading event log…")).toBeInTheDocument()
  rerender(<EventLog rows={[]} run={run} connection="offline" />)
  expect(screen.getByRole("status")).toHaveTextContent("This browser cannot follow events")
  rerender(<EventLog rows={rows.slice(0, 1)} run={run} connection="lost" />)
  expect(screen.getByRole("status")).toHaveTextContent("Reconnecting")
  rerender(<EventLog rows={rows} run={run} connection="live" />)
  expect(screen.getByRole("status")).toHaveTextContent("2 of 2 events shown")
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => { throw new Error("blocked") })
  chooseMenuItem(screen.getByRole("button", { name: "Download" }), /Download JSON/)
  expect(screen.getByRole("alert")).toHaveTextContent("could not be downloaded")
})

const chat: EventRow[] = [
  { id: "c1", at: 1000, agent: "Planner", agentId: "planner", kind: "claim", text: "I think the outputs need every sample.", sources: [] },
  { id: "c2", at: 2000, agent: "Planner", agentId: "planner", kind: "test", text: "Registering a shape check first.\nA pilot on a subsample is cheap and shows whether the columns line up before the full run.", sources: [], thought: true },
  { id: "c3", at: 3000, agent: "Engine", agentId: "engine", kind: "claim", text: "Moved claim C1 from triaged to piloting.", sources: [], note: true },
  { id: "c4", at: 4000, agent: "Scout", agentId: "scout", kind: "search", text: "Searched practice example sources: kept 1, dropped 0.", sources: [{ title: "Trial", url: "https://example.org/t" }], note: true },
  { id: "c5", at: 5000, agent: "Critic", agentId: "critic", kind: "review", text: "Resolved the notes.\nNote 1: resolved. Note 2: not resolved.", sources: [] },
]

it("shows agent turns as grouped chat bubbles with faces, thinking behind a toggle and quiet notes", () => {
  render(<EventLog rows={chat} run={run} connection="ended" />)
  const items = within(screen.getByRole("list", { name: "Run events" })).getAllByRole("listitem").filter((li) => li.classList.contains("event-log-row"))
  expect(items.map((li) => li.className.includes("chat-note") ? "note" : "msg")).toEqual(["msg", "msg", "note", "note", "msg"])
  // One picture and one name per run of messages from the same agent.
  expect(items[0].querySelector("svg[data-agent='planner']")).not.toBeNull()
  expect(items[1].querySelector(".chat-face svg")).toBeNull()
  expect(items[0]).toHaveAttribute("data-first")
  expect(items[1]).toHaveAttribute("data-last")
  expect(within(items[1]).getByText("Planner:")).toHaveClass("sr-only")
  expect(items[4].querySelector("svg[data-agent='critic']")).not.toBeNull()
  // The short line shows; the reasoning is behind "Show thinking".
  expect(within(items[1]).getByText("Registering a shape check first.")).toBeVisible()
  const thinking = within(items[1]).getByRole("button", { name: "Show thinking" })
  expect(thinking).toHaveAttribute("aria-expanded", "false")
  expect(within(items[1]).queryByText(/A pilot on a subsample/)).toBeNull()
  fireEvent.click(thinking)
  expect(thinking).toHaveAttribute("aria-expanded", "true")
  expect(thinking).toHaveTextContent("Hide thinking")
  expect(within(items[1]).getByText(/A pilot on a subsample/)).toBeVisible()
  expect(within(items[0]).queryByText("Show thinking")).toBeNull()
  // Other long text, such as a list of resolved notes, is not called thinking.
  expect(within(items[4]).getByRole("button", { name: "Show more" })).toHaveAttribute("aria-expanded", "false")
  expect(within(items[4]).queryByText("Show thinking")).toBeNull()
  // Notes have no picture, keep their agent and their links.
  expect(items[3].querySelector("svg[data-agent]")).toBeNull()
  expect(within(items[3]).getByText("Scout")).toBeInTheDocument()
  expect(within(items[3]).getByRole("link", { name: "Trial" })).toHaveAttribute("href", "https://example.org/t")
  expect(items[0].querySelector("time")).toHaveAttribute("dateTime", new Date(1000).toISOString())
})

it("follows the newest message while live, and offers a jump back after the reader scrolls up", () => {
  const { rerender, container } = render(<EventLog rows={chat.slice(0, 2)} run={run} connection="live" />)
  const scroller = container.querySelector(".chat-scroll") as HTMLDivElement
  let height = 1000
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height })
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 300 })
  rerender(<EventLog rows={chat.slice(0, 3)} run={run} connection="live" />)
  expect(scroller.scrollTop).toBe(1000)
  scroller.scrollTop = 100
  fireEvent.scroll(scroller)
  height = 1200
  rerender(<EventLog rows={chat.slice(0, 4)} run={run} connection="live" />)
  expect(scroller.scrollTop).toBe(100)
  fireEvent.click(screen.getByRole("button", { name: "New messages" }))
  expect(scroller.scrollTop).toBe(1200)
  expect(screen.queryByRole("button", { name: "New messages" })).toBeNull()
  // A finished run is read from the start: nothing moves it.
  scroller.scrollTop = 0
  rerender(<EventLog rows={chat} run={run} connection="ended" />)
  expect(scroller.scrollTop).toBe(0)
})

it("follows the newest message again after the reader changes the filters", () => {
  const { container } = render(<EventLog rows={chat} run={run} connection="live" />)
  choose(screen.getByRole("combobox", { name: "Agent" }), /Planner/)
  const scroller = container.querySelector(".chat-scroll") as HTMLDivElement
  let height = 400
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height })
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 300 })
  scroller.scrollTop = 0
  fireEvent.scroll(scroller)
  height = 1500
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
  expect(screen.getByRole("status")).toHaveTextContent("5 of 5 events shown")
  expect(screen.queryByRole("button", { name: "New messages" })).toBeNull()
  expect(scroller.scrollTop).toBe(1500)
})

const longChat: EventRow[] = [
  { id: "t1", agent: "Planner", agentId: "planner", kind: "test", text: "First plan.\nThe first reasoning, long enough to sit behind the toggle.", sources: [], thought: true },
  { id: "t2", agent: "Critic", agentId: "critic", kind: "review", text: "Second plan.\nThe second reasoning, also behind its own toggle.", sources: [], thought: true },
  { id: "t3", agent: "Reporter", agentId: "reporter", kind: "write", text: "A list.\nItem one. Item two.", sources: [] },
  { id: "t4", agent: "Writer", agentId: "writer", kind: "write", text: "Another list.\nItem three. Item four.", sources: [] },
]

it("opens only the bubble that was clicked: every Show thinking and Show more keeps its own state", () => {
  const { rerender } = render(<EventLog rows={longChat} run={run} connection="ended" />)
  const thinking = screen.getAllByRole("button", { name: "Show thinking" })
  const more = screen.getAllByRole("button", { name: "Show more" })
  expect(thinking).toHaveLength(2)
  expect(more).toHaveLength(2)
  fireEvent.click(thinking[1])
  expect(thinking[1]).toHaveAttribute("aria-expanded", "true")
  expect(thinking[0]).toHaveAttribute("aria-expanded", "false")
  expect(more.map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false"])
  expect(screen.queryByText(/The first reasoning/)).toBeNull()
  fireEvent.click(more[0])
  expect(more.map((b) => b.getAttribute("aria-expanded"))).toEqual(["true", "false"])
  expect(screen.getByText(/Item one/)).toBeVisible()
  expect(screen.queryByText(/Item three/)).toBeNull()
  // A new event arriving keeps what the reader opened, on the same bubbles.
  rerender(<EventLog rows={[{ ...longChat[0], id: "t0", text: "Earlier." }, ...longChat]} run={run} connection="ended" />)
  expect(screen.getAllByRole("button", { name: /thinking/ }).map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "true"])
})

it("groups the agent menu, hides step notes and times from the View menu, and clears only the filters", () => {
  render(<EventLog rows={chat} run={run} connection="ended" />)
  openMenu(screen.getByRole("combobox", { name: "Agent" }))
  const options = screen.getAllByRole("option").map((o) => o.textContent)
  expect(options).toEqual(["All agents", "Critic1", "Planner2", "Scout1", "Engine1"])
  expect(screen.getByText("Team")).toBeInTheDocument()
  expect(screen.getByText("System")).toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" })
  chooseMenuItem(screen.getByRole("button", { name: "View" }), /Step notes/, "menuitemcheckbox")
  expect(document.querySelectorAll(".chat-note")).toHaveLength(0)
  expect(screen.getByRole("status")).toHaveTextContent("3 of 5 events shown")
  chooseMenuItem(screen.getByRole("button", { name: "View" }), /Times and costs/, "menuitemcheckbox")
  expect(screen.getByRole("region", { name: "Full event log" })).toHaveAttribute("data-meta", "hidden")
  fireEvent.change(screen.getByRole("searchbox", { name: "Search log" }), { target: { value: "Planner" } })
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
  // The view stays as the reader set it.
  expect(screen.getByRole("status")).toHaveTextContent("3 of 5 events shown")
})

it("lists two agents with the same name once in the agent menu, and that choice shows both", () => {
  const twins: EventRow[] = [
    { id: "w1", agent: "Second check", agentId: "checker:a", kind: "check", text: "Checked claim one.", sources: [] },
    { id: "w2", agent: "Second check", agentId: "checker:b", kind: "check", text: "Checked claim two.", sources: [] },
    { id: "w3", agent: "Planner", agentId: "planner", kind: "prepare", text: "Planned.", sources: [] },
  ]
  render(<EventLog rows={twins} run={run} connection="ended" />)
  openMenu(screen.getByRole("combobox", { name: "Agent" }))
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All agents", "Planner1", "Second check2"])
  fireEvent.click(screen.getByRole("option", { name: /Second check/ }))
  expect(screen.getByRole("status")).toHaveTextContent("2 of 3 events shown")
})
