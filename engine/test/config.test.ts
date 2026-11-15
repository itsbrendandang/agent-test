// board/config.yaml is checked when it is loaded (src/config.ts checkConfig). Copies of the real file with one value
// broken are written to a temporary folder; the real file is only read.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { overLimit } from "../src/board/board.ts"
import { ConfigError, loadConfig, ROOT } from "../src/config.ts"

process.env.NO_PAID_CALLS = "1"

const REAL = readFileSync(resolve(ROOT, "board/config.yaml"), "utf8")
const dir = mkdtempSync(join(tmpdir(), "engine-config-"))
/** The real config with one `  key: value` line of the meeting section replaced (or removed with `null`). */
function withMeeting(key: string, value: string | null): string {
  const line = new RegExp(`^  ${key}:.*$`, "m")
  assert.match(REAL, line, `the real config has meeting.${key}`)
  const file = join(dir, `${key}-${Math.random().toString(36).slice(2)}.yaml`)
  writeFileSync(file, REAL.replace(line, value === null ? "" : `  ${key}: ${value}`))
  return file
}

test("the committed board/config.yaml passes the check", () => {
  const config = loadConfig()
  assert.equal(typeof config.meeting.max_usd, "number")
  assert.ok(config.board.includes("scout"))
})

test("a money or time limit that is not a number is refused at load, naming the key, instead of switching the cap off", () => {
  // Before the check, max_usd: $1 loaded as the text "$1": `spent >= "$1"` is false, so no amount was over the cap.
  for (const [key, value] of [["max_usd", "$1"], ["daily_usd", "20 dollars"], ["max_minutes", "-5"], ["max_rounds", "four"], ["max_usd", '"5"'], ["daily_usd", ""]] as const) {
    assert.throws(() => loadConfig(withMeeting(key, value), {}), (e: Error) => e instanceof ConfigError && e.message.includes(`meeting.${key} must be a number`), `${key}: ${value}`)
  }
  for (const key of ["max_usd", "daily_usd", "max_minutes", "max_rounds"]) {
    assert.throws(() => loadConfig(withMeeting(key, null), {}), (e: Error) => e instanceof ConfigError && e.message.includes(`meeting.${key} must be a number of 0 or more, not missing`), `${key} removed`)
  }
  for (const [key, value] of [["exa_ceiling_usd", "forty"], ["max_escalations", "12x"], ["exa_usd_per_search", "-0.007"]] as const) {
    assert.throws(() => loadConfig(withMeeting(key, value), {}), (e: Error) => e instanceof ConfigError && e.message.includes(`meeting.${key}`), `${key}: ${value}`)
  }
})

test("an optional limit may be left empty or removed: the code's default applies", () => {
  assert.equal(loadConfig(withMeeting("max_escalations", ""), {}).meeting.max_escalations, null)
  assert.equal(loadConfig(withMeeting("max_searches", null), {}).meeting.max_searches, undefined)
})

test("the caps of a config that loads are numbers, so they bind", () => {
  const config = loadConfig(withMeeting("max_usd", "1"), {})
  assert.ok(overLimit(config, 0, Date.now(), 999, 50), "$999 is over a $1 cap")
})

test("the team list must keep the scout", () => {
  const file = join(dir, "no-scout.yaml")
  writeFileSync(file, REAL.replace(/^  - scout .*$/m, ""))
  assert.throws(() => loadConfig(file, {}), (e: Error) => e instanceof ConfigError && /board: must include scout/.test(e.message))
})
