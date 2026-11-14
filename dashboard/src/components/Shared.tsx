// Small pieces every engine-backed view uses, so titles, status words and the offline state look the same everywhere.
import type { ReactNode } from "react"
import { HOW_TO_TURN_ON, PAID_LABEL, type PaidState } from "@/lib/paid"
import { STATE_KIND, type RunState } from "@/lib/status"

/** Page title with one sentence that says what the view is for. Controls go in `children`. */
export function PageHead({ title, about, children }: { title: string; about: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p className="muted small">{about}</p>
      </div>
      {children && <div className="page-tools">{children}</div>}
    </header>
  )
}

export function StatusPill({ state }: { state: RunState }) {
  return <span className="pill status-pill" data-kind={STATE_KIND[state]}>{state}</span>
}

/** A long id cut to fit, with the whole id on hover and for screen readers. */
export function RunId({ id }: { id: string }) {
  return <code className="run-id" title={id} aria-label={id}>{id}</code>
}

/** Shown by every view that needs the engine when it cannot be reached. */
export function EngineOffline({ needs, onRetry }: { needs: string; onRetry?: () => void }) {
  return (
    <div className="engine-offline card-surface" role="alert">
      <h2>Engine not running</h2>
      <p className="muted">{needs} Start the engine from the repo root with <code>npm run engine</code>.</p>
      {onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
    </div>
  )
}

/** Always on screen: may the engine spend money? Opens Settings, which says how a person changes it. */
export function PaidIndicator({ state, onOpen }: { state: PaidState; onOpen: () => void }) {
  return (
    <button type="button" className="paid-indicator" data-state={state} onClick={onOpen}
      title={state === "unknown" ? "The engine did not say whether paid calls are allowed. It may be offline." : HOW_TO_TURN_ON}>
      <span aria-hidden="true" />{PAID_LABEL[state]}
    </button>
  )
}
