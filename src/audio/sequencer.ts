import * as Tone from 'tone'
import {
  buildTimeline, chordBass, chordPcs, midiToFreq, normalizePc, totalBars,
  type Chord, type PitchClass, type Progression, type TimelineEvent,
} from '../music-core'
import { getBand } from './instruments'

/**
 * SequencerEngine: one Tone.Transport wrapper that turns a Progression into
 * a playing band plus a stream of chord-change events. Events are scheduled
 * in bars:beats (tempo-independent) and re-emitted to the UI via Tone.Draw
 * at the audible moment. Transposing regenerates the timeline from
 * music-core — audio is never pitch-shifted.
 */

export interface ChordChangeEvent {
  event: TimelineEvent
  index: number
  /** Audio-clock time the chord sounds — drills score against this. */
  audioTime: number
}

type ChordListener = (e: ChordChangeEvent) => void
type BeatListener = (bar: number, beat: number, audioTime: number) => void

/** Voice a chord for keys: close position around C4, bass note separate. */
function keysVoicing(chord: Chord): number[] {
  const pcs = chordPcs(chord)
  const midis: number[] = []
  let prev = 57 // start hunting above A3
  for (const pc of pcs.slice(0, 5)) {
    let m = prev + normalizePc(pc - prev)
    if (m - prev === 0) m += 12
    midis.push(m)
    prev = m
  }
  return midis
}

function bassMidi(chord: Chord): number {
  // C2..B2 register
  return 36 + normalizePc(chordBass(chord))
}

export class SequencerEngine {
  private part: Tone.Part<TimelineEvent & { index: number; time: string }> | null = null
  private drumSeq: Tone.Sequence | null = null
  private chordListeners = new Set<ChordListener>()
  private beatListeners = new Set<BeatListener>()
  private timeline: TimelineEvent[] = []
  progression: Progression | null = null
  key: PitchClass = 0
  bars = 0

  load(progression: Progression, key: PitchClass, tempo?: number): void {
    this.dispose()
    this.progression = progression
    this.key = key
    this.timeline = buildTimeline(progression, key)
    this.bars = totalBars(progression)
    const t = Tone.getTransport()
    t.timeSignature = progression.timeSignature[0]
    t.bpm.value = tempo ?? progression.defaultTempo
    t.swing = progression.feel === 'shuffle' ? 0.5 : 0
    t.swingSubdivision = '8n'
    t.loop = true
    t.setLoopPoints('0:0:0', `${this.bars}:0:0`)

    const band = getBand()
    this.part = new Tone.Part(
      (time, ev) => {
        // keys: sustained voicing, restruck mid-duration for long chords
        const voicing = keysVoicing(ev.chord).map(midiToFreq)
        const durBeats = ev.durationBeats
        const beatSec = 60 / t.bpm.value
        band.keys.triggerAttackRelease(voicing, durBeats * beatSec * 0.92, time, 0.65)
        // bass: root on the change, fifth halfway through if there's room
        const root = bassMidi(ev.chord)
        band.bass.triggerAttackRelease(midiToFreq(root), beatSec * 0.85, time, 0.9)
        if (durBeats >= 4) {
          band.bass.triggerAttackRelease(midiToFreq(root), beatSec * 0.4, time + 2 * beatSec, 0.7)
          band.bass.triggerAttackRelease(midiToFreq(root + 7), beatSec * 0.8, time + 3 * beatSec, 0.8)
        }
        Tone.getDraw().schedule(() => {
          const e: ChordChangeEvent = { event: ev, index: ev.index, audioTime: time }
          for (const l of this.chordListeners) l(e)
        }, time)
      },
      this.timeline.map((ev, index) => ({ ...ev, index, time: `${ev.bar}:${ev.beat}:0` })),
    ).start(0)

    // drums: kick 1 & 3, snare 2 & 4, hats on 8ths (swing handles shuffle)
    this.drumSeq = new Tone.Sequence(
      (time, inBar: number) => {
        if (inBar === 0 || inBar === 4) band.kick.triggerAttackRelease('C1', '8n', time, 0.9)
        if (inBar === 2 || inBar === 6) band.snare.triggerAttackRelease('16n', time, 0.55)
        band.hat.triggerAttackRelease('32n', time, inBar % 2 === 0 ? 0.5 : 0.28)
        if (inBar % 2 === 0) {
          Tone.getDraw().schedule(() => {
            // read position at the audible moment (loop-safe)
            const [bar, beat] = String(Tone.getTransport().position).split(':').map(Number)
            for (const l of this.beatListeners) l(bar, beat, time)
          }, time)
        }
      },
      Array.from({ length: 8 }, (_, i) => i),
      '8n',
    ).start(0)
  }

  play(): void { Tone.getTransport().start() }
  pause(): void { Tone.getTransport().pause() }

  stop(): void {
    const t = Tone.getTransport()
    t.stop()
    t.position = 0
  }

  get playing(): boolean { return Tone.getTransport().state === 'started' }

  setTempo(bpm: number): void { Tone.getTransport().bpm.value = bpm }
  get tempo(): number { return Math.round(Tone.getTransport().bpm.value) }

  setLoop(startBar: number, endBar: number): void {
    Tone.getTransport().setLoopPoints(`${startBar}:0:0`, `${endBar}:0:0`)
  }

  /** Current timeline (for chart rendering). */
  get events(): TimelineEvent[] { return this.timeline }

  onChordChange(l: ChordListener): () => void {
    this.chordListeners.add(l)
    return () => this.chordListeners.delete(l)
  }

  onBeat(l: BeatListener): () => void {
    this.beatListeners.add(l)
    return () => this.beatListeners.delete(l)
  }

  dispose(): void {
    this.stop()
    this.part?.dispose()
    this.drumSeq?.dispose()
    this.part = null
    this.drumSeq = null
  }
}

export const sequencer = new SequencerEngine()
