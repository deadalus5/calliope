import { getRawContext } from '../audio/context'

/**
 * Mic → AudioWorklet lifecycle. Echo cancellation, noise suppression and
 * AGC are all disabled: they are tuned for speech and destroy sustained
 * musical tones (and our RMS gates). Bleed from the backing track is
 * handled musically (ducking) in the drill engine instead.
 */

export interface PitchFrame {
  freq: number // 0 when no pitch found
  clarity: number // 0..1
  rms: number
  t: number // audio-clock seconds
}

export type PitchListener = (frame: PitchFrame) => void

export class MicDisabledError extends Error {
  constructor() {
    super('Microphone is disabled (no-mic mode)')
  }
}

let stream: MediaStream | null = null
let node: AudioWorkletNode | null = null
let source: MediaStreamAudioSourceNode | null = null
let sink: GainNode | null = null
let workletLoaded = false
let micDisabled = false
const listeners = new Set<PitchListener>()
/** Debug probe: total frames received (visible in devtools). */
export let frameCount = 0

/**
 * No-mic gate, synced from the app layer (App.tsx watches the micMode pref
 * and calls this, including once at startup so a persisted 'off' takes
 * effect before any view acts). A plain flag keeps pitch/ free of store
 * imports per the layering rules — pitch/ depends only on music-core.
 */
export function setMicDisabled(disabled: boolean): void {
  micDisabled = disabled
}

export async function startPitchEngine(): Promise<void> {
  // Guard goes BEFORE the idempotency check below: an already-running
  // engine implies the mic was enabled when it started, but we still want
  // no-mic mode to always refuse a fresh start call. The mic-toggle
  // handler is responsible for calling stopPitchEngine() when flipping to
  // 'off' while the engine is already running.
  if (micDisabled) throw new MicDisabledError()
  if (node) return
  const ctx = getRawContext()
  if (!workletLoaded) {
    await ctx.audioWorklet.addModule(import.meta.env.BASE_URL + 'pitch-processor.js')
    workletLoaded = true
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  })
  source = ctx.createMediaStreamSource(stream)
  node = new AudioWorkletNode(ctx, 'pitch-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1, // a silent path to the destination keeps the graph pulling us
  })
  node.port.onmessage = (e: MessageEvent<PitchFrame>) => {
    frameCount++
    const g = globalThis as Record<string, unknown> & typeof globalThis
    g.__pitchFrameCount = frameCount
    g.__lastPitchFrame = e.data
    for (const l of listeners) l(e.data)
  }
  sink = ctx.createGain()
  sink.gain.value = 0
  source.connect(node)
  node.connect(sink)
  sink.connect(ctx.destination)
}

export function stopPitchEngine(): void {
  source?.disconnect()
  node?.disconnect()
  sink?.disconnect()
  node?.port.close()
  stream?.getTracks().forEach((t) => t.stop())
  source = null
  node = null
  sink = null
  stream = null
}

export function pitchEngineRunning(): boolean {
  return node !== null
}

export function onPitchFrame(l: PitchListener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
