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
