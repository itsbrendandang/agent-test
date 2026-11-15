// One plain line at the top of every view: whether the engine answers and whether it may spend money.
import { ModeIndicator } from "./PaidSwitch"
import { PRODUCT } from "@/nav"
import type { Shell } from "@/lib/shell"

const ENGINE_LABEL = { online: "Engine online", offline: "Engine not running", error: "Engine problem", unknown: "Engine: checking" } as const

export function StatusLine({ shell, onOpenSettings, onHelp }: { shell: Shell; onOpenSettings: () => void; onHelp?: () => void }) {
  return (
    <div className="statusline" role="group" aria-label="Status">
      <strong>{PRODUCT}</strong>
      <span aria-hidden="true"> · </span>
      <span data-state={shell.engine} title={shell.said}>{ENGINE_LABEL[shell.engine]}{shell.said && `: ${shell.said}`}</span>
      <span aria-hidden="true"> · </span>
      <ModeIndicator paid={shell.paid} locked={shell.locked} />
      <span aria-hidden="true"> · </span>
      {onHelp && <><button type="button" className="link-btn" onClick={onHelp}>How this works</button><span aria-hidden="true"> · </span></>}
      <button type="button" className="link-btn" onClick={onOpenSettings}>Settings</button>
    </div>
  )
}
