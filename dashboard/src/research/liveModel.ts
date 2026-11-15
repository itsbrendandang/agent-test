// The pure part of the live answer view (LiveChat.tsx): the quiet status lines shown above the text while an answer is
// made and the one line said once it is finished. Everything comes from the answer's
// own events (model.ts foldAnswer). Nothing is timed or invented by the page.
import { markOf } from "@/lib/words"
import { seconds, stepLine, type AnswerState, type Step } from "./model"

/** The answer a live view is open on. `example`: an example answer (read-only: it offers no Stop). */
export interface LiveTarget { id: string; question: string; example?: boolean }

export const isWorking = (s: AnswerState) => s.status === "starting" || s.status === "queued" || s.status === "running"
/** The text is still arriving: the answer is being made and the engine has not sent its finished text yet. */
export const isLive = (s: AnswerState) => isWorking(s) && !s.complete

export interface StatusLine { key: string; text: string; status: Step["status"] }
/**
 * The quiet lines above the text while the answer is made: every step running now, and the last few that ended (how
 * each ended, in the engine's words: "Searching the web: found 6, kept 4."). Nothing once the answer has ended.
 */
export function statusLines(s: AnswerState, recent = 3, maxRunning = 6): StatusLine[] {
  if (!isWorking(s)) return []
  const running = s.steps.filter((x) => x.status === "running").slice(-maxRunning)
  const ended = s.steps.filter((x) => x.status !== "running").slice(-recent)
  return s.steps.filter((x) => running.includes(x) || ended.includes(x)).map((x) => ({ key: x.step, text: stepLine(x), status: x.status }))
}

/** The one line said under a finished answer: what it rests on and how long it took. */
export function doneLine(s: AnswerState): string {
  const parts: string[] = []
  parts.push(s.sources.length === 0 ? "No sources were found" : `${s.sources.length} source${s.sources.length === 1 ? "" : "s"}`)
  if (s.statements.length) {
    const checked = s.statements.filter((x) => markOf(x.verdict) !== "unchecked").length
    parts.push(`${checked} of ${s.statements.length} cited statement${s.statements.length === 1 ? "" : "s"} checked`)
  }
  if (s.finished && s.finished.seconds > 0) parts.push(`took ${seconds(s.finished.seconds * 1000)}`)
  return parts.join(" · ")
}
