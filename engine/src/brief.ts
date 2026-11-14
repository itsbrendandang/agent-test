// A brief is Markdown with required "## Section" headings. A brief missing one is rejected before any
// model runs: the video's "force good prompt engineering" rule.
import { readFileSync } from "node:fs"
import { basename } from "node:path"

export interface Brief {
  id: string
  title: string
  markdown: string
  sections: Record<string, string>
  keyQuestions: string[]
}

export class BriefRejected extends Error {}

// A template placeholder left in: "<" then a letter, closed by ">" on the same line, as in "<SMILES>" or
// "<One decision, phrased so...>". A comparison such as "IC50 < 10 nM" or "<10 nM" is not a placeholder.
const PLACEHOLDER = /<[A-Za-z][^<>\n]*>/

export function loadBrief(file: string, required: string[]): Brief {
  const markdown = readFileSync(file, "utf8")
  const sections: Record<string, string> = {}
  let current: string | undefined
  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) { current = heading[1]; sections[current] = ""; continue }
    if (current) sections[current] += line + "\n"
  }
  const missing = required.filter((s) => !sections[s]?.trim() || PLACEHOLDER.test(sections[s]))
  if (missing.length) throw new BriefRejected(`Brief ${basename(file)} is missing or has unfilled sections: ${missing.join(", ")}`)
  const keyQuestions = (sections["Key Questions"] ?? "")
    .split("\n").map((l) => l.replace(/^\s*\d+\.\s*/, "").trim()).filter(Boolean)
  const title = /^#\s+(?:Brief:\s*)?(.+)$/m.exec(markdown)?.[1] ?? basename(file, ".md")
  return { id: basename(file, ".md"), title, markdown, sections, keyQuestions }
}
