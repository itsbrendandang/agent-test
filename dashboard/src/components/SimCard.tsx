import { Button } from "@ui-sdk/react/button"
import { categoryLabels } from "../sim/registry"
import type { Simulation } from "../sim/types"

interface Props {
  sim: Simulation
  index: number
  active: boolean
  running: boolean
  value?: number
  onLaunch: (id: string) => void
}

export function SimCard({ sim, index, active, running, value, onLaunch }: Props) {
  const shown = value === undefined ? "—" : Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)
  return (
    <article className="sim-card" data-active={active || undefined} aria-current={active || undefined}>
      <div className="sim-card-body">
        <div className="sim-card-top">
          <div className="sim-card-name">
            <h4>{sim.name.toUpperCase()}</h4>
            <p className="muted small">SIM-{String(index + 1).padStart(4, "0")}</p>
          </div>
          <span className={`pill pill-${sim.category}`}>{categoryLabels[sim.category]}</span>
        </div>
        <div className="sim-card-tags">
          {(sim.tags ?? []).map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
        </div>
        <dl className="sim-card-stats">
          <div><dt>Params</dt><dd>{sim.params.length}</dd></div>
          <div><dt>Restart on</dt><dd>{sim.resetOn?.length ?? 0}</dd></div>
          <div><dt>Headline</dt><dd>{sim.headline ?? "—"}</dd></div>
        </dl>
      </div>
      <footer className="sim-card-foot">
        <p className="value">
          {shown}
          <span>{sim.headline}</span>
        </p>
        <Button onClick={() => onLaunch(sim.id)} disabled={active && running} aria-label={`Launch ${sim.name}`}>
          {active ? (running ? "Running" : "Resume") : "Launch"}
        </Button>
      </footer>
    </article>
  )
}
