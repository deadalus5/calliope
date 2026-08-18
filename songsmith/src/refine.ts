import { normalizePc, parseChordSymbol } from '../../src/music-core'
import { beatIndexAtMs, type SongMap } from '../../src/integrations/spotify/songmap'

/**
 * Chroma refinement, TS side: build the request for py/refine_chroma.py
 * (which does zero music theory — pcs travel in the JSON) and apply its
 * answer back onto a SongMap. Pure; the subprocess call lives in jobs.ts.
 */

export interface RefineRequest {
  audio: string
  beatsMs: number[]
  sections: { startBeat: number; endBeat: number }[]
  chords: { i: number; sectionIdx: number; beatIndex: number; rootPc: number; pcs: number[] }[]
  bandBeats: number
}

export interface RefineResponse {
  ok: boolean
  refined: { i: number; beatIndex: number }[]
  confidence: number
  meanAbsShiftBeats: number
  error: string | null
}

/** Refuse to write a refinement below these bars — the fused map stays. */
export const MIN_CONFIDENCE = 0.55
export const MAX_MEAN_SHIFT_BEATS = 1.5

export function buildRefineRequest(map: SongMap, audioPath: string): RefineRequest {
  const sectionIdxById = new Map(map.sections.map((s, i) => [s.id, i]))
  const chords: RefineRequest['chords'] = []
  map.chords.forEach((c, i) => {
    let root: number
    let pcs: number[]
    try {
      const parsed = parseChordSymbol(c.symbol)
      root = parsed.root
      pcs = parsed.quality.intervals.map((iv) => normalizePc(parsed.root + iv))
    } catch {
      return // unparseable — keeps its fused position, casts no chroma vote
    }
    chords.push({
      i,
      sectionIdx: sectionIdxById.get(c.sectionId) ?? 0,
      beatIndex: c.beatIndex,
      rootPc: root,
      pcs,
    })
  })
  return {
    audio: audioPath,
    beatsMs: map.beats,
    sections: map.sections.map((s) => ({
      startBeat: Math.max(0, beatIndexAtMs(map, s.startMs)),
      endBeat: Math.max(0, beatIndexAtMs(map, s.endMs)),
    })),
    chords,
    bandBeats: 2,
  }
}

/**
 * The refined map, or null when the gate refuses (low confidence, wild
 * shifts, or an analysis error) — in which case the fused map stands and
 * nothing is written.
 */
export function applyRefinement(map: SongMap, res: RefineResponse, at: string): SongMap | null {
  if (!res.ok) return null
  if (res.confidence < MIN_CONFIDENCE) return null
  if (res.meanAbsShiftBeats > MAX_MEAN_SHIFT_BEATS) return null

  const byIndex = new Map(res.refined.map((r) => [r.i, r.beatIndex]))
  const chords = map.chords.map((c, i) => {
    const b = byIndex.get(i)
    if (b === undefined || b < 0 || b >= map.beats.length) return { ...c }
    return { ...c, beatIndex: b, ms: map.beats[b] }
  })
  chords.sort((a, b) => a.beatIndex - b.beatIndex)
  for (let i = 0; i < chords.length; i++) {
    const nextBeat = i + 1 < chords.length ? chords[i + 1].beatIndex : map.beats.length
    chords[i].durationBeats = Math.max(1, nextBeat - chords[i].beatIndex)
  }
  return {
    ...map,
    chords,
    provenance: { ...map.provenance, refined: { method: 'chroma-dtw', at } },
  }
}
