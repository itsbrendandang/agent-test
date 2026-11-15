// The demo characters are behind one flag, VITE_DEMO_CREW. Off (the default): no view names them, also for a browser
// that saved them earlier. On: they are back.
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SideCrew } from "@/components/SideCrew"
import { AgentsView } from "@/views/AgentsView"
import { DEFAULT_CREW, demoCrew } from "./store"

const NAMES = ["Momo", "Ember", "Fuji"]
const views = [
  ["the rail", () => <SideCrew />],
  ["the Agents view", () => <AgentsView />],
] as const

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))) // the engine never answers; these views must not need it
})
afterEach(() => vi.unstubAllEnvs())

describe("flag off (the default)", () => {
  it("is off unless VITE_DEMO_CREW is exactly 1", () => {
    expect(demoCrew()).toBe(false)
    vi.stubEnv("VITE_DEMO_CREW", "true")
    expect(demoCrew()).toBe(false)
    vi.stubEnv("VITE_DEMO_CREW", "1")
    expect(demoCrew()).toBe(true)
  })
  it.each(views)("%s does not name the characters", (_where, view) => {
    render(view())
    for (const name of NAMES) expect(screen.queryByText(name)).toBeNull()
    for (const name of NAMES) expect(screen.queryByDisplayValue(name)).toBeNull()
  })
  it.each(views)("%s does not show characters a browser saved earlier", (_where, view) => {
    localStorage.setItem("simlab.crew.v1", JSON.stringify([...DEFAULT_CREW, { id: "x", name: "Pixel", role: "Scout", species: "egg" }]))
    render(view())
    for (const name of [...NAMES, "Pixel"]) { expect(screen.queryByText(name)).toBeNull(); expect(screen.queryByDisplayValue(name)).toBeNull() }
    expect(localStorage.getItem("simlab.crew.v1")).toContain("Pixel") // hidden, not deleted
  })
  it("leaves no empty box behind", () => {
    const rail = render(<SideCrew />)
    expect(rail.container).toBeEmptyDOMElement()
    rail.unmount()
    const agents = render(<AgentsView />)
    expect(agents.container.querySelector(".cast-card:not(.team-card)")).toBeNull()
    expect(screen.queryByText("Your crew")).toBeNull()
  })
  it("keeps the nine swarm role cards in the Agents view", () => {
    const { container } = render(<AgentsView />)
    expect(container.querySelectorAll(".team-card")).toHaveLength(9)
    expect(screen.getByText("1. Scout")).toBeInTheDocument()
    expect(screen.getByText("9. Reporter")).toBeInTheDocument()
  })
})

describe("flag on", () => {
  beforeEach(() => vi.stubEnv("VITE_DEMO_CREW", "1"))
  it("names the characters in the rail", () => {
    render(<SideCrew />)
    for (const [name, role] of [["Momo", "Researcher"], ["Ember", "Builder"], ["Fuji", "Reviewer"]]) expect(screen.getByRole("button", { name: `${name}, ${role}` })).toBeInTheDocument()
  })
  it("shows the crew editor in the Agents view", () => {
    render(<AgentsView />)
    expect(screen.getByText("Your crew")).toBeInTheDocument()
    for (const name of NAMES) expect(screen.getByDisplayValue(name)).toBeInTheDocument()
  })
  it("shows what a browser saved in their place", () => {
    localStorage.setItem("simlab.crew.v1", JSON.stringify([{ id: "x", name: "Pixel", role: "Scout", species: "egg" }]))
    render(<SideCrew />)
    expect(screen.getByRole("button", { name: "Pixel, Scout" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Momo/ })).toBeNull()
  })
})
