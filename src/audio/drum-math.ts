/**
 * Pure velocity-layer and round-robin helpers for the drum engine. No Tone
 * import so they're unit-testable without an audio context.
 */

export interface LayerSpec { maxVel: number; rr: string[] }

/** Index of the first layer (ascending maxVel) with vel <= maxVel; falls back to the last layer. */
export function pickLayer(layers: LayerSpec[], vel: number): number {
  for (let i = 0; i < layers.length; i++) {
    if (vel <= layers[i].maxVel) return i
  }
  return layers.length - 1
}

/** Round-robin index in [0, count): never returns `last` when count > 1. */
export function pickRR(count: number, last: number, rand: () => number): number {
  let i = Math.floor(rand() * count)
  if (i === last) i = (i + 1) % count
  return i
}
