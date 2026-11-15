// A plan proposed in a reply. It starts nothing by being shown. "Start research" opens a confirm step that restates
// what will run and what it may cost; only the Start button of that step calls the engine, and for a paid plan it
// stays disabled until a box is ticked. While the engine's paid-calls switch is off a paid plan cannot start.
import { Provenance } from "@/components/Provenance"
import { type ReactNode, useId, useState } from "react"
import { Streamdown } from "streamdown"
import { useRunEvents } from "@/board/api"
import { Loading, Mascots } from "@/components/Crew"
import { ModeLabel, RunId, SearchCredit, StatusPill } from "@/components/Shared"
import { plainCost, plainDuration } from "@/lib/format"
import { HOW_TO_TURN_ON } from "@/lib/paid"
import { boardFacts } from "@/lib/verdict"
import { markCount } from "@/lib/words"
import { ChatRefused, startPlan, type Effort, type EffortId, type Plan } from "./api"
import { Activity } from "@/research/Activity"
import { providerPlace } from "@/research/model"
import { reviewActivity } from "@/research/boardAdapter"
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
  /** What a run started now would search with, from the catalog. */
  searchProvider?: "exa" | "fixture"
  /** The engine says a team member has the free literature search (Europe PMC). */
  literature?: boolean
}

export function PlanCard({ plan, state, paidCalls, efforts = [], effort, onEffort, onState, onOpenRun, searchProvider, literature }: Props) {
  // The Scout is the member that searches. The credit says what it would search with if started now.
  const searches = plan.search.exa || plan.agents.some((a) => a.name === "scout")
  const uid = useId()
  const [step, setStep] = useState<"view" | "confirm">("view")
  const [sending, setSending] = useState(false)
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

  // A practice run costs nothing and the engine cannot spend while paid calls are off, so a confirm step would
  // protect nothing: it starts in one click. Anything else (a paid plan, or paid calls on or not known) is confirmed.
  const quick = !plan.paid && paidCalls === false
  const start = async (direct = false) => {
    if (sending || (direct ? !quick : step !== "confirm" || !!block)) return
    const { errors: found, request } = startRequest(plan, edits, effort)
    setErrors(found); setRefused("")
    const first = (Object.keys(found) as StartControl[])[0]
    if (first) { document.getElementById(`${uid}-${first}`)?.focus(); return }
    setSending(true)
    try { onState({ state: "started", runId: (await startPlan(plan.id, request)).id }) }
    catch (error) {
      const no = error instanceof ChatRefused ? error : new ChatRefused(String(error), 0)
      setSending(false)
      if (no.status === 404) return onState({ state: "expired" })
      if (no.status === 409 && no.run) return onState({ state: "started", runId: no.run })
      const control = no.status === 400 ? controlOf(no.field) : undefined
      if (control) { setErrors({ [control]: no.message }); window.setTimeout(() => document.getElementById(`${uid}-${control}`)?.focus(), 0) }
      else setRefused(no.status === 403 ? `${no.message}${/NO_PAID_CALLS/.test(no.message) ? "" : ` ${HOW_TO_TURN_ON}`}`
        : no.status === 409 ? `${no.message} This plan was already started. Look for it under Team review.` : no.message)
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
        <span className="swarm-eyebrow">{state.state === "started" ? "The plan that was started" : "A plan for a review. Nothing has started."}</span>
        {plan.paid ? <span className="pill" data-kind="warning">Costs money: uses paid models or paid search</span>
          : <><Provenance kind="practice" /><span className="muted small">Fixed text, not real research</span></>}
      </header>
      <h2 id={`${uid}-title`}>{plan.briefTitle || "Team review"}</h2>
      {plan.question.trim() !== (plan.briefTitle || "").trim() && <p className="home-plan-question">“{plan.question}”</p>}

      {state.state === "open" && step !== "confirm" && (quick ? (
        <p className="home-plan-sum">
          {plan.agents.length} team member{plan.agents.length === 1 ? "" : "s"} will discuss it for at most {plan.limits.maxRounds} round{plan.limits.maxRounds === 1 ? "" : "s"}. It is a practice run: the replies are fixed examples, it takes a few seconds and costs nothing.
        </p>
      ) : (
        <>
          <p className="home-plan-sum">
            {plan.agents.length} team member{plan.agents.length === 1 ? "" : "s"} will discuss it and a separate checker tests every statement they make.
            {plan.paid ? " It uses real AI models, so it costs money. Nothing starts until you confirm." : " Nothing starts until you confirm."}
          </p>
          {/* What it may cost and how long it may take, before anything starts. */}
          <dl className="home-plan-limits" aria-label="Limits and cost">
            <div><dt>Most it can cost</dt><dd>${plan.limits.maxUsd.toFixed(2)}</dd></div>
            <div><dt>Estimated cost</dt><dd>{estimateText(plan)}</dd></div>
            <div><dt>Most time</dt><dd>{plainDuration(plan.limits.maxMinutes * 60_000)}</dd></div>
            <div><dt>Rounds</dt><dd>at most {plan.limits.maxRounds}</dd></div>
          </dl>
        </>
      ))}
      {step !== "confirm" || state.state !== "open" ? (
        <Fold folded label={`See what is in this plan (${plan.agents.length} team member${plan.agents.length === 1 ? "" : "s"}, limits, notes)`}>
          {plan.warnings.length > 0 && (
            <ul className="home-warnings" aria-label="Warnings">{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
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
          {searches && searchProvider && <p className="muted small" data-testid="plan-search">The Scout looks for sources. <SearchCredit provider={plan.paid ? searchProvider : "fixture"} /></p>}
          <dl className="home-facts">
            {level && <><dt>Effort</dt><dd>{level.label}</dd></>}
            <dt>Web search (Exa)</dt><dd>{plan.search.exa ? "used (a paid service)" : "not used"}</dd>
            {literature && <><dt>Research papers (Europe PMC)</dt><dd>{plan.paid ? "used when the Scout searches (free)" : "not searched in a practice run"}</dd></>}
            <dt>Models</dt><dd>lead <code>{plan.models.lead}</code> · members <code>{plan.models.members}</code> · checker <code>{plan.models.checker}</code></dd>
            <dt>Limits</dt><dd>at most ${plan.limits.maxUsd.toFixed(2)}, {plainDuration(plan.limits.maxMinutes * 60_000)} and {plan.limits.maxRounds} round{plan.limits.maxRounds === 1 ? "" : "s"} of discussion</dd>
            <dt>Estimated cost</dt><dd>{estimateText(plan)} <span className="muted small">({plan.estimate.basis})</span></dd>
          </dl>
          {state.state === "open" && (
            <details className="home-more home-plan-more">
              <summary>More options</summary>
              <div className="home-plan-moreb">
                {efforts.length > 0 && onEffort && (
                <div className="home-plan-effort" id={`${uid}-effort`} tabIndex={-1}>
                  <EffortPicker efforts={efforts} value={replanning ?? effort} onChange={(id) => void changeEffort(id)} name={`${uid}-effort-pick`} label="Effort for this plan" disabled={!!replanning} />
                  {replanning ? <p className="muted small exp-loading" role="status"><span className="exp-spinner" aria-hidden="true" />Asking the engine for a new plan at this effort…</p>
                    : <p className="muted small">Changing the effort asks the engine for a new plan. The plan below is replaced; nothing starts.</p>}
                  {err("effort")}
                </div>
                )}
                {quick && <p className="muted small"><button type="button" className="link-btn" onClick={() => { setRefused(""); setErrors({}); setStep("confirm") }}>Change the limits or the team before starting</button></p>}
              </div>
            </details>
          )}
          <details className="home-brief">
            <summary>Read what the team would be given (the brief)</summary>
            <div className="memo"><Streamdown>{plan.brief}</Streamdown></div>
          </details>
        </Fold>
      ) : (
        <div className="home-confirm" role="group" aria-label="Confirm before starting">
          <p className={plan.paid ? "newrun-cost" : "muted"}>
            {plan.paid
              ? <><b>This may spend money.</b> It can cost up to the limit below (estimated: {estimateText(plan)}). It stops at the first limit it reaches.</>
              : <>This is a practice run: fixed text instead of models. It costs nothing and does no real research.</>}
          </p>
          <dl className="home-facts">
            {level && <><dt>Effort</dt><dd>{level.label}</dd></>}
            <dt>What runs</dt><dd>A team review with {chosen.length} agent{chosen.length === 1 ? "" : "s"}: {chosen.map((a) => a.title).join(", ") || "none"}</dd>
            <dt>Models</dt><dd>lead <code>{plan.models.lead}</code> · members <code>{plan.models.members}</code> · checker <code>{plan.models.checker}</code></dd>
            <dt>Exa search</dt><dd>{plan.search.exa ? "used (a paid service)" : "not used"}</dd>
            {literature && <><dt>Research papers (Europe PMC)</dt><dd>{plan.paid ? "used when the Scout searches (free)" : "not searched in a practice run"}</dd></>}
          </dl>
          <div className="newrun-row">
            {limit("maxUsd", "Most it may cost (US dollars)", 0.01)}
            {limit("maxMinutes", "Most time it may take (minutes)", 1)}
            {limit("maxRounds", "Most rounds of discussion", 1)}
          </div>
          <fieldset className="newrun-field" id={`${uid}-agents`} tabIndex={-1} aria-describedby={errors.agents ? `${uid}-agents-error` : undefined}>
            <legend>Team members to include</legend>
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

      {paidOff && state.state === "open" && <p className="home-paidoff" role="note">This plan needs paid models or paid search. You are in Demo mode, so it cannot be started. {HOW_TO_TURN_ON}</p>}
      {refused && <p className="newrun-error newrun-refused" role="alert">The plan was not started: {refused}</p>}

      {state.state === "open" && step !== "confirm" && (
        <footer className="newrun-foot">
          <button type="button" className="btn" onClick={() => onState({ state: "discarded" })}>Discard</button>
          {quick
            ? <button type="button" className="btn btn-primary" disabled={!!replanning || sending} onClick={() => void start(true)}>{sending ? "Starting…" : "Start practice run"}</button>
            : <button type="button" className="btn btn-primary" disabled={paidOff || !!replanning} onClick={() => { setAgreed(false); setRefused(""); setErrors({}); setStep("confirm") }}>{plan.paid ? "Start research" : "Start practice run (not research)"}</button>}
        </footer>
      )}
      {state.state === "open" && step === "confirm" && (
        <footer className="newrun-foot">
          <button type="button" className="btn" disabled={sending} onClick={() => { setStep("view"); setAgreed(false) }}>Back</button>
          <button type="button" className="btn btn-primary" disabled={sending || !!block} onClick={() => void start()}>
            {sending ? "Starting…" : plan.paid ? "Start paid research" : "Start practice run (not research)"}
          </button>
        </footer>
      )}
      {state.state === "discarded" && <p className="muted small" role="status">Discarded. Nothing was started. <button type="button" className="link-btn" onClick={() => onState({ state: "open" })}>Bring it back</button></p>}
      {state.state === "expired" && <p className="home-paidoff" role="status">This plan has expired, so it can no longer be started. Ask the question again to get a new plan.</p>}
      {state.state === "started" && <RunFollow runId={state.runId} maxRounds={Number(edits.maxRounds) || plan.limits.maxRounds} onOpen={() => onOpenRun(state.runId)} />}
    </section>
  )
}

/** The plan's contents: in the open for a plan that needs a decision, folded away for a one-click practice plan. */
function Fold({ folded, label, children }: { folded: boolean; label: string; children: ReactNode }) {
  return folded ? <details className="home-plan-fold"><summary>{label}</summary><div className="home-plan-foldb">{children}</div></details> : <>{children}</>
}

/**
 * The board review a plan started. While it runs: the app's waiting look with one plain progress line. When it is
 * done: the decision and a way to see it. The characters beside it are decoration; the label says whether this
 * was a practice run, from the run's own first event.
 */
export function RunFollow({ runId, onOpen, maxRounds }: { runId: string; onOpen: () => void; maxRounds?: number }) {
  const events = useRunEvents(runId)
  const f = boardFacts(events)
  const review = reviewActivity(events)
  const replies = events.filter((e) => e.type === "member.replied").length
  const done = events.find((e) => e.type === "run.finished")
  const progress = events.length === 0 ? "Starting the review…"
    : f.rounds === 0 ? "The team is getting ready…"
    : `The team is discussing: round ${f.rounds}${maxRounds ? ` of ${Math.max(maxRounds, f.rounds)}` : ""} · ${replies} repl${replies === 1 ? "y" : "ies"} so far, ${f.claims.length} statement${f.claims.length === 1 ? "" : "s"} checked`
  return (
    <div className="home-run" role="group" aria-label="The review this plan started">
      <p><StatusPill state={f.state} /> <b>{f.title ?? "The review"}</b> <ModeLabel scripted={f.scripted} /></p>
      {f.state === "running" && <Loading>{progress}</Loading>}
      {f.state === "done" && (
        <>
          <p role="status">
            The review is finished. {f.claims.length - f.unchecked} of {f.claims.length} statement{f.claims.length === 1 ? "" : "s"} checked: {markCount("supported", f.verified)}, {markCount("contradicted", f.contradicted)}, {markCount("insufficient", f.unsupported)}.
            {done?.type === "run.finished" && <span className="muted small"> It took {plainDuration(done.minutes * 60_000)} and {plainCost(done.usd, f.scripted === true)}.</span>}
          </p>
          {f.decision && <p className="home-decision">Decision: {f.decision}</p>}
        </>
      )}
      {f.error && <p className="newrun-error" role="alert">{f.error}</p>}
      <Activity steps={review.steps} working={review.working} place={providerPlace} totalSeconds={review.seconds} />
      <p className="muted small">Run id: <RunId id={runId} /></p>
      <span className="home-run-open">
        {f.state === "done" && <Mascots mood="happy" size={32} />}
        <button type="button" className={f.state === "done" ? "btn btn-primary" : "btn"} onClick={onOpen}>{f.state === "done" ? "See what they found" : "Watch the discussion"}</button>
        {f.state === "done" && <span className="muted small">Or ask a follow-up question in the box below.</span>}
        {f.state === "failed" && <span className="muted small">Ask the question again to get a new plan.</span>}
      </span>
    </div>
  )
}
