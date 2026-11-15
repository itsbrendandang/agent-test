// The navigation: a compact sidebar on a wide window, a drawer on a narrow one (the shadcn Sidebar does both).
// Three places carry the everyday loop (ask, read, find again). One quieter group follows, with a heading:
// "How it works" (how an answer was made). Benchmarks and Compare are not listed; they open by address. At the foot is the profile row: it opens the menu that leads to Settings, which is Settings' one entry.
import { Gavel, LayoutDashboard, ListChecks, MessagesSquare, ScrollText, Settings, Share2, Users, X } from "lucide-react"
import { Mark } from "@/components/Buddy"
import { ProfileMenu } from "@/components/ProfileMenu"
import { SideCrew } from "@/components/SideCrew"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar"
import type { PaidState } from "@/lib/paid"
import { ABOUT, LABEL, MORE, MORE_LABEL, PRIMARY, PRODUCT, type Listed, type View } from "@/nav"

const ICON: Record<Listed, typeof Settings> = {
  Overview: LayoutDashboard, Home: MessagesSquare, Runs: ListChecks, Board: Gavel, Agents: Users, Graph: Share2, Lab: ScrollText,
}

export function AppSidebar({ view, onGo, paid }: { view: View; onGo: (view: View) => void; /** The mode of the next run, for the profile row. */ paid: PaidState }) {
  const { isMobile, setOpenMobile, state } = useSidebar()
  const go = (next: View) => { onGo(next); if (isMobile) setOpenMobile(false) } // choosing a place closes the drawer
  const item = (v: Listed, quiet?: boolean) => {
    const Icon = ICON[v]
    return (
      <SidebarMenuItem key={v}>
        <SidebarMenuButton className="nav-item" data-quiet={quiet || undefined} isActive={v === view} aria-current={v === view ? "page" : undefined}
          tooltip={LABEL[v]} title={state === "collapsed" ? undefined : ABOUT[v]} onClick={() => go(v)}>
          <Icon aria-hidden="true" />
          <span>{LABEL[v]}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }
  return (
    <Sidebar collapsible="icon" className="app-sidebar">
      <SidebarHeader className="nav-brand">
        <span className="nav-mark" aria-hidden="true"><Mark size={24} /></span>
        <span className="nav-name">{PRODUCT}</span>
        {isMobile && <button type="button" className="header-btn nav-close" aria-label="Close the menu" onClick={() => setOpenMobile(false)}><X size={18} aria-hidden="true" /></button>}
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Places">
          <SidebarGroup>
            <SidebarGroupContent><SidebarMenu>{PRIMARY.map((v) => item(v))}</SidebarMenu></SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel id="nav-how">{MORE_LABEL}</SidebarGroupLabel>
            <SidebarGroupContent><SidebarMenu aria-labelledby="nav-how">{MORE.map((v) => item(v, true))}</SidebarMenu></SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        {!isMobile && state === "expanded" && <SideCrew />}
        <ProfileMenu paid={paid} collapsed={!isMobile && state === "collapsed"} current={view === "Settings"} onSettings={() => go("Settings")} />
      </SidebarFooter>
    </Sidebar>
  )
}
