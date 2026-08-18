import { describe, expect, it } from 'vitest'
import {
  applyTap, hasTimingEdits, nudgeChord, resetSection, resetTiming, shiftSection,
} from '../corrections'
import { shouldWrap } from '../use-section-loop'
import {
  emptyCorrections, resolveTiming, type SongMap,
} from '../songmap'

/** A tiny 2-section map: 120bpm 4/4, beats every 500ms.
 * V1 [0..8000): A@0 D@4000 · CH1 [8000..16000): G@8000 A@12000 */
function tinyMap(): SongMap {
  const beats: number[] = []
  for (let i = 0; i < 32; i++) beats.push(i * 500)
  return {
    version: 1,
    trackUri: 'spotify:track:tiny',
    trackName: 'Tiny',
    artistName: 'Test',
    durationMs: 16_000,
    key: { root: 9, modeId: 'mixolydian', skeleton: 'major', confidence: 0.9 },
    sections: [
      { id: 's0', label: 'V1', kind: 'verse', ordinal: 1, startMs: 0, endMs: 8000 },
      { id: 's1', label: 'CH1', kind: 'chorus', ordinal: 1, startMs: 8000, endMs: 16_000 },
    ],
    tempo: { bpm: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
    beats,
    downbeatIndices: [0, 4, 8, 12, 16, 20, 24, 28],
    chords: [
      { symbol: 'A', beatIndex: 0, ms: 0, durationBeats: 8, sectionId: 's0', rootDegree: 0 },
      { symbol: 'D', beatIndex: 8, ms: 4000, durationBeats: 8, sectionId: 's0', rootDegree: 5 },
      { symbol: 'G', beatIndex: 16, ms: 8000, durationBeats: 8, sectionId: 's1', rootDegree: 10 },
      { symbol: 'A', beatIndex: 24, ms: 12_000, durationBeats: 8, sectionId: 's1', rootDegree: 0 },
    ],
    provenance: {
      ug: { tabId: 1, url: 'x', versionLabel: 'v', rating: 5, votes: 1, capo: 0, tonalityName: null, official: false },
      audio: { source: 'youtube', videoId: 'x', videoTitle: 'x', durationMs: 16_000, matchScore: 1 },
      analyzer: { name: 'allin1', version: 'test' },
      fusion: { fusedAt: 'now', sectionAlignConfidence: 1, warnings: [] },
    },
  }
}

describe('applyTap', () => {
  const map = tinyMap()

  it('tapping late shifts the change section forward and records the tap', () => {
    const c = emptyCorrections(map.trackUri)
    const res = applyTap(c, map, resolveTiming(map, c), 8350, 111)
    expect(res).not.toBeNull()
    expect(res!.corrections.sectionOffsets['chorus:1']).toBe(350)
    expect(res!.record).toMatchObject({ ts: 111, atMs: 8350, appliedOffsetMs: 350, scope: { kind: 'chorus', ordinal: 1 } })
    // The verse the tap left behind is untouched.
    expect(res!.corrections.sectionOffsets['verse:1']).toBeUndefined()
  })

  it('tapping early attaches to the UPCOMING change (negative delta)', () => {
    const c = emptyCorrections(map.trackUri)
    const res = applyTap(c, map, resolveTiming(map, c), 7700, 0)
    expect(res!.corrections.sectionOffsets['chorus:1']).toBe(-300)
  })

  it('accumulates across taps so corrections converge', () => {
    let c = emptyCorrections(map.trackUri)
    c = applyTap(c, map, resolveTiming(map, c), 8350, 0)!.corrections
    // The chorus now resolves 350ms late; a second tap at 8500 is only
    // +150 relative to the corrected position.
    c = applyTap(c, map, resolveTiming(map, c), 8500, 0)!.corrections
    expect(c.sectionOffsets['chorus:1']).toBe(500)
    expect(c.taps).toHaveLength(2)
  })

  it('ignores a tap more than a bar from any change', () => {
    const c = emptyCorrections(map.trackUri)
    // One bar = 2000ms; 6000 is 2000 from both A@4000 and G@8000 — right at
    // the limit; 6100 is 2100 from D@4000 and 1900 from G@8000, fine; use a
    // point >2000 from everything: 2100 (2100 from A@0, 1900 from D@4000 — no).
    // The safe far point on this dense map needs |Δ|>2000 to the NEARER one:
    // impossible when changes are 4000 apart — so stretch: shift chorus far.
    const shifted = { ...c, sectionOffsets: { 'chorus:1': 3000 } }
    const res = applyTap(shifted, map, resolveTiming(map, shifted), 6900, 0)
    // nearest changes: D@4000 (Δ2900) and G@11000 (Δ-4100) → both beyond a bar.
    expect(res).toBeNull()
  })
})

describe('nudges, shifts and resets', () => {
  const map = tinyMap()

  it('nudgeChord writes half-beat steps keyed by section-relative position', () => {
    let c = emptyCorrections(map.trackUri)
    c = nudgeChord(c, map, 3, 1)   // second chord of the chorus
    c = nudgeChord(c, map, 3, 1)
    c = nudgeChord(c, map, 2, -1)  // first chord of the chorus
    expect(c.chordNudges['chorus:1:1']).toBe(1)
    expect(c.chordNudges['chorus:1:0']).toBe(-0.5)
    // Resolved order re-sorts: A@12000+1beat(500)=12500, G@8000-250=7750.
    const r = resolveTiming(map, c)
    expect(r.chords.map((x) => x.ms)).toEqual([0, 4000, 7750, 12_500])
  })

  it('resetSection clears the section offset and its chord nudges only', () => {
    let c = emptyCorrections(map.trackUri)
    c = shiftSection(c, map, 1, 250)
    c = nudgeChord(c, map, 2, 1)
    c = nudgeChord(c, map, 0, 1) // verse nudge survives
    c = resetSection(c, map, 1)
    expect(c.sectionOffsets['chorus:1']).toBeUndefined()
    expect(c.chordNudges['chorus:1:0']).toBeUndefined()
    expect(c.chordNudges['verse:1:0']).toBe(0.5)
  })

  it('resetTiming zeroes offsets but keeps taps and version picks', () => {
    let c = emptyCorrections(map.trackUri)
    c = applyTap(c, map, resolveTiming(map, c), 8350, 0)!.corrections
    c = { ...c, globalOffsetMs: 40, versionPick: { tabId: 7 } }
    expect(hasTimingEdits(c)).toBe(true)
    c = resetTiming(c)
    expect(hasTimingEdits(c)).toBe(false)
    expect(c.taps).toHaveLength(1)
    expect(c.versionPick).toEqual({ tabId: 7 })
  })
})

describe('shouldWrap (section loop)', () => {
  const start = 8000
  const end = 16_000

  it('wraps just before the boundary', () => {
    expect(shouldWrap(15_900, start, end, 0, 10_000)).toBe('wrap')
    expect(shouldWrap(15_000, start, end, 0, 10_000)).toBe('hold')
  })

  it('holds through the post-seek guard window', () => {
    expect(shouldWrap(15_900, start, end, 9800, 10_000)).toBe('hold')
  })

  it('cancels when the playhead escapes the loop neighborhood', () => {
    expect(shouldWrap(3000, start, end, 0, 10_000)).toBe('cancel')
    expect(shouldWrap(19_000, start, end, 0, 10_000)).toBe('cancel')
    expect(shouldWrap(7000, start, end, 0, 10_000)).toBe('hold') // within margin
  })
})
