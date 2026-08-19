import { existsSync } from 'node:fs'
import { execa } from 'execa'
import type { TrackCache } from './cache'

/**
 * The practice deck's audio: the cached analysis download, plus slowed
 * renders per speed — ffmpeg's atempo filter is pitch-preserving, so a
 * rate-0.7 file is the same song at 70% tempo, same key. Rendered on first
 * request and cached beside the source (a few seconds each, once).
 */

/** Rates the deck may ask for; atempo's floor is exactly 0.5. */
export const MIN_RATE = 0.5
export const MAX_RATE = 1.25

/** Two-decimal rate from the query string, or null when out of range. */
export function quantizeRate(raw: string | undefined): number | null {
  const r = Number(raw ?? '1')
  if (!Number.isFinite(r)) return null
  const q = Math.round(r * 100) / 100
  return q >= MIN_RATE && q <= MAX_RATE ? q : null
}

export function rateFileName(rate: number): string {
  return rate === 1 ? 'audio.m4a' : `audio.r${rate.toFixed(2)}.m4a`
}

export interface ByteRange { start: number; end: number } // inclusive

/** RFC7233 single-range parse: null = no header, 'invalid' = 416. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'
  if (m[1] === '') {
    const n = Number(m[2]) // suffix form: the last N bytes
    if (n === 0 || size === 0) return 'invalid'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start >= size || end < start) return 'invalid'
  return { start, end }
}

const inFlight = new Map<string, Promise<void>>()

/** Path to the rate's file, rendering it first if needed (deduped). */
export async function ensureRateRender(cache: TrackCache, rate: number): Promise<string> {
  const out = cache.path(rateFileName(rate))
  if (rate === 1 || existsSync(out)) return out
  let p = inFlight.get(out)
  if (!p) {
    p = execa('ffmpeg', [
      '-y', '-i', cache.path('audio.m4a'),
      '-filter:a', `atempo=${rate}`,
      '-c:a', 'aac', '-b:a', '192k',
      out,
    ], { timeout: 180_000 }).then(() => undefined).finally(() => inFlight.delete(out))
    inFlight.set(out, p)
  }
  await p
  return out
}
