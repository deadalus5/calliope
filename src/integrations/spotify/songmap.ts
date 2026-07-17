import type { PitchClass } from './spotify-utils'

/**
 * The Song Map: one JSON document per Spotify track that carries everything
 * the Jam Room needs to follow a real record — chords (from Ultimate Guitar),
 * key + mode (inferred, in the app's skeleton+colors framing), beat/downbeat
 * grid and sections (from audio analysis on the songsmith sidecar), fused
 * with provenance so any layer can be re-done without losing the others.
 *
 * User corrections are a SEPARATE overlay (UserCorrections) applied at read
 * time by resolveTiming() — the map itself is never mutated, so re-fetching
 * or re-analyzing a song can never destroy what the user taught it.
 *
 * This file is pure (types + math only). The songsmith sidecar imports it by
 * relative path, so it must not touch the DOM, React, or anything browser.
 */

export const SONGMAP_VERSION = 1

export interface SongKey {
  root: PitchClass
  /** ModeSpec id from music-core ('mixolydian', 'dorian', ...). */
  modeId: string
  /** Denormalized from the mode so rendering never needs a lookup. */
  skeleton: 'minor' | 'major'
  /** 0..1 from key inference. */
  confidence: number
}

export type SectionKind =
  | 'intro' | 'verse' | 'chorus' | 'bridge' | 'solo' | 'inst' | 'outro' | 'other'

export interface SongSection {
  /** Stable within one map ('v1', 'ch2') — display/lookup id. */
  id: string
  /** Display label: 'INTRO', 'V1', 'CH2', 'SOLO'. */
  label: string
  kind: SectionKind
  /** 1 for V1, 2 for V2 — corrections key on (kind, ordinal) so they
   * survive a re-analysis that produces fresh section ids. */
  ordinal: number
  startMs: number
  endMs: number
  /** Set when a section clearly modulates (bridges). */
  keyOverride?: SongKey
}

export interface SongMapChord {
  /** parseChordSymbol-compatible; unparseable UG oddities are kept verbatim
   * and flagged by the fuser in provenance.fusion.warnings. */
  symbol: string
  /** Index into beats[] — the authoritative position. */
  beatIndex: number
  /** beats[beatIndex], denormalized so lookups need no indirection. */
  ms: number
  durationBeats: number
  sectionId: string
  /** degreeOf(chord root, key root) — denormalized for grid chip labels. */
  rootDegree: number
}

export interface UgVoicing {
  /** Fret per string, low E → high E; -1 = muted. */
  frets: number[]
  baseFret: number
}

export interface Provenance {
  ug: {
    tabId: number
    url: string
    versionLabel: string
    rating: number
    votes: number
    capo: number
    tonalityName: string | null
    official: boolean
    fallbackReason?: string
  }
  audio: {
    source: 'youtube'
    videoId: string
    videoTitle: string
    durationMs: number
    matchScore: number
  }
  analyzer: { name: string; version: string }
  fusion: { fusedAt: string; sectionAlignConfidence: number; warnings: string[] }
  refined?: { method: 'chroma-dtw'; at: string }
}

export interface SongMap {
  version: typeof SONGMAP_VERSION
  trackUri: string
  trackName: string
  artistName: string
  durationMs: number
  key: SongKey
  sections: SongSection[]
  tempo: { bpm: number; meter: { beatsPerBar: number; beatUnit: number } }
  /** Analyzer beat grid, ms, strictly ascending. */
  beats: number[]
  /** Indices into beats[] that are downbeats (bar starts). */
  downbeatIndices: number[]
  /** Ascending by beatIndex. */
  chords: SongMapChord[]
  /** symbol -> UG applicature fingerings (already capo-adjusted). */
  voicings?: Record<string, UgVoicing[]>
  provenance: Provenance
}

// ---------------------------------------------------------------------------
// User corrections: an append-only teaching layer.

/** Structural key for a section: survives re-fusion (ids change, the second
 * chorus is still the second chorus). */
export function sectionCorrectionKey(kind: SectionKind, ordinal: number): string {
  return `${kind}:${ordinal}`
}

export function chordCorrectionKey(kind: SectionKind, ordinal: number, chordIdxInSection: number): string {
  return `${kind}:${ordinal}:${chordIdxInSection}`
}

export interface TapRecord {
  ts: number
  atMs: number
  snappedBeatIndex: number
  scope: { kind: SectionKind; ordinal: number }
  appliedOffsetMs: number
}

export interface UserCorrections {
  version: 1
  trackUri: string
  /** One knob for systemic (player/latency) offset, ms. */
  globalOffsetMs: number
  /** sectionCorrectionKey -> ms offset for every chord in that section. */
  sectionOffsets: Record<string, number>
  /** chordCorrectionKey -> offset in beats (±0.5 steps). */
  chordNudges: Record<string, number>
  /** Raw tap history, append-only, never pruned. */
  taps: TapRecord[]
  versionPick?: { tabId: number } | { youtubeUrl: string }
}

export function emptyCorrections(trackUri: string): UserCorrections {
  return {
    version: 1,
    trackUri,
    globalOffsetMs: 0,
    sectionOffsets: {},
    chordNudges: {},
    taps: [],
  }
}

// ---------------------------------------------------------------------------
// Resolved timing: SongMap × UserCorrections -> what actually renders.

export interface ResolvedChord {
  /** Index into map.chords. */
  chordIndex: number
  /** Corrected sounding time. */
  ms: number
}

export interface ResolvedSection {
  /** Index into map.sections. */
  sectionIndex: number
  startMs: number
  endMs: number
}

export interface ResolvedTiming {
  /** Ascending by ms (re-sorted after nudges). */
  chords: ResolvedChord[]
  sections: ResolvedSection[]
}

/** ms of one beat at the map's tempo (nudges are expressed in beats). */
export function beatMs(map: SongMap): number {
  return 60_000 / map.tempo.bpm
}

/**
 * Apply corrections without mutating the map. Precedence: global offset
 * applies to everything; a section offset shifts every chord in it; a chord
 * nudge moves one chord relative to its (already shifted) position.
 */
export function resolveTiming(map: SongMap, corrections?: UserCorrections | null): ResolvedTiming {
  const c = corrections ?? emptyCorrections(map.trackUri)
  const oneBeat = beatMs(map)
  const bySection = new Map<string, SongSection>()
  for (const s of map.sections) bySection.set(s.id, s)

  // Chord ordinal within its section, for chordNudges keys.
  const chordIdxInSection = new Map<number, number>()
  const perSectionCount = new Map<string, number>()
  map.chords.forEach((ch, i) => {
    const n = perSectionCount.get(ch.sectionId) ?? 0
    chordIdxInSection.set(i, n)
    perSectionCount.set(ch.sectionId, n + 1)
  })

  const chords: ResolvedChord[] = map.chords.map((ch, i) => {
    const section = bySection.get(ch.sectionId)
    const secOffset = section
      ? (c.sectionOffsets[sectionCorrectionKey(section.kind, section.ordinal)] ?? 0)
      : 0
    const nudgeBeats = section
      ? (c.chordNudges[chordCorrectionKey(section.kind, section.ordinal, chordIdxInSection.get(i)!)] ?? 0)
      : 0
    return { chordIndex: i, ms: ch.ms + c.globalOffsetMs + secOffset + nudgeBeats * oneBeat }
  })
  chords.sort((a, b) => a.ms - b.ms || a.chordIndex - b.chordIndex)

  const sections: ResolvedSection[] = map.sections.map((s, i) => {
    const off = c.globalOffsetMs + (c.sectionOffsets[sectionCorrectionKey(s.kind, s.ordinal)] ?? 0)
    return { sectionIndex: i, startMs: s.startMs + off, endMs: s.endMs + off }
  })

  return { chords, sections }
}

// ---------------------------------------------------------------------------
// Binary-search lookups. A full song has hundreds of chords/beats and the
// playhead polls at 10Hz — the legacy linear entryAt() doesn't scale.

/** Index of the last element with value <= target, or -1. `get` extracts the
 * comparable from an element. */
function lastAtOrBefore<T>(arr: readonly T[], target: number, get: (t: T) => number): number {
  let lo = 0
  let hi = arr.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (get(arr[mid]) <= target) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return ans
}

/** The chord sounding at a position, as an index into resolved.chords (-1 before the first). */
export function chordAtMs(resolved: ResolvedTiming, ms: number): number {
  return lastAtOrBefore(resolved.chords, ms, (c) => c.ms)
}

/** The next chord strictly after a position (index into resolved.chords), or -1 at the end. */
export function nextChordAfter(resolved: ResolvedTiming, ms: number): number {
  const at = chordAtMs(resolved, ms)
  return at + 1 < resolved.chords.length ? at + 1 : -1
}

/** The section containing a position (index into resolved.sections), or -1
 * before the first. Sections are contiguous, so the last one whose start is
 * at or before the position is the one sounding. */
export function sectionAtMs(resolved: ResolvedTiming, ms: number): number {
  return lastAtOrBefore(resolved.sections, ms, (s) => s.startMs)
}

/** Nearest beat to a position (index into map.beats), or -1 if no beats. */
export function beatIndexAtMs(map: SongMap, ms: number): number {
  const { beats } = map
  if (beats.length === 0) return -1
  const before = lastAtOrBefore(beats, ms, (b) => b)
  if (before === -1) return 0
  if (before === beats.length - 1) return before
  return ms - beats[before] <= beats[before + 1] - ms ? before : before + 1
}

/**
 * Whole beats remaining until the next chord change, for the countdown dots.
 * Returns null when there is no next change or no beat grid.
 */
export function beatsToNextChange(resolved: ResolvedTiming, map: SongMap, ms: number): number | null {
  const next = nextChordAfter(resolved, ms)
  if (next === -1 || map.beats.length === 0) return null
  const target = resolved.chords[next].ms
  return Math.max(0, Math.round((target - ms) / beatMs(map)))
}

// ---------------------------------------------------------------------------
// Version gate.

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isAscending(nums: number[]): boolean {
  for (let i = 1; i < nums.length; i++) if (nums[i] < nums[i - 1]) return false
  return true
}

/**
 * Accept a SongMap-shaped JSON document from the sidecar or Dexie, or reject
 * it (null). Structural checks only — chord symbols may legitimately be
 * unparseable UG oddities and are handled at render time.
 */
export function migrateSongMap(json: unknown): SongMap | null {
  if (typeof json !== 'object' || json === null) return null
  const m = json as Record<string, unknown>
  if (m.version !== SONGMAP_VERSION) return null
  if (typeof m.trackUri !== 'string' || m.trackUri.length === 0) return null
  if (typeof m.trackName !== 'string' || typeof m.artistName !== 'string') return null
  if (!isFiniteNum(m.durationMs)) return null

  const key = m.key as Record<string, unknown> | null
  if (typeof key !== 'object' || key === null) return null
  if (!isFiniteNum(key.root) || key.root < 0 || key.root > 11) return null
  if (typeof key.modeId !== 'string') return null
  if (key.skeleton !== 'minor' && key.skeleton !== 'major') return null

  const tempo = m.tempo as Record<string, unknown> | null
  if (typeof tempo !== 'object' || tempo === null || !isFiniteNum(tempo.bpm) || (tempo.bpm as number) <= 0) return null

  if (!Array.isArray(m.beats) || !m.beats.every(isFiniteNum) || !isAscending(m.beats as number[])) return null
  if (!Array.isArray(m.downbeatIndices) || !(m.downbeatIndices as unknown[]).every(isFiniteNum)) return null
  if (!Array.isArray(m.sections) || !Array.isArray(m.chords)) return null
  for (const s of m.sections as unknown[]) {
    if (typeof s !== 'object' || s === null) return null
    const sec = s as Record<string, unknown>
    if (typeof sec.id !== 'string' || typeof sec.kind !== 'string') return null
    if (!isFiniteNum(sec.startMs) || !isFiniteNum(sec.endMs) || !isFiniteNum(sec.ordinal)) return null
  }
  for (const ch of m.chords as unknown[]) {
    if (typeof ch !== 'object' || ch === null) return null
    const c = ch as Record<string, unknown>
    if (typeof c.symbol !== 'string' || !isFiniteNum(c.ms) || !isFiniteNum(c.beatIndex)) return null
    if (typeof c.sectionId !== 'string') return null
  }
  if (typeof m.provenance !== 'object' || m.provenance === null) return null
  return json as SongMap
}

/** Same gate for the corrections overlay. */
export function migrateCorrections(json: unknown): UserCorrections | null {
  if (typeof json !== 'object' || json === null) return null
  const c = json as Record<string, unknown>
  if (c.version !== 1) return null
  if (typeof c.trackUri !== 'string') return null
  if (!isFiniteNum(c.globalOffsetMs)) return null
  if (typeof c.sectionOffsets !== 'object' || c.sectionOffsets === null) return null
  if (typeof c.chordNudges !== 'object' || c.chordNudges === null) return null
  if (!Array.isArray(c.taps)) return null
  return json as UserCorrections
}
