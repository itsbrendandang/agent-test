import { useEffect, useState } from "react"
import { ENGINE } from "@/board/api"
import { useSwarm } from "@/swarm/api"
import { ROLES, roleOf, type RoleCatalog } from "@/swarm/roles"
import { SPECIES, Buddy } from "@/components/Buddy"
import { CrewSprite } from "@/crew/CrewSprite"
import { buildSkill, SKILL_STARTERS, suggestStarter } from "@/crew/skills"
import { readCharacterImage, useCrew, type CrewMember } from "@/crew/store"

// Crew editor: name, role and look for each desktop character. No AI agents are wired to them yet.
export function AgentsView() {
  const { crew, update } = useCrew()
  const [error, setError] = useState("")
  const upload = async (id: string, file: File | undefined) => {
    if (!file) return
    try {
      update(id, { image: await readCharacterImage(file) })
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that image")
    }
  }

  const importSkill = async (id: string, file: File | undefined) => {
    if (!file) return
    if (file.size > 100_000) { setError("That file is too large for a SKILL.md"); return }
    update(id, { skill: await file.text() })
    setError("")
  }
  const downloadSkill = (m: CrewMember) => {
    const url = URL.createObjectURL(new Blob([m.skill ?? ""], { type: "text/markdown" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "SKILL.md"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <SwarmTeam />
      <header className="page-head crew-head">
        <div>
          <h1>Your crew</h1>
          <p className="muted small">The characters in the side rail. Give each a name, a role, a look and a SKILL.md. They are not connected to AI agents, so the skill is saved but not used.</p>
        </div>
      </header>
      {error && <p role="alert" className="pill" data-kind="danger">{error}</p>}

      <section className="cast">
        {crew.map((m) => (
          <article key={m.id} className="cast-card card-surface">
            <div className="cast-preview"><CrewSprite member={m} size={110} /></div>
            <label className="toon-field">
              <span>Name</span>
              <input name={`name-${m.id}`} value={m.name} maxLength={20} onChange={(e) => update(m.id, { name: e.currentTarget.value })} />
            </label>
            <label className="toon-field">
              <span>Role</span>
              <input name={`role-${m.id}`} value={m.role} maxLength={24} onChange={(e) => update(m.id, { role: e.currentTarget.value })} />
            </label>
            <fieldset className="toon-field">
              <legend>Character</legend>
              <div className="look-row">
                {SPECIES.map((s) => (
                  <button key={s} type="button" className="look" aria-label={s} aria-pressed={!m.image && m.species === s}
                    onClick={() => update(m.id, { species: s, image: undefined })}>
                    <Buddy species={s} size={40} />
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="upload-row">
              <label className="toon-btn toon-btn-light">
                Upload your own
                <input type="file" accept="image/png,image/webp,image/gif,image/jpeg,image/svg+xml" hidden
                  onChange={(e) => { void upload(m.id, e.currentTarget.files?.[0]); e.currentTarget.value = "" }} />
              </label>
              {m.image && <button type="button" className="link-btn" onClick={() => update(m.id, { image: undefined })}>Remove</button>}
            </div>
            <SkillEditor member={m} onChange={(skill) => update(m.id, { skill })}
              onImport={(f) => void importSkill(m.id, f)} onDownload={() => downloadSkill(m)} />
          </article>
        ))}
      </section>
    </div>
  )
}

function SkillEditor({ member, onChange, onImport, onDownload }: {
  member: CrewMember
  onChange: (skill: string | undefined) => void
  onImport: (file: File | undefined) => void
  onDownload: () => void
}) {
  const suggested = suggestStarter(member.role)
  const replace = (text: string) => {
    if (member.skill?.trim() && !window.confirm(`Replace ${member.name}'s current SKILL.md?`)) return
    onChange(text)
  }
  return (
    <div className="toon-field skill">
      <label htmlFor={`skill-${member.id}`}>SKILL.md</label>
      {!member.skill && suggested && (
        <p className="skill-hint">
          Suggested for a {member.role}:{" "}
          <button type="button" className="link-btn" onClick={() => onChange(buildSkill(member, suggested))}>
            use the {suggested.label} starter
          </button>
        </p>
      )}
      <textarea id={`skill-${member.id}`} name={`skill-${member.id}`} rows={8} spellCheck={false} value={member.skill ?? ""}
        placeholder={"---\nname: \ndescription: \n---\n\nWhat this agent does and how."}
        onChange={(e) => onChange(e.currentTarget.value || undefined)} />
      <div className="skill-starters" role="group" aria-label="Starters">
        {SKILL_STARTERS.map((st) => (
          <button key={st.id} type="button" className="skill-chip" data-suggested={st === suggested || undefined}
            onClick={() => replace(buildSkill(member, st))}>{st.label}</button>
        ))}
      </div>
      <div className="upload-row">
        <label className="link-btn">
          Import .md
          <input type="file" accept=".md,text/markdown,text/plain" hidden
            onChange={(e) => { onImport(e.currentTarget.files?.[0]); e.currentTarget.value = "" }} />
        </label>
        {member.skill && <button type="button" className="link-btn" onClick={onDownload}>Download</button>}
        {member.skill && <button type="button" className="link-btn" onClick={() => onChange(undefined)}>Clear</button>}
      </div>
    </div>
  )
}

const GROUP = { planner: "planner", experimenter: "experimenter", critic: "critic", reporter: "reporter" } as const

// The nine swarm roles in the crew's card layout: what each does, its share of the time, the model
// it runs on in the latest run, and its instructions as the solver defines them (read-only).
function SwarmTeam() {
  const { runs, detail, offline } = useSwarm(undefined, 0)
  const [catalog, setCatalog] = useState<RoleCatalog>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch(`${ENGINE}/api/glhf/roles`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setCatalog).catch(() => setFailed(true))
  }, [])

  const run = runs?.find((r) => r.solver === "glhf")
  const ledger = detail?.run.id === run?.id ? detail?.ledger : undefined
  const events = ledger?.events ?? []
  const started = new Set(events.filter((e) => e.kind === "phase.started").map((e) => roleOf(e.phase)))
  const last = events.findLast((e) => e.kind === "phase.started" || e.kind === "phase.finished")
  const live = run && run.phase !== "done" && run.phase !== "failed"
  const active = live && last?.kind === "phase.started" ? roleOf(last.phase) : undefined

  return (
    <>
      <header className="page-head crew-head">
        <div>
          <h1>Swarm team</h1>
          <p className="muted small">
            Nine roles, in the order they run. Each is a separate agent with its own instructions; they share only the files and the ledger.
            {run ? ` Status is from the latest swarm run (${run.id}).` : ""}
          </p>
        </div>
        {(offline || failed) && <span className="pill pill-warning">Start the engine to load instructions</span>}
      </header>
      <section className="cast">
        {ROLES.map((r, i) => {
          const spec = catalog?.roles.find((x) => x.key === r.key)
          const model = spec && run ? run.roleModels?.[GROUP[spec.model_group]] ?? run.model : undefined
          const state = active === r.key ? "working now" : started.has(r.key) ? "ran in the latest run" : run ? "did not run in the latest run" : "no runs yet"
          return (
            <article key={r.key} className="cast-card card-surface team-card" data-active={active === r.key || undefined}>
              <div className="team-top">
                <Buddy species={r.species} mood={active === r.key ? "working" : started.has(r.key) ? "happy" : "sleeping"} size={64} />
                <div>
                  <h2>{i + 1}. {r.name}</h2>
                  <p className="small">{r.does}.</p>
                </div>
              </div>
              <dl className="team-facts">
                <dt>Time</dt><dd>{spec?.budget ?? "–"}</dd>
                <dt>Model</dt><dd>{spec ? <>{model ?? "the run's model"} <span className="muted">({spec.model_group} group)</span></> : "–"}</dd>
                <dt>Status</dt><dd>{state}</dd>
              </dl>
              {spec && (
                <details className="team-prompt">
                  <summary>Instructions</summary>
                  <pre>{spec.instructions}</pre>
                </details>
              )}
            </article>
          )
        })}
      </section>
      {catalog && (
        <details className="team-prompt team-shared card-surface">
          <summary>Rules every role follows</summary>
          <pre>{catalog.shared_rules}</pre>
        </details>
      )}
    </>
  )
}
