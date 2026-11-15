// Who looks like what: every agent the engine can name has one face and one label, the same in every view.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AgentAvatar } from "./AgentAvatar"
import { SPECIALISTS, agentIdentity, agentKey, sameFace } from "./identity"

// GET /api/roster and the specialists of GET /api/chat/catalog, as a throwaway engine answered on 14 Nov 2026: name, title.
const ROSTER: [string, string][] = [
  ["lead-scientist", "Lead Scientist"], ["scout", "Scout (Data and Evidence)"], ["proposer", "Proposer (Triage)"], ["experimenter", "Experimenter (Data Scientist)"],
  ["methods-auditor", "Methods Auditor (Quality Checker)"], ["critic", "Critic (Scientific Reviewer)"], ["reporter", "Reporter (Research Writer)"],
]
const CATALOG: [string, string][] = [
  ["admet", "ADMET / DMPK Scientist"], ["attending-skeptic", "Attending (Skeptic)"], ["bulk-rnaseq-analyst", "Bulk RNA-seq analyst"], ["chief", "Chief of Service"],
  ["clinical-and-experimental-design-analyst", "Clinical and experimental design analyst"], ["compound-set-curator", "Compound set curator"], ["contrarian", "Contrarian"],
  ["epigenomics-regulator-analyst", "Epigenomics regulator analyst"], ["immune-cell-therapy-analyst", "Immune cell therapy analyst"],
  ["literature-evidence-synthesist", "Prior-Work and Evidence Synthesist"], ["medicinal-chemist", "Medicinal Chemist"], ["methods-librarian", "Methods Librarian"],
  ["omics-biomarker-integrator", "Omics biomarker integrator"], ["perturbation-and-crispr-specialist", "Perturbation and CRISPR specialist"],
  ["protein-and-antibody-engineer", "Protein and antibody engineer"], ["qsar-property-modeler", "QSAR property modeler"], ["sar-analyst", "SAR analyst"],
  ["single-cell-core-analyst", "Single cell core analyst"], ["single-cell-multimodal-spatial-analyst", "Single cell multimodal spatial analyst"],
  ["small-molecule-designer", "Small molecule designer"], ["statistical-geneticist", "Statistical geneticist"], ["target-biologist", "Target Biologist"],
  ["target-prioritiser", "Target prioritiser"], ["target-safety-druggability-analyst", "Target safety druggability analyst"], ["toxicologist", "Toxicologist"],
  ["variant-and-genome-analyst", "Variant and genome analyst"], ["workflow-and-method-engineer", "Workflow and method engineer"],
]
const face = (name: string, title?: string) => { const i = agentIdentity(name, { title }); return `${i.shape}:${i.colour}` }

describe("agentIdentity", () => {
  it("gives every member of the default team its character, and the engine's own title as the label", () => {
    const got = ROSTER.map(([name, title]) => agentIdentity(name, { title }))
    expect(got.map((i) => i.character)).toEqual(["navigator", "scout", "proposer", "experimenter", "auditor", "critic", "reporter"])
    expect(got.map((i) => i.label)).toEqual(ROSTER.map(([, title]) => title))
    expect(got.map((i) => i.short)).toEqual(["Lead Scientist", "Scout", "Proposer", "Experimenter", "Methods Auditor", "Critic", "Reporter"])
    expect(new Set(got.map((i) => `${i.shape}:${i.colour}`)).size).toBe(ROSTER.length)
    expect(got.every((i) => i.kind === "agent")).toBe(true)
  })

  it("gives every specialist the catalog can add a face of its own, different from the team's, and its title as the label", () => {
    expect(CATALOG.map(([name]) => name)).toEqual([...SPECIALISTS]) // the list in identity.ts is the catalog's
    const got = CATALOG.map(([name, title]) => agentIdentity(name, { title }))
    expect(got.every((i) => i.kind === "specialist" && i.shape !== "generic")).toBe(true)
    expect(got.map((i) => i.label)).toEqual(CATALOG.map(([, title]) => title))
    const faces = [...ROSTER, ...CATALOG, ["pilot", ""], ["reviser", ""], ["finisher", ""], ["first-pass", ""], ["librarian", ""]].map(([name]) => face(name))
    expect(new Set(faces).size).toBe(faces.length) // 39 agents, 39 faces
  })

  it("finds the same face from the label alone, for a caller that has no name", () => {
    for (const [name, title] of [...ROSTER, ...CATALOG]) {
      const byTitle = agentIdentity(title)
      expect(sameFace(byTitle, agentIdentity(name)), title).toBe(true)
      expect(byTitle.label).toBe(title)
    }
    expect(agentKey("Methods Auditor (Quality Checker)")).toBe("methods-auditor")
  })

  it("never invents a title: without one the label is the name itself, made readable", () => {
    expect(agentIdentity("lead-scientist").label).toBe("Lead scientist")
    expect(agentIdentity("methods-auditor").label).toBe("Methods auditor")
    expect(agentIdentity("target-safety-druggability-analyst").label).toBe("Target safety druggability analyst")
    expect(agentIdentity("scout").label).toBe("Scout")
  })

  it("gives an unknown name the neutral face and its own name, never another agent's face", () => {
    const known = new Set([...ROSTER, ...CATALOG].map(([name]) => face(name)))
    for (const name of ["someone-new", "", "Dr Nobody", "scout2", "target-biologist-2", "<script>"]) {
      const i = agentIdentity(name)
      expect(i.kind).toBe("unknown")
      expect(i.shape).toBe("generic")
      expect(known.has(`${i.shape}:${i.colour}`)).toBe(false)
    }
    expect(agentIdentity("someone-new").label).toBe("Someone new")
    expect(agentIdentity("someone-new", { title: "A New Role" }).label).toBe("A New Role")
    expect(agentIdentity("").label).toBe("Unknown")
  })

  it("gives the experimenter the Pilot's or the Reviser's face when the reply names that mode, and older names their own", () => {
    expect(agentIdentity("experimenter", { mode: "pilot", title: "Pilot" })).toMatchObject({ character: "pilot", label: "Pilot" })
    expect(agentIdentity("experimenter", { mode: "revise" }).character).toBe("reviser")
    expect(agentIdentity("experimenter", { mode: "full" }).character).toBe("experimenter")
    expect(agentIdentity("scout", { mode: "pilot" }).character).toBe("scout") // only a member with modes changes
    expect(["pilot", "reviser", "finisher", "auditor"].map((n) => agentIdentity(n).character)).toEqual(["pilot", "reviser", "finisher", "auditor"])
  })

  it("knows the swarm's roles and steps by the engine's names, and the checkers", () => {
    expect(["scout", "propose", "pilot", "experiment", "audit 2", "critique 1", "revise 1", "finish", "report", "planner", "engine"].map((n) => agentIdentity(n).character))
      .toEqual(["scout", "proposer", "pilot", "experimenter", "auditor", "critic", "reviser", "finisher", "reporter", "proposer", "navigator"])
    expect(agentIdentity("audit 2").label).toBe("Audit")
    for (const checker of ["first-pass", "jev", "openai", "anthropic", "claude-code"]) expect(agentIdentity(checker)).toMatchObject({ character: "guardian", kind: "checker" })
    expect(agentIdentity("first-pass").label).toBe("First check")
    expect(agentIdentity("claude-code").label).toBe("Second, more careful check")
  })
})

describe("AgentAvatar", () => {
  it("is a still picture of the right size, hidden from screen readers by default", () => {
    const { container } = render(<><AgentAvatar name="scout" size={24} /><AgentAvatar name="scout" /><AgentAvatar name="scout" size={40} /></>)
    const pictures = [...container.querySelectorAll("svg")]
    expect(pictures.map((p) => [p.getAttribute("width"), p.getAttribute("height")])).toEqual([["24", "24"], ["32", "32"], ["40", "40"]])
    for (const p of pictures) {
      expect(p).toHaveAttribute("aria-hidden", "true")
      expect(p).toHaveAttribute("data-face", "bunny:#f6b6cd")
      expect(p.querySelector("animate, animateTransform")).toBeNull()
      expect(p.querySelector("text")).toBeNull() // the Buddy alone: no mood signs
    }
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("can carry its label for a screen reader, and shows the same face as the mapping says", () => {
    render(<><AgentAvatar name="lead-scientist" title="Lead Scientist" labelled /><AgentAvatar name="experimenter" mode="pilot" labelled /><AgentAvatar name="who-is-this" labelled /></>)
    expect(screen.getByRole("img", { name: "Lead Scientist" })).toHaveAttribute("data-face", "mountain:#8f7fe0")
    expect(screen.getByRole("img", { name: "Experimenter" })).toHaveAttribute("data-face", "egg:#ffcf4a")
    expect(screen.getByRole("img", { name: "Who is this" })).toHaveAttribute("data-face", "generic:#cfcabd")
  })

  it("draws forty of them in one go", () => {
    const names = [...ROSTER, ...CATALOG].map(([name]) => name)
    const { container } = render(<>{Array.from({ length: 40 }, (_, i) => <AgentAvatar key={i} name={names[i % names.length]} size={32} />)}</>)
    expect(container.querySelectorAll("svg")).toHaveLength(40)
  })
})
