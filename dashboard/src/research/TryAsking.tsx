// "Try asking": a row of chips near the question box. The questions and where they come from: trending.ts.
// One row only: the engine's questions when it sends some, else the caller's fixed `fallback` questions.
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { tryAskingNote, useTryAsking } from "./trending"

/** A row of "Try asking" chips. A click calls `onPick` with the question (the caller fills the box or sends it). */
export function TryAsking({ onPick, disabled, fallback = [] }: { onPick: (question: string) => void; disabled?: boolean; /** Shown when the engine sends no questions. */ fallback?: string[] }) {
  const reply = useTryAsking()
  if (!reply) {
    if (!fallback.length) return null
    return (
      <Suggestions className="search-examples" role="group" aria-label="Example questions">
        {fallback.map((q) => <Suggestion key={q} suggestion={q} className="btn" disabled={disabled} onClick={onPick} />)}
      </Suggestions>
    )
  }
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
