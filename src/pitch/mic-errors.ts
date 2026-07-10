import { MicDisabledError } from './pitch-engine'
import { showToast } from '../state/toasts'
import { useAppPrefs } from '../state/app-prefs'

/**
 * One consistent failure surface for every mic catch-site in the app
 * (Ear Gym, Modal Colors' hunt, Sing). Lives under pitch/ rather than the
 * app layer: pitch-engine.ts already imports state/app-prefs (Task 10) to
 * gate startPitchEngine(), so pitch/ importing state/toasts here follows
 * the same precedent rather than establishing a new layering exception.
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
