// Where the inspector sits: a column beside the conversation whose width can be dragged (or changed with the arrow
// keys) and is remembered, or a drawer over the page when the window is too narrow for two columns.
import { useRef, type ReactNode } from "react"
import { PanelRightIcon } from "lucide-react"
import { clampWidth as clamp, MAX_WIDTH as MAX, MIN_WIDTH as MIN } from "./inspectorState"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

/** The header button that shows or hides the inspector. */
export function InspectorToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="header-btn" aria-pressed={open} aria-controls="research-inspector" aria-label={open ? "Hide the inspector" : "Show the inspector: evidence, files and activity"} title={open ? "Hide the inspector" : "Show the inspector"} onClick={onToggle}>
      <PanelRightIcon aria-hidden="true" size={18} />
    </button>
  )
}

export function InspectorPane({ narrow, width, onWidth, onClose, children }: { narrow: boolean; width: number; onWidth: (w: number) => void; onClose: () => void; children: ReactNode }) {
  const drag = useRef<{ x: number; w: number } | undefined>(undefined)
  if (narrow) return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" id="research-inspector" className="inspector-sheet">
        <SheetHeader className="inspector-sheethead"><SheetTitle>Inspector</SheetTitle><SheetDescription className="sr-only">Evidence, files and activity of the answer.</SheetDescription></SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
  return (
    <aside className="inspector-pane" id="research-inspector" aria-label="Inspector" style={{ width }}>
      <div className="inspector-grip" role="separator" aria-orientation="vertical" aria-label="Inspector width" aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={width} tabIndex={0}
        onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); onWidth(clamp(width + 24)) } else if (e.key === "ArrowRight") { e.preventDefault(); onWidth(clamp(width - 24)) } }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, w: width }; e.currentTarget.setPointerCapture?.(e.pointerId) }}
        onPointerMove={(e) => { if (drag.current) onWidth(clamp(drag.current.w + drag.current.x - e.clientX)) }}
        onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }} />
      {children}
    </aside>
  )
}
