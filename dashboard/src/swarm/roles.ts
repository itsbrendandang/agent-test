// The swarm's nine roles, in the order they run. Shared by the Compare view and the Agents view.
// `key` is the first word of the phase name the solver logs (see swarm/solver.py).
export const ROLES = [
  { key: "scout", species: "bunny", name: "Scout", does: "Inspects the data and the tools before anyone plans" },
  { key: "propose", species: "sprout", name: "Proposer", does: "Plans the analysis and writes down statements to test" },
  { key: "pilot", species: "egg", name: "Pilot", does: "Tries the whole analysis on a small sample first" },
  { key: "experiment", species: "flame", name: "Experimenter", does: "Runs the analysis and writes the results" },
  { key: "audit", species: "sprout", name: "Auditor", does: "Checks the scripts against the stated methods, line by line" },
  { key: "critique", species: "mountain", name: "Critic", does: "Checks the work and tries to disprove each statement" },
  { key: "revise", species: "egg", name: "Reviser", does: "Fixes the problems the reviewers found" },
  { key: "finish", species: "flame", name: "Finisher", does: "Recovers any result still missing at the end (only if needed)" },
  { key: "report", species: "bunny", name: "Reporter", does: "Writes up what was actually done" },
] as const
export type RoleKey = (typeof ROLES)[number]["key"]
export const roleOf = (phase: string | undefined): RoleKey | undefined => ROLES.find((r) => phase?.startsWith(r.key))?.key

/** From the engine (GET /api/glhf/roles), which reads it from the solver code. */
export interface RoleSpec { key: RoleKey; model_group: "planner" | "experimenter" | "critic" | "reporter"; budget: string; instructions: string }
export interface RoleCatalog { shared_rules: string; roles: RoleSpec[] }
