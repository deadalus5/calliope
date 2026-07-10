import * as Tone from 'tone'

/**
 * Sampled instruments, served from public/samples (downloaded once, offline
 * after that). Sampler keys use note names ("D#4"); files use "Ds4.mp3".
 * Piano: Salamander. Guitar/bass: tonejs-instruments (CC). Drums: Tone.js Kit8.
 */

function urls(names: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of names) out[n.replace('s', '#')] = `${n}.mp3`
  return out
}

const PIANO_NOTES = ['A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5']
const GUITAR_NOTES = ['E2', 'G2', 'A2', 'C3', 'E3', 'G3', 'A3', 'C4', 'E4', 'G4', 'A4', 'C5']
const BASS_NOTES = ['E1', 'G1', 'As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3']

export function createPiano(): Tone.Sampler {
  return new Tone.Sampler({ urls: urls(PIANO_NOTES), baseUrl: '/samples/piano/', release: 1.2 })
}

export function createGuitar(): Tone.Sampler {
  return new Tone.Sampler({ urls: urls(GUITAR_NOTES), baseUrl: '/samples/guitar/', release: 0.8 })
}

export function createBass(): Tone.Sampler {
  return new Tone.Sampler({ urls: urls(BASS_NOTES), baseUrl: '/samples/bass/', release: 0.4 })
}

/** One drum hit: a Player behind its own gain so velocity is schedulable. */
export class DrumHit {
  readonly out: Tone.Gain
  private player: Tone.Player

  constructor(file: string) {
    this.out = new Tone.Gain(1)
    this.player = new Tone.Player({ url: `/samples/drums/${file}` }).connect(this.out)
  }

  trigger(time: number, velocity = 1): void {
    this.out.gain.setValueAtTime(velocity, time)
    this.player.start(time)
  }
}

/** Resolves when every sample buffer is decoded. */
export function samplesLoaded(): Promise<void> {
  return Tone.loaded()
}
