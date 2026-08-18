import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyTap, nudgeChord, resetSection as resetSectionPure, resetTiming, setGlobalOffset, shiftSection,
} from './corrections'
import { resolveTiming, type SongMap, type TapRecord, type UserCorrections } from './songmap'
import { loadCorrections, saveCorrections } from './songmap-store'

/**
 * Owns the corrections overlay for one track: Dexie load on track change,
 * immutable updates through the pure transforms, debounced persistence with
 * a flush on unmount/track-change. Every update is a fresh object, so the
 * playhead's resolveTiming memo re-resolves by identity — no extra signal.
 */

const PERSIST_DEBOUNCE_MS = 800

export function useCorrections(map: SongMap): {
  corrections: UserCorrections | null
  /** The tap that just landed (drives the "+120ms to CH1" readout). */
  lastTap: TapRecord | null
  tap(clockMs: number): void
  nudge(chordIndex: number, dir: -1 | 1): void
  bumpSection(sectionIndex: number, deltaMs: number): void
  bumpGlobal(deltaMs: number): void
  resetSection(sectionIndex: number): void
  resetAll(): void
} {
  const [corrections, setCorrections] = useState<UserCorrections | null>(null)
  const [lastTap, setLastTap] = useState<TapRecord | null>(null)
  const pendingRef = useRef<UserCorrections | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let alive = true
    setCorrections(null)
    setLastTap(null)
    void loadCorrections(map.trackUri).then((c) => { if (alive) setCorrections(c) })
    return () => {
      alive = false
      clearTimeout(timerRef.current)
      if (pendingRef.current) {
        void saveCorrections(pendingRef.current)
        pendingRef.current = null
      }
    }
  }, [map.trackUri])

  const update = useCallback((fn: (c: UserCorrections) => UserCorrections) => {
    setCorrections((cur) => {
      if (!cur) return cur
      const next = fn(cur)
      if (next === cur) return cur
      pendingRef.current = next
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (pendingRef.current) {
          void saveCorrections(pendingRef.current)
          pendingRef.current = null
        }
      }, PERSIST_DEBOUNCE_MS)
      return next
    })
  }, [])

  const tap = useCallback((clockMs: number) => {
    update((cur) => {
      const result = applyTap(cur, map, resolveTiming(map, cur), clockMs, Date.now())
      if (!result) return cur
      setLastTap(result.record)
      return result.corrections
    })
  }, [map, update])

  return {
    corrections,
    lastTap,
    tap,
    nudge: useCallback((chordIndex, dir) => update((c) => nudgeChord(c, map, chordIndex, dir)), [map, update]),
    bumpSection: useCallback((sectionIndex, deltaMs) => update((c) => shiftSection(c, map, sectionIndex, deltaMs)), [map, update]),
    bumpGlobal: useCallback((deltaMs) => update((c) => setGlobalOffset(c, c.globalOffsetMs + deltaMs)), [update]),
    resetSection: useCallback((sectionIndex) => update((c) => resetSectionPure(c, map, sectionIndex)), [map, update]),
    resetAll: useCallback(() => update((c) => resetTiming(c)), [update]),
  }
}
