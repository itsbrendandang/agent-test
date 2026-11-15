// The shell: a rail of views on the left (with one small Demo / Real chip at its foot), and the view. No bar on top. Which view shows is in the URL hash.
import { lazy, Suspense, useEffect, useState } from "react"
import { FlaskConical, GitCompareArrows, Home, ListChecks, Settings, Share2, Users } from "lucide-react"
import { Mark } from "./components/Buddy"
import { Loading } from "./components/Crew"
import { SideCrew } from "./components/SideCrew"
import { Splash } from "./components/Splash"
import { ModeIndicator } from "./components/PaidSwitch"
import { TokenPrompt } from "./components/TokenPrompt"
import { ViewBoundary } from "./components/ViewBoundary"
import { getCatalog } from "./home/api"
import { HELP, useShell } from "./lib/shell"
import { HowItWorks } from "./components/HowItWorks"
import { setOpen } from "./lib/open"
import { initialView, LABEL, rememberView, runOfHash, viewOfHash, VIEWS, type View } from "./nav"
import { AgentsView } from "./views/AgentsView"
import { BoardView } from "./views/BoardView"
import { ExperimentsView } from "./views/ExperimentsView"
import { HomeView } from "./views/HomeView"
import { SettingsView } from "./views/SettingsView"
import { SwarmView } from "./views/SwarmView"

// The graph brings a 3D library with it: it loads only when the Graph view is opened, and if it fails to load
// only that view says so (ViewBoundary), not the whole app. views/WorldsView.tsx belongs to the graph work.
const WorldsView = lazy(() => import("./views/WorldsView").then((m) => ({ default: m.WorldsView })))

const ICON: Record<View, typeof Home> = { Home, Runs: ListChecks, Compare: GitCompareArrows, Board: FlaskConical, Agents: Users, Graph: Share2, Settings }
export default function App() {
  // An address may name a run ("#Board/<id>"): it is handed to that view before it mounts.
  const hand = (hash: string) => { const v = viewOfHash(hash), id = runOfHash(hash); if (id && (v === "Board" || v === "Compare")) setOpen(v === "Board" ? "board" : "swarm", id); return id }
  const [view, setView] = useState<View>(() => { hand(window.location.hash); return initialView(window.location.hash) })
  const [linked, setLinked] = useState(0) // goes up when the address names another run, so the view opens it
  const [help, setHelp] = useState(false)
  useEffect(() => rememberView(view), [view])
  useEffect(() => { const show = () => setHelp(true); window.addEventListener(HELP, show); return () => window.removeEventListener(HELP, show) }, [])
  // The hash is the address of a view, so the browser's Back and Forward buttons move between views.
  useEffect(() => {
    const sync = () => { const v = viewOfHash(window.location.hash); if (hand(window.location.hash)) setLinked((n) => n + 1); if (v) setView(v) }
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])
  const go = (next: View) => { setView(next); window.location.hash = next }
  const shell = useShell()
  // The loading screen stays until the engine's status and catalog have both answered (or failed); see Splash for the limits.
  const [catalogAnswered, setCatalogAnswered] = useState(false)
  useEffect(() => { const done = () => setCatalogAnswered(true); getCatalog().then(done, done) }, [])

  return (
    <div className="app">
      <Splash ready={shell.engine !== "unknown" && catalogAnswered} offline={shell.engine === "offline"} />
      <TokenPrompt />
      <HowItWorks open={help} onClose={() => setHelp(false)} />
      <nav className="rail" aria-label="Views">
        <span className="rail-mark" aria-hidden="true"><Mark size={30} /></span>
        {VIEWS.map((label) => {
          const Icon = ICON[label]
          return (
            <button key={label} type="button" className="rail-item" aria-current={label === view ? "page" : undefined} onClick={() => go(label)}>
              <Icon size={18} aria-hidden="true" />
              <span>{LABEL[label]}</span>
            </button>
          )
        })}
        <span className="rail-mode"><ModeIndicator paid={shell.paid} locked={shell.locked} short /></span>
        <SideCrew />
      </nav>
      <main className="page-host">
        <ViewBoundary view={view}>
          {view === "Home" && <HomeView onOpen={go} />}
          {view === "Runs" && <ExperimentsView onOpen={go} />}
          {view === "Compare" && <SwarmView key={linked} />}
          {view === "Board" && <BoardView key={linked} />}
          {view === "Agents" && <AgentsView />}
          {view === "Graph" && <Suspense fallback={<div className="page"><Loading className="loading-block">Loading the graph…</Loading></div>}><WorldsView /></Suspense>}
          {view === "Settings" && <SettingsView />}
        </ViewBoundary>
      </main>
    </div>
  )
}
