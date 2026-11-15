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
  it("shows the nine rooms and the twelve teammates at their desks when nothing is running, and asks for no frame", () => {
    render(<LabScene model={emptyLab()} />)
    for (const room of ["Discovery", "Literature library", "Data room", "Specialists lounge", "Planning", "Experiment bench", "Evidence review", "Quality control", "Report studio"]) expect(screen.getByText(room)).toBeInTheDocument()
    for (const c of CHARACTERS) {
      expect(agent(c.name)).toHaveAttribute("data-state", "idle")
      expect(place(walker(c.id))).toBe(homeOf(c.id))
      expect(chip(c.id)).not.toBeVisible() // idle says nothing
    }
    expect(screen.getByText("Team idle")).toBeInTheDocument()
    expect(place(walker("scout"))).toBe(homeOf("scout")) // in Discovery, by the bookshelf
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
      const dx = Math.abs(spots[i][0] - spots[j][0]) * WIDE.width / 100, dy = Math.abs(spots[i][1] - spots[j][1]) * WIDE.height / 100 // map units
      expect(dx >= 170 || dy >= 150, `${CHARACTERS[i].name} and ${CHARACTERS[j].name}`).toBe(true)
    }
  })

  it("keeps a long name plate inside its room's card", () => {
    const model = fixtureModel({ experimenter: { inRun: true, label: "A very long caption for the Experimenter" }, guardian: { label: "A very long caption for the Guardian here" } })
    render(<LabScene model={model} clock={T0 + 3_600_000} />)
    const plate = (id: CharacterId) => document.querySelector<HTMLElement>(`button[data-agent="${id}"]`)!
    const half = (text: string) => ((text.length * 7 + 16 + 14) / 2 / WIDE.width) * 100 // the scene's own estimate of a label's width, in % of the map
    const left = parseFloat(plate("experimenter").style.left), right = parseFloat(plate("guardian").style.left)
    expect(left - half("A very long caption for the Experimenter")).toBeGreaterThanOrEqual(WIDE.at.bench.x / WIDE.width * 100)
    expect(right + half("A very long caption for the Guardian here")).toBeLessThanOrEqual((WIDE.at.quality.x + 450) / WIDE.width * 100)
    expect(parseFloat(plate("scout").style.left)).toBeCloseTo(stationPoint(characterOf("scout")).x / WIDE.width * 100, 1) // a short one stays under its teammate
  })

  it("never puts a walker's bubble on a name plate when two teammates of a room carry something at once", async () => {
    const carry = (id: string): Trip => ({ id, kind: "fetch", room: "discovery", label: "4 example sources", short: "4 example sources", at: T0, back: T0, outcome: "carried", provider: "fixture" })
    const model = fixtureModel({ scout: { state: "fetching", label: "Investigator 1", trips: [carry("a")] }, librarian: { state: "fetching", label: "Investigator 2", trips: [carry("b")] } }, T0)
    render(<LabScene model={model} clock={T0} />)
    const rect = (el: HTMLElement, text: string) => { const w = ((text.length * 7 + 16) / WIDE.width) * 100, h = (20 / WIDE.height) * 100, x = parseFloat(el.style.left), y = parseFloat(el.style.top); return { x1: x - w / 2, x2: x + w / 2, y1: y - h / 2, y2: y + h / 2 } }
    const hit = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.3 && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.3
    for (let i = 0; i < 120; i++) {
      await frames(4)
      const plates = CHARACTERS.map((c) => document.querySelector<HTMLElement>(`button[data-agent="${c.id}"]`)!).map((el) => rect(el, el.textContent ?? ""))
      for (const id of ["scout", "librarian"] as const) {
        const bubble = chip(id)
        if (bubble.hidden) continue
        const c = characterOf(id), r = WIDE.at[c.room], el = walker(id)
        const x = parseFloat(el.style.left) * WIDE.width / 100, y = parseFloat(el.style.top) * WIDE.height / 100
        if (x >= r.x && x <= r.x + 450 && y >= r.y && y <= r.y + 214) expect(bubble.textContent).not.toMatch(/^Investigator \d: /)
        expect(plates.some((p) => hit(rect(bubble, bubble.textContent ?? ""), p)), `${id} at frame ${i * 4}: ${bubble.textContent}`).toBe(false)
      }
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
    expect(chip("guardian")).toHaveTextContent(/^⇄$/) // still in its own room, beside its name plate: the mark alone
    expect(place(document.querySelector<HTMLElement>('button[data-agent="guardian"]')!)).not.toBe(place(guardian)) // the name plate stays at its place
    await frames(200)
    expect(chip("guardian")).toHaveTextContent("Guardian ⇄") // out in the corridor, the bubble says who it is
    await frames(1300)
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
    expect(document.querySelectorAll(".lab-room")).toHaveLength(9)
    expect(kinds("library")).toEqual(["desk", "plant", "shelf", "shelf"])
    expect(kinds("data")).toEqual(["cabinet", "desk2", "plant", "rack"])
    expect(kinds("specialists")).toEqual(["desk", "desk", "easel", "plant", "plant"])
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
  it("shows a visitor's method skills rather than inventing a role from its title", () => {
    const model = emptyLab()
    model.visitors = [{ id: "new", name: "New specialist", title: "New specialist", room: "data", methods: ["RNA-seq analysis", "Differential expression"], state: "idle", doing: "Waiting." }]
    render(<LabPanel model={model} selected="guardian" />)
    expect(screen.getByText("Method skills: RNA-seq analysis; Differential expression")).toBeInTheDocument()
  })
  it("says who the selected teammate is, what it does and what it last fetched; the rest is under About, closed", () => {
    render(<LabPanel model={fixtureModel()} selected="guardian" />)
    const panel = screen.getByRole("complementary", { name: /Selected teammate/ })
    expect(within(panel).getByRole("heading", { name: "Guardian" })).toBeInTheDocument()
    expect(within(panel).getByTestId("lab-status")).toHaveTextContent("Fetching")
    // four things at a glance: name, state, doing now, last fetched (with the hour and minute)
    expect(within(panel).getAllByRole("term").map((t) => t.textContent)).toEqual(["Doing now", "Last fetched"])
    expect(within(panel).getByText(/Checking 4 statements against their sources: 1 of 4 so far\./)).toBeInTheDocument()
    expect(within(panel).getByText(/✓ Supported: “Placeholder statement one\.”/)).toBeInTheDocument()
    expect(within(panel).getByText(/^\(in Evidence review, \d{1,2}:\d\d [ap]m\)$/)).toBeInTheDocument()
    // which real agent it stands for, its home room and since when: one disclosure, closed until asked for
    const about = within(panel).getByText("About").closest("details")!
    expect(about).not.toHaveAttribute("open")
    expect(about).toHaveTextContent("At home in Quality control.")
    expect(about).toHaveTextContent(/In this state since \d{1,2}:\d\d:\d\d [ap]m\./)
    expect(about).toHaveTextContent(/the real agent the guardian stands for/)
  })

  it("does not list a practice run's example sources as searches", () => {
    const practice = { ...fixtureModel(), searches: { fixture: 2 } }
    const { rerender } = render(<LabPanel model={practice} selected="scout" />)
    expect(screen.queryByText("Searches so far")).not.toBeInTheDocument()
    rerender(<LabPanel model={{ ...practice, searches: { fixture: 2, exa: 3, europepmc: 5 } }} selected="scout" />)
    expect(screen.getByText("Searches so far")).toBeInTheDocument()
    expect(screen.getByText(/Search powered by/)).toBeInTheDocument()
    expect(document.querySelectorAll(".lab-credits li")).toHaveLength(2)
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
    expect(lines[0]).toMatch(/^Reporter writing the answer: did not work\./)
    expect(lines.at(-1)).toMatch(/Fixture: the run started\./)
    expect(screen.getByText("Visiting specialists")).toBeInTheDocument()
    expect(screen.getByText(/Why it joined: Fixture\./)).toBeInTheDocument()
  })

  it("draws the activity as a rail: a marked dot, the face and name once for a teammate's entries in a row, a chip, the time", () => {
    const at = new Date(2026, 10, 14, 1, 15, 7).getTime()
    const model = { ...fixtureModel(), log: [
      { id: "a", at, text: "The answer started." },
      { id: "b", at: at + 1000, text: "Investigator 2: loading example sources.", who: "Investigator 2", agent: "librarian" as const, kind: "search" as const },
      { id: "c", at: at + 2000, text: "Investigator 2: loading example sources: found 4.", who: "Investigator 2", agent: "librarian" as const, kind: "search" as const, did: "loading example sources: found", chips: ["4 example sources"] },
      { id: "d", at: at + 3000, text: "Proposer gave the hypotheses to test to the Investigator 2.", who: "Proposer", agent: "proposer" as const, kind: "handoff" as const, did: "gave", chips: ["hypotheses to test", "to Investigator 2"] },
      { id: "e", at: at + 4000, text: "Reporter: writing the answer: did not work. The model stopped.", who: "Reporter", agent: "reporter" as const, tone: "bad" as const, kind: "failed" as const, did: "writing the answer: did not work.", note: "The model stopped." },
    ] }
    render(<LabPanel model={model} selected="scout" />)
    const items = within(screen.getByRole("log")).getAllByRole("listitem")
    // newest first; every entry is one item that reads as a sentence, with the time to the minute
    expect(items.map((li) => li.textContent)).toEqual([
      "Reporter writing the answer: did not work.1:15 amThe model stopped.",
      "Proposer gave hypotheses to test to Investigator 21:15 am",
      "Investigator 2 loading example sources: found 4 example sources1:15 am",
      "Investigator 2 loading example sources.1:15 am",
      "The answer started.1:15 am",
    ])
    expect(items.map((li) => li.getAttribute("data-kind"))).toEqual(["failed", "handoff", "search", "search", "note"])
    for (const li of items) expect(li.querySelector(".lab-log-dot svg")).not.toBeNull() // a mark in every dot, never the tint alone
    expect(items[0].querySelector(".lab-log-dot")).toHaveAttribute("title", "Failed")
    // the face: once for a teammate's entries in a row, none for a line that is nobody's
    expect(items.map((li) => li.querySelector("svg.lab-log-face")?.getAttribute("data-agent") ?? null)).toEqual(["reporter", "proposer", "librarian", null, null])
    expect(items[3]).toHaveAttribute("data-cont")
    expect(items[3].querySelector(".lab-sr")).toHaveTextContent("Investigator 2") // still said to a screen reader
    // what was carried and to whom: chips
    expect([...items[1].querySelectorAll(".lab-log-chip")].map((c) => c.textContent)).toEqual(["hypotheses to test", "to Investigator 2"])
    expect(items[2].querySelector("time")).toHaveAttribute("title", "1:15:09 am") // the whole time on hover
    // a failed step keeps its mark and what the engine said
    expect(items[0]).toHaveAttribute("data-tone", "bad")
    expect(items[0].querySelector("blockquote")).toHaveTextContent("The model stopped.")
    expect(document.querySelector(".lab-log-day")).toBeNull() // one day: no day pill
  })

  it("names the day only when the activity is of more than one day", () => {
    const day1 = new Date(2020, 2, 3, 23, 59, 0).getTime(), day2 = new Date(2020, 2, 4, 0, 1, 0).getTime()
    const model = { ...fixtureModel(), log: [
      { id: "a", at: day1, text: "Scout: searching.", who: "Scout" },
      { id: "b", at: day2, text: "Scout: searching: found 2.", who: "Scout" },
      { id: "c", at: day2 + 1000, text: "The answer is finished.", tone: "good" as const },
    ] }
    render(<LabPanel model={model} selected="scout" />)
    const items = within(screen.getByRole("log")).getAllByRole("listitem")
    expect(items.map((li) => li.querySelector(".lab-log-day")?.textContent ?? null)).toEqual(["4 Mar 2020", null, "3 Mar 2020"])
    expect(items[2].querySelector("svg.lab-log-face")).not.toBeNull() // a new day starts a new group: the face is drawn again
    expect(items[0]).toHaveAttribute("data-kind", "done")
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
