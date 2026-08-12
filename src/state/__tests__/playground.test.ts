import { beforeEach, describe, expect, it } from 'vitest'

// Same jsdom guard as app-prefs.test.ts: a real in-memory Storage must exist
// on `window` BEFORE the store module evaluates, because Zustand's persist
// hydrates from localStorage synchronously at module-eval time.
if (typeof window.localStorage?.setItem !== 'function') {
  class MemoryStorage implements Storage {
    private map = new Map<string, string>()
    get length() {
      return this.map.size
    }
    clear() {
      this.map.clear()
    }
    getItem(key: string) {
      return this.map.has(key) ? this.map.get(key)! : null
    }
    key(index: number) {
      return Array.from(this.map.keys())[index] ?? null
    }
    removeItem(key: string) {
      this.map.delete(key)
    }
    setItem(key: string, value: string) {
      this.map.set(key, String(value))
    }
  }
  Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true })
}

const { defaultData, normalizePersisted, usePlayground } = await import('../playground')

describe('playground store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    usePlayground.setState(defaultData())
  })

  it('defaults to the two-pent A stack with ring overlap', () => {
    const s = usePlayground.getState()
    expect(s.layers).toHaveLength(2)
    expect(s.layers[0]).toMatchObject({ kind: 'pentatonic', pent: 'minor', position: 'all' })
    expect(s.layers[1]).toMatchObject({ kind: 'pentatonic', pent: 'major' })
    expect(s.layers[0].id).not.toBe(s.layers[1].id)
    expect(s.overlap).toBe('ring')
    expect(s.filter).toBe('all')
    expect(s.soloId).toBeNull()
    expect(s.editingId).toBeNull()
  })

  it('addLayer inserts on top; a new shape layer arms editing', () => {
    usePlayground.getState().addLayer('shape')
    const s = usePlayground.getState()
    expect(s.layers).toHaveLength(3)
    expect(s.layers[0].kind).toBe('shape')
    expect(s.editingId).toBe(s.layers[0].id)
  })

  it('new layers arrive with a tint no other layer is wearing', () => {
    usePlayground.getState().addLayer('pentatonic')
    const s = usePlayground.getState()
    const tints = s.layers.map((l) => (l.color.kind === 'tint' ? l.color.hex : ''))
    expect(new Set(tints).size).toBe(tints.length)
  })

  it('toggleShapeNote adds then removes a coord', () => {
    usePlayground.getState().addLayer('shape')
    const id = usePlayground.getState().layers[0].id
    usePlayground.getState().toggleShapeNote(id, { string: 2, fret: 5 })
    expect(usePlayground.getState().layers[0]).toMatchObject({ notes: [{ string: 2, fret: 5 }] })
    usePlayground.getState().toggleShapeNote(id, { string: 2, fret: 5 })
    expect(usePlayground.getState().layers[0]).toMatchObject({ notes: [] })
  })

  it('moveLayer swaps neighbours without touching ids; edges are no-ops', () => {
    const [a, b] = usePlayground.getState().layers
    usePlayground.getState().moveLayer(b.id, -1)
    expect(usePlayground.getState().layers.map((l) => l.id)).toEqual([b.id, a.id])
    usePlayground.getState().moveLayer(b.id, -1) // already on top
    expect(usePlayground.getState().layers.map((l) => l.id)).toEqual([b.id, a.id])
  })

  it('removing the soloed layer releases solo', () => {
    const [a] = usePlayground.getState().layers
    usePlayground.getState().setSolo(a.id)
    usePlayground.getState().removeLayer(a.id)
    const s = usePlayground.getState()
    expect(s.layers).toHaveLength(1)
    expect(s.soloId).toBeNull()
  })

  it('soloing the same layer again releases it', () => {
    const [a] = usePlayground.getState().layers
    usePlayground.getState().setSolo(a.id)
    expect(usePlayground.getState().soloId).toBe(a.id)
    usePlayground.getState().setSolo(a.id)
    expect(usePlayground.getState().soloId).toBeNull()
  })

  it('setLayerKind converts in place, preserving id/visuals/key', () => {
    const [a] = usePlayground.getState().layers // A minor pent
    usePlayground.getState().setLayerKind(a.id, 'mode')
    let l = usePlayground.getState().layers[0]
    expect(l).toMatchObject({ id: a.id, kind: 'mode', modeId: 'dorian', color: a.color })
    usePlayground.getState().setLayerKind(a.id, 'degrees')
    l = usePlayground.getState().layers[0]
    // dorian's full degree set rides along into the degree picker
    expect(l).toMatchObject({ kind: 'degrees', degrees: [0, 2, 3, 5, 7, 9, 10] })
  })

  it('a major pent converts to mixolydian', () => {
    const b = usePlayground.getState().layers[1]
    usePlayground.getState().setLayerKind(b.id, 'mode')
    expect(usePlayground.getState().layers[1]).toMatchObject({ modeId: 'mixolydian' })
  })

  it('saveShape → addSavedShapeLayer round-trips the coords with a fresh layer', () => {
    usePlayground.getState().addLayer('shape')
    const id = usePlayground.getState().layers[0].id
    usePlayground.getState().toggleShapeNote(id, { string: 2, fret: 5 })
    usePlayground.getState().toggleShapeNote(id, { string: 3, fret: 5 })
    usePlayground.getState().saveShape(id, 'riff one')
    const { savedShapes } = usePlayground.getState()
    expect(savedShapes).toHaveLength(1)
    expect(savedShapes[0].name).toBe('riff one')

    usePlayground.getState().addSavedShapeLayer(savedShapes[0].id)
    const top = usePlayground.getState().layers[0]
    expect(top.kind).toBe('shape')
    expect(top.id).not.toBe(id)
    expect(top).toMatchObject({ name: 'riff one', notes: [{ string: 2, fret: 5 }, { string: 3, fret: 5 }] })
  })

  it('saveShape refuses empty names and empty shapes', () => {
    usePlayground.getState().addLayer('shape')
    const id = usePlayground.getState().layers[0].id
    usePlayground.getState().saveShape(id, 'empty')
    usePlayground.getState().toggleShapeNote(id, { string: 1, fret: 1 })
    usePlayground.getState().saveShape(id, '   ')
    expect(usePlayground.getState().savedShapes).toHaveLength(0)
  })

  it('deleteSavedShape leaves layers alone', () => {
    usePlayground.getState().addLayer('shape')
    const id = usePlayground.getState().layers[0].id
    usePlayground.getState().toggleShapeNote(id, { string: 1, fret: 1 })
    usePlayground.getState().saveShape(id, 'keep me on the board')
    usePlayground.getState().deleteSavedShape(usePlayground.getState().savedShapes[0].id)
    const s = usePlayground.getState()
    expect(s.savedShapes).toHaveLength(0)
    expect(s.layers).toHaveLength(3)
  })

  it('resetLayers restores the two-pent default', () => {
    usePlayground.getState().addLayer('mode')
    usePlayground.getState().setOverlap('split')
    usePlayground.getState().resetLayers()
    const s = usePlayground.getState()
    expect(s.layers).toHaveLength(2)
    expect(s.overlap).toBe('ring')
  })

  it('resetLayers never touches the saved-shape library', () => {
    usePlayground.getState().addLayer('shape')
    const id = usePlayground.getState().layers[0].id
    usePlayground.getState().toggleShapeNote(id, { string: 1, fret: 3 })
    usePlayground.getState().saveShape(id, 'survivor')
    usePlayground.getState().resetLayers()
    expect(usePlayground.getState().savedShapes).toHaveLength(1)
    expect(usePlayground.getState().savedShapes[0].name).toBe('survivor')
  })

  it('clicking the already-active kind is a true no-op (never re-arms editing)', () => {
    usePlayground.getState().addLayer('shape')
    const id = usePlayground.getState().layers[0].id
    usePlayground.getState().setEditing(null)
    usePlayground.getState().setLayerKind(id, 'shape')
    expect(usePlayground.getState().editingId).toBeNull()
  })

  it('converting a palette-coloured layer to shape lands on a tint', () => {
    const [a] = usePlayground.getState().layers
    usePlayground.getState().patchLayer(a.id, { color: { kind: 'degree' } })
    usePlayground.getState().setLayerKind(a.id, 'shape')
    expect(usePlayground.getState().layers[0].color).toEqual({ kind: 'tint', hex: '#F5ECD4' })
  })

  it('hiding the layer being edited ends the edit', () => {
    usePlayground.getState().addLayer('shape')
    const id = usePlayground.getState().layers[0].id
    expect(usePlayground.getState().editingId).toBe(id)
    usePlayground.getState().toggleVisible(id)
    expect(usePlayground.getState().editingId).toBeNull()
  })

  it('soloing another layer ends the edit; soloing the edited layer keeps it', () => {
    usePlayground.getState().addLayer('shape')
    const [shapeLayer, other] = usePlayground.getState().layers
    usePlayground.getState().setSolo(shapeLayer.id)
    expect(usePlayground.getState().editingId).toBe(shapeLayer.id)
    usePlayground.getState().setSolo(other.id)
    expect(usePlayground.getState().editingId).toBeNull()
  })

  it('setEditing surfaces a hidden layer and releases a foreign solo', () => {
    usePlayground.getState().addLayer('shape')
    const [shapeLayer, other] = usePlayground.getState().layers
    usePlayground.getState().setEditing(null)
    usePlayground.getState().toggleVisible(shapeLayer.id) // hide it
    usePlayground.getState().setSolo(other.id)
    usePlayground.getState().setEditing(shapeLayer.id)
    const s = usePlayground.getState()
    expect(s.layers[0].visible).toBe(true)
    expect(s.soloId).toBeNull()
    expect(s.editingId).toBe(shapeLayer.id)
  })

  it('adding a shape while a solo is live releases the solo', () => {
    const [a] = usePlayground.getState().layers
    usePlayground.getState().setSolo(a.id)
    usePlayground.getState().addLayer('shape')
    expect(usePlayground.getState().soloId).toBeNull()
  })

  it('persists under the calliope:playground key', () => {
    usePlayground.getState().setOverlap('split')
    const raw = window.localStorage.getItem('calliope:playground')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.state.overlap).toBe('split')
    expect(parsed.state.layers).toHaveLength(2)
  })
})

describe('normalizePersisted', () => {
  it('garbage falls back to the full default', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      const d = normalizePersisted(junk)
      expect(d.layers).toHaveLength(2)
      expect(d.overlap).toBe('ring')
    }
  })

  it('an empty or fully-invalid stack falls back to the default layers, keeping prefs', () => {
    const d = normalizePersisted({ layers: [], overlap: 'split', savedShapes: [] })
    expect(d.layers).toHaveLength(2)
    expect(d.overlap).toBe('split')
  })

  it('drops unknown layer kinds but keeps the rest', () => {
    const good = { id: 'a', kind: 'pentatonic', key: 9, pent: 'minor', position: 1 }
    const d = normalizePersisted({ layers: [{ id: 'x', kind: 'laserharp' }, good] })
    expect(d.layers).toHaveLength(1)
    expect(d.layers[0]).toMatchObject({ id: 'a', kind: 'pentatonic', position: 1 })
  })

  it('fills missing per-layer fields with defaults', () => {
    const d = normalizePersisted({ layers: [{ id: 'a', kind: 'pentatonic' }] })
    expect(d.layers[0]).toMatchObject({
      visible: true, treatment: 'solid', opacity: 1,
      key: 9, pent: 'minor', position: 'all', blueNote: false,
    })
    expect(d.layers[0].color.kind).toBe('tint')
  })

  it('re-mints duplicate ids so React keys stay unique', () => {
    const d = normalizePersisted({
      layers: [
        { id: 'dup', kind: 'shape', notes: [] },
        { id: 'dup', kind: 'shape', notes: [] },
      ],
    })
    expect(d.layers).toHaveLength(2)
    expect(d.layers[0].id).not.toBe(d.layers[1].id)
    expect(d.layers[0].id).toBe('dup')
  })

  it('clamps shape coords to the Playground neck (22 frets) and dedupes them', () => {
    const d = normalizePersisted({
      layers: [{
        id: 'a', kind: 'shape',
        notes: [
          { string: 2, fret: 5 }, { string: 2, fret: 5 }, { string: 9, fret: 5 },
          { string: 0, fret: 22 }, { string: 0, fret: 23 }, { string: 0, fret: -1 }, 'junk',
        ],
      }],
    })
    // fret 22 survives (the Playground neck is longer than the shared board's 17)
    expect(d.layers[0]).toMatchObject({
      notes: [{ string: 2, fret: 5 }, { string: 0, fret: 22 }],
    })
  })

  it('drops dangling solo/editing refs; editing must point at a shape', () => {
    const pentLayer = { id: 'a', kind: 'pentatonic' }
    const d = normalizePersisted({ layers: [pentLayer], soloId: 'ghost', editingId: 'a' })
    expect(d.soloId).toBeNull()
    expect(d.editingId).toBeNull()
  })

  it('rejects invalid enum-ish fields and colours', () => {
    const d = normalizePersisted({
      layers: [{ id: 'a', kind: 'pentatonic', opacity: 7, treatment: 'sparkly' }],
      overlap: 'quantum', filter: 'some', sharedColor: 'not-a-colour',
    })
    expect(d.layers[0]).toMatchObject({ opacity: 1, treatment: 'solid' })
    expect(d.overlap).toBe('ring')
    expect(d.filter).toBe('all')
    expect(d.sharedColor).toBe('#F5ECD4')
  })

  it('coerces a palette colour on a persisted shape layer to a tint', () => {
    const d = normalizePersisted({
      layers: [{ id: 'a', kind: 'shape', notes: [], color: { kind: 'custom', overrides: {} } }],
    })
    expect(d.layers[0].color).toEqual({ kind: 'tint', hex: '#F5ECD4' })
  })

  it('keeps valid saved shapes, discards nameless or noteless ones', () => {
    const d = normalizePersisted({
      layers: [{ id: 'a', kind: 'pentatonic' }],
      savedShapes: [
        { id: 's1', name: 'riff', notes: [{ string: 1, fret: 3 }], createdAt: 5 },
        { id: 's2', name: '', notes: [{ string: 1, fret: 3 }] },
        { id: 's3', name: 'empty', notes: [] },
      ],
    })
    expect(d.savedShapes).toHaveLength(1)
    expect(d.savedShapes[0]).toMatchObject({ id: 's1', name: 'riff' })
  })
})
