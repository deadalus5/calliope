/**
 * Pitch primitives. PitchClass is 0–11 (C=0). Midi numbers follow the
 * standard where A4 = 69 = 440Hz. Spelling (F# vs Gb) is chosen per key.
 */

export type PitchClass = number // 0..11, C = 0

export const PC = {
  C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11,
} as const

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Keys whose major (or relative-minor) signature spells with flats. */
const FLAT_KEYS = new Set<PitchClass>([PC.F, PC.As, PC.Ds, PC.Gs, PC.Cs])

export function normalizePc(n: number): PitchClass {
  return ((n % 12) + 12) % 12
}

export function midiToPc(midi: number): PitchClass {
  return normalizePc(midi)
}

/** Name a pitch class in the context of a key root (decides sharps vs flats). */
export function pcName(pc: PitchClass, keyRoot: PitchClass = PC.C): string {
  const names = FLAT_KEYS.has(normalizePc(keyRoot)) ? FLAT_NAMES : SHARP_NAMES
  return names[normalizePc(pc)]
}

/** Parse a note name like "C#", "Bb", "F" to a pitch class. */
export function parsePcName(name: string): PitchClass {
  const m = /^([A-Ga-g])([#b]*)$/.exec(name.trim())
  if (!m) throw new Error(`Bad note name: ${name}`)
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let pc = base[m[1].toUpperCase()]
  for (const acc of m[2]) pc += acc === '#' ? 1 : -1
  return normalizePc(pc)
}

export function midiToName(midi: number, keyRoot: PitchClass = PC.C): string {
  const octave = Math.floor(midi / 12) - 1
  return `${pcName(midiToPc(midi), keyRoot)}${octave}`
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function freqToMidiFloat(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
}

/** Nearest midi note plus cents offset from it. */
export function freqToNote(freq: number): { midi: number; cents: number } {
  const f = freqToMidiFloat(freq)
  const midi = Math.round(f)
  return { midi, cents: (f - midi) * 100 }
}
