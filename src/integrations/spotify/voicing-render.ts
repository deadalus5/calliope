import {
  coordToMidi, coordToPc, degreeOf, parseChordSymbol,
  type ChordShape, type FretCoord,
} from './spotify-utils'
import type { UgVoicing } from './songmap'

/**
 * A UG applicature voicing as a renderable ChordShape. Deliberately LENIENT
 * — this is "how the chart's author grips it", not a curated library entry,
 * so chord-shapes' shapeFromFrets validation (root must be the bass,
 * pitches strictly climbing) would reject perfectly legitimate UG grips.
 * The shared board runs to fret 17; anything beyond can't render.
 */

const BOARD_MAX_FRET = 17

export function ugVoicingToShape(symbol: string, v: UgVoicing): ChordShape | null {
  let root: number
  let qualityId: string
  try {
    const chord = parseChordSymbol(symbol)
    root = chord.root
    qualityId = chord.quality.id
  } catch {
    return null
  }
  if (!Array.isArray(v.frets) || v.frets.length !== 6) return null

  const coords: FretCoord[] = []
  for (let s = 0; s < 6; s++) {
    const f = v.frets[s]
    if (f < 0) continue
    if (f > BOARD_MAX_FRET) return null
    coords.push({ string: s, fret: f })
  }
  if (coords.length < 2) return null

  const midis = coords.map(coordToMidi)
  const degrees = coords.map((c) => degreeOf(coordToPc(c), root as ChordShape['root']))
  const rootAt = coords.findIndex((_, i) => degrees[i] === 0)
  const fretted = coords.map((c) => c.fret).filter((f) => f > 0)
  return {
    root: root as ChordShape['root'],
    qualityId,
    frets: v.frets.slice(),
    rootString: (rootAt >= 0 ? coords[rootAt] : coords[0]).string,
    baseFret: fretted.length > 0 ? Math.min(...fretted) : 0,
    span: fretted.length >= 2 ? Math.max(...fretted) - Math.min(...fretted) : 0,
    coords,
    midis,
    degrees,
    omitted: [],
    label: 'UG grip',
    source: 'curated',
  }
}
