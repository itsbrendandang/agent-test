// A research-answer engine for tests: the real routes, pipeline and Pi Durable sessions, with every outside thing faked.
//   models   pi-ai's faux providers under the real ids (anthropic: haiku and sonnet; openai: gpt-4o-mini and gpt-5-mini);
//            each call is answered by a function chosen from the call's system prompt, and is recorded
//   network  globalThis.fetch is replaced: Exa and Europe PMC are answered from tables, OpenAlex, Semantic Scholar and
//            arXiv find nothing, anything else throws
//   folder   a temp folder for runs (so the Exa ledger and every answer live there), never board/runs
// Nothing here can reach a vendor: keys are fake words and the only fetch is the fake.
import { mkdtempSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createModels, fauxAssistantMessage, fauxProvider, type Models } from "@earendil-works/pi-ai"
import { type BoardConfig, loadConfig } from "../../../src/config.ts"
import { mockRulings } from "../../../src/board/triage.ts"
import { createResearch, type ResearchDeps } from "../../../src/research/routes.ts"
import type { ResearchRecord, Stamped } from "../../../src/research/types.ts"

export const ORIGIN = "http://127.0.0.1:5317"
export const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic-key-0001", OPENAI_API_KEY: "fake-openai-key-0002", EXA_API_KEY: "fake-exa-key-0003" }
export const EUROPEPMC = JSON.parse(readFileSync(join(import.meta.dirname, "europepmc-semaglutide.json"), "utf8")) as { resultList: { result: Record<string, unknown>[] } }

// ── The fake network ─────────────────────────────────────────────────────────────────────────────

export interface Net {
  /** Every request that left the process (never to a real host): where, and its JSON body when it had one. */
  requests: { url: string; method: string; body?: Record<string, unknown>; headers: Record<string, string> }[]
  /** One answer per Exa search, in order; the last one repeats. A function gets the request body. */
  exa: ((body: Record<string, unknown>) => Response | Promise<Response>)[]
  /** The answer of Europe PMC for a query. */
  europepmc: (query: string) => Response | Promise<Response>
}
export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

export const EXA_RESULTS = [
  { url: "https://www.example-cardiology.org/select-trial-summary", title: "SELECT trial: semaglutide and cardiovascular outcomes", highlights: ["In SELECT, 17,604 adults with overweight or obesity and established cardiovascular disease but no diabetes were randomized to semaglutide 2.4 mg or placebo.", "A primary cardiovascular end-point event occurred in 6.5% of the semaglutide group and 8.0% of the placebo group (hazard ratio 0.80)."] },
  { url: "https://www.example-news.com/weight-loss-drugs-market", title: "Weight-loss drug makers see record sales", highlights: ["Shares of obesity drug makers rose this quarter as demand outpaced supply. Analysts expect the market to keep growing."] },
  { url: "https://www.example-health.org/empty-page", title: "A page with no text", highlights: [] },
]

const realFetch = globalThis.fetch
let net: Net | undefined
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
  if (!net) throw new Error(`a test tried to reach ${url}`)
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
  net.requests.push({ url, method: init?.method ?? "GET", body, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) })
  if (url === "https://api.exa.ai/search") {
    const n = net.requests.filter((r) => r.url === url).length
    return (net.exa[Math.min(n, net.exa.length) - 1])(body ?? {})
  }
  if (url.startsWith("https://www.ebi.ac.uk/europepmc/webservices/rest/search?")) return net.europepmc(new URL(url).searchParams.get("query") ?? "")
  // The other free literature indexes (scholarly.ts) find nothing here, so every answer's papers are Europe PMC's.
  if (url.startsWith("https://api.openalex.org/works?")) return jsonResponse({ results: [] })
  if (url.startsWith("https://api.semanticscholar.org/graph/v1/paper/search?")) return jsonResponse({ data: [] })
  if (url.startsWith("https://export.arxiv.org/api/query?")) return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', { status: 200 })
  throw new Error(`a test tried to reach ${url}`)
}) as typeof fetch

// ── The fake models ──────────────────────────────────────────────────────────────────────────────

export type Role = "plan" | "hypothesize" | "screen" | "check" | "stance" | "write" | "section" | "specialist" | "critic" | "revise" | "rejudge"
export interface Call { role: Role; provider: string; model: string; system: string; user: string; options: { maxTokens?: number; reasoning?: string; signal?: AbortSignal } }
/** What a fake model answers: text, or `{error}` for a call the vendor fails (the text is the vendor's message). */
export type Reply = string | { error: string }
export type Script = Partial<Record<Role, (call: Call, n: number) => Reply | Promise<Reply>>>

const roleOf = (system: string): Role =>
  system.startsWith("You plan the searches") ? "plan"
    : system.startsWith("You set up the hypotheses") ? "hypothesize"
    : system.startsWith("You are given hypotheses and numbered statements") ? "stance"
    : system.startsWith("You screen search results") ? "screen"
      : system.startsWith("You check claims against one piece of source text") ? "check"
        : system.includes("# Your task now") ? "rejudge"
          : system.includes("# Your task here") ? "critic"
          : system.includes("# The revision") ? "revise"
            : system.includes("# You are the investigator of one hypothesis") ? "section"
              : system.includes("# You are a method specialist added to this answer") ? "specialist" : "write"

const unescape = (text: string) => text.replaceAll("&lt;", "<")
/** The numbered sources a writer, reviser or critic was given, read back from the evidence block of its prompt. */
export function sourcesIn(user: string): { n: number; title: string; text: string }[] {
  const block = /<evidence>\n([\s\S]*?)\n<\/evidence>/.exec(user)?.[1] ?? ""
  return [...block.matchAll(/^(\d+)\. (.*)\n {3}(.*)$/gm)].map((m) => ({ n: Number(m[1]), title: unescape(m[2]), text: unescape(m[3]) }))
}
const firstSentence = (text: string) => (/^(.{30,400}?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text.slice(0, 200)).trim()

/** What the fakes answer when a test does not say otherwise: a sensible, deterministic stand-in for each role. */
export const DEFAULTS: { [R in Role]: (call: Call, n: number) => string } = {
  plan: () => JSON.stringify({
    key_question: "Does semaglutide lower the risk of major cardiovascular events in adults with obesity and no diabetes?", medical: true, researchable: true,
    opening: "I'll search the web and PubMed for trials of semaglutide and cardiovascular events in people with obesity but no diabetes, screen what comes back, and check each statement against its source.",
    web: [{ query: "semaglutide cardiovascular outcomes in adults with overweight or obesity without diabetes, randomized trial results", objective: "Reports of the trial rank first; leave out market news. Pull the event rates and the hazard ratio." }],
    literature: ["semaglutide cardiovascular outcomes obesity without diabetes", "semaglutide major adverse cardiovascular events trial"],
  }),
  // An investigator's section: one sentence copied from each source it was given, filed for its hypothesis.
  section: (call) => {
    const label = /Yours is (H\d)\./.exec(call.system)?.[1] ?? "H1"
    return [`### ${label}: section`, `**For:** ${sourcesIn(call.user).map((s) => `${firstSentence(s.text).replace(/[.!?]$/, "")} [${s.n}].`).join(" ")}`].join("\n")
  },
  // A method specialist's section: the second sentence of one source it was given (the writer copies the first sentences; each specialist takes another source).
  specialist: (call, n) => {
    const s = sourcesIn(call.user)[n - 1]
    const second = s?.text.split(/(?<=[.!?])\s+/)[1]
    return ["### Method view: section", second ? `${second.replace(/[.!?]$/, "")} [${s.n}].` : "The sources found do not report this."].join("\n")
  },
  // No hypotheses unless a test asks for them: the question is treated as a plain one.
  hypothesize: () => JSON.stringify({ needed: false, reason: "This is a plain question with one answer to look up." }),
  // Every statement points the way it was filed, unless a test says otherwise.
  stance: (call) => JSON.stringify({ stances: [...call.user.matchAll(/<statement i="(\d+)"/g)].map((m) => ({ i: Number(m[1]), stance: "supports" })) }),
  // Keeps a passage that names semaglutide; calls a title with "review" or "meta-analysis" a review.
  screen: (call) => {
    const passages = [...call.user.matchAll(/<passage i="(\d+)">\n([\s\S]*?)\n<\/passage>/g)]
    return JSON.stringify({ items: passages.map((p) => {
      const text = p[2].toLowerCase(), on = text.includes("semaglutide") && !text.includes("shares of")
      return { i: Number(p[1]), answers_question: on ? "yes" : "no", reports_results: on ? "yes" : "no", study_type: /review|meta-analysis/.test(text.split("\n")[0]) ? "review" : "clinical" }
    }) })
  },
  // The board's own scripted rule (word overlap): a sentence copied from the source is supported with a real quote.
  check: (call) => {
    const source = unescape(/<source>\n([\s\S]*?)\n<\/source>/.exec(call.user)?.[1] ?? "")
    const claims = [...call.user.matchAll(/<claim i="\d+">([\s\S]*?)<\/claim>/g)].map((m) => unescape(m[1]))
    return JSON.stringify({ rulings: mockRulings(claims, source).map((r, i) => ({ i, verdict: r.verdict, quote: r.quote })) })
  },
  // A draft made from the sources it was given: one sentence copied from each of the first three, then one sentence no source states.
  write: (call) => {
    const sources = sourcesIn(call.user)
    const copied = sources.slice(0, 3).map((s) => `${firstSentence(s.text).replace(/[.!?]$/, "")} [${s.n}].`)
    return [
      `**Yes, in the population that was studied.** ${copied[0] ?? "The sources found do not answer this."}`, "",
      `${copied.slice(1).join(" ")} Semaglutide cures heart disease in every patient within 12 weeks [${sources[0]?.n ?? 1}].`, "",
      "Not found in these sources: results for people with no cardiovascular disease.", "",
      "NEXT STEPS",
      JSON.stringify({ label: "Recommended next step", text: "Look for the full report of the randomized trial.", why: "The sources here are abstracts and excerpts.", basis: [sources[0]?.n ?? 1], does: "It would give the event rates by group." }),
      JSON.stringify({ label: "Alternative", text: "Ask about a source that does not exist.", why: "This proposal names source 99.", basis: [99], does: "Nothing: code drops it." }),
    ].join("\n")
  },
  critic: () => JSON.stringify({ notes: [
    { severity: "blocking", statement: 4, text: "\"cures heart disease in every patient\" is stated by no source; source [1] reports a lower event rate in one trial population. Remove it." },
    { severity: "minor", statement: null, text: "The answer does not say how long patients were followed." },
  ] }),
  // The reviewer's second look: a note about a sentence is resolved when that sentence's words are gone from the revision; a general note is left open.
  rejudge: (call) => {
    const revised = unescape(/<revised>\n([\s\S]*?)\n<\/revised>/.exec(call.user)?.[1] ?? "")
    const notes = [...(/<notes>\n([\s\S]*?)\n<\/notes>/.exec(call.user)?.[1] ?? "").matchAll(/^(\d+)\. \[\w+\] (.*)$/gm)]
    return JSON.stringify({ notes: notes.map((n) => { const quoted = /"([^"]{8,})"/.exec(unescape(n[2]))?.[1]; const gone = quoted !== undefined && !revised.includes(quoted); return { note: Number(n[1]), status: gone ? "resolved" : "open", why: gone ? "those words are no longer in the answer" : "the revised answer does not deal with it" } }) })
  },
  // The draft with every sentence that failed its check removed, as the reviser is told to do.
  revise: (call) => {
    const draft = unescape(/<draft>\n([\s\S]*?)\n<\/draft>/.exec(call.user)?.[1] ?? "")
    const failed = [...call.user.matchAll(/^S\d+ [^:]*: (?:NOT SUPPORTED|CONTRADICTED)[^\n]*\n {3}"(.*)"$/gm)].map((m) => unescape(m[1]).replace(/[.!?]$/, ""))
    let text = draft
    for (const sentence of failed) text = text.replace(new RegExp(`\\s*${sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*\\[\\d+\\])*[.!?]?`), "")
    const sources = sourcesIn(call.user)
    return [text.trim(), "", "NEXT STEPS", JSON.stringify({ label: "Recommended next step", text: "Look for the full report of the randomized trial.", why: "The sources here are abstracts and excerpts.", basis: [sources[0]?.n ?? 1], does: "It would give the event rates by group." }), "", "REVIEW NOTES", "1: addressed", "2: not addressed: no source states the follow-up time"].join("\n")
  },
}

/** Dollars per million tokens of the fake models: the prices in board/config.yaml, so a test's costs are of the real order. */
export const PRICES: Record<string, Record<string, [number, number]>> = {
  anthropic: { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] },
  openai: { "gpt-4o-mini": [0.15, 0.6], "gpt-5-mini": [0.25, 2] },
}

export function fakeModels(script: Script, calls: Call[], prices = PRICES, reasoning = false): Models {
  const models = createModels()
  const counts: Partial<Record<Role, number>> = {}
  for (const [provider, list] of Object.entries(prices)) {
    const faux = fauxProvider({ provider, tokensPerSecond: 1e9, models: Object.entries(list).map(([id, [input, output]]) => ({ id, reasoning, cost: { input, output, cacheRead: 0, cacheWrite: 0 } })) })
    const textOf = (content: unknown) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : "")
    faux.setResponses(Array.from({ length: 400 }, () => async (context: { messages: { role: string; content: unknown }[] }, options: Call["options"] | undefined, _state: unknown, model: { id: string }) => {
      const system = textOf(context.messages.find((m) => m.role === "system")?.content) // pi-ai carries the system prompt as the transcript's system message
      const user = textOf(context.messages.findLast((m) => m.role === "user")?.content)
      const role = roleOf(system)
      const call: Call = { role, provider, model: model.id, system, user, options: options ?? {} }
      calls.push(call)
      const n = (counts[role] = (counts[role] ?? 0) + 1)
      const reply = await (script[role] ?? DEFAULTS[role])(call, n)
      return typeof reply === "string" ? fauxAssistantMessage(reply) : fauxAssistantMessage("", { stopReason: "error", errorMessage: reply.error })
    }) as never)
    models.setProvider(faux.provider)
  }
  return models
}

// ── The engine ───────────────────────────────────────────────────────────────────────────────────

export interface EngineOptions {
  /** Demo mode (paid calls off). Default: real mode, with fake keys and the preview switch on. */
  demo?: boolean
  script?: Script
  env?: NodeJS.ProcessEnv
  /** Changes to board/config.yaml's `research` block and `meeting` block. */
  research?: Record<string, unknown>
  meeting?: Partial<BoardConfig["meeting"]>
  prices?: typeof PRICES
  /** The fake models support reasoning (a thinking level is sent). Default: they do not. */
  reasoning?: boolean
  /** A last change to the config (model tiers, checkers). */
  config?: (config: BoardConfig) => BoardConfig
  token?: string
  onStored?: ResearchDeps["onStored"]
  /** An existing runs folder (to start a second engine on the folder of a first, as after a restart). */
  runs?: string
  deps?: Partial<ResearchDeps>
}

export async function engine(options: EngineOptions = {}) {
  const base = loadConfig()
  const runs = options.runs ?? join(mkdtempSync(join(tmpdir(), "research-test-")), "runs")
  const made: BoardConfig = { ...base, paths: { ...base.paths, runs }, meeting: { ...base.meeting, ...options.meeting }, research: { ...base.research, ...options.research } }
  const config = options.config ? options.config(made) : made
  const env: NodeJS.ProcessEnv = options.env ?? (options.demo ? { NO_PAID_CALLS: "1" } : { NO_PAID_CALLS: "0", RESEARCH_PREVIEW: "1", ...KEYS })
  const calls: Call[] = []
  const script: Script = { ...options.script }
  const network: Net = { requests: [], exa: [() => jsonResponse({ results: EXA_RESULTS, costDollars: { total: 0.005 } })], europepmc: () => jsonResponse(EUROPEPMC) }
  net = network
  const token = options.token ?? "session-token"
  const models = fakeModels(script, calls, options.prices, options.reasoning)
  const research = createResearch({
    config, env, hasToken: (req) => req.headers["x-glhf-token"] === token, tokenFile: "glhf/runs/.token",
    mock: () => options.demo === true || (env.NO_PAID_CALLS ?? "").trim() !== "0",
    models: () => models, onStored: options.onStored, specialists: () => [], ...options.deps, // no method specialist unless a test asks for them
  })
  const server = createServer((req, res) => void research.handle(req, res, new URL(req.url ?? "/", "http://x").pathname.split("/").filter(Boolean)))
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const headers = (extra: Record<string, string> = {}) => ({ "content-type": "application/json", origin: ORIGIN, "x-glhf-token": token, ...extra })

  const api = {
    url, config, env, runs, research, calls, script, net: network, token,
    /** POST /api/research. Returns the status and the JSON body. */
    async ask(body: Record<string, unknown>, extra: Record<string, string> = {}) {
      const res = await fetch(`${url}/api/research`, { method: "POST", headers: headers(extra), body: JSON.stringify(body) })
      return { status: res.status, body: (await res.json()) as Record<string, unknown> & { id: string; thread: string } }
    },
    async get<T = unknown>(path: string, extra: Record<string, string> = {}) {
      const res = await fetch(`${url}${path}`, { headers: { origin: ORIGIN, ...extra } })
      return { status: res.status, headers: res.headers, body: (res.headers.get("content-type") ?? "").includes("json") ? ((await res.json()) as T) : ((await res.text()) as T) }
    },
    async cancel(id: string, extra: Record<string, string> = {}) {
      const res = await fetch(`${url}/api/research/${id}/cancel`, { method: "POST", headers: headers(extra), body: "{}" })
      return { status: res.status, body: (await res.json()) as { id: string; status: string; cancelled: boolean; message: string } }
    },
    record: async (id: string) => (await api.get<ResearchRecord & { artifacts: { name: string; bytes: number }[] }>(`/api/research/${id}`)).body,
    /** The stored event log of an answer. */
    events: (id: string): Stamped[] => { try { return readFileSync(join(runs, ".research", id, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Stamped) } catch { return [] } },
    /** Ask, wait for the end, and give back the record and its events. */
    async answer(body: Record<string, unknown>) {
      const started = await api.ask(body)
      if (started.status !== 202) throw new Error(`POST /api/research answered ${started.status}: ${JSON.stringify(started.body)}`)
      await research.idle()
      return { id: started.body.id, thread: started.body.thread, record: await api.record(started.body.id), events: api.events(started.body.id) }
    },
    /** Calls made, by role. */
    count: (role: Role) => calls.filter((c) => c.role === role).length,
    exaRequests: () => network.requests.filter((r) => r.url === "https://api.exa.ai/search"),
    pmcRequests: () => network.requests.filter((r) => r.url.includes("europepmc")),
    async close() { await research.stop(); await new Promise((done) => server.close(done)) },
  }
  return api
}

/** Run with NO_PAID_CALLS=0 in the process for the length of `work` only (exa.ts reads the process's own value), then put it back. */
export async function paidAllowed<T>(work: () => Promise<T>): Promise<T> {
  const before = process.env.NO_PAID_CALLS
  process.env.NO_PAID_CALLS = "0"
  try { return await work() } finally { if (before === undefined) delete process.env.NO_PAID_CALLS; else process.env.NO_PAID_CALLS = before }
}

/** Every key of the test environment, to assert that none appears in an event, a record or an HTTP answer. */
export const containsKey = (text: string) => Object.values(KEYS).some((key) => text.includes(key))
