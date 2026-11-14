import type { Category, Simulation } from "./types"

// Register simulations here. Start from `./sims/template.ts`:
//   import mySim from "./sims/mySim"
export const simulations: Simulation[] = []

export const categoryLabels: Record<Category, string> = {
  world: "World",
  swarm: "Swarm",
  custom: "Custom",
}
