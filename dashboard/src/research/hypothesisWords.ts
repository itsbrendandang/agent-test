// The words for hypotheses, in one place: the Research conversation, its inspector, the Lab and the Graph view say the same.
import type { Hypothesis } from "./model"

/** The line under the map and above the inspector's table. Shared words: the Lab and the Graph view use the same. */
export const HYPOTHESES_NOTE = "Tested against published sources, not by experiment."

/** "2 sources for, 1 against". */
export const sidesLine = (r: NonNullable<Hypothesis["result"]>): string => `${r.for.length} source${r.for.length === 1 ? "" : "s"} for, ${r.against.length} against`
