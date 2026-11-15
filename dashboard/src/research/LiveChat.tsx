// The live answer chat: one question and its answer as a conversation, with the answer's text appearing as the engine
// writes it. It is a component on its own, for any place that shows an answer being made: the Research page's running
// answer (beside the Agent Lab), or a live preview opened from a running item on the Overview.
// The text comes from the answer's own event stream (answer.delta pieces, then the finished text) over the one
// connection the answer holds; a reconnect or a reload picks the stream up where it was (api.ts). A finished answer is
// drawn at once: it is never typed out as if it were being written. While the answer is made, quiet lines above the
// text say what the team is doing, in the engine's own words (LiveSteps, also used by the Research answer).
// The text is untrusted model output: it is drawn by SafeMarkdown (streamdown with raw HTML, images and non-http links
// turned off), inside the AI Elements Conversation and Message.
import { useId, useMemo, useState } from "react"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { Loader } from "@/components/ai-elements/loader"
import { Provenance } from "@/components/Provenance"
import { SafeMarkdown, type Inline } from "@/components/SafeMarkdown"
import { provenanceOf } from "@/lib/provenance"
import { MARK_GLYPH, MARK_WORD, markOf, safeUrl } from "@/lib/words"
import { cancelResearch, useResearchEvents } from "./api"
import { foldAnswer, ownLines, progressLine, withMarks, type AnswerState } from "./model"
import { Working } from "./Working"
import { doneLine, isLive, isWorking, statusLines, type LiveTarget } from "./liveModel"
import "@/design/research.css"
import "@/design/livechat.css"

const ICON = { completed: "✓", empty: "○", failed: "✕", cancelled: "■" } as const

/**
 * The quiet status lines of an answer being made: the steps running now and the last few that ended. Nothing once it
 * has ended. `ended`: only the steps that ended (for a view that already says the running step in its own line).
 */
export function LiveSteps({ state, ended = false }: { state: AnswerState; ended?: boolean }) {
  const lines = statusLines(state).filter((line) => !ended || line.status !== "running")
  if (!lines.length) return null
  return (
    <ul className="live-steps" aria-label={ended ? "What the team has done so far" : "What the team is doing"}>
      {lines.map((line) => (
        <li key={line.key} data-status={line.status}>
          <span className="live-icon" aria-hidden="true">{line.status === "running" ? <Loader size={12} /> : ICON[line.status]}</span>
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  )
}

interface Props {
  target: LiveTarget
  /** A link to the whole answer (in Research: every check, the inspector, a follow-up). Absent: no link. */
  onContinue?: () => void
  continueLabel?: string
  /** A smaller preview (no Stop, a lower log), for a list of running work. */
  compact?: boolean
  /** The heading level of the question: 2 on a page of its own, 3 inside a section. */
  level?: 2 | 3
}

export function LiveChat({ target, onContinue, continueLabel = "Open in Research", compact = false, level = 2 }: Props) {
  const { events, lost } = useResearchEvents(target.id)
  const s = useMemo(() => foldAnswer(events), [events])
  const key = useId().replace(/[^a-z0-9]/gi, "")
  const uid = useId()
  const [stopping, setStopping] = useState<string>()
  const working = isWorking(s), live = isLive(s)
  const demo = s.mode === "demo"
  const marked = useMemo(() => withMarks(ownLines(s.markdown), s.complete ? s.statements : [], s.sources, key), [s.markdown, s.complete, s.statements, s.sources, key])
  const byIndex = useMemo(() => new Map(s.statements.map((st) => [st.index, st])), [s.statements])
  const inline: Inline = {
    key,
    cite: (n) => <button type="button" className="answer-cite" aria-label={`Source ${n}`} title={s.sources.find((x) => x.n === n)?.title} onClick={() => document.getElementById(`${uid}-source-${n}`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" })}>{n}</button>,
    check: (index) => {
      const st = byIndex.get(index); if (!st) return null
      const m = markOf(st.verdict)
      return <span className="answer-mark" data-mark={m} role="img" aria-label={`${demo ? "Example check" : "Check"}: ${MARK_WORD[m]}`} title={`${MARK_WORD[m]}${demo ? " (practice: not a real check)" : ""}`}>{MARK_GLYPH[m]}</span>
    },
  }
  const title = (t: string) => (demo ? t.replace(/\s*\((?:mock|demo|scripted)\)\s*$/i, "") : t)
  const Heading = level === 3 ? "h3" : "h2"

  return (
    <section className="live-chat" aria-labelledby={`${uid}-q`} data-status={s.status} data-compact={compact || undefined}>
      <div className="live-head">
        <span className="live-label">Live answer</span>
        <Provenance kind={provenanceOf({ mode: s.mode, example: s.example ?? target.example })} />
        {live && s.markdown && <span className="live-now" role="status"><span className="live-dot" aria-hidden="true" />Writing now</span>}
      </div>
      <Conversation className="live-log" aria-label="The question and its answer" aria-busy={working}>
        <ConversationContent className="live-thread">
          <Message from="user" className="thread-user" role="article" aria-label="You asked">
            <MessageContent><Heading id={`${uid}-q`} className="home-text">{target.question}</Heading></MessageContent>
          </Message>
          <Message from="assistant" className="live-reply" role="article" aria-label="Answer">
            <MessageContent>
              <LiveSteps state={s} />
              {working && statusLines(s).length === 0 && !lost && <Working>{progressLine(s)}</Working>}
              {s.markdown && <SafeMarkdown className="answer-text live-text" inline={inline} live={live}>{marked.text}</SafeMarkdown>}
              {live && s.markdown && <p className="muted small">Being written now. It has not been checked yet.</p>}
              {working && s.complete && <p className="muted small">Written. The cited statements are being checked against their sources.</p>}
              {lost && working && <p className="newrun-error" role="alert">The connection to the engine was lost. It reconnects by itself; what arrived so far is kept.</p>}
              {s.status === "failed" && <p className="newrun-error" role="alert">This answer could not be finished. {s.error}</p>}
              {s.status === "cancelled" && <p className="newrun-error" role="status">This answer was stopped before it was finished.{s.markdown ? " What was written so far is above; it was not checked." : ""}</p>}
              {s.status === "done" && <p className="muted small live-done" role="status">{doneLine(s)}</p>}
              {s.status === "done" && s.sources.length > 0 && !compact && (
                <ol className="live-sources" aria-label="Sources">
                  {s.sources.map((src) => {
                    const url = safeUrl(src.url)
                    return <li key={src.n} id={`${uid}-source-${src.n}`}><span className="source-n" aria-hidden="true">{src.n}</span>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{title(src.title) || url}</a> : title(src.title) || src.url}</li>
                  })}
                </ol>
              )}
            </MessageContent>
          </Message>
        </ConversationContent>
        <ConversationScrollButton className="btn home-latest" aria-label="Scroll to the latest text" title="Scroll to the latest text" />
      </Conversation>
      {(onContinue || (working && !compact && !target.example)) && (
        <div className="live-foot">
          {onContinue && <button type="button" className="link-btn" onClick={onContinue}>{continueLabel}</button>}
          {working && !compact && !target.example && <button type="button" className="link-btn" disabled={stopping !== undefined} onClick={() => { setStopping(""); void cancelResearch(target.id).then(setStopping) }}>Stop</button>}
          {stopping && <span className="muted small" role="status">{stopping}</span>}
        </div>
      )}
    </section>
  )
}
