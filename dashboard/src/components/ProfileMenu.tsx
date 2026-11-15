// The profile row at the foot of the navigation, and the small menu it opens. The app has no accounts and no
// login: the name and organisation are what the person typed in Settings ("Your profile"), kept in this browser
// only. Beside the name is the mode of the NEXT run (Demo or Real), read from the engine. The menu holds only
// things that do something: Settings, How this works, Show characters, and the app's version.
import { ChevronsUpDown, CircleHelp, Settings, Smile, UserRound } from "lucide-react"
import { DropdownMenu as Menu } from "radix-ui"
import { setCharactersShown, useCharacters } from "@/crew/store"
import type { PaidState } from "@/lib/paid"
import { initials, NO_ORGANISATION, useProfile, type Profile } from "@/lib/profile"
import { openHelp } from "@/lib/shell"
import { VERSION } from "@/lib/version"

/** The round picture: the person's initials, or a neutral figure until a profile is set. Decoration: the name is beside it. */
export function ProfileAvatar({ profile, size = 32 }: { profile: Profile | undefined; size?: number }) {
  return (
    <span className="profile-avatar" data-set={profile ? "" : undefined} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {profile ? initials(profile.name) : <UserRound size={Math.round(size * 0.55)} />}
    </span>
  )
}
/** "Demo" or "Real": how the next run is made. Nothing while the engine has not said. */
function ModeBadge({ paid }: { paid: PaidState }) {
  if (paid === "unknown") return null
  return <span className="mode-badge" data-state={paid} title={paid === "on" ? "Run mode: Real. New runs use live AI models and cost money." : "Run mode: Demo. New runs use fixed example answers and are free."}>{paid === "on" ? "Real" : "Demo"}</span>
}
function Who({ profile, paid }: { profile: Profile | undefined; paid: PaidState }) {
  return (
    <span className="profile-who">
      <span className="profile-name"><span className="profile-nametext">{profile ? profile.name : "Set up your profile"}</span><ModeBadge paid={paid} /></span>
      <span className="profile-org">{profile ? profile.organisation || NO_ORGANISATION : NO_ORGANISATION}</span>
    </span>
  )
}

export function ProfileMenu({ paid, collapsed, current, onSettings }: {
  /** The engine's mode for the next run. */
  paid: PaidState
  /** The navigation is folded to icons: the row is only the avatar. */
  collapsed?: boolean
  /** Settings is the place on screen. */
  current?: boolean
  onSettings: () => void
}) {
  const profile = useProfile()
  const characters = useCharacters()
  const label = profile ? `${profile.name}: profile and settings` : "Set up your profile: profile and settings"
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" className="profile-row" data-collapsed={collapsed || undefined} aria-label={label} aria-current={current ? "page" : undefined}>
          <ProfileAvatar profile={profile} />
          {!collapsed && <><Who profile={profile} paid={paid} /><ChevronsUpDown className="profile-chevron" size={16} aria-hidden="true" /></>}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="profile-menu" side="top" align="start" sideOffset={8} collisionPadding={8}>
          <div className="profile-head">
            <ProfileAvatar profile={profile} size={36} />
            <span className="profile-who">
              <span className="profile-name"><span className="profile-nametext">{profile ? profile.name : "No profile yet"}</span><ModeBadge paid={paid} /></span>
              <span className="profile-org">{profile ? [profile.role, profile.organisation || NO_ORGANISATION].filter(Boolean).join(" · ") : "Add your name in Settings. It stays in this browser."}</span>
            </span>
          </div>
          <Menu.Separator className="profile-sep" />
          <Menu.Item className="profile-item" onSelect={onSettings}><Settings size={16} aria-hidden="true" />Settings</Menu.Item>
          <Menu.Item className="profile-item" onSelect={openHelp}><CircleHelp size={16} aria-hidden="true" />How this works</Menu.Item>
          <Menu.CheckboxItem className="profile-item" checked={characters} onCheckedChange={(on) => setCharactersShown(on === true)} onSelect={(e) => e.preventDefault()}>
            <Smile size={16} aria-hidden="true" />Show characters<span className="profile-switch" aria-hidden="true" />
          </Menu.CheckboxItem>
          <Menu.Separator className="profile-sep" />
          <p className="profile-foot">v{VERSION}</p>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
