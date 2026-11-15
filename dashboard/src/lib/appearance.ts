import { useSyncExternalStore } from "react"

export type Appearance = "light" | "dark" | "system"
export const APPEARANCE_KEY = "app.appearance"
const listeners = new Set<() => void>()
const valid = (value: unknown): Appearance => value === "dark" || value === "system" ? value : "light"
function read(): Appearance {
  try { return valid(localStorage.getItem(APPEARANCE_KEY)) } catch { return "light" }
}
let choice = read()
const notify = () => listeners.forEach((fn) => fn())
function apply() {
  document.documentElement.classList.toggle("dark", choice === "dark" || (choice === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches))
  notify()
}
export function setAppearance(value: Appearance) {
  choice = value
  try { localStorage.setItem(APPEARANCE_KEY, value) } catch { /* keep the choice for this page */ }
  apply()
}
export function startAppearance() {
  choice = read(); apply()
  const media = window.matchMedia?.("(prefers-color-scheme: dark)")
  const storage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_KEY || event.key === null) { choice = read(); apply() }
  }
  media?.addEventListener("change", apply)
  window.addEventListener("storage", storage)
  return () => { media?.removeEventListener("change", apply); window.removeEventListener("storage", storage) }
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const useAppearance = (): Appearance => useSyncExternalStore(subscribe, () => choice, () => "light")
export const useDarkAppearance = (): boolean => useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"), () => false)
