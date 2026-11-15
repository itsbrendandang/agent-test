// Agent Lab design by Anh Lam (https://github.com/Anhlam09/agent-lab-report; the look is Agent Lab 2.0,
// https://github.com/Anhlam09/agent-lab-2.0). The dashboard's lab scene: 2.0's map of six rooms with their equipment,
// the Buddy characters, the walk to a room and back with something in hand, the "Pause motion" control and
// reduced-motion support.
//
// What differs from Anh's pages: the scene has no clock of its own for work. 2.0 plays a demo in which everyone
// wanders during "the search" and the active room's agents use equipment at random; none of that is here. The scene
// draws an activity model (model.ts) that is made from engine events, and a teammate walks only when that model
// holds a trip it has not walked yet. With no event nothing moves and no animation frame is requested.
//
// How it is laid out so nothing collides: each teammate's place has a fixed name plate under it (2.0's name tag, and
// the button a person selects with), and each teammate has a bubble above its head. A teammate that is away from
// its place carries its name in the bubble, and the bubble moves to a free side when something is in the way.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { agentIdentity } from "./identity"
import { LabMap } from "./LabMap"
import { Mascot, type Mood } from "./Mascot"
import {
  CHARACTERS, CLAIM_GLYPH, CLAIM_WORD, FRESH_MS, GRID, NOT_IN_RUN, ROOM, ROOMS, STATE_GLYPH, STATE_WORD, TALL, WIDE, activeRooms, captionOf, characterOf, describeActivity,
  type Activity, type CharacterId, type LabLayout, type LabModel, type LabState, type RoomId, type Trip,
} from "./model"
import { active, advance, claimPlace, createSim, moving, settle, stationPoint, syncTrips, visitorPoint } from "./motion"
import "../design/lab.css"

export interface LabSceneProps {
  /** What the team is doing, from engine events (adapter.ts). The only thing that makes anyone move. */
  model: LabModel
  selected?: CharacterId
  onSelect?: (id: CharacterId) => void
  /**
   * The model's present, in engine time (ms). Leave it out for a run that is watched live (it is "now"). A replay
   * passes its playhead. A trip that ended longer ago than `FRESH_MS` before it is history and is not walked.
   */
  clock?: number
  /** Multiplies the walking pace (a replay at 4x). */
  speed?: number
  /** When this changes, everyone is put at their desks without walking (a jump in a replay). */
  settleKey?: string | number
  /** A small scene for a side panel: fewer words around the map. */
  compact?: boolean
  /**
   * "auto": three columns, two below 800 px, one below 600 px. "compact" (a strip beside or above other content):
   * three columns from 560 px, else two; never the one tall column.
   */
  layout?: "auto" | "compact" | "wide" | "tall"
  /** Shown in the bar under the map, before the status and "Pause motion": a replay's controls. */
  footer?: ReactNode
  className?: string
}

const PAUSED = "lab.paused"
const STATUS: Record<LabModel["status"], string> = { empty: "Team idle", waiting: "Waiting to start", running: "Team at work", done: "Run finished", failed: "Run failed", cancelled: "Run cancelled" }
const STATUS_GLYPH: Record<LabModel["status"], string> = { empty: "", waiting: "…", running: "●", done: "✓", failed: "✕", cancelled: "■" }
/** What the bubble above a teammate's head says for each state: a mark and a word, never colour alone. Idle says nothing. */
const CHIP: Record<LabState, string> = { idle: "", working: "… working", fetching: "⇄ fetching", "handing-off": "→ handed off", done: "✓ done", failed: "✕ failed", cancelled: "■ cancelled" }
/** A Buddy on the map: 56 units tall, standing on its point (2.0 draws its 100-unit box at 0.56). The box is for the bubbles' placing. */
const ART = { left: 28, right: 28, up: 53, down: 3 }
/** The name plate sits this far under a teammate's home, as 2.0's name tag does. */
const PLATE_DY = 19
/** 2.0's moods, from what the model says: asleep with no run or no part in it, at work, alarmed when its step failed. */
const moodOf = (a: Activity, status: LabModel["status"]): Mood =>
  !a.inRun || status === "empty" || a.state === "cancelled" ? "sleeping" : a.state === "failed" ? "alert" : a.state === "working" || a.state === "fetching" ? "working" : "happy"
/** What a teammate has in hand while it works at its place: 2.0's pencil, flask, book and slide. The others type. */
const TOOL: Partial<Record<CharacterId, Held>> = { proposer: "pencil", navigator: "pencil", reviser: "pencil", reporter: "pencil", experimenter: "flask", pilot: "flask", librarian: "book", critic: "slide" }
type Held = "paper" | "book" | "flask" | "slide" | "pencil"
/** What a walk carries, drawn as one of 2.0's held items: papers come as a book, a checked statement as a slide, bench work as a flask, the rest as a paper. */
const heldOf = (trip: Trip | undefined, who: CharacterId): Held =>
  !trip ? "paper" : trip.provider && trip.provider !== "exa" && trip.provider !== "fixture" ? "book" : trip.kind === "fetch" && trip.room === "review" ? "slide" : trip.kind === "handoff" && (who === "experimenter" || who === "pilot") ? "flask" : "paper"
const motionQuery = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : undefined)
/** True when the person asked the system for less motion. Follows a change of the setting. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => !!motionQuery()?.matches)
  useEffect(() => {
    const q = motionQuery()
    if (!q) return
    const on = () => setReduced(q.matches)
    on()
    q.addEventListener?.("change", on)
    return () => q.removeEventListener?.("change", on)
  }, [])
  return reduced
}

interface Box { x1: number; y1: number; x2: number; y2: number }
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
/** A label of this many characters at 12 px, in px: an estimate that errs on the wide side. */
const textWidth = (text: string) => text.length * 7 + 16

interface Nodes { walker: HTMLElement | null; art: HTMLElement | null; flip: HTMLElement | null; held: HTMLElement | null; chip: HTMLElement | null }

/** Below this width the compact map says it has no room for the teammates' names (data-tags); the page that holds it decides whether to hide them (researchLab.css). */
export const COMPACT_TAGS_MIN = 480

export function LabScene({ model, selected, onSelect, clock, speed = 1, settleKey, compact = false, layout: wanted = "auto", footer, className = "" }: LabSceneProps) {
  const reduced = useReducedMotion()
  const canAnimate = typeof requestAnimationFrame === "function"
  const [paused, setPaused] = useState(() => { try { return localStorage.getItem(PAUSED) === "true" } catch { return false } })
  const still = reduced || !canAnimate // no walking at all; states still show

  // Measured from the scene, not guessed from the window.
  const root = useRef<HTMLElement>(null), lab = useRef<HTMLDivElement>(null)
  const [sceneWidth, setSceneWidth] = useState(1000)
  const scale = useRef(1) // px for one map unit
  const layout: LabLayout = wanted === "tall" || (wanted === "auto" && sceneWidth < 600) ? TALL
    : (wanted === "auto" && sceneWidth < 800) || (wanted === "compact" && sceneWidth < 560) ? WIDE : GRID
  const tagless = wanted === "compact" && sceneWidth < COMPACT_TAGS_MIN
  const sim = useMemo(() => createSim(layout), [layout]) // one simulation a map; it is changed in place, outside React

  const nodes = useRef<Partial<Record<CharacterId, Nodes>>>({})
  /** A ref callback that files one element of one teammate. */
  const keep = <K extends keyof Nodes>(id: CharacterId, part: K) => (el: Nodes[K]) => { (nodes.current[id] ??= { walker: null, art: null, flip: null, held: null, chip: null })[part] = el }
  /** The claim cards: every room's tray holds one for each claim, and only the one in the claim's place is shown. */
  const cards = useRef(new Map<string, HTMLElement>())
  const counts = useRef(new Map<RoomId, HTMLElement>())
  const plates = useRef(new Map<CharacterId, HTMLElement>())
  const frame = useRef(0)
  const previous = useRef<number | null>(null)
  // What the frame loop reads: always the latest props, without restarting the loop.
  const live = useRef({ model, speed, paused, still })
  useEffect(() => { live.current = { model, speed, paused, still } })

  /** Write every teammate's place, pose and chip to the page. Done outside React so a frame costs a few style writes. */
  const paint = useCallback(() => {
    const { model: m, still: stand, paused: held } = live.current
    const s = scale.current || 1, unit = (px: number) => px / s
    const at = sim.layout
    const taken: (Box & { of?: CharacterId; /** a caption: never to be covered */ text?: boolean })[] = []
    const chips: { id: CharacterId; text: string; x: number; y: number; away: boolean; cargo: boolean }[] = []
    for (const w of Object.values(sim.walkers)) {
      const n = nodes.current[w.id]
      if (!n?.walker) continue
      const a = m.characters[w.id]
      const walking = !stand && !held && moving(sim, w)
      // Without motion the parcel is shown at the desk while the model says the teammate fetches or hands over.
      const last: Trip | undefined = a.trips.at(-1)
      const holds = stand ? (a.state === "fetching" && last?.outcome === "carried") || a.state === "handing-off" : w.carrying
      const tag = stand ? (holds ? last?.short ?? "" : "") : w.tag
      const phase = sim.clock * 10 + w.index // 2.0's walk: a small hop and a sway
      n.walker.style.left = `${(w.x / at.width) * 100}%`
      n.walker.style.top = `${(w.y / at.height) * 100}%`
      n.walker.style.zIndex = String(10 + Math.round(w.y))
      n.walker.dataset.moving = String(walking)
      n.walker.dataset.carrying = String(holds)
      n.walker.dataset.out = String(!stand && (w.route.length > 0 || w.waiting))
      if (n.flip) n.flip.style.transform = `scaleX(${stand ? 1 : w.facing})`
      if (n.art) n.art.style.transform = walking ? `translateY(${-Math.abs(Math.sin(phase)) * 4 * s}px) rotate(${Math.sin(phase) * 3.4}deg)` : ""
      if (n.held) n.held.dataset.kind = holds ? heldOf(stand ? last : w.job ?? last, w.id) : ""
      taken.push({ x1: w.x - ART.left, y1: w.y - ART.up, x2: w.x + ART.right, y2: w.y + ART.down, of: w.id })
      const away = !stand && Math.hypot(w.x - w.home.x, w.y - w.home.y) > 8
      // At its place the bubble says the state, or what is in hand. In its own room it says only what it carries
      // (its name plate is beside it). In another room or the corridor it also says who it is.
      const says = !a.inRun ? "" : holds && tag ? tag : CHIP[a.state]
      const room = at.at[characterOf(w.id).room]
      const abroad = away && !(w.x >= room.x && w.x <= room.x + ROOM.width && w.y >= room.y && w.y <= room.y + ROOM.height)
      const text = !away ? says : holds && tag ? (abroad ? `${captionOf(a)}: ${tag}` : tag) : abroad ? `${captionOf(a)}${a.inRun && STATE_GLYPH[a.state] ? ` ${STATE_GLYPH[a.state]}` : ""}` : a.inRun ? STATE_GLYPH[a.state] : ""
      chips.push({ id: w.id, text, x: w.x, y: w.y, away, cargo: holds && !!tag })
    }
    // The fixed name plates: each stays inside its room's card, and no bubble may lie on one.
    for (const c of CHARACTERS) {
      const home = stationPoint(c, at), room = at.at[c.room]
      const half = unit(textWidth(captionOf(m.characters[c.id])) + 14) / 2
      const x = Math.max(room.x + 6 + half, Math.min(room.x + ROOM.width - 6 - half, home.x)), y = Math.min(room.y + ROOM.height - unit(13), home.y + PLATE_DY)
      const plate = plates.current.get(c.id)
      if (plate) { plate.style.left = `${(x / at.width) * 100}%`; plate.style.top = `${(y / at.height) * 100}%` }
      taken.push({ x1: x - half, y1: y - unit(11), x2: x + half, y2: y + unit(11), text: true })
    }
    // Chips: a teammate at its desk has its chip above its head (that row is kept free). One that is away tries
    // above, then each side, then below, and takes the first place where nothing else is.
    for (const chip of chips.sort((a, b) => Number(a.away) - Number(b.away))) {
      const el = nodes.current[chip.id]?.chip
      if (!el) continue
      if (el.textContent !== chip.text) el.textContent = chip.text
      el.hidden = !chip.text
      el.dataset.cargo = String(chip.cargo)
      if (!chip.text) continue
      const w = unit(textWidth(chip.text)), h = unit(20), gap = unit(3)
      const above = chip.y - ART.up - h / 2 - gap, side = ART.right + w / 2 + gap
      const spots = [
        { x: chip.x, y: above },
        ...(chip.away ? [
          { x: chip.x + side, y: chip.y - 30 }, { x: chip.x - side, y: chip.y - 30 }, // right, left
          { x: chip.x + w / 2, y: above - h - gap }, { x: chip.x - w / 2, y: above - h - gap }, { x: chip.x, y: above - h - gap }, // higher
          { x: chip.x, y: chip.y + ART.down + h / 2 + gap }, // below
          { x: chip.x + side, y: chip.y - 4 }, { x: chip.x - side, y: chip.y - 4 }, // lower corners
          { x: chip.x + w / 2, y: above - 2 * (h + gap) }, { x: chip.x - w / 2, y: above - 2 * (h + gap) }, // higher still
        ] : []),
      ]
      const box = (p: { x: number; y: number }): Box => ({ x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2 })
      // Lying on a name plate or on another bubble is the worst; lying on a figure is tolerable; its own figure is not
      // in its way. A place that sticks out of the map is the last choice.
      const cost = (p: { x: number; y: number }) => taken.reduce((sum, b) => (b.of === chip.id ? sum : sum + overlap(box(p), b) * (b.text ? 40 : 1)), 0) + (p.x - w / 2 < 0 || p.x + w / 2 > at.width || p.y - h / 2 < 0 ? 1e7 : 0)
      const best = spots.reduce((a, b) => (cost(b) < cost(a) ? b : a))
      el.style.left = `${(best.x / at.width) * 100}%`
      el.style.top = `${(best.y / at.height) * 100}%`
      el.style.zIndex = String(2000 + Math.round(best.y))
      taken.push({ ...box(best), text: true })
    }
    // How many teammates are in each room now (2.0's count beside the room's name).
    for (const r of ROOMS) {
      const el = counts.current.get(r.id)
      if (!el) continue
      const room = at.at[r.id]
      const n = Object.values(sim.walkers).filter((w) => w.x >= room.x && w.x <= room.x + ROOM.width && w.y >= room.y && w.y <= room.y + ROOM.height).length
      if (el.textContent !== String(n)) el.textContent = String(n)
    }
    // A claim is shown in one room: where it is being fetched from while the Engine walks to it, nowhere while it
    // is carried, else the room of the state the model gives it.
    for (const c of m.claims ?? []) {
      const place = stand ? c.room : claimPlace(sim, c.id) ?? c.room
      for (const r of ROOMS) { const card = cards.current.get(`${r.id}/${c.id}`); if (card) card.hidden = place !== r.id }
    }
  }, [sim])

  const stop = useCallback(() => { if (frame.current && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame.current); frame.current = 0; previous.current = null }, [])
  /** Ask for frames, but only while there is something to move. The loop ends itself when everyone is home. */
  const kick = useCallback(() => {
    const tick = (timestamp: number) => {
      frame.current = 0
      const now = live.current
      if (now.still || now.paused || document.hidden) { previous.current = null; return }
      const dt = previous.current === null ? 0 : Math.min((timestamp - previous.current) / 1000, 0.05)
      previous.current = timestamp
      const more = advance(sim, dt, Math.max(1, now.speed))
      paint()
      if (more) frame.current = requestAnimationFrame(tick)
      else previous.current = null
    }
    const now = live.current
    if (frame.current || now.still || now.paused || document.hidden || !active(sim)) return
    frame.current = requestAnimationFrame(tick)
  }, [paint, sim])

  // Take the model in: new trips are queued (or only noted, without motion), then the page is painted.
  const settled = useRef<{ key: string | number | undefined; sim: typeof sim }>({ key: settleKey, sim })
  useLayoutEffect(() => {
    live.current = { model, speed, paused, still }
    if (lab.current?.clientWidth) scale.current = lab.current.clientWidth / sim.layout.width
    const other = settled.current.sim !== sim // the map changed: everyone starts at home on the new one
    if (other || settled.current.key !== settleKey || (still && active(sim))) { settled.current = { key: settleKey, sim }; settle(sim, model) }
    const present = clock ?? Date.now()
    syncTrips(sim, model, (trip) => !still && (trip.kind === "fetch" && trip.back === undefined ? true : present - (trip.back ?? trip.at) <= FRESH_MS))
    paint()
    if (still || paused || !active(sim)) stop(); else kick()
  }, [model, clock, speed, paused, still, settleKey, paint, kick, stop, sim])

  // A hidden tab gets no frames. Every frame, listener and observer is gone when the scene is.
  useEffect(() => {
    const seen = () => { if (document.hidden) stop(); else kick() }
    document.addEventListener("visibilitychange", seen)
    return () => { document.removeEventListener("visibilitychange", seen); stop() }
  }, [kick, stop])
  useEffect(() => {
    const el = root.current
    if (!el || typeof ResizeObserver === "undefined") return
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) setSceneWidth(width)
      if (lab.current?.clientWidth) { scale.current = lab.current.clientWidth / sim.layout.width; paint() }
    }
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    measure()
    return () => watch.disconnect()
  }, [paint, sim])

  const toggle = () => setPaused((was) => { try { localStorage.setItem(PAUSED, String(!was)) } catch { /* private mode */ } return !was })
  const perRoom = new Map<string, number>()
  const place = (x: number, y: number): CSSProperties => ({ left: `${(x / layout.width) * 100}%`, top: `${(y / layout.height) * 100}%` })
  const on = activeRooms(model)
  /** A room is done when every teammate of it that is in the run is done (2.0's green dot). */
  const done = (room: RoomId) => { const mine = CHARACTERS.filter((c) => c.room === room && model.characters[c.id].inRun); return mine.length > 0 && mine.every((c) => model.characters[c.id].state === "done") }

  return (
    <section ref={root} className={`lab-scene ${className}`} data-compact={compact || undefined} data-status={model.status} data-layout={layout.id} data-tags={tagless ? "hidden" : undefined} aria-label="Agent Lab">
      <div className="lab-viewport">
        <span className="lab-badge" data-status={model.status}>{STATUS_GLYPH[model.status] && <span aria-hidden="true">{STATUS_GLYPH[model.status]} </span>}{STATUS[model.status]}</span>
        <div ref={lab} className="lab" data-still={still || undefined} data-paused={paused || undefined} style={{ "--lab-w": layout.width, "--lab-h": layout.height } as CSSProperties}>
          <LabMap layout={layout} active={on.join(",")} />
          {/* Each room's name, as 2.0 labels it: a dot for its state, the name, and how many teammates are in it. */}
          {ROOMS.map((r) => (
            <span key={r.id} className="lab-room-name" data-room-state={on.includes(r.id) ? "active" : done(r.id) ? "done" : "rest"} style={place(layout.at[r.id].x + 16, layout.at[r.id].y + 28)} title={on.includes(r.id) ? `${r.name}: someone is working here` : done(r.id) ? `${r.name}: its teammates are done` : r.name}>
              <i aria-hidden="true" />{r.name}<b aria-hidden="true" ref={(el) => { if (el) counts.current.set(r.id, el); else counts.current.delete(r.id) }}>2</b>
            </span>
          ))}
          {model.claims && ROOMS.map((r) => (
            <ul key={r.id} className="lab-tray" aria-label={`Claims in ${r.name}`} style={{ ...place(layout.at[r.id].x + 262, layout.at[r.id].y + 9), width: `${(176 / layout.width) * 100}%` }}>
              {model.claims!.map((c) => (
                <li key={c.id} className="lab-claim" data-claim={c.id} data-state={c.state} hidden={c.room !== r.id} title={`${c.text}${c.reason ? ` Why it is here: ${c.reason}` : ""}`}
                  ref={(el) => { if (el) cards.current.set(`${r.id}/${c.id}`, el); else cards.current.delete(`${r.id}/${c.id}`) }}>
                  <b>{c.id}</b> {CLAIM_GLYPH[c.state] && <span aria-hidden="true">{CLAIM_GLYPH[c.state]} </span>}{CLAIM_WORD[c.state]}
                </li>
              ))}
            </ul>
          ))}
          {/* The name plate under each teammate's place: the control a person selects a teammate with. It never moves. */}
          {CHARACTERS.map((c) => {
            const a = model.characters[c.id], home = stationPoint(c, layout)
            const told = describeActivity(captionOf(a), a)
            return (
              <button key={c.id} type="button" className="lab-plate" style={place(home.x, home.y + PLATE_DY)} ref={(el) => { if (el) plates.current.set(c.id, el); else plates.current.delete(c.id) }}
                data-agent={c.id} data-state={a.state} data-in-run={a.inRun} data-problem={a.problem ? true : undefined}
                aria-pressed={selected === c.id} aria-label={`Inspect ${told}`} title={told} onClick={() => onSelect?.(c.id)}>
                <i aria-hidden="true" /><span className="lab-plate-name">{captionOf(a)}</span>
              </button>
            )
          })}
          {/* The teammates themselves. Decoration for a screen reader: the plate above says who and what. */}
          {CHARACTERS.map((c) => {
            const a = model.characters[c.id]
            return (
              <span key={c.id} className="lab-agent" ref={keep(c.id, "walker")} data-walker={c.id} data-state={a.state} data-in-run={a.inRun} data-selected={selected === c.id || undefined}
                aria-hidden="true" title={a.inRun ? captionOf(a) : `${captionOf(a)}: ${NOT_IN_RUN.toLowerCase()}`} onClick={() => onSelect?.(c.id)}>
                <span className="lab-ring" />
                {a.problem && <span className="lab-alert">!</span>}
                <span className="lab-flip" ref={keep(c.id, "flip")}>
                  <span className="lab-art" ref={keep(c.id, "art")}><Mascot shape={c.shape} color={c.color} mood={moodOf(a, model.status)} /></span>
                  <span className="lab-held" ref={keep(c.id, "held")} data-kind="" data-tool={a.inRun && (a.state === "working" || a.state === "fetching") ? TOOL[c.id] : undefined}><HeldItems /></span>
                </span>
              </span>
            )
          })}
          {CHARACTERS.map((c) => <span key={c.id} className="lab-chip" ref={keep(c.id, "chip")} data-chip={c.id} data-state={model.characters[c.id].state} aria-hidden="true" hidden />)}
          {model.visitors.map((v) => {
            const n = perRoom.get(v.room) ?? 0
            perRoom.set(v.room, n + 1)
            const at = visitorPoint(v.room, n, layout), who = agentIdentity(v.id, { title: v.title })
            return (
              <span key={v.id} className="lab-agent lab-visitor" style={{ ...place(at.x, at.y), zIndex: 10 + Math.round(at.y) }} data-state={v.state} data-visitor={v.id} role="img" aria-label={`Visitor ${v.name}: ${STATE_WORD[v.state]}. ${v.doing}`} title={`Visiting specialist: ${v.name}. ${v.doing}`}>
                <span className="lab-art"><Mascot shape={who.shape} color={who.colour} mood={v.state === "working" ? "working" : "happy"} /></span>
                <span className="lab-visitor-name">{STATE_GLYPH[v.state] && <span aria-hidden="true">{STATE_GLYPH[v.state]} </span>}{v.name}</span>
              </span>
            )
          })}
        </div>
      </div>
      <div className="lab-foot">
        {footer}
        <button type="button" className="btn lab-pause" onClick={toggle} disabled={still} aria-pressed={paused || still}>
          {reduced ? "Reduced motion enabled" : !canAnimate ? "Motion not available" : paused ? "Resume motion" : "Pause motion"}
        </button>
      </div>
    </section>
  )
}

/** 2.0's held items, small: a paper, a book, a flask, a slide and a pencil. One is shown at a time (lab.css, by data-kind or data-tool). */
function HeldItems() {
  return (
    <svg viewBox="-12 -20 24 32" aria-hidden="true" focusable="false">
      <g data-held="paper"><rect x="-7" y="-9" width="14" height="18" rx="2" fill="#fffdf6" stroke="#e2dccb" /><rect x="-4" y="-5" width="8" height="1.6" rx=".8" fill="#e2dccb" /><rect x="-4" y="-0.5" width="8" height="1.6" rx=".8" fill="#e2dccb" /><rect x="-4" y="4" width="5" height="1.6" rx=".8" fill="#e2dccb" /></g>
      <g data-held="book"><rect x="-8" y="-6" width="16" height="12" rx="2" fill="#6b9bf2" /><rect x="-7" y="-5" width="7" height="10" rx="1" fill="#fffdf6" /><rect x="0" y="-5" width="7" height="10" rx="1" fill="#fffdf6" /></g>
      <g data-held="flask" transform="translate(0 8) scale(.8)"><path d="M-3 -17 L-3 -10 L-9.5 -1 Q-10 0 -9 0 L9 0 Q10 0 9.5 -1 L3 -10 L3 -17 Z" fill="rgba(107,155,242,.22)" /><path d="M-5.5 -6.5 L5.5 -6.5 L9.5 -1 Q10 0 9 0 L-9 0 Q-10 0 -9.5 -1 Z" fill="#5cc48d" /></g>
      <g data-held="slide"><rect x="-9" y="-3" width="18" height="6" rx="1.5" fill="rgba(107,155,242,.45)" /><circle cx="0" cy="0" r="2.2" fill="#f6b6cd" /></g>
      <g data-held="pencil" transform="rotate(40)"><rect x="-1.8" y="-9" width="3.6" height="13" rx="1" fill="#ffcf4a" /><path d="M-1.8 4 L1.8 4 L0 8 Z" fill="#c9a27a" /></g>
    </svg>
  )
}
