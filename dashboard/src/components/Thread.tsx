// One look for "who said what": the Home chat and the swarm's activity both use the AI
// Elements Conversation and Message components through these pieces. Everything a model wrote is untrusted and is
// put on the page as text (React text nodes): no Markdown, no HTML, no links or images made from model output.
import type { SearchProvider } from "@/board/api"
import { type ReactNode, useId, useState } from "react"
import "@/design/research.css"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { SearchCredit, Verdict as VerdictChip } from "@/components/Shared"
import type { Verdict } from "@/board/api"
import type { ClaimVerdict } from "@/swarm/api"
import { AgentFace } from "@/research/AgentFace"
import { agentKey } from "@/research/faces"
import { MARK_GLYPH, MARK_WORD, MARKS, markOf, safeUrl, splitReply, type Mark } from "@/lib/words"

/** A person's own message. */
export function UserMessage({ children, label = "You asked" }: { children: string; label?: string }) {
  return <Message from="user" role="article" aria-label={label} className="thread-user"><MessageContent><p className="home-text">{children}</p></MessageContent></Message>
}

/** From this many statements in one reply, the chips are grouped by mark instead of one chip each. */
const MANY = 6
/** "5 of 8 statements checked." A statement marked Not checked was not checked, and is not counted as if it were. */
const said = (checks: Checked[]) => { const done = checks.filter((c) => markOf(c.verdict) !== "unchecked").length; return `${done} of ${checks.length} statement${checks.length === 1 ? "" : "s"} checked.` }

/** One statement a speaker made, and what a check found about it. */
export interface Checked {
  key: string; verdict: Verdict | ClaimVerdict; claim: string; why?: string; source?: string; by?: string
  /** The passage the checker quoted from the source, and whether code found it there. */
  quote?: { text?: string; found: boolean }
  /** Where that source came from, when the run recorded it. */
  sourceProvider?: SearchProvider
  /** The address of this statement's node in the run's graph (lib/links.ts graphLink). */
  graph?: string
}

/**
 * One message per team member, like a group chat: who is speaking and what their job is, the one sentence that says
 * where they stand ("In short"), the whole reply folded underneath, and a chip for each statement a check ruled
 * on. A statement that was proven wrong marks the whole message: that is the moment the reader must not miss.
 */
export function TeamMessage({ name, job, text, short, state, fullLabel = "Show full reply", checks = [], flag, agent }: {
  name: string; job?: string; text: string; short?: string; state?: ReactNode; fullLabel?: string; checks?: Checked[]
  /** Something in this message that went against someone or something, in plain words. Shown as a marked line. */
  flag?: string
  /** The engine's own name for the agent ("methods-auditor"). Without it the face is found from the label. */
  agent?: string
}) {
  const reply = splitReply(text)
  const brief = short ?? reply.short
  // A line given from outside (the engine's own summary of the reply) is used as it is. The full reply never repeats it.
  const rest = short === undefined || reply.marked ? reply.rest : text.trim() === short.trim() ? "" : text.trim()
  const wrong = checks.filter((c) => markOf(c.verdict) === "contradicted").length
  const [open, setOpen] = useState<string>()
  const [group, setGroup] = useState<Mark>()
  const uid = useId()
  const shown = checks.find((c) => c.key === open)
  return (
    <Message from="assistant" role="article" aria-label={name} className="thread-team" data-agent={agentKey(agent ?? name)} data-wrong={wrong > 0 || !!flag || undefined}>
      {/* Chat style: the agent's picture on the left, its label and what it said beside it. The picture is decoration. */}
      <span className="thread-face"><AgentFace agent={agent ?? name} size={32} /></span>
      <p className="thread-who"><b>{name}</b>{job && <span className="thread-job">{job}</span>}{state}</p>
      <MessageContent>
        <p className="thread-short">{brief || "(This reply was empty.)"}</p>
        {(wrong > 0 || flag) && (
          <p className="thread-flag">
            <span aria-hidden="true">✕</span> {flag ?? (wrong === 1 ? "A check contradicted one statement here." : `A check contradicted ${wrong} statements here.`)}
          </p>
        )}
        {checks.length > 0 && checks.length <= MANY && (
          <div className="thread-chips" role="group" aria-label={`What the checks found about ${name}'s statements`}>
            {checks.map((c, i) => (
              <button key={c.key} type="button" className="thread-chip" aria-expanded={open === c.key} aria-controls={`${uid}-detail`}
                aria-label={`Statement ${i + 1}: ${MARK_WORD[markOf(c.verdict)]}. ${open === c.key ? "Hide" : "Show"} the statement and why.`}
                onClick={() => setOpen(open === c.key ? undefined : c.key)}>
                <VerdictChip verdict={c.verdict} />
              </button>
            ))}
            <span className="muted small">{said(checks)} Press one to see why.</span>
          </div>
        )}
        {/* Many statements in one reply: one chip per mark with its count, opening the list of those statements. */}
        {checks.length > MANY && (
          <div className="thread-chips" role="group" aria-label={`What the checks found about ${name}'s statements`}>
            {MARKS.filter((m) => checks.some((c) => markOf(c.verdict) === m)).map((m) => {
              const n = checks.filter((c) => markOf(c.verdict) === m).length
              return (
                <button key={m} type="button" className="thread-chip" aria-expanded={group === m} aria-controls={`${uid}-group`}
                  aria-label={`${n} ${MARK_WORD[m]}. ${group === m ? "Hide" : "Show"} these statements.`} onClick={() => { setGroup(group === m ? undefined : m); setOpen(undefined) }}>
                  <span className="pill thread-count" data-mark={m}><span aria-hidden="true">{MARK_GLYPH[m]}</span> {n} {MARK_WORD[m].toLowerCase()}</span>
                </button>
              )
            })}
            <span className="muted small">{said(checks)} Press a group to see its statements.</span>
          </div>
        )}
        <div id={`${uid}-group`}>
          {group && (
            <ol className="thread-grouplist" aria-label={`${MARK_WORD[group]} statements`}>
              {checks.filter((c) => markOf(c.verdict) === group).map((c) => (
                <li key={c.key}>
                  <button type="button" className="link-btn" aria-expanded={open === c.key} aria-controls={`${uid}-detail`} onClick={() => setOpen(open === c.key ? undefined : c.key)}>{c.claim}</button>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div id={`${uid}-detail`}>
          {shown && (
            <dl className="thread-detail">
              <dt>The statement</dt><dd>{shown.claim}</dd>
              <dt>What the check found</dt><dd><VerdictChip verdict={shown.verdict} technical /></dd>
              <dt>Why</dt><dd>{shown.why || "The check gave no reason."}</dd>
              {shown.by && <><dt>Checked by</dt><dd>{shown.by}</dd></>}
              <dt>Source</dt><dd>{shown.source ? <><SourceRef source={shown.source} />{shown.sourceProvider && <> · <SearchCredit provider={shown.sourceProvider} /></>}</> : "No source was recorded."}</dd>
              {shown.graph && <><dt>In the graph</dt><dd><a href={shown.graph}>Show this statement and its checks in the graph</a></dd></>}
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
