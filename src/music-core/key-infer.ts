import { chordPcs, type Chord } from './chord'
import { degreeOf } from './interval'
import { normalizePc, parsePcName, type PitchClass } from './note'
import { MODES, modeDegrees, type ModeSpec } from './scale'

/**
 * Key + mode inference from a chord list, in the app's own framing: the
 * answer is a pentatonic skeleton plus color degrees (a ModeSpec), never
 * "the relative major/minor of...". Used by the Song Map pipeline to decide
 * what the fretboard's skeleton layer should be for a real record.
 *
 * Evidence fused: (1) duration-weighted diatonic fit of every chord against
 * each candidate root × mode, (2) what starts and ends sections (tonic
 * gravity), (3) an optional Ultimate Guitar tonality as a prior — a bump,
 * never a veto, because UG sometimes reports the capo shape key.
 */

export interface WeightedChord {
  chord: Chord
  /** How long this chord sounds, in beats (or any consistent unit). */
  weightBeats: number
  sectionStart?: boolean
  sectionEnd?: boolean
}

export interface KeyInferInput {
  chords: WeightedChord[]
}

export interface KeyInferHints {
  /** UG tonality_name, e.g. 'Am', 'Bb', 'F#m' — as written on the sheet. */
  tonalityName?: string | null
  /** Capo fret from the same sheet. The sheet's shapes sound `capo`
   * semitones higher, so the hinted root is normalized to concert pitch. */
  capo?: number
}

export interface SongKeyResult {
  root: PitchClass
  modeId: string
  skeleton: 'minor' | 'major'
  confidence: number // 0..1
}

/** Weight of the section-boundary tonic bonus relative to one beat of fit. */
const TONIC_BONUS_BEATS = 4
/** Prior bump for the UG-hinted root, in beats of fit. */
const HINT_BONUS_BEATS = 6
/** Extra when the hint's major/minor also matches the mode's skeleton. */
const HINT_SKELETON_BONUS_BEATS = 3

/** Parse 'Am' / 'Bb' / 'F#m' into a concert-pitch root + minor flag. */
export function parseTonality(name: string, capo = 0): { root: PitchClass; minor: boolean } | null {
  const m = /^([A-Ga-g][#b]*)\s*(m|min|minor)?$/.exec(name.trim())
  if (!m) return null
  try {
    return { root: normalizePc(parsePcName(m[1]) + capo), minor: m[2] !== undefined }
  } catch {
    return null
  }
}

/** Duration-weighted fraction of chord tones inside the mode, plus boundary
 * tonic gravity. Exported for the per-section second pass. */
export function fitScore(input: KeyInferInput, root: PitchClass, mode: ModeSpec): number {
  const inMode = new Set(modeDegrees(mode))
  let score = 0
  for (const wc of input.chords) {
    const pcs = chordPcs(wc.chord)
    let hits = 0
    for (const pc of pcs) if (inMode.has(degreeOf(pc, root))) hits++
    score += wc.weightBeats * (hits / pcs.length)
    if ((wc.sectionStart || wc.sectionEnd) && wc.chord.root === root) {
      score += TONIC_BONUS_BEATS * (wc.sectionStart && wc.sectionEnd ? 2 : 1)
      // A tonic whose third agrees with the skeleton is stronger evidence.
      const third = wc.chord.quality.intervals.includes(3) ? 'minor'
        : wc.chord.quality.intervals.includes(4) ? 'major' : null
      if (third === mode.skeleton) score += TONIC_BONUS_BEATS / 2
    }
  }
  return score
}

/**
 * Best root × ModeSpec for a chord list. Confidence reflects the margin over
 * the best differently-rooted candidate (mode siblings on the same root are
 * near-ties by construction and shouldn't tank confidence).
 */
export function inferKey(input: KeyInferInput, hints?: KeyInferHints): SongKeyResult {
  const hint = hints?.tonalityName ? parseTonality(hints.tonalityName, hints.capo ?? 0) : null
  let best: { root: PitchClass; mode: ModeSpec; score: number } | null = null
  const bestPerRoot = new Map<PitchClass, number>()

  for (let root = 0 as PitchClass; root < 12; root++) {
    for (const mode of MODES) {
      let score = fitScore(input, root, mode)
      if (hint && hint.root === root) {
        score += HINT_BONUS_BEATS
        const hintSkeleton = hint.minor ? 'minor' : 'major'
        if (mode.skeleton === hintSkeleton) score += HINT_SKELETON_BONUS_BEATS
      }
      const perRoot = bestPerRoot.get(root)
      if (perRoot === undefined || score > perRoot) bestPerRoot.set(root, score)
      if (!best || score > best.score) best = { root, mode, score }
    }
  }

  // best is always set: MODES is non-empty.
  const b = best!
  let runnerUp = 0
  for (const [root, score] of bestPerRoot) {
    if (root !== b.root && score > runnerUp) runnerUp = score
  }
  const confidence = b.score <= 0 ? 0 : Math.max(0, Math.min(1, (b.score - runnerUp) / b.score + 0.5))

  return { root: b.root, modeId: b.mode.id, skeleton: b.mode.skeleton, confidence }
}

/**
 * Per-section keys, for bridges that modulate. Returns one entry per input
 * section: null when the section agrees with the whole-song key, or an
 * override when its own best key clearly beats the whole-song key on its own
 * chords. Deliberately conservative — a false modulation flips the whole
 * fretboard mid-song.
 */
export function inferSectionKeys(perSection: KeyInferInput[], whole: SongKeyResult): (SongKeyResult | null)[] {
  const wholeMode = MODES.find((m) => m.id === whole.modeId) ?? MODES[0]
  return perSection.map((section) => {
    const totalBeats = section.chords.reduce((s, c) => s + c.weightBeats, 0)
    if (section.chords.length < 2 || totalBeats < 8) return null
    const own = inferKey(section)
    if (own.root === whole.root) return null
    const wholeScore = fitScore(section, whole.root, wholeMode)
    const ownScore = fitScore(section, own.root, MODES.find((m) => m.id === own.modeId) ?? MODES[0])
    return ownScore > wholeScore * 1.15 ? own : null
  })
}
