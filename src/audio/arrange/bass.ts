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
  /** Un-folded foundation midi, 36 + normalizePc(bassPc); always in [36,47]. */
  root: number
  /**
   * Semitones from the bass foundation UP to the actual chord root — 0 for
   * root-position chords, nonzero for slash chords. quality.intervals are
   * relative to chord.root, so every tone offset below already includes it
   * (e.g. D/C: third = 2 + 4 = 6, landing on F# above the C bass, not E).
   */
  rootOffset: number
  /** Offset from `root` to the chord's third (pc-correct for slash chords). */
  third: number
  /** Offset from `root` to the chord's fifth (pc-correct for slash chords). */
  fifth: number
  /** Offset from `root` to the sixth-or-seventh color tone — the bug-fix slot. */
  sixthOrSeventh: number
  /** True when the quality is minor-third (has 3, not 4) — drives boogie's 6-vs-b7. */
  minorThird: boolean
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
  const rawThird = findThird(intervals)
  const rawFifth = findFifth(intervals)
  const rawSixthOrSeventh = findSixthOrSeventh(intervals, rawThird)
  const bassPc = chordBass(ev.chord)
  const rootOffset = normalizePc(ev.chord.root - bassPc)
  const root = 36 + normalizePc(bassPc)
  return {
    bassPc,
    root,
    rootOffset,
    third: rootOffset + rawThird,
    fifth: rootOffset + rawFifth,
    sixthOrSeventh: rootOffset + rawSixthOrSeventh,
    minorThird: intervals.includes(3) && !intervals.includes(4),
  }
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
    const bars = Math.ceil(ev.durationBeats / beatsPerBar)

    // Scalar passing tones must not land on the pcs the bug fix banned:
    // over a minor chord, never the major third, and never the major 6th
    // unless the quality actually contains interval 9.
    const chordRootPc = normalizePc(ct.root + ct.rootOffset)
    const clashes = (m: number): boolean => {
      if (!ct.minorThird) return false
      const rel = normalizePc(m - chordRootPc)
      return rel === 4 || (rel === 9 && !ev.chord.quality.intervals.includes(9))
    }

    // Decide every bar's downbeat UP FRONT so scalar bars can aim at a real
    // target instead of leading a half-step into a note that then lands
    // somewhere else (the unresolved-leading-tone bug).
    const downbeats: number[] = [foldBass(ct.root)]
    for (let barIdx = 1; barIdx < bars; barIdx++) {
      downbeats.push(foldBass(rng() < 0.6 ? ct.root : ct.root + ct.fifth))
    }

    for (let barIdx = 0; barIdx < bars; barIdx++) {
      const barStart = barIdx * beatsPerBar
      const beatsInBar = Math.min(beatsPerBar, ev.durationBeats - barStart)
      const atBeat0 = ev.bar * beatsPerBar + ev.beat + barStart

      pushNote(out, downbeats[barIdx], ct.root + ct.fifth, atBeat0, 0.9, 0.95)
      let cur = out[out.length - 1].midis[0]

      const shapeSkip = rng() < 0.5
      const shapeAsc = rng() < 0.5
      // The strong beat this bar walks toward: next bar's (pre-rolled)
      // downbeat, or the next chord's entry root at the end of the chord.
      // This is the EXACT midi that strong beat will play — the scalar line
      // must resolve into it, not into another octave of it.
      const target = barIdx + 1 < bars ? downbeats[barIdx + 1] : foldBass(nextCt.root)
      const isChordEnd = barIdx === bars - 1
      const lastMiddlePos = beatsInBar - 1 - (isChordEnd && changeComing ? 1 : 0)

      for (let barPos = 1; barPos < beatsInBar; barPos++) {
        const b = barStart + barPos
        const atBeat = atBeat0 + barPos
        const isLastBeatOfChord = b === ev.durationBeats - 1
        let midi: number
        let alt: number
        if (isLastBeatOfChord && changeComing) {
          midi = approachNote(rng, nextCt.root)
          alt = nextCt.root
        } else if (shapeSkip) {
          const idx = (barPos - 1) % toneCycle.length
          midi = ct.root + toneCycle[shapeAsc ? idx : toneCycle.length - 1 - idx]
          alt = ct.root + ct.fifth
        } else {
          // Scalar/enclosure motion toward the decided target: steps of 1–2
          // semitones, closing with a neighbor tone (target±1) so the line
          // resolves by step into the downbeat it was aiming at.
          const slotsLeft = lastMiddlePos - barPos + 1
          if (slotsLeft <= 1) {
            const side = cur > target ? 1 : cur < target ? -1 : rng() < 0.5 ? 1 : -1
            midi = target + side
            if (midi > 55 || midi < 28 || clashes(midi)) midi = target - side
          } else {
            const dist = target - cur
            const sign = dist === 0 ? (rng() < 0.5 ? 1 : -1) : Math.sign(dist)
            const mag = Math.max(1, Math.min(2, Math.abs(Math.round(dist / slotsLeft))))
            midi = cur + sign * mag
            if (clashes(midi)) midi += sign // pass over the banned pc
            if (midi > 55 || midi < 28) {
              midi = cur - sign * mag
              if (clashes(midi)) midi -= sign
            }
          }
          alt = ct.root + ct.fifth
        }
        pushNote(out, midi, alt, atBeat, 0.9, 0.8 + (rng() - 0.5) * 0.04)
        cur = out[out.length - 1].midis[0]
        if ((barPos === 1 || barPos === 3) && rng() < 0.3) pushGhost(out, atBeat + 0.5)
      }
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
    // seventh/sixth are intervals above the CHORD ROOT, so they carry the
    // slash-chord rootOffset just like third/fifth do.
    const seventh = ct.rootOffset + (ev.chord.quality.intervals.includes(11) ? 11 : 10)
    // The classic boogie "6" passing tone is a literal major 6th over
    // major/dominant chords (the shuffle sound) — but NOT over a minor
    // chord, where that would reintroduce the exact bug this task fixes.
    // Over minor chords we reuse the bug-fixed sixthOrSeventh tone instead.
    const sixthTone = ct.minorThird ? ct.sixthOrSeventh : ct.rootOffset + 9
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
    // Drop the alternating fifth an octave (same pitch class — root−5 would
    // be wrong for slash chords) when it would sit in the guitar register.
    const naiveFifth = ct.root + ct.fifth
    const fifthMidi = naiveFifth >= 48 ? naiveFifth - 12 : naiveFifth
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
