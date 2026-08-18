import { useMemo, useState } from 'react'
import { Fretboard } from '../../fretboard/Fretboard'
import { chordToneLayer, modeColorLayer, skeletonLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import { CorrectionBar } from './CorrectionBar'
import { SectionStrip } from './SectionStrip'
import { SongMapGrid } from './SongMapGrid'
import { VersionPicker } from './VersionPicker'
import { estimatePositionMs, seekMs } from './player'
import { listVersions, type UgVersionChoice } from './songsmith-client'
import { keyHeadline, modeById, parseChordSymbol } from './spotify-utils'
import type { SongKey, SongMap } from './songmap'
import { useCorrections } from './use-corrections'
import { useSectionLoop } from './use-section-loop'
import { useSongMapPlayhead } from './use-songmap-playhead'

/**
 * The Song Map follower: section strip, chord grid, beat countdown, and the
 * fretboard painted in the app's full pedagogy — pentatonic skeleton of the
 * detected key, the mode's color notes, and the sounding chord's tones —
 * all riding the real record. Corrections (taps/nudges) and section looping
 * live here too.
 */

export function SongMapFollower({ map, onRedo, onPickTab }: {
  map: SongMap
  onRedo: () => void
  /** Re-pick the UG chart (keeps the audio/analysis cache). */
  onPickTab?: (tabId: number) => void
}) {
  const [showProvenance, setShowProvenance] = useState(false)
  const [fixTiming, setFixTiming] = useState(false)
  const [versions, setVersions] = useState<UgVersionChoice[] | null>(null)
  const [loadingVersions, setLoadingVersions] = useState(false)

  const {
    corrections, lastTap, tap, nudge, bumpSection, bumpGlobal, resetSection, resetAll,
  } = useCorrections(map)

  const { playhead, resolved } = useSongMapPlayhead(map, corrections)

  const { loopIndex, toggle: toggleLoop } = useSectionLoop({
    resolved,
    clockMs: estimatePositionMs,
    seek: seekMs,
  })

  const openVersions = async () => {
    setLoadingVersions(true)
    const v = await listVersions({ artistName: map.artistName, trackName: map.trackName })
    setLoadingVersions(false)
    setVersions(v ?? [])
  }

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
        <button
          className={`songmap-fixbtn${fixTiming ? ' active' : ''}`}
          onClick={() => setFixTiming((v) => !v)}
        >
          {fixTiming ? 'done fixing' : 'fix timing'}
        </button>
        {onPickTab && (
          <button
            className="songmap-changechart"
            disabled={loadingVersions}
            onClick={() => (versions ? setVersions(null) : void openVersions())}
          >
            {loadingVersions ? 'looking…' : 'change chart'}
          </button>
        )}
        <button onClick={onRedo}>redo this song</button>
      </div>

      {versions && (
        versions.length === 0
          ? <p className="dim">couldn't list UG versions right now — is songsmith up?</p>
          : (
            <>
              <VersionPicker
                versions={versions}
                currentTabId={map.provenance.ug.tabId}
                onPickTab={(tabId) => { setVersions(null); onPickTab?.(tabId) }}
                onPickUrl={() => {}}
              />
              <div className="controls">
                <button onClick={() => setVersions(null)}>never mind</button>
              </div>
            </>
          )
      )}

      {showProvenance && (
        <p className="dim songmap-provenance">
          chart: {map.provenance.ug.versionLabel}
          {map.provenance.ug.official ? ' (Official)' : ''} · ★{map.provenance.ug.rating.toFixed(1)} ({map.provenance.ug.votes})
          {map.provenance.ug.fallbackReason ? ` · ${map.provenance.ug.fallbackReason}` : ''}
          <br />
          audio: {map.provenance.audio.videoTitle} · match {(map.provenance.audio.matchScore * 100).toFixed(0)}%
          {map.provenance.refined && <><br />timing: refined ✓ (chroma-DTW, {map.provenance.refined.at.slice(0, 10)})</>}
          {warnings.map((w, i) => <span key={i}><br />⚠ {w}</span>)}
        </p>
      )}

      <SectionStrip
        map={map}
        resolved={resolved}
        activeIndex={playhead.sectionIndex}
        onSeek={seekMs}
        loopIndex={loopIndex}
        onToggleLoop={toggleLoop}
      />

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

      {fixTiming && corrections && (
        <CorrectionBar
          map={map}
          corrections={corrections}
          lastTap={lastTap}
          activeSectionIndex={playhead.sectionIndex}
          onTap={() => tap(estimatePositionMs())}
          onBumpGlobal={bumpGlobal}
          onBumpSection={bumpSection}
          onResetSection={resetSection}
          onResetAll={resetAll}
        />
      )}

      <SongMapGrid
        map={map}
        resolved={resolved}
        chordIndex={playhead.chordIndex}
        nextChordIndex={playhead.nextChordIndex}
        activeSectionIndex={playhead.sectionIndex}
        onSeek={seekMs}
        nudgeMode={fixTiming}
        onNudge={nudge}
      />

      <Fretboard layers={layers} keyRoot={activeKey.root} />
    </div>
  )
}
