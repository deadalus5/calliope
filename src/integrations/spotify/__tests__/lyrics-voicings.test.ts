import { describe, expect, it } from 'vitest'
import { lineAtMs, parseLrc, placeChords } from '../lrc'
import { ugVoicingToShape } from '../voicing-render'
import { resolveTiming, type SongMap } from '../songmap'

const LRC = `[ar:Test]
[00:10.00]first line here
[00:14.50]second line
[00:20.00][00:40.00]repeated hook
[00:25.00]
`

describe('parseLrc', () => {
  it('parses timestamps, skips metadata, expands multi-stamp lines, sorts', () => {
    const lines = parseLrc(LRC)
    expect(lines.map((l) => l.ms)).toEqual([10_000, 14_500, 20_000, 25_000, 40_000])
    expect(lines[0].text).toBe('first line here')
    expect(lines[2].text).toBe('repeated hook')
    expect(lines[4].text).toBe('repeated hook')
    expect(lines[3].text).toBe('')
  })

  it('lineAtMs binary-searches the sounding line', () => {
    const lines = parseLrc(LRC)
    expect(lineAtMs(lines, 5000)).toBe(-1)
    expect(lineAtMs(lines, 12_000)).toBe(0)
    expect(lineAtMs(lines, 14_500)).toBe(1)
    expect(lineAtMs(lines, 99_000)).toBe(4)
  })
})

function tinyMap(): SongMap {
  const beats: number[] = []
  for (let i = 0; i < 64; i++) beats.push(i * 500)
  return {
    version: 1,
    trackUri: 'spotify:track:lyr', trackName: 'L', artistName: 'T', durationMs: 32_000,
    key: { root: 0, modeId: 'ionian', skeleton: 'major', confidence: 0.9 },
    sections: [{ id: 's0', label: 'V1', kind: 'verse', ordinal: 1, startMs: 0, endMs: 32_000 }],
    tempo: { bpm: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
    beats,
    downbeatIndices: [0, 4, 8],
    chords: [
      { symbol: 'C', beatIndex: 22, ms: 11_000, durationBeats: 6, sectionId: 's0', rootDegree: 0 },
      { symbol: 'F', beatIndex: 28, ms: 14_000, durationBeats: 4, sectionId: 's0', rootDegree: 5 },
      { symbol: 'G', beatIndex: 32, ms: 16_000, durationBeats: 8, sectionId: 's0', rootDegree: 7 },
    ],
    provenance: {
      ug: { tabId: 1, url: 'x', versionLabel: 'v', rating: 5, votes: 1, capo: 0, tonalityName: null, official: false },
      audio: { source: 'youtube', videoId: 'x', videoTitle: 'x', durationMs: 32_000, matchScore: 1 },
      analyzer: { name: 'allin1', version: 'test' },
      fusion: { fusedAt: 'now', sectionAlignConfidence: 1, warnings: [] },
    },
  }
}

describe('placeChords', () => {
  it('attaches each chord to the line whose span holds its RESOLVED ms, with a time fraction', () => {
    const lines = parseLrc('[00:10.00]line one\n[00:14.50]line two\n[00:20.00]line three\n')
    const map = tinyMap()
    const placed = placeChords(lines, resolveTiming(map, null), map)
    // C@11000 and F@14000 both sit in line 0's span [10000, 14500);
    // C at (11000-10000)/4500 ≈ 0.222. G@16000 → line 1.
    expect(placed[0].map((p) => p.symbol)).toEqual(['C', 'F'])
    expect(placed[0][0].frac).toBeCloseTo(0.222, 2)
    expect(placed[1].map((p) => p.symbol)).toEqual(['G'])
    // Corrections shift chords across lines: +700ms pushes F onto line two.
    const shifted = resolveTiming(map, {
      version: 1, trackUri: map.trackUri, globalOffsetMs: 700, sectionOffsets: {}, chordNudges: {}, taps: [],
    })
    const placed2 = placeChords(lines, shifted, map)
    expect(placed2[1].map((p) => p.symbol)).toEqual(['F', 'G'])
  })
})

describe('ugVoicingToShape', () => {
  it('renders a legit UG grip (open G) with degrees and the root string ringed', () => {
    const shape = ugVoicingToShape('G', { frets: [3, 2, 0, 0, 0, 3], baseFret: 2 })
    expect(shape).not.toBeNull()
    expect(shape!.coords).toHaveLength(6)
    expect(shape!.rootString).toBe(0) // low E fret 3 = G, the true root
    expect(shape!.degrees[0]).toBe(0)
    expect(shape!.baseFret).toBe(2)
  })

  it('accepts inverted grips shapeFromFrets would reject (lenient by design)', () => {
    // D/F#-ish: F# in the bass — not a root-bass shape, still a real grip.
    const shape = ugVoicingToShape('D', { frets: [2, -1, 0, 2, 3, 2], baseFret: 2 })
    expect(shape).not.toBeNull()
    expect(shape!.degrees[0]).not.toBe(0)
  })

  it('rejects unparseable symbols, short arrays, off-board frets', () => {
    expect(ugVoicingToShape('X??', { frets: [0, 0, 0, 0, 0, 0], baseFret: 1 })).toBeNull()
    expect(ugVoicingToShape('G', { frets: [3, 2], baseFret: 1 })).toBeNull()
    expect(ugVoicingToShape('G', { frets: [19, -1, -1, -1, -1, 19], baseFret: 19 })).toBeNull()
    expect(ugVoicingToShape('G', { frets: [-1, -1, -1, -1, -1, 3], baseFret: 3 })).toBeNull() // one note isn't a grip
  })
})
