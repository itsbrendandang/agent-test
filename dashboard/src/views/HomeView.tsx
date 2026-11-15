// Home: a chat box for starting research, and what it can use. A question goes to the engine (POST /api/chat); the
// reply says plainly whether a model wrote it. A reply may cite runs and may carry a plan; a plan starts nothing
// until a person confirms it in its card. The conversation is kept for the browser session only.
import { SquarePenIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import "@/research/research.css"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { SafeMarkdown } from "@/components/SafeMarkdown"
import { HeaderSlot } from "@/components/HeaderSlot"
import { UserMessage } from "@/components/Thread"
import { ENGINE } from "@/board/api"
import { ChatRefused, getCatalog, sendChat, type Catalog, type ChatReply, type EffortId, type ProviderId } from "@/home/api"
import { chatRequest, effortFacts, effortInEffect, EXAMPLES, loadEffort, loadTurns, MAX_MESSAGE, MODE_KIND, MODE_LABEL, MODE_MEANS, refuseText, replanRequest, saveEffort, saveTurns, type Choice, type PlanState, type Turn } from "@/home/chat"
import { EffortPicker } from "@/home/EffortPicker"
import { PlanCard } from "@/home/PlanCard"
import { plainDuration, plainWhen, runTitle } from "@/lib/format"
import { cancelResearch, ResearchRefused, startResearch } from "@/research/api"
import { ResearchAnswer } from "@/research/Answer"
import { threadAnswers, threadOf, useSeenEvents } from "@/research/api"
import { Inspector } from "@/research/Inspector"
import { InspectorPane, InspectorToggle } from "@/research/InspectorPane"
import { loadInspector, saveInspector, tabsOf, useNarrow, type InspectorTab } from "@/research/inspectorState"
import { foldAnswer } from "@/research/model"
import { Working } from "@/research/Working"
import { boardTitles, useBoardScripted } from "@/lib/scripted"
import { PRACTICE_SHORT } from "@/lib/words"
import { linkTo, setOpen, takeOpenAnswer, viewOfKind } from "@/lib/open"
import { openHelp } from "@/lib/shell"

const AUTO = "auto"
type Problem = { message: string; control: "box" | "model" | "effort" }

export function HomeView({ onOpen }: { onOpen: (view: "Compare" | "Board") => void }) {
  // A saved answer opened from Saved research is shown as its question and the answer; otherwise this session's conversation.
  const [turns, setTurns] = useState<Turn[]>(() => { const saved = takeOpenAnswer(); return saved ? [{ id: 1, role: "user", content: saved.question }, { id: 2, role: "assistant", content: "", research: saved }] : loadTurns() })
  const [text, setText] = useState("")
  const [sending, setSending] = useState<string>() // the question that is waiting for its reply
  const [problem, setProblem] = useState<Problem>()
  const [picked, setPicked] = useState(AUTO) // "auto", or "provider model"
  const [catalog, setCatalog] = useState<Catalog | null>()
  const [again, setAgain] = useState(0)
  const [whyNone, setWhyNone] = useState<string>() // why there is no catalog although the engine answered
  const [chosenEffort, setChosenEffort] = useState(loadEffort)
  const [stopNote, setStopNote] = useState<string>() // what the engine answered to Stop
  const [pane, setPane] = useState(loadInspector) // the inspector: shown or not, and how wide; remembered
  const [inspect, setInspect] = useState<{ id?: string; tab?: InspectorTab }>({}) // which answer and tab; none = the latest answer
  const narrow = useNarrow()
  const [copied, setCopied] = useState<number>()
  const [statuses, setStatuses] = useState<Record<string, string>>({}) // each direct answer's status, as its own events report it
  const box = useRef<HTMLTextAreaElement>(null)
  const asking = useRef<AbortController | undefined>(undefined)
  const loadedTurns = useRef(turns) // what the page started with
  const thread = useRef<string | undefined>(undefined) // the engine's id for this conversation of direct answers
  const [canAnswer, setCanAnswer] = useState<"unknown" | "here" | "missing">("unknown") // whether this engine can answer directly

  useEffect(() => {
    let stale = false
    getCatalog().then((c) => { if (!stale) { setCatalog(c); setWhyNone(undefined) } },
      (error: unknown) => { if (!stale) { setCatalog(null); setWhyNone(error instanceof ChatRefused && error.status !== 0 ? error.message : undefined) } })
    return () => { stale = true }
  }, [again])
  useEffect(() => saveTurns(turns), [turns])
  // After a reload, or when a saved answer is opened: the conversation is the engine's. Its thread is found from the
  // last answer on the page, so a follow-up continues it; and when the page holds only answers of that thread, the
  // engine's list of them replaces the page's (an answer that was queued or asked before is not lost).
  useEffect(() => {
    const last = loadedTurns.current.findLast((t) => t.role === "assistant" && "research" in t)
    if (!last || !("research" in last)) return
    let stale = false
    void (async () => {
      const id = last.research.thread ?? (await threadOf(last.research.id))
      if (stale || !id) return
      if (!thread.current) thread.current = id
      const all = await threadAnswers(id)
      if (stale || all.length === 0) return
      setTurns((old) => {
        const mine = old.flatMap((t) => (t.role === "assistant" ? ["research" in t ? t.research.id : ""] : []))
        if (mine.some((m) => !all.some((a) => a.id === m)) || all.every((a) => mine.includes(a.id))) return old // other kinds of reply on the page, or nothing to add
        return all.flatMap((a, i) => { const was = old.find((t) => t.role === "assistant" && "research" in t && t.research.id === a.id); return [{ id: i * 2 + 1, role: "user" as const, content: a.question }, { id: i * 2 + 2, role: "assistant" as const, content: was?.content ?? "", research: { id: a.id, question: a.question, thread: a.thread } }] })
      })
    })()
    return () => { stale = true }
  }, [])
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

  /**
   * Quick and Standard get a direct, sourced answer on this page (POST /api/research). Deep, and "Have a team
   * review this", make a plan for a team review, which starts nothing until it is confirmed (POST /api/chat).
   * An engine without the answer route gets the plan path for every depth.
   */
  const send = async (question: string, how: "auto" | "review" = "auto") => {
    if (sending !== undefined) return
    const no = refuseText(question)
    if (no) { setProblem({ message: no, control: "box" }); box.current?.focus(); return }
    const asked = question.trim()
    setProblem(undefined); setSending(asked); setText("")
    const stop = (asking.current = new AbortController())
    const direct = how === "auto" && effort !== "deep" && canAnswer !== "missing"
    try {
      if (direct) {
        try {
          const started = await startResearch(asked, effort === "quick" ? "quick" : "standard", thread.current)
          if (stop.signal.aborted) return
          thread.current = started.thread; setCanAnswer("here")
          setTurns((old) => { const id = (old.at(-1)?.id ?? 0) + 1; return [...old, { id, role: "user", content: asked }, { id: id + 1, role: "assistant", content: "", research: { id: started.id, question: asked, thread: started.thread } }] })
          return
        } catch (error) {
          if (!(error instanceof ResearchRefused) || error.status !== 404 || error.field) throw error
          setCanAnswer("missing") // an older engine: it can plan a review but not answer directly
        }
      }
      const request = chatRequest(turns, asked, how === "review" ? { ...choice, effort: choice.effort } : choice)
      const reply = await sendChat(request)
      if (stop.signal.aborted) return
      setTurns((old) => { const id = (old.at(-1)?.id ?? 0) + 1; return [...old, { id, role: "user", content: asked }, { id: id + 1, role: "assistant", content: reply.reply, reply, ...(request.effort && { effort: request.effort }), ...(reply.plan && { plan: { state: "open" } as PlanState }) }] })
    } catch (error) {
      if (stop.signal.aborted) return
      const refused = error instanceof ChatRefused ? error : error instanceof ResearchRefused ? new ChatRefused(error.message, error.status, error.field) : new ChatRefused(String(error), 0)
      // Nothing was added to the conversation: the question goes back into the box, with the reason next to the control it is about.
      setText(asked)
      setProblem({ message: refused.message, control: refused.field === "provider" || refused.field === "model" ? "model" : refused.field === "effort" ? "effort" : "box" })
    } finally {
      if (!stop.signal.aborted) { setSending(undefined); box.current?.focus() }
    }
  }

  // Enter sends, Shift+Enter is a new line, and Enter that confirms an input-method choice (Japanese, Chinese, Korean) does not send: PromptInputTextarea does this.
  const clear = () => { asking.current?.abort(); thread.current = undefined; setTurns([]); setSending(undefined); setProblem(undefined); setText(""); box.current?.focus() }
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
  const demo = catalog?.paidCalls === false
  // The answer being made now (not one that is only waiting): the composer offers Stop for it.
  const active = turns.find((t) => t.role === "assistant" && "research" in t && ["starting", "running"].includes(statuses[t.research.id] ?? "starting"))
  const activeId = active && "research" in active ? active.research.id : undefined
  const stop = () => { if (activeId) void cancelResearch(activeId).then((message) => setStopNote(message)) }
  const firstQuestion = turns.find((t) => t.role === "user")?.content ?? sending ?? ""
  const cap = effort === "quick" || effort === "standard" ? catalog?.research?.[effort] : undefined
  const lastAnswer = turns.findLast((t) => t.role === "assistant")?.id
  /** Ask the question of this answer again. The earlier answer stays; the new one is added below it. */
  const retry = (turnId: number) => { const at = turns.findIndex((t) => t.id === turnId); const asked = turns.slice(0, at).findLast((t) => t.role === "user"); if (asked) void send(asked.content) }
  const copy = (turnId: number, answer: string) => { void navigator.clipboard.writeText(answer).then(() => { setCopied(turnId); window.setTimeout(() => setCopied((c) => (c === turnId ? undefined : c)), 2000) }, () => setCopied(undefined)) }
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText

  const composer = (
    <div className="search-composer">
      <PromptInput onSubmit={(message) => { void send(message.text) }}>
        <PromptInputBody>
          <PromptInputTextarea id="home-box" ref={box} rows={empty ? 2 : 1} maxLength={MAX_MESSAGE + 200} value={text} autoFocus aria-label="Ask a research question"
            placeholder={empty ? "Ask a research question…" : "Ask a follow-up…"}
            onChange={(e) => { setText(e.currentTarget.value); if (problem?.control === "box") setProblem(undefined) }}
            onKeyDown={(e) => {
              // Enter on an empty box says what to do instead of doing nothing (the Send button is disabled then).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !text.trim()) { e.preventDefault(); void send(text) }
            }}
            aria-invalid={problem?.control === "box"} aria-describedby={`home-box-help${problem?.control === "box" ? " home-box-error" : ""}`} />
        </PromptInputBody>
        <PromptInputFooter className="search-foot">
          {/* Clicks in the toolbar stay in the toolbar: the input group would otherwise move the focus away from the control. */}
          <PromptInputTools className="search-tools" onClick={(e) => e.stopPropagation()}>
            {efforts.length > 0 && <EffortPicker efforts={efforts} value={effort} onChange={pickEffort} name="home-effort" compact />}
          </PromptInputTools>
          <span className="search-send">
            {activeId && <button type="button" className="btn" onClick={stop}>Stop</button>}
            <PromptInputSubmit className="btn btn-primary" size="sm" aria-label={sending !== undefined ? "Sending…" : "Send"} status={sending !== undefined ? "submitted" : undefined}
              disabled={sending !== undefined || !text.trim()} title={sending !== undefined ? "Your question is being sent." : !text.trim() ? "Type a question first." : activeId ? "This question will wait in a queue until the answer being written is finished." : undefined}>
              {sending !== undefined ? "Sending…" : activeId ? "Send (queued)" : "Send"}</PromptInputSubmit>
          </span>
        </PromptInputFooter>
      </PromptInput>
      {stopNote && activeId === undefined && <p className="muted small" role="status">{stopNote}</p>}
      {problem?.control === "box" && <p className="newrun-error" id="home-box-error" role="alert">{problem.message}</p>}
      {problem?.control === "effort" && <p className="newrun-error" role="alert">{problem.message}</p>}
      {problem?.control === "model" && <p className="newrun-error" id="home-model-error" role="alert">{problem.message}</p>}
      <div className="search-under">
        <span className="muted small" id="home-box-help">
          {effort === "deep" ? <>Deep plans a team review and asks you before anything starts{level ? `: at most $${level.limits.maxUsd.toFixed(2)} and ${plainDuration(level.limits.maxMinutes * 60_000)}` : ""}.</>
            : effort ? <>{effort === "quick" ? "Quick" : "Standard"} answers on this page, with sources{cap ? `: at most $${cap.maxUsd.toFixed(2)} and ${plainDuration(cap.maxSeconds * 1000)}` : ""}.{demo && " In Demo it is example text."}</>
            : "Enter sends. Shift+Enter adds a line."}
        </span>
        <details className="search-options" open={problem?.control === "effort" || problem?.control === "model" || undefined}>
          <summary>Research options</summary>
          <div className="search-optionsb">
            {level && (
              <p className="small effort-facts" id="home-effort-facts">
                <b>{level.label}.</b> {level.description} <span className="muted">Limits for one research run: {effortFacts(level)}. You see the plan, its limits and its cost before anything starts.</span>
              </p>
            )}
            <label className="home-model">
              <span className="small">Model</span>
              <select value={choice.model ? picked : AUTO} disabled={offered.length === 0} onChange={(e) => { setPicked(e.target.value); if (problem?.control === "model") setProblem(undefined) }}
                aria-invalid={problem?.control === "model"} aria-describedby={problem?.control === "model" ? "home-model-error" : undefined}>
                <option value={AUTO}>{offered.length ? "Let the engine choose" : demo ? "Not available in Demo mode" : "Engine default"}</option>
                {offered.map((o) => <option key={`${o.provider} ${o.model}`} value={`${o.provider} ${o.model}`}>{o.model}</option>)}
              </select>
            </label>
            <p className="muted small">Do not type API keys here. Keys and models are set up in Settings.</p>
          </div>
        </details>
      </div>
    </div>
  )

  // The inspector shows one answer: the one asked for, else the latest. It reads the events that answer received.
  const answers = turns.flatMap((t) => (t.role === "assistant" && "research" in t ? [t.research.id] : []))
  const inspected = inspect.id && answers.includes(inspect.id) ? inspect.id : answers[answers.length - 1]
  const seenEvents = useSeenEvents(inspected)
  const seenState = useMemo(() => (seenEvents.length ? foldAnswer(seenEvents) : undefined), [seenEvents])
  const canInspect = !!inspected && tabsOf(seenState, seenEvents).length > 0
  const showPane = pane.open && canInspect
  const showInspector = (open: boolean) => { const next = { ...pane, open }; setPane(next); saveInspector(next) }

  return (
    <div className="page search" data-wide data-empty={empty || undefined}>
      <div className="search-cols" data-inspector={(showPane && !narrow) || undefined}>
        <section className="search-main" aria-label="Search">
          {empty ? (
            <header className="search-hero">
              <h1>What do you want to research?</h1>
              <p>Ask a question. Explore evidence and sources.</p>
            </header>
          ) : (
            <>
              {/* The shell's header row names the place; this view adds the conversation's title and its one action there. */}
              <h1 className="sr-only">Research conversation</h1>
              <HeaderSlot area="title"><span className="header-title" title={firstQuestion}>{firstQuestion}</span></HeaderSlot>
              <HeaderSlot area="actions">
                <button type="button" className="btn search-new" onClick={clear} aria-label="New search" title="New search"><SquarePenIcon aria-hidden="true" size={16} className="search-new-icon" /><span>New search</span></button>
                {canInspect && <InspectorToggle open={showPane} onToggle={() => showInspector(!showPane)} />}
              </HeaderSlot>
            </>
          )}

          {!empty && (
            <Conversation className="search-log" aria-live="polite" aria-label="Messages" targetScrollTop={atLatestQuestion}>
              <ConversationContent className="search-thread">
                {turns.map((t) => t.role === "user" ? <UserMessage key={t.id}>{t.content}</UserMessage> : "research" in t ? (
                  <Message key={t.id} from="assistant" role="article" aria-label="Answer" className="answer">
                    <MessageContent>
                      <ResearchAnswer id={t.research.id} latest={t.id === lastAnswer} composerStops
                        onInspect={(tab) => { setInspect({ id: t.research.id, tab }); showInspector(true) }}
                        onStatus={(st) => setStatuses((old) => (old[t.research.id] === st ? old : { ...old, [t.research.id]: st }))}
                        onRemove={() => setTurns((old) => { const at = old.findIndex((o) => o.id === t.id); return old.filter((_, i) => i !== at && !(i === at - 1 && old[i].role === "user")) })}
                        onAgain={sending === undefined ? () => void send(t.research.question) : undefined}
                        onReview={sending === undefined ? () => void send(t.research.question, "review") : undefined}
                        onDone={(done) => setTurns((old) => old.map((o) => (o.id === t.id && o.content !== done.markdown ? { ...o, content: done.markdown } : o)))} />
                    </MessageContent>
                  </Message>
                ) : t.reply.mode === "keyword" ? (
                  // A keyword search of saved runs is a list of matches. It is not an answer and is never shown as one.
                  <Message key={t.id} from="assistant" role="article" aria-label="Matching saved research" className="answer saved-matches">
                    <MessageContent>
                      <h2 className="matches-title">Matching saved research</h2>
                      {t.reply.runs && t.reply.runs.length > 0 ? (
                        <>
                          <p className="matches-sum">
                            Found {t.reply.runs.length} matching run{t.reply.runs.length === 1 ? "" : "s"}.{" "}
                            <span className="muted" title="These runs contain words from your question. Nothing read or answered the question, and the list is not ranked by relevance.">Keyword matches from saved runs.</span>
                          </p>
                          <SourceRows runs={t.reply.runs} onOpen={openRun} label="Matching saved runs" />
                        </>
                      ) : <p className="matches-sum">No matching research found. Try a shorter question or different keywords.</p>}
                      <div className="answer-actions">
                        {canCopy && t.reply.runs && t.reply.runs.length > 0 && (
                          <button type="button" className="link-btn" onClick={() => copy(t.id, t.reply.runs!.map((r) => `${runTitle(r.title)}\n${linkTo(r.kind, r.id)}`).join("\n\n"))}>{copied === t.id ? "Copied" : "Copy links"}</button>
                        )}
                        {t.id === lastAnswer && <button type="button" className="link-btn" disabled={sending !== undefined} onClick={() => retry(t.id)}>Search again</button>}
                      </div>
                    </MessageContent>
                  </Message>
                ) : (
                  <Message key={t.id} from="assistant" role="article" aria-label="Answer" className="answer">
                    <MessageContent>
                      <p className="answer-kind">
                        <span className="pill" data-kind={MODE_KIND[t.reply.mode]} data-mode={t.reply.mode === "scripted" ? "scripted" : undefined}>{MODE_LABEL[t.reply.mode]}</span>
                        <span className="muted small">{MODE_MEANS[t.reply.mode]}</span>
                      </p>
                      <SafeMarkdown className="answer-text">{t.reply.reply}</SafeMarkdown>
                      {/* The engine's note says who wrote an AI answer. For the other two kinds the line above already says what they are. */}
                      {t.reply.note && t.reply.mode === "ai" && <p className="muted small answer-note">{t.reply.note}</p>}
                      {t.reply.runs && t.reply.runs.length > 0 && (
                        <section className="answer-sources" aria-label="Sources">
                          <h2>Sources</h2>
                          <p className="muted small">Saved research this answer used. Open one to read it and see how each statement in it was checked.</p>
                          <SourceRows runs={t.reply.runs} onOpen={openRun} />
                        </section>
                      )}
                      {t.reply.plan && (
                        <PlanCard key={t.reply.plan.id} plan={t.reply.plan} state={t.plan ?? { state: "open" }} paidCalls={catalog?.paidCalls}
                          searchProvider={catalog?.search.provider} literature={catalog?.search.literature?.available} efforts={efforts} effort={t.reply.plan.effort ?? t.effort} onEffort={(id) => replan(t.id, id)}
                          onState={(s) => setPlan(t.id, s)} onOpenRun={(id) => openRun("board", id)} />
                      )}
                      <div className="answer-actions">
                        {canCopy && <button type="button" className="link-btn" onClick={() => copy(t.id, t.reply.reply)}>{copied === t.id ? "Copied" : "Copy answer"}</button>}
                        {t.id === lastAnswer && <button type="button" className="link-btn" disabled={sending !== undefined} onClick={() => retry(t.id)}>Ask again</button>}
                      </div>
                    </MessageContent>
                  </Message>
                ))}
                {sending !== undefined && (
                  <>
                    <UserMessage>{sending}</UserMessage>
                    <Working>{effort !== "deep" && canAnswer !== "missing" ? "Starting…" : catalog?.paidCalls ? "Writing a plan. A real model usually takes about ten seconds…" : demo ? "Searching saved research…" : "Waiting for the reply…"}</Working>
                  </>
                )}
              </ConversationContent>
              <ConversationScrollButton className="btn home-latest" aria-label="Scroll to the latest message" title="Scroll to the latest message" />
            </Conversation>
          )}

          {composer}

          {empty && (
            <div className="search-start">
              <Suggestions className="search-examples" role="group" aria-label="Example questions">
                {EXAMPLES.map((q) => <Suggestion key={q} suggestion={q} className="btn" onClick={(question) => void send(question)} />)}
              </Suggestions>
              {demo && <p className="search-demo" role="note"><b>Demo mode.</b> AI answers and web search are unavailable. You can search saved research.</p>}
              {catalog === null && (
                <p className="search-demo" role="alert">
                  {whyNone
                    ? <>Something went wrong inside the app's engine, so the depth options are missing. You can still ask a question. <span className="muted small" title={whyNone}>(Details: {whyNone})</span></>
                    : "The app's engine isn't running. Start it with: npm start."}{" "}
                  <button type="button" className="link-btn" onClick={() => { setCatalog(undefined); setAgain((n) => n + 1) }}>Try again</button>
                </p>
              )}
            </div>
          )}
          {empty && <p className="search-more"><button type="button" className="link-btn" onClick={openHelp}>How this works</button></p>}
        </section>
        {showPane && inspected && seenState && (
          <InspectorPane narrow={narrow} width={pane.width} onClose={() => showInspector(false)} onWidth={(width) => { const next = { ...pane, width }; setPane(next); saveInspector(next) }}>
            <Inspector id={inspected} state={seenState} events={seenEvents} tab={inspect.tab} onTab={(tab) => setInspect({ id: inspected, tab })} />
          </InspectorPane>
        )}
      </div>
    </div>
  )
}

/**
 * Where the conversation settles. It follows new lines only until the latest question reaches the top of the visible
 * area: from then on the reader is at the beginning of the answer and stays there while the rest is written below,
 * and opening a section (the activity, the sources) moves nothing. A reader who scrolls away is left alone.
 */
const atLatestQuestion = (bottom: number, { scrollElement, contentElement }: { scrollElement: HTMLElement; contentElement: HTMLElement }): number => {
  const asked = contentElement.querySelectorAll<HTMLElement>(".thread-user")
  const last = asked[asked.length - 1]
  if (!last) return bottom
  const top = last.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop
  return Math.max(0, Math.min(bottom, top - 12))
}

interface Listed { startedAt?: number; scripted?: boolean; solver?: string; task?: string }
/**
 * The saved research an answer used, as numbered rows a person can tell apart: the question it was about (the
 * run's own title when it has one), when it ran, and whether it was real or a practice run, each from the run's
 * own record. The first five show; the rest are one press away.
 */
function SourceRows({ runs, onOpen, label = "Saved research this answer used" }: { runs: NonNullable<ChatReply["runs"]>; onOpen: (kind: "swarm" | "board", id: string) => void; label?: string }) {
  const [all, setAll] = useState(false)
  const [listed, setListed] = useState<Record<string, Listed>>({})
  useEffect(() => {
    let stale = false
    const read = (path: string) => fetch(ENGINE + path).then((r) => (r.ok ? r.json() : []), () => [])
    void Promise.all([read("/api/runs"), read("/api/glhf/runs")]).then(([board, swarm]: unknown[]) => {
      if (stale) return
      const out: Record<string, Listed> = {}
      for (const r of Array.isArray(board) ? (board as { id?: unknown; startedAt?: unknown }[]) : []) if (typeof r?.id === "string") out[`board:${r.id}`] = { startedAt: typeof r.startedAt === "number" ? r.startedAt : undefined }
      for (const r of Array.isArray(swarm) ? (swarm as { id?: unknown; startedAt?: unknown; model?: unknown; solver?: unknown; task?: unknown }[]) : [])
        if (typeof r?.id === "string") out[`swarm:${r.id}`] = { startedAt: typeof r.startedAt === "number" ? r.startedAt : undefined, scripted: typeof r.model === "string" ? r.model === "mock" : undefined }
      setListed(out)
    })
    return () => { stale = true }
  }, [])
  const shown = all ? runs : runs.slice(0, 3)
  const boardIds = shown.filter((r) => r.kind === "board").map((r) => r.id)
  const flags = useBoardScripted(boardIds)
  const titles = boardTitles(boardIds)
  return (
    <>
      <ol className="source-rows" aria-label={label}>
        {shown.map((r, i) => {
          const row = listed[`${r.kind}:${r.id}`]
          const scripted = r.kind === "board" ? flags[r.id] : row?.scripted
          const title = (r.kind === "board" && titles[r.id]) || runTitle(r.title)
          return (
            <li key={`${r.kind}:${r.id}`}>
              <button type="button" onClick={() => onOpen(r.kind, r.id)} title={`${title}\nRun id: ${r.id}`}>
                <span className="source-n" aria-hidden="true">{i + 1}</span>
                <span className="source-what">
                  <b>{title}</b>
                  <span className="muted small">
                    {[r.kind === "swarm" ? "One agent or a team" : "Review", row?.startedAt !== undefined && plainWhen(row.startedAt), scripted === true ? PRACTICE_SHORT : scripted === false ? "real model" : undefined].filter(Boolean).join(" · ")}
                  </span>
                  {r.why && <span className="muted small source-why">{r.why}</span>}
                </span>
                <span className="source-open small" aria-hidden="true">Open</span>
              </button>
            </li>
          )
        })}
      </ol>
      {runs.length > 3 && <button type="button" className="link-btn source-all" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show fewer" : `View all ${runs.length}`}</button>}
    </>
  )
}
