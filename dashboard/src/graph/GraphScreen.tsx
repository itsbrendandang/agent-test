// The Graph view: a 3D picture of one run, with a sentence that says what happened, a replay, and a list of the same graph
// for keyboard and screen readers. Wording follows the dashboard's shared glossary (see words.ts).
import { lazy, Suspense, useCallback, useMemo, useState } from "react"
import { Loading } from "@/components/Crew"
import { PRACTICE } from "@/lib/words"
import { EngineOffline, ModeLabel, PageHead } from "@/components/Shared"
import { setOpen, takeOpen } from "@/lib/open"
import { useBoardRun, useRunList, useSwarmRun, useVisible, type RunRef } from "./data"
import { useReducedMotion } from "./env"
import { GraphList } from "./GraphList"
import { FullKey, Key } from "./Legend"
import { buildBoardGraph, buildSwarmGraph, statsOf } from "./model"
import { NodePanel } from "./NodePanel"
import { Scrubber } from "./Scrubber"
import { headline, narration, replaySeconds } from "./story"
import { GLYPH, LINK_KINDS, MAX_NODES, NODE_KINDS, QUIET_LINKS, VERDICT_CLASSES, type GraphModel, type LinkKind, type NodeKind, type Outcome } from "./types"
import { applyView, byAttention, capGraph, countVerdicts, layoutView, neighbourMap, reveal, searchNodes } from "./view"
import { GROUP_WORD, KIND_WHAT, kindLabel, LINK_VERB } from "./words"
import "../design/graph.css"

const GraphCanvas = lazy(() => import("./GraphCanvas").then((m) => ({ default: m.GraphCanvas })))
/** A run whose first picture (team members and statements) has fewer nodes than this opens as a list: a handful of dots says less than a short list does. */
const SMALL_RUN = 15
const MODE_KEY = "graph.mode"
const storedMode = (): "graph" | "list" | null => { try { const v = localStorage.getItem(MODE_KEY); return v === "graph" || v === "list" ? v : null } catch { return null } }
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

const ABOUT = "Who said what in one run, and what each check found. Contradicted statements are the easiest to find."

const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n }
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x))

/** Three levels of detail. The first is what a newcomer sees: who took part, and what they claimed. */
const DETAIL: { key: "calm" | "checked" | "all"; hidden: readonly NodeKind[] }[] = [
  { key: "calm", hidden: ["checker", "phase", "source", "test", "artifact"] },
  { key: "checked", hidden: ["phase", "artifact"] },
  { key: "all", hidden: [] },
]

export function GraphScreen() {
  const list = useRunList()
  const [picked, setPicked] = useState<Pick<RunRef, "kind" | "id"> | undefined>(() => {
    const swarm = takeOpen("swarm"), board = takeOpen("board")
    return swarm ? { kind: "swarm", id: swarm } : board ? { kind: "board", id: board } : undefined
  })
  // The newest run when the view opens. It stays selected when newer runs appear: the graph never changes under the reader.
  const [auto, setAuto] = useState<RunRef>()
  if (!auto && !picked && list.runs?.[0]) setAuto(list.runs[0])
  const current = picked ?? auto
  const board = useBoardRun(current?.kind === "board" ? current.id : undefined)
  const swarm = useSwarmRun(current?.kind === "swarm" ? current.id : undefined)
  const source = current?.kind === "board" ? board : swarm

  const full = useMemo<GraphModel | undefined>(() => {
    if (!current) return undefined
    if (current.kind === "board") return board.data ? capGraph(buildBoardGraph({ runId: current.id, ...board.data })) : undefined
    return swarm.data ? capGraph(buildSwarmGraph(swarm.data)) : undefined
  }, [current, board.data, swarm.data])

  // null: the person has not chosen yet, so a run with claims starts calm and a run without any (a single agent) shows everything.
  const [chosenKinds, setChosenKinds] = useState<ReadonlySet<NodeKind> | null>(null)
  const hiddenKinds = useMemo<ReadonlySet<NodeKind>>(() => chosenKinds ?? new Set(full && full.totals.claims > 0 ? DETAIL[0].hidden : []), [chosenKinds, full])
  const [hiddenVerdicts, setHiddenVerdicts] = useState<ReadonlySet<Outcome>>(new Set())
  const [hiddenLinks, setHiddenLinks] = useState<ReadonlySet<LinkKind>>(new Set(QUIET_LINKS))
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [emphasis, setEmphasis] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  // The person's own choice (kept for next time) wins. Until they choose, a small run opens as a list.
  const [chosenMode, setChosenMode] = useState<"graph" | "list" | null>(storedMode)
  const chooseMode = (m: "graph" | "list") => { setChosenMode(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* private mode: not kept */ } }
  const [unavailable, setUnavailable] = useState<string>()
  const [focus, setFocus] = useState<{ id: string; n: number }>()
  const [query, setQuery] = useState("")
  const [hitAt, setHitAt] = useState(0)
  const [fullKey, setFullKey] = useState(false)
  const visibleTab = useVisible()
  const reduced = useReducedMotion()

  const key = current ? `${current.kind}:${current.id}` : ""
  // Another run starts from the beginning (state is reset while rendering, which React allows, rather than in an effect).
  const [seenKey, setSeenKey] = useState(key)
  if (seenKey !== key) { setSeenKey(key); setStep(null); setPlaying(false); setSelected(null); setQuery("") }

  const state = useMemo(() => ({ hiddenKinds, hiddenVerdicts, hiddenLinks, step }), [hiddenKinds, hiddenVerdicts, hiddenLinks, step])
  // The layout works on everything that passes the filters; the replay only reveals it, so nodes keep their places.
  const layout = useMemo(() => (full ? layoutView(full, state) : { nodes: [], links: [], connections: [] }), [full, state])
  const revealed = useMemo(() => reveal(layout, step), [layout, step])
  // How many nodes the calm first picture has: it decides whether the run opens as a list, whatever detail is chosen later.
  const firstPicture = useMemo(() => (full ? applyView(full, { ...state, hiddenKinds: new Set(DETAIL[0].hidden), step: null }).nodes.length : 0), [full, state])
  const shown = useMemo(() => (full ? applyView(full, state) : { nodes: [], links: [], connections: [] }), [full, state])
  const selectedNode = shown.nodes.find((n) => n.id === selected) ?? null
  const order = useMemo(() => (emphasis ? [...shown.nodes].sort(byAttention) : [...shown.nodes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))), [shown.nodes, emphasis])
  const near = useMemo(() => (selectedNode ? (neighbourMap(shown.links).get(selectedNode.id) ?? new Set<string>()) : new Set<string>()), [selectedNode, shown.links])
  const pulse = useMemo(() => new Set(step !== null && full ? (full.steps[step - 1]?.nodes ?? []) : []), [step, full])
  const style = useMemo(() => ({ selected: selectedNode?.id ?? null, neighbours: near, emphasis, pulse }), [selectedNode, near, emphasis, pulse])
  const counts = useMemo(() => countVerdicts(shown.nodes), [shown.nodes])
  const refuted = useMemo(() => shown.nodes.filter((n) => n.attention === 2 && n.kind === "claim").sort((a, b) => a.order - b.order), [shown.nodes])
  const matches = useMemo(() => searchNodes(shown.nodes, query), [shown.nodes, query])
  // What happened: the whole run, or, while replaying, only what has happened so far.
  const said = useMemo(() => {
    if (!full) return ""
    if (step === null) return headline(full, full.totals, full.status === "running")
    return headline(full, statsOf(full.nodes.filter((n) => n.order <= step)), true)
  }, [full, step])

  const select = useCallback((id: string | null) => { setSelected(id); if (id) setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })) }, [])
  const stepBy = useCallback((by: 1 | -1) => {
    if (order.length === 0) return
    const i = order.findIndex((n) => n.id === selected)
    select(order[(i + by + order.length) % order.length].id)
  }, [order, selected, select])
  const jumpRefuted = () => {
    if (!refuted.length) return
    const i = refuted.findIndex((n) => n.id === selected)
    select(refuted[(i + 1) % refuted.length].id)
  }
  const find = () => {
    if (!matches.length) return
    const next = query ? hitAt % matches.length : 0
    setHitAt(next + 1)
    select(matches[next].id)
  }
  const openRun = () => {
    if (!current) return
    setOpen(current.kind, current.id)
    window.location.hash = current.kind === "swarm" ? "#Compare" : "#Board"
  }
  const play = () => {
    if (playing) { setPlaying(false); return }
    if (!full) return
    if (step === null || step >= full.maxOrder) setStep(1)
    setPlaying(true)
  }
  const mode = chosenMode ?? (full && firstPicture < SMALL_RUN ? "list" : "graph")
  const useList = mode === "list" || unavailable !== undefined

  // ── States before there is a graph ──
  if (!list.runs && list.failed.length === 2) {
    return <div className="page graph-page" data-wide><PageHead title="Graph" about={ABOUT} />
      <EngineOffline needs="Runs come from the engine." onRetry={list.reload} /></div>
  }
  if (!list.runs) return <div className="page graph-page" data-wide><PageHead title="Graph" about={ABOUT} /><Loading className="loading-block">Loading runs…</Loading></div>
  if (!current) {
    return <div className="page graph-page" data-wide><PageHead title="Graph" about={ABOUT} />
      <p className="graph-empty card-surface">No runs yet. Start one in Board or Compare, and its graph appears here.</p></div>
  }

  const status = full?.status
  const kindsPresent = new Set((full?.nodes ?? []).map((n) => n.kind))
  const kindsShown = new Set(shown.nodes.map((n) => n.kind))
  const noun = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
  const runName = (r: Pick<RunRef, "kind" | "solver">) => (r.kind === "board" ? "Review" : r.solver === "single" ? "Single agent" : "Team of nine")
  const optionText = (r: RunRef) => `${runName(r)} · ${r.title} · ${when(r.startedAt)} · ${r.state}`
  const bigRun = firstPicture >= SMALL_RUN
  const hasStatements = (full?.totals.claims ?? 0) > 0
  const detail = DETAIL.find((d) => sameSet(hiddenKinds, new Set(d.hidden)))?.key
  const who = full?.kind === "swarm" ? "Roles" : "Team members"
  const summaryText = full ? `${noun(shown.nodes.length, "node")}, ${noun(shown.links.length, "line")} shown` : ""
  const caption = step !== null && full ? narration(full, step) : ""
  const searchForm = (
    <form className="graph-search" role="search" onSubmit={(e) => { e.preventDefault(); find() }}>
      <input type="search" aria-label="Search the graph" placeholder="Search statements, team members, sources…" value={query} onChange={(e) => { setQuery(e.target.value); setHitAt(0) }} />
      <button type="submit" className="btn" disabled={!query || matches.length === 0}>Find</button>
      {query && <span className="muted small" role="status">{matches.length === 0 ? "No match" : `${matches.length} match${matches.length === 1 ? "" : "es"}; Enter for the next`}</span>}
    </form>
  )

  return (
    <div className="page graph-page" data-wide>
      <PageHead title="Graph" about={ABOUT} />

      <section className="card-surface graph-story" aria-label="What happened">
        <div className="graph-row">
          <label className="graph-field"><span>Run</span>
            <select value={`${current.kind}:${current.id}`} onChange={(e) => { const [kind, ...rest] = e.target.value.split(":"); setPicked({ kind: kind as RunRef["kind"], id: rest.join(":") }) }}>
              {!list.runs.some((r) => r.kind === current.kind && r.id === current.id) && <option value={`${current.kind}:${current.id}`} title={current.id}>{runName(current)}</option>}
              {list.runs.map((r) => <option key={`${r.kind}:${r.id}`} value={`${r.kind}:${r.id}`} title={r.id}>{optionText(r)}</option>)}
            </select>
          </label>
          {/* A practice run is stated once, by the banner over the picture. A live run, a demo task and an unknown mode get a small label. */}
          {full && <span data-testid="scripted-label"><ModeLabel scripted={full.scripted === true ? undefined : full.scripted} demo={full.demo} /></span>}
          {full && full.scripted === undefined && !full.demo && <span className="pill" data-kind="warning" data-testid="scripted-label">how it was made: not recorded</span>}
          {status && status !== "done" && <span className="pill" data-kind={status === "failed" ? "danger" : "info"}>{status === "running" ? "running: the picture grows as events arrive" : status}</span>}
        </div>
        {full && <h2 className="graph-title" title={full.runId}>{full.title}</h2>}
        {full && <p className={hasStatements ? "graph-headline" : "graph-quiet"} role="status" data-testid="headline">{said}</p>}
        {full && full.hidden > 0 && <p className="muted small">This run is large: the {full.nodes.length} most important of {full.nodes.length + full.hidden} nodes are drawn (limit {MAX_NODES}), contradicted statements first. The headline above still counts the whole run.</p>}
        {full && full.maxOrder > 0 && hasStatements && (
          <div className="graph-row graph-play">
            <button type="button" className="btn btn-primary graph-playbtn" onClick={play} aria-pressed={playing}>
              {playing ? "❚❚ Pause" : step === null ? (reduced ? "Step through how this unfolded" : "▶ Watch how this unfolded") : "▶ Continue"}
            </button>
            {step !== null && <span className="muted small">Step {step} of {full.maxOrder}</span>}
            {step === null && <span className="muted small">{reduced ? "Press the arrows under the picture to move one step at a time." : `The statements appear in the order they were made, about ${replaySeconds(full.maxOrder)} seconds.`}</span>}
          </div>
        )}
      </section>

      <section className="card-surface graph-bar" aria-label="What to show">
        <div className="graph-row">
          <div className="graph-seg" role="group" aria-label="Level of detail">
            <button type="button" className="btn" aria-pressed={detail === "calm"} onClick={() => setChosenKinds(new Set(DETAIL[0].hidden))}>{who} and statements</button>
            <button type="button" className="btn" aria-pressed={detail === "checked"} onClick={() => setChosenKinds(new Set(DETAIL[1].hidden))}>Show how each was checked</button>
            <button type="button" className="btn" aria-pressed={detail === "all"} onClick={() => setChosenKinds(new Set(DETAIL[2].hidden))}>Everything</button>
          </div>
          {bigRun && searchForm}
          {refuted.length > 0 && (
            <button type="button" className="btn" onClick={jumpRefuted}>
              <span aria-hidden="true">{GLYPH.fails}</span> Next contradicted one ({refuted.length})
            </button>
          )}
          <div className="graph-seg" role="group" aria-label="Show as">
            <button type="button" className="btn" aria-pressed={!useList} disabled={unavailable !== undefined} onClick={() => chooseMode("graph")}>3D graph</button>
            <button type="button" className="btn" aria-pressed={useList} onClick={() => chooseMode("list")}>List</button>
          </div>
        </div>
        <details className="graph-more">
          <summary>More filters and options{summaryText ? <span className="muted"> · {summaryText}</span> : null}</summary>
          {!bigRun && <div className="graph-row">{searchForm}</div>}
          <div className="graph-row">
            <label className="graph-check"><input type="checkbox" checked={emphasis} onChange={(e) => setEmphasis(e.target.checked)} /><span>Contradicted first</span></label>
            <fieldset className="graph-filter"><legend>Mark</legend>
              {VERDICT_CLASSES.map((v) => (
                <label key={v} className="graph-check"><input type="checkbox" checked={!hiddenVerdicts.has(v)} onChange={() => setHiddenVerdicts((s) => toggle(s, v))} /><span><span aria-hidden="true">{GLYPH[v]}</span> {GROUP_WORD[v]}</span></label>
              ))}
            </fieldset>
          </div>
          <div className="graph-row">
            <fieldset className="graph-filter"><legend>Show</legend>
              {NODE_KINDS.filter((k) => kindsPresent.has(k)).map((k) => (
                <label key={k} className="graph-check" title={KIND_WHAT[k]}><input type="checkbox" checked={!hiddenKinds.has(k)} disabled={k === "run"} onChange={() => setChosenKinds(toggle(hiddenKinds, k))} /><span>{kindLabel(k, full!.kind)}</span></label>
              ))}
            </fieldset>
            <fieldset className="graph-filter"><legend>Lines</legend>
              {LINK_KINDS.filter((k) => full?.links.some((l) => l.kind === k)).map((k) => (
                <label key={k} className="graph-check"><input type="checkbox" checked={!hiddenLinks.has(k)} onChange={() => setHiddenLinks((s) => toggle(s, k))} /><span>{LINK_VERB[k]}</span></label>
              ))}
            </fieldset>
          </div>
        </details>
      </section>

      {list.failed.length === 1 && <p className="pill" data-kind="warning" role="status">The list of {list.failed[0] === "board" ? "reviews" : "team-of-nine runs"} could not be loaded, so only the other kind is listed.</p>}
      {source.error && <div className="engine-offline card-surface" role="alert"><h2>This run could not be loaded</h2><p className="muted">The engine did not answer for {current.id}.</p><button type="button" className="btn" onClick={source.reload}>Try again</button></div>}
      {source.loading && <Loading className="loading-block">Loading the graph…</Loading>}

      {full && (
        <>
          <div className="graph-main">
            <div className="graph-view" data-scripted={full.scripted === true || undefined}>
              {full.scripted === true && <div className="graph-badge" data-testid="scripted-banner">{PRACTICE}. Nothing in this picture is a research result.</div>}
              {unavailable !== undefined && <p className="graph-fallback" role="status">The 3D view is not available here ({unavailable}) so the list is shown instead. It has the same information.</p>}
              <div className="graph-body">
                {!useList && (
                  <Suspense fallback={<Loading className="loading-block">Loading the 3D view…</Loading>}>
                    <GraphCanvas nodes={layout.nodes} links={layout.links} revealed={revealed} runKind={full.kind} style={style} fitKey={`${key}|${[...hiddenKinds]}|${[...hiddenVerdicts]}|${[...hiddenLinks]}`} focus={focus} paused={!visibleTab}
                      onSelect={select} onStep={stepBy} onUnavailable={(r) => setUnavailable(r)}
                      summary={`3D graph of a ${current.kind === "swarm" ? "team-of-nine run" : "review"}: ${noun(shown.nodes.length, "node")} and ${noun(shown.links.length, "line")}. ${counts.fails} contradicted statements. The list view has the same content.`} />
                  </Suspense>
                )}
                {useList && <GraphList runKind={full.kind} nodes={shown.nodes} links={shown.connections} selected={selectedNode?.id ?? null} onSelect={select} order={order} />}
                {!useList && <div className="graph-keybox"><Key kinds={kindsShown} runKind={full.kind} open={fullKey} onToggle={() => setFullKey((v) => !v)} /></div>}
                {!useList && caption && <p className="graph-caption" aria-hidden="true" data-testid="caption">{caption}</p>}
              </div>
            </div>
            {selectedNode
              ? <NodePanel node={selectedNode} nodes={shown.nodes} links={shown.connections} model={full} onSelect={select} onOpenRun={openRun} onClose={() => select(null)} />
              : <aside className="graph-panel" aria-label="About this graph">
                  <h2>About this picture</h2>
                  <p className="muted small">Select a node to see its details and to light up what it is connected to.</p>
                  <button type="button" className="btn btn-primary" onClick={openRun}>Open this run in {full.kind === "swarm" ? "Compare" : "Board"}</button>
                  <details><summary>Run details</summary><p className="muted small">{full.kind === "board" ? "Review" : "Team-of-nine run"} <code>{full.runId}</code></p></details>
                  <details><summary>What this graph cannot show</summary><ul className="graph-notes">{full.notes.map((n) => <li key={n}>{n}</li>)}</ul></details>
                </aside>}
          </div>
          <Scrubber model={full} step={step} onStep={setStep} playing={playing} onPlaying={setPlaying} />
          {fullKey && <FullKey kinds={kindsPresent} runKind={full.kind} />}
        </>
      )}
    </div>
  )
}
