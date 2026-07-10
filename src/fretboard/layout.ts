import { MAX_FRET, NUM_STRINGS } from '../music-core'

/**
 * Fretboard pixel geometry. Frets use real 12th-root spacing compressed
 * toward equal (blend factor) so high frets stay readable on screen while
 * the board still reads as a guitar neck. String 0 (low E) renders at the
 * BOTTOM, like looking down at your own guitar.
 */

export interface FretboardLayout {
  width: number
  height: number
  maxFret: number
  nutX: number
  fretX: (fret: number) => number // x of the fret wire
  noteX: (fret: number) => number // x where a finger/note sits (behind the wire)
  stringY: (string: number) => number
  stringGauge: (string: number) => number
}

const BLEND = 0.55 // 0 = true guitar spacing, 1 = equal spacing

export function makeLayout(width: number, height: number, maxFret = MAX_FRET): FretboardLayout {
  const nutX = 44
  const rightPad = 14
  const scaleW = width - nutX - rightPad
  // True fret position along a scale normalized so fret maxFret = 1.
  const truePos = (f: number) => (1 - Math.pow(2, -f / 12)) / (1 - Math.pow(2, -maxFret / 12))
  const pos = (f: number) => (1 - BLEND) * truePos(f) + BLEND * (f / maxFret)
  const fretX = (f: number) => nutX + pos(f) * scaleW

  const topPad = 22
  const bottomPad = 26
  const spacing = (height - topPad - bottomPad) / (NUM_STRINGS - 1)
  // string 5 (high e) at top, string 0 (low E) at bottom
  const stringY = (s: number) => topPad + (NUM_STRINGS - 1 - s) * spacing

  return {
    width, height, maxFret, nutX, fretX,
    noteX: (f: number) => (f === 0 ? nutX - 22 : (fretX(f - 1) + fretX(f)) / 2 + (fretX(f) - fretX(f - 1)) * 0.12),
    stringY,
    stringGauge: (s: number) => 0.8 + (NUM_STRINGS - 1 - s) * 0.45,
  }
}

export const INLAY_FRETS = [3, 5, 7, 9, 15, 17]
export const DOUBLE_INLAY_FRET = 12
