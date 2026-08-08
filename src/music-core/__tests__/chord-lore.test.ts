import { describe, expect, it } from 'vitest'
import { QUALITIES, qualityById } from '../chord'
import { FLAVOR_GROUPS, QUALITY_LORE, loreFor } from '../chord-lore'

describe('QUALITY_LORE coverage', () => {
  it('has exactly one entry per QUALITIES entry', () => {
    expect(QUALITY_LORE.length).toBe(QUALITIES.length)
    const loreIds = new Set(QUALITY_LORE.map((l) => l.qualityId))
    expect(loreIds.size).toBe(QUALITY_LORE.length)
    for (const q of QUALITIES) expect(loreIds.has(q.id)).toBe(true)
  })

  it('every field is non-empty', () => {
    for (const l of QUALITY_LORE) {
      expect(l.color.length).toBeGreaterThan(0)
      expect(l.build.length).toBeGreaterThan(0)
      expect(l.pull.length).toBeGreaterThan(0)
      expect(l.uses.length).toBeGreaterThan(0)
      expect(l.nextMoves.length).toBeGreaterThan(0)
      for (const u of l.uses) expect(u.length).toBeGreaterThan(0)
      for (const n of l.nextMoves) expect(n.length).toBeGreaterThan(0)
      expect(l.uses.length).toBeLessThanOrEqual(3)
      expect(l.nextMoves.length).toBeLessThanOrEqual(3)
    }
  })

  it('speaks his language on the anchors', () => {
    expect(loreFor('dom7')!.build).toContain('b7')
    expect(loreFor('7#9')!.uses.join(' ')).toContain('Purple Haze')
    expect(loreFor('add9')!.color).toContain('WITHOUT the b7')
  })
})

describe('loreFor', () => {
  it('returns the matching entry', () => {
    const l = loreFor('dom7')
    expect(l).toBeDefined()
    expect(l!.qualityId).toBe('dom7')
    expect(l).toBe(QUALITY_LORE.find((x) => x.qualityId === 'dom7'))
  })

  it('returns undefined for unknown ids', () => {
    expect(loreFor('nope')).toBeUndefined()
  })
})

describe('FLAVOR_GROUPS', () => {
  it('every id resolves to a real quality', () => {
    for (const g of FLAVOR_GROUPS) {
      for (const id of g.ids) expect(qualityById(id).id).toBe(id)
    }
  })

  it('covers all QUALITIES ids except maj7no5, each exactly once', () => {
    const seen = new Map<string, number>()
    for (const g of FLAVOR_GROUPS) {
      for (const id of g.ids) seen.set(id, (seen.get(id) ?? 0) + 1)
    }
    for (const [id, count] of seen) expect(count, `${id} appears in ${count} groups`).toBe(1)
    const expected = new Set(QUALITIES.map((q) => q.id).filter((id) => id !== 'maj7no5'))
    expect(new Set(seen.keys())).toEqual(expected)
    expect(seen.has('maj7no5')).toBe(false)
  })
})
