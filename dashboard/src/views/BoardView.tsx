// Board room: the roster on the left, the live deliberation in the middle, evidence, verdicts and the
// memo on the right. Everything comes from the engine's event stream, so it works mid-run and after restarts.
import { useEffect, useMemo, useState } from "react"
import { Streamdown } from "streamdown"
import { Buddy, type Mood } from "@/components/Buddy"
import { get, memo as fetchMemo, post, type BoardEvent, type RosterMember, type RunSummary, type Status, useRunEvents, type Verdict } from "@/board/api"
import "@/board/board.css"

type Of<T extends BoardEvent["type"]> = Extract<BoardEvent, { type: T }>

export function BoardView() {
  const [status, setStatus] = useState<Status>()
  const [offline, setOffline] = useState(false)
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [briefs, setBriefs] = useState<string[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [brief, setBrief] = useState("")
  const [runId, setRunId] = useState<string>()
  const [error, setError] = useState("")
  const [memoText, setMemoText] = useState("")
  const events = useRunEvents(runId)

  const refresh = () => get<RunSummary[]>("/api/runs").then((r) => { setRuns(r); setRunId((id) => id ?? r[0]?.id) })
  useEffect(() => {
    Promise.all([get<Status>("/api/status"), get<RosterMember[]>("/api/roster"), get<string[]>("/api/briefs")])
      .then(([s, r, b]) => { setStatus(s); setRoster(r); setBriefs(b); setBrief(b[0] ?? ""); return refresh() })
      .catch(() => setOffline(true))
  }, [])

  const memoWritten = events.some((e) => e.type === "memo.written")
  useEffect(() => { if (runId && memoWritten) void fetchMemo(runId).then(setMemoText); else setMemoText("") }, [runId, memoWritten])
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
  const live = !finished && events.length > 0
  const title = (name: string) => roster.find((m) => m.name === name)?.title ?? name
  const mood = (m: RosterMember): Mood => {
    if (!live) return finished ? "happy" : "sleeping"
    if (m.role === "lead") return "alert"
    return current?.replies.some((r) => r.member === m.name) ? "happy" : "working"
  }
  const done = events.find((e): e is Of<"run.finished"> => e.type === "run.finished")
  const failed = events.find((e): e is Of<"run.failed"> => e.type === "run.failed")

  if (offline) return (
    <div className="page"><div className="offline card-surface">
      <h1>Engine not running</h1>
      <p className="muted">Start it from the repo root with <code>npm run engine</code> (mock models, no keys needed), then reload.</p>
    </div></div>
  )

  return (
    <div className="page board">
      <header className="board-banner card-surface">
        <h1>Drug Candidate Board</h1>
        {status && <span className="pill" data-kind={status.mock ? "warning" : "success"}>{status.mock ? "Mock models" : "Live models"}</span>}
        <select aria-label="Run" value={runId ?? ""} onChange={(e) => setRunId(e.target.value || undefined)}>
          {runs.length === 0 && <option value="">No runs yet</option>}
          {runs.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.status}</option>)}
        </select>
        <select aria-label="Brief" value={brief} onChange={(e) => setBrief(e.target.value)}>
          {briefs.map((b) => <option key={b}>{b}</option>)}
        </select>
        <button type="button" className="primary" onClick={start} disabled={!brief}>Convene board</button>
        {runs.find((r) => r.id === runId)?.status === "paused" && (
          <button type="button" onClick={() => runId && post(`/api/runs/${runId}/resume`).then(refresh)}>Resume</button>
        )}
      </header>
      {error && <p className="pill" data-kind="danger">{error}</p>}

      <section className="card-surface" aria-label="Roster">
        <h2>Board</h2>
        {roster.map((m) => (
          <div key={m.name} className="member" data-speaking={(live && m.role === "lead") || undefined} title={m.deliverable}>
            <Buddy seed={m.name} mood={mood(m)} size={40} />
            <div>
              <strong>{m.title}</strong>
              <span>{m.role === "lead" ? "Runs the board, writes the memo" : m.deliverable}</span>
              <code>{m.modelId}</code>
            </div>
          </div>
        ))}
        {status && (
          <p className="muted small">
            Limits: {status.meeting.max_rounds} rounds · {status.meeting.max_minutes} min · ${status.meeting.max_usd}
          </p>
        )}
      </section>

      <section className="card-surface" aria-label="Deliberation">
        <h2>Deliberation {live && <span className="pill" data-kind="info">live</span>}</h2>
        {!runId && <p className="muted">Pick a brief and convene the board.</p>}
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
        {done && <p className="muted small">Finished in {done.minutes.toFixed(1)} min · ${done.usd.toFixed(3)}</p>}
        {failed && <p className="pill" data-kind="danger">{failed.error}</p>}
      </section>

      <section className="card-surface" aria-label="Verification and memo">
        <h2>Verification ledger</h2>
        <div className="ledger-stats">
          {(["verified", "unsupported", "contradicted", "unchecked"] as Verdict[]).map((v) => (
            <div key={v}><strong>{count(v)}</strong><span>{v}</span></div>
          ))}
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
        <h2>Memo</h2>
        {memoText ? <div className="memo"><Streamdown>{memoText}</Streamdown></div> : <p className="muted small">Written when the board finishes.</p>}
      </section>
    </div>
  )
}
