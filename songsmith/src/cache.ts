import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Disk cache, one directory per Spotify track id. Every pipeline stage's
 * output is kept (raw UG js-store included) so any stage can be redone —
 * or its parser fixed — without repeating the ones before it.
 *
 *   <cacheDir>/<trackId>/meta.json        stage bookkeeping + picks
 *   <cacheDir>/<trackId>/ug-<tabId>.json  raw js-store JSON
 *   <cacheDir>/<trackId>/audio.m4a        yt-dlp download
 *   <cacheDir>/<trackId>/allin1.json      analyzer output (raw)
 *   <cacheDir>/<trackId>/songmap.json     the fused Song Map
 */

export interface TrackMeta {
  trackUri: string
  chosenTabId?: number
  chosenVideoId?: number | string
  /** Set when the user must pick a UG version (no Official chart). */
  pendingVersions?: unknown[]
  /** Set when no YouTube candidate scored above threshold. */
  pendingAudio?: unknown[]
  lastError?: { stage: string; message: string; hint?: string }
}

export function trackIdOf(trackUri: string): string {
  const id = trackUri.split(':').pop() ?? trackUri
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

export class TrackCache {
  constructor(private cacheDir: string, readonly trackUri: string) {}

  get dir(): string {
    return join(this.cacheDir, trackIdOf(this.trackUri))
  }

  ensureDir(): void {
    mkdirSync(this.dir, { recursive: true })
  }

  path(name: string): string {
    return join(this.dir, name)
  }

  has(name: string): boolean {
    return existsSync(this.path(name))
  }

  readJson<T>(name: string): T | null {
    if (!this.has(name)) return null
    try {
      return JSON.parse(readFileSync(this.path(name), 'utf8')) as T
    } catch {
      return null
    }
  }

  writeJson(name: string, data: unknown): void {
    this.ensureDir()
    writeFileSync(this.path(name), JSON.stringify(data, null, 2))
  }

  remove(name: string): void {
    rmSync(this.path(name), { force: true })
  }

  readMeta(): TrackMeta {
    return this.readJson<TrackMeta>('meta.json') ?? { trackUri: this.trackUri }
  }

  writeMeta(meta: TrackMeta): void {
    this.writeJson('meta.json', meta)
  }
}
