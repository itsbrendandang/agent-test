// The Agent Log as a group chat: which rows start or end an agent's run of messages, and how a long message is cut
// into a short line and its "thinking". No React here; EventLog.tsx draws it.
import type { EventRow } from "./logRows"

/** Longest short line a bubble shows before the rest goes behind "Show thinking". */
export const SAY_MAX = 140

/** The short line a bubble shows, and the rest of the text (the agent's reasoning) when there is more. */
export function splitThought(text: string, max = SAY_MAX): { say: string; thinking?: string } {
  const t = text.trim()
  if (t.length <= max && !t.includes("\n")) return { say: t }
  const line = t.split("\n")[0].trimEnd()
  let say = line
  let cut = false
  if (line.length > max) {
    // Cut after the last full sentence that fits; else at the last space, marked with an ellipsis.
    const sentence = [...line.slice(0, max + 1).matchAll(/[.!?](?=\s)/g)].map((m) => m.index! + 1).filter((i) => i >= 30).pop()
    if (sentence) say = line.slice(0, sentence)
    else { const space = line.lastIndexOf(" ", max); say = line.slice(0, space > 30 ? space : max); cut = true }
  }
  const rest = t.slice(say.length).trim()
  if (!rest) return { say }
  return { say: cut ? `${say}…` : say, thinking: cut ? `…${rest}` : rest }
}

export interface ChatItem {
  row: EventRow
  /** The first message of an agent's run: shows the picture and the name. */
  first: boolean
  /** The last message of an agent's run: the bubble gets its tail. */
  last: boolean
}

/** Consecutive messages from the same agent form one run; a note (tool call, search, system step) ends a run. */
export function chatItems(rows: readonly EventRow[]): ChatItem[] {
  const same = (a?: EventRow, b?: EventRow) => !!a && !!b && !a.note && !b.note && a.agentId === b.agentId
  return rows.map((row, i) => ({ row, first: !row.note && !same(rows[i - 1], row), last: !row.note && !same(row, rows[i + 1]) }))
}
