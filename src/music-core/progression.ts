import { normalizePc, type PitchClass } from './note'
import { chordSymbol, parseChordSymbol, type Chord } from './chord'

/**
 * Progressions are authored as chord symbols with beat durations in a
 * concrete default key, then transposed by re-spelling (never by shifting
 * audio). The sequencer consumes the flattened TimelineEvent list.
 */

export interface ProgressionStep {
  symbol: string
  beats: number
}

export interface ScaleHint {
  modeId: string // matches ModeSpec.id
  /** Root of the scale to visualize, as a degree offset from the song key. */
  rootOffset: number
}

export interface Progression {
  id: string
  name: string
  artistHint?: string // "in the style of ..."
  defaultKey: PitchClass // roots below are relative to authored key
  defaultTempo: number
  timeSignature: [number, number]
  steps: ProgressionStep[]
  /** What to paint on the fretboard while this plays. */
  scaleHint: ScaleHint
  feel: 'straight' | 'shuffle'
  description: string
}

export interface TimelineEvent {
  bar: number // 0-based
  beat: number // 0-based within bar
  chord: Chord
  symbol: string
  durationBeats: number
}

export function buildTimeline(p: Progression, key: PitchClass): TimelineEvent[] {
  const delta = normalizePc(key - p.defaultKey)
  const beatsPerBar = p.timeSignature[0]
  const events: TimelineEvent[] = []
  let absBeat = 0
  for (const step of p.steps) {
    const authored = parseChordSymbol(step.symbol)
    const chord: Chord = {
      root: normalizePc(authored.root + delta),
      quality: authored.quality,
      ...(authored.bass !== undefined ? { bass: normalizePc(authored.bass + delta) } : {}),
    }
    events.push({
      bar: Math.floor(absBeat / beatsPerBar),
      beat: absBeat % beatsPerBar,
      chord,
      symbol: chordSymbol(chord, key),
      durationBeats: step.beats,
    })
    absBeat += step.beats
  }
  return events
}

export function totalBars(p: Progression): number {
  const beats = p.steps.reduce((sum, s) => sum + s.beats, 0)
  return Math.ceil(beats / p.timeSignature[0])
}
