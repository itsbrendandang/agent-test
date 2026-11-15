// Set up: what a swarm run needs on this Mac, what is there, and one guided step for each thing that is missing.
//
//   GET  /api/setup                       the checklist (read: any local caller)
//   POST /api/setup/steps/:id/:action     start | cancel | stop a step (the dashboard's Origin or the token)
//   POST /api/setup/skip {skipped}        remember "not now": the app stops opening the Set up screen by itself
//   POST /api/setup/open {what}           open one of three fixed Docker pages or Docker Desktop itself (never a caller's URL)
//
// The steps: python (the Python packages, with the bundled `uv`), runtime (something that answers the Docker API:
// the built-in Colima virtual machine, or a Docker the person already has), image (the sandbox image of the local
// swarm demo), and two optional ones for the benchmark (its image and its dataset).
//
// Rules this file keeps:
//   - Nothing here can spend: no model is called, no key is read, and the paid switch is not touched. Every
//     process it starts gets childEnv() (keys blank while paid calls are off).
//   - No download starts by itself. Each one is a POST for that step, is refused when the disk is too full, can
//     be cancelled, and continues where it stopped when started again (uv's cache, Docker's layers, the hub's files).
//   - It never installs Docker Desktop and never asks for a password. It opens Docker's own download in the
//     browser and waits for the daemon to answer.
//   - Image names, addresses and commands are constants of this file. A request chooses a step, never a value.
//
// Inside the desktop app (ASB_SETUP=1, set by dashboard/src-tauri/src/engine.rs) the steps act. From a checkout
// they only report, with the words of `npm run doctor` (glhf/doctor.ts): a developer sets up with `npm run setup`.
//
// As a command (the app's swarm launcher, scripts/desktop/asb-swarm-runner, and the app on quit):
//   node setup.ts preflight --out DIR ...   exit 0 and print the Docker socket to use; or write DIR/run.json with a
//                                            sentence that points to the Set up screen, and exit 3
//   node setup.ts shutdown                   stop the built-in runtime when no container is running in it
import { type ChildProcess, execFile, spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from "node:fs"
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http"
import { homedir, release } from "node:os"
import { dirname, resolve } from "node:path"
import { ROOT } from "./config.ts"
import { tools } from "./glhf/doctor.ts"
import { gate, type GateOptions, HttpError, readJson } from "./http.ts"
import { childEnv } from "./paid.ts"

export type StepId = "python" | "runtime" | "image" | "bench-image" | "bench-data"
export const STEP_IDS: StepId[] = ["python", "runtime", "image", "bench-image", "bench-data"]

/** The image the local swarm demo runs in: the default of GLHF_LOCAL_IMAGE in glhf/bixbench/sandbox/local-compose.yaml. */
export const SWARM_IMAGE = "python:3.12-slim"
/** The official BixBench environment (DEFAULT_IMAGE in glhf/bixbench_v1/src/bixbench_v1/task.py). */
export const BENCH_IMAGE = "futurehouse/bixbench:aviary-notebook-env"
/** The public BixBench dataset and the revision the adapter was written against (HF_REPO, HF_REVISION in bixbench_v1/dataset.py). */
export const DATASET = { repo: "futurehouse/BixBench", revision: "f8cc3bdcc6357c88b8c3648306522b9c422dc95a", files: 65 }

const MB = 1024 ** 2, GB = 1024 ** 3
/**
 * Sizes shown before a step starts, and the free disk space each step asks for. Measured on 2026-11-14 on Apple
 * Silicon: the two images from Docker Hub's manifests (compressed layers) and `docker image inspect` (unpacked), the
 * packages from a clean `uv sync`, the virtual machine from a clean `colima start`, the dataset from its folder.
 */
export const SIZES: Record<StepId, { download: number; disk: number; needs: number }> = {
  python: { download: 230 * MB, disk: 520 * MB, needs: 1.5 * GB },
  runtime: { download: 332 * MB, disk: 1.5 * GB, needs: 5 * GB },
  image: { download: 44 * MB, disk: 203 * MB, needs: 1 * GB },
  "bench-image": { download: 5.7 * GB, disk: 18.3 * GB, needs: 30 * GB },
  "bench-data": { download: 5.9 * GB, disk: 5.9 * GB, needs: 8 * GB },
}

/** The three pages and one app that POST /api/setup/open may open. Docker's own addresses, nothing else. */
export const OPENABLE: Record<string, string[]> = {
  "docker-download": ["https://desktop.docker.com/mac/main/arm64/Docker.dmg"],
  "docker-install-guide": ["https://docs.docker.com/desktop/setup/install/mac-install/"],
  "docker-terms": ["https://www.docker.com/legal/docker-subscription-service-agreement/"],
  "docker-app": ["-g", "-a", "Docker"],
}

export interface Job {
  step: StepId
  state: "running" | "done" | "failed" | "cancelled"
  startedAt: number
  endedAt?: number
  /** 0 to 100 when it can be known. */
  percent?: number
  /** What is happening now, in plain words. */
  line: string
  /** Why it failed, in plain words, with what to do. */
  error?: string
}
export interface Step {
  id: StepId
  title: string
  /** "swarm": a swarm run cannot start without it. "optional": only for the benchmark. */
  needed: "swarm" | "optional"
  state: "done" | "todo" | "running" | "failed" | "blocked"
  detail: string
  /** Bytes: what is downloaded, what it takes on disk, and the free space asked for before it starts. */
  size: { download: number; disk: number; needs: number }
  actions: string[]
  job?: Job
}
export interface Runtime {
  state: "ready" | "stopped" | "missing"
  /** The Docker that will be used, when one answers. */
  using?: { kind: "bundled" | "docker-desktop" | "other"; name: string; socket: string }
  /** The built-in runtime (Colima): can it be used here, was it created, is it running. */
  bundled: { available: boolean; why?: string; created: boolean; running: boolean }
  /** Is Docker Desktop installed (it may be closed)? */
  desktopInstalled: boolean
}
export interface Status {
  /** true inside the desktop app: the steps can act. false from a checkout: they only report. */
  app: boolean
  steps: Step[]
  runtime: Runtime
  disk: { free: number; path: string }
  ready: { swarm: boolean; benchmark: boolean }
  skipped: boolean
  /** The app opens the Set up screen by itself when this is true. */
  firstRun: boolean
}

export interface SetupOptions {
  env?: NodeJS.ProcessEnv
  /** Free bytes on the volume of a path. Tests replace it. */
  free?: (path: string) => number
  /** The repository root, as the engine sees it (tests: a temporary folder). */
  root?: string
  /** Open an address or an app with /usr/bin/open. Tests replace it. */
  open?: (args: string[]) => void
}

const exists = (path: string) => { try { return existsSync(path) } catch { return false } }
const read = (path: string) => { try { return readFileSync(path, "utf8").trim() } catch { return undefined } }
export const human = (bytes: number) => (bytes >= GB ? `${(bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1)} GB` : `${Math.round(bytes / MB)} MB`)

/** Does a Docker daemon answer on this socket? (GET /_ping) */
export const ping = (socket: string, timeout = 1500) => new Promise<boolean>((done) => {
  if (!exists(socket)) return done(false)
  const req = httpRequest({ socketPath: socket, path: "/_ping", method: "GET", timeout }, (res) => { res.resume(); done(res.statusCode === 200) })
  req.on("timeout", () => req.destroy()); req.on("error", () => done(false)); req.end()
})

/** One call to the Docker API. Resolves with the status and the body (as text). */
const docker = (socket: string, method: string, path: string, timeout = 8000) => new Promise<{ status: number; body: string }>((done, fail) => {
  const req = httpRequest({ socketPath: socket, path, method, timeout, headers: { host: "docker" } }, (res) => {
    let body = ""
    res.setEncoding("utf8"); res.on("data", (c: string) => { if (body.length < 4 << 20) body += c }); res.on("end", () => done({ status: res.statusCode ?? 0, body }))
  })
  req.on("timeout", () => req.destroy(new Error("the container runtime did not answer in time"))); req.on("error", fail); req.end()
})

/** "name:tag" as the two query values of POST /images/create. */
const splitImage = (image: string) => { const cut = image.lastIndexOf(":"); return cut > image.lastIndexOf("/") ? [image.slice(0, cut), image.slice(cut + 1)] : [image, "latest"] }

/** Words for a failure that is about the network, or undefined. Checked on what uv, Docker and the hub print. */
export function offlineReason(text: string): string | undefined {
  return /dns error|failed to lookup|could not resolve|no such host|network is unreachable|connection refused|error sending request|connecterror|timed out|timeout|temporary failure in name resolution|tls handshake|max retries exceeded|i\/o timeout/i.test(text)
    ? "This Mac could not reach the internet. Connect to the internet and press Try again; what was already downloaded is kept." : undefined
}

export function createSetup(options: SetupOptions = {}) {
  const env = options.env ?? process.env
  const app = env.ASB_SETUP === "1"
  const home = env.HOME || homedir()
  const data = env.ASB_DATA_DIR ? resolve(env.ASB_DATA_DIR) : resolve(options.root ?? ROOT, "glhf/runs/.setup")
  const res = env.ASB_RES_DIR ? resolve(env.ASB_RES_DIR) : ""
  const vm = env.ASB_VM_DIR ? resolve(env.ASB_VM_DIR) : resolve(home, "Library/Application Support/asb-vm")
  const root = options.root ?? (app && env.ASB_DATA_DIR ? resolve(data, "engine-root") : ROOT)
  const sources = resolve(root, "glhf/bixbench"), pythonDir = resolve(data, "python")
  const datasetDir = env.ASB_SETUP_DATASET_DIR ? resolve(env.ASB_SETUP_DATASET_DIR) : resolve(root, "glhf/data/bixbench_v1/hub")
  const swarmImage = env.ASB_SETUP_SWARM_IMAGE || SWARM_IMAGE, benchImage = env.ASB_SETUP_BENCH_IMAGE || BENCH_IMAGE
  const free = options.free ?? ((path: string) => { const s = statfsSync(path); return Number(s.bavail) * Number(s.bsize) })
  const open = options.open ?? ((args: string[]) => { execFile("/usr/bin/open", args, () => {}) })
  const stateFile = resolve(data, "setup/state.json")
  const bundledSocket = resolve(vm, "default/docker.sock")
  const jobs = new Map<StepId, Job & { cancel?: () => void }>()

  const saved = (): { skipped?: boolean } => { try { return JSON.parse(readFileSync(stateFile, "utf8")) as { skipped?: boolean } } catch { return {} } }
  const save = (state: { skipped?: boolean }) => { mkdirSync(dirname(stateFile), { recursive: true }); writeFileSync(stateFile, JSON.stringify(state)) }

  /** The environment of a tool this file starts: the engine's, keys blanked (childEnv), plus where the tool keeps its files. */
  const toolEnv = (extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => {
    const out: NodeJS.ProcessEnv = { ...childEnv(env), COLIMA_HOME: vm, LIMA_HOME: resolve(vm, "_lima"), DOCKER_CONFIG: env.DOCKER_CONFIG ?? resolve(data, "docker"), HF_HOME: resolve(pythonDir, "hf"), HF_HUB_DISABLE_TELEMETRY: "1", ...extra }
    for (const [key, value] of Object.entries(out)) if (value === undefined) delete out[key]
    return out
  }

  // ---- the container runtime -------------------------------------------------------------------------------

  /** Sockets a Docker daemon may answer on, in the order they are tried. The built-in one first. */
  const candidates = (): NonNullable<Runtime["using"]>[] => {
    const list: NonNullable<Runtime["using"]>[] = [{ kind: "bundled", name: "the built-in runtime", socket: bundledSocket }]
    if (env.ASB_SETUP_IGNORE_SYSTEM_DOCKER === "1") return list // verification: behave as on a Mac with no Docker
    for (const socket of (env.ASB_SETUP_DOCKER_SOCKETS ?? "").split(":").filter(Boolean)) list.push({ kind: "other", name: "Docker", socket })
    if (!app && env.DOCKER_HOST?.startsWith("unix://")) list.push({ kind: "other", name: "Docker (DOCKER_HOST)", socket: env.DOCKER_HOST.slice(7) })
    list.push({ kind: "docker-desktop", name: "Docker Desktop", socket: resolve(home, ".docker/run/docker.sock") })
    list.push({ kind: "other", name: "Docker", socket: "/var/run/docker.sock" })
    list.push({ kind: "other", name: "OrbStack", socket: resolve(home, ".orbstack/run/docker.sock") })
    list.push({ kind: "other", name: "Colima", socket: resolve(home, ".colima/default/docker.sock") })
    list.push({ kind: "other", name: "Rancher Desktop", socket: resolve(home, ".rd/docker.sock") })
    return list
  }

  /** Can the built-in runtime be used on this Mac? It needs Apple Silicon, macOS 13 and socket paths under 104 characters. */
  function bundledAvailable(): { available: boolean; why?: string } {
    if (!app || !res || !exists(resolve(res, "bin/colima")) || !exists(resolve(res, "bin/limactl"))) return { available: false, why: "The built-in runtime is not part of this copy of the app." }
    if (process.platform !== "darwin" || process.arch !== "arm64") return { available: false, why: "The built-in runtime needs a Mac with Apple Silicon." }
    if (Number(release().split(".")[0]) < 22) return { available: false, why: "The built-in runtime needs macOS 13 or newer." }
    // Lima and Docker talk over Unix sockets, and macOS allows 103 characters for such a path.
    const longest = Math.max(resolve(vm, "_lima/colima/ssh.sock.1234567890123456").length, bundledSocket.length)
    if (longest > 103) return { available: false, why: "The built-in runtime cannot be used with this account: the path of its folder is too long. Use Docker Desktop instead." }
    return { available: true }
  }

  async function runtime(): Promise<Runtime> {
    const list = candidates()
    const up = await Promise.all(list.map((c) => ping(c.socket)))
    const using = list.find((_, i) => up[i])
    const created = exists(resolve(vm, "_lima/colima/lima.yaml"))
    const bundled = { ...bundledAvailable(), created, running: up[0] }
    // The engine's own commands (`docker info` in glhf/doctor.ts, the local runner) follow the choice made here.
    if (app && env === process.env) { if (using) process.env.DOCKER_HOST = `unix://${using.socket}`; else delete process.env.DOCKER_HOST }
    return { state: using ? "ready" : created ? "stopped" : "missing", using, bundled, desktopInstalled: exists("/Applications/Docker.app") }
  }

  const hasImage = async (socket: string, image: string) => { try { return (await docker(socket, "GET", `/images/${image}/json`)).status === 200 } catch { return false } }
  const containers = async (socket: string) => { try { const r = await docker(socket, "GET", "/containers/json"); return r.status === 200 ? (JSON.parse(r.body) as unknown[]).length : 0 } catch { return 0 } }

  // ---- the Python packages ---------------------------------------------------------------------------------

  /** The bundle's stamp of the Python sources (written by scripts/desktop/build.sh): a new app brings a new one. */
  const bundleStamp = () => (res ? read(resolve(res, "python/STAMP")) : undefined)
  const pythonReady = () => {
    const stamp = bundleStamp()
    return Boolean(stamp) && read(resolve(sources, "STAMP")) === stamp && read(resolve(pythonDir, ".synced")) === stamp && exists(resolve(pythonDir, "venv/bin/python"))
  }
  const datasetReady = () => {
    try { const names = readdirSync(datasetDir); return names.includes("BixBench.jsonl") && names.filter((n) => n.endsWith(".zip")).length >= DATASET.files - 1 } catch { return false }
  }
  const diskUsed = (path: string) => new Promise<number>((done) => { execFile("/usr/bin/du", ["-sk", path], { timeout: 20_000 }, (_e, out) => done((Number(String(out).split(/\s/)[0]) || 0) * 1024)) })

  // ---- jobs ------------------------------------------------------------------------------------------------

  const begin = (step: StepId, line: string): Job & { cancel?: () => void } => {
    const job: Job & { cancel?: () => void } = { step, state: "running", startedAt: Date.now(), line }
    jobs.set(step, job)
    return job
  }
  const end = (job: Job, state: Job["state"], error?: string) => {
    if (job.state !== "running") return
    job.state = state; job.endedAt = Date.now()
    if (state === "done") job.percent = 100
    if (error) job.error = error
  }

  /**
   * Run a tool as a job. Its last line of output is the job's line (`say` may put it in plainer words). Cancel
   * stops the tool and what it started (it has its own process group).
   */
  function run(job: Job & { cancel?: () => void }, command: string, args: string[], spawnOptions: { cwd?: string; env: NodeJS.ProcessEnv }, say?: (line: string) => { line?: string; percent?: number } | undefined): Promise<{ code: number | null; text: string }> {
    return new Promise((done) => {
      let child: ChildProcess, text = "", cancelled = false
      try { child = spawn(command, args, { ...spawnOptions, detached: true, stdio: ["ignore", "pipe", "pipe"] }) }
      catch (error) { return done({ code: null, text: String(error instanceof Error ? error.message : error) }) }
      const onText = (chunk: Buffer) => {
        const piece = chunk.toString("utf8")
        text = (text + piece).slice(-16_000)
        for (const raw of piece.split(/[\r\n]+/)) {
          const line = raw.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trim()
          if (!line) continue
          const said = say ? say(line) : { line }
          if (said?.line) job.line = said.line.slice(0, 300)
          if (said?.percent !== undefined) job.percent = Math.max(job.percent ?? 0, said.percent)
        }
      }
      child.stdout?.on("data", onText); child.stderr?.on("data", onText)
      job.cancel = () => { cancelled = true; try { if (child.pid) process.kill(-child.pid, "SIGTERM") } catch { /* already gone */ } }
      child.on("error", (error) => done({ code: null, text: `${text}\n${error.message}` }))
      child.on("close", (code) => done({ code: cancelled ? null : code, text: cancelled ? "cancelled" : text }))
    })
  }

  const failure = (what: string, text: string) => offlineReason(text) ?? `${what} The last thing the tool said: ${text.trim().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400) || "nothing"}`

  /** Step 1: copy the Python sources out of the app (it is read-only), then `uv sync` into the data folder. */
  async function startPython() {
    const job = begin("python", "Copying the analysis programs out of the app…")
    const stamp = bundleStamp()
    try {
      for (const name of ["bixbench", "demo_case"]) {
        const from = resolve(res, "python", name), to = resolve(root, "glhf", name)
        if (name === "bixbench") for (const old of ["src", "sandbox", "STAMP"]) rmSync(resolve(to, old), { recursive: true, force: true }) // a newer app replaces them
        cpSync(from, to, { recursive: true, force: true })
      }
    } catch (error) { return end(job, "failed", `The analysis programs could not be copied out of the app (${error instanceof Error ? error.message : error}). Download the app again.`) }
    job.line = "Downloading Python and the packages…"
    const watch = setInterval(() => { void diskUsed(pythonDir).then((used) => { if (job.state === "running") job.percent = Math.max(job.percent ?? 0, Math.min(95, Math.round((used / (900 * MB)) * 100))) }) }, 2000)
    // The engine's own `uv run` never downloads (UV_OFFLINE, UV_NO_SYNC in its environment). This one call may.
    const { code, text } = await run(job, "uv", ["sync", "--frozen", "--no-dev"], { cwd: sources, env: toolEnv({ UV_OFFLINE: undefined, UV_NO_SYNC: undefined }) }, (line) => ({ line: /^(Downloading|Downloaded|Building|Built|Installed|Prepared|Using|Creating)/.test(line) ? line : undefined }))
    clearInterval(watch)
    if (text === "cancelled") return end(job, "cancelled")
    if (code !== 0) return end(job, "failed", failure("The Python packages could not be installed.", text))
    writeFileSync(resolve(sources, "STAMP"), `${stamp}\n`); writeFileSync(resolve(pythonDir, ".synced"), `${stamp}\n`)
    job.line = "The Python packages are installed."
    end(job, "done")
  }

  const COLIMA_START = ["start", "--vm-type", "vz", "--mount-type", "virtiofs", "--cpus", "2", "--memory", "2", "--disk", "60", "--runtime", "docker", "--activate=false", "--ssh-config=false", "--binfmt=false"]
  /** What Colima's log lines mean, for the person watching. */
  const colimaSays = (line: string) => {
    const stages: [RegExp, string, number][] = [
      [/downloading disk image/i, `Downloading the small Linux system the runtime uses (about ${human(SIZES.runtime.download)}, once)…`, 10],
      [/Starting the instance|creating and starting|starting \.\.\..*context=vm/i, "Starting the virtual machine…", 45],
      [/SSH connection/i, "Waiting for the virtual machine to answer…", 60],
      [/Boot scripts/i, "Finishing its first start…", 75],
      [/provisioning/i, "Preparing Docker inside it…", 85],
      [/context=docker/i, "Starting Docker inside it…", 92],
    ]
    const hit = stages.find(([pattern]) => pattern.test(line))
    return hit ? { line: hit[1], percent: hit[2] } : undefined
  }

  /** Step 2 (built-in): start the Colima virtual machine. Only the app's data folder is shared with it. */
  async function startRuntime(job = begin("runtime", "Starting the built-in runtime…")) {
    mkdirSync(vm, { recursive: true })
    const { code, text } = await run(job, "colima", [...COLIMA_START, "--mount", `${data}:w`], { env: toolEnv() }, colimaSays)
    if (text === "cancelled") { execFile("colima", ["stop", "--force"], { env: toolEnv(), timeout: 60_000 }, () => {}); return end(job, "cancelled") }
    if (code !== 0 || !(await ping(bundledSocket, 5000))) return end(job, "failed", failure("The built-in runtime did not start.", text))
    job.line = "The built-in runtime is running."
    end(job, "done")
  }

  async function stopRuntime() {
    const job = begin("runtime", "Stopping the built-in runtime…")
    const { code, text } = await run(job, "colima", ["stop"], { env: toolEnv() })
    if (code !== 0) return end(job, "failed", failure("The built-in runtime did not stop.", text))
    job.line = "The built-in runtime is stopped."
    end(job, "done")
  }

  /** Steps 3 and 4: pull an image through the Docker API, which reports bytes per layer. Cancel closes the request. */
  function pull(step: StepId, image: string, socket: string): Promise<void> {
    const job = begin(step, `Asking for ${image}…`)
    const [name, tag] = splitImage(image)
    return new Promise<void>((done) => {
      const layers = new Map<string, { current: number; total: number }>()
      let failed: string | undefined, buffer = ""
      const finish = async (problem?: string) => {
        if (job.state !== "running") return done()
        if (!problem && !(await hasImage(socket, image))) problem = "the download ended, but the image is not there"
        if (problem) end(job, "failed", offlineReason(problem) ?? `The image could not be downloaded: ${problem.slice(0, 300)}. Press Try again; the parts already downloaded are kept.`)
        else { job.line = `${image} is downloaded.`; end(job, "done") }
        done()
      }
      const req = httpRequest({ socketPath: socket, method: "POST", path: `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`, headers: { host: "docker" } }, (response) => {
        if (response.statusCode !== 200) { let body = ""; response.on("data", (c) => { body += c }); response.on("end", () => void finish(body || `the runtime answered ${response.statusCode}`)); return }
        response.setEncoding("utf8")
        response.on("data", (chunk: string) => {
          buffer += chunk
          const lines = buffer.split("\n"); buffer = lines.pop() ?? ""
          for (const line of lines) {
            let event: { status?: string; id?: string; error?: string; progressDetail?: { current?: number; total?: number } }
            try { event = JSON.parse(line) } catch { continue }
            if (event.error) failed = event.error
            if (event.id && event.status) {
              const layer = layers.get(event.id) ?? { current: 0, total: 0 }
              if (event.status === "Downloading" && event.progressDetail?.total) { layer.current = event.progressDetail.current ?? 0; layer.total = event.progressDetail.total }
              if (/^(Download complete|Pull complete|Already exists)$/.test(event.status)) layer.current = layer.total
              layers.set(event.id, layer)
            }
            let got = 0, total = 0
            for (const layer of layers.values()) { got += layer.current; total += layer.total }
            const expected = Math.max(total, SIZES[step].download * 0.9)
            if (total) job.percent = Math.max(job.percent ?? 0, Math.min(99, Math.round((got / expected) * 100)))
            job.line = total ? `Downloading ${image}: ${human(got)} of about ${human(expected)}` : (event.status ?? job.line).slice(0, 200)
          }
        })
        response.on("end", () => void finish(failed))
        response.on("error", (error) => void finish(error.message))
      })
      req.on("error", (error) => void finish(job.state === "running" ? error.message : undefined))
      job.cancel = () => { end(job, "cancelled"); req.destroy() }
      req.end()
    })
  }

  /** Step 5: the dataset, with the hub's own client from the packages of step 1. It skips files that are complete. */
  async function startDataset() {
    const job = begin("bench-data", "Downloading the BixBench dataset…")
    mkdirSync(datasetDir, { recursive: true })
    const watch = setInterval(() => { void diskUsed(datasetDir).then((used) => { if (job.state === "running") { job.percent = Math.min(99, Math.round((used / SIZES["bench-data"].disk) * 100)); job.line = `Downloading the BixBench dataset: ${human(used)} of about ${human(SIZES["bench-data"].disk)}` } }) }, 2000)
    const code = `from huggingface_hub import snapshot_download\nsnapshot_download(repo_id=${JSON.stringify(DATASET.repo)}, repo_type="dataset", revision=${JSON.stringify(DATASET.revision)}, local_dir=${JSON.stringify(datasetDir)}, allow_patterns=["BixBench.jsonl", "*.zip"])\nprint("complete")`
    // ASB_SETUP_DATA_CMD replaces the downloader (tests use a stub script); it gets the folder as its last argument.
    const argv = env.ASB_SETUP_DATA_CMD ? [...env.ASB_SETUP_DATA_CMD.split(/\s+/).filter(Boolean), datasetDir] : ["uv", "run", "python", "-c", code]
    const { code: status, text } = await run(job, argv[0], argv.slice(1), { cwd: exists(sources) ? sources : undefined, env: toolEnv({ UV_OFFLINE: undefined }) }, () => undefined)
    clearInterval(watch)
    if (text === "cancelled") return end(job, "cancelled")
    if (status !== 0 || !datasetReady()) return end(job, "failed", failure("The dataset could not be downloaded.", status === 0 ? "the download ended, but files are missing" : text))
    job.line = "The BixBench dataset is downloaded."
    end(job, "done")
  }

  // ---- the checklist ---------------------------------------------------------------------------------------

  async function status(): Promise<Status> {
    const rt = await runtime()
    const socket = rt.using?.socket
    const [swarm, bench] = socket ? await Promise.all([hasImage(socket, swarmImage), hasImage(socket, benchImage)]) : [false, false]
    const dev = app ? undefined : await tools()
    const python = app ? pythonReady() : Boolean(dev?.uv.ok) && exists(resolve(sources, ".venv"))
    const dataset = datasetReady()
    const diskPath = exists(data) ? data : home
    let freeBytes = 0
    try { freeBytes = free(diskPath) } catch { /* unknown: shown as 0 */ }
    const view = (id: StepId, title: string, needed: Step["needed"], done: boolean, detail: string, actions: string[], blocked?: string): Step => {
      const job = jobs.get(id), running = job?.state === "running"
      const shown = job ? { step: job.step, state: job.state, startedAt: job.startedAt, endedAt: job.endedAt, percent: job.percent, line: job.line, error: job.error } : undefined
      const state: Step["state"] = running ? "running" : done ? "done" : blocked ? "blocked" : job?.state === "failed" ? "failed" : "todo"
      return { id, title, needed, state, detail: state === "blocked" ? blocked! : detail, size: SIZES[id], actions: !app ? [] : running ? ["cancel"] : state === "blocked" ? [] : actions, ...(shown && { job: shown }) }
    }
    const noRuntime = "Do the step “Container runtime” first."
    const runtimeDetail = rt.using ? `Using ${rt.using.name}.${rt.using.kind !== "bundled" && rt.bundled.created ? " The built-in runtime is stopped." : ""}`
      : rt.state === "stopped" ? "The built-in runtime is set up and stopped. It starts by itself when a swarm run starts."
      : app ? "Nothing on this Mac answers as Docker yet." : (dev?.docker.ok ? "Docker answers." : "Start Docker Desktop. Local runs use it as the agents' sandbox.")
    const runtimeActions = rt.using?.kind === "bundled" ? ["stop"] : rt.using ? [] : [...(rt.bundled.available ? ["start"] : []), ...(rt.desktopInstalled ? ["open-docker-app"] : []), "open-docker-download"]
    const steps: Step[] = [
      view("python", "Python packages", "swarm", python, python ? "Installed." : app ? `Python and the packages the swarm is written in. Downloads about ${human(SIZES.python.download)}.` : "Run `npm run setup` (it runs uv sync in glhf/bixbench).", python ? [] : ["start"]),
      view("runtime", "Container runtime", "swarm", rt.state !== "missing", runtimeDetail, runtimeActions),
      view("image", "Swarm sandbox image", "swarm", swarm, swarm ? `${swarmImage} is there.` : `${swarmImage}: the sealed box each swarm run works in. Downloads about ${human(SIZES.image.download)}.`, swarm ? [] : ["start"], socket ? undefined : rt.state === "stopped" ? "Start the container runtime first." : noRuntime),
      view("bench-image", "Benchmark environment (optional)", "optional", bench, bench ? `${benchImage} is there.` : `${benchImage}: the official BixBench environment. Downloads about ${human(SIZES["bench-image"].download)} and takes ${human(SIZES["bench-image"].disk)} on disk.`, bench ? [] : ["start"], socket ? undefined : rt.state === "stopped" ? "Start the container runtime first." : noRuntime),
      view("bench-data", "Benchmark dataset (optional)", "optional", dataset, dataset ? "The BixBench v1 dataset is there." : `The public BixBench v1 dataset. Downloads about ${human(SIZES["bench-data"].download)}.`, dataset ? [] : ["start"], app && !python ? "Do the step “Python packages” first." : undefined),
    ]
    // The built-in runtime starts by itself for a run once it has been set up, so "stopped" does not block a run.
    const ready = { swarm: python && rt.state !== "missing" && (swarm || (rt.state === "stopped" && read(resolve(data, "setup/image-ok")) === swarmImage)), benchmark: bench && dataset }
    if (swarm && app) { try { mkdirSync(resolve(data, "setup"), { recursive: true }); writeFileSync(resolve(data, "setup/image-ok"), swarmImage) } catch { /* only a hint for the stopped case */ } }
    const skipped = saved().skipped === true
    return { app, steps, runtime: rt, disk: { free: freeBytes, path: diskPath }, ready, skipped, firstRun: app && !skipped && !ready.swarm }
  }

  /** Start, cancel or stop a step. Throws HttpError with the sentence to show. */
  async function act(id: StepId, action: string): Promise<Status> {
    if (!app) throw new HttpError(409, "The set-up steps act inside the desktop app. From a checkout, use `npm run setup` and `npm run doctor`.")
    const job = jobs.get(id)
    if (action === "cancel") { if (job?.state === "running") job.cancel?.(); await new Promise((r) => setTimeout(r, 150)); return status() }
    if (job?.state === "running") throw new HttpError(409, "This step is already going.")
    const now = await status(), step = now.steps.find((s) => s.id === id)!
    if (action === "stop" && id === "runtime") {
      if (now.runtime.using?.kind !== "bundled") throw new HttpError(409, "The built-in runtime is not running.")
      if (await containers(bundledSocket)) throw new HttpError(409, "A run is using the built-in runtime. Wait for it to finish, or cancel it, then stop the runtime.")
      void stopRuntime()
      return status()
    }
    if (action !== "start") throw new HttpError(400, "unknown action")
    if (step.state === "done" && id !== "runtime") return now
    if (step.state === "blocked") throw new HttpError(409, step.detail)
    if (id === "runtime") {
      if (now.runtime.using) return now
      if (!now.runtime.bundled.available) throw new HttpError(409, now.runtime.bundled.why ?? "The built-in runtime cannot be used here.")
    }
    // A warm start of a machine that exists downloads nothing: only a first start is weighed against the disk.
    const needs = id === "runtime" && now.runtime.bundled.created ? 0 : SIZES[id].needs
    if (now.disk.free < needs) throw new HttpError(507, `Not enough free disk space for this step: it needs about ${human(needs)} free, and this Mac has ${human(now.disk.free)}. Free some space, then try again.`)
    const socket = now.runtime.using?.socket
    if (id === "python") void startPython()
    else if (id === "runtime") void startRuntime()
    else if (id === "image") void pull("image", swarmImage, socket!)
    else if (id === "bench-image") void pull("bench-image", benchImage, socket!)
    else void startDataset()
    return status()
  }

  /**
   * Before a swarm run (the launcher calls this): is everything there? The built-in runtime is started when it was
   * set up and is stopped. Nothing is downloaded here. Returns the socket to use, or the sentence for the person.
   */
  async function preflight(): Promise<{ ok: true; socket: string } | { ok: false; error: string }> {
    let now = await status()
    if (now.runtime.state === "stopped" && now.runtime.bundled.available && now.steps[0].state === "done") {
      await startRuntime()
      now = await status()
    }
    const missing = now.steps.filter((s) => s.needed === "swarm" && s.state !== "done").map((s) => `“${s.title}”`)
    if (!missing.length && now.runtime.using) return { ok: true, socket: now.runtime.using.socket }
    const failed = jobs.get("runtime")?.error
    return { ok: false, error: `Swarm runs are not set up on this Mac yet. Open Set up (in Settings) and finish ${missing.length === 1 ? "the step" : "the steps"} ${missing.join(", ") || "“Container runtime”"}; each one has a button.${failed ? ` ${failed}` : ""} Board practice reviews work without this.` }
  }

  /** On quit: stop the built-in runtime unless a container (a run) is still using it. */
  async function shutdown(): Promise<string> {
    if (!(await ping(bundledSocket))) return "the built-in runtime is not running"
    if (await containers(bundledSocket)) return "left running: a container is using it"
    const job = begin("runtime", "stopping")
    const { code } = await run(job, "colima", ["stop"], { env: toolEnv() })
    return code === 0 ? "stopped the built-in runtime" : "could not stop the built-in runtime"
  }

  async function handler(req: IncomingMessage, response: ServerResponse, parts: string[], trust: GateOptions): Promise<void> {
    const json = (code: number, body: unknown) => { response.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)) }
    try {
      if (parts.length === 2 && req.method === "GET") return json(200, await status())
      if (req.method !== "POST") return json(404, { error: "not found" })
      // Everything below changes something on this machine. None of it can spend, so the rule is the one for a
      // scripted run (http.ts): the dashboard's page or a token holder.
      if (!gate(req, response, "scripted", "changing the set-up", trust)) return
      const body = await readJson<{ skipped?: unknown; what?: unknown }>(req)
      if (parts[2] === "skip" && parts.length === 3) { save({ ...saved(), skipped: body.skipped !== false }); return json(200, await status()) }
      if (parts[2] === "open" && parts.length === 3) {
        const args = typeof body.what === "string" && Object.hasOwn(OPENABLE, body.what) ? OPENABLE[body.what] : undefined
        if (!args) throw new HttpError(400, `name what to open: ${Object.keys(OPENABLE).join(", ")}`)
        open(args)
        return json(200, { opened: body.what })
      }
      if (parts[2] === "steps" && parts.length === 5 && (STEP_IDS as string[]).includes(parts[3])) return json(200, await act(parts[3] as StepId, parts[4]))
      json(404, { error: "not found" })
    } catch (error) {
      if (response.headersSent) return void response.end()
      json(error instanceof HttpError ? error.status : 500, { error: String(error instanceof Error ? error.message : error) })
    }
  }

  return { status, act, preflight, shutdown, handler, jobs, paths: { data, root, vm, sources, pythonDir, datasetDir, bundledSocket } }
}

let shared: ReturnType<typeof createSetup> | undefined
/** The route handler app.ts calls for /api/setup/*. */
export function handleSetup(req: IncomingMessage, res: ServerResponse, parts: string[], trust: GateOptions): Promise<void> {
  shared ??= createSetup()
  return shared.handler(req, res, parts, trust)
}

// ---- as a command ------------------------------------------------------------------------------------------
if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2)
  const setup = createSetup()
  if (command === "preflight") {
    const result = await setup.preflight()
    if (result.ok) { process.stdout.write(`${result.socket}\n`); process.exit(0) }
    const out = args[args.indexOf("--out") + 1]
    // The engine reads run.json as the runner's last word (glhf/task.ts readLocal): the sentence becomes the run's error.
    if (args.includes("--out") && out) { try { mkdirSync(out, { recursive: true }); writeFileSync(resolve(out, "run.json"), JSON.stringify({ status: "failed", error: result.error, finished_at: Date.now() / 1000 })) } catch { /* the engine then reports the exit status */ } }
    process.stderr.write(`${result.error}\n`)
    process.exit(3)
  } else if (command === "shutdown") {
    process.stdout.write(`${await setup.shutdown()}\n`)
    process.exit(0)
  } else {
    process.stderr.write("usage: node setup.ts preflight --out DIR ... | shutdown\n")
    process.exit(2)
  }
}
