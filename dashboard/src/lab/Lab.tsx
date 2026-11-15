// Agent Lab design by Anh Lam. The scene and its side panel together, as on Anh's page: click a teammate to inspect
// it. Until someone is clicked, the panel follows the teammate the engine reported on last.
import { useState } from "react"
import { LabPanel } from "./LabPanel"
import { LabScene, type LabSceneProps } from "./LabScene"
import { CHARACTER_IDS, type CharacterId, type LabModel } from "./model"

/** The teammate whose state changed last, among those doing something. The Scout when nobody is. */
export function latestActive(model: LabModel): CharacterId {
  let best: CharacterId = "scout", at = -Infinity
  for (const id of CHARACTER_IDS) {
    const a = model.characters[id]
    if (!a.inRun || a.state === "idle" || a.since === undefined) continue
    if (a.since >= at) { best = id; at = a.since }
  }
  return best
}

export interface LabProps extends Omit<LabSceneProps, "selected" | "onSelect"> {
  /** Leave the panel out (the scene alone, for a narrow strip). */
  panel?: boolean
}

/** `<Lab model={model} />`: the lab for one run. Everything it shows comes from `model`. */
export function Lab({ panel = true, compact, ...scene }: LabProps) {
  const [picked, setPicked] = useState<{ run: string | undefined; id: CharacterId }>()
  const selected = picked && picked.run === scene.model.runId ? picked.id : latestActive(scene.model)
  return (
    <div className="lab-both" data-compact={compact || undefined}>
      <LabScene {...scene} compact={compact} selected={selected} onSelect={(id) => setPicked({ run: scene.model.runId, id })} />
      {panel && <LabPanel model={scene.model} selected={selected} compact={compact} />}
    </div>
  )
}
