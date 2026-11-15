/** A run another view should open on its next mount (set by Experiments and Home). Read once, then cleared. */
export function takeOpen(kind: "swarm" | "board"): string | undefined {
  const key = `open.${kind}`
  const id = sessionStorage.getItem(key) ?? undefined
  if (id) window.setTimeout(() => sessionStorage.removeItem(key), 0) // after React's double call in development
  return id
}
/** Ask the Swarm or Board view to open this run when it mounts. The caller then switches to that view. */
export const setOpen = (kind: "swarm" | "board", id: string) => sessionStorage.setItem(`open.${kind}`, id)
/** The view that shows a run of this kind. */
export const viewOfKind = (kind: "swarm" | "board") => (kind === "swarm" ? "Compare" : "Board") as "Compare" | "Board"
