import type { TimelineSource, TimelineSourceEvent } from '../../audio/timeline-source'
import { beatMs, chordAtMs, type ResolvedTiming, type SongMap } from './songmap'
import { parseChordSymbol, type Chord, type PitchClass } from './spotify-utils'
import type { TimelineEvent } from '../../music-core'

/**
 * A Song Map as a TimelineSource, so the guide-tone drill can run over a
 * real record. Change detection polls the transport's clock at 100ms — the
 * poll is only a DETECTOR: the emitted `audioTime` is ctxTimeOf(the chord's
 * exact resolved ms), so scheduling never inherits poll jitter. Lateness of
 * the emission (≤100ms) only trims the already-a-bar-early pearl preview.
 *
 * `tempo` is reported in CONTEXT time (bpm × playback rate): a slowed deck
 * slows the drill's beat-relative windows with it, keeping them musically
 * one beat wide.
 */

export interface SongMapSourceOpts {
  map: SongMap
  /** Live getter — corrections re-resolve through it. */
  resolved(): ResolvedTiming
  clockMs(): number
  /** AudioContext time a song position will sound (exact for the deck,
   * estimate-mapped for Spotify). */
  ctxTimeOf(songMs: number): number
  playing(): boolean
  loopActive(): boolean
  /** Playback rate (deck rate; 1 for the record). */
  rate(): number
  /** Transport generation (the deck bumps on seek/rate/loop; 0 for Spotify). */
  extraGeneration(): number
  duck(at: number): void
  unduck(at: number): void
}

export interface SongMapTimelineSource extends TimelineSource {
  /** Key at an event index — the section's override or the song key. */
  keyFor(eventIndex: number): PitchClass
  dispose(): void
}

interface Entry {
  chordIndex: number
  chord: Chord
  symbol: string
  sectionKeyRoot: PitchClass
}

/** A position jump the clock can't explain (seek) — windows must die. */
const JUMP_THRESHOLD_MS = 2500

export function songMapTimelineSource(opts: SongMapSourceOpts): SongMapTimelineSource {
  const { map } = opts

  const sectionKeyById = new Map(map.sections.map((s) => [s.id, (s.keyOverride ?? map.key).root]))
  const entries: Entry[] = []
  const filteredIndexByChordIndex = new Map<number, number>()
  map.chords.forEach((c, i) => {
    try {
      const chord = parseChordSymbol(c.symbol)
      filteredIndexByChordIndex.set(i, entries.length)
      entries.push({ chordIndex: i, chord, symbol: c.symbol, sectionKeyRoot: sectionKeyById.get(c.sectionId) ?? map.key.root })
    } catch { /* unparseable — no drill target, casts no event */ }
  })

  // Events carry durationBeats derived from ACTUAL resolved gaps, so the
  // drill's tNext = audioTime + durationBeats × beatSec reproduces the next
  // change's exact moment. Rebuilt whenever the resolved timing changes
  // (corrections), with a generation bump so pending windows die.
  let cachedResolved: ResolvedTiming | null = null
  let events: TimelineEvent[] = []
  let ownGeneration = 0

  function rebuildIfNeeded(): void {
    const r = opts.resolved()
    if (r === cachedResolved) return
    if (cachedResolved !== null) ownGeneration++
    cachedResolved = r
    const msByChordIndex = new Map(r.chords.map((c) => [c.chordIndex, c.ms]))
    const oneBeat = beatMs(map)
    events = entries.map((e, k) => {
      const ms = msByChordIndex.get(e.chordIndex) ?? map.chords[e.chordIndex].ms
      const next = k + 1 < entries.length ? (msByChordIndex.get(entries[k + 1].chordIndex) ?? ms + oneBeat) : ms + 4 * oneBeat
      return {
        bar: 0,
        beat: 0,
        chord: e.chord,
        symbol: e.symbol,
        durationBeats: Math.max(0.25, (next - ms) / oneBeat),
      }
    })
  }
  rebuildIfNeeded()

  const listeners = new Set<(e: TimelineSourceEvent) => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  let lastFilteredIndex = -2
  let lastMs = -1

  function tick(): void {
    rebuildIfNeeded()
    if (!opts.playing()) { lastFilteredIndex = -2; lastMs = -1; return }
    const ms = opts.clockMs()
    if (lastMs >= 0 && Math.abs(ms - lastMs) > JUMP_THRESHOLD_MS) {
      ownGeneration++ // a seek — every pending window is now wrong
      lastFilteredIndex = -2
    }
    lastMs = ms
    const r = cachedResolved!
    const ri = chordAtMs(r, ms)
    if (ri === -1) return
    const filteredIndex = filteredIndexByChordIndex.get(r.chords[ri].chordIndex) ?? -1
    if (filteredIndex === -1 || filteredIndex === lastFilteredIndex) return
    lastFilteredIndex = filteredIndex
    const e: TimelineSourceEvent = {
      event: events[filteredIndex],
      index: filteredIndex,
      audioTime: opts.ctxTimeOf(r.chords[ri].ms),
    }
    for (const l of listeners) l(e)
  }

  return {
    onChordChange(l) {
      listeners.add(l)
      if (!timer) timer = setInterval(tick, 100)
      return () => {
        listeners.delete(l)
        if (listeners.size === 0 && timer) { clearInterval(timer); timer = null }
      }
    },
    get events() { rebuildIfNeeded(); return events },
    get sourceId() { return map.trackUri },
    get tempo() { return map.tempo.bpm * opts.rate() },
    get playing() { return opts.playing() },
    get loopActive() { return opts.loopActive() },
    get generation() { rebuildIfNeeded(); return ownGeneration + opts.extraGeneration() },
    duck: (at) => opts.duck(at),
    unduck: (at) => opts.unduck(at),
    keyFor: (eventIndex) => entries[eventIndex]?.sectionKeyRoot ?? map.key.root,
    dispose() {
      listeners.clear()
      if (timer) { clearInterval(timer); timer = null }
    },
  }
}
