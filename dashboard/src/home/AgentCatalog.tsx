// The research agents and skills the Home chat can plan with, as cards in the Agents view (from GET /api/chat/catalog).
// A Home search result opens this view "at" one of them: that card is scrolled to, marked and focused.
import { useEffect, useRef, useState } from "react"
import { takeOpenItem } from "@/lib/open"
import { getCatalog, type Catalog, type CatalogAgent } from "./api"

const idOf = (kind: "agent" | "skill", name: string) => `catalog-${kind}-${name.replace(/[^A-Za-z0-9_-]+/g, "-")}`

export function AgentCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>()
  const [target] = useState(takeOpenItem)
  const marked = useRef(false)
  useEffect(() => {
    let stale = false
    getCatalog().then((c) => { if (!stale) setCatalog(c) }, () => { if (!stale) setCatalog(null) })
    return () => { stale = true }
  }, [])
  const targetId = target && idOf(target.kind, target.id)
  useEffect(() => {
    if (!catalog || !targetId || marked.current) return
    const card = document.getElementById(targetId)
    if (!card) return
    marked.current = true
    card.scrollIntoView?.({ block: "center" }); card.focus({ preventScroll: true })
  }, [catalog, targetId])

  if (catalog === undefined) return target ? <p className="muted small" role="status">Loading the agents and skills…</p> : null
  // An engine without the chat catalog: the rest of the Agents view is unaffected.
  if (catalog === null) return target ? <p className="empty-note" role="status">The engine did not list its research agents and skills, so “{target.id}” cannot be shown.</p> : null
  const found = !target || (target.kind === "agent" ? catalog.agents.some((a) => a.name === target.id) : catalog.skills.some((s) => s.name === target.id))
  const group = (title: string, about: string, agents: CatalogAgent[]) => agents.length > 0 && (
    <>
      <header className="section-head"><div><h2>{title}</h2><p className="muted small">{about}</p></div></header>
      <section className="cast">
        {agents.map((a) => (
          <article key={a.name} id={idOf("agent", a.name)} tabIndex={-1} className="cast-card card-surface team-card" data-target={targetId === idOf("agent", a.name) || undefined}>
            <h3>{a.title}</h3>
            <p className="small">{a.role}</p>
            <dl className="team-facts">
              {a.trigger && <><dt>Used when</dt><dd>{a.trigger}</dd></>}
              {a.deliverable && <><dt>Delivers</dt><dd>{a.deliverable}</dd></>}
              <dt>Tools</dt><dd>{a.tools.join(", ") || "none"}</dd>
            </dl>
          </article>
        ))}
      </section>
    </>
  )
  return (
    <>
      {!found && target && <p className="empty-note" role="status">“{target.id}” is not in the engine's list of {target.kind}s any more.</p>}
      {group("Board members", "The board that reviews a drug candidate brief. The Home chat picks from them for a plan.", catalog.agents.filter((a) => a.source === "board"))}
      {group("Specialists", "Called in when a question needs them. Each has a trigger.", catalog.agents.filter((a) => a.source === "specialist"))}
      {catalog.skills.length > 0 && (
        <>
          <header className="section-head"><div><h2>Skills</h2><p className="muted small">Instructions an agent can load. A skill marked "index only" is known by name and description but is not installed on this machine.</p></div></header>
          <ul className="catalog-skills">
            {catalog.skills.map((s) => (
              <li key={s.name} id={idOf("skill", s.name)} tabIndex={-1} className="card-surface" data-target={targetId === idOf("skill", s.name) || undefined}>
                <b>{s.name}</b>
                {!s.installed && <span className="pill" data-kind="waiting">index only, not installed</span>}
                <span className="small">{s.description}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
