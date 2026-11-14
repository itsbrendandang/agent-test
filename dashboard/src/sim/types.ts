export type Category = "world" | "swarm" | "custom"

export type ParamSpec =
  | { key: string; label: string; type: "number"; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: "boolean"; default: boolean }
  | { key: string; label: string; type: "select"; options: string[]; default: string }

export type Params = Record<string, number | boolean | string>

export type Metrics = Record<string, number>

export type EventKind = "info" | "success" | "warning" | "danger"

export interface SimEvent {
  kind: EventKind
  label: string
  detail?: string
}

export interface TimelineEvent extends SimEvent {
  id: number
  tick: number
  time: string
}

export interface Simulation<State = unknown> {
  id: string
  name: string
  category: Category
  description: string
  params: ParamSpec[]
  // Params marked here rebuild the world when changed; others apply live.
  resetOn?: string[]
  init(params: Params, width: number, height: number): State
  step(state: State, params: Params): void
  draw(ctx: CanvasRenderingContext2D, state: State, params: Params): void
  metrics?(state: State): Metrics
  // Return events that happened since the last call, for the run timeline.
  drainEvents?(state: State): SimEvent[]
  // Metric shown large on the simulation's card.
  headline?: string
  tags?: string[]
}

export function defaults(sim: Simulation): Params {
  return Object.fromEntries(sim.params.map((p) => [p.key, p.default]))
}

export const num = (p: Params, k: string) => Number(p[k])

export function defineSimulation<S>(sim: Simulation<S>): Simulation {
  return sim as unknown as Simulation
}
