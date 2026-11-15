// A direct, sourced answer on the Search screen: an honest progress line while it is made, then the text with
// numbered citations, a mark beside each statement that was checked, the source list, and what it cost.
// Everything shown comes from the answer's own events. A mark appears only where a check was recorded; a sentence
// without one is background and carries no mark. A demo answer is labelled a demo and its marks say so.
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { SafeMarkdown, type Inline } from "@/components/SafeMarkdown"
import { Provenance } from "@/components/Provenance"
import { provenanceOf } from "@/lib/provenance"
import { plainDuration } from "@/lib/format"
import { runLimit, safeUrl, spent } from "@/lib/words"
import { Activity } from "./Activity"
import { AgentsWorking } from "./AgentsWorking"
import { AnswerImages } from "./AnswerImages"
import { Hypotheses } from "./Hypotheses"
import { ProviderCredit } from "./ProviderCredit"
import { identifierOf, MARK_GLYPH, MARK_WORD, markCount, markOf } from "./marks"
import { artifactUrl, cancelResearch, useResearchEvents } from "./api"
import { searchPlace } from "./providers"
import { copyText, foldAnswer, oncePractice, ownLines, preparation, sourceCounts, seconds, progressLine, providerPlace, stepLine, withMarks, type AnswerState, type Statement } from "./model"
import { Working } from "./Working"

const money = (usd: number) => (usd === 0 ? "nothing" : usd < 0.01 ? "less than 1 cent" : `$${usd.toFixed(2)}`)
const STOPPED: Record<string, string> = {
  cap: "It stopped at its spending limit, so it is shorter than planned.",
  time: "It stopped at its time limit, so it is shorter than planned.",
  paid_off: "It stopped because the app was switched to Demo while it was working.",
}

interface Props {
  id: string
  /** The latest answer in the thread: it may be asked again. */
  latest: boolean
  onAgain?: () => void
  /** Make the existing team-review plan for the same question (its confirm step is unchanged). */
  onReview?: () => void
  /** Called once with the finished text, so the thread can keep it. */
  onDone?: (state: AnswerState) => void
  /** Called whenever the answer's status changes, so the composer can offer Stop and show what is queued. */
  onStatus?: (status: AnswerState["status"]) => void
  /** Take a queued follow-up out again before it starts. */
  onRemove?: () => void
  /** Started on this visit (not restored): it shows the agents while it has nothing to show yet. */
  fresh?: boolean
  /** The composer below offers Stop for this answer, so the answer does not show a second one. */
  composerStops?: boolean
  /** Open the inspector on this answer, at a tab. */
  onInspect?: (tab: "evidence" | "results" | "activity") => void
}

export function ResearchAnswer({ id, latest, onAgain, onReview, onDone, onStatus, onRemove, onInspect, composerStops, fresh }: Props) {
  const { events, lost } = useResearchEvents(id)
  const s = useMemo(() => foldAnswer(events), [events])
  const key = useId().replace(/[^a-z0-9]/gi, "")
  const uid = useId()
  const [open, setOpen] = useState<number>() // the statement whose check is open
  const [lit, setLit] = useState<number>() // the source a citation chip pointed at
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState<string>() // the engine's reply to "Stop"
  const told = useRef(false)
  useEffect(() => { if (s.status === "done" && !told.current) { told.current = true; onDone?.(s) } }, [s, onDone])
  const status = s.status
  useEffect(() => { onStatus?.(status) }, [status]) // eslint-disable-line react-hooks/exhaustive-deps -- the callback changes every render; only the status matters

  const demo = s.mode === "demo"
  const working = s.status === "starting" || s.status === "queued" || s.status === "running"
  const prep = preparation(s)
  const failedSteps = s.steps.filter((x) => x.status === "failed" || (x.status === "empty" && x.kind === "search"))
  const marked = useMemo(() => withMarks(ownLines(demo ? oncePractice(s.markdown) : s.markdown), s.complete ? s.statements : [], s.sources, key), [demo, s.markdown, s.complete, s.statements, s.sources, key])
  // How many were found and selected: the engine's own counts when it sent them, else counted from its lists.
  const listed = s.selection ? s.selection.selected.length + s.selection.notSelected.length : 0
  const picked = s.selection?.counts ?? { selected: s.selection?.selected.length ?? 0, unique: listed, results: Math.max(listed, sourceCounts(s).found ?? 0) }
  const shownTitle = (title: string) => (demo ? title.replace(/\s*\((?:mock|demo|scripted)\)\s*$/i, "") : title)
  // An answer started on this visit shows the agents until it has something to show, and for at least 0.6 s, so
  // that a practice answer, which arrives at once, does not flash them. The content is never held back for it.
  const nothingYet = working && s.status !== "queued" && !s.markdown && s.hypotheses.length === 0 && s.sources.length === 0
  const [seen, setSeen] = useState(false) // 0.6 s have passed since this answer came on screen
  useEffect(() => { const timer = window.setTimeout(() => setSeen(true), 600); return () => window.clearTimeout(timer) }, [])
  const waiting = !!fresh && s.status !== "queued" && !lost && (nothingYet || !seen)
  const byIndex = new Map(s.statements.map((st) => [st.index, st]))
  const goTo = (n: number) => { setLit(n); document.getElementById(`${uid}-source-${n}`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }) }
  const mark = (st: Statement) => {
    const m = markOf(st.verdict)
    return (
      <button key={st.index} type="button" className="answer-mark" data-mark={m} data-demo={demo || undefined} aria-expanded={open === st.index} aria-controls={`${uid}-check`}
        aria-label={`${demo ? "Example check" : "Check"}: ${MARK_WORD[m]}. ${open === st.index ? "Hide" : "Show"} the quoted passage and who checked it.`}
        title={`${MARK_WORD[m]}${demo ? " (practice: not a real check)" : ""}`}
        onClick={() => setOpen(open === st.index ? undefined : st.index)}>{MARK_GLYPH[m]}</button>
    )
  }
  const inline: Inline = {
    key,
    cite: (n) => <button type="button" className="answer-cite" aria-label={`Source ${n}`} title={s.sources.find((x) => x.n === n)?.title} onClick={() => goTo(n)}>{n}</button>,
    check: (index) => { const st = byIndex.get(index); return st ? mark(st) : null },
  }
  const shown = open === undefined ? undefined : byIndex.get(open)
  const tally = (m: "supported" | "contradicted" | "insufficient" | "unchecked") => s.statements.filter((x) => markOf(x.verdict) === m).length
  const checked = s.statements.length - tally("unchecked")
  const notRun = s.searches.filter((x) => x.ran === false)
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText
  const copy = () => { void navigator.clipboard.writeText(copyText(s)).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000) }, () => setCopied(false)) }

  return (
    <>
      <p className="answer-kind">
        <Provenance kind={provenanceOf({ mode: s.mode, example: s.example })} />
        <span className="muted small">
          {demo ? "Example text and example sources. Nothing was searched and no AI model was asked."
            : s.mode === "real" ? "Written by an AI model from the sources below. A second model, from another company, checked the cited statements." : ""}
        </span>
      </p>

      {/* Timing is said once, in the activity line below. Before there is a step to count, the preparation says it is running. */}
      {prep && ((prep.running && !waiting) || prep.failed) && <p className="answer-prep mono" data-running={prep.running || undefined}>{prep.running ? "Preparing search…" : "Preparation did not finish"}</p>}
      {/* A practice answer says what it is once, beside its badge: the engine's own "this is a demo" opening is not repeated. */}
      {s.opening && !demo && <p className="answer-opening">{s.opening}</p>}
      {s.resumed && <p className="muted small">Continued after the engine restarted.</p>}
      {s.status === "queued" && !lost && (
        <div className="answer-queued" role="status">
          <span className="pill" data-kind="waiting">Queued</span>
          <span className="muted small">It starts when the answer before it ends. It does not change the answer being written now.</span>
          {onRemove && <button type="button" className="link-btn" disabled={stopping !== undefined} onClick={() => { setStopping(""); void cancelResearch(id).then(() => onRemove()) }}>Remove</button>}
        </div>
      )}
      {waiting && <AgentsWorking>{working ? progressLine(s) : "The answer is ready."}</AgentsWorking>}
      {working && s.status !== "queued" && !lost && (
        <div className="answer-working">
          {/* Until the answer has something to show: the agents, with the engine's current step in words. Then the quiet line. */}
          {!waiting && <Working>{progressLine(s)}</Working>}
          {!demo && s.caps && <span className="muted small">{runLimit(s.caps.maxUsd)} · {plainDuration(s.caps.maxSeconds * 1000)}</span>}
          {!composerStops && <button type="button" className="btn" disabled={stopping !== undefined} onClick={() => { setStopping(""); void cancelResearch(id).then(setStopping) }}>Stop</button>}
          {stopping && <span className="muted small" role="status">{stopping}</span>}
        </div>
      )}
      <Activity steps={s.steps} working={working} place={searchPlace} totalSeconds={s.finished?.seconds ?? s.seconds} preparedMs={prep && !prep.running && !prep.failed ? prep.ms : undefined} />
      {lost && working && (
        <p className="newrun-error" role="alert">The connection to the engine was lost while this answer was being made. {s.markdown ? "What arrived so far is below. " : ""}{onAgain && <button type="button" className="link-btn" onClick={onAgain}>Ask again</button>}</p>
      )}

      {s.markdown && <SafeMarkdown className="answer-text" inline={inline}>{marked.text}</SafeMarkdown>}
      {s.markdown && <AnswerImages sources={s.sources} onSource={setLit} />}
      {!s.complete && s.markdown && <p className="muted small">Still being written. It has not been checked yet.</p>}

      <div id={`${uid}-check`}>
        {shown && (
          <dl className="thread-detail answer-check" aria-label="The check on this statement">
            <dt>The statement</dt><dd>{shown.text}</dd>
            <dt>What the check found</dt>
            <dd><span className="answer-markword" data-mark={markOf(shown.verdict)}><span aria-hidden="true">{MARK_GLYPH[markOf(shown.verdict)]}</span> {MARK_WORD[markOf(shown.verdict)]}</span> <span className="muted small">(the checker's word: {shown.verdict})</span>{demo && <span className="muted small"> Practice: this is an example, not a real check.</span>}</dd>
            <dt>Quoted passage</dt>
            <dd data-found={shown.quote ? shown.quoteFound : undefined}>
              {shown.quote ? <>“{shown.quote}” {shown.quoteFound ? <span className="muted small">Found in source {shown.quoteSource ?? shown.sources[0]}.</span> : "The quoted passage was not found in the source."}</> : "The checker quoted no passage."}
            </dd>
            {shown.note && <><dt>Why</dt><dd>{shown.note}</dd></>}
            <dt>Checked by</dt><dd>{shown.checker === "scripted" ? "nobody: practice text" : shown.checker || "not recorded"}{shown.carried && <span className="muted small"> (checked on the first draft; the sentence did not change)</span>}</dd>
            <dt>Sources</dt><dd>{shown.sources.length ? shown.sources.map((n) => <button key={n} type="button" className="answer-cite" aria-label={`Source ${n}`} onClick={() => goTo(n)}>{n}</button>) : "none cited"}</dd>
          </dl>
        )}
      </div>

      {s.complete && marked.unplaced.length > 0 && (
        <ul className="answer-unplaced" aria-label="Other checked statements">
          {marked.unplaced.map((st) => <li key={st.index}>{mark(st)} <span>{st.text}</span></li>)}
        </ul>
      )}

      {s.status === "failed" && (
        <p className="newrun-error" role="alert">
          This answer could not be finished. {s.error}{s.spentUsd ? ` It had cost ${money(s.spentUsd)} when it stopped.` : ""}{" "}
          {onAgain && latest && <button type="button" className="link-btn" onClick={onAgain}>Ask again</button>}
        </p>
      )}

      {s.status === "done" && (
        <p className="answer-summary" role="status">
          {s.statements.length === 0 ? "No statement in this answer was checked against a source."
            : <>{checked} of {s.statements.length} cited statement{s.statements.length === 1 ? "" : "s"} checked: {markCount("supported", tally("supported"))}, {markCount("contradicted", tally("contradicted"))}, {markCount("insufficient", tally("insufficient"))}{tally("unchecked") > 0 && `, ${markCount("unchecked", tally("unchecked"))}`}. A sentence without a mark was not checked.</>}
          {s.sources.length === 0 && " Nothing was found to cite, so treat this as unsourced."}
        </p>
      )}

      {s.status === "cancelled" && <p className="newrun-error" role="status">This answer was stopped before it was finished{s.spentUsd ? `. It had cost ${money(s.spentUsd)}` : ""}. {s.markdown ? "What was written so far is above; it was not checked." : ""}</p>}

      {/* After the answer itself: the hypotheses it tested, then what is missing, what to do next, and the sources. */}
      <Hypotheses state={s} onSource={goTo} />
      {s.hypotheses.length === 0 && s.hypothesesNote && !working && <p className="muted small">No hypotheses were set up: {s.hypothesesNote}</p>}

      {/* The last part of the answer: what the engine's own code found to be missing. Shown whenever there is any. */}
      {s.missing.length > 0 && !working && (
        <section className="answer-missing" aria-label="What is missing">
          <h2>What is missing</h2>
          <ul>{s.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </section>
      )}

      {s.status === "done" && s.recommendations.length > 0 && (
        <section className="answer-next" aria-label="What to do next">
          <h2>What to do next</h2>
          <ul>
            {s.recommendations.map((r, i) => (
              <li key={i}>
                <span className="story-eyebrow">{r.label}</span>
                <span className="answer-next-text">{r.text}</span>
                <span className="muted small">{r.why} {r.basis.length > 0 && <>Based on {r.basis.filter((n) => s.sources.some((x) => x.n === n)).map((n, i) => <span key={n}>{i > 0 && ", "}<button type="button" className="answer-cite" aria-label={`Source ${n}`} onClick={() => goTo(n)}>{n}</button></span>)}</>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.selection && s.sources.length > 0 && (
        <section className="answer-selection" aria-label="How the sources were selected">
          <p>
            <b>Selected {picked.selected} of {picked.unique} sources automatically.</b>{" "}
            {/* The searches' own count can be higher: two searches can find the same source, and it is listed once. */}
            {picked.results > picked.unique && <>The searches returned {picked.results} results; a source found twice is counted once. </>}
          </p>
          <details>
            <summary>Why these, and their limits</summary>
            {s.selection.criteria && <p className="small">{s.selection.criteria}</p>}
            <ul>
              {s.selection.selected.map((x) => (
                <li key={x.n}><button type="button" className="answer-cite" aria-label={`Source ${x.n}`} onClick={() => goTo(x.n)}>{x.n}</button> {x.why}{x.limitation && <span className="muted"> Limit: {x.limitation}</span>}</li>
              ))}
            </ul>
          </details>
          {s.selection.notSelected.length > 0 && (
            <details>
              <summary>View all found ({s.selection.notSelected.length} not selected)</summary>
              <ul className="answer-notselected">
                {s.selection.notSelected.map((x, i) => { const url = safeUrl(x.url); return (
                  <li key={i}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{x.title || url}</a> : x.title || x.url} <span className="muted small">{providerPlace(x.provider)} · not selected: {x.reason}</span></li>
                ) })}
              </ul>
            </details>
          )}
        </section>
      )}

      {(s.sources.length > 0 || notRun.length > 0 || failedSteps.length > 0) && (
        <section className="answer-sources" aria-label="Sources">
          <h2>Sources</h2>
          {s.sources.length > 0 && (
            <ol className="answer-sourcelist">
              {s.sources.map((src) => {
                const url = safeUrl(src.url)
                const preprint = /preprint/i.test(src.note ?? "") || /\[preprint\]\s*$/i.test(src.title)
                const other = (src.note ?? "").split(",").map((x) => x.trim()).filter((x) => x && !/^preprint$/i.test(x))
                return (
                  <li key={src.n} id={`${uid}-source-${src.n}`} data-lit={lit === src.n || undefined} data-unused={s.cited && !s.cited.includes(src.n) ? "" : undefined}>
                    <span className="source-n" aria-hidden="true">{src.n}</span>
                    <span className="source-what">
                      <span className="source-title">{url ? <a href={url} target="_blank" rel="noopener noreferrer">{shownTitle(src.title) || url}</a> : shownTitle(src.title) || src.url}</span>
                      <span className="muted small">
                        {[url ? new URL(url).hostname.replace(/^www\./, "") : "not a web address", identifierOf(src.url), src.published, ...other].filter(Boolean).join(" · ")}
                        {/* an example source says so once: in its own note when it has one, else in the credit */}
                        {!(src.provider === "fixture" && other.some((x) => /example/i.test(x))) && <>{" · "}<ProviderCredit provider={src.provider} /></>}
                      </span>
                      {preprint && <span className="source-preprint">Preprint: not peer reviewed</span>}
                      {s.cited && <span className="source-use small" data-cited={s.cited.includes(src.n)}>{s.cited.includes(src.n) ? "Cited in the answer" : "Selected, but not cited in the answer"}</span>}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
          {failedSteps.map((st) => <p key={st.step} className="muted small" data-notrun="">{stepLine(st)}</p>)}
          {notRun.map((x, i) => <p key={i} className="muted small" data-notrun="">The search of {searchPlace(x.provider)} did not run{x.reason ? `: ${x.reason}` : "."} The answer was written without it.</p>)}
        </section>
      )}

      {s.status === "done" && s.finished && (
        <p className="muted small answer-foot">
          {demo ? "Practice: nothing was spent." : `${spent(s.finished.usd)}${s.caps ? ` of a run limit of ${money(s.caps.maxUsd)}` : ""}. Completed in ${seconds(s.finished.seconds * 1000)}.`}
          {s.finished.review?.notes && !demo && ` A critic raised ${s.finished.review.notes.raised} point${s.finished.review.notes.raised === 1 ? "" : "s"}; ${s.finished.review.notes.resolved} ${s.finished.review.notes.resolved === 1 ? "was" : "were"} dealt with${s.finished.review.revised ? " in one revision" : ""}.`}
          {s.finished.stopped && ` ${STOPPED[s.finished.stopped] ?? "It ended early."}`}{s.finished.note && ` ${s.finished.note}`}
        </p>
      )}

      {s.status === "done" && s.artifacts.length > 0 && (
        <p className="muted small answer-files">Files: {s.artifacts.map((a) => <a key={a.name} href={artifactUrl(id, a.name)} download={a.name}>{a.name}</a>)}</p>
      )}

      {!working && (
        <div className="answer-actions">
          {canCopy && s.markdown && <button type="button" className="link-btn" onClick={copy}>{copied ? "Copied" : "Copy answer"}</button>}
          {!s.example && latest && onAgain && (s.status === "done" || s.status === "cancelled") && <button type="button" className="link-btn" onClick={onAgain}>Ask again</button>}
          {onReview && s.status === "done" && <button type="button" className="link-btn" onClick={onReview}>Have a team review this</button>}
          {onInspect && (s.sources.length > 0 || s.statements.length > 0) && <button type="button" className="link-btn" onClick={() => onInspect("evidence")}>Inspect the evidence</button>}
        </div>
      )}
    </>
  )
}
