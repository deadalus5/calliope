import { getAccessToken } from './auth'

/**
 * Web Playback SDK wrapper: loads the CDN script, registers this browser as
 * a Spotify Connect device, and exposes play/pause/seek plus a polled
 * position estimate (getCurrentState ~4Hz + linear interpolation between
 * polls — Spotify gives no beat grid, so charts are tap-synced by the user).
 */

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void
    Spotify?: any
  }
}

export interface PlayerState {
  connected: boolean
  paused: boolean
  positionMs: number
  durationMs: number
  trackUri: string | null
  trackName: string
  artistName: string
}

type StateListener = (s: PlayerState) => void

let player: any = null
let deviceId: string | null = null
const listeners = new Set<StateListener>()
let lastState: PlayerState = {
  connected: false, paused: true, positionMs: 0, durationMs: 0,
  trackUri: null, trackName: '', artistName: '',
}
let pollTimer: ReturnType<typeof setInterval> | null = null
let lastPollAt = 0

function emit() {
  for (const l of listeners) l(lastState)
}

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve()
  return new Promise((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve()
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    document.body.appendChild(script)
  })
}

export async function connectPlayer(): Promise<boolean> {
  if (player) return true
  await loadSdk()
  player = new window.Spotify.Player({
    name: 'Calliope Jam Room',
    getOAuthToken: async (cb: (t: string) => void) => {
      const token = await getAccessToken()
      if (token) cb(token)
    },
    volume: 0.9,
  })
  return new Promise((resolve) => {
    player.addListener('ready', ({ device_id }: { device_id: string }) => {
      deviceId = device_id
      lastState = { ...lastState, connected: true }
      emit()
      startPolling()
      resolve(true)
    })
    player.addListener('initialization_error', () => resolve(false))
    player.addListener('authentication_error', () => resolve(false))
    player.addListener('account_error', () => resolve(false)) // not Premium
    void player.connect()
  })
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    if (!player) return
    const s = await player.getCurrentState()
    lastPollAt = performance.now()
    if (s) {
      lastState = {
        connected: true,
        paused: s.paused,
        positionMs: s.position,
        durationMs: s.duration,
        trackUri: s.track_window?.current_track?.uri ?? null,
        trackName: s.track_window?.current_track?.name ?? '',
        artistName: s.track_window?.current_track?.artists?.[0]?.name ?? '',
      }
      emit()
    }
  }, 250)
}

/** Position estimate between polls. */
export function estimatePositionMs(): number {
  if (lastState.paused) return lastState.positionMs
  return lastState.positionMs + (performance.now() - lastPollAt)
}

export function onPlayerState(l: StateListener): () => void {
  listeners.add(l)
  l(lastState)
  return () => listeners.delete(l)
}

export async function playTrack(uri: string): Promise<boolean> {
  const token = await getAccessToken()
  if (!token || !deviceId) return false
  const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri] }),
  })
  return res.ok
}

export function togglePlay(): void { void player?.togglePlay() }
export function seekMs(ms: number): void { void player?.seek(ms) }

export interface TrackHit {
  uri: string
  name: string
  artist: string
}

export async function searchTracks(q: string): Promise<TrackHit[]> {
  const token = await getAccessToken()
  if (!token) return []
  const res = await fetch(
    `https://api.spotify.com/v1/search?type=track&limit=8&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) return []
  const json = await res.json()
  return (json.tracks?.items ?? []).map((t: any) => ({
    uri: t.uri, name: t.name, artist: t.artists?.[0]?.name ?? '',
  }))
}

export function disconnectPlayer(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  player?.disconnect()
  player = null
  deviceId = null
  lastState = { ...lastState, connected: false }
}
