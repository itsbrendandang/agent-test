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
  if (rounds === 1) return { text: "Pushing on the disagreement.", tool: { name: "converse", args: { message: "Round 2. Toxicologist and ADMET: CMP-0517's hERG margin and solubility both miss the criteria. Medicinal Chemist: which liability is more fixable? Skeptic: attack the differentiation case. Scout: find resistance data that favors either scaffold.", final: false } } }
  return {
    text: "Framing: Go only if one candidate has a credible path to the criteria and a differentiation story against the approved drugs.",
    tool: { name: "converse", args: { message: "Round 1. Each of you, deliver your card for both candidates against the decision criteria. Work independently.", final: false } },
  }
}

const MEMBER_REPLIES: Record<string, (round: number) => string> = {
  "literature-scout": () => `Kept 3 of 4 sources after screening.\n\nCLAIMS\n- [literature] Approved KRAS G12C inhibitors give response rates near 37 to 41 percent in previously treated patients (source: https://example.org/mock/kras-g12c-clinical-review)\n- [literature] Y96D switch-II mutations appear in patients progressing on KRAS G12C inhibitors (source: https://example.org/mock/resistance-mechanisms)`,
  "target-biologist": () => `Target is clinically validated; the open question is durability, not biology.\n\nCLAIMS\n- [literature] Acquired resistance through secondary KRAS mutations is common within a year (source: https://example.org/mock/kras-g12c-clinical-review)`,
  "medicinal-chemist": (r) => r === 1 ? `CMP-0517 is more potent; CMP-0423 is cleaner. Potency is the easier fix on the quinazoline core.\n\nCLAIMS\n- [brief] CMP-0517 pERK IC50 is 95 nM in H358 (source: brief)\n- [computed] CMP-0423 TPSA is about 49 and cLogP about 2.4 (source: RDKit on CMP-0423 SMILES)` :
    `Polarity at the piperazine could lower hERG on CMP-0517, but it will cost permeability.\n\nCLAIMS\n- [literature] Adding polarity reduced hERG binding in most matched pairs (source: https://example.org/mock/herg-acrylamide)`,
  admet: () => `CMP-0423 passes solubility (12 uM) and clearance; CMP-0517 fails solubility (4 uM).\n\nCLAIMS\n- [brief] CMP-0517 kinetic solubility is 4 uM (source: brief)`,
  toxicologist: (r) => `CMP-0517's hERG IC50 of 6 uM is the program-killing risk unless the dose is very low.\n\nCLAIMS\n- [brief] CMP-0517 hERG IC50 is 6 uM (source: brief)` + (r === 1 ? `\n- [literature] Piperazine-linked quinazolines show no resistance and no hERG issues (source: https://example.org/mock/herg-acrylamide)` : ""),
  "competitive-ip": () => `Two approved drugs and several next-generation programs. Differentiation must come from resistance coverage.\n\nCLAIMS\n- [literature] Compounds binding a different pocket region kept activity against Y96D (source: https://example.org/mock/resistance-mechanisms)`,
  skeptic: () => `Neither candidate beats the approved drugs on any measured axis. Without resistance data this is a me-too.\n\nCLAIMS\n- [brief] Neither candidate has resistance-mutant data (source: brief)`,
  moonshot: () => `Back the scaffold as a degrader handle instead: resistance coverage is the real differentiation.\n\nCLAIMS\n- [literature] MET amplification is a resistance mechanism to KRAS G12C inhibition (source: https://example.org/mock/resistance-mechanisms)`,
}

export const mockMemberTurn = (agent: AgentDef) => (ctx: TranscriptContext): Step => {
  const last = ctx.messages.at(-1)
  const round = Number(/Round (\d+)/.exec(ctx.messages.filter((m) => m.role === "user").map(text).at(-1) ?? "")?.[1] ?? 1)
  if (last?.role === "user" && agent.tools.includes("exa_search") && round === 1) {
    return { text: "Searching.", tool: { name: "exa_search", args: { query: `KRAS G12C ${agent.title} evidence`, objective: "Find primary data that separates the two candidates; prefer research papers over news and pull potency, selectivity and safety figures.", key_question: "Is either candidate differentiated?" } } }
  }
  if (last?.role === "user" && /final positions/i.test(text(last))) {
    const position = agent.name === "skeptic" ? "No-Go: no differentiation yet." : agent.name === "moonshot" ? "Go, but as a degrader program." : "Go with CMP-0423, conditional on a resistance-mutant panel by month 3."
    return { text: `${position}\n\nCLAIMS` }
  }
  return { text: (MEMBER_REPLIES[agent.name] ?? (() => "No comment.\n\nCLAIMS"))(round) }
}

const MOCK_MEMO = `# Memo: KRAS G12C hit-to-lead (mock run)

## Decision
**Go with conditions: advance CMP-0423; park CMP-0517.**

## Rationale
CMP-0423 meets solubility, clearance and hERG criteria and misses only potency (180 nM vs 100 nM), which the
medicinal chemist rates as the more fixable liability. CMP-0517's hERG IC50 of 6 uM fails the safety margin.

## Board Positions
- Literature Scout: evidence pool of 3 screened sources.
- Target Biologist: target validated; durability is the question.
- Medicinal Chemist: Go CMP-0423; potency is fixable on the core.
- ADMET: CMP-0423 passes; CMP-0517 fails solubility.
- Toxicologist: CMP-0517 hERG is the program-killing risk.
- Competitive / IP: differentiation must come from resistance coverage.
- Skeptic: No-Go until resistance data exists. (dissent)
- Moonshot: reframe as a degrader program. (dissent)

## Evidence Ledger Summary
See verification_ledger.json. One literature claim was contradicted by its own source and dropped.

## Unresolved Tensions
Differentiation against approved drugs is a hypothesis, not data.

## Experiments That Would Change the Call
1. Y96D / R68S resistance-mutant panel for CMP-0423 (No-Go if inactive).
2. hERG on the first three polar analogs of CMP-0517 (revive it if IC50 > 30 uM).

## Next Actions
Resistance panel by month 3; potency SAR sprint on the quinazoline 6-position.
`
