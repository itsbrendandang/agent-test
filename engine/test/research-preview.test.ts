// The preview switch of the research answer: a real (paid) answer is refused with 503 {preview: false} unless the
// engine was started with RESEARCH_PREVIEW=1. Fakes only: fetch throws, keys are fake, the folder is a temp folder.
import assert from "node:assert/strict"
import { mkdtempSync, existsSync, readdirSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const realFetch = globalThis.fetch
const reached: string[] = []
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
  reached.push(url)
  throw new Error(`a test tried to reach ${url}`)
}) as typeof fetch

const { loadConfig } = await import("../src/config.ts")
const { createResearch, PREVIEW_OFF, previewOn } = await import("../src/research/routes.ts")

const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic", OPENAI_API_KEY: "fake-openai", EXA_API_KEY: "fake-exa" }
function engine(env: NodeJS.ProcessEnv, mock: boolean) {
  const base = loadConfig(), dir = mkdtempSync(join(tmpdir(), "research-preview-"))
  const config = { ...base, paths: { ...base.paths, runs: join(dir, "runs") } }
  const research = createResearch({ config, env, hasToken: (req) => req.headers["x-glhf-token"] === "t", mock: () => mock })
  const server = createServer((req, res) => void research.handle(req, res, new URL(req.url ?? "/", "http://x").pathname.split("/").filter(Boolean)))
  return new Promise<{ url: string; research: typeof research; config: typeof config; close: () => void }>((ready) => server.listen(0, "127.0.0.1", () => ready({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, research, config, close: () => server.close() })))
}
const ask = (url: string, headers: Record<string, string> = {}) => fetch(`${url}/api/research`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:5317", ...headers }, body: JSON.stringify({ question: "Does drug X lower blood pressure in adults?", effort: "quick" }) })

test("previewOn is true only for exactly RESEARCH_PREVIEW=1", () => {
  assert.equal(previewOn({}), false)
  for (const off of ["0", "", "true", "yes", "on", "2"]) assert.equal(previewOn({ RESEARCH_PREVIEW: off }), false, off)
  assert.equal(previewOn({ RESEARCH_PREVIEW: "1" }), true)
  assert.equal(previewOn({ RESEARCH_PREVIEW: " 1 " }), true)
})

test("Real mode without RESEARCH_PREVIEW=1: POST is 503 {preview: false}, with or without the token; nothing is created and nothing is reached", async () => {
  const e = await engine({ NO_PAID_CALLS: "0", ...KEYS }, false)
  try {
    for (const headers of [{}, { "x-glhf-token": "t" }] as Record<string, string>[]) {
      const res = await ask(e.url, headers)
      assert.equal(res.status, 503)
      assert.deepEqual(await res.json(), { error: "Direct answers are being built. Use Deep for a team review.", preview: false })
    }
    assert.deepEqual(PREVIEW_OFF, { error: "Direct answers are being built. Use Deep for a team review.", preview: false })
    assert.equal(e.research.inProgress, 0)
    const root = join(e.config.paths.runs, ".research")
    assert.ok(!existsSync(root) || readdirSync(root).length === 0, "no answer folder was created")
    assert.deepEqual(reached, [], "no outside request")
    // The GET routes work as designed.
    assert.equal((await fetch(`${e.url}/api/research/threads`)).status, 200)
    assert.deepEqual(await (await fetch(`${e.url}/api/research`)).json(), { items: [] })
  } finally { e.close() }
})

test("Demo mode needs no preview switch: POST is 202 and the answer is a demo", async () => {
  const e = await engine({ NO_PAID_CALLS: "1" }, true)
  try {
    const res = await ask(e.url)
    assert.equal(res.status, 202)
    const body = await res.json() as { id: string; mode: string }
    assert.equal(body.mode, "demo")
    await e.research.idle()
    const record = await (await fetch(`${e.url}/api/research/${body.id}`)).json() as { status: string; mode: string }
    assert.deepEqual([record.status, record.mode], ["done", "demo"])
    assert.deepEqual(reached, [])
  } finally { e.close() }
})

test("Real mode with RESEARCH_PREVIEW=1 gets past the switch: the dashboard without the token is asked for it (401), not told 503", async () => {
  const e = await engine({ NO_PAID_CALLS: "0", RESEARCH_PREVIEW: "1", ...KEYS }, false)
  try {
    const res = await ask(e.url)
    assert.equal(res.status, 401)
    const body = await res.json() as { needsToken?: boolean; field?: string; preview?: boolean }
    assert.equal(body.needsToken, true)
    assert.equal(body.field, "token")
    assert.equal(body.preview, undefined)
    assert.deepEqual(reached, [])
  } finally { e.close() }
})
