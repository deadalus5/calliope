import {
  chordPcs, chordBass, degreeLabel, degreeOf, fullNeck, normalizePc,
  pcOfDegree, pentatonicPosition, coordsForPc,
  type Chord, type ModeSpec, type PentatonicKind, type PitchClass, type TriadGrip,
} from '../music-core'
import type { FretboardLayer, NoteMarker } from './layers'

/**
 * Translators from music-core objects to fretboard layers. Every module
 * paints through these so the visual language stays consistent. Markers
 * carry their degree — the board colors by it.
 */

export function skeletonLayer(
  key: PitchClass, kind: PentatonicKind, position: number | 'all',
): FretboardLayer {
  const notes = position === 'all'
    ? fullNeck(key, kind)
    : pentatonicPosition(key, kind, position).notes
  return {
    id: `skeleton-${key}-${kind}-${position}`,
    zIndex: 10,
    markers: notes.map((n): NoteMarker => ({
      coord: n.coord,
      role: n.isRoot ? 'root' : 'skeleton',
      label: degreeLabel(n.degree),
      degree: n.degree,
    })),
  }
}

/** Neighboring-position ghosts, for working on the dark spots between boxes. */
export function neighborGhostLayer(
  key: PitchClass, kind: PentatonicKind, position: number,
): FretboardLayer {
  const shown = new Set(
    pentatonicPosition(key, kind, position).notes.map((n) => `${n.coord.string}:${n.coord.fret}`),
  )
  return {
    id: `ghosts-${key}-${kind}-${position}`,
    zIndex: 5,
    markers: fullNeck(key, kind)
      .filter((n) => !shown.has(`${n.coord.string}:${n.coord.fret}`))
      .map((n): NoteMarker => ({
        coord: n.coord, role: 'ghost', label: degreeLabel(n.degree), degree: n.degree,
      })),
  }
}

/** The two color notes a mode adds, painted across the neck, pulsing. */
export function modeColorLayer(key: PitchClass, mode: ModeSpec): FretboardLayer {
  return {
    id: `mode-${key}-${mode.id}`,
    zIndex: 20,
    markers: mode.colors.map((deg): NoteMarker => ({
      pitchClass: pcOfDegree(deg, key),
      role: 'modalColor',
      label: degreeLabel(deg, mode.labelOverride),
      degree: deg,
      pulse: true,
    })),
  }
}

/** Current chord's tones everywhere, labeled by degree relative to the KEY. */
export function chordToneLayer(chord: Chord, keyRoot: PitchClass): FretboardLayer {
  const bass = chordBass(chord)
  return {
    id: `chord-${chord.root}-${chord.quality.id}-${bass}`,
    zIndex: 30,
    markers: chordPcs(chord).map((pc): NoteMarker => {
      const degree = degreeOf(pc, keyRoot)
      return {
        pitchClass: pc,
        role: 'chordTone',
        label: degreeLabel(degree),
        degree,
        ring: normalizePc(pc) === normalizePc(bass),
      }
    }),
  }
}

/** One triad grip as target markers (Triad Atlas). */
export function gripLayer(grip: TriadGrip, keyRoot: PitchClass, id = 'grip'): FretboardLayer {
  return {
    id,
    zIndex: 40,
    markers: grip.coords.map((coord, i): NoteMarker => {
      const degree = degreeOf(grip.pcs[i], keyRoot)
      return { coord, role: 'triad', label: degreeLabel(degree), degree, ring: i === 0 }
    }),
  }
}

/** A single pitch class as pulsing drill targets across the neck. */
export function targetLayer(pc: PitchClass, keyRoot: PitchClass, reveal: boolean): FretboardLayer {
  const degree = degreeOf(pc, keyRoot)
  return {
    id: `target-${pc}-${reveal}`,
    zIndex: 50,
    markers: reveal
      ? coordsForPc(pc).map((coord): NoteMarker => ({
          coord, role: 'target', label: degreeLabel(degree), degree, pulse: true,
        }))
      : [],
  }
}
