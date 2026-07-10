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

/** Two adjacent voices a bare semitone apart — reads as a fingering mistake on piano. */
function hasSemitoneCluster(midis: number[]): boolean {
  for (let i = 1; i < midis.length; i++) if (midis[i] - midis[i - 1] === 1) return true
  return false
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
  // All 12 roots are additionally swept by the cluster suite below; this
  // block pins the structural invariants per quality at a fixed root.
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

describe('nextVoicing — no adjacent-semitone clusters, ever', () => {
  // The cluster-free candidate pool depends only on (quality, root, register)
  // — prev influences the cost ranking, never the pool — so a fresh-seat
  // sweep over all 27 qualities x 12 roots is a COMPLETE proof that the
  // clustered fallback is unreachable, and the chained sweeps then verify
  // the cost function keeps picking from that pool under voice-leading
  // pressure.
  it('fresh seat: all 27 qualities x 12 roots', () => {
    for (const q of QUALITIES) {
      for (let root = 0; root < 12; root++) {
        const v = nextVoicing({ root: normalizePc(root), quality: q }, null)
        expect(hasSemitoneCluster(v), `${q.id} root ${root}: ${v.join(',')}`).toBe(false)
      }
    }
  })

  it('voice-led chains: all 27 qualities x 12 roots (cycle of 4ths), led from a drifting prev', () => {
    for (let start = 0; start < 12; start++) {
      let prev: number[] | null = null
      for (let step = 0; step < 12; step++) {
        for (const q of QUALITIES) {
          const root = normalizePc(start + step * 5)
          const v = nextVoicing({ root, quality: q }, prev)
          expect(hasSemitoneCluster(v), `${q.id} root ${root}: ${v.join(',')}`).toBe(false)
          prev = v
        }
      }
    }
  })

  it('every chord of every PROGRESSION in keys C, A, and E — fresh-seat and chained', () => {
    for (const p of PROGRESSIONS) {
      for (const key of [PC.C, PC.A, PC.E]) {
        const timeline = buildTimeline(p, key)
        let prev: number[] | null = null
        for (const ev of timeline) {
          const fresh = nextVoicing(ev.chord, null)
          expect(hasSemitoneCluster(fresh), `${p.id}/key${key} ${ev.symbol} fresh: ${fresh.join(',')}`).toBe(false)
          const led = nextVoicing(ev.chord, prev)
          expect(hasSemitoneCluster(led), `${p.id}/key${key} ${ev.symbol} led: ${led.join(',')}`).toBe(false)
          prev = led
        }
      }
    }
  })

  it("the reviewer's exact repro charts are cluster-free when chained", () => {
    // Reported: blues-minor in A gave Dm7 => 48,64,65; neo-soul-vamp in C
    // gave G7#9 => 53,58,59.
    for (const [id, key] of [['blues-minor', PC.A], ['neo-soul-vamp', PC.C]] as const) {
      let prev: number[] | null = null
      for (const ev of buildTimeline(progressionById(id), key)) {
        prev = nextVoicing(ev.chord, prev)
        expect(hasSemitoneCluster(prev), `${id} ${ev.symbol}: ${prev.join(',')}`).toBe(false)
      }
    }
  })

  it('7#9: the #9 is never adjacent to the major third (the Hendrix spread)', () => {
    const q = QUALITIES.find((qq) => qq.id === '7#9')!
    const slotsInRegister = (pc: number): number => {
      let count = 0
      for (let m = KEYS_REGISTER[0]; m <= KEYS_REGISTER[1]; m++) if (normalizePc(m) === pc) count++
      return count
    }
    for (let root = 0; root < 12; root++) {
      const v = nextVoicing({ root: normalizePc(root), quality: q }, null)
      const thirdPc = normalizePc(root + 4)
      const sharp9Pc = normalizePc(root + 3)
      const third = v.find((m) => normalizePc(m) === thirdPc)
      const sharp9 = v.find((m) => normalizePc(m) === sharp9Pc)
      expect(third, `third missing for root ${root}`).toBeDefined()
      // The #9 can only spread away from the third when at least one of the
      // two pcs has a second octave slot in the register; when both are
      // single-slot (they sit a semitone apart — G7#9's B=59/Bb=58 is the
      // only such root in [48,69]) the color is dropped, never crushed.
      const canCoexist = slotsInRegister(thirdPc) >= 2 || slotsInRegister(sharp9Pc) >= 2
      if (canCoexist) {
        expect(sharp9, `#9 missing for root ${root}`).toBeDefined()
        expect(Math.abs(sharp9! - third!)).toBeGreaterThan(1)
      } else {
        expect(sharp9, `#9 should be dropped, not crushed, for root ${root}`).toBeUndefined()
      }
    }
  })
})

describe('nextVoicing — shell test', () => {
  it('7th-quality chords contain the third pc and the seventh pc', () => {
    for (const q of QUALITIES) {
      const hasThird = q.intervals.includes(3) || q.intervals.includes(4)
      // dim7's seventh is the bb7 (interval 9); for every other quality a
      // bare 9 is a 6th/13th, so gate the bb7 reading on the quality id.
      const seventh = q.intervals.includes(11) ? 11
        : q.intervals.includes(10) ? 10
        : q.id === 'dim7' ? 9
        : null
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
