import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { fmtMetric } from "@/lib/format"
import type { Metrics } from "@/sim/types"

import { CHART_COLORS, series } from "@/lib/chart"

interface SeriesChartProps {
  history: Metrics[]
  metric: string
  color: string
  className?: string
  axes?: boolean
}

export function SeriesChart({ history, metric, color, className, axes = false }: SeriesChartProps) {
  const config: ChartConfig = { value: { label: metric, color } }
  const id = metric.replace(/[^a-z0-9]/gi, "")
  return (
    <ChartContainer config={config} className={className} role="img" aria-label={`${metric} over time`}>
      <AreaChart data={series(history, metric)} margin={{ top: 6, right: 4, bottom: 0, left: axes ? 0 : 4 }}>
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {axes && <CartesianGrid vertical={false} />}
        {axes && <XAxis dataKey="step" tickLine={false} axisLine={false} minTickGap={40} />}
        {axes && <YAxis tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} />}
        {!axes && <YAxis hide domain={["auto", "auto"]} />}
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Area dataKey="value" type="monotone" stroke={color} strokeWidth={2} fill={`url(#fill-${id})`}
          isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  )
}

export function MetricsChart({ history }: { history: Metrics[] }) {
  const latest = history[history.length - 1]
  const keys = latest ? Object.keys(latest) : []
  return (
    <div className="metrics">
      {keys.length === 0 && <p className="muted small">This simulation reports no metrics.</p>}
      {keys.map((k, i) => (
        <figure key={k} className="metric">
          <figcaption>
            <span>{k}</span>
            <strong style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>{fmtMetric(latest[k])}</strong>
          </figcaption>
          <SeriesChart history={history} metric={k} color={CHART_COLORS[i % CHART_COLORS.length]}
            className="aspect-auto h-16 w-full" />
        </figure>
      ))}
    </div>
  )
}
