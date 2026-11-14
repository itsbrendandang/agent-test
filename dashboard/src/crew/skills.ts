import type { CrewMember } from "./store"

// Starter SKILL.md files for a crew member. Same shape as an agent skill: front matter, then instructions.
interface Starter { id: string; label: string; match: RegExp; description: string; steps: string[]; rules: string[] }

export const SKILL_STARTERS: Starter[] = [
  {
    id: "literature", label: "Literature scout", match: /research|literature|scout|read/i,
    description: "Finds and summarises papers for a research question. Use when a task needs sources or prior work.",
    steps: [
      "Restate the question in one sentence and list the search terms you will use.",
      "Search for papers, preferring primary sources and recent reviews.",
      "For each useful paper, record the citation, the main claim, the method, and the evidence.",
      "Hand the notes to the next teammate as a short list, most relevant first.",
    ],
    rules: ["Never cite a paper you have not opened.", "Mark anything you could not verify as unverified."],
  },
  {
    id: "builder", label: "Experiment builder", match: /build|code|engineer|develop|program/i,
    description: "Writes and runs code for experiments and simulations. Use when a task needs something implemented.",
    steps: [
      "Read the task and any notes handed over. Write down what done looks like.",
      "Work only inside your own workspace folder.",
      "Make the smallest change that works, then run it.",
      "Report what you ran, what happened, and where the output is.",
    ],
    rules: ["Do not delete files you did not create.", "If a run fails twice, stop and report the error."],
  },
  {
    id: "reviewer", label: "Reviewer", match: /review|check|test|critic|qa/i,
    description: "Checks a teammate's work for errors before it reaches the user. Use after something is built or written.",
    steps: [
      "Re-run the work yourself instead of trusting the report.",
      "Check each claim against its source or its output.",
      "List problems by severity, each with where it is and how to reproduce it.",
      "Say plainly whether the work is ready or not.",
    ],
    rules: ["Do not fix the work yourself; send it back with notes.", "No problems found is a valid result. Do not invent any."],
  },
  {
    id: "analyst", label: "Data analyst", match: /data|analy|stat|plot/i,
    description: "Analyses results and makes figures. Use when a task has data that needs summarising or plotting.",
    steps: [
      "Describe the data: source, size, columns, and anything missing.",
      "State the question the analysis answers before running it.",
      "Run the analysis and make one figure per finding.",
      "Report each finding with its number, its uncertainty, and the figure.",
    ],
    rules: ["Never drop data points without saying so.", "Keep the script that produced every figure."],
  },
  {
    id: "notebook", label: "Lab notebook", match: /note|log|record|write|scribe/i,
    description: "Keeps a dated record of what the crew did and found. Use throughout a task.",
    steps: [
      "Start an entry with the date and the task.",
      "Log each handoff: who, what, and where the files are.",
      "Record results as they arrive, including failed attempts.",
      "End with a short summary and the open questions.",
    ],
    rules: ["Record what happened, not what was planned.", "Never rewrite earlier entries; add a correction instead."],
  },
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent"

export function buildSkill(member: Pick<CrewMember, "name" | "role">, starter: Starter): string {
  return `---
name: ${slug(member.role || starter.label)}
description: ${starter.description}
---

# ${member.name}, ${member.role || starter.label}

## Steps
${starter.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Rules
${starter.rules.map((r) => `- ${r}`).join("\n")}
`
}

// The starter whose keywords match the member's role, if any.
export const suggestStarter = (role: string) => SKILL_STARTERS.find((s) => s.match.test(role))
