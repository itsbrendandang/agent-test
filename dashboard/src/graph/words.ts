// Every word the Graph view shows for a kind of node or line, in one place. The words are the dashboard's shared ones
// (src/lib/words.ts: practice, statement, team member, test, problem, output, step, and the four marks Supported,
// Contradicted, Insufficient evidence, Not checked). The expert term goes in a tooltip or a small second line.
import type { LinkKind, NodeKind, Outcome, RunKind } from "./types"

/** The graph draws statements in three groups (shape and colour). The third holds two marks, and says so. */
export const GROUP_WORD: Record<Outcome, string> = { holds: "Supported", fails: "Contradicted", unknown: "Insufficient evidence or not checked" }

export const kindLabel = (k: NodeKind, run: RunKind): string => ({
  run: "Run", agent: run === "swarm" ? "Role" : "Team member", checker: "Checker", phase: run === "swarm" ? "Step" : "Round",
  claim: "Statement", source: "Source", test: "Test", issue: "Problem", artifact: "Output",
} as const)[k]

/** One plain sentence per kind: what the thing is. */
export const KIND_WHAT: Record<NodeKind, string> = {
  run: "the run itself",
  agent: "a team member of the board, or a role of the team of nine: an AI that took part",
  checker: "who checked a statement; team members never check their own",
  phase: "a round of the board, or one step of a role in the team of nine",
  claim: "something a team member or role said was true, which is then checked",
  source: "evidence a team member used, or the brief itself",
  test: "a test written down in advance to try to prove a statement wrong",
  issue: "a problem a reviewer found in the work",
  artifact: "an output file, or the decision",
}

/** The expert term, for tooltips and for a small second line. */
export const KIND_TECH: Record<NodeKind, string> = {
  run: "run", agent: "agent", checker: "checker (escalation chain)", phase: "phase", claim: "claim",
  source: "evidence item", test: "pre-registered falsification test", issue: "issue (in the ledger)", artifact: "artefact",
}

/** The verb on a line, as it reads from the one that acted to the one it acted on. */
export const LINK_VERB: Record<LinkKind, string> = {
  involves: "includes", framed: "framed", replied: "replied in", made: "said", ruled: "checked", retrieved: "used",
  cites: "cites", "in-phase": "happened in", next: "came before", targets: "tested", registered: "planned",
  recorded: "ran", raised: "found", resolved: "fixed", against: "is a problem with", about: "is about", produced: "produced",
}

/** The dashboard's own legend sentences, with the checker's technical words after them. */
export const LEGEND_SENTENCES = {
  board: "Supported: a separate check found a source that supports the statement. Contradicted: a source goes against it. Insufficient evidence: it was checked and no supporting source was found. Not checked: nothing checked it. A separate checker decides each one; the team does not grade itself. (Checker's words: verified, contradicted, unsupported, unchecked.)",
  swarm: "Supported: the statement passed its tests. Contradicted: a test went against it. Insufficient evidence: its tests did not settle it, or a planned test has no result. Not checked: no test of it has a result. Code decides each one from the test numbers. (The record's words: supported, refuted, insufficient, untested.)",
}
