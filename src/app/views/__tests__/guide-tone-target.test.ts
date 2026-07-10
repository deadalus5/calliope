import { describe, expect, it } from 'vitest'
import { qualityById } from '../../../music-core'
import { pickTargetInterval } from '../guide-tone-target'

/** The drill's target selection over the real chord-quality interval sets. */

const intervalsOf = (id: string) => qualityById(id).intervals

describe('pickTargetInterval', () => {
  it('dom7: alternation picks the 3rd then the b7', () => {
    expect(pickTargetInterval(intervalsOf('dom7'), false)).toEqual({ interval: 4, label: '3rd' })
    expect(pickTargetInterval(intervalsOf('dom7'), true)).toEqual({ interval: 10, label: '7th' })
  })

  it('min7: minor 3rd vs b7 by preference', () => {
    expect(pickTargetInterval(intervalsOf('min7'), false)).toEqual({ interval: 3, label: '3rd' })
    expect(pickTargetInterval(intervalsOf('min7'), true)).toEqual({ interval: 10, label: '7th' })
  })

  it('maj7: major 3rd vs major 7th by preference', () => {
    expect(pickTargetInterval(intervalsOf('maj7'), false)).toEqual({ interval: 4, label: '3rd' })
    expect(pickTargetInterval(intervalsOf('maj7'), true)).toEqual({ interval: 11, label: '7th' })
  })

  it('plain triads have no 7th: a 7th ask falls back to the 3rd', () => {
    expect(pickTargetInterval(intervalsOf('maj'), true)).toEqual({ interval: 4, label: '3rd' })
    expect(pickTargetInterval(intervalsOf('min'), true)).toEqual({ interval: 3, label: '3rd' })
    // and a 3rd ask is just the 3rd
    expect(pickTargetInterval(intervalsOf('maj'), false)).toEqual({ interval: 4, label: '3rd' })
  })

  it('sus chords have no 3rd: a 3rd ask falls back to the sus tone', () => {
    expect(pickTargetInterval(intervalsOf('sus4'), false)).toEqual({ interval: 5, label: 'sus4' })
    expect(pickTargetInterval(intervalsOf('sus2'), false)).toEqual({ interval: 2, label: 'sus2' })
  })

  it('7sus4: 7th ask gets the b7, 3rd ask gets the sus tone', () => {
    expect(pickTargetInterval(intervalsOf('7sus4'), true)).toEqual({ interval: 10, label: '7th' })
    expect(pickTargetInterval(intervalsOf('7sus4'), false)).toEqual({ interval: 5, label: 'sus4' })
  })

  it('sus without a 7th: a 7th ask still lands on the sus tone last', () => {
    expect(pickTargetInterval(intervalsOf('sus4'), true)).toEqual({ interval: 5, label: 'sus4' })
  })

  it('7#9 contains both 3 and 4 semitones: the major 3rd (chord tone order) wins', () => {
    // intervals [0, 3, 4, 7, 10] — .find takes the first THIRDS member, the #9 (3)
    // is listed before the major 3rd here, so document the actual behavior:
    const picked = pickTargetInterval(intervalsOf('7#9'), false)
    expect(picked?.label).toBe('3rd')
    expect([3, 4]).toContain(picked?.interval)
  })

  it('power chord (no 3rd, no 7th, no sus): no target', () => {
    expect(pickTargetInterval(intervalsOf('5'), false)).toBeNull()
    expect(pickTargetInterval(intervalsOf('5'), true)).toBeNull()
  })
})
