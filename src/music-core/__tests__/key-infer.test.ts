import { describe, expect, it } from 'vitest'
import { parseChordSymbol } from '../chord'
import { inferKey, inferSectionKeys, parseTonality, type WeightedChord } from '../key-infer'
import { PC } from '../note'

function wc(symbol: string, weightBeats = 4, flags?: { start?: boolean; end?: boolean }): WeightedChord {
  return {
    chord: parseChordSymbol(symbol),
    weightBeats,
    sectionStart: flags?.start,
    sectionEnd: flags?.end,
  }
}

describe('parseTonality', () => {
  it('parses majors, minors, and applies capo to concert pitch', () => {
    expect(parseTonality('Am')).toEqual({ root: PC.A, minor: true })
    expect(parseTonality('Bb')).toEqual({ root: PC.As, minor: false })
    expect(parseTonality('F#m')).toEqual({ root: PC.Fs, minor: true })
    expect(parseTonality('Am', 2)).toEqual({ root: PC.B, minor: true })
    expect(parseTonality('???')).toBeNull()
  })
})

describe('inferKey', () => {
  it('hears a I–bVII–IV vamp as mixolydian, not ionian', () => {
    // A G D — the Franklin's Tower changes.
    const r = inferKey({ chords: [wc('A', 8, { start: true, end: true }), wc('G', 4), wc('D', 4)] })
    expect(r.root).toBe(PC.A)
    expect(r.modeId).toBe('mixolydian')
    expect(r.skeleton).toBe('major')
  })

  it('hears minor with a natural 6 (i–IV) as dorian', () => {
    // Am7 D — Oye Como Va.
    const r = inferKey({ chords: [wc('Am7', 8, { start: true, end: true }), wc('D', 8)] })
    expect(r.root).toBe(PC.A)
    expect(r.modeId).toBe('dorian')
    expect(r.skeleton).toBe('minor')
  })

  it('hears i–bVI–bVII as aeolian', () => {
    const r = inferKey({ chords: [wc('Am', 8, { start: true, end: true }), wc('F', 4), wc('G', 4)] })
    expect(r.root).toBe(PC.A)
    expect(r.modeId).toBe('aeolian')
  })

  it('hears I–IV–V with a maj7 color as ionian', () => {
    const r = inferKey({ chords: [wc('G', 8, { start: true, end: true }), wc('Cmaj7', 4), wc('D7', 4)] })
    expect(r.root).toBe(PC.G)
    expect(r.modeId).toBe('ionian')
  })

  it('normalizes a capo hint to concert pitch', () => {
    // Sheet says "Am" with capo 2 — sounding key is B minor. Chords given in
    // concert pitch (as the fuser passes them after capo adjustment).
    const r = inferKey(
      { chords: [wc('Bm', 8, { start: true, end: true }), wc('E', 8)] },
      { tonalityName: 'Am', capo: 2 },
    )
    expect(r.root).toBe(PC.B)
    expect(r.skeleton).toBe('minor')
  })

  it('lets overwhelming chord evidence beat a wrong hint', () => {
    // Strong A mixolydian evidence, hint claims C.
    const r = inferKey(
      { chords: [wc('A', 16, { start: true, end: true }), wc('G', 8), wc('D', 8), wc('A7', 8)] },
      { tonalityName: 'C' },
    )
    expect(r.root).toBe(PC.A)
  })

  it('reports confidence in [0,1], higher for clearer keys', () => {
    const clear = inferKey({ chords: [wc('A', 16, { start: true, end: true }), wc('D', 8), wc('E7', 8)] })
    const vague = inferKey({ chords: [wc('C', 4), wc('D', 4), wc('E', 4), wc('F#', 4)] })
    expect(clear.confidence).toBeGreaterThan(0)
    expect(clear.confidence).toBeLessThanOrEqual(1)
    expect(vague.confidence).toBeLessThanOrEqual(clear.confidence)
  })
})

describe('inferSectionKeys', () => {
  it('flags a bridge that clearly modulates and leaves agreeing sections null', () => {
    const whole = inferKey({ chords: [wc('G', 16, { start: true, end: true }), wc('C', 8), wc('D', 8)] })
    const verse = { chords: [wc('G', 8, { start: true, end: true }), wc('C', 8)] }
    const bridge = { chords: [wc('Bm', 8, { start: true, end: true }), wc('F#7', 8), wc('Em', 8)] }
    const [v, b] = inferSectionKeys([verse, bridge], whole)
    expect(v).toBeNull()
    expect(b).not.toBeNull()
    expect(b!.root).not.toBe(whole.root)
  })

  it('never overrides on thin evidence', () => {
    const whole = inferKey({ chords: [wc('G', 16, { start: true, end: true }), wc('C', 8)] })
    const thin = { chords: [wc('Bm', 2)] } // one short chord
    expect(inferSectionKeys([thin], whole)[0]).toBeNull()
  })
})
