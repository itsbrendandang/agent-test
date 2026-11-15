// Small pieces every engine-backed view uses, so titles, status words and the offline state look the same everywhere.
import type { ReactNode } from "react"
import type { Scripted } from "@/lib/scripted"
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

/**
 * How a result was made, from the run itself: by scripted models (fixed text, no research) or by real ones. Shown
 * next to every result. Nothing is shown while the run has not said.
 */
export function ModeLabel({ scripted, demo }: { scripted: Scripted; demo?: boolean }) {
  if (scripted === undefined && !demo) return null
  return (
    <span className="pill mode-label" data-kind={scripted ? "neutral" : scripted === false ? "info" : "warning"} data-mode={scripted ? "scripted" : scripted === false ? "real" : "demo"}>
      {scripted ? "scripted: fixed text, not research" : scripted === false ? "real model" : ""}{demo ? `${scripted === undefined ? "" : " · "}demo case` : ""}
    </span>
  )
}
