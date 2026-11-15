// The Set up checklist (src/setup.ts) against stand-ins: a fake Docker daemon on a Unix socket, and fake `uv` and
// `colima` commands. Nothing is downloaded, no real Docker or virtual machine is touched, and no model is called.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, request, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { dirname, join, resolve } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { BENCH_IMAGE, createSetup, DATASET, human, offlineReason, OPENABLE, SIZES, SWARM_IMAGE, type Status, type StepId } from "../src/setup.ts"

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = resolve(HERE, "../.."), MB = 1024 ** 2
const DASH = "http://127.0.0.1:5317"
const closers: (() => void)[] = []
after(() => { for (const close of closers) close() })

/** A short temporary folder: a Unix socket path may have 103 characters, and macOS's own temp folder is long. */
const temp = () => { const dir = mkdtempSync("/tmp/asb-t-"); closers.push(() => rmSync(dir, { recursive: true, force: true })); return dir }
const until = async (what: () => boolean | Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await what()) return; await new Promise((r) => setTimeout(r, 25)) } assert.fail("timed out waiting") }
const step = (status: Status, id: StepId) => status.steps.find((s) => s.id === id)!

/** A stand-in Docker daemon. `images` are present; a pull streams two layers and adds the image, or fails with `pullError`. */
function daemon(socket: string, state: { images: Set<string>; pullError?: string; slow?: boolean; pulls?: number; containers?: number }) {
  mkdirSync(dirname(socket), { recursive: true })
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://docker")
    if (url.pathname === "/_ping") return void res.end("OK")
    if (url.pathname === "/containers/json") return void res.end(JSON.stringify(Array(state.containers ?? 0).fill({})))
    const image = /^\/images\/(.+)\/json$/.exec(url.pathname)
    if (image) { res.statusCode = state.images.has(decodeURIComponent(image[1])) ? 200 : 404; return void res.end("{}") }
    if (url.pathname === "/images/create" && req.method === "POST") {
      state.pulls = (state.pulls ?? 0) + 1
      const name = `${url.searchParams.get("fromImage")}:${url.searchParams.get("tag")}`
      res.writeHead(200, { "content-type": "application/json" })
      const send = (event: object) => res.write(`${JSON.stringify(event)}\n`)
      send({ status: `Pulling from ${name}` })
      // Layer sizes of a real image: progress is measured against the image's expected size (tens of MB).
      send({ status: "Downloading", id: "a", progressDetail: { current: 10 * MB, total: 40 * MB } })
      if (state.pullError) { send({ error: state.pullError }); return void res.end() }
      const rest = () => { send({ status: "Download complete", id: "a" }); send({ status: "Downloading", id: "b", progressDetail: { current: 5 * MB, total: 5 * MB } }); send({ status: "Pull complete", id: "b" }); state.images.add(name); res.end() }
      if (state.slow) { const timer = setTimeout(rest, 60_000); res.on("close", () => clearTimeout(timer)) } else rest()
      return
    }
    res.statusCode = 404; res.end("{}")
  })
  server.listen(socket)
  closers.push(() => server.close())
  return state
}

/** A fake app: a data folder, a "bundle" with Python sources and fake tools, and a setup built on them. */
function fakeApp(extra: { free?: number; env?: Record<string, string>; uv?: string } = {}) {
  const dir = temp(), data = join(dir, "data"), res = join(dir, "res"), vm = join(dir, "vm"), home = join(dir, "home")
  for (const sub of [data, home, join(res, "bin"), join(res, "python/bixbench/src"), join(res, "python/bixbench/sandbox"), join(res, "python/demo_case")]) mkdirSync(sub, { recursive: true })
  writeFileSync(join(res, "python/bixbench/src/x.py"), "print('x')\n")
  writeFileSync(join(res, "python/demo_case/prompt.md"), "demo\n")
  // The fake uv: records what it was given, then makes the virtual environment's python, as `uv sync` would.
  const uv = extra.uv ?? `echo "Downloading cpython (26.6MiB)"; mkdir -p "$UV_PROJECT_ENVIRONMENT/bin"; echo x > "$UV_PROJECT_ENVIRONMENT/bin/python"; echo "Installed 3 packages in 1ms" >&2`
  writeFileSync(join(res, "bin/uv"), `#!/bin/sh\necho "$@" >> "${dir}/uv.calls"\nenv > "${dir}/uv.env"\n${uv}\n`)
  for (const name of ["colima", "limactl"]) writeFileSync(join(res, "bin", name), `#!${process.execPath}\n${FAKE_COLIMA}`)
  for (const name of ["uv", "colima", "limactl"]) chmodSync(join(res, "bin", name), 0o755)
  // The stamp is written last: "newer than the stamp" then means "written after the bundle was made".
  writeFileSync(join(res, "python/STAMP"), "stamp-1\n")
  const env: NodeJS.ProcessEnv = {
    ASB_SETUP: "1", ASB_DATA_DIR: data, ASB_RES_DIR: res, ASB_VM_DIR: vm, HOME: home, PATH: `${join(res, "bin")}:/usr/bin:/bin`,
    UV_PROJECT_ENVIRONMENT: join(data, "python/venv"), UV_OFFLINE: "1", UV_NO_SYNC: "1", ANTHROPIC_API_KEY: "sk-fake-not-a-key", FAKE_DAEMON: join(HERE, "fixtures/setup-daemon.mjs"), ...extra.env,
  }
  let freeBytes = extra.free ?? 500 * 1024 ** 3
  const opened: string[][] = []
  const setup = createSetup({ env, free: () => freeBytes, open: (args) => { opened.push(args) } })
  return { dir, data, res, vm, home, env, setup, opened, calls: () => (existsSync(join(dir, "uv.calls")) ? readFileSync(join(dir, "uv.calls"), "utf8").trim().split("\n") : []), setFree: (n: number) => { freeBytes = n } }
}

// The fake colima: `start` runs a stand-in daemon on the built-in socket (detached, like the real one); `stop` ends it.
const FAKE_COLIMA = `
const { spawn } = require("node:child_process"), fs = require("node:fs"), path = require("node:path")
const vm = process.env.COLIMA_HOME, socket = path.join(vm, "default/docker.sock"), pidFile = path.join(vm, "daemon.pid")
fs.appendFileSync(path.join(vm, "..", "colima.calls"), process.argv.slice(2).join(" ") + "\\n")
if (process.argv[2] === "start") {
  if (process.env.FAKE_COLIMA_FAILS) { console.error("level=fatal msg=\\"error starting vm: dial tcp: lookup github.com: no such host\\""); process.exit(1) }
  console.error('level=info msg="downloading disk image ..." context=vm')
  fs.mkdirSync(path.join(vm, "_lima/colima"), { recursive: true }); fs.writeFileSync(path.join(vm, "_lima/colima/lima.yaml"), "")
  const child = spawn(process.execPath, [process.env.FAKE_DAEMON, socket], { detached: true, stdio: "ignore" }); child.unref()
  fs.writeFileSync(pidFile, String(child.pid))
  const wait = () => fs.existsSync(socket) ? (console.error('level=info msg=done'), process.exit(0)) : setTimeout(wait, 20); wait()
} else if (process.argv[2] === "stop") {
  try { process.kill(Number(fs.readFileSync(pidFile, "utf8"))) } catch {}
  try { fs.rmSync(socket) } catch {}
}
`

const SOCKETS = (socket: string) => ({ ASB_SETUP_DOCKER_SOCKETS: socket })

test("from a checkout the checklist only reports: no step has a button, and a start is refused", async () => {
  const root = temp()
  const setup = createSetup({ env: { HOME: join(root, "home"), PATH: "/usr/bin:/bin", ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1" }, root, free: () => 1e12 })
  const status = await setup.status()
  assert.equal(status.app, false)
  assert.equal(status.firstRun, false, "a checkout never opens the Set up screen by itself")
  assert.deepEqual(status.steps.map((s) => s.id), ["python", "runtime", "image", "bench-image", "bench-data"])
  assert.ok(status.steps.every((s) => s.actions.length === 0))
  await assert.rejects(setup.act("python", "start"), /npm run setup/)
})

test("a new Mac: nothing is done, the app asks for set-up, and the image waits for the runtime", async () => {
  const { setup } = fakeApp({ env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1" } })
  const status = await setup.status()
  assert.equal(status.app, true)
  assert.equal(status.firstRun, true)
  assert.deepEqual(status.ready, { swarm: false, benchmark: false })
  assert.deepEqual([step(status, "python").state, step(status, "runtime").state, step(status, "image").state, step(status, "bench-data").state], ["todo", "todo", "blocked", "blocked"])
  assert.equal(status.runtime.state, "missing")
  assert.match(step(status, "image").detail, /Container runtime/)
  assert.ok(step(status, "runtime").actions.includes("open-docker-download"), "Docker Desktop is always offered")
  assert.deepEqual(step(status, "python").size, SIZES.python)
  await assert.rejects(setup.act("image", "start"), /Container runtime/)
})

test("Python packages: the sources are copied out of the bundle and uv sync runs with keys blank and downloads allowed", async () => {
  const app = fakeApp({ env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1" } })
  await app.setup.act("python", "start")
  await until(async () => step(await app.setup.status(), "python").state === "done")
  const status = await app.setup.status()
  assert.equal(step(status, "python").job?.state, "done")
  assert.deepEqual(app.calls(), ["sync --frozen --no-dev"])
  assert.ok(existsSync(join(app.data, "engine-root/glhf/bixbench/src/x.py")) && existsSync(join(app.data, "engine-root/glhf/demo_case/prompt.md")))
  const env = readFileSync(join(app.dir, "uv.env"), "utf8")
  assert.doesNotMatch(env, /^UV_OFFLINE=/m, "this one uv call must be allowed to download")
  assert.doesNotMatch(env, /^UV_NO_SYNC=/m)
  assert.match(env, /^ANTHROPIC_API_KEY=$/m, "keys are blank in the tool's environment while paid calls are off")
  assert.match(env, /^NO_PAID_CALLS=1$/m)
  // Nothing was written inside the bundle.
  assert.equal(spawnSync("find", [app.res, "-newer", join(app.res, "python/STAMP"), "-type", "f"], { encoding: "utf8" }).stdout.trim(), "")
  // A newer app (another stamp) makes the step due again.
  writeFileSync(join(app.res, "python/STAMP"), "stamp-2\n")
  assert.equal(step(await app.setup.status(), "python").state, "todo")
})

test("Python packages offline: the failure says so in plain words and nothing is marked as installed", async () => {
  const app = fakeApp({ env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1" }, uv: `echo "error: Failed to fetch: dns error: failed to lookup address information" >&2; exit 2` })
  await app.setup.act("python", "start")
  await until(async () => step(await app.setup.status(), "python").state === "failed")
  const failed = step(await app.setup.status(), "python")
  assert.match(failed.job!.error!, /could not reach the internet/)
  assert.match(failed.job!.error!, /Try again/)
  assert.deepEqual(failed.actions, ["start"], "it can be tried again")
})

test("a full disk refuses a step before anything starts, with the sizes in the sentence", async () => {
  const app = fakeApp({ free: 200 * 1024 ** 2, env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1" } })
  await assert.rejects(app.setup.act("python", "start"), (error: Error & { status?: number }) => error.status === 507 && /needs about 1\.5 GB free/.test(error.message) && /has 200 MB/.test(error.message))
  assert.deepEqual(app.calls(), [], "uv was not started")
  assert.equal((await app.setup.status()).disk.free, 200 * 1024 ** 2)
})

test("a Docker that already answers is used; the image is pulled only on request, with progress, and can be cancelled and resumed", async () => {
  const socket = join(temp(), "d.sock"), state = daemon(socket, { images: new Set<string>(), slow: true })
  const app = fakeApp({ env: SOCKETS(socket) })
  let status = await app.setup.status()
  assert.equal(status.runtime.state, "ready")
  assert.deepEqual(status.runtime.using, { kind: "other", name: "Docker", socket })
  assert.equal(step(status, "runtime").state, "done")
  assert.deepEqual(step(status, "runtime").actions, [], "no second runtime is offered when one answers")
  assert.equal(step(status, "image").state, "todo")
  assert.equal(state.pulls ?? 0, 0, "looking at the checklist pulls nothing")

  await app.setup.act("image", "start")
  await until(async () => (step(await app.setup.status(), "image").job?.percent ?? 0) > 0)
  status = await app.setup.status()
  assert.equal(step(status, "image").state, "running")
  assert.deepEqual(step(status, "image").actions, ["cancel"])
  await assert.rejects(app.setup.act("image", "start"), /already going/)
  status = await app.setup.act("image", "cancel")
  assert.equal(step(status, "image").job?.state, "cancelled")
  assert.equal(step(status, "image").state, "todo")

  state.slow = false
  await app.setup.act("image", "start")
  await until(async () => step(await app.setup.status(), "image").state === "done")
  assert.equal(state.pulls, 2)
  assert.ok(state.images.has(SWARM_IMAGE))
})

test("a pull that fails for lack of network says so; any other failure carries Docker's words", async () => {
  const socket = join(temp(), "d.sock"), state = daemon(socket, { images: new Set<string>(), pullError: "Get \"https://registry-1.docker.io/v2/\": dial tcp: lookup registry-1.docker.io: no such host" })
  const app = fakeApp({ env: SOCKETS(socket) })
  await app.setup.act("image", "start")
  await until(async () => step(await app.setup.status(), "image").state === "failed")
  assert.match(step(await app.setup.status(), "image").job!.error!, /could not reach the internet/)
  state.pullError = "manifest unknown"
  await app.setup.act("bench-image", "start")
  await until(async () => step(await app.setup.status(), "bench-image").state === "failed")
  assert.match(step(await app.setup.status(), "bench-image").job!.error!, /manifest unknown/)
})

test("the benchmark image asks for 30 GB free and is never needed for a swarm run", async () => {
  const socket = join(temp(), "d.sock")
  daemon(socket, { images: new Set([SWARM_IMAGE]) })
  const app = fakeApp({ env: SOCKETS(socket), free: 20 * 1024 ** 3 })
  await assert.rejects(app.setup.act("bench-image", "start"), /needs about 30 GB free, and this Mac has 20 GB/)
  const status = await app.setup.status()
  assert.equal(step(status, "bench-image").needed, "optional")
  assert.equal(step(status, "image").state, "done")
})

test("the dataset step waits for the Python packages, then runs the downloader and checks the files are there", async () => {
  const socket = join(temp(), "d.sock")
  daemon(socket, { images: new Set<string>() })
  const dest = join(temp(), "hub"), stub = join(temp(), "fetch.sh")
  writeFileSync(stub, `#!/bin/sh\nfor last; do :; done\nmkdir -p "$last"; echo '{}' > "$last/BixBench.jsonl"; i=0; while [ $i -lt 64 ]; do echo z > "$last/CapsuleFolder-$i.zip"; i=$((i+1)); done\n`)
  chmodSync(stub, 0o755)
  const app = fakeApp({ env: { ...SOCKETS(socket), ASB_SETUP_DATASET_DIR: dest, ASB_SETUP_DATA_CMD: stub } })
  assert.equal(step(await app.setup.status(), "bench-data").state, "blocked")
  await app.setup.act("python", "start")
  await until(async () => step(await app.setup.status(), "python").state === "done")
  await app.setup.act("bench-data", "start")
  await until(async () => step(await app.setup.status(), "bench-data").state === "done")
  assert.ok(existsSync(join(dest, "BixBench.jsonl")))
})

test("the dataset that is already on this machine counts as done (file names only; the question file is not opened)", { skip: !existsSync(join(REPO, "glhf/data/bixbench_v1/hub/BixBench.jsonl")) && "the dataset is not on this machine" }, async () => {
  const app = fakeApp({ env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1", ASB_SETUP_DATASET_DIR: join(REPO, "glhf/data/bixbench_v1/hub") } })
  assert.equal(step(await app.setup.status(), "bench-data").state, "done", "files that are there are not asked for again, whatever else is missing")
})

test("the built-in runtime: start, use, stop, and start again by itself before a run", { skip: (process.platform !== "darwin" || process.arch !== "arm64") && "the built-in runtime is for Apple Silicon Macs" }, async () => {
  const app = fakeApp({ env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1" } })
  closers.push(() => { spawnSync(join(app.res, "bin/colima"), ["stop"], { env: { ...app.env, COLIMA_HOME: app.vm } }) })
  let status = await app.setup.status()
  assert.equal(status.runtime.bundled.available, true)
  assert.ok(step(status, "runtime").actions.includes("start"))
  await app.setup.act("runtime", "start")
  await until(async () => (await app.setup.status()).runtime.state === "ready")
  await until(() => app.setup.jobs.get("runtime")?.state !== "running") // the socket answers a moment before the start job ends
  status = await app.setup.status()
  assert.equal(status.runtime.using?.kind, "bundled")
  assert.deepEqual(step(status, "runtime").actions, ["stop"])
  const started = readFileSync(join(app.dir, "colima.calls"), "utf8")
  for (const flag of ["--vm-type vz", "--activate=false", "--ssh-config=false", `--mount ${app.data}:w`]) assert.ok(started.includes(flag), `colima start is missing ${flag}`)

  // Everything a run needs: Python and the image.
  await app.setup.act("python", "start")
  await app.setup.act("image", "start")
  await until(async () => (await app.setup.status()).ready.swarm)
  assert.equal((await app.setup.status()).firstRun, false)

  await until(() => app.setup.jobs.get("runtime")?.state !== "running")
  await app.setup.act("runtime", "stop")
  await until(async () => (await app.setup.status()).runtime.state === "stopped")
  await until(() => app.setup.jobs.get("runtime")?.state !== "running") // the stop itself has ended: its step offers buttons again
  status = await app.setup.status()
  assert.equal(status.ready.swarm, true, "a stopped built-in runtime does not send the person back to Set up")
  assert.ok(step(status, "runtime").actions.includes("start"), JSON.stringify([step(status, "runtime"), status.runtime]))

  // The launcher's question before a run: the runtime is started again, nothing is downloaded.
  const result = await app.setup.preflight()
  assert.deepEqual(result, { ok: true, socket: join(app.vm, "default/docker.sock") })
  assert.equal(await app.setup.shutdown(), "stopped the built-in runtime")
  assert.equal((await app.setup.status()).runtime.state, "stopped")
})

test("the built-in runtime that cannot start says why, and Docker Desktop stays on offer", { skip: (process.platform !== "darwin" || process.arch !== "arm64") && "the built-in runtime is for Apple Silicon Macs" }, async () => {
  const app = fakeApp({ env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1", FAKE_COLIMA_FAILS: "1" } })
  await app.setup.act("runtime", "start")
  await until(async () => step(await app.setup.status(), "runtime").state === "failed")
  const failed = step(await app.setup.status(), "runtime")
  assert.match(failed.job!.error!, /could not reach the internet/)
  assert.ok(failed.actions.includes("start") && failed.actions.includes("open-docker-download"))
})

test("an account whose folder path is too long for a socket gets Docker Desktop, with the reason", async () => {
  const app = fakeApp({ env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1", ASB_VM_DIR: `/tmp/${"long-account-name/".repeat(5)}Library/Application Support/asb-vm` } })
  const status = await app.setup.status()
  assert.equal(status.runtime.bundled.available, false)
  if (process.platform === "darwin" && process.arch === "arm64") assert.match(status.runtime.bundled.why!, /too long/)
  assert.deepEqual(step(status, "runtime").actions, ["open-docker-download"])
  await assert.rejects(app.setup.act("runtime", "start"), /Docker Desktop|Apple Silicon/)
})

test("before a run with set-up unfinished: one sentence that names the steps and points to Set up", async () => {
  const app = fakeApp({ env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1" } })
  const result = await app.setup.preflight()
  assert.equal(result.ok, false)
  assert.match((result as { error: string }).error, /Open Set up \(in Settings\)/)
  assert.match((result as { error: string }).error, /“Python packages”, “Container runtime”, “Swarm sandbox image”/)
  assert.match((result as { error: string }).error, /Board practice reviews work without this/)
  assert.deepEqual(app.calls(), [], "the check before a run downloads nothing")
  // As the launcher runs it: the sentence is written as the run's result, where the engine reads it (run.json).
  const out = join(app.dir, "run-1")
  const done = spawnSync(process.execPath, [join(HERE, "../src/setup.ts"), "preflight", "--case", "x", "--out", out], { env: app.env, encoding: "utf8" })
  assert.equal(done.status, 3)
  assert.equal(done.stdout, "")
  const run = JSON.parse(readFileSync(join(out, "run.json"), "utf8")) as { status: string; error: string; finished_at: number }
  assert.equal(run.status, "failed")
  assert.match(run.error, /Open Set up/)
  assert.ok(run.finished_at > 1e9)
})

test("before a run with everything there: the socket to use is printed and nothing is written", async () => {
  const socket = join(temp(), "d.sock")
  daemon(socket, { images: new Set([SWARM_IMAGE]) })
  const app = fakeApp({ env: SOCKETS(socket) })
  await app.setup.act("python", "start")
  await until(async () => (await app.setup.status()).ready.swarm)
  const out = join(app.dir, "run-2")
  const child = spawn(process.execPath, [join(HERE, "../src/setup.ts"), "preflight", "--out", out], { env: app.env })
  let printed = ""
  child.stdout.on("data", (c: Buffer) => { printed += c })
  const code = await new Promise((done) => child.on("close", done))
  assert.equal(code, 0)
  assert.equal(printed.trim(), socket)
  assert.equal(existsSync(join(out, "run.json")), false)
})

test("the routes: reading is open, changing needs the dashboard or the token, and only Docker's own pages can be opened", async () => {
  const app = fakeApp({ env: { ASB_SETUP_IGNORE_SYSTEM_DOCKER: "1" } })
  const trust = { hasToken: (req: { headers: Record<string, unknown> }) => req.headers["x-glhf-token"] === "t", env: {}, tokenFile: "token-file" }
  const server: Server = createServer((req, res) => void app.setup.handler(req, res, new URL(req.url ?? "/", "http://x").pathname.split("/").filter(Boolean), trust as never))
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  closers.push(() => server.close())
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => new Promise<{ status: number; body: Record<string, unknown> }>((done, fail) => {
    const req = request({ host: "127.0.0.1", port: (server.address() as AddressInfo).port, path, method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...headers } }, (res) => {
      let text = ""; res.on("data", (c) => { text += c }); res.on("end", () => done({ status: res.statusCode ?? 0, body: JSON.parse(text || "{}") as Record<string, unknown> }))
    })
    req.on("error", fail); req.end(body === undefined ? undefined : JSON.stringify(body))
  })
  const read = await call("GET", "/api/setup")
  assert.equal(read.status, 200)
  assert.equal(read.body.firstRun, true)
  assert.doesNotMatch(JSON.stringify(read.body), /sk-fake/, "no key value in the checklist")

  assert.equal((await call("POST", "/api/setup/steps/python/start", {}, {})).status, 403, "no Origin and no token")
  assert.equal((await call("POST", "/api/setup/skip", {}, { skipped: true })).status, 403)
  assert.equal((await call("POST", "/api/setup/open", {}, { what: "docker-download" })).status, 403)
  assert.deepEqual(app.calls(), [])
  assert.deepEqual(app.opened, [])

  assert.equal((await call("POST", "/api/setup/open", { origin: DASH }, { what: "https://evil.example" })).status, 400)
  assert.equal((await call("POST", "/api/setup/open", { origin: DASH }, { what: "__proto__" })).status, 400)
  assert.deepEqual(app.opened, [])
  assert.equal((await call("POST", "/api/setup/open", { origin: DASH }, { what: "docker-download" })).status, 200)
  assert.deepEqual(app.opened, [OPENABLE["docker-download"]])
  assert.ok(Object.values(OPENABLE).flat().filter((a) => a.startsWith("http")).every((a) => /^https:\/\/(desktop\.docker\.com|docs\.docker\.com|www\.docker\.com)\//.test(a)))

  assert.equal((await call("POST", "/api/setup/steps/nope/start", { origin: DASH }, {})).status, 404)
  assert.equal((await call("POST", "/api/setup/steps/python/explode", { origin: DASH }, {})).status, 400)
  assert.equal((await call("POST", "/api/setup/steps/image/start", { "x-glhf-token": "t" }, {})).status, 409, "blocked: said with 409, not started")

  const skipped = await call("POST", "/api/setup/skip", { origin: DASH }, { skipped: true })
  assert.equal(skipped.body.skipped, true)
  assert.equal(skipped.body.firstRun, false, "after Skip the app does not open Set up by itself")
  assert.equal((await call("POST", "/api/setup/skip", { origin: DASH }, { skipped: false })).body.firstRun, true)
})

test("the names in this file are the ones the Python side uses", { skip: !existsSync(join(REPO, "glhf/bixbench_v1/src/bixbench_v1/dataset.py")) && "the Python sources are not here" }, () => {
  assert.ok(readFileSync(join(REPO, "glhf/bixbench/sandbox/local-compose.yaml"), "utf8").includes(`\${GLHF_LOCAL_IMAGE:-${SWARM_IMAGE}}`))
  assert.ok(readFileSync(join(REPO, "glhf/bixbench_v1/src/bixbench_v1/task.py"), "utf8").includes(`DEFAULT_IMAGE = "${BENCH_IMAGE}"`))
  const dataset = readFileSync(join(REPO, "glhf/bixbench_v1/src/bixbench_v1/dataset.py"), "utf8")
  assert.ok(dataset.includes(`HF_REPO = "${DATASET.repo}"`) && dataset.includes(`HF_REVISION = "${DATASET.revision}"`))
})

test("words: sizes read as people write them, and network failures are recognised", () => {
  assert.equal(human(44 * 1024 ** 2), "44 MB")
  assert.equal(human(5.7 * 1024 ** 3), "5.7 GB")
  assert.equal(human(18.3 * 1024 ** 3), "18 GB")
  assert.ok(offlineReason("error sending request for url (https://pypi.org/simple/x/)"))
  assert.ok(offlineReason("dial tcp: lookup registry-1.docker.io: no such host"))
  assert.equal(offlineReason("No space left on device"), undefined)
})
