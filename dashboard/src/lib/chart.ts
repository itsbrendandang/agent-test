import type { Metrics } from "@/sim/types"

export const CHART_COLORS = ["#ff5fa2", "#3f7cc4", "#2bb673", "#ff9a2e", "#ff4a4a"]

export function series(history: Metrics[], key: string) {
  return history.map((m, i) => ({ step: i, value: m[key] ?? 0 }))
}
