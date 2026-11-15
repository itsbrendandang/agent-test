// The newest research that ended, newest first, each with how it ended, when, how long and what it cost, and a
// button that opens it. Saved research has everything, with keyword search.
import { Button } from "@/components/ui/button"
import { Provenance } from "@/components/Provenance"
import { plainDuration, plainWhen } from "@/lib/format"
import { KIND_WORD } from "./seen"
import { elapsedOf, usdText, type Work } from "./work"

export function Recent({ works, onOpenRun }: { works: Work[]; onOpenRun: (work: Work) => void }) {
  if (!works.length) return <p className="ov-empty">No research has finished yet. Answers and reviews show here once they end.</p>
  return (
    <ul className="ov-recent-list" aria-label="Recent research">
      {works.map((work) => {
        const took = work.seconds !== undefined ? work.seconds * 1000 : work.finishedAt ? elapsedOf(work, work.finishedAt) : undefined
        return (
          <li key={`${work.kind}/${work.id}`} data-status={work.status}>
            <div className="ov-recent-main">
              <p className="ov-run-title">{work.title}</p>
              <p className="ov-meta">
                <span className="ov-kind" data-kind={work.kind}>{KIND_WORD[work.kind]}</span>
                <Provenance kind={work.provenance} compact />
                <span data-tone={work.status === "failed" ? "bad" : undefined}>{work.status === "finished" ? "Done" : work.status[0].toUpperCase() + work.status.slice(1)}</span>
                <span>{plainWhen(work.startedAt)}</span>
                {took !== undefined && <span>{plainDuration(took)}</span>}
                {work.kind !== "swarm" && <span>{work.provenance === "practice" ? "$0" : usdText(work.usd)}</span>}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onOpenRun(work)} aria-label={`Open ${work.title}`}>Open</Button>
          </li>
        )
      })}
    </ul>
  )
}
