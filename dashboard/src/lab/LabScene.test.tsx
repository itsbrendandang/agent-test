// The scene in jsdom: what each state looks like in the page, that a teammate walks for a trip and only for a
// trip, reduced motion, the pause control, and that frames and listeners are cleaned up.
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { T0, fixtureModel } from "./fixtures/streams"
import { Lab } from "./Lab"
import { LabPanel } from "./LabPanel"
import { LabScene } from "./LabScene"
import { CHARACTERS, WIDE, characterOf, emptyLab, type CharacterId, type LabModel, type Trip } from "./model"
import { stationPoint } from "./motion"

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

/** The name plate under a desk: the control that selects a teammate, and what a screen reader hears. */
const agent = (name: string) => screen.getByRole("button", { name: new RegExp(`^Inspect ${name}:`) })
/** The teammate's figure, which is what moves, and the chip above its head. */
const walker = (id: CharacterId) => document.querySelector<HTMLElement>(`[data-walker="${id}"]`)!
const chip = (id: CharacterId) => document.querySelector<HTMLElement>(`[data-chip="${id}"]`)!
const place = (el: HTMLElement) => `${el.style.left} ${el.style.top}`
/** Where a teammate's desk is, written the way the page writes a place (jsdom rounds what it stores). */
const homeOf = (id: CharacterId) => { const p = stationPoint(characterOf(id)), el = document.createElement("i"); el.style.left = `${(p.x / WIDE.width) * 100}%`; el.style.top = `${(p.y / WIDE.height) * 100}%`; return place(el) }
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
    for (const c of CHARACTERS) {
      expect(agent(c.name)).toHaveAttribute("data-state", "idle")
      expect(place(walker(c.id))).toBe(homeOf(c.id))
      expect(chip(c.id)).not.toBeVisible() // idle says nothing
    }
    expect(screen.getByText("Team idle")).toBeInTheDocument()
    expect(place(walker("scout"))).toBe("39.2% 25.2125%") // in Discovery, by the bookshelf
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it("moves nobody without an event: the same model again asks for no frame", () => {
    const model = quiet()
    const { rerender } = render(<LabScene model={model} clock={T0} />)
    const before = CHARACTERS.map((c) => place(walker(c.id)))
    rerender(<LabScene model={{ ...model }} clock={T0 + 60_000} />)
    rerender(<LabScene model={{ ...model, characters: { ...model.characters } }} clock={T0 + 120_000} />)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(CHARACTERS.map((c) => place(walker(c.id)))).toEqual(before)
  })

  it("shows every state on the teammate in a mark and a word, not by colour alone", () => {
    render(<LabScene model={fixtureModel()} clock={T0 + 3_600_000} />)
    expect(agent("Auditor")).toHaveAttribute("data-state", "working")
    expect(agent("Auditor")).toHaveAccessibleName(/Auditor: Working\. Screening 6 results\./)
    expect(chip("auditor")).toHaveTextContent("… working")
    expect(chip("scout")).toHaveTextContent("⇄ fetching")
    expect(chip("navigator")).toHaveTextContent("→ handed off")
    expect(agent("Navigator")).toHaveAccessibleName(/Handed off/)
    expect(chip("librarian")).toHaveTextContent("✓ done")
    // failed: the word, a mark that stays, and the reason for a screen reader
    expect(agent("Reporter")).toHaveAttribute("data-state", "failed")
    expect(chip("reporter")).toHaveTextContent("✕ failed")
    expect(within(walker("reporter")).getByText("!")).toBeInTheDocument()
    expect(agent("Reporter")).toHaveAccessibleName(/Failed\. Writing the answer: did not work/)
    expect(chip("reviser")).toHaveTextContent("■ cancelled")
    // not part of this run: quiet on the map (no chip, no extra words), said in words to a screen reader and in the tooltip
    const proposer = agent("Proposer")
    expect(proposer).toHaveAttribute("data-in-run", "false")
    expect(proposer).toHaveAccessibleName("Inspect Proposer: Not in this run.")
    expect(proposer).toHaveTextContent(/^Proposer$/)
    expect(chip("proposer")).not.toBeVisible()
    expect(walker("proposer")).toHaveAttribute("title", "Proposer: not in this run")
    // a visiting specialist under its real name
    expect(screen.getByRole("img", { name: /Visitor Toxicologist: Working/ })).toBeInTheDocument()
    expect(screen.getByText("Team at work")).toBeInTheDocument()
  })

  it("lets the keyboard reach and select every teammate", () => {
    const picked: string[] = []
    render(<LabScene model={fixtureModel()} clock={T0 + 3_600_000} onSelect={(id) => picked.push(id)} />)
    const plates = CHARACTERS.map((c) => document.querySelector<HTMLButtonElement>(`button[data-agent="${c.id}"]`)!)
    for (const plate of plates) { expect(plate.tabIndex).toBe(0); plate.focus(); expect(document.activeElement).toBe(plate); fireEvent.click(plate) }
    expect(picked).toEqual(CHARACTERS.map((c) => c.id)) // also the ones that are not in this run
  })

  it("keeps each name plate under its own teammate's place, so no caption can lie on another", () => {
    render(<LabScene model={fixtureModel()} clock={T0 + 3_600_000} />)
    const spots = CHARACTERS.map((c) => { const el = document.querySelector<HTMLElement>(`button[data-agent="${c.id}"]`)!; return [parseFloat(el.style.left), parseFloat(el.style.top)] })
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      const dx = Math.abs(spots[i][0] - spots[j][0]) * 10, dy = Math.abs(spots[i][1] - spots[j][1]) * 7.06 // map units
      expect(dx >= 170 || dy >= 150, `${CHARACTERS[i].name} and ${CHARACTERS[j].name}`).toBe(true)
    }
  })

  it("walks a teammate to the room for a fetch, waits there, then carries the parcel home", async () => {
    const { rerender } = render(<LabScene model={quiet([out])} clock={T0} />)
    const guardian = walker("guardian"), home = place(guardian)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    await frames(20)
    expect(place(guardian)).not.toBe(home)
    expect(guardian).toHaveAttribute("data-moving", "true")
    expect(guardian).toHaveAttribute("data-carrying", "false")
    expect(chip("guardian")).toHaveTextContent("Guardian ⇄") // away from its desk, the chip says who it is
    expect(place(document.querySelector<HTMLElement>('button[data-agent="guardian"]')!)).not.toBe(place(guardian)) // the name plate stays at the desk
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
    expect(chip("guardian")).toHaveTextContent("Guardian: ✓ Supported")
    await frames(1500)
    expect(place(guardian)).toBe(home)
    expect(place(guardian)).not.toBe(waitingAt)
    expect(guardian).toHaveAttribute("data-carrying", "false")
    expect(chip("guardian")).toHaveTextContent("⇄ fetching") // back at its desk: the state alone
    expect(pending.size).toBe(0) // everyone is home: the loop ended itself
  })

  it("moves a walker's chip to a free side when another teammate is in the way", async () => {
    // the Reviser stands at the desk beside the Guardian's; the Guardian's chip above its head is taken as it walks past
    const model = quiet([out])
    model.characters.reviser = { ...model.characters.reviser, state: "working", doing: "Revising." }
    render(<LabScene model={model} clock={T0} />)
    const tops = new Set<number>()
    for (let i = 0; i < 40; i++) { await frames(1); const c = chip("guardian"), w = walker("guardian"); tops.add(Math.round((parseFloat(c.style.top) - parseFloat(w.style.top)) * 10)) }
    expect(tops.size).toBeGreaterThanOrEqual(1)
    // whatever side it takes, it never sits on the Reviser's chip
    const a = chip("guardian"), b = chip("reviser")
    expect(Math.abs(parseFloat(a.style.left) - parseFloat(b.style.left)) > 2 || Math.abs(parseFloat(a.style.top) - parseFloat(b.style.top)) > 2).toBe(true)
  })

  it("does not walk a trip that is history when the scene first sees it", () => {
    render(<LabScene model={quiet([back])} clock={T0 + 10 * 60_000} />)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it("does not walk again when a replay jumps (settleKey changes)", async () => {
    const { rerender } = render(<LabScene model={quiet([out])} clock={T0} settleKey={0} />)
    await frames(30)
    rerender(<LabScene model={quiet([back, { ...back, id: "t2" }])} clock={T0 + 1000} settleKey={1} />)
    expect(place(walker("guardian"))).toBe(homeOf("guardian")) // back at its desk at once
    expect(pending.size).toBe(0)
  })

  it("with reduced motion nobody walks, and the state and the parcel still show", async () => {
    motion(true)
    const { rerender } = render(<LabScene model={quiet([out])} clock={T0} />)
    const guardian = walker("guardian"), home = place(guardian)
    rerender(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    await frames(50)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(place(guardian)).toBe(home)
    expect(agent("Guardian")).toHaveAttribute("data-state", "fetching")
    expect(guardian).toHaveAttribute("data-carrying", "true")
    expect(chip("guardian")).toHaveTextContent("✓ Supported")
    const pause = screen.getByRole("button", { name: "Reduced motion enabled" })
    expect(pause).toBeDisabled()
    expect(pause).toHaveAttribute("aria-pressed", "true")
  })

  it("Pause motion stops the walk where it is and Resume motion goes on; the choice is remembered", async () => {
    const { unmount } = render(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    await frames(20)
    const guardian = walker("guardian")
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
    const guardian = walker("guardian")
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
    const guardian = walker("guardian")
    expect(place(guardian)).not.toBe(homeOf("guardian"))
    rerender(<LabScene model={{ ...quiet([back], { state: "cancelled", doing: "Cancelled: back at its desk." }), status: "cancelled" }} clock={T0 + 2000} />)
    await frames(1500)
    expect(place(guardian)).toBe(homeOf("guardian"))
    expect(guardian).toHaveAttribute("data-carrying", "false")
    expect(chip("guardian")).toHaveTextContent("■ cancelled")
    expect(screen.getByText("Run cancelled")).toBeInTheDocument()
  })

  it("works where the browser has no animation frames or media queries", () => {
    vi.stubGlobal("requestAnimationFrame", undefined)
    vi.stubGlobal("matchMedia", undefined)
    render(<LabScene model={quiet([back])} clock={T0 + 1000} />)
    expect(agent("Guardian")).toHaveAttribute("data-state", "fetching")
    expect(screen.getByRole("button", { name: "Motion not available" })).toBeDisabled()
  })

  it("draws the same rooms in one column when asked for the narrow map, with every teammate still on it", () => {
    render(<LabScene model={fixtureModel()} clock={T0 + 3_600_000} layout="tall" />)
    expect(document.querySelector(".lab-scene")).toHaveAttribute("data-layout", "tall")
    for (const c of CHARACTERS) {
      const w = walker(c.id)
      expect(parseFloat(w.style.left)).toBeLessThan(87) // all in the one column, left of the corridor
      expect(parseFloat(w.style.top)).toBeGreaterThan(0); expect(parseFloat(w.style.top)).toBeLessThan(100)
    }
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(12)
  })

  it("lights a room's equipment only while the model says a teammate of it is working or fetching", () => {
    const room = (id: string) => document.querySelector(`.lab-room[data-room="${id}"]`)!
    const label = (name: string) => screen.getByText(name).closest(".lab-room-name")!
    const { rerender } = render(<LabScene model={emptyLab()} />)
    expect(document.querySelectorAll(".lab-room[data-active]")).toHaveLength(0) // no run: every room is still
    for (const r of ["Discovery", "Quality control"]) expect(label(r)).toHaveAttribute("data-room-state", "rest")
    // the Guardian (Quality control) is out fetching in Evidence review: its own room and the room it fetches in
    rerender(<LabScene model={quiet([out])} clock={T0} />)
    expect([...document.querySelectorAll(".lab-room[data-active]")].map((el) => el.getAttribute("data-room"))).toEqual(["review", "quality"])
    expect(label("Quality control")).toHaveAttribute("data-room-state", "active")
    expect(label("Quality control")).toHaveAttribute("title", "Quality control: someone is working here")
    expect(room("discovery")).not.toHaveAttribute("data-active")
    // it is back and done: nothing is lit any more, and its room says done only when all of its teammates are
    rerender(<LabScene model={quiet([back], { state: "done", doing: "Checked." })} clock={T0 + 600_000} />)
    expect(document.querySelectorAll(".lab-room[data-active]")).toHaveLength(0)
    expect(label("Quality control")).toHaveAttribute("data-room-state", "rest") // the Reviser is not done
    // the equipment's animation is CSS on data-active; without motion the map is marked still, which switches it off
    motion(true)
    rerender(<LabScene model={quiet([out])} clock={T0} />)
    expect(document.querySelector(".lab")).toBeInTheDocument()
  })

  it("draws the map of Agent Lab 2.0: every room's furniture, wall items and counter equipment", () => {
    render(<LabScene model={emptyLab()} />)
    const kinds = (id: string) => [...document.querySelectorAll(`.lab-room[data-room="${id}"] [data-furniture]`)].map((el) => el.getAttribute("data-furniture")).sort()
    expect(kinds("discovery")).toEqual(["cabinet", "labtable", "plant", "plant", "shelf"])
    expect(kinds("review")).toEqual(["desk2", "microscope", "plant", "rack"])
    expect(kinds("quality")).toEqual(["clipdesk", "plant", "plant", "shielddesk"])
    expect(kinds("report")).toEqual(["desk2", "easel", "plant", "printer", "shelf"])
    expect(document.querySelectorAll(".lab-room")).toHaveLength(6)
    expect(document.querySelector(".lab-map canvas")).toBeNull() // drawn as SVG: no canvas is needed
  })

  it("gives each teammate a Buddy with 2.0's mood: asleep with no run, at work, alarmed when its step failed", () => {
    const mood = (id: CharacterId) => walker(id).querySelector("svg[data-mood]")!.getAttribute("data-mood")
    const { rerender } = render(<LabScene model={emptyLab()} />)
    expect(CHARACTERS.map((c) => mood(c.id))).toEqual(Array(12).fill("sleeping")) // no run: everyone rests
    rerender(<LabScene model={fixtureModel()} clock={T0 + 3_600_000} />)
    expect([mood("auditor"), mood("scout"), mood("reporter"), mood("librarian"), mood("proposer"), mood("critic"), mood("reviser")]).toEqual(["working", "working", "alert", "happy", "sleeping", "happy", "sleeping"])
  })

  it("shows what is in hand: the tool of a teammate at work, and the item a walk carries", async () => {
    const held = (id: CharacterId) => walker(id).querySelector<HTMLElement>(".lab-held")!
    const model = quiet([back])
    model.characters.reporter = { ...model.characters.reporter, state: "working", doing: "Writing." }
    model.characters.auditor = { ...model.characters.auditor, state: "working", doing: "Screening." }
    render(<LabScene model={model} clock={T0 + 1000} />)
    expect(held("reporter")).toHaveAttribute("data-tool", "pencil") // writing
    expect(held("auditor")).not.toHaveAttribute("data-tool") // it types at its screen: nothing in hand
    expect(held("finisher")).not.toHaveAttribute("data-tool") // idle: nothing in hand
    expect(held("guardian")).toHaveAttribute("data-kind", "") // on its way out with empty hands
    // it picks the checked statement up in Evidence review and carries it home as a slide
    const kinds = new Set<string>()
    for (let i = 0; i < 400; i++) { await frames(5); kinds.add(held("guardian").getAttribute("data-kind") ?? "") }
    expect([...kinds].sort()).toEqual(["", "slide"])
    await frames(500)
    expect(held("guardian")).toHaveAttribute("data-kind", "") // delivered
  })

  it("turns a walking teammate to face the way it goes", async () => {
    render(<LabScene model={quiet([out])} clock={T0} />)
    const flip = walker("guardian").querySelector<HTMLElement>(".lab-flip")!
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) { await frames(5); seen.add(flip.style.transform) }
    expect(seen.has("scaleX(1)")).toBe(true) // out to the right, towards the corridor
    expect(seen.size).toBeGreaterThanOrEqual(1)
  })

  it("shows the replay controls it is given in the bar under the map, beside Pause motion", () => {
    render(<LabScene model={emptyLab()} footer={<span>player goes here</span>} />)
    const bar = screen.getByText("player goes here").parentElement!
    expect(within(bar).getByRole("button", { name: "Pause motion" })).toBeInTheDocument()
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
    expect(container.querySelector("img, script, .lab-facts b, .lab-log b")).toBeNull()
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
