// The one badge that says how a result was made: "Practice" or "Live research" (or "Local model"), with an icon and
// the word, so it never rests on colour. It is read from the record's own data (lib/provenance.ts) and is the same
// in every list, card and view. The mode selector in the header is a different thing: it is about the NEXT run.
import { CircleDashed, Cpu, Radio } from "lucide-react"
import { PROVENANCE_ABOUT, PROVENANCE_WORD, type ProvenanceKind } from "@/lib/provenance"

const ICON = { practice: CircleDashed, live: Radio, local: Cpu } as const

/** Nothing is shown while the record has not said how it was made. `detail` is a short extra, such as a model name. */
export function Provenance({ kind, detail, compact }: { kind: ProvenanceKind | undefined; detail?: string; compact?: boolean }) {
  if (!kind) return null
  const Icon = ICON[kind]
  return (
    <span className="prov" data-provenance={kind} data-compact={compact || undefined} title={`${PROVENANCE_WORD[kind]}: ${PROVENANCE_ABOUT[kind]}`}>
      <Icon size={12} strokeWidth={2.25} aria-hidden="true" />
      <span>{PROVENANCE_WORD[kind]}</span>
      {detail && <span className="prov-detail">{detail}</span>}
    </span>
  )
}
