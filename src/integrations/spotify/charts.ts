import type { PitchClass } from '../../music-core'

/**
 * Tap-synced chord charts. Spotify's audio-analysis API is deprecated, so
 * timing comes from the player: write the changes, play the track, tap on
 * each change. Charts live in localStorage keyed by track URI.
 */

export interface ChartEntry {
  ms: number
  symbol: string
}

export interface TrackChart {
  trackUri: string
  trackName: string
  key: PitchClass
  skeleton: 'minor' | 'major'
  entries: ChartEntry[]
}

const LS_KEY = 'spotify:charts'

function loadAll(): Record<string, TrackChart> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function chartFor(trackUri: string): TrackChart | null {
  return loadAll()[trackUri] ?? null
}

export function saveChart(chart: TrackChart): void {
  const all = loadAll()
  all[chart.trackUri] = chart
  localStorage.setItem(LS_KEY, JSON.stringify(all))
}

export function deleteChart(trackUri: string): void {
  const all = loadAll()
  delete all[trackUri]
  localStorage.setItem(LS_KEY, JSON.stringify(all))
}

/** The chart entry sounding at a position (last entry at or before it). */
export function entryAt(chart: TrackChart, positionMs: number): { entry: ChartEntry; index: number } | null {
  let found: { entry: ChartEntry; index: number } | null = null
  for (let i = 0; i < chart.entries.length; i++) {
    if (chart.entries[i].ms <= positionMs) found = { entry: chart.entries[i], index: i }
    else break
  }
  return found
}
