// The one compact row for a saved run, a saved answer or a source, and the list that holds such rows. Every list
// of records in the app uses it, so a record looks the same wherever it is met: a title that wraps to two lines
// (the whole title is in its tooltip), its type, date and time, its own provenance badge, a status or a one-line
// result when the record has one, and one clear action: Open. A list shows a few rows, then "View all N". Runs of
// the same brief can be given as one row with its history folded under it.
import { useState, type ReactNode } from "react"
import { Provenance } from "@/components/Provenance"
import { StatusPill } from "@/components/Shared"
import type { ProvenanceKind } from "@/lib/provenance"
import { isoOf, stamp } from "@/lib/records"
import type { RunState } from "@/lib/status"

export interface RecordItem {
  /** Unique in its list. */
  key: string
  /** The question, the brief or the source's title. Untrusted text: shown as text. */
  title: string
  /** What kind of thing it is, in plain words: "Answer", "Team review", "PubMed", "ClinicalTrials.gov record". */
  type: string
  /** When it was made (ms or ISO). Shown as date and time. */
  when?: number | string
  /** How it was made, from the record's own data (lib/provenance.ts). Never from the engine's mode now. */
  provenance?: ProvenanceKind
  /** Shown as a pill unless the record is simply done. */
  status?: RunState
  /** One line of result, only when the record has it: a decision, a score, counts of marks. */
  result?: ReactNode
  /** A source's own identifier: "PMID 37952131", "DOI 10.1056/…", "NCT01234567". */
  identifier?: string
  /** Its number in a numbered source list. */
  n?: number
  /** Small labels after the badge, such as "Demo task" or "Preprint". */
  extra?: ReactNode
  /** Lines under the row, such as where a keyword was found. */
  detail?: ReactNode
  /** Opens it inside the app. */
  onOpen?: () => void
  /** Or: an outside address (http or https only; the caller checks). Opens in a new tab. */
  href?: string
  /** The word on the action. Default "Open". */
  openLabel?: string
  /** Older runs of the same brief, newest first. The row then reads "N runs, latest <date>". */
  history?: RecordItem[]
}

/** `emphasis` marks parts of a title (keyword matches). Default: plain text. */
type Emphasis = (text: string) => ReactNode

export function RecordRow({ item, emphasis = (t) => t, nested }: { item: RecordItem; emphasis?: Emphasis; nested?: boolean }) {
  const runs = (item.history?.length ?? 0) + 1
  const open = item.openLabel ?? "Open"
  return (
    <li className="record" data-nested={nested || undefined} data-record={item.key}>
      <div className="record-main">
        <p className="record-title" title={item.title}>
          {item.n !== undefined && <span className="record-n" aria-label={`Source ${item.n}`}>{item.n}</span>}
          <span className="record-titletext">{emphasis(item.title)}</span>
        </p>
        <p className="record-meta">
          <span className="record-type">{item.type}</span>
          {item.when !== undefined && <time className="mono" dateTime={isoOf(item.when)}>{stamp(item.when)}</time>}
          {item.identifier && <span className="mono record-id">{item.identifier}</span>}
          <Provenance kind={item.provenance} compact />
          {item.extra}
          {item.status && item.status !== "done" && <StatusPill state={item.status} />}
        </p>
        {item.result && <p className="record-result">{item.result}</p>}
        {item.detail}
        {item.history && item.history.length > 0 && (
          <details className="record-history">
            <summary><span className="mono">{runs}</span> runs, latest <span className="mono">{stamp(item.when)}</span></summary>
            <RecordList items={item.history} label={`Earlier runs of: ${item.title}`} emphasis={emphasis} noun="earlier run" nested />
          </details>
        )}
      </div>
      {item.href
        ? <a className="btn record-open" href={item.href} target="_blank" rel="noreferrer noopener" aria-label={`${open}: ${item.title} (opens in a new tab)`}>{open}</a>
        : item.onOpen && <button type="button" className="btn record-open" onClick={item.onOpen} aria-label={`${open}: ${item.title}`}>{open}</button>}
    </li>
  )
}

/**
 * A list of rows. It shows `initial` rows (three unless told otherwise), then one button "View all N"; "Show fewer"
 * folds it again. `order` says how the rows are ordered when that matters ("newest first"): no ranking is implied.
 */
export function RecordList({ items, label, initial = 3, noun = "result", emphasis, nested, order }: {
  items: RecordItem[]; label: string; initial?: number; noun?: string; emphasis?: Emphasis; nested?: boolean; order?: string
}) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, initial)
  return (
    <div className="record-list" data-nested={nested || undefined}>
      {order && items.length > 1 && <p className="record-order">{order}</p>}
      <ul className="records" aria-label={label}>
        {shown.map((item) => <RecordRow key={item.key} item={item} emphasis={emphasis} nested={nested} />)}
      </ul>
      {items.length > initial && (
        <button type="button" className="link-btn record-all" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `View all ${items.length}${noun ? ` ${noun}s` : ""}`}
        </button>
      )}
    </div>
  )
}
