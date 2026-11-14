import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"
import { EngineOffline, PageHead } from "@/components/Shared"
import { HOW_TO_TURN_ON, PAID_LABEL, paidState, type PaidState } from "@/lib/paid"
import { call, isDesktop } from "@/system/desktop"

const PROVIDERS = [
  { id: "openai", name: "OpenAI", hint: "sk-..." },
  { id: "anthropic", name: "Anthropic", hint: "sk-ant-..." },
  { id: "xai", name: "xAI", hint: "xai-..." },
  { id: "google", name: "Google Gemini", hint: "AIza..." },
]

type Result = { ok: boolean; detail: string } | "testing" | undefined

// API keys are kept in the system keychain by the desktop app. The window can save, test and remove
// a key, but never reads one back.
export function SettingsView() {
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [result, setResult] = useState<Record<string, Result>>({})

  const refresh = () =>
    call<{ provider: string; saved: boolean }[]>("keys_status")
      .then((list) => setSaved(Object.fromEntries(list.map((k) => [k.provider, k.saved]))))
      .catch(() => {})
  useEffect(() => { if (isDesktop) void refresh() }, [])

  const note = (id: string, r: Result) => setResult((prev) => ({ ...prev, [id]: r }))
  const test = async (id: string) => {
    note(id, "testing")
    try { note(id, await call<{ ok: boolean; detail: string }>("key_test", { providerId: id })) }
    catch (e) { note(id, { ok: false, detail: String(e) }) }
  }
  const connect = async (id: string) => {
    try {
      await call("key_save", { providerId: id, key: draft[id] ?? "" })
      setDraft((d) => ({ ...d, [id]: "" }))
      await refresh()
      await test(id)
    } catch (e) { note(id, { ok: false, detail: String(e) }) }
  }
  const remove = async (id: string) => {
    try { await call("key_delete", { providerId: id }); note(id, undefined); await refresh() }
    catch (e) { note(id, { ok: false, detail: String(e) }) }
  }

  return (
    <div className="page settings">
      <PageHead title="Settings" about="What the engine on this machine can use, and the API keys kept by the desktop app." />
      <EngineSection />
      <section className="keys" aria-labelledby="keys-title">
        <h2 id="keys-title">Desktop app API keys</h2>
        <p className="muted small">
          Connect a model provider to test it. Keys are stored in your Mac's keychain, not in this window, and are
          sent only to the provider they belong to. No agent uses them yet.
        </p>
        {!isDesktop && <p className="pill pill-warning">Connecting keys needs the desktop app</p>}
        <ul>
          {PROVIDERS.map((p) => {
            const r = result[p.id]
            return (
              <li key={p.id}>
                <div className="keys-name">
                  <strong>{p.name}</strong>
                  <span data-on={saved[p.id] || undefined}>{saved[p.id] ? "Key saved" : "Not connected"}</span>
                </div>
                {saved[p.id] ? (
                  <div className="keys-actions">
                    <button type="button" className="toon-btn toon-btn-light" disabled={r === "testing"} onClick={() => void test(p.id)}>
                      {r === "testing" ? "Testing…" : "Test"}
                    </button>
                    <button type="button" className="link-btn" onClick={() => void remove(p.id)}>Remove</button>
                  </div>
                ) : (
                  <form className="keys-actions" onSubmit={(e) => { e.preventDefault(); void connect(p.id) }}>
                    <input type="password" name={`key-${p.id}`} aria-label={`${p.name} API key`} placeholder={p.hint}
                      autoComplete="off" spellCheck={false} disabled={!isDesktop} value={draft[p.id] ?? ""}
                      onChange={(e) => { const v = e.currentTarget.value; setDraft((d) => ({ ...d, [p.id]: v })) }} />
                    <button type="submit" className="toon-btn" disabled={!isDesktop || !(draft[p.id] ?? "").trim()}>Connect</button>
                  </form>
                )}
                <p className="keys-result" role="status" data-ok={typeof r === "object" ? r.ok : undefined}>
                  {typeof r === "object" ? r.detail : ""}
                </p>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

interface EngineFacts { tools: Record<string, boolean>; keys: Record<string, boolean>; paid: PaidState }

// Read-only: which tools and keys the engine found. Key values never leave the engine; it reports set or not set.
function EngineSection() {
  const [facts, setFacts] = useState<EngineFacts | null>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let stale = false
    const read = (path: string) => fetch(ENGINE + path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    Promise.all([read("/api/glhf/status"), read("/api/status")])
      .then(([swarm, board]) => { if (!stale) setFacts({ tools: swarm.tools ?? {}, keys: { ...board.keys, ...swarm.keys }, paid: paidState(swarm) }) })
      .catch(() => { if (!stale) setFacts(null) })
    return () => { stale = true }
  }, [retry])
  const row = (name: string, on: boolean, yes: string, no: string) => (
    <li key={name}><div className="keys-name"><strong>{name}</strong></div><span className="pill" data-kind={on ? "success" : "warning"}>{on ? yes : no}</span></li>
  )
  return (
    <section className="keys" aria-labelledby="engine-title">
      <h2 id="engine-title">Engine</h2>
      <p className="muted small">The engine starts runs and stores them. It reads its keys from the <code>.env</code> file in the repo root. Address: <code>{ENGINE}</code></p>
      {facts === undefined && <p className="muted small" role="status">Checking the engine…</p>}
      {facts === null && <EngineOffline needs="Tools and keys cannot be checked." onRetry={() => { setFacts(undefined); setRetry((n) => n + 1) }} />}
      {facts && (
        <ul className="engine-facts">
          <li>
            <div className="keys-name"><strong>Paid calls</strong></div>
            <span className="pill" data-kind={facts.paid === "off" ? "neutral" : facts.paid === "on" ? "warning" : "waiting"}>{PAID_LABEL[facts.paid]}</span>
            <p className="engine-how muted small">
              {facts.paid === "off" && "Real models, Exa search and cloud runs are refused. Scripted (mock) runs work and cost nothing. "}
              {facts.paid === "on" && "Runs with real models, Exa search and Ask can spend API credits. To turn paid calls off, remove NO_PAID_CALLS=0 from .env and restart the engine. "}
              {facts.paid !== "on" && HOW_TO_TURN_ON}
            </p>
          </li>
          {Object.entries(facts.tools).map(([name, on]) => row(name, on, "found", "not found"))}
          {Object.entries(facts.keys).sort(([a], [b]) => a.localeCompare(b)).map(([name, on]) => row(name, on, "set", "not set"))}
        </ul>
      )}
    </section>
  )
}
