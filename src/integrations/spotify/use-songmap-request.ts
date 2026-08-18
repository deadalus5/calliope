import { useCallback, useEffect, useRef, useState } from 'react'
import { useSidecar } from './sidecar-store'
import type { SongMap } from './songmap'
import { saveSongMap } from './songmap-store'
import {
  pickVersion, reanalyze, requestSongMap,
  type SongmapStatus, type TrackParams,
} from './songsmith-client'

/**
 * The songmap request loop, with an explicit polling policy instead of a
 * bare setInterval: `working` keeps the 2s cadence; `pick` and `error` STOP
 * (the sidecar remembers both durably, so hammering it re-reads the same
 * answer — a pick or retry is the only way forward); `offline` backs off
 * 5s → 10s → 30s under a visible banner; `ready` saves to Dexie and stops.
 * Subscribing to the sidecar store's URL is what makes configuring songsmith
 * mid-session take effect immediately (the old inline effect read
 * localStorage but never re-ran).
 */

export function nextPollDelay(status: SongmapStatus['status'], offlinePolls: number): number | null {
  switch (status) {
    case 'working': return 2000
    case 'offline': return [5000, 10_000, 30_000][Math.min(2, offlinePolls)]
    default: return null // ready | pick | error — stable until someone acts
  }
}

export function useSongmapRequest(opts: {
  /** Memoized by the caller — a fresh object every render restarts the loop. */
  params: TrackParams | null
  haveMap: boolean
  manualMode: boolean
  onReady(map: SongMap): void
}): {
  fetchState: SongmapStatus | null
  /** After error/offline: clear the durable error server-side and resume. */
  retry(): void
  pickTab(tabId: number): Promise<void>
  pickUrl(url: string): Promise<void>
} {
  const { params, haveMap, manualMode } = opts
  const url = useSidecar((s) => s.url)
  const [fetchState, setFetchState] = useState<SongmapStatus | null>(null)
  const [epoch, setEpoch] = useState(0)
  const onReadyRef = useRef(opts.onReady)
  onReadyRef.current = opts.onReady
  const lastStateRef = useRef<SongmapStatus | null>(null)

  useEffect(() => {
    setFetchState(null)
    lastStateRef.current = null
    if (!params || params.durationMs <= 0 || haveMap || manualMode || !url) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let offlinePolls = 0
    const poll = async () => {
      const status = await requestSongMap(params)
      if (!alive) return
      lastStateRef.current = status
      setFetchState(status)
      if (status.status === 'ready') {
        await saveSongMap(status.songmap)
        if (alive) onReadyRef.current(status.songmap)
        return
      }
      const delay = nextPollDelay(status.status, status.status === 'offline' ? offlinePolls++ : (offlinePolls = 0))
      if (delay !== null) timer = setTimeout(() => void poll(), delay)
    }
    void poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [params, haveMap, manualMode, url, epoch])

  const retry = useCallback(() => {
    void (async () => {
      if (params && lastStateRef.current?.status === 'error') {
        // The sidecar's error is durable by design; 'retry' clears it and
        // re-runs the pipeline, which skips every cached stage.
        setFetchState(await reanalyze(params, 'retry'))
      }
      void useSidecar.getState().probe()
      setEpoch((e) => e + 1)
    })()
  }, [params])

  const pickTab = useCallback(async (tabId: number) => {
    if (!params) return
    setFetchState(await pickVersion(params.trackUri, { tabId }))
    setEpoch((e) => e + 1)
  }, [params])

  const pickUrl = useCallback(async (youtubeUrl: string) => {
    if (!params) return
    setFetchState(await pickVersion(params.trackUri, { youtubeUrl }))
    setEpoch((e) => e + 1)
  }, [params])

  return { fetchState, retry, pickTab, pickUrl }
}
