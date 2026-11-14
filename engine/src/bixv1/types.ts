// Shapes served under /api/bixv1/* (see routes.ts). They are built from the files the BixBench v1 adapter
// writes (glhf/bixbench_v1: run.json, grade.json, outputs/answers.json, outputs/glhf/ledger.json, report.json).
// Every field read from disk is optional here: a missing one becomes null or is left out, an extra one is ignored.
//
// Times are milliseconds since 1970 (the adapter writes seconds; store.ts converts), as in glhf/types.ts.

/** How one answer was graded. `not_graded`: no grade on disk, or the judge call failed ("judge_error"). */
export type BixResult = "correct" | "incorrect" | "refused" | "not_graded"

/**
 * Who decided the result.
 *   exact_match  code: equal after normalising ("exact"), equal as numbers ("numeric"), the official substring
 *                rule ("partial") or the multiple-choice letter ("letter")
 *   range        code: the number lies in the ideal range
 *   model        an LLM judge; `model` names it ("llm", "llm_range", "llm_binary")
 *   rule         code, without looking at the ideal: an empty answer is a refusal ("empty")
 *   none         not graded: no grade.json, or the judge failed ("judge_error")
 */
export interface BixGrader {
  kind: "exact_match" | "range" | "model" | "rule" | "none"
  /** The adapter's own word for it (grading.py, Grade.method), or null when there is no grade. */
  method: string | null
  /** The judge model, when kind is "model" or the judge failed. */
  model?: string
}

/**
 * How a swarm's token budget relates to the single agent's (settings.max_tokens) for the same capsule run.
 *   equal     the swarm's total is the single agent's budget
 *   extended  the swarm's total is larger (2.25 times, unless the run set another multiplier)
 *   legacy    run.json has no budget fields: written before budget modes existed. Counted as the pilot's
 *             allocation (analyst 42%, critic 42%, reconciler 16%) inside the single agent's budget.
 *   mixed     a folder whose capsule runs did not all use one mode
 *   unknown   a mode this reader does not know
 */
export type BixBudgetMode = "equal" | "extended" | "legacy" | "mixed" | "unknown"

export interface BixBudget {
  /** null for the single agent. */
  mode: BixBudgetMode | null
  /** The mode in plain words. null for the single agent. */
  label: string | null
  /** Sum over the capsule runs of what the single agent gets (max_tokens). null when a run did not record it. */
  singleBudgetTokens: number | null
  /** Sum of what this solver could really spend. Equal to singleBudgetTokens except for an extended swarm. */
  totalBudgetTokens: number | null
  /** totalBudgetTokens / singleBudgetTokens: 1, or 2.25 for an extended swarm. */
  ratio: number | null
  /** The adapter's own word, "same budget" or "more budget". null when not recorded (single agent, legacy). */
  reading: string | null
}

/**
 * Counts for judging the swarm's design, over the swarm's questions in a run folder. "Correct" and "wrong" are
 * the graded result of the reported answer; "wrong" includes refusals; not-graded answers are counted apart.
 */
export interface BixDesign {
  questions: number
  /** Questions with both an analyst and a critic answer. compared = agreed + disagreed. */
  compared: number
  agreed: number
  /**
   * Agreed, and the agreed answer was the one graded (the reconciler did not replace it):
   * agreed = agreedCorrect + agreedWrong + agreedNotGraded + (agreed answers the reconciler replaced).
   */
  agreedCorrect: number
  agreedWrong: number
  agreedNotGraded: number
  /** Agreed, and both sides used the same method, so the agreement is not an independent check. */
  agreedSameMethod: number
  agreedSameMethodCorrect: number
  agreedSameMethodWrong: number
  /** Agreed answers for which "same method" was recorded at all. 0 for legacy runs: then agreedSameMethod says nothing. */
  sameMethodKnown: number
  disagreed: number
  /** Questions with one derivation only, or none. */
  oneDerivation: number
  /** Questions where a side's answer was a forced estimate at its budget limit. */
  forced: number
  /** Questions the reconciler derived an answer for. */
  reconcilerRan: number
  /** Questions where the reconciler's work changed the reported answer, and how the changed answer was graded. */
  reconcilerChanged: number
  reconcilerChangedToCorrect: number
  reconcilerChangedToWrong: number
}

/** One solver's answer to one question. */
export interface BixAnswer {
  solver: string
  /** What was graded: outputs/answers.json, else the grade's `predicted`. null when nothing was submitted. */
  answer: string | null
  result: BixResult
  grader: BixGrader
  /** How far code checked the answer before grading: replicated, reconciled, disputed, unchecked, missing. */
  status: string
  /** The capsule run this answer came from, relative to the run folder: "bix-46_d37acffb/glhf". */
  runDir: string
  /**
   * Tokens and seconds of that capsule run, shared by its `runQuestions` questions. The adapter does not record
   * cost per question; do not add these up over questions.
   */
  runTokens: number | null
  runSeconds: number | null
  runQuestions: number
  // The swarm only: from its per-question record (questions.json), else from its ledger (older runs).
  // All of these are left out for the single agent.
  /** Left out when that role gave no answer. */
  analystAnswer?: string
  criticAnswer?: string
  /** Did code find the two answers to agree? null: one is missing. An "unclear" comparison is false. */
  agreed?: boolean | null
  /** The ledger's own word: agree, differ, unclear. null: one answer is missing. */
  comparison?: string | null
  /** Did both sides use the same method (by code or by the reconciler's reading)? null: not known (always, for legacy runs). */
  sameMethod?: boolean | null
  sameMethodByCode?: boolean
  sameMethodByReconciler?: boolean
  /** Token overlap of the two one-line method statements, 0 to 1. */
  methodSimilarity?: number
  /** Each side's own one-line statement of its method. */
  analystMethod?: string
  criticMethod?: string
  /** Was that side's answer a forced estimate made at its budget limit? `forced`: either side. */
  analystForced?: boolean
  criticForced?: boolean
  forced?: boolean
  /** The reconciler's own answer. Left out when it did not look at this question. */
  reconcilerAnswer?: string
  /** rederived, confirmed, overturned or differs_kept. */
  reconcilerAction?: string
  reconcilerCause?: string
  /** Legacy runs only: which derivation the reconciler kept (A = analyst, B = critic, both, neither). */
  reconcilerKeep?: string
  /** Did the reconciler's work change the answer that was reported (from what the analyst, else the critic, gave)? */
  reconcilerChanged?: boolean
  /**
   * Tokens per phase of the capsule run this answer came from: { analyst, critic, reconciler }. Like runTokens it
   * is shared by the run's questions, not this question's own. {} when the run did not record it.
   */
  runPhaseTokens?: Record<string, number>
  /** Only with ?ideal=1 (see routes.ts): the judge's raw reply and the grader's note can quote the ideal. */
  judgeResponse?: string
  graderNote?: string
}

export interface BixQuestion {
  questionId: string
  capsuleId: string
  /** The question as the solver saw it (from the ledger). null when no ledger was written. */
  question: string | null
  /** str_verifier, range_verifier or llm_verifier. null when no solver's answer was graded. */
  evalMode: string | null
  /** open, mcq or mcq-refusal. */
  answerMode: string | null
  /** Keyed by solver: "single", "glhf". */
  answers: Record<string, BixAnswer>
  /** The ground-truth answer. Present only with ?ideal=1 on a finished run. */
  ideal?: string
}

/** One solver's totals in a run folder. */
export interface BixSolverSummary {
  solver: string
  models: string[]
  /** Swarm roles that ran on another model, e.g. { critic: "openai/gpt-5.5" }. */
  roleModels: Record<string, string>
  /** Questions asked, over all capsule runs of this solver. */
  questions: number
  correct: number
  incorrect: number
  refused: number
  notGraded: number
  /** Questions of capsule runs that have not finished. They are in no other count and not in the denominator. */
  pending: number
  /** Questions of capsule runs that say "running" but have been silent too long (crashed). Counted like pending. */
  stalled: number
  /**
   * correct / denominator, null when the denominator is 0. The denominator is every question of a finished
   * capsule run: refusals, failed runs, missing answers and judge errors all count as incorrect, as in the
   * adapter's report.
   */
  accuracy: number | null
  denominator: number
  /** Wilson 95% score interval for `accuracy`. Too narrow when capsules have several questions each. */
  wilson95: [number, number] | null
  /** Swarm answers the two derivations disagreed on and nobody resolved ("disputed"): reported but unsure. */
  unsure: number
  /** Counts per answer status: { replicated: 6, unchecked: 2 }. */
  statuses: Record<string, number>
  /** Inspect's total_tokens over the capsule runs; includes cached input. Judge tokens are not in it. */
  tokens: number
  seconds: number
  /** Estimated from report.json's assumed list prices and the per-kind token usage. null when either is missing. */
  costUsd: number | null
  capsuleRuns: { done: number; failed: number; running: number; stalled: number }
  /** What this solver could spend, against what the single agent gets. */
  budget: BixBudget
  /** Tokens per swarm phase summed over the capsule runs: { analyst, critic, reconciler }. {} when not recorded. */
  tokensByPhase: Record<string, number>
  /** The swarm only, and only when a ledger or per-question record could be read. */
  design?: BixDesign
  /** The single agent's budget (max_tokens) per capsule run when all are the same, else null; and the sum. For what a swarm could really spend see `budget`. */
  maxTokens: number | null
  maxTokensTotal: number | null
}

export interface BixRun {
  id: string
  /** "BixBench v1.5 (futurehouse/BixBench)" and the dataset revision the runs recorded. */
  dataset: string | null
  datasetRevision: string | null
  /** The solvers' model when there is one, else the models joined with ", ". */
  model: string | null
  models: string[]
  solvers: string[]
  /** The profile the numbers below were graded with, and the ones grade.json holds. */
  gradingProfile: string | null
  gradingProfiles: string[]
  judgeModels: string[]
  answerModes: string[]
  /**
   * "running" while a capsule run is at work. "stalled": none is at work, but at least one says "running" and has
   * written nothing for longer than its time limit plus a margin (it crashed); the others are counted as usual.
   */
  state: "running" | "stalled" | "done" | "empty"
  startedAt: number | null
  finishedAt: number | null
  capsules: string[]
  /** Distinct questions over all solvers. */
  questions: number
  /** One entry per solver, sorted by name. */
  bySolver: BixSolverSummary[]
  tokens: number
  /** Judge tokens from budget.json, when it is there. */
  judgeTokens: number | null
  costUsd: number | null
  /** True when a scripted mock model answered: plumbing only, not a result. */
  scripted: boolean
  /** Why the folder could not be read in full. The rest of the record holds whatever could be read. */
  error?: string
}

export interface BixRunDetail {
  run: BixRun
  questions: BixQuestion[]
  /** True when the response carries ideal answers (?ideal=1). */
  idealsRevealed: boolean
  /** Why ideal answers were asked for and are missing. */
  idealNote?: string
}

/** One side of a scoreboard row: one solver's capsule runs in one run folder. */
export interface BixScoreCell {
  run: string
  solver: string
  correct: number
  n: number
  accuracy: number | null
  wilson95: [number, number] | null
  refused: number
  notGraded: number
  failedRuns: number
  tokens: number
  seconds: number
  costUsd: number | null
  startedAt: number | null
  /** Settings outside the pairing key that the other side might not share, in plain words. */
  extras: string[]
  /** What this side could spend in all, summed over its capsule runs. */
  budgetTokens: number | null
  /** null for the single agent. */
  budgetMode: BixBudgetMode | null
}

export interface BixPaired {
  /** Questions both sides answered (always all of them: the question sets are part of the pairing key). */
  n: number
  capsules: number
  bothCorrect: number
  onlySingle: number
  onlySwarm: number
  neither: number
  accuracySingle: number
  accuracySwarm: number
  /** accuracySwarm - accuracySingle = (onlySwarm - onlySingle) / n. */
  difference: number
  /** 95% interval for `difference`. */
  interval95: [number, number]
  intervalMethod: string
  /** Two-sided exact p-value. null when no question was answered differently: there is nothing to test. */
  pValue: number | null
  pValueMethod: string
  /** The adapter's capsule-level bootstrap interval, copied from report.json when it describes this same pair. */
  capsuleBootstrap95?: [number, number]
}

export interface BixScoreRow {
  /**
   * What kind of row this is. Read it before any number in the row.
   *   "same budget"  both sides could spend the same total: a like-for-like comparison
   *   "more budget"  the swarm could spend more than the single agent (extended mode): NOT like for like
   *   "none"         one side only, nothing to compare
   */
  comparison: "same budget" | "more budget" | "none"
  /** True only for "same budget". The dashboard must not show a row with false as a fair comparison. */
  likeForLike: boolean
  /** A short label for the row: the comparison kind and the swarm's budget mode in plain words. */
  budgetLabel: string
  /**
   * The swarm's total budget divided by the single agent's, for the two sides in this row: 1 for "same budget",
   * 2.25 for an extended swarm against its own baseline. null when there is one side only or a budget is unknown.
   */
  budgetRatio: number | null
  /** Tokens the swarm used divided by tokens the single agent used. null when there is one side only. */
  tokensUsedRatio: number | null
  /** The swarm side's budget mode. null when the row has no swarm. */
  swarmBudgetMode: BixBudgetMode | null
  dataset: string | null
  datasetRevision: string | null
  model: string
  gradingProfile: string
  answerMode: string | null
  capsules: string[]
  questions: number
  /**
   * The single agent's budget in this row: per capsule run when all are equal, else null; and the total. In a
   * row with a swarm only, the swarm's total budget. Each side's own total is in its cell (`budgetTokens`).
   */
  maxTokens: number | null
  maxTokensTotal: number | null
  timeLimit: number | null
  single?: BixScoreCell
  swarm?: BixScoreCell
  /** Present only when both sides exist. In a "more budget" row it is still computed, and still not like for like. */
  paired?: BixPaired
  /** True when the data cannot support any conclusion, whatever the counts say. */
  tooSmall: boolean
  /** One or two plain sentences on what can be concluded from this row. Always present. A "more budget" row says so first. */
  conclusion: string
  /** Why there is no pair, or what differs between the sides. */
  note?: string
}
