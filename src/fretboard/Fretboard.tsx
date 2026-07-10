import { useMemo, useRef, type PointerEvent, type ReactNode } from 'react'
import { NUM_STRINGS, pcName, coordToPc, type FretCoord, type PitchClass } from '../music-core'
import type { FretboardLayer } from './layers'
import { DOUBLE_INLAY_FRET, INLAY_FRETS, makeLayout } from './layout'
import { Layer } from './Markers'
import './fretboard.css'

/**
 * The Living Fretboard. Renders the neck (rosewood board, brass frets,
 * pearl inlays, gauged strings) + data-driven marker layers. Low E string
 * note names and A string note names are always available as the player's
 * anchors. One delegated pointer handler auditions any clicked position.
 */

export interface FretboardProps {
  layers: FretboardLayer[]
  onNoteClick?: (coord: FretCoord) => void
  /** Show letter names along low E and A strings (his anchor strings). */
  showAnchors?: boolean
  keyRoot?: PitchClass // controls sharp/flat spelling of anchor names
  maxFret?: number
  height?: number
  children?: ReactNode
}

const WIDTH = 1180

export function Fretboard({
  layers, onNoteClick, showAnchors = true, keyRoot = 0, maxFret = 17, height = 240, children,
}: FretboardProps) {
  const layout = useMemo(() => makeLayout(WIDTH, height, maxFret), [height, maxFret])
  const svgRef = useRef<SVGSVGElement>(null)

  const sorted = useMemo(
    () => [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)),
    [layers],
  )

  function handlePointer(e: PointerEvent<SVGSVGElement>) {
    if (!onNoteClick || !svgRef.current) return
    const marker = (e.target as Element).closest('[data-fret]')
    if (marker) {
      onNoteClick({
        string: Number(marker.getAttribute('data-string')),
        fret: Number(marker.getAttribute('data-fret')),
      })
      return
    }
    // Clicks on bare wood also audition: snap to nearest string/fret.
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH
    const y = ((e.clientY - rect.top) / rect.height) * height
    let best: FretCoord | null = null
    let bestDist = 26
    for (let s = 0; s < NUM_STRINGS; s++) {
      const dy = Math.abs(layout.stringY(s) - y)
      if (dy > 14) continue
      for (let f = 0; f <= maxFret; f++) {
        const d = Math.hypot(layout.noteX(f) - x, dy)
        if (d < bestDist) { bestDist = d; best = { string: s, fret: f } }
      }
    }
    if (best) onNoteClick(best)
  }

  return (
    <svg
      ref={svgRef}
      className="fretboard"
      viewBox={`0 0 ${WIDTH} ${height + 30}`}
      onPointerDown={handlePointer}
      role="img"
      aria-label="Guitar fretboard"
    >
      <defs>
        <linearGradient id="fb-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2015" />
          <stop offset="0.5" stopColor="#37281a" />
          <stop offset="1" stopColor="#281d13" />
        </linearGradient>
        <linearGradient id="fb-wire" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6b5c45" />
          <stop offset="0.5" stopColor="#8d7c5f" />
          <stop offset="1" stopColor="#5d5040" />
        </linearGradient>
      </defs>

      {/* board */}
      <rect
        x={layout.nutX} y={6} width={layout.fretX(maxFret) - layout.nutX}
        height={height - 12} rx={4} fill="url(#fb-wood)"
      />

      {/* nut */}
      <rect x={layout.nutX - 4} y={6} width={5} height={height - 12} rx={2} className="fb-nut" />

      {/* fret wires + numbers */}
      {Array.from({ length: maxFret }, (_, i) => i + 1).map((f) => (
        <g key={f}>
          <rect x={layout.fretX(f) - 1.1} y={8} width={2.2} height={height - 16} fill="url(#fb-wire)" />
          <text className="fb-fretnum" x={layout.noteX(f)} y={height + 18}>{f}</text>
        </g>
      ))}

      {/* pearl inlays */}
      {INLAY_FRETS.filter((f) => f <= maxFret).map((f) => (
        <circle key={f} className="fb-inlay" cx={layout.noteX(f)} cy={height / 2} r={5} />
      ))}
      {DOUBLE_INLAY_FRET <= maxFret && (
        <>
          <circle className="fb-inlay" cx={layout.noteX(12)} cy={layout.stringY(4)} r={5} />
          <circle className="fb-inlay" cx={layout.noteX(12)} cy={layout.stringY(1)} r={5} />
        </>
      )}

      {/* strings, gauged */}
      {Array.from({ length: NUM_STRINGS }, (_, s) => (
        <line
          key={s} className="fb-string"
          x1={layout.nutX - 6} x2={layout.fretX(maxFret) + 6}
          y1={layout.stringY(s)} y2={layout.stringY(s)}
          strokeWidth={layout.stringGauge(s)}
        />
      ))}

      {/* anchor letter names on low E + A (his known strings) */}
      {showAnchors && (
        <g className="fb-anchors">
          {[0, 1].map((s) =>
            Array.from({ length: maxFret + 1 }, (_, f) => (
              <text
                key={`${s}-${f}`} className="fb-anchor-name"
                x={layout.noteX(f)} y={layout.stringY(s) + 16}
              >
                {pcName(coordToPc({ string: s, fret: f }), keyRoot)}
              </text>
            )),
          )}
        </g>
      )}

      {sorted.map((layer) => (
        <Layer key={layer.id} layer={layer} layout={layout} />
      ))}

      {children}
    </svg>
  )
}
