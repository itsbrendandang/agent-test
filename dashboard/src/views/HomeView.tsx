// Home: a chat box for starting research, and what it can use. A question goes to the engine (POST /api/chat); the
// reply says plainly whether a model wrote it. A reply may cite runs and may carry a plan; a plan starts nothing
// until a person confirms it in its card. The conversation is kept for the browser session only.
import { useEffect, useRef, useState } from "react"
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { Loading, Mascots } from "@/components/Crew"
import { UserMessage } from "@/components/Thread"
import { ENGINE } from "@/board/api"
import { PageHead } from "@/components/Shared"
import { ChatRefused, getCatalog, sendChat, type Catalog, type EffortId, type ProviderId } from "@/home/api"
import { CatalogPanel } from "@/home/CatalogPanel"
import { boardScriptedWhy, chatRequest, effortFacts, effortInEffect, EXAMPLES, loadEffort, loadTurns, MAX_MESSAGE, MODE_KIND, MODE_LABEL, refuseText, replanRequest, saveEffort, saveTurns, type Choice, type PlanState, type Turn } from "@/home/chat"
import { EffortPicker } from "@/home/EffortPicker"
import { Checked } from "@/home/Checked"
import { PlanCard } from "@/home/PlanCard"
import { runTitle } from "@/lib/format"
import { setOpen, viewOfKind } from "@/lib/open"

const ABOUT = "Ask a science question. A team of AI agents works on it, and every statement they make gets checked. Nothing is spent until you say so."
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
  const [boardStatus, setBoardStatus] = useState<Parameters<typeof boardScriptedWhy>[0]>() // GET /api/status: what the board would run on
  const box = useRef<HTMLTextAreaElement>(null)
  const asking = useRef<AbortController | undefined>(undefined)

  useEffect(() => {
    let stale = false
    getCatalog().then((c) => { if (!stale) { setCatalog(c); setWhyNone(undefined) } },
      (error: unknown) => { if (!stale) { setCatalog(null); setWhyNone(error instanceof ChatRefused && error.status !== 0 ? error.message : undefined) } })
    return () => { stale = true }
  }, [again])
  useEffect(() => {
    let stale = false
    fetch(`${ENGINE}/api/status`).then((r) => (r.ok ? r.json() : undefined), () => undefined).then((status) => { if (!stale) setBoardStatus(status) })
    return () => { stale = true }
  }, [again])
  useEffect(() => saveTurns(turns), [turns])
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

  // Enter sends, Shift+Enter is a new line, and Enter that confirms an input-method choice (Japanese, Chinese, Korean) does not send: PromptInputTextarea does this.
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
  const level = efforts.find((e) => e.id === effort)
  const effortLine = level ? <>{level.description} <span>{effortFacts(level)}.</span></> : "Pick how much work this question should get."

  return (
    <div className="page home-chat" data-wide>
      <PageHead title="Home" about={ABOUT}>
        {!empty && <button type="button" className="btn" onClick={clear}>Clear conversation</button>}
      </PageHead>
      <div className="home-cols">
        <section className="home-main" aria-label="Conversation">
          <Conversation className="home-log" aria-live="polite" aria-label="Messages">
            <ConversationContent className="home-thread">
              {empty && (
                <ConversationEmptyState className="home-empty">
                  <Mascots size={72} />
                  <h2>Ask a science question.</h2>
                  <p className="home-lead">A team of AI agents works on it, and every statement they make gets checked.</p>
                  {catalog?.paidCalls === false && <p className="home-practice" role="note">You're in Demo mode. Answers are fixed examples, so you can see how it works for free.</p>}
                  <p className="muted small" id="home-examples-hint">Press one to try it. Nothing is spent.</p>
                  <Suggestions className="home-examples" role="group" aria-label="Example questions" aria-describedby="home-examples-hint">
                    {EXAMPLES.map((q) => <Suggestion key={q} suggestion={q} className="btn" onClick={(question) => void send(question)} />)}
                  </Suggestions>
                </ConversationEmptyState>
              )}
              {turns.map((t) => t.role === "user" ? <UserMessage key={t.id}>{t.content}</UserMessage> : (
                <Message key={t.id} from="assistant" role="article" aria-label="Reply" className="home-turn">
                  <MessageContent>
                    <p className="home-mode">
                      <span className="pill" data-kind={MODE_KIND[t.reply.mode]} data-mode={t.reply.mode === "scripted" ? "scripted" : undefined}>{MODE_LABEL[t.reply.mode]}</span>
                      {t.reply.note && <span className="muted small">{t.reply.note}</span>}
                    </p>
                    <p className="home-text">{t.reply.reply}</p>
                    {t.reply.runs && (
                      <ul className="exp-list exp-cited" aria-label="Runs this reply used">
                        {t.reply.runs.map((r) => (
                          <li key={`${r.kind}:${r.id}`}>
                            <button type="button" className="exp-hit card-surface" onClick={() => openRun(r.kind, r.id)}>
                              <span className="exp-head"><b>{runTitle(r.title)}</b><span className="pill" data-kind="outline">{r.kind === "swarm" ? "one agent or a team" : "board review"}</span></span>
                              <span className="muted small run-id" title={`Run id: ${r.id}`}>{r.id}</span>
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
                  </MessageContent>
                </Message>
              ))}
              {sending !== undefined && (
                <>
                  <UserMessage>{sending}</UserMessage>
                  <Loading>Waiting for the engine's reply…</Loading>
                </>
              )}
            </ConversationContent>
            <ConversationScrollButton className="btn home-latest" aria-label="Scroll to the latest message" title="Scroll to the latest message" />
          </Conversation>

          <div className="home-composer">
            <PromptInput onSubmit={(message) => { void send(message.text) }}>
              <PromptInputBody>
                <PromptInputTextarea id="home-box" ref={box} rows={2} maxLength={MAX_MESSAGE + 200} value={text} autoFocus aria-label="Ask a research question"
                  placeholder="Ask a research question. For example: should we advance a compound with a hERG IC50 of 6 µM?"
                  onChange={(e) => { setText(e.currentTarget.value); if (problem?.control === "box") setProblem(undefined) }}
                  onKeyDown={(e) => {
                    // Enter on an empty box says what to do instead of doing nothing (the Send button is disabled then).
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !text.trim()) { e.preventDefault(); void send(text) }
                  }}
                  aria-invalid={problem?.control === "box"} aria-describedby={`home-box-help${problem?.control === "box" ? " home-box-error" : ""}`} />
              </PromptInputBody>
              <PromptInputFooter className="home-composer-foot">
                {/* Clicks in the toolbar stay in the toolbar: the input group would otherwise move the focus away from the control. */}
                <PromptInputTools className="home-tools" onClick={(e) => e.stopPropagation()}>
                  <details className="home-more" open={problem?.control === "effort" || problem?.control === "model" || undefined}>
                    <summary>More options</summary>
                    {efforts.length > 0 && <EffortPicker efforts={efforts} value={effort} onChange={pickEffort} name="home-effort" compact />}
                    <label className="home-model">
                      <span className="small">Model</span>
                      <select value={choice.model ? picked : AUTO} disabled={offered.length === 0} onChange={(e) => { setPicked(e.target.value); if (problem?.control === "model") setProblem(undefined) }}
                        aria-invalid={problem?.control === "model"} aria-describedby={problem?.control === "model" ? "home-model-error" : "home-model-help"}>
                        <option value={AUTO}>{offered.length ? "Let the engine choose" : catalog?.paidCalls === false ? "None in Demo mode" : "Engine default"}</option>
                        {offered.map((o) => <option key={`${o.provider} ${o.model}`} value={`${o.provider} ${o.model}`}>{o.model}</option>)}
                      </select>
                    </label>
                    {efforts.length > 0 && <p className="muted small effort-facts" id="home-effort-facts">{effortLine}</p>}
                  </details>
                </PromptInputTools>
                <PromptInputSubmit className="btn btn-primary" size="sm" aria-label={sending !== undefined ? "Sending…" : "Send"} status={sending !== undefined ? "submitted" : undefined}
                  disabled={sending !== undefined || !text.trim()}>{sending !== undefined ? "Sending…" : "Send"}</PromptInputSubmit>
              </PromptInputFooter>
            </PromptInput>
            {problem?.control === "box" && <p className="newrun-error" id="home-box-error" role="alert">{problem.message}</p>}
            {problem?.control === "effort" && <p className="newrun-error" role="alert">{problem.message}</p>}
            {problem?.control === "model" && <p className="newrun-error" id="home-model-error" role="alert">{problem.message}</p>}
            <p className="muted small">
              <span id="home-box-help">Enter sends. Shift+Enter starts a new line. Do not type API keys here.</span>
              {catalog?.paidCalls === false && <span id="home-model-help"> You are in Demo mode, so no model is asked. A reply is either a word search of past runs or fixed practice text, and each reply says which.</span>}
            </p>
          </div>
        </section>
        <div className="home-side">
          <Checked onOpen={openRun} />
          <CatalogPanel catalog={catalog} why={whyNone} boardWhy={catalog ? boardScriptedWhy(boardStatus, catalog.providers) : undefined} onRetry={() => { setCatalog(undefined); setAgain((n) => n + 1) }} />
        </div>
      </div>
    </div>
  )
}
