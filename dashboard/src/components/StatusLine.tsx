// One plain line at the top of every view: whether the engine answers and whether it may spend money.
import { HOW_TO_TURN_ON, PAID_LABEL } from "@/lib/paid"
import { PRODUCT } from "@/nav"
import type { Shell } from "@/lib/shell"

const ENGINE_LABEL = { online: "Engine online", offline: "Engine offline", unknown: "Engine: checking" } as const

export function StatusLine({ shell, onOpenSettings }: { shell: Shell; onOpenSettings: () => void }) {
  return (
    <p className="statusline" role="status" aria-label="Status">
      <strong>{PRODUCT}</strong>
      <span aria-hidden="true"> · </span>
      <span data-state={shell.engine}>{ENGINE_LABEL[shell.engine]}</span>
      <span aria-hidden="true"> · </span>
      <span data-state={shell.paid} title={shell.paid === "unknown" ? "The engine did not say whether paid calls are allowed. It may be offline." : HOW_TO_TURN_ON}>{PAID_LABEL[shell.paid]}</span>
      <span aria-hidden="true"> · </span>
      <button type="button" className="link-btn" onClick={onOpenSettings}>Settings</button>
    </p>
  )
}
