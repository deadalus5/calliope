import type { ResolvedTiming, SongMap } from './songmap'

/**
 * The form at a glance: INTRO | V1 | CH1 | SOLO … — click a block to jump
 * the record there. The active section stays lit as the song moves, and
 * carries a loop toggle (⟳) when looping is available.
 */
export function SectionStrip({ map, resolved, activeIndex, onSeek, loopIndex, onToggleLoop }: {
  map: SongMap
  resolved: ResolvedTiming
  activeIndex: number
  onSeek: (ms: number) => void
  loopIndex?: number | null
  onToggleLoop?: (sectionIndex: number) => void
}) {
  return (
    <div className="songmap-sections" role="tablist" aria-label="song sections">
      {map.sections.map((s, i) => (
        <span key={s.id} className="songmap-sectionwrap">
          <button
            className={`songmap-section${i === activeIndex ? ' active' : ''}${i === loopIndex ? ' looping' : ''}`}
            onClick={() => onSeek(Math.max(0, resolved.sections[i].startMs))}
            title={`jump to ${s.label}`}
          >
            {s.label}
          </button>
          {onToggleLoop && (i === activeIndex || i === loopIndex) && (
            <button
              className={`songmap-loopbtn${i === loopIndex ? ' active' : ''}`}
              onClick={() => onToggleLoop(i)}
              title={i === loopIndex ? `stop looping ${s.label}` : `loop ${s.label}`}
              aria-label={i === loopIndex ? `stop looping ${s.label}` : `loop ${s.label}`}
            >
              ⟳
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
