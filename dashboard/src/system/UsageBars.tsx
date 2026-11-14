import { useEffect, useState } from "react"
import { call, isDesktop } from "./desktop"

interface Usage { cpu: number; gpu: number | null }

// Live CPU and GPU load of this machine, read by the desktop app every two seconds.
export function UsageBars() {
  const [usage, setUsage] = useState<Usage | null>(null)
  useEffect(() => {
    if (!isDesktop) return
    let alive = true
    const read = () => {
      if (document.hidden) return
      call<Usage>("system_usage").then((u) => { if (alive) setUsage(u) }).catch(() => {})
    }
    read()
    const t = setInterval(read, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return (
    <div className="usage" title={isDesktop ? undefined : "Available in the desktop app"}>
      <Bar label="CPU" value={usage?.cpu} />
      <Bar label="GPU" value={usage?.gpu ?? undefined} />
    </div>
  )
}

function Bar({ label, value }: { label: string; value: number | undefined }) {
  const v = value === undefined ? undefined : Math.round(Math.min(100, Math.max(0, value)))
  return (
    <span className="usage-item">
      <span id={`usage-${label}`}>{label}</span>
      <span className="usage-bar" role="meter" aria-labelledby={`usage-${label}`} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={v} aria-valuetext={v === undefined ? "Not available" : `${v}%`} data-high={(v ?? 0) >= 85 || undefined}>
        <span style={{ width: `${v ?? 0}%` }} />
      </span>
      <span className="usage-value">{v === undefined ? "—" : `${v}%`}</span>
    </span>
  )
}
