// Small pieces every engine-backed view uses, so titles, status words and the offline state look the same everywhere.
import { useEffect, useSyncExternalStore, type ReactNode } from "react"
import type { Scripted } from "@/lib/scripted"
import { retryEngine, type Shell } from "@/lib/shell"
import { STATE_KIND, type RunState } from "@/lib/status"


import type { Verdict as BoardVerdict } from "@/board/api"
import { Provenance } from "@/components/Provenance"
import { provenanceOf } from "@/lib/provenance"
import { MARK_ABOUT, MARK_GLYPH, MARK_WORD, markCount, markOf, MARKS } from "@/lib/words"
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
 * How a result was made, from the run itself: the Provenance badge ("Practice" or "Live research"), and for a swarm
 * run on the made-up demo dataset a second small label. Nothing is shown while the run has not said.
 */
export function ModeLabel({ scripted, demo, model }: { scripted?: Scripted; demo?: boolean; model?: string }) {
  return (
    <>
      <Provenance kind={provenanceOf({ scripted, model })} />
      {demo && <span className="pill" data-kind="outline" title="The demo task is a small made-up dataset, used to test that everything works. Its result is not a research result.">Demo task</span>}
    </>
  )
}

/**
 * What a check found: one of the four marks, with its glyph and its word ("✓ Supported", "✕ Contradicted",
 * "? Insufficient evidence", "○ Not checked"). The glyph is in the text, so the mark never rests on colour. The
 * check's own word (verified, refuted, untested…) is in the tooltip and, with `technical`, a small second part.
 * With `count`: "9 supported".
 */
export function MarkChip({ verdict, count, technical }: { verdict: BoardVerdict | ClaimVerdict | string; count?: number; technical?: boolean }) {
  const mark = markOf(verdict)
  return (
    <span className="pill mark" data-mark={mark} title={`${MARK_ABOUT[mark]} The check's own word: ${verdict}.`}>
      <span className="mark-glyph" aria-hidden="true">{MARK_GLYPH[mark]}</span>
      {count === undefined ? MARK_WORD[mark] : markCount(mark, count)}
      {technical && <span className="pill-tech">{verdict}</span>}
    </span>
  )
}

/** The four marks and what each means, behind one short disclosure. `who`: one line on who decides them here. */
export function MarksLegend({ who }: { who?: string }) {
  return (
    <details className="marks-legend">
      <summary>What the marks mean</summary>
      <ul>
        {MARKS.map((m) => <li key={m}><span className="pill mark" data-mark={m}><span className="mark-glyph" aria-hidden="true">{MARK_GLYPH[m]}</span>{MARK_WORD[m]}</span> <span>{MARK_ABOUT[m]}</span></li>)}
      </ul>
      {who && <p>{who}</p>}
    </details>
  )
}

/** The same chip under its older name. */
export const Verdict = MarkChip

/** Where sources came from. Exa is credited only for a live Exa search; a practice run's sources are examples. */
export function SearchCredit({ provider }: { provider: "exa" | "fixture" | "europepmc" | undefined }) {
  if (provider === "exa") return <span className="search-credit" data-provider="exa">Search powered by <a href="https://exa.ai" target="_blank" rel="noopener noreferrer">Exa</a></span>
  if (provider === "fixture") return <span className="search-credit" data-provider="fixture">Example sources (practice run)</span>
  if (provider === "europepmc") return <span className="search-credit" data-provider="europepmc">Found in PubMed and preprints (<a href="https://europepmc.org" target="_blank" rel="noopener noreferrer">Europe PMC</a>)</span>
  return null
}
