import { useEffect } from "react"
import { narration, stepMs, stepsPerTick } from "./story"
import type { GraphModel } from "./types"

const seconds = (ms: number | undefined) => (ms === undefined ? "" : ` · +${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`)
/**
 * Grows the graph in the order things happened. Board runs step through their events (each has its own timestamp);
 * swarm runs step through the ledger log, which has an order but no clock. null means "everything", which also follows a live run.
 */
export function Scrubber({ model, step, onStep, playing, onPlaying }: {
  model: GraphModel; step: number | null; onStep: (s: number | null) => void; playing: boolean; onPlaying: (p: boolean) => void
}) {
  const max = model.maxOrder
  const at = step ?? max
  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => {
      const next = (step ?? 0) + stepsPerTick(max)
      if (next >= max) { onStep(null); onPlaying(false) } else onStep(next)
    }, stepMs(max))
    return () => window.clearInterval(t)
  }, [playing, step, max, onStep, onPlaying])
  /** The last step that belongs to mark i: just before the next one starts. */
  const endOf = (i: number) => (model.marks[i + 1] ? model.marks[i + 1].order - 1 : max)
  const s = at > 0 ? model.steps[at - 1] : undefined
  const mark = [...model.marks].reverse().find((m) => m.order <= at)
  const where = step === null ? `Showing everything (${max} steps).` : `Step ${at} of ${max}${mark ? ` · ${mark.label}` : ""}${seconds(s?.at)}`
  const set = (v: number) => { onPlaying(false); onStep(v >= max ? null : v) }
  if (max === 0) return null
  return (
    <section className="graph-scrub" aria-label="Replay">
      <div className="graph-scrub-row">
        <button type="button" className="btn" onClick={() => set(Math.max(0, at - 1))} disabled={at <= 0} aria-label="Previous step">←</button>
        <input type="range" min={0} max={max} value={at} aria-label="Step through the run" aria-valuetext={`${where} ${narration(model, step)}`} onChange={(e) => set(Number(e.target.value))} />
        <button type="button" className="btn" onClick={() => set(at + 1)} disabled={step === null} aria-label="Next step">→</button>
        <button type="button" className="btn" onClick={() => set(max)} disabled={step === null}>Show all</button>
      </div>
      <div className="graph-scrub-row graph-marks" role="group" aria-label="Show up to the end of a round or turn">
        {model.marks.map((m, i) => <button key={`${m.order}${m.label}`} type="button" className="graph-chip" data-on={mark?.order === m.order && step !== null || undefined} title={`Show everything up to the end of ${m.label}`} onClick={() => set(endOf(i))}>{m.label}</button>)}
      </div>
      <p className="graph-where muted small" role="status">{where}{step !== null && <> {narration(model, step)}</>}</p>
    </section>
  )
}
