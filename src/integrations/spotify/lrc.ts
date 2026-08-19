import type { ResolvedTiming, SongMap } from './songmap'

/**
 * LRC parsing + chords-over-lyrics placement. Pure. A chord belongs to the
 * lyric line whose time span contains its RESOLVED ms (corrections shift
 * chords over the words automatically); its horizontal spot is the linear
 * fraction through the line.
 */

export interface LrcLine {
  ms: number
  text: string
}

const STAMP = /\[(\d+):(\d+(?:\.\d+)?)\]/g

export function parseLrc(text: string): LrcLine[] {
  const out: LrcLine[] = []
  for (const rawLine of text.split('\n')) {
    const stamps = [...rawLine.matchAll(STAMP)]
    if (stamps.length === 0) continue // metadata tags ([ar:…]) and blanks
    const body = rawLine.slice(stamps[stamps.length - 1].index! + stamps[stamps.length - 1][0].length).trim()
    for (const m of stamps) {
      out.push({ ms: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), text: body })
    }
  }
  out.sort((a, b) => a.ms - b.ms)
  return out
}

export interface PlacedChord {
  chordIndex: number
  symbol: string
  /** 0..0.95 through the line, by time. */
  frac: number
}

/** Chords per line index. Chords before the first line or after the last
 * one have no words to sit over and are skipped. */
export function placeChords(lines: LrcLine[], resolved: ResolvedTiming, map: SongMap): PlacedChord[][] {
  const out: PlacedChord[][] = lines.map(() => [])
  if (lines.length === 0) return out
  for (const rc of resolved.chords) {
    let idx = -1
    let lo = 0
    let hi = lines.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (lines[mid].ms <= rc.ms) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    if (idx === -1) continue
    const start = lines[idx].ms
    const end = idx + 1 < lines.length ? lines[idx + 1].ms : start + 10_000
    const frac = end > start ? Math.min(0.95, Math.max(0, (rc.ms - start) / (end - start))) : 0
    out[idx].push({ chordIndex: rc.chordIndex, symbol: map.chords[rc.chordIndex].symbol, frac })
  }
  return out
}

/** Index of the line sounding at a position, -1 before the first. */
export function lineAtMs(lines: LrcLine[], ms: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].ms <= ms) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return ans
}
