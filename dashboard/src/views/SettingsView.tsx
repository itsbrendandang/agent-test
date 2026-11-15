import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"
import { setCharactersShown, useCharacters } from "@/crew/store"
import { ModeSwitch } from "@/components/PaidSwitch"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { PAID_CHANGED } from "@/lib/paidSwitch"
import { openHelp } from "@/lib/shell"
import { ChatRefused, getCatalog, type Catalog } from "@/home/api"
import { CatalogPanel } from "@/home/CatalogPanel"
import { EngineOffline, PageHead } from "@/components/Shared"
import { HOW_TO_TURN_ON, paidState, type PaidState } from "@/lib/paid"
import { forgetToken, TOKEN_FILE, useHasToken } from "@/lib/token"
import { call, isDesktop } from "@/system/desktop"

const PROVIDERS = [
  { id: "openai", name: "OpenAI", hint: "sk-..." },
  { id: "anthropic", name: "Anthropic", hint: "sk-ant-..." },
]

type Result = { ok: boolean; detail: string } | "testing" | undefined

// API keys are kept in the system keychain by the desktop app. The window can save, test and remove
// a key, but never reads one back.
export function SettingsView() {
  const characters = useCharacters()
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
      <PageHead title="Settings" about={isDesktop ? "What the engine on this machine can use, and the API keys kept by the desktop app." : "What the engine on this machine can use. Keys are set in its .env file, never in this page."} />
      <EngineSection />
      <SetupDetails />
      <section className="keys" aria-labelledby="help-title">
        <h2 id="help-title">Help</h2>
        <p className="muted small">Four plain steps: you ask, a team discusses, every statement is checked, you get an answer.</p>
        <button type="button" className="btn" onClick={openHelp}>How this works</button>
      </section>
      <section className="keys" aria-labelledby="look-title">
        <h2 id="look-title">Appearance</h2>
        <label className="newrun-check">
          <input type="checkbox" checked={characters} onChange={(e) => setCharactersShown(e.target.checked)} /> Show characters
        </label>
        <p className="muted small">Momo, Ember and Fuji are decoration: they appear on the loading screen, on Home and while something loads. They are not the agents that do the work. Turn them off if they distract you; the choice is remembered in this browser.</p>
      </section>
      {isDesktop && (
      <section className="keys" aria-labelledby="keys-title">
        <h2 id="keys-title">Desktop app API keys</h2>
        <p className="muted small">
          Connect a model provider to test it. Keys are stored in your Mac's keychain, not in this window, and are
          sent only to the provider they belong to. No agent uses them yet.
        </p>
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
                    <button type="button" className="btn" disabled={r === "testing"} onClick={() => void test(p.id)}>
                      {r === "testing" ? "Testing…" : "Test"}
                    </button>
                    <button type="button" className="link-btn" onClick={() => void remove(p.id)}>Remove</button>
                  </div>
                ) : (
                  <form className="keys-actions" onSubmit={(e) => { e.preventDefault(); void connect(p.id) }}>
                    <input type="password" name={`key-${p.id}`} aria-label={`${p.name} API key`} placeholder={p.hint}
                      autoComplete="off" spellCheck={false} disabled={!isDesktop} value={draft[p.id] ?? ""}
                      onChange={(e) => { const v = e.currentTarget.value; setDraft((d) => ({ ...d, [p.id]: v })) }} />
                    <button type="submit" className="btn btn-primary" disabled={!isDesktop || !(draft[p.id] ?? "").trim()}>Connect</button>
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
      )}
    </div>
  )
}

/** What each tool and key is for, in plain words. The engine's own name stays as the small second line. */
const THING: Record<string, [string, string]> = {
  docker: ["Docker", "Runs each analysis in a sealed box."],
  uv: ["uv (Python tools)", "Starts the analysis programs."],
  gcloud: ["Google Cloud tools", "Only needed for cloud runs."],
  ANTHROPIC_API_KEY: ["Key for Claude (Anthropic)", "Lets real Claude models be used."],
  OPENAI_API_KEY: ["Key for OpenAI", "Lets real OpenAI models be used."],
  EXA_API_KEY: ["Key for web search (Exa)", "Lets the team look things up."],
  HF_TOKEN: ["Key for Hugging Face", "Lets benchmark data be downloaded."],
}

/** Models, keys, team members and skills: what used to sit beside the search box. Read from the engine's catalog. */
function SetupDetails() {
  const [catalog, setCatalog] = useState<Catalog | null>()
  const [why, setWhy] = useState<string>()
  const [again, setAgain] = useState(0)
  useEffect(() => {
    let stale = false
    getCatalog().then((c) => { if (!stale) { setCatalog(c); setWhy(undefined) } }, (e: unknown) => { if (!stale) { setCatalog(null); setWhy(e instanceof ChatRefused && e.status !== 0 ? e.message : undefined) } })
    const reread = () => setAgain((n) => n + 1)
    window.addEventListener(PAID_CHANGED, reread)
    return () => { stale = true; window.removeEventListener(PAID_CHANGED, reread) }
  }, [again])
  return <CatalogPanel catalog={catalog} why={why} onRetry={() => { setCatalog(undefined); setAgain((n) => n + 1) }} />
}

interface EngineFacts { tools: Record<string, boolean>; keys: Record<string, boolean>; paid: PaidState; locked: boolean }

// Read-only: which tools and keys the engine found. Key values never leave the engine; it reports set or not set.
function EngineSection() {
  const [facts, setFacts] = useState<EngineFacts | null>()
  const [problem, setProblem] = useState<Problem>({})
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let stale = false
    const read = (path: string) => readEngine<{ tools?: Record<string, boolean>; keys?: Record<string, boolean>; paidCalls?: unknown; paidLocked?: unknown }>(path)
    Promise.all([read("/api/glhf/status"), read("/api/status")])
      .then(([swarm, board]) => { if (!stale) setFacts({ tools: swarm.tools ?? {}, keys: { ...board.keys, ...swarm.keys }, paid: paidState(swarm), locked: swarm.paidLocked === true }) })
      .catch((e: unknown) => { if (!stale) { setFacts(null); setProblem(problemOf(e)) } })
    return () => { stale = true }
  }, [retry])
  // The switch was used (here or in the status line): read the engine again.
  useEffect(() => { const again = () => setRetry((n) => n + 1); window.addEventListener(PAID_CHANGED, again); return () => window.removeEventListener(PAID_CHANGED, again) }, [])
  const row = (name: string, on: boolean, yes: string, no: string) => (
    <li key={name}>
      <div className="keys-name"><strong>{THING[name]?.[0] ?? name}</strong><span className="muted small">{THING[name] ? <>{THING[name][1]} <code>{name}</code></> : null}</span></div>
      <span className="pill" data-kind={on ? "success" : "warning"}>{on ? yes : no}</span>
    </li>
  )
  return (
    <section className="keys" aria-labelledby="engine-title">
      <h2 id="engine-title">What this computer can use</h2>
      <p className="muted small">The engine is the program on this computer that starts runs and keeps their results. This page only reads from it. It reads its keys from a file called <code>.env</code>. Address: <code>{ENGINE}</code></p>
      {facts === undefined && <p className="muted small" role="status">Checking the engine…</p>}
      {facts === null && <EngineOffline needs="Tools and keys cannot be checked." said={problem.said} onRetry={() => { setFacts(undefined); setRetry((n) => n + 1) }} />}
      {facts && (
        <ul className="engine-facts">
          <li>
            <div className="keys-name"><strong>Demo or Real</strong><span className="muted small">Whether runs may cost money.</span></div>
            <ModeSwitch paid={facts.paid} locked={facts.locked} compact />
            <p className="engine-how muted small">
              {facts.paid === "off" && "Nothing that costs money can start: no real models, no web search, no cloud runs. Practice runs (fixed text, no model) work and cost nothing. "}
              {facts.paid === "on" && "Runs with real models and web search cost money. Each one still asks you to confirm first. "}
              {facts.paid !== "on" && HOW_TO_TURN_ON}
            </p>
          </li>
          <TokenRow />
          {Object.entries(facts.tools).map(([name, on]) => row(name, on, "found", "not found"))}
          {Object.entries(facts.keys).sort(([a], [b]) => a.localeCompare(b)).map(([name, on]) => row(name, on, "set", "not set"))}
        </ul>
      )}
    </section>
  )
}

/** The engine's session token: held or not, and a way to forget it. The token itself is never shown. */
export function TokenRow() {
  const held = useHasToken()
  return (
    <li>
      <div className="keys-name"><strong>Session token</strong><span className="muted small">A password for this session.</span></div>
      <span className="token-row">
        <span className="pill" data-kind={held ? "success" : "waiting"}>{held ? "held for this tab" : "not held"}</span>
        {held && <button type="button" className="btn" onClick={forgetToken}>Forget token</button>}
      </span>
      <p className="engine-how muted small">
        Anything that can spend money needs the engine's session token. The engine writes it to <code>{TOKEN_FILE}</code> when it starts, and this page asks for it
        the first time it is needed. It is kept for this browser tab only, never saved to disk by the page, and never shown again.
      </p>
    </li>
  )
}
