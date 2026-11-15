// Specialists in a chat plan (src/chat): which are chosen for a question, inside which limits, what a model may
// propose, what the start writes for the run, and that the origin of the method notes is named nowhere.
// No model, no network: fetch fails on anything that is not this machine, every key is a fake, and "paid calls on"
// means a fake fetch handed to the handler.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, beforeEach, test } from "node:test"

const scratch = mkdtempSync(join(tmpdir(), "specialists-plan-"))
for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "EXA_API_KEY", "PAST_API_KEY", "HF_TOKEN", "TINKER_API_KEY"]) process.env[key] = "fake-key-for-tests" // set before env.ts could read .env
process.env.GLHF_RUNS_DIR = join(scratch, "glhf-runs")

const { loadConfig } = await import("../src/config.ts")
const { guard } = await import("../src/http.ts")
const { boardMembers, buildCatalog } = await import("../src/chat/catalog.ts")
const { agentsFor, effortOf, efforts, memberLimit, plansDir, planFrom, rankSpecialists } = await import("../src/chat/plan.ts")
const { chatSearch, handleChat, resetRate } = await import("../src/chat/routes.ts")
const { loadSpecialists, matchSpecialists, MATCH_POINTS } = await import("../src/specialists.ts")
type Fetch = typeof fetch

const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<Fetch>[0], init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init)
  outbound.push(url)
  throw new Error(`a test tried to reach ${url}`)
}) as Fetch

/** The outside project the skill list came from. It must be in nothing a person or a model reads. */
const ORIGIN = /biomni|phylo(?![a-z])/i
const DASH = "http://127.0.0.1:5317", TOKEN = "test-token"
const OFF = () => ({ NO_PAID_CALLS: "1", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", EXA_API_KEY: "k" } as NodeJS.ProcessEnv)
const ON = () => ({ ...OFF(), NO_PAID_CALLS: "0" } as NodeJS.ProcessEnv)
// The roster is fixed here, so these tests do not move when board/config.yaml does.
const SIX = ["scout", "proposer", "experimenter", "methods-auditor", "critic", "reporter"]
const FIVE = SIX.slice(1) // a board with no member that searches

const QUESTIONS = {
  kras: "We have a KRAS G12C hit, CMP-0517, with a pERK IC50 of 95 nM but a hERG IC50 of 6 uM. Should we advance it or fix the hERG problem first?",
  rnaseq: "Which genes are differentially expressed between treated and control samples in our bulk RNA-seq count matrix, and which pathways are enriched?",
  trials: "What does the clinical trial landscape look like for KRAS G12C inhibitors in non-small cell lung cancer?",
}
const PLAIN = "Rank the claims by priority, check the parameters against the study instructions, and try to disprove the conclusions."

interface World { base: string; env: NodeJS.ProcessEnv; runs: string; started: string[]; launched: string[]; calls: { url: string; init: RequestInit }[]; config: ReturnType<typeof loadConfig>; reply: (text: string) => void }
const servers: Server[] = []
function configFor(board = SIX) {
  const dir = mkdtempSync(join(scratch, "w-")), runs = join(dir, "runs")
  mkdirSync(runs)
  const real = loadConfig()
  return { ...real, board, paths: { ...real.paths, runs, expertise: join(dir, "expertise") }, meeting: { ...real.meeting, max_usd: 5, max_minutes: 15, max_rounds: 4, daily_usd: 20 } }
}
async function world(options: { env?: NodeJS.ProcessEnv; mock?: boolean; board?: string[] } = {}): Promise<World> {
  const config = configFor(options.board), runs = config.paths.runs
  const env = options.env ?? OFF(), mock = options.mock ?? true
  const started: string[] = [], launched: string[] = [], calls: World["calls"] = []
  let modelText = "{}"
  const start = async (file: string) => { started.push(file); const id = `run-${started.length}`; mkdirSync(join(runs, id)); writeFileSync(join(runs, id, "run.json"), JSON.stringify({ runId: id, briefFile: file, startedAt: Date.now(), members: {}, rounds: 0, lastRound: [], evidence: {}, ledger: [], escalations: 0, checkerUsd: 0, usd: 0, mock })); return id }
  const hasToken = (req: IncomingMessage) => req.headers["x-glhf-token"] === TOKEN
  const fakeModel = (async (input: Parameters<Fetch>[0], init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    return new Response(JSON.stringify(url.includes("anthropic") ? { content: [{ type: "text", text: modelText }] } : { choices: [{ message: { content: modelText } }] }), { status: 200 })
  }) as Fetch
  const server = createServer((req, res) => {
    if (!guard(req, res, env)) return
    void handleChat(req, res, new URL(req.url ?? "/", "http://x").pathname.split("/").filter(Boolean), { config, mock, env, hasToken, start, launch: (id) => void launched.push(id), listRuns: () => [], fetch: fakeModel })
  })
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  servers.push(server)
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, env, runs, started, launched, calls, config, reply: (text) => { modelText = text } }
}
after(() => { for (const s of servers) s.close(); rmSync(scratch, { recursive: true, force: true }) })
beforeEach(() => resetRate())

const call = async (w: World, method: string, path: string, body?: unknown, headers: Record<string, string> = { origin: DASH }) => {
  const res = await realFetch(w.base + path, { method, headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as any }
}
const say = (w: World, content: string, extra: object = {}, headers?: Record<string, string>) => call(w, "POST", "/api/chat", { messages: [{ role: "user", content }], ...extra }, headers)
const template = (config: ReturnType<typeof configFor>, question: string, effort: "quick" | "standard" | "deep") => planFrom({ config, mock: true, env: OFF() }, question, effort).plan
const guests = (plan: any) => plan.agents.filter((a: any) => a.source === "specialist")
const names = (agents: any[]) => agents.map((a) => a.name)

test("catalog: which specialists can take part, how many methods with notes each has, and the library under its neutral name", async () => {
  const w = await world()
  const { body } = await call(w, "GET", "/api/chat/catalog")
  const specialists = body.agents.filter((a: any) => a.source === "specialist")
  assert.equal(specialists.length, 27)
  assert.deepEqual(specialists.filter((a: any) => !a.takesPart).map((a: any) => a.name), ["attending-skeptic", "chief", "contrarian", "methods-librarian"])
  for (const a of specialists) {
    assert.deepEqual(Object.keys(a).sort(), ["deliverable", "fullTextMethods", "methods", "name", "role", "source", "takesPart", "title", "tools", "trigger", ...(a.takesPart ? [] : ["whyNot"])].sort(), a.name)
    assert.equal(typeof a.takesPart, "boolean"); assert.equal(a.fullTextMethods, a.methods.length); assert.deepEqual(a.tools, [], "on the board a specialist has no tools")
    assert.ok(a.methods.every((m: any) => m.name && m.title && Object.keys(m).length === 2))
    assert.ok(a.title && a.trigger && a.deliverable, a.name)
  }
  const by = (name: string) => specialists.find((a: any) => a.name === name)
  assert.equal(by("bulk-rnaseq-analyst").fullTextMethods, 5); assert.equal(by("statistical-geneticist").fullTextMethods, 1); assert.equal(by("toxicologist").fullTextMethods, 0)
  assert.equal(by("immune-cell-therapy-analyst").fullTextMethods, 1, "its other skill with text is withheld")
  assert.equal(by("workflow-and-method-engineer").fullTextMethods, 2, "three of its skills with text are withheld")
  assert.match(by("chief").whyNot, /lead already does this job/)
  assert.deepEqual(body.methodLibrary, { id: "method-library", title: "Method library", specialists: 19, methods: 58, nameOnly: 38 })
  const library = body.skills.find((s: any) => s.name === "method-library")
  assert.deepEqual([library.title, library.installed], ["Method library", false])
  assert.match(library.description, /58 methods have notes that a specialist can read .* 38 are a name only\. The notes are text: no package is installed and nothing is run\./)
  assert.ok(body.skills.every((s: any) => s.title && s.name && typeof s.description === "string"))
  // Board entries are as before: none of the specialist fields.
  assert.ok(body.agents.filter((a: any) => a.source === "board").every((a: any) => !("takesPart" in a) && !("methods" in a)))
  // Not one name-only or withheld skill is listed as something a specialist can do.
  const text = JSON.stringify(body)
  for (const hidden of ["off-target-safety-pharmacology", "polygenic-risk-score", "literature-deep-review", "cell-therapy-car-design", "tusoai", "tusoskill"]) assert.ok(!text.includes(hidden), hidden)
  for (const e of body.efforts) assert.match(e.description, /specialist/)
})

test("selection: three example questions at each effort level", () => {
  const config = configFor()
  const expected: Record<keyof typeof QUESTIONS, { first: string; second: string; methods: string[] }> = {
    kras: { first: "target-safety-druggability-analyst", second: "medicinal-chemist", methods: ["target-tractability-druggability"] },
    rnaseq: { first: "bulk-rnaseq-analyst", second: "target-biologist", methods: ["deconvolution-bulk-rnaseq", "consensus-disease-signature", "rnaseq-fastq-to-counts"] },
    trials: { first: "literature-evidence-synthesist", second: "clinical-and-experimental-design-analyst", methods: ["clinicaltrials-landscape", "methods-landscape-review"] },
  }
  for (const [key, question] of Object.entries(QUESTIONS) as [keyof typeof QUESTIONS, string][]) {
    const quick = template(config, question, "quick"), standard = template(config, question, "standard"), deep = template(config, question, "deep")
    assert.deepEqual(names(quick.agents), ["lead-scientist", "scout", "proposer", expected[key].first], `${key} quick: the lead, the member that searches, a claim maker and the best-matched specialist`)
    for (const plan of [standard, deep]) {
      assert.deepEqual(names(plan.agents).slice(0, 4), ["lead-scientist", "scout", "proposer", "critic"], `${key} ${plan.effort}: the Critic stays`)
      assert.deepEqual(names(guests(plan)), [expected[key].first, expected[key].second], `${key} ${plan.effort}`)
      assert.ok(plan.agents.length - 1 <= 6, "never more members than the roster")
    }
    assert.deepEqual(names(guests(quick)[0].methods), expected[key].methods, `${key}: the methods whose notes it reads, best match first`)
    const first = guests(quick)[0]
    assert.deepEqual(Object.keys(first).sort(), ["methods", "name", "source", "title", "why"])
    assert.match(first.why, /share words with the question: .+\. It has no tools: it says which analysis would settle the question and what the data can support\./)
    // The notes are also the plan's skills, next to the installed search skill.
    assert.deepEqual(names(quick.skills), ["build-with-exa", ...expected[key].methods])
    assert.match(quick.skills[1].why, /^Method notes read by the .+ \(text only: no package is installed and nothing is run\)\.$/)
    assert.ok(quick.warnings.some((x: string) => /1 method specialist\(s\) take part as board members for this run: .+ They have no tools and cannot run code.+no limit or spend cap is raised\. In a practice run their replies are fixed example text too\./.test(x)))
  }
  assert.match(guests(template(config, QUESTIONS.kras, "quick"))[0].why, /kras, herg \(read as safety\)/, "the reason shows the words, and how a word was read")
  // A question that matches no specialist's notes gets none, and nothing about specialists in its warnings.
  const plain = template(config, PLAIN, "deep")
  assert.deepEqual(guests(plain), []); assert.ok(plain.agents.every((a: any) => a.source === "board"))
  assert.ok(!plain.warnings.some((x: string) => /specialist/.test(x)))
  assert.deepEqual(matchSpecialists("Should we advance CMP-0423?"), [])
  assert.equal(MATCH_POINTS, 2)
})

test("limits: a specialist takes a place, it never adds one; no cap moves", () => {
  for (const board of [SIX, FIVE, ["proposer", "critic"], ["proposer"]]) {
    const config = configFor(board)
    const { lead, members } = boardMembers(config)
    for (const question of [...Object.values(QUESTIONS), PLAIN]) for (const level of efforts(config)) {
      const plan = template(config, question, level.id), limit = memberLimit(level, members)
      assert.ok(limit <= board.length && (level.agents === "all" || limit <= level.agents))
      assert.ok(plan.agents.length - 1 <= limit, `${board.length} members, ${level.id}: ${names(plan.agents)}`)
      assert.deepEqual(plan.limits, level.limits, "the level's limits, with or without specialists")
      assert.equal(plan.estimate.usd, 0); assert.match(plan.estimate.basis, new RegExp(`capped at \\$${level.limits.maxUsd}\\b`))
      // Always there: the lead, the member that searches (when the roster has one), a claim maker; the Critic at standard and deep.
      const present = names(plan.agents)
      assert.equal(present[0], lead.name)
      for (const must of ["scout", "proposer"]) if (board.includes(must)) assert.ok(present.includes(must), `${must} stays at ${level.id}`)
      if (board.includes("critic") && level.id !== "quick") assert.ok(present.includes("critic"), `the Critic stays at ${level.id}`)
      // Specialists get at most half of the places that are left, rounded up.
      const required = present.slice(1).filter((n) => ["scout", "proposer"].includes(n) || (n === "critic" && level.id !== "quick")).length
      assert.ok(guests(plan).length <= Math.ceil(Math.max(0, limit - required) / 2), `${board.length} members, ${level.id}`)
    }
  }
  // A full board of required members leaves no place: no specialist, however well it matches.
  const tight = configFor(["proposer", "critic"])
  assert.deepEqual(guests(template(tight, QUESTIONS.rnaseq, "deep")), [])
  assert.equal(guests(template(tight, QUESTIONS.rnaseq, "quick")).length, 1, "at quick the Critic is not required, so one place is free")
  // The spend cap of a level is the same number whether the plan has specialists or not.
  const config = configFor()
  assert.deepEqual(efforts(config).map((e) => e.limits.maxUsd), [1, 3, 5])
  const real = planFrom({ config, mock: false, env: ON() }, QUESTIONS.kras, "standard").plan, none = planFrom({ config, mock: false, env: ON() }, PLAIN, "standard").plan
  assert.equal(guests(real).length, 2); assert.equal(guests(none).length, 0)
  assert.deepEqual(real.limits, none.limits); assert.equal(real.estimate.usd, none.estimate.usd); assert.equal(real.estimate.usd, 3)
  assert.ok(real.models.members.includes(config.models.strong), "specialists run on the strong tier")
})

test("a stored or suggested specialist is checked again: unknown names, name-only methods and withheld methods are dropped", () => {
  const config = configFor(), { lead, members } = boardMembers(config), deep = effortOf(config, "deep")
  const ranked = [
    { name: "statistical-geneticist", title: "x", why: "asked for a name-only skill", source: "specialist" as const, methods: [{ name: "polygenic-risk-score", title: "PRS" }] },
    { name: "immune-cell-therapy-analyst", title: "x", why: "asked for a withheld skill", source: "specialist" as const, methods: [{ name: "cell-therapy-car-design", title: "CAR" }] },
    { name: "chief", title: "x", why: "cannot take part", source: "specialist" as const },
    { name: "root-shell", title: "x", why: "invented", source: "specialist" as const },
    { name: "critic", title: "x", why: "a board member is not a specialist", source: "specialist" as const },
    { name: "toxicologist", title: "Forged <title>", why: "Safety. From the Biomni hub.", source: "specialist" as const, methods: [{ name: "tusoai", title: "x" }] },
    { name: "bulk-rnaseq-analyst", title: "x", why: "", source: "specialist" as const, methods: [{ name: "rnaseq-fastq-to-counts", title: "forged" }, { name: "bulk-rnaseq-differential-expression", title: "name only" }, null as any] },
    { name: "toxicologist", title: "x", why: "twice", source: "specialist" as const },
  ]
  const got = guestsOf(agentsFor(deep, ranked, lead, members))
  assert.deepEqual(got, [
    { name: "toxicologist", title: "Toxicologist", why: "Safety.", source: "specialist", methods: [] },
    { name: "bulk-rnaseq-analyst", title: "Bulk RNA-seq analyst", why: "Its notes fit the question.", source: "specialist", methods: [{ name: "rnaseq-fastq-to-counts", title: "RNA-seq FASTQ to counts" }] },
  ], "titles and method titles come from the files, never from the stored entry")
  // rankSpecialists never offers one that cannot take part, whatever the question says.
  assert.ok(!rankSpecialists("chief of service triage discharge summary, contrarian alternative hypothesis, attending skeptic falsification, methods librarian documentation").some((a) => ["chief", "contrarian", "attending-skeptic", "methods-librarian"].includes(a.name)))
  function guestsOf(agents: any[]) { return agents.filter((a) => a.source === "specialist") }
})

test("AI mode: a model may propose specialists, and every name is checked against the catalog", async () => {
  const w = await world({ env: ON(), mock: false })
  w.reply(JSON.stringify({ intent: "research", reply: "A plan.", plan: { briefTitle: "hERG", agents: [
    { name: "toxicologist", why: "hERG is a safety question." }, { name: "statistical-geneticist", why: "Copied from Biomni: polygenic scores." }, { name: "chief", why: "leads" },
    { name: "method-library", why: "the library is not an agent" }, { name: "made-up-specialist" }, "target-safety-druggability-analyst", { name: "critic", why: "disprove" },
  ], skills: [{ name: "polygenic-risk-score", why: "a name-only skill is not a skill a plan can choose" }] } }))
  const { status, body } = await say(w, "Is the hERG margin of CMP-0517 a safety risk?", {}, { origin: DASH, "x-glhf-token": TOKEN })
  assert.equal(status, 200); assert.equal(body.mode, "ai"); assert.equal(w.calls.length, 1)
  const plan = body.plan
  assert.deepEqual(names(plan.agents), ["lead-scientist", "scout", "proposer", "critic", "toxicologist", "statistical-geneticist"], "required members first; specialists take half of the three free places, rounded up, in the model's order")
  const [tox, geneticist] = guests(plan)
  assert.deepEqual(tox, { name: "toxicologist", title: "Toxicologist", why: "hERG is a safety question.", source: "specialist", methods: [] })
  assert.deepEqual(geneticist, { name: "statistical-geneticist", title: "Statistical geneticist", why: "Chosen by the model.", source: "specialist", methods: [{ name: "mendelian-randomization-twosamplemr", title: "Mendelian randomization (two-sample MR)" }] },
    "a reason that names the origin is replaced; it reads the methods it has notes for, never the name-only one the model had in mind")
  assert.ok(plan.warnings.some((x: string) => /3 agent name\(s\) the model gave are not board members or specialists that can take part/.test(x)))
  assert.ok(plan.warnings.some((x: string) => /1 skill name\(s\)/.test(x)))
  assert.deepEqual(plan.limits, { maxUsd: 3, maxMinutes: 10, maxRounds: 2 }); assert.equal(plan.estimate.usd, 3); assert.equal(plan.paid, true)
  assert.match(body.reply, /2 of them are method specialists \(Toxicologist, Statistical geneticist\): no tools, method notes only\./)
  // What the model was shown: specialists that can take part, with only the methods that have notes.
  const sent: string = JSON.parse(String(w.calls[0].init.body)).messages[0].content
  const catalog = JSON.parse(/<catalog>\n([\s\S]*?)\n<\/catalog>/.exec(sent)![1].replaceAll("&lt;", "<"))
  assert.equal(catalog.specialists.length, 23)
  assert.ok(!catalog.specialists.some((s: any) => ["chief", "contrarian", "attending-skeptic", "methods-librarian"].includes(s.name)))
  assert.deepEqual(catalog.specialists.find((s: any) => s.name === "statistical-geneticist").methods, ["mendelian-randomization-twosamplemr"])
  assert.doesNotMatch(sent, ORIGIN); assert.doesNotMatch(sent, /polygenic-risk-score|tusoai|cell-therapy-car-design/)
  assert.doesNotMatch(JSON.stringify(body), ORIGIN)
  assert.deepEqual(w.started, []); assert.deepEqual(outbound, [])
})

test("start: the run's overrides name the specialists; taking one out takes its notes out; nothing else moves", async () => {
  const w = await world()
  const plan = (await say(w, QUESTIONS.kras)).body.plan
  assert.match((await say(w, QUESTIONS.kras)).body.reply, /2 of them are method specialists \(Target safety druggability analyst, Medicinal Chemist\)/)
  const url = `/api/chat/plans/${plan.id}/start`
  const refused = await call(w, "POST", url, { confirm: true, agents: ["toxicologist"] })
  assert.equal(refused.status, 400, "a specialist that is not in the plan cannot be added at the start"); assert.equal(refused.body.field, "agents")
  const onlyGuests = await call(w, "POST", url, { confirm: true, agents: ["target-safety-druggability-analyst"] })
  assert.equal(onlyGuests.status, 400, "specialists alone are not a board"); assert.match(onlyGuests.body.error, /at least one board member/)
  const ok = await call(w, "POST", url, { confirm: true })
  assert.equal(ok.status, 201)
  assert.deepEqual(ok.body.agents, names(plan.agents)); assert.deepEqual(ok.body.specialists, ["target-safety-druggability-analyst", "medicinal-chemist"])
  assert.equal(ok.body.scripted, true); assert.match(ok.body.note, /practice run: the replies are fixed example text written in advance, not research/)
  assert.ok(ok.body.warnings.some((x: string) => /In a practice run their replies are fixed example text too/.test(x)))
  const overrides = JSON.parse(readFileSync(join(w.runs, "run-1", "overrides.json"), "utf8"))
  assert.deepEqual(overrides.board, ["scout", "proposer", "critic", "experimenter"], "board members only")
  assert.deepEqual(overrides.specialists, [
    { name: "target-safety-druggability-analyst", why: guests(plan)[0].why, methods: ["target-tractability-druggability"] },
    { name: "medicinal-chemist", why: guests(plan)[1].why, methods: [] },
  ])
  assert.deepEqual(overrides.meeting, { max_usd: 3, max_minutes: 10, max_rounds: 2 })
  // The roster of that run, over HTTP: the board members it kept and the two specialists, each with why and methods.
  const roster = (await call(w, "GET", "/api/chat/roster?run=run-1")).body
  assert.deepEqual(roster.map((m: any) => [m.name, m.source]), [["lead-scientist", "board"], ["scout", "board"], ["proposer", "board"], ["experimenter", "board"], ["critic", "board"], ["target-safety-druggability-analyst", "specialist"], ["medicinal-chemist", "specialist"]])
  const guest = roster.at(-2)
  assert.deepEqual(Object.keys(guest).sort(), ["deliverable", "methods", "model", "modelId", "name", "role", "source", "title", "tools", "why"])
  assert.deepEqual([guest.title, guest.role, guest.model, guest.modelId, guest.tools, guest.methods], ["Target safety druggability analyst", "member", "strong", w.config.models.strong, [], [{ name: "target-tractability-druggability", title: "Target tractability druggability" }]])
  assert.equal(guest.why, guests(plan)[0].why)
  assert.ok(roster.every((m: any) => !("prompt" in m) && !("specialist" in m)), "never a prompt")
  assert.equal((await call(w, "GET", "/api/chat/roster?run=no-such-run")).status, 404)
  assert.equal((await call(w, "GET", "/api/chat/roster?run=..%2F..%2Fx")).status, 404)
  const plainRoster = (await call(w, "GET", "/api/chat/roster")).body
  assert.deepEqual(plainRoster.map((m: any) => [m.name, m.source]), [["lead-scientist", "board"], ...SIX.map((n) => [n, "board"])], "no run named: the config's roster")

  // A second plan, started without its specialists: no `specialists` in the overrides, and their notes leave the plan's skills.
  const second = (await say(w, QUESTIONS.rnaseq)).body.plan
  assert.deepEqual(names(second.skills), ["build-with-exa", "deconvolution-bulk-rnaseq", "consensus-disease-signature", "rnaseq-fastq-to-counts"])
  const without = await call(w, "POST", `/api/chat/plans/${second.id}/start`, { confirm: true, agents: ["scout", "proposer", "critic"] })
  assert.equal(without.status, 201); assert.equal(without.body.specialists, undefined)
  assert.ok(!("specialists" in JSON.parse(readFileSync(join(w.runs, "run-2", "overrides.json"), "utf8"))))
  const stored = JSON.parse(readFileSync(join(plansDir(w.config), `${second.id}.json`), "utf8")).plan
  assert.deepEqual(names(stored.skills), ["build-with-exa"]); assert.ok(stored.agents.every((a: any) => a.source === "board"))
  assert.ok(!(without.body.warnings ?? []).some((x: string) => /specialist/.test(x)))
  assert.deepEqual((await call(w, "GET", "/api/chat/roster?run=run-2")).body.map((m: any) => m.name), ["lead-scientist", "scout", "proposer", "critic"])
  assert.deepEqual(outbound, [])
})

test("naming: the origin of the method notes is in no catalog, search result, plan, model prompt, start reply or roster", async () => {
  const w = await world()
  const seen: string[] = []
  seen.push(JSON.stringify((await call(w, "GET", "/api/chat/catalog")).body), JSON.stringify(buildCatalog(w.config, ON())))
  for (const q of ["skill", "method", "library", "analysis", "index", "hub", "biomni", "phylo", "lab", "design", "e", "a"]) seen.push(JSON.stringify(chatSearch(q, "all", 50, { config: w.config, env: w.env, listRuns: () => [] })))
  assert.deepEqual(chatSearch("biomni", "all", 50, { config: w.config, env: w.env, listRuns: () => [] }), [], "searching for the old name finds nothing")
  assert.deepEqual((await call(w, "GET", "/api/chat/search?q=biomni")).body.results, [])
  let started = 0
  for (const question of [...Object.values(QUESTIONS), PLAIN, "Design a PROTAC degrader and dock it", "Single-cell RNA-seq clustering with Scanpy and trajectory inference", "Mendelian randomization of LDL on stroke", "Nextflow pipeline module for our analysis"]) {
    for (const effort of ["quick", "standard", "deep"]) {
      const reply = (await say(w, question, { effort })).body
      seen.push(JSON.stringify(reply))
      if (effort !== "standard") continue
      const startedRun = await call(w, "POST", `/api/chat/plans/${reply.plan.id}/start`, { confirm: true })
      started++
      seen.push(JSON.stringify(startedRun.body), readFileSync(join(w.runs, `run-${started}`, "overrides.json"), "utf8"), JSON.stringify((await call(w, "GET", `/api/chat/roster?run=run-${started}`)).body))
      seen.push(readFileSync(join(plansDir(w.config), `${reply.plan.id}.json`), "utf8"))
      resetRate()
    }
  }
  const everySpecialist = loadSpecialists()
  seen.push(JSON.stringify(everySpecialist), JSON.stringify(rankSpecialists(Object.values(QUESTIONS).join(" "))))
  assert.ok(seen.length > 50 && seen.every((s) => s.length > 1))
  for (const text of seen) assert.doesNotMatch(text, ORIGIN)
  for (const text of seen) assert.doesNotMatch(text, /marketplace|https?:\/\/[^"]*skills/i)
  // The neutral name is what is shown.
  assert.match(seen[0], /"Method library"/)
})
