/**
 * Pitch-detection AudioWorklet — self-contained on purpose: worklet module
 * imports are unreliable across browsers, so the MPM implementation lives
 * inline. McLeod Pitch Method (NSDF + key-maximum picking), run over a
 * 2x-decimated signal (~24kHz): window 1024 (~43ms), hop 256 (~10.7ms),
 * lags spanning ~80Hz–1kHz. Posts {freq, clarity, rms, t} every hop.
 */

const WINDOW = 1024 // samples at decimated rate
const HOP = 256
const MIN_TAU = 22 // ~1090 Hz ceiling
const K_THRESHOLD = 0.9

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(WINDOW * 4)
    this.write = 0
    this.filled = 0
    this.sinceHop = 0
    this.carry = null // odd leftover sample for 2:1 decimation
    this.nsdf = new Float32Array(WINDOW / 2)
    this.decRate = sampleRate / 2
    this.maxTau = Math.min(WINDOW / 2 - 1, Math.floor(this.decRate / 78))
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true

    // Decimate 2:1 with pair averaging (crude anti-alias, fine for pitch).
    let i = 0
    if (this.carry !== null) {
      this.push((this.carry + ch[0]) * 0.5)
      this.carry = null
      i = 1
    }
    for (; i + 1 < ch.length; i += 2) this.push((ch[i] + ch[i + 1]) * 0.5)
    if (i < ch.length) this.carry = ch[i]

    while (this.sinceHop >= HOP && this.filled >= WINDOW) {
      this.sinceHop -= HOP
      this.analyze()
    }
    return true
  }

  push(s) {
    this.buf[this.write] = s
    this.write = (this.write + 1) % this.buf.length
    this.filled = Math.min(this.filled + 1, this.buf.length)
    this.sinceHop++
  }

  analyze() {
    const N = WINDOW
    const x = new Float32Array(N)
    let start = (this.write - N + this.buf.length) % this.buf.length
    for (let i = 0; i < N; i++) x[i] = this.buf[(start + i) % this.buf.length]

    let energy = 0
    for (let i = 0; i < N; i++) energy += x[i] * x[i]
    const rms = Math.sqrt(energy / N)
    if (rms < 1e-4) {
      this.port.postMessage({ freq: 0, clarity: 0, rms, t: currentTime })
      return
    }

    // NSDF: n(tau) = 2*acf(tau) / (m(tau))
    const nsdf = this.nsdf
    const maxTau = this.maxTau
    for (let tau = MIN_TAU; tau <= maxTau; tau++) {
      let acf = 0
      let m = 0
      for (let i = 0; i < N - tau; i++) {
        const a = x[i]
        const b = x[i + tau]
        acf += a * b
        m += a * a + b * b
      }
      nsdf[tau] = m > 0 ? (2 * acf) / m : 0
    }

    // Key-maximum picking: local maxima between positive-going zero crossings.
    const peaks = []
    let tau = MIN_TAU
    while (tau <= maxTau && nsdf[tau] > 0) tau++ // skip initial positive lobe
    for (; tau < maxTau; tau++) {
      if (nsdf[tau] <= 0) continue
      // inside a positive region: walk to its max
      let bestT = tau
      while (tau < maxTau && nsdf[tau + 1] >= 0) {
        tau++
        if (nsdf[tau] > nsdf[bestT]) bestT = tau
      }
      peaks.push(bestT)
    }
    if (peaks.length === 0) {
      this.port.postMessage({ freq: 0, clarity: 0, rms, t: currentTime })
      return
    }

    let highest = -Infinity
    for (const p of peaks) if (nsdf[p] > highest) highest = nsdf[p]
    const threshold = highest * K_THRESHOLD
    let chosen = peaks[0]
    for (const p of peaks) {
      if (nsdf[p] >= threshold) { chosen = p; break }
    }

    // Parabolic interpolation around the chosen lag.
    let t0 = chosen
    let delta = 0
    if (t0 > MIN_TAU && t0 < maxTau) {
      const a = nsdf[t0 - 1]
      const b = nsdf[t0]
      const c = nsdf[t0 + 1]
      const denom = 2 * (2 * b - a - c)
      if (Math.abs(denom) > 1e-12) delta = (c - a) / denom
    }
    const period = t0 + delta
    const freq = this.decRate / period
    this.port.postMessage({ freq, clarity: nsdf[chosen], rms, t: currentTime })
  }
}

registerProcessor('pitch-processor', PitchProcessor)
