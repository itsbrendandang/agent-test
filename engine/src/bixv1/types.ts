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
  // The swarm only, from its ledger. Left out when the ledger has no such derivation.
  analystAnswer?: string
  criticAnswer?: string
  /** Did code find the two derivations to agree? null: one is missing. "unclear" comparisons are false. */
  agreed?: boolean | null
  /** The ledger's own word: agree, differ, unclear. */
  comparison?: string | null
  reconcilerAnswer?: string
  /** Which derivation the reconciler kept (A = analyst, B = critic, both, neither) and the cause it recorded. */
  reconcilerKeep?: string
  reconcilerCause?: string
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
  capsuleRuns: { done: number; failed: number; running: number }
  /** The per-run token budget when every capsule run had the same one, else null; and the sum. */
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
  /** "running" while any capsule run is unfinished. A crashed run keeps saying "running": the adapter cannot tell. */
  state: "running" | "done" | "empty"
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
  dataset: string | null
  datasetRevision: string | null
  model: string
  gradingProfile: string
  answerMode: string | null
  capsules: string[]
  questions: number
  /** Per capsule run when all are equal, else null; and the total. Equal on both sides by construction. */
  maxTokens: number | null
  maxTokensTotal: number | null
  timeLimit: number | null
  single?: BixScoreCell
  swarm?: BixScoreCell
  /** Present only when both sides exist. */
  paired?: BixPaired
  /** True when the data cannot support any conclusion, whatever the counts say. */
  tooSmall: boolean
  /** One or two plain sentences on what can be concluded from this row. Always present. */
  conclusion: string
  /** Why there is no pair, or what differs between the sides. */
  note?: string
}
