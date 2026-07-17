import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractJsStore, normalizeUgSymbol, parseSearchPage, parseSheet, parseTabPage,
  sectionKindOf, transposeSymbol,
} from '../ug-parse'

const store = JSON.parse(
  readFileSync(join(__dirname, '../__fixtures__/ug-tab-store.json'), 'utf8'),
)

describe('extractJsStore', () => {
  it('pulls and entity-decodes the data-content JSON', () => {
    const html = `<html><body><div class="js-store" data-content="{&quot;store&quot;:{&quot;page&quot;:1}}"></div></body></html>`
    expect(extractJsStore(html)).toEqual({ store: { page: 1 } })
  })

  it('throws a recognizable error on a challenge/foreign page', () => {
    expect(() => extractJsStore('<html>Checking your browser…</html>')).toThrow(/js-store/)
  })
})

describe('sectionKindOf', () => {
  it('normalizes the usual header spellings', () => {
    expect(sectionKindOf('Intro')).toBe('intro')
    expect(sectionKindOf('Verse 2')).toBe('verse')
    expect(sectionKindOf('Chorus')).toBe('chorus')
    expect(sectionKindOf('Pre-Chorus')).toBe('other')
    expect(sectionKindOf('Guitar Solo')).toBe('solo')
    expect(sectionKindOf('Interlude')).toBe('inst')
    expect(sectionKindOf('Outro')).toBe('outro')
    expect(sectionKindOf('Bridge')).toBe('bridge')
    expect(sectionKindOf('Weird Part')).toBe('other')
  })
})

describe('normalizeUgSymbol / transposeSymbol', () => {
  it('maps UG spellings onto music-core vocabulary', () => {
    expect(normalizeUgSymbol('Amin')).toBe('Am')
    expect(normalizeUgSymbol('Cmaj')).toBe('C')
    expect(normalizeUgSymbol('CM7')).toBe('Cmaj7')
    expect(normalizeUgSymbol('Dsus')).toBe('Dsus4')
    expect(normalizeUgSymbol('Bm7-5')).toBe('Bm7b5')
    expect(normalizeUgSymbol('E7(#9)')).toBe('E7#9')
    expect(normalizeUgSymbol('D/F#')).toBe('D/F#')
  })

  it('transposes capo shapes to concert pitch, preserving slash bass', () => {
    expect(transposeSymbol('Am', 2)).toBe('Bm')
    expect(transposeSymbol('D/F#', 2)).toBe('E/G#')
    expect(transposeSymbol('G', 0)).toBe('G')
    expect(transposeSymbol('???', 3)).toBe('???') // unparseable passes through
  })
})

describe('parseSheet', () => {
  it('splits headers and chords in order, skipping [tab] wrappers', () => {
    const content = '[Verse 1]\n[tab][ch]Am[/ch] hello [ch]D[/ch][/tab]\n[Chorus]\n[ch]G[/ch]'
    const sections = parseSheet(content, 0)
    expect(sections.map((s) => s.kind)).toEqual(['verse', 'chorus'])
    expect(sections[0].chords.map((c) => c.symbol)).toEqual(['Am', 'D'])
    expect(sections[1].chords.map((c) => c.symbol)).toEqual(['G'])
  })

  it('opens an implicit intro for chords before any header', () => {
    const sections = parseSheet('[ch]E[/ch] [Verse]\n[ch]A[/ch]', 0)
    expect(sections[0].kind).toBe('intro')
    expect(sections[0].chords[0].symbol).toBe('E')
  })

  it('applies capo and flags unparseable symbols without dropping them', () => {
    const sections = parseSheet('[Verse 1]\n[ch]Am[/ch] [ch]Xq9[/ch]', 2)
    expect(sections[0].chords[0]).toMatchObject({ symbol: 'Bm', raw: 'Am', parseable: true })
    expect(sections[0].chords[1]).toMatchObject({ raw: 'Xq9', parseable: false })
  })

  it('numbers repeated kinds from the labels and beyond', () => {
    const sections = parseSheet('[Verse 1]\n[ch]A[/ch]\n[Verse 2]\n[ch]A[/ch]\n[Verse]\n[ch]A[/ch]', 0)
    expect(sections.map((s) => s.ordinal)).toEqual([1, 2, 3])
  })
})

describe('parseTabPage', () => {
  it('parses the fixture into a full UgChart', () => {
    const chart = parseTabPage(store, 'https://tabs.ultimate-guitar.com/tab/x/1089098')
    expect(chart.tabId).toBe(1089098)
    expect(chart.tonalityName).toBe('A')
    expect(chart.capo).toBe(0)
    expect(chart.official).toBe(false)
    expect(chart.rating).toBeCloseTo(4.8)
    expect(chart.sections.map((s) => s.kind)).toEqual(
      ['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro'],
    )
    expect(chart.sections[1].chords.map((c) => c.symbol)).toEqual(['A', 'G', 'D'])
    // Chordless repeats stay empty here — the fuser hydrates them.
    expect(chart.sections[3].chords).toEqual([])
    expect(chart.voicings?.A?.[0].frets).toEqual([-1, 0, 2, 2, 2, 0])
  })

  it('throws the Official/Pro-payload error when content is missing', () => {
    const noContent = { store: { page: { data: { tab: { id: 1, type: 'Official' }, tab_view: {} } } } }
    expect(() => parseTabPage(noContent, 'u')).toThrow(/no chord content/)
  })
})

describe('parseSearchPage', () => {
  it('keeps Chords and Official results only', () => {
    const search = {
      store: { page: { data: { results: [
        { id: 1, type: 'Chords', tab_url: 'https://u/1', song_name: 'S', artist_name: 'A', version: 1, rating: 4.5, votes: 100, tonality_name: 'G' },
        { id: 2, type: 'Official', tab_url: 'https://u/2', song_name: 'S', artist_name: 'A', version: 1, rating: 0, votes: 0 },
        { id: 3, type: 'Tabs', tab_url: 'https://u/3', song_name: 'S', artist_name: 'A' },
        { id: 4, type: 'Chords' }, // no url — dropped
      ] } } },
    }
    const versions = parseSearchPage(search)
    expect(versions.map((v) => v.tabId)).toEqual([1, 2])
    expect(versions[0].tonalityName).toBe('G')
  })

  it('returns empty on unexpected shapes', () => {
    expect(parseSearchPage({})).toEqual([])
    expect(parseSearchPage(null)).toEqual([])
  })
})
