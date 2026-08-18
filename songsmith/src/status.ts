import type { SongMap } from '../../src/integrations/spotify/songmap'
import type { TrackMeta } from './cache'
import type { AudioMatch, UgVersionInfo } from './types'

/** Job status vocabulary + the pure disk-recovery logic (no I/O here). */

export type Stage = 'ug' | 'audio' | 'analyze' | 'fuse' | 'refine'

export type JobStatus =
  | { status: 'ready'; songmap: SongMap }
  | { status: 'working'; stage: Stage; detail: string }
  | { status: 'pick'; versions?: UgVersionInfo[]; audioCandidates?: AudioMatch[] }
  | { status: 'error'; stage: Stage; message: string; hint?: string }

export interface TrackParams {
  trackUri: string
  trackName: string
  artistName: string
  durationMs: number
}

/**
 * What the disk alone says about a track — the recovery path after a sidecar
 * restart: finished maps, durable errors, and pending audio picks all live in
 * the cache, so no state is silently lost when the in-memory job table is
 * gone. Null = no history; the caller may start a fresh pipeline.
 */
export function statusFromDisk(meta: TrackMeta, songmap: SongMap | null): JobStatus | null {
  if (songmap) return { status: 'ready', songmap }
  if (meta.lastError) {
    return {
      status: 'error',
      stage: (meta.lastError.stage as Stage) || 'ug',
      message: meta.lastError.message,
      hint: meta.lastError.hint,
    }
  }
  if (meta.pendingAudio?.length) return { status: 'pick', audioCandidates: meta.pendingAudio as AudioMatch[] }
  if (meta.pendingVersions?.length) return { status: 'pick', versions: meta.pendingVersions as UgVersionInfo[] }
  return null
}
