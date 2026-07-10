import * as Tone from 'tone'
import { reportLoadError } from './load-errors'

/**
 * Sampled instruments, served from public/samples (downloaded once, offline
 * after that). Sampler keys use note names ("D#4"); files use "Ds4.mp3".
 * Piano: Salamander. Guitar/bass: tonejs-instruments (CC). Drums: see
 * src/audio/drum-voice.ts (multisampled Salamander kit).
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
  return new Tone.Sampler({
    urls: urls(PIANO_NOTES),
    baseUrl: '/samples/piano/',
    release: 1.2,
    onerror: () => reportLoadError('piano'),
  })
}

export function createGuitar(): Tone.Sampler {
  return new Tone.Sampler({
    urls: urls(GUITAR_NOTES),
    baseUrl: '/samples/guitar/',
    release: 0.8,
    onerror: () => reportLoadError('guitar'),
  })
}

export function createBass(): Tone.Sampler {
  return new Tone.Sampler({
    urls: urls(BASS_NOTES),
    baseUrl: '/samples/bass/',
    release: 0.4,
    onerror: () => reportLoadError('bass'),
  })
}

/** Resolves when every sample buffer is decoded. */
export function samplesLoaded(): Promise<void> {
  return Tone.loaded()
}
