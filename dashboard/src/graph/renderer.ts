// The WebGL side, on 3d-force-graph (three.js, MIT). Loaded on demand by GraphCanvas, so the three.js code is a
// separate chunk that is only fetched when this view is opened. Nothing here knows about runs: it draws the nodes
// and links it is given.
//
// GPU rules: pixel ratio is capped at 2; once the layout has settled and nothing has moved for IDLE_MS the render
// loop is paused, and any pointer, wheel, key or data change wakes it; a hidden tab pauses it for good.
import ForceGraph3D, { type ForceGraph3DInstance, type NodeObject } from "3d-force-graph"
import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group, Mesh,
  MeshLambertMaterial, OctahedronGeometry, SphereGeometry, TetrahedronGeometry, TorusGeometry,
} from "three"
import SpriteText from "three-spritetext"
import { BACKGROUND, colourOf, LINK_DISTANCE, shapeOf, sizeOf, type Shape } from "./style"
import { GLYPH, type GraphLink, type GraphNode } from "./types"

export interface Style {
  selected: string | null
  /** Neighbours of the selected node. With a selection, everything else is dimmed. */
  neighbours: ReadonlySet<string>
  /** Refuted and contested things drawn larger and always labelled. */
  emphasis: boolean
}
export interface RenderOptions {
  reducedMotion: boolean
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onContextLost: () => void
}
export interface Renderer {
  setData(nodes: readonly GraphNode[], links: readonly GraphLink[]): void
  setStyle(style: Style): void
  fly(id: string): void
  fit(): void
  setPaused(paused: boolean): void
  resize(width: number, height: number): void
  destroy(): void
}

const IDLE_MS = 2500
/** Looser springs for the lines that tie many nodes together, so those do not collapse into one lump. */
const STRENGTH: Record<string, number> = { involves: 0.15, retrieved: 0.12, replied: 0.2, "in-phase": 0.2, next: 0.5 }
const GEOMETRY: Record<Shape, () => BufferGeometry> = {
  dodecahedron: () => new DodecahedronGeometry(1), capsule: () => new CapsuleGeometry(0.6, 1, 4, 10), cylinder: () => new CylinderGeometry(0.8, 0.8, 1.6, 16),
  torus: () => new TorusGeometry(0.9, 0.3, 10, 24), sphere: () => new SphereGeometry(1, 16, 12), octahedron: () => new OctahedronGeometry(1.25),
  cube: () => new BoxGeometry(1.6, 1.6, 1.6), tetrahedron: () => new TetrahedronGeometry(1.3), cone: () => new ConeGeometry(1, 2, 16), slab: () => new BoxGeometry(2, 0.6, 2),
}

interface Sim extends NodeObject { id: string; node: GraphNode; body?: Mesh; glow?: Mesh; label?: SpriteText; holder?: Group }
interface SimLink { source: string; target: string; link: GraphLink }

const ALWAYS_LABEL = new Set(["run", "agent", "checker", "phase"])
const labelText = (n: GraphNode) => {
  const text = n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label
  return n.verdict && (n.kind === "claim" || n.kind === "test") ? `${GLYPH[n.verdict.cls]} ${text}` : text
}

export function createRenderer(el: HTMLElement, o: RenderOptions): Renderer {
  const geometries = new Map<Shape, BufferGeometry>()
  const geometry = (s: Shape) => geometries.get(s) ?? geometries.set(s, GEOMETRY[s]()).get(s)!
  const sims = new Map<string, Sim>()
  let style: Style = { selected: null, neighbours: new Set(), emphasis: true }
  let destroyed = false, forced = false, asleep = false, settled = false, fitOnSettle = true
  let sleepTimer: ReturnType<typeof setTimeout> | undefined, settleTimer: ReturnType<typeof setTimeout> | undefined

  const graph: ForceGraph3DInstance<Sim> = new ForceGraph3D(el, { controlType: "orbit", rendererConfig: { antialias: true, powerPreference: "low-power" } }) as unknown as ForceGraph3DInstance<Sim>
  const gl = graph.renderer()
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  const onLost = (e: Event) => { e.preventDefault(); o.onContextLost() }
  gl.domElement.addEventListener("webglcontextlost", onLost)

  const dimmed = (s: Sim) => style.selected !== null && s.id !== style.selected && !style.neighbours.has(s.id)
  const touches = (l: SimLink | GraphLink) => {
    const a = typeof l.source === "string" ? l.source : (l.source as Sim).id, b = typeof l.target === "string" ? l.target : (l.target as Sim).id
    return { a, b }
  }
  const linkNode = (l: unknown) => (l as { link: GraphLink }).link

  const create = (s: Sim) => {
    const n = s.node
    const holder = new Group()
    const body = new Mesh(geometry(shapeOf(n)), new MeshLambertMaterial({ color: colourOf(n), emissive: colourOf(n), emissiveIntensity: 0.35, transparent: true }))
    holder.add(body)
    s.holder = holder; s.body = body
    paint(s)
    return holder
  }
  /** Size, opacity and label of one node, from the current style. Cheap enough to run for every node on each change. */
  const paint = (s: Sim) => {
    if (!s.holder || !s.body) return
    const n = s.node, dim = dimmed(s)
    const size = sizeOf(n, style.emphasis)
    s.body.scale.setScalar(size)
    const m = s.body.material as MeshLambertMaterial
    m.opacity = dim ? 0.1 : 1
    m.emissiveIntensity = n.attention === 2 && style.emphasis ? 0.8 : s.id === style.selected ? 0.9 : 0.35
    const showGlow = style.emphasis && n.attention === 2 && !dim
    if (showGlow && !s.glow) {
      s.glow = new Mesh(geometry("sphere"), new MeshLambertMaterial({ color: "#ff5a6e", emissive: "#ff5a6e", transparent: true, opacity: 0.16, depthWrite: false }))
      s.holder.add(s.glow)
    }
    if (s.glow) { s.glow.visible = showGlow; s.glow.scale.setScalar(size * 2.1) }
    const near = s.id === style.selected || style.neighbours.has(s.id)
    const want = !dim && (near || ALWAYS_LABEL.has(n.kind) || (style.emphasis && n.attention === 2))
    if (want && !s.label) {
      const t = new SpriteText(labelText(n), 4.2, n.attention === 2 ? "#ffb3bd" : "#f4f1e6")
      t.fontFace = "ui-sans-serif, system-ui, sans-serif"
      t.material.depthWrite = false
      t.backgroundColor = "rgba(20,19,15,0.55)"
      t.padding = 1
      s.holder.add(t); s.label = t
    }
    if (s.label) {
      s.label.visible = want
      s.label.position.y = size + 5
      s.label.material.opacity = 1
    }
  }

  const linkColour = (l: unknown) => {
    const { a, b } = touches(l as SimLink)
    const hot = style.selected !== null && (a === style.selected || b === style.selected)
    if (style.selected !== null) return hot ? "#ffd23f" : "#2a2822"
    if (style.emphasis && (sims.get(a)?.node.attention === 2 || sims.get(b)?.node.attention === 2)) return "#c4475a"
    return "#8f8b7c"
  }
  const linkWidth = (l: unknown) => {
    const { a, b } = touches(l as SimLink)
    return style.selected !== null && (a === style.selected || b === style.selected) ? 1.6 : 0.5
  }

  graph
    .backgroundColor(BACKGROUND).showNavInfo(false).enableNodeDrag(false)
    .nodeId("id").nodeLabel(() => "") // our own hover label (text, never HTML) replaces the library's
    .nodeThreeObject((n) => create(n as Sim))
    .linkColor(linkColour).linkWidth(linkWidth).linkOpacity(0.7).linkDirectionalArrowLength(2.6).linkDirectionalArrowRelPos(0.96)
    .linkDirectionalArrowColor(linkColour)
    .d3VelocityDecay(0.3)
    .onNodeHover((n) => { o.onHover(n ? (n as Sim).id : null); el.style.cursor = n ? "pointer" : "" })
    .onNodeClick((n) => o.onSelect((n as Sim).id))
    .onBackgroundClick(() => o.onSelect(null))
  if (o.reducedMotion) graph.warmupTicks(400).cooldownTicks(0)
  else graph.warmupTicks(60).cooldownTime(3500)
  graph.d3Force("charge")?.strength((n: unknown) => -24 - sizeOf((n as Sim).node, false) * 5)
  const linkForce = graph.d3Force("link") as { distance?: (f: (l: unknown) => number) => void; strength?: (f: (l: unknown) => number) => void } | undefined
  linkForce?.distance?.((l) => LINK_DISTANCE[linkNode(l).kind] ?? 40)
  linkForce?.strength?.((l) => (STRENGTH[linkNode(l).kind] ?? 0.7))

  const wake = () => {
    if (destroyed || forced) return
    if (asleep) { graph.resumeAnimation(); asleep = false }
    clearTimeout(sleepTimer)
    sleepTimer = setTimeout(trySleep, IDLE_MS)
  }
  const trySleep = () => {
    if (destroyed || asleep) return
    if (!settled) { sleepTimer = setTimeout(trySleep, IDLE_MS); return }
    graph.pauseAnimation(); asleep = true
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
      const l: SimLink[] = links.map((x) => ({ source: x.source, target: x.target, link: x }))
      settled = false
      clearTimeout(settleTimer)
      settleTimer = setTimeout(settle, 8000) // in case the layout engine never reports that it stopped
      wake()
      graph.graphData({ nodes: list, links: l as never })
      for (const s of list) paint(s)
    },
    setStyle(next) {
      style = next
      for (const s of sims.values()) paint(s)
      graph.linkColor(linkColour).linkWidth(linkWidth).linkDirectionalArrowColor(linkColour)
      wake()
    },
    fly(id) {
      const s = sims.get(id)
      if (!s || s.x === undefined) return
      wake()
      const { x = 0, y = 0, z = 0 } = s
      const distance = 110 + sizeOf(s.node, style.emphasis) * 8, len = Math.hypot(x, y, z)
      const ms = o.reducedMotion ? 0 : 900
      if (len < 1) graph.cameraPosition({ x, y, z: z + distance }, { x, y, z }, ms)
      else graph.cameraPosition({ x: x * (1 + distance / len), y: y * (1 + distance / len), z: z * (1 + distance / len) }, { x, y, z }, ms)
    },
    fit() { fitOnSettle = true; if (settled) settle(); else wake() },
    setPaused(paused) {
      forced = paused
      if (paused) { clearTimeout(sleepTimer); if (!asleep) { graph.pauseAnimation(); asleep = true } } else wake()
    },
    resize(w, h) { graph.width(w).height(h); wake() },
    destroy() {
      if (destroyed) return
      destroyed = true
      clearTimeout(sleepTimer); clearTimeout(settleTimer)
      for (const e of events) el.removeEventListener(e, wake)
      gl.domElement.removeEventListener("webglcontextlost", onLost)
      graph.pauseAnimation()
      graph.scene().traverse((obj) => {
        const mat = (obj as Mesh).material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose()); else (mat as { dispose?: () => void } | undefined)?.dispose?.()
      })
      for (const g of geometries.values()) g.dispose()
      graph._destructor()
      gl.forceContextLoss()
      gl.domElement.remove()
      sims.clear()
    },
  }
}
