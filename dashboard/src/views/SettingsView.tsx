import { useEffect, useState } from "react"
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
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <section className="keys" aria-labelledby="keys-title">
        <h2 id="keys-title">API keys</h2>
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
