import { memo, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { makeLayout } from '../../fretboard/layout'
import type { LabelStyle } from '../../state/board-prefs'
import type { OverlapStyle } from '../../state/playground'
import type { PitchClass } from '../../music-core'
import { cellLabel, coordKey, isDarkColor, wedgePath, type BoardCell } from './playground-model'

/**
 * The Playground's own marker renderer, drawn as <Fretboard> children so the
 * shared marker system stays untouched. Same layout math (makeLayout with the
 * board's own constants), same data-string/data-fret click contract — but
 * markers here can wear a layer tint, nest rings, or split into wedges when
 * two or more layers share a fret.
 */

// Must equal Fretboard.tsx's unexported WIDTH — the layout math only lines up
// while both sides use the same constants (see also height/maxFret props).
const WIDTH = 1180
const R = 12 // matches the board's solid marker radius
const SHARED_R = 13 // fixed footprint for ring glyphs (target-size, no collisions)
const RING_BAND = 4 // ring thickness + gap per nested layer
const MAX_RINGS = 2 // core + 2 rings is the legibility floor at this size
// The shared board's INLAY_FRETS stops at 17; a longer Playground neck needs
// the real-guitar dots above it. Drawn here (before the markers) so the
// shared Fretboard stays untouched.
const EXTENDED_INLAY_FRETS = [19, 21]

interface PlaygroundMarkersProps {
  cells: BoardCell[]
  overlap: OverlapStyle
  sharedColor: string
  labelStyle: LabelStyle
  keyRoot: PitchClass
  editingId: string | null
  height?: number // must match the <Fretboard height> it renders inside
  maxFret?: number // must match the <Fretboard maxFret>
}

function PlaygroundMarkersG({
  cells, overlap, sharedColor, labelStyle, keyRoot, editingId,
  height = 250, maxFret = 17,
}: PlaygroundMarkersProps) {
  const layout = useMemo(() => makeLayout(WIDTH, height, maxFret), [height, maxFret])

  return (
    <g className="pg-markers">
      {EXTENDED_INLAY_FRETS.filter((f) => f > 17 && f <= maxFret).map((f) => (
        <circle key={f} className="fb-inlay" cx={layout.noteX(f)} cy={height / 2} r={5.5} />
      ))}
      {cells.map((cell) => {
        const x = layout.noteX(cell.coord.fret)
        const y = layout.stringY(cell.coord.string)
        const top = cell.entries[0]
        if (top === undefined) return null
        const shared = cell.entries.length >= 2
        const editingCell =
          editingId !== null && cell.entries.some((e) => e.layer.id === editingId)
        // Ring/split/third glyphs represent every stacked layer, so the most
        // opaque one carries the cell; 'top wins' is purely the top layer's
        // glyph and must fade with it.
        const baseOpacity = shared && overlap !== 'top'
          ? Math.max(...cell.entries.map((e) => e.layer.opacity))
          : top.layer.opacity
        // Edit mode: everything but the shape being edited recedes.
        const opacity = editingId !== null && !editingCell ? baseOpacity * 0.25 : baseOpacity
        const label = cellLabel(cell, labelStyle, keyRoot)

        const style = shared && overlap === 'ring'
          ? undefined
          : shared && overlap === 'split'
            ? undefined
            : ({
                '--pgc': shared && overlap === 'third' ? sharedColor : top.color,
              } as CSSProperties)

        const treatment =
          shared && overlap === 'third' ? 'solid' : top.layer.treatment
        const glyphClass =
          shared && overlap === 'ring'
            ? 'pg-ring'
            : shared && overlap === 'split'
              ? 'pg-split'
              : `pg-${treatment}${shared && overlap === 'third' ? ' pg-shared-third' : ''}`

        // Multi-colour glyphs always take the haloed label; so do solid discs
        // in a wheel-picked colour too dark for the default near-black ink.
        const multiGlyph = shared && (overlap === 'ring' || overlap === 'split')
        const solidFill = shared && overlap === 'third' ? sharedColor : top.color
        const overLabel =
          multiGlyph || (treatment === 'solid' && isDarkColor(solidFill))

        return (
          <g
            key={coordKey(cell.coord)}
            className={
              `pg-marker ${glyphClass}${shared ? ' pg-shared' : ''}`
              + `${editingCell ? ' pg-editing' : ''}`
            }
            transform={`translate(${x} ${y})`}
            style={style}
            opacity={opacity}
            data-string={cell.coord.string}
            data-fret={cell.coord.fret}
          >
            {shared && overlap === 'ring' ? (
              <RingGlyph colors={cell.entries.map((e) => e.color)} />
            ) : shared && overlap === 'split' ? (
              <>
                {cell.entries.map((e, i) => (
                  <path
                    key={i}
                    className="pg-wedge"
                    d={wedgePath(0, 0, 12.5, i, cell.entries.length)}
                    fill={e.color}
                  />
                ))}
                <circle className="pg-split-rim" r={12.5} />
              </>
            ) : (
              <circle className="pg-dot" r={R} />
            )}
            {label !== undefined && (
              <text className={`pg-label${overLabel ? ' pg-label-over' : ''}`} dy="0.36em">
                {label}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/**
 * Nested-ring glyph inside a fixed 13px footprint: top layer's colour as the
 * core, deeper layers as concentric rings. Caps at the core + 2 rings — a
 * 5px core is the legibility floor; beyond three layers, split or third
 * colour tell the story better (the UI says so too).
 */
function RingGlyph({ colors }: { colors: string[] }) {
  const k = Math.min(colors.length - 1, MAX_RINGS)
  const coreR = SHARED_R - RING_BAND * k
  return (
    <>
      <circle className="pg-core" r={coreR} fill={colors[0]} />
      {Array.from({ length: k }, (_, idx) => {
        const i = idx + 1 // ring 1 hugs the core, ring k is outermost
        const radius = SHARED_R - RING_BAND * (k - i) - 2
        return (
          <circle
            key={i}
            className="pg-ring-band"
            r={radius}
            fill="none"
            stroke={colors[i]}
            strokeWidth={3.4}
          />
        )
      })}
    </>
  )
}

/** Memoized on props identity — the view builds `cells` in one useMemo. */
export const PlaygroundMarkers = memo(PlaygroundMarkersG)
