import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The worklet is self-contained JS with worklet globals — stub them, eval
 * the file, and drive process() with synthetic signals to verify the MPM
 * detector: pure tones, and harmonic-rich (guitar-like) waves at low E
 * where naive autocorrelation octave-errors.
 */

const SAMPLE_RATE = 48000

interface Frame { freq: number; clarity: number; rms: number; t: number }

function makeDetector(): { feed: (samples: Float32Array) => void; frames: Frame[] } {
  const src = readFileSync(resolve(__dirname, '../../../public/pitch-processor.js'), 'utf8')
  const frames: Frame[] = []
  let processorClass: any
  const sandbox = {
    sampleRate: SAMPLE_RATE,
    currentTime: 0,
    AudioWorkletProcessor: class {
      port = { postMessage: (m: Frame) => frames.push(m) }
    },
    registerProcessor: (_name: string, cls: any) => { processorClass = cls },
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(...Object.keys(sandbox), src)(...Object.values(sandbox))
  const proc = new processorClass()
  return {
    frames,
    feed: (samples: Float32Array) => {
      for (let i = 0; i < samples.length; i += 128) {
        proc.process([[samples.subarray(i, i + 128)]])
      }
    },
  }
}

function sine(freq: number, seconds: number, amp = 0.3): Float32Array {
  const n = Math.floor(SAMPLE_RATE * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)
  return out
}

/** Guitar-ish: strong 2nd/3rd harmonics that trip naive ACF into octave errors. */
function pluckish(freq: number, seconds: number): Float32Array {
  const n = Math.floor(SAMPLE_RATE * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * freq * i) / SAMPLE_RATE
    out[i] = 0.25 * Math.sin(t) + 0.22 * Math.sin(2 * t) + 0.15 * Math.sin(3 * t) + 0.08 * Math.sin(4 * t)
  }
  return out
}

function centsOff(freq: number, target: number): number {
  return Math.abs(1200 * Math.log2(freq / target))
}

function settledFrames(frames: Frame[]): Frame[] {
  // Skip the fill-up and take the back half, where the window is full signal.
  return frames.slice(Math.floor(frames.length / 2)).filter((f) => f.freq > 0)
}

describe('pitch worklet (MPM)', () => {
  it.each([
    ['A2 (open A)', 110],
    ['E2 (low E)', 82.41],
    ['A4 (sung note)', 440],
    ['E4 (high e open)', 329.63],
  ])('detects a %s sine within 10 cents', (_label, freq) => {
    const d = makeDetector()
    d.feed(sine(freq, 0.5))
    const good = settledFrames(d.frames)
    expect(good.length).toBeGreaterThan(5)
    for (const f of good) {
      expect(centsOff(f.freq, freq)).toBeLessThan(10)
      expect(f.clarity).toBeGreaterThan(0.9)
    }
  })

  it('does not octave-error on harmonic-rich low E (the guitar trap)', () => {
    const d = makeDetector()
    d.feed(pluckish(82.41, 0.6))
    const good = settledFrames(d.frames)
    expect(good.length).toBeGreaterThan(5)
    let correct = 0
    for (const f of good) if (centsOff(f.freq, 82.41) < 20) correct++
    // Allow an occasional flicker (the tracker's median kills those), but
    // the fundamental must dominate.
    expect(correct / good.length).toBeGreaterThan(0.9)
  })

  it('reports silence as freq 0 with low rms', () => {
    const d = makeDetector()
    d.feed(new Float32Array(SAMPLE_RATE / 2))
    const frames = d.frames
    expect(frames.length).toBeGreaterThan(0)
    for (const f of frames) {
      expect(f.freq).toBe(0)
      expect(f.rms).toBeLessThan(1e-3)
    }
  })

  it('tracks a note change (sing a 5th up)', () => {
    const d = makeDetector()
    d.feed(sine(220, 0.3))
    const before = d.frames.length
    d.feed(sine(330, 0.3))
    const after = d.frames.slice(before + 6).filter((f) => f.freq > 0)
    const last = after.slice(-5)
    for (const f of last) expect(centsOff(f.freq, 330)).toBeLessThan(15)
  })
})
