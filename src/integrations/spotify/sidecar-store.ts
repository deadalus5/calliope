import { create } from 'zustand'
import { showToast } from '../../state/toasts'
import { getSongsmithUrl, setSongsmithUrl, sidecarHealth, type SidecarHealth } from './songsmith-client'

/**
 * The one source of truth for "is songsmith there?". localStorage
 * ('spotify:songsmithUrl') only seeds the initial state — components
 * subscribe to this store, so saving a URL mid-session re-fires the
 * songmap-request effect immediately (the old code read localStorage inside
 * an effect that never re-ran, which made the settings panel inert until the
 * next track change). Also owns auto-discovery: on the dev origin the
 * sidecar is probed at its default port so a locally-running songsmith is
 * adopted without the user ever finding the gear button.
 */

export type SidecarStatus = 'unknown' | 'checking' | 'ok' | 'offline'

const LOCAL_SIDECAR = 'http://127.0.0.1:8765'
const PROBE_TIMEOUT_MS = 1500

interface SidecarState {
  url: string | null
  status: SidecarStatus
  health: SidecarHealth | null
  setUrl(url: string): void
  probe(): Promise<void>
  /** No URL configured + running on the loopback origin: try the default port. */
  autoDiscover(): Promise<void>
}

export const useSidecar = create<SidecarState>((set, get) => ({
  url: getSongsmithUrl(),
  status: 'unknown',
  health: null,

  setUrl(url: string) {
    setSongsmithUrl(url)
    set({ url: getSongsmithUrl(), status: 'unknown', health: null })
    void get().probe()
  },

  async probe() {
    if (!get().url) {
      set({ status: 'unknown', health: null })
      return
    }
    set({ status: 'checking' })
    const health = await sidecarHealth({ signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    set({ status: health ? 'ok' : 'offline', health })
  },

  async autoDiscover() {
    if (get().url) {
      void get().probe()
      return
    }
    if (window.location.hostname !== '127.0.0.1') return
    const health = await sidecarHealth({
      base: LOCAL_SIDECAR,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (health) {
      setSongsmithUrl(LOCAL_SIDECAR)
      set({ url: getSongsmithUrl(), status: 'ok', health })
      showToast({ message: 'songsmith found on this Mac — auto-chords are on' })
    }
  },
}))
