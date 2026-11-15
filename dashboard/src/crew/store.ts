// The app's four characters: Momo, Ember, Fuji and Sage. They are decoration: the friendly face of the app on the
// loading screen, on Home and wherever something is loading. They are never the agents that did the work (those
// are named in the conversation and the steppers) and never the only sign of anything: the status is always in
// text beside them. They are off until a person turns them on in Settings ("Show characters"); the choice is remembered.
import { useSyncExternalStore } from "react"
import type { Species } from "@/components/species"

export interface Mascot { id: string; name: string; species: Species }
export const MASCOTS: Mascot[] = [
  { id: "momo", name: "Momo", species: "bunny" },
  { id: "ember", name: "Ember", species: "flame" },
  { id: "fuji", name: "Fuji", species: "mountain" },
  { id: "sage", name: "Sage", species: "sprout" },
]

// "1" = shown, "0" = hidden. With nothing stored they are hidden: since the Lab draws the agents in the same style,
// decoration that looks like agents is off until a person asks for it. A stored choice always wins.
const KEY = "app.characters"
const CHANGED = "app.characters.changed"

export const charactersShown = (): boolean => {
  try { return localStorage.getItem(KEY) === "1" } catch { return false }
}
export const setCharactersShown = (on: boolean) => {
  try { localStorage.setItem(KEY, on ? "1" : "0") } catch { /* private mode: the choice lasts for this page only */ }
  window.dispatchEvent(new Event(CHANGED))
}
const subscribe = (fn: () => void) => {
  window.addEventListener(CHANGED, fn); window.addEventListener("storage", fn)
  return () => { window.removeEventListener(CHANGED, fn); window.removeEventListener("storage", fn) }
}
/** Whether the characters are shown. Follows the Settings toggle at once, also from another tab. */
export const useCharacters = (): boolean => useSyncExternalStore(subscribe, charactersShown, () => false)

/** True when the person asked the system for less motion. The characters are then drawn still. */
export const reducedMotion = (): boolean => typeof window.matchMedia === "function" && !!window.matchMedia("(prefers-reduced-motion: reduce)")?.matches
