// Local models (src/local.ts) and how the paid switch treats them (src/paid.ts). Nothing here reaches a real model
// server: fetch is replaced for the whole file by one that fails for every address but this test's own stub, the
// provider keys are fakes, and NO_PAID_CALLS stays on.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { after, test } from "node:test"

process.env.NO_PAID_CALLS = "1"
for (const key of ["LOCAL_MODEL_URL", "OLLAMA_BASE_URL", "LOCAL_MODEL_ALLOW_REMOTE", "DRUG_BOARD_LOCAL_MODEL"]) delete process.env[key]

// A stand-in for Ollama's OpenAI-compatible endpoint, on a loopback port.
const chats: { url: string; auth: string | undefined; body: any }[] = []
const stub = createServer((req, res) => {
  let text = ""
  req.on("data", (chunk) => { text += chunk })
  req.on("end", () => {
    const body = text ? JSON.parse(text) : undefined
    chats.push({ url: req.url ?? "", auth: req.headers.authorization, body })
    res.writeHead(200, { "content-type": body?.stream ? "text/event-stream" : "application/json" })
    const message = { id: "c1", object: "chat.completion.chunk", created: 1, model: body?.model, choices: [{ index: 0, delta: { role: "assistant", content: "hello from the stub" }, finish_reason: null }] }
    const done = { ...message, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 } }
    res.end(`data: ${JSON.stringify(message)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`)
  })
})
await new Promise<void>((ready) => stub.listen(0, "127.0.0.1", ready))
const stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
after(() => { stub.close() })

const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith(stubUrl)) return realFetch(input, init)
  outbound.push(url)
  throw new Error(`a test tried to reach ${url}`)
}) as typeof fetch

// The board in local mode, as `DRUG_BOARD_LOCAL_MODEL=ollama/qwen2.5:14b npm run board` has it. Set before config.ts loads.
process.env.LOCAL_MODEL_URL = stubUrl
process.env.DRUG_BOARD_LOCAL_MODEL = "ollama/qwen2.5:14b"
for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "EXA_API_KEY"]) process.env[key] = "fake-key-for-tests"

const local = await import("../src/local.ts")
const paid = await import("../src/paid/paid.ts")
const config = await import("../src/config.ts")
const { buildModels, modelFor, localModelFor, LOCAL_PROVIDER } = await import("../src/models.ts")
const { modelsFor } = await import("../src/glhf/types.ts")

const LOCAL = "ollama/qwen2.5:14b"
const REAL = "anthropic/claude-sonnet-5-5"
const ON = { NO_PAID_CALLS: "1" }
const LOOKALIKES = ["openai/ollama", "openai/ollama/qwen2.5:14b", "ollama", "ollama/", "Ollama/qwen2.5:14b", "ollama/../openai/gpt-5.5", "ollama/..", "ollama/a/../b",
  "ollama//qwen2.5", "ollama/a/b/c", "ollama/qwen2.5:14b ", " ollama/qwen2.5:14b", "ollama/qwen 2.5", "ollama/qwen2.5:14b\nopenai/gpt-5.5", "ollama/qwen2.5:14b?x=1",
  "ollama/http://example.com/m", "ollama/qwen3-coder:480b-cloud", "ollama/gpt-oss:cloud", "ollama/glm-4.6:CLOUD", "ollama-cloud/qwen", "openrouter/ollama/qwen2.5:14b"]
const LOOPBACK = ["http://127.0.0.1:11434", "http://127.0.0.1:11434/v1", "http://127.0.0.1:11434/v1/", "http://localhost:11434", "http://127.8.9.1:1", "http://[::1]:11434/v1"]
const ELSEWHERE = ["http://192.168.1.20:11434", "http://0.0.0.0:11434", "http://studio.local:11434/v1", "https://api.openai.com/v1", "http://127.0.0.1.example.com:11434",
  "http://localhost.example.com:11434", "http://127.0.0.1@example.com:11434", "http://user:pw@127.0.0.1:11434", "http://127.0.0.1:11434@example.com", "http://[::ffff:8.8.8.8]:11434",
  "ftp://127.0.0.1/", "127.0.0.1:11434", "http://"]

test("a local model is an ollama id on a loopback address, and nothing that looks like one", () => {
  for (const model of [LOCAL, "ollama/qwen3:32b", "ollama/user/model:q4_K_M", "ollama/phi4-mini"]) {
    assert.equal(local.isLocalModel(model, {}), true, model)
    assert.equal(paid.modelSpends(model, ON), false)
  }
  for (const model of LOOKALIKES) {
    assert.equal(local.localName(model), undefined, model)
    assert.equal(local.isLocalModel(model, {}), false, model)
    assert.equal(paid.modelSpends(model, ON), true, model)
    assert.match(paid.paidModelRefusal([model], ON) ?? "", /refused\. Paid calls are off \(NO_PAID_CALLS\)|refused\. Only the scripted/, model)
  }
  for (const url of LOOPBACK) for (const name of ["LOCAL_MODEL_URL", "OLLAMA_BASE_URL"]) assert.equal(local.isLocalModel(LOCAL, { [name]: url }), true, url)
  assert.deepEqual(local.localServer({ OLLAMA_BASE_URL: "http://localhost:9/v1/" }), { url: "http://localhost:9", remote: false, host: "localhost" })
  for (const url of ELSEWHERE) for (const name of ["LOCAL_MODEL_URL", "OLLAMA_BASE_URL"]) {
    assert.equal(local.isLocalModel(LOCAL, { [name]: url }), false, url)
    assert.throws(() => local.localServer({ [name]: url }), local.LocalModelRefused, url)
    assert.equal(paid.modelSpends(LOCAL, { ...ON, [name]: url }), true, url)
    assert.ok(paid.paidModelRefusal([LOCAL], { ...ON, [name]: url }), url)
  }
  // LOCAL_MODEL_URL is the one that counts when both are set.
  assert.equal(local.isLocalModel(LOCAL, { LOCAL_MODEL_URL: "http://10.0.0.5:11434", OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1" }), false)
})

test("a server on another machine needs LOCAL_MODEL_ALLOW_REMOTE=1", () => {
  const remote = { LOCAL_MODEL_URL: "http://100.64.0.7:11434" }
  assert.throws(() => local.localServer(remote), /100\.64\.0\.7.*not this machine.*LOCAL_MODEL_ALLOW_REMOTE=1/)
  for (const value of ["", "0", "true", "yes"]) assert.equal(local.isLocalModel(LOCAL, { ...remote, LOCAL_MODEL_ALLOW_REMOTE: value }), false, value)
  const allowed = { ...remote, LOCAL_MODEL_ALLOW_REMOTE: "1" }
  assert.deepEqual(local.localServer(allowed), { url: "http://100.64.0.7:11434", remote: true, host: "100.64.0.7" })
  assert.equal(local.isLocalModel("ollama/qwen3:cloud", allowed), false, "the setting does not make a cloud model local")
  assert.equal(local.isLocalModel(LOCAL, { LOCAL_MODEL_URL: "ftp://x", LOCAL_MODEL_ALLOW_REMOTE: "1" }), false)
  assert.equal(local.isLocalModel(LOCAL, { LOCAL_MODEL_URL: "http://user:pw@10.0.0.5:11434", LOCAL_MODEL_ALLOW_REMOTE: "1" }), false)
})

test("the paid switch: local and scripted models pass, paid ones and remote look-alikes do not, and the keys stay blank", () => {
  assert.equal(paid.paidModelRefusal(["mock", LOCAL, "ollama/qwen2.5:7b"], ON), undefined)
  assert.match(paid.paidModelRefusal([LOCAL, REAL], ON) ?? "", /a run with a paid model \(anthropic\/claude-sonnet-5-5\): refused.*NO_PAID_CALLS/)
  assert.match(paid.paidModelRefusal(["ollama/../openai/gpt-5.5"], ON) ?? "", /not a local model id.*NO_PAID_CALLS/)
  assert.equal(paid.paidModelRefusal([REAL], { NO_PAID_CALLS: "0" }), undefined, "with paid calls allowed nothing is refused here")
  // Exa, the checkers and the cloud are refused as before, whatever the model.
  assert.throws(() => paid.refusePaid("Exa search (api.exa.ai)", ON), paid.PaidCallsOff)
  const child = paid.childEnv({ ...ON, ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", EXA_API_KEY: "e", PAST_API_KEY: "p", LOCAL_MODEL_URL: "http://127.0.0.1:11434" })
  for (const key of paid.PAID_KEYS) assert.equal(child[key], "", `${key} is blank in a child that runs a local model`)
  assert.equal(child.LOCAL_MODEL_URL, "http://127.0.0.1:11434")
  assert.match(paid.paidCallsLine(ON), /local models/)
})

test("the engine offers only mock while paid calls are off, even with provider keys", () => {
  assert.deepEqual(modelsFor({ ...ON, ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k" }), ["mock"])
})

test("board: with DRUG_BOARD_LOCAL_MODEL every agent is the local model, reached only at the checked address, with no key", async () => {
  assert.equal(config.MOCK, true, "paid calls are off: Exa, the first-pass checker and the escalation checkers stay scripted")
  assert.equal(config.LOCAL, LOCAL)
  const boardConfig = config.loadConfig()
  for (const tier of ["lead", "strong", "cheap", "rival"] as const) {
    assert.deepEqual(modelFor(boardConfig, { name: "x", model: tier } as never), { provider: LOCAL_PROVIDER, modelId: "qwen2.5:14b" })
    assert.equal(localModelFor(boardConfig, tier, LOCAL, { DRUG_BOARD_LOCAL_MODEL: "1" }), boardConfig.local_models?.[tier])
  }
  const models = buildModels([])
  assert.deepEqual(models.getProviders().map((p) => p.id), [LOCAL_PROVIDER], "no Anthropic, no OpenAI: only the local server")
  const model = models.getModel(LOCAL_PROVIDER, "qwen2.5:14b")!
  assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  const answer = await models.complete(model, { systemPrompt: "Be brief.", messages: [{ role: "user", content: "Say hello.", timestamp: 1 }] })
  assert.equal(answer.errorMessage, undefined)
  assert.equal(answer.content.map((c) => c.type === "text" ? c.text : "").join(""), "hello from the stub")
  assert.equal(chats.length, 1)
  assert.equal(chats[0].url, "/v1/chat/completions")
  assert.equal(chats[0].body.model, "qwen2.5:14b")
  assert.equal(chats[0].body.messages[0].role, "system", "Ollama gets a system message, not a developer one")
  assert.equal(chats[0].auth, "Bearer ollama", "the fixed placeholder, never a provider key")
  assert.deepEqual(outbound, [], "nothing went anywhere else")

  // A typo or a remote address must not fall back to scripted or paid models: it is an error.
  assert.throws(() => config.localBoardModel({ DRUG_BOARD_LOCAL_MODEL: "openai/gpt-5.5" }), /not a local model id/)
  assert.throws(() => config.localBoardModel({ DRUG_BOARD_LOCAL_MODEL: "ollama/qwen3:cloud" }), /not a local model id/)
  assert.throws(() => config.localBoardModel({ DRUG_BOARD_LOCAL_MODEL: LOCAL, LOCAL_MODEL_URL: "http://192.168.1.20:11434" }), /not this machine/)
  assert.equal(config.localBoardModel({}), undefined)
  assert.equal(config.localBoardModel({ DRUG_BOARD_LOCAL_MODEL: "1" }, { local_models: { lead: "qwen2.5:7b" } }), "ollama/qwen2.5:7b")
  // The paid path is still refused while the switch is on.
  assert.throws(() => buildModels([], false), paid.PaidCallsOff)
})
