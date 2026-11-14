// Loads board/config.yaml. Paths in the config are relative to the repo root.
import "./env.ts" // first: MOCK below depends on keys from .env
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export type Tier = "lead" | "strong" | "cheap" | "rival"

export interface BoardConfig {
  meeting: { max_minutes: number; max_usd: number; max_rounds: number; daily_usd: number; lead_turns?: number; member_turns?: number; max_escalations?: number; fallback_usd_per_mtok?: number }
  memory?: { enabled: boolean; max_notes: number }
  watch: { enabled: boolean; every_hours: number }
  brief: { required_sections: string[] }
  paths: { agents: string; briefs: string; context: string; expertise: string; runs: string }
  models: Record<Tier, string>
  checkers: {
    jev: { model: string; yes: number; no: number }
    escalate: { literature: "openai"; computed: "claude-code" }
    openai_model: string
    claude_code_cmd: string
    claude_code_tools?: string
    timeout_seconds?: number
  }
  board: string[]
}

export function loadConfig(file = resolve(ROOT, "board/config.yaml")): BoardConfig {
  return parse(readFileSync(file, "utf8")) as BoardConfig
}

export const path = (config: BoardConfig, key: keyof BoardConfig["paths"], ...rest: string[]) =>
  resolve(ROOT, config.paths[key], ...rest)

export const MOCK = process.env.DRUG_BOARD_MOCK === "1" || !process.env.OPENROUTER_API_KEY
