import type { DrumSpec } from './types'

/**
 * Authored one-beat fill fragments. `atBeat` is RELATIVE to the fill window
 * start (0..1) — `arrangeDrums` shifts them into the bar's last beat. Picked
 * by a seeded rng draw, never Math.random.
 */
export const FILLS: DrumSpec[][] = [
  // F1: snare build
  [
    { atBeat: 0.0, art: 'snare', vel: 0.5, fill: true },
    { atBeat: 0.25, art: 'snare', vel: 0.45, fill: true },
    { atBeat: 0.5, art: 'snare', vel: 0.6, fill: true },
    { atBeat: 0.75, art: 'tom-hi', vel: 0.7, fill: true },
  ],
  // F2: around the kit
  [
    { atBeat: 0.0, art: 'snare', vel: 0.6, fill: true },
    { atBeat: 0.33, art: 'tom-hi', vel: 0.55, fill: true },
    { atBeat: 0.66, art: 'tom-lo', vel: 0.72, fill: true },
  ],
  // F3: sparse setup
  [
    { atBeat: 0.0, art: 'snare', vel: 0.42, fill: true },
    { atBeat: 0.5, art: 'snare', vel: 0.55, fill: true },
    { atBeat: 0.75, art: 'snare', vel: 0.5, fill: true },
  ],
  // F4: toms drop
  [
    { atBeat: 0.0, art: 'tom-hi', vel: 0.6, fill: true },
    { atBeat: 0.25, art: 'tom-hi', vel: 0.5, fill: true },
    { atBeat: 0.5, art: 'tom-lo', vel: 0.75, fill: true },
  ],
]
