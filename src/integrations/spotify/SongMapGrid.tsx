import { degreeLabel } from './spotify-utils'
import type { ResolvedTiming, SongMap } from './songmap'

/**
 * The chord chart, grouped by section. The sounding chord is solid ember,
 * the next change is pearl-dashed (same visual grammar as the fretboard's
 * target markers) — eyes lead hands. Click any chord to jump there. While
 * the correction bar is open, every chip grows ◂ ▸ half-beat nudges.
 */
export function SongMapGrid({ map, resolved, chordIndex, nextChordIndex, activeSectionIndex, onSeek, nudgeMode, onNudge }: {
  map: SongMap
  resolved: ResolvedTiming
  chordIndex: number
  nextChordIndex: number
  activeSectionIndex: number
  onSeek: (ms: number) => void
  nudgeMode?: boolean
  onNudge?: (chordIndex: number, dir: -1 | 1) => void
}) {
  const msByChordIndex = new Map(resolved.chords.map((c) => [c.chordIndex, c.ms]))
  return (
    <div className="songmap-grid">
      {map.sections.map((s, si) => {
        const chords = map.chords
          .map((c, i) => ({ chord: c, i }))
          .filter((x) => x.chord.sectionId === s.id)
        if (chords.length === 0) return null
        return (
          <div key={s.id} className={`songmap-gridsection${si === activeSectionIndex ? ' active' : ''}`}>
            <span className="songmap-gridlabel mono">{s.label}</span>
            <div className="songmap-gridchords">
              {chords.map(({ chord, i }) => (
                <span key={i} className="songmap-chipwrap">
                  {nudgeMode && onNudge && (
                    <button className="songmap-nudge" onClick={() => onNudge(i, -1)} title="half a beat earlier">◂</button>
                  )}
                  <button
                    className={
                      'spotify-chip songmap-chordchip' +
                      (i === chordIndex ? ' active' : '') +
                      (i === nextChordIndex ? ' next' : '')
                    }
                    onClick={() => onSeek(msByChordIndex.get(i) ?? chord.ms)}
                  >
                    {chord.symbol}
                    <span className="songmap-chipdeg">{degreeLabel(chord.rootDegree)}</span>
                  </button>
                  {nudgeMode && onNudge && (
                    <button className="songmap-nudge" onClick={() => onNudge(i, 1)} title="half a beat later">▸</button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
