import { seekMs } from './player'
import { degreeLabel } from './spotify-utils'
import type { ResolvedTiming, SongMap } from './songmap'

/**
 * The chord chart, grouped by section. The sounding chord is solid ember,
 * the next change is pearl-dashed (same visual grammar as the fretboard's
 * target markers) — eyes lead hands. Click any chord to jump there.
 */
export function SongMapGrid({ map, resolved, chordIndex, nextChordIndex, activeSectionIndex }: {
  map: SongMap
  resolved: ResolvedTiming
  chordIndex: number
  nextChordIndex: number
  activeSectionIndex: number
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
                <button
                  key={i}
                  className={
                    'spotify-chip songmap-chordchip' +
                    (i === chordIndex ? ' active' : '') +
                    (i === nextChordIndex ? ' next' : '')
                  }
                  onClick={() => seekMs(msByChordIndex.get(i) ?? chord.ms)}
                >
                  {chord.symbol}
                  <span className="songmap-chipdeg">{degreeLabel(chord.rootDegree)}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
