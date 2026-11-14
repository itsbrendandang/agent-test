import { useEffect, useRef, useState } from "react"
import type { Mood } from "@/components/Buddy"
import { CrewSprite } from "./CrewSprite"
import { isDesktop, setCrewOut } from "./desktop"
import { useCrew } from "./store"

const SIZE = 76
// Deliberately few states: stand, stroll, carry a note to a teammate, celebrate.
type Mode = "idle" | "walk" | "deliver" | "cheer"

interface Body {
  x: number; y: number; vx: number; vy: number
  mode: Mode; timer: number; targetX: number; targetY: number; facing: 1 | -1; to?: string
}

const MOOD: Record<Mode, Mood> = { idle: "happy", walk: "happy", deliver: "working", cheer: "happy" }
const DOING: Record<Mode, string> = {
  idle: "Hanging out", walk: "Going for a walk", deliver: "Carrying a note to a teammate", cheer: "Celebrating",
}
const rand = (a: number, b: number) => a + Math.random() * (b - a)

// Transparent full-screen window: the crew roams the desktop and clicks pass through everywhere else.
export function CrewOverlay() {
  const { crew } = useCrew()
  const bodies = useRef(new Map<string, Body>())
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const panelRef = useRef<HTMLDivElement>(null)
  const [modes, setModes] = useState<Record<string, Mode>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const crewRef = useRef(crew)
  crewRef.current = crew

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const ground = () => window.innerHeight - SIZE - 4

    const next = (id: string, b: Body) => {
      const others = crewRef.current.filter((m) => m.id !== id)
      const roll = Math.random()
      const maxX = window.innerWidth - SIZE
      if (roll < 0.45) { b.mode = "walk"; b.targetX = rand(0, maxX) }
      else if (roll < 0.6 && others.length) { b.mode = "deliver"; b.to = others[Math.floor(Math.random() * others.length)].id }
      else { b.mode = "idle"; b.timer = rand(3, 8) }
    }

    let visible = true
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (!visible || document.hidden) { last = now; return }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const g = ground()
      const maxX = window.innerWidth - SIZE
      const changed: Record<string, Mode> = {}
      crewRef.current.forEach((m, i) => {
        let b = bodies.current.get(m.id)
        if (!b) {
          b = { x: 80 + i * 110, y: g, vx: 0, vy: 0, mode: "idle", timer: 0.6 + i * 0.5, targetX: 0, targetY: 0, facing: 1 }
          bodies.current.set(m.id, b)
        }
        const before = b.mode
        if (selectedRef.current !== m.id) {
          const moveTo = (tx: number, speed: number) => {
            const dx = tx - b!.x
            if (Math.abs(dx) < 4) return true
            b!.facing = dx > 0 ? 1 : -1
            b!.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt)
            return false
          }
          switch (b.mode) {
            case "idle": case "cheer": b.timer -= dt; if (b.timer <= 0) next(m.id, b); break
            case "walk": if (moveTo(b.targetX, 60)) { b.mode = "idle"; b.timer = rand(3, 8) } break
            case "deliver": {
              const t = bodies.current.get(b.to ?? "")
              if (!t) { b.mode = "idle"; b.timer = 1; break }
              if (moveTo(t.x + (b.x < t.x ? -SIZE * 0.8 : SIZE * 0.8), 90)) {
                b.mode = "cheer"; b.timer = 1.4
                t.mode = "cheer"; t.timer = 1.4; changed[b.to!] = "cheer"
              }
              break
            }
          }
          b.x = Math.max(0, Math.min(maxX, b.x))
          b.y = g
        }
        if (b.mode !== before) changed[m.id] = b.mode
        const el = nodes.current.get(m.id)
        if (el) {
          el.style.transform = `translate(${b.x}px, ${b.y}px)`
          el.style.setProperty("--face", String(b.facing))
        }
      })
      if (Object.keys(changed).length) setModes((prev) => ({ ...prev, ...changed }))
    }
    raf = requestAnimationFrame(frame)

    // Let clicks through to the desktop unless the pointer is over a character or the panel.
    let ignoring = true
    let poll: ReturnType<typeof setInterval> | undefined
    if (isDesktop) {
      let geo: { x: number; y: number; scale: number } | null = null
      let ticks = 0
      let busy = false
      poll = setInterval(async () => {
        if (busy) return
        busy = true
        try {
        const { getCurrentWindow, cursorPosition } = await import("@tauri-apps/api/window")
        const w = getCurrentWindow()
        // Window geometry and visibility rarely change: refresh them about once a second.
        if (!geo || ticks++ % 12 === 0) {
          const [pos, scale, shown] = await Promise.all([w.outerPosition(), w.scaleFactor(), w.isVisible()])
          geo = { x: pos.x, y: pos.y, scale }
          visible = shown
          document.documentElement.classList.toggle("crew-paused", !shown)
        }
        if (!visible) return
        const cur = await cursorPosition()
        const x = (cur.x - geo.x) / geo.scale, y = (cur.y - geo.y) / geo.scale
        const hit = (r: DOMRect | undefined) => !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
        const over = [...nodes.current.values()].some((n) => hit(n.getBoundingClientRect())) || hit(panelRef.current?.getBoundingClientRect())
        if (over === ignoring) { ignoring = !over; await w.setIgnoreCursorEvents(ignoring) }
        } finally { busy = false }
      }, 80)
    }
    return () => { cancelAnimationFrame(raf); if (poll) clearInterval(poll) }
  }, [])

  const sel = crew.find((m) => m.id === selected)
  const selBody = sel ? bodies.current.get(sel.id) : undefined
  const panelLeft = selBody ? Math.max(12, Math.min(window.innerWidth - 292, selBody.x - 100)) : 0
  const panelBottom = selBody ? window.innerHeight - selBody.y + 14 : 0

  return (
    <div className="crew-overlay">
      {crew.map((m) => {
        const mode = modes[m.id] ?? "idle"
        return (
          <div key={m.id} className="crew-actor" data-mode={mode} ref={(el) => { el ? nodes.current.set(m.id, el) : nodes.current.delete(m.id) }}>
            <button type="button" className="crew-hit" aria-label={`${m.name}, ${m.role}`} aria-expanded={selected === m.id}
              onClick={() => setSelected(selected === m.id ? null : m.id)}>
              <span className="crew-tag">{m.name}</span>
              {mode === "deliver" && <span className="crew-note" aria-hidden="true" />}
              {mode === "cheer" && <span className="crew-heart" aria-hidden="true">♥</span>}
              <span className="crew-flip">
                <CrewSprite member={m} mood={selected === m.id ? "happy" : MOOD[mode]} size={SIZE} />
                <span className="crew-feet" aria-hidden="true"><i /><i /></span>
              </span>
            </button>
          </div>
        )
      })}

      {sel && (
        <div className="crew-panel" ref={panelRef} role="dialog" aria-label={`${sel.name} details`}
          style={{ left: panelLeft, bottom: Math.min(panelBottom, window.innerHeight - 240) }}>
          <header>
            <div>
              <h2>{sel.name}</h2>
              <span className="pill pill-custom">{sel.role}</span>
            </div>
            <button type="button" className="crew-x" aria-label="Close" onClick={() => setSelected(null)}>×</button>
          </header>
          <dl>
            <dt>Task</dt><dd>None yet</dd>
            <dt>Doing</dt><dd>{DOING[modes[sel.id] ?? "idle"]}</dd>
            <dt>Agent</dt><dd>Not connected</dd>
          </dl>
          <p className="muted small">This character is only playing for now. No AI agent is wired to it yet.</p>
          <button type="button" className="toon-btn" onClick={() => { setSelected(null); void setCrewOut(false) }}>Send everyone home</button>
        </div>
      )}
    </div>
  )
}
