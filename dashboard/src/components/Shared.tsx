// Small pieces every engine-backed view uses, so titles, status words and the offline state look the same everywhere.
import { useEffect, useSyncExternalStore, type ReactNode } from "react"
import type { Scripted } from "@/lib/scripted"
import { retryEngine, type Shell } from "@/lib/shell"
import { STATE_KIND, type RunState } from "@/lib/status"


import type { Verdict as BoardVerdict } from "@/board/api"
import { outcomeOf } from "@/lib/verdict"
import { PRACTICE, VERDICT_WORD, verdictCount } from "@/lib/words"
import type { ClaimVerdict } from "@/swarm/api"

/**
 * The top of a view: one short line that says what the view is for, and its controls (`children`). The place name
 * is in the shell's header row, so the title here is for screen readers and for the document outline only.
 */
export function PageHead({ title, about, children }: { title: string; about: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="sr-only">{title}</h1>
        <p className="page-about">{about}</p>
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

// How many EngineOffline cards are on screen. While a view says it itself, the shell's notice is not shown as well.
const cards = { n: 0, listeners: new Set<() => void>(), tell() { for (const l of this.listeners) l() } }
const watchCards = (l: () => void) => { cards.listeners.add(l); return () => { cards.listeners.delete(l) } }

/**
 * The shell's notice: shown in the page, above the view, only while the engine cannot be reached or answers with an
 * error, and only when the view is not already saying so with its own card. One action: Try again.
 */
export function EngineNotice({ shell }: { shell: Shell }) {
  const shown = useSyncExternalStore(watchCards, () => cards.n, () => 0)
  if ((shell.engine !== "offline" && shell.engine !== "error") || shown > 0) return null
  return (
    <div className="engine-notice" role="alert">
      {shell.engine === "offline"
        ? <span><b>Engine offline.</b> The app's engine isn't running. Start it with <code>npm start</code>, then try again.</span>
        : <span><b>The engine answered with an error.</b> {shell.said}</span>}
      <button type="button" className="btn" onClick={retryEngine}>Try again</button>
    </div>
  )
}

/**
 * Shown by every view that needs the engine and did not get what it asked for. Two cases, never mixed up:
 * the engine cannot be reached ("Engine not running"), or it answered with an error (`said`, its own words, as text).
 */
export function EngineOffline({ needs, said, onRetry }: { needs: string; said?: string; onRetry?: () => void }) {
  useEffect(() => { cards.n++; cards.tell(); return () => { cards.n--; cards.tell() } }, []) // the shell's own notice steps aside
  return (
    <div className="engine-offline card-surface" role="alert">
      {said ? (
        <>
          <h2>Something went wrong inside the app's engine</h2>
          <p>The engine is running, so this is not a connection problem. Press Try again. If it keeps happening, stop the app and start it again with <code>npm start</code>.</p>
        </>
      ) : (
        <>
          <h2>The app's engine isn't running</h2>
          <p>Start it with: <code>npm start</code> (in a terminal, in the project folder). Then press Try again.</p>
        </>
      )}
      {onRetry && <button type="button" className="btn btn-primary" onClick={onRetry}>Try again</button>}
      <details className="engine-details">
        <summary>Details</summary>
        {said && <p className="engine-said">{said}</p>}
        <p className="muted small">{needs}{!said && " The engine is the program that runs the agents and keeps the results; this page could not reach it."}</p>
      </details>
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

/** Where sources came from. Exa is credited only for a live Exa search; a practice run's sources are examples. */
export function SearchCredit({ provider }: { provider: "exa" | "fixture" | "europepmc" | undefined }) {
  if (provider === "exa") return <span className="search-credit" data-provider="exa">Search powered by <a href="https://exa.ai" target="_blank" rel="noopener noreferrer">Exa</a></span>
  if (provider === "fixture") return <span className="search-credit" data-provider="fixture">Example sources (practice run)</span>
  if (provider === "europepmc") return <span className="search-credit" data-provider="europepmc">Found in PubMed and preprints (<a href="https://europepmc.org" target="_blank" rel="noopener noreferrer">Europe PMC</a>)</span>
  return null
}
