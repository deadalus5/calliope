import { describe, expect, it } from 'vitest'
import { PROGRESSIONS } from '../../music-core'
import { STYLES, styleFor } from '../styles'

describe('STYLES registry', () => {
  it('every entry has an 8-slot hatVel, pockets within ±.009, swing in [0,.6], groove.id === style id', () => {
    for (const [id, spec] of Object.entries(STYLES)) {
      expect(spec.groove.hatVel.length).toBe(8)
      for (const v of Object.values(spec.groove.pocket)) {
        expect(Math.abs(v)).toBeLessThanOrEqual(0.009)
      }
      expect(spec.swing).toBeGreaterThanOrEqual(0)
      expect(spec.swing).toBeLessThanOrEqual(0.6)
      expect(spec.groove.id).toBe(id)
      expect(spec.id).toBe(id)
    }
  })
})

describe('every shipped song styleId resolves in STYLES', () => {
  for (const p of PROGRESSIONS) {
    it(`${p.id}: styleId "${p.styleId}" resolves`, () => {
      expect(p.styleId).toBeDefined()
      expect(STYLES[p.styleId as string]).toBeDefined()
    })
  }
})

describe('styleFor fallback', () => {
  it('falls back to blues-shuffle for shuffle feel when styleId is absent', () => {
    const p = { feel: 'shuffle' as const } as Parameters<typeof styleFor>[0]
    expect(styleFor(p)).toBe(STYLES['blues-shuffle'])
  })

  it('falls back to straight-pop for straight feel when styleId is absent', () => {
    const p = { feel: 'straight' as const } as Parameters<typeof styleFor>[0]
    expect(styleFor(p)).toBe(STYLES['straight-pop'])
  })

  it('resolves the real styleId when present, ignoring feel', () => {
    const p = { feel: 'straight' as const, styleId: 'neo-soul' } as Parameters<typeof styleFor>[0]
    expect(styleFor(p)).toBe(STYLES['neo-soul'])
  })

  it('falls back when styleId is present but unknown', () => {
    const p = { feel: 'shuffle' as const, styleId: 'nonexistent' } as Parameters<typeof styleFor>[0]
    expect(styleFor(p)).toBe(STYLES['blues-shuffle'])
  })

  it('resolves every real song progression to a defined style', () => {
    for (const p of PROGRESSIONS) {
      expect(styleFor(p)).toBeDefined()
    }
  })
})
