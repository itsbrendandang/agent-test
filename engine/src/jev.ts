// Jev is the first-pass checker: cheap, fast, calibrated. Code owns the truth tables below; anything
// Jev leaves between the thresholds escalates to OpenAI (literature) or Claude Code (computed).
import type { ClassifierAnswer, Models } from "@earendil-works/pi-ai"
import { type BoardConfig, MOCK } from "./config.ts"
import type { EvidenceItem, Verdict } from "./events.ts"
import { claimQuestions, triageQuestions } from "./questions.ts"

const p = (a: ClassifierAnswer | undefined) => (a?.type === "bool" ? a.probability : undefined)

export class Jev {
  usd = 0
  private models: Models
  private config: BoardConfig
  constructor(models: Models, config: BoardConfig) { this.models = models; this.config = config }

  private async ask(state: Record<string, unknown>, questions: ReturnType<typeof triageQuestions>) {
    if (MOCK) return mockAnswers(state, questions)
    const id = this.config.checkers.jev.model
    const model = process.env.TYPESAFE_API_KEY
      ? this.models.getModelOfType("classifier", "typesafe", "jev-latest")
      : this.models.getModelOfType("classifier", "openrouter", id)
    if (!model) throw new Error(`Jev model ${id} is not available`)
    const result = await this.models.classify(model, { state: state as never, questions })
    // A failed call is an error, never a "no".
    if (result.stopReason !== "stop") throw new Error(`Jev failed: ${result.errorMessage ?? result.stopReason}`)
    this.usd += result.usage?.cost.total ?? 0
    return result.answers
  }

  /** Keep an evidence item unless Jev is confident it does not help the key question. */
  async triage(item: EvidenceItem, keyQuestion: string): Promise<{ keep: boolean; item: EvidenceItem }> {
    const a = await this.ask({ key_question: keyQuestion, passage: { title: item.title, text: item.text } }, triageQuestions())
    const relevant = p(a.answers_question) ?? 0
    const results = p(a.reports_results) ?? 0
    const studyType = a.study_type?.type === "choice" ? a.study_type.choice : undefined
    const { no } = this.config.checkers.jev
    // Truth table: drop only what is confidently off-topic, or on-topic with confidently no findings and no review value.
    const keep = relevant >= no && !(results < no && studyType !== "review")
    return { keep, item: { ...item, studyType, relevance: relevant } }
  }

  /** Check claims against one piece of evidence. Returns a verdict, or "escalate" for the uncertain band. */
  async check(claims: string[], evidence: string): Promise<{ verdict: Verdict | "escalate"; p: number }[]> {
    if (!claims.length) return []
    const a = await this.ask({ evidence: { text: evidence } }, claimQuestions(claims))
    const { yes, no } = this.config.checkers.jev
    return claims.map((_, i) => {
      const supports = p(a[`supports_${i}`]) ?? 0.5
      const contradicts = p(a[`contradicts_${i}`]) ?? 0.5
      if (contradicts > yes) return { verdict: "contradicted" as const, p: contradicts }
      if (supports > yes) return { verdict: "verified" as const, p: supports }
      if (supports < no && contradicts < no) return { verdict: "unsupported" as const, p: supports }
      return { verdict: "escalate" as const, p: supports }
    })
  }
}

// Mock Jev: word overlap stands in for judgment, so the truth tables and escalation paths all run.
function mockAnswers(state: Record<string, unknown>, questions: Record<string, unknown>): Record<string, ClassifierAnswer> {
  const text = JSON.stringify(state).toLowerCase()
  const out: Record<string, ClassifierAnswer> = {}
  for (const [id, q] of Object.entries(questions) as [string, { type: string; instructions: string }][]) {
    const claim = /"(.+)"/.exec(q.instructions)?.[1]?.toLowerCase() ?? ""
    const words = claim.split(/\W+/).filter((w) => w.length > 3)
    const overlap = words.length ? words.filter((w) => text.includes(w)).length / words.length : 0.6
    if (id === "answers_question" || id === "reports_results") { out[id] = { type: "bool", probability: /kras|herg|resistance/.test(JSON.stringify(state.passage ?? "").toLowerCase()) ? 0.85 : 0.08 }; continue }
    if (q.type === "choice") out[id] = { type: "choice", choice: text.includes("patients") ? "clinical" : "in_vitro", probabilities: {}, confidence: 0.8 }
    else if (id.startsWith("contradicts")) out[id] = { type: "bool", probability: claim.includes("no resistance") ? 0.9 : 0.1 }
    else out[id] = { type: "bool", probability: Math.min(0.95, overlap) }
  }
  return out
}
