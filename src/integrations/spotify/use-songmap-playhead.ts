import { useEffect, useMemo, useState } from 'react'
import { estimatePositionMs } from './player'
import {
  beatsToNextChange, chordAtMs, nextChordAfter, resolveTiming, sectionAtMs,
  type ResolvedTiming, type SongMap, type UserCorrections,
} from './songmap'

/**
 * The Spotify playhead, translated into Song Map coordinates. Polls the
 * player's interpolated clock at 100ms (the cadence the old ChartFollower
 * proved out) and answers "which chord / which section / how many beats to
 * the change" via binary search over the corrections-resolved timeline.
 */

export interface PlayheadState {
  positionMs: number
  /** Index into map.chords, -1 before the first chord. */
  chordIndex: number
  /** Index into map.chords for the next change, -1 after the last. */
  nextChordIndex: number
  /** Index into map.sections, -1 before the first. */
  sectionIndex: number
  /** Whole beats until the next change, null when there is none. */
  beatsToChange: number | null
}

const IDLE: PlayheadState = {
  positionMs: 0, chordIndex: -1, nextChordIndex: -1, sectionIndex: -1, beatsToChange: null,
}

export function useSongMapPlayhead(map: SongMap, corrections?: UserCorrections | null): {
  playhead: PlayheadState
  resolved: ResolvedTiming
} {
  const resolved = useMemo(() => resolveTiming(map, corrections), [map, corrections])
  const [playhead, setPlayhead] = useState<PlayheadState>(IDLE)

  useEffect(() => {
    const timer = setInterval(() => {
      const ms = estimatePositionMs()
      const at = chordAtMs(resolved, ms)
      const next = nextChordAfter(resolved, ms)
      setPlayhead((prev) => {
        const state: PlayheadState = {
          positionMs: ms,
          chordIndex: at === -1 ? -1 : resolved.chords[at].chordIndex,
          nextChordIndex: next === -1 ? -1 : resolved.chords[next].chordIndex,
          sectionIndex: sectionAtMs(resolved, ms),
          beatsToChange: beatsToNextChange(resolved, map, ms),
        }
        // Avoid re-render churn: position changes every tick, but consumers
        // only care when the musical coordinates move.
        return prev.chordIndex === state.chordIndex &&
          prev.sectionIndex === state.sectionIndex &&
          prev.beatsToChange === state.beatsToChange &&
          prev.nextChordIndex === state.nextChordIndex
          ? prev
          : state
      })
    }, 100)
    return () => clearInterval(timer)
  }, [map, resolved])

  return { playhead, resolved }
}
