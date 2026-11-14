import { useState } from "react"
import { CrewSprite } from "@/crew/CrewSprite"
import { useCrew } from "@/crew/store"
import { UsageBars } from "@/system/UsageBars"
import { RunStats } from "./RunStats"

interface Props {
  simCount: number
  tick: number
  eventCount: number
  active: boolean
  onOpenSimulations: () => void
  onMeetCrew: () => void
  onOpenKeys: () => void
}

// Home: no cards or boxes. One line of type, a plain ledger, and the crew standing on a hairline.
export function OverviewView({ simCount, tick, eventCount, active, onOpenSimulations, onMeetCrew, onOpenKeys }: Props) {
  const { crew } = useCrew()
  const [today] = useState(() => new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))
  return (
    <div className="page home">
      <header className="home-top">
        <span>{today}</span>
        <UsageBars />
        <span className="home-state" data-active={active || undefined}>{active ? "Running" : "Idle"}</span>
      </header>

      <div className="home-mid">
      <section className="home-lead">
        <h1>Go enjoy<br />your day.</h1>
        <p>Your agents work behind the scenes. Check in whenever you like.</p>
        <nav className="home-links" aria-label="Start">
          <button type="button" onClick={onMeetCrew}>{crew.length ? "Crew" : "Agents"}</button>
          <button type="button" onClick={onOpenSimulations}>Simulations</button>
          <button type="button" onClick={onOpenKeys}>Connect API keys</button>
        </nav>
      </section>
      <RunStats />
      </div>

      <footer className="home-base">
        <dl className="home-ledger" aria-label="This session">
          <div><dt>Simulations</dt><dd>{simCount}</dd></div>
          <div><dt>Ticks</dt><dd>{tick.toLocaleString()}</dd></div>
          <div><dt>Events</dt><dd>{eventCount}</dd></div>
        </dl>
        {crew.length > 0 && <ul className="home-crew" aria-label="Crew">
          {crew.map((m) => (
            <li key={m.id}>
              <CrewSprite member={m} mood={active ? "working" : "sleeping"} size={56} />
              <span className="home-name">{m.name}</span>
              <span className="home-role">{m.role}</span>
            </li>
          ))}
        </ul>}
      </footer>
    </div>
  )
}
