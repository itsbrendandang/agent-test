// Team review (the board). By default a plain summary: is the team working, what did it decide, and what did the
// checks find. "See how each statement was checked" opens the counts, the written decision and the team.
import { lastRun, linkTo, setOpen, showing, takeOpen } from "@/lib/open"
import { useEffect, useMemo, useState } from "react"
import { Streamdown } from "streamdown"
import { DATABASES, get, memo as fetchMemo, post, type BoardEvent, type RosterMember, type RunSummary, type SearchProvider, type Status, useRunEvents, type Verdict } from "@/board/api"
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation"
import { Loading } from "@/components/Crew"
import { Provenance } from "@/components/Provenance"
import { SafeMarkdown } from "@/components/SafeMarkdown"
import { EngineOffline, MarkChip, MarksLegend, PageHead, SearchCredit, StatusPill } from "@/components/Shared"
import { TeamMessage, type Checked } from "@/components/Thread"
import { AgentAvatar } from "@/lab/AgentAvatar"
import { agentIdentity } from "@/lab/identity"
import { provenanceOf } from "@/lib/provenance"
import { PROVIDERS } from "@/research/providers"
import { uncheckedReasons } from "@/lib/verdict"
import { BOARD_JOB, checkedOf, leadSentence, MARK_WORD, markOf, runLimit, safeUrl, spent as spentWords } from "@/lib/words"
import { boardScriptedWhy } from "@/home/chat"
import { problemOf, type Problem } from "@/lib/engine"
import { runState } from "@/lib/status"
import { plainCost, plainDuration, plainTitle, plainWhen } from "@/lib/format"
import "@/board/board.css"

type Of<T extends BoardEvent["type"]> = Extract<BoardEvent, { type: T }>
const VERDICTS: Verdict[] = ["verified", "contradicted", "unsupported", "unchecked"]

/** "## Heading" sections of the memo, keyed by lowercase heading. */
function sections(md: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of md.split(/^## /m).slice(1)) {
    const [head, ...body] = part.split("\n")
    out[head.trim().toLowerCase()] = body.join("\n").trim()
  }
  return out
}
const bullets = (s = "") => s.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim()).filter(Boolean)
const plain = (s = "") => s.replace(/[*_`]+/g, "").trim()
const SHORT_REASONING = 600 // characters: reasoning up to this length is open on arrival
const ABOUT = "A team of AI agents discusses a research brief. A separate check tests their statements against sources, and the lead writes the decision."

// The cheap model's ruling settled the claim ("jev" is the same thing in runs made before the checker changed).
const firstPass = (c: { checker?: string }) => c.checker === "first-pass" || c.checker === "jev"

/** What the screening model said about a source. The engine records only "yes" (1) or "partly" (0.5): words, never a score. */
const screened = (relevance: unknown): string | undefined => (relevance === 1 ? "Relevant" : relevance === 0.5 ? "Partly relevant" : undefined)
/** "Scout (Data Inspector)" -> the name and the plain job. */
const nameAndJob = (title: string) => { const m = /^(.*?)\s*\((.+)\)\s*$/.exec(title); return m ? { name: m[1], job: m[2] } : { name: title, job: undefined } }
/** Who ruled on a statement, in plain words. The model id, when the run recorded one, is kept. */
const checkerName = (c: { checker?: string; checkedBy?: string }) => {
  const what = firstPass(c) ? "the quick first check" : c.checker === "openai" || c.checker === "claude-code" ? "the second, careful check" : c.checker
  return c.checkedBy && c.checkedBy !== "scripted" ? `${what} (${c.checkedBy})` : c.checkedBy === "scripted" ? `${what} (practice: no model)` : what
}

export function BoardView() {
  const [status, setStatus] = useState<Status>()
  const [problem, setProblem] = useState<Problem>() // set when the board could not be loaded
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [briefs, setBriefs] = useState<string[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [brief, setBrief] = useState("")
  const [opened] = useState(() => takeOpen("board")) // a review another view asked to open ("See what they found")
  const [runId, setRunId] = useState<string | undefined>(() => opened ?? lastRun("board")) // else the review shown last time
  const [copied, setCopied] = useState(false)
  useEffect(() => showing("board", runId), [runId])
  const [error, setError] = useState("")
  const [memoOf, setMemoOf] = useState<{ runId: string; text: string }>()
  // Someone who asked to see a review wants the discussion: it is open on arrival. Otherwise the last choice is kept.
  const [details, setDetails] = useState(() => opened !== undefined || localStorage.getItem("board.details") === "1")
  const events = useRunEvents(runId)

  useEffect(() => localStorage.setItem("board.details", details ? "1" : "0"), [details])
  const refresh = () => get<RunSummary[]>("/api/runs").then((r) => { setRuns(r); setRunId((id) => id ?? r[0]?.id) })
  const load = () => {
    Promise.all([get<Status>("/api/status"), get<RosterMember[]>("/api/roster"), get<string[]>("/api/briefs")])
      .then(([s, r, b]) => { setProblem(undefined); setStatus(s); setRoster(r); setBriefs(b); setBrief((old) => old || (b[0] ?? "")); return refresh() })
      .catch((error: unknown) => setProblem(problemOf(error)))
  }
  useEffect(load, [])

  const memoWritten = events.some((e) => e.type === "memo.written")
  useEffect(() => { if (runId && memoWritten) void fetchMemo(runId).then((text) => setMemoOf({ runId, text })) }, [runId, memoWritten])
  // The memo belongs to one run: another run's memo is never shown while the new one loads.
  const memoText = memoOf && memoOf.runId === runId && memoWritten ? memoOf.text : ""
  const finished = events.some((e) => e.type === "run.finished" || e.type === "run.failed")
  useEffect(() => { if (finished) void refresh() }, [finished])

  const start = async () => {
    setError("")
    try { const { runId } = await post<{ runId: string }>("/api/runs", { brief }); setRunId(runId); await refresh() }
    catch (e) { setError(String(e instanceof Error ? e.message : e)) }
  }

  const rounds = useMemo(() => {
    const byRound = new Map<number, { head?: Of<"round.started">; replies: Of<"member.replied">[]; claims: Of<"claim.checked">[]; searches: Of<"evidence.triaged">[] }>()
    const slot = (n: number) => byRound.get(n) ?? byRound.set(n, { replies: [], claims: [], searches: [] }).get(n)!
    let now = 1 // a search has no round of its own: it belongs to the round that was running
    for (const e of events) {
      if (e.type === "round.started") { slot(e.round).head = e; now = e.round }
      if (e.type === "evidence.triaged") slot(now).searches.push(e)
      if (e.type === "member.replied") slot(e.round).replies.push(e)
      if (e.type === "claim.checked") slot(e.round).claims.push(e)
    }
    return [...byRound.entries()].sort(([a], [b]) => a - b)
  }, [events])

  const claims = events.filter((e): e is Of<"claim.checked"> => e.type === "claim.checked")
  const count = (v: Verdict) => claims.filter((c) => c.verdict === v).length
  const evidence = events.filter((e): e is Of<"evidence.triaged"> => e.type === "evidence.triaged")
  const dropped = evidence.reduce((n, e) => n + e.dropped, 0)
  // Who found the sources, as the run recorded it. Old runs do not say; then nothing is claimed.
  const startedAs = events.find((e): e is Of<"run.started"> => e.type === "run.started")?.mock
  // An older run does not say: then it follows from the run's own flag (a practice run never searched for real).
  const providerOf = (e: { provider?: SearchProvider }): SearchProvider | undefined => e.provider ?? (startedAs === true ? "fixture" : startedAs === false ? "exa" : undefined)
  const spent = events.reduce((n, e) => n + (e.type === "member.replied" && typeof e.usd === "number" ? e.usd : 0), 0)
  const litSearches = evidence.filter((e) => providerOf(e) === "europepmc").length
  const dbSearches = evidence.filter((e) => { const p = providerOf(e); return !!p && DATABASES.includes(p) }).length
  const webSearches = evidence.filter((e) => { const p = providerOf(e); return p !== "europepmc" && p !== "fixture" && !(p && DATABASES.includes(p)) }).length // a practice run's example sources are not searches
  const cap = (n: number | undefined) => (n ? ` of ${n}` : "")
  const current = rounds.at(-1)?.[1]
  const members = roster.filter((m) => m.role === "member")
  const live = !finished && events.length > 0
  const done = events.find((e): e is Of<"run.finished"> => e.type === "run.finished")
  const failed = events.find((e): e is Of<"run.failed"> => e.type === "run.failed")
  // The run's own roster names everyone who spoke in it, also method specialists that the engine's standing roster does not list.
  const ran = events.find((e): e is Of<"run.roster"> => e.type === "run.roster")?.members ?? []
  const title = (name: string) => ran.find((m) => m.name === name)?.title ?? roster.find((m) => m.name === name)?.title ?? plainTitle(name)
  // Who is listed as taking part: the run's own roster when it recorded one (it also names specialists), else the engine's.
  const took: { name: string; title: string }[] = ran.some((m) => m.role === "member") ? ran.filter((m) => m.role === "member") : members
  const specialist = (name: string) => ran.find((m) => m.name === name)?.source === "specialist"
  // Scripted or real is a fact of the run on screen (its run.started event). The engine's state now only says what a new review would use.
  const scripted = startedAs ?? status?.mock ?? false
  const nextWhy = `${boardScriptedWhy(status) ?? "The engine is in practice mode: board reviews are practice runs only"}.`
  const resume = async () => {
    if (!runId) return
    setError("")
    try { await post(`/api/runs/${encodeURIComponent(runId)}/resume`); await refresh() }
    catch (e) { setError(`This review was not resumed: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const memo = sections(memoText)
  const maxRounds = status?.meeting.max_rounds ?? 4

  if (problem) return (
    <div className="page board">
      <PageHead title="Team review" about={ABOUT} />
      <EngineOffline needs="Reviews run in the engine." said={problem.said} onRetry={load} />
    </div>
  )

  // One plain sentence about where the run is, and when it is over, what happened in it.
  const spoke = new Set(events.flatMap((e) => (e.type === "member.replied" ? [e.member] : []))).size
  const marks = { supported: count("verified"), contradicted: count("contradicted"), insufficient: count("unsupported"), unchecked: count("unchecked") }
  const checked = claims.length - marks.unchecked
  // Never a bare total: how many statements there were, and how many of them a check actually ruled on.
  const said = `${spoke} team member${spoke === 1 ? "" : "s"} made ${claims.length} statement${claims.length === 1 ? "" : "s"}${claims.length ? `; ${checked} of them ${checked === 1 ? "was" : "were"} checked` : ""}.`
  const whyNot = uncheckedReasons(claims)
  const lead = roster.find((m) => m.role === "lead")
  const known = runs.some((r) => r.id === runId)
  const headline = !status ? "Loading the review…"
    : !runId ? "No reviews yet. Pick a brief and press Start a review. With Demo chosen it is a practice run: fixed example answers, free."
    : runs.length > 0 && !known && events.length === 0 ? "That review could not be found. It may have been deleted. Pick another one from the list above."
    : failed ? "The run stopped with an error."
    : done ? `The team has decided. ${said}`
    : memoWritten ? "Writing the decision…"
    : current ? `The team is discussing: round ${rounds.at(-1)![0]} of ${Math.max(maxRounds, rounds.at(-1)![0])} · ${current.replies.length} of ${members.length} have replied.`
    : "Starting the review…"
  const progress = done ? 1 : Math.min(0.95, ((rounds.length - 1) + (current ? current.replies.length / Math.max(1, members.length) : 0)) / maxRounds)

  const runRow = runs.find((r) => r.id === runId)
  // A search step in the discussion: who searched, with what, the queries and how many results were kept.
  const searchLines = (searches: Of<"evidence.triaged">[]) => {
    const groups: { member: string; provider?: SearchProvider; list: Of<"evidence.triaged">[] }[] = []
    for (const e of searches) {
      const last = groups.at(-1), provider = providerOf(e)
      if (last && last.member === e.member && last.provider === provider) last.list.push(e)
      else groups.push({ member: e.member, provider, list: [e] })
    }
    return groups.map((g) => (
      <div key={g.list[0].key} className="thread-search" role="note" aria-label={`${who(g.member).name} searched`} data-agent={g.member}>
        <AgentAvatar name={g.member} size={32} className="thread-search-face" />
        <p>
          <b>{who(g.member).name}</b> {g.provider === "fixture" ? "looked up sources" : g.provider === "europepmc" ? "searched the research literature" : g.provider && DATABASES.includes(g.provider) ? `looked up records in ${PROVIDERS[g.provider]?.place ?? "a database"}` : "searched the web"}
          {g.provider && <> · <SearchCredit provider={g.provider} /></>}
        </p>
        <ul>
          {g.list.map((e) => <li key={e.key}>“{e.query}”: kept {e.kept} of {e.kept + e.dropped} result{e.kept + e.dropped === 1 ? "" : "s"}</li>)}
        </ul>
      </div>
    ))
  }
  const sources = [...new Map(evidence.flatMap((e) => e.items.map((i) => [i.url, { ...i, provider: i.provider ?? providerOf(e) }] as const))).values()]
  const sourceProviders = [...new Set(sources.map((x) => x.provider).filter((p): p is SearchProvider => !!p))]
  const checksOf = (list: Of<"claim.checked">[]): Checked[] => list.map((c) => ({ key: c.key, verdict: c.verdict, claim: c.claim, sourceProvider: sources.find((x) => x.url === c.source)?.provider, quote: c.quoteFound === undefined ? undefined : { found: c.quoteFound, text: /^quoted: "(.*)"/s.exec(c.note ?? "")?.[1] }, why: c.note || (c.checkedBy === "scripted" || startedAs ? "This was a practice run, so no real check was made. In a real run the reason is written here." : undefined), source: c.source, by: checkerName(c) }))
  const startedEvent = events.find((e): e is Of<"run.started"> => e.type === "run.started")
  const question = startedEvent?.title || (runRow ? plainTitle(runRow.brief) : runId ? plainTitle(runId) : "")
  const state = failed ? "failed" : runState(runRow?.status ?? (done ? "done" : "running"))
  const wrong = count("contradicted")
  const who = (member: string) => { const t = nameAndJob(title(member)); return { name: t.name, job: specialist(member) ? "method specialist: reads method notes, has no tools and runs nothing" : BOARD_JOB[member] ?? t.job?.toLowerCase() } }

  return (
    <div className="page board">
      <PageHead title="Team review" about={ABOUT} />
      <div className="board-bar">
        <label className="board-pick">
          <span className="small muted">Showing</span>
          <select aria-label="Review to show" value={runId ?? ""} title={runId} onChange={(e) => setRunId(e.target.value || undefined)}>
            {runs.length === 0 && <option value="">No reviews yet</option>}
            {runId && !known && runs.length > 0 && <option value={runId}>{plainTitle(runId)}</option>}
            {runs.map((r) => <option key={r.id} value={r.id}>{plainTitle(r.brief)} · {plainWhen(r.startedAt)} · {runState(r.status)}</option>)}
          </select>
        </label>
        {(runRow?.status === "paused" || runRow?.status === "failed") && <button type="button" className="btn" onClick={() => void resume()}>Resume</button>}
        <span className="board-new">
          <select aria-label="Question for a new review" value={brief} onChange={(e) => setBrief(e.target.value)}>
            {briefs.map((b) => <option key={b} value={b}>{plainTitle(b)}</option>)}
          </select>
          <button type="button" className="btn btn-primary" onClick={start} disabled={!brief || live}>{live ? "Review in progress" : "Start a review"}</button>
        </span>
      </div>
      {status?.mock && <p className="muted small" data-testid="next-mode">A new review would be a practice run. {nextWhy}</p>}
      {error && <p role="alert" className="pill" data-kind="danger">{error}</p>}

      <section className="story" aria-label="What happened">
        {runId && (known || events.length > 0) && (
          <>
            <p className="story-eyebrow">The question</p>
            <h2 className="story-title">{question}</h2>
            <p className="story-facts">
              <StatusPill state={state} />
              {startedAs !== undefined && (
                <span data-testid="run-mode" className="story-mode"><Provenance kind={provenanceOf({ scripted: startedAs })} /></span>
              )}
              <span className="muted small">
                {runRow && <>Started {plainWhen(runRow.startedAt)}</>}
                {done && <> · took {plainDuration(done.minutes * 60_000)} · {startedAs === true ? plainCost(done.usd, true) : spentWords(done.usd)}</>}
                {!done && startedAs === false && status && <> · <span data-testid="spent">{spentWords(spent)} so far · {runLimit(status.meeting.max_usd)}</span></>}
                {webSearches + litSearches + dbSearches > 0 && <> · <span data-testid="search-count">{live ? "Searching: " : "Searched: "}{webSearches}{cap(status?.meeting.max_searches)} web searches, {litSearches}{cap(status?.meeting.max_literature_searches)} literature searches{dbSearches > 0 && `, ${dbSearches} database look-up${dbSearches === 1 ? "" : "s"}`}</span></>}
              </span>
            </p>
          </>
        )}
        <p className="story-headline" role="status">{headline}</p>
        {claims.length > 0 && (
          <div className="check-summary" role="group" aria-label="What the checks found">
            <p className="check-line">
              <b data-testid="checked-count">{checkedOf(checked, claims.length)}.</b>
              <MarkChip verdict="verified" count={marks.supported} />
              <MarkChip verdict="contradicted" count={marks.contradicted} />
              <MarkChip verdict="unsupported" count={marks.insufficient} />
              {marks.unchecked > 0 && <MarkChip verdict="unchecked" count={marks.unchecked} />}
            </p>
            {whyNot.length > 0 && (
              <p className="check-why" data-testid="unchecked-why">
                Of the {marks.unchecked} not checked: {whyNot.map((w, i) => <span key={w.note} title={w.note ? `The check's own note: ${w.note}` : undefined}>{i > 0 && "; "}<span className="mono">{w.n}</span> {w.plain}</span>)}.
              </p>
            )}
            <MarksLegend who="A separate checker decides each mark; the team does not grade itself." />
          </div>
        )}
        {wrong > 0 && <p className="thread-flag story-flag"><span aria-hidden="true">✕</span> {wrong === 1 ? "One statement was contradicted." : `${wrong} statements were contradicted.`} Look for the marked messages below.</p>}
        {failed && <p className="newrun-error" role="alert">{failed.error} Nothing more was spent. If it names a model or a key, check them in Settings (or ask the person who runs the engine). After the problem is fixed, the review can be continued{runRow?.status === "failed" || runRow?.status === "paused" ? ": press Resume above." : "."}</p>}
        {runId && status && !done && !failed && (known || events.length > 0) && <div className="progress" aria-hidden="true"><span style={{ width: `${progress * 100}%` }} /></div>}
        {memoText && (
          <div className="story-decision" role="group" aria-label="Decision">
            <p className="story-eyebrow">What the team recommends {startedAs && <span className="story-practice">(practice text, not a real recommendation)</span>}</p>
            {(() => {
              // The recommendation is one sentence to scan; what the memo adds to it follows in body text.
              const [lead, rest] = leadSentence(plain(bullets(memo["decision"])[0]))
              return <><p className="decision-text">{lead || "See the written decision below."}</p>{rest && <p className="decision-rest">{rest}</p>}</>
            })()}
            {memo["rationale"] && (
              // The memo's reasoning is Markdown (lists, tables): it is drawn as such, never flattened into one paragraph.
              <details className="decision-why" open={memo["rationale"].length <= SHORT_REASONING || undefined}>
                <summary>Why the team recommends this</summary>
                <SafeMarkdown className="decision-whyb">{memo["rationale"]}</SafeMarkdown>
              </details>
            )}
          </div>
        )}
      </section>

      {runId && took.length > 0 && (
        <ol className="board-steps" aria-label="Who took part">
          {took.map((m) => {
            // From the run's own events: a member who never replied did not take part, also when the roster lists them.
            const spokeAtAll = events.some((e) => e.type === "member.replied" && e.member === m.name)
            const step = !live ? (spokeAtAll ? "done" : "todo") : current?.replies.some((r) => r.member === m.name) ? "done" : "now"
            return <li key={m.name} data-step={step} title={BOARD_JOB[m.name] ?? nameAndJob(m.title).job}><AgentAvatar name={m.name} size={24} /><span className="board-who"><span>{agentIdentity(m.name, { title: m.title }).short}</span><span className="swarm-step">{step === "done" ? (live ? "✓ replied" : "✓ took part") : step === "now" ? "● working" : finished ? "○ did not take part" : "○ not started"}</span></span></li>
          })}
        </ol>
      )}

      <section className="talk" aria-label="Discussion">
        <h2 className="talk-title">The discussion {live && <span className="pill" data-kind="info">live</span>}</h2>
        <p className="muted small">Who said what, in order. The chips under a message show what a separate check found for each statement in it.</p>
        {rounds.length === 0 && <p className="empty-note">{runId && (known || events.length > 0) ? "Nobody has spoken yet." : <>Nothing to show yet. Press <b>Start a review</b> above, or <a href="#Home">ask your own question on Search</a>.</>}</p>}
        <Conversation className="thread-inline" aria-label="Discussion, round by round">
          <ConversationContent className="thread-list">
            {rounds.map(([n, r]) => (
              <div key={n} className="thread-round" role="group" aria-label={`Round ${n}`}>
                <h3 className="round-head">Round {n}{r.head?.final ? ": final positions" : ""}</h3>
                {r.head?.message && <TeamMessage agent={lead?.name ?? "lead-scientist"} name={lead?.title ?? "Lead"} job={BOARD_JOB["lead-scientist"]} text={r.head.message.replace(/^\s*Round \d+\.\s*/, "")} />}
                {searchLines(r.searches)}
                {r.replies.map((reply) => <TeamMessage key={reply.key} agent={reply.member} {...who(reply.member)} text={reply.text} short={reply.summary?.trim() || undefined} checks={checksOf(r.claims.filter((c) => c.member === reply.member))} />)}
              </div>
            ))}
            {live && <Loading>{headline}</Loading>}
          </ConversationContent>
        </Conversation>
        {events.filter((e): e is Of<"constraint"> => e.type === "constraint").map((c) => (
          <p key={c.key} className="pill" data-kind="warning">The lead was told to wrap up: {c.detail}</p>
        ))}
      </section>

      {runId && (sources.length > 0 || evidence.length > 0) && (
        <section className="talk" aria-label="Sources">
          <h2 className="talk-title">Sources</h2>
          <p className="muted small">
            What the team found when it searched, and which statements rest on each one. {sources.length} kept{dropped > 0 && `, ${dropped} left out as off-topic`}.
            {sourceProviders.map((p) => <span key={p}> <SearchCredit provider={p} />.</span>)}
          </p>
          <ul className="source-list">
            {sources.map((src) => {
              const url = safeUrl(src.url)
              const resting = claims.filter((c) => c.source === src.url)
              return (
                <li key={src.url}>
                  <span className="source-title">{url ? <a href={url} target="_blank" rel="noreferrer noopener">{src.title || url}</a> : src.title || src.url}</span>
                  {/\[preprint\]\s*$/i.test(src.title ?? "") && <span className="source-preprint">Preprint: not peer reviewed</span>}
                  <span className="muted small">
                    {[url ? (new URL(url).hostname === "api.fda.gov" ? "openFDA query" : new URL(url).hostname.replace(/^www\./, "")) : "not a web address", src.studyType && `kind of study: ${src.studyType}`].filter(Boolean).join(" · ")}
                    {screened(src.relevance) && <> · <span data-testid="screened" title="A screening model read the source and judged whether it bears on the question. It is a judgement in words, not a measured score.">{screened(src.relevance)}</span></>}
                    {src.provider && <> · <SearchCredit provider={src.provider} /></>}
                  </span>
                  {resting.length > 0 && (
                    <ul className="source-rests" aria-label="Statements that rest on this source">
                      {resting.map((c) => (
                        <li key={c.key}>
                          <MarkChip verdict={c.verdict} /> <span>{c.claim}</span>
                          {c.quoteFound !== undefined && <span className="muted small" data-found={c.quoteFound}>{c.quoteFound ? "The quoted passage was found in this source." : "The quoted passage was not found in the source."}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
          {sources.length === 0 && <p className="empty-note">The search kept no sources.</p>}
        </section>
      )}

      {runId && (known || events.length > 0) && (
        <nav className="next-steps" aria-label="What you can do next">
          <p className="story-eyebrow">{finished ? "What next?" : "While you wait"}</p>
          <a className="btn btn-primary" href="#Home">Ask a follow-up</a>
          <button type="button" className="btn" aria-pressed={details} onClick={() => setDetails(!details)}>{details ? "Hide the checks, sources and written decision" : "See how each statement was checked"}</button>
          <a className="btn" href="#Graph" onClick={() => setOpen("board", runId)}>See this run as a graph</a>
          <button type="button" className="link-btn" onClick={() => { void navigator.clipboard?.writeText(linkTo("board", runId)).then(() => setCopied(true), () => setCopied(false)) }}>{copied ? "Link copied" : "Copy a link to this review"}</button>
        </nav>
      )}

      {details && (
        <div className="board-grid">
          <section className="card-surface" aria-label="Checks, sources and the written decision">
            <h2>Every check, counted</h2>
            <div className="ledger-stats">
              {VERDICTS.map((v) => <div key={v} title={`The check's own word: ${v}`}><strong>{count(v)}</strong><span>{MARK_WORD[markOf(v)]}</span><span className="muted small">{v}</span></div>)}
            </div>
            <p className="muted small">
              A quick first check settled {claims.filter(firstPass).length} of {claims.length} statements;
              {" "}{claims.filter((c) => !firstPass(c)).length} went to a second, more careful check.
            </p>
            <h2>The written decision (memo)</h2>
            {memoText ? <div className="memo"><Streamdown>{memoText}</Streamdown></div> : <p className="muted small">Written when the review finishes.</p>}
          </section>
          <details className="card-surface board-more">
            <summary>The team: who took part, and the limits</summary>
            {roster.map((m) => (
              <div key={m.name} className="member" title={m.deliverable}>
                <div>
                  <strong>{m.title}</strong>
                  <span>{BOARD_JOB[m.name] ?? m.deliverable}</span>
                  <code title={scripted ? `A real run would use ${m.modelId}` : m.modelId}>{scripted ? "practice: no model" : m.modelId}</code>
                </div>
              </div>
            ))}
            {status && <p className="muted small">Limits for one review: at most {status.meeting.max_rounds} rounds, {status.meeting.max_minutes} minutes and ${status.meeting.max_usd}.</p>}
          </details>

        </div>
      )}
    </div>
  )
}
