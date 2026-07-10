import { degreeOf, type Degree } from './interval'
import { normalizePc, type PitchClass } from './note'
import {
  MAX_FRET, NUM_STRINGS, STANDARD_TUNING, coordToPc, type FretCoord,
} from './fretboard-geometry'
import { PENTATONIC_DEGREES, type PentatonicKind } from './scale'

/**
 * The five pentatonic positions ("boxes"), generated rather than hardcoded:
 * position k anchors on the low-E fret of the k-th scale tone; on every
 * string the box takes the two consecutive scale frets starting at the first
 * fret >= anchor - 1. This reproduces the standard box shapes in any key,
 * for both minor and major pentatonic.
 */

export interface PositionNote {
  coord: FretCoord
  degree: Degree
  isRoot: boolean
}

export interface PentatonicPosition {
  position: number // 1..5
  key: PitchClass
  kind: PentatonicKind
  notes: PositionNote[]
  minFret: number
  maxFret: number
}

function scaleFretsOnString(pcs: Set<PitchClass>, string: number, maxFret: number): number[] {
  const frets: number[] = []
  for (let f = 0; f <= maxFret; f++) {
    if (pcs.has(coordToPc({ string, fret: f }))) frets.push(f)
  }
  return frets
}

/** Low-E anchor frets for positions 1..5, ascending from the root. */
function anchorFrets(key: PitchClass, kind: PentatonicKind): number[] {
  const degrees = PENTATONIC_DEGREES[kind]
  const openPc = normalizePc(STANDARD_TUNING[0])
  const rootFret = normalizePc(key - openPc) // 0 is valid: open-position box (e.g. Em box 1)
  // Walk the five scale tones upward from the root fret on the low E string.
  const anchors: number[] = []
  let fret = rootFret
  anchors.push(fret)
  for (let i = 1; i < degrees.length; i++) {
    const step = normalizePc(degrees[i] - degrees[i - 1])
    fret += step
    anchors.push(fret)
  }
  return anchors
}

export function pentatonicPosition(
  key: PitchClass,
  kind: PentatonicKind,
  position: number, // 1..5
): PentatonicPosition {
  if (position < 1 || position > 5) throw new Error(`Position must be 1..5, got ${position}`)
  const degrees = PENTATONIC_DEGREES[kind]
  const pcs = new Set(degrees.map((d) => normalizePc(key + d)))
  let anchor = anchorFrets(key, kind)[position - 1]
  // Keep the box on the playable neck: shift down an octave if it runs high.
  while (anchor + 3 > MAX_FRET) anchor -= 12
  while (anchor < 0) anchor += 12

  const notes: PositionNote[] = []
  for (let s = 0; s < NUM_STRINGS; s++) {
    const frets = scaleFretsOnString(pcs, s, MAX_FRET + 12)
    const startIdx = frets.findIndex((f) => f >= anchor - 1)
    const pair = frets.slice(startIdx, startIdx + 2)
    for (const fret of pair) {
      const coord = { string: s, fret }
      const degree = degreeOf(coordToPc(coord), key)
      notes.push({ coord, degree, isRoot: degree === 0 })
    }
  }
  const allFrets = notes.map((n) => n.coord.fret)
  return {
    position, key, kind, notes,
    minFret: Math.min(...allFrets),
    maxFret: Math.max(...allFrets),
  }
}

export function allPositions(key: PitchClass, kind: PentatonicKind): PentatonicPosition[] {
  return [1, 2, 3, 4, 5].map((p) => pentatonicPosition(key, kind, p))
}

/** Every pentatonic note across the whole neck (the "all positions" view). */
export function fullNeck(key: PitchClass, kind: PentatonicKind, maxFret = MAX_FRET): PositionNote[] {
  const degrees = PENTATONIC_DEGREES[kind]
  const pcs = new Set(degrees.map((d) => normalizePc(key + d)))
  const notes: PositionNote[] = []
  for (let s = 0; s < NUM_STRINGS; s++) {
    for (const fret of scaleFretsOnString(pcs, s, maxFret)) {
      const coord = { string: s, fret }
      const degree = degreeOf(coordToPc(coord), key)
      notes.push({ coord, degree, isRoot: degree === 0 })
    }
  }
  return notes
}

/** Which position(s) a fret coordinate belongs to, if any. */
export function positionsContaining(
  coord: FretCoord, key: PitchClass, kind: PentatonicKind,
): number[] {
  return allPositions(key, kind)
    .filter((p) => p.notes.some((n) => n.coord.string === coord.string && n.coord.fret === coord.fret))
    .map((p) => p.position)
}
