// The key of an agent: the engine's own name for a board member ("methods-auditor"), which is also what a label
// becomes ("Methods Auditor (Quality Checker)" -> "methods-auditor", "Critic, round 2" -> "critic"). Which face a
// key has is decided in one place for the whole app: src/lab/identity.ts.
export const agentKey = (nameOrLabel: string): string =>
  nameOrLabel.toLowerCase().replace(/\(.*?\)/g, "").split(/[,:·]/)[0].trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
