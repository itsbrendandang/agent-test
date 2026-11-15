// The kill switch for everything that costs money: NO_PAID_CALLS.
//
// It is ON unless a person writes NO_PAID_CALLS=0 in .env (or exports it). While it is on, the engine refuses,
// before any network call or paid subprocess:
//   - GLHF runs with a paid model, local or cloud, and Exa search on a run   (glhf/tracker.ts, glhf/task.ts)
//   - the drug board with paid models: it runs with scripted models, or with a local model when
//     DRUG_BOARD_LOCAL_MODEL names one                                       (config.ts MOCK and LOCAL, board.ts, models.ts)
//   - the board's first-pass checker, its OpenAI and Claude Code checkers, and its Exa search   (triage.ts, checkers.ts, exa.ts)
//   - the model call behind POST /api/ask: it answers by keyword search      (ask.ts)
// and every process the engine starts for a run gets the provider keys blanked (childEnv below), so a mistake
// further down, in the Python runner, has no key to spend with. That is also what keeps past.dev out of reach.
//
// What stays allowed: the scripted model, and a local model. A local model is `ollama/<name>` served from this
// machine (local.ts has the one definition): it is a real model, but it costs nothing and sends nothing off the
// machine, so the switch has nothing to protect. modelSpends() below is the question to ask about a model id; a
// model on another machine is not local unless LOCAL_MODEL_ALLOW_REMOTE=1. The keys stay blank during such a run.
//
// This is the only module that reads the variable. Ask paidCallsOff(), or call refusePaid() right before the
// paid step. Not covered: a person who runs the Python CLI (uv run bixbench3 ..., python -m bixbench3...) or
// any other program directly. That does not go through the engine, and it reads .env on its own.
import "./env.ts" // first: NO_PAID_CALLS=0 may be in .env
import { isLocalModel, isScripted, localName, localRefusal } from "./local.ts"

/** True unless NO_PAID_CALLS is exactly "0". Unset, empty, "1", "true", "off" or a typo all mean: no paid calls. */
export const paidCallsOff = (env: NodeJS.ProcessEnv = process.env): boolean => (env.NO_PAID_CALLS ?? "").trim() !== "0"

export const HOW_TO_ALLOW = "Paid calls are off (NO_PAID_CALLS). Only the person who pays may turn them on: set NO_PAID_CALLS=0 in .env and restart the engine."

/** A paid step was refused because the switch is on. */
export class PaidCallsOff extends Error {
  /** `whole`: `what` is the whole message (a refusal that NO_PAID_CALLS=0 is not the answer to). */
  constructor(what: string, whole = false) { super(whole ? what : `${what}: refused. ${HOW_TO_ALLOW}`) }
}

/** Call right before anything that spends: throws PaidCallsOff while the switch is on. `what` names the step. */
export function refusePaid(what: string, env: NodeJS.ProcessEnv = process.env): void {
  if (paidCallsOff(env)) throw new PaidCallsOff(what)
}

/** Can a call to this model cost money or leave the machine? False for the scripted model and for a local model (local.ts). */
export const modelSpends = (model: string, env: NodeJS.ProcessEnv = process.env): boolean => !isScripted(model) && !isLocalModel(model, env)

/**
 * Why these models may not run while the switch is on, or undefined when they may: all of them scripted or local.
 * An `ollama/...` id that fails the local test (a look-alike, a cloud model, a server on another machine) is
 * answered with that reason. With the switch off: undefined.
 */
export function paidModelRefusal(models: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!paidCallsOff(env)) return undefined
  for (const model of models) {
    const why = localRefusal(model, env) // an ollama/... id that is not a local model here
    if (why) return localName(model) === undefined ? `${why}, and other models are paid: refused. ${HOW_TO_ALLOW}` : why
  }
  const paid = models.filter((model) => modelSpends(model, env))
  return paid.length ? `a run with a paid model (${paid.join(", ")}): refused. Only the scripted model "mock" and local models (ollama/<name> on this machine) may run. ${HOW_TO_ALLOW}` : undefined
}

/** Throws PaidCallsOff when paidModelRefusal has a reason. Call before a run with these models is started. */
export function refusePaidModels(models: string[], env: NodeJS.ProcessEnv = process.env): void {
  const why = paidModelRefusal(models, env)
  if (why) throw new PaidCallsOff(why, true)
}

/** For `npm run doctor` and the server's first line. */
export const paidCallsLine = (env: NodeJS.ProcessEnv = process.env): string => paidCallsOff(env)
  ? "Paid calls: OFF (NO_PAID_CALLS). Paid models, Exa, the checkers and cloud runs are refused; scripted (mock) runs and local models (ollama/<name> on this machine) work. To allow the rest, set NO_PAID_CALLS=0 in .env."
  : "Paid calls: ON (NO_PAID_CALLS=0). Runs with real models, Exa, the checkers and cloud runs can spend API credits."

/**
 * The keys that can spend, or that open a paid or gated service. OPENROUTER_API_KEY and TYPESAFE_API_KEY are
 * blanked defensively: no provider in this project uses them any more, but a stray one in someone's .env must not
 * reach a child process while paid calls are off. They are NOT a key a run needs and are not in any status or catalog report.
 */
export const PAID_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "EXA_API_KEY", "PAST_API_KEY", "HF_TOKEN", "TINKER_API_KEY", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY"] as const

// Inspect, which the Python runner is built on, loads the nearest .env above its working folder, and that is this
// repo's .env. It does not replace a variable that is already set, so the keys are set to "" here rather than
// removed: removed keys would be read back from .env. Inside VS Code Inspect does replace set variables, so what
// makes it think it is in VS Code is removed too, and so is uv's own env file.
const DOTENV_OVERRIDES = ["VSCODE_IPYTHON_KERNEL", "VSCODE_CLI_REQUIRE_TOKEN", "VSCODE_PID", "VSCODE_CWD", "UV_ENV_FILE"]

/**
 * The environment for a process the engine starts (the local runner, bixbench3, uv). While the switch is on, the
 * keys in PAID_KEYS are blank in it and NO_PAID_CALLS=1 is passed on. With the switch off it is `env` unchanged.
 * (The address of a local model server is checked again, and pinned, by the Python runner: paid.py `use_local`.)
 */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!paidCallsOff(env)) return env
  const out: NodeJS.ProcessEnv = { ...env, NO_PAID_CALLS: "1" }
  for (const key of PAID_KEYS) out[key] = ""
  for (const key of DOTENV_OVERRIDES) delete out[key]
  if (out.TERM_PROGRAM === "vscode") delete out.TERM_PROGRAM
  return out
}
