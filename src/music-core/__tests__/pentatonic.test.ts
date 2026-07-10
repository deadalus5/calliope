import { describe, expect, it } from 'vitest'
import { PC } from '../note'
import { allPositions, fullNeck, pentatonicPosition, positionsContaining } from '../pentatonic'

/** Render a position as string→frets pairs, low E first, for hand-checking. */
function fretMap(key: number, kind: 'minor' | 'major', pos: number): number[][] {
  const p = pentatonicPosition(key, kind, pos)
  const byString: number[][] = [[], [], [], [], [], []]
  for (const n of p.notes) byString[n.coord.string].push(n.coord.fret)
  return byString.map((f) => f.sort((a, b) => a - b))
}

describe('pentatonic positions', () => {
  it('A minor box 1 is the classic frets 5-8 box', () => {
    expect(fretMap(PC.A, 'minor', 1)).toEqual([
      [5, 8], [5, 7], [5, 7], [5, 7], [5, 8], [5, 8],
    ])
  })

  it('A minor box 2', () => {
    expect(fretMap(PC.A, 'minor', 2)).toEqual([
      [8, 10], [7, 10], [7, 10], [7, 9], [8, 10], [8, 10],
    ])
  })

  it('A minor box 3', () => {
    expect(fretMap(PC.A, 'minor', 3)).toEqual([
      [10, 12], [10, 12], [10, 12], [9, 12], [10, 13], [10, 12],
    ])
  })

  it('A minor box 4', () => {
    expect(fretMap(PC.A, 'minor', 4)).toEqual([
      [12, 15], [12, 15], [12, 14], [12, 14], [13, 15], [12, 15],
    ])
  })

  it('A minor box 5 drops down the octave', () => {
    expect(fretMap(PC.A, 'minor', 5)).toEqual([
      [3, 5], [3, 5], [2, 5], [2, 5], [3, 5], [3, 5],
    ])
  })

  it('E minor box 1 sits at the open position', () => {
    expect(fretMap(PC.E, 'minor', 1)).toEqual([
      [0, 3], [0, 2], [0, 2], [0, 2], [0, 3], [0, 3],
    ])
  })

  it('A major pentatonic box 1 is the root-on-5th-fret major shape', () => {
    expect(fretMap(PC.A, 'major', 1)).toEqual([
      [5, 7], [4, 7], [4, 7], [4, 6], [5, 7], [5, 7],
    ])
  })

  it('every position has exactly two notes per string, all in the scale', () => {
    for (const key of [PC.A, PC.E, PC.G, PC.C, PC.Fs, PC.As]) {
      for (const kind of ['minor', 'major'] as const) {
        for (const p of allPositions(key, kind)) {
          const byString = new Map<number, number>()
          for (const n of p.notes) byString.set(n.coord.string, (byString.get(n.coord.string) ?? 0) + 1)
          expect([...byString.values()]).toEqual([2, 2, 2, 2, 2, 2])
          expect(p.maxFret - p.minFret).toBeLessThanOrEqual(4)
        }
      }
    }
  })

  it('roots are flagged and every degree is a pentatonic degree', () => {
    const p = pentatonicPosition(PC.G, 'minor', 1)
    const degrees = new Set(p.notes.map((n) => n.degree))
    expect([...degrees].sort((a, b) => a - b)).toEqual([0, 3, 5, 7, 10])
    expect(p.notes.filter((n) => n.isRoot).length).toBeGreaterThan(0)
  })

  it('full neck contains every position note', () => {
    const neck = fullNeck(PC.A, 'minor')
    const key = (s: number, f: number) => `${s}:${f}`
    const neckSet = new Set(neck.map((n) => key(n.coord.string, n.coord.fret)))
    for (const p of allPositions(PC.A, 'minor')) {
      for (const n of p.notes) {
        if (n.coord.fret <= 17) expect(neckSet.has(key(n.coord.string, n.coord.fret))).toBe(true)
      }
    }
  })

  it('positionsContaining finds the box-1/box-2 overlap note', () => {
    // A minor: low E fret 8 (C) is in box 1 and box 2.
    expect(positionsContaining({ string: 0, fret: 8 }, PC.A, 'minor')).toEqual([1, 2])
  })
})
