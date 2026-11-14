// Copy this file to add a simulation, then register it in ../registry.ts.
import { defineSimulation, num } from "../types"

interface Agent { x: number; y: number }
interface State { agents: Agent[]; w: number; h: number; tick: number }

export default defineSimulation<State>({
  id: "template",
  name: "Blank template",
  category: "custom",
  headline: "spread",
  tags: ["Starter"],
  description:
    "Random walkers. Copy src/sim/sims/template.ts, change init/step/draw/metrics, and register it in src/sim/registry.ts. It shows up here with its parameter controls and metric charts.",
  params: [
    { key: "agents", label: "Agents", type: "number", min: 1, max: 500, step: 1, default: 50 },
    { key: "stepSize", label: "Step size", type: "number", min: 0.5, max: 10, step: 0.5, default: 2 },
  ],
  resetOn: ["agents"],

  init(p, w, h) {
    const agents = Array.from({ length: num(p, "agents") }, () => ({ x: w / 2, y: h / 2 }))
    return { agents, w, h, tick: 0 }
  },

  step(s, p) {
    s.tick++
    const k = num(p, "stepSize")
    for (const a of s.agents) {
      a.x = Math.max(0, Math.min(s.w, a.x + (Math.random() - 0.5) * 2 * k))
      a.y = Math.max(0, Math.min(s.h, a.y + (Math.random() - 0.5) * 2 * k))
    }
  },

  draw(ctx, s) {
    ctx.fillStyle = "#eef0f3"
    ctx.fillRect(0, 0, s.w, s.h)
    ctx.fillStyle = "#2b3cf5"
    for (const a of s.agents) ctx.fillRect(a.x - 2, a.y - 2, 4, 4)
  },

  metrics(s) {
    const cx = s.w / 2, cy = s.h / 2
    const spread = s.agents.reduce((t, a) => t + Math.hypot(a.x - cx, a.y - cy), 0) / (s.agents.length || 1)
    return { spread }
  },
})
