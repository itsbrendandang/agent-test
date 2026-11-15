// The navigation: a compact sidebar on a wide window, a drawer on a narrow one (the shadcn Sidebar does both).
// Three places carry the everyday work; the advanced ones sit under "More", quieter; Settings is once, at the foot.
import { FlaskConical, GitCompareArrows, ListChecks, MessagesSquare, Microscope, Settings, Share2, Users, X } from "lucide-react"
import { Mark } from "@/components/Buddy"
import { SideCrew } from "@/components/SideCrew"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar"
import { ABOUT, LABEL, MORE, PRIMARY, PRODUCT, type View } from "@/nav"

const ICON: Record<View, typeof Settings> = {
  Home: MessagesSquare, Runs: ListChecks, Compare: GitCompareArrows, Board: FlaskConical, Agents: Users, Graph: Share2, Lab: Microscope, Settings,
}

export function AppSidebar({ view, onGo }: { view: View; onGo: (view: View) => void }) {
  const { isMobile, setOpenMobile, state } = useSidebar()
  const go = (next: View) => { onGo(next); if (isMobile) setOpenMobile(false) } // choosing a place closes the drawer
  const item = (v: View, quiet?: boolean) => {
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
            <SidebarGroupLabel id="nav-more">More</SidebarGroupLabel>
            <SidebarGroupContent><SidebarMenu aria-labelledby="nav-more">{MORE.map((v) => item(v, true))}</SidebarMenu></SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter>
        {!isMobile && state === "expanded" && <SideCrew />}
        <SidebarMenu aria-label="Settings">{item("Settings")}</SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
