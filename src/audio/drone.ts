import * as Tone from 'tone'
import { midiToFreq, type PitchClass } from '../music-core'

/**
 * A soft root-and-fifth pad that establishes the key for singing work.
 * Degrees only mean something against a sounding root.
 */

let synth: Tone.PolySynth | null = null
let playing: PitchClass | null = null

function ensure() {
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine4' },
      envelope: { attack: 1.2, decay: 0.5, sustain: 0.8, release: 2.5 },
      volume: -20,
    }).toDestination()
  }
}

export function startDrone(root: PitchClass): void {
  ensure()
  stopDrone()
  const rootMidi = 36 + ((root - 0 + 12) % 12) // C2..B2 register
  synth!.triggerAttack([midiToFreq(rootMidi), midiToFreq(rootMidi + 7), midiToFreq(rootMidi + 12)])
  playing = root
}

export function stopDrone(): void {
  if (playing !== null) {
    synth?.releaseAll()
    playing = null
  }
}

export function droneRoot(): PitchClass | null {
  return playing
}
