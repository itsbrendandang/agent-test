// A plan proposed in a reply. It starts nothing by being shown. "Start research" opens a confirm step that restates
// what will run and what it may cost; only the Start button of that step calls the engine, and for a paid plan it
// stays disabled until a box is ticked. While the engine's paid-calls switch is off a paid plan cannot start.
import { useId, useState } from "react"
import { Streamdown } from "streamdown"
import { useRunEvents } from "@/board/api"
import { RunId, StatusPill } from "@/components/Shared"
import { fmtDuration } from "@/lib/format"
import { HOW_TO_TURN_ON } from "@/lib/paid"
import { ChatRefused, startPlan, type Effort, type EffortId, type Plan } from "./api"
import { EffortPicker } from "./EffortPicker"
import { controlOf, editsOf, estimateText, startBlock, startRequest, type Edits, type PlanState, type StartControl, type StartErrors } from "./chat"

interface Props {
  plan: Plan
  state: PlanState
  /** The engine's switch, from the catalog. undefined: not known, so the engine decides. */
  paidCalls: boolean | undefined
  /** The engine's effort levels, and the one this plan was written for. Without them the card shows no effort. */
  efforts?: Effort[]
  effort?: EffortId
  /** Ask the engine for this plan again at another effort. Resolves to what went wrong, or undefined when a new plan arrived. */
  onEffort?: (effort: EffortId) => Promise<string | undefined>
  onState: (state: PlanState) => void
  onOpenRun: (id: string) => void
}

export function PlanCard({ plan, state, paidCalls, efforts = [], effort, onEffort, onState, onOpenRun }: Props) {
  const uid = useId()
  const [step, setStep] = useState<"view" | "confirm" | "sending">("view")
  const [edits, setEdits] = useState<Edits>(() => editsOf(plan))
  const [agreed, setAgreed] = useState(false)
  const [errors, setErrors] = useState<StartErrors>({})
  const [refused, setRefused] = useState("")
  const [replanning, setReplanning] = useState<EffortId>()
  const level = efforts.find((e) => e.id === effort)
  // Another effort means another plan: the engine writes it. Limits are never recomputed here.
  const changeEffort = async (next: EffortId) => {
    if (!onEffort || next === effort || replanning) return
    setReplanning(next); setErrors({}); setRefused("")
    const wrong = await onEffort(next)
    setReplanning(undefined)
    if (wrong) setErrors({ effort: wrong })
  }

  const paidOff = plan.paid && paidCalls === false
  const block = startBlock(plan, paidCalls, agreed)
  const chosen = plan.agents.filter((a) => edits.agents.includes(a.name))

  const start = async () => {
    if (step !== "confirm" || block) return
    const { errors: found, request } = startRequest(plan, edits, effort)
    setErrors(found); setRefused("")
    const first = (Object.keys(found) as StartControl[])[0]
    if (first) { document.getElementById(`${uid}-${first}`)?.focus(); return }
    setStep("sending")
    try { onState({ state: "started", runId: (await startPlan(plan.id, request)).id }) }
    catch (error) {
      const no = error instanceof ChatRefused ? error : new ChatRefused(String(error), 0)
      setStep("confirm")
      if (no.status === 404) return onState({ state: "expired" })
      if (no.status === 409 && no.run) return onState({ state: "started", runId: no.run })
      const control = no.status === 400 ? controlOf(no.field) : undefined
      if (control) { setErrors({ [control]: no.message }); window.setTimeout(() => document.getElementById(`${uid}-${control}`)?.focus(), 0) }
      else setRefused(no.status === 403 ? `${no.message}${/NO_PAID_CALLS/.test(no.message) ? "" : ` ${HOW_TO_TURN_ON}`}`
        : no.status === 409 ? `${no.message} This plan was already started. Look for its run in the Board view.` : no.message)
    }
  }

  const err = (control: StartControl) => errors[control] && <p className="newrun-error" id={`${uid}-${control}-error`} role="alert">{errors[control]}</p>
  const limit = (control: "maxUsd" | "maxMinutes" | "maxRounds", label: string, step_: number) => (
    <div className="newrun-field">
      <label htmlFor={`${uid}-${control}`}>{label}</label>
      <input id={`${uid}-${control}`} type="number" inputMode="decimal" min={step_} max={plan.limits[control]} step={step_} value={edits[control]}
        onChange={(e) => { const value = e.currentTarget.value; setEdits((old) => ({ ...old, [control]: value })) }}
        aria-invalid={!!errors[control]} aria-describedby={errors[control] ? `${uid}-${control}-error` : undefined} />
      {err(control)}
    </div>
  )

  return (
    <section className="home-plan card-surface" aria-labelledby={`${uid}-title`} data-state={state.state}>
      <header className="home-plan-head">
        <span className="swarm-eyebrow">Plan · board review · nothing has started</span>
        <span className="pill" data-kind={plan.paid ? "warning" : "neutral"}>{plan.paid ? "Paid: uses paid models or search" : "Scripted: costs nothing"}</span>
      </header>
      <h2 id={`${uid}-title`}>{plan.briefTitle || "Board review"}</h2>
      <p className="home-plan-question">“{plan.question}”</p>

      {plan.warnings.length > 0 && (
        <ul className="home-warnings" aria-label="Warnings">{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}

      {step === "view" || state.state !== "open" ? (
        <>
          <div className="home-plan-grid">
            <div>
              <h3>Agents ({plan.agents.length})</h3>
              <ul className="home-why">{plan.agents.map((a) => <li key={a.name}><b>{a.title}</b><span className="muted small">{a.why}</span></li>)}</ul>
            </div>
            <div>
              <h3>Skills ({plan.skills.length})</h3>
              {plan.skills.length === 0 ? <p className="muted small">None.</p>
                : <ul className="home-why">{plan.skills.map((s) => <li key={s.name}><b>{s.name}</b><span className="muted small">{s.why}</span></li>)}</ul>}
            </div>
          </div>
          {efforts.length > 0 && state.state === "open" && onEffort && (
            <div className="home-plan-effort" id={`${uid}-effort`} tabIndex={-1}>
              <EffortPicker efforts={efforts} value={replanning ?? effort} onChange={(id) => void changeEffort(id)} name={`${uid}-effort-pick`} label="Effort for this plan" disabled={!!replanning} />
              {replanning ? <p className="muted small exp-loading" role="status"><span className="exp-spinner" aria-hidden="true" />Asking the engine for a new plan at this effort…</p>
                : <p className="muted small">Changing the effort asks the engine for a new plan. The plan below is replaced; nothing starts.</p>}
              {err("effort")}
            </div>
          )}
          <dl className="home-facts">
            {level && <><dt>Effort</dt><dd>{level.label}</dd></>}
            <dt>Exa search</dt><dd>{plan.search.exa ? "used (a paid service)" : "not used"}</dd>
            <dt>Models</dt><dd>lead <code>{plan.models.lead}</code> · members <code>{plan.models.members}</code> · checker <code>{plan.models.checker}</code></dd>
            <dt>Limits</dt><dd>at most ${plan.limits.maxUsd.toFixed(2)} · {fmtDuration(plan.limits.maxMinutes * 60_000)} · {plan.limits.maxRounds} round{plan.limits.maxRounds === 1 ? "" : "s"}</dd>
            <dt>Estimated cost</dt><dd>{estimateText(plan)} <span className="muted small">({plan.estimate.basis})</span></dd>
          </dl>
          <details className="home-brief">
            <summary>Read the brief the agents would get</summary>
            <div className="memo"><Streamdown>{plan.brief}</Streamdown></div>
          </details>
        </>
      ) : (
        <div className="home-confirm" role="group" aria-label="Confirm before starting">
          <p className={plan.paid ? "newrun-cost" : "muted"}>
            {plan.paid
              ? <><b>This may spend money.</b> It can cost up to the limit below (estimated: {estimateText(plan)}). It stops at the first limit it reaches.</>
              : <>This runs with scripted models. It costs nothing and does no real research.</>}
          </p>
          <dl className="home-facts">
            {level && <><dt>Effort</dt><dd>{level.label}</dd></>}
            <dt>What runs</dt><dd>A board review with {chosen.length} agent{chosen.length === 1 ? "" : "s"}: {chosen.map((a) => a.title).join(", ") || "none"}</dd>
            <dt>Models</dt><dd>lead <code>{plan.models.lead}</code> · members <code>{plan.models.members}</code> · checker <code>{plan.models.checker}</code></dd>
            <dt>Exa search</dt><dd>{plan.search.exa ? "used (a paid service)" : "not used"}</dd>
          </dl>
          <div className="newrun-row">
            {limit("maxUsd", "Cost limit (USD)", 0.01)}
            {limit("maxMinutes", "Time limit (minutes)", 1)}
            {limit("maxRounds", "Rounds", 1)}
          </div>
          <fieldset className="newrun-field" id={`${uid}-agents`} tabIndex={-1} aria-describedby={errors.agents ? `${uid}-agents-error` : undefined}>
            <legend>Agents to include</legend>
            <div className="newrun-choices">
              {plan.agents.map((a) => (
                <label key={a.name}>
                  <input type="checkbox" checked={edits.agents.includes(a.name)}
                    onChange={(e) => { const on = e.target.checked; setEdits((old) => ({ ...old, agents: on ? [...old.agents, a.name] : old.agents.filter((n) => n !== a.name) })) }} /> {a.title}
                </label>
              ))}
            </div>
            {err("agents")}
          </fieldset>
          {plan.paid && (
            <label className="newrun-check" data-off={paidOff || undefined}>
              <input id={`${uid}-confirm`} type="checkbox" checked={agreed} disabled={paidOff} onChange={(e) => setAgreed(e.target.checked)}
                aria-describedby={errors.confirm ? `${uid}-confirm-error` : undefined} /> I understand that this spends money on the model provider's account.
            </label>
          )}
          {err("confirm")}
          {err("effort")}
        </div>
      )}

      {paidOff && state.state === "open" && <p className="home-paidoff" role="note">This plan needs paid models or paid search, and paid calls are off, so it cannot be started. {HOW_TO_TURN_ON}</p>}
      {refused && <p className="newrun-error newrun-refused" role="alert">The plan was not started: {refused}</p>}

      {state.state === "open" && step === "view" && (
        <footer className="newrun-foot">
          <button type="button" className="btn" onClick={() => onState({ state: "discarded" })}>Discard</button>
          <button type="button" className="btn btn-primary" disabled={paidOff || !!replanning} onClick={() => { setAgreed(false); setRefused(""); setErrors({}); setStep("confirm") }}>{plan.paid ? "Start research" : "Start scripted run (not research)"}</button>
        </footer>
      )}
      {state.state === "open" && step !== "view" && (
        <footer className="newrun-foot">
          <button type="button" className="btn" disabled={step === "sending"} onClick={() => { setStep("view"); setAgreed(false) }}>Back</button>
          <button type="button" className="btn btn-primary" disabled={step === "sending" || !!block} onClick={() => void start()}>
            {step === "sending" ? "Starting…" : plan.paid ? "Start paid research" : "Start scripted run (not research)"}
          </button>
        </footer>
      )}
      {state.state === "discarded" && <p className="muted small" role="status">Discarded. Nothing was started. <button type="button" className="link-btn" onClick={() => onState({ state: "open" })}>Bring it back</button></p>}
      {state.state === "expired" && <p className="home-paidoff" role="status">This plan has expired, so it can no longer be started. Ask the question again to get a new plan.</p>}
      {state.state === "started" && <RunFollow runId={state.runId} onOpen={() => onOpenRun(state.runId)} />}
    </section>
  )
}

/** The board review a plan started: one status line that follows the run's event stream, and a way to open it. */
export function RunFollow({ runId, onOpen }: { runId: string; onOpen: () => void }) {
  const events = useRunEvents(runId)
  const rounds = new Set(events.flatMap((e) => (e.type === "round.started" ? [e.round] : []))).size
  const replies = events.filter((e) => e.type === "member.replied").length
  const claims = events.filter((e) => e.type === "claim.checked").length
  const failed = events.find((e) => e.type === "run.failed")
  const done = events.find((e) => e.type === "run.finished")
  const memo = events.find((e) => e.type === "memo.written")
  const state = failed ? "failed" : done ? "done" : "running"
  return (
    <div className="home-run" role="status">
      <p>
        <StatusPill state={state} /> Board review <RunId id={runId} />
        <span className="muted small">
          {events.length === 0 ? " · waiting for its first event" : ` · round ${rounds} · ${replies} repl${replies === 1 ? "y" : "ies"} · ${claims} claim${claims === 1 ? "" : "s"} checked`}
          {done?.type === "run.finished" && ` · took ${fmtDuration(done.minutes * 60_000)} · cost $${done.usd.toFixed(2)}`}
        </span>
      </p>
      {memo?.type === "memo.written" && <p className="home-decision">Decision: {memo.decision}</p>}
      {failed?.type === "run.failed" && <p className="newrun-error">{failed.error}</p>}
      <button type="button" className="btn" onClick={onOpen}>Open in the Board view</button>
    </div>
  )
}
