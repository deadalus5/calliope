/**
 * Synced lyrics via LRCLIB (free, no auth). Fetched on the sidecar so the
 * app never fights CORS, cached per track beside the Song Map. A miss is a
 * normal answer, not an error.
 */

export interface LyricsDoc {
  /** LRC text ([mm:ss.xx] lines) or null. */
  synced: string | null
  plain: string | null
}

interface LrclibHit {
  syncedLyrics?: string | null
  plainLyrics?: string | null
}

export async function fetchLyrics(p: { artistName: string; trackName: string; durationMs: number }): Promise<LyricsDoc> {
  const base = 'https://lrclib.net/api'
  try {
    const get = new URLSearchParams({
      artist_name: p.artistName,
      track_name: p.trackName,
      duration: String(Math.round(p.durationMs / 1000)),
    })
    const exact = await fetch(`${base}/get?${get}`)
    if (exact.ok) {
      const j = (await exact.json()) as LrclibHit
      if (j.syncedLyrics || j.plainLyrics) return { synced: j.syncedLyrics ?? null, plain: j.plainLyrics ?? null }
    }
    // No exact match — search and take the first hit with synced lyrics.
    const q = new URLSearchParams({ artist_name: p.artistName, track_name: p.trackName })
    const search = await fetch(`${base}/search?${q}`)
    if (search.ok) {
      const hits = (await search.json()) as LrclibHit[]
      const best = hits.find((h) => h.syncedLyrics) ?? hits.find((h) => h.plainLyrics)
      if (best) return { synced: best.syncedLyrics ?? null, plain: best.plainLyrics ?? null }
    }
  } catch { /* network trouble — fall through to the miss */ }
  return { synced: null, plain: null }
}
