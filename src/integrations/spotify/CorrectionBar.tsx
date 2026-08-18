import { useEffect } from 'react'
import { hasTimingEdits } from './corrections'
import { sectionCorrectionKey, type SongMap, type TapRecord, type UserCorrections } from './songmap'

/**
 * Tap 2.0: the "fix timing" surface. One big button (or spacebar) says
 * "the change is NOW" and shifts the nearest change's whole section; the
 * steppers are the fine-grained fallback. Resets zero the derived offsets
 * only — the map and the tap history are never touched.
 */
export function CorrectionBar({ map, corrections, lastTap, activeSectionIndex, onTap, onBumpGlobal, onBumpSection, onResetSection, onResetAll }: {
  map: SongMap
  corrections: UserCorrections
  lastTap: TapRecord | null
  activeSectionIndex: number
  onTap: () => void
  onBumpGlobal: (deltaMs: number) => void
  onBumpSection: (sectionIndex: number, deltaMs: number) => void
  onResetSection: (sectionIndex: number) => void
  onResetAll: () => void
}) {
  // Spacebar taps while the bar is open (the ChartMaker pattern) — but never
  // steal spaces from a text field (the search box stays typable).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') { e.preventDefault(); onTap() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onTap])

  const active = activeSectionIndex >= 0 ? map.sections[activeSectionIndex] : null
  const activeOffset = active
    ? (corrections.sectionOffsets[sectionCorrectionKey(active.kind, active.ordinal)] ?? 0)
    : 0

  return (
    <div className="songmap-correctionbar">
      <div className="controls">
        <button className="primary songmap-tapbtn" onClick={onTap}>
          the change is NOW <span className="dim">(space)</span>
        </button>
        {lastTap && (
          <span className="dim songmap-tapreadout mono">
            {lastTap.appliedOffsetMs >= 0 ? '+' : ''}{lastTap.appliedOffsetMs}ms → {lastTap.scope.kind} {lastTap.scope.ordinal}
          </span>
        )}
      </div>
      <div className="controls">
        <div className="control-group">
          <span className="control-label">everything</span>
          <button onClick={() => onBumpGlobal(-25)}>−25ms</button>
          <span className="mono dim">{corrections.globalOffsetMs}ms</span>
          <button onClick={() => onBumpGlobal(25)}>+25ms</button>
        </div>
        {active && (
          <div className="control-group">
            <span className="control-label">{active.label}</span>
            <button onClick={() => onBumpSection(activeSectionIndex, -100)}>−100ms</button>
            <span className="mono dim">{activeOffset}ms</span>
            <button onClick={() => onBumpSection(activeSectionIndex, 100)}>+100ms</button>
            <button onClick={() => onResetSection(activeSectionIndex)}>reset {active.label}</button>
          </div>
        )}
        {hasTimingEdits(corrections) && (
          <button className="songmap-resetall" onClick={onResetAll}>reset all timing</button>
        )}
      </div>
      <p className="dim songmap-correctionhint">
        Chord chips grow ◂ ▸ nudges (half a beat each) while this is open. Taps and nudges stick
        to "the second chorus", so they survive redoing the song.
      </p>
    </div>
  )
}
