// Agent Lab design by Anh Lam. The map of Agent Lab 2.0 (https://github.com/Anhlam09/agent-lab-2.0), redrawn here
// as SVG from Anh's canvas drawings in src/lab/office.ts: the corridor and six room cards, each with a back wall
// (pipes, a valve, wall items), a lab counter with equipment on it, and furniture on a tiled floor, in 2.0's flat,
// outline-free style and palette. It holds no characters.
//
// What is NOT brought over from 2.0: its clock. In 2.0 screens scroll, flasks bubble and plants sway all the time.
// Here the map is still, and a room's equipment comes alive only while the activity model says a teammate of that
// room is working or fetching (`active`), through CSS that reduced motion and "Pause motion" switch off.
import { memo, type ReactNode } from "react"
import { COUNTER_ITEMS, FURNITURE, ROOM, ROOMS, WALL_ITEMS, WIDE, type CounterType, type FurnType, type LabLayout, type RoomId, type WallType } from "./model"

// 2.0's palette (its P table): the app's cream and the Buddy colours.
const P = {
  surface: "#fffdf6", line: "#ebe6d9", edge: "#e2dccb", ink: "#1b1a17", brand: "#ffd23f", wall: "#f6ecd4", wallSeam: "#efe2c6", corridor: "#efe9dc",
  wood: "#ecdcbd", woodFront: "#dfc79f", metal: "#efebe2", metalFront: "#ddd7c9", dark: "#55504a", screen: "#dce9fb",
  blue: "#6b9bf2", pink: "#f6b6cd", flame: "#ff7a59", yellow: "#ffcf4a", green: "#5cc48d", tan: "#c9a27a", grey: "#c4bdad",
}
const GLASS = "rgba(107,155,242,.16)"
const LAB_COLORS = [P.blue, P.green, P.pink, P.yellow, P.flame]
const BOOKS = [P.pink, P.flame, P.yellow, P.blue, P.green, P.tan, "#ffc46b"]
/** 2.0's fixed "random": the same number for the same seed, so the drawing never changes between renders. */
const srand = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

const shadow = (x: number, y: number, w: number) => <ellipse cx={x + 1} cy={y + 1} rx={w / 2 + 2} ry="4.5" fill="rgba(27,26,23,.07)" />
/** A flat block of furniture: a front face and a lighter top, no outline. */
const box = (x: number, y: number, w: number, h: number, d: number, top: string, front: string) => (
  <>{shadow(x, y, w)}<rect x={x - w / 2} y={y - h - d} width={w} height={h + d} rx="4" fill={front} /><rect x={x - w / 2} y={y - h - d} width={w} height={d} rx="4" fill={top} /></>
)
function monitor(x: number, y: number, w: number, h: number, seed: number): ReactNode {
  const sx = x - w / 2, sy = y - 7 - h
  return (
    <g>
      <rect x={x - 2} y={y - 7} width="4" height="7" rx="1" fill={P.dark} /><rect x={x - 8} y={y - 2} width="16" height="3" rx="1.5" fill={P.dark} />
      <rect x={sx - 2.5} y={sy - 2.5} width={w + 5} height={h + 5} rx="4" fill={P.dark} /><rect x={sx} y={sy} width={w} height={h} rx="2" fill={P.screen} />
      {[0, 1, 2].map((i) => <rect key={i} className="lab-fx-line" x={sx + 4} y={sy + 3 + i * 5.5} width={(w - 8) * (0.3 + 0.6 * srand(seed + i * 9))} height="2" rx="1" fill={P.blue} style={{ animationDelay: `${i * 0.3}s` }} />)}
    </g>
  )
}
function flask(x: number, y: number, col: string, s = 1): ReactNode {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-3 -17 L-3 -10 L-9.5 -1 Q-10 0 -9 0 L9 0 Q10 0 9.5 -1 L3 -10 L3 -17 Z" fill="rgba(107,155,242,.14)" />
      <path d="M-5.5 -6.5 L5.5 -6.5 L9.5 -1 Q10 0 9 0 L-9 0 Q-10 0 -9.5 -1 Z" fill={col} />
      {[0, 1, 2].map((i) => <circle key={i} className="lab-fx-bubble" cx={(i - 1) * 1.6} cy="-6" r={1.3 + i * 0.25} fill={col} style={{ animationDelay: `${i * 0.37}s` }} />)}
    </g>
  )
}
function plant(x: number, y: number): ReactNode {
  return (
    <g>
      {shadow(x, y, 22)}
      <g transform={`translate(${x} ${y - 14})`}>{[-0.9, -0.45, 0, 0.45, 0.9, -0.2, 0.25].map((an, i) => <ellipse key={i} cx="0" cy={-12 - (i % 2) * 3} rx="4.8" ry="12" fill={i % 2 ? "#7fd3a5" : P.green} transform={`rotate(${(an * 180) / Math.PI})`} />)}</g>
      <path d={`M${x - 10} ${y - 16}L${x + 10} ${y - 16}L${x + 7.5} ${y}L${x - 7.5} ${y}Z`} fill={P.pink} /><rect x={x - 11} y={y - 18} width="22" height="4" rx="2" fill="#f29bbb" />
    </g>
  )
}

/** One piece of furniture: `x` its middle, `y` its front edge on the floor, `w` its width (2.0's FURNITURE table). */
function furniture(type: FurnType, x: number, y: number, w: number, seed: number): ReactNode {
  switch (type) {
    case "cabinet": return <g>{box(x, y, w, 38, 12, P.metal, P.metalFront)}<rect x={x - 7} y={y - 30} width="14" height="3" rx="1.5" fill={P.grey} /><rect x={x - 7} y={y - 13} width="14" height="3" rx="1.5" fill={P.grey} />{monitor(x, y - 46, 30, 20, seed)}</g>
    case "shelf": return (
      <g>
        {box(x, y, w, 50, 8, P.wood, P.woodFront)}
        {[0, 1].map((row) => {
          const by = y - 5 - row * 23, books: ReactNode[] = []
          for (let bx = x - w / 2 + 6, k = 0; bx < x + w / 2 - 12; k++) {
            const bw = 5 + Math.floor(srand(seed + row * 31 + k) * 4), bh = 12 + Math.floor(srand(seed + row * 17 + k * 3) * 5)
            books.push(<rect key={k} x={bx} y={by - bh} width={bw} height={bh} rx="1.5" fill={BOOKS[Math.floor(srand(seed + k * 7 + row) * 7)]} />)
            bx += bw + 1.5
          }
          return <g key={row}><rect x={x - w / 2 + 4} y={by - 19} width={w - 8} height="19" rx="2" fill="#f3e6cb" />{books}</g>
        })}
      </g>
    )
    case "labtable": { const top = y - 28; return (
      <g>
        {box(x, y, w, 22, 18, P.metal, P.metalFront)}
        {flask(x - w / 2 + 18, top, P.blue)}{flask(x + 6, top, P.green, 0.85)}
        <rect x={x - 21} y={top - 2} width="20" height="4" rx="2" fill={P.grey} />
        {[P.flame, P.blue, P.pink].map((c, i) => <g key={c}><rect x={x - 19 + i * 6} y={top - 16} width="4" height="15" rx="2" fill="rgba(107,155,242,.14)" /><rect x={x - 19 + i * 6} y={top - 7 - i} width="4" height={6 + i} rx="2" fill={c} /></g>)}
        {flask(x + w / 2 - 16, top, P.yellow, 0.7)}
      </g>
    ) }
    case "desk": return <g>{box(x, y, w, 22, 16, P.wood, P.woodFront)}{monitor(x - 8, y - 30, 32, 20, seed)}<rect x={x - 24} y={y - 33} width="22" height="5" rx="2" fill={P.grey} /><rect x={x + 17} y={y - 36} width="11" height="8" rx="2" fill={P.surface} /></g>
    case "desk2": return <g>{box(x, y, w, 22, 18, P.wood, P.woodFront)}{monitor(x - 20, y - 32, 30, 20, seed)}{monitor(x + 18, y - 32, 30, 20, seed + 4)}<rect x={x - 14} y={y - 34} width="26" height="5" rx="2" fill={P.grey} /></g>
    case "maptable": { const mx = x - w / 2 + 12, my = y - 22 - 21; return (
      <g>
        {box(x, y, w, 22, 24, P.wood, P.woodFront)}<rect x={mx} y={my} width={w - 24} height="18" rx="2" fill={P.surface} />
        <path d={`M${mx + 6} ${my + 12}C${mx + 30} ${my + 2} ${mx + 50} ${my + 16} ${mx + 86} ${my + 5}`} stroke={P.tan} strokeWidth="1.5" strokeDasharray="4 3" fill="none" />
        <circle className="lab-fx-bob" cx={mx + 86} cy={my + 5} r="3" fill={P.flame} /><circle cx={mx + 30} cy={my + 8} r="2.2" fill={P.blue} />
      </g>
    ) }
    case "clipdesk": { const top = y - 28; return (
      <g>
        {box(x, y, w, 22, 18, P.wood, P.woodFront)}
        <rect x="-12" y="-5" width="24" height="10" rx="1.5" fill={P.surface} transform={`translate(${x - 10} ${top - 3}) rotate(-5.7)`} />
        <rect x="-10" y="-5" width="20" height="9" rx="1.5" fill="#f6f1e4" transform={`translate(${x + 6} ${top - 2}) rotate(8.6)`} />
        <rect x={x + 28} y={top - 12} width="10" height="12" rx="3" fill={P.blue} /><rect x={x + 30} y={top - 18} width="2.5" height="7" rx="1" fill={P.yellow} /><rect x={x + 34} y={top - 16} width="2.5" height="5" rx="1" fill={P.flame} />
      </g>
    ) }
    case "shielddesk": return (
      <g>
        {shadow(x, y, w)}<rect x={x - w / 2} y={y - 20} width={w} height="14" fill={P.metalFront} /><ellipse cx={x} cy={y - 6} rx={w / 2} ry="8" fill={P.metalFront} /><ellipse cx={x} cy={y - 20} rx={w / 2} ry="9" fill={P.metal} />
        <g transform={`translate(${x + 2} ${y - 52})`}><g className="lab-fx-bob"><path d="M0 -16 L13 -11 L12 3 Q8 12 0 16 Q-8 12 -12 3 L-13 -11 Z" fill={P.blue} opacity=".85" /><path d="M-5 0 L-1 4 L6 -5" stroke={P.surface} strokeWidth="2.4" strokeLinecap="round" fill="none" /></g></g>
      </g>
    )
    case "microscope": { const by = y - 28; return (
      <g>
        {box(x, y, w, 22, 16, P.metal, P.metalFront)}<rect x={x - 10} y={by - 3} width="20" height="5" rx="2" fill={P.dark} />
        <path d={`M${x + 6} ${by - 2}Q${x + 12} ${by - 18} ${x + 2} ${by - 26}`} stroke={P.dark} strokeWidth="4.5" strokeLinecap="round" fill="none" />
        <path d={`M${x + 1} ${by - 25}L${x - 6} ${by - 12}`} stroke={P.dark} strokeWidth="5.5" strokeLinecap="round" />
        <rect className="lab-fx-glow" x={x - 9} y={by - 7} width="9" height="3" rx="1.5" fill={P.green} opacity=".6" />
      </g>
    ) }
    case "rack": return (
      <g>
        {box(x, y, w, 62, 10, P.metal, P.metalFront)}
        {[0, 1, 2, 3, 4, 5].map((i) => <g key={i}><rect x={x - w / 2 + 4} y={y - 57 + i * 9} width={w - 8} height="6" rx="2" fill="#cfc8b8" />{[0, 1, 2].map((j) => <circle key={j} className={srand(i * 7 + j) > 0.4 ? "lab-fx-led" : undefined} cx={x + w / 2 - 8 - j * 5} cy={y - 54 + i * 9} r="1.6" fill={srand(i * 7 + j) > 0.4 ? (j === 2 ? P.yellow : P.green) : "#b8b0a0"} />)}</g>)}
      </g>
    )
    case "printer": return <g>{box(x, y, w, 24, 18, P.metal, P.metalFront)}<rect x={x - 15} y={y - 14} width="30" height="3" rx="1.5" fill={P.grey} /><rect className="lab-fx-paper" x={x - 12} y={y - 12} width="24" height="6" rx="1" fill={P.surface} /><circle cx={x + w / 2 - 8} cy={y - 36} r="2" fill={P.green} /></g>
    case "easel": return (
      <g>
        <path d={`M${x - 13} ${y}L${x - 4} ${y - 46}M${x + 13} ${y}L${x + 4} ${y - 46}`} stroke={P.tan} strokeWidth="3" strokeLinecap="round" />
        <rect x={x - 17} y={y - 66} width="34" height="40" rx="5" fill={P.tan} /><rect x={x - 13} y={y - 61} width="26" height="31" rx="3" fill={P.surface} />
        {[0, 1, 2].map((i) => { const yy = y - 54 + i * 9; return <g key={i}><path d={`M${x - 10} ${yy}L${x - 8} ${yy + 2}L${x - 4} ${yy - 3}`} stroke={P.green} strokeWidth="2" strokeLinecap="round" fill="none" /><rect x={x - 1} y={yy - 1} width="11" height="2.4" rx="1.2" fill={P.edge} /></g> })}
      </g>
    )
    case "plant": return plant(x, y)
  }
}

/** Something on the back wall. `x` is its middle; the wall starts 12 below the room's top. */
function wallItem(type: WallType, x: number): ReactNode {
  const y = 12
  switch (type) {
    case "whiteboard": { const nodes = [[-72, 6], [-42, 6], [-12, 6], [-42, 22], [18, 22], [48, 6], [48, 22]]; return (
      <g>
        <rect x={x - 90} y={y} width="180" height="38" rx="6" fill={P.surface} />
        <path d={[[0, 1], [1, 2], [1, 3], [3, 4], [2, 5], [4, 6], [5, 6]].map(([a, b]) => `M${x + nodes[a][0] + 10} ${y + nodes[a][1] + 4}L${x + nodes[b][0] + 10} ${y + nodes[b][1] + 4}`).join("")} stroke={P.edge} strokeWidth="1.5" fill="none" />
        {nodes.map(([nx, ny], i) => <rect key={i} x={x + nx} y={y + ny} width="20" height="8" rx="3" fill={i === 0 ? P.yellow : i % 2 ? P.blue : P.green} />)}
      </g>
    ) }
    case "notes": return <g>{[P.yellow, P.pink, "#a7e2c3", "#bcd3fa", P.yellow, "#ffc46b"].map((c, i) => <rect key={i} x="-5.5" y="-5.5" width="11" height="11" rx="1.5" fill={c} transform={`translate(${x - 16 + (i % 3) * 14} ${y + 9 + Math.floor(i / 3) * 15}) rotate(${(srand(i + x) - 0.5) * 17})`} />)}</g>
    case "wallscreen": case "chartscreen": { const w = type === "chartscreen" ? 132 : 64, h = 36, n = type === "chartscreen" ? 10 : 6; return (
      <g>
        <rect x={x - w / 2} y={y} width={w} height={h} rx="6" fill={P.surface} />
        {Array.from({ length: n }, (_, i) => { const bh = 5 + (Math.sin(i * 0.9 + x) * 0.5 + 0.5) * 18; return <rect key={i} className="lab-fx-bar" x={x - w / 2 + 7 + i * ((w - 14) / n)} y={y + h - 5 - bh} width={(w - 14) / n - 3} height={bh} rx="2" fill={i === n - 1 ? P.flame : P.blue} style={{ animationDelay: `${i * 0.15}s`, transformOrigin: `0 ${y + h - 5}px` }} /> })}
        {type === "chartscreen" && <path d={Array.from({ length: 13 }, (_, i) => `${i ? "L" : "M"}${x - w / 2 + 7 + i * ((w - 14) / 12)} ${y + 13 + Math.sin(i * 0.8) * 5}`).join("")} stroke={P.green} strokeWidth="2" strokeLinejoin="round" fill="none" />}
      </g>
    ) }
    case "glassshelf": return (
      <g>
        {[0, 1].map((row) => { const py = y + 17 + row * 18; return (
          <g key={row}>
            <rect x={x - 46} y={py} width="92" height="3.5" rx="1.5" fill={P.tan} />
            {[0, 1, 2, 3, 4, 5].map((i) => { const bx = x - 38 + i * 15, c = LAB_COLORS[(i + row * 2) % 5]; return (i + row) % 3 === 0
              ? <g key={i}><rect x={bx - 3} y={py - 15} width="6" height="15" rx="2.5" fill={GLASS} /><rect x={bx - 3} y={py - 7} width="6" height="7" rx="2.5" fill={c} /></g>
              : <g key={i}><path d={`M${bx - 1.5} ${py - 12}L${bx - 1.5} ${py - 8}L${bx - 5} ${py}L${bx + 5} ${py}L${bx + 1.5} ${py - 8}L${bx + 1.5} ${py - 12}Z`} fill={GLASS} /><rect x={bx - 4} y={py - 4} width="8" height="4" rx="1" fill={c} /></g> })}
          </g>
        ) })}
      </g>
    )
    case "dna": return (
      <g>
        <rect x={x - 22} y={y} width="44" height="40" rx="4" fill={P.surface} stroke={P.edge} strokeWidth="1.2" />
        {Array.from({ length: 11 }, (_, i) => { const py = y + 4 + i * 3.2, a = Math.sin(i * 0.7) * 11; return <g key={i}>{i % 2 === 0 && <path d={`M${x + a} ${py}L${x - a} ${py}`} stroke={P.edge} strokeWidth="1.2" />}<circle cx={x + a} cy={py} r="2" fill={P.blue} /><circle cx={x - a} cy={py} r="2" fill={P.pink} /></g> })}
      </g>
    )
    case "periodic": return (
      <g>
        <rect x={x - 30} y={y} width="60" height="38" rx="4" fill={P.surface} stroke={P.edge} strokeWidth="1.2" />
        {Array.from({ length: 9 }, (_, i) => [0, 1, 2, 3].map((j) => ((j === 0 && i > 0 && i < 8) || (j === 1 && i > 1 && i < 7) ? null : <rect key={`${i}${j}`} x={x - 26 + i * 5.8} y={y + 6 + j * 7.5} width="4.6" height="6" rx="1" fill={LAB_COLORS[(i + j * 2) % 5]} />)))}
      </g>
    )
    case "hazard": return <g><path d={`M${x} ${y + 6}L${x + 15} ${y + 32}L${x - 15} ${y + 32}Z`} fill={P.yellow} stroke={P.yellow} strokeWidth="4" strokeLinejoin="round" /><rect x={x - 1.4} y={y + 14} width="2.8" height="9" rx="1.4" fill={P.ink} /><circle cx={x} cy={y + 27} r="1.6" fill={P.ink} /></g>
    case "cells": return (
      <g>
        <rect x={x - 34} y={y} width="68" height="38" rx="6" fill={P.surface} stroke={P.edge} strokeWidth="1.2" /><circle cx={x} cy={y + 19} r="15" fill="#eaf2fe" />
        {Array.from({ length: 9 }, (_, i) => { const an = i * 0.7, r = 4 + (i % 3) * 3.5; return <ellipse key={i} cx={x + Math.cos(an) * r} cy={y + 19 + Math.sin(an) * r} rx="2.2" ry="1.8" fill={i % 3 ? P.green : P.pink} /> })}
        <rect x={x + 19} y={y + 8} width="10" height="3" rx="1.5" fill={P.edge} /><rect x={x + 19} y={y + 14} width="8" height="3" rx="1.5" fill={P.edge} /><rect x={x + 19} y={y + 20} width="10" height="3" rx="1.5" fill={P.blue} />
      </g>
    )
    case "panel": return <g><rect x={x - 18} y={y + 2} width="36" height="32" rx="6" fill={P.surface} />{[0, 1, 2, 3].map((i) => [0, 1, 2].map((j) => <circle key={`${i}${j}`} cx={x - 10.5 + i * 7} cy={y + 10 + j * 8} r="2" fill={srand(i * 5 + j * 11) > 0.45 ? P.green : P.edge} />))}</g>
  }
}

/** Equipment on the back counter. `y` is the counter top. The parts marked lab-on show only while the room is active. */
function counterItem(type: CounterType, x: number, y: number): ReactNode {
  switch (type) {
    case "bottles": return <g>{["#d9935a", P.blue, P.green, "#d9935a"].map((c, i) => { const bx = x - 18 + i * 12, h = i % 2 ? 16 : 20; return <g key={i}><rect x={bx - 4.5} y={y - h} width="9" height={h} rx="3" fill={c} /><rect x={bx - 2.5} y={y - h - 4} width="5" height="4" rx="1" fill={P.dark} /><rect x={bx - 3.5} y={y - h + 6} width="7" height="5" rx="1" fill={P.surface} /></g> })}</g>
    case "beakers": return <g>{[P.blue, P.pink, P.yellow].map((c, i) => { const bx = x - 14 + i * 14, h = 12 + (i % 2) * 4; return <g key={c}><rect x={bx - 5} y={y - h} width="10" height={h} rx="2" fill={GLASS} /><rect x={bx - 5} y={y - h * 0.55} width="10" height={h * 0.55} rx="2" fill={c} /></g> })}</g>
    case "tubes": return <g><rect x={x - 18} y={y - 6} width="36" height="6" rx="2" fill={P.tan} />{[0, 1, 2, 3, 4].map((i) => <g key={i}><rect x={x - 15 + i * 6.5} y={y - 20} width="4" height="16" rx="2" fill={GLASS} /><rect x={x - 15 + i * 6.5} y={y - 11} width="4" height="7" rx="2" fill={LAB_COLORS[i]} /></g>)}<rect x={x - 18} y={y - 13} width="36" height="3" rx="1.5" fill="#d8b98e" /></g>
    case "sink": return <g><rect x={x - 20} y={y - 3} width="40" height="5" rx="2" fill="#cfc8b8" /><path d={`M${x + 10} ${y - 2}L${x + 10} ${y - 20}Q${x + 10} ${y - 26} ${x + 3} ${y - 26}L${x} ${y - 22}`} stroke="#b8b0a0" strokeWidth="3.5" strokeLinecap="round" fill="none" /><ellipse className="lab-on lab-fx-drip" cx={x} cy={y - 18} rx="1.4" ry="2" fill={P.blue} /></g>
    case "centrifuge": return (
      <g>
        <rect x={x - 17} y={y - 18} width="34" height="18" rx="6" fill={P.metal} /><ellipse cx={x} cy={y - 18} rx="15" ry="5" fill={P.metalFront} />
        <g transform={`translate(${x} ${y - 18}) scale(1 .33)`}><g className="lab-fx-spin">{[0, 1, 2, 3].map((i) => <ellipse key={i} className="lab-lamp" cx={Math.cos((i * Math.PI) / 2) * 8} cy={Math.sin((i * Math.PI) / 2) * 8} rx="2.2" ry="3.6" fill={P.grey} />)}</g></g>
        <circle className="lab-lamp-green" cx={x + 10} cy={y - 7} r="2" fill={P.grey} />
      </g>
    )
    case "incubator": return (
      <g>
        <rect x={x - 26} y={y - 38} width="52" height="38" rx="6" fill={P.metal} /><rect className="lab-warm" x={x - 20} y={y - 32} width="30" height="26" rx="4" fill="#f1ece0" />
        {[0, 1, 2].map((i) => <ellipse key={i} cx={x - 5} cy={y - 26 + i * 8} rx="9" ry="2.6" fill="rgba(92,196,141,.45)" />)}
        <rect x={x + 13} y={y - 32} width="9" height="7" rx="2" fill={P.dark} /><text className="lab-lamp-yellow" x={x + 17.5} y={y - 26.6} fontSize="5" fontWeight="600" textAnchor="middle" fill="#a39d8e">37°</text>
        <circle className="lab-lamp-flame" cx={x + 17.5} cy={y - 17} r="2" fill={P.grey} />
      </g>
    )
    case "hood": { const w = 120, top = y - 44; return (
      // fume hood: a glass-fronted cabinet on the counter, reaching up the wall, with a light and a flask inside
      <g>
        <rect x={x - w / 2} y={top} width={w} height="46" rx="6" fill={P.metalFront} /><rect className="lab-hood" x={x - w / 2 + 5} y={top + 5} width={w - 10} height="37" rx="4" fill="#e9eef6" />
        <rect className="lab-lamp-yellow" x={x - w / 2 + 9} y={top + 7} width={w - 18} height="3" rx="1.5" fill="#d9d4c7" />
        {flask(x - 20, y - 3, P.green, 0.85)}{flask(x + 18, y - 3, P.pink, 0.65)}
        <rect x={x - w / 2 + 5} y={top + 19} width={w - 10} height="23" fill="rgba(107,155,242,.10)" /><rect x={x - w / 2 + 5} y={top + 17} width={w - 10} height="3" rx="1.5" fill={P.grey} />
      </g>
    ) }
  }
}

/**
 * One room card: the back wall band with seams, the tiled floor, pipes and a valve, the wall items, the counter with
 * its equipment, the furniture, and the doorway onto the corridor with its mat.
 */
function room(id: RoomId, door: "left" | "right", active: boolean, clip: string): ReactNode {
  const RW = ROOM.width, RH = ROOM.height, BACK = ROOM.back, doorY = RH - 34
  const top = BACK - 4
  return (
    <>
      <rect className="lab-card" width={RW} height={RH} rx="18" fill={P.surface} />
      <g clipPath={`url(#${clip})`}>
        <rect width={RW} height={BACK} fill={P.wall} />
        {Array.from({ length: Math.floor((RW - 46) / 46) + 1 }, (_, i) => <rect key={i} x={46 + i * 46} y="0" width="1.5" height={BACK} fill={P.wallSeam} />)}
        <rect x="0" y={BACK - 3} width={RW} height="3" fill="#eadcbc" />
        <path d={`${Array.from({ length: Math.floor((RW - 28) / 28) }, (_, i) => `M${28 + i * 28} ${BACK}V${RH}`).join("")}${Array.from({ length: Math.floor((RH - BACK - 1) / 28) }, (_, i) => `M0 ${BACK + 28 + i * 28}H${RW}`).join("")}`} stroke="rgba(27,26,23,.045)" strokeWidth="1" fill="none" />
      </g>
      <rect className="lab-card-edge" width={RW} height={RH} rx="18" fill="none" stroke={active ? P.brand : P.line} strokeWidth={active ? 3 : 1} />
      {/* doorway onto the corridor: a gap in the card edge and a yellow mat */}
      <rect x={door === "right" ? RW - 4 : -6} y={doorY - 20} width="10" height="40" fill={P.surface} />
      <rect x={door === "right" ? RW - 10 : -4} y={doorY - 18} width="14" height="36" rx="4" fill={active ? P.brand : "#f3e7c3"} />
      {/* pipes along the top of the back wall, with a red valve */}
      <rect x="16" y="4" width={RW - 32} height="4" rx="2" fill="#ddd6c6" />
      {Array.from({ length: Math.floor((RW - 90) / 96) + 1 }, (_, i) => <rect key={i} x={57 + i * 96} y="3" width="6" height="6" rx="1.5" fill="#cbc3b1" />)}
      <rect x={RW - 24} y="4" width="4" height="30" rx="2" fill="#ddd6c6" /><circle cx={RW - 22} cy="34" r="4.5" fill={P.flame} /><circle cx={RW - 22} cy="34" r="1.6" fill={P.surface} />
      {WALL_ITEMS.filter(([r]) => r === id).map(([, type, dx]) => <g key={`${type}${dx}`}>{wallItem(type, dx)}</g>)}
      {/* the lab counter along the back wall, with its equipment */}
      <rect x="10" y={top + 6} width={RW - 20} height="14" rx="3" fill={P.metalFront} />
      {Array.from({ length: Math.floor((RW - 60) / 56) + 1 }, (_, i) => <rect key={i} x={40 + i * 56} y={top + 11} width="10" height="2.5" rx="1.2" fill={P.grey} />)}
      <rect x="8" y={top} width={RW - 16} height="7" rx="3" fill={P.metal} />
      {COUNTER_ITEMS.filter(([r]) => r === id).map(([, type, dx]) => <g key={`${type}${dx}`}>{counterItem(type, dx, top + 1)}</g>)}
      {FURNITURE.map(([r, type, dx, dy, w], k) => (r === id ? { type, dx, dy, w, seed: k * 3.7 } : undefined)).filter((f) => f !== undefined).sort((a, b) => a.dy - b.dy)
        .map((f) => <g key={`${f.type}${f.dx}`} data-furniture={f.type}>{furniture(f.type, f.dx, f.dy, f.w, f.seed)}</g>)}
    </>
  )
}

/** `active`: the rooms where the model says someone is working or fetching now, as "discovery,review" (a string, so the map is redrawn only when it changes). */
export const LabMap = memo(function LabMap({ layout = WIDE, active = "" }: { layout?: LabLayout; active?: string }) {
  const on = new Set(active.split(","))
  return (
    <svg className="lab-map" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false" data-layout={layout.id}>
      <defs><clipPath id="lab-room-clip"><rect width={ROOM.width} height={ROOM.height} rx="18" /></clipPath></defs>
      <rect width={layout.width} height={layout.height} fill="var(--lab-ground)" />
      {/* the corridor: a pale strip with a dashed guide line */}
      <rect x={layout.corridorX - 26} y="6" width="52" height={layout.height - 12} rx="18" fill={P.corridor} />
      <path d={`M${layout.corridorX} 22V${layout.height - 22}`} stroke="rgba(27,26,23,.10)" strokeWidth="2" strokeDasharray="8 10" />
      {ROOMS.map((r) => { const at = layout.at[r.id]; return <g key={r.id} className="lab-room" data-room={r.id} data-active={on.has(r.id) || undefined} transform={`translate(${at.x} ${at.y})`}>{room(r.id, at.door, on.has(r.id), "lab-room-clip")}</g> })}
    </svg>
  )
})
