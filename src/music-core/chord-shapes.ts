import { qualityById, type ChordQuality } from './chord'
import { degreeOf, type Degree } from './interval'
import { normalizePc, PC, type PitchClass } from './note'
import {
  coordToMidi, coordToPc, fretsForPcOnString, NUM_STRINGS, type FretCoord,
} from './fretboard-geometry'

/**
 * Guitar chord shapes in the user's vocabulary: every sounding note is a
 * scale degree relative to the chord root ('1, b3, 5, b7'), and every shape
 * anchors on its root — the lowest sounding string carries the root pc, so a
 * grip can always be found from a note name on the low E or A string. Open
 * grips are stored as absolute frets; movable forms (E-shape, A-shape,
 * D-shape) are offsets from a root fret and instantiate anywhere on the neck.
 */

export interface ShapeTemplate {
  qualityId: string
  /** 0..5; the string carrying the root. */
  rootString: number
  /**
   * Length 6, low E→high e. MUTED_OFFSET = muted; anything else is a fret
   * offset from the root fret. Offsets may be negative (the classic 9-chord
   * grip puts the 3rd one fret below the root fret), so -1 cannot double as
   * the muted marker here the way it does in absolute fret arrays.
   */
  offsets: number[]
  label: string
  barre?: { offset: number; fromString: number; toString: number }
}

/** Muted-string sentinel for ShapeTemplate.offsets (real offsets are -3..+3). */
export const MUTED_OFFSET = -9

export interface OpenShape {
  root: PitchClass
  qualityId: string
  /** Absolute frets, -1 = muted. */
  frets: number[]
  label: string
}

export interface ChordShape {
  root: PitchClass
  qualityId: string
  /** Length 6, -1 muted, 0 open. */
  frets: number[]
  /** The lowest sounding string; it always carries the root pc. */
  rootString: number
  /** Lowest fret among fretted (>0) notes; 0 if none fretted. */
  baseFret: number
  /** Max fretted − min fretted; 0 if fewer than 2 fretted notes. */
  span: number
  /** Sounding notes, low→high string. */
  coords: FretCoord[]
  /** Parallel to coords. */
  midis: number[]
  /** Parallel to coords, relative to root. */
  degrees: Degree[]
  /** Quality intervals not present in the shape. */
  omitted: Degree[]
  barre?: { fret: number; fromString: number; toString: number }
  label: string
  source: 'curated' | 'generated'
}

export const MAX_SHAPE_FRET = 15

/**
 * Which degrees a valid voicing must sound. The perfect 5th drops first
 * (guitarists shed it as soon as a 4th note arrives), then the 9 on the big
 * extended chords — but the root, the 3rd/sus slot, 6ths/7ths, the defining
 * extension, and altered 5ths never go.
 */
export function requiredDegrees(q: ChordQuality): Degree[] {
  if (q.intervals.length <= 3) return [...q.intervals]
  let out = q.intervals.filter((d) => d !== 7)
  if (q.intervals.length >= 6) out = out.filter((d) => d !== 2)
  return out
}

/**
 * Build a ChordShape from absolute frets, computing every derived field.
 * Returns null when the shape is not a valid voicing of (root, quality):
 * a sounding non-chord tone, a missing required degree, or a lowest sounding
 * string that doesn't carry the root.
 */
export function shapeFromFrets(
  frets: number[],
  root: PitchClass,
  qualityId: string,
  label: string,
  source: 'curated' | 'generated',
  barre?: ChordShape['barre'],
): ChordShape | null {
  if (frets.length !== NUM_STRINGS) return null
  const quality = qualityById(qualityId)
  const rootPc = normalizePc(root)
  const pcSet = new Set(quality.intervals.map((i) => normalizePc(rootPc + i)))

  const coords: FretCoord[] = []
  for (let s = 0; s < NUM_STRINGS; s++) {
    const f = frets[s]
    if (f === -1) continue
    if (!Number.isInteger(f) || f < 0 || f > MAX_SHAPE_FRET) return null
    coords.push({ string: s, fret: f })
  }
  if (coords.length === 0) return null

  const degrees: Degree[] = []
  for (const c of coords) {
    const pc = coordToPc(c)
    if (!pcSet.has(pc)) return null
    degrees.push(degreeOf(pc, rootPc))
  }
  if (degrees[0] !== 0) return null // shapes anchor on their root
  const midis = coords.map(coordToMidi)
  for (let i = 1; i < midis.length; i++) {
    if (midis[i] <= midis[i - 1]) return null // pitches must climb string to string — the root is the true bass
  }

  const present = new Set(degrees)
  for (const d of requiredDegrees(quality)) if (!present.has(d)) return null

  const fretted = coords.map((c) => c.fret).filter((f) => f > 0)
  const baseFret = fretted.length > 0 ? Math.min(...fretted) : 0
  const span = fretted.length >= 2 ? Math.max(...fretted) - baseFret : 0

  let b = barre
  if (b === undefined && baseFret > 0) {
    const atBase = coords.filter((c) => c.fret === baseFret).map((c) => c.string)
    const openInside = coords.some(
      (c) => c.fret === 0 && c.string > atBase[0] && c.string < atBase[atBase.length - 1],
    )
    if (atBase.length >= 3 && !openInside) {
      b = { fret: baseFret, fromString: atBase[0], toString: atBase[atBase.length - 1] }
    }
  }

  const shape: ChordShape = {
    root: rootPc,
    qualityId,
    frets: [...frets],
    rootString: coords[0].string,
    baseFret,
    span,
    coords,
    midis,
    degrees,
    omitted: quality.intervals.filter((i) => !present.has(normalizePc(i))),
    label,
    source,
  }
  if (b !== undefined) shape.barre = b
  return shape
}

/** Plant a movable template at every root fret where it fits under MAX_SHAPE_FRET. */
export function instantiateTemplate(t: ShapeTemplate, root: PitchClass): ChordShape[] {
  const out: ChordShape[] = []
  for (const r of fretsForPcOnString(root, t.rootString, MAX_SHAPE_FRET)) {
    const frets = t.offsets.map((o) => (o === MUTED_OFFSET ? -1 : r + o))
    if (frets.some((f) => f !== -1 && (f < 0 || f > MAX_SHAPE_FRET))) continue
    let barre: ChordShape['barre'] | undefined
    if (t.barre !== undefined && r + t.barre.offset > 0) {
      barre = { fret: r + t.barre.offset, fromString: t.barre.fromString, toString: t.barre.toString }
    }
    const s = shapeFromFrets(frets, root, t.qualityId, t.label, 'curated', barre)
    if (s !== null) out.push(s)
  }
  return out
}

const M = MUTED_OFFSET
const FULL_BARRE_E = { offset: 0, fromString: 0, toString: 5 }
const FULL_BARRE_A = { offset: 0, fromString: 1, toString: 5 }

export const SHAPE_TEMPLATES: ShapeTemplate[] = [
  // Root on low E — findable from a low-E note name.
  { qualityId: 'maj', rootString: 0, offsets: [0, 2, 2, 1, 0, 0], label: 'E-shape', barre: FULL_BARRE_E },
  { qualityId: 'min', rootString: 0, offsets: [0, 2, 2, 0, 0, 0], label: 'E-shape', barre: FULL_BARRE_E },
  { qualityId: 'dom7', rootString: 0, offsets: [0, 2, 0, 1, 0, 0], label: 'E-shape', barre: FULL_BARRE_E },
  { qualityId: 'min7', rootString: 0, offsets: [0, 2, 0, 0, 0, 0], label: 'E-shape', barre: FULL_BARRE_E },
  { qualityId: 'maj7', rootString: 0, offsets: [0, M, 1, 1, 0, M], label: 'E-shape' },
  { qualityId: 'sus4', rootString: 0, offsets: [0, 2, 2, 2, 0, 0], label: 'E-shape', barre: FULL_BARRE_E },
  { qualityId: '7sus4', rootString: 0, offsets: [0, 2, 0, 2, 0, 0], label: 'E-shape', barre: FULL_BARRE_E },
  { qualityId: 'm7b5', rootString: 0, offsets: [0, M, 0, 0, -1, M], label: 'E-shape' },
  { qualityId: 'dim7', rootString: 0, offsets: [0, M, -1, 0, -1, M], label: 'E-shape' },
  { qualityId: '13', rootString: 0, offsets: [0, M, 0, 1, 2, M], label: 'E-shape' },
  { qualityId: '6', rootString: 0, offsets: [0, M, -1, 1, 0, M], label: 'E-shape' },
  { qualityId: 'aug', rootString: 0, offsets: [0, M, 2, 1, 1, M], label: 'E-shape' },
  { qualityId: '5', rootString: 0, offsets: [0, 2, 2, M, M, M], label: 'E-shape' },
  // Root on A — findable from an A-string note name.
  { qualityId: 'maj', rootString: 1, offsets: [M, 0, 2, 2, 2, 0], label: 'A-shape', barre: FULL_BARRE_A },
  { qualityId: 'min', rootString: 1, offsets: [M, 0, 2, 2, 1, 0], label: 'A-shape', barre: FULL_BARRE_A },
  { qualityId: 'dom7', rootString: 1, offsets: [M, 0, 2, 0, 2, 0], label: 'A-shape', barre: FULL_BARRE_A },
  { qualityId: 'min7', rootString: 1, offsets: [M, 0, 2, 0, 1, 0], label: 'A-shape', barre: FULL_BARRE_A },
  { qualityId: 'maj7', rootString: 1, offsets: [M, 0, 2, 1, 2, 0], label: 'A-shape' },
  { qualityId: 'sus2', rootString: 1, offsets: [M, 0, 2, 2, 0, 0], label: 'A-shape' },
  { qualityId: 'sus4', rootString: 1, offsets: [M, 0, 2, 2, 3, 0], label: 'A-shape' },
  { qualityId: 'dom9', rootString: 1, offsets: [M, 0, -1, 0, 0, 0], label: 'A-shape' },
  { qualityId: '7#9', rootString: 1, offsets: [M, 0, -1, 0, 1, M], label: 'Hendrix grip' },
  { qualityId: 'm7b5', rootString: 1, offsets: [M, 0, 1, 0, 1, M], label: 'A-shape' },
  { qualityId: 'dim7', rootString: 1, offsets: [M, 0, 1, -1, 1, M], label: 'A-shape' },
  { qualityId: 'min9', rootString: 1, offsets: [M, 0, -2, 0, 0, M], label: 'A-shape' },
  { qualityId: '6', rootString: 1, offsets: [M, 0, 2, 2, 2, 2], label: 'A-shape' },
  { qualityId: 'm6', rootString: 1, offsets: [M, 0, 2, 2, 1, 2], label: 'A-shape' },
  { qualityId: '7b9', rootString: 1, offsets: [M, 0, -1, 0, -1, 0], label: 'A-shape' },
  { qualityId: 'minMaj7', rootString: 1, offsets: [M, 0, 2, 1, 1, 0], label: 'A-shape' },
  { qualityId: '5', rootString: 1, offsets: [M, 0, 2, 2, M, M], label: 'A-shape' },
  // Root on D — compact top-string forms.
  { qualityId: 'maj', rootString: 2, offsets: [M, M, 0, 2, 3, 2], label: 'D-shape' },
  { qualityId: 'min', rootString: 2, offsets: [M, M, 0, 2, 3, 1], label: 'D-shape' },
  { qualityId: 'dom7', rootString: 2, offsets: [M, M, 0, 2, 1, 2], label: 'D-shape' },
  { qualityId: 'min7', rootString: 2, offsets: [M, M, 0, 2, 1, 1], label: 'D-shape' },
  { qualityId: 'maj7', rootString: 2, offsets: [M, M, 0, 2, 2, 2], label: 'D-shape' },
  { qualityId: 'sus2', rootString: 2, offsets: [M, M, 0, 2, 3, 0], label: 'D-shape' },
  { qualityId: 'sus4', rootString: 2, offsets: [M, M, 0, 2, 3, 3], label: 'D-shape' },
  { qualityId: '5', rootString: 2, offsets: [M, M, 0, 2, 3, M], label: 'D-shape' },
]

export const OPEN_SHAPES: OpenShape[] = [
  { root: PC.C, qualityId: 'maj', frets: [-1, 3, 2, 0, 1, 0], label: 'open' },
  { root: PC.A, qualityId: 'maj', frets: [-1, 0, 2, 2, 2, 0], label: 'open' },
  { root: PC.G, qualityId: 'maj', frets: [3, 2, 0, 0, 0, 3], label: 'open' },
  { root: PC.E, qualityId: 'maj', frets: [0, 2, 2, 1, 0, 0], label: 'open' },
  { root: PC.D, qualityId: 'maj', frets: [-1, -1, 0, 2, 3, 2], label: 'open' },
  { root: PC.A, qualityId: 'min', frets: [-1, 0, 2, 2, 1, 0], label: 'open' },
  { root: PC.E, qualityId: 'min', frets: [0, 2, 2, 0, 0, 0], label: 'open' },
  { root: PC.D, qualityId: 'min', frets: [-1, -1, 0, 2, 3, 1], label: 'open' },
  { root: PC.A, qualityId: 'dom7', frets: [-1, 0, 2, 0, 2, 0], label: 'open' },
  { root: PC.B, qualityId: 'dom7', frets: [-1, 2, 1, 2, 0, 2], label: 'open' },
  { root: PC.C, qualityId: 'dom7', frets: [-1, 3, 2, 3, 1, 0], label: 'open' },
  { root: PC.D, qualityId: 'dom7', frets: [-1, -1, 0, 2, 1, 2], label: 'open' },
  { root: PC.E, qualityId: 'dom7', frets: [0, 2, 0, 1, 0, 0], label: 'open' },
  { root: PC.G, qualityId: 'dom7', frets: [3, 2, 0, 0, 0, 1], label: 'open' },
  { root: PC.C, qualityId: 'maj7', frets: [-1, 3, 2, 0, 0, 0], label: 'open' },
  { root: PC.A, qualityId: 'maj7', frets: [-1, 0, 2, 1, 2, 0], label: 'open' },
  { root: PC.D, qualityId: 'maj7', frets: [-1, -1, 0, 2, 2, 2], label: 'open' },
  { root: PC.E, qualityId: 'maj7', frets: [0, 2, 1, 1, 0, 0], label: 'open' },
  { root: PC.F, qualityId: 'maj7', frets: [-1, -1, 3, 2, 1, 0], label: 'open' },
  { root: PC.A, qualityId: 'min7', frets: [-1, 0, 2, 0, 1, 0], label: 'open' },
  { root: PC.D, qualityId: 'min7', frets: [-1, -1, 0, 2, 1, 1], label: 'open' },
  { root: PC.E, qualityId: 'min7', frets: [0, 2, 0, 0, 0, 0], label: 'open' },
  { root: PC.A, qualityId: 'sus2', frets: [-1, 0, 2, 2, 0, 0], label: 'open' },
  { root: PC.D, qualityId: 'sus2', frets: [-1, -1, 0, 2, 3, 0], label: 'open' },
  { root: PC.A, qualityId: 'sus4', frets: [-1, 0, 2, 2, 3, 0], label: 'open' },
  { root: PC.D, qualityId: 'sus4', frets: [-1, -1, 0, 2, 3, 3], label: 'open' },
  { root: PC.E, qualityId: 'sus4', frets: [0, 2, 2, 2, 0, 0], label: 'open' },
  { root: PC.C, qualityId: 'add9', frets: [-1, 3, 2, 0, 3, 0], label: 'open' },
  { root: PC.C, qualityId: '6', frets: [-1, 3, 2, 2, 1, 0], label: 'open' },
  { root: PC.A, qualityId: '6', frets: [-1, 0, 2, 2, 2, 2], label: 'open' },
  { root: PC.E, qualityId: 'm6', frets: [0, 2, 2, 0, 2, 0], label: 'open' },
  { root: PC.A, qualityId: 'minMaj7', frets: [-1, 0, 2, 1, 1, 0], label: 'open' },
]

/** All curated grips for (root, quality) — opens at that root plus every movable form planted there. */
export function curatedShapes(root: PitchClass, qualityId: string): ChordShape[] {
  const rootPc = normalizePc(root)
  const out: ChordShape[] = []
  const seen = new Set<string>()
  const push = (s: ChordShape | null) => {
    if (s === null) return
    const key = s.frets.join(',')
    if (seen.has(key)) return
    seen.add(key)
    out.push(s)
  }
  for (const o of OPEN_SHAPES) {
    if (o.root !== rootPc || o.qualityId !== qualityId) continue
    push(shapeFromFrets(o.frets, o.root, o.qualityId, o.label, 'curated'))
  }
  for (const t of SHAPE_TEMPLATES) {
    if (t.qualityId !== qualityId) continue
    for (const s of instantiateTemplate(t, rootPc)) push(s)
  }
  return out
}
