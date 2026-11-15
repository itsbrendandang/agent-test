// The inspector's Lab tab: the team at work, drawn from the same events as the answer.
import { useMemo } from "react"
import { Lab, answerLab, type LabEvent } from "@/lab"
import type { ResearchEvent } from "./model"

export default function LabTab({ id, events }: { id: string; events: ResearchEvent[] }) {
  const model = useMemo(() => answerLab(events as unknown as LabEvent[], id), [events, id])
  return <Lab model={model} compact />
}
