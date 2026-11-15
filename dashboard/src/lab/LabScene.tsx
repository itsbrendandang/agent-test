// Agent Lab design by Anh Lam (https://github.com/Anhlam09/agent-lab-report). The dashboard's version of Anh's
// lab scene: the map of six rooms, the twelve teammates at their desks, the walk to a room and back with a parcel,
// the "Pause motion" control and reduced-motion support.
//
// What differs from Anh's page: the scene has no clock of its own for work. It draws an activity model (model.ts)
// that is made from engine events, and a teammate walks only when that model holds a trip it has not walked yet.
// With no event nothing moves and no animation frame is requested.
//
// How it is laid out so nothing collides: each desk has a fixed name plate under it (the button a person selects),
// and each teammate has a status chip above its head. A teammate that is away from its desk carries its name in the
// chip, and the chip moves to a free side when something is in the way.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { LabMap } from "./LabMap"
import { Mascot } from "./Mascot"
import {
  CHARACTERS, CLAIM_GLYPH, CLAIM_WORD, FRESH_MS, NOT_IN_RUN, ROOM, ROOMS, SEARCH_SPOTS, SPOT, STATE_GLYPH, STATE_WORD, TALL, WIDE, captionOf, describeActivity,
  type CharacterId, type LabLayout, type LabModel, type LabState, type Shape, type Trip,
} from "./model"
import { active, advance, claimPlace, createSim, moving, settle, stationPoint, syncTrips, visitorPoint } from "./motion"
import "./lab.css"

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
  /** "auto" (the default): Anh's wide map, or the same rooms in one column when the scene is narrower than 600 px. */
  layout?: "auto" | "wide" | "tall"
  /** Shown in the bar under the map, before the status and "Pause motion": a replay's controls. */
  footer?: ReactNode
  className?: string
}

const PAUSED = "lab.paused"
const STATUS: Record<LabModel["status"], string> = { empty: "Team idle", waiting: "Waiting to start", running: "Team at work", done: "Run finished", failed: "Run failed", cancelled: "Run cancelled" }
const STATUS_GLYPH: Record<LabModel["status"], string> = { empty: "", waiting: "…", running: "●", done: "✓", failed: "✕", cancelled: "■" }
const VISITOR_SHAPES: Shape[] = ["mushroom", "acorn", "tree", "owl"]
/** What the chip above a teammate's head says for each state: a mark and a word, never colour alone. Idle says nothing. */
const CHIP: Record<LabState, string> = { idle: "", working: "… working", fetching: "⇄ fetching", "handing-off": "→ handed off", done: "✓ done", failed: "✕ failed", cancelled: "■ cancelled" }
/** A character's drawing, in map units (lab.css sizes it the same). */
const ART = { w: 60, h: 65 }

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

interface Nodes { walker: HTMLElement | null; art: HTMLElement | null; feet: SVGGElement | null; chip: HTMLElement | null }

export function LabScene({ model, selected, onSelect, clock, speed = 1, settleKey, compact = false, layout: wanted = "auto", footer, className = "" }: LabSceneProps) {
  const reduced = useReducedMotion()
  const canAnimate = typeof requestAnimationFrame === "function"
  const [paused, setPaused] = useState(() => { try { return localStorage.getItem(PAUSED) === "true" } catch { return false } })
  const still = reduced || !canAnimate // no walking at all; states still show

  // Which map: Anh's wide one, or one column of rooms when the scene is narrow. Measured, not guessed from the window.
  const root = useRef<HTMLElement>(null), lab = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const scale = useRef(1) // px for one map unit
  const layout: LabLayout = wanted === "tall" || (wanted === "auto" && narrow) ? TALL : WIDE
  const sim = useMemo(() => createSim(layout), [layout]) // one simulation a map; it is changed in place, outside React

  const nodes = useRef<Partial<Record<CharacterId, Nodes>>>({})
  /** A ref callback that files one element of one teammate. */
  const keep = <K extends keyof Nodes>(id: CharacterId, part: K) => (el: Nodes[K]) => { (nodes.current[id] ??= { walker: null, art: null, feet: null, chip: null })[part] = el }
  /** The claim cards: every room's tray holds one for each claim, and only the one in the claim's place is shown. */
  const cards = useRef(new Map<string, HTMLElement>())
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
    const taken: (Box & { of?: CharacterId })[] = []
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
      const stride = walking ? Math.sin(sim.clock * 15 + w.index) : 0
      n.walker.style.left = `${(w.x / at.width) * 100}%`
      n.walker.style.top = `${(w.y / at.height) * 100}%`
      n.walker.style.zIndex = String(10 + Math.round(w.y))
      n.walker.dataset.moving = String(walking)
      n.walker.dataset.carrying = String(holds)
      n.walker.dataset.out = String(!stand && (w.route.length > 0 || w.waiting))
      if (n.art) n.art.style.transform = walking ? `translateY(${-Math.abs(stride) * 2}px) rotate(${stride * 3}deg)` : ""
      n.feet?.setAttribute("transform", `translate(${stride * 1.5} 0)`)
      taken.push({ x1: w.x - ART.w / 2, y1: w.y - ART.h / 2, x2: w.x + ART.w / 2, y2: w.y + ART.h / 2, of: w.id })
      const away = !stand && Math.hypot(w.x - w.home.x, w.y - w.home.y) > 8
      // At its desk the chip says the state, or what is in the parcel. Away from it, the chip also says who it is
      // (the name plate stayed at the desk): the name, and what it carries or the mark of its state.
      const says = !a.inRun ? "" : holds && tag ? tag : CHIP[a.state]
      const text = !away ? says : holds && tag ? `${captionOf(a)}: ${tag}` : `${captionOf(a)}${a.inRun && STATE_GLYPH[a.state] ? ` ${STATE_GLYPH[a.state]}` : ""}`
      chips.push({ id: w.id, text, x: w.x, y: w.y, away, cargo: holds && !!tag })
    }
    // The fixed name plates under the desks are never covered.
    for (const c of CHARACTERS) {
      const home = stationPoint(c, at), half = unit(textWidth(captionOf(m.characters[c.id]))) / 2
      taken.push({ x1: home.x - half, y1: home.y + (SPOT.plate - SPOT.stand) - unit(11), x2: home.x + half, y2: home.y + (SPOT.plate - SPOT.stand) + unit(11) })
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
      const spots = [
        { x: chip.x, y: chip.y - ART.h / 2 - h / 2 - gap },
        ...(chip.away ? [
          { x: chip.x + ART.w / 2 + w / 2 + gap, y: chip.y - 6 }, { x: chip.x - ART.w / 2 - w / 2 - gap, y: chip.y - 6 }, // right, left
          { x: chip.x, y: chip.y + ART.h / 2 + h / 2 + gap }, // below
          { x: chip.x + w / 2, y: chip.y - ART.h / 2 - h * 1.5 - gap * 2 }, { x: chip.x - w / 2, y: chip.y - ART.h / 2 - h * 1.5 - gap * 2 }, // higher, to either side
          { x: chip.x + ART.w / 2 + w / 2 + gap, y: chip.y + ART.h / 2 }, { x: chip.x - ART.w / 2 - w / 2 - gap, y: chip.y + ART.h / 2 }, // lower corners
        ] : []),
      ]
      const box = (p: { x: number; y: number }): Box => ({ x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2 })
      // its own drawing is not in its way; a place that sticks out of the map is the last choice
      const cost = (p: { x: number; y: number }) => taken.reduce((sum, b) => (b.of === chip.id ? sum : sum + overlap(box(p), b)), 0) + (p.x - w / 2 < 0 || p.x + w / 2 > at.width ? 1e6 : 0)
      const best = spots.reduce((a, b) => (cost(b) < cost(a) ? b : a))
      el.style.left = `${(best.x / at.width) * 100}%`
      el.style.top = `${(best.y / at.height) * 100}%`
      el.style.zIndex = String(2000 + Math.round(best.y))
      taken.push(box(best))
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
      if (width > 0) setNarrow(width < 600)
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
  const discovery = layout.at.discovery

  return (
    <section ref={root} className={`lab-scene ${className}`} data-compact={compact || undefined} data-status={model.status} data-layout={layout.id} aria-label="Lab view">
      <div className="lab-viewport">
        <span className="lab-badge" data-status={model.status}>{STATUS_GLYPH[model.status] && <span aria-hidden="true">{STATUS_GLYPH[model.status]} </span>}{STATUS[model.status]}</span>
        <div ref={lab} className="lab" data-still={still || undefined} data-paused={paused || undefined} style={{ "--lab-w": layout.width, "--lab-h": layout.height } as CSSProperties}>
          <LabMap layout={layout} />
          {ROOMS.map((r) => <span key={r.id} className="lab-room-name" style={place(layout.at[r.id].x + 44, layout.at[r.id].y + 28)}>{r.name}</span>)}
          {Object.values(SEARCH_SPOTS).map((spot) => <span key={spot.sign} className="lab-spot-name" title={spot.about} style={place(discovery.x + (discovery.door === "right" ? spot.signDx : ROOM.width - spot.signDx), discovery.y + spot.signDy)}>{spot.sign}</span>)}
          {model.claims && ROOMS.map((r) => (
            <ul key={r.id} className="lab-tray" aria-label={`Claims in ${r.name}`} style={{ ...place(layout.at[r.id].x + 232, layout.at[r.id].y + 13), width: `${(176 / layout.width) * 100}%` }}>
              {model.claims!.map((c) => (
                <li key={c.id} className="lab-claim" data-claim={c.id} data-state={c.state} hidden={c.room !== r.id} title={`${c.text}${c.reason ? ` Why it is here: ${c.reason}` : ""}`}
                  ref={(el) => { if (el) cards.current.set(`${r.id}/${c.id}`, el); else cards.current.delete(`${r.id}/${c.id}`) }}>
                  <b>{c.id}</b> {CLAIM_GLYPH[c.state] && <span aria-hidden="true">{CLAIM_GLYPH[c.state]} </span>}{CLAIM_WORD[c.state]}
                </li>
              ))}
            </ul>
          ))}
          {/* The name plate under each desk: the control a person selects a teammate with. It never moves. */}
          {CHARACTERS.map((c) => {
            const a = model.characters[c.id], home = stationPoint(c, layout)
            const told = describeActivity(captionOf(a), a)
            return (
              <button key={c.id} type="button" className="lab-plate" style={place(home.x, home.y + (SPOT.plate - SPOT.stand))}
                data-agent={c.id} data-state={a.state} data-in-run={a.inRun} data-problem={a.problem ? true : undefined}
                aria-pressed={selected === c.id} aria-label={`Inspect ${told}`} title={told} onClick={() => onSelect?.(c.id)}>
                {captionOf(a)}
              </button>
            )
          })}
          {/* The teammates themselves. Decoration for a screen reader: the plate above says who and what. */}
          {CHARACTERS.map((c) => {
            const a = model.characters[c.id]
            return (
              <span key={c.id} className="lab-agent" ref={keep(c.id, "walker")} data-walker={c.id} data-state={a.state} data-in-run={a.inRun} data-selected={selected === c.id || undefined}
                aria-hidden="true" title={a.inRun ? captionOf(a) : `${captionOf(a)}: ${NOT_IN_RUN.toLowerCase()}`} onClick={() => onSelect?.(c.id)}>
                <span className="lab-cargo" />
                {a.problem && <span className="lab-alert">!</span>}
                <span className="lab-art" ref={keep(c.id, "art")}><Mascot shape={c.shape} color={c.color} feetRef={keep(c.id, "feet")} /></span>
              </span>
            )
          })}
          {CHARACTERS.map((c) => <span key={c.id} className="lab-chip" ref={keep(c.id, "chip")} data-chip={c.id} data-state={model.characters[c.id].state} aria-hidden="true" hidden />)}
          {model.visitors.map((v, i) => {
            const n = perRoom.get(v.room) ?? 0
            perRoom.set(v.room, n + 1)
            const at = visitorPoint(v.room, n, layout)
            return (
              <span key={v.id} className="lab-agent lab-visitor" style={{ ...place(at.x, at.y + Math.floor(n / 2) * 8), zIndex: 10 + Math.round(at.y) }} data-state={v.state} data-visitor={v.id} role="img" aria-label={`Visitor ${v.name}: ${STATE_WORD[v.state]}. ${v.doing}`} title={`Visiting specialist: ${v.name}. ${v.doing}`}>
                <span className="lab-art"><Mascot shape={VISITOR_SHAPES[i % VISITOR_SHAPES.length]} color="#d9d2c0" /></span>
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
