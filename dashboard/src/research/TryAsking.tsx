// "Try asking": a row of chips near the question box. The questions and where they come from: trending.ts.
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { tryAskingNote, useTryAsking } from "./trending"

/** A row of "Try asking" chips. A click calls `onPick` with the question (the caller fills the box or sends it). */
export function TryAsking({ onPick, disabled }: { onPick: (question: string) => void; disabled?: boolean }) {
  const reply = useTryAsking()
  if (!reply) return null
  const note = tryAskingNote(reply)
  return (
    <div className="try-asking">
      <div className="try-asking-label muted small" id="try-asking-label">Try asking{note && <> · <span>{note}</span></>}</div>
      <Suggestions className="search-examples" role="group" aria-labelledby="try-asking-label">
        {reply.items.map((q) => (
          <Suggestion key={q.question} suggestion={q.question} className="btn" disabled={disabled} title={q.trending ? q.topic : undefined} onClick={onPick} />
        ))}
      </Suggestions>
    </div>
  )
}
