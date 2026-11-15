// Board room. By default a plain summary: is the board working, and what did it decide and why can you trust it.
// "Show details" opens the full room: roster, every reply with per-claim verdicts, the ledger, evidence and memo.
import { takeOpen } from "@/lib/open"
import { useEffect, useMemo, useState } from "react"
import { Streamdown } from "streamdown"
import { get, memo as fetchMemo, post, type BoardEvent, type RosterMember, type RunSummary, type Status, useRunEvents, type Verdict } from "@/board/api"
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation"
import { Loading } from "@/components/Crew"
import { EngineOffline, ModeLabel, PageHead, StatusPill, Verdict as VerdictChip } from "@/components/Shared"
import { CheckedStatement, TeamMessage } from "@/components/Thread"
import { verdictCount } from "@/lib/words"
import { boardScriptedWhy } from "@/home/chat"
import { problemOf, type Problem } from "@/lib/engine"
import { runState } from "@/lib/status"
import { fmtDuration } from "@/lib/format"
import "@/board/board.css"

type Of<T extends BoardEvent["type"]> = Extract<BoardEvent, { type: T }>
const VERDICTS: Verdict[] = ["verified", "unsupported", "contradicted", "unchecked"]

/** "## Heading" sections of the memo, keyed by lowercase heading. */
function sections(md: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of md.split(/^## /m).slice(1)) {
    const [head, ...body] = part.split("\n")
    out[head.trim().toLowerCase()] = body.join("\n").trim()
  }
  return out
}
const bullets = (s = "") => s.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim()).filter(Boolean)
const plain = (s = "") => s.replace(/[*_`]+/g, "").trim()
const ABOUT = "A team of AI agents discusses a research brief. A separate check tests each statement they make against sources, and the lead writes the decision."

// The cheap model's ruling settled the claim ("jev" is the same thing in runs made before the checker changed).
const firstPass = (c: { checker?: string }) => c.checker === "first-pass" || c.checker === "jev"

const VERDICT_DETAIL: Record<string, string> = { verified: "held up", contradicted: "proven wrong", unsupported: "no supporting source", unchecked: "not checked" }
/** "Scout (Data Inspector)" -> the name and the plain job. */
const nameAndJob = (title: string) => { const m = /^(.*?)\s*\((.+)\)\s*$/.exec(title); return m ? { name: m[1], job: m[2] } : { name: title, job: undefined } }
/** Who ruled on a statement, in plain words. The model id, when the run recorded one, is kept. */
const checkerName = (c: { checker?: string; checkedBy?: string }) => {
  const what = firstPass(c) ? "the quick first check" : c.checker === "openai" || c.checker === "claude-code" ? "the second, careful check" : c.checker
  return c.checkedBy && c.checkedBy !== "scripted" ? `${what} (${c.checkedBy})` : c.checkedBy === "scripted" ? `${what} (practice: no model)` : what
}

export function BoardView() {
  const [status, setStatus] = useState<Status>()
  const [problem, setProblem] = useState<Problem>() // set when the board could not be loaded
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [briefs, setBriefs] = useState<string[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [brief, setBrief] = useState("")
  const [opened] = useState(() => takeOpen("board")) // a review another view asked to open ("See what they found")
  const [runId, setRunId] = useState<string | undefined>(opened)
  const [error, setError] = useState("")
  const [memoOf, setMemoOf] = useState<{ runId: string; text: string }>()
  // Someone who asked to see a review wants the discussion: it is open on arrival. Otherwise the last choice is kept.
  const [details, setDetails] = useState(() => opened !== undefined || localStorage.getItem("board.details") === "1")
  const events = useRunEvents(runId)

  useEffect(() => localStorage.setItem("board.details", details ? "1" : "0"), [details])
  const refresh = () => get<RunSummary[]>("/api/runs").then((r) => { setRuns(r); setRunId((id) => id ?? r[0]?.id) })
  const load = () => {
    Promise.all([get<Status>("/api/status"), get<RosterMember[]>("/api/roster"), get<string[]>("/api/briefs")])
      .then(([s, r, b]) => { setProblem(undefined); setStatus(s); setRoster(r); setBriefs(b); setBrief((old) => old || (b[0] ?? "")); return refresh() })
      .catch((error: unknown) => setProblem(problemOf(error)))
  }
  useEffect(load, [])

  const memoWritten = events.some((e) => e.type === "memo.written")
  useEffect(() => { if (runId && memoWritten) void fetchMemo(runId).then((text) => setMemoOf({ runId, text })) }, [runId, memoWritten])
  // The memo belongs to one run: another run's memo is never shown while the new one loads.
  const memoText = memoOf && memoOf.runId === runId && memoWritten ? memoOf.text : ""
  const finished = events.some((e) => e.type === "run.finished" || e.type === "run.failed")
  useEffect(() => { if (finished) void refresh() }, [finished])

  const start = async () => {
    setError("")
    try { const { runId } = await post<{ runId: string }>("/api/runs", { brief }); setRunId(runId); await refresh() }
    catch (e) { setError(String(e instanceof Error ? e.message : e)) }
  }

  const rounds = useMemo(() => {
    const byRound = new Map<number, { head?: Of<"round.started">; replies: Of<"member.replied">[]; claims: Of<"claim.checked">[] }>()
    const slot = (n: number) => byRound.get(n) ?? byRound.set(n, { replies: [], claims: [] }).get(n)!
    for (const e of events) {
      if (e.type === "round.started") slot(e.round).head = e
      if (e.type === "member.replied") slot(e.round).replies.push(e)
      if (e.type === "claim.checked") slot(e.round).claims.push(e)
    }
    return [...byRound.entries()].sort(([a], [b]) => a - b)
  }, [events])

  const claims = events.filter((e): e is Of<"claim.checked"> => e.type === "claim.checked")
  const count = (v: Verdict) => claims.filter((c) => c.verdict === v).length
  const evidence = events.filter((e): e is Of<"evidence.triaged"> => e.type === "evidence.triaged")
  const uniqueEvidence = [...new Map(evidence.flatMap((e) => e.items).map((i) => [i.url, i])).values()]
  const dropped = evidence.reduce((n, e) => n + e.dropped, 0)
  const current = rounds.at(-1)?.[1]
  const members = roster.filter((m) => m.role === "member")
  const live = !finished && events.length > 0
  const done = events.find((e): e is Of<"run.finished"> => e.type === "run.finished")
  const failed = events.find((e): e is Of<"run.failed"> => e.type === "run.failed")
  const title = (name: string) => roster.find((m) => m.name === name)?.title ?? name
  // Scripted or real is a fact of the run on screen (its run.started event). The engine's state now only says what a new review would use.
  const startedAs = events.find((e): e is Of<"run.started"> => e.type === "run.started")?.mock
  const scripted = startedAs ?? status?.mock ?? false
  const nextWhy = `${boardScriptedWhy(status) ?? "The engine is in practice mode: board reviews are practice runs only"}.`
  const resume = async () => {
    if (!runId) return
    setError("")
    try { await post(`/api/runs/${encodeURIComponent(runId)}/resume`); await refresh() }
    catch (e) { setError(`This review was not resumed: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const memo = sections(memoText)
  const maxRounds = status?.meeting.max_rounds ?? 4

  if (problem) return (
    <div className="page board">
      <PageHead title="Board review" about={ABOUT} />
      <EngineOffline needs="Reviews run in the engine." said={problem.said} onRetry={load} />
    </div>
  )

  // One plain sentence about where the run is, and when it is over, what happened in it.
  const spoke = new Set(events.flatMap((e) => (e.type === "member.replied" ? [e.member] : []))).size
  const said = `${spoke} team member${spoke === 1 ? "" : "s"} made ${claims.length} statement${claims.length === 1 ? "" : "s"}: ${verdictCount("holds", count("verified"))}, ${verdictCount("fails", count("contradicted"))}, ${verdictCount("unknown", count("unsupported") + count("unchecked"))}.`
  const lead = roster.find((m) => m.role === "lead")
  const known = runs.some((r) => r.id === runId)
  const headline = !status ? "Loading the review…"
    : !runId ? "No reviews yet. Pick a brief and press Start a review. While paid calls are off this is a practice run: fixed text, free, not real research."
    : runs.length > 0 && !known && events.length === 0 ? `Run ${runId} was not found. Pick another run from the list.`
    : failed ? "The run stopped with an error."
    : done ? `The team has decided. ${said}`
    : memoWritten ? "Writing the decision…"
    : current ? `The team is discussing: round ${rounds.at(-1)![0]} of ${Math.max(maxRounds, rounds.at(-1)![0])} · ${current.replies.length} of ${members.length} have replied.`
    : "Starting the review…"
  const progress = done ? 1 : Math.min(0.95, ((rounds.length - 1) + (current ? current.replies.length / Math.max(1, members.length) : 0)) / maxRounds)

  return (
    <div className="page board">
      <PageHead title="Board review" about={ABOUT}>
      </PageHead>
      <div className="board-banner card-surface">
        <h2 id="board-run-label">Review</h2>
        <select aria-labelledby="board-run-label" value={runId ?? ""} title={runId} onChange={(e) => setRunId(e.target.value || undefined)}>
          {runs.length === 0 && <option value="">No runs yet</option>}
          {runId && !known && runs.length > 0 && <option value={runId}>{runId}</option>}
          {runs.map((r) => <option key={r.id} value={r.id}>{r.id} · {runState(r.status)}</option>)}
        </select>
        {runId && (known || events.length > 0) && <StatusPill state={failed ? "failed" : runState(runs.find((r) => r.id === runId)?.status ?? (done ? "done" : "running"))} />}
        {runs.find((r) => r.id === runId)?.status === "paused" && <button type="button" className="btn" onClick={() => void resume()}>Resume</button>}
        <span className="board-new">
        <select aria-label="Brief for a new review" value={brief} onChange={(e) => setBrief(e.target.value)}>
          {briefs.map((b) => <option key={b} value={b}>{b.replace(/\.md$/, "").replace(/-/g, " ")}</option>)}
        </select>
        <button type="button" className="btn btn-primary" onClick={start} disabled={!brief || live}>{live ? "Review in progress" : "Start a review"}</button>
        </span>
        <label className="toggle">
          <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
          <span>Show the full discussion</span>
        </label>
      </div>
      {error && <p role="alert" className="pill" data-kind="danger">{error}</p>}

      <section className="card-surface summary" aria-label="Status">
        {runId && members.length > 0 && (
          <ol className="board-steps" aria-label="Board members in this round">
            {members.map((m) => {
              // From the run's own events: a member who never replied did not take part, also when the roster lists them.
              const spokeAtAll = events.some((e) => e.type === "member.replied" && e.member === m.name)
              const step = !live ? (spokeAtAll ? "done" : "todo") : current?.replies.some((r) => r.member === m.name) ? "done" : "now"
              return <li key={m.name} data-step={step} title={nameAndJob(m.title).job}><span>{nameAndJob(m.title).name}</span><span className="swarm-step">{step === "done" ? (live ? "✓ replied" : "✓ took part") : step === "now" ? "● working" : finished ? "○ did not take part" : "○ not started"}</span></li>
            })}
          </ol>
        )}
        <p className="headline" role="status">{headline}</p>
        {runId && startedAs !== undefined && <p className="board-scripted" data-testid="run-mode"><ModeLabel scripted={startedAs} /> <span className="muted small">{startedAs ? "This review used fixed text instead of models. It cost nothing and is not research." : "This review ran with real models."}</span></p>}
        {status?.mock && <p className="muted small board-scripted" data-testid="next-mode">{nextWhy}</p>}
        {runId && status && !done && !failed && (known || events.length > 0) && <div className="progress" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></div>}
        {failed && <p className="pill" data-kind="danger">{failed.error}</p>}
      </section>

      {memoText && (
        <section className="card-surface decision" aria-label="Decision">
          <p className="board-resulthead"><span className="eyebrow">What the team recommends</span><ModeLabel scripted={startedAs} /></p>
          <h2 className="decision-text">{plain(bullets(memo["decision"])[0]) || "See memo"}</h2>
          {memo["rationale"] && <p>{plain(memo["rationale"])}</p>}
          <p className="trust">
            <VerdictChip verdict="verified" count={count("verified")} />
            <VerdictChip verdict="contradicted" count={count("contradicted")} />
            <VerdictChip verdict="unsupported" count={count("unsupported") + count("unchecked")} />
            <span className="muted small">of {claims.length} statements checked against {uniqueEvidence.length} sources</span>
          </p>
          <p className="muted small">Holds up: a source supports the statement. Proven wrong: a source goes against it. Not enough evidence: no source was found, or nothing checked it. A separate checker decides each one; the team does not grade itself.</p>
          <div className="decision-lists">
            {memo["unresolved tensions"] && <div><h3>Open questions</h3><ul>{bullets(memo["unresolved tensions"]).map((b) => <li key={b}>{plain(b)}</li>)}</ul></div>}
            {memo["next actions"] && <div><h3>Next steps</h3><ul>{bullets(memo["next actions"]).map((b) => <li key={b}>{plain(b)}</li>)}</ul></div>}
          </div>
          {done && <p className="muted small">{rounds.length} rounds · took {fmtDuration(done.minutes * 60_000)} · cost ${done.usd.toFixed(2)}</p>}
        </section>
      )}

      {!details && runId && (
        <button type="button" className="link-btn" onClick={() => setDetails(true)}>See who said what, the sources and every check →</button>
      )}

      {details && (
        <div className="board-grid">
          <section className="card-surface" aria-label="Discussion">
            <h2>Discussion {live && <span className="pill" data-kind="info">live</span>}</h2>
            <p className="muted small">Who said what, round by round. Under each reply: what a separate check found about each statement in it.</p>
            {rounds.length === 0 && <p className="muted small">{runId ? "No replies yet." : "Nothing to show until a review is started."}</p>}
            <Conversation className="thread-inline" aria-label="Discussion, round by round">
              <ConversationContent className="thread-list">
                {rounds.map(([n, r]) => (
                  <div key={n} className="thread-round" role="group" aria-label={`Round ${n}`}>
                    <h3 className="round-head">Round {n}{r.head?.final ? " · final positions" : ""}</h3>
                    {r.head?.message && <TeamMessage name={lead?.title ?? "Lead"} job="Leads the review and writes the decision" text={r.head.message.replace(/^\s*Round \d+\.\s*/, "")} />}
                    {r.replies.map((reply) => {
                      const who = nameAndJob(title(reply.member))
                      const said = r.claims.filter((c) => c.member === reply.member)
                      return (
                        <TeamMessage key={reply.key} name={who.name} job={who.job} text={reply.text}>
                          {said.length > 0 && (
                            <ul className="thread-checks" aria-label={`What the checks found about ${who.name}'s statements`}>
                              {said.map((c) => <CheckedStatement key={c.key} verdict={c.verdict} claim={c.claim} note={c.note} source={c.source} by={checkerName(c)} />)}
                            </ul>
                          )}
                        </TeamMessage>
                      )
                    })}
                  </div>
                ))}
                {live && <Loading>{headline}</Loading>}
              </ConversationContent>
            </Conversation>
            {events.filter((e): e is Of<"constraint"> => e.type === "constraint").map((c) => (
              <p key={c.key} className="pill" data-kind="warning">Wrap up: {c.detail}</p>
            ))}
          </section>

          <section className="card-surface" aria-label="Checks, sources and the written decision">
            <h2>What the checks found</h2>
            <div className="ledger-stats">
              {VERDICTS.map((v) => <div key={v} title={`The check's own word: ${v}`}><strong>{count(v)}</strong><span>{VERDICT_DETAIL[v]}</span><span className="muted small">{v}</span></div>)}
            </div>
            <p className="muted small">
              A quick first check settled {claims.filter(firstPass).length} of {claims.length} statements;
              {" "}{claims.filter((c) => !firstPass(c)).length} went to a second, more careful check.
            </p>
            <h2>Sources</h2>
            <p className="muted small">{uniqueEvidence.length} sources kept · {dropped} dropped as off-topic</p>
            <ul className="evidence">
              {uniqueEvidence.map((i) => <li key={i.url}><a href={i.url} target="_blank" rel="noreferrer">{i.title}</a> <span className="muted">{i.studyType}</span></li>)}
            </ul>
            <h2>The written decision (memo)</h2>
            {memoText ? <div className="memo"><Streamdown>{memoText}</Streamdown></div> : <p className="muted small">Written when the review finishes.</p>}
          </section>
          <details className="card-surface board-more">
            <summary>The team: who took part, and the limits</summary>
            {roster.map((m) => (
              <div key={m.name} className="member" title={m.deliverable}>
                <div>
                  <strong>{m.title}</strong>
                  <span>{m.role === "lead" ? "Leads the review and writes the decision" : m.deliverable}</span>
                  <code title={scripted ? `A real run would use ${m.modelId}` : m.modelId}>{scripted ? "practice: no model" : m.modelId}</code>
                </div>
              </div>
            ))}
            {status && <p className="muted small">Limits: {status.meeting.max_rounds} rounds · {status.meeting.max_minutes} min · ${status.meeting.max_usd}</p>}
          </details>

        </div>
      )}
    </div>
  )
}
