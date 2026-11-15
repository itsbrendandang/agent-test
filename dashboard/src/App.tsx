// The shell: the navigation (a compact sidebar, or a drawer on a narrow window), one header row, and the view.
// The header takes its own row and the view scrolls inside the content area, so nothing ever lies over content.
// Which view shows is in the URL hash; the keys of nav.ts are the addresses and never change.
import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from "react"
import { PanelLeft } from "lucide-react"
import { AppSidebar } from "./components/AppSidebar"
import { Loading } from "./components/Crew"
import { HeaderProvider } from "./components/HeaderSlot"
import { HowItWorks } from "./components/HowItWorks"
import { NextRun } from "./components/PaidSwitch"
import { EngineNotice } from "./components/Shared"
import { Splash } from "./components/Splash"
import { TokenPrompt } from "./components/TokenPrompt"
import { SidebarProvider, useSidebar } from "./components/ui/sidebar"
import { TooltipProvider } from "./components/ui/tooltip"
import { ViewBoundary } from "./components/ViewBoundary"
import { getCatalog } from "./home/api"
import { setOpen } from "./lib/open"
import { HELP, useShell } from "./lib/shell"
import { initialView, LABEL, rememberView, runOfHash, viewOfHash, type View } from "./nav"
import { AgentsView } from "./views/AgentsView"
import { BoardView } from "./views/BoardView"
import { ExperimentsView } from "./views/ExperimentsView"
import { HomeView } from "./views/HomeView"
import { LabView } from "./views/LabView"
import { SettingsView } from "./views/SettingsView"
import { SwarmView } from "./views/SwarmView"

// The graph brings a 3D library with it: it loads only when the Graph view is opened, and if it fails to load
// only that view says so (ViewBoundary), not the whole app.
const WorldsView = lazy(() => import("./views/WorldsView").then((m) => ({ default: m.WorldsView })))

const SIDEBAR_WIDTH = { "--sidebar-width": "13.75rem" } as CSSProperties // compact: the research area gets the width
const SIDEBAR = "shell.sidebar" // "1" open, "0" icons only: the person's last choice on a wide window
const sidebarOpen = (): boolean => {
  try { const saved = localStorage.getItem(SIDEBAR); if (saved === "1" || saved === "0") return saved === "1" } catch { /* private mode */ }
  return window.innerWidth >= 1100 // no choice yet: full labels where there is room, icons on a mid-size window
}

/** Opens the drawer on a narrow window; folds the sidebar to icons on a wide one. */
function MenuButton() {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar()
  const shown = isMobile ? openMobile : open
  return (
    <button type="button" className="header-btn" aria-expanded={shown} onClick={toggleSidebar}
      aria-label={isMobile ? "Open the menu" : open ? "Show the navigation as icons" : "Show the navigation with names"}>
      <PanelLeft size={18} aria-hidden="true" />
    </button>
  )
}

export default function App() {
  // An address may name a run ("#Board/<id>"): it is handed to that view before it mounts.
  const hand = (hash: string) => { const v = viewOfHash(hash), id = runOfHash(hash); if (id && (v === "Board" || v === "Compare")) setOpen(v === "Board" ? "board" : "swarm", id); return id }
  const [view, setView] = useState<View>(() => { hand(window.location.hash); return initialView(window.location.hash) })
  const [linked, setLinked] = useState(0) // goes up when the address names another run, so the view opens it
  const [help, setHelp] = useState(false)
  const [open, setOpenState] = useState(sidebarOpen)
  const setSidebar = (next: boolean) => { setOpenState(next); try { localStorage.setItem(SIDEBAR, next ? "1" : "0") } catch { /* private mode */ } }
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
  // The two places of the header row a view may fill (HeaderSlot).
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null)
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null)
  const targets = useMemo(() => ({ title: titleEl, actions: actionsEl }), [titleEl, actionsEl])

  return (
    <TooltipProvider delayDuration={250}>
      <SidebarProvider className="app" style={SIDEBAR_WIDTH} open={open} onOpenChange={setSidebar}>
        <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus() }}>Skip to the content</a>
        <Splash ready={shell.engine !== "unknown" && catalogAnswered} offline={shell.engine === "offline"} />
        <TokenPrompt />
        <HowItWorks open={help} onClose={() => setHelp(false)} />
        <AppSidebar view={view} onGo={go} />
        <div className="app-body">
          <header className="app-header">
            <MenuButton />
            <p className="app-place" data-testid="place">{LABEL[view]}</p>
            <div className="app-header-title" ref={setTitleEl} />
            <NextRun paid={shell.paid} locked={shell.locked} />
            <div className="app-header-actions" ref={setActionsEl} />
          </header>
          <main className="page-host" id="main" tabIndex={-1}>
            <HeaderProvider value={targets}>
              <EngineNotice shell={shell} />
              <ViewBoundary view={LABEL[view]}>
                {view === "Home" && <HomeView onOpen={go} />}
                {view === "Runs" && <ExperimentsView onOpen={go} />}
                {view === "Compare" && <SwarmView key={linked} />}
                {view === "Board" && <BoardView key={linked} />}
                {view === "Agents" && <AgentsView />}
                {view === "Graph" && <Suspense fallback={<div className="page"><Loading className="loading-block">Loading the graph…</Loading></div>}><WorldsView /></Suspense>}
                {view === "Lab" && <LabView />}
                {view === "Settings" && <SettingsView />}
              </ViewBoundary>
            </HeaderProvider>
          </main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
