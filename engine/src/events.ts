import type { SpecialistRoom } from "./specialists.ts"
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
  | { type: "run.roster"; members: RosterEntry[] /** who takes part in this run: the lead first, then the members in speaking order (key "roster") */ }
  | { type: "lead.framed"; text: string }
  | { type: "round.started"; round: number; message: string; final: boolean }
  | { type: "member.replied"; round: number; member: string; mode?: string; text: string; usd: number; summary?: string /** the "In short:" line the reply opened with, when it did */; usage?: MemberUsage /** the member's own model use so far in this run, read when the reply was recorded; absent in runs recorded before this field */ }
  | { type: "evidence.triaged"; member: string; query: string; kept: number; dropped: number; items: EvidenceItem[]; provider?: SearchProvider }
  | { type: "claim.checked"; round: number; member: string; claim: string; kind: string; verdict: Verdict; checker: Checker; p?: number; note?: string; checkedBy?: string; source?: string; quoteFound?: boolean }
  | { type: "constraint"; reason: "time" | "budget" | "rounds"; detail: string }
  | { type: "memo.written"; path: string; decision: string }
  | { type: "run.finished"; usd: number; minutes: number; members?: Record<string, MemberUsage> /** each agent's own model use over the run, the lead included; absent in runs recorded before this field */ }
  | { type: "run.failed"; error: string }

/**
 * `provider`: the search that found a source. "exa": a live Exa web search. "europepmc": a free literature search
 * (literature.ts). "openalex", "semanticscholar", "arxiv": a paper the research answer's literature search found
 * there (scholarly.ts). "protocols": a lab protocol the research answer's protocol search found (protocols.ts). "chembl", "clinicaltrials", "openfda", "opentargets", "uniprot", "pubchem": a record from that
 * public database (sources/). "fixture": a practice run's example source, not a search. Absent in runs recorded before
 * this field.
 */
export type SearchProvider = "exa" | "europepmc" | "openalex" | "semanticscholar" | "arxiv" | "crossref" | "biorxiv" | "protocols" | "chembl" | "clinicaltrials" | "openfda" | "opentargets" | "uniprot" | "pubchem" | "fixture"
/** The searches of a board review. The research answer's paper indexes ("openalex", "semanticscholar", "arxiv") and its protocol search ("protocols") are not among them. */
export const SEARCH_PROVIDERS: readonly SearchProvider[] = ["exa", "europepmc", "chembl", "clinicaltrials", "openfda", "opentargets", "uniprot", "pubchem", "fixture"]
/**
 * One source in the evidence pool. `provider` and `query` say which search found it and with which query; they are set
 * when the source enters the pool and stay on it in every saved record (run.json `evidence`, the `evidence.triaged`
 * event), so a reader can show "found through Exa" per source. A source found again by a later search keeps the
 * search that found it first. `query` is absent in runs recorded before the field. `image`: the page's own picture, as
 * the search returned it (Exa gives one for some pages, at no extra cost); absent when there is none.
 */
export interface EvidenceItem { url: string; title: string; text: string; studyType?: string; relevance?: number; provider?: SearchProvider; query?: string; image?: string }

/**
 * One agent's model use in a run, from its own conversation's usage record (pi-durable `pi.usage`): tokens as the model
 * reported them and the dollars they cost. A practice run's scripted model is free, so `usd` is 0 there. The checkers and
 * searches are not in it: they are counted in the run's total only.
 */
export interface MemberUsage { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; usd: number }

/** One member of a run. `source`: "board" (a file in board/agents) or "specialist" (a method specialist a plan added for this run: `why` it was chosen and the `methods` whose notes it reads). */
export interface RosterEntry { name: string; title: string; role: "lead" | "member"; source: "board" | "specialist"; room?: SpecialistRoom; why?: string; methods?: { name: string; title: string }[] }

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
