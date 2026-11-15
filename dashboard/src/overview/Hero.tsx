// The welcome at the top of the home page: a few of the agents, eager to start, around a question box. The
// characters here are a greeting and move by themselves (they stand still when the system asks for less motion);
// they are not a picture of work being done. Real work is shown in Agent Lab, where nothing moves without an event.
// Pressing the send button starts the answer from this page (the same engine call, token prompt and limits as Research;
// the answer itself is shown in Research),
// or, when the page gives no `onAsk`, hands the question to Research. The line under the box says what that may
// cost before the press. A starter question only fills the box: biology questions trending on Google now
// (research/trending.ts), else the fixed STARTERS.
import { useEffect, useRef, useState, type CSSProperties } from "react"
import { agentIdentity } from "@/lab/identity"
import { Mascot } from "@/lab/Mascot"
import { readEngine } from "@/lib/engine"
import { setAsk } from "@/lib/open"
import type { View } from "@/nav"
import { STARTERS } from "@/overview/starters"
import type { Catalog, EffortId } from "@/home/api"
import { effortInEffect } from "@/home/chat"
import { AskBox } from "@/research/AskBox"
import { answerLimitLine } from "@/research/limitLine"
import { tryAskingNote, useTryAsking } from "@/research/trending"
import "@/design/overview.css"

/** Who greets you, with one plain line each: the jobs a question passes through. */
const TEAM: { name: string; does: string }[] = [
  { name: "scout", does: "finds sources" },
  { name: "proposer", does: "plans the work" },
  { name: "experimenter", does: "runs the analysis" },
  { name: "critic", does: "tries to disprove it" },
  { name: "methods-auditor", does: "checks the method" },
  { name: "reporter", does: "writes it up" },
]
const MAX = 2000

export function Hero({ onOpen, onAsk }: { onOpen: (view: View) => void; /** Start the answer on this page. Absent: the question is handed to Research. */ onAsk?: (question: string, effort: "quick" | "standard") => Promise<boolean> }) {
  const [text, setText] = useState("")
  const [focused, setFocused] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  // What a Standard answer may cost, in Research's own words, shown before the press.
  const [catalog, setCatalog] = useState<Catalog | null>()
  const [effort, setEffort] = useState<EffortId>("standard")
  useEffect(() => {
    let stopped = false
    readEngine<Catalog>("/api/chat/catalog").then((c) => { if (!stopped) setCatalog(c) }, () => { if (!stopped) setCatalog(null) })
    return () => { stopped = true }
  }, [])
  const limit = answerLimitLine(catalog, effort)
  // Biology questions from what is trending on Google now (or curated ones); the fixed starters when the engine is not there.
  const trending = useTryAsking()
  const starters = trending?.items.slice(0, 3) ?? STARTERS
  const note = tryAskingNote(trending)
  const eager = focused || text.trim().length > 0
  const ask = (asked: string) => {
    const question = asked.trim()
    if (!question) { box.current?.focus(); return }
    const level = catalog ? effortInEffect(catalog, effort) : effort
    // Deep is a team review (Research makes its plan); Quick and Standard are direct answers, started on the page.
    if (onAsk && (level === "quick" || level === "standard")) { void onAsk(question.slice(0, MAX), level).then((started) => { if (started) setText("") }); return } // a refused question stays in the box
    setAsk(question.slice(0, MAX), { send: true, effort: level })
    onOpen("Home")
  }
  return (
    <section className="ov-hero" aria-labelledby="ov-hero-title" data-eager={eager || undefined}>
      <div className="ov-stage" aria-hidden="true">
        {TEAM.map((member, i) => {
          const who = agentIdentity(member.name)
          return (
            <div className="ov-agent" key={member.name} title={`${who.short}: ${member.does}`} style={{ "--delay": `${-i * 0.45}s` } as CSSProperties}>
              <Mascot shape={who.shape} color={who.colour} mood={eager ? "alert" : "happy"} />
            </div>
          )
        })}
      </div>
      <h2 id="ov-hero-title">Let's research together!</h2>
      {/* The same composer as Research (one component), so the two boxes cannot differ. */}
      <AskBox id="ov-ask-box" textareaRef={box} rows={2} value={text} onChange={setText} onSubmit={(asked) => ask(asked)} onFocusChange={setFocused}
        efforts={catalog?.efforts ?? []} effort={catalog ? effortInEffect(catalog, effort) : effort} onEffort={setEffort} name="overview-effort" />
      <p className="ov-hero-note">Press Send and the team starts: they search, check each other and write it up while you do other things. {limit}</p>
      <div className="ov-row-label">Try asking{note && <small>{note}</small>}</div>
      <div className="ov-starters" role="group" aria-label="Example questions">
        {starters.map((starter) => (
          <button type="button" key={starter.question} aria-label={starter.question} onClick={() => { setText(starter.question); box.current?.focus() }}>
            <b>{starter.topic}</b><span>{starter.question}</span>
          </button>
        ))}
      </div>
      <ul className="sr-only">{TEAM.map((member) => <li key={member.name}>{agentIdentity(member.name).short}: {member.does}</li>)}</ul>
    </section>
  )
}
