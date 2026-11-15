// What the engine did for one answer, as it reported it: one quiet line, and a list to open ("View activity").
// Every row is a step the engine started; its duration is the engine's own measurement; a failed step stays
// failed and an empty search stays empty. Nothing here is invented, timed or animated by the page.
import { useLayoutEffect, useRef, useState } from "react"
import { Loader } from "@/components/ai-elements/loader"
import { providerPlace, seconds, type Step } from "./model"

const ICON: Record<Step["status"], string> = { running: "", completed: "✓", empty: "○", failed: "✕", cancelled: "■" }
const STATUS_WORD: Record<Step["status"], string> = { running: "running", completed: "done", empty: "found nothing", failed: "failed", cancelled: "stopped" }

/** Keep the reader where they are: after the list changes height, put the pressed control back at the same place on screen. */
function useStay() {
  const pending = useRef<{ el: HTMLElement; top: number } | undefined>(undefined)
  useLayoutEffect(() => {
    const p = pending.current; pending.current = undefined
    if (!p || !p.el.isConnected) return
    const moved = p.el.getBoundingClientRect().top - p.top
    if (!moved) return
    for (let n: HTMLElement | null = p.el.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY
      if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) { n.scrollTop += moved; return }
    }
  })
  return (el: HTMLElement) => { pending.current = { el, top: el.getBoundingClientRect().top } }
}

export function Activity({ steps, working, totalSeconds, defaultOpen = false }: { steps: Step[]; working: boolean; totalSeconds?: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [rows, setRows] = useState<Set<string>>(new Set())
  const [raw, setRaw] = useState<Set<string>>(new Set())
  const stay = useStay()
  if (steps.length === 0) return null
  const flip = (set: Set<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next }
  const failed = steps.filter((x) => x.status === "failed").length
  const allOpen = steps.every((x) => rows.has(x.step))
  return (
    <div className="activity">
      <p className="activity-line">
        <span className="mono">{steps.length} step{steps.length === 1 ? "" : "s"}{!working && totalSeconds !== undefined && ` · ${seconds(totalSeconds * 1000)}`}{failed > 0 && ` · ${failed} failed`}</span>
        <button type="button" className="link-btn" aria-expanded={open} onClick={(e) => { stay(e.currentTarget); setOpen(!open) }}>{open ? "Hide activity" : "View activity"}</button>
        {open && steps.length >= 6 && <button type="button" className="link-btn" onClick={(e) => { stay(e.currentTarget); setRows(allOpen ? new Set() : new Set(steps.map((x) => x.step))) }}>{allOpen ? "Collapse all" : "Expand all"}</button>}
      </p>
      {open && (
        <ol className="activity-rows" aria-label="Activity">
          {steps.map((st) => {
            const isOpen = rows.has(st.step)
            const facts: [string, string][] = [
              ...(st.query ? [["Query", st.query] as [string, string]] : []),
              ...Object.entries(st.input ?? {}).filter(([k]) => k !== "query").map(([k, v]) => [k, String(v)] as [string, string]),
              ...(st.found !== undefined ? [["Found", String(st.found)] as [string, string]] : []),
              ...(st.kept !== undefined ? [["Kept", String(st.kept)] as [string, string]] : []),
              ...(st.total !== undefined ? [["Progress", `${st.done ?? 0} of ${st.total}`] as [string, string]] : []),
              ...(st.summary ? [["Summary", st.summary] as [string, string]] : []),
              ...(st.error ? [["What went wrong", st.error] as [string, string]] : []),
              ...(st.consequence ? [["What it means", st.consequence] as [string, string]] : []),
            ]
            return (
              <li key={st.step} data-status={st.status}>
                <button type="button" className="activity-row" aria-expanded={isOpen} onClick={(e) => { stay(e.currentTarget); setRows(flip(rows, st.step)) }}>
                  <span className="activity-icon" aria-hidden="true">{st.status === "running" ? <Loader size={12} /> : ICON[st.status]}</span>
                  <span className="activity-label">{st.label}<span className="sr-only">: {STATUS_WORD[st.status]}</span></span>
                  {st.status !== "completed" && st.status !== "running" && <span className="activity-status">{STATUS_WORD[st.status]}</span>}
                  {st.provider && <span className="muted small">{providerPlace(st.provider)}</span>}
                  <span className="mono activity-ms">{st.status === "running" ? (st.total ? `${st.done ?? 0}/${st.total}` : "…") : seconds(st.ms)}</span>
                </button>
                {isOpen && (
                  <div className="activity-detail">
                    {facts.length === 0 ? <p className="muted small">The engine reported nothing more about this step.</p>
                      : <dl>{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
                    <button type="button" className="link-btn small" aria-expanded={raw.has(st.step)} onClick={(e) => { stay(e.currentTarget); setRaw(flip(raw, st.step)) }}>Details</button>
                    {raw.has(st.step) && <pre className="activity-raw mono">{JSON.stringify(st, null, 2)}</pre>}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
