import * as Tone from 'tone'

/**
 * The backing band: Rhodes-ish keys, round bass, brushy kit — all routed
 * through one backing bus whose gain the drill engine ducks during answer
 * windows (the band "drops out for your fill").
 */

export interface Band {
  keys: Tone.PolySynth
  bass: Tone.MonoSynth
  kick: Tone.MembraneSynth
  snare: Tone.NoiseSynth
  hat: Tone.NoiseSynth
  bus: Tone.Gain
}

let band: Band | null = null

export function getBand(): Band {
  if (band) return band
  const bus = new Tone.Gain(1).toDestination()

  const keys = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 1.4,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.01, decay: 1.4, sustain: 0.4, release: 1.1 },
    modulationEnvelope: { attack: 0.01, decay: 0.7, sustain: 0.2, release: 0.8 },
    volume: -16,
  }).connect(bus)

  const bass = new Tone.MonoSynth({
    oscillator: { type: 'triangle' },
    filter: { type: 'lowpass', Q: 1.2 },
    envelope: { attack: 0.008, decay: 0.3, sustain: 0.55, release: 0.4 },
    filterEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.35, release: 0.4, baseFrequency: 90, octaves: 2.2 },
    volume: -10,
  }).connect(bus)

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.04, octaves: 7,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0.01, release: 0.6 },
    volume: -10,
  }).connect(bus)

  const snareFilter = new Tone.Filter(2400, 'bandpass').connect(bus)
  const snare = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
    volume: -16,
  }).connect(snareFilter)

  const hatFilter = new Tone.Filter(9000, 'highpass').connect(bus)
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.045, sustain: 0 },
    volume: -22,
  }).connect(hatFilter)

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
