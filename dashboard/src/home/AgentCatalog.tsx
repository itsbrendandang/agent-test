// The board members, specialists and skills the Home chat can plan with, as cards in the Agents view. The Agents
// view reads the catalog (GET /api/chat/catalog) and owns the filter; this only draws what matches.
import "@/research/research.css"
import { AgentAvatar } from "@/lab/AgentAvatar"
import { hasWords } from "@/lib/format"
import type { Catalog, CatalogAgent } from "./api"
import { agentText, skillText } from "./chat"

export function AgentCatalog({ catalog, filter }: { catalog: Catalog; filter: string }) {
  const group = (title: string, about: string, agents: CatalogAgent[]) => agents.length > 0 && (
    <>
      <header className="section-head"><div><h2>{title} <span className="muted small">({agents.length})</span></h2><p className="muted small">{about}</p></div></header>
      <section className="cast">
        {agents.map((a) => (
          <article key={a.name} className="cast-card card-surface team-card">
            {/* The same face this agent has in a team review and in the Lab. Decoration: the title is the text. */}
            <div className="catalog-who"><AgentAvatar name={a.name} size={40} /><h3>{a.title}</h3></div>
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
  const agents = catalog.agents.filter((a) => hasWords(agentText(a), filter))
  const skills = catalog.skills.filter((s) => hasWords(skillText(s), filter))
  return (
    <>
      {group("Team review members", "The team that reviews a brief. Research picks from them for a team review.", agents.filter((a) => a.source === "board"))}
      {group("Specialists", "Listed for planning. Each has a trigger that says when it is called in.", agents.filter((a) => a.source === "specialist"))}
      {skills.length > 0 && (
        <>
          <header className="section-head"><div><h2>Skills <span className="muted small">({skills.length})</span></h2><p className="muted small">Instructions an agent can load. A skill marked "index only" is known by name and description but is not installed on this machine.</p></div></header>
          <ul className="catalog-skills">
            {skills.map((s) => (
              <li key={s.name} className="card-surface">
                <b>{s.title || s.name}</b>
                {!s.installed && <span className="pill" data-kind="waiting">known by name only: not installed</span>}
                <span className="small">{s.description}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
