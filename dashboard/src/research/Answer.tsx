// A direct, sourced answer on the Search screen: an honest progress line while it is made, then the text with
// numbered citations, a mark beside each statement that was checked, the source list, and what it cost.
// Everything shown comes from the answer's own events. A mark appears only where a check was recorded; a sentence
// without one is background and carries no mark. A demo answer is labelled a demo and its marks say so.
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { SafeMarkdown, type Inline } from "@/components/SafeMarkdown"
import { SearchCredit, Verdict as VerdictChip } from "@/components/Shared"
import { plainDuration } from "@/lib/format"
import { outcomeOf } from "@/lib/verdict"
import { safeUrl, VERDICT_WORD, verdictCount } from "@/lib/words"
import { artifactUrl, cancelResearch, useResearchEvents } from "./api"
import { copyText, foldAnswer, preparation, seconds, progressLine, providerPlace, stepLine, withMarks, type AnswerState, type Statement } from "./model"
import { Working } from "./Working"

const KNOWN = ["exa", "europepmc", "fixture"]
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
}

export function ResearchAnswer({ id, latest, onAgain, onReview, onDone }: Props) {
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

  const demo = s.mode === "demo"
  const working = s.status === "starting" || s.status === "queued" || s.status === "running"
  const prepared = s.steps.find((x) => x.kind === "prepare" && x.status === "completed")?.ms
  const prep = preparation(s)
  const failedSteps = s.steps.filter((x) => x.status === "failed" || (x.status === "empty" && x.kind === "search"))
  const marked = useMemo(() => withMarks(s.markdown, s.complete ? s.statements : [], s.sources, key), [s.markdown, s.complete, s.statements, s.sources, key])
  const byIndex = new Map(s.statements.map((st) => [st.index, st]))
  const goTo = (n: number) => { setLit(n); document.getElementById(`${uid}-source-${n}`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }) }
  const mark = (st: Statement) => (
    <button key={st.index} type="button" className="answer-mark" data-outcome={outcomeOf(st.verdict)} aria-expanded={open === st.index} aria-controls={`${uid}-check`}
      aria-label={`${demo ? "Demo check" : "Check"}: ${st.verdict === "unchecked" ? "Not checked" : VERDICT_WORD[outcomeOf(st.verdict)]}. ${open === st.index ? "Hide" : "Show"} the quoted passage and who checked it.`}
      title={`${st.verdict === "unchecked" ? "Not checked" : VERDICT_WORD[outcomeOf(st.verdict)]}${demo ? " (demo: not a real check)" : ""}`}
      onClick={() => setOpen(open === st.index ? undefined : st.index)}>
      {st.verdict === "unchecked" ? "–" : outcomeOf(st.verdict) === "holds" ? "✓" : outcomeOf(st.verdict) === "fails" ? "✕" : "?"}
    </button>
  )
  const inline: Inline = {
    key,
    cite: (n) => <button type="button" className="answer-cite" aria-label={`Source ${n}`} title={s.sources.find((x) => x.n === n)?.title} onClick={() => goTo(n)}>{n}</button>,
    check: (index) => { const st = byIndex.get(index); return st ? mark(st) : null },
  }
  const shown = open === undefined ? undefined : byIndex.get(open)
  const counts = { holds: s.statements.filter((x) => outcomeOf(x.verdict) === "holds").length, fails: s.statements.filter((x) => outcomeOf(x.verdict) === "fails").length, unknown: s.statements.filter((x) => outcomeOf(x.verdict) === "unknown").length }
  const notRun = s.searches.filter((x) => x.ran === false)
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText
  const copy = () => { void navigator.clipboard.writeText(copyText(s)).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000) }, () => setCopied(false)) }

  return (
    <>
      <p className="answer-kind">
        {s.mode && <span className="pill" data-kind={demo ? "neutral" : "info"} data-mode={demo ? "scripted" : undefined}>{demo ? "Demo response" : "AI answer"}</span>}
        <span className="muted small">
          {demo ? "Fixed example text and example sources. No search ran and no AI model was asked."
            : s.mode === "real" ? "Written by an AI model from the sources below. A second AI, from another company, checked each cited statement against its source." : ""}
        </span>
      </p>

      {prep && (
        <p className="answer-prep mono" data-running={prep.running || undefined}>
          {prep.running ? "Preparing search…" : prep.failed ? "Preparation did not finish" : `Prepared in ${seconds(prep.ms)}`}
          {s.status === "done" && s.finished && <> · Completed in {seconds(s.finished.seconds * 1000)}</>}
        </p>
      )}
      {s.opening && <p className="answer-opening">{s.opening}</p>}
      {s.resumed && <p className="muted small">Continued after the engine restarted.</p>}
      {working && !lost && (
        <div className="answer-working">
          <Working>{progressLine(s)}</Working>
          {!demo && s.caps && <span className="muted small">Limit for this answer: {money(s.caps.maxUsd)} and {plainDuration(s.caps.maxSeconds * 1000)}.</span>}
          <button type="button" className="btn" disabled={stopping !== undefined} onClick={() => { setStopping(""); void cancelResearch(id).then(setStopping) }}>Stop</button>
          {stopping && <span className="muted small" role="status">{stopping}</span>}
        </div>
      )}
      {s.steps.length > 0 && (
        <details className="answer-steps">
          <summary>{working ? "What it is doing" : `How this answer was made (${s.steps.length} steps${prepared ? `, prepared in ${plainDuration(prepared)}` : ""})`}</summary>
          <ol>{s.steps.map((st) => <li key={st.step} data-status={st.status}>{stepLine(st)}{st.ms !== undefined && st.status !== "running" && <span className="muted small"> {plainDuration(st.ms)}</span>}</li>)}</ol>
        </details>
      )}
      {lost && working && (
        <p className="newrun-error" role="alert">The connection to the engine was lost while this answer was being made. {s.markdown ? "What arrived so far is below. " : ""}{onAgain && <button type="button" className="link-btn" onClick={onAgain}>Ask again</button>}</p>
      )}

      {s.markdown && <SafeMarkdown className="answer-text" inline={inline}>{marked.text}</SafeMarkdown>}
      {!s.complete && s.markdown && <p className="muted small">Still being written. It has not been checked yet.</p>}

      <div id={`${uid}-check`}>
        {shown && (
          <dl className="thread-detail answer-check" aria-label="The check on this statement">
            <dt>The statement</dt><dd>{shown.text}</dd>
            <dt>What the check found</dt>
            <dd>{shown.verdict === "unchecked" ? <span className="pill v-unchecked">Not checked</span> : <VerdictChip verdict={shown.verdict} technical />}{demo && <span className="muted small"> Demo: this is an example, not a real check.</span>}</dd>
            <dt>Quoted passage</dt>
            <dd data-found={shown.quote ? shown.quoteFound : undefined}>
              {shown.quote ? <>“{shown.quote}” {shown.quoteFound ? <span className="muted small">Found in source {shown.quoteSource ?? shown.sources[0]}.</span> : "The quoted passage was not found in the source."}</> : "The checker quoted no passage."}
            </dd>
            {shown.note && <><dt>Why</dt><dd>{shown.note}</dd></>}
            <dt>Checked by</dt><dd>{shown.checker === "scripted" ? "nobody: demo text" : shown.checker || "not recorded"}{shown.carried && <span className="muted small"> (checked on the first draft; the sentence did not change)</span>}</dd>
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
            : <>{demo ? "Demo checks, not real ones: " : "Checked against the sources: "}{verdictCount("holds", counts.holds)}, {verdictCount("fails", counts.fails)}, {verdictCount("unknown", counts.unknown)}. A sentence without a mark was not checked.</>}
          {s.sources.length === 0 && " Nothing was found to cite, so treat this as unsourced."}
        </p>
      )}

      {s.status === "cancelled" && <p className="newrun-error" role="status">This answer was stopped before it was finished{s.spentUsd ? `. It had cost ${money(s.spentUsd)}` : ""}. {s.markdown ? "What was written so far is above; it was not checked." : ""}</p>}

      {s.status === "done" && s.recommendations.length > 0 && (
        <section className="answer-next" aria-label="What to do next">
          <h2>What to do next</h2>
          <ul>
            {s.recommendations.map((r, i) => (
              <li key={i}>
                <span className="story-eyebrow">{r.label}</span>
                <span className="answer-next-text">{r.text}</span>
                <span className="muted small">{r.why} {r.basis.length > 0 && <>Based on {r.basis.map((n) => <button key={n} type="button" className="answer-cite" aria-label={`Source ${n}`} onClick={() => goTo(n)}>{n}</button>)}</>}</span>
              </li>
            ))}
          </ul>
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
                      <span className="source-title">{url ? <a href={url} target="_blank" rel="noopener noreferrer">{src.title || url}</a> : src.title || src.url}</span>
                      <span className="muted small">
                        {[url ? new URL(url).hostname.replace(/^www\./, "") : "not a web address", ...other].join(" · ")}
                        {" · "}{KNOWN.includes(src.provider) ? <SearchCredit provider={src.provider as "exa" | "europepmc" | "fixture"} /> : <span className="search-credit">Found in {src.provider}</span>}
                      </span>
                      {preprint && <span className="source-preprint">Preprint: not peer reviewed</span>}
                      {s.cited && !s.cited.includes(src.n) && <span className="muted small">Read, but not cited in the answer.</span>}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
          {failedSteps.map((st) => <p key={st.step} className="muted small" data-notrun="">{stepLine(st)}</p>)}
          {notRun.map((x, i) => <p key={i} className="muted small" data-notrun="">The search of {providerPlace(x.provider)} did not run{x.reason ? `: ${x.reason}` : "."} The answer was written without it.</p>)}
        </section>
      )}

      {s.status === "done" && s.finished && (
        <p className="muted small answer-foot">
          {demo ? "Demo: it cost nothing." : `It cost ${money(s.finished.usd)} and took ${plainDuration(s.finished.seconds * 1000)}.`}
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
          {latest && onAgain && (s.status === "done" || s.status === "cancelled") && <button type="button" className="link-btn" onClick={onAgain}>Ask again</button>}
          {onReview && s.status === "done" && <button type="button" className="link-btn" onClick={onReview}>Have a team review this</button>}
        </div>
      )}
    </>
  )
}
