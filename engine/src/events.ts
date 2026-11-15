// Everything the dashboard shows is an event in board/runs/<run>/events.jsonl. The server replays the
// file and tails it over SSE, so a dashboard that connects late, or after a restart, sees the whole run.
// Events carry a stable `key`: a tool that reruns after a crash re-emits the same keys, and readers
// keep the last event per key.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

export type Verdict = "verified" | "unsupported" | "contradicted" | "unchecked"
/** Who ruled on a claim. "first-pass" is the cheap direct-API model (triage.ts). "jev" only appears in runs recorded before Jev was removed; it means the same first stage. */
export type Checker = "first-pass" | "jev" | "openai" | "anthropic" | "claude-code"

export type BoardEvent =
  | { type: "run.started"; runId: string; brief: string; title: string; mock: boolean }
  | { type: "run.resumed"; runId: string }
  | { type: "lead.framed"; text: string }
  | { type: "round.started"; round: number; message: string; final: boolean }
  | { type: "member.replied"; round: number; member: string; mode?: string; text: string; usd: number; summary?: string /** the "In short:" line the reply opened with, when it did */ }
  | { type: "evidence.triaged"; member: string; query: string; kept: number; dropped: number; items: EvidenceItem[]; provider?: SearchProvider }
  | { type: "claim.checked"; round: number; member: string; claim: string; kind: string; verdict: Verdict; checker: Checker; p?: number; note?: string; checkedBy?: string; source?: string; quoteFound?: boolean }
  | { type: "constraint"; reason: "time" | "budget" | "rounds"; detail: string }
  | { type: "memo.written"; path: string; decision: string }
  | { type: "run.finished"; usd: number; minutes: number }
  | { type: "run.failed"; error: string }

/** `provider`: where the source came from: "exa" (a live Exa search) or "fixture" (a practice run's example source). Absent in runs recorded before this field. */
export type SearchProvider = "exa" | "fixture"
export interface EvidenceItem { url: string; title: string; text: string; studyType?: string; relevance?: number; provider?: SearchProvider }

export type Stamped = BoardEvent & { key: string; at: number }

export class EventLog {
  readonly listeners = new Set<(e: Stamped) => void>()
  readonly file: string
  constructor(file: string) { this.file = file; mkdirSync(dirname(file), { recursive: true }) }

  emit(key: string, event: BoardEvent) {
    const stamped = { ...event, key, at: Date.now() } as Stamped
    appendFileSync(this.file, JSON.stringify(stamped) + "\n")
    for (const l of this.listeners) l(stamped)
  }

  static read(file: string): Stamped[] {
    if (!existsSync(file)) return []
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Stamped)
  }
}
