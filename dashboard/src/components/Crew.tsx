// The characters as decoration, and the one loading look of the app. Both are aria-hidden art beside real text.
import type { ReactNode } from "react"
import { MASCOTS, reducedMotion, useCharacters } from "@/crew/store"
import { Loader } from "./ai-elements/loader"
import { Buddy } from "./Buddy"
import type { Mood } from "./species"

/** Momo, Ember, Fuji and Sage in a row. Decoration only: hidden from screen readers, and gone when characters are off. */
export function Mascots({ mood = "happy", size = 56, className = "" }: { mood?: Mood; size?: number; className?: string }) {
  const shown = useCharacters()
  if (!shown) return null
  return (
    <span className={`mascots ${className}`} data-mood={mood} data-still={reducedMotion() || undefined} aria-hidden="true">
      {MASCOTS.map((m, i) => <span key={m.id} className="mascot" style={{ animationDelay: `${i * 160}ms` }}><Buddy species={m.species} mood={mood} size={size} /></span>)}
    </span>
  )
}

/**
 * The waiting state used everywhere something is loading or in progress: the characters at work, and beside them
 * the status in plain text. The text is the status (role="status"); the characters only keep it company, so with
 * characters off this is the text with a small spinner.
 */
export function Loading({ children, size = 40, className = "" }: { children: ReactNode; size?: number; className?: string }) {
  const shown = useCharacters()
  return (
    <div className={`loading ${className}`}>
      {shown ? <Mascots mood="working" size={size} /> : <span aria-hidden="true" className="loading-spin"><Loader size={14} /></span>}
      <p className="loading-text" role="status">{children}</p>
    </div>
  )
}
