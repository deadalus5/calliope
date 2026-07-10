import { pcOfDegree, type Degree } from './interval'
import { type PitchClass } from './note'

/**
 * The app's central framing: every scale is a pentatonic SKELETON the player
 * already owns, plus COLOR degrees layered on top. Modes are never presented
 * as parent-scale rotations — each ModeSpec names its skeleton and exactly
 * which degrees it adds.
 */

export type PentatonicKind = 'minor' | 'major'

export const PENTATONIC_DEGREES: Record<PentatonicKind, Degree[]> = {
  minor: [0, 3, 5, 7, 10], // 1 b3 4 5 b7
  major: [0, 2, 4, 7, 9], // 1 2 3 5 6
}

/** The blue note, taught as a bend/passing color on the minor skeleton. */
export const BLUE_NOTE: Degree = 6

export interface ModeSpec {
  id: string
  name: string
  skeleton: PentatonicKind
  /** Degrees added to the skeleton to complete the mode. */
  colors: Degree[]
  /** Label overrides, e.g. Lydian's 6 semitones is '#4' not 'b5'. */
  labelOverride?: Record<Degree, string>
  /** One-line feel description, in the player's language. */
  vibe: string
  /** Songs/jams that live in this sound. */
  songRefs: string[]
}

export const MODES: ModeSpec[] = [
  {
    id: 'mixolydian',
    name: 'Mixolydian',
    skeleton: 'major',
    colors: [5, 10], // 4, b7
    vibe: 'Major but relaxed — the sunshine jam sound. Major pentatonic with a b7 that keeps it loose instead of resolved.',
    songRefs: ["Franklin's Tower", 'Fire on the Mountain', 'most Dead jams on one chord'],
  },
  {
    id: 'dorian',
    name: 'Dorian',
    skeleton: 'minor',
    colors: [2, 9], // 2, 6
    vibe: 'Minor but hopeful — the natural 6 lifts it out of sad. The Santana / funky minor-jam sound.',
    songRefs: ['Scarlet Begonias (jam)', 'Oye Como Va', 'So What'],
  },
  {
    id: 'aeolian',
    name: 'Aeolian (natural minor)',
    skeleton: 'minor',
    colors: [2, 8], // 2, b6
    vibe: 'Fully sad minor — the b6 darkens everything. Ballads and minor blues.',
    songRefs: ['The Thrill Is Gone (verse feel)', 'minor blues in general'],
  },
  {
    id: 'ionian',
    name: 'Ionian (plain major)',
    skeleton: 'major',
    colors: [5, 11], // 4, 7
    vibe: 'Fully resolved major — the 7 pulls home hard. Pretty, singer-songwriter major.',
    songRefs: ['Gravity (chorus lift)', 'most major-key choruses'],
  },
  {
    id: 'lydian',
    name: 'Lydian',
    skeleton: 'major',
    colors: [6, 11], // #4, 7
    labelOverride: { 6: '#4' },
    vibe: 'Major but floating — the #4 makes it dreamlike, unresolved upward.',
    songRefs: ['film-score shimmer, Dreams-style intros'],
  },
  {
    id: 'phrygian',
    name: 'Phrygian',
    skeleton: 'minor',
    colors: [1, 8], // b2, b6
    vibe: 'Dark and Spanish — the b2 sits right on top of the root and pushes down onto it.',
    songRefs: ['flamenco vamps, White Rabbit intro feel'],
  },
]

export function modeById(id: string): ModeSpec {
  const m = MODES.find((m) => m.id === id)
  if (!m) throw new Error(`Unknown mode: ${id}`)
  return m
}

/** Full degree set of a mode (skeleton + colors), sorted. */
export function modeDegrees(mode: ModeSpec): Degree[] {
  return [...PENTATONIC_DEGREES[mode.skeleton], ...mode.colors].sort((a, b) => a - b)
}

export function scalePcs(root: PitchClass, degrees: Degree[]): PitchClass[] {
  return degrees.map((d) => pcOfDegree(d, root))
}
