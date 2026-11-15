// Home: a chat box for starting research, and what it can use. A question goes to the engine (POST /api/chat); the
// reply says plainly whether a model wrote it. A reply may cite runs and may carry a plan; a plan starts nothing
// until a person confirms it in its card. The conversation is kept for the browser session only.
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react"
import { PageHead } from "@/components/Shared"
import { ChatRefused, getCatalog, sendChat, type Catalog, type EffortId, type ProviderId } from "@/home/api"
import { CatalogPanel } from "@/home/CatalogPanel"
import { chatRequest, effortInEffect, EXAMPLES, loadEffort, loadTurns, MAX_MESSAGE, MODE_KIND, MODE_LABEL, refuseText, replanRequest, saveEffort, saveTurns, type Choice, type PlanState, type Turn } from "@/home/chat"
import { EffortPicker } from "@/home/EffortPicker"
import { Checked } from "@/home/Checked"
import { PlanCard } from "@/home/PlanCard"
import { setOpen, viewOfKind } from "@/lib/open"

const ABOUT = "Ask a research question. The answer says whether a model wrote it, links the runs it used, and may propose a plan that starts only when you confirm it."
const AUTO = "auto"
type Problem = { message: string; control: "box" | "model" | "effort" }

export function HomeView({ onOpen }: { onOpen: (view: "Compare" | "Board") => void }) {
  const [turns, setTurns] = useState<Turn[]>(loadTurns)
  const [text, setText] = useState("")
  const [sending, setSending] = useState<string>() // the question that is waiting for its reply
  const [problem, setProblem] = useState<Problem>()
  const [picked, setPicked] = useState(AUTO) // "auto", or "provider model"
  const [catalog, setCatalog] = useState<Catalog | null>()
  const [again, setAgain] = useState(0)
  const [whyNone, setWhyNone] = useState<string>() // why there is no catalog although the engine answered
  const [chosenEffort, setChosenEffort] = useState(loadEffort)
  const box = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const asking = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    let stale = false
    getCatalog().then((c) => { if (!stale) { setCatalog(c); setWhyNone(undefined) } },
      (error: unknown) => { if (!stale) { setCatalog(null); setWhyNone(error instanceof ChatRefused && error.status !== 0 ? error.message : undefined) } })
    return () => { stale = true }
  }, [again])
  useEffect(() => saveTurns(turns), [turns])
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }) }, [turns, sending])
  useEffect(() => () => asking.current?.abort(), [])

  // Models a person may pick: only from providers whose key the engine has, and only while paid calls are on.
  const offered = catalog?.paidCalls ? catalog.providers.filter((p) => p.keyPresent).flatMap((p) => p.models.map((model) => ({ provider: p.id, model }))) : []
  const efforts = catalog?.efforts ?? []
  const effort = effortInEffect(catalog, chosenEffort)
  const choice: Choice = (() => {
    const hit = offered.find((o) => `${o.provider} ${o.model}` === picked)
    return { ...(hit && { provider: hit.provider as ProviderId, model: hit.model }), ...(effort && { effort }) }
  })()
  const pickEffort = (id: EffortId) => { setChosenEffort(id); saveEffort(id); if (problem?.control === "effort") setProblem(undefined) }

  const send = async (question: string) => {
    if (sending !== undefined) return
    const no = refuseText(question)
    if (no) { setProblem({ message: no, control: "box" }); box.current?.focus(); return }
    const asked = question.trim()
    const request = chatRequest(turns, asked, choice)
    setProblem(undefined); setSending(asked); setText("")
    const stop = (asking.current = new AbortController())
    try {
      const reply = await sendChat(request)
      if (stop.signal.aborted) return
      setTurns((old) => { const id = (old.at(-1)?.id ?? 0) + 1; return [...old, { id, role: "user", content: asked }, { id: id + 1, role: "assistant", content: reply.reply, reply, ...(request.effort && { effort: request.effort }), ...(reply.plan && { plan: { state: "open" } as PlanState }) }] })
    } catch (error) {
      if (stop.signal.aborted) return
      const refused = error instanceof ChatRefused ? error : new ChatRefused(String(error), 0)
      // Nothing was added to the conversation: the question goes back into the box, with the reason next to the control it is about.
      setText(asked)
      setProblem({ message: refused.message, control: refused.field === "provider" || refused.field === "model" ? "model" : refused.field === "effort" ? "effort" : "box" })
    } finally {
      if (!stop.signal.aborted) { setSending(undefined); box.current?.focus() }
    }
  }

  const submit = (e: FormEvent) => { e.preventDefault(); void send(text) }
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends. Shift+Enter is a new line. Enter that confirms an input-method choice (Japanese, Chinese, Korean) does not send.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text) }
  }
  const clear = () => { asking.current?.abort(); setTurns([]); setSending(undefined); setProblem(undefined); setText(""); box.current?.focus() }
  const openRun = (kind: "swarm" | "board", id: string) => { setOpen(kind, id); onOpen(viewOfKind(kind)) }
  /** The plan of one reply, asked for again at another effort. The reply is replaced only when a new plan arrives. */
  const replan = async (turnId: number, next: EffortId): Promise<string | undefined> => {
    const request = replanRequest(turns, turnId, { ...choice, effort: next })
    if (!request) return "The question of this plan is no longer in the conversation. Ask it again."
    try {
      const reply = await sendChat(request)
      if (!reply.plan) return "The engine answered without a plan for this effort, so the plan here is unchanged."
      setTurns((old) => old.map((t) => (t.id === turnId && t.role === "assistant" ? { ...t, content: reply.reply, reply, effort: next, plan: { state: "open" } } : t)))
      return undefined
    } catch (error) { return error instanceof Error ? error.message : String(error) }
  }
  const setPlan = (turnId: number, plan: PlanState) => setTurns((old) => old.map((t) => (t.id === turnId && t.role === "assistant" ? { ...t, plan } : t)))

  const empty = turns.length === 0 && sending === undefined

  return (
    <div className="page home-chat" data-wide>
      <PageHead title="Home" about={ABOUT}>
        {!empty && <button type="button" className="btn" onClick={clear}>Clear conversation</button>}
      </PageHead>
      <div className="home-cols">
        <section className="home-main" aria-label="Conversation">
          <div className="home-log" role="log" aria-live="polite" aria-label="Messages">
            {empty && (
              <div className="home-empty">
                <h2>What do you want to find out?</h2>
                <p className="muted">Ask about past runs, or describe a drug candidate question to get a research plan. Nothing starts and nothing is spent until you confirm a plan.</p>
                <div className="home-examples" role="group" aria-label="Example questions">
                  {EXAMPLES.map((q) => <button key={q} type="button" className="btn" onClick={() => void send(q)}>{q}</button>)}
                </div>
              </div>
            )}
            {turns.map((t) => t.role === "user" ? (
              <article key={t.id} className="home-turn" data-role="user" aria-label="You asked"><p className="home-text">{t.content}</p></article>
            ) : (
              <article key={t.id} className="home-turn" data-role="assistant" aria-label="Reply">
                <p className="home-mode">
                  <span className="pill" data-kind={MODE_KIND[t.reply.mode]}>{MODE_LABEL[t.reply.mode]}</span>
                  {t.reply.note && <span className="muted small">{t.reply.note}</span>}
                </p>
                <p className="home-text">{t.reply.reply}</p>
                {t.reply.runs && (
                  <ul className="exp-list exp-cited" aria-label="Runs this reply used">
                    {t.reply.runs.map((r) => (
                      <li key={`${r.kind}:${r.id}`}>
                        <button type="button" className="exp-hit card-surface" onClick={() => openRun(r.kind, r.id)}>
                          <span className="exp-head"><b>{r.title}</b><span className="pill" data-kind="outline">{r.kind === "swarm" ? "swarm run" : "board review"}</span></span>
                          <span className="muted small run-id" title={r.id}>{r.id}</span>
                          {r.why && <span className="exp-match small">{r.why}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {t.reply.plan && (
                  <PlanCard key={t.reply.plan.id} plan={t.reply.plan} state={t.plan ?? { state: "open" }} paidCalls={catalog?.paidCalls}
                    efforts={efforts} effort={t.reply.plan.effort ?? t.effort} onEffort={(id) => replan(t.id, id)}
                    onState={(s) => setPlan(t.id, s)} onOpenRun={(id) => openRun("board", id)} />
                )}
              </article>
            ))}
            {sending !== undefined && (
              <>
                <article className="home-turn" data-role="user" aria-label="You asked"><p className="home-text">{sending}</p></article>
                <p className="muted small exp-loading" role="status"><span className="exp-spinner" aria-hidden="true" />Waiting for the engine's reply…</p>
              </>
            )}
            <div ref={end} />
          </div>

          <form className="home-composer card-surface" onSubmit={submit}>
            <label htmlFor="home-box">Ask a research question</label>
            <textarea id="home-box" ref={box} rows={2} maxLength={MAX_MESSAGE + 200} value={text} autoFocus placeholder="For example: should we advance a compound with a hERG IC50 of 6 µM?"
              onChange={(e) => { setText(e.currentTarget.value); if (problem?.control === "box") setProblem(undefined) }} onKeyDown={key}
              aria-invalid={problem?.control === "box"} aria-describedby={`home-box-help${problem?.control === "box" ? " home-box-error" : ""}`} />
            {problem?.control === "box" && <p className="newrun-error" id="home-box-error" role="alert">{problem.message}</p>}
            <div className="home-composer-foot">
              {efforts.length > 0 && <EffortPicker efforts={efforts} value={effort} onChange={pickEffort} name="home-effort" />}
              <label className="home-model">
                <span className="small">Model</span>
                <select value={choice.model ? picked : AUTO} disabled={offered.length === 0} onChange={(e) => { setPicked(e.target.value); if (problem?.control === "model") setProblem(undefined) }}
                  aria-invalid={problem?.control === "model"} aria-describedby={problem?.control === "model" ? "home-model-error" : "home-model-help"}>
                  <option value={AUTO}>{offered.length ? "Let the engine choose" : catalog?.paidCalls === false ? "None: paid calls are off" : "Engine default"}</option>
                  {offered.map((o) => <option key={`${o.provider} ${o.model}`} value={`${o.provider} ${o.model}`}>{o.model}</option>)}
                </select>
              </label>
              <button type="submit" className="btn btn-primary" disabled={sending !== undefined || !text.trim()}>{sending !== undefined ? "Sending…" : "Send"}</button>
            </div>
            {problem?.control === "effort" && <p className="newrun-error" role="alert">{problem.message}</p>}
            {problem?.control === "model" && <p className="newrun-error" id="home-model-error" role="alert">{problem.message}</p>}
            <p className="muted small">
              <span id="home-box-help">Enter sends. Shift+Enter starts a new line. Do not type API keys here.</span>
              {catalog?.paidCalls === false && <span id="home-model-help"> Paid calls are off, so no model is asked: replies are keyword searches or fixed text, and each reply says which.</span>}
            </p>
          </form>
        </section>
        <div className="home-side">
          <Checked onOpen={openRun} />
          <CatalogPanel catalog={catalog} why={whyNone} onRetry={() => { setCatalog(undefined); setAgain((n) => n + 1) }} />
        </div>
      </div>
    </div>
  )
}
