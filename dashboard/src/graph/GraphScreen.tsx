// The Graph view: a 3D interaction graph of one run, with a list of the same graph for keyboard and screen readers.
import { lazy, Suspense, useCallback, useMemo, useState } from "react"
import { EngineOffline, PageHead } from "@/components/Shared"
import { setOpen, takeOpen } from "@/lib/open"
import { useBoardRun, useRunList, useSwarmRun, useVisible, type RunRef } from "./data"
import { useReducedMotion } from "./env"
import { GraphList } from "./GraphList"
import { Legend } from "./Legend"
import { buildBoardGraph, buildSwarmGraph } from "./model"
import { NodePanel } from "./NodePanel"
import { Scrubber } from "./Scrubber"
import { GLYPH, KIND_LABEL, LINK_KINDS, LINK_LABEL, MAX_NODES, NODE_KINDS, QUIET_LINKS, VERDICT_CLASSES, VERDICT_WORD, type GraphModel, type LinkKind, type NodeKind, type VerdictClass } from "./types"
import { applyView, byAttention, capGraph, countVerdicts, neighbourMap, searchNodes } from "./view"
import "./graph.css"

const GraphCanvas = lazy(() => import("./GraphCanvas").then((m) => ({ default: m.GraphCanvas })))
const ABOUT = "Every agent, claim, source, test and issue of one run as a graph. Refuted and contested claims are the easiest things to find."

const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n }

export function GraphScreen() {
  const list = useRunList()
  const [picked, setPicked] = useState<Pick<RunRef, "kind" | "id"> | undefined>(() => {
    const swarm = takeOpen("swarm"), board = takeOpen("board")
    return swarm ? { kind: "swarm", id: swarm } : board ? { kind: "board", id: board } : undefined
  })
  const current = picked ?? list.runs?.[0]
  const board = useBoardRun(current?.kind === "board" ? current.id : undefined)
  const swarm = useSwarmRun(current?.kind === "swarm" ? current.id : undefined)
  const source = current?.kind === "board" ? board : swarm

  console.info('[g3] render', Date.now()%100000, list.runs?.length, board.data?.events.length, current?.id)
  const full = useMemo<GraphModel | undefined>(() => {
    console.info('[g3] full recomputed')
    if (!current) return undefined
    if (current.kind === "board") return board.data ? capGraph(buildBoardGraph({ runId: current.id, ...board.data })) : undefined
    return swarm.data ? capGraph(buildSwarmGraph(swarm.data)) : undefined
  }, [current, board.data, swarm.data])

  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<NodeKind>>(new Set())
  const [hiddenVerdicts, setHiddenVerdicts] = useState<ReadonlySet<VerdictClass>>(new Set())
  const [hiddenLinks, setHiddenLinks] = useState<ReadonlySet<LinkKind>>(new Set(QUIET_LINKS))
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [emphasis, setEmphasis] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<"graph" | "list">("graph")
  const [unavailable, setUnavailable] = useState<string>()
  const [focus, setFocus] = useState<{ id: string; n: number }>()
  const [query, setQuery] = useState("")
  const [hitAt, setHitAt] = useState(0)
  const visibleTab = useVisible()
  const reduced = useReducedMotion()

  const key = current ? `${current.kind}:${current.id}` : ""
  // Another run starts from the beginning (state is reset while rendering, which React allows, rather than in an effect).
  const [seenKey, setSeenKey] = useState(key)
  if (seenKey !== key) { setSeenKey(key); setStep(null); setPlaying(false); setSelected(null); setQuery("") }

  const shown = useMemo(() => (full ? applyView(full, { hiddenKinds, hiddenVerdicts, hiddenLinks, step }) : { nodes: [], links: [], connections: [] }), [full, hiddenKinds, hiddenVerdicts, hiddenLinks, step])
  const selectedNode = shown.nodes.find((n) => n.id === selected) ?? null
  const order = useMemo(() => (emphasis ? [...shown.nodes].sort(byAttention) : [...shown.nodes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))), [shown.nodes, emphasis])
  const near = useMemo(() => (selectedNode ? (neighbourMap(shown.links).get(selectedNode.id) ?? new Set<string>()) : new Set<string>()), [selectedNode, shown.links])
  const style = useMemo(() => ({ selected: selectedNode?.id ?? null, neighbours: near, emphasis }), [selectedNode, near, emphasis])
  const counts = useMemo(() => countVerdicts(shown.nodes), [shown.nodes])
  const refuted = useMemo(() => shown.nodes.filter((n) => n.attention === 2).sort((a, b) => a.order - b.order), [shown.nodes])
  const matches = useMemo(() => searchNodes(shown.nodes, query), [shown.nodes, query])

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
  const useList = mode === "list" || unavailable !== undefined

  // ── States before there is a graph ──
  if (!list.runs && list.failed.length === 2) {
    return <div className="page graph-page" data-wide><PageHead title="Graph" about={ABOUT} />
      <EngineOffline needs="Runs come from the engine." onRetry={list.reload} /></div>
  }
  if (!list.runs) return <div className="page graph-page" data-wide><PageHead title="Graph" about={ABOUT} /><p className="muted" role="status">Loading runs…</p></div>
  if (!current) {
    return <div className="page graph-page" data-wide><PageHead title="Graph" about={ABOUT} />
      <p className="graph-empty card-surface">No runs yet. Start one in Board or Compare, and its graph appears here.</p></div>
  }

  const state = full?.status
  const scripted = full?.scripted
  const noun = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

  return (
    <div className="page graph-page" data-wide>
      <PageHead title="Graph" about={ABOUT}>
        {full && (scripted === true
          ? <span className="pill" data-kind="warning" data-testid="scripted-label">Scripted run: fixed text, not research</span>
          : scripted === false ? <span className="pill" data-kind="success" data-testid="scripted-label">Real model</span>
          : <span className="pill" data-kind="neutral" data-testid="scripted-label">Not recorded whether scripted</span>)}
        {full?.demo && <span className="pill" data-kind="warning">Demo case: a toy dataset</span>}
        {state && state !== "done" && <span className="pill" data-kind={state === "failed" ? "danger" : "info"}>{state === "running" ? "In progress: the graph grows as events arrive" : state}</span>}
      </PageHead>

      <section className="card-surface graph-bar" aria-label="Run and filters">
        <div className="graph-row">
          <label className="graph-field"><span>Run</span>
            <select value={`${current.kind}:${current.id}`} onChange={(e) => { const [kind, ...rest] = e.target.value.split(":"); setPicked({ kind: kind as RunRef["kind"], id: rest.join(":") }) }}>
              {!list.runs.some((r) => r.kind === current.kind && r.id === current.id) && <option value={`${current.kind}:${current.id}`}>{current.kind === "swarm" ? "Compare" : "Board"} · {current.id}</option>}
              {list.runs.map((r) => <option key={`${r.kind}:${r.id}`} value={`${r.kind}:${r.id}`}>{r.kind === "swarm" ? "Compare" : "Board"} · {r.id} · {r.state}</option>)}
            </select>
          </label>
          <form className="graph-search" role="search" onSubmit={(e) => { e.preventDefault(); find() }}>
            <input type="search" aria-label="Search the graph" placeholder="Search claims, agents, sources…" value={query} onChange={(e) => { setQuery(e.target.value); setHitAt(0) }} />
            <button type="submit" className="btn" disabled={!query || matches.length === 0}>Find</button>
            {query && <span className="muted small" role="status">{matches.length === 0 ? "No match" : `${matches.length} match${matches.length === 1 ? "" : "es"}; Enter for the next`}</span>}
          </form>
          <label className="graph-check"><input type="checkbox" checked={emphasis} onChange={(e) => setEmphasis(e.target.checked)} /><span>Refuted and contested first</span></label>
          <div className="graph-seg" role="group" aria-label="Show as">
            <button type="button" className="btn" aria-pressed={!useList} disabled={unavailable !== undefined} onClick={() => setMode("graph")}>3D graph</button>
            <button type="button" className="btn" aria-pressed={useList} onClick={() => setMode("list")}>List</button>
          </div>
        </div>
        <div className="graph-row">
          <fieldset className="graph-filter"><legend>Show</legend>
            {NODE_KINDS.filter((k) => full?.nodes.some((n) => n.kind === k)).map((k) => (
              <label key={k} className="graph-check"><input type="checkbox" checked={!hiddenKinds.has(k)} disabled={k === "run"} onChange={() => setHiddenKinds((s) => toggle(s, k))} /><span>{KIND_LABEL[k]}</span></label>
            ))}
          </fieldset>
          <fieldset className="graph-filter"><legend>Verdict</legend>
            {VERDICT_CLASSES.map((v) => (
              <label key={v} className="graph-check" title={VERDICT_WORD[v]}><input type="checkbox" checked={!hiddenVerdicts.has(v)} onChange={() => setHiddenVerdicts((s) => toggle(s, v))} /><span><span aria-hidden="true">{GLYPH[v]}</span> {v === "pass" ? "verified" : v === "fail" ? "refuted" : "not established"}</span></label>
            ))}
          </fieldset>
          <fieldset className="graph-filter"><legend>Lines</legend>
            {LINK_KINDS.filter((k) => full?.links.some((l) => l.kind === k)).map((k) => (
              <label key={k} className="graph-check"><input type="checkbox" checked={!hiddenLinks.has(k)} onChange={() => setHiddenLinks((s) => toggle(s, k))} /><span>{LINK_LABEL[k]}</span></label>
            ))}
          </fieldset>
          <button type="button" className="btn" onClick={jumpRefuted} disabled={refuted.length === 0}>
            <span aria-hidden="true">{GLYPH.fail}</span> Next refuted or contested ({refuted.length})
          </button>
        </div>
      </section>

      {list.failed.length === 1 && <p className="pill" data-kind="warning" role="status">The {list.failed[0] === "board" ? "board" : "swarm"} run list could not be loaded, so only the other kind is listed.</p>}
      {source.error && <div className="engine-offline card-surface" role="alert"><h2>This run could not be loaded</h2><p className="muted">The engine did not answer for {current.id}.</p><button type="button" className="btn" onClick={source.reload}>Try again</button></div>}
      {source.loading && <p className="muted" role="status">Loading the run…</p>}

      {full && (
        <>
          <p className="graph-summary" role="status">
            {noun(shown.nodes.length, "node")}, {noun(shown.links.length, "line")} shown ·{" "}
            <span aria-hidden="true">{GLYPH.pass}</span> {counts.pass} verified or supported · <span aria-hidden="true">{GLYPH.fail}</span> {counts.fail} refuted or contradicted · <span aria-hidden="true">{GLYPH.unknown}</span> {counts.unknown} not established
            {full.hidden > 0 && ` · ${full.hidden} less important nodes left out (cap ${MAX_NODES})`}
          </p>
          {full.nodes.length <= 1 && <p className="graph-empty card-surface">{full.notes.find((n) => /single agent|no ledger/i.test(n)) ?? (state === "running" ? "Nothing has been recorded yet. The graph grows as events arrive." : "This run has no recorded claims, sources or tests to draw.")}</p>}
          <div className="graph-main">
            <div className="graph-view" data-scripted={scripted === true || undefined}>
              {scripted === true && <div className="graph-badge" data-testid="scripted-banner">SCRIPTED RUN · fixed text, not research</div>}
              {unavailable !== undefined && <p className="graph-fallback" role="status">The 3D view is not available here ({unavailable}) so the list is shown instead. It has the same information.</p>}
              <div className="graph-body">
              {!useList && (
                <Suspense fallback={<p className="muted graph-loading" role="status">Loading the 3D view…</p>}>
                  <GraphCanvas nodes={shown.nodes} links={shown.links} style={style} fitKey={`${key}|${step}|${[...hiddenKinds]}|${[...hiddenVerdicts]}|${[...hiddenLinks]}`} focus={focus} paused={!visibleTab} onSelect={select} onStep={stepBy}
                    onUnavailable={(r) => setUnavailable(r)}
                    summary={`3D graph of ${current.kind === "swarm" ? "swarm" : "board"} run ${current.id}: ${noun(shown.nodes.length, "node")} and ${noun(shown.links.length, "line")}. ${counts.fail} refuted or contradicted claims. The list view has the same content.`} />
                </Suspense>
              )}
              {useList && <GraphList nodes={shown.nodes} links={shown.connections} selected={selectedNode?.id ?? null} onSelect={select} order={order} />}
              </div>
            </div>
            {selectedNode
              ? <NodePanel node={selectedNode} nodes={shown.nodes} links={shown.connections} model={full} onSelect={select} onOpenRun={openRun} onClose={() => select(null)} />
              : <aside className="graph-panel" aria-label="About this graph">
                  <h2>{full.title}</h2>
                  <p className="muted small">{full.kind === "board" ? "Board" : "Compare"} run <code>{full.runId}</code>. Select a node to see its details and to light up what it is connected to.</p>
                  <button type="button" className="btn btn-primary" onClick={openRun}>Open this run in {full.kind === "swarm" ? "Compare" : "Board"}</button>
                  <details><summary>What this graph cannot show</summary><ul className="graph-notes">{full.notes.map((n) => <li key={n}>{n}</li>)}</ul></details>
                </aside>}
          </div>
          <Scrubber model={full} step={step} onStep={setStep} playing={playing} onPlaying={setPlaying} canPlay={!reduced} />
          <Legend kinds={new Set(full.nodes.map((n) => n.kind))} />
        </>
      )}
    </div>
  )
}
