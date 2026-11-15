// "Try a test protein" on the empty Research page: a question chip for each built-in test protein (asking it gives an
// answer whose Structure tab lists that protein), and a button that opens the structure viewer without asking anything.
import { useEffect, useState } from "react"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { fetchTestProteins, type TestProtein } from "./api"

export function TestProteinChips({ onPick, onOpenViewer, disabled }: { onPick: (question: string) => void; onOpenViewer: () => void; disabled?: boolean }) {
  const [tests, setTests] = useState<TestProtein[]>([])
  useEffect(() => { let on = true; void fetchTestProteins().then((t) => { if (on) setTests(t) }); return () => { on = false } }, [])
  if (!tests.length) return null
  return (
    <div className="try-asking test-proteins">
      <div className="try-asking-label muted small" id="test-proteins-label">
        Try a test protein · <button type="button" className="link-btn" onClick={onOpenViewer}>Open the structure viewer</button>
      </div>
      <Suggestions className="search-examples" role="group" aria-labelledby="test-proteins-label">
        {tests.map((t) => <Suggestion key={t.id} suggestion={t.question} className="btn" disabled={disabled} title={`${t.question} (${t.name}, ${t.organism}, UniProt ${t.accession})`} onClick={onPick}>{t.label || t.name}</Suggestion>)}
      </Suggestions>
    </div>
  )
}
