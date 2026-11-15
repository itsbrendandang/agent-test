// The shell: one status line on top, a rail of views on the left, and the view. Which view shows is in the URL hash.
import { lazy, Suspense, useEffect, useState } from "react"
import { FlaskConical, GitCompareArrows, Home, ListChecks, Settings, Share2, Users } from "lucide-react"
import { Mark } from "./components/Buddy"
import { SideCrew } from "./components/SideCrew"
import { StatusLine } from "./components/StatusLine"
import { TokenPrompt } from "./components/TokenPrompt"
import { ViewBoundary } from "./components/ViewBoundary"
import { useShell } from "./lib/shell"
import { initialView, viewOfHash, VIEWS, type View } from "./nav"
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
  const [view, setView] = useState<View>(() => initialView(window.location.hash))
  // The hash is the address of a view, so the browser's Back and Forward buttons move between views.
  useEffect(() => {
    const sync = () => { const v = viewOfHash(window.location.hash); if (v) setView(v) }
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])
  const go = (next: View) => { setView(next); window.location.hash = next }
  const shell = useShell()

  return (
    <div className="app">
      <TokenPrompt />
      <StatusLine shell={shell} onOpenSettings={() => go("Settings")} />
      <nav className="rail" aria-label="Views">
        <span className="rail-mark" aria-hidden="true"><Mark size={30} /></span>
        {VIEWS.map((label) => {
          const Icon = ICON[label]
          return (
            <button key={label} type="button" className="rail-item" aria-current={label === view ? "page" : undefined} onClick={() => go(label)}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </button>
          )
        })}
        <SideCrew />
      </nav>
      <main className="page-host">
        <ViewBoundary view={view}>
          {view === "Home" && <HomeView onOpen={go} />}
          {view === "Runs" && <ExperimentsView onOpen={go} />}
          {view === "Compare" && <SwarmView />}
          {view === "Board" && <BoardView />}
          {view === "Agents" && <AgentsView />}
          {view === "Graph" && <Suspense fallback={<div className="page"><p className="muted" role="status">Loading the graph…</p></div>}><WorldsView /></Suspense>}
          {view === "Settings" && <SettingsView />}
        </ViewBoundary>
      </main>
    </div>
  )
}
