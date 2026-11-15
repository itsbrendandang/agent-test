// A round's claims are checked for all members at the same time (checkRound), not one member after another.
// Scripted checkers only: nothing here reaches a network.
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkRound, type ClaimDeps } from "../src/board/board.ts"
import type { Claim } from "../src/board/claims.ts"

const claim = (text: string): Claim => ({ kind: "brief", text, source: "brief" })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Checkers that take `ms` each and record how many were at work at once. */
function deps(ms: number, failFor?: string) {
  const seen = { inFlight: 0, most: 0, calls: 0, saves: 0 }
  const d: ClaimDeps = {
    state: { ledger: [], escalations: 0, checkerUsd: 0 },
    maxEscalations: 12,
    firstPass: async (member, claims) => {
      seen.calls++; seen.inFlight++; seen.most = Math.max(seen.most, seen.inFlight)
      // The first member answers last, so completion order is the reverse of the roster's.
      await sleep(member === "scout" ? ms * 2 : ms)
      seen.inFlight--
      if (member === failFor) throw new Error("checker down")
      return claims.map(() => ({ verdict: "verified" as const, quote: "q", quoteFound: true }))
    },
    computedCheck: async () => ({ verdict: "verified", note: "", usd: 0 }),
    literatureCheck: async () => ({ verdict: "verified", note: "", usd: 0 }),
    evidenceFor: () => "the brief",
    save: () => { seen.saves++ },
    emit: () => {},
  }
  return { d, seen }
}

const members = ["scout", "proposer", "pilot", "experimenter", "critic"]
const replies = () => members.map((member) => ({ member, claims: [claim(`${member} says one`), claim(`${member} says two`)] }))

test("a round's members are checked at the same time, and the round takes about one check, not one per member", async () => {
  const { d, seen } = deps(60)
  const started = Date.now()
  const verdicts = await checkRound(d, 1, replies())
  const took = Date.now() - started
  assert.equal(seen.calls, members.length, "one first-pass call per member (its claims share a source)")
  assert.equal(seen.most, members.length, `checks at work at once: ${seen.most}`)
  assert.ok(took < 60 * members.length, `took ${took} ms; one after another is at least ${60 * (members.length + 1)} ms`)
  // Each member gets its own verdict lines, in the order of the replies.
  assert.deepEqual(verdicts.map((v) => v.length), members.map(() => 2))
  assert.deepEqual(verdicts[2], ["[verified] pilot says one", "[verified] pilot says two"])
})

test("the ledger reads in roster order whichever check answered first, and earlier rounds are left as they were", async () => {
  const { d } = deps(10)
  await checkRound(d, 1, replies())
  assert.deepEqual(d.state.ledger.map((r) => r.member), members.flatMap((m) => [m, m]), "scout answered last but is listed first")
  assert.deepEqual(d.state.ledger.filter((r) => r.member === "critic").map((r) => r.claim), ["critic says one", "critic says two"])
  const roundOne = d.state.ledger.map((r) => r.key)
  await checkRound(d, 2, [...replies()].reverse().map((r) => ({ member: r.member, claims: [claim(`${r.member} round two`)] })))
  assert.deepEqual(d.state.ledger.slice(0, roundOne.length).map((r) => r.key), roundOne)
  assert.deepEqual(d.state.ledger.slice(roundOne.length).map((r) => r.member), [...members].reverse(), "round two is in the order of its own replies")
})

test("when one member's check fails, the others' rulings are saved before the error is passed on", async () => {
  const { d, seen } = deps(10, "pilot")
  await assert.rejects(checkRound(d, 1, replies()), /checker down/)
  assert.equal(seen.inFlight, 0, "no check is still at work after the error")
  assert.deepEqual([...new Set(d.state.ledger.map((r) => r.member))], members.filter((m) => m !== "pilot"))
  // The replay checks only the member that failed.
  const again = deps(10)
  again.d.state.ledger.push(...d.state.ledger)
  await checkRound(again.d, 1, replies())
  assert.equal(again.seen.calls, 1)
  assert.equal(again.d.state.ledger.length, members.length * 2)
})
