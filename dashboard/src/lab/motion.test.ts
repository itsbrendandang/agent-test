// The walking simulation, without a browser: routes, the wait at a pick-up point, the parcel, the queue, and the
// rule that nothing moves unless the model holds a trip.
import { describe, expect, it } from "vitest"
import { emptyLab, type CharacterId, type LabModel, type Trip } from "./model"
import { MAX_WAITING, active, advance, createSim, dropPoint, pickupPoint, settle, stationPoint, syncTrips, type Sim } from "./motion"

const withTrips = (trips: Partial<Record<CharacterId, Trip[]>>, runId = "r1", more: Partial<LabModel> = {}): LabModel => {
  const m = { ...emptyLab(), runId, status: "running" as const, ...more }
  for (const [id, list] of Object.entries(trips)) m.characters[id as CharacterId] = { ...m.characters[id as CharacterId], trips: list! }
  return m
}
const fetch = (id: string, room: Trip["room"], back?: number, outcome: Trip["outcome"] = "carried"): Trip => ({ id, kind: "fetch", room, label: `label ${id}`, short: `s-${id}`, at: 0, ...(back !== undefined && { back, outcome }) })
/** Run the simulation until it is not active, or for `seconds`. Returns the places the teammate passed. */
function run(sim: Sim, who: CharacterId, seconds = 120) {
  const path: { x: number; y: number; carrying: boolean }[] = []
  for (let t = 0; t < seconds * 20; t++) {
    const more = advance(sim, 0.05)
    const w = sim.walkers[who]
    path.push({ x: w.x, y: w.y, carrying: w.carrying })
    if (!more) break
  }
  return path
}
const all = () => true

describe("the lab's walking", () => {
  it("puts the twelve teammates at Anh's desks: two a room", () => {
    const sim = createSim()
    expect(sim.walkers.scout.home).toEqual({ x: 145, y: 165 })
    expect(sim.walkers.librarian.home).toEqual({ x: 335, y: 165 })
    expect(sim.walkers.finisher.home).toEqual({ x: 875, y: 645 })
    expect(new Set(Object.values(sim.walkers).map((w) => `${w.home.x},${w.home.y}`)).size).toBe(12)
    expect(stationPoint({ room: "planning", slot: 0 })).toEqual({ x: 685, y: 165 })
  })

  it("moves nobody when the model holds no trip", () => {
    const sim = createSim()
    syncTrips(sim, withTrips({}), all)
    expect(active(sim)).toBe(false)
    const before = JSON.stringify(sim.walkers)
    for (let i = 0; i < 200; i++) expect(advance(sim, 0.05)).toBe(false)
    expect(JSON.stringify(sim.walkers)).toBe(before)
  })

  it("walks a fetch out through the corridor, picks the parcel up, and carries it home", () => {
    const sim = createSim()
    syncTrips(sim, withTrips({ guardian: [fetch("t1", "review", 0)] }), all)
    expect(active(sim)).toBe(true)
    const path = run(sim, "guardian")
    const spot = pickupPoint("review", sim.walkers.guardian.index)
    expect(path.some((p) => p.x === 500)).toBe(true) // through the corridor
    const at = path.findIndex((p) => p.x === spot.x && p.y === spot.y)
    expect(at).toBeGreaterThan(0)
    expect(path.slice(0, at).every((p) => !p.carrying)).toBe(true) // empty hands on the way out
    expect(path[at + 2].carrying).toBe(true) // the parcel on the way back
    const w = sim.walkers.guardian
    expect({ x: w.x, y: w.y }).toEqual(w.home)
    expect(w.carrying).toBe(false) // delivered
    expect(active(sim)).toBe(false)
  })

  it("stays in its own room for a fetch there", () => {
    const sim = createSim()
    syncTrips(sim, withTrips({ scout: [fetch("t1", "discovery", 0)] }), all)
    const path = run(sim, "scout")
    expect(path.every((p) => p.x < 440)).toBe(true)
    expect(path.some((p) => p.carrying)).toBe(true)
  })

  it("waits at the pick-up point until the model says what came back, and asks for no frames meanwhile", () => {
    const sim = createSim()
    syncTrips(sim, withTrips({ scout: [fetch("t1", "discovery")] }), all)
    run(sim, "scout")
    const spot = pickupPoint("discovery", 0), w = sim.walkers.scout
    expect({ x: w.x, y: w.y }).toEqual(spot)
    expect(w.waiting).toBe(true)
    expect(active(sim)).toBe(false) // nothing to animate while it waits
    // the search came back with nothing: no parcel
    syncTrips(sim, withTrips({ scout: [fetch("t1", "discovery", 5, "empty")] }), all)
    expect(active(sim)).toBe(true)
    const back = run(sim, "scout")
    expect(back.every((p) => !p.carrying)).toBe(true)
    expect({ x: w.x, y: w.y }).toEqual(w.home)
  })

  it("carries a hand-off to the desk of the teammate it is for and comes home with empty hands", () => {
    const sim = createSim()
    const trip: Trip = { id: "h1", kind: "handoff", room: "report", to: "reporter", label: "the draft", short: "draft", at: 0 }
    syncTrips(sim, withTrips({ navigator: [trip] }), all)
    advance(sim, 0.05)
    expect(sim.walkers.navigator.carrying).toBe(true)
    expect(sim.walkers.navigator.tag).toBe("draft")
    const path = run(sim, "navigator")
    const spot = dropPoint("reporter", sim.walkers.navigator.index)
    const at = path.findIndex((p) => p.x === spot.x && p.y === spot.y)
    expect(at).toBeGreaterThan(0)
    expect(path[at].carrying).toBe(false)
    expect(path.at(-1)).toMatchObject({ ...sim.walkers.navigator.home, carrying: false })
  })

  it("walks a trip once, however often the model is given again", () => {
    const sim = createSim()
    const model = withTrips({ guardian: [fetch("t1", "review", 0)] })
    syncTrips(sim, model, all)
    run(sim, "guardian")
    syncTrips(sim, model, all); syncTrips(sim, { ...model }, all)
    expect(active(sim)).toBe(false)
    expect(sim.walkers.guardian.queue).toHaveLength(0)
  })

  it("keeps only the newest waiting trips when many arrive at once", () => {
    const sim = createSim()
    const trips = Array.from({ length: 7 }, (_, i) => fetch(`t${i}`, "review", 0))
    syncTrips(sim, withTrips({ guardian: trips }), all)
    expect(sim.walkers.guardian.queue.map((t) => t.id)).toEqual(trips.slice(-MAX_WAITING).map((t) => t.id))
    run(sim, "guardian", 600)
    expect(active(sim)).toBe(false)
  })

  it("only notes a trip it is told not to walk (history, or reduced motion)", () => {
    const sim = createSim()
    const model = withTrips({ guardian: [fetch("t1", "review", 0)] })
    syncTrips(sim, model, () => false)
    expect(active(sim)).toBe(false)
    syncTrips(sim, model, all) // it was seen: it is not walked later either
    expect(active(sim)).toBe(false)
  })

  it("sends a cancelled teammate home with empty hands", () => {
    const sim = createSim()
    syncTrips(sim, withTrips({ guardian: [fetch("t1", "review", 0), fetch("t2", "review", 0)] }), all)
    for (let i = 0; i < 100; i++) advance(sim, 0.05)
    const cancelled = withTrips({ guardian: [fetch("t1", "review", 0), fetch("t2", "review", 0)] })
    cancelled.characters.guardian.state = "cancelled"
    syncTrips(sim, cancelled, all)
    const w = sim.walkers.guardian
    expect(w.queue).toHaveLength(0); expect(w.carrying).toBe(false); expect(w.job).toBeUndefined()
    run(sim, "guardian")
    expect({ x: w.x, y: w.y }).toEqual(w.home)
  })

  it("starts another run with everyone at their desks", () => {
    const sim = createSim()
    syncTrips(sim, withTrips({ guardian: [fetch("t1", "review", 0)] }, "r1"), all)
    for (let i = 0; i < 40; i++) advance(sim, 0.05)
    expect(sim.walkers.guardian.x).not.toBe(sim.walkers.guardian.home.x)
    syncTrips(sim, withTrips({}, "r2"), all)
    expect(sim.walkers.guardian).toMatchObject({ ...sim.walkers.guardian.home, carrying: false })
    expect(active(sim)).toBe(false)
  })

  it("settle puts everyone home and counts the model's trips as walked", () => {
    const sim = createSim()
    const model = withTrips({ guardian: [fetch("t1", "review", 0)] })
    syncTrips(sim, model, all)
    for (let i = 0; i < 40; i++) advance(sim, 0.05)
    settle(sim, model)
    expect(active(sim)).toBe(false)
    syncTrips(sim, model, all)
    expect(active(sim)).toBe(false)
  })

  it("walks faster at a higher speed", () => {
    const a = createSim(), b = createSim()
    const model = withTrips({ guardian: [fetch("t1", "review", 0)] })
    syncTrips(a, model, all); syncTrips(b, model, all)
    for (let i = 0; i < 5; i++) { advance(a, 0.05, 1); advance(b, 0.05, 4) }
    expect(Math.abs(b.walkers.guardian.x - b.walkers.guardian.home.x)).toBeGreaterThan(Math.abs(a.walkers.guardian.x - a.walkers.guardian.home.x) * 3)
  })
})
