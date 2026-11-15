// AI Scientist Swarm (GLHF). By default a plain summary: where the run is, what it scored, what was
// rejected. "Show details" opens the timeline, every claim with its tests, the critic's issues and the reports.
import { useEffect, useRef, useState } from "react"
import { Streamdown } from "streamdown"
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation"
import { Loading } from "@/components/Crew"
import { EngineOffline, ModeLabel, PageHead, RunId, StatusPill, Verdict } from "@/components/Shared"
import { TeamMessage, type Checked } from "@/components/Thread"
import { outcomeOf } from "@/lib/verdict"
import { VERDICT_WORD, verdictCount } from "@/lib/words"
import { swarmScripted } from "@/lib/scripted"
import { runState } from "@/lib/status"
import { fmtDuration, fmtScore, fmtTokens, plainDuration, plainLimit, plainWhen } from "@/lib/format"
import {
  isDemo, isLive, useSwarm,
  type GlhfRun, type Ledger, type LedgerClaim, type LedgerEvent, type ScoreCell, type ScoreRow, type Solver,
} from "@/swarm/api"
import { CancelRun } from "@/swarm/CancelRun"
import { NewRun } from "@/swarm/NewRun"
import { lastRun, linkTo, setOpen, showing, takeOpen } from "@/lib/open"
import { ROLES, roleOf, type RoleKey } from "@/swarm/roles"
import "@/swarm/swarm.css"

const round = (phase: string) => phase.match(/\d+/)?.[0]
const num = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "–" : String(Number(x.toPrecision(3))))
const score = fmtScore
const STEP_TEXT = { now: "● working", done: "✓ ran", todo: "○ did not run" } as const
const ABOUT = "The same task, done two ways: by one AI agent working alone, and by a team of nine that check each other. This page shows what each did and how it scored."
const plainScore = (x: number | undefined) => (x === undefined ? "nothing" : `${fmtScore(x)} out of 1`)
const solverName = (s: Solver) => (s === "glhf" ? "Team of nine" : "One agent alone")
const text = (x: unknown) => (typeof x === "string" || typeof x === "number" ? String(x) : "")

function phases(ledger: Ledger | null) {
  const events = ledger?.events ?? []
  const started = events.filter((e) => e.kind === "phase.started").map((e) => e.phase ?? "")
  const last = events.findLast((e) => e.kind === "phase.started" || e.kind === "phase.finished")
  const current = last?.kind === "phase.started" ? last.phase : undefined
  return { started, current }
}

/** The run's recorded events, grouped into one entry per role and round, in the order the roles worked. */
function activity(ledger: Ledger) {
  const entries: { phase: string; role?: (typeof ROLES)[number]; round?: string; lines: string[]; checks: Checked[]; flag?: string }[] = []
  const byId = new Map(ledger.claims.map((c) => [c.id, c]))
  for (const e of ledger.events) {
    if (e.kind === "phase.started") { const phase = e.phase ?? ""; entries.push({ phase, role: ROLES.find((r) => r.key === roleOf(phase)), round: round(phase), lines: [], checks: [] }); continue }
    const at = entries.at(-1)
    const line = describe(e)
    if (!at) continue
    if (line) at.lines.push(line)
    // A statement gets its chip where it was written down; the chip shows how its tests came out in the end.
    const claim = e.kind === "claim.added" ? byId.get(text(e.claim)) : undefined
    if (claim) {
      const results = claim.tests
      at.checks.push({
        key: `${at.phase}:${claim.id}`, verdict: claim.verdict, claim: `${claim.id}: ${claim.text}`, by: "code, from the results of the team's own tests",
        source: results.length ? `${results.length} test${results.length === 1 ? "" : "s"} run inside this run: ${results.map((t) => t.name).join(", ")}` : "the run's own tests",
        why: claim.verdict === "refuted" ? (claim.replication_failed ? "It could not be reproduced independently." : "A test's result went against it.")
          : claim.verdict === "supported" ? "It passed every test that was planned for it before the results were known."
          : results.length ? "Its tests did not give enough evidence either way." : "No test of it has a result.",
      })
    }
    // Disagreement, as recorded: a test that went against a statement, or a problem a reviewer raised.
    if (e.kind === "test.recorded" && e.contradicts) at.flag = `Tested ${text(e.claim)} and the result went against it.`
    else if (e.kind === "replication.failed") at.flag = `Could not reproduce ${text(e.claim)}.`
    else if (e.kind === "issue.raised" && !at.flag) at.flag = `Found a problem with the work: ${text(e.problem)}`
  }
  return entries
}

const TASK_NAME: Record<string, string> = { demo: "The demo task: a small made-up dataset, used to test that everything works" }
const taskName = (task: string) => TASK_NAME[task] ?? `Task ${task}`
const runLabel = (r: GlhfRun) => `${solverName(r.solver)} on ${r.task === "demo" ? "the demo task" : r.task} · ${plainWhen(r.startedAt)} · ${runState(r.phase, r.score !== undefined)}`

function headline(run: GlhfRun | undefined, current: string | undefined, missing?: string): string {
  if (!run && missing) return "That run could not be found. It may have been deleted. Pick another one from the list above."
  if (!run) return "Nothing has run yet. Press New run to watch the team work on a small demo task. It is a practice run and costs nothing."
  const who = run.solver === "glhf" ? "The team" : "The agent working alone"
  if (run.phase === "failed") return "This run stopped with an error."
  if (run.phase === "cancelled") return "This run was cancelled. It has no score."
  if (run.phase === "queued" && run.after) return "Waiting in the queue. This run starts when the run before it has ended."
  if (run.phase === "done") return run.score === undefined ? `${who} finished, but its results were not scored.` : isDemo(run) ? `${who} finished this ${run.model === "mock" ? "practice run" : "demo task"}. Its score, ${plainScore(run.score)}, is not a research result.` : `${who} finished and scored ${plainScore(run.score)}.`
  if (run.phase === "queued" || run.phase === "launching") return "Starting the run…"
  if (run.phase === "completing") return "Collecting the results and scoring them…"
  if (run.solver === "single") return "One agent is working through the whole analysis alone."
  const n = current ? round(current) : undefined
  switch (roleOf(current)) {
    case "scout": return "The Scout is inspecting the data and the tools."
    case "pilot": return "The Pilot is trying the whole analysis on a small sample."
    case "audit": return `The Auditor is checking the scripts against the stated methods${n ? ` (review round ${n})` : ""}.`
    case "finish": return "The Finisher is recovering results that were still missing."
    case "propose": return "The Proposer is planning the analysis and writing down statements to test."
    case "experiment": return "The Experimenter is running the analysis and writing the results."
    case "critique": return `The Critic is checking the work and trying to disprove each statement${n ? ` (review round ${n})` : ""}.`
    case "revise": return `The Reviser is fixing the problems the reviewers found${n ? ` (round ${n})` : ""}.`
    case "report": return "The Reporter is writing up what was actually done."
    default: return "The team is working…"
  }
}

const plainVerdict = (v: unknown) => (v === "supported" || v === "refuted" || v === "insufficient" || v === "untested" ? `${VERDICT_WORD[outcomeOf(v)].toLowerCase()} (${v})` : text(v))

function describe(e: LedgerEvent): string | undefined {
  switch (e.kind) {
    case "claim.added": return `Wrote down statement ${text(e.claim)}: ${text(e.text)}`
    case "test.recorded":
      return `Tested ${text(e.claim)} (${text(e.name)}). ${e.contradicts ? "The result went against the statement" : "The result did not go against the statement"} (p = ${num(Number(e.p))}). The statement now: ${plainVerdict(e.verdict)}.`
    case "test.registered": return `Planned a test of ${text(e.claim)} (${text(e.name)}) before seeing any result: ${text(e.method)}`
    case "replication.failed": return `${text(e.claim)} could not be reproduced independently: ${text(e.note)}`
    case "issue.raised": return `Found a problem, ${text(e.issue)} (${text(e.severity)}): ${text(e.problem)}`
    case "issue.resolved": return `${e.status === "fixed" ? "Fixed" : "Closed without a fix:"} problem ${text(e.issue)}`
    case "review.converged": return `Review round ${text(e.round)} found nothing left to fix, so review ended.`
    case "review.skipped": return `Review round ${text(e.round)} skipped: out of time.`
    case "phase.finished": return e.limit_hit ? "This step ran out of time." : undefined
    case "finished": return `Last check that every required file is there and has the right shape: ${text(e.contract)}`
    default: return undefined
  }
}

const budget = (row: ScoreRow) => [
  row.timeLimit ? `time limit ${fmtDuration(row.timeLimit * 1000)}` : "benchmark time limit",
  row.maxTokens ? `${fmtTokens(row.maxTokens)} tokens` : "no token budget",
].join(" · ")

/** One side of a scoreboard row: the score, a failed mark, the extras this run had, and a way to open it. */
function ScoreCellView({ cell, onOpen }: { cell: ScoreCell | undefined; onOpen: (id: string) => void }) {
  if (!cell) return <span className="muted">no run</span>
  const state = runState(cell.phase, cell.score !== undefined)
  const what = state === "done" ? `score ${fmtScore(cell.score)}` : state
  return (
    <button type="button" className="swarm-cell" onClick={() => onOpen(cell.id)} title={`Open ${cell.id}`}
      aria-label={`Open run ${cell.id}: ${[what, ...cell.extras].join(", ")}`}>
      <b>{fmtScore(cell.score)}</b>
      {state !== "done" && <StatusPill state={state} />}
      {cell.extras.map((e) => <span key={e} className="pill" data-kind="outline">{e}</span>)}
    </button>
  )
}

export function SwarmView() {
  const [picked, setPicked] = useState<string | undefined>(() => takeOpen("swarm") ?? lastRun("swarm"))
  const [copied, setCopied] = useState(false)
  useEffect(() => showing("swarm", picked), [picked])
  const [nudge, setNudge] = useState(0)
  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<string>()
  const [details, setDetails] = useState(() => localStorage.getItem("swarm.details") === "1")
  useEffect(() => localStorage.setItem("swarm.details", details ? "1" : "0"), [details])
  const { status, runs, detail, offline, problem, scoreboard } = useSwarm(picked, nudge)
  const page = useRef<HTMLDivElement>(null)
  const runCard = useRef<HTMLElement>(null)
  // The run a scoreboard cell opens is shown below the scoreboard, so bring it into view.
  const openRun = (id: string) => { setPicked(id); runCard.current?.scrollIntoView({ behavior: "smooth", block: "start" }) }

  if (offline && !runs) return (
    <div className="page swarm">
      <PageHead title="One agent or a team?" about={ABOUT} />
      <EngineOffline needs="Runs and scores come from the engine. The demo task also needs Docker, but no API keys." said={problem.said} onRetry={() => setNudge((n) => n + 1)} />
    </div>
  )

  if (!runs) return <div className="page swarm"><PageHead title="One agent or a team?" about={ABOUT} /><p className="muted" role="status">Loading runs…</p></div>

  const list = runs
  const runId = picked ?? list[0]?.id
  // The detail belongs to the selected run only once the poll for it has landed.
  const current = detail?.run.id === runId ? detail : undefined
  const run = current?.run ?? list.find((r) => r.id === runId)
  const ledger = current?.ledger ?? null
  const { started, current: activePhase } = phases(ledger)
  const live = run ? isLive(run) : false
  const activeRole = live ? roleOf(activePhase) : undefined
  const seen = new Set(started.map(roleOf))
  const claims = ledger?.claims ?? []
  const issues = ledger?.issues ?? []
  const count = {
    supported: claims.filter((c) => c.verdict === "supported").length,
    refuted: claims.filter((c) => c.verdict === "refuted").length,
    open: claims.filter((c) => c.verdict === "insufficient" || c.verdict === "untested").length,
    fixed: issues.filter((i) => i.status === "fixed").length,
  }
  const noKeys = status && !status.keys.ANTHROPIC_API_KEY && !status.keys.OPENAI_API_KEY
  const record = status?.record ?? 0.523
  // "Record to beat" is about BixBench3 tasks. With only demo rows the column would say "does not apply" on every row.
  const anyBenchmark = (scoreboard ?? []).some((row) => row.task !== "demo")
  const byId = (id: string | undefined) => list.find((r) => r.id === id)
  const partner = byId(run?.pairedWith)
  const queuedBehind = (id: string | undefined) => list.find((r) => r.after === id && isLive(r))
  const stage = activeRole ? ROLES.findIndex((r) => r.key === activeRole) : -1
  const progress = !run ? 0 : !live ? 1 : run.solver === "single" || stage < 0 ? 0.1 : (stage + 0.5) / ROLES.length

  /** Where a role stands in the selected run, in words: this must not rest on the character's mood alone. */
  const step = (key: RoleKey): "now" | "done" | "todo" => (activeRole === key ? "now" : run && seen.has(key) ? "done" : "todo")

  return (
    <div className="page swarm" ref={page}>
      <PageHead title="One agent or a team?" about={ABOUT}>
        {noKeys && <span className="pill" data-kind="warning" title="The engine has no model API keys. Only practice runs (fixed steps, no model) can run.">Practice runs only</span>}
        {offline && <span className="pill" data-kind="danger" title={`${problem.said ?? "The engine cannot be reached."} Showing the last data received. Retrying every 15 seconds.`}>{problem.said ? "Engine error" : "Engine offline"}</span>}
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New run</button>
      </PageHead>
      <NewRun open={creating} status={status} onClose={() => setCreating(false)}
        onStarted={(ids) => { setPicked(ids[0]); setNudge((n) => n + 1) }} onOpenRun={openRun} />
      <CancelRun run={byId(cancelling)} queuedBehind={queuedBehind(cancelling)} onClose={() => setCancelling(undefined)} onCancelled={() => setNudge((n) => n + 1)} />


      <section className="swarm-status swarm-story" aria-label="Run" ref={runCard}>
        <div className="board-bar">
          <label className="board-pick">
            <span className="small muted">Showing</span>
            <select aria-label="Run to show" value={runId ?? ""} title={runId} onChange={(e) => setPicked(e.target.value || undefined)}>
              {list.length === 0 && <option value="">No runs yet</option>}
              {runId && !list.some((r) => r.id === runId) && <option value={runId}>{run ? runLabel(run) : `${runId} · not found`}</option>}
              {list.map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
            </select>
          </label>
          {run && live && <button type="button" className="btn" onClick={() => setCancelling(run.id)}>Cancel run</button>}
        </div>
        <div className="story">
          {run && (
            <>
              <p className="story-eyebrow">{run.solver === "glhf" ? "A team of nine agents worked on" : "One agent, working alone, worked on"}</p>
              <h2 className="story-title">{taskName(run.task)}</h2>
              <p className="story-facts">
                <StatusPill state={runState(run.phase, run.score !== undefined)} />
                <ModeLabel scripted={swarmScripted(run)} demo={run.task === "demo"} />
                <span className="muted small">
                  Started {plainWhen(run.startedAt)}
                  {run.finishedAt !== undefined && <> · took {plainDuration(run.finishedAt - run.startedAt)}</>}
                  {run.settings?.timeLimit !== undefined && <> · {plainLimit(run.settings.timeLimit)}</>}
                  {swarmScripted(run) && " · cost nothing (practice run)"}
                </span>
              </p>
            </>
          )}
          <p className="story-headline" role="status">{headline(run, activePhase, runId)}</p>
          {run?.solver === "glhf" && ledger && count.refuted > 0 && <p className="thread-flag story-flag"><span aria-hidden="true">✕</span> {count.refuted === 1 ? "One statement was proven wrong" : `${count.refuted} statements were proven wrong`} by the team's own tests. Look for the marked steps below.</p>}
        </div>
        {run?.phase === "done" && (
        <div className="swarm-result" role="group" aria-label="Result">
          <p className="swarm-resulthead"><span className="story-eyebrow">The score</span></p>
          {isDemo(run) && (
            <p className="swarm-note swarm-notbench">
              This is not a research result.{run.task === "demo" && " The demo task is a small made-up dataset, used to test that everything works."}
              {run.model === "mock" && " A practice run replays fixed steps and does no real analysis."}
            </p>
          )}
          <div className="swarm-score" data-demo={isDemo(run) || undefined}>
            <strong>{score(run.score)}</strong>
            <span className="muted">{run.score === undefined ? "not scored: the scoring program gave no score for this run" : "out of 1. A scoring program checked the files this run wrote; no model decides the score."}</span>
          </div>
          {run.artifacts && run.artifacts.length > 0 && (
            <ul className="swarm-artifacts" aria-label="Score per required output">
              {run.artifacts.map((a) => <li key={a.artifact_id}>{a.artifact_id}<b>{score(a.score)}</b></li>)}
            </ul>
          )}
          {run.solver === "glhf" && ledger && (
            <p className="swarm-counts">
              <Verdict verdict="supported" count={count.supported} />
              <Verdict verdict="refuted" count={count.refuted} />
              <Verdict verdict="untested" count={count.open} />
              <span className="muted small">of {claims.length} statement{claims.length === 1 ? "" : "s"} the team tested · {count.fixed} problem{count.fixed === 1 ? "" : "s"} found by review and fixed</span>
            </p>
          )}
          {run.solver === "single" && <p className="swarm-note">One agent alone has nobody checking it, so there are no tested statements or rejections to show.</p>}
        </div>
        )}
        <ol className="swarm-steps" aria-label="Roles, in the order they run">
          {run?.solver === "single" ? (
            <li data-step={live ? (run.phase === "queued" ? "todo" : "now") : run.phase === "done" ? "done" : "todo"}>
              <span>One agent alone</span>
              <span className="swarm-step">{live ? (run.phase === "queued" ? "○ waiting" : STEP_TEXT.now) : run.phase === "done" ? STEP_TEXT.done : `○ ${run.phase}`}</span>
            </li>
          ) : ROLES.map((r, i) => (
            <li key={r.key} data-step={step(r.key)} title={r.does} aria-current={step(r.key) === "now" ? "step" : undefined}>
              <span>{i + 1} {r.name}</span>
              <span className="swarm-step">{run ? STEP_TEXT[step(r.key)] : "○ no run yet"}</span>
            </li>
          ))}
        </ol>
        {!run && list.length === 0 && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New run</button>}
        {run && live && (
          <div className="swarm-live">
            <div className="swarm-progress" aria-hidden="true"><span style={{ width: `${run.phase === "queued" ? 0 : progress * 100}%` }} /></div>
            <p className="swarm-note">{run.detail ?? "Working…"} · {run.phase === "queued" ? "waiting" : "running"} for <Elapsed since={run.startedAt} /></p>
            <p className="swarm-note">
              {run.phase === "queued" ? "Nothing has run yet."
                : run.solver === "glhf"
                ? <>So far: {claims.length} statement{claims.length === 1 ? "" : "s"} written down, {verdictCount("holds", count.supported)}, {verdictCount("fails", count.refuted)}, {issues.length} problem{issues.length === 1 ? "" : "s"} raised by the reviewers.</>
                : "One agent alone keeps no list of statements, so there is nothing to count until it finishes."}
            </p>
          </div>
        )}
        {run?.phase === "cancelled" && run.detail && <p className="swarm-note">{run.detail}</p>}
        {run && (run.pairedWith || run.after || run.note) && (
          <div className="swarm-relations">
            {run.pairedWith && (
              <p>
                Paired with <RunLink id={run.pairedWith} onOpen={openRun} />
                {partner && <> ({solverName(partner.solver).toLowerCase()}) <StatusPill state={runState(partner.phase, partner.score !== undefined)} /></>}
                <span className="muted"> · same task, model, time limit, text limit and seed</span>
              </p>
            )}
            {run.after && (
              <p>{run.phase === "queued" ? "Starts when" : "Was queued behind"} <RunLink id={run.after} onOpen={openRun} />{run.phase === "queued" && " has ended"}</p>
            )}
            {run.note && <p className="swarm-rownote">Note: {run.note}</p>}
          </div>
        )}
        {run?.phase === "failed" && <p className="pill swarm-failure" data-kind="danger" role="alert">{run.error ?? "No error message was recorded."}</p>}
      </section>

      <section className="talk" aria-label="What each role did">
        <h2 className="talk-title">The work, step by step {live && <span className="pill" data-kind="info">live</span>}</h2>
        <p className="muted small">One entry for each role, in the order they worked. These lines are written by code from what the run recorded, not by a model. The chips show how each statement the team made did when it was tested.</p>
        {!run ? null : !ledger ? <p className="empty-note">{run.solver === "single" ? "One agent working alone keeps no shared notes, so there are no steps to show. Its score is above." : "Nothing recorded yet."}</p> : (
          <Conversation className="thread-inline" aria-label="What each role did, in order">
            <ConversationContent className="thread-list">
              {activity(ledger).map((entry) => (
                <TeamMessage key={entry.phase} name={`${entry.role?.name ?? entry.phase}${entry.round ? `, round ${entry.round}` : ""}`} job={entry.role?.does}
                  short={entry.lines.at(-1) ?? "Did its part. It added nothing to the team's shared notes."} text={entry.lines.join("\n")}
                  fullLabel={`Show everything this role recorded (${entry.lines.length})`} checks={entry.checks} flag={entry.flag}
                  state={entry.phase === activePhase && live ? <span className="pill" data-kind="info">working now</span> : undefined} />
              ))}
              {live && <Loading>{headline(run, activePhase, runId)}</Loading>}
            </ConversationContent>
          </Conversation>
        )}
      </section>

      <section className="card-surface swarm-card swarm-board" aria-label="Scoreboard">
        <div className="swarm-cardhead">
          <h2>Side by side: one agent against the team</h2>
          <span className="muted small">The latest run of each kind on the same task with the same settings. Press a score to open that run.</span>
        </div>
        {scoreboard === undefined ? <p className="muted small" role="status">Loading the scores…</p>
          : scoreboard === null ? <p role="alert" className="swarm-rownote">The engine did not return a scoreboard. Stop the app and start it again with <code>npm start</code> to get the current version.</p>
          : scoreboard.length === 0 ? (
            <p className="swarm-empty">No finished runs yet. Press <b>New run</b> and choose <b>Both, to compare</b>. The two runs then appear here side by side.</p>
          ) : (
          <div className="swarm-scroll">
          <table className="swarm-table" aria-label="One agent against the team, per task and settings">
            <thead><tr>
              <th scope="col">Task and shared settings</th><th scope="col">One agent alone</th><th scope="col">Team of nine</th>
              <th scope="col" className="num">Difference</th>{anyBenchmark && <th scope="col" className="num">Record to beat</th>}
            </tr></thead>
            <tbody>
              {scoreboard.map((row) => {
                const label = [row.task === "demo" && "demo case", row.model === "mock" && "practice run"].filter(Boolean).join(", ")
                return (
                  <tr key={`${row.task}|${row.model}|${row.timeLimit}|${row.maxTokens}`}>
                    <td>
                      {row.task}{label && <> <span className="pill" data-kind="warning">{label}</span></>}
                      <div className="muted small"><code>{row.model}</code> · {budget(row)}</div>
                      {row.note && <div className="swarm-rownote">{row.note}</div>}
                    </td>
                    <td><ScoreCellView cell={row.single} onOpen={openRun} /></td>
                    <td><ScoreCellView cell={row.swarm} onOpen={openRun} /></td>
                    <td className="num">{row.diff === undefined ? "–" : row.diff === 0 ? "0.000 (tie)" : `${row.diff > 0 ? "+" : "−"}${fmtScore(Math.abs(row.diff))}`}</td>
                    {anyBenchmark && <td className="num">{row.task === "demo" ? <span className="muted">does not apply</span> : fmtScore(record)}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
        <details className="swarm-help">
          <summary>How to read this</summary>
          <div>
            <h3>Score</h3>
            <p>A scoring program checks the files that a run wrote. The score goes from 0 to 1. A score of 1 means every required result was correct. No model decides the score.</p>
            <h3>Statements</h3>
            <p>The team writes down what it thinks it found. Each of these is a statement (experts say "claim"). Then it tests each one and tries to prove it wrong.</p>
            <ul>
              <li><Verdict verdict="supported" technical /> The statement passed its tests. It counts as a finding.</li>
              <li><Verdict verdict="refuted" technical /> A test went against the statement. It is rejected and is not reported as a finding.</li>
              <li><Verdict verdict="insufficient" technical /> There was not enough evidence, or a planned test has no result, or no test was run. It is not reported as a finding.</li>
            </ul>
            <p>Code decides each result from the test numbers. One agent alone has no reviewer, so it has no tested statements.</p>
            <h3>Difference</h3>
            <p>The difference is the team's score minus the lone agent's score. It is shown only when both runs had the same task, model, time limit and text limit (tokens).
              If these settings are not the same, a higher score could come from more time or more text, and not from the team. Then the row shows a note and no difference.</p>
            <p>Extras, such as Exa search, memory or the number of review rounds, are listed next to each run. They show what one run had and the other did not.</p>
            <h3>Record to beat</h3>
            <p>{fmtScore(record)} is the best published BixBench3 score across its 20 studies. It applies to BixBench3 tasks only. The score of one task is not the same measure as the score of the whole benchmark.
              A run on the demo task, or a practice run, is never a benchmark result.</p>
          </div>
        </details>
      </section>



      {run && (
        <nav className="next-steps" aria-label="What you can do next">
          <p className="story-eyebrow">{live ? "While you wait" : "What next?"}</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={live}>Run it again, both ways</button>
          <button type="button" className="btn" aria-pressed={details} onClick={() => setDetails(!details)}>{details ? "Hide the tests, problems and reports" : "See how each statement was tested"}</button>
          <a className="btn" href="#Graph" onClick={() => setOpen("swarm", run.id)}>Watch it as a graph</a>
          <button type="button" className="link-btn" onClick={() => { void navigator.clipboard?.writeText(linkTo("swarm", run.id)).then(() => setCopied(true), () => setCopied(false)) }}>{copied ? "Link copied" : "Copy a link to this run"}</button>
        </nav>
      )}

      {details && run && (
        <div className="swarm-grid">
          <section className="card-surface" aria-label="Statements and problems">
            <h2>Statements the team tested ({claims.length})</h2>
            {ledger && (
              <p className="swarm-note">
                A statement counts as a finding only if it survives tests that could prove it wrong. Each test gives a number (a p-value), which code turns into
                an evidence score (experts call it an e-value).{" "}
                {ledger.combination
                  ? <>Tests are planned (registered) before any result exists. A statement's score is the average over its planned tests, and a planned test
                    with no result counts as 0. With {ledger.claims_in_family ?? claims.length} claim{(ledger.claims_in_family ?? claims.length) === 1 ? "" : "s"} in
                    this run, a statement holds up at {num(ledger.support_threshold ?? 1 / ledger.alpha)} or more, and only when every planned test has a result.</>
                  : <>Scores multiply across tests, and a statement holds up at {num(1 / ledger.alpha)} or more.</>}
                {" "}No model decides the result.
              </p>
            )}
            {claims.length === 0 && <p className="muted small">{run.solver === "single" ? "A single agent writes down no statements to test." : "None yet."}</p>}
            {claims.map((c) => (
              <article key={c.id} className="swarm-claim">
                <header><Verdict verdict={c.verdict} technical /><b>{c.id}</b><span className="muted small">from {c.proposed_by}</span></header>
                <p>{c.text}</p>
                <p className="swarm-note">If the statement were false: {c.null_hypothesis}</p>
                <p className="swarm-note">
                  Evidence score from its tests (e-value): {num(c.e_value)}. Needed to hold up: {num(c.threshold ?? 1 / (ledger?.alpha ?? 0.1))}
                  {c.replication_failed && " · independent replication failed"} · result files: {c.artifact_ids.join(", ") || "none"}
                </p>
                <ClaimTests claim={c} />
              </article>
            ))}
            <h2>Problems the reviewers raised ({issues.length})</h2>
            {issues.length === 0 && <p className="muted small">None.</p>}
            {issues.map((i) => (
              <article key={i.id} className="swarm-issue">
                <header>
                  <span className={`pill sv-${i.severity}`}>{i.severity}</span><span className={`pill sv-${i.status}`}>{i.status}</span>
                  <b>{i.id}</b><span className="muted small">from {i.raised_by} · result files: {i.artifact_ids.join(", ") || "none"}</span>
                </header>
                <p>{i.problem}</p>
                {i.evidence && <p className="swarm-note">Evidence: <code>{i.evidence}</code></p>}
                {i.resolution && <p className="swarm-note">{i.status === "fixed" ? "Fix" : "Response"}: {i.resolution}</p>}
              </article>
            ))}
          </section>

          <section className="card-surface" aria-label="Reports">
            <h2>Findings and rejections</h2>
            {current?.findings ? <div className="swarm-doc"><Streamdown>{current.findings}</Streamdown></div>
              : <p className="muted small">{run.solver === "single" ? "Only the team writes this report." : "Written when the run finishes."}</p>}
            <h2>Methods</h2>
            {current?.methods ? <div className="swarm-doc"><Streamdown>{current.methods}</Streamdown></div>
              : <p className="muted small">Not written yet.</p>}
          </section>
          <details className="card-surface swarm-more">
            <summary>Settings of this run, and how much text the models read and wrote</summary>
            <h2>Run settings</h2>
            <dl className="swarm-settings">
              <dt>Run</dt><dd><RunId id={run.id} /></dd>
              <dt>Task</dt><dd>{run.task}</dd>
              <dt>Who</dt><dd>{solverName(run.solver)}</dd>
              <dt>Where</dt><dd>{run.mode === "cloud" ? "Cloud VM" : "This machine"}</dd>
              <dt>Model</dt><dd><code>{run.model}</code></dd>
              {Object.entries(run.roleModels).map(([role, model]) => (
                <div key={role} style={{ display: "contents" }}><dt>{role}</dt><dd><code>{model}</code></dd></div>
              ))}
              <dt>Time limit</dt><dd>{run.settings?.timeLimit ? fmtDuration(run.settings.timeLimit * 1000) : "benchmark default"}</dd>
              <dt>Text limit (tokens)</dt><dd>{run.settings?.maxTokens ? fmtTokens(run.settings.maxTokens) : "none"}</dd>
              {run.solver === "glhf" && <><dt>Review rounds</dt><dd>{run.settings?.reviewRounds ?? 3}</dd></>}
              {run.settings?.maxMessagesPerRole !== undefined && <><dt>Messages per role</dt><dd>{run.settings.maxMessagesPerRole}</dd></>}
              {run.solver === "glhf" && <><dt>Exa search</dt><dd>{run.settings?.exa ? "on" : "off"}</dd><dt>Memory</dt><dd>{run.settings?.memory ? "on" : "off"}</dd></>}
              {run.settings?.seed !== undefined && <><dt>Seed</dt><dd>{run.settings.seed}</dd></>}
              <dt>Started</dt><dd>{new Date(run.startedAt).toLocaleString()}</dd>
              {run.finishedAt !== undefined && <><dt>Took</dt><dd>{fmtDuration(run.finishedAt - run.startedAt)}</dd></>}
            </dl>
            {run.usage && Object.keys(run.usage).length > 0 && (
              <>
                <h2>Tokens used</h2>
                <table className="swarm-table">
                  <thead><tr><th scope="col">Model</th><th scope="col" className="num">In</th><th scope="col" className="num">Out</th></tr></thead>
                  <tbody>
                    {Object.entries(run.usage).map(([model, u]) => (
                      <tr key={model}><td><code>{model}</code></td><td className="num">{fmtTokens(u.input_tokens)}</td><td className="num">{fmtTokens(u.output_tokens)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </details>

        </div>
      )}
    </div>
  )
}


/** Shows a duration that keeps counting, without reading the clock during render. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState<number>()
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick, 0), timer = window.setInterval(tick, 1000)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [])
  return <span className="swarm-elapsed">{now === undefined ? "–" : fmtDuration(Math.max(0, now - since))}</span>
}

/** A run id that opens that run. Cut to fit; the whole id is in the title. */
function RunLink({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  return <button type="button" className="link-btn swarm-runlink" title={`Open ${id}`} onClick={() => onOpen(id)}>{id}</button>
}

/**
 * The tests of one claim: the results recorded, then the planned tests that have no result. A planned test without
 * a result counts as 0, so it is the usual reason a claim reads "insufficient" or "untested" (not established).
 */
function ClaimTests({ claim: c }: { claim: LedgerClaim }) {
  const planned = c.registered ?? []
  const pending = c.pending_tests ?? []
  const plan = (name: string) => planned.find((r) => r.name === name)
  if (c.tests.length === 0 && planned.length === 0) return <p className="swarm-note">No test has been planned or run on this statement.</p>
  return (
    <>
      {planned.length > 0 && (
        <p className="swarm-note">
          {planned.length} test{planned.length === 1 ? " was" : "s were"} planned before any result: {planned.length - pending.length} with a result, {pending.length} without.
        </p>
      )}
      {pending.length > 0 && c.verdict !== "refuted" && (
        <p className="swarm-pendingnote">
          Not established because {pending.length === 1 ? "a planned test has" : `${pending.length} planned tests have`} no result. Each one counts as 0 in the score, and a claim is supported only when every planned test has a result.
        </p>
      )}
      <ul className="swarm-tests">
        {c.tests.map((t, i) => (
          <li key={`r${i}`}>
            <b>{t.name}</b> · p = {num(t.p_value)} · e = {num(t.e_value)}
            {t.contradicts && <> · <span className="pill sv-refuted">goes against the statement</span></>}
            {t.registered === false && <> · <span className="pill sv-minor" title="A result that goes against a statement is always accepted, planned or not.">not planned beforehand</span></>}
            <span className="muted"> · by {t.by}</span>
            {plan(t.name) && <div className="muted">Planned: {plan(t.name)!.method}</div>}
            {t.note && <div className="muted">{t.note}</div>}
          </li>
        ))}
        {pending.map((name) => (
          <li key={`p${name}`} data-pending>
            <b>{name}</b> · <span className="pill sv-insufficient">no result recorded</span> · counts as e = 0
            {plan(name) && <><span className="muted"> · planned by {plan(name)!.by}</span><div className="muted">Planned: {plan(name)!.method}</div></>}
          </li>
        ))}
      </ul>
    </>
  )
}
