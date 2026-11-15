// What real runs have cost today, against the limits the engine enforces. Read from GET /api/paid, which is the
// engine's own count: this page adds nothing up. It shows our limits and our spend, not the balance of an account
// at Anthropic, OpenAI or Exa: no provider tells the engine that, so it is not shown.
import { useEffect, useState } from "react"
import { readEngine } from "@/lib/engine"
import "@/design/overview.css"

type Rec = Record<string, unknown>
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const usd = (v: number | undefined) => (v === undefined ? "Not known" : `$${v.toFixed(2)}`)

export function Credits() {
  const [paid, setPaid] = useState<Rec | null>()
  useEffect(() => {
    let stopped = false
    readEngine<Rec>("/api/paid").then((reply) => { if (!stopped) setPaid(reply && typeof reply === "object" ? reply : null) }, () => { if (!stopped) setPaid(null) })
    return () => { stopped = true }
  }, [])
  if (paid === undefined) return null
  const caps = (paid?.caps && typeof paid.caps === "object" ? paid.caps : {}) as Rec
  const real = paid?.paid === true
  const spent = num(caps.spentTodayUsd), daily = num(caps.dailyUsd), run = num(caps.maxUsd), exaUsed = num(caps.exaUsedUsd), exaTop = num(caps.exaCeilingUsd)
  const share = (part: number | undefined, whole: number | undefined) => (part === undefined || !whole ? 0 : Math.min(100, (part / whole) * 100))
  return (
    <section aria-labelledby="ov-credits" className="ov-credits">
      <div className="ov-row-label" id="ov-credits">API credits <small>{paid === null ? "The engine did not say." : real ? "Real mode: runs spend money, inside these limits." : "Demo mode: nothing can be spent."}</small></div>
      {paid !== null && (
        <div className="ov-tiles">
          <div className="ov-tile"><b>{usd(spent)}</b><span>Spent today</span><small>of a {usd(daily)} daily limit</small><div className="ov-track" aria-hidden="true"><i data-made="research" style={{ width: `${share(spent, daily)}%` }} /></div></div>
          <div className="ov-tile"><b>{usd(run)}</b><span>Limit per run</span><small>A run stops when it reaches it.</small></div>
          <div className="ov-tile"><b>{usd(exaUsed)}</b><span>Web search (Exa)</span><small>of a {usd(exaTop)} ceiling, all time</small><div className="ov-track" aria-hidden="true"><i data-made="research" style={{ width: `${share(exaUsed, exaTop)}%` }} /></div></div>
          <div className="ov-tile"><b>Not known</b><span>Account balances</span><small>Providers do not report them to the app. Check each provider's own page.</small></div>
        </div>
      )}
    </section>
  )
}
