// The quiet "something is happening" line of the Research conversation: a small spinner and the status in text.
// The text is the status; the spinner is decoration and stops under reduced motion. No characters here.
import type { ReactNode } from "react"
import { Loader } from "@/components/ai-elements/loader"

export function Working({ children }: { children: ReactNode }) {
  return (
    <div className="working" role="status">
      <span className="working-spin" aria-hidden="true"><Loader size={14} /></span>
      <span>{children}</span>
    </div>
  )
}
