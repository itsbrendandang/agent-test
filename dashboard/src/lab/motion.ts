// Agent Lab design by Anh Lam. How the teammates walk: the same routes as Anh's page (out through the door, along
// the corridor, to a pick-up point between the desks, and back), kept as plain data so it can be tested without a
// browser. A walk starts for one reason only: the activity model has a trip the simulation has not walked yet.
// Nothing in this file makes a teammate move by itself, and there is no ambient wandering.
import { CHARACTERS, ROOM, ROOMS, SEARCH_SPOTS, SPOT, WIDE, characterOf, searchSpot, type Character, type CharacterId, type LabLayout, type LabModel, type RoomId, type Trip } from "./model"

export interface Point { x: number; y: number }
type Waypoint = Point & { action?: "pickup" | "drop" }

/** A teammate's desk: Anh's two stations a room. */
export const stationPoint = (c: Pick<Character, "room" | "slot">, layout: LabLayout = WIDE): Point => { const r = layout.at[c.room]; return { x: r.x + SPOT.desk[c.slot], y: r.y + SPOT.stand } }
/** Where a teammate stands to pick something up, between the desks. A small offset per teammate keeps two pick-ups apart. */
export const pickupPoint = (room: RoomId, index: number, layout: LabLayout = WIDE): Point => { const r = layout.at[room]; return { x: r.x + 220 + ((index % 3) - 1) * 18, y: r.y + SPOT.stand + (index % 2 ? 12 : -12) } }
/** Where a teammate puts down what it hands over: beside the desk of the one it is for, on the wall side, clear of the pick-up points. */
export const dropPoint = (to: CharacterId, index: number, layout: LabLayout = WIDE): Point => { const c = characterOf(to), s = stationPoint(c, layout); return { x: s.x + (c.slot === 0 ? -76 : 72), y: s.y + (index % 2 ? 12 : -12) } }
/** Where the n-th visitor of a room stands: the first between the desks, the second by the wall away from the door. */
export const visitorPoint = (room: RoomId, n: number, layout: LabLayout = WIDE): Point => {
  const r = layout.at[room]
  return n % 2 === 0 ? { x: r.x + 220, y: r.y + 122 } : { x: r.x + (r.door === "right" ? 36 : 384), y: r.y + 128 }
}
/** Where the Engine stands to pick a claim up from a room's tray, or to put it down there. */
export const trayPoint = (room: RoomId, index: number, layout: LabLayout = WIDE): Point => { const r = layout.at[room]; return { x: r.x + 232 + (index % 2 ? 10 : -10), y: r.y + 128 } }
/** Where a real search is picked up in Discovery: the screen by the door for the web, the shelf by the wall for papers and databases. */
export const searchPoint = (spot: keyof typeof SEARCH_SPOTS, index: number, layout: LabLayout = WIDE): Point => {
  const r = layout.at.discovery, s = SEARCH_SPOTS[spot]
  return { x: r.x + (r.door === "right" ? s.dx : ROOM.width - s.dx), y: r.y + s.dy + (index % 2 ? 6 : -6) }
}

const roomAt = (p: Point, layout: LabLayout): RoomId | undefined => ROOMS.find((room) => { const r = layout.at[room.id]; return p.x >= r.x && p.x <= r.x + ROOM.width && p.y >= r.y && p.y <= r.y + ROOM.height })?.id

export interface Walker {
  id: CharacterId; index: number; home: Point
  x: number; y: number
  route: Waypoint[]
  /** Trips waiting for this teammate, oldest first. */
  queue: Trip[]
  /** The trip it is on. */
  job?: Trip
  carrying: boolean
  /** The few characters shown over the parcel. */
  tag: string
  /** Trips that arrived while this one was on its way to the same room and were taken along with it. */
  along: number
  /** At the pick-up point, and what it fetches is not known yet. */
  waiting: boolean
  pauseUntil: number
  /** Map units a second. */
  speed: number
}
export interface Sim {
  clock: number
  walkers: Record<CharacterId, Walker>
  /** Trips already taken in. A trip is walked once. */
  seen: Set<string>
  /** The run the trips belong to. Another run starts from everyone at home. */
  run?: string
  /** The map the walkers are on. */
  layout: LabLayout
}

/** A trip still waits behind the one being walked. More than this and the oldest waiting one is dropped (it stays in the log). */
export const MAX_WAITING = 2
const PICKUP_PAUSE = 1.1, EMPTY_PAUSE = 0.5, DROP_PAUSE = 0.6

export function createSim(layout: LabLayout = WIDE): Sim {
  const walkers = Object.fromEntries(CHARACTERS.map((c): [CharacterId, Walker] => {
    const home = stationPoint(c, layout)
    // Anh's teammates walk at 38 to 58 units a second, at random. Here the pace is fixed per teammate and faster,
    // because a walk has to end before the engine's next event for the same teammate, not whenever it likes.
    return [c.id, { id: c.id, index: c.index, home, x: home.x, y: home.y, route: [], queue: [], carrying: false, tag: "", along: 0, waiting: false, pauseUntil: 0, speed: 84 + (c.index * 7) % 5 * 6 }]
  })) as Record<CharacterId, Walker>
  return { clock: 0, walkers, seen: new Set(), layout }
}

/** Everyone at their desks with empty hands, and nothing counted as walked: the start of another run. */
function reset(sim: Sim, run: string | undefined) {
  sim.run = run
  sim.seen = new Set()
  for (const w of Object.values(sim.walkers)) Object.assign(w, { x: w.home.x, y: w.home.y, route: [], queue: [], job: undefined, carrying: false, tag: "", along: 0, waiting: false, pauseUntil: 0 })
}
/** Everyone at their desks with empty hands, and every trip the model has now counted as walked. */
export function settle(sim: Sim, model: LabModel) {
  reset(sim, model.runId)
  for (const w of Object.values(sim.walkers)) for (const t of model.characters[w.id].trips) sim.seen.add(t.id)
}

const viaCorridor = (from: Point, to: Point, layout: LabLayout): Waypoint[] =>
  roomAt(from, layout) !== undefined && roomAt(from, layout) === roomAt(to, layout) ? [] : [{ x: layout.corridorX, y: from.y }, { x: layout.corridorX, y: to.y }]

function start(w: Walker, trip: Trip, layout: LabLayout) {
  const here = { x: w.x, y: w.y }
  const via = (from: Point, to: Point) => viaCorridor(from, to, layout)
  w.job = trip; w.waiting = false; w.pauseUntil = 0; w.along = 0
  if (trip.kind === "carry") {
    // a claim: picked up in the room of its old state, put down in the room of its new one
    const from = trayPoint(trip.from ?? trip.room, w.index, layout), to = trayPoint(trip.room, w.index, layout)
    w.carrying = false; w.tag = ""
    w.route = [...via(here, from), { ...from, action: "pickup" }, ...via(from, to), { ...to, action: "drop" }, ...via(to, w.home), w.home]
  } else if (trip.kind === "fetch") {
    // a real search is picked up at its own point in Discovery; everything else between the desks
    const search = trip.room === "discovery" ? searchSpot(trip.provider) : undefined
    const spot = search ? searchPoint(search, w.index, layout) : pickupPoint(trip.room, w.index, layout)
    w.carrying = false; w.tag = ""
    w.route = [...via(here, spot), { ...spot, action: "pickup" }, ...via(spot, w.home), w.home]
  } else {
    const spot = trip.to ? dropPoint(trip.to, w.index, layout) : pickupPoint(trip.room, w.index, layout)
    w.carrying = true; w.tag = trip.short
    w.route = [...via(here, spot), { ...spot, action: "drop" }, ...via(spot, w.home), w.home]
  }
}

/**
 * Take the model's trips in. A trip not seen before is queued when `walk` says so (it is fresh, and motion is on);
 * otherwise it is only marked as seen. A trip already under way is updated: that is how a fetch learns that what it
 * waits for has come back. A cancelled teammate drops what it does and walks home.
 */
export function syncTrips(sim: Sim, model: LabModel, walk: (trip: Trip) => boolean) {
  if (sim.run !== model.runId) reset(sim, model.runId)
  for (const w of Object.values(sim.walkers)) {
    const a = model.characters[w.id]
    for (const t of a.trips) {
      if (w.job?.id === t.id) w.job = t
      const queued = w.queue.findIndex((q) => q.id === t.id)
      if (queued >= 0) w.queue[queued] = t
      if (sim.seen.has(t.id)) continue
      sim.seen.add(t.id)
      if (!walk(t)) continue
      // A finished fetch for the room this teammate is already walking to is picked up on the same walk.
      if (t.kind === "fetch" && t.back !== undefined && t.outcome === "carried" && w.job?.kind === "fetch" && w.job.room === t.room && searchSpot(w.job.provider) === searchSpot(t.provider) && !w.carrying && !w.queue.length && w.route.some((p) => p.action === "pickup")) { w.along++; continue }
      w.queue.push(t)
      if (w.queue.length > MAX_WAITING) w.queue.shift()
    }
    if (a.state === "cancelled" && (w.job || w.queue.length || w.route.length)) recall(w, sim.layout)
  }
}

/** Drop everything and walk home (a cancelled run). */
export function recall(w: Walker, layout: LabLayout = WIDE) {
  const here = { x: w.x, y: w.y }
  w.queue = []; w.job = undefined; w.carrying = false; w.tag = ""; w.along = 0; w.waiting = false; w.pauseUntil = 0
  w.route = here.x === w.home.x && here.y === w.home.y ? [] : [...viaCorridor(here, w.home, layout), w.home]
}

/**
 * Where a claim is while it is being moved: still in the room it is fetched from, in the Engine's hands ("carried"),
 * or undefined when no walk concerns it (it is then in the room the model says).
 */
export function claimPlace(sim: Sim, claim: string): RoomId | "carried" | undefined {
  for (const w of Object.values(sim.walkers)) {
    const job = w.job?.kind === "carry" && w.job.claim === claim ? w.job : undefined
    if (job && w.carrying) return "carried"
    if (job && w.route.some((p) => p.action === "pickup")) return job.from ?? job.room
    const next = w.queue.find((t) => t.kind === "carry" && t.claim === claim)
    if (next) return next.from ?? next.room
    if (job && w.route.some((p) => p.action === "drop")) return "carried"
  }
  return undefined
}

const busy = (w: Walker) => w.route.length > 0 || w.queue.length > 0
/** True while a frame would change something: someone is walking, pausing, or has a trip to start. A teammate that only waits at a pick-up point needs no frames. */
export const active = (sim: Sim): boolean => Object.values(sim.walkers).some((w) => busy(w) && !(w.waiting && w.job?.back === undefined))
/** True when this teammate is walking right now (for the stride). */
export const moving = (sim: Sim, w: Walker): boolean => w.route.length > 0 && !w.waiting && sim.clock >= w.pauseUntil

/** Move everyone on by `dt` seconds. `speed` multiplies the walking pace (a replay at 4x). Returns `active`. */
export function advance(sim: Sim, dt: number, speed = 1): boolean {
  sim.clock += dt
  /** What came back is in hand (or nothing was there): a short stop, shorter in a faster replay. */
  const pickUp = (w: Walker) => {
    w.carrying = w.job?.outcome === "carried"
    w.tag = w.carrying ? `${w.job!.short}${w.along ? ` +${w.along} more` : ""}` : ""
    w.pauseUntil = sim.clock + (w.carrying ? PICKUP_PAUSE : EMPTY_PAUSE) / speed
  }
  for (const w of Object.values(sim.walkers)) {
    if (!w.route.length) { const next = w.queue.shift(); if (next) start(w, next, sim.layout); else continue }
    if (w.waiting) {
      // at the pick-up point: go on once the model says what came back
      if (w.job?.back === undefined) continue
      w.waiting = false
      pickUp(w)
    }
    if (sim.clock < w.pauseUntil) continue
    const next = w.route[0]
    const dx = next.x - w.x, dy = next.y - w.y, distance = Math.hypot(dx, dy), step = w.speed * speed * dt
    if (distance > step) { w.x += (dx / distance) * step; w.y += (dy / distance) * step; continue }
    w.x = next.x; w.y = next.y
    w.route.shift()
    if (next.action === "pickup") { if (w.job?.back === undefined) w.waiting = true; else pickUp(w) }
    else if (next.action === "drop") { w.carrying = false; w.tag = ""; w.pauseUntil = sim.clock + DROP_PAUSE / speed }
    if (!w.route.length) { w.job = undefined; w.carrying = false; w.tag = ""; w.along = 0 } // home: delivered
  }
  return active(sim)
}
