import { migrateSongMap, type SongMap } from './songmap'

/**
 * Fetch wrapper for the songsmith sidecar on the Mac mini. Everything
 * returns a typed result — never throws into render. The sidecar being off
 * is a normal state: cached Song Maps keep working, new songs fall back to
 * the hand-tapped chart flow.
 */

const LS_URL = 'spotify:songsmithUrl'

export function getSongsmithUrl(): string | null {
  // try/catch: the sidecar store reads this at module init, which must not
  // explode in environments without localStorage (tests).
  try {
    const v = localStorage.getItem(LS_URL)
    return v && v.trim().length > 0 ? v.trim().replace(/\/$/, '') : null
  } catch {
    return null
  }
}

export function setSongsmithUrl(url: string): void {
  try {
    if (url.trim()) localStorage.setItem(LS_URL, url.trim())
    else localStorage.removeItem(LS_URL)
  } catch { /* storage unavailable — session-only config */ }
}

export interface UgVersionChoice {
  tabId: number
  versionLabel: string
  type: string
  rating: number
  votes: number
  tonalityName: string | null
}

export interface AudioCandidate {
  videoId: string
  videoTitle: string
  channel: string
  durationMs: number
  matchScore: number
}

export type SongmapStatus =
  | { status: 'ready'; songmap: SongMap }
  | { status: 'working'; stage: string; detail: string }
  | { status: 'pick'; versions?: UgVersionChoice[]; audioCandidates?: AudioCandidate[] }
  | { status: 'error'; stage?: string; message: string; hint?: string }
  | { status: 'offline' }

export interface TrackParams {
  trackUri: string
  trackName: string
  artistName: string
  durationMs: number
}

async function call(path: string, init?: RequestInit, baseOverride?: string): Promise<unknown | { offline: true }> {
  const base = baseOverride ?? getSongsmithUrl()
  if (!base) return { offline: true }
  try {
    const res = await fetch(`${base}${path}`, init)
    return (await res.json()) as unknown
  } catch {
    return { offline: true }
  }
}

function toStatus(raw: unknown): SongmapStatus {
  if (typeof raw !== 'object' || raw === null) return { status: 'error', message: 'sidecar sent something unreadable' }
  const r = raw as Record<string, unknown>
  if ('offline' in r) return { status: 'offline' }
  switch (r.status) {
    case 'ready': {
      const map = migrateSongMap(r.songmap)
      return map
        ? { status: 'ready', songmap: map }
        : { status: 'error', message: 'sidecar sent a Song Map this app version cannot read' }
    }
    case 'working':
      return { status: 'working', stage: String(r.stage ?? ''), detail: String(r.detail ?? '') }
    case 'pick':
      return {
        status: 'pick',
        versions: Array.isArray(r.versions) ? (r.versions as UgVersionChoice[]) : undefined,
        audioCandidates: Array.isArray(r.audioCandidates) ? (r.audioCandidates as AudioCandidate[]) : undefined,
      }
    case 'error':
      return {
        status: 'error',
        stage: typeof r.stage === 'string' ? r.stage : undefined,
        message: String(r.message ?? 'unknown sidecar error'),
        hint: typeof r.hint === 'string' ? r.hint : undefined,
      }
    default:
      return { status: 'error', message: 'sidecar sent an unknown status' }
  }
}

export async function requestSongMap(params: TrackParams): Promise<SongmapStatus> {
  const q = new URLSearchParams({
    uri: params.trackUri,
    artist: params.artistName,
    title: params.trackName,
    durationMs: String(Math.round(params.durationMs)),
  })
  return toStatus(await call(`/songmap?${q}`))
}

export async function pickVersion(trackUri: string, choice: { tabId?: number; youtubeUrl?: string }): Promise<SongmapStatus> {
  return toStatus(await call('/pick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uri: trackUri, ...choice }),
  }))
}

/** Top UG versions for the re-pick flow ("change chart"). Null on any failure. */
export async function listVersions(params: { artistName: string; trackName: string }): Promise<UgVersionChoice[] | null> {
  const q = new URLSearchParams({ artist: params.artistName, title: params.trackName })
  const raw = await call(`/versions?${q}`)
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if ('offline' in r || !Array.isArray(r.versions)) return null
  return r.versions as UgVersionChoice[]
}

export async function reanalyze(params: TrackParams, stage: 'ug' | 'audio' | 'analyze' | 'all' | 'retry'): Promise<SongmapStatus> {
  return toStatus(await call('/reanalyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      uri: params.trackUri, stage,
      artist: params.artistName, title: params.trackName, durationMs: Math.round(params.durationMs),
    }),
  }))
}

/** The sidecar's cache key for a track (mirrors songsmith's trackIdOf). */
export function trackIdOf(trackUri: string): string {
  return (trackUri.split(':').pop() ?? trackUri).replace(/[^A-Za-z0-9_-]/g, '_')
}

/** URL of the practice deck's audio at a given rate, or null when no sidecar. */
export function audioUrl(trackUri: string, rate: number): string | null {
  const base = getSongsmithUrl()
  return base ? `${base}/audio/${trackIdOf(trackUri)}?rate=${rate}` : null
}

/** Does the sidecar hold this track's audio? (HEAD, cheap.) */
export async function probeAudio(trackUri: string): Promise<boolean> {
  const url = audioUrl(trackUri, 1)
  if (!url) return false
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

/** Chroma-refine an already-analyzed song ("tighten timing"). */
export async function requestRefine(params: TrackParams): Promise<SongmapStatus> {
  return toStatus(await call('/refine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      uri: params.trackUri,
      artist: params.artistName, title: params.trackName, durationMs: Math.round(params.durationMs),
    }),
  }))
}

export interface SidecarHealth {
  ok: boolean
  ytdlpVersion: string | null
  analyzerOk: boolean
  ugCookie: boolean
  cacheCount: number
}

export async function sidecarHealth(opts?: { base?: string; signal?: AbortSignal }): Promise<SidecarHealth | null> {
  const raw = await call('/health', opts?.signal ? { signal: opts.signal } : undefined, opts?.base)
  if (typeof raw !== 'object' || raw === null || 'offline' in (raw as Record<string, unknown>)) return null
  const r = raw as Record<string, unknown>
  return {
    ok: r.ok === true,
    ytdlpVersion: typeof r.ytdlpVersion === 'string' ? r.ytdlpVersion : null,
    analyzerOk: r.analyzerOk === true,
    ugCookie: r.ugCookie === true,
    cacheCount: typeof r.cacheCount === 'number' ? r.cacheCount : 0,
  }
}
