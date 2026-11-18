// The app's words, in one place, so every view says the same thing in plain language. The expert term stays
// available as a tooltip or a small second line; it is never the only thing a newcomer reads.

/** A run made with fixed, scripted text instead of a model. The badge itself is the Provenance component ("Practice"). */
export const PRACTICE = "Practice: fixed example answers, not real research"
export const REAL = "Live research: real AI models"

// ---- who does the work, and on what. On screen these are the only words: the mode is Demo or Real, a run's label
// is Practice or Live research (lib/provenance.ts), the nine-agent solver is the "team of nine", the baseline is
// "one agent", and what they work on is a "benchmark task". Never "swarm", "glhf", "task run", "mock", "scripted"
// or "board" on screen.
export const TEAM_OF_NINE = "Team of nine"
export const ONE_AGENT = "One agent"
/** The solver in the record ("glhf", "swarm", "single", "single agent") as the words a person reads. */
export const solverWord = (solver: unknown): string => (/single/i.test(String(solver)) ? ONE_AGENT : TEAM_OF_NINE)
/** What a benchmark run worked on: "the demo task", or "benchmark task <id>". */
export const taskWord = (task: string): string => (task === "demo" ? "the demo task" : `benchmark task ${task}`)
/**
 * Where one analysis ran (a registered test, in the run's ledger): its event's `backend` ("docker" or "modal", see
 * ANALYSIS_BACKEND) and `sandbox_id`, in plain words. undefined when the event does not say (older runs).
 */
export function sandboxWords(backend: unknown, sandboxId?: unknown): string | undefined {
  if (backend === "modal") return `a Modal sandbox${typeof sandboxId === "string" && sandboxId ? ` (${sandboxId})` : ""}`
  if (backend === "docker") return "a Docker sandbox"
  return typeof backend === "string" && backend && backend !== "unknown" ? `a ${backend} sandbox` : undefined
}
/** One pattern for every benchmark run's title: "Team of nine on the demo task", "One agent on benchmark task bix-12". */
export const benchmarkTitle = (solver: unknown, task: string): string => `${solverWord(solver)} on ${taskWord(task)}`
/** The limit on how much text the models may read and write. */
export const TOKEN_LIMIT = "token limit"

/** Cut at a word, with "…", when a text is longer than `max`. Never mid-word. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max + 1)
  const at = cut.lastIndexOf(" ")
  return `${(at > max * 0.5 ? cut.slice(0, at) : flat.slice(0, max)).replace(/[\s,;:.-]+$/, "")}…`
}

/**
 * A title the engine may have cut. It cuts a title made from a question at 70 or 80 characters, sometimes inside a
 * word. A title of exactly that length that ends in a letter or digit is shown up to its last whole word, with "…".
 */
export const mendTitle = (title: string): string => {
  const t = title.trim()
  return (t.length === 70 || t.length === 80) && /[\p{L}\p{N}]$/u.test(t) && t.includes(" ") ? `${t.slice(0, t.lastIndexOf(" ")).replace(/[\s,;:.-]+$/, "")}…` : t
}

// ---- the four marks. One vocabulary for what a check found, in every view. A mark is shown only where a check
// was recorded; the glyph goes with the word, so a mark never rests on colour.
/** supported: a check found a source (or passed its tests). contradicted: a check went against it. insufficient: a
 *  check ran and could not settle it. unchecked: nothing checked it. */
export type Mark = "supported" | "contradicted" | "insufficient" | "unchecked"
export const MARKS: readonly Mark[] = ["supported", "contradicted", "insufficient", "unchecked"]
/**
 * The engine's own verdict word as a mark. A team review and an answer say verified, contradicted, unsupported,
 * unchecked; the swarm's notes say supported, refuted, insufficient, untested. A word this page does not know is
 * "unchecked": it never claims a check that it cannot name.
 */
export const markOf = (verdict: unknown): Mark =>
  verdict === "verified" || verdict === "supported" ? "supported"
    : verdict === "contradicted" || verdict === "refuted" ? "contradicted"
      : verdict === "unsupported" || verdict === "insufficient" ? "insufficient" : "unchecked"
export const MARK_WORD: Record<Mark, string> = { supported: "Supported", contradicted: "Contradicted", insufficient: "Insufficient evidence", unchecked: "Not checked" }
export const MARK_GLYPH: Record<Mark, string> = { supported: "✓", contradicted: "✕", insufficient: "?", unchecked: "○" }
/** What each mark means, in one line: the tooltip of a chip and the legend. */
export const MARK_ABOUT: Record<Mark, string> = {
  supported: "A separate check found support for it in a source, or it passed its tests.",
  contradicted: "A separate check found that a source or a test goes against it.",
  insufficient: "It was checked, and the evidence did not settle it.",
  unchecked: "Nothing checked it.",
}
/** "3 supported", "1 contradicted", "2 insufficient evidence", "1 not checked": for counts in a sentence. */
export const markCount = (mark: Mark, n: number): string => `${n} ${MARK_WORD[mark].toLowerCase()}`
/** "9 supported, 2 contradicted, 1 insufficient evidence": the marks that occur, in the fixed order. */
export const markCounts = (counts: Partial<Record<Mark, number>>): string =>
  MARKS.filter((m) => (counts[m] ?? 0) > 0).map((m) => markCount(m, counts[m]!)).join(", ")
/** How many were checked, never "every": "5 of 6 statements checked". */
export const checkedOf = (checked: number, total: number): string => `${checked} of ${total} statement${total === 1 ? "" : "s"} checked`

// ---- money words. Three different things, never mixed: the most a run may spend, a guess, and what was recorded.
const dollars = (usd: number): string => (usd > 0 && usd < 0.01 ? "less than $0.01" : `$${usd.toFixed(2).replace(/\.00$/, "")}`)
/** The most a run may spend: the engine stops it there. "Run limit: $1". */
export const runLimit = (usd: number): string => `Run limit: ${dollars(usd)}`
/** A guess made before the run. Never a promise: always "about". "Estimated: about $0.40". */
export const estimated = (usd: number): string => `Estimated: about ${dollars(usd)}`
/** What the engine recorded as spent. "Spent: $0.31". */
export const spent = (usd: number): string => `Spent: ${dollars(usd)}`

/** The first sentence of a reply, for the "In short" line. Cut by code, never rewritten: it is the member's own words. */
export function inShort(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const end = flat.search(/[.!?](\s|$)/)
  const first = end >= 0 ? flat.slice(0, end + 1) : flat
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
}

/** Only an http(s) address becomes a link; anything else a model or a record supplied stays text. */
export const safeUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  try { const u = new URL(value); return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined } catch { return undefined }
}


/**
 * The line a reply is shown by. Agents are told to start with "In short: <one sentence>"; when a reply does, that
 * sentence is the message and the rest is the full reply. When it does not (older runs, practice runs), the first
 * sentence is used instead, so a message is never empty unless the reply itself is.
 */
export function splitReply(text: string): { short: string; rest: string; marked: boolean } {
  const m = /^\s*(?:\*\*)?in short(?:\*\*)?\s*[:\u2014\u2013-]\s*(?:\*\*)?\s*(.+?)\s*(?:\n|$)/i.exec(text)
  if (m && m[1].trim()) return { short: m[1].replace(/\*\*$/, "").trim(), rest: text.slice(m[0].length).trim(), marked: true }
  const short = inShort(text)
  const flat = text.replace(/\s+/g, " ").trim()
  return { short, rest: flat === short ? "" : text.trim(), marked: false }
}

/** What each board member does, in one plain line. Written from the Purpose section of its file in board/agents/. */
export const BOARD_JOB: Record<string, string> = {
  "lead-scientist": "runs the discussion; does not do the research or decide what is true",
  scout: "looks at the data before any research begins",
  "evidence-verifier": "rechecks every source the scout found, and searches for what it missed",
  proposer: "plans the research and names the claims to test",
  pilot: "tries the analysis on a small part of the data first",
  experimenter: "runs the full analysis and produces the results",
  "methods-auditor": "checks that the right methods were followed",
  critic: "tries to prove the others wrong",
  reviser: "fixes the problems the auditor and the critic found",
  finisher: "makes sure no required result is missing",
  reporter: "writes up what was found, and what was rejected",
}

/** The first sentence, and what follows it. A full stop inside a number or an abbreviation ("1.8x", "e.g. x") does not end it. */
export function leadSentence(text: string): [string, string] {
  const end = /[.!?](?=\s+[A-Z(])/.exec(text)
  return end ? [text.slice(0, end.index + 1), text.slice(end.index + 1).trim()] : [text, ""]
}
