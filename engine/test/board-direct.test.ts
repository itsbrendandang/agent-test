// The board on direct providers (Anthropic, OpenAI): key checks, the cheap first pass, its independence rule,
// the Exa caps, and the spend caps. Every test uses fakes: fetch is a spy that fails, models are faux providers, and
// the Exa ledger lives in a temp folder. NO_PAID_CALLS stays 1 for the whole file; a test that needs paid logic sets
// it to 0 inside itself and restores it (and uses fake keys), as AGENTS.md asks.
import assert from "node:assert/strict"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createModels, fauxAssistantMessage, fauxProvider, type Models } from "@earendil-works/pi-ai"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"

process.env.NO_PAID_CALLS = "1"
const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => { outbound.push(String(input instanceof Request ? input.url : input)); throw new Error("a test tried to reach the network") }) as typeof fetch

const { checkClaims, gateRound, loadState, overLimit, runBoard, searchOnce, spentToday, startRun, summarize, totalUsd } = await import("../src/board.ts")
const { computedCanRun, NOT_RERUN, openaiCheck } = await import("../src/checkers.ts")
const { loadConfig, mockMode } = await import("../src/config.ts")
const { loadAgent, loadRoster } = await import("../src/agents.ts")
const { EventLog } = await import("../src/events.ts")
const { exaSearch, MissingExaKey, reportedCost } = await import("../src/exa.ts")
const { exaLedgerFile, exaTotal, ceilingMessage } = await import("../src/exaledger.ts")
const { checkTierPrices } = await import("../src/models.ts")
const { assertBoardKeys, boardModeLine, firstPassModel, MissingTierKey, missingKeys, parseModelId, VENDOR_KEY } = await import("../src/providers.ts")
const { FirstPass, keepItem, MIN_QUOTE, quoteInSource, quietReasoning, readRulings, readTriage, route } = await import("../src/triage.ts")
const { buildCatalog } = await import("../src/chat/catalog.ts")
const { PaidCallsOff } = await import("../src/paid.ts")
import type { BoardConfig } from "../src/config.ts"
import type { Claim } from "../src/claims.ts"

const tmp = () => mkdtempSync(join(tmpdir(), "board-direct-"))
const ALL_KEYS = { NO_PAID_CALLS: "0", ANTHROPIC_API_KEY: "fake", OPENAI_API_KEY: "fake", EXA_API_KEY: "fake" } as NodeJS.ProcessEnv
const tempConfig = (over: Partial<BoardConfig["meeting"]> = {}): BoardConfig => {
  const base = loadConfig(), dir = tmp()
  return { ...base, paths: { ...base.paths, runs: join(dir, "runs"), expertise: join(dir, "expertise") }, meeting: { ...base.meeting, max_usd: 5, daily_usd: 20, ...over } }
}
/** Run with NO_PAID_CALLS=0 for the length of `work` only, then restore. */
async function paidAllowed<T>(work: () => Promise<T>): Promise<T> {
  const before = process.env.NO_PAID_CALLS
  process.env.NO_PAID_CALLS = "0"
  try { return await work() } finally { process.env.NO_PAID_CALLS = before }
}

// ── models and keys ───────────────────────────────────────────────────────────────────────────────

test("config: four tiers, provider-qualified, lead and Skeptic on different vendors, no gateway or alias left", () => {
  const c = loadConfig()
  const ids = Object.fromEntries((["lead", "strong", "cheap", "rival"] as const).map((t) => [t, parseModelId(c.models[t], t)]))
  assert.notEqual(ids.lead.vendor, ids.rival.vendor, "the Skeptic must not share the lead's vendor")
  assert.equal(ids.lead.qualified, "anthropic/claude-sonnet-5-5", "Sonnet-class lead by default, not Opus")
  assert.ok(!JSON.stringify(c).match(/opus-latest|~anthropic|~openai|~google|openrouter|typesafe|jev/i), "no gateway id, alias or Jev key in the board config")
  // Provider wiring: the keys a run needs, and the keys the status and catalog report, never name them. (The blank-in-children list, PAID_KEYS in paid.ts, may.)
  const needs = JSON.stringify(missingKeys(c, {}, true)) + JSON.stringify(Object.values(VENDOR_KEY))
  assert.ok(!/openrouter|typesafe/i.test(needs), "no run needs, and nothing reports, an OpenRouter or TypeSafe key")
  // The first-pass checkers cover both vendors, so a claim from either vendor has an independent checker.
  assert.notEqual(parseModelId(c.models.cheap).vendor, parseModelId(c.checkers.first_pass.alt).vendor)
})

test("parseModelId refuses gateway ids, aliases and anything without a vendor", () => {
  for (const bad of ["~anthropic/claude-opus-latest", "openrouter/anthropic/claude-sonnet-5-5", "claude-sonnet-5-5", "google/gemini-flash-latest", "anthropic/", "anthropic/a b", "", undefined, 3]) assert.throws(() => parseModelId(bad), /not a model id/, String(bad))
  assert.deepEqual(parseModelId("openai/gpt-5-mini"), { vendor: "openai", id: "gpt-5-mini", qualified: "openai/gpt-5-mini" })
})

test("every tier's model is in pi-ai's catalog with a price, so max_usd can count it", () => {
  const models = createModels()
  models.setProvider(anthropicProvider()); models.setProvider(openaiProvider())
  const config = loadConfig()
  checkTierPrices(models, config) // does not throw for the shipped config
  assert.throws(() => checkTierPrices(models, { ...config, models: { ...config.models, cheap: "anthropic/claude-haiku-9-9" } }), /not in pi-ai's model catalog/)
})

test("a tier whose model has no price in the catalog is refused: the caps could not count it", () => {
  const config = loadConfig()
  const models = createModels()
  const priced = (cost: number) => ({ input: cost, output: cost, cacheRead: 0, cacheWrite: 0 })
  const want = { anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5"], openai: ["gpt-5-mini", "gpt-4o-mini"] }
  for (const [provider, ids] of Object.entries(want)) models.setProvider(fauxProvider({ provider, models: ids.map((id) => ({ id, cost: priced(id === "claude-haiku-5-5" ? 0 : 1) })) }).provider)
  assert.throws(() => checkTierPrices(models, config), /tier "cheap" model anthropic\/claude-haiku-5-5 has no price/)
})

test("a missing tier key fails loudly and specifically; a real run is never silently scripted", async () => {
  const config = loadConfig()
  assert.deepEqual(missingKeys(config, { ...ALL_KEYS, OPENAI_API_KEY: "" }, false).map((m) => [m.tier, m.key]), [["rival", "OPENAI_API_KEY"], ["first_pass.alt", "OPENAI_API_KEY"]])
  assert.deepEqual(missingKeys(config, { ...ALL_KEYS, ANTHROPIC_API_KEY: undefined }, false).map((m) => m.tier), ["lead", "strong", "cheap"])
  assert.deepEqual(missingKeys(config, { ...ALL_KEYS, EXA_API_KEY: "" }).map((m) => [m.tier, m.key]), [["search", "EXA_API_KEY"]])
  assert.deepEqual(missingKeys(config, ALL_KEYS), [])
  const error = (() => { try { assertBoardKeys(config, { NO_PAID_CALLS: "0", ANTHROPIC_API_KEY: "k" }) } catch (e) { return e as InstanceType<typeof MissingTierKey> } })()
  assert.ok(error instanceof MissingTierKey)
  assert.equal(error.status, 503)
  assert.match(error.message, /tier "rival" \(openai\/gpt-5-mini\) needs OPENAI_API_KEY, which is not set/)
  assert.match(error.message, /never silently made scripted/)
  // Paid calls allowed and a key missing is NOT scripted mode.
  assert.equal(mockMode({ NO_PAID_CALLS: "0", ANTHROPIC_API_KEY: "k" }), false)
  // startRun refuses before it creates anything.
  const cfg = tempConfig()
  await assert.rejects(startRun(join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md"), { config: cfg, mock: false, env: { NO_PAID_CALLS: "0", ANTHROPIC_API_KEY: "k" } }), MissingTierKey)
  assert.equal(existsSync(cfg.paths.runs), false, "no run folder was made for a run that could not start")
  const id = await startRun(join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md"), { config: cfg, mock: false, env: ALL_KEYS })
  assert.equal(loadState(cfg, id).mock, false, "with every key, the run starts, and is recorded as real")
})

test("roster: the Critic (rival tier) is on another vendor than the lead; every member has an independent first-pass checker; Exa is required only if a member can search", async () => {
  const config = loadConfig(), roster = loadRoster(config), lead = loadAgent(config, "lead-scientist")
  const critic = roster.find((a) => a.name === "critic")
  assert.ok(critic, "the board has a critic")
  assert.equal(critic.model, "rival")
  assert.notEqual(parseModelId(config.models[critic.model]).vendor, parseModelId(config.models[lead.model]).vendor, "the Critic must not share the lead's vendor")
  for (const a of roster) {
    const pick = firstPassModel(config, config.models[a.model])
    assert.ok(pick.independent && pick.model.vendor !== parseModelId(config.models[a.model]).vendor, `${a.name}: the checker of its claims is from the other vendor`)
  }
  // With every key but Exa's, a real run starts exactly when no member holds the search tool (today none does).
  const searchers = roster.some((a) => a.tools.includes("exa_search"))
  const cfg = tempConfig()
  const brief = join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md")
  const noExa = { NO_PAID_CALLS: "0", ANTHROPIC_API_KEY: "fake", OPENAI_API_KEY: "fake" } as NodeJS.ProcessEnv
  if (searchers) await assert.rejects(startRun(brief, { config: cfg, mock: false, env: noExa }), /EXA_API_KEY/)
  else assert.ok(await startRun(brief, { config: cfg, mock: false, env: noExa }), "no member searches: no Exa key is needed")
})

test("with no evidence pool a literature claim is unsupported without a model call; only brief claims reach the first pass", async () => {
  const { d, calls } = deps()
  d.state.evidence = {}
  d.evidenceFor = (s: string) => (s === "brief" ? "the brief says CMP-0517 has pERK IC50 of 95 nM" : undefined)
  await checkClaims(d, 1, "scout", [claim("Sotorasib gives a 37% response rate", "literature", "https://pubmed.example/1"), claim("CMP-0517 has pERK IC50 of 95 nM", "brief", "brief")])
  assert.equal(d.state.ledger[0].verdict, "unsupported")
  assert.match(d.state.ledger[0].note, /source is not in the screened evidence pool/)
  assert.equal(calls.firstPass, 1, "one call, for the brief claim only")
})

test("the start-up line says one thing: scripted, local or real", () => {
  const config = loadConfig()
  assert.match(boardModeLine(config, true, undefined, { NO_PAID_CALLS: "1" }), /SCRIPTED \(paid calls are off\)/)
  assert.match(boardModeLine(config, true, undefined, { NO_PAID_CALLS: "0" }), /SCRIPTED \(DRUG_BOARD_MOCK=1\), although paid calls are ON/)
  assert.match(boardModeLine(config, true, "ollama/qwen2.5:14b", {}), /LOCAL model ollama\/qwen2.5:14b/)
  assert.match(boardModeLine(config, false, undefined, { NO_PAID_CALLS: "0" }), /REAL \(anthropic\/claude-sonnet-5-5.*capped at \$5/)
})

// ── fakes for the cheap model ─────────────────────────────────────────────────────────────────────

/** Anthropic and OpenAI as faux providers with the real ids. Every call is recorded: provider, model, options. */
function fakeModels(reply: (provider: string, user: string) => string) {
  const calls: { provider: string; model: string; options: any; user: string }[] = []
  const models = createModels()
  const spec = { anthropic: [["claude-haiku-5-5", 0.1], ["claude-sonnet-5-5", 2]], openai: [["gpt-4o-mini", 0.15], ["gpt-5-mini", 0.25]] } as const
  for (const [provider, list] of Object.entries(spec)) {
    const faux = fauxProvider({ provider, models: list.map(([id, cost]) => ({ id, cost: { input: cost, output: cost * 5, cacheRead: 0, cacheWrite: 0 } })) })
    faux.setResponses(Array.from({ length: 50 }, () => (ctx: any) => fauxAssistantMessage(reply(provider, String(ctx.messages.at(-1)?.content ?? "")))))
    models.setProvider(faux.provider)
  }
  const complete = models.completeSimple.bind(models)
  models.completeSimple = ((model: any, context: any, options: any) => { calls.push({ provider: model.provider, model: model.id, options, user: String(context.messages.at(-1)?.content ?? "") }); return complete(model, context, options) }) as typeof models.completeSimple
  return { models, calls }
}
const SOURCE = "Compound X inhibited KRAS G12C with an IC50 of 5.2 nM in H358 cells. No activity was seen against wild type KRAS at concentrations below 10 uM."
const JSON_OK = (rulings: unknown[]) => JSON.stringify({ rulings })
const live = (models: Models) => new FirstPass(models, loadConfig(), false)

test("first pass: a supported claim with a real quote is verified, by a model from the OTHER vendor than its author", async () => {
  const { models, calls } = fakeModels(() => JSON_OK([{ i: 0, verdict: "supports", quote: "Compound X inhibited KRAS G12C with an IC50 of 5.2 nM in H358 cells." }]))
  const byClaude = await paidAllowed(() => live(models).check("anthropic/claude-sonnet-5-5", ["Compound X has an IC50 of 5.2 nM against KRAS G12C"], SOURCE))
  assert.equal(byClaude[0].verdict, "verified")
  assert.match(byClaude[0].quote ?? "", /5\.2 nM/)
  assert.equal(byClaude[0].checkedBy, "openai/gpt-4o-mini")
  assert.deepEqual(calls.map((c) => c.provider), ["openai"], "a Claude member's claim goes to OpenAI, and only there")
  const byOpenAI = await paidAllowed(() => live(models).check("openai/gpt-5-mini", ["Compound X has an IC50 of 5.2 nM against KRAS G12C"], SOURCE))
  assert.equal(byOpenAI[0].checkedBy, "anthropic/claude-haiku-5-5")
  assert.deepEqual(calls.map((c) => c.provider), ["openai", "anthropic"], "the Skeptic's (OpenAI) claim goes to Anthropic")
})

test("independence: firstPassModel never returns the author's vendor when another is configured, and says so when none is", () => {
  const config = loadConfig()
  for (const member of ["anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "openai/gpt-5-mini", "openai/gpt-5.5"]) {
    const pick = firstPassModel(config, member)
    assert.equal(pick.independent, true)
    assert.notEqual(pick.model.vendor, parseModelId(member).vendor, member)
  }
  assert.equal(firstPassModel(config, undefined).independent, false, "an unknown author cannot be shown independent")
  const oneVendor = { ...config, checkers: { ...config.checkers, first_pass: { ...config.checkers.first_pass, alt: "anthropic/claude-sonnet-5-5" } } }
  const same = firstPassModel(oneVendor, "anthropic/claude-sonnet-5-5")
  assert.equal(same.independent, false)
  // ... and a same-vendor check can never verify: even a perfect quote escalates.
  assert.deepEqual(route({ verdict: "supports", quote: "Compound X inhibited KRAS G12C with an IC50 of 5.2 nM in H358 cells." }, "Compound X has an IC50 of 5.2 nM", SOURCE, false).verdict, "escalate")
})

test("malformed or out-of-range checker output is never verified: it escalates", async () => {
  const quote = "Compound X inhibited KRAS G12C with an IC50 of 5.2 nM in H358 cells."
  const claim = ["Compound X has an IC50 of 5.2 nM"]
  const replies: Record<string, string> = {
    "not json": "VERDICT: verified. The source supports it.",
    "empty": "",
    "no rulings array": JSON.stringify({ verdict: "supports", quote }),
    "array root": JSON.stringify([{ i: 0, verdict: "supports", quote }]),
    "truncated": JSON_OK([{ i: 0, verdict: "supports", quote }]).slice(0, -8),
    "unknown word": JSON_OK([{ i: 0, verdict: "verified", quote }]),
    "yes": JSON_OK([{ i: 0, verdict: "yes", quote }]),
    "index out of range": JSON_OK([{ i: 5, verdict: "supports", quote }]),
    "negative index": JSON_OK([{ i: -1, verdict: "supports", quote }]),
    "string index": JSON_OK([{ i: "0", verdict: "supports", quote }]),
    "fractional index": JSON_OK([{ i: 0.5, verdict: "supports", quote }]),
    "duplicate index": JSON_OK([{ i: 0, verdict: "supports", quote }, { i: 0, verdict: "supports", quote }]),
    "missing quote": JSON_OK([{ i: 0, verdict: "supports" }]),
    "quote not a string": JSON_OK([{ i: 0, verdict: "supports", quote: 7 }]),
    "unclear": JSON_OK([{ i: 0, verdict: "unclear", quote: "" }]),
  }
  for (const [name, text] of Object.entries(replies)) {
    assert.notEqual(readRulings(text, 1)[0].verdict, "supports", `readRulings: ${name}`)
    const { models } = fakeModels(() => text)
    const [r] = await paidAllowed(() => live(models).check("anthropic/claude-sonnet-5-5", claim, SOURCE))
    assert.equal(r.verdict, "escalate", `${name}: a reply that is not a clean ruling escalates, it never verifies`)
  }
  // A good reply for claim 0 must not leak into claim 1 when the reply is short.
  assert.deepEqual(readRulings(JSON_OK([{ i: 0, verdict: "not_stated", quote: "" }]), 2).map((r) => r.verdict), ["not_stated", "invalid"])
  // Sanity: the same text, well formed, does verify (so the table above tests the format, not a broken fixture).
  const { models } = fakeModels(() => JSON_OK([{ i: 0, verdict: "supports", quote }]))
  assert.equal((await paidAllowed(() => live(models).check("anthropic/claude-sonnet-5-5", claim, SOURCE)))[0].verdict, "verified")
})

test("a fabricated quote, a short or elided one, or a missing number is rejected", () => {
  const supports = (quote: string, claim = "Compound X has an IC50 of 5.2 nM") => route({ verdict: "supports", quote }, claim, SOURCE).verdict
  assert.equal(supports("Compound X inhibited KRAS G12C with an IC50 of 5.2 nM in H358 cells."), "verified")
  assert.equal(supports("compound x   inhibited KRAS G12C with an IC50 of 5.2 nM\nin H358 cells."), "verified", "case and layout are ignored")
  assert.equal(supports("Compound X inhibited KRAS G12C with an IC50 of 0.5 nM in H358 cells."), "escalate", "one changed number: the quote is not in the source")
  assert.equal(supports("Compound X is a potent, selective and safe KRAS G12C inhibitor in H358 cells."), "escalate", "a plausible sentence the source never says")
  assert.equal(supports("IC50 of 5.2 nM"), "escalate", `shorter than ${MIN_QUOTE} characters`)
  assert.equal(supports("Compound X inhibited KRAS G12C ... in H358 cells."), "escalate", "an elided quote is not in the source")
  assert.equal(supports("No activity was seen against wild type KRAS at concentrations below 10 uM."), "escalate", "a real passage that lacks the claim's number 5.2")
  assert.equal(quoteInSource("x".repeat(30), SOURCE), false)
  assert.equal(route({ verdict: "contradicts", quote: "The source says the opposite, trust me, it does." }, "c", SOURCE).verdict, "escalate", "a contradiction needs a real quote too")
  assert.equal(route({ verdict: "contradicts", quote: "No activity was seen against wild type KRAS at concentrations below 10 uM." }, "Compound X is active against wild type KRAS", SOURCE).verdict, "contradicted")
  assert.equal(route({ verdict: "not_stated", quote: "" }, "c", SOURCE).verdict, "unsupported")
})

test("the number rule ignores digits inside names and keeps the sign", () => {
  const quote = "The log2 fold change was -4.96 in treated cells, measured in H358 cells for CMP-0517."
  const at = (claim: string) => route({ verdict: "supports", quote }, claim, quote).verdict
  assert.equal(at("CMP-0517 has a log2 fold change of -4.96 in H358"), "verified", "0517, 2 and 358 are parts of names")
  assert.equal(at("CMP-0517 has a log2 fold change of 4.96 in H358"), "escalate", "a flipped sign is not the quoted number")
  assert.equal(at("CMP-0517 has a log2 fold change of -4.9 in H358"), "escalate")
})

test("a quote with the escape the model was shown (&lt;) still matches the source's '<'", () => {
  const source = "Potency was IC50 < 10 nM in the cell assay, measured in triplicate."
  assert.equal(quoteInSource("Potency was IC50 &lt; 10 nM in the cell assay", source), true)
})

test("triage: strict reading, unscreened items are kept, off-topic and result-free items are dropped", () => {
  const entry = (i: number, a: string, r: string, t: string) => ({ i, answers_question: a, reports_results: r, study_type: t })
  const out = readTriage(JSON.stringify({ items: [entry(0, "yes", "yes", "in_vitro"), entry(1, "no", "yes", "in_vitro"), entry(2, "partly", "no", "review"), entry(3, "yes", "no", "in_vivo"), entry(1, "yes", "yes", "clinical"), entry(4, "maybe", "yes", "x")] }), 6)
  assert.deepEqual(out.map(keepItem), [true, true, true, false, true, true], "index 1 is repeated, 4 is invalid, 5 is missing: those are unscreened, so kept; 3 reports nothing and is not a review")
  assert.deepEqual(readTriage("garbage", 2), [undefined, undefined])
  assert.equal(keepItem({ answers_question: "no", reports_results: "yes", study_type: "clinical" }), false)
})

test("first pass and triage use the cheap model with reasoning off and a small output cap", async () => {
  const config = loadConfig()
  const models = createModels(); models.setProvider(anthropicProvider()); models.setProvider(openaiProvider())
  // The reasoning option each first-pass model needs to be as quiet as pi-ai allows (read from its own catalog entry):
  assert.equal(quietReasoning(models.getModel("anthropic", "claude-haiku-5-5")!), undefined, "haiku: thinking is off when no level is asked for")
  assert.equal(quietReasoning(models.getModel("openai", "gpt-4o-mini")!), undefined, "gpt-4o-mini has no reasoning mode at all")
  assert.equal(quietReasoning(models.getModel("openai", "gpt-5.4-nano")!), undefined, "this one can be switched off (pi-ai sends effort none)")
  assert.equal(quietReasoning(models.getModel("openai", "gpt-5-mini")!), "minimal", "gpt-5-mini cannot be switched off: minimal is its floor")
  assert.equal(models.getModel("openai", parseModelId(config.checkers.first_pass.alt).id)!.reasoning, false)
  const { models: fake, calls } = fakeModels(() => JSON_OK([{ i: 0, verdict: "not_stated", quote: "" }]))
  await paidAllowed(() => live(fake).check("openai/gpt-5-mini", ["a claim"], SOURCE))
  await paidAllowed(() => live(fake).triage([{ url: "u", title: "t", text: "kras" }], "q"))
  for (const c of calls) {
    assert.ok(c.options.maxTokens > 0 && c.options.maxTokens <= 1_500, `output is capped: ${c.options.maxTokens}`)
    assert.ok(c.options.reasoning === undefined || c.options.reasoning === "minimal", "never a reasoning level above minimal")
  }
})

test("paid off: the first pass fetches nothing and touches no model", async () => {
  const before = outbound.length
  const { models, calls } = fakeModels(() => "{}")
  await assert.rejects(live(models).check("anthropic/claude-sonnet-5-5", ["c"], SOURCE), PaidCallsOff)
  await assert.rejects(live(models).triage([{ url: "u", title: "t", text: "x" }], "q"), PaidCallsOff)
  assert.equal(calls.length, 0)
  assert.equal(outbound.length, before)
  // Scripted mode answers without any model and says so.
  const scripted = await new FirstPass(models, loadConfig(), true).check("anthropic/claude-sonnet-5-5", ["Compound X inhibited KRAS G12C in H358 cells"], SOURCE)
  assert.equal(scripted[0].checkedBy, "scripted")
  assert.equal(calls.length, 0)
})

test("scripted first pass is deterministic and keeps the word-overlap routes", async () => {
  const fp = new FirstPass(fakeModels(() => "").models, loadConfig(), true)
  const claims = ["Compound X inhibited KRAS G12C with an IC50 of 5.2 nM in H358 cells", "Piperazine quinazolines show no resistance and no hERG issues", "Unrelated statement about weather patterns today", "Compound X may inhibit something else entirely maybe"]
  const a = (await fp.check(undefined, claims, SOURCE)).map((r) => r.verdict)
  assert.deepEqual(a, (await fp.check(undefined, claims, SOURCE)).map((r) => r.verdict))
  assert.equal(a[0], "verified"); assert.equal(a[1], "contradicted"); assert.equal(a[2], "unsupported")
})

// ── claim routing: replay, carry-over, caps ───────────────────────────────────────────────────────

const claim = (text: string, kind: Claim["kind"] = "literature", source = "https://a.example/paper"): Claim => ({ kind, text, source })
function deps(over: Record<string, unknown> = {}) {
  const calls = { firstPass: 0, computed: 0, literature: 0 }
  const d = {
    state: { ledger: [] as any[], escalations: 0, checkerUsd: 0 },
    maxEscalations: 12,
    firstPass: async (_m: string, cs: string[]) => { calls.firstPass++; return cs.map((c) => (c.includes("unsure") ? { verdict: "escalate" as const, reason: "x" } : { verdict: "verified" as const, quote: "q", checkedBy: "openai/gpt-4o-mini" })) },
    computedCheck: async () => { calls.computed++; return { verdict: "verified" as const, note: "n", usd: 0.2 } },
    literatureCheck: async () => { calls.literature++; return { verdict: "contradicted" as const, note: "n", usd: 0.1 } },
    evidenceFor: (s: string) => (s === "https://a.example/paper" ? "evidence" : undefined),
    save: () => {}, emit: () => {},
    ...over,
  }
  return { d: d as any, calls }
}

test("a claim ruled in an earlier round is carried, not checked or paid for again; a crash-replay does not pay twice either", async () => {
  const { d, calls } = deps()
  await checkClaims(d, 1, "tox", [claim("A is potent"), claim("B is unsure")])
  assert.deepEqual([calls.firstPass, calls.literature], [1, 1])
  // Round 2: the same member repeats both claims.
  const lines = await checkClaims(d, 2, "tox", [claim("A is potent"), claim("B is unsure")])
  assert.deepEqual([calls.firstPass, calls.literature], [1, 1], "no second paid check in a later round")
  assert.equal(d.state.ledger.filter((r: any) => r.round === 2).length, 2, "but round 2 still has its own ledger rows")
  assert.match(d.state.ledger.find((r: any) => r.round === 2 && r.claim === "A is potent").note, /carried over from round 1/)
  assert.deepEqual(lines.sort(), ["[contradicted] B is unsure", "[verified] A is potent"])
  // Replay of round 2 after a crash: rows exist, nothing is called.
  await checkClaims(d, 2, "tox", [claim("A is potent"), claim("B is unsure")])
  assert.deepEqual([calls.firstPass, calls.literature], [1, 1])
  assert.equal(d.state.ledger.length, 4)
  // Another member's identical claim is NOT carried over (it is a different author, so a different checker vendor).
  await checkClaims(d, 2, "chem", [claim("A is potent")])
  assert.equal(calls.firstPass, 2)
})

test("what is not carried: unchecked rulings, a checker's own failure, and 'not in the pool'", async () => {
  const { d, calls } = deps({ maxEscalations: 0 })
  await checkClaims(d, 1, "tox", [claim("B is unsure")]) // escalation cap 0: recorded unchecked
  assert.equal(d.state.ledger[0].verdict, "unchecked")
  await checkClaims(d, 2, "tox", [claim("B is unsure")])
  assert.equal(calls.firstPass, 2, "an unchecked claim is looked at again")
  const second = deps({ literatureCheck: async () => ({ verdict: "unsupported", note: "checker failed: timed out", usd: 0 }) })
  await checkClaims(second.d, 1, "tox", [claim("B is unsure")])
  await checkClaims(second.d, 2, "tox", [claim("B is unsure")])
  assert.equal(second.calls.firstPass, 2, "a failed check is retried")
})

test("a first-pass reply that is missing or not a verdict escalates; it is never recorded as verified", async () => {
  const { d, calls } = deps({ firstPass: async () => [{ verdict: "unchecked" }, undefined, { verdict: "maybe" }] })
  await checkClaims(d, 1, "tox", [claim("one"), claim("two"), claim("three")])
  assert.equal(calls.literature, 3)
  assert.ok(d.state.ledger.every((r: any) => r.checker === "openai" && r.verdict === "contradicted"))
})

test("rows record the source a quote was checked against and whether it was found; an escalated row says why the first pass escalated", async () => {
  const { d } = deps({ firstPass: async (_m: string, cs: string[]) => cs.map((c) => (c.includes("fake")
    ? { verdict: "escalate" as const, quoteFound: false, reason: "the quoted passage is not in the source" }
    : { verdict: "verified" as const, quote: "a real passage of the source", quoteFound: true, checkedBy: "openai/gpt-4o-mini" })) })
  await checkClaims(d, 1, "tox", [claim("A is potent"), claim("a fake quote claim")])
  const ok = d.state.ledger[0], fake = d.state.ledger[1]
  assert.deepEqual([ok.source, ok.quoteFound], ["https://a.example/paper", true])
  assert.equal(fake.checker, "openai"); assert.equal(fake.source, "https://a.example/paper")
  assert.match(fake.note, /first pass escalated: the quoted passage is not in the source/)
  assert.deepEqual([route({ verdict: "supports", quote: "x".repeat(30) }, "c", SOURCE).quoteFound, route({ verdict: "not_stated", quote: "" }, "c", SOURCE).quoteFound], [false, undefined])
})

test("the ledger rows say who checked: first-pass, with the model and the quote it relied on", async () => {
  const { d } = deps()
  await checkClaims(d, 1, "tox", [claim("A is potent"), claim("not in pool", "literature", "https://other.example")])
  const row = d.state.ledger.find((r: any) => r.claim === "A is potent")
  assert.equal(row.checker, "first-pass"); assert.equal(row.checkedBy, "openai/gpt-4o-mini"); assert.match(row.note, /quoted: "q"/); assert.equal(row.p, undefined); assert.equal(row.source, "https://a.example/paper", "the cited source is recorded on the row")
  assert.equal(d.state.ledger.find((r: any) => r.claim === "not in pool").verdict, "unsupported")
})

test("once max_usd is reached no first-pass or escalation call is made, and the claim is unchecked", async () => {
  let cap = false
  const { d, calls } = deps({ capReached: async () => cap })
  await checkClaims(d, 1, "tox", [claim("A is potent")])
  assert.equal(calls.firstPass, 1)
  cap = true
  await checkClaims(d, 1, "tox", [claim("C is selective"), claim("logP 3", "computed", "calc")])
  assert.equal(calls.firstPass, 1, "no first-pass call past the cap")
  assert.equal(calls.computed, 0)
  assert.deepEqual(d.state.ledger.slice(1).map((r: any) => r.verdict), ["unchecked", "unchecked"])
  // The cap also stops the escalation after a first pass that wanted one.
  cap = false
  const second = deps({ capReached: async () => (second.calls.firstPass > 0) })
  await checkClaims(second.d, 1, "tox", [claim("B is unsure")])
  assert.equal(second.calls.literature, 0)
  assert.equal(second.d.state.escalations, 0)
})

test("a computed claim is not sent to a checker that cannot run code: unchecked, with that reason, no escalation used", async () => {
  const config = loadConfig()
  assert.equal(computedCanRun(config), false, "the shipped command is --restricted with Read Write")
  assert.equal(computedCanRun({ ...config, checkers: { ...config.checkers, claude_code_cmd: "claude -p", claude_code_tools: "Read Write Bash(python3:*)" } }), true)
  assert.equal(computedCanRun({ ...config, checkers: { ...config.checkers, claude_code_cmd: "claude -p --restricted", claude_code_tools: "Bash" } }), false)
  const { d, calls } = deps({ computedCanRun: false })
  await checkClaims(d, 1, "chem", [claim("logP is 3.1", "computed", "calc")])
  assert.equal(calls.computed, 0)
  assert.equal(d.state.escalations, 0)
  assert.equal(d.state.ledger[0].verdict, "unchecked")
  assert.equal(d.state.ledger[0].note, NOT_RERUN)
  const can = deps({ computedCanRun: true })
  await checkClaims(can.d, 1, "chem", [claim("logP is 3.1", "computed", "calc")])
  assert.equal(can.calls.computed, 1)
  assert.equal(can.d.state.escalations, 1, "when it can run, it is behind max_escalations like the others")
})

test("round gate: a run is wrapped up BEFORE the round that is expected to pass max_usd", async () => {
  const config = tempConfig({ max_usd: 1 })
  const memo = async <T extends string | number>(_n: string, v: T) => v
  const state = { rounds: 1, startedAt: Date.now(), finalRound: undefined, lastRoundUsd: 0.6 }
  const g = await gateRound(state, config, false, memo, async () => 0.5)
  assert.match(g.refusal, /WRAP UP: .*another round is expected to cost about \$0\.60/)
  assert.equal((await gateRound({ ...state, lastRoundUsd: 0.4 }, config, false, memo, async () => 0.5)).refusal, "", "0.5 + 0.4 fits under 1")
  assert.equal((await gateRound(state, config, true, memo, async () => 0.5)).refusal, "", "the one final round is still allowed")
  assert.equal(overLimit(config, 1, Date.now(), 0.5, 0), undefined, "without a reserve nothing changed")
})

// ── Exa: per run, per day, lifetime ───────────────────────────────────────────────────────────────

const found = (n = 1, costUsd?: number) => ({ items: Array.from({ length: n }, (_, i) => ({ url: `https://x.example/${i}`, title: "t", text: "kras" })), notices: [] as string[], ...(costUsd === undefined ? {} : { costUsd }) })
function searchWorld(over: Record<string, unknown> = {}, config = tempConfig({ max_searches: 3 })) {
  let searches = 0, capped = false
  const state: any = { runId: "r1", searched: undefined }
  const d: any = { state, config, mock: false, search: async () => { searches++; return found() }, capReached: async () => capped, ...over }
  return { d, state, config, count: () => searches, cap: () => { capped = true } }
}
const lines = (config: BoardConfig) => (existsSync(exaLedgerFile(config)) ? readFileSync(exaLedgerFile(config), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])

test("Exa per run: searches are capped, counted, and a crash-replay of the same call does not search or charge again", async () => {
  const w = searchWorld()
  for (const id of ["c1", "c2", "c3"]) assert.ok((await searchOnce(w.d, id, { query: "q", objective: "o" })).result)
  assert.equal(w.count(), 3)
  const fourth = await searchOnce(w.d, "c4", { query: "q", objective: "o" })
  assert.equal(fourth.result, undefined)
  assert.match(fourth.refused ?? "", /Search budget used up: 3 of 3/)
  assert.equal(w.count(), 3, "no fourth search")
  const rows = lines(w.config).length
  const replay = await searchOnce(w.d, "c2", { query: "q", objective: "o" })
  assert.ok(replay.result)
  assert.equal(w.count(), 3, "replay reads the stored result")
  assert.equal(lines(w.config).length, rows, "and writes nothing to the ledger")
})

test("Exa cost counts toward max_usd, using the cost Exa reports and the assumed price only when it reports none", async () => {
  const w = searchWorld({ search: async () => found(1, 0.02) })
  await searchOnce(w.d, "a", { query: "q", objective: "o" })
  assert.deepEqual([w.state.searched.a.usd, w.state.searched.a.basis], [0.02, "reported"])
  const assumed = searchWorld()
  await searchOnce(assumed.d, "a", { query: "q", objective: "o" })
  assert.deepEqual([assumed.state.searched.a.usd, assumed.state.searched.a.basis], [0.007, "assumed"])
  assert.ok(Math.abs(exaTotal(exaLedgerFile(w.config)) - 0.02) < 1e-9, "the ledger nets to what Exa reported")
  assert.ok(Math.abs(exaTotal(exaLedgerFile(assumed.config)) - 0.007) < 1e-9)
  assert.equal(reportedCost({ total: 0.011 }), 0.011); assert.equal(reportedCost(0.5), 0.5)
  for (const bad of [undefined, "0.1", -1, NaN, {}, { total: "x" }, null]) assert.equal(reportedCost(bad), undefined, String(bad))
  // The run's total, which max_usd and daily_usd are compared with, includes Exa and the first-pass checker.
  assert.ok(Math.abs(totalUsd({ searched: w.state.searched, firstPassUsd: 0.03, checkerUsd: 0.1 }, 1) - 1.15) < 1e-9)
  assert.equal(totalUsd({ searched: undefined, firstPassUsd: undefined, checkerUsd: 0 }, 1), 1)
})

test("Exa spend is inside the daily cap: a run's saved spend includes its searches", async () => {
  const config = tempConfig({ daily_usd: 1 })
  const dir = join(config.paths.runs, "r1"); mkdirSync(dir, { recursive: true })
  const state: any = { runId: "r1", startedAt: Date.now(), searched: { a: { items: [], notices: [], usd: 0.4, basis: "reported" } }, checkerUsd: 0, firstPassUsd: 0.1, finished: true, mock: false }
  state.usd = totalUsd(state, 0.5)
  writeFileSync(join(dir, "run.json"), JSON.stringify(state))
  assert.ok(Math.abs(spentToday(config) - 1.0) < 1e-9, "0.5 models + 0.1 first pass + 0.4 Exa")
})

test("Exa lifetime ceiling: at the ceiling a real run refuses to search, with the total and the ceiling named, and no fixture fallback", async () => {
  const config = tempConfig({ max_searches: 50, exa_ceiling_usd: 40 })
  mkdirSync(join(config.paths.runs), { recursive: true })
  appendFileSync(exaLedgerFile(config), JSON.stringify({ at: 1, runId: "old", callId: "x", usd: 39.995, kind: "reserve", basis: "assumed" }) + "\n")
  const w = searchWorld({}, config)
  const out = await searchOnce(w.d, "c1", { query: "q", objective: "o" })
  assert.equal(out.result, undefined, "no results at all, in particular no fixture papers")
  assert.equal(out.refused, ceilingMessage(39.995, 40))
  assert.match(out.refused ?? "", /recorded \$\d+\.\d\d of Exa spend, and the ceiling is \$40\.00/)
  assert.equal(w.count(), 0, "Exa was not called")
  assert.equal(lines(config).length, 1, "and nothing was reserved")
  // 39.99 + 0.007 fits; one more would not: the second parallel call is refused.
  const parallel = tempConfig({ max_searches: 50, exa_ceiling_usd: 40 })
  mkdirSync(parallel.paths.runs, { recursive: true })
  appendFileSync(exaLedgerFile(parallel), JSON.stringify({ at: 1, runId: "old", callId: "x", usd: 39.99, kind: "reserve", basis: "assumed" }) + "\n")
  const pw = searchWorld({}, parallel)
  const [a, b] = await Promise.all([searchOnce(pw.d, "p1", { query: "q", objective: "o" }), searchOnce(pw.d, "p2", { query: "q", objective: "o" })])
  assert.ok(a.result && !b.result, "reservations are written before the call, so parallel searches cannot all pass the check")
  // A damaged ledger line never lowers the total.
  appendFileSync(exaLedgerFile(parallel), "not json\n")
  assert.ok(exaTotal(exaLedgerFile(parallel)) > 39.99 + 0.007)
})

test("Exa: a failed search is refunded in the ledger and is not stored; the error still surfaces", async () => {
  const w = searchWorld({ search: async () => { throw new Error("Exa 500") } })
  await assert.rejects(searchOnce(w.d, "c1", { query: "q", objective: "o" }), /Exa 500/)
  assert.equal(exaTotal(exaLedgerFile(w.config)), 0)
  assert.equal(w.state.searched, undefined)
})

test("Exa: once max_usd is reached the next search is refused before any call", async () => {
  const w = searchWorld()
  await searchOnce(w.d, "c1", { query: "q", objective: "o" })
  w.cap()
  const out = await searchOnce(w.d, "c2", { query: "q", objective: "o" })
  assert.match(out.refused ?? "", /Spend cap reached/)
  assert.equal(w.count(), 1)
})

test("Exa: a scripted run searches fixtures, counts nothing and writes no ledger", async () => {
  const w = searchWorld({ mock: true, search: (q: string, o: string) => exaSearch(q, o, true) })
  const out = await searchOnce(w.d, "c1", { query: "q", objective: "o" })
  assert.ok((out.result?.items.length ?? 0) > 0)
  assert.equal(existsSync(exaLedgerFile(w.config)), false)
  assert.equal(w.state.searched, undefined)
})

test("a real run with no Exa key or no OpenAI key stops; fabricated results exist only in scripted mode", async () => {
  await assert.rejects(exaSearch("q", "o", false, {}), MissingExaKey)
  await assert.rejects(exaSearch("q", "o", false, { EXA_API_KEY: "  " }), MissingExaKey)
  assert.ok((await exaSearch("q", "o", true, {})).items.length > 0, "scripted: fixtures, labelled by the run's own scripted flag")
  const config = loadConfig()
  const before = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    await paidAllowed(async () => { await assert.rejects(openaiCheck(createModels(), config, "claim", "evidence", false), /OPENAI_API_KEY is not set/) })
  } finally { if (before !== undefined) process.env.OPENAI_API_KEY = before }
  assert.equal((await openaiCheck(createModels(), config, "claim", "evidence", true)).note.startsWith("mock:"), true, "scripted ruling is labelled mock")
  assert.equal(outbound.length, 0, "and no request left the machine")
})

test("the catalog shows the Exa total and ceiling for the dashboard", () => {
  const config = tempConfig({ exa_ceiling_usd: 40 })
  mkdirSync(config.paths.runs, { recursive: true })
  assert.deepEqual(buildCatalog(config, { NO_PAID_CALLS: "1", EXA_API_KEY: "k" }).search.exa, { keyPresent: true, usedUsd: 0, ceilingUsd: 40 })
  appendFileSync(exaLedgerFile(config), JSON.stringify({ at: 1, runId: "r", callId: "c", usd: 1.25, kind: "reserve", basis: "assumed" }) + "\n")
  assert.deepEqual(buildCatalog(config, { NO_PAID_CALLS: "1" }).search.exa, { keyPresent: false, usedUsd: 1.25, ceilingUsd: 40 })
})

// ── old runs and a whole scripted run ─────────────────────────────────────────────────────────────

test("a run recorded before this change still loads: checker \"jev\", jevUsd, no new fields", () => {
  const config = tempConfig(), dir = join(config.paths.runs, "old-run")
  mkdirSync(dir, { recursive: true })
  const ledger = [{ key: "1:tox:abc", round: 1, member: "tox", claim: "A", kind: "literature", verdict: "verified", checker: "jev", p: 0.9 }]
  writeFileSync(join(dir, "run.json"), JSON.stringify({ runId: "old-run", briefFile: "b.md", startedAt: 1, members: {}, rounds: 1, lastRound: [], evidence: {}, ledger, escalations: 0, checkerUsd: 0, jevUsd: 0.01, usd: 0.5, finished: true, mock: false }))
  new EventLog(join(dir, "events.jsonl")).emit("claim:1:tox:abc", { type: "claim.checked", round: 1, member: "tox", claim: "A", kind: "literature", verdict: "verified", checker: "jev", p: 0.9 })
  const state = loadState(config, "old-run")
  assert.equal(state.ledger[0].checker, "jev")
  assert.deepEqual(summarize(dir, state), { rounds: 1, claims: 1 })
  assert.equal(EventLog.read(join(dir, "events.jsonl"))[0].type, "claim.checked")
  assert.equal(totalUsd(state, 0.5), 0.5, "no searched / firstPassUsd on an old run: nothing added")
  const real = join(import.meta.dirname, "../../board/runs"), repoRun = existsSync(real) ? readdirSync(real).find((d) => existsSync(join(real, d, "run.json"))) : undefined
  if (repoRun) assert.ok(loadState(loadConfig(), repoRun).runId, "a run recorded in this checkout loads")
})

test("a whole scripted board run: memo and claim verdicts come out, rulings carry the new checker name, no key or network is used", async () => {
  const config = tempConfig({ max_minutes: 5 })
  config.board = config.board.slice(0, 3)
  const brief = join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md")
  const id = await startRun(brief, { config, mock: true })
  await runBoard(id, undefined, { config, mock: true })
  const dir = join(config.paths.runs, id)
  assert.ok(existsSync(join(dir, "memo.md")), "a memo was written")
  const ledger = JSON.parse(readFileSync(join(dir, "verification_ledger.json"), "utf8")) as { verdict: string; checker: string }[]
  assert.ok(ledger.length > 0)
  assert.ok(ledger.every((r) => ["verified", "contradicted", "unsupported", "unchecked"].includes(r.verdict)))
  assert.ok(ledger.some((r) => r.checker === "first-pass"), "claims were ruled by the first pass")
  assert.ok(!ledger.some((r) => r.checker === "jev"))
  const state = loadState(config, id)
  assert.equal(state.mock, true)
  assert.equal(state.usd, 0)
  assert.equal(state.searched, undefined, "a scripted run stores no Exa accounting")
  assert.equal(existsSync(exaLedgerFile(config)), false)
  assert.equal(outbound.length, 0)
})

test("the practice run (default roster, the example brief) still shows every verdict path", async () => {
  const config = tempConfig({ max_minutes: 5 })
  const id = await startRun(join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md"), { config, mock: true })
  await runBoard(id, undefined, { config, mock: true })
  const events = EventLog.read(join(config.paths.runs, id, "events.jsonl"))
  const rows = loadState(config, id).ledger
  const has = (verdict: string, checker?: string) => rows.some((r) => r.verdict === verdict && (!checker || r.checker === checker))
  assert.ok(has("verified"), "holds up")
  assert.ok(has("contradicted"), "proven wrong: without one the product's main feature is hidden")
  assert.ok(has("unsupported"), "not enough evidence")
  assert.ok(has("unsupported", "openai") || has("verified", "claude-code"), "escalated to a second checker")
  assert.ok(rows.length >= 15 && events.length >= 40, `a practice run is not a handful of events (claims ${rows.length}, events ${events.length})`)
  assert.ok(rows.every((r) => typeof r.source === "string"), "every row records the source it cited")
})

test("the practice run has an evidence step", { todo: "no board member holds exa_search (every `tools` is empty), so a run has no evidence.triaged event and no literature claim. Proposed smallest fix: `tools: [exa_search]` on board/agents/scout.md; the scripted turn in mock.ts already searches for any member that has the tool." }, async () => {
  const config = tempConfig({ max_minutes: 5 })
  const id = await startRun(join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md"), { config, mock: true })
  await runBoard(id, undefined, { config, mock: true })
  assert.ok(EventLog.read(join(config.paths.runs, id, "events.jsonl")).some((e) => e.type === "evidence.triaged"))
})

test("the engine never leaves fetch as the real one", () => { assert.notEqual(globalThis.fetch, realFetch) })
