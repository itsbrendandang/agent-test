// Research still being done: one row per running answer, team review and benchmark run. Each row follows its run's
// own events (useLabModel, the same reader as the Agent Lab), so who takes part and the step running now are what the
// engine reported, not a guess. Time is counted from when the work began; money is what the run has recorded so far
// (the list is read again every few seconds while something runs). Each row opens its run in Research, Team review or
// Compare, and in the Agent Log.
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Provenance } from "@/components/Provenance"
import { AgentAvatar } from "@/lab/AgentAvatar"
import type { LabModel } from "@/lab/model"
import { labHash } from "@/lab/runs"
import { useLabModel } from "@/lab/useLabModel"
import { plainDuration } from "@/lib/format"
import { KIND_WORD, seenOf } from "./seen"
import { elapsedOf, usdText, type Work } from "./work"

/** Follows one run's events and hands the model up, so the row and the lab below read one stream. Draws nothing. */
export function Follow({ work, onModel }: { work: Work; onModel: (key: string, model: LabModel) => void }) {
  const { model } = useLabModel(work.kind, work.id)
  const key = `${work.kind}/${work.id}`
  useEffect(() => { onModel(key, model) }, [key, model]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export interface RunningProps {
  works: Work[]
  models: Record<string, LabModel | undefined>
  now: number
  watched?: string
  onWatch: (key: string) => void
  onOpenRun: (work: Work) => void
}

export function Running({ works, models, now, watched, onWatch, onOpenRun }: RunningProps) {
  if (!works.length) return <p className="ov-empty">Nothing is running now. A question you ask above, a team review or a benchmark run shows here while it works.</p>
  return (
    <ul className="ov-running" aria-label="Research in progress">
      {works.map((work) => {
        const key = `${work.kind}/${work.id}`
        const seen = seenOf(work, models[key])
        const elapsed = work.status === "waiting" ? undefined : elapsedOf(work, now)
        return (
          <li key={key} className="ov-run" data-watched={watched === key || undefined}>
            <div className="ov-run-main">
              <div className="ov-run-head">
                <span className="ov-kind" data-kind={work.kind}>{KIND_WORD[work.kind]}</span>
                <Provenance kind={work.provenance} compact />
              </div>
              <p className="ov-run-title">{work.title}</p>
              <p className="ov-run-step" aria-label="Now">{seen.doing ?? (models[key] ? "Starting. The first step has not been reported yet." : "Step not shown here. Open the Agent Log to follow it.")}</p>
              {seen.agents.length > 0 && (
                <ul className="ov-run-agents" aria-label="Agents taking part">
                  {seen.agents.slice(0, 8).map((a) => <li key={a.name} title={a.label}><AgentAvatar name={a.name} size={24} /><span>{a.label}</span></li>)}
                  {seen.agents.length > 8 && <li className="ov-more">+{seen.agents.length - 8} more</li>}
                </ul>
              )}
            </div>
            <dl className="ov-run-nums">
              <div><dt>Time</dt><dd>{elapsed === undefined ? "Waiting" : plainDuration(elapsed)}</dd></div>
              <div><dt>Spent so far</dt><dd>{work.kind === "swarm" ? "Not recorded" : work.provenance === "practice" ? "$0 (practice)" : usdText(work.usd)}{work.maxUsd !== undefined && work.provenance !== "practice" ? <small> of {usdText(work.maxUsd)}</small> : null}</dd></div>
            </dl>
            <div className="ov-run-actions">
              <Button size="sm" variant="outline" onClick={() => onOpenRun(work)}>{work.kind === "answer" ? "Open in Research" : work.kind === "board" ? "Open review" : "Open in Compare"}</Button>
              <Button size="sm" variant="ghost" asChild><a href={labHash(work.kind, work.id)}>Agent Log</a></Button>
              <Button size="sm" variant="ghost" aria-pressed={watched === key} onClick={() => onWatch(key)}>{watched === key ? "In the lab" : "Show in lab"}</Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
