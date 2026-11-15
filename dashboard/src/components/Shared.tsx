// Small pieces every engine-backed view uses, so titles, status words and the offline state look the same everywhere.
import type { ReactNode } from "react"
import type { Scripted } from "@/lib/scripted"
import { STATE_KIND, type RunState } from "@/lib/status"

/** Page title with one sentence that says what the view is for. Controls go in `children`. */
import type { Verdict as BoardVerdict } from "@/board/api"
import { outcomeOf } from "@/lib/verdict"
import { PRACTICE, VERDICT_WORD, verdictCount } from "@/lib/words"
import type { ClaimVerdict } from "@/swarm/api"

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
  return <span className="pill" data-kind={STATE_KIND[state]}>{state}</span>
}

/** A long id cut to fit, with the whole id on hover and for screen readers. */
export function RunId({ id }: { id: string }) {
  return <code className="run-id" title={id} aria-label={id}>{id}</code>
}

/**
 * Shown by every view that needs the engine and did not get what it asked for. Two cases, never mixed up:
 * the engine cannot be reached ("Engine not running"), or it answered with an error (`said`, its own words, as text).
 */
export function EngineOffline({ needs, said, onRetry }: { needs: string; said?: string; onRetry?: () => void }) {
  return (
    <div className="engine-offline card-surface" role="alert">
      {said ? (
        <>
          <h2>The engine answered with an error</h2>
          <p className="engine-said">{said}</p>
          <p className="muted">The engine is running; this is an error inside it, not a connection problem. {needs}</p>
        </>
      ) : (
        <>
          <h2>Engine not running</h2>
          <p className="muted">{needs} Start the engine from the repo root with <code>npm run engine</code>.</p>
        </>
      )}
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
    <span className="pill" data-kind={scripted ? "neutral" : scripted === false ? "info" : "warning"} data-mode={scripted ? "scripted" : scripted === false ? "real" : "demo"}>
      {scripted ? PRACTICE : scripted === false ? "real model" : ""}{demo ? `${scripted === undefined ? "" : " · "}demo case` : ""}
    </span>
  )
}

/**
 * What a check found, in plain words with its glyph: "✓ Holds up", "✕ Proven wrong", "? Not enough evidence".
 * The checker's own word (verified, refuted, untested…) is the tooltip and, with `technical`, a small second line.
 */
export function Verdict({ verdict, count, technical }: { verdict: BoardVerdict | ClaimVerdict; count?: number; technical?: boolean }) {
  const outcome = outcomeOf(verdict)
  const cls = verdict === "verified" || verdict === "contradicted" || verdict === "unsupported" || verdict === "unchecked" ? `v-${verdict}` : `sv-${verdict}`
  return (
    <span className={`pill ${cls}`} data-outcome={outcome} title={`The check's own word: ${verdict}`}>
      {count === undefined ? VERDICT_WORD[outcome] : verdictCount(outcome, count)}
      {technical && <span className="pill-tech">{verdict}</span>}
    </span>
  )
}
