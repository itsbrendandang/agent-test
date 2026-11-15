// Agents: member cards in one grid with a search box and a group filter, each card built only from what the role
// list and the engine's catalog say; and one card that shows a run step by step from the run's own clock readings.
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { clockLength, phaseTimeline } from "@/lib/timeline"
import { routes } from "@/test/engine"
import { CATALOG_ON } from "@/test/home"
import { AgentsView } from "./AgentsView"

const ROLE_KEYS = ["scout", "propose", "pilot", "experiment", "audit", "critique", "revise", "finish", "report"]
const ROLES = { shared_rules: "Write only what you did.", roles: ROLE_KEYS.map((key) => ({ key, budget: "up to 3% of the time", model_group: "planner", instructions: `Instructions of ${key}.` })) }
const RUN = { id: "202611142330-demo-glhf", mode: "local", task: "demo", solver: "glhf", model: "mock", roleModels: {}, phase: "done", startedAt: new Date("2026-11-14T23:30:00").getTime(), finishedAt: new Date("2026-11-14T23:30:13").getTime(), score: 1 }
// The run's own record: each step's end carries the seconds left on the run's clock.
const EVENTS = [
  { kind: "phase.started", phase: "propose", seconds: 87 }, { kind: "phase.finished", phase: "propose", limit_hit: false, left: 1744 },
  { kind: "phase.started", phase: "experiment", seconds: 873 }, { kind: "phase.finished", phase: "experiment", limit_hit: false, left: 1704 },
  { kind: "phase.started", phase: "critique 1", seconds: 578 }, { kind: "phase.finished", phase: "critique 1", limit_hit: true, left: 1684 },
  { kind: "phase.started", phase: "report", seconds: 1679 }, { kind: "phase.finished", phase: "report", limit_hit: false, left: 1684 },
]
const show = async (runs: object[] = [], events: object[] = EVENTS) => {
  const sent = routes({
    "GET /api/chat/catalog": { status: 200, body: CATALOG_ON }, "GET /api/glhf/roles": { status: 200, body: ROLES },
    "GET /api/glhf/runs": { status: 200, body: runs }, "GET /api/glhf/status": { status: 200, body: {} }, "GET /api/glhf/scoreboard": { status: 200, body: [] },
    [`GET /api/glhf/runs/${RUN.id}`]: { status: 200, body: { run: RUN, ledger: { alpha: 0.1, kappa: 1, claims: [], issues: [], events }, findings: null, methods: null } },
  })
  const view = render(<AgentsView />)
  await screen.findByRole("heading", { name: "Toxicologist" })
  await screen.findAllByText("Model group: planner")
  return { ...view, sent }
}
const cards = () => within(screen.getByRole("list", { name: "Agents" })).getAllByRole("listitem")
const names = () => cards().map((c) => c.querySelector("h3")!.textContent)

describe("member cards", () => {
  it("is one grid of every agent: the team of nine, the review agents and the specialists, each with one picture and its group", async () => {
    await show()
    expect(names()).toEqual(["Scout", "Proposer", "Pilot", "Experimenter", "Auditor", "Critic", "Reviser", "Finisher", "Reporter", "Lead Scientist", "Critic (Scientific Reviewer)", "Toxicologist"])
    for (const card of cards()) expect(card.querySelectorAll("svg[data-agent]")).toHaveLength(1)
    expect(cards().map((c) => c.querySelector(".member-top .pill")!.textContent)).toEqual([...Array(9).fill("Team of nine"), "Team review", "Team review", "Specialist"])
    expect(screen.getByRole("status")).toHaveTextContent("12 of 12 agents shown")
    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument()
  })
  it("every card has the same two fields, filled only from what the lists say", async () => {
    await show()
    const fields = (name: string) => { const card = cards().find((c) => c.querySelector("h3")!.textContent === name)!; return { fields: [...card.querySelectorAll(".member-fields > div")].map((d) => `${d.querySelector("dt")!.textContent}: ${d.querySelector("dd")!.textContent}`), foot: card.querySelector(".member-foot")!.textContent, job: card.querySelector(".member-job")!.textContent } }
    expect(fields("Pilot")).toEqual({ fields: ["Works on: Benchmark tasks", "Takes part: Step 3 of 9"], foot: "Model group: planner", job: "Tries the whole analysis on a small sample first." })
    expect(fields("Lead Scientist")).toEqual({ fields: ["Works on: Team reviews", "Takes part: Leads the review"], foot: "Tools: leads the discussion, writes the decision", job: "Runs the discussion; does not do the research or decide what is true." })
    expect(fields("Critic (Scientific Reviewer)")).toEqual({ fields: ["Works on: Team reviews", "Takes part: Review member"], foot: "Tools: none", job: "Tries to prove the others wrong." })
    expect(fields("Toxicologist")).toEqual({ fields: ["Works on: Team reviews", "Takes part: When the question fits"], foot: "Tools: code", job: "the question is about a safety margin" })
    for (const card of cards()) expect([...card.querySelectorAll(".member-fields dt")].map((d) => d.textContent)).toEqual(["Works on", "Takes part"])
  })
  it("Details is one disclosure per card, named for its agent; nothing on a card is about a run", async () => {
    await show([RUN])
    const scout = cards()[0]
    const summary = within(scout).getByText("Details")
    expect(summary.tagName).toBe("SUMMARY"); expect(summary).toHaveAccessibleName("Details of Scout")
    await userEvent.setup().click(summary)
    expect(scout).toHaveTextContent("up to 3% of the time"); expect(scout).toHaveTextContent("Instructions of scout.")
    const tox = cards().find((c) => c.querySelector("h3")!.textContent === "Toxicologist")!
    expect(tox).toHaveTextContent("Used whenthe question is about a safety margin")
    expect(screen.getByRole("list", { name: "Agents" })).not.toHaveTextContent(/latest run|did not run|Ran in|No run yet|working now|2026\d{6}|swarm|task run|board/i)
  })
  it("the search box and the group filter narrow the one grid, and say when nothing matches", async () => {
    await show()
    const user = userEvent.setup()
    const box = screen.getByRole("searchbox", { name: "Search agents by name, job or tool" })
    await user.type(box, "critic")
    expect(names()).toEqual(["Critic", "Critic (Scientific Reviewer)"]) // the role of the team of nine and the review agent both match
    await user.click(within(screen.getByRole("group", { name: "Group" })).getByRole("button", { name: "Team review" }))
    expect(names()).toEqual(["Critic (Scientific Reviewer)"])
    expect(screen.getByRole("status")).toHaveTextContent("1 of 12 agents shown")
    await user.clear(box)
    await user.click(screen.getByRole("button", { name: "Specialists" }))
    expect(names()).toEqual(["Toxicologist"])
    await user.click(screen.getByRole("button", { name: "All" }))
    await user.type(box, "zzzz")
    expect(screen.queryByRole("listitem")).toBeNull()
    expect(screen.getByText(/No agent matches “zzzz”/)).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Group" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Team of nine", "Team review", "Specialists"])
  })
})

describe("a run, step by step", () => {
  it("draws the latest finished run by the team of nine from its own clock readings, and says which run and that practice times are not research", async () => {
    await show([{ ...RUN, id: "x-running", phase: "running" }, RUN, { ...RUN, id: "x-single", solver: "single" }])
    const card = screen.getByRole("region", { name: "A run, step by step" })
    await waitFor(() => expect(within(card).getByTestId("timeline-run")).toHaveTextContent("Team of nine on the demo task, 14 Nov 23:30"))
    const line = within(card).getByTestId("timeline-run")
    expect(line.querySelector("[data-provenance]")).toHaveTextContent(/^Practice$/)
    expect(line).toHaveTextContent("Bars follow the run's own clock: 1 min from the end of the first step to the end of the last.")
    expect(line).toHaveTextContent("A practice run replays fixed steps, so its times are not research.")
    expect(line).not.toHaveTextContent("202611142330") // the id is a tooltip, not text
    const rows = within(within(card).getByRole("table", { name: "The steps of the run, in order" })).getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("th, td")].map((c) => c.textContent))
    expect(rows).toEqual([
      ["Proposer", "propose", "not recorded", "not recorded"], // the first step has an end but no recorded start
      ["Experimenter", "experiment", "0 s", "40 s"],
      ["Critic", "critique 1", "40 s", "20 s (cut off at its limit)"],
      ["Reporter", "report", "1 min", "under 1 s"],
    ])
    // the picture: one row per role in order; only roles with a reading have a bar
    const bars = [...card.querySelectorAll(".timeline-row")].map((r) => r.querySelectorAll(".timeline-bar").length)
    expect(bars).toEqual([0, 1, 0, 1, 0, 1, 0, 0, 1])
    expect(card.querySelector(".timeline")).toHaveAttribute("aria-hidden", "true") // the table is the readable form
  })
  it("with no finished run it shows the order only, as equal steps, and says so", async () => {
    await show([{ ...RUN, phase: "running" }])
    const card = screen.getByRole("region", { name: "A run, step by step" })
    expect(within(card).getByTestId("timeline-run")).toHaveTextContent(/^Order only: no run with recorded times yet\.$/)
    expect([...card.querySelectorAll(".timeline-bar")].every((b) => b.hasAttribute("data-order"))).toBe(true)
    expect(card.querySelectorAll(".timeline-bar")).toHaveLength(9)
    const rows = within(within(card).getByRole("table")).getAllByRole("row").slice(1)
    expect(rows.map((r) => r.querySelector("th")!.textContent)).toEqual(["Scout", "Proposer", "Pilot", "Experimenter", "Auditor", "Critic", "Reviser", "Finisher", "Reporter"])
    expect(rows[2]).toHaveTextContent("3 of 9")
  })
  it("a run whose readings all fall in the same second is order only too: no length is invented", async () => {
    await show([RUN], [{ kind: "phase.finished", phase: "propose", left: 1700 }, { kind: "phase.finished", phase: "report", left: 1700 }])
    await waitFor(() => expect(screen.getByTestId("timeline-run")).toHaveTextContent("Order only: no run with recorded times yet."))
  })
})

describe("the clock readings", () => {
  it("places each step from the end of the one before it, and gives the first step no start", () => {
    const t = phaseTimeline(EVENTS)!
    expect(t.steps).toEqual([
      { phase: "propose", start: undefined, end: 0, cut: false }, { phase: "experiment", start: 0, end: 40, cut: false },
      { phase: "critique 1", start: 40, end: 60, cut: true }, { phase: "report", start: 60, end: 60, cut: false },
    ])
    expect(t.total).toBe(60)
  })
  it("is undefined when the run recorded no reading, and ignores an end without one", () => {
    expect(phaseTimeline([{ kind: "phase.started", phase: "propose" }, { kind: "phase.finished", phase: "propose" }])).toBeUndefined()
    expect(phaseTimeline([])).toBeUndefined()
    expect(phaseTimeline([{ kind: "phase.finished", phase: "a", left: "12" }, { kind: "phase.finished", phase: "b", left: 10 }])!.steps.map((s) => s.phase)).toEqual(["b"])
  })
  it("says a length in plain units", () => {
    expect([0.2, 4, 59.6, 125].map(clockLength)).toEqual(["under 1 s", "4 s", "1 min", "2 min 5 s"])
  })
})
