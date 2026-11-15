// Agent Lab design by Anh Lam. The map behind the teammates: a central corridor and six rooms, each with a name
// plate, an accent line, an open doorway, two desks with a screen, a bench and a plant. Drawn as Anh drew it, with
// the app's colours through CSS variables (lab.css). It holds no characters and nothing in it moves. The room names are text over the map (LabScene), so they stay readable when the map is small.
import { memo, useId } from "react"
import { MAP, ROOMS, SEARCH_SPOTS, roomOf } from "./model"

export const LabMap = memo(function LabMap() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "")
  const tiles = `lab-tiles-${uid}`, hall = `lab-hall-${uid}`, screen = `lab-screen-${uid}`
  return (
    <svg className="lab-map" viewBox={`0 0 ${MAP.width} ${MAP.height}`} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={tiles} width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill="var(--lab-floor)" /><path d="M26 0H0V26" fill="none" stroke="var(--lab-grid)" strokeWidth="1" />
        </pattern>
        <pattern id={hall} width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill="var(--lab-hall)" /><path d="M26 0H0V26" fill="none" stroke="var(--lab-hall-grid)" strokeWidth="1" />
        </pattern>
        <linearGradient id={screen} x2="0" y2="1"><stop stopColor="#e3ebfc" /><stop offset="1" stopColor="#a9bff0" /></linearGradient>
      </defs>
      <rect width={MAP.width} height={MAP.height} fill="var(--lab-ground)" />
      {/* A continuous, unobstructed central corridor. */}
      <rect x="440" y="20" width="120" height="700" rx="16" fill={`url(#${hall})`} stroke="var(--lab-wall)" strokeWidth="2" />
      <path d="M500 35V705" stroke="#7496e8" strokeOpacity=".28" strokeWidth="3" strokeDasharray="8 14" strokeLinecap="round" />
      {ROOMS.map((r) => {
        const doorX = r.x < MAP.corridorX ? r.x + 420 : r.x
        return (
          <g key={r.id} data-room={r.id}>
            <rect x={r.x} y={r.y} width="420" height="220" rx="16" fill={`url(#${tiles})`} stroke="var(--lab-wall)" strokeWidth="3" />
            <path d={`M${r.x + 65} ${r.y + 7}h290`} stroke={r.accent} strokeWidth="4" strokeLinecap="round" />
            <rect x={r.x + 20} y={r.y + 17} width="210" height="28" rx="8" fill="var(--lab-plate)" stroke="var(--lab-line)" />
            <circle cx={r.x + 34} cy={r.y + 31} r="4.5" fill={r.accent} />
            {/* An open doorway connects each room to the corridor. */}
            <rect x={doorX - 7} y={r.y + 110} width="14" height="70" fill="var(--lab-door)" />
            <path d={`M${doorX} ${r.y + 108}v-13M${doorX} ${r.y + 182}v13`} stroke="#cfc8b8" strokeWidth="5" strokeLinecap="round" />
            {[70, 260].map((offset, bench) => (
              <g key={offset}>
                <rect x={r.x + offset} y={r.y + 65} width="110" height="42" rx="8" fill="var(--lab-plate)" stroke="var(--lab-wall)" />
                <rect x={r.x + offset + 9} y={r.y + 69} width="43" height="27" rx="4" fill={`url(#${screen})`} />
                <path d={`M${r.x + offset + 15} ${r.y + 78}h26m-26 6h17m-17 6h22`} stroke="#ffffff" strokeWidth="2" opacity=".85" strokeLinecap="round" />
                <rect x={r.x + offset + 63} y={r.y + 78} width="10" height="17" rx="3" fill={r.accent} />
                <rect x={r.x + offset + 79} y={r.y + 74} width="10" height="21" rx="3" fill={bench ? "#c9b5e8" : "#d6d2c6"} />
              </g>
            ))}
            <rect x={r.x + 20} y={r.y + 185} width="380" height="13" rx="5" fill="var(--lab-bench)" />
            <circle cx={r.x + 390} cy={r.y + 60} r="12" fill="#9ccc8f" />
            <circle cx={r.x + 385} cy={r.y + 53} r="9" fill="#bfe0b3" />
          </g>
        )
      })}
      {/* Not in Anh's map: where real searches are picked up. A screen by the door for the web, a shelf for papers and databases. */}
      {(() => {
        const d = roomOf("discovery"), web = SEARCH_SPOTS.web, papers = SEARCH_SPOTS.papers
        return (
          <g data-spots="search">
            <rect x={d.x + web.dx - 15} y={d.y + web.dy - 62} width="30" height="22" rx="4" fill="var(--lab-plate)" stroke="var(--lab-wall)" />
            <rect x={d.x + web.dx - 11} y={d.y + web.dy - 58} width="22" height="14" rx="2" fill={`url(#${screen})`} />
            <circle cx={d.x + web.dx} cy={d.y + web.dy - 51} r="4.5" fill="none" stroke="#ffffff" strokeWidth="1.5" />
            <rect x={d.x + papers.dx - 16} y={d.y + papers.dy - 62} width="32" height="22" rx="4" fill="var(--lab-plate)" stroke="var(--lab-wall)" />
            {["#edb7cb", "#9ccc8f", "#7496e8", "#f2b35e"].map((c, i) => <rect key={c} x={d.x + papers.dx - 12 + i * 6.5} y={d.y + papers.dy - 58} width="5" height="14" rx="1.5" fill={c} />)}
          </g>
        )
      })()}
    </svg>
  )
})
