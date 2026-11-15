// The WebGL side, on 3d-force-graph (three.js, MIT). Loaded on demand by GraphCanvas, so the three.js code is a
// separate chunk that is only fetched when this view is opened. Nothing here knows about runs: it draws the nodes
// and links it is given.
//
// GPU rules: pixel ratio is capped at 2. Once the layout has settled and nothing has moved for IDLE_MS the camera drifts
// slowly for DRIFT_MS (never under prefers-reduced-motion), then the render loop is paused. Any pointer, wheel, key or data
// change wakes it. A hidden tab pauses it for good, and nothing runs then.
import ForceGraph3D, { type ForceGraph3DInstance, type NodeObject } from "3d-force-graph"
import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, OctahedronGeometry, SphereGeometry, TetrahedronGeometry, TorusGeometry,
} from "three"
import SpriteText from "three-spritetext"
import { colourOf, LINK_DISTANCE, palette, shapeOf, sizeOf, type Palette, type Shape } from "./style"
import { GLYPH, type GraphLink, type GraphNode } from "./types"

export interface Style {
  selected: string | null
  /** Neighbours of the selected node. With a selection, everything else is dimmed. */
  neighbours: ReadonlySet<string>
  /** Contradicted and refuted things drawn larger and always labelled. */
  emphasis: boolean
  /** The nodes the current step of a replay is about. */
  pulse: ReadonlySet<string>
}
export interface RenderOptions {
  reducedMotion: boolean
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onContextLost: () => void
}
export interface Renderer {
  setData(nodes: readonly GraphNode[], links: readonly GraphLink[]): void
  /** Which nodes and lines have happened yet (a replay). null: all. Hidden ones keep their places in the layout. */
  setReveal(nodes: ReadonlySet<string> | null, links: ReadonlySet<string> | null): void
  setStyle(style: Style): void
  fly(id: string): void
  fit(): void
  setPaused(paused: boolean): void
  resize(width: number, height: number): void
  destroy(): void
}

const IDLE_MS = 2500
const DRIFT_MS = 20_000
/** Looser springs for the lines that tie many nodes together, so those do not collapse into one lump. */
const STRENGTH: Record<string, number> = { involves: 0.15, retrieved: 0.12, replied: 0.2, "in-phase": 0.2, next: 0.5 }
const GEOMETRY: Record<Shape, () => BufferGeometry> = {
  dodecahedron: () => new DodecahedronGeometry(1), capsule: () => new CapsuleGeometry(0.6, 1, 4, 10), cylinder: () => new CylinderGeometry(0.8, 0.8, 1.6, 16),
  torus: () => new TorusGeometry(0.9, 0.3, 10, 24), sphere: () => new SphereGeometry(1, 16, 12), octahedron: () => new OctahedronGeometry(1.25),
  cube: () => new BoxGeometry(1.6, 1.6, 1.6), tetrahedron: () => new TetrahedronGeometry(1.3), cone: () => new ConeGeometry(1, 2, 16), slab: () => new BoxGeometry(2, 0.6, 2),
}
/** Camera distance below which a kind of label starts to fade in (the labels that matter most never fade). */
const FADE_IN: Record<string, number> = { phase: 300, checker: 300, issue: 280, artifact: 280, claim: 190, source: 170, test: 150 }
/** Labels are made when the camera comes close and thrown away when too many exist, so a large graph never holds hundreds of canvases and textures. */
const MAX_LABELS = 100
const SWEEP_MS = 350

interface Sim extends NodeObject { id: string; node: GraphNode; body?: Mesh; halo?: Mesh; label?: SpriteText; holder?: Group }
interface SimLink { source: string; target: string; link: GraphLink }

const labelText = (n: GraphNode) => {
  const text = n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label
  return n.verdict && (n.kind === "claim" || n.kind === "test") ? `${GLYPH[n.verdict.cls]} ${text}` : text
}
const idOf = (end: unknown) => (typeof end === "string" ? end : (end as Sim).id)

export function createRenderer(el: HTMLElement, o: RenderOptions): Renderer {
  const pal: Palette = palette()
  const geometries = new Map<Shape, BufferGeometry>()
  const geometry = (s: Shape) => geometries.get(s) ?? geometries.set(s, GEOMETRY[s]()).get(s)!
  const sims = new Map<string, Sim>()
  const adjacent = new Map<string, Set<string>>()
  const degree = new Map<string, number>()
  let style: Style = { selected: null, neighbours: new Set(), emphasis: true, pulse: new Set() }
  let hover: string | null = null
  let shownNodes: ReadonlySet<string> | null = null, shownLinks: ReadonlySet<string> | null = null
  let destroyed = false, forced = false, asleep = false, settled = false, fitOnSettle = true, drifting = false
  let sleepTimer: ReturnType<typeof setTimeout> | undefined, settleTimer: ReturnType<typeof setTimeout> | undefined, driftTimer: ReturnType<typeof setTimeout> | undefined
  let sweepTimer: ReturnType<typeof setInterval> | undefined

  const graph: ForceGraph3DInstance<Sim> = new ForceGraph3D(el, { controlType: "orbit", rendererConfig: { antialias: true, powerPreference: "low-power" } }) as unknown as ForceGraph3DInstance<Sim>
  const gl = graph.renderer()
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  const onLost = (e: Event) => { e.preventDefault(); o.onContextLost() }
  gl.domElement.addEventListener("webglcontextlost", onLost)
  const controls = graph.controls() as { autoRotate: boolean; autoRotateSpeed: number }

  /** Is this node lit up, given the selection or, without one, the node under the pointer? */
  const lit = (id: string) => {
    if (style.selected !== null) return id === style.selected || style.neighbours.has(id)
    if (hover !== null) return id === hover || (adjacent.get(hover)?.has(id) ?? false)
    return true
  }
  const dimLevel = () => (style.selected !== null ? 0.12 : 0.3)

  const priority = (s: Sim) => s.node.kind === "run" || s.node.kind === "agent" || (style.emphasis && s.node.attention === 2)
  const create = (s: Sim) => {
    const n = s.node
    const holder = new Group()
    const body = new Mesh(geometry(shapeOf(n)), new MeshLambertMaterial({ color: colourOf(n, pal), emissive: colourOf(n, pal), emissiveIntensity: 0.18, transparent: true }))
    holder.add(body)
    s.holder = holder; s.body = body
    paint(s)
    return holder
  }
  const ensureLabel = (s: Sim) => {
    if (s.label || !s.holder) return s.label
    const big = s.node.kind === "agent" || s.node.kind === "run"
    const t = new SpriteText(labelText(s.node), big ? 5.5 : 4.2, s.node.attention === 2 ? "#9c1414" : pal.label)
    t.fontFace = '"Geist Variable", ui-sans-serif, system-ui, sans-serif'
    t.fontWeight = s.node.kind === "agent" || s.node.kind === "run" ? "600" : "400"
    t.material.depthWrite = false
    t.backgroundColor = pal.labelBg
    t.padding = 1.2
    t.borderRadius = 2
    // Labels fade in as the camera comes close, rather than all being there or not. Called by three.js for each frame this label is drawn.
    t.onBeforeRender = (_r, _s, camera) => {
      const near = lit(s.id) && (s.id === style.selected || style.neighbours.has(s.id) || s.id === hover || priority(s))
      const d = Math.hypot(camera.position.x - (s.x ?? 0), camera.position.y - (s.y ?? 0), camera.position.z - (s.z ?? 0))
      const limit = FADE_IN[s.node.kind] ?? 200
      const fade = near ? 1 : Math.max(0, Math.min(1, (limit - d) / (limit * 0.4)))
      t.material.opacity = (lit(s.id) ? 1 : 0.15) * fade
    }
    s.holder.add(t); s.label = t
    return t
  }
  /** Size, opacity, glow and label of one node from the current style. Cheap enough to run for every node on each change. */
  const paint = (s: Sim) => {
    if (!s.holder || !s.body) return
    const n = s.node, on = lit(s.id)
    const pulsed = style.pulse.has(s.id), hot = s.id === hover || s.id === style.selected
    const size = sizeOf(n, style.emphasis, degree.get(s.id) ?? 0) * (pulsed ? 1.5 : hot ? 1.2 : 1)
    s.body.scale.setScalar(size)
    const m = s.body.material as MeshLambertMaterial
    m.opacity = on ? 1 : dimLevel()
    m.emissiveIntensity = hot || pulsed ? 0.7 : 0.18
    const refuted = style.emphasis && n.attention === 2
    const halo = on && (hot || pulsed || refuted)
    if (halo && !s.halo) {
      s.halo = new Mesh(geometry("sphere"), new MeshBasicMaterial({ color: refuted ? pal.verdict.fails : colourOf(n, pal), transparent: true, opacity: 0.2, depthWrite: false }))
      s.holder.add(s.halo)
    }
    if (s.halo) {
      s.halo.visible = halo
      s.halo.scale.setScalar(size * (hot || pulsed ? 2.4 : 2))
      ;(s.halo.material as MeshBasicMaterial).opacity = hot || pulsed ? 0.28 : 0.16
    }
    if (priority(s) || hot || pulsed || (style.selected !== null && lit(s.id))) {
      const t = ensureLabel(s)
      if (t) t.position.y = size + 4.5
    }
  }
  const paintAll = () => { for (const s of sims.values()) paint(s) }

  const disposeLabel = (s: Sim) => {
    if (!s.label) return
    s.holder?.remove(s.label)
    s.label.material.map?.dispose()
    s.label.material.dispose()
    s.label = undefined
  }
  const labelled = () => [...sims.values()].filter((x) => x.label)
  const distance = (s: Sim) => { const c = graph.camera().position; return Math.hypot(c.x - (s.x ?? 0), c.y - (s.y ?? 0), c.z - (s.z ?? 0)) }
  /** While awake: make the labels of nodes the camera has come close to, and drop the ones it has left far behind. */
  const sweep = () => {
    if (destroyed) return
    const have = labelled()
    let count = have.length
    for (const s of sims.values()) {
      if (s.label || !s.holder || (shownNodes !== null && !shownNodes.has(s.id)) || priority(s)) continue
      const limit = FADE_IN[s.node.kind] ?? 200
      if (distance(s) >= limit) continue
      if (count >= MAX_LABELS) {
        const far = have.filter((x) => x.label && !priority(x) && x.id !== style.selected && x.id !== hover && !style.neighbours.has(x.id) && !style.pulse.has(x.id)).sort((a, b) => distance(b) - distance(a))[0]
        if (!far || distance(far) < limit) continue
        disposeLabel(far); have.splice(have.indexOf(far), 1); count--
      }
      ensureLabel(s); count++
    }
  }

  const linkTouches = (l: unknown, id: string | null) => id !== null && (idOf((l as SimLink).source) === id || idOf((l as SimLink).target) === id)
  const linkColour = (l: unknown) => {
    const a = idOf((l as SimLink).source), b = idOf((l as SimLink).target)
    if (style.selected !== null) return linkTouches(l, style.selected) ? pal.lineHot : pal.lineDim
    if (hover !== null) return linkTouches(l, hover) ? pal.lineHot : pal.lineDim
    if (style.emphasis && (sims.get(a)?.node.attention === 2 || sims.get(b)?.node.attention === 2)) return pal.lineRefuted
    return pal.line
  }
  const linkWidth = (l: unknown) => (linkTouches(l, style.selected ?? hover) ? 1.4 : 0.45)
  const refreshLinks = () => { graph.linkColor(linkColour).linkWidth(linkWidth).linkDirectionalArrowColor(linkColour) }

  graph
    .backgroundColor(pal.background).showNavInfo(false).enableNodeDrag(false)
    .nodeId("id").nodeLabel(() => "") // our own hover label (text, never HTML) replaces the library's
    .nodeThreeObject((n) => create(n as Sim))
    .nodeVisibility((n) => shownNodes === null || shownNodes.has((n as Sim).id))
    .linkVisibility((l) => shownLinks === null || shownLinks.has((l as unknown as SimLink).link.id))
    .linkOpacity(0.6).linkDirectionalArrowLength(2.4).linkDirectionalArrowRelPos(0.96)
  refreshLinks()
  graph
    .d3VelocityDecay(0.3)
    .onNodeHover((n) => {
      const id = n ? (n as Sim).id : null
      if (id === hover) return
      hover = id
      paintAll(); refreshLinks(); wake()
      o.onHover(id); el.style.cursor = id ? "pointer" : ""
    })
    .onNodeClick((n) => o.onSelect((n as Sim).id))
    .onBackgroundClick(() => o.onSelect(null))
  if (o.reducedMotion) graph.warmupTicks(400).cooldownTicks(0)
  else graph.warmupTicks(60).cooldownTime(3500)
  graph.d3Force("charge")?.strength((n: unknown) => -24 - sizeOf((n as Sim).node, false, degree.get((n as Sim).id) ?? 0) * 5)
  // A light pull towards the middle keeps loosely connected nodes (a checker that ruled on two claims) from drifting far
  // away, which would make the whole graph small after the camera fits it.
  let pulled: Sim[] = []
  const gravity = Object.assign((alpha: number) => { for (const n of pulled) { const k = 0.06 * alpha; n.vx = (n.vx ?? 0) - (n.x ?? 0) * k; n.vy = (n.vy ?? 0) - (n.y ?? 0) * k; n.vz = (n.vz ?? 0) - (n.z ?? 0) * k } }, { initialize: (nodes: Sim[]) => { pulled = nodes } })
  graph.d3Force("gravity", gravity as never)
  const linkForce = graph.d3Force("link") as { distance?: (f: (l: unknown) => number) => void; strength?: (f: (l: unknown) => number) => void } | undefined
  const kindOf = (l: unknown) => (l as SimLink).link.kind
  linkForce?.distance?.((l) => LINK_DISTANCE[kindOf(l)] ?? 40)
  linkForce?.strength?.((l) => STRENGTH[kindOf(l)] ?? 0.7)

  // Awake -> (idle, settled) -> drift for DRIFT_MS -> asleep (render loop paused, no frames at all).
  function wake() {
    if (destroyed || forced) return
    controls.autoRotate = false; drifting = false
    clearTimeout(driftTimer)
    if (asleep) { graph.resumeAnimation(); asleep = false }
    clearTimeout(sleepTimer)
    sleepTimer = setTimeout(idle, IDLE_MS)
    if (sweepTimer === undefined) sweepTimer = setInterval(sweep, SWEEP_MS)
  }
  function idle() {
    if (destroyed || asleep) return
    if (!settled) { sleepTimer = setTimeout(idle, IDLE_MS); return }
    if (o.reducedMotion || drifting) return sleep()
    drifting = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.45
    driftTimer = setTimeout(sleep, DRIFT_MS)
  }
  function sleep() {
    if (destroyed || asleep) return
    controls.autoRotate = false; drifting = false
    graph.pauseAnimation(); asleep = true
    clearInterval(sweepTimer); sweepTimer = undefined
  }
  const settle = () => {
    settled = true
    clearTimeout(settleTimer)
    if (fitOnSettle) { fitOnSettle = false; graph.zoomToFit(o.reducedMotion ? 0 : 600, 24) }
    wake()
  }
  graph.onEngineStop(settle)

  const events = ["pointerdown", "pointermove", "wheel", "touchstart", "keydown"] as const
  for (const e of events) el.addEventListener(e, wake, { passive: true })

  return {
    setData(nodes, links) {
      const keep = new Set<string>()
      const list: Sim[] = nodes.map((n) => {
        keep.add(n.id)
        const old = sims.get(n.id)
        if (old) { old.node = n; return old }
        const s: Sim = { id: n.id, node: n }
        sims.set(n.id, s)
        return s
      })
      for (const id of [...sims.keys()]) if (!keep.has(id)) sims.delete(id)
      adjacent.clear(); degree.clear()
      for (const l of links) {
        for (const [a, b] of [[l.source, l.target], [l.target, l.source]] as const) {
          (adjacent.get(a) ?? adjacent.set(a, new Set()).get(a)!).add(b); degree.set(a, (degree.get(a) ?? 0) + 1)
        }
      }
      const l: SimLink[] = links.map((x) => ({ source: x.source, target: x.target, link: x }))
      settled = false
      clearTimeout(settleTimer)
      settleTimer = setTimeout(settle, 8000) // in case the layout engine never reports that it stopped
      wake()
      graph.graphData({ nodes: list, links: l as never })
      paintAll()
    },
    setReveal(nodes, links) {
      shownNodes = nodes; shownLinks = links
      graph.nodeVisibility((n) => shownNodes === null || shownNodes.has((n as Sim).id)).linkVisibility((x) => shownLinks === null || shownLinks.has((x as unknown as SimLink).link.id))
      wake()
    },
    setStyle(next) {
      style = next
      paintAll(); refreshLinks()
      wake()
    },
    fly(id) {
      const s = sims.get(id)
      if (!s || s.x === undefined) return
      wake()
      const { x = 0, y = 0, z = 0 } = s
      const distance = 110 + sizeOf(s.node, style.emphasis, degree.get(id) ?? 0) * 6, len = Math.hypot(x, y, z)
      const ms = o.reducedMotion ? 0 : 900
      if (len < 1) graph.cameraPosition({ x, y, z: z + distance }, { x, y, z }, ms)
      else graph.cameraPosition({ x: x * (1 + distance / len), y: y * (1 + distance / len), z: z * (1 + distance / len) }, { x, y, z }, ms)
    },
    fit() { fitOnSettle = true; if (settled) settle(); else wake() },
    setPaused(paused) {
      forced = paused
      if (paused) { clearTimeout(sleepTimer); clearTimeout(driftTimer); sleep() } else wake()
    },
    resize(w, h) { graph.width(w).height(h); wake() },
    destroy() {
      if (destroyed) return
      destroyed = true
      clearTimeout(sleepTimer); clearTimeout(settleTimer); clearTimeout(driftTimer); clearInterval(sweepTimer); sweepTimer = undefined
      for (const e of events) el.removeEventListener(e, wake)
      gl.domElement.removeEventListener("webglcontextlost", onLost)
      graph.pauseAnimation()
      graph.scene().traverse((obj) => {
        const mat = (obj as Mesh).material
        const free = (m: { dispose?: () => void; map?: { dispose?: () => void } | null } | undefined) => { m?.map?.dispose?.(); m?.dispose?.() }
        if (Array.isArray(mat)) mat.forEach(free); else free(mat as Parameters<typeof free>[0])
      })
      for (const g of geometries.values()) g.dispose()
      graph._destructor()
      gl.forceContextLoss()
      gl.domElement.remove()
      sims.clear(); adjacent.clear(); degree.clear()
    },
  }
}
