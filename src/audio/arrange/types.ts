/**
 * Shared shapes for the arrangement layer. Pure data — no Tone, no DOM.
 * The sequencer (Task 8) turns these into scheduled Tone events.
 */

export interface NoteSpec {
  atBeat: number // absolute float beats from form start
  midis: number[]
  durBeats: number
  vel: number
  ghost?: boolean
  anticipation?: boolean
}

export interface DrumSpec {
  atBeat: number
  art: string
  vel: number
  fill?: boolean
}

export type PocketVoice = 'hat' | 'snare' | 'kick' | 'bass' | 'keys'

export interface GrooveSpec {
  id: string
  pocket: Record<PocketVoice, number> // constant per-voice offset, seconds (±0.006 range)
  hatVel: number[] // accent map, one entry per 8th-note slot
  ridePhase?: boolean // switch hat->ride every 8 bars
  halftime?: boolean // backbeat on 3 instead of 2&4
  fillEveryBars: number
  ornaments: { ghostSnareP: number; openHatP: number; kickAndP: number }
}

export type BassStyle = 'walking' | 'boogie' | 'rootFive' | 'pedal'
export type CompStyle = 'charleston' | 'soul-pads' | 'neosoul' | 'strum' | 'vamp' | 'pop'
