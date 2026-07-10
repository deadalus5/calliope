import { describe, expect, it } from 'vitest'
import { normalizePc } from '../note'
import { chord, chordPcs } from '../chord'
import { coordToMidi, coordToPc } from '../fretboard-geometry'
import { allTriadGrips, triadGrips, type StringSet } from '../voicing'
import { modeDegrees, modeById, PENTATONIC_DEGREES } from '../scale'

describe('triad grips', () => {
  it('C major on D-G-B: the open-position grip is root position (C-E-G)', () => {
    const grips = triadGrips(chord('C', 'maj'), 2)
    // Lowest grip: D string 10? No — frets: D0=D not chord tone... first is
    // D2(E)-G0(G)-B1(C) = 1st inversion at the bottom of the neck.
    const first = grips[0]
    expect(first.pcs.every((pc) => chordPcs(chord('C', 'maj')).includes(pc))).toBe(true)
    expect(first.coords.map((c) => c.fret)).toEqual([2, 0, 1])
    expect(first.inversion).toBe(1)
  })

  it('grips are close-voiced and ascending', () => {
    for (const set of [0, 1, 2, 3] as StringSet[]) {
      for (const g of triadGrips(chord('A', 'maj'), set)) {
        const midis = g.coords.map(coordToMidi)
        expect(midis[0]).toBeLessThan(midis[1])
        expect(midis[1]).toBeLessThan(midis[2])
        expect(midis[2] - midis[0]).toBeLessThan(12) // close position
      }
    }
  })

  it('every string set yields all three inversions of D major', () => {
    for (const set of [0, 1, 2, 3] as StringSet[]) {
      const grips = triadGrips(chord('D', 'maj'), set)
      const inversions = new Set(grips.map((g) => g.inversion))
      expect(inversions).toEqual(new Set([0, 1, 2]))
    }
  })

  it('minor and diminished triads produce valid grips too', () => {
    expect(allTriadGrips(chord('A', 'min')).length).toBeGreaterThan(8)
    expect(allTriadGrips(chord('B', 'dim')).length).toBeGreaterThan(8)
    for (const g of allTriadGrips(chord('A', 'min'))) {
      for (const c of g.coords) {
        expect(chordPcs(chord('A', 'min')).map(normalizePc)).toContain(coordToPc(c))
      }
    }
  })
})

describe('modes as skeleton + colors', () => {
  it('every mode has 7 notes: 5 skeleton + 2 colors', () => {
    for (const id of ['dorian', 'mixolydian', 'aeolian', 'ionian', 'lydian', 'phrygian']) {
      const m = modeById(id)
      expect(modeDegrees(m).length).toBe(7)
      expect(m.colors.length).toBe(2)
      for (const c of m.colors) {
        expect(PENTATONIC_DEGREES[m.skeleton]).not.toContain(c)
      }
    }
  })

  it('mixolydian = major pentatonic + 4 + b7', () => {
    expect(modeDegrees(modeById('mixolydian'))).toEqual([0, 2, 4, 5, 7, 9, 10])
  })

  it('dorian = minor pentatonic + 2 + 6', () => {
    expect(modeDegrees(modeById('dorian'))).toEqual([0, 2, 3, 5, 7, 9, 10])
  })

  it('modes agree with their classical definitions', () => {
    expect(modeDegrees(modeById('ionian'))).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect(modeDegrees(modeById('aeolian'))).toEqual([0, 2, 3, 5, 7, 8, 10])
    expect(modeDegrees(modeById('lydian'))).toEqual([0, 2, 4, 6, 7, 9, 11])
    expect(modeDegrees(modeById('phrygian'))).toEqual([0, 1, 3, 5, 7, 8, 10])
  })
})
