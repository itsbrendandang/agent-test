// The owner's rule: a web search (exa_search) opens every review; then the literature, then the databases; the web
// search again only for what those cannot find. These tests read the instructions a member is really given.
import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

process.env.NO_PAID_CALLS = "1"
const { instructionsFor, loadAgent, loadRoster, searchOrder, SEARCH_TOOLS } = await import("../src/agents.ts")
const { loadBrief } = await import("../src/brief.ts")
const { loadConfig } = await import("../src/config.ts")
const { SEARCH_GUIDANCE } = await import("../src/exa.ts")
const { LITERATURE_GUIDANCE } = await import("../src/literature.ts")

const config = loadConfig()
const brief = loadBrief(join(import.meta.dirname, "../../board/briefs/kras-g12c-hit-to-lead.md"), config.brief.required_sections)
const roster = loadRoster(config)
const at = (text: string, part: string) => { const i = text.indexOf(part); assert.ok(i >= 0, `the text has "${part}"`); return i }

test("the scout's assembled instructions put exa_search first: in its own file, in the order block and before each tool's guidance", () => {
  const scout = roster.find((a) => a.name === "scout")
  assert.ok(scout, "the scout is on the default roster")
  assert.ok(scout.tools.includes("exa_search") && scout.tools.includes("literature_search"), "the scout holds the web search and the literature search")
  const text = instructionsFor(config, scout, brief, roster)
  // The first search tool the scout reads about is the web search, and the first numbered step of its own file is too.
  for (const later of SEARCH_TOOLS.filter((t) => t !== "exa_search" && scout.tools.includes(t)))
    assert.ok(at(text, "`exa_search`") < at(text, `\`${later}\``), `exa_search is named before ${later}`)
  assert.match(scout.prompt, /1\. Open with one `exa_search` \(a web search\) on the main question of the brief\./)
  assert.match(scout.prompt, /2\. Then use `literature_search`/)
  // The order block, built in code from the tools the scout holds.
  const block = text.slice(at(text, "# The order of your searches"), at(text, "# Searching\n"))
  const steps = block.split("\n").filter((l) => /^\d+\. /.test(l))
  assert.match(steps[0], /^1\. First, in every review: one `exa_search` \(a web search\) on the main question of the brief\./)
  assert.match(steps[1], /^2\. Then `literature_search`/)
  assert.match(steps.at(-1) ?? "", /`exa_search` again only for what the other searches cannot find\./)
  assert.match(block, /When a search is refused or fails, say so plainly/)
  assert.match(block, /Never put a source from memory in its place/)
  // The order comes before the guidance of each tool, and the web search's guidance before the literature's.
  assert.ok(at(text, "# The order of your searches") < at(text, "# Searching\n") && at(text, "# Searching\n") < at(text, "# Searching the literature"))
  // The old rule is gone everywhere the scout reads.
  for (const old of [/literature_search` first/, /use it\s+first/i, /several focused searches/]) assert.doesNotMatch(text, old)
  assert.match(LITERATURE_GUIDANCE, /After your\s+opening web search/)
  assert.match(SEARCH_GUIDANCE, /Keep each search focused on one question\./)
})

test("the order follows the tools a member holds: databases after the literature, nothing for a member with one search tool or none", () => {
  const all = searchOrder(["exa_search", "literature_search", "database_search"]).split("\n").filter((l) => /^\d+\. /.test(l))
  assert.deepEqual(all.map((l) => /`(\w+)`/.exec(l)?.[1]), ["exa_search", "literature_search", "database_search", "exa_search"])
  assert.match(all[2], /^3\. Then `database_search` for records: trials, bioactivity, drug labels, targets\./)
  const noWeb = searchOrder(["literature_search", "database_search"])
  assert.ok(!noWeb.includes("exa_search") && /^1\. Then `literature_search`/m.test(noWeb), "a member without the web search is not told to use it")
  assert.equal(searchOrder(["exa_search"]), "")
  assert.equal(searchOrder([]), "")
  assert.equal(searchOrder(["converse", "write_memo"]), "")
  // A member that does not search is given no search text at all.
  const critic = instructionsFor(config, loadAgent(config, "critic"), brief, roster)
  for (const part of ["# The order of your searches", "# Searching", "exa_search", "literature_search", "database_search"]) assert.ok(!critic.includes(part), `the critic's instructions do not have "${part}"`)
})

test("the lead's plan says the web search opens round 1", () => {
  const lead = loadAgent(config, "lead-scientist")
  assert.match(lead.prompt, /Round 1: the Scout opens the review with a web search \(`exa_search`\) on the main question of the\s+brief, then searches the literature/)
})
