// One look for "who said what": the Home chat, the board's discussion and the swarm's activity all use the AI
// Elements Conversation and Message components through these pieces. Everything a model wrote is untrusted and is
// put on the page as text (React text nodes): no Markdown, no HTML, no links or images made from model output.
import { type ReactNode, useId, useState } from "react"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { SearchCredit, Verdict as VerdictChip } from "@/components/Shared"
import type { Verdict } from "@/board/api"
import type { ClaimVerdict } from "@/swarm/api"
import { MARK_WORD, markOf, safeUrl, splitReply } from "@/lib/words"

/** A person's own message. */
export function UserMessage({ children, label = "You asked" }: { children: string; label?: string }) {
  return <Message from="user" role="article" aria-label={label} className="thread-user"><MessageContent><p className="home-text">{children}</p></MessageContent></Message>
}

/** One statement a speaker made, and what a check found about it. */
export interface Checked {
  key: string; verdict: Verdict | ClaimVerdict; claim: string; why?: string; source?: string; by?: string
  /** The passage the checker quoted from the source, and whether code found it there. */
  quote?: { text?: string; found: boolean }
  /** Where that source came from, when the run recorded it. */
  sourceProvider?: "exa" | "fixture" | "europepmc"
}

/**
 * One message per team member, like a group chat: who is speaking and what their job is, the one sentence that says
 * where they stand ("In short"), the whole reply folded underneath, and a chip for each statement a check ruled
 * on. A statement that was proven wrong marks the whole message: that is the moment the reader must not miss.
 */
export function TeamMessage({ name, job, text, short, state, fullLabel = "Show full reply", checks = [], flag }: {
  name: string; job?: string; text: string; short?: string; state?: ReactNode; fullLabel?: string; checks?: Checked[]
  /** Something in this message that went against someone or something, in plain words. Shown as a marked line. */
  flag?: string
}) {
  const reply = splitReply(text)
  const brief = short ?? reply.short
  // A line given from outside (the engine's own summary of the reply) is used as it is. The full reply never repeats it.
  const rest = short === undefined || reply.marked ? reply.rest : text.trim() === short.trim() ? "" : text.trim()
  const wrong = checks.filter((c) => markOf(c.verdict) === "contradicted").length
  const [open, setOpen] = useState<string>()
  const uid = useId()
  const shown = checks.find((c) => c.key === open)
  return (
    <Message from="assistant" role="article" aria-label={name} className="thread-team" data-wrong={wrong > 0 || !!flag || undefined}>
      <p className="thread-who"><b>{name}</b>{job && <span className="thread-job">{job}</span>}{state}</p>
      <MessageContent>
        <p className="thread-short">{brief || "(This reply was empty.)"}</p>
        {(wrong > 0 || flag) && (
          <p className="thread-flag">
            <span aria-hidden="true">✕</span> {flag ?? (wrong === 1 ? "A check contradicted one statement here." : `A check contradicted ${wrong} statements here.`)}
          </p>
        )}
        {checks.length > 0 && (
          <div className="thread-chips" role="group" aria-label={`What the checks found about ${name}'s statements`}>
            {checks.map((c, i) => (
              <button key={c.key} type="button" className="thread-chip" aria-expanded={open === c.key} aria-controls={`${uid}-detail`}
                aria-label={`Statement ${i + 1}: ${MARK_WORD[markOf(c.verdict)]}. ${open === c.key ? "Hide" : "Show"} the statement and why.`}
                onClick={() => setOpen(open === c.key ? undefined : c.key)}>
                <VerdictChip verdict={c.verdict} />
              </button>
            ))}
            <span className="muted small">{checks.length === 1 ? "1 statement checked. Press it to see why." : `${checks.length} statements checked. Press one to see why.`}</span>
          </div>
        )}
        <div id={`${uid}-detail`}>
          {shown && (
            <dl className="thread-detail">
              <dt>The statement</dt><dd>{shown.claim}</dd>
              <dt>What the check found</dt><dd><VerdictChip verdict={shown.verdict} technical /></dd>
              <dt>Why</dt><dd>{shown.why || "The check gave no reason."}</dd>
              {shown.by && <><dt>Checked by</dt><dd>{shown.by}</dd></>}
              <dt>Source</dt><dd>{shown.source ? <><SourceRef source={shown.source} />{shown.sourceProvider && <> · <SearchCredit provider={shown.sourceProvider} /></>}</> : "No source was recorded."}</dd>
              {shown.quote && <><dt>Quoted passage</dt><dd data-found={shown.quote.found}>{shown.quote.found ? <>Found in the source{shown.quote.text ? <>: “{shown.quote.text}”</> : "."}</> : "The quoted passage was not found in the source."}</dd></>}
            </dl>
          )}
        </div>
        {rest && (
          <details className="thread-full">
            <summary>{fullLabel}</summary>
            <p className="home-text">{rest}</p>
          </details>
        )}
      </MessageContent>
    </Message>
  )
}

/** A source as a record gave it. Only an http(s) address becomes a link; anything else stays text. */
function SourceRef({ source }: { source: string }) {
  const url = safeUrl(source)
  return url ? <a href={url} target="_blank" rel="noreferrer noopener">{url}</a> : <>{source === "brief" ? "the brief (the question and data the team was given)" : source}</>
}
