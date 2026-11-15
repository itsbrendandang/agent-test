// The detail panel for one agent or one entity (a source, a statement, an identifier) of one run, in a side sheet. It
// is rebuilt from the run's events each time one arrives, so while a run goes on it fills in as the team works. Every
// line is something the run recorded (profiles.ts); what is not recorded is said, never filled in.
// Inside the panel, an agent's sources and statements, and an entity's agents, open in the same panel; Back returns.
// Built from the dashboard's shadcn Sheet and its existing pills and avatars: no new UI library.
import { ArrowLeftIcon } from "lucide-react"
import { useMemo, useState, type ElementType, type ReactNode } from "react"
import type { RosterMember } from "@/board/api"
import { MarkChip } from "@/components/Shared"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import type { LabEvent } from "@/lab/adapter"
import { AgentAvatar } from "@/lab/AgentAvatar"
import { agentIdentity } from "@/lab/identity"
import { eventRows, type EventRow } from "@/lab/logRows"
import type { RunKind } from "@/lab/model"
import { logLink } from "@/lib/links"
import { BOARD_JOB, safeUrl, type Mark } from "@/lib/words"
import { SCHEME_NAME, TYPE_WORD, idKey, idLabel, type Identifier } from "./identifiers"
import { agentProfile, CHECKER_NAME, entityProfile, providerName, refKey, runFacts, type AgentProfile, type ClaimGroup, type EntityProfile, type EntityRef, type RunFacts, type SourceFact, type Usage } from "./profiles"
import "@/design/details.css"

export type DetailTarget = { kind: "agent"; id: string } | { kind: "entity"; ref: EntityRef }
export interface DetailRun { kind: RunKind; id: string; live: boolean; practice?: boolean }

/** What the roster calls a tool, in plain words. A name this panel does not know is shown as it is. */
const TOOL_WORD: Record<string, string> = { exa_search: "web search (Exa)", literature_search: "literature search", database_search: "database look-up", converse: "leads the discussion", write_memo: "writes the decision memo", python: "code" }
/** The model tiers of board/config.yaml, in plain words. */
const TIER_WORD: Record<string, string> = { lead: "lead tier", strong: "strong tier", cheap: "cheap tier", rival: "rival tier (another vendor)" }
/** What each research answer step's agent does (engine/src/research, as the Agent Log names them). */
const RESEARCH_JOB: Record<string, string> = {
  planner: "plans the searches and the hypotheses", searcher: "runs the web, literature and database searches", relevance: "screens what the searches found",
  writer: "writes the answer from the kept sources", checker: "checks each statement of the answer against its sources", critic: "reviews the answer and raises notes",
}
const CHECKER_JOB: Record<string, string> = {
  "first-pass": "the quick first check: a cheaper model from another vendor reads each statement against its source",
  jev: "the quick first check (called Jev in older runs)",
  openai: "the second, careful check of statements the first check could not settle",
  anthropic: "the second, careful check of statements the first check could not settle",
  "claude-code": "the second, careful check that recalculates a computed statement",
}
const STATE_WORD: Record<AgentProfile["now"]["state"], string> = { working: "Working", searching: "Searching", waiting: "Waiting", done: "Finished", "not-started": "Not started", absent: "Did not take part", stopped: "Stopped", unknown: "Not known yet" }

const time = (at?: number) => (at === undefined || !Number.isFinite(new Date(at).getTime()) ? undefined : new Date(at))
function When({ at, prefix }: { at?: number; prefix?: string }) {
  const d = time(at)
  if (!d) return null
  return <time className="detail-time" dateTime={d.toISOString()} title={d.toLocaleString()}>{prefix}{d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
}
const n = (x: number) => x.toLocaleString("en-US")
/** "Not recorded" in one place, with the reason. */
const Unknown = ({ children }: { children: ReactNode }) => <p className="detail-unknown">{children}</p>

function Section({ title, count, children, open = true }: { title: string; count?: number; children: ReactNode; open?: boolean }) {
  return (
    <details className="detail-section" open={open}>
      <summary><span>{title}</span>{count !== undefined && <span className="detail-count mono">{count}</span>}</summary>
      <div className="detail-section-body">{children}</div>
    </details>
  )
}

function UsageLine({ usage, practice }: { usage: Usage; practice?: boolean }) {
  return (
    <dl className="team-facts detail-usage">
      <dt>Tokens</dt><dd className="mono">{n(usage.totalTokens)}</dd>
      <dt>Input · output</dt><dd className="mono">{n(usage.input)} · {n(usage.output)}</dd>
      {(usage.cacheRead > 0 || usage.cacheWrite > 0) && <><dt>Cache read · write</dt><dd className="mono">{n(usage.cacheRead)} · {n(usage.cacheWrite)}</dd></>}
      <dt>Spend</dt><dd className="mono">{practice ? "$0 (practice run: a scripted model, no money spent)" : `$${usage.usd.toFixed(4)}`}</dd>
    </dl>
  )
}

function IdChips({ ids, onOpen }: { ids: Identifier[]; onOpen: (ref: EntityRef) => void }) {
  if (!ids.length) return null
  return (
    <ul className="detail-ids" aria-label="Identifiers">
      {ids.map((id) => (
        <li key={idKey(id)}>
          <button type="button" className="pill detail-id" data-kind="outline" aria-label={id.type ? `${TYPE_WORD[id.type]}: ${idLabel(id)}` : idLabel(id)} onClick={() => onOpen({ kind: "id", key: idKey(id) })} title={`${id.type ? TYPE_WORD[id.type] : "Record"}: see everything in this run that names it`}>
            {id.type && <span className="detail-id-type">{TYPE_WORD[id.type]} · </span>}{idLabel(id)}
          </button>
          <a className="detail-id-link small" href={id.href} target="_blank" rel="noreferrer noopener" aria-label={`Open ${idLabel(id)} at ${SCHEME_NAME[id.scheme]}`}>{SCHEME_NAME[id.scheme]} ↗</a>
        </li>
      ))}
    </ul>
  )
}

function SourceItem({ src, onOpen }: { src: SourceFact; onOpen: (ref: EntityRef) => void }) {
  const url = safeUrl(src.url)
  return (
    <li className="detail-source">
      <button type="button" className="link-btn detail-open" onClick={() => onOpen({ kind: "source", url: src.url })}>{src.title || src.url}</button>
      <span className="muted small">
        {[url ? new URL(url).hostname.replace(/^www\./, "") : "not a web address", providerName(src.provider), src.studyType && `kind of study: ${src.studyType}`].filter(Boolean).join(" · ")}
        {" "}<When at={src.at} prefix="kept at " />
      </span>
    </li>
  )
}

function ClaimItem({ g, who, onOpen, showAuthor }: { g: ClaimGroup; who: (id: string) => string; onOpen: (t: DetailTarget) => void; showAuthor?: boolean }) {
  const last = g.latest
  return (
    <li className="detail-claim">
      <MarkChip verdict={last.verdict} />
      <button type="button" className="link-btn detail-open" onClick={() => onOpen({ kind: "entity", ref: { kind: "claim", agent: g.agent, text: g.text } })}>{g.text}</button>
      <span className="muted small">
        {showAuthor && <>by <button type="button" className="link-btn" onClick={() => onOpen({ kind: "agent", id: g.agent })}>{who(g.agent)}</button> · </>}
        {g.rounds.length > 0 && <>{g.rounds.length > 1 ? `rounds ${g.rounds.join(", ")}` : `round ${g.rounds[0]}`} · </>}
        {g.rulings.length > 1 ? `${g.rulings.length} rulings, the latest by ${who(last.checker ?? "checker")}` : last.checker ? `ruled by ${who(last.checker)}` : "no checker recorded"}
        {last.quoteFound !== undefined && <> · quoted passage {last.quoteFound ? "found" : "not found"} in the source</>}
      </span>
    </li>
  )
}

function MarkLine({ marks, empty }: { marks: Record<Mark, number>; empty: string }) {
  const total = Object.values(marks).reduce((a, b) => a + b, 0)
  if (!total) return <p className="muted small">{empty}</p>
  return (
    <p className="detail-marks">
      {(["supported", "contradicted", "insufficient", "unchecked"] as Mark[]).filter((m) => marks[m] > 0).map((m) => (
        <MarkChip key={m} verdict={m === "supported" ? "verified" : m === "contradicted" ? "contradicted" : m === "insufficient" ? "unsupported" : "unchecked"} count={marks[m]} />
      ))}
    </p>
  )
}

function LogList({ rows, run, label, agent }: { rows: EventRow[]; run: DetailRun; label: string; agent: string }) {
  if (!rows.length) return <Unknown>No message from {label} is in the log yet.</Unknown>
  return (
    <>
      <ol className="detail-log">
        {rows.map((r) => (
          <li key={r.id}>
            <When at={r.at} />
            <span className="detail-log-kind">{r.kind}</span>
            <span className="detail-log-text">{r.text.split("\n")[0]}</span>
            {r.usd !== undefined && r.usd > 0 && r.costScope === "step" && <span className="mono small">${r.usd.toFixed(4)}</span>}
          </li>
        ))}
      </ol>
      <p className="small"><a href={logLink({ kind: run.kind, id: run.id }, agent)}>Its messages in the Agent Log</a> · <a href={logLink({ kind: run.kind, id: run.id })}>the whole run</a></p>
    </>
  )
}

function AgentBody({ p, facts, run, member, who, onOpen }: { p: AgentProfile; facts: RunFacts; run: DetailRun; member?: RosterMember; who: (id: string) => string; onOpen: (t: DetailTarget) => void }) {
  const checker = !!CHECKER_JOB[p.id] || p.id === "checker"
  const job = BOARD_JOB[p.id] ?? (run.kind === "answer" ? RESEARCH_JOB[p.id] : undefined) ?? CHECKER_JOB[p.id]
  const specialist = p.roster?.source === "specialist"
  const tools = member?.tools ?? (specialist ? [] : undefined)
  const usageWhy = p.usage ? undefined
    : run.kind !== "board" ? "This kind of run does not record tokens per agent."
      : checker ? "Checkers are counted in the run's total only, not per checker."
        : run.live ? (p.replies.length ? "This run was started by an engine that did not record each agent's tokens." : "Recorded with its first reply (the lead's when the run finishes).")
          : "Not recorded: this run was made before the engine recorded each agent's tokens."
  return (
    <>
      <div className="detail-now" data-state={p.now.state} role="status">
        <span className="pill" data-kind={p.now.state === "stopped" ? "danger" : p.now.state === "done" ? "success" : p.now.state === "absent" || p.now.state === "unknown" || p.now.state === "not-started" ? "outline" : "info"}>{STATE_WORD[p.now.state]}</span>
        <span>{p.now.text}</span> <When at={p.now.at} prefix="as of " />
      </div>

      <Section title="Role and purpose">
        <dl className="team-facts">
          {p.roster?.role && <><dt>Place</dt><dd>{p.roster.role === "lead" ? "Leads the review" : specialist ? "Method specialist, added for this run" : "Review member"}</dd></>}
          {job && <><dt>Job</dt><dd>{job[0].toUpperCase() + job.slice(1)}.</dd></>}
          {member?.purpose && <><dt>Purpose</dt><dd>{member.purpose}</dd></>}
          {member?.deliverable && <><dt>Delivers</dt><dd>{member.deliverable}</dd></>}
          {p.roster?.why && <><dt>Why it joined</dt><dd>{p.roster.why}</dd></>}
          {p.roster?.methods?.length ? <><dt>Method notes</dt><dd>{p.roster.methods.join(", ")}</dd></> : null}
          {member?.modes && <><dt>Roles it plays</dt><dd>{Object.values(member.modes).join(", ")}</dd></>}
        </dl>
        {!job && !member?.purpose && !p.roster?.why && <Unknown>The run does not record a job for this agent.</Unknown>}
      </Section>

      <Section title="Model and tools">
        <dl className="team-facts">
          <dt>Model</dt>
          <dd>{member ? <>{TIER_WORD[member.model] ?? member.model}: <code>{run.practice ? `practice: no model (a real run would use ${member.modelId})` : member.modelId}</code></> : p.model ? <code>{p.model}</code> : checker ? "A checker; its model, when the run recorded one, is on each ruling." : "Not recorded for this agent."}</dd>
          <dt>Tools</dt><dd>{tools === undefined ? "Not recorded for this agent." : tools.length ? tools.map((t) => TOOL_WORD[t] ?? t).join(", ") : specialist ? "None: reads method notes and runs nothing" : "None"}</dd>
        </dl>
      </Section>

      <Section title="Spend and tokens">
        {p.usage ? (
          <>
            <UsageLine usage={p.usage.tokens} practice={run.practice} />
            <p className="muted small">{p.usage.asOf === "finished" ? "Its own model use over the whole run." : `Its own model use so far, read when it replied${p.usage.round !== undefined ? ` in round ${p.usage.round}` : ""}.`} Searches and checks are counted in the run's total only.{run.practice && " In a practice run the tokens are the scripted model's own counts, not a real model's use."}</p>
          </>
        ) : p.stepUsd !== undefined ? <dl className="team-facts"><dt>Spend on its steps</dt><dd className="mono">${p.stepUsd.toFixed(4)}</dd></dl> : <Unknown>{usageWhy}</Unknown>}
      </Section>

      {(p.searches.length > 0 || member?.tools.some((t) => t.endsWith("_search"))) && (
        <Section title="Searches" count={p.searches.length}>
          {p.searches.length ? (
            <ol className="detail-searches">
              {p.searches.map((s) => (
                <li key={s.key}>
                  <span>{s.query ? `“${s.query}”` : s.label ?? "A search (query not recorded)"}</span>
                  <span className="muted small">
                    {[providerName(s.provider), s.round !== undefined && `round ${s.round}`, s.kept !== undefined && `kept ${s.kept}${s.dropped !== undefined ? ` of ${s.kept + s.dropped}` : ""}`].filter(Boolean).join(" · ")}
                    {" "}<When at={s.at} />
                  </span>
                </li>
              ))}
            </ol>
          ) : <Unknown>No search yet.</Unknown>}
        </Section>
      )}

      {(p.sources.length > 0 || p.searches.length > 0) && (
        <Section title="Sources it found" count={p.sources.length}>
          {p.sources.length ? <ul className="detail-list">{p.sources.map((s) => <SourceItem key={s.url} src={s} onOpen={(ref) => onOpen({ kind: "entity", ref })} />)}</ul> : <Unknown>Its searches kept no new source.</Unknown>}
        </Section>
      )}

      {!checker && (
        <Section title="Statements it made" count={p.claims.length}>
          <MarkLine marks={p.marks} empty={run.kind === "swarm" ? "Statements of this kind of run are on Compare." : "No checked statement yet."} />
          {p.claims.length > 0 && <ul className="detail-list">{p.claims.map((g) => <ClaimItem key={g.id} g={g} who={who} onOpen={onOpen} />)}</ul>}
        </Section>
      )}

      {p.rulings.length > 0 && (
        <Section title="Checks it made" count={p.rulings.length}>
          <MarkLine marks={p.ruled} empty="" />
          <ul className="detail-list">
            {p.rulings.map((r) => (
              <li key={r.key} className="detail-claim">
                <MarkChip verdict={r.verdict} />
                <button type="button" className="link-btn detail-open" onClick={() => onOpen({ kind: "entity", ref: { kind: "claim", agent: r.agent, text: r.text } })}>{r.text}</button>
                <span className="muted small">by {who(r.agent)}{r.round !== undefined && ` · round ${r.round}`}{r.checkedBy && ` · ${r.checkedBy === "scripted" ? "practice: no model" : r.checkedBy}`}{r.note && ` · ${r.note}`}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.replies.length > 0 && (
        <Section title="Replies" count={p.replies.length} open={false}>
          <ol className="detail-list">
            {p.replies.map((r) => <li key={r.key}><b>{r.round !== undefined ? `Round ${r.round}` : "Reply"}{r.mode && member?.modes?.[r.mode] ? `, as ${member.modes[r.mode]}` : ""}:</b> {r.summary ?? r.text.split("\n")[0]} <When at={r.at} /></li>)}
          </ol>
        </Section>
      )}

      {p.identifiers.length > 0 && (
        <Section title="Identifiers it named" count={p.identifiers.length}>
          <IdChips ids={p.identifiers} onOpen={(ref) => onOpen({ kind: "entity", ref })} />
        </Section>
      )}

      <Section title="Its log messages" count={p.rows.length} open={p.rows.length <= 8}>
        <LogList rows={p.rows} run={run} label={who(p.id)} agent={p.id} />
      </Section>
      {facts.kind === "board" && !p.roster && !checker && facts.roster.length > 0 && <p className="muted small">Not on this run's roster.</p>}
    </>
  )
}

function EntityBody({ e, run, who, onOpen }: { e: EntityProfile; run: DetailRun; who: (id: string) => string; onOpen: (t: DetailTarget) => void }) {
  const url = e.url ? safeUrl(e.url) : undefined
  return (
    <>
      {e.missing && <Unknown>{run.live ? "Nothing in this run names it yet. This panel fills in as the run goes on." : "Nothing in this run names it."}</Unknown>}
      {url && <p className="small"><a href={url} target="_blank" rel="noreferrer noopener">{e.ref.kind === "id" ? `Open at ${e.identifiers[0] ? SCHEME_NAME[e.identifiers[0].scheme] : "its database"}` : "Open the source"}</a> <span className="muted">({url})</span></p>}
      {e.text && e.text !== e.title && <Section title={e.ref.kind === "source" ? "What the search returned" : "Text"}><p className="detail-text">{e.text}</p></Section>}
      {e.facts.length > 0 && <dl className="team-facts">{e.facts.map((f, i) => <div key={`${f.label}${i}`} className="contents"><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
      {(e.firstAt !== undefined || e.lastAt !== undefined) && <p className="muted small">First seen <When at={e.firstAt} />{e.lastAt !== undefined && e.lastAt !== e.firstAt && <>, last <When at={e.lastAt} /></>}.</p>}

      <Section title="Identifiers" count={e.identifiers.length}>
        {e.identifiers.length ? <IdChips ids={e.identifiers} onOpen={(ref) => onOpen({ kind: "entity", ref })} /> : <Unknown>No UniProt, ChEMBL, ClinicalTrials.gov, PubMed, DOI or other identifier is written in it.</Unknown>}
      </Section>

      {e.ref.kind !== "source" && (
        <Section title={e.ref.kind === "claim" ? "Sources it names" : "Sources that mention it"} count={e.sources.length}>
          {e.sources.length ? <ul className="detail-list">{e.sources.map((s) => <SourceItem key={s.url} src={s} onOpen={(ref) => onOpen({ kind: "entity", ref })} />)}</ul> : <Unknown>{e.ref.kind === "claim" ? (e.claims[0]?.kind === "brief" ? "It was checked against the brief itself, not a source the team kept." : "The statement names no source the team kept.") : "No kept source mentions it."}</Unknown>}
        </Section>
      )}

      {e.ref.kind === "claim" ? (
        <Section title="Every check of it" count={e.claims[0]?.rulings.length ?? 0}>
          {e.claims[0] ? (
            <ol className="detail-list">
              {e.claims[0].rulings.map((r) => (
                <li key={r.key} className="detail-claim">
                  <MarkChip verdict={r.verdict} technical />
                  <span>{r.round !== undefined ? `Round ${r.round}: ` : ""}{r.checker ? <button type="button" className="link-btn" onClick={() => onOpen({ kind: "agent", id: r.checker! })}>{who(r.checker)}</button> : "a check"}{r.checkedBy && ` (${r.checkedBy === "scripted" ? "practice: no model" : r.checkedBy})`}</span>
                  {r.note && <span className="muted small">{r.note}</span>}
                  <When at={r.at} />
                </li>
              ))}
            </ol>
          ) : <Unknown>Not checked yet.</Unknown>}
        </Section>
      ) : (
        <Section title={e.ref.kind === "source" ? "Statements that rest on it" : "Statements about it"} count={e.claims.length}>
          {e.claims.length ? <ul className="detail-list">{e.claims.map((g) => <ClaimItem key={g.id} g={g} who={who} onOpen={onOpen} showAuthor />)}</ul> : <Unknown>No checked statement {e.ref.kind === "source" ? "cites it" : "names it"} yet.</Unknown>}
        </Section>
      )}

      <Section title="Who touched it, and when" count={e.touches.length}>
        {e.touches.length ? (
          <ol className="detail-touches">
            {e.touches.map((t, i) => (
              <li key={i}>
                <AgentAvatar name={t.agent} size={24} />
                <button type="button" className="link-btn" onClick={() => onOpen({ kind: "agent", id: t.agent })}>{who(t.agent)}</button>
                <span>{t.how}</span>
                <When at={t.at} />
              </li>
            ))}
          </ol>
        ) : <Unknown>No agent has touched it yet.</Unknown>}
      </Section>
    </>
  )
}

export interface DetailProps {
  run: DetailRun
  /** The run's raw events, as the engine streams them. */
  events: readonly LabEvent[]
  /** The run's Agent Log rows, when the caller has them (a swarm run); else they are made from the events. */
  rows?: readonly EventRow[]
  /** The engine's roster, when the caller has it. */
  roster?: readonly RosterMember[]
}
type HeadParts = { Title: ElementType; Description: ElementType }

/**
 * One agent's or entity's details, with Back. A new `target` from outside starts afresh. `parts`: the heading's
 * elements (a Sheet passes its own title and description, so the dialog is named).
 */
export function DetailView({ target, run, events, rows: givenRows, roster, parts = { Title: "h3", Description: "p" } }: DetailProps & { target: DetailTarget; parts?: HeadParts }) {
  // A stack, so an agent's statement can be opened and Back returns to the agent.
  const [stack, setStack] = useState<DetailTarget[]>([target])
  const [seen, setSeen] = useState(target)
  if (!sameTarget(seen, target)) { setSeen(target); setStack([target]) }
  const top = stack.at(-1) ?? target
  const facts = useMemo(() => runFacts(events, run.kind), [events, run.kind])
  const rows = useMemo(() => givenRows ?? (run.kind === "swarm" ? [] : eventRows(events, run.kind)), [givenRows, events, run.kind])
  const titles = useMemo(() => new Map([...(roster ?? []).map((m) => [m.name, m.title] as const), ...facts.roster.flatMap((m) => (m.title ? [[m.name, m.title] as const] : []))]), [roster, facts.roster])
  const who = (id: string) => CHECKER_NAME[id] ?? rows.find((r) => r.agentId === id)?.agent ?? agentIdentity(id, { title: titles.get(id) }).label
  const open = (t: DetailTarget) => setStack((s) => (s.length && sameTarget(s.at(-1)!, t) ? s : [...s, t]))
  const agent = top.kind === "agent" ? agentProfile(facts, rows, top.id) : undefined
  const entity = top.kind === "entity" ? entityProfile(facts, top.ref) : undefined
  const member = agent ? roster?.find((m) => m.name === agent.id) : undefined
  const practice = run.practice ?? facts.scripted
  const r: DetailRun = { ...run, practice }
  const { Title, Description } = parts
  return (
    <div className="detail-view" data-target={top.kind}>
      <div className="member-panel-head detail-head">
        {stack.length > 1 && <Button type="button" variant="ghost" size="sm" className="detail-back" onClick={() => setStack((s) => s.slice(0, -1))}><ArrowLeftIcon aria-hidden />Back</Button>}
        {agent ? <AgentAvatar name={agent.id.replace(/^specialist:/, "")} size={40} /> : null}
        <p className="detail-eyebrow">{agent ? (CHECKER_JOB[agent.id] ? "Checker" : "Agent") : entity?.kindWord} · {run.kind === "board" ? "team review" : run.kind === "answer" ? "research answer" : "team of nine"}{practice ? " · practice run" : ""}{run.live ? " · live" : ""}</p>
        <Title className="detail-title">{agent ? who(agent.id) : entity?.title}</Title>
        <Description className="detail-description">{agent ? "Everything this agent did in this run, from its recorded events." : "Everything this run recorded about it."}{run.live ? " Fills in as the run goes on." : ""}</Description>
      </div>
      <div className="member-panel-body detail-body" key={stack.length + (top.kind === "agent" ? top.id : refKey(top.ref))}>
        {agent && <AgentBody p={agent} facts={facts} run={r} member={member} who={who} onOpen={open} />}
        {entity && <EntityBody e={entity} run={r} who={who} onOpen={open} />}
      </div>
    </div>
  )
}

/** The details in a side sheet. Closed while `target` is undefined. */
export function DetailSheet({ target, onClose, ...props }: DetailProps & { target?: DetailTarget; onClose: () => void }) {
  return (
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="member-panel detail-panel">
        {target && <DetailView target={target} {...props} parts={{ Title: SheetTitle, Description: SheetDescription }} />}
      </SheetContent>
    </Sheet>
  )
}
const sameTarget = (a: DetailTarget, b: DetailTarget) => (a.kind === "agent" && b.kind === "agent" ? a.id === b.id : a.kind === "entity" && b.kind === "entity" ? refKey(a.ref) === refKey(b.ref) : false)
