import { qualityById } from './chord'
import { normalizePc, PC, type PitchClass } from './note'
import { coordToPc, displayString, fretsForPcOnString, NUM_STRINGS } from './fretboard-geometry'
import {
  curatedShapes, MAX_SHAPE_FRET, MUTED_OFFSET, SHAPE_TEMPLATES,
  shapeFromFrets, type ChordShape, type ShapeTemplate,
} from './chord-shapes'

/**
 * Voicing engine: every playable grip for a chord, anchored the way the user
 * navigates — root note on a string he can name (low E, A, ...), everything
 * above it a scale degree of the chord. Generated shapes guarantee coverage
 * for every quality; curated grips are merged in and win ties, and an ease
 * ranking puts the shapes a blues/soul guitarist would actually grab first.
 */

export interface VoicingQuery {
  root: PitchClass
  qualityId: string
  rootString?: number
  nearFret?: number
}

const memo = new Map<string, ChordShape[]>()

/**
 * Enumerate playable shapes with the root on `rootString` (all six root
 * strings when undefined). A shape is a 4-fret window [b, b+3] where each
 * string is muted, open on a chord tone, or fretted on a chord tone; it must
 * sound every required degree, use at least 3 strings (2 for power chords),
 * skip at most one string mid-shape, and fit in 4 fingers — where all notes
 * on the lowest fretted fret count as one finger only if they can be barred,
 * i.e. no open string sits inside the barre span.
 */
export function generateVoicings(root: PitchClass, qualityId: string, rootString?: number): ChordShape[] {
  const rootPc = normalizePc(root)
  const key = `${rootPc}|${qualityId}|${rootString ?? 'all'}`
  const hit = memo.get(key)
  if (hit !== undefined) return hit

  const quality = qualityById(qualityId)
  const pcSet = new Set(quality.intervals.map((i) => normalizePc(rootPc + i)))
  const minSounding = quality.intervals.length === 2 ? 2 : 3
  const rsList = rootString === undefined ? [0, 1, 2, 3, 4, 5] : [rootString]
  const out: ChordShape[] = []
  const seen = new Set<string>()

  for (const rs of rsList) {
    const label = `root-${displayString(rs)}`
    const rootFrets = fretsForPcOnString(rootPc, rs, MAX_SHAPE_FRET)
    for (let b = 0; b <= 12; b++) {
      const rootOpts = rootFrets.filter((f) => f === 0 || (f >= b && f <= b + 3))
      if (rootOpts.length === 0) continue

      const options: number[][] = []
      for (let s = 0; s < NUM_STRINGS; s++) {
        if (s < rs) { options.push([-1]); continue }
        if (s === rs) { options.push(rootOpts); continue }
        const opts = [-1]
        if (pcSet.has(coordToPc({ string: s, fret: 0 }))) opts.push(0)
        for (let f = Math.max(b, 1); f <= b + 3; f++) {
          if (pcSet.has(coordToPc({ string: s, fret: f }))) opts.push(f)
        }
        options.push(opts)
      }

      const frets = new Array<number>(NUM_STRINGS).fill(-1)
      const walk = (s: number) => {
        if (s === NUM_STRINGS) { consider(frets) ; return }
        for (const f of options[s]) {
          frets[s] = f
          walk(s + 1)
        }
        frets[s] = -1
      }

      const consider = (fs: number[]) => {
        const sig = fs.join(',')
        if (seen.has(sig)) return

        let sounding = 0
        let lo = -1
        let hi = -1
        for (let s = 0; s < NUM_STRINGS; s++) {
          if (fs[s] === -1) continue
          sounding++
          if (lo === -1) lo = s
          hi = s
        }
        if (sounding < minSounding) return
        let innerMutes = 0
        for (let s = lo + 1; s < hi; s++) if (fs[s] === -1) innerMutes++
        if (innerMutes > 1) return

        const fretted = fs.filter((f) => f > 0)
        let barre: ChordShape['barre'] | undefined
        if (fretted.length > 0) {
          const base = Math.min(...fretted)
          const above = fretted.filter((f) => f > base).length
          if (above + 1 > 4) return
          if (fretted.length > 4) {
            // A real barre is needed: it spans the base-fret strings and
            // would silence any open string caught inside it.
            let bLo = -1
            let bHi = -1
            for (let s = 0; s < NUM_STRINGS; s++) {
              if (fs[s] !== base) continue
              if (bLo === -1) bLo = s
              bHi = s
            }
            for (let s = bLo; s <= bHi; s++) if (fs[s] === 0) return
            barre = { fret: base, fromString: bLo, toString: bHi }
          }
        }

        const shape = shapeFromFrets(fs, rootPc, qualityId, label, 'generated', barre)
        if (shape === null || shape.span > 4) return
        seen.add(sig)
        out.push(shape)
      }

      walk(0)
    }
  }

  memo.set(key, out)
  return out
}

// Ease weights, tuned so the grips a guitarist calls easiest rank first.
const W_FINGER = 1
const W_BARRE = 1
const W_SPAN = 0.7
const W_BASE_FRET = 0.25
const W_INNER_MUTE = 3
const W_OPEN = -0.4
const W_THIN = 0.5
const W_CURATED = -3.5

/** Lower = easier. Exported so the UI can show an ease meter. */
export function shapeDifficulty(s: ChordShape): number {
  const fretted = s.frets.filter((f) => f > 0)
  const above = fretted.filter((f) => f > s.baseFret).length
  const fingers = s.barre !== undefined ? above + 1 : fretted.length
  let lo = -1
  let hi = -1
  let opens = 0
  let sounding = 0
  for (let i = 0; i < s.frets.length; i++) {
    if (s.frets[i] === -1) continue
    sounding++
    if (s.frets[i] === 0) opens++
    if (lo === -1) lo = i
    hi = i
  }
  let innerMutes = 0
  for (let i = lo + 1; i < hi; i++) if (s.frets[i] === -1) innerMutes++
  const thin = sounding === 3 && qualityById(s.qualityId).intervals.length >= 3 ? W_THIN : 0
  return (
    W_FINGER * fingers +
    (s.barre !== undefined ? W_BARRE : 0) +
    W_SPAN * s.span +
    W_BASE_FRET * s.baseFret +
    W_INNER_MUTE * innerMutes +
    W_OPEN * opens +
    thin +
    (s.source === 'curated' ? W_CURATED : 0)
  )
}

/** Curated + generated shapes, deduped (curated wins), easiest first. */
export function findVoicings(q: VoicingQuery): ChordShape[] {
  const rootPc = normalizePc(q.root)
  let curated = curatedShapes(rootPc, q.qualityId)
  if (q.rootString !== undefined) curated = curated.filter((s) => s.rootString === q.rootString)
  const generated = generateVoicings(rootPc, q.qualityId, q.rootString)

  const seen = new Set<string>()
  const merged: ChordShape[] = []
  for (const s of [...curated, ...generated]) {
    const sig = s.frets.join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    merged.push(s)
  }

  const score = (s: ChordShape) =>
    shapeDifficulty(s) +
    (q.nearFret !== undefined ? 1.5 * Math.abs(s.frets[s.rootString] - q.nearFret) : 0)
  return merged
    .map((s) => ({ s, d: score(s) }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.s)
}

/**
 * Movable forms for a quality regardless of root — powers the flavor-first
 * browse (pick 'm9' before picking a note name and still see grips). Curated
 * templates first, then patterns derived from generated voicings at a
 * reference root (A) on the E/A/D root strings. Only fully fretted shapes
 * derive templates: an open string doesn't slide with the root fret.
 */
export function templatesFor(qualityId: string): ShapeTemplate[] {
  const curated = SHAPE_TEMPLATES
    .filter((t) => t.qualityId === qualityId)
    .sort((a, b) => a.rootString - b.rootString)
  const seen = new Set(curated.map((t) => t.offsets.join(',')))
  const derived: { t: ShapeTemplate; d: number }[] = []
  for (const rs of [0, 1, 2]) {
    for (const s of generateVoicings(PC.A, qualityId, rs)) {
      if (s.frets.some((f) => f === 0)) continue
      const rootFret = s.frets[s.rootString]
      const offsets = s.frets.map((f) => (f === -1 ? MUTED_OFFSET : f - rootFret))
      const key = offsets.join(',')
      if (seen.has(key)) continue
      seen.add(key)
      derived.push({
        t: { qualityId, rootString: rs, offsets, label: `movable root-${displayString(rs)}` },
        d: shapeDifficulty(s),
      })
    }
  }
  derived.sort((a, b) => a.d - b.d)
  return [...curated, ...derived.map((x) => x.t)].slice(0, 8)
}
