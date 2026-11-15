import { Verdict } from "@/components/Shared"
import type { Verdict as BoardVerdict } from "@/board/api"
import type { ClaimVerdict } from "@/swarm/api"
import type { Verdict as V } from "./types"

const CLAIM_WORDS = ["verified", "contradicted", "unsupported", "unchecked", "supported", "refuted", "insufficient", "untested"]

/**
 * The dashboard's own verdict pill: one of the four marks with its glyph ("✓ Supported", "✕ Contradicted", "? Insufficient evidence", "○ Not checked")
 * and the checker's own word as a small second line. A test has two results of its own, shown in the same style.
 */
export function VerdictPill({ verdict, technical = true }: { verdict: V; technical?: boolean }) {
  if (CLAIM_WORDS.includes(verdict.raw)) return <Verdict verdict={verdict.raw as BoardVerdict | ClaimVerdict} technical={technical} />
  const against = verdict.raw === "went against the statement"
  return <span className={`pill ${against ? "sv-refuted" : "sv-untested"}`}>{against ? "Went against the statement" : "No result yet"}</span>
}
