import { describe, expect, it } from 'vitest'
import {
  beatIndexAtMs, beatsToNextChange, chordAtMs, emptyCorrections, migrateCorrections,
  migrateSongMap, nextChordAfter, resolveTiming, sectionAtMs, sectionCorrectionKey,
  chordCorrectionKey, type SongMap,
} from '../songmap'

/** A tiny 2-section map: 120bpm (500ms beats), 4/4, chords on downbeats. */
function fixtureMap(): SongMap {
  const beats = Array.from({ length: 32 }, (_, i) => i * 500)
  return {
    version: 1,
    trackUri: 'spotify:track:test',
    trackName: 'Test Song',
    artistName: 'Testers',
    durationMs: 16_000,
    key: { root: 9, modeId: 'mixolydian', skeleton: 'major', confidence: 0.9 },
    sections: [
      { id: 'v1', label: 'V1', kind: 'verse', ordinal: 1, startMs: 0, endMs: 8000 },
      { id: 'ch1', label: 'CH1', kind: 'chorus', ordinal: 1, startMs: 8000, endMs: 16_000 },
    ],
    tempo: { bpm: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
    beats,
    downbeatIndices: [0, 4, 8, 12, 16, 20, 24, 28],
    chords: [
      { symbol: 'A', beatIndex: 0, ms: 0, durationBeats: 8, sectionId: 'v1', rootDegree: 0 },
      { symbol: 'G', beatIndex: 8, ms: 4000, durationBeats: 8, sectionId: 'v1', rootDegree: 10 },
      { symbol: 'D', beatIndex: 16, ms: 8000, durationBeats: 8, sectionId: 'ch1', rootDegree: 5 },
      { symbol: 'A', beatIndex: 24, ms: 12_000, durationBeats: 8, sectionId: 'ch1', rootDegree: 0 },
    ],
    provenance: {
      ug: { tabId: 1, url: 'https://example', versionLabel: 'v1', rating: 5, votes: 100, capo: 0, tonalityName: 'A', official: false },
      audio: { source: 'youtube', videoId: 'x', videoTitle: 'x', durationMs: 16_000, matchScore: 1 },
      analyzer: { name: 'allin1', version: '1.0' },
      fusion: { fusedAt: '2026-01-01T00:00:00Z', sectionAlignConfidence: 1, warnings: [] },
    },
  }
}

describe('resolveTiming', () => {
  it('is identity with no corrections', () => {
    const map = fixtureMap()
    const r = resolveTiming(map, null)
    expect(r.chords.map((c) => c.ms)).toEqual([0, 4000, 8000, 12_000])
    expect(r.sections.map((s) => s.startMs)).toEqual([0, 8000])
  })

  it('applies global, then section, then per-chord offsets cumulatively', () => {
    const map = fixtureMap()
    const c = emptyCorrections(map.trackUri)
    c.globalOffsetMs = 100
    c.sectionOffsets[sectionCorrectionKey('chorus', 1)] = 250
    c.chordNudges[chordCorrectionKey('chorus', 1, 1)] = 0.5 // second chorus chord, +half beat = +250ms
    const r = resolveTiming(map, c)
    expect(r.chords[0].ms).toBe(100) // global only
    expect(r.chords[2].ms).toBe(8350) // global + section
    expect(r.chords[3].ms).toBe(12_600) // global + section + 0.5 beat (250ms)
    expect(r.sections[1].startMs).toBe(8350)
    expect(r.sections[0].startMs).toBe(100) // section offset does not leak across sections
  })

  it('re-sorts chords if a nudge crosses a neighbor', () => {
    const map = fixtureMap()
    const c = emptyCorrections(map.trackUri)
    c.chordNudges[chordCorrectionKey('verse', 1, 1)] = -9 // G pulled 4.5s early, before A
    const r = resolveTiming(map, c)
    expect(r.chords[0].chordIndex).toBe(1)
    expect(r.chords.map((x) => x.ms)).toEqual([...r.chords.map((x) => x.ms)].sort((a, b) => a - b))
  })

  it('never mutates the map', () => {
    const map = fixtureMap()
    const before = JSON.stringify(map)
    const c = emptyCorrections(map.trackUri)
    c.globalOffsetMs = 999
    resolveTiming(map, c)
    expect(JSON.stringify(map)).toBe(before)
  })
})

describe('lookups', () => {
  const map = fixtureMap()
  const r = resolveTiming(map, null)

  it('chordAtMs binary search matches expectations at edges', () => {
    expect(chordAtMs(r, -1)).toBe(-1)
    expect(chordAtMs(r, 0)).toBe(0)
    expect(chordAtMs(r, 3999)).toBe(0)
    expect(chordAtMs(r, 4000)).toBe(1)
    expect(chordAtMs(r, 99_999)).toBe(3)
  })

  it('nextChordAfter returns -1 at the end', () => {
    expect(nextChordAfter(r, 0)).toBe(1)
    expect(nextChordAfter(r, 12_000)).toBe(-1)
  })

  it('sectionAtMs finds the sounding section', () => {
    expect(sectionAtMs(r, -5)).toBe(-1)
    expect(sectionAtMs(r, 100)).toBe(0)
    expect(sectionAtMs(r, 8000)).toBe(1)
    expect(sectionAtMs(r, 15_999)).toBe(1)
  })

  it('beatIndexAtMs snaps to the NEAREST beat', () => {
    expect(beatIndexAtMs(map, 0)).toBe(0)
    expect(beatIndexAtMs(map, 240)).toBe(0)
    expect(beatIndexAtMs(map, 260)).toBe(1)
    expect(beatIndexAtMs(map, 999_999)).toBe(31)
    expect(beatIndexAtMs(map, -50)).toBe(0)
  })

  it('beatsToNextChange counts down in whole beats', () => {
    expect(beatsToNextChange(r, map, 0)).toBe(8)
    expect(beatsToNextChange(r, map, 2000)).toBe(4)
    expect(beatsToNextChange(r, map, 3900)).toBe(0)
    expect(beatsToNextChange(r, map, 12_500)).toBeNull() // after last change
  })
})

describe('migrateSongMap', () => {
  it('accepts the fixture', () => {
    expect(migrateSongMap(fixtureMap())).not.toBeNull()
  })

  it('rejects wrong versions and structural damage', () => {
    expect(migrateSongMap(null)).toBeNull()
    expect(migrateSongMap({})).toBeNull()
    expect(migrateSongMap({ ...fixtureMap(), version: 2 })).toBeNull()
    expect(migrateSongMap({ ...fixtureMap(), beats: [100, 50] })).toBeNull() // not ascending
    expect(migrateSongMap({ ...fixtureMap(), key: { root: 13, modeId: 'x', skeleton: 'major' } })).toBeNull()
    expect(migrateSongMap({ ...fixtureMap(), tempo: { bpm: 0, meter: { beatsPerBar: 4, beatUnit: 4 } } })).toBeNull()
    const badChord = fixtureMap()
    badChord.chords[0] = { ...badChord.chords[0], ms: Number.NaN }
    expect(migrateSongMap(badChord)).toBeNull()
  })
})

describe('migrateCorrections', () => {
  it('round-trips an empty overlay', () => {
    const c = emptyCorrections('spotify:track:test')
    expect(migrateCorrections(JSON.parse(JSON.stringify(c)))).not.toBeNull()
  })
  it('rejects garbage', () => {
    expect(migrateCorrections(null)).toBeNull()
    expect(migrateCorrections({ version: 1, trackUri: 'x', globalOffsetMs: 'nope' })).toBeNull()
  })
})
