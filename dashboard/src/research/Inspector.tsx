// The optional inspector beside the Research conversation. It only shows what one answer's own record holds:
//  Evidence: the sources (found / selected / cited), each checked statement with its mark, quoted passage and
//            checker, and the critic's notes with whether they were dealt with.
//  Results:  the files the engine registered for the answer (name, type, size, time), a text preview, a download.
//  Activity: the run's status, what it is doing, what it has spent against its limit, the searches, any failure.
//  Lab:      the team at work, drawn from the same events.
// A tab exists only when it has content. Nothing here is a placeholder.
import { tracked } from "@/lib/engine"
import { lazy, Suspense, useState } from "react"
import { safeUrl } from "@/lib/words"
import { Activity } from "./Activity"
import { HypothesesTable } from "./Hypotheses"
import { artifactUrl } from "./api"
import { identifierOf, MARK_GLYPH, MARK_WORD, markOf } from "./marks"
import { noteOutcome, progressLine, seconds, sourceCounts, type AnswerState, type ResearchEvent } from "./model"
import { tabsOf, type InspectorTab } from "./inspectorState"
import { ProviderCredit } from "./ProviderCredit"
import { PROVIDERS, searchPlace } from "./providers"

// The Lab draws the whole scene: loaded only when its tab is opened.
const LabTab = lazy(() => import("./LabTab"))

const TAB_NAME: Record<InspectorTab, string> = { evidence: "Evidence", hypotheses: "Hypotheses", results: "Results", activity: "Activity", lab: "Agent Lab" }
const money = (usd: number) => (usd === 0 ? "$0" : usd < 0.01 ? "less than 1 cent" : `$${usd.toFixed(2)}`)
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

export function Inspector({ id, state, events, tab, onTab }: { id: string; state: AnswerState; events: ResearchEvent[]; tab: InspectorTab | undefined; onTab: (tab: InspectorTab) => void }) {
  const tabs = tabsOf(state, events)
  const current = tab && tabs.includes(tab) ? tab : tabs[0]
  if (!current) return <p className="muted small inspector-empty">Nothing to inspect yet. It fills in as the answer is made.</p>
  return (
    <div className="inspector">
      <div className="inspector-tabs" role="tablist" aria-label="Inspector">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" id={`inspector-tab-${t}`} aria-selected={t === current} aria-controls="inspector-panel" tabIndex={t === current ? 0 : -1}
            onClick={() => onTab(t)}
            onKeyDown={(e) => { const i = tabs.indexOf(t); const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i + tabs.length - 1) % tabs.length] : undefined; if (next) { e.preventDefault(); onTab(next); document.getElementById(`inspector-tab-${next}`)?.focus() } }}>
            {TAB_NAME[t]}
          </button>
        ))}
      </div>
      <div className="inspector-panel" id="inspector-panel" role="tabpanel" aria-labelledby={`inspector-tab-${current}`} tabIndex={0}>
        {current === "evidence" && <Evidence state={state} />}
        {current === "hypotheses" && <HypothesesTable state={state} />}
        {current === "results" && <Results id={id} state={state} />}
        {current === "activity" && <Status state={state} />}
        {current === "lab" && <Suspense fallback={<p className="muted small">Loading the Agent Lab.</p>}><LabTab id={id} events={events} /></Suspense>}
      </div>
    </div>
  )
}

function Evidence({ state: s }: { state: AnswerState }) {
  const c = sourceCounts(s)
  const demo = s.mode === "demo"
  return (
    <>
      {s.sources.length > 0 && (
        <section aria-label="Sources">
          <h3>Sources</h3>
          <p className="muted small">
            {c.found !== undefined && <>{c.found} found · </>}{c.selected} selected{c.cited !== undefined && <> · {c.cited} cited in the answer</>}
          </p>
          <ol className="inspector-sources">
            {s.sources.map((src) => { const url = safeUrl(src.url); const why = s.selection?.selected.find((x) => x.n === src.n); const cited = s.cited?.includes(src.n); return (
              <li key={src.n} data-cited={cited ?? undefined}>
                <span className="source-n" aria-hidden="true">{src.n}</span>
                <span className="source-what">
                  <span className="inspector-title">{url ? <a href={url} target="_blank" rel="noopener noreferrer">{src.title || url}</a> : src.title || src.url}</span>
                  <span className="muted small">{[identifierOf(src.url), src.published, src.note].filter(Boolean).join(" · ")}{(identifierOf(src.url) || src.note || src.published) && " · "}<ProviderCredit provider={src.provider} /></span>
                  {(/preprint/i.test(src.note ?? "") || /\[preprint\]\s*$/i.test(src.title)) && <span className="source-preprint">Preprint: not peer reviewed</span>}
                  {s.cited && <span className="source-use small" data-cited={!!cited}>{cited ? "Cited in the answer" : "Selected, but not cited"}</span>}
                  {why && <span className="small">{why.why}{why.limitation && <span className="muted"> Limit: {why.limitation}</span>}</span>}
                </span>
              </li>
            ) })}
          </ol>
          {s.selection && s.selection.notSelected.length > 0 && (
            <details>
              <summary>Found but not selected ({s.selection.notSelected.length})</summary>
              <ul className="inspector-notselected">
                {s.selection.notSelected.map((x, i) => { const url = safeUrl(x.url); return <li key={i}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{x.title || url}</a> : x.title || x.url}<span className="muted small"> {PROVIDERS[x.provider]?.place ?? x.provider} · {x.reason}</span></li> })}
              </ul>
            </details>
          )}
        </section>
      )}
      {s.statements.length > 0 && (
        <section aria-label="Checked statements">
          <h3>Checked statements</h3>
          <p className="muted small">{demo ? "Example checks of a practice answer, not real ones. " : ""}{s.statements.filter((x) => markOf(x.verdict) !== "unchecked").length} of {s.statements.length} cited statements checked.</p>
          <ol className="inspector-statements">
            {s.statements.map((st) => { const m = markOf(st.verdict); return (
              <li key={st.index}>
                <span className="answer-markword" data-mark={m}><span aria-hidden="true">{MARK_GLYPH[m]}</span> {MARK_WORD[m]}</span>
                <span>{st.text}</span>
                <span className="muted small" data-found={st.quote ? st.quoteFound : undefined}>
                  {st.quote ? <>“{st.quote}” {st.quoteFound ? `Found in source ${st.quoteSource ?? st.sources[0]}.` : "The quoted passage was not found in the source."}</> : "The checker quoted no passage."}
                  {st.note && ` ${st.note}`}
                </span>
                <span className="muted small">Checked by {st.checker === "scripted" ? "nobody: practice text" : st.checker || "not recorded"} · sources {st.sources.join(", ") || "none"}</span>
              </li>
            ) })}
          </ol>
        </section>
      )}
      {s.notes.length > 0 && (
        <section aria-label="The critic's notes">
          <h3>The critic's notes</h3>
          <ul className="inspector-notes">
            {s.notes.map((n) => (
              <li key={n.index}>
                <span className="pill" data-kind={noteOutcome(n).kind}>{noteOutcome(n).word}</span>
                <span className="muted small"> {n.severity}</span>
                <span className="inspector-note">{n.text}</span>
                {n.how && <span className="muted small">What was done: {n.how}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function Results({ id, state: s }: { id: string; state: AnswerState }) {
  const [preview, setPreview] = useState<{ name: string; text: string }>()
  const show = async (name: string) => {
    if (preview?.name === name) { setPreview(undefined); return }
    try { const r = await tracked(fetch(artifactUrl(id, name))); setPreview({ name, text: r.ok ? (await r.text()).slice(0, 6000) : `The engine answered ${r.status}, so this file could not be shown.` }) }
    catch { setPreview({ name, text: "The app's engine isn't running, so this file could not be shown." }) }
  }
  const textual = (a: { name: string; type: string }) => /^text\/|json|csv|markdown/.test(a.type) || /\.(md|json|csv|txt)$/i.test(a.name)
  return (
    <section aria-label="Files">
      <h3>Files</h3>
      <p className="muted small">Only files the engine registered for this answer.</p>
      <ul className="inspector-files">
        {s.artifacts.map((a) => (
          <li key={a.name}>
            <span className="inspector-title mono">{a.name}</span>
            <span className="muted small mono">{[a.type, size(a.bytes), a.at ? new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : undefined].filter(Boolean).join(" · ")}</span>
            <span className="inspector-fileacts">
              {textual(a) && <button type="button" className="link-btn" aria-expanded={preview?.name === a.name} onClick={() => void show(a.name)}>{preview?.name === a.name ? "Hide preview" : "Preview"}</button>}
              <a className="link-btn" href={artifactUrl(id, a.name)} download={a.name}>Download</a>
            </span>
            {preview?.name === a.name && <pre className="inspector-preview mono">{preview.text}</pre>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Status({ state: s }: { state: AnswerState }) {
  const working = s.status === "starting" || s.status === "queued" || s.status === "running"
  const ran = s.steps.filter((x) => x.kind === "search" && x.status !== "failed" && x.status !== "cancelled")
  const spent = s.finished?.usd ?? s.spentUsd
  const WORD: Record<AnswerState["status"], string> = { starting: "Starting", queued: "Queued", running: "Running", done: "Completed", failed: "Failed", cancelled: "Stopped" }
  return (
    <section aria-label="Run">
      <h3>Run</h3>
      <dl className="inspector-facts">
        <dt>Status</dt><dd>{WORD[s.status]}</dd>
        {working && <><dt>Now</dt><dd>{progressLine(s)}</dd></>}
        {(s.finished?.seconds ?? s.seconds) !== undefined && <><dt>Time</dt><dd className="mono">{seconds((s.finished?.seconds ?? s.seconds!) * 1000)}{s.caps ? ` of at most ${seconds(s.caps.maxSeconds * 1000)}` : ""}</dd></>}
        {s.mode === "demo" ? <><dt>Spent</dt><dd>Nothing: a practice answer</dd></>
          : <><dt>Spent</dt><dd className="mono">{spent !== undefined ? `Spent: ${money(spent)}` : "reported when the answer ends"}{s.caps ? ` · Run limit: ${money(s.caps.maxUsd)}` : ""}</dd></>}
        {ran.length > 0 && <><dt>Searches</dt><dd>{ran.length} ran: {[...new Set(ran.map((x) => x.provider ? searchPlace(x.provider) : "search"))].join(", ")}</dd></>}
        {s.models && Object.keys(s.models).length > 0 && s.mode !== "demo" && <><dt>Models</dt><dd className="mono inspector-models">{Object.entries(s.models).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd></>}
        {s.error && <><dt>What went wrong</dt><dd data-found="false">{s.error}</dd></>}
        {s.finished?.stopped && <><dt>Ended early</dt><dd>{s.finished.stopped === "cap" ? "at its spending limit" : s.finished.stopped === "time" ? "at its time limit" : "the app was switched to Demo"}</dd></>}
      </dl>
      <Activity steps={s.steps} working={working} place={searchPlace} totalSeconds={s.finished?.seconds ?? s.seconds} defaultOpen />
    </section>
  )
}
