// Asks for the engine's session token when a request needs it (see lib/token.ts). Mounted once, in the shell.
import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { answer, refuseToken, TOKEN_FILE, useAsking } from "@/lib/token"

export function TokenPrompt() {
  const asking = useAsking()
  const dialog = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const [text, setText] = useState("")
  const [problem, setProblem] = useState("")

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (asking && !d.open) d.showModal()
    if (!asking && d.open) d.close()
  }, [asking])

  const done = (token: string | undefined) => { setText(""); setProblem(""); answer(token) }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const no = refuseToken(text)
    if (no) { setProblem(no); return }
    done(text)
  }

  return (
    <dialog ref={dialog} className="newrun card-surface" aria-labelledby={`${uid}-title`} onClose={() => { if (asking) done(undefined) }}>
      {asking && (
        <form className="token-form" onSubmit={submit} noValidate>
          <header className="newrun-head"><h2 id={`${uid}-title`}>The engine needs its session token</h2></header>
          {asking.rejected && <p className="newrun-error newrun-refused" role="alert">The engine did not accept the last token. It changes each time the engine restarts.</p>}
          <p className="token-why">{asking.why}</p>
          <p>
            Anything that can spend money needs this token, so that only a person at this machine can start it. The engine writes the token to
            the file <code>{TOKEN_FILE}</code> and names that file when it starts. Open the file on this machine, copy its content and paste it here.
          </p>
          <div className="newrun-field">
            <label htmlFor={`${uid}-token`}>Session token</label>
            <input id={`${uid}-token`} type="password" name="engine-session-token" autoComplete="off" spellCheck={false} autoFocus value={text}
              onChange={(e) => { setText(e.currentTarget.value); setProblem("") }} aria-invalid={!!problem} aria-describedby={`${uid}-help${problem ? ` ${uid}-error` : ""}`} />
            {problem && <p className="newrun-error" id={`${uid}-error`} role="alert">{problem}</p>}
            <p className="muted small" id={`${uid}-help`}>Kept for this browser tab only and sent only to the engine. It is gone when the tab closes; Settings has "Forget token". This is not an API key: never paste an API key here.</p>
          </div>
          <footer className="newrun-foot">
            <button type="button" className="btn" onClick={() => done(undefined)}>Not now</button>
            <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Use this token</button>
          </footer>
        </form>
      )}
    </dialog>
  )
}
