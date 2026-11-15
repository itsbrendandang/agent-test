// The characters are on by default, decoration only, and can be turned off in Settings. The loading screen shows
// while the app really loads, gets out of the way on its own, and never hides an engine that is down.
import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Loading, Mascots } from "@/components/Crew"
import { SideCrew } from "@/components/SideCrew"
import { Splash, SPLASH_MAX_MS, SPLASH_MIN_MS } from "@/components/Splash"
import { SettingsView } from "@/views/SettingsView"
import { charactersShown, setCharactersShown } from "./store"

const reduceMotion = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && /reduce/.test(q), addEventListener: () => undefined, removeEventListener: () => undefined }))

beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe("loading screen", () => {
  const splash = () => screen.queryByRole("status", { name: "Loading AI Scientist Bot" })
  it("carries the product's name, and no old one", () => {
    const { container } = render(<Splash ready={false} />)
    expect(splash()).toHaveTextContent("AI Scientist Bot")
    expect(container.textContent).not.toMatch(/Sim Lab|Drug Board/)
    expect(container.querySelectorAll(".splash-crew svg.buddy")).toHaveLength(5) // the restored crew, as drawn before
    expect(container.querySelector(".splash-crew")).toHaveAttribute("aria-hidden", "true")
  })
  it("appears, then leaves on its own once the app is ready, but not before the minimum", () => {
    vi.useFakeTimers()
    const view = render(<Splash ready={false} />)
    expect(splash()).toBeInTheDocument()
    view.rerender(<Splash ready />)
    act(() => { vi.advanceTimersByTime(SPLASH_MIN_MS - 50) })
    expect(splash()).toHaveAttribute("data-phase", "in") // ready early: still shown, so it does not flash
    act(() => { vi.advanceTimersByTime(60) })
    expect(splash()).toHaveAttribute("data-phase", "out")
    act(() => { vi.advanceTimersByTime(500) })
    expect(splash()).toBeNull()
  })
  it("never stays longer than the maximum, even when nothing answers", () => {
    vi.useFakeTimers()
    render(<Splash ready={false} />)
    act(() => { vi.advanceTimersByTime(SPLASH_MAX_MS - 10) })
    expect(splash()).toHaveAttribute("data-phase", "in")
    act(() => { vi.advanceTimersByTime(20) })
    act(() => { vi.advanceTimersByTime(500) })
    expect(splash()).toBeNull()
    expect(SPLASH_MAX_MS).toBeLessThanOrEqual(2500)
  })
  it("leaves immediately when the engine is down", () => {
    vi.useFakeTimers()
    const view = render(<Splash ready={false} />)
    view.rerender(<Splash ready={false} offline />)
    expect(splash()).toBeNull() // no minimum, no fade: the "start the engine" message must not be hidden
  })
  it("is skipped by a click", () => {
    vi.useFakeTimers()
    render(<Splash ready={false} />)
    fireEvent.click(splash()!)
    expect(splash()).toHaveAttribute("data-phase", "out")
    act(() => { vi.advanceTimersByTime(500) })
    expect(splash()).toBeNull()
  })
  it("is skipped by any key", () => {
    vi.useFakeTimers()
    render(<Splash ready={false} />)
    fireEvent.keyDown(window, { key: "a" })
    act(() => { vi.advanceTimersByTime(500) })
    expect(splash()).toBeNull()
  })
  it("draws the characters still when the person asked for less motion", () => {
    reduceMotion(true)
    const { container } = render(<Splash ready={false} />)
    expect(splash()).toHaveAttribute("data-still", "true") // the style sheet stops every animation under [data-still]
    expect(container.querySelectorAll(".splash-crew svg.buddy")).toHaveLength(5) // still drawn
  })
  it("moves by default", () => {
    reduceMotion(false)
    render(<Splash ready={false} />)
    expect(splash()).not.toHaveAttribute("data-still")
  })
})

describe("characters", () => {
  it("are shown by default, as decoration hidden from screen readers", () => {
    expect(charactersShown()).toBe(true)
    const { container } = render(<Mascots />)
    const row = container.querySelector(".mascots")!
    expect(row).toHaveAttribute("aria-hidden", "true")
    expect(row.querySelectorAll("svg.buddy")).toHaveLength(4)
    expect(container.textContent).toBe("") // they say nothing: no role, no claim to be an agent
  })
  it("the waiting state always has its status in text, with or without characters", () => {
    const view = render(<Loading>The team is discussing: round 2 of 4</Loading>)
    expect(screen.getByRole("status")).toHaveTextContent("The team is discussing: round 2 of 4")
    expect(view.container.querySelector(".mascots")).toHaveAttribute("data-mood", "working")
    act(() => setCharactersShown(false))
    expect(view.container.querySelector(".mascots")).toBeNull()
    expect(screen.getByRole("status")).toHaveTextContent("The team is discussing: round 2 of 4")
  })
  it("are drawn still under reduced motion", () => {
    reduceMotion(true)
    const { container } = render(<Loading>Loading…</Loading>)
    expect(container.querySelector(".mascots")).toHaveAttribute("data-still", "true")
  })
  it("the Settings toggle hides them everywhere, and is remembered", async () => {
    const user = userEvent.setup()
    const rail = render(<SideCrew />)
    expect(screen.getByRole("button", { name: "Momo" })).toBeInTheDocument() // a name, not a job: they are not agents
    render(<SettingsView />)
    const toggle = screen.getByRole("checkbox", { name: "Show characters" })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(screen.queryByRole("button", { name: "Momo" })).toBeNull()
    expect(rail.container).toBeEmptyDOMElement()
    expect(localStorage.getItem("app.characters")).toBe("0")
    expect(charactersShown()).toBe(false)
    await user.click(toggle)
    expect(screen.getByRole("button", { name: "Momo" })).toBeInTheDocument()
  })
  it("the loading screen has no characters when they are off, and still says what it is", () => {
    setCharactersShown(false)
    const { container } = render(<Splash ready={false} />)
    expect(container.querySelector(".splash-crew")).toBeNull()
    expect(screen.getByRole("status", { name: "Loading AI Scientist Bot" })).toHaveTextContent("AI Scientist Bot")
  })
})
