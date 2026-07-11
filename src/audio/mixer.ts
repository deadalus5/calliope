import * as Tone from 'tone'
import type { DrumVoice } from './drum-voice'
import { exposeDebug } from './debug'

/**
 * The band's mix: per-instrument channels (EQ + compression where the
 * source needs it) feeding a shared reverb send and a `duck` gain that
 * `duckBacking`/`unduckBacking` ramp, all summed through a master
 * compressor + limiter before the one AudioContext's destination.
 * Replaces the old flat "instrument -> Volume -> one Gain -> destination"
 * routing. audition.ts/drone.ts stay outside this graph on purpose.
 */

export type MixChannelId = 'keys' | 'bass' | 'drums'

/** Base channel volumes (dB) each style's `trims` are added on top of. */
export const BASE_CHANNEL_DB: Record<MixChannelId, number> = { keys: -7, bass: -4, drums: 0 }

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
  /** Set each channel's volume to its BASE_CHANNEL_DB + (trims[id] ?? 0) + userGain(id). */
  applyTrims(trims?: Partial<Record<MixChannelId, number>>): void
  /** Practice-mode user trim (clamped [-24, +6] dB), on top of BASE + style trim. Survives applyTrims. */
  setUserGain(id: MixChannelId, db: number): void
  userGain(id: MixChannelId): number
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

  // Lazy recorder for E2E/human-listening bounces — never created unless a
  // script actually calls startRecording(), so it's a no-op in normal use.
  let recorder: Tone.Recorder | null = null
  function ensureRecorder(): Tone.Recorder {
    if (!recorder) {
      recorder = new Tone.Recorder()
      limiter.connect(recorder)
    }
    return recorder
  }
  function startRecording(): void {
    ensureRecorder().start()
  }
  async function stopRecording(): Promise<string> {
    const blob = await ensureRecorder().stop()
    const buf = await blob.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }

  // Practice-mode user trims (Task 12): a third layer on top of BASE +
  // style trim, set from MixerStrip and never touched by applyTrims —
  // recompose() is the one place all three layers combine.
  const userGains: Record<MixChannelId, number> = { keys: 0, bass: 0, drums: 0 }
  let currentTrims: Partial<Record<MixChannelId, number>> = {}

  function recompose(id: MixChannelId): void {
    // Tone.Channel/Volume derives `mute` from `volume.value === -Infinity`
    // (see Tone's Volume component) — writing volume.value directly while
    // muted silently un-mutes the channel even though React's MixerStrip
    // state still shows M active. Capture the mute flag first and
    // re-assert it after recomposing so a muted channel stays muted (and
    // Tone's internal `_unmutedVolume` picks up the freshly composed value,
    // so a later unmute restores to the right level, not a stale one).
    const ch = channels[id]
    const wasMuted = ch.mute
    ch.volume.value = BASE_CHANNEL_DB[id] + (currentTrims[id] ?? 0) + userGains[id]
    if (wasMuted) ch.mute = true
  }

  function applyTrims(trims?: Partial<Record<MixChannelId, number>>): void {
    currentTrims = trims ?? {}
    for (const id of Object.keys(channels) as MixChannelId[]) recompose(id)
  }

  function setUserGain(id: MixChannelId, db: number): void {
    userGains[id] = Math.min(6, Math.max(-24, db))
    recompose(id)
  }

  function userGain(id: MixChannelId): number {
    return userGains[id]
  }

  mixer = {
    channel: (id) => channels[id],
    connectDrumVoice,
    duck,
    ready: reverb.ready,
    peakDb,
    applyTrims,
    setUserGain,
    userGain,
  }

  // Expose for E2E.
  exposeDebug({ peakDb, startRecording, stopRecording })

  return mixer
}
