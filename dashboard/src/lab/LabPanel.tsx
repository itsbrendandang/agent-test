// Agent Lab design by Anh Lam. The side panel of the lab: the selected teammate (who it is, which real agent or step
// it stands for, what it is doing now, since when, what it last fetched) and the activity log. Both are read from
// the same activity model the scene draws, so the words and the picture cannot disagree about what was reported.
import { SearchCredit } from "@/components/Shared"
import type { SearchProvider } from "@/board/api"
import { Mascot } from "./Mascot"
import { NOT_IN_RUN, STATE_GLYPH, STATE_WORD, captionOf, characterOf, clockTime, roomOf, type CharacterId, type LabModel } from "./model"
import "./lab.css"

const IDLE_HINT = "Teammates stay at their desks until the engine reports work. Each search, screening, check and hand-off the engine reports sends one of them to a room and back."

export function LabPanel({ model, selected, compact = false }: { model: LabModel; selected: CharacterId; compact?: boolean }) {
  const c = characterOf(selected), a = model.characters[selected]
  const room = roomOf(c.room).name
  const newest = [...model.log].reverse().slice(0, compact ? 12 : 60)
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
        {a.label && <div><dt>Character</dt><dd>The {c.name}</dd></div>}
        <div><dt>Home room</dt><dd>{room}</dd></div>
        {a.standsFor && <div><dt>Stands for</dt><dd>{a.standsFor}</dd></div>}
        {a.inRun && a.doing && <div><dt>Doing now</dt><dd>{a.doing}</dd></div>}
        {a.inRun && a.since !== undefined && model.status !== "empty" && <div><dt>Since</dt><dd><time dateTime={new Date(a.since).toISOString()}>{clockTime(a.since)}</time></dd></div>}
        {a.lastFetched && <div><dt>Last fetched</dt><dd>{a.lastFetched.label} <span className="muted">(in {roomOf(a.lastFetched.room).name}, {clockTime(a.lastFetched.at)})</span>{a.lastFetched.provider && <><br /><SearchCredit provider={a.lastFetched.provider as SearchProvider} /></>}</dd></div>}
        {a.problem && <div><dt>A step of its own failed</dt><dd data-tone="bad">✕ {a.problem.text}</dd></div>}
      </dl>
      {model.searches && (
        <>
          <hr />
          <h3>Searches reported so far</h3>
          <ul className="lab-visitors">
            {Object.entries(model.searches).map(([provider, n]) => <li key={provider}>{n} {n === 1 ? "search" : "searches"}: <SearchCredit provider={provider as SearchProvider} /></li>)}
          </ul>
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
        ? <ol className="lab-log" role="log" aria-labelledby="lab-activity" reversed>{newest.map((l) => <li key={l.id} data-tone={l.tone}>{l.at > 0 && <time dateTime={new Date(l.at).toISOString()}>{clockTime(l.at)}</time>}{l.text}</li>)}</ol>
        : <p className="lab-hint">{model.status === "empty" ? "No run yet. " : "Nothing reported yet. "}{IDLE_HINT}</p>}
      {!compact && newest.length > 0 && <p className="lab-hint">{IDLE_HINT} On a small screen, scroll the lab sideways. Reduced-motion preferences are respected.</p>}
    </aside>
  )
}
