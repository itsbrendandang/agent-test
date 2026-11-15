// "Your profile": a name, an organisation or client, and an optional role, typed once in Settings. The app has no
// accounts and no login: this is a label for the person at this browser, nothing more. It is kept in this browser
// only (localStorage) and is never sent to the engine or anywhere else.
import { useSyncExternalStore } from "react"

export interface Profile { name: string; organisation: string; role: string }

const KEY = "app.profile"
const CHANGED = "app.profile.changed"
const LIMIT = { name: 60, organisation: 80, role: 60 } as const
const tidy = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "")

let cache: { raw: string | null; profile: Profile | undefined } = { raw: null, profile: undefined }
/** The stored profile, or undefined when none is set (or what is stored cannot be read, or has no name). */
export function readProfile(): Profile | undefined {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* private mode: no profile */ }
  if (raw === cache.raw) return cache.profile // the same object until the stored text changes
  let profile: Profile | undefined
  try {
    const saved = raw ? (JSON.parse(raw) as Partial<Profile> | null) : null
    const name = tidy(saved?.name, LIMIT.name)
    profile = name ? { name, organisation: tidy(saved?.organisation, LIMIT.organisation), role: tidy(saved?.role, LIMIT.role) } : undefined
  } catch { profile = undefined }
  cache = { raw, profile }
  return profile
}
/** Save it in this browser. A profile needs a name; returns what was stored, or undefined when the name is empty. */
export function saveProfile(input: { name: string; organisation?: string; role?: string }): Profile | undefined {
  const profile: Profile = { name: tidy(input.name, LIMIT.name), organisation: tidy(input.organisation, LIMIT.organisation), role: tidy(input.role, LIMIT.role) }
  if (!profile.name) return undefined
  try { localStorage.setItem(KEY, JSON.stringify(profile)) } catch { /* private mode: it lasts for this page only */ }
  window.dispatchEvent(new Event(CHANGED))
  return profile
}
export function clearProfile() {
  try { localStorage.removeItem(KEY) } catch { /* nothing to remove */ }
  window.dispatchEvent(new Event(CHANGED))
}
const subscribe = (fn: () => void) => {
  window.addEventListener(CHANGED, fn); window.addEventListener("storage", fn)
  return () => { window.removeEventListener(CHANGED, fn); window.removeEventListener("storage", fn) }
}
/** The profile, following Save and Clear at once (also from another tab). */
export const useProfile = (): Profile | undefined => useSyncExternalStore(subscribe, readProfile, () => undefined)

/** Up to two letters for the avatar: "Brendan Dang" -> "BD", "brendan" -> "B". */
export const initials = (name: string): string => {
  const words = name.split(/[\s\-_.]+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words
  return letters.map((w) => [...w][0] ?? "").join("").toUpperCase()
}
/** The second line of the profile row when no organisation was given. */
export const NO_ORGANISATION = "This computer"
