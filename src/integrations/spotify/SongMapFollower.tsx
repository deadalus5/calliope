import { useEffect, useMemo, useRef, useState } from 'react'
import { Fretboard } from '../../fretboard/Fretboard'
import { chordShapeLayer, chordToneLayer, modeColorLayer, skeletonLayer, targetLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import { audioNow, silentTimelineSource } from '../../audio/timeline-source'
import { useGuideToneDrill } from '../../drills/engine/use-guide-tone-drill'
import { useAppPrefs } from '../../state/app-prefs'
import { useChordLink } from '../../state/chord-link'
import { CorrectionBar } from './CorrectionBar'
import { LyricsPanel } from './LyricsPanel'
import { SectionStrip } from './SectionStrip'
import { SongMapGrid } from './SongMapGrid'
import { VersionPicker } from './VersionPicker'
import { parseLrc, placeChords, type LrcLine } from './lrc'
import { estimatePositionMs, isPlaying, JAM_VOLUME, seekMs, setPlayerVolume } from './player'
import { songMapTimelineSource } from './songmap-source'
import { fetchLyricsDoc, listVersions, type UgVersionChoice } from './songsmith-client'
import { keyHeadline, modeById, parseChordSymbol } from './spotify-utils'
import { ugVoicingToShape } from './voicing-render'
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

  // --- The chart's own grips (UG applicature) ------------------------------
  const [showGrips, setShowGrips] = useState(false)
  const [gripVariant, setGripVariant] = useState(0)
  const hasVoicings = Boolean(map.voicings && Object.keys(map.voicings).length > 0)

  // --- Chords over lyrics --------------------------------------------------
  const [showLyrics, setShowLyrics] = useState(false)
  const [lyrics, setLyrics] = useState<{ lines: LrcLine[]; plain: string | null } | 'miss' | null>(null)
  useEffect(() => { setLyrics(null); setShowLyrics(false) }, [map.trackUri])
  useEffect(() => {
    if (!showLyrics || lyrics !== null) return
    let alive = true
    void fetchLyricsDoc({
      trackUri: map.trackUri, trackName: map.trackName, artistName: map.artistName, durationMs: map.durationMs,
    }).then((doc) => {
      if (!alive) return
      if (!doc || (!doc.synced && !doc.plain)) { setLyrics('miss'); return }
      setLyrics({ lines: doc.synced ? parseLrc(doc.synced) : [], plain: doc.plain })
    })
    return () => { alive = false }
  }, [showLyrics, lyrics, map])

  // The key can change per section (modulating bridges swap all three layers).
  const activeKey: SongKey = (playhead.sectionIndex >= 0 && map.sections[playhead.sectionIndex].keyOverride) || map.key

  const chordLayers = useMemo(
    () => map.chords.map((c) => {
      try { return chordToneLayer(parseChordSymbol(c.symbol), activeKey.root) } catch { return null }
    }),
    [map, activeKey.root],
  )

  const currentSymbol = playhead.chordIndex >= 0 ? map.chords[playhead.chordIndex].symbol : '—'
  const nextSymbol = playhead.nextChordIndex >= 0 ? map.chords[playhead.nextChordIndex].symbol : null
  const warnings = map.provenance.fusion.warnings

  // Reset the grip variant whenever the sounding chord changes.
  useEffect(() => { setGripVariant(0) }, [currentSymbol])
  const currentVoicings = currentSymbol !== '—' ? map.voicings?.[currentSymbol] : undefined
  const gripShape = useMemo(() => {
    if (!showGrips || !currentVoicings?.length) return null
    return ugVoicingToShape(currentSymbol, currentVoicings[gripVariant % currentVoicings.length])
  }, [showGrips, currentVoicings, gripVariant, currentSymbol])

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [skeletonLayer(activeKey.root, activeKey.skeleton, 'all')]
    if (gripShape) {
      // Grip view: the chart author's actual fingering over the dim
      // skeleton — chord-tone and mode-color layers step aside so the grip
      // reads as THE thing to play.
      out.push(chordShapeLayer(gripShape, 'ug-grip'))
    } else {
      try { out.push(modeColorLayer(activeKey.root, modeById(activeKey.modeId))) } catch { /* skeleton only */ }
      if (playhead.chordIndex >= 0 && chordLayers[playhead.chordIndex]) {
        out.push(chordLayers[playhead.chordIndex]!)
      }
    }
    if (guide.active && guide.upcoming) {
      out.push(targetLayer(guide.upcoming.targetPc, activeKey.root, true))
    }
    return out
  }, [activeKey, playhead.chordIndex, chordLayers, guide.active, guide.upcoming, gripShape])

  const placedLyricChords = useMemo(
    () => (lyrics !== null && lyrics !== 'miss' && lyrics.lines.length > 0
      ? placeChords(lyrics.lines, resolved, map)
      : null),
    [lyrics, resolved, map],
  )

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
        {hasVoicings && (
          <button
            className={`songmap-gripbtn${showGrips ? ' active' : ''}`}
            onClick={() => setShowGrips((v) => !v)}
            title="show the chart author's actual fingering for the sounding chord"
          >
            grips
          </button>
        )}
        <button
          className={`songmap-lyricsbtn${showLyrics ? ' active' : ''}`}
          disabled={lyrics === 'miss'}
          onClick={() => setShowLyrics((v) => !v)}
        >
          {lyrics === 'miss' ? 'no lyrics found' : 'lyrics'}
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
        {gripShape && currentVoicings && (
          <span className="songmap-gripcontrols">
            {currentVoicings.length > 1 && (
              <>
                <button onClick={() => setGripVariant((v) => (v + currentVoicings.length - 1) % currentVoicings.length)}>‹</button>
                <span className="dim mono">{(gripVariant % currentVoicings.length) + 1}/{currentVoicings.length}</span>
                <button onClick={() => setGripVariant((v) => (v + 1) % currentVoicings.length)}>›</button>
              </>
            )}
            <button
              className="songmap-griplink"
              onClick={() => useChordLink.getState().send({
                target: 'chordlib', root: gripShape.root, qualityId: gripShape.qualityId, coords: gripShape.coords,
              })}
              title="study this grip in the Chord Library"
            >
              open in library
            </button>
          </span>
        )}
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

      {showLyrics && lyrics !== null && lyrics !== 'miss' && (
        lyrics.lines.length > 0 && placedLyricChords
          ? <LyricsPanel lines={lyrics.lines} placed={placedLyricChords} clockMs={t.clockMs} />
          : lyrics.plain
            ? <pre className="songmap-lyricsplain dim">{lyrics.plain}</pre>
            : null
      )}
      {showLyrics && lyrics === null && <p className="dim">finding the words…</p>}

      <Fretboard layers={layers} keyRoot={activeKey.root} />
    </div>
  )
}
