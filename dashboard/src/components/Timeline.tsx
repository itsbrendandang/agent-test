import { AlertTriangle, CheckCircle2, Info, Siren } from "lucide-react"
import type { EventKind, TimelineEvent } from "../sim/types"

const ICONS: Record<EventKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: Siren,
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const track = events.slice(0, 8).reverse()
  return (
    <article className="timeline card-surface" aria-label="Run timeline">
      <header>
        <h2>Run timeline</h2>
        <span className="muted small">{events.length} events</span>
      </header>
      <ol className="track" aria-hidden="true">
        {track.map((e) => {
          const Icon = ICONS[e.kind]
          return (
            <li key={e.id} data-kind={e.kind} title={e.label}>
              <Icon size={13} />
            </li>
          )
        })}
      </ol>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Event</th><th>Tick</th><th>Time</th><th>Details</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td><span className="dot" data-kind={e.kind} />{e.label}</td>
                <td><span className="chip">{e.tick}</span></td>
                <td className="muted">{e.time}</td>
                <td>{e.detail && <span className="pill" data-kind={e.kind}>{e.detail}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}
