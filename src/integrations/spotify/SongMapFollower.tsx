import { useEffect, useMemo, useRef, useState } from 'react'
import { Fretboard } from '../../fretboard/Fretboard'
import { chordToneLayer, modeColorLayer, skeletonLayer, targetLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import { audioNow, silentTimelineSource } from '../../audio/timeline-source'
import { useGuideToneDrill } from '../../drills/engine/use-guide-tone-drill'
import { useAppPrefs } from '../../state/app-prefs'
import { CorrectionBar } from './CorrectionBar'
import { SectionStrip } from './SectionStrip'
import { SongMapGrid } from './SongMapGrid'
import { VersionPicker } from './VersionPicker'
import { estimatePositionMs, isPlaying, JAM_VOLUME, seekMs, setPlayerVolume } from './player'
import { songMapTimelineSource } from './songmap-source'
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

/** What a transport must provide for the guide-tone drill to run over it. */
export interface TransportDrill {
  /** AudioContext time a song position will sound. */
  ctxTimeOf(songMs: number): number
  playing(): boolean
  rate(): number
  extraGeneration(): number
  duck(at: number): void
  unduck(at: number): void
  /** Attempt tag for the adaptive model ('guide-record' | 'guide-deck'). */
  detail: string
}

/** Who owns the playhead: the Spotify player (default) or the deck. */
export interface FollowerTransport {
  clockMs(): number
  seek(ms: number): void
  /** Sample-accurate loop points (deck mode). */
  nativeLoop?: { set(aMs: number, bMs: number): void; clear(): void }
  drill?: TransportDrill
}

const SPOTIFY_TRANSPORT: FollowerTransport = {
  clockMs: estimatePositionMs,
  seek: seekMs,
  drill: {
    // The estimate lags the truth by ≤ one 250ms poll (interpolated), a
    // ±20–60ms error against a ≥±1-beat scoring window — safe; latencies
    // carry the 'guide-record' tag so Stats can segregate the noise.
    ctxTimeOf: (songMs) => audioNow() + (songMs - estimatePositionMs()) / 1000,
    playing: isPlaying,
    rate: () => 1,
    extraGeneration: () => 0,
    duck: () => setPlayerVolume(0.35),
    unduck: () => setPlayerVolume(JAM_VOLUME),
    detail: 'guide-record',
  },
}

export function SongMapFollower({ map, onRedo, onPickTab, onRefine, transport }: {
  map: SongMap
  onRedo: () => void
  /** Re-pick the UG chart (keeps the audio/analysis cache). */
  onPickTab?: (tabId: number) => void
  /** Chroma-refine the timing (hidden once the map is refined). */
  onRefine?: () => void
  transport?: FollowerTransport
}) {
  const t = transport ?? SPOTIFY_TRANSPORT
  const [showProvenance, setShowProvenance] = useState(false)
  const [fixTiming, setFixTiming] = useState(false)
  const [versions, setVersions] = useState<UgVersionChoice[] | null>(null)
  const [loadingVersions, setLoadingVersions] = useState(false)

  const {
    corrections, lastTap, tap, nudge, bumpSection, bumpGlobal, resetSection, resetAll,
  } = useCorrections(map)

  const { playhead, resolved } = useSongMapPlayhead(map, corrections, t.clockMs)

  const { loopIndex, toggle: toggleLoop } = useSectionLoop({
    resolved,
    clockMs: t.clockMs,
    seek: t.seek,
    native: t.nativeLoop,
  })

  // --- Guide-tone drill over the record -----------------------------------
  const micMode = useAppPrefs((s) => s.micMode)
  const resolvedRef = useRef(resolved)
  resolvedRef.current = resolved
  const loopIndexRef = useRef<number | null>(loopIndex)
  loopIndexRef.current = loopIndex

  const drillCaps = t.drill
  const source = useMemo(
    () => drillCaps
      ? songMapTimelineSource({
          map,
          resolved: () => resolvedRef.current,
          clockMs: t.clockMs,
          ctxTimeOf: drillCaps.ctxTimeOf,
          playing: drillCaps.playing,
          loopActive: () => loopIndexRef.current !== null,
          rate: drillCaps.rate,
          extraGeneration: drillCaps.extraGeneration,
          duck: drillCaps.duck,
          unduck: drillCaps.unduck,
        })
      : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t carries drillCaps/clockMs
    [map, t],
  )
  useEffect(() => () => { source?.dispose() }, [source])

  const guide = useGuideToneDrill({
    source: source ?? silentTimelineSource,
    keyFor: source ? source.keyFor : () => map.key.root,
    detail: drillCaps?.detail ?? 'guide-record',
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
    if (guide.active && guide.upcoming) {
      out.push(targetLayer(guide.upcoming.targetPc, activeKey.root, true))
    }
    return out
  }, [activeKey, playhead.chordIndex, chordLayers, guide.active, guide.upcoming])

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
        {drillCaps && micMode === 'on' && (
          <button
            className={`songmap-guidebtn${guide.active ? ' active' : ''}`}
            onClick={guide.toggle}
            title="pearl the upcoming chord's 3rd or 7th; the mic scores your lock"
          >
            guide tones
          </button>
        )}
        {onPickTab && (
          <button
            className="songmap-changechart"
            disabled={loadingVersions}
            onClick={() => (versions ? setVersions(null) : void openVersions())}
          >
            {loadingVersions ? 'looking…' : 'change chart'}
          </button>
        )}
        {onRefine && !map.provenance.refined && (
          <button className="songmap-refinebtn" onClick={onRefine}>tighten timing</button>
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
        onSeek={t.seek}
        loopIndex={loopIndex}
        onToggleLoop={toggleLoop}
      />

      {guide.active && (
        <div className="controls songmap-guidehud">
          {guide.loopPaused
            ? <span className="dim">looping — guide tones pause until the loop clears</span>
            : guide.upcoming
              ? <span>pearl the <b>{guide.upcoming.targetLabel}</b> of {guide.upcoming.symbol}</span>
              : <span className="dim">listening…</span>}
          {guide.lastResult && (
            <span className={`songmap-guideresult ${guide.lastResult}`}>
              {guide.lastResult === 'hit' ? '● hit' : '○ miss'}
            </span>
          )}
          <span className="mono dim">{guide.tally.hits}/{guide.tally.total}</span>
        </div>
      )}

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
          onTap={() => tap(t.clockMs())}
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
        onSeek={t.seek}
        nudgeMode={fixTiming}
        onNudge={nudge}
      />

      <Fretboard layers={layers} keyRoot={activeKey.root} />
    </div>
  )
}
