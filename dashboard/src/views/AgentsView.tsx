// Agents: the team as member cards, grouped (the team of nine in step order, then the team review with its lead first,
// then the specialists A to Z), with a search box and a group filter, and under it one card that
// shows a run step by step along its own clock. A card's details open in a side panel, one member at a time, so
// opening one never makes the other cards in its row grow. Everything on a card is something the engine or the role list
// says: no invented field. Each agent's picture comes from the one shared mapping (lab/identity.ts), so it is the
// same here, in a team review and in the Agent Lab. Which roles ran in a given run is on Compare, not on the cards.
import { useEffect, useState, type ReactNode } from "react"
import { Provenance } from "@/components/Provenance"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { EngineOffline, PageHead } from "@/components/Shared"
import { ChatRefused, getCatalog, type Catalog, type CatalogAgent } from "@/home/api"
import { agentText, skillText } from "@/home/chat"
import { AgentAvatar } from "@/lab/AgentAvatar"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { hasWords } from "@/lib/format"
import { provenanceOf } from "@/lib/provenance"
import { stamp } from "@/lib/records"
import { clockLength, phaseTimeline } from "@/lib/timeline"
import { benchmarkTitle, BOARD_JOB, clip } from "@/lib/words"
import { useSwarm, type GlhfRun } from "@/swarm/api"
import { ROLES, roleOf, type RoleCatalog } from "@/swarm/roles"

type Group = "nine" | "review" | "specialist"
const GROUP_WORD: Record<Group, string> = { nine: "Team of nine", review: "Team review", specialist: "Specialist" }
const FILTERS: readonly ["all" | Group, string][] = [["all", "All"], ["nine", "Team of nine"], ["review", "Team review"], ["specialist", "Specialists"]]
/** The groups in the order the page shows them, each with its heading and a line on what it is. */
const SECTIONS: readonly { group: Group; title: string; about: string }[] = [
  { group: "nine", title: "Team of nine", about: "Works on benchmark tasks, one step after another." },
  { group: "review", title: "Team review", about: "The lead and the members of a team review." },
  { group: "specialist", title: "Specialists", about: "Called into a team review when the question fits." },
]
/** What the roster calls a tool, in plain words. A name this page does not know is shown as it is. */
const TOOL_WORD: Record<string, string> = { exa_search: "web search", literature_search: "literature search", database_search: "database look-up", converse: "leads the discussion", write_memo: "writes the decision", python: "code" }
const toolWords = (tools: string[]) => (tools.length ? tools.map((t) => TOOL_WORD[t] ?? t).join(", ") : "none")

interface Member {
  key: string; group: Group
  /** The engine's name of the agent: its picture is found from it. */
  agent: string
  name: string; job: string
  /** The two fields every card has. */
  worksOn: string; part: string
  /** One muted line at the foot: what the list says it may use, or its model group. */
  foot: string
  /** Everything the search box looks in. */
  text: string
  details?: ReactNode
}

/** Review agents first, the lead before the members (in the team's own order); then the specialists A to Z. */
const memberOrder = (a: CatalogAgent, b: CatalogAgent) => {
  const rank = (x: CatalogAgent) => (x.source === "board" ? (x.role === "lead" ? 0 : 1) : 2)
  return rank(a) - rank(b) || (rank(a) === 2 ? a.title.localeCompare(b.title) : 0)
}

const latestDoneTeamRun = (runs: GlhfRun[]) => runs.find((r) => r.solver === "glhf" && r.phase === "done")?.id

export function AgentsView() {
  const [filter, setFilter] = useState("")
  const [group, setGroup] = useState<"all" | Group>("all")
  const [catalog, setCatalog] = useState<Catalog>()
  const [catalogProblem, setCatalogProblem] = useState<{ said?: string }>()
  const [roles, setRoles] = useState<RoleCatalog>()
  const [rolesProblem, setRolesProblem] = useState<Problem>()
  const [retry, setRetry] = useState(0)
  /** The member whose details are open in the side panel: one at a time, by its stable key. */
  const [opened, setOpened] = useState<string>()
  useEffect(() => {
    let stale = false
    getCatalog().then((c) => { if (!stale) setCatalog(c) },
      (e: unknown) => { if (!stale) setCatalogProblem(e instanceof ChatRefused && e.status !== 0 && e.status !== 404 ? { said: `${e.message} (HTTP ${e.status})` } : {}) })
    return () => { stale = true }
  }, [])
  useEffect(() => {
    let stale = false
    readEngine<RoleCatalog>("/api/glhf/roles").then((c) => { if (!stale) { setRoles(c); setRolesProblem(undefined) } }, (e: unknown) => { if (!stale) setRolesProblem(problemOf(e)) })
    return () => { stale = true }
  }, [retry])

  const members: Member[] = [
    ...ROLES.map((r, i): Member => {
      const spec = roles?.roles.find((x) => x.key === r.key)
      return {
        key: `nine:${r.key}`, group: "nine", agent: r.key, name: r.name, job: `${r.does}.`, worksOn: "Benchmark tasks", part: `Step ${i + 1} of ${ROLES.length}`,
        foot: spec ? `Model group: ${spec.model_group}` : "Model group: not loaded", text: `${r.name} ${r.does} team of nine role benchmark`,
        details: spec && <><dl className="team-facts"><dt>Budget</dt><dd>{spec.budget}</dd></dl><pre>{spec.instructions}</pre></>,
      }
    }),
    ...[...(catalog?.agents ?? [])].sort(memberOrder).map((a: CatalogAgent): Member => {
      const review = a.source === "board"
      return {
        key: `${a.source}:${a.name}`, group: review ? "review" : "specialist", agent: a.name, name: a.title,
        job: review ? `${cap(BOARD_JOB[a.name] ?? (a.role === "lead" ? "leads the review" : "takes part in the review"))}.` : a.trigger ? clip(a.trigger, 120) : "A specialist the review can call in.",
        worksOn: "Team reviews", part: review ? (a.role === "lead" ? "Leads the review" : "Review member") : "When the question fits",
        foot: `Tools: ${toolWords(a.tools)}`, text: `${agentText(a)} ${GROUP_WORD[review ? "review" : "specialist"]}`,
        details: (a.deliverable || a.trigger) && <dl className="team-facts">{a.trigger && <><dt>Used when</dt><dd>{a.trigger}</dd></>}{a.deliverable && <><dt>Delivers</dt><dd>{a.deliverable}</dd></>}</dl>,
      }
    }),
  ]
  const shown = members.filter((m) => (group === "all" || m.group === group) && hasWords(m.text, filter))
  const skills = (catalog?.skills ?? []).filter((s) => hasWords(skillText(s), filter))

  return (
    <div className="page">
      <PageHead title="Agents" about="Who does the work: the team of nine on benchmark tasks, and the agents and specialists of a team review." />
      <section className="members-section" aria-labelledby="members-title">
        <div className="members-head">
          <h2 id="members-title">Members</h2>
          <input type="search" name="agents-filter" aria-label="Search agents by name, job or tool" autoComplete="off" value={filter}
            placeholder="Search by name, job or tool" onChange={(e) => setFilter(e.currentTarget.value)} />
        </div>
        <div className="members-tools">
          <div role="group" aria-label="Group" className="exp-kinds">
            {FILTERS.map(([value, word]) => <button key={value} type="button" className="btn" aria-pressed={group === value} onClick={() => setGroup(value)}>{word}</button>)}
          </div>
          <span className="muted small" role="status"><span className="mono">{shown.length}</span> of <span className="mono">{members.length}</span> agents shown</span>
        </div>
        {catalogProblem?.said && <EngineOffline needs="The review agents and specialists come from the engine." said={catalogProblem.said} />}
        {rolesProblem && !roles && <EngineOffline needs="Each role's budget, model group and instructions come from the engine." said={rolesProblem.said} onRetry={() => setRetry((n) => n + 1)} />}
        {shown.length === 0 && <p className="empty-note">No agent matches{filter.trim() ? <> “{filter.trim()}”</> : null}{group !== "all" ? ` in ${GROUP_WORD[group]}` : ""}. Every word has to appear in the name, job or tools. Try fewer words.</p>}
        {SECTIONS.map(({ group: g, title, about }) => {
          const list = shown.filter((m) => m.group === g)
          if (!list.length) return null
          return (
            <section key={g} className="members-group" aria-labelledby={`members-${g}`}>
              <header className="members-group-head">
                <h3 id={`members-${g}`}>{title} <span className="members-count">{list.length}</span></h3>
                <p>{about}</p>
              </header>
              <ul className="members" aria-label={title}>
                {list.map((m) => (
                  <li key={m.key} className="member-card card-surface" data-group={m.group} data-selected={opened === m.key || undefined}>
                    <div className="member-top">
                      <AgentAvatar name={m.agent} size={40} />
                      <span className="pill" data-kind="outline">{GROUP_WORD[m.group]}</span>
                    </div>
                    <h4>{m.name}</h4>
                    <p className="member-job">{m.job}</p>
                    <dl className="member-fields">
                      <div><dt>Works on</dt><dd>{m.worksOn}</dd></div>
                      <div><dt>Takes part</dt><dd>{m.part}</dd></div>
                    </dl>
                    <div className="member-end">
                      <p className="member-foot">{m.foot}</p>
                      {m.details && (
                        <Button type="button" variant="outline" size="sm" className="member-details" aria-label={`Details of ${m.name}`} aria-haspopup="dialog" aria-expanded={opened === m.key}
                          onClick={() => setOpened(m.key)}>Details</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        <MemberPanel member={members.find((m) => m.key === opened)} onClose={() => setOpened(undefined)} />
        {roles && (group === "all" || group === "nine") && !filter.trim() && (
          <details className="team-prompt team-shared card-surface">
            <summary>Rules every role of the team of nine follows</summary>
            <pre>{roles.shared_rules}</pre>
          </details>
        )}
        {skills.length > 0 && (
          <details className="team-prompt team-shared card-surface">
            <summary>Skills <span className="muted">({skills.length})</span></summary>
            <ul className="member-skills">
              {skills.map((s) => (
                <li key={s.name}><b>{s.title || s.name}</b>{!s.installed && <span className="pill" data-kind="waiting">known by name only: not installed</span>}<span className="small">{s.description}</span></li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <RunTimeline />
    </div>
  )
}
/** One member's details, in a side panel over the page. */
function MemberPanel({ member, onClose }: { member?: Member; onClose: () => void }) {
  return (
    <Sheet open={!!member} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="member-panel">
        {member && (
          <>
            <SheetHeader className="member-panel-head">
              <AgentAvatar name={member.agent} size={40} />
              <SheetTitle>{member.name}</SheetTitle>
              <SheetDescription>{GROUP_WORD[member.group]} · {member.job}</SheetDescription>
            </SheetHeader>
            <div className="member-panel-body">
              <dl className="member-fields">
                <div><dt>Works on</dt><dd>{member.worksOn}</dd></div>
                <div><dt>Takes part</dt><dd>{member.part}</dd></div>
              </dl>
              <p className="member-foot">{member.foot}</p>
              <div className="team-prompt">{member.details}</div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
const cap = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text)

/**
 * "A run, step by step": one row per role in the order they work, and a bar for each step along the run's own
 * clock, from the latest finished run by the team of nine. Only recorded times are drawn (lib/timeline.ts). With
 * no such run, or none with usable readings, the roles are shown in order as equal steps, and the card says so.
 */
function RunTimeline() {
  const { runs, detail } = useSwarm(undefined, 0, latestDoneTeamRun)
  const run = runs?.find((r) => r.id === latestDoneTeamRun(runs))
  const ledger = run && detail?.run.id === run.id ? detail.ledger : undefined
  const timeline = ledger ? phaseTimeline(ledger.events) : undefined
  const timed = timeline && timeline.total >= 1 ? timeline : undefined // readings that all fall in one second say nothing about length
  const rows = ROLES.map((r) => ({ role: r, steps: (timeline?.steps ?? []).filter((s) => roleOf(s.phase) === r.key) }))
  const pct = (seconds: number) => `${(100 * seconds) / (timed?.total || 1)}%`
  return (
    <section className="card-surface timeline-card" aria-labelledby="timeline-title">
      <header className="timeline-head">
        <h2 id="timeline-title">A run, step by step</h2>
        {run && timed ? (
          <p className="muted small" data-testid="timeline-run">
            <span title={`Run id: ${run.id}`}>{benchmarkTitle(run.solver, run.task)}</span>, <time className="mono">{stamp(run.startedAt)}</time> <Provenance kind={provenanceOf({ model: run.model })} compact />
            {" "}Bars follow the run's own clock: <span className="mono">{clockLength(timed.total)}</span> from the end of the first step to the end of the last.
            {provenanceOf({ model: run.model }) === "practice" && " A practice run replays fixed steps, so its times are not research."}
          </p>
        ) : (
          <p className="muted small" data-testid="timeline-run">Order only: no run with recorded times yet.</p>
        )}
      </header>
      <div className="timeline" aria-hidden="true" data-timed={timed ? "" : undefined}>
        {rows.map(({ role, steps }, i) => (
          <div key={role.key} className="timeline-row">
            <span className="timeline-who"><AgentAvatar name={role.key} size={24} />{role.name}</span>
            <span className="timeline-track">
              {timed
                ? steps.map((s) => (
                  <span key={s.phase} className="timeline-bar" data-cut={s.cut || undefined} data-tick={s.start === undefined || s.end - s.start < 1 || undefined}
                    style={{ left: pct(s.start ?? 0), width: s.start === undefined ? undefined : pct(s.end - s.start) }}>
                    <AgentAvatar name={role.key} size={24} />
                  </span>
                ))
                : <span className="timeline-bar" data-order style={{ left: `${(100 * i) / ROLES.length}%`, width: `${100 / ROLES.length}%` }}><AgentAvatar name={role.key} size={24} /></span>}
            </span>
          </div>
        ))}
        {timed && <div className="timeline-axis"><span /><span className="timeline-ticks"><span>0 s</span><span>{clockLength(timed.total / 2)}</span><span>{clockLength(timed.total)}</span></span></div>}
      </div>
      <details className="timeline-table">
        <summary>The same as a table</summary>
        <table aria-label="The steps of the run, in order">
          <thead><tr><th scope="col">Role</th><th scope="col">Step</th><th scope="col">{timed ? "Started at" : "Order"}</th>{timed && <th scope="col">Took</th>}</tr></thead>
          <tbody>
            {timed
              ? timed.steps.map((s) => (
                <tr key={s.phase}>
                  <th scope="row">{ROLES.find((r) => r.key === roleOf(s.phase))?.name ?? s.phase}</th><td>{s.phase}</td>
                  <td className="mono">{s.start === undefined ? "not recorded" : s.start < 1 ? "0 s" : clockLength(s.start)}</td>
                  <td className="mono">{s.start === undefined ? "not recorded" : clockLength(s.end - s.start)}{s.cut && " (cut off at its limit)"}</td>
                </tr>
              ))
              : ROLES.map((r, i) => <tr key={r.key}><th scope="row">{r.name}</th><td>{r.does}</td><td className="mono">{i + 1} of {ROLES.length}</td></tr>)}
          </tbody>
        </table>
        {timed && <p className="muted small">Times are seconds on the run's clock, counted from the end of the first step. The first step's start was not recorded. A role that is not listed did not run in this run.</p>}
      </details>
    </section>
  )
}
