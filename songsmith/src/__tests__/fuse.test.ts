import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PC } from '../../../src/music-core'
import { analyzerKindOf, fuse, type FuseInput } from '../fuse'
import { countSlots, estimateUnit, expandSheet } from '../layout'
import { parseSheet } from '../ug-parse'
import type { AnalyzerResult, SheetChord, SheetLine, UgChart, UgSection } from '../types'

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

function chordAt(symbol: string, col: number): SheetChord {
  return { symbol, raw: symbol, parseable: symbol !== '???', col }
}

function runLine(symbols: string[], repeat?: number): SheetLine {
  return {
    kind: 'run',
    chords: symbols.map((s, i) => chordAt(s, i * 8)),
    lyricLen: 0,
    chordLineLen: Math.max(1, symbols.length * 8),
    ...(repeat ? { repeat } : {}),
  }
}

function ugSection(label: string, kind: UgSection['kind'], ordinal: number, symbols: string[]): UgSection {
  return {
    label, kind, ordinal,
    chords: symbols.map((s) => ({ symbol: s, raw: s, parseable: s !== '???' })),
    lines: symbols.length > 0 ? [runLine(symbols)] : [],
  }
}

function ugFixture(sections: UgSection[], tonality: string | null = 'A'): UgChart {
  return {
    tabId: 42, url: 'https://u/42', versionLabel: 'v2 by picker42',
    rating: 4.8, votes: 312, capo: 0, tonalityName: tonality, official: false, sections,
  }
}

function fuseInput(ug: UgChart, analyzer: AnalyzerResult, durationMs = 64_000): FuseInput {
  return {
    trackUri: 'spotify:track:t', trackName: 'T', artistName: 'A', durationMs,
    ug, analyzer,
    audio: { source: 'youtube', videoId: 'v', videoTitle: 'T', durationMs, matchScore: 0.95 },
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

describe('estimateUnit', () => {
  it('picks the lattice unit nearest the bars-per-slot ratio', () => {
    expect(estimateUnit(50, 55, false).unit).toBe(1)
    expect(estimateUnit(179, 72, false).unit).toBe(0.5)
  })

  it('the asymmetric guard vetoes overrun even when the ratio prefers bigger (the Gravity rule)', () => {
    // ratio 121/41 ≈ 2.95 — argmin would say 4, but 41×4 > 121×1.15.
    expect(estimateUnit(41, 121, false).unit).toBe(2)
  })

  it("a doubled bare run ('G G') is direct 1-bar notation", () => {
    expect(estimateUnit(50, 69, true).unit).toBe(1)
  })

  it('flags compression when even the smallest unit overruns', () => {
    const r = estimateUnit(100, 20, false)
    expect(r.unit).toBe(0.5)
    expect(r.compressed).toBe(true)
  })
})

describe('expandSheet', () => {
  it('expands line and section repeats and hydrates empty same-kind sections', () => {
    const sections: UgSection[] = [
      { ...ugSection('Verse 1', 'verse', 1, ['A', 'G']), lines: [runLine(['A', 'G'], 2)] },
      { ...ugSection('Chorus', 'chorus', 1, ['D']), repeat: 2 },
      ugSection('Verse 2', 'verse', 2, []), // hydrates from Verse 1
    ]
    const plans = expandSheet(sections, null)
    expect(plans.map((p) => p.kind)).toEqual(['verse', 'chorus', 'verse'])
    expect(plans[0].lines).toHaveLength(2) // line ×2
    expect(plans[1].lines).toHaveLength(2) // section ×2
    expect(plans[2].lines).toHaveLength(2) // hydrated (incl. the line repeat)
    expect(countSlots(plans)).toBe(4 + 2 + 4)
  })

  it("'play the same for the following 2' triples the body; riff mentions hold the last chord", () => {
    const s: UgSection = {
      label: 'Intro/Verses', kind: 'intro', ordinal: 1,
      chords: [{ symbol: 'A', raw: 'A', parseable: true }],
      lines: [
        runLine(['A', 'D']),
        { kind: 'run', chords: [], lyricLen: 0, chordLineLen: 6, riffRef: 'riff 1' },
      ],
      playSameForNext: 2,
    }
    const plans = expandSheet([s], 'Em')
    expect(plans[0].lines).toHaveLength(6) // (chords + riff hold) × 3
    const holds = plans[0].lines.filter((l) => l.synthesized)
    expect(holds).toHaveLength(3)
    // The tonic wins over the last-seen chord: a named riff is the home
    // vamp, and the chord before it is usually a turnaround dominant.
    expect(holds[0].chords[0].symbol).toBe('Em')
  })
})

describe('fuse (synthetic)', () => {
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

  it('produces a well-formed SongMap in SHEET order with hydration', () => {
    const map = fuse(fuseInput(ug, analyzer))
    expect(map.version).toBe(1)
    expect(map.sections.map((s) => s.kind)).toEqual(['intro', 'verse', 'chorus', 'verse', 'outro'])
    expect(map.sections.map((s) => s.label)).toEqual(['INTRO', 'V1', 'CH1', 'V2', 'OUTRO'])
    expect(map.tempo.meter.beatsPerBar).toBe(4)
    const v2 = map.sections[3]
    const v2Chords = map.chords.filter((c) => c.sectionId === v2.id)
    expect(v2Chords.map((c) => c.symbol)).toEqual(['A', 'G', 'D', 'A'])
    // Every chord sits on a real beat with its denormalized ms, in order.
    for (const c of map.chords) {
      expect(map.beats[c.beatIndex]).toBe(c.ms)
      expect(c.durationBeats).toBeGreaterThan(0)
    }
    const beatIdx = map.chords.map((c) => c.beatIndex)
    expect([...beatIdx].sort((a, b) => a - b)).toEqual(beatIdx)
    // A–G–D over an A tonality hint: mixolydian, root A.
    expect(map.key.root).toBe(PC.A)
    expect(map.key.modeId).toBe('mixolydian')
    // Root degrees relative to A: A=0, G=10, D=5.
    const byName = new Map(map.chords.map((c) => [c.symbol, c.rootDegree]))
    expect(byName.get('A')).toBe(0)
    expect(byName.get('G')).toBe(10)
    expect(byName.get('D')).toBe(5)
    expect(map.provenance.fusion.sectionAlignConfidence).toBeGreaterThan(0.7)
  })

  it('flags unparseable chords in warnings', () => {
    const weird = ugFixture([ugSection('Intro', 'intro', 1, ['A', '???'])])
    const map = fuse(fuseInput(weird, analyzerFixture([{ startMs: 0, endMs: 16_000, label: 'intro' }], 16_000)))
    expect(map.provenance.fusion.warnings.some((w) => w.includes('???'))).toBe(true)
  })

  it('passes the frontend migrate gate', async () => {
    const { migrateSongMap } = await import('../../../src/integrations/spotify/songmap')
    const map = fuse(fuseInput(ug, analyzer))
    expect(migrateSongMap(JSON.parse(JSON.stringify(map)))).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The crown jewels: REAL charts + REAL (honest) analyzer grids, end to end.
// Expected timings are lyric-verified against the actual records.

interface RealCase {
  content: string
  capo: number
  tonalityName: string | null
  analyzer: AnalyzerResult
}

function loadCase(name: string): ReturnType<typeof fuse> {
  const f = JSON.parse(readFileSync(join(__dirname, `../__fixtures__/${name}-case.json`), 'utf8')) as RealCase
  const sections = parseSheet(f.content, f.capo)
  const ug: UgChart = {
    tabId: 1, url: 'x', versionLabel: 'v', rating: 5, votes: 100,
    capo: f.capo, tonalityName: f.tonalityName, official: false, sections,
  }
  const durationMs = f.analyzer.beatsMs[f.analyzer.beatsMs.length - 1]
  return fuse(fuseInput(ug, f.analyzer, durationMs))
}

describe('real-world pins', () => {
  it("Gravity: the sheet's form on the record's clock (lyric-verified)", () => {
    const map = loadCase('gravity')
    expect(map.key.root).toBe(PC.G)
    expect(map.key.modeId).toBe('ionian')
    expect(map.sections.map((s) => s.label)).toEqual(
      ['INTRO', 'CH1', 'V1', 'CH2', 'V2', 'SOLO', 'V3', 'CH3', 'OUTRO'])
    // Vocal entry ("Gravity is working against me") at 35.4s; verse ("Oh,
    // I'll never know") at 57.8s; solo at 2:03; outro vamp at 3:18.
    const starts = map.sections.map((s) => s.startMs)
    const expected = [1150, 36_000, 57_300, 76_600, 103_700, 123_000, 150_200, 179_200, 198_500]
    expected.forEach((ms, i) => expect(Math.abs(starts[i] - ms)).toBeLessThan(2500))
    const chordsOf = (i: number) => map.chords
      .filter((c) => c.sectionId === map.sections[i].id && c.beatIndex < map.beats.length)
      .map((c) => c.symbol)
    expect(chordsOf(1)).toEqual(['G', 'C', 'G', 'C']) // the chorus IS G–C
    expect(chordsOf(2)).toEqual(['Am7', 'D7', 'Gm/Bb', 'Ebmaj7', 'D7']) // the verse
    expect(map.provenance.fusion.sectionAlignConfidence).toBeGreaterThan(0.8)
  })

  it('Olivia: synthesized intro, sheet order, G ionian (no tonality field on the chart)', () => {
    const map = loadCase('olivia')
    expect(map.key.root).toBe(PC.G)
    expect(map.key.modeId).toBe('ionian')
    expect(map.sections.map((s) => s.label)).toEqual(
      ['INTRO', 'V1', 'CH1', 'V2', 'CH2', 'INST', 'V3', 'BR', 'OUTRO'])
    expect(map.sections[0].synthesized).toBe(true)
    const ch1 = map.chords.filter((c) => c.sectionId === map.sections[2].id).map((c) => c.symbol)
    expect(ch1).toEqual(['D', 'C', 'G'])
    // The written 12-chord instrumental lays out as written.
    const inst = map.chords.filter((c) => c.sectionId === map.sections[5].id).map((c) => c.symbol)
    expect(inst).toEqual(['G', 'C', 'G', 'G', 'C', 'C', 'G', 'G', 'D', 'C', 'G', 'G'])
    expect(map.provenance.fusion.sectionAlignConfidence).toBeGreaterThan(0.8)
  })
})
