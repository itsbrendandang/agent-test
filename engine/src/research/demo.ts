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

// ── The Standard level's demo: two example hypotheses, tested against the example sources ─────────────────────────

export const DEMO_HYPOTHESES = JSON.stringify({ needed: true, hypotheses: [
  { text: "Demo hypothesis: approved covalent KRAS G12C inhibitors produce objective responses in previously treated patients.", supportIf: "A clinical report gives a response rate in previously treated patients.", contradictIf: "Clinical reports find no responses in these patients.", origin: "planner", web: { query: "demo", objective: "demo" }, literature: "demo example" },
  { text: "Demo hypothesis: tumours do not become resistant to KRAS G12C inhibitors.", supportIf: "Studies of patients who progressed find no resistance mutations.", contradictIf: "Sequencing of patients who progressed finds resistance mutations.", origin: "planner", web: { query: "demo", objective: "demo" }, literature: "demo example" },
] })

/** The sections the two demo investigators "draft": one sentence for H1; for H2 one against it, and one filed for it that does not bear on it (the stance check sets that one aside). */
export const DEMO_SECTIONS: Record<string, string> = {
  H1: `### H1: KRAS G12C inhibitors produce responses
**For:** Approved covalent KRAS G12C inhibitors give objective response rates near 37 to 41 percent in previously treated patients [1].
**Not found:** an example source that reports no responses.`,
  H2: `### H2: Tumours do not become resistant
**For:** Piperazine-linked quinazolines often inhibit hERG at low micromolar concentrations [2].
**Against:** Sequencing of patients progressing on KRAS G12C inhibitors found Y96D and R68S switch-II pocket mutations and MET amplification [3].`,
}
export const DEMO_COMPARISON = `**Demo answer. This is fixed example text, not research. Nothing was searched and no model was asked.** In the example sources there is a finding for H1 and a finding against H2. Switch to Real to ask your question for real.

NEXT STEPS`

export const DEMO_STANCES = JSON.stringify({ stances: [{ i: 0, stance: "supports" }, { i: 1, stance: "neither" }, { i: 2, stance: "contradicts" }] })

/** What a demo specialist "drafts": one sentence the example source on hERG states. */
export const DEMO_SPECIALIST = `### Method view: demo
Adding polarity reduced hERG binding in most matched pairs [2].`
/** The specialists' sections of the draft a demo reviser is given, kept as they are (the fixed revised text has none). */
const methodViews = (user: string): string => {
  const draft = /<draft>\n([\s\S]*?)\n<\/draft>/.exec(user)?.[1] ?? ""
  const at = draft.search(/^### Method view:/m)
  return at < 0 ? "" : draft.slice(at).replaceAll("&lt;", "<").trim()
}

const fixed = (text: string) => async () => ({ text, usd: 0, truncated: false })
const tests = (system: string, user: string) => system.includes("# This answer tests hypotheses") || user.includes("<hypotheses>")

/** The four model steps as fixed text. Costs nothing; every name is "scripted". */
export const demoBrain: Brain = {
  names: { planner: "scripted", writer: "scripted", checker: "scripted", critic: "scripted" },
  checkerIndependent: true,
  criticIndependent: true,
  worstCase: () => 0,
  plan: fixed(JSON.stringify({ key_question: "KRAS G12C inhibitors: response, hERG and resistance (demo)", medical: false, researchable: true, web: [{ query: "demo", objective: "demo" }], literature: ["demo example"] })),
  write: async (system, user, _signal, onDelta) => { const text = tests(system, user) ? DEMO_COMPARISON : DEMO_DRAFT; onDelta(text); return { text, usd: 0, truncated: false } }, // all at once: see pacedDemoBrain
  specialistModel: "scripted",
  specialist: fixed(DEMO_SPECIALIST),
  section: async (system) => ({ text: DEMO_SECTIONS[/Yours is (H\d)\./.exec(system)?.[1] ?? "H1"] ?? "", usd: 0, truncated: false }),
  critique: async (system, user) => ({ text: tests(system, user) ? JSON.stringify({ notes: [] }) : DEMO_NOTES, usd: 0, truncated: false }),
  hypothesize: fixed(DEMO_HYPOTHESES),
  stance: fixed(DEMO_STANCES),
  revise: async (_system, user) => { const views = methodViews(user); return { text: views ? DEMO_REVISED.replace("\n\nSwitch to Real", `\n\n${views}\n\nSwitch to Real`) : DEMO_REVISED, usd: 0, truncated: false } },
  rejudge: fixed(JSON.stringify({ notes: [{ note: 1, status: "resolved", why: "Demo text: the sentence is no longer in the answer." }] })),
}

/** The pause between two pieces of the demo writer's text, in milliseconds, in a running engine (app.ts). */
export const DEMO_PACE_MS = 60

/**
 * The demo brain whose writer gives its text a few words at a time, `paceMs` apart, as a model streams its reply. The
 * Overview's chat then shows a demo answer being written, through the same answer.delta events as a real one. This is
 * the scripted writer's own output while its step runs: a finished answer is never streamed again (pipeline.ts sends
 * the draft once, and a replay after a restart does not repeat it). The lines after NEXT STEPS, which nobody sees,
 * come in one piece. A cancelled answer stops the pauses at once. paceMs 0 is demoBrain itself.
 */
export function pacedDemoBrain(paceMs: number): Brain {
  if (!(paceMs > 0)) return demoBrain
  return {
    ...demoBrain,
    write: async (system, user, signal, onDelta) => {
      const text = tests(system, user) ? DEMO_COMPARISON : DEMO_DRAFT
      const cut = text.search(/\nNEXT STEPS/)
      const shown = cut >= 0 ? text.slice(0, cut) : text
      const words = shown.match(/\s*\S+\s*/g) ?? [shown]
      for (let i = 0; i < words.length; i += 2) {
        if (i > 0 && !signal.aborted) await pause(paceMs, signal)
        onDelta(words.slice(i, i + 2).join(""))
      }
      if (shown.length < text.length) onDelta(text.slice(shown.length))
      return { text, usd: 0, truncated: false }
    },
  }
}

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(done, ms)
  function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve() }
  signal.addEventListener("abort", done, { once: true })
})
