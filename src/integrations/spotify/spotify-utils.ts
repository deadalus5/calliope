/**
 * The only bridge between the Spotify module and music-core: re-exports so
 * the integration keeps a single, thin dependency surface.
 */
export {
  PC, coordToMidi, coordToPc, degreeLabel, degreeOf, modeById, parseChordSymbol, pcName,
  type Chord, type ChordShape, type FretCoord, type ModeSpec, type PitchClass,
} from '../../music-core'
import { PC, degreeLabel, modeById, pcName, type PitchClass } from '../../music-core'
import type { SongKey } from './songmap'

export function playbackKeys(): PitchClass[] {
  return [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]
}

/** "A mixolydian — major skeleton + 4 and b7": the app's pedagogy voice. */
export function keyHeadline(key: SongKey): string {
  try {
    const mode = modeById(key.modeId)
    const colors = mode.colors.map((d) => degreeLabel(d, mode.labelOverride)).join(' and ')
    return `${pcName(key.root, key.root)} ${mode.name.toLowerCase()} — ${mode.skeleton} skeleton + ${colors}`
  } catch {
    return `${pcName(key.root, key.root)} ${key.skeleton}`
  }
}
