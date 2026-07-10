import * as Tone from 'tone'
import { midiToFreq } from '../music-core'

/**
 * Click-a-note playback. A small round-robin pool of plucked voices gives a
 * guitar-ish response without the cost of allocating a synth per click, plus
 * a poly synth for sounding whole chords (builders, atlas demos).
 */

const POOL_SIZE = 4

let pool: Tone.PluckSynth[] | null = null
let poolIdx = 0
let chordSynth: Tone.PolySynth | null = null

function ensureSynths() {
  if (!pool) {
    const out = new Tone.Volume(-6).toDestination()
    pool = Array.from({ length: POOL_SIZE }, () =>
      new Tone.PluckSynth({ attackNoise: 0.8, dampening: 3200, resonance: 0.96 }).connect(out),
    )
    chordSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle8' },
      envelope: { attack: 0.005, decay: 0.35, sustain: 0.25, release: 1.2 },
      volume: -14,
    }).connect(out)
  }
}

export function playMidi(midi: number): void {
  ensureSynths()
  const voice = pool![poolIdx++ % POOL_SIZE]
  voice.triggerAttack(midiToFreq(midi), Tone.now())
}

/** Strum a set of midi notes low→high with a slight roll, like a hand would. */
export function playChord(midis: number[], rollMs = 28): void {
  ensureSynths()
  const now = Tone.now()
  ;[...midis].sort((a, b) => a - b).forEach((m, i) => {
    chordSynth!.triggerAttackRelease(midiToFreq(m), 1.6, now + (i * rollMs) / 1000, 0.8)
  })
}

/** Sound a bare interval or melodic fragment, sequentially. */
export function playMelody(midis: number[], gapMs = 350): void {
  ensureSynths()
  const now = Tone.now()
  midis.forEach((m, i) => {
    const voice = pool![poolIdx++ % POOL_SIZE]
    voice.triggerAttack(midiToFreq(m), now + (i * gapMs) / 1000)
  })
}
