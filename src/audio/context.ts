import * as Tone from 'tone'

/**
 * One AudioContext for the whole app — Tone's transport, the audition synth,
 * and the pitch engine all share it, so their clocks agree (drill latency is
 * scored against this clock). Browsers require a user gesture before audio,
 * so everything funnels through start().
 */

let started = false
let rawContext: AudioContext | null = null

export function getRawContext(): AudioContext {
  if (!rawContext) {
    rawContext = new AudioContext({ latencyHint: 'interactive' })
    Tone.setContext(new Tone.Context(rawContext))
  }
  return rawContext
}

export async function startAudio(): Promise<void> {
  const ctx = getRawContext()
  if (ctx.state !== 'running') await ctx.resume()
  if (!started) {
    await Tone.start()
    started = true
  }
}

export function audioStarted(): boolean {
  return started && rawContext?.state === 'running'
}

/** Current audio-clock time in seconds (the clock drills score against). */
export function audioNow(): number {
  return getRawContext().currentTime
}
