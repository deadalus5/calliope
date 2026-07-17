import { execa } from 'execa'
import type { AudioMatch } from './types'

/**
 * Audio acquisition: yt-dlp searches YouTube for the track, candidates are
 * scored against the Spotify metadata (duration dominates — the beat grid
 * must belong to the same master), and the winner is downloaded as m4a.
 */

export interface TrackTarget {
  artist: string
  title: string
  durationMs: number
}

export interface RawCandidate {
  videoId: string
  title: string
  channel: string
  durationSec: number
}

/** Pure candidate scoring, unit-testable. 1 is a confident match. */
export function scoreCandidate(c: RawCandidate, target: TrackTarget): number {
  let score = 0

  // Duration is the dominant term: within ±3s scores full marks, then decays.
  const deltaSec = Math.abs(c.durationSec - target.durationMs / 1000)
  score += deltaSec <= 3 ? 0.6 : Math.max(0, 0.6 - (deltaSec - 3) * 0.05)

  // Title token overlap.
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1))
  const want = tokens(`${target.artist} ${target.title}`)
  const have = tokens(`${c.channel} ${c.title}`)
  let overlap = 0
  for (const t of want) if (have.has(t)) overlap++
  score += want.size > 0 ? 0.25 * (overlap / want.size) : 0

  // Auto-generated "<Artist> - Topic" channels carry the actual album audio.
  if (/- topic$/i.test(c.channel.trim())) score += 0.15
  else if (/official audio|full album|provided to youtube/i.test(c.title)) score += 0.1

  // Wrong-recording red flags.
  if (/\b(live|cover|remix|reaction|karaoke|instrumental|tutorial|lesson|8d)\b/i.test(c.title)) score -= 0.35

  return Math.max(0, Math.min(1, score))
}

export const MATCH_THRESHOLD = 0.55

export async function searchCandidates(ytdlp: string, target: TrackTarget): Promise<AudioMatch[]> {
  const query = `ytsearch6:${target.artist} ${target.title}`
  const { stdout } = await execa(ytdlp, [
    query,
    '--no-download',
    '--flat-playlist',
    '--print', '%(id)s\t%(title)s\t%(duration)s\t%(channel)s',
  ], { timeout: 60_000 })

  const candidates: AudioMatch[] = []
  for (const line of stdout.split('\n')) {
    const [videoId, title, durationSec, channel] = line.split('\t')
    if (!videoId || !title) continue
    const raw: RawCandidate = {
      videoId,
      title,
      channel: channel ?? '',
      durationSec: Number(durationSec) || 0,
    }
    candidates.push({
      videoId: raw.videoId,
      videoTitle: raw.title,
      channel: raw.channel,
      durationMs: raw.durationSec * 1000,
      matchScore: scoreCandidate(raw, target),
    })
  }
  return candidates.sort((a, b) => b.matchScore - a.matchScore)
}

/** Download best audio as m4a to `outPath` (extension supplied by caller). */
export async function downloadAudio(ytdlp: string, videoId: string, outPath: string): Promise<void> {
  await execa(ytdlp, [
    `https://www.youtube.com/watch?v=${videoId}`,
    '-f', 'bestaudio',
    '-x', '--audio-format', 'm4a',
    '-o', outPath,
    '--no-playlist',
  ], { timeout: 300_000 })
}

/** Accept a pasted YouTube URL as an override; returns the video id. */
export function videoIdFromUrl(url: string): string | null {
  const m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/.exec(url)
  return m ? m[1] : null
}
