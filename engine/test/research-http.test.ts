// The research answer over HTTP: who may ask, the limits, the queue, cancel, the event stream, threads, result files and
// where things are stored. Fakes only (test/fixtures/research/harness.ts); every folder is a temp folder.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer, request } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { DEFAULTS, engine, EUROPEPMC, jsonResponse, KEYS, ORIGIN, paidAllowed, containsKey } = await import("./fixtures/research/harness.ts")
const { createApp } = await import("../src/app.ts")
const { loadConfig, ROOT } = await import("../src/config.ts")
const { researchRoot } = await import("../src/research/spend.ts")
const { answerDir, eventsFile, isAnswerId, isThreadId, listArtifacts, loadRecord, newAnswerId, newThreadId, readArtifact } = await import("../src/research/store.ts")
import type { ResearchRecord, Stamped } from "../src/research/types.ts"

const Q = "Does semaglutide lower the risk of heart attack and stroke in people with obesity who do not have diabetes?"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const of = <T extends Stamped["type"]>(events: Stamped[], type: T) => events.filter((e) => e.type === type) as Extract<Stamped, { type: T }>[]
/** A writer that waits until the test lets it go. */
function held() {
  let release = () => {}
  const gate = new Promise<void>((r) => { release = r })
  return { release, write: async (call: Parameters<typeof DEFAULTS.write>[0], n: number) => { await gate; return DEFAULTS.write(call, n) } }
}
const until = async (ok: () => boolean | Promise<boolean>, what: string) => { for (let i = 0; i < 400; i++) { if (await ok()) return; await sleep(10) } throw new Error(`timed out waiting for ${what}`) }
/** Read an event stream until `stop` says so (or `ms` passed): the frames as {id, event}. */
async function readStream(url: string, headers: Record<string, string>, stop: (e: Stamped) => boolean, ms = 3_000) {
  const abort = new AbortController(), frames: { id: number; event: Stamped }[] = []
  const timer = setTimeout(() => abort.abort(), ms)
  const res = await fetch(url, { headers: { origin: ORIGIN, ...headers }, signal: abort.signal })
  if (res.status !== 200) { clearTimeout(timer); return { status: res.status, frames } }
  let buffer = ""
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += Buffer.from(chunk).toString("utf8")
      for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
        const frame = buffer.slice(0, at); buffer = buffer.slice(at + 2)
        const id = /^id: (\d+)$/m.exec(frame)?.[1], data = /^data: (.*)$/m.exec(frame)?.[1]
        if (id && data) { const event = JSON.parse(data) as Stamped; frames.push({ id: Number(id), event }); if (stop(event)) abort.abort() }
      }
    }
  } catch { /* aborted on purpose */ } finally { clearTimeout(timer) }
  return { status: 200, frames }
}

test("Demo: the same endpoint and the same event shapes, labelled demo, with fixed text, example sources, no model and no network", async () => {
  const e = await engine({ demo: true })
  try {
    const started = await e.ask({ question: "Is hERG a risk for KRAS G12C inhibitors?", effort: "quick" }, { "x-glhf-token": "" })
    assert.deepEqual([started.status, started.body.mode], [202, "demo"], "the dashboard's Origin is enough for a demo answer")
    await e.research.idle()
    const record = await e.record(started.body.id), events = e.events(started.body.id)
    assert.deepEqual([e.net.requests.length, e.calls.length], [0, 0], "no request left the process and no model was called")
    assert.deepEqual([record.status, record.mode, record.usd, record.caps.maxUsd], ["done", "demo", 0, 0])
    assert.deepEqual(record.models, { planner: "scripted", writer: "scripted", checker: "scripted", critic: "scripted" })
    assert.match(record.answer!.markdown, /^\*\*Demo answer\. This is fixed example text, not research\./)
    assert.match(record.opening ?? "", /^This is a demo:/)
    assert.ok(record.sources.length === 3 && record.sources.every((s) => s.provider === "fixture" && /example source/.test(s.note ?? "") && s.url.startsWith("https://example.org/mock/")))
    assert.deepEqual(of(events, "step.started").map((s) => s.step), ["prepare", "search:fixture:1", "evaluate:fixture:1", "write", "check", "review", "revise", "review:2", "save"])
    assert.deepEqual([...new Set(events.map((x) => x.type))].sort(), ["answer.delta", "answer.revised", "answer.written", "artifact.created", "missing", "opening", "recommendations", "research.finished", "research.started", "review.note", "review.resolved", "review.started", "selection", "sources", "sources.cited", "statement.checked", "step.finished", "step.progress", "step.started"])
    const drafts = of(events, "statement.checked").filter((s) => s.stage === "draft").sort((a, b) => a.index - b.index)
    assert.deepEqual(drafts.map((s) => s.verdict), ["verified", "verified", "contradicted"], "the demo shows a sentence that fails, and it is not shown as holding up")
    assert.deepEqual(record.statements.map((s) => [s.verdict, s.checker]), [["verified", "scripted"], ["verified", "scripted"]])
    assert.deepEqual(record.recommendations.map((r) => r.basis), [[2]], "the demo proposal that names source 9 is dropped by code")
    assert.match(readFileSync(join(e.runs, ".research", record.id, "answer.md"), "utf8"), /> DEMO ANSWER\. Fixed example text and example sources\. Not research\./)
    assert.ok(!existsSync(join(e.runs, ".exa-ledger.jsonl")), "a demo answer writes nothing to the Exa ledger")
    const noOrigin = await fetch(`${e.url}/api/research`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Anyone there?" }) })
    assert.equal(noOrigin.status, 403, "neither the dashboard nor a token holder")
  } finally { await e.close() }
})

test("Real: the session token is needed exactly as for POST /api/chat; with paid calls off or a key missing nothing is started", async () => {
  const e = await engine()
  try {
    const noToken = await e.ask({ question: Q }, { "x-glhf-token": "" })
    assert.equal(noToken.status, 401)
    assert.deepEqual(Object.keys(noToken.body).sort(), ["error", "field", "needsToken", "tokenFile"])
    assert.deepEqual([noToken.body.field, noToken.body.needsToken], ["token", true])
    assert.equal((await e.ask({ question: Q }, { "x-glhf-token": "wrong" })).status, 401)
    assert.deepEqual([e.calls.length, e.net.requests.length, e.research.inProgress], [0, 0, 0])
  } finally { await e.close() }
  // A handler built for real mode while paid calls are off refuses, whoever asks.
  const off = await engine({ env: { NO_PAID_CALLS: "1", RESEARCH_PREVIEW: "1", ...KEYS }, deps: { mock: () => false } })
  try {
    const refused = await off.ask({ question: Q })
    assert.equal(refused.status, 403)
    assert.match(String(refused.body.error), /a research answer written by real models: refused\. Paid calls are off \(NO_PAID_CALLS\)/)
    assert.deepEqual([off.calls.length, off.net.requests.length], [0, 0])
  } finally { await off.close() }
  const noKey = await engine({ env: { NO_PAID_CALLS: "0", RESEARCH_PREVIEW: "1", ANTHROPIC_API_KEY: "fake-a", EXA_API_KEY: "fake-e" } })
  try {
    const refused = await noKey.ask({ question: Q })
    assert.deepEqual([refused.status, refused.body.field], [503, "keys"])
    assert.match(String(refused.body.error), /A real answer needs OPENAI_API_KEY, which is not set in \.env\. Nothing was started\./)
    assert.equal(noKey.calls.length, 0)
    assert.ok(!existsSync(join(noKey.runs, ".research")))
  } finally { await noKey.close() }
})

test("what is sent is checked and size-capped: the question, the level, the thread, the body", async () => {
  const e = await engine({ demo: true, research: { max_question_chars: 200 } })
  try {
    const bad: [Record<string, unknown>, number, string][] = [
      [{}, 400, "question"], [{ question: 5 }, 400, "question"], [{ question: "   \n\t " }, 400, "question"], [{ question: "?!" }, 400, "question"], [{ question: "x".repeat(201) }, 400, "question"],
      [{ question: "A real question?", effort: "deep" }, 400, "effort"], [{ question: "A real question?", effort: "max" }, 400, "effort"], [{ question: "A real question?", thread: 7 }, 400, "thread"], [{ question: "A real question?", thread: "t-zzzzzzzzzz" }, 400, "thread"],
    ]
    for (const [body, status, field] of bad) {
      const res = await e.ask(body)
      assert.deepEqual([res.status, res.body.field], [status, field], JSON.stringify(body).slice(0, 60))
    }
    assert.match(String((await e.ask({ question: "A real question?", effort: "deep" })).body.error), /the deep level is a team review/)
    const plain = await fetch(`${e.url}/api/research`, { method: "POST", headers: { "content-type": "text/plain", origin: ORIGIN }, body: JSON.stringify({ question: "A real question?" }) })
    assert.equal(plain.status, 415)
    const huge = await fetch(`${e.url}/api/research`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ question: "ok?", pad: "x".repeat(70_000) }) })
    assert.equal(huge.status, 413)
    const cleaned = await e.answer({ question: "Is  it\u0000 safe\u200b?\r\n\r\n\r\n\r\nReally?" })
    assert.equal(cleaned.record.question, "Is it safe ?\n\nReally?")
    assert.equal(cleaned.record.effort, "quick", "quick is the default level")
    assert.equal((await e.get("/api/research/not-an-id")).status, 404)
    assert.equal((await e.get(`/api/research/${cleaned.id}/nothing`)).status, 404)
    assert.equal((await fetch(`${e.url}/api/research/${cleaned.id}`, { method: "DELETE", headers: { origin: ORIGIN } })).status, 405)
  } finally { await e.close() }
})

test("limits on asking: a rate per Origin, and at most max_in_progress answers being written at once", async () => {
  const rate = await engine({ demo: true, research: { per_origin_per_minute: 2 } })
  try {
    assert.equal((await rate.ask({ question: "First question?" })).status, 202)
    assert.equal((await rate.ask({ question: "Second question?" })).status, 202)
    const third = await rate.ask({ question: "Third question?" })
    assert.deepEqual([third.status, third.body.field], [429, "rate"])
    assert.equal((await rate.ask({ question: "From another origin?" }, { origin: "http://localhost:5317" })).status, 202, "the limit is per Origin")
    await rate.research.idle()
  } finally { await rate.close() }
  const h = held()
  const busy = await engine({ research: { max_in_progress: 2 }, script: { write: h.write } })
  try {
    await paidAllowed(async () => {
      const a = await busy.ask({ question: Q }), b = await busy.ask({ question: "A second, different question about statins?" })
      assert.deepEqual([a.status, b.status], [202, 202])
      const c = await busy.ask({ question: "A third question while two are being written?" })
      assert.deepEqual([c.status, c.body.field], [429, "busy"])
      assert.match(String(c.body.error), /2 answers are being written now/)
      assert.equal(busy.research.inProgress, 2)
      h.release()
      await busy.research.idle()
      assert.equal((await busy.ask({ question: "Now there is room?" })).status, 202)
      await busy.research.idle()
    })
  } finally { h.release(); await busy.close() }
})

test("a follow-up sent while its thread is busy is queued, never steers the running answer, starts when that one ends, and can be cancelled while it waits", async () => {
  const h = held()
  const e = await engine({ script: { write: h.write } })
  try {
    await paidAllowed(async () => {
      const a = await e.ask({ question: Q, effort: "quick" })
      await until(() => e.count("screen") > 0, "the first answer to be at work")
      const B = "And what about people over 75 years old, specifically?"
      const b = await e.ask({ question: B, effort: "quick", thread: a.body.thread })
      assert.deepEqual([b.status, b.body.queued, b.body.after, b.body.thread], [202, true, a.body.id, a.body.thread])
      const c = await e.ask({ question: "A third question in the same thread?", thread: a.body.thread })
      const d = await e.ask({ question: "A fourth question in the same thread?", thread: a.body.thread })
      assert.deepEqual([c.body.after, d.body.after], [b.body.id, c.body.id], "each waits for the one before it")
      const full = await e.ask({ question: "A fifth question in the same thread?", thread: a.body.thread })
      assert.deepEqual([full.status, full.body.field], [429, "queue"])
      await sleep(350) // longer than the queue's poll: a queued question that could start would have started
      assert.deepEqual((await e.record(b.body.id)).status, "queued")
      assert.deepEqual(e.events(b.body.id).map((x) => [x.seq, x.type]), [[1, "research.queued"]])
      assert.equal(e.events(b.body.id)[0].type === "research.queued" && (e.events(b.body.id)[0] as { after: string }).after, a.body.id)
      // A queued question can be cancelled; it never starts.
      const cancelled = await e.cancel(c.body.id)
      assert.deepEqual([cancelled.status, cancelled.body.cancelled, cancelled.body.status], [200, true, "cancelled"])
      assert.match(cancelled.body.message, /Cancelled before it started\. Nothing was spent\./)
      const calls = e.calls.length
      h.release()
      await e.research.idle()
      const [ra, rb, rc, rd] = await Promise.all([a, b, c, d].map((x) => e.record(x.body.id)))
      assert.deepEqual([ra.status, rb.status, rc.status, rd.status], ["done", "done", "cancelled", "done"])
      assert.ok(rb.workStartedAt! >= ra.finishedAt! && rd.workStartedAt! >= rb.finishedAt!, "one after the other")
      assert.deepEqual(e.events(b.body.id).slice(0, 2).map((x) => x.type), ["research.queued", "research.started"])
      assert.deepEqual(e.events(c.body.id).map((x) => x.type), ["research.queued", "research.cancelled"])
      // The running answer never saw the queued question; the queued one got the finished answer as its context.
      const first = e.calls.slice(0, calls).concat(e.calls.filter((x) => x.user.includes(Q) && !x.user.includes("<thread>")))
      assert.ok(first.every((x) => !x.user.includes(B)), "no prompt of the running answer holds the queued question")
      const planB = e.calls.find((x) => x.role === "plan" && x.user.includes(`<question>\n${B}`))!
      assert.ok(planB.user.includes(`A1: ${ra.answer!.direct}`))
      const threads = await e.get<{ thread: string; title: string; answers: number; status: string }[]>("/api/research/threads")
      assert.deepEqual(threads.body.map((t) => [t.thread, t.title, t.answers, t.status]), [[a.body.thread, Q, 4, "done"]])
    })
  } finally { h.release(); await e.close() }
})

test("cancel: no paid step starts after it, running steps are marked cancelled, what was found is kept; twice or after the end is a no-op", async () => {
  // In the middle of the writing.
  let id = ""
  const e = await engine({ script: { write: async (call) => { void e.cancel(id); await new Promise<void>((resolve) => call.options.signal?.addEventListener("abort", () => resolve())); return "written too late [1]." } } })
  try {
    await paidAllowed(async () => {
      const started = await e.ask({ question: Q, effort: "quick" })
      id = started.body.id
      await e.research.idle()
      const record = await e.record(id), events = e.events(id)
      assert.deepEqual([record.status, events.at(-1)?.type], ["cancelled", "research.cancelled"])
      assert.deepEqual([e.count("write"), e.count("check"), e.count("critic"), e.count("revise")], [1, 0, 0, 0], "nothing was bought after the cancel")
      assert.equal(of(events, "step.finished").find((s) => s.step === "write")?.status, "cancelled")
      assert.ok(of(events, "step.started").every((s) => of(events, "step.finished").some((f) => f.step === s.step)))
      assert.ok(record.sources.length > 0, "the sources found so far stay in the record")
      const end = of(events, "research.cancelled")[0]
      assert.ok(end.spentUsd >= 0 && end.seconds >= 0)
      assert.match(record.note ?? "", /^Cancelled\. The sources found by then are kept\./)
      assert.deepEqual(record.artifacts, [])
      const again = await e.cancel(id)
      assert.deepEqual([again.status, again.body.cancelled, again.body.message], [200, false, "This answer was already cancelled."])
      assert.equal(e.events(id).length, events.length, "a second cancel writes nothing")
      assert.equal((await e.cancel(id, { "x-glhf-token": "" })).status, 401, "cancelling a real answer needs the token, as starting one does")
      assert.equal((await e.cancel("a-20000101000000-00000000")).status, 404)
    })
  } finally { await e.close() }
  // In the middle of a search: the request cannot be taken back, but nothing is screened or written after it.
  let second = ""
  const s = await engine()
  s.net.europepmc = async () => { void s.cancel(second); await sleep(60); return jsonResponse(EUROPEPMC) }
  try {
    await paidAllowed(async () => {
      const started = await s.ask({ question: Q, effort: "quick" })
      second = started.body.id
      await s.research.idle()
      const record = await s.record(second), events = s.events(second)
      assert.equal(record.status, "cancelled")
      assert.deepEqual([s.count("screen"), s.count("write"), s.count("check")], [1, 0, 0], "only the web search's results were screened, before the cancel")
      assert.deepEqual(of(events, "step.finished").filter((x) => x.step.startsWith("search:europepmc")).map((x) => x.status), ["cancelled", "cancelled"])
      assert.deepEqual(record.sources.map((x) => x.provider), ["exa"], "what the web search found is kept")
      assert.equal(of(events, "sources").length, 1)
    })
    const done = await paidAllowed(() => s.answer({ question: "A question that runs to its end?" }))
    const late = await s.cancel(done.id)
    assert.deepEqual([late.body.cancelled, late.body.status], [false, "done"])
    assert.match(late.body.message, /had already ended \(done\)/)
  } finally { await s.close() }
})

test("the event stream replays then tails; Last-Event-ID or ?after= resumes without a repeat; ids are the seq", async () => {
  const h = held()
  const e = await engine({ script: { write: h.write } })
  try {
    await paidAllowed(async () => {
      const started = await e.ask({ question: Q, effort: "quick" })
      const id = started.body.id
      await until(() => e.events(id).some((x) => x.type === "selection"), "the sources")
      const live = readStream(`${e.url}/api/research/${id}/events`, {}, (x) => x.type === "research.finished")
      await sleep(50)
      h.release()
      const all = await live
      const stored = e.events(id)
      assert.deepEqual(all.frames.map((f) => f.id), stored.map((x) => x.seq), "every stored event, once, in order: what was there is replayed and what came later is tailed")
      assert.deepEqual(all.frames.map((f) => f.event), stored)
      const after = await readStream(`${e.url}/api/research/${id}/events?after=10`, {}, (x) => x.type === "research.finished")
      assert.deepEqual(after.frames.map((f) => f.id), stored.filter((x) => x.seq > 10).map((x) => x.seq))
      const header = await readStream(`${e.url}/api/research/${id}/events`, { "last-event-id": String(stored.length - 3) }, (x) => x.type === "research.finished")
      assert.deepEqual(header.frames.map((f) => f.id), stored.slice(-3).map((x) => x.seq))
      const none = await readStream(`${e.url}/api/research/${id}/events?after=${stored.length}`, {}, () => true, 150)
      assert.deepEqual(none.frames, [], "nothing newer: nothing is sent again")
      assert.equal((await fetch(`${e.url}/api/research/a-20000101000000-00000000/events`, { headers: { origin: ORIGIN } })).status, 204)
      assert.equal(containsKey(JSON.stringify(all.frames)), false)
    })
  } finally { h.release(); await e.close() }
})

test("result files: only registered files are served, as downloads; a symbolic link, an unregistered name, a path and a too large file are refused", async () => {
  const e = await engine({ demo: true })
  try {
    const { id } = await e.answer({ question: "Is hERG a risk for KRAS G12C inhibitors?" })
    const list = await e.get<{ items: { id: string; name: string; type: string; bytes: number; at: number }[] }>(`/api/research/${id}/artifacts`)
    assert.deepEqual(list.body.items.map((a) => [a.id, a.name, a.type]), [[`${id}/answer.md`, "answer.md", "text/markdown"], [`${id}/sources.json`, "sources.json", "application/json"], [`${id}/sources.csv`, "sources.csv", "text/csv"], [`${id}/record.json`, "record.json", "application/json"]])
    const dir = join(e.runs, ".research", id)
    for (const a of list.body.items) assert.equal(a.bytes, readFileSync(join(dir, a.name)).length, `${a.name}: the registered size is the file's size`)
    const file = await e.get<string>(`/api/research/${id}/artifacts/answer.md`)
    assert.equal(file.status, 200)
    assert.equal(file.headers.get("content-disposition"), `attachment; filename="${id}-answer.md"`)
    assert.equal(file.headers.get("x-content-type-options"), "nosniff")
    assert.match(file.body, /^# Is hERG a risk for KRAS G12C inhibitors\?\n/)
    assert.match(file.body, /## Sources\n\n1\. KRAS G12C inhibitors in NSCLC: clinical review \(mock\)/)
    const csv = await e.get<string>(`/api/research/${id}/artifacts/sources.csv`)
    assert.match(csv.body, /^"n","title","url","provider","note","cited"\n"1",/)
    const sources = (await e.get<{ sources: { n: number; cited: boolean; text: string }[] }>(`/api/research/${id}/artifacts/sources.json`)).body
    assert.deepEqual(sources.sources.map((s) => [s.n, s.cited]), [[1, true], [2, true], [3, false]])
    // Files that exist in the folder but are not registered, and names that are not names.
    for (const name of ["events.jsonl", "session.sqlite", "run.lock", "artifacts.json", "nothing.md", "..%2Frecord.json", "%2e%2e%2f%2e%2e%2fconfig.yaml", "answer.md%00.png", "ANSWER.MD"]) {
      const res = await fetch(`${e.url}/api/research/${id}/artifacts/${name}`, { headers: { origin: ORIGIN } })
      assert.equal(res.status, 404, name)
    }
    assert.equal((await e.get(`/api/research/${id}/artifacts/answer.md/more`)).status, 404)
    // A registered name whose file was swapped for a symbolic link is not followed.
    const secret = join(mkdtempSync(join(tmpdir(), "research-secret-")), "secret.txt")
    writeFileSync(secret, "TOP SECRET")
    rmSync(join(dir, "answer.md"))
    symlinkSync(secret, join(dir, "answer.md"))
    const link = await e.get<{ error: string }>(`/api/research/${id}/artifacts/answer.md`)
    assert.equal(link.status, 403)
    assert.ok(!JSON.stringify(link.body).includes("TOP SECRET"))
    assert.deepEqual(readArtifact(e.config, id, "answer.md"), { ok: false, status: 403, error: "this is not a regular file, so it is not served" })
    // A registry that names something off the fixed list is not believed; a file over the size cap is not sent.
    writeFileSync(join(dir, "artifacts.json"), JSON.stringify([{ id: "x", name: "session.sqlite", type: "text/plain", bytes: 1, at: 1 }, { id: "y", name: "sources.csv", type: "text/csv", bytes: 1, at: 1 }]))
    assert.deepEqual(listArtifacts(e.config, id).map((a) => a.name), ["sources.csv"])
    assert.equal((await e.get(`/api/research/${id}/artifacts/session.sqlite`)).status, 404)
    writeFileSync(join(dir, "sources.csv"), "x".repeat(5_000_001))
    assert.equal((await e.get(`/api/research/${id}/artifacts/sources.csv`)).status, 413)
    assert.deepEqual(listArtifacts(e.config, "../../etc"), [])
  } finally { await e.close() }
})

test("the store writes only under the configured runs folder: ids are made and checked by code, and nothing reaches board/runs of the repository", async () => {
  const real = resolve(ROOT, "board/runs/.research")
  const listing = () => (existsSync(real) ? readdirSync(real).sort().join("\n") : "(absent)")
  const before = listing()
  const e = await engine({ demo: true })
  const r = await engine()
  try {
    const demo = await e.answer({ question: "Is hERG a risk for KRAS G12C inhibitors?" })
    const paid = await paidAllowed(() => r.answer({ question: Q, effort: "quick" }))
    for (const [x, id] of [[e, demo.id], [r, paid.id]] as const) {
      assert.ok(resolve(x.runs).startsWith(resolve(tmpdir())) || resolve(x.runs).startsWith("/private/"), "the test's runs folder is a temp folder")
      assert.equal(researchRoot(x.config), join(resolve(x.runs), ".research"))
      assert.equal(answerDir(x.config, id), join(resolve(x.runs), ".research", id))
      assert.ok(eventsFile(x.config, id).startsWith(resolve(x.runs)))
      assert.deepEqual(readdirSync(join(x.runs, ".research", id)).sort(), ["answer.md", "artifacts.json", "events.jsonl", "record.json", "session.sqlite", "sources.csv", "sources.json"], "these files and no other")
      assert.deepEqual(readdirSync(x.runs).sort(), x === r ? [".exa-ledger.jsonl", ".research"] : [".research"], "nothing beside the answers and, for a real one, the Exa ledger")
    }
    assert.equal(listing(), before, "the repository's own board/runs/.research is untouched")
    assert.notEqual(resolve(loadConfig().paths.runs), resolve(e.runs))
    // Ids: only the shape the store makes is ever turned into a path.
    assert.ok(isAnswerId(newAnswerId()) && isThreadId(newThreadId()))
    for (const bad of ["../x", "a-20261114214617-ddf4cc5", "a-20261114214617-ddf4cc53/..", "a-2026/../../etc", "", ".", "..", "t-0000000000", 7, undefined, "a-20261114214617-DDF4CC53"]) {
      assert.equal(isAnswerId(bad), false, String(bad))
      assert.equal(loadRecord(e.config, bad as string), undefined, String(bad))
      assert.deepEqual(readArtifact(e.config, bad as string, "answer.md"), { ok: false, status: 404, error: "no such answer" }, String(bad))
    }
    for (const bad of ["t-00000000", "../t", "t-000000000g", "a-20261114214617-ddf4cc53"]) assert.equal(isThreadId(bad), false, bad)
    // A record left "running" by an engine that stopped is shown as failed once its time limit is long past; the file is not rewritten.
    const file = join(r.runs, ".research", paid.id, "record.json")
    const stored = JSON.parse(readFileSync(file, "utf8")) as ResearchRecord
    writeFileSync(file, JSON.stringify({ ...stored, status: "running" }))
    assert.equal(loadRecord(r.config, paid.id, stored.startedAt + 10_000)?.status, "running")
    const stale = loadRecord(r.config, paid.id, (stored.workStartedAt ?? stored.startedAt) + 200_000)
    assert.deepEqual([stale?.status, stale?.error], ["failed", "The engine stopped before this answer was finished. Ask the question again."])
    assert.equal((JSON.parse(readFileSync(file, "utf8")) as ResearchRecord).status, "running")
    writeFileSync(file, JSON.stringify(stored))
  } finally { await e.close(); await r.close() }
})

test("through the engine's own handler: the route is registered behind the Host and Origin checks, and a saved answer is found by GET /api/search as kind \"answer\"", async () => {
  const base = loadConfig(), runs = join(mkdtempSync(join(tmpdir(), "research-app-")), "runs")
  const config = { ...base, paths: { ...base.paths, runs } }
  const app = createApp({ config, mock: true, env: { NO_PAID_CALLS: "1", GLHF_HIDE_EXAMPLES: "1" }, hasToken: () => false })
  const server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const post = (headers: Record<string, string>) => fetch(`${url}/api/research`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ question: "Is hERG a risk for KRAS G12C inhibitors?" }) })
    assert.equal((await post({ origin: "https://evil.example" })).status, 403, "a foreign Origin is refused before the route is reached")
    const foreignHost = await new Promise<number>((done) => { // fetch may not set Host: a plain request does
      const req = request(`${url}/api/research`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, host: "evil.example" } }, (res) => { res.resume(); done(res.statusCode ?? 0) })
      req.end(JSON.stringify({ question: "Is hERG a risk for KRAS G12C inhibitors?" }))
    })
    assert.equal(foreignHost, 403, "a foreign Host is refused")
    const res = await post({ origin: ORIGIN })
    assert.equal(res.status, 202)
    const { id, thread } = (await res.json()) as { id: string; thread: string }
    await until(async () => ((await (await fetch(`${url}/api/research/${id}`)).json()) as ResearchRecord).status === "done", "the demo answer")
    const search = async (q: string) => (await (await fetch(`${url}/api/search?q=${encodeURIComponent(q)}`, { headers: { origin: ORIGIN } })).json()) as { kind: string; id: string; title: string; status: string; mode?: string; thread?: string; startedAt: number; matches: { where: string; text: string }[] }[]
    const all = await search("")
    assert.deepEqual(all.filter((hit) => hit.kind === "answer").map((hit) => [hit.id, hit.title, hit.status, hit.mode, hit.thread]), [[id, "Is hERG a risk for KRAS G12C inhibitors?", "done", "demo", thread]], "an empty query lists it")
    assert.deepEqual((await search("piperazine quinazolines")).map((hit) => [hit.kind, hit.matches[0].where]), [["answer", "answer"]], "found by words of its answer text")
    assert.deepEqual((await search("herg kras")).map((hit) => hit.kind), ["answer"])
    assert.deepEqual(await search("zebrafish nothing"), [])
    assert.ok(readdirSync(join(runs, ".research")).includes(id))
  } finally { await new Promise((done) => server.close(done)) }
})
