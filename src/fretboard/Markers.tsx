import { memo } from 'react'
import { coordsForPc, type FretCoord } from '../music-core'
import type { FretboardLayer, NoteMarker } from './layers'
import type { FretboardLayout } from './layout'

/** Resolve a marker to concrete coordinates (pitchClass markers fan out). */
function markerCoords(m: NoteMarker, maxFret: number): FretCoord[] {
  if (m.coord) return [m.coord]
  if (m.pitchClass !== undefined) return coordsForPc(m.pitchClass, maxFret)
  return []
}

const R: Record<string, number> = {
  skeleton: 9.5, root: 11, chordTone: 10.5, modalColor: 10.5,
  target: 12, anchor: 8.5, ghost: 6.5, triad: 11,
}

function LayerG({ layer, layout }: { layer: FretboardLayer; layout: FretboardLayout }) {
  return (
    <g className={`fb-layer`} data-layer={layer.id}>
      {layer.markers.flatMap((m, i) =>
        markerCoords(m, layout.maxFret).map((c, j) => {
          const x = layout.noteX(c.fret)
          const y = layout.stringY(c.string)
          const r = R[m.role] ?? 9
          return (
            <g
              key={`${i}-${j}`}
              className={`fb-marker fb-${m.role}${m.pulse ? ' fb-pulse' : ''}${m.ring ? ' fb-ring' : ''}`}
              transform={`translate(${x} ${y})`}
              data-string={c.string}
              data-fret={c.fret}
            >
              {m.ring && <circle className="fb-ring-circle" r={r + 4.5} />}
              <circle className="fb-dot" r={r} />
              {m.label && (
                <text className="fb-label" dy="0.36em">
                  {m.label}
                </text>
              )}
            </g>
          )
        }),
      )}
    </g>
  )
}

/** Memoized: a layer only re-renders when its object identity changes. */
export const Layer = memo(LayerG, (a, b) => a.layer === b.layer && a.layout === b.layout)
