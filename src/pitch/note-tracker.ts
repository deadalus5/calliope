import { freqToNote, midiToPc, type PitchClass } from '../music-core'
import { onPitchFrame, type PitchFrame } from './pitch-engine'

/**
 * Turns raw pitch frames into musical events. Gates on RMS + clarity,
 * median-filters the last 5 estimates to kill octave flickers, discards the
 * first ~30ms after onset (pick transients are inharmonic), and emits:
 *   'pitch'   continuous while tracking: {midiFloat, midi, cents, pc}
 *   'lock'    a note held stably for 3 hops — the drill-answer event
 *   'silence' input went quiet
 */

export interface TrackedPitch {
  midiFloat: number
  midi: number
  cents: number
  pc: PitchClass
  clarity: number
  t: number
}

type TrackerEvent =
  | { type: 'pitch'; pitch: TrackedPitch }
  | { type: 'lock'; pitch: TrackedPitch }
  | { type: 'silence' }

export type TrackerListener = (e: TrackerEvent) => void

const MEDIAN_N = 5
const LOCK_HOPS = 3
const LOCK_CENTS = 35
const ATTACK_SKIP_S = 0.03

export interface TrackerConfig {
  minClarity: number
  minRms: number
}

export class NoteTracker {
  private listeners = new Set<TrackerListener>()
  private recent: number[] = [] // midiFloat history for median
  private state: 'silent' | 'attack' | 'tracking' = 'silent'
  private attackAt = 0
  private lockCandidate: number | null = null
  private lockCount = 0
  private locked = false
  private unsub: (() => void) | null = null
  config: TrackerConfig = { minClarity: 0.88, minRms: 0.01 }
  /** Raised during calibration to sit above ambient/backing bleed. */
  noiseFloor = 0.005

  start(): void {
    if (this.unsub) return
    this.unsub = onPitchFrame((f) => this.onFrame(f))
  }

  stop(): void {
    this.unsub?.()
    this.unsub = null
  }

  on(l: TrackerListener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private emit(e: TrackerEvent) {
    for (const l of this.listeners) l(e)
  }

  private onFrame(f: PitchFrame) {
    const gate = f.rms > Math.max(this.config.minRms, this.noiseFloor * 2.5)
      && f.clarity > this.config.minClarity && f.freq > 0

    if (!gate) {
      if (this.state !== 'silent' && f.rms < this.noiseFloor * 1.5) {
        this.state = 'silent'
        this.recent = []
        this.lockCandidate = null
        this.lockCount = 0
        this.locked = false
        this.emit({ type: 'silence' })
      }
      return
    }

    if (this.state === 'silent') {
      this.state = 'attack'
      this.attackAt = f.t
      return
    }
    if (this.state === 'attack') {
      if (f.t - this.attackAt < ATTACK_SKIP_S) return
      this.state = 'tracking'
    }

    const { midi, cents } = freqToNote(f.freq)
    const midiFloat = midi + cents / 100
    this.recent.push(midiFloat)
    if (this.recent.length > MEDIAN_N) this.recent.shift()
    const sorted = [...this.recent].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const medMidi = Math.round(median)
    const medCents = (median - medMidi) * 100
    const pitch: TrackedPitch = {
      midiFloat: median, midi: medMidi, cents: medCents,
      pc: midiToPc(medMidi), clarity: f.clarity, t: f.t,
    }
    this.emit({ type: 'pitch', pitch })

    // Lock detection: same note for LOCK_HOPS consecutive hops.
    if (this.lockCandidate !== null && Math.abs(midiFloat - this.lockCandidate) * 100 <= LOCK_CENTS) {
      this.lockCount++
      if (this.lockCount >= LOCK_HOPS && !this.locked) {
        this.locked = true
        this.emit({ type: 'lock', pitch })
      }
    } else {
      this.lockCandidate = midiFloat
      this.lockCount = 1
      this.locked = false
    }
  }
}

export const noteTracker = new NoteTracker()
