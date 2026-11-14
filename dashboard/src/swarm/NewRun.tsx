// "New run": the form that starts a local run on the demo case (POST /api/glhf/runs). The scripted mock model is
// the default and is free. A real model costs money, so it needs a token budget and a second, explicit step that
// restates what will be spent. The engine checks every field again; its refusals are shown next to the field.
import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { fmtDuration, fmtTokens } from "@/lib/format"
import { LIMITS, MODEL_ID, startRun, type GlhfStatus, type StartRequest } from "@/swarm/api"

const MODELS = [
  { id: "mock", label: "mock (scripted, free, no real analysis)" },
  { id: "anthropic/claude-sonnet-5-5", label: "anthropic/claude-sonnet-5-5 (paid)" },
  { id: "anthropic/claude-haiku-5-5", label: "anthropic/claude-haiku-5-5 (paid)" },
]
const OTHER = "other"
type Who = "glhf" | "single" | "both"
type Field = "model" | "minutes" | "tokens" | "rounds" | "seed" | "exa"
type Errors = Partial<Record<Field, string>>

const whole = (text: string, [min, max]: readonly [number, number], name: string): number | string => {
  const n = Number(text)
  return text.trim() && Number.isInteger(n) && n >= min && n <= max ? n : `${name} must be a whole number from ${fmtTokens(min)} to ${fmtTokens(max)}.`
}
/** Which field an engine message is about, from the field name it starts with. */
const fieldOf = (message: string): Field | undefined =>
  message.startsWith("timeLimit") ? "minutes" : message.startsWith("maxTokens") ? "tokens" : message.startsWith("reviewRounds") ? "rounds"
    : message.startsWith("seed") ? "seed" : message.startsWith("model") ? "model" : message.startsWith("exa") ? "exa" : undefined

interface Props {
  open: boolean
  /** A local run is still going. One start at a time keeps the timing of runs comparable. */
  busy: boolean
  keys: GlhfStatus["keys"] | undefined
  onClose: () => void
  /** `complete` is false when only the first of two runs started; the form then stays open with the reason. */
  onStarted: (ids: string[], complete: boolean) => void
}

export function NewRun({ open, busy, keys, onClose, onStarted }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const [who, setWho] = useState<Who>("glhf")
  const [choice, setChoice] = useState("mock")
  const [custom, setCustom] = useState("")
  const [minutes, setMinutes] = useState("30")
  const [tokens, setTokens] = useState("")
  const [rounds, setRounds] = useState("3")
  const [exa, setExa] = useState(false)
  const [memory, setMemory] = useState(false)
  const [seed, setSeed] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [refused, setRefused] = useState("")
  const [step, setStep] = useState<"edit" | "confirm" | "sending">("edit")
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) { setStep("edit"); setAgreed(false); setRefused(""); setErrors({}); d.showModal(); d.querySelector<HTMLInputElement>("input[name=who]:checked")?.focus() }
    if (!open && d.open) d.close()
  }, [open])

  const model = choice === OTHER ? custom.trim() : choice
  const real = model !== "mock"
  const swarm = who !== "single"
  const count = who === "both" ? 2 : 1

  /** Checks the form the way the engine will, and builds the request for each run (swarm first). */
  const build = (): { errors: Errors; requests: StartRequest[] } => {
    const e: Errors = {}
    if (!model) e.model = "Type a model id, such as anthropic/claude-sonnet-5-5."
    else if (!MODEL_ID.test(model)) e.model = "A model id has letters, digits and . / : @ - only, without spaces."
    const m = whole(minutes, LIMITS.minutes, "The time limit")
    if (typeof m === "string") e.minutes = m
    let budget: number | undefined
    if (tokens.trim()) { const t = whole(tokens, LIMITS.tokens, "The token budget"); if (typeof t === "string") e.tokens = t; else budget = t }
    else if (real) e.tokens = "A run with a real model needs a token budget. It is the limit on what the run can spend."
    let r: number | undefined
    if (swarm) { const x = whole(rounds, LIMITS.reviewRounds, "Review rounds"); if (typeof x === "string") e.rounds = x; else r = x }
    let sd: number | undefined
    if (seed.trim()) { const x = whole(seed, LIMITS.seed, "The seed"); if (typeof x === "string") e.seed = x; else sd = x }
    const base = { mode: "local" as const, task: "demo" as const, model, timeLimit: (typeof m === "number" ? m : 0) * 60,
      ...(budget !== undefined && { maxTokens: budget }), ...(sd !== undefined && { seed: sd }) }
    const requests: StartRequest[] = []
    if (swarm) requests.push({ ...base, solver: "glhf", reviewRounds: r, ...(exa && { exa: true }), ...(memory && { memory: true }) })
    if (who !== "glhf") requests.push({ ...base, solver: "single" })
    return { errors: e, requests }
  }

  const send = async (requests: StartRequest[]) => {
    setStep("sending"); setRefused("")
    const started: string[] = []
    try {
      for (const request of requests) started.push((await startRun(request)).id)
      onStarted(started, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const field = fieldOf(message)
      if (field) setErrors({ [field]: message })
      setRefused(started.length ? `The swarm run ${started[0]} started, but the single-agent run did not: ${message}` : message)
      setStep("edit")
      if (started.length) onStarted(started, false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (step === "sending" || busy) return
    const { errors: found, requests } = build()
    setErrors(found); setRefused("")
    const first = (Object.keys(found) as Field[])[0]
    if (first) { document.getElementById(`${uid}-${first}`)?.focus(); return }
    if (step === "edit" && real) { setAgreed(false); setStep("confirm"); return }
    if (step === "confirm" && !agreed) return
    void send(requests)
  }

  const err = (field: Field) => errors[field] && <p className="newrun-error" id={`${uid}-${field}-error`} role="alert">{errors[field]}</p>
  const described = (field: Field, hint?: string) => [errors[field] && `${uid}-${field}-error`, hint].filter(Boolean).join(" ") || undefined
  const missingKey = real && keys && ((model.startsWith("anthropic/") && !keys.ANTHROPIC_API_KEY) || (model.startsWith("openai/") && !keys.OPENAI_API_KEY))
  const { requests: planned } = build()
  const limitMs = (planned[0]?.timeLimit ?? 0) * 1000
  const budget = planned[0]?.maxTokens

  return (
    <dialog ref={dialog} className="newrun card-surface" aria-labelledby={`${uid}-title`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <header className="newrun-head">
          <h2 id={`${uid}-title`}>{step === "confirm" ? "Confirm a paid run" : "New run"}</h2>
          <button type="button" className="link-btn" onClick={onClose}>Close</button>
        </header>

        {step !== "confirm" ? (
          <>
            <p className="muted small">Runs on this machine, on the small demo case. It needs Docker. Cloud runs and BixBench3 tasks start from the command line.</p>

            <fieldset className="newrun-field">
              <legend>Who does the work</legend>
              <div className="newrun-choices">
                {([["glhf", "Swarm (9 roles)"], ["single", "Single agent"], ["both", "Both, to compare"]] as const).map(([value, label]) => (
                  <label key={value}><input type="radio" name="who" value={value} checked={who === value} onChange={() => setWho(value)} /> {label}</label>
                ))}
              </div>
              {who === "both" && <p className="muted small">Starts two runs with the same model, time limit, token budget and seed, so the scoreboard can pair them. Both start now and run at the same time.</p>}
            </fieldset>

            <div className="newrun-field">
              <label htmlFor={`${uid}-model-pick`}>Model</label>
              <select id={`${uid}-model-pick`} value={choice} onChange={(e) => setChoice(e.target.value)}>
                {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                <option value={OTHER}>Another model…</option>
              </select>
              {choice === OTHER && (
                <input id={`${uid}-model`} type="text" aria-label="Model id" placeholder="provider/model-name" autoComplete="off" spellCheck={false} maxLength={200}
                  value={custom} onChange={(e) => setCustom(e.currentTarget.value)} aria-invalid={!!errors.model} aria-describedby={described("model")} />
              )}
              {err("model")}
              {real && model && <p className="newrun-cost" role="note"><b>This run costs money.</b> It calls a paid model with the engine's API key until it finishes or reaches the time limit or the token budget. You will be asked to confirm.</p>}
              {missingKey && <p className="newrun-error">The engine has no API key for this provider, so the run would fail. Add the key to .env and restart the engine.</p>}
            </div>

            <div className="newrun-row">
              <div className="newrun-field">
                <label htmlFor={`${uid}-minutes`}>Time limit (minutes)</label>
                <input id={`${uid}-minutes`} type="number" inputMode="numeric" min={LIMITS.minutes[0]} max={LIMITS.minutes[1]} step={1} value={minutes}
                  onChange={(e) => setMinutes(e.currentTarget.value)} aria-invalid={!!errors.minutes} aria-describedby={described("minutes")} />
                {err("minutes")}
              </div>
              <div className="newrun-field">
                <label htmlFor={`${uid}-tokens`}>Token budget {real ? "(required)" : "(optional)"}</label>
                <input id={`${uid}-tokens`} type="number" inputMode="numeric" min={LIMITS.tokens[0]} max={LIMITS.tokens[1]} step={1000} value={tokens}
                  placeholder={real ? "for example 500000" : "no limit"} onChange={(e) => setTokens(e.currentTarget.value)}
                  aria-invalid={!!errors.tokens} aria-describedby={described("tokens")} />
                {err("tokens")}
              </div>
              <div className="newrun-field">
                <label htmlFor={`${uid}-seed`}>Seed (optional)</label>
                <input id={`${uid}-seed`} type="number" inputMode="numeric" min={LIMITS.seed[0]} max={LIMITS.seed[1]} step={1} value={seed} placeholder="none"
                  onChange={(e) => setSeed(e.currentTarget.value)} aria-invalid={!!errors.seed} aria-describedby={described("seed")} />
                {err("seed")}
              </div>
            </div>

            <fieldset className="newrun-field" disabled={!swarm}>
              <legend>Swarm only</legend>
              <div className="newrun-row">
                <div className="newrun-field">
                  <label htmlFor={`${uid}-rounds`}>Review rounds</label>
                  <input id={`${uid}-rounds`} type="number" inputMode="numeric" min={LIMITS.reviewRounds[0]} max={LIMITS.reviewRounds[1]} step={1} value={rounds}
                    onChange={(e) => setRounds(e.currentTarget.value)} aria-invalid={!!errors.rounds} aria-describedby={described("rounds")} />
                  {err("rounds")}
                </div>
                <label className="newrun-check"><input id={`${uid}-exa`} type="checkbox" checked={exa} onChange={(e) => setExa(e.target.checked)} aria-describedby={described("exa")} /> Exa documentation search</label>
                <label className="newrun-check"><input type="checkbox" checked={memory} onChange={(e) => setMemory(e.target.checked)} /> Memory between runs</label>
              </div>
              {err("exa")}
              <p className="muted small">
                {swarm ? "Review rounds, Exa search and memory apply to the swarm only." : "A single agent has no review rounds, Exa search or memory."}
                {who === "both" && " The single-agent run starts without them. The scoreboard still pairs the two runs and lists these extras next to the swarm."}
              </p>
            </fieldset>
          </>
        ) : (
          <div className="newrun-confirm">
            <p className="newrun-cost"><b>{count === 2 ? "These two runs cost money." : "This run costs money."}</b> Check the settings before you start.</p>
            <dl>
              <dt>Model</dt><dd><code>{model}</code></dd>
              <dt>Runs</dt><dd>{who === "both" ? "2: one swarm run and one single-agent run" : who === "glhf" ? "1 swarm run (9 roles)" : "1 single-agent run"}</dd>
              <dt>Time limit</dt><dd>{fmtDuration(limitMs)} ({minutes} minutes){count === 2 && " for each run"}</dd>
              <dt>Token budget</dt><dd>{fmtTokens(budget)} tokens{count === 2 && budget !== undefined && ` for each run, ${fmtTokens(budget * 2)} in total`}</dd>
              {swarm && <><dt>Swarm extras</dt><dd>{[`${rounds} review rounds`, exa && "Exa search", memory && "memory"].filter(Boolean).join(", ")}</dd></>}
              {seed.trim() && <><dt>Seed</dt><dd>{seed}</dd></>}
            </dl>
            <label className="newrun-check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} autoFocus /> I understand that this spends money on the model provider's account.</label>
          </div>
        )}

        {refused && <p className="newrun-error newrun-refused" role="alert">The engine refused the run: {refused}</p>}
        {busy && step !== "sending" && <p className="newrun-error" role="status">A local run is still going. Wait until it finishes, then start the next one.</p>}

        <footer className="newrun-foot">
          {step === "confirm" && <button type="button" className="btn" onClick={() => setStep("edit")}>Back</button>}
          <button type="submit" className="btn btn-primary" disabled={step === "sending" || busy || (step === "confirm" && !agreed)}>
            {step === "sending" ? "Starting…" : step === "confirm" ? (count === 2 ? "Start 2 paid runs" : "Start paid run") : real ? "Review and confirm" : count === 2 ? "Start both runs" : "Start run"}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
