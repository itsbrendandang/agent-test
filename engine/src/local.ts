// Local models: a real model that costs nothing and sends nothing off this machine. The third class of model,
// beside the scripted one ("mock") and the paid ones.
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
// This module makes no decision about NO_PAID_CALLS; paid.ts asks it (modelSpends, refusePaidModel there).
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

/** "scripted" (no model is called), "local" (a real model on this machine) or "paid" (everything else, also an ollama id whose server was refused). */
export const modelClass = (model: string, env: Env = process.env): ModelClass => isScripted(model) ? "scripted" : isLocalModel(model, env) ? "local" : "paid"

/** How a run with this model is named to a reader: "scripted model", "local model (qwen2.5:14b)", "paid model (openai/gpt-5.5)". */
export function modelLabel(model: string, env: Env = process.env): string {
  const kind = modelClass(model, env)
  if (kind === "scripted") return "scripted model"
  if (kind === "paid") return `paid model (${model})`
  const server = localServer(env)
  return `local model (${localName(model)}${server.remote ? ` at ${server.host}` : ""})`
}

/** The class and label of a run, from its model and role models: paid if any is paid, else local if any is local. */
export function runModelClass(run: { model: string; roleModels?: Record<string, string> }, env: Env = process.env): { modelClass: ModelClass; modelLabel: string } {
  const all = [run.model, ...Object.values(run.roleModels ?? {})]
  const classes = all.map((m) => modelClass(m, env))
  const kind: ModelClass = classes.includes("paid") ? "paid" : classes.includes("local") ? "local" : "scripted"
  const named = all.find((m, i) => classes[i] === kind) ?? run.model
  const others = new Set(all.filter((m) => m !== named)).size
  return { modelClass: kind, modelLabel: modelLabel(named, env) + (others ? ` and ${others} other${others > 1 ? "s" : ""}` : "") }
}

/** What a run with this model costs, for a line next to its token budget. Local and scripted models: nothing. */
export const costNote = (model: string, env: Env = process.env): string =>
  ({ scripted: "scripted, free", local: "local, free", paid: "paid: billed by the provider" })[modelClass(model, env)]

// ── Discovery: what the Ollama server on this machine can run ────────────────────────────────────────────────────

/** An entry of the model catalogue (GET /api/glhf/status, `localModels`). */
export interface LocalModel {
  /** The id to start a run with: `ollama/qwen2.5:14b`. */
  id: string
  local: true
  cost: "free"
  /** Size of the weights on disk, in GB. In memory it takes this plus the context (about 15 GB for a 9 GB model at 32k). */
  sizeGb: number
  /** Tokens the model was trained for; the server may load it with fewer (`loadedContext`). 0 when the server did not say. */
  contextWindow: number
  /** Context the server has this model loaded with right now, when it is loaded. */
  loadedContext?: number
  /** "14.8B", "Q4_K_M": as Ollama reports them. */
  parameters?: string
  quantization?: string
  /** "local model (qwen2.5:14b)". */
  label: string
}

interface Tag { name?: string; model?: string; size?: number; remote_host?: string; remote_model?: string; capabilities?: string[]; details?: { parameter_size?: string; quantization_level?: string; context_length?: number } }
interface Shown { capabilities?: string[]; model_info?: Record<string, unknown>; remote_host?: string }
type Fetch = typeof fetch

const TIMEOUT_MS = 1_500
const CACHE_MS = 15_000
let cached: { at: number; key: string; models: LocalModel[] } | undefined
/** Forget the cached list (tests). */
export const forgetLocalModels = () => { cached = undefined }

async function getJson<T>(fetcher: Fetch, url: string, body?: unknown): Promise<T | undefined> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) })
    return response.ok ? await response.json() as T : undefined
  } catch { return undefined }
}

/**
 * The local models a run can use now: what Ollama's /api/tags lists, without cloud models and without models that
 * cannot call tools (every solver here works through tools). Empty when the server is down, slow (1.5 s) or was
 * refused by localServer. Cached for 15 s. Never throws.
 */
export async function discoverLocalModels(env: Env = process.env, fetcher: Fetch = fetch, now = Date.now()): Promise<LocalModel[]> {
  let server: LocalServer
  try { server = localServer(env) } catch { return [] }
  if (cached && cached.key === server.url && now - cached.at < CACHE_MS) return cached.models
  const [tags, ps] = await Promise.all([
    getJson<{ models?: Tag[] }>(fetcher, `${server.url}/api/tags`),
    getJson<{ models?: { name?: string; context_length?: number }[] }>(fetcher, `${server.url}/api/ps`),
  ])
  const models: LocalModel[] = []
  for (const tag of tags?.models ?? []) {
    const name = tag.name ?? tag.model
    if (!name || tag.remote_host || tag.remote_model) continue
    const id = LOCAL_PREFIX + name.replace(/:latest$/, "")
    if (localName(id) === undefined) continue
    let capabilities = tag.capabilities, context = tag.details?.context_length
    if (!capabilities || !context) { // older servers list neither in /api/tags
      const shown = await getJson<Shown>(fetcher, `${server.url}/api/show`, { model: name })
      if (shown?.remote_host) continue
      capabilities ??= shown?.capabilities
      context ??= Number(Object.entries(shown?.model_info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1] ?? 0)
    }
    if (!capabilities?.includes("tools")) continue
    const loaded = ps?.models?.find((m) => m.name === name)?.context_length
    models.push({
      id, local: true, cost: "free", sizeGb: Math.round((tag.size ?? 0) / 1e8) / 10, contextWindow: context || 0,
      ...(loaded ? { loadedContext: loaded } : {}),
      ...(tag.details?.parameter_size ? { parameters: tag.details.parameter_size } : {}),
      ...(tag.details?.quantization_level ? { quantization: tag.details.quantization_level } : {}),
      label: `local model (${localName(id)}${server.remote ? ` at ${server.host}` : ""})`,
    })
  }
  models.sort((a, b) => b.sizeGb - a.sizeGb) // the largest first: on one machine it is usually the best
  if (tags) cached = { at: now, key: server.url, models } // a server that did not answer is asked again next time
  return models
}
