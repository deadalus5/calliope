import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { playMidi } from '../../audio/audition'
import { exposeDebug } from '../../audio/debug'
import { Fretboard } from '../../fretboard/Fretboard'
import type { FretboardLayer } from '../../fretboard/layers'
import { degreeColor } from '../../fretboard/palette'
import type { ColorMode } from '../../fretboard/palette'
import { useBoardPrefs } from '../../state/board-prefs'
import {
  PLAYGROUND_MAX_FRET, PRESET_SWATCHES, usePlayground,
  type LayerKind, type PlaygroundLayer,
} from '../../state/playground'
import {
  MODES, PC, coordToMidi, degreeLabel, pcName,
  type Degree, type FretCoord, type PitchClass,
} from '../../music-core'
import {
  applyFilter, autoName, boardKeyOf, layerDegrees, layerNotes, resolveBoard, sharedCount,
} from './playground-model'
import { PlaygroundMarkers } from './PlaygroundMarkers'
import './playground.css'

/**
 * Playground: the free zone. Stack any scales, modes, degree sets and
 * hand-built shapes on one board, paint each layer however you like, and
 * choose how shared notes tell their story — ring, split disc, a third
 * colour, or plain top-wins. Nothing here drills or scores; it's the map
 * room with every marker under your control.
 */

const KEYS: PitchClass[] = [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]

const EMPTY_LAYERS: FretboardLayer[] = []

const OVERLAP_LABELS = {
  ring: 'ring', split: 'split', third: 'third colour', top: 'top wins',
} as const

const KIND_LABELS: Record<LayerKind, string> = {
  pentatonic: 'pent', mode: 'mode', degrees: 'degrees', shape: 'shape',
}

const OPACITY_STEPS = [0.25, 0.5, 0.75, 1] as const

export function PlaygroundView() {
  const pg = usePlayground()
  const colorMode = useBoardPrefs((s) => s.colorMode)
  const labelStyle = useBoardPrefs((s) => s.labelStyle)

  const cellsMap = useMemo(
    () => resolveBoard(pg.layers, { colorMode, soloId: pg.soloId, maxFret: PLAYGROUND_MAX_FRET }),
    [pg.layers, colorMode, pg.soloId],
  )
  const shared = useMemo(() => sharedCount(cellsMap), [cellsMap])
  // While a shape is being edited the filters pause: 'shared'/'diff' would
  // hide the very notes each tap creates or converts.
  const effectiveFilter = pg.editingId !== null ? 'all' : pg.filter
  const cells = useMemo(
    () => [...applyFilter(cellsMap, effectiveFilter).values()],
    [cellsMap, effectiveFilter],
  )
  const boardKey = useMemo(
    () => boardKeyOf(pg.layers, pg.soloId),
    [pg.layers, pg.soloId],
  )
  const visibleCount = pg.soloId !== null ? 1 : pg.layers.filter((l) => l.visible).length
  const editingLayer = pg.editingId !== null
    ? pg.layers.find((l) => l.id === pg.editingId)
    : undefined

  const { editingId, toggleShapeNote } = pg
  const handleTap = useCallback(
    (coord: FretCoord) => {
      playMidi(coordToMidi(coord))
      if (editingId !== null) toggleShapeNote(editingId, coord)
    },
    [editingId, toggleShapeNote],
  )

  useEffect(() => {
    exposeDebug({
      playgroundLayers: pg.layers.map((l) => ({
        id: l.id, kind: l.kind, visible: l.visible,
        noteCount: layerNotes(l, PLAYGROUND_MAX_FRET).length,
      })),
      playgroundOverlap: { style: pg.overlap, sharedCount: shared },
      playgroundFilter: pg.filter,
      playgroundEditing: pg.editingId,
      playgroundSavedShapes: pg.savedShapes.map((s) => ({
        id: s.id, name: s.name, notes: s.notes.length,
      })),
    })
  }, [pg.layers, pg.overlap, shared, pg.filter, pg.editingId, pg.savedShapes])

  return (
    <div>
      <div className="panel pg-intro">
        <h2>Playground</h2>
        <p>
          Your board, your colours. Stack scales and shapes as layers, paint each one
          your way, and pick how the notes they <b>share</b> get drawn. Tap any note to
          hear it — tap the board while editing a shape to build your own.
        </p>
      </div>

      <div className="panel">
        <div className="controls">
          <div className="control-group">
            <span className="control-label">Shared notes</span>
            <div className="seg pg-overlap">
              {(['ring', 'split', 'third', 'top'] as const).map((sty) => (
                <button
                  key={sty}
                  className={pg.overlap === sty ? 'active' : ''}
                  onClick={() => pg.setOverlap(sty)}
                >
                  {OVERLAP_LABELS[sty]}
                </button>
              ))}
            </div>
          </div>

          {pg.overlap === 'third' && (
            <div className="control-group pg-shared-picker">
              <SwatchRow value={pg.sharedColor} onPick={pg.setSharedColor} />
            </div>
          )}

          <div className="control-group">
            <span className="control-label">Show</span>
            <div className="seg pg-filter">
              {([['all', 'all'], ['shared', 'shared only'], ['diff', 'differences']] as const).map(
                ([value, text]) => (
                  <button
                    key={value}
                    className={pg.filter === value ? 'active' : ''}
                    disabled={pg.editingId !== null}
                    title={pg.editingId !== null ? 'filters pause while editing a shape' : undefined}
                    onClick={() => pg.setFilter(value)}
                  >
                    {text}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="control-group">
            <button className="pg-reset" onClick={pg.resetLayers}>reset</button>
          </div>
        </div>

        {pg.filter !== 'all' && visibleCount < 2 && (
          <p className="pg-hint">show two layers to compare — everything reads as “{pg.filter === 'shared' ? 'nothing shared' : 'all different'}” with one</p>
        )}
        {pg.overlap === 'ring' && visibleCount >= 4 && shared > 0 && (
          <p className="pg-hint">4+ layers — rings cap at three colours; split or third colour tells the whole story</p>
        )}

        {editingLayer !== undefined && (
          <div className="pg-edit-banner">
            <span>
              tap the board to add or remove notes in <b>{editingLayer.name ?? autoName(editingLayer)}</b>
            </span>
            <button onClick={() => pg.setEditing(null)}>done</button>
          </div>
        )}

        <Fretboard
          layers={EMPTY_LAYERS}
          keyRoot={boardKey}
          onNoteClick={handleTap}
          height={250}
          maxFret={PLAYGROUND_MAX_FRET}
        >
          <PlaygroundMarkers
            cells={cells}
            overlap={pg.overlap}
            sharedColor={pg.sharedColor}
            labelStyle={labelStyle}
            keyRoot={boardKey}
            editingId={pg.editingId}
            height={250}
            maxFret={PLAYGROUND_MAX_FRET}
          />
        </Fretboard>

        <div className="pg-legend">
          {pg.layers.map((l) => (
            <button
              key={l.id}
              className={
                `pg-chip${l.visible ? '' : ' pg-chip-off'}`
                + `${pg.soloId === l.id ? ' pg-chip-solo' : ''}`
              }
              title={l.visible ? 'tap to hide' : 'tap to show'}
              onClick={() => pg.toggleVisible(l.id)}
            >
              <i className="pg-dot-chip" style={layerDotStyle(l, colorMode)} />
              {l.name ?? autoName(l)}
            </button>
          ))}
          {shared > 0 && <span className="pg-chip pg-chip-shared">◐ {shared} shared</span>}
        </div>
      </div>

      <div className="panel">
        <div className="controls pg-add-row">
          <span className="control-label">Add layer</span>
          <button onClick={() => pg.addLayer('pentatonic')}>+ pentatonic</button>
          <button onClick={() => pg.addLayer('mode')}>+ mode</button>
          <button onClick={() => pg.addLayer('degrees')}>+ degrees</button>
          <button onClick={() => pg.addLayer('shape')}>+ shape</button>
          {pg.savedShapes.length > 0 && (
            <details className="pg-saved">
              <summary>saved shapes ({pg.savedShapes.length})</summary>
              <div className="pg-saved-list">
                {pg.savedShapes.map((s) => (
                  <span key={s.id} className="pg-saved-chip">
                    {s.name} · {s.notes.length}
                    <button onClick={() => pg.addSavedShapeLayer(s.id)}>add</button>
                    <button title="delete from library" onClick={() => pg.deleteSavedShape(s.id)}>✕</button>
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="pg-cards">
          {pg.layers.map((l, i) => (
            <LayerCard key={l.id} layer={l} index={i} count={pg.layers.length} colorMode={colorMode} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Tint → its swatch; palette modes → a three-stop gradient sampled from the
 * degrees the layer actually paints (first/middle/last), so the chip never
 * shows a colour the board doesn't.
 */
function layerDotStyle(l: PlaygroundLayer, colorMode: ColorMode): CSSProperties {
  if (l.color.kind === 'tint') return { background: l.color.hex }
  const overrides = l.color.kind === 'custom' ? l.color.overrides : {}
  const degs = layerDegrees(l)
  const [d1, d2, d3] = degs.length >= 3
    ? [degs[0], degs[Math.floor(degs.length / 2)], degs[degs.length - 1]]
    : [0, 4, 7]
  const c = (d: Degree) => overrides[d] ?? degreeColor(d, colorMode)
  return {
    background: `linear-gradient(135deg, ${c(d1)} 0 33%, ${c(d2)} 33% 66%, ${c(d3)} 66% 100%)`,
  }
}

interface LayerCardProps {
  layer: PlaygroundLayer
  index: number
  count: number
  colorMode: ColorMode
}

function LayerCard({ layer: l, index, count, colorMode }: LayerCardProps) {
  const pg = usePlayground()
  const [renaming, setRenaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')

  const commitRename = (raw: string) => {
    const name = raw.trim()
    pg.patchLayer(l.id, { name: name === '' || name === autoName(l) ? undefined : name })
    setRenaming(false)
  }

  const setColorKind = (kind: 'tint' | 'degree' | 'custom') => {
    if (l.color.kind === kind) return
    pg.patchLayer(l.id, {
      color:
        kind === 'tint'
          ? { kind: 'tint', hex: PRESET_SWATCHES[index % PRESET_SWATCHES.length] }
          : kind === 'degree'
            ? { kind: 'degree' }
            : { kind: 'custom', overrides: {} },
    })
  }

  const setOverride = (d: Degree, hex: string | null) => {
    if (l.color.kind !== 'custom') return
    const overrides = { ...l.color.overrides }
    if (hex === null) delete overrides[d]
    else overrides[d] = hex
    pg.patchLayer(l.id, { color: { kind: 'custom', overrides } })
  }

  return (
    <div className={`pg-card${l.visible ? '' : ' pg-card-hidden'}`}>
      <div className="pg-card-head">
        <div className="pg-order">
          <button disabled={index === 0} title="paint on top" onClick={() => pg.moveLayer(l.id, -1)}>▲</button>
          <button disabled={index === count - 1} title="paint underneath" onClick={() => pg.moveLayer(l.id, 1)}>▼</button>
        </div>
        <i className="pg-dot-chip" style={layerDotStyle(l, colorMode)} />
        {renaming ? (
          <input
            className="pg-name-input"
            autoFocus
            defaultValue={l.name ?? ''}
            placeholder={autoName(l)}
            onBlur={(e) => commitRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(e.currentTarget.value)
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button className="pg-name" title="rename" onClick={() => setRenaming(true)}>
            {l.name ?? autoName(l)}
          </button>
        )}
        <span className="pg-spacer" />
        <button className={l.visible ? 'active' : ''} onClick={() => pg.toggleVisible(l.id)}>
          {l.visible ? 'shown' : 'hidden'}
        </button>
        <button className={pg.soloId === l.id ? 'active' : ''} onClick={() => pg.setSolo(l.id)}>
          solo
        </button>
        <button title="remove layer" onClick={() => pg.removeLayer(l.id)}>✕</button>
      </div>

      <div className="controls pg-config">
        <div className="seg pg-kind">
          {(['pentatonic', 'mode', 'degrees', 'shape'] as const).map((k) => (
            <button
              key={k}
              className={l.kind === k ? 'active' : ''}
              onClick={() => pg.setLayerKind(l.id, k)}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {l.kind !== 'shape' && (
          <div className="control-group">
            <span className="control-label">Key</span>
            <select value={l.key} onChange={(e) => pg.patchLayer(l.id, { key: Number(e.target.value) })}>
              {KEYS.map((k) => (
                <option key={k} value={k}>{pcName(k, k)}</option>
              ))}
            </select>
          </div>
        )}

        {l.kind === 'pentatonic' && (
          <>
            <div className="seg">
              {(['minor', 'major'] as const).map((p) => (
                <button
                  key={p}
                  className={l.pent === p ? 'active' : ''}
                  onClick={() => pg.patchLayer(l.id, { pent: p })}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="seg pg-position">
              {[1, 2, 3, 4, 5].map((p) => (
                <button
                  key={p}
                  className={l.position === p ? 'active' : ''}
                  onClick={() => pg.patchLayer(l.id, { position: p })}
                >
                  {p}
                </button>
              ))}
              <button
                className={l.position === 'all' ? 'active' : ''}
                onClick={() => pg.patchLayer(l.id, { position: 'all' })}
              >
                all
              </button>
            </div>
            <button
              className={l.blueNote ? 'active' : ''}
              onClick={() => pg.patchLayer(l.id, { blueNote: !l.blueNote })}
            >
              + blue note
            </button>
          </>
        )}

        {l.kind === 'mode' && (
          <div className="control-group">
            <span className="control-label">Mode</span>
            <select value={l.modeId} onChange={(e) => pg.patchLayer(l.id, { modeId: e.target.value })}>
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.skeleton} + {m.colors.map((d) => degreeLabel(d, m.labelOverride)).join('·')}
                </option>
              ))}
            </select>
          </div>
        )}

        {l.kind === 'shape' && (
          <>
            <span className="pg-note-count mono">{l.notes.length} note{l.notes.length === 1 ? '' : 's'}</span>
            <button
              className={`pg-edit-toggle${pg.editingId === l.id ? ' active' : ''}`}
              onClick={() => pg.setEditing(pg.editingId === l.id ? null : l.id)}
            >
              {pg.editingId === l.id ? 'editing — tap the board' : 'edit notes'}
            </button>
            {saving ? (
              <span className="pg-save">
                <input
                  className="pg-save-name"
                  autoFocus
                  placeholder="name it"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setSaving(false)
                    if (e.key === 'Enter' && saveName.trim() !== '' && l.notes.length > 0) {
                      pg.saveShape(l.id, saveName.trim())
                      setSaving(false)
                      setSaveName('')
                    }
                  }}
                />
                <button
                  disabled={saveName.trim() === '' || l.notes.length === 0}
                  onClick={() => {
                    pg.saveShape(l.id, saveName.trim())
                    setSaving(false)
                    setSaveName('')
                  }}
                >
                  save
                </button>
                <button onClick={() => setSaving(false)}>cancel</button>
              </span>
            ) : (
              <button disabled={l.notes.length === 0} onClick={() => setSaving(true)}>
                save to library
              </button>
            )}
            <button disabled={l.notes.length === 0} onClick={() => pg.patchLayer(l.id, { notes: [] })}>
              clear
            </button>
          </>
        )}
      </div>

      {l.kind === 'mode' && (
        <p className="pg-vibe">“{MODES.find((m) => m.id === l.modeId)?.vibe}”</p>
      )}

      {l.kind === 'degrees' && (
        <div className="pg-degree-chips">
          {Array.from({ length: 12 }, (_, d) => (
            <button
              key={d}
              className={`pg-degree-chip${l.degrees.includes(d) ? ' active' : ''}`}
              style={{ '--pgc': degreeColor(d, colorMode) } as CSSProperties}
              onClick={() =>
                pg.patchLayer(l.id, {
                  degrees: l.degrees.includes(d)
                    ? l.degrees.filter((x) => x !== d)
                    : [...l.degrees, d].sort((a, b) => a - b),
                })
              }
            >
              {degreeLabel(d)}
            </button>
          ))}
        </div>
      )}

      <div className="controls pg-visual-row">
        <div className="control-group">
          <span className="control-label">Colour</span>
          <div className="seg">
            <button className={l.color.kind === 'tint' ? 'active' : ''} onClick={() => setColorKind('tint')}>
              tint
            </button>
            {l.kind !== 'shape' && (
              <button className={l.color.kind === 'degree' ? 'active' : ''} onClick={() => setColorKind('degree')}>
                degrees
              </button>
            )}
            {l.kind !== 'shape' && (
              <button className={l.color.kind === 'custom' ? 'active' : ''} onClick={() => setColorKind('custom')}>
                custom
              </button>
            )}
          </div>
        </div>
        {l.color.kind === 'tint' && (
          <SwatchRow
            value={l.color.hex}
            onPick={(hex) => pg.patchLayer(l.id, { color: { kind: 'tint', hex } })}
          />
        )}
        {l.color.kind === 'degree' && <span className="pg-hint">follows the board palette</span>}
      </div>

      {l.color.kind === 'custom' && (
        <div className="pg-custom-colours">
          {layerDegrees(l).length === 0 && (
            <span className="pg-hint">no degrees in this layer yet</span>
          )}
          {layerDegrees(l).map((d) => {
            const overrides = l.color.kind === 'custom' ? l.color.overrides : {}
            return (
              <span key={d} className="pg-custom-row">
                <span className="pg-degree-tag mono">{degreeLabel(d)}</span>
                <ColorWheel
                  value={overrides[d] ?? degreeColor(d, colorMode)}
                  onChange={(hex) => setOverride(d, hex)}
                />
                {overrides[d] !== undefined && (
                  <button className="pg-mini" onClick={() => setOverride(d, null)}>reset</button>
                )}
              </span>
            )
          })}
        </div>
      )}

      <div className="controls pg-visual-row">
        <div className="control-group">
          <span className="control-label">Style</span>
          <div className="seg">
            {(['solid', 'outline', 'dashed'] as const).map((t) => (
              <button
                key={t}
                className={l.treatment === t ? 'active' : ''}
                onClick={() => pg.patchLayer(l.id, { treatment: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="control-group">
          <span className="control-label">Opacity</span>
          <div className="seg">
            {OPACITY_STEPS.map((o) => (
              <button
                key={o}
                className={l.opacity === o ? 'active' : ''}
                onClick={() => pg.patchLayer(l.id, { opacity: o })}
              >
                {o * 100}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Big preset chips (validated palette colours) + the anything-goes wheel. */
function SwatchRow({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  return (
    <div className="pg-swatches">
      {PRESET_SWATCHES.map((hex) => (
        <button
          key={hex}
          className={`pg-swatch${value.toUpperCase() === hex.toUpperCase() ? ' active' : ''}`}
          style={{ background: hex }}
          title={hex}
          aria-label={`colour ${hex}`}
          onClick={() => onPick(hex)}
        />
      ))}
      <ColorWheel value={value} onChange={onPick} />
    </div>
  )
}

/** Native colour input, restyled as a chip; writes rAF-throttled while dragging. */
function ColorWheel({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  return (
    <input
      type="color"
      className="pg-wheel"
      title="any colour"
      aria-label="pick any colour"
      value={value.toLowerCase()}
      onChange={(e) => {
        const hex = e.target.value
        cancelAnimationFrame(raf.current)
        raf.current = requestAnimationFrame(() => onChange(hex))
      }}
    />
  )
}
