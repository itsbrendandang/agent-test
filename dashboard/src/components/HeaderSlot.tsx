// The seam between the shell and a view: the header row belongs to the shell, and a view may put content into two
// places of it. Inside the shell the content is moved there (a portal, so React context and events work as usual).
// Outside the shell (a test that renders one view alone) it is rendered in place, so nothing is lost.
import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

/** "title": right after the place name (conversation title, run status). "actions": the right end (the inspector toggle). */
export type HeaderArea = "title" | "actions"
export type HeaderTargets = Record<HeaderArea, HTMLElement | null>

const HeaderContext = createContext<HeaderTargets | null>(null)
/** The shell provides the two elements of its header row. */
export const HeaderProvider = HeaderContext.Provider

export function HeaderSlot({ area, children }: { area: HeaderArea; children: ReactNode }) {
  const targets = useContext(HeaderContext)
  if (!targets) return <div className="header-slot-inline" data-header-slot={area}>{children}</div>
  const target = targets[area]
  return target ? createPortal(children, target) : null
}
