import { useMemo } from "react"
import { safeUrl } from "./model"
import { connectionsOf } from "./view"
import { GLYPH, KIND_LABEL, type GraphLink, type GraphModel, type GraphNode } from "./types"

/** Details of the selected node. All run text is rendered as text. */
export function NodePanel({ node, nodes, links, model, onSelect, onOpenRun, onClose }: {
  node: GraphNode; nodes: readonly GraphNode[]; links: readonly GraphLink[]; model: GraphModel
  onSelect: (id: string) => void; onOpenRun: () => void; onClose: () => void
}) {
  const conns = useMemo(() => connectionsOf(node.id, nodes, links), [node.id, nodes, links])
  const href = node.url ? safeUrl(node.url) : undefined
  const where = model.kind === "swarm" ? "Compare" : "Board"
  return (
    <aside className="graph-panel" aria-label="Selected node" data-testid="node-panel">
      <header>
        <span className="graph-eyebrow">{KIND_LABEL[node.kind]}</span>
        <button type="button" className="btn" onClick={onClose} aria-label="Clear selection">Clear</button>
      </header>
      <h2>{node.verdict && (node.kind === "claim" || node.kind === "test") && <span className={`graph-v graph-v-${node.verdict.cls}`}><span aria-hidden="true">{GLYPH[node.verdict.cls]}</span> {node.verdict.raw}</span>}{" "}{node.label}</h2>
      {node.text && node.text !== node.label && <p className="graph-text">{node.text}</p>}
      {href && <p className="small"><a href={href} target="_blank" rel="noreferrer noopener">Open the source</a> <span className="muted">({href})</span></p>}
      {node.facts.length > 0 && (
        <dl className="graph-facts">
          {node.facts.map((f, i) => <div key={`${f.label}${i}`}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
        </dl>
      )}
      {node.activity.length > 0 && (
        <details open={node.activity.length <= 6}>
          <summary>What it did ({node.activity.length})</summary>
          <ol className="graph-activity">{node.activity.map((a, i) => <li key={i}><b>{a.label}</b> <span>{a.text}</span></li>)}</ol>
        </details>
      )}
      <h3>Connections ({conns.length})</h3>
      <ul className="graph-conns">
        {conns.map((c) => (
          <li key={c.link.id}><button type="button" className="graph-linkbtn" onClick={() => onSelect(c.other.id)}>{c.sentence}</button></li>
        ))}
        {conns.length === 0 && <li className="muted">No recorded connections at this step.</li>}
      </ul>
      <button type="button" className="btn btn-primary" onClick={onOpenRun}>Open this run in {where}</button>
    </aside>
  )
}
