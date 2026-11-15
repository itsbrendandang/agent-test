// AI Scientist Swarm (GLHF). By default a plain summary: where the run is, what it scored, what was
// rejected. "Show details" opens the timeline, every claim with its tests, the critic's issues and the reports.
import { useEffect, useRef, useState } from "react"
import { Streamdown } from "streamdown"
import { Buddy, type Mood } from "@/components/Buddy"
import { EngineOffline, ModeLabel, PageHead, RunId, StatusPill } from "@/components/Shared"
import { swarmScripted } from "@/lib/scripted"
import { runState } from "@/lib/status"
import { fmtDuration, fmtScore, fmtTokens } from "@/lib/format"
import {
  isDemo, isLive, useSwarm,
  type GlhfRun, type Ledger, type LedgerClaim, type LedgerEvent, type ScoreCell, type ScoreRow, type Solver,
} from "@/swarm/api"
import { CancelRun } from "@/swarm/CancelRun"
import { NewRun } from "@/swarm/NewRun"
import { takeOpen } from "@/lib/open"
import { ROLES, roleOf, type RoleKey } from "@/swarm/roles"
import "@/swarm/swarm.css"

const round = (phase: string) => phase.match(/\d+/)?.[0]
const num = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "–" : String(Number(x.toPrecision(3))))
const score = fmtScore
const STEP_TEXT = { now: "● working", done: "✓ ran", todo: "○ did not run" } as const
const ABOUT = "Compares one agent working alone with a team of nine agents on the same task, and shows what each run scored."
const solverName = (s: Solver) => (s === "glhf" ? "Swarm" : "Single agent")
const text = (x: unknown) => (typeof x === "string" || typeof x === "number" ? String(x) : "")

function phases(ledger: Ledger | null) {
  const events = ledger?.events ?? []
  const started = events.filter((e) => e.kind === "phase.started").map((e) => e.phase ?? "")
  const last = events.findLast((e) => e.kind === "phase.started" || e.kind === "phase.finished")
  const current = last?.kind === "phase.started" ? last.phase : undefined
  return { started, current }
}

function headline(run: GlhfRun | undefined, current: string | undefined, missing?: string): string {
  if (!run && missing) return `Run ${missing} was not found. Pick another run from the list.`
  if (!run) return "No runs yet. Press New run to watch the team work on a small practice case. The default is free."
  const who = run.solver === "glhf" ? "The swarm" : "The single agent"
  if (run.phase === "failed") return "This run stopped with an error."
  if (run.phase === "cancelled") return "This run was cancelled. It has no score."
  if (run.phase === "queued" && run.after) return "Waiting in the queue. This run starts when the run before it has ended."
  if (run.phase === "done") return run.score === undefined ? `${who} finished, but its outputs were not graded.` : `${who} finished, and the official grader scored its outputs.`
  if (run.phase === "queued" || run.phase === "launching") return "Starting the run…"
  if (run.phase === "completing") return "Collecting the results and grading them…"
  if (run.solver === "single") return "One agent is working through the whole analysis alone."
  const n = current ? round(current) : undefined
  switch (roleOf(current)) {
    case "scout": return "The Scout is inspecting the data and the tools."
    case "pilot": return "The Pilot is proving the whole pipeline on a small sample."
    case "audit": return `The Auditor is checking the scripts against the stated methods${n ? ` (review round ${n})` : ""}.`
    case "finish": return "The Finisher is rescuing outputs that were still missing."
    case "propose": return "The Proposer is planning the analysis and writing down claims to test."
    case "experiment": return "The Experimenter is running the analysis and writing the outputs."
    case "critique": return `The Critic is checking the work and trying to disprove each claim${n ? ` (review round ${n})` : ""}.`
    case "revise": return `The Reviser is fixing the problems the reviewers found${n ? ` (round ${n})` : ""}.`
    case "report": return "The Reporter is writing up what was actually done."
    default: return "The swarm is working…"
  }
}

function describe(e: LedgerEvent): string | undefined {
  switch (e.kind) {
    case "claim.added": return `Claim ${text(e.claim)} written down: ${text(e.text)}`
    case "test.recorded":
      return `Test on ${text(e.claim)} (${text(e.name)}): p = ${num(Number(e.p))}${e.contradicts ? ", goes against the claim" : ""}. Claim is now ${text(e.verdict)}.`
    case "test.registered": return `Test planned for ${text(e.claim)} (${text(e.name)}), before any result: ${text(e.method)}`
    case "replication.failed": return `${text(e.claim)} could not be reproduced independently: ${text(e.note)}`
    case "issue.raised": return `Problem ${text(e.issue)} raised (${text(e.severity)}): ${text(e.problem)}`
    case "issue.resolved": return `Problem ${text(e.issue)} ${e.status === "fixed" ? "fixed" : "closed without a fix"}`
    case "review.converged": return `Review round ${text(e.round)} found nothing left to fix, so review ended.`
    case "review.skipped": return `Review round ${text(e.round)} skipped: out of time.`
    case "phase.finished": return e.limit_hit ? "This step ran out of its time budget." : undefined
    case "finished": return `Final check of the required files: ${text(e.contract)}`
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
      {cell.extras.map((e) => <span key={e} className="swarm-extra">{e}</span>)}
    </button>
  )
}

export function SwarmView() {
  const [picked, setPicked] = useState<string | undefined>(() => takeOpen("swarm"))
  const [nudge, setNudge] = useState(0)
  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<string>()
  const [details, setDetails] = useState(() => localStorage.getItem("swarm.details") === "1")
  useEffect(() => localStorage.setItem("swarm.details", details ? "1" : "0"), [details])
  const { status, runs, detail, offline, scoreboard } = useSwarm(picked, nudge)
  const page = useRef<HTMLDivElement>(null)
  const runCard = useRef<HTMLElement>(null)
  // The run a scoreboard cell opens is shown below the scoreboard, so bring it into view.
  const openRun = (id: string) => { setPicked(id); runCard.current?.scrollIntoView({ behavior: "smooth", block: "start" }) }

  if (offline && !runs) return (
    <div className="page swarm">
      <PageHead title="Swarm vs single agent" about={ABOUT} />
      <EngineOffline needs="Runs and the scoreboard come from the engine. The demo also needs Docker, but no API keys." onRetry={() => setNudge((n) => n + 1)} />
    </div>
  )

  if (!runs) return <div className="page swarm"><PageHead title="Swarm vs single agent" about={ABOUT} /><p className="muted" role="status">Loading runs…</p></div>

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
  const mood = (key: RoleKey): Mood =>
    !run ? "sleeping" : activeRole === key ? "working" : seen.has(key) || run.phase === "done" ? "happy" : "sleeping"

  return (
    <div className="page swarm" ref={page}>
      <PageHead title="Swarm vs single agent" about={ABOUT}>
        {noKeys && <span className="pill" data-kind="warning" title="The engine has no model API keys. Only the scripted mock model can run.">Demo mode</span>}
        {offline && <span className="pill" data-kind="danger" title="Showing the last data received. Retrying every 15 seconds.">Engine offline</span>}
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New run</button>
      </PageHead>
      <NewRun open={creating} status={status} onClose={() => setCreating(false)}
        onStarted={(ids) => { setPicked(ids[0]); setNudge((n) => n + 1) }} onOpenRun={openRun} />
      <CancelRun run={byId(cancelling)} queuedBehind={queuedBehind(cancelling)} onClose={() => setCancelling(undefined)} onCancelled={() => setNudge((n) => n + 1)} />

      <section className="card-surface swarm-card swarm-board" aria-label="Scoreboard">
        <div className="swarm-cardhead">
          <h2>Scoreboard: single agent against swarm</h2>
          <span className="muted small">Latest run of each kind, per task and settings. Click a score to open that run.</span>
        </div>
        {scoreboard === undefined ? <p className="muted small" role="status">Loading the scoreboard…</p>
          : scoreboard === null ? <p role="alert" className="swarm-rownote">The engine did not return a scoreboard. Restart it with <code>npm run engine</code> to get the current version.</p>
          : scoreboard.length === 0 ? (
            <p className="swarm-empty">No finished runs yet. Press <b>New run</b> and choose <b>Both, to compare</b>. The two runs then appear here side by side.</p>
          ) : (
          <div className="swarm-scroll">
          <table className="swarm-table" aria-label="Single agent against swarm, per task and settings">
            <thead><tr>
              <th scope="col">Task and shared settings</th><th scope="col">Single agent</th><th scope="col">Swarm</th>
              <th scope="col" className="num">Difference</th>{anyBenchmark && <th scope="col" className="num">Record to beat</th>}
            </tr></thead>
            <tbody>
              {scoreboard.map((row) => {
                const label = [row.task === "demo" && "demo case", row.model === "mock" && "scripted model"].filter(Boolean).join(", ")
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
            <p>A grader program checks the files that a run wrote. The score goes from 0 to 1. A score of 1 means every required output was correct. No model decides the score.</p>
            <h3>Claims</h3>
            <p>The swarm writes down what it thinks it found. Each of these is a claim. Then it tests each claim and tries to prove it wrong.</p>
            <ul>
              <li><span className="sv sv-supported">supported</span> The claim passed its tests. It counts as a finding.</li>
              <li><span className="sv sv-refuted">refuted</span> A test went against the claim. It is rejected and is not reported as a finding.</li>
              <li><span className="sv sv-untested">not established</span> There was not enough evidence, or a planned test has no result, or no test was run. It is not reported as a finding.</li>
            </ul>
            <p>Code decides each result from the test numbers. A single agent has no reviewer, so it has no checked claims.</p>
            <h3>Difference</h3>
            <p>The difference is the swarm score minus the single-agent score. It is shown only when both runs had the same task, model, time limit and token budget.
              If these settings are not the same, a higher score could come from more time or more tokens, and not from the team. Then the row shows a note and no difference.</p>
            <p>Extras, such as Exa search, memory or the number of review rounds, are listed next to each run. They show what one run had and the other did not.</p>
            <h3>Record to beat</h3>
            <p>{fmtScore(record)} is the best published BixBench3 score across its 20 studies. It applies to BixBench3 tasks only. The score of one task is not the same measure as the score of the whole benchmark.
              A run on the demo case, or with the scripted model, is never a benchmark result.</p>
          </div>
        </details>
      </section>

      <section className="card-surface swarm-card swarm-status" aria-label="Run" ref={runCard}>
        <div className="swarm-runbar">
          <h2 id="swarm-run-label">Run</h2>
          <select aria-labelledby="swarm-run-label" value={runId ?? ""} title={runId} onChange={(e) => setPicked(e.target.value || undefined)}>
            {list.length === 0 && <option value="">No runs yet</option>}
            {runId && !list.some((r) => r.id === runId) && <option value={runId}>{runId} · {run ? runState(run.phase, run.score !== undefined) : "not found"}</option>}
            {list.map((r) => <option key={r.id} value={r.id}>{r.id} · {runState(r.phase, r.score !== undefined)}</option>)}
          </select>
          {run && <StatusPill state={runState(run.phase, run.score !== undefined)} />}
          {run && isDemo(run) && <span className="pill" data-kind="warning">{demoLabel(run)}</span>}
          {run && live && <button type="button" className="btn" onClick={() => setCancelling(run.id)}>Cancel run</button>}
          <label className="swarm-toggle">
            <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
            <span>Show details</span>
          </label>
        </div>
        {run?.phase === "done" && (
        <div className="swarm-result" role="group" aria-label="Result">
          <p className="swarm-resulthead"><span className="swarm-eyebrow">Result · {solverName(run.solver)} · task {run.task}</span><ModeLabel scripted={swarmScripted(run)} demo={run.task === "demo"} /></p>
          {isDemo(run) && (
            <p className="swarm-note swarm-notbench">
              This is not a benchmark result.{run.task === "demo" && " The demo case is a toy dataset built to test the plumbing."}
              {run.model === "mock" && " The scripted model replays fixed steps and does no real analysis."}
            </p>
          )}
          <div className="swarm-score" data-demo={isDemo(run) || undefined}>
            <strong>{score(run.score)}</strong>
            <span className="muted">{run.score === undefined ? "not graded: the grader gave no score for this run" : "out of 1, from the official grader"}</span>
          </div>
          {run.artifacts && run.artifacts.length > 0 && (
            <ul className="swarm-artifacts" aria-label="Score per required output">
              {run.artifacts.map((a) => <li key={a.artifact_id}>{a.artifact_id}<b>{score(a.score)}</b></li>)}
            </ul>
          )}
          {run.solver === "glhf" && ledger && (
            <p className="swarm-counts">
              <span className="sv sv-supported">{count.supported} supported</span>
              <span className="sv sv-refuted">{count.refuted} refuted</span>
              <span className="sv sv-untested">{count.open} not established</span>
              <span className="muted small">of {claims.length} claim{claims.length === 1 ? "" : "s"} · {count.fixed} problem{count.fixed === 1 ? "" : "s"} found by review and fixed</span>
            </p>
          )}
          {run.solver === "single" && <p className="swarm-note">A single agent has no critic, so there are no checked claims or rejections to show.</p>}
        </div>
        )}
        <div className="swarm-roles">
          {run?.solver === "single" ? (
            <div className="swarm-role" data-active={(live && run.phase !== "queued") || undefined} data-done={!live || undefined}>
              <span className="swarm-face"><Buddy seed="single-agent" mood={run.phase === "queued" || run.phase === "cancelled" ? "sleeping" : live ? "working" : run.phase === "done" ? "happy" : "alert"} size={56} /></span>
              <span>Single agent</span>
              <span className="swarm-step" data-step={live ? (run.phase === "queued" ? "todo" : "now") : run.phase === "done" ? "done" : "todo"}>{live ? (run.phase === "queued" ? STEP_TEXT.todo : STEP_TEXT.now) : run.phase === "done" ? STEP_TEXT.done : `○ ${run.phase}`}</span>
            </div>
          ) : ROLES.map((r, i) => (
            <div key={r.key} className="swarm-role" title={r.does}
              data-active={activeRole === r.key || undefined} data-done={mood(r.key) === "happy" || undefined}>
              <span className="swarm-face"><Buddy species={r.species} mood={mood(r.key)} size={activeRole === r.key ? 56 : 44} /></span>
              <span>{i + 1}. {r.name}</span>
              <span className="swarm-step" data-step={step(r.key)}>{STEP_TEXT[step(r.key)]}</span>
            </div>
          ))}
        </div>
        <p className="swarm-headline" role="status">{headline(run, activePhase, runId)}</p>
        {!run && list.length === 0 && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New run</button>}
        {run && live && (
          <div className="swarm-live">
            <div className="swarm-progress" aria-hidden="true"><span style={{ width: `${run.phase === "queued" ? 0 : progress * 100}%` }} /></div>
            <p className="swarm-note">{run.detail ?? "Working…"} · {run.phase === "queued" ? "waiting" : "running"} for <Elapsed since={run.startedAt} /></p>
            <p className="swarm-note">
              {run.phase === "queued" ? "Nothing has run yet."
                : run.solver === "glhf"
                ? <>So far: {claims.length} claim{claims.length === 1 ? "" : "s"} written down, {count.supported} supported, {count.refuted} refuted, {issues.length} problem{issues.length === 1 ? "" : "s"} raised by the reviewers.</>
                : "A single agent keeps no list of claims, so there is nothing to count until it finishes."}
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
                <span className="muted"> · same task, model, time limit, token budget and seed</span>
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


      {!details && run && (
        <button type="button" className="swarm-link" onClick={() => setDetails(true)}>See every claim, test and problem, and the reports →</button>
      )}

      {details && run && (
        <div className="swarm-grid">
          <section className="card-surface" aria-label="Claims and problems">
            <h2>Claims ({claims.length})</h2>
            {ledger && (
              <p className="swarm-note">
                A claim counts as a finding only if it survives attempts to disprove it. Each test gives a p-value, which code turns into
                an evidence score (e-value).{" "}
                {ledger.combination
                  ? <>Tests are planned (registered) before any result exists. A claim's score is the average over its planned tests, and a planned test
                    with no result counts as 0. With {ledger.claims_in_family ?? claims.length} claim{(ledger.claims_in_family ?? claims.length) === 1 ? "" : "s"} in
                    this run, a claim is supported at {num(ledger.support_threshold ?? 1 / ledger.alpha)} or more, and only when every planned test has a result.</>
                  : <>Scores multiply across tests, and a claim is supported at {num(1 / ledger.alpha)} or more.</>}
                {" "}No model decides a verdict.
              </p>
            )}
            {claims.length === 0 && <p className="muted small">{run.solver === "single" ? "A single agent registers no claims." : "No claims yet."}</p>}
            {claims.map((c) => (
              <article key={c.id} className="swarm-claim">
                <header><span className={`sv sv-${c.verdict}`}>{c.verdict}</span><b>{c.id}</b><span className="muted small">from {c.proposed_by}</span></header>
                <p>{c.text}</p>
                <p className="swarm-note">If the claim were false: {c.null_hypothesis}</p>
                <p className="swarm-note">
                  Combined evidence score {num(c.e_value)} against a threshold of {num(c.threshold ?? 1 / (ledger?.alpha ?? 0.1))}
                  {c.replication_failed && " · independent replication failed"} · outputs: {c.artifact_ids.join(", ") || "none"}
                </p>
                <ClaimTests claim={c} />
              </article>
            ))}
            <h2>Problems the reviewers raised ({issues.length})</h2>
            {issues.length === 0 && <p className="muted small">None.</p>}
            {issues.map((i) => (
              <article key={i.id} className="swarm-issue">
                <header>
                  <span className={`sv sv-${i.severity}`}>{i.severity}</span><span className={`sv sv-${i.status}`}>{i.status}</span>
                  <b>{i.id}</b><span className="muted small">from {i.raised_by} · outputs: {i.artifact_ids.join(", ") || "none"}</span>
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
              : <p className="muted small">{run.solver === "single" ? "Only the swarm writes this report." : "Written when the run finishes."}</p>}
            <h2>Methods</h2>
            {current?.methods ? <div className="swarm-doc"><Streamdown>{current.methods}</Streamdown></div>
              : <p className="muted small">Not written yet.</p>}
          </section>
          <details className="card-surface swarm-more">
            <summary>Timeline, run settings and tokens</summary>
            <h2>Timeline</h2>
            {!ledger ? <p className="muted small">{run.solver === "single" ? "A single-agent run keeps no shared ledger." : "No ledger yet."}</p> : (
              <ol className="swarm-timeline">
                {ledger.events.map((e, i) => {
                  if (e.kind === "phase.started") {
                    const role = ROLES.find((r) => r.key === roleOf(e.phase))
                    const n = round(e.phase ?? "")
                    return <li key={i} data-kind="phase"><span>●</span><span>{role?.name ?? e.phase}{n ? ` · round ${n}` : ""}</span></li>
                  }
                  const line = describe(e)
                  return line ? <li key={i}><span>·</span><span>{line}</span></li> : null
                })}
              </ol>
            )}
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
              <dt>Token budget</dt><dd>{run.settings?.maxTokens ? fmtTokens(run.settings.maxTokens) : "none"}</dd>
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

const demoLabel = (r: GlhfRun) => [r.task === "demo" && "demo case", r.model === "mock" && "scripted model"].filter(Boolean).join(", ")

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
  if (c.tests.length === 0 && planned.length === 0) return <p className="swarm-note">No test has been planned or run on this claim.</p>
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
            {t.contradicts && <> · <span className="sv sv-refuted">goes against the claim</span></>}
            {t.registered === false && <> · <span className="sv sv-minor" title="A result that goes against a claim is always accepted, planned or not.">not planned beforehand</span></>}
            <span className="muted"> · by {t.by}</span>
            {plan(t.name) && <div className="muted">Planned: {plan(t.name)!.method}</div>}
            {t.note && <div className="muted">{t.note}</div>}
          </li>
        ))}
        {pending.map((name) => (
          <li key={`p${name}`} data-pending>
            <b>{name}</b> · <span className="sv sv-insufficient">no result recorded</span> · counts as e = 0
            {plan(name) && <><span className="muted"> · planned by {plan(name)!.by}</span><div className="muted">Planned: {plan(name)!.method}</div></>}
          </li>
        ))}
      </ul>
    </>
  )
}
