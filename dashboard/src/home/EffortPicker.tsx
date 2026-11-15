// Effort: how much work a question gets. Three segments (radio buttons, so the arrow keys move between them), with
// the engine's description and what the level implies always visible under them.
import type { Effort, EffortId } from "./api"
import { effortFacts } from "./chat"

interface Props {
  efforts: Effort[]
  value: EffortId | undefined
  onChange: (id: EffortId) => void
  /** Radio group name; one per picker on the page. */
  name: string
  label?: string
  disabled?: boolean
  /** Segments only: the caller shows the description itself, under id `${name}-facts`. */
  compact?: boolean
}

export function EffortPicker({ efforts, value, onChange, name, label = "Effort", disabled, compact }: Props) {
  const current = efforts.find((e) => e.id === value)
  return (
    <fieldset className="effort" data-compact={compact || undefined} disabled={disabled}>
      <legend>{label}</legend>
      <div className="effort-segments">
        {efforts.map((e) => (
          <label key={e.id} data-on={e.id === value || undefined} title={`${e.description} ${effortFacts(e)}`}>
            <input type="radio" name={name} value={e.id} checked={e.id === value} onChange={() => onChange(e.id)} aria-describedby={`${name}-facts`} />
            <span>{e.label}</span>
          </label>
        ))}
      </div>
      {!compact && <p className="muted small effort-facts" id={`${name}-facts`}>{current ? <>{current.description} <span>{effortFacts(current)}.</span></> : "Pick how much work this question should get."}</p>}
    </fieldset>
  )
}
