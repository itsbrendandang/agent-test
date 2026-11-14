export const fmtMetric = (v: number | undefined) =>
  v === undefined ? "—" : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)
