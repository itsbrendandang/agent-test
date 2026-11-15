// A real browser against the deployed app: sign in through the form, load the app, read the API and an event
// stream from the page. Headless Chrome through puppeteer-core, which is NOT a dependency of this repo:
//   mkdir -p /tmp/pptr && cd /tmp/pptr && npm i puppeteer-core
//   NODE_PATH=/tmp/pptr/node_modules node deploy/modal_host/tests/browser_check.mjs <address> [screenshot folder]
// The access code is read from deploy/modal_host/.local/codes/<ASB_CHECK_USER or tester>.txt and never printed.
import { mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(join(process.env.NODE_PATH ?? "/tmp/pptr/node_modules", "x.js"))
const puppeteer = require("puppeteer-core")
const here = dirname(fileURLToPath(import.meta.url))
const base = (process.argv[2] ?? "").replace(/\/$/, "")
const shots = process.argv[3] ?? "/tmp/modal-host/shots"
if (!base) { console.error("give the address"); process.exit(2) }
mkdirSync(shots, { recursive: true })
const code = readFileSync(join(here, "..", ".local", "codes", `${process.env.ASB_CHECK_USER ?? "tester"}.txt`), "utf8").trim()
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const results = []
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`) }

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-first-run"] })
try {
  // 1. A stranger's browser: no cookie.
  const stranger = await (await browser.createBrowserContext()).newPage()
  const first = await stranger.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 180_000 })
  check("a browser without a session gets 401 and the sign-in form", first.status() === 401 && (await stranger.$("input[name=code]")) !== null)
  check("the sign-in page holds nothing of the app", !(await stranger.content()).includes("/assets/"))
  const peek = await stranger.evaluate(async () => { const out = {}; for (const path of ["/api/status", "/api/runs", "/assets/x.js", "/index.html"]) out[path] = (await fetch(path)).status; return out })
  check("the stranger's page cannot read the API or the files", Object.values(peek).every((s) => s === 401), JSON.stringify(peek))
  await stranger.type("input[name=code]", "this-is-not-a-real-code-000000000")
  await Promise.all([stranger.waitForNavigation({ waitUntil: "domcontentloaded" }), stranger.click("button[type=submit]")])
  const wrong = await stranger.evaluate(() => document.body.innerText)
  check("a wrong code stays on the sign-in form", (await stranger.$("input[name=code]")) !== null && wrong.includes("not right"), wrong.split("\n").filter(Boolean).pop())
  await stranger.screenshot({ path: join(shots, "1-sign-in.png") })

  // 2. A teammate: signs in with the form.
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const problems = []
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text().slice(0, 200)) })
  page.on("pageerror", (e) => problems.push(String(e).slice(0, 200)))
  const failed = []
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) failed.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 180_000 })
  await page.type("input[name=code]", code)
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click("button[type=submit]")])
  failed.length = 0; problems.length = 0 // the 401 of the sign-in page itself is expected
  await sleep(6000) // the app holds event streams open: wait a fixed time, not for the network to go quiet
  const cookies = await context.cookies()
  const session = cookies.find((c) => c.name === "__Host-asb_session")
  check("signed in: the session cookie is HttpOnly, Secure, SameSite=Lax, host-only", Boolean(session && session.httpOnly && session.secure && session.sameSite === "Lax" && !session.domain.startsWith(".")), session ? `expires in ${Math.round((session.expires * 1000 - Date.now()) / 86400000)} days` : "no cookie")
  check("the page's script cannot read the cookie", !(await page.evaluate(() => document.cookie)).includes("asb_session"))
  const text = await page.evaluate(() => document.body.innerText)
  check("the app is on screen", (await page.$("#root > *")) !== null && text.length > 200, `${text.length} characters of text, title "${await page.title()}"`)
  check("the app says it is in Demo (practice) mode", /demo|practice|scripted/i.test(text))
  const api = await page.evaluate(async () => {
    const status = await (await fetch("/api/status")).json()
    const runs = await (await fetch("/api/runs")).json()
    const roster = await (await fetch("/api/roster")).json()
    const catalog = await fetch("/api/chat/catalog").then((r) => r.status)
    return { mock: status.mock, paidCalls: status.paidCalls, locked: status.paidLocked, keys: Object.values(status.keys).some(Boolean), runs: runs.length, done: runs.filter((r) => r.status === "done").length, run: runs[0]?.id, roster: roster.length, catalog }
  })
  check("from the page: the engine is in Demo, locked, with no key", api.mock === true && api.paidCalls === false && api.locked === true && api.keys === false, JSON.stringify(api))
  if (api.run) {
    const stream = await page.evaluate((run) => new Promise((ok) => {
      const source = new EventSource(`/api/runs/${run}/events`)
      let count = 0, first = ""
      source.onmessage = (e) => { count++; first ||= JSON.parse(e.data).type }
      source.onerror = () => { source.close(); ok({ count, first, error: true }) }
      setTimeout(() => { source.close(); ok({ count, first }) }, 4000)
    }), api.run)
    check("from the page: the event stream of a saved review arrives", stream.count > 10 && stream.first === "run.started" && !stream.error, JSON.stringify(stream))
  }
  // A practice review started the way the page does it (POST with JSON from the app's own origin).
  const review = await page.evaluate(async () => { const r = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: "kras-g12c-hit-to-lead.md" }) }); return { status: r.status, body: await r.json() } })
  check("from the page: a practice review starts and is labelled scripted", review.status === 201 && review.body.mode === "scripted", JSON.stringify(review))
  const swarm = await page.evaluate(async () => { const r = await fetch("/api/glhf/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ solver: "glhf", model: "mock" }) }); return { status: r.status, error: (await r.json()).error } })
  check("from the page: a swarm run is refused in plain words", swarm.status === 501 && /not available in the hosted app/.test(swarm.error), swarm.error.slice(0, 70))
  // The 501 above was asked for on purpose; it is the only failure allowed.
  const real = problems.filter((p) => !p.includes("status of 501")), bad = failed.filter((f) => f !== "501 /api/glhf/runs")
  check("no script error and no blocked resource on the page (the content-security policy fits the app)", real.length === 0, real.slice(0, 4).join(" | "))
  check("no failed request while the app loaded", bad.length === 0, [...new Set(bad)].slice(0, 6).join(", "))
  await page.screenshot({ path: join(shots, "2-app.png") })

  // 3. Another site's page, with the teammate's cookie in the browser (the same context): it must not get in.
  const evil = await context.newPage()
  await evil.goto("https://example.com/", { waitUntil: "domcontentloaded" })
  const attack = await evil.evaluate(async (target) => {
    const out = {}
    try { const r = await fetch(`${target}/api/runs`, { credentials: "include", mode: "no-cors" }); out.get = r.type } catch (e) { out.get = `blocked: ${e.message}` }
    try { await fetch(`${target}/api/runs`, { method: "POST", credentials: "include", mode: "no-cors", headers: { "content-type": "text/plain" }, body: JSON.stringify({ brief: "kras-g12c-hit-to-lead.md" }) }); out.post = "sent" } catch (e) { out.post = `blocked: ${e.message}` }
    return out
  }, base)
  const after = await page.evaluate(async () => (await (await fetch("/api/runs")).json()).length)
  check("another site's page could not start a review with the teammate's cookie", after === api.runs + 1, `runs before ${api.runs}, after the page's own start and the foreign attempts ${after}; foreign page saw ${JSON.stringify(attack)}`)

  // 4. Sign out.
  await evil.close()
  await page.bringToFront()
  await page.goto(`${base}/logout`, { waitUntil: "domcontentloaded" })
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click("button")])
  check("after sign-out the browser is refused again", (await page.evaluate(async () => (await fetch("/api/status")).status)) === 401)
} finally {
  await browser.close()
}
console.log(`${results.filter(Boolean).length} of ${results.length} browser checks passed; screenshots in ${shots}`)
process.exit(results.every(Boolean) ? 0 : 1)
