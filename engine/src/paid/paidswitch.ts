// The paid switch: GET /api/paid and POST /api/paid, to go from the practice mode (scripted runs) to real models
// without editing .env and restarting.
//
//   GET  /api/paid   {paid, source: "env"|"switch", locked, board, missingKeys, missing, caps}. Open like /api/status.
//   POST /api/paid   {on: boolean} or {on: true, confirm: "I will be charged"}. Needs the x-glhf-token header, an
//                    application/json body, and the usual Host and Origin checks (app.ts guard).
//
// What makes it safer than "anyone can flip it":
//   - the token is required to change anything, either way (an Origin is a header anyone can type);
//   - turning ON needs the exact confirmation text, so a one-field request cannot do it;
//   - PAID_SWITCH_LOCKED=1 (CI, `npm test`, any `node --test` process) refuses every change with 403;
//   - turning ON needs every key the board's roster needs (providers.ts missingKeys), else 409 and the state stays off;
//   - the state lives in memory for this process only (paid.ts): a restart or crash goes back to the environment's value;
//   - every attempt that passed the token check is appended to board/runs/.paid-switch-audit.jsonl (time, direction,
//     origin, result; never the token). If an ON cannot be written to the audit file, it does not happen;
//   - POST is rate-limited.
// What it does not change: max_usd, daily_usd, the Exa caps, per-run mode (a run keeps the mode it started in).
import { appendFileSync, mkdirSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { spentToday } from "../board/board.ts"
import { loadRoster } from "../board/agents.ts"
import { type BoardConfig, MOCK, LOCAL, path } from "../config.ts"
import { exaAssumed, exaCeiling, exaLedgerFile, exaTotal } from "./exaledger.ts"
import { gate, HttpError, readJson } from "../http.ts"
import { paidState, paidSwitchLocked, setPaidOverride } from "./paid.ts"
import { missingKeys } from "../providers.ts"

export const CONFIRM = "I will be charged"
export const AUDIT_FILE = ".paid-switch-audit.jsonl"
/** POSTs allowed per minute. */
export const RATE_PER_MINUTE = 10

export interface PaidDeps {
  config: BoardConfig
  env: NodeJS.ProcessEnv
  hasToken: (req: IncomingMessage) => boolean
  tokenFile: string
  /** Stops the live paid GLHF runs when paid calls go off. Default: none (tests). The engine passes routes.ts cancelPaidRuns. */
  stopPaidRuns?: () => Promise<string[]>
  now?: () => number
  /** Engine mode now (tests). Default: config.ts MOCK, read live. */
  mock?: () => boolean
}

const hits: number[] = []
/** Test hook: forget earlier requests. */
export const resetRateLimit = () => { hits.length = 0 }

/** The current state, as GET answers it. */
export function paidReport(deps: PaidDeps) {
  const { config, env } = deps
  const searchers = loadRoster(config).some((a) => a.tools.includes("exa_search"))
  const missing = missingKeys(config, env, searchers)
  const state = paidState(env)
  const mock = deps.mock ? deps.mock() : MOCK
  return {
    paid: state.paid,
    source: state.source,
    locked: paidSwitchLocked(env),
    /** What a board run started now would be. */
    board: mock ? (LOCAL ? "local" : "scripted") : "real",
    missingKeys: [...new Set(missing.map((m) => m.key))],
    missing,
    caps: {
      maxUsd: config.meeting.max_usd,
      dailyUsd: config.meeting.daily_usd,
      spentTodayUsd: Math.round(spentToday(config) * 1e6) / 1e6,
      exaUsedUsd: Math.round(exaTotal(exaLedgerFile(config), exaAssumed(config)) * 1e6) / 1e6,
      exaCeilingUsd: exaCeiling(config),
    },
  }
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

function audit(deps: PaidDeps, req: IncomingMessage, line: Record<string, unknown>): void {
  const dir = path(deps.config, "runs")
  mkdirSync(dir, { recursive: true })
  const origin = typeof req.headers.origin === "string" ? req.headers.origin.slice(0, 200) : null
  appendFileSync(`${dir}/${AUDIT_FILE}`, JSON.stringify({ at: new Date((deps.now ?? Date.now)()).toISOString(), ...line, origin }) + "\n")
}

export async function handlePaid(req: IncomingMessage, res: ServerResponse, deps: PaidDeps): Promise<void> {
  try {
    if (req.method === "GET") return json(res, 200, paidReport(deps))
    if (req.method !== "POST") return json(res, 405, { error: "GET or POST" })

    const now = (deps.now ?? Date.now)()
    while (hits.length && now - hits[0] > 60_000) hits.shift()
    if (hits.length >= RATE_PER_MINUTE) return json(res, 429, { error: `at most ${RATE_PER_MINUTE} changes a minute`, field: "rate" })
    hits.push(now)

    if (!gate(req, res, "spend", "changing the paid switch", { hasToken: deps.hasToken, env: deps.env, tokenFile: deps.tokenFile })) return
    if (paidSwitchLocked(deps.env)) {
      audit(deps, req, { result: "refused", reason: "locked" })
      return json(res, 403, { error: "the paid switch is locked (PAID_SWITCH_LOCKED=1): paid calls can only be set in .env", field: "locked", locked: true })
    }
    const body = await readJson<{ on?: unknown; confirm?: unknown }>(req)
    if (typeof body.on !== "boolean") return json(res, 400, { error: "send {\"on\": true} or {\"on\": false}", field: "on" })
    const before = paidState(deps.env)

    if (!body.on) {
      if (before.paid || before.source === "switch") setPaidOverride(false)
      const stopped = before.paid && deps.stopPaidRuns ? await deps.stopPaidRuns().catch(() => []) : []
      try { audit(deps, req, { result: before.paid ? "changed" : "unchanged", on: false, from: before.paid ? "on" : "off", fromSource: before.source, stoppedRuns: stopped }) } catch { /* turning off is never blocked by a log */ }
      return json(res, 200, { ...paidReport(deps), stoppedRuns: stopped })
    }

    if (body.confirm !== CONFIRM) {
      audit(deps, req, { result: "refused", reason: "confirm", on: true })
      return json(res, 400, { error: `turning paid calls on needs {"confirm": "${CONFIRM}"}, exactly`, field: "confirm" })
    }
    const report = paidReport(deps)
    if (report.missing.length) {
      audit(deps, req, { result: "refused", reason: "keys", on: true, missingKeys: report.missingKeys })
      return json(res, 409, { error: `cannot turn paid calls on: ${report.missing.map((m) => `${m.tier} (${m.model}) needs ${m.key}`).join("; ")}`, field: "keys", missingKeys: report.missingKeys, missing: report.missing })
    }
    if (before.paid) {
      audit(deps, req, { result: "unchanged", on: true, from: "on", fromSource: before.source })
      return json(res, 200, report)
    }
    // No audit line, no switch: write it before the state changes.
    try { audit(deps, req, { result: "changed", on: true, from: "off", fromSource: before.source }) }
    catch (error) { return json(res, 500, { error: `the audit file could not be written, so paid calls stay off: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`, field: "audit" }) }
    setPaidOverride(true)
    return json(res, 200, paidReport(deps))
  } catch (error) {
    if (res.headersSent) return void res.end()
    json(res, error instanceof HttpError ? error.status : 500, { error: String(error instanceof Error ? error.message : error) })
  }
}

