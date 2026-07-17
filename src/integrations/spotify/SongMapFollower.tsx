import { useEffect, useMemo, useState } from 'react'
import { Fretboard } from '../../fretboard/Fretboard'
import { chordToneLayer, modeColorLayer, skeletonLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import { SectionStrip } from './SectionStrip'
import { SongMapGrid } from './SongMapGrid'
import { loadCorrections } from './songmap-store'
import { degreeLabel, modeById, parseChordSymbol, pcName } from './spotify-utils'
import type { SongKey, SongMap, UserCorrections } from './songmap'
import { useSongMapPlayhead } from './use-songmap-playhead'

/**
 * The Song Map follower: section strip, chord grid, beat countdown, and the
 * fretboard painted in the app's full pedagogy — pentatonic skeleton of the
 * detected key, the mode's color notes, and the sounding chord's tones —
 * all riding the real record.
 */

function keyHeadline(key: SongKey): string {
  try {
    const mode = modeById(key.modeId)
    const colors = mode.colors.map((d) => degreeLabel(d, mode.labelOverride)).join(' and ')
    return `${pcName(key.root, key.root)} ${mode.name.toLowerCase()} — ${mode.skeleton} skeleton + ${colors}`
  } catch {
    return `${pcName(key.root, key.root)} ${key.skeleton}`
  }
}

export function SongMapFollower({ map, onRedo }: { map: SongMap; onRedo: () => void }) {
  const [corrections, setCorrections] = useState<UserCorrections | null>(null)
  const [showProvenance, setShowProvenance] = useState(false)

  useEffect(() => {
    let alive = true
    void loadCorrections(map.trackUri).then((c) => { if (alive) setCorrections(c) })
    return () => { alive = false }
  }, [map.trackUri])

  const { playhead, resolved } = useSongMapPlayhead(map, corrections)

  // The key can change per section (modulating bridges swap all three layers).
  const activeKey: SongKey = (playhead.sectionIndex >= 0 && map.sections[playhead.sectionIndex].keyOverride) || map.key

  const chordLayers = useMemo(
    () => map.chords.map((c) => {
      try { return chordToneLayer(parseChordSymbol(c.symbol), activeKey.root) } catch { return null }
    }),
    [map, activeKey.root],
  )

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [skeletonLayer(activeKey.root, activeKey.skeleton, 'all')]
    try { out.push(modeColorLayer(activeKey.root, modeById(activeKey.modeId))) } catch { /* skeleton only */ }
    if (playhead.chordIndex >= 0 && chordLayers[playhead.chordIndex]) {
      out.push(chordLayers[playhead.chordIndex]!)
    }
    return out
  }, [activeKey, playhead.chordIndex, chordLayers])

  const currentSymbol = playhead.chordIndex >= 0 ? map.chords[playhead.chordIndex].symbol : '—'
  const nextSymbol = playhead.nextChordIndex >= 0 ? map.chords[playhead.nextChordIndex].symbol : null
  const warnings = map.provenance.fusion.warnings

  return (
    <div className="panel">
      <div className="controls songmap-header">
        <span className="songmap-keyline">{keyHeadline(activeKey)}</span>
        <span className="dim mono">{Math.round(map.tempo.bpm)} bpm · {map.tempo.meter.beatsPerBar}/{map.tempo.meter.beatUnit}</span>
        <button className="songmap-provbtn" onClick={() => setShowProvenance((v) => !v)}>
          {showProvenance ? 'hide source' : 'source'}
        </button>
        <button onClick={onRedo}>redo this song</button>
      </div>

      {showProvenance && (
        <p className="dim songmap-provenance">
          chart: {map.provenance.ug.versionLabel}
          {map.provenance.ug.official ? ' (Official)' : ''} · ★{map.provenance.ug.rating.toFixed(1)} ({map.provenance.ug.votes})
          {map.provenance.ug.fallbackReason ? ` · ${map.provenance.ug.fallbackReason}` : ''}
          <br />
          audio: {map.provenance.audio.videoTitle} · match {(map.provenance.audio.matchScore * 100).toFixed(0)}%
          {warnings.map((w, i) => <span key={i}><br />⚠ {w}</span>)}
        </p>
      )}

      <SectionStrip map={map} resolved={resolved} activeIndex={playhead.sectionIndex} />

      <div className="controls songmap-nowline">
        <span className="songlab-chord">{currentSymbol}</span>
        {nextSymbol && (
          <span className="songmap-next">
            <span className="dim">then</span> {nextSymbol}
            {playhead.beatsToChange !== null && playhead.beatsToChange <= 8 && (
              <span className="songmap-countdown" aria-label={`${playhead.beatsToChange} beats to the change`}>
                {Array.from({ length: Math.min(8, Math.max(1, playhead.beatsToChange)) }, () => '●').join('')}
              </span>
            )}
          </span>
        )}
      </div>

      <SongMapGrid
        map={map}
        resolved={resolved}
        chordIndex={playhead.chordIndex}
        nextChordIndex={playhead.nextChordIndex}
        activeSectionIndex={playhead.sectionIndex}
      />

      <Fretboard layers={layers} keyRoot={activeKey.root} />
    </div>
  )
}
