// One look for "who said what": the Home chat, the board's discussion and the swarm's activity all use the AI
// Elements Conversation and Message components through these pieces. Everything a model wrote is untrusted and is
// put on the page as text (React text nodes): no Markdown, no HTML, no links or images made from model output.
import type { ReactNode } from "react"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources"
import { Verdict as VerdictChip } from "@/components/Shared"
import type { Verdict } from "@/board/api"
import type { ClaimVerdict } from "@/swarm/api"
import { inShort, safeUrl } from "@/lib/words"

/** A person's own message. */
export function UserMessage({ children, label = "You asked" }: { children: string; label?: string }) {
  return <Message from="user" role="article" aria-label={label} className="thread-user"><MessageContent><p className="home-text">{children}</p></MessageContent></Message>
}

/**
 * One message per team member: the name, a plain line about the job, the reply's first sentence ("In short"), the
 * whole reply folded underneath, and what the checks found.
 */
export function TeamMessage({ name, job, text, short, state, fullLabel = "Read the full reply", children }: { name: string; job?: string; text: string; short?: string; state?: ReactNode; fullLabel?: string; children?: ReactNode }) {
  const brief = short ?? inShort(text)
  return (
    <Message from="assistant" role="article" aria-label={name} className="thread-team">
      <p className="thread-who"><b>{name}</b>{job && <span className="muted small">{job}</span>}{state}</p>
      <MessageContent>
        {brief && <p className="thread-short"><span className="eyebrow">In short</span> {brief}</p>}
        {text.trim() && text.replace(/\s+/g, " ").trim() !== brief && (
          <details className="thread-full">
            <summary>{fullLabel}</summary>
            <p className="home-text">{text}</p>
          </details>
        )}
        {children}
      </MessageContent>
    </Message>
  )
}

/** What was checked about one statement: the plain verdict (with its glyph), the statement, the check's note, and its source. */
export function CheckedStatement({ verdict, claim, note, source, by }: { verdict: Verdict | ClaimVerdict; claim: string; note?: string; source?: string; by?: string }) {
  const url = safeUrl(source)
  return (
    <li className="thread-check">
      <VerdictChip verdict={verdict} />
      <span className="thread-claim">{claim}</span>
      {(note || by) && <span className="muted small thread-note">{[by && `Checked by ${by}`, note].filter(Boolean).join(" · ")}</span>}
      {source && (url ? (
        <Sources className="thread-sources">
          <SourcesTrigger count={1}><span className="small">Source</span></SourcesTrigger>
          <SourcesContent><Source href={url} title={url} rel="noreferrer noopener" /></SourcesContent>
        </Sources>
      ) : <span className="muted small thread-note">Source: {source}</span>)}
    </li>
  )
}
