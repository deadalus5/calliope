import * as Tone from 'tone'
import { audioNow, getRawContext } from './context'
import { exposeDebug } from './debug'
import {
  ctxTimeOfSongMs, fileSecOf, filePosAt, foldFilePos, rateForBpm, songMsOf,
  type DeckAnchor, type FileLoop,
} from './deck-math'
import { getMixer } from './mixer'

/**
 * The practice deck: plays a locally-served copy of a song (the sidecar's
 * analysis audio, pre-stretched per speed with ffmpeg) through the one
 * AudioContext, into the mixer's deck bus (pre-master, duckable). Engine-
 * level helper à la sequencer.ts — callers pass plain data (URLs, ms), so
 * audio/ stays free of state/ and integrations imports.
 *
 * Everything time flows from ctx.currentTime: `positionMs()` and
 * `ctxTimeOf()` are pure functions of it (deck-math), which is what lets
 * drills score sample-accurately over records with no clock mapping. A/B
 * loops use the source node's native loopStart/loopEnd — the wrap happens
 * in the audio render thread, beat-tight by construction.
 */

export interface DeckSpec {
  id: string
  durationMs: number
  urlForRate(rate: number): string
}

export { rateForBpm }

type EndedListener = () => void

let spec: DeckSpec | null = null
let buffers = new Map<number, AudioBuffer>()
let bufferOrder: number[] = [] // LRU, most recent last; cap 2 (decoded audio is big)
let node: AudioBufferSourceNode | null = null
let anchor: DeckAnchor | null = null
let rate = 1
let playing = false
let generation = 0
let pausedAtSongMs = 0
let loopSong: { aMs: number; bMs: number } | null = null
const endedListeners = new Set<EndedListener>()

function fileLoop(): FileLoop | null {
  return loopSong
    ? { startFile: fileSecOf(loopSong.aMs, rate), endFile: fileSecOf(loopSong.bMs, rate) }
    : null
}

async function ensureBuffer(r: number): Promise<AudioBuffer> {
  if (!spec) throw new Error('deck: no track loaded')
  const cached = buffers.get(r)
  if (cached) {
    bufferOrder = [...bufferOrder.filter((x) => x !== r), r]
    return cached
  }
  const res = await fetch(spec.urlForRate(r))
  if (!res.ok) throw new Error(`deck: audio fetch failed (${res.status})`)
  const buf = await getRawContext().decodeAudioData(await res.arrayBuffer())
  buffers.set(r, buf)
  bufferOrder = [...bufferOrder.filter((x) => x !== r), r]
  while (bufferOrder.length > 2) {
    const evict = bufferOrder.shift()!
    buffers.delete(evict)
  }
  return buf
}

function positionMsNow(): number {
  if (!playing || !anchor) return pausedAtSongMs
  const filePos = foldFilePos(filePosAt(anchor, audioNow()), fileLoop())
  return Math.min(Math.max(0, songMsOf(filePos, rate)), spec?.durationMs ?? Infinity)
}

function stopNode(): void {
  if (!node) return
  node.onended = null
  try { node.stop() } catch { /* already stopped */ }
  node.disconnect()
  node = null
}

function startNode(buffer: AudioBuffer, songMs: number): void {
  stopNode()
  const ctx = getRawContext()
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const loop = fileLoop()
  if (loop) {
    src.loop = true
    src.loopStart = loop.startFile
    src.loopEnd = Math.min(loop.endFile, buffer.duration)
  }
  Tone.connect(src, getMixer().deckBus)
  const offset = Math.min(Math.max(0, fileSecOf(songMs, rate)), Math.max(0, buffer.duration - 0.01))
  const t0 = ctx.currentTime
  src.start(t0, offset)
  src.onended = () => {
    // Natural end of the file (loops never end; stops clear the handler).
    playing = false
    anchor = null
    pausedAtSongMs = spec?.durationMs ?? 0
    generation++
    for (const l of endedListeners) l()
  }
  node = src
  anchor = { ctxT0: t0, fileSec0: offset }
  playing = true
}

export const deck = {
  /** Fetch + decode the 1× audio and make this the deck's track. */
  async load(s: DeckSpec): Promise<void> {
    stopNode()
    spec = s
    buffers = new Map()
    bufferOrder = []
    rate = 1
    playing = false
    anchor = null
    pausedAtSongMs = 0
    loopSong = null
    generation++
    await ensureBuffer(1)
  },

  get loaded(): boolean { return spec !== null && buffers.has(rate) },
  get trackId(): string | null { return spec?.id ?? null },
  get playing(): boolean { return playing },
  get rate(): number { return rate },
  get generation(): number { return generation },
  get loopActive(): boolean { return loopSong !== null },

  play(): void {
    if (playing || !spec) return
    const buf = buffers.get(rate)
    if (!buf) return
    startNode(buf, pausedAtSongMs)
    generation++
  },

  pause(): void {
    if (!playing) return
    pausedAtSongMs = positionMsNow()
    stopNode()
    playing = false
    anchor = null
    generation++
  },

  seek(songMs: number): void {
    const clamped = Math.min(Math.max(0, songMs), spec?.durationMs ?? songMs)
    // Seeking outside an armed loop means the user left it — disarm, or the
    // position math would fold a playhead that never entered the loop.
    if (loopSong && (clamped < loopSong.aMs || clamped >= loopSong.bMs)) loopSong = null
    if (playing) {
      const buf = buffers.get(rate)
      if (buf) startNode(buf, clamped)
    } else {
      pausedAtSongMs = clamped
    }
    generation++
  },

  /** Switch speed (fetching/decoding that render on first use), resuming at
   * the same song position. */
  async setRate(newRate: number): Promise<void> {
    if (!spec || newRate === rate) return
    const pos = positionMsNow()
    const wasPlaying = playing
    if (playing) { stopNode(); playing = false; anchor = null }
    const buf = await ensureBuffer(newRate)
    rate = newRate
    pausedAtSongMs = pos
    if (wasPlaying) startNode(buf, pos)
    generation++
  },

  /** Beat-tight A/B loop: native buffer-source loop points (the wrap runs in
   * the audio render thread, no JS timer involved). */
  setLoop(aMs: number, bMs: number): void {
    if (bMs <= aMs) return
    loopSong = { aMs, bMs }
    if (playing) {
      const buf = buffers.get(rate)
      if (buf) startNode(buf, positionMsNow())
    }
    generation++
  },

  clearLoop(): void {
    if (!loopSong) return
    loopSong = null
    if (playing) {
      const buf = buffers.get(rate)
      if (buf) startNode(buf, positionMsNow())
    }
    generation++
  },

  /** Song position, derived from ctx.currentTime (loop-folded). */
  positionMs(): number {
    return positionMsNow()
  },

  /** Exact AudioContext time the given song position will (next) sound.
   * Same clock as mic locks — drills score against this directly. */
  ctxTimeOf(songMs: number): number {
    if (!playing || !anchor) return Number.POSITIVE_INFINITY
    return ctxTimeOfSongMs(anchor, audioNow(), songMs, rate, fileLoop())
  },

  onEnded(l: EndedListener): () => void {
    endedListeners.add(l)
    return () => endedListeners.delete(l)
  },

  dispose(): void {
    stopNode()
    spec = null
    buffers = new Map()
    bufferOrder = []
    playing = false
    anchor = null
    loopSong = null
    pausedAtSongMs = 0
    generation++
  },
}

// E2E introspection (merge-only surface).
exposeDebug({
  deck: {
    positionMs: () => deck.positionMs(),
    playing: () => deck.playing,
    rate: () => deck.rate,
    generation: () => deck.generation,
    loopActive: () => deck.loopActive,
  },
})
