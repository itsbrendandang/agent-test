// The characters a Buddy can be, and which one a name gets. Kept apart from Buddy.tsx so that file exports only components.
export const SPECIES = ["bunny", "flame", "egg", "mountain", "sprout"] as const
export type Species = (typeof SPECIES)[number]
export type Mood = "happy" | "working" | "sleeping" | "alert"

export function speciesFor(seed: string): Species {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SPECIES[h % SPECIES.length]
}
