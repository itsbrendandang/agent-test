// The scoreboard's statistics against values worked out by hand (the arithmetic is in the comments).
import assert from "node:assert/strict"
import { test } from "node:test"
import { compare, conclude } from "../src/bixv1/scoreboard.ts"
import { choose, mcnemarExact, MIN_DISCORDANT, newcombePaired, smallestP, wilson } from "../src/bixv1/stats.ts"

const near = (actual: number, expected: number, tolerance = 5e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)
const nearPair = (actual: [number, number] | null, expected: [number, number]) => { assert.ok(actual); near(actual[0], expected[0]); near(actual[1], expected[1]) }

test("Wilson interval", () => {
  // 4/8, z = 1.96: z^2/n = 0.48018; centre = (0.5 + 0.24009) / 1.48018 = 0.5;
  // spread = 1.96 * sqrt(0.25/8 + 3.8415/256) / 1.48018 = 1.96 * 0.21507 / 1.48018 = 0.28479.
  nearPair(wilson(4, 8), [0.2152, 0.7848])
  // 0/8: centre = 0.24009 / 1.48018 = 0.16220 = spread, so the interval is 0 to 0.32440.
  nearPair(wilson(0, 8), [0, 0.3244])
  // 5/8: centre = (0.625 + 0.24009) / 1.48018 = 0.58445; spread = 1.96 * sqrt(0.029297 + 0.015006) / 1.48018 = 0.27871.
  nearPair(wilson(5, 8), [0.30574, 0.86316])
  // The values the adapter's own report prints for the pilot run (0/3, 2/3, 2/2).
  nearPair(wilson(0, 3), [0, 0.5615]); nearPair(wilson(2, 3), [0.2077, 0.9385]); nearPair(wilson(2, 2), [0.3424, 1])
  assert.equal(wilson(0, 0), null)
})

test("exact McNemar p-value from the discordant pairs", () => {
  assert.equal(mcnemarExact(0, 0), null, "no discordant pair: nothing to test")
  assert.equal(mcnemarExact(0, 1), 1) // 2 * 1/2
  assert.equal(mcnemarExact(1, 1), 1)
  assert.equal(mcnemarExact(0, 5), 0.0625) // 2 * 1/32
  assert.equal(mcnemarExact(5, 0), 0.0625, "the same whichever side wins")
  assert.equal(mcnemarExact(0, 6), 0.03125) // 2 * 1/64
  assert.equal(mcnemarExact(1, 5), 0.21875) // 2 * (1 + 6)/64
  assert.equal(mcnemarExact(2, 2), 1) // 2 * (1 + 4 + 6)/16 = 1.375, capped at 1
  assert.equal(mcnemarExact(1, 9), 0.021484375) // 2 * (1 + 10)/1024
  near(mcnemarExact(3, 10)!, 756 / 8192, 1e-9) // 2 * (1 + 13 + 78 + 286)/8192 = 0.092285
  assert.equal(choose(13, 3), 286n); assert.equal(choose(5, 0), 1n); assert.equal(choose(5, 6), 0n)
  // 200 discordant pairs split evenly: no overflow, p = 1.
  assert.equal(mcnemarExact(100, 100), 1)
  near(mcnemarExact(0, 60)!, 0, 1e-12)
})

test("fewer than 6 discordant pairs can never reach p < 0.05", () => {
  assert.equal(MIN_DISCORDANT, 6)
  for (let k = 1; k <= 12; k++) {
    assert.equal(mcnemarExact(0, k), smallestP(k))
    assert.equal(smallestP(k) < 0.05, k >= MIN_DISCORDANT)
  }
})

test("Newcombe paired interval: 4/8 against 4/8 on the same questions", () => {
  // both = 4, neither = 4. Each accuracy 0.5 with Wilson 0.2152 to 0.7848, so each half-width is 0.28479.
  // phi: (4*4 - 0*0) = 16 > n/2 = 4, so 16 - 4 = 12; margins 4*4*4*4 = 256; phi = 12/16 = 0.75.
  // half-width of the difference = sqrt(w^2 - 2*0.75*w*w + w^2) = w * sqrt(0.5) = 0.20138.
  nearPair(newcombePaired({ both: 4, onlySingle: 0, onlySwarm: 0, neither: 4 }), [-0.2014, 0.2014])
})

test("Newcombe paired interval: discordant cases", () => {
  // Swarm right on 5 of 8, single on none. A margin is 0, so phi = 0.
  // Wilson: swarm 0.30574 to 0.86316, single 0 to 0.32440. difference 0.625.
  // lower = 0.625 - sqrt((0.625 - 0.30574)^2 + (0.32440 - 0)^2) = 0.625 - sqrt(0.10192 + 0.10524) = 0.16985
  // upper = 0.625 + sqrt((0 - 0)^2 + (0.86316 - 0.625)^2) = 0.86316
  nearPair(newcombePaired({ both: 0, onlySingle: 0, onlySwarm: 5, neither: 3 }), [0.16985, 0.86316])
  // Each right on the 4 the other got wrong: both 0.5, cross = 0 - 16 = -16 (kept as is), phi = -16/16 = -1.
  // half-width = sqrt(w^2 + 2*w*w + w^2) = 2w = 0.56958.
  nearPair(newcombePaired({ both: 0, onlySingle: 4, onlySwarm: 4, neither: 0 }), [-0.56958, 0.56958])
  // 1 both, 1 swarm only, 1 neither (n = 3): swarm 2/3 (0.2077 to 0.9385), single 1/3 (0.0615 to 0.7923).
  // cross = 1*1 - 1*0 = 1, between 0 and n/2 = 1.5, so phi = 0.
  // lower = 0.3333 - sqrt(0.4590^2 + 0.4590^2) = -0.3158; upper = 0.3333 + sqrt(0.2718^2 + 0.2718^2) = 0.7177
  nearPair(newcombePaired({ both: 1, onlySingle: 0, onlySwarm: 1, neither: 1 }), [-0.3158, 0.7177])
})

test("Newcombe paired interval: symmetry and bounds", () => {
  const tables = [[3, 1, 4, 2], [0, 0, 10, 0], [7, 2, 0, 1], [10, 3, 9, 20], [0, 0, 0, 5], [1, 0, 0, 0]]
  for (const [both, onlySingle, onlySwarm, neither] of tables) {
    const [low, high] = newcombePaired({ both, onlySingle, onlySwarm, neither })!
    const [mirrorLow, mirrorHigh] = newcombePaired({ both, onlySingle: onlySwarm, onlySwarm: onlySingle, neither })!
    near(mirrorLow, -high, 1e-12); near(mirrorHigh, -low, 1e-12) // swapping the solvers flips the sign
    const diff = (onlySwarm - onlySingle) / (both + onlySingle + onlySwarm + neither)
    assert.ok(-1 <= low && low <= diff + 1e-12 && diff <= high + 1e-12 && high <= 1, `${low} <= ${diff} <= ${high}`)
    assert.ok(high - low > 0, "never zero width, also without discordant pairs")
  }
  assert.equal(newcombePaired({ both: 0, onlySingle: 0, onlySwarm: 0, neither: 0 }), null)
})

const flags = (text: string) => new Map([...text].map((c, i) => [`q${i}`, c === "1"]))

test("the paired table, and what may be concluded from it", () => {
  const capsules = new Map([..."01234567"].map((c, i) => [`q${i}`, `capsule-${i < 4 ? "a" : i < 6 ? "b" : "c"}`]))
  const same = compare(flags("11110000"), flags("11110000"), capsules)!
  assert.deepEqual([same.n, same.capsules, same.bothCorrect, same.onlySingle, same.onlySwarm, same.neither], [8, 3, 4, 0, 0, 4])
  assert.deepEqual([same.accuracySingle, same.accuracySwarm, same.difference, same.pValue], [0.5, 0.5, 0, null])
  assert.deepEqual(same.interval95, [-0.2014, 0.2014])
  assert.match(same.intervalMethod, /Newcombe/); assert.match(same.pValueMethod, /McNemar/)
  const verdict = conclude(same)
  assert.equal(verdict.tooSmall, true)
  assert.match(verdict.conclusion, /^Too few questions to conclude anything\. The solvers gave the same result on all 8 questions/)
  assert.match(verdict.conclusion, /from -20\.1 to \+20\.1 percentage points/)
  assert.match(verdict.conclusion, /8 questions come from 3 capsules/)

  // Swarm alone right on 5: p = 0.0625, still too small.
  const five = compare(flags("00000111"), flags("11111111"), capsules)!
  assert.deepEqual([five.onlySwarm, five.onlySingle, five.pValue, five.difference], [5, 0, 0.0625, 0.625])
  assert.equal(conclude(five).tooSmall, true)
  assert.match(conclude(five).conclusion, /differed on only 5 of 8 questions/)

  // Six one way: p = 0.03125.
  const six = compare(flags("00000011"), flags("11111111"), capsules)!
  assert.equal(six.pValue, 0.03125)
  assert.equal(conclude(six).tooSmall, false)
  assert.match(conclude(six).conclusion, /^The swarm was correct more often \(\+75 percentage points, exact p = 0\.03125\)/)
  assert.match(conclude(compare(flags("11111111"), flags("00000011"), capsules)!).conclusion, /^The single agent was correct more often \(-75 /)

  // Six discordant, split 3 and 3: enough questions, no difference found, and it says that is not equality.
  const split = compare(flags("11100011"), flags("00011111"), capsules)!
  assert.deepEqual([split.onlySingle, split.onlySwarm, split.pValue], [3, 3, 1])
  assert.equal(conclude(split).tooSmall, false)
  assert.match(conclude(split).conclusion, /^No difference detected .* not evidence that the solvers are equal/)

  // Only questions both sides have are compared; none shared means no comparison.
  assert.equal(compare(new Map([["a", true], ["b", true]]), new Map([["b", false], ["c", true]]), new Map())!.n, 1)
  assert.equal(compare(new Map([["a", true]]), new Map([["c", true]]), new Map()), undefined)
})
