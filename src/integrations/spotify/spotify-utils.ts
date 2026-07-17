/**
 * The only bridge between the Spotify module and music-core: re-exports so
 * the integration keeps a single, thin dependency surface.
 */
export {
  PC, degreeLabel, degreeOf, modeById, parseChordSymbol, pcName,
  type Chord, type ModeSpec, type PitchClass,
} from '../../music-core'
import { PC, type PitchClass } from '../../music-core'

export function playbackKeys(): PitchClass[] {
  return [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]
}
