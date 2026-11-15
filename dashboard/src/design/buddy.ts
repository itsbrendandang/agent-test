import type { Species } from "../components/species"

export const INK = "#1b1a17"

export const FACE: Record<Species, { x: number; y: number; spread: number }> = {
  bunny: { x: 50, y: 66, spread: 11 },
  flame: { x: 50, y: 66, spread: 10 },
  egg: { x: 50, y: 54, spread: 9 },
  mountain: { x: 50, y: 72, spread: 10 },
  sprout: { x: 50, y: 46, spread: 11 },
}
