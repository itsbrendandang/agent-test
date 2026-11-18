// Local-model ids and server addresses for the drug board and paid-model checks.
//
// One definition, the same as the Python side's (glhf/bixbench/src/bixbench3/paid.py):
//   - the id is `ollama/<name>`, where <name> is an Ollama model name (`qwen2.5:14b`, `user/model:tag`) and not one
//     of Ollama's cloud models (`...:cloud`, `...-cloud`), which the local server forwards to ollama.com;
//   - and the server it is sent to is on this machine: LOCAL_MODEL_URL, else OLLAMA_BASE_URL, else
//     http://127.0.0.1:11434, must name a loopback address (localhost, 127.x.x.x, ::1).
// An address on another machine is not free and private by assumption: it may be someone's paid or logging
// endpoint, and Ollama on a network has no authentication. It is refused unless LOCAL_MODEL_ALLOW_REMOTE=1 says the
// person owns that host. See docs/local-model.md.
//
// This module validates models and addresses. Callers decide whether a run may start.
import "./env.ts" // first: LOCAL_MODEL_URL may be in .env

export const LOCAL_PREFIX = "ollama/"
export const DEFAULT_LOCAL_URL = "http://127.0.0.1:11434"
const PART = "[A-Za-z0-9][A-Za-z0-9._-]{0,79}"
const LOCAL_NAME = new RegExp(`^(?:${PART}/)?${PART}(?::${PART})?$`)
const CLOUD = /(?:^|[:-])cloud$/i

export type ModelClass = "scripted" | "local" | "paid"
type Env = NodeJS.ProcessEnv

/** A local-model server that was refused: on another machine without LOCAL_MODEL_ALLOW_REMOTE=1, or not an address. */
export class LocalModelRefused extends Error {}

/**
 * The Ollama name in `ollama/<name>`, or undefined when the id is not of that form. Only the form is checked:
 * not `openai/ollama`, not `ollama/../openai/gpt`, nothing with spaces, and not a cloud model.
 */
export function localName(model: unknown): string | undefined {
  if (typeof model !== "string" || !model.startsWith(LOCAL_PREFIX)) return undefined
  const name = model.slice(LOCAL_PREFIX.length)
  return LOCAL_NAME.test(name) && !name.includes("..") && !CLOUD.test(name) ? name : undefined
}

/** Does this http(s) URL name this machine: localhost, 127.x.x.x or ::1. */
export function isLoopback(url: string): boolean {
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return false
  const host = parsed.hostname // WHATWG: lower case, and 2130706433 or 0x7f.1 already written as 127.0.0.1
  return host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

export interface LocalServer { /** Without a trailing /v1. */ url: string; /** On another machine, allowed by LOCAL_MODEL_ALLOW_REMOTE=1. */ remote: boolean; host: string }

/**
 * Where a local model is served: LOCAL_MODEL_URL, else OLLAMA_BASE_URL, else this machine's port 11434.
 * Throws LocalModelRefused for an address on another machine without LOCAL_MODEL_ALLOW_REMOTE=1.
 */
export function localServer(env: Env = process.env): LocalServer {
  const name = env.LOCAL_MODEL_URL?.trim() ? "LOCAL_MODEL_URL" : env.OLLAMA_BASE_URL?.trim() ? "OLLAMA_BASE_URL" : ""
  const url = (name ? env[name]!.trim() : DEFAULT_LOCAL_URL).replace(/(\/v1)?\/*$/, "")
  let parsed: URL | undefined
  try { parsed = new URL(url) } catch { /* refused below */ }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) throw new LocalModelRefused(`${name} is not an http address of a model server: refused.`)
  if (isLoopback(url)) return { url, remote: false, host: parsed.hostname }
  if (parsed.username || parsed.password) throw new LocalModelRefused(`${name} holds a user name or password: refused.`)
  if (env.LOCAL_MODEL_ALLOW_REMOTE?.trim() === "1") return { url, remote: true, host: parsed.hostname }
  throw new LocalModelRefused(`a local model served from ${parsed.hostname} (${name}): refused. That address is not this machine, so the model is not known to be free or private. Reach the other machine through an SSH tunnel to its 127.0.0.1:11434 (docs/local-model.md), or set LOCAL_MODEL_ALLOW_REMOTE=1 if the host is yours and the network between is private.`)
}

/** Why `ollama/...` id is not a local model here, or undefined when it is one (or is not an ollama id at all). */
export function localRefusal(model: string, env: Env = process.env): string | undefined {
  if (typeof model !== "string" || !model.startsWith(LOCAL_PREFIX)) return undefined
  if (localName(model) === undefined) return `${model} is not a local model id (ollama/<name>, and not one of Ollama's cloud models)`
  try { localServer(env) } catch (error) { return (error as Error).message }
  return undefined
}

/** A local model: `ollama/<name>` and a server that passes localServer. */
export const isLocalModel = (model: unknown, env: Env = process.env): boolean =>
  localName(model) !== undefined && localRefusal(model as string, env) === undefined

export const isScripted = (model: unknown): boolean => model === "mock" || (typeof model === "string" && model.startsWith("mockllm/"))
