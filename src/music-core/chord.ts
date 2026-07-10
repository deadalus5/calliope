import { degreeLabel, type Degree } from './interval'
import { normalizePc, parsePcName, pcName, type PitchClass } from './note'

/**
 * Chord spelling, parsing, and identification. Qualities are interval sets
 * above the root. Slash chords carry an independent bass pitch class — the
 * app teaches them as "a triad over a bass note you can already name".
 */

export interface ChordQuality {
  id: string
  /** Suffix as written in symbols, e.g. '' for major, 'm7', '7#9'. */
  suffix: string
  intervals: Degree[]
  displayName: string
}

// Order matters for identification: earlier = preferred name for the same pcs.
export const QUALITIES: ChordQuality[] = [
  { id: 'maj', suffix: '', intervals: [0, 4, 7], displayName: 'major' },
  { id: 'min', suffix: 'm', intervals: [0, 3, 7], displayName: 'minor' },
  { id: 'dim', suffix: 'dim', intervals: [0, 3, 6], displayName: 'diminished' },
  { id: 'aug', suffix: 'aug', intervals: [0, 4, 8], displayName: 'augmented' },
  { id: 'sus4', suffix: 'sus4', intervals: [0, 5, 7], displayName: 'sus4' },
  { id: 'sus2', suffix: 'sus2', intervals: [0, 2, 7], displayName: 'sus2' },
  { id: 'maj7', suffix: 'maj7', intervals: [0, 4, 7, 11], displayName: 'major 7' },
  { id: 'min7', suffix: 'm7', intervals: [0, 3, 7, 10], displayName: 'minor 7' },
  { id: 'dom7', suffix: '7', intervals: [0, 4, 7, 10], displayName: 'dominant 7' },
  { id: 'm7b5', suffix: 'm7b5', intervals: [0, 3, 6, 10], displayName: 'half-diminished' },
  { id: 'dim7', suffix: 'dim7', intervals: [0, 3, 6, 9], displayName: 'diminished 7' },
  { id: 'minMaj7', suffix: 'mMaj7', intervals: [0, 3, 7, 11], displayName: 'minor-major 7' },
  { id: '6', suffix: '6', intervals: [0, 4, 7, 9], displayName: 'major 6' },
  { id: 'm6', suffix: 'm6', intervals: [0, 3, 7, 9], displayName: 'minor 6' },
  { id: 'add9', suffix: 'add9', intervals: [0, 2, 4, 7], displayName: 'add 9' },
  { id: 'madd9', suffix: 'madd9', intervals: [0, 2, 3, 7], displayName: 'minor add 9' },
  { id: '7sus4', suffix: '7sus4', intervals: [0, 5, 7, 10], displayName: '7 sus4' },
  { id: 'maj9', suffix: 'maj9', intervals: [0, 2, 4, 7, 11], displayName: 'major 9' },
  { id: 'min9', suffix: 'm9', intervals: [0, 2, 3, 7, 10], displayName: 'minor 9' },
  { id: 'dom9', suffix: '9', intervals: [0, 2, 4, 7, 10], displayName: 'dominant 9' },
  { id: '9sus4', suffix: '9sus4', intervals: [0, 2, 5, 7, 10], displayName: '9 sus4' },
  { id: 'min11', suffix: 'm11', intervals: [0, 2, 3, 5, 7, 10], displayName: 'minor 11' },
  { id: '13', suffix: '13', intervals: [0, 2, 4, 7, 9, 10], displayName: 'dominant 13' },
  { id: '7#9', suffix: '7#9', intervals: [0, 3, 4, 7, 10], displayName: '7 sharp 9 (Hendrix)' },
  { id: '7b9', suffix: '7b9', intervals: [0, 1, 4, 7, 10], displayName: '7 flat 9' },
  { id: 'maj7no5', suffix: 'maj7(no5)', intervals: [0, 4, 11], displayName: 'major 7 (no 5)' },
  { id: '5', suffix: '5', intervals: [0, 7], displayName: 'power chord' },
]

const QUALITY_BY_ID = new Map(QUALITIES.map((q) => [q.id, q]))
// Longest suffix first so 'maj9' wins over 'maj7' etc. when parsing.
const QUALITIES_BY_SUFFIX = [...QUALITIES].sort((a, b) => b.suffix.length - a.suffix.length)

export function qualityById(id: string): ChordQuality {
  const q = QUALITY_BY_ID.get(id)
  if (!q) throw new Error(`Unknown chord quality: ${id}`)
  return q
}

export interface Chord {
  root: PitchClass
  quality: ChordQuality
  /** Bass pitch class if different from root (slash chord). */
  bass?: PitchClass
}

export function chord(rootName: string, qualityId: string, bassName?: string): Chord {
  const c: Chord = { root: parsePcName(rootName), quality: qualityById(qualityId) }
  if (bassName !== undefined) {
    const bass = parsePcName(bassName)
    if (bass !== c.root) c.bass = bass
  }
  return c
}

/** Pitch classes of the chord, root first (bass not included unless in chord). */
export function chordPcs(c: Chord): PitchClass[] {
  return c.quality.intervals.map((i) => normalizePc(c.root + i))
}

export function chordBass(c: Chord): PitchClass {
  return c.bass ?? c.root
}

export function chordSymbol(c: Chord, keyRoot: PitchClass = c.root): string {
  const base = `${pcName(c.root, keyRoot)}${c.quality.suffix}`
  return c.bass !== undefined ? `${base}/${pcName(c.bass, keyRoot)}` : base
}

/** Parse symbols like "Am7", "C/E", "F#m7b5", "Bb13", "D/F#". */
export function parseChordSymbol(symbol: string): Chord {
  const [main, bassPart] = symbol.trim().split('/')
  const m = /^([A-Ga-g][#b]*)(.*)$/.exec(main.trim())
  if (!m) throw new Error(`Bad chord symbol: ${symbol}`)
  const root = parsePcName(m[1])
  const suffix = m[2].trim()
  const quality = QUALITIES_BY_SUFFIX.find((q) => q.suffix === suffix)
  if (!quality) throw new Error(`Unknown chord suffix "${suffix}" in ${symbol}`)
  const c: Chord = { root, quality }
  if (bassPart) {
    const bass = parsePcName(bassPart)
    if (bass !== root) c.bass = bass
  }
  return c
}

export interface ChordIdentification {
  chord: Chord
  symbol: string
  /** True when the match required treating the bass as a non-chord tone. */
  exact: boolean
}

/**
 * Name a set of pitch classes (with a known bass) — used by the slash-chord
 * builder and upper-structure explorer to answer "what did I just build?".
 * Tries every pc as a potential root; prefers roots that equal the bass,
 * then earlier (more common) qualities, then fewer notes of difference.
 */
export function identifyChord(pcs: PitchClass[], bass: PitchClass): ChordIdentification[] {
  const set = new Set(pcs.map(normalizePc))
  if (!set.has(normalizePc(bass))) set.add(normalizePc(bass))
  const target = [...set].sort((a, b) => a - b).join(',')
  const results: ChordIdentification[] = []
  for (const root of set) {
    for (const q of QUALITIES) {
      const qPcs = [...new Set(q.intervals.map((i) => normalizePc(root + i)))]
        .sort((a, b) => a - b).join(',')
      if (qPcs === target) {
        const c: Chord = { root, quality: q }
        if (normalizePc(bass) !== root) c.bass = normalizePc(bass)
        results.push({ chord: c, symbol: chordSymbol(c), exact: true })
      }
    }
  }
  // Root-on-bass names first, then common-quality order.
  results.sort((a, b) => {
    const aBass = a.chord.root === normalizePc(bass) ? 0 : 1
    const bBass = b.chord.root === normalizePc(bass) ? 0 : 1
    if (aBass !== bBass) return aBass - bBass
    return QUALITIES.indexOf(a.chord.quality) - QUALITIES.indexOf(b.chord.quality)
  })
  return results
}

/** Degree labels of chord tones relative to a key (for fretboard overlays). */
export function chordToneDegrees(c: Chord, keyRoot: PitchClass): { pc: PitchClass; label: string }[] {
  return chordPcs(c).map((pc) => ({ pc, label: degreeLabel(normalizePc(pc - keyRoot)) }))
}
