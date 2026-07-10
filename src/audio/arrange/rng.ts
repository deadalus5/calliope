/**
 * Deterministic randomness for the arrangement layer. Every arranger takes
 * an `rng: () => number` and nothing else touches Math.random — this is
 * what makes "same seed => identical arrangement" possible, which the
 * sequencer relies on to re-bake a pass without audible drift.
 */

/** Deterministic PRNG in [0,1). Standard mulberry32. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function rng(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a hash of the joined parts — stable seed from (progressionId, pass, ...). */
export function hashSeed(...parts: Array<string | number>): number {
  const str = parts.join(':')
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Gaussian via Box-Muller, mean 0, given the sigma; consumes 2 rng draws. */
export function gaussian(rng: () => number, sigma: number): number {
  let u = 0
  let v = 0
  // rng() is [0,1) so u could land on exactly 0 — guard Math.log(0).
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return z * sigma
}
