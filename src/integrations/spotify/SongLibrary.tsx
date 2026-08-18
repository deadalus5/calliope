import { useCallback, useEffect, useState } from 'react'
import { keyHeadline } from './spotify-utils'
import { listSongMaps, removeSongMap } from './songmap-store'
import type { SongMap } from './songmap'

/**
 * Every learned song at a glance — open the Jam Room and your repertoire is
 * just there, no Spotify search needed. Click a row to play it; the map
 * loads from Dexie before Spotify even reports position. Deleting only
 * forgets the local copy (the sidecar cache keeps the durable one).
 */

function relativeDay(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return `${Math.floor(days / 30)} months ago`
}

export function SongLibrary({ onPick }: { onPick: (trackUri: string) => void }) {
  const [rows, setRows] = useState<{ map: SongMap; updatedAt: number }[] | null>(null)

  const refresh = useCallback(() => { void listSongMaps().then(setRows) }, [])
  useEffect(refresh, [refresh])

  if (rows === null || rows.length === 0) return null

  return (
    <div className="panel songmap-library">
      <h3>Learned songs</h3>
      <div className="songmap-librows">
        {rows.map(({ map, updatedAt }) => (
          <div key={map.trackUri} className="songmap-librow">
            <button className="songmap-libplay" onClick={() => onPick(map.trackUri)}>
              <span className="songmap-libtitle">
                {map.trackName} <span className="dim">— {map.artistName}</span>
              </span>
              <span className="dim songmap-libmeta">
                {keyHeadline(map.key)} · {Math.round(map.tempo.bpm)} bpm · {map.sections.length} sections
                {map.provenance.refined ? ' · refined ✓' : ''} · {relativeDay(updatedAt)}
              </span>
            </button>
            <button
              className="songmap-libdelete"
              title="forget this song here (songsmith's cache keeps a copy)"
              onClick={() => { void removeSongMap(map.trackUri).then(refresh) }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
