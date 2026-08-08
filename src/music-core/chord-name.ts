import { QUALITIES, chordSymbol, type Chord, type ChordQuality } from './chord'
import { degreeLabel, degreeOf, type Degree } from './interval'
import { normalizePc, pcName, type PitchClass } from './note'

/**
 * Tolerant, always-answers chord naming for the Chord Finder view. The user
 * taps notes on the board and after every tap gets a reading: one note is a
 * note name, two are an interval up from the bass, three or more become
 * ranked chord candidates. Everything is matched as degrees from each
 * candidate root (1, b3, 5, b7 ...), and real-grip liberties — a dropped
 * 5th, an added color tone, a bass note under the grip — are scored, not
 * rejected. Sits beside chord.ts's exact-set identifyChord, which stays
 * strict for its existing consumers.
 */

export interface ChordCandidate {
  /** Bass is set when it differs from the root (slash naming). */
  chord: Chord
  symbol: string
  /** Degrees (from the candidate root) sounding beyond the base quality. */
  additions: Degree[]
  /** Base-quality degrees not sounding; only ever the omittable 5th/9th. */
  omissions: Degree[]
  exact: boolean
  /** Higher = better; the list arrives sorted descending. */
  score: number
}

export interface Identification {
  kind: 'empty' | 'note' | 'interval' | 'chord'
  noteName?: string
  intervalLabel?: string
  candidates: ChordCandidate[]
}

const INTERVAL_NAMES: Record<Degree, string> = {
  0: 'a unison',
  1: 'a minor second',
  2: 'a major second',
  3: 'a minor third',
  4: 'a major third',
  5: 'a perfect fourth',
  6: 'a tritone',
  7: 'a perfect fifth',
  8: 'a minor sixth',
  9: 'a major sixth',
  10: 'a minor seventh',
  11: 'a major seventh',
}

const MAX_CANDIDATES = 8

export function identifyNotes(pcs: PitchClass[], bass?: PitchClass): Identification {
  const notes: PitchClass[] = []
  for (const p of pcs) {
    const n = normalizePc(p)
    if (!notes.includes(n)) notes.push(n)
  }
  if (notes.length === 0) return { kind: 'empty', candidates: [] }

  let bassPc = bass === undefined ? notes[0] : normalizePc(bass)
  if (!notes.includes(bassPc)) bassPc = notes[0]

  if (notes.length === 1) {
    return { kind: 'note', noteName: pcName(notes[0], notes[0]), candidates: [] }
  }

  const candidates = rankCandidates(notes, bassPc)
  if (notes.length === 2) {
    const other = notes[0] === bassPc ? notes[1] : notes[0]
    const deg = degreeOf(other, bassPc)
    return {
      kind: 'interval',
      intervalLabel: `${INTERVAL_NAMES[deg]} (${degreeLabel(deg)})`,
      candidates,
    }
  }
  return { kind: 'chord', candidates }
}

function rankCandidates(notes: PitchClass[], bass: PitchClass): ChordCandidate[] {
  const out: ChordCandidate[] = []
  for (const root of notes) {
    const rel = new Set<Degree>(notes.map((p) => degreeOf(p, root)))
    for (let qi = 0; qi < QUALITIES.length; qi++) {
      const cand = matchQuality(root, QUALITIES[qi], qi, rel, bass)
      if (cand) out.push(cand)
    }
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, MAX_CANDIDATES)
}

/** Mirrors chord-shapes' requiredDegrees rule: grips may drop the 5th on
 * 4+-note qualities and the 9th on 6-note qualities; nothing else. */
function omittable(q: ChordQuality): Degree[] {
  const drop: Degree[] = []
  if (q.intervals.length >= 4) drop.push(7)
  if (q.intervals.length >= 6) drop.push(2)
  return drop
}

function matchQuality(
  root: PitchClass,
  q: ChordQuality,
  qIndex: number,
  rel: Set<Degree>,
  bass: PitchClass,
): ChordCandidate | null {
  const slash = bass !== root
  const bassDeg = degreeOf(bass, root)
  const bassIsTone = q.intervals.includes(bassDeg)

  // A non-chord-tone bass is explained by the slash: it neither matches nor
  // counts as an addition.
  const match = new Set(rel)
  if (slash && !bassIsTone) match.delete(bassDeg)

  const missing = q.intervals.filter((i) => !match.has(i))
  const extras = [...match].filter((d) => !q.intervals.includes(d)).sort((a, b) => a - b)
  const drop = omittable(q)
  if (missing.some((m) => !drop.includes(m))) return null
  if (extras.length > 2) return null

  const c: Chord = slash ? { root, quality: q, bass } : { root, quality: q }
  const exact = missing.length === 0 && extras.length === 0 && bassIsTone

  let score = 100 - 15 * extras.length - 5 * missing.length - 0.4 * qIndex
  if (!slash) score += 12
  // Slash over a chord tone reads easy; over a non-tone it fights simpler
  // same-set names (Bsus4/C must not outrank Cmaj7(#11)).
  score += bassIsTone ? 5 : -12
  if (exact) score += 3

  return {
    chord: c,
    symbol: buildSymbol(c, extras),
    additions: extras,
    omissions: missing,
    exact,
    score,
  }
}

function buildSymbol(c: Chord, extras: Degree[]): string {
  const plain = chordSymbol(c)
  if (extras.length === 0) return plain
  const paren = `(${extras.map((d) => additionLabel(d, c.quality)).join(',')})`
  const slashAt = plain.indexOf('/')
  return slashAt === -1 ? plain + paren : plain.slice(0, slashAt) + paren + plain.slice(slashAt)
}

function additionLabel(deg: Degree, q: ChordQuality): string {
  switch (normalizePc(deg)) {
    case 1: return 'b9'
    case 2: return '9'
    case 3: return q.intervals.includes(4) ? '#9' : 'b3'
    case 5: return '11'
    case 6: return q.intervals.includes(7) || q.intervals.includes(4) ? '#11' : 'b5'
    case 8: return 'b13'
    case 9: return '13'
    case 11: return 'maj7'
    default: return degreeLabel(deg)
  }
}
