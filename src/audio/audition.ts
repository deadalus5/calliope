import * as Tone from 'tone'
import { midiToFreq } from '../music-core'
import { createGuitar } from './samples'

/**
 * Click-a-note playback on a sampled acoustic guitar. A Sampler allocates a
 * fresh buffer voice per trigger, so repeated clicks never re-tune a ringing
 * voice (the old PluckSynth double-note artifact).
 */

let guitar: Tone.Sampler | null = null

function ensureGuitar(): Tone.Sampler {
  if (!guitar) {
    guitar = createGuitar().connect(new Tone.Volume(-4).toDestination())
  }
  return guitar
}

/** Warm the sample buffers early (call behind the start gesture). */
export function warmAudition(): void {
  ensureGuitar()
}

export function playMidi(midi: number): void {
  ensureGuitar().triggerAttackRelease(midiToFreq(midi), 2.2, Tone.now(), 0.9)
}

/** Strum a set of midi notes low→high with a slight roll, like a hand would. */
export function playChord(midis: number[], rollMs = 28): void {
  playChordAt(midis, Tone.now(), rollMs)
}

/** Schedulable strum (audio-clock time) for transport-driven practice. */
export function playChordAt(midis: number[], time: number, rollMs = 28): void {
  const g = ensureGuitar()
  ;[...midis].sort((a, b) => a - b).forEach((m, i) => {
    g.triggerAttackRelease(midiToFreq(m), 2.8, time + (i * rollMs) / 1000, 0.8)
  })
}

/** Sound a melodic fragment, sequentially. */
export function playMelody(midis: number[], gapMs = 350): void {
  const g = ensureGuitar()
  const now = Tone.now()
  midis.forEach((m, i) => {
    g.triggerAttackRelease(midiToFreq(m), 1.4, now + (i * gapMs) / 1000, 0.85)
  })
}
