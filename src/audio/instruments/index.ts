import * as Tone from 'tone'
import { createBass, createPiano } from '../samples'
import { getMixer } from '../mixer'
import { loadKit, type DrumKit } from '../drum-voice'

/**
 * The backing band, sampled: real piano, real bass, and the multisampled
 * Salamander kit (Task 2's DrumVoice/DrumKit), each routed through its own
 * mixer channel (src/audio/mixer.ts) into a shared `duck` gain that the
 * drill engine ramps during answer windows (the band "drops out for your
 * fill"). The kit loads asynchronously; `drums.trigger` drops hits silently
 * until it lands, matching the drop-silently contract used everywhere else
 * pre-load.
 */

export interface DrumTrigger {
  trigger(time: number, velocity?: number): void
}

export interface Band {
  keys: Tone.Sampler
  bass: Tone.Sampler
  /** Facade over the async-loaded DrumKit: drops hits silently until loaded. */
  drums: { trigger(articulation: string, time: number, velocity?: number): void }
  kick: DrumTrigger // back-compat shims → drums.trigger('kick'|'snare'|'hat-closed', ...)
  snare: DrumTrigger //   TriadPractice.tsx keeps working with zero changes
  hat: DrumTrigger
  bus: Tone.Gain // = mixer.duck — duckBacking contract preserved
}

let band: Band | null = null
let kitPromise: Promise<DrumKit> | null = null

export function getBand(): Band {
  if (band) return band
  const mixer = getMixer()

  const keys = createPiano().connect(mixer.channel('keys'))
  const bass = createBass().connect(mixer.channel('bass'))

  let kit: DrumKit | null = null
  const drums = {
    trigger(articulation: string, time: number, velocity = 1): void {
      kit?.trigger(articulation, time, velocity)
    },
  }

  kitPromise = loadKit('salamander')
  kitPromise.then((loaded) => {
    kit = loaded
    for (const [, voice] of loaded.voices()) mixer.connectDrumVoice(voice)
  })

  band = {
    keys,
    bass,
    drums,
    kick: { trigger: (time, velocity) => drums.trigger('kick', time, velocity) },
    snare: { trigger: (time, velocity) => drums.trigger('snare', time, velocity) },
    hat: { trigger: (time, velocity) => drums.trigger('hat-closed', time, velocity) },
    bus: mixer.duck,
  }
  return band
}

/** Resolves once the kit has loaded and the reverb IR is generated. */
export function bandReady(): Promise<void> {
  getBand()
  return Promise.all([kitPromise, getMixer().ready]).then(() => undefined)
}

const DUCK_DB = -18

/** Duck the band under an answer window (or fully for singing drills). */
export function duckBacking(at: number, full = false): void {
  getBand()
  const gain = getMixer().duck.gain
  gain.cancelScheduledValues(at)
  gain.rampTo(full ? 0.0001 : Tone.dbToGain(DUCK_DB), 0.12, at)
}

export function unduckBacking(at: number): void {
  getBand()
  const gain = getMixer().duck.gain
  gain.cancelScheduledValues(at)
  gain.rampTo(1, 0.25, at)
}
