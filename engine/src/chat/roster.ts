// Who takes part in a board run: GET /api/roster?run=<id> (and GET /api/chat/roster?run=<id>).
// Without a run: the lead and the members of board/config.yaml, as GET /api/roster always answered, plus `source`.
// With a run: the members that run really has: the board members its plan kept (overrides.json narrows the roster)
// and the method specialists its plan added, each with a plain title, why it was chosen and the methods it reads.
import { existsSync } from "node:fs"
import { type AgentDef, loadAgent, loadRoster } from "../agents.ts"
import { applyOverrides, runDir } from "../board.ts"
import type { BoardConfig } from "../config.ts"
import { HttpError, isSafeId } from "../http.ts"
import { runSpecialists } from "../specialists.ts"

export interface RosterMember extends Omit<AgentDef, "prompt" | "specialist"> {
  modelId: string
  source: "board" | "specialist"
  /** Specialists only: one line on why the plan chose it, and the methods whose notes it reads. */
  why?: string
  methods?: { name: string; title: string }[]
}

export function rosterFor(config: BoardConfig, runId?: string | null): RosterMember[] {
  let run = config, guests: AgentDef[] = []
  if (runId) {
    if (!isSafeId(runId) || !existsSync(`${runDir(config, runId)}/run.json`)) throw new HttpError(404, "no such run")
    run = applyOverrides(config, runId)
    guests = runSpecialists(run, runId, config.board.length - run.board.length)
  }
  return [loadAgent(run, "lead-scientist"), ...loadRoster(run), ...guests].map(({ prompt: _p, specialist, ...a }) => ({
    ...a, modelId: run.models[a.model], source: specialist ? "specialist" as const : "board" as const, ...(specialist ? { why: specialist.why, methods: specialist.methods } : {}),
  }))
}
