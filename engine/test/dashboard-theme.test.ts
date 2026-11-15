import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { runInNewContext } from "node:vm"

test("dark text tokens meet WCAG AA on their surfaces", () => {
  const css = readFileSync(new URL("../../dashboard/src/design/theme.css", import.meta.url), "utf8")
  const tokens = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map((m) => [m[1], m[2]]))
  const luminance = (hex: string) => hex.slice(1).match(/../g)!.map((v) => {
    const n = parseInt(v, 16) / 255
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4
  }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0)
  const pairs = [
    ...["bg", "nav", "surface", "hover", "brand"].flatMap((bg) => [["text", bg], ["text-muted", bg]]),
    ...["success", "warning", "danger", "info", "neutral"].map((name) => [name, `${name}-bg`]),
    ["on-ink", "ink"], ["dark-violet", "dark-violet-bg"], ["dark-teal", "dark-teal-bg"],
  ]
  for (const [fg, bg] of pairs) {
    const a = luminance(tokens[fg]), b = luminance(tokens[bg])
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${fg} on ${bg}`)
  }
})

test("the inline initializer applies the saved choice before the app loads", () => {
  const html = readFileSync(new URL("../../dashboard/index.html", import.meta.url), "utf8")
  const script = html.match(/<script id="appearance-init">([\s\S]*?)<\/script>/)![1]
  assert.ok(html.indexOf(script) < html.indexOf('<div id="root">'))
  for (const [saved, systemDark, blocked, expected] of [
    [null, true, false, false], ["dark", false, false, true], ["light", true, false, false],
    ["system", true, false, true], ["system", false, false, false], ["invalid", true, false, false], [null, true, true, false],
  ] as const) {
    let actual: unknown
    runInNewContext(script, {
      document: { documentElement: { classList: { toggle: (name: string, value: boolean) => { assert.equal(name, "dark"); actual = value } } } },
      window: { matchMedia: () => ({ matches: systemDark }) },
      localStorage: { getItem: () => { if (blocked) throw new Error("blocked"); return saved } },
    })
    assert.equal(actual, expected)
  }
})

test("the dashboard CSP allows only its exact pre-paint appearance initializer", async () => {
  const path = new URL("../../docker/serve.mjs", import.meta.url).pathname
  const { createDashboardServer } = await import(path) as { createDashboardServer: (root: string, env: object) => Server }
  const root = mkdtempSync(join(tmpdir(), "appearance-csp-"))
  const html = readFileSync(new URL("../../dashboard/index.html", import.meta.url), "utf8")
  const script = html.match(/<script id="appearance-init">([\s\S]*?)<\/script>/)![1]
  writeFileSync(join(root, "index.html"), html)
  const server = createDashboardServer(root, {})
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
    const csp = res.headers.get("content-security-policy")!
    const hash = createHash("sha256").update(script).digest("base64")
    assert.ok(csp.includes(`script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}';`))
    assert.ok(!csp.includes(`'sha256-${createHash("sha256").update("alert(1)").digest("base64")}'`))
    assert.doesNotMatch(csp.split("script-src ")[1].split(";")[0], /unsafe-inline/)
    assert.equal(await res.text(), html)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})
