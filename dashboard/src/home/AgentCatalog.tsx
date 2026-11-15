// The research agents and skills the Home chat can plan with, as cards in the Agents view (from GET /api/chat/catalog).
import { useEffect, useState } from "react"
import { getCatalog, type Catalog, type CatalogAgent } from "./api"

export function AgentCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>()
  useEffect(() => {
    let stale = false
    getCatalog().then((c) => { if (!stale) setCatalog(c) }, () => { if (!stale) setCatalog(null) })
    return () => { stale = true }
  }, [])
  if (!catalog) return null // loading, or an engine without the chat catalog: the rest of the Agents view is unaffected
  const group = (title: string, about: string, agents: CatalogAgent[]) => agents.length > 0 && (
    <>
      <header className="section-head"><div><h2>{title}</h2><p className="muted small">{about}</p></div></header>
      <section className="cast">
        {agents.map((a) => (
          <article key={a.name} className="cast-card card-surface team-card">
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
      {group("Board members", "The board that reviews a drug candidate brief. The Home chat picks from them for a plan.", catalog.agents.filter((a) => a.source === "board"))}
      {group("Specialists", "Called in when a question needs them. Each has a trigger.", catalog.agents.filter((a) => a.source === "specialist"))}
      {catalog.skills.length > 0 && (
        <>
          <header className="section-head"><div><h2>Skills</h2><p className="muted small">Instructions an agent can load. A skill marked "index only" is known by name and description but is not installed on this machine.</p></div></header>
          <ul className="catalog-skills">
            {catalog.skills.map((s) => (
              <li key={s.name} className="card-surface">
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
