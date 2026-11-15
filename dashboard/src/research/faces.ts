// Which face an agent has. One key per agent, the same everywhere: the engine's own name for a board member
// ("methods-auditor"), which is also what a swarm role's name becomes ("Critic, round 2" -> "critic").
// Placeholder colours and letters until lab-view's shared mapping is imported here.
export interface Face { letter: string; colour: string }
export const NEUTRAL: Face = { letter: "·", colour: "#e9e6dd" }
export const FACES: Record<string, Face> = {
  "lead-scientist": { letter: "L", colour: "#e7eb89" }, scout: { letter: "S", colour: "#f6b6cd" }, proposer: { letter: "P", colour: "#bfe3c8" },
  pilot: { letter: "P", colour: "#ffe08a" }, experimenter: { letter: "E", colour: "#ffb59e" }, "methods-auditor": { letter: "A", colour: "#b9d2fa" },
  auditor: { letter: "A", colour: "#b9d2fa" }, critic: { letter: "C", colour: "#d7c4f2" }, reviser: { letter: "R", colour: "#ffd9a8" },
  finisher: { letter: "F", colour: "#c9e9e4" }, reporter: { letter: "R", colour: "#e3d3bf" },
}
/** The key of an agent, from its engine name or from the label shown for it. */
export const agentKey = (nameOrLabel: string): string =>
  nameOrLabel.toLowerCase().replace(/\(.*?\)/g, "").split(/[,:·]/)[0].trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
