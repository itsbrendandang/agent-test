export const fmtMetric = (v: number | undefined) =>
  v === undefined ? "—" : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)

// One way to write each kind of number, used by every view.
/** A grader score: three decimals. */
export const fmtScore = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "–" : x.toFixed(3))
/** A token count: whole number with thousands separators. */
export const fmtTokens = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? "–" : Math.round(n).toLocaleString("en-US"))
/** A duration as m:ss, or h:mm:ss from one hour up. */
export function fmtDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms) || ms < 0) return "–"
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}
