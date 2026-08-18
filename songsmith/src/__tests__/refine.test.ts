import { describe, expect, it } from 'vitest'
import { applyRefinement, buildRefineRequest, type RefineResponse } from '../refine'
import type { SongMap } from '../../../src/integrations/spotify/songmap'

function map(): SongMap {
  const beats: number[] = []
  for (let i = 0; i < 32; i++) beats.push(i * 500)
  return {
    version: 1,
    trackUri: 'spotify:track:refine',
    trackName: 'R', artistName: 'T', durationMs: 16_000,
    key: { root: 9, modeId: 'ionian', skeleton: 'major', confidence: 0.8 },
    sections: [
      { id: 's0', label: 'V1', kind: 'verse', ordinal: 1, startMs: 0, endMs: 8000 },
      { id: 's1', label: 'CH1', kind: 'chorus', ordinal: 1, startMs: 8000, endMs: 16_000 },
    ],
    tempo: { bpm: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
    beats,
    downbeatIndices: [0, 4, 8, 12, 16, 20, 24, 28],
    chords: [
      { symbol: 'A', beatIndex: 0, ms: 0, durationBeats: 8, sectionId: 's0', rootDegree: 0 },
      { symbol: 'Xyz9!!', beatIndex: 4, ms: 2000, durationBeats: 4, sectionId: 's0', rootDegree: 0 },
      { symbol: 'D', beatIndex: 8, ms: 4000, durationBeats: 8, sectionId: 's0', rootDegree: 5 },
      { symbol: 'E7', beatIndex: 16, ms: 8000, durationBeats: 16, sectionId: 's1', rootDegree: 7 },
    ],
    provenance: {
      ug: { tabId: 1, url: 'x', versionLabel: 'v', rating: 5, votes: 1, capo: 0, tonalityName: null, official: false },
      audio: { source: 'youtube', videoId: 'x', videoTitle: 'x', durationMs: 16_000, matchScore: 1 },
      analyzer: { name: 'allin1', version: 'test' },
      fusion: { fusedAt: 'now', sectionAlignConfidence: 1, warnings: [] },
    },
  }
}

describe('buildRefineRequest', () => {
  it('carries pcs per chord, skips unparseable symbols, maps sections to beats', () => {
    const req = buildRefineRequest(map(), '/x/audio.m4a')
    expect(req.audio).toBe('/x/audio.m4a')
    expect(req.bandBeats).toBe(2)
    expect(req.sections).toEqual([
      { startBeat: 0, endBeat: 16 },
      { startBeat: 16, endBeat: 31 }, // 16000ms clamps to the last beat
    ])
    // The unparseable chord (global index 1) casts no vote.
    expect(req.chords.map((c) => c.i)).toEqual([0, 2, 3])
    const a = req.chords[0]
    expect(a).toMatchObject({ sectionIdx: 0, beatIndex: 0, rootPc: 9 })
    expect(a.pcs).toEqual([9, 1, 4])
    expect(req.chords[2]).toMatchObject({ i: 3, sectionIdx: 1, rootPc: 4 })
  })
})

describe('applyRefinement', () => {
  const at = '2026-08-18T00:00:00.000Z'

  it('rewrites beatIndex/ms, recomputes durations, stamps provenance', () => {
    const res: RefineResponse = {
      ok: true,
      refined: [{ i: 0, beatIndex: 0 }, { i: 2, beatIndex: 9 }, { i: 3, beatIndex: 17 }],
      confidence: 0.8, meanAbsShiftBeats: 0.5, error: null,
    }
    const out = applyRefinement(map(), res, at)
    expect(out).not.toBeNull()
    const byIdx = out!.chords
    // Re-sorted ascending; the unparseable chord kept its fused spot.
    expect(byIdx.map((c) => [c.symbol, c.beatIndex, c.ms])).toEqual([
      ['A', 0, 0], ['Xyz9!!', 4, 2000], ['D', 9, 4500], ['E7', 17, 8500],
    ])
    expect(byIdx.map((c) => c.durationBeats)).toEqual([4, 5, 8, 15])
    expect(out!.provenance.refined).toEqual({ method: 'chroma-dtw', at })
    // Non-mutating.
    expect(map().chords[2].beatIndex).toBe(8)
  })

  it('refuses on low confidence, wild shifts, or errors — the fused map stands', () => {
    const good: RefineResponse = { ok: true, refined: [], confidence: 0.8, meanAbsShiftBeats: 0.2, error: null }
    expect(applyRefinement(map(), { ...good, confidence: 0.4 }, at)).toBeNull()
    expect(applyRefinement(map(), { ...good, meanAbsShiftBeats: 2.1 }, at)).toBeNull()
    expect(applyRefinement(map(), { ...good, ok: false }, at)).toBeNull()
  })
})
