import { seekMs } from './player'
import type { ResolvedTiming, SongMap } from './songmap'

/**
 * The form at a glance: INTRO | V1 | CH1 | SOLO … — click a block to jump
 * the record there. The active section stays lit as the song moves.
 */
export function SectionStrip({ map, resolved, activeIndex }: {
  map: SongMap
  resolved: ResolvedTiming
  activeIndex: number
}) {
  return (
    <div className="songmap-sections" role="tablist" aria-label="song sections">
      {map.sections.map((s, i) => (
        <button
          key={s.id}
          className={`songmap-section${i === activeIndex ? ' active' : ''}`}
          onClick={() => seekMs(Math.max(0, resolved.sections[i].startMs))}
          title={`jump to ${s.label}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
