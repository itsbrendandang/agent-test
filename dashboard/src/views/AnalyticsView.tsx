import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { SeriesChart } from "@/components/MetricsChart"
import { CHART_COLORS } from "@/lib/chart"
import { fmtMetric } from "@/lib/format"
import type { EventKind, Metrics, Simulation, TimelineEvent } from "@/sim/types"

const KINDS: { kind: EventKind; label: string; color: string }[] = [
  { kind: "info", label: "Info", color: "#3f7cc4" },
  { kind: "success", label: "Success", color: "#2bb673" },
  { kind: "warning", label: "Warning", color: "#ff9a2e" },
  { kind: "danger", label: "Danger", color: "#ff4a4a" },
]

const eventConfig: ChartConfig = { count: { label: "Events", color: "#2b3cf5" } }

interface Props {
  sim: Simulation
  history: Metrics[]
  events: TimelineEvent[]
  tick: number
}

export function AnalyticsView({ sim, history, events, tick }: Props) {
  const latest = history[history.length - 1] ?? {}
  const first = history[0] ?? {}
  const keys = Object.keys(latest)
  const eventData = KINDS.map((k) => ({ ...k, count: events.filter((e) => e.kind === k.kind).length }))

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted small">Metrics and events of the simulation that is running, over time. {sim.name} · tick {tick.toLocaleString()} · last {history.length} samples</p>
        </div>
      </header>

      <section className="stat-row" aria-label="Key metrics">
        {keys.length === 0 && <p className="muted small">This simulation reports no metrics.</p>}
        {keys.map((k, i) => {
          const delta = latest[k] - (first[k] ?? 0)
          return (
            <article key={k} className="stat card-surface">
              <span className="stat-label">{k}</span>
              <strong>{fmtMetric(latest[k])}</strong>
              <span className={`pill ${delta >= 0 ? "pill-success" : "pill-warning"}`}>
                {delta >= 0 ? "+" : ""}{fmtMetric(delta)} in window
              </span>
              <SeriesChart history={history} metric={k} color={CHART_COLORS[i % CHART_COLORS.length]}
                className="aspect-auto h-12 w-full" />
            </article>
          )
        })}
      </section>

      <section className="chart-grid">
        {keys.map((k, i) => (
          <article key={k} className="chart-card card-surface">
            <h2>{k}</h2>
            <SeriesChart history={history} metric={k} color={CHART_COLORS[i % CHART_COLORS.length]} axes
              className="aspect-auto h-56 w-full" />
          </article>
        ))}
        <article className="chart-card card-surface">
          <h2>Events by type</h2>
          <ChartContainer config={eventConfig} className="aspect-auto h-56 w-full" role="img" aria-label="Events by type">
            <BarChart data={eventData} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="count" radius={6} isAnimationActive={false}>
                {eventData.map((d) => (
                  <Cell key={d.kind} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </article>
      </section>
    </div>
  )
}
