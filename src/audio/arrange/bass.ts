import { chordBass, normalizePc, type PitchClass, type TimelineEvent } from '../../music-core'
import type { BassStyle, NoteSpec } from './types'

/**
 * Bass arranger v2. Pure function of (timeline, style, beatsPerBar, rng) —
 * no Tone, no DOM, no Math.random. Replaces the old arrangeBass in
 * sequencer.ts, whose sixthOrSeventh fallback (`iv[3] ?? 9`) played a major
 * 6th over plain minor triads. Every note choice here is derived from the
 * chord's actual quality intervals.
 */

export interface ChordTones {
  /** Bass foundation pitch class (walks to the slash bass for e.g. C/G). */
  bassPc: PitchClass
  /** Un-folded root midi, 36 + normalizePc(bassPc); always in [36,47]. */
  root: number
  /** Semitone offset of the third: minor (3) or major (4), sus fallback. */
  third: number
  /** Semitone offset of the fifth: perfect (7), or dim (6) / aug (8). */
  fifth: number
  /** The "sixth-or-seventh" color tone above the fifth — the bug-fix slot. */
  sixthOrSeventh: number
}

function findThird(intervals: number[]): number {
  if (intervals.includes(3)) return 3
  if (intervals.includes(4)) return 4
  // No third at all (sus2/sus4/power chords): use whatever non-root interval
  // sits closest to a "normal" third — the sus tone (2 or 5) for sus chords.
  const candidates = intervals.filter((i) => i !== 0)
  if (candidates.length === 0) return 4
  return candidates.reduce((best, i) => (Math.abs(i - 4) < Math.abs(best - 4) ? i : best))
}

function findFifth(intervals: number[]): number {
  for (const i of [7, 6, 8]) if (intervals.includes(i)) return i
  return 7
}

/** THE bug fix: never fall back to a literal major 6th over a minor chord. */
function findSixthOrSeventh(intervals: number[], third: number): number {
  if (intervals.includes(10)) return 10
  if (intervals.includes(11)) return 11
  if (intervals.includes(9)) return 9
  return third === 3 ? 10 : 9 // minor -> b7 (natural-minor assumption); major -> 6
}

export function chordTones(ev: TimelineEvent): ChordTones {
  const intervals = ev.chord.quality.intervals
  const third = findThird(intervals)
  const fifth = findFifth(intervals)
  const sixthOrSeventh = findSixthOrSeventh(intervals, third)
  const bassPc = chordBass(ev.chord)
  const root = 36 + normalizePc(bassPc)
  return { bassPc, root, third, fifth, sixthOrSeventh }
}

/** Fold any midi into the working bass register, E1..G3. */
function foldBass(m: number): number {
  let out = m
  while (out > 55) out -= 12
  while (out < 28) out += 12
  return out
}

/**
 * Push a note, enforcing "never the same midi three times consecutively"
 * across the whole output. `alt` is the style-appropriate fallback (usually
 * the other chord tone in play) tried after an octave substitution fails.
 * Ghost dead-notes intentionally echo the pc of the note just played, so
 * they are pushed directly (bypassing this) and don't count as a "repeat"
 * for the purposes of this rule — see task-5-report.md.
 */
function pushNote(
  out: NoteSpec[],
  candidate: number,
  alt: number,
  atBeat: number,
  durBeats: number,
  vel: number,
  extra?: Partial<NoteSpec>,
): void {
  let m = foldBass(candidate)
  const n = out.length
  const last1 = n >= 1 ? out[n - 1].midis[0] : undefined
  const last2 = n >= 2 ? out[n - 2].midis[0] : undefined
  if (last1 === m && last2 === m) {
    const octUp = foldBass(m + 12)
    const octDown = foldBass(m - 12)
    if (octUp !== m) m = octUp
    else if (octDown !== m) m = octDown
    else m = foldBass(alt)
  }
  out.push({ atBeat, midis: [m], durBeats, vel, ...extra })
}

function pushGhost(out: NoteSpec[], atBeat: number): void {
  const last = out[out.length - 1]?.midis[0]
  if (last === undefined) return
  out.push({ atBeat, midis: [last], durBeats: 0.12, vel: 0.2, ghost: true })
}

/**
 * Weighted approach into the next chord's entry: chromatic below (p .4),
 * chromatic above (p .3), or the dominant (target's pc + 7, voiced within
 * an octave of the target so it doesn't leap register).
 */
function approachNote(rng: () => number, targetRoot: number): number {
  const r = rng()
  if (r < 0.4) return targetRoot - 1
  if (r < 0.7) return targetRoot + 1
  let dom = targetRoot + 7
  while (dom - targetRoot > 6) dom -= 12
  while (dom - targetRoot < -6) dom += 12
  return dom
}

function nextChangeInfo(timeline: TimelineEvent[], i: number) {
  const ev = timeline[i]
  const next = timeline[(i + 1) % timeline.length]
  const ct = chordTones(ev)
  const nextCt = chordTones(next)
  const changeComing = normalizePc(nextCt.bassPc) !== normalizePc(ct.bassPc)
  return { ev, ct, nextCt, changeComing }
}

/* --------------------------------- walking -------------------------------- */

function arrangeWalking(timeline: TimelineEvent[], beatsPerBar: number, rng: () => number): NoteSpec[] {
  const out: NoteSpec[] = []
  for (let i = 0; i < timeline.length; i++) {
    const { ev, ct, nextCt, changeComing } = nextChangeInfo(timeline, i)
    const toneCycle = [ct.third, ct.fifth, ct.sixthOrSeventh]
    let shapeSkip = true
    let shapeAsc = true
    for (let b = 0; b < ev.durationBeats; b++) {
      const barPos = b % beatsPerBar
      const atBeat = ev.bar * beatsPerBar + ev.beat + b
      const isLastBeatOfChord = b === ev.durationBeats - 1
      if (barPos === 0) {
        shapeSkip = rng() < 0.5
        shapeAsc = rng() < 0.5
      }
      let midi: number
      let vel: number
      let alt: number
      if (isLastBeatOfChord && changeComing) {
        midi = approachNote(rng, nextCt.root)
        alt = nextCt.root
        vel = 0.8 + (rng() - 0.5) * 0.04
      } else if (b === 0) {
        midi = ct.root
        alt = ct.root + ct.fifth
        vel = 0.95
      } else if (barPos === 0) {
        midi = rng() < 0.6 ? ct.root : ct.root + ct.fifth
        alt = ct.root
        vel = 0.95
      } else if (shapeSkip) {
        const idx = (barPos - 1) % toneCycle.length
        const tone = toneCycle[shapeAsc ? idx : toneCycle.length - 1 - idx]
        midi = ct.root + tone
        alt = ct.root + ct.fifth
        vel = 0.8 + (rng() - 0.5) * 0.04
      } else {
        // Scalar/enclosure motion back toward the root at the top of the
        // next bar: small steps with the last one leaning in from a
        // half-step above (a classic bebop-style enclosure).
        const scalarOffsets = [2, 1, -1]
        midi = ct.root + scalarOffsets[(barPos - 1) % scalarOffsets.length]
        alt = ct.root + ct.fifth
        vel = 0.8 + (rng() - 0.5) * 0.04
      }
      pushNote(out, midi, alt, atBeat, 0.9, vel)
      if ((barPos === 1 || barPos === 3) && rng() < 0.3) pushGhost(out, atBeat + 0.5)
    }
  }
  return out
}

/* --------------------------------- boogie --------------------------------- */

function arrangeBoogie(timeline: TimelineEvent[], beatsPerBar: number, rng: () => number): NoteSpec[] {
  if (beatsPerBar !== 4) return arrangeWalking(timeline, beatsPerBar, rng)
  const out: NoteSpec[] = []
  for (let i = 0; i < timeline.length; i++) {
    const { ev, ct, nextCt, changeComing } = nextChangeInfo(timeline, i)
    const seventh = ev.chord.quality.intervals.includes(11) ? 11 : 10
    // The classic boogie "6" passing tone is a literal major 6th over
    // major/dominant chords (the shuffle sound) — but NOT over a minor
    // chord, where that would reintroduce the exact bug this task fixes.
    // Over minor chords we reuse the bug-fixed sixthOrSeventh tone instead.
    const sixthTone = ct.third === 3 ? ct.sixthOrSeventh : 9
    const evenPattern = [0, ct.third, ct.fifth, sixthTone]
    const oddPattern = [seventh, sixthTone, ct.fifth, ct.third]
    for (let b = 0; b < ev.durationBeats; b++) {
      const barPos = b % 4
      const barIdx = Math.floor(b / 4)
      const atBeat = ev.bar * beatsPerBar + ev.beat + b
      const isLastBeatOfChord = b === ev.durationBeats - 1
      let midi: number
      let vel: number
      let alt: number
      if (isLastBeatOfChord && changeComing) {
        midi = approachNote(rng, nextCt.root)
        alt = nextCt.root
        vel = 0.82
      } else {
        const pattern = barIdx % 2 === 0 ? evenPattern : oddPattern
        midi = ct.root + pattern[barPos]
        alt = ct.root + ct.fifth
        vel = barPos === 0 ? 0.95 : 0.82
      }
      pushNote(out, midi, alt, atBeat, 0.85, vel)
      if ((barPos === 1 || barPos === 3) && rng() < 0.2) pushGhost(out, atBeat + 0.5)
    }
  }
  return out
}

/* -------------------------------- rootFive -------------------------------- */

function arrangeRootFive(timeline: TimelineEvent[], beatsPerBar: number, rng: () => number): NoteSpec[] {
  const out: NoteSpec[] = []
  for (let i = 0; i < timeline.length; i++) {
    const { ev, ct, nextCt, changeComing } = nextChangeInfo(timeline, i)
    const naiveFifth = ct.root + ct.fifth
    const fifthMidi = naiveFifth >= 48 ? ct.root - 5 : naiveFifth
    const totalBeats = ev.durationBeats
    const bars = Math.ceil(totalBeats / beatsPerBar)
    for (let barIdx = 0; barIdx < bars; barIdx++) {
      const barStart = barIdx * beatsPerBar
      const beatsInBar = Math.min(beatsPerBar, totalBeats - barStart)
      const isLastBarOfChord = barIdx === bars - 1
      const atBeat0 = ev.bar * beatsPerBar + ev.beat + barStart

      pushNote(out, ct.root, ct.root + ct.fifth, atBeat0, 1.9, 0.95)

      const hasBeat4 = beatsInBar > 3
      const approachEligible = isLastBarOfChord && changeComing && totalBeats >= 2 && hasBeat4
      const pushAndOf4 = hasBeat4 && rng() < 0.25

      if (beatsInBar > 2) {
        pushNote(out, fifthMidi, ct.root, atBeat0 + 2, 1.4, 0.75)
      }
      if (approachEligible && !pushAndOf4) {
        pushNote(out, approachNote(rng, nextCt.root), nextCt.root, atBeat0 + 3, 0.9, 0.7)
      }
      if (pushAndOf4) {
        const target = approachEligible ? nextCt.root : ct.root
        pushNote(out, target, ct.root, atBeat0 + 3.5, 0.4, 0.6)
      }
    }
  }
  return out
}

/* --------------------------------- pedal ---------------------------------- */

function arrangePedal(timeline: TimelineEvent[], beatsPerBar: number, rng: () => number): NoteSpec[] {
  const out: NoteSpec[] = []
  for (let i = 0; i < timeline.length; i++) {
    const { ev, ct, nextCt, changeComing } = nextChangeInfo(timeline, i)
    const bars = Math.ceil(ev.durationBeats / beatsPerBar)
    for (let barIdx = 0; barIdx < bars; barIdx++) {
      const barStart = barIdx * beatsPerBar
      const atBeat0 = ev.bar * beatsPerBar + ev.beat + barStart
      const isLastBar = barIdx === bars - 1

      pushNote(out, ct.root, ct.root + ct.fifth, atBeat0, beatsPerBar * 0.95, 0.9)

      if (isLastBar && changeComing && rng() < 0.5) {
        pushNote(out, nextCt.root, ct.root, atBeat0 + beatsPerBar - 0.5, 0.4, 0.65)
      }
    }
  }
  return out
}

/* --------------------------------- entry ----------------------------------- */

export function arrangeBass(
  timeline: TimelineEvent[],
  style: BassStyle,
  beatsPerBar: number,
  rng: () => number,
): NoteSpec[] {
  switch (style) {
    case 'walking':
      return arrangeWalking(timeline, beatsPerBar, rng)
    case 'boogie':
      return arrangeBoogie(timeline, beatsPerBar, rng)
    case 'rootFive':
      return arrangeRootFive(timeline, beatsPerBar, rng)
    case 'pedal':
      return arrangePedal(timeline, beatsPerBar, rng)
  }
}
