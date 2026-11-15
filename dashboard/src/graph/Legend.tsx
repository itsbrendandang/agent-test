import { KIND_COLOUR, KIND_SHAPE, VERDICT_COLOUR, VERDICT_SHAPE, type Shape } from "./style"
import { GLYPH, KIND_LABEL, NODE_KINDS, VERDICT_CLASSES, VERDICT_WORD, type NodeKind } from "./types"

/** A small drawing of a node shape, in the node's colour. Decorative: the text next to it carries the meaning. */
export function ShapeIcon({ shape, colour, size = 16 }: { shape: Shape; colour: string; size?: number }) {
  const common = { fill: colour, stroke: "#14130f", strokeWidth: 1 }
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

const WHAT: Record<NodeKind, string> = {
  run: "the run itself", agent: "a team member or model group", checker: "who ruled on a claim", phase: "a board round or a swarm phase",
  claim: "something an agent asserted", source: "a source an agent kept", test: "a test written down to disprove a claim",
  issue: "a problem a reviewer raised", artifact: "an output file or the decision memo",
}

export function Legend({ kinds }: { kinds: ReadonlySet<NodeKind> }) {
  return (
    <section className="graph-legend" aria-label="Legend">
      <div>
        <h3>Verdicts (claims and tests)</h3>
        <ul>
          {VERDICT_CLASSES.map((v) => (
            <li key={v}><ShapeIcon shape={VERDICT_SHAPE[v]} colour={VERDICT_COLOUR[v]} /><b aria-hidden="true">{GLYPH[v]}</b> {VERDICT_WORD[v]}</li>
          ))}
        </ul>
        <p className="muted small">Shape and glyph carry the verdict, not just colour. Refuted and contested things are drawn larger and always labelled.</p>
      </div>
      <div>
        <h3>Nodes</h3>
        <ul>
          {NODE_KINDS.filter((k) => kinds.has(k)).map((k) => (
            <li key={k}><ShapeIcon shape={KIND_SHAPE[k]} colour={KIND_COLOUR[k]} />{KIND_LABEL[k]}: <span className="muted">{WHAT[k]}</span></li>
          ))}
        </ul>
      </div>
      <div>
        <h3>Lines</h3>
        <p className="muted small">Each line is something the run recorded. An arrow points from the one that acted to the one it acted on (an agent made a claim, a checker ruled on it).</p>
      </div>
    </section>
  )
}
