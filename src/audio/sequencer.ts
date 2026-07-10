import * as Tone from 'tone'
import {
  buildTimeline, chordBass, chordPcs, midiToFreq, normalizePc, totalBars,
  type Chord, type PitchClass, type Progression, type TimelineEvent,
} from '../music-core'
import { getBand } from './instruments'
import { audioNow } from './context'

/**
 * SequencerEngine: one Tone.Transport wrapper that turns a Progression into
 * a playing band plus a stream of chord-change events. The band is arranged
 * per feel — shuffle gets a walking bass, off-beat piano comping and a swung
 * kit; straight gets held voicings, root–five bass and a backbeat. Events
 * are scheduled in bars:beats (tempo-independent) and re-emitted to the UI
 * via Tone.Draw at the audible moment. Transposing regenerates the timeline
 * from music-core — audio is never pitch-shifted.
 */

export interface ChordChangeEvent {
  event: TimelineEvent
  index: number
  /** Audio-clock time the chord sounds — drills score against this. */
  audioTime: number
}

type ChordListener = (e: ChordChangeEvent) => void
type BeatListener = (bar: number, beat: number, audioTime: number) => void

interface NoteEv {
  time: string // bars:quarters:sixteenths
  midis: number[]
  durBeats: number
  vel: number
}

/* ---------------------------- voicing helpers ---------------------------- */

/** Close-position voicing hunting upward from `from`; drops the root for
 * 4+ note chords (the bass owns it — rootless comping). */
function pianoVoicing(chord: Chord, from = 58): number[] {
  let pcs = chordPcs(chord)
  if (pcs.length >= 4) pcs = pcs.slice(1)
  pcs = pcs.slice(0, 4)
  const midis: number[] = []
  let prev = from
  for (const pc of pcs) {
    let m = prev + normalizePc(pc - prev)
    if (m === prev) m += 12
    midis.push(m)
    prev = m
  }
  return midis
}

function bassRoot(chord: Chord): number {
  return 36 + normalizePc(chordBass(chord)) // C2..B2
}

/** Keep a walking note in the meat of the bass register. */
function clampBass(m: number): number {
  while (m > 50) m -= 12
  while (m < 33) m += 12
  return m
}

/* ----------------------------- arrangements ------------------------------ */

function arrangeBass(timeline: TimelineEvent[], feel: 'straight' | 'shuffle', beatsPerBar: number): NoteEv[] {
  const out: NoteEv[] = []
  for (let i = 0; i < timeline.length; i++) {
    const ev = timeline[i]
    const next = timeline[(i + 1) % timeline.length]
    const root = bassRoot(ev.chord)
    const iv = ev.chord.quality.intervals
    const third = iv[1] ?? 4
    const fifth = iv[2] ?? 7
    const sixthOrSeventh = iv[3] !== undefined ? iv[3] : 9 // b7 for 7-chords, 6 otherwise
    const changeComing = normalizePc(chordBass(next.chord)) !== normalizePc(chordBass(ev.chord))
    const approach = clampBass(bassRoot(next.chord) - 1)

    const pushQ = (beatInChord: number, midi: number, vel: number, dur = 0.9) => {
      const abs = ev.bar * beatsPerBar + ev.beat + beatInChord
      out.push({
        time: `${Math.floor(abs / beatsPerBar)}:${abs % beatsPerBar}:0`,
        midis: [clampBass(midi)], durBeats: dur, vel,
      })
    }

    if (feel === 'shuffle') {
      // walking quarters; last quarter before a change approaches the new root
      for (let b = 0; b < ev.durationBeats; b++) {
        const barPos = b % beatsPerBar
        const lastOfChord = b === ev.durationBeats - 1
        if (lastOfChord && changeComing) { pushQ(b, approach, 0.85); continue }
        const barIdx = Math.floor(b / beatsPerBar)
        const walkUp = [root, root + third, root + fifth, root + sixthOrSeventh]
        const walkDown = [root + 12, root + sixthOrSeventh, root + fifth, root + third]
        pushQ(b, (barIdx % 2 === 0 ? walkUp : walkDown)[barPos], barPos === 0 ? 0.95 : 0.8)
      }
    } else {
      // root on 1, fifth on 3, approach into changes
      for (let b = 0; b < ev.durationBeats; b++) {
        const barPos = b % beatsPerBar
        const lastOfChord = b === ev.durationBeats - 1
        if (lastOfChord && changeComing && ev.durationBeats >= 2) { pushQ(b, approach, 0.7); continue }
        if (barPos === 0) pushQ(b, root, 0.95, 1.9)
        else if (barPos === 2) pushQ(b, root + fifth, 0.75, 1.4)
      }
    }
  }
  return out
}

function arrangePiano(timeline: TimelineEvent[], feel: 'straight' | 'shuffle', beatsPerBar: number): NoteEv[] {
  const out: NoteEv[] = []
  for (const ev of timeline) {
    const voicing = pianoVoicing(ev.chord)
    const bars = Math.ceil(ev.durationBeats / beatsPerBar)
    for (let bar = 0; bar < bars; bar++) {
      const absBar = ev.bar + bar
      const base = ev.bar * beatsPerBar + ev.beat + bar * beatsPerBar
      const at = (beat: number, sixteenth: number) => {
        const abs = base + beat
        return `${Math.floor(abs / beatsPerBar)}:${abs % beatsPerBar}:${sixteenth}`
      }
      const beatsLeft = ev.durationBeats - bar * beatsPerBar
      if (feel === 'shuffle') {
        // alternate off-beat stabs and Charleston, by bar parity
        if (absBar % 2 === 0) {
          out.push({ time: at(0, 2), midis: voicing, durBeats: 0.7, vel: 0.6 })
          if (beatsLeft > 2) out.push({ time: at(2, 2), midis: voicing, durBeats: 0.7, vel: 0.5 })
        } else {
          out.push({ time: at(0, 0), midis: voicing, durBeats: 0.5, vel: 0.65 })
          if (beatsLeft > 1) out.push({ time: at(1, 2), midis: voicing, durBeats: 1.1, vel: 0.55 })
        }
      } else {
        // held voicing on 1, soft upper restrike on 3
        out.push({ time: at(0, 0), midis: voicing, durBeats: Math.min(2.4, beatsLeft), vel: 0.62 })
        if (beatsLeft > 2) {
          out.push({ time: at(2, 0), midis: voicing.slice(-2), durBeats: 1.4, vel: 0.42 })
        }
      }
    }
  }
  return out
}

/* ------------------------------- engine ----------------------------------- */

export class SequencerEngine {
  private parts: Array<Tone.Part<any> | Tone.Sequence> = []
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
    const beatsPerBar = progression.timeSignature[0]
    const t = Tone.getTransport()
    t.timeSignature = beatsPerBar
    t.bpm.value = tempo ?? progression.defaultTempo
    t.swing = progression.feel === 'shuffle' ? 0.52 : 0
    t.swingSubdivision = '8n'
    t.loop = true
    t.setLoopPoints('0:0:0', `${this.bars}:0:0`)

    const band = getBand()
    const human = () => (Math.random() - 0.5) * 0.014
    const beatSec = () => 60 / t.bpm.value

    // chord-change events for the UI (and drill windows)
    this.parts.push(new Tone.Part(
      (time, ev: TimelineEvent & { index: number }) => {
        Tone.getDraw().schedule(() => {
          const e: ChordChangeEvent = { event: ev, index: ev.index, audioTime: time }
          for (const l of this.chordListeners) l(e)
        }, time)
      },
      this.timeline.map((ev, index) => ({ ...ev, index, time: `${ev.bar}:${ev.beat}:0` })),
    ).start(0))

    // piano
    this.parts.push(new Tone.Part(
      (time, ev: NoteEv) => {
        band.keys.triggerAttackRelease(
          ev.midis.map(midiToFreq), ev.durBeats * beatSec(), time + human(), ev.vel + (Math.random() - 0.5) * 0.08,
        )
      },
      arrangePiano(this.timeline, progression.feel, beatsPerBar),
    ).start(0))

    // bass
    this.parts.push(new Tone.Part(
      (time, ev: NoteEv) => {
        band.bass.triggerAttackRelease(
          midiToFreq(ev.midis[0]), ev.durBeats * beatSec(), time + human(), ev.vel + (Math.random() - 0.5) * 0.06,
        )
      },
      arrangeBass(this.timeline, progression.feel, beatsPerBar),
    ).start(0))

    // kit: hat every 8th (swing handles the shuffle), kick 1 & 3, snare 2 & 4
    const HAT_VEL = [0.85, 0.35, 0.6, 0.35, 0.75, 0.35, 0.6, 0.4]
    this.parts.push(new Tone.Sequence(
      (time, inBar: number) => {
        if (inBar === 0 || inBar === 4) band.drums.trigger('kick', time + human() * 0.5, inBar === 0 ? 1 : 0.85)
        if (inBar === 2 || inBar === 6) band.drums.trigger('snare', time + human() * 0.5, 0.9)
        band.drums.trigger('hat-closed', time + human() * 0.5, HAT_VEL[inBar])
        if (inBar % 2 === 0) {
          Tone.getDraw().schedule(() => {
            const [bar, beat] = String(Tone.getTransport().position).split(':').map(Number)
            for (const l of this.beatListeners) l(bar, beat, time)
          }, time)
        }
      },
      Array.from({ length: 8 }, (_, i) => i),
      '8n',
    ).start(0))
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
