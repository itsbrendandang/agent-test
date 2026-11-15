// Agents: who the agents are. Run status is not on this page (Compare shows which roles ran), and each role card
// has one short "Details" disclosure.
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { routes } from "@/test/engine"
import { CATALOG_ON } from "@/test/home"
import { AgentsView } from "./AgentsView"

const ROLES = { shared_rules: "Write only what you did.", roles: ["scout", "propose", "pilot", "experiment", "audit", "critique", "revise", "finish", "report"].map((key) => ({ key, budget: "up to 3% of the time", model_group: "planner", instructions: `Instructions of ${key}.` })) }
const show = async () => {
  const sent = routes({ "GET /api/chat/catalog": { status: 200, body: CATALOG_ON }, "GET /api/glhf/roles": { status: 200, body: ROLES } })
  const view = render(<AgentsView />)
  await screen.findAllByText("Details")
  return { ...view, sent }
}

describe("Agents", () => {
  it("shows the team of nine with one picture each, and nothing about any run", async () => {
    const { container, sent } = await show()
    const cards = [...container.querySelectorAll(".team-card")].filter((c) => /^\d\. /.test(c.querySelector("h2")?.textContent ?? "")) // the nine role cards
    expect(cards.map((c) => c.querySelector("h2")!.textContent)).toEqual(["1. Scout", "2. Proposer", "3. Pilot", "4. Experimenter", "5. Auditor", "6. Critic", "7. Reviser", "8. Finisher", "9. Reporter"])
    for (const card of cards) expect(card.querySelectorAll("svg[data-agent]")).toHaveLength(1)
    expect(container).not.toHaveTextContent(/latest run|did not run|Ran in|No run yet|working now|2026\d{6}/i) // run status lives on Compare
    expect(sent.some((r) => /\/api\/glhf\/runs/.test(r.url))).toBe(false) // it does not even read the runs
    expect(container).not.toHaveTextContent(/swarm|task run|board members/i)
    expect(screen.getByRole("heading", { name: "The team of nine" })).toBeInTheDocument()
  })
  it("each role has one disclosure called Details, named for its role, holding budget, model group and instructions", async () => {
    const { container } = await show()
    const scout = container.querySelector(".team-card")!
    const summary = within(scout as HTMLElement).getByText("Details")
    expect(summary.tagName).toBe("SUMMARY"); expect(summary).toHaveAccessibleName("Details of Scout")
    expect(within(container as HTMLElement).getAllByText("Details")).toHaveLength(9)
    expect(container).not.toHaveTextContent("Budget, model and instructions")
    await userEvent.setup().click(summary)
    expect(scout).toHaveTextContent("up to 3% of the time"); expect(scout).toHaveTextContent("planner group"); expect(scout).toHaveTextContent("Instructions of scout.")
  })
})
