// The 3D view of one structure: 3Dmol.js (BSD-3-Clause), loaded only when a structure is opened. A cartoon coloured by
// pLDDT; drag to turn, scroll or pinch to zoom. Without WebGL it says so.
import { useEffect, useRef, useState } from "react"
import { colorOf } from "./plddt"

type Atom = { b?: number }
type Viewer = { addModel(data: string, format: string): unknown; setStyle(sel: object, style: object): void; zoomTo(): void; render(): void; resize(): void; clear(): void; spin(on: boolean | string): void }
type Lib = { createViewer(element: HTMLElement, config?: object): Viewer }

export default function Viewer3D({ pdb, label }: { pdb: string; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    let viewer: Viewer | undefined, gone = false
    const el = box.current
    if (!el) return
    void (async () => {
      try {
        const mod = (await import("3dmol")) as unknown as Lib & { default?: Lib }
        const lib = typeof mod.createViewer === "function" ? mod : mod.default
        if (gone || !lib) return
        viewer = lib.createViewer(el, { backgroundColor: "white", antialias: true })
        viewer.addModel(pdb, "pdb")
        viewer.setStyle({}, { cartoon: { colorfunc: (atom: Atom) => colorOf(atom.b ?? 0) } })
        viewer.zoomTo()
        viewer.render()
      } catch {
        if (!gone) setFailed("The 3D view could not start in this browser (it needs WebGL).")
      }
    })()
    const resize = new ResizeObserver(() => { try { viewer?.resize(); viewer?.render() } catch { /* closed */ } })
    resize.observe(el)
    return () => { gone = true; resize.disconnect(); try { viewer?.clear() } catch { /* closed */ } el.replaceChildren() }
  }, [pdb])
  if (failed) return <p className="structure-error" role="alert">{failed}</p>
  return <div ref={box} className="structure-canvas" role="img" aria-label={`3D structure of ${label}, coloured by confidence. Drag to turn it; scroll to zoom.`} />
}
