import * as Tone from 'tone'
import { DrumHit, createBass, createPiano } from '../samples'

/**
 * The backing band, sampled: real piano, real bass, real kit — all routed
 * through one backing bus whose gain the drill engine ducks during answer
 * windows (the band "drops out for your fill").
 */

export interface Band {
  keys: Tone.Sampler
  bass: Tone.Sampler
  kick: DrumHit
  snare: DrumHit
  hat: DrumHit
  bus: Tone.Gain
}

let band: Band | null = null

export function getBand(): Band {
  if (band) return band
  const bus = new Tone.Gain(1).toDestination()

  const keys = createPiano().connect(new Tone.Volume(-9).connect(bus))
  const bass = createBass().connect(new Tone.Volume(-4).connect(bus))

  const kick = new DrumHit('kick.mp3')
  kick.out.connect(new Tone.Volume(-6).connect(bus))
  const snare = new DrumHit('snare.mp3')
  snare.out.connect(new Tone.Volume(-10).connect(bus))
  const hat = new DrumHit('hihat.mp3')
  hat.out.connect(new Tone.Volume(-14).connect(bus))

  band = { keys, bass, kick, snare, hat, bus }
  return band
}

const DUCK_DB = -18

/** Duck the band under an answer window (or fully for singing drills). */
export function duckBacking(at: number, full = false): void {
  const bus = getBand().bus
  bus.gain.cancelScheduledValues(at)
  bus.gain.rampTo(full ? 0.0001 : Tone.dbToGain(DUCK_DB), 0.12, at)
}

export function unduckBacking(at: number): void {
  const bus = getBand().bus
  bus.gain.cancelScheduledValues(at)
  bus.gain.rampTo(1, 0.25, at)
}
