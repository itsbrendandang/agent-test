import { useEffect, useId, useState, type FormEvent } from "react"
import { ENGINE } from "@/board/api"
import { setCharactersShown, useCharacters } from "@/crew/store"
import { ModeSwitch } from "@/components/PaidSwitch"
import { problemOf, readEngine, type Problem } from "@/lib/engine"
import { PAID_CHANGED } from "@/lib/paidSwitch"
import { clearProfile, saveProfile, useProfile } from "@/lib/profile"
import { openHelp, useShell } from "@/lib/shell"
import { ChatRefused, getCatalog, type Catalog } from "@/home/api"
import { CatalogPanel } from "@/home/CatalogPanel"
import { EngineOffline, PageHead } from "@/components/Shared"
import { forgetToken, TOKEN_FILE, useHasToken } from "@/lib/token"

// Settings: Your profile, Run mode, Session token, Appearance, Help, then Technical (closed at first). One heading style and one
// container for every section. The cost of Real is said once (Run mode); what happens to API keys once (Connections).
export function SettingsView() {
  const characters = useCharacters()

  return (
    <div className="page settings">
      <PageHead title="Settings" about="Choose how runs are made and see what the app is connected to." />
      <YourProfile />
      <RunMode />
      <section className="set-section" aria-labelledby="token-title">
        <h2 id="token-title">Session token</h2>
        <TokenRow />
      </section>
      <section className="set-section" aria-labelledby="look-title">
        <h2 id="look-title">Appearance</h2>
        <label className="newrun-check">
          <input type="checkbox" checked={characters} onChange={(e) => setCharactersShown(e.target.checked)} /> Show characters
        </label>
        <p className="muted small">Momo, Ember, Fuji and Sage are decoration, not the agents that do the work. The choice is remembered in this browser.</p>
      </section>
      <section className="set-section" aria-labelledby="help-title">
        <h2 id="help-title">Help</h2>
        <p className="muted small">Four plain steps: you ask, it searches and writes, statements are checked, you read the answer.</p>
        <button type="button" className="btn" onClick={openHelp}>How this works</button>
      </section>
      <Technical />
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

/**
 * Your profile: a name, an organisation or client and an optional role, shown in the profile row of the navigation.
 * The app has no accounts: this stays in this browser (lib/profile.ts) and is never sent to the engine.
 */
function YourProfile() {
  const saved = useProfile()
  const uid = useId()
  const [draft, setDraft] = useState<{ name: string; organisation: string; role: string }>()
  const [note, setNote] = useState<string>()
  const form = draft ?? { name: saved?.name ?? "", organisation: saved?.organisation ?? "", role: saved?.role ?? "" }
  const set = (field: "name" | "organisation" | "role", value: string) => { setDraft({ ...form, [field]: value }); setNote(undefined) }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setNote("Type a name first. Nothing was saved."); return }
    saveProfile(form); setDraft(undefined); setNote("Saved in this browser.")
  }
  const clear = () => { clearProfile(); setDraft(undefined); setNote("Cleared. Nothing about you is stored in this browser now.") }
  return (
    <section className="set-section" aria-labelledby="profile-title">
      <h2 id="profile-title">Your profile</h2>
      <p className="muted small">Shown at the foot of the navigation. It stays in this browser and is never sent to the engine. There are no accounts to log in to.</p>
      <form className="set-profile" onSubmit={save}>
        <label htmlFor={`${uid}-name`}>Name</label>
        <input id={`${uid}-name`} name="profile-name" type="text" autoComplete="name" maxLength={60} value={form.name} onChange={(e) => set("name", e.currentTarget.value)} aria-describedby={note ? `${uid}-note` : undefined} />
        <label htmlFor={`${uid}-org`}>Organisation or client</label>
        <input id={`${uid}-org`} name="profile-organisation" type="text" autoComplete="organization" maxLength={80} value={form.organisation} onChange={(e) => set("organisation", e.currentTarget.value)} />
        <label htmlFor={`${uid}-role`}>Role <span className="muted">(optional)</span></label>
        <input id={`${uid}-role`} name="profile-role" type="text" autoComplete="organization-title" maxLength={60} value={form.role} onChange={(e) => set("role", e.currentTarget.value)} />
        <div className="set-profile-actions">
          <button type="submit" className="btn btn-primary">Save</button>
          {saved && <button type="button" className="btn" onClick={clear}>Clear</button>}
          <span className="muted small" role="status" id={`${uid}-note`}>{note}</span>
        </div>
      </form>
    </section>
  )
}

interface EngineFacts { tools: Record<string, boolean>; keys: Record<string, boolean> }
/** What the engine says it found: tools, and which keys are set (never a value). Read again after a switch. */
function useEngineFacts() {
  const [facts, setFacts] = useState<EngineFacts | null>()
  const [problem, setProblem] = useState<Problem>({})
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let stale = false
    const read = (path: string) => readEngine<{ tools?: Record<string, boolean>; keys?: Record<string, boolean> }>(path)
    Promise.all([read("/api/glhf/status"), read("/api/status")])
      .then(([swarm, board]) => { if (!stale) setFacts({ tools: swarm.tools ?? {}, keys: { ...board.keys, ...swarm.keys } }) })
      .catch((e: unknown) => { if (!stale) { setFacts(null); setProblem(problemOf(e)) } })
    return () => { stale = true }
  }, [retry])
  useEffect(() => { const again = () => setRetry((n) => n + 1); window.addEventListener(PAID_CHANGED, again); return () => window.removeEventListener(PAID_CHANGED, again) }, [])
  return { facts, problem, again: () => { setFacts(undefined); setRetry((n) => n + 1) } }
}

/**
 * Run mode: the one place to choose Demo or Real, with what each means. The control shows the engine's own state
 * (read every few seconds and again right after a switch), and choosing Real opens the same confirm dialog as
 * always. The cost is said here, once: the control does not repeat the description beside it.
 */
function RunMode() {
  const shell = useShell()
  return (
    <section className="set-section" aria-labelledby="mode-title">
      <h2 id="mode-title">Run mode</h2>
      <p className="muted small">Past results keep the mode they were run in.</p>
      <ModeSwitch paid={shell.paid} locked={shell.locked} compact label="Run mode: Demo or Real" describedBy="mode-demo mode-real" />
      <ul className="set-modes">
        <li id="mode-demo"><b>Demo</b> uses fixed example answers and is free.</li>
        <li id="mode-real"><b>Real</b> uses live AI models and web search, which cost money. You confirm before each run.</li>
      </ul>
    </section>
  )
}

/** For the person who runs the app: what the app is connected to, the tools and keys the engine found, and file names. Closed at first. */
function Technical() {
  const { facts, problem, again } = useEngineFacts()
  const [catalog, setCatalog] = useState<Catalog | null>()
  const [why, setWhy] = useState<string>()
  const [reread, setReread] = useState(0)
  useEffect(() => {
    let stale = false
    getCatalog().then((c) => { if (!stale) { setCatalog(c); setWhy(undefined) } }, (e: unknown) => { if (!stale) { setCatalog(null); setWhy(e instanceof ChatRefused && e.status !== 0 ? e.message : undefined) } })
    const next = () => setReread((n) => n + 1)
    window.addEventListener(PAID_CHANGED, next)
    return () => { stale = true; window.removeEventListener(PAID_CHANGED, next) }
  }, [reread])
  const row = (name: string, on: boolean, yes: string, no: string) => (
    <li key={name}>
      <div className="keys-name"><strong>{THING[name]?.[0] ?? name}</strong><span className="muted small">{THING[name] ? <>{THING[name][1]} <code>{name}</code></> : null}</span></div>
      <span className="pill" data-kind={on ? "success" : "warning"}>{on ? yes : no}</span>
    </li>
  )
  return (
    <details className="set-section technical">
      <summary><h2>Technical</h2></summary>
      <CatalogPanel catalog={catalog} why={why} onRetry={() => { setCatalog(undefined); setReread((n) => n + 1) }} />
      <p className="muted small">For the person who runs the app. Engine address: <code>{ENGINE}</code>. Settings file: <code>.env</code> in the project folder. Session token file: <code>{TOKEN_FILE}</code>.</p>
      {facts === undefined && <p className="muted small" role="status">Checking the engine…</p>}
      {facts === null && <EngineOffline needs="The tools and keys the engine found cannot be listed." said={problem.said} onRetry={again} />}
      {facts && (
        <ul className="engine-facts" aria-label="Tools and keys the engine found">
          {Object.entries(facts.tools).map(([name, on]) => row(name, on, "found", "not found"))}
          {Object.entries(facts.keys).sort(([a], [b]) => a.localeCompare(b)).map(([name, on]) => row(name, on, "set", "not set"))}
        </ul>
      )}
    </details>
  )
}

/** The engine's session token: entered or not, and a way to forget it. The token itself is never shown. */
export function TokenRow() {
  const held = useHasToken()
  return (
    <div className="set-token">
      <p className="token-row">
        <span className="pill" data-kind={held ? "success" : "neutral"}>{held ? "Entered for this tab" : "Not entered yet"}</span>
        {held && <button type="button" className="btn" onClick={forgetToken}>Forget token</button>}
      </p>
      <p className="muted small">Required for Real runs. You'll be asked for it once, and it stays in this browser tab only. Ask whoever runs the app if you don't have it.</p>
    </div>
  )
}
