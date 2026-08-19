import { audioNow } from './context'
import { duckBacking, unduckBacking } from './instruments'
import { sequencer, type ChordChangeEvent } from './sequencer'
import type { TimelineEvent } from '../music-core'

/**
 * The seam that lets drills score against ANY chord timeline — the Tone
 * band (sequencer) or a Song Map riding a real record. The surface is
 * exactly what the guide-tone drill touches; `audioTime` is always
 * AudioContext seconds at the audible moment, because mic locks arrive on
 * that clock and latency math must stay single-domain.
 */

export type TimelineSourceEvent = ChordChangeEvent

export interface TimelineSource {
  onChordChange(l: (e: TimelineSourceEvent) => void): () => void
  /** Form-space timeline; drills read [(index + 1) % length] for "next". */
  readonly events: TimelineEvent[]
  /** Identity of the loaded song/progression — staleness guard. */
  readonly sourceId: string | undefined
  /** BPM in CONTEXT time: a slowed deck reports its slowed tempo, so
   * beat-relative windows stay musically sized. */
  readonly tempo: number
  readonly playing: boolean
  readonly loopActive: boolean
  readonly generation: number
  duck(at: number): void
  unduck(at: number): void
}

/** The Song Lab band, wrapped. Every guard maps 1:1 onto the sequencer. */
export const sequencerTimelineSource: TimelineSource = {
  onChordChange: (l) => sequencer.onChordChange(l),
  get events() { return sequencer.events },
  get sourceId() { return sequencer.progression?.id },
  get tempo() { return sequencer.tempo },
  get playing() { return sequencer.playing },
  get loopActive() { return sequencer.loopActive },
  get generation() { return sequencer.generation },
  duck: (at) => duckBacking(at),
  unduck: (at) => unduckBacking(at),
}

/** Inert source for callers that must pass SOMETHING (hooks can't be
 * conditional): never plays, never emits. */
export const silentTimelineSource: TimelineSource = {
  onChordChange: () => () => {},
  events: [],
  sourceId: undefined,
  tempo: 120,
  playing: false,
  loopActive: false,
  generation: 0,
  duck: () => {},
  unduck: () => {},
}

export { audioNow }
