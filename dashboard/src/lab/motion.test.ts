// The walking simulation, without a browser: routes, the wait at a pick-up point, the parcel, the queue, and the
// rule that nothing moves unless the model holds a trip.
import { describe, expect, it } from "vitest"
import { ROOM, ROOMS, WIDE, doorOf, TALL, emptyLab, type CharacterId, type LabModel, type Trip } from "./model"
import { MAX_WAITING, pathBetween, active, advance, claimPlace, createSim, dropPoint, pickupPoint, searchPoint, settle, stationPoint, syncTrips, visitorPoint, type Sim } from "./motion"

const withTrips = (trips: Partial<Record<CharacterId, Trip[]>>, runId = "r1", more: Partial<LabModel> = {}): LabModel => {
  const m = { ...emptyLab(), runId, status: "running" as const, ...more }
  for (const [id, list] of Object.entries(trips)) m.characters[id as CharacterId] = { ...m.characters[id as CharacterId], trips: list! }
  return m
}
const fetch = (id: string, room: Trip["room"], back?: number, outcome: Trip["outcome"] = "carried"): Trip => ({ id, kind: "fetch", room, label: `label ${id}`, short: `s-${id}`, at: 0, ...(back !== undefined && { back, outcome }) })

describe("nine-room floor plan", () => {
  it("keeps every ordered room pair on doorways and connected corridor space, including offset lanes", () => {
    for (const layout of [WIDE, TALL]) for (const a of ROOMS) for (const b of ROOMS) for (const offset of [-8, 0, 8]) {
      const start = pickupPoint(a.id, 0, layout), end = pickupPoint(b.id, 1, layout)
      const route = [start, ...pathBetween(layout, start, end, layout.corridorX + offset)]
      expect(route.at(-1)).toEqual(end)
      for (let i = 1; i < route.length; i++) {
        const from = route[i - 1], to = route[i]
        for (let n = 0; n <= 100; n++) {
          const p = { x: from.x + (to.x - from.x) * n / 100, y: from.y + (to.y - from.y) * n / 100 }
          const inside = ROOMS.find((r) => { const at = layout.at[r.id]; return p.x > at.x && p.x < at.x + ROOM.width && p.y > at.y && p.y < at.y + ROOM.height })
          if (inside) expect([a.id, b.id]).toContain(inside.id)
          else {
            const inAisle = layout.corridors.some((x) => Math.abs(p.x - x) <= 30)
            const inCross = Math.abs(p.y - layout.crossY) <= 26 && p.x >= layout.corridors[0] - 26 && p.x <= layout.corridors.at(-1)! + 26
            const onDoor = [a.id, b.id].some((id) => {
              const door = doorOf(layout, id)
              return Math.abs(p.y - door.y) < 0.001 && Math.abs(p.x - door.x) <= 65
            })
            expect(inAisle || inCross || onDoor, JSON.stringify({ a, b, p })).toBe(true)
          }
        }
        for (const room of ROOMS) {
          const at = layout.at[room.id]
          for (const x of [at.x, at.x + ROOM.width]) {
            if ((from.x < x && to.x > x) || (from.x > x && to.x < x)) {
              const y = from.y + (to.y - from.y) * (x - from.x) / (to.x - from.x)
              if (y > at.y && y < at.y + ROOM.height) expect(y).toBe(doorOf(layout, room.id).y)
            }
          }
        }
      }
    }
  })
  it("fits all nine rooms in one narrow column", () => {
    expect(ROOMS).toHaveLength(9)
    expect(new Set(ROOMS.map((r) => TALL.at[r.id].x)).size).toBe(1)
    for (const r of ROOMS) {
      expect(TALL.at[r.id].x + ROOM.width).toBeLessThan(TALL.width)
      expect(TALL.at[r.id].y + ROOM.height).toBeLessThan(TALL.height)
    }
  })
  it("leaves space between the first safety visitor and the two resident name plates", () => {
    const sim = createSim(), visitor = visitorPoint("quality", 0)
    for (const id of ["guardian", "reviser"] as const) expect(Math.abs(visitor.x - sim.walkers[id].home.x)).toBeGreaterThan(140)
  })
})
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
  it("puts the twelve teammates at their places: two a room, beside the equipment they work at", () => {
    const sim = createSim()
    expect(sim.walkers.scout.home).toEqual({ x: 392, y: 178 })
    expect(sim.walkers.librarian.home).toEqual({ x: 680, y: 188 })
    expect(sim.walkers.finisher.home).toEqual({ x: 1400, y: 654 })
    expect(new Set(Object.values(sim.walkers).map((w) => `${w.home.x},${w.home.y}`)).size).toBe(12)
    expect(stationPoint({ room: "planning", home: [120, 150] })).toEqual({ x: WIDE.at.planning.x + 120, y: 166 })
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
    expect(path.some((p) => Math.abs(p.x - 500) <= 8 && p.y > 480 && p.y < 660)).toBe(true) // down the corridor, in a lane of its own
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
    expect(path.every((p) => p.x < 470)).toBe(true)
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

  it("takes along a finished fetch for the room it is already walking to", () => {
    const sim = createSim()
    syncTrips(sim, withTrips({ guardian: [fetch("t0", "review", 0)] }), all)
    for (let i = 0; i < 20; i++) advance(sim, 0.05)
    syncTrips(sim, withTrips({ guardian: [fetch("t0", "review", 0), fetch("t1", "review", 0), fetch("t2", "review", 0)] }), all)
    expect(sim.walkers.guardian.queue).toHaveLength(0) // one walk for the three
    const tags = new Set<string>()
    for (let t = 0; t < 3000 && advance(sim, 0.05); t++) tags.add(sim.walkers.guardian.tag)
    expect([...tags]).toContain("s-t0 +2 more")
    // once the parcel is in hand a new one waits for the next walk
    const again = createSim()
    syncTrips(again, withTrips({ guardian: [fetch("t0", "review", 0)] }), all)
    while (!again.walkers.guardian.carrying) advance(again, 0.05)
    syncTrips(again, withTrips({ guardian: [fetch("t0", "review", 0), fetch("t1", "review", 0)] }), all)
    expect(again.walkers.guardian.queue.map((t) => t.id)).toEqual(["t1"])
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

  it("walks the same routes on the narrow map: one column of rooms beside the corridor", () => {
    const sim = createSim(TALL)
    expect(Object.values(sim.walkers).every((w) => w.home.x < 470 && w.home.y < TALL.height)).toBe(true)
    syncTrips(sim, withTrips({ guardian: [fetch("t1", "review", 0)] }), all)
    const path = run(sim, "guardian")
    const spot = pickupPoint("review", sim.walkers.guardian.index, TALL)
    expect(path.some((p) => Math.abs(p.x - TALL.corridorX) <= 8)).toBe(true)
    expect(path.some((p) => p.x === spot.x && p.y === spot.y)).toBe(true)
    expect(path.every((p) => p.x >= 0 && p.x <= TALL.width && p.y >= 0 && p.y <= TALL.height)).toBe(true)
    expect(path.at(-1)).toMatchObject(sim.walkers.guardian.home)
  })

  it("goes through the doorways and around the furniture, as 2.0's agents do, and never through a wall", () => {
    const sim = createSim()
    syncTrips(sim, withTrips({ guardian: [fetch("t1", "review", 0)] }), all)
    const path = run(sim, "guardian")
    // it leaves Quality control and enters Evidence review at their doorways (34 above each room's bottom edge)
    const crossings = path.filter((p, i) => i > 0 && (p.x > 470) !== (path[i - 1].x > 470)).map((p) => Math.round(p.y))
    expect(new Set(crossings)).toEqual(new Set([doorOf(WIDE, "quality").y])) // out of and back into its own room at its door
    const entering = path.filter((p, i) => i > 0 && (p.x >= WIDE.at.review.x) !== (path[i - 1].x >= WIDE.at.review.x)).map((p) => Math.round(p.y))
    expect(new Set(entering)).toEqual(new Set([doorOf(WIDE, "review").y])) // Evidence review's door
    // inside a room it walks around the table: the Librarian's way to the bookshelf goes along the front lane
    const lib = createSim()
    syncTrips(lib, withTrips({ librarian: [{ ...fetch("p", "library", 0), provider: "europepmc" }] }), all)
    const way = run(lib, "librarian")
    expect(way.some((p) => Math.round(p.y) === doorOf(WIDE, "library").y && p.x > WIDE.at.library.x)).toBe(true) // the lane at the door's height, past the lab table
    expect(way.some((p) => p.x > WIDE.at.library.x + 143 && p.x < WIDE.at.library.x + 277 && p.y > 136 && p.y < 160)).toBe(false) // never across the lab table
  })

  it("picks a real search up at 2.0's own furniture in Discovery: the computer for the web, the bookshelf for papers", () => {
    const sim = createSim()
    const web: Trip = { ...fetch("w", "discovery", 0), provider: "exa" }, papers: Trip = { ...fetch("p", "discovery", 0), provider: "europepmc" }
    syncTrips(sim, withTrips({ scout: [web] }), all)
    const toWeb = run(sim, "scout")
    expect(Math.min(...toWeb.map((p) => p.x))).toBe(searchPoint("web", 0).x) // across the room to the computer
    expect(sim.walkers.scout.home.x - searchPoint("web", 0).x).toBeGreaterThan(250)
    syncTrips(sim, withTrips({ scout: [web, papers] }), all)
    const toPapers = run(sim, "scout")
    expect(toPapers.some((p) => p.x === searchPoint("papers", 0).x && p.y === searchPoint("papers", 0).y)).toBe(true)
  })

  it("carries a claim from the room of its old state to the room of its new one", () => {
    const sim = createSim()
    const move: Trip = { id: "m1", kind: "carry", from: "bench", room: "review", claim: "C1", label: "claim C1", short: "C1", at: 0, back: 0, outcome: "carried" }
    syncTrips(sim, withTrips({ navigator: [move] }), all)
    expect(claimPlace(sim, "C1")).toBe("bench") // still where it was while the Engine walks to it
    const places = new Set<string | undefined>()
    for (let t = 0; t < 4000 && advance(sim, 0.05); t++) places.add(claimPlace(sim, "C1"))
    expect([...places]).toEqual(["bench", "carried", undefined]) // picked up, carried, put down where the model says
    expect(claimPlace(sim, "C2")).toBeUndefined()
    expect(sim.walkers.navigator).toMatchObject({ ...sim.walkers.navigator.home, carrying: false })
  })

  it("walks faster at a higher speed", () => {
    const a = createSim(), b = createSim()
    const model = withTrips({ guardian: [fetch("t1", "review", 0)] })
    syncTrips(a, model, all); syncTrips(b, model, all)
    for (let i = 0; i < 5; i++) { advance(a, 0.05, 1); advance(b, 0.05, 4) }
    expect(Math.abs(b.walkers.guardian.x - b.walkers.guardian.home.x)).toBeGreaterThan(Math.abs(a.walkers.guardian.x - a.walkers.guardian.home.x) * 3)
  })
})
