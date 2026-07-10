import { useEffect, useRef } from 'react'

/**
 * Hold a screen wake lock while `active` is true — the app lives on a music
 * stand, and the screen must not sleep mid-song. Re-acquires on
 * visibilitychange (the OS silently releases the lock when the tab is
 * hidden, e.g. the user glances at another app and back); releases on
 * deactivate/unmount. Feature-detected: silently a no-op on browsers
 * without navigator.wakeLock (wake lock denial is not worth a toast).
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let cancelled = false
    let requesting = false

    async function acquire() {
      if (!active || document.visibilityState !== 'visible') return
      // Guard double-acquire: a second request while one is in flight (or
      // while we already hold a live sentinel) would overwrite the ref and
      // orphan the first lock, never to be released.
      if (requesting || sentinelRef.current) return
      requesting = true
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          // active flipped false (or we unmounted) while the request was in flight
          void sentinel.release()
          return
        }
        // The OS auto-releases the lock when the tab hides; clear the ref
        // then, so the visibilitychange re-acquire isn't blocked by a dead
        // sentinel.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null
        })
        sentinelRef.current = sentinel
      } catch (err) {
        // Denial is routine (battery saver, unsupported context) — not an error.
        console.debug('[wake-lock] request failed', err)
      } finally {
        requesting = false
      }
    }

    async function release() {
      const sentinel = sentinelRef.current
      sentinelRef.current = null
      if (sentinel) {
        try {
          await sentinel.release()
        } catch (err) {
          console.debug('[wake-lock] release failed', err)
        }
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void acquire()
    }

    if (active) void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void release()
    }
  }, [active])
}
