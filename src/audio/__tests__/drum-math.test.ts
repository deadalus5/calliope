import { describe, expect, it } from 'vitest'
import { pickLayer, pickRR, type LayerSpec } from '../drum-math'

describe('pickLayer', () => {
  const layers: LayerSpec[] = [{ maxVel: 0.6, rr: [] }, { maxVel: 1, rr: [] }]

  it('picks the first layer below its maxVel', () => {
    expect(pickLayer(layers, 0.1)).toBe(0)
  })

  it('picks the layer whose maxVel exactly matches vel', () => {
    expect(pickLayer(layers, 0.6)).toBe(0)
    expect(pickLayer(layers, 1)).toBe(1)
  })

  it('falls back to the last layer above all maxVel', () => {
    expect(pickLayer(layers, 1.5)).toBe(1)
  })

  it('always picks 0 with a single layer', () => {
    expect(pickLayer([{ maxVel: 1, rr: [] }], 0.01)).toBe(0)
    expect(pickLayer([{ maxVel: 1, rr: [] }], 1)).toBe(0)
  })
})

describe('pickRR', () => {
  it('never returns last, and stays in range, across the full rand sweep for count 2..6', () => {
    const sweep = [0, 0.2, 0.4, 0.6, 0.8, 0.99]
    for (let count = 2; count <= 6; count++) {
      for (let last = 0; last < count; last++) {
        for (const r of sweep) {
          const i = pickRR(count, last, () => r)
          expect(i).not.toBe(last)
          expect(i).toBeGreaterThanOrEqual(0)
          expect(i).toBeLessThan(count)
        }
      }
    }
  })

  it('always returns 0 when count is 1, even if it equals last', () => {
    expect(pickRR(1, 0, () => 0.5)).toBe(0)
    expect(pickRR(1, 0, () => 0)).toBe(0)
    expect(pickRR(1, 0, () => 0.99)).toBe(0)
  })
})
