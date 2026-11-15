// Agent Lab design by Anh Lam. The map behind the teammates: a corridor and six rooms, each with a name plate, an
// accent line, an open doorway, two desks with a screen, and one or two props that say what the room is for (after
// the lab equipment in Anh's preview: shelves and a screen in Discovery, a planning board, bench glassware and a
// fume hood, review monitors and a microscope, a control chart and a shield, a report easel). It holds no
// characters and nothing in it moves. Room names and desk name plates are text over the map (LabScene), so they
// stay readable when the map is small. Colours come from the app's tokens through lab.css.
import { memo, useId, type ReactNode } from "react"
import { ROOM, ROOMS, SEARCH_SPOTS, SPOT, WIDE, type LabLayout, type RoomId } from "./model"

const WALL = "var(--lab-wall)", PLATE = "var(--lab-plate)", INK = "var(--lab-prop)"

/** A prop in a 46 x 44 box whose top-left corner is (x, y). Flat shapes in the room's accent and the map's neutrals. */
function prop(kind: string, x: number, y: number, accent: string, screen: string): ReactNode {
  const frame = <rect x={x} y={y} width="46" height="44" rx="5" fill={PLATE} stroke={WALL} />
  switch (kind) {
    case "shelf": return <g>{frame}{[0, 1].map((row) => ["#edb7cb", "#9ccc8f", "#7496e8", "#f2b35e", "#c9b5e8"].map((c, i) => <rect key={`${row}${i}`} x={x + 6 + i * 7} y={y + 6 + row * 18} width="5" height="14" rx="1.5" fill={row ? ["#7496e8", "#f2b35e", "#edb7cb", "#9ccc8f", "#ef8262"][i] : c} />))}<path d={`M${x + 4} ${y + 22}h38M${x + 4} ${y + 40}h38`} stroke={WALL} strokeWidth="2" /></g>
    case "screen": return <g>{frame}<rect x={x + 5} y={y + 6} width="36" height="24" rx="3" fill={`url(#${screen})`} /><circle cx={x + 23} cy={y + 18} r="7" fill="none" stroke="#ffffff" strokeWidth="1.6" /><path d={`M${x + 16} ${y + 18}h14M${x + 23} ${y + 11}v14`} stroke="#ffffff" strokeWidth="1.2" /><rect x={x + 17} y={y + 33} width="12" height="5" rx="2" fill={INK} /></g>
    case "board": return <g>{frame}<rect x={x + 6} y={y + 8} width="10" height="7" rx="2" fill={accent} /><rect x={x + 30} y={y + 8} width="10" height="7" rx="2" fill="#9ccc8f" /><rect x={x + 18} y={y + 22} width="10" height="7" rx="2" fill="#f2b35e" /><rect x={x + 30} y={y + 32} width="10" height="7" rx="2" fill={accent} opacity=".6" /><path d={`M${x + 16} ${y + 11.5}h14M${x + 23} ${y + 15}v7M${x + 28} ${y + 26}l6 6`} stroke={INK} strokeWidth="1.4" fill="none" /></g>
    case "notes": return <g>{frame}{[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={x + 7 + c * 11} y={y + 6 + r * 11} width="9" height="9" rx="1.5" fill={["#f2b35e", accent, "#9ccc8f", "#edb7cb", "#f2b35e", accent, "#c9b5e8", "#9ccc8f", "#f2b35e"][r * 3 + c]} opacity=".85" />))}</g>
    case "flasks": return <g>{frame}{[["#7496e8", 0], [accent, 13], ["#9ccc8f", 26]].map(([c, dx]) => <g key={c as string}><path d={`M${x + 9 + (dx as number)} ${y + 10}h6v9l5 13q1 4 -3 4h-10q-4 0 -3 -4l5 -13z`} fill="#ffffff" stroke={INK} strokeWidth="1.2" /><path d={`M${x + 6 + (dx as number)} ${y + 28}h12l2 5q1 3 -2 3h-12q-3 0 -2 -3z`} fill={c as string} opacity=".8" /></g>)}</g>
    case "hood": return <g>{frame}<rect x={x + 5} y={y + 6} width="36" height="22" rx="3" fill="#eef3fb" stroke={WALL} /><path d={`M${x + 5} ${y + 14}h36`} stroke={WALL} strokeWidth="1.5" /><path d={`M${x + 23} ${y + 30}l8 11h-16z`} fill="#f2c94c" stroke={INK} strokeWidth="1" /><path d={`M${x + 23} ${y + 34}v3`} stroke={INK} strokeWidth="1.6" strokeLinecap="round" /></g>
    case "monitors": return <g>{frame}<rect x={x + 4} y={y + 8} width="18" height="14" rx="2" fill={`url(#${screen})`} /><rect x={x + 24} y={y + 8} width="18" height="14" rx="2" fill={`url(#${screen})`} /><path d={`M${x + 7} ${y + 13}h10m-10 4h7M${x + 27} ${y + 13}h10m-10 4h7`} stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" /><circle cx={x + 19} cy={y + 32} r="6" fill="none" stroke={accent} strokeWidth="2.4" /><path d={`M${x + 23.5} ${y + 36.5}l6 5`} stroke={accent} strokeWidth="2.6" strokeLinecap="round" /></g>
    case "microscope": return <g>{frame}<rect x={x + 12} y={y + 36} width="24" height="4" rx="2" fill={INK} /><path d={`M${x + 20} ${y + 36}v-8M${x + 20} ${y + 28}q10 0 10 -10`} stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" /><rect x={x + 22} y={y + 6} width="7" height="16" rx="2" transform={`rotate(25 ${x + 25} ${y + 14})`} fill={accent} /><rect x={x + 15} y={y + 25} width="12" height="3" rx="1.5" fill={INK} /></g>
    case "chart": return <g>{frame}<path d={`M${x + 6} ${y + 14}h34M${x + 6} ${y + 32}h34`} stroke="#ef8262" strokeWidth="1" strokeDasharray="3 3" /><path d={`M${x + 6} ${y + 23}h34`} stroke={WALL} strokeWidth="1" /><path d={`M${x + 7} ${y + 24}l6 -5l6 7l6 -8l6 5l6 -3`} stroke={accent} strokeWidth="2.2" fill="none" strokeLinejoin="round" strokeLinecap="round" />{[[7, 24], [13, 19], [19, 26], [25, 18], [31, 23], [37, 20]].map(([dx, dy]) => <circle key={dx} cx={x + dx} cy={y + dy} r="1.8" fill={INK} />)}</g>
    case "shield": return <g>{frame}<path d={`M${x + 23} ${y + 6}l13 5v10q0 11 -13 17q-13 -6 -13 -17v-10z`} fill={accent} opacity=".85" /><path d={`M${x + 16.5} ${y + 22}l5 5l8.5 -10`} stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
    case "bars": return <g>{frame}{[[0, 14], [8, 22], [16, 10], [24, 26], [32, 18]].map(([dx, h], i) => <rect key={dx} x={x + 6 + dx} y={y + 38 - h} width="6" height={h} rx="1.5" fill={i % 2 ? accent : "#7496e8"} opacity=".85" />)}<path d={`M${x + 4} ${y + 39}h38`} stroke={INK} strokeWidth="1.2" /></g>
    case "easel": return <g>{frame}<path d={`M${x + 12} ${y + 42}l5 -10M${x + 34} ${y + 42}l-5 -10`} stroke="#c8a582" strokeWidth="2.4" strokeLinecap="round" /><rect x={x + 9} y={y + 5} width="28" height="28" rx="3" fill="#ffffff" stroke="#c8a582" strokeWidth="2" />{[0, 1, 2].map((i) => <g key={i}><path d={`M${x + 13} ${y + 12 + i * 7}l2 2l3.5 -4`} stroke="#17824d" strokeWidth="1.6" fill="none" strokeLinecap="round" /><path d={`M${x + 21} ${y + 12.5 + i * 7}h12`} stroke={WALL} strokeWidth="2" strokeLinecap="round" /></g>)}</g>
    default: return null
  }
}
/** Each room's props: [between the desks, by the wall away from the door]. Discovery's two are its search points. */
const PROPS: Record<RoomId, [string, string]> = {
  discovery: ["", "shelf"], planning: ["board", "notes"], bench: ["flasks", "hood"], review: ["monitors", "microscope"], quality: ["chart", "shield"], report: ["bars", "easel"],
}

export const LabMap = memo(function LabMap({ layout = WIDE }: { layout?: LabLayout }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "")
  const hall = `lab-hall-${uid}`, screen = `lab-screen-${uid}`
  return (
    <svg className="lab-map" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false" data-layout={layout.id}>
      <defs>
        <pattern id={hall} width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill="var(--lab-hall)" /><path d="M26 0H0V26" fill="none" stroke="var(--lab-hall-grid)" strokeWidth="1" />
        </pattern>
        <linearGradient id={screen} x2="0" y2="1"><stop stopColor="#e3ebfc" /><stop offset="1" stopColor="#a9bff0" /></linearGradient>
      </defs>
      <rect width={layout.width} height={layout.height} fill="var(--lab-ground)" />
      {/* A continuous, unobstructed corridor: a light floor with a guide line. */}
      <rect x={layout.corridorX - 60} y="20" width="120" height={layout.height - 40} rx="16" fill={`url(#${hall})`} stroke="var(--lab-line)" strokeWidth="1.5" />
      <path d={`M${layout.corridorX} 38V${layout.height - 38}`} stroke="var(--lab-wall)" strokeWidth="2.5" strokeDasharray="6 14" strokeLinecap="round" />
      {ROOMS.map((room) => {
        const r = layout.at[room.id], doorRight = r.door === "right"
        const doorX = doorRight ? r.x + ROOM.width : r.x
        const wallX = doorRight ? r.x + 11 : r.x + ROOM.width - 57 // the prop by the wall away from the door
        const [middle, wall] = PROPS[room.id]
        return (
          <g key={room.id} data-room={room.id}>
            <rect x={r.x} y={r.y} width={ROOM.width} height={ROOM.height} rx="16" fill="var(--lab-floor)" stroke={WALL} strokeWidth="2.5" />
            {/* the room's colour: a wash over the floor, a line along the top wall, a rug under the desks' name plates */}
            <rect x={r.x + 1.5} y={r.y + 1.5} width={ROOM.width - 3} height={ROOM.height - 3} rx="15" fill={room.accent} opacity=".07" />
            <path d={`M${r.x + 40} ${r.y + 6}h${ROOM.width - 80}`} stroke={room.accent} strokeWidth="5" strokeLinecap="round" />
            <rect x={r.x + 12} y={r.y + SPOT.plate - 14} width={ROOM.width - 24} height="28" rx="10" fill={room.accent} opacity=".16" />
            <rect x={r.x + 16} y={r.y + 14} width="200" height="28" rx="8" fill={PLATE} stroke="var(--lab-line)" />
            <circle cx={r.x + 31} cy={r.y + 28} r="5" fill={room.accent} />
            {/* An open doorway connects each room to the corridor. */}
            <rect x={doorX - 6} y={r.y + 112} width="12" height="74" fill="var(--lab-hall)" />
            <path d={`M${doorX} ${r.y + 110}v-12M${doorX} ${r.y + 188}v12`} stroke="#cfc8b8" strokeWidth="5" strokeLinecap="round" />
            {SPOT.desk.map((dx, desk) => (
              <g key={dx}>
                <rect x={r.x + dx - 62} y={r.y + SPOT.deskTop} width="124" height={SPOT.deskHeight} rx="9" fill={PLATE} stroke={WALL} strokeWidth="1.5" />
                <rect x={r.x + dx - 52} y={r.y + SPOT.deskTop + 6} width="50" height="27" rx="4" fill={`url(#${screen})`} />
                <path d={`M${r.x + dx - 45} ${r.y + SPOT.deskTop + 15}h30m-30 6h19m-19 6h25`} stroke="#ffffff" strokeWidth="2" opacity=".9" strokeLinecap="round" />
                <rect x={r.x + dx + 10} y={r.y + SPOT.deskTop + 14} width="11" height="19" rx="3" fill={room.accent} />
                <rect x={r.x + dx + 27} y={r.y + SPOT.deskTop + 9} width="11" height="24" rx="3" fill={desk ? "#c9b5e8" : "#d6d2c6"} />
                <rect x={r.x + dx + 44} y={r.y + SPOT.deskTop + 19} width="9" height="14" rx="3" fill={room.accent} opacity=".55" />
              </g>
            ))}
            {middle && prop(middle, r.x + 197, r.y + SPOT.deskTop - 2, room.accent, screen)}
            {room.id === "discovery"
              ? <>
                {prop("shelf", r.x + (doorRight ? SEARCH_SPOTS.papers.dx : ROOM.width - SEARCH_SPOTS.papers.dx) - 23, r.y + 96, room.accent, screen)}
                <g transform={`translate(${r.x + (doorRight ? 381 : 3)} ${r.y + 60}) scale(.78)`}>{prop("screen", 0, 0, room.accent, screen)}</g>
              </>
              : prop(wall, wallX, r.y + 100, room.accent, screen)}
          </g>
        )
      })}
    </svg>
  )
})
