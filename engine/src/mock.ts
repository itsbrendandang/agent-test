// Scripted turns for mock mode. Each function reads the agent's own conversation and returns the next
// step, so mock runs exercise the real harness, tools, checkers, constraints and events.
import type { TranscriptContext } from "@earendil-works/pi-ai"
import type { AgentDef } from "./agents.ts"
import type { EvidenceItem } from "./events.ts"

export interface Step { text: string; tool?: { name: string; args: Record<string, unknown> } }

export const MOCK_EVIDENCE: EvidenceItem[] = [
  { url: "https://example.org/mock/kras-g12c-clinical-review", title: "KRAS G12C inhibitors in NSCLC: clinical review (mock)",
    text: "Approved covalent KRAS G12C inhibitors give objective response rates near 37 to 41 percent in previously treated patients. Acquired resistance through secondary KRAS mutations and bypass signaling is common within a year." },
  { url: "https://example.org/mock/herg-acrylamide", title: "hERG liability of piperazine acrylamides (mock)",
    text: "In vitro patch-clamp data show piperazine-linked quinazolines often inhibit hERG at low micromolar concentrations; adding polarity reduced hERG binding in most matched pairs." },
  { url: "https://example.org/mock/resistance-mechanisms", title: "Resistance mechanisms to KRAS G12C inhibition (mock)",
    text: "Sequencing of patients progressing on KRAS G12C inhibitors found Y96D and R68S switch-II pocket mutations and MET amplification. Compounds binding a different pocket region retained activity against Y96D in cell assays." },
  { url: "https://example.org/mock/marketing-blog", title: "Top 10 biotech stocks to watch (mock)",
    text: "Investors are excited about oncology. Here are ten companies with strong momentum this quarter." },
]

const text = (m: TranscriptContext["messages"][number]) =>
  typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join("")

export function mockLeadTurn(ctx: TranscriptContext): Step {
  const results = ctx.messages.filter((m) => m.role === "toolResult")
  const last = results.at(-1)
  if (last && "toolName" in last && last.toolName === "write_memo") return { text: "Memo written. The board has finished." }
  const rounds = results.filter((m) => "toolName" in m && m.toolName === "converse").length
  const wrapUp = last ? /WRAP UP/.test(text(last)) : false
  if (rounds >= 3 || (wrapUp && rounds >= 1 && /final positions/i.test(text(last!)))) {
    return { text: "Writing the memo.", tool: { name: "write_memo", args: { decision: "Go with conditions", memo: MOCK_MEMO } } }
  }
  if (wrapUp || rounds === 2) return { text: "Time to close.", tool: { name: "converse", args: { message: "We are at our limit. Final positions: one statement each, Go or No-Go, and the one condition you would attach.", final: true } } }
  if (rounds === 1) return { text: "Pushing on the disagreement.", tool: { name: "converse", args: { message: "Round 2. Methods Auditor and Critic: the hERG margin and solubility of CMP-0517 both miss the criteria. Reviser: fix what they flagged. Finisher: list the outputs that are still missing. Reporter: draft the supported findings and the rejected claims.", final: false } } }
  return {
    text: "Framing: Go only if one candidate has a credible path to the criteria and a differentiation story against the approved drugs.",
    tool: { name: "converse", args: { message: "Round 1. Scout: inspect the data. Proposer: plan the analysis and name the claims to test. Pilot and Experimenter: say what you would run. Everyone else: give your first check. Work independently.", final: false } },
  }
}

const MEMBER_REPLIES: Record<string, (round: number) => string> = {
  scout: () => `The brief has one assay table for two candidates. No raw data files came with it, so no file could be checked for damage.\n\nCLAIMS\n- [brief] The brief gives six assays for each of CMP-0423 and CMP-0517 (source: brief)`,
  proposer: () => `Plan: compare each candidate with the decision criteria, one claim per criterion.\n\nCLAIMS\n- [brief] CMP-0517 pERK IC50 is 95 nM in H358 (source: brief)\n- [brief] CMP-0423 pERK IC50 is 180 nM in H358 (source: brief)`,
  pilot: () => `Prepared a script that reads the assay table and computes descriptors from the SMILES. Not run: this board has no code tool yet.\n\nCLAIMS\n- [computed] CMP-0423 TPSA is about 49 and cLogP about 2.4 (source: RDKit on CMP-0423 SMILES)`,
  experimenter: (r) => r === 1 ? `CMP-0423 passes solubility and clearance; CMP-0517 fails solubility.\n\nCLAIMS\n- [brief] CMP-0517 kinetic solubility is 4 uM (source: brief)\n- [brief] CMP-0423 kinetic solubility is 12 uM (source: brief)\n- [brief] CMP-0423 shows no resistance liability (source: brief)` :
    `No new results this round: the reruns the Reviser asked for need a code tool.\n\nCLAIMS`,
  "methods-auditor": () => `The plan compares each candidate with every criterion. The hERG margin step is present; resistance testing is missing.\n\nCLAIMS\n- [brief] CMP-0517 hERG IC50 is 6 uM (source: brief)\n- [literature] Adding polarity reduced hERG binding in most matched pairs (source: https://example.org/mock/herg-acrylamide)`,
  critic: (r) => `Supported: CMP-0517 fails the hERG margin. Rejected: the claim that CMP-0423 has no resistance liability; the brief has no resistance data. Not yet established: any advantage over the approved drugs.\n\nCLAIMS\n- [brief] CMP-0423 hERG IC50 is 18 uM (source: brief)\n- [literature] Piperazine-linked quinazolines show no resistance liability (source: https://example.org/mock/resistance-mechanisms)` ,
  reviser: () => `Dropped the Experimenter's claim that CMP-0423 has no resistance liability: the brief has no resistance data. Nothing else changed.\n\nCLAIMS\n- [brief] CMP-0517 hERG IC50 is 6 uM (source: brief)`,
  finisher: () => `Required outputs: the comparison table is present. The resistance-mutant results are missing and cannot be made from this data.\n\nCLAIMS`,
  reporter: () => `Draft: one supported finding (CMP-0517 fails the hERG margin), one rejected claim (no resistance liability for CMP-0423), and no resistance data.\n\nCLAIMS\n- [brief] Neither candidate has resistance-mutant data (source: brief)`,
}

/** Real members open with "In short:" (board/context/writing-style.md); the scripted ones do the same, from their first sentence. */
const inShort = (reply: string) => `In short: ${reply.split("\n")[0].split(/(?<=[.!?])\s/)[0]}\n\n${reply}`

export const mockMemberTurn = (agent: AgentDef) => (ctx: TranscriptContext): Step => {
  const last = ctx.messages.at(-1)
  const round = Number(/Round (\d+)/.exec(ctx.messages.filter((m) => m.role === "user").map(text).at(-1) ?? "")?.[1] ?? 1)
  if (last?.role === "user" && agent.tools.includes("exa_search") && round === 1) {
    return { text: "Searching.", tool: { name: "exa_search", args: { query: `KRAS G12C ${agent.title} evidence`, objective: "Find primary data that separates the two candidates; prefer research papers over news and pull potency, selectivity and safety figures.", key_question: "Is either candidate differentiated?" } } }
  }
  if (last?.role === "user" && /final positions/i.test(text(last))) {
    const position = agent.name === "critic" ? "No-Go: no advantage over the approved drugs is established yet." : agent.name === "finisher" ? "Outputs complete except the resistance-mutant results." : "Go with CMP-0423, conditional on a resistance-mutant panel by month 3."
    return { text: inShort(`${position}\n\nCLAIMS`) }
  }
  return { text: inShort((MEMBER_REPLIES[agent.name] ?? (() => "No comment.\n\nCLAIMS"))(round)) }
}

const MOCK_MEMO = `# Memo: KRAS G12C hit-to-lead (mock run)

## Decision
**Go with conditions: advance CMP-0423; park CMP-0517.**

## Rationale
CMP-0423 meets solubility, clearance and hERG criteria and misses only potency (180 nM vs 100 nM), which the
Methods Auditor and Critic rate as the more fixable liability. CMP-0517's hERG IC50 of 6 uM fails the safety margin.

## Board Positions
- Scout: one assay table, no raw data files to check.
- Proposer: one claim per decision criterion.
- Pilot: descriptor script prepared, not run.
- Experimenter: CMP-0423 passes solubility and clearance; CMP-0517 fails solubility.
- Methods Auditor: resistance testing is missing from the plan.
- Critic: No-Go until an advantage over the approved drugs is shown. (dissent)
- Reviser: dropped one claim that did not match the brief.
- Finisher: resistance-mutant results are missing.
- Reporter: one supported finding, one rejected claim.

## Evidence Ledger Summary
See verification_ledger.json. One claim did not match the brief and was dropped.

## Unresolved Tensions
Differentiation against approved drugs is a hypothesis, not data.

## Experiments That Would Change the Call
1. Y96D / R68S resistance-mutant panel for CMP-0423 (No-Go if inactive).
2. hERG on the first three polar analogs of CMP-0517 (revive it if IC50 > 30 uM).

## Next Actions
Resistance panel by month 3; potency SAR sprint on the quinazoline 6-position.
`
