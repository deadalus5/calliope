import { describe, expect, it } from 'vitest'
import { PC, parsePcName, pcName } from '../note'
import { chord, chordPcs, chordSymbol, identifyChord, parseChordSymbol } from '../chord'
import { buildTimeline } from '../progression'
import { PROGRESSIONS, progressionById } from '../songs'

describe('note names', () => {
  it('parses and prints names', () => {
    expect(parsePcName('C#')).toBe(PC.Cs)
    expect(parsePcName('Bb')).toBe(PC.As)
    expect(parsePcName('F')).toBe(PC.F)
    expect(pcName(PC.Fs, PC.G)).toBe('F#')
    expect(pcName(PC.As, PC.F)).toBe('Bb')
  })
})

describe('chord parsing and spelling', () => {
  it('round-trips common symbols', () => {
    for (const sym of ['A7', 'Am7', 'Cmaj7', 'D/F#', 'F#m7b5', 'B13', 'E7#9', 'Gsus4', 'C/E', 'Dm9']) {
      const c = parseChordSymbol(sym)
      expect(chordSymbol(c, c.root)).toBe(sym)
    }
  })

  it('spells chord tones', () => {
    expect(chordPcs(chord('A', 'dom7'))).toEqual([PC.A, PC.Cs, PC.E, PC.G])
    expect(chordPcs(chord('C', 'maj7'))).toEqual([PC.C, PC.E, PC.G, PC.B])
    expect(chordPcs(chord('D', 'min7'))).toEqual([PC.D, PC.F, PC.A, PC.C])
  })

  it('slash chords keep an independent bass', () => {
    const c = parseChordSymbol('D/F#')
    expect(c.root).toBe(PC.D)
    expect(c.bass).toBe(PC.Fs)
  })

  it('drops redundant slash bass equal to root', () => {
    const c = chord('C', 'maj', 'C')
    expect(c.bass).toBeUndefined()
  })
})

describe('identifyChord (upper-structure explorer)', () => {
  it('names Em triad over C as Cmaj7', () => {
    const ids = identifyChord(chordPcs(chord('E', 'min')), PC.C)
    expect(ids[0].symbol).toBe('Cmaj7')
  })

  it('names G triad over E as Em7', () => {
    const ids = identifyChord(chordPcs(chord('G', 'maj')), PC.E)
    expect(ids[0].symbol).toBe('Em7')
  })

  it('names Bdim over G as G7 (rootless dominant idea)', () => {
    const ids = identifyChord(chordPcs(chord('B', 'dim')), PC.G)
    expect(ids[0].symbol).toBe('G7')
  })

  it('recognizes inversions: D triad over C is D7 in third inversion', () => {
    const ids = identifyChord(chordPcs(chord('D', 'maj')), PC.C)
    // {C,D,F#,A} is exactly D7; no C-root quality matches, so D7/C wins.
    expect(ids[0].symbol).toBe('D7/C')
  })
})

describe('progressions', () => {
  it('all shipped progressions parse and build timelines in any key', () => {
    for (const p of PROGRESSIONS) {
      for (const key of [PC.C, PC.E, PC.A, PC.As]) {
        const tl = buildTimeline(p, key)
        expect(tl.length).toBe(p.steps.length)
        for (const ev of tl) expect(ev.durationBeats).toBeGreaterThan(0)
      }
    }
  })

  it('12-bar blues transposes correctly to E', () => {
    const tl = buildTimeline(progressionById('blues-12-standard'), PC.E)
    expect(tl[0].symbol).toBe('E7')
    expect(tl[1].symbol).toBe('A7')
    expect(tl[3].symbol).toBe('B7')
  })

  it('slash chords transpose both root and bass', () => {
    const tl = buildTimeline(progressionById('gravity'), PC.A)
    expect(tl[1].symbol).toBe('D/A')
  })
})
