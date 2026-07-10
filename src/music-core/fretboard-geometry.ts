import { midiToPc, normalizePc, type PitchClass } from './note'

/**
 * Fretboard geometry for standard tuning. Strings are indexed 0 = low E
 * through 5 = high E (matching the tuning array); `displayString` gives the
 * guitarist's 6..1 numbering.
 */

export const STANDARD_TUNING: readonly number[] = [40, 45, 50, 55, 59, 64] // E2 A2 D3 G3 B3 E4
export const NUM_STRINGS = 6
export const MAX_FRET = 17

export interface FretCoord {
  string: number // 0 = low E .. 5 = high E
  fret: number // 0 = open
}

export function coordToMidi({ string, fret }: FretCoord): number {
  return STANDARD_TUNING[string] + fret
}

export function coordToPc(coord: FretCoord): PitchClass {
  return midiToPc(coordToMidi(coord))
}

export function displayString(string: number): number {
  return 6 - string
}

/** All frets (0..maxFret) on a string where a pitch class sounds. */
export function fretsForPcOnString(pc: PitchClass, string: number, maxFret = MAX_FRET): number[] {
  const open = midiToPc(STANDARD_TUNING[string])
  const first = normalizePc(pc - open)
  const frets: number[] = []
  for (let f = first; f <= maxFret; f += 12) frets.push(f)
  return frets
}

/** Every location of a pitch class on the whole neck. */
export function coordsForPc(pc: PitchClass, maxFret = MAX_FRET): FretCoord[] {
  const out: FretCoord[] = []
  for (let s = 0; s < NUM_STRINGS; s++) {
    for (const fret of fretsForPcOnString(pc, s, maxFret)) out.push({ string: s, fret })
  }
  return out
}

/** Every location of an exact midi note (usually 0–2 places). */
export function coordsForMidi(midi: number, maxFret = MAX_FRET): FretCoord[] {
  const out: FretCoord[] = []
  for (let s = 0; s < NUM_STRINGS; s++) {
    const fret = midi - STANDARD_TUNING[s]
    if (fret >= 0 && fret <= maxFret) out.push({ string: s, fret })
  }
  return out
}
