import { describe, expect, it } from 'vitest'
import { PC } from '../../../src/music-core'
import { alignSections, analyzerKindOf, distributeChords, fuse, type FuseInput } from '../fuse'
import type { AnalyzerResult, UgChart, UgSection } from '../types'

/** 120bpm 4/4 grid: beats every 500ms, downbeats every 2s. */
function analyzerFixture(segments: { startMs: number; endMs: number; label: string }[], totalMs = 64_000): AnalyzerResult {
  const beatsMs: number[] = []
  const downbeatsMs: number[] = []
  const beatPositions: number[] = []
  for (let ms = 0, i = 0; ms < totalMs; ms += 500, i++) {
    beatsMs.push(ms)
    beatPositions.push((i % 4) + 1)
    if (i % 4 === 0) downbeatsMs.push(ms)
  }
  return { bpm: 120, beatsMs, downbeatsMs, beatPositions, segments }
}

function ugSection(label: string, kind: UgSection['kind'], ordinal: number, symbols: string[]): UgSection {
  return { label, kind, ordinal, chords: symbols.map((s) => ({ symbol: s, raw: s, parseable: s !== '???' })) }
}

function ugFixture(sections: UgSection[], tonality: string | null = 'A'): UgChart {
  return {
    tabId: 42, url: 'https://u/42', versionLabel: 'v2 by picker42',
    rating: 4.8, votes: 312, capo: 0, tonalityName: tonality, official: false, sections,
  }
}

function fuseInput(ug: UgChart, analyzer: AnalyzerResult): FuseInput {
  return {
    trackUri: 'spotify:track:t', trackName: 'T', artistName: 'A', durationMs: 64_000,
    ug, analyzer,
    audio: { source: 'youtube', videoId: 'v', videoTitle: 'T', durationMs: 64_000, matchScore: 0.95 },
    analyzerName: 'allin1', analyzerVersion: '1.1.0',
    now: '2026-07-17T00:00:00.000Z',
  }
}

describe('analyzerKindOf', () => {
  it('maps allin1 labels to the kind enum', () => {
    expect(analyzerKindOf('start')).toBe('intro')
    expect(analyzerKindOf('end')).toBe('outro')
    expect(analyzerKindOf('break')).toBe('inst')
    expect(analyzerKindOf('chorus')).toBe('chorus')
    expect(analyzerKindOf('mystery')).toBe('other')
  })
})

describe('distributeChords', () => {
  it('spreads n chords across m slots evenly', () => {
    expect(distributeChords([0, 4, 8, 12], 4)).toEqual([0, 4, 8, 12])
    expect(distributeChords([0, 4, 8, 12], 2)).toEqual([0, 8])
    expect(distributeChords([0, 4], 1)).toEqual([0])
  })

  it('never stacks two chords on one slot when slots remain', () => {
    expect(distributeChords([0, 4, 8], 3)).toEqual([0, 4, 8])
    const out = distributeChords([0, 4], 2)
    expect(new Set(out).size).toBe(2)
  })

  it('handles empty inputs', () => {
    expect(distributeChords([], 3)).toEqual([])
    expect(distributeChords([0, 4], 0)).toEqual([])
  })
})

describe('alignSections', () => {
  it('pairs same-kind sections in order', () => {
    const analyzer = analyzerFixture([
      { startMs: 0, endMs: 8000, label: 'intro' },
      { startMs: 8000, endMs: 24_000, label: 'verse' },
      { startMs: 24_000, endMs: 40_000, label: 'chorus' },
    ])
    const ug = [
      ugSection('Intro', 'intro', 1, ['A']),
      ugSection('Verse 1', 'verse', 1, ['A', 'G']),
      ugSection('Chorus', 'chorus', 1, ['D', 'A']),
    ]
    const aligned = alignSections(analyzer, ug)
    expect(aligned.map((a) => a.ug?.label)).toEqual(['Intro', 'Verse 1', 'Chorus'])
    expect(aligned.every((a) => a.kindMatched)).toBe(true)
  })

  it('holds UG when the analyzer hears an extra segment', () => {
    const analyzer = analyzerFixture([
      { startMs: 0, endMs: 8000, label: 'verse' },
      { startMs: 8000, endMs: 12_000, label: 'break' }, // UG never wrote this
      { startMs: 12_000, endMs: 20_000, label: 'chorus' },
    ])
    const ug = [
      ugSection('Verse 1', 'verse', 1, ['A', 'G']),
      ugSection('Chorus', 'chorus', 1, ['D', 'A']),
    ]
    const aligned = alignSections(analyzer, ug)
    expect(aligned[1].ug).toBeNull()
    expect(aligned[2].ug?.label).toBe('Chorus')
  })

  it('skips a UG section the analyzer merged away', () => {
    const analyzer = analyzerFixture([
      { startMs: 0, endMs: 8000, label: 'verse' },
      { startMs: 8000, endMs: 16_000, label: 'chorus' },
    ])
    const ug = [
      ugSection('Verse 1', 'verse', 1, ['A', 'G']),
      ugSection('Pre-Chorus', 'other', 1, ['E']), // 'other' is compatible with anything…
      ugSection('Chorus', 'chorus', 1, ['D', 'A']),
    ]
    const aligned = alignSections(analyzer, ug)
    // 'other' pairs with chorus-segment (compatible), chorus is left over — order preserved.
    expect(aligned).toHaveLength(2)
    expect(aligned[0].ug?.label).toBe('Verse 1')
  })
})

describe('fuse', () => {
  const analyzer = analyzerFixture([
    { startMs: 0, endMs: 8000, label: 'intro' },
    { startMs: 8000, endMs: 24_000, label: 'verse' },
    { startMs: 24_000, endMs: 40_000, label: 'chorus' },
    { startMs: 40_000, endMs: 56_000, label: 'verse' },
    { startMs: 56_000, endMs: 64_000, label: 'end' },
  ])
  const ug = ugFixture([
    ugSection('Intro', 'intro', 1, ['A', 'G', 'D', 'A']),
    ugSection('Verse 1', 'verse', 1, ['A', 'G', 'D', 'A']),
    ugSection('Chorus', 'chorus', 1, ['D', 'A', 'G', 'A']),
    ugSection('Verse 2', 'verse', 2, []), // hydrated from Verse 1
    ugSection('Outro', 'outro', 1, ['A', 'G', 'D', 'A']),
  ])

  it('produces a valid, well-formed SongMap', () => {
    const map = fuse(fuseInput(ug, analyzer))
    expect(map.version).toBe(1)
    expect(map.sections.map((s) => s.kind)).toEqual(['intro', 'verse', 'chorus', 'verse', 'outro'])
    expect(map.sections.map((s) => s.label)).toEqual(['INTRO', 'V1', 'CH1', 'V2', 'OUTRO'])
    expect(map.tempo.meter.beatsPerBar).toBe(4)
    // Verse 2 inherited Verse 1's chords.
    const v2 = map.sections[3]
    const v2Chords = map.chords.filter((c) => c.sectionId === v2.id)
    expect(v2Chords.map((c) => c.symbol)).toEqual(['A', 'G', 'D', 'A'])
    // Every chord sits on a real beat with its denormalized ms.
    for (const c of map.chords) {
      expect(map.beats[c.beatIndex]).toBe(c.ms)
      expect(c.durationBeats).toBeGreaterThan(0)
    }
    // A–G–D over an A tonality hint: mixolydian, root A.
    expect(map.key.root).toBe(PC.A)
    expect(map.key.modeId).toBe('mixolydian')
    expect(map.key.skeleton).toBe('major')
    // Root degrees relative to A: A=0, G=10, D=5.
    const byName = new Map(map.chords.map((c) => [c.symbol, c.rootDegree]))
    expect(byName.get('A')).toBe(0)
    expect(byName.get('G')).toBe(10)
    expect(byName.get('D')).toBe(5)
    expect(map.provenance.fusion.sectionAlignConfidence).toBe(1)
    expect(map.provenance.fusion.warnings).toEqual([])
  })

  it('chords land on downbeats spread across each segment', () => {
    const map = fuse(fuseInput(ug, analyzer))
    const downbeatSet = new Set(map.downbeatIndices)
    for (const c of map.chords) expect(downbeatSet.has(c.beatIndex)).toBe(true)
    // Verse 1: 16s segment = 8 bars, 4 chords → every 2 bars.
    const v1 = map.chords.filter((c) => c.sectionId === map.sections[1].id)
    expect(v1.map((c) => c.ms)).toEqual([8000, 12_000, 16_000, 20_000])
  })

  it('flags unparseable chords and low alignment in warnings', () => {
    const weird = ugFixture([ugSection('Verse 1', 'verse', 1, ['A', '???'])])
    const mismatch = analyzerFixture([
      { startMs: 0, endMs: 8000, label: 'chorus' },
      { startMs: 8000, endMs: 16_000, label: 'solo' },
    ])
    const map = fuse(fuseInput(weird, mismatch))
    expect(map.provenance.fusion.warnings.some((w) => w.includes('???'))).toBe(true)
    expect(map.provenance.fusion.sectionAlignConfidence).toBeLessThan(0.6)
  })

  it('passes the frontend migrate gate', async () => {
    const { migrateSongMap } = await import('../../../src/integrations/spotify/songmap')
    const map = fuse(fuseInput(ug, analyzer))
    expect(migrateSongMap(JSON.parse(JSON.stringify(map)))).not.toBeNull()
  })
})
