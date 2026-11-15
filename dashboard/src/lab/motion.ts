// Agent Lab design by Anh Lam. How the teammates walk, on the map of Agent Lab 2.0: along the front lane of a room
// to its doorway, down the corridor, in through the other room's doorway and around its furniture, as 2.0's agents
// do. Kept as plain data so it can be tested without a browser. What 2.0's own clock did is NOT here: a walk starts
// for one reason only, the activity model has a trip the simulation has not walked yet. Nothing in this file makes
// a teammate move by itself; there is no wandering, no search phase and no demo run.
import { CHARACTERS, FURNITURE, PICK, ROOM, ROOMS, SEARCH_SPOTS, WIDE, characterOf, doorOf, searchSpot, type Character, type CharacterId, type LabLayout, type LabModel, type RoomId, type Trip } from "./model"

export interface Point { x: number; y: number }
type Waypoint = Point & { action?: "pickup" | "drop" }

const inRoom = (layout: LabLayout, room: RoomId, dx: number, dy: number): Point => ({ x: layout.at[room].x + dx, y: layout.at[room].y + dy })
/** Where a teammate stands when it is at home: beside the equipment it works at. */
export const stationPoint = (c: Pick<Character, "room" | "home">, layout: LabLayout = WIDE): Point => inRoom(layout, c.room, c.home[0], c.home[1])
/** Where a teammate stands to pick something up in a room: in front of its main table. A small offset per teammate keeps two pick-ups apart. */
export const pickupPoint = (room: RoomId, index: number, layout: LabLayout = WIDE): Point => inRoom(layout, room, PICK[room][0] + ((index % 3) - 1) * 16, PICK[room][1] + (index % 2 ? 6 : -4))
/** Where a teammate puts down what it hands over: beside the one it is for, on the side of that room's door (2.0's hand-off spot). */
export const dropPoint = (to: CharacterId, index: number, layout: LabLayout = WIDE): Point => {
  const c = characterOf(to), r = layout.at[c.room]
  const dx = Math.max(40, Math.min(ROOM.width - 40, c.home[0] + (r.door === "right" ? 44 : -44)))
  return inRoom(layout, c.room, dx, Math.min(ROOM.height - 22, c.home[1] + (index % 2 ? 8 : 2)))
}
/** Visitors stand on the front lane: the middle first, then either side of the room's table. */
export const visitorPoint = (room: RoomId, n: number, layout: LabLayout = WIDE): Point => inRoom(layout, room, PICK[room][0] + (n % 3 === 0 ? 0 : n % 3 === 1 ? 62 : -62), ROOM.height - 24)
/** Where the Engine stands to pick a claim up in a room, or to put it down there. */
export const trayPoint = (room: RoomId, index: number, layout: LabLayout = WIDE): Point => pickupPoint(room, index, layout)
/** Searches use Discovery's computer or the library's bookshelf. */
export const searchPoint = (spot: keyof typeof SEARCH_SPOTS, index: number, layout: LabLayout = WIDE): Point => inRoom(layout, SEARCH_SPOTS[spot].room, SEARCH_SPOTS[spot].dx, SEARCH_SPOTS[spot].dy + (index % 2 ? 4 : 0))

const roomAt = (p: Point, layout: LabLayout): RoomId | undefined => ROOMS.find((room) => { const r = layout.at[room.id]; return p.x >= r.x && p.x <= r.x + ROOM.width && p.y >= r.y && p.y <= r.y + ROOM.height })?.id
/** The floor a piece of furniture takes up, with room to walk past (2.0's rule: only furniture that stands out on the floor). */
const OBSTACLES = FURNITURE.filter(([, , , dy]) => dy >= 110).map(([room, , dx, dy, w]) => ({ room, x0: dx - w / 2 - 12, x1: dx + w / 2 + 12, y0: dy - 30, y1: dy + 12 }))
function blocked(layout: LabLayout, room: RoomId, a: Point, b: Point): boolean {
  const r = layout.at[room], mine = OBSTACLES.filter((o) => o.room === room)
  for (let i = 1; i < 14; i++) {
    const px = a.x + ((b.x - a.x) * i) / 14 - r.x, py = a.y + ((b.y - a.y) * i) / 14 - r.y
    if (mine.some((o) => px > o.x0 && px < o.x1 && py > o.y0 && py < o.y1)) return true
  }
  return false
}
/** The points to walk through inside one room: straight when nothing is in the way, else along the front lane (2.0's routeIn). */
function routeIn(layout: LabLayout, room: RoomId, from: Point, to: Point): Point[] {
  if (!blocked(layout, room, from, to)) return [to]
  const lane = doorOf(layout, room).y
  return [{ x: from.x, y: lane }, { x: to.x, y: lane }, to]
}
/** The way from one point of the map to another: out through the room's doorway, along the corridor, in through the other doorway. */
export function pathBetween(layout: LabLayout, from: Point, to: Point, lane = layout.corridorX): Point[] {
  const a = roomAt(from, layout), b = roomAt(to, layout)
  if (a && a === b) return routeIn(layout, a, from, to)
  const offset = lane - layout.corridorX
  const aisle = (room: RoomId | undefined, p: Point) => {
    const door = room ? doorOf(layout, room) : p
    return layout.corridors.reduce((best, x) => Math.abs(x - door.x) < Math.abs(best - door.x) ? x : best) + offset
  }
  const ax = aisle(a, from), bx = aisle(b, to)
  const out = a ? [...routeIn(layout, a, from, doorOf(layout, a)), { x: ax, y: doorOf(layout, a).y }] : [{ x: ax, y: from.y }]
  const across = ax === bx ? [] : [{ x: ax, y: layout.crossY }, { x: bx, y: layout.crossY }]
  const into = b ? [{ x: bx, y: doorOf(layout, b).y }, doorOf(layout, b), ...routeIn(layout, b, doorOf(layout, b), to)] : [{ x: bx, y: to.y }, to]
  return [...out, ...across, ...into]
}

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
  /** 1 facing right, -1 facing left: the way it last walked. */
  facing: 1 | -1
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
    // 2.0's agents walk at 44 to 58 units a second, at random. Here the pace is fixed per teammate and faster,
    // because a walk has to end before the engine's next event for the same teammate, not whenever it likes.
    return [c.id, { id: c.id, index: c.index, home, x: home.x, y: home.y, route: [], queue: [], carrying: false, tag: "", along: 0, waiting: false, pauseUntil: 0, speed: 84 + (c.index * 7) % 5 * 6, facing: c.home[0] > ROOM.width / 2 ? -1 : 1 }]
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

function start(w: Walker, trip: Trip, layout: LabLayout) {
  const here = { x: w.x, y: w.y }
  const lane = layout.corridorX + ((w.index % 5) - 2) * 4 // a lane of its own in the corridor, as 2.0's agents have
  const via = (from: Point, to: Point) => pathBetween(layout, from, to, lane)
  const then = (points: Point[], action: Waypoint["action"]): Waypoint[] => points.map((p, i) => (i === points.length - 1 ? { ...p, action } : p))
  w.job = trip; w.waiting = false; w.pauseUntil = 0; w.along = 0
  if (trip.kind === "carry") {
    // a claim: picked up in the room of its old state, put down in the room of its new one
    const from = trayPoint(trip.from ?? trip.room, w.index, layout), to = trayPoint(trip.room, w.index, layout)
    w.carrying = false; w.tag = ""
    w.route = [...then(via(here, from), "pickup"), ...then(via(from, to), "drop"), ...via(to, w.home)]
  } else if (trip.kind === "fetch") {
    // Searches have their own furniture; everything else uses the room's table.
    const search = trip.room === "discovery" || trip.room === "library" ? searchSpot(trip.provider) : undefined
    const spot = search ? searchPoint(search, w.index, layout) : pickupPoint(trip.room, w.index, layout)
    w.carrying = false; w.tag = ""
    w.route = [...then(via(here, spot), "pickup"), ...via(spot, w.home)]
  } else {
    const spot = trip.to ? dropPoint(trip.to, w.index, layout) : pickupPoint(trip.room, w.index, layout)
    w.carrying = true; w.tag = trip.short
    w.route = [...then(via(here, spot), "drop"), ...via(spot, w.home)]
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
  w.route = here.x === w.home.x && here.y === w.home.y ? [] : pathBetween(layout, here, w.home)
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
    if (Math.abs(dx) > 1.5) w.facing = dx > 0 ? 1 : -1
    if (distance > step) { w.x += (dx / distance) * step; w.y += (dy / distance) * step; continue }
    w.x = next.x; w.y = next.y
    w.route.shift()
    if (next.action === "pickup") { if (w.job?.back === undefined) w.waiting = true; else pickUp(w) }
    else if (next.action === "drop") { w.carrying = false; w.tag = ""; w.pauseUntil = sim.clock + DROP_PAUSE / speed }
    if (!w.route.length) { w.job = undefined; w.carrying = false; w.tag = ""; w.along = 0 } // home: delivered
  }
  return active(sim)
}
