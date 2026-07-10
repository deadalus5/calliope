import { describe, expect, it } from 'vitest'
import { cellWeakness, freshCell, sampleCell, updateCell } from '../skill-model'

const NOW = 1_750_000_000_000

describe('skill model', () => {
  it('accuracy EWMA moves toward results', () => {
    let c = freshCell('find', 3, 9)
    for (let i = 0; i < 10; i++) c = updateCell(c, true, 1500, NOW + i)
    expect(c.ewmaAcc).toBeGreaterThan(0.85)
    for (let i = 0; i < 10; i++) c = updateCell(c, false, 0, NOW + 100 + i)
    expect(c.ewmaAcc).toBeLessThan(0.35)
  })

  it('misses do not corrupt the latency estimate', () => {
    let c = freshCell('find', 3, 9)
    c = updateCell(c, true, 1000, NOW)
    const lat = c.ewmaLatMs
    c = updateCell(c, false, 9999, NOW + 1)
    expect(c.ewmaLatMs).toBe(lat)
  })

  it('weak cells outweigh strong cells', () => {
    let strong = freshCell('find', 0, 9)
    let weak = freshCell('find', 8, 9)
    for (let i = 0; i < 12; i++) {
      strong = updateCell(strong, true, 900, NOW)
      weak = updateCell(weak, false, 0, NOW)
    }
    expect(cellWeakness(weak, NOW)).toBeGreaterThan(cellWeakness(strong, NOW) + 0.5)
  })

  it('sampling favors the weak cell heavily', () => {
    let strong = freshCell('find', 0, 9)
    let weak = freshCell('find', 8, 9)
    for (let i = 0; i < 12; i++) {
      strong = updateCell(strong, true, 900, NOW)
      weak = updateCell(weak, false, 0, NOW)
    }
    let seq = 0
    const rand = () => { seq = (seq + 0.618034) % 1; return seq } // deterministic spread
    let weakPicks = 0
    for (let i = 0; i < 200; i++) {
      if (sampleCell([strong, weak], NOW, 0.35, rand) === weak) weakPicks++
    }
    expect(weakPicks).toBeGreaterThan(140)
  })

  it('unseen cells get a novelty nudge', () => {
    const unseen = freshCell('find', 5, 4)
    let seen = freshCell('find', 7, 4)
    seen = updateCell(seen, true, 2000, NOW)
    expect(cellWeakness(unseen, NOW)).toBeGreaterThan(cellWeakness(seen, NOW))
  })
})
