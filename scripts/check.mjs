#!/usr/bin/env node
// `npm run check`: one health report for the repository. It never spends money and never hangs.
//
//   npm run check            type checks, merge-conflict markers, engine tests (one file at a time), dashboard tests
//   npm run check -- --all   the above, plus the Python suites (harness, BixBench v1 adapter, datasets); several minutes
//   npm run check -- --fast  type checks and merge-conflict markers only (a few seconds)
//
// Why not `npm test`: one engine test file (app.test.ts) does not exit, so `npm test` hangs. Here every engine
// test file runs in its own process with a time limit, and a file that does not finish is reported, not waited for.
// Exit code: 0 when every part passed, 1 otherwise.

import { spawn, spawnSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = new Set(process.argv.slice(2))
const FAST = args.has("--fast"), ALL = args.has("--all")
const FILE_SECONDS = Number(process.env.CHECK_FILE_SECONDS ?? 180)
const PARALLEL = Number(process.env.CHECK_PARALLEL ?? 4)

// Paid calls stay off and the in-app switch stays locked, whatever the shell or .env says.
const env = { ...process.env, NO_PAID_CALLS: "1", PAID_SWITCH_LOCKED: "1" }

/** Run a command; resolve with its exit code and output. Kills the whole process group at the time limit. */
function run(cmd, argv, cwd, seconds) {
  return new Promise((done) => {
    const child = spawn(cmd, argv, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
    let out = "", timedOut = false
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (out += d))
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, "SIGKILL") } catch { /* already gone */ }
    }, seconds * 1000)
    child.on("error", (e) => { clearTimeout(timer); done({ code: 127, out: String(e), timedOut }) })
    child.on("close", (code) => { clearTimeout(timer); done({ code: code ?? 1, out, timedOut }) })
  })
}

const rows = []
const add = (part, ok, detail) => { rows.push({ part, ok, detail }); console.log(`${ok ? "ok  " : "FAIL"}  ${part}: ${detail}`) }
const count = (text, re) => Number(text.match(re)?.[1] ?? 0)

// 1. Merge-conflict markers in tracked files (a merge that was committed unfinished).
{
  const r = spawnSync("git", ["grep", "-n", "-I", "-E", "^(<<<<<<<|>>>>>>>) ", "--", ".", ":!glhf/data"], { cwd: ROOT, encoding: "utf8" })
  const hits = r.stdout.trim().split("\n").filter(Boolean)
  add("merge-conflict markers", hits.length === 0, hits.length ? `${hits.length} in ${[...new Set(hits.map((h) => h.split(":")[0]))].join(", ")}` : "none")
}

// 2. Type checks.
{
  const e = await run("npx", ["tsc", "--noEmit"], join(ROOT, "engine"), 300)
  add("engine type check", e.code === 0, e.code === 0 ? "clean" : `${count(e.out, /Found (\d+) error/) || "some"} errors (cd engine && npx tsc --noEmit)`)
  const d = await run("npx", ["tsc", "-b"], join(ROOT, "dashboard"), 300)
  add("dashboard type check", d.code === 0, d.code === 0 ? "clean" : "errors (cd dashboard && npx tsc -b)")
}

if (!FAST) {
  // 3. Engine tests, one file per process, a few at a time.
  const dir = join(ROOT, "engine", "test")
  const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts")).sort()
  let pass = 0, fail = 0
  const bad = [], stuck = []
  const queue = [...files]
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const r = await run("node", ["--test", `test/${f}`], join(ROOT, "engine"), FILE_SECONDS)
      const p = count(r.out, /^ℹ pass (\d+)/m), x = count(r.out, /^ℹ fail (\d+)/m)
      pass += p; fail += x
      if (r.timedOut) stuck.push(f)
      else if (x > 0 || r.code !== 0) bad.push(`${f} (${x || "?"})`)
    }
  }))
  const detail = [`${pass} pass, ${fail} fail in ${files.length} files`]
  if (bad.length) detail.push(`failing: ${bad.join(", ")}`)
  if (stuck.length) detail.push(`did not finish in ${FILE_SECONDS}s: ${stuck.join(", ")}`)
  add("engine tests", fail === 0 && !bad.length && !stuck.length, detail.join("; "))

  // 4. Dashboard tests.
  const d = await run("npx", ["vitest", "run"], join(ROOT, "dashboard"), 600)
  const dp = count(d.out, /Tests\s+(?:\d+ failed \| )?(\d+) passed/), df = count(d.out, /Tests\s+(\d+) failed/)
  add("dashboard tests", d.code === 0, d.timedOut ? "did not finish in 600s" : `${dp} pass, ${df} fail`)
}

if (ALL) {
  // 5. Python suites. Each needs uv; the harness suite starts a Docker sandbox for some tests and skips them without Docker.
  const suites = [
    ["harness tests (glhf/bixbench)", join(ROOT, "glhf", "bixbench"), ["run", "pytest", "-q", "tests"]],
    ["BixBench v1 adapter tests", join(ROOT, "glhf", "bixbench_v1"), ["run", "pytest", "-q", "tests"]],
    ["datasets catalogue tests", join(ROOT, "datasets"), ["run", "--no-project", "--with", "pytest", "pytest", "-q"]],
  ]
  for (const [name, cwd, argv] of suites) {
    if (!existsSync(cwd)) { add(name, false, "folder missing"); continue }
    const r = await run("uv", argv, cwd, 1500)
    const summary = r.out.trim().split("\n").filter((l) => /\b(passed|failed|error)\b/.test(l)).pop() ?? (r.code === 127 ? "uv is not installed" : "no summary line")
    add(name, r.code === 0, r.timedOut ? "did not finish in 25 minutes" : summary.replace(/=+/g, "").trim())
  }
}

const failed = rows.filter((r) => !r.ok)
console.log(failed.length ? `\n${failed.length} of ${rows.length} parts need attention.` : `\nAll ${rows.length} parts passed.`)
process.exit(failed.length ? 1 : 0)
