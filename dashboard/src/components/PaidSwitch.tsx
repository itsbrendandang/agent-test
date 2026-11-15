// The Demo / Real switch: how the NEXT run will be made. (How an existing result was made is a different thing:
// the Provenance badge, read from the result itself.) Demo: practice runs, fixed example answers, free. Real: real
// AI models and web search, which cost money. It is a radio group that always shows the engine's current state. Choosing Real never flips
// anything by itself: it opens a dialog that says what changes, the limits, what was spent today, and needs a
// ticked box (and the session token). Choosing Demo is one click. The engine can lock the switch, and it refuses
// when a key is missing; both are said plainly. Nothing here asks for or shows an API key, and the page never
// keeps the state: it is read from the engine.
import { useEffect, useId, useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { EngineError } from "@/lib/engine"
import { MODE_TIP, MODE_WORDS, type PaidState } from "@/lib/paid"
import { CONFIRM_TEXT, readPaid, setPaid, SwitchRefused, type PaidFacts } from "@/lib/paidSwitch"
import { Loading } from "./Crew"

const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`
const why = (e: unknown): string => {
  const no = e instanceof SwitchRefused ? e : new SwitchRefused(String(e), 0)
  return no.field === "locked" ? "Locked by the person running the engine. Nothing was changed."
    : no.field === "keys" ? `Real cannot be turned on: the engine has no ${(no.missingKeys ?? []).join(" and ") || "key for a model"}. Nothing was changed.`
    : no.field === "rate" ? "Too many tries in a short time. Wait a minute, then try again. Nothing was changed."
    : no.field === "token" || no.status === 401 ? "The session token was missing or not accepted, so nothing was changed. Try again and paste the token when asked."
    : `${no.message} Nothing was changed.`
}

/**
 * The control: "Demo" | "Real", with the plain words for the current state beside it. `header`: the compact form in
 * the header row (the words are kept for screen readers, and a message appears under the control).
 */
export function ModeSwitch({ paid, locked, compact, header, label = "Next run: Demo or Real", describedBy }: {
  paid: PaidState; locked?: boolean; compact?: boolean; header?: boolean
  /** The control's accessible name. */
  label?: string
  /** Ids of text on the page that already says what Demo and Real mean. The control then does not repeat it: it only adds "not known" or "locked". */
  describedBy?: string
}) {
  const name = useId()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string>()
  const off = locked || paid === "unknown" || busy
  // Demo is one click: no dialog. The engine still asks for the session token if none is held.
  const toDemo = async () => {
    if (paid !== "on" || busy) return
    setBusy(true); setNote(undefined)
    try { const f = await setPaid(false); setNote(`Demo is on. Nothing can cost money now.${f.stoppedRuns?.length ? ` ${f.stoppedRuns.length} paid run${f.stoppedRuns.length === 1 ? " was" : "s were"} asked to stop.` : ""}`) }
    catch (e) { setNote(why(e)) }
    finally { setBusy(false) }
  }
  return (
    <span className="mode" data-compact={compact || undefined} data-header={header || undefined}>
      <span className="mode-switch" role="radiogroup" aria-label={label} aria-describedby={describedBy ? `${describedBy} ${name}-words` : `${name}-words`} data-state={paid}>
        <label data-on={paid === "off" || undefined}>
          <input type="radio" name={name} checked={paid === "off"} disabled={off} onChange={() => void toDemo()} /> Demo
        </label>
        <label data-on={paid === "on" || undefined}>
          <input type="radio" name={name} checked={paid === "on"} disabled={off} onChange={() => { setNote(undefined); setAsking(true) }} /> Real
        </label>
      </span>
      <span className={header ? "mode-words sr-only" : "mode-words"} id={`${name}-words`}>
        {paid === "unknown" ? "Not known: the engine did not say." : describedBy ? "" : MODE_WORDS[paid]}
        {locked && " Locked by the person running the engine."}
      </span>
      {note && <span className="mode-note" role="status">{note}{header && <button type="button" className="link-btn" onClick={() => setNote(undefined)}>Dismiss</button>}</span>}
      <RealDialog open={asking} onClose={(text) => { setAsking(false); if (text) setNote(text) }} />
    </span>
  )
}

/** The confirm dialog for turning Real on. Closing it any other way than the last button changes nothing. */
export function RealDialog({ open, onClose }: { open: boolean; onClose: (done?: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [facts, setFacts] = useState<PaidFacts>()
  const [problem, setProblem] = useState<string>()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close() }, [open])
  useEffect(() => {
    if (!open) return
    let stale = false
    // Every opening starts from the engine's own state, with the box unticked.
    readPaid().then((f) => { if (!stale) { setFacts(f); setProblem(undefined) } }, (e: unknown) => {
      if (stale) return
      setFacts(undefined)
      setProblem(e instanceof EngineError && e.status === 404 ? "This engine is too old to have the switch. Stop the app and start it again with: npm start."
        : e instanceof EngineError && e.status === 0 ? "The app's engine isn't running. Start it with: npm start."
        : `The engine could not say whether Real can be turned on. ${e instanceof Error ? e.message : ""}`)
    })
    return () => { stale = true; setAgreed(false); setBusy(false); setProblem(undefined) }
  }, [open])

  const turnOn = async () => {
    if (busy || !agreed) return
    setBusy(true); setProblem(undefined)
    // The ticked box is the person's confirmation; only then is the engine's sentence sent.
    try { await setPaid(true, CONFIRM_TEXT); onClose("Real is on. New runs use real AI models and cost money. Each run still asks you first.") }
    catch (e) { setProblem(why(e)) }
    finally { setBusy(false) }
  }

  const caps = facts?.caps
  const blocked = facts ? (facts.locked ? "locked" : facts.missingKeys.length ? "keys" : facts.paid ? "already" : undefined) : undefined
  return (
    <dialog ref={ref} className="how paid-switch" aria-labelledby="paid-title" onClose={() => onClose()} onClick={(e) => { if (e.target === ref.current) onClose() }}>
      <h2 id="paid-title">Switch to Real?</h2>
      {!facts && !problem && <Loading>Asking the engine…</Loading>}
      {facts && (
        <>
          <p className="paid-now"><b>What changes:</b> new runs use real AI models and web search, and they cost money. It is charged to the accounts whose keys are in the engine. Runs you already made keep their own label.</p>
          {caps && (
            <dl className="home-facts paid-caps" aria-label="The limits that apply">
              <dt>Most one run may cost</dt><dd>{usd(caps.maxUsd)}</dd>
              <dt>Most in one day</dt><dd>{usd(caps.dailyUsd)}</dd>
              <dt>Spent today</dt><dd>{usd(caps.spentTodayUsd)}</dd>
              <dt>Web searches (Exa)</dt><dd>{usd(caps.exaUsedUsd)} of {usd(caps.exaCeilingUsd)} used</dd>
            </dl>
          )}
          <p className="muted small">Each run still shows its own cost and asks you to confirm before it starts. Real stays on until the engine restarts or you switch back.</p>
          {blocked === "locked" && <p className="home-paidoff" role="note">Locked by the person running the engine. Real cannot be turned on from this page.</p>}
          {blocked === "keys" && <p className="home-paidoff" role="note">Real cannot be turned on: the engine has no {facts.missingKeys.join(" and ")}. The person running the engine adds {facts.missingKeys.length === 1 ? "it" : "them"} to its .env file. This page never asks for a key.</p>}
          {blocked === "already" && <p className="home-paidoff" role="note">Real is already on.</p>}
          {!blocked && (
            <label className="newrun-check">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I understand this costs money
            </label>
          )}
        </>
      )}
      {problem && <p className="newrun-error" role="alert">{problem}</p>}
      <div className="newrun-foot">
        <button type="button" className="btn" autoFocus onClick={() => onClose()}>{facts && !blocked ? "Stay in Demo" : "Close"}</button>
        {facts && !blocked && <button type="button" className="btn btn-danger" disabled={busy || !agreed} onClick={() => void turnOn()}>{busy ? "Switching…" : "Switch to Real"}</button>}
      </div>
    </dialog>
  )
}

/**
 * A compact selector with its label: "Next run  Demo | Real". It says how the next run will be made, never how a
 * result on screen was made. The label opens a short explanation (hover, focus or press). It used to sit in the
 * header row of every view. The owner took it out of the header: the app now switches in Settings only (ModeSwitch).
 * The component is kept, with its tests, so it can be placed again.
 */
export function NextRun({ paid, locked }: { paid: PaidState; locked?: boolean }) {
  const [tip, setTip] = useState(false)
  return (
    <span className="next-run" data-state={paid}>
      <Tooltip open={tip} onOpenChange={setTip}>
        <TooltipTrigger asChild>
          {/* Hover and keyboard focus open it (Radix). A press toggles it, so it also works by touch. */}
          <button type="button" className="next-run-label" aria-label="Next run: what Demo and Real mean"
            onPointerDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); setTip((on) => !on) }}>
            {/* A narrow header has no room for both words: it shows "Next:" so the switch still says what it sets. */}
            <span className="next-run-long">Next run</span><span className="next-run-short" aria-hidden="true">Next:</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="next-run-tip">{MODE_TIP}</TooltipContent>
      </Tooltip>
      <ModeSwitch paid={paid} locked={locked} header />
    </span>
  )
}
