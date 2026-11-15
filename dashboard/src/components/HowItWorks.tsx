// "How this works": four plain steps with a picture of the flow. Opened from Settings (and by openHelp()).
// It never says that every statement is checked: the app shows how many were, and what each check found.
import { useEffect, useRef } from "react"
import { PROVENANCE_ABOUT } from "@/lib/provenance"
import { MARK_GLYPH, MARK_WORD, MARKS } from "@/lib/words"

const STEPS = [
  ["1", "You ask", "Type a research question on Research, or press an example."],
  ["2", "It searches and writes", "The app searches the literature and the web, picks sources and writes an answer. For a deeper question a team of AI agents discusses it, each with one job."],
  ["3", "Statements are checked", "A separate checker tests cited statements against their sources. The app shows how many were checked; the writers do not grade themselves."],
  ["4", "You read the answer", `With its sources, and a mark on each checked statement: ${MARKS.map((m) => `${MARK_GLYPH[m]} ${MARK_WORD[m]}`).join(", ")}.`],
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
      <p className="muted small">A badge on every result says how it was made. "Practice": {PROVENANCE_ABOUT.practice.toLowerCase()} "Live research": {PROVENANCE_ABOUT.live.toLowerCase()} Nothing that costs money ever starts without asking you first.</p>
      <form method="dialog"><button type="submit" className="btn btn-primary" autoFocus>Got it</button></form>
    </dialog>
  )
}
