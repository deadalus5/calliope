import * as Tone from 'tone'
import { pickLayer, pickRR, type LayerSpec } from './drum-math'

/**
 * Multisampled drum playback: velocity layers + round robins + hi-hat choke
 * groups, replacing the single shared Player/Gain of DrumHit (whose
 * setValueAtTime re-levels a still-ringing previous hit). Each trigger gets
 * its own disposable Gain+ToneBufferSource pair so overlapping hits never
 * fight over one gain node.
 */

export interface KitArticulation {
  gain: number            // dB trim
  pan?: number            // -1..1
  sendDb?: number         // reverb send level, consumed by the mixer in Task 3
  choke?: string          // choke group name (e.g. 'hat')
  chokeable?: boolean     // true = this voice gets cut by others in its group
  layers: LayerSpec[]     // ascending maxVel
}

export interface KitManifest {
  id: string
  articulations: Record<string, KitArticulation>
}

export class DrumVoice {
  readonly out: Tone.Gain
  readonly spec: KitArticulation
  private buffers: Tone.ToneAudioBuffer[][] // [layer][rr]
  private lastRR = -1
  private live: Tone.ToneBufferSource[] = []

  constructor(spec: KitArticulation, buffers: Tone.ToneAudioBuffer[][]) {
    this.spec = spec
    this.buffers = buffers
    this.out = new Tone.Gain(Tone.dbToGain(spec.gain))
  }

  trigger(time: number, vel = 1): void {
    try {
      const layerIdx = pickLayer(this.spec.layers, vel)
      const rrBuffers = this.buffers[layerIdx]
      if (!rrBuffers || rrBuffers.length === 0) return
      const rrIdx = pickRR(rrBuffers.length, this.lastRR, Math.random)
      this.lastRR = rrIdx
      const buffer = rrBuffers[rrIdx]
      if (!buffer.loaded) return

      const g = new Tone.Gain(Math.pow(vel, 1.4)).connect(this.out)
      const src = new Tone.ToneBufferSource(buffer).connect(g)
      src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.01
      src.onended = () => {
        src.dispose()
        g.dispose()
        const i = this.live.indexOf(src)
        if (i >= 0) this.live.splice(i, 1)
      }
      this.live.push(src)
      src.start(time)
    } catch {
      // buffer not loaded / out-of-order transport handoff — drop the hit
    }
  }

  choke(time: number): void {
    for (const src of this.live) {
      try {
        src.stop(time + 0.03)
      } catch {
        // already stopped — ignore
      }
    }
    this.live = []
  }

  dispose(): void {
    for (const src of this.live) {
      try {
        src.dispose()
      } catch {
        // already disposed — ignore
      }
    }
    this.live = []
    this.out.dispose()
  }
}

const kitCache = new Map<string, Promise<DrumKit>>()

export class DrumKit {
  readonly id: string
  readonly ready: Promise<void>
  private voicesByName = new Map<string, DrumVoice>()
  private warned = new Set<string>()

  private constructor(manifest: KitManifest, baseUrl: string) {
    this.id = manifest.id
    const loads: Promise<void>[] = []

    for (const [name, spec] of Object.entries(manifest.articulations)) {
      const buffers: Tone.ToneAudioBuffer[][] = spec.layers.map((layer) =>
        layer.rr.map((file) => {
          const buf = new Tone.ToneAudioBuffer()
          loads.push(buf.load(`${baseUrl}/${file}`).then(() => {}))
          return buf
        }),
      )
      this.voicesByName.set(name, new DrumVoice(spec, buffers))
    }

    this.ready = Promise.all(loads).then(() => {})
  }

  static async load(id: string): Promise<DrumKit> {
    const baseUrl = `/samples/kits/${id}`
    const res = await fetch(`${baseUrl}/kit.json`)
    if (!res.ok) throw new Error(`kit manifest fetch failed: ${res.status} ${res.statusText}`)
    const manifest: KitManifest = await res.json()
    const kit = new DrumKit(manifest, baseUrl)
    await kit.ready
    return kit
  }

  trigger(articulation: string, time: number, vel = 1): void {
    const voice = this.voicesByName.get(articulation)
    if (!voice) {
      if (!this.warned.has(articulation)) {
        this.warned.add(articulation)
        console.warn(`DrumKit "${this.id}": unknown articulation "${articulation}"`)
      }
      return
    }
    const { choke, chokeable } = voice.spec
    if (choke && !chokeable) {
      for (const other of this.voicesByName.values()) {
        if (other.spec.choke === choke && other.spec.chokeable) other.choke(time)
      }
    }
    voice.trigger(time, vel)
  }

  voice(articulation: string): DrumVoice | undefined {
    return this.voicesByName.get(articulation)
  }

  voices(): Iterable<[string, DrumVoice]> {
    return this.voicesByName.entries()
  }

  dispose(): void {
    for (const voice of this.voicesByName.values()) voice.dispose()
  }
}

/** Module-level cache: repeat calls for the same kit id return the same instance. */
export function loadKit(id: string): Promise<DrumKit> {
  let cached = kitCache.get(id)
  if (!cached) {
    cached = DrumKit.load(id)
    kitCache.set(id, cached)
    cached.catch(() => kitCache.delete(id))
  }
  return cached
}
