// Tests of front.mjs with a stand-in engine. No network beyond 127.0.0.1, no model, no Modal.
//   node --test deploy/modal_host/tests/front.test.mjs
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { COOKIE, createFront, parseAccess, readSession, safeNext, sha256, signSession, whoHasCode } from "../front.mjs"

const CODE = { owner: "owner-code-0123456789abcdefghij", ada: "ada-code-0123456789abcdefghijkl" }
const KEY = "ab".repeat(32)
const ENV = { ASB_ACCESS_HASHES: JSON.stringify({ owner: sha256(CODE.owner), ada: sha256(CODE.ada) }), ASB_COOKIE_KEY: KEY }

let engine, enginePort, front, base, seen = [], clock = Date.UTC(2026, 0, 1)
const root = mkdtempSync(join(tmpdir(), "asb-front-"))
mkdirSync(join(root, "assets"))
writeFileSync(join(root, "index.html"), "<!doctype html><title>app shell</title>")
writeFileSync(join(root, "assets", "app-abc123.js"), "console.log('app')")

const listen = (server) => new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server.address().port)))

before(async () => {
  // The stand-in engine applies the real engine's two entry rules: Host must be this machine, an Origin must be the dashboard's.
  engine = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers })
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "") || (req.headers.origin !== undefined && req.headers.origin !== "http://127.0.0.1:5317")) { res.writeHead(403, { "content-type": "application/json" }); return res.end('{"error":"engine refused"}') }
    if (req.url.endsWith("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream", "access-control-allow-origin": "http://127.0.0.1:5317" })
      res.write('data: {"n":1}\n\n')
      const timer = setInterval(() => res.write('data: {"n":2}\n\n'), 20)
      return res.on("close", () => { clearInterval(timer); seen.push({ closed: req.url }) })
    }
    let body = ""
    req.on("data", (c) => { body += c })
    req.on("end", () => { res.writeHead(req.url === "/api/missing" ? 404 : 200, { "content-type": "application/json", "access-control-allow-origin": "http://127.0.0.1:5317", vary: "origin" }); res.end(JSON.stringify({ path: req.url, body })) })
  })
  enginePort = await listen(engine)
  front = createFront({ root, engine: { host: "127.0.0.1", port: enginePort }, env: ENV, secure: false, now: () => clock, callerOf: (req) => req.headers["x-test-caller"] ?? "one" })
  base = `http://127.0.0.1:${await listen(front)}`
})
after(() => { front.close(); engine.close(); front.closeAllConnections(); engine.closeAllConnections() })

const signIn = async (code = CODE.owner, extra = {}) => fetch(`${base}/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...extra }, body: new URLSearchParams({ code, next: "/board" }) })
const cookieOf = (response) => (response.headers.get("set-cookie") ?? "").split(";")[0]
const session = async (code) => cookieOf(await signIn(code))

test("nothing is served without a session: files, API, event stream, any method", async () => {
  seen = []
  const paths = ["/", "/index.html", "/assets/app-abc123.js", "/assets/nothing.js", "/api/status", "/api/runs", "/api/runs/r1/events", "/api/runs/r1/memo", "/api/paid", "/api/token", "/api/glhf/runs", "/api/chat/catalog", "/api/bixv1/runs", "/logout", "/login", "/.env", "/../../etc/passwd", "/api/../index.html", "/%2e%2e/%2e%2e/etc/passwd"]
  for (const path of paths) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
      if (path === "/login" && method === "POST") continue
      const r = await fetch(base + path, { method, headers: method === "POST" ? { "content-type": "application/json" } : {}, body: method === "POST" || method === "PUT" ? "{}" : undefined })
      assert.equal(r.status, 401, `${method} ${path}`)
      const text = await r.text()
      assert.ok(!text.includes("app shell") && !text.includes("console.log"), `${method} ${path} leaked a file`)
      assert.equal(r.headers.get("set-cookie"), null)
    }
  }
  const page = await fetch(`${base}/board?x=1`, { headers: { accept: "text/html" } })
  assert.equal(page.status, 401)
  const body = await page.text()
  assert.match(body, /Access code/)
  assert.match(body, /name="next" value="\/board\?x=1"/)
  assert.ok(!/<script|src=|href=/.test(body), "the sign-in page loads nothing")
  assert.equal(page.headers.get("referrer-policy"), "same-origin") // "no-referrer" makes a browser send Origin: null on the form POST, and sign-in fails
  assert.equal((await signIn(CODE.owner, { origin: "null", "sec-fetch-site": "same-origin", "x-test-caller": "null-origin" })).status, 403) // and "null" is never accepted as this site
  assert.equal(seen.length, 0, "no unauthenticated request reached the engine")
})

test("a forged, expired, edited or foreign cookie is refused", async () => {
  const access = parseAccess(ENV), soon = Math.floor(clock / 1000) + 600
  const good = signSession(access, "owner", soon)
  assert.equal(readSession(access, `${COOKIE}=${good}`, clock), "owner")
  const bad = [
    signSession(access, "owner", Math.floor(clock / 1000) - 1), // expired
    good.replace("owner.", "ada."), // another name under the same signature
    good.replace(String(soon), String(soon + 999999)), // a later expiry
    good.slice(0, -2) + "AA",
    signSession({ ...access, key: "cd".repeat(32) }, "owner", soon), // signed with another key
    `owner.${soon}.`, "owner", "", `ghost.${soon}.${good.split(".")[2]}`,
  ]
  for (const value of bad) {
    assert.equal(readSession(access, `${COOKIE}=${value}`, clock), undefined, value)
    assert.equal((await fetch(`${base}/api/status`, { headers: { cookie: `${COOKIE}=${value}` } })).status, 401)
  }
  assert.equal((await fetch(`${base}/api/status`, { headers: { cookie: `asb_session=${good}` } })).status, 401, "another cookie name")
  // A new code for a person ends that person's old sessions; a removed person is out.
  const changed = parseAccess({ ...ENV, ASB_ACCESS_HASHES: JSON.stringify({ owner: sha256("a-new-code-0123456789abcdefgh"), ada: sha256(CODE.ada) }) })
  assert.equal(readSession(changed, `${COOKIE}=${good}`, clock), undefined)
  assert.equal(readSession(parseAccess({ ...ENV, ASB_ACCESS_HASHES: JSON.stringify({ ada: sha256(CODE.ada) }) }), `${COOKIE}=${good}`, clock), undefined)
})

test("sign-in: the right code gives a session cookie, a wrong one does not", async () => {
  const ok = await signIn()
  assert.equal(ok.status, 303)
  assert.equal(ok.headers.get("location"), "/board")
  const set = ok.headers.get("set-cookie")
  assert.match(set, new RegExp(`^${COOKIE}=owner\\.\\d+\\.[\\w-]+; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800$`))
  for (const code of ["", "short", "wrong-code-0123456789abcdefghij", CODE.owner + "x", sha256(CODE.owner)]) {
    const r = await signIn(code, { "x-test-caller": `wrong-${code.length}` })
    assert.equal(r.status, 401, code)
    assert.equal(r.headers.get("set-cookie"), null)
  }
  assert.equal((await signIn(CODE.owner, { origin: "https://evil.example" })).status, 403)
  assert.equal((await signIn(CODE.owner, { "sec-fetch-site": "same-site" })).status, 403)
  assert.equal((await fetch(`${base}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: CODE.owner }) })).status, 415)
  const secureFront = createFront({ root, engine: { host: "127.0.0.1", port: enginePort }, env: ENV, now: () => clock })
  const port = await listen(secureFront)
  const r = await fetch(`http://127.0.0.1:${port}/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: CODE.ada }) })
  assert.match(r.headers.get("set-cookie"), /; Secure$/) // the deployed front always marks the cookie Secure
  secureFront.close()
})

test("wrong codes from one address are limited, and other addresses can still sign in", async () => {
  for (let i = 0; i < 10; i++) assert.equal((await signIn("wrong-code-0123456789abcdefghij", { "x-test-caller": "guesser" })).status, 401)
  assert.equal((await signIn("wrong-code-0123456789abcdefghij", { "x-test-caller": "guesser" })).status, 429)
  assert.equal((await signIn(CODE.owner, { "x-test-caller": "guesser" })).status, 429, "also the right code, from that address")
  assert.equal((await signIn(CODE.owner, { "x-test-caller": "someone-else" })).status, 303)
  clock += 11 * 60_000
  assert.equal((await signIn(CODE.owner, { "x-test-caller": "guesser" })).status, 303)
})

test("signed in: files are served with the security headers, unknown pages give the app shell", async () => {
  const cookie = await session()
  const shell = await fetch(`${base}/`, { headers: { cookie } })
  assert.equal(shell.status, 200)
  assert.match(await shell.text(), /app shell/)
  assert.equal(shell.headers.get("cache-control"), "no-store")
  assert.match(shell.headers.get("content-security-policy"), /default-src 'self'.*connect-src 'self'.*frame-ancestors 'none'/)
  assert.equal(shell.headers.get("x-content-type-options"), "nosniff")
  const asset = await fetch(`${base}/assets/app-abc123.js`, { headers: { cookie } })
  assert.equal(asset.headers.get("content-type"), "text/javascript")
  assert.match(asset.headers.get("cache-control"), /^private, /)
  assert.match(await (await fetch(`${base}/board/some/view`, { headers: { cookie } })).text(), /app shell/)
  assert.equal((await fetch(`${base}/assets/gone.js`, { headers: { cookie } })).status, 404)
  for (const path of ["/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd", "/assets/../../front.mjs"]) {
    const r = await fetch(base + path, { headers: { cookie } })
    const text = await r.text()
    assert.ok(text.includes("app shell") || r.status === 404, path)
    assert.ok(!text.includes("root:"), path)
  }
  assert.equal((await fetch(`${base}/`, { method: "POST", headers: { cookie } })).status, 405)
})

test("signed in: API calls reach the engine as the dashboard, without the cookie", async () => {
  const cookie = await session()
  seen = []
  const r = await fetch(`${base}/api/runs?x=1`, { method: "POST", headers: { cookie, "content-type": "application/json", "x-glhf-token": "tok", origin: base, "sec-fetch-site": "same-origin", "x-forwarded-for": "1.2.3.4", authorization: "Bearer x", "modal-key": "k" }, body: '{"brief":"a.md"}' })
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { path: "/api/runs?x=1", body: '{"brief":"a.md"}' })
  assert.equal(r.headers.get("access-control-allow-origin"), null)
  assert.equal(r.headers.get("cache-control"), "no-store")
  const got = seen[0].headers
  assert.equal(got.origin, "http://127.0.0.1:5317")
  assert.equal(got.host, `127.0.0.1:${enginePort}`)
  assert.equal(got["x-glhf-token"], "tok") // the engine's own token still decides what may spend
  for (const name of ["cookie", "x-forwarded-for", "authorization", "modal-key", "sec-fetch-site"]) assert.equal(got[name], undefined, name)
  assert.equal((await fetch(`${base}/api/missing`, { headers: { cookie } })).status, 404) // the engine's own status passes through
  // A GET from the page carries no Origin; the front still presents the dashboard's, so the engine's "dashboard or token" routes work.
  seen = []
  await fetch(`${base}/api/chat/catalog`, { headers: { cookie, "sec-fetch-site": "same-origin" } })
  assert.equal(seen[0].headers.origin, "http://127.0.0.1:5317")
})

test("signed in, but the request comes from another site's page: refused before the engine", async () => {
  const cookie = await session()
  seen = []
  const cases = [
    { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, // another *.modal.run app is same-site
    { "sec-fetch-site": "none" }, // typed into the address bar: an API address is not a page
    { origin: "https://evil.example" }, { origin: "https://evil--app.modal.run", "sec-fetch-site": "same-origin" }, { origin: "null" },
  ]
  for (const headers of cases) {
    for (const [method, path] of [["GET", "/api/runs"], ["POST", "/api/runs"], ["GET", "/api/runs/r1/events"], ["POST", "/logout"]]) {
      const r = await fetch(base + path, { method, headers: { cookie, ...headers, ...(method === "POST" ? { "content-type": "application/json" } : {}) }, body: method === "POST" ? "{}" : undefined, redirect: "manual" })
      assert.equal(r.status, 403, `${method} ${path} ${JSON.stringify(headers)}`)
    }
  }
  assert.equal(seen.length, 0)
  // A page itself may be opened from a link on another site (a top-level visit): it only gets the app shell.
  assert.equal((await fetch(`${base}/`, { headers: { cookie, "sec-fetch-site": "cross-site" } })).status, 200)
})

test("the event stream passes through live, and closing it closes the engine's stream", async () => {
  const cookie = await session()
  seen = []
  const control = new AbortController()
  const r = await fetch(`${base}/api/runs/r1/events`, { headers: { cookie, accept: "text/event-stream" }, signal: control.signal })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get("content-type"), "text/event-stream")
  const reader = r.body.getReader()
  let text = ""
  while (!text.includes('{"n":2}')) text += new TextDecoder().decode((await reader.read()).value)
  assert.match(text, /^data: \{"n":1\}\n\n/)
  control.abort()
  for (let i = 0; i < 100 && !seen.some((s) => s.closed); i++) await new Promise((ok) => setTimeout(ok, 10))
  assert.ok(seen.some((s) => s.closed === "/api/runs/r1/events"))
})

test("what the hosted app cannot do is refused in plain words, and the engine is not asked", async () => {
  const cookie = await session()
  seen = []
  const r = await fetch(`${base}/api/glhf/runs`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: '{"model":"mock"}' })
  assert.equal(r.status, 501)
  const body = await r.json()
  assert.match(body.error, /not available in the hosted app/)
  assert.equal(body.hosted, true)
  assert.equal(seen.length, 0)
  assert.equal((await fetch(`${base}/api/glhf/runs`, { headers: { cookie } })).status, 200) // reading the list is fine
  assert.equal((await fetch(`${base}/api/glhf/roles`, { headers: { cookie } })).status, 501)
  assert.equal(seen.length, 1)
})

test("sign-out clears the cookie; an engine that is down gives 502 in plain words", async () => {
  const cookie = await session()
  const page = await fetch(`${base}/logout`, { headers: { cookie } })
  assert.match(await page.text(), /Signed in as owner/)
  const out = await fetch(`${base}/logout`, { method: "POST", headers: { cookie }, redirect: "manual" })
  assert.equal(out.status, 303)
  assert.match(out.headers.get("set-cookie"), new RegExp(`^${COOKIE}=; .*Max-Age=0`))
  const lonely = createFront({ root, engine: { host: "127.0.0.1", port: 1 }, env: ENV, secure: false, now: () => clock })
  const port = await listen(lonely)
  const r = await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { cookie } })
  assert.equal(r.status, 502)
  assert.match((await r.json()).error, /engine is not answering/)
  lonely.close()
})

test("without access settings the front serves nothing at all", async () => {
  for (const env of [{}, { ASB_ACCESS_HASHES: ENV.ASB_ACCESS_HASHES }, { ASB_COOKIE_KEY: KEY }, { ASB_ACCESS_HASHES: "{}", ASB_COOKIE_KEY: KEY }, { ASB_ACCESS_HASHES: '{"owner":"not-a-hash"}', ASB_COOKIE_KEY: KEY }, { ...ENV, ASB_COOKIE_KEY: "short" }]) {
    const closed = createFront({ root, engine: { host: "127.0.0.1", port: enginePort }, env, secure: false })
    const port = await listen(closed)
    for (const path of ["/", "/api/status", "/login"]) assert.equal((await fetch(`http://127.0.0.1:${port}${path}`, { method: path === "/login" ? "POST" : "GET" })).status, 503)
    closed.close()
  }
})

test("after sign-in a person is sent only to a page of this app", () => {
  for (const next of ["/board", "/runs/a-b.c?x=1&y=2", "/"]) assert.equal(safeNext(next), next)
  for (const next of ["//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "/login", "/api/runs", "", null, undefined, "/a b", "/a\nb", "/<script>"]) assert.equal(safeNext(next), "/", String(next))
})

test("a short access code never signs anyone in, even when its hash is on the list", () => {
  const weak = parseAccess({ ASB_ACCESS_HASHES: JSON.stringify({ owner: sha256("hunter2"), ada: sha256("x".repeat(19)), ok: sha256("y".repeat(20)) }), ASB_COOKIE_KEY: KEY })
  assert.equal(whoHasCode(weak, "hunter2"), undefined)
  assert.equal(whoHasCode(weak, "x".repeat(19)), undefined)
  assert.equal(whoHasCode(weak, "y".repeat(20)), "ok")
  assert.equal(whoHasCode(weak, ` ${"y".repeat(20)}\n`), "ok") // pasted with a space or a line end
  for (const junk of [undefined, null, 42, "", "y".repeat(201)]) assert.equal(whoHasCode(weak, junk), undefined)
})
