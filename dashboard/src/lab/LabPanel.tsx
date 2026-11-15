// Agent Lab design by Anh Lam. The side panel of the lab: the selected teammate (who it is, what it is doing now, what
// it last fetched; which real agent or step it stands for and since when under "About"), where the run's searches
// looked, and the activity log. All of it is read from the same activity model the scene draws, so the words and the picture
// cannot disagree about what was reported.
import { SearchCredit } from "@/components/Shared"
import type { SearchProvider } from "@/board/api"
import { Mascot } from "./Mascot"
import { CLAIM_GLYPH, CLAIM_WORD, NOT_IN_RUN, STATE_GLYPH, STATE_WORD, captionOf, characterOf, clockTime, roomOf, shortTime, type CharacterId, type LabModel } from "./model"
import "./lab.css"

const IDLE_HINT = "Teammates stay at their places until the engine reports work."

export function LabPanel({ model, selected, compact = false }: { model: LabModel; selected: CharacterId; compact?: boolean }) {
  const c = characterOf(selected), a = model.characters[selected]
  const newest = [...model.log].reverse().slice(0, compact ? 12 : 80)
  // A practice run's example sources are not searches, and the Practice badge already says what they are.
  const credited = Object.entries(model.searches ?? {}).filter(([provider]) => provider !== "fixture")
  return (
    <aside className="lab-panel" aria-label="Selected teammate and lab activity">
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
              <li key={v.id}><b>{v.name}</b> <span className="muted">in {roomOf(v.room).name}</span><br />{STATE_GLYPH[v.state] && <span aria-hidden="true">{STATE_GLYPH[v.state]} </span>}{STATE_WORD[v.state]}. {v.doing}{v.why && <><br /><span className="muted">Why it joined: {v.why}</span></>}</li>
            ))}
          </ul>
        </>
      )}
      <hr />
      <h3 id="lab-activity">Lab activity</h3>
      {newest.length
        ? <ol className="lab-log" role="log" aria-labelledby="lab-activity" reversed>{newest.map((l) => <li key={l.id} data-tone={l.tone} title={l.text}>{l.at > 0 ? <time dateTime={new Date(l.at).toISOString()}>{clockTime(l.at)}</time> : <time />}<span>{l.text}</span></li>)}</ol>
        : <p className="lab-hint">{model.status === "empty" ? "No run yet. " : "Nothing reported yet. "}{IDLE_HINT}</p>}
    </aside>
  )
}
