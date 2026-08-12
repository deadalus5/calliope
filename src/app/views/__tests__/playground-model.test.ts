import { describe, expect, it } from 'vitest'
import {
  PC, coordToPc, coordsForPc, fullNeck, modeDegrees, modeById, pcOfDegree, pentatonicPosition,
} from '../../../music-core'
import type { PlaygroundLayer } from '../../../state/playground'
import {
  applyFilter, autoName, boardKeyOf, cellLabel, coordKey, entryColor, isDarkColor, layerDegrees,
  layerNotes, resolveBoard, sharedCount, wedgePath, KEYLESS_COLOR,
  type BoardCell,
} from '../playground-model'

/** Hand-rolled layer literals — the model never needs the store itself. */

let seq = 0
function base() {
  seq += 1
  return {
    id: `t${seq}`,
    visible: true,
    color: { kind: 'tint', hex: '#FFC94D' } as const,
    treatment: 'solid' as const,
    opacity: 1,
  }
}

type Over<K extends PlaygroundLayer['kind']> = Partial<Extract<PlaygroundLayer, { kind: K }>>

const pent = (over: Over<'pentatonic'> = {}): PlaygroundLayer => ({
  ...base(), kind: 'pentatonic', key: PC.A, pent: 'minor', position: 'all', blueNote: false, ...over,
})
const mode = (over: Over<'mode'> = {}): PlaygroundLayer => ({
  ...base(), kind: 'mode', key: PC.A, modeId: 'dorian', ...over,
})
const degreesLayer = (degrees: number[], over: Over<'degrees'> = {}): PlaygroundLayer => ({
  ...base(), kind: 'degrees', key: PC.A, degrees, ...over,
})
const shape = (notes: { string: number; fret: number }[], over: Over<'shape'> = {}): PlaygroundLayer => ({
  ...base(), kind: 'shape', notes, ...over,
})

describe('layerNotes', () => {
  it('positional pentatonic matches the generated box exactly', () => {
    const notes = layerNotes(pent({ position: 1 }))
    const box = pentatonicPosition(PC.A, 'minor', 1)
    expect(notes.length).toBe(box.notes.length)
    expect(notes.map((n) => coordKey(n.coord)).sort())
      .toEqual(box.notes.map((n) => coordKey(n.coord)).sort())
  })

  it('"all" matches the full neck', () => {
    expect(layerNotes(pent()).length).toBe(fullNeck(PC.A, 'minor').length)
  })

  it('blue note on a box stays clipped to the box window', () => {
    const box = pentatonicPosition(PC.A, 'minor', 1)
    const notes = layerNotes(pent({ position: 1, blueNote: true }))
    const blues = notes.filter((n) => n.degree === 6)
    expect(blues.length).toBeGreaterThan(0)
    for (const b of blues) {
      expect(b.coord.fret).toBeGreaterThanOrEqual(box.minFret)
      expect(b.coord.fret).toBeLessThanOrEqual(box.maxFret)
      expect(coordToPc(b.coord)).toBe(pcOfDegree(6, PC.A))
    }
  })

  it('blue note on the full neck fans out everywhere', () => {
    const notes = layerNotes(pent({ blueNote: true }))
    expect(notes.length).toBe(
      fullNeck(PC.A, 'minor').length + coordsForPc(pcOfDegree(6, PC.A)).length,
    )
  })

  it('mode layers fan seven degrees over the neck', () => {
    const dorian = modeById('dorian')
    const notes = layerNotes(mode())
    const wanted = modeDegrees(dorian)
    expect(new Set(notes.map((n) => n.degree))).toEqual(new Set(wanted))
    const expected = wanted.reduce(
      (sum, d) => sum + coordsForPc(pcOfDegree(d, PC.A)).length, 0,
    )
    expect(notes.length).toBe(expected)
  })

  it('degree layers expand only the picked degrees', () => {
    const notes = layerNotes(degreesLayer([0, 7]))
    expect(new Set(notes.map((n) => n.degree))).toEqual(new Set([0, 7]))
    const pcs = new Set(notes.map((n) => coordToPc(n.coord)))
    expect(pcs).toEqual(new Set([PC.A, PC.E]))
  })

  it('shape notes pass through keyless and out-of-range frets are dropped', () => {
    const notes = layerNotes(shape([{ string: 2, fret: 5 }, { string: 0, fret: 25 }]))
    expect(notes).toEqual([{ coord: { string: 2, fret: 5 } }])
    expect(notes[0].degree).toBeUndefined()
  })

  it('a larger maxFret extends every kind (the Playground runs a 22-fret neck)', () => {
    // shape: fret 20 lives on the 22-fret neck, not the default 17
    expect(layerNotes(shape([{ string: 2, fret: 20 }]))).toEqual([])
    expect(layerNotes(shape([{ string: 2, fret: 20 }]), 22))
      .toEqual([{ coord: { string: 2, fret: 20 } }])
    // pentatonic 'all': strictly more notes on the longer neck, incl. fret > 17
    const long = layerNotes(pent(), 22)
    expect(long.length).toBeGreaterThan(layerNotes(pent()).length)
    expect(long.some((n) => n.coord.fret > 17)).toBe(true)
    expect(long.every((n) => n.coord.fret <= 22)).toBe(true)
    // mode fan-out honors it too
    expect(layerNotes(mode(), 22).some((n) => n.coord.fret > 17)).toBe(true)
  })
})

describe('layerDegrees', () => {
  it('reports what the layer can contain (drives the custom colour editor)', () => {
    expect(layerDegrees(pent({ blueNote: true }))).toEqual([0, 3, 5, 6, 7, 10])
    expect(layerDegrees(mode())).toEqual([0, 2, 3, 5, 7, 9, 10])
    expect(layerDegrees(degreesLayer([0, 4]))).toEqual([0, 4])
    expect(layerDegrees(shape([{ string: 0, fret: 5 }]))).toEqual([])
  })
})

describe('resolveBoard', () => {
  const twoPents = () => [pent({ pent: 'minor' }), pent({ pent: 'major' })]

  it('the default two-pent stack shares exactly the root and fifth coords', () => {
    const cells = resolveBoard(twoPents(), { colorMode: 'families' })
    const sharedPcs = new Set<number>()
    for (const cell of cells.values()) {
      if (cell.entries.length >= 2) sharedPcs.add(coordToPc(cell.coord))
    }
    // A minor pent ∩ A major pent = degrees {0, 7} = pcs {A, E}
    expect(sharedPcs).toEqual(new Set([PC.A, PC.E]))
    expect(sharedCount(cells)).toBe(coordsForPc(PC.A).length + coordsForPc(PC.E).length)
  })

  it('entries are ordered top-of-stack first', () => {
    const layers = twoPents()
    const cells = resolveBoard(layers, { colorMode: 'families' })
    const shared = [...cells.values()].find((c) => c.entries.length === 2)
    expect(shared).toBeDefined()
    expect(shared!.entries[0].layer).toBe(layers[0])
    expect(shared!.entries[1].layer).toBe(layers[1])
  })

  it('hidden layers are excluded', () => {
    const layers = [pent({ pent: 'minor', visible: false }), pent({ pent: 'major' })]
    const cells = resolveBoard(layers, { colorMode: 'families' })
    expect(sharedCount(cells)).toBe(0)
    for (const cell of cells.values()) expect(cell.entries[0].layer).toBe(layers[1])
  })

  it('solo reduces the board to one layer regardless of visibility flags', () => {
    const layers = twoPents()
    const cells = resolveBoard(layers, { colorMode: 'families', soloId: layers[1].id })
    for (const cell of cells.values()) {
      expect(cell.entries).toHaveLength(1)
      expect(cell.entries[0].layer).toBe(layers[1])
    }
  })

  it('three layers stack three entries in order on common coords', () => {
    const layers = [pent({ pent: 'minor' }), pent({ pent: 'major' }), pent({ key: PC.C, pent: 'major' })]
    const cells = resolveBoard(layers, { colorMode: 'families' })
    // The pitch A lives in all three scales.
    const aCoord = coordsForPc(PC.A)[0]
    const cell = cells.get(coordKey(aCoord))
    expect(cell).toBeDefined()
    expect(cell!.entries.map((e) => e.layer)).toEqual(layers)
  })
})

describe('applyFilter', () => {
  it('shared/diff partition the cells; all is identity', () => {
    const cells = resolveBoard([pent({ pent: 'minor' }), pent({ pent: 'major' })], { colorMode: 'families' })
    const shared = applyFilter(cells, 'shared')
    const diff = applyFilter(cells, 'diff')
    expect(applyFilter(cells, 'all')).toBe(cells)
    expect(shared.size + diff.size).toBe(cells.size)
    expect(shared.size).toBe(sharedCount(cells))
    for (const c of shared.values()) expect(c.entries.length).toBeGreaterThanOrEqual(2)
    for (const c of diff.values()) expect(c.entries).toHaveLength(1)
  })
})

describe('entryColor', () => {
  it('tint wins outright', () => {
    expect(entryColor(pent(), 3, 'families')).toBe('#FFC94D')
  })

  it('degree mode follows the global palette', () => {
    const l = { ...pent(), color: { kind: 'degree' } as const }
    expect(entryColor(l, 7, 'families')).toBe('#4DD9A8')
    expect(entryColor(l, 7, 'rainbow')).toBe('#FF6161')
  })

  it('custom overrides win, gaps fall back to the palette', () => {
    const l = { ...pent(), color: { kind: 'custom', overrides: { 3: '#123456' } } as const }
    expect(entryColor(l, 3, 'families')).toBe('#123456')
    expect(entryColor(l, 7, 'families')).toBe('#4DD9A8')
  })

  it('keyless notes in palette modes read pearl', () => {
    const l = { ...shape([]), color: { kind: 'degree' } as const }
    expect(entryColor(l, undefined, 'families')).toBe(KEYLESS_COLOR)
  })
})

describe('wedgePath', () => {
  it('n=2 gives exact half-discs from 12 o’clock', () => {
    expect(wedgePath(0, 0, 10, 0, 2)).toBe('M 0 0 L 0 -10 A 10 10 0 0 1 0 10 Z')
    expect(wedgePath(0, 0, 10, 1, 2)).toBe('M 0 0 L 0 10 A 10 10 0 0 1 0 -10 Z')
  })

  it('n=3 tiles three 120° wedges, small-arc flags throughout', () => {
    expect(wedgePath(0, 0, 10, 0, 3)).toBe('M 0 0 L 0 -10 A 10 10 0 0 1 8.66 5 Z')
    expect(wedgePath(0, 0, 10, 1, 3)).toBe('M 0 0 L 8.66 5 A 10 10 0 0 1 -8.66 5 Z')
    expect(wedgePath(0, 0, 10, 2, 3)).toBe('M 0 0 L -8.66 5 A 10 10 0 0 1 0 -10 Z')
  })
})

describe('cellLabel', () => {
  const cellOf = (layer: PlaygroundLayer, degree: number | undefined): BoardCell => ({
    coord: { string: 0, fret: 5 }, // the pitch A on the low E
    entries: [{ layer, color: '#fff', ...(degree !== undefined ? { degree } : {}) }],
  })

  it('letter labels are key-agnostic', () => {
    expect(cellLabel(cellOf(pent(), 0), 'letter', PC.A)).toBe('A')
  })

  it('degree labels belong to the top entry', () => {
    expect(cellLabel(cellOf(pent(), 3), 'degree', PC.A)).toBe('b3')
  })

  it('mode label overrides are honored (Lydian #4)', () => {
    expect(cellLabel(cellOf(mode({ modeId: 'lydian' }), 6), 'degree', PC.A)).toBe('#4')
  })

  it('keyless shape notes fall back to the letter name', () => {
    expect(cellLabel(cellOf(shape([]), undefined), 'degree', PC.A)).toBe('A')
  })

  it('none hides labels', () => {
    expect(cellLabel(cellOf(pent(), 0), 'none', PC.A)).toBeUndefined()
  })
})

describe('boardKeyOf', () => {
  it('follows the topmost keyed visible layer, skipping shapes', () => {
    expect(boardKeyOf([shape([]), pent({ key: PC.C })])).toBe(PC.C)
  })

  it('defaults to A when only shapes are on the board', () => {
    expect(boardKeyOf([shape([])])).toBe(PC.A)
  })

  it('solo takes over', () => {
    const layers = [pent({ key: PC.C }), pent({ key: PC.G })]
    expect(boardKeyOf(layers, layers[1].id)).toBe(PC.G)
  })
})

describe('isDarkColor', () => {
  it('flags label-hostile dark fills, passes the palette and pearl', () => {
    expect(isDarkColor('#14100a')).toBe(true)
    expect(isDarkColor('#202030')).toBe(true)
    expect(isDarkColor('#FFC94D')).toBe(false)
    expect(isDarkColor('#F5ECD4')).toBe(false)
    expect(isDarkColor('not-a-colour')).toBe(false)
  })
})

describe('autoName', () => {
  it('describes each kind in the player’s language', () => {
    expect(autoName(pent({ position: 1 }))).toBe('A minor pent · box 1')
    expect(autoName(pent({ blueNote: true }))).toBe('A minor pent +blue')
    expect(autoName(mode({ key: PC.D }))).toBe('D Dorian')
    expect(autoName(shape([{ string: 0, fret: 3 }]))).toBe('shape · 1 note')
  })
})
