// What this machine has and lacks for GLHF runs. Never prints a key, only whether it is set.
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { LIMITS, modelsFor } from "./types.ts"

export interface Check { name: string; ok: boolean; need: "local" | "cloud" | "optional"; found: string; fix: string }

const sh = (cmd: string, args: string[], timeout = 15_000) =>
  new Promise<{ ok: boolean; out: string }>((done) => {
    execFile(cmd, args, { timeout }, (error, stdout) => done({ ok: !error, out: String(stdout).trim() }))
  })

const hfToken = () => Boolean(process.env.HF_TOKEN) || ["/.cache/huggingface/token", "/.huggingface/token"].some((p) => existsSync(homedir() + p))

export async function tools() {
  const [uv, docker, gcloud] = await Promise.all([sh("uv", ["--version"]), sh("docker", ["info", "--format", "{{.ServerVersion}}"]), sh("gcloud", ["--version"])])
  const project = gcloud.ok ? (await sh("gcloud", ["config", "get-value", "project"])).out.split("\n").pop() ?? "" : ""
  return { uv, docker, gcloud, project: project && project !== "(unset)" ? project : null }
}

export async function statusBody() {
  const t = await tools()
  return {
    tools: { docker: t.docker.ok, uv: t.uv.ok, gcloud: t.gcloud.ok },
    keys: { ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY), OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY), HF_TOKEN: hfToken(), EXA_API_KEY: Boolean(process.env.EXA_API_KEY) },
    project: t.project,
    /** [smallest, largest] per budget, from types.ts. */
    limits: LIMITS,
    /** Model ids the New-run form should offer: "mock", then those whose key is set. */
    models: modelsFor(),
  }
}

export async function doctor(cellrangerDir?: string): Promise<Check[]> {
  const t = await tools()
  const key = (name: string) => (process.env[name] ? "set" : "not set")
  const major = Number(process.versions.node.split(".")[0])
  const checks: Check[] = [
    { name: "Node.js 24+", ok: major >= 24, need: "local", found: process.versions.node, fix: "Install Node.js 24 or newer (brew install node)." },
    { name: "uv", ok: t.uv.ok, need: "local", found: t.uv.out || "not found", fix: "Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh" },
    { name: "Docker running", ok: t.docker.ok, need: "local", found: t.docker.ok ? `Docker ${t.docker.out}` : "not running", fix: "Start Docker Desktop. Local runs use it as the agents' sandbox." },
    { name: "gcloud CLI", ok: t.gcloud.ok, need: "cloud", found: t.gcloud.ok ? "installed" : "not found", fix: "Install the Google Cloud CLI (brew install --cask google-cloud-sdk), then: gcloud auth login" },
    { name: "GCP project", ok: Boolean(t.project), need: "cloud", found: t.project ?? "none selected", fix: "gcloud config set project YOUR_PROJECT (needs billing, Compute Engine API, and quota for an n2-standard-32 VM in us-central1-a)." },
    { name: "OPENAI_API_KEY", ok: Boolean(process.env.OPENAI_API_KEY), need: "cloud", found: key("OPENAI_API_KEY"), fix: "Add OPENAI_API_KEY to .env. Every benchmark run needs it: the benchmark's judge and network gate use GPT-5.5." },
    { name: "ANTHROPIC_API_KEY", ok: Boolean(process.env.ANTHROPIC_API_KEY), need: "optional", found: key("ANTHROPIC_API_KEY"), fix: "Add ANTHROPIC_API_KEY to .env to run Claude models (as the agents, or as one role)." },
    { name: "Hugging Face access", ok: hfToken(), need: "cloud", found: hfToken() ? "token found" : "no token", fix: "Request access to the gated dataset EdisonScientific/BixBench3 on huggingface.co, then add HF_TOKEN to .env (or run: hf auth login)." },
  ]
  if (cellrangerDir !== undefined) {
    for (const file of ["cellranger-6.0.2.tar.gz", "cellranger-arc-2.0.2.tar.gz"]) {
      const ok = existsSync(`${cellrangerDir}/${file}`)
      checks.push({ name: file, ok, need: "cloud", found: ok ? "found" : `not in ${cellrangerDir}`, fix: "Download it from 10x Genomics (accept their licence). The one-time runtime build (bixbench3 setup-runtime) needs both archives." })
    }
  }
  return checks
}
