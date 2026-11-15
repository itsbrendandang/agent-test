// The Agent Log as a group chat: which rows start or end an agent's run of messages, and how a long message is cut
// into a short line and the rest. No React here; EventLog.tsx draws it.
import type { EventRow } from "./logRows"

/** Longest short line a bubble shows before the rest goes behind "Show thinking" or "Show more". */
export const SAY_MAX = 140

/** The short line a bubble shows, and the rest of the text when there is more. */
export function splitMessage(text: string, max = SAY_MAX): { say: string; more?: string } {
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
  return { say: cut ? `${say}…` : say, more: cut ? `…${rest}` : rest }
}

export interface ChatItem {
  row: EventRow
  /** The first message of an agent's run: shows the picture and the name. */
  first: boolean
  /** The last message of an agent's run: the bubble gets its tail. */
  last: boolean
  /** A team review's round begins here: the chat draws a "Round n" line above this row. */
  round?: { n: number; final?: boolean }
}

/** Consecutive messages from the same agent form one run; a note (tool call, search, system step) or a new round
 * ends a run. A row from a round other than the last one seen starts that round. */
export function chatItems(rows: readonly EventRow[]): ChatItem[] {
  const rounds: (number | undefined)[] = []
  let now: number | undefined
  const starts = rows.map((row) => {
    const begins = row.round && row.round.n !== now ? row.round : undefined
    if (row.round) now = row.round.n
    rounds.push(now)
    return begins
  })
  const same = (i: number, j: number) => {
    const a = rows[i], b = rows[j]
    return !!a && !!b && !a.note && !b.note && a.agentId === b.agentId && rounds[i] === rounds[j] && !starts[Math.max(i, j)]
  }
  return rows.map((row, i) => ({ row, first: !row.note && !same(i - 1, i), last: !row.note && !same(i, i + 1), ...(starts[i] ? { round: starts[i] } : {}) }))
}
