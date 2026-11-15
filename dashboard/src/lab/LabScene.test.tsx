// The scene in jsdom: what each state looks like in the page, that a teammate walks for a trip and only for a
// trip, reduced motion, the pause control, and that frames and listeners are cleaned up.
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { T0, fixtureModel } from "./fixtures/streams"
import { Lab } from "./Lab"
import { LabPanel } from "./LabPanel"
import { LabScene } from "./LabScene"
import { CHARACTERS, emptyLab, type LabModel, type Trip } from "./model"

// A stand-in for the browser's frames: nothing runs until a test asks for it.
let pending = new Map<number, FrameRequestCallback>(), nextId = 1, now = 0
const frames = (n: number, ms = 16) => act(() => { for (let i = 0; i < n; i++) { now += ms; const run = [...pending]; pending.clear(); for (const [, cb] of run) cb(now) } })
const motion = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }))
beforeEach(() => {
  pending = new Map(); nextId = 1; now = 0
  vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => { const id = nextId++; pending.set(id, cb); return id }))
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { pending.delete(id) }))
  motion(false)
})
afterEach(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }) })

const agent = (name: string) => screen.getByRole("button", { name: new RegExp(`^Inspect ${name}:`) })
const place = (el: HTMLElement) => `${el.style.left} ${el.style.top}`
const out: Trip = { id: "t1", kind: "fetch", room: "review", label: "Checking", short: "…", at: T0 }
const back: Trip = { ...out, back: T0 + 1000, outcome: "carried", label: "✓ Supported: “a statement”", short: "✓ Supported" }
const quiet = (trips: Trip[] = [], more: Partial<LabModel["characters"]["guardian"]> = {}): LabModel => {
  const m = { ...emptyLab(), runId: "r1", status: "running" as const }
  m.characters.guardian = { ...m.characters.guardian, state: trips.length ? "fetching" : "idle", doing: "Checking statements.", trips, ...more }
  return m
}

describe("LabScene", () => {
  it("shows the six rooms and the twelve teammates at their desks when nothing is running, and asks for no frame", () => {
    render(<LabScene model={emptyLab()} />)
    for (const room of ["Discovery", "Planning", "Experiment bench", "Evidence review", "Quality control", "Report studio"]) expect(screen.getByText(room)).toBeInTheDocument()
    for (const c of CHARACTERS) expect(agent(c.name)).toHaveAttribute("data-state", "idle")
    expect(screen.getByText("Team idle")).toBeInTheDocument()
    expect(place(agent("Scout"))).toBe("14.5% 22.2973%") // Anh's first desk in Discovery
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it("moves nobody without an event: the same model again asks for no frame", () => {
    const model = quiet()
    const { rerender } = render(<LabScene model={model} clock={T0} />)
    const before = CHARACTERS.map((c) => place(agent(c.name)))
    rerender(<LabScene model={{ ...model }} clock={T0 + 60_000} />)
    rerender(<LabScene model={{ ...model, characters: { ...model.characters } }} clock={T0 + 120_000} />)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(CHARACTERS.map((c) => place(agent(c.name)))).toEqual(before)
  })

  it("shows every state on the teammate in words or a mark, not by colour alone", () => {
    render(<LabScene model={fixtureModel()} clock={T0 + 3_600_000} />)
    expect(agent("Auditor")).toHaveAttribute("data-state", "working")
    expect(agent("Auditor")).toHaveAccessibleName(/Auditor: Working\. Screening 6 results\./)
    expect(within(agent("Auditor")).getByText(/…/)).toBeInTheDocument()
    expect(agent("Scout")).toHaveAttribute("data-state", "fetching")
    expect(agent("Navigator")).toHaveAccessibleName(/Handed off/)
    expect(within(agent("Librarian")).getByText(/✓/)).toBeInTheDocument()
    // failed: the word, a mark that stays, and the reason for a screen reader
    const reporter = agent("Reporter")
    expect(reporter).toHaveAttribute("data-state", "failed")
    expect(within(reporter).getByText("failed")).toBeInTheDocument()
    expect(within(reporter).getByText("!")).toBeInTheDocument()
    expect(reporter).toHaveAccessibleName(/Failed\. Writing the answer: did not work/)
    expect(within(agent("Reviser")).getByText("cancelled")).toBeInTheDocument()
    // not part of this run: said in words, and never shown as working
    const proposer = agent("Proposer")
    expect(proposer).toHaveAttribute("data-in-run", "false")
    expect(within(proposer).getByText("not in this run")).toBeInTheDocument()
    expect(proposer).toHaveAccessibleName("Inspect Proposer: Not in this run.")
    // a visiting specialist under its real name
    expect(screen.getByRole("img", { name: /Visitor Toxicologist: Working/ })).toBeInTheDocument()
    expect(screen.getByText("Team at work")).toBeInTheDocument()
  })

  it("walks a teammate to the room for a fetch, waits there, then carries the parcel home", async () => {
    const { rerender } = render(<LabScene model={quiet([out])} clock={T0} />)
    const guardian = agent("Guardian"), home = place(guardian)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    await frames(20)
    expect(place(guardian)).not.toBe(home)
    expect(guardian).toHaveAttribute("data-moving", "true")
    expect(guardian).toHaveAttribute("data-carrying", "false")
    await frames(1500)
    // at the pick-up point in Evidence review, waiting: no more frames are asked for
    expect(guardian).toHaveAttribute("data-moving", "false")
    expect(pending.size).toBe(0)
    const waitingAt = place(guardian)
    expect(parseFloat(guardian.style.left)).toBeGreaterThan(56)
    // the engine reports the result: the parcel appears with its label and is carried back
    rerender(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    await frames(100)
    expect(guardian).toHaveAttribute("data-carrying", "true")
    expect(within(guardian).getByText("✓ Supported")).toBeInTheDocument()
    await frames(1500)
    expect(place(guardian)).toBe(home)
    expect(place(guardian)).not.toBe(waitingAt)
    expect(guardian).toHaveAttribute("data-carrying", "false")
    expect(pending.size).toBe(0) // everyone is home: the loop ended itself
  })

  it("does not walk a trip that is history when the scene first sees it", () => {
    render(<LabScene model={quiet([back])} clock={T0 + 10 * 60_000} />)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it("does not walk again when a replay jumps (settleKey changes)", async () => {
    const { rerender } = render(<LabScene model={quiet([out])} clock={T0} settleKey={0} />)
    await frames(30)
    const guardian = agent("Guardian")
    rerender(<LabScene model={quiet([back, { ...back, id: "t2" }])} clock={T0 + 1000} settleKey={1} />)
    expect(place(guardian)).toBe("33.5% 87.1622%") // back at its desk at once
    expect(pending.size).toBe(0)
  })

  it("with reduced motion nobody walks, and the state and the parcel still show", async () => {
    motion(true)
    const { rerender } = render(<LabScene model={quiet([out])} clock={T0} />)
    const guardian = agent("Guardian"), home = place(guardian)
    rerender(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    await frames(50)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(place(guardian)).toBe(home)
    expect(guardian).toHaveAttribute("data-state", "fetching")
    expect(guardian).toHaveAttribute("data-carrying", "true")
    expect(within(guardian).getByText("✓ Supported")).toBeInTheDocument()
    const pause = screen.getByRole("button", { name: "Reduced motion enabled" })
    expect(pause).toBeDisabled()
    expect(pause).toHaveAttribute("aria-pressed", "true")
  })

  it("Pause motion stops the walk where it is and Resume motion goes on; the choice is remembered", async () => {
    const { unmount } = render(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    await frames(20)
    const guardian = agent("Guardian")
    fireEvent.click(screen.getByRole("button", { name: "Pause motion" }))
    const held = place(guardian)
    await frames(50)
    expect(place(guardian)).toBe(held)
    expect(pending.size).toBe(0)
    expect(localStorage.getItem("lab.paused")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "Resume motion" }))
    await frames(20)
    expect(place(guardian)).not.toBe(held)
    unmount()
    localStorage.setItem("lab.paused", "true")
    render(<LabScene model={quiet([{ ...back, id: "t9" }])} clock={T0 + 1000} />)
    expect(screen.getByRole("button", { name: "Resume motion" })).toHaveAttribute("aria-pressed", "true")
  })

  it("asks for no frames while the tab is hidden and goes on when it is shown again", async () => {
    render(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    await frames(10)
    const guardian = agent("Guardian")
    Object.defineProperty(document, "hidden", { configurable: true, value: true })
    act(() => { document.dispatchEvent(new Event("visibilitychange")) })
    expect(pending.size).toBe(0)
    const held = place(guardian)
    await frames(30)
    expect(place(guardian)).toBe(held)
    Object.defineProperty(document, "hidden", { configurable: true, value: false })
    act(() => { document.dispatchEvent(new Event("visibilitychange")) })
    await frames(30)
    expect(place(guardian)).not.toBe(held)
  })

  it("cancels its frame and removes its listener when it goes away", async () => {
    const removed = vi.spyOn(document, "removeEventListener")
    const { unmount } = render(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    await frames(5)
    expect(pending.size).toBe(1)
    unmount()
    expect(pending.size).toBe(0)
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(removed).toHaveBeenCalledWith("visibilitychange", expect.any(Function))
  })

  it("sends everyone home when the run is cancelled", async () => {
    const { rerender } = render(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    await frames(60)
    const guardian = agent("Guardian")
    expect(place(guardian)).not.toBe("33.5% 87.1622%")
    rerender(<LabScene model={{ ...quiet([back], { state: "cancelled", doing: "Cancelled: back at its desk." }), status: "cancelled" }} clock={T0 + 2000} />)
    await frames(1500)
    expect(place(guardian)).toBe("33.5% 87.1622%")
    expect(guardian).toHaveAttribute("data-carrying", "false")
    expect(within(guardian).getByText("cancelled")).toBeInTheDocument()
    expect(screen.getByText("Run cancelled")).toBeInTheDocument()
  })

  it("works where the browser has no animation frames or media queries", () => {
    vi.stubGlobal("requestAnimationFrame", undefined)
    vi.stubGlobal("matchMedia", undefined)
    render(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    expect(agent("Guardian")).toHaveAttribute("data-state", "fetching")
    expect(screen.getByRole("button", { name: "Motion not available" })).toBeDisabled()
  })
})

describe("LabPanel and Lab", () => {
  it("says who the selected teammate is, what it stands for, what it does, since when and what it last fetched", () => {
    render(<LabPanel model={fixtureModel()} selected="guardian" />)
    const panel = screen.getByRole("complementary", { name: /Selected teammate/ })
    expect(within(panel).getByRole("heading", { name: "Guardian" })).toBeInTheDocument()
    expect(within(panel).getByTestId("lab-status")).toHaveTextContent("Fetching")
    expect(within(panel).getByText("Quality control")).toBeInTheDocument()
    expect(within(panel).getByText(/the real agent the guardian stands for/)).toBeInTheDocument()
    expect(within(panel).getByText(/Checking 4 statements against their sources: 1 of 4 so far\./)).toBeInTheDocument()
    expect(within(panel).getByText("Since")).toBeInTheDocument()
    expect(within(panel).getByText(/✓ Supported: “Placeholder statement one\.”/)).toBeInTheDocument()
    expect(within(panel).getByText(/in Evidence review/)).toBeInTheDocument()
  })

  it("keeps a failed step in the panel and marks a teammate that is not in the run", () => {
    const { rerender } = render(<LabPanel model={fixtureModel()} selected="reporter" />)
    expect(screen.getByTestId("lab-status")).toHaveTextContent("Failed")
    expect(screen.getByText("A step of its own failed")).toBeInTheDocument()
    rerender(<LabPanel model={fixtureModel()} selected="pilot" />)
    expect(screen.getByTestId("lab-status")).toHaveTextContent("Not in this run")
    expect(screen.queryByText("Doing now")).not.toBeInTheDocument()
  })

  it("lists the activity newest first, and the visiting specialists", () => {
    render(<LabPanel model={fixtureModel()} selected="scout" />)
    const lines = within(screen.getByRole("log")).getAllByRole("listitem").map((li) => li.textContent)
    expect(lines[0]).toMatch(/Reporter: writing the answer: did not work\./)
    expect(lines.at(-1)).toMatch(/Fixture: the run started\./)
    expect(screen.getByText("Visiting specialists")).toBeInTheDocument()
    expect(screen.getByText(/Why it joined: Fixture\./)).toBeInTheDocument()
  })

  it("renders run text as text, never as markup", () => {
    const model = fixtureModel({ scout: { doing: "<img src=x onerror=alert(1)> <b>bold</b>" } })
    model.log.push({ id: "x", at: T0, text: "<script>alert(1)</script>" })
    const { container } = render(<Lab model={model} clock={T0 + 3_600_000} />)
    fireEvent.click(agent("Scout"))
    expect(container.querySelector("img, script, b:not(.lab-visitors b)")).toBeNull()
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument()
  })

  it("follows the teammate reported on last until one is clicked", () => {
    const model = fixtureModel({ auditor: { since: T0 + 5000 } })
    render(<Lab model={model} clock={T0 + 3_600_000} />)
    expect(screen.getByRole("heading", { name: "Auditor" })).toBeInTheDocument()
    fireEvent.click(agent("Finisher"))
    expect(screen.getByRole("heading", { name: "Finisher" })).toBeInTheDocument()
    expect(agent("Finisher")).toHaveAttribute("aria-pressed", "true")
    expect(agent("Auditor")).toHaveAttribute("aria-pressed", "false")
  })
})
