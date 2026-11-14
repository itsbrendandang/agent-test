import { defineSimulation } from "./types"

interface State { w: number; h: number }

// Shown when the registry is empty, so the dashboard still renders.
export const emptySimulation = defineSimulation<State>({
  id: "__empty",
  name: "No simulation",
  category: "custom",
  description: "Register a simulation in src/sim/registry.ts to see it here.",
  params: [],
  init: (_p, w, h) => ({ w, h }),
  step: () => {},
  draw(ctx, s) {
    ctx.fillStyle = "#faf7f0"
    ctx.fillRect(0, 0, s.w, s.h)
    ctx.fillStyle = "#e6e0d0"
    for (let x = 12; x < s.w; x += 24) for (let y = 12; y < s.h; y += 24) ctx.fillRect(x, y, 2, 2)
  },
})
