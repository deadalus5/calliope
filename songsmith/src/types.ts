import type { SectionKind, UgVoicing } from '../../src/integrations/spotify/songmap'

/** One chord occurrence in a UG sheet, in written order (repeats included). */
export interface UgChordToken {
  /** Concert-pitch symbol after capo adjustment (best effort). */
  symbol: string
  /** As written on the sheet. */
  raw: string
  /** False when the symbol isn't in music-core's vocabulary — kept anyway. */
  parseable: boolean
}

export interface UgSection {
  /** Header as written: 'Verse 1', 'Guitar Solo'. */
  label: string
  kind: SectionKind
  /** 1-based per kind, in sheet order. */
  ordinal: number
  chords: UgChordToken[]
}

export interface UgChart {
  tabId: number
  url: string
  versionLabel: string
  rating: number
  votes: number
  capo: number
  /** As written on the sheet (shape key when capo'd) — concert normalization
   * happens in key inference, which gets the capo alongside. */
  tonalityName: string | null
  official: boolean
  sections: UgSection[]
  voicings?: Record<string, UgVoicing[]>
}

export interface UgVersionInfo {
  tabId: number
  url: string
  versionLabel: string
  type: string
  rating: number
  votes: number
  tonalityName: string | null
  capo: number | null
}

/** allin1 output, already converted to ms. */
export interface AnalyzerResult {
  bpm: number
  beatsMs: number[]
  downbeatsMs: number[]
  /** 1-based position of each beat within its bar; max = beats per bar. */
  beatPositions: number[]
  segments: { startMs: number; endMs: number; label: string }[]
}

export interface AudioMatch {
  videoId: string
  videoTitle: string
  channel: string
  durationMs: number
  matchScore: number
}
