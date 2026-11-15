import assert from "node:assert/strict"
import { mkdtempSync, readdirSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createApp } from "../src/app.ts"
import { loadConfig } from "../src/config.ts"
import { exampleCsv, exampleEntries } from "../src/examples.ts"
import { researchSpentToday } from "../src/research/spend.ts"
import { spentToday } from "../src/board/board.ts"

process.env.NO_PAID_CALLS = "1"
process.env.PAID_SWITCH_LOCKED = "1"

test("example CSV appends a quoted provenance column without changing quoted fields or record boundaries", () => {
  assert.equal(exampleCsv('"title","note"\r\n"A, ""quoted"" title","line 1\nline 2"\r\n'),
    '"title","note","provenance"\r\n"A, ""quoted"" title","line 1\nline 2","Example · practice, $0"\r\n')
  assert.equal(exampleCsv("n,title\n1,Example"), 'n,title,"provenance"\r\n1,Example,"Example · practice, $0"\r\n')
  assert.equal(exampleCsv("n,title\r\n"), 'n,title,"provenance"\r\n')
  assert.equal(exampleCsv(""), '"provenance"\r\n')
  assert.throws(() => exampleCsv('"unfinished'), /Unterminated quoted CSV field/)
})

test("committed examples are listed, labelled, read-only, outside spending and replay", async () => {
  const config = loadConfig(), dir = mkdtempSync(join(tmpdir(), "example-api-"))
  config.paths.runs = dir
  let starts = 0
  const app = createApp({ config, mock: true, env: { NO_PAID_CALLS: "1", PAID_SWITCH_LOCKED: "1" }, start: async () => { starts++; return "unexpected" }, run: async () => { starts++ } })
  const server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok))
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`
  const get = async (path: string) => (await fetch(base + path)).json()
  try {
    const entries = exampleEntries({})
    assert.equal(entries.length, 6)
    assert.equal(entries.filter((e) => e.kind === "answer" && e.status === "done").length, 4)
    assert.equal(entries.filter((e) => e.status === "cancelled").length, 1)
    const answers = await get("/api/research"), totals = await get("/api/research?all=1"), boards = await get("/api/runs"), search = await get("/api/search")
    assert.equal(answers.items.length, 5)
    assert.equal(totals.items.filter((r: { example?: boolean }) => !r.example).length, 0)
    assert.equal(boards.filter((r: { example?: boolean }) => !r.example).length, 0)
    assert.equal(search.length, 6)
    assert.equal((await get("/api/search?q=unfindable-zzzz")).length, 0)
    for (const e of entries) {
      const path = `/api/${e.kind === "answer" ? "research" : "runs"}/${e.id}`
      const record = await get(path)
      assert.equal(record.example, true); assert.equal(record.readOnly, true)
      assert.equal(record.provenance, "Example · practice, $0")
      const stream = await (await fetch(base + path + "/events")).text()
      assert.match(stream, /"example":true/)
      assert.equal(await (await fetch(base + path + "/events?after=999999")).text(), "")
      for (const suffix of ["", "/resume", "/cancel", "/replay"]) {
        for (const method of ["POST", "DELETE", "PUT", "PATCH"]) {
          const r = await fetch(base + path + suffix, { method, headers: { origin: "http://127.0.0.1:5317", "content-type": "application/json" }, body: "{}" })
          assert.equal(r.status, 403, `${method} ${path}${suffix}`)
        }
      }
      if (e.kind === "answer") {
        assert.equal((await get(`/api/research?thread=${e.thread}`)).items.length, 1)
        const refused = await fetch(base + "/api/research", { method: "POST", headers: { origin: "http://127.0.0.1:5317", "content-type": "application/json" }, body: JSON.stringify({ question: "Follow up", effort: "quick", thread: e.thread }) })
        assert.equal(refused.status, 403)
        for (const a of record.artifacts) {
          const res = await fetch(base + path + "/artifacts/" + a.name)
          const body = await res.text()
          assert.equal(res.status, 200); assert.match(body, /Example · practice, \$0/)
          if (a.name === "sources.csv") {
            const rows = body.trimEnd().split("\r\n")
            assert.equal(rows[0], '"n","title","url","provider","note","cited","provenance"')
            assert.equal(rows.length, record.sources.length + 1)
            assert.ok(rows.slice(1).every((row: string) => row.endsWith(',"Example · practice, $0"')))
            assert.match(res.headers.get("content-type") ?? "", /^text\/csv/)
          }
        }
        assert.equal((await fetch(base + path + "/artifacts/unknown.md")).status, 404)
      } else assert.match(await (await fetch(base + path + "/memo")).text(), /Example · practice, \$0/)
    }
    assert.equal(researchSpentToday(config), 0); assert.equal(spentToday(config), 0)
    app.resumePaused()
    assert.equal(starts, 0)
    assert.deepEqual(readdirSync(dir), [])
    assert.equal((await fetch(base + "/api/research/no-such-example")).status, 404)
    assert.equal((await fetch(base + "/api/runs", { headers: { origin: "https://foreign.invalid" } })).status, 403)
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())) }
})

test("examples can be hidden without making their ids writable", async () => {
  const config = loadConfig(); config.paths.runs = mkdtempSync(join(tmpdir(), "example-hidden-"))
  const app = createApp({ config, mock: true, env: { GLHF_HIDE_EXAMPLES: "1", NO_PAID_CALLS: "1" } })
  const server = createServer((req, res) => void app.handler(req, res))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    assert.deepEqual(exampleEntries({ GLHF_HIDE_EXAMPLES: "1" }), [])
    assert.equal((await (await fetch(base + "/api/research")).json()).items.length, 0)
    assert.deepEqual(await (await fetch(base + "/api/runs")).json(), [])
    assert.deepEqual(await (await fetch(base + "/api/search")).json(), [])
    const e = exampleEntries({})[0], path = `/api/research/${e.id}`
    assert.equal((await fetch(base + path)).status, 404)
    assert.equal((await fetch(base + path + "/cancel", { method: "POST", headers: { origin: "http://127.0.0.1:5317" } })).status, 403)
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())) }
})
