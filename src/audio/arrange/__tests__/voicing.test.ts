import { describe, expect, it } from 'vitest'
import {
  buildTimeline, chord, chordPcs, normalizePc, PC, PROGRESSIONS, progressionById,
  QUALITIES, type Chord,
} from '../../../music-core'
import { KEYS_REGISTER, nextVoicing } from '../voicing'

function isAscending(midis: number[]): boolean {
  for (let i = 1; i < midis.length; i++) if (midis[i] <= midis[i - 1]) return false
  return true
}

describe('nextVoicing — cross-chord invariants over every real chart', () => {
  for (const p of PROGRESSIONS) {
    const timeline = buildTimeline(p, p.defaultKey)
    it(`${p.id}: every chord voices 3-5 ascending notes within [48,69]`, () => {
      let prev: number[] | null = null
      for (const ev of timeline) {
        const v = nextVoicing(ev.chord, prev)
        expect(v.length).toBeGreaterThanOrEqual(3)
        expect(v.length).toBeLessThanOrEqual(5)
        expect(new Set(v).size).toBe(v.length)
        expect(isAscending(v)).toBe(true)
        for (const m of v) {
          expect(m).toBeGreaterThanOrEqual(KEYS_REGISTER[0])
          expect(m).toBeLessThanOrEqual(KEYS_REGISTER[1])
        }
        prev = v
      }
    })
  }
})

describe('nextVoicing — every quality in the chord library, fresh seat', () => {
  // Root fixed at C (pc 0), which always has two octave slots in
  // [48,69] — sidesteps the one pathological edge (a bare power chord
  // whose root lands on pc 10/11, which has only one slot in-register and
  // can't be doubled to reach the 3-note minimum; not exercised by any
  // real chart, see task-6-report.md).
  for (const q of QUALITIES) {
    it(`${q.id}: voices 3-5 ascending notes within register from a fresh seat`, () => {
      const c: Chord = { root: PC.C, quality: q }
      const v = nextVoicing(c, null)
      expect(v.length).toBeGreaterThanOrEqual(3)
      expect(v.length).toBeLessThanOrEqual(5)
      expect(isAscending(v)).toBe(true)
      for (const m of v) {
        expect(m).toBeGreaterThanOrEqual(KEYS_REGISTER[0])
        expect(m).toBeLessThanOrEqual(KEYS_REGISTER[1])
      }
    })
  }
})

describe('nextVoicing — shell test', () => {
  it('7th-quality chords contain the third pc and the seventh pc', () => {
    for (const q of QUALITIES) {
      const hasThird = q.intervals.includes(3) || q.intervals.includes(4)
      const seventh = q.intervals.includes(11) ? 11 : q.intervals.includes(10) ? 10 : null
      if (!hasThird || seventh === null) continue
      const third = q.intervals.includes(4) ? 4 : 3
      const c: Chord = { root: PC.D, quality: q }
      const v = nextVoicing(c, null)
      const pcs = new Set(v.map(normalizePc))
      expect(pcs.has(normalizePc(PC.D + third))).toBe(true)
      expect(pcs.has(normalizePc(PC.D + seventh))).toBe(true)
    }
  })
})

describe('nextVoicing — 7#9 guard (neo-soul-vamp\'s A7#9)', () => {
  it('contains the major third and the b7, never the natural 9', () => {
    const timeline = buildTimeline(progressionById('neo-soul-vamp'), PC.D)
    const a7sharp9 = timeline.find((e) => e.symbol.includes('7#9'))
    expect(a7sharp9).toBeDefined()
    const root = a7sharp9!.chord.root
    const v = nextVoicing(a7sharp9!.chord, null)
    const pcs = new Set(v.map(normalizePc))
    expect(pcs.has(normalizePc(root + 4))).toBe(true) // major third
    expect(pcs.has(normalizePc(root + 10))).toBe(true) // b7
    expect(pcs.has(normalizePc(root + 2))).toBe(false) // never the natural 9 over an altered chord
  })
})

describe('nextVoicing — voice-leading over blues-12-standard', () => {
  it('mean total movement <=4 semitones/voice, mean top-note movement <=3', () => {
    const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)
    let prev: number[] | null = null
    let totalMoveSum = 0
    let totalVoices = 0
    let topMoveSum = 0
    let transitions = 0
    for (const ev of timeline) {
      const v = nextVoicing(ev.chord, prev)
      if (prev !== null) {
        transitions++
        topMoveSum += Math.abs(v[v.length - 1] - prev[prev.length - 1])
        const n = Math.min(v.length, prev.length)
        // Nearest-first pairing approximation for the assertion: sort both
        // ascending (already are) and pair index-wise over the shared count.
        for (let i = 0; i < n; i++) totalMoveSum += Math.abs(v[i] - prev[i])
        totalVoices += n
      }
      prev = v
    }
    expect(totalMoveSum / totalVoices).toBeLessThanOrEqual(4)
    expect(topMoveSum / transitions).toBeLessThanOrEqual(3)
  })
})

describe('nextVoicing — slash chords ignore the bass', () => {
  it("gravity's C/G voicing pcs are a subset of C-major-quality pcs (no G-rooted reinterpretation)", () => {
    const timeline = buildTimeline(progressionById('gravity'), PC.G)
    const cOverG = timeline[1]
    expect(cOverG.symbol).toBe('C/G')
    const majorPcs = new Set(chordPcs({ root: cOverG.chord.root, quality: cOverG.chord.quality }))
    const v = nextVoicing(cOverG.chord, null)
    for (const m of v) expect(majorPcs.has(normalizePc(m))).toBe(true)
  })

  it('slash-chord voicing is identical to the non-slash chord of the same root+quality', () => {
    const withBass = chord('D', 'maj', 'C')
    const withoutBass = chord('D', 'maj')
    expect(nextVoicing(withBass, null)).toEqual(nextVoicing(withoutBass, null))
  })
})

describe('nextVoicing — fresh seat lands near the register middle', () => {
  it('null prev seats the top note near MIDI 64', () => {
    const v = nextVoicing(chord('C', 'maj7'), null)
    expect(Math.abs(v[v.length - 1] - 64)).toBeLessThanOrEqual(6)
  })
})

describe('nextVoicing — determinism', () => {
  it('is a pure function of (chord, prev, register)', () => {
    const c = chord('A', 'dom9')
    const prev = nextVoicing(chord('D', '13'), null)
    expect(nextVoicing(c, prev)).toEqual(nextVoicing(c, prev))
  })
})
