// The home page's question box: one line, the same composer as Research (AskBox), so the two cannot differ. Send
// starts the answer here with the same engine call, token prompt and limits as Research, makes it Research's
// conversation (with its thread) and opens Research, where it is written and where a follow-up continues it. Deep
// (a team review) and an engine without direct answers hand the question to Research, which makes its plan. A refusal
// is said under the box and the question stays in it.
import { useEffect, useState } from "react"
import { readEngine } from "@/lib/engine"
import { setAsk } from "@/lib/open"
import type { View } from "@/nav"
import type { Catalog, EffortId } from "@/home/api"
import { effortInEffect, startConversation } from "@/home/chat"
import { AskBox } from "@/research/AskBox"
import { answerLimitLine } from "@/research/limitLine"
import { ResearchRefused, startResearch } from "@/research/api"

const MAX = 2000

export function QuickAsk({ onOpen, onStarted }: { onOpen: (view: View) => void; /** An answer was started (before Research opens). */ onStarted?: (id: string) => void }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string>()
  const [catalog, setCatalog] = useState<Catalog | null>()
  const [effort, setEffort] = useState<EffortId>("standard")
  useEffect(() => {
    let stopped = false
    readEngine<Catalog>("/api/chat/catalog").then((c) => { if (!stopped) setCatalog(c) }, () => { if (!stopped) setCatalog(null) })
    return () => { stopped = true }
  }, [])
  const level = catalog ? effortInEffect(catalog, effort) : effort
  const ask = async (typed: string) => {
    const question = typed.trim().slice(0, MAX)
    if (!question || busy) return
    setRefused(undefined)
    if (level !== "quick" && level !== "standard") { setAsk(question, { send: true, effort: level }); onOpen("Home"); return } // Deep: Research makes the plan
    setBusy(true)
    try {
      const started = await startResearch(question, level)
      startConversation(question, started) // Research shows this answer as its conversation, and a follow-up there continues its thread
      onStarted?.(started.id)
      setText("")
      onOpen("Home")
    } catch (error) {
      // An engine without direct answers (or with them switched off): Research makes its team-review plan for the question.
      if (error instanceof ResearchRefused && error.status === 404 && !error.field) { setAsk(question, { send: true, effort: level }); onOpen("Home"); return }
      setRefused(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }
  const limit = answerLimitLine(catalog, level)
  return (
    <section className="ov-ask" aria-labelledby="ov-ask-title">
      <h2 id="ov-ask-title" className="ov-ask-title">Let's research together!</h2>
      <AskBox id="ov-ask-box" rows={1} value={text} onChange={setText} onSubmit={(typed) => void ask(typed)} busy={busy} placeholder="Ask a new research question…"
        efforts={catalog?.efforts ?? []} effort={level} onEffort={setEffort} name="overview-effort" sendLabel="Start research" sendTitle="Start the answer and open it in Research">
        {refused ? <p className="newrun-error" role="alert">{refused}</p> : limit ? <p className="ov-note">{limit} It opens in Research.</p> : null}
      </AskBox>
    </section>
  )
}
