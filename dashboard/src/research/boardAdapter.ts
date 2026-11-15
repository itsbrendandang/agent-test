// A team review (the Deep path) in the same shape as a direct answer's activity, from the review's own events.
// Pure. Only what the events record: a round is a step from its start to the next round or the written decision;
// a search is a step with what it found and kept; durations come from the engine's own event times (`at`), and a
// step with no end event has no duration. Nothing is estimated.
import type { BoardEvent } from "@/board/api"
import type { Step } from "./model"

type Of<T extends BoardEvent["type"]> = Extract<BoardEvent, { type: T }>
const PLACE: Record<string, string> = { exa: "Searching the web", europepmc: "Searching PubMed and preprints", fixture: "Loading example sources" }

export interface ReviewActivity { steps: Step[]; working: boolean; seconds?: number; failed?: string }

export function reviewActivity(events: BoardEvent[]): ReviewActivity {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const steps: Step[] = []
  const ended = sorted.find((e): e is Of<"run.finished"> | Of<"run.failed"> => e.type === "run.finished" || e.type === "run.failed")
  const memo = sorted.find((e) => e.type === "memo.written")
  const rounds = sorted.filter((e): e is Of<"round.started"> => e.type === "round.started")
  let searches = 0
  for (const e of sorted) {
    if (e.type === "evidence.triaged") {
      searches++
      const found = e.kept + e.dropped
      steps.push({ step: `search:${searches}`, kind: "search", label: PLACE[e.provider ?? ""] ?? "Looking for sources", provider: e.provider, query: e.query, status: found === 0 ? "empty" : "completed", found, kept: e.kept })
    }
    if (e.type === "round.started") {
      const next = rounds.find((r) => r.round > e.round) ?? memo ?? ended
      const replies = sorted.filter((x) => x.type === "member.replied" && x.round === e.round).length
      const checks = sorted.filter((x) => x.type === "claim.checked" && x.round === e.round).length
      steps.push({
        step: `round:${e.round}`, kind: "review", label: `Round ${e.round}${e.final ? " (final positions)" : ""}: the team discusses`,
        status: next ? (ended?.type === "run.failed" && next === ended ? "failed" : "completed") : "running", ms: next ? Math.max(0, next.at - e.at) : undefined,
        summary: `${replies} repl${replies === 1 ? "y" : "ies"}, ${checks} statement${checks === 1 ? "" : "s"} checked`,
      })
    }
    if (e.type === "memo.written") steps.push({ step: "write", kind: "write", label: "Writing the decision", status: "completed", summary: e.decision })
    if (e.type === "run.failed") steps.push({ step: "failed", kind: "save", label: "The review stopped", status: "failed", error: e.error, consequence: "Nothing more was spent. It can be continued after the problem is fixed." })
  }
  return {
    steps, working: sorted.length > 0 && !ended,
    seconds: ended?.type === "run.finished" ? ended.minutes * 60 : undefined,
    failed: ended?.type === "run.failed" ? ended.error : undefined,
  }
}
