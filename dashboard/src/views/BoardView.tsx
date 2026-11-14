// Board room. By default a plain summary: is the board working, and what did it decide and why can you trust it.
// "Show details" opens the full room: roster, every reply with per-claim verdicts, the ledger, evidence and memo.
import { takeOpen } from "@/lib/open"
import { useEffect, useMemo, useState } from "react"
import { Streamdown } from "streamdown"
import { Buddy, type Mood } from "@/components/Buddy"
import { get, memo as fetchMemo, post, type BoardEvent, type RosterMember, type RunSummary, type Status, useRunEvents, type Verdict } from "@/board/api"
import { EngineOffline, PageHead, StatusPill } from "@/components/Shared"
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
const ABOUT = "A board of AI specialists reviews a drug candidate brief, checks each claim against evidence, and writes a decision memo."

export function BoardView() {
  const [status, setStatus] = useState<Status>()
  const [offline, setOffline] = useState(false)
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [briefs, setBriefs] = useState<string[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [brief, setBrief] = useState("")
  const [runId, setRunId] = useState<string | undefined>(() => takeOpen("board"))
  const [error, setError] = useState("")
  const [memoOf, setMemoOf] = useState<{ runId: string; text: string }>()
  const [details, setDetails] = useState(() => localStorage.getItem("board.details") === "1")
  const events = useRunEvents(runId)

  useEffect(() => localStorage.setItem("board.details", details ? "1" : "0"), [details])
  const refresh = () => get<RunSummary[]>("/api/runs").then((r) => { setRuns(r); setRunId((id) => id ?? r[0]?.id) })
  const load = () => {
    Promise.all([get<Status>("/api/status"), get<RosterMember[]>("/api/roster"), get<string[]>("/api/briefs")])
      .then(([s, r, b]) => { setOffline(false); setStatus(s); setRoster(r); setBriefs(b); setBrief((old) => old || (b[0] ?? "")); return refresh() })
      .catch(() => setOffline(true))
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
  const mood = (m: RosterMember): Mood => {
    if (!live) return finished ? "happy" : "sleeping"
    if (m.role === "lead") return "alert"
    return current?.replies.some((r) => r.member === m.name) ? "happy" : "working"
  }
  const scriptedWhy = status?.paidCalls === false ? "Paid calls are off, so the board runs with scripted models."
    : "The engine has no OPENROUTER_API_KEY, so the board runs with scripted models."
  const resume = async () => {
    if (!runId) return
    setError("")
    try { await post(`/api/runs/${encodeURIComponent(runId)}/resume`); await refresh() }
    catch (e) { setError(`This review was not resumed: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const memo = sections(memoText)
  const maxRounds = status?.meeting.max_rounds ?? 4

  if (offline) return (
    <div className="page board">
      <PageHead title="Drug Candidate Board" about={ABOUT} />
      <EngineOffline needs="The board runs in the engine. Without API keys it uses scripted models, which are free." onRetry={load} />
    </div>
  )

  // One plain sentence about where the run is.
  const known = runs.some((r) => r.id === runId)
  const headline = !status ? "Loading the board…"
    : !runId ? "No reviews yet. Pick a brief and press Convene board. Without API keys the board uses scripted models, which are free."
    : runs.length > 0 && !known && events.length === 0 ? `Run ${runId} was not found. Pick another run from the list.`
    : failed ? "The run stopped with an error."
    : done ? "The board has decided."
    : memoWritten ? "Writing the memo…"
    : current ? `Round ${rounds.at(-1)![0]} of up to ${maxRounds}: ${current.replies.length} of ${members.length} members have replied.`
    : "Convening the board…"
  const progress = done ? 1 : Math.min(0.95, ((rounds.length - 1) + (current ? current.replies.length / Math.max(1, members.length) : 0)) / maxRounds)

  return (
    <div className="page board">
      <PageHead title="Drug Candidate Board" about={ABOUT}>
        {status?.mock && <span className="pill" data-kind="warning" title={scriptedWhy}>Scripted models</span>}
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
        <button type="button" className="btn btn-primary" onClick={start} disabled={!brief || live}>{live ? "Board in session" : "Convene board"}</button>
        </span>
        <label className="toggle">
          <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
          <span>Show details</span>
        </label>
      </div>
      {error && <p role="alert" className="pill" data-kind="danger">{error}</p>}

      <section className="card-surface summary" aria-label="Status">
        <div className="crew">
          {roster.map((m) => <span key={m.name} title={m.title}><Buddy seed={m.name} mood={mood(m)} size={m.role === "lead" ? 44 : 34} /></span>)}
        </div>
        <p className="headline" role="status">{headline}</p>
        {status?.mock && <p className="muted small board-scripted">{scriptedWhy} Replies are fixed text, not real analysis, and cost nothing.</p>}
        {runId && status && !done && !failed && (known || events.length > 0) && <div className="progress" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></div>}
        {failed && <p className="pill" data-kind="danger">{failed.error}</p>}
      </section>

      {memoText && (
        <section className="card-surface decision" aria-label="Decision">
          <span className="eyebrow">Recommendation</span>
          <h2 className="decision-text">{plain(bullets(memo["decision"])[0]) || "See memo"}</h2>
          {memo["rationale"] && <p>{plain(memo["rationale"])}</p>}
          <p className="trust">
            <span className="v v-verified">{count("verified")} verified</span>
            {count("contradicted") > 0 && <span className="v v-contradicted">{count("contradicted")} contradicted</span>}
            {count("unsupported") > 0 && <span className="v v-unsupported">{count("unsupported")} unsupported</span>}
            <span className="muted small">of {claims.length} claims checked against {uniqueEvidence.length} sources</span>
          </p>
          <div className="decision-lists">
            {memo["unresolved tensions"] && <div><h3>Open questions</h3><ul>{bullets(memo["unresolved tensions"]).map((b) => <li key={b}>{plain(b)}</li>)}</ul></div>}
            {memo["next actions"] && <div><h3>Next steps</h3><ul>{bullets(memo["next actions"]).map((b) => <li key={b}>{plain(b)}</li>)}</ul></div>}
          </div>
          {done && <p className="muted small">{rounds.length} rounds · took {fmtDuration(done.minutes * 60_000)} · cost ${done.usd.toFixed(2)}</p>}
        </section>
      )}

      {!details && runId && (
        <button type="button" className="link-button" onClick={() => setDetails(true)}>See the full discussion, evidence and checks →</button>
      )}

      {details && (
        <div className="board-grid">
          <section className="card-surface" aria-label="Roster">
            <h2>Board</h2>
            {roster.map((m) => (
              <div key={m.name} className="member" title={m.deliverable}>
                <Buddy seed={m.name} mood={mood(m)} size={40} />
                <div>
                  <strong>{m.title}</strong>
                  <span>{m.role === "lead" ? "Runs the board, writes the memo" : m.deliverable}</span>
                  <code>{m.modelId}</code>
                </div>
              </div>
            ))}
            {status && <p className="muted small">Limits: {status.meeting.max_rounds} rounds · {status.meeting.max_minutes} min · ${status.meeting.max_usd}</p>}
          </section>

          <section className="card-surface" aria-label="Deliberation">
            <h2>Discussion {live && <span className="pill" data-kind="info">live</span>}</h2>
            {rounds.length === 0 && <p className="muted small">{runId ? "No replies yet." : "Nothing to show until the board is convened."}</p>}
            {rounds.map(([n, r]) => (
              <div key={n}>
                <div className="round-head">
                  Round {n}{r.head?.final ? " · final positions" : ""}
                  <p>{r.head?.message}</p>
                </div>
                {r.replies.map((reply) => (
                  <div key={reply.key} className="reply">
                    <Buddy seed={reply.member} mood="happy" size={28} />
                    <div>
                      <b>{title(reply.member)}</b>
                      <p>{reply.text}</p>
                      <ul className="verdicts">
                        {r.claims.filter((c) => c.member === reply.member).map((c) => (
                          <li key={c.key} title={c.note}>
                            <span className={`v v-${c.verdict}`}>{c.verdict}</span>
                            <span className="muted">{c.checker}{c.p !== undefined ? ` ${c.p.toFixed(2)}` : ""}</span>
                            <span>{c.claim}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {events.filter((e): e is Of<"constraint"> => e.type === "constraint").map((c) => (
              <p key={c.key} className="pill" data-kind="warning">Wrap up: {c.detail}</p>
            ))}
          </section>

          <section className="card-surface" aria-label="Verification and memo">
            <h2>Verification ledger</h2>
            <div className="ledger-stats">
              {VERDICTS.map((v) => <div key={v}><strong>{count(v)}</strong><span>{v}</span></div>)}
            </div>
            <p className="muted small">
              Jev settled {claims.filter((c) => c.checker === "jev").length} of {claims.length} claims;
              {" "}{claims.filter((c) => c.checker !== "jev").length} escalated to OpenAI / Claude Code.
            </p>
            <h2>Evidence pool</h2>
            <p className="muted small">{uniqueEvidence.length} sources kept · {dropped} dropped by Jev triage</p>
            <ul className="evidence">
              {uniqueEvidence.map((i) => <li key={i.url}><a href={i.url} target="_blank" rel="noreferrer">{i.title}</a> <span className="muted">{i.studyType}</span></li>)}
            </ul>
            <h2>Full memo</h2>
            {memoText ? <div className="memo"><Streamdown>{memoText}</Streamdown></div> : <p className="muted small">Written when the board finishes.</p>}
          </section>
        </div>
      )}
    </div>
  )
}
