import { useEffect, useRef, useState } from 'react'
import { lineAtMs, type LrcLine, type PlacedChord } from './lrc'

/**
 * Karaoke-with-chords: synced lines with the changes floating over the
 * words at their moment in the line. Highlight runs its own 250ms clock —
 * the playhead hook only re-renders on musical coordinates, too coarse for
 * line-level sing-along.
 */
export function LyricsPanel({ lines, placed, clockMs }: {
  lines: LrcLine[]
  placed: PlacedChord[][]
  clockMs(): number
}) {
  const [current, setCurrent] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setCurrent(lineAtMs(lines, clockMs())), 250)
    return () => clearInterval(timer)
  }, [lines, clockMs])

  useEffect(() => {
    listRef.current?.querySelector('.songmap-lyricline.active')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current])

  return (
    <div className="songmap-lyrics" ref={listRef}>
      {lines.map((l, i) => (
        <div key={i} className={`songmap-lyricline${i === current ? ' active' : ''}`}>
          {placed[i]?.length > 0 && (
            <div className="songmap-lyricchords mono">
              {placed[i].map((p, k) => (
                <span key={k} style={{ left: `${p.frac * 100}%` }}>{p.symbol}</span>
              ))}
            </div>
          )}
          <div className="songmap-lyrictext">{l.text || '…'}</div>
        </div>
      ))}
    </div>
  )
}
