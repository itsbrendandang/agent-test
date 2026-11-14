import { lazy, Suspense, useMemo, useRef, useState } from "react"
import { Button } from "@ui-sdk/react/button"
import { Input, InputClear, InputGroup } from "@ui-sdk/react/input"
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack, SliderValue } from "@ui-sdk/react/slider"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs"
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle"
import { Toolbar, ToolbarButton } from "@ui-sdk/react/toolbar"
import {
  Activity, BarChart3, Boxes, Expand, Globe2, Home, Layers, PanelRightClose, PanelRightOpen,
  FlaskConical, Microscope, Pause, Play, RotateCcw, Settings, SkipForward, Sparkles, Users,
} from "lucide-react"
import { Buddy, Mark } from "./components/Buddy"
import { fmtMetric as fmt } from "./lib/format"
import { ParamPanel } from "./components/ParamPanel"
import { SideCrew } from "./components/SideCrew"
import { SimCard } from "./components/SimCard"
import { Splash } from "./components/Splash"
import { Timeline } from "./components/Timeline"
import { emptySimulation } from "./sim/empty"
import { categoryLabels, simulations } from "./sim/registry"
import { defaults, type Category, type Params } from "./sim/types"
import { useSimulation } from "./sim/useSimulation"
import { AgentsView } from "./views/AgentsView"
import { BoardView } from "./views/BoardView"
import { OverviewView } from "./views/OverviewView"
import { PlaceholderView } from "./views/PlaceholderView"
import { SettingsView } from "./views/SettingsView"
import { SwarmView } from "./views/SwarmView"

// Heavy pieces (markdown renderer, charts) load only when they are first shown.
const CopilotPanel = lazy(() => import("./components/CopilotPanel").then((m) => ({ default: m.CopilotPanel })))
const MetricsChart = lazy(() => import("./components/MetricsChart").then((m) => ({ default: m.MetricsChart })))
const SeriesChart = lazy(() => import("./components/MetricsChart").then((m) => ({ default: m.SeriesChart })))
const AnalyticsView = lazy(() => import("./views/AnalyticsView").then((m) => ({ default: m.AnalyticsView })))

const categories = Object.keys(categoryLabels) as Category[]

const rail = [
  { label: "Swarm", icon: Microscope, hint: "" },
  { label: "Board", icon: FlaskConical, hint: "" },
  { label: "Overview", icon: Home, hint: "" },
  { label: "Simulations", icon: Layers, hint: "" },
  { label: "Agents", icon: Users, hint: "" },
  { label: "Worlds", icon: Globe2, hint: "World and map definitions shared across simulations." },
  { label: "Experiments", icon: Boxes, hint: "Parameter sweeps and results from the Python research code in research/." },
  { label: "Analytics", icon: BarChart3, hint: "" },
  { label: "Settings", icon: Settings, hint: "App preferences and model / API configuration." },
]

export default function App() {
  const [simId, setSimId] = useState(simulations[0]?.id ?? emptySimulation.id)
  const sim = simulations.find((s) => s.id === simId) ?? simulations[0] ?? emptySimulation
  const [paramsBySim, setParamsBySim] = useState<Record<string, Params>>({})
  const params = useMemo(() => paramsBySim[sim.id] ?? defaults(sim), [paramsBySim, sim])
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [inspector, setInspector] = useState(true)
  const [tab, setTab] = useState("copilot")
  const [parade, setParade] = useState(0)
  const logoClicks = useRef(0)
  const [view, setView] = useState(() => {
    const fromHash = decodeURIComponent(window.location.hash.slice(1))
    return rail.some((r) => r.label === fromHash) ? fromHash : "Swarm"
  })
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<string[]>([])
  const idle = sim === emptySimulation
  const active = running && !idle
  const { canvasRef, tick, history, events, reset, step, log } = useSimulation(sim, params, active, speed)
  const go = (label: string) => { setView(label); window.location.hash = label }
  const latest = history[history.length - 1] ?? {}

  const setParam = (key: string, value: number | boolean | string) =>
    setParamsBySim((all) => ({ ...all, [sim.id]: { ...params, [key]: value } }))

  const visible = simulations.filter(
    (s) =>
      (!filters.length || filters.includes(s.category)) &&
      (s.name + s.description + (s.tags ?? []).join(" ")).toLowerCase().includes(query.toLowerCase()),
  )
  const recommended = visible.filter((s) => s.category !== "custom")
  const others = visible.filter((s) => s.category === "custom")

  const launch = (id: string) => {
    setSimId(id)
    setRunning(true)
  }
  const togglePlay = (on: boolean) => {
    setRunning(on)
    log({ kind: on ? "info" : "warning", label: on ? "Resumed" : "Paused", detail: `at tick ${tick}` })
  }

  const kpis = Object.entries(latest).slice(0, 3)

  return (
    <Suspense fallback={null}>
    <div className="app">
      <Splash />
      <nav className="rail" aria-label="Main">
        <button type="button" className="mark-btn" aria-label="Drug Board" onClick={() => {
          logoClicks.current += 1
          if (logoClicks.current % 5 === 0) setParade((n) => n + 1)
        }}><Mark /></button>
        <div className="rail-items">
          {rail.map(({ label, icon: Icon }) => (
            <Button key={label} aria-label={label} data-active={label === view || undefined}
              aria-current={label === view ? "page" : undefined} onClick={() => go(label)}>
              <Icon size={18} aria-hidden="true" />
            </Button>
          ))}
        </div>
        <SideCrew parade={parade} />
        <div className="avatar" aria-hidden="true">BD</div>
      </nav>

      <section className="list" aria-label="Simulations" hidden={view !== "Simulations"}>
        <header className="list-head">
          <h2>Simulations available <span className="count">{simulations.length}</span></h2>
        </header>
        <InputGroup className="search">
          <Input type="search" aria-label="Search simulations" placeholder="Search" value={query}
            onChange={(e) => setQuery(e.currentTarget.value)} />
          <InputClear aria-label="Clear search" />
        </InputGroup>
        <ToggleGroup multiple aria-label="Filter by category" className="chips" value={filters}
          onValueChange={(v) => setFilters(v as string[])}>
          {categories.map((c) => (
            <Toggle key={c} value={c}>{categoryLabels[c]}</Toggle>
          ))}
        </ToggleGroup>

        <div className="cards">
          {recommended.length > 0 && <h3>Recommended</h3>}
          {recommended.map((s) => (
            <SimCard key={s.id} sim={s} index={simulations.indexOf(s)} active={s.id === sim.id}
              running={running} value={s.id === sim.id ? latest[s.headline ?? ""] : undefined} onLaunch={launch} />
          ))}
          {others.length > 0 && <h3>Other simulations</h3>}
          {others.map((s) => (
            <SimCard key={s.id} sim={s} index={simulations.indexOf(s)} active={s.id === sim.id}
              running={running} value={s.id === sim.id ? latest[s.headline ?? ""] : undefined} onLaunch={launch} />
          ))}
          {visible.length === 0 && (
            <p className="muted">
              {simulations.length === 0 ? "No simulations yet. Add one in src/sim/registry.ts." : "No simulations match."}
            </p>
          )}
        </div>
      </section>

      <main className="main" hidden={view !== "Simulations"}>
        <section className="map card-surface" aria-label="Simulation view">
          <canvas ref={canvasRef} />
          <div className="map-title">
            <h1>{idle ? "Nothing running" : `${sim.name} overview`}</h1>
            <p>{idle ? "Add a simulation to put the crew to work" : `Tick ${tick.toLocaleString()} · ${categoryLabels[sim.category]} simulation`}</p>
          </div>
          {idle && (
            <div className="map-empty">
              <Buddy species="egg" mood="sleeping" size={84} />
              <p>No simulation loaded</p>
              <span className="muted small">Add one in src/sim/registry.ts</span>
            </div>
          )}

          <Toolbar aria-label="Simulation tools" className="map-tools">
            <Toggle aria-label={running ? "Pause" : "Play"} pressed={running} onPressedChange={togglePlay}>
              {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            </Toggle>
            <ToolbarButton aria-label="Step" onClick={step} disabled={running}>
              <SkipForward size={16} aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton aria-label="Reset" onClick={reset}>
              <RotateCcw size={16} aria-hidden="true" />
            </ToolbarButton>
            <Toggle aria-label="Inspector" pressed={inspector} onPressedChange={setInspector}>
              {inspector ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}
            </Toggle>
            <ToolbarButton aria-label="Full screen" onClick={() => canvasRef.current?.parentElement?.requestFullscreen()}>
              <Expand size={16} aria-hidden="true" />
            </ToolbarButton>
          </Toolbar>

          {inspector && (
            <aside className="inspector" aria-label="Simulation analysis">
              <div className="inspector-head">
                <Sparkles size={14} aria-hidden="true" />
                <h2>Simulation analysis</h2>
              </div>
              <Tabs value={tab} onValueChange={(v) => v && setTab(v)}>
                <TabsList aria-label="Inspector sections">
                  <TabsTab value="copilot">Copilot</TabsTab>
                  <TabsTab value="controls">Controls</TabsTab>
                  <TabsTab value="metrics">Metrics</TabsTab>
                  <TabsTab value="about">About</TabsTab>
                </TabsList>
                <TabsPanel value="copilot" className="copilot-panel">
                  {tab === "copilot" && view === "Simulations" && <CopilotPanel
                    context={{
                      sim, params, metrics: latest, tick, running,
                      play: () => setRunning(true),
                      pause: () => setRunning(false),
                      reset,
                      setParam,
                    }}
                  />}
                </TabsPanel>
                <TabsPanel value="controls">
                  <Slider className="speed" min={0.25} max={10} step={0.25} value={speed}
                    onValueChange={(v) => setSpeed(v as number)} format={{ maximumFractionDigits: 2 }}>
                    <div className="param-head">
                      <span className="label">Speed (steps / frame)</span>
                      <SliderValue />
                    </div>
                    <SliderControl>
                      <SliderTrack>
                        <SliderIndicator />
                        <SliderThumb aria-label="Speed" />
                      </SliderTrack>
                    </SliderControl>
                  </Slider>
                  <ParamPanel specs={sim.params} values={params} resetOn={sim.resetOn ?? []} onChange={setParam} />
                </TabsPanel>
                <TabsPanel value="metrics">
                  {tab === "metrics" && <MetricsChart history={history} />}
                </TabsPanel>
                <TabsPanel value="about">
                  <p className="about">{sim.description}</p>
                </TabsPanel>
              </Tabs>
              <div className="kpi-strip">
                {kpis.map(([k, v]) => (
                  <div key={k}>
                    <Activity size={14} aria-hidden="true" />
                    <strong>{fmt(v)}</strong>
                    <span>{k}</span>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </section>

        <section className="bottom">
          <Timeline events={events} />
          <article className="status card-surface" aria-label="Run status">
            <div className="status-preview">
              {sim.headline && view === "Simulations" && (
                <SeriesChart history={history} metric={sim.headline} color="#1b1a17" className="aspect-auto h-[70px] w-full" />
              )}
            </div>
            <div className="status-body">
              <div className="status-row">
                <h2>Run status</h2>
                <span className={`pill ${active ? "pill-success" : "pill-warning"}`}>{idle ? "Resting" : running ? "Running" : "Paused"}</span>
              </div>
              <p className="muted small">RUN-{String(simulations.indexOf(sim) + 1).padStart(4, "0")}</p>
              <p className="big">{fmt(latest[sim.headline ?? ""])} <span className="muted small">{sim.headline}</span></p>
              <dl>
                <dt>Ticks</dt><dd>{tick.toLocaleString()}</dd>
                <dt>Speed</dt><dd>{speed}×</dd>
              </dl>
            </div>
          </article>
        </section>
      </main>

      {view === "Analytics" && <AnalyticsView sim={sim} history={history} events={events} tick={tick} />}
      {view === "Overview" && (
        <OverviewView simCount={simulations.length} tick={tick} eventCount={events.length} active={active}
          onOpenSimulations={() => go("Simulations")} onMeetCrew={() => go("Agents")} onOpenKeys={() => go("Settings")} />
      )}
      {view === "Swarm" && <SwarmView />}
      {view === "Board" && <BoardView />}
      {view === "Agents" && <AgentsView />}
      {view === "Settings" && <SettingsView />}
      {!["Swarm", "Board", "Simulations", "Analytics", "Overview", "Agents", "Settings"].includes(view) && (
        <PlaceholderView title={view} hint={rail.find((r) => r.label === view)!.hint} />
      )}
    </div>
    </Suspense>
  )
}
