// The research answer: one question in, a sourced and reviewed answer out. This file holds the contract the dashboard is
// built against (events and the saved record) and the levels with their caps. docs/research-answer.md describes the flow.
//
// DO NOT rename a field here without telling the dashboard's owner: the Search screen reads these shapes.
import type { BoardConfig } from "../config.ts"
import type { Verdict } from "../events.ts"

export type Effort = "quick" | "standard"
export const EFFORTS: Effort[] = ["quick", "standard"]
export const isEffort = (value: unknown): value is Effort => value === "quick" || value === "standard"

/** Where a source came from. "fixture" is a demo answer's example source. The six database names come from sources/. */
export type Provider = "exa" | "europepmc" | "fixture" | "chembl" | "clinicaltrials" | "openfda" | "opentargets" | "uniprot" | "pubchem"

export interface Level {
  /** Dollars one answer may cost. Checked before every paid step, against that step's worst case. */
  maxUsd: number
  /** Literature (Europe PMC) queries, at most. */
  queries: number
  /** Exa web searches, at most. The first search of every answer is an Exa search. */
  exaSearches: number
  /** Database lookups (sources/), at most. 0 = none. */
  databaseLookups: number
  /** Numbered sources the writer gets, at most. */
  sourcesKept: number
  /** Output tokens of the writer, for the draft and again for the revision. Hidden reasoning tokens count in it. */
  maxOutputTokens: number
  /** The length the writer is asked for, in words. */
  words: number
  /** Hypotheses one answer may test, at most (0 = the level tests none). Each needs one web search and one literature query, so fewer are tested when those run out. */
  hypotheses: number
  /** Method specialists one answer may add, at most (0 = none). Each drafts one short section from the sources, which is checked and reviewed like the rest. */
  specialists: number
  /** The model tier a specialist runs on (board/config.yaml `models`): "cheap" at the quick level, "strong" at the standard level, unless the config says otherwise. */
  specialistTier: "cheap" | "strong"
}

export interface ResearchLimits {
  /** Wall clock for one answer, in seconds. */
  maxSeconds: number
  maxQuestionChars: number
  /** Answers in progress at once, over all callers. */
  maxInProgress: number
  /** Questions one Origin may ask a minute. */
  perOriginPerMinute: number
  levels: Record<Effort, Level>
}

// DEFAULTS. Justified from the prices in board/config.yaml (docs/research-answer.md has the arithmetic):
// a quick answer is expected to cost about $0.06 and cannot pass $0.15; a standard one about $0.12 and cannot pass $0.60.
export const DEFAULTS: ResearchLimits = {
  maxSeconds: 120,
  maxQuestionChars: 2_000,
  maxInProgress: 3,
  perOriginPerMinute: 6,
  levels: {
    quick: { maxUsd: 0.15, queries: 2, exaSearches: 1, databaseLookups: 0, sourcesKept: 6, maxOutputTokens: 2_000, words: 220, hypotheses: 0, specialists: 1, specialistTier: "cheap" },
    standard: { maxUsd: 0.6, queries: 3, exaSearches: 3, databaseLookups: 2, sourcesKept: 12, maxOutputTokens: 3_000, words: 380, hypotheses: 3, specialists: 2, specialistTier: "strong" },
  },
}

// What board/config.yaml may hold under `research:`. Every key is optional; a value that is not a sane number is ignored.
export interface ResearchYaml {
  time_limit_seconds?: number; max_question_chars?: number; max_in_progress?: number; per_origin_per_minute?: number
  quick?: LevelYaml; standard?: LevelYaml
}
export interface LevelYaml { max_usd?: number; queries?: number; exa_searches?: number; database_lookups?: number; sources_kept?: number; max_output_tokens?: number; words?: number; hypotheses?: number; specialists?: number; specialist_tier?: string }

const num = (value: unknown, fallback: number, min: number, max: number, whole = true): number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value)) ? value : fallback

/**
 * The limits in force: the defaults, changed by the `research:` block of board/config.yaml. Hard bounds hold whatever
 * the file says: quick makes exactly one Exa search and tests no hypotheses, standard makes at most 3 searches and tests
 * at most 4 hypotheses, and no level is given more than $5 or 20 sources.
 */
export function limitsOf(config: Pick<BoardConfig, "research">): ResearchLimits {
  const y = (config.research ?? {}) as ResearchYaml
  const level = (effort: Effort): Level => {
    const d = DEFAULTS.levels[effort], l = (y[effort] ?? {}) as LevelYaml
    return {
      maxUsd: num(l.max_usd, d.maxUsd, 0.01, 5, false),
      queries: num(l.queries, d.queries, 1, 3),
      exaSearches: effort === "quick" ? 1 : num(l.exa_searches, d.exaSearches, 1, 3),
      databaseLookups: effort === "quick" ? 0 : num(l.database_lookups, d.databaseLookups, 0, 3),
      sourcesKept: num(l.sources_kept, d.sourcesKept, 1, 20),
      maxOutputTokens: num(l.max_output_tokens, d.maxOutputTokens, 300, 8_000),
      words: num(l.words, d.words, 60, 1_000),
      hypotheses: effort === "quick" ? 0 : num(l.hypotheses, d.hypotheses, 0, 4),
      specialists: num(l.specialists, d.specialists, 0, 3),
      specialistTier: l.specialist_tier === "cheap" || l.specialist_tier === "strong" ? l.specialist_tier : d.specialistTier,
    }
  }
  return {
    maxSeconds: num(y.time_limit_seconds, DEFAULTS.maxSeconds, 1, 600, false),
    maxQuestionChars: num(y.max_question_chars, DEFAULTS.maxQuestionChars, 20, 8_000),
    maxInProgress: num(y.max_in_progress, DEFAULTS.maxInProgress, 1, 10),
    perOriginPerMinute: num(y.per_origin_per_minute, DEFAULTS.perOriginPerMinute, 1, 60),
    levels: { quick: level("quick"), standard: level("standard") },
  }
}

// ── The saved record and its parts ───────────────────────────────────────────────────────────────

export interface Source {
  n: number
  url: string
  title: string
  provider: Provider
  /** A short plain label: "preprint", "review", "clinical", "in vitro", "example source"; comma-joined when two apply. */
  note?: string
  /** The year of publication, when the search gave one (Europe PMC does; a web page usually has none). */
  published?: string
  /** The hypotheses whose searches found this source ("h1", "h2"). Absent when the answer tests no hypotheses. */
  hypotheses?: string[]
  /** True for a source of an earlier answer in the thread that this answer lists again. */
  earlier?: boolean
  /** Set once the final text exists: does it cite this source? */
  cited?: boolean
}
/** A source as the record keeps it: with the text every check was made against (an abstract or excerpts, never a full paper). */
export interface StoredSource extends Source { text: string; studyType?: string; relevance?: number }

export interface SearchLine { provider: Provider; query: string; ran: boolean; found: number; kept: number; reason?: string; /** The hypothesis the search was for. */ hypothesis?: string }

/** What a step is. "prepare" is the one measured preparation phase (planning the queries). */
export type StepKind = "prepare" | "hypothesize" | "search" | "evaluate" | "fetch" | "write" | "check" | "review" | "revise" | "save"
/** "empty": a search that ran and found nothing. Not a failure and not a success. */
export type StepStatus = "completed" | "empty" | "failed" | "cancelled"
/** A safe summary of what a step was given, for a details view. Never a key, a header, a token, a path or a prompt. */
export type StepInput = Record<string, string | number | boolean>
/** A method specialist of one answer (specialists.ts). `agent` is who the step and the lab show: "specialist:<name>". */
export interface AnswerSpecialist { name: string; title: string; agent: string; why: string; methods: { name: string; title: string }[] }

export interface StepStart {
  step: string; kind: StepKind; label: string; provider?: Provider; query?: string; input?: StepInput
  /** The hypothesis this step is for (its searches, their screening, the draft of its section). */
  hypothesis?: string
  /**
   * Who does the step: "planner", "searcher", "writer", "checker", "critic", or "investigator-1", "investigator-2", ...
   * (one investigator works on one hypothesis, at the same time as the others), or "specialist:<name>" (a method specialist).
   */
  agent?: string
}
export interface StepEnd { step: string; status: StepStatus; ms: number; found?: number; kept?: number; summary?: string; error?: string; consequence?: string }
/** A step as the record keeps it: "running" until its end is known. */
export interface StepRecord extends StepStart { status: StepStatus | "running"; ms?: number; found?: number; kept?: number; summary?: string; error?: string; consequence?: string }

export interface Selection {
  /** The rule that was applied, in plain words, written by code. */
  criteria: string
  selected: { n: number; why: string; limitation?: string }[]
  /** Each address once, also when two searches found it. */
  notSelected: { title: string; url: string; provider: Provider; reason: string }[]
  /** `results`: what the searches returned, summed. `unique`: the different addresses among them. `selected`: the numbered sources. */
  counts: { results: number; unique: number; selected: number }
}

export type RecommendationLabel = "Recommended next step" | "Alternative" | "Needs verification"
export interface Recommendation {
  label: RecommendationLabel
  text: string
  why: string
  /** Source numbers it rests on. Never empty: code drops a recommendation with no basis. */
  basis: number[]
  /** What taking the step would do. */
  does: string
}

/** Which way a checked statement points for the hypothesis it is filed under, as a model of another vendor than the writer judged it. */
export type Stance = "supports" | "contradicts" | "neither" | "unchecked"

/**
 * One hypothesis a Standard answer tests, set BEFORE any search, and (once the checks are done) its mark. "Tested"
 * means checked against published sources. It is not an experiment.
 */
export interface Hypothesis {
  /** "h1", "h2", ... in the order they were set. */
  id: string
  /** One checkable sentence. */
  text: string
  /** What a source would report if it holds, and if it does not: written before anything was searched. */
  supportIf: string
  contradictIf: string
  /** "user": the person stated it; "planner": the planner proposed it. */
  origin: "user" | "planner"
  /**
   * The mark, given by code (pipeline.ts markOf) from the checked statements: "verified" = Supported, "contradicted" =
   * Contradicted, "unsupported" = Insufficient evidence, "unchecked" = Not checked.
   */
  verdict?: Verdict
  /** Source numbers of the checked statements that count for it, and against it. */
  for?: number[]
  against?: number[]
  /** Indexes of those statements in the final text. */
  forStatements?: number[]
  againstStatements?: number[]
  /** True when checked statements stand on both sides: shown as Insufficient evidence, "the sources disagree". */
  mixed?: boolean
  note?: string
  /** The investigator that works on it: "investigator-1" for h1, and so on. */
  agent?: string
  /**
   * What the mark rests on. Today always published sources. RESERVED, not produced yet: {kind: "swarm", run} for a
   * hypothesis tested on data by a swarm run (the claims engine); `run` is that run's id.
   */
  testedBy?: { kind: "sources" } | { kind: "swarm"; run: string }
}

export interface Artifact { id: string; name: string; type: string; bytes: number; at: number }

export interface Statement {
  stage: "draft" | "final"
  /** Position among the cited sentences of that stage's text, from 0. */
  index: number
  text: string
  sources: number[]
  /** Set by code only (triage.ts route). "verified" is the only verdict shown as "holds up". */
  verdict: Verdict
  quote?: string
  quoteFound: boolean
  /** The source the quote is from. */
  quoteSource?: number
  /** The model that checked, "vendor/model", "scripted" in a demo answer. */
  checker: string
  /** Why it is not verified, in plain words. */
  note?: string
  /** Final stage only: true when this sentence stood unchanged in the draft and its verdict was copied. */
  carried?: boolean
  /** The hypothesis whose section the sentence is in, and the line it is filed under. */
  hypothesis?: string
  side?: "for" | "against"
  /** Final statements that passed their check and are filed under a hypothesis: which way a second model says they point. */
  stance?: Stance
  /** In an answer that tests hypotheses: who wrote the sentence, "investigator-N" (its section's investigator) or "writer". */
  agent?: string
}

export type Severity = "blocking" | "major" | "minor"
export interface ReviewNote {
  index: number
  reviewer: "critic"
  severity: Severity
  text: string
  /** The draft statement the note is about, or null for the answer as a whole. */
  statement: number | null
  resolved?: boolean
  how?: string
  /** Who says so: the reviewer itself after reading the revision, code (the sentence is gone or changed), or only the writer's own report. */
  by?: "reviewer" | "code" | "writer"
}

export interface Counts { sources: number; statements: number; verified: number; contradicted: number; unsupported: number; unchecked: number }
export type Stopped = "cap" | "time" | "paid_off"
export interface ModelNames { planner: string; writer: string; checker: string; critic: string }
export type Status = "queued" | "running" | "done" | "failed" | "cancelled"

export interface ResearchRecord {
  id: string
  thread: string
  kind: "answer"
  question: string
  effort: Effort
  mode: "real" | "demo"
  status: Status
  /** When the question was asked. For a queued answer the work starts later; `workStartedAt` says when. */
  startedAt: number
  workStartedAt?: number
  /** Milliseconds the answer has been worked on. Time while the engine was down is not in it; the time limit counts this. */
  workedMs?: number
  finishedAt?: number
  /** A queued answer: the answer it waits for. */
  after?: string
  caps: { maxUsd: number; maxSeconds: number }
  models: ModelNames
  /** The one sentence that says what will be done. */
  opening?: string
  /** The hypotheses this answer tests (Standard level; empty when none were needed), each with its mark once checked. */
  hypotheses?: Hypothesis[]
  /** Why no hypotheses were set, or which were set aside because the level's limits do not fit them. */
  hypothesesNote?: string
  /** The method specialists added to this answer because their method notes fit the question (empty or absent: none fit, or the level adds none). */
  specialists?: AnswerSpecialist[]
  steps: StepRecord[]
  searches: SearchLine[]
  sources: StoredSource[]
  selection?: Selection
  /** The first draft, after code removed markers that name no source. */
  draft?: string
  /** The final text (the revision when one ran, else the draft) and its first paragraph without markers. */
  answer?: { markdown: string; direct: string }
  /** The cited sentences of the final text, each with the verdict code gave it. */
  statements: Statement[]
  review: { checker: string; critic: string; revised: boolean; notes: ReviewNote[] }
  recommendations: Recommendation[]
  /**
   * "What is missing": plain sentences built by code from what did not run, what found nothing and what did not pass
   * its check. It is part of the answer whenever it is not empty, whatever the writer wrote.
   */
  missing?: string[]
  /** Dollars spent so far: models, screening, checks and Exa. Written after every paid step. */
  usd: number
  seconds?: number
  counts?: Counts
  /** Set when the answer ended early with what it had, and `note` says so in plain words. */
  stopped?: Stopped
  note?: string
  error?: string
}

// ── Events (events.jsonl, and the SSE stream) ────────────────────────────────────────────────────

export type ResearchEvent =
  | { type: "research.queued"; after: string }
  | { type: "research.resumed"; afterSeq: number }
  | { type: "research.started"; id: string; thread: string; question: string; effort: Effort; mode: "real" | "demo"; caps: { maxUsd: number; maxSeconds: number }; models: ModelNames }
  | { type: "opening"; text: string }
  | { type: "hypotheses"; items: Pick<Hypothesis, "id" | "text" | "supportIf" | "contradictIf" | "origin" | "agent">[]; needed: boolean; reason?: string; cut?: { text: string; reason: string }[] }
  | ({ type: "hypothesis.checked" } & Required<Pick<Hypothesis, "id" | "verdict" | "for" | "against" | "forStatements" | "againstStatements">> & Pick<Hypothesis, "mixed" | "note" | "agent" | "testedBy">)
  | { type: "specialists"; items: AnswerSpecialist[] }
  | ({ type: "step.started" } & StepStart)
  | { type: "step.progress"; step: string; done: number; total?: number; note?: string }
  | ({ type: "step.finished" } & StepEnd)
  | { type: "sources"; items: Source[] }
  | ({ type: "selection" } & Selection)
  | { type: "answer.delta"; text: string }
  | { type: "answer.written"; markdown: string }
  | { type: "review.started"; reviewer: "checker" | "critic"; model: string; step: string }
  | ({ type: "statement.checked" } & Statement)
  | ({ type: "review.note" } & Omit<ReviewNote, "resolved" | "how" | "by">)
  | { type: "review.resolved"; notes: { index: number; resolved: boolean; how?: string; by?: ReviewNote["by"] }[] }
  | { type: "answer.revised"; markdown: string; notes: { index: number; resolved: boolean; how?: string; by?: ReviewNote["by"] }[] }
  | { type: "sources.cited"; n: number[] }
  | { type: "recommendations"; items: Recommendation[] }
  | { type: "missing"; items: string[] }
  | { type: "artifact.created"; artifact: Artifact } // nested: the envelope already has `type` and `at`
  | { type: "research.finished"; usd: number; seconds: number; counts: Counts; searches: Partial<Record<Provider, number>>; review: { checker: string; critic: string; revised: boolean; notes: { raised: number; resolved: number } }; stopped?: Stopped; note?: string }
  | { type: "research.failed"; error: string; spentUsd: number }
  | { type: "research.cancelled"; spentUsd: number; seconds: number }

/** Every event as stored and streamed: `seq` from 1, strictly increasing in one answer; `run` is the answer id. */
export type Stamped = ResearchEvent & { seq: number; at: number; run: string; key: string }
