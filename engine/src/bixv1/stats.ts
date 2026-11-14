// Statistics for the BixBench v1 scoreboard. Pure functions, no library, small n in mind.
//
// Two solvers answer the same n questions, each answer right or wrong. The paired table is
//   both      both right            onlySwarm  swarm right, single wrong
//   onlySingle single right, swarm wrong        neither    both wrong
// and only the two "only" cells (the discordant pairs) say anything about which solver is better.
//
//   p-value   exact McNemar test = two-sided exact sign test on the discordant pairs: under "no difference"
//             each discordant pair favours either solver with probability 1/2, so
//             p = min(1, 2 * P(Binomial(k, 1/2) <= min(onlySingle, onlySwarm))), k = onlySingle + onlySwarm.
//             No normal approximation, so it is valid at any n. With k discordant pairs the smallest p
//             possible is 2 / 2^k: below 6 discordant pairs p cannot go under 0.05 whatever happened.
//   interval  Newcombe's score interval for a difference of paired proportions (Newcombe 1998, Statistics in
//             Medicine 17:2635, method 10): the Wilson score interval of each accuracy, combined with the
//             correlation (phi) of the paired table. Unlike the Wald interval it does not collapse to zero
//             width when there are no discordant pairs, and it stays inside [-1, 1].
//   accuracy  Wilson score interval (the adapter and the official harness use the same).
//
// What none of these do: questions of one capsule share data and are not independent, so all three are
// somewhat too confident when capsules have several questions. The adapter's report.json carries a bootstrap
// over capsules for that; the scoreboard passes it on when it describes the same pair.

export const Z95 = 1.959963984540054

/** Wilson score interval for correct/n. null when n is 0. */
export function wilson(correct: number, n: number, z = Z95): [number, number] | null {
  if (n <= 0) return null
  const p = correct / n
  const denominator = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denominator
  const spread = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)]
}

/** n choose k as an exact integer (BigInt), so large n cannot lose precision. */
export function choose(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n
  let out = 1n
  for (let i = 1; i <= Math.min(k, n - k); i++) out = (out * BigInt(n - i + 1)) / BigInt(i)
  return out
}

/** Two-sided exact McNemar (sign test) p-value from the discordant counts. null when there are none. */
export function mcnemarExact(onlyA: number, onlyB: number): number | null {
  const k = onlyA + onlyB
  if (k === 0) return null
  let tail = 0n
  for (let i = 0; i <= Math.min(onlyA, onlyB); i++) tail += choose(k, i)
  // 2 * tail / 2^k, in integers until the last step; 12 decimal digits are kept.
  const scaled = (2n * tail * 10n ** 12n) / 2n ** BigInt(k)
  return Math.min(1, Number(scaled) / 1e12)
}

/** The smallest two-sided p-value `k` discordant pairs can give (all of them one way). 1 when k is 0. */
export const smallestP = (k: number) => (k <= 0 ? 1 : Math.min(1, 2 / 2 ** k))
/** Fewest discordant pairs with which the exact test can reach p < 0.05. */
export const MIN_DISCORDANT = 6

export interface PairedTable { both: number; onlySingle: number; onlySwarm: number; neither: number }

/**
 * Newcombe's paired score interval (method 10) for accuracy(swarm) - accuracy(single). null when the table is
 * empty. The Wilson intervals are without continuity correction; phi is continuity-corrected as in the paper.
 */
export function newcombePaired(t: PairedTable, z = Z95): [number, number] | null {
  const { both: a, onlySwarm: b, onlySingle: c, neither: d } = t
  const n = a + b + c + d
  if (n <= 0) return null
  const p1 = (a + b) / n, p2 = (a + c) / n // swarm, single
  const [l1, u1] = wilson(a + b, n, z)!, [l2, u2] = wilson(a + c, n, z)!
  // Correlation of the two solvers' outcomes. 0 when either solver got everything or nothing right.
  const margins = (a + b) * (c + d) * (a + c) * (b + d)
  let phi = 0
  if (margins > 0) {
    let cross = a * d - b * c
    if (cross > n / 2) cross -= n / 2
    else if (cross >= 0) cross = 0
    phi = cross / Math.sqrt(margins)
  }
  const diff = p1 - p2
  const root = (x: number, y: number) => Math.sqrt(Math.max(0, x * x - 2 * phi * x * y + y * y))
  return [Math.max(-1, diff - root(p1 - l1, u2 - p2)), Math.min(1, diff + root(p2 - l2, u1 - p1))]
}
