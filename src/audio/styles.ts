import type { Progression } from '../music-core'
import type { BassStyle, CompStyle, GrooveSpec } from './arrange/types'

/**
 * Style registry — each song gets its own arrangement identity (bass
 * approach, comping pattern, groove/pocket feel, swing ratio) instead of the
 * single hardcoded "straight" feel every song used before this task. Pure
 * data + one resolver function; consumed by the sequencer (Task 8).
 */
export interface StyleSpec {
  id: string
  groove: GrooveSpec
  bass: BassStyle
  comp: CompStyle
  swing: number
  trims?: Partial<Record<'keys' | 'bass' | 'drums', number>> // dB, consumed in Task 8
}

export const STYLES: Record<string, StyleSpec> = {
  'blues-shuffle': {
    id: 'blues-shuffle',
    bass: 'boogie',
    comp: 'charleston',
    swing: 0.52,
    groove: {
      id: 'blues-shuffle',
      pocket: { hat: 0, snare: 0.005, kick: -0.001, bass: 0.006, keys: 0.003 },
      hatVel: [0.85, 0.35, 0.6, 0.35, 0.75, 0.35, 0.6, 0.4],
      ridePhase: true,
      fillEveryBars: 4,
      ornaments: { ghostSnareP: 0.25, openHatP: 0.5, kickAndP: 0 },
    },
  },
  'slow-minor-blues': {
    id: 'slow-minor-blues',
    bass: 'walking',
    comp: 'charleston',
    swing: 0.54,
    groove: {
      id: 'slow-minor-blues',
      pocket: { hat: 0, snare: 0.006, kick: -0.001, bass: 0.006, keys: 0.003 },
      hatVel: [0.75, 0.3, 0.55, 0.3, 0.7, 0.3, 0.55, 0.35],
      ridePhase: true,
      fillEveryBars: 4,
      ornaments: { ghostSnareP: 0.3, openHatP: 0.3, kickAndP: 0 },
    },
  },
  'dead-drive': {
    id: 'dead-drive',
    bass: 'rootFive',
    comp: 'strum',
    swing: 0,
    groove: {
      id: 'dead-drive',
      pocket: { hat: 0, snare: 0.003, kick: -0.002, bass: -0.003, keys: 0.002 },
      hatVel: [0.8, 0.45, 0.65, 0.45, 0.75, 0.45, 0.65, 0.5],
      ridePhase: true,
      fillEveryBars: 8,
      ornaments: { ghostSnareP: 0.15, openHatP: 0.4, kickAndP: 0.25 },
    },
  },
  'slow-soul': {
    id: 'slow-soul',
    bass: 'rootFive',
    comp: 'soul-pads',
    swing: 0,
    groove: {
      id: 'slow-soul',
      halftime: true,
      pocket: { hat: 0, snare: 0.008, kick: -0.002, bass: 0.004, keys: 0.003 },
      hatVel: [0.7, 0.3, 0.5, 0.3, 0.6, 0.3, 0.5, 0.35],
      fillEveryBars: 8,
      ornaments: { ghostSnareP: 0.35, openHatP: 0.2, kickAndP: 0.2 },
    },
  },
  'pop-soul': {
    id: 'pop-soul',
    bass: 'rootFive',
    comp: 'pop',
    swing: 0,
    groove: {
      id: 'pop-soul',
      pocket: { hat: 0, snare: 0.004, kick: -0.002, bass: -0.002, keys: 0.002 },
      hatVel: [0.8, 0.35, 0.6, 0.35, 0.7, 0.35, 0.6, 0.4],
      fillEveryBars: 8,
      ornaments: { ghostSnareP: 0.25, openHatP: 0.3, kickAndP: 0.3 },
    },
  },
  'neo-soul': {
    id: 'neo-soul',
    bass: 'rootFive',
    comp: 'neosoul',
    swing: 0.2,
    groove: {
      id: 'neo-soul',
      halftime: true,
      pocket: { hat: 0, snare: 0.009, kick: -0.001, bass: 0.006, keys: 0.004 },
      hatVel: [0.7, 0.25, 0.5, 0.3, 0.6, 0.25, 0.5, 0.3],
      fillEveryBars: 8,
      ornaments: { ghostSnareP: 0.4, openHatP: 0.2, kickAndP: 0.15 },
    },
  },
  'hypnotic-vamp': {
    id: 'hypnotic-vamp',
    bass: 'pedal',
    comp: 'vamp',
    swing: 0,
    groove: {
      id: 'hypnotic-vamp',
      pocket: { hat: 0, snare: 0.003, kick: -0.002, bass: 0, keys: 0.002 },
      hatVel: [0.8, 0.4, 0.6, 0.4, 0.7, 0.4, 0.6, 0.45],
      ridePhase: true,
      fillEveryBars: 8,
      ornaments: { ghostSnareP: 0.2, openHatP: 0.4, kickAndP: 0.2 },
    },
  },
  'straight-pop': {
    id: 'straight-pop',
    bass: 'rootFive',
    comp: 'pop',
    swing: 0,
    groove: {
      id: 'straight-pop',
      pocket: { hat: 0, snare: 0.003, kick: -0.002, bass: -0.003, keys: 0.002 },
      hatVel: [0.85, 0.35, 0.6, 0.35, 0.75, 0.35, 0.6, 0.4],
      fillEveryBars: 8,
      ornaments: { ghostSnareP: 0.2, openHatP: 0.3, kickAndP: 0.2 },
    },
  },
}

export function styleFor(p: Progression): StyleSpec {
  if (p.styleId) {
    const style = STYLES[p.styleId]
    if (style) return style
  }
  return STYLES[p.feel === 'shuffle' ? 'blues-shuffle' : 'straight-pop']
}
