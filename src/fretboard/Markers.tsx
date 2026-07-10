import { memo } from 'react'
import { coordsForPc, coordToPc, pcName, type FretCoord, type PitchClass } from '../music-core'
import type { FretboardLayer, NoteMarker } from './layers'
import type { FretboardLayout } from './layout'
import { degreeColor, type ColorMode } from './palette'
import type { LabelStyle } from '../state/board-prefs'

/** Resolve a marker to concrete coordinates (pitchClass markers fan out). */
function markerCoords(m: NoteMarker, maxFret: number): FretCoord[] {
  if (m.coord) return [m.coord]
  if (m.pitchClass !== undefined) return coordsForPc(m.pitchClass, maxFret)
  return []
}

const R: Record<string, number> = {
  skeleton: 10.5, root: 12, chordTone: 12, modalColor: 12,
  target: 13, anchor: 9, ghost: 7.5, triad: 12,
}

interface LayerProps {
  layer: FretboardLayer
  layout: FretboardLayout
  colorMode: ColorMode
  labelStyle: LabelStyle
  keyRoot: PitchClass
}

function LayerG({ layer, layout, colorMode, labelStyle, keyRoot }: LayerProps) {
  return (
    <g className="fb-layer" data-layer={layer.id}>
      {layer.markers.flatMap((m, i) =>
        markerCoords(m, layout.maxFret).map((c, j) => {
          const x = layout.noteX(c.fret)
          const y = layout.stringY(c.string)
          const r = R[m.role] ?? 10
          const dc = m.degree !== undefined ? degreeColor(m.degree, colorMode) : undefined
          const label = labelStyle === 'none' && m.role !== 'target'
            ? undefined
            : labelStyle === 'letter'
              ? pcName(coordToPc(c), keyRoot)
              : m.label
          return (
            <g
              key={`${i}-${j}`}
              className={`fb-marker fb-${m.role}${m.pulse ? ' fb-pulse' : ''}`}
              transform={`translate(${x} ${y})`}
              style={dc ? ({ '--dc': dc } as React.CSSProperties) : undefined}
              data-string={c.string}
              data-fret={c.fret}
            >
              {m.ring && <circle className="fb-ring-circle" r={r + 4.5} />}
              <circle className="fb-dot" r={r} />
              {label && (
                <text className="fb-label" dy="0.36em">
                  {label}
                </text>
              )}
            </g>
          )
        }),
      )}
    </g>
  )
}

/** Memoized: a layer only re-renders when its object identity or prefs change. */
export const Layer = memo(LayerG, (a, b) =>
  a.layer === b.layer && a.layout === b.layout && a.colorMode === b.colorMode
  && a.labelStyle === b.labelStyle && a.keyRoot === b.keyRoot)
