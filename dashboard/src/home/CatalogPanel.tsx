// "Connections": the engine's catalog, read-only. What the app is connected to (models and search) and the agents
// and skills on this computer. A key is shown as connected or not, never as a value. Shown in Settings, under Technical.
import { EngineOffline, SearchCredit } from "@/components/Shared"
import type { Catalog, CatalogAgent, ProviderId } from "./api"

const PROVIDER_NAME: Record<ProviderId, string> = { anthropic: "Claude (Anthropic)", openai: "OpenAI" }
const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`

/** A key the engine holds is "Connected". It is only used while the run mode is Real: in Demo the pill is neutral and its tooltip says so. */
function Key({ present, usable }: { present: boolean; usable: boolean }) {
  return (
    <span className="pill" data-kind={!present ? "warning" : usable ? "success" : "neutral"} title={present && !usable ? "Connected, and not used while the run mode is Demo." : undefined}>
      {present ? "Connected" : "Not connected"}
    </span>
  )
}

function Agents({ title, agents }: { title: string; agents: CatalogAgent[] }) {
  if (agents.length === 0) return null
  return (
    <details className="home-group">
      <summary>{title} <span className="muted">({agents.length})</span></summary>
      <ul>
        {agents.map((a) => (
          <li key={`${a.source}:${a.name}`}>
            <b>{a.title}</b>
            <span className="small">{a.role}</span>
            {a.trigger && <span className="muted small">Used when: {a.trigger}</span>}
            {a.tools.length > 0 && <span className="muted small">Tools: {a.tools.join(", ")}</span>}
          </li>
        ))}
      </ul>
    </details>
  )
}

interface Props {
  /** undefined: loading. null: the engine could not be reached or sent something unreadable. */
  catalog: Catalog | null | undefined
  /** Why there is no catalog, when the engine is running but could not give one. */
  why?: string
  /** Why board runs can only be scripted (boardScriptedWhy), or undefined when they can use real models. */
  boardWhy?: string
  onRetry: () => void
}

export function CatalogPanel({ catalog, why, boardWhy, onRetry }: Props) {
  const exa = catalog?.search.exa
  const budget = exa && typeof exa.usedUsd === "number" && typeof exa.ceilingUsd === "number" && exa.ceilingUsd > 0 ? { used: exa.usedUsd, ceiling: exa.ceilingUsd } : undefined
  return (
    <aside className="home-catalog card-surface" aria-labelledby="home-catalog-title">
      <h3 id="home-catalog-title">Connections</h3>
      <p className="muted small">Models, agents and skills available on this computer.</p>
      {catalog === undefined && <p className="muted small" role="status">Asking the engine…</p>}
      {catalog === null && !why && <EngineOffline needs="The engine lists the models, agents and skills." onRetry={onRetry} />}
      {catalog === null && why && <div role="alert"><p className="home-paidoff">{why}</p><button type="button" className="btn" onClick={onRetry}>Try again</button></div>}
      {catalog && (
        <>
          <section aria-label="Models and search">
            <h4>Models and search</h4>
            {boardWhy && <p className="home-paidoff" role="note">{boardWhy}.</p>}
            <ul className="home-keys">
              {catalog.providers.map((p) => (
                <li key={p.id}>
                  <span>{PROVIDER_NAME[p.id] ?? p.id}</span><Key present={p.keyPresent} usable={catalog.paidCalls} />
                  {p.models.length > 0 && <span className="muted small home-models">{p.models.join(", ")}</span>}
                </li>
              ))}
              <li>
                <span>Web search (Exa)</span><Key present={catalog.search.exa.keyPresent} usable={catalog.paidCalls} />
                {budget && (
                  <span className="muted small home-models home-budget">
                    <span id="home-budget-label">Search budget</span>
                    <progress aria-labelledby="home-budget-label" aria-describedby="home-budget-text" value={Math.min(budget.used, budget.ceiling)} max={budget.ceiling} />
                    <span id="home-budget-text" className="mono">{usd(budget.used)} of {usd(budget.ceiling)} used</span>
                  </span>
                )}
                {catalog.search.provider && <span className="muted small home-models" data-testid="search-credit"><SearchCredit provider={catalog.search.provider} />{catalog.search.provider === "fixture" && ": in Demo a review uses example sources, not a live web search."}</span>}
              </li>
              {catalog.search.literature?.available && <li><span>Research papers (Europe PMC)</span><span className="pill" data-kind="success">Free</span></li>}
            </ul>
            <p className="muted small" data-testid="key-note">API keys stay in the engine and are never shown here.</p>
          </section>
          <section aria-label="Agents and skills">
            <h4>Agents and skills</h4>
            {catalog.agents.length === 0 && <p className="muted small">The engine listed no agents.</p>}
            <Agents title="Board" agents={catalog.agents.filter((a) => a.source === "board")} />
            <Agents title="Specialists" agents={catalog.agents.filter((a) => a.source === "specialist")} />
            {catalog.skills.length === 0 ? <p className="muted small">The engine listed no skills.</p> : (
              <details className="home-group">
                <summary>Skills <span className="muted">({catalog.skills.filter((s) => s.installed).length} installed of {catalog.skills.length})</span></summary>
                <ul>
                  {catalog.skills.map((s) => (
                    <li key={s.name}>
                      <b>{s.title || s.name}</b>
                      {!s.installed && <span className="pill" data-kind="waiting">known by name only: not installed</span>}
                      <span className="small">{s.description}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </>
      )}
    </aside>
  )
}
