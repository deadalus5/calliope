import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResolvedTiming } from './songmap'

/**
 * Loop one section by watching the playhead and seeking back at the
 * boundary (Spotify has no native loop; the tiny seek gap is fine for
 * practice — the deck later does it sample-accurately). Bounds re-read from
 * the live corrections-resolved timing every tick, so a tap mid-loop
 * retargets the loop seamlessly. Navigating well outside the loop cancels
 * it rather than yanking playback back.
 */

const TICK_MS = 100
const WRAP_EPSILON_MS = 130
const POST_SEEK_GUARD_MS = 600
const ESCAPE_MARGIN_MS = 2000

export function shouldWrap(
  posMs: number,
  startMs: number,
  endMs: number,
  lastSeekAt: number,
  now: number,
): 'wrap' | 'cancel' | 'hold' {
  if (now - lastSeekAt < POST_SEEK_GUARD_MS) return 'hold'
  if (posMs < startMs - ESCAPE_MARGIN_MS || posMs > endMs + ESCAPE_MARGIN_MS) return 'cancel'
  if (posMs >= endMs - WRAP_EPSILON_MS) return 'wrap'
  return 'hold'
}

export function useSectionLoop(opts: {
  resolved: ResolvedTiming
  clockMs(): number
  seek(ms: number): void
  /** Fires on arm/disarm/cancel — the drill layer keys its generation on it. */
  onChange?(loopIndex: number | null): void
}): { loopIndex: number | null; toggle(sectionIndex: number): void } {
  const [loopIndex, setLoopIndex] = useState<number | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const lastSeekAtRef = useRef(0)

  const setAndNotify = useCallback((next: number | null) => {
    setLoopIndex((cur) => {
      if (cur !== next) optsRef.current.onChange?.(next)
      return next
    })
  }, [])

  useEffect(() => {
    if (loopIndex === null) return
    const timer = setInterval(() => {
      const sec = optsRef.current.resolved.sections[loopIndex]
      if (!sec) { setAndNotify(null); return }
      const decision = shouldWrap(
        optsRef.current.clockMs(), sec.startMs, sec.endMs, lastSeekAtRef.current, performance.now())
      if (decision === 'wrap') {
        lastSeekAtRef.current = performance.now()
        optsRef.current.seek(Math.max(0, sec.startMs))
      } else if (decision === 'cancel') {
        setAndNotify(null)
      }
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [loopIndex, setAndNotify])

  const toggle = useCallback((sectionIndex: number) => {
    setLoopIndex((cur) => {
      const next = cur === sectionIndex ? null : sectionIndex
      if (next !== null) {
        const sec = optsRef.current.resolved.sections[next]
        const pos = optsRef.current.clockMs()
        // Arm from outside the section: jump in (otherwise the escape
        // check would cancel the loop on its first tick).
        if (sec && (pos < sec.startMs || pos > sec.endMs)) {
          lastSeekAtRef.current = performance.now()
          optsRef.current.seek(Math.max(0, sec.startMs))
        }
      }
      if (cur !== next) optsRef.current.onChange?.(next)
      return next
    })
  }, [])

  return { loopIndex, toggle }
}
