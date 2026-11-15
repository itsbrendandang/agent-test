// What `npm start` (scripts/start.mjs) says about the engine it will use: its mode, the paid switch, which keys are
// set, whether the Research screen gives direct answers, and whether the engine runs this folder's code. An engine that
// was already running is reused as it is, so this is the only place a person sees that it may be another checkout's,
// or in another mode than .env says now.
// Pure: the caller reads GET /api/status and `git rev-parse HEAD`. It never prints a key, only whether one is set.

/** The fields of GET /api/status this reads. Older engines lack some; each line is left out when its field is. */
export interface EngineStatus {
  mock?: boolean
  paidCalls?: boolean
  paidSource?: string
  keys?: Record<string, boolean>
  directAnswers?: boolean
  manifest?: { commit?: string | null; dirty?: boolean | null }
}

const KEY_NAMES: [string, string][] = [["ANTHROPIC_API_KEY", "Anthropic"], ["OPENAI_API_KEY", "OpenAI"], ["EXA_API_KEY", "Exa"]]

/** `status`: GET /api/status, undefined when it did not answer. `here`: this folder's commit, or null. `reused`: the engine was already running. */
export function engineSummary(status: EngineStatus | undefined, here: string | null, reused: boolean, port = 8787): { lines: string[]; warnings: string[] } {
  const lines: string[] = [], warnings: string[] = []
  if (!status) return { lines, warnings: ["Could not read the engine's mode (GET /api/status did not answer). Read the engine's own output above."] }
  if (typeof status.mock === "boolean") lines.push(status.mock ? "Mode:            Demo. The models are scripted; nothing is spent." : "Mode:            Real. Team reviews and answers call paid models.")
  if (typeof status.paidCalls === "boolean") lines.push(`Paid calls:      ${!status.paidCalls ? "OFF" : status.paidSource === "switch" ? "ON (turned on in the app; a restart turns them off)" : "ON (NO_PAID_CALLS=0)"}`)
  if (status.keys) lines.push(`Keys set:        ${KEY_NAMES.map(([k, name]) => `${name} ${status.keys?.[k] ? "yes" : "no"}`).join(", ")}`)
  if (typeof status.directAnswers === "boolean") lines.push(`Direct answers:  ${status.directAnswers ? "ON" : "OFF. RESEARCH_PREVIEW is not 1, so a question on the Research screen gets a team-review plan, not an answer."}`)
  const commit = status.manifest?.commit
  if (commit) lines.push(`Engine code:     commit ${commit.slice(0, 10)}${status.manifest?.dirty ? ", with changes not committed" : ""}`)
  if (!reused) return { lines, warnings }
  lines.push(`This engine was already running on port ${port}: its mode comes from how it was started, not from .env now.`)
  if (!status.manifest) warnings.push(`The engine on port ${port} does not say which code it runs, so it is older than this folder's code. Stop it, then run npm start again.`)
  else if (commit && here && commit !== here) warnings.push(`The engine on port ${port} runs commit ${commit.slice(0, 10)}, but this folder is at ${here.slice(0, 10)}. It was started from another folder or before an update. Stop it, then run npm start again to use this folder's code.`)
  return { lines, warnings }
}
