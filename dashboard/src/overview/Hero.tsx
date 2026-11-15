// The welcome at the top of the home page: a few of the agents, eager to start, around a question box. The
// characters here are a greeting and move by themselves (they stand still when the system asks for less motion);
// they are not a picture of work being done. Real work is shown in Agent Lab, where nothing moves without an event.
// Typing a question and pressing "Ask the team" hands the text to Research, where the person chooses the effort
// and sends it: nothing is sent from this page.
import { useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react"
import { agentIdentity } from "@/lab/identity"
import { Mascot } from "@/lab/Mascot"
import { setAsk } from "@/lib/open"
import type { View } from "@/nav"
import { STARTERS } from "@/overview/starters"
import "@/overview/overview.css"

/** Who greets you, with one plain line each: the jobs a question passes through. */
const TEAM: { name: string; does: string; x: number; gather: number; pace: number; roam: number }[] = [
  { name: "scout", does: "finds sources", x: 6, gather: 15, pace: 11, roam: 9 },
  { name: "proposer", does: "plans the work", x: 22, gather: 29, pace: 14, roam: -7 },
  { name: "experimenter", does: "runs the analysis", x: 38, gather: 43, pace: 9, roam: 8 },
  { name: "critic", does: "tries to disprove it", x: 56, gather: 57, pace: 13, roam: -9 },
  { name: "methods-auditor", does: "checks the method", x: 72, gather: 71, pace: 10, roam: 7 },
  { name: "reporter", does: "writes it up", x: 88, gather: 85, pace: 12, roam: -8 },
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
      <h2 id="ov-hero-title">Your research team is ready</h2>
      <p className="ov-hero-sub">Ask a question. The agents search, design the analysis, check each other and write it up, while you do other things.</p>
      <form className="ov-ask" onSubmit={ask}>
        <label className="sr-only" htmlFor="ov-ask-box">Ask a research question</label>
        <textarea ref={box} id="ov-ask-box" rows={2} maxLength={MAX} placeholder="What do you want to find out?" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
        <button type="submit" disabled={!text.trim()}>Ask the team</button>
      </form>
      <div className="ov-starters" role="group" aria-label="Example questions">
        {STARTERS.map((question) => <button type="button" key={question} onClick={() => { setText(question); box.current?.focus() }}>{question}</button>)}
      </div>
      <p className="ov-hero-note">Opens in Research, where you choose how deep to go and press Send.</p>
      <div className="ov-stage" aria-hidden="true">
        {TEAM.map((member, i) => {
          const who = agentIdentity(member.name)
          const style = { "--x": `${member.x}%`, "--gx": `${member.gather}%`, "--pace": `${member.pace}s`, "--roam": `${member.roam}%`, "--delay": `${-i * 1.7}s` } as CSSProperties
          return (
            <div className="ov-agent" key={member.name} style={style}>
              <div className="ov-agent-body"><Mascot shape={who.shape} color={who.colour} mood={eager ? "alert" : "happy"} /></div>
              <span className="ov-agent-name">{who.short}</span>
              <span className="ov-agent-does">{member.does}</span>
            </div>
          )
        })}
      </div>
      <ul className="sr-only">{TEAM.map((member) => <li key={member.name}>{agentIdentity(member.name).short}: {member.does}</li>)}</ul>
    </section>
  )
}
