import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
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
  fireEvent.change(screen.getByRole("combobox", { name: "Agent" }), { target: { value: "s" } })
  fireEvent.change(screen.getByRole("combobox", { name: "Kind of step" }), { target: { value: "write" } })
  expect(screen.getByRole("status")).toHaveTextContent("1 of 2 events shown")
  fireEvent.click(screen.getByRole("button", { name: "Download JSON" }))
  expect(blob).toHaveBeenCalledWith(expect.any(Blob))
  expect(click).toHaveBeenCalledOnce()
  expect(click.mock.instances[0]).toHaveAttribute("download", "agent-log-a-demo.json")
  fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))
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
  fireEvent.click(screen.getByRole("button", { name: "Download JSON" }))
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
  expect(items[1].querySelector("svg")).toBeNull()
  expect(items[0]).toHaveAttribute("data-first")
  expect(items[1]).toHaveAttribute("data-last")
  expect(within(items[1]).getByText("Planner:")).toHaveClass("sr-only")
  expect(items[4].querySelector("svg[data-agent='critic']")).not.toBeNull()
  // The short line shows; the reasoning is behind "Show thinking".
  expect(within(items[1]).getByText("Registering a shape check first.")).toBeVisible()
  const thinking = within(items[1]).getByText("Show thinking").closest("details")!
  expect(thinking.open).toBe(false)
  fireEvent.click(within(items[1]).getByText("Show thinking"))
  expect(thinking.open).toBe(true)
  expect(within(items[0]).queryByText("Show thinking")).toBeNull()
  // Other long text, such as a list of resolved notes, is not called thinking.
  expect(within(items[4]).getByText("Show more")).toBeInTheDocument()
  expect(within(items[4]).queryByText("Show thinking")).toBeNull()
  // Notes have no picture, keep their agent and their links.
  expect(items[3].querySelector("svg")).toBeNull()
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
  fireEvent.click(screen.getByRole("button", { name: "New messages ↓" }))
  expect(scroller.scrollTop).toBe(1200)
  expect(screen.queryByRole("button", { name: "New messages ↓" })).toBeNull()
  // A finished run is read from the start: nothing moves it.
  scroller.scrollTop = 0
  rerender(<EventLog rows={chat} run={run} connection="ended" />)
  expect(scroller.scrollTop).toBe(0)
})

it("follows the newest message again after the reader changes the filters", () => {
  const { container } = render(<EventLog rows={chat} run={run} connection="live" />)
  fireEvent.change(screen.getByRole("combobox", { name: "Agent" }), { target: { value: "planner" } })
  const scroller = container.querySelector(".chat-scroll") as HTMLDivElement
  let height = 400
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height })
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 300 })
  scroller.scrollTop = 0
  fireEvent.scroll(scroller)
  height = 1500
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
  expect(screen.getByRole("status")).toHaveTextContent("5 of 5 events shown")
  expect(screen.queryByRole("button", { name: "New messages ↓" })).toBeNull()
  expect(scroller.scrollTop).toBe(1500)
})
