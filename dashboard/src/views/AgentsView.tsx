import { useEffect, useState } from "react"
import { EngineOffline, PageHead, RunId } from "@/components/Shared"
import { AgentCatalog } from "@/home/AgentCatalog"
import { agentText, skillText } from "@/home/chat"
import { ChatRefused, getCatalog, type Catalog } from "@/home/api"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { hasWords } from "@/lib/format"
import { isLive, latestSwarmRun, useSwarm } from "@/swarm/api"
import { ROLES, roleOf, type RoleCatalog } from "@/swarm/roles"
import { Buddy } from "@/components/Buddy"

// Crew editor: name, role and look for each desktop character. No AI agents are wired to them yet.
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
      <PageHead title="Agents and skills" about="Who does the work: the nine roles of the swarm, the board members, the specialists and the skills. Use the box to filter them." />
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
          <h2>Swarm team</h2>
          <p className="muted small">
            Nine roles, in the order they run. Each is a separate agent with its own instructions; they share only the files and the ledger.
            {run ? <> Status is from the latest swarm run, <RunId id={run.id} />.</> : !offline && runs ? " No swarm run yet: start one in the Compare view to see which roles ran." : ""}
          </p>
        </div>
      </header>
      {(offline || failed) && !catalog && <EngineOffline needs="Each role's instructions, time share and model come from the engine." said={failed?.said} onRetry={() => setRetry((n) => n + 1)} />}
      <section className="cast">
        {ROLES.map((r, i) => {
          if (!hasWords(roleText(r), filter)) return null
          const spec = catalog?.roles.find((x) => x.key === r.key)
          const model = spec && run ? run.roleModels?.[spec.model_group] ?? run.model : undefined
          const state = active === r.key ? "working now" : started.has(r.key) ? "ran in the latest run" : run ? "did not run in the latest run" : "no runs yet"
          return (
            <article key={r.key} className="cast-card card-surface team-card" data-active={active === r.key || undefined}>
              <div className="team-top">
                <Buddy species={r.species} mood={active === r.key ? "working" : started.has(r.key) ? "happy" : "sleeping"} size={64} />
                <div>
                  <h2>{i + 1}. {r.name}</h2>
                  <p className="small">{r.does}.</p>
                </div>
              </div>
              <dl className="team-facts">
                <dt>Time</dt><dd>{spec?.budget ?? "–"}</dd>
                <dt>Model</dt><dd>{spec ? <>{model ?? "the run's model"} <span className="muted">({spec.model_group} group)</span></> : "–"}</dd>
                <dt>Status</dt><dd>{state}</dd>
              </dl>
              {spec && (
                <details className="team-prompt">
                  <summary>Instructions</summary>
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
