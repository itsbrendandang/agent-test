import type { FaceShape } from "../lab/identity"

export const INK = "#1b1a17"
/** Where the face sits on each body (Buddy.tsx's table). */
export const FACE: Record<FaceShape, { x: number; y: number; spread: number }> = {
  bunny: { x: 50, y: 66, spread: 11 }, flame: { x: 50, y: 66, spread: 10 }, egg: { x: 50, y: 54, spread: 9 },
  mountain: { x: 50, y: 72, spread: 10 }, sprout: { x: 50, y: 46, spread: 11 }, generic: { x: 50, y: 60, spread: 10 },
}
