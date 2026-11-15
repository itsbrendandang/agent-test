// Agent Lab design by Anh Lam. The eight character shapes of the Agent Lab, drawn as Anh drew them (bunny, tree,
// mushroom, flame, mountain, fuzzy, acorn, owl), each in the colour Anh gave its teammate. Pure SVG, decoration only:
// the teammate's name and state are always in text beside it.
import type { ReactNode } from "react"
import type { Shape } from "./model"

const INK = "#1d1c19"

function body(shape: Shape, color: string): ReactNode {
  switch (shape) {
    case "bunny": return <><ellipse cx="17" cy="13" rx="5" ry="12" fill={color} /><ellipse cx="31" cy="12" rx="5" ry="12" fill={color} /><ellipse cx="24" cy="32" rx="17" ry="15" fill={color} /></>
    case "tree": return <><rect x="19" y="32" width="10" height="14" rx="4" fill="#c8a582" /><path d="M9 35C-1 29 5 17 13 17C10 4 29 2 33 13C46 9 51 28 40 32C35 44 18 43 9 35" fill={color} /></>
    case "mushroom": return <><rect x="14" y="23" width="21" height="23" rx="10" fill="#f5e3cc" /><path d="M3 25C3 0 45 0 45 25Q25 32 3 25" fill={color} /><circle cx="15" cy="17" r="4" fill="#fff1ec" /><circle cx="29" cy="11" r="4" fill="#fff1ec" /><circle cx="36" cy="22" r="3" fill="#fff1ec" /></>
    // Rounded teardrop flame with a lighter belly.
    case "flame": return <><path d="M25 3C33 15 44 24 44 35C44 45 36 51 25 51C14 51 6 45 6 35C6 24 17 15 25 3Z" fill={color} /><path d="M25 31C31 36 34 40 34 44C34 49 30 51 25 51C20 51 16 49 16 44C16 40 19 36 25 31Z" fill="#f8c08a" opacity=".9" /></>
    // Mountain with a snowcap.
    case "mountain": return <><path d="M25 6L47 45Q48.5 49 44 49H6Q1.5 49 3 45Z" fill={color} stroke={color} strokeWidth="2" strokeLinejoin="round" /><path d="M25 6L32.5 19.5L29 18L25.5 21L22 18L17.5 19.5Z" fill="#ffffff" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" /></>
    case "fuzzy": return <path d="M24 2L29 12L38 5L38 17L48 16L42 27L48 35L37 36L37 47L26 42L17 49L14 38L3 40L8 29L1 20L13 18L11 7L21 13Z" fill={color} stroke={color} strokeWidth="2" strokeLinejoin="round" />
    case "acorn": return <><rect x="10" y="17" width="29" height="29" rx="14" fill={color} /><path d="M8 24C6 4 40 3 42 24Z" fill="#a8835e" /><path d="M25 7L28 2" stroke="#a8835e" strokeWidth="5" strokeLinecap="round" /></>
    case "owl": return <><path d="M9 6L18 13Q25 8 32 13L41 6L39 25C49 48 3 53 8 26Z" fill={color} /><ellipse cx="17" cy="29" rx="9" ry="11" fill="#fbf3ea" /><ellipse cx="31" cy="29" rx="9" ry="11" fill="#fbf3ea" /><path d="M21 35L25 40L29 35" fill="#f2b35e" /></>
  }
}

/** One character. `feetRef` lets the scene shift the feet while it walks, as in Anh's page. */
export function Mascot({ shape, color, feetRef }: { shape: Shape; color: string; feetRef?: (el: SVGGElement | null) => void }) {
  return (
    <svg viewBox="0 0 50 56" aria-hidden="true" focusable="false">
      <ellipse cx="25" cy="51" rx="15" ry="3" fill="#0000000f" />
      <g ref={feetRef} className="lab-feet" fill={color}><ellipse cx="17" cy="48" rx="5" ry="3" /><ellipse cx="32" cy="48" rx="5" ry="3" /></g>
      {body(shape, color)}
      <g fill={INK}><circle cx="18" cy="30" r="2.4" /><circle cx="31" cy="30" r="2.4" /></g>
      <g fill="#f19bb3" opacity=".75"><ellipse cx="12.5" cy="35" rx="3" ry="1.8" /><ellipse cx="36.5" cy="35" rx="3" ry="1.8" /></g>
      {shape !== "owl" && <path d="M22 35.5Q24.5 38.5 27 35.5" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  )
}
