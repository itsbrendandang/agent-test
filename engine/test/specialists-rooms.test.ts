import assert from "node:assert/strict"
import { test } from "node:test"
import { loadSpecialists, specialistRoom, specialistPlacement, asAgent, rosterEntries } from "../src/specialists.ts"

test("every real specialist has a capability-based room, including clear domain profiles", () => {
  const all = loadSpecialists()
  assert.equal(all.length, 27)
  for (const s of all) {
    const placed = specialistPlacement(s)
    assert.ok(["library", "data", "quality", "bench", "review", "planning", "report", "specialists"].includes(placed.room))
    assert.equal(specialistRoom({ ...s, name: "misleading-name", title: "Misleading title" }), placed.room)
  }
  for (const [name, room] of Object.entries({ "bulk-rnaseq-analyst": "data", toxicologist: "quality", "literature-evidence-synthesist": "library", chief: "planning", contrarian: "review" })) {
    assert.equal(specialistRoom(all.find((s) => s.name === name)!), room, name)
  }
  const s = all.find((s) => s.name === "toxicologist")!
  const agent = asAgent(s, [], "Safety")
  assert.equal(rosterEntries(agent, [])[0].room, "quality")
})

test("empty capabilities use the lounge, and names or withheld counts do not supply skills", () => {
  const s = loadSpecialists()[0]
  const empty = { ...s, name: "rna-seq", title: "RNA-seq", methods: [], role: [], routes: [], trigger: "", deliverable: "", does: "", nameOnly: 100 }
  assert.deepEqual(specialistPlacement(empty), { room: "specialists", signals: [] })
  assert.equal(specialistRoom({ ...empty, routes: [{ text: "RNA-seq", methods: [999] }] }), "specialists")
})
