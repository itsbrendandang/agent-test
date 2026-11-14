// The kill switch for everything that costs money: NO_PAID_CALLS.
//
// It is ON unless a person writes NO_PAID_CALLS=0 in .env (or exports it). While it is on, the engine refuses,
// before any network call or paid subprocess:
//   - GLHF runs with a real model, local or cloud, and Exa search on a run   (glhf/tracker.ts, glhf/task.ts)
//   - the drug board with real models: it runs with scripted models only     (config.ts MOCK, board.ts, models.ts)
//   - the board's checkers Jev, OpenAI and Claude Code, and its Exa search   (jev.ts, checkers.ts, exa.ts)
//   - the model call behind POST /api/ask: it answers by keyword search      (ask.ts)
// and every process the engine starts for a run gets the provider keys blanked (childEnv below), so a mistake
// further down, in the Python runner, has no key to spend with. That is also what keeps past.dev out of reach.
//
// This is the only module that reads the variable. Ask paidCallsOff(), or call refusePaid() right before the
// paid step. Not covered: a person who runs the Python CLI (uv run bixbench3 ..., python -m bixbench3...) or
// any other program directly. That does not go through the engine, and it reads .env on its own.
import "./env.ts" // first: NO_PAID_CALLS=0 may be in .env

/** True unless NO_PAID_CALLS is exactly "0". Unset, empty, "1", "true", "off" or a typo all mean: no paid calls. */
export const paidCallsOff = (env: NodeJS.ProcessEnv = process.env): boolean => (env.NO_PAID_CALLS ?? "").trim() !== "0"

export const HOW_TO_ALLOW = "Paid calls are off (NO_PAID_CALLS). Only the person who pays may turn them on: set NO_PAID_CALLS=0 in .env and restart the engine."

/** A paid step was refused because the switch is on. */
export class PaidCallsOff extends Error {
  constructor(what: string) { super(`${what}: refused. ${HOW_TO_ALLOW}`) }
}

/** Call right before anything that spends: throws PaidCallsOff while the switch is on. `what` names the step. */
export function refusePaid(what: string, env: NodeJS.ProcessEnv = process.env): void {
  if (paidCallsOff(env)) throw new PaidCallsOff(what)
}

/** For `npm run doctor` and the server's first line. */
export const paidCallsLine = (env: NodeJS.ProcessEnv = process.env): string => paidCallsOff(env)
  ? "Paid calls: OFF (NO_PAID_CALLS). Real models, Exa, the checkers and cloud runs are refused; scripted (mock) runs work. To allow them, set NO_PAID_CALLS=0 in .env."
  : "Paid calls: ON (NO_PAID_CALLS=0). Runs with real models, Exa, the checkers and cloud runs can spend API credits."

/** The keys that can spend, or that open a paid or gated service. */
export const PAID_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "EXA_API_KEY", "PAST_API_KEY", "HF_TOKEN", "TINKER_API_KEY"] as const

// Inspect, which the Python runner is built on, loads the nearest .env above its working folder, and that is this
// repo's .env. It does not replace a variable that is already set, so the keys are set to "" here rather than
// removed: removed keys would be read back from .env. Inside VS Code Inspect does replace set variables, so what
// makes it think it is in VS Code is removed too, and so is uv's own env file.
const DOTENV_OVERRIDES = ["VSCODE_IPYTHON_KERNEL", "VSCODE_CLI_REQUIRE_TOKEN", "VSCODE_PID", "VSCODE_CWD", "UV_ENV_FILE"]

/**
 * The environment for a process the engine starts (the local runner, bixbench3, uv). While the switch is on, the
 * keys in PAID_KEYS are blank in it and NO_PAID_CALLS=1 is passed on. With the switch off it is `env` unchanged.
 */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!paidCallsOff(env)) return env
  const out: NodeJS.ProcessEnv = { ...env, NO_PAID_CALLS: "1" }
  for (const key of PAID_KEYS) out[key] = ""
  for (const key of DOTENV_OVERRIDES) delete out[key]
  if (out.TERM_PROGRAM === "vscode") delete out.TERM_PROGRAM
  return out
}
