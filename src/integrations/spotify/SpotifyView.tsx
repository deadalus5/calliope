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
import './spotify.css'

/**
 * Jam Room — the real recordings, with the fretboard following a chart you
 * tap in sync yourself. Needs the user's own Spotify app Client ID and a
 * Premium account; everything runs client-side.
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

  useEffect(() => {
    setChart(player.trackUri ? chartFor(player.trackUri) : null)
  }, [player.trackUri])

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

      {player.trackUri && (
        chart
          ? <ChartFollower chart={chart} onRebuild={() => { deleteChart(player.trackUri!); setChart(null) }} />
          : <ChartMaker player={player} onSaved={setChart} />
      )}
    </div>
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
