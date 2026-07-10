import { useMemo, useState } from 'react'
import { playMidi } from '../../audio/audition'
import { Fretboard } from '../../fretboard/Fretboard'
import { modeColorLayer, neighborGhostLayer, skeletonLayer } from '../../fretboard/build-layers'
import {
  MODES, PC, coordToMidi, modeById, pcName,
  type PentatonicKind, type PitchClass,
} from '../../music-core'
import type { FretboardLayer } from '../../fretboard/layers'

/**
 * Explore: the map room. The pentatonic skeleton in any key/position, with
 * ghost notes for the spaces between boxes and mode colors on demand.
 */

const KEYS: PitchClass[] = [PC.E, PC.F, PC.Fs, PC.G, PC.Gs, PC.A, PC.As, PC.B, PC.C, PC.Cs, PC.D, PC.Ds]

export function ExploreView() {
  const [key, setKey] = useState<PitchClass>(PC.A)
  const [kind, setKind] = useState<PentatonicKind>('minor')
  const [position, setPosition] = useState<number | 'all'>(1)
  const [showGhosts, setShowGhosts] = useState(false)
  const [modeId, setModeId] = useState<string | null>(null)

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [skeletonLayer(key, kind, position)]
    if (showGhosts && position !== 'all') out.push(neighborGhostLayer(key, kind, position))
    if (modeId) out.push(modeColorLayer(key, modeById(modeId)))
    return out
  }, [key, kind, position, showGhosts, modeId])

  const mode = modeId ? modeById(modeId) : null

  return (
    <div>
      <div className="panel">
        <div className="controls">
          <div className="control-group">
            <span className="control-label">Key</span>
            <select value={key} onChange={(e) => setKey(Number(e.target.value))}>
              {KEYS.map((k) => (
                <option key={k} value={k}>{pcName(k, k)}</option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <span className="control-label">Skeleton</span>
            <div className="seg">
              {(['minor', 'major'] as const).map((k) => (
                <button
                  key={k}
                  className={kind === k ? 'active' : ''}
                  onClick={() => {
                    setKind(k)
                    if (modeId && modeById(modeId).skeleton !== k) setModeId(null)
                  }}
                >
                  {k} pent
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <span className="control-label">Position</span>
            <div className="seg">
              {[1, 2, 3, 4, 5].map((p) => (
                <button key={p} className={position === p ? 'active' : ''} onClick={() => setPosition(p)}>
                  {p}
                </button>
              ))}
              <button className={position === 'all' ? 'active' : ''} onClick={() => setPosition('all')}>
                all
              </button>
            </div>
          </div>

          <div className="control-group">
            <button
              className={showGhosts ? 'active' : ''}
              onClick={() => setShowGhosts(!showGhosts)}
              disabled={position === 'all'}
            >
              between-box ghosts
            </button>
          </div>

          <div className="control-group">
            <span className="control-label">Mode colors</span>
            <select value={modeId ?? ''} onChange={(e) => setModeId(e.target.value || null)}>
              <option value="">none</option>
              {MODES.filter((m) => m.skeleton === kind).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        {mode && <p className="vibe-line">“{mode.vibe}”</p>}

        <Fretboard
          layers={layers}
          keyRoot={key}
          onNoteClick={(coord) => playMidi(coordToMidi(coord))}
        />
      </div>
    </div>
  )
}
