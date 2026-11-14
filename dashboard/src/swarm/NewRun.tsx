// "New run": the form that starts a local run on the demo case (POST /api/glhf/runs). The scripted mock model is
// the default and is free. A real model costs money, so it needs a token budget and a second, explicit step that
// restates what will be spent. Limits, the model list and which keys are set come from GET /api/glhf/status; the
// engine checks every field again, and its refusals ({error, field}) are shown next to the field they name.
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react"
import { fmtDuration, fmtTokens } from "@/lib/format"
import { Refused, startRun, type GlhfStatus, type Range, type StartField, type StartRequest } from "@/swarm/api"

const OTHER = "other"
type Who = "glhf" | "single" | "both"
/** The form's inputs. Engine fields without an input of their own (mode, caseDir, maxMessagesPerRole) go under the form. */
type Input = "who" | "model" | "minutes" | "tokens" | "rounds" | "seed" | "exa" | "memory"
type Errors = Partial<Record<Input, string>>
const INPUT_OF: Partial<Record<StartField, Input>> = {
  solver: "who", model: "model", timeLimit: "minutes", maxTokens: "tokens", reviewRounds: "rounds", seed: "seed", exa: "exa", memory: "memory",
}
/** The key a model needs, by its provider prefix. Only used to warn; the engine decides. */
const KEY_OF: Record<string, keyof GlhfStatus["keys"]> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" }

/** A whole number, inside the engine's range when the engine published one. */
const whole = (text: string, name: string, range?: Range): number | string => {
  const n = Number(text)
  if (!text.trim() || !Number.isInteger(n) || n < 1) return `${name} must be a whole number${range ? ` from ${fmtTokens(range[0])} to ${fmtTokens(range[1])}` : ""}.`
  return range && (n < range[0] || n > range[1]) ? `${name} must be a whole number from ${fmtTokens(range[0])} to ${fmtTokens(range[1])}.` : n
}

interface Props {
  open: boolean
  /** Limits, models and keys, from the engine. */
  status: GlhfStatus | undefined
  onClose: () => void
  /** The ids of the runs, in the order they will go. */
  onStarted: (ids: string[]) => void
  /** Show the run that is in the way of a new one. */
  onOpenRun: (id: string) => void
}

export function NewRun({ open, status, onClose, onStarted, onOpenRun }: Props) {
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
  const [refused, setRefused] = useState<{ message: string; run?: string }>()
  const [step, setStep] = useState<"edit" | "confirm" | "sending">("edit")
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) { d.showModal(); d.querySelector<HTMLInputElement>("input[name=who]:checked")?.focus() }
    if (!open && d.open) d.close()
  }, [open])
  /** Back to a clean first step, for the next time the form opens. The inputs keep their values. */
  const closed = () => { setStep("edit"); setAgreed(false); setRefused(undefined); setErrors({}); onClose() }

  const limits = status?.limits
  const keys = status?.keys
  const models = status?.models ?? ["mock"]
  const minuteRange: Range | undefined = limits && [Math.ceil(limits.timeLimit[0] / 60), Math.floor(limits.timeLimit[1] / 60)]
  const hasExaKey = keys?.EXA_API_KEY !== false // unknown on an older engine: let the engine decide
  const useExa = exa && hasExaKey

  const model = choice === OTHER ? custom.trim() : choice
  const real = model !== "mock"
  const swarm = who !== "single"
  const count = who === "both" ? 2 : 1
  const neededKey = real ? KEY_OF[model.split("/")[0]] : undefined
  const missingKey = neededKey !== undefined && keys?.[neededKey] === false

  /** Checks the form the way the engine will, and builds the one request to send. */
  const build = (): { errors: Errors; request: StartRequest } => {
    const e: Errors = {}
    if (!model) e.model = "Type a model id, such as anthropic/claude-sonnet-5-5."
    else if (/\s/.test(model)) e.model = "A model id has no spaces."
    const m = whole(minutes, "The time limit", minuteRange)
    if (typeof m === "string") e.minutes = m
    let budget: number | undefined
    if (tokens.trim()) { const t = whole(tokens, "The token budget", limits?.maxTokens); if (typeof t === "string") e.tokens = t; else budget = t }
    else if (real) e.tokens = "A run with a real model needs a token budget. It is the limit on what the run can spend."
    let r: number | undefined
    if (swarm) { const x = whole(rounds, "Review rounds", limits?.reviewRounds); if (typeof x === "string") e.rounds = x; else r = x }
    let sd: number | undefined
    if (seed.trim()) { const x = whole(seed, "The seed"); if (typeof x === "string") e.seed = x; else sd = x }
    const request: StartRequest = {
      mode: "local", task: "demo", model, ...(who === "both" ? { solvers: ["glhf", "single"] } : { solver: who }),
      timeLimit: (typeof m === "number" ? m : 0) * 60, ...(budget !== undefined && { maxTokens: budget }), ...(sd !== undefined && { seed: sd }),
      ...(swarm && { reviewRounds: r, ...(useExa && { exa: true }), ...(memory && { memory: true }) }),
    }
    return { errors: e, request }
  }

  const send = async (request: StartRequest) => {
    setStep("sending"); setRefused(undefined)
    try {
      const ids = await startRun(request)
      closed()
      onStarted(ids)
    } catch (error) {
      const no = error instanceof Refused ? error : new Refused(String(error), 0)
      const input = no.field && INPUT_OF[no.field]
      if (input) setErrors({ [input]: no.message })
      // A refusal about a field with no input here (mode, caseDir, maxMessagesPerRole), or about no field, goes under the form.
      setRefused(input ? undefined : { message: no.message, run: no.run })
      setStep("edit")
      if (input) window.setTimeout(() => document.getElementById(`${uid}-${input}`)?.focus(), 0)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (step === "sending") return
    const { errors: found, request } = build()
    setErrors(found); setRefused(undefined)
    const first = (Object.keys(found) as Input[])[0]
    if (first) { setStep("edit"); window.setTimeout(() => document.getElementById(`${uid}-${first}`)?.focus(), 0); return }
    if (step === "edit" && real) { setAgreed(false); setStep("confirm"); return }
    if (step === "confirm" && !agreed) return
    void send(request)
  }

  const err = (input: Input): ReactNode => errors[input] && <p className="newrun-error" id={`${uid}-${input}-error`} role="alert">{errors[input]}</p>
  const described = (input: Input) => (errors[input] ? `${uid}-${input}-error` : undefined)
  const limitMs = (Number(minutes) || 0) * 60_000
  const budget = tokens.trim() ? Number(tokens) : undefined
  const hint = (range: Range | undefined) => (range ? `${fmtTokens(range[0])} to ${fmtTokens(range[1])}` : undefined)

  return (
    <dialog ref={dialog} className="newrun card-surface" aria-labelledby={`${uid}-title`} onClose={closed}>
      <form onSubmit={submit} noValidate>
        <header className="newrun-head">
          <h2 id={`${uid}-title`}>{step === "confirm" ? "Confirm a paid run" : "New run"}</h2>
          <button type="button" className="link-btn" onClick={() => dialog.current?.close()}>Close</button>
        </header>

        {step !== "confirm" ? (
          <>
            <p className="muted small">Runs on this machine, on the small demo case. It needs Docker. Cloud runs and BixBench3 tasks start from the command line.</p>

            <fieldset className="newrun-field">
              <legend>Who does the work</legend>
              <div className="newrun-choices">
                {([["glhf", "Swarm (9 roles)"], ["single", "Single agent"], ["both", "Both, to compare"]] as const).map(([value, label]) => (
                  <label key={value}><input type="radio" name="who" id={who === value ? `${uid}-who` : undefined} value={value} checked={who === value} onChange={() => setWho(value)} /> {label}</label>
                ))}
              </div>
              {who === "both" && (
                <p className="muted small">
                  Starts a pair with the same model, time limit, token budget and seed, so the scoreboard can compare them. The swarm runs first.
                  The single agent waits in the queue and starts when the swarm run has ended. The two never run at the same time.
                </p>
              )}
              {err("who")}
            </fieldset>

            <div className="newrun-field">
              <label htmlFor={choice === OTHER ? `${uid}-model-pick` : `${uid}-model`}>Model</label>
              <select id={choice === OTHER ? `${uid}-model-pick` : `${uid}-model`} value={choice} onChange={(e) => setChoice(e.target.value)}
                aria-invalid={choice !== OTHER && !!errors.model} aria-describedby={described("model")}>
                {models.map((m) => <option key={m} value={m}>{m === "mock" ? "mock (scripted, free, no real analysis)" : `${m} (paid)`}</option>)}
                <option value={OTHER}>Another model…</option>
              </select>
              {choice === OTHER && (
                <input id={`${uid}-model`} type="text" aria-label="Model id" placeholder="provider/model-name" autoComplete="off" spellCheck={false} maxLength={200}
                  value={custom} onChange={(e) => setCustom(e.currentTarget.value)} aria-invalid={!!errors.model} aria-describedby={described("model")} />
              )}
              {err("model")}
              {models.length === 1 && <p className="muted small">The engine has no model API key, so only the scripted model is listed. Add a key to .env and restart the engine to run a real model.</p>}
              {real && model && <p className="newrun-cost" role="note"><b>This run costs money.</b> It calls a paid model with the engine's API key until it finishes or reaches the time limit or the token budget. You will be asked to confirm.</p>}
              {missingKey && <p className="newrun-error" role="note">The engine has no {neededKey} for this model, so the run would fail. Add the key to .env and restart the engine.</p>}
            </div>

            <div className="newrun-row">
              <div className="newrun-field">
                <label htmlFor={`${uid}-minutes`}>Time limit (minutes)</label>
                <input id={`${uid}-minutes`} type="number" inputMode="numeric" min={minuteRange?.[0]} max={minuteRange?.[1]} step={1} value={minutes} title={hint(minuteRange)}
                  onChange={(e) => setMinutes(e.currentTarget.value)} aria-invalid={!!errors.minutes} aria-describedby={described("minutes")} />
                {err("minutes")}
              </div>
              <div className="newrun-field">
                <label htmlFor={`${uid}-tokens`}>Token budget {real ? "(required)" : "(optional)"}</label>
                <input id={`${uid}-tokens`} type="number" inputMode="numeric" min={limits?.maxTokens[0]} max={limits?.maxTokens[1]} step={1000} value={tokens} title={hint(limits?.maxTokens)}
                  placeholder={real ? "for example 500000" : "no limit"} onChange={(e) => setTokens(e.currentTarget.value)}
                  aria-invalid={!!errors.tokens} aria-describedby={described("tokens")} />
                {err("tokens")}
              </div>
              <div className="newrun-field">
                <label htmlFor={`${uid}-seed`}>Seed (optional)</label>
                <input id={`${uid}-seed`} type="number" inputMode="numeric" min={1} step={1} value={seed} placeholder="none"
                  onChange={(e) => setSeed(e.currentTarget.value)} aria-invalid={!!errors.seed} aria-describedby={described("seed")} />
                {err("seed")}
              </div>
            </div>

            <fieldset className="newrun-field" disabled={!swarm}>
              <legend>Swarm only</legend>
              <div className="newrun-row">
                <div className="newrun-field">
                  <label htmlFor={`${uid}-rounds`}>Review rounds</label>
                  <input id={`${uid}-rounds`} type="number" inputMode="numeric" min={limits?.reviewRounds[0]} max={limits?.reviewRounds[1]} step={1} value={rounds} title={hint(limits?.reviewRounds)}
                    onChange={(e) => setRounds(e.currentTarget.value)} aria-invalid={!!errors.rounds} aria-describedby={described("rounds")} />
                  {err("rounds")}
                </div>
                <label className="newrun-check" data-off={!hasExaKey || undefined}>
                  <input id={`${uid}-exa`} type="checkbox" checked={useExa} disabled={!hasExaKey} onChange={(e) => setExa(e.target.checked)}
                    aria-describedby={[described("exa"), !hasExaKey && `${uid}-exa-off`].filter(Boolean).join(" ") || undefined} /> Exa documentation search
                </label>
                <label className="newrun-check"><input id={`${uid}-memory`} type="checkbox" checked={memory} onChange={(e) => setMemory(e.target.checked)} aria-describedby={described("memory")} /> Memory between runs</label>
              </div>
              {err("exa")}{err("memory")}
              {!hasExaKey && <p className="muted small" id={`${uid}-exa-off`}>Exa search is off because the engine has no EXA_API_KEY. Add the key to .env and restart the engine to use it.</p>}
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
              <dt>Runs</dt><dd>{who === "both" ? "2: a swarm run first, then a single-agent run when the swarm run has ended" : who === "glhf" ? "1 swarm run (9 roles)" : "1 single-agent run"}</dd>
              <dt>Time limit</dt><dd>{fmtDuration(limitMs)} ({minutes} minutes){count === 2 && " for each run"}</dd>
              <dt>Token budget</dt><dd>{fmtTokens(budget)} tokens{count === 2 && budget !== undefined && ` for each run, ${fmtTokens(budget * 2)} in total`}</dd>
              {swarm && <><dt>Swarm extras</dt><dd>{[`${rounds} review rounds`, useExa && "Exa search", memory && "memory"].filter(Boolean).join(", ")}</dd></>}
              {seed.trim() && <><dt>Seed</dt><dd>{seed}</dd></>}
            </dl>
            {missingKey && <p className="newrun-error" role="note">The engine has no {neededKey} for this model, so the run would fail.</p>}
            <label className="newrun-check"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} autoFocus /> I understand that this spends money on the model provider's account.</label>
          </div>
        )}

        {refused && (
          <p className="newrun-error newrun-refused" role="alert">
            The engine refused the run: {refused.message}
            {refused.run && <> <button type="button" className="link-btn" onClick={() => { const id = refused.run!; dialog.current?.close(); onOpenRun(id) }}>Open {refused.run}</button></>}
          </p>
        )}

        <footer className="newrun-foot">
          {step === "confirm" && <button type="button" className="btn" onClick={() => setStep("edit")}>Back</button>}
          <button type="submit" className="btn btn-primary" disabled={step === "sending" || (step === "confirm" && !agreed)}>
            {step === "sending" ? "Starting…" : step === "confirm" ? (count === 2 ? "Start 2 paid runs" : "Start paid run") : real ? "Review and confirm" : count === 2 ? "Start the pair" : "Start run"}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
