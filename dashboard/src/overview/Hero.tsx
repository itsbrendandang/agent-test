// The welcome at the top of the home page: a few of the agents, eager to start, around a question box. The
// characters here are a greeting and move by themselves (they stand still when the system asks for less motion);
// they are not a picture of work being done. Real work is shown in Agent Lab, where nothing moves without an event.
// Typing a question and pressing "Ask the team" hands the text to Research, where the person chooses the effort
// and sends it: nothing is sent from this page.
import { useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react"
import { ArrowUp } from "lucide-react"
import { agentIdentity } from "@/lab/identity"
import { Mascot } from "@/lab/Mascot"
import { setAsk } from "@/lib/open"
import type { View } from "@/nav"
import { STARTERS } from "@/overview/starters"
import "@/overview/overview.css"

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

export function Hero({ onOpen }: { onOpen: (view: View) => void }) {
  const [text, setText] = useState("")
  const [focused, setFocused] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const eager = focused || text.trim().length > 0
  const ask = (event?: FormEvent) => {
    event?.preventDefault()
    const question = text.trim()
    if (!question) return
    setAsk(question.slice(0, MAX))
    onOpen("Home")
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) ask(event) }
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
      <h2 id="ov-hero-title">Your research team is ready</h2>
      <form className="ov-ask" onSubmit={ask}>
        <label className="sr-only" htmlFor="ov-ask-box">Ask a research question</label>
        <textarea ref={box} id="ov-ask-box" rows={3} maxLength={MAX} placeholder="Ask the team to research a question, check a claim or plan an analysis" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
        <div className="ov-ask-bar">
          <span className="ov-chip">Opens in Research</span>
          <button type="submit" disabled={!text.trim()} aria-label="Ask the team"><ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" /></button>
        </div>
      </form>
      <p className="ov-hero-note">The agents search, check each other and write it up while you do other things. Nothing is sent until you press Send in Research.</p>
      <div className="ov-row-label">Try asking</div>
      <div className="ov-starters" role="group" aria-label="Example questions">
        {STARTERS.map((starter) => (
          <button type="button" key={starter.question} aria-label={starter.question} onClick={() => { setText(starter.question); box.current?.focus() }}>
            <b>{starter.topic}</b><span>{starter.question}</span>
          </button>
        ))}
      </div>
      <ul className="sr-only">{TEAM.map((member) => <li key={member.name}>{agentIdentity(member.name).short}: {member.does}</li>)}</ul>
    </section>
  )
}
