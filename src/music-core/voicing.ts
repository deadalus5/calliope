import { normalizePc, type PitchClass } from './note'
import { chordPcs, type Chord } from './chord'
import { STANDARD_TUNING, type FretCoord } from './fretboard-geometry'

/**
 * Close-voiced triad grips on adjacent string sets — the Triad Atlas's raw
 * material. A grip is three frets on three adjacent strings whose pitches
 * are the triad tones stacked in close position (each note is the next
 * chord tone above the last). Grouped by inversion = which chord tone is
 * lowest: 0 root position, 1 first inversion (3rd low), 2 second (5th low).
 */

export type StringSet = 0 | 1 | 2 | 3 // lowest string of the set: 0=EAD 1=ADG 2=DGB 3=GBe

export const STRING_SET_NAMES: Record<StringSet, string> = {
  0: 'E–A–D (6-5-4)', 1: 'A–D–G (5-4-3)', 2: 'D–G–B (4-3-2)', 3: 'G–B–e (3-2-1)',
}

export interface TriadGrip {
  chordRoot: PitchClass
  stringSet: StringSet
  /** 0 = root position, 1 = 1st inversion, 2 = 2nd inversion. */
  inversion: number
  coords: [FretCoord, FretCoord, FretCoord] // low string → high string
  /** Pitch class per coord, same order. */
  pcs: [PitchClass, PitchClass, PitchClass]
  minFret: number
  maxFret: number
}

const MAX_GRIP_SPAN = 4
const MAX_GRIP_FRET = 16

/**
 * All close-position grips of a (3-note) chord on one string set, sorted by
 * position on the neck. Works for any 3-pc chord (triads, sus shapes).
 */
export function triadGrips(c: Chord, stringSet: StringSet): TriadGrip[] {
  const tones = [...new Set(chordPcs(c).map(normalizePc))]
  if (tones.length !== 3) throw new Error(`triadGrips needs a 3-note chord, got ${tones.length}`)
  const strings = [stringSet, stringSet + 1, stringSet + 2]
  const grips: TriadGrip[] = []

  for (let f0 = 0; f0 <= MAX_GRIP_FRET; f0++) {
    const pc0 = normalizePc(STANDARD_TUNING[strings[0]] + f0)
    if (!tones.includes(pc0)) continue
    const midi0 = STANDARD_TUNING[strings[0]] + f0
    // Close position: each next note is the nearest chord tone strictly above.
    const midis = [midi0]
    let ok = true
    for (let i = 1; i < 3; i++) {
      let next = midis[i - 1] + 1
      while (!tones.includes(normalizePc(next))) next++
      const fret = next - STANDARD_TUNING[strings[i]]
      if (fret < 0 || fret > MAX_GRIP_FRET) { ok = false; break }
      midis.push(next)
    }
    if (!ok) continue
    const coords = midis.map((m, i) => ({
      string: strings[i], fret: m - STANDARD_TUNING[strings[i]],
    })) as [FretCoord, FretCoord, FretCoord]
    const frets = coords.map((c) => c.fret)
    if (Math.max(...frets) - Math.min(...frets) > MAX_GRIP_SPAN) continue
    const pcs = midis.map(normalizePc) as [PitchClass, PitchClass, PitchClass]
    const rootPc = normalizePc(c.root)
    const thirdPc = normalizePc(chordPcs(c)[1])
    const inversion = pcs[0] === rootPc ? 0 : pcs[0] === thirdPc ? 1 : 2
    grips.push({
      chordRoot: rootPc, stringSet, inversion, coords, pcs,
      minFret: Math.min(...frets), maxFret: Math.max(...frets),
    })
  }
  grips.sort((a, b) => a.minFret - b.minFret)
  return grips
}

/** Grips of a chord across every string set. */
export function allTriadGrips(c: Chord): TriadGrip[] {
  return ([0, 1, 2, 3] as StringSet[]).flatMap((s) => triadGrips(c, s))
}

/**
 * The "shatter" mapping: which grips live inside a barre-chord region.
 * Given the barre root fret on the low E (E-shape) or A (A-shape) string,
 * returns grips of the same chord within that fret neighborhood.
 */
export function gripsNearFret(c: Chord, centerFret: number, radius = 3): TriadGrip[] {
  return allTriadGrips(c).filter(
    (g) => g.minFret >= centerFret - radius && g.maxFret <= centerFret + radius + 1,
  )
}
