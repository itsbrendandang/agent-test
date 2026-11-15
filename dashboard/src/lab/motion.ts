// Agent Lab design by Anh Lam. How the teammates walk: the same routes as Anh's page (out through the door, along
// the corridor, to a pick-up point between the desks, and back), kept as plain data so it can be tested without a
// browser. A walk starts for one reason only: the activity model has a trip the simulation has not walked yet.
// Nothing in this file makes a teammate move by itself, and there is no ambient wandering.
import { CHARACTERS, MAP, ROOMS, characterOf, roomOf, type Character, type CharacterId, type LabModel, type RoomId, type Trip } from "./model"

export interface Point { x: number; y: number }
type Waypoint = Point & { action?: "pickup" | "drop" }

/** A teammate's desk: Anh's two stations a room. */
export const stationPoint = (c: Pick<Character, "room" | "slot">): Point => { const r = roomOf(c.room); return { x: r.x + (c.slot === 0 ? 125 : 315), y: r.y + 145 } }
/** Where a teammate stands to pick something up, between the desks. A small offset per teammate keeps two pick-ups apart. */
export const pickupPoint = (room: RoomId, index: number): Point => { const r = roomOf(room); return { x: r.x + 220 + ((index % 3) - 1) * 18, y: r.y + 145 + (index % 2 ? 12 : -12) } }
/** Where a teammate puts down what it hands over: beside the desk of the one it is for. */
export const dropPoint = (to: CharacterId, index: number): Point => { const c = characterOf(to), s = stationPoint(c); return { x: s.x + (c.slot === 0 ? 80 : -80), y: s.y + (index % 2 ? 14 : -14) } }
/** Where the n-th visitor of a room stands: the first between the desks, the second by the wall away from the door. Clear of the walking routes. */
export const visitorPoint = (room: RoomId, n: number): Point => {
  const r = roomOf(room), left = r.x < MAP.corridorX
  return n % 2 === 0 ? { x: r.x + 220, y: r.y + 92 } : { x: r.x + (left ? 36 : 384), y: r.y + 122 }
}

const roomAt = (p: Point): RoomId | undefined => ROOMS.find((r) => p.x >= r.x && p.x <= r.x + 420 && p.y >= r.y && p.y <= r.y + 220)?.id

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
}

/** A trip still waits behind the one being walked. More than this and the oldest waiting one is dropped (it stays in the log). */
export const MAX_WAITING = 2
const PICKUP_PAUSE = 1.1, EMPTY_PAUSE = 0.5, DROP_PAUSE = 0.6

export function createSim(): Sim {
  const walkers = Object.fromEntries(CHARACTERS.map((c): [CharacterId, Walker] => {
    const home = stationPoint(c)
    // Anh's teammates walk at 38 to 58 units a second, at random. Here the pace is fixed per teammate and faster,
    // because a walk has to end before the engine's next event for the same teammate, not whenever it likes.
    return [c.id, { id: c.id, index: c.index, home, x: home.x, y: home.y, route: [], queue: [], carrying: false, tag: "", waiting: false, pauseUntil: 0, speed: 84 + (c.index * 7) % 5 * 6 }]
  })) as Record<CharacterId, Walker>
  return { clock: 0, walkers, seen: new Set() }
}

/** Everyone at their desks with empty hands, and nothing counted as walked: the start of another run. */
function reset(sim: Sim, run: string | undefined) {
  sim.run = run
  sim.seen = new Set()
  for (const w of Object.values(sim.walkers)) Object.assign(w, { x: w.home.x, y: w.home.y, route: [], queue: [], job: undefined, carrying: false, tag: "", waiting: false, pauseUntil: 0 })
}
/** Everyone at their desks with empty hands, and every trip the model has now counted as walked. */
export function settle(sim: Sim, model: LabModel) {
  reset(sim, model.runId)
  for (const w of Object.values(sim.walkers)) for (const t of model.characters[w.id].trips) sim.seen.add(t.id)
}

const viaCorridor = (from: Point, to: Point): Waypoint[] =>
  roomAt(from) !== undefined && roomAt(from) === roomAt(to) ? [] : [{ x: MAP.corridorX, y: from.y }, { x: MAP.corridorX, y: to.y }]

function start(w: Walker, trip: Trip) {
  const here = { x: w.x, y: w.y }
  w.job = trip; w.waiting = false; w.pauseUntil = 0
  if (trip.kind === "fetch") {
    const spot = pickupPoint(trip.room, w.index)
    w.carrying = false; w.tag = ""
    w.route = [...viaCorridor(here, spot), { ...spot, action: "pickup" }, ...viaCorridor(spot, w.home), w.home]
  } else {
    const spot = trip.to ? dropPoint(trip.to, w.index) : pickupPoint(trip.room, w.index)
    w.carrying = true; w.tag = trip.short
    w.route = [...viaCorridor(here, spot), { ...spot, action: "drop" }, ...viaCorridor(spot, w.home), w.home]
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
      w.queue.push(t)
      if (w.queue.length > MAX_WAITING) w.queue.shift()
    }
    if (a.state === "cancelled" && (w.job || w.queue.length || w.route.length)) recall(w)
  }
}

/** Drop everything and walk home (a cancelled run). */
export function recall(w: Walker) {
  const here = { x: w.x, y: w.y }
  w.queue = []; w.job = undefined; w.carrying = false; w.tag = ""; w.waiting = false; w.pauseUntil = 0
  w.route = here.x === w.home.x && here.y === w.home.y ? [] : [...viaCorridor(here, w.home), w.home]
}

const busy = (w: Walker) => w.route.length > 0 || w.queue.length > 0
/** True while a frame would change something: someone is walking, pausing, or has a trip to start. A teammate that only waits at a pick-up point needs no frames. */
export const active = (sim: Sim): boolean => Object.values(sim.walkers).some((w) => busy(w) && !(w.waiting && w.job?.back === undefined))
/** True when this teammate is walking right now (for the stride). */
export const moving = (sim: Sim, w: Walker): boolean => w.route.length > 0 && !w.waiting && sim.clock >= w.pauseUntil

/** Move everyone on by `dt` seconds. `speed` multiplies the walking pace (a replay at 4x). Returns `active`. */
export function advance(sim: Sim, dt: number, speed = 1): boolean {
  sim.clock += dt
  for (const w of Object.values(sim.walkers)) {
    if (!w.route.length) { const next = w.queue.shift(); if (next) start(w, next); else continue }
    if (w.waiting) {
      // at the pick-up point: go on once the model says what came back
      if (w.job?.back === undefined) continue
      w.waiting = false
      w.carrying = w.job.outcome === "carried"; w.tag = w.carrying ? w.job.short : ""
      w.pauseUntil = sim.clock + (w.carrying ? PICKUP_PAUSE : EMPTY_PAUSE)
    }
    if (sim.clock < w.pauseUntil) continue
    const next = w.route[0]
    const dx = next.x - w.x, dy = next.y - w.y, distance = Math.hypot(dx, dy), step = w.speed * speed * dt
    if (distance > step) { w.x += (dx / distance) * step; w.y += (dy / distance) * step; continue }
    w.x = next.x; w.y = next.y
    w.route.shift()
    if (next.action === "pickup") {
      if (w.job?.back === undefined) w.waiting = true
      else { w.carrying = w.job.outcome === "carried"; w.tag = w.carrying ? w.job.short : ""; w.pauseUntil = sim.clock + (w.carrying ? PICKUP_PAUSE : EMPTY_PAUSE) }
    } else if (next.action === "drop") { w.carrying = false; w.tag = ""; w.pauseUntil = sim.clock + DROP_PAUSE }
    if (!w.route.length) { w.job = undefined; w.carrying = false; w.tag = "" } // home: delivered
  }
  return active(sim)
}
