import { describe, expect, it } from 'vitest'
import { gaussian, hashSeed, mulberry32 } from '../rng'

describe('mulberry32', () => {
  it('is deterministic and pinned for a fixed seed', () => {
    const rng = mulberry32(12345)
    const draws = Array.from({ length: 5 }, () => rng())
    // Pinned once from the actual implementation output.
    expect(draws).toEqual([
      0.9797282677609473,
      0.3067522644996643,
      0.484205421525985,
      0.817934412509203,
      0.5094283693470061,
    ])
  })

  it('produces values in [0,1) and a different stream for a different seed', () => {
    const rngA = mulberry32(1)
    const rngB = mulberry32(2)
    const a = Array.from({ length: 20 }, () => rngA())
    const b = Array.from({ length: 20 }, () => rngB())
    for (const v of [...a, ...b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(a).not.toEqual(b)
  })

  it('same seed reproduces the same stream', () => {
    const a = mulberry32(999)
    const b = mulberry32(999)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).toEqual(seqB)
  })
})

describe('hashSeed', () => {
  it('is stable for the same parts', () => {
    expect(hashSeed('blues-12-standard', 0)).toBe(hashSeed('blues-12-standard', 0))
  })

  it('is distinct for different parts, including pass number', () => {
    const a = hashSeed('x', 0)
    const b = hashSeed('x', 1)
    expect(a).not.toBe(b)
  })

  it('returns a uint32', () => {
    const h = hashSeed('anything', 'goes', 42)
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('gaussian', () => {
  it('has mean near 0 and roughly 68% of draws within 1 sigma', () => {
    const rng = mulberry32(42)
    const sigma = 1
    const n = 1000
    const draws = Array.from({ length: n }, () => gaussian(rng, sigma))
    const mean = draws.reduce((s, v) => s + v, 0) / n
    expect(Math.abs(mean)).toBeLessThan(0.3 * sigma)
    const within1Sigma = draws.filter((v) => Math.abs(v) <= sigma).length / n
    expect(within1Sigma).toBeGreaterThan(0.55)
    expect(within1Sigma).toBeLessThan(0.8)
  })

  it('never throws on an unlucky 0 draw (Math.log(0) guard)', () => {
    let calls = 0
    const rng = () => (calls++ === 0 ? 0 : 0.5) // first draw is exactly 0
    expect(() => gaussian(rng, 1)).not.toThrow()
  })
})
