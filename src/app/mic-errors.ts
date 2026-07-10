import { MicDisabledError } from '../pitch/pitch-engine'
import { showToast } from '../state/toasts'
import { useAppPrefs } from '../state/app-prefs'

/**
 * One consistent failure surface for every mic catch-site in the app
 * (Ear Gym, Modal Colors' hunt, Sing). Lives at the app layer: it wires
 * pitch/ errors to state/ (toasts + prefs), a combination only app-layer
 * code is allowed to know about (pitch/ imports only music-core).
 */
export function reportMicFailure(err: unknown): void {
  if (err instanceof MicDisabledError) {
    showToast({
      message: 'Mic is off (no-mic mode). Flip it back on in the board options to use this.',
    })
    return
  }
  showToast({
    message: "Couldn't open the microphone — check browser permissions.",
    action: { label: 'Go no-mic', run: () => useAppPrefs.getState().setMicMode('off') },
  })
}
