import { useEffect, useState } from "react"
import { EngineOffline, PageHead } from "@/components/Shared"
import { AgentCatalog } from "@/home/AgentCatalog"
import { agentText, skillText } from "@/home/chat"
import { ChatRefused, getCatalog, type Catalog } from "@/home/api"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { hasWords } from "@/lib/format"
import { ROLES, type RoleCatalog } from "@/swarm/roles"
import { AgentAvatar } from "@/lab/AgentAvatar"

// Who does the work: the nine roles of the swarm, then the team members, specialists and methods the engine lists.
// Each agent's picture comes from the one shared mapping (lab/identity.ts), so it is the same here, in a team review
// and in the Lab.
export function AgentsView() {
  const [filter, setFilter] = useState("")
  const [catalog, setCatalog] = useState<Catalog>()
  const [catalogProblem, setCatalogProblem] = useState<{ said?: string }>()
  useEffect(() => {
    let stale = false
    getCatalog().then((c) => { if (!stale) setCatalog(c) },
      (e: unknown) => { if (!stale) setCatalogProblem(e instanceof ChatRefused && e.status !== 0 && e.status !== 404 ? { said: `${e.message} (HTTP ${e.status})` } : {}) })
    return () => { stale = true }
  }, [])
  const total = ROLES.length + (catalog?.agents.length ?? 0) + (catalog?.skills.length ?? 0)
  const shown = ROLES.filter((r) => hasWords(roleText(r), filter)).length
    + (catalog?.agents.filter((a) => hasWords(agentText(a), filter)).length ?? 0) + (catalog?.skills.filter((k) => hasWords(skillText(k), filter)).length ?? 0)
  return (
    <div className="page">
      <PageHead title="Agents" about="Who does the work: the team of nine, then the agents, specialists and skills of a team review." />
      <div className="exp-bar">
        <input type="search" name="agents-filter" aria-label="Filter roles, agents and skills" autoComplete="off" value={filter}
          placeholder="Filter by name, role, tool or skill…" onChange={(e) => setFilter(e.currentTarget.value)} />
        <span className="muted small" role="status">{shown} of {total} shown</span>
      </div>
      {catalogProblem?.said && <EngineOffline needs="The review agents, specialists and skills come from the engine." said={catalogProblem.said} />}
      {shown === 0 && total > 0 && <p className="empty-note">Nothing matches “{filter.trim()}”. Every word has to appear in the name, role, tools or description. Try fewer words.</p>}
      <SwarmTeam filter={filter} />
      {catalog && <AgentCatalog catalog={catalog} filter={filter} />}
    </div>
  )
}

const roleText = (r: (typeof ROLES)[number]) => `${r.name} ${r.does} team of nine role`

/** The nine roles of the team of nine: who they are, in the order they run. Which of them ran in a given run is on Compare. */
function SwarmTeam({ filter }: { filter: string }) {
  const [catalog, setCatalog] = useState<RoleCatalog>()
  const [failed, setFailed] = useState<Problem>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    readEngine<RoleCatalog>("/api/glhf/roles").then((c) => { setCatalog(c); setFailed(undefined) }, (e: unknown) => setFailed(problemOf(e)))
  }, [retry])

  return (
    <>
      <header className="section-head">
        <div>
          <h2>The team of nine</h2>
          <p className="muted small">Nine roles, in the order they run on a benchmark task. Each is a separate agent with its own instructions.</p>
        </div>
      </header>
      {failed && !catalog && <EngineOffline needs="Each role's instructions, budget and model group come from the engine." said={failed.said} onRetry={() => setRetry((n) => n + 1)} />}
      <section className="cast">
        {ROLES.map((r, i) => {
          if (!hasWords(roleText(r), filter)) return null
          const spec = catalog?.roles.find((x) => x.key === r.key)
          return (
            <article key={r.key} className="cast-card card-surface team-card">
              <div className="team-top">
                <AgentAvatar name={r.key} size={40} />
                <div>
                  <h2>{i + 1}. {r.name}</h2>
                  <p className="small">{r.does}.</p>
                </div>
              </div>
              {spec && (
                <details className="team-prompt">
                  <summary aria-label={`Details of ${r.name}`}>Details</summary>
                  <dl className="team-facts">
                    <dt>Budget</dt><dd>{spec.budget}</dd>
                    <dt>Model</dt><dd>the run's model <span className="muted">({spec.model_group} group)</span></dd>
                  </dl>
                  <pre>{spec.instructions}</pre>
                </details>
              )}
            </article>
          )
        })}
      </section>
      {catalog && (
        <details className="team-prompt team-shared card-surface">
          <summary>Rules every role follows</summary>
          <pre>{catalog.shared_rules}</pre>
        </details>
      )}
    </>
  )
}
