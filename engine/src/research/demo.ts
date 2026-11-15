// The demo answer: what POST /api/research gives while paid calls are off. It goes through the same pipeline and the
// same events as a real answer, with fixed text in place of every model and the board's example sources in place of
// every search, so nothing here reaches the network or costs anything. Every text says it is a demo.
import type { Brain } from "./pipeline.ts"

export const DEMO_DRAFT = `**Demo answer. This is fixed example text, not research. Nothing was searched and no model was asked.**

Approved covalent KRAS G12C inhibitors give objective response rates near 37 to 41 percent in previously treated patients [1]. Piperazine-linked quinazolines often inhibit hERG at low micromolar concentrations [2]. No resistance mutations were found in patients progressing on KRAS G12C inhibitors [3].

Switch to Real to ask your question for real.

NEXT STEPS
{"label": "Recommended next step", "text": "Demo: look at how the example source on hERG is quoted.", "why": "Demo text: the example sentence that cites it passed its check.", "basis": [2], "does": "It shows what a checked sentence looks like. Nothing is searched."}
{"label": "Alternative", "text": "Demo: this proposal names a source that does not exist.", "why": "Demo text: code drops it, because source 9 is not in the list.", "basis": [9], "does": "Nothing: it is never shown."}`

export const DEMO_NOTES = JSON.stringify({ notes: [{ severity: "blocking", statement: 3, text: "Demo note (fixed text): the third cited sentence says the opposite of its example source, which reports resistance mutations. Remove it." }] })

export const DEMO_REVISED = `**Demo answer. This is fixed example text, not research. Nothing was searched and no model was asked.**

Approved covalent KRAS G12C inhibitors give objective response rates near 37 to 41 percent in previously treated patients [1]. Piperazine-linked quinazolines often inhibit hERG at low micromolar concentrations [2].

Switch to Real to ask your question for real.

NEXT STEPS
{"label": "Recommended next step", "text": "Demo: look at how the example source on hERG is quoted.", "why": "Demo text: the example sentence that cites it passed its check.", "basis": [2], "does": "It shows what a checked sentence looks like. Nothing is searched."}

REVIEW NOTES
1: addressed`

const fixed = (text: string) => async () => ({ text, usd: 0, truncated: false })

/** The four model steps as fixed text. Costs nothing; every name is "scripted". */
export const demoBrain: Brain = {
  names: { planner: "scripted", writer: "scripted", checker: "scripted", critic: "scripted" },
  checkerIndependent: true,
  criticIndependent: true,
  worstCase: () => 0,
  plan: fixed(JSON.stringify({ key_question: "KRAS G12C inhibitors: response, hERG and resistance (demo)", medical: false, researchable: true, web: [{ query: "demo", objective: "demo" }], literature: ["demo example"] })),
  write: async (_system, _user, _signal, onDelta) => { onDelta(DEMO_DRAFT); return { text: DEMO_DRAFT, usd: 0, truncated: false } },
  critique: fixed(DEMO_NOTES),
  revise: fixed(DEMO_REVISED),
}
