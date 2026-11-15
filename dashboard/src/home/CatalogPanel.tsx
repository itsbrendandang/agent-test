// "What this can use": the engine's catalog, read-only. Keys are shown as present or missing, never as values.
import { EngineOffline } from "@/components/Shared"
import { HOW_TO_TURN_ON, PAID_LABEL } from "@/lib/paid"
import type { Catalog, CatalogAgent, ProviderId } from "./api"

const PROVIDER_NAME: Record<ProviderId, string> = { anthropic: "Claude (Anthropic)", openai: "OpenAI" }
const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`

/** A key that is present is only usable while paid calls are on: then green. With paid calls off it is neutral and says so. */
function Key({ present, usable }: { present: boolean; usable: boolean }) {
  return (
    <>
      <span className="pill" data-kind={!present ? "warning" : usable ? "success" : "neutral"} title={present && !usable ? "The key is there, but it is not used in Demo mode." : undefined}>
        {!present ? "key missing" : usable ? "key present" : "key present · off"}
      </span>
    </>
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
  return (
    <aside className="home-catalog card-surface" aria-labelledby="home-catalog-title">
      <h2 id="home-catalog-title">What this can use</h2>
      <p className="muted small">The models, team members and skills on this computer. You do not need any of this to ask a question.</p>
      {catalog === undefined && <p className="muted small" role="status">Asking the engine…</p>}
      {catalog === null && !why && <EngineOffline needs="The engine lists the models, agents and skills." onRetry={onRetry} />}
      {catalog === null && why && <div role="alert"><p className="home-paidoff">{why}</p><button type="button" className="btn" onClick={onRetry}>Try again</button></div>}
      {catalog && (
        <>
          <section aria-label="Paid calls">
            <p><span className="pill" data-kind={catalog.paidCalls ? "warning" : "neutral"}>{PAID_LABEL[catalog.paidCalls ? "on" : "off"]}</span></p>
            <p className="muted small">
              {catalog.paidCalls ? "A started plan can spend money, up to the limits shown on its card." : `Replies are word searches of past runs or fixed practice text. A plan that needs a paid model cannot start. ${HOW_TO_TURN_ON}`}
            </p>
          </section>
          <section aria-label="Models and search">
            <h3>Models and search</h3>
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
                {typeof catalog.search.exa.usedUsd === "number" && typeof catalog.search.exa.ceilingUsd === "number" && (
                  <span className="muted small home-models">{usd(catalog.search.exa.usedUsd)} of {usd(catalog.search.exa.ceilingUsd)} used</span>
                )}
              </li>
              {catalog.search.literature?.available && <li><span>Literature search (Europe PMC)</span><span className="pill" data-kind="success">free, no key needed</span></li>}
            </ul>
            {catalog.search.provider === "exa" && <p className="muted small" data-testid="search-credit">Search powered by Exa</p>}
            {catalog.search.provider === "fixture" && <p className="muted small">In Demo mode a run uses example sources, not a live web search.</p>}
            <p className="muted small">Keys live in the engine's .env file. This page never shows or asks for one.</p>
          </section>
          <section aria-label="Agents">
            <h3>Agents</h3>
            {catalog.agents.length === 0 && <p className="muted small">The engine listed no agents.</p>}
            <Agents title="Board" agents={catalog.agents.filter((a) => a.source === "board")} />
            <Agents title="Specialists" agents={catalog.agents.filter((a) => a.source === "specialist")} />
          </section>
          <section aria-label="Skills">
            <h3>Skills</h3>
            {catalog.skills.length === 0 ? <p className="muted small">The engine listed no skills.</p> : (
              <details className="home-group">
                <summary>Skills <span className="muted">({catalog.skills.filter((s) => s.installed).length} installed of {catalog.skills.length})</span></summary>
                <ul>
                  {catalog.skills.map((s) => (
                    <li key={s.name}>
                      <b>{s.name}</b>
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
