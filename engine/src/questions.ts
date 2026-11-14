// Every Jev question lives here, so wording can be audited and edited in one place.
// Jev makes judgments; code in jev.ts turns them into decisions (keep / drop, verified / escalate).
import type { ClassifierQuestion } from "@earendil-works/pi-ai"

export const triageQuestions = (): Record<string, ClassifierQuestion> => ({
  reports_results: {
    type: "bool",
    instructions: "Does `passage` report results from an experiment, assay, trial, or data analysis?",
    criteria: {
      true: "The passage gives findings, such as measured values, outcomes, or effect sizes",
      false: "The passage gives background, opinion, or methods, with no findings of its own",
    },
  },
  answers_question: {
    type: "bool",
    instructions: "Does `passage` contain information that helps answer `key_question`?",
    criteria: {
      true: "A scientist working on `key_question` would cite this passage",
      false: "The passage is about a different target, compound class, or question",
    },
  },
  study_type: {
    type: "choice",
    instructions: "What kind of study does `passage` describe?",
    criteria: {
      in_vitro: "Cell-free or cell-based laboratory assays",
      in_vivo: "Animal experiments",
      clinical: "Studies in human patients or volunteers, including trial results",
      review: "A summary of other studies",
      computational: "Modeling, docking, or analysis of existing data",
    },
  },
})

// One question per claim, all over the same evidence: the state is read and paid for once.
export const claimQuestions = (claims: string[]): Record<string, ClassifierQuestion> =>
  Object.fromEntries(claims.flatMap((claim, i) => [
    [`supports_${i}`, {
      type: "bool",
      instructions: `Does \`evidence.text\` state this finding: "${claim}"?`,
      criteria: {
        true: "The evidence states the same finding, with matching numbers where the claim gives numbers",
        false: "The evidence does not mention this finding, or only mentions the topic",
      },
    }],
    [`contradicts_${i}`, {
      type: "bool",
      instructions: `Does \`evidence.text\` give a finding that conflicts with this claim: "${claim}"?`,
      criteria: {
        true: "The evidence reports a value or outcome that cannot be true at the same time as the claim",
        false: "Nothing in the evidence conflicts with the claim",
      },
    }],
  ]))

export const progressQuestions = (): Record<string, ClassifierQuestion> => ({
  new_risk: {
    type: "bool",
    instructions: "Does `round.replies` name a risk to the candidates that is not in `known_risks`?",
    criteria: {
      true: "At least one reply raises a safety, efficacy, chemistry, or competitive risk missing from `known_risks`",
      false: "Every risk the replies mention is already in `known_risks`",
    },
  },
})
