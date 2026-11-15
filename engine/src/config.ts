// Loads board/config.yaml. Paths in the config are relative to the repo root.
import "./env.ts" // first: MOCK below depends on keys from .env
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { isLocalModel, localRefusal } from "./local.ts"
import { onPaidChange, paidCallsOff } from "./paid/paid.ts"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export type Tier = "lead" | "strong" | "cheap" | "rival"

export interface BoardConfig {
  meeting: { max_minutes: number; max_usd: number; max_rounds: number; daily_usd: number; lead_turns?: number; member_turns?: number; max_literature_searches?: number; max_database_searches?: number; max_escalations?: number; fallback_usd_per_mtok?: number; max_searches?: number; exa_usd_per_search?: number; exa_ceiling_usd?: number; exa_highlight_chars?: number }
  memory?: { enabled: boolean; max_notes: number }
  watch: { enabled: boolean; every_hours: number }
  brief: { required_sections: string[] }
  paths: { agents: string; briefs: string; context: string; expertise: string; runs: string }
  models: Record<Tier, string>
  /** Used instead of `models` when the board runs on a local model (DRUG_BOARD_LOCAL_MODEL): Ollama names per tier. */
  local_models?: Partial<Record<Tier, string>>
  checkers: {
    /** The cheap first-pass model of the other vendor (the cheap tier is the first choice); see providers.ts firstPassModel. */
    first_pass: { alt: string; max_source_chars?: number }
    escalate: { literature: "openai"; computed: "claude-code" }
    openai_model: string
    claude_code_cmd: string
    claude_code_tools?: string
    timeout_seconds?: number
  }
  board: string[]
  /** Limits of the research answer (research/types.ts limitsOf reads and bounds them). Every key is optional. */
  research?: Record<string, unknown>
}

/**
 * DRUG_BOARD_RUNS_DIR (optional, an absolute path) replaces `paths.runs`: where reviews, research answers and the Exa
 * spend record are kept. For a test engine, so that its practice runs never land in a person's saved research.
 */
export function loadConfig(file = resolve(ROOT, "board/config.yaml"), env: NodeJS.ProcessEnv = process.env): BoardConfig {
  const config = checkConfig(parse(readFileSync(file, "utf8")), file)
  if (env.DRUG_BOARD_RUNS_DIR) config.paths = { ...config.paths, runs: resolve(env.DRUG_BOARD_RUNS_DIR) }
  return config
}

/** A board/config.yaml that cannot be used as it is. The message names the file and the key. */
export class ConfigError extends Error {}

/**
 * The member that rechecks the scout's report in every review (board/agents/evidence-verifier.md). It is always on: the
 * config must list it, and a run's plan (overrides.json) cannot take it off the team (board.ts applyOverrides).
 */
export const VERIFIER = "evidence-verifier"

/** Limits every run reads. A value that is not a number is never reached (`spent >= "$5"` is false), so it is refused. */
const REQUIRED_LIMITS = ["max_minutes", "max_usd", "max_rounds", "daily_usd"] as const
/** Limits with a default in the code: absent or empty is fine, anything else must be a number. */
const OPTIONAL_LIMITS = ["lead_turns", "member_turns", "max_literature_searches", "max_database_searches", "max_escalations",
  "fallback_usd_per_mtok", "max_searches", "exa_usd_per_search", "exa_ceiling_usd", "exa_highlight_chars"] as const

/**
 * Refuses a config whose limits or team list would not hold: every `meeting` limit must be a number of 0 or more, and
 * the `board:` list must name the scout (the member that gathers the sources, AGENTS.md) and the evidence verifier. Called on every load, so a typo
 * made before a paid run stops the engine or the run at its start, naming the key, instead of switching a cap off.
 */
export function checkConfig(raw: unknown, file = "board/config.yaml"): BoardConfig {
  const fail = (message: string) => { throw new ConfigError(`${file}: ${message}`) }
  const config = (raw && typeof raw === "object" ? raw : fail("not a YAML mapping")) as BoardConfig
  const meeting = (config.meeting && typeof config.meeting === "object" ? config.meeting : fail("the meeting: section is missing")) as Record<string, unknown>
  const limit = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0
  const say = (key: string, v: unknown) => fail(`meeting.${key} must be a number of 0 or more, not ${v === undefined ? "missing" : JSON.stringify(v)}. A limit that is not a number is never reached, so it would not limit anything.`)
  for (const key of REQUIRED_LIMITS) if (!limit(meeting[key])) say(key, meeting[key])
  for (const key of OPTIONAL_LIMITS) if (meeting[key] !== undefined && meeting[key] !== null && !limit(meeting[key])) say(key, meeting[key])
  if (!Array.isArray(config.board) || !config.board.every((n) => typeof n === "string")) fail("board: must be a list of member names")
  if (!config.board.includes("scout")) fail("board: must include scout, the member that gathers the sources. Without it a review gathers no sources")
  if (!config.board.includes(VERIFIER)) fail(`board: must include ${VERIFIER}, which rechecks the scout's sources in every review. Without it one wrong source reaches every member unchecked`)
  return config
}

export const path = (config: BoardConfig, key: keyof BoardConfig["paths"], ...rest: string[]) =>
  resolve(ROOT, config.paths[key], ...rest)

/**
 * Scripted (mock) mode for the drug board: while paid calls are off (NO_PAID_CALLS, see paid.ts), or with
 * DRUG_BOARD_MOCK=1. Otherwise the board is real: it calls Anthropic and OpenAI directly (models.ts), and the keys
 * its tiers need must be present. A missing key is NOT a reason to go scripted: assertBoardKeys (providers.ts)
 * refuses the run at its start, naming the tier and the key, so a run that looks real is never scripted.
 * In scripted mode nothing paid is called: Exa, the first-pass checker and the escalation checkers are scripted,
 * and so are the agents unless a local model is chosen (LOCAL below).
 */
export const mockMode = (env: NodeJS.ProcessEnv = process.env): boolean => paidCallsOff(env) || env.DRUG_BOARD_MOCK === "1"
/**
 * The engine's mode NOW. A live binding: it is recomputed when the paid switch changes (paid.ts), so a module that reads
 * MOCK at call time sees the current mode. A board run does NOT follow it once started: it keeps the mode it began with
 * (run.json `mock`), so a real run is never turned scripted, and a scripted run never real, by flipping the switch.
 */
export let MOCK = mockMode()
onPaidChange(() => { MOCK = mockMode() })

/**
 * The local model the board's agents run on, as `ollama/<name>`, or undefined. Set DRUG_BOARD_LOCAL_MODEL to an id
 * (ollama/qwen2.5:14b) to use that model for every agent, or to 1 to use `local_models` of board/config.yaml per
 * tier (then this is the lead's). It works while paid calls are off, and without any provider key.
 *
 * A local board run is a scripted run with real agents: MOCK stays true, so Exa search returns the fixture
 * papers, and the first-pass and escalation checkers return their scripted verdicts. Only the agents' text is real.
 * Throws when the value is not a local model (local.ts): a typo must not fall back to scripted or paid models.
 */
export function localBoardModel(env: NodeJS.ProcessEnv = process.env, config?: Pick<BoardConfig, "local_models">): string | undefined {
  const raw = (env.DRUG_BOARD_LOCAL_MODEL ?? "").trim()
  if (!raw || raw === "0") return undefined
  const id = raw === "1" ? `ollama/${(config ?? loadConfig()).local_models?.lead ?? ""}` : raw
  if (!isLocalModel(id, env)) throw new Error(`DRUG_BOARD_LOCAL_MODEL: ${localRefusal(id, env) ?? `${id} is not a local model id (ollama/<name>)`}`)
  return id
}
export const LOCAL = localBoardModel()
