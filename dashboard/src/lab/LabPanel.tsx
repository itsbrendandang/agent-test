// Agent Lab design by Anh Lam. The side panel of the lab: the selected teammate (who it is, what it is doing now, what
// it last fetched; which real agent or step it stands for and since when under "About"), where the run's searches
// looked, and the activity log. All of it is read from the same activity model the scene draws, so the words and the picture
// cannot disagree about what was reported.
import { SearchCredit } from "@/components/Shared"
import type { SearchProvider } from "@/board/api"
import { AgentAvatar } from "./AgentAvatar"
import { Mascot } from "./Mascot"
import { CLAIM_GLYPH, CLAIM_WORD, LOG_KIND_WORD, NOT_IN_RUN, STATE_GLYPH, STATE_WORD, captionOf, characterOf, clockTime, dayName, logDid, logKind, roomOf, shortTime, type CharacterId, type LabModel, type LogKind, type LogLine } from "./model"
import "../design/lab.css"

const IDLE_HINT = "Teammates stay at their places until the engine reports work."

/** The mark in a log entry's dot on the rail, one a kind of step: the kind is never said by the tint alone. */
const KIND_MARK: Record<LogKind, React.ReactNode> = {
  search: <><circle cx="5.2" cy="5.2" r="3.2" /><path d="M7.6 7.6 10.5 10.5" /></>,
  screen: <path d="M1.5 2.5h9L7 6.6v3.6L5 9V6.6z" />,
  write: <><path d="M2 10l.6-2.6L8.4 1.6l2 2L4.6 9.4z" /><path d="M7.2 2.8l2 2" /></>,
  check: <><path d="M6 1.2 10 2.7v3.1c0 2.3-1.6 4-4 5-2.4-1-4-2.7-4-5V2.7z" /><path d="M4.3 5.9l1.2 1.2 2.2-2.4" strokeWidth="1.2" /></>, // a shield: a check was made; its result is in the words, not in this mark
  handoff: <path d="M1.5 6h8.5M6.8 2.8 10 6l-3.2 3.2" />,
  failed: <path d="M2.8 2.8l6.4 6.4M9.2 2.8 2.8 9.2" />,
  warn: <><path d="M6 2v5" /><path d="M6 9.6v.2" /></>,
  done: <><path d="M3 11V1.5" /><path d="M3 2h6.5L8 4.5 9.5 7H3" /></>,
  note: <circle cx="6" cy="6" r="1.6" fill="currentColor" />,
}

/**
 * The activity, newest first, on a rail: a dot with the step's mark, the teammate's face and name (once for its
 * entries in a row), what it did, what it carried as a chip, the time. A day's name is shown only when the entries
 * are of more than one day. Every entry is one list item that reads as a sentence.
 */
function ActivityLog({ lines }: { lines: LogLine[] }) {
  const dayOf = (l: LogLine) => (l.at > 0 ? new Date(l.at).toDateString() : "")
  const days = new Set(lines.map(dayOf).filter(Boolean)).size
  return (
    <div role="log" aria-labelledby="lab-activity">
      <ol className="lab-log" reversed>
        {lines.map((l, i) => {
          const above = lines[i - 1], kind = logKind(l)
          const newDay = days > 1 && !!dayOf(l) && (!above || dayOf(above) !== dayOf(l))
          const cont = !!l.who && !newDay && above?.who === l.who // the same teammate as the entry above: its face is not drawn again
          return (
            <li key={l.id} data-kind={kind} data-tone={l.tone} data-who={l.who ? "" : undefined} data-cont={cont || undefined}>
              {newDay && <span className="lab-log-day">{dayName(l.at)}</span>}
              <span className="lab-log-dot" aria-hidden="true" title={LOG_KIND_WORD[kind]}><svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{KIND_MARK[kind]}</svg></span>
              {l.who && !cont && <AgentAvatar name={l.agent ?? l.who} size={24} className="lab-log-face" />}
              <p className="lab-log-text">
                {l.who && <><span className={cont ? "lab-sr" : "lab-log-who"}>{l.who}</span>{" "}</>}
                <span className="lab-log-did">{l.who ? logDid(l) : l.text}</span>
                {l.chips?.map((c) => <span key={c}>{" "}<span className="lab-log-chip">{c}</span></span>)}
              </p>
              {l.at > 0 && <time dateTime={new Date(l.at).toISOString()} title={clockTime(l.at)}>{shortTime(l.at)}</time>}
              {l.note && <blockquote className="lab-log-note">{l.note}</blockquote>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function LabPanel({ model, selected, compact = false }: { model: LabModel; selected: CharacterId; compact?: boolean }) {
  const c = characterOf(selected), a = model.characters[selected]
  const newest = [...model.log].reverse().slice(0, compact ? 12 : 80)
  // A practice run's example sources are not searches, and the Practice badge already says what they are.
  const credited = Object.entries(model.searches ?? {}).filter(([provider]) => provider !== "fixture")
  return (
    <aside className="lab-panel" aria-label="Selected teammate and activity">
      <div className="lab-eyebrow">Selected teammate</div>
      <div className="lab-who">
        <div className="lab-portrait" data-in-run={a.inRun} aria-hidden="true"><Mascot shape={c.shape} color={c.color} /></div>
        <h2>{captionOf(a)}</h2>
        <span className="lab-status" data-state={a.state} data-in-run={a.inRun} data-testid="lab-status">
          {a.inRun ? <>{STATE_GLYPH[a.state] && <span aria-hidden="true">{STATE_GLYPH[a.state]} </span>}{STATE_WORD[a.state]}</> : NOT_IN_RUN}
        </span>
      </div>
      <dl className="lab-facts">
        {a.inRun && a.doing && <div><dt>Doing now</dt><dd>{a.doing}</dd></div>}
        {a.lastFetched && <div><dt>Last fetched</dt><dd>{a.lastFetched.label} <span className="muted">(in {roomOf(a.lastFetched.room).name}, {shortTime(a.lastFetched.at)})</span></dd></div>}
        {a.problem && <div><dt>A step of its own failed</dt><dd data-tone="bad">✕ {a.problem.text}</dd></div>}
      </dl>
      <details className="lab-about">
        <summary>About</summary>
        <p>{a.label ? `The ${c.name}, at home in ${roomOf(c.room).name}.` : `At home in ${roomOf(c.room).name}.`}{a.inRun && a.since !== undefined && model.status !== "empty" && <> In this state since <time dateTime={new Date(a.since).toISOString()}>{clockTime(a.since)}</time>.</>}</p>
        {a.standsFor && <p>{a.standsFor}</p>}
        <p className="muted">Marks: … working, ⇄ fetching, → handed off, ✓ done, ✕ failed, ■ cancelled. A faded teammate is not in this run.</p>
      </details>
      {credited.length > 0 && (
        <>
          <hr />
          <h3>Searches so far</h3>
          <ul className="lab-credits">
            {credited.map(([provider, n]) => <li key={provider} data-provider={provider}><b>{n}</b> <SearchCredit provider={provider as SearchProvider} /></li>)}
          </ul>
        </>
      )}
      {model.labels && model.labels.length > 0 && (
        <>
          <hr />
          <h3>This run</h3>
          <ul className="lab-labels">{model.labels.map((l) => <li key={l} data-strong={l.startsWith("Practice") || undefined}>{l}</li>)}</ul>
        </>
      )}
      {model.claims && (
        <>
          <hr />
          <h3>Claims</h3>
          {model.claims.length === 0 ? <p className="lab-hint">No claim has been proposed yet.</p> : (
            <ul className="lab-claims" aria-label="Claims of this run">
              {model.claims.map((claim) => {
                const attempts = Object.entries(claim.attempts)
                return (
                  <li key={claim.id} data-claim={claim.id}>
                    <div className="lab-claim-head">
                      <span className="lab-claim" data-state={claim.state}><b>{claim.id}</b> {CLAIM_GLYPH[claim.state] && <span aria-hidden="true">{CLAIM_GLYPH[claim.state]} </span>}{CLAIM_WORD[claim.state]}</span>
                      {claim.acuity && <span className="muted">acuity {claim.acuity}</span>}
                      <span className="muted">in {roomOf(claim.room).name}</span>
                    </div>
                    <div>{claim.text}</div>
                    {claim.reason && <div><span className="muted">Why it is here: </span>{claim.reason}</div>}
                    <div className="muted">{claim.activity}</div>
                    <div className="muted">
                      Budget: {claim.budget.tokensSpent.toLocaleString("en-US")}{claim.budget.tokensAlloc ? ` of ${claim.budget.tokensAlloc.toLocaleString("en-US")}` : ""} tokens spent{claim.budget.tokensAlloc ? "" : " (no token budget set)"}; {claim.budget.secondsSpent.toFixed(1)} seconds of calls.
                    </div>
                    <div className="muted">Calls: {attempts.length ? attempts.map(([mode, n]) => `${mode}${n > 1 ? ` ×${n}` : ""}`).join(", ") : "none ended yet"}.</div>
                    {claim.errors.length > 0 && <div style={{ color: "var(--lab-fail)" }}>✕ {claim.errors.length === 1 ? "1 error" : `${claim.errors.length} errors`}: {claim.errors.join("; ")}</div>}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
      {model.visitors.length > 0 && (
        <>
          <hr />
          <h3>Visiting specialists</h3>
          <ul className="lab-visitors">
            {model.visitors.map((v) => (
              <li key={v.id}><b>{v.name}</b> <span className="muted">in {roomOf(v.room).name}</span><br />{STATE_GLYPH[v.state] && <span aria-hidden="true">{STATE_GLYPH[v.state]} </span>}{STATE_WORD[v.state]}. {v.doing}{v.methods && v.methods.length > 0 && <><br /><span className="muted">Method skills: {v.methods.join("; ")}</span></>}{v.why && <><br /><span className="muted">Why it joined: {v.why}</span></>}</li>
            ))}
          </ul>
        </>
      )}
      <hr />
      <h3 id="lab-activity">Activity</h3>
      {newest.length
        ? <ActivityLog lines={newest} />
        : <p className="lab-hint">{model.status === "empty" ? "No run yet. " : "Nothing reported yet. "}{IDLE_HINT}</p>}
    </aside>
  )
}
