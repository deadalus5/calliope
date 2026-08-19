import { describe, expect, it } from 'vitest'
import { autoPickTab, type FetchedTab } from '../pick'
import { statusFromDisk } from '../status'
import { fuse, nearestBeatIndex, type FuseInput } from '../fuse'
import { parseTabPage } from '../ug-parse'
import type { AnalyzerResult, UgVersionInfo } from '../types'
import type { SongMap } from '../../../src/integrations/spotify/songmap'

/** Milestone-A hardening: full auto-pick, restart durability, beat tolerance. */

function version(over: Partial<UgVersionInfo>): UgVersionInfo {
  return {
    tabId: 1, url: 'https://ug/x', versionLabel: 'x', type: 'Chords',
    rating: 4, votes: 100, tonalityName: null, capo: null, ...over,
  }
}

function fakeTab(url: string): FetchedTab {
  return { chart: { tabId: 0, url } as FetchedTab['chart'], rawStore: {} }
}

describe('autoPickTab (full auto-pick)', () => {
  const officialA = version({ tabId: 10, url: 'https://ug/off-a', type: 'Official' })
  const officialB = version({ tabId: 11, url: 'https://ug/off-b', type: 'Official' })
  const commTop = version({ tabId: 20, url: 'https://ug/top', rating: 4.8, votes: 5000 })
  const commLow = version({ tabId: 21, url: 'https://ug/low', rating: 3.1, votes: 12 })

  const fetcherFailing = (failUrls: string[]) => {
    const tried: string[] = []
    const fetcher = async (url: string): Promise<FetchedTab> => {
      tried.push(url)
      if (failUrls.includes(url)) throw new Error(`no chord content at ${url}`)
      return fakeTab(url)
    }
    return { tried, fetcher }
  }

  it('tries every Official before falling back', async () => {
    const { tried, fetcher } = fetcherFailing(['https://ug/off-a'])
    const picked = await autoPickTab([officialA, officialB, commTop], undefined, fetcher)
    expect(tried).toEqual(['https://ug/off-a', 'https://ug/off-b'])
    expect(picked.tab.chart.url).toBe('https://ug/off-b')
    expect(picked.fallbackReason).toBeUndefined()
  })

  it('falls back to the top-scored community chart when all Officials fail', async () => {
    const { fetcher } = fetcherFailing(['https://ug/off-a', 'https://ug/off-b'])
    const picked = await autoPickTab([officialA, officialB, commLow, commTop], undefined, fetcher)
    expect(picked.tab.chart.url).toBe('https://ug/top')
    expect(picked.fallbackReason).toMatch(/Official chart not fetchable/)
  })

  it('auto-picks the top community chart when no Official exists (never a picker)', async () => {
    const { fetcher } = fetcherFailing([])
    const picked = await autoPickTab([commLow, commTop], undefined, fetcher)
    expect(picked.tab.chart.url).toBe('https://ug/top')
    expect(picked.fallbackReason).toMatch(/auto-picked/)
  })

  it('survives a single dead community tab page', async () => {
    const { fetcher } = fetcherFailing(['https://ug/top'])
    const picked = await autoPickTab([commTop, commLow], undefined, fetcher)
    expect(picked.tab.chart.url).toBe('https://ug/low')
  })

  it('throws when nothing is fetchable', async () => {
    const { fetcher } = fetcherFailing(['https://ug/top', 'https://ug/low'])
    await expect(autoPickTab([commTop, commLow], undefined, fetcher)).rejects.toThrow()
  })
})

describe('statusFromDisk (restart durability)', () => {
  const meta = { trackUri: 'spotify:track:x' }

  it('prefers a finished map over everything', () => {
    const map = { version: 1 } as unknown as SongMap
    const s = statusFromDisk({ ...meta, lastError: { stage: 'ug', message: 'boom' } }, map)
    expect(s).toEqual({ status: 'ready', songmap: map })
  })

  it('surfaces a durable error instead of silently re-running', () => {
    const s = statusFromDisk({ ...meta, lastError: { stage: 'audio', message: 'no match', hint: 'paste a URL' } }, null)
    expect(s).toEqual({ status: 'error', stage: 'audio', message: 'no match', hint: 'paste a URL' })
  })

  it('resumes a pending audio pick', () => {
    const cand = [{ videoId: 'abc', videoTitle: 't', channel: 'c', durationMs: 1, matchScore: 0.4 }]
    const s = statusFromDisk({ ...meta, pendingAudio: cand }, null)
    expect(s).toEqual({ status: 'pick', audioCandidates: cand })
  })

  it('returns null when the disk knows nothing', () => {
    expect(statusFromDisk({ ...meta }, null)).toBeNull()
  })
})

describe('nearestBeatIndex', () => {
  const beats = [0, 500, 1000, 1500, 2000]

  it('matches exact and jittered values', () => {
    expect(nearestBeatIndex(beats, 1000)).toBe(2)
    expect(nearestBeatIndex(beats, 1019)).toBe(2)
    expect(nearestBeatIndex(beats, 981)).toBe(2)
  })

  it('rejects beyond tolerance and empty input', () => {
    expect(nearestBeatIndex(beats, 1200)).toBe(-1)
    expect(nearestBeatIndex([], 1000)).toBe(-1)
  })

  it('picks the nearer neighbor at boundaries', () => {
    expect(nearestBeatIndex(beats, 260, 250)).toBe(1)
    expect(nearestBeatIndex(beats, 240, 250)).toBe(0)
  })
})

describe('applicature capo fallback (no notes array)', () => {
  it('flips high-e-first frets to low→high and sounds them at the capo', () => {
    const store = {
      store: { page: { data: {
        tab: { id: 42, tonality_name: 'Am', type: 'Chords' },
        tab_view: {
          meta: { capo: 2 },
          wiki_tab: { content: '[Verse 1]\n[ch]Am[/ch] [ch]D[/ch]' },
          // High-e-first x02210 (Am shape), NO notes — the fallback path.
          applicature: { Am: [{ frets: [0, 1, 2, 2, 0, -1], fret: 1 }] },
        },
      } } },
    }
    const chart = parseTabPage(store, 'https://ug/x')
    // Capo 2: the written Am sounds as Bm; open strings ring at the capo.
    expect(chart.voicings?.Bm).toBeDefined()
    expect(chart.voicings!.Bm[0].frets).toEqual([-1, 2, 4, 4, 3, 2])
    expect(chart.voicings!.Bm[0].baseFret).toBe(2)
  })
})

describe('fuse with jittered downbeats', () => {
  function input(downbeatJitter: number): FuseInput {
    const beats: number[] = []
    const positions: number[] = []
    for (let i = 0; i < 32; i++) {
      beats.push(i * 500)
      positions.push((i % 4) + 1)
    }
    const downbeats = beats.filter((_, i) => i % 4 === 0).map((ms, i) => ms + (i % 2 === 0 ? downbeatJitter : -downbeatJitter))
    const analyzer: AnalyzerResult = {
      bpm: 120,
      beatsMs: beats,
      downbeatsMs: downbeats,
      beatPositions: positions,
      segments: [{ startMs: 0, endMs: 16_000, label: 'verse' }],
    }
    const tokens = ['Am', 'F', 'C', 'G'].map((s) => ({ symbol: s, raw: s, parseable: true }))
    return {
      trackUri: 'spotify:track:jitter', trackName: 'Jitter', artistName: 'Test', durationMs: 16_000,
      ug: {
        tabId: 1, url: 'https://ug/1', versionLabel: 'v1', rating: 5, votes: 10, capo: 0,
        tonalityName: null, official: false,
        sections: [{
          label: 'Intro', kind: 'intro', ordinal: 1,
          chords: tokens,
          lines: [{
            kind: 'run',
            chords: tokens.map((t, i) => ({ ...t, col: i * 8 })),
            lyricLen: 0,
            chordLineLen: 32,
          }],
        }],
      },
      analyzer,
      audio: { source: 'youtube', videoId: 'x', videoTitle: 'x', durationMs: 16_000, matchScore: 1 },
      analyzerName: 'allin1', analyzerVersion: 'test', now: '2026-01-01T00:00:00.000Z',
    }
  }

  it('places chords identically whether downbeats are exact or ±20ms off the beat grid', () => {
    const exact = fuse(input(0))
    const jittered = fuse(input(20))
    expect(exact.chords.length).toBe(4)
    expect(jittered.chords.map((c) => c.beatIndex)).toEqual(exact.chords.map((c) => c.beatIndex))
    expect(jittered.downbeatIndices).toEqual(exact.downbeatIndices)
  })
})
