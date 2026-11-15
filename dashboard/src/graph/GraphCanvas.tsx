// The 3D view. A thin React shell around renderer.ts: it creates the renderer once, hands it the visible nodes and the
// style, and destroys it on unmount. If WebGL is missing, fails to start or is lost, it tells its parent, which shows
// the list instead.
import { useEffect, useRef, useState } from "react"
import { webglAvailable, useReducedMotion } from "./env"
import type { Renderer, Style } from "./renderer"
import { GLYPH, type GraphLink, type GraphNode } from "./types"
import { kindLabel } from "./words"

export interface CanvasProps {
  nodes: readonly GraphNode[]
  links: readonly GraphLink[]
  /** What has happened by the current step of a replay (ids); null shows everything. The nodes keep their places either way. */
  revealed: { nodes: ReadonlySet<string> | null; links: ReadonlySet<string> | null }
  /** Board or swarm, for the words in the hover label. */
  runKind: "board" | "swarm"
  style: Style
  /** Changes when a different run is loaded: the camera fits the new graph. */
  fitKey: string
  /** Fly the camera to a node. `n` changes on every request, so asking twice for the same node works. */
  focus?: { id: string; n: number }
  /** True while the browser tab is hidden. */
  paused: boolean
  summary: string
  onSelect: (id: string | null) => void
  /** Keyboard: move the selection by one in the list order. */
  onStep: (by: 1 | -1) => void
  onUnavailable: (reason: string) => void
}

export function GraphCanvas(p: CanvasProps) {
  const host = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const renderer = useRef<Renderer | undefined>(undefined)
  const latest = useRef(p)
  latest.current = p
  const reduced = useReducedMotion()
  const [ready, setReady] = useState(false)
  const [hover, setHover] = useState<GraphNode | null>(null)
  const hoverId = useRef<string | null>(null)
  const nodesById = useRef(new Map<string, GraphNode>())
  nodesById.current = new Map(p.nodes.map((n) => [n.id, n]))

  useEffect(() => {
    if (!webglAvailable()) { latest.current.onUnavailable("This browser cannot make a WebGL context."); return }
    let stopped = false
    let made: Renderer | undefined
    const el = host.current!
    import("./renderer").then(({ createRenderer }) => {
      if (stopped) return
      try {
        made = createRenderer(el, {
          reducedMotion: reduced,
          onSelect: (id) => latest.current.onSelect(id),
          onHover: (id) => { hoverId.current = id; setHover(id ? nodesById.current.get(id) ?? null : null) },
          onContextLost: () => latest.current.onUnavailable("The graphics context was lost."),
        })
        renderer.current = made
        const box = el.getBoundingClientRect()
        made.resize(Math.max(200, box.width), Math.max(200, box.height))
        setReady(true)
      } catch (e) {
        latest.current.onUnavailable(`The 3D view could not start${e instanceof Error && e.message ? `: ${e.message}` : "."}`)
      }
    }, () => latest.current.onUnavailable("The 3D code could not be loaded."))
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) made?.resize(width, height)
    })
    observer?.observe(el)
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      if (tip.current) tip.current.style.transform = `translate(${Math.round(e.clientX - r.left + 14)}px, ${Math.round(e.clientY - r.top + 14)}px)`
    }
    el.addEventListener("pointermove", move, { passive: true })
    return () => {
      stopped = true
      observer?.disconnect()
      el.removeEventListener("pointermove", move)
      made?.destroy()
      renderer.current = undefined
      setReady(false)
    }
    // The renderer is created once. Reduced motion is read at that moment; later changes apply on the next visit.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (ready) renderer.current?.setData(p.nodes, p.links) }, [ready, p.nodes, p.links])
  useEffect(() => { if (ready) renderer.current?.setReveal(p.revealed.nodes, p.revealed.links) }, [ready, p.revealed, p.nodes, p.links])
  useEffect(() => { if (ready) renderer.current?.setStyle(p.style) }, [ready, p.style])
  useEffect(() => { if (ready) renderer.current?.fit() }, [ready, p.fitKey])
  useEffect(() => { if (ready && p.focus) renderer.current?.fly(p.focus.id) }, [ready, p.focus])
  useEffect(() => { if (ready) renderer.current?.setPaused(p.paused) }, [ready, p.paused])

  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); p.onStep(1) }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); p.onStep(-1) }
    else if (e.key === "Escape") p.onSelect(null)
    else if (e.key === "Enter" && p.style.selected) renderer.current?.fly(p.style.selected)
  }

  return (
    <div className="graph-stage" data-ready={ready || undefined}>
      <div ref={host} className="graph-canvas" tabIndex={0} role="group" aria-roledescription="3D graph" aria-label={p.summary}
        aria-describedby="graph-keys" onKeyDown={key} data-testid="graph-canvas" />
      <p id="graph-keys" className="graph-visually-hidden">
        Drag to orbit, scroll to zoom, right-drag to pan, click a node to select it. With this area focused, the arrow keys move the selection and
        Escape clears it. The same information is in the list view.
      </p>
      <div ref={tip} className="graph-tip" hidden={!hover} aria-hidden="true">
        {hover && <><b>{hover.verdict && (hover.kind === "claim" || hover.kind === "test") ? `${GLYPH[hover.verdict.cls]} ` : ""}{hover.label}</b><span>{kindLabel(hover.kind, p.runKind)}{hover.verdict ? ` · ${hover.verdict.raw}` : ""}</span></>}
      </div>
    </div>
  )
}
