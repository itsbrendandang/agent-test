// Asks before stopping a run (POST /api/glhf/runs/:id/cancel). The engine also cancels a partner that is queued
// behind the run. A cloud run cannot be stopped from here: the engine answers with the command to run, shown as it is.
import { useEffect, useId, useRef, useState } from "react"
import { benchmarkTitle } from "@/lib/words"
import { cancelRun, type GlhfRun } from "@/swarm/api"

interface Props {
  /** The run to stop, or undefined when nothing is being asked. */
  run: GlhfRun | undefined
  /** A run queued behind it, which the engine cancels with it. */
  queuedBehind: GlhfRun | undefined
  onClose: () => void
  onCancelled: () => void
}

export function CancelRun({ run, queuedBehind, onClose, onCancelled }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const [sending, setSending] = useState(false)
  const [refused, setRefused] = useState("")

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (run && !d.open) d.showModal()
    if (!run && d.open) d.close()
  }, [run])
  const closed = () => { setSending(false); setRefused(""); onClose() }

  const stop = async () => {
    if (!run) return
    setSending(true); setRefused("")
    try { await cancelRun(run.id); onCancelled(); dialog.current?.close() }
    catch (error) { setRefused(error instanceof Error ? error.message : String(error)); setSending(false) }
  }

  return (
    <dialog ref={dialog} className="newrun card-surface" aria-labelledby={`${uid}-title`} onClose={closed}>
      {run && (
        <div className="newrun-body">
          <header className="newrun-head"><h2 id={`${uid}-title`}>Cancel this run?</h2></header>
          <p>
            <b title={`Run id: ${run.id}`}>{benchmarkTitle(run.solver, run.task)}</b> {run.phase === "queued" ? "is waiting in the queue and will not start." : "will be stopped now."} A
            cancelled run gets no score and does not appear on the scoreboard. This cannot be undone.
          </p>
          {queuedBehind && <p>Its partner, <b title={`Run id: ${queuedBehind.id}`}>{queuedBehind.solver === "single" ? "the one-agent run" : "the team-of-nine run"}</b>, is queued behind it and will be cancelled too.</p>}
          {refused && <p className="newrun-error newrun-refused" role="alert">The run was not cancelled: {refused}</p>}
          <footer className="newrun-foot">
            <button type="button" className="btn" autoFocus onClick={() => dialog.current?.close()}>{refused ? "Close" : "Keep it"}</button>
            <button type="button" className="btn btn-danger" disabled={sending} onClick={() => void stop()}>{sending ? "Cancelling…" : refused ? "Try again" : "Cancel run"}</button>
          </footer>
        </div>
      )}
    </dialog>
  )
}
