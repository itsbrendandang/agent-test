import { KIND_SHAPE, palette, VERDICT_SHAPE, type Shape } from "../design/graph"
import { FLAG, GLYPH, NODE_KINDS, VERDICT_CLASSES, type NodeKind, type RunKind } from "./types"
import { GROUP_WORD, KIND_TECH, KIND_WHAT, kindLabel, LEGEND_SENTENCES } from "./words"

/** A small drawing of a node shape, in the node's colour. Decorative: the text next to it carries the meaning. */
export function ShapeIcon({ shape, colour, size = 16 }: { shape: Shape; colour: string; size?: number }) {
  const common = { fill: colour, stroke: "var(--dark-text, #1b1a17)", strokeWidth: 1 }
  const body = {
    sphere: <circle cx="8" cy="8" r="6" {...common} />,
    cube: <rect x="2.5" y="2.5" width="11" height="11" {...common} />,
    octahedron: <polygon points="8,1 15,8 8,15 1,8" {...common} />,
    dodecahedron: <polygon points="8,1 14,5 12.5,13 3.5,13 2,5" {...common} />,
    capsule: <rect x="4" y="1.5" width="8" height="13" rx="4" {...common} />,
    cylinder: <><rect x="3" y="4" width="10" height="9" {...common} /><ellipse cx="8" cy="4" rx="5" ry="2.2" {...common} /></>,
    torus: <circle cx="8" cy="8" r="5" fill="none" stroke={colour} strokeWidth="3" />,
    tetrahedron: <polygon points="8,1.5 14.5,13.5 1.5,13.5" {...common} />,
    cone: <polygon points="8,1 13.5,14 2.5,14" {...common} />,
    slab: <polygon points="1,9 8,5 15,9 8,13" {...common} />,
  }[shape]
  return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">{body}</svg>
}

const KEY_KINDS: readonly NodeKind[] = ["agent", "claim", "checker", "test", "source"]
const FLAG_WHAT = "A source with a published notice: red for a retraction, amber for a correction or an expression of concern. Its panel says what was wrong and links the notice."

/** Three or four words you can read the picture with. The full key is one click away. */
export function Key({ kinds, runKind, open, onToggle, flagged = false, lanes }: { kinds: ReadonlySet<NodeKind>; runKind: RunKind; open: boolean; onToggle: () => void; /** Some shown source has a published retraction or correction. */ flagged?: boolean; /** The stages, when the picture has lanes. */ lanes?: readonly string[] }) {
  const { kind: KIND_COLOUR, verdict: VERDICT_COLOUR } = palette()
  const shown = KEY_KINDS.filter((k) => kinds.has(k))
  return (
    <div className="graph-key" role="group" aria-label="Key">
      {shown.map((k) => (
        <span key={k} title={`${KIND_WHAT[k]} (technical term: ${KIND_TECH[k]})`}><ShapeIcon shape={KIND_SHAPE[k]} colour={k === "claim" ? VERDICT_COLOUR.holds : KIND_COLOUR[k]} size={14} />{kindLabel(k, runKind)}</span>
      ))}
      <span title="A statement's shape and glyph show what its check found"><span aria-hidden="true">{GLYPH.holds} {GLYPH.fails} {GLYPH.unknown}</span> supported · contradicted · insufficient evidence or not checked</span>
      {flagged && <span title={FLAG_WHAT}><ShapeIcon shape={KIND_SHAPE.source} colour={VERDICT_COLOUR.fails} size={14} /><span aria-hidden="true">{FLAG}</span> source retracted or corrected</span>}
      {lanes && lanes.length > 0 && <span title={lanes.map((l, i) => `${i + 1}. ${l}`).join("; ")}>one column per stage, left to right</span>}
      <button type="button" className="graph-linkbtn" aria-expanded={open} aria-controls="graph-full-key" onClick={onToggle}>{open ? "Hide the full key" : "Full key"}</button>
    </div>
  )
}

export function FullKey({ kinds, runKind, flagged = false, lanes }: { kinds: ReadonlySet<NodeKind>; runKind: RunKind; flagged?: boolean; lanes?: readonly string[] }) {
  const { kind: KIND_COLOUR, verdict: VERDICT_COLOUR } = palette()
  return (
    <section className="graph-legend" id="graph-full-key" aria-label="Full key">
      <div>
        <h3>Statements and tests</h3>
        <ul>
          {VERDICT_CLASSES.map((v) => (
            <li key={v}><ShapeIcon shape={VERDICT_SHAPE[v]} colour={VERDICT_COLOUR[v]} /><b aria-hidden="true">{GLYPH[v]}</b> {GROUP_WORD[v]}</li>
          ))}
        </ul>
        <p className="muted small">{LEGEND_SENTENCES[runKind]}</p>
        <p className="muted small">Shape and glyph carry the verdict, not just colour. Contradicted statements are drawn larger, with a halo, and always labelled.</p>
      </div>
      <div>
        <h3>Nodes</h3>
        <ul>
          {NODE_KINDS.filter((k) => kinds.has(k)).map((k) => (
            <li key={k}><ShapeIcon shape={KIND_SHAPE[k]} colour={KIND_COLOUR[k]} /><span><b>{kindLabel(k, runKind)}</b>: {KIND_WHAT[k]} <span className="muted" title="the technical term">({KIND_TECH[k]})</span></span></li>
          ))}
          {flagged && <>
            <li><ShapeIcon shape={KIND_SHAPE.source} colour={VERDICT_COLOUR.fails} /><span><b><span aria-hidden="true">{FLAG} </span>Retracted source</b>: an article that was retracted. A retracted article cannot support a statement.</span></li>
            <li><ShapeIcon shape={KIND_SHAPE.source} colour={VERDICT_COLOUR.unknown} /><span><b><span aria-hidden="true">{FLAG} </span>Corrected source</b>: an article with a published correction or an expression of concern. Read the corrected version.</span></li>
          </>}
        </ul>
      </div>
      <div>
        <h3>Lines and size</h3>
        <p className="muted small">Each line is something the run recorded. An arrow points from the one that acted to the one it acted on: a member wrote down a claim, a checker ruled on it. A node is bigger the more lines it has.</p>
        <p className="muted small">Zoom in on a node and its label fades in. Hover to light up what it is connected to.</p>
        {lanes && lanes.length > 0 && <>
          <h3>Stages</h3>
          <p className="muted small">The picture reads left to right, one column per stage. Each stage's statements and sources sit in its column; team members and checkers work across stages, so they sit between them.</p>
          <ol className="graph-stages small">{lanes.map((l) => <li key={l}>{l}</li>)}</ol>
        </>}
      </div>
    </section>
  )
}
