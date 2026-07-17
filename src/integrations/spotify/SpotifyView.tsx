import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Fretboard } from '../../fretboard/Fretboard'
import { chordToneLayer, skeletonLayer } from '../../fretboard/build-layers'
import type { FretboardLayer } from '../../fretboard/layers'
import {
  PC, parseChordSymbol, pcName, playbackKeys, type PitchClass,
} from './spotify-utils'
import { beginLogin, getClientId, loggedIn, logout, setClientId, REDIRECT_URI } from './auth'
import {
  connectPlayer, estimatePositionMs, onPlayerState, playTrack, searchTracks,
  seekMs, togglePlay, type PlayerState, type TrackHit,
} from './player'
import { chartFor, deleteChart, entryAt, saveChart, type TrackChart } from './charts'
import { SongMapFollower } from './SongMapFollower'
import { SongsmithSettings } from './SongsmithSettings'
import { VersionPicker } from './VersionPicker'
import { loadSongMap, removeSongMap, saveSongMap } from './songmap-store'
import {
  getSongsmithUrl, pickVersion, reanalyze, requestSongMap,
  type SongmapStatus, type TrackParams,
} from './songsmith-client'
import type { SongMap } from './songmap'
import './spotify.css'

/**
 * Jam Room — the real recordings, with the fretboard following a Song Map
 * built by the songsmith sidecar (chords from UG, beat and sections heard
 * from the audio, key + mode inferred). Hand-tapped charts remain as the
 * fallback when the sidecar is off. Needs the user's own Spotify app Client
 * ID and a Premium account; playback runs client-side.
 */

export function SpotifyView() {
  const [clientId, setClientIdState] = useState(getClientId() ?? '')
  const [authed, setAuthed] = useState(loggedIn())
  const [player, setPlayer] = useState<PlayerState | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => onPlayerState(setPlayer), [])

  if (!getClientId()) {
    return (
      <div className="panel spotify-setup">
        <h3>Jam Room setup (one time)</h3>
        <ol>
          <li>Go to <span className="mono">developer.spotify.com/dashboard</span> and create an app.</li>
          <li>Add <span className="mono">{REDIRECT_URI}</span> as a Redirect URI (must be exactly this — Spotify rejects “localhost”).</li>
          <li>Enable the <b>Web Playback SDK</b> API, save, and copy the <b>Client ID</b> here:</li>
        </ol>
        <div className="controls">
          <input
            className="spotify-input mono"
            placeholder="paste Client ID"
            value={clientId}
            onChange={(e) => setClientIdState(e.target.value)}
          />
          <button
            className="primary"
            onClick={() => { if (clientId.trim()) { setClientId(clientId); setAuthed(loggedIn()); window.location.reload() } }}
          >
            save
          </button>
        </div>
        <p className="dim">Spotify Premium is required for in-browser playback. Chrome works best.</p>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="panel spotify-setup">
        <h3>Jam Room</h3>
        <p className="dim">Client ID saved. Now connect your Spotify account.</p>
        <div className="controls">
          <button className="primary" onClick={() => void beginLogin()}>log in with Spotify</button>
          <button onClick={() => { setClientId(''); localStorage.removeItem('spotify:clientId'); window.location.reload() }}>
            change Client ID
          </button>
        </div>
      </div>
    )
  }

  if (!player?.connected) {
    return (
      <div className="panel spotify-setup">
        <h3>Jam Room</h3>
        <div className="controls">
          <button
            className="primary"
            disabled={connecting}
            onClick={async () => {
              setConnecting(true)
              const ok = await connectPlayer()
              if (!ok) setConnecting(false)
            }}
          >
            {connecting ? 'connecting…' : 'open the jam room'}
          </button>
          <button onClick={() => { logout(); setAuthed(false) }}>log out</button>
        </div>
        {connecting && <p className="dim">If nothing happens: check Premium, and use Chrome (DRM).</p>}
      </div>
    )
  }

  return <JamRoom player={player} />
}

function JamRoom({ player }: { player: PlayerState }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<TrackHit[]>([])
  const [chart, setChart] = useState<TrackChart | null>(null)
  const [songmap, setSongmap] = useState<SongMap | null>(null)
  const [fetchState, setFetchState] = useState<SongmapStatus | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const trackParams: TrackParams | null = player.trackUri
    ? {
        trackUri: player.trackUri,
        trackName: player.trackName,
        artistName: player.artistName,
        durationMs: player.durationMs,
      }
    : null

  // Track change: learned Song Map from Dexie first, legacy tap chart as fallback.
  useEffect(() => {
    setSongmap(null)
    setFetchState(null)
    setManualMode(false)
    setChart(player.trackUri ? chartFor(player.trackUri) : null)
    if (!player.trackUri) return
    let alive = true
    void loadSongMap(player.trackUri).then((m) => { if (alive && m) setSongmap(m) })
    return () => { alive = false }
  }, [player.trackUri])

  // No map yet + sidecar configured: ask songsmith and poll until it lands.
  // The request is idempotent — polling never restarts a failed job. Wait
  // for a real duration: it drives the recording match on the sidecar.
  useEffect(() => {
    if (!trackParams || trackParams.durationMs <= 0 || songmap || manualMode || !getSongsmithUrl()) return
    let alive = true
    const poll = async () => {
      const status = await requestSongMap(trackParams)
      if (!alive) return
      setFetchState(status)
      if (status.status === 'ready') {
        await saveSongMap(status.songmap)
        if (alive) setSongmap(status.songmap)
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 2000)
    return () => { alive = false; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.trackUri, player.durationMs > 0, songmap, manualMode])

  const redoSong = async () => {
    if (!trackParams) return
    await removeSongMap(trackParams.trackUri)
    setSongmap(null)
    setFetchState(await reanalyze(trackParams, 'all'))
  }

  const pick = async (choice: { tabId?: number; youtubeUrl?: string }) => {
    if (!trackParams) return
    setFetchState(await pickVersion(trackParams.trackUri, choice))
  }

  const sidecarConfigured = Boolean(getSongsmithUrl())

  return (
    <div>
      <div className="panel">
        <div className="controls">
          <input
            className="spotify-input"
            placeholder="search a song… (Gravity, Franklin's Tower)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={async (e) => { if (e.key === 'Enter') setHits(await searchTracks(query)) }}
          />
          <button onClick={async () => setHits(await searchTracks(query))}>search</button>
          {player.trackName && (
            <span className="spotify-now mono">
              ♪ {player.trackName} — {player.artistName}
            </span>
          )}
          <button onClick={() => togglePlay()}>{player.paused ? 'play' : 'pause'}</button>
          <button onClick={() => setShowSettings((v) => !v)} title="songsmith sidecar settings">⚙</button>
        </div>
        {hits.length > 0 && (
          <div className="spotify-hits">
            {hits.map((h) => (
              <button key={h.uri} onClick={async () => { await playTrack(h.uri); setHits([]) }}>
                {h.name} <span className="dim">— {h.artist}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {showSettings && <SongsmithSettings onClose={() => setShowSettings(false)} />}

      {player.trackUri && (
        songmap
          ? <SongMapFollower map={songmap} onRedo={() => void redoSong()} />
          : <SongPrep
              player={player}
              chart={chart}
              fetchState={fetchState}
              sidecarConfigured={sidecarConfigured}
              manualMode={manualMode}
              onManual={() => setManualMode(true)}
              onPickTab={(tabId) => void pick({ tabId })}
              onPickUrl={(youtubeUrl) => void pick({ youtubeUrl })}
              onChart={setChart}
              onRetapChart={() => { deleteChart(player.trackUri!); setChart(null) }}
            />
      )}
    </div>
  )
}

/** Everything shown for a track that has no Song Map yet: songsmith progress,
 * pickers, errors — with the hand-tapped chart flow always reachable. */
function SongPrep({ player, chart, fetchState, sidecarConfigured, manualMode, onManual, onPickTab, onPickUrl, onChart, onRetapChart }: {
  player: PlayerState
  chart: TrackChart | null
  fetchState: SongmapStatus | null
  sidecarConfigured: boolean
  manualMode: boolean
  onManual: () => void
  onPickTab: (tabId: number) => void
  onPickUrl: (url: string) => void
  onChart: (c: TrackChart) => void
  onRetapChart: () => void
}) {
  const legacy = chart
    ? <ChartFollower chart={chart} onRebuild={onRetapChart} />
    : <ChartMaker player={player} onSaved={onChart} />

  if (manualMode || !sidecarConfigured) return legacy

  if (fetchState?.status === 'pick') {
    return (
      <VersionPicker
        versions={fetchState.versions}
        audioCandidates={fetchState.audioCandidates}
        onPickTab={onPickTab}
        onPickUrl={onPickUrl}
      />
    )
  }

  if (fetchState?.status === 'error' || fetchState?.status === 'offline') {
    return (
      <>
        <div className="panel">
          <p className="dim">
            {fetchState.status === 'offline'
              ? 'songsmith is not reachable — is it running on the mini?'
              : `songsmith hit a wall (${fetchState.stage ?? '?'}): ${fetchState.message}`}
            {fetchState.status === 'error' && fetchState.hint && <><br />hint: {fetchState.hint}</>}
          </p>
          <div className="controls">
            <button onClick={onManual}>tap a chart by hand instead</button>
          </div>
        </div>
        {chart && legacy}
      </>
    )
  }

  return (
    <>
      <div className="panel">
        <p className="dim songmap-progress">
          {fetchState?.status === 'working' ? fetchState.detail : 'asking songsmith about this song…'}
          {fetchState?.status === 'working' && fetchState.stage === 'analyze' && ' ☕'}
        </p>
        <div className="controls">
          <button onClick={onManual}>tap a chart by hand instead</button>
        </div>
      </div>
      {chart && legacy}
    </>
  )
}

function ChartMaker({ player, onSaved }: { player: PlayerState; onSaved: (c: TrackChart) => void }) {
  const [text, setText] = useState('')
  const [key, setKey] = useState<PitchClass>(PC.A)
  const [skeleton, setSkeleton] = useState<'minor' | 'major'>('minor')
  const [tapIdx, setTapIdx] = useState<number | null>(null)
  const taps = useRef<{ ms: number; symbol: string }[]>([])

  const symbols = useMemo(
    () => text.split(/[\s,|]+/).map((s) => s.trim()).filter(Boolean),
    [text],
  )
  const symbolsValid = useMemo(() => {
    try { symbols.forEach(parseChordSymbol); return symbols.length > 0 } catch { return false }
  }, [symbols])

  const tap = useCallback(() => {
    if (tapIdx === null || tapIdx >= symbols.length) return
    taps.current.push({ ms: estimatePositionMs(), symbol: symbols[tapIdx] })
    if (tapIdx + 1 >= symbols.length) {
      const chart: TrackChart = {
        trackUri: player.trackUri!,
        trackName: player.trackName,
        key, skeleton,
        entries: taps.current,
      }
      saveChart(chart)
      onSaved(chart)
      setTapIdx(null)
    } else {
      setTapIdx(tapIdx + 1)
    }
  }, [tapIdx, symbols, player, key, skeleton, onSaved])

  // spacebar taps
  useEffect(() => {
    if (tapIdx === null) return
    const h = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); tap() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [tapIdx, tap])

  return (
    <div className="panel">
      <h3>Build the chart for “{player.trackName}”</h3>
      <p className="dim">
        Write the changes in order (repeats included), one symbol per change — e.g.
        <span className="mono"> G C/G G C/G Bm7 C</span>. Then play the track and tap
        (button or spacebar) exactly on each change.
      </p>
      <div className="controls">
        <input
          className="spotify-input mono" style={{ minWidth: 420 }}
          placeholder="chords in order of appearance"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={tapIdx !== null}
        />
        <div className="control-group">
          <span className="control-label">Key</span>
          <select value={key} onChange={(e) => setKey(Number(e.target.value))} disabled={tapIdx !== null}>
            {playbackKeys().map((k) => <option key={k} value={k}>{pcName(k, k)}</option>)}
          </select>
        </div>
        <div className="seg">
          {(['minor', 'major'] as const).map((s) => (
            <button key={s} className={skeleton === s ? 'active' : ''} onClick={() => setSkeleton(s)} disabled={tapIdx !== null}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="controls">
        {tapIdx === null ? (
          <button
            className="primary"
            disabled={!symbolsValid}
            onClick={() => { taps.current = []; seekMs(0); setTapIdx(0); if (player.paused) togglePlay() }}
          >
            {symbolsValid ? 'restart track and start tapping' : 'write valid chords first'}
          </button>
        ) : (
          <>
            <button className="primary spotify-tap" onClick={tap}>
              TAP → {symbols[tapIdx]} <span className="dim">({tapIdx + 1}/{symbols.length})</span>
            </button>
            <button onClick={() => setTapIdx(null)}>cancel</button>
          </>
        )}
      </div>
    </div>
  )
}

function ChartFollower({ chart, onRebuild }: { chart: TrackChart; onRebuild: () => void }) {
  const [index, setIndex] = useState<number | null>(null)

  useEffect(() => {
    const timer = setInterval(() => {
      const found = entryAt(chart, estimatePositionMs())
      setIndex(found ? found.index : null)
    }, 120)
    return () => clearInterval(timer)
  }, [chart])

  const chordLayers = useMemo(
    () => chart.entries.map((e) => {
      try { return chordToneLayer(parseChordSymbol(e.symbol), chart.key) } catch { return null }
    }),
    [chart],
  )

  const layers = useMemo(() => {
    const out: FretboardLayer[] = [skeletonLayer(chart.key, chart.skeleton, 'all')]
    if (index !== null && chordLayers[index]) out.push(chordLayers[index]!)
    return out
  }, [chart, index, chordLayers])

  return (
    <div className="panel">
      <div className="controls">
        <span className="songlab-chord">{index !== null ? chart.entries[index].symbol : '—'}</span>
        <div className="spotify-chartstrip">
          {chart.entries.map((e, i) => (
            <button
              key={i}
              className={`spotify-chip${i === index ? ' active' : ''}`}
              onClick={() => seekMs(e.ms)}
            >
              {e.symbol}
            </button>
          ))}
        </div>
        <button onClick={onRebuild}>re-tap chart</button>
      </div>
      <Fretboard layers={layers} keyRoot={chart.key} />
    </div>
  )
}
