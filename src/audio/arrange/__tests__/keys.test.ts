import { describe, expect, it } from 'vitest'
import {
  buildTimeline, chord, normalizePc, PC, progressionById, type Chord, type TimelineEvent,
} from '../../../music-core'
import { arrangeKeys } from '../keys'
import { mulberry32 } from '../rng'
import type { CompStyle } from '../types'
import { KEYS_REGISTER, nextVoicing } from '../voicing'

const BEATS_PER_BAR = 4
const COMPS: CompStyle[] = ['charleston', 'soul-pads', 'neosoul', 'strum', 'vamp', 'pop']

describe('arrangeKeys — cross-style invariants', () => {
  const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)

  for (const comp of COMPS) {
    it(`${comp}: every note is within the keys register`, () => {
      const notes = arrangeKeys(timeline, comp, BEATS_PER_BAR, mulberry32(hashOf(comp)))
      expect(notes.length).toBeGreaterThan(0)
      for (const n of notes) {
        for (const m of n.midis) {
          expect(m).toBeGreaterThanOrEqual(KEYS_REGISTER[0])
          expect(m).toBeLessThanOrEqual(KEYS_REGISTER[1])
        }
      }
    })
  }

  it('charleston: same seed is deep-equal, different seeds differ', () => {
    const a = arrangeKeys(timeline, 'charleston', BEATS_PER_BAR, mulberry32(11))
    const b = arrangeKeys(timeline, 'charleston', BEATS_PER_BAR, mulberry32(11))
    expect(a).toEqual(b)
    const c = arrangeKeys(timeline, 'charleston', BEATS_PER_BAR, mulberry32(12))
    expect(a).not.toEqual(c)
  })

  it('neosoul: same seed is deep-equal, different seeds differ', () => {
    const a = arrangeKeys(timeline, 'neosoul', BEATS_PER_BAR, mulberry32(21))
    const b = arrangeKeys(timeline, 'neosoul', BEATS_PER_BAR, mulberry32(21))
    expect(a).toEqual(b)
    const c = arrangeKeys(timeline, 'neosoul', BEATS_PER_BAR, mulberry32(22))
    expect(a).not.toEqual(c)
  })
})

describe('arrangeKeys — neosoul is sparse', () => {
  const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)

  it('emits at most one non-anticipation hit per bar', () => {
    const notes = arrangeKeys(timeline, 'neosoul', BEATS_PER_BAR, mulberry32(hashOf('neosoul')))
    const perBar = new Map<number, number>()
    for (const n of notes.filter((n) => !n.anticipation)) {
      const bar = Math.floor(n.atBeat / BEATS_PER_BAR)
      perBar.set(bar, (perBar.get(bar) ?? 0) + 1)
    }
    for (const count of perBar.values()) expect(count).toBeLessThanOrEqual(1)
  })

  it('has fewer total hits than strum on the same timeline', () => {
    const neosoul = arrangeKeys(timeline, 'neosoul', BEATS_PER_BAR, mulberry32(hashOf('neosoul')))
    const strum = arrangeKeys(timeline, 'strum', BEATS_PER_BAR, mulberry32(hashOf('strum')))
    expect(neosoul.length).toBeLessThan(strum.length)
  })
})

describe('arrangeKeys — dynamics arc', () => {
  it('a bar with multiplier 1.06 has a hotter beat-0 vel than one with 0.92 (soul-pads)', () => {
    // blues-12-standard's opening A7 spans bars 0-3 (absBar 0..3) with no
    // chord change inside it, so the voicing is constant and only the
    // dynamics arc explains any vel difference between its bars.
    const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)
    const notes = arrangeKeys(timeline, 'soul-pads', BEATS_PER_BAR, mulberry32(hashOf('soul-pads')))
    const bar0 = notes.find((n) => n.atBeat === 0 && !n.anticipation)
    const bar3 = notes.find((n) => n.atBeat === 3 * BEATS_PER_BAR && !n.anticipation)
    expect(bar0).toBeDefined()
    expect(bar3).toBeDefined()
    expect(bar3!.vel).toBeGreaterThan(bar0!.vel)
  })
})

describe('arrangeKeys — anticipation', () => {
  const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)
  const notes = arrangeKeys(timeline, 'charleston', BEATS_PER_BAR, mulberry32(hashOf('anticipation')))
  const anticipations = notes.filter((n) => n.anticipation)

  it('fires at least once over a 12-bar form', () => {
    expect(anticipations.length).toBeGreaterThan(0)
  })

  it('each anticipation note sits exactly at a chord-start beat minus 0.5, dur 1.6, vel .58', () => {
    const chordStarts = new Set(timeline.map((e) => e.bar * BEATS_PER_BAR + e.beat))
    for (const a of anticipations) {
      expect(chordStarts.has(a.atBeat + 0.5)).toBe(true)
      expect(a.durBeats).toBeCloseTo(1.6, 5)
      expect(a.vel).toBeCloseTo(0.58, 5)
    }
  })

  it('pcs match the next chord\'s voice-led voicing from the current chord\'s voicing', () => {
    for (const a of anticipations) {
      const changeBeat = a.atBeat + 0.5
      const curIdx = timeline.findIndex((e) => e.bar * BEATS_PER_BAR + e.beat + e.durationBeats === changeBeat)
      const nextIdx = curIdx + 1
      expect(curIdx).toBeGreaterThanOrEqual(0)
      expect(nextIdx).toBeLessThan(timeline.length)
      const curStart = timeline[curIdx].bar * BEATS_PER_BAR + timeline[curIdx].beat
      // The current chord's full voicing is whatever midis array is longest
      // among its own non-anticipation notes (every style's primary hit
      // uses the full voicing; only soul-pads' optional restrike uses the
      // top two, which is shorter).
      const curNotes = notes.filter((n) => !n.anticipation && n.atBeat >= curStart && n.atBeat < changeBeat)
      const curVoicing = curNotes.reduce((best, n) => (n.midis.length > best.length ? n.midis : best), [] as number[])
      expect(curVoicing.length).toBeGreaterThan(0)
      const expected = nextVoicing(timeline[nextIdx].chord, curVoicing)
      expect(a.midis).toEqual(expected)
    }
  })

  it('no other note of either chord lands in [changeBeat-0.5, changeBeat+0.01)', () => {
    for (const a of anticipations) {
      const changeBeat = a.atBeat + 0.5
      const overlapping = notes.filter(
        (n) => n !== a && n.atBeat >= changeBeat - 0.5 && n.atBeat < changeBeat + 0.01,
      )
      expect(overlapping).toEqual([])
    }
  })
})

describe('arrangeKeys — re-seats every 8 absolute bars', () => {
  const NO_RNG = (): number => 0.99 // never satisfies any p<X branch: fully deterministic minimal pattern

  function syntheticTimeline(roots: string[]): TimelineEvent[] {
    return roots.map((r, i) => ({
      bar: i,
      beat: 0,
      chord: chord(r, 'dom7') as Chord,
      symbol: '',
      durationBeats: BEATS_PER_BAR,
    }))
  }

  it('bar 8 lands on the same fresh-seat voicing regardless of how the prior 8 bars drifted', () => {
    const runA = syntheticTimeline(['G', 'F#', 'D', 'G#', 'E', 'A#', 'B', 'D#', 'C'])
    const runB = syntheticTimeline(['Eb', 'A', 'Eb', 'F', 'B', 'G', 'Db', 'Ab', 'C'])

    const notesA = arrangeKeys(runA, 'vamp', BEATS_PER_BAR, NO_RNG)
    const notesB = arrangeKeys(runB, 'vamp', BEATS_PER_BAR, NO_RNG)

    const bar8Start = 8 * BEATS_PER_BAR
    const voicingA = notesA.find((n) => n.atBeat === bar8Start)!.midis
    const voicingB = notesB.find((n) => n.atBeat === bar8Start)!.midis
    expect(voicingA).toEqual(voicingB)
    expect(Math.abs(voicingA[voicingA.length - 1] - 64)).toBeLessThanOrEqual(6)

    // Sanity: the two runs really did diverge before bar 8 (different roots).
    const bar0A = notesA.find((n) => n.atBeat === 0)!.midis
    const bar0B = notesB.find((n) => n.atBeat === 0)!.midis
    expect(bar0A).not.toEqual(bar0B)
  })
})

describe('arrangeKeys — voicing stays constant across a multi-bar chord', () => {
  it("blues-12-standard's opening 4-bar A7 uses the same voicing on every bar", () => {
    const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)
    const notes = arrangeKeys(timeline, 'vamp', BEATS_PER_BAR, mulberry32(hashOf('vamp-const')))
    const downbeats = [0, 4, 8, 12].map((b) => notes.find((n) => n.atBeat === b && !n.anticipation))
    for (const n of downbeats) expect(n).toBeDefined()
    const first = downbeats[0]!.midis
    for (const n of downbeats.slice(1)) expect(n!.midis).toEqual(first)
  })
})

describe('arrangeKeys — pcs are chord-plausible (sanity, not a substitute for the voicing suite)', () => {
  it('every non-anticipation note pc is reachable from its chord root by a small interval set', () => {
    const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)
    const notes = arrangeKeys(timeline, 'pop', BEATS_PER_BAR, mulberry32(hashOf('pop')))
    for (const n of notes.filter((n) => !n.anticipation)) {
      const ev = timeline.find((e) => {
        const start = e.bar * BEATS_PER_BAR + e.beat
        return n.atBeat >= start && n.atBeat < start + e.durationBeats
      })
      expect(ev).toBeDefined()
      for (const m of n.midis) {
        const rel = normalizePc(m - ev!.chord.root)
        expect([0, 2, 3, 4, 6, 7, 8, 9, 10, 11]).toContain(rel)
      }
    }
  })
})

function hashOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h >>> 0
}
