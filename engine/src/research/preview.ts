// THE PREVIEW SWITCH of the direct answer (the Research screen, POST /api/research). In Real mode a paid answer is
// refused with 503 {preview: false} unless the engine was started with RESEARCH_PREVIEW=1, and the dashboard then
// asks for a team-review plan instead. Demo answers need no switch. This file only reads the switch and says what it
// means, so the start-up lines, GET /api/status and the chat catalog can show it without loading the pipeline.
// It does not change the default: off unless the value is exactly 1.

export const previewOn = (env: NodeJS.ProcessEnv = process.env): boolean => (env.RESEARCH_PREVIEW ?? "").trim() === "1"

/** Whether a question on the Research screen gets a direct answer now: always in Demo mode, in Real mode only with the switch. */
export const directAnswers = (mock: boolean, env: NodeJS.ProcessEnv = process.env): boolean => mock || previewOn(env)

/** One start-up line about the switch, true for the mode the engine is in. */
export function previewLine(mock: boolean, env: NodeJS.ProcessEnv = process.env): string {
  if (mock) return `Direct answers (Research screen): DEMO answers, nothing is spent. In Real mode they also need RESEARCH_PREVIEW=1 (now ${previewOn(env) ? "set" : "not set"}).`
  return previewOn(env)
    ? "Direct answers (Research screen): ON (RESEARCH_PREVIEW=1). Each answer calls paid models, up to its cap."
    : "Direct answers (Research screen): OFF. RESEARCH_PREVIEW is not 1, so a question on the Research screen gets a team-review plan, not an answer. Restart the engine with RESEARCH_PREVIEW=1 to turn them on."
}
