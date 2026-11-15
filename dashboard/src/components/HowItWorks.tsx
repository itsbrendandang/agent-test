// "How this works": the same four plain steps on every view, with a picture of the flow. Opened from the status line.
import { useEffect, useRef } from "react"
import { PRACTICE } from "@/lib/words"

const STEPS = [
  ["1", "You ask", "Type a research question on Search, or press an example."],
  ["2", "A team discusses", "Several AI agents work on it, each with one job. One of them only tries to prove the others wrong."],
  ["3", "Every statement is checked", "A separate checker tests each thing they say against a source. The team does not grade itself."],
  ["4", "You get an answer", "You see what the team recommends, and for every statement: ✓ holds up, ✕ proven wrong, or ? not enough evidence."],
] as const

export function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close() }, [open])
  return (
    <dialog ref={ref} className="how" aria-labelledby="how-title" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose() }}>
      <h2 id="how-title">How this works</h2>
      <ol className="how-flow" aria-label="The four steps">
        {STEPS.map(([n, title, text]) => (
          <li key={n}><span className="how-n" aria-hidden="true">{n}</span><b>{title}</b><span>{text}</span></li>
        ))}
      </ol>
      <p className="muted small">A label on every result says whether it is real. "{PRACTICE}" means no AI model was used: the text is a fixed example, so you can see how the app works for free. Nothing that costs money ever starts without asking you first.</p>
      <form method="dialog"><button type="submit" className="btn btn-primary" autoFocus>Got it</button></form>
    </dialog>
  )
}
