import { describe, expect, it } from 'vitest'
import { buildTimeline, normalizePc, PC, progressionById, type TimelineEvent } from '../../../music-core'
import { arrangeBass, chordTones } from '../bass'
import { mulberry32 } from '../rng'
import type { BassStyle, NoteSpec } from '../types'

const STYLES: BassStyle[] = ['walking', 'boogie', 'rootFive', 'pedal']
const BEATS_PER_BAR = 4

function findEvent(timeline: TimelineEvent[], atBeat: number): TimelineEvent {
  const beat = Math.floor(atBeat)
  const ev = timeline.find((e) => {
    const start = e.bar * BEATS_PER_BAR + e.beat
    return beat >= start && beat < start + e.durationBeats
  })
  if (!ev) throw new Error(`No event covers beat ${atBeat}`)
  return ev
}

/** Circular pitch-class distance, 0..6. */
function pcDistance(a: number, b: number): number {
  const d = Math.abs(normalizePc(a) - normalizePc(b)) % 12
  return Math.min(d, 12 - d)
}

describe('arrangeBass — cross-style invariants', () => {
  const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)

  for (const style of STYLES) {
    it(`${style}: every midi is within [28,55]`, () => {
      const rng = mulberry32(hashOf(style))
      const notes = arrangeBass(timeline, style, BEATS_PER_BAR, rng)
      expect(notes.length).toBeGreaterThan(0)
      for (const n of notes) {
        for (const m of n.midis) {
          expect(m).toBeGreaterThanOrEqual(28)
          expect(m).toBeLessThanOrEqual(55)
        }
      }
    })

    it(`${style}: never the same midi three times consecutively (non-ghost notes)`, () => {
      const rng = mulberry32(hashOf(style))
      const notes = arrangeBass(timeline, style, BEATS_PER_BAR, rng).filter((n) => !n.ghost)
      for (let i = 2; i < notes.length; i++) {
        const same = notes[i].midis[0] === notes[i - 1].midis[0] && notes[i].midis[0] === notes[i - 2].midis[0]
        expect(same).toBe(false)
      }
    })

    it(`${style}: identical (timeline, style, beatsPerBar, seed) is deep-equal`, () => {
      const a = arrangeBass(timeline, style, BEATS_PER_BAR, mulberry32(hashOf(style)))
      const b = arrangeBass(timeline, style, BEATS_PER_BAR, mulberry32(hashOf(style)))
      expect(a).toEqual(b)
    })
  }

  it('walking: different seeds produce different arrangements', () => {
    const a = arrangeBass(timeline, 'walking', BEATS_PER_BAR, mulberry32(1))
    const b = arrangeBass(timeline, 'walking', BEATS_PER_BAR, mulberry32(2))
    expect(a).not.toEqual(b)
  })

  it('rootFive: different seeds produce different arrangements', () => {
    const a = arrangeBass(timeline, 'rootFive', BEATS_PER_BAR, mulberry32(1))
    const b = arrangeBass(timeline, 'rootFive', BEATS_PER_BAR, mulberry32(2))
    expect(a).not.toEqual(b)
  })

  it('ghost notes only land on x.5 beats and are soft', () => {
    for (const style of STYLES) {
      const notes = arrangeBass(timeline, style, BEATS_PER_BAR, mulberry32(hashOf(style)))
      for (const n of notes.filter((n) => n.ghost)) {
        expect(n.atBeat % 1).toBeCloseTo(0.5, 5)
        expect(n.vel).toBeLessThanOrEqual(0.25)
      }
    }
  })
})

describe('arrangeBass — walking style specifics', () => {
  const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)
  const notes = arrangeBass(timeline, 'walking', BEATS_PER_BAR, mulberry32(hashOf('walking')))
  const regular = notes.filter((n) => !n.ghost)

  it('has exactly one non-ghost note per integer beat of the whole form', () => {
    const totalBeats = timeline.reduce((s, e) => s + e.durationBeats, 0)
    expect(regular.length).toBe(totalBeats)
    const beats = regular.map((n) => n.atBeat).sort((a, b) => a - b)
    expect(beats).toEqual(Array.from({ length: totalBeats }, (_, i) => i))
  })

  it('approaches the next chord within 2 semitones, or via the dominant', () => {
    for (let i = 0; i < timeline.length; i++) {
      const ev = timeline[i]
      const next = timeline[(i + 1) % timeline.length]
      const changeComing = normalizePc(chordTones(next).bassPc) !== normalizePc(chordTones(ev).bassPc)
      if (!changeComing) continue
      const lastBeat = ev.bar * BEATS_PER_BAR + ev.beat + ev.durationBeats - 1
      const note = regular.find((n) => n.atBeat === lastBeat)
      expect(note).toBeDefined()
      const targetPc = chordTones(next).bassPc
      const notePc = note!.midis[0]
      const closeToTarget = pcDistance(notePc, targetPc) <= 2
      const isDominant = normalizePc(notePc) === normalizePc(targetPc + 7)
      expect(closeToTarget || isDominant).toBe(true)
    }
  })
})

describe('arrangeBass — boogie style specifics', () => {
  it('walks 1-3-5-6 then b7-6-5-3 over the two bars of a fresh dominant chord', () => {
    const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)
    const notes = arrangeBass(timeline, 'boogie', BEATS_PER_BAR, mulberry32(hashOf('boogie')))
    // The D7 step (index 1) is 8 beats = 2 full bars, not the final chord of
    // the form, so bar 2's last beat is not approach-substituted... except
    // D7 -> A7 IS a change, so the last beat of bar 2 IS substituted; check
    // bars 0-2 (excluding the final approach beat) as the brief specifies.
    const d7 = timeline[1]
    expect(d7.symbol.startsWith('D')).toBe(true)
    const ct = chordTones(d7)
    const start = d7.bar * BEATS_PER_BAR + d7.beat
    const bar1 = notes.filter((n) => !n.ghost && n.atBeat >= start && n.atBeat < start + 4)
    const bar2 = notes.filter((n) => !n.ghost && n.atBeat >= start + 4 && n.atBeat < start + 8)
    const relPc = (n: NoteSpec) => normalizePc(n.midis[0] - ct.root)
    expect(bar1.map(relPc)).toEqual([0, 4, 7, 9])
    // Last beat of bar 2 is approach-substituted (D7 -> A7 change); check
    // only the first three positions.
    expect(bar2.slice(0, 3).map(relPc)).toEqual([10, 9, 7])
  })
})

describe('arrangeBass — THE BUG-FIX TEST', () => {
  const styles: BassStyle[] = ['walking', 'boogie']
  const timeline = buildTimeline(progressionById('blues-minor'), PC.A)

  /** The last integer beat before a chord change is a chromatic/dominant
   * approach into the NEXT chord's root by design — it is voice-leading,
   * not a harmony choice against the current chord, so it may legitimately
   * land on any pitch class (this mirrors the boogie contour test's
   * "excluding approach-substituted beats" carve-out). */
  function isApproachBeat(ev: TimelineEvent, atBeat: number): boolean {
    const lastBeat = ev.bar * BEATS_PER_BAR + ev.beat + ev.durationBeats - 1
    if (atBeat !== lastBeat) return false
    const idx = timeline.indexOf(ev)
    const next = timeline[(idx + 1) % timeline.length]
    return normalizePc(chordTones(next).bassPc) !== normalizePc(chordTones(ev).bassPc)
  }

  for (const style of styles) {
    it(`${style}: never a major third or major 6th over a minor-quality chord`, () => {
      const notes = arrangeBass(timeline, style, BEATS_PER_BAR, mulberry32(hashOf(style + '-minor')))
      for (const n of notes.filter((nn) => !nn.ghost)) {
        const ev = findEvent(timeline, n.atBeat)
        if (isApproachBeat(ev, n.atBeat)) continue
        const intervals = ev.chord.quality.intervals
        const isMinorQuality = intervals.includes(3) && !intervals.includes(4)
        if (!isMinorQuality) continue
        const rootPc = chordTones(ev).bassPc
        const notePc = normalizePc(n.midis[0])
        const isMajorThird = notePc === normalizePc(rootPc + 4)
        const isMajorSixth = notePc === normalizePc(rootPc + 9)
        if (isMajorSixth && intervals.includes(9)) continue // e.g. a real 6-chord
        expect(isMajorThird).toBe(false)
        expect(isMajorSixth).toBe(false)
      }
    })
  }
})

/** All chord-tone pcs of an event, bass foundation included. */
function chordTonePcs(ev: TimelineEvent): Set<number> {
  const ct = chordTones(ev)
  return new Set(
    [0, ct.rootOffset, ct.third, ct.fifth, ct.sixthOrSeventh].map((off) => normalizePc(ct.root + off)),
  )
}

describe('arrangeBass — slash chords anchor intervals on the chord root', () => {
  /** Non-ghost notes over a specific timeline event. */
  function notesOver(notes: NoteSpec[], ev: TimelineEvent): NoteSpec[] {
    const start = ev.bar * BEATS_PER_BAR + ev.beat
    return notes.filter((n) => !n.ghost && n.atBeat >= start && n.atBeat < start + ev.durationBeats)
  }

  /** Scalar/enclosure passing tones resolve by step into the next note —
   * exempt them from chord-tone membership checks (any pc, by design). */
  function isStepwise(all: NoteSpec[], n: NoteSpec): boolean {
    const idx = all.indexOf(n)
    const next = all[idx + 1]
    if (!next) return true // cannot judge the final note of the output
    return Math.abs(n.midis[0] - next.midis[0]) <= 2
  }

  it('boogie over lydian-vamp D/C walks C–F#–A–B, never E or G (the old bug)', () => {
    const timeline = buildTimeline(progressionById('lydian-vamp'), PC.C)
    const dOverC = timeline[1]
    expect(dOverC.symbol).toBe('D/C')
    const notes = arrangeBass(timeline, 'boogie', BEATS_PER_BAR, mulberry32(7)).filter((n) => !n.ghost)
    const over = notesOver(notes, dOverC)
    expect(over.length).toBeGreaterThan(0)
    const pcs = over.map((n) => normalizePc(n.midis[0]))
    // No approach beats exist here: Cmaj7 and D/C share the same bass pc (C).
    for (const pc of pcs) expect([PC.C, PC.Fs, PC.A, PC.B]).toContain(pc)
    expect(pcs).toContain(PC.Fs) // the #4 color the song exists to teach
    expect(pcs).not.toContain(PC.E) // old bug: intervals anchored on the C bass
    expect(pcs).not.toContain(PC.G)
  })

  it('walking over lydian-vamp D/C reaches F# and never lands wrong-anchored tones', () => {
    const timeline = buildTimeline(progressionById('lydian-vamp'), PC.C)
    const dOverC = timeline[1]
    const all = arrangeBass(timeline, 'walking', BEATS_PER_BAR, mulberry32(11)).filter((n) => !n.ghost)
    const over = notesOver(all, dOverC)
    expect(over.length).toBeGreaterThan(0)
    const allowed = chordTonePcs(dOverC) // {C, D, F#, A, B}
    for (const n of over) {
      if (isStepwise(all, n)) continue // scalar passing tone, resolves by step
      expect(allowed.has(normalizePc(n.midis[0]))).toBe(true)
    }
    expect(over.map((n) => normalizePc(n.midis[0]))).toContain(PC.Fs)
  })

  it("walking over phrygian-vamp F/E stays on F chord tones, never E-major's G#/B", () => {
    const timeline = buildTimeline(progressionById('phrygian-vamp'), PC.E)
    const fOverE = timeline[1]
    expect(fOverE.symbol).toBe('F/E')
    const all = arrangeBass(timeline, 'walking', BEATS_PER_BAR, mulberry32(3)).filter((n) => !n.ghost)
    const over = notesOver(all, fOverE)
    expect(over.length).toBeGreaterThan(0)
    const allowed = chordTonePcs(fOverE) // {E, F, A, C, D}
    for (const n of over) {
      if (isStepwise(all, n)) continue
      const pc = normalizePc(n.midis[0])
      // The old bug played E-major intervals over the E bass: G# and B.
      expect(pc).not.toBe(PC.Gs)
      expect(pc).not.toBe(PC.B)
      expect(allowed.has(pc)).toBe(true)
    }
  })

  it('gravity C/G still walks from the G bass on every strong beat', () => {
    const timeline = buildTimeline(progressionById('gravity'), PC.G)
    const cOverG = timeline[1]
    expect(cOverG.symbol).toBe('C/G')
    const all = arrangeBass(timeline, 'walking', BEATS_PER_BAR, mulberry32(5)).filter((n) => !n.ghost)
    const downbeats = notesOver(all, cOverG).filter((n) => n.atBeat % BEATS_PER_BAR === 0)
    expect(downbeats.length).toBeGreaterThan(0)
    // Both the foundation (G) and the fifth-of-C (also G!) sit on pc 7.
    for (const n of downbeats) expect(normalizePc(n.midis[0])).toBe(PC.G)
  })
})

describe('arrangeBass — walking scalar lines resolve into their target', () => {
  const timeline = buildTimeline(progressionById('blues-12-standard'), PC.A)

  function isApproachBeat(atBeat: number): boolean {
    const ev = findEvent(timeline, atBeat)
    if (atBeat !== ev.bar * BEATS_PER_BAR + ev.beat + ev.durationBeats - 1) return false
    const idx = timeline.indexOf(ev)
    const next = timeline[(idx + 1) % timeline.length]
    return normalizePc(chordTones(next).bassPc) !== normalizePc(chordTones(ev).bassPc)
  }

  it('a non-chord-tone beat before a downbeat resolves into it within 2 semitones', () => {
    for (const seed of [1, 2, 3, 42]) {
      const notes = arrangeBass(timeline, 'walking', BEATS_PER_BAR, mulberry32(seed)).filter((n) => !n.ghost)
      for (let i = 1; i < notes.length; i++) {
        const down = notes[i]
        if (down.atBeat % BEATS_PER_BAR !== 0) continue // only strong beats
        const prev = notes[i - 1]
        if (prev.atBeat !== down.atBeat - 1) continue
        if (isApproachBeat(prev.atBeat)) continue // the approach rule has its own test
        if (chordTonePcs(findEvent(timeline, prev.atBeat)).has(normalizePc(prev.midis[0]))) continue
        expect(Math.abs(prev.midis[0] - down.midis[0])).toBeLessThanOrEqual(2)
      }
    }
  })
})

function hashOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h >>> 0
}
