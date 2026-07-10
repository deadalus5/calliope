import type { TimelineEvent } from '../../music-core'
import type { CompStyle, NoteSpec } from './types'
import { nextVoicing } from './voicing'

/**
 * Keys comping arranger v2. Pure function of (timeline, comp, beatsPerBar,
 * rng) — no Tone, no DOM, no Math.random. Replaces the old `arrangePiano`
 * in sequencer.ts, which had exactly two hardcoded patterns keyed off
 * `feel` and rebuilt an unrelated voicing every bar. Here every comp style
 * gets its own pattern, the voicing is carried (voice-led) across chord
 * changes via voicing.ts, and the "real comper" move — anticipating the
 * next chord a half-beat early — is modeled explicitly.
 */

interface RawHit {
  beat: number
  dur: number
  vel: number
  midis: number[]
}

const DYNAMICS_ARC = [0.92, 1, 0.95, 1.06]

function generateBarHits(comp: CompStyle, voicing: number[], rng: () => number): RawHit[] {
  const top2 = voicing.slice(-2)
  switch (comp) {
    case 'charleston': {
      const r = rng()
      if (r < 0.4) {
        return [
          { beat: 0, dur: 1.5, vel: 0.62, midis: voicing },
          { beat: 2.5, dur: 0.7, vel: 0.55, midis: voicing },
        ]
      }
      if (r < 0.75) {
        return [
          { beat: 0.5, dur: 0.7, vel: 0.6, midis: voicing },
          { beat: 2.5, dur: 0.7, vel: 0.5, midis: voicing },
        ]
      }
      return [
        { beat: 0, dur: 0.4, vel: 0.6, midis: voicing },
        { beat: 1.5, dur: 0.6, vel: 0.5, midis: voicing },
        { beat: 3.5, dur: 0.5, vel: 0.45, midis: voicing },
      ]
    }
    case 'soul-pads': {
      // dur clamped to beatsLeft by the caller (it knows the bar's remainder).
      const hits: RawHit[] = [{ beat: 0, dur: -1, vel: 0.5, midis: voicing }]
      if (rng() < 0.4) hits.push({ beat: 2.0, dur: 1.2, vel: 0.35, midis: top2 })
      return hits
    }
    case 'pop': {
      const hits: RawHit[] = [
        { beat: 0, dur: 1.9, vel: 0.55, midis: voicing },
        { beat: 2.0, dur: 1.4, vel: 0.48, midis: voicing },
      ]
      if (rng() < 0.3) hits.push({ beat: 3.5, dur: 0.4, vel: 0.45, midis: voicing })
      return hits
    }
    case 'neosoul': {
      const r = rng()
      const beat = r < 0.4 ? 1.5 : r < 0.75 ? 2.5 : 0.5
      return [{ beat, dur: 0.8, vel: 0.5, midis: voicing }]
    }
    case 'strum': {
      const hits: RawHit[] = [{ beat: 0, dur: 0.8, vel: 0.6, midis: voicing }]
      if (rng() < 0.8) hits.push({ beat: 1.5, dur: 0.5, vel: 0.45, midis: voicing })
      hits.push({ beat: 2.0, dur: 0.8, vel: 0.55, midis: voicing })
      if (rng() < 0.8) hits.push({ beat: 3.5, dur: 0.4, vel: 0.4, midis: voicing })
      return hits
    }
    case 'vamp': {
      const hits: RawHit[] = [{ beat: 0, dur: 2.4, vel: 0.55, midis: voicing }]
      if (rng() < 0.5) hits.push({ beat: 2.5, dur: 0.8, vel: 0.45, midis: voicing })
      return hits
    }
  }
}

export function arrangeKeys(
  timeline: TimelineEvent[],
  comp: CompStyle,
  beatsPerBar: number,
  rng: () => number,
): NoteSpec[] {
  const out: NoteSpec[] = []
  const n = timeline.length
  const anticipationP = comp === 'neosoul' ? 0.5 : 0.3

  let prevVoicing: number[] | null = null
  // Set by the previous chord's anticipation branch: this chord's voicing
  // was already voice-led and played early, so reuse it rather than
  // recomputing (and skip the reseat check — the anticipation already
  // freshly voice-led it).
  let forcedVoicing: number[] | null = null
  let suppressDownbeat = false

  for (let i = 0; i < n; i++) {
    const ev = timeline[i]
    const reseat = forcedVoicing === null && ev.bar % 8 === 0
    const voicing: number[] = forcedVoicing ?? nextVoicing(ev.chord, reseat ? null : prevVoicing)
    forcedVoicing = null

    const suppressThisDownbeat = suppressDownbeat
    suppressDownbeat = false

    const bars = Math.ceil(ev.durationBeats / beatsPerBar)
    const chordNotes: NoteSpec[] = []
    for (let barIdx = 0; barIdx < bars; barIdx++) {
      const barStart = barIdx * beatsPerBar
      const beatsLeft = ev.durationBeats - barStart
      const atBeat0 = ev.bar * beatsPerBar + ev.beat + barStart
      const absBar = ev.bar + barIdx
      const arcMul = DYNAMICS_ARC[absBar % 4]

      const hits = generateBarHits(comp, voicing, rng)
      for (const h of hits) {
        if (barIdx === 0 && suppressThisDownbeat && h.beat === 0) continue
        if (h.beat >= beatsLeft) continue // fewer beats left in the chord than the pattern wants
        const dur = h.dur === -1 ? Math.min(3.8, beatsLeft - 0.1) : h.dur
        chordNotes.push({ atBeat: atBeat0 + h.beat, midis: h.midis, durBeats: dur, vel: Math.min(1, h.vel * arcMul) })
      }
    }

    // Anticipation into the next chord — the real-comper push. Skipped at
    // the wraparound boundary (last event -> first event of the next loop
    // pass): that would require retroactively editing bars already emitted
    // at the top of this same call, which a single linear pass can't do.
    if (i < n - 1) {
      const next = timeline[i + 1]
      const changes = next.chord.root !== ev.chord.root || next.chord.quality.id !== ev.chord.quality.id
      if (changes && rng() < anticipationP) {
        const changeBeat = ev.bar * beatsPerBar + ev.beat + ev.durationBeats
        for (let k = chordNotes.length - 1; k >= 0; k--) {
          const t = chordNotes[k].atBeat
          if (t >= changeBeat - 0.5 && t < changeBeat) chordNotes.splice(k, 1)
        }
        const nextVoi = nextVoicing(next.chord, voicing)
        chordNotes.push({ atBeat: changeBeat - 0.5, midis: nextVoi, durBeats: 1.6, vel: 0.58, anticipation: true })
        forcedVoicing = nextVoi
        suppressDownbeat = true
      }
    }

    out.push(...chordNotes)
    prevVoicing = voicing
  }

  out.sort((a, b) => a.atBeat - b.atBeat)
  return out
}
