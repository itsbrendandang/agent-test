// The engine's session token. Anything that can spend money needs it: the engine answers 401
// {error, field: "token", needsToken: true} without it. A person copies it from the file the engine names when it
// starts (glhf/runs/.token) and pastes it once. It is kept in sessionStorage only, so it is gone when the tab closes;
// it is never written to localStorage, never logged, never shown again, and sent only to the engine, as the
// x-glhf-token header of requests that change something (never on reads).
import { useSyncExternalStore } from "react"

const KEY = "glhf.token"
export const TOKEN_FILE = "glhf/runs/.token"
export const TOKEN_HEADER = "x-glhf-token"

const listeners = new Set<() => void>()
const changed = () => { for (const tell of listeners) tell() }
const subscribe = (tell: () => void) => { listeners.add(tell); return () => { listeners.delete(tell) } }

export const getToken = (): string | undefined => { try { return sessionStorage.getItem(KEY) || undefined } catch { return undefined } }
/** Why this cannot be a token, or undefined when it can be kept. */
export const refuseToken = (text: string): string | undefined => {
  const t = text.trim()
  if (!t) return "Paste the token first."
  if (/\s/.test(t) || t.length > 200) return "A token is one short line without spaces. Copy the whole content of the file, and nothing else."
  return undefined
}
export const keepToken = (text: string) => { try { sessionStorage.setItem(KEY, text.trim()) } catch { /* storage off: the next request asks again */ } changed() }
export const forgetToken = () => { try { sessionStorage.removeItem(KEY) } catch { /* nothing to forget */ } changed() }
/** Is a token held for this session? For Settings, which offers to forget it. */
export const useHasToken = (): boolean => useSyncExternalStore(subscribe, () => getToken() !== undefined)

// One question at a time: the prompt (TokenPrompt, mounted once in the shell) shows `asking` and answers it.
export interface Asking { why: string; rejected: boolean }
let asking: Asking | undefined
let waiting: ((token: string | undefined) => void)[] = []
export const useAsking = (): Asking | undefined => useSyncExternalStore(subscribe, () => asking)
/** The person's answer: a token, or undefined for "not now". Every request that was waiting gets it. */
export function answer(token: string | undefined) {
  if (token !== undefined) keepToken(token)
  const all = waiting
  waiting = []; asking = undefined
  changed()
  for (const tell of all) tell(token?.trim())
}
function ask(why: string, rejected: boolean): Promise<string | undefined> {
  return new Promise((tell) => {
    waiting.push(tell)
    if (!asking) { asking = { why, rejected }; changed() }
  })
}

const needsToken = async (r: Response): Promise<string | undefined> => {
  if (r.status !== 401) return undefined
  const body = (await r.clone().json().catch(() => ({}))) as { needsToken?: unknown; error?: unknown }
  return body?.needsToken === true ? (typeof body.error === "string" ? body.error : "The engine asked for its session token.") : undefined
}
const withToken = (init: RequestInit | undefined, token: string | undefined): RequestInit | undefined =>
  token ? { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), [TOKEN_HEADER]: token } } : init

/**
 * fetch for requests that change something on the engine (start, cancel, resume, chat, Ask). Sends the token when one
 * is held. If the engine answers that it needs a token, asks the person once and tries again with what they pasted.
 * A token the engine does not accept is forgotten and asked for once more. "Not now" gives back the engine's 401.
 */
export async function engineFetch(url: string, init?: RequestInit): Promise<Response> {
  let reply = await fetch(url, withToken(init, getToken()))
  for (let attempt = 0; attempt < 2; attempt++) {
    const why = await needsToken(reply)
    if (why === undefined) return reply
    const rejected = getToken() !== undefined || attempt > 0
    if (rejected) forgetToken()
    const token = await ask(why, rejected)
    if (token === undefined) return reply
    reply = await fetch(url, withToken(init, token))
  }
  if (await needsToken(reply)) forgetToken() // still refused: do not keep a token that does not work
  return reply
}
