import { onPitchFrame } from './pitch-engine'
import { noteTracker } from './note-tracker'

/**
 * Sample ambient RMS for a moment (user silent, backing may be playing)
 * and set the tracker's noise floor above it.
 */
export function calibrateNoiseFloor(seconds = 1): Promise<number> {
  return new Promise((resolve) => {
    const samples: number[] = []
    const unsub = onPitchFrame((f) => samples.push(f.rms))
    setTimeout(() => {
      unsub()
      samples.sort((a, b) => a - b)
      // 90th percentile: robust to a stray bump during calibration. Capped —
      // if he was playing when the mic started, don't poison the floor.
      const p90 = samples[Math.floor(samples.length * 0.9)] ?? 0.005
      noteTracker.noiseFloor = Math.min(0.03, Math.max(0.003, p90))
      resolve(noteTracker.noiseFloor)
    }, seconds * 1000)
  })
}
