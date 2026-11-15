// The board's state files are replaced whole (src/fsx.ts writeWhole), never rewritten in place: a process killed
// part-way leaves the old file, not a cut one. A cut run.json hid the run from the list, stopped its resume and dropped
// its spend from the daily cap. Scripted run only; nothing is paid.
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { runBoard, startRun } from "../src/board/board.ts"
import { type BoardConfig, loadConfig } from "../src/config.ts"
import { writeWhole } from "../src/fsx.ts"

process.env.NO_PAID_CALLS = "1"

const BRIEF = join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md")
const tempConfig = (): BoardConfig => {
  const base = loadConfig(), dir = mkdtempSync(join(tmpdir(), "board-files-"))
  return { ...base, paths: { ...base.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") } }
}

test("writeWhole replaces the file (a new inode), so a reader sees the old text or the new, never half", () => {
  const file = join(mkdtempSync(join(tmpdir(), "write-whole-")), "x.json")
  writeWhole(file, "old")
  const before = statSync(file).ino
  writeWhole(file, "new")
  assert.equal(readFileSync(file, "utf8"), "new")
  assert.notEqual(statSync(file).ino, before, "replaced by a rename, not written in place")
  assert.deepEqual(readdirSync(join(file, "..")), ["x.json"], "no temporary file is left")
})

test("a board run's run.json, memo and ledger are replaced whole", async () => {
  const config = tempConfig()
  const id = await startRun(BRIEF, { config, mock: true })
  const dir = join(config.paths.runs, id)
  const first = statSync(join(dir, "run.json")).ino
  await runBoard(id, undefined, { config, mock: true })
  assert.notEqual(statSync(join(dir, "run.json")).ino, first, "run.json was replaced, not rewritten in place")
  assert.equal(JSON.parse(readFileSync(join(dir, "run.json"), "utf8")).finished, true)
  for (const name of ["memo.md", "verification_ledger.json"]) assert.ok(statSync(join(dir, name)).size > 0, name)
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), [], "no temporary file is left")
})
