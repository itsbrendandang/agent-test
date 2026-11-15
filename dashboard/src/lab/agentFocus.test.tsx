// One agent in the Agent Log, named from another view: by its own name, or by the lab character that plays it. Its face
// or name in the log filters to it, and the line above the log links to its card.
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { agentRows, hasCard, rowCharacter } from "./agentFocus"
import { EventLog } from "./EventLog"
import type { EventRow } from "./logRows"

const row = (id: string, agentId: string, agent: string, kind: string, text = `${agent} said something.`, note = false): EventRow => ({ id, agentId, agent, kind, text, sources: [], ...(note && { note }) })
const REVIEW: EventRow[] = [
  row("1", "lead-scientist", "Lead Scientist", "prepare"),
  row("2", "scout", "Scout (Data and Evidence)", "search", "Searched the web.", true),
  row("3", "critic", "Critic (Scientific Reviewer)", "write"),
  row("4", "first-pass", "First check", "check"),
  row("5", "openai", "Second, more careful check", "check"),
  row("6", "engine", "Engine", "run", "Run finished.", true),
]
const ANSWER: EventRow[] = [
  row("1", "planner", "Planner", "prepare"),
  row("2", "searcher", "Searcher", "search", "Searched.", true),
  row("3", "writer", "Writer", "write"),
  row("4", "checker", "Checker", "check"),
]

describe("which rows are one agent's", () => {
  it("its own name first, in either spelling", () => {
    expect(agentRows(REVIEW, "critic", "board").map((r) => r.id)).toEqual(["3"])
    expect(agentRows(REVIEW, "Critic (Scientific Reviewer)", "board").map((r) => r.id)).toEqual(["3"])
  })
  it("else the rows of the lab character that plays it", () => {
    expect(agentRows(REVIEW, "navigator", "board").map((r) => r.id)).toEqual(["1"]) // the Navigator is the lead scientist
    expect(agentRows(REVIEW, "guardian", "board").map((r) => r.id)).toEqual(["4", "5"]) // both checks
    expect(agentRows(ANSWER, "reporter", "answer").map((r) => r.id)).toEqual(["3"]) // an answer's writing step
    expect(agentRows(ANSWER, "scout", "answer").map((r) => r.id)).toEqual(["2"])
    expect(rowCharacter(REVIEW[5], "board")).toBeUndefined() // the engine's own steps belong to nobody
  })
  it("nothing for a name the run does not have", () => {
    expect(agentRows(REVIEW, "reviser", "board")).toEqual([])
    expect(agentRows(REVIEW, "", "board")).toEqual([])
  })
  it("only agents with a card in Agents get a link to it", () => {
    expect(hasCard("critic")).toBe(true)
    expect(hasCard("specialist:admet")).toBe(true)
    expect(hasCard("openai")).toBe(false) // a checker
    expect(hasCard("writer")).toBe(false) // a step of an answer
  })
})

describe("the Agent Log and one agent", () => {
  const run = { id: "r-1", kind: "board" as const }
  it("opens on the agent the address names, and says when the run has none of it", () => {
    const { rerender } = render(<EventLog rows={REVIEW} run={run} connection="ended" agent="navigator" />)
    expect(screen.getByRole("combobox", { name: "Agent" })).toHaveTextContent("Lead Scientist")
    expect(screen.getByRole("status")).toHaveTextContent("1 of 6 events shown")
    expect(screen.getByRole("link", { name: "About this agent" })).toHaveAttribute("href", "#Agents/lead-scientist?from=board")
    rerender(<EventLog rows={REVIEW} run={run} connection="ended" agent="reviser" key="other" />)
    expect(screen.getByText(/has no events in this run, so every agent is shown/)).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("6 of 6 events shown")
  })
  it("a face or a name filters to that agent, and the address is told; Show every agent undoes it", () => {
    const onAgent = vi.fn()
    render(<EventLog rows={REVIEW} run={run} connection="ended" onAgent={onAgent} />)
    fireEvent.click(screen.getAllByRole("button", { name: "Show only Critic (Scientific Reviewer)'s messages" })[0])
    expect(onAgent).toHaveBeenLastCalledWith("critic")
    expect(within(screen.getByRole("list", { name: "Run events" })).getAllByRole("listitem")).toHaveLength(1)
    expect(screen.getByText(/^Only/).closest("p")).toHaveTextContent("Only Critic (Scientific Reviewer).")
    fireEvent.click(screen.getByRole("button", { name: "Show every agent" }))
    expect(onAgent).toHaveBeenLastCalledWith(undefined)
    expect(within(screen.getByRole("list", { name: "Run events" })).getAllByRole("listitem")).toHaveLength(6)
    // A note's name filters too; a checker has no card, so no "About" link.
    fireEvent.click(screen.getAllByRole("button", { name: /Show only First check's messages/ })[0])
    expect(onAgent).toHaveBeenLastCalledWith("first-pass")
    expect(screen.queryByRole("link", { name: "About this agent" })).toBeNull()
  })
})
