import { useEffect, useState } from "react"
import { EngineOffline, PageHead, RunId } from "@/components/Shared"
import { AgentCatalog } from "@/home/AgentCatalog"
import { agentText, skillText } from "@/home/chat"
import { ChatRefused, getCatalog, type Catalog } from "@/home/api"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { hasWords } from "@/lib/format"
import { isLive, latestSwarmRun, useSwarm } from "@/swarm/api"
import { ROLES, roleOf, type RoleCatalog } from "@/swarm/roles"
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
      <PageHead title="Agents" about="Who does the work: the nine roles of a task run, then the team members, specialists and methods of a team review." />
      <div className="exp-bar">
        <input type="search" name="agents-filter" aria-label="Filter roles, agents and skills" autoComplete="off" value={filter}
          placeholder="Filter by name, role, tool or skill…" onChange={(e) => setFilter(e.currentTarget.value)} />
        <span className="muted small" role="status">{shown} of {total} shown</span>
      </div>
      {catalogProblem?.said && <EngineOffline needs="The board members, specialists and skills come from the engine." said={catalogProblem.said} />}
      {shown === 0 && total > 0 && <p className="empty-note">Nothing matches “{filter.trim()}”. Every word has to appear in the name, role, tools or description. Try fewer words.</p>}
      <SwarmTeam filter={filter} />
      {catalog && <AgentCatalog catalog={catalog} filter={filter} />}
    </div>
  )
}

const roleText = (r: (typeof ROLES)[number]) => `${r.name} ${r.does} swarm role`

function SwarmTeam({ filter }: { filter: string }) {
  const { runs, detail, offline } = useSwarm(undefined, 0, latestSwarmRun) // the ledger of the newest swarm run, not of the newest run
  const [catalog, setCatalog] = useState<RoleCatalog>()
  const [failed, setFailed] = useState<Problem>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    readEngine<RoleCatalog>("/api/glhf/roles").then((c) => { setCatalog(c); setFailed(undefined) }, (e: unknown) => setFailed(problemOf(e)))
  }, [retry])

  const run = runs?.find((r) => r.solver === "glhf")
  const ledger = detail?.run.id === run?.id ? detail?.ledger : undefined
  const events = ledger?.events ?? []
  const started = new Set(events.filter((e) => e.kind === "phase.started").map((e) => roleOf(e.phase)))
  const last = events.findLast((e) => e.kind === "phase.started" || e.kind === "phase.finished")
  const live = run && isLive(run)
  const active = live && last?.kind === "phase.started" ? roleOf(last.phase) : undefined

  return (
    <>
      <header className="section-head">
        <div>
          <h2>The nine roles of a task run</h2>
          <p className="muted small">
            In the order they run. Each is a separate agent with its own instructions; they share only the files and the team's notes.
            {run ? <> Status is from the latest run by the team, <RunId id={run.id} />.</> : !offline && runs ? " No run by the team yet: start one on Compare to see which roles ran." : ""}
          </p>
        </div>
      </header>
      {(offline || failed) && !catalog && <EngineOffline needs="Each role's instructions, time share and model come from the engine." said={failed?.said} onRetry={() => setRetry((n) => n + 1)} />}
      <section className="cast">
        {ROLES.map((r, i) => {
          if (!hasWords(roleText(r), filter)) return null
          const spec = catalog?.roles.find((x) => x.key === r.key)
          const model = spec && run ? run.roleModels?.[spec.model_group] ?? run.model : undefined
          const state = active === r.key ? "● Working now" : started.has(r.key) ? "✓ Ran in the latest run" : run ? "○ Did not run in the latest run" : "○ No run yet"
          return (
            <article key={r.key} className="cast-card card-surface team-card" data-active={active === r.key || undefined}>
              <div className="team-top">
                <AgentAvatar name={r.key} size={40} />
                <div>
                  <h2>{i + 1}. {r.name}</h2>
                  <p className="small">{r.does}.</p>
                </div>
              </div>
              <p className="small team-state" data-testid="role-state">{state}</p>
              {spec && (
                <details className="team-prompt">
                  <summary>Budget, model and instructions</summary>
                  <dl className="team-facts">
                    <dt>Budget</dt><dd>{spec.budget}</dd>
                    <dt>Model</dt><dd>{model ?? "the run's model"} <span className="muted">({spec.model_group} group)</span></dd>
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
