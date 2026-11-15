// Saved records as rows: grouping repeated runs of the same brief, and the compact date a row shows.
// Grouping is exact and from the records' own data. Two records are one group only when the caller gives them the
// same key (the same brief, question or task, made the same way). A similar name is never enough.

export interface Group<T> { key: string; latest: T; /** The older ones, newest first. Empty for a record that stands alone. */ history: T[] }

/**
 * Groups records that share a key. `keyOf` returns undefined for a record that must stand alone. Nothing is dropped:
 * every record is the latest of a group or in one history. Groups are ordered by their newest record, newest first.
 */
export function groupRecords<T>(records: readonly T[], keyOf: (record: T) => string | undefined, whenOf: (record: T) => number): Group<T>[] {
  const groups = new Map<string, T[]>()
  records.forEach((record, i) => {
    const key = keyOf(record)
    const slot = key === undefined ? `\u0000alone:${i}` : `key:${key}`
    groups.set(slot, [...(groups.get(slot) ?? []), record])
  })
  return [...groups.entries()]
    .map(([key, list]) => { const sorted = [...list].sort((a, b) => whenOf(b) - whenOf(a)); return { key, latest: sorted[0], history: sorted.slice(1) } })
    .sort((a, b) => whenOf(b.latest) - whenOf(a.latest))
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
/** Date and time, short and unambiguous: "14 Nov 21:02", with the year when it is not this year. */
export function stamp(at: number | string | undefined, now: Date = new Date()): string {
  const d = new Date(at ?? NaN)
  if (Number.isNaN(d.getTime())) return "time not recorded"
  const two = (n: number) => String(n).padStart(2, "0")
  return `${d.getDate()} ${MONTH[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`} ${two(d.getHours())}:${two(d.getMinutes())}`
}
/** For <time dateTime>. */
export const isoOf = (at: number | string | undefined): string | undefined => { const d = new Date(at ?? NaN); return Number.isNaN(d.getTime()) ? undefined : d.toISOString() }
