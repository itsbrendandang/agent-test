// The shared words: the four marks, counts that never claim "every", the three money words, and provenance read
// from a record's own data.
import { describe, expect, it } from "vitest"
import { provenanceOf, PROVENANCE_WORD } from "./provenance"
import { checkedOf, estimated, MARK_GLYPH, MARK_WORD, markCount, markCounts, markOf, MARKS, runLimit, spent } from "./words"

describe("the four marks", () => {
  it("are Supported, Contradicted, Insufficient evidence and Not checked, each with its own glyph", () => {
    expect(MARKS.map((m) => MARK_WORD[m])).toEqual(["Supported", "Contradicted", "Insufficient evidence", "Not checked"])
    expect(MARKS.map((m) => MARK_GLYPH[m])).toEqual(["✓", "✕", "?", "○"])
    expect(new Set(Object.values(MARK_GLYPH)).size).toBe(4) // no two marks share a glyph
  })
  it("map both sets of engine words, and keep 'checked without a result' apart from 'never checked'", () => {
    expect(["verified", "supported"].map(markOf)).toEqual(["supported", "supported"])
    expect(["contradicted", "refuted"].map(markOf)).toEqual(["contradicted", "contradicted"])
    expect(["unsupported", "insufficient"].map(markOf)).toEqual(["insufficient", "insufficient"])
    expect(["unchecked", "untested"].map(markOf)).toEqual(["unchecked", "unchecked"])
  })
  it("never turn a word the page does not know into a check that happened", () => {
    for (const odd of ["", "VERIFIED", "ok", "true", undefined, null, 1, {}]) expect(markOf(odd)).toBe("unchecked")
  })
  it("count in the new words, leaving out what did not occur", () => {
    expect(markCount("supported", 3)).toBe("3 supported")
    expect(markCount("unchecked", 1)).toBe("1 not checked")
    expect(markCounts({ supported: 9, contradicted: 2, insufficient: 0, unchecked: 1 })).toBe("9 supported, 2 contradicted, 1 not checked")
    expect(markCounts({})).toBe("")
  })
  it("say how many were checked, never that every one was", () => {
    expect(checkedOf(5, 6)).toBe("5 of 6 statements checked")
    expect(checkedOf(1, 1)).toBe("1 of 1 statement checked")
    expect(checkedOf(0, 3)).toBe("0 of 3 statements checked")
  })
})

describe("the three money words", () => {
  it("keep the limit, the estimate and what was spent apart", () => {
    expect(runLimit(1)).toBe("Run limit: $1")
    expect(runLimit(0.6)).toBe("Run limit: $0.60")
    expect(estimated(0.4)).toBe("Estimated: about $0.40") // an estimate always says "about"
    expect(spent(0.31)).toBe("Spent: $0.31")
    expect(spent(0)).toBe("Spent: $0")
    expect(spent(0.004)).toBe("Spent: less than $0.01")
  })
})

describe("provenance comes from the record itself", () => {
  it("reads an answer's mode, a swarm run's model and a review's own flag", () => {
    expect(provenanceOf({ mode: "demo" })).toBe("practice")
    expect(provenanceOf({ mode: "real" })).toBe("live")
    expect(provenanceOf({ model: "mock" })).toBe("practice")
    expect(provenanceOf({ model: "anthropic/claude-sonnet-5-5" })).toBe("live")
    expect(provenanceOf({ model: "ollama/qwen2.5:14b" })).toBe("local")
    expect(provenanceOf({ scripted: true })).toBe("practice")
    expect(provenanceOf({ scripted: false })).toBe("live")
  })
  it("a look-alike of a local model id is not called local", () => {
    for (const id of ["ollama/../openai/gpt-5.5", "openai/ollama", "ollama/", "xollama/qwen"]) expect(provenanceOf({ model: id })).toBe("live")
  })
  it("claims nothing while the record has not said", () => {
    for (const none of [undefined, {}, { mode: undefined }, { model: "" }, { scripted: undefined }]) expect(provenanceOf(none)).toBeUndefined()
  })
  it("has one word per kind", () => {
    expect(PROVENANCE_WORD).toEqual({ practice: "Practice", live: "Live research", local: "Local model" })
  })
})
