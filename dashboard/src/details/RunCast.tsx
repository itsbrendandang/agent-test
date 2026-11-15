// "In this run": every agent of a run with what it is doing now, and every entity it touched (the identifiers the run
// names, the sources the team kept, the statements that were checked), each one a button that opens its detail panel.
// It is rebuilt from the events as they arrive, so it grows while the run goes on.
import { useMemo, useState } from "react"
import type { RosterMember } from "@/board/api"
import type { LabEvent } from "@/lab/adapter"
import { AgentAvatar } from "@/lab/AgentAvatar"
import { agentIdentity } from "@/lab/identity"
import { markOf } from "@/lib/words"
import { eventRows, type EventRow } from "@/lab/logRows"
import { DetailSheet, type DetailRun, type DetailTarget } from "./DetailSheet"
import { useEngineRoster } from "./roster"
import { TYPE_WORD, idKey, idLabel } from "./identifiers"
import { agentProfile, CHECKER_NAME, claimGroups, runFacts, runIdentifiers, type NowState } from "./profiles"

const STATE_MARK: Record<NowState, string> = { working: "●", searching: "●", waiting: "◌", done: "✓", "not-started": "○", absent: "○", stopped: "✕", unknown: "?" }
const MAX_SHOWN = 12

/** One run's agents and entities, and the panel they open. */
export function RunCast({ run, events, rows: givenRows, roster: givenRoster, target: shownTarget, onTarget }: {
  run: DetailRun; events: readonly LabEvent[]; rows?: readonly EventRow[]; roster?: readonly RosterMember[]
  /** The open panel, when the caller keeps it (so the Agent Log's names can open the same panel). */
  target?: DetailTarget; onTarget?: (t: DetailTarget | undefined) => void
}) {
  const [ownTarget, setOwnTarget] = useState<DetailTarget>()
  const target = onTarget ? shownTarget : ownTarget
  const setTarget = onTarget ?? setOwnTarget
  const [all, setAll] = useState(false)
  const engineRoster = useEngineRoster(run.kind === "board" && !givenRoster)
  const roster = givenRoster ?? engineRoster
  const facts = useMemo(() => runFacts(events, run.kind), [events, run.kind])
  const rows = useMemo(() => givenRows ?? (run.kind === "swarm" ? [] : eventRows(events, run.kind)), [givenRows, events, run.kind])
  // The run's own roster first (speaking order, the lead first), then anyone else the log names; never the engine's own steps.
  const agents = useMemo(() => {
    const ids = [...facts.roster.map((m) => m.name), ...rows.map((r) => r.agentId)].filter((id) => id !== "engine")
    return [...new Set(ids)]
  }, [facts.roster, rows])
  const ids = useMemo(() => runIdentifiers(facts), [facts])
  const sources = [...facts.sources.values()]
  const claims = useMemo(() => claimGroups(facts.claims), [facts.claims])
  if (!agents.length && !ids.length && !sources.length) return null
  const label = (id: string) => CHECKER_NAME[id] ?? rows.find((r) => r.agentId === id)?.agent ?? agentIdentity(id, { title: facts.roster.find((m) => m.name === id)?.title ?? roster?.find((m) => m.name === id)?.title }).label
  const cut = <T,>(list: T[]) => (all ? list : list.slice(0, MAX_SHOWN))
  const more = Math.max(ids.length, sources.length, claims.length) > MAX_SHOWN
  return (
    <section className="run-cast card-surface" aria-label="Agents and entities in this run">
      <div className="run-cast-row">
        <h3>Agents <span className="detail-count mono">{agents.length}</span></h3>
        <ul className="run-cast-agents">
          {agents.map((id) => {
            const now = agentProfile(facts, rows, id).now
            return (
              <li key={id}>
                <button type="button" className="run-cast-agent" data-state={now.state} onClick={() => setTarget({ kind: "agent", id })} aria-label={`Details of ${label(id)}: ${now.text}`} title={now.text}>
                  <AgentAvatar name={id.replace(/^specialist:/, "")} size={24} />
                  <span>{CHECKER_NAME[id] ?? agentIdentity(id, { title: label(id) }).short}</span>
                  <span className="run-cast-state" aria-hidden="true">{STATE_MARK[now.state]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      {ids.length > 0 && (
        <div className="run-cast-row">
          <h3>Identifiers <span className="detail-count mono">{ids.length}</span></h3>
          <ul className="run-cast-entities">
            {cut(ids).map(({ id, mentions }) => (
              <li key={idKey(id)}><button type="button" className="pill detail-id" data-kind="outline" aria-label={id.type ? `${TYPE_WORD[id.type]}: ${idLabel(id)}` : idLabel(id)} onClick={() => setTarget({ kind: "entity", ref: { kind: "id", key: idKey(id) } })} title={`${id.type ? TYPE_WORD[id.type] : "Record"} · named ${mentions} time${mentions === 1 ? "" : "s"}`}>{id.type && <span className="detail-id-type">{TYPE_WORD[id.type]} · </span>}{idLabel(id)}</button></li>
            ))}
          </ul>
        </div>
      )}
      {sources.length > 0 && (
        <div className="run-cast-row">
          <h3>Sources <span className="detail-count mono">{sources.length}</span></h3>
          <ul className="run-cast-entities">
            {cut(sources).map((s) => <li key={s.url}><button type="button" className="pill" data-kind="outline" onClick={() => setTarget({ kind: "entity", ref: { kind: "source", url: s.url } })} title={s.url}>{s.title.length > 60 ? `${s.title.slice(0, 59)}…` : s.title}</button></li>)}
          </ul>
        </div>
      )}
      {claims.length > 0 && (
        <div className="run-cast-row">
          <h3>Statements <span className="detail-count mono">{claims.length}</span></h3>
          <ul className="run-cast-entities">
            {cut(claims).map((g) => <li key={g.id}><button type="button" className="pill mark" data-mark={markOf(g.latest.verdict)} onClick={() => setTarget({ kind: "entity", ref: { kind: "claim", agent: g.agent, text: g.text } })} title={g.text}>{g.text.length > 60 ? `${g.text.slice(0, 59)}…` : g.text}</button></li>)}
          </ul>
        </div>
      )}
      {more && <button type="button" className="link-btn small" onClick={() => setAll(!all)}>{all ? "Show fewer" : "Show all"}</button>}
      <DetailSheet target={target} onClose={() => setTarget(undefined)} run={run} events={events} rows={rows} roster={roster} />
    </section>
  )
}
