// The same graph as a table, for people who cannot use the 3D canvas: keyboard, screen reader, no WebGL. It shows
// the nodes that are visible under the current filters and step, in the same order, and marks the selected one.
import { useMemo } from "react"
import { FLAG, type GraphLink, type GraphNode, type RunKind } from "./types"
import { VerdictPill } from "./VerdictPill"
import { kindLabel } from "./words"

const cut = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function GraphList({ nodes, links, selected, onSelect, order, runKind }: {
  runKind: RunKind; nodes: readonly GraphNode[]; links: readonly GraphLink[]; selected: string | null; onSelect: (id: string) => void; order: readonly GraphNode[]
}) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const around = useMemo(() => {
    const m = new Map<string, { id: string; text: string }[]>()
    const add = (id: string, other: GraphNode, text: string) => { (m.get(id) ?? m.set(id, []).get(id)!).push({ id: other.id, text }) }
    for (const l of links) {
      const a = byId.get(l.source), b = byId.get(l.target)
      if (!a || !b) continue
      add(a.id, b, `${l.label} ${cut(b.label, 40)}`)
      add(b.id, a, `${cut(a.label, 40)} ${l.label} this`)
    }
    return m
  }, [links, byId])
  if (order.length === 0) return <p className="muted graph-list-empty">Nothing to list at this step and with these filters.</p>
  return (
    <div className="graph-list">
      <table aria-label="Nodes of the graph and their connections">
        <caption className="graph-visually-hidden">{order.length} nodes. Refuted and contested ones come first when that emphasis is on. Choose a name to select it; the side panel shows its details.</caption>
        <thead><tr><th scope="col">Kind</th><th scope="col">Verdict</th><th scope="col">Name</th><th scope="col">Connections</th></tr></thead>
        <tbody>
          {order.map((n) => {
            const conns = around.get(n.id) ?? []
            return (
              <tr key={n.id} data-selected={n.id === selected || undefined} data-attention={n.attention || undefined}>
                <td>{kindLabel(n.kind, runKind)}</td>
                <td>{n.verdict && (n.kind === "claim" || n.kind === "test") ? <VerdictPill verdict={n.verdict} technical={false} /> : n.flag ? <span className="pill" data-kind={n.flag.type === "retraction" ? "danger" : "warning"}>{FLAG} {n.flag.type === "retraction" ? "retracted" : n.flag.type === "correction" ? "corrected" : "concern"}</span> : <span className="muted">–</span>}</td>
                <th scope="row">
                  <button type="button" className="graph-linkbtn" aria-pressed={n.id === selected} onClick={() => onSelect(n.id)}>{cut(n.label, 110)}</button>
                </th>
                <td>
                  {conns.length === 0 ? <span className="muted">none</span> : (
                    <ul>
                      {conns.slice(0, 5).map((c, i) => <li key={`${c.id}${i}`}><button type="button" className="graph-linkbtn" onClick={() => onSelect(c.id)}>{c.text}</button></li>)}
                      {conns.length > 5 && (
                        <li><details><summary>{conns.length - 5} more</summary><ul>{conns.slice(5).map((c, i) => <li key={`${c.id}${i}`}><button type="button" className="graph-linkbtn" onClick={() => onSelect(c.id)}>{c.text}</button></li>)}</ul></details></li>
                      )}
                    </ul>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
