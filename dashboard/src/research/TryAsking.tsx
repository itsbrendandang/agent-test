// "Try asking": a row of chips near the question box. The questions and where they come from: trending.ts.
// One row only: the engine's questions when it sends some, else the caller's fixed `fallback` questions.
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { CANCER_DRUG } from "@/overview/starters"
import { tryAskingNote, useTryAsking } from "./trending"

/** Always the first chip: the cancer-drug question the Graph view's built-in example maps. */
const FIRST = CANCER_DRUG.question

/** A row of "Try asking" chips, the cancer-drug example first. A click calls `onPick` with the question (the caller fills the box or sends it). */
export function TryAsking({ onPick, disabled, fallback = [] }: { onPick: (question: string) => void; disabled?: boolean; /** Shown when the engine sends no questions. */ fallback?: string[] }) {
  const reply = useTryAsking()
  if (!reply) {
    if (!fallback.length) return null
    return (
      <Suggestions className="search-examples" role="group" aria-label="Example questions">
        {[FIRST, ...fallback.filter((q) => q !== FIRST)].map((q) => <Suggestion key={q} suggestion={q} className="btn" disabled={disabled} onClick={onPick} />)}
      </Suggestions>
    )
  }
  const note = tryAskingNote(reply)
  return (
    <div className="try-asking">
      <div className="try-asking-label muted small" id="try-asking-label">Try asking{note && <> · <span>{note}</span></>}</div>
      <Suggestions className="search-examples" role="group" aria-labelledby="try-asking-label">
        <Suggestion key={FIRST} suggestion={FIRST} className="btn" disabled={disabled} title={CANCER_DRUG.topic} onClick={onPick} />
        {reply.items.filter((q) => q.question !== FIRST).map((q) => (
          <Suggestion key={q.question} suggestion={q.question} className="btn" disabled={disabled} title={q.trending ? q.topic : undefined} onClick={onPick} />
        ))}
      </Suggestions>
    </div>
  )
}
