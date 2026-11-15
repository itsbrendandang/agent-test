import { useMemo } from "react"
import { hasCard } from "@/lab/agentFocus"
import { agentLink, logLink } from "@/lib/links"
import { LABEL } from "@/nav"
import { safeUrl } from "./model"
import { connectionsOf } from "./view"
import type { GraphLink, GraphModel, GraphNode } from "./types"
import { VerdictPill } from "./VerdictPill"
import { KIND_TECH, KIND_WHAT, kindLabel } from "./words"

/** Details of the selected node. All run text is rendered as text. */
export function NodePanel({ node, nodes, links, model, onSelect, onOpenRun, onClose }: {
  node: GraphNode; nodes: readonly GraphNode[]; links: readonly GraphLink[]; model: GraphModel
  onSelect: (id: string) => void; onOpenRun: () => void; onClose: () => void
}) {
  const conns = useMemo(() => connectionsOf(node.id, nodes, links), [node.id, nodes, links])
  const href = node.url ? safeUrl(node.url) : undefined
  const where = model.kind === "swarm" ? LABEL.Compare : LABEL.Board // the on-screen names, not the view keys
  // A team member of a review: its messages in the Agent Log and its card in Agents. (A benchmark run's agent nodes are
  // model groups, not roles, so they have neither.)
  const member = model.kind === "board" && node.kind === "agent" && node.id.startsWith("agent:") ? node.id.slice("agent:".length) : undefined
  return (
    <aside className="graph-panel graph-sheet" aria-label="Selected node" data-testid="node-panel">
      <span className="graph-sheet-handle" aria-hidden="true" />
      <header>
        <span className="graph-eyebrow" title={`${KIND_WHAT[node.kind]} (technical term: ${KIND_TECH[node.kind]})`}>{kindLabel(node.kind, model.kind)} <span className="muted">· {KIND_TECH[node.kind]}</span></span>
        <button type="button" className="btn" onClick={onClose} aria-label="Clear selection">Clear</button>
      </header>
      <h2>{node.verdict && (node.kind === "claim" || node.kind === "test") && <VerdictPill verdict={node.verdict} />}{" "}{node.label}</h2>
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
      {member && (
        <p className="graph-agent-links">
          <a href={logLink({ kind: "board", id: model.runId }, member)}>{node.label}'s messages in the Agent Log</a>
          {hasCard(member) && <> · <a href={agentLink(member, "board")}>About this agent</a></>}
        </p>
      )}
      <button type="button" className="btn btn-primary" onClick={onOpenRun}>Open this run in {where}</button>
      <a className="btn" href={logLink({ kind: model.kind, id: model.runId })}>Open in the Agent Log</a>
    </aside>
  )
}
