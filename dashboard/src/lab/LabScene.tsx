// Agent Lab design by Anh Lam (https://github.com/Anhlam09/agent-lab-report). The dashboard's version of Anh's
// lab scene: the map of six rooms, the twelve teammates at their desks, the walk to a room and back with a parcel,
// the "Pause motion" control and reduced-motion support.
//
// What differs from Anh's page: the scene has no clock of its own for work. It draws an activity model (model.ts)
// that is made from engine events, and a teammate walks only when that model holds a trip it has not walked yet.
// With no event nothing moves and no animation frame is requested.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { LabMap } from "./LabMap"
import { Mascot } from "./Mascot"
import { CHARACTERS, FRESH_MS, MAP, ROOMS, SEARCH_SPOTS, STATE_GLYPH, STATE_WORD, captionOf, describeActivity, roomOf, type CharacterId, type LabModel, type Shape, type Trip } from "./model"
import { active, advance, createSim, moving, settle, syncTrips, visitorPoint, type Sim } from "./motion"
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
  /** A small scene for a side panel: it shrinks to its container and shows fewer words. */
  compact?: boolean
  className?: string
}

const PAUSED = "lab.paused"

const STATUS: Record<LabModel["status"], string> = { empty: "Team idle", waiting: "Waiting to start", running: "Team at work", done: "Run finished", failed: "Run failed", cancelled: "Run cancelled" }
const STATUS_GLYPH: Record<LabModel["status"], string> = { empty: "", waiting: "…", running: "●", done: "✓", failed: "✕", cancelled: "■" }
const VISITOR_SHAPES: Shape[] = ["mushroom", "acorn", "tree", "owl"]

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

interface Nodes { button: HTMLButtonElement | null; art: HTMLSpanElement | null; feet: SVGGElement | null; tag: HTMLSpanElement | null }

export function LabScene({ model, selected, onSelect, clock, speed = 1, settleKey, compact = false, className = "" }: LabSceneProps) {
  const reduced = useReducedMotion()
  const canAnimate = typeof requestAnimationFrame === "function"
  const [paused, setPaused] = useState(() => { try { return localStorage.getItem(PAUSED) === "true" } catch { return false } })
  const still = reduced || !canAnimate // no walking at all; states still show
  const [sim] = useState<Sim>(createSim) // one simulation for the life of the scene; it is changed in place, outside React
  const nodes = useRef<Partial<Record<CharacterId, Nodes>>>({})
  /** A ref callback that files one element of one teammate. */
  const keep = <K extends keyof Nodes>(id: CharacterId, part: K) => (el: Nodes[K]) => { (nodes.current[id] ??= { button: null, art: null, feet: null, tag: null })[part] = el }
  const frame = useRef(0)
  const previous = useRef<number | null>(null)
  // What the frame loop reads: always the latest props, without restarting the loop.
  const live = useRef({ model, speed, paused, still })
  useEffect(() => { live.current = { model, speed, paused, still } })

  /** Write every teammate's place and pose to the page. Done outside React so a frame costs twelve style writes. */
  const paint = useCallback(() => {
    const { model: m, still: stand, paused: held } = live.current
    for (const w of Object.values(sim.walkers)) {
      const n = nodes.current[w.id]
      if (!n?.button) continue
      const a = m.characters[w.id]
      const walking = !stand && !held && moving(sim, w)
      // Without motion the parcel is shown at the desk while the model says the teammate fetches or hands over.
      const last: Trip | undefined = a.trips.at(-1)
      const holds = stand ? (a.state === "fetching" && last?.outcome === "carried") || a.state === "handing-off" : w.carrying
      const tag = stand ? (holds ? last?.short ?? "" : "") : w.tag
      const stride = walking ? Math.sin(sim.clock * 15 + w.index) : 0
      n.button.style.left = `${(w.x / MAP.width) * 100}%`
      n.button.style.top = `${(w.y / MAP.height) * 100}%`
      n.button.style.zIndex = String(Math.round(w.y))
      n.button.dataset.moving = String(walking)
      n.button.dataset.carrying = String(holds)
      n.button.dataset.out = String(!stand && (w.route.length > 0 || w.waiting))
      if (n.art) n.art.style.transform = walking ? `translateY(${-Math.abs(stride) * 2}px) rotate(${stride * 3}deg)` : ""
      n.feet?.setAttribute("transform", `translate(${stride * 1.5} 0)`)
      if (n.tag && n.tag.textContent !== tag) n.tag.textContent = tag
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
  const settled = useRef<string | number | undefined>(settleKey)
  useLayoutEffect(() => {
    live.current = { model, speed, paused, still }
    if (settled.current !== settleKey || (still && active(sim))) { settled.current = settleKey; settle(sim, model) }
    const present = clock ?? Date.now()
    syncTrips(sim, model, (trip) => !still && (trip.kind === "fetch" && trip.back === undefined ? true : present - (trip.back ?? trip.at) <= FRESH_MS))
    paint()
    if (still || paused || !active(sim)) stop(); else kick()
  }, [model, clock, speed, paused, still, settleKey, paint, kick, stop, sim])

  // A hidden tab gets no frames. Every frame and listener is gone when the scene is.
  useEffect(() => {
    const seen = () => { if (document.hidden) stop(); else kick() }
    document.addEventListener("visibilitychange", seen)
    return () => { document.removeEventListener("visibilitychange", seen); stop() }
  }, [kick, stop])

  const toggle = () => setPaused((was) => { try { localStorage.setItem(PAUSED, String(!was)) } catch { /* private mode */ } return !was })
  const perRoom = new Map<string, number>()

  return (
    <section className={`lab-scene ${className}`} data-compact={compact || undefined} data-status={model.status} aria-label="Lab view">
      <div className="lab-toolbar">
        <strong>Lab view</strong>
        <span className="lab-badge" data-status={model.status}>{STATUS_GLYPH[model.status] && <span aria-hidden="true">{STATUS_GLYPH[model.status]} </span>}{STATUS[model.status]}</span>
        <button type="button" className="btn lab-pause" onClick={toggle} disabled={still} aria-pressed={paused || still}>
          {reduced ? "Reduced motion enabled" : !canAnimate ? "Motion not available" : paused ? "Resume motion" : "Pause motion"}
        </button>
      </div>
      <div className="lab-viewport" tabIndex={compact ? undefined : 0} role="group" aria-label="The six rooms of the lab. Scroll sideways on a small screen.">
        <div className="lab" data-still={still || undefined} data-paused={paused || undefined}>
          <LabMap />
          {ROOMS.map((r) => <span key={r.id} className="lab-room-name" style={{ left: `${((r.x + 46) / MAP.width) * 100}%`, top: `${((r.y + 31) / MAP.height) * 100}%` }}>{r.name}</span>)}
          {Object.values(SEARCH_SPOTS).map((spot) => <span key={spot.sign} className="lab-spot-name" title={spot.about} style={{ left: `${((roomOf("discovery").x + spot.dx) / MAP.width) * 100}%`, top: `${((roomOf("discovery").y + spot.dy - 72) / MAP.height) * 100}%` }}>{spot.sign}</span>)}
          {CHARACTERS.map((c) => {
            const a = model.characters[c.id]
            const word = !a.inRun ? "not in this run" : a.state === "failed" ? "failed" : a.state === "cancelled" ? "cancelled" : ""
            return (
              <button key={c.id} type="button" className="lab-agent" ref={keep(c.id, "button")}
                data-agent={c.id} data-state={a.state} data-in-run={a.inRun} data-problem={a.problem ? true : undefined}
                aria-pressed={selected === c.id} aria-label={`Inspect ${describeActivity(captionOf(a), a)}`} title={describeActivity(captionOf(a), a)} onClick={() => onSelect?.(c.id)}>
                <span className="lab-cargo" aria-hidden="true"><span className="lab-cargo-tag" ref={keep(c.id, "tag")} /></span>
                {a.problem && <span className="lab-alert" aria-hidden="true">!</span>}
                <span className="lab-art" ref={keep(c.id, "art")}><Mascot shape={c.shape} color={c.color} feetRef={keep(c.id, "feet")} /></span>
                <span className="lab-name">
                  {a.inRun && STATE_GLYPH[a.state] && <span className="lab-glyph" aria-hidden="true">{STATE_GLYPH[a.state]} </span>}
                  {captionOf(a)}
                  {word && <span className="lab-word">{word}</span>}
                </span>
              </button>
            )
          })}
          {model.visitors.map((v, i) => {
            const n = perRoom.get(v.room) ?? 0
            perRoom.set(v.room, n + 1)
            const at = visitorPoint(v.room, n)
            const place = { left: `${(at.x / MAP.width) * 100}%`, top: `${((at.y + Math.floor(n / 2) * 8) / MAP.height) * 100}%`, zIndex: Math.round(at.y) } satisfies CSSProperties
            return (
              <span key={v.id} className="lab-agent lab-visitor" style={place} data-state={v.state} data-visitor={v.id} role="img" aria-label={`Visitor ${v.name}: ${STATE_WORD[v.state]}. ${v.doing}`} title={`Visiting specialist: ${v.name}. ${v.doing}`}>
                <span className="lab-art"><Mascot shape={VISITOR_SHAPES[i % VISITOR_SHAPES.length]} color="#d9d2c0" /></span>
                <span className="lab-name">{STATE_GLYPH[v.state] && <span className="lab-glyph" aria-hidden="true">{STATE_GLYPH[v.state]} </span>}{v.name}</span>
              </span>
            )
          })}
        </div>
      </div>
      {!compact && (
        <p className="lab-legend">
          <span className="lab-scroll-hint">Scroll the lab sideways to see every room.</span>
          <span>… working</span><span>⇄ fetching</span><span>→ handed off</span><span>✓ done</span><span>✕ failed</span><span>■ cancelled</span><span className="lab-legend-off">faded: not in this run</span>
        </p>
      )}
    </section>
  )
}
