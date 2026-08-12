import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  MODES, NUM_STRINGS, PC, PENTATONIC_DEGREES, modeDegrees,
  type Degree, type FretCoord, type PentatonicKind, type PitchClass,
} from '../music-core'

/**
 * The Playground's neck runs to fret 22 (a full modern electric), unlike the
 * shared 17-fret board (music-core MAX_FRET, which stays untouched). This is
 * the one source of truth: the view threads it into Fretboard/markers/
 * resolution, and the coord clamp below uses it so persisted shape notes
 * above fret 17 survive rehydration.
 */
export const PLAYGROUND_MAX_FRET = 22

/**
 * Playground state: a stack of freely-composed fretboard layers (scales,
 * modes, degree sets, hand-built shapes), each with its own colour and
 * visibility, plus the shared-note overlap treatment and a saved-shape
 * library. Everything persists under one calliope: key, so the whole board
 * comes back exactly as it was left and rides the Stats backup for free.
 *
 * The Playground deliberately renders its own markers (see PlaygroundMarkers)
 * instead of extending the shared marker vocabulary — none of this state is
 * known to fretboard/ or music-core.
 */

export type OverlapStyle = 'ring' | 'split' | 'third' | 'top'
export type MarkerTreatment = 'solid' | 'outline' | 'dashed'
export type BoardFilter = 'all' | 'shared' | 'diff'

export type LayerColorConfig =
  | { kind: 'tint'; hex: string }
  | { kind: 'degree' } // the board palette: degreeColor(d, global colorMode)
  | { kind: 'custom'; overrides: Partial<Record<Degree, string>> } // gaps fall back to the palette

export interface LayerBase {
  /** Minted once at creation, never derived from config — stable React key. */
  id: string
  /** User override; display falls back to autoName(layer). */
  name?: string
  visible: boolean
  color: LayerColorConfig
  treatment: MarkerTreatment
  opacity: number // 0.25 | 0.5 | 0.75 | 1
}

export type PlaygroundLayer =
  | (LayerBase & {
      kind: 'pentatonic'
      key: PitchClass
      pent: PentatonicKind
      position: number | 'all'
      blueNote: boolean
    })
  | (LayerBase & { kind: 'mode'; key: PitchClass; modeId: string })
  | (LayerBase & { kind: 'degrees'; key: PitchClass; degrees: Degree[] })
  | (LayerBase & { kind: 'shape'; notes: FretCoord[] })

export type LayerKind = PlaygroundLayer['kind']

export interface SavedShape {
  id: string
  name: string
  notes: FretCoord[]
  createdAt: number
}

/** The persisted slice (everything except the actions). */
export interface PlaygroundData {
  layers: PlaygroundLayer[] // index 0 = TOP of the paint stack
  overlap: OverlapStyle
  sharedColor: string // the "third colour"
  filter: BoardFilter
  soloId: string | null
  editingId: string | null // shape layer currently receiving board taps
  savedShapes: SavedShape[]
}

/**
 * Big tap-friendly colour chips. All pulled from the validated board palettes
 * (plus pearl and silver) so the defaults stay CVD-separated on the black
 * board; the colour wheel is the anything-goes escape hatch beside them.
 */
export const PRESET_SWATCHES: string[] = [
  '#FFC94D', '#FF8A5C', '#FF6161', '#FF6FA5', '#E879F9', '#B99CFF',
  '#8F9BFF', '#6FA8FF', '#5AC8FA', '#3FE0C5', '#4DD9A8', '#8FE388',
  '#D4E157', '#F5ECD4', '#8A8A92',
]

let mint = 0
function mintId(): string {
  mint += 1
  return `pg-${Date.now().toString(36)}-${mint}-${Math.random().toString(36).slice(2, 6)}`
}

/** First preset not already used as a tint, so new layers arrive distinct. */
function nextSwatch(layers: PlaygroundLayer[]): string {
  const used = new Set(
    layers.map((l) => (l.color.kind === 'tint' ? l.color.hex.toUpperCase() : '')),
  )
  return (
    PRESET_SWATCHES.find((hex) => !used.has(hex.toUpperCase()))
    ?? PRESET_SWATCHES[layers.length % PRESET_SWATCHES.length]
  )
}

function newLayer(kind: LayerKind, existing: PlaygroundLayer[]): PlaygroundLayer {
  const base: LayerBase = {
    id: mintId(),
    visible: true,
    color: { kind: 'tint', hex: nextSwatch(existing) },
    treatment: 'solid',
    opacity: 1,
  }
  switch (kind) {
    case 'pentatonic':
      return { ...base, kind, key: PC.A, pent: 'minor', position: 'all', blueNote: false }
    case 'mode':
      return { ...base, kind, key: PC.A, modeId: 'dorian' }
    case 'degrees':
      return { ...base, kind, key: PC.A, degrees: [0, 4, 7] }
    case 'shape':
      return { ...base, kind, notes: [] }
  }
}

/** The zero-setup two-scale case: his home key, both skeletons, distinct tints. */
export function defaultLayers(): PlaygroundLayer[] {
  return [
    {
      id: mintId(), kind: 'pentatonic', key: PC.A, pent: 'minor', position: 'all',
      blueNote: false, visible: true, color: { kind: 'tint', hex: '#FFC94D' },
      treatment: 'solid', opacity: 1,
    },
    {
      id: mintId(), kind: 'pentatonic', key: PC.A, pent: 'major', position: 'all',
      blueNote: false, visible: true, color: { kind: 'tint', hex: '#5AC8FA' },
      treatment: 'solid', opacity: 1,
    },
  ]
}

export function defaultData(): PlaygroundData {
  return {
    layers: defaultLayers(),
    overlap: 'ring',
    sharedColor: '#F5ECD4',
    filter: 'all',
    soloId: null,
    editingId: null,
    savedShapes: [],
  }
}

// ---- persisted-payload hardening -----------------------------------------
// zustand's shallow merge covers new top-level fields; everything nested
// (layers, shapes) is re-validated here on every rehydrate, so a stale or
// hand-edited backup can never crash the view.

const OVERLAP_STYLES: OverlapStyle[] = ['ring', 'split', 'third', 'top']
const TREATMENTS: MarkerTreatment[] = ['solid', 'outline', 'dashed']
const FILTERS: BoardFilter[] = ['all', 'shared', 'diff']
const HEX_RE = /^#[0-9a-fA-F]{6}$/

function asHex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX_RE.test(v) ? v : fallback
}

function asPc(v: unknown): PitchClass | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 11 ? v : null
}

function asCoord(v: unknown): FretCoord | null {
  if (typeof v !== 'object' || v === null) return null
  const { string, fret } = v as Record<string, unknown>
  if (typeof string !== 'number' || !Number.isInteger(string)) return null
  if (typeof fret !== 'number' || !Number.isInteger(fret)) return null
  if (string < 0 || string >= NUM_STRINGS || fret < 0 || fret > PLAYGROUND_MAX_FRET) return null
  return { string, fret }
}

function asCoords(v: unknown): FretCoord[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: FretCoord[] = []
  for (const raw of v) {
    const c = asCoord(raw)
    if (!c) continue
    const k = `${c.string}:${c.fret}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

function asColor(v: unknown): LayerColorConfig {
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    if (o.kind === 'degree') return { kind: 'degree' }
    if (o.kind === 'tint') return { kind: 'tint', hex: asHex(o.hex, '#FFC94D') }
    if (o.kind === 'custom') {
      const overrides: Partial<Record<Degree, string>> = {}
      if (typeof o.overrides === 'object' && o.overrides !== null) {
        for (const [k, hex] of Object.entries(o.overrides)) {
          const d = Number(k)
          if (Number.isInteger(d) && d >= 0 && d <= 11 && typeof hex === 'string' && HEX_RE.test(hex)) {
            overrides[d] = hex
          }
        }
      }
      return { kind: 'custom', overrides }
    }
  }
  return { kind: 'tint', hex: '#FFC94D' }
}

function normalizeLayer(v: unknown, usedIds: Set<string>): PlaygroundLayer | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id !== '' && !usedIds.has(o.id) ? o.id : mintId()
  usedIds.add(id)
  const base: LayerBase = {
    id,
    visible: typeof o.visible === 'boolean' ? o.visible : true,
    color: asColor(o.color),
    treatment: TREATMENTS.includes(o.treatment as MarkerTreatment)
      ? (o.treatment as MarkerTreatment)
      : 'solid',
    opacity: typeof o.opacity === 'number' && o.opacity > 0 && o.opacity <= 1 ? o.opacity : 1,
  }
  if (typeof o.name === 'string' && o.name.trim() !== '') base.name = o.name
  const key = asPc(o.key) ?? PC.A
  switch (o.kind) {
    case 'pentatonic':
      return {
        ...base, kind: 'pentatonic', key,
        pent: o.pent === 'major' ? 'major' : 'minor',
        position:
          o.position === 'all'
            ? 'all'
            : typeof o.position === 'number' && Number.isInteger(o.position)
                && o.position >= 1 && o.position <= 5
              ? o.position
              : 'all',
        blueNote: o.blueNote === true,
      }
    case 'mode':
      return {
        ...base, kind: 'mode', key,
        modeId: MODES.some((m) => m.id === o.modeId) ? (o.modeId as string) : 'dorian',
      }
    case 'degrees': {
      const list = Array.isArray(o.degrees)
        ? [...new Set(o.degrees.filter(
            (d): d is Degree => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 11,
          ))].sort((a, b) => a - b)
        : [0, 4, 7]
      return { ...base, kind: 'degrees', key, degrees: list }
    }
    case 'shape':
      return {
        ...base,
        // Keyless layers can't wear the palette modes (see setLayerKind).
        color: base.color.kind === 'tint' ? base.color : { kind: 'tint', hex: '#F5ECD4' },
        kind: 'shape',
        notes: asCoords(o.notes),
      }
    default:
      return null // unknown kind: drop the layer, keep the rest
  }
}

function normalizeSavedShape(v: unknown, usedIds: Set<string>): SavedShape | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.name !== 'string' || o.name.trim() === '') return null
  const notes = asCoords(o.notes)
  if (notes.length === 0) return null
  const id = typeof o.id === 'string' && o.id !== '' && !usedIds.has(o.id) ? o.id : mintId()
  usedIds.add(id)
  return {
    id, name: o.name, notes,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
  }
}

/** Tolerantly rebuild a full PlaygroundData from any persisted payload. */
export function normalizePersisted(raw: unknown): PlaygroundData {
  const d = defaultData()
  if (typeof raw !== 'object' || raw === null) return d
  const o = raw as Record<string, unknown>

  const layerIds = new Set<string>()
  const kept = Array.isArray(o.layers)
    ? o.layers.map((l) => normalizeLayer(l, layerIds)).filter((l): l is PlaygroundLayer => l !== null)
    : []
  // An empty/invalid stack falls back to the two-pent default (an empty board
  // is a dead end; `reset` exists for on-purpose clearing mid-session).
  const layers = kept.length > 0 ? kept : d.layers

  const validId = (v: unknown): string | null =>
    typeof v === 'string' && layers.some((l) => l.id === v) ? v : null
  const editingId = validId(o.editingId)

  return {
    layers,
    overlap: OVERLAP_STYLES.includes(o.overlap as OverlapStyle) ? (o.overlap as OverlapStyle) : 'ring',
    sharedColor: asHex(o.sharedColor, d.sharedColor),
    filter: FILTERS.includes(o.filter as BoardFilter) ? (o.filter as BoardFilter) : 'all',
    soloId: validId(o.soloId),
    editingId:
      editingId !== null && layers.find((l) => l.id === editingId)?.kind === 'shape'
        ? editingId
        : null,
    savedShapes: normalizeShapes(o.savedShapes),
  }
}

function normalizeShapes(v: unknown): SavedShape[] {
  const ids = new Set<string>()
  return Array.isArray(v)
    ? v.map((s) => normalizeSavedShape(s, ids)).filter((s): s is SavedShape => s !== null)
    : []
}

// ---- the store ------------------------------------------------------------

interface PlaygroundActions {
  addLayer: (kind: LayerKind) => void
  addSavedShapeLayer: (shapeId: string) => void
  removeLayer: (id: string) => void
  moveLayer: (id: string, dir: -1 | 1) => void // -1 = toward the top of the stack
  patchLayer: (id: string, patch: Partial<PlaygroundLayer>) => void
  setLayerKind: (id: string, kind: LayerKind) => void
  toggleVisible: (id: string) => void
  setSolo: (id: string | null) => void // same id again releases
  setOverlap: (s: OverlapStyle) => void
  setSharedColor: (hex: string) => void
  setFilter: (f: BoardFilter) => void
  toggleShapeNote: (id: string, coord: FretCoord) => void
  setEditing: (id: string | null) => void
  saveShape: (layerId: string, name: string) => void
  deleteSavedShape: (id: string) => void
  resetLayers: () => void
}

export type PlaygroundState = PlaygroundData & PlaygroundActions

export const usePlayground = create<PlaygroundState>()(
  persist(
    (set) => ({
      ...defaultData(),

      addLayer: (kind) =>
        set((s) => {
          const layer = newLayer(kind, s.layers)
          return {
            layers: [layer, ...s.layers],
            // A new shape arms editing, and editing implies seeing: a live
            // solo on another layer would hide the very notes being placed.
            editingId: kind === 'shape' ? layer.id : s.editingId,
            soloId: kind === 'shape' ? null : s.soloId,
          }
        }),

      addSavedShapeLayer: (shapeId) =>
        set((s) => {
          const shape = s.savedShapes.find((sh) => sh.id === shapeId)
          if (!shape) return s
          const layer: PlaygroundLayer = {
            ...newLayer('shape', s.layers),
            kind: 'shape',
            name: shape.name,
            notes: [...shape.notes],
          }
          return { layers: [layer, ...s.layers] }
        }),

      removeLayer: (id) =>
        set((s) => ({
          layers: s.layers.filter((l) => l.id !== id),
          soloId: s.soloId === id ? null : s.soloId,
          editingId: s.editingId === id ? null : s.editingId,
        })),

      moveLayer: (id, dir) =>
        set((s) => {
          const i = s.layers.findIndex((l) => l.id === id)
          const j = i + dir
          if (i < 0 || j < 0 || j >= s.layers.length) return s
          const layers = [...s.layers]
          ;[layers[i], layers[j]] = [layers[j], layers[i]]
          return { layers }
        }),

      patchLayer: (id, patch) =>
        set((s) => ({
          layers: s.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as PlaygroundLayer) : l)),
        })),

      setLayerKind: (id, kind) =>
        set((s) => {
          const target = s.layers.find((l) => l.id === id)
          // True no-op when the kind isn't changing — clicking the already-
          // active seg button must not (re-)arm shape editing.
          if (!target || target.kind === kind) return s
          return {
            layers: s.layers.map((l) => {
              if (l.id !== id) return l
              const base: LayerBase = {
                id: l.id, visible: l.visible, color: l.color,
                treatment: l.treatment, opacity: l.opacity,
              }
              if (l.name !== undefined) base.name = l.name
              const key = l.kind === 'shape' ? PC.A : l.key
              switch (kind) {
                case 'pentatonic': {
                  const pent: PentatonicKind =
                    l.kind === 'mode'
                      ? MODES.find((m) => m.id === l.modeId)?.skeleton ?? 'minor'
                      : 'minor'
                  return { ...base, kind, key, pent, position: 'all' as const, blueNote: false }
                }
                case 'mode': {
                  const modeId =
                    l.kind === 'pentatonic' ? (l.pent === 'major' ? 'mixolydian' : 'dorian') : 'dorian'
                  return { ...base, kind, key, modeId }
                }
                case 'degrees': {
                  const mode = l.kind === 'mode' ? MODES.find((m) => m.id === l.modeId) : undefined
                  const degrees: Degree[] =
                    l.kind === 'pentatonic'
                      ? [...PENTATONIC_DEGREES[l.pent]]
                      : mode
                        ? modeDegrees(mode)
                        : [0, 4, 7]
                  return { ...base, kind, key, degrees }
                }
                case 'shape':
                  return {
                    ...base,
                    // Shapes are keyless: the palette colour modes have nothing
                    // to key off, so land on a tint the shape UI can represent.
                    color:
                      base.color.kind === 'tint'
                        ? base.color
                        : { kind: 'tint', hex: '#F5ECD4' },
                    kind,
                    notes: [],
                  }
              }
            }),
            editingId: kind === 'shape' ? id : s.editingId === id ? null : s.editingId,
            soloId: kind === 'shape' && s.soloId !== null && s.soloId !== id ? null : s.soloId,
          }
        }),

      toggleVisible: (id) =>
        set((s) => ({
          layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
          // Hiding the layer being edited ends the edit — taps must never
          // keep mutating an invisible shape.
          editingId:
            s.editingId === id && s.layers.find((l) => l.id === id)?.visible === true
              ? null
              : s.editingId,
        })),

      setSolo: (id) =>
        set((s) => {
          const soloId = s.soloId === id ? null : id
          return {
            soloId,
            // Soloing a different layer hides the shape being edited.
            editingId:
              soloId !== null && s.editingId !== null && s.editingId !== soloId
                ? null
                : s.editingId,
          }
        }),
      setOverlap: (overlap) => set({ overlap }),
      setSharedColor: (sharedColor) => set({ sharedColor }),
      setFilter: (filter) => set({ filter }),

      toggleShapeNote: (id, coord) =>
        set((s) => ({
          layers: s.layers.map((l) => {
            if (l.id !== id || l.kind !== 'shape') return l
            const held = l.notes.some((n) => n.string === coord.string && n.fret === coord.fret)
            return {
              ...l,
              notes: held
                ? l.notes.filter((n) => !(n.string === coord.string && n.fret === coord.fret))
                : [...l.notes, coord],
            }
          }),
        })),

      setEditing: (editingId) =>
        set((s) => {
          if (editingId === null) return { editingId: null }
          return {
            editingId,
            // Editing implies seeing: surface the layer, release a foreign solo.
            layers: s.layers.map((l) =>
              l.id === editingId && !l.visible ? { ...l, visible: true } : l,
            ),
            soloId: s.soloId !== null && s.soloId !== editingId ? null : s.soloId,
          }
        }),

      saveShape: (layerId, name) =>
        set((s) => {
          const layer = s.layers.find((l) => l.id === layerId)
          if (!layer || layer.kind !== 'shape' || layer.notes.length === 0 || name.trim() === '') {
            return s
          }
          const shape: SavedShape = {
            id: mintId(), name: name.trim(), notes: [...layer.notes], createdAt: Date.now(),
          }
          return { savedShapes: [...s.savedShapes, shape] }
        }),

      deleteSavedShape: (id) =>
        set((s) => ({ savedShapes: s.savedShapes.filter((sh) => sh.id !== id) })),

      // Resets the board, never the library — saved shapes are the one thing
      // "reset" must not be able to destroy.
      resetLayers: () => set((s) => ({ ...defaultData(), savedShapes: s.savedShapes })),
    }),
    {
      name: 'calliope:playground',
      version: 1,
      migrate: (persisted) => normalizePersisted(persisted) as PlaygroundState,
      // Runs on every rehydrate (not just version bumps): harden nested shapes.
      merge: (persisted, current) =>
        persisted === undefined ? current : { ...current, ...normalizePersisted(persisted) },
    },
  ),
)
