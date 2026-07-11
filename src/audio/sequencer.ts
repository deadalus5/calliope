import * as Tone from 'tone'
import {
  buildTimeline, midiToFreq, totalBars,
  type PitchClass, type Progression, type TimelineEvent,
} from '../music-core'
import { getBand } from './instruments'
import { getMixer } from './mixer'
import { audioNow } from './context'
import { exposeDebug } from './debug'
import { styleFor } from './styles'
import { arrangeBass } from './arrange/bass'
import { arrangeKeys } from './arrange/keys'
import { arrangeDrums } from './arrange/drums'
import { gaussian, hashSeed, mulberry32 } from './arrange/rng'
import { beatToTime } from './arrange/time'
import type { DrumSpec, NoteSpec } from './arrange/types'

/**
 * SequencerEngine: one Tone.Transport wrapper that turns a Progression into
 * a playing band plus a stream of chord-change events.
 *
 * The band's arrangement now comes from the pure arrange/ layer
 * (bass.ts/keys.ts/drums.ts) driven by each song's `StyleSpec`
 * (src/audio/styles.ts) — style picks the bass approach, comping pattern,
 * groove/pocket and swing, replacing the old single-feel-ternary arranger.
 * `load()` bakes PASSES (4) independent passes of the arrangement up front,
 * one seeded RNG per voice per pass (`mulberry32(hashSeed(progression.id,
 * pass, voice))`), so the loop plays ~4x the form length before any
 * pattern repeats, then loops the whole baked block. Every voice also gets
 * a small constant "pocket" timing offset (style.groove.pocket) plus live
 * Gaussian jitter per note, for a less quantized feel.
 *
 * Events are scheduled in bars:beats:sixteenths (tempo-independent, via
 * beatToTime) and the chord/beat streams are re-emitted to the UI via
 * Tone.Draw at the audible moment, always in FORM space (single-pass
 * index/bar) regardless of which of the 4 baked passes is currently
 * sounding — see the Hard UI contracts in task-8-brief.md. Transposing
 * regenerates the timeline from music-core — audio is never pitch-shifted.
 */

const PASSES = 4

export interface ChordChangeEvent {
  event: TimelineEvent
  index: number
  /** Audio-clock time the chord sounds — drills score against this. */
  audioTime: number
}

type ChordListener = (e: ChordChangeEvent) => void
type BeatListener = (bar: number, beat: number, audioTime: number) => void

/** Clamp a velocity into (0, 1], never letting a jittered value hit/exceed 0 or overshoot 1. */
function clampVel(v: number): number {
  return Math.min(1, Math.max(0.001, v))
}

/* ------------------------------- engine ----------------------------------- */

export class SequencerEngine {
  private parts: Array<Tone.Part<any>> = []
  private chordListeners = new Set<ChordListener>()
  private beatListeners = new Set<BeatListener>()
  private timeline: TimelineEvent[] = []
  private bakedBars = 0
  private loopBounds: { start: number; end: number } | null = null
  private _generation = 0
  progression: Progression | null = null
  key: PitchClass = 0
  bars = 0

  load(progression: Progression, key: PitchClass, tempo?: number): void {
    this.dispose()
    this._generation++
    this.progression = progression
    this.key = key
    this.timeline = buildTimeline(progression, key)
    this.bars = totalBars(progression)
    this.bakedBars = this.bars * PASSES
    const beatsPerBar = progression.timeSignature[0]
    const style = styleFor(progression)
    const t = Tone.getTransport()
    t.timeSignature = beatsPerBar
    t.bpm.value = tempo ?? progression.defaultTempo
    t.swing = style.swing
    t.swingSubdivision = '8n'
    t.loop = true
    t.setLoopPoints('0:0:0', `${this.bakedBars}:0:0`)
    this.loopBounds = null // full baked range = no A/B loop selected

    getMixer().applyTrims(style.trims)

    const band = getBand()
    const beatSec = () => 60 / t.bpm.value
    const jitter = () => gaussian(Math.random, 0.0025)
    const pocket = style.groove.pocket
    const drumPocket = (art: string): number => {
      if (art === 'kick') return pocket.kick
      if (art === 'snare' || art === 'xstick') return pocket.snare
      return pocket.hat
    }

    type TimedChord = TimelineEvent & { index: number; time: string }
    type TimedNote = NoteSpec & { time: string }
    type TimedDrum = DrumSpec & { time: string }
    interface TimedBeat { time: string; formBar: number; beat: number }

    const chordEvents: TimedChord[] = []
    const keysEvents: TimedNote[] = []
    const bassEvents: TimedNote[] = []
    const drumEvents: TimedDrum[] = []
    const beatEvents: TimedBeat[] = []

    // Bake all PASSES passes up front: each pass gets its own seeded RNG per
    // voice so the arrangement never repeats for ~4x the form length, then
    // the whole baked block loops (setLoopPoints above).
    let pendingCrash = false
    for (let p = 0; p < PASSES; p++) {
      const passOffsetBeats = p * this.bars * beatsPerBar

      // Chord-change events stay in FORM space (identical payload every
      // pass) — only their scheduled `time` advances with the pass.
      for (let index = 0; index < this.timeline.length; index++) {
        const ev = this.timeline[index]
        const atBeat = passOffsetBeats + ev.bar * beatsPerBar + ev.beat
        chordEvents.push({ ...ev, index, time: beatToTime(atBeat, beatsPerBar) })
      }

      // One beat callback per quarter note across the whole pass.
      for (let beatIdx = 0; beatIdx < this.bars * beatsPerBar; beatIdx++) {
        const absBeat = passOffsetBeats + beatIdx
        const formBar = Math.floor(absBeat / beatsPerBar) % this.bars
        beatEvents.push({ time: beatToTime(absBeat, beatsPerBar), formBar, beat: beatIdx % beatsPerBar })
      }

      const rngBass = mulberry32(hashSeed(progression.id, p, 'bass'))
      const rngKeys = mulberry32(hashSeed(progression.id, p, 'keys'))
      const rngDrums = mulberry32(hashSeed(progression.id, p, 'drums'))

      for (const note of arrangeBass(this.timeline, style.bass, beatsPerBar, rngBass)) {
        bassEvents.push({ ...note, time: beatToTime(passOffsetBeats + note.atBeat, beatsPerBar) })
      }
      for (const note of arrangeKeys(this.timeline, style.comp, beatsPerBar, rngKeys)) {
        keysEvents.push({ ...note, time: beatToTime(passOffsetBeats + note.atBeat, beatsPerBar) })
      }

      const drumSpecs = arrangeDrums(this.bars, style.groove, beatsPerBar, rngDrums, p * this.bars)
      // Crash carried over from a fill that fired on the LAST local bar of
      // the previous pass — drums.ts can only crash within its own call, so
      // Task 8 seeds the first beat of the next pass here.
      if (pendingCrash) drumSpecs.unshift({ atBeat: 0, art: 'crash', vel: 0.9 })
      const lastBarStart = (this.bars - 1) * beatsPerBar
      pendingCrash = p < PASSES - 1 && drumSpecs.some((ev) => ev.fill && ev.atBeat >= lastBarStart)
      for (const ev of drumSpecs) {
        drumEvents.push({ ...ev, time: beatToTime(passOffsetBeats + ev.atBeat, beatsPerBar) })
      }
    }

    // chord-change events for the UI (and drill windows)
    const debugChordEvents: Array<{ index: number; audioTime: number }> = []
    this.parts.push(new Tone.Part(
      (time, ev: TimelineEvent & { index: number }) => {
        if (debugChordEvents.length < 200) debugChordEvents.push({ index: ev.index, audioTime: time })
        Tone.getDraw().schedule(() => {
          const e: ChordChangeEvent = { event: ev, index: ev.index, audioTime: time }
          for (const l of this.chordListeners) l(e)
        }, time)
      },
      chordEvents,
    ).start(0))

    // keys
    this.parts.push(new Tone.Part(
      (time, ev: NoteSpec) => {
        const at = Math.max(time + pocket.keys + jitter(), 0.001)
        band.keys.triggerAttackRelease(
          ev.midis.map(midiToFreq), ev.durBeats * beatSec(), at, clampVel(ev.vel + (Math.random() - 0.5) * 0.04),
        )
      },
      keysEvents,
    ).start(0))

    // bass
    this.parts.push(new Tone.Part(
      (time, ev: NoteSpec) => {
        const at = Math.max(time + pocket.bass + jitter(), 0.001)
        band.bass.triggerAttackRelease(
          midiToFreq(ev.midis[0]), ev.durBeats * beatSec(), at, clampVel(ev.vel + (Math.random() - 0.5) * 0.06),
        )
      },
      bassEvents,
    ).start(0))

    // drums
    this.parts.push(new Tone.Part(
      (time, ev: DrumSpec) => {
        const at = Math.max(time + drumPocket(ev.art) + jitter(), 0.001)
        band.drums.trigger(ev.art, at, clampVel(ev.vel))
      },
      drumEvents,
    ).start(0))

    // beat callback (form-space bar, one per quarter note, across all passes)
    this.parts.push(new Tone.Part(
      (time, ev: { formBar: number; beat: number }) => {
        Tone.getDraw().schedule(() => {
          for (const l of this.beatListeners) l(ev.formBar, ev.beat, time)
        }, time)
      },
      beatEvents,
    ).start(0))

    exposeDebug({
      chordEvents: debugChordEvents,
      loop: null,
      songDebug: {
        progressionId: progression.id,
        bpm: t.bpm.value,
        beatsPerBar,
        bars: this.bars,
        passes: PASSES,
        timeline: this.timeline.map((e, index) => ({
          index, bar: e.bar, beat: e.beat, durationBeats: e.durationBeats,
        })),
        stats: {
          fills: drumEvents.filter((e) => e.fill).length,
          crashes: drumEvents.filter((e) => e.art === 'crash').length,
        },
      },
    })
  }

  play(opts?: { countIn?: boolean }): void {
    const t = Tone.getTransport()
    if (opts?.countIn && this.progression && t.seconds === 0) {
      const beat = 60 / t.bpm.value
      const beats = this.progression.timeSignature[0]
      const start = audioNow() + 0.08
      for (let i = 0; i < beats; i++)
        getBand().drums.trigger('xstick', start + i * beat, i === 0 ? 1 : 0.7)
      t.start(start + beats * beat)
      return
    }
    t.start()
  }
  pause(): void { Tone.getTransport().pause() }

  stop(): void {
    const t = Tone.getTransport()
    t.stop()
    t.position = 0
  }

  get playing(): boolean { return Tone.getTransport().state === 'started' }

  /** True at the very start of the transport — mirrors the condition play() uses to decide on a count-in. */
  get atStart(): boolean { return Tone.getTransport().seconds === 0 }

  /** Current transport position folded into form-space bars (0..bars-1), for A/B loop bookkeeping. */
  get positionBar(): number {
    if (this.bars <= 0) return 0
    const bars = parseInt(String(Tone.getTransport().position).split(':')[0], 10) || 0
    return ((bars % this.bars) + this.bars) % this.bars
  }

  setTempo(bpm: number): void { Tone.getTransport().bpm.value = bpm }
  get tempo(): number { return Math.round(Tone.getTransport().bpm.value) }

  /** Jump the transport to the start of `bar` (form-space); works playing or paused. */
  seek(bar: number): void {
    Tone.getTransport().position = `${bar}:0:0`
  }

  setLoop(startBar: number, endBar: number): void {
    Tone.getTransport().setLoopPoints(`${startBar}:0:0`, `${endBar}:0:0`)
    this.loopBounds = { start: startBar, end: endBar }
    exposeDebug({ loop: { a: startBar, b: endBar } })
  }

  /** Restore the loop points to the full baked range (0..bars*PASSES), clearing any A/B selection. */
  clearLoop(): void {
    Tone.getTransport().setLoopPoints('0:0:0', `${this.bakedBars}:0:0`)
    this.loopBounds = null
    exposeDebug({ loop: null })
  }

  /** True while an A/B loop (narrower than the full baked range) is selected — drills that
   *  score against "the next chord in form order" must pause while this is true: at a loop
   *  wrap, the next audible chord is the loop start's, not timeline[index+1]. */
  get loopActive(): boolean { return this.loopBounds !== null }

  /** Bumped on every load() (song or key change) — a session artifact (like a guide-tone
   *  drill window) captures this at schedule time and treats a mismatch at close as "abort,
   *  don't score": the progression object/id can stay identical across a key change, so id
   *  alone can't detect it. */
  get generation(): number { return this._generation }

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
    for (const p of this.parts) p.dispose()
    this.parts = []
    const t = Tone.getTransport()
    t.swing = 0
    t.swingSubdivision = '8n'
    t.timeSignature = 4
    t.loop = false
  }
}

export const sequencer = new SequencerEngine()
