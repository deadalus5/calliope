import {
  BLUE_NOTE, MAX_FRET, MODES, PC, PENTATONIC_DEGREES, coordToPc, coordsForPc, degreeLabel,
  fullNeck, modeDegrees, pcName, pcOfDegree, pentatonicPosition,
  type Degree, type FretCoord, type PitchClass,
} from '../../music-core'
import { degreeColor, type ColorMode } from '../../fretboard/palette'
import type { LabelStyle } from '../../state/board-prefs'
import type { BoardFilter, PlaygroundLayer } from '../../state/playground'

/**
 * Pure board resolution for the Playground: expand each layer's config into
 * concrete fret coordinates, stack them into per-coordinate cells (top layer
 * first), and answer the overlap/filter/label questions the marker renderer
 * asks. No DOM, no store — everything here is unit-tested directly.
 */

export const coordKey = (c: FretCoord): string => `${c.string}:${c.fret}`

export interface LayerNote {
  coord: FretCoord
  /** Relative to the layer's own key; undefined for (keyless) shape notes. */
  degree?: Degree
}

function dedupe(notes: LayerNote[]): LayerNote[] {
  const seen = new Set<string>()
  return notes.filter((n) => {
    const k = coordKey(n.coord)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function blueNotes(key: PitchClass, maxFret: number): LayerNote[] {
  return coordsForPc(pcOfDegree(BLUE_NOTE, key), maxFret).map((coord) => ({
    coord,
    degree: BLUE_NOTE,
  }))
}

/** Every note a layer paints, in its own key's degree vocabulary. */
export function layerNotes(layer: PlaygroundLayer, maxFret = MAX_FRET): LayerNote[] {
  switch (layer.kind) {
    case 'pentatonic': {
      if (layer.position === 'all') {
        const notes: LayerNote[] = fullNeck(layer.key, layer.pent, maxFret).map((n) => ({
          coord: n.coord,
          degree: n.degree,
        }))
        if (layer.blueNote) notes.push(...blueNotes(layer.key, maxFret))
        return dedupe(notes)
      }
      const box = pentatonicPosition(layer.key, layer.pent, layer.position)
      const notes: LayerNote[] = box.notes.map((n) => ({ coord: n.coord, degree: n.degree }))
      if (layer.blueNote) {
        // Clip the blue note to the box window — it's a bend/passing colour
        // inside the shape he's holding, not a whole-neck sprinkle.
        notes.push(
          ...blueNotes(layer.key, maxFret).filter(
            (n) => n.coord.fret >= box.minFret && n.coord.fret <= box.maxFret,
          ),
        )
      }
      return dedupe(notes)
    }
    case 'mode': {
      const mode = MODES.find((m) => m.id === layer.modeId)
      if (!mode) return []
      return dedupe(
        modeDegrees(mode).flatMap((d) =>
          coordsForPc(pcOfDegree(d, layer.key), maxFret).map((coord) => ({ coord, degree: d })),
        ),
      )
    }
    case 'degrees':
      return dedupe(
        layer.degrees.flatMap((d) =>
          coordsForPc(pcOfDegree(d, layer.key), maxFret).map((coord) => ({ coord, degree: d })),
        ),
      )
    case 'shape':
      return dedupe(
        layer.notes
          .filter((c) => c.fret >= 0 && c.fret <= maxFret)
          .map((coord) => ({ coord })),
      )
  }
}

/** The degrees a layer can contain (drives the per-degree colour editor). */
export function layerDegrees(layer: PlaygroundLayer): Degree[] {
  switch (layer.kind) {
    case 'pentatonic': {
      const degrees = [...PENTATONIC_DEGREES[layer.pent]]
      if (layer.blueNote) degrees.push(BLUE_NOTE)
      return degrees.sort((a, b) => a - b)
    }
    case 'mode': {
      const mode = MODES.find((m) => m.id === layer.modeId)
      return mode ? modeDegrees(mode) : []
    }
    case 'degrees':
      return layer.degrees
    case 'shape':
      return []
  }
}

/** Colour for one note of one layer: tint wins, custom overrides, palette otherwise. */
export const KEYLESS_COLOR = '#F5ECD4'

export function entryColor(
  layer: PlaygroundLayer,
  degree: Degree | undefined,
  colorMode: ColorMode,
): string {
  const c = layer.color
  if (c.kind === 'tint') return c.hex
  if (degree === undefined) return KEYLESS_COLOR
  if (c.kind === 'custom') return c.overrides[degree] ?? degreeColor(degree, colorMode)
  return degreeColor(degree, colorMode)
}

export interface BoardEntry {
  layer: PlaygroundLayer
  degree?: Degree
  color: string
}

export interface BoardCell {
  coord: FretCoord
  /** Ordered top-of-stack first — entries[0] owns occlusion, labels, cores. */
  entries: BoardEntry[]
}

export interface ResolveOpts {
  colorMode: ColorMode
  soloId?: string | null
  maxFret?: number
}

function visibleLayers(layers: PlaygroundLayer[], soloId?: string | null): PlaygroundLayer[] {
  const solo = soloId ? layers.find((l) => l.id === soloId) : undefined
  return solo ? [solo] : layers.filter((l) => l.visible)
}

/** Stack every visible layer's notes into per-coordinate cells. */
export function resolveBoard(
  layers: PlaygroundLayer[],
  opts: ResolveOpts,
): Map<string, BoardCell> {
  const maxFret = opts.maxFret ?? MAX_FRET
  const cells = new Map<string, BoardCell>()
  for (const layer of visibleLayers(layers, opts.soloId)) {
    for (const n of layerNotes(layer, maxFret)) {
      const k = coordKey(n.coord)
      let cell = cells.get(k)
      if (!cell) {
        cell = { coord: n.coord, entries: [] }
        cells.set(k, cell)
      }
      const entry: BoardEntry = {
        layer,
        color: entryColor(layer, n.degree, opts.colorMode),
      }
      if (n.degree !== undefined) entry.degree = n.degree
      cell.entries.push(entry)
    }
  }
  return cells
}

/** Overlap = the same string+fret in two or more visible layers. */
export function sharedCount(cells: Map<string, BoardCell>): number {
  let n = 0
  for (const cell of cells.values()) if (cell.entries.length >= 2) n++
  return n
}

export function applyFilter(
  cells: Map<string, BoardCell>,
  filter: BoardFilter,
): Map<string, BoardCell> {
  if (filter === 'all') return cells
  const out = new Map<string, BoardCell>()
  for (const [k, cell] of cells) {
    const shared = cell.entries.length >= 2
    if (filter === 'shared' ? shared : !shared) out.set(k, cell)
  }
  return out
}

/**
 * One wedge of an n-way split disc, wedge i starting at 12 o'clock and going
 * clockwise. n=2 gives exact half-discs; any n >= 2 tiles the full circle.
 */
export function wedgePath(cx: number, cy: number, r: number, i: number, n: number): string {
  const f = (v: number) => Number(v.toFixed(2))
  const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n
  const a1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / n
  const large = a1 - a0 > Math.PI ? 1 : 0
  const x0 = f(cx + r * Math.cos(a0))
  const y0 = f(cy + r * Math.sin(a0))
  const x1 = f(cx + r * Math.cos(a1))
  const y1 = f(cy + r * Math.sin(a1))
  return `M ${f(cx)} ${f(cy)} L ${x0} ${y0} A ${f(r)} ${f(r)} 0 ${large} 1 ${x1} ${y1} Z`
}

/**
 * The label a cell shows. Letters are key-agnostic and always unambiguous;
 * degree labels belong to the TOP entry — the same rule paint order already
 * establishes, so reordering layers visibly hands over the ink. Shape notes
 * have no degree and fall back to the letter name.
 */
export function cellLabel(
  cell: BoardCell,
  labelStyle: LabelStyle,
  keyRoot: PitchClass,
): string | undefined {
  if (labelStyle === 'none') return undefined
  if (labelStyle === 'letter') return pcName(coordToPc(cell.coord), keyRoot)
  const top = cell.entries[0]
  if (top === undefined) return undefined
  if (top.degree === undefined) return pcName(coordToPc(cell.coord), keyRoot)
  const layer = top.layer
  const override =
    layer.kind === 'mode' ? MODES.find((m) => m.id === layer.modeId)?.labelOverride : undefined
  return degreeLabel(top.degree, override)
}

/** Anchor-row spelling follows the topmost keyed visible layer (home: A). */
export function boardKeyOf(layers: PlaygroundLayer[], soloId?: string | null): PitchClass {
  for (const l of visibleLayers(layers, soloId)) {
    if (l.kind !== 'shape') return l.key
  }
  return PC.A
}

/**
 * Perceived-brightness test (hex #rrggbb) — decides whether a solid disc
 * needs the light haloed label instead of the default dark ink, so labels
 * survive any colour the wheel can produce.
 */
export function isDarkColor(hex: string): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (m === null) return false
  const v = parseInt(m[1], 16)
  const r = (v >> 16) & 0xff
  const g = (v >> 8) & 0xff
  const b = v & 0xff
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5
}

/** Display name when the user hasn't renamed a layer. */
export function autoName(layer: PlaygroundLayer): string {
  switch (layer.kind) {
    case 'pentatonic': {
      const pos = layer.position === 'all' ? '' : ` · box ${layer.position}`
      const blue = layer.blueNote ? ' +blue' : ''
      return `${pcName(layer.key, layer.key)} ${layer.pent} pent${pos}${blue}`
    }
    case 'mode': {
      const mode = MODES.find((m) => m.id === layer.modeId)
      return `${pcName(layer.key, layer.key)} ${mode?.name ?? layer.modeId}`
    }
    case 'degrees':
      return layer.degrees.length === 0
        ? `${pcName(layer.key, layer.key)} · no degrees yet`
        : `${pcName(layer.key, layer.key)} · ${layer.degrees.map((d) => degreeLabel(d)).join(' ')}`
    case 'shape':
      return `shape · ${layer.notes.length} note${layer.notes.length === 1 ? '' : 's'}`
  }
}
