// The live Exa request (src/search/exa.ts) against a fake fetch: nothing reaches the network.
// exaLive refuses while paid calls are off, so this file allows them; every request below is answered by a fake.
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "0"
const { EXA_TIMEOUT_MS, exaLive } = await import("../src/search/exa.ts")

test("an Exa request that never answers is given up after its time limit, not waited on forever", async () => {
  const realFetch = globalThis.fetch
  const seen: (AbortSignal | null | undefined)[] = []
  // A server that accepts the connection and never answers: only the request's own signal can end the wait.
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    seen.push(init?.signal)
    return new Promise((_ok, fail) => init?.signal?.addEventListener("abort", () => fail(init.signal!.reason)))
  }) as typeof fetch
  try {
    const started = Date.now()
    await assert.rejects(exaLive("kras g12c", "papers", "fake-key-for-tests", undefined, 50), (error: Error) => error.name === "TimeoutError")
    assert.ok(Date.now() - started < 5_000, "it stopped at the limit")
    assert.equal(seen.length, 1, "one request, no retry")
    assert.ok(seen[0] instanceof AbortSignal, "the request carries a signal")
  } finally {
    globalThis.fetch = realFetch
  }
  assert.ok(EXA_TIMEOUT_MS > 0 && EXA_TIMEOUT_MS <= 60_000, "the default limit is set and below a minute")
})
