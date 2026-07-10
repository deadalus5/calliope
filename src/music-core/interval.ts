import { normalizePc, type PitchClass } from './note'

/**
 * A Degree is a position relative to the key root, measured in semitones
 * (0–11). Degrees — not letter names — are the app's primary vocabulary,
 * because they are what the ear hears. The label for 6 semitones is
 * context-dependent (#4 in Lydian, b5 in blues), so labels can be overridden.
 */
export type Degree = number // 0..11 semitones above the root

export const DEGREE_LABELS: Record<Degree, string> = {
  0: '1', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4',
  6: 'b5', 7: '5', 8: 'b6', 9: '6', 10: 'b7', 11: '7',
}

/** Friendly names used in prompts and lesson copy. */
export const DEGREE_NAMES: Record<Degree, string> = {
  0: 'root', 1: 'flat two', 2: 'two', 3: 'flat three (minor third)', 4: 'three (major third)',
  5: 'four', 6: 'flat five (blue note)', 7: 'five', 8: 'flat six', 9: 'six',
  10: 'flat seven', 11: 'major seven',
}

export function degreeLabel(deg: Degree, override?: Record<Degree, string>): string {
  return override?.[normalizePc(deg)] ?? DEGREE_LABELS[normalizePc(deg)]
}

/** Semitone distance from key root to a pitch class, as a Degree. */
export function degreeOf(pc: PitchClass, keyRoot: PitchClass): Degree {
  return normalizePc(pc - keyRoot)
}

/** Pitch class of a degree in a key. */
export function pcOfDegree(deg: Degree, keyRoot: PitchClass): PitchClass {
  return normalizePc(keyRoot + deg)
}
