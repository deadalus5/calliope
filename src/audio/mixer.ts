import * as Tone from 'tone'
import type { DrumVoice } from './drum-voice'

/**
 * The band's mix: per-instrument channels (EQ + compression where the
 * source needs it) feeding a shared reverb send and a `duck` gain that
 * `duckBacking`/`unduckBacking` ramp, all summed through a master
 * compressor + limiter before the one AudioContext's destination.
 * Replaces the old flat "instrument -> Volume -> one Gain -> destination"
 * routing. audition.ts/drone.ts stay outside this graph on purpose.
 */

export type MixChannelId = 'keys' | 'bass' | 'drums'

export interface Mixer {
  channel(id: MixChannelId): Tone.Channel
  /** Wire a DrumVoice.out through pan + reverb send into the drum bus. */
  connectDrumVoice(v: DrumVoice): void
  /** Band submix node that duckBacking ramps — pre-master, so ducking never touches the master chain. */
  duck: Tone.Gain
  /** Resolves when the reverb IR is generated. */
  ready: Promise<void>
  /** Current master peak in dBFS (Tone.Meter after the limiter). */
  peakDb(): number
}

let mixer: Mixer | null = null

export function getMixer(): Mixer {
  if (mixer) return mixer

  const duck = new Tone.Gain(1)

  // Master: duck -> compressor -> limiter -> destination, tapped by a meter.
  const masterComp = new Tone.Compressor({ ratio: 1.5, attack: 0.08, release: 0.4, threshold: -14 })
  const limiter = new Tone.Limiter(-1)
  const meter = new Tone.Meter({ smoothing: 0 })
  duck.chain(masterComp, limiter, Tone.getDestination())
  limiter.connect(meter)

  // Shared reverb bus: reverb -> lowpass (tames convolution hiss) -> trim -> duck.
  const reverb = new Tone.Reverb({ decay: 1.2, preDelay: 0.02, wet: 1 })
  const reverbFilter = new Tone.Filter(5000, 'lowpass')
  const reverbTrim = new Tone.Gain(Tone.dbToGain(-6))
  reverb.chain(reverbFilter, reverbTrim, duck)

  const keys = new Tone.Channel({ volume: -7, pan: -0.15 })
  const keysEq = new Tone.EQ3({ low: -10, lowFrequency: 120 })
  keys.chain(keysEq, duck)
  // Reverb tap: a plain Gain (not Channel.send/receive — simpler for a
  // single fixed bus, and consistent with the drum voice sends below).
  const keysReverbSend = new Tone.Gain(Tone.dbToGain(-16))
  keys.connect(keysReverbSend)
  keysReverbSend.connect(reverb)

  const bass = new Tone.Channel({ volume: -4 })
  const bassEq = new Tone.EQ3({ high: -6, highFrequency: 5000 })
  const bassComp = new Tone.Compressor({ ratio: 3, attack: 0.01, release: 0.12, threshold: -20 })
  bass.chain(bassEq, bassComp, duck)

  const drums = new Tone.Channel({ volume: 0 })
  const drumsComp = new Tone.Compressor({ ratio: 2, attack: 0.03, release: 0.15, threshold: -18 })
  drums.chain(drumsComp, duck)

  const channels: Record<MixChannelId, Tone.Channel> = { keys, bass, drums }

  function connectDrumVoice(v: DrumVoice): void {
    const panner = new Tone.Panner(v.spec.pan ?? 0)
    v.out.connect(panner)
    panner.connect(drums)
    if (v.spec.sendDb !== undefined) {
      const send = new Tone.Gain(Tone.dbToGain(v.spec.sendDb))
      v.out.connect(send)
      send.connect(reverb)
    }
  }

  function peakDb(): number {
    const value = meter.getValue()
    return Array.isArray(value) ? Math.max(...value) : value
  }

  mixer = {
    channel: (id) => channels[id],
    connectDrumVoice,
    duck,
    ready: reverb.ready,
    peakDb,
  }

  // Expose for E2E (Task 9 extends this).
  ;(globalThis as { __calliope?: Record<string, unknown> }).__calliope = {
    ...(globalThis as { __calliope?: Record<string, unknown> }).__calliope,
    peakDb,
  }

  return mixer
}
