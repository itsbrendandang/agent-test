// Home: a chat box for starting research, and what it can use. A question goes to the engine (POST /api/chat); the
// reply says plainly whether a model wrote it. A reply may cite runs and may carry a plan; a plan starts nothing
// until a person confirms it in its card. The conversation is kept for the browser session only.
import { SquarePenIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import "@/design/research.css"
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { SafeMarkdown } from "@/components/SafeMarkdown"
import { HeaderSlot } from "@/components/HeaderSlot"
import { Provenance } from "@/components/Provenance"
import { RecordList, type RecordItem } from "@/components/RecordRow"
import { UserMessage } from "@/components/Thread"
import { ENGINE } from "@/board/api"
import { ChatRefused, getCatalog, sendChat, type Catalog, type ChatReply, type EffortId, type ProviderId } from "@/home/api"
import { chatRequest, effortFacts, effortInEffect, EXAMPLES, loadEffort, loadTurns, MODE_KIND, MODE_LABEL, MODE_MEANS, refuseText, sourcesWords, replanRequest, saveEffort, saveTurns, type Choice, type PlanState, type Turn } from "@/home/chat"
import { PlanCard } from "@/home/PlanCard"
import { plainWhen, runTitle } from "@/lib/format"
import { cancelResearch, DIRECT_ANSWERS_OFF, DirectAnswersOff, ResearchRefused, startResearch } from "@/research/api"
import { AgentsWorking } from "@/research/AgentsWorking"
import { AskBox } from "@/research/AskBox"
import { TryAsking } from "@/research/TryAsking"
import { ResearchAnswer, type Picked } from "@/research/Answer"
import { answerLimitLine, DEMO_LINE } from "@/research/limitLine"
import { threadAnswers, threadOf, useSeenEvents } from "@/research/api"
import { Inspector } from "@/research/Inspector"
import { InspectorPane, InspectorToggle } from "@/research/InspectorPane"
import { loadInspector, saveInspector, tabsOf, useNarrow, type InspectorTab } from "@/research/inspectorState"
import { foldAnswer } from "@/research/model"
import { Working } from "@/research/Working"
import { provenanceOf } from "@/lib/provenance"
import { groupRecords, stamp } from "@/lib/records"
import { boardsRead, boardTitles, useBoardScripted } from "@/lib/scripted"
import { linkTo, setOpen, takeAsk, takeOpenAnswer, viewOfKind } from "@/lib/open"
import { openHelp } from "@/lib/shell"

const AUTO = "auto"
type Problem = { message: string; control: "box" | "model" | "effort" }

export function HomeView({ onOpen }: { onOpen: (view: "Compare" | "Board") => void }) {
  // What this visit starts from, read once: a saved answer opened from Saved research (shown as its question and the
  // answer), else this session's conversation; and a question typed on the Overview, which arrives in the box
  // UNSENT (sending is done here, where the limits are shown). A saved answer being opened wins over that question.
  // A direct answer the Overview started is already this session's conversation (startConversation in home/chat).
  const [start] = useState(() => { const saved = takeOpenAnswer(); return { saved, ask: saved ? undefined : takeAsk() } })
  // A question the Overview asked to be SENT starts a new search: it is not added to an older conversation.
  const [turns, setTurns] = useState<Turn[]>(() => (start.saved ? [{ id: 1, role: "user", content: start.saved.question }, { id: 2, role: "assistant", content: "", research: start.saved }] : start.ask?.send ? [] : loadTurns()))
  const [text, setText] = useState(start.ask && !start.ask.send ? start.ask.question : "")
  const [started, setStarted] = useState<string[]>([]) // the answers started on this visit (not restored ones)
  const [sending, setSending] = useState<string>() // the question that is waiting for its reply
  const [problem, setProblem] = useState<Problem>()
  const [picked, setPicked] = useState(AUTO) // "auto", or "provider model"
  const [catalog, setCatalog] = useState<Catalog | null>()
  const [again, setAgain] = useState(0)
  const [whyNone, setWhyNone] = useState<string>() // why there is no catalog although the engine answered
  // A question sent from the Overview carries the level chosen there (Standard when it names none); it is not remembered as the person's choice.
  const [chosenEffort, setChosenEffort] = useState<string | undefined>(() => (start.ask?.send ? start.ask.effort ?? "standard" : loadEffort()))
  const [stopNote, setStopNote] = useState<string>() // what the engine answered to Stop
  const [pane, setPane] = useState(loadInspector) // the inspector: shown or not, and how wide; remembered
  const [inspect, setInspect] = useState<{ id?: string; tab?: InspectorTab }>({}) // which answer and tab; none = the latest answer
  const [chosenItem, setChosenItem] = useState<Picked & { id: string }>() // the source or statement chosen in an answer or in the inspector
  const narrow = useNarrow()
  const [copied, setCopied] = useState<number>()
  const [statuses, setStatuses] = useState<Record<string, string>>({}) // each direct answer's status, as its own events report it
  const box = useRef<HTMLTextAreaElement>(null)
  const asking = useRef<AbortController | undefined>(undefined)
  const loadedTurns = useRef(turns) // what the page started with
  const thread = useRef<string | undefined>(undefined) // the engine's id for this conversation of direct answers
  const [canAnswer, setCanAnswer] = useState<"unknown" | "here" | "missing">("unknown") // whether this engine can answer directly
  const [answersOff, setAnswersOff] = useState(false) // the engine said direct answers are switched off (Real mode without RESEARCH_PREVIEW=1)

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
          thread.current = started.thread; setCanAnswer("here"); setStarted((old) => [...old, started.id])
          setTurns((old) => { const id = (old.at(-1)?.id ?? 0) + 1; return [...old, { id, role: "user", content: asked }, { id: id + 1, role: "assistant", content: "", research: { id: started.id, question: asked, thread: started.thread } }] })
          return
        } catch (error) {
          if (!(error instanceof ResearchRefused) || error.status !== 404 || error.field) throw error
          setCanAnswer("missing") // an older engine, or direct answers switched off: it can plan a review but not answer directly
          if (error instanceof DirectAnswersOff) setAnswersOff(true) // said under the box, so the plan is not mistaken for an answer
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

  // A question sent from the Overview is submitted once, at the level chosen there, exactly as if it had been typed
  // here and Send pressed: the same token prompt, limits and refusals; Deep makes a plan that waits for its confirm
  // step; a refusal leaves the text in the box with its message. It waits for the engine's catalog, which says which
  // levels exist. The short timer makes it once even where React mounts twice in development.
  const sendNow = useRef(send)
  useEffect(() => { sendNow.current = send })
  const handedOver = useRef(false)
  useEffect(() => {
    const ask = start.ask
    if (!ask?.send || catalog === undefined || handedOver.current) return
    const timer = window.setTimeout(() => { handedOver.current = true; void sendNow.current(ask.question) }, 0)
    return () => window.clearTimeout(timer)
  }, [start, catalog])

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
  const lastAnswer = turns.findLast((t) => t.role === "assistant")?.id
  /** Ask the question of this answer again. The earlier answer stays; the new one is added below it. */
  const retry = (turnId: number) => { const at = turns.findIndex((t) => t.id === turnId); const asked = turns.slice(0, at).findLast((t) => t.role === "user"); if (asked) void send(asked.content) }
  const copy = (turnId: number, answer: string) => { void navigator.clipboard.writeText(answer).then(() => { setCopied(turnId); window.setTimeout(() => setCopied((c) => (c === turnId ? undefined : c)), 2000) }, () => setCopied(undefined)) }
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText

  const answers = turns.flatMap((t) => (t.role === "assistant" && "research" in t ? [t.research.id] : []))
  const inspected = inspect.id && answers.includes(inspect.id) ? inspect.id : answers[answers.length - 1]
  const seenEvents = useSeenEvents(inspected)
  const seenState = useMemo(() => (seenEvents.length ? foldAnswer(seenEvents) : undefined), [seenEvents])
  const composer = seenState?.example ? (
    <div className="empty-note"><p>This example is read-only. Start a new question to do your own research.</p><button type="button" className="btn" onClick={clear}>Start a new question</button></div>
  ) : (
    <AskBox id="home-box" textareaRef={box} rows={empty ? 2 : 1} value={text} autoFocus placeholder={empty ? "Ask a research question…" : "Ask a follow-up…"}
      onChange={(next) => { setText(next); if (problem?.control === "box") setProblem(undefined) }} onSubmit={(asked) => void send(asked)}
      efforts={efforts} effort={effort} onEffort={pickEffort} name="home-effort" busy={sending !== undefined}
      invalid={problem?.control === "box"} describedBy={`home-box-help${problem?.control === "box" ? " home-box-error" : ""}`}
      beforeSend={activeId && <button type="button" className="btn" onClick={stop}>Stop</button>}
      sendLabel={activeId ? "Send (queued)" : undefined} sendTitle={activeId ? "This question will wait in a queue until the answer being written is finished." : undefined}>
      {answersOff && <p className="muted small" role="status" id="home-direct-off">{DIRECT_ANSWERS_OFF}</p>}
      {stopNote && activeId === undefined && <p className="muted small" role="status">{stopNote}</p>}
      {problem?.control === "box" && <p className="newrun-error" id="home-box-error" role="alert">{problem.message}</p>}
      {problem?.control === "effort" && <p className="newrun-error" role="alert">{problem.message}</p>}
      {problem?.control === "model" && <p className="newrun-error" id="home-model-error" role="alert">{problem.message}</p>}
      <div className="search-under">
        <span className="muted small" id="home-box-help">
          {/* One line, true for the mode. In Demo it is said on the empty screen only: an answer carries its own Practice badge. */}
          {demo ? (empty ? DEMO_LINE : "")
            : effort ? answerLimitLine(catalog, effort)
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
    </AskBox>
  )

  // The inspector shows one answer: the one asked for, else the latest. It reads the events that answer received.
  const canInspect = !!inspected && tabsOf(seenState, seenEvents).length > 0
  const showPane = pane.open && canInspect
  const showInspector = (open: boolean) => { const next = { ...pane, open }; setPane(next); saveInspector(next) }
  // A source or a checked statement chosen in an answer opens the inspector's Evidence tab on it (where there is room
  // beside the conversation, or when the inspector is already open), and one chosen there is lit in the answer.
  const pick = (id: string) => (p: Omit<Picked, "n">) => {
    setChosenItem((old) => ({ ...p, id, n: (old?.n ?? 0) + 1 }))
    if (!narrow || pane.open) { setInspect({ id, tab: "evidence" }); if (!pane.open) showInspector(true) }
  }

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
                      <ResearchAnswer id={t.research.id} latest={t.id === lastAnswer} composerStops fresh={started.includes(t.research.id)}
                        onInspect={(tab) => { setInspect({ id: t.research.id, tab }); showInspector(true) }}
                        picked={chosenItem?.id === t.research.id ? chosenItem : undefined} onPick={pick(t.research.id)}
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
                        // Only an AI answer used these runs. Any other reply lists runs that share words with the question, and says only that.
                        <section className="answer-sources" aria-label={sourcesWords(t.reply.mode).heading}>
                          <h2>{sourcesWords(t.reply.mode).heading}</h2>
                          <p className="muted small">{sourcesWords(t.reply.mode).about}</p>
                          <SourceRows runs={t.reply.runs} onOpen={openRun} label={sourcesWords(t.reply.mode).label} />
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
                    {effort !== "deep" && canAnswer !== "missing" ? <AgentsWorking>Sending your question…</AgentsWorking> : <Working>{ catalog?.paidCalls ? "Writing a plan. A real model usually takes about ten seconds…" : demo ? "Searching saved research…" : "Waiting for the reply…"}</Working>}
                  </>
                )}
              </ConversationContent>
              <ConversationScrollButton className="btn home-latest" aria-label="Scroll to the latest message" title="Scroll to the latest message" />
            </Conversation>
          )}

          {composer}

          {empty && (
            <div className="search-start">
              {/* One row: biology questions trending on Google (or curated) from the engine, else the fixed examples. */}
              <TryAsking onPick={(question) => void send(question)} disabled={sending !== undefined} fallback={EXAMPLES} />
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
            <Inspector id={inspected} state={seenState} events={seenEvents} tab={inspect.tab} onTab={(tab) => setInspect({ id: inspected, tab })}
              picked={chosenItem?.id === inspected ? chosenItem : undefined} onPick={pick(inspected)} />
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

interface Listed { startedAt?: number; brief?: string; model?: string; solver?: string; task?: string }
type Cited = NonNullable<ChatReply["runs"]>[number]
/** How long the rows wait for the runs' own titles before they show with what is known. */
const TITLES_WAIT_MS = 4000
/**
 * Saved runs as numbered rows a person can tell apart: the question each was about (the run's own title when it
 * has one), when it ran, and how it was made, each from the run's own record. Runs of the same brief made the same
 * way are one row, the newest, with the others folded under it (the same grouping as Saved research). The key is
 * the record's own: a review's brief file, a task run's task, solver and model. A similar title is never enough,
 * and a run that says less than that stands alone. The rows wait until the runs have said their titles, so the
 * text does not change under the reader. The first three show; the rest are one press away.
 */
function SourceRows({ runs, onOpen, label }: { runs: Cited[]; onOpen: (kind: "swarm" | "board", id: string) => void; label: string }) {
  const [all, setAll] = useState(false)
  const [listed, setListed] = useState<Record<string, Listed>>()
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    let stale = false
    const read = (path: string) => fetch(ENGINE + path).then((r) => (r.ok ? r.json() : []), () => [])
    const text = (v: unknown) => (typeof v === "string" && v ? v : undefined)
    void Promise.all([read("/api/runs"), read("/api/glhf/runs")]).then(([board, swarm]: unknown[]) => {
      if (stale) return
      const out: Record<string, Listed> = {}
      for (const r of Array.isArray(board) ? (board as { id?: unknown; startedAt?: unknown; brief?: unknown }[]) : []) if (typeof r?.id === "string") out[`board:${r.id}`] = { startedAt: typeof r.startedAt === "number" ? r.startedAt : undefined, brief: text(r.brief) }
      for (const r of Array.isArray(swarm) ? (swarm as { id?: unknown; startedAt?: unknown; model?: unknown; solver?: unknown; task?: unknown }[]) : [])
        if (typeof r?.id === "string") out[`swarm:${r.id}`] = { startedAt: typeof r.startedAt === "number" ? r.startedAt : undefined, model: text(r.model), solver: text(r.solver), task: text(r.task) }
      setListed(out)
    })
    const timer = window.setTimeout(() => { if (!stale) setWaited(true) }, TITLES_WAIT_MS)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [])
  const boardIds = useMemo(() => runs.filter((r) => r.kind === "board").map((r) => r.id), [runs])
  const flags = useBoardScripted(boardIds)
  const rowOf = (r: Cited) => listed?.[`${r.kind}:${r.id}`]
  // How a run was made, from its own record: a review's first event, a task run's model. It stays Practice whatever the Next run switch says.
  const madeBy = (r: Cited) => (r.kind === "board" ? provenanceOf(flags[r.id] === undefined ? undefined : { scripted: flags[r.id] }) : provenanceOf({ model: rowOf(r)?.model }))

  // Titles and groups are worked out once, when the engine's lists and every review's first event have answered
  // (or after a short wait, with what is known by then). After that they do not change.
  const [rows, setRows] = useState<{ latest: Cited; title: string; history: Cited[] }[]>()
  const ready = waited || (listed !== undefined && boardsRead(boardIds))
  if (ready && !rows) {
    const titles = boardTitles(boardIds)
    const keyOf = (r: Cited): string | undefined => {
      const row = rowOf(r), made = madeBy(r)
      if (!row || !made) return undefined
      if (r.kind === "board") return row.brief ? `board|${made}|${row.brief}` : undefined
      return row.task && row.solver && row.model ? `swarm|${made}|${row.task}|${row.solver}|${row.model}` : undefined
    }
    const place = new Map(runs.map((r, i) => [r, i]))
    setRows(groupRecords(runs, keyOf, (r) => rowOf(r)?.startedAt ?? 0)
      .sort((a, b) => Math.min(...[a.latest, ...a.history].map((r) => place.get(r)!)) - Math.min(...[b.latest, ...b.history].map((r) => place.get(r)!))) // the engine's order of the rows is kept
      .map((g) => ({ latest: g.latest, history: g.history, title: (g.latest.kind === "board" && titles[g.latest.id]) || runTitle(g.latest.title) })))
  }
  const kindWord = (r: Cited) => (r.kind === "swarm" ? "One agent or a team" : "Review")
  const shown = rows ? (all ? rows : rows.slice(0, 3)) : []
  return (
    <>
      {rows && rows.length < runs.length && <p className="muted small source-grouped">{runs.length} runs in {rows.length} row{rows.length === 1 ? "" : "s"}. Runs of the same brief are together.</p>}
      <ol className="source-rows" aria-label={label} aria-busy={!rows || undefined}>
        {!rows && runs.slice(0, 3).map((r, i) => (
          <li key={`${r.kind}:${r.id}`} className="source-wait">
            <span className="source-n" aria-hidden="true">{i + 1}</span>
            <span className="source-what"><span className="source-line" aria-hidden="true" /><span className="sr-only">{i === 0 ? "Loading saved research…" : ""}</span></span>
          </li>
        ))}
        {shown.map(({ latest: r, title, history }, i) => {
          const row = rowOf(r)
          return (
            <li key={`${r.kind}:${r.id}`}>
              <button type="button" onClick={() => onOpen(r.kind, r.id)} title={`${title}\nRun id: ${r.id}`}>
                <span className="source-n" aria-hidden="true">{i + 1}</span>
                <span className="source-what">
                  <b>{title}</b>
                  <span className="muted small source-meta">
                    <span>{[kindWord(r), row?.startedAt !== undefined && plainWhen(row.startedAt)].filter(Boolean).join(" · ")}</span>
                    <Provenance kind={madeBy(r)} compact />
                  </span>
                  {r.why && <span className="muted small source-why">{r.why}</span>}
                </span>
                <span className="source-open small" aria-hidden="true">Open</span>
              </button>
              {history.length > 0 && (
                // The older runs of the same brief: each with its own time and its own badge, and each can be opened.
                <details className="record-history source-history">
                  <summary><span className="mono">{history.length + 1}</span> runs, latest <span className="mono">{stamp(row?.startedAt)}</span></summary>
                  <RecordList nested noun="earlier run" label={`Earlier runs of: ${title}`} items={history.map((h): RecordItem => ({
                    key: `${h.kind}:${h.id}`, title, type: h.kind === "swarm" ? "Task run" : "Team review", when: rowOf(h)?.startedAt, provenance: madeBy(h), onOpen: () => onOpen(h.kind, h.id),
                  }))} />
                </details>
              )}
            </li>
          )
        })}
      </ol>
      {rows && rows.length > 3 && <button type="button" className="link-btn source-all" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show fewer" : `View all ${rows.length}`}</button>}
    </>
  )
}
