import type { FretCoord, PitchClass } from '../music-core'

/**
 * The fretboard's data contract. Views never draw on the board directly —
 * they hand it layers of markers. Roles map to the app's visual language:
 *   skeleton    dim brass       — the pentatonic map he already owns
 *   root        bright gold     — the anchor of everything
 *   chordTone   ember orange    — what the current chord wants
 *   modalColor  electric blue   — the 2 notes a mode adds to the skeleton
 *   target      pearl ring      — where a drill wants him to go
 *   anchor      letter names    — low E / A string note names
 *   ghost       barely there    — context notes (full-neck view)
 */

export type MarkerRole =
  | 'skeleton' | 'root' | 'chordTone' | 'modalColor' | 'target' | 'anchor' | 'ghost' | 'triad'

export interface NoteMarker {
  /** Exact place, or a pitch class to mark everywhere it occurs. */
  coord?: FretCoord
  pitchClass?: PitchClass
  role: MarkerRole
  label?: string
  /** Degree relative to the key — drives the marker's hue. */
  degree?: number
  /** Slow neon pulse (modal colors, drill targets). */
  pulse?: boolean
  /** Extra emphasis ring (e.g. the specific inversion bass note). */
  ring?: boolean
}

export interface FretboardLayer {
  id: string
  zIndex?: number
  markers: NoteMarker[]
}
